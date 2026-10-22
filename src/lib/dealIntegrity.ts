// Deal checks (Joel, 2026-10-22): KPI integrity, phase 1. Pure logic (no database code).
// - Original vs adjusted: what a deal was worth the day it was won (deal.wonOriginal, saved by markDealWon) against
//   what it is worth now (approved value changes, cancelled trainings = 0). Closing RM itself counts the adjusted value.
// - Red flags: patterns Management should look at. Each can be marked "Checked, OK" with a note
//   (deal.integrityChecks.<flag> {at, byId, byName, note}), after which it no longer shows as open.
import { dealOwnerId, dealStage, dealValue, dealWonDate, isDeletedDeal } from './deals';

export type FlagKey = 'early_cancel' | 'many_moves' | 'long_delay' | 'split' | 'rewon';
export interface DealFlag { key: FlagKey; label: string; detail: string }
export interface IntegrityCheck { at: string; byId: string; byName: string; note: string }

export const FLAG_LABELS: Record<FlagKey, string> = {
  early_cancel: 'Cancelled soon after winning',
  many_moves: 'Training date moved many times',
  long_delay: 'Training pushed back 6 months or more',
  split: 'Same client won twice within a week',
  rewon: 'Won again',
};
export const EARLY_CANCEL_DAYS = 30;
export const MANY_MOVES = 3;          // the 4th change and later are flagged
export const LONG_DELAY_DAYS = 183;
export const SPLIT_DAYS = 7;
export const CANCEL_RATE_RED = 0.2;   // red from 20%
export const CHECK_NOTE_MIN = 3;

const ymd = (v: any): string => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '');
// Whole days from a to b (dates as YYYY-MM-DD).
export function daysBetween(a: string, b: string): number {
  const t = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((t(b) - t(a)) / 86400000);
}

export interface ClosingRow {
  deal: any;
  id: string;
  ownerId: string;
  clientId: string;
  wonDate: string;
  original: number;
  adjusted: number;
  cancelled: boolean;
  cancelDate: string;       // cancelled trainings: the day the cancellation was approved
}

const originalOf = (p: any, fallback: number): number => {
  const v = Number(p?.wonOriginal?.value);
  return p?.wonOriginal && Number.isFinite(v) ? v : fallback;
};

// One row per won deal (counted in the month it was won) and per cancelled training (counted in the month it had
// been won, adjusted 0). Deleted deals and everything else: null.
export function closingRow(p: any): ClosingRow | null {
  if (!p || isDeletedDeal(p)) return null;
  const st = dealStage(p);
  const base = { deal: p, id: String(p.id || ''), ownerId: dealOwnerId(p), clientId: String(p.clientId || '') };
  if (st === 'won') {
    const wonDate = dealWonDate(p);
    if (!wonDate) return null;
    const value = dealValue(p);
    return { ...base, wonDate, original: originalOf(p, value), adjusted: value, cancelled: false, cancelDate: '' };
  }
  const c = p.trainingCancelled;
  if (st === 'lost' && c) {
    const wonDate = ymd(c.wonDate);
    if (!wonDate) return null;
    return { ...base, wonDate, original: originalOf(p, Number(c.value) || 0), adjusted: 0, cancelled: true, cancelDate: ymd(c.at) };
  }
  return null;
}

export interface ClosingTotals {
  original: number; adjusted: number; dealsWon: number;
  cancelledCount: number; cancelledRM: number;
  reducedCount: number; reducedRM: number;
  cancelRate: number;       // cancelled ÷ won (0 to 1)
  rows: ClosingRow[];
}

// Totals for one person ('' = everyone), won from fromYM to toYM ('YYYY-MM', both included).
export function closingTotals(deals: any[], ownerId: string, fromYM: string, toYM: string): ClosingTotals {
  const rows = (deals || []).map(closingRow).filter((r): r is ClosingRow => !!r)
    .filter(r => (!ownerId || r.ownerId === ownerId) && r.wonDate.slice(0, 7) >= fromYM && r.wonDate.slice(0, 7) <= toYM);
  const round = (n: number) => Math.round(n * 100) / 100;
  const t: ClosingTotals = { original: 0, adjusted: 0, dealsWon: rows.length, cancelledCount: 0, cancelledRM: 0, reducedCount: 0, reducedRM: 0, cancelRate: 0, rows };
  rows.forEach(r => {
    t.original += r.original;
    t.adjusted += r.adjusted;
    if (r.cancelled) { t.cancelledCount += 1; t.cancelledRM += r.original; }
    else if (r.original - r.adjusted >= 0.01) { t.reducedCount += 1; t.reducedRM += r.original - r.adjusted; }
  });
  t.original = round(t.original); t.adjusted = round(t.adjusted); t.cancelledRM = round(t.cancelledRM); t.reducedRM = round(t.reducedRM);
  t.cancelRate = t.dealsWon ? t.cancelledCount / t.dealsWon : 0;
  return t;
}

export const totalsDiffer = (t: Pick<ClosingTotals, 'original' | 'adjusted'>) => Math.abs(t.original - t.adjusted) >= 0.01;

// Closing rows of a deal list, worked out once per list (the split check looks at every deal).
const rowCache = new WeakMap<any[], ClosingRow[]>();
function rowsOf(all: any[]): ClosingRow[] {
  if (!Array.isArray(all)) return [];
  let rows = rowCache.get(all);
  if (!rows) { rows = all.map(closingRow).filter((r): r is ClosingRow => !!r); rowCache.set(all, rows); }
  return rows;
}

// Every red flag on a deal (checked ones included). `all` = every deal, for "same client won within a week".
export function dealFlags(p: any, all: any[]): DealFlag[] {
  if (!p || isDeletedDeal(p)) return [];
  const out: DealFlag[] = [];
  const st = dealStage(p);
  const c = st === 'lost' ? p.trainingCancelled : null;
  if (c) {
    const won = ymd(c.wonDate), at = ymd(c.at);
    if (won && at) {
      const d = daysBetween(won, at);
      if (d <= EARLY_CANCEL_DAYS) out.push({ key: 'early_cancel', label: FLAG_LABELS.early_cancel, detail: `Training cancelled ${d} day${d === 1 ? '' : 's'} after the deal was won.` });
    }
  }
  if (st === 'won' || c) {
    const n = Number(p.dateChangeCount) || 0;
    if (n > MANY_MOVES) out.push({ key: 'many_moves', label: FLAG_LABELS.many_moves, detail: `The training date was changed ${n} times (each one approved).` });
    const first = ymd(p.firstTrainingDate), now = ymd(p.trainingDate);
    if (first && now) {
      const d = daysBetween(first, now);
      if (d >= LONG_DELAY_DAYS) out.push({ key: 'long_delay', label: FLAG_LABELS.long_delay, detail: `The training is now ${Math.round(d / 30.4)} months after the first date (${d} days).` });
    }
  }
  const row = closingRow(p);
  if (row && row.clientId) {
    const twin = rowsOf(all).find(r => r && r.id !== row.id && r.clientId === row.clientId && Math.abs(daysBetween(r.wonDate, row.wonDate)) <= SPLIT_DAYS);
    if (twin) out.push({ key: 'split', label: FLAG_LABELS.split, detail: `Another deal for this client was won on ${twin.wonDate}. Check it wasn't one sale split in two.` });
  }
  if (st === 'won') {
    const undone = (Array.isArray(p.history) ? p.history : []).some((h: any) => String(h?.action || '').startsWith('Win undone'));
    if ((Number(p.winCount) || 0) > 1 || undone || p.trainingCancelled) {
      out.push({ key: 'rewon', label: FLAG_LABELS.rewon, detail: p.trainingCancelled ? 'This deal was won again after its training was cancelled.' : 'This deal was won, undone and won again.' });
    }
  }
  return out;
}

export const flagChecked = (p: any, key: FlagKey): IntegrityCheck | null => (p?.integrityChecks?.[key]?.at ? p.integrityChecks[key] : null);
export const openFlags = (p: any, all: any[]): DealFlag[] => dealFlags(p, all).filter(f => !flagChecked(p, f.key));

export function checkNoteProblem(note: string): string {
  return String(note || '').trim().length < CHECK_NOTE_MIN ? 'Write a short note on what you checked.' : '';
}

// Every flag across the deals: [{ deal, flag, checked }].
export function allFlags(deals: any[]): { deal: any; flag: DealFlag; checked: IntegrityCheck | null }[] {
  const out: { deal: any; flag: DealFlag; checked: IntegrityCheck | null }[] = [];
  (deals || []).forEach(p => dealFlags(p, deals).forEach(flag => out.push({ deal: p, flag, checked: flagChecked(p, flag.key) })));
  return out;
}
