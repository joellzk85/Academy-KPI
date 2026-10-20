// Money per deal (Phase 3).
// - money_in/{id}: an HRDC claim or a client invoice on a deal, and what was actually paid.
// - money_out/{id}: a payment request (trainer, venue, ...) that needs a manager's approval
//   before it can be marked paid. Nobody approves their own request.
// - config/money_settings: HRDC deduction %, days before a payment counts as overdue,
//   and the HRDC claim deadline (blank until Joel confirms HRD Corp's current rule).

import { todayIso, trainingEndDate } from './deals';
import { daysUntil, Flag } from './checklist';

export type InSource = 'hrdc' | 'client';
export type OutStatus = 'pending' | 'approved' | 'rejected' | 'paid';
export type OutTiming = 'before' | 'after';

export const OUT_CATEGORIES = ['Trainer', 'Venue', 'Hotel', 'Bus', 'Materials', 'Facilitator', 'Commission', 'Staff claim', 'Other'];

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
  note?: string;
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
}

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

export interface MoneySettings {
  hrdcDeductionPct: number;            // HRDC keeps this % of each claim
  overdueDays: number;                 // invoice or claim unpaid this long = overdue
  claimDeadlineDays: number | null;    // days after training to submit the HRDC claim (blank = no deadline countdown)
  claimReminderDays: number;           // claim still not submitted this many days after training = red
}

// HRD Corp allows 6 months to claim (Joel, 2026-10-16); he wants a red reminder after 14 days.
export const DEFAULT_MONEY_SETTINGS: MoneySettings = { hrdcDeductionPct: 4, overdueDays: 30, claimDeadlineDays: 180, claimReminderDays: 14 };

export function readMoneySettings(data: any): MoneySettings {
  const num = (v: any, d: number) => (Number.isFinite(Number(v)) && Number(v) >= 0 && v !== '' && v !== null ? Number(v) : d);
  return {
    hrdcDeductionPct: num(data?.hrdcDeductionPct, DEFAULT_MONEY_SETTINGS.hrdcDeductionPct),
    overdueDays: num(data?.overdueDays, DEFAULT_MONEY_SETTINGS.overdueDays),
    // Never saved = the default; saved blank = no deadline countdown.
    claimDeadlineDays: data?.claimDeadlineDays === undefined ? DEFAULT_MONEY_SETTINGS.claimDeadlineDays
      : data.claimDeadlineDays === null || data.claimDeadlineDays === '' ? null : num(data.claimDeadlineDays, 0),
    claimReminderDays: num(data?.claimReminderDays, DEFAULT_MONEY_SETTINGS.claimReminderDays),
  };
}

const money = (n: any) => (Number.isFinite(Number(n)) ? Number(n) : 0);
const isDate = (d: any) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d);

export function isPaid(m: MoneyIn): boolean {
  return isDate(m.paidDate);
}

// What we expect to receive for one invoice or claim (HRDC keeps its %).
export function expectedFor(m: MoneyIn, s: MoneySettings): number {
  const amt = money(m.amount);
  return m.source === 'hrdc' ? amt * (1 - s.hrdcDeductionPct / 100) : amt;
}

// HRDC paid less than expected (beyond rounding).
export function shortfall(m: MoneyIn, s: MoneySettings): number {
  if (m.source !== 'hrdc' || !isPaid(m)) return 0;
  const gap = expectedFor(m, s) - money(m.paidAmount);
  return gap > 1 ? gap : 0;
}

export interface DealPL {
  invoiced: number;        // gross invoiced to the client + claimed from HRDC
  hrdcFee: number;         // HRDC's deduction
  costs: number;           // approved and paid money out
  profit: number;
  received: number;
  toComeIn: number;
  toPayOut: number;        // approved, not yet paid
  pendingApproval: number; // requested, not yet approved (not in costs)
  shortfall: number;
}

export function dealPL(ins: MoneyIn[], outs: MoneyOut[], s: MoneySettings): DealPL {
  const invoiced = ins.reduce((t, m) => t + money(m.amount), 0);
  const hrdcFee = ins.filter(m => m.source === 'hrdc').reduce((t, m) => t + money(m.amount) * (s.hrdcDeductionPct / 100), 0);
  const received = ins.filter(isPaid).reduce((t, m) => t + money(m.paidAmount), 0);
  const toComeIn = ins.filter(m => !isPaid(m)).reduce((t, m) => t + expectedFor(m, s), 0);
  const counted = outs.filter(o => o.status === 'approved' || o.status === 'paid');
  const costs = counted.reduce((t, o) => t + money(o.amount), 0);
  const toPayOut = outs.filter(o => o.status === 'approved').reduce((t, o) => t + money(o.amount), 0);
  const pendingApproval = outs.filter(o => o.status === 'pending').reduce((t, o) => t + money(o.amount), 0);
  const short = ins.reduce((t, m) => t + shortfall(m, s), 0);
  return { invoiced, hrdcFee, costs, profit: invoiced - hrdcFee - short - costs, received, toComeIn, toPayOut, pendingApproval, shortfall: short };
}

// Can this person approve or reject this request? Managers only, never their own.
export function canDecide(o: MoneyOut, viewer: { id: string; role: string }): boolean {
  return o.status === 'pending' && viewer.role === 'management' && o.requestedById !== viewer.id;
}

// Money reminders for the admin work queue.
export function moneyFlags(deal: any, ins: MoneyIn[], outs: MoneyOut[], s: MoneySettings, today = todayIso()): Flag[] {
  const flags: Flag[] = [];
  const hrdc = deal?.fundingType === 'hrdc' || deal?.fundingType === 'hrdc_topup';
  const client = deal?.fundingType === 'direct' || deal?.fundingType === 'hrdc_topup';
  const start = daysUntil(deal?.trainingDate, today);
  const end = daysUntil(trainingEndDate(deal), today);
  // negative = training has passed (after its last day); while a training of several days is on, it counts as today
  const days = start === null ? null : end !== null && end < 0 ? end : Math.max(start, 0);

  if (hrdc && !ins.some(m => m.source === 'hrdc') && days !== null && days < 0) {
    const since = -days;
    const late = since >= s.claimReminderDays;   // red after the reminder period
    if (s.claimDeadlineDays !== null) {
      const left = s.claimDeadlineDays - since;
      flags.push(left < 0
        ? { level: 'danger', text: `HRDC claim deadline passed ${-left} day${left === -1 ? '' : 's'} ago` }
        : { level: late ? 'danger' : 'attention', text: `HRDC claim not submitted, ${since} day${since === 1 ? '' : 's'} since training (deadline in ${left} day${left === 1 ? '' : 's'})` });
    } else {
      flags.push({ level: late ? 'danger' : 'attention', text: `HRDC claim not submitted, ${since} day${since === 1 ? '' : 's'} since training` });
    }
  }
  if (client && !ins.some(m => m.source === 'client') && days !== null) {
    if (days < 0) flags.push({ level: 'danger', text: 'Client invoice not sent, training has passed' });
    else if (days <= 7) flags.push({ level: 'attention', text: 'Client invoice not sent before training' });
  }
  ins.filter(m => !isPaid(m) && isDate(m.invoiceDate)).forEach(m => {
    const age = -(daysUntil(m.invoiceDate, today) ?? 0);
    if (age > s.overdueDays) flags.push({ level: 'danger', text: `${m.source === 'hrdc' ? 'HRDC' : 'Client'} payment overdue (${age} days since ${m.source === 'hrdc' ? 'claim' : 'invoice'})` });
  });
  ins.forEach(m => { const gap = shortfall(m, s); if (gap) flags.push({ level: 'danger', text: `HRDC paid RM ${Math.round(gap).toLocaleString('en-MY')} less than expected` }); });
  const pending = outs.filter(o => o.status === 'pending').length;
  if (pending) flags.push({ level: 'attention', text: `${pending} payment request${pending === 1 ? '' : 's'} waiting for approval` });
  return flags;
}

// Nothing left to collect or pay on this deal.
export function moneySettled(ins: MoneyIn[], outs: MoneyOut[]): boolean {
  return ins.every(isPaid) && !outs.some(o => o.status === 'pending' || o.status === 'approved');
}
