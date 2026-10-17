// Company sales target and its period (Joel, 2026-10-17), set by Management in Management → Dashboard.
// Stored in config/sales_target: { total, monthly, start: 'YYYY-MM', end: 'YYYY-MM' } (Management only).
// - The Company ring's outer ring = sales won from the period's start to today vs `total`;
//   the inner ring = this month vs `monthly` (both typed by Management).
// - Each person's outer ring uses the same period: their monthly Closing RM target x the months in it.
// - Not set = the old rule: January to December, company target = the sum of each person's targets.

export interface SalesTarget { total: number; monthly: number; start: string; end: string }

const ym = (v: any) => (typeof v === 'string' && /^\d{4}-\d{2}$/.test(v) ? v : '');

export function readSalesTarget(data: any): SalesTarget | null {
  const total = Number(data?.total), monthly = Number(data?.monthly);
  const start = ym(data?.start), end = ym(data?.end);
  if (!start || !end || end < start || !(total > 0) || !(monthly > 0)) return null;
  return { total, monthly, start, end };
}

export function monthsBetween(start: string, end: string): number {
  const [sy, sm] = start.split('-').map(Number), [ey, em] = end.split('-').map(Number);
  return (ey - sy) * 12 + (em - sm) + 1;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const ymLabel = (v: string) => `${MONTHS[Number(v.slice(5, 7)) - 1]} ${v.slice(0, 4)}`;

function lastDay(v: string): string {
  const [y, m] = v.split('-').map(Number);
  return `${v}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
}

export interface Period {
  start: string;      // YYYY-MM-DD
  end: string;        // YYYY-MM-DD
  upTo: string;       // counted up to: today, or the period's end if it is over
  months: number;
  label: string;      // "Year 2026" or "Jul 2026 – Jun 2027"
  set: boolean;       // Management set a company target
}

export function periodFor(t: SalesTarget | null, today: string): Period {
  if (!t) {
    const y = today.slice(0, 4);
    return { start: `${y}-01-01`, end: `${y}-12-31`, upTo: today, months: 12, label: `Year ${y}`, set: false };
  }
  const start = `${t.start}-01`, end = lastDay(t.end);
  return {
    start, end, upTo: today < end ? today : end, months: monthsBetween(t.start, t.end),
    label: `${ymLabel(t.start)} – ${ymLabel(t.end)}`, set: true,
  };
}
