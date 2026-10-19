// "On hold" (Joel, 2026-10-19): at Proposal sent, Client approved or Quotation sent, a deal can be put on hold
// with a potential date and a reason. The deal keeps its stage (KPIs and the journey line don't change).
// While on hold the follow-up rule alerts pause. On the potential date it comes back as "On hold date reached":
// Resume (the follow-up clock starts again from that day), Hold longer (new date and reason) or Mark lost.
//
// Stored on the deal as onHold = { stage, since, until, reason, byId, byName, at }. A hold only counts while the
// deal is still at the stage it was put on hold at, so any move (quotation sent, client accepted online, won,
// lost) ends it by itself. Resuming clears onHold and sets holdResumedDate (lib/followUps.ts stageClock).
// Pure logic (no database code), because the server shares src/lib/deals.ts.
import { DealStage, dealStage, formatDate } from './deals';

export const HOLD_STAGES: DealStage[] = ['proposal', 'agreed', 'quoted'];
export const HOLD_REASONS = [
  'Budget not ready', 'Waiting for HRDC levy / grant', 'Client busy / peak season', 'Waiting for management decision', 'Other',
];

export type DealHold = { stage: DealStage; since: string; until: string; reason: string; byId: string; byName: string; at: string };

const ymd = (v: any): string => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '');

export function canHold(p: any): boolean {
  return HOLD_STAGES.includes(dealStage(p)) && p?.deleted !== true;
}

export function activeHold(p: any): DealHold | null {
  const h = p?.onHold;
  if (!h || typeof h !== 'object' || !ymd(h.until)) return null;
  const st = dealStage(p);
  if (!HOLD_STAGES.includes(st) || h.stage !== st || p?.deleted === true) return null;
  return h as DealHold;
}

// The potential date has come: time to resume, hold longer or mark lost.
export function holdDue(p: any, today: string): boolean {
  const h = activeHold(p);
  return !!h && ymd(h.until) <= today;
}

export function holdText(p: any, today: string): string {
  const h = activeHold(p);
  if (!h) return '';
  return ymd(h.until) <= today ? `On hold date reached (${formatDate(h.until)})` : `On hold until ${formatDate(h.until)}`;
}

export function holdProblem(until: string, reason: string, today: string): string {
  if (!ymd(until)) return 'Pick the potential date.';
  if (ymd(until) <= today) return 'The potential date must be after today.';
  if (String(reason || '').trim().length < 3) return 'Write a few words on why it is on hold.';
  return '';
}
