import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, query, setDoc } from 'firebase/firestore';
import {
  AlertTriangle, ArrowDown, ArrowUp, Briefcase, CalendarDays, ChevronLeft, ChevronRight, ClipboardCheck, Eye, EyeOff, LayoutGrid, Loader2, ShieldCheck, Users,
} from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import { CalendarEvent, Representative } from '../types';
import {
  OPEN_STAGES, STAGE_LABELS, DealStage, journeyStage, dealOwnerId, dealStage, dealValue, dealWonDate, formatDate, formatRM, todayIso,
} from '../lib/deals';
import { metricsFor, countAuto } from '../lib/kpi';
import { checklistFlags, daysUntil, progress, Flag } from '../lib/checklist';
import { HrdcQuery, isQueryOpen, isQueryOverdue, programmeStatus } from '../lib/programmes';
import { MoneyIn, MoneyOut, canDecide, dealPL, isPaid, moneyFlags } from '../lib/money';
import { useChecklistSettings } from './DealChecklist';
import { useMoneySettings } from './Money';
import { MODE_LABELS, apptLateDays, apptOf, apptOverdue, apptTime } from '../lib/appointments';

type Role = 'rep' | 'admin' | 'management';
type Viewer = { id: string; name: string; role: Role };

// ---------- Card library ----------
// Each person picks their own cards (saved in user_prefs/{their id}). Roles limit what can be picked.
type CardId =
  | 'follow_ups' | 'my_kpi' | 'my_won' | 'next14' | 'new_won' | 'due_now' | 'money_jobs'
  | 'approvals' | 'money_position' | 'pipeline' | 'programmes_waiting' | 'notices' | 'team_appointments';

const CARDS: { id: CardId; title: string; roles: Role[] }[] = [
  { id: 'follow_ups', title: 'My follow-ups', roles: ['rep', 'admin', 'management'] },
  { id: 'my_kpi', title: 'My KPI this month', roles: ['rep', 'admin'] },
  { id: 'my_won', title: 'My won deals', roles: ['rep', 'admin'] },
  { id: 'next14', title: 'Trainings in the next 14 days', roles: ['rep', 'admin', 'management'] },
  { id: 'new_won', title: 'New won deals', roles: ['admin', 'management'] },
  { id: 'due_now', title: 'Due now', roles: ['admin', 'management'] },
  { id: 'money_jobs', title: 'Money jobs', roles: ['admin', 'management'] },
  { id: 'approvals', title: 'Waiting for my approval', roles: ['management'] },
  { id: 'money_position', title: 'Money position', roles: ['management'] },
  { id: 'pipeline', title: 'Pipeline and stuck deals', roles: ['management'] },
  { id: 'team_appointments', title: 'Team appointments this week', roles: ['admin', 'management'] },
  { id: 'programmes_waiting', title: 'Programmes waiting on HRDC', roles: ['admin', 'management'] },
  { id: 'notices', title: 'Notices', roles: ['rep', 'admin', 'management'] },
];

// Notices are off by default (Joel removed the newsfeed); anyone can switch the card back on.
const DEFAULT_CARDS: Record<Role, CardId[]> = {
  rep: ['follow_ups', 'my_kpi', 'next14', 'my_won'],
  admin: ['new_won', 'due_now', 'money_jobs', 'next14'],
  management: ['approvals', 'money_position', 'pipeline', 'team_appointments', 'next14'],
};

const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';
const iconBtn = 'rounded-md p-1.5 text-ink-soft hover:bg-surface hover:text-ink disabled:opacity-30';

export interface MyHomeNav {
  openWorkspace: (repId: string, subTab?: string) => void;
  openAdminWork: (view?: 'queue' | 'money' | 'programmes' | 'tasks') => void;
  openManagement: () => void;
}

export default function MyHome({ viewer, people, representatives, deals, events, calendar, notices, nav }: {
  viewer: Viewer;
  people: { id: string; name: string; role: Role; active: boolean }[];   // the Team list
  representatives: Representative[];   // people with a workspace (reps and admins), with KPI settings
  deals: any[];
  events: CalendarEvent[];
  calendar: React.ReactNode;   // the full calendar (adding events, Google sync)
  notices: React.ReactNode;
  nav: MyHomeNav;
}) {
  const staff = viewer.role !== 'rep';
  const today = todayIso();
  const checklistSettings = useChecklistSettings();
  const moneySettings = useMoneySettings();
  const [checklists, setChecklists] = useState<Record<string, any>>({});
  const [queries, setQueries] = useState<HrdcQuery[]>([]);
  const [moneyIn, setMoneyIn] = useState<MoneyIn[]>([]);
  const [moneyOut, setMoneyOut] = useState<MoneyOut[]>([]);
  const [programmes, setProgrammes] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [savedCards, setSavedCards] = useState<CardId[] | null>(null);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [customising, setCustomising] = useState(false);
  const [prefsError, setPrefsError] = useState('');
  const [teammate, setTeammate] = useState('');

  useEffect(() => {
    const subs = [
      onSnapshot(query(collection(db, 'deal_checklists')), s => setChecklists(Object.fromEntries(s.docs.map(d => [d.id, d.data()])))),
      onSnapshot(query(collection(db, 'hrdc_queries')), s => setQueries(s.docs.map(d => ({ ...(d.data() as HrdcQuery), id: d.id })))),
      onSnapshot(query(collection(db, 'money_in')), s => setMoneyIn(s.docs.map(d => ({ ...(d.data() as MoneyIn), id: d.id })))),
      onSnapshot(query(collection(db, 'clients')), s => setClients(s.docs.map(d => ({ ...d.data(), id: d.id })))),
      onSnapshot(doc(db, 'user_prefs', viewer.id), s => { const c = s.data()?.homeCards; setSavedCards(Array.isArray(c) ? c : null); setPrefsLoaded(true); }, () => setPrefsLoaded(true)),
    ];
    // Payouts and programme admin are for Admin and Management only.
    if (staff) {
      subs.push(onSnapshot(query(collection(db, 'money_out')), s => setMoneyOut(s.docs.map(d => ({ ...(d.data() as MoneyOut), id: d.id })))));
      subs.push(onSnapshot(query(collection(db, 'programmes')), s => setProgrammes(s.docs.map(d => ({ ...d.data(), id: d.id })))));
    }
    return () => subs.forEach(u => u());
  }, [viewer.id, staff]);

  const allowed = CARDS.filter(c => c.roles.includes(viewer.role));
  const cards: CardId[] = (savedCards || DEFAULT_CARDS[viewer.role]).filter(id => allowed.some(c => c.id === id));

  const saveCards = async (next: CardId[]) => {
    setSavedCards(next);
    setPrefsError('');
    try {
      await setDoc(doc(db, 'user_prefs', viewer.id), { homeCards: next, updatedAt: Date.now() }, { merge: true });
    } catch (err) {
      setPrefsError(friendlyError(err));
    }
  };

  const nameOf = (id: string) => people.find(p => p.id === id)?.name || 'Former team member';
  const clientName = (p: any) => clients.find(c => c.id === p.clientId)?.companyName || p.client || 'No client';
  const hasWorkspace = (id: string) => representatives.some(r => r.id === id);
  // Management can open anyone's workspace; everyone else only their own (Admin goes to the work queue).
  const openDeal = (p: any) => {
    const owner = dealOwnerId(p);
    if (owner === viewer.id || viewer.role === 'management') return nav.openWorkspace(hasWorkspace(owner) ? owner : viewer.id, 'pipeline');
    if (viewer.role === 'admin') return nav.openAdminWork('queue');
  };

  const wonDeals = useMemo(() => deals.filter(p => dealStage(p) === 'won'), [deals]);
  const mine = (p: any) => dealOwnerId(p) === viewer.id;
  const ctx: CardCtx = {
    viewer, today, deals, wonDeals, checklists, queries, moneyIn, moneyOut, programmes, representatives,
    checklistSettings, moneySettings, nameOf, clientName, openDeal, nav, mine, notices,
  };

  return (
    <div className="space-y-6 font-sans text-ink">
      {/* Shortcuts */}
      <div className="flex flex-wrap items-center gap-2">
        {hasWorkspace(viewer.id) && (
          <button type="button" className={btnSecondary} onClick={() => nav.openWorkspace(viewer.id)}><Briefcase className="h-4 w-4 text-accent" /> My workspace</button>
        )}
        {staff && <button type="button" className={btnSecondary} onClick={() => nav.openAdminWork()}><ClipboardCheck className="h-4 w-4 text-accent" /> Admin work</button>}
        {viewer.role === 'management' && <button type="button" className={btnSecondary} onClick={nav.openManagement}><ShieldCheck className="h-4 w-4 text-accent" /> Management</button>}
        {viewer.role === 'management' && (
          <label className="flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-semibold">
            <Users className="h-4 w-4 text-accent" />
            <span className="sr-only">Open a teammate's workspace</span>
            <select value={teammate} onChange={e => { const id = e.target.value; setTeammate(''); if (id) nav.openWorkspace(id); }} className="bg-transparent font-semibold focus:outline-none">
              <option value="">Open a teammate's workspace…</option>
              {representatives.filter(r => r.id !== viewer.id).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
        )}
      </div>

      {/* 1. Calendar (small) and 2. Performance (one row) */}
      <div className="grid items-stretch gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <CompactCalendar events={events} today={today} full={calendar} />
        <Performance viewer={viewer} representatives={representatives} deals={deals} today={today} />
      </div>

      {/* 3. My cards */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-xl font-bold">My cards</h2>
          <button type="button" className={btnSecondary} onClick={() => setCustomising(c => !c)}>
            <LayoutGrid className="h-4 w-4" /> {customising ? 'Done' : 'Customise'}
          </button>
        </div>
        {prefsError && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{prefsError}</p>}
        {customising && <Customiser allowed={allowed} cards={cards} onChange={saveCards} />}
        {!prefsLoaded ? (
          <p className="flex items-center gap-2 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading your cards…</p>
        ) : cards.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line p-6 text-center text-ink-soft">No cards chosen. Click Customise to add some.</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {cards.map(id => <Card key={id} id={id} ctx={ctx} />)}
          </div>
        )}
      </section>
    </div>
  );
}

// ---------- Customise ----------
function Customiser({ allowed, cards, onChange }: { allowed: typeof CARDS; cards: CardId[]; onChange: (c: CardId[]) => void }) {
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= cards.length) return;
    const next = [...cards];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const hidden = allowed.filter(c => !cards.includes(c.id));
  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <p className="mb-3 text-sm text-ink-soft">Your choice is saved to your login, so it follows you to any computer or phone. Nobody else's page changes.</p>
      <ul className="divide-y divide-line">
        {cards.map((id, i) => (
          <li key={id} className="flex items-center gap-2 py-2">
            <span className="flex-1 font-semibold">{CARDS.find(c => c.id === id)?.title}</span>
            <button type="button" className={iconBtn} disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp className="h-4 w-4" /></button>
            <button type="button" className={iconBtn} disabled={i === cards.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown className="h-4 w-4" /></button>
            <button type="button" className={`${btnSecondary} py-1`} onClick={() => onChange(cards.filter(c => c !== id))}><EyeOff className="h-3.5 w-3.5" /> Hide</button>
          </li>
        ))}
        {hidden.map(c => (
          <li key={c.id} className="flex items-center gap-2 py-2 text-ink-soft">
            <span className="flex-1">{c.title}</span>
            <button type="button" className={`${btnSecondary} py-1`} onClick={() => onChange([...cards, c.id])}><Eye className="h-3.5 w-3.5" /> Show</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- Performance rings ----------
// Outer (big) ring: sales won this year vs the year's target (monthly target x 12).
// Inner (small) ring: sales won this month vs the monthly target.
function salesTarget(rep: Representative): number | null {
  const m = metricsFor(rep).find(x => x.key === 'salesFigure');
  return m && m.auto === 'won' ? m.targetVal : null;
}

function wonBetween(deals: any[], from: string, to: string, ownerId?: string): number {
  let t = 0;
  for (const p of deals) {
    if (ownerId && dealOwnerId(p) !== ownerId) continue;
    const d = dealWonDate(p);
    if (d && d >= from && d <= to) t += dealValue(p);
  }
  return t;
}

const MONTH_ABBR = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function Performance({ viewer, representatives, deals, today }: { viewer: Viewer; representatives: Representative[]; deals: any[]; today: string }) {
  const year = today.slice(0, 4);
  const monthStart = today.slice(0, 7) + '-01';
  const yearStart = `${year}-01-01`;
  const monthLabel = new Date(today + 'T00:00:00').toLocaleDateString('en-GB', { month: 'long' });
  const monthKey = `${MONTH_ABBR[Number(today.slice(5, 7)) - 1]}-${year.slice(2)}`;

  const sellers = representatives.filter(r => salesTarget(r) !== null);
  const ringFor = (rep: Representative) => {
    const monthly = salesTarget(rep) || 0;
    return {
      yearValue: wonBetween(deals, yearStart, today, rep.id), yearTarget: monthly * 12,
      monthValue: countAuto('won', deals, rep.id, monthKey), monthTarget: monthly,
    };
  };
  const company = {
    yearValue: wonBetween(deals, yearStart, today), yearTarget: sellers.reduce((t, r) => t + (salesTarget(r) || 0) * 12, 0),
    monthValue: wonBetween(deals, monthStart, today), monthTarget: sellers.reduce((t, r) => t + (salesTarget(r) || 0), 0),
  };
  const me = representatives.find(r => r.id === viewer.id);
  const meRing = me && salesTarget(me) !== null ? ringFor(me) : null;
  // Reps see only their own ring; Admin and Management also see the company.
  const showCompany = viewer.role !== 'rep';

  // Main rings (Company and/or Me) are large with their figures beside them; Management also
  // gets a row of small rings, one per person, underneath.
  const main: { key: string; label: string; ring: Ring }[] = [];
  if (showCompany) main.push({ key: 'company', label: 'Company', ring: company });
  if (meRing) main.push({ key: 'me', label: 'Me', ring: meRing });
  const team = viewer.role === 'management' ? sellers.filter(r => r.id !== viewer.id).map(r => ({ key: r.id, label: r.name, ring: ringFor(r) })) : [];
  const tip = (label: string, ring: Ring) => `${label}\nYear ${year}: ${formatRM(ring.yearValue)} of ${formatRM(ring.yearTarget)} (${pct(ring.yearValue, ring.yearTarget)}%)\n${monthLabel}: ${formatRM(ring.monthValue)} of ${formatRM(ring.monthTarget)} (${pct(ring.monthValue, ring.monthTarget)}%)`;

  return (
    <section className="flex h-full flex-col rounded-2xl border border-line bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-bold">Performance</h2>
        <span className="flex items-center gap-3 text-xs text-ink-soft">
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-[#0E6E62]" />Outer ring: year {year}</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-[#5DB3A6]" />Inner ring: {monthLabel}</span>
        </span>
      </div>
      {main.length === 0 && team.length === 0 ? (
        <p className="mt-2 text-ink-soft">No sales target is set for you yet.</p>
      ) : (
        <div className="flex flex-1 flex-col justify-center gap-4 pt-3">
          {main.length > 0 && (
            <div className={`grid gap-4 ${main.length > 1 ? 'sm:grid-cols-2' : ''}`}>
              {main.map(({ key, label, ring }) => (
                <div key={key} className="flex items-center gap-4 rounded-xl bg-surface p-3" title={tip(label, ring)}>
                  <Rings ring={ring} size={124} />
                  <div className="min-w-0 space-y-1.5">
                    <p className="font-bold">{label}</p>
                    <div>
                      <p className="text-xs text-ink-soft">Year {year}</p>
                      <p className="text-sm"><strong className="tabular-nums">{formatRM(ring.yearValue)}</strong> <span className="text-ink-soft">of {formatRM(ring.yearTarget)}</span></p>
                    </div>
                    <div>
                      <p className="text-xs text-ink-soft">{monthLabel}</p>
                      <p className="text-sm"><strong className="tabular-nums">{formatRM(ring.monthValue)}</strong> <span className="text-ink-soft">of {formatRM(ring.monthTarget)} · {pct(ring.monthValue, ring.monthTarget)}%</span></p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {team.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold text-ink-soft">Each person</p>
              <div className="flex gap-3 overflow-x-auto pb-1">
                {team.map(({ key, label, ring }) => (
                  <div key={key} className="flex w-20 shrink-0 flex-col items-center text-center" title={tip(label, ring)}>
                    <Rings ring={ring} size={64} />
                    <span className="mt-1 w-full truncate text-xs font-semibold">{label}</span>
                    <span className="text-xs text-ink-soft">{pct(ring.monthValue, ring.monthTarget)}% {monthLabel.slice(0, 3)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

type Ring = { yearValue: number; yearTarget: number; monthValue: number; monthTarget: number };
const pct = (v: number, t: number) => (t > 0 ? Math.round((v / t) * 100) : 0);

function Rings({ ring, size }: { ring: Ring; size: number }) {
  const c = size / 2;
  const outerR = size * 0.41, outerW = size * 0.093, innerR = size * 0.27, innerW = size * 0.067;
  const arc = (r: number, frac: number) => {
    const len = 2 * Math.PI * r;
    return `${Math.max(0, Math.min(1, frac)) * len} ${len}`;
  };
  const yp = pct(ring.yearValue, ring.yearTarget);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Year ${yp}% of target, this month ${pct(ring.monthValue, ring.monthTarget)}% of target`}>
      <circle cx={c} cy={c} r={outerR} fill="none" stroke="#E2E5DE" strokeWidth={outerW} />
      <circle cx={c} cy={c} r={outerR} fill="none" stroke="#0E6E62" strokeWidth={outerW} strokeLinecap="round" strokeDasharray={arc(outerR, ring.yearTarget ? ring.yearValue / ring.yearTarget : 0)} transform={`rotate(-90 ${c} ${c})`} />
      <circle cx={c} cy={c} r={innerR} fill="none" stroke="#E2E5DE" strokeWidth={innerW} />
      <circle cx={c} cy={c} r={innerR} fill="none" stroke="#5DB3A6" strokeWidth={innerW} strokeLinecap="round" strokeDasharray={arc(innerR, ring.monthTarget ? ring.monthValue / ring.monthTarget : 0)} transform={`rotate(-90 ${c} ${c})`} />
      <text x={c} y={c + size * 0.05} textAnchor="middle" fill="#1C2B45" style={{ fontSize: size * 0.14, fontWeight: 700 }}>{yp}%</text>
    </svg>
  );
}

// ---------- Small calendar ----------
// A small month grid. Days with events get a dot; pointing at (or tapping) a day shows its events.
// "Add event / full calendar" opens the full calendar with Google sync.
const DOW = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function CompactCalendar({ events, today, full }: { events: CalendarEvent[]; today: string; full: React.ReactNode }) {
  const [cursor, setCursor] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 }));
  const [hover, setHover] = useState<string | null>(null);
  const [showFull, setShowFull] = useState(false);
  const first = new Date(cursor.y, cursor.m, 1);
  const lead = (first.getDay() + 6) % 7;   // weeks start on Monday
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const iso = (d: number) => `${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const byDay = useMemo(() => {
    const m: Record<string, CalendarEvent[]> = {};
    events.forEach(e => { if (e.date) (m[e.date.slice(0, 10)] ||= []).push(e); });
    return m;
  }, [events]);
  const shift = (n: number) => setCursor(c => { const d = new Date(c.y, c.m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const hoverEvents = hover ? byDay[hover] || [] : [];

  return (
    <section className="rounded-2xl border border-line bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-bold"><CalendarDays className="h-4 w-4 text-accent" />{first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</h2>
        <span className="flex">
          <button type="button" className={iconBtn} onClick={() => shift(-1)} aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" className={iconBtn} onClick={() => shift(1)} aria-label="Next month"><ChevronRight className="h-4 w-4" /></button>
        </span>
      </div>
      <div className="mt-2 grid grid-cols-7 gap-0.5 text-center text-xs" onMouseLeave={() => setHover(null)}>
        {DOW.map(d => <span key={d} className="py-1 font-semibold text-ink-soft">{d}</span>)}
        {cells.map((d, i) => {
          if (d === null) return <span key={`b${i}`} />;
          const day = iso(d);
          const count = byDay[day]?.length || 0;
          const isToday = day === today;
          return (
            <button key={day} type="button" onMouseEnter={() => setHover(day)} onFocus={() => setHover(day)} onClick={() => setHover(h => (h === day ? null : day))}
              className={`relative flex h-8 items-center justify-center rounded-md text-sm ${isToday ? 'bg-accent font-bold text-white' : hover === day ? 'bg-surface' : 'hover:bg-surface'}`}
              aria-label={`${formatDate(day)}${count ? `, ${count} event${count === 1 ? '' : 's'}` : ''}`}>
              {d}
              {count > 0 && <span className={`absolute bottom-1 h-1 w-1 rounded-full ${isToday ? 'bg-white' : 'bg-accent'}`} />}
            </button>
          );
        })}
      </div>
      <div className="mt-2 min-h-[44px] rounded-lg bg-surface px-3 py-2 text-sm" aria-live="polite">
        {hover ? (
          <>
            <p className="font-semibold">{formatDate(hover)}</p>
            {hoverEvents.length === 0 ? <p className="text-ink-soft">No events</p> : hoverEvents.map(e => <p key={e.id} className="truncate text-ink-soft">{e.time ? `${e.time} · ` : ''}{e.title}</p>)}
          </>
        ) : <p className="text-ink-soft">Point at a date to see its events.</p>}
      </div>
      <button type="button" className="mt-2 text-sm font-semibold text-accent hover:underline" onClick={() => setShowFull(v => !v)}>
        {showFull ? 'Hide full calendar' : 'Add event / full calendar'}
      </button>
      {showFull && <div className="mt-3">{full}</div>}
    </section>
  );
}

// ---------- Cards ----------
type CardCtx = {
  viewer: Viewer; today: string; deals: any[]; wonDeals: any[]; checklists: Record<string, any>; queries: HrdcQuery[];
  moneyIn: MoneyIn[]; moneyOut: MoneyOut[]; programmes: any[]; representatives: Representative[];
  checklistSettings: any; moneySettings: any; nameOf: (id: string) => string; clientName: (p: any) => string;
  openDeal: (p: any) => void; nav: MyHomeNav; mine: (p: any) => boolean; notices: React.ReactNode;
};

type Item = { key: string; title: string; sub?: string; level?: 'danger' | 'attention'; onClick?: () => void };

function Card({ id, ctx }: { id: CardId; ctx: CardCtx; key?: string }) {
  const title = CARDS.find(c => c.id === id)?.title || '';
  if (id === 'notices') return <div className="lg:col-span-2">{ctx.notices}</div>;
  const { items, empty, footer } = cardContent(id, ctx);
  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="font-bold">{title}</h3>
        {items.length > 0 && <span className="rounded-md bg-surface px-2 py-0.5 text-xs font-semibold text-ink-soft">{items.length}</span>}
      </div>
      {items.length === 0 ? <p className="text-[15px] text-ink-soft">{empty}</p> : (
        <ul className="divide-y divide-line">
          {items.slice(0, 8).map(it => (
            <li key={it.key}>
              <button type="button" disabled={!it.onClick} onClick={it.onClick} className="flex w-full items-start gap-2 py-2 text-left enabled:hover:bg-surface">
                {it.level && <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${it.level === 'danger' ? 'text-danger' : 'text-attention'}`} />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{it.title}</span>
                  {it.sub && <span className={`block text-sm ${it.level === 'danger' ? 'text-danger' : it.level === 'attention' ? 'text-attention' : 'text-ink-soft'}`}>{it.sub}</span>}
                </span>
                {it.onClick && <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-ink-soft" />}
              </button>
            </li>
          ))}
        </ul>
      )}
      {items.length > 8 && <p className="pt-2 text-sm text-ink-soft">and {items.length - 8} more</p>}
      {footer}
    </div>
  );
}

const ymd = (v: any) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '');

function cardContent(id: CardId, c: CardCtx): { items: Item[]; empty: string; footer?: React.ReactNode } {
  const deal = (p: any) => `${c.clientName(p)} · ${p.courseName || 'No programme'}`;
  const staff = c.viewer.role !== 'rep';

  switch (id) {
    case 'follow_ups': {
      const appts: Item[] = c.deals
        .filter(p => c.mine(p) && apptOf(p)?.status === 'booked')
        .map(p => ({ p, a: apptOf(p)!, d: daysUntil(apptOf(p)!.date, c.today) ?? 99 }))
        .filter(x => x.d <= 7)
        .sort((a, b) => a.d - b.d)
        .map(({ p, a, d }) => ({
          key: `appt_${p.id}`, title: `Appointment: ${c.clientName(p)}`, onClick: () => c.openDeal(p),
          sub: apptOverdue(p, c.today) ? `Held ${formatDate(a.date)}? Log what happened` : d === 0 ? `Today${a.time ? `, ${apptTime(a.time)}` : ''} · ${MODE_LABELS[a.mode]}` : `${formatDate(a.date)}${a.time ? `, ${apptTime(a.time)}` : ''} · ${MODE_LABELS[a.mode]}`,
          level: apptOverdue(p, c.today) ? 'danger' as const : d <= 0 ? 'attention' as const : undefined,
        }));
      const soon = c.deals
        .filter(p => c.mine(p) && OPEN_STAGES.includes(dealStage(p)) && ymd(p.followUpDate))
        .map(p => ({ p, d: daysUntil(ymd(p.followUpDate), c.today) ?? 99 }))
        .filter(x => x.d <= 7)
        .sort((a, b) => a.d - b.d);
      return {
        items: [...appts, ...soon.map(({ p, d }) => ({
          key: p.id, title: c.clientName(p), onClick: () => c.openDeal(p),
          sub: d < 0 ? `Overdue by ${-d} day${d === -1 ? '' : 's'} (${STAGE_LABELS[dealStage(p)]})` : d === 0 ? 'Follow up today' : `Follow up ${formatDate(ymd(p.followUpDate))}`,
          level: d < 0 ? 'danger' : d === 0 ? 'attention' : undefined,
        } as Item))],
        empty: 'No follow-ups or appointments in the next 7 days.',
      };
    }
    case 'my_kpi': {
      const me = c.representatives.find(r => r.id === c.viewer.id);
      if (!me) return { items: [], empty: 'You have no KPI set.' };
      const monthKey = `${MONTH_ABBR[Number(c.today.slice(5, 7)) - 1]}-${c.today.slice(2, 4)}`;
      const rows = metricsFor(me).map(m => {
        const typed = Array.isArray((me.kpi as any)?.[m.key]) ? (me.kpi as any)[m.key].reduce((t: number, x: number) => t + (Number(x) || 0), 0) : 0;
        const value = m.auto ? countAuto(m.auto, c.deals, me.id, monthKey) : typed;
        return { m, value, p: pct(value, m.targetVal) };
      });
      return {
        items: [], empty: '',
        footer: (
          <ul className="space-y-3">
            {rows.map(({ m, value, p }) => (
              <li key={m.key}>
                <div className="flex justify-between text-sm"><span className="font-semibold">{m.label}</span><span className="tabular-nums text-ink-soft">{m.isRM ? formatRM(value) : value} of {m.isRM ? formatRM(m.targetVal) : m.targetVal} ({p}%)</span></div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, p)}%` }} /></div>
              </li>
            ))}
            <li><button type="button" className="text-sm font-semibold text-accent hover:underline" onClick={() => c.nav.openWorkspace(c.viewer.id, 'kpi')}>Open my KPI page</button></li>
          </ul>
        ),
      };
    }
    case 'my_won': {
      const list = c.wonDeals
        .filter(p => c.mine(p) && (!ymd(p.trainingDate) || (daysUntil(ymd(p.trainingDate), c.today) ?? 0) >= -60))
        .sort((a, b) => (ymd(a.trainingDate) || '9999').localeCompare(ymd(b.trainingDate) || '9999'));
      return {
        items: list.map(p => {
          const cl = c.checklists[p.id];
          const pr = cl ? progress(cl.tasks, p.fundingType) : null;
          const ins = c.moneyIn.filter(m => m.dealId === p.id);
          const pay = ins.length === 0 ? 'not invoiced yet' : ins.every(isPaid) ? 'paid' : 'invoiced, waiting for payment';
          return { key: p.id, title: deal(p), onClick: () => c.openDeal(p), sub: `${ymd(p.trainingDate) ? `Training ${formatDate(ymd(p.trainingDate))}` : 'No training date'} · admin ${pr ? `${pr.done} of ${pr.total}` : 'not started'} · ${pay}` };
        }),
        empty: 'No recent won deals.',
      };
    }
    case 'next14': {
      const list = c.wonDeals
        .filter(p => (staff || c.mine(p)) && ymd(p.trainingDate))
        .map(p => ({ p, d: daysUntil(ymd(p.trainingDate), c.today) ?? -1 }))
        .filter(x => x.d >= 0 && x.d <= 14)
        .sort((a, b) => a.d - b.d);
      return {
        items: list.map(({ p, d }) => {
          const cl = c.checklists[p.id];
          const pr = cl ? progress(cl.tasks, p.fundingType) : null;
          const flags = cl ? checklistFlags(p, cl.tasks, c.checklistSettings, c.today).filter(f => f.level === 'danger') : [];
          return {
            key: p.id, title: deal(p), level: flags.length ? 'danger' as const : undefined,
            sub: `${d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : `In ${d} days`} (${formatDate(ymd(p.trainingDate))}) · ${pr ? `${pr.done} of ${pr.total} ready` : 'checklist not started'}${flags.length ? ` · ${flags[0].text}` : ''}`,
            onClick: staff ? () => c.nav.openAdminWork('queue') : () => c.openDeal(p),
          };
        }),
        empty: 'No trainings in the next 14 days.',
      };
    }
    case 'new_won': {
      const list = c.wonDeals
        .filter(p => { const w = dealWonDate(p); return w && (daysUntil(w, c.today) ?? -99) >= -7; })
        .sort((a, b) => dealWonDate(b).localeCompare(dealWonDate(a)));
      return {
        items: list.map(p => ({ key: p.id, title: deal(p), onClick: () => c.nav.openAdminWork('queue'), sub: `Won ${formatDate(dealWonDate(p))} by ${c.nameOf(dealOwnerId(p))} · ${formatRM(dealValue(p))}${c.checklists[p.id] ? '' : ' · checklist not started'}` })),
        empty: 'No deals won in the last 7 days.',
      };
    }
    case 'due_now': {
      const items: Item[] = [];
      c.wonDeals.forEach(p => {
        const cl = c.checklists[p.id];
        c.queries.filter(q => q.dealId === p.id && isQueryOpen(q)).forEach(q => items.push({
          key: q.id, title: deal(p), level: isQueryOverdue(q, c.today) ? 'danger' : 'attention', onClick: () => c.nav.openAdminWork('queue'),
          sub: `HRDC query ${isQueryOverdue(q, c.today) ? 'overdue' : 'open'}, reply by ${formatDate(q.replyBy)}`,
        }));
        if (!cl) return;
        checklistFlags(p, cl.tasks, c.checklistSettings, c.today).forEach((f: Flag, i: number) => items.push({
          key: `${p.id}_${i}`, title: deal(p), level: f.level, sub: f.text, onClick: () => c.nav.openAdminWork('queue'),
        }));
      });
      items.sort((a, b) => (a.level === b.level ? 0 : a.level === 'danger' ? -1 : 1));
      return { items, empty: 'Nothing urgent. Every checklist and HRDC query is on track.' };
    }
    case 'money_jobs': {
      const items: Item[] = [];
      c.wonDeals.forEach(p => {
        moneyFlags(p, c.moneyIn.filter(m => m.dealId === p.id), [], c.moneySettings, c.today).forEach((f, i) => items.push({
          key: `${p.id}_m${i}`, title: deal(p), level: f.level, sub: f.text, onClick: () => c.nav.openAdminWork('money'),
        }));
      });
      c.moneyOut.filter(o => o.status === 'approved').forEach(o => items.push({ key: o.id, title: `Pay ${o.payee}: ${formatRM(o.amount)}`, sub: `${o.category}, approved by ${o.decidedByName}`, onClick: () => c.nav.openAdminWork('money') }));
      c.moneyOut.filter(o => o.status === 'rejected' && o.requestedById === c.viewer.id).forEach(o => items.push({ key: o.id, title: `Rejected: ${o.payee} ${formatRM(o.amount)}`, sub: o.rejectReason || 'See the reason and send a new request', level: 'attention', onClick: () => c.nav.openAdminWork('money') }));
      items.sort((a, b) => (a.level === b.level ? 0 : a.level === 'danger' ? -1 : b.level === 'danger' ? 1 : a.level ? -1 : 1));
      return { items, empty: 'No money jobs waiting.' };
    }
    case 'approvals': {
      const list = c.moneyOut.filter(o => canDecide(o, c.viewer));
      return {
        items: list.map(o => {
          const p = c.deals.find(d => d.id === o.dealId);
          return { key: o.id, title: `${o.category} · ${o.payee} · ${formatRM(o.amount)}`, sub: `${p ? deal(p) : 'Deal'} · requested by ${o.requestedByName}`, onClick: () => c.nav.openAdminWork('money') };
        }),
        empty: 'Nothing waiting for your approval.',
      };
    }
    case 'money_position': {
      let toComeIn = 0, overdue = 0, toPay = 0, waiting = 0, profitMonth = 0;
      const month = c.today.slice(0, 7);
      c.wonDeals.forEach(p => {
        const ins = c.moneyIn.filter(m => m.dealId === p.id);
        const outs = c.moneyOut.filter(o => o.dealId === p.id);
        const pl = dealPL(ins, outs, c.moneySettings);
        toComeIn += pl.toComeIn; toPay += pl.toPayOut; waiting += pl.pendingApproval;
        if (ymd(p.trainingDate).startsWith(month)) profitMonth += pl.profit;
        ins.filter(m => !isPaid(m) && ymd(m.invoiceDate) && -(daysUntil(ymd(m.invoiceDate), c.today) ?? 0) > c.moneySettings.overdueDays).forEach(() => { overdue++; });
      });
      const tile = (label: string, value: string, tone?: string) => (
        <div className="rounded-xl bg-surface px-3 py-2.5"><p className="text-xs font-semibold text-ink-soft">{label}</p><p className={`text-lg font-bold tabular-nums ${tone || ''}`}>{value}</p></div>
      );
      return {
        items: [], empty: '',
        footer: (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {tile('Still to come in', formatRM(toComeIn))}
              {tile('Overdue invoices or claims', String(overdue), overdue ? 'text-danger' : '')}
              {tile('Approved, to pay', formatRM(toPay))}
              {tile('Waiting for approval', formatRM(waiting))}
            </div>
            <p className="text-sm text-ink-soft">Profit on trainings this month: <strong className={profitMonth < 0 ? 'text-danger' : 'text-ink'}>{formatRM(profitMonth)}</strong></p>
            <button type="button" className="text-sm font-semibold text-accent hover:underline" onClick={() => c.nav.openAdminWork('money')}>Open Money</button>
          </div>
        ),
      };
    }
    case 'pipeline': {
      const open = c.deals.filter(p => OPEN_STAGES.includes(dealStage(p)));
      const stuck = open.filter(p => {
        if (apptOverdue(p, c.today)) return true;
        const fu = ymd(p.followUpDate);
        if (fu && fu < c.today) return true;
        const sent = ymd(p.proposalSentDate);
        if (dealStage(p) === 'quoted' && !fu && ymd(p.quotationSentDate) && (daysUntil(ymd(p.quotationSentDate), c.today) ?? 0) <= -7) return true;
        return dealStage(p) === 'proposal' && !fu && sent && (daysUntil(sent, c.today) ?? 0) <= -7;
      });
      return {
        items: stuck.map(p => ({ key: p.id, title: c.clientName(p), level: 'attention' as const, onClick: () => c.openDeal(p), sub: `${c.nameOf(dealOwnerId(p))} · ${STAGE_LABELS[dealStage(p)]} · ${apptOverdue(p, c.today) ? `appointment on ${formatDate(apptOf(p)!.date)} not logged` : ymd(p.followUpDate) ? `follow-up was due ${formatDate(ymd(p.followUpDate))}` : 'no follow-up set for 7+ days'}` })),
        empty: 'No stuck deals.',
        footer: (
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-line pt-3 sm:grid-cols-4">
            {(['lead', 'proposal', 'agreed', 'quoted'] as DealStage[]).map(st => {
              const list = open.filter(p => journeyStage(dealStage(p)) === st);
              return <div key={st} className="rounded-xl bg-surface px-3 py-2"><p className="text-xs font-semibold text-ink-soft">{STAGE_LABELS[st]}</p><p className="font-bold">{list.length}</p><p className="text-xs text-ink-soft">{formatRM(list.reduce((t, p) => t + dealValue(p), 0))}</p></div>;
            })}
          </div>
        ),
      };
    }
    case 'team_appointments': {
      const t = new Date(c.today + 'T00:00:00');
      const mon = new Date(t); mon.setDate(t.getDate() - ((t.getDay() + 6) % 7));
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
      const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const from = iso(mon), to = iso(sun);
      const list = c.deals
        .map(p => ({ p, a: apptOf(p) }))
        .filter(x => x.a && !x.a.legacy && x.a.date >= from && x.a.date <= to)
        .sort((x, y) => x.a!.date.localeCompare(y.a!.date));
      return {
        items: list.map(({ p, a }) => {
          const late = apptLateDays(a!);
          const held = a!.status === 'held';
          return {
            key: p.id, title: `${c.clientName(p)} · ${c.nameOf(dealOwnerId(p))}`, onClick: () => c.openDeal(p),
            level: apptOverdue(p, c.today) ? 'danger' as const : held && late > 3 ? 'attention' as const : undefined,
            sub: held
              ? `Held ${formatDate(a!.date)}${a!.outcome ? ` · ${a!.outcome}` : ''}${a!.nextStep ? ` · Next: ${a!.nextStep}` : ''}${late > 3 ? ` · logged ${late} days late` : ''}`
              : apptOverdue(p, c.today) ? `Booked ${formatDate(a!.date)}, not logged` : `Booked ${formatDate(a!.date)}${a!.time ? `, ${apptTime(a!.time)}` : ''} · ${MODE_LABELS[a!.mode]}`,
          };
        }),
        empty: 'No appointments this week.',
      };
    }
    case 'programmes_waiting': {
      const list = c.programmes.filter(p => programmeStatus(p) === 'submitted').sort((a, b) => String(a.submittedDate || '').localeCompare(String(b.submittedDate || '')));
      return {
        items: list.map(p => {
          const waited = ymd(p.submittedDate) ? -(daysUntil(ymd(p.submittedDate), c.today) ?? 0) : null;
          return { key: p.id, title: p.name, onClick: () => c.nav.openAdminWork('programmes'), sub: waited === null ? 'Submitted to HRDC' : `Waiting ${waited} day${waited === 1 ? '' : 's'} (since ${formatDate(ymd(p.submittedDate))})`, level: waited !== null && waited > 30 ? 'attention' as const : undefined };
        }),
        empty: 'No programmes waiting on HRDC.',
      };
    }
    default:
      return { items: [], empty: '' };
  }
}

