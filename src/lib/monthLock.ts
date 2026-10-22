// Month lock (Joel, 2026-10-22). A month locks 2 days after it ends: 00:00 Malaysia time on the 3rd of the next
// month (= the 1st of the next month 00:00 UTC + 40 hours; the database rules use the same moment).
// After that only Management adds or changes anything dated in that month: typed weekly KPI numbers and check-ins
// (month_kpis), the meeting date of a logged appointment and new follow-up notes.
// Management reopens a month for everyone from Management → Deal checks → Month lock (config/month_locks
// { open: ['YYYY-MM'], log: [...] }); "Lock again" closes it.
// Pure logic (no database code). App.tsx loads config/month_locks once (useMonthLocks) and sets the open list here.

export interface MonthLockLog { ym: string; action: 'open' | 'lock'; reason: string; at: string; byId: string; byName: string }
export interface MonthLocks { open: string[]; log: MonthLockLog[] }

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const LOCK_AFTER_HOURS = 40;

let openMonths: string[] = [];
export function setActiveMonthLocks(open: string[]) { openMonths = Array.isArray(open) ? open.filter(validYm) : []; }
export const activeOpenMonths = () => openMonths;

export function readMonthLocks(d: any): MonthLocks {
  return {
    open: Array.isArray(d?.open) ? d.open.filter(validYm) : [],
    log: Array.isArray(d?.log) ? d.log : [],
  };
}

export function validYm(ym: any): boolean {
  return typeof ym === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(ym);
}

// 'YYYY-MM' of a date ('' when it isn't one).
export const ymOf = (iso: any): string => (typeof iso === 'string' && /^\d{4}-\d{2}/.test(iso) ? iso.slice(0, 7) : '');

// The KPI month 'OCT-26' → '2026-10'.
export function kpiMonthYm(month: string): string {
  const [m, y] = String(month || '').split('-');
  const i = MONTHS.indexOf(m);
  return i >= 0 && /^\d{2}$/.test(y || '') ? `20${y}-${String(i + 1).padStart(2, '0')}` : '';
}

// The moment a month locks (a Date; December rolls over to January).
export function lockMoment(ym: string): Date {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1) + LOCK_AFTER_HOURS * 3600 * 1000);   // Date.UTC month is 0-based, so m = next month
}

// Locked for everyone except Management (a reopened month is open again).
export function isMonthLocked(ym: string, now: Date = new Date(), open: string[] = openMonths): boolean {
  if (!validYm(ym)) return false;
  return now.getTime() >= lockMoment(ym).getTime() && !open.includes(ym);
}

export function canEditMonth(ym: string, role: string, now: Date = new Date(), open: string[] = openMonths): boolean {
  return role === 'management' || !isMonthLocked(ym, now, open);
}

export function ymLabel(ym: string): string {
  if (!validYm(ym)) return ym;
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

// The earliest date a date box may offer (min=…): the 1st of the earliest month still open. '' for Management.
export function minOpenDate(role: string, now: Date = new Date(), open: string[] = openMonths): string {
  if (role === 'management') return '';
  // Malaysia's month now (UTC+8).
  const my = new Date(now.getTime() + 8 * 3600 * 1000);
  let y = my.getUTCFullYear(), m = my.getUTCMonth() + 1;
  let earliest = `${y}-${String(m).padStart(2, '0')}`;
  // The month before is still open until the 3rd.
  m -= 1; if (m === 0) { m = 12; y -= 1; }
  const prev = `${y}-${String(m).padStart(2, '0')}`;
  if (!isMonthLocked(prev, now, open)) earliest = prev;
  const reopened = open.filter(validYm).sort()[0];
  if (reopened && reopened < earliest) earliest = reopened;
  return `${earliest}-01`;
}

// Why a date can't be used ('' when it can).
export function lockedDateProblem(iso: string, role: string, now: Date = new Date(), open: string[] = openMonths): string {
  const ym = ymOf(iso);
  if (!ym || canEditMonth(ym, role, now, open)) return '';
  return `${ymLabel(ym)} is locked. Only Management can add or change anything dated in it (they can reopen the month).`;
}
