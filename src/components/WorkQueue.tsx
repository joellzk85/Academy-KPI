import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, query, setDoc } from 'firebase/firestore';
import { AlertTriangle, ArrowDown, ArrowUp, ChevronDown, ChevronRight, Loader2, Plus, RotateCcw, Search, X } from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import { FUNDING_LABELS, FundingType, dealOwnerId, dealStage, dealValue, dealWonDate, formatDate, formatRM, todayIso } from '../lib/deals';
import {
  APPLIES_LABELS, AppliesTo, ChecklistSettings, KIND_LABELS, TaskTemplate, checklistFlags, daysUntil, newTaskId, progress,
} from '../lib/checklist';
import { buildQuotationForDeal } from '../lib/dealDocs';
import DealChecklist, { ProgressBar, startChecklist, useChecklistSettings } from './DealChecklist';
import HrdcQueries from './HrdcQueries';
import MoneyPanel, { MoneyOverview, useMoneySettings } from './Money';
import { MoneyIn, MoneyOut, moneyFlags, moneySettled } from '../lib/money';
import ProgrammesManager, { StatusChip } from './Programmes';
import { Flag } from '../lib/checklist';
import { HrdcQuery, Programme, grantBlockReason, isQueryOpen, isQueryOverdue } from '../lib/programmes';

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };

const field =
  'rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';
const iconBtn = 'rounded-md p-1.5 text-ink-soft hover:bg-surface hover:text-ink disabled:opacity-30';

export default function WorkQueue({ viewer, people, onOpenQuotations, initialView = 'queue' }: {
  viewer: Viewer;
  people: { id: string; name: string }[];
  onOpenQuotations: (repId: string) => void;   // opens that person's quotation library
  initialView?: 'queue' | 'money' | 'programmes' | 'tasks';   // which tab to open (from My home)
}) {
  const [view, setView] = useState<'queue' | 'money' | 'programmes' | 'tasks'>(initialView);
  return (
    <div className="space-y-5 font-sans text-ink">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Admin work</h2>
          <p className="mt-0.5 text-[15px] text-ink-soft">Every won deal and what still needs doing, soonest training first.</p>
        </div>
        <div className="inline-flex rounded-lg border border-line bg-white p-0.5" role="tablist">
          {([['queue', 'Work queue'], ['money', 'Money'], ['programmes', 'Programmes'], ['tasks', 'Checklist tasks']] as const).map(([k, t]) => (
            <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold ${view === k ? 'bg-ink text-white' : 'text-ink-soft hover:text-ink'}`}>
              {t}
            </button>
          ))}
        </div>
      </div>
      {view === 'queue' ? <Queue viewer={viewer} people={people} onOpenQuotations={onOpenQuotations} /> : view === 'money' ? <MoneyOverview viewer={viewer} /> : view === 'programmes' ? <ProgrammesView viewer={viewer} /> : <TaskSettings viewer={viewer} />}
    </div>
  );
}

// ---------- Work queue ----------
function Queue({ viewer, people, onOpenQuotations }: { viewer: Viewer; people: { id: string; name: string }[]; onOpenQuotations: (repId: string) => void }) {
  const settings = useChecklistSettings();
  const [deals, setDeals] = useState<any[]>([]);
  const [checklists, setChecklists] = useState<Record<string, any>>({});
  const [quotes, setQuotes] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [queries, setQueries] = useState<HrdcQuery[]>([]);
  const [moneyIn, setMoneyIn] = useState<MoneyIn[]>([]);
  const [moneyOut, setMoneyOut] = useState<MoneyOut[]>([]);
  const moneySettings = useMoneySettings();
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<'open' | 'flagged' | 'done'>('open');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [showUnstarted, setShowUnstarted] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [toast, setToast] = useState('');

  useEffect(() => {
    const subs = [
      onSnapshot(query(collection(db, 'pipelines')), s => { setDeals(s.docs.map(d => ({ ...d.data(), id: d.id }))); setLoaded(true); }, () => setLoaded(true)),
      onSnapshot(query(collection(db, 'deal_checklists')), s => setChecklists(Object.fromEntries(s.docs.map(d => [d.id, d.data()])))),
      onSnapshot(query(collection(db, 'quotations')), s => setQuotes(s.docs.map(d => ({ ...d.data(), id: d.id })))),
      onSnapshot(query(collection(db, 'clients')), s => setClients(s.docs.map(d => ({ ...d.data(), id: d.id })))),
      onSnapshot(query(collection(db, 'programmes')), s => setProgrammes(s.docs.map(d => ({ ...(d.data() as Programme), id: d.id })))),
      onSnapshot(query(collection(db, 'hrdc_queries')), s => setQueries(s.docs.map(d => ({ ...(d.data() as HrdcQuery), id: d.id })))),
      onSnapshot(query(collection(db, 'money_in')), s => setMoneyIn(s.docs.map(d => ({ ...(d.data() as MoneyIn), id: d.id })))),
      onSnapshot(query(collection(db, 'money_out')), s => setMoneyOut(s.docs.map(d => ({ ...(d.data() as MoneyOut), id: d.id })))),
    ];
    return () => subs.forEach(u => u());
  }, []);

  const flash = (t: string) => { setToast(t); window.setTimeout(() => setToast(x => (x === t ? '' : x)), 3500); };
  const today = todayIso();
  const personName = (id: string) => people.find(p => p.id === id)?.name || 'Former team member';
  const clientName = (p: any) => clients.find(c => c.id === p.clientId)?.companyName || p.client || 'No client';

  const byTrainingDate = (a: any, b: any) => {
    const da = /^\d{4}-\d{2}-\d{2}/.test(a.trainingDate || '') ? a.trainingDate : '9999';
    const dbb = /^\d{4}-\d{2}-\d{2}/.test(b.trainingDate || '') ? b.trainingDate : '9999';
    return da.localeCompare(dbb);
  };

  const won = useMemo(() => deals.filter(p => dealStage(p) === 'won'), [deals]);
  const programmeOf = (p: any) => programmes.find(x => x.id === p.programmeId);
  const courseOf = (p: any) => programmeOf(p)?.name || p.courseName || '';
  const queriesOf = (p: any) => queries.filter(q => q.dealId === p.id);

  const rows = useMemo(() => won.filter(p => checklists[p.id]).map(p => {
    const cl = checklists[p.id];
    const pr = progress(cl.tasks, p.fundingType);
    const open = queriesOf(p).filter(isQueryOpen);
    const overdue = open.filter(q => isQueryOverdue(q, today));
    const flags: Flag[] = [];
    // HRDC queries come first: they need a reply by a set date.
    overdue.forEach(q => flags.push({ level: 'danger', text: `HRDC query overdue (reply was due ${formatDate(q.replyBy)})` }));
    open.filter(q => !overdue.includes(q)).forEach(q => flags.push({ level: 'danger', text: `HRDC query open, reply by ${formatDate(q.replyBy)}` }));
    const grantTask = (cl.tasks || []).find((t: any) => t.kind === 'grant');
    const block = grantBlockReason(p, programmeOf(p));
    if (block && grantTask && !grantTask.done) flags.push({ level: 'attention', text: p.programmeId ? 'Programme not yet approved by HRDC' : 'Programme not picked from the list' });
    flags.push(...checklistFlags(p, cl.tasks, settings, today));
    const mIn = moneyIn.filter(m => m.dealId === p.id);
    const mOut = moneyOut.filter(m => m.dealId === p.id);
    flags.push(...moneyFlags(p, mIn, mOut, moneySettings, today));
    return { deal: p, pr, overdue: overdue.length > 0, complete: pr.total > 0 && pr.done === pr.total && open.length === 0 && moneySettled(mIn, mOut), flags };
  }), [won, checklists, settings, today, queries, programmes, moneyIn, moneyOut, moneySettings]);
  const unstarted = useMemo(() => won.filter(p => !checklists[p.id]).sort(byTrainingDate), [won, checklists]);

  const counts = {
    open: rows.filter(r => !r.complete).length,
    flagged: rows.filter(r => r.flags.some(f => f.level === 'danger')).length,
    done: rows.filter(r => r.complete).length,
  };

  const visible = useMemo(() => {
    const base = rows.filter(r => (filter === 'done' ? r.complete : filter === 'flagged' ? r.flags.some(f => f.level === 'danger') : !r.complete));
    const q = search.trim().toLowerCase();
    const list = q ? base.filter(r => `${clientName(r.deal)} ${courseOf(r.deal)} ${personName(dealOwnerId(r.deal))}`.toLowerCase().includes(q)) : base;
    return list.sort((a, b) => {
      if (filter === 'done') return byTrainingDate(b.deal, a.deal);
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;   // overdue HRDC queries go to the top
      return byTrainingDate(a.deal, b.deal);
    });
  }, [rows, filter, search, clients, people, programmes]);

  const openRow = rows.find(r => r.deal.id === openId);
  const openDeal = openRow?.deal || won.find(p => p.id === openId) || null;

  const start = async (p: any) => {
    setBusyId(p.id);
    try {
      await startChecklist(p, settings, viewer, checklists[p.id]);
      flash('Checklist started');
    } catch (err) {
      flash(friendlyError(err));
    } finally {
      setBusyId('');
    }
  };

  const createQuotation = async (p: any) => {
    const owner = { id: dealOwnerId(p) || viewer.id, name: personName(dealOwnerId(p)) };
    const q = buildQuotationForDeal(p, viewer, owner, clients.find(c => c.id === p.clientId), quotes.length);
    try {
      await setDoc(doc(db, 'quotations', q.id), q);
      onOpenQuotations(owner.id);
    } catch (err) {
      flash(friendlyError(err));
    }
  };

  const whenText = (p: any) => {
    const d = daysUntil(p.trainingDate, today);
    if (d === null) return 'No training date';
    const date = formatDate(p.trainingDate);
    if (d === 0) return `${date} (today)`;
    if (d === 1) return `${date} (tomorrow)`;
    if (d > 1 && d <= 30) return `${date} (in ${d} days)`;
    return date;
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2" role="tablist" aria-label="Filter the work queue">
        {([['open', 'In progress'], ['flagged', 'Needs attention'], ['done', 'All done']] as const).map(([k, t]) => {
          const active = filter === k;
          return (
            <button key={k} type="button" role="tab" aria-selected={active} onClick={() => setFilter(k)}
              className={`rounded-xl border px-3.5 py-3 text-left transition-colors ${active ? 'border-accent bg-accent-soft' : 'border-line bg-white hover:bg-surface'}`}>
              <span className={`block text-sm font-semibold ${k === 'flagged' && counts.flagged ? 'text-danger' : 'text-ink-soft'}`}>{t}</span>
              <span className="mt-1 block text-2xl font-bold leading-none">{counts[k]}</span>
            </button>
          );
        })}
      </div>

      <div className="relative sm:w-72">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search client, programme or rep" className={`${input} pl-9`} aria-label="Search the work queue" />
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-white">
        {!loaded ? (
          <p className="flex items-center gap-2 p-6 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
        ) : visible.length === 0 ? (
          <div className="p-8 text-center">
            <p className="font-semibold">{filter === 'done' ? 'No finished checklists yet' : filter === 'flagged' ? 'Nothing urgent right now' : 'No won deals waiting on admin'}</p>
            {filter === 'open' && <p className="mt-1 text-[15px] text-ink-soft">When a rep marks a deal as won, it appears here with its checklist.</p>}
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {visible.map(({ deal: p, pr, flags }) => (
              <li key={p.id}>
                <button type="button" onClick={() => setOpenId(p.id)} className="grid w-full gap-2 px-5 py-3.5 text-left hover:bg-surface sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] sm:items-center sm:gap-4">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{clientName(p)}</span>
                    <span className="block truncate text-sm text-ink-soft">{courseOf(p) || 'No programme'} · {personName(dealOwnerId(p))}</span>
                  </span>
                  <span className="min-w-0 text-sm">
                    <span className="block font-semibold">{whenText(p)}</span>
                    {p.fundingType && <span className="text-ink-soft">{FUNDING_LABELS[p.fundingType as FundingType]}</span>}
                  </span>
                  <span className="min-w-0 space-y-1">
                    <ProgressBar done={pr.done} total={pr.total} />
                    {flags.map((f, i) => (
                      <span key={i} className={`flex items-center gap-1 text-sm font-semibold ${f.level === 'danger' ? 'text-danger' : 'text-attention'}`}>
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {f.text}
                      </span>
                    ))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {loaded && unstarted.length > 0 && (
        <div className="rounded-2xl border border-line bg-white">
          <button type="button" onClick={() => setShowUnstarted(s => !s)} className="flex w-full items-center gap-2 px-5 py-3.5 text-left font-semibold" aria-expanded={showUnstarted}>
            {showUnstarted ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            Won deals without a checklist ({unstarted.length})
            <span className="ml-auto text-sm font-normal text-ink-soft">Usually older deals, won before checklists existed</span>
          </button>
          {showUnstarted && (
            <ul className="divide-y divide-line border-t border-line">
              {unstarted.map(p => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{clientName(p)}</span>
                    <span className="block truncate text-sm text-ink-soft">
                      {courseOf(p) || 'No programme'} · {personName(dealOwnerId(p))} · won {formatDate(dealWonDate(p)) || 'earlier'} · {dealValue(p) ? formatRM(dealValue(p)) : '—'}
                    </span>
                  </span>
                  <span className="text-sm text-ink-soft">{whenText(p)}</span>
                  <button type="button" disabled={busyId === p.id} onClick={() => start(p)} className={btnSecondary}>
                    {busyId === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Start checklist
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {openDeal && (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" role="dialog" aria-modal="true" onClick={() => setOpenId(null)}>
          <div className="h-full w-full max-w-xl space-y-5 overflow-y-auto bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="truncate text-lg font-bold">{clientName(openDeal)}</h3>
                <p className="text-[15px] text-ink-soft">{courseOf(openDeal) || 'No programme'}</p>
              </div>
              <button type="button" onClick={() => setOpenId(null)} className="rounded-md p-1 text-ink-soft hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[15px]">
              <div><dt className="text-sm text-ink-soft">Training date</dt><dd className="font-semibold">{whenText(openDeal)}</dd></div>
              <div><dt className="text-sm text-ink-soft">Paid by</dt><dd className="font-semibold">{openDeal.fundingType ? FUNDING_LABELS[openDeal.fundingType as FundingType] : 'Not set'}</dd></div>
              <div><dt className="text-sm text-ink-soft">Rep</dt><dd className="font-semibold">{personName(dealOwnerId(openDeal))}</dd></div>
              <div><dt className="text-sm text-ink-soft">Value</dt><dd className="font-semibold">{dealValue(openDeal) ? formatRM(dealValue(openDeal)) : '—'}</dd></div>
              <div><dt className="text-sm text-ink-soft">Won on</dt><dd className="font-semibold">{formatDate(dealWonDate(openDeal)) || '—'}</dd></div>
              {programmeOf(openDeal) && (
                <div><dt className="text-sm text-ink-soft">Programme</dt><dd className="flex flex-wrap items-center gap-2 font-semibold"><StatusChip programme={programmeOf(openDeal)} />{programmeOf(openDeal)?.hrdcCode && <span className="text-sm font-normal text-ink-soft">Code {programmeOf(openDeal)?.hrdcCode}</span>}</dd></div>
              )}
            </dl>
            {!/^\d{4}-\d{2}-\d{2}/.test(openDeal.trainingDate || '') && (
              <p className="rounded-lg bg-attention-soft px-3.5 py-2.5 text-sm text-attention">No training date yet. Add it on the deal itself: open {personName(dealOwnerId(openDeal))}'s workspace, then Deals, then Edit details.</p>
            )}
            <section>
              <h4 className="mb-2 font-bold">Admin checklist</h4>
              <DealChecklist
                deal={openDeal}
                checklist={checklists[openDeal.id] || null}
                quotes={quotes.filter(q => q.pipelineId === openDeal.id)}
                viewer={viewer}
                onCreateQuotation={() => createQuotation(openDeal)}
                onOpenQuotations={() => onOpenQuotations(dealOwnerId(openDeal) || viewer.id)}
                grantBlock={grantBlockReason(openDeal, programmeOf(openDeal))}
              />
            </section>
            {(openDeal.fundingType === 'hrdc' || openDeal.fundingType === 'hrdc_topup') && (
              <section>
                <h4 className="mb-2 font-bold">HRDC queries</h4>
                <HrdcQueries deal={openDeal} queries={queriesOf(openDeal)} viewer={viewer} people={people} />
              </section>
            )}
            <section>
              <h4 className="mb-2 font-bold">Money</h4>
              <MoneyPanel deal={openDeal} viewer={viewer} settings={moneySettings}
                ins={moneyIn.filter(m => m.dealId === openDeal.id)} outs={moneyOut.filter(m => m.dealId === openDeal.id)} />
            </section>
          </div>
        </div>
      )}

      {toast && <div role="status" className="fixed bottom-24 left-1/2 z-[60] -translate-x-1/2 rounded-xl bg-ink px-4 py-3 text-sm font-medium text-white shadow-lg">{toast}</div>}
    </div>
  );
}

// ---------- Master task list ----------
function TaskSettings({ viewer }: { viewer: Viewer }) {
  const saved = useChecklistSettings();
  const [draft, setDraft] = useState<ChecklistSettings | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const [newApplies, setNewApplies] = useState<AppliesTo>('all');
  const [newAfter, setNewAfter] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const s = draft || saved;
  const dirty = draft !== null;
  const edit = (next: ChecklistSettings) => { setDraft(next); setMsg(null); };
  const setTasks = (tasks: TaskTemplate[]) => edit({ ...s, tasks });
  const update = (id: string, c: Partial<TaskTemplate>) => setTasks(s.tasks.map(t => (t.id === id ? { ...t, ...c } : t)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= s.tasks.length) return;
    const next = [...s.tasks];
    [next[i], next[j]] = [next[j], next[i]];
    setTasks(next);
  };
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const label = newLabel.trim();
    if (!label) return;
    setTasks([...s.tasks, { id: newTaskId(), label, kind: 'basic', appliesTo: newApplies, after: newAfter }]);
    setNewLabel('');
    setNewApplies('all');
    setNewAfter(false);
  };

  const save = async () => {
    if (s.tasks.some(t => !t.label.trim())) return setMsg({ ok: false, text: 'Every task needs a name.' });
    setBusy(true);
    try {
      await setDoc(doc(db, 'config', 'checklist_tasks'), {
        tasks: JSON.parse(JSON.stringify(s.tasks.map(t => ({ ...t, label: t.label.trim() })))),
        flagDays: s.flagDays,
        updatedAt: Date.now(),
        updatedById: viewer.id,
        updatedByName: viewer.name,
      });
      setDraft(null);
      setMsg({ ok: true, text: 'Saved. New won deals will use this list.' });
    } catch (err) {
      setMsg({ ok: false, text: friendlyError(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-[15px] text-ink-soft">
        This is the checklist every newly won deal starts with. Changes apply to deals won from now on; deals already in progress keep their own list
        (open a deal and use "Arrange, add or remove steps" to change just that one).
      </p>

      <div className="overflow-hidden rounded-2xl border border-line bg-white">
        <ul className="divide-y divide-line">
          {s.tasks.map((t, i) => (
            <li key={t.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${t.retired ? 'bg-surface' : ''}`}>
              <span className="w-6 text-sm font-semibold tabular-nums text-ink-soft">{i + 1}.</span>
              <input value={t.label} onChange={e => update(t.id, { label: e.target.value })} disabled={t.retired}
                className={`${field} min-w-[12rem] flex-1 ${t.retired ? 'text-ink-soft line-through' : ''}`} aria-label={`Name of task ${i + 1}`} />
              <select value={t.appliesTo} onChange={e => update(t.id, { appliesTo: e.target.value as AppliesTo })} disabled={t.retired || t.kind === 'grant'}
                className={field} aria-label={`Which deals task ${i + 1} applies to`}>
                {(Object.keys(APPLIES_LABELS) as AppliesTo[]).map(a => <option key={a} value={a}>{APPLIES_LABELS[a]}</option>)}
              </select>
              <select value={t.after ? 'after' : 'before'} onChange={e => update(t.id, { after: e.target.value === 'after' })} disabled={t.retired || t.kind !== 'basic'}
                className={field} aria-label={`When task ${i + 1} is done`}>
                <option value="before">Before training</option>
                <option value="after">After training</option>
              </select>
              <span className="w-24 text-center">
                {t.kind !== 'basic' && <span className="rounded-md bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent" title="This step has its own fields">{KIND_LABELS[t.kind]}</span>}
              </span>
              <span className="ml-auto flex items-center">
                <button type="button" className={iconBtn} disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${t.label} up`}><ArrowUp className="h-4 w-4" /></button>
                <button type="button" className={iconBtn} disabled={i === s.tasks.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${t.label} down`}><ArrowDown className="h-4 w-4" /></button>
                {t.retired ? (
                  <button type="button" className={`${btnSecondary} ml-1 py-1.5`} onClick={() => update(t.id, { retired: false })}><RotateCcw className="h-3.5 w-3.5" /> Bring back</button>
                ) : (
                  <button type="button" className={`${btnSecondary} ml-1 py-1.5 text-danger hover:bg-danger-soft`} onClick={() => update(t.id, { retired: true })}>Stop using</button>
                )}
              </span>
            </li>
          ))}
        </ul>
        <form onSubmit={add} className="flex flex-wrap gap-2 border-t border-line bg-surface/60 px-4 py-3">
          <input value={newLabel} onChange={e => setNewLabel(e.target.value)} className={`${field} min-w-[12rem] flex-1`} placeholder="New task, e.g. Send joining instructions" aria-label="New task name" />
          <select value={newApplies} onChange={e => setNewApplies(e.target.value as AppliesTo)} className={field} aria-label="Which deals the new task applies to">
            {(Object.keys(APPLIES_LABELS) as AppliesTo[]).map(a => <option key={a} value={a}>{APPLIES_LABELS[a]}</option>)}
          </select>
          <select value={newAfter ? 'after' : 'before'} onChange={e => setNewAfter(e.target.value === 'after')} className={field} aria-label="When the new task is done">
            <option value="before">Before training</option>
            <option value="after">After training</option>
          </select>
          <button type="submit" disabled={!newLabel.trim()} className={btnSecondary}><Plus className="h-4 w-4" /> Add task</button>
        </form>
      </div>

      <div className="max-w-md rounded-2xl border border-line bg-white p-4">
        <label htmlFor="flag-days" className="mb-1.5 block text-sm font-semibold">Warn when training is this many days away</label>
        <input id="flag-days" type="number" min={0} max={60} value={s.flagDays}
          onChange={e => edit({ ...s, flagDays: Math.max(0, Math.min(60, Number(e.target.value) || 0)) })} className={`${field} w-28`} />
        <p className="mt-1.5 text-sm text-ink-soft">A deal turns red in the work queue if the grant isn't approved or the trainer isn't confirmed by then. After-training steps only show as a reminder once training day has passed.</p>
      </div>

      {msg && <p role="status" className={`rounded-lg px-3 py-2.5 text-sm ${msg.ok ? 'bg-accent-soft text-accent' : 'bg-danger-soft text-danger'}`}>{msg.text}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={!dirty || busy} onClick={save} className={btnPrimary}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save changes</button>
        {dirty && <button type="button" disabled={busy} onClick={() => { setDraft(null); setMsg(null); }} className={btnSecondary}>Discard</button>}
      </div>
    </div>
  );
}

// ---------- Programmes (HRDC registration) ----------
function ProgrammesView({ viewer }: { viewer: Viewer }) {
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [deals, setDeals] = useState<any[]>([]);
  useEffect(() => {
    const subs = [
      onSnapshot(query(collection(db, 'programmes')), s => setProgrammes(s.docs.map(d => ({ ...(d.data() as Programme), id: d.id })))),
      onSnapshot(query(collection(db, 'pipelines')), s => setDeals(s.docs.map(d => ({ ...d.data(), id: d.id })))),
    ];
    return () => subs.forEach(u => u());
  }, []);
  return <ProgrammesManager programmes={programmes} deals={deals} viewer={viewer} />;
}
