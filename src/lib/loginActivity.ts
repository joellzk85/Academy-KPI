// Login history (2026-10-22): how long each team member uses the CRM each day.
// One document per person per day in login_days/<memberId>_<YYYY-MM-DD> (the person's own computer's date):
// minutes = active minutes (CRM open and visible, with mouse or keyboard use in the last 10 minutes),
// logins = times the CRM was opened that day, firstAt / lastAt = first and last activity.
// The database rules let each person add only their own minutes, one at a time and at most once a minute,
// and only Management can read them (Team → Login log).
// The green / amber / red rules live in config/login_rules, editable by Management only.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, doc, increment, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { db, friendlyError } from './firebase';
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

/** A single day's colour: green / amber at the rule's minutes, red for less, null for no time at all. */
export function dayLight(minutes: number, rules: LoginRules): KpiLight | null {
  if (!minutes) return null;
  return minutes >= rules.greenMinutes ? 'green' : minutes >= rules.amberMinutes ? 'amber' : 'red';
}

const dm = (key: string) => parseDay(key).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' });

/** Heatmap columns: each working day for up to 4 weeks, otherwise one column per week (Monday to Sunday). */
export function heatColumns(today: Date, rules: LoginRules, weeks: number) {
  const mondays = Array.from({ length: weeks }, (_, i) => addDays(weekStart(today), -7 * (weeks - 1 - i)));
  if (weeks <= 4) {
    return mondays.flatMap(m => workDaysOfWeek(m, rules)).map(d => ({
      key: d, days: [d], week: false,
      label: `${['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][parseDay(d).getDay()]} ${parseDay(d).getDate()}`,
    }));
  }
  return mondays.map(m => ({ key: dayKey(m), days: workDaysOfWeek(m, rules), week: true, label: dm(dayKey(m)) }));
}

/**
 * Graph bars for one person or the team (average per person): each working day so far, or each week as the
 * average per working day. Today and this week have no colour yet (still in progress).
 */
export function graphSeries(memberIds: string[], minutesOf: (id: string, day: string) => number, rules: LoginRules, today: Date, weeks: number, by: 'day' | 'week') {
  const todayKey = dayKey(today);
  const n = Math.max(1, memberIds.length);
  const avgOn = (day: string) => Math.round(memberIds.reduce((s, id) => s + minutesOf(id, day), 0) / n);
  const mondays = Array.from({ length: weeks }, (_, i) => addDays(weekStart(today), -7 * (weeks - 1 - i)));
  if (by === 'day') {
    return mondays.flatMap(m => workDaysOfWeek(m, rules)).filter(d => d <= todayKey).map(d => {
      const minutes = avgOn(d);
      return { label: dm(d), minutes, light: d === todayKey ? null : dayLight(minutes, rules) || 'red' as KpiLight };
    });
  }
  return mondays.map(m => {
    const days = workDaysOfWeek(m, rules);
    const past = days.filter(d => d <= todayKey);
    const minutes = past.length ? Math.round(past.reduce((s, d) => s + avgOn(d), 0) / past.length) : 0;
    const current = days.some(d => d >= todayKey);
    return { label: dm(dayKey(m)), minutes, light: current ? null : loginLight(days, avgOn, rules) };
  });
}

/** Days and rules for Team → Login log and the Present slide (Management only; `enabled` false loads nothing). */
export function useLoginData(fromKey: string, enabled = true) {
  const [rules, setRules] = useState<LoginRules>(DEFAULT_LOGIN_RULES);
  const [days, setDays] = useState<LoginDay[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!enabled) return;
    return onSnapshot(doc(db, 'config', 'login_rules'), d => setRules(readLoginRules(d.data())), () => setRules(DEFAULT_LOGIN_RULES));
  }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    return onSnapshot(
      query(collection(db, 'login_days'), where('date', '>=', fromKey)),
      snap => { setDays(snap.docs.map(d => d.data() as LoginDay)); setError(''); },
      e => { setError(friendlyError(e)); setDays([]); }
    );
  }, [fromKey, enabled]);
  const byKey = useMemo(() => {
    const m = new Map<string, LoginDay>();
    (days || []).forEach(d => m.set(`${d.memberId}_${d.date}`, d));
    return m;
  }, [days]);
  const minutesOf = useCallback((memberId: string, day: string) => byKey.get(`${memberId}_${day}`)?.minutes || 0, [byKey]);
  return { rules, days, error, byKey, minutesOf };
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
