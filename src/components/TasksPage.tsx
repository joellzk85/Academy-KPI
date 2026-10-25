import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, query, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { Building2, CheckCircle2, ChevronDown, ChevronRight, Circle, Loader2, Plus, Search, Trash2, User, X } from 'lucide-react';
import { Representative } from '../types';
import { db, friendlyError } from '../lib/firebase';
import { dealOwnerId, dealStage, formatDate, todayIso } from '../lib/deals';
import { GROUP_LABELS, GROUP_ORDER, Task, TaskGroup, assigneesOf, assignerOf, isAssignedTo, isDone, isRealTask, taskGroup } from '../lib/tasks';
import { linkedOnly } from '../lib/linked';
import { useCloseOnOutside } from '../lib/useCloseOnOutside';
import { useTeamList } from '../lib/useClientHistory';
import { useFormDraft } from '../lib/useFormDraft';
import DraftBar from './DraftBar';
import { ClientTouchPoint, TOUCH_HOW_LABELS, TouchHow, newTouchPointId } from '../lib/touchPoints';
import PanelResizer from './PanelResizer';
import ListPager, { listSelect } from './ListPager';
import { LIST_SORT_LABELS, sortList, usePaged, type ListSort } from '../lib/listPaging';

// To-do (redesigned 2026-10-17). One shared task per job (no copies): quick add at the top,
// "My to-do" / "I asked others" / "Everyone's" (Management), grouped by when it's due.
// Client tags (2026-10-18): typing @ suggests clients and teammates. A client tag ("@Sime Darby") opens that client's
// page, and the task shows on it. A teammate tag adds them to the people it's for (a task can be for several people;
// anyone of them can tick it). Ticking a client-tagged task done asks "What happened?" and saves it as a touch point.

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };
type Scope = 'mine' | 'asked' | 'everyone';
type Person = { id: string; name: string };
type ClientRef = { id: string; companyName: string };

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

// Client tags still in the text (the "@<name>" wasn't deleted).
function keptClients(text: string, tags: ClientRef[]): ClientRef[] {
  return tags.filter((c, i) => tags.findIndex(x => x.id === c.id) === i && text.includes(`@${c.companyName}`));
}
const tagsOf = (t: Task): ClientRef[] => (t.clientIds || []).map((id, i) => ({ id, companyName: (t.clientNames || [])[i] || '' })).filter(c => c.companyName);

export default function TasksPage({ rep, reps, viewer, onOpenDeals, onOpenDeal, onOpenClient, openTaskId, onOpenTaskHandled }: {
  rep: Representative; reps: Representative[]; viewer?: Viewer; key?: string;
  onOpenDeals?: () => void;          // jump to the Deals tab
  onOpenDeal?: (dealId: string) => void;   // open the deal's panel (tasks made inside a deal, 2026-10-24)
  onOpenClient?: (clientId: string) => void;   // a client tag
  openTaskId?: string | null;        // open this task's panel (from a client page)
  onOpenTaskHandled?: () => void;
}) {
  const me: Viewer = viewer || { id: rep.id, name: rep.name, role: (rep.role as any) || 'rep' };
  const isManagement = me.role === 'management';
  const [tasks, setTasks] = useState<Task[]>([]);
  const [deals, setDeals] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const teamList = useTeamList();
  const [loaded, setLoaded] = useState(false);
  const [scope, setScope] = useState<Scope>('mine');
  const [showDone, setShowDone] = useState(false);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'due' | ListSort>('due');
  const [personFilter, setPersonFilter] = useState('');
  const [dueFilter, setDueFilter] = useState<'' | TaskGroup>('');
  const [dealFilter, setDealFilter] = useState('');   // '' any, '-' no deal, else a deal id
  const [openId, setOpenId] = useState<string | null>(null);
  const [doneAsk, setDoneAsk] = useState<Task | null>(null);   // "What happened?" before ticking a client-tagged task
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  // Quick add
  const [detail, setDetail] = useState('');
  const [due, setDue] = useState('');
  const [assignTo, setAssignTo] = useState<string[]>([rep.id]);
  const [tagged, setTagged] = useState<ClientRef[]>([]);
  const [dealId, setDealId] = useState('');
  // An unfinished To-do is kept in this browser until it's added (lib/useFormDraft.ts).
  const addDraft = useFormDraft(me.id, `todo:new:${rep.id}`, { detail, due, assignTo, tagged, dealId },
    v => { setDetail(v.detail); setDue(v.due); setAssignTo(v.assignTo); setTagged(v.tagged); setDealId(v.dealId); });

  useEffect(() => {
    const subs = [
      onSnapshot(query(collection(db, 'tasks')), s => { setTasks(s.docs.map(d => ({ ...(d.data() as Task), id: d.id }))); setLoaded(true); }, () => setLoaded(true)),
      onSnapshot(query(collection(db, 'pipelines')), s => setDeals(linkedOnly(s.docs.map(d => ({ ...d.data(), id: d.id }))))),
      onSnapshot(query(collection(db, 'clients')), s => setClients(s.docs.map(d => ({ ...d.data(), id: d.id })))),
    ];
    return () => subs.forEach(u => u());
  }, []);

  useEffect(() => {
    if (!openTaskId) return;
    setOpenId(openTaskId);
    onOpenTaskHandled?.();
  }, [openTaskId]);

  const flash = (t: string) => { setToast(t); window.setTimeout(() => setToast(x => (x === t ? '' : x)), 3000); };
  const today = todayIso();
  // Everyone active on the Team list (Management included), plus the workspace people.
  const team: Person[] = useMemo(() => {
    const list: Person[] = teamList.filter(p => p.active).map(p => ({ id: p.id, name: p.name }));
    reps.forEach(r => { if (!list.some(p => p.id === r.id)) list.push({ id: r.id, name: r.name }); });
    if (!list.some(p => p.id === me.id)) list.push({ id: me.id, name: me.name });
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [teamList, reps, me.id]);
  const nameOf = (id: string, fallback = '') => team.find(p => p.id === id)?.name || teamList.find(p => p.id === id)?.name || fallback || 'Former team member';
  const clientName = (d: any) => clients.find(c => c.id === d?.clientId)?.companyName || d?.client || 'No client';
  const dealLabel = (d: any) => `${clientName(d)}${d?.courseName ? ` · ${d.courseName}` : ''}`;
  const clientRefs: ClientRef[] = useMemo(() => clients.filter(c => c.companyName).map(c => ({ id: c.id, companyName: c.companyName }))
    .sort((a, b) => a.companyName.localeCompare(b.companyName)), [clients]);

  // Deals a task can be about: this person's open and won deals (Admin and Management: everyone's).
  const dealChoices = useMemo(() => deals
    .filter(d => dealStage(d) !== 'lost' && (me.role !== 'rep' || dealOwnerId(d) === rep.id))
    .sort((a, b) => dealLabel(a).localeCompare(dealLabel(b))), [deals, clients, rep.id, me.role]);

  // 1-to-1 actions stay between the two people in the 1-to-1.
  const real = tasks.filter(t => isRealTask(t) && (t.source !== '121' || isAssignedTo(t, me.id) || assignerOf(t) === me.id));
  const askedOnly = (t: Task) => assignerOf(t) === rep.id && !(assigneesOf(t).length === 1 && isAssignedTo(t, rep.id));
  const counts = {
    mine: real.filter(t => isAssignedTo(t, rep.id) && !isDone(t)).length,
    asked: real.filter(t => askedOnly(t) && !isDone(t)).length,
  };
  const inScope = real.filter(t => scope === 'everyone' ? true : scope === 'mine' ? isAssignedTo(t, rep.id) : askedOnly(t));
  const q = search.trim().toLowerCase();
  const filtered = inScope.filter(t => {
    if (q && !`${t.detail} ${(t.clientNames || []).join(' ')} ${t.stepLabel || ''}`.toLowerCase().includes(q)) return false;
    if (personFilter && !isAssignedTo(t, personFilter)) return false;
    if (dealFilter && (dealFilter === '-' ? !!t.pipelineId : t.pipelineId !== dealFilter)) return false;
    if (dueFilter && taskGroup(t, today) !== dueFilter) return false;
    return true;
  });
  // People and deals that appear on the tasks in this view, for the filters.
  const filterPeople = useMemo(() => [...new Set(inScope.flatMap(assigneesOf))].map(id => ({ id, name: nameOf(id) })).sort((a, b) => a.name.localeCompare(b.name)), [inScope, team]);
  const filterDeals = useMemo(() => [...new Set(inScope.map(t => t.pipelineId).filter(Boolean) as string[])]
    .map(id => deals.find(d => d.id === id)).filter(Boolean).map(d => ({ id: d.id, label: dealLabel(d) })).sort((a, b) => a.label.localeCompare(b.label)), [inScope, deals, clients]);

  const grouped = useMemo(() => {
    const out: Record<TaskGroup, Task[]> = { overdue: [], today: [], week: [], later: [], nodate: [], done: [] };
    filtered.forEach(t => out[taskGroup(t, today)].push(t));
    (Object.keys(out) as TaskGroup[]).forEach(g => {
      if (sortBy !== 'due') { out[g] = sortList(out[g], sortBy, t => t.detail || '', t => t.createdAt || t.dateCreated); return; }
      out[g].sort((a, b) => g === 'done'
        ? String(b.doneAt || '').localeCompare(String(a.doneAt || ''))
        : String(a.dateline || '9999').localeCompare(String(b.dateline || '9999')) || (a.createdAt || 0) - (b.createdAt || 0));
    });
    return out;
  }, [filtered, today, sortBy]);
  // Open tasks run through the groups in order (Overdue first), so pages keep the group headings.
  const openFlat = useMemo(() => GROUP_ORDER.filter(g => g !== 'done').flatMap(g => grouped[g]), [grouped]);
  const resetOn = [scope, search, sortBy, personFilter, dueFilter, dealFilter];
  const pagedOpen = usePaged(openFlat, resetOn);
  const openTop = useRef<HTMLDivElement>(null);
  const pagedDone = usePaged(grouped.done, resetOn);
  const anyFilter = !!(search.trim() || personFilter || dueFilter || dealFilter);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!detail.trim()) return setError('Write what needs doing.');
    if (!assignTo.length) return setError('Pick who it is for.');
    const id = `task_${Date.now()}`;
    const tags = keptClients(detail, tagged);
    const t: Task = {
      id, detail: detail.trim(), dateline: due, status: 'Not done',
      assignedById: me.id, assignedBy: me.name, assignedToId: assignTo[0], assignedTo: nameOf(assignTo[0]), assignedToIds: assignTo,
      clientIds: tags.map(c => c.id), clientNames: tags.map(c => c.companyName),
      pipelineId: dealId, dateCreated: today, createdAt: Date.now(), ownerRepId: assignTo[0],
    };
    setBusy(true);
    try {
      await setDoc(doc(db, 'tasks', id), t);
      setDetail(''); setDue(''); setDealId(''); setTagged([]); setAssignTo([rep.id]);
      addDraft.discard();
      const others = assignTo.filter(x => x !== rep.id);
      flash(others.length ? `Task sent to ${others.map(x => nameOf(x)).join(', ')}` : 'Task added');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  // Ticking a client-tagged task done asks "What happened?" first (optional).
  const toggleDone = (t: Task) => {
    if (!isDone(t) && (t.clientIds || []).length) return setDoneAsk(t);
    return setDone(t, !isDone(t));
  };
  const setDone = async (t: Task, done: boolean, note?: { text: string; how: TouchHow }) => {
    setError('');
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'tasks', t.id), done
        ? { status: 'Done', doneAt: today, doneByName: me.name, doneById: me.id }
        : { status: 'Not done', doneAt: '', doneByName: '', doneById: '' });
      if (done && note?.text.trim()) {
        tagsOf(t).forEach(c => {
          const id = newTouchPointId();
          const tp: ClientTouchPoint = {
            id, clientId: c.id, date: today, how: note.how, text: note.text.trim().slice(0, 2000), nextDate: '', followUpById: '', followUpByName: '',
            at: new Date().toISOString(), byId: me.id, byName: me.name, source: 'todo', taskId: t.id,
          };
          batch.set(doc(db, 'client_touch_points', id), tp);
        });
      }
      await batch.commit();
      if (done && note?.text.trim()) flash(`Done, and saved as a touch point on ${tagsOf(t).map(c => c.companyName).join(', ')}`);
    } catch (err) {
      setError(friendlyError(err));
    }
  };

  const openTask = tasks.find(t => t.id === openId) || null;
  const canChange = (t: Task) => isManagement || isAssignedTo(t, me.id) || assignerOf(t) === me.id;
  const canDelete = (t: Task) => isManagement || assignerOf(t) === me.id;
  const empty = GROUP_ORDER.every(g => g === 'done' || grouped[g].length === 0);
  const rowProps = (t: Task, g: TaskGroup) => ({
    t, g, scope, rep, canTick: canChange(t), nameOf, deal: deals.find(d => d.id === t.pipelineId), dealLabel, onOpenClient,
    onToggle: () => toggleDone(t), onOpen: () => setOpenId(t.id),
  });

  return (
    <div className="space-y-5 font-sans text-ink">
      {toast && <div role="status" className="fixed right-4 top-4 z-[60] rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white shadow-lg">{toast}</div>}

      <div>
        <h2 className="text-xl font-bold">To-do</h2>
        <p className="text-[15px] text-ink-soft">Jobs for yourself, or for teammates. They see the same task, so you know when it's done. Type @ to tag a client or a teammate.</p>
      </div>

      {/* Quick add */}
      <form onSubmit={add} className="space-y-3 rounded-2xl border border-line bg-white p-4">
        <DraftBar draft={addDraft} what="To-do" />
        <MentionInput value={detail} onChange={setDetail} clients={clientRefs} people={team} placeholder="What needs doing? Type @ to tag a client or teammate" ariaLabel="What needs doing"
          onPickClient={c => setTagged(x => (x.some(y => y.id === c.id) ? x : [...x, c]))}
          onPickPerson={p => setAssignTo(x => (x.includes(p.id) ? x : [...x, p.id]))} />
        {keptClients(detail, tagged).length > 0 && (
          <p className="flex flex-wrap items-center gap-1.5 text-sm text-ink-soft">
            Shows on the page of {keptClients(detail, tagged).map(c => <span key={c.id} className="inline-flex items-center gap-1 rounded-md bg-accent-soft px-2 py-0.5 font-semibold text-accent"><Building2 className="h-3.5 w-3.5" />{c.companyName}</span>)}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1.2fr)_minmax(0,1.2fr)_auto] sm:items-end">
          <div>
            <label className="mb-1 block text-sm text-ink-soft" htmlFor="t-due">Due</label>
            <input id="t-due" type="date" value={due} onChange={e => setDue(e.target.value)} className={input} />
          </div>
          <div>
            <span className="mb-1 block text-sm text-ink-soft">For</span>
            <PeoplePicker ids={assignTo} team={team} meId={rep.id === me.id ? me.id : ''} nameOf={nameOf} onChange={setAssignTo} />
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

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search tasks or clients" className={`${input} pl-9`} aria-label="Search tasks" />
        </div>
        <select value={sortBy} onChange={e => setSortBy(e.target.value as 'due' | ListSort)} className={listSelect} aria-label="Sort tasks">
          <option value="due">Due date, soonest first</option>
          {(Object.keys(LIST_SORT_LABELS) as ListSort[]).map(k => <option key={k} value={k}>{k === 'az' ? 'Task A to Z' : k === 'za' ? 'Task Z to A' : LIST_SORT_LABELS[k]}</option>)}
        </select>
        {scope !== 'mine' && filterPeople.length > 1 && (
          <select value={personFilter} onChange={e => setPersonFilter(e.target.value)} className={listSelect} aria-label="Assigned to">
            <option value="">Assigned to anyone</option>
            {filterPeople.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <select value={dueFilter} onChange={e => setDueFilter(e.target.value as '' | TaskGroup)} className={listSelect} aria-label="Due">
          <option value="">Any due date</option>
          {GROUP_ORDER.filter(g => g !== 'done').map(g => <option key={g} value={g}>{GROUP_LABELS[g]}</option>)}
        </select>
        <select value={dealFilter} onChange={e => setDealFilter(e.target.value)} className={`${listSelect} max-w-full sm:max-w-xs`} aria-label="Deal">
          <option value="">Any deal</option>
          <option value="-">Not about a deal</option>
          {filterDeals.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
        {anyFilter && (
          <button type="button" className="text-sm font-semibold text-accent hover:underline"
            onClick={() => { setSearch(''); setPersonFilter(''); setDueFilter(''); setDealFilter(''); }}>Clear filters</button>
        )}
      </div>

      {/* Groups */}
      {!loaded ? (
        <p className="flex items-center gap-2 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading tasks…</p>
      ) : (
        <div className="space-y-5">
          {empty && (
            <div className="rounded-2xl border border-line bg-white p-8 text-center">
              <p className="font-semibold">{anyFilter ? 'No task matches these filters' : scope === 'asked' ? "You haven't given anyone a task" : 'Nothing to do'}</p>
              <p className="mt-1 text-[15px] text-ink-soft">{anyFilter ? 'Try clearing a filter.' : 'Add a task above. Give it a due date so it shows up on time.'}</p>
            </div>
          )}
          {openFlat.length > 0 && (
            <div ref={openTop} className="scroll-mt-4 space-y-5">
              {GROUP_ORDER.filter(g => g !== 'done').map(g => {
                const rows = pagedOpen.pageItems.filter(t => taskGroup(t, today) === g);
                return rows.length ? (
                  <section key={g}>
                    <h3 className={`mb-2 text-[15px] font-bold ${GROUP_TONE[g]}`}>{GROUP_LABELS[g]} ({grouped[g].length})</h3>
                    <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">
                      {rows.map(t => <TaskRow key={t.id} {...rowProps(t, g)} />)}
                    </ul>
                  </section>
                ) : null;
              })}
              <div className="overflow-hidden rounded-2xl border border-line"><ListPager paged={pagedOpen} noun="open tasks" top={openTop} /></div>
            </div>
          )}
          {grouped.done.length > 0 && (
            <section>
              <button type="button" onClick={() => setShowDone(v => !v)} className="mb-2 flex items-center gap-1 text-[15px] font-bold text-ink-soft hover:text-ink">
                {showDone ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />} Done ({grouped.done.length})
              </button>
              {showDone && (
                <div className="overflow-hidden rounded-2xl border border-line bg-white">
                  <ul className="divide-y divide-line">
                    {pagedDone.pageItems.map(t => <TaskRow key={t.id} {...rowProps(t, 'done')} />)}
                  </ul>
                  <ListPager paged={pagedDone} noun="done tasks" />
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {openTask && (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" role="dialog" aria-modal="true" onClick={() => setOpenId(null)}>
          <PanelResizer />
          <div className="h-full w-full md:w-[var(--panel-w,max(50vw,40rem))] md:min-w-[24rem] md:max-w-[95vw] overflow-y-auto bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <TaskPanel key={openTask.id} t={openTask} team={team} clients={clientRefs} nameOf={nameOf} dealChoices={dealChoices} deals={deals} dealLabel={dealLabel}
              canChange={canChange(openTask)} canDelete={canDelete(openTask)} me={me} onOpenDeals={onOpenDeals} onOpenDeal={onOpenDeal} onOpenClient={onOpenClient}
              onClose={() => setOpenId(null)} onToggle={() => toggleDone(openTask)} onSaved={() => flash('Task saved')} onDeleted={() => { setOpenId(null); flash('Task deleted'); }} />
          </div>
        </div>
      )}

      {doneAsk && (
        <DoneDialog t={doneAsk} onCancel={() => setDoneAsk(null)}
          onDone={async note => { const t = doneAsk; setDoneAsk(null); await setDone(t, true, note); }} />
      )}
    </div>
  );
}

// The task's text, with client tags as links to the client page.
function DetailText({ t, onOpenClient, className }: { t: Task; onOpenClient?: (id: string) => void; className?: string }) {
  const text = t.detail || 'No details';
  const tags = tagsOf(t).sort((a, b) => b.companyName.length - a.companyName.length);
  if (!tags.length) return <span className={className}>{text}</span>;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(@(?:${tags.map(c => esc(c.companyName)).join('|')}))`, 'g'));
  return (
    <span className={className}>
      {parts.map((part, i) => {
        const c = part.startsWith('@') ? tags.find(x => `@${x.companyName}` === part) : undefined;
        if (!c) return <React.Fragment key={i}>{part}</React.Fragment>;
        return onOpenClient
          ? <button key={i} type="button" onClick={e => { e.stopPropagation(); onOpenClient(c.id); }} className="font-semibold text-accent hover:underline">{part}</button>
          : <strong key={i} className="text-accent">{part}</strong>;
      })}
    </span>
  );
}

function TaskRow({ t, g, scope, rep, canTick, nameOf, deal, dealLabel, onOpenClient, onToggle, onOpen }: {
  t: Task; g: TaskGroup; scope: Scope; rep: Representative; canTick: boolean; nameOf: (id: string, f?: string) => string;
  deal: any; dealLabel: (d: any) => string; onOpenClient?: (id: string) => void; onToggle: () => void; onOpen: () => void; key?: string;
}) {
  const done = isDone(t);
  const forNames = assigneesOf(t).map(id => nameOf(id, id === t.assignedToId ? t.assignedTo : '')).join(', ');
  const others = assigneesOf(t).filter(id => id !== rep.id).map(id => nameOf(id));
  const who = scope === 'mine'
    ? [assignerOf(t) !== rep.id ? `From ${nameOf(assignerOf(t), t.assignedBy)}` : '', others.length ? `with ${others.join(', ')}` : ''].filter(Boolean).join(', ')
    : scope === 'asked' ? `For ${forNames}`
      : `${forNames}${!isAssignedTo(t, assignerOf(t)) || assigneesOf(t).length > 1 ? `, from ${nameOf(assignerOf(t), t.assignedBy)}` : ''}`;
  const when = done ? `Done ${formatDate(t.doneAt || '')}${t.doneByName ? ` by ${t.doneByName}` : ''}` : t.dateline ? formatDate(t.dateline) : '';
  return (
    <li className="flex items-start gap-3 px-4 py-3 hover:bg-surface">
      <button type="button" disabled={!canTick} onClick={onToggle} className="mt-0.5 shrink-0 disabled:cursor-not-allowed disabled:opacity-40" aria-label={done ? 'Mark not done' : 'Mark done'}>
        {done ? <CheckCircle2 className="h-5 w-5 text-accent" /> : <Circle className={`h-5 w-5 ${g === 'overdue' ? 'text-danger' : 'text-ink-soft/60'}`} />}
      </button>
      {/* A div, not a button, so the client tags inside can be their own buttons */}
      <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }} className="min-w-0 flex-1 cursor-pointer text-left">
        <DetailText t={t} onOpenClient={onOpenClient} className={`block whitespace-pre-line text-[15px] ${done ? 'text-ink-soft line-through' : ''}`} />
        <span className="mt-0.5 block text-sm text-ink-soft">
          {t.source === '121' && <span className="mr-1.5 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700">From 1-to-1{t.meetingDate ? `, ${formatDate(t.meetingDate)}` : ''}</span>}
          {t.source === 'meeting' && <span className="mr-1.5 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">Action point{t.meetingDate ? `, meeting ${formatDate(t.meetingDate)}` : ''}</span>}
          {[who, deal ? dealLabel(deal) : '', deal && t.stepLabel ? t.stepLabel : ''].filter(Boolean).join(' · ')}
        </span>
      </div>
      <span className={`shrink-0 text-right text-sm ${g === 'overdue' ? 'font-semibold text-danger' : 'text-ink-soft'}`}>{when}</span>
    </li>
  );
}

// ---------- "@" suggestions: clients and teammates ----------
function MentionInput({ value, onChange, clients, people, onPickClient, onPickPerson, placeholder, ariaLabel, multiline, disabled, id }: {
  value: string; onChange: (v: string) => void; clients: ClientRef[]; people: Person[];
  onPickClient: (c: ClientRef) => void; onPickPerson: (p: Person) => void;
  placeholder?: string; ariaLabel?: string; multiline?: boolean; disabled?: boolean; id?: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [closed, setClosed] = useState(false);
  const [active, setActive] = useState(0);
  const before = value.slice(0, caret);
  const m = /(^|\s)@([^@\n]{0,40})$/.exec(before);
  const q = m ? m[2].trim().toLowerCase() : '';
  const options = m ? [
    ...clients.filter(c => !q || c.companyName.toLowerCase().includes(q)).slice(0, 6).map(c => ({ kind: 'client' as const, id: c.id, name: c.companyName, c })),
    ...people.filter(p => !q || p.name.toLowerCase().includes(q)).slice(0, 4).map(p => ({ kind: 'person' as const, id: p.id, name: p.name, p })),
  ] : [];
  const open = !!m && !closed && !disabled && options.length > 0;
  useCloseOnOutside(wrap, open, () => setClosed(true));

  const pick = (o: typeof options[number]) => {
    const start = caret - m![2].length - 1;   // the "@"
    const next = `${value.slice(0, start)}@${o.name} ${value.slice(caret)}`;
    onChange(next);
    if (o.kind === 'client') onPickClient(o.c); else onPickPerson(o.p);
    const pos = start + o.name.length + 2;
    setCaret(pos);
    requestAnimationFrame(() => { field.current?.focus(); field.current?.setSelectionRange(pos, pos); });
  };
  const common = {
    ref: field, id, value, disabled, placeholder, 'aria-label': ariaLabel, className: `${input} ${multiline ? 'resize-y' : ''}`,
    'aria-expanded': open, 'aria-autocomplete': 'list' as const,
    onChange: (e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => { onChange(e.target.value); setCaret(e.target.selectionStart ?? e.target.value.length); setClosed(false); setActive(0); },
    onSelect: (e: React.SyntheticEvent<HTMLInputElement & HTMLTextAreaElement>) => setCaret((e.target as HTMLInputElement).selectionStart ?? value.length),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (!open) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => (a + 1) % options.length); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => (a - 1 + options.length) % options.length); }
      else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(options[Math.min(active, options.length - 1)]); }
    },
  };
  return (
    <div ref={wrap} className="relative">
      {multiline ? <textarea {...common} rows={4} /> : <input {...common} />}
      {open && (
        <ul role="listbox" className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border border-line bg-white py-1 shadow-lg">
          {options.map((o, i) => (
            <li key={`${o.kind}_${o.id}`} role="option" aria-selected={i === active}>
              <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => pick(o)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[15px] ${i === active ? 'bg-surface' : 'hover:bg-surface'}`}>
                {o.kind === 'client' ? <Building2 className="h-4 w-4 shrink-0 text-accent" /> : <User className="h-4 w-4 shrink-0 text-ink-soft" />}
                <span className="truncate">{o.name}</span>
                <span className="ml-auto shrink-0 text-xs text-ink-soft">{o.kind === 'client' ? 'Client' : 'Teammate'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- Who it's for: one or more teammates ----------
export function PeoplePicker({ ids, team, meId, nameOf, onChange, disabled }: {
  ids: string[]; team: Person[]; meId: string; nameOf: (id: string) => string; onChange: (ids: string[]) => void; disabled?: boolean;
}) {
  const rest = team.filter(p => !ids.includes(p.id));
  return (
    <div className="flex min-h-[42px] flex-wrap items-center gap-1.5 rounded-lg border border-line bg-white px-2 py-1.5">
      {ids.map(id => (
        <span key={id} className="inline-flex items-center gap-1 rounded-md bg-surface px-2 py-0.5 text-sm font-semibold">
          {nameOf(id)}{id === meId ? ' (me)' : ''}
          {!disabled && ids.length > 1 && <button type="button" onClick={() => onChange(ids.filter(x => x !== id))} className="rounded p-0.5 text-ink-soft hover:text-danger" aria-label={`Remove ${nameOf(id)}`}><X className="h-3.5 w-3.5" /></button>}
        </span>
      ))}
      {!disabled && rest.length > 0 && (
        <select value="" onChange={e => { if (e.target.value) onChange([...ids, e.target.value]); }} aria-label="Add a person" className="min-w-0 flex-1 rounded-md border-0 bg-transparent py-0.5 text-sm text-accent focus:outline-none">
          <option value="">+ Add a person</option>
          {rest.map(p => <option key={p.id} value={p.id}>{p.name}{p.id === meId ? ' (me)' : ''}</option>)}
        </select>
      )}
    </div>
  );
}

// ---------- Ticking a client-tagged task done: "What happened?" ----------
function DoneDialog({ t, onCancel, onDone }: { t: Task; onCancel: () => void; onDone: (note?: { text: string; how: TouchHow }) => void }) {
  const [text, setText] = useState('');
  const [how, setHow] = useState<TouchHow>('call');
  const names = tagsOf(t).map(c => c.companyName).join(', ');
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/40 p-4" role="dialog" aria-modal="true" aria-labelledby="done-title" onClick={onCancel}>
      <div className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
        <div>
          <h3 id="done-title" className="text-lg font-bold">What happened?</h3>
          <p className="text-sm text-ink-soft">Optional, but it helps the team: it's saved as a touch point on {names}, so it counts as the last contact.</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(TOUCH_HOW_LABELS) as TouchHow[]).map(h => (
            <button key={h} type="button" aria-pressed={how === h} onClick={() => setHow(h)}
              className={`rounded-full border px-3 py-1 text-sm font-medium ${how === h ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-soft hover:bg-surface'}`}>
              {TOUCH_HOW_LABELS[h]}
            </button>
          ))}
        </div>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={4} maxLength={2000} autoFocus aria-label="What happened"
          placeholder="e.g. Called Encik Hafiz; they'll confirm the dates next week" className={`${input} resize-y`} />
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnPrimary} disabled={!text.trim()} onClick={() => onDone({ text, how })}><CheckCircle2 className="h-4 w-4" /> Save and mark done</button>
          <button type="button" className={btnSecondary} onClick={() => onDone()}>Mark done without a note</button>
          <button type="button" className="text-sm font-semibold text-ink-soft hover:underline" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function TaskPanel({ t, team, clients, nameOf, dealChoices, deals, dealLabel, canChange, canDelete, me, onOpenDeals, onOpenDeal, onOpenClient, onClose, onToggle, onSaved, onDeleted }: {
  t: Task; team: Person[]; clients: ClientRef[]; nameOf: (id: string, f?: string) => string; dealChoices: any[]; deals: any[]; dealLabel: (d: any) => string;
  canChange: boolean; canDelete: boolean; me: Viewer; onOpenDeals?: () => void; onOpenDeal?: (dealId: string) => void; onOpenClient?: (id: string) => void;
  onClose: () => void; onToggle: () => void; onSaved: () => void; onDeleted: () => void; key?: string;
}) {
  const [detail, setDetail] = useState(t.detail || '');
  const [due, setDue] = useState(t.dateline || '');
  const [to, setTo] = useState<string[]>(assigneesOf(t));
  const [tagged, setTagged] = useState<ClientRef[]>(tagsOf(t));
  const [dealId, setDealId] = useState(t.pipelineId || '');
  // Unsaved changes are kept in this browser until saved (lib/useFormDraft.ts).
  const editDraft = useFormDraft(me.id, canChange ? `todo:${t.id}` : null, { detail, due, to, tagged, dealId },
    v => { setDetail(v.detail); setDue(v.due); setTo(v.to); setTagged(v.tagged); setDealId(v.dealId); });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const deal = deals.find(d => d.id === dealId);
  const tags = keptClients(detail, tagged);
  const changed = detail.trim() !== (t.detail || '') || due !== (t.dateline || '') || to.join() !== assigneesOf(t).join() || dealId !== (t.pipelineId || '')
    || tags.map(c => c.id).join() !== (t.clientIds || []).join();
  // Keep a linked deal in the list even if it's not one of this person's choices.
  const choices = deal && !dealChoices.some(d => d.id === deal.id) ? [deal, ...dealChoices] : dealChoices;
  // Keep everyone it's for in the list, even someone no longer on the team.
  const people = [...team, ...to.filter(id => !team.some(p => p.id === id)).map(id => ({ id, name: nameOf(id, id === t.assignedToId ? t.assignedTo : '') }))];

  const save = async () => {
    setError('');
    if (!detail.trim()) return setError('Write what needs doing.');
    if (!to.length) return setError('Pick who it is for.');
    setBusy(true);
    try {
      await updateDoc(doc(db, 'tasks', t.id), {
        detail: detail.trim(), dateline: due, assignedToId: to[0], assignedTo: nameOf(to[0]), assignedToIds: to, ownerRepId: to[0], pipelineId: dealId,
        clientIds: tags.map(c => c.id), clientNames: tags.map(c => c.companyName),
      });
      editDraft.clear();
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

      {tagsOf(t).length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink-soft">Client:</span>
          {tagsOf(t).map(c => onOpenClient
            ? <button key={c.id} type="button" onClick={() => onOpenClient(c.id)} className="inline-flex items-center gap-1 rounded-md bg-accent-soft px-2 py-0.5 font-semibold text-accent hover:underline"><Building2 className="h-3.5 w-3.5" />{c.companyName}</button>
            : <span key={c.id} className="inline-flex items-center gap-1 rounded-md bg-accent-soft px-2 py-0.5 font-semibold text-accent"><Building2 className="h-3.5 w-3.5" />{c.companyName}</span>)}
        </div>
      )}

      <DraftBar draft={editDraft} what="change to this To-do" />
      <fieldset disabled={!canChange} className="min-w-0 space-y-4">
        <div>
          <label className={label} htmlFor="tp-detail">What needs doing</label>
          <MentionInput id="tp-detail" multiline value={detail} onChange={setDetail} clients={clients} people={team} disabled={!canChange}
            onPickClient={c => setTagged(x => (x.some(y => y.id === c.id) ? x : [...x, c]))}
            onPickPerson={p => setTo(x => (x.includes(p.id) ? x : [...x, p.id]))} />
          <p className="mt-1 text-sm text-ink-soft">Type @ to tag a client or a teammate. Delete a client's @name to untag it.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="tp-due">Due</label>
            <input id="tp-due" type="date" value={due} onChange={e => setDue(e.target.value)} className={input} />
          </div>
          <div>
            <span className={label}>For</span>
            <PeoplePicker ids={to} team={people} meId={me.id} nameOf={id => nameOf(id, id === t.assignedToId ? t.assignedTo : '')} onChange={setTo} disabled={!canChange} />
          </div>
        </div>
        <div>
          <label className={label} htmlFor="tp-deal">About a deal</label>
          <select id="tp-deal" value={dealId} onChange={e => setDealId(e.target.value)} className={input}>
            <option value="">No deal</option>
            {choices.map(d => <option key={d.id} value={d.id}>{dealLabel(d)}</option>)}
          </select>
          {deal && t.stepLabel && dealId === t.pipelineId && <span className="mt-1 block text-sm text-ink-soft">Step: {t.stepLabel}</span>}
          {deal && (onOpenDeal || onOpenDeals) && (
            <button type="button" className="mt-1 text-sm font-semibold text-accent hover:underline" onClick={() => (onOpenDeal ? onOpenDeal(deal.id) : onOpenDeals!())}>
              {onOpenDeal ? (t.ask === 'payment' ? 'Open the deal to raise the payment' : 'Open the deal') : 'Go to Deals'}
            </button>
          )}
        </div>
      </fieldset>
      {!canChange && <p className="rounded-lg bg-surface px-3.5 py-2.5 text-sm text-ink-soft">Only the people it's for, the person who assigned it, or Management can change this task.</p>}

      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</p>}

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        {canChange && <button type="button" disabled={busy || !changed} onClick={save} className={btnPrimary}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save</button>}
        <button type="button" onClick={onClose} className={btnSecondary}>Close</button>
        {canDelete && <button type="button" disabled={busy} onClick={remove} className="ml-auto inline-flex items-center gap-1.5 text-sm font-semibold text-danger hover:underline"><Trash2 className="h-4 w-4" /> Delete task</button>}
      </div>
    </div>
  );
}
