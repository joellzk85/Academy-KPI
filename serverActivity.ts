// Logins and sensitive actions (Joel, 2026-10-24), run on the server so nobody can fake or skip them.
// Never shown or mentioned to staff. What is kept and why: src/lib/loginSessions.ts.
// - Password login: serverAuth.ts calls recordLogin / recordFailedLogin.
// - /api/activity/open: the CRM was opened (useActivityTracker). Right after a password login it carries on the
//   login's own record; otherwise it starts an "Opened the CRM" record.
// - /api/activity/beat: one active minute of that session (sent with the Login log's own minute).
// - /api/activity/action: deletes and downloads the browser reports (lib/firestoreTracked.ts, CSV and PDF exports).
//   Downloads made by the server (backups, the files ZIP) and team / password changes are logged by their routes.
// - The place comes from the IP address (ipinfo.io; IPINFO_TOKEN in the server settings is optional), kept in
//   memory for a week per address so each address is looked up rarely. It finds the town, not an exact spot.

import type { Express, Request } from 'express';
import crypto from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { admin, callerFrom, route } from './serverAuth';
import { browserOf, deviceOf } from './src/lib/proposalTracking';
import {
  ACTIVITY_KINDS, ActivityKind, DEFAULT_WORK_END, DEFAULT_WORK_START, SAFE_ID, SessionFlag, SessionKind, WorkHours,
  isAfterHours, osOf, recordLabel,
} from './src/lib/loginSessions';

const LIVE_MS = 3 * 60_000;   // a session with no active minute for 3 minutes is no longer "online"

export function ipOf(req: Request): string {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim().slice(0, 60);
}

// ---------- Place from the IP address ----------
type Place = { city?: string; region?: string; country?: string; isp?: string };
const places = new Map<string, { place: Place; at: number }>();
const PRIVATE_IP = /^(::1$|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::ffff:127\.|fc|fd|fe80)/i;

async function placeOf(ip: string): Promise<Place> {
  if (!ip) return {};
  if (PRIVATE_IP.test(ip)) return { city: 'Local network' };
  const hit = places.get(ip);
  if (hit && Date.now() - hit.at < 7 * 24 * 3600_000) return hit.place;
  try {
    const token = process.env.IPINFO_TOKEN ? `?token=${encodeURIComponent(process.env.IPINFO_TOKEN)}` : '';
    const res = await fetch(`https://ipinfo.io/${encodeURIComponent(ip)}/json${token}`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return {};
    const d: any = await res.json();
    const clean = (v: any) => (typeof v === 'string' ? v.slice(0, 80) : '');
    const place: Place = { city: clean(d.city), region: clean(d.region), country: clean(d.country), isp: clean(d.org).replace(/^AS\d+\s*/, '') };
    places.set(ip, { place, at: Date.now() });
    return place;
  } catch {
    return {};
  }
}
const placeKey = (p: Place) => [p.city || p.region, p.country].filter(Boolean).join('|').toLowerCase().replace(/[.\/]/g, ' ');

// ---------- Working hours (Login log Rules) ----------
let hoursCache: { at: number; hours: WorkHours } | null = null;
async function workHours(): Promise<WorkHours> {
  if (hoursCache && Date.now() - hoursCache.at < 60_000) return hoursCache.hours;
  const d: any = (await admin().db.collection('config').doc('login_rules').get()).data() || {};
  const num = (v: any, def: number) => (typeof v === 'number' && v >= 0 && v <= 1440 ? v : def);
  const days = Array.isArray(d.workDays) ? d.workDays.filter((n: any) => Number.isInteger(n) && n >= 0 && n <= 6) : [];
  const hours = { workDays: days.length ? days : [1, 2, 3, 4, 5], workStart: num(d.workStart, DEFAULT_WORK_START), workEnd: num(d.workEnd, DEFAULT_WORK_END) };
  hoursCache = { at: Date.now(), hours };
  return hours;
}

// ---------- Device ----------
function deviceFrom(req: Request, body: any) {
  const ua = String(req.headers['user-agent'] || '');
  const device = ['laptop', 'phone', 'tablet'].includes(body?.device) ? body.device : deviceOf(ua, 0, 1200);
  const deviceId = typeof body?.deviceId === 'string' && SAFE_ID.test(body.deviceId) ? body.deviceId : '';
  return { device, browser: browserOf(ua), os: osOf(ua), deviceId };
}

const newId = () => crypto.randomBytes(12).toString('hex');
const sessionIdFrom = (v: any) => (typeof v === 'string' && SAFE_ID.test(v) ? v : '');

// Starts a session record. The place and the "new place" / "two places at once" checks follow without
// holding up the login.
async function startSession(memberId: string, kind: SessionKind, sessionId: string, req: Request, body: any, extraFlags: SessionFlag[] = []) {
  const { db } = admin();
  const now = Date.now();
  const ip = ipOf(req);
  const dev = deviceFrom(req, body);
  const flags = new Set<SessionFlag>(extraFlags);
  if (isAfterHours(now, await workHours())) flags.add('after_hours');

  // New device: only when this person already has known devices (the first ever isn't "new").
  const knownRef = db.collection('login_devices').doc(memberId);
  const known: any = (await knownRef.get()).data() || {};
  const devices = known.devices || {};
  if (dev.deviceId && Object.keys(devices).length && !devices[dev.deviceId]) flags.add('new_device');

  const ref = db.collection('login_sessions').doc(sessionId || newId());
  await ref.set({ memberId, kind, at: now, lastAt: now, minutes: 0, ip, ...dev, flags: [...flags] });
  if (kind !== 'fail' && dev.deviceId) {
    await knownRef.set({ devices: { [dev.deviceId]: { first: devices[dev.deviceId]?.first || now, last: now, label: `${dev.os} · ${dev.browser}` } } }, { merge: true });
  }

  void (async () => {
    const place = await placeOf(ip);
    const key = placeKey(place);
    const update: Record<string, any> = { ...place };
    if (key && place.city !== 'Local network') {
      const knownPlaces = known.places || {};
      if (Object.keys(knownPlaces).length && !knownPlaces[key]) update.flags = FieldValue.arrayUnion('new_place');
      if (kind !== 'fail' && !knownPlaces[key]) await knownRef.set({ places: { [key]: now } }, { merge: true });
    }
    await ref.update(update);
    if (kind !== 'fail') await markLive(memberId, ref.id, { ip, deviceId: dev.deviceId, device: dev.device, city: place.city || '' });
  })().catch(e => console.error('[activity] place check failed:', e?.message || e));
}

// Who is online now; flags "two places at once" (another device on another internet connection, both active in
// the last 3 minutes).
async function markLive(memberId: string, sessionId: string, me: { ip: string; deviceId: string; device: string; city: string }) {
  const { db } = admin();
  const liveRef = db.collection('login_live').doc(memberId);
  const now = Date.now();
  const partners = await db.runTransaction(async tx => {
    const live: any = (await tx.get(liveRef)).data() || {};
    const sessions: Record<string, any> = {};
    Object.entries(live.sessions || {}).forEach(([id, s]: [string, any]) => { if (now - (s?.lastAt || 0) < LIVE_MS) sessions[id] = s; });
    const mine = { ...me, ...(sessions[sessionId] || {}), lastAt: now };
    const others = Object.entries(sessions).filter(([id, s]) =>
      id !== sessionId && s.ip !== me.ip && (!s.deviceId || !me.deviceId || s.deviceId !== me.deviceId));
    const fresh = others.filter(([id]) => !(mine.sharedWith || []).includes(id));
    if (fresh.length) mine.sharedWith = [...(mine.sharedWith || []), ...fresh.map(([id]) => id)];
    sessions[sessionId] = mine;
    fresh.forEach(([id, s]) => { sessions[id] = { ...s, sharedWith: [...(s.sharedWith || []), sessionId] }; });
    tx.set(liveRef, { sessions, updatedAt: now });
    return fresh;
  });
  for (const [id, s] of partners) {
    await db.collection('login_sessions').doc(sessionId).update({ flags: FieldValue.arrayUnion('shared'), sharedWith: { ip: s.ip, city: s.city || '', device: s.device || '' } });
    await db.collection('login_sessions').doc(id).update({ flags: FieldValue.arrayUnion('shared'), sharedWith: { ip: me.ip, city: me.city, device: me.device } }).catch(() => {});
  }
}

// ---------- Called by the login route (serverAuth.ts) ----------
export async function recordLogin(memberId: string, req: Request) {
  try {
    await startSession(memberId, 'login', sessionIdFrom(req.body?.sessionId), req, req.body);
  } catch (e: any) { console.error('[activity] login not recorded:', e?.message || e); }
}

export async function recordFailedLogin(memberId: string, req: Request, failsInWindow: number) {
  try {
    const { db } = admin();
    if (!(await db.collection('team').doc(memberId).get()).exists) return;
    await startSession(memberId, 'fail', '', req, req.body, failsInWindow >= 3 ? ['many_fails'] : []);
  } catch (e: any) { console.error('[activity] failed login not recorded:', e?.message || e); }
}

// ---------- Sensitive actions ----------
export async function logActivity(memberId: string, req: Request, kind: ActivityKind, what: string, path = '') {
  try {
    const ip = ipOf(req);
    const place = await placeOf(ip);
    await admin().db.collection('activity_log').add({
      memberId, at: Date.now(), kind, what: what.slice(0, 200), ...(path ? { path: path.slice(0, 300) } : {}), ip, city: place.city || '',
    });
  } catch (e: any) { console.error('[activity] action not recorded:', e?.message || e); }
}

// At most 60 reported actions a minute per person (a big clean-up is still recorded, a flood is not).
const actionCounts = new Map<string, { n: number; since: number }>();
function underLimit(memberId: string, n: number) {
  const now = Date.now();
  const c = actionCounts.get(memberId);
  if (!c || now - c.since > 60_000) { actionCounts.set(memberId, { n, since: now }); return n <= 60; }
  c.n += n;
  return c.n <= 60;
}

// ---------- Routes ----------
export function registerActivityRoutes(app: Express) {
  app.post('/api/activity/open', route(async req => {
    const caller = await callerFrom(req);
    const sessionId = sessionIdFrom(req.body?.sessionId);
    if (!sessionId) return {};
    const { db } = admin();
    const ref = db.collection('login_sessions').doc(sessionId);
    // Already recorded: the login's own record, carried on from the login screen.
    if ((await ref.get()).exists) return {};
    await startSession(caller.memberId, 'open', sessionId, req, req.body);
    return {};
  }));

  app.post('/api/activity/beat', route(async req => {
    const caller = await callerFrom(req);
    const sessionId = sessionIdFrom(req.body?.sessionId);
    if (!sessionId) return {};
    const { db } = admin();
    const ref = db.collection('login_sessions').doc(sessionId);
    const now = Date.now();
    const s = await db.runTransaction(async tx => {
      const d: any = (await tx.get(ref)).data();
      if (!d || d.memberId !== caller.memberId || (d.minutes > 0 && now - (d.lastAt || 0) < 50_000)) return null;
      tx.update(ref, { minutes: FieldValue.increment(1), lastAt: now });
      return d;
    });
    if (!s) return {};
    if (!(s.flags || []).includes('after_hours') && isAfterHours(now, await workHours())) {
      await ref.update({ flags: FieldValue.arrayUnion('after_hours') });
    }
    await markLive(caller.memberId, sessionId, { ip: ipOf(req), deviceId: s.deviceId || '', device: s.device || '', city: s.city || '' });
    return {};
  }));

  app.post('/api/activity/action', route(async req => {
    const caller = await callerFrom(req);
    const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 30) : [];
    const clean = items.filter((i: any) => ACTIVITY_KINDS.includes(i?.kind) && ['download', 'delete', 'soft_delete'].includes(i.kind));
    if (!clean.length || !underLimit(caller.memberId, clean.length)) return {};
    for (const i of clean) {
      const path = typeof i.path === 'string' ? i.path : '';
      const what = i.kind === 'download' ? String(i.what || 'File') : recordLabel(path);
      await logActivity(caller.memberId, req, i.kind, what, path);
    }
    return {};
  }));
}
