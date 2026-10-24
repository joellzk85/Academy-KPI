// Paid on behalf of the client (Joel, 2026-10-22: "some payments we pay on the client's behalf, then the client pays
// us back later, e.g. hotel, bus, other; my worry is sometimes we forget to claim back").
// - A cost line on the before-training checklist (money_out) ticked "Pay on behalf of client" (onBehalf: true).
//   It's approved, put on the payment summary and paid like any other cost, but it's the client's money passing
//   through us: never a cost in the training's P&L (lib/money.ts inPL), and the payback is never income.
// - We bill the client on a separate reimbursement invoice (Joel's choice): claim_backs/{id}, one invoice covering
//   one or more of the deal's on-behalf costs, then the client's payment with its receipt (payment_receipts.claimBackId).
// - After training step 5 "Claim back from client" (lib/postTraining.ts): the case closes only once every on-behalf
//   cost is invoiced and paid back. Reminders from the day after the training (behalfFlags).
// Pure logic, no database code.

import { daysUntil, Flag } from './checklist';
import { formatDate, formatRM, todayIso } from './deals';
import { MoneyOut, MoneySettings } from './money';

export const ON_BEHALF_LABEL = 'Pay on behalf of client';

export interface ClaimBack {
  id: string;
  dealId: string;
  moneyOutIds: string[];   // the on-behalf costs this invoice bills the client for
  invoiceNo: string;
  invoiceDate: string;
  amount: number;          // what the client is billed (defaults to the costs' total)
  paidDate?: string;
  paidAmount?: number;
  paidAt?: string;         // when the payment was recorded; it then needs its receipt
  paidById?: string;
  paidByName?: string;
  note?: string;
  createdAt?: number;
  createdById?: string;
  createdByName?: string;
  copyNeeded?: boolean;    // made since 2026-10-24: the invoice's copy must be uploaded before the case closes
}

type ReceiptLike = { claimBackId?: string; kind?: string };

const money = (n: any) => (Number.isFinite(Number(n)) ? Number(n) : 0);
const isDay = (d: any) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** On-behalf costs that still stand (a rejected one is never paid, so nothing to claim back). */
export const behalfOuts = (outs: MoneyOut[]) => outs.filter(o => o.onBehalf && o.status !== 'rejected');
export const claimPaid = (c: ClaimBack) => isDay(c.paidDate);
export const claimReceipts = <T extends ReceiptLike>(c: { id: string }, receipts: T[]) => receipts.filter(r => r.claimBackId === c.id && r.kind !== 'copy');
/** The uploaded copies of the reimbursement invoice itself (2026-10-24). */
export const claimCopies = <T extends ReceiptLike>(c: { id: string }, receipts: T[]) => receipts.filter(r => r.claimBackId === c.id && r.kind === 'copy');
/** Can it go on a reimbursement invoice? Once approved (a pending one may still be rejected). */
export const invoiceable = (o: MoneyOut) => o.status === 'approved' || o.status === 'paid';
/** The reimbursement invoice this cost is on, if any. */
export const claimFor = (o: { id: string }, claims: ClaimBack[]) => claims.find(c => (c.moneyOutIds || []).includes(o.id));

export interface BehalfStatus {
  has: boolean;              // this training has on-behalf costs
  outs: MoneyOut[];
  owed: number;              // total paid or to pay on the client's behalf
  notInvoiced: MoneyOut[];   // not on a reimbursement invoice yet
  claims: ClaimBack[];
  unpaid: ClaimBack[];       // invoiced, not paid back yet
  noReceipt: ClaimBack[];    // paid back, receipt still to upload
  noCopy: ClaimBack[];       // invoice copy still to upload
  outstanding: number;       // still to get back from the client
  done: boolean;             // nothing left to claim back
}

export function behalfStatus(dealId: string, outs: MoneyOut[], claims: ClaimBack[], receipts: ReceiptLike[]): BehalfStatus {
  const mine = behalfOuts(outs.filter(o => o.dealId === dealId));
  const dealClaims = claims.filter(c => c.dealId === dealId);
  const notInvoiced = mine.filter(o => !claimFor(o, dealClaims));
  const unpaid = dealClaims.filter(c => !claimPaid(c));
  const noReceipt = dealClaims.filter(c => claimPaid(c) && !!c.paidAt && !claimReceipts(c, receipts).length);
  const noCopy = dealClaims.filter(c => c.copyNeeded && !claimCopies(c, receipts).length);
  const owed = mine.reduce((t, o) => t + money(o.amount), 0);
  const outstanding = notInvoiced.reduce((t, o) => t + money(o.amount), 0) + unpaid.reduce((t, c) => t + money(c.amount), 0);
  return {
    has: mine.length > 0, outs: mine, owed, notInvoiced, claims: dealClaims, unpaid, noReceipt, noCopy, outstanding,
    done: notInvoiced.length === 0 && unpaid.length === 0 && noReceipt.length === 0 && noCopy.length === 0,
  };
}

/** The next thing to do, in plain words ('' when done). */
export function behalfNext(b: BehalfStatus): string {
  if (b.notInvoiced.length) {
    const waiting = b.notInvoiced.filter(o => !invoiceable(o)).length;
    return waiting === b.notInvoiced.length
      ? `Claim back from client: ${plural(waiting, 'cost')} paid on their behalf still waiting for approval`
      : `Claim back from client: invoice ${formatRM(b.notInvoiced.reduce((t, o) => t + money(o.amount), 0))} paid on their behalf`;
  }
  if (b.noCopy.length) return 'Claim back from client: upload the reimbursement invoice copy';
  if (b.unpaid.length) return `Claim back from client: waiting for ${formatRM(b.unpaid.reduce((t, c) => t + money(c.amount), 0))}`;
  if (b.noReceipt.length) return 'Claim back from client: upload the receipt';
  return '';
}

/** Reminders from the day after the training (daysSince >= 1) until everything is paid back. */
export function behalfFlags(b: BehalfStatus, daysSince: number | null, s: MoneySettings, today = todayIso()): Flag[] {
  if (!b.has || b.done || daysSince === null) return [];
  const flags: Flag[] = [];
  if (b.notInvoiced.length) {
    const total = b.notInvoiced.reduce((t, o) => t + money(o.amount), 0);
    flags.push({ level: daysSince >= s.behalfReminderDays ? 'danger' : 'attention',
      text: `Paid on behalf of client, not claimed back yet: ${b.notInvoiced.map(o => o.description || o.category).join(', ')} (${formatRM(total)}, training ended ${plural(daysSince, 'day')} ago)` });
  }
  b.unpaid.forEach(c => {
    const age = isDay(c.invoiceDate) ? -(daysUntil(c.invoiceDate, today) ?? 0) : 0;
    if (age > s.overdueDays) flags.push({ level: 'danger', text: `Client hasn't paid back ${formatRM(c.amount)} paid on their behalf (${age} days since invoice${c.invoiceNo ? ` ${c.invoiceNo}` : ''})` });
  });
  b.noReceipt.forEach(c => flags.push({ level: 'attention', text: `Paid back ${formatDate(c.paidDate || '')} by the client, receipt not uploaded yet` }));
  b.noCopy.forEach(c => flags.push({ level: 'attention', text: `Reimbursement invoice${c.invoiceNo ? ` ${c.invoiceNo}` : ''}: copy not uploaded yet` }));
  return flags;
}
