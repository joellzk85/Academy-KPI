// Training report (Joel, 2026-10-21: "what is needed in the report page, beneficial to HR"). One report per training,
// written by the trainer in the trainer portal (or by Admin / Management on the deal for a trainer without portal
// access), checked by Admin or Management, then saved as a PDF for the client's HR.
// Shared by the server (serverTrainerPortal.ts), the portal (TrainerPortal.tsx) and the CRM (TrainingReportAdmin.tsx).
// Pure, so it can be tested.
//
// training_reports/{dealId}: one per deal.
//   Trainer's part (the trainer or the team types it): registered, days[] (absent names, late / left early),
//     objectives[] (stars + comment), observations, outstanding[], attention[], followUps[], photos[],
//     internal { trainerStars, missing, time, timeNote, wentWell, doBetter, start, stop, more, issues, leads }
//   Team's part (Admin and Management only): participant { avg, responses, note } (from the Output assessment;
//     reading the file by itself comes later, Joel 2026-10-21: "we will revisit this next time"),
//     showToHr { <internal key>: true } (Management only: an internal section goes on HR's copy when ticked).
//   status: draft → submitted → checked (ready for HR; ticks the deal's "Training report" step), or returned with a note.
// The internal notes are for NEXT Academy only unless Management ticks them for HR (Joel, 2026-10-21).
//
// Later the same day (Joel): the trainer can change the report after sending it; each "Send changes" keeps the date,
// time and what changed (revisions[]). Until they send, the trainer's edits wait in trainerDraft (the team keeps
// seeing what was sent). A checked report that the trainer changes goes back to "submitted" for checking again.
// The number of participants comes from the deal's Participants (typed only when the deal has none).
// Management picks every section on HR's copy (showToHr: the main sections are on unless unticked, the internal
// notes off unless ticked) and can send it to HR as a PDF or a client link (/r/<token>, serverDocLinks.ts).
//
// 2026-10-27 (Joel: "the report had to be beneficial to HR and the HOD"): Management sets the questions in Trainers →
// Training reports → Settings (lib/reportSettings.ts: sections on / off, wording, required, their own questions).
// New sections: summary, training hours and certificates, topics covered, before and after test scores, notes on each
// participant, action plan, how the HOD can help; answers to Management's own questions (answers[]). Two copies:
// HR's (showToHr) and the head of department's (showToHod), each section on or off by default from the settings.
// A 30-day check-in link for the HOD (/c/<token>, serverReportCheckin.ts) saves their answers in checkinAnswer.

import {
  CopyKind, CopyKey, ReportAnswer, ReportSettings, SectionKey, answerText, cleanAnswers, onCopy, sectionOf, sectionsOf,
} from './reportSettings';

export type ReportStatus = 'draft' | 'submitted' | 'returned' | 'checked';
export type TimeKey = '' | 'on_time' | 'ran_over' | 'rushed' | 'finished_early';

export interface ReportDay { date: string; absent: string[]; late: string[]; note: string }
export interface ReportObjective { text: string; stars: number; comment: string }
export interface NamedReason { name: string; reason: string }
export interface FollowUp { programmeId: string; name: string; reason: string }
export interface ReportPhoto { name: string; size: number; type: string; path: string; url: string; at: number }

export interface ReportInternal {
  trainerStars: number;       // the trainer's own rating of the training
  missing: string;            // what was missing
  time: TimeKey;              // time management
  timeNote: string;
  wentWell: string;
  doBetter: string;
  start: string;
  stop: string;
  more: string;
  issues: string;             // venue, equipment, food on the day
  leads: string;              // sales leads spotted (other departments, other courses)
}

export interface ParticipantRating { avg: number; responses: number; note: string; byName?: string; at?: string }
export interface ScoreRow { name: string; pre: number | null; post: number | null }
export interface Scores { outOf: number; rows: ScoreRow[] }
export interface PersonNote { name: string; strengths: string; improve: string }
// The HOD's answers on the 30-day check-in link (server only).
export interface CheckinAnswer { name: string; role: string; at: string; answers: ReportAnswer[] }
export interface CheckinLink { token: string; status: 'open' | 'answered' | 'stopped'; createdAt: string; byName: string }

export interface TrainingReport {
  dealId: string;
  trainerId: string;
  trainerName: string;
  status: ReportStatus;
  registered: number;
  days: ReportDay[];
  objectives: ReportObjective[];
  observations: string;
  outstanding: NamedReason[];
  attention: NamedReason[];
  followUps: FollowUp[];
  photos: ReportPhoto[];
  internal: ReportInternal;
  // 2026-10-27 (older reports may not have these)
  summary?: string;
  hours?: number;
  certificates?: number;
  topics?: string[];
  scores?: Scores;
  personNotes?: PersonNote[];
  actions?: string[];
  hodTips?: string[];
  answers?: ReportAnswer[];
  participant?: ParticipantRating | null;
  showToHr?: Partial<Record<CopyKey, boolean>>;
  showToHod?: Partial<Record<CopyKey, boolean>>;
  checkin?: CheckinLink | null;          // server only
  checkinAnswer?: CheckinAnswer | null;  // server only
  // Only on a copy made by copyOf (HR's or the HOD's): which sections print, with their titles.
  copy?: CopyKind;
  printed?: Partial<Record<SectionKey, { on: boolean; label: string }>>;
  submittedAt?: string;
  submittedByName?: string;
  returnNote?: string;
  returnedByName?: string;
  checkedAt?: string;
  checkedByName?: string;
  updatedAt?: string;
  updatedByName?: string;
  history?: { at: string; byName: string; action: string }[];
  revisions?: Revision[];          // the trainer's changes after first sending (server only)
  trainerDraft?: TrainerPart | null; // the trainer's changes not sent yet (server only)
  hrHeader?: ReportHeaderData;     // the deal details HR's copy shows, saved by the CRM (for the client link)
}

// The trainer's own part of a saved report. For an internal trainer (2026-10-25) only they write it (through the
// server); Admin and Management may change everything else (status, participants' rating, HR's copy), and
// firestore.rules refuses a change to these keys from the CRM.
export const TRAINER_KEYS = ['registered', 'days', 'objectives', 'observations', 'outstanding', 'attention', 'followUps', 'photos', 'internal', 'trainerId', 'trainerName', 'submittedAt', 'submittedByName',
  'summary', 'hours', 'certificates', 'topics', 'scores', 'personNotes', 'actions', 'hodTips', 'answers'] as const;
// Written only by the server (the HOD's check-in link); the CRM never sends them back.
export const SERVER_KEYS = ['trainerDraft', 'revisions', 'checkin', 'checkinAnswer'] as const;

export interface Revision { at: string; byName: string; changes: string[] }
export interface ReportHeaderData { programme: string; client: string; dates: string; venue: string; trainer: string; grantNumber: string }
export type TrainerPart = ReturnType<typeof cleanTrainerPart>;

export const TIME_LABELS: Record<Exclude<TimeKey, ''>, string> = {
  on_time: 'Ran on time',
  ran_over: 'Ran over time',
  rushed: 'Rushed, not enough time',
  finished_early: 'Finished early',
};

export const REVIEW_PARTS: { key: 'wentWell' | 'doBetter' | 'start' | 'stop' | 'more'; label: string; hint: string }[] = [
  { key: 'wentWell', label: 'What went well', hint: 'Keep doing this' },
  { key: 'doBetter', label: 'What can we do better', hint: 'Small fixes for next time' },
  { key: 'start', label: 'Start this', hint: 'Something new to try' },
  { key: 'stop', label: 'Stop this', hint: "Something that didn't work" },
  { key: 'more', label: 'More of this', hint: 'Worked well, do it more' },
];

export const STATUS_TEXT: Record<ReportStatus, string> = {
  draft: 'Being written',
  submitted: 'Sent, waiting for NEXT Academy to check',
  returned: 'Sent back for changes',
  checked: 'Checked, ready for HR',
};

export const emptyInternal = (): ReportInternal => ({ trainerStars: 0, missing: '', time: '', timeNote: '', wentWell: '', doBetter: '', start: '', stop: '', more: '', issues: '', leads: '' });

// ---------- Starting a report from the deal (nothing typed twice) ----------
const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// The training days: back to back from the training date (half days count as a day), as on the T3 form.
export function reportDates(start: string, days: number): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return [];
  return Array.from({ length: Math.min(60, Math.max(1, Math.ceil(Number(days) || 1))) }, (_, i) => addDays(start, i));
}

export interface ReportSeed {
  dates: string[];
  objectives: string[];       // from the deal's course outline (learning outcomes)
  names: string[];            // participants from the T3 name list (HRDC deals), if any
  pax?: number;               // the deal's Participants
  topics?: string[];          // the course outline's module titles (2026-10-27)
}

/** The course outline's module titles, for "Topics covered" (else the first line of each module's topics). */
export function outlineTopics(o: any): string[] {
  return (Array.isArray(o?.items) ? o.items : [])
    .map((m: any) => String(m?.moduleTitle || '').trim() || String(m?.topics || '').split('\n')[0].trim())
    .filter(Boolean).slice(0, 30);
}

/** The deal's number of participants (0 when not given). */
export const dealPax = (deal: any) => Math.max(0, Math.min(10000, Math.round(Number(deal?.participants) || 0)));

/** The number registered always follows the deal's Participants when the deal has one. */
export const withPax = <T extends { registered: number }>(r: T, pax: number): T => (pax > 0 && r.registered !== pax ? { ...r, registered: pax } : r);

export function newReport(dealId: string, trainerId: string, trainerName: string, seed: ReportSeed): TrainingReport {
  return {
    dealId, trainerId, trainerName, status: 'draft',
    registered: seed.pax || seed.names.length,
    days: (seed.dates.length ? seed.dates : ['']).map(date => ({ date, absent: [], late: [], note: '' })),
    objectives: seed.objectives.map(text => ({ text, stars: 0, comment: '' })),
    observations: '', outstanding: [], attention: [], followUps: [], photos: [],
    internal: emptyInternal(),
    summary: '', hours: 0, certificates: 0, topics: seed.topics || [], scores: { outOf: 100, rows: [] },
    personNotes: [], actions: [], hodTips: [], answers: [],
  };
}

// A saved report whose training dates changed since: the days follow the deal, keeping what was typed for a date.
export function withDates(r: TrainingReport, dates: string[]): TrainingReport {
  if (!dates.length || r.days.map(d => d.date).join() === dates.join()) return r;
  return { ...r, days: dates.map((date, i) => r.days.find(d => d.date === date) || (r.days[i] && !dates.includes(r.days[i].date) ? { ...r.days[i], date } : { date, absent: [], late: [], note: '' })) };
}

// ---------- Cleaning what is sent (the server keeps only this) ----------
const str = (v: any, max: number) => String(v ?? '').replace(/\u0000/g, '').trim().slice(0, max);
const names = (v: any, most = 200) => (Array.isArray(v) ? v : []).map(x => str(x, 120)).filter(Boolean).slice(0, most);
const stars = (v: any) => { const n = Math.round(Number(v) || 0); return n >= 1 && n <= 5 ? n : 0; };
const score = (v: any) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Math.min(10000, Math.max(0, Number(v))) * 10) / 10);
const lines = (v: any, most: number, max = 500) => (Array.isArray(v) ? v : []).map(x => str(x, max)).filter(Boolean).slice(0, most);
const pairs = (v: any, most = 50): NamedReason[] =>
  (Array.isArray(v) ? v : []).map((x: any) => ({ name: str(x?.name, 120), reason: str(x?.reason, 1000) })).filter(x => x.name || x.reason).slice(0, most);

/** The trainer's part of a report, cleaned. `photosOk` keeps only photos inside the trainer's own folder. */
export function cleanTrainerPart(d: any, photosOk: (list: any) => ReportPhoto[]) {
  const i = d?.internal || {};
  const time = str(i.time, 20) as TimeKey;
  return {
    registered: Math.max(0, Math.min(10000, Math.round(Number(d?.registered) || 0))),
    days: (Array.isArray(d?.days) ? d.days : []).slice(0, 60).map((x: any) => ({
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(x?.date || '')) ? String(x.date) : '',
      absent: names(x?.absent), late: names(x?.late), note: str(x?.note, 1000),
    })),
    objectives: (Array.isArray(d?.objectives) ? d.objectives : []).slice(0, 40)
      .map((x: any) => ({ text: str(x?.text, 500), stars: stars(x?.stars), comment: str(x?.comment, 2000) })).filter((x: ReportObjective) => x.text),
    observations: str(d?.observations, 5000),
    outstanding: pairs(d?.outstanding),
    attention: pairs(d?.attention),
    followUps: (Array.isArray(d?.followUps) ? d.followUps : []).slice(0, 20)
      .map((x: any) => ({ programmeId: str(x?.programmeId, 80), name: str(x?.name, 200), reason: str(x?.reason, 1000) })).filter((x: FollowUp) => x.name),
    photos: photosOk(d?.photos).slice(0, 12),
    internal: {
      trainerStars: stars(i.trainerStars),
      missing: str(i.missing, 3000),
      time: (time in TIME_LABELS ? time : '') as TimeKey,
      timeNote: str(i.timeNote, 1000),
      wentWell: str(i.wentWell, 2000), doBetter: str(i.doBetter, 2000), start: str(i.start, 2000), stop: str(i.stop, 2000), more: str(i.more, 2000),
      issues: str(i.issues, 2000), leads: str(i.leads, 2000),
    },
    summary: str(d?.summary, 3000),
    hours: Math.round(Math.min(1000, Math.max(0, Number(d?.hours) || 0)) * 2) / 2,
    certificates: Math.round(Math.min(10000, Math.max(0, Number(d?.certificates) || 0))),
    topics: lines(d?.topics, 30),
    scores: {
      outOf: Math.round(Math.min(10000, Math.max(1, Number(d?.scores?.outOf) || 100))),
      rows: (Array.isArray(d?.scores?.rows) ? d.scores.rows : []).slice(0, 300)
        .map((x: any) => ({ name: str(x?.name, 120), pre: score(x?.pre), post: score(x?.post) })).filter((x: ScoreRow) => x.name || x.pre !== null || x.post !== null),
    },
    personNotes: (Array.isArray(d?.personNotes) ? d.personNotes : []).slice(0, 300)
      .map((x: any) => ({ name: str(x?.name, 120), strengths: str(x?.strengths, 1000), improve: str(x?.improve, 1000) })).filter((x: PersonNote) => x.name || x.strengths || x.improve),
    actions: lines(d?.actions, 20),
    hodTips: lines(d?.hodTips, 20),
    answers: cleanAnswers(d?.answers),
  };
}

// Is a section filled in? (for "required" in the settings)
function filled(r: Partial<TrainingReport>, key: SectionKey): boolean {
  const i = r.internal || emptyInternal();
  switch (key) {
    case 'summary': return !!r.summary?.trim();
    case 'hours': return (r.hours || 0) > 0;
    case 'topics': return !!r.topics?.some(t => t.trim());
    case 'scores': return !!r.scores?.rows.some(x => x.post !== null);
    case 'observations': return !!r.observations?.trim();
    case 'personNotes': return !!r.personNotes?.some(x => x.name.trim());
    case 'outstanding': return !!r.outstanding?.some(x => x.name.trim());
    case 'attention': return !!r.attention?.some(x => x.name.trim());
    case 'actions': return !!r.actions?.some(t => t.trim());
    case 'hodTips': return !!r.hodTips?.some(t => t.trim());
    case 'followUps': return !!r.followUps?.some(x => x.name.trim());
    case 'trainerStars': return !!i.trainerStars;
    case 'time': return !!i.time;
    case 'missing': return !!i.missing.trim();
    case 'review': return REVIEW_PARTS.some(p => i[p.key].trim());
    case 'issues': return !!i.issues.trim();
    case 'leads': return !!i.leads.trim();
    default: return true;
  }
}

/** What still has to be filled in before the report can be sent (empty when it's ready), by Management's settings. */
export function reportGaps(r: Pick<TrainingReport, 'registered' | 'days' | 'objectives' | 'observations' | 'internal'> & Partial<TrainingReport>, s?: ReportSettings | null): string[] {
  const out: string[] = [];
  if (!(r.registered > 0)) out.push('How many participants were registered');
  if (!r.objectives.length) out.push('At least one objective');
  else if (r.objectives.some(o => !o.stars)) out.push('A star rating for every objective');
  sectionsOf(s).forEach(x => { if (x.on && x.required && !x.locked && !x.team && !filled(r, x.key)) out.push(x.label); });
  (s?.custom || []).forEach(q => { if (q.required && !r.answers?.some(a => a.id === q.id && a.value)) out.push(q.label || 'One of the questions'); });
  return out;
}

// ---------- Numbers ----------
export const absentCount = (d: ReportDay) => d.absent.length;
export const presentCount = (registered: number, d: ReportDay) => Math.max(0, registered - d.absent.length);
export function attendancePct(r: Pick<TrainingReport, 'registered' | 'days'>): number {
  const days = r.days.filter(d => d.date || r.days.length === 1);
  if (!r.registered || !days.length) return 0;
  const present = days.reduce((s, d) => s + presentCount(r.registered, d), 0);
  return Math.round((present / (r.registered * days.length)) * 100);
}
export function objectivesAverage(objectives: ReportObjective[]): number {
  const s = objectives.map(o => o.stars).filter(n => n >= 1);
  return s.length ? Math.round((s.reduce((a, b) => a + b, 0) / s.length) * 10) / 10 : 0;
}
/** Class averages from the before and after scores (only people with both count for the improvement). */
export function scoreSummary(sc: Scores | undefined) {
  const rows = sc?.rows || [];
  const avg = (ns: number[]) => (ns.length ? Math.round((ns.reduce((a, b) => a + b, 0) / ns.length) * 10) / 10 : null);
  const pre = avg(rows.map(x => x.pre).filter((n): n is number => n !== null));
  const post = avg(rows.map(x => x.post).filter((n): n is number => n !== null));
  const both = rows.filter(x => x.pre !== null && x.post !== null);
  const gain = avg(both.map(x => (x.post as number) - (x.pre as number)));
  return { pre, post, gain, outOf: sc?.outOf || 100, count: rows.length };
}
export const cleanParticipant = (p: any): ParticipantRating | null => {
  const avg = Math.round(Math.min(5, Math.max(0, Number(p?.avg) || 0)) * 10) / 10;
  const responses = Math.max(0, Math.round(Number(p?.responses) || 0));
  const note = str(p?.note, 2000);
  return avg || responses || note ? { avg, responses, note } : null;
};

// ---------- Changes after sending (revisions) ----------
const short = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
function listChange(label: string, before: string[], after: string[], out: string[]) {
  const added = after.filter(x => !before.includes(x));
  const gone = before.filter(x => !after.includes(x));
  if (added.length) out.push(`${label}: added ${added.join(', ')}`);
  if (gone.length) out.push(`${label}: took off ${gone.join(', ')}`);
}

/** What the trainer changed, in plain words ("Day 2 absent: added Ali", "Observations changed"). */
export function reportChanges(a: TrainerPart, b: TrainerPart): string[] {
  const out: string[] = [];
  if (a.registered !== b.registered) out.push(`Participants registered: ${a.registered} → ${b.registered}`);
  const many = b.days.length > 1;
  b.days.forEach((d, i) => {
    const was = a.days.find(x => x.date === d.date) || a.days[i] || { absent: [], late: [], note: '' };
    const lab = (s: string) => (many ? `Day ${i + 1} ${s}` : s.charAt(0).toUpperCase() + s.slice(1));
    listChange(lab('absent'), was.absent, d.absent, out);
    listChange(lab('late / left early'), was.late, d.late, out);
    if (was.note !== d.note) out.push(`${lab('note')} changed`);
  });
  const objA = new Map<string, ReportObjective>(a.objectives.map(o => [o.text, o]));
  const objB = new Set(b.objectives.map(o => o.text));
  b.objectives.forEach(o => {
    const was = objA.get(o.text);
    if (!was) { out.push(`Objective added: "${short(o.text)}"`); return; }
    if (was.stars !== o.stars) out.push(`Objective "${short(o.text, 40)}": ${was.stars || 0} → ${o.stars} stars`);
    if (was.comment !== o.comment) out.push(`Objective "${short(o.text, 40)}": comment changed`);
  });
  a.objectives.filter(o => !objB.has(o.text)).forEach(o => out.push(`Objective taken off: "${short(o.text)}"`));
  if (a.observations !== b.observations) out.push('Observations changed');
  const people = (label: string, x: NamedReason[], y: NamedReason[]) => {
    listChange(label, x.map(p => p.name), y.map(p => p.name), out);
    if (y.some(p => { const w = x.find(q => q.name === p.name); return w && w.reason !== p.reason; })) out.push(`${label}: reason changed`);
  };
  people('Outstanding participants', a.outstanding, b.outstanding);
  people('Needing special attention', a.attention, b.attention);
  people('Follow-up training', a.followUps, b.followUps);
  const pa = a.photos.map(p => p.path), pb = b.photos.map(p => p.path);
  const morePh = pb.filter(p => !pa.includes(p)).length, lessPh = pa.filter(p => !pb.includes(p)).length;
  if (morePh) out.push(`${morePh} photo${morePh === 1 ? '' : 's'} added`);
  if (lessPh) out.push(`${lessPh} photo${lessPh === 1 ? '' : 's'} taken off`);
  const ia = a.internal, ib = b.internal;
  if (ia.trainerStars !== ib.trainerStars) out.push(`Trainer's rating: ${ia.trainerStars || 0} → ${ib.trainerStars} stars`);
  if (ia.missing !== ib.missing) out.push('What was missing changed');
  if (ia.time !== ib.time) out.push(`Time management: ${ia.time ? TIME_LABELS[ia.time] : 'not given'} → ${ib.time ? TIME_LABELS[ib.time] : 'not given'}`);
  if (ia.timeNote !== ib.timeNote) out.push('Time management note changed');
  REVIEW_PARTS.forEach(p => { if (ia[p.key] !== ib[p.key]) out.push(`${p.label} changed`); });
  if (ia.issues !== ib.issues) out.push('Issues on the day changed');
  if (ia.leads !== ib.leads) out.push('Sales leads changed');
  if ((a.summary || '') !== (b.summary || '')) out.push('Summary changed');
  if ((a.hours || 0) !== (b.hours || 0)) out.push(`Training hours: ${a.hours || 0} → ${b.hours || 0}`);
  if ((a.certificates || 0) !== (b.certificates || 0)) out.push(`Certificates: ${a.certificates || 0} → ${b.certificates || 0}`);
  listChange('Topics', a.topics || [], b.topics || [], out);
  if (JSON.stringify(a.scores || null) !== JSON.stringify(b.scores || null)) out.push('Test scores changed');
  if (JSON.stringify(a.personNotes || []) !== JSON.stringify(b.personNotes || [])) out.push('Notes on participants changed');
  listChange('Action plan', a.actions || [], b.actions || [], out);
  listChange('How the HOD can help', a.hodTips || [], b.hodTips || [], out);
  const ans = new Map((a.answers || []).map(x => [x.id, x.value]));
  (b.answers || []).forEach(x => { if (ans.get(x.id) !== x.value) out.push(`"${short(x.label, 40)}" changed`); });
  (a.answers || []).filter(x => !(b.answers || []).some(y => y.id === x.id)).forEach(x => out.push(`"${short(x.label, 40)}" cleared`));
  return out;
}

/** "21 Oct 2026, 3:15 pm" (Malaysia time) for a revision. */
export const revisionWhen = (iso: string) =>
  iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kuala_Lumpur' }) : '';

// ---------- HR's and the HOD's copies ----------
const PRIVATE_REPORT = ['trainerId', 'history', 'revisions', 'trainerDraft', 'returnNote', 'returnedByName', 'submittedByName', 'updatedAt', 'updatedByName', 'status', 'checkin', 'checkinAnswer'] as const;
/** Is this section (or answer) on this copy? */
export const shows = (r: TrainingReport, copy: CopyKind, key: CopyKey, s: ReportSettings | null | undefined, answer?: ReportAnswer) => onCopy(r, copy, key, s, answer);

/** Only what HR (or the HOD) may see: sections off for that copy emptied, team details left out. */
export function copyOf(r: TrainingReport, s: ReportSettings | null | undefined, copy: CopyKind = 'hr'): TrainingReport {
  const x: any = { ...r };
  PRIVATE_REPORT.forEach(k => delete x[k]);
  const on = (k: SectionKey) => onCopy(r, copy, k, s);
  if (!on('attendance')) x.days = [];
  if (!on('objectives')) x.objectives = [];
  if (!on('participant')) x.participant = null;
  if (!on('observations')) x.observations = '';
  if (!on('outstanding')) x.outstanding = [];
  if (!on('attention')) x.attention = [];
  if (!on('followUps')) x.followUps = [];
  if (!on('photos')) x.photos = [];
  if (!on('summary')) x.summary = '';
  if (!on('hours')) { x.hours = 0; x.certificates = 0; }
  if (!on('topics')) x.topics = [];
  if (!on('scores')) x.scores = { outOf: 100, rows: [] };
  if (!on('personNotes')) x.personNotes = [];
  if (!on('actions')) x.actions = [];
  if (!on('hodTips')) x.hodTips = [];
  x.answers = (r.answers || []).filter(a => onCopy(r, copy, `q:${a.id}`, s, a));
  const i = { ...emptyInternal() };
  const src = r.internal || emptyInternal();
  if (on('trainerStars')) i.trainerStars = src.trainerStars;
  if (on('missing')) i.missing = src.missing;
  if (on('time')) { i.time = src.time; i.timeNote = src.timeNote; }
  if (on('review')) REVIEW_PARTS.forEach(p => { i[p.key] = src[p.key]; });
  if (on('issues')) i.issues = src.issues;
  if (on('leads')) i.leads = src.leads;
  x.internal = i;
  if (x.participant) x.participant = { avg: x.participant.avg, responses: x.participant.responses, note: x.participant.note };
  // What prints on this copy, decided here so the page needs no settings of its own.
  x.copy = copy;
  x.printed = Object.fromEntries(sectionsOf(s).map(sec => [sec.key, { on: on(sec.key), label: sec.label }]));
  return x;
}
export { answerText, sectionOf };

/** The red flag in Admin work: a report waiting to be checked. */
export function reportFlag(r: TrainingReport | null | undefined, trainerName = 'The trainer'): string {
  if (r?.status !== 'submitted') return '';
  return r.revisions?.length
    ? `${trainerName} changed the training report after sending: check the changes, then mark it ready for HR`
    : `${trainerName} sent the training report: check it, then mark it ready for HR`;
}
