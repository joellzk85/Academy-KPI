// Management → Payment tracking (Joel, 2026-10-20: the "Sales 2026" sheet, for Management only).
// One line per HRDC claim or client invoice, with its claim ID, grant ID, employer, approved amount,
// amount after HRDC's 4%, after tax, and when it was paid. Two sources, shown together:
// - payment_records/{id}: lines imported from the Blueprint spreadsheet (lib/blueprint.ts) or added here by hand.
//   Management keeps them up to date here (mark paid, fix, add, delete). Rule: Management only.
// - Claims and invoices recorded on deals (money_in), read live: the deal is their one home, so they're
//   changed in the deal's Money section, never here. From now on new trainings come in this way by themselves.
// If a deal's claim has the same claim ID as an imported line, only the deal's line is shown.
// A training's costs (trainer, commission, venue, …) sit on each of its lines, as in the sheet, and are
// counted once per training (group).

import { PaymentLine } from './blueprint';
import { MoneyIn, MoneySettings, isPaid } from './money';
import { dealAskedFor, dealOwnerId } from './deals';
import { ProjectRow } from './projectPL';
import { approvalCodeOf } from './checklist';

export interface TrackLine extends PaymentLine {
  dealId?: string;           // set for lines read from a deal's Money section
  hiddenBy?: string;         // an imported line replaced by a deal's line with the same claim ID
  employerCode?: string;     // deal lines: the client's HRD Corp employer code (2026-10-23)
}

export const isIsoDay = (s: any) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
export const linePaid = (l: TrackLine) => isIsoDay(l.paidDate) || !!(l.paidNote || '').trim();
/** What comes (or came) in for the line: typed paid amount, else after tax, else after HRDC's %, else approved. */
export const lineNet = (l: TrackLine) => l.paidAmount ?? l.afterTax ?? l.afterDeduct ?? l.approved ?? 0;

export function daysBetween(from: string, to: string): number {
  if (!isIsoDay(from) || !isIsoDay(to)) return 0;
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

export function statusText(l: TrackLine, today: string): string {
  if (isIsoDay(l.paidDate)) return 'Paid';
  if (l.paidNote) return l.paidNote;
  const d = daysBetween(l.date, today);
  return d > 0 ? `Waiting ${d} day${d === 1 ? '' : 's'}` : 'Waiting';
}

/** Lines for the claims and invoices recorded on deals. */
export function dealLines(args: {
  deals: any[]; ins: MoneyIn[]; settings: MoneySettings; checklists: Record<string, any>; clients: any[];
  programmeName: (d: any) => string; personName: (id: string) => string; rows: ProjectRow[];
}): TrackLine[] {
  const { deals, ins, settings, checklists, clients } = args;
  const out: TrackLine[] = [];
  deals.forEach(d => {
    const mine = ins.filter(m => m.dealId === d.id);
    if (!mine.length) return;
    const client = clients.find(c => c.id === d.clientId);
    const approval = approvalCodeOf(checklists[d.id]?.tasks);
    const row = args.rows.find(r => r.deal.id === d.id);
    const date = isIsoDay(String(d.trainingDate || '').slice(0, 10)) ? String(d.trainingDate).slice(0, 10) : '';
    mine.forEach(m => {
      const hrdc = m.source === 'hrdc';
      const monthFrom = date || (isIsoDay(m.invoiceDate) ? m.invoiceDate : '');
      out.push({
        id: `deal_${m.id}`, source: 'manual', dealId: d.id,
        month: monthFrom.slice(0, 7), groupNo: `deal#${d.id}`, date, dateText: '',
        programme: dealAskedFor(d, args.programmeName(d)), salesPerson: args.personName(dealOwnerId(d)),
        claimId: (m.invoiceNo || '').trim(), grantId: hrdc ? approval : '',
        client: client?.companyName || d.client || '', employer: (client?.employerName || '').trim(), employerCode: hrdc ? String(client?.employerCode || '').trim() : '', employerAddress: '', venue: '',
        approved: Number(m.amount) || 0,
        afterDeduct: hrdc ? Math.round((Number(m.amount) || 0) * (1 - settings.hrdcDeductionPct / 100) * 100) / 100 : Number(m.amount) || 0,
        afterTax: null,
        paidDate: isPaid(m) ? m.paidDate! : '', paidNote: '', paidAmount: isPaid(m) && Number.isFinite(Number(m.paidAmount)) ? Number(m.paidAmount) : null,
        trainingFee: row ? Math.round(row.income * 100) / 100 : null, trainer: '', trainerCost: null, commission: row ? Math.round(row.commission * 100) / 100 : null, management: null,
        otherFee: null, otherFeeLabel: '', venueCost: null, transport: null, facilitators: null,
        grossProfit: row ? Math.round(row.profit * 100) / 100 : null, margin: row ? Math.round(row.margin * 100) / 100 : null,
        remarks: hrdc ? 'HRDC claim' : 'Client invoice',
      });
    });
  });
  return out;
}

/** Imported lines plus the deals' lines; an imported line with the same claim ID as a deal's line is hidden. */
export function mergeLines(records: TrackLine[], fromDeals: TrackLine[]): TrackLine[] {
  const claimIds = new Map(fromDeals.filter(l => l.claimId).map(l => [l.claimId.toLowerCase(), l.dealId!]));
  return [...records.map(l => ({ ...l, hiddenBy: l.claimId ? claimIds.get(l.claimId.toLowerCase()) : undefined })), ...fromDeals];
}

export interface Totals {
  lines: number; trainings: number; approved: number; afterDeduct: number; received: number;
  waitingLines: number; waiting: number; grossProfit: number; income: number;
}

/** Totals for some lines. Costs and profit are a training's, so each group counts once. */
export function totalsOf(lines: TrackLine[]): Totals {
  const t: Totals = { lines: lines.length, trainings: 0, approved: 0, afterDeduct: 0, received: 0, waitingLines: 0, waiting: 0, grossProfit: 0, income: 0 };
  const groups = new Set<string>();
  lines.forEach(l => {
    t.approved += l.approved || 0;
    t.afterDeduct += l.afterDeduct ?? l.approved ?? 0;
    if (linePaid(l)) t.received += lineNet(l);
    else { t.waitingLines++; t.waiting += lineNet(l); }
    if (!groups.has(l.groupNo)) {
      groups.add(l.groupNo);
      t.grossProfit += l.grossProfit || 0;
      t.income += l.trainingFee || 0;
    }
  });
  t.trainings = groups.size;
  return t;
}

/** Sales amount (approved) and commission per sales person; commission counted once per training. */
export function byPerson(lines: TrackLine[]): { name: string; approved: number; commission: number; lines: number; waiting: number }[] {
  const m = new Map<string, { name: string; approved: number; commission: number; lines: number; waiting: number; groups: Set<string> }>();
  lines.forEach(l => {
    const name = (l.salesPerson || '').trim() || 'No sales person';
    const e = m.get(name.toLowerCase()) || { name, approved: 0, commission: 0, lines: 0, waiting: 0, groups: new Set<string>() };
    e.approved += l.approved || 0;
    e.lines++;
    if (!linePaid(l)) e.waiting += lineNet(l);
    if (!e.groups.has(l.groupNo)) { e.groups.add(l.groupNo); e.commission += l.commission || 0; }
    m.set(name.toLowerCase(), e);
  });
  return [...m.values()].map(({ groups, ...rest }) => rest).sort((a, b) => b.approved - a.approved);
}

/** The cost fields of a training, shared by all its lines. */
export const COST_FIELDS: [keyof PaymentLine, string][] = [
  ['trainingFee', 'Training fee'], ['trainerCost', 'Trainer cost'], ['commission', 'Commission'], ['management', 'Management'],
  ['otherFee', 'Admin / agent fee'], ['venueCost', 'Venue cost'], ['transport', 'Transportation'], ['facilitators', 'Facilitators'],
  ['grossProfit', 'Gross profit'], ['margin', 'Margin (%)'],
];
