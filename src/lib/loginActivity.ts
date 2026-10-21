// Login history (2026-10-22): how long each team member uses the CRM each day.
// One document per person per day in login_days/<memberId>_<YYYY-MM-DD> (the person's own computer's date):
// minutes = active minutes (CRM open and visible, with mouse or keyboard use in the last 10 minutes),
// logins = times the CRM was opened that day, firstAt / lastAt = first and last activity.
// The database rules let each person add only their own minutes, one at a time and at most once a minute,
// and only Management can read them (Team → Login log).
// The green / amber / red rules live in config/login_rules, editable by Management only.
import { useEffect } from 'react';
import { doc, increment, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { KpiLight } from './kpi';

export const IDLE_MINUTES = 10;

export interface LoginDay {
  memberId: string;
  date: string;          // YYYY-MM-DD
  minutes: number;
  logins: number;
  firstAt?: { toMillis(): number } | null;
  lastAt?: { toMillis(): number } | null;
}

export interface LoginRules {
  workDays: number[];     // 0 = Sunday … 6 = Saturday
  greenDays: number;      // green: at least this many working days in the week…
  greenMinutes: number;   // …with at least this many minutes each
  amberDays: number;      // amber: at least this many working days…
  amberMinutes: number;   // …with at least this many minutes each
}

export const DEFAULT_LOGIN_RULES: LoginRules = { workDays: [1, 2, 3, 4, 5], greenDays: 5, greenMinutes: 60, amberDays: 3, amberMinutes: 30 };

export function readLoginRules(d: any): LoginRules {
  const num = (v: any, def: number) => (typeof v === 'number' && v >= 0 ? v : def);
  const days = Array.isArray(d?.workDays) ? d.workDays.filter((n: any) => Number.isInteger(n) && n >= 0 && n <= 6) : null;
  return {
    workDays: days && days.length ? [...new Set<number>(days)].sort() : DEFAULT_LOGIN_RULES.workDays,
    greenDays: num(d?.greenDays, DEFAULT_LOGIN_RULES.greenDays),
    greenMinutes: num(d?.greenMinutes, DEFAULT_LOGIN_RULES.greenMinutes),
    amberDays: num(d?.amberDays, DEFAULT_LOGIN_RULES.amberDays),
    amberMinutes: num(d?.amberMinutes, DEFAULT_LOGIN_RULES.amberMinutes),
  };
}

export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const parseDay = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** Monday of the week the date falls in. */
export const weekStart = (d: Date) => addDays(d, -((d.getDay() + 6) % 7));

/** The last `count` working days before `today` (today itself is still in progress), oldest first. */
export function lastWorkDays(today: Date, rules: LoginRules, count: number): string[] {
  const out: string[] = [];
  let d = addDays(today, -1);
  for (let guard = 0; out.length < count && guard < 60; guard++, d = addDays(d, -1)) {
    if (rules.workDays.includes(d.getDay())) out.unshift(dayKey(d));
  }
  return out;
}

/** Working days of the Monday-to-Sunday week starting at `monday`. */
export const workDaysOfWeek = (monday: Date, rules: LoginRules) =>
  [0, 1, 2, 3, 4, 5, 6].map(i => addDays(monday, i)).filter(d => rules.workDays.includes(d.getDay())).map(dayKey);

/** Green, amber or red for a set of working days, from each day's minutes. */
export function loginLight(days: string[], minutesOn: (day: string) => number, rules: LoginRules): KpiLight {
  const mins = days.map(minutesOn);
  if (mins.filter(m => m >= rules.greenMinutes).length >= rules.greenDays) return 'green';
  if (mins.filter(m => m >= rules.amberMinutes).length >= rules.amberDays) return 'amber';
  return 'red';
}

export function formatMinutes(m: number): string {
  if (!m) return '0m';
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r}m`;
}

// ------------------------------------------------------------
// The tracker: runs while a team member is signed in to the CRM.
// ------------------------------------------------------------
async function bump(memberId: string, field: 'minutes' | 'logins') {
  const date = dayKey(new Date());
  const ref = doc(db, 'login_days', `${memberId}_${date}`);
  try {
    await updateDoc(ref, { [field]: increment(1), lastAt: serverTimestamp() });
  } catch (e: any) {
    if (e?.code !== 'not-found') return;   // e.g. a second CRM tab already counted this minute
    try {
      await setDoc(ref, {
        memberId, date,
        minutes: field === 'minutes' ? 1 : 0,
        logins: field === 'logins' ? 1 : 0,
        firstAt: serverTimestamp(), lastAt: serverTimestamp(),
      });
    } catch { /* another tab created it first */ }
  }
}

export function useActivityTracker(memberId: string) {
  useEffect(() => {
    let lastActive = Date.now();
    const onActivity = () => { lastActive = Date.now(); };
    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'wheel'];
    events.forEach(ev => window.addEventListener(ev, onActivity, { passive: true, capture: true }));
    const onVisible = () => { if (document.visibilityState === 'visible') onActivity(); };
    document.addEventListener('visibilitychange', onVisible);

    bump(memberId, 'logins');
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && Date.now() - lastActive < IDLE_MINUTES * 60_000) bump(memberId, 'minutes');
    }, 60_000);

    return () => {
      window.clearInterval(timer);
      events.forEach(ev => window.removeEventListener(ev, onActivity, { capture: true } as any));
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [memberId]);
}
