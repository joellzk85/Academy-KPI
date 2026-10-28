// Public programmes (Joel, 2026-10-28): NEXT Academy runs a programme on fixed dates announced in advance, and many
// companies send people to it. One record per run (collection `public_programmes`) holds the title, dates, venue,
// trainer, list price per pax, seat limit and minimum pax to run. Each company that joins is a normal deal
// (`pipelines.publicProgrammeId`), owned by the rep who sold it, with its own pax and funding type (HRDC, direct or
// HRDC + top-up), so Closing RM, KPIs and commission stay per rep.
// Price: the deal value starts at list price × pax; a bulk or special price is a discount a manager approves
// (Request discount on the quotation, lib/dealOffers.ts). Seats count every company not lost or deleted.
// Changing a run's dates or cancelling it moves its companies' deals with it: open deals straight away; won deals
// through the usual "Change date / Cancel training" request a manager approves (lib/trainingChange.ts).
// Pure logic, so it can be tested.
import { dealStage, dealValue, todayIso, trainingDays, trainingEndDate } from './deals';

export type RunStatus = 'open' | 'cancelled';

export interface PublicProgramme {
  id: string;
  programmeId: string;      // the title (programmes collection)
  title: string;            // its name, kept in step
  type: string;             // deal type: 'Training' (Classroom training) or 'Teambuilding'
  trainingDate: string;     // YYYY-MM-DD, first day
  trainingDays: number;     // 0.5, 1, 2…
  venueId: string;
  venueName: string;
  trainerId: string;
  trainerName: string;
  outlineId: string;        // the course outline used for this run (optional)
  pricePerPax: number;      // list price per participant, RM
  seatLimit: number;        // 0 = no limit
  minPax: number;           // minimum pax to run; 0 = none
  notes: string;
  status: RunStatus;
  cancelReason?: string;
  cancelNote?: string;
  movedToId?: string;       // the run its companies moved to, when cancelled by moving
  createdAt: number;
  createdById: string;
  createdByName: string;
  history: { at: string; byId: string; byName: string; action: string }[];
}

const ymd = (v: any): string => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '');
const words = (s: string) => String(s || '').trim().split(/\s+/).filter(Boolean).length;

export const runDays = (r: Pick<PublicProgramme, 'trainingDays'> | null | undefined) => trainingDays(r);
export const runEnd = (r: Pick<PublicProgramme, 'trainingDate' | 'trainingDays'>) => trainingEndDate(r);

/** Deals that have joined this run and still hold seats (not lost, not deleted, not a discovery). */
export function runDeals(runId: string, deals: any[]): any[] {
  return deals.filter(p => p?.publicProgrammeId === runId && p?.deleted !== true && !['lost', 'discovery'].includes(dealStage(p)));
}

export const paxOf = (p: any): number => Math.max(0, Math.round(Number(p?.participants) || 0));

export interface Seats { companies: number; seats: number; wonCompanies: number; wonSeats: number; value: number; wonValue: number; left: number | null }

/** Seats taken on a run: every company still in (sold), and those won (confirmed). left = null with no seat limit. */
export function runSeats(run: Pick<PublicProgramme, 'id' | 'seatLimit'>, deals: any[], exceptDealId = ''): Seats {
  const list = runDeals(run.id, deals).filter(p => p.id !== exceptDealId);
  const won = list.filter(p => dealStage(p) === 'won');
  const seats = list.reduce((t, p) => t + paxOf(p), 0);
  const limit = Number(run.seatLimit) || 0;
  return {
    companies: list.length,
    seats,
    wonCompanies: won.length,
    wonSeats: won.reduce((t, p) => t + paxOf(p), 0),
    value: list.reduce((t, p) => t + dealValue(p), 0),
    wonValue: won.reduce((t, p) => t + dealValue(p), 0),
    left: limit > 0 ? Math.max(0, limit - seats) : null,
  };
}

export type RunState = 'cancelled' | 'done' | 'running' | 'go' | 'short' | 'open';

/** Where a run stands: cancelled; done (past its last day); go (won seats reach the minimum); short (training within
 *  14 days and the minimum not reached by won seats); open. */
export function runState(run: PublicProgramme, deals: any[], today = todayIso()): RunState {
  if (run.status === 'cancelled') return 'cancelled';
  const start = ymd(run.trainingDate);
  if (start && runEnd(run) < today) return 'done';
  if (start && start <= today) return 'running';
  const s = runSeats(run, deals);
  const min = Number(run.minPax) || 0;
  if (min > 0 && s.wonSeats >= min) return 'go';
  if (min === 0 && s.wonSeats > 0) return 'go';
  if (start && min > 0 && start <= addDaysIso(today, SHORT_WARN_DAYS)) return 'short';
  return 'open';
}
export const SHORT_WARN_DAYS = 14;
function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(y, m - 1, d + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

export const RUN_STATE_LABELS: Record<RunState, string> = {
  cancelled: 'Cancelled',
  done: 'Training done',
  running: 'Training on now',
  go: 'Confirmed to run',
  short: 'Below minimum',
  open: 'Taking sign-ups',
};

/** Runs a rep can join: open, not yet started. */
export function joinableRuns(runs: PublicProgramme[], today = todayIso()): PublicProgramme[] {
  return runs
    .filter(r => r.status !== 'cancelled' && (!ymd(r.trainingDate) || ymd(r.trainingDate) >= today))
    .sort((a, b) => String(a.trainingDate || '9999').localeCompare(String(b.trainingDate || '9999')));
}

/** The deal value at the list price: price per pax × pax (2 decimals). */
export function listValue(run: Pick<PublicProgramme, 'pricePerPax'> | null | undefined, pax: number): number {
  return Math.round((Number(run?.pricePerPax) || 0) * Math.max(0, pax) * 100) / 100;
}

/** Why a deal can't be saved on this run ('' = fine): seats over the limit, or a price below the list price without an
 *  approved discount (Management may set any price). */
export function joinProblem(run: PublicProgramme, deals: any[], deal: { id?: string; participants: number; value: number; discountApproved: boolean },
  viewerRole: string): string {
  if (run.status === 'cancelled') return 'This public programme is cancelled. Pick another run.';
  const s = runSeats(run, deals, deal.id || '');
  const limit = Number(run.seatLimit) || 0;
  if (limit > 0 && s.seats + deal.participants > limit) {
    const left = Math.max(0, limit - s.seats);
    return `Only ${left} seat${left === 1 ? '' : 's'} left on this run (limit ${limit}). Ask Admin or Management to raise the seat limit.`;
  }
  const list = listValue(run, deal.participants);
  if (viewerRole !== 'management' && !deal.discountApproved && deal.participants > 0 && list > 0 && deal.value < list - 0.005) {
    return `The list price for ${deal.participants} pax is RM ${list.toLocaleString('en-MY', { minimumFractionDigits: 2 })}. For a bulk or special price, create the quotation at that price and click "Request discount"; a manager approves it.`;
  }
  return '';
}

/** Checks on the run form. */
export function runProblem(f: { programmeId: string; trainingDate: string; trainingDays: number | null; pricePerPax: number; seatLimit: number; minPax: number }): string {
  if (!f.programmeId) return 'Pick the title from the list.';
  if (!ymd(f.trainingDate)) return 'Pick the training date. Public programmes run on fixed dates.';
  if (f.trainingDays === null) return 'Enter the training days in half days, for example 0.5, 1.5 or 5 (up to 60).';
  if (!Number.isFinite(f.pricePerPax) || f.pricePerPax <= 0) return 'Enter the list price per participant, for example 1500.';
  if (!Number.isInteger(f.seatLimit) || f.seatLimit < 0 || f.seatLimit > 10000) return 'Enter the seat limit as a whole number (0 = no limit).';
  if (!Number.isInteger(f.minPax) || f.minPax < 0 || f.minPax > 10000) return 'Enter the minimum pax as a whole number (0 = none).';
  if (f.seatLimit > 0 && f.minPax > f.seatLimit) return 'The minimum pax can\'t be more than the seat limit.';
  return '';
}

/** Cancelling a run (or moving its companies to another run) needs a reason and a few words; the words also become each
 *  open deal's lost note (the database needs at least 10 characters). */
export function cancelProblem(reason: string, note: string, moveToId: string | null, runId: string): string {
  if (!reason) return 'Choose why the run is cancelled.';
  if (words(note) < 3 || note.trim().length < 10) return 'Write a few words on what happened (at least 3 words).';
  if (moveToId !== null && (!moveToId || moveToId === runId)) return 'Pick the run the companies move to.';
  return '';
}

export type DealMove =
  | { kind: 'direct' }               // open deal (or won without a date): change it now
  | { kind: 'request' }              // won deal with a date: a date change / cancellation request a manager approves
  | { kind: 'busy' };                // won deal that already has a request waiting: left alone, told to the user

/** How a company's deal follows a change of its run's date, a move or (cancel) a cancellation: a won deal only becomes
 *  lost through an approved cancellation, whatever its date. */
export function howToMove(p: any, cancel = false): DealMove {
  if (dealStage(p) !== 'won' || (!cancel && !ymd(p?.trainingDate))) return { kind: 'direct' };
  if (p?.trainingChange?.status === 'pending') return { kind: 'busy' };
  return { kind: 'request' };
}

// ---------- Batch 2, part A (2026-10-28): operations once per run ----------
// The run has its own checklist and costs, stored under the run's id exactly like a deal's (deal_checklists/{runId},
// money_out.dealId = runId, checklist_files, trainer_jobs), so the checklist, Payments out, the accounts portal and the
// trainer portal work unchanged. Screens that look up "the deal" behind one of those records use runAsDeal().
// The run does the shared steps: venue, bus, facilitator, trainer and co-trainers, materials, Output assessment QR,
// Training delivered, Training report, Output assessment, Certificates. Each company's checklist keeps only its own
// steps (Grant approved, Attendance list, JD14, T3 and any custom steps) plus "Training delivered", which is ticked
// from the run (the HRDC claim needs it on the company's deal).

const RUN_KINDS = ['venue', 'bus', 'facilitator', 'trainer', 'materials'];
const RUN_IDS = ['output_qr', 'delivered', 'training_report', 'output_assessment', 'certificates'];
export const MIRRORED_STEP = 'delivered';

/** A step done once on the public programme (not on each company's deal). */
export const isRunStep = (t: { id?: string; kind?: string }) => RUN_KINDS.includes(t.kind || '') || RUN_IDS.includes(t.id || '');

/** The steps a checklist keeps: the run's shared steps on the run; a company's own steps (plus Training delivered,
 *  ticked from the run) on a company's deal; everything on any other deal. Works on master-list steps and on tasks. */
export function checklistScope<T extends { id?: string; kind?: string }>(deal: any, steps: T[]): T[] {
  if (isRunDeal(deal)) return steps.filter(isRunStep);
  if (deal?.publicProgrammeId) return steps.filter(t => !isRunStep(t) || t.id === MIRRORED_STEP);
  return steps;
}

/** A company's step that is ticked from the run, never on the company's deal. */
export const isMirroredStep = (deal: any, t: { id?: string }) => !!deal?.publicProgrammeId && !isRunDeal(deal) && t.id === MIRRORED_STEP;

/** The run shaped like a won deal, for the checklist, costs, Payments out, the accounts portal and the trainer portal.
 *  Never written to `pipelines` and never counted in sales or KPIs. Its pax are the companies' pax when given. */
export function runAsDeal(run: PublicProgramme, pax = 0): any {
  return {
    id: run.id,
    isPublicRun: true,
    publicRunTitle: run.title,
    client: 'Public programme',
    clientId: '',
    programmeId: run.programmeId,
    courseName: run.title,
    type: run.type || 'Training',
    trainingDate: run.trainingDate || '',
    trainingDays: run.trainingDays || 1,
    participants: pax,
    fundingType: 'direct',
    stage: run.status === 'cancelled' ? 'lost' : 'won',
    status: run.status === 'cancelled' ? 'Lost' : 'Won',
    ownerId: run.createdById,
    creatorId: run.createdById,
    runVenueId: run.venueId || '', runVenueName: run.venueName || '',
    runTrainerId: run.trainerId || '', runTrainerName: run.trainerName || '',
    ...(run.status === 'cancelled' ? { trainingCancelled: { at: run.history?.[run.history.length - 1]?.at || '', reason: run.cancelReason || '', note: run.cancelNote || '' } } : {}),
  };
}
export const isRunDeal = (d: any) => d?.isPublicRun === true;

/** The run's venue and trainer (picked when it was set up) on its Venue and Trainer steps, while those steps aren't
 *  done, so they're typed once. */
export function withRunPicks<T extends { id?: string; kind?: string; done?: boolean; venueId?: string; venueName?: string; trainerId?: string; trainerName?: string; needed?: boolean }>(
  tasks: T[], run: { venueId?: string; venueName?: string; trainerId?: string; trainerName?: string }): T[] {
  return tasks.map(t => {
    if (t.done) return t;
    if (t.kind === 'venue' && run.venueId) return { ...t, venueId: run.venueId, venueName: run.venueName || '', needed: true };
    if (t.kind === 'trainer' && t.id === 'trainer' && run.trainerId) return { ...t, trainerId: run.trainerId, trainerName: run.trainerName || '' };
    return t;
  });
}
/** "Public programme: TITLE" for lists that name the client of a cost or training. */
export const runLabel = (d: any) => `Public programme: ${d?.publicRunTitle || d?.courseName || ''}`;

// ---------- Batch 2, part B (2026-10-28): each company's share of the run's costs ----------
// Joel: "Split by pax". A run's costs (money_out with dealId = the run's id) are shared out to its won companies by their
// pax (4 of 20 pax = 20% of each cost), so each company's P&L, the rep's GP % KPI and the GP alerts are fair. The shares
// are worked out when the P&L is calculated (never saved): pass deals and costs through runCostShares and add the result
// to the costs given to projectRow / projectRows. Only for P&L sums: never list them as payments.

/** A run's costs shared out to its won companies by pax (equally when none has pax). Each share is a copy of the cost
 *  on the company's deal with `shareOf` (the run cost's id) and `sharePct`; the shares of one cost add up to it exactly. */
export function runCostShares(deals: any[], outs: any[]): any[] {
  const byRun = new Map<string, any[]>();
  deals.forEach(p => {
    if (!p?.publicProgrammeId || p.deleted === true || dealStage(p) !== 'won') return;
    byRun.set(p.publicProgrammeId, [...(byRun.get(p.publicProgrammeId) || []), p]);
  });
  if (!byRun.size) return [];
  const out: any[] = [];
  outs.forEach(o => {
    const companies = byRun.get(o?.dealId);
    if (!companies?.length || o.shareOf) return;
    const total = companies.reduce((t, p) => t + paxOf(p), 0);
    const weights = companies.map(p => (total > 0 ? paxOf(p) / total : 1 / companies.length));
    const sen = Math.round((Number(o.amount) || 0) * 100);
    let left = sen;
    companies.forEach((p, i) => {
      if (!weights[i]) return;
      const last = companies.slice(i + 1).every((_, j) => !weights[i + 1 + j]);
      const part = last ? left : Math.round(sen * weights[i]);
      left -= part;
      out.push({ ...o, id: `${o.id}~${p.id}`, dealId: p.id, amount: part / 100, shareOf: o.id, sharePct: Math.round(weights[i] * 1000) / 10 });
    });
  });
  return out;
}

/** One P&L for the run: the won companies' rows (with their shares) added up. */
export function runPL(rows: { income: number; sst: number; hrdcFee: number; commission: number; costs: number; profit: number; received: number }[]) {
  const sum = (k: keyof (typeof rows)[number]) => rows.reduce((t, r) => t + (Number(r[k]) || 0), 0);
  const income = sum('income'), sst = sum('sst'), profit = sum('profit');
  return { companies: rows.length, income, sst, hrdcFee: sum('hrdcFee'), commission: sum('commission'), costs: sum('costs'), profit, received: sum('received'),
    margin: income - sst > 0 ? (profit / (income - sst)) * 100 : 0 };
}

// ---------- Batch 2, part B: each company's copy of the run's training report ----------
// The trainer writes one report on the run (training_reports/{runId}). Each company's HR (and HOD) copy keeps only that
// company's people, matched by name to the company's T3 list: attendance (absent, late), outstanding, needs attention,
// follow-ups, scores and notes per person; registered = the company's pax. Everything about the training as a whole
// (summary, objectives, observations, topics, photos, actions) stays. No T3 names: no person is printed.

const normName = (s: any) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();

export function companyReport<R extends Record<string, any>>(r: R, names: string[], pax: number): R {
  const mine = new Set(names.map(normName).filter(Boolean));
  const keep = (n: any) => mine.has(normName(n));
  const x: any = { ...r, registered: pax > 0 ? pax : r.registered };
  x.days = (r.days || []).map((d: any) => ({ ...d, absent: (d.absent || []).filter(keep), late: (d.late || []).filter(keep) }));
  x.outstanding = (r.outstanding || []).filter((p: any) => keep(p?.name));
  x.attention = (r.attention || []).filter((p: any) => keep(p?.name));
  x.followUps = (r.followUps || []).filter((p: any) => keep(p?.name));
  if (r.scores) x.scores = { ...r.scores, rows: (r.scores.rows || []).filter((p: any) => keep(p?.name)) };
  if (r.personNotes) x.personNotes = r.personNotes.filter((p: any) => keep(p?.name));
  return x;
}

/** Everyone on the companies' T3 lists, once each (the run's report starts with these names). */
export function allNames(lists: string[][]): string[] {
  const seen = new Set<string>();
  return lists.flat().map(n => String(n || '').trim()).filter(n => n && !seen.has(normName(n)) && (seen.add(normName(n)), true));
}

/** Won deals with a change already waiting for approval. A run isn't moved or cancelled while there are any, so no
 *  company is left behind on the old date. */
export const waitingDeals = (list: any[], cancel = false): any[] => list.filter(p => howToMove(p, cancel).kind === 'busy');
