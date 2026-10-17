// The shared Google Calendar, from the browser (2026-10-17).
// The CRM server does all the talking to Google (serverCalendar.ts); nobody signs in to Google here.
// This replaced the old pop-up Google sign-in, which needed Google sign-in switched on in Firebase.

import { callServer } from './firebase';
import { CalendarEvent } from '../types';

export interface CalendarStatus {
  configured: boolean;
  calendarId: string;
  calendarName: string;
  lastSyncAt: number;
  lastSyncError: string;
  lastSyncSummary: string;
  shareWith: string;          // the CRM server's address to share the calendar with (Management only)
}

export const calendarStatus = () => callServer<CalendarStatus & { ok: true }>('/api/calendar/status', {}, true);

export const saveCalendarId = (calendarId: string) =>
  callServer<{ configured: boolean; calendarName?: string }>('/api/calendar/settings', { calendarId }, true);

export const syncCalendar = (force = false) =>
  callServer<{ skipped?: string; summary?: string }>('/api/calendar/sync', { force }, true);

// Events from the Google Calendar, shaped like CRM calendar events (read-only in the CRM).
export async function googleEvents(from: string, to: string): Promise<CalendarEvent[]> {
  const res = await callServer<{ events: { id: string; date: string; time: string; title: string; link: string }[] }>('/api/calendar/events', { from, to }, true);
  return (res.events || []).map(e => ({ id: e.id, date: e.date, time: e.time, title: e.title, color: 'bg-sky-500', source: 'google' as const, link: e.link }));
}
