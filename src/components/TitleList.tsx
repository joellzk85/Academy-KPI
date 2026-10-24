import React, { useMemo, useRef, useState } from 'react';
import { deleteDoc, doc, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { ChevronDown, ChevronRight, Hash, Loader2, Plus, Search, Trash2, X } from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import { useCloseOnOutside } from '../lib/useCloseOnOutside';
import { useFormDraft } from '../lib/useFormDraft';
import { deleteProgrammeEverywhere } from '../lib/detach';
import { formatDate, todayIso } from '../lib/deals';
import {
  HRDC_STATUS_LABELS, HrdcStatus, Programme, categoryList, normTag, programmeStatus, programmeTags, programmesFor, titleKey, withTbMark,
} from '../lib/programmes';
import DraftBar from './DraftBar';
import PanelResizer from './PanelResizer';
import ProgrammeLinks, { ProgrammeLinkedInfo, linkOutline } from './ProgrammeLinks';
import { StatusChip, TYPE_TAB_LABELS } from './Programmes';
import { OutlineType, outlineTypeOf, programmeTypeOf } from '../lib/outlineTb';
import ListPager from './ListPager';
import { LIST_SORT_LABELS, sortList, usePaged, type ListSort } from '../lib/listPaging';

// Titles are the programmes (Joel, 2026-10-24): "Course outlines title IS the program, team building title is the
// program." Course outlines and Teambuilding proposal each show their documents grouped by title. A title row holds
// what the old Programmes tab held: HRDC status, category, #tags, trainers, outline files. Every client's tailored
// outline with the same title sits under it, so a repeat client just reuses one. A title typed on a deal before any
// outline exists shows "No outline yet". A document whose title isn't in the list yet still gets its own row; the
// record is made the first time someone saves details on it.

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };
export type TitleKind = 'training' | 'teambuilding';

/** One course outline or teambuilding proposal, as the title list needs it. */
export interface TitleDoc {
  id: string;
  title: string;          // what it prints now
  programmeId: string;    // its own, else its deal's
  company: string;
  ref: string;
  date: string;
  sent: boolean;
  raw: any;
}

export interface TitleGroup {
  key: string;
  name: string;
  programme?: Programme;   // not set: no record yet (the title is only typed on documents)
  docs: TitleDoc[];
}

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const select = 'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] focus:border-accent focus:outline-none sm:w-auto';
const label = 'mb-1.5 block text-sm font-semibold text-ink';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';
const daysText = (d?: number | null) => (d ? (d === 0.5 ? 'Half day' : `${d} day${d === 1 ? '' : 's'}`) : '');
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Groups documents under their titles. Every title in the list shows, with or without documents. */
export function groupByTitle(kind: TitleKind, programmes: Programme[], docs: TitleDoc[]): TitleGroup[] {
  const list = programmesFor(programmes, kind);
  const groups = new Map<string, TitleGroup>();
  list.forEach(p => groups.set(p.id, { key: p.id, name: p.name, programme: p, docs: [] }));
  const byName = new Map(list.map(p => [titleKey(p.name), p.id] as [string, string]));
  docs.forEach(d => {
    const viaId = d.programmeId && groups.has(d.programmeId) ? d.programmeId : '';
    const k = viaId || byName.get(titleKey(d.title)) || `t:${titleKey(d.title)}`;
    if (!groups.has(k)) groups.set(k, { key: k, name: d.title.trim() || 'No title yet', docs: [] });
    groups.get(k)!.docs.push(d);
  });
  groups.forEach(g => g.docs.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || b.id.localeCompare(a.id)));
  return [...groups.values()];
}

// ---------- The list ----------
/** A training title's type: its record's, else its newest outline's (Soft skill / Technical skill). */
export const groupTypeOf = (g: TitleGroup, outlines: any[]): OutlineType =>
  g.programme ? programmeTypeOf(g.programme, outlines) : g.docs.length ? outlineTypeOf(g.docs[0].raw) : 'soft';

export default function TitlesView({ kind, programmes, docs, deals, trainers, outlines, viewer, onOpenDoc, onWrite, loaded, onlyType, docType }: {
  kind: TitleKind; programmes: Programme[]; docs: TitleDoc[]; deals: any[]; trainers: any[];
  outlines: any[];                      // course outlines (for linking on a training title)
  onlyType?: OutlineType;               // training titles: show only Soft skill or Technical skill ones
  docType?: 'outline' | 'proposal';     // what the documents are (teambuilding titles on Course outlines hold outlines)
  viewer: Viewer; loaded: boolean;
  onOpenDoc: (d: TitleDoc) => void;
  onWrite: (g: TitleGroup) => void;     // "Write outline" / "Write proposal" for this title
}) {
  const staff = viewer.role !== 'rep';
  const docWord = docType || (kind === 'teambuilding' ? 'proposal' : 'outline');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');   // '' = all, '-' = no category
  const [hrdc, setHrdc] = useState<'' | HrdcStatus>('');
  const [sortBy, setSortBy] = useState<'' | ListSort>('');   // '' = grouped by category
  const [open, setOpen] = useState<string | null>(null);
  const [panel, setPanel] = useState<TitleGroup | null>(null);

  const groups = useMemo(() => groupByTitle(kind, programmes, docs), [kind, programmes, docs]);
  const usage = useMemo(() => {
    const m: Record<string, number> = {};
    deals.forEach(d => { if (d.programmeId) m[d.programmeId] = (m[d.programmeId] || 0) + 1; });
    return m;
  }, [deals]);
  const teachers = (id?: string) => (id ? trainers.filter(t => (t.programmeIds || []).includes(id)).length : 0);
  const categories = useMemo(() => categoryList(programmesFor(programmes, kind)), [programmes, kind]);
  // "customer service" typed before shows under the standard "Customer service".
  const catOf = (g: TitleGroup) => { const c = String(g.programme?.category || '').trim(); return categories.find(x => x.toLowerCase() === c.toLowerCase()) || c; };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const tagQ = q.startsWith('#') ? normTag(q) : '';
    const list = groups
      .filter(g => !onlyType || kind !== 'training' || groupTypeOf(g, outlines) === onlyType)
      .filter(g => !category || (category === '-' ? !catOf(g) : catOf(g).toLowerCase() === category.toLowerCase()))
      .filter(g => !hrdc || (g.programme && programmeStatus(g.programme) === hrdc))
      .filter(g => {
        if (!q) return true;
        const tags = programmeTags(g.programme);
        if (tagQ) return tags.some(t => t.startsWith(tagQ));
        return `${g.name} ${g.programme?.hrdcCode || ''} ${catOf(g)} ${tags.map(t => `#${t}`).join(' ')} ${g.docs.map(d => `${d.company} ${d.ref}`).join(' ')}`.toLowerCase().includes(q);
      });
    // Date added: the title's own, else its newest outline or proposal.
    if (sortBy) return sortList(list, sortBy, g => g.name, g => (g.programme as any)?.createdAt || g.docs.map(d => d.date).sort().pop());
    return list.sort((a, b) => Number(!catOf(a)) - Number(!catOf(b)) || catOf(a).localeCompare(catOf(b)) || a.name.localeCompare(b.name));
  }, [groups, search, category, hrdc, categories, sortBy, onlyType, outlines]);
  const paged = usePaged(visible, [search, category, hrdc, sortBy, onlyType]);

  // The panel follows live changes (a new record, a rename) while it's open.
  const livePanel = panel && (panel.programme ? groups.find(g => g.programme?.id === panel.programme!.id) : groups.find(g => g.key === panel.key)) || panel;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search title, client or #tag" className={`${input} pl-9`} aria-label="Search titles" />
        </div>
        <select value={category} onChange={e => setCategory(e.target.value)} aria-label="Category" className={select}>
          <option value="">All categories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
          <option value="-">No category</option>
        </select>
        <select value={hrdc} onChange={e => setHrdc(e.target.value as any)} aria-label="HRDC status" className={select}>
          <option value="">Any HRDC status</option>
          <option value="approved">HRDC approved</option>
          <option value="submitted">Waiting on HRDC</option>
          <option value="not_registered">Not registered</option>
        </select>
        <select value={sortBy} onChange={e => setSortBy(e.target.value as '' | ListSort)} aria-label="Sort titles" className={select}>
          <option value="">Grouped by category</option>
          {(Object.keys(LIST_SORT_LABELS) as ListSort[]).map(k => <option key={k} value={k}>{k === 'az' ? 'Title A to Z' : k === 'za' ? 'Title Z to A' : LIST_SORT_LABELS[k]}</option>)}
        </select>
      </div>

      <div className="rounded-2xl border border-line bg-white">
        {!loaded ? (
          <p className="flex items-center gap-2 p-6 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
        ) : visible.length === 0 ? (
          <div className="p-8 text-center">
            <p className="font-semibold">No titles here</p>
            <p className="mt-1 text-[15px] text-ink-soft">A title is added when you write a {docWord}, or when it's typed on a deal.</p>
          </div>
        ) : (
          <><ul className="divide-y divide-line">
            {paged.pageItems.map((g, i, rows) => {
              const p = g.programme;
              const tags = programmeTags(p);
              const isOpen = open === g.key;
              const showCat = !sortBy && (i === 0 || (catOf(rows[i - 1]) || '') !== (catOf(g) || ''));
              return (
                <React.Fragment key={g.key}>
                  {showCat && <li className="bg-surface px-4 py-1.5 text-xs font-semibold text-ink-soft">{catOf(g) || 'No category'}</li>}
                  <li>
                    <div className="flex items-start gap-2 px-4 py-3 hover:bg-surface">
                      <button type="button" onClick={() => setOpen(isOpen ? null : g.key)} aria-expanded={isOpen} className="flex min-w-0 flex-1 items-start gap-2 text-left">
                        {isOpen ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-ink-soft" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-ink-soft" />}
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold">{g.name}</span>
                            {p && <StatusChip programme={p} />}
                            {g.docs.length === 0 && <span className="rounded-md bg-attention-soft px-2 py-0.5 text-xs font-semibold text-attention">No {docWord} yet</span>}
                          </span>
                          <span className="mt-0.5 block text-sm text-ink-soft">
                            {[plural(g.docs.length, docWord), p ? plural(usage[p.id] || 0, 'deal') : '', p ? plural(teachers(p.id), 'trainer') : '', daysText(p?.days), p?.hrdcCode ? `HRDC code ${p.hrdcCode}` : ''].filter(Boolean).join(' · ')}
                          </span>
                        </span>
                      </button>
                      <span className="hidden max-w-[40%] flex-wrap justify-end gap-1 sm:flex">
                        {tags.map(t => (
                          <button key={t} type="button" onClick={() => setSearch(`#${t}`)} className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent hover:underline">#{t}</button>
                        ))}
                      </span>
                    </div>
                    {isOpen && (
                      <div className="space-y-2 border-t border-line bg-surface/50 px-4 py-3 sm:pl-10">
                        {tags.length > 0 && (
                          <p className="flex flex-wrap gap-1 sm:hidden">
                            {tags.map(t => <button key={t} type="button" onClick={() => setSearch(`#${t}`)} className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">#{t}</button>)}
                          </p>
                        )}
                        {g.docs.length > 0 && (
                          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
                            {g.docs.map(d => (
                              <li key={d.id}>
                                <button type="button" onClick={() => onOpenDoc(d)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface">
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-[15px] font-semibold">{d.company || 'General'}</span>
                                    <span className="flex items-center gap-1.5 truncate text-sm text-ink-soft">
                                      {d.ref}
                                      {d.sent ? <span className="rounded bg-accent-soft px-1.5 text-xs font-semibold text-accent">Sent</span> : <span className="rounded bg-surface px-1.5 text-xs font-semibold">Draft</span>}
                                      {titleKey(d.title) !== titleKey(g.name) && <span className="truncate">· titled "{d.title || 'untitled'}"</span>}
                                    </span>
                                  </span>
                                  <span className="shrink-0 text-sm text-ink-soft">{formatDate(d.date) || ''}</span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                        <span className="flex flex-wrap gap-2">
                          <button type="button" className={btnPrimary} onClick={() => onWrite(g)}><Plus className="h-4 w-4" /> Write {docWord}</button>
                          {(p || g.name !== 'No title yet') && <button type="button" className={btnSecondary} onClick={() => setPanel(g)}>Title details{staff ? ' and HRDC' : ''}</button>}
                        </span>
                      </div>
                    )}
                  </li>
                </React.Fragment>
              );
            })}
          </ul>
          <ListPager paged={paged} noun="titles" /></>
        )}
      </div>

      {livePanel && (
        <TitlePanel kind={kind} docWord={docWord} group={livePanel} programmes={programmes} deals={deals} trainers={trainers} outlines={outlines} viewer={viewer}
          docs={docs} onClose={() => setPanel(null)} />
      )}
    </div>
  );
}

// ---------- Category: the standard list, or a new one ----------
export function CategoryPicker({ id, value, categories, onChange }: { id?: string; value: string; categories: string[]; onChange: (v: string) => void }) {
  const known = categories.find(c => c.toLowerCase() === value.trim().toLowerCase());
  const [adding, setAdding] = useState(!!value.trim() && !known);
  if (adding) {
    return (
      <div className="flex gap-2">
        <input id={id} autoFocus value={value} onChange={e => onChange(e.target.value)} className={input} placeholder="Type the new category" />
        <button type="button" className={btnSecondary} onClick={() => { setAdding(false); if (!categories.some(c => c.toLowerCase() === value.trim().toLowerCase())) onChange(''); }}>Back to list</button>
      </div>
    );
  }
  return (
    <select id={id} value={known || ''} onChange={e => (e.target.value === '+' ? (setAdding(true), onChange('')) : onChange(e.target.value))} className={input}>
      <option value="">No category</option>
      {categories.map(c => <option key={c} value={c}>{c}</option>)}
      <option value="+">+ New category…</option>
    </select>
  );
}

// ---------- #Tags: type and press Enter; ones already in use are suggested ----------
// "#leadership #sales" adds two; "Time management" adds one (#time-management).
export function TagInput({ id, tags, allTags, onChange, disabled }: { id?: string; tags: string[]; allTags: string[]; onChange: (t: string[]) => void; disabled?: boolean }) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useCloseOnOutside(box, open, () => setOpen(false));
  const q = normTag(text);
  const suggestions = allTags.filter(t => !tags.includes(t) && (!q || t.includes(q))).slice(0, 8);
  const add = (raw: string) => {
    const fresh = raw.split(/[#,]+/).map(normTag).filter(t => t && !tags.includes(t));
    if (fresh.length) onChange([...tags, ...new Set(fresh)]);
    setText('');
  };
  return (
    <div ref={box} className="relative">
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-line bg-white px-2 py-1.5 focus-within:border-accent">
        {tags.map(t => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-0.5 text-sm font-semibold text-accent">
            #{t}
            {!disabled && <button type="button" onClick={() => onChange(tags.filter(x => x !== t))} aria-label={`Remove #${t}`}><X className="h-3.5 w-3.5" /></button>}
          </span>
        ))}
        {!disabled && (
          <span className="flex min-w-[10rem] flex-1 items-center gap-1">
            <Hash className="h-4 w-4 shrink-0 text-ink-soft" />
            <input id={id} value={text} onChange={e => { setText(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
              onKeyDown={e => {
                if ((e.key === 'Enter' || e.key === ',') && text.trim()) { e.preventDefault(); add(text); }
                if (e.key === 'Backspace' && !text && tags.length) onChange(tags.slice(0, -1));
              }}
              onBlur={() => { if (text.trim()) add(text); }}
              className="w-full border-0 bg-transparent py-0.5 text-[15px] focus:outline-none" placeholder={tags.length ? 'Add another' : 'e.g. leadership, then Enter'} />
          </span>
        )}
      </div>
      {open && !disabled && suggestions.length > 0 && (
        <div className="absolute z-10 mt-1 flex w-full flex-wrap gap-1.5 rounded-lg border border-line bg-white p-2 shadow-lg">
          {suggestions.map(t => (
            <button key={t} type="button" onMouseDown={e => e.preventDefault()} onClick={() => add(t)} className="rounded-full border border-line px-2.5 py-0.5 text-sm font-semibold text-ink-soft hover:border-accent hover:text-accent">#{t}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Every #tag in use, most used first. */
export function allTagsOf(programmes: Programme[]): string[] {
  const n: Record<string, number> = {};
  programmes.forEach(p => programmeTags(p).forEach(t => { n[t] = (n[t] || 0) + 1; }));
  return Object.keys(n).sort((a, b) => n[b] - n[a] || a.localeCompare(b));
}

/** Makes the record for a title that's only typed on documents so far. Anyone may (it starts not registered). */
export async function createTitle(kind: TitleKind, name: string, viewer: Viewer, extra: Partial<Programme> = {}): Promise<Programme> {
  const id = `prog_${Date.now()}`;
  const data: any = {
    id, name: kind === 'teambuilding' ? withTbMark(name) : name.trim(), hrdcStatus: 'not_registered', hrdcCode: '', submittedDate: '', approvedDate: '', notes: '',
    ...extra, createdAt: Date.now(), createdById: viewer.id, createdByName: viewer.name,
  };
  await setDoc(doc(db, 'programmes', id), data);
  return data;
}

// ---------- A title's details (what the Programmes tab used to hold) ----------
// Everyone sets the category and #tags. Only Admin and Management rename a title (it changes on every deal), set its
// HRDC registration, link outlines, files and trainers, or delete it.
const formOf = (p?: Programme, name = '', type: OutlineType = 'soft') => ({
  name: p?.name || name, skillType: (type === 'technical' ? 'technical' : 'soft') as 'soft' | 'technical', category: p?.category || '', tags: programmeTags(p), days: p?.days ? String(p.days) : '',
  hrdcStatus: programmeStatus(p) as HrdcStatus, hrdcCode: p?.hrdcCode || '', submittedDate: p?.submittedDate || '', approvedDate: p?.approvedDate || '', notes: p?.notes || '',
});

function TitlePanel({ kind, docWord, group, programmes, deals, trainers, outlines, docs, viewer, onClose }: {
  kind: TitleKind; docWord: 'outline' | 'proposal'; group: TitleGroup; programmes: Programme[]; deals: any[]; trainers: any[]; outlines: any[]; docs: TitleDoc[]; viewer: Viewer; onClose: () => void;
}) {
  const staff = viewer.role !== 'rep';
  const p = group.programme;
  const startType = groupTypeOf(group, outlines);
  const [form, setForm] = useState(() => formOf(p, group.name, startType));
  const formDraft = useFormDraft(viewer.id, `title:${p?.id || group.key}`, form, setForm);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const categories = categoryList(programmesFor(programmes, kind));
  const tagList = allTagsOf(programmes);
  const usedOn = p ? deals.filter(d => d.programmeId === p.id).length : 0;

  const setStatus = (st: HrdcStatus) => setForm(f => ({
    ...f, hrdcStatus: st,
    submittedDate: st !== 'not_registered' && !f.submittedDate ? todayIso() : f.submittedDate,
    approvedDate: st === 'approved' && !f.approvedDate ? todayIso() : f.approvedDate,
  }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = (kind === 'teambuilding' ? withTbMark(form.name) : form.name.trim());
    if (!form.name.trim()) return setError('Enter the title.');
    if (programmes.some(x => x.id !== p?.id && titleKey(x.name) === titleKey(name) && programmesFor([x], kind).length)) return setError('This title is already in the list.');
    const wasApproved = programmeStatus(p) === 'approved';
    if (staff && form.hrdcStatus === 'approved' && !form.approvedDate && !wasApproved) return setError('Enter the date HRDC approved it.');
    const days = String(form.days || '').trim() ? Number(form.days) : 0;
    if (staff && String(form.days || '').trim() && !(days > 0 && days <= 60 && Number.isInteger(days * 2))) return setError('Number of days: a whole or half number, e.g. 1, 2 or 0.5.');
    const mine = { category: form.category.trim(), tags: [...new Set(form.tags.map(normTag).filter(Boolean))], updatedAt: Date.now(), updatedById: viewer.id, updatedByName: viewer.name };
    const theirs = staff ? {
      // Kept only once chosen here; until then the title follows its outlines' type.
      ...(kind === 'training' && (p?.skillType || form.skillType !== startType) ? { skillType: form.skillType } : {}),
      days: days || null, hrdcStatus: form.hrdcStatus, hrdcCode: form.hrdcCode.trim(),
      submittedDate: form.hrdcStatus === 'not_registered' ? '' : form.submittedDate,
      approvedDate: form.hrdcStatus === 'approved' ? form.approvedDate : '', notes: form.notes.trim(),
    } : {};
    setBusy(true);
    setError('');
    try {
      if (!p) {
        // Only typed on documents so far: make its record now (a rep's starts not registered).
        await createTitle(kind, staff ? name : group.name, viewer, { ...mine, ...theirs, ...(staff ? {} : { hrdcStatus: 'not_registered' }) } as any);
      } else if (!staff) {
        await updateDoc(doc(db, 'programmes', p.id), mine);
      } else {
        await setDoc(doc(db, 'programmes', p.id), { ...mine, ...theirs, name }, { merge: true });
        if (p.name !== name) await afterRename(docWord, p, name, programmes, deals, docs);
      }
      formDraft.clear();
      onClose();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!p) return;
    const nd = usedOn, nt = trainers.filter(t => (t.programmeIds || []).includes(p.id)).length;
    if (viewer.role !== 'management') {
      if (nd) return setError(`"${p.name}" is used on ${plural(nd, 'deal')}, so it can't be deleted.`);
      if (group.docs.length) return setError(`"${p.name}" has ${plural(group.docs.length, docWord === 'proposal' ? 'proposal' : 'course outline')}, so it can't be deleted.`);
    }
    const parts = [nd ? plural(nd, 'deal') : '', group.docs.length ? plural(group.docs.length, docWord) : '', nt ? plural(nt, 'trainer') : ''].filter(Boolean);
    if (!window.confirm(`Delete the title "${p.name}" from the list?${parts.length ? ` It is used on ${parts.join(', ')}; the name stays on them as typed text, and it is unticked for the trainers.` : ''} Its HRDC details go with it. This can't be undone.`)) return;
    try {
      if (viewer.role === 'management') await deleteProgrammeEverywhere(p, viewer);
      else {
        const teach = trainers.filter(t => (t.programmeIds || []).includes(p.id));
        if (teach.length) {
          const batch = writeBatch(db);
          teach.forEach(t => batch.update(doc(db, 'trainers_directory', t.id), { programmeIds: (t.programmeIds || []).filter((x: string) => x !== p.id) }));
          await batch.commit();
        }
        await deleteDoc(doc(db, 'programmes', p.id));
      }
      onClose();
    } catch (err) {
      setError(friendlyError(err));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" role="dialog" aria-modal="true" onClick={onClose}>
      <PanelResizer />
      <div className="h-full w-full md:w-[var(--panel-w,max(50vw,40rem))] md:min-w-[24rem] md:max-w-[95vw] overflow-y-auto bg-white p-6 font-sans text-ink shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-lg font-bold">{group.name}</h3>
            <p className="text-sm text-ink-soft">{[plural(group.docs.length, docWord), p ? plural(usedOn, 'deal') : 'Not in the list yet: saving adds it'].join(' · ')}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-ink-soft hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <form onSubmit={save} className="space-y-4">
          <DraftBar draft={formDraft} what="change to this title" />
          {staff && (
            <div>
              <label htmlFor="tt-name" className={label}>Title</label>
              <input id="tt-name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={input} />
              {p && form.name.trim() !== p.name && <p className="mt-1 text-sm text-attention">Renaming changes it on every deal and on draft {docWord}s with this title. Sent ones keep what was sent.</p>}
            </div>
          )}
          <div>
            <label htmlFor="tt-cat" className={label}>Category</label>
            <CategoryPicker id="tt-cat" value={form.category} categories={categories} onChange={v => setForm(f => ({ ...f, category: v }))} />
          </div>
          <div>
            <label htmlFor="tt-tags" className={label}>#Tags <span className="font-normal text-ink-soft">(for finding it later)</span></label>
            <TagInput id="tt-tags" tags={form.tags} allTags={tagList} onChange={t => setForm(f => ({ ...f, tags: t }))} />
          </div>

          {kind === 'training' && (
            <div>
              <span className={label}>Type</span>
              {staff ? (
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Type">
                  {(['soft', 'technical'] as const).map(t => (
                    <button key={t} type="button" role="radio" aria-checked={form.skillType === t} onClick={() => setForm(f => ({ ...f, skillType: t }))}
                      className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${form.skillType === t ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-white text-ink hover:bg-surface'}`}>
                      {TYPE_TAB_LABELS[t]}
                    </button>
                  ))}
                </div>
              ) : <p className="text-[15px]">{TYPE_TAB_LABELS[form.skillType]} <span className="text-sm text-ink-soft">(set by Admin, or by the type of its course outlines)</span></p>}
            </div>
          )}

          {staff ? (
            <>
              <div>
                <label htmlFor="tt-days" className={label}>Usual number of days <span className="font-normal text-ink-soft">(optional)</span></label>
                <input id="tt-days" inputMode="decimal" value={form.days} onChange={e => setForm(f => ({ ...f, days: e.target.value }))} className={`${input} sm:w-40`} placeholder="e.g. 1 or 0.5" />
              </div>
              <div>
                <span className={label}>HRDC registration</span>
                <div className="grid gap-2">
                  {(Object.keys(HRDC_STATUS_LABELS) as HrdcStatus[]).map(st => (
                    <label key={st} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold ${form.hrdcStatus === st ? 'border-accent bg-accent-soft text-accent' : 'border-line hover:bg-surface'}`}>
                      <input type="radio" name="tt-status" checked={form.hrdcStatus === st} onChange={() => setStatus(st)} className="accent-[#0E6E62]" />
                      {HRDC_STATUS_LABELS[st]}
                    </label>
                  ))}
                </div>
              </div>
              {form.hrdcStatus !== 'not_registered' && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="tt-sub" className={label}>Submitted on</label>
                    <input id="tt-sub" type="date" value={form.submittedDate} onChange={e => setForm(f => ({ ...f, submittedDate: e.target.value }))} className={input} />
                  </div>
                  {form.hrdcStatus === 'approved' && (
                    <div>
                      <label htmlFor="tt-app" className={label}>Approved on</label>
                      <input id="tt-app" type="date" value={form.approvedDate} onChange={e => setForm(f => ({ ...f, approvedDate: e.target.value }))} className={input} />
                    </div>
                  )}
                </div>
              )}
              <div>
                <label htmlFor="tt-code" className={label}>HRDC programme code</label>
                <input id="tt-code" value={form.hrdcCode} onChange={e => setForm(f => ({ ...f, hrdcCode: e.target.value }))} className={input} placeholder="From the HRDC portal, once given" />
              </div>
              {p && <ProgrammeLinks programme={p} programmes={programmes} outlines={outlines} deals={deals} trainers={trainers} viewer={viewer} />}
              <div>
                <label htmlFor="tt-notes" className={label}>Notes</label>
                <textarea id="tt-notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className={`${input} min-h-[80px]`} />
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-line p-3 text-[15px]">
              <p className="flex flex-wrap items-center gap-2"><span className="font-semibold">HRDC:</span> {p ? <StatusChip programme={p} /> : 'Not registered'}{p?.hrdcCode && <span className="text-ink-soft">Code {p.hrdcCode}</span>}</p>
              <p className="mt-1 text-sm text-ink-soft">Admin and Management update the HRDC registration and rename titles.</p>
              {p && <ProgrammeLinkedInfo programme={p} programmes={programmes} />}
            </div>
          )}

          {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</p>}
          <div className="flex flex-wrap justify-between gap-2 pt-1">
            {staff && p ? <button type="button" className={`${btnSecondary} text-danger hover:bg-danger-soft`} onClick={remove}><Trash2 className="h-4 w-4" /> Delete title</button> : <span />}
            <span className="flex gap-2">
              <button type="button" className={btnSecondary} onClick={onClose}>Cancel</button>
              <button type="submit" disabled={busy} className={btnPrimary}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save</button>
            </span>
          </div>
        </form>
      </div>
    </div>
  );
}

// After a rename: deals keep a copy of the name for older screens; draft documents that carried the old title as
// typed text are linked (outlines) or retitled (proposals), so they stay under it.
async function afterRename(docWord: 'outline' | 'proposal', p: Programme, name: string, programmes: Programme[], deals: any[], docs: TitleDoc[]) {
  const linked = deals.filter(d => d.programmeId === p.id);
  for (let i = 0; i < linked.length; i += 400) {
    const batch = writeBatch(db);
    linked.slice(i, i + 400).forEach(d => batch.update(doc(db, 'pipelines', d.id), { courseName: name }));
    await batch.commit();
  }
  const oldKey = titleKey(p.name);
  const drafts = docs.filter(d => !d.sent && titleKey(d.title) === oldKey);
  for (const d of drafts) {
    if (docWord === 'proposal') await updateDoc(doc(db, 'teambuilding_proposals', d.id), { title: name, programmeId: p.id }).catch(() => {});
    else if (d.raw.programmeId !== p.id) await linkOutline(d.raw, p.id, programmes).catch(() => {});   // the old name still matches, so it follows the new one
  }
}
