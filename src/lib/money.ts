// Money per deal (Phase 3).
// - money_in/{id}: an HRDC claim or a client invoice on a deal, and what was actually paid.
// - money_out/{id}: a payment request (trainer, venue, ...) that needs a manager's approval
//   before it can be marked paid. Nobody approves their own request.
// - config/money_settings: HRDC deduction %, days before a payment counts as overdue,
//   and the HRDC claim deadline (blank until Joel confirms HRD Corp's current rule).

import { addDays, formatRM, todayIso, trainingEndDate } from './deals';
import { daysUntil, Flag } from './checklist';
import { isSuperManager, superConfirm } from './superManager';

export type InSource = 'hrdc' | 'client';
export type OutStatus = 'pending' | 'approved' | 'rejected' | 'paid';
export type OutTiming = 'before' | 'after';

export const OUT_CATEGORIES = ['Trainer', 'Venue', 'Hotel', 'Bus', 'Materials', 'Facilitator', 'Commission', 'Staff claim', 'Other'];

// When a training's payment is due (Joel, 2026-10-20: "pre training payment tick, post training payment tick").
export const TIMING_LABELS: Record<OutTiming, string> = { before: 'Pre-training', after: 'Post-training' };

// Company payments: requests not tied to a training (Joel, 2026-10-18). Stored in money_out
// with an empty dealId and kind 'company', so they follow the same approval rules.
export const COMPANY_CATEGORIES = ['Office', 'Rental', 'Utilities', 'Marketing', 'Equipment', 'Software and subscriptions', 'Travel', 'Staff claim', 'Other'];

export interface OutItem { description: string; qty: number; price: number }

export const isCompanyPayment = (o: { dealId?: string; kind?: string }) => o.kind === 'company' || !o.dealId;
export const itemsTotal = (items: OutItem[]) => Math.round(items.reduce((t, i) => t + (Number(i.qty) || 0) * (Number(i.price) || 0), 0) * 100) / 100;

export const OUT_STATUS_LABELS: Record<OutStatus, string> = {
  pending: 'Waiting for approval',
  approved: 'Approved, not paid',
  rejected: 'Rejected',
  paid: 'Payment made',
};

export const IN_SOURCE_LABELS: Record<InSource, string> = {
  hrdc: 'HRDC claim',
  client: 'Client invoice',
};

export interface MoneyIn {
  id: string;
  dealId: string;
  source: InSource;
  invoiceNo: string;
  invoiceDate: string;     // HRDC: date the claim was submitted
  amount: number;          // amount invoiced or claimed
  paidDate?: string;
  paidAmount?: number;
  // Payment recorded since 2026-10-20: when and by whom. Such a payment needs its receipt uploaded before the
  // deal is "Case closed" (lib/postTraining.ts); payments recorded before have no paidAt and need none.
  paidAt?: string;
  paidById?: string;
  paidByName?: string;
  note?: string;
  // HRDC paid less than expected (process audit, 2026-10-22): the gap is billed to the client on a top-up invoice (a
  // client invoice with topUpFor = this claim's id), or Management writes it off with a reason.
  topUpFor?: string;
  shortfallWriteOff?: { byId: string; byName: string; at: string; reason: string; amount: number };
  // Process audit (2026-10-22): only Management undoes a payment (stamped), and nothing is erased (marked deleted).
  lastUndo?: UndoStamp;
  deleted?: boolean;
  deletedById?: string;
  deletedByName?: string;
  deletedAt?: string;
  deletedReason?: string;
}

/** Who undid a payment, when, and what it was (firestore.rules: Management only). */
export interface UndoStamp { byId: string; byName: string; at: string; paidDate: string; amount: number; ref?: string }

/** The stamp to save when Management undoes a payment. */
export function undoStamp(viewer: { id: string; name: string }, paidDate: string | undefined, amount: number, ref = ''): UndoStamp {
  return { byId: viewer.id, byName: viewer.name, at: new Date().toISOString(), paidDate: paidDate || '', amount: Number(amount) || 0, ...(ref ? { ref } : {}) };
}

/** The fields that mark a money record deleted (kept, restorable by Management). */
export function deletedStamp(viewer: { id: string; name: string }, reason: string) {
  return { deleted: true, deletedById: viewer.id, deletedByName: viewer.name, deletedAt: new Date().toISOString(), deletedReason: reason.trim() };
}

export interface MoneyOut {
  id: string;
  dealId: string;          // '' for a company payment
  kind?: 'deal' | 'company';
  category: string;
  payee: string;
  description?: string;
  amount: number;
  timing: OutTiming;
  status: OutStatus;
  requestedById: string;
  requestedByName: string;
  requestedAt: string;
  decidedById?: string;
  decidedByName?: string;
  decidedAt?: string;
  rejectReason?: string;
  paidDate?: string;
  paidRef?: string;
  paidById?: string;
  paidByName?: string;
  // Company payments only
  requestDate?: string;    // date of request (typed; defaults to today)
  items?: OutItem[];       // amount = their total
  neededBy?: string;
  paymentDetails?: string; // e.g. bank and account name
  // Link for accounts (Joel, 2026-10-20): accounts open it without logging in and click "Payment made".
  accountsLink?: { token: string; at: string; byName: string } | null;
  paidAt?: string;         // exact time accounts clicked "Payment made" (ISO); with an empty paidById
  // Raised from a deal's before-training checklist (2026-10-20): the step it belongs to and the vendor (lib/vendors.ts).
  checklistTaskId?: string;
  vendorId?: string;
  // On a payment summary sent to accounts (payment_links kind 'batch'): the summary's link token.
  summaryToken?: string;
  // Include in P&L (Joel, 2026-10-21): older requests without it count. Since the process audit (2026-10-22) new
  // cost lines start ticked, and leaving one out needs a short reason (notInPLReason).
  inPL?: boolean;
  notInPLReason?: string;
  // Trainer fee agreed by a manager before the PO (Joel, 2026-10-23): new trainer fee lines have feeAgreeNeeded; the PO and
  // the trainer portal use a line only once feeAgreed matches its amount (older lines count as agreed). See lib/trainerPortal.ts.
  feeAgreeNeeded?: boolean;
  feeAgreed?: { byId: string; byName: string; at: string; amount: number } | null;
  decidedTs?: any;         // the database's own time of the approval or rejection (firestore.rules)
  lastUndo?: UndoStamp;    // Management undid "paid" (process audit, 2026-10-22)
  deleted?: boolean;       // approved or paid requests are marked deleted, never erased (process audit, 2026-10-22)
  deletedById?: string;
  deletedByName?: string;
  deletedAt?: string;
  deletedReason?: string;
  // Stopped (status 'rejected', reason "Training cancelled") when Management approved the training's cancellation
  // (2026-10-21, lib/trainingChange.ts); not shown to the requester as a rejection to redo.
  trainingCancelled?: boolean;
  resubmittedAt?: string;  // the requester fixed a rejected request and sent it again (2026-10-21)
  // Paid on behalf of the client (2026-10-22): the client pays us back on a reimbursement invoice (lib/onBehalf.ts).
  // Never a cost in the P&L.
  onBehalf?: boolean;
}

// ---------- When a payment can be paid (Joel, 2026-10-21: the payment-out flowchart) ----------
// Pre-training and company payments can be paid once approved. Post-training payments can be approved any time,
// but go on the accounts summary only from the day after the training's last day (a cancelled training's at once).

/** The first day this request can be paid ('' = now). */
export function payableFrom(o: MoneyOut, deal: any): string {
  if (!o.dealId || o.timing !== 'after' || !deal || deal.trainingCancelled) return '';
  const end = trainingEndDate(deal);
  return end ? addDays(end, 1) : '';
}
export const isPayable = (o: MoneyOut, deal: any, today = todayIso()) => { const from = payableFrom(o, deal); return !from || from <= today; };

/** Pre-training payments still not paid as the training gets close (within flagDays): red in the work queue and My home. */
export function prePaymentFlags(deal: any, outs: MoneyOut[], flagDays: number, today = todayIso()): Flag[] {
  if (!deal || deal.trainingCancelled) return [];
  const start = daysUntil(deal.trainingDate, today);
  if (start === null || start < 0 || start > flagDays) return [];
  const open = outs.filter(o => o.dealId === deal.id && o.timing === 'before' && (o.status === 'pending' || o.status === 'approved'));
  if (!open.length) return [];
  const total = open.reduce((t, o) => t + (Number(o.amount) || 0), 0);
  const when = start === 0 ? 'training is today' : `training in ${start} day${start === 1 ? '' : 's'}`;
  return [{ level: 'danger', text: `Pre-training payment not paid yet: ${open.map(o => `${o.category} ${o.payee}`).join(', ')} (${formatRM(total)}, ${when})` }];
}

/** Counted in the training's P&L? Missing = yes (requests made before the tick existed). Company payments never are,
 *  nor costs paid on behalf of the client (the client pays them back; lib/onBehalf.ts). */
export const inPL = (o: Pick<MoneyOut, 'inPL' | 'onBehalf'>) => o.inPL !== false && !o.onBehalf;

// PR-YYYYMMDD-NNNN, from the request date and the record's id (fixed, so it never changes).
export function paymentRef(o: Pick<MoneyOut, 'id' | 'requestDate' | 'requestedAt'>): string {
  const day = String(o.requestDate || o.requestedAt || '').slice(0, 10).replace(/-/g, '');
  const tail = String(o.id || '').replace(/\D/g, '').slice(-4) || '0000';
  return `PR-${day || 'NEW'}-${tail}`;
}

// Marked paid by accounts through the link (not by someone in the CRM). A later Undo paid + Mark paid in the CRM
// sets paidById, so an old paidAt is then ignored.
export const paidViaLink = (o: MoneyOut) => o.status === 'paid' && !o.paidById && !!o.paidAt;
export const ACCOUNTS_PAID_BY = 'Accounts (via link)';

// "21 Oct 2026, 3:45 pm" in Malaysian time.
export function dateTimeMY(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** "Payment raised 23 Oct 2026, 2:15 pm · pending boss approval" on a pending request (Joel, 2026-10-23). */
export const raisedText = (o: Pick<MoneyOut, 'requestedAt' | 'resubmittedAt' | 'requestDate'>) =>
  `Payment raised ${dateTimeMY(o.resubmittedAt || o.requestedAt) || o.requestDate || ''} · pending boss approval`;

/** The requests this person raised that a manager approved in the last 3 days: their My home notice (2026-10-23). */
export function recentlyApproved(outs: MoneyOut[], viewerId: string, now = Date.now()): MoneyOut[] {
  return outs.filter(o => o.status === 'approved' && o.requestedById === viewerId && o.decidedAt && now - Date.parse(o.decidedAt) < 3 * 86400_000);
}

export interface MoneySettings {
  hrdcDeductionPct: number;            // HRDC keeps this % of each claim
  overdueDays: number;                 // invoice or claim unpaid this long = overdue
  claimDeadlineDays: number | null;    // days after training to submit the HRDC claim (blank = no deadline countdown)
  claimReminderDays: number;           // claim still not submitted this many days after training = red
  commissionPct: number;               // sales person's commission: % of the selling price before SST and HRDC's % (Joel, 2026-10-20: 3)
  behalfReminderDays: number;          // paid on behalf of the client, not claimed back this many days after training = red
  // Earlier HRDC % and commission % (process audit, 2026-10-22): each applied up to and including 'until', so changing
  // a rate never changes past P&Ls, commissions or HRDC amounts. Oldest first.
  rates?: RatePeriod[];
}

export interface RatePeriod { until: string; hrdcDeductionPct: number; commissionPct: number }

const isDate = (d: any) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d);

/** The settings with the HRDC % and commission % that applied on this date (YYYY-MM-DD; blank = today's). */
export function settingsAt(s: MoneySettings, date?: string): MoneySettings {
  const d = isDate(date) ? String(date).slice(0, 10) : '';
  const old = d ? (s.rates || []).find(r => d <= r.until) : undefined;
  return old ? { ...s, hrdcDeductionPct: old.hrdcDeductionPct, commissionPct: old.commissionPct } : s;
}

// HRD Corp allows 6 months to claim (Joel, 2026-10-16); he wants a red reminder after 14 days.
export const DEFAULT_MONEY_SETTINGS: MoneySettings = { hrdcDeductionPct: 4, overdueDays: 30, claimDeadlineDays: 180, claimReminderDays: 14, commissionPct: 3, behalfReminderDays: 14 };

export function readMoneySettings(data: any): MoneySettings {
  const num = (v: any, d: number) => (Number.isFinite(Number(v)) && Number(v) >= 0 && v !== '' && v !== null ? Number(v) : d);
  return {
    hrdcDeductionPct: num(data?.hrdcDeductionPct, DEFAULT_MONEY_SETTINGS.hrdcDeductionPct),
    overdueDays: num(data?.overdueDays, DEFAULT_MONEY_SETTINGS.overdueDays),
    // Never saved = the default; saved blank = no deadline countdown.
    claimDeadlineDays: data?.claimDeadlineDays === undefined ? DEFAULT_MONEY_SETTINGS.claimDeadlineDays
      : data.claimDeadlineDays === null || data.claimDeadlineDays === '' ? null : num(data.claimDeadlineDays, 0),
    claimReminderDays: num(data?.claimReminderDays, DEFAULT_MONEY_SETTINGS.claimReminderDays),
    commissionPct: num(data?.commissionPct, DEFAULT_MONEY_SETTINGS.commissionPct),
    behalfReminderDays: num(data?.behalfReminderDays, DEFAULT_MONEY_SETTINGS.behalfReminderDays) || DEFAULT_MONEY_SETTINGS.behalfReminderDays,
    rates: (Array.isArray(data?.rates) ? data.rates : [])
      .filter((r: any) => isDate(r?.until))
      .map((r: any) => ({ until: String(r.until).slice(0, 10), hrdcDeductionPct: num(r.hrdcDeductionPct, DEFAULT_MONEY_SETTINGS.hrdcDeductionPct), commissionPct: num(r.commissionPct, DEFAULT_MONEY_SETTINGS.commissionPct) }))
      .sort((a: RatePeriod, b: RatePeriod) => a.until.localeCompare(b.until)),
  };
}

const money = (n: any) => (Number.isFinite(Number(n)) ? Number(n) : 0);

export function isPaid(m: MoneyIn): boolean {
  return isDate(m.paidDate);
}

// What we expect to receive for one invoice or claim (HRDC keeps its %).
export function expectedFor(m: MoneyIn, s: MoneySettings): number {
  const amt = money(m.amount);
  return m.source === 'hrdc' ? amt * (1 - settingsAt(s, m.invoiceDate).hrdcDeductionPct / 100) : amt;
}

// HRDC paid less than expected (beyond rounding).
export function shortfall(m: MoneyIn, s: MoneySettings): number {
  if (m.source !== 'hrdc' || !isPaid(m)) return 0;
  const gap = expectedFor(m, s) - money(m.paidAmount);
  return gap > 1 ? gap : 0;
}

/** HRDC claims paid short with nothing done about it yet: no top-up invoice to the client and not written off. */
export function openShortfalls(ins: MoneyIn[], s: MoneySettings): MoneyIn[] {
  return ins.filter(m => shortfall(m, s) > 0 && !m.shortfallWriteOff && !ins.some(x => x.source === 'client' && x.topUpFor === m.id));
}

// The money sums for one deal. Profit is not here: the one P&L is projectRow in lib/projectPL.ts (SST, HRDC's %,
// commission and costs), used by the deal screen, Project P&L and My home alike (Joel, 2026-10-21: no duplicate P&L).
export interface DealMoneySums {
  invoiced: number;        // gross invoiced to the client + claimed from HRDC
  hrdcFee: number;         // HRDC's deduction
  costs: number;           // approved and paid money out
  received: number;
  toComeIn: number;
  toPayOut: number;        // approved, not yet paid
  pendingApproval: number; // requested, not yet approved (not in costs)
  shortfall: number;
}

export function dealMoneySums(ins: MoneyIn[], outs: MoneyOut[], s: MoneySettings): DealMoneySums {
  const invoiced = ins.reduce((t, m) => t + money(m.amount), 0);
  const hrdcFee = ins.filter(m => m.source === 'hrdc').reduce((t, m) => t + money(m.amount) * (settingsAt(s, m.invoiceDate).hrdcDeductionPct / 100), 0);
  const received = ins.filter(isPaid).reduce((t, m) => t + money(m.paidAmount), 0);
  const toComeIn = ins.filter(m => !isPaid(m)).reduce((t, m) => t + expectedFor(m, s), 0);
  // Only lines ticked "Include in P&L" count as costs; every approved line still has to be paid (toPayOut).
  const counted = outs.filter(o => (o.status === 'approved' || o.status === 'paid') && inPL(o));
  const costs = counted.reduce((t, o) => t + money(o.amount), 0);
  const toPayOut = outs.filter(o => o.status === 'approved').reduce((t, o) => t + money(o.amount), 0);
  const pendingApproval = outs.filter(o => o.status === 'pending' && inPL(o)).reduce((t, o) => t + money(o.amount), 0);
  const short = ins.reduce((t, m) => t + shortfall(m, s), 0);
  return { invoiced, hrdcFee, costs, received, toComeIn, toPayOut, pendingApproval, shortfall: short };
}

// Can this person approve or reject this request? Managers only, never their own, except the Super Manager
// (Joel, 2026-10-22), who is asked to confirm a second time (ownApprovalOk).
export function canDecide(o: MoneyOut, viewer: { id: string; role: string }): boolean {
  return o.status === 'pending' && viewer.role === 'management' && (o.requestedById !== viewer.id || isSuperManager(viewer));
}

/** Approving your own request (Super Manager only): the second confirmation, naming the risk. */
export function ownApprovalOk(o: Pick<MoneyOut, 'requestedById' | 'payee' | 'amount'>, viewer: { id: string }): boolean {
  if (o.requestedById !== viewer.id) return true;
  return superConfirm(`approve your own payment request (${o.payee}, RM ${(Number(o.amount) || 0).toFixed(2)}).`,
    'nobody else checks this payment before it goes to accounts.');
}

// Money reminders up to training day, for the admin work queue. From the day after the training, the invoice,
// claim and payment reminders come from postTrainingFlags (lib/postTraining.ts), so nothing shows twice.
export function moneyFlags(deal: any, ins: MoneyIn[], outs: MoneyOut[], s: MoneySettings, today = todayIso()): Flag[] {
  const flags: Flag[] = [];
  const client = deal?.fundingType === 'direct' || deal?.fundingType === 'hrdc_topup';
  const start = daysUntil(deal?.trainingDate, today);
  const end = daysUntil(trainingEndDate(deal), today);
  const ended = end !== null && end < 0;
  // Direct pay: the client is invoiced before training (Joel, 2026-10-16).
  if (client && !ended && start !== null && start <= 7 && !ins.some(m => m.source === 'client')) {
    flags.push({ level: 'attention', text: 'Client invoice not sent before training' });
  }
  const pending = outs.filter(o => o.status === 'pending').length;
  if (pending) flags.push({ level: 'attention', text: `${pending} payment request${pending === 1 ? '' : 's'} waiting for approval` });
  return flags;
}

// Nothing left to collect or pay on this deal.
export function moneySettled(ins: MoneyIn[], outs: MoneyOut[]): boolean {
  return ins.every(isPaid) && !outs.some(o => o.status === 'pending' || o.status === 'approved');
}
