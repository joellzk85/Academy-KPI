// After training, one journey to "Case closed" (Joel, 2026-10-20: "the payment process after training seems
// messy, I see replications"). Pure logic, no database code (the screens and My home share it).
//
// The journey, in Joel's order:
//   0. The day after the training's last day, Admin and Management are told to start post-training.
//   1. Issue invoice: the HRDC claim and/or client invoice is recorded on the deal (money_in). Admin types it in.
//   2. JD14, 3. T3 (HRDC deals), 4. Training report, 5. Output assessment: the deal's after-training checklist
//      steps (deal_checklists). Certificates is an optional extra step.
//   6. Payment received: each invoice or claim is marked received with the client's or HRDC's receipt uploaded
//      (payment_receipts), on the deal or in Payment tracking.
//   Then the deal is "Case closed": every step done, every invoice and claim received with its receipt, and no
//   payment request (trainer, venue...) still waiting for approval or to be paid.
//
// Payments recorded before this update (no paidAt) don't need a receipt, so older deals can still close.

import { ChecklistTask, Flag, applicableTasks, daysUntil, isOptional } from './checklist';
import { formatDate, formatRM, todayIso, trainingEndDate } from './deals';
import { InSource, MoneyIn, MoneyOut, MoneySettings, isPaid, shortfall } from './money';

export interface Receipt {
  id: string;
  dealId: string;          // '' for an imported Payment tracking line
  moneyInId: string;       // the invoice or claim it's for ('' for an imported line)
  recordId: string;        // the imported Payment tracking line (payment_records) it's for ('' for a deal's)
  name: string;
  size: number;
  type: string;
  path: string;            // Firebase Storage: receipts/{id}_{name}
  at: string;
  byId: string;
  byName: string;
}

const isDay = (d: any) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** What has to be invoiced for this deal: the HRDC claim, the client invoice, or both. */
export function invoicesNeeded(fundingType?: string): InSource[] {
  if (fundingType === 'hrdc') return ['hrdc'];
  if (fundingType === 'direct') return ['client'];
  if (fundingType === 'hrdc_topup') return ['hrdc', 'client'];
  return [];
}
export const INVOICE_WORDS: Record<InSource, string> = { hrdc: 'HRDC claim', client: 'client invoice' };

/** A payment recorded since this update needs its receipt. */
export const needsReceipt = (m: MoneyIn) => isPaid(m) && !!m.paidAt;
export const receiptsFor = (m: { id: string }, receipts: Receipt[]) => receipts.filter(r => r.moneyInId === m.id);

/** Days since the training's last day (1 = it ended yesterday), or null while it hasn't ended or has no date. */
export function daysSinceTraining(deal: any, today = todayIso()): number | null {
  const end = daysUntil(trainingEndDate(deal), today);
  return end !== null && end < 0 ? -end : null;
}

export interface PostStatus {
  ended: boolean;
  daysSince: number | null;
  started: boolean;                 // anything after training recorded yet
  missingInvoices: InSource[];      // still to be recorded
  invoiceDone: boolean;
  docs: ChecklistTask[];            // the after-training steps that apply (optional ones last)
  docsOpen: ChecklistTask[];        // needed and not done
  unpaid: MoneyIn[];
  noReceipt: MoneyIn[];             // received, receipt still to upload
  outsOpen: MoneyOut[];             // payment requests waiting for approval or to be paid
  paymentDone: boolean;
  closed: boolean;
  closedOn: string;                 // the latest date in the journey, once closed
  next: string;                     // the next thing to do, in plain words
  step: number;                     // 1 invoice, 2 documents, 3 payment, 4 closed
}

export function postTraining(deal: any, tasks: ChecklistTask[] | undefined, ins: MoneyIn[], outs: MoneyOut[], receipts: Receipt[], today = todayIso()): PostStatus {
  const daysSince = daysSinceTraining(deal, today);
  const ended = daysSince !== null;
  const needed = invoicesNeeded(deal?.fundingType);
  const missingInvoices = needed.filter(src => !ins.some(m => m.source === src));
  // No funding type: any invoice or claim will do.
  const invoiceDone = needed.length ? missingInvoices.length === 0 : ins.length > 0;
  const after = applicableTasks(tasks, deal?.fundingType).filter(t => t.after);
  const docs = [...after.filter(t => !isOptional(t)), ...after.filter(t => isOptional(t))];
  const docsOpen = docs.filter(t => !t.done && !isOptional(t));
  const unpaid = ins.filter(m => !isPaid(m));
  const noReceipt = ins.filter(m => needsReceipt(m) && !receiptsFor(m, receipts).length);
  const outsOpen = outs.filter(o => o.status === 'pending' || o.status === 'approved');
  const paymentDone = invoiceDone && ins.length > 0 && unpaid.length === 0 && noReceipt.length === 0 && outsOpen.length === 0;
  const closed = ended && paymentDone && docsOpen.length === 0;
  const started = ins.length > 0 || after.some(t => t.done);

  let next = '';
  let step = 4;
  if (!invoiceDone) {
    step = 1;
    next = missingInvoices.length ? `Record the ${missingInvoices.map(s => INVOICE_WORDS[s]).join(' and the ')}` : 'Record the invoice or HRDC claim';
  } else if (docsOpen.length) {
    step = 2;
    next = `${docsOpen[0].label}${docsOpen.length > 1 ? ` (then ${docsOpen.slice(1).map(t => t.label).join(', ')})` : ''}`;
  } else if (!paymentDone) {
    step = 3;
    next = unpaid.length ? `Waiting for payment: ${plural(unpaid.length, 'invoice or claim')}`
      : noReceipt.length ? `Upload the receipt for ${plural(noReceipt.length, 'payment')}`
      : outsOpen.length ? `${plural(outsOpen.length, 'payment request')} still to approve or pay`
      : 'Record the payment received';
  } else if (!ended) {
    step = 2;
    next = 'Starts after the training';
  } else {
    next = 'Case closed';
  }

  const closedOn = closed
    ? [...ins.map(m => m.paidDate || ''), ...docs.map(t => t.doneAt || ''), ...receipts.filter(r => ins.some(m => m.id === r.moneyInId)).map(r => r.at.slice(0, 10)),
      ...outs.map(o => o.paidDate || '')].filter(isDay).map(d => d.slice(0, 10)).sort().pop() || ''
    : '';
  return { ended, daysSince, started, missingInvoices, invoiceDone, docs, docsOpen, unpaid, noReceipt, outsOpen, paymentDone, closed, closedOn, next, step };
}

/** Reminders from the day after the training until the case is closed (the work queue, My home's After training card). */
export function postTrainingFlags(deal: any, tasks: ChecklistTask[] | undefined, ins: MoneyIn[], outs: MoneyOut[], receipts: Receipt[],
  s: MoneySettings, today = todayIso()): Flag[] {
  const st = postTraining(deal, tasks, ins, outs, receipts, today);
  if (!st.ended || st.closed) return [];
  const since = st.daysSince!;
  const flags: Flag[] = [];
  const ago = `${plural(since, 'day')} ago`;

  // HRDC claim: amber at first, red after the reminder days, with the deadline countdown.
  const claimMissing = st.missingInvoices.includes('hrdc');
  const claimLate = since >= s.claimReminderDays;
  const deadline = claimMissing && s.claimDeadlineDays !== null ? s.claimDeadlineDays - since : null;

  if (!st.started) {
    const late = claimMissing ? claimLate : since > 7;
    flags.push({ level: late || (deadline !== null && deadline < 0) ? 'danger' : 'attention',
      text: `Training ended ${ago}: start post-training${deadline !== null ? (deadline < 0 ? ` (HRDC claim deadline passed ${plural(-deadline, 'day')} ago)` : ` (HRDC claim deadline in ${plural(deadline, 'day')})`) : ''}` });
    return flags;
  }
  if (claimMissing) {
    flags.push(deadline !== null && deadline < 0
      ? { level: 'danger', text: `HRDC claim deadline passed ${plural(-deadline, 'day')} ago` }
      : { level: claimLate ? 'danger' : 'attention', text: `HRDC claim not submitted, ${plural(since, 'day')} since training${deadline !== null ? ` (deadline in ${plural(deadline, 'day')})` : ''}` });
  }
  if (st.missingInvoices.includes('client')) flags.push({ level: 'danger', text: 'Client invoice not sent, training has passed' });
  if (st.docsOpen.length) flags.push({ level: 'attention', text: `After training: ${st.docsOpen.map(t => t.label).join(', ')} still to do` });
  st.unpaid.filter(m => isDay(m.invoiceDate)).forEach(m => {
    const age = -(daysUntil(m.invoiceDate, today) ?? 0);
    if (age > s.overdueDays) flags.push({ level: 'danger', text: `${m.source === 'hrdc' ? 'HRDC' : 'Client'} payment overdue (${age} days since ${m.source === 'hrdc' ? 'claim' : 'invoice'})` });
  });
  ins.forEach(m => { const gap = shortfall(m, s); if (gap) flags.push({ level: 'danger', text: `HRDC paid ${formatRM(gap)} less than expected` }); });
  st.noReceipt.forEach(m => flags.push({ level: 'attention', text: `Payment received ${formatDate(m.paidDate || '')}, receipt not uploaded yet` }));
  return flags;
}
