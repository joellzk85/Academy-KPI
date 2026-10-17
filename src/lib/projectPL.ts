// Project P&L (Management → Project P&L, built 2026-10-17).
// One row per won deal (one training session), calculated live from money_in, money_out
// and config/money_settings by dealPL in lib/money.ts. Nothing is typed here.
// Until a deal has an invoice or HRDC claim, its income is estimated from the deal value
// (and, for HRDC deals, HRDC's % is taken off that estimate), so upcoming trainings
// don't show a false loss.
// SST (Joel, 2026-10-17: 8%, amount can be typed): income from invoices is taken to include SST.
// Automatic SST = the SST part of the income when the deal's quotation adds SST (its rate, normally 8%);
// Management can type the amount instead, saved in project_pl/{dealId}.sstAmount. SST comes off profit.

import { dealOwnerId, dealStage, dealValue, todayIso } from './deals';
import { MoneyIn, MoneyOut, MoneySettings, dealPL, moneySettled } from './money';
import { mainQuote } from './checklist';

export type TrainingStatus = 'done' | 'today' | 'upcoming' | 'no_date';
export type MoneyStatus = 'settled' | 'waiting' | 'not_invoiced';

export const TRAINING_STATUS_LABELS: Record<TrainingStatus, string> = {
  done: 'Training done',
  today: 'Training today',
  upcoming: 'Upcoming',
  no_date: 'No training date',
};

export const MONEY_STATUS_LABELS: Record<MoneyStatus, string> = {
  settled: 'Money settled',
  waiting: 'Money still open',
  not_invoiced: 'Not invoiced yet',
};

export interface ProjectRow {
  deal: any;
  trainingDate: string;          // YYYY-MM-DD or ''
  training: TrainingStatus;
  estimate: boolean;             // income is the deal value, not an invoice
  income: number;                // invoiced + claimed (or the estimate), including SST
  sst: number;
  sstTyped: boolean;             // Management typed the SST amount
  sstRate: number;               // the quotation's SST rate, 0 if it adds no SST
  hrdcFee: number;               // HRDC's % (plus any extra shortfall HRDC didn't pay)
  costs: number;                 // approved and paid money out
  profit: number;
  margin: number;                // profit as % of income before SST (0 when no income)
  received: number;
  toComeIn: number;
  toPayOut: number;
  pendingApproval: number;       // requested, not approved, not in costs
  money: MoneyStatus;
  ins: MoneyIn[];
  outs: MoneyOut[];              // every request, any status
}

const isoDate = (d: any) => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : '');
const isHrdc = (d: any) => d?.fundingType === 'hrdc' || d?.fundingType === 'hrdc_topup';

// Extra sources: every quotation (linked to deals by pipelineId) and the typed SST per deal.
export interface PLExtras { quotes: any[]; plDocs: Record<string, { sstAmount?: number | null }> }
const NO_EXTRAS: PLExtras = { quotes: [], plDocs: {} };

export function quoteSstRate(dealQuotes: any[]): number {
  const q = mainQuote(dealQuotes);
  return q?.applySST ? Number(q.sstRate) || 8 : 0;
}

export function projectRow(deal: any, allIns: MoneyIn[], allOuts: MoneyOut[], s: MoneySettings, today = todayIso(), x: PLExtras = NO_EXTRAS): ProjectRow {
  const ins = allIns.filter(m => m.dealId === deal.id);
  const outs = allOuts.filter(o => o.dealId === deal.id);
  const pl = dealPL(ins, outs, s);
  const trainingDate = isoDate(deal?.trainingDate);
  const training: TrainingStatus = !trainingDate ? 'no_date' : trainingDate < today ? 'done' : trainingDate === today ? 'today' : 'upcoming';

  const sstRate = quoteSstRate(x.quotes.filter(q => q.pipelineId === deal.id));
  const typed = x.plDocs[deal.id]?.sstAmount;
  const sstTyped = typeof typed === 'number' && Number.isFinite(typed);
  const estimate = ins.length === 0;
  // The deal value is before SST, so the estimate adds the quotation's SST on top.
  const income = estimate ? dealValue(deal) * (1 + sstRate / 100) : pl.invoiced;
  const sst = sstTyped ? (typed as number) : (income * sstRate) / (100 + sstRate);
  const hrdcFee = estimate ? (isHrdc(deal) ? income * (s.hrdcDeductionPct / 100) : 0) : pl.hrdcFee + pl.shortfall;
  const profit = income - sst - hrdcFee - pl.costs;
  const beforeSst = income - sst;

  return {
    deal, trainingDate, training, estimate, income, sst, sstTyped, sstRate, hrdcFee, costs: pl.costs, profit,
    margin: beforeSst > 0 ? (profit / beforeSst) * 100 : 0,
    received: pl.received,
    toComeIn: estimate ? income - hrdcFee : pl.toComeIn,
    toPayOut: pl.toPayOut, pendingApproval: pl.pendingApproval,
    money: estimate ? 'not_invoiced' : moneySettled(ins, outs) ? 'settled' : 'waiting',
    ins, outs,
  };
}

// Every won deal, newest training first; deals without a date last.
export function projectRows(deals: any[], ins: MoneyIn[], outs: MoneyOut[], s: MoneySettings, today = todayIso(), x: PLExtras = NO_EXTRAS): ProjectRow[] {
  return deals
    .filter(d => dealStage(d) === 'won')
    .map(d => projectRow(d, ins, outs, s, today, x))
    .sort((a, b) => (b.trainingDate || '0').localeCompare(a.trainingDate || '0'));
}

// year = 'YYYY'; from and to = 'MM' (inclusive), e.g. '07' to '09'.
export function inPeriod(r: ProjectRow, year: string, from: string, to: string): boolean {
  if (!r.trainingDate) return false;
  const m = r.trainingDate.slice(5, 7);
  return r.trainingDate.slice(0, 4) === year && m >= from && m <= to;
}

export interface ProjectTotals {
  count: number; done: number; upcoming: number;
  income: number; estimated: number; sst: number; hrdcFee: number; costs: number; profit: number; margin: number;
  received: number; toComeIn: number; toPayOut: number; pendingApproval: number;
}

export function projectTotals(rows: ProjectRow[]): ProjectTotals {
  const sum = (f: (r: ProjectRow) => number) => rows.reduce((t, r) => t + f(r), 0);
  const income = sum(r => r.income);
  const profit = sum(r => r.profit);
  const sst = sum(r => r.sst);
  return {
    count: rows.length,
    done: rows.filter(r => r.training === 'done').length,
    upcoming: rows.filter(r => r.training === 'upcoming' || r.training === 'today').length,
    income, estimated: sum(r => (r.estimate ? r.income : 0)), sst,
    hrdcFee: sum(r => r.hrdcFee), costs: sum(r => r.costs), profit,
    margin: income - sst > 0 ? (profit / (income - sst)) * 100 : 0,
    received: sum(r => r.received), toComeIn: sum(r => r.toComeIn),
    toPayOut: sum(r => r.toPayOut), pendingApproval: sum(r => r.pendingApproval),
  };
}

// Approved and paid costs by category, biggest first.
export function costsByCategory(outs: MoneyOut[]): { category: string; amount: number }[] {
  const m: Record<string, number> = {};
  outs.filter(o => o.status === 'approved' || o.status === 'paid')
    .forEach(o => { m[o.category || 'Other'] = (m[o.category || 'Other'] || 0) + (Number(o.amount) || 0); });
  return Object.entries(m).map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
}

// The "Project P&L" tab in the data backup (serverBackup.ts): one line per won deal, worked out at backup time.
export function projectPLBackupRows(rows: ProjectRow[], clientName: (deal: any) => string, personName: (id: string) => string): (string | number)[][] {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return [
    ['Deal id', 'Training date', 'Client', 'Programme', 'Funding', 'Owner', 'Training', 'Money',
      'Income (RM, incl. SST)', 'Income is an estimate', 'SST (RM)', 'SST typed or automatic', 'HRDC % and shortfall (RM)',
      'Costs, approved and paid (RM)', 'Profit (RM)', 'Margin %', 'Received (RM)', 'Still to come in (RM)', 'Approved, still to pay (RM)', 'Waiting for approval (RM)'],
    ...rows.map(r => [
      r.deal.id, r.trainingDate, clientName(r.deal), r.deal.courseName || '', r.deal.fundingType || '', personName(dealOwnerId(r.deal)),
      TRAINING_STATUS_LABELS[r.training], MONEY_STATUS_LABELS[r.money],
      r2(r.income), r.estimate ? 'Yes' : 'No', r2(r.sst), r.sstTyped ? 'Typed' : r.sstRate ? `Automatic (${r.sstRate}%)` : 'None',
      r2(r.hrdcFee), r2(r.costs), r2(r.profit), Math.round(r.margin), r2(r.received), r2(r.toComeIn), r2(r.toPayOut), r2(r.pendingApproval),
    ]),
  ];
}
