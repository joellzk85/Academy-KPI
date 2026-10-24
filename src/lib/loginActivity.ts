// Login history (2026-10-22): how long each team member uses the CRM each day.
// One document per person per day in login_days/<memberId>_<YYYY-MM-DD> (the person's own computer's date):
// minutes = active minutes (CRM open and visible, with a click, typing or scrolling in the last `idleMinutes`),
// logins = times the CRM was opened that day, firstAt / lastAt = first and last activity.
// Since 2026-10-22 (anti "open but idle"): actions = real work saved that day (anything the person saved to the
// database: deals, appointments, follow-ups, quotations, checklist ticks, payments…, counted by
// lib/firestoreTracked.ts; the same record saved again within 5 minutes counts once), and places = active minutes
// per screen (place = the screen of the last minute), so Management sees where the time goes.
// The database rules let each person add only their own minutes, one at a time and at most once a minute,
// and only Management can read them (Team → Login log).
// The green / amber / red rules live in config/login_rules, editable by Management only.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, increment, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { callServer, db, friendlyError } from './firebase';
import { setDeleteListener, setWriteListener } from './firestoreTracked';
import { deviceId } from './linkTracker';
import { deviceOf } from './proposalTracking';
import { DEFAULT_WORK_END, DEFAULT_WORK_START } from './loginSessions';
import type { KpiLight } from './kpi';


export interface LoginDay {
  memberId: string;
  date: string;          // YYYY-MM-DD
  minutes: number;
  logins: number;
  firstAt?: { toMillis(): number } | null;
  lastAt?: { toMillis(): number } | null;
  actions?: number;                      // missing on days recorded before 2026-10-22 (not judged)
  places?: Record<string, number>;       // minutes per screen (PLACE_LABELS)
}

export interface LoginRules {
  workDays: number[];     // 0 = Sunday … 6 = Saturday
  greenDays: number;      // green: at least this many working days in the week…
  greenMinutes: number;   // …with at least this many minutes each
  amberDays: number;      // amber: at least this many working days…
  amberMinutes: number;   // …with at least this many minutes each
  idleMinutes: number;    // the clock stops after this many minutes with no click, typing or scrolling
  noWorkMinutes: number;  // "Online, no work": a day with at least this many minutes…
  noWorkActions: number;  // …and fewer than this many actions; such a day doesn't count towards the light
  workStart: number;      // working hours, minutes after midnight (Malaysia time): a login outside them, or on a day
  workEnd: number;        // that isn't a working day, is flagged "After hours" (2026-10-24, serverActivity.ts)
}

export const DEFAULT_LOGIN_RULES: LoginRules = {
  workDays: [1, 2, 3, 4, 5], greenDays: 5, greenMinutes: 60, amberDays: 3, amberMinutes: 30,
  idleMinutes: 5, noWorkMinutes: 120, noWorkActions: 3, workStart: DEFAULT_WORK_START, workEnd: DEFAULT_WORK_END,
};

export function readLoginRules(d: any): LoginRules {
  const num = (v: any, def: number) => (typeof v === 'number' && v >= 0 ? v : def);
  const days = Array.isArray(d?.workDays) ? d.workDays.filter((n: any) => Number.isInteger(n) && n >= 0 && n <= 6) : null;
  return {
    workDays: days && days.length ? [...new Set<number>(days)].sort() : DEFAULT_LOGIN_RULES.workDays,
    greenDays: num(d?.greenDays, DEFAULT_LOGIN_RULES.greenDays),
    greenMinutes: num(d?.greenMinutes, DEFAULT_LOGIN_RULES.greenMinutes),
    amberDays: num(d?.amberDays, DEFAULT_LOGIN_RULES.amberDays),
    amberMinutes: num(d?.amberMinutes, DEFAULT_LOGIN_RULES.amberMinutes),
    idleMinutes: Math.max(1, num(d?.idleMinutes, DEFAULT_LOGIN_RULES.idleMinutes)),
    noWorkMinutes: num(d?.noWorkMinutes, DEFAULT_LOGIN_RULES.noWorkMinutes),
    noWorkActions: num(d?.noWorkActions, DEFAULT_LOGIN_RULES.noWorkActions),
    workStart: Math.min(1440, num(d?.workStart, DEFAULT_LOGIN_RULES.workStart)),
    workEnd: Math.min(1440, num(d?.workEnd, DEFAULT_LOGIN_RULES.workEnd)),
  };
}

/** "Online, no work": long in the CRM but almost nothing saved. Days from before actions were counted are never flagged. */
export function isNoWorkDay(day: LoginDay | undefined, rules: LoginRules): boolean {
  return !!day && typeof day.actions === 'number' && day.minutes >= rules.noWorkMinutes && day.actions < rules.noWorkActions;
}

// Screens the CRM reports its time on (usePlace). Keys are stored in login_days.places.
export const PLACE_LABELS: Record<string, string> = {
  home: 'My home', workspace: 'Workspace', admin: 'Admin work',
  ws_kpi: 'KPI page', ws_present: 'Present', ws_pipeline: 'Deals', ws_quotation: 'Quotations', ws_course_outline: 'Course outlines',
  ws_teambuilding: 'Teambuilding', ws_client: 'Clients', ws_trainerList: 'Trainers', ws_venue: 'Venues', ws_tasks: 'To-do',
  ws_faci: 'Facilitators',
  admin_queue: 'Admin: work queue', admin_money: 'Admin: money', admin_payments: 'Admin: payment tracking', admin_vendors: 'Admin: vendors',
  admin_programmes: 'Admin: programmes', admin_tasks: 'Admin: checklist tasks', admin_backup: 'Admin: backup',
  mgmt_dashboard: 'Management: dashboard', mgmt_team_followups: 'Management: team follow-ups', mgmt_checks: 'Management: deal checks',
  mgmt_pl: 'Management: project P&L', mgmt_payments: 'Management: payment tracking', mgmt_links: 'Management: client links',
  mgmt_followups: 'Management: follow-up rules', mgmt_lost: 'Management: lost and deleted', mgmt_team: 'Management: team',
  mgmt_data: 'Management: data tools',
};
export const placeLabel = (key: string) => PLACE_LABELS[key] || 'Other';

/** Minutes per screen over some days, biggest first. */
export function placeTotals(days: (LoginDay | undefined)[]): { key: string; label: string; minutes: number }[] {
  const t = new Map<string, number>();
  days.forEach(d => Object.entries(d?.places || {}).forEach(([k, v]) => {
    const label = placeLabel(k);
    t.set(label, (t.get(label) || 0) + (typeof v === 'number' ? v : 0));
  }));
  return [...t.entries()].map(([label, minutes]) => ({ key: label, label, minutes })).filter(x => x.minutes > 0).sort((a, b) => b.minutes - a.minutes);
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
  // For the lights: an "Online, no work" day counts as no time.
  const countedOf = useCallback((memberId: string, day: string) => {
    const d = byKey.get(`${memberId}_${day}`);
    return !d || isNoWorkDay(d, rules) ? 0 : d.minutes || 0;
  }, [byKey, rules]);
  return { rules, days, error, byKey, minutesOf, countedOf };
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
const SAFE_PLACE = /^[A-Za-z0-9_]{1,40}$/;

// Where the person is: the deepest screen that says so wins (App's area = 1, a tab inside it = 2).
const placeByDepth = new Map<number, string>();
function currentPlace(): string {
  const depth = Math.max(0, ...placeByDepth.keys());
  const key = placeByDepth.get(depth) || 'other';
  return SAFE_PLACE.test(key) ? key : 'other';
}

/** Tells the Login log which screen this is while it's on show (`depth` 1 = main area, 2 = a tab inside it). */
export function usePlace(key: string, depth: 1 | 2) {
  useEffect(() => {
    placeByDepth.set(depth, key);
    return () => { if (placeByDepth.get(depth) === key) placeByDepth.delete(depth); };
  }, [key, depth]);
}

// Updates today's record; if it doesn't exist yet, creates it with `created` instead. Returns whether it saved.
async function writeToday(memberId: string, changes: Record<string, any>, created: Record<string, any>): Promise<boolean> {
  const date = dayKey(new Date());
  const ref = doc(db, 'login_days', `${memberId}_${date}`);
  try {
    await updateDoc(ref, changes);
    return true;
  } catch {
    // Today's record may not exist yet: the database answers "permission denied" (not "not found") because its
    // rules check the existing record, so always try to create it. If it already exists (e.g. a second CRM tab
    // already counted this minute) the rules refuse this too, which is fine.
    try {
      await setDoc(ref, { memberId, date, minutes: 0, logins: 0, actions: 0, places: {}, firstAt: serverTimestamp(), lastAt: serverTimestamp(), ...created });
      return true;
    } catch { return false; /* another tab created it first, or too soon after the last one */ }
  }
}

const bumpLogin = (memberId: string) => writeToday(memberId, { logins: increment(1), lastAt: serverTimestamp() }, { logins: 1 });

const bumpMinute = (memberId: string) => {
  const place = currentPlace();
  return writeToday(memberId,
    { minutes: increment(1), [`places.${place}`]: increment(1), place, lastAt: serverTimestamp() },
    { minutes: 1, places: { [place]: 1 }, place });
};

const MAX_ACTIONS_PER_SAVE = 20;   // matches firestore.rules
const bumpActions = (memberId: string, n: number) =>
  writeToday(memberId, { actions: increment(n), lastActionAt: serverTimestamp() }, { actions: n, lastActionAt: serverTimestamp() });

// ---------- Logins and sensitive actions (2026-10-24, serverActivity.ts) ----------
const SESSION_KEY = 'next_login_session';
const newSessionId = () => Array.from(crypto.getRandomValues(new Uint8Array(20))).map(b => (b % 36).toString(36)).join('');

/** What the login screen sends with a password login, so the server records the device and carries the session on. */
export function loginDeviceInfo() {
  const sessionId = newSessionId();
  try { sessionStorage.setItem(SESSION_KEY, sessionId); } catch { /* the CRM opening starts its own record */ }
  return { sessionId, deviceId: deviceId(), device: deviceOf(navigator.userAgent, navigator.maxTouchPoints || 0, window.innerWidth) };
}

function takeSessionId(): string {
  try {
    const id = sessionStorage.getItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    if (id && /^[a-z0-9]{10,40}$/.test(id)) return id;
  } catch { /* new one below */ }
  return newSessionId();
}

/** A download worth knowing about (exports of client or personal data). Never stops the download. */
export function reportDownload(what: string) {
  callServer('/api/activity/action', { items: [{ kind: 'download', what }] }, true).catch(() => {});
}

export function useActivityTracker(memberId: string) {
  const idleMinutes = useRef(DEFAULT_LOGIN_RULES.idleMinutes);
  useEffect(() => onSnapshot(doc(db, 'config', 'login_rules'), d => { idleMinutes.current = readLoginRules(d.data()).idleMinutes; }, () => {}), []);

  useEffect(() => {
    let lastActive = Date.now();   // any click, typing or scrolling (plain mouse movement doesn't count: "mouse jigglers")
    let lastInput = Date.now();    // a click or a key: a save soon after is the person's own work
    const onActivity = () => { lastActive = Date.now(); };
    const onInput = () => { lastActive = lastInput = Date.now(); };
    const activityEvents = ['scroll', 'wheel'];
    const inputEvents = ['mousedown', 'keydown', 'touchstart'];
    activityEvents.forEach(ev => window.addEventListener(ev, onActivity, { passive: true, capture: true }));
    inputEvents.forEach(ev => window.addEventListener(ev, onInput, { passive: true, capture: true }));
    const onVisible = () => { if (document.visibilityState === 'visible') onActivity(); };
    document.addEventListener('visibilitychange', onVisible);

    // Work saved: counted only soon after a click or key (not the CRM's own background saves), and the same
    // record saved again within 5 minutes (e.g. an editor's autosave) counts once.
    const seen = new Map<string, number>();
    let pending = 0;
    setWriteListener(path => {
      const now = Date.now();
      if (now - lastInput > 60_000) return;
      if (now - (seen.get(path) || 0) < 5 * 60_000) return;
      seen.set(path, now);
      pending++;
    });
    let flushing = false;
    const flush = async () => {
      if (!pending || flushing) return;
      flushing = true;
      const n = Math.min(pending, MAX_ACTIONS_PER_SAVE);
      if (await bumpActions(memberId, n)) pending -= n;
      flushing = false;
    };
    const actionTimer = window.setInterval(flush, 15_000);

    // Deletes, sent to the server's Actions log every few seconds.
    let deletes: { kind: string; path: string }[] = [];
    setDeleteListener((path, kind) => { if (deletes.length < 60) deletes.push({ kind, path }); });
    const sendDeletes = () => {
      if (!deletes.length) return;
      const items = deletes.splice(0, 30);
      callServer('/api/activity/action', { items }, true).catch(() => {});
    };
    const deleteTimer = window.setInterval(sendDeletes, 5_000);

    // This session (IP, place, device: the server works them out). Right after a password login it carries on
    // the login's own record.
    const sessionId = takeSessionId();
    callServer('/api/activity/open', { sessionId, deviceId: deviceId(), device: deviceOf(navigator.userAgent, navigator.maxTouchPoints || 0, window.innerWidth) }, true).catch(() => {});

    bumpLogin(memberId);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && Date.now() - lastActive < idleMinutes.current * 60_000) {
        bumpMinute(memberId);
        callServer('/api/activity/beat', { sessionId }, true).catch(() => {});
      }
    }, 60_000);

    return () => {
      window.clearInterval(timer);
      window.clearInterval(actionTimer);
      window.clearInterval(deleteTimer);
      flush();
      sendDeletes();
      setWriteListener(null);
      setDeleteListener(null);
      activityEvents.forEach(ev => window.removeEventListener(ev, onActivity, { capture: true } as any));
      inputEvents.forEach(ev => window.removeEventListener(ev, onInput, { capture: true } as any));
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [memberId]);
}
