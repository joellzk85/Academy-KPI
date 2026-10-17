// Deal journey helpers (Phase 2A).
// Deals are stored in the existing "pipelines" collection so all old records
// carry over. New fields: stage, appointmentDate, wonDate, lostDate,
// lostReason, fundingType. Older records without them are read sensibly.

import { apptOf, apptOverdue } from './appointments';

// The journey (Joel, 2026-10-16): New -> Proposal sent (the pitch) -> Client approved -> Quotation sent -> Won
// ("Client approved" was "Client agreed" until 2026-10-17; the stored value is still 'agreed'.)
// (the client signed the quotation). The appointment is optional and can happen at any point before Won;
// 'appointment' is kept as a stage only for deals that are new but have had a meeting.
export type DealStage = 'lead' | 'appointment' | 'proposal' | 'agreed' | 'quoted' | 'won' | 'lost';
export type FundingType = 'hrdc' | 'direct' | 'hrdc_topup';

export const STAGE_ORDER: DealStage[] = ['lead', 'appointment', 'proposal', 'agreed', 'quoted', 'won', 'lost'];
export const OPEN_STAGES: DealStage[] = ['lead', 'appointment', 'proposal', 'agreed', 'quoted'];
// The steps shown on the journey line (appointment is shown separately).
export const JOURNEY: DealStage[] = ['lead', 'proposal', 'agreed', 'quoted', 'won'];

export const STAGE_LABELS: Record<DealStage, string> = {
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

export const FUNDING_LABELS: Record<FundingType, string> = {
  hrdc: 'HRDC claimable',
  direct: 'Direct pay',
  hrdc_topup: 'HRDC + top-up',
};

export const LOST_REASONS = ['Price', 'Timing', 'No HRDC levy balance', 'Chose another provider', 'No response', 'Other'];

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
// an appointment not logged a day after it, a follow-up date that has passed, or a new deal over 2 days old with nothing planned.
export function dealNeedsAttention(p: any, today = todayIso()): boolean {
  const st = dealStage(p);
  if (!OPEN_STAGES.includes(st)) return false;
  if (apptOverdue(p, today)) return true;
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
  if (st === 'lead') return validDate(p?.requestDate);
  if (st === 'proposal') return validDate(p?.proposalSentDate);
  if (st === 'agreed') return validDate(p?.agreedDate);
  if (st === 'quoted') return validDate(p?.quotationSentDate);
  if (st === 'won') return dealWonDate(p);
  return '';
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

export function formatRM(n: number): string {
  return 'RM ' + Math.round(n).toLocaleString('en-MY');
}
