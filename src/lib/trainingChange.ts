// Change date / Cancel training on a won deal (Joel, 2026-10-21): the deal owner, Admin or Management ask;
// Management approves. Nobody approves their own request (a manager's request needs the other manager), the same
// rule as payment requests. Nothing changes while it waits: the deal stays won on its old date.
//
// Stored on the deal:
// - trainingChange = the latest request { kind, status, newDate, newDays, oldDate, oldDays, reason, note, by…, decided… }
// - trainingTodo   = what Admin still has to update after an approved change (revised quotation, PO, HRDC grant,
//                    venue…), ticked one by one; open items show in Admin work and My home.
// - trainingCancelled = { at, byName, reason, note, wonDate, value } once a cancellation is approved. The deal is then
//                    lost (lostReason CANCEL_LOST_REASON), so Closing RM no longer counts in the month it was won.
// The database rules refuse a won deal's training date changing, or a won deal becoming lost, unless a manager other
// than the requester approves a pending request in the same write.
// Pure logic (no database code), shared with the server (trainer portal).
import { dealOwnerId, dealStage, formatDate, trainingDateText, trainingDays } from './deals';
import { namedTrainerTasks } from './checklist';

export type ChangeKind = 'date' | 'cancel';
export type ChangeStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';

export interface TrainingChange {
  id: string;
  kind: ChangeKind;
  status: ChangeStatus;
  newDate?: string;        // date changes only
  newDays?: number;
  oldDate: string;
  oldDays: number;
  reason: string;
  note: string;
  byId: string;
  byName: string;
  byRole: string;
  at: string;
  decidedById?: string;
  decidedByName?: string;
  decidedAt?: string;
  rejectReason?: string;
}

export interface TodoItem { key: string; label: string; done: boolean; doneByName?: string; doneAt?: string }

export const DATE_REASONS = ['Client asked', 'Trainer not available', 'Venue not available', 'HRDC grant not ready', 'Other'];
export const CANCEL_REASONS = ['Client cancelled', 'No HRDC grant / levy', 'Not enough participants', 'Trainer not available', 'Other'];
export const CANCEL_LOST_REASON = 'Training cancelled';
export const KIND_TEXT: Record<ChangeKind, string> = { date: 'Date change', cancel: 'Cancellation' };

type Viewer = { id: string; role: string };

const ymd = (v: any): string => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '');
const words = (s: string) => String(s || '').trim().split(/\s+/).filter(Boolean).length;

// A won deal that has a training date: from here on the date only changes through a request.
export const dateLocked = (p: any): boolean => dealStage(p) === 'won' && !!ymd(p?.trainingDate) && p?.deleted !== true;

// The deal owner, Admin and Management can ask.
export function canRequestChange(p: any, viewer: Viewer): boolean {
  return dealStage(p) === 'won' && p?.deleted !== true && (viewer.role !== 'rep' || dealOwnerId(p) === viewer.id);
}

// The request waiting for approval, if any (it only counts while the deal is still won).
export function pendingChange(p: any): TrainingChange | null {
  const c = p?.trainingChange;
  return c && c.status === 'pending' && dealStage(p) === 'won' && p?.deleted !== true ? (c as TrainingChange) : null;
}

// Management, never their own request.
export function canDecideChange(c: TrainingChange | null, viewer: Viewer): boolean {
  return !!c && c.status === 'pending' && viewer.role === 'management' && c.byId !== viewer.id;
}

export function cancelledTraining(p: any): { at: string; byName: string; reason: string; note: string; wonDate: string; value: number } | null {
  return dealStage(p) === 'lost' && p?.trainingCancelled ? p.trainingCancelled : null;
}

export function changeProblem(kind: ChangeKind, p: any, newDate: string, newDays: number | null, reason: string, note: string): string {
  if (!reason) return kind === 'date' ? 'Choose why the date is changing.' : 'Choose why the training is cancelled.';
  if (kind === 'date') {
    if (!ymd(newDate)) return 'Pick the new training date.';
    if (newDays === null) return 'Enter the training days in half days, for example 0.5, 1.5 or 5 (up to 60).';
    if (ymd(newDate) === ymd(p?.trainingDate) && newDays === trainingDays(p)) return 'That is the same date and length as now.';
    if (reason === 'Other' && words(note) < 3) return 'Write a few words on why.';
    return '';
  }
  // A cancellation also becomes the lost explanation (the database needs at least 10 characters).
  if (words(note) < 3 || note.trim().length < 10) return 'Write a few words on what happened (at least 3 words).';
  return '';
}

export function changeSummary(c: TrainingChange): string {
  if (c.kind === 'cancel') return `Cancel the training on ${trainingDateText({ trainingDate: c.oldDate, trainingDays: c.oldDays }, true) || 'no date'}`;
  return `Move the training from ${trainingDateText({ trainingDate: c.oldDate, trainingDays: c.oldDays }, true)} to ${trainingDateText({ trainingDate: c.newDate, trainingDays: c.newDays }, true)}`;
}

export const changeWhy = (c: TrainingChange) => [c.reason, c.note].filter(s => s && s.trim()).join(': ');

// What Admin still has to update once the change is approved. Built from the deal, its checklist and quotations
// at approval time; ticked off one by one.
export function todoFor(kind: ChangeKind, deal: any, tasks: any[] | undefined, quotes: any[], paidCosts: number): TodoItem[] {
  const list = tasks || [];
  const hrdc = deal?.fundingType === 'hrdc' || deal?.fundingType === 'hrdc_topup';
  const grant = list.find(t => t.kind === 'grant');
  const grantStarted = !!(grant && (grant.done || grant.grantAppliedDate || grant.grantNumber));
  // The lead trainer and any co-trainers (2026-10-22), by name.
  const trainerNames = namedTrainerTasks(list).map(t => String(t.trainerName || '').trim() || 'the trainer');
  const trainer = trainerNames.length ? trainerNames.join(' and ') : '';
  const venue = list.find(t => t.kind === 'venue');
  const venueBooked = !!(venue && venue.needed !== false && (venue.venueId || String(venue.venueName || '').trim() || venue.done));
  const extras = list.some(t => (t.kind === 'bus' || t.kind === 'facilitator') && t.needed === true);
  const sent = quotes.some(q => q.status === 'sent');
  const item = (key: string, label: string): TodoItem => ({ key, label, done: false });
  const out: TodoItem[] = [];
  if (kind === 'date') {
    if (sent) out.push(item('quote', 'Send the client a revised quotation with the new date'));
    if (hrdc && grantStarted) out.push(item('grant', 'Update the training dates on the HRDC grant'));
    if (trainer) out.push(item('trainer', `Confirm the new date with ${trainer} and make a new PO (${trainerNames.length > 1 ? 'Trainer and Co-trainer steps' : 'Trainer step'})`));
    if (venueBooked) out.push(item('venue', 'Move the venue booking'));
    if (extras) out.push(item('extras', 'Move the bus and facilitator bookings'));
    out.push(item('client', 'Confirm the new date with the client (HR and participants)'));
  } else {
    if (hrdc && grantStarted) out.push(item('grant', 'Cancel the grant with HRDC'));
    if (trainer) out.push(item('trainer', `Tell ${trainer} (the trainer portal shows it cancelled)`));
    if (venueBooked) out.push(item('venue', 'Cancel the venue booking'));
    if (extras) out.push(item('extras', 'Cancel the bus and facilitator bookings'));
    if (paidCosts > 0) out.push(item('refunds', 'Ask for refunds of payments already made, where possible'));
    out.push(item('client', 'Invoice the client any cancellation fee (Money in), or note that there is none'));
  }
  return out;
}

export const openTodos = (p: any): TodoItem[] => (Array.isArray(p?.trainingTodo) ? p.trainingTodo : []).filter((t: TodoItem) => !t.done);

// A short line for lists (Admin work, My home).
export function changeFlagText(p: any): string {
  const c = pendingChange(p);
  if (c) return `${KIND_TEXT[c.kind]} waiting for Management approval (asked by ${c.byName})`;
  const n = openTodos(p).length;
  if (!n) return '';
  return cancelledTraining(p)
    ? `Training cancelled: ${n} thing${n === 1 ? '' : 's'} to wrap up`
    : `Training date changed: ${n} thing${n === 1 ? '' : 's'} to update`;
}

// For the deal history and the trainer portal: the last approved move, if any.
export function lastMove(p: any): { from: string; at: string } | null {
  const c = p?.trainingChange;
  return c && c.kind === 'date' && c.status === 'approved' ? { from: ymd(c.oldDate), at: String(c.decidedAt || '') } : null;
}

export const movedText = (c: TrainingChange) => `Training moved from ${formatDate(c.oldDate)} to ${formatDate(c.newDate || '')}`;
