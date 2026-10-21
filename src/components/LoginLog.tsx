import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Clock, Loader2, Settings2, X } from 'lucide-react';
import { collection, doc, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import { db, friendlyError } from '../lib/firebase';
import { KPI_LIGHT_BADGE, KPI_LIGHT_BG, KpiLight } from '../lib/kpi';
import {
  DEFAULT_LOGIN_RULES, IDLE_MINUTES, LoginDay, LoginRules, addDays, dayKey, formatMinutes, lastWorkDays,
  loginLight, parseDay, readLoginRules, weekStart, workDaysOfWeek,
} from '../lib/loginActivity';
import { TeamMember, ROLE_LABELS } from '../types';

// Team → Login log (Management only): each person's daily time in the CRM and a green / amber / red light.
const WEEKS_SHOWN = 8;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LIGHT_LABEL: Record<KpiLight, string> = { green: 'Green', amber: 'Amber', red: 'Red' };

const inputClass =
  'w-20 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[15px] text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const secondaryBtn =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-50';
const primaryBtn =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-[15px] font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:cursor-not-allowed disabled:opacity-60';

const shortDate = (key: string) => parseDay(key).toLocaleDateString('en-MY', { weekday: 'short', day: 'numeric', month: 'short' });
const timeOf = (t?: { toMillis(): number } | null) =>
  t ? new Date(t.toMillis()).toLocaleTimeString('en-MY', { hour: 'numeric', minute: '2-digit' }) : '';

function LightBadge({ light }: { light: KpiLight }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-sm font-semibold ${KPI_LIGHT_BADGE[light]}`}>
      <span className={`h-2 w-2 rounded-full ${KPI_LIGHT_BG[light]}`} /> {LIGHT_LABEL[light]}
    </span>
  );
}

export function rulesSummary(r: LoginRules) {
  const days = r.workDays.map(d => DAY_NAMES[d]).join(', ');
  return {
    green: `${r.greenDays} working day${r.greenDays === 1 ? '' : 's'} a week, ${formatMinutes(r.greenMinutes)} or more each day`,
    amber: `${r.amberDays} working day${r.amberDays === 1 ? '' : 's'} a week, ${formatMinutes(r.amberMinutes)} or more each day`,
    red: 'Less than amber',
    days,
  };
}

function RulesDialog({ rules, viewer, onClose }: { rules: LoginRules; viewer: TeamMember; onClose: () => void }) {
  const [r, setR] = useState<LoginRules>(rules);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const setNum = (key: keyof LoginRules) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setR(prev => ({ ...prev, [key]: Math.max(0, Math.round(Number(e.target.value) || 0)) }));
  const toggleDay = (d: number) =>
    setR(prev => ({ ...prev, workDays: prev.workDays.includes(d) ? prev.workDays.filter(x => x !== d) : [...prev.workDays, d].sort() }));

  const save = async () => {
    const n = r.workDays.length;
    if (!n) return setError('Tick at least one working day.');
    if (r.greenDays < 1 || r.greenDays > n || r.amberDays < 1 || r.amberDays > n) return setError(`Days must be between 1 and ${n} (the number of working days).`);
    if (r.amberDays > r.greenDays || r.amberMinutes > r.greenMinutes) return setError('Amber should ask for less than green.');
    setBusy(true);
    try {
      await setDoc(doc(db, 'config', 'login_rules'), { ...r, updatedAt: Date.now(), updatedById: viewer.id, updatedByName: viewer.name });
      onClose();
    } catch (e) {
      setError(friendlyError(e));
      setBusy(false);
    }
  };

  const row = (label: string, tone: KpiLight, daysKey: 'greenDays' | 'amberDays', minKey: 'greenMinutes' | 'amberMinutes') => (
    <div className="rounded-lg border border-line p-3.5">
      <LightBadge light={tone} />
      <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[15px] text-ink">
        At least
        <input type="number" min={1} value={r[daysKey]} onChange={setNum(daysKey)} className={inputClass} aria-label={`${label} days`} />
        working days a week, each with at least
        <input type="number" min={0} value={r[minKey]} onChange={setNum(minKey)} className={inputClass} aria-label={`${label} minutes`} />
        minutes
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <h3 className="text-lg font-bold text-ink">Login log rules</h3>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-ink-soft hover:bg-surface hover:text-ink" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="text-sm font-semibold text-ink">Working days</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {[1, 2, 3, 4, 5, 6, 0].map(d => (
            <button
              key={d}
              type="button"
              onClick={() => toggleDay(d)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${r.workDays.includes(d) ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-white text-ink-soft'}`}
            >
              {DAY_NAMES[d]}
            </button>
          ))}
        </div>
        <div className="mt-4 space-y-3">
          {row('Green', 'green', 'greenDays', 'greenMinutes')}
          {row('Amber', 'amber', 'amberDays', 'amberMinutes')}
          <div className="rounded-lg border border-line p-3.5">
            <LightBadge light="red" />
            <p className="mt-2 text-[15px] text-ink-soft">Anyone below amber.</p>
          </div>
        </div>
        <p className="mt-3 text-sm text-ink-soft">
          Time counts only while the CRM is open on screen and being used. After {IDLE_MINUTES} minutes with no mouse or keyboard use, the clock stops.
        </p>
        {error && <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</p>}
        <div className="mt-5 flex justify-between gap-2">
          <button type="button" className={secondaryBtn} onClick={() => setR(DEFAULT_LOGIN_RULES)}>Reset to default</button>
          <div className="flex gap-2">
            <button type="button" className={secondaryBtn} onClick={onClose}>Cancel</button>
            <button type="button" className={primaryBtn} disabled={busy} onClick={save}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save rules
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginLog({ currentMember, members }: { currentMember: TeamMember; members: TeamMember[] }) {
  const [rules, setRules] = useState<LoginRules>(DEFAULT_LOGIN_RULES);
  const [days, setDays] = useState<LoginDay[] | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const today = useMemo(() => new Date(), []);
  const todayKey = dayKey(today);
  const fromKey = dayKey(addDays(weekStart(today), -7 * (WEEKS_SHOWN - 1)));

  useEffect(() => onSnapshot(doc(db, 'config', 'login_rules'), d => setRules(readLoginRules(d.data())), () => setRules(DEFAULT_LOGIN_RULES)), []);
  useEffect(
    () =>
      onSnapshot(
        query(collection(db, 'login_days'), where('date', '>=', fromKey)),
        snap => setDays(snap.docs.map(d => d.data() as LoginDay)),
        e => { setError(friendlyError(e)); setDays([]); }
      ),
    [fromKey]
  );

  const byKey = useMemo(() => {
    const m = new Map<string, LoginDay>();
    (days || []).forEach(d => m.set(`${d.memberId}_${d.date}`, d));
    return m;
  }, [days]);
  const minutesOf = (memberId: string) => (day: string) => byKey.get(`${memberId}_${day}`)?.minutes || 0;

  const recentDays = lastWorkDays(today, rules, rules.workDays.length);
  const weeks = Array.from({ length: WEEKS_SHOWN }, (_, i) => addDays(weekStart(today), -7 * i));
  const summary = rulesSummary(rules);

  const lastSeen = (memberId: string) => {
    let best = 0;
    (days || []).forEach(d => { if (d.memberId === memberId && d.lastAt) best = Math.max(best, d.lastAt.toMillis()); });
    return best;
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-3.5">
        <div>
          <h3 className="flex items-center gap-2 font-bold"><Clock className="h-4 w-4 text-accent" /> Login log</h3>
          <p className="mt-1 text-sm text-ink-soft">
            Time each person spent in the CRM on the last {recentDays.length} working days (today not counted yet).
          </p>
        </div>
        <button type="button" className={secondaryBtn} onClick={() => setEditing(true)}>
          <Settings2 className="h-4 w-4" /> Rules
        </button>
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-1.5 border-b border-line bg-surface px-5 py-2.5 text-sm text-ink-soft">
        <span className="flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${KPI_LIGHT_BG.green}`} /> {summary.green}</span>
        <span className="flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${KPI_LIGHT_BG.amber}`} /> {summary.amber}</span>
        <span className="flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${KPI_LIGHT_BG.red}`} /> {summary.red}</span>
        <span>Working days: {summary.days}</span>
      </div>

      {error && <p role="alert" className="m-5 rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</p>}
      {days === null ? (
        <p className="flex items-center gap-2 px-5 py-4 text-sm text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-[15px]">
            <thead>
              <tr className="border-b border-line text-left text-sm text-ink-soft">
                <th className="px-5 py-2.5 font-semibold">Person</th>
                <th className="px-3 py-2.5 font-semibold">Light</th>
                {recentDays.map(d => <th key={d} className="px-2 py-2.5 text-center font-semibold">{shortDate(d)}</th>)}
                <th className="px-3 py-2.5 text-center font-semibold">Today</th>
                <th className="px-5 py-2.5 font-semibold">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {members.map(m => {
                const mins = minutesOf(m.id);
                const light = loginLight(recentDays, mins, rules);
                const seen = lastSeen(m.id);
                const isOpen = open === m.id;
                return (
                  <React.Fragment key={m.id}>
                    <tr className="cursor-pointer border-b border-line hover:bg-surface" onClick={() => setOpen(isOpen ? null : m.id)}>
                      <td className="px-5 py-3">
                        <span className="flex items-center gap-1.5 font-semibold">
                          {isOpen ? <ChevronDown className="h-4 w-4 text-ink-soft" /> : <ChevronRight className="h-4 w-4 text-ink-soft" />}
                          {m.name}
                        </span>
                        <span className="ml-5.5 text-sm text-ink-soft">{ROLE_LABELS[m.role]}</span>
                      </td>
                      <td className="px-3 py-3"><LightBadge light={light} /></td>
                      {recentDays.map(d => {
                        const v = mins(d);
                        const tone = v >= rules.greenMinutes ? 'text-[#15803D]' : v >= rules.amberMinutes ? 'text-attention' : v ? 'text-danger' : 'text-ink-soft/50';
                        return <td key={d} className={`px-2 py-3 text-center font-semibold ${tone}`}>{v ? formatMinutes(v) : '–'}</td>;
                      })}
                      <td className="px-3 py-3 text-center text-ink">{mins(todayKey) ? formatMinutes(mins(todayKey)) : '–'}</td>
                      <td className="px-5 py-3 text-sm text-ink-soft">
                        {seen ? new Date(seen).toLocaleString('en-MY', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'Not in the last 8 weeks'}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-line bg-surface/60">
                        <td colSpan={recentDays.length + 4} className="px-5 py-4">
                          <PersonHistory memberId={m.id} weeks={weeks} rules={rules} byKey={byKey} todayKey={todayKey} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editing && <RulesDialog rules={rules} viewer={currentMember} onClose={() => setEditing(false)} />}
    </section>
  );
}

function PersonHistory({ memberId, weeks, rules, byKey, todayKey }: {
  memberId: string; weeks: Date[]; rules: LoginRules; byKey: Map<string, LoginDay>; todayKey: string;
}) {
  const mins = (day: string) => byKey.get(`${memberId}_${day}`)?.minutes || 0;
  return (
    <div className="space-y-2">
      {weeks.map((monday, i) => {
        const workDays = workDaysOfWeek(monday, rules);
        const allDays = [0, 1, 2, 3, 4, 5, 6].map(n => dayKey(addDays(monday, n)));
        const current = i === 0;
        const total = allDays.reduce((s, d) => s + mins(d), 0);
        return (
          <div key={dayKey(monday)} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-line bg-white px-4 py-2.5">
            <span className="w-32 text-sm font-semibold text-ink">{current ? 'This week' : `Week of ${parseDay(dayKey(monday)).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })}`}</span>
            <span className="w-24">{current ? <span className="text-sm text-ink-soft">In progress</span> : <LightBadge light={loginLight(workDays, mins, rules)} />}</span>
            <span className="flex flex-wrap gap-1.5">
              {allDays.filter(d => d <= todayKey).map(d => {
                const day = byKey.get(`${memberId}_${d}`);
                const work = workDays.includes(d);
                if (!work && !day) return null;
                return (
                  <span
                    key={d}
                    title={day ? `${shortDate(d)}: first ${timeOf(day.firstAt)}, last ${timeOf(day.lastAt)}, opened ${day.logins} time${day.logins === 1 ? '' : 's'}` : shortDate(d)}
                    className="rounded-md bg-surface px-2 py-1 text-sm text-ink"
                  >
                    <span className="text-ink-soft">{DAY_NAMES[parseDay(d).getDay()]}</span> {day?.minutes ? formatMinutes(day.minutes) : '–'}
                  </span>
                );
              })}
            </span>
            <span className="ml-auto text-sm text-ink-soft">Total {formatMinutes(total)}</span>
          </div>
        );
      })}
      <p className="text-sm text-ink-soft">Point at a day to see the first and last time used and how many times the CRM was opened.</p>
    </div>
  );
}
