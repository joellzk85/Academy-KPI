import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useCloseOnOutside } from '../lib/useCloseOnOutside';
import { collection, deleteDoc, doc, onSnapshot, query, setDoc, writeBatch } from 'firebase/firestore';
import { linkedOnly } from '../lib/linked';
import { deleteProgrammeEverywhere } from '../lib/detach';
import { outlineProgrammeId } from '../lib/outlineResolve';
import { Loader2, Plus, Search, Trash2, X } from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import { useFormDraft } from '../lib/useFormDraft';
import DraftBar from './DraftBar';
import { formatDate, todayIso } from '../lib/deals';
import { HRDC_STATUS_LABELS, HRDC_STATUS_SHORT, HrdcStatus, Programme, programmeStatus } from '../lib/programmes';

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const label = 'mb-1.5 block text-sm font-semibold text-ink';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';

export const STATUS_TONE: Record<HrdcStatus, string> = {
  not_registered: 'bg-surface text-ink-soft',
  submitted: 'bg-attention-soft text-attention',
  approved: 'bg-accent-soft text-accent',
};

export function StatusChip({ programme }: { programme: any }) {
  const st = programmeStatus(programme);
  return <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[st]}`}>{HRDC_STATUS_SHORT[st]}</span>;
}

// ---------- Picker used on the deal form, with quick add ----------
export function ProgrammePicker({ programmes, value, legacyName, viewer, onChange }: {
  programmes: Programme[]; value: string; legacyName?: string; viewer: Viewer; onChange: (p: Programme) => void;
}) {
  const selected = programmes.find(p => p.id === value);
  const [queryText, setQueryText] = useState(selected ? '' : legacyName || '');
  const [open, setOpen] = useState(!selected && !!legacyName);
  const boxRef = useRef<HTMLDivElement>(null);
  useCloseOnOutside(boxRef, open, () => setOpen(false));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const q = queryText.trim().toLowerCase();
  const matches = (q ? programmes.filter(p => `${p.name} ${p.hrdcCode || ''}`.toLowerCase().includes(q)) : programmes)
    .slice()
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .slice(0, 8);

  const add = async () => {
    const name = queryText.trim();
    if (!name) return setErr('Type the programme name first.');
    const dup = programmes.find(p => p.name.trim().toLowerCase() === name.toLowerCase());
    if (dup) { onChange(dup); setOpen(false); return; }
    setBusy(true);
    setErr('');
    try {
      const id = `prog_${Date.now()}`;
      const data = { id, name, hrdcStatus: 'not_registered' as HrdcStatus, hrdcCode: '', submittedDate: '', approvedDate: '', notes: '', createdAt: Date.now(), createdById: viewer.id, createdByName: viewer.name };
      await setDoc(doc(db, 'programmes', id), data);
      onChange(data);
      setOpen(false);
      setQueryText('');
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  if (selected && !open) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-white px-3 py-2">
        <span className="min-w-0">
          <span className="block truncate font-semibold">{selected.name}</span>
          <span className="mt-0.5 flex items-center gap-2 text-sm text-ink-soft"><StatusChip programme={selected} />{selected.hrdcCode && <span>Code {selected.hrdcCode}</span>}</span>
        </span>
        <button type="button" className="text-sm font-semibold text-accent hover:underline" onClick={() => { setOpen(true); setQueryText(''); }}>Change</button>
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative">
      <Search className="pointer-events-none absolute left-3 top-[19px] h-4 w-4 -translate-y-1/2 text-ink-soft" />
      <input
        value={queryText}
        onChange={e => { setQueryText(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        className={`${input} pl-9`}
        placeholder="Search the programme list"
        aria-label="Search the programme list"
      />
      {open && (
        <div className="mt-1 overflow-hidden rounded-lg border border-line bg-white shadow-lg">
          {matches.map(p => (
            <button key={p.id} type="button" onClick={() => { onChange(p); setOpen(false); }} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-surface">
              <span className="min-w-0 truncate text-sm font-semibold">{p.name}</span>
              <StatusChip programme={p} />
            </button>
          ))}
          {matches.length === 0 && <p className="px-3 py-2 text-sm text-ink-soft">No programme matches "{queryText}".</p>}
          <button type="button" disabled={busy} onClick={add} className="flex w-full items-center gap-2 border-t border-line px-3 py-2.5 text-left text-sm font-semibold text-accent hover:bg-accent-soft">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add {queryText.trim() ? `"${queryText.trim()}"` : 'a new programme'}
          </button>
        </div>
      )}
      {err && <p role="alert" className="mt-1.5 text-sm text-danger">{err}</p>}
    </div>
  );
}

// ---------- Programme list (Admin work → Programmes) ----------
type Filter = 'all' | HrdcStatus;

const emptyForm = () => ({ name: '', category: '', days: '', hrdcStatus: 'not_registered' as HrdcStatus, hrdcCode: '', submittedDate: '', approvedDate: '', notes: '' });
const daysText = (d?: number | null) => (d ? (d === 0.5 ? 'Half day' : `${d} day${d === 1 ? '' : 's'}`) : '');

export default function ProgrammesManager({ programmes, deals, viewer }: { programmes: Programme[]; deals: any[]; viewer: Viewer }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [category, setCategory] = useState('');   // '' = all, '-' = no category
  const categories = useMemo(() => [...new Set(programmes.map(p => (p.category || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [programmes]);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<'new' | string | null>(null);
  const [form, setForm] = useState(emptyForm());
  // An unfinished new programme or edit is kept in this browser until it's saved (lib/useFormDraft.ts).
  const formDraft = useFormDraft(viewer.id, editing ? `programme:${editing}` : null, form, setForm);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const usage = useMemo(() => {
    const m: Record<string, number> = {};
    deals.forEach(d => { if (d.programmeId) m[d.programmeId] = (m[d.programmeId] || 0) + 1; });
    return m;
  }, [deals]);

  // Programmes, course outlines and trainers belong together (Joel, 2026-10-17): each programme shows its
  // outlines (the outline's own programme, else its deal's) and the trainers who teach it.
  const [outlines, setOutlines] = useState<any[]>([]);
  const [trainers, setTrainers] = useState<any[]>([]);
  useEffect(() => {
    const subs = [
      onSnapshot(query(collection(db, 'course_outlines')), s => setOutlines(linkedOnly(s.docs.map(d => ({ ...d.data(), id: d.id })))), () => setOutlines([])),
      onSnapshot(query(collection(db, 'trainers_directory')), s => setTrainers(s.docs.map(d => ({ ...d.data(), id: d.id }))), () => setTrainers([])),
    ];
    return () => subs.forEach(u => u());
  }, []);
  const outlinesOf = (id: string) => outlines.filter(o => !o.isHidden && o.id !== 'outline_default'
    && outlineProgrammeId(o, o.pipelineId ? deals.find(d => d.id === o.pipelineId) || null : null) === id);
  const trainersOf = (id: string) => trainers.filter(t => (t.programmeIds || []).includes(id)).sort((a, b) => String(a.name).localeCompare(String(b.name)));

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: programmes.length, not_registered: 0, submitted: 0, approved: 0 };
    programmes.forEach(p => { c[programmeStatus(p)]++; });
    return c;
  }, [programmes]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return programmes
      .filter(p => filter === 'all' || programmeStatus(p) === filter)
      .filter(p => !category || (category === '-' ? !(p.category || '').trim() : (p.category || '').trim() === category))
      .filter(p => !q || `${p.name} ${p.hrdcCode || ''} ${p.category || ''}`.toLowerCase().includes(q))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }, [programmes, filter, search, category]);

  const startNew = () => { setForm(emptyForm()); setError(''); setEditing('new'); };
  const startEdit = (p: Programme) => {
    setForm({ name: p.name, category: p.category || '', days: p.days ? String(p.days) : '', hrdcStatus: programmeStatus(p), hrdcCode: p.hrdcCode || '', submittedDate: p.submittedDate || '', approvedDate: p.approvedDate || '', notes: p.notes || '' });
    setError('');
    setEditing(p.id);
  };

  const setStatus = (st: HrdcStatus) => setForm(f => ({
    ...f,
    hrdcStatus: st,
    submittedDate: st !== 'not_registered' && !f.submittedDate ? todayIso() : f.submittedDate,
    approvedDate: st === 'approved' && !f.approvedDate ? todayIso() : f.approvedDate,
  }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) return setError('Enter the programme name.');
    if (programmes.some(p => p.id !== editing && p.name.trim().toLowerCase() === name.toLowerCase())) return setError('A programme with this name is already in the list.');
    // The approval date is asked for when a programme becomes approved here; ones imported as approved may not have it.
    const wasApproved = editing !== 'new' && programmeStatus(programmes.find(p => p.id === editing)) === 'approved';
    if (form.hrdcStatus === 'approved' && !form.approvedDate && !wasApproved) return setError('Enter the date HRDC approved it.');
    const days = String(form.days || '').trim() ? Number(form.days) : 0;
    if (String(form.days || '').trim() && !(days > 0 && days <= 60 && Number.isInteger(days * 2))) return setError('Number of days: a whole or half number, e.g. 1, 2 or 0.5.');
    setBusy(true);
    setError('');
    try {
      const id = editing && editing !== 'new' ? editing : `prog_${Date.now()}`;
      const data: any = {
        id, name, category: String(form.category || '').trim(), days: days || null, hrdcStatus: form.hrdcStatus, hrdcCode: form.hrdcCode.trim(),
        submittedDate: form.hrdcStatus === 'not_registered' ? '' : form.submittedDate,
        approvedDate: form.hrdcStatus === 'approved' ? form.approvedDate : '',
        notes: form.notes.trim(), updatedAt: Date.now(), updatedById: viewer.id, updatedByName: viewer.name,
      };
      if (editing === 'new') Object.assign(data, { createdAt: Date.now(), createdById: viewer.id, createdByName: viewer.name });
      await setDoc(doc(db, 'programmes', id), data, { merge: true });
      // Deals keep a copy of the name for older screens; keep it in step after a rename.
      const before = programmes.find(p => p.id === id);
      const linked = before && before.name !== name ? deals.filter(d => d.programmeId === id) : [];
      for (let i = 0; i < linked.length; i += 400) {
        const batch = writeBatch(db);
        linked.slice(i, i + 400).forEach(d => batch.update(doc(db, 'pipelines', d.id), { courseName: name }));
        await batch.commit();
      }
      formDraft.clear();
      setEditing(null);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: Programme) => {
    // Management can delete a programme in use (Joel, 2026-10-20): its name is kept on the deals,
    // quotations and course outlines as typed text. Admin still can't while it's in use.
    if (viewer.role === 'management') {
      const nd = usage[p.id] || 0, no = outlinesOf(p.id).length, nt = trainersOf(p.id).length;
      const parts = [nd ? `${nd} deal${nd === 1 ? '' : 's'}` : '', no ? `${no} course outline${no === 1 ? '' : 's'}` : '', nt ? `${nt} trainer${nt === 1 ? '' : 's'}` : ''].filter(Boolean);
      const used = parts.length ? ` It is used on ${parts.join(', ')}; the name is kept on deals, quotations and outlines as typed text, and it is unticked for the trainers.` : '';
      if (!window.confirm(`Delete "${p.name}" from the programme list?${used} This can't be undone.`)) return;
      try {
        await deleteProgrammeEverywhere(p, viewer);
        setEditing(null);
      } catch (err) {
        setError(friendlyError(err));
      }
      return;
    }
    if (usage[p.id]) return setError(`"${p.name}" is used on ${usage[p.id]} deal${usage[p.id] === 1 ? '' : 's'}, so it can't be deleted.`);
    const nOut = outlinesOf(p.id).length;
    if (nOut) return setError(`"${p.name}" has ${nOut} course outline${nOut === 1 ? '' : 's'}, so it can't be deleted. Change their programme first.`);
    const teachers = trainersOf(p.id);
    if (!window.confirm(`Delete "${p.name}" from the programme list?${teachers.length ? ` It will also be unticked for ${teachers.length} trainer${teachers.length === 1 ? '' : 's'} (${teachers.map(t => t.name).join(', ')}).` : ''}`)) return;
    try {
      if (teachers.length) {
        const batch = writeBatch(db);
        teachers.forEach(t => batch.update(doc(db, 'trainers_directory', t.id), { programmeIds: (t.programmeIds || []).filter((x: string) => x !== p.id) }));
        await batch.commit();
      }
      await deleteDoc(doc(db, 'programmes', p.id));
      setEditing(null);
    } catch (err) {
      setError(friendlyError(err));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-2xl text-[15px] text-ink-soft">
          Every programme you run, typed once. New programmes must be registered and approved in the HRDC portal before an HRDC-funded deal can use them for a grant.
        </p>
        <button type="button" onClick={startNew} className={btnPrimary}><Plus className="h-4 w-4" /> New programme</button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="tablist" aria-label="Filter programmes">
        {([['all', 'All programmes'], ['submitted', 'Waiting on HRDC'], ['not_registered', 'Not registered'], ['approved', 'HRDC approved']] as const).map(([k, t]) => {
          const active = filter === k;
          return (
            <button key={k} type="button" role="tab" aria-selected={active} onClick={() => setFilter(k)}
              className={`rounded-xl border px-3.5 py-3 text-left transition-colors ${active ? 'border-accent bg-accent-soft' : 'border-line bg-white hover:bg-surface'}`}>
              <span className={`block text-sm font-semibold ${k === 'submitted' && counts.submitted ? 'text-attention' : 'text-ink-soft'}`}>{t}</span>
              <span className="mt-1 block text-2xl font-bold leading-none">{counts[k]}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, HRDC code or category" className={`${input} pl-9`} aria-label="Search programmes" />
        </div>
        {categories.length > 0 && (
          <select value={category} onChange={e => setCategory(e.target.value)} aria-label="Category" className="w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] focus:border-accent focus:outline-none sm:w-auto">
            <option value="">All categories</option>
            {categories.map(c => <option key={c} value={c}>{c} ({programmes.filter(p => (p.category || '').trim() === c).length})</option>)}
            <option value="-">No category</option>
          </select>
        )}
      </div>

      {error && !editing && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</p>}

      <div className="overflow-hidden rounded-2xl border border-line bg-white">
        {visible.length === 0 ? (
          <div className="p-8 text-center">
            <p className="font-semibold">{programmes.length === 0 ? 'No programmes yet' : 'No programmes here'}</p>
            {programmes.length === 0 && <p className="mt-1 text-[15px] text-ink-soft">Add your programmes here, or pick "Add" when choosing a programme on a deal.</p>}
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {visible.map(p => {
              const st = programmeStatus(p);
              return (
                <li key={p.id}>
                  <button type="button" onClick={() => startEdit(p)} className="flex w-full flex-col gap-1.5 px-5 py-3.5 text-left hover:bg-surface sm:flex-row sm:items-center sm:gap-4">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{p.name}</span>
                      <span className="block truncate text-sm text-ink-soft">
                        {[p.category, daysText(p.days)].filter(Boolean).map(x => `${x} · `).join('')}{p.hrdcCode ? `HRDC code ${p.hrdcCode}` : 'No HRDC code'} · {usage[p.id] || 0} deal{usage[p.id] === 1 ? '' : 's'} · {outlinesOf(p.id).length} outline{outlinesOf(p.id).length === 1 ? '' : 's'} · {trainersOf(p.id).length} trainer{trainersOf(p.id).length === 1 ? '' : 's'}
                      </span>
                    </span>
                    <span className="flex items-center gap-2 text-sm text-ink-soft sm:w-64 sm:justify-end">
                      {st === 'submitted' && p.submittedDate && <span>since {formatDate(p.submittedDate)}</span>}
                      {st === 'approved' && p.approvedDate && <span>{formatDate(p.approvedDate)}</span>}
                      <StatusChip programme={p} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" role="dialog" aria-modal="true" onClick={() => setEditing(null)}>
          <div className="h-full w-full md:w-1/2 md:min-w-[40rem] overflow-y-auto bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="mb-5 flex items-start justify-between gap-4">
              <h3 className="text-lg font-bold">{editing === 'new' ? 'New programme' : 'Edit programme'}</h3>
              <button type="button" onClick={() => setEditing(null)} className="rounded-md p-1 text-ink-soft hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={save} className="space-y-4">
              <DraftBar draft={formDraft} what={editing === 'new' ? 'new programme' : 'change to this programme'} />
              <div>
                <label htmlFor="pg-name" className={label}>Programme name</label>
                <input id="pg-name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={input} placeholder="Leadership for new managers" />
              </div>
              <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
                <div>
                  <label htmlFor="pg-cat" className={label}>Category <span className="font-normal text-ink-soft">(optional)</span></label>
                  <input id="pg-cat" list="pg-cats" value={form.category || ""} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className={input} placeholder="e.g. Leadership & Professional Development" />
                  <datalist id="pg-cats">{categories.map(c => <option key={c} value={c} />)}</datalist>
                </div>
                <div>
                  <label htmlFor="pg-days" className={label}>Number of days <span className="font-normal text-ink-soft">(optional)</span></label>
                  <input id="pg-days" inputMode="decimal" value={form.days || ""} onChange={e => setForm(f => ({ ...f, days: e.target.value }))} className={input} placeholder="e.g. 1 or 0.5" />
                </div>
              </div>
              <div>
                <span className={label}>HRDC registration</span>
                <div className="grid gap-2">
                  {(Object.keys(HRDC_STATUS_LABELS) as HrdcStatus[]).map(st => (
                    <label key={st} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold ${form.hrdcStatus === st ? 'border-accent bg-accent-soft text-accent' : 'border-line hover:bg-surface'}`}>
                      <input type="radio" name="pg-status" checked={form.hrdcStatus === st} onChange={() => setStatus(st)} className="accent-[#0E6E62]" />
                      {HRDC_STATUS_LABELS[st]}
                    </label>
                  ))}
                </div>
              </div>
              {form.hrdcStatus !== 'not_registered' && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="pg-sub" className={label}>Submitted on</label>
                    <input id="pg-sub" type="date" value={form.submittedDate} onChange={e => setForm(f => ({ ...f, submittedDate: e.target.value }))} className={input} />
                  </div>
                  {form.hrdcStatus === 'approved' && (
                    <div>
                      <label htmlFor="pg-app" className={label}>Approved on</label>
                      <input id="pg-app" type="date" value={form.approvedDate} onChange={e => setForm(f => ({ ...f, approvedDate: e.target.value }))} className={input} />
                    </div>
                  )}
                </div>
              )}
              <div>
                <label htmlFor="pg-code" className={label}>HRDC programme code</label>
                <input id="pg-code" value={form.hrdcCode} onChange={e => setForm(f => ({ ...f, hrdcCode: e.target.value }))} className={input} placeholder="From the HRDC portal, once given" />
              </div>
              {editing !== 'new' && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-xl border border-line p-3">
                    <p className="text-sm font-semibold text-ink-soft">Course outlines</p>
                    {outlinesOf(editing).length === 0 ? <p className="mt-1 text-sm text-ink-soft">None yet. Create one in Course outlines and choose this programme.</p> : (
                      <ul className="mt-1 space-y-1 text-[15px]">
                        {outlinesOf(editing).map(o => <li key={o.id}>{o.refNumber || 'Outline'} <span className="text-sm text-ink-soft">· {o.status === 'sent' ? 'Sent' : 'Draft'}{o.preparedForCompany ? ` · ${o.preparedForCompany}` : ''}</span></li>)}
                      </ul>
                    )}
                  </div>
                  <div className="rounded-xl border border-line p-3">
                    <p className="text-sm font-semibold text-ink-soft">Trainers who teach it</p>
                    {trainersOf(editing).length === 0 ? <p className="mt-1 text-sm text-ink-soft">None yet. Tick this programme on a trainer in Trainers.</p> : (
                      <ul className="mt-1 space-y-1 text-[15px]">
                        {trainersOf(editing).map(t => <li key={t.id}>{t.name}{t.status === 'On Leave' && <span className="text-sm text-attention"> · on leave</span>}</li>)}
                      </ul>
                    )}
                  </div>
                </div>
              )}
              <div>
                <label htmlFor="pg-notes" className={label}>Notes</label>
                <textarea id="pg-notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className={`${input} min-h-[80px]`} />
              </div>
              {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</p>}
              <div className="flex flex-wrap justify-between gap-2 pt-1">
                {editing !== 'new' ? (
                  <button type="button" className={`${btnSecondary} text-danger hover:bg-danger-soft`} onClick={() => { const p = programmes.find(x => x.id === editing); if (p) remove(p); }}>
                    <Trash2 className="h-4 w-4" /> Delete
                  </button>
                ) : <span />}
                <span className="flex gap-2">
                  <button type="button" className={btnSecondary} onClick={() => setEditing(null)}>Cancel</button>
                  <button type="submit" disabled={busy} className={btnPrimary}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save programme</button>
                </span>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
