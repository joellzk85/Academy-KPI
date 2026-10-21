// Google Calendar sync (2026-10-17): what the shared Google Calendar should contain, worked out from the CRM.
// Pure functions (no network), used by the server (serverCalendar.ts) and tested on their own.
//   - CRM calendar events            (events/{id})
//   - deal appointments              (pipelines[].appointment)
//   - training dates of won deals    (pipelines[].trainingDate), at the training time (quotation or deal), else all day;
//     a training of several days (pipelines[].trainingDays) gets one event per day ("train:<id>", "train:<id>:d2", …)
// Each item has a fixed Google event id made from its CRM key, so syncing twice never makes duplicates.

import { addDays, dealOwnerId, dealStage, trainingDays } from './deals';
import { dealContact } from './contacts';
import { MODE_LABELS } from './appointments';
import { ChecklistTask, dealVenue, effectiveTrainer, leadTrainerTask } from './checklist';
import { parseTimeRange, trainingTimeOf } from './trainingTime';

export const TIME_ZONE = 'Asia/Kuala_Lumpur';

export interface GoogleItem {
  key: string;                     // e.g. "ev:ev_123", "appt:deal_9", "train:deal_9"
  summary: string;
  description: string;
  location?: string;
  start: { date?: string; dateTime?: string; timeZone?: string };
  end: { date?: string; dateTime?: string; timeZone?: string };
}

export interface SyncData {
  events: any[]; deals: any[]; checklists: Record<string, any>; quotes: any[];
  clients: any[]; programmes: any[]; venues: any[]; trainers: any[]; team: { id: string; name: string }[];
}

const isDate = (v: any) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);

function nextDay(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + 1));
  return x.toISOString().slice(0, 10);
}

// "10:00 AM", "2:30pm", "14:30", "All day" -> 24-hour [h, m], or null for all day / unreadable.
export function parseTime(t?: string): [number, number] | null {
  const s = (t || '').trim().toLowerCase();
  if (!s || s.includes('all day')) return null;
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return [h, min];
}

// Start and end for Google: all day, or one hour from the time (Malaysia time).
export function whenFor(date: string, time?: string, hours = 1): Pick<GoogleItem, 'start' | 'end'> {
  const d = date.slice(0, 10);
  const hm = parseTime(time);
  if (!hm) return { start: { date: d }, end: { date: nextDay(d) } };
  const pad = (n: number) => String(n).padStart(2, '0');
  const endMin = hm[0] * 60 + hm[1] + hours * 60;
  const endDate = endMin >= 24 * 60 ? nextDay(d) : d;
  const e = endMin % (24 * 60);
  return {
    start: { dateTime: `${d}T${pad(hm[0])}:${pad(hm[1])}:00`, timeZone: TIME_ZONE },
    end: { dateTime: `${endDate}T${pad(Math.floor(e / 60))}:${pad(e % 60)}:00`, timeZone: TIME_ZONE },
  };
}

// A start-end time on one day (Malaysia time).
export function rangeOn(date: string, start: [number, number], end: [number, number]): Pick<GoogleItem, 'start' | 'end'> {
  const d = date.slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    start: { dateTime: `${d}T${pad(start[0])}:${pad(start[1])}:00`, timeZone: TIME_ZONE },
    end: { dateTime: `${d}T${pad(end[0])}:${pad(end[1])}:00`, timeZone: TIME_ZONE },
  };
}

export function buildDesired(s: SyncData): GoogleItem[] {
  const out: GoogleItem[] = [];
  const nameOf = (id?: string) => s.team.find(p => p.id === id)?.name || '';
  const clientOf = (d: any) => s.clients.find(c => c.id === d.clientId);
  const clientName = (d: any) => clientOf(d)?.companyName || d.client || 'Client';
  const programmeName = (d: any) => s.programmes.find(p => p.id === d.programmeId)?.name || d.courseName || '';
  const lines = (...xs: (string | false | undefined)[]) => xs.filter(Boolean).join('\n');
  const footer = 'From the NEXT Academy CRM. Change it in the CRM; changes made here are overwritten.';

  // 1. CRM calendar events
  s.events.forEach(ev => {
    if (!ev?.id || !isDate(ev.date) || !String(ev.title || '').trim()) return;
    const team = (ev.attendees || []).map(nameOf).filter(Boolean);
    out.push({
      key: `ev:${ev.id}`,
      summary: String(ev.title).trim(),
      description: lines(team.length > 0 && `Team: ${team.join(', ')}`, footer),
      ...whenFor(ev.date, ev.time),
    });
  });

  s.deals.forEach(d => {
    if (!d?.id) return;
    const owner = nameOf(dealOwnerId(d));
    const prog = programmeName(d);
    const client = clientOf(d);
    const pic = client ? dealContact(d, client) : null;
    const contact = pic ? [pic.name, pic.phone].filter(Boolean).join(', ') : '';

    // 2. Deal appointments (booked or held), at the booked time
    const a = d.appointment;
    if (a && isDate(a.date)) {
      out.push({
        key: `appt:${d.id}`,
        summary: `Appointment: ${clientName(d)}${owner ? ` (${owner})` : ''}${a.status === 'held' ? ' · held' : ''}`,
        description: lines(
          a.mode && `Type: ${(MODE_LABELS as any)[a.mode] || a.mode}`,
          prog && `Programme: ${prog}`,
          contact && `Client contact: ${contact}`,
          owner && `Deal owner: ${owner}`,
          footer,
        ),
        ...whenFor(a.date, a.time),
      });
    }

    // 3. Training day of a won deal, all day
    if (dealStage(d) === 'won' && isDate(d.trainingDate)) {
      const quotes = s.quotes.filter(q => q.pipelineId === d.id);
      const cl = s.checklists[d.id] || null;
      const venue = dealVenue(cl, quotes, s.venues);
      const trainerTask = leadTrainerTask<ChecklistTask>(cl?.tasks);
      const trainer = effectiveTrainer(trainerTask, quotes, s.trainers);
      // The time comes from the quotation, or the deal if it was changed there; unreadable = all day.
      const time = trainingTimeOf(d, quotes);
      const range = parseTimeRange(time?.text);
      const count = Math.max(1, Math.ceil(trainingDays(d)));
      for (let i = 0; i < count; i++) {
      const day = addDays(d.trainingDate, i);
      out.push({
        key: i === 0 ? `train:${d.id}` : `train:${d.id}:d${i + 1}`,
        summary: `Training: ${clientName(d)}${prog ? ` – ${prog}` : ''}${count > 1 ? ` (day ${i + 1} of ${count})` : ''}`,
        description: lines(
          prog && `Programme: ${prog}`,
          time && `Time: ${time.text}`,
          `Venue: ${venue ? venue.name : 'not set yet'}`,
          `Trainer: ${trainer ? trainer.name : 'not set yet'}`,
          d.participants && `Participants: ${d.participants}`,
          owner && `Deal owner: ${owner}`,
          footer,
        ),
        location: venue?.name || undefined,
        ...(range ? rangeOn(day, range.start, range.end) : whenFor(day)),
      });
      }
    }
  });
  return out;
}

// Google event ids may only use 0-9 and a-v (base32hex), 5 to 1024 characters.
export function googleIdFor(key: string): string {
  const alphabet = '0123456789abcdefghijklmnopqrstuv';
  const bytes = new TextEncoder().encode(key);
  let bits = 0, value = 0, out = 'crm';
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out.slice(0, 1024);
}

// A short fingerprint of an item, so unchanged items aren't sent to Google again.
export function signature(item: GoogleItem): string {
  const s = JSON.stringify([item.summary, item.description, item.location || '', item.start, item.end]);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${s.length}:${(h >>> 0).toString(36)}`;
}
