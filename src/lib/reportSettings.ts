// Training report settings (Joel, 2026-10-27: "Training report setting page. Preview. Set questions. Only viewable by
// managers"). Management sets, in Trainers → Training reports → Settings, what the report asks:
//   - each built-in section: on or off, its wording (title and hint), required or optional, and whether it goes on
//     HR's copy and on the HOD's copy by default (Management can still tick or untick it on each report);
//   - their own questions (short or long answer, 1 to 5 stars, yes / no, pick one), each with the same choices;
//   - the questions of the 30-day check-in link sent to the participants' head of department (HOD).
// Attendance and Objectives are always on and always required (the HRDC claim relies on them).
// "Back to default" clears it all (Joel's original list of 2026-10-21 plus the 2026-10-27 additions).
// config/training_report: Management only (firestore.rules). Shared by the CRM, the portal and the server; pure.

import type { TrainingReport } from './trainingReport';

export type SectionKey =
  | 'summary' | 'attendance' | 'hours' | 'topics' | 'objectives' | 'scores' | 'participant' | 'observations' | 'personNotes'
  | 'outstanding' | 'attention' | 'actions' | 'hodTips' | 'followUps' | 'photos'
  | 'trainerStars' | 'time' | 'missing' | 'review' | 'issues' | 'leads';

export type CopyKind = 'hr' | 'hod';

export interface SectionDef {
  key: SectionKey;
  label: string;
  hint: string;
  group: 'main' | 'internal';   // internal = "For NEXT Academy only" (on HR's / HOD's copy only when ticked)
  locked?: boolean;             // always on and required
  canRequire: boolean;
  required: boolean;            // the default
  hr: boolean;                  // on HR's copy by default
  hod: boolean;                 // on the HOD's copy by default
  team?: boolean;               // typed by Admin or Management, not the trainer
}

// The order the trainer fills them in and the copies print them.
export const SECTIONS: SectionDef[] = [
  { key: 'summary', label: 'Summary', hint: '3 or 4 lines: what was covered, how the group did, and the one thing their manager should know. Busy managers read only this.', group: 'main', canRequire: true, required: true, hr: true, hod: true },
  { key: 'attendance', label: 'Attendance', hint: "Who wasn't there, day by day. The number absent and the attendance rate are counted for you.", group: 'main', locked: true, canRequire: false, required: true, hr: true, hod: true },
  { key: 'hours', label: 'Training hours and certificates', hint: 'Total training hours and the number of certificates given out (for HR\'s HRDC records).', group: 'main', canRequire: true, required: false, hr: true, hod: false },
  { key: 'topics', label: 'Topics covered', hint: 'The main topics, one per line. They start from the course outline.', group: 'main', canRequire: true, required: false, hr: true, hod: true },
  { key: 'objectives', label: 'Did we achieve the agreed objectives?', hint: 'Rate each objective from 1 to 5 stars and say why.', group: 'main', locked: true, canRequire: false, required: true, hr: true, hod: true },
  { key: 'scores', label: 'Before and after test scores', hint: "Each participant's score before and after the training. The class averages and improvement are counted for you.", group: 'main', canRequire: true, required: false, hr: true, hod: true },
  { key: 'participant', label: "Participants' rating", hint: 'From the Output assessment. Typed by Admin or Management.', group: 'main', canRequire: false, required: false, hr: true, hod: true, team: true },
  { key: 'observations', label: "Trainer's observations", hint: 'How the group took part, what they did well, where they still have gaps.', group: 'main', canRequire: true, required: true, hr: true, hod: true },
  { key: 'personNotes', label: 'Notes on each participant', hint: 'One line each: their strengths and what to work on next. Keep it factual and kind.', group: 'main', canRequire: true, required: false, hr: true, hod: true },
  { key: 'outstanding', label: 'Outstanding participants', hint: 'Anyone who stood out. Add as many as you like.', group: 'main', canRequire: true, required: false, hr: true, hod: true },
  { key: 'attention', label: 'Participants who may need special attention', hint: 'Keep it factual and kind: HR will read this about their own staff.', group: 'main', canRequire: true, required: false, hr: true, hod: true },
  { key: 'actions', label: 'Action plan: what they will apply at work', hint: 'The 2 or 3 things participants committed to use at work in the next 30 days.', group: 'main', canRequire: true, required: false, hr: true, hod: true },
  { key: 'hodTips', label: 'How the head of department can help', hint: '2 or 3 practical tips, e.g. "Let them lead the next team meeting using the new method."', group: 'main', canRequire: true, required: false, hr: true, hod: true },
  { key: 'followUps', label: 'Recommended follow-up training', hint: 'What this group should do next. Pick from our programmes or type one.', group: 'main', canRequire: true, required: false, hr: true, hod: true },
  { key: 'photos', label: 'Photos', hint: '4 to 6 good photos of the training. Up to 12.', group: 'main', canRequire: false, required: false, hr: true, hod: true },
  { key: 'trainerStars', label: 'Your rating of the training', hint: '', group: 'internal', canRequire: true, required: true, hr: false, hod: false },
  { key: 'time', label: 'Time management', hint: 'Which part ran over or was rushed? (optional)', group: 'internal', canRequire: true, required: true, hr: false, hod: false },
  { key: 'missing', label: 'What was missing', hint: 'Materials, equipment, information, content...', group: 'internal', canRequire: true, required: false, hr: false, hod: false },
  { key: 'review', label: 'Review (went well, do better, start, stop, more)', hint: '', group: 'internal', canRequire: true, required: false, hr: false, hod: false },
  { key: 'issues', label: 'Issues on the day', hint: 'Venue, equipment, food, transport', group: 'internal', canRequire: true, required: false, hr: false, hod: false },
  { key: 'leads', label: 'Sales leads spotted', hint: 'Other departments interested, a manager asking about other courses', group: 'internal', canRequire: true, required: false, hr: false, hod: false },
];
const DEF = new Map(SECTIONS.map(s => [s.key, s]));
export const isSectionKey = (k: string): k is SectionKey => DEF.has(k as SectionKey);

export interface SectionSetting { label?: string; hint?: string; off?: boolean; required?: boolean; hr?: boolean; hod?: boolean }

export type AnswerType = 'short' | 'long' | 'stars' | 'yesno' | 'choice';
export const ANSWER_TYPES: { key: AnswerType; label: string }[] = [
  { key: 'short', label: 'Short answer' },
  { key: 'long', label: 'Long answer' },
  { key: 'stars', label: '1 to 5 stars' },
  { key: 'yesno', label: 'Yes / No' },
  { key: 'choice', label: 'Pick one' },
];

export interface CustomQuestion {
  id: string;
  label: string;
  hint: string;
  type: AnswerType;
  options: string[];   // 'choice' only
  required: boolean;
  internal: boolean;   // in "For NEXT Academy only"
  hr: boolean;         // on HR's copy by default
  hod: boolean;        // on the HOD's copy by default
}

export interface ReportSettings {
  sections: Partial<Record<SectionKey, SectionSetting>>;
  custom: CustomQuestion[];
  checkin: CustomQuestion[] | null;   // null = the default check-in questions
  updatedAt?: string;
  updatedByName?: string;
}

// The 30-day check-in with the head of department (2026-10-27): did the training change anything at work?
export const DEFAULT_CHECKIN: CustomQuestion[] = [
  { id: 'using', label: 'How much are your people using what they learned?', hint: '1 = not at all, 5 = every day', type: 'stars', options: [], required: true, internal: false, hr: false, hod: false },
  { id: 'changes', label: 'What changes have you seen at work since the training?', hint: '', type: 'long', options: [], required: true, internal: false, hr: false, hod: false },
  { id: 'people', label: 'Who is doing well, and who still needs help?', hint: '', type: 'long', options: [], required: false, internal: false, hr: false, hod: false },
  { id: 'more', label: 'Would a follow-up training or coaching session help your team?', hint: '', type: 'yesno', options: [], required: false, internal: false, hr: false, hod: false },
  { id: 'other', label: 'Anything else you would like us to know?', hint: '', type: 'long', options: [], required: false, internal: false, hr: false, hod: false },
];

export const emptySettings = (): ReportSettings => ({ sections: {}, custom: [], checkin: null });

const str = (v: any, max: number) => String(v ?? '').replace(/\u0000/g, '').trim().slice(0, max);
const isId = (v: any) => typeof v === 'string' && /^[a-z0-9_-]{1,40}$/i.test(v);
export const newQuestionId = () => `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function cleanQuestion(q: any): CustomQuestion | null {
  if (!isId(q?.id)) return null;
  const type = (ANSWER_TYPES.some(t => t.key === q?.type) ? q.type : 'short') as AnswerType;
  return {
    id: q.id, label: str(q?.label, 300), hint: str(q?.hint, 500), type,
    options: type === 'choice' ? (Array.isArray(q?.options) ? q.options : []).map((o: any) => str(o, 120)).filter(Boolean).slice(0, 12) : [],
    required: q?.required === true, internal: q?.internal === true, hr: q?.hr === true, hod: q?.hod === true,
  };
}
const cleanQuestions = (v: any) => (Array.isArray(v) ? v : []).map(cleanQuestion).filter((q): q is CustomQuestion => !!q).slice(0, 40);

/** The saved settings (config/training_report), cleaned; anything missing falls back to the defaults. */
export function readReportSettings(raw: any): ReportSettings {
  const sections: ReportSettings['sections'] = {};
  Object.entries(raw?.sections || {}).forEach(([k, v]: [string, any]) => {
    if (!isSectionKey(k) || !v || typeof v !== 'object') return;
    const s: SectionSetting = {};
    if (typeof v.label === 'string' && v.label.trim()) s.label = str(v.label, 200);
    if (typeof v.hint === 'string') s.hint = str(v.hint, 500);
    if (typeof v.off === 'boolean') s.off = v.off;
    if (typeof v.required === 'boolean') s.required = v.required;
    if (typeof v.hr === 'boolean') s.hr = v.hr;
    if (typeof v.hod === 'boolean') s.hod = v.hod;
    sections[k] = s;
  });
  return {
    sections, custom: cleanQuestions(raw?.custom),
    checkin: Array.isArray(raw?.checkin) ? cleanQuestions(raw.checkin) : null,
    ...(raw?.updatedAt ? { updatedAt: str(raw.updatedAt, 40) } : {}),
    ...(raw?.updatedByName ? { updatedByName: str(raw.updatedByName, 120) } : {}),
  };
}

export interface Section extends SectionDef { on: boolean }

/** One built-in section as Management set it (locked ones are always on and required). */
export function sectionOf(s: ReportSettings | null | undefined, key: SectionKey): Section {
  const d = DEF.get(key)!;
  const x = s?.sections?.[key] || {};
  return {
    ...d,
    label: x.label || d.label,
    hint: x.hint ?? d.hint,
    on: d.locked ? true : x.off !== true,
    required: d.locked ? true : d.canRequire ? (x.required ?? d.required) : false,
    hr: x.hr ?? d.hr,
    hod: x.hod ?? d.hod,
  };
}
export const sectionsOf = (s: ReportSettings | null | undefined, group?: 'main' | 'internal') =>
  SECTIONS.filter(d => !group || d.group === group).map(d => sectionOf(s, d.key));
export const sectionOn = (s: ReportSettings | null | undefined, key: SectionKey) => sectionOf(s, key).on;
export const checkinQuestions = (s: ReportSettings | null | undefined) => (s?.checkin?.length ? s.checkin : DEFAULT_CHECKIN);

// ---------- The answers to Management's own questions ----------
// Saved on the report with the question's wording at the time, so a question changed or removed later still prints.
export interface ReportAnswer { id: string; label: string; type: AnswerType; internal: boolean; value: string }

export function cleanAnswerValue(type: AnswerType, v: any, options: string[] = []): string {
  const s = str(v, 3000);
  if (type === 'stars') { const n = Math.round(Number(s) || 0); return n >= 1 && n <= 5 ? String(n) : ''; }
  if (type === 'yesno') return s === 'yes' || s === 'no' ? s : '';
  if (type === 'choice') return options.length && !options.includes(s) ? '' : s.slice(0, 120);
  return type === 'short' ? s.slice(0, 300) : s;
}
export function cleanAnswers(v: any): ReportAnswer[] {
  return (Array.isArray(v) ? v : []).slice(0, 40).map((a: any) => {
    if (!isId(a?.id)) return null;
    const type = (ANSWER_TYPES.some(t => t.key === a?.type) ? a.type : 'short') as AnswerType;
    return { id: a.id, label: str(a?.label, 300), type, internal: a?.internal === true, value: cleanAnswerValue(type, a?.value) };
  }).filter((a): a is ReportAnswer => !!a && !!a.value);
}
export const answerText = (a: Pick<ReportAnswer, 'type' | 'value'>) =>
  a.type === 'stars' ? `${'★'.repeat(Number(a.value) || 0)}${'☆'.repeat(5 - (Number(a.value) || 0))}` : a.type === 'yesno' ? (a.value === 'yes' ? 'Yes' : a.value === 'no' ? 'No' : '') : a.value;

// ---------- HR's and the HOD's copies ----------
// A key is a section key, or "q:<id>" for one of Management's questions. Management's tick on the report wins;
// otherwise the default from the settings (an answer whose question was removed: on unless it was internal).
export type CopyKey = SectionKey | `q:${string}`;
type CopyTicks = Pick<TrainingReport, 'showToHr' | 'showToHod'>;
export function onCopy(r: CopyTicks, copy: CopyKind, key: CopyKey, s: ReportSettings | null | undefined, answer?: Pick<ReportAnswer, 'internal'>): boolean {
  const ticks = (copy === 'hr' ? r.showToHr : r.showToHod) as Record<string, boolean> | undefined;
  if (key.startsWith('q:')) {
    const q = s?.custom.find(x => `q:${x.id}` === key);
    if (typeof ticks?.[key] === 'boolean') return ticks[key];
    if (q) return copy === 'hr' ? q.hr : q.hod;
    return !answer?.internal;
  }
  const sec = sectionOf(s, key as SectionKey);
  if (!sec.on) return false;
  return typeof ticks?.[key] === 'boolean' ? ticks[key] : copy === 'hr' ? sec.hr : sec.hod;
}

// ---------- The preview's example report (made-up people and training) ----------
export function sampleReport(): TrainingReport {
  return {
    dealId: 'preview', trainerId: '', trainerName: 'Trainer name', status: 'checked', registered: 12,
    days: [
      { date: '2026-11-10', absent: ['Participant K'], late: ['Participant C'], note: '' },
      { date: '2026-11-11', absent: [], late: [], note: '' },
    ],
    summary: 'A lively two days. The group now runs a structured weekly huddle and can coach a teammate with the GROW model. Most improved clearly from the pre-test. The one thing to know: they need their supervisor to let them run the huddle themselves.',
    hours: 14, certificates: 12,
    topics: ['Why coaching works', 'The GROW model', 'Asking good questions', 'Running a weekly huddle'],
    objectives: [
      { text: 'Use the GROW model in a coaching conversation', stars: 5, comment: 'Every pair completed two role plays.' },
      { text: 'Run a 15-minute team huddle', stars: 4, comment: 'Most groups kept to time on the second try.' },
    ],
    scores: { outOf: 100, rows: [
      { name: 'Participant A', pre: 45, post: 80 },
      { name: 'Participant B', pre: 60, post: 85 },
      { name: 'Participant C', pre: 50, post: 70 },
    ] },
    observations: 'Engaged and willing to try. Strong in role plays; weaker at summarising agreed actions.',
    personNotes: [
      { name: 'Participant A', strengths: 'Asks sharp questions', improve: 'Let others finish before answering' },
      { name: 'Participant B', strengths: 'Natural facilitator', improve: 'Keep huddles to time' },
    ],
    outstanding: [{ name: 'Participant B', reason: 'Led the group activity and helped quieter teammates.' }],
    attention: [{ name: 'Participant C', reason: 'Would benefit from more practice with open questions.' }],
    actions: ['Hold a 15-minute huddle every Monday', 'Have one GROW coaching chat a week with a teammate'],
    hodTips: ['Join the first huddle, then let them lead', 'Ask each person in your 1-to-1 what they coached that week'],
    followUps: [{ programmeId: '', name: 'Coaching for performance (advanced)', reason: 'For the team leaders, in 3 months' }],
    photos: [], answers: [],
    internal: { trainerStars: 4, missing: '', time: 'on_time', timeNote: '', wentWell: 'Role plays', doBetter: 'Shorter theory slot', start: '', stop: '', more: '', issues: '', leads: 'Their HR asked about a leadership course.' },
    participant: { avg: 4.6, responses: 11, note: 'Practical and fun; would like more examples from their own work.' },
    checkedByName: 'Reviewer name',
  } as TrainingReport;
}
