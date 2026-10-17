// NEXT Academy CRM: the shared Google Calendar, run on the server (2026-10-17).
//
// How it works, in plain terms:
// - The CRM server has its own Google identity (the App Hosting service account). Management shares the
//   company Google Calendar with that address once ("Make changes to events"). Nobody signs in to Google.
// - The Calendar ID is saved in config/google_calendar (only the server writes it, for Management).
// - Google -> CRM: /api/calendar/events lists the calendar's events for the CRM calendar (read-only there).
// - CRM -> Google: /api/calendar/sync makes the Google Calendar match the CRM's events, deal appointments
//   and training dates (src/lib/calendarSync.ts). What was sent is remembered in calendar_sync/{google id},
//   so unchanged items are skipped and removed ones are deleted from Google.

import type { Express } from 'express';
import { admin, UserError, callerFrom, managementFrom, route } from './serverAuth';
import { TIME_ZONE, buildDesired, googleIdFor, signature, GoogleItem } from './src/lib/calendarSync';
import { ownedByTeam } from './src/lib/linked';

const API = 'https://www.googleapis.com/calendar/v3';
const METADATA = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default';
const SCOPE = 'https://www.googleapis.com/auth/calendar';
const MAX_CHANGES_PER_SYNC = 150;

// ---------- The server's own Google access ----------
let cachedToken: { token: string; expires: number } | null = null;

async function metadata(path: string): Promise<Response> {
  try {
    return await fetch(`${METADATA}${path}`, { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(4000) });
  } catch {
    throw new UserError(503, 'calendar-not-live', 'Google Calendar only works on the live CRM website, not on a test copy.');
  }
}

async function serverToken(): Promise<string> {
  if (cachedToken && cachedToken.expires > Date.now() + 60_000) return cachedToken.token;
  const res = await metadata(`/token?scopes=${encodeURIComponent(SCOPE)}`);
  if (!res.ok) throw new UserError(503, 'calendar-not-live', 'The CRM server could not get Google access. Try again in a minute.');
  const data: any = await res.json();
  cachedToken = { token: data.access_token, expires: Date.now() + (Number(data.expires_in) || 300) * 1000 };
  return cachedToken.token;
}

async function serverEmail(): Promise<string> {
  try {
    const res = await metadata('/email');
    return res.ok ? (await res.text()).trim() : '';
  } catch {
    return '';
  }
}

// Calls Google Calendar and turns its errors into plain language.
async function google(path: string, init: { method?: string; body?: any; okStatuses?: number[] } = {}): Promise<{ status: number; data: any }> {
  const token = await serverToken();
  const res = await fetch(`${API}${path}`, {
    method: init.method || 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* empty body (e.g. delete) */ }
  if (res.ok || (init.okStatuses || []).includes(res.status)) return { status: res.status, data };
  const text = JSON.stringify(data || {});
  console.error('[calendar] Google said', res.status, text.slice(0, 500));
  if (/accessNotConfigured|SERVICE_DISABLED|has not been used|is disabled/i.test(text)) {
    throw new UserError(503, 'calendar-api-off', "The Google Calendar API isn't switched on yet for the CRM's Google Cloud project (setup step 1).");
  }
  if (res.status === 404 || res.status === 403) {
    throw new UserError(503, 'calendar-not-shared',
      "The CRM can't open that calendar. Check the Calendar ID, and that the calendar is shared with the CRM's address with \"Make changes to events\" (setup step 2).");
  }
  throw new UserError(502, 'calendar-error', `Google Calendar didn't accept the request (${res.status}). Try again in a minute.`);
}

// ---------- Settings ----------
type CalSettings = { calendarId?: string; calendarName?: string; lastSyncAt?: number; lastSyncError?: string; lastSyncSummary?: string };

async function readSettings(): Promise<CalSettings> {
  const { db } = admin();
  const snap = await db.collection('config').doc('google_calendar').get();
  return (snap.data() || {}) as CalSettings;
}

async function saveSettings(patch: CalSettings) {
  const { db } = admin();
  await db.collection('config').doc('google_calendar').set(patch, { merge: true });
}

const cal = (id: string) => `/calendars/${encodeURIComponent(id)}`;

// ---------- Sync CRM -> Google ----------
let syncing: Promise<any> | null = null;

async function loadSyncData() {
  const { db } = admin();
  const all = async (name: string) => (await db.collection(name).get()).docs.map(d => ({ ...d.data(), id: d.id }) as any);
  const [events, deals, checklistDocs, quotes, clients, programmes, venues, trainers, team] = await Promise.all([
    all('events'), all('pipelines'), all('deal_checklists'), all('quotations'), all('clients'), all('programmes'),
    all('venues_directory'), all('trainers_directory'), all('team'),
  ]);
  const checklists: Record<string, any> = {};
  checklistDocs.forEach((c: any) => { checklists[c.id] = c; });
  // Old deals and quotations not linked to a Team member yet stay off the calendar (src/lib/linked.ts).
  const teamIds = new Set<string>(team.map((t: any) => t.id));
  return { events, deals: deals.filter((d: any) => ownedByTeam(d, teamIds)), checklists, quotes: quotes.filter((q: any) => ownedByTeam(q, teamIds)), clients, programmes, venues, trainers, team: team.map((t: any) => ({ id: t.id, name: t.name || '' })) };
}

function eventBody(item: GoogleItem, id: string) {
  return {
    id,
    summary: item.summary,
    description: item.description,
    location: item.location,
    start: item.start,
    end: item.end,
    status: 'confirmed',
    extendedProperties: { private: { crm: '1', crmKey: item.key } },
  };
}

async function runSync(calendarId: string) {
  const { db } = admin();
  const desired = buildDesired(await loadSyncData());
  const sent = new Map<string, { key: string; sig: string; calendarId: string }>();
  (await db.collection('calendar_sync').get()).docs.forEach(d => sent.set(d.id, d.data() as any));

  let changes = 0, added = 0, updated = 0, removed = 0;
  const wanted = new Set<string>();
  for (const item of desired) {
    const gid = googleIdFor(item.key);
    wanted.add(gid);
    const sig = signature(item);
    const prev = sent.get(gid);
    if (prev && prev.sig === sig && prev.calendarId === calendarId) continue;
    if (changes >= MAX_CHANGES_PER_SYNC) continue;
    changes++;
    const body = eventBody(item, gid);
    // Update it if Google has it (even if someone deleted it there), else create it with our fixed id.
    const upd = await google(`${cal(calendarId)}/events/${gid}`, { method: 'PUT', body, okStatuses: [404] });
    if (upd.status === 404) {
      const ins = await google(`${cal(calendarId)}/events`, { method: 'POST', body, okStatuses: [409] });
      if (ins.status === 409) await google(`${cal(calendarId)}/events/${gid}`, { method: 'PUT', body });
      added++;
    } else {
      updated++;
    }
    await db.collection('calendar_sync').doc(gid).set({ key: item.key, sig, calendarId, at: Date.now() });
  }
  // Anything sent before that the CRM no longer has (deleted event, cancelled appointment, lost deal...)
  for (const [gid, prev] of sent) {
    if (wanted.has(gid)) continue;
    if (changes >= MAX_CHANGES_PER_SYNC) break;
    changes++;
    if (prev.calendarId === calendarId) {
      await google(`${cal(calendarId)}/events/${gid}`, { method: 'DELETE', okStatuses: [404, 410] });
    }
    await db.collection('calendar_sync').doc(gid).delete();
    removed++;
  }
  const more = changes >= MAX_CHANGES_PER_SYNC;
  const summary = `${added} added, ${updated} updated, ${removed} removed${more ? ' (more on the next sync)' : ''}`;
  await saveSettings({ lastSyncAt: Date.now(), lastSyncError: '', lastSyncSummary: summary });
  return { added, updated, removed, more, summary };
}

// ---------- Google -> CRM ----------
const pad = (n: number) => String(n).padStart(2, '0');
function to12h(dateTime: string): string {
  // Google returns local time with an offset when we ask for Malaysia time, e.g. 2026-10-20T14:30:00+08:00
  const m = dateTime.match(/T(\d{2}):(\d{2})/);
  if (!m) return '';
  let h = Number(m[1]);
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${pad(h)}:${m[2]} ${ap}`;
}

function daysBetween(start: string, endExclusive: string, cap = 14): string[] {
  const out: string[] = [];
  let d = new Date(start + 'T00:00:00Z');
  const end = new Date(endExclusive + 'T00:00:00Z');
  while (d < end && out.length < cap) {
    out.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 86400000);
  }
  return out.length ? out : [start];
}

// ---------- Routes ----------
export function registerCalendarRoutes(app: Express) {
  // Is the calendar set up? Management also gets the address to share the calendar with.
  app.post('/api/calendar/status', route(async req => {
    const caller = await callerFrom(req);
    const s = await readSettings();
    const shareWith = caller.role === 'management' ? await serverEmail() : '';
    return {
      configured: !!s.calendarId, calendarId: s.calendarId || '', calendarName: s.calendarName || '',
      lastSyncAt: s.lastSyncAt || 0, lastSyncError: s.lastSyncError || '', lastSyncSummary: s.lastSyncSummary || '',
      shareWith,
    };
  }));

  // Management saves the Calendar ID; it's tested before it's saved. Blank = disconnect.
  app.post('/api/calendar/settings', route(async req => {
    await managementFrom(req);
    const calendarId = String(req.body?.calendarId || '').trim();
    const { db } = admin();
    const old = await readSettings();
    if (!calendarId) {
      await db.collection('config').doc('google_calendar').set({ calendarId: '', calendarName: '', lastSyncError: '', lastSyncSummary: '' }, { merge: true });
      return { configured: false };
    }
    if (calendarId.length > 300 || /\s/.test(calendarId)) throw new UserError(400, 'bad-calendar-id', "That doesn't look like a Calendar ID. It usually looks like an email address.");
    const meta = await google(cal(calendarId));
    await google(`${cal(calendarId)}/events?maxResults=1`);   // can we read events too?
    if (old.calendarId && old.calendarId !== calendarId) {
      // A different calendar: forget what was sent to the old one (its events stay there).
      const snap = await db.collection('calendar_sync').get();
      await Promise.all(snap.docs.map(d => d.ref.delete()));
    }
    await saveSettings({ calendarId, calendarName: meta.data?.summary || calendarId, lastSyncError: '' });
    return { configured: true, calendarName: meta.data?.summary || calendarId };
  }));

  // Events on the Google Calendar between two dates, for the CRM calendar (CRM's own items are left out).
  app.post('/api/calendar/events', route(async req => {
    await callerFrom(req);
    const s = await readSettings();
    if (!s.calendarId) return { events: [] };
    const from = String(req.body?.from || '').slice(0, 10);
    const to = String(req.body?.to || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new UserError(400, 'bad-range', 'Choose a date range.');
    const params = new URLSearchParams({
      timeMin: `${from}T00:00:00+08:00`, timeMax: `${to}T23:59:59+08:00`, singleEvents: 'true', orderBy: 'startTime',
      maxResults: '2500', timeZone: TIME_ZONE,
    });
    const { data } = await google(`${cal(s.calendarId)}/events?${params}`);
    const events: any[] = [];
    (data?.items || []).forEach((e: any) => {
      if (e.status === 'cancelled' || e.extendedProperties?.private?.crm === '1') return;
      const title = e.summary || '(No title)';
      if (e.start?.date) {
        daysBetween(e.start.date, e.end?.date || e.start.date).forEach((day, i) =>
          events.push({ id: `g_${e.id}_${i}`, date: day, time: 'All day', title, link: e.htmlLink || '' }));
      } else if (e.start?.dateTime) {
        events.push({ id: `g_${e.id}`, date: e.start.dateTime.slice(0, 10), time: to12h(e.start.dateTime), title, link: e.htmlLink || '' });
      }
    });
    return { events };
  }));

  // Make Google match the CRM. Runs at most once a minute unless "force" (e.g. right after adding an event).
  app.post('/api/calendar/sync', route(async req => {
    await callerFrom(req);
    const s = await readSettings();
    if (!s.calendarId) return { skipped: 'not-configured' };
    if (!req.body?.force && s.lastSyncAt && Date.now() - s.lastSyncAt < 60_000) return { skipped: 'recent', summary: s.lastSyncSummary || '' };
    if (syncing) return { skipped: 'running' };
    syncing = runSync(s.calendarId);
    try {
      return await syncing;
    } catch (err: any) {
      await saveSettings({ lastSyncAt: Date.now(), lastSyncError: err?.message || 'Sync failed' }).catch(() => {});
      throw err;
    } finally {
      syncing = null;
    }
  }));
}
