// Deal journey helpers (Phase 2A).
// Deals are stored in the existing "pipelines" collection so all old records
// carry over. New fields: stage, appointmentDate, wonDate, lostDate,
// lostReason, fundingType. Older records without them are read sensibly.

import { apptOf, apptOverdue } from './appointments';
import { followUpAlert } from './followUps';
import { activeHold, holdDue } from './dealHold';

// The journey (Joel, 2026-10-16): New -> Proposal sent (the pitch) -> Client approved -> Quotation sent -> Won
// ("Client approved" was "Client agreed" until 2026-10-17; the stored value is still 'agreed'.)
// (the client signed the quotation). The appointment is optional and can happen at any point before Won;
// 'appointment' is kept as a stage only for deals that are new but have had a meeting.
// 'discovery' (Joel, 2026-10-28, lib/discovery.ts): the top of the funnel, before New. We met the client and proposed
// something, but they haven't asked us for anything yet. It isn't a deal: not open, never lost, not in win rates.
export type DealStage = 'discovery' | 'lead' | 'appointment' | 'proposal' | 'agreed' | 'quoted' | 'won' | 'lost';
export type FundingType = 'hrdc' | 'direct' | 'hrdc_topup';

export const STAGE_ORDER: DealStage[] = ['discovery', 'lead', 'appointment', 'proposal', 'agreed', 'quoted', 'won', 'lost'];
export const OPEN_STAGES: DealStage[] = ['lead', 'appointment', 'proposal', 'agreed', 'quoted'];
// The steps shown on the journey line (appointment is shown separately).
export const JOURNEY: DealStage[] = ['lead', 'proposal', 'agreed', 'quoted', 'won'];

export const STAGE_LABELS: Record<DealStage, string> = {
  discovery: 'Discovery',
  lead: 'New',
  appointment: 'New (met)',
  proposal: 'Proposal sent',
  agreed: 'Client approved',
  quoted: 'Quotation sent',
  won: 'Won',
  lost: 'Lost',
};

// For the journey line and filters, a new deal that has had its meeting counts as "New".
export function journeyStage(st: DealStage): DealStage {
  return st === 'appointment' ? 'lead' : st;
}

// Quotations are made only once the client has agreed to the proposal.
export function canQuote(p: any): boolean {
  const st = dealStage(p);
  return st === 'agreed' || st === 'quoted' || st === 'won';
}

// Details are asked for when they matter, not upfront (Joel, 2026-10-18):
// a new deal needs only the client, what they asked for (programme or a typed note) and the date asked;
// "Proposal sent" (and creating the quotation) needs the programme from the list and the deal value;
// "Won" needs the client, the value, the funding type and the number of participants (Joel, 2026-10-23: pax lives on
// the deal and locks once won, so it's asked for before Won).
export type DealField = 'client' | 'programme' | 'value' | 'funding' | 'participants';
export type GateStep = 'proposal' | 'quote' | 'won';
export const GAP_LABELS: Record<DealField, string> = {
  client: 'the client from the client list',
  programme: 'the programme from the programme list',
  value: 'the deal value',
  funding: 'how it will be paid',
  participants: 'the number of participants',
};
export function dealGaps(p: any, step: GateStep, known: { clientIds: string[]; programmeIds: string[] }): DealField[] {
  const out: DealField[] = [];
  if (step === 'won' && !(p?.clientId && known.clientIds.includes(p.clientId))) out.push('client');
  if (step !== 'won' && !(p?.programmeId && known.programmeIds.includes(p.programmeId))) out.push('programme');
  if (dealValue(p) <= 0) out.push('value');
  if (step === 'won' && !p?.fundingType) out.push('funding');
  if (step === 'won' && !(Number(p?.participants) > 0)) out.push('participants');
  return out;
}

// What the client asked for: the programme's name, else the short note typed on a new deal.
export function dealAskedFor(p: any, programmeName = ''): string {
  return programmeName || p?.courseName || (p?.enquiryNote ? `Asked for: ${p.enquiryNote}` : '');
}

export const FUNDING_LABELS: Record<FundingType, string> = {
  hrdc: 'HRDC claimable',
  direct: 'Direct pay',
  hrdc_topup: 'HRDC + top-up',
};

export const LOST_REASONS = ['Price', 'Timing', 'No HRDC levy balance', 'Chose another provider', 'No response', 'Other'];

// Marking a deal lost needs a reason and a short explanation from everyone (Joel, 2026-10-18).
// The database rules also refuse a lost deal without them (at least 10 characters).
export const LOST_MIN_WORDS = 3;
export function wordCount(text: string): number {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}
export function lostNoteProblem(text: string): string {
  const t = String(text || '').trim();
  if (wordCount(t) < LOST_MIN_WORDS || t.length < 10) return `Explain in a few words (at least ${LOST_MIN_WORDS}) what happened.`;
  return '';
}

// Deleting keeps the deal (Joel, 2026-10-18): it is marked deleted and hidden everywhere (src/lib/linked.ts),
// and Management can restore it from Management → Lost and deleted.
export function isDeletedDeal(p: any): boolean {
  return p?.deleted === true;
}

const validDate = (d: any): string => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : '');

export function dealStage(p: any): DealStage {
  if (STAGE_ORDER.includes(p?.stage)) return p.stage;
  if (p?.status === 'Won') return 'won';
  if (p?.status === 'Lost') return 'lost';
  if (validDate(p?.proposalSentDate)) return 'proposal';
  if (p?.appointmentTicked || p?.isAppointment) return 'appointment';
  return 'lead';
}

// The old screens still read "status", so it is kept in step with the stage.
export function statusForStage(stage: DealStage): 'Pending' | 'Won' | 'Lost' {
  return stage === 'won' ? 'Won' : stage === 'lost' ? 'Lost' : 'Pending';
}

// Does an open deal need attention now? The red rows on Deals and the red dot on the Deals menu both use this:
// an appointment not logged a day after it, a follow-up alert from the follow-up rules (lib/followUps.ts),
// a follow-up date that has passed, or a new deal over 2 days old with nothing planned.
export function dealNeedsAttention(p: any, today = todayIso()): boolean {
  const st = dealStage(p);
  // An open discovery has the appointment's requirements (Joel, 2026-10-28): a meeting not logged a day after it,
  // a follow-up date passed, or nothing booked or logged 2 days after it was made.
  if (st === 'discovery') {
    if (isDeletedDeal(p) || p?.discoveryClosed) return false;
    if (apptOverdue(p, today)) return true;
    if (apptOf(p)?.status === 'booked') return false;
    const due = validDate(p?.followUpDate);
    if (due) return due < today;
    return !apptOf(p) && !!validDate(p?.discoveryDate) && validDate(p.discoveryDate) < addDays(today, -2);
  }
  if (!OPEN_STAGES.includes(st) || isDeletedDeal(p)) return false;
  if (apptOverdue(p, today)) return true;
  // On hold (lib/dealHold.ts): quiet until the potential date, then it needs a decision.
  if (activeHold(p)) return holdDue(p, today);
  if (followUpAlert(p, today)) return true;
  if (apptOf(p)?.status === 'booked') return false;
  const fu = validDate(p?.followUpDate);
  if (fu && fu < today) return true;
  if (st === 'lead' && !fu && p?.requestDate) return (Date.now() - new Date(p.requestDate).getTime()) / 86400000 > 2;
  return false;
}

// Who may edit the appointment and delete the deal: the person who created it, or Management (Joel, 2026-10-16).
// Older deals without a creator fall back to the owner.
export function canManageDeal(p: any, viewer: { id: string; role: string }): boolean {
  return viewer.role === 'management' || (p?.creatorId || dealOwnerId(p)) === viewer.id;
}

// Who may move a deal to its next stage (the database rule): its owner, Admin or Management.
// A teammate who is only shared on a quotation or outline can send it, but the deal stays where it is.
export function canMoveDeal(p: any, viewer: { id: string; role: string }): boolean {
  return viewer.role !== 'rep' || dealOwnerId(p) === viewer.id;
}

// "No proposal needed" (Joel, 2026-10-19): repeat clients and repeat programmes can go from New straight to
// Client approved. The deal keeps proposalSkipped and the reason; the Proposal KPI doesn't count it.
export const SKIP_REASONS = ['Repeat client, same programme', 'Client asked for a quotation directly', 'Other'];

export function dealOwnerId(p: any): string {
  return p?.ownerId || p?.creatorId || '';
}

// Date the deal counts as a sale: the day it was won.
// Older won deals have no won date, so they fall back to the old rule.
export function dealWonDate(p: any): string {
  if (dealStage(p) !== 'won') return '';
  return validDate(p?.wonDate) || validDate(p?.proposalSentDate) || validDate(p?.requestDate);
}

// The date each journey step was reached, shown under the journey line ('' if not recorded).
export function stageDate(p: any, st: DealStage): string {
  if (st === 'discovery') return validDate(p?.discoveryDate);
  if (st === 'lead') return validDate(p?.requestDate);
  if (st === 'proposal') return validDate(p?.proposalSentDate);
  if (st === 'agreed') return validDate(p?.agreedDate);
  if (st === 'quoted') return validDate(p?.quotationSentDate);
  if (st === 'won') return dealWonDate(p);
  return '';
}

// The furthest open stage a deal reached, from its dates. Used to reopen a lost deal and to show
// "stage it reached" in Management → Lost and deleted.
export function reachedStage(p: any): DealStage {
  if (validDate(p?.quotationSentDate)) return 'quoted';
  if (validDate(p?.agreedDate)) return 'agreed';
  if (validDate(p?.proposalSentDate)) return 'proposal';
  if (p?.appointmentDate || p?.appointmentTicked) return 'appointment';
  return 'lead';
}

export function dealProposalDate(p: any): string {
  return validDate(p?.proposalSentDate);
}

export function dealAppointmentDate(p: any): string {
  if (validDate(p?.appointmentDate)) return validDate(p.appointmentDate);
  if (p?.appointmentTicked || p?.isAppointment) return validDate(p?.requestDate);
  return '';
}

export function dealValue(p: any): number {
  const v = parseFloat(p?.proposalValue);
  return Number.isFinite(v) ? v : 0;
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatDate(iso: string): string {
  const d = validDate(iso);
  if (!d) return '';
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Training length (Joel, 2026-10-19): some trainings run over several days, back to back from the training date.
// `trainingDays` on the deal (blank = 1; 0.5 = half a day). The last day is what "training has passed" counts from.
export function trainingDays(p: any): number {
  const n = Number(p?.trainingDays);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

// Typed training days → the number, or null when it isn't half days between 0.5 and 60. Blank = 1 day.
export const TRAINING_DAYS_PROBLEM = 'Enter the training days in half days, for example 0.5, 1.5 or 5 (up to 60).';
export function parseTrainingDays(text: string): number | null {
  const t = String(text ?? '').trim();
  if (t === '') return 1;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 && n <= 60 && (n * 2) % 1 === 0 ? n : null;
}

export function addDays(iso: string, n: number): string {
  const d = validDate(iso);
  if (!d) return '';
  const [y, m, day] = d.split('-').map(Number);
  const t = new Date(y, m - 1, day + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

export function trainingEndDate(p: any): string {
  const start = validDate(p?.trainingDate);
  return start ? addDays(start, Math.max(1, Math.ceil(trainingDays(p))) - 1) : '';
}

// Every day of the training, first to last ([] with no training date).
export function trainingDayList(p: any): string[] {
  const start = validDate(p?.trainingDate);
  return start ? Array.from({ length: Math.max(1, Math.ceil(trainingDays(p))) }, (_, i) => addDays(start, i)) : [];
}

// "21 Oct 2026", "21 – 22 Oct 2026", "30 Oct – 2 Nov 2026", "30 Dec 2026 – 2 Jan 2027".
export function formatDateRange(start: string, end: string): string {
  const a = validDate(start), b = validDate(end);
  if (!a) return '';
  if (!b || b <= a) return formatDate(a);
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  const dm = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
  if (ay !== by) return `${formatDate(a)} – ${formatDate(b)}`;
  if (am !== bm) return `${dm(a)} – ${formatDate(b)}`;
  return `${Number(a.slice(8, 10))} – ${formatDate(b)}`;
}

export function daysText(n: number): string {
  return n === 0.5 ? 'half day' : `${n} day${n === 1 ? '' : 's'}`;
}

// The deal's training dates as printed: "21 – 22 Oct 2026". With `withDays`, " (2 days)" is added when it isn't 1 day.
export function trainingDateText(p: any, withDays = false): string {
  const range = formatDateRange(p?.trainingDate, trainingEndDate(p));
  if (!range) return '';
  const n = trainingDays(p);
  return withDays && n !== 1 ? `${range} (${daysText(n)})` : range;
}

export function formatRM(n: number): string {
  return 'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
