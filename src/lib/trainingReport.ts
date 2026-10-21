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
  participant?: ParticipantRating | null;
  showToHr?: Partial<Record<InternalKey, boolean>>;
  submittedAt?: string;
  submittedByName?: string;
  returnNote?: string;
  returnedByName?: string;
  checkedAt?: string;
  checkedByName?: string;
  updatedAt?: string;
  updatedByName?: string;
  history?: { at: string; byName: string; action: string }[];
}

// The internal sections Management can put on HR's copy.
export type InternalKey = 'trainerStars' | 'missing' | 'time' | 'review' | 'issues' | 'leads';
export const INTERNAL_PARTS: { key: InternalKey; label: string }[] = [
  { key: 'trainerStars', label: "Trainer's rating of the training" },
  { key: 'missing', label: 'What was missing' },
  { key: 'time', label: 'Time management' },
  { key: 'review', label: 'Review (went well, do better, start, stop, more)' },
  { key: 'issues', label: 'Issues on the day' },
  { key: 'leads', label: 'Sales leads spotted' },
];

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
}

export function newReport(dealId: string, trainerId: string, trainerName: string, seed: ReportSeed): TrainingReport {
  return {
    dealId, trainerId, trainerName, status: 'draft',
    registered: seed.names.length,
    days: (seed.dates.length ? seed.dates : ['']).map(date => ({ date, absent: [], late: [], note: '' })),
    objectives: seed.objectives.map(text => ({ text, stars: 0, comment: '' })),
    observations: '', outstanding: [], attention: [], followUps: [], photos: [],
    internal: emptyInternal(),
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
  };
}

/** What still has to be filled in before the report can be sent (empty when it's ready). */
export function reportGaps(r: Pick<TrainingReport, 'registered' | 'days' | 'objectives' | 'observations' | 'internal'>): string[] {
  const out: string[] = [];
  if (!(r.registered > 0)) out.push('How many participants were registered');
  if (!r.objectives.length) out.push('At least one objective');
  else if (r.objectives.some(o => !o.stars)) out.push('A star rating for every objective');
  if (!r.observations.trim()) out.push('Your observations');
  if (!r.internal.trainerStars) out.push('Your rating of the training');
  if (!r.internal.time) out.push('Time management');
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
export const cleanParticipant = (p: any): ParticipantRating | null => {
  const avg = Math.round(Math.min(5, Math.max(0, Number(p?.avg) || 0)) * 10) / 10;
  const responses = Math.max(0, Math.round(Number(p?.responses) || 0));
  const note = str(p?.note, 2000);
  return avg || responses || note ? { avg, responses, note } : null;
};

/** Can the trainer still change it? Not once the team has checked it. */
export const trainerCanEdit = (r: { status?: ReportStatus } | null | undefined) => !r || r.status !== 'checked';

/** The red flag in Admin work: a report waiting to be checked. */
export function reportFlag(r: TrainingReport | null | undefined, trainerName = 'The trainer'): string {
  return r?.status === 'submitted' ? `${trainerName} sent the training report: check it, then mark it ready for HR` : '';
}
