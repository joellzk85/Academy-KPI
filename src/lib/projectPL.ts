// Project P&L (Management → Project P&L, built 2026-10-17).
// One row per won deal (one training session), calculated live from money_in, money_out
// and config/money_settings by dealPL in lib/money.ts. Nothing is typed here.
// Until a deal has an invoice or HRDC claim, its income is estimated from the deal value
// (and, for HRDC deals, HRDC's % is taken off that estimate), so upcoming trainings
// don't show a false loss.

import { dealStage, dealValue, todayIso } from './deals';
import { MoneyIn, MoneyOut, MoneySettings, dealPL, moneySettled } from './money';

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
  income: number;                // invoiced + claimed (or the estimate)
  hrdcFee: number;               // HRDC's % (plus any extra shortfall HRDC didn't pay)
  costs: number;                 // approved and paid money out
  profit: number;
  margin: number;                // profit as % of income (0 when no income)
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

export function projectRow(deal: any, allIns: MoneyIn[], allOuts: MoneyOut[], s: MoneySettings, today = todayIso()): ProjectRow {
  const ins = allIns.filter(m => m.dealId === deal.id);
  const outs = allOuts.filter(o => o.dealId === deal.id);
  const pl = dealPL(ins, outs, s);
  const trainingDate = isoDate(deal?.trainingDate);
  const training: TrainingStatus = !trainingDate ? 'no_date' : trainingDate < today ? 'done' : trainingDate === today ? 'today' : 'upcoming';

  const estimate = ins.length === 0;
  const income = estimate ? dealValue(deal) : pl.invoiced;
  const hrdcFee = estimate ? (isHrdc(deal) ? income * (s.hrdcDeductionPct / 100) : 0) : pl.hrdcFee + pl.shortfall;
  const profit = income - hrdcFee - pl.costs;

  return {
    deal, trainingDate, training, estimate, income, hrdcFee, costs: pl.costs, profit,
    margin: income > 0 ? (profit / income) * 100 : 0,
    received: pl.received,
    toComeIn: estimate ? income - hrdcFee : pl.toComeIn,
    toPayOut: pl.toPayOut, pendingApproval: pl.pendingApproval,
    money: estimate ? 'not_invoiced' : moneySettled(ins, outs) ? 'settled' : 'waiting',
    ins, outs,
  };
}

// Every won deal, newest training first; deals without a date last.
export function projectRows(deals: any[], ins: MoneyIn[], outs: MoneyOut[], s: MoneySettings, today = todayIso()): ProjectRow[] {
  return deals
    .filter(d => dealStage(d) === 'won')
    .map(d => projectRow(d, ins, outs, s, today))
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
  income: number; estimated: number; hrdcFee: number; costs: number; profit: number; margin: number;
  received: number; toComeIn: number; toPayOut: number; pendingApproval: number;
}

export function projectTotals(rows: ProjectRow[]): ProjectTotals {
  const sum = (f: (r: ProjectRow) => number) => rows.reduce((t, r) => t + f(r), 0);
  const income = sum(r => r.income);
  const profit = sum(r => r.profit);
  return {
    count: rows.length,
    done: rows.filter(r => r.training === 'done').length,
    upcoming: rows.filter(r => r.training === 'upcoming' || r.training === 'today').length,
    income, estimated: sum(r => (r.estimate ? r.income : 0)),
    hrdcFee: sum(r => r.hrdcFee), costs: sum(r => r.costs), profit,
    margin: income > 0 ? (profit / income) * 100 : 0,
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


