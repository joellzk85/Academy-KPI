import React, { useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc, writeBatch, getDoc } from 'firebase/firestore';
import { AlertTriangle, Car, Check, FileText, Loader2, Pencil, Plus, Trash2, Undo2, X } from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import { addDays, formatDate, todayIso, trainingEndDate } from '../lib/deals';
import {
  DEFAULT_MONEY_SETTINGS, MoneyOut, OUT_STATUS_LABELS, OutStatus, OutTiming, PartPlan, TIMING_LABELS, canDecide, groupKey, inPL, ownApprovalOk,
  raisedText, readMoneySettings, splitAmounts,
} from '../lib/money';
import { ChecklistTask, costCategory, isCoTrainer, materialItems } from '../lib/checklist';
import { STEP_VENDOR_TYPE, Vendor, bankText, hasBank, vendorName } from '../lib/vendors';
import { Receipt } from '../lib/postTraining';
import { ON_BEHALF_LABEL } from '../lib/onBehalf';
import { useFormDraft } from '../lib/useFormDraft';
import DraftBar from './DraftBar';
import { VendorForm } from './VendorsPage';
import { ReceiptDrop, ReceiptList, ReceiptPick, receiptError, removeReceipt, uploadReceipts } from './PaymentReceipts';
import { isTrainerFee } from '../lib/feeChecks';
import { ApproveFeeDialog } from './FeeChecks';
import { askReason, decideCost, deleteMoney, undoPayment, withDealHistory } from '../lib/moneyActions';
import { feeIsAgreed, mileageAmount, mileageFrom, mileageText, onPo } from '../lib/trainerPortal';
import { isSuperManager, superConfirm } from '../lib/superManager';

// Costs on a before-training checklist step (Joel, 2026-10-20: "able to key in amount, e.g. bus RM 5,000 + upload
// document; all these amounts automated into the training P&L and into payment requests, payable to different
// vendors, approved by Management, then sent to accounts as a summary").
// Each cost line is a payment request (money_out) on the deal, with the step (checklistTaskId), the vendor
// (vendorId, bank details in Vendors) and Pre-training / Post-training timing. So it shows in the deal's P&L and
// Project P&L straight away (waiting for approval), follows the usual approval rule (a manager, never your own),
// and once approved it can go on a payment summary for accounts (Admin work → Money). Its receipt is uploaded here.
// Admin and Management only (reps can't read money_out).

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const small = 'mb-1 block text-sm font-medium text-ink-soft';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';
const btnSmall = `${btnSecondary} py-1 px-2.5`;

const TONE: Record<OutStatus, string> = {
  pending: 'bg-attention-soft text-attention',
  approved: 'bg-[#E8EEF8] text-[#2B4A7E]',
  rejected: 'bg-danger-soft text-danger',
  paid: 'bg-accent-soft text-accent',
};
export const sen = (n: number) => 'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (s: string) => Number(String(s).replace(/[^0-9.]/g, ''));

// Quick descriptions per step (Joel: "Booking and final payment").
export function quickWords(t: ChecklistTask): string[] {
  if (t.kind === 'venue' || t.kind === 'bus') return ['Booking', 'Final payment'];
  if (t.kind === 'trainer') return [isCoTrainer(t) ? 'Co-trainer fee' : 'Trainer fee'];
  if (t.kind === 'facilitator') return ['Facilitator fee'];
  if (t.kind === 'materials') return materialItems(t).map(i => i.label);
  return [];
}
// The trainer is paid after training (Joel's example); everything else defaults to before.
export const defaultTiming = (t: ChecklistTask): OutTiming => (t.kind === 'trainer' ? 'after' : 'before');

/** Who the vendor is for this step's trainer or venue (picked on the checklist), to suggest or create. */
export type VendorHint = { type: Vendor['type']; trainerId?: string; venueId?: string; name?: string };

/** A cost form opened from a "Raise payment" task (2026-10-24, DealTasks.tsx), filled in with what the task knows. */
export type CostPrefill = { key: number; description: string; amount: number; vendorId: string; timing: OutTiming };

export default function StepCosts({ deal, task, viewer, outs, receipts, vendors, trainers, venues, hint, prefill }: {
  deal: any; task: ChecklistTask; viewer: Viewer; outs: MoneyOut[]; receipts: Receipt[];
  vendors: Vendor[]; trainers: any[]; venues: any[]; hint?: VendorHint; prefill?: CostPrefill | null;
}) {
  const lines = outs.filter(o => o.checklistTaskId === task.id).sort((a, b) => String(a.requestedAt).localeCompare(String(b.requestedAt)));
  const [adding, setAdding] = useState(false);
  const [mileage, setMileage] = useState(false);
  useEffect(() => { if (prefill) { setAdding(true); setMileage(false); } }, [prefill?.key]);
  const counted = lines.filter(o => (o.status === 'approved' || o.status === 'paid') && inPL(o)).reduce((t, o) => t + (Number(o.amount) || 0), 0);
  const waiting = lines.filter(o => o.status === 'pending' && inPL(o)).reduce((t, o) => t + (Number(o.amount) || 0), 0);
  const leftOut = lines.filter(o => !inPL(o) && !o.onBehalf && o.status !== 'rejected').reduce((t, o) => t + (Number(o.amount) || 0), 0);
  const behalf = lines.filter(o => o.onBehalf && o.status !== 'rejected').reduce((t, o) => t + (Number(o.amount) || 0), 0);
  // A cost paid in parts shows as one cost with its parts (2026-10-26).
  const groups: MoneyOut[][] = [];
  lines.forEach(o => { const g = groups.find(x => groupKey(x[0]) === groupKey(o)); if (g) g.push(o); else groups.push([o]); });
  groups.forEach(g => g.sort((a, b) => (a.partNo || 0) - (b.partNo || 0)));

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <p className="text-sm font-semibold">Costs</p>
        {lines.length > 0 && (
          <p className="text-sm text-ink-soft">In the P&L {sen(counted)}{waiting > 0 && ` · waiting for approval ${sen(waiting)}`}{leftOut > 0 && ` · not in the P&L ${sen(leftOut)}`}{behalf > 0 && ` · paid on behalf of client ${sen(behalf)} (claimed back after training)`}</p>
        )}
      </div>
      {lines.length > 0 && (
        <ul className="space-y-1.5">
          {groups.map(g => <CostGroup key={groupKey(g[0])} parts={g} deal={deal} viewer={viewer} vendors={vendors} trainers={trainers} venues={venues} receipts={receipts} />)}
        </ul>
      )}
      {adding ? (
        <CostForm key={prefill?.key || 0} deal={deal} task={task} viewer={viewer} vendors={vendors} trainers={trainers} venues={venues} hint={hint} lines={lines} prefill={prefill} onDone={() => setAdding(false)} />
      ) : mileage ? (
        <MileageForm deal={deal} task={task} viewer={viewer} vendors={vendors} trainers={trainers} venues={venues} hint={hint} onDone={() => setMileage(false)} />
      ) : (
        <span className="flex flex-wrap gap-2">
          <button type="button" className={btnSmall} onClick={() => setAdding(true)}><Plus className="h-3.5 w-3.5" /> Add a cost</button>
          {task.kind === 'trainer' && <button type="button" className={btnSmall} onClick={() => setMileage(true)}><Car className="h-3.5 w-3.5" /> Mileage claim</button>}
        </span>
      )}
    </div>
  );
}

// One cost: a single line, or its parts (deposit, balance, ...) under one heading, with the vendor's invoices.
function CostGroup({ parts, deal, viewer, vendors, trainers, venues, receipts }: {
  parts: MoneyOut[]; deal: any; viewer: Viewer; vendors: Vendor[]; trainers: any[]; venues: any[]; receipts: Receipt[]; key?: string;
}) {
  const first = parts[0];
  const live = parts.filter(o => o.status !== 'rejected');
  const total = live.reduce((t, o) => t + (Number(o.amount) || 0), 0);
  const paid = live.filter(o => o.status === 'paid').reduce((t, o) => t + (Number(o.amount) || 0), 0);
  const split = !!first.partGroup;
  const vendor = vendors.find(v => v.id === first.vendorId);
  return (
    <li className="rounded-lg border border-line bg-white px-3 py-2">
      {split && (
        <p className="mb-1 flex flex-wrap items-center gap-1.5 text-[15px]">
          <span className="font-semibold">{first.description || first.category}</span>
          <span className="text-ink-soft">· {vendor ? vendorName(vendor, trainers, venues) : first.payee}</span>
          <span className="font-semibold tabular-nums">· {sen(total)}</span>
          <span className="text-sm text-ink-soft">in {parts.length} parts{paid > 0 ? `, ${sen(paid)} paid, ${sen(total - paid)} to go` : ''}</span>
        </p>
      )}
      <div className={split ? 'divide-y divide-line border-l-2 border-accent/30 pl-3' : ''}>
        {parts.map(o => <CostLine key={o.id} o={o} group={parts} viewer={viewer} vendors={vendors} trainers={trainers} venues={venues} receipts={receipts.filter(r => r.moneyOutId === o.id)} />)}
      </div>
      <VendorInvoices costKey={groupKey(first)} dealId={deal.id} total={total} viewer={viewer} invoices={receipts.filter(r => r.kind === 'invoice' && r.vendorInvoiceFor === groupKey(first))} />
    </li>
  );
}

/** The vendor's invoices for one cost (Joel, 2026-10-26: "some venue / trainers have multiple invoice for the same deal"):
 *  one or more, each with its number and amount, checked against the cost. Stored with the receipts (kind 'invoice'),
 *  never counted as a payment receipt. */
function VendorInvoices({ costKey, dealId, total, viewer, invoices }: { costKey: string; dealId: string; total: number; viewer: Viewer; invoices: Receipt[] }) {
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ no: '', amount: '' });
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState('');
  const invoiced = invoices.reduce((t, r) => t + (Number(r.invoiceAmount) || 0), 0);
  const over = invoiced > total + 0.005;
  const save = async () => {
    if (!files.length) return setError('Choose the invoice file (one or more).');
    // Blank amount = what is still to be invoiced on this cost.
    const amount = f.amount === '' ? Math.max(0, total - invoiced) : num(f.amount);
    setError(''); setProgress('0%');
    try {
      // The amount goes on the first file only, so an invoice in several files is counted once; all files or none.
      const [one, ...rest] = files;
      const target = { dealId, moneyInId: '', recordId: '', kind: 'invoice' as const, vendorInvoiceFor: costKey, invoiceNo: f.no.trim() };
      const [firstRec] = await uploadReceipts([one], { ...target, invoiceAmount: Math.round(amount * 100) / 100 }, viewer, setProgress);
      if (rest.length) {
        try { await uploadReceipts(rest, { ...target, invoiceAmount: 0 }, viewer, setProgress); }
        catch (e) { await removeReceipt(firstRec).catch(() => {}); throw e; }
      }
      setFiles([]); setF({ no: '', amount: '' }); setAdding(false);
    } catch (e) { setError(receiptError(e)); } finally { setProgress(null); }
  };
  return (
    <div className="mt-2">
      {invoices.length > 0 && (
        <p className={`flex flex-wrap items-center gap-1 text-sm ${over ? 'font-semibold text-danger' : 'text-ink-soft'}`}>
          {over ? <AlertTriangle className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5 text-accent" />}
          Vendor invoices: {sen(invoiced)} of {sen(total)}
          {over ? ': more than the cost, check before it is paid' : invoiced > 0 && invoiced < total - 0.005 ? ` · ${sen(total - invoiced)} not invoiced yet` : invoiced > 0 ? ' · all invoiced' : ''}
        </p>
      )}
      <ReceiptList receipts={invoices} viewer={viewer} />
      {adding ? (
        <div className="mt-2 space-y-2 rounded-lg border border-line bg-surface p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div><label className={small} htmlFor={`vi-no-${costKey}`}>Vendor's invoice no.</label><input id={`vi-no-${costKey}`} value={f.no} onChange={e => setF(x => ({ ...x, no: e.target.value }))} className={input} /></div>
            <div><label className={small} htmlFor={`vi-amt-${costKey}`}>Invoice amount (RM)</label><input id={`vi-amt-${costKey}`} inputMode="decimal" value={f.amount} onChange={e => setF(x => ({ ...x, amount: e.target.value.replace(/[^0-9.]/g, '') }))} className={input} placeholder={String(Math.max(0, Math.round((total - invoiced) * 100) / 100))} /></div>
          </div>
          <ReceiptPick files={files} onFiles={setFiles} label="The invoice (a file, photo or screenshot)" what="invoice" />
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex gap-2">
            <button type="button" className={btnSecondary} onClick={() => { setAdding(false); setFiles([]); setError(''); }}>Cancel</button>
            <button type="button" disabled={progress !== null} className={btnPrimary} onClick={save}>{progress !== null ? <><Loader2 className="h-4 w-4 animate-spin" /> Uploading… {progress}</> : 'Save invoice'}</button>
          </div>
        </div>
      ) : (
        <button type="button" className={`${btnSmall} mt-1`} onClick={() => setAdding(true)}><FileText className="h-3.5 w-3.5 text-accent" /> {invoices.length ? "Add another vendor invoice" : "Add the vendor's invoice"}</button>
      )}
    </div>
  );
}

function CostLine({ o, group, viewer, vendors, trainers, venues, receipts }: {
  o: MoneyOut; group: MoneyOut[]; viewer: Viewer; vendors: Vendor[]; trainers: any[]; venues: any[]; receipts: Receipt[]; key?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fixing, setFixing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const vendor = vendors.find(v => v.id === o.vendorId);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };
  const decide = canDecide(o, viewer);
  const mine = o.requestedById === viewer.id;
  const approveNow = async () => { if (ownApprovalOk(o, viewer)) await approveWrite(); };
  // Paid in parts: one approval or rejection for the whole cost, shown on its first part waiting (2026-10-26).
  const split = !!o.partGroup;
  const lead = !split || group.find(x => x.status === 'pending') === o;
  const waitingParts = group.filter(x => x.status === 'pending');
  const approveWrite = () => decideCost(o, group, viewer, 'approved');
  // A trainer fee first shows "Are you sure?" with the T3, photos and report checks (lib/feeChecks.ts).
  const approve = () => (isTrainerFee(o) ? setConfirming(true) : run(approveNow));
  const reject = () => {
    const reason = window.prompt('Why is it rejected?');
    if (!reason?.trim()) return;
    return run(() => decideCost(o, group, viewer, 'rejected', reason.trim()));
  };
  // Approved or paid costs are kept, marked deleted with a reason (process audit, 2026-10-22).
  const remove = () => {
    const settled = o.status === 'approved' || o.status === 'paid';
    const what = `cost: ${o.category} · ${o.payee} · ${o.description || ''} (${sen(o.amount)}, ${OUT_STATUS_LABELS[o.status].toLowerCase()})`;
    if (!settled) {
      if (!window.confirm('Delete this cost?')) return;
      return run(() => deleteMoney('money_out', o, viewer, what, ''));
    }
    const reason = askReason(`Delete this ${OUT_STATUS_LABELS[o.status].toLowerCase()} cost? The P&L changes. It is kept, and Management can restore it.\n\nWhy is it deleted?`);
    if (!reason) return;
    return run(() => deleteMoney('money_out', o, viewer, what, reason));
  };
  // Paid from the payment summary (Admin work → Money); Management can undo a mistaken Mark paid here.
  const undoPaid = () => {
    if (!window.confirm('Undo "paid" on this cost? It is noted with your name.')) return;
    return run(() => undoPayment('money_out', o, viewer, `${o.category} · ${o.payee}`));
  };
  const canDelete = viewer.role === 'management' || (mine && (o.status === 'pending' || o.status === 'rejected'));
  // Agree the trainer fee before the PO goes out (2026-10-23): a manager who didn't raise it (the owner override may).
  const toAgree = o.status === 'pending' && !feeIsAgreed(o);
  const canAgree = toAgree && viewer.role === 'management' && (!mine || isSuperManager(viewer));
  const agree = () => {
    if (mine && !superConfirm('agree a trainer fee you raised yourself.', 'Nobody else checks the amount before the PO goes to the trainer.')) return;
    // Every part of the fee still to agree, each for its own amount (firestore.rules).
    const toDo = group.filter(x => x.status === 'pending' && !feeIsAgreed(x));
    const fee = toDo.reduce((t, x) => t + (Number(x.amount) || 0), 0);
    return run(() => withDealHistory(o.dealId, viewer, `Agreed the trainer fee ${sen(fee)} for ${o.payee}: the PO goes to the trainer`,
      batch => toDo.forEach(x => batch.update(doc(db, 'money_out', x.id), { feeAgreed: { byId: viewer.id, byName: viewer.name, at: new Date().toISOString(), amount: x.amount } }))));
  };

  return (
    <div className={split ? 'py-1.5' : ''}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-[12rem] flex-1">
          {split ? (
            <p className="flex flex-wrap items-center gap-1.5 text-[15px]">
              <span className="font-semibold">{o.partLabel || `Part ${o.partNo}`}</span>
              <span className="font-semibold tabular-nums">· {sen(o.amount)}</span>
              {o.dueDate && <span className="text-ink-soft">· due {formatDate(o.dueDate)}</span>}
            </p>
          ) : (
            <p className="flex flex-wrap items-center gap-1.5 text-[15px]">
              <span className="font-semibold">{o.description || o.category}</span>
              <span className="text-ink-soft">· {vendor ? vendorName(vendor, trainers, venues) : o.payee}</span>
              <span className="font-semibold tabular-nums">· {sen(o.amount)}</span>
            </p>
          )}
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="rounded border border-line px-1.5 py-0.5 font-medium text-ink-soft">{TIMING_LABELS[o.timing] || TIMING_LABELS.after}</span>
            <span className={`rounded px-1.5 py-0.5 font-semibold ${TONE[o.status]}`}>{OUT_STATUS_LABELS[o.status]}</span>
            {o.decidedByName && <span className="text-ink-soft">{o.status === 'rejected' ? 'rejected' : 'approved'} by {o.decidedByName}{o.status === 'rejected' && o.rejectReason ? `: ${o.rejectReason}` : ''}</span>}
            {o.status === 'paid' && <span className="text-ink-soft">paid {formatDate(o.paidDate || '')}{o.paidRef ? `, ref ${o.paidRef}` : ''}</span>}
            {o.status === 'approved' && o.summaryToken && <span className="text-accent">on a payment summary sent to accounts</span>}
            {!onPo(o) && o.status !== 'rejected' && <span className="rounded border border-line px-1.5 py-0.5 font-medium text-ink-soft">Not on the PO</span>}
            {o.onBehalf && o.status !== 'rejected' && <span className="rounded bg-attention-soft px-1.5 py-0.5 font-semibold text-attention">On behalf of client: claim back after training</span>}
            {o.status === 'pending' && <span className="text-attention">{raisedText(o)}</span>}
            {o.feeAgreeNeeded && o.status === 'pending' && (toAgree
              ? <span className="rounded bg-attention-soft px-1.5 py-0.5 font-semibold text-attention">Fee to agree: a manager agrees it, then the PO goes to the trainer</span>
              : <span className="text-accent">fee agreed by {o.feeAgreed?.byName}, PO sent; paid after the training checks</span>)}
            {!inPL(o) && !o.onBehalf && o.notInPLReason && <span className="text-ink-soft">not in the P&L: {o.notInPLReason}</span>}
            {o.lastUndo && <span className="text-ink-soft">"paid" undone by {o.lastUndo.byName} {formatDate(o.lastUndo.at)}</span>}
          </p>
          {o.status !== 'rejected' && o.status !== 'paid' && (!vendor || !hasBank(vendor)) && (!split || o === group[0]) && (
            <p className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-attention"><AlertTriangle className="h-3.5 w-3.5" /> No bank details for this vendor yet (Admin work → Vendors)</p>
          )}
          {vendor && hasBank(vendor) && o.status !== 'paid' && (!split || o === group[0]) && <p className="mt-0.5 text-xs text-ink-soft">{bankText(vendor)}</p>}
        </div>
        <span className="flex shrink-0 flex-wrap items-center gap-1">
          {o.status !== 'rejected' && <BehalfTick o={o} viewer={viewer} />}
          {o.status !== 'rejected' && !o.onBehalf && <PLTick o={o} viewer={viewer} />}
          {canAgree && lead && <button type="button" disabled={busy} className={`${btnPrimary} px-2.5 py-1`} onClick={agree}><Check className="h-3.5 w-3.5" /> Agree fee</button>}
          {decide && !toAgree && lead && <button type="button" disabled={busy} className={`${btnPrimary} px-2.5 py-1`} onClick={approve}><Check className="h-3.5 w-3.5" /> {waitingParts.length > 1 ? `Approve all ${waitingParts.length} parts` : 'Approve'}</button>}
          {decide && lead && <button type="button" disabled={busy} className={`${btnSmall} text-danger hover:bg-danger-soft`} onClick={reject}><X className="h-3.5 w-3.5" /> Reject</button>}
          {o.status === 'rejected' && mine && !o.trainingCancelled && !fixing && <button type="button" disabled={busy} className={btnSmall} onClick={() => setFixing(true)}><Pencil className="h-3.5 w-3.5" /> Fix and send again</button>}
          {o.status === 'paid' && viewer.role === 'management' && <button type="button" disabled={busy} className={btnSmall} onClick={undoPaid}><Undo2 className="h-3.5 w-3.5" /> Undo paid</button>}
          {canDelete && <button type="button" disabled={busy} onClick={remove} className="rounded-md p-1.5 text-ink-soft hover:bg-danger-soft hover:text-danger" aria-label="Delete this cost">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}</button>}
        </span>
      </div>
      {fixing && <FixRequest o={o} viewer={viewer} onDone={() => setFixing(false)} />}
      {confirming && <ApproveFeeDialog o={o} viewer={viewer} payee={vendor ? vendorName(vendor, trainers, venues) : o.payee} onApprove={approveNow} onClose={() => setConfirming(false)} />}
      {o.status === 'paid' && (
        <>
          <ReceiptList receipts={receipts} viewer={viewer} />
          <ReceiptDrop target={{ dealId: o.dealId, moneyInId: '', recordId: '', moneyOutId: o.id }} viewer={viewer} small
            prompt={receipts.length ? 'Add another receipt' : 'Upload the payment receipt'} />
        </>
      )}
      {error && <p role="alert" className="mt-1 text-sm text-danger">{error}</p>}
    </div>
  );
}

/** The money settings, live (the balance due days for costs paid in parts). */
function useBalanceDays(): number {
  const [n, setN] = useState(DEFAULT_MONEY_SETTINGS.balanceDaysBefore);
  useEffect(() => onSnapshot(doc(db, 'config', 'money_settings'), d => setN(readMoneySettings(d.data()).balanceDaysBefore), () => {}), []);
  return n;
}

type SplitKind = 'full' | 'half' | 'custom';

function CostForm({ deal, task, viewer, vendors, trainers, venues, hint, lines = [], prefill, onDone }: {
  deal: any; task: ChecklistTask; viewer: Viewer; vendors: Vendor[]; trainers: any[]; venues: any[]; hint?: VendorHint; lines?: MoneyOut[]; prefill?: CostPrefill | null; onDone: () => void; key?: number;
}) {
  const vType = STEP_VENDOR_TYPE[task.kind] || 'other';
  const hinted = hint && vendors.find(v => (hint.trainerId && v.trainerId === hint.trainerId) || (hint.venueId && v.venueId === hint.venueId));
  // "Include in P&L" starts ticked; leaving a cost out needs a short reason (Joel, process audit 2026-10-22).
  const [f, setF] = useState({
    description: prefill?.description || '', amount: prefill?.amount ? String(prefill.amount) : '', timing: prefill?.timing || defaultTiming(task),
    vendorId: (prefill?.vendorId && vendors.some(v => v.id === prefill.vendorId) ? prefill.vendorId : '') || hinted?.id || '', inPL: true, notInPLReason: '', onBehalf: false,
    split: 'full' as SplitKind, parts: [] as PartPlan[],
  });
  // Paid in parts (2026-10-26): the deposit is due now, the balance a set number of days before the training.
  const balanceDays = useBalanceDays();
  const today = todayIso();
  const balanceDue = () => {
    const d = deal?.trainingDate ? addDays(String(deal.trainingDate).slice(0, 10), -balanceDays) : '';
    return d && d > today ? d : today;
  };
  const halfPlan = (): PartPlan[] => [{ label: 'Deposit', pct: '50', due: today }, { label: 'Balance', pct: '50', due: balanceDue() }];
  const chooseSplit = (k: SplitKind) => setF(x => ({ ...x, split: k, parts: k === 'full' ? [] : k === 'half' || x.parts.length < 2 ? halfPlan() : x.parts }));
  const setPart = (i: number, patch: Partial<PartPlan>) => setF(x => ({ ...x, split: 'custom', parts: x.parts.map((p, n) => (n === i ? { ...p, ...patch } : p)) }));
  const pctSum = Math.round(f.parts.reduce((t, p) => t + (Number(p.pct) || 0), 0) * 100) / 100;
  const partAmounts = f.split === 'full' ? [] : splitAmounts(num(f.amount) || 0, f.parts.map(p => (Number(p.pct) || 0) / 100));
  const draft = useFormDraft(viewer.id, `cost:${deal.id}:${task.id}`, f, setF);
  const [newVendor, setNewVendor] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const words = quickWords(task);

  // The step's own type first, then everyone else, A to Z.
  const named = vendors.map(v => ({ v, name: vendorName(v, trainers, venues) }));
  const first = named.filter(x => x.v.type === vType).sort((a, b) => a.name.localeCompare(b.name));
  const rest = named.filter(x => x.v.type !== vType).sort((a, b) => a.name.localeCompare(b.name));
  const vendor = vendors.find(v => v.id === f.vendorId);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = num(f.amount);
    if (!f.description.trim()) return setError('Say what it is for, e.g. Booking.');
    if (!(amount > 0)) return setError('Enter the amount, for example 5000.');
    if (!vendor) return setError('Pick who is paid, or add a new vendor.');
    if (!f.onBehalf && !f.inPL && f.notInPLReason.trim().length < 3) return setError('Say briefly why this cost is not in the P&L.');
    const split = f.split !== 'full' && f.parts.length > 1;
    if (split) {
      if (f.parts.some(p => !(Number(p.pct) > 0))) return setError('Give every part a %, for example 50.');
      if (Math.abs(pctSum - 100) > 0.01) return setError(`The parts add up to ${pctSum}%; they must add up to 100%.`);
      if (f.parts.some(p => !/^\d{4}-\d{2}-\d{2}$/.test(p.due))) return setError('Give every part its due date.');
      if (f.parts.some(p => !p.label.trim())) return setError('Name every part, e.g. Deposit or Balance.');
    }
    // No double payment by mistake (2026-10-21): this vendor already has a cost on this step?
    const same = lines.filter(o => o.vendorId === vendor.id && o.status !== 'rejected');
    if (same.length && !window.confirm(`${vendorName(vendor, trainers, venues)} already has ${same.length} cost line${same.length === 1 ? '' : 's'} on this step (${same.map(o => `${o.description || o.category} RM ${Number(o.amount).toFixed(2)}`).join(', ')}).\n\nAdd another one anyway (e.g. a second invoice)? For a deposit and balance on the same cost, use "How it's paid" instead.`)) return;
    const id =`out_${Date.now()}${Math.random().toString(36).slice(2, 5)}`;
    const base = {
      dealId: deal.id, kind: 'deal', category: costCategory(task), payee: vendorName(vendor, trainers, venues), vendorId: vendor.id,
      description: f.description.trim(), inPL: !f.onBehalf && !!f.inPL, onBehalf: !!f.onBehalf, checklistTaskId: task.id, requestDate: todayIso(),
      notInPLReason: !f.onBehalf && !f.inPL ? f.notInPLReason.trim() : '',
      status: 'pending', requestedById: viewer.id, requestedByName: viewer.name, requestedByRole: viewer.role, requestedAt: new Date().toISOString(),
      decidedById: '', decidedByName: '', decidedAt: '', rejectReason: '', paidDate: '', paidRef: '', paidById: '', paidByName: '',
      // A trainer fee is agreed by a manager before the PO goes to the trainer (2026-10-23).
      ...(task.kind === 'trainer' ? { feeAgreeNeeded: true } : {}),
    };
    setBusy(true); setError('');
    try {
      if (!split) {
        await setDoc(doc(db, 'money_out', id), { ...base, id, amount: Math.round(amount * 100) / 100, timing: f.timing });
      } else {
        // One request per part, sharing the first part's id; a part due after the training is a post-training payment.
        const end = trainingEndDate(deal);
        const amounts = splitAmounts(amount, f.parts.map(p => Number(p.pct) / 100));
        const batch = writeBatch(db);
        f.parts.forEach((p, i) => {
          const pid = i === 0 ? id : `${id}_p${i + 1}`;
          batch.set(doc(db, 'money_out', pid), {
            ...base, id: pid, amount: amounts[i], timing: end ? (p.due > end ? 'after' : 'before') : f.timing,
            partGroup: id, partNo: i + 1, partCount: f.parts.length, partLabel: `${p.label.trim()} ${Number(p.pct)}%`, dueDate: p.due,
          });
        });
        await batch.commit();
      }
      draft.clear();
      onDone();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  if (newVendor) {
    return (
      <VendorForm vendors={vendors} trainers={trainers} venues={venues} viewer={viewer}
        start={{ type: hint?.type || vType, trainerId: hint?.trainerId, venueId: hint?.venueId, name: hint?.name || '' }}
        onSaved={v => { setF(x => ({ ...x, vendorId: v.id })); setNewVendor(false); }} onCancel={() => setNewVendor(false)} />
    );
  }

  return (
    <form onSubmit={save} className="space-y-3 rounded-xl border border-line bg-surface p-3">
      <DraftBar draft={draft} what="cost" />
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
        <div>
          <label className={small} htmlFor={`cd-${task.id}`}>What for</label>
          <input id={`cd-${task.id}`} value={f.description} onChange={e => setF(x => ({ ...x, description: e.target.value }))} className={input}
            placeholder={words[0] ? `e.g. ${words[0]}` : 'What it is for'} />
          {words.length > 0 && (
            <span className="mt-1 flex flex-wrap gap-1">
              {words.map(w => (
                <button key={w} type="button" onClick={() => setF(x => ({ ...x, description: w }))}
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${f.description === w ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-white text-ink-soft hover:text-ink'}`}>{w}</button>
              ))}
            </span>
          )}
        </div>
        <div>
          <label className={small} htmlFor={`ca-${task.id}`}>Amount (RM)</label>
          <input id={`ca-${task.id}`} inputMode="decimal" value={f.amount} onChange={e => setF(x => ({ ...x, amount: e.target.value.replace(/[^0-9.]/g, '') }))} className={input} placeholder="5000" />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={small} htmlFor={`cv-${task.id}`}>Pay to (vendor)</label>
          <select id={`cv-${task.id}`} value={f.vendorId} onChange={e => e.target.value === '__new' ? setNewVendor(true) : setF(x => ({ ...x, vendorId: e.target.value }))} className={input}>
            <option value="">Pick a vendor</option>
            {first.length > 0 && <optgroup label={`${task.label} vendors`}>{first.map(x => <option key={x.v.id} value={x.v.id}>{x.name}</option>)}</optgroup>}
            {rest.length > 0 && <optgroup label="Other vendors">{rest.map(x => <option key={x.v.id} value={x.v.id}>{x.name}</option>)}</optgroup>}
            <option value="__new">+ New vendor{hint?.name && !hinted ? ` (${hint.name})` : ''}…</option>
          </select>
          {vendor && <span className={`mt-0.5 block text-xs ${hasBank(vendor) ? 'text-ink-soft' : 'font-semibold text-attention'}`}>{hasBank(vendor) ? bankText(vendor) : 'No bank details yet: add them in Admin work → Vendors.'}</span>}
        </div>
        {f.split === 'full' && <div>
          <span className={small}>When it's paid</span>
          <div className="flex gap-2">
            {(['before', 'after'] as OutTiming[]).map(k => (
              <button key={k} type="button" aria-pressed={f.timing === k} onClick={() => setF(x => ({ ...x, timing: k }))}
                className={`flex-1 rounded-lg border px-2 py-2 text-sm font-semibold ${f.timing === k ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-white text-ink-soft hover:bg-surface'}`}>{TIMING_LABELS[k]}</button>
            ))}
          </div>
        </div>}
      </div>
      <div>
        <span className={small}>How it's paid</span>
        <div className="flex flex-wrap gap-2">
          {([['full', 'In full'], ['half', '50% now, 50% before training'], ['custom', 'Split my way']] as [SplitKind, string][]).map(([k, label]) => (
            <button key={k} type="button" aria-pressed={f.split === k} onClick={() => chooseSplit(k)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${f.split === k ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-white text-ink-soft hover:bg-surface'}`}>{label}</button>
          ))}
        </div>
        {f.split !== 'full' && (
          <div className="mt-2 space-y-2 rounded-lg border border-line bg-white p-2.5">
            {f.parts.map((p, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_4.5rem] items-end gap-2 sm:grid-cols-[minmax(0,1fr)_5rem_9.5rem_auto]">
                <div><label className={small} htmlFor={`pp-l-${task.id}-${i}`}>Part {i + 1}</label><input id={`pp-l-${task.id}-${i}`} value={p.label} onChange={e => setPart(i, { label: e.target.value })} className={input} /></div>
                <div><label className={small} htmlFor={`pp-p-${task.id}-${i}`}>%</label><input id={`pp-p-${task.id}-${i}`} inputMode="decimal" value={p.pct} onChange={e => setPart(i, { pct: e.target.value.replace(/[^0-9.]/g, '') })} className={input} /></div>
                <div><label className={small} htmlFor={`pp-d-${task.id}-${i}`}>Due on</label><input id={`pp-d-${task.id}-${i}`} type="date" value={p.due} onChange={e => setPart(i, { due: e.target.value })} className={input} /></div>
                <span className="flex items-center gap-1 pb-2 text-sm tabular-nums text-ink-soft">
                  {num(f.amount) > 0 ? sen(partAmounts[i] || 0) : ''}
                  {f.parts.length > 2 && <button type="button" onClick={() => setF(x => ({ ...x, split: 'custom', parts: x.parts.filter((_, n) => n !== i) }))} className="rounded-md p-1 hover:bg-surface" aria-label={`Remove part ${i + 1}`}><X className="h-4 w-4" /></button>}
                </span>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              {f.parts.length < 6 && <button type="button" className={btnSmall} onClick={() => setF(x => ({ ...x, split: 'custom', parts: [...x.parts, { label: 'Part', pct: String(Math.max(0, 100 - pctSum)), due: balanceDue() }] }))}><Plus className="h-3.5 w-3.5" /> Add a part</button>}
              <span className={`text-sm ${Math.abs(pctSum - 100) > 0.01 ? 'font-semibold text-danger' : 'text-ink-soft'}`}>{pctSum}% of 100%</span>
            </div>
            <p className="text-sm text-ink-soft">A manager approves the whole cost once. Each part goes to accounts on its due date and gets its own receipt; the P&L counts the cost once. The balance date comes from Money settings ({balanceDays} days before training).</p>
          </div>
        )}
      </div>
      <label className="flex items-center gap-2 text-[15px]">
        <input type="checkbox" checked={!!f.onBehalf} onChange={e => setF(x => ({ ...x, onBehalf: e.target.checked }))} className="h-4 w-4 accent-[#0E6E62]" />
        {ON_BEHALF_LABEL} <span className="text-sm text-ink-soft">(e.g. hotel or bus: we pay now, the client pays us back; not in the P&L)</span>
      </label>
      {!f.onBehalf && (
        <label className="flex items-center gap-2 text-[15px]">
          <input type="checkbox" checked={!!f.inPL} onChange={e => setF(x => ({ ...x, inPL: e.target.checked }))} className="h-4 w-4 accent-[#0E6E62]" />
          Include in P&L <span className="text-sm text-ink-soft">(count it as a cost of this training)</span>
        </label>
      )}
      {!f.onBehalf && !f.inPL && (
        <input value={f.notInPLReason} onChange={e => setF(x => ({ ...x, notInPLReason: e.target.value }))} className={input}
          placeholder="Why is it not a cost of this training?" aria-label="Why it is not in the P&L" />
      )}
      <p className="text-sm text-ink-soft">It waits for {viewer.role === 'management' ? 'the other manager' : 'a manager'} to approve it, then goes on the payment summary for accounts.</p>
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <button type="button" className={btnSecondary} onClick={onDone}>Cancel</button>
        <button type="submit" disabled={busy} className={btnPrimary}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Add cost</button>
      </div>
    </form>
  );
}

/** The trainer mileage rate from Money settings, live. */
function useMileageRate(): number {
  const [n, setN] = useState(DEFAULT_MONEY_SETTINGS.mileageRate);
  useEffect(() => onSnapshot(doc(db, 'config', 'money_settings'), d => setN(readMoneySettings(d.data()).mileageRate), () => {}), []);
  return n;
}

/** Mileage claim on the Trainer step (Joel, 2026-10-31): optional; km × RM per km (rate from Money settings, changeable
 *  here) or a fixed amount; on the PO or not. A cost line like the fee: a manager approves it, paid after the training,
 *  in the P&L (Include in P&L ticked). On the PO it is agreed by a manager first, like the fee; off the PO it isn't. */
function MileageForm({ deal, task, viewer, vendors, trainers, venues, hint, onDone }: {
  deal: any; task: ChecklistTask; viewer: Viewer; vendors: Vendor[]; trainers: any[]; venues: any[]; hint?: VendorHint; onDone: () => void;
}) {
  const rate0 = useMileageRate();
  // Always paid to the trainer picked on this step (Joel, 2026-10-31): no vendor to choose.
  const trainerId = hint?.trainerId || '';
  const vendor = trainerId ? vendors.find(v => v.trainerId === trainerId) : undefined;
  const [f, setF] = useState({ mode: 'km' as 'km' | 'fixed', km: '', rate: '', amount: '', onPo: true, inPL: true, notInPLReason: '' });
  const draft = useFormDraft(viewer.id, `mileage:${deal.id}:${task.id}`, f, setF);
  const [newVendor, setNewVendor] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const rate = f.rate === '' ? rate0 : num(f.rate);
  const total = f.mode === 'km' ? mileageAmount(num(f.km) || 0, rate || 0) : num(f.amount) || 0;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (f.mode === 'km' && !(num(f.km) > 0)) return setError('Enter the km, for example 240 (there and back).');
    if (f.mode === 'km' && !(rate > 0)) return setError('Enter the rate per km, for example 0.60.');
    if (!(total > 0)) return setError('Enter the amount, for example 150.');
    if (!vendor) return setError(trainerId ? "Add the trainer's bank details first." : 'Pick the trainer from the Trainers list on this step first.');
    if (!f.inPL && f.notInPLReason.trim().length < 3) return setError('Say briefly why this cost is not in the P&L.');
    const id = `out_${Date.now()}${Math.random().toString(36).slice(2, 5)}`;
    setBusy(true); setError('');
    try {
      await setDoc(doc(db, 'money_out', id), {
        id, dealId: deal.id, kind: 'deal', category: costCategory(task), payee: vendorName(vendor, trainers, venues), vendorId: vendor.id,
        description: f.mode === 'km' ? mileageText(num(f.km), rate) : 'Mileage claim', amount: total, timing: 'after' as OutTiming,
        mileage: f.mode, onPo: f.onPo, inPL: f.inPL, onBehalf: false, notInPLReason: f.inPL ? '' : f.notInPLReason.trim(),
        checklistTaskId: task.id, requestDate: todayIso(),
        status: 'pending', requestedById: viewer.id, requestedByName: viewer.name, requestedByRole: viewer.role, requestedAt: new Date().toISOString(),
        decidedById: '', decidedByName: '', decidedAt: '', rejectReason: '', paidDate: '', paidRef: '', paidById: '', paidByName: '',
        ...(f.onPo ? { feeAgreeNeeded: true } : {}),
      });
      draft.clear();
      onDone();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  if (newVendor) {
    return (
      <VendorForm vendors={vendors} trainers={trainers} venues={venues} viewer={viewer}
        start={{ type: 'trainer', trainerId: hint?.trainerId, venueId: undefined, name: hint?.name || '' }}
        onSaved={() => setNewVendor(false)} onCancel={() => setNewVendor(false)} />
    );
  }

  const pick = (on: boolean) => `rounded-lg border px-3 py-1.5 text-sm font-semibold ${on ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-white text-ink-soft hover:bg-surface'}`;
  return (
    <form onSubmit={save} className="space-y-3 rounded-xl border border-line bg-surface p-3">
      <DraftBar draft={draft} what="mileage claim" />
      <p className="font-semibold">Mileage claim</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={f.mode === 'km'} className={pick(f.mode === 'km')} onClick={() => setF(x => ({ ...x, mode: 'km' }))}>By km × RM per km</button>
        <button type="button" aria-pressed={f.mode === 'fixed'} className={pick(f.mode === 'fixed')} onClick={() => setF(x => ({ ...x, mode: 'fixed' }))}>Fixed amount</button>
      </div>
      {f.mode === 'km' ? (
        <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-[9rem_9rem_minmax(0,1fr)]">
          <div><label className={small} htmlFor={`mk-${task.id}`}>Km</label>
            <input id={`mk-${task.id}`} inputMode="decimal" value={f.km} onChange={e => setF(x => ({ ...x, km: e.target.value.replace(/[^0-9.]/g, '') }))} className={input} placeholder="240" /></div>
          <div><label className={small} htmlFor={`mr-${task.id}`}>RM per km</label>
            <input id={`mr-${task.id}`} inputMode="decimal" value={f.rate} onChange={e => setF(x => ({ ...x, rate: e.target.value.replace(/[^0-9.]/g, '') }))} className={input} placeholder={rate0.toFixed(2)} /></div>
          <p className="col-span-2 pb-2 text-[15px] sm:col-span-1">= <span className="font-semibold tabular-nums">{sen(total)}</span></p>
        </div>
      ) : (
        <div className="max-w-[9rem]"><label className={small} htmlFor={`ma-${task.id}`}>Amount (RM)</label>
          <input id={`ma-${task.id}`} inputMode="decimal" value={f.amount} onChange={e => setF(x => ({ ...x, amount: e.target.value.replace(/[^0-9.]/g, '') }))} className={input} placeholder="150" /></div>
      )}
      <div>
        <span className={small}>Paid to (the trainer on this step)</span>
        {vendor ? (
          <>
            <p className="text-[15px] font-semibold">{vendorName(vendor, trainers, venues)}</p>
            <span className={`block text-xs ${hasBank(vendor) ? 'text-ink-soft' : 'font-semibold text-attention'}`}>{hasBank(vendor) ? bankText(vendor) : 'No bank details yet: add them in Admin work → Vendors.'}</span>
          </>
        ) : trainerId ? (
          <p className="flex flex-wrap items-center gap-2 text-sm text-attention">
            <span className="font-semibold">{hint?.name || 'This trainer'} has no bank details yet.</span>
            <button type="button" className={btnSmall} onClick={() => setNewVendor(true)}><Plus className="h-3.5 w-3.5" /> Add their bank details</button>
          </p>
        ) : (
          <p className="text-sm font-semibold text-attention">Pick the trainer from the Trainers list on this step first.</p>
        )}
      </div>
      <label className="flex items-center gap-2 text-[15px]">
        <input type="checkbox" checked={f.onPo} onChange={e => setF(x => ({ ...x, onPo: e.target.checked }))} className="h-4 w-4 accent-[#0E6E62]" />
        Show on the PO <span className="text-sm text-ink-soft">({f.onPo ? 'a manager agrees it with the fee before the PO goes out' : 'still paid to the trainer, just not printed on the PO'})</span>
      </label>
      <label className="flex items-center gap-2 text-[15px]">
        <input type="checkbox" checked={f.inPL} onChange={e => setF(x => ({ ...x, inPL: e.target.checked }))} className="h-4 w-4 accent-[#0E6E62]" />
        Include in P&L <span className="text-sm text-ink-soft">(count it as a cost of this training)</span>
      </label>
      {!f.inPL && (
        <input value={f.notInPLReason} onChange={e => setF(x => ({ ...x, notInPLReason: e.target.value }))} className={input}
          placeholder="Why is it not a cost of this training?" aria-label="Why it is not in the P&L" />
      )}
      <p className="text-sm text-ink-soft">Paid after the training, with the fee. It waits for {viewer.role === 'management' ? 'the other manager' : 'a manager'} to approve it.</p>
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <button type="button" className={btnSecondary} onClick={onDone}>Cancel</button>
        <button type="submit" disabled={busy} className={btnPrimary}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Add mileage claim</button>
      </div>
    </form>
  );
}

/** A rejected request, fixed by the person who raised it and sent for approval again (Joel, 2026-10-21), instead of
 *  deleting it and starting over. The rejection is cleared; the deal's History keeps a line. */
export async function resubmitRequest(o: MoneyOut, patch: Partial<MoneyOut>, viewer: Viewer) {
  const batch = writeBatch(db);
  // A new amount on an agreed trainer fee needs agreeing again, and a new PO (2026-10-23).
  const reAgree = !!o.feeAgreed && patch.amount !== undefined && Math.abs(Number(patch.amount) - Number(o.amount)) > 0.005;
  batch.update(doc(db, 'money_out', o.id), { ...patch, ...(reAgree ? { feeAgreed: null } : {}), status: 'pending', decidedById: '', decidedByName: '', decidedAt: '', rejectReason: '', resubmittedAt: new Date().toISOString() });
  const d = o.dealId ? await getDoc(doc(db, 'pipelines', o.dealId)) : null;
  if (d?.exists()) {
    const entry = { at: new Date().toISOString(), byId: viewer.id, byName: viewer.name, action: `Fixed and sent again for approval: ${o.category} · ${o.payee} (${sen(Number(patch.amount ?? o.amount))}, rejected: ${o.rejectReason || 'no reason'})` };
    batch.update(d.ref, { history: [...((d.data() as any).history || []), entry] });
  }
  await batch.commit();
}

/** Fix a rejected training cost: what it's for and the amount. (Company payments reopen their own form.) */
export function FixRequest({ o, viewer, onDone }: { o: MoneyOut; viewer: Viewer; onDone: () => void }) {
  // A mileage claim by km is fixed by its km and rate; the description and amount follow (2026-10-31).
  const byKm = o.mileage === 'km';
  const [f, setF] = useState({ description: o.description || '', amount: String(o.amount ?? ''), ...mileageFrom(o.description) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    if (byKm) {
      if (!(num(f.km) > 0) || !(num(f.rate) > 0)) return setError('Enter the km and the rate per km.');
      setBusy(true); setError('');
      try { await resubmitRequest(o, { description: mileageText(num(f.km), num(f.rate)), amount: mileageAmount(num(f.km), num(f.rate)) }, viewer); onDone(); }
      catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
      return;
    }
    const amount = num(f.amount);
    if (!f.description.trim()) return setError('Say what it is for.');
    if (!(amount > 0)) return setError('Enter the amount, for example 5000.');
    setBusy(true); setError('');
    try { await resubmitRequest(o, { description: f.description.trim(), amount: Math.round(amount * 100) / 100 }, viewer); onDone(); }
    catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-line bg-surface p-3">
      {o.rejectReason && <p className="text-sm text-danger">Rejected: {o.rejectReason}</p>}
      {byKm ? (
        <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[9rem_9rem_minmax(0,1fr)]">
          <div><label className={small} htmlFor={`fx-k-${o.id}`}>Km</label><input id={`fx-k-${o.id}`} inputMode="decimal" value={f.km} onChange={e => setF(x => ({ ...x, km: e.target.value.replace(/[^0-9.]/g, '') }))} className={input} /></div>
          <div><label className={small} htmlFor={`fx-r-${o.id}`}>RM per km</label><input id={`fx-r-${o.id}`} inputMode="decimal" value={f.rate} onChange={e => setF(x => ({ ...x, rate: e.target.value.replace(/[^0-9.]/g, '') }))} className={input} /></div>
          <p className="col-span-2 pb-2 sm:col-span-1">= <span className="font-semibold tabular-nums">{sen(mileageAmount(num(f.km) || 0, num(f.rate) || 0))}</span></p>
        </div>
      ) : <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem]">
        <div><label className={small} htmlFor={`fx-d-${o.id}`}>What for</label><input id={`fx-d-${o.id}`} value={f.description} onChange={e => setF(x => ({ ...x, description: e.target.value }))} className={input} /></div>
        <div><label className={small} htmlFor={`fx-a-${o.id}`}>Amount (RM)</label><input id={`fx-a-${o.id}`} inputMode="decimal" value={f.amount} onChange={e => setF(x => ({ ...x, amount: e.target.value.replace(/[^0-9.]/g, '') }))} className={input} /></div>
      </div>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <button type="button" className={btnSecondary} onClick={onDone}>Cancel</button>
        <button type="button" disabled={busy} className={btnPrimary} onClick={save}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Send for approval again</button>
      </div>
    </div>
  );
}

/** Can this person change a cost's P&L ticks? Admin and Management while it waits for approval; once approved or paid,
 *  Management only (process audit, 2026-10-22: the profit can't be changed after approval without a manager). */
const canTick = (o: MoneyOut, viewer: Viewer) => viewer.role === 'management' || (viewer.role === 'admin' && (o.status === 'pending' || o.status === 'rejected'));
const tickLocked = 'Approved: only Management can change this now.';

/** "Pay on behalf of client" tick beside a cost (Joel, 2026-10-22): the client pays it back on a reimbursement invoice
 *  after training (lib/onBehalf.ts); never in the P&L. Each change goes into the deal's History. Unticked, the cost
 *  counts in the P&L again. */
export function BehalfTick({ o, viewer }: { o: MoneyOut; viewer: Viewer }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const on = !!o.onBehalf;
  const change = async (next: boolean) => {
    if (!next && !window.confirm('Untick "Pay on behalf of client"? It will no longer be claimed back from the client, and it counts in the P&L. If it is already on a reimbursement invoice, fix that invoice in After training too.')) return;
    setBusy(true); setError('');
    try {
      const what = `${o.category} · ${o.payee}${o.description ? ` · ${o.description}` : ''} (${sen(o.amount)})`;
      await withDealHistory(o.dealId || '', viewer, `${next ? 'Marked as paid on behalf of client (to claim back)' : 'No longer paid on behalf of client'}: ${what}`,
        batch => batch.update(doc(db, 'money_out', o.id), next ? { onBehalf: true } : { onBehalf: false, inPL: true, notInPLReason: '' }));
    } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };
  if (viewer.role === 'rep') return null;
  const locked = !canTick(o, viewer);
  return (
    <label className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-semibold ${locked ? '' : 'cursor-pointer'} ${on ? 'border-attention/40 bg-attention-soft text-attention' : 'border-line bg-white text-ink-soft'}`}
      title={locked ? tickLocked : 'Ticked: we pay it for the client and claim it back after training. Not in the P&L.'}>
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <input type="checkbox" checked={on} disabled={busy || locked} onChange={e => change(e.target.checked)} className="h-3.5 w-3.5 accent-[#0E6E62]" />}
      {ON_BEHALF_LABEL}
      {error && <span role="alert" className="ml-1 font-normal text-danger">{error}</span>}
    </label>
  );
}

/** "Include in P&L" tick beside a cost (Joel, 2026-10-21). Unticked = still a payment to approve and pay, but not a
 *  cost in the training's P&L; unticking needs a short reason (process audit, 2026-10-22). Each change goes into the
 *  deal's History. */
export function PLTick({ o, viewer }: { o: MoneyOut; viewer: Viewer }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const on = inPL(o);
  const change = async (next: boolean) => {
    const reason = next ? '' : askReason('Leave this cost out of the P&L? Why is it not a cost of this training?');
    if (!next && !reason) return;
    setBusy(true); setError('');
    try {
      const what = `${o.category} · ${o.payee}${o.description ? ` · ${o.description}` : ''} (${sen(o.amount)})`;
      await withDealHistory(o.dealId || '', viewer, `${next ? 'Included in the P&L' : `Left out of the P&L (${reason})`}: ${what}`,
        batch => batch.update(doc(db, 'money_out', o.id), { inPL: next, notInPLReason: reason || '' }));
    } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };
  if (viewer.role === 'rep') return null;
  const locked = !canTick(o, viewer);
  return (
    <label className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-semibold ${locked ? '' : 'cursor-pointer'} ${on ? 'border-accent/40 bg-accent-soft text-accent' : 'border-line bg-white text-ink-soft'}`}
      title={locked ? tickLocked : 'Ticked: counted as a cost in this training\'s P&L. Unticked: still paid, but not in the P&L.'}>
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <input type="checkbox" checked={on} disabled={busy || locked} onChange={e => change(e.target.checked)} className="h-3.5 w-3.5 accent-[#0E6E62]" />}
      Include in P&L
      {error && <span role="alert" className="ml-1 font-normal text-danger">{error}</span>}
    </label>
  );
}
