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
//   7. Payments out (2026-10-21): every payment request on the deal (trainer, venue...) approved and paid.
//   8. Claim back from client (2026-10-22), only when something was paid on the client's behalf (hotel, bus...):
//      billed on a reimbursement invoice and paid back with its receipt (lib/onBehalf.ts).
//   Copies (Joel, 2026-10-24): the HRDC claim or invoice we send out has its copy uploaded too (a file or a pasted
//   screenshot, payment_receipts kind 'copy'), required on records made since then (copyNeeded). A copy never counts
//   as the payment receipt.
//   Then the deal is "Case closed": every step done, every invoice and claim received with its receipt, and no
//   payment request (trainer, venue...) still waiting for approval or to be paid.
//
// Payments recorded before this update (no paidAt) don't need a receipt, so older deals can still close.

import { ChecklistTask, Flag, applicableTasks, daysUntil, isOptional } from './checklist';
import { formatDate, formatRM, todayIso, trainingEndDate } from './deals';
import { DEFAULT_MONEY_SETTINGS, InSource, MoneyIn, MoneyOut, MoneySettings, isPaid, openShortfalls, shortfall } from './money';
import { BehalfStatus, ClaimBack, behalfFlags, behalfNext, behalfStatus } from './onBehalf';
import { isHrdc } from './checklist';
import { openTodos } from './trainingChange';
import { pendingDiscount } from './dealOffers';

// HRDC order (Joel, 2026-10-23): on HRDC deals the post-training documents (Training delivered, JD14, verified T3,
// report) come before the HRDC claim, because HRDC needs them for the claim. Direct-pay deals keep the invoice first
// (often issued before the training). Only the order shown changes; any step can still be done at any time.
export const docsFirst = (deal: any) => isHrdc(deal?.fundingType);

// Every loop closed before Case closed (Joel, 2026-10-23): the before-training steps, the to-dos after an approved date
// change, open HRDC queries and a discount waiting for a manager count too, and are listed by name.
export interface OpenLoop { what: string; text: string }

export interface Receipt {
  id: string;
  dealId: string;          // '' for an imported Payment tracking line
  moneyInId: string;       // the invoice or claim it's for ('' for an imported line)
  recordId: string;        // the imported Payment tracking line (payment_records) it's for ('' for a deal's)
  moneyOutId?: string;     // a payment we made (money_out), e.g. a venue booking raised from the checklist (2026-10-20)
  claimBackId?: string;    // the client paying back what we paid on their behalf (claim_backs, 2026-10-22)
  kind?: 'copy' | 'invoice' | 'support'; // the copy of the claim or invoice we sent (2026-10-24); 'invoice' = a vendor's invoice to us
                           // for a cost (2026-10-26); 'support' = a document or screenshot on a company payment request
                           // (2026-10-27), never the receipt; none = the payment receipt
  vendorInvoiceFor?: string; // the cost a vendor invoice is for: its part group, or the cost line's id (lib/money.ts groupKey)
  invoiceNo?: string;
  invoiceAmount?: number;
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
export const receiptsFor = (m: { id: string }, receipts: Receipt[]) => receipts.filter(r => r.moneyInId === m.id && r.kind !== 'copy');
/** The uploaded copies of the claim or invoice itself (2026-10-24). */
export const copiesFor = (m: { id: string }, receipts: Receipt[]) => receipts.filter(r => r.moneyInId === m.id && r.kind === 'copy');

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
  noCopy: MoneyIn[];                // recorded, copy of the claim or invoice still to upload
  outsOpen: MoneyOut[];             // payment requests waiting for approval or to be paid
  shortfallsOpen: MoneyIn[];        // HRDC paid less, no top-up invoice raised and not written off (process audit, 2026-10-22)
  beforeOpen: ChecklistTask[];      // before-training steps still open (the case can't close with them open)
  loopsOpen: OpenLoop[];            // everything else still open that stops "Case closed" (before-training steps included)
  invoiceStep: number;              // where the invoice / HRDC claim step sits: 1, or 2 on HRDC deals (documents first)
  paymentInDone: boolean;           // step 3: every invoice and claim received with its receipt
  outsDone: boolean;                // step 4: no payment request waiting for approval or to be paid
  paymentDone: boolean;             // both
  behalf: BehalfStatus;             // paid on behalf of the client, to claim back (step 5 when there is any)
  steps: number;                    // 4, or 5 with a claim back
  closed: boolean;
  closedOn: string;                 // the latest date in the journey, once closed
  next: string;                     // the next thing to do, in plain words
  step: number;                     // 1 invoice, 2 documents, 3 payment received, 4 payments out, (5 claim back), then closed
}

export function postTraining(deal: any, tasks: ChecklistTask[] | undefined, ins: MoneyIn[], outs: MoneyOut[], receipts: Receipt[],
  claims: ClaimBack[] = [], today = todayIso(), s: MoneySettings = DEFAULT_MONEY_SETTINGS, queries: { dealId?: string; answeredDate?: string; question?: string }[] = []): PostStatus {
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
  const noCopy = ins.filter(m => m.copyNeeded && !copiesFor(m, receipts).length);
  const outsOpen = outs.filter(o => o.status === 'pending' || o.status === 'approved');
  // Process audit (2026-10-22): an HRDC shortfall needs a top-up invoice to the client (or Management writes it off),
  // and the before-training steps must be done too, before the case can close (the same "closed" everywhere).
  const shortfallsOpen = openShortfalls(ins, s);
  const beforeOpen = applicableTasks(tasks, deal?.fundingType).filter(t => !t.after && !t.done && !isOptional(t));
  const paymentInDone = invoiceDone && ins.length > 0 && unpaid.length === 0 && noReceipt.length === 0 && shortfallsOpen.length === 0;
  const outsDone = outsOpen.length === 0;
  const paymentDone = paymentInDone && outsDone;
  const behalf = behalfStatus(deal?.id, outs, claims, receipts);
  const steps = behalf.has ? 5 : 4;
  const loopsOpen: OpenLoop[] = [
    ...beforeOpen.map(t => ({ what: 'Before training', text: t.label })),
    ...openTodos(deal).map(t => ({ what: 'After the date change', text: t.label })),
    ...queries.filter(q => q.dealId === deal?.id && !q.answeredDate).map(q => ({ what: 'HRDC query', text: String(q.question || 'Not answered yet').slice(0, 80) })),
    ...(pendingDiscount(deal) ? [{ what: 'Discount', text: 'Waiting for a manager' }] : []),
  ];
  const closed = ended && paymentDone && behalf.done && docsOpen.length === 0 && noCopy.length === 0 && loopsOpen.length === 0;
  const started = ins.length > 0 || after.some(t => t.done);
  const hrdcOrder = docsFirst(deal);
  const invoiceStep = hrdcOrder ? 2 : 1;
  const docsNext = () => `${docsOpen[0].label}${docsOpen.length > 1 ? ` (then ${docsOpen.slice(1).map(t => t.label).join(', ')})` : ''}`;
  const invoiceNext = () => (missingInvoices.length ? `Record the ${missingInvoices.map(s => INVOICE_WORDS[s]).join(' and the ')}` : 'Record the invoice or HRDC claim');

  let next = '';
  let step = steps + 1;
  if (hrdcOrder && docsOpen.length) {
    step = 1;
    next = docsNext();
  } else if (!invoiceDone) {
    step = invoiceStep;
    next = invoiceNext();
  } else if (noCopy.length) {
    step = invoiceStep;
    next = `Upload the copy of the ${noCopy.map(m => INVOICE_WORDS[m.source]).join(' and the ')}`;
  } else if (docsOpen.length) {
    step = 2;
    next = docsNext();
  } else if (!paymentInDone) {
    step = 3;
    next = unpaid.length ? `Waiting for payment: ${plural(unpaid.length, 'invoice or claim')}`
      : noReceipt.length ? `Upload the receipt for ${plural(noReceipt.length, 'payment')}`
      : shortfallsOpen.length ? `HRDC paid ${formatRM(shortfallsOpen.reduce((t, m) => t + shortfall(m, s), 0))} less: raise a top-up invoice to the client`
      : 'Record the payment received';
  } else if (!outsDone) {
    step = 4;
    next = `Payments out: ${plural(outsOpen.length, 'payment request')} still to approve or pay`;
  } else if (!behalf.done) {
    step = 5;
    next = behalfNext(behalf);
  } else if (ended && loopsOpen.length) {
    step = steps;
    next = `Still open: ${loopsOpen.map(l => `${l.text} (${l.what.toLowerCase()})`).join(', ')}`;
  } else if (!ended) {
    step = 2;
    next = 'Starts after the training';
  } else {
    next = 'Case closed';
  }

  const closedOn = closed
    ? [...ins.map(m => m.paidDate || ''), ...docs.map(t => t.doneAt || ''), ...receipts.filter(r => ins.some(m => m.id === r.moneyInId)).map(r => r.at.slice(0, 10)),
      ...outs.map(o => o.paidDate || ''), ...behalf.claims.map(c => c.paidDate || '')].filter(isDay).map(d => d.slice(0, 10)).sort().pop() || ''
    : '';
  return { ended, daysSince, started, missingInvoices, invoiceDone, docs, docsOpen, unpaid, noReceipt, noCopy, outsOpen, shortfallsOpen, beforeOpen, loopsOpen, invoiceStep, paymentInDone, outsDone, paymentDone, behalf, steps, closed, closedOn, next, step };
}

/** Reminders from the day after the training until the case is closed (the work queue, My home's After training card). */
export function postTrainingFlags(deal: any, tasks: ChecklistTask[] | undefined, ins: MoneyIn[], outs: MoneyOut[], receipts: Receipt[],
  claims: ClaimBack[], s: MoneySettings, today = todayIso(), queries: { dealId?: string; answeredDate?: string; question?: string }[] = []): Flag[] {
  const st = postTraining(deal, tasks, ins, outs, receipts, claims, today, s, queries);
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
  st.shortfallsOpen.forEach(m => flags.push({ level: 'danger', text: `HRDC paid ${formatRM(shortfall(m, s))} less than expected: raise a top-up invoice to the client` }));
  st.noReceipt.forEach(m => flags.push({ level: 'attention', text: `Payment received ${formatDate(m.paidDate || '')}, receipt not uploaded yet` }));
  st.noCopy.forEach(m => flags.push({ level: 'attention', text: `${m.source === 'hrdc' ? 'HRDC claim' : 'Client invoice'}${m.invoiceNo ? ` ${m.invoiceNo}` : ''}: copy not uploaded yet` }));
  flags.push(...behalfFlags(st.behalf, since, s, today));
  if (st.paymentDone && !st.docsOpen.length && st.loopsOpen.length) flags.push({ level: 'attention', text: `Case can't close yet, still open: ${st.loopsOpen.map(l => l.text).join(', ')}` });
  return flags;
}
