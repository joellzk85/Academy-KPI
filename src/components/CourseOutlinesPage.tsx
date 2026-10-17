import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, query, setDoc } from 'firebase/firestore';
import {
  ArrowDown, ArrowLeft, ArrowUp, Copy, Download, Eye, EyeOff, FilePlus2, Link2, Loader2, Lock, MoreHorizontal, Pencil, Plus, Search, Send, Share2, Trash2, Unlock, Users, X,
} from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import { CourseOutline, CourseOutlineItem, Representative } from '../types';
import { STAGE_LABELS, dealOwnerId, dealStage, formatDate, todayIso } from '../lib/deals';
import { OutlineSources, dealProgrammeName, nextOutlineRef, outlineSent, resolveOutline } from '../lib/outlineResolve';
import CourseOutlineDocument from './CourseOutlineDocument';

// Course outlines (redesigned 2026-10-17, like quotations).
// An outline is made for a deal (or as a general outline with no client), starting blank or from a copy
// of an earlier outline, so a programme's modules are typed once and reused. While it's a draft, the
// company, course title (the deal's programme) and owner are read live (lib/outlineResolve.ts).
// "Mark as sent" locks a copy; "Revise" unlocks it. Sharing: teammates in sharedWithIds can edit the same outline.

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };
type Tab = 'client' | 'pipeline';

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15 disabled:bg-surface disabled:text-ink-soft';
const label = 'mb-1 block text-sm font-semibold text-ink';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';
const linkBtn = 'text-sm font-semibold text-accent hover:underline';
const iconBtn = 'rounded-md p-1.5 text-ink-soft hover:bg-surface hover:text-ink disabled:opacity-30';

const LEVELS: CourseOutline['level'][] = ['Beginner', 'Intermediate', 'Advanced'];
const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const newModule = (): CourseOutlineItem => ({ id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, no: 0, moduleTitle: '', topics: '', duration: '', methodology: '' });
const summary = (o: CourseOutline) => `${o.durationDays || 0} day${o.durationDays === 1 ? '' : 's'} · ${(o.items || []).length} module${(o.items || []).length === 1 ? '' : 's'}`;

export default function CourseOutlinesPage({ rep, reps, viewer, startDeal, onStartHandled, onOpenTab }: {
  rep: Representative; reps: Representative[]; viewer?: Viewer; key?: string;
  startDeal?: any | null;            // "Create outline" on a deal: go straight to "Start from" for it
  onStartHandled?: () => void;
  onOpenTab?: (tab: Tab) => void;
}) {
  const me: Viewer = viewer || { id: rep.id, name: rep.name, role: (rep.role as any) || 'rep' };
  const staff = me.role !== 'rep';
  const [outlines, setOutlines] = useState<CourseOutline[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [programmes, setProgrammes] = useState<any[]>([]);
  const [deals, setDeals] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState<{ o: CourseOutline; isNew: boolean } | null>(null);
  const [choosing, setChoosing] = useState<null | { step: 'deal' } | { step: 'start'; deal: any | null }>(null);

  useEffect(() => {
    const subs = [
      onSnapshot(query(collection(db, 'course_outlines')), s => { setOutlines(s.docs.map(d => ({ ...(d.data() as CourseOutline), id: d.id }))); setLoaded(true); }, () => setLoaded(true)),
      onSnapshot(query(collection(db, 'clients')), s => setClients(s.docs.map(d => ({ ...d.data(), id: d.id })))),
      onSnapshot(query(collection(db, 'programmes')), s => setProgrammes(s.docs.map(d => ({ ...d.data(), id: d.id })))),
      onSnapshot(query(collection(db, 'pipelines')), s => setDeals(s.docs.map(d => ({ ...d.data(), id: d.id })))),
    ];
    return () => subs.forEach(u => u());
  }, []);

  useEffect(() => {
    if (startDeal) { setDraft(null); setChoosing({ step: 'start', deal: startDeal }); onStartHandled?.(); }
  }, [startDeal]);

  const sources: OutlineSources = useMemo(() => ({ clients, deals, programmes, people: reps.map(r => ({ id: r.id, name: r.name })) }), [clients, deals, programmes, reps]);
  const personName = (id?: string) => reps.find(r => r.id === id)?.name || '';

  // Outlines often go out with the proposal, so any open or won deal can have one.
  const dealsForPicker = deals.filter(d => (staff && me.id === rep.id ? true : dealOwnerId(d) === rep.id) && dealStage(d) !== 'lost');

  const createFrom = (deal: any | null, base: CourseOutline | null) => {
    const date = todayIso();
    const ownerId = (deal && dealOwnerId(deal)) || rep.id;
    const content = base ? clean({
      courseTitle: base.courseTitle, durationDays: base.durationDays, totalHours: base.totalHours, category: base.category, level: base.level,
      audience: base.audience, prerequisites: base.prerequisites, overview: base.overview, outcomes: base.outcomes || [],
      items: (base.items || []).map(m => ({ ...m, id: newModule().id })),
    }) : {
      courseTitle: '', durationDays: 1, totalHours: 8, category: '', level: 'Beginner' as const, audience: '', prerequisites: '', overview: '',
      outcomes: [], items: [newModule()],
    };
    const o: CourseOutline = {
      ...content,
      id: `outline_${Date.now()}`, refNumber: nextOutlineRef(outlines, date), date,
      preparedBy: me.name, creatorId: me.id, ownerId, ownerName: personName(ownerId) || rep.name,
      clientId: deal?.clientId || '', pipelineId: deal?.id || '', preparedForCompany: '',
      useProgrammeName: !!deal && !!dealProgrammeName(deal, programmes),
      status: 'draft', sharedWithIds: [], isHidden: false,
    };
    setChoosing(null);
    setDraft({ o, isNew: true });
  };
  const open = (o: CourseOutline) => setDraft({ o: clean({ ...o, items: o.items || [], outcomes: o.outcomes || [] }), isNew: false });
  const duplicate = async (o: CourseOutline) => {
    const date = todayIso();
    const copy: CourseOutline = clean({
      ...o, id: `outline_${Date.now()}`, refNumber: nextOutlineRef(outlines, date), date, preparedBy: me.name, creatorId: me.id,
      status: 'draft', sentAt: '', sentById: '', sentByName: '', sharedWithIds: [], isHidden: false,
      taggedRepId: '', taggedRepName: '', taggedBy: '', tagNote: '', isCompleted: false,
    } as CourseOutline);
    await setDoc(doc(db, 'course_outlines', copy.id), copy);
    open(copy);
  };

  return (
    <>
      {draft ? (
        <Editor key={draft.o.id} initial={draft.o} isNew={draft.isNew} me={me} staff={staff} reps={reps} sources={sources}
          dealsForPicker={dealsForPicker} onOpenTab={onOpenTab} onClose={() => setDraft(null)} />
      ) : (
        <OutlineList rep={rep} me={me} staff={staff} outlines={outlines} loaded={loaded} sources={sources} personName={personName}
          onNew={() => setChoosing({ step: 'deal' })} onOpen={open} onDuplicate={duplicate} />
      )}
      {choosing?.step === 'deal' && (
        <DealChooser deals={dealsForPicker} sources={sources} personName={personName}
          onPick={deal => setChoosing({ step: 'start', deal })} onCancel={() => setChoosing(null)} allowGeneral />
      )}
      {choosing?.step === 'start' && (
        <StartChooser deal={choosing.deal} outlines={outlines} sources={sources}
          onPick={base => createFrom(choosing.deal, base)} onBack={() => setChoosing({ step: 'deal' })} onCancel={() => setChoosing(null)} />
      )}
    </>
  );
}

// ---------- Step 1: which deal ----------
function DealChooser({ deals, sources, personName, onPick, onCancel, allowGeneral, title = 'Which deal is this outline for?' }: {
  deals: any[]; sources: OutlineSources; personName: (id?: string) => string;
  onPick: (deal: any | null) => void; onCancel: () => void; allowGeneral?: boolean; title?: string;
}) {
  const [search, setSearch] = useState('');
  const clientName = (d: any) => sources.clients.find(c => c.id === d.clientId)?.companyName || d.client || 'No client';
  const t = search.trim().toLowerCase();
  const list = deals
    .filter(d => !t || `${clientName(d)} ${dealProgrammeName(d, sources.programmes)} ${personName(dealOwnerId(d))}`.toLowerCase().includes(t))
    .sort((a, b) => String(b.requestDate || b.id).localeCompare(String(a.requestDate || a.id)))
    .slice(0, 40);

  return (
    <Modal title={title} onCancel={onCancel}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
        <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search client, programme or rep" className={`${input} pl-9`} aria-label="Search deals" />
      </div>
      <ul className="mt-3 max-h-[50vh] divide-y divide-line overflow-y-auto rounded-xl border border-line">
        {list.length === 0 && <li className="p-4 text-ink-soft">No deals found.</li>}
        {list.map(d => (
          <li key={d.id}>
            <button type="button" onClick={() => onPick(d)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-surface">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{clientName(d)}</span>
                <span className="block truncate text-sm text-ink-soft">{dealProgrammeName(d, sources.programmes) || 'No programme'} · {personName(dealOwnerId(d))}</span>
              </span>
              <span className="shrink-0 text-sm text-ink-soft">{STAGE_LABELS[dealStage(d)]}</span>
            </button>
          </li>
        ))}
      </ul>
      {allowGeneral && (
        <button type="button" className={`${linkBtn} mt-3`} onClick={() => onPick(null)}>Make a general outline, not for a client</button>
      )}
    </Modal>
  );
}

// ---------- Step 2: start blank or from a copy ----------
function StartChooser({ deal, outlines, sources, onPick, onBack, onCancel }: {
  deal: any | null; outlines: CourseOutline[]; sources: OutlineSources;
  onPick: (base: CourseOutline | null) => void; onBack: () => void; onCancel: () => void;
}) {
  const [search, setSearch] = useState('');
  const progName = dealProgrammeName(deal, sources.programmes).toLowerCase();
  const resolved = useMemo(() => outlines.filter(o => o.id !== 'outline_default' && !o.isHidden).map(o => resolveOutline(o, sources)), [outlines, sources]);
  const sameProgramme = (r: ReturnType<typeof resolveOutline>) =>
    !!progName && ((!!deal?.programmeId && r.deal?.programmeId === deal.programmeId) || (r.o.courseTitle || '').trim().toLowerCase() === progName);
  const t = search.trim().toLowerCase();
  const list = resolved
    .filter(r => !t || `${r.o.courseTitle} ${r.o.preparedForCompany} ${r.o.refNumber}`.toLowerCase().includes(t))
    .sort((a, b) => Number(sameProgramme(b)) - Number(sameProgramme(a)) || String(b.o.date || '').localeCompare(String(a.o.date || '')))
    .slice(0, 40);
  const clientName = deal ? sources.clients.find(c => c.id === deal.clientId)?.companyName || deal.client || '' : '';

  return (
    <Modal title="Start from" onCancel={onCancel}>
      <p className="-mt-1 mb-3 text-[15px] text-ink-soft">{deal ? `For ${clientName || 'this deal'}${progName ? `, ${dealProgrammeName(deal, sources.programmes)}` : ''}` : 'General outline, not for a client'}</p>
      <button type="button" onClick={() => onPick(null)} className={`${btnSecondary} w-full justify-start`}><FilePlus2 className="h-4 w-4" /> Blank outline</button>
      <p className="mb-2 mt-4 text-sm font-semibold">Or copy an earlier outline{progName ? ' (same programme first)' : ''}</p>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search course title or client" className={`${input} pl-9`} aria-label="Search outlines" />
      </div>
      <ul className="mt-3 max-h-[40vh] divide-y divide-line overflow-y-auto rounded-xl border border-line">
        {list.length === 0 && <li className="p-4 text-ink-soft">No outlines to copy yet.</li>}
        {list.map(r => (
          <li key={r.o.id}>
            <button type="button" onClick={() => onPick(r.o)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-surface">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{r.o.courseTitle || 'Untitled'}{sameProgramme(r) && <span className="ml-2 rounded bg-accent-soft px-1.5 text-xs font-semibold text-accent">Same programme</span>}</span>
                <span className="block truncate text-sm text-ink-soft">{r.o.preparedForCompany || 'General'} · {r.o.refNumber} · {summary(r.o)}</span>
              </span>
              <Copy className="h-4 w-4 shrink-0 text-ink-soft" />
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className={`${linkBtn} mt-3`} onClick={onBack}>Choose a different deal</button>
    </Modal>
  );
}

function Modal({ title, onCancel, children }: { title: string; onCancel: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4 pt-16" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="w-full max-w-2xl rounded-2xl bg-white p-5 font-sans text-ink shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <h3 className="text-lg font-bold">{title}</h3>
          <button type="button" onClick={onCancel} className="rounded-md p-1 text-ink-soft hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------- List ----------
type Scope = 'mine' | 'shared' | 'everyone';

function OutlineList({ rep, me, staff, outlines, loaded, sources, personName, onNew, onOpen, onDuplicate }: {
  rep: Representative; me: Viewer; staff: boolean; outlines: CourseOutline[]; loaded: boolean; sources: OutlineSources; personName: (id?: string) => string;
  onNew: () => void; onOpen: (o: CourseOutline) => void; onDuplicate: (o: CourseOutline) => Promise<void>;
}) {
  const canSeeEveryone = staff && me.id === rep.id;
  const [scope, setScope] = useState<Scope>(canSeeEveryone ? 'everyone' : 'mine');
  const [search, setSearch] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [error, setError] = useState('');

  const resolved = useMemo(() => outlines.map(o => ({ raw: o, r: resolveOutline(o, sources) })), [outlines, sources]);
  const isMine = (x: { raw: CourseOutline; r: { ownerId: string } }) => x.r.ownerId === rep.id || x.raw.creatorId === rep.id || (!x.raw.creatorId && !x.raw.ownerId && !!x.raw.preparedBy && x.raw.preparedBy === rep.name);
  const isShared = (o: CourseOutline) => (o.sharedWithIds || []).includes(rep.id) || o.taggedRepId === rep.id;
  const counts = { mine: resolved.filter(isMine).length, shared: resolved.filter(x => !isMine(x) && isShared(x.raw)).length };

  const visible = useMemo(() => {
    const t = search.trim().toLowerCase();
    return resolved
      .filter(x => x.raw.id !== 'outline_default' && (scope === 'everyone' ? true : scope === 'shared' ? !isMine(x) && isShared(x.raw) : isMine(x)))
      .filter(x => showHidden || !x.raw.isHidden)
      .filter(x => !t || `${x.r.o.refNumber} ${x.r.o.courseTitle} ${x.r.o.preparedForCompany}`.toLowerCase().includes(t))
      .sort((a, b) => String(b.raw.date || '').localeCompare(String(a.raw.date || '')) || String(b.raw.id).localeCompare(String(a.raw.id)));
  }, [resolved, scope, search, showHidden, rep.id]);

  const canDelete = (o: CourseOutline) => staff || o.creatorId === me.id || o.ownerId === me.id;
  const act = async (fn: () => Promise<void>) => { setMenu(null); setError(''); try { await fn(); } catch (e) { setError(friendlyError(e)); } };

  return (
    <div className="space-y-4 font-sans text-ink">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Course outlines</h2>
          <p className="mt-0.5 text-[15px] text-ink-soft">Click an outline to open it.</p>
        </div>
        <button type="button" className={btnPrimary} onClick={onNew}><Plus className="h-4 w-4" /> New outline</button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-line bg-white p-0.5">
          {([...(canSeeEveryone ? [['everyone', "Everyone's"]] : []), ['mine', `Mine (${counts.mine})`], ['shared', `Shared with me (${counts.shared})`]] as [Scope, string][]).map(([k, t]) => (
            <button key={k} type="button" onClick={() => setScope(k)} className={`rounded-md px-3 py-1.5 text-sm font-semibold ${scope === k ? 'bg-ink text-white' : 'text-ink-soft hover:text-ink'}`}>{t}</button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input type="checkbox" checked={showHidden} onChange={e => setShowHidden(e.target.checked)} className="h-4 w-4 accent-[#0E6E62]" /> Show hidden
        </label>
        <div className="relative ml-auto w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search ref, course or client" className={`${input} pl-9`} aria-label="Search outlines" />
        </div>
      </div>
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</p>}

      <div className="rounded-2xl border border-line bg-white">
        {!loaded ? (
          <p className="flex items-center gap-2 p-6 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading outlines…</p>
        ) : visible.length === 0 ? (
          <div className="p-8 text-center">
            <p className="font-semibold">No outlines here</p>
            <p className="mt-1 text-[15px] text-ink-soft">Create one with New outline, or from a deal (Deals → open a deal → Create outline).</p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {visible.map(({ raw: o, r }) => (
              <li key={o.id} className="relative flex items-center gap-2 px-4 hover:bg-surface">
                <button type="button" onClick={() => onOpen(o)} className="grid min-w-0 flex-1 gap-1 py-3 text-left sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_8rem] sm:items-center sm:gap-4">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{r.o.courseTitle || 'Untitled outline'}</span>
                    <span className="flex items-center gap-1.5 truncate text-sm text-ink-soft">
                      {o.refNumber}
                      {outlineSent(o) ? <span className="rounded bg-accent-soft px-1.5 text-xs font-semibold text-accent">Sent</span> : <span className="rounded bg-surface px-1.5 text-xs font-semibold">Draft</span>}
                      {o.isHidden && <span className="text-xs">hidden</span>}
                    </span>
                  </span>
                  <span className="min-w-0 text-[15px] text-ink-soft">
                    <span className="block truncate">{r.o.preparedForCompany || 'General'}</span>
                    <span className="block truncate text-sm">{summary(r.o)}</span>
                  </span>
                  <span className="text-sm text-ink-soft sm:text-right">
                    {formatDate(o.date) || '—'}
                    <span className="block truncate">{personName(r.ownerId) || o.preparedBy || ''}{(o.sharedWithIds || []).length ? ' · shared' : ''}</span>
                  </span>
                </button>
                <button type="button" onClick={() => setMenu(m => (m === o.id ? null : o.id))} className="rounded-md p-2 text-ink-soft hover:bg-white hover:text-ink" aria-label={`More for ${o.refNumber}`} aria-expanded={menu === o.id}>
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                {menu === o.id && (
                  <div role="menu" className="absolute right-4 top-12 z-20 w-48 overflow-hidden rounded-xl border border-line bg-white py-1 shadow-lg">
                    <MenuBtn icon={<Pencil className="h-4 w-4" />} text="Open" onClick={() => { setMenu(null); onOpen(o); }} />
                    <MenuBtn icon={<Copy className="h-4 w-4" />} text="Duplicate" onClick={() => act(() => onDuplicate(o))} />
                    <MenuBtn icon={o.isHidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />} text={o.isHidden ? 'Unhide' : 'Hide'}
                      onClick={() => act(() => setDoc(doc(db, 'course_outlines', o.id), { isHidden: !o.isHidden }, { merge: true }))} />
                    {canDelete(o) && (
                      <MenuBtn danger icon={<Trash2 className="h-4 w-4" />} text="Delete"
                        onClick={() => { if (window.confirm(`Delete outline ${o.refNumber}? This can't be undone.`)) act(() => deleteDoc(doc(db, 'course_outlines', o.id))); else setMenu(null); }} />
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function MenuBtn({ icon, text, onClick, danger }: { icon: React.ReactNode; text: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm font-medium ${danger ? 'text-danger hover:bg-danger-soft' : 'text-ink hover:bg-surface'}`}>
      {icon}{text}
    </button>
  );
}

// ---------- Editor ----------
function Editor({ initial, isNew, me, staff, reps, sources, dealsForPicker, onOpenTab, onClose }: {
  initial: CourseOutline; isNew: boolean; me: Viewer; staff: boolean; reps: Representative[]; sources: OutlineSources; dealsForPicker: any[];
  onOpenTab?: (tab: Tab) => void; onClose: () => void; key?: string;
}) {
  const [o, setO] = useState<CourseOutline>(initial);
  const [saved, setSaved] = useState<string>(isNew ? '' : JSON.stringify(initial));
  const [preview, setPreview] = useState(false);
  const [editMeta, setEditMeta] = useState(false);
  const [relinking, setRelinking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const printAfterRender = useRef(false);

  const r = resolveOutline(o, sources);
  const shownO = r.o;                       // what prints
  const locked = outlineSent(o);
  const dirty = JSON.stringify(o) !== saved;
  const set = (c: Partial<CourseOutline>) => setO(x => ({ ...x, ...c }));
  const shared: string[] = o.sharedWithIds || [];
  const nameOf = (id?: string) => reps.find(p => p.id === id)?.name || '';
  const items = o.items || [];
  const clientName = r.client?.companyName || '';

  useEffect(() => {
    if (preview && printAfterRender.current) {
      printAfterRender.current = false;
      const t = document.title;
      document.title = o.refNumber || 'Course outline';
      window.setTimeout(() => { window.print(); document.title = t; }, 200);
    }
  }, [preview]);

  const persist = async (out: CourseOutline, msg: string) => {
    setBusy(true);
    setError('');
    try {
      const final = clean({
        ...out,
        outcomes: (out.outcomes || []).map(x => x.trim()).filter(Boolean),
        items: (out.items || []).map((m, i) => ({ ...m, no: i + 1 })),
      });
      await setDoc(doc(db, 'course_outlines', final.id), final);
      setO(final);
      setSaved(JSON.stringify(final));
      setNote(msg);
      window.setTimeout(() => setNote(''), 2500);
      return true;
    } catch (e) {
      setError(friendlyError(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const save = () => persist(o, 'Saved');
  const markSent = () => {
    if (!shownO.courseTitle?.trim() && !window.confirm('This outline has no course title. Mark as sent anyway?')) return;
    return persist({ ...shownO, status: 'sent', sentAt: new Date().toISOString(), sentById: me.id, sentByName: me.name }, 'Marked as sent and locked');
  };
  const revise = () => {
    if (!window.confirm('Unlock this outline to revise it? It will read the latest deal and client details again.')) return;
    return persist({ ...o, status: 'draft', sentAt: '', sentById: '', sentByName: '' }, 'Unlocked for revision');
  };
  const close = () => { if (!dirty || window.confirm('You have unsaved changes. Leave without saving?')) onClose(); };
  const downloadPdf = () => { if (preview) window.print(); else { printAfterRender.current = true; setPreview(true); } };
  const relink = (deal: any | null) => {
    set(deal
      ? { pipelineId: deal.id, clientId: deal.clientId || '', useProgrammeName: !!dealProgrammeName(deal, sources.programmes) }
      : { pipelineId: '', clientId: '', useProgrammeName: false });
    setRelinking(false);
  };

  // Modules
  const setItem = (i: number, c: Partial<CourseOutlineItem>) => setO(x => ({ ...x, items: (x.items || []).map((m, k) => (k === i ? { ...m, ...c } : m)) }));
  const addItem = () => setO(x => ({ ...x, items: [...(x.items || []), newModule()] }));
  const removeItem = (i: number) => setO(x => ({ ...x, items: (x.items || []).filter((_, k) => k !== i) }));
  const moveItem = (i: number, dir: -1 | 1) => setO(x => {
    const list = [...(x.items || [])];
    const j = i + dir;
    if (j < 0 || j >= list.length) return x;
    [list[i], list[j]] = [list[j], list[i]];
    return { ...x, items: list };
  });

  if (preview) {
    return (
      <div className="space-y-4 font-sans text-ink">
        <div className="no-print flex flex-wrap items-center justify-between gap-2">
          <button type="button" className={btnSecondary} onClick={() => setPreview(false)}><ArrowLeft className="h-4 w-4" /> Back to edit</button>
          <span className="flex items-center gap-2">
            {dirty && <span className="text-sm text-attention">Not saved yet</span>}
            <button type="button" className={btnPrimary} onClick={() => window.print()}><Download className="h-4 w-4" /> Download PDF</button>
          </span>
        </div>
        <p className="no-print text-sm text-ink-soft">In the print window, choose "Save as PDF" as the printer.</p>
        <CourseOutlineDocument o={shownO} />
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-24 font-sans text-ink">
      {/* Top line */}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={btnSecondary} onClick={close}><ArrowLeft className="h-4 w-4" /> Course outlines</button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-bold">{shownO.courseTitle || 'New course outline'}</h2>
          <p className="text-sm text-ink-soft">
            {o.refNumber} · {formatDate(o.date)} · Prepared by {o.preparedBy || me.name}{r.ownerId ? ` · Owner ${nameOf(r.ownerId) || o.ownerName || ''}` : ''}
            {!locked && <> {' '}<button type="button" className={linkBtn} onClick={() => setEditMeta(v => !v)}>{editMeta ? 'Done' : 'Edit'}</button></>}
          </p>
        </div>
      </div>

      {locked && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-accent/30 bg-accent-soft p-4 text-accent">
          <Lock className="h-5 w-5" />
          <p className="min-w-0 flex-1 text-[15px]"><strong>Sent {formatDate(o.sentAt || '')}</strong> by {o.sentByName}. This is the locked copy the client received.</p>
          <button type="button" className={btnSecondary} onClick={revise}><Unlock className="h-4 w-4" /> Revise</button>
        </div>
      )}

      {!locked && editMeta && (
        <div className="grid gap-3 rounded-2xl border border-line bg-white p-4 sm:grid-cols-3">
          <div><label className={label} htmlFor="o-ref">Reference number</label><input id="o-ref" value={o.refNumber} onChange={e => set({ refNumber: e.target.value })} className={input} /></div>
          <div><label className={label} htmlFor="o-date">Date</label><input id="o-date" type="date" value={o.date} onChange={e => set({ date: e.target.value })} className={input} /></div>
          {staff && !r.deal && (
            <div>
              <label className={label} htmlFor="o-owner">Owner</label>
              <select id="o-owner" value={o.ownerId || ''} onChange={e => set({ ownerId: e.target.value, ownerName: nameOf(e.target.value) })} className={input}>
                {reps.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}
        </div>
      )}

      <fieldset disabled={locked} className="space-y-4">
        {/* 1. Deal and client */}
        <Card title="1. Deal and client" action={!locked && <button type="button" className={linkBtn} onClick={() => setRelinking(true)}><Link2 className="mr-1 inline h-4 w-4" />{r.deal ? 'Change' : 'Link a deal'}</button>}>
          {r.deal ? (
            <div className="rounded-xl bg-surface px-4 py-3">
              <p className="font-semibold">{clientName || r.deal.client || 'No client'}</p>
              <p className="text-sm text-ink-soft">
                {r.programmeName || 'No programme'} · {STAGE_LABELS[dealStage(r.deal)]} · {nameOf(dealOwnerId(r.deal))}
                {onOpenTab && <> · <button type="button" className={linkBtn} onClick={() => { if (!dirty || window.confirm('Leave this outline without saving?')) onOpenTab('pipeline'); }}>Edit deal</button></>}
              </p>
            </div>
          ) : r.client ? (
            <div className="rounded-xl bg-surface px-4 py-3">
              <p className="font-semibold">{clientName}</p>
              <p className="text-sm text-ink-soft">From the client list, not linked to a deal.</p>
            </div>
          ) : (
            <div>
              <label className={label} htmlFor="o-for">Prepared for <span className="font-normal text-ink-soft">(optional, for a general outline)</span></label>
              <input id="o-for" value={o.preparedForCompany || ''} onChange={e => set({ preparedForCompany: e.target.value })} className={input} placeholder="Leave blank for a general outline" />
            </div>
          )}
        </Card>

        {/* 2. Course details */}
        <Card title="2. Course details">
          <div className="space-y-3">
            <div>
              <label className={label} htmlFor="o-title">Course title</label>
              {o.useProgrammeName && r.programmeName ? (
                <div className="rounded-lg bg-surface px-3 py-2">
                  <p className="font-semibold">{r.programmeName}</p>
                  <p className="text-sm text-ink-soft">From the deal's programme. {!locked && <button type="button" className={linkBtn} onClick={() => set({ useProgrammeName: false, courseTitle: r.programmeName })}>Type a different title</button>}</p>
                </div>
              ) : (
                <>
                  <input id="o-title" value={o.courseTitle || ''} onChange={e => set({ courseTitle: e.target.value })} className={input} placeholder="e.g. Leadership Essentials for New Managers" />
                  {r.programmeName && !locked && <button type="button" className={`${linkBtn} mt-1`} onClick={() => set({ useProgrammeName: true })}>Use the deal's programme name ({r.programmeName})</button>}
                </>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              <div><label className={label} htmlFor="o-days">Days</label><input id="o-days" inputMode="decimal" value={o.durationDays ? String(o.durationDays) : ''} onChange={e => set({ durationDays: Number(e.target.value.replace(/[^0-9.]/g, '')) || 0 })} className={input} /></div>
              <div><label className={label} htmlFor="o-hours">Total hours</label><input id="o-hours" inputMode="decimal" value={o.totalHours ? String(o.totalHours) : ''} onChange={e => set({ totalHours: Number(e.target.value.replace(/[^0-9.]/g, '')) || 0 })} className={input} /></div>
              <div>
                <label className={label} htmlFor="o-level">Level</label>
                <select id="o-level" value={o.level || 'Beginner'} onChange={e => set({ level: e.target.value as CourseOutline['level'] })} className={input}>
                  {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              <div><label className={label} htmlFor="o-cat">Category</label><input id="o-cat" value={o.category || ''} onChange={e => set({ category: e.target.value })} className={input} placeholder="e.g. Leadership" /></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className={label} htmlFor="o-aud">Who it's for</label><input id="o-aud" value={o.audience || ''} onChange={e => set({ audience: e.target.value })} className={input} placeholder="e.g. Supervisors and team leaders" /></div>
              <div><label className={label} htmlFor="o-pre">Prerequisites</label><input id="o-pre" value={o.prerequisites || ''} onChange={e => set({ prerequisites: e.target.value })} className={input} placeholder="e.g. None" /></div>
            </div>
          </div>
        </Card>

        {/* 3. Overview and outcomes */}
        <Card title="3. Overview and learning outcomes">
          <div className="space-y-3">
            <div>
              <label className={label} htmlFor="o-over">Overview</label>
              <textarea id="o-over" value={o.overview || ''} onChange={e => set({ overview: e.target.value })} className={`${input} min-h-[110px]`} placeholder="A short summary of what the course covers and why it matters." />
            </div>
            <div>
              <label className={label} htmlFor="o-out">Learning outcomes (one per line)</label>
              <textarea id="o-out" value={(o.outcomes || []).join('\n')} onChange={e => set({ outcomes: e.target.value.split('\n') })} className={`${input} min-h-[110px]`} placeholder={'Participants will be able to…\n…'} />
            </div>
          </div>
        </Card>

        {/* 4. Modules */}
        <Card title={`4. Modules (${items.length})`}>
          <ol className="space-y-3">
            {items.map((m, i) => (
              <li key={m.id} className="rounded-xl border border-line p-3.5">
                <div className="flex items-start gap-3">
                  <span className="mt-2 w-6 shrink-0 text-center font-bold text-ink-soft">{i + 1}</span>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_8rem_minmax(0,1fr)]">
                      <input value={m.moduleTitle} onChange={e => setItem(i, { moduleTitle: e.target.value })} className={input} placeholder="Module title" aria-label={`Module ${i + 1} title`} />
                      <input value={m.duration} onChange={e => setItem(i, { duration: e.target.value })} className={input} placeholder="e.g. 3 hours" aria-label={`Module ${i + 1} duration`} />
                      <input value={m.methodology} onChange={e => setItem(i, { methodology: e.target.value })} className={input} placeholder="Method, e.g. Lecture & role play" aria-label={`Module ${i + 1} method`} />
                    </div>
                    <textarea value={m.topics} onChange={e => setItem(i, { topics: e.target.value })} className={`${input} min-h-[80px]`} placeholder={'Topics, one per line\n• …'} aria-label={`Module ${i + 1} topics`} />
                  </div>
                  {!locked && (
                    <span className="flex shrink-0 flex-col">
                      <button type="button" className={iconBtn} disabled={i === 0} onClick={() => moveItem(i, -1)} aria-label={`Move module ${i + 1} up`}><ArrowUp className="h-4 w-4" /></button>
                      <button type="button" className={iconBtn} disabled={i === items.length - 1} onClick={() => moveItem(i, 1)} aria-label={`Move module ${i + 1} down`}><ArrowDown className="h-4 w-4" /></button>
                      <button type="button" className={`${iconBtn} hover:text-danger`} onClick={() => removeItem(i)} aria-label={`Remove module ${i + 1}`}><X className="h-4 w-4" /></button>
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ol>
          {!locked && <button type="button" className={`${btnSecondary} mt-3`} onClick={addItem}><Plus className="h-4 w-4" /> Add module</button>}
        </Card>
      </fieldset>

      {/* 5. Sharing (allowed even when sent) */}
      <Card title="5. Share with teammates">
        <p className="mb-2 text-[15px] text-ink-soft">People you add can open and edit this same outline. It appears in their list under "Shared with me".</p>
        <div className="flex flex-wrap gap-2">
          {reps.filter(p => p.id !== r.ownerId).map(p => {
            const on = shared.includes(p.id);
            return (
              <button key={p.id} type="button" aria-pressed={on}
                onClick={() => set({ sharedWithIds: on ? shared.filter(x => x !== p.id) : [...shared, p.id] })}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium ${on ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-soft hover:bg-surface'}`}>
                {on ? <Users className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}{p.name}
              </button>
            );
          })}
        </div>
      </Card>

      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</p>}

      {/* Bottom bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3">
          <span className="text-[15px] font-semibold">{summary(shownO)}</span>
          <span className={`text-sm ${dirty ? 'text-attention' : 'text-ink-soft'}`}>{note || (dirty ? 'Not saved yet' : locked ? 'Sent and locked' : 'All changes saved')}</span>
          <span className="ml-auto flex flex-wrap gap-2">
            <button type="button" className={btnSecondary} onClick={() => setPreview(true)}><Eye className="h-4 w-4" /> Preview</button>
            <button type="button" className={btnSecondary} onClick={downloadPdf}><Download className="h-4 w-4" /> Download PDF</button>
            {!locked && <button type="button" className={btnSecondary} disabled={busy} onClick={markSent}><Send className="h-4 w-4" /> Mark as sent</button>}
            <button type="button" className={btnPrimary} disabled={busy || !dirty} onClick={save}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save</button>
          </span>
        </div>
      </div>

      {relinking && (
        <DealChooser deals={dealsForPicker} sources={sources} personName={nameOf} onPick={relink} onCancel={() => setRelinking(false)} allowGeneral title="Link this outline to a deal" />
      )}
    </div>
  );
}

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-white p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="font-bold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}
