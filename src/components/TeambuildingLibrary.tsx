import React, { useEffect, useMemo, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, query, setDoc } from 'firebase/firestore';
import { Archive, ArchiveRestore, Check, ImageOff, Loader2, Plus, Search, Trash2, X } from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import { formatDate } from '../lib/deals';
import {
  APPROVAL_LABELS, ActivityApproval, PENDING_APPROVAL, TbActivity, TbActivityContent, TbPackages, blankActivity, canApproveActivity, defaultPackages, trimLines,
} from '../lib/teambuilding';
import { ActivityForm, Card, PackageEditor, btnPrimary, btnSecondary, input, linkBtn } from './TeambuildingParts';
import { useFormDraft } from '../lib/useFormDraft';
import DraftBar from './DraftBar';
import PanelResizer from './PanelResizer';

// Teambuilding → Activity library and Package template (Joel, 2026-10-19: "everyone can amend").
// - Activities are typed once (photos, how it's played, takeaways…) and picked into proposals, where they can be
//   tailored for that client without changing the library. Saved in tb_activities/{id}.
// - The package template is what a new proposal's packages start from: tb_settings/package_template.
// Every change records who and when.
// - New activities wait for Management's approval (2026-10-22, lib/teambuilding.ts); only approved ones count for the
//   "Design new activity" KPI. A "Waiting for approval" filter, and Approve / Not approved in the panel.

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };

export function useActivities(): { list: TbActivity[]; loaded: boolean } {
  const [list, setList] = useState<TbActivity[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => onSnapshot(query(collection(db, 'tb_activities')),
    s => { setList(s.docs.map(d => ({ ...blankActivity(), ...(d.data() as any), id: d.id }))); setLoaded(true); },
    () => setLoaded(true)), []);
  return { list, loaded };
}

export function usePackageTemplate(): { pk: TbPackages | null; meta: any; loaded: boolean } {
  const [state, setState] = useState<{ pk: TbPackages | null; meta: any; loaded: boolean }>({ pk: null, meta: null, loaded: false });
  useEffect(() => onSnapshot(doc(db, 'tb_settings', 'package_template'),
    s => { const d: any = s.data(); setState({ pk: d?.packages || null, meta: d || null, loaded: true }); },
    () => setState(x => ({ ...x, loaded: true }))), []);
  return state;
}

// Malaysia date of a saved time (approval dates).
const myDay = (iso?: string) => (iso && Number.isFinite(Date.parse(iso)) ? new Date(Date.parse(iso) + 8 * 3600_000).toISOString().slice(0, 10) : '');
const stamp = (me: Viewer) => ({ updatedAt: new Date().toISOString(), updatedById: me.id, updatedByName: me.name });

export function cleanActivity(a: TbActivityContent): TbActivityContent {
  return {
    ...a, name: a.name.trim(), objectives: trimLines(a.objectives), takeaways: trimLines(a.takeaways), materials: trimLines(a.materials),
    photos: (a.photos || []).filter(Boolean),
  };
}

// ---------- Activity library ----------
export function ActivityLibrary({ me }: { me: Viewer }) {
  const { list, loaded } = useActivities();
  const [search, setSearch] = useState('');
  const [showOld, setShowOld] = useState(false);
  const [waitingOnly, setWaitingOnly] = useState(false);
  const waiting = list.filter(a => !a.archived && a.approval?.status === 'pending');
  const [editing, setEditing] = useState<{ a: TbActivity; isNew: boolean } | null>(null);
  const t = search.trim().toLowerCase();
  const shown = useMemo(() => list
    .filter(a => showOld || !a.archived)
    .filter(a => !waitingOnly || a.approval?.status === 'pending')
    .filter(a => !t || `${a.name} ${a.summary} ${a.location} ${a.format}`.toLowerCase().includes(t))
    .sort((a, b) => a.name.localeCompare(b.name)), [list, t, showOld, waitingOnly]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold">Activity library</h3>
          <p className="text-[15px] text-ink-soft">Typed once, picked into any teambuilding proposal. Anyone can add or improve an activity.</p>
        </div>
        <button type="button" className={btnPrimary} onClick={() => setEditing({ a: { ...blankActivity(), id: `act_${Date.now().toString(36)}` }, isNew: true })}><Plus className="h-4 w-4" /> Add activity</button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search activities" className={`${input} pl-9`} aria-label="Search activities" />
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-soft"><input type="checkbox" checked={showOld} onChange={e => setShowOld(e.target.checked)} className="h-4 w-4 accent-[#0E6E62]" /> Show ones no longer used</label>
        {(waiting.length > 0 || waitingOnly) && (
          <button type="button" aria-pressed={waitingOnly} onClick={() => setWaitingOnly(w => !w)}
            className={`rounded-full border px-3 py-1 text-sm font-semibold ${waitingOnly ? 'border-attention bg-attention-soft text-attention' : 'border-line text-ink-soft hover:bg-surface'}`}>
            Waiting for approval ({waiting.length})
          </button>
        )}
      </div>
      {!loaded ? (
        <p className="flex items-center gap-2 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
      ) : shown.length === 0 ? (
        <div className="rounded-2xl border border-line bg-white p-8 text-center">
          <p className="font-semibold">No activities yet</p>
          <p className="mt-1 text-[15px] text-ink-soft">Add your first one with "Add activity": name, photos, how it's played and what they learn.</p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map(a => (
            <li key={a.id}>
              <button type="button" onClick={() => setEditing({ a: JSON.parse(JSON.stringify(a)), isNew: false })}
                className={`flex h-full w-full flex-col overflow-hidden rounded-2xl border border-line bg-white text-left transition-shadow hover:shadow-md ${a.archived ? 'opacity-60' : ''}`}>
                <div className="aspect-[16/9] w-full bg-surface">
                  {a.photos?.[0] ? <img src={a.photos[0]} alt="" className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center text-ink-soft"><ImageOff className="h-6 w-6" /></span>}
                </div>
                <span className="flex-1 p-4">
                  <span className="block font-semibold">{a.name || 'Untitled activity'}{a.archived && <span className="ml-2 rounded bg-surface px-1.5 text-xs font-semibold text-ink-soft">No longer used</span>}</span>
                  {a.approval && a.approval.status !== 'approved' && (
                    <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${a.approval.status === 'pending' ? 'bg-attention-soft text-attention' : 'bg-danger-soft text-danger'}`}>{APPROVAL_LABELS[a.approval.status]}</span>
                  )}
                  <span className="mt-0.5 block text-sm text-ink-soft">{[a.duration, a.location, a.groupSize].filter(Boolean).join(' · ')}</span>
                  {a.summary && <span className="mt-1.5 line-clamp-2 block text-sm">{a.summary}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing && <ActivityPanel key={editing.a.id} initial={editing.a} isNew={editing.isNew} me={me} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ActivityPanel({ initial, isNew, me, onClose }: { initial: TbActivity; isNew: boolean; me: Viewer; onClose: () => void; key?: string }) {
  const [a, setA] = useState<TbActivity>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dirty = JSON.stringify(a) !== JSON.stringify(initial);
  // Unsaved changes are kept in this browser to continue later (lib/useFormDraft.ts), so closing doesn't ask.
  const draft = useFormDraft(me.id, isNew ? 'activity:new' : `activity:${initial.id}`, a, setA);
  const save = async () => {
    if (!a.name.trim()) { setError('Give the activity a name.'); return; }
    setBusy(true); setError('');
    try {
      const out: TbActivity = {
        ...a, ...cleanActivity(a), ...stamp(me),
        ...(isNew ? { createdAt: new Date().toISOString(), createdById: me.id, createdByName: me.name, approval: PENDING_APPROVAL } : {}),
        // Not approved: the creator's changes send it back to Management.
        ...(!isNew && initial.approval?.status === 'rejected' && initial.createdById === me.id ? { approval: PENDING_APPROVAL } : {}),
      };
      await setDoc(doc(db, 'tb_activities', a.id), JSON.parse(JSON.stringify(out)));
      draft.clear();
      onClose();
    } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };
  const toggleArchive = async () => {
    setBusy(true); setError('');
    try { await setDoc(doc(db, 'tb_activities', a.id), { archived: !a.archived, ...stamp(me) }, { merge: true }); onClose(); }
    catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm(`Delete "${a.name}" from the library? Proposals that already use it keep their copy.`)) return;
    setBusy(true); setError('');
    try { await deleteDoc(doc(db, 'tb_activities', a.id)); onClose(); } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };
  const canDelete = !isNew && (me.role === 'management' || initial.createdById === me.id);
  // Management approval (never your own activity).
  const [rejecting, setRejecting] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const decide = async (status: 'approved' | 'rejected') => {
    if (status === 'rejected' && rejectNote.trim().length < 5) { setError('Say briefly why it is not approved.'); return; }
    setBusy(true); setError('');
    const approval: ActivityApproval = { status, at: new Date().toISOString(), byId: me.id, byName: me.name, ...(status === 'rejected' ? { note: rejectNote.trim() } : {}) };
    try { await setDoc(doc(db, 'tb_activities', initial.id), { approval }, { merge: true }); onClose(); }
    catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };
  const close = onClose;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" role="dialog" aria-modal="true" aria-label="Activity" onClick={close}>
      <PanelResizer />
      <div className="flex h-full w-full flex-col bg-white font-sans text-ink shadow-xl md:w-[var(--panel-w,max(50vw,40rem))] md:min-w-[24rem] md:max-w-[95vw]" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h3 className="text-lg font-bold">{isNew ? 'Add activity' : a.name || 'Activity'}</h3>
            {!isNew && <p className="text-sm text-ink-soft">Added by {initial.createdByName || 'someone'}{initial.updatedByName ? ` · last changed by ${initial.updatedByName} on ${formatDate((initial.updatedAt || '').slice(0, 10))}` : ''}</p>}
          </div>
          <button type="button" onClick={close} className="rounded-md p-1 text-ink-soft hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-4 empty:hidden"><DraftBar draft={draft} what={isNew ? 'new activity' : 'change to this activity'} /></div>
          {!isNew && initial.approval && (
            <div className={`mb-4 rounded-xl px-4 py-3 text-[15px] ${initial.approval.status === 'approved' ? 'bg-accent-soft text-accent' : initial.approval.status === 'pending' ? 'bg-attention-soft text-attention' : 'bg-danger-soft text-danger'}`}>
              <p className="font-semibold">{APPROVAL_LABELS[initial.approval.status]}{initial.approval.byName ? ` by ${initial.approval.byName} on ${formatDate(myDay(initial.approval.at))}` : ''}</p>
              {initial.approval.status === 'pending' && <p className="text-sm">Management approves new activities. Only approved ones count for the Design new activity KPI.</p>}
              {initial.approval.status === 'rejected' && <p className="text-sm">"{initial.approval.note}"{initial.createdById === me.id ? ' Change it and save to send it for approval again.' : ''}</p>}
              {canApproveActivity(initial, me) && initial.approval.status !== 'approved' && (
                rejecting ? (
                  <div className="mt-2 space-y-2">
                    <input value={rejectNote} onChange={e => { setRejectNote(e.target.value); setError(''); }} className={input} placeholder="Why not, and what to change" aria-label="Why not approved" />
                    <span className="flex gap-2">
                      <button type="button" className={btnSecondary} onClick={() => setRejecting(false)}>Cancel</button>
                      <button type="button" className={`${btnSecondary} text-danger`} disabled={busy} onClick={() => decide('rejected')}>Not approved</button>
                    </span>
                  </div>
                ) : (
                  <span className="mt-2 flex flex-wrap gap-2">
                    <button type="button" className={btnPrimary} disabled={busy || dirty} onClick={() => decide('approved')}><Check className="h-4 w-4" /> Approve</button>
                    {initial.approval.status === 'pending' && <button type="button" className={btnSecondary} disabled={busy} onClick={() => setRejecting(true)}>Not approved</button>}
                  </span>
                )
              )}
            </div>
          )}
          {isNew && <p className="mb-4 rounded-xl bg-surface px-4 py-3 text-sm text-ink-soft">New activities wait for Management's approval. Only approved ones count for the Design new activity KPI.</p>}
          <ActivityForm a={a} onChange={c => setA(x => ({ ...x, ...c }))} me={me} />
          {!isNew && <p className="mt-4 text-sm text-ink-soft">Changes here are used by proposals made from now on. Proposals that already have this activity keep their own copy.</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
          {!isNew && <button type="button" className={btnSecondary} disabled={busy} onClick={toggleArchive}>{a.archived ? <><ArchiveRestore className="h-4 w-4" /> Use again</> : <><Archive className="h-4 w-4" /> Stop using</>}</button>}
          {canDelete && <button type="button" className={`${btnSecondary} text-danger`} disabled={busy} onClick={remove}><Trash2 className="h-4 w-4" /> Delete</button>}
          {error && <span className="text-sm text-danger">{error}</span>}
          <span className="ml-auto flex gap-2">
            <button type="button" className={btnSecondary} onClick={close}>Cancel</button>
            <button type="button" className={btnPrimary} disabled={busy || (!dirty && !isNew)} onClick={save}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save</button>
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------- Package template ----------
export function PackageTemplate({ me }: { me: Viewer }) {
  const { pk, meta, loaded } = usePackageTemplate();
  const [draft, setDraft] = useState<TbPackages | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { if (loaded && !draft) setDraft(JSON.parse(JSON.stringify(pk || defaultPackages()))); }, [loaded]);
  if (!draft) return <p className="flex items-center gap-2 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>;
  const dirty = JSON.stringify(draft) !== JSON.stringify(pk || defaultPackages());
  const save = async () => {
    setBusy(true); setError('');
    try {
      await setDoc(doc(db, 'tb_settings', 'package_template'), JSON.parse(JSON.stringify({ packages: draft, ...stamp(me) })));
      setNote('Saved. New proposals start from this.');
      window.setTimeout(() => setNote(''), 3000);
    } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4">
      <Card title="Package template" hint="Every new teambuilding proposal starts with these packages and prices. Each proposal can then be adjusted on its own.">
        <PackageEditor pk={draft} onChange={setDraft} />
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <span className="text-sm text-ink-soft">{meta?.updatedByName ? `Last changed by ${meta.updatedByName} on ${formatDate(String(meta.updatedAt || '').slice(0, 10))}` : 'Not saved yet: this is the starting table from the Texas Chicken proposal.'}</span>
          {note && <span className="text-sm text-accent">{note}</span>}
          {error && <span className="text-sm text-danger">{error}</span>}
          <span className="ml-auto flex gap-2">
            {dirty && <button type="button" className={linkBtn} onClick={() => setDraft(JSON.parse(JSON.stringify(pk || defaultPackages())))}>Undo changes</button>}
            <button type="button" className={btnPrimary} disabled={busy || (!dirty && !!pk)} onClick={save}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save template</button>
          </span>
        </div>
      </Card>
    </div>
  );
}
