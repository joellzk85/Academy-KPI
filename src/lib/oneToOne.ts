// 1-to-1 sessions (Joel, 2026-10-25). Everyone has a 90-minute 1-to-1 with the person who runs them (one coach,
// picked in the 1-to-1 tab's Settings by the owner; no names in code) about their work or personal life.
// Collections:
//   config/one_to_one             { coachId, questions: { before, during, after }, templates, topics, revisitMonths }: the
//                                 coach edits them. `questions` is the Standard template; `templates` are more sets.
//   one_to_one_questions/{memberId} { templateId?, questions? }: which set this person is asked (Standard when none),
//                                 or their own set. Only the coach writes it; the person reads it (Joel, 2026-10-25).
//   staff_profile_history/{id}    who changed which profile answers, from what to what (one entry per visit).
//   one_to_ones/{id}              the session: booking (date, time, place, status, who asked), answers to the Before
//                                 (staff), During (coach) and After (staff) questions, actions, the staff member's
//                                 rating and "I agree". Only the two people in it read it.
//   one_to_one_private/{id}       the coach's private notes. Coach only, ever.
//   one_to_one_ratings/{id}       the coach's rating of the session. The staff member reads it only after rating.
// Booking: either side asks (status 'requested'); the other accepts ('booked'), suggests another time (still
// 'requested', now asked by them) or declines. Changing a booked time asks again. Booked and held sessions show on
// the CRM calendar of both people and on the shared Google calendar as "1-to-1: <name>" only.

import { CalendarEvent } from '../types';

export type OtoStatus = 'requested' | 'booked' | 'held' | 'declined' | 'cancelled';
export type OtoStage = 'before' | 'during' | 'after';
export type OtoQType = 'short' | 'long' | 'rating' | 'yesno' | 'actions';

export interface OtoQuestion {
  id: string;
  text: string;
  type: OtoQType;
  hint?: string;
  carry?: boolean;          // the last answer is copied into the next session (e.g. 1-year goal)
}

export interface OtoQuestions { before: OtoQuestion[]; during: OtoQuestion[]; after: OtoQuestion[] }

export interface OtoAction {
  id: string;
  text: string;
  ownerId: string;          // the staff member or the coach
  due?: string;             // YYYY-MM-DD
  taskId?: string;          // sent to the To-do list
}

export interface OtoTopic { id: string; text: string; byId: string }

export interface OtoTemplate { id: string; name: string; questions: OtoQuestions }

// Topics offered when booking; the coach edits the list in Settings. Anyone can also type their own.
export const DEFAULT_TOPICS = ['Work and tasks', 'KPIs and results', 'Career and growth', 'Skills and learning', 'Wellbeing', 'Personal life', 'Team and colleagues', 'Feedback (both ways)'];

// A profile not updated for this many months is flagged "Time to revisit" (editable in Settings).
export const DEFAULT_REVISIT_MONTHS = 6;

export type ActionReview = 'done' | 'progress' | 'dropped';

export interface OneToOne {
  id: string;
  personId: string;
  coachId: string;
  status: OtoStatus;
  date: string;             // YYYY-MM-DD
  time: string;             // HH:MM
  place: string;
  requestedById: string;    // who asked for this date and time (the other one accepts)
  initiatedById?: string;   // who first asked for the 1-to-1 (never changes; the "1-to-1s asked for" KPI)
  requestedAt?: string;
  respondedAt?: string;
  declineNote?: string;
  cancelledById?: string;
  cancelledAt?: string;
  before?: Record<string, any>;
  during?: Record<string, any>;
  after?: Record<string, any>;
  actions?: OtoAction[];
  review?: Record<string, ActionReview>;   // last session's actions, by action id
  questions?: OtoQuestions;  // kept when the meeting is marked done, so editing the questions later never changes it
  extra?: OtoQuestions;      // questions the coach added to this session only
  topics?: OtoTopic[];       // what each of them wants to talk about, picked when booking (either can add later)
  heldAt?: string;
  staffRating?: number;
  staffComment?: string;
  staffRatedAt?: string;
  agreedAt?: string;
  agreeComment?: string;
  createdAt?: number;
  updatedAt?: number;
}

export const SESSION_MINUTES = 90;

export const STATUS_LABELS: Record<OtoStatus, string> = {
  requested: 'Waiting to accept', booked: 'Booked', held: 'Held', declined: 'Declined', cancelled: 'Cancelled',
};

export const TYPE_LABELS: Record<OtoQType, string> = {
  short: 'Short answer', long: 'Long answer', rating: 'Rating 1 to 5', yesno: 'Yes / no', actions: 'Action list (can go to To-do)',
};

export const STAGE_LABELS: Record<OtoStage, string> = {
  before: 'Before the meeting', during: 'During the meeting', after: 'After the meeting',
};
// Either of the two fills in any part (Joel, 2026-10-25); only the person running it has private notes.
export const STAGE_WHO: Record<OtoStage, string> = {
  before: 'Filled in before you meet, by either of you', during: 'Filled in during the meeting, by either of you', after: 'Filled in after the meeting, by either of you',
};

// The starting set: Joel's seven questions plus the ones agreed on 2026-10-25. Editable in Settings.
export const DEFAULT_QUESTIONS: OtoQuestions = {
  before: [
    { id: 'mood', text: 'How are you feeling this week?', type: 'rating', hint: '1 = struggling, 5 = great' },
    { id: 'focus', text: 'What is the item we focus on?', type: 'long' },
    { id: 'win', text: 'What did you win?', type: 'long' },
    { id: 'learn', text: 'What did you learn?', type: 'long' },
    { id: 'blockers', text: 'What is slowing you down? (blockers, challenges)', type: 'long' },
    { id: 'help', text: 'What help do you need?', type: 'long' },
    { id: 'goal1', text: 'Your 1-year goal', type: 'long', carry: true },
    { id: 'goal5', text: 'Your 5-year goal', type: 'long', carry: true },
  ],
  during: [
    { id: 'next', text: "What's the next steps / action plan", type: 'actions' },
    { id: 'discussed', text: 'What we talked about', type: 'long' },
  ],
  after: [
    { id: 'feedback', text: 'Feedback for me or the company: what could be better?', type: 'long' },
  ],
};

const STAGES: OtoStage[] = ['before', 'during', 'after'];
const TYPES: OtoQType[] = ['short', 'long', 'rating', 'yesno', 'actions'];

function readList(v: any): OtoQuestion[] | null {
  if (!Array.isArray(v)) return null;
  return v
    .filter(q => q && typeof q.id === 'string' && q.id && typeof q.text === 'string')
    .map(q => ({ id: q.id, text: q.text, type: TYPES.includes(q.type) ? q.type : 'long', ...(q.hint ? { hint: String(q.hint) } : {}), ...(q.carry ? { carry: true } : {}) }));
}

export function readQuestions(v: any): OtoQuestions {
  const out = { ...DEFAULT_QUESTIONS };
  STAGES.forEach(s => { const l = readList(v?.[s]); if (l) out[s] = l; });
  return out;
}

export function readTemplates(v: any): OtoTemplate[] {
  if (!Array.isArray(v)) return [];
  return v.filter(t => t && typeof t.id === 'string' && t.id).map(t => ({ id: t.id, name: String(t.name || 'Untitled'), questions: readQuestions(t.questions) }));
}

export function readTopics(v: any): string[] {
  return Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()) : DEFAULT_TOPICS;
}

// The question set a person is asked: their own set, else the template picked for them, else Standard.
export interface PersonQuestions { templateId?: string; questions?: OtoQuestions }
export function personQuestions(p: PersonQuestions | undefined, standard: OtoQuestions, templates: OtoTemplate[]): OtoQuestions {
  if (p?.questions) return readQuestions(p.questions);
  return templates.find(t => t.id === p?.templateId)?.questions || standard;
}

export function newQuestionId(): string {
  return `q_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// The questions a session shows: kept on it once held; before that the current ones, plus any already answered
// that were since removed (so an answer is never lost).
// The coach's questions for this session only are added at the end of each part.
export function questionsFor(s: OneToOne, current: OtoQuestions): OtoQuestions {
  if (s.questions) return readQuestions(s.questions);
  const extra = s.extra ? readQuestions(s.extra) : null;
  const out = {} as OtoQuestions;
  STAGES.forEach(st => {
    const answers = (s as any)[st] || {};
    const asked = [...current[st], ...(extra && Array.isArray((s.extra as any)?.[st]) ? extra[st] : [])];
    const gone = Object.keys(answers)
      .filter(k => !asked.some(q => q.id === k) && hasAnswer(answers[k]))
      .map(k => ({ id: k, text: 'An earlier question (since removed)', type: (typeof answers[k] === 'number' ? 'rating' : 'long') as OtoQType }));
    out[st] = [...asked, ...gone];
  });
  return out;
}

export function hasAnswer(v: any): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (typeof v === 'number') return v > 0;
  return true;
}

export const isLive = (s: OneToOne) => s.status === 'booked' || s.status === 'held' || s.status === 'requested';
const sortKey = (s: OneToOne) => `${s.date || ''}T${s.time || ''}`;

// Session number, rolling per person: the order of their sessions that are booked or held (requested ones get
// the next number too), by date. Declined and cancelled ones don't count.
export function sessionNumbers(all: OneToOne[]): Record<string, number> {
  const out: Record<string, number> = {};
  const byPerson: Record<string, OneToOne[]> = {};
  all.filter(isLive).forEach(s => { (byPerson[s.personId] = byPerson[s.personId] || []).push(s); });
  Object.values(byPerson).forEach(list => {
    list.sort((a, b) => sortKey(a).localeCompare(sortKey(b)) || (a.createdAt || 0) - (b.createdAt || 0)).forEach((s, i) => { out[s.id] = i + 1; });
  });
  return out;
}

// The held session just before this one for the same person (for "Last session's actions" and carried answers).
export function previousHeld(all: OneToOne[], s: OneToOne): OneToOne | null {
  const list = all
    .filter(x => x.personId === s.personId && x.id !== s.id && x.status === 'held' && sortKey(x) < sortKey(s))
    .sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
  return list[0] || null;
}

// Who has to do something next, in plain words. `me` is the person looking.
export function waitingOn(s: OneToOne, me: string): string {
  if (s.status === 'requested') return s.requestedById === me ? '' : 'Accept or suggest another time';
  if (s.status === 'booked') {
    if (me === s.personId && !Object.values(s.before || {}).some(hasAnswer)) return 'Answer the before-meeting questions';
    return '';
  }
  if (s.status === 'held') {
    if (me === s.personId && !s.staffRating) return 'Rate the session';
    if (me === s.personId && !s.agreedAt) return 'Tick "I agree"';
  }
  return '';
}

export function dayName(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso || '')) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long' });
}

export function time12(t?: string): string {
  if (!t || !/^\d{1,2}:\d{2}/.test(t)) return '';
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

// CRM calendar entries for the sessions the person can see (booked, held and waiting to accept).
export function oneToOneEvents(all: OneToOne[], me: string, nameOf: (id: string) => string): CalendarEvent[] {
  return all
    .filter(s => (s.status === 'booked' || s.status === 'held' || s.status === 'requested') && /^\d{4}-\d{2}-\d{2}/.test(s.date || ''))
    .map(s => {
      const other = me === s.coachId ? nameOf(s.personId) : nameOf(s.coachId);
      return {
        id: `oto_${s.id}`,
        date: s.date.slice(0, 10),
        time: time12(s.time) || 'All day',
        title: `1-to-1${other ? `: ${other}` : ''}${s.status === 'requested' ? ' (waiting to accept)' : ''}`,
        color: 'bg-violet-500',
      };
    });
}

// Held sessions per person by date, for the "1-to-1 sessions held" KPI. Both the staff member and the coach count it.
export function heldDatesByPerson(all: Pick<OneToOne, 'personId' | 'coachId' | 'status' | 'date'>[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  all.forEach(s => {
    if (s.status !== 'held' || !/^\d{4}-\d{2}-\d{2}/.test(s.date || '')) return;
    [s.personId, s.coachId].filter(Boolean).forEach(id => { (out[id] = out[id] || []).push(s.date.slice(0, 10)); });
  });
  return out;
}

// Who first asked for the session (older sessions: whoever asked for the time).
export const initiatorOf = (s: Pick<OneToOne, 'initiatedById' | 'requestedById'>) => s.initiatedById || s.requestedById || '';

// Held sessions the staff member asked for themselves, by date, for the "1-to-1s asked for" KPI.
export function askedDatesByPerson(all: Pick<OneToOne, 'personId' | 'status' | 'date' | 'initiatedById' | 'requestedById'>[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  all.forEach(s => {
    if (s.status !== 'held' || !/^\d{4}-\d{2}-\d{2}/.test(s.date || '') || initiatorOf(s) !== s.personId) return;
    (out[s.personId] = out[s.personId] || []).push(s.date.slice(0, 10));
  });
  return out;
}

// ---------- Calendar check when booking ----------
// Anything already on either person's calendar that day: other 1-to-1s, deal appointments, CRM events they're tagged
// in. `minutes` = how long it lasts (null = all day). Only a plain label goes back to the browser, never details.
export interface BusyItem { who: string; label: string; date: string; time?: string; minutes: number | null }

const toMin = (t?: string): number | null => {
  const m = (t || '').trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  return h > 23 ? null : h * 60 + Number(m[2] || 0);
};
const hhmm = (n: number) => `${((Math.floor(n / 60) + 11) % 12) + 1}:${String(n % 60).padStart(2, '0')} ${n < 720 || n >= 1440 ? 'AM' : 'PM'}`;

export function clashesWith(date: string, time: string, items: BusyItem[], minutes = SESSION_MINUTES): { who: string; text: string }[] {
  const start = toMin(time);
  if (start === null) return [];
  const end = start + minutes;
  return items
    .filter(i => i.date.slice(0, 10) === date)
    .flatMap(i => {
      const s = toMin(i.time);
      if (i.minutes === null || s === null) return [{ who: i.who, text: `${i.label} (all day)` }];
      const e = s + i.minutes;
      return s < end && start < e ? [{ who: i.who, text: `${i.label}, ${hhmm(s)}–${hhmm(e)}` }] : [];
    });
}

// All the words in a session (topics, answers, actions), for searching past 1-to-1s.
export function sessionText(s: OneToOne): string {
  const parts: string[] = (s.topics || []).map(t => t.text);
  (['before', 'during', 'after'] as OtoStage[]).forEach(st => Object.values((s as any)[st] || {}).forEach(v => { if (typeof v === 'string') parts.push(v); }));
  (s.actions || []).forEach(a => parts.push(a.text));
  if (s.staffComment) parts.push(s.staffComment);
  if (s.agreeComment) parts.push(s.agreeComment);
  return parts.join('\n').toLowerCase();
}

// ---------- Profile (get to know them; the staff member and the coach fill it in) ----------
export interface ProfileField { id: string; label: string; type: 'short' | 'long' | 'date'; hint?: string }
export const PROFILE_FIELDS: { title: string; fields: ProfileField[] }[] = [
  { title: 'About', fields: [
    { id: 'joined', label: 'Joined the company', type: 'date' },
    { id: 'birthday', label: 'Birthday', type: 'date' },
    { id: 'hometown', label: 'Hometown', type: 'short' },
    { id: 'family', label: 'Family', type: 'long', hint: 'Partner, children’s names, parents…' },
    { id: 'religion', label: 'Religion and holidays observed', type: 'short' },
    { id: 'food', label: 'Food preferences', type: 'short' },
  ] },
  { title: 'Goals and drive', fields: [
    { id: 'goals', label: 'Personal goals', type: 'long' },
    { id: 'career', label: 'Career dream', type: 'long' },
    { id: 'motivation', label: 'What motivates them', type: 'long' },
    { id: 'strengths', label: 'Strengths', type: 'long' },
    { id: 'stress', label: 'Signs they are stressed', type: 'long' },
  ] },
  { title: 'Rewards and feedback', fields: [
    { id: 'reward', label: 'How they like to be rewarded', type: 'long', hint: 'e.g. time off, a meal, a gift, a bonus, a course' },
    { id: 'recognition', label: 'How they like to be recognised', type: 'short', hint: 'Public praise, private thanks…' },
    { id: 'feedback', label: 'How they like to get feedback', type: 'long' },
  ] },
  { title: 'Interests', fields: [
    { id: 'hobbies', label: 'Hobbies and interests', type: 'long' },
    { id: 'books', label: 'Books they like', type: 'long' },
    { id: 'booksEncouraged', label: 'Books encouraged to read', type: 'long' },
  ] },
];

// What changed between two versions of a profile, by field, for the profile's history.
export interface ProfileChange { field: string; label: string; from: string; to: string }
const datesText = (v: any) => (Array.isArray(v) ? v.filter((d: any) => d?.label || d?.date).map((d: any) => `${d.label || '?'} ${d.date || ''}`.trim()).join('; ') : '');
export function profileChanges(before: Record<string, any>, after: Record<string, any>): ProfileChange[] {
  const out: ProfileChange[] = [];
  PROFILE_FIELDS.forEach(g => g.fields.forEach(f => {
    const a = String(before?.[f.id] ?? ''), b = String(after?.[f.id] ?? '');
    if (a.trim() !== b.trim()) out.push({ field: f.id, label: f.label, from: a, to: b });
  }));
  const a = datesText(before?.dates), b = datesText(after?.dates);
  if (a !== b) out.push({ field: 'dates', label: 'Important dates', from: a, to: b });
  return out;
}

// Months since a time (ms), whole months.
export function monthsSince(ms: number | undefined, now = Date.now()): number | null {
  return ms ? Math.floor((now - ms) / (30.44 * 864e5)) : null;
}

export interface ImportantDate { id: string; label: string; date: string }   // date YYYY-MM-DD (the year is ignored for reminders)

// Whole years and months from a date to today, e.g. "2 years 3 months".
export function sinceText(iso: string, today: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso || '') || iso > today) return '';
  const [y1, m1, d1] = iso.split('-').map(Number);
  const [y2, m2, d2] = today.split('-').map(Number);
  let months = (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
  const y = Math.floor(months / 12); months %= 12;
  return [y ? `${y} year${y === 1 ? '' : 's'}` : '', months ? `${months} month${months === 1 ? '' : 's'}` : ''].filter(Boolean).join(' ') || 'less than a month';
}
export function ageOf(birthday: string, today: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}/.test(birthday || '')) return null;
  const [y1, m1, d1] = birthday.split('-').map(Number);
  const [y2, m2, d2] = today.split('-').map(Number);
  const a = y2 - y1 - (m2 < m1 || (m2 === m1 && d2 < d1) ? 1 : 0);
  return a >= 0 && a < 120 ? a : null;
}

// Birthdays, work anniversaries and other important dates in the next `days` days (each year).
export function upcomingDates(profile: any, today: string, days = 7): { label: string; date: string; inDays: number }[] {
  if (!profile) return [];
  const list: { label: string; date: string }[] = [];
  if (profile.birthday) list.push({ label: 'Birthday', date: profile.birthday });
  if (profile.joined) list.push({ label: 'Work anniversary', date: profile.joined });
  (Array.isArray(profile.dates) ? profile.dates : []).forEach((d: any) => { if (d?.date && d?.label) list.push({ label: String(d.label), date: String(d.date) }); });
  const [ty, tm, td] = today.split('-').map(Number);
  const t0 = Date.UTC(ty, tm - 1, td);
  return list.flatMap(x => {
    if (!/^\d{4}-\d{2}-\d{2}/.test(x.date)) return [];
    const [, m, d] = x.date.split('-').map(Number);
    let next = Date.UTC(ty, m - 1, d);
    if (next < t0) next = Date.UTC(ty + 1, m - 1, d);
    const inDays = Math.round((next - t0) / 864e5);
    return inDays <= days ? [{ label: x.label, date: new Date(next).toISOString().slice(0, 10), inDays }] : [];
  }).sort((a, b) => a.inDays - b.inDays);
}

// What a staff member may change on their own session (the rules check the same list).
export const STAFF_KEYS = ['topics', 'during', 'actions', 'review', 'status', 'date', 'time', 'place', 'requestedById', 'requestedAt', 'respondedAt', 'declineNote', 'cancelledById', 'cancelledAt',
  'before', 'after', 'staffRating', 'staffComment', 'staffRatedAt', 'agreedAt', 'agreeComment', 'updatedAt'];
