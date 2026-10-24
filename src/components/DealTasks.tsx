import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { CheckCircle2, Circle, ClipboardList, Loader2, Plus, Wallet } from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import { formatDate, formatRM, todayIso } from '../lib/deals';
import { Task, TaskPayment, assigneesOf, assignerOf, isAssignedTo, isDone, isRealTask, paymentMissing } from '../lib/tasks';
import { OutTiming, TIMING_LABELS } from '../lib/money';
import { ChecklistTask } from '../lib/checklist';
import { Vendor, vendorName } from '../lib/vendors';
import { useTeamList } from '../lib/useClientHistory';
import { useFormDraft } from '../lib/useFormDraft';
import DraftBar from './DraftBar';
import { PeoplePicker } from './TasksPage';
import { CostPrefill, VendorHint, defaultTiming, quickWords } from './StepCosts';

// Task shortcut inside a deal (Joel, 2026-10-24): "+ Task" on the deal and on each checklist step makes a To-do linked
// to the deal (and the step), for anyone on the team, by anyone. "Raise payment" fills in what the step already knows
// (who is paid, what for, when) and marks what's still needed; the person tagged raises it with "Raise payment now",
// which opens the step's cost form filled in. The task is ticked by hand (Joel: manual tick), like any To-do.

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const small = 'mb-1 block text-sm font-medium text-ink-soft';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';
const btnSmall = `${btnSecondary} py-1 px-2.5`;

/** This deal's To-dos, live. */
export function useDealTasks(dealId: string): Task[] {
  const [list, setList] = useState<Task[]>([]);
  useEffect(() => onSnapshot(query(collection(db, 'tasks'), where('pipelineId', '==', dealId)),
    s => setList(s.docs.map(d => ({ ...(d.data() as Task), id: d.id })).filter(isRealTask)), () => setList([])), [dealId]);
  return list;
}

export const dealLabelOf = (deal: any) => [deal?.client, deal?.courseName].filter(Boolean).join(' · ') || 'This deal';

/** The "+ Task" button and its form. `step` = the checklist step it's about (none = the deal itself). */
export function AddDealTask({ deal, viewer, step, hint, vendors = [], trainers = [], venues = [], canPay = false, compact }: {
  deal: any; viewer: Viewer; step?: ChecklistTask; hint?: VendorHint; vendors?: Vendor[]; trainers?: any[]; venues?: any[];
  canPay?: boolean;     // the step has costs, so "Raise payment" is offered
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={compact ? 'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-sm font-semibold text-accent hover:bg-accent-soft' : btnSmall}
        title={step ? `Make a task about ${step.label} and tag someone` : 'Make a task about this deal and tag someone'}>
        <Plus className="h-3.5 w-3.5" /> Task
      </button>
      {open && <DealTaskForm deal={deal} viewer={viewer} step={step} hint={hint} vendors={vendors} trainers={trainers} venues={venues} canPay={canPay} onClose={() => setOpen(false)} />}
    </>
  );
}

function DealTaskForm({ deal, viewer, step, hint, vendors, trainers, venues, canPay, onClose }: {
  deal: any; viewer: Viewer; step?: ChecklistTask; hint?: VendorHint; vendors: Vendor[]; trainers: any[]; venues: any[]; canPay: boolean; onClose: () => void;
}) {
  const team = useTeamList();
  const people = useMemo(() => team.filter(p => p.active).map(p => ({ id: p.id, name: p.name })), [team]);
  const nameOf = (id: string) => team.find(p => p.id === id)?.name || (id === viewer.id ? viewer.name : 'Former team member');
  const hinted = hint && vendors.find(v => (hint.trainerId && v.trainerId === hint.trainerId) || (hint.venueId && v.venueId === hint.venueId));
  const words = step ? quickWords(step) : [];
  const [f, setF] = useState({
    ask: canPay ? 'payment' : 'anything' as 'payment' | 'anything',
    detail: '', due: '', to: [] as string[],
    what: words[0] || '', amount: '', vendorId: hinted?.id || '', payee: hinted ? '' : hint?.name || '',
    timing: (step ? defaultTiming(step) : 'before') as OutTiming,
  });
  const draft = useFormDraft(viewer.id, `dealtask:${deal.id}:${step?.id || 'deal'}`, f, setF);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isPay = f.ask === 'payment' && canPay;
  const vendor = vendors.find(v => v.id === f.vendorId);
  const payment: TaskPayment = {
    what: f.what.trim(), amount: Math.round((Number(f.amount) || 0) * 100) / 100,
    payee: vendor ? vendorName(vendor, trainers, venues) : f.payee.trim(), vendorId: vendor?.id || '', timing: f.timing,
  };
  const missing = paymentMissing(payment);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!isPay && !f.detail.trim()) return setError('Write what needs doing.');
    if (!f.to.length) return setError('Tag at least one person to do it.');
    const id = `task_${Date.now()}`;
    const detail = isPay
      ? [`Raise payment${payment.what ? `: ${payment.what}` : ''}${payment.amount > 0 ? `, ${formatRM(payment.amount)}` : ''}${payment.payee ? ` to ${payment.payee}` : ''} (${TIMING_LABELS[payment.timing].toLowerCase()})`,
        missing.length ? `Still needed: ${missing.join(', ')}.` : '', f.detail.trim()].filter(Boolean).join('\n')
      : f.detail.trim();
    const t: Task = {
      id, detail, dateline: f.due, status: 'Not done',
      assignedById: viewer.id, assignedBy: viewer.name, assignedToId: f.to[0], assignedTo: nameOf(f.to[0]), assignedToIds: f.to,
      clientIds: [], clientNames: [], pipelineId: deal.id, dateCreated: todayIso(), createdAt: Date.now(), ownerRepId: f.to[0],
      ...(step ? { stepId: step.id, stepLabel: step.label } : {}),
      ...(isPay ? { ask: 'payment' as const, payment } : {}),
    };
    setBusy(true);
    try {
      await setDoc(doc(db, 'tasks', id), t);
      draft.clear();
      onClose();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/40 p-4" role="dialog" aria-modal="true" aria-labelledby="dt-title" onClick={onClose}>
      <form onSubmit={save} className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl bg-white p-5 text-left font-sans text-ink shadow-xl" onClick={e => e.stopPropagation()}>
        <div>
          <h3 id="dt-title" className="text-lg font-bold">New task</h3>
          <p className="text-sm text-ink-soft">{dealLabelOf(deal)}{step ? ` · ${step.label}` : ''}. It goes to the To-do of the people you tag.</p>
        </div>
        <DraftBar draft={draft} what="task" />
        {canPay && (
          <div className="flex gap-2">
            {(['payment', 'anything'] as const).map(k => (
              <button key={k} type="button" aria-pressed={f.ask === k} onClick={() => setF(x => ({ ...x, ask: k }))}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-sm font-semibold ${f.ask === k ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-white text-ink-soft hover:bg-surface'}`}>
                {k === 'payment' ? <><Wallet className="h-4 w-4" /> Raise payment</> : <><ClipboardList className="h-4 w-4" /> Anything else</>}
              </button>
            ))}
          </div>
        )}

        {isPay && (
          <div className="space-y-3 rounded-xl border border-line bg-surface p-3">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
              <div>
                <label className={small} htmlFor="dt-what">What for</label>
                <input id="dt-what" value={f.what} onChange={e => setF(x => ({ ...x, what: e.target.value }))} className={input} placeholder="e.g. Booking" />
                {words.length > 1 && (
                  <span className="mt-1 flex flex-wrap gap-1">
                    {words.map(w => (
                      <button key={w} type="button" onClick={() => setF(x => ({ ...x, what: w }))}
                        className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${f.what === w ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-white text-ink-soft hover:text-ink'}`}>{w}</button>
                    ))}
                  </span>
                )}
              </div>
              <div>
                <label className={small} htmlFor="dt-amount">Amount (RM)</label>
                <input id="dt-amount" inputMode="decimal" value={f.amount} onChange={e => setF(x => ({ ...x, amount: e.target.value.replace(/[^0-9.]/g, '') }))} className={input} placeholder="Not known yet" />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={small} htmlFor="dt-payee">Pay to</label>
                {vendors.length > 0 ? (
                  <select id="dt-payee" value={f.vendorId} onChange={e => setF(x => ({ ...x, vendorId: e.target.value }))} className={input}>
                    <option value="">{hint?.name ? `${hint.name} (not in Vendors yet)` : 'Not known yet'}</option>
                    {vendors.map(v => ({ v, name: vendorName(v, trainers, venues) })).sort((a, b) => a.name.localeCompare(b.name))
                      .map(x => <option key={x.v.id} value={x.v.id}>{x.name}</option>)}
                  </select>
                ) : (
                  <input id="dt-payee" value={f.payee} onChange={e => setF(x => ({ ...x, payee: e.target.value }))} className={input} placeholder="Not known yet" />
                )}
              </div>
              <div>
                <span className={small}>When it's paid</span>
                <div className="flex gap-2">
                  {(['before', 'after'] as OutTiming[]).map(k => (
                    <button key={k} type="button" aria-pressed={f.timing === k} onClick={() => setF(x => ({ ...x, timing: k }))}
                      className={`flex-1 rounded-lg border px-2 py-2 text-sm font-semibold ${f.timing === k ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-white text-ink-soft hover:bg-surface'}`}>{TIMING_LABELS[k]}</button>
                  ))}
                </div>
              </div>
            </div>
            {missing.length > 0 && <p className="text-sm font-semibold text-attention">Still needed: {missing.join(', ')}. The person you tag fills it in when they raise it.</p>}
          </div>
        )}

        <div>
          <label className={small} htmlFor="dt-detail">{isPay ? 'Note (optional)' : 'What needs doing'}</label>
          <textarea id="dt-detail" rows={3} value={f.detail} onChange={e => setF(x => ({ ...x, detail: e.target.value }))} className={`${input} resize-y`}
            placeholder={isPay ? 'e.g. Deposit is 50%, invoice is in the venue documents' : step ? `e.g. Call the ${step.label.toLowerCase()} to confirm` : 'e.g. Send the client the final pax list'} />
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
          <div>
            <span className={small}>Who does it</span>
            <PeoplePicker ids={f.to} team={people} meId={viewer.id} nameOf={nameOf} onChange={to => setF(x => ({ ...x, to }))} />
          </div>
          <div>
            <label className={small} htmlFor="dt-due">Due</label>
            <input id="dt-due" type="date" value={f.due} onChange={e => setF(x => ({ ...x, due: e.target.value }))} className={input} />
          </div>
        </div>
        {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex gap-2">
          <button type="button" className={btnSecondary} onClick={onClose}>Cancel</button>
          <button type="submit" disabled={busy} className={btnPrimary}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Send task</button>
        </div>
      </form>
    </div>
  );
}

/** A deal's (or one step's) tasks: tick done, and "Raise payment now" on payment tasks for Admin and Management. */
export function DealTaskList({ tasks, viewer, showStep, onRaise, empty }: {
  tasks: Task[]; viewer: Viewer; showStep?: boolean; onRaise?: (t: Task) => void; empty?: string;
}) {
  const team = useTeamList();
  const [showDone, setShowDone] = useState(false);
  const [error, setError] = useState('');
  const nameOf = (id: string, fallback = '') => team.find(p => p.id === id)?.name || fallback || 'Former team member';
  const open = tasks.filter(t => !isDone(t)).sort((a, b) => String(a.dateline || '9999').localeCompare(String(b.dateline || '9999')) || (a.createdAt || 0) - (b.createdAt || 0));
  const done = tasks.filter(isDone).sort((a, b) => String(b.doneAt || '').localeCompare(String(a.doneAt || '')));
  const today = todayIso();
  const canTick = (t: Task) => viewer.role === 'management' || isAssignedTo(t, viewer.id) || assignerOf(t) === viewer.id;
  const toggle = async (t: Task) => {
    setError('');
    try {
      await updateDoc(doc(db, 'tasks', t.id), isDone(t)
        ? { status: 'Not done', doneAt: '', doneByName: '', doneById: '' }
        : { status: 'Done', doneAt: today, doneByName: viewer.name, doneById: viewer.id });
    } catch (err) {
      setError(friendlyError(err));
    }
  };
  if (!tasks.length) return empty ? <p className="text-sm text-ink-soft">{empty}</p> : null;

  const row = (t: Task) => {
    const d = isDone(t);
    const late = !d && !!t.dateline && t.dateline < today;
    const forNames = assigneesOf(t).map(id => nameOf(id, id === t.assignedToId ? t.assignedTo : '')).join(', ');
    const missing = t.ask === 'payment' ? paymentMissing(t.payment) : [];
    return (
      <li key={t.id} className="flex items-start gap-2.5 rounded-lg border border-line bg-white px-3 py-2">
        <button type="button" disabled={!canTick(t)} onClick={() => toggle(t)} className="mt-0.5 shrink-0 disabled:cursor-not-allowed disabled:opacity-40" aria-label={d ? 'Mark not done' : 'Mark done'}>
          {d ? <CheckCircle2 className="h-5 w-5 text-accent" /> : <Circle className={`h-5 w-5 ${late ? 'text-danger' : 'text-ink-soft/60'}`} />}
        </button>
        <div className="min-w-0 flex-1">
          <p className={`whitespace-pre-line text-[15px] ${d ? 'text-ink-soft line-through' : ''}`}>{t.detail}</p>
          <p className="mt-0.5 text-sm text-ink-soft">
            For {forNames}, from {nameOf(assignerOf(t), t.assignedBy)}
            {showStep && t.stepLabel ? ` · ${t.stepLabel}` : ''}
            {d ? ` · done ${formatDate(t.doneAt || '')}${t.doneByName ? ` by ${t.doneByName}` : ''}` : t.dateline ? <span className={late ? 'font-semibold text-danger' : ''}> · due {formatDate(t.dateline)}</span> : ''}
          </p>
          {!d && missing.length > 0 && <p className="text-sm font-semibold text-attention">Still needed: {missing.join(', ')}</p>}
        </div>
        {!d && t.ask === 'payment' && onRaise && viewer.role !== 'rep' && (
          <button type="button" className={`${btnSmall} shrink-0`} onClick={() => onRaise(t)}><Wallet className="h-3.5 w-3.5" /> Raise payment now</button>
        )}
      </li>
    );
  };

  return (
    <div className="space-y-1.5">
      {open.length > 0 && <ul className="space-y-1.5">{open.map(row)}</ul>}
      {done.length > 0 && (
        <button type="button" className="text-sm font-semibold text-ink-soft hover:underline" onClick={() => setShowDone(s => !s)}>
          {showDone ? 'Hide' : 'Show'} {done.length} done
        </button>
      )}
      {showDone && <ul className="space-y-1.5">{done.map(row)}</ul>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}

/** A payment task's details, for the step's cost form. */
export function prefillFrom(t: Task): CostPrefill {
  const p = t.payment;
  return { key: Date.now(), description: p?.what || '', amount: p?.amount || 0, vendorId: p?.vendorId || '', timing: p?.timing || 'before' };
}
