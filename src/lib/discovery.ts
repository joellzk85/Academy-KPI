// Discovery (Joel, 2026-10-28). Not every meeting is a deal: in a discovery we meet the client and propose
// something, before they have asked us for anything. A deal starts only when the client asks for something.
// - Stored in "pipelines" with stage 'discovery' (lib/deals.ts), so the meeting box, meeting photos, calendar,
//   follow-ups, client history and search work as on deals. Not a deal: never open, never lost, no requestDate,
//   so win rate, closing ratio, Deals started and the pipeline never count it.
// - discoveryDate: the day it was made (kept after it becomes a deal). The meeting is booked and logged like an
//   appointment, with the same rules, and counts for the Appointments KPI; a meeting logged while it is a discovery
//   is marked appointment.discovery = true (the Discovery meetings KPI).
// - First touch point: worked out, never ticked: the client had no earlier discovery or deal.
// - "Convert to deal": the client asked for something; the same record becomes a New deal (convertedDate,
//   convertedAtMs, requestDate = the day they asked). "No interest": closed (discoveryClosed), never lost.
// - "This was only a discovery": a New deal goes back to Discovery. Reps only on their own, before the proposal
//   and within the hours Management sets (config/discovery_settings, Follow-up rules page); Management any time
//   on any deal that isn't won. firestore.rules checks the same.
// - The meeting is a must (Joel, 2026-10-28): a discovery is made with its meeting logged or booked, the meeting is
//   moved but never cancelled, and it becomes a deal only once the meeting is logged.

import { dealStage, isDeletedDeal } from './deals';

export const DISCOVERY_CLOSE_REASONS = ['No training need now', 'No budget', 'Uses another provider', 'No response', "Meeting didn't happen", 'Other'];

// A discovery always has its meeting, booked or logged (Joel, 2026-10-28); firestore.rules checks the same.
export function hasMeeting(p: any): boolean {
  const a = p?.appointment;
  return !!a && (a.status === 'booked' || a.status === 'held') && ['face', 'online', 'call'].includes(a.mode) && /^\d{4}-\d{2}-\d{2}/.test(a.date || '');
}

export const DEFAULT_MOVE_BACK_HOURS = 48;

const ymd = (v: any): string => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '');

export function isDiscovery(p: any): boolean {
  return dealStage(p) === 'discovery';
}

export interface DiscoveryClose { date: string; reason: string; note: string; byId: string; byName: string; at: string }
export function discoveryClosed(p: any): DiscoveryClose | null {
  return isDiscovery(p) && p?.discoveryClosed && ymd(p.discoveryClosed.date) ? p.discoveryClosed : null;
}

export function isOpenDiscovery(p: any): boolean {
  return isDiscovery(p) && !discoveryClosed(p) && !isDeletedDeal(p);
}

// The day the discovery was made ('' for deals that never were one).
export function discoveryDate(p: any): string {
  return ymd(p?.discoveryDate);
}

// The day a record first touched the client: discovery, else the day the client asked, else the day it was made.
function firstDate(p: any): string {
  const made = typeof p?.createdAt === 'number' ? new Date(p.createdAt + 8 * 3600000).toISOString().slice(0, 10) : '';
  return discoveryDate(p) || ymd(p?.requestDate) || made;
}

// First touch point: no earlier discovery or deal with this client (any owner). The same day counts the one made first.
export function isFirstTouch(p: any, all: any[]): boolean {
  if (!discoveryDate(p) || !p?.clientId) return false;
  const mine = firstDate(p);
  return !all.some(d => {
    if (d.id === p.id || d.clientId !== p.clientId || isDeletedDeal(d)) return false;
    const other = firstDate(d);
    if (!other) return false;
    return other < mine || (other === mine && (Number(d.createdAt) || 0) < (Number(p.createdAt) || 0));
  });
}

// When the record became a deal: converted from a discovery, else made as a deal (ms).
export function dealSinceMs(p: any): number {
  const v = Number(p?.convertedAtMs) || Number(p?.createdAt) || 0;
  return Number.isFinite(v) ? v : 0;
}

// Can this person move the deal back to Discovery now? '' = yes, else why not.
export function moveBackProblem(p: any, viewer: { id: string; role: string }, hours: number, now = Date.now()): string {
  const st = dealStage(p);
  if (st === 'discovery' || isDeletedDeal(p)) return 'This is already a discovery.';
  if (st === 'won' || Number(p?.winCount) > 0 || p?.trainingCancelled) return 'A deal that was won stays a deal.';
  if (!hasMeeting(p)) return 'A discovery is always a meeting: book or log the appointment on this deal first.';
  if (viewer.role === 'management') return '';
  if (st !== 'lead' && st !== 'appointment') return 'Only Management can do this once the proposal is sent.';
  if (ymd(p?.proposalSentDate)) return 'Only Management can do this once the proposal is sent.';
  if (hours <= 0) return 'Only Management can move a deal back to Discovery.';
  const since = dealSinceMs(p);
  if (!since || now - since > hours * 3600000) return `Only Management can do this more than ${hours} hours after it became a deal.`;
  return '';
}

// ---------- KPIs (lib/kpi.ts) ----------
// A discovery meeting: logged while it was a discovery. Its date, for this owner ('' if it isn't one).
export function discoveryMeetingDate(p: any): string {
  return p?.appointment?.discovery === true && p.appointment.status === 'held' ? ymd(p.appointmentDate) || ymd(p.appointment.date) : '';
}
