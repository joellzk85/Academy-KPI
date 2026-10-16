// One appointment per deal (Joel, 2026-10-16). It's optional: a rep can go straight to "Proposal sent".
// Stored on the deal as `appointment`. Booking puts it on the team calendar (read from the deal, not copied).
// Logging it records the meeting and saves what the client wants straight into the deal's own fields.
// It counts toward KPI only once logged (appointmentDate is set then).

import { CalendarEvent } from '../types';
import { dealOwnerId, dealAppointmentDate, todayIso } from './deals';

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
