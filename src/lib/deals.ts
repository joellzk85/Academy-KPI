// Deal journey helpers (Phase 2A).
// Deals are stored in the existing "pipelines" collection so all old records
// carry over. New fields: stage, appointmentDate, wonDate, lostDate,
// lostReason, fundingType. Older records without them are read sensibly.

export type DealStage = 'lead' | 'appointment' | 'proposal' | 'won' | 'lost';
export type FundingType = 'hrdc' | 'direct' | 'hrdc_topup';

export const STAGE_ORDER: DealStage[] = ['lead', 'appointment', 'proposal', 'won', 'lost'];
export const OPEN_STAGES: DealStage[] = ['lead', 'appointment', 'proposal'];

export const STAGE_LABELS: Record<DealStage, string> = {
  lead: 'Lead',
  appointment: 'Appointment',
  proposal: 'Proposal sent',
  won: 'Won',
  lost: 'Lost',
};

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

export function dealOwnerId(p: any): string {
  return p?.ownerId || p?.creatorId || '';
}

// Date the deal counts as a sale: the day it was won.
// Older won deals have no won date, so they fall back to the old rule.
export function dealWonDate(p: any): string {
  if (dealStage(p) !== 'won') return '';
  return validDate(p?.wonDate) || validDate(p?.proposalSentDate) || validDate(p?.requestDate);
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
