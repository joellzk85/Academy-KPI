// Deal potential and sales projection (Joel, 2026-10-21).
// Every open deal can be rated Hot, Warm or Cold (`potential`) with the month the owner expects the client to sign
// (`expectedMonth`, YYYY-MM). The projection looks 1 to 6 months ahead: per month, sales already won (counted in the
// month won, as KPIs) plus each open deal expected that month, counted at its potential's chance (config/forecast_settings,
// Management only; default Hot 75%, Warm 50%, Cold 20%). Open deals with no expected month fall back to their training
// date's month; a month already gone rolls into this month (shown as overdue). Unrated deals are listed but not counted.

import { dealOwnerId, dealStage, dealValue, dealWonDate, OPEN_STAGES } from './deals';

export type Potential = 'hot' | 'warm' | 'cold';
export const POTENTIALS: Potential[] = ['hot', 'warm', 'cold'];
export const POTENTIAL_LABELS: Record<Potential, string> = { hot: 'Hot', warm: 'Warm', cold: 'Cold' };
export const POTENTIAL_HINTS: Record<Potential, string> = {
  hot: 'Very likely to sign',
  warm: 'Interested, not decided',
  cold: 'Unlikely or early days',
};
export const POTENTIAL_TONE: Record<Potential, string> = {
  hot: 'bg-[#FDECEC] text-[#B42318] border-[#F5C2C0]',
  warm: 'bg-[#FEF3E2] text-[#B45309] border-[#F8D9A8]',
  cold: 'bg-[#E8F1FB] text-[#1D5FA8] border-[#BFD6F1]',
};
export const POTENTIAL_DOT: Record<Potential, string> = { hot: 'bg-[#DC2626]', warm: 'bg-[#F59E0B]', cold: 'bg-[#3B82F6]' };

export function potentialOf(p: any): Potential | '' {
  return POTENTIALS.includes(p?.potential) ? p.potential : '';
}

export interface ForecastSettings { hot: number; warm: number; cold: number }
export const DEFAULT_FORECAST: ForecastSettings = { hot: 75, warm: 50, cold: 20 };
export function readForecastSettings(data: any): ForecastSettings {
  const pick = (k: Potential) => {
    const n = Number(data?.[k]);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : DEFAULT_FORECAST[k];
  };
  return { hot: pick('hot'), warm: pick('warm'), cold: pick('cold') };
}

const ym = (v: any): string => (typeof v === 'string' && /^\d{4}-\d{2}/.test(v) ? v.slice(0, 7) : '');
export function addMonths(month: string, n: number): string {
  const d = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const forecastMonthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

// The month this open deal is expected to close: the owner's pick, else the training date's month.
export function expectedMonthOf(p: any): string {
  return ym(p?.expectedMonth) || ym(p?.trainingDate);
}

export interface ForecastDeal { deal: any; potential: Potential | ''; value: number; weighted: number; month: string; overdue: boolean }
export interface ForecastMonth {
  month: string;
  won: number;              // already won in this month
  weighted: number;         // open deals x their chance
  pipeline: number;         // open deals at full value (best case)
  projected: number;        // won + weighted
  deals: ForecastDeal[];
}
export interface Forecast {
  months: ForecastMonth[];
  unrated: ForecastDeal[];  // open deals in the window with no potential (not counted)
  noMonth: any[];           // open deals with no expected month or training date
  totals: { won: number; weighted: number; pipeline: number; projected: number };
}

export const FORECAST_SPANS = [1, 2, 3, 4, 5, 6];

// deals: already filtered (linkedOnly / withoutDeleted). ownerIds: whose deals; empty = everyone.
export function buildForecast(deals: any[], opts: { today: string; months: number; settings: ForecastSettings; ownerIds?: string[] }): Forecast {
  const span = Math.max(1, Math.min(6, Math.round(opts.months)));
  const first = opts.today.slice(0, 7);
  const window = Array.from({ length: span }, (_, i) => addMonths(first, i));
  const last = window[window.length - 1];
  const mine = opts.ownerIds?.length ? deals.filter(p => opts.ownerIds!.includes(dealOwnerId(p))) : deals;
  const months: ForecastMonth[] = window.map(month => ({ month, won: 0, weighted: 0, pipeline: 0, projected: 0, deals: [] }));
  const at = (m: string) => months.find(x => x.month === m);
  const unrated: ForecastDeal[] = [];
  const noMonth: any[] = [];

  mine.forEach(p => {
    const st = dealStage(p);
    if (st === 'won') {
      const row = at(ym(dealWonDate(p)));
      if (row) row.won += dealValue(p);
      return;
    }
    if (!OPEN_STAGES.includes(st)) return;
    const raw = expectedMonthOf(p);
    if (!raw) { noMonth.push(p); return; }
    const overdue = raw < first;
    const month = overdue ? first : raw;
    if (month > last) return;
    const potential = potentialOf(p);
    const value = dealValue(p);
    const weighted = potential ? value * opts.settings[potential] / 100 : 0;
    const item: ForecastDeal = { deal: p, potential, value, weighted, month, overdue };
    if (!potential) { unrated.push(item); return; }
    const row = at(month)!;
    row.weighted += weighted;
    row.pipeline += value;
    row.deals.push(item);
  });
  months.forEach(m => {
    m.projected = m.won + m.weighted;
    m.deals.sort((a, b) => b.weighted - a.weighted);
  });
  const sum = (k: 'won' | 'weighted' | 'pipeline' | 'projected') => months.reduce((t, m) => t + m[k], 0);
  return { months, unrated, noMonth, totals: { won: sum('won'), weighted: sum('weighted'), pipeline: sum('pipeline'), projected: sum('projected') } };
}
