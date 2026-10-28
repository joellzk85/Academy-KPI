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

/** Won deals with a change already waiting for approval. A run isn't moved or cancelled while there are any, so no
 *  company is left behind on the old date. */
export const waitingDeals = (list: any[], cancel = false): any[] => list.filter(p => howToMove(p, cancel).kind === 'busy');
