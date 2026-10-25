import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, onSnapshot, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { ArrowDown, ArrowLeft, ArrowUp, CalendarPlus, Check, CheckCircle2, Circle, Loader2, Lock, Plus, Settings, Star, Trash2, X } from 'lucide-react';
import { Representative } from '../types';
import { callServer, db, friendlyError } from '../lib/firebase';
import { formatDate, formatRM, todayIso } from '../lib/deals';
import { linkedOnly, withoutDeleted } from '../lib/linked';
import { kpiValueText, monthKpi } from '../lib/kpi';
import { useKpiSources } from '../lib/useKpiSources';
import { useTeamList } from '../lib/useClientHistory';
import { useAutoSave } from '../lib/useAutoSave';
import { useFormDraft } from '../lib/useFormDraft';
import { isSuperManager } from '../lib/superManager';
import { usePaged, sortList, type ListSort } from '../lib/listPaging';
import { useOneToOnes } from '../lib/useOneToOnes';
import {
  ActionReview, OneToOne, OtoAction, OtoQType, OtoQuestion, OtoQuestions, OtoStage, STAGE_LABELS, STAGE_WHO, STATUS_LABELS, TYPE_LABELS,
  ImportantDate, PROFILE_FIELDS, ageOf, dayName, hasAnswer, initiatorOf, newQuestionId, sinceText, upcomingDates, previousHeld, questionsFor, sessionNumbers, time12, waitingOn,
} from '../lib/oneToOne';
import DraftBar from './DraftBar';
import ListPager, { SortSelect } from './ListPager';

// The 1-to-1 tab (Joel, 2026-10-25), on everyone's menu. Staff see only their own sessions; the person who runs
// 1-to-1s (the coach) sees everyone's, with an overview. Nobody else, Management included, sees any of it.
// Logic and the agreed flow: lib/oneToOne.ts.

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15 disabled:bg-surface disabled:text-ink-soft';
const label = 'mb-1.5 block text-sm font-semibold text-ink';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';
const card = 'rounded-2xl border border-line bg-white p-5';

const STATUS_TONE: Record<string, string> = {
  requested: 'bg-attention/10 text-attention', booked: 'bg-accent-soft text-accent', held: 'bg-surface text-ink',
  declined: 'bg-surface text-ink-soft', cancelled: 'bg-surface text-ink-soft',
};

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
// Firestore refuses blank (undefined) fields.
const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const one = (n: number | null) => (n === null ? '–' : (Math.round(n * 10) / 10).toString());

export default function OneToOnePage({ me, reps, month }: { me: Viewer; reps: Representative[]; month: string }) {
  const { coachId, questions, sessions, loaded } = useOneToOnes(me.id);
  const team = useTeamList();
  const active = team.filter(p => p.active);
  const nameOf = (id: string) => team.find(p => p.id === id)?.name || 'Someone';
  const isCoach = !!coachId && coachId === me.id;
  const isOwner = isSuperManager(me);
  const numbers = useMemo(() => sessionNumbers(sessions), [sessions]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [personId, setPersonId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [booking, setBooking] = useState<{ personId: string } | null>(null);
  const [profileOf, setProfileOf] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const flash = (t: string) => { setToast(t); window.setTimeout(() => setToast(''), 3000); };

  // Actions sent to the To-do list from 1-to-1s (to show whether each is done).
  const [tasks, setTasks] = useState<any[]>([]);
  useEffect(() => onSnapshot(query(collection(db, 'tasks'), where('source', '==', '121')),
    s => setTasks(s.docs.map(d => ({ ...d.data(), id: d.id }))), () => setTasks([])), []);

  const open = sessions.find(s => s.id === openId) || null;
  const needsMe = sessions.filter(s => waitingOn(s, me.id)).sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  if (showSettings && (isCoach || isOwner)) {
    return <SettingsView coachId={coachId} questions={questions} isOwner={isOwner} isCoach={isCoach} onBack={() => setShowSettings(false)} />;
  }
  if (profileOf) {
    return <ProfileView memberId={profileOf} name={nameOf(profileOf)} me={me} isCoach={isCoach} onBack={() => setProfileOf(null)} />;
  }
  if (open) {
    return <SessionView key={open.id} s={open} me={me} all={sessions} number={numbers[open.id] || 0} current={questions} nameOf={nameOf} tasks={tasks}
      rep={reps.find(r => r.id === open.personId)} month={month} onBack={() => setOpenId(null)} flash={flash} />;
  }

  const header = (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-2xl font-bold text-ink">1-to-1</h2>
        <p className="mt-1 text-[15px] text-ink-soft">
          {isCoach ? 'Everyone’s 1-to-1 sessions. Only you and the person see a session.' : coachId ? `Your 90-minute sessions with ${nameOf(coachId)}, about your work or anything else.` : ''}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {(isCoach || isOwner) && <button type="button" className={btnSecondary} onClick={() => setShowSettings(true)}><Settings className="h-4 w-4" /> Settings</button>}
        {coachId && !isCoach && <button type="button" className={btnSecondary} onClick={() => setProfileOf(me.id)}>My profile</button>}
        {coachId && <button type="button" className={btnPrimary} onClick={() => setBooking({ personId: isCoach ? (personId || '') : me.id })}><CalendarPlus className="h-4 w-4" /> Book 1-to-1</button>}
      </div>
    </div>
  );

  return (
    <div className="space-y-5 font-sans text-ink">
      {header}
      {toast && <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm font-semibold text-accent" role="status">{toast}</p>}

      {!coachId && (
        <p className={`${card} text-[15px] text-ink-soft`}>
          {isOwner ? 'Getting 1-to-1s ready…' : '1-to-1 sessions aren’t set up yet.'}
        </p>
      )}

      {booking && coachId && (
        <BookForm me={me} coachId={coachId} isCoach={isCoach} people={active.filter(p => p.id !== coachId)} startPerson={booking.personId}
          sessions={sessions} current={questions} onClose={() => setBooking(null)} onBooked={(s) => { setBooking(null); flash(`1-to-1 asked for ${formatDate(s.date)}. ${nameOf(s.requestedById === s.coachId ? s.personId : s.coachId)} will be asked to accept.`); }} />
      )}

      {needsMe.length > 0 && (
        <section className={`${card} border-attention/40`}>
          <h3 className="text-lg font-bold">Needs you</h3>
          <ul className="mt-3 divide-y divide-line">
            {needsMe.map(s => (
              <li key={s.id}>
                <button type="button" onClick={() => setOpenId(s.id)} className="flex w-full flex-wrap items-center justify-between gap-2 py-2.5 text-left hover:bg-surface">
                  <span className="text-[15px]"><b>{isCoach ? nameOf(s.personId) : `1-to-1 #${numbers[s.id] || ''}`}</b> · {formatDate(s.date)}{s.time ? `, ${time12(s.time)}` : ''}</span>
                  <span className="text-sm font-semibold text-attention">{waitingOn(s, me.id)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {isCoach && !personId && (
        <Overview people={active.filter(p => p.id !== me.id)} sessions={sessions} tasks={tasks} onOpenPerson={setPersonId} onBook={(id) => setBooking({ personId: id })} />
      )}

      {isCoach && personId && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnSecondary} onClick={() => setProfileOf(personId)}>{nameOf(personId)}’s profile</button>
        </div>
      )}
      {coachId && (!isCoach || personId) && (
        <SessionList title={isCoach ? `${nameOf(personId!)}’s sessions` : 'Your sessions'}
          sessions={sessions.filter(s => s.personId === (isCoach ? personId : me.id))} numbers={numbers} me={me}
          onOpen={setOpenId} onBack={isCoach ? () => setPersonId(null) : undefined}
          onBook={isCoach ? () => setBooking({ personId: personId! }) : undefined} loaded={loaded} />
      )}
    </div>
  );
}

// ---------- The coach's overview: one row per person ----------
function Overview({ people, sessions, tasks, onOpenPerson, onBook }: {
  people: { id: string; name: string }[]; sessions: OneToOne[]; tasks: any[]; onOpenPerson: (id: string) => void; onBook: (id: string) => void;
}) {
  const today = todayIso();
  // Birthdays, work anniversaries and other important dates in the next 7 days, from the profiles.
  const [profiles, setProfiles] = useState<Record<string, any>>({});
  useEffect(() => onSnapshot(collection(db, 'staff_profiles'), s => setProfiles(Object.fromEntries(s.docs.map(d => [d.id, d.data()]))), () => setProfiles({})), []);
  const coming = people.flatMap(p => upcomingDates(profiles[p.id], today, 7).map(c => ({ ...c, p })));
  const rows = people.map(p => {
    const mine = sessions.filter(s => s.personId === p.id);
    const held = mine.filter(s => s.status === 'held').sort((a, b) => b.date.localeCompare(a.date));
    const next = mine.filter(s => (s.status === 'booked' || s.status === 'requested') && s.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
    const openActions = tasks.filter(t => held.some(h => h.id === t.oneToOneId) && t.status !== 'Done');
    const overdue = openActions.filter(t => t.dateline && t.dateline < today).length;
    return {
      p, held: held.length, last: held[0]?.date || '', next,
      open: openActions.length, overdue,
      asked: held.filter(s => initiatorOf(s) === p.id).length,
      rating: avg(held.map(s => Number(s.staffRating)).filter(n => n > 0)),
      mood: avg(held.map(s => Number(s.before?.mood)).filter(n => n > 0)),
    };
  });
  return (
    <>
    {coming.length > 0 && (
      <section className={card}>
        <h3 className="text-lg font-bold">Coming up this week</h3>
        <ul className="mt-2 space-y-1 text-[15px]">
          {coming.sort((a, b) => a.inDays - b.inDays).map((c, i) => (
            <li key={i}><button type="button" className="font-semibold text-accent hover:underline" onClick={() => onOpenPerson(c.p.id)}>{c.p.name}</button>: {c.label}, {c.inDays === 0 ? 'today' : `${dayName(c.date)} ${formatDate(c.date)}`}</li>
          ))}
        </ul>
      </section>
    )}
    <section className={card}>
      <h3 className="text-lg font-bold">Everyone</h3>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[44rem] text-left text-[15px]">
          <thead className="text-sm text-ink-soft">
            <tr className="border-b border-line">
              <th className="py-2 pr-3 font-semibold">Person</th>
              <th className="py-2 pr-3 font-semibold" title="Sessions held, and how many of them they asked for themselves">Held · asked for</th>
              <th className="py-2 pr-3 font-semibold">Last</th>
              <th className="py-2 pr-3 font-semibold">Next</th>
              <th className="py-2 pr-3 font-semibold">Open actions</th>
              <th className="py-2 pr-3 font-semibold" title="Their average rating of the sessions, and their average mood before them">Rating · mood</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.p.id} className="border-b border-line last:border-0">
                <td className="py-2.5 pr-3"><button type="button" className="font-semibold text-accent hover:underline" onClick={() => onOpenPerson(r.p.id)}>{r.p.name}</button></td>
                <td className="py-2.5 pr-3">{r.held} · {r.asked}</td>
                <td className="py-2.5 pr-3">{r.last ? formatDate(r.last) : '–'}</td>
                <td className="py-2.5 pr-3">{r.next ? <>{formatDate(r.next.date)}{r.next.status === 'requested' && <span className="ml-1 text-sm text-attention">(waiting)</span>}</> : <span className="text-ink-soft">None booked</span>}</td>
                <td className="py-2.5 pr-3">{r.open}{r.overdue > 0 && <span className="ml-1 text-sm font-semibold text-danger">({r.overdue} overdue)</span>}</td>
                <td className="py-2.5 pr-3">{one(r.rating)} · {one(r.mood)}</td>
                <td className="py-2.5 text-right"><button type="button" className={btnSecondary} onClick={() => onBook(r.p.id)}><CalendarPlus className="h-4 w-4" /> Book</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
    </>
  );
}

// ---------- A person's list of sessions ----------
function SessionList({ title, sessions, numbers, me, onOpen, onBack, onBook, loaded }: {
  title: string; sessions: OneToOne[]; numbers: Record<string, number>; me: Viewer; loaded: boolean;
  onOpen: (id: string) => void; onBack?: () => void; onBook?: () => void;
}) {
  const [sortBy, setSortBy] = useState<ListSort>('newest');
  const sorted = useMemo(() => sortList(sessions, sortBy, s => `${s.date}${s.time}`, s => `${s.date}T${s.time || '00:00'}`), [sessions, sortBy]);
  const paged = usePaged(sorted, [sortBy]);
  return (
    <section className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {onBack && <button type="button" onClick={onBack} className="rounded-lg p-1.5 text-ink-soft hover:bg-surface" aria-label="Back to everyone"><ArrowLeft className="h-5 w-5" /></button>}
          <h3 className="text-lg font-bold">{title}</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SortSelect value={sortBy} onChange={setSortBy} label="Sort sessions" />
          {onBook && <button type="button" className={btnPrimary} onClick={onBook}><CalendarPlus className="h-4 w-4" /> Book 1-to-1</button>}
        </div>
      </div>
      {!loaded ? <p className="mt-3 text-[15px] text-ink-soft"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> Loading…</p>
        : sessions.length === 0 ? <p className="mt-3 text-[15px] text-ink-soft">No sessions yet. Press Book 1-to-1 to ask for one.</p>
        : (
          <>
            <ul className="mt-3 divide-y divide-line">
              {paged.pageItems.map(s => (
                <li key={s.id}>
                  <button type="button" onClick={() => onOpen(s.id)} className="flex w-full flex-wrap items-center justify-between gap-2 py-3 text-left hover:bg-surface">
                    <span className="text-[15px]">
                      <b>{numbers[s.id] ? `#${numbers[s.id]}` : '–'}</b> · {dayName(s.date)}, {formatDate(s.date)}{s.time ? `, ${time12(s.time)}` : ''}{s.place ? ` · ${s.place}` : ''}
                    </span>
                    <span className="flex items-center gap-2">
                      {waitingOn(s, me.id) && <span className="text-sm font-semibold text-attention">{waitingOn(s, me.id)}</span>}
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_TONE[s.status]}`}>{STATUS_LABELS[s.status]}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-2 overflow-hidden rounded-xl border border-line"><ListPager paged={paged} noun="sessions" /></div>
          </>
        )}
    </section>
  );
}

// ---------- Booking: date and time (checked against both calendars), place, then the before-meeting questions ----------
function BookForm({ me, coachId, isCoach, people, startPerson, sessions, current, onClose, onBooked, existing }: {
  me: Viewer; coachId: string; isCoach: boolean; people: { id: string; name: string }[]; startPerson: string; sessions: OneToOne[];
  current?: OtoQuestions; onClose: () => void; onBooked: (s: OneToOne) => void; existing?: OneToOne;
}) {
  const last = existing || [...sessions].filter(s => s.place).sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
  const [personId, setPersonId] = useState(existing?.personId || (isCoach ? (startPerson === me.id ? '' : startPerson) : me.id));
  const [date, setDate] = useState(existing?.date || '');
  const [time, setTime] = useState(existing?.time || '10:00');
  const [place, setPlace] = useState(last?.place || '');
  const [before, setBefore] = useState<Record<string, any>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const draft = useFormDraft(me.id, existing ? `oto:time:${existing.id}` : `oto:new:${isCoach ? personId || 'any' : me.id}`, { date, time, place, before },
    v => { setDate(v.date); setTime(v.time); setPlace(v.place); setBefore(v.before || {}); });

  // Calendar check: what's already on the staff member's and the coach's calendars in those 90 minutes.
  const [check, setCheck] = useState<{ state: 'idle' | 'checking' | 'done' | 'error'; clashes: { who: string; text: string }[] }>({ state: 'idle', clashes: [] });
  useEffect(() => {
    if (!personId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) { setCheck({ state: 'idle', clashes: [] }); return; }
    let live = true;
    setCheck(c => ({ ...c, state: 'checking' }));
    const t = window.setTimeout(() => {
      callServer<{ clashes: { who: string; text: string }[] }>('/api/one-to-one/availability', { date, time, personId, sessionId: existing?.id || '' }, true)
        .then(r => { if (live) setCheck({ state: 'done', clashes: r.clashes || [] }); })
        .catch(() => { if (live) setCheck({ state: 'error', clashes: [] }); });
    }, 400);
    return () => { live = false; window.clearTimeout(t); };
  }, [personId, date, time, existing?.id]);

  // Carried answers (e.g. the goals) start from the person's last held session.
  const prevHeld = [...sessions].filter(s => s.personId === personId && s.status === 'held').sort((a, b) => b.date.localeCompare(a.date))[0];
  const questions = (current?.before || []).filter(q => q.type !== 'actions');
  const valueOf = (q: OtoQuestion) => (q.id in before ? before[q.id] : q.carry ? prevHeld?.before?.[q.id] ?? '' : '');

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!personId) return setError('Pick who the 1-to-1 is with.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setError('Pick a date.');
    if (!/^\d{2}:\d{2}$/.test(time)) return setError('Pick a time.');
    if (!place.trim()) return setError('Write where you will meet.');
    if (!existing && date < todayIso()) return setError('Pick today or a later date.');
    if (check.clashes.length && !window.confirm(`The calendar shows something at that time:\n\n${check.clashes.map(c => `${c.who}: ${c.text}`).join('\n')}\n\nBook it anyway?`)) return;
    setBusy(true);
    try {
      const now = new Date().toISOString();
      if (existing) {
        const patch = { date, time, place: place.trim(), status: 'requested', requestedById: me.id, requestedAt: now, updatedAt: Date.now() };
        await updateDoc(doc(db, 'one_to_ones', existing.id), patch);
        draft.clear();
        onBooked({ ...existing, ...patch } as OneToOne);
      } else {
        const answers: Record<string, any> = {};
        questions.forEach(q => { const v = valueOf(q); if (hasAnswer(v)) answers[q.id] = v; });
        const id = `oto_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        const s: OneToOne = { id, personId, coachId, status: 'requested', date, time, place: place.trim(), requestedById: me.id, initiatedById: me.id,
          requestedAt: now, before: answers, createdAt: Date.now(), updatedAt: Date.now() };
        await setDoc(doc(db, 'one_to_ones', id), s);
        draft.clear();
        onBooked(s);
      }
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className={`${card} space-y-4`}>
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold">{existing ? (existing.status === 'booked' ? 'Change the time' : 'Suggest another time') : 'Book 1-to-1'}</h3>
        <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-ink-soft hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
      </div>
      <DraftBar draft={draft} what="1-to-1 booking" />
      <div className="grid gap-4 sm:grid-cols-2">
        {isCoach && !existing && (
          <div className="sm:col-span-2">
            <label className={label} htmlFor="oto-person">With</label>
            <select id="oto-person" className={input} value={personId} onChange={e => setPersonId(e.target.value)}>
              <option value="">Pick a person</option>
              {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className={label} htmlFor="oto-date">Date</label>
          <input id="oto-date" type="date" className={input} value={date} min={existing ? undefined : todayIso()} onChange={e => setDate(e.target.value)} />
          {date && <p className="mt-1 text-sm text-ink-soft">{dayName(date)}</p>}
        </div>
        <div>
          <label className={label} htmlFor="oto-time">Start time</label>
          <input id="oto-time" type="time" className={input} value={time} onChange={e => setTime(e.target.value)} />
          <p className="mt-1 text-sm text-ink-soft">90 minutes</p>
        </div>
        <div className="sm:col-span-2" aria-live="polite">
          {check.state === 'checking' && <p className="text-sm text-ink-soft"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" />Checking both calendars…</p>}
          {check.state === 'done' && !check.clashes.length && <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm font-semibold text-accent"><Check className="mr-1 inline h-4 w-4" />Free on both calendars</p>}
          {check.state === 'done' && check.clashes.length > 0 && (
            <div className="rounded-lg bg-attention/10 px-3 py-2 text-sm text-ink">
              <p className="font-semibold text-attention">Busy at that time:</p>
              <ul className="mt-1 list-disc pl-5">{check.clashes.map((c, i) => <li key={i}>{c.who}: {c.text}</li>)}</ul>
            </div>
          )}
          {check.state === 'error' && <p className="text-sm text-ink-soft">Couldn’t check the calendars just now. You can still book.</p>}
        </div>
        <div className="sm:col-span-2">
          <label className={label} htmlFor="oto-place">Place of meeting</label>
          <input id="oto-place" className={input} value={place} onChange={e => setPlace(e.target.value)} placeholder="e.g. Office meeting room, a café, Google Meet" />
        </div>
      </div>

      {!existing && questions.length > 0 && personId && (
        <div className="space-y-4 border-t border-line pt-4">
          <div>
            <h4 className="text-base font-bold">Before the meeting</h4>
            <p className="text-sm text-ink-soft">Fill in what you can now; either of you can add to it until you meet.</p>
          </div>
          {questions.map(q => (
            <div key={q.id}>
              <label className={label} htmlFor={`bq-${q.id}`}>{q.text}</label>
              {q.hint && <p className="-mt-1 mb-1.5 text-sm text-ink-soft">{q.hint}</p>}
              <Answer id={`bq-${q.id}`} type={q.type} value={valueOf(q)} editable onChange={v => setBefore(b => ({ ...b, [q.id]: v }))} />
              {q.carry && !(q.id in before) && hasAnswer(prevHeld?.before?.[q.id]) && <p className="mt-1 text-sm text-ink-soft">From the last session. Change it if it has moved on.</p>}
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-sm font-semibold text-danger" role="alert">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={btnPrimary} disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{existing ? 'Send new time' : 'Send booking'}</button>
        <button type="button" className={btnSecondary} onClick={onClose}>Cancel</button>
      </div>
      <p className="text-sm text-ink-soft">The other person is asked to accept. Once accepted it goes on both calendars.</p>
    </form>
  );
}

// ---------- One session ----------
function SessionView({ s, me, all, number, current, nameOf, tasks, rep, month, onBack, flash }: {
  s: OneToOne; me: Viewer; all: OneToOne[]; number: number; current: OtoQuestions; nameOf: (id: string) => string; tasks: any[];
  rep?: Representative; month: string; onBack: () => void; flash: (t: string) => void;
}) {
  const isCoach = me.id === s.coachId;
  const isPerson = me.id === s.personId;
  const other = isCoach ? s.personId : s.coachId;
  // The person running it can switch to "Staff view": exactly what the staff member sees, read only.
  const [asStaff, setAsStaff] = useState(false);
  const preview = isCoach && asStaff;
  const qs = questionsFor(s, current);
  const prev = previousHeld(all, s);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [declineNote, setDeclineNote] = useState('');

  // Typed answers wait here (by field path, e.g. "before.win") and save themselves about 2 seconds after typing.
  const [edits, setEdits] = useState<Record<string, any>>({});
  const auto = useAutoSave({
    value: edits, dirty: Object.keys(edits).length > 0, enabled: true,
    write: async (v) => { await updateDoc(doc(db, 'one_to_ones', s.id), { ...v, updatedAt: Date.now() }); },
    onSaved: (json) => {
      const saved = JSON.parse(json);
      setEdits(cur => Object.fromEntries(Object.entries(cur).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(saved[k]))));
    },
  });
  const valueAt = (stage: string, id: string) => {
    const path = `${stage}.${id}`;
    if (path in edits) return edits[path];
    return (s as any)[stage]?.[id];
  };
  const setAt = (path: string, v: any) => setEdits(e => ({ ...e, [path]: v }));
  const actions: OtoAction[] = 'actions' in edits ? edits.actions : (s.actions || []);

  // Carried answers (e.g. the 1-year goal) start from the last session until changed.
  const carried = (q: OtoQuestion) => (q.carry && prev ? prev.before?.[q.id] : undefined);

  // Either of the two fills in any part (Joel, 2026-10-25): Before at any time, During once booked, After once held.
  const canEdit = (stage: OtoStage) => {
    if (preview || s.status === 'declined' || s.status === 'cancelled') return false;
    if (stage === 'during') return s.status === 'booked' || s.status === 'held';
    if (stage === 'before') return true;
    return s.status === 'held';
  };

  const run = async (patch: Record<string, any>, done?: string) => {
    setError('');
    setBusy(true);
    try {
      await auto.flush();
      await updateDoc(doc(db, 'one_to_ones', s.id), { ...patch, updatedAt: Date.now() });
      if (done) flash(done);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };
  const now = () => new Date().toISOString();

  const markHeld = () => {
    if (!window.confirm('Mark this 1-to-1 as held? The questions are kept as they are now, and the staff member is asked to rate it.')) return;
    // Keep the questions as asked, and copy carried answers that weren't changed into this session.
    const before = { ...(s.before || {}) };
    qs.before.forEach(q => { if (!hasAnswer(valueAt('before', q.id)) && hasAnswer(carried(q))) before[q.id] = carried(q); });
    Object.entries(edits).forEach(([k, v]) => { if (k.startsWith('before.')) before[k.slice(7)] = v; });
    const editsLeft = Object.fromEntries(Object.entries(edits).filter(([k]) => !k.startsWith('before.')));
    setEdits(editsLeft);
    run({ ...editsLeft, before, status: 'held', heldAt: now(), questions: qs }, 'Marked as held.');
  };

  const pending = s.status === 'requested';
  const askedByMe = s.requestedById === me.id;

  return (
    <div className="space-y-5 font-sans text-ink">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <button type="button" onClick={async () => { await auto.flush(); onBack(); }} className="mt-1 rounded-lg p-1.5 text-ink-soft hover:bg-surface" aria-label="Back"><ArrowLeft className="h-5 w-5" /></button>
          <div>
            <h2 className="text-2xl font-bold">1-to-1 {number ? `#${number}` : ''} with {nameOf(other)}</h2>
            <p className="mt-1 text-[15px] text-ink-soft">
              {dayName(s.date)}, {formatDate(s.date)} · {time12(s.time)} (90 minutes) · {s.place || 'place not set'}
            </p>
            <p className="text-sm text-ink-soft">Session {number ? `#${number}` : '–'} · asked for by {initiatorOf(s) === me.id && !preview ? 'you' : nameOf(initiatorOf(s))}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isCoach && (
            <span className="inline-flex rounded-lg border border-line p-0.5 text-sm font-semibold" role="group" aria-label="View">
              <button type="button" onClick={() => setAsStaff(false)} className={`rounded-md px-2.5 py-1 ${!asStaff ? 'bg-accent-soft text-accent' : 'text-ink-soft'}`}>My view</button>
              <button type="button" onClick={async () => { await auto.flush(); setAsStaff(true); }} className={`rounded-md px-2.5 py-1 ${asStaff ? 'bg-accent-soft text-accent' : 'text-ink-soft'}`}>Staff view</button>
            </span>
          )}
          <SaveState state={auto.state} />
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_TONE[s.status]}`}>{STATUS_LABELS[s.status]}</span>
        </div>
      </div>

      {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm font-semibold text-danger" role="alert">{error}</p>}
      {preview && <p className="rounded-lg bg-surface px-3 py-2 text-sm font-semibold text-ink-soft">Staff view: what {nameOf(s.personId)} sees. Read only.</p>}

      {/* Booking */}
      {pending && !preview && (
        <section className={`${card} border-attention/40`}>
          {askedByMe ? (
            <p className="text-[15px]">Waiting for {nameOf(other)} to accept this time.</p>
          ) : (
            <p className="text-[15px]"><b>{nameOf(s.requestedById)}</b> asked for this 1-to-1. Does the time suit you?</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {!askedByMe && <button type="button" className={btnPrimary} disabled={busy} onClick={() => run({ status: 'booked', respondedAt: now() }, 'Accepted. It’s on both calendars.')}><Check className="h-4 w-4" /> Accept</button>}
            {!askedByMe && <button type="button" className={btnSecondary} onClick={() => setChanging(true)}>Suggest another time</button>}
            {!askedByMe && <button type="button" className={btnSecondary} onClick={() => setDeclining(true)}>Decline</button>}
            {askedByMe && <button type="button" className={btnSecondary} onClick={() => setChanging(true)}>Change the time</button>}
            {askedByMe && <button type="button" className={btnSecondary} disabled={busy} onClick={() => window.confirm('Cancel this 1-to-1 request?') && run({ status: 'cancelled', cancelledById: me.id, cancelledAt: now() }, 'Cancelled.')}>Cancel request</button>}
          </div>
          {declining && (
            <div className="mt-3 space-y-2">
              <label className={label} htmlFor="oto-decline">Why? (optional)</label>
              <input id="oto-decline" className={input} value={declineNote} onChange={e => setDeclineNote(e.target.value)} />
              <div className="flex gap-2">
                <button type="button" className={btnPrimary} disabled={busy} onClick={() => run({ status: 'declined', declineNote: declineNote.trim(), respondedAt: now() }, 'Declined.')}>Decline</button>
                <button type="button" className={btnSecondary} onClick={() => setDeclining(false)}>Back</button>
              </div>
            </div>
          )}
        </section>
      )}
      {s.status === 'declined' && <p className={`${card} text-[15px] text-ink-soft`}>Declined{s.declineNote ? `: ${s.declineNote}` : '.'}</p>}
      {s.status === 'cancelled' && <p className={`${card} text-[15px] text-ink-soft`}>Cancelled by {nameOf(s.cancelledById || '')}.</p>}
      {s.status === 'booked' && !preview && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnSecondary} onClick={() => setChanging(true)}>Change the time</button>
          <button type="button" className={btnSecondary} disabled={busy} onClick={() => window.confirm('Cancel this 1-to-1? It comes off both calendars.') && run({ status: 'cancelled', cancelledById: me.id, cancelledAt: now() }, 'Cancelled.')}>Cancel 1-to-1</button>
        </div>
      )}
      {changing && (
        <BookForm me={me} coachId={s.coachId} isCoach={isCoach} people={[]} startPerson={s.personId} sessions={all} existing={s}
          onClose={() => setChanging(false)} onBooked={() => { setChanging(false); flash(`New time sent. ${nameOf(other)} will be asked to accept.`); }} />
      )}

      {s.status !== 'declined' && s.status !== 'cancelled' && (
        <>
          {/* Before */}
          <StageCard stage="before" qs={qs.before} editable={canEdit('before')} valueAt={id => valueAt('before', id)} carried={carried}
            onChange={(id, v) => setAt(`before.${id}`, v)} me={me} nameOf={nameOf} personId={s.personId} coachId={s.coachId}
            note={pending ? 'You can start answering now; the questions are fully open once the time is accepted.' : undefined} />

          {rep && <KpiSnapshot rep={rep} month={month} />}

          {/* Last session's actions */}
          {prev && (prev.actions || []).length > 0 && (
            <section className={card}>
              <h3 className="text-lg font-bold">Last session’s actions</h3>
              <p className="mt-1 text-sm text-ink-soft">From 1-to-1 on {formatDate(prev.date)}. Mark how each one went.</p>
              <ul className="mt-3 space-y-2">
                {(prev.actions || []).map(a => {
                  const task = tasks.find(t => t.id === a.taskId);
                  const rv: ActionReview | undefined = 'review' in edits ? edits.review?.[a.id] : s.review?.[a.id];
                  return (
                    <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
                      <span className="text-[15px]">
                        {a.text} <span className="text-sm text-ink-soft">· {nameOf(a.ownerId)}{a.due ? ` · due ${formatDate(a.due)}` : ''}{task ? ` · To-do: ${task.status === 'Done' ? 'done' : 'not done'}` : ''}</span>
                      </span>
                      <span className="flex gap-1">
                        {(['done', 'progress', 'dropped'] as ActionReview[]).map(k => (
                          <button key={k} type="button" disabled={preview || s.status === 'declined' || s.status === 'cancelled'}
                            onClick={() => setEdits(e => ({ ...e, review: { ...(s.review || {}), ...(e.review || {}), [a.id]: k } }))}
                            className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold disabled:cursor-default ${rv === k ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-soft'}`}>
                            {k === 'done' ? 'Done' : k === 'progress' ? 'In progress' : 'Dropped'}
                          </button>
                        ))}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* During */}
          {(s.status === 'booked' || s.status === 'held') && (
            <StageCard stage="during" qs={qs.during} editable={canEdit('during')} valueAt={id => valueAt('during', id)} carried={() => undefined}
              onChange={(id, v) => setAt(`during.${id}`, v)} me={me} nameOf={nameOf} personId={s.personId} coachId={s.coachId}
              actions={actions} onActions={(list) => setEdits(e => ({ ...e, actions: list }))} sessionId={s.id} tasks={tasks} flash={flash} sessionDate={s.date} />
          )}

          {isCoach && !preview && (s.status === 'booked' || s.status === 'held') && <PrivateNotes sessionId={s.id} />}

          {isCoach && !preview && s.status === 'booked' && (
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className={btnPrimary} disabled={busy} onClick={markHeld}><CheckCircle2 className="h-4 w-4" /> Meeting done</button>
              <span className="text-sm text-ink-soft">Then {nameOf(s.personId)} rates the session and ticks “I agree”.</span>
            </div>
          )}

          {/* After */}
          {s.status === 'held' && (
            <>
              <StageCard stage="after" qs={qs.after} editable={canEdit('after')} valueAt={id => valueAt('after', id)} carried={() => undefined}
                onChange={(id, v) => setAt(`after.${id}`, v)} me={me} nameOf={nameOf} personId={s.personId} coachId={s.coachId} />
              <Ratings key={String(preview)} s={s} me={me} nameOf={nameOf} run={run} busy={busy} preview={preview} />
            </>
          )}
        </>
      )}
    </div>
  );
}

function SaveState({ state }: { state: { status: string; error?: string } }) {
  if (state.status === 'saving') return <span className="text-sm text-ink-soft"><Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />Saving…</span>;
  if (state.status === 'saved') return <span className="text-sm text-ink-soft">Saved</span>;
  if (state.status === 'error') return <span className="text-sm font-semibold text-danger" title={state.error}>Not saved, trying again</span>;
  return null;
}

// ---------- One stage's questions ----------
function StageCard({ stage, qs, editable, valueAt, carried, onChange, me, nameOf, personId, coachId, note, actions, onActions, sessionId, tasks, flash, sessionDate }: {
  stage: OtoStage; qs: OtoQuestion[]; editable: boolean; valueAt: (id: string) => any; carried: (q: OtoQuestion) => any;
  onChange: (id: string, v: any) => void; me: Viewer; nameOf: (id: string) => string; personId: string; coachId: string; note?: string;
  actions?: OtoAction[]; onActions?: (list: OtoAction[]) => void; sessionId?: string; tasks?: any[]; flash?: (t: string) => void; sessionDate?: string;
}) {
  if (!qs.length) return null;
  return (
    <section className={card}>
      <h3 className="text-lg font-bold">{STAGE_LABELS[stage]}</h3>
      <p className="mt-1 text-sm text-ink-soft">{STAGE_WHO[stage]}{!editable ? ' · read only for you' : ''}</p>
      {note && <p className="mt-1 text-sm text-ink-soft">{note}</p>}
      <div className="mt-4 space-y-5">
        {qs.map(q => {
          if (q.type === 'actions') {
            return actions && onActions
              ? <ActionList key={q.id} q={q} list={actions} onChange={onActions} editable={editable} me={me} nameOf={nameOf} personId={personId} coachId={coachId}
                  sessionId={sessionId!} tasks={tasks || []} flash={flash!} sessionDate={sessionDate || ''} />
              : null;
          }
          const v = valueAt(q.id);
          const c = !hasAnswer(v) ? carried(q) : undefined;
          return (
            <div key={q.id}>
              <label className={label} htmlFor={`q-${stage}-${q.id}`}>{q.text}</label>
              {q.hint && <p className="-mt-1 mb-1.5 text-sm text-ink-soft">{q.hint}</p>}
              <Answer id={`q-${stage}-${q.id}`} type={q.type} value={v ?? c ?? ''} editable={editable} onChange={x => onChange(q.id, x)} />
              {hasAnswer(c) && <p className="mt-1 text-sm text-ink-soft">From your last session. Change it if it has moved on.</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Answer({ id, type, value, editable, onChange }: { id: string; type: OtoQType; value: any; editable: boolean; onChange: (v: any) => void }) {
  if (type === 'rating') return <Stars value={Number(value) || 0} onChange={editable ? onChange : undefined} id={id} />;
  if (type === 'yesno') {
    return (
      <div className="flex gap-2" id={id}>
        {['Yes', 'No'].map(o => (
          <button key={o} type="button" disabled={!editable} onClick={() => onChange(o)}
            className={`rounded-lg border px-4 py-1.5 text-sm font-semibold disabled:cursor-default ${value === o ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink'}`}>{o}</button>
        ))}
      </div>
    );
  }
  if (!editable) return <p id={id} className="whitespace-pre-line rounded-lg bg-surface px-3 py-2 text-[15px]">{hasAnswer(value) ? String(value) : <span className="text-ink-soft">Not answered</span>}</p>;
  if (type === 'short') return <input id={id} className={input} value={String(value)} onChange={e => onChange(e.target.value)} />;
  return <textarea id={id} className={`${input} min-h-[5.5rem]`} value={String(value)} onChange={e => onChange(e.target.value)} />;
}

function Stars({ value, onChange, id }: { value: number; onChange?: (v: number) => void; id?: string }) {
  return (
    <div className="flex gap-1" id={id} role="radiogroup">
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button" disabled={!onChange} onClick={() => onChange?.(n)} aria-label={`${n} of 5`} aria-checked={value === n} role="radio"
          className="rounded p-0.5 disabled:cursor-default">
          <Star className={`h-6 w-6 ${n <= value ? 'fill-amber-400 text-amber-400' : 'text-line'}`} />
        </button>
      ))}
    </div>
  );
}

// ---------- Actions (next steps), each can go to the To-do list ----------
function ActionList({ q, list, onChange, editable, me, nameOf, personId, coachId, sessionId, tasks, flash, sessionDate }: {
  q: OtoQuestion; list: OtoAction[]; onChange: (l: OtoAction[]) => void; editable: boolean; me: Viewer; nameOf: (id: string) => string;
  personId: string; coachId: string; sessionId: string; tasks: any[]; flash: (t: string) => void; sessionDate: string;
}) {
  const [error, setError] = useState('');
  const set = (id: string, patch: Partial<OtoAction>) => onChange(list.map(a => (a.id === id ? { ...a, ...patch } : a)));
  const toTodo = async (a: OtoAction) => {
    setError('');
    if (!a.text.trim()) return setError('Write the action first.');
    const id = `task_${Date.now()}`;
    try {
      await setDoc(doc(db, 'tasks', id), {
        id, detail: a.text.trim(), dateline: a.due || '', status: 'Not done',
        assignedById: me.id, assignedBy: me.name, assignedToId: a.ownerId, assignedTo: nameOf(a.ownerId), assignedToIds: [a.ownerId],
        dateCreated: todayIso(), createdAt: Date.now(), ownerRepId: a.ownerId,
        source: '121', oneToOneId: sessionId, meetingDate: sessionDate,
      });
      set(a.id, { taskId: id });
      flash(`Sent to ${a.ownerId === me.id ? 'your' : `${nameOf(a.ownerId)}’s`} To-do list.`);
    } catch (err) {
      setError(friendlyError(err));
    }
  };
  return (
    <div>
      <p className={label}>{q.text}</p>
      {list.length === 0 && !editable && <p className="text-[15px] text-ink-soft">None yet.</p>}
      <ul className="space-y-2">
        {list.map(a => {
          const task = tasks.find(t => t.id === a.taskId);
          return (
            <li key={a.id} className="rounded-lg border border-line p-3">
              {editable ? (
                <div className="grid gap-2 sm:grid-cols-[1fr_10rem_10rem_auto]">
                  <input className={input} value={a.text} onChange={e => set(a.id, { text: e.target.value })} placeholder="What will be done" aria-label="Action" />
                  <select className={input} value={a.ownerId} onChange={e => set(a.id, { ownerId: e.target.value })} aria-label="Who">
                    <option value={personId}>{nameOf(personId)}</option>
                    <option value={coachId}>{nameOf(coachId)}</option>
                  </select>
                  <input type="date" className={input} value={a.due || ''} onChange={e => set(a.id, { due: e.target.value })} aria-label="Due" />
                  <button type="button" onClick={() => onChange(list.filter(x => x.id !== a.id))} className="rounded-lg p-2 text-ink-soft hover:bg-surface hover:text-danger" aria-label="Remove action"><Trash2 className="h-4 w-4" /></button>
                </div>
              ) : (
                <p className="text-[15px]">{a.text} <span className="text-sm text-ink-soft">· {nameOf(a.ownerId)}{a.due ? ` · due ${formatDate(a.due)}` : ''}</span></p>
              )}
              <div className="mt-2 text-sm">
                {a.taskId
                  ? <span className={task?.status === 'Done' ? 'font-semibold text-accent' : 'text-ink-soft'}>{task?.status === 'Done' ? <CheckCircle2 className="mr-1 inline h-4 w-4" /> : <Circle className="mr-1 inline h-4 w-4" />}On {nameOf(a.ownerId)}’s To-do{task?.status === 'Done' ? ', done' : ''}</span>
                  : editable && <button type="button" className="font-semibold text-accent hover:underline" onClick={() => toTodo(a)}>→ To-do</button>}
              </div>
            </li>
          );
        })}
      </ul>
      {editable && (
        <button type="button" className={`${btnSecondary} mt-2`} onClick={() => onChange([...list, { id: `a_${Date.now().toString(36)}`, text: '', ownerId: personId, due: '' }])}>
          <Plus className="h-4 w-4" /> Add action
        </button>
      )}
      {error && <p className="mt-2 text-sm font-semibold text-danger" role="alert">{error}</p>}
    </div>
  );
}

// ---------- The coach's private notes (never seen by the staff member) ----------
function PrivateNotes({ sessionId }: { sessionId: string }) {
  const [notes, setNotes] = useState('');
  const [saved, setSaved] = useState('');
  const loadedRef = useRef(false);
  useEffect(() => onSnapshot(doc(db, 'one_to_one_private', sessionId), d => {
    const v = String(d.data()?.notes || '');
    setSaved(v);
    if (!loadedRef.current) { setNotes(v); loadedRef.current = true; }
  }, () => {}), [sessionId]);
  const auto = useAutoSave({
    value: notes, dirty: loadedRef.current && notes !== saved, enabled: true,
    write: async (v) => { await setDoc(doc(db, 'one_to_one_private', sessionId), { notes: v, updatedAt: Date.now() }, { merge: true }); },
    onSaved: (json) => setSaved(JSON.parse(json)),
  });
  return (
    <section className={`${card} border-dashed`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-lg font-bold"><Lock className="h-4 w-4" /> Your private notes</h3>
        <SaveState state={auto.state} />
      </div>
      <p className="mt-1 text-sm text-ink-soft">Only you can see these.</p>
      <textarea className={`${input} mt-3 min-h-[6rem]`} value={notes} onChange={e => setNotes(e.target.value)} aria-label="Private notes" />
    </section>
  );
}

// ---------- Ratings and "I agree" ----------
function Ratings({ s, me, nameOf, run, busy, preview }: {
  s: OneToOne; me: Viewer; nameOf: (id: string) => string; run: (patch: Record<string, any>, done?: string) => Promise<void>; busy: boolean;
  preview?: boolean;   // the coach's "Staff view": the staff member's side, read only
}) {
  const isCoach = me.id === s.coachId && !preview;
  const isPerson = me.id === s.personId || !!preview;
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [agreeNote, setAgreeNote] = useState('');
  const [coachRating, setCoachRating] = useState<{ rating?: number; comment?: string } | null>(null);
  const [coachStars, setCoachStars] = useState(0);
  const [coachComment, setCoachComment] = useState('');
  const [error, setError] = useState('');
  // The coach's rating: the coach always; the staff member only once they have rated (the rules check it too).
  const canSeeCoach = me.id === s.coachId || (isPerson && !!s.staffRating);
  useEffect(() => {
    if (!canSeeCoach) return;
    return onSnapshot(doc(db, 'one_to_one_ratings', s.id), d => {
      const v: any = d.data() || null;
      setCoachRating(v);
      if (isCoach && v) { setCoachStars(Number(v.rating) || 0); setCoachComment(String(v.comment || '')); }
    }, () => setCoachRating(null));
  }, [s.id, canSeeCoach, isCoach]);

  const saveCoach = async () => {
    setError('');
    if (!coachStars) return setError('Pick 1 to 5 stars.');
    try {
      await setDoc(doc(db, 'one_to_one_ratings', s.id), { rating: coachStars, comment: coachComment.trim(), at: new Date().toISOString() });
    } catch (err) { setError(friendlyError(err)); }
  };

  return (
    <section className={card}>
      <h3 className="text-lg font-bold">Rating the session</h3>
      <div className="mt-4 grid gap-5 md:grid-cols-2">
        <div>
          <p className={label}>{isPerson ? 'Your rating' : `${nameOf(s.personId)}’s rating`}</p>
          {s.staffRating ? (
            <>
              <Stars value={s.staffRating} />
              {s.staffComment && <p className="mt-1 whitespace-pre-line text-[15px]">{s.staffComment}</p>}
            </>
          ) : isPerson && !preview ? (
            <div className="space-y-2">
              <Stars value={stars} onChange={setStars} />
              <textarea className={`${input} min-h-[4rem]`} value={comment} onChange={e => setComment(e.target.value)} placeholder="Anything to add? (optional)" aria-label="Your comment" />
              <button type="button" className={btnPrimary} disabled={busy || !stars}
                onClick={() => run({ staffRating: stars, staffComment: comment.trim(), staffRatedAt: new Date().toISOString() }, 'Thanks for rating.')}>Save rating</button>
            </div>
          ) : <p className="text-[15px] text-ink-soft">Not rated yet.</p>}
        </div>
        <div>
          <p className={label}>{isCoach ? 'Your rating' : `${nameOf(s.coachId)}’s rating`}</p>
          {isCoach ? (
            <div className="space-y-2">
              <Stars value={coachStars} onChange={setCoachStars} />
              <textarea className={`${input} min-h-[4rem]`} value={coachComment} onChange={e => setCoachComment(e.target.value)} placeholder="Anything to add? (optional)" aria-label="Your comment" />
              <button type="button" className={btnPrimary} onClick={saveCoach}>{coachRating?.rating ? 'Update rating' : 'Save rating'}</button>
              <p className="text-sm text-ink-soft">{nameOf(s.personId)} sees it after giving their own.</p>
            </div>
          ) : !s.staffRating ? (
            <p className="text-[15px] text-ink-soft">You’ll see it once you’ve rated.</p>
          ) : coachRating?.rating ? (
            <>
              <Stars value={Number(coachRating.rating)} />
              {coachRating.comment && <p className="mt-1 whitespace-pre-line text-[15px]">{coachRating.comment}</p>}
            </>
          ) : <p className="text-[15px] text-ink-soft">Not rated yet.</p>}
        </div>
      </div>

      <div className="mt-5 border-t border-line pt-4">
        {s.agreedAt ? (
          <p className="text-[15px]"><CheckCircle2 className="mr-1 inline h-4 w-4 text-accent" />{isPerson ? 'You' : nameOf(s.personId)} agreed this is a fair record ({formatDate(s.agreedAt.slice(0, 10))}).{s.agreeComment ? ` Comment: ${s.agreeComment}` : ''}</p>
        ) : isPerson && !preview ? (
          <div className="space-y-2">
            <textarea className={`${input} min-h-[3.5rem]`} value={agreeNote} onChange={e => setAgreeNote(e.target.value)} placeholder="Anything you don't agree with? (optional)" aria-label="Comment on the record" />
            <button type="button" className={btnPrimary} disabled={busy} onClick={() => run({ agreedAt: new Date().toISOString(), agreeComment: agreeNote.trim() }, 'Thanks.')}>
              <Check className="h-4 w-4" /> I agree this is a fair record
            </button>
          </div>
        ) : <p className="text-[15px] text-ink-soft">{nameOf(s.personId)} hasn’t ticked “I agree” yet.</p>}
      </div>
      {error && <p className="mt-2 text-sm font-semibold text-danger" role="alert">{error}</p>}
    </section>
  );
}

// ---------- This month's KPIs, counted (never typed) ----------
function KpiSnapshot({ rep, month }: { rep: Representative; month: string }) {
  const [deals, setDeals] = useState<any[]>([]);
  useEffect(() => onSnapshot(query(collection(db, 'pipelines')), s => setDeals(withoutDeleted(linkedOnly(s.docs.map(d => ({ ...d.data(), id: d.id }))))), () => setDeals([])), []);
  const sources = useKpiSources({ months: [month], people: [rep] });
  if (rep.noKpis) return null;
  const { rows, score } = monthKpi(rep, deals, month, sources);
  if (!rows.length) return null;
  return (
    <section className={card}>
      <h3 className="text-lg font-bold">KPIs this month <span className="text-[15px] font-semibold text-ink-soft">· score {Math.round(score)}%</span></h3>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {rows.map(r => (
          <li key={r.m.key} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-[15px]">
            <span>{r.m.label}</span>
            <span className={`font-semibold ${r.light === 'green' ? 'text-accent' : r.light === 'amber' ? 'text-attention' : r.light === 'red' ? 'text-danger' : 'text-ink-soft'}`}>
              {r.hasData ? kpiValueText(r.m, r.total, formatRM) : '–'}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------- Settings: the questions (the owner always runs 1-to-1s) ----------
function SettingsView({ coachId, questions, isOwner, isCoach, onBack }: {
  coachId: string; questions: OtoQuestions; isOwner: boolean; isCoach: boolean; onBack: () => void;
}) {
  const [qs, setQs] = useState<OtoQuestions>(questions);
  const [savedJson, setSavedJson] = useState(JSON.stringify(questions));
  const canEditQs = isCoach || isOwner;
  const auto = useAutoSave({
    value: qs, dirty: JSON.stringify(qs) !== savedJson, enabled: canEditQs && !!coachId,
    write: async (v) => { await setDoc(doc(db, 'config', 'one_to_one'), { questions: clean(v), updatedAt: Date.now() }, { merge: true }); },
    onSaved: setSavedJson,
  });
  const setStage = (st: OtoStage, list: OtoQuestion[]) => setQs(q => ({ ...q, [st]: list }));

  return (
    <div className="space-y-5 font-sans text-ink">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button type="button" onClick={async () => { await auto.flush(); onBack(); }} className="rounded-lg p-1.5 text-ink-soft hover:bg-surface" aria-label="Back"><ArrowLeft className="h-5 w-5" /></button>
          <h2 className="text-2xl font-bold">1-to-1 settings</h2>
        </div>
        <SaveState state={auto.state} />
      </div>

      {canEditQs && coachId && (['before', 'during', 'after'] as OtoStage[]).map(st => (
        <QuestionEditor key={st} stage={st} list={qs[st]} onChange={l => setStage(st, l)} />
      ))}
      {canEditQs && coachId && <p className="text-sm text-ink-soft">Changes save themselves. Sessions already held keep the questions they were asked with.</p>}
    </div>
  );
}

function QuestionEditor({ stage, list, onChange }: { stage: OtoStage; list: OtoQuestion[]; onChange: (l: OtoQuestion[]) => void }) {
  const set = (id: string, patch: Partial<OtoQuestion>) => onChange(list.map(q => (q.id === id ? { ...q, ...patch } : q)));
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const types = (Object.keys(TYPE_LABELS) as OtoQType[]).filter(t => stage === 'during' || t !== 'actions');
  return (
    <section className={card}>
      <h3 className="text-lg font-bold">{STAGE_LABELS[stage]}</h3>
      <p className="mt-1 text-sm text-ink-soft">{STAGE_WHO[stage]}.</p>
      <ul className="mt-3 space-y-2">
        {list.map((q, i) => (
          <li key={q.id} className="rounded-lg border border-line p-3">
            <div className="grid gap-2 sm:grid-cols-[1fr_14rem_auto]">
              <input className={input} value={q.text} onChange={e => set(q.id, { text: e.target.value })} aria-label="Question" placeholder="The question" />
              <select className={input} value={q.type} onChange={e => set(q.id, { type: e.target.value as OtoQType })} aria-label="Answer type">
                {types.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
              </select>
              <span className="flex items-center gap-1">
                <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="rounded p-1.5 text-ink-soft hover:bg-surface disabled:opacity-30" aria-label="Move up"><ArrowUp className="h-4 w-4" /></button>
                <button type="button" disabled={i === list.length - 1} onClick={() => move(i, 1)} className="rounded p-1.5 text-ink-soft hover:bg-surface disabled:opacity-30" aria-label="Move down"><ArrowDown className="h-4 w-4" /></button>
                <button type="button" onClick={() => window.confirm('Remove this question? Sessions already held keep it.') && onChange(list.filter(x => x.id !== q.id))}
                  className="rounded p-1.5 text-ink-soft hover:bg-surface hover:text-danger" aria-label="Remove question"><Trash2 className="h-4 w-4" /></button>
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-4">
              <input className={`${input} max-w-md text-sm`} value={q.hint || ''} onChange={e => set(q.id, { hint: e.target.value || undefined })} placeholder="Help text (optional)" aria-label="Help text" />
              {stage === 'before' && q.type !== 'actions' && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!!q.carry} onChange={e => set(q.id, { carry: e.target.checked || undefined })} className="h-4 w-4 accent-[#0E6E62]" />
                  Copy the last answer into the next session
                </label>
              )}
            </div>
          </li>
        ))}
      </ul>
      <button type="button" className={`${btnSecondary} mt-3`} onClick={() => onChange([...list, { id: newQuestionId(), text: '', type: 'long' }])}><Plus className="h-4 w-4" /> Add question</button>
    </section>
  );
}

// ---------- Profile: getting to know the person (they and the person running 1-to-1s fill it in) ----------
function ProfileView({ memberId, name, me, isCoach, onBack }: { memberId: string; name: string; me: Viewer; isCoach: boolean; onBack: () => void }) {
  const today = todayIso();
  const [p, setP] = useState<Record<string, any>>({});
  const [savedJson, setSavedJson] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [savedNotes, setSavedNotes] = useState<string | null>(null);
  const [error, setError] = useState('');
  const firstLoad = useRef({ profile: false, notes: false });   // fill the boxes once; later saves don't overwrite typing
  useEffect(() => onSnapshot(doc(db, 'staff_profiles', memberId), d => {
    const v = (d.data() || {}) as Record<string, any>;
    delete v.updatedAt; delete v.updatedById;
    if (!firstLoad.current.profile) { firstLoad.current.profile = true; setP(v); }
    setSavedJson(JSON.stringify(v));
  }, e => setError(friendlyError(e))), [memberId]);
  useEffect(() => {
    if (!isCoach) return;
    return onSnapshot(doc(db, 'staff_profile_notes', memberId), d => {
      const v = String(d.data()?.notes || '');
      if (!firstLoad.current.notes) { firstLoad.current.notes = true; setNotes(v); }
      setSavedNotes(v);
    }, () => {});
  }, [memberId, isCoach]);
  const auto = useAutoSave({
    value: p, dirty: savedJson !== null && JSON.stringify(p) !== savedJson, enabled: savedJson !== null,
    write: async (v) => { await setDoc(doc(db, 'staff_profiles', memberId), { ...clean(v), updatedAt: Date.now(), updatedById: me.id }); },
    onSaved: setSavedJson,
  });
  const notesAuto = useAutoSave({
    value: notes, dirty: isCoach && savedNotes !== null && notes !== savedNotes, enabled: isCoach && savedNotes !== null,
    write: async (v) => { await setDoc(doc(db, 'staff_profile_notes', memberId), { notes: v, updatedAt: Date.now() }); },
    onSaved: (json) => setSavedNotes(JSON.parse(json)),
  });
  const set = (id: string, v: any) => setP(cur => ({ ...cur, [id]: v }));
  const dates: ImportantDate[] = Array.isArray(p.dates) ? p.dates : [];
  const age = ageOf(p.birthday, today);
  const since = sinceText(p.joined, today);
  const coming = upcomingDates(p, today, 30);
  const mine = me.id === memberId;

  return (
    <div className="space-y-5 font-sans text-ink">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button type="button" onClick={async () => { await auto.flush(); await notesAuto.flush(); onBack(); }} className="rounded-lg p-1.5 text-ink-soft hover:bg-surface" aria-label="Back"><ArrowLeft className="h-5 w-5" /></button>
          <div>
            <h2 className="text-2xl font-bold">{mine ? 'My profile' : `${name}’s profile`}</h2>
            <p className="text-sm text-ink-soft">{mine ? 'Helps your 1-to-1s. Only you and the person running them see it.' : `${name} can see and add to this. Your notes at the bottom are only for you.`}</p>
          </div>
        </div>
        <SaveState state={auto.state} />
      </div>
      {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm font-semibold text-danger" role="alert">{error}</p>}

      {(age !== null || since || coming.length > 0) && (
        <section className={`${card} flex flex-wrap gap-x-8 gap-y-2 text-[15px]`}>
          {age !== null && <span><b>Age</b> {age}</span>}
          {since && <span><b>With the company</b> {since}</span>}
          {coming.length > 0 && <span><b>Coming up</b> {coming.map(c => `${c.label} ${c.inDays === 0 ? 'today' : `in ${c.inDays} day${c.inDays === 1 ? '' : 's'}`}`).join(' · ')}</span>}
        </section>
      )}

      {PROFILE_FIELDS.map(group => (
        <section key={group.title} className={card}>
          <h3 className="text-lg font-bold">{group.title}</h3>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {group.fields.map(f => (
              <div key={f.id} className={f.type === 'long' ? 'md:col-span-2' : ''}>
                <label className={label} htmlFor={`pf-${f.id}`}>{f.label}</label>
                {f.hint && <p className="-mt-1 mb-1.5 text-sm text-ink-soft">{f.hint}</p>}
                {f.type === 'date'
                  ? <input id={`pf-${f.id}`} type="date" className={input} value={p[f.id] || ''} onChange={e => set(f.id, e.target.value)} />
                  : f.type === 'short'
                    ? <input id={`pf-${f.id}`} className={input} value={p[f.id] || ''} onChange={e => set(f.id, e.target.value)} />
                    : <textarea id={`pf-${f.id}`} className={`${input} min-h-[4.5rem]`} value={p[f.id] || ''} onChange={e => set(f.id, e.target.value)} />}
              </div>
            ))}
          </div>
        </section>
      ))}

      <section className={card}>
        <h3 className="text-lg font-bold">Important dates</h3>
        <p className="mt-1 text-sm text-ink-soft">Children’s birthdays, wedding anniversary… A reminder shows a week before. Birthday and joining date remind too.</p>
        <ul className="mt-3 space-y-2">
          {dates.map(d => (
            <li key={d.id} className="grid gap-2 sm:grid-cols-[1fr_12rem_auto]">
              <input className={input} value={d.label} placeholder="What" aria-label="What" onChange={e => set('dates', dates.map(x => (x.id === d.id ? { ...x, label: e.target.value } : x)))} />
              <input type="date" className={input} value={d.date} aria-label="Date" onChange={e => set('dates', dates.map(x => (x.id === d.id ? { ...x, date: e.target.value } : x)))} />
              <button type="button" onClick={() => set('dates', dates.filter(x => x.id !== d.id))} className="rounded-lg p-2 text-ink-soft hover:bg-surface hover:text-danger" aria-label="Remove date"><Trash2 className="h-4 w-4" /></button>
            </li>
          ))}
        </ul>
        <button type="button" className={`${btnSecondary} mt-3`} onClick={() => set('dates', [...dates, { id: `d_${Date.now().toString(36)}`, label: '', date: '' }])}><Plus className="h-4 w-4" /> Add date</button>
      </section>

      {isCoach && !mine && (
        <section className={`${card} border-dashed`}>
          <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-lg font-bold"><Lock className="h-4 w-4" /> Your notes</h3>
            <SaveState state={notesAuto.state} />
          </div>
          <p className="mt-1 text-sm text-ink-soft">Only you can see these.</p>
          <textarea className={`${input} mt-3 min-h-[8rem]`} value={notes} onChange={e => setNotes(e.target.value)} aria-label="Your notes" />
        </section>
      )}
    </div>
  );
}
