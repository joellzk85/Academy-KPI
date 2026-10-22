// Change date / Cancel training on a won deal (Joel, 2026-10-21; logic in src/lib/trainingChange.ts).
// One panel used by the deal panel (Deals) and the work queue (Admin work):
// - "Change date / value / Cancel training" opens the request form (deal owner, Admin, Management);
//   "Change value / pax" (2026-10-22) is the only way a won deal's value or participants change;
// - a request waiting shows who asked and why, with Approve / Reject for Management (never their own) and Withdraw;
// - approving a cancellation lists the deal's payment requests not yet paid, to stop or keep;
// - after approval, Admin ticks off what still has to be updated (revised quotation, PO, HRDC grant, venue…).
import React, { useEffect, useState } from 'react';
import { collection, doc, getDoc, getDocs, onSnapshot, query, updateDoc, where, writeBatch } from 'firebase/firestore';
import { CalendarClock, CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import { dealValue, formatDate, formatRM, parseTrainingDays, statusForStage, todayIso, trainingDateText, trainingDays } from '../lib/deals';
import { MoneyOut, inPL } from '../lib/money';
import { linkedOnly, withoutDeleted } from '../lib/linked';
import {
  CANCEL_LOST_REASON, CANCEL_REASONS, ChangeKind, DATE_REASONS, KIND_TEXT, MAX_VALUE_CHANGES, TodoItem, TrainingChange, VALUE_REASONS,
  canDecideChange, canRequestChange, cancelledTraining, changeProblem, changeSummary, changeWhy, movedText, paxOf, pendingChange, todoFor,
  valueChangeProblem,
} from '../lib/trainingChange';
import TrainingDaysPicker from './TrainingDaysPicker';

type Viewer = { id: string; name: string; role: string };

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnDanger =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white hover:bg-[#931C13] disabled:opacity-60';
const smallLink = 'inline-flex items-center gap-1 text-sm font-semibold hover:underline';

const ymd = (v: any): string => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '');
const historyEntry = (viewer: Viewer, action: string) => ({ at: new Date().toISOString(), byId: viewer.id, byName: viewer.name, action });
const withHistory = (deal: any, viewer: Viewer, action: string) => [...(deal.history || []), historyEntry(viewer, action)].slice(-40);

export default function TrainingChangePanel({ deal, viewer, onDone }: { deal: any; viewer: Viewer; onDone?: (msg: string) => void }) {
  const [asking, setAsking] = useState(false);
  useEffect(() => setAsking(false), [deal.id]);
  const pending = pendingChange(deal);
  const last: TrainingChange | null = deal.trainingChange || null;
  const done = (msg: string) => { setAsking(false); onDone?.(msg); };
  const todo: TodoItem[] = Array.isArray(deal.trainingTodo) ? deal.trainingTodo : [];
  // Stays until every item is ticked, even if a later request is rejected or withdrawn.
  const showTodo = todo.some(t => !t.done);

  return (
    <div className="space-y-3">
      {pending && <PendingBox deal={deal} change={pending} viewer={viewer} onDone={done} />}
      {!pending && last?.status === 'rejected' && last.decidedAt && !asking && (
        <p className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
          {KIND_TEXT[last.kind]} asked by {last.byName} was not approved by {last.decidedByName} on {formatDate(last.decidedAt)}{last.rejectReason ? `: ${last.rejectReason}` : ''}.
        </p>
      )}
      {showTodo && <TodoBox deal={deal} viewer={viewer} />}
      {asking && <RequestBox deal={deal} viewer={viewer} onDone={done} onCancel={() => setAsking(false)} />}
      {!pending && !asking && canRequestChange(deal, viewer) && (
        <button type="button" className={`${smallLink} text-accent`} onClick={() => setAsking(true)}>
          <CalendarClock className="h-3.5 w-3.5" /> Change date / value / Cancel training
        </button>
      )}
    </div>
  );
}

// ---------- Asking ----------
function RequestBox({ deal, viewer, onDone, onCancel }: { deal: any; viewer: Viewer; onDone: (msg: string) => void; onCancel: () => void }) {
  const [kind, setKind] = useState<ChangeKind>('date');
  const [date, setDate] = useState(ymd(deal.trainingDate));
  const [days, setDays] = useState(String(trainingDays(deal)));
  const [value, setValue] = useState(dealValue(deal) ? String(dealValue(deal)) : '');
  const [pax, setPax] = useState(paxOf(deal) ? String(paxOf(deal)) : '');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const reasons = kind === 'date' ? DATE_REASONS : kind === 'value' ? VALUE_REASONS : CANCEL_REASONS;
  const newValue = Math.round(Number(value) * 100) / 100;
  const newPax = pax.trim() === '' ? 0 : Number(pax);

  const send = async () => {
    const n = kind === 'date' ? parseTrainingDays(days) : trainingDays(deal);
    const problem = kind === 'value' ? valueChangeProblem(deal, value.trim() ? newValue : NaN, newPax, reason, note) : changeProblem(kind, deal, date, n, reason, note);
    if (problem) return setError(problem);
    setBusy(true);
    setError('');
    try {
      const c: TrainingChange = {
        id: `tc_${Date.now()}`, kind, status: 'pending',
        ...(kind === 'date' ? { newDate: date, newDays: n as number } : {}),
        ...(kind === 'value' ? { newValue, newPax, oldValue: dealValue(deal), oldPax: paxOf(deal) } : {}),
        oldDate: ymd(deal.trainingDate), oldDays: trainingDays(deal),
        reason, note: note.trim().slice(0, 500),
        byId: viewer.id, byName: viewer.name, byRole: viewer.role, at: new Date().toISOString(),
      };
      await updateDoc(doc(db, 'pipelines', deal.id), {
        trainingChange: c,
        history: withHistory(deal, viewer, `Asked: ${changeSummary(c)} (${changeWhy(c)}). Waiting for Management approval`),
      });
      onDone(`${KIND_TEXT[kind]} sent to Management for approval`);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface p-4">
      <div className="inline-flex rounded-lg border border-line bg-white p-0.5" role="radiogroup" aria-label="What to change">
        {(['date', 'value', 'cancel'] as const).map(k => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => { setKind(k); setReason(''); setError(''); }}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold ${kind === k ? (k === 'cancel' ? 'bg-danger text-white' : 'bg-ink text-white') : 'text-ink-soft hover:text-ink'}`}>
            {k === 'date' ? 'Change the date' : k === 'value' ? 'Change value / pax' : 'Cancel the training'}
          </button>
        ))}
      </div>
      <p className="text-sm text-ink-soft">
        Now: {kind === 'value' ? `${formatRM(dealValue(deal))}, ${paxOf(deal) ? `${paxOf(deal)} participants` : 'participants not set'}` : trainingDateText(deal, true) || 'no date'}. Nothing changes until Management approves.
      </p>
      {kind === 'value' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="tc-value" className="mb-1.5 block text-sm font-semibold">New deal value (RM)</label>
            <input id="tc-value" inputMode="decimal" value={value} onChange={e => setValue(e.target.value.replace(/[^0-9.]/g, ''))} className={input} placeholder="15000" />
          </div>
          <div>
            <label htmlFor="tc-pax" className="mb-1.5 block text-sm font-semibold">Participants</label>
            <input id="tc-pax" inputMode="numeric" value={pax} onChange={e => setPax(e.target.value.replace(/[^0-9]/g, ''))} className={input} placeholder="e.g. 20" />
          </div>
        </div>
      )}
      {kind === 'date' && (
        <div className="space-y-2">
          <label htmlFor="tc-date" className="block text-sm font-semibold">New training date</label>
          <input id="tc-date" type="date" value={date} onChange={e => setDate(e.target.value)} className={input.replace('w-full', 'w-full sm:w-56')} />
          <TrainingDaysPicker id="tc-days" value={days} onChange={setDays} />
        </div>
      )}
      <div>
        <span className="mb-1.5 block text-sm font-semibold">{kind === 'date' ? 'Why is it moving?' : kind === 'value' ? 'Why is the value changing?' : 'Why is it cancelled?'}</span>
        <div className="flex flex-wrap gap-2">
          {reasons.map(r => (
            <button key={r} type="button" onClick={() => setReason(r)} aria-pressed={reason === r}
              className={`rounded-full border px-3 py-1 text-sm font-medium ${reason === r ? 'border-accent bg-white text-accent' : 'border-line text-ink-soft hover:bg-white'}`}>
              {r}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label htmlFor="tc-note" className="mb-1.5 block text-sm font-semibold">
          {kind === 'date' ? 'More detail' : 'What happened?'} <span className="font-normal text-ink-soft">{kind !== 'date' || reason === 'Other' ? '(required, a few words)' : '(optional)'}</span>
        </label>
        <textarea id="tc-note" value={note} onChange={e => setNote(e.target.value)} maxLength={500} className={`${input} min-h-[64px]`}
          placeholder={kind === 'date' ? 'e.g. HR moved it because of their year-end closing' : kind === 'value' ? 'e.g. HR confirmed only 18 staff can attend' : 'e.g. Client froze all training budgets until next year'} />
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel}>Back</button>
        <button type="button" disabled={busy} className={kind === 'cancel' ? btnDanger : btnPrimary} onClick={send}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Send for approval
        </button>
      </div>
    </div>
  );
}

// ---------- Waiting for approval ----------
function PendingBox({ deal, change: c, viewer, onDone }: { deal: any; change: TrainingChange; viewer: Viewer; onDone: (msg: string) => void }) {
  const decide = canDecideChange(c, viewer);
  const mine = c.byId === viewer.id;
  const [outs, setOuts] = useState<MoneyOut[]>([]);
  const [stop, setStop] = useState<Record<string, boolean>>({});
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Approving a cancellation: the deal's payment requests (Management can read money_out).
  useEffect(() => {
    if (!decide || c.kind !== 'cancel') return;
    return onSnapshot(query(collection(db, 'money_out'), where('dealId', '==', deal.id)), s => {
      setOuts(withoutDeleted(s.docs.map(d => ({ ...(d.data() as MoneyOut), id: d.id }))));
    }, () => setOuts([]));
  }, [decide, c.kind, deal.id]);
  const open = outs.filter(o => o.status === 'pending' || o.status === 'approved');
  const paid = outs.filter(o => o.status === 'paid');
  const stopped = (o: MoneyOut) => stop[o.id] !== false;   // ticked to stop by default

  const approve = async () => {
    setBusy(true);
    setError('');
    try {
      const [cl, qs] = await Promise.all([
        getDoc(doc(db, 'deal_checklists', deal.id)),
        getDocs(query(collection(db, 'quotations'), where('pipelineId', '==', deal.id))),
      ]);
      const tasks = cl.exists() ? (cl.data() as any).tasks : [];
      const quotes = linkedOnly(qs.docs.map(d => ({ ...d.data(), id: d.id })));
      const paidCosts = paid.filter(inPL).reduce((t, o) => t + (Number(o.amount) || 0), 0);
      const now = new Date().toISOString();
      const decided = { ...c, status: 'approved' as const, decidedById: viewer.id, decidedByName: viewer.name, decidedAt: now };
      const todo = todoFor(c.kind, deal, tasks, quotes, paidCosts);
      const batch = writeBatch(db);
      if (c.kind === 'value') {
        const entry = {
          at: now, byId: viewer.id, byName: viewer.name, askedById: c.byId, askedByName: c.byName,
          oldValue: c.oldValue ?? dealValue(deal), newValue: c.newValue, oldPax: c.oldPax ?? paxOf(deal), newPax: c.newPax, reason: c.reason, note: c.note,
        };
        batch.update(doc(db, 'pipelines', deal.id), {
          proposalValue: c.newValue, participants: c.newPax,
          valueChanges: [...(Array.isArray(deal.valueChanges) ? deal.valueChanges : []), entry].slice(-MAX_VALUE_CHANGES),
          trainingChange: decided, trainingTodo: todo,
          history: withHistory(deal, viewer, `Value change approved (asked by ${c.byName}): ${changeSummary(c).replace(/^Change /, '')}. ${changeWhy(c)}`),
        });
      } else if (c.kind === 'date') {
        batch.update(doc(db, 'pipelines', deal.id), {
          trainingDate: c.newDate, trainingDays: c.newDays,
          dateChangeCount: (Number(deal.dateChangeCount) || 0) + 1,
          firstTrainingDate: ymd(deal.firstTrainingDate) || c.oldDate,
          trainingChange: decided, trainingTodo: todo,
          history: withHistory(deal, viewer, `Date change approved (asked by ${c.byName}): ${movedText(c)}${c.newDays !== c.oldDays ? `, ${trainingDateText({ trainingDate: c.newDate, trainingDays: c.newDays }, true)}` : ''}. ${changeWhy(c)}`),
        });
      } else {
        const stopping = open.filter(stopped);
        stopping.forEach(o => batch.update(doc(db, 'money_out', o.id), {
          status: 'rejected', trainingCancelled: true, decidedById: viewer.id, decidedByName: viewer.name, decidedAt: now, rejectReason: CANCEL_LOST_REASON,
        }));
        const kept = open.filter(o => !stopped(o));
        const moneyText = [
          stopping.length ? `${stopping.length} payment request${stopping.length === 1 ? '' : 's'} stopped` : '',
          kept.length ? `${kept.length} kept` : '',
        ].filter(Boolean).join(', ');
        batch.update(doc(db, 'pipelines', deal.id), {
          stage: 'lost', status: statusForStage('lost'), onHold: null,
          lostDate: todayIso(), lostReason: CANCEL_LOST_REASON, lostNote: changeWhy(c).slice(0, 500),
          lostById: c.byId, lostByName: c.byName, lostAt: now,
          trainingCancelled: { at: now, byName: viewer.name, reason: c.reason, note: c.note, wonDate: ymd(deal.wonDate), value: dealValue(deal) },
          trainingChange: decided, trainingTodo: todo,
          history: withHistory(deal, viewer, `Cancellation approved (asked by ${c.byName}): training on ${formatDate(c.oldDate) || 'no date'} cancelled. ${changeWhy(c)}${moneyText ? `. ${moneyText}` : ''}`),
        });
      }
      await batch.commit();
      onDone(c.kind === 'date' ? 'Date change approved' : c.kind === 'value' ? 'Value change approved' : 'Cancellation approved');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const close = async (status: 'rejected' | 'withdrawn') => {
    if (status === 'rejected' && rejectReason.trim().length < 3) return setError('Say why it is not approved.');
    setBusy(true);
    setError('');
    try {
      const now = new Date().toISOString();
      await updateDoc(doc(db, 'pipelines', deal.id), {
        trainingChange: { ...c, status, decidedById: viewer.id, decidedByName: viewer.name, decidedAt: now, ...(status === 'rejected' ? { rejectReason: rejectReason.trim().slice(0, 300) } : {}) },
        history: withHistory(deal, viewer, status === 'rejected' ? `${KIND_TEXT[c.kind]} not approved: ${rejectReason.trim().slice(0, 120)}` : `${KIND_TEXT[c.kind]} request withdrawn`),
      });
      onDone(status === 'rejected' ? 'Request not approved' : 'Request withdrawn');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`space-y-3 rounded-xl border p-4 ${c.kind === 'cancel' ? 'border-danger/30 bg-danger-soft' : 'border-attention/30 bg-attention-soft'}`}>
      <div>
        <p className={`font-semibold ${c.kind === 'cancel' ? 'text-danger' : 'text-attention'}`}>{KIND_TEXT[c.kind]} waiting for Management approval</p>
        <p className="mt-1 text-[15px] text-ink">{changeSummary(c)}.</p>
        <p className="mt-0.5 text-sm text-ink-soft">{changeWhy(c)} · asked by {c.byName} on {formatDate(c.at)}</p>
      </div>
      {decide && c.kind === 'cancel' && (open.length > 0 || paid.length > 0) && (
        <div className="space-y-2 rounded-lg bg-white p-3">
          {open.length > 0 && <p className="text-sm font-semibold">Payment requests not paid yet: tick to stop them, untick to keep (for example a cancellation fee still owed)</p>}
          {open.map(o => (
            <label key={o.id} className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#0E6E62]" checked={stopped(o)} onChange={e => setStop(s => ({ ...s, [o.id]: e.target.checked }))} />
              <span>{o.category} · {o.payee} · {formatRM(o.amount)} <span className="text-ink-soft">({o.status === 'pending' ? 'waiting for approval' : 'approved, not paid'})</span></span>
            </label>
          ))}
          {paid.length > 0 && (
            <p className="text-sm text-ink-soft">
              Already paid, stays as a cost of this deal: {paid.map(o => `${o.payee} ${formatRM(o.amount)}`).join(', ')}.
            </p>
          )}
        </div>
      )}
      {decide && c.kind === 'cancel' && (
        <p className="text-sm text-ink-soft">Approving marks the deal lost ("{CANCEL_LOST_REASON}") and takes {formatRM(dealValue(deal))} off {deal.ownerName || 'the owner'}'s Closing RM for the month it was won.</p>
      )}
      {rejecting && (
        <div>
          <label htmlFor="tc-reject" className="mb-1.5 block text-sm font-semibold">Why not?</label>
          <input id="tc-reject" value={rejectReason} onChange={e => setRejectReason(e.target.value)} maxLength={300} className={input} placeholder="e.g. Ask the client for a date after the grant is approved" />
        </div>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {decide && !rejecting && (
          <button type="button" disabled={busy} className={c.kind === 'cancel' ? btnDanger : btnPrimary} onClick={approve}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} {c.kind === 'cancel' ? 'Approve cancellation' : c.kind === 'value' ? 'Approve new value' : 'Approve new date'}
          </button>
        )}
        {decide && !rejecting && <button type="button" disabled={busy} className={btnSecondary} onClick={() => { setRejecting(true); setError(''); }}><XCircle className="h-4 w-4" /> Reject</button>}
        {rejecting && (
          <>
            <button type="button" className={btnSecondary} onClick={() => { setRejecting(false); setError(''); }}>Back</button>
            <button type="button" disabled={busy} className={btnDanger} onClick={() => close('rejected')}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Reject</button>
          </>
        )}
        {(mine || viewer.role === 'management') && !rejecting && (
          <button type="button" disabled={busy} className={btnSecondary} onClick={() => close('withdrawn')}>Withdraw</button>
        )}
      </div>
      {!decide && mine && viewer.role === 'management' && <p className="text-sm text-ink-soft">The other manager approves your own request.</p>}
    </div>
  );
}

// ---------- After approval: what Admin still has to update ----------
function TodoBox({ deal, viewer }: { deal: any; viewer: Viewer }) {
  const todo: TodoItem[] = deal.trainingTodo || [];
  const staff = viewer.role !== 'rep';
  const cancelled = !!cancelledTraining(deal);
  const valueKind = !cancelled && deal.trainingChange?.kind === 'value';
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const tick = async (key: string) => {
    setBusy(key);
    setError('');
    try {
      const item = todo.find(t => t.key === key);
      const next = todo.map(t => (t.key === key ? { ...t, done: !t.done, doneByName: !t.done ? viewer.name : '', doneAt: !t.done ? new Date().toISOString() : '' } : t));
      await updateDoc(doc(db, 'pipelines', deal.id), {
        trainingTodo: next,
        ...(item && !item.done ? { history: withHistory(deal, viewer, `${cancelled ? 'Cancellation' : valueKind ? 'Value change' : 'Date change'}: done "${item.label}"`) } : {}),
      });
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy('');
    }
  };
  const c: TrainingChange | null = deal.trainingChange || null;
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <p className="font-semibold">{cancelled ? 'Training cancelled: still to wrap up' : valueKind ? 'New value: still to update' : 'New date: still to update'}</p>
      {c && c.status === 'approved' && <p className="mt-0.5 text-sm text-ink-soft">{cancelled || valueKind ? `${valueKind ? `${changeSummary(c)}, a` : 'A'}pproved by ${c.decidedByName} on ${formatDate(c.decidedAt || '')}` : `${movedText(c)}, approved by ${c.decidedByName}`}</p>}
      <ul className="mt-2 space-y-1.5">
        {todo.map(t => (
          <li key={t.key}>
            <button type="button" disabled={!staff || !!busy} onClick={() => tick(t.key)} className="flex w-full items-start gap-2 text-left text-[15px] disabled:cursor-default">
              {busy === t.key ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" /> : t.done ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-ink-soft" />}
              <span className={t.done ? 'text-ink-soft line-through' : ''}>{t.label}{t.done && t.doneByName ? <span className="no-underline"> · {t.doneByName}</span> : ''}</span>
            </button>
          </li>
        ))}
      </ul>
      {!staff && <p className="mt-2 text-sm text-ink-soft">Admin ticks these off.</p>}
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
