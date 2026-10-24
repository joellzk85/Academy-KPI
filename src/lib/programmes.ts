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
  outlineFiles?: ProgrammeFile[];   // course outline files uploaded on the programme (2026-10-23)
  tags?: string[];           // #tags for finding it later, stored without the "#" (2026-10-24)
  skillType?: 'soft' | 'technical';   // set by Admin / Management on the title, or when added from a type tab (2026-10-24); see programmeTypeOf
}

// Titles are the programmes (Joel, 2026-10-24): a course outline's or teambuilding proposal's title IS the programme,
// so there's no separate Programmes tab. Each title has one category and any number of #tags.
export const STANDARD_CATEGORIES = ['Sales', 'HR', 'Communication', 'Customer service'];

/** The categories to pick from: the standard ones first, then every other one already used (Blueprint ones included). */
export function categoryList(programmes: { category?: string }[]): string[] {
  const isStd = (c: string) => STANDARD_CATEGORIES.some(s => s.toLowerCase() === c.toLowerCase());
  const used = [...new Set(programmes.map(p => String(p.category || '').trim()).filter(Boolean))];
  return [...STANDARD_CATEGORIES, ...used.filter(u => !isStd(u)).sort((a, b) => a.localeCompare(b))];
}

/** "#Customer Service" → "customer-service". */
export function normTag(s: string): string {
  return String(s || '').trim().replace(/^#+/, '').toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

/** Tags made from an older category, e.g. "Leadership & Professional Development" → leadership, professional-development. */
export function tagsFromCategory(category?: string): string[] {
  return [...new Set(String(category || '').split(/&|,|\/|\band\b/i).map(normTag).filter(Boolean))];
}

/** A title's #tags: its own once set, else the ones its category gives. */
export function programmeTags(p: { tags?: string[]; category?: string } | undefined): string[] {
  if (!p) return [];
  return Array.isArray(p.tags) ? p.tags : tagsFromCategory(p.category);
}

/** Two titles are the same when they match ignoring case and spaces (and "(TB)" for teambuilding). */
export const titleKey = (name?: string) => String(name || '').replace(/\(TB\)\s*$/i, '').trim().replace(/\s+/g, ' ').toLowerCase();

// A course outline file kept on a programme, at programme_files/{programmeId}/{id}_{name} in storage.
export interface ProgrammeFile {
  id: string;
  name: string;
  size: number;
  path: string;
  at: string;
  byId: string;
  byName: string;
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
/** "(TB)" is for the team only (Joel, 2026-10-24): PDFs, client links, quotations and emails print the title without it. */
export const clientTitle = (name?: string) => String(name || '').replace(/\s*\(TB\)\s*$/i, '');
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
  if (programmeStatus(programme) !== 'approved') return `"${programme.name}" isn't approved by HRDC yet. Update it on its title (Course outlines or Teambuilding proposal → By title) once it is.`;
  return '';
}
