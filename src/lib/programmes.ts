// Programmes and HRDC work (Phase 2C).
// - programmes/{id}: the one list of training programmes, with HRDC registration.
//   Deals point to it with programmeId; deal.courseName is kept in step for older screens.
// - hrdc_queries/{id}: questions HRDC raises on a deal, before approval, during or after training.

import { todayIso } from './deals';

export type HrdcStatus = 'not_registered' | 'submitted' | 'approved';
export type QueryPhase = 'before' | 'during' | 'after';

export const HRDC_STATUS_LABELS: Record<HrdcStatus, string> = {
  not_registered: 'Not registered with HRDC',
  submitted: 'Submitted to HRDC',
  approved: 'Approved by HRDC',
};

export const HRDC_STATUS_SHORT: Record<HrdcStatus, string> = {
  not_registered: 'Not registered',
  submitted: 'Waiting on HRDC',
  approved: 'HRDC approved',
};

export const QUERY_PHASE_LABELS: Record<QueryPhase, string> = {
  before: 'Before approval',
  during: 'During training',
  after: 'After training',
};

export interface Programme {
  id: string;
  name: string;
  hrdcStatus: HrdcStatus;
  hrdcCode?: string;
  submittedDate?: string;
  approvedDate?: string;
  notes?: string;
  category?: string;         // e.g. "Leadership & Professional Development" (from the Blueprint list, 2026-10-20)
  days?: number | null;      // usual length in days (half days allowed)
}

export interface HrdcQuery {
  id: string;
  dealId: string;
  phase: QueryPhase;
  question: string;
  receivedDate: string;
  replyBy: string;
  handledById: string;
  handledByName: string;
  answeredDate?: string;
  answer?: string;
}

// Teambuilding programmes end in "(TB)" (Joel, 2026-10-23): a teambuilding deal picks from those, a training deal
// from the others. Quick-adding one from a teambuilding deal adds the "(TB)".
export const isTbProgramme = (name?: string) => /\(TB\)\s*$/i.test(String(name || ''));
export const withTbMark = (name: string) => (isTbProgramme(name) ? name.trim() : `${name.trim()} (TB)`);
export const isTbDeal = (deal: any) => String(deal?.type || '') === 'Teambuilding';
/** The programmes a deal of this type can pick: (TB) ones for teambuilding, the rest for training; all when unknown. */
export function programmesFor(list: Programme[], kind?: 'training' | 'teambuilding'): Programme[] {
  if (!kind) return list;
  return list.filter(p => isTbProgramme(p.name) === (kind === 'teambuilding'));
}

export function programmeStatus(p: any): HrdcStatus {
  return p?.hrdcStatus === 'submitted' || p?.hrdcStatus === 'approved' ? p.hrdcStatus : 'not_registered';
}

export function isQueryOpen(q: HrdcQuery): boolean {
  return !q.answeredDate;
}

export function isQueryOverdue(q: HrdcQuery, today = todayIso()): boolean {
  return isQueryOpen(q) && /^\d{4}-\d{2}-\d{2}/.test(q.replyBy || '') && q.replyBy.slice(0, 10) < today;
}

// Why an HRDC deal can't have its grant ticked yet, or '' if it can.
export function grantBlockReason(deal: any, programme: Programme | undefined): string {
  if (deal?.fundingType !== 'hrdc' && deal?.fundingType !== 'hrdc_topup') return '';
  if (!deal?.programmeId) return 'Pick the programme from the programme list on the deal first (Edit details).';
  if (!programme) return 'This deal\'s programme is no longer in the programme list. Pick it again (Edit details).';
  if (programmeStatus(programme) !== 'approved') return `"${programme.name}" isn't approved by HRDC yet. Update it in Admin work → Programmes once it is.`;
  return '';
}
