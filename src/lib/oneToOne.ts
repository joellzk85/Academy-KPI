// 1-to-1 sessions (Joel, 2026-10-25). Everyone has a 90-minute 1-to-1 with the person who runs them (one coach,
// picked in the 1-to-1 tab's Settings by the owner; no names in code) about their work or personal life.
// Collections:
//   config/one_to_one             { coachId, questions: { before, during, after } }: the coach edits the questions.
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
export const STAGE_WHO: Record<OtoStage, string> = {
  before: 'Answered by the staff member', during: 'Answered by the person running the 1-to-1', after: 'Answered by the staff member',
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

export function newQuestionId(): string {
  return `q_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// The questions a session shows: kept on it once held; before that the current ones, plus any already answered
// that were since removed (so an answer is never lost).
export function questionsFor(s: OneToOne, current: OtoQuestions): OtoQuestions {
  if (s.questions) return readQuestions(s.questions);
  const out = {} as OtoQuestions;
  STAGES.forEach(st => {
    const answers = (s as any)[st] || {};
    const gone = Object.keys(answers)
      .filter(k => !current[st].some(q => q.id === k) && hasAnswer(answers[k]))
      .map(k => ({ id: k, text: 'An earlier question (since removed)', type: (typeof answers[k] === 'number' ? 'rating' : 'long') as OtoQType }));
    out[st] = [...current[st], ...gone];
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

// What a staff member may change on their own session (the rules check the same list).
export const STAFF_KEYS = ['status', 'date', 'time', 'place', 'requestedById', 'requestedAt', 'respondedAt', 'declineNote', 'cancelledById', 'cancelledAt',
  'before', 'after', 'staffRating', 'staffComment', 'staffRatedAt', 'agreedAt', 'agreeComment', 'updatedAt'];
