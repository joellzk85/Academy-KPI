import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, onSnapshot, query, setDoc, updateDoc } from 'firebase/firestore';
import { AlertTriangle, ArrowDown, ArrowUp, ChevronDown, ChevronRight, Loader2, Plus, RotateCcw, Search, X } from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import { FUNDING_LABELS, FundingType, dealOwnerId, dealStage, dealValue, dealWonDate, formatDate, formatRM, todayIso, trainingDateText, trainingDays, trainingEndDate, parseTrainingDays, TRAINING_DAYS_PROBLEM } from '../lib/deals';
import TrainingDaysPicker from './TrainingDaysPicker';
import {
  APPLIES_LABELS, AppliesTo, ChecklistSettings, KIND_LABELS, RETIRED_BUILTINS, TaskTemplate, checklistFlags, daysUntil, grantNotAppliedFlag, isLockedStep, leadTrainerTask, newTaskId, progress,
} from '../lib/checklist';
import { buildQuotationForDeal } from '../lib/dealDocs';
import DealChecklist, { ProgressBar, startChecklist, useChecklistSettings } from './DealChecklist';
import TrainingTimeBox from './TrainingTimeBox';
import HrdcQueries from './HrdcQueries';
import MoneyPanel, { MoneyOverview, useMoneySettings } from './Money';
import VendorsPage from './VendorsPage';
import DaysOut from './DaysOut';
import { MoneyIn, MoneyOut, moneyFlags, prePaymentFlags } from '../lib/money';
import AfterTraining from './AfterTraining';
import { useReceipts } from './PaymentReceipts';
import { useClaimBacks } from './ClaimBacks';
import { postTraining, postTrainingFlags } from '../lib/postTraining';
import { claimFlag, jobId, poDeclinedFlag } from '../lib/trainerPortal';
import { useTrainerJobs } from './TrainerPortalAdmin';
import { useTrainingReports } from './TrainingReportAdmin';
import { reportFlag } from '../lib/trainingReport';
const PaymentTracking = React.lazy(() => import('./PaymentTracking'));
import ProgrammesManager, { StatusChip } from './Programmes';
import BackupPanel from './BackupPanel';
import { Flag } from '../lib/checklist';
import { HrdcQuery, Programme, grantBlockReason, isQueryOpen, isQueryOverdue } from '../lib/programmes';
import { ClientLastTouch } from './ClientContactDot';
import { linkedOnly, withoutDeleted } from '../lib/linked';
import { usePlace } from '../lib/loginActivity';
import TrainingChangePanel from './TrainingChange';
import { cancelledTraining, changeFlagText, dateLocked, openTodos, pendingChange } from '../lib/trainingChange';
import PanelResizer from './PanelResizer';
import { moveT3Lists } from './T3Maker';

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

export type AdminView = 'queue' | 'money' | 'payments' | 'vendors' | 'days_out' | 'programmes' | 'tasks' | 'backup';

export default function WorkQueue({ viewer, people, onOpenQuotations, initialView = 'queue', initialDealId = '', deals = [], onOpenManagementPayments }: {
  viewer: Viewer;
  people: { id: string; name: string }[];
  onOpenQuotations: (repId: string) => void;   // opens that person's quotation library
  initialView?: AdminView;                     // which tab to open (from My home)
  initialDealId?: string;                      // a won deal whose panel opens in the work queue (from My home)
  deals?: any[];                               // every deal (for Payment tracking)
  onOpenManagementPayments?: () => void;       // Management's Payment tracking (Management → Payment tracking)
}) {
  const [view, setView] = useState<AdminView>(initialView);
  usePlace(`admin_${view}`, 2);
  const [focusDeal, setFocusDeal] = useState(initialDealId);
  // Payment tracking is in Admin work for Admin; Management has it under Management (with profit), so it isn't repeated.
  const tabs: [AdminView, string][] = [['queue', 'Work queue'], ['money', 'Money'], ...(viewer.role === 'admin' ? [['payments', 'Payment tracking'] as [AdminView, string]] : []), ['vendors', 'Vendors'], ['days_out', 'Days out'], ['programmes', 'Programmes'], ['tasks', 'Checklist tasks'], ['backup', 'Backup']];
  const openPayments = viewer.role === 'admin' ? () => setView('payments') : onOpenManagementPayments;
  return (
    <div className="space-y-5 font-sans text-ink">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Admin work</h2>
          <p className="mt-0.5 text-[15px] text-ink-soft">Every won deal and what still needs doing, soonest training first.</p>
        </div>
        <div className="inline-flex flex-wrap rounded-lg border border-line bg-white p-0.5" role="tablist">
          {tabs.map(([k, t]) => (
            <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold ${view === k ? 'bg-ink text-white' : 'text-ink-soft hover:text-ink'}`}>
              {t}
            </button>
          ))}
        </div>
      </div>
      {view === 'queue' ? <Queue key={focusDeal} viewer={viewer} people={people} onOpenQuotations={onOpenQuotations} initialOpenId={focusDeal} />
        : view === 'money' ? <MoneyOverview viewer={viewer} onOpenPayments={openPayments} onOpenDeal={id => { setFocusDeal(id); setView('queue'); }} />
        : view === 'payments' && viewer.role === 'admin' ? (
          <React.Suspense fallback={<p className="flex items-center gap-2 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}>
            <PaymentTracking pipelinesSync={linkedOnly(deals)} people={people} viewer={viewer} onOpenDeal={d => { setFocusDeal(d.id); setView('queue'); }} />
          </React.Suspense>
        )
        : view === 'vendors' ? <VendorsPage viewer={viewer} />
        : view === 'days_out' ? <DaysOut viewer={viewer} people={people} />
        : view === 'programmes' ? <ProgrammesView viewer={viewer} /> : view === 'tasks' ? <TaskSettings viewer={viewer} /> : <BackupPanel />}
    </div>
  );
}

// ---------- Work queue ----------
function Queue({ viewer, people, onOpenQuotations, initialOpenId = '' }: { viewer: Viewer; people: { id: string; name: string }[]; onOpenQuotations: (repId: string) => void; initialOpenId?: string; key?: string }) {
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
  const receipts = useReceipts(true);
  const claims = useClaimBacks(true);   // paid on behalf of the client, to claim back (2026-10-22)
  const trainerJobs = useTrainerJobs();
  const trainingReports = useTrainingReports();
  const [filter, setFilter] = useState<'open' | 'flagged' | 'after' | 'done'>('open');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(initialOpenId || null);
  const [showUnstarted, setShowUnstarted] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [toast, setToast] = useState('');

  useEffect(() => {
    const subs = [
      onSnapshot(query(collection(db, 'pipelines')), s => { setDeals(linkedOnly(s.docs.map(d => ({ ...d.data(), id: d.id })))); setLoaded(true); }, () => setLoaded(true)),
      onSnapshot(query(collection(db, 'deal_checklists')), s => setChecklists(Object.fromEntries(s.docs.map(d => [d.id, d.data()])))),
      onSnapshot(query(collection(db, 'quotations')), s => setQuotes(linkedOnly(s.docs.map(d => ({ ...d.data(), id: d.id }))))),
      onSnapshot(query(collection(db, 'clients')), s => setClients(s.docs.map(d => ({ ...d.data(), id: d.id })))),
      onSnapshot(query(collection(db, 'programmes')), s => setProgrammes(s.docs.map(d => ({ ...(d.data() as Programme), id: d.id })))),
      onSnapshot(query(collection(db, 'hrdc_queries')), s => setQueries(withoutDeleted(s.docs.map(d => ({ ...(d.data() as HrdcQuery), id: d.id }))))),
      onSnapshot(query(collection(db, 'money_in')), s => setMoneyIn(withoutDeleted(s.docs.map(d => ({ ...(d.data() as MoneyIn), id: d.id }))))),
      onSnapshot(query(collection(db, 'money_out')), s => setMoneyOut(withoutDeleted(s.docs.map(d => ({ ...(d.data() as MoneyOut), id: d.id }))))),
    ];
    return () => subs.forEach(u => u());
  }, []);

  // T3 name lists (participants' IC numbers) saved on checklists before the process audit (2026-10-22) are moved to
  // deal_t3, which only Admin and Management can read (PDPA). Runs once when Admin or Management opens the work queue.
  const movedT3 = useRef(false);
  useEffect(() => {
    if (movedT3.current || viewer.role === 'rep') return;
    const legacy = Object.entries(checklists).filter(([, c]) => (c as any)?.t3).map(([id, c]) => ({ id, t3: (c as any).t3 }));
    if (!legacy.length) return;
    movedT3.current = true;
    moveT3Lists(legacy).catch(e => console.error('Moving T3 lists:', e));
  }, [checklists]);

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
    flags.push(...checklistFlags(p, cl.tasks, settings, today, dealWonDate(p)));
    const mIn = moneyIn.filter(m => m.dealId === p.id);
    const mOut = moneyOut.filter(m => m.dealId === p.id);
    const rc = receipts.filter(r => r.dealId === p.id);
    // Up to training day: money reminders; from the day after: one after-training journey (lib/postTraining.ts).
    flags.push(...postTrainingFlags(p, cl.tasks, mIn, mOut, rc, claims, moneySettings, today, queries));
    flags.push(...moneyFlags(p, mIn, mOut, moneySettings, today));
    flags.push(...prePaymentFlags(p, mOut, settings.flagDays, today));
    // A trainer asked for their fee in the trainer portal (2026-10-21) and it isn't approved yet.
    // Co-trainers (2026-10-22) the same, on their own steps.
    (cl.tasks || []).filter((t: any) => t.kind === 'trainer' && t.trainerId).forEach((tt: any) => {
      const fee = claimFlag(trainerJobs.find(j => j.id === jobId(p.id, tt.trainerId)), mOut.filter(o => o.checklistTaskId === tt.id), tt.trainerName || 'The trainer');
      if (fee) flags.unshift({ level: 'danger', text: fee });
      // The trainer declined the PO in the portal (2026-10-21): pick another trainer.
      const declined = poDeclinedFlag(trainerJobs.find(j => j.id === jobId(p.id, tt.trainerId)), tt.trainerName || 'The trainer');
      if (declined) flags.unshift({ level: 'danger', text: declined });
    });
    const trainerTask = leadTrainerTask<any>(cl.tasks || []);
    // The trainer sent the training report (2026-10-21): check it and mark it ready for HR.
    const report = reportFlag(trainingReports.find(r => r.dealId === p.id), trainerTask?.trainerName || 'The trainer');
    if (report) flags.push({ level: 'attention', text: report });
    // Change date / Cancel training (2026-10-21): a request waiting for Management, or things still to update after a new date.
    const change = changeFlagText(p);
    if (change) flags.unshift({ level: pendingChange(p) ? 'attention' : 'danger', text: change });
    const post = postTraining(p, cl.tasks, mIn, mOut, rc, claims, today, moneySettings, queries);
    // Case closed: every step done, HRDC queries answered, every payment in with its receipt (2026-10-20).
    const complete = pr.done === pr.total && open.length === 0 && post.closed;
    return { deal: p, pr, overdue: overdue.length > 0, complete, after: post.ended && !complete, post, flags };
  }), [won, checklists, settings, today, queries, programmes, moneyIn, moneyOut, moneySettings, receipts, claims, trainerJobs, trainingReports]);
  const unstarted = useMemo(() => won.filter(p => !checklists[p.id]).sort(byTrainingDate), [won, checklists]);
  // Cancelled trainings with things still to wrap up (cancel the grant, the venue, refunds…).
  const cancelled = useMemo(() => deals.filter(p => cancelledTraining(p) && openTodos(p).length > 0), [deals]);

  // Needs attention: any red flag, plus "grant not applied" even while it's amber (Joel, 2026-10-18).
  const needsAttention = (r: { flags: Flag[] }) => r.flags.some(f => f.level === 'danger' || f.grant);
  const counts = {
    open: rows.filter(r => !r.complete).length,
    flagged: rows.filter(needsAttention).length,
    after: rows.filter(r => r.after).length,
    done: rows.filter(r => r.complete).length,
  };

  const visible = useMemo(() => {
    const base = rows.filter(r => (filter === 'done' ? r.complete : filter === 'flagged' ? needsAttention(r) : filter === 'after' ? r.after : !r.complete));
    const q = search.trim().toLowerCase();
    const list = q ? base.filter(r => `${clientName(r.deal)} ${courseOf(r.deal)} ${personName(dealOwnerId(r.deal))}`.toLowerCase().includes(q)) : base;
    return list.sort((a, b) => {
      if (filter === 'done') return byTrainingDate(b.deal, a.deal);
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;   // overdue HRDC queries go to the top
      return byTrainingDate(a.deal, b.deal);
    });
  }, [rows, filter, search, clients, people, programmes]);

  const openRow = rows.find(r => r.deal.id === openId);
  const openDeal = openRow?.deal || won.find(p => p.id === openId) || cancelled.find(p => p.id === openId) || null;
  const openCancelled = !!openDeal && !!cancelledTraining(openDeal);

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
    const q = buildQuotationForDeal(p, viewer, owner, clients.find(c => c.id === p.clientId), quotes);
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
    const date = trainingDateText(p, true);
    const end = daysUntil(trainingEndDate(p), today) ?? d;
    if (d < 0 && end >= 0) return `${date} (on now)`;
    if (d === 0) return `${date} (${end > 0 ? 'starts today' : 'today'})`;
    if (d === 1) return `${date} (tomorrow)`;
    if (d > 1 && d <= 30) return `${date} (in ${d} days)`;
    return date;
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="tablist" aria-label="Filter the work queue">
        {([['open', 'In progress'], ['flagged', 'Needs attention'], ['after', 'After training'], ['done', 'Case closed']] as const).map(([k, t]) => {
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

      {cancelled.length > 0 && (
        <div className="rounded-2xl border border-danger/30 bg-white">
          <p className="px-5 pt-3.5 font-semibold text-danger">Cancelled trainings to wrap up ({cancelled.length})</p>
          <ul className="divide-y divide-line">
            {cancelled.map(p => (
              <li key={p.id}>
                <button type="button" onClick={() => setOpenId(p.id)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-left hover:bg-surface">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{clientName(p)}</span>
                    <span className="block truncate text-sm text-ink-soft">{courseOf(p) || 'No programme'} · {personName(dealOwnerId(p))} · was {trainingDateText(p, true) || 'no date'}</span>
                  </span>
                  <span className="flex items-center gap-1 text-sm font-semibold text-danger"><AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {changeFlagText(p)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-line bg-white">
        {!loaded ? (
          <p className="flex items-center gap-2 p-6 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
        ) : visible.length === 0 ? (
          <div className="p-8 text-center">
            <p className="font-semibold">{filter === 'done' ? 'No closed cases yet' : filter === 'flagged' ? 'Nothing urgent right now' : filter === 'after' ? 'No trainings waiting on post-training' : 'No won deals waiting on admin'}</p>
            {filter === 'after' && <p className="mt-1 text-[15px] text-ink-soft">The day after a training ends, it appears here until the case is closed.</p>}
            {filter === 'open' && <p className="mt-1 text-[15px] text-ink-soft">When a rep marks a deal as won, it appears here with its checklist.</p>}
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {visible.map(({ deal: p, pr, flags, post, complete }) => (
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
                    {complete
                      ? <span className="block text-sm font-semibold text-accent">Case closed</span>
                      : post.ended && post.started && <span className="block text-sm text-ink-soft">After training, step {Math.min(post.step, post.steps)} of {post.steps}: {post.next}</span>}
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
                  {(() => {
                    const g = grantNotAppliedFlag(p, undefined, settings, today, dealWonDate(p));
                    return g && (
                      <span className={`flex w-full items-center gap-1 text-sm font-semibold ${g.level === 'danger' ? 'text-danger' : 'text-attention'}`}>
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {g.text}
                      </span>
                    );
                  })()}
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
          <PanelResizer />
          <div className="h-full w-full md:w-[var(--panel-w,max(50vw,40rem))] md:min-w-[24rem] md:max-w-[95vw] space-y-5 overflow-y-auto bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="truncate text-lg font-bold">{clientName(openDeal)}</h3>
                <p className="text-[15px] text-ink-soft">{courseOf(openDeal) || 'No programme'}</p>
                <p className="mt-0.5"><ClientLastTouch client={clients.find(c => c.id === openDeal.clientId)} deals={deals} quotes={quotes} /></p>
              </div>
              <button type="button" onClick={() => setOpenId(null)} className="rounded-md p-1 text-ink-soft hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[15px]">
              <div className="col-span-2"><dt className="text-sm text-ink-soft">Training date</dt><dd className="font-semibold"><TrainingDate key={openDeal.id} deal={openDeal} viewer={viewer} label={whenText(openDeal)} /></dd></div>
              <div><dt className="text-sm text-ink-soft">Training time</dt><dd className="font-semibold"><TrainingTimeBox key={openDeal.id} deal={openDeal} quotes={quotes.filter(q => q.pipelineId === openDeal.id)} viewer={viewer} editable /></dd></div>
              <div><dt className="text-sm text-ink-soft">Paid by</dt><dd className="font-semibold">{openDeal.fundingType ? FUNDING_LABELS[openDeal.fundingType as FundingType] : 'Not set'}</dd></div>
              <div><dt className="text-sm text-ink-soft">Rep</dt><dd className="font-semibold">{personName(dealOwnerId(openDeal))}</dd></div>
              <div><dt className="text-sm text-ink-soft">Value</dt><dd className="font-semibold">{dealValue(openDeal) ? formatRM(dealValue(openDeal)) : '—'}</dd></div>
              <div><dt className="text-sm text-ink-soft">Won on</dt><dd className="font-semibold">{formatDate(dealWonDate(openDeal)) || '—'}</dd></div>
              {programmeOf(openDeal) && (
                <div><dt className="text-sm text-ink-soft">Programme</dt><dd className="flex flex-wrap items-center gap-2 font-semibold"><StatusChip programme={programmeOf(openDeal)} />{programmeOf(openDeal)?.hrdcCode && <span className="text-sm font-normal text-ink-soft">Code {programmeOf(openDeal)?.hrdcCode}</span>}</dd></div>
              )}
            </dl>
            <TrainingChangePanel deal={openDeal} viewer={viewer} onDone={flash} />
            {!openCancelled && !/^\d{4}-\d{2}-\d{2}/.test(openDeal.trainingDate || '') && (
              <p className="rounded-lg bg-attention-soft px-3.5 py-2.5 text-sm text-attention">No training date yet. Click "Set" next to Training date to add it.</p>
            )}
            {!openCancelled && (<>
            <section>
              <h4 className="mb-2 font-bold">Before training (admin checklist)</h4>
              <DealChecklist
                part="before"
                deal={openDeal}
                checklist={checklists[openDeal.id] || null}
                quotes={quotes.filter(q => q.pipelineId === openDeal.id)}
                viewer={viewer}
                onCreateQuotation={() => createQuotation(openDeal)}
                onOpenQuotations={() => onOpenQuotations(dealOwnerId(openDeal) || viewer.id)}
                grantBlock={grantBlockReason(openDeal, programmeOf(openDeal))}
              />
            </section>
            <section>
              <h4 className="mb-2 font-bold">After training</h4>
              <AfterTraining deal={openDeal} checklist={checklists[openDeal.id] || null} quotes={quotes.filter(q => q.pipelineId === openDeal.id)} viewer={viewer}
                ins={moneyIn.filter(m => m.dealId === openDeal.id)} outs={moneyOut.filter(m => m.dealId === openDeal.id)} settings={moneySettings} />
            </section>
            {(openDeal.fundingType === 'hrdc' || openDeal.fundingType === 'hrdc_topup') && (
              <section>
                <h4 className="mb-2 font-bold">HRDC queries</h4>
                <HrdcQueries deal={openDeal} queries={queriesOf(openDeal)} viewer={viewer} people={people} />
              </section>
            )}
            </>)}
            <section>
              <h4 className="mb-2 font-bold">Money out and P&amp;L</h4>
              <MoneyPanel deal={openDeal} viewer={viewer} settings={moneySettings} quotes={quotes.filter(q => q.pipelineId === openDeal.id)}
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
  const [newFiles, setNewFiles] = useState(false);
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
    setTasks([...s.tasks, { id: newTaskId(), label, kind: 'basic', appliesTo: newApplies, after: newAfter, files: newFiles }]);
    setNewLabel('');
    setNewApplies('all');
    setNewAfter(false);
    setNewFiles(false);
  };

  const save = async () => {
    if (s.tasks.some(t => !t.label.trim())) return setMsg({ ok: false, text: 'Every task needs a name.' });
    setBusy(true);
    try {
      await setDoc(doc(db, 'config', 'checklist_tasks'), {
        tasks: JSON.parse(JSON.stringify(s.tasks.map(t => ({ ...t, label: t.label.trim() })))),
        flagDays: s.flagDays,
        grantDays: s.grantDays,
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
              <label className={`flex items-center gap-1.5 text-sm ${t.retired || t.kind !== 'basic' ? 'opacity-40' : ''}`}
                title="Admin drops the file (e.g. the signed JD14) on the step. Uploading ticks the step, and it can't be ticked without a file.">
                <input type="checkbox" checked={!!t.files && t.kind === 'basic'} disabled={t.retired || t.kind !== 'basic' || (isLockedStep(t) && viewer.role !== 'management')}
                  onChange={e => update(t.id, { files: e.target.checked })} className="h-4 w-4 accent-[#0E6E62]" />
                Has a file upload
              </label>
              <span className="w-24 text-center">
                {t.kind !== 'basic' && <span className="rounded-md bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent" title="This step has its own fields">{KIND_LABELS[t.kind]}</span>}
              </span>
              <span className="ml-auto flex items-center">
                <button type="button" className={iconBtn} disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${t.label} up`}><ArrowUp className="h-4 w-4" /></button>
                <button type="button" className={iconBtn} disabled={i === s.tasks.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${t.label} down`}><ArrowDown className="h-4 w-4" /></button>
                {t.retired && RETIRED_BUILTINS.includes(t.id) ? (
                  <span className="ml-1 px-2 text-sm text-ink-soft" title="A deal can only be won after its quotation is sent, so the checklist shows the quotation ticked by itself">Ticks itself</span>
                ) : t.retired ? (
                  <button type="button" className={`${btnSecondary} ml-1 py-1.5`} onClick={() => update(t.id, { retired: false })}><RotateCcw className="h-3.5 w-3.5" /> Bring back</button>
                ) : (
                  // HRDC and proof-of-training steps: only Management stops using them (process audit, 2026-10-22).
                  isLockedStep(t) && viewer.role !== 'management'
                    ? <span className="ml-1 px-2 text-sm text-ink-soft" title="HRDC and the case depend on this step. Only Management can stop using it.">Required</span>
                    : <button type="button" className={`${btnSecondary} ml-1 py-1.5 text-danger hover:bg-danger-soft`} onClick={() => update(t.id, { retired: true })}>Stop using</button>
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
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={newFiles} onChange={e => setNewFiles(e.target.checked)} className="h-4 w-4 accent-[#0E6E62]" />
            Has a file upload
          </label>
          <button type="submit" disabled={!newLabel.trim()} className={btnSecondary}><Plus className="h-4 w-4" /> Add task</button>
        </form>
      </div>

      <div className="max-w-md rounded-2xl border border-line bg-white p-4">
        <label htmlFor="flag-days" className="mb-1.5 block text-sm font-semibold">Warn when training is this many days away</label>
        <input id="flag-days" type="number" min={0} max={60} value={s.flagDays}
          onChange={e => edit({ ...s, flagDays: Math.max(0, Math.min(60, Number(e.target.value) || 0)) })} className={`${field} w-28`} />
        <p className="mt-1.5 text-sm text-ink-soft">A deal turns red in the work queue if the grant isn't approved or the trainer isn't confirmed by then. After-training steps only show as a reminder once training day has passed.</p>
      </div>

      <div className="max-w-md rounded-2xl border border-line bg-white p-4">
        <label htmlFor="grant-days" className="mb-1.5 block text-sm font-semibold">Flag "grant not approved" after this many days won</label>
        <input id="grant-days" type="number" min={1} max={60} value={s.grantDays}
          onChange={e => edit({ ...s, grantDays: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })} className={`${field} w-28`} />
        <p className="mt-1.5 text-sm text-ink-soft">HRDC and HRDC + top-up deals only. Amber once the deal was won this many days ago and "Grant approved" isn't ticked. Red when training is within the window above.</p>
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
      onSnapshot(query(collection(db, 'pipelines')), s => setDeals(linkedOnly(s.docs.map(d => ({ ...d.data(), id: d.id }))))),
    ];
    return () => subs.forEach(u => u());
  }, []);
  return <ProgrammesManager programmes={programmes} deals={deals} viewer={viewer} />;
}

// Admin and Management can set a won deal's training date here, without opening the rep's workspace.
function TrainingDate({ deal, viewer, label }: { deal: any; viewer: Viewer; label: string; key?: string }) {
  const iso = (v: any) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '');
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(iso(deal.trainingDate));
  const [days, setDays] = useState(String(trainingDays(deal)));
  const [error, setError] = useState('');
  const save = async () => {
    setError('');
    const n = parseTrainingDays(days);
    if (n === null) return setError(TRAINING_DAYS_PROBLEM);
    try {
      await updateDoc(doc(db, 'pipelines', deal.id), {
        trainingDate: value,
        trainingDays: n,
        history: [...(deal.history || []), { at: new Date().toISOString(), byId: viewer.id, byName: viewer.name, action: `Training date set to ${trainingDateText({ trainingDate: value, trainingDays: n }, true) || 'none'}` }],
      });
      setEditing(false);
    } catch (e) {
      setError(friendlyError(e));
    }
  };
  // Once won with a date, it changes through Change date / Cancel training (Management approves; 2026-10-21).
  if (dateLocked(deal) || cancelledTraining(deal)) return <span>{label}</span>;
  if (!editing) {
    return <span>{label} <button type="button" className="ml-1 text-sm font-semibold text-accent hover:underline" onClick={() => setEditing(true)}>Set</button></span>;
  }
  return (
    <div className="space-y-2 font-normal">
      <input type="date" value={value} onChange={e => setValue(e.target.value)} className="rounded-lg border border-line px-2 py-1 text-[15px]" aria-label="Training date" />
      <TrainingDaysPicker id="wq-days" value={days} onChange={setDays} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="text-sm font-semibold text-accent hover:underline" onClick={save}>Save</button>
        <button type="button" className="text-sm text-ink-soft hover:underline" onClick={() => setEditing(false)}>Cancel</button>
        {error && <span className="text-sm text-danger">{error}</span>}
      </div>
    </div>
  );
}
