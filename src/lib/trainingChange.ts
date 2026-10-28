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
// Change value / pax (Joel, 2026-10-22, KPI integrity): once won, a deal's value, participants, programme and funding
// type are locked (valueLocked). The value and pax change only through a 'value' request Management approves;
// approval appends to deal.valueChanges (last 20). Approved date changes count deal.dateChangeCount and keep
// deal.firstTrainingDate (the date before the first move); both feed the red flags in lib/dealIntegrity.ts.
// The database rules refuse a won deal's training date changing, its value or pax changing, or a won deal becoming
// lost, unless a manager other than the requester approves a pending request in the same write.
// Pure logic (no database code), shared with the server (trainer portal).
import { dealOwnerId, dealStage, dealValue, formatDate, trainingDateText, trainingDays } from './deals';
import { namedTrainerTasks } from './checklist';
import { isSuperManager } from './superManager';

export type ChangeKind = 'date' | 'cancel' | 'value';
export type ChangeStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';

export interface TrainingChange {
  id: string;
  kind: ChangeKind;
  status: ChangeStatus;
  newDate?: string;        // date changes only
  newDays?: number;
  newRunId?: string;       // a public programme moving its companies to another run (lib/publicProgrammes.ts)
  newRunTitle?: string;
  newValue?: number;      // value changes only
  newPax?: number;
  oldValue?: number;
  oldPax?: number;
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
export const VALUE_REASONS = ['Fewer participants', 'More participants', 'Price changed', 'Part of the training cancelled', 'Other'];
export const CANCEL_LOST_REASON = 'Training cancelled';
export const KIND_TEXT: Record<ChangeKind, string> = { date: 'Date change', cancel: 'Cancellation', value: 'Value change' };
export const MAX_VALUE_CHANGES = 20;

type Viewer = { id: string; role: string };

const ymd = (v: any): string => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '');
const words = (s: string) => String(s || '').trim().split(/\s+/).filter(Boolean).length;

// A won deal that has a training date: from here on the date only changes through a request.
export const dateLocked = (p: any): boolean => dealStage(p) === 'won' && !!ymd(p?.trainingDate) && p?.deleted !== true;

// A won deal: its value, participants, programme and funding type no longer change in Edit details or by ticking
// quotations; value and pax change only through "Change value / pax" (Management approves).
export const valueLocked = (p: any): boolean => dealStage(p) === 'won' && p?.deleted !== true;

// Participants as a whole number (0 when not set).
export const paxOf = (p: any): number => Math.max(0, Math.round(Number(p?.participants) || 0));

// The deal owner, Admin and Management can ask.
export function canRequestChange(p: any, viewer: Viewer): boolean {
  return dealStage(p) === 'won' && p?.deleted !== true && (viewer.role !== 'rep' || dealOwnerId(p) === viewer.id);
}

// The request waiting for approval, if any (it only counts while the deal is still won).
export function pendingChange(p: any): TrainingChange | null {
  const c = p?.trainingChange;
  return c && c.status === 'pending' && dealStage(p) === 'won' && p?.deleted !== true ? (c as TrainingChange) : null;
}

// Management, never their own request, except with the owner override (lib/superManager.ts), which asks twice.
export function canDecideChange(c: TrainingChange | null, viewer: Viewer): boolean {
  return !!c && c.status === 'pending' && viewer.role === 'management' && (c.byId !== viewer.id || isSuperManager(viewer));
}

export function cancelledTraining(p: any): { at: string; byName: string; reason: string; note: string; wonDate: string; value: number } | null {
  return dealStage(p) === 'lost' && p?.trainingCancelled ? p.trainingCancelled : null;
}

export function changeProblem(kind: ChangeKind, p: any, newDate: string, newDays: number | null, reason: string, note: string): string {
  if (!reason) return kind === 'date' ? 'Choose why the date is changing.' : kind === 'value' ? 'Choose why the value is changing.' : 'Choose why the training is cancelled.';
  if (kind === 'value') return '';
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

// Change value / pax: the new value must be above 0, and the value or pax must differ from now; a note of 3+ words.
export function valueChangeProblem(p: any, newValue: number, newPax: number, reason: string, note: string): string {
  if (!reason) return 'Choose why the value is changing.';
  if (!Number.isFinite(newValue) || newValue <= 0) return 'Enter the new deal value, above RM 0.';
  if (!Number.isFinite(newPax) || newPax < 0 || newPax > 10000 || Math.round(newPax) !== newPax) return 'Enter the participants as a whole number.';
  if (Math.abs(newValue - dealValue(p)) < 0.005 && newPax === paxOf(p)) return 'That is the same value and participants as now.';
  if (words(note) < 3) return 'Write a few words on why (at least 3 words).';
  return '';
}

const rm = (n: number) => 'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const paxText = (n: number) => (n ? `${n} pax` : 'no pax set');

export function changeSummary(c: TrainingChange): string {
  if (c.kind === 'value') {
    const parts: string[] = [];
    if (c.newValue !== c.oldValue) parts.push(`the value from ${rm(c.oldValue || 0)} to ${rm(c.newValue || 0)}`);
    if (c.newPax !== c.oldPax) parts.push(`participants from ${paxText(c.oldPax || 0)} to ${paxText(c.newPax || 0)}`);
    return `Change ${parts.join(' and ') || 'the value'}`;
  }
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
  } else if (kind === 'value') {
    if (sent) out.push(item('quote', 'Send the client a revised quotation with the new value and participants'));
    if (hrdc && grantStarted) out.push(item('grant', 'Update the HRDC grant (participants and amount)'));
    out.push(item('client', 'Confirm the new value and participants with the client'));
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
  if (cancelledTraining(p)) return `Training cancelled: ${n} thing${n === 1 ? '' : 's'} to wrap up`;
  return p?.trainingChange?.kind === 'value'
    ? `Deal value changed: ${n} thing${n === 1 ? '' : 's'} to update`
    : `Training date changed: ${n} thing${n === 1 ? '' : 's'} to update`;
}

// For the deal history and the trainer portal: the last approved move, if any.
export function lastMove(p: any): { from: string; at: string } | null {
  const c = p?.trainingChange;
  return c && c.kind === 'date' && c.status === 'approved' ? { from: ymd(c.oldDate), at: String(c.decidedAt || '') } : null;
}

export const movedText = (c: TrainingChange) => `Training moved from ${formatDate(c.oldDate)} to ${formatDate(c.newDate || '')}`;
