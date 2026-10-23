// Payment summary for accounts (Joel, 2026-10-20: "payment summary should appear as a list, option pre-training
// payment tick, post-training payment tick; after tick, summary, send link / PDF").
// Admin work → Money lists the approved, unpaid payment requests; Admin or Management tick some and make a summary:
// one block per vendor (bank details from Vendors) with its lines and subtotal, and a grand total. It goes to
// accounts as a PDF or a link (/pay/<token>, payment_links kind 'batch', serverPaymentLinks.ts), where accounts click
// "Payment made" per vendor. Pure code, shared by the screen, the PDF and the server.

import { MoneyOut, OutTiming, OutStatus, payableFrom } from './money';
import { formatDate, todayIso } from './deals';

/** Why this request can't go on a new summary ('' = it can). One summary per payment, so accounts never pay twice
 *  (2026-10-21): a request already on a summary (summaryToken) or with its own open accounts link stays there until
 *  it's taken off or the link is stopped (the server clears both then). Post-training ones wait for the training.
 *  Accounts must always see where to pay (Joel, 2026-10-23): the vendor's checked bank details, or the payment
 *  details typed on the request. */
export function summaryProblem(o: MoneyOut, deal: any, vendor: Vendor | null | undefined, today = todayIso()): string {
  if (o.status !== 'approved') return o.status === 'paid' ? 'Already paid' : 'Not approved';
  if (o.summaryToken) return 'Already on a summary sent to accounts';
  if (o.accountsLink?.token) return 'Has its own accounts link: stop that link first';
  if (waitsForTraining(o, deal, today)) return `Post-training: payable from ${formatDate(payableFrom(o, deal))}`;
  return payToProblem(o, vendor);
}

/** A post-training payment before the day after the training. */
export const waitsForTraining = (o: MoneyOut, deal: any, today = todayIso()) => { const from = payableFrom(o, deal); return !!from && from > today; };

/** What's missing for accounts to know where to pay ('' = nothing). */
export function payToProblem(o: Pick<MoneyOut, 'paymentDetails'>, vendor: Vendor | null | undefined): string {
  if (vendor && hasBank(vendor)) return bankChecked(vendor) ? '' : "Bank details waiting for a manager's check";
  if ((o.paymentDetails || '').trim()) return '';
  return 'No bank details yet';
}
import { Vendor, bankChecked, hasBank } from './vendors';

export interface SummaryLine {
  id: string;
  forText: string;          // "Client · Programme · 21 Oct 2026" or "Company payment"
  category: string;
  description: string;
  amount: number;
  timing: OutTiming;
  company: boolean;
  status: OutStatus;
  paidDate?: string;
  paidAt?: string;
  paidRef?: string;
  paidByName?: string;
}

export interface SummaryGroup {
  key: string;              // vendor id, or the payee name for requests without a vendor
  payee: string;
  bankName: string;
  accountNo: string;
  accountName: string;
  contact: string;          // the vendor's contact person, phone and email, for accounts' questions (2026-10-23)
  paymentDetails: string;   // typed on a company payment ("Payment details")
  // The vendor's new or changed bank details wait for a manager's check (process audit, 2026-10-22): no bank details
  // are shown and accounts can't mark it paid until then.
  bankUnchecked: boolean;
  lines: SummaryLine[];
  total: number;
}

export interface PaymentSummary { groups: SummaryGroup[]; total: number; count: number }

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Group the requests by who is paid. forTextOf gives each line's "for" text. */
export function buildSummary(outs: MoneyOut[], vendors: Vendor[], forTextOf: (o: MoneyOut) => string): PaymentSummary {
  const map = new Map<string, SummaryGroup>();
  outs.forEach(o => {
    const v = o.vendorId ? vendors.find(x => x.id === o.vendorId) : undefined;
    const key = v ? `v:${v.id}` : `p:${String(o.payee || '').trim().toLowerCase()}`;
    const g = map.get(key) || {
      key, payee: String(o.payee || v?.name || 'Not named').trim(),
      bankName: v && bankChecked(v) ? v.bankName || '' : '', accountNo: v && bankChecked(v) ? v.accountNo || '' : '', accountName: v && bankChecked(v) ? v.accountName || '' : '',
      bankUnchecked: !!v && !bankChecked(v),
      contact: v ? [v.contactName, v.phone, v.email].map(x => (x || '').trim()).filter(Boolean).join(' · ') : '',
      paymentDetails: '', lines: [], total: 0,
    };
    if (o.paymentDetails && !g.paymentDetails) g.paymentDetails = o.paymentDetails;
    g.lines.push({
      id: o.id, forText: forTextOf(o), category: o.category, description: o.description || (o.items || []).map(i => i.description).join(', '),
      amount: Number(o.amount) || 0, timing: o.timing, company: !o.dealId, status: o.status,
      paidDate: o.paidDate, paidAt: o.paidAt, paidRef: o.paidRef, paidByName: o.paidByName,
    });
    g.total = r2(g.total + (Number(o.amount) || 0));
    map.set(key, g);
  });
  const groups = [...map.values()].sort((a, b) => a.payee.localeCompare(b.payee));
  return { groups, total: r2(groups.reduce((t, g) => t + g.total, 0)), count: outs.length };
}

/** "PS-20261021-3F2A": from the date made and the link token (or 'NEW' before a link exists). */
export function summaryRef(createdAt: number | string, token = ''): string {
  const d = new Date(typeof createdAt === 'number' ? createdAt : Date.parse(createdAt) || Date.now());
  const day = new Date(d.getTime() + 8 * 3600_000).toISOString().slice(0, 10).replace(/-/g, '');
  return `PS-${day}-${token ? token.slice(0, 4).toUpperCase() : 'NEW'}`;
}

/** A vendor block is settled when every line in it is paid. */
export const groupPaid = (g: SummaryGroup) => g.lines.every(l => l.status === 'paid');
export const groupPayable = (g: SummaryGroup) => g.lines.filter(l => l.status === 'approved');
