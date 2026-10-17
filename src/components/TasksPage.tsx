import React, { useEffect, useMemo, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, query, setDoc, updateDoc } from 'firebase/firestore';
import { CheckCircle2, ChevronDown, ChevronRight, Circle, Loader2, Plus, Trash2, X } from 'lucide-react';
import { Representative } from '../types';
import { db, friendlyError } from '../lib/firebase';
import { dealOwnerId, dealStage, formatDate, todayIso } from '../lib/deals';
import { GROUP_LABELS, GROUP_ORDER, Task, TaskGroup, assigneeOf, assignerOf, isDone, isRealTask, taskGroup } from '../lib/tasks';

// To-do (redesigned 2026-10-17). One shared task per job (no copies): quick add at the top,
// "My to-do" / "I asked others" / "Everyone's" (Management), grouped by when it's due.

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };
type Scope = 'mine' | 'asked' | 'everyone';

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const label = 'mb-1.5 block text-sm font-semibold text-ink';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';

const GROUP_TONE: Record<TaskGroup, string> = {
  overdue: 'text-danger', today: 'text-attention', week: 'text-ink', later: 'text-ink', nodate: 'text-ink', done: 'text-ink-soft',
};

export default function TasksPage({ rep, reps, viewer, onOpenDeals }: {
  rep: Representative; reps: Representative[]; viewer?: Viewer; key?: string;
  onOpenDeals?: () => void;          // jump to the Deals tab
}) {
  const me: Viewer = viewer || { id: rep.id, name: rep.name, role: (rep.role as any) || 'rep' };
  const isManagement = me.role === 'management';
  const [tasks, setTasks] = useState<Task[]>([]);
  const [deals, setDeals] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [scope, setScope] = useState<Scope>('mine');
  const [showDone, setShowDone] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  // Quick add
  const [detail, setDetail] = useState('');
  const [due, setDue] = useState('');
  const [assignTo, setAssignTo] = useState(rep.id);
  const [dealId, setDealId] = useState('');

  useEffect(() => {
    const subs = [
      onSnapshot(query(collection(db, 'tasks')), s => { setTasks(s.docs.map(d => ({ ...(d.data() as Task), id: d.id }))); setLoaded(true); }, () => setLoaded(true)),
      onSnapshot(query(collection(db, 'pipelines')), s => setDeals(s.docs.map(d => ({ ...d.data(), id: d.id })))),
      onSnapshot(query(collection(db, 'clients')), s => setClients(s.docs.map(d => ({ ...d.data(), id: d.id })))),
    ];
    return () => subs.forEach(u => u());
  }, []);

  const flash = (t: string) => { setToast(t); window.setTimeout(() => setToast(x => (x === t ? '' : x)), 3000); };
  const today = todayIso();
  const team = useMemo(() => {
    const list = reps.map(r => ({ id: r.id, name: r.name }));
    if (!list.some(p => p.id === me.id)) list.push({ id: me.id, name: me.name });
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [reps, me.id]);
  const nameOf = (id: string, fallback = '') => team.find(p => p.id === id)?.name || fallback || 'Former team member';
  const clientName = (d: any) => clients.find(c => c.id === d?.clientId)?.companyName || d?.client || 'No client';
  const dealLabel = (d: any) => `${clientName(d)}${d?.courseName ? ` · ${d.courseName}` : ''}`;

  // Deals a task can be about: this person's open and won deals (Admin and Management: everyone's).
  const dealChoices = useMemo(() => deals
    .filter(d => dealStage(d) !== 'lost' && (me.role !== 'rep' || dealOwnerId(d) === rep.id))
    .sort((a, b) => dealLabel(a).localeCompare(dealLabel(b))), [deals, clients, rep.id, me.role]);

  const real = tasks.filter(isRealTask);
  const counts = {
    mine: real.filter(t => assigneeOf(t) === rep.id && !isDone(t)).length,
    asked: real.filter(t => assignerOf(t) === rep.id && assigneeOf(t) !== rep.id && !isDone(t)).length,
  };
  const inScope = real.filter(t => scope === 'everyone' ? true
    : scope === 'mine' ? assigneeOf(t) === rep.id
      : assignerOf(t) === rep.id && assigneeOf(t) !== rep.id);

  const grouped = useMemo(() => {
    const out: Record<TaskGroup, Task[]> = { overdue: [], today: [], week: [], later: [], nodate: [], done: [] };
    inScope.forEach(t => out[taskGroup(t, today)].push(t));
    (Object.keys(out) as TaskGroup[]).forEach(g => out[g].sort((a, b) => g === 'done'
      ? String(b.doneAt || '').localeCompare(String(a.doneAt || ''))
      : String(a.dateline || '9999').localeCompare(String(b.dateline || '9999')) || (a.createdAt || 0) - (b.createdAt || 0)));
    return out;
  }, [inScope, today]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!detail.trim()) return setError('Write what needs doing.');
    const id = `task_${Date.now()}`;
    const t: Task = {
      id, detail: detail.trim(), dateline: due, status: 'Not done',
      assignedById: me.id, assignedBy: me.name, assignedToId: assignTo, assignedTo: nameOf(assignTo),
      pipelineId: dealId, dateCreated: today, createdAt: Date.now(), ownerRepId: assignTo,
    };
    setBusy(true);
    try {
      await setDoc(doc(db, 'tasks', id), t);
      setDetail(''); setDue(''); setDealId('');
      flash(assignTo === rep.id ? 'Task added' : `Task sent to ${nameOf(assignTo)}`);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleDone = async (t: Task) => {
    setError('');
    const done = !isDone(t);
    try {
      await updateDoc(doc(db, 'tasks', t.id), done
        ? { status: 'Done', doneAt: today, doneByName: me.name }
        : { status: 'Not done', doneAt: '', doneByName: '' });
    } catch (err) {
      setError(friendlyError(err));
    }
  };

  const openTask = tasks.find(t => t.id === openId) || null;
  const canChange = (t: Task) => isManagement || assigneeOf(t) === me.id || assignerOf(t) === me.id;
  const canDelete = (t: Task) => isManagement || assignerOf(t) === me.id;
  const empty = GROUP_ORDER.every(g => g === 'done' || grouped[g].length === 0);

  return (
    <div className="space-y-5 font-sans text-ink">
      {toast && <div role="status" className="fixed right-4 top-4 z-[60] rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white shadow-lg">{toast}</div>}

      <div>
        <h2 className="text-xl font-bold">To-do</h2>
        <p className="text-[15px] text-ink-soft">Jobs for yourself, or for a teammate. They see the same task, so you know when it's done.</p>
      </div>

      {/* Quick add */}
      <form onSubmit={add} className="space-y-3 rounded-2xl border border-line bg-white p-4">
        <input value={detail} onChange={e => setDetail(e.target.value)} placeholder="What needs doing?" className={input} aria-label="What needs doing" />
        <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-end">
          <div>
            <label className="mb-1 block text-sm text-ink-soft" htmlFor="t-due">Due</label>
            <input id="t-due" type="date" value={due} onChange={e => setDue(e.target.value)} className={input} />
          </div>
          <div>
            <label className="mb-1 block text-sm text-ink-soft" htmlFor="t-to">Assign to</label>
            <select id="t-to" value={assignTo} onChange={e => setAssignTo(e.target.value)} className={input}>
              {team.map(p => <option key={p.id} value={p.id}>{p.id === rep.id ? `${p.name}${rep.id === me.id ? ' (me)' : ''}` : p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm text-ink-soft" htmlFor="t-deal">About a deal <span className="text-ink-soft/70">(optional)</span></label>
            <select id="t-deal" value={dealId} onChange={e => setDealId(e.target.value)} className={input}>
              <option value="">No deal</option>
              {dealChoices.map(d => <option key={d.id} value={d.id}>{dealLabel(d)}</option>)}
            </select>
          </div>
          <button type="submit" disabled={busy} className={btnPrimary}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add</button>
        </div>
      </form>
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</p>}

      {/* Views */}
      <div className="inline-flex flex-wrap rounded-lg border border-line bg-white p-0.5">
        {([['mine', `My to-do (${counts.mine})`], ['asked', `I asked others (${counts.asked})`], ...(isManagement ? [['everyone', "Everyone's"]] : [])] as [Scope, string][]).map(([k, t]) => (
          <button key={k} type="button" onClick={() => setScope(k)} className={`rounded-md px-3 py-1.5 text-sm font-semibold ${scope === k ? 'bg-ink text-white' : 'text-ink-soft hover:text-ink'}`}>{t}</button>
        ))}
      </div>

      {/* Groups */}
      {!loaded ? (
        <p className="flex items-center gap-2 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading tasks…</p>
      ) : (
        <div className="space-y-5">
          {empty && (
            <div className="rounded-2xl border border-line bg-white p-8 text-center">
              <p className="font-semibold">{scope === 'asked' ? "You haven't given anyone a task" : 'Nothing to do'}</p>
              <p className="mt-1 text-[15px] text-ink-soft">Add a task above. Give it a due date so it shows up on time.</p>
            </div>
          )}
          {GROUP_ORDER.filter(g => g !== 'done' && grouped[g].length).map(g => (
            <section key={g}>
              <h3 className={`mb-2 text-[15px] font-bold ${GROUP_TONE[g]}`}>{GROUP_LABELS[g]} ({grouped[g].length})</h3>
              <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">
                {grouped[g].map(t => <TaskRow key={t.id} t={t} g={g} scope={scope} rep={rep} canTick={canChange(t)} nameOf={nameOf} deal={deals.find(d => d.id === t.pipelineId)} dealLabel={dealLabel} onToggle={() => toggleDone(t)} onOpen={() => setOpenId(t.id)} />)}
              </ul>
            </section>
          ))}
          {grouped.done.length > 0 && (
            <section>
              <button type="button" onClick={() => setShowDone(v => !v)} className="mb-2 flex items-center gap-1 text-[15px] font-bold text-ink-soft hover:text-ink">
                {showDone ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />} Done ({grouped.done.length})
              </button>
              {showDone && (
                <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">
                  {grouped.done.slice(0, 60).map(t => <TaskRow key={t.id} t={t} g="done" scope={scope} rep={rep} canTick={canChange(t)} nameOf={nameOf} deal={deals.find(d => d.id === t.pipelineId)} dealLabel={dealLabel} onToggle={() => toggleDone(t)} onOpen={() => setOpenId(t.id)} />)}
                </ul>
              )}
            </section>
          )}
        </div>
      )}

      {openTask && (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" role="dialog" aria-modal="true" onClick={() => setOpenId(null)}>
          <div className="h-full w-full md:w-1/2 md:min-w-[40rem] overflow-y-auto bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <TaskPanel key={openTask.id} t={openTask} team={team} nameOf={nameOf} dealChoices={dealChoices} deals={deals} dealLabel={dealLabel}
              canChange={canChange(openTask)} canDelete={canDelete(openTask)} me={me} onOpenDeals={onOpenDeals}
              onClose={() => setOpenId(null)} onToggle={() => toggleDone(openTask)} onSaved={() => flash('Task saved')} onDeleted={() => { setOpenId(null); flash('Task deleted'); }} />
          </div>
        </div>
      )}
    </div>
  );
}

function TaskRow({ t, g, scope, rep, canTick, nameOf, deal, dealLabel, onToggle, onOpen }: {
  t: Task; g: TaskGroup; scope: Scope; rep: Representative; canTick: boolean; nameOf: (id: string, f?: string) => string;
  deal: any; dealLabel: (d: any) => string; onToggle: () => void; onOpen: () => void; key?: string;
}) {
  const done = isDone(t);
  const who = scope === 'mine'
    ? (assignerOf(t) !== rep.id ? `From ${nameOf(assignerOf(t), t.assignedBy)}` : '')
    : scope === 'asked' ? `For ${nameOf(assigneeOf(t), t.assignedTo)}`
      : `${nameOf(assigneeOf(t), t.assignedTo)}${assignerOf(t) !== assigneeOf(t) ? `, from ${nameOf(assignerOf(t), t.assignedBy)}` : ''}`;
  const when = done ? `Done ${formatDate(t.doneAt || '')}${t.doneByName ? ` by ${t.doneByName}` : ''}` : t.dateline ? formatDate(t.dateline) : '';
  return (
    <li className="flex items-start gap-3 px-4 py-3 hover:bg-surface">
      <button type="button" disabled={!canTick} onClick={onToggle} className="mt-0.5 shrink-0 disabled:cursor-not-allowed disabled:opacity-40" aria-label={done ? 'Mark not done' : 'Mark done'}>
        {done ? <CheckCircle2 className="h-5 w-5 text-accent" /> : <Circle className={`h-5 w-5 ${g === 'overdue' ? 'text-danger' : 'text-ink-soft/60'}`} />}
      </button>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className={`block whitespace-pre-line text-[15px] ${done ? 'text-ink-soft line-through' : ''}`}>{t.detail || 'No details'}</span>
        <span className="mt-0.5 block text-sm text-ink-soft">{[who, deal ? dealLabel(deal) : ''].filter(Boolean).join(' · ')}</span>
      </button>
      <span className={`shrink-0 text-right text-sm ${g === 'overdue' ? 'font-semibold text-danger' : 'text-ink-soft'}`}>{when}</span>
    </li>
  );
}

function TaskPanel({ t, team, nameOf, dealChoices, deals, dealLabel, canChange, canDelete, me, onOpenDeals, onClose, onToggle, onSaved, onDeleted }: {
  t: Task; team: { id: string; name: string }[]; nameOf: (id: string, f?: string) => string; dealChoices: any[]; deals: any[]; dealLabel: (d: any) => string;
  canChange: boolean; canDelete: boolean; me: Viewer; onOpenDeals?: () => void;
  onClose: () => void; onToggle: () => void; onSaved: () => void; onDeleted: () => void; key?: string;
}) {
  const [detail, setDetail] = useState(t.detail || '');
  const [due, setDue] = useState(t.dateline || '');
  const [to, setTo] = useState(assigneeOf(t));
  const [dealId, setDealId] = useState(t.pipelineId || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const deal = deals.find(d => d.id === dealId);
  const changed = detail.trim() !== (t.detail || '') || due !== (t.dateline || '') || to !== assigneeOf(t) || dealId !== (t.pipelineId || '');
  // Keep a linked deal in the list even if it's not one of this person's choices.
  const choices = deal && !dealChoices.some(d => d.id === deal.id) ? [deal, ...dealChoices] : dealChoices;

  const save = async () => {
    setError('');
    if (!detail.trim()) return setError('Write what needs doing.');
    setBusy(true);
    try {
      await updateDoc(doc(db, 'tasks', t.id), { detail: detail.trim(), dateline: due, assignedToId: to, assignedTo: nameOf(to), ownerRepId: to, pipelineId: dealId });
      onSaved();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!window.confirm("Delete this task? This can't be undone.")) return;
    setBusy(true);
    try {
      await deleteDoc(doc(db, 'tasks', t.id));
      onDeleted();
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold">Task</h3>
          <p className="text-sm text-ink-soft">
            Added {formatDate(t.dateCreated || '') || ''} by {nameOf(assignerOf(t), t.assignedBy)}
            {isDone(t) && <> · <span className="font-semibold text-accent">Done {formatDate(t.doneAt || '')}{t.doneByName ? ` by ${t.doneByName}` : ''}</span></>}
          </p>
        </div>
        <button type="button" onClick={onClose} className="rounded-md p-1 text-ink-soft hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
      </div>

      {canChange && (
        <button type="button" onClick={onToggle} className={isDone(t) ? btnSecondary : btnPrimary}>
          {isDone(t) ? <><Circle className="h-4 w-4" /> Mark not done</> : <><CheckCircle2 className="h-4 w-4" /> Mark done</>}
        </button>
      )}

      <fieldset disabled={!canChange} className="space-y-4">
        <div>
          <label className={label} htmlFor="tp-detail">What needs doing</label>
          <textarea id="tp-detail" value={detail} onChange={e => setDetail(e.target.value)} rows={4} className={`${input} resize-y`} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="tp-due">Due</label>
            <input id="tp-due" type="date" value={due} onChange={e => setDue(e.target.value)} className={input} />
          </div>
          <div>
            <label className={label} htmlFor="tp-to">Assigned to</label>
            <select id="tp-to" value={to} onChange={e => setTo(e.target.value)} className={input}>
              {!team.some(p => p.id === to) && <option value={to}>{t.assignedTo || 'Former team member'}</option>}
              {team.map(p => <option key={p.id} value={p.id}>{p.name}{p.id === me.id ? ' (me)' : ''}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className={label} htmlFor="tp-deal">About a deal</label>
          <select id="tp-deal" value={dealId} onChange={e => setDealId(e.target.value)} className={input}>
            <option value="">No deal</option>
            {choices.map(d => <option key={d.id} value={d.id}>{dealLabel(d)}</option>)}
          </select>
          {deal && onOpenDeals && <button type="button" className="mt-1 text-sm font-semibold text-accent hover:underline" onClick={onOpenDeals}>Go to Deals</button>}
        </div>
      </fieldset>
      {!canChange && <p className="rounded-lg bg-surface px-3.5 py-2.5 text-sm text-ink-soft">Only the person it's assigned to, the person who assigned it, or Management can change this task.</p>}

      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</p>}

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        {canChange && <button type="button" disabled={busy || !changed} onClick={save} className={btnPrimary}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save</button>}
        <button type="button" onClick={onClose} className={btnSecondary}>Close</button>
        {canDelete && <button type="button" disabled={busy} onClick={remove} className="ml-auto inline-flex items-center gap-1.5 text-sm font-semibold text-danger hover:underline"><Trash2 className="h-4 w-4" /> Delete task</button>}
      </div>
    </div>
  );
}
