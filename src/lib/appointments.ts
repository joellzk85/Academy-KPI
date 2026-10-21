// One appointment per deal (Joel, 2026-10-16). It's optional: a rep can go straight to "Proposal sent".
// Stored on the deal as `appointment`. Booking puts it on the team calendar (read from the deal, not copied).
// Logging it records the meeting and saves what the client wants straight into the deal's own fields.
// It counts toward KPI only once logged (appointmentDate is set then).

import { CalendarEvent } from '../types';
import { addDays, dealAppointmentDate, dealOwnerId, dealStage, todayIso, trainingDays } from './deals';
import { trainingTimeOf } from './trainingTime';

export type ApptMode = 'face' | 'online' | 'call';

export const MODE_LABELS: Record<ApptMode, string> = { face: 'Face-to-face', online: 'Online', call: 'Phone call' };

export interface DealAppointment {
  status: 'booked' | 'held';
  date: string;            // YYYY-MM-DD
  time?: string;           // HH:MM
  mode: ApptMode;
  bookedAt?: string; bookedById?: string; bookedByName?: string;
  metWith?: string;
  outcome?: string;
  nextStep?: string;
  loggedAt?: string; loggedById?: string; loggedByName?: string;
  legacy?: boolean;        // ticked under the old "Appointment held" button, no details
}

const isDate = (v: any) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);
const dayDiff = (from: string, to: string) => Math.round((new Date(to.slice(0, 10) + 'T00:00:00').getTime() - new Date(from.slice(0, 10) + 'T00:00:00').getTime()) / 86400000);

export function apptOf(deal: any): DealAppointment | null {
  const a = deal?.appointment;
  if (a && isDate(a.date) && (a.status === 'booked' || a.status === 'held')) return a;
  const legacyDate = dealAppointmentDate(deal);
  return legacyDate ? { status: 'held', date: legacyDate, mode: 'face', legacy: true } : null;
}

// Booked, the day has passed, and it still isn't logged a day later.
export function apptOverdue(deal: any, today = todayIso()): boolean {
  const a = apptOf(deal);
  return !!a && a.status === 'booked' && dayDiff(a.date, today) > 1;
}

// How many days after the meeting it was logged (0 if on time).
export function apptLateDays(a: DealAppointment | null): number {
  if (!a || a.status !== 'held' || !a.loggedAt) return 0;
  return Math.max(0, dayDiff(a.date, a.loggedAt));
}

const to12h = (t?: string) => {
  if (!t || !/^\d{1,2}:\d{2}/.test(t)) return '';
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
export const apptTime = to12h;

// Calendar entries for appointments, built from the deals each time (never stored twice).
export function appointmentEvents(deals: any[], nameOf: (id: string) => string): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  deals.forEach(d => {
    const a = d?.appointment;
    if (!a || !isDate(a.date)) return;
    const owner = nameOf(dealOwnerId(d));
    out.push({
      id: `appt_${d.id}`,
      date: a.date.slice(0, 10),
      time: to12h(a.time) || 'All day',
      title: `Appointment: ${d.client || 'client'}${owner ? ` (${owner})` : ''}${a.status === 'held' ? ' · held' : ''}`,
      color: 'bg-emerald-500',
    });
  });
  return out;
}

// Calendar entries for won deals' training dates (Joel, 2026-10-22), read from the deals like appointments.
// A training of several days shows on every day; the time is the deal's or the quotation's, else all day.
export function trainingEvents(deals: any[], quotes: any[]): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  deals.forEach(d => {
    if (dealStage(d) !== 'won' || !isDate(d?.trainingDate)) return;
    const time = trainingTimeOf(d, quotes.filter(q => q.pipelineId === d.id))?.text || 'All day';
    const prog = d.courseName ? ` – ${d.courseName}` : '';
    const count = Math.max(1, Math.ceil(trainingDays(d)));
    for (let i = 0; i < count; i++) {
      out.push({
        id: `train_${d.id}${i ? `_d${i + 1}` : ''}`,
        date: addDays(d.trainingDate.slice(0, 10), i),
        time,
        title: `Training: ${d.client || 'client'}${prog}${count > 1 ? ` (day ${i + 1} of ${count})` : ''}`,
        color: 'bg-sky-600',
      });
    }
  });
  return out;
}
