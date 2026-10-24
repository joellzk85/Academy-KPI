// NEXT Academy CRM: restore, the parts that don't talk to the database (2026-10-24).
// The server (serverRestore.ts) reads the CRM as it was, either from a saved daily copy (a file in storage) or at an
// exact minute in the last 7 days (Google's point-in-time recovery), and puts records back. Pure, so it can be tested.

// Never saved in the daily copies and never restored: logins, passwords, the people list, the login log and the
// server's own bookkeeping. A restore can't bring back a removed person or an old password.
export const NEVER_RESTORE = [
  'secrets', 'server_secrets', 'auth_map', 'owner_access', 'team', 'trainer_accounts',
  'login_days', 'login_sessions', 'login_live', 'login_devices', 'activity_log', 'restore_log', 'calendar_sync',
];
// Settings never restored (server-only setup).
export const NEVER_RESTORE_CONFIG = ['passwords', 'google_calendar', 'backup_settings', 'outlook', 'setup'];

export const restorable = (list: string) => !!list && !NEVER_RESTORE.includes(list);
export const restorableDoc = (list: string, id: string) => restorable(list) && !(list === 'config' && NEVER_RESTORE_CONFIG.includes(id));

export const PITR_DAYS = 7;
export const DEFAULT_KEEP_DAYS = 365;
export const keepDaysFrom = (v: any) => Math.min(3650, Math.max(30, Math.round(Number(v)) || DEFAULT_KEEP_DAYS));

// ---------- Values in a saved copy ----------
// Firestore dates, references, map points and bytes don't survive JSON, so they are tagged.
export type Encoded = any;

export function encodeValue(v: any): Encoded {
  if (v === null || v === undefined || typeof v !== 'object') return v ?? null;
  if (Array.isArray(v)) return v.map(encodeValue);
  if (typeof v.toDate === 'function' && typeof v.seconds === 'number' && typeof v.nanoseconds === 'number') {
    return { __t: 'ts', s: v.seconds, n: v.nanoseconds };
  }
  if (typeof v.path === 'string' && v.firestore) return { __t: 'ref', path: v.path };
  if (typeof v.latitude === 'number' && typeof v.longitude === 'number' && Object.keys(v).length <= 2) {
    return { __t: 'geo', lat: v.latitude, lng: v.longitude };
  }
  if (v instanceof Uint8Array) return { __t: 'bytes', b64: toBase64(v) };
  const out: Record<string, any> = {};
  Object.keys(v).sort().forEach(k => { out[k] = encodeValue(v[k]); });
  return out;
}

export interface Decoders {
  ts: (seconds: number, nanos: number) => any;
  ref: (path: string) => any;
  geo: (lat: number, lng: number) => any;
  bytes: (b64: string) => any;
}

export function decodeValue(v: Encoded, d: Decoders): any {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(x => decodeValue(x, d));
  if (v.__t === 'ts') return d.ts(v.s, v.n);
  if (v.__t === 'ref') return d.ref(v.path);
  if (v.__t === 'geo') return d.geo(v.lat, v.lng);
  if (v.__t === 'bytes') return d.bytes(v.b64);
  const out: Record<string, any> = {};
  Object.keys(v).forEach(k => { out[k] = decodeValue(v[k], d); });
  return out;
}

function toBase64(u: Uint8Array): string {
  let s = '';
  u.forEach(b => { s += String.fromCharCode(b); });
  return typeof btoa === 'function' ? btoa(s) : (globalThis as any).Buffer.from(u).toString('base64');
}

/** Same record? (Encoded values have sorted keys, so the text can be compared.) */
export const sameRecord = (a: Encoded | undefined, b: Encoded | undefined) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// ---------- Showing records ----------
const short = (v: any, max = 80) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

/** A name a person recognises for a record, from whatever fields it has. */
export function recordLabel(data: Record<string, any> | null | undefined): string {
  if (!data) return '';
  const first = (keys: string[]) => keys.map(k => data[k]).find(v => typeof v === 'string' && v.trim());
  const who = first(['companyName', 'client', 'clientName', 'name', 'title', 'trainerName', 'vendorName', 'label', 'subject']);
  const what = first(['courseName', 'programmeName', 'programme', 'description', 'item', 'memo', 'note', 'text']);
  return short([who, what !== who ? what : ''].filter(Boolean).join(' – '), 100);
}

/** One field shown as text, for the then-and-now view. */
export function showValue(v: Encoded): string {
  if (v === undefined) return '';
  if (v === null) return '(empty)';
  if (typeof v === 'object' && v.__t === 'ts') return new Date(v.s * 1000 + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
  if (typeof v === 'object' && v.__t === 'ref') return v.path;
  if (typeof v === 'object') return short(JSON.stringify(v), 400);
  return short(v, 400);
}

export type RecordStatus = 'changed' | 'gone' | 'added' | 'same';
export const STATUS_LABELS: Record<RecordStatus, string> = {
  changed: 'Changed since',
  gone: 'Deleted since',
  added: 'Added since',
  same: 'Same as now',
};

export interface RecordRow { id: string; label: string; status: RecordStatus }

/** Compares a list then and now: one row per record in either. */
export function compareList(then: Record<string, Encoded>, now: Record<string, Encoded>): RecordRow[] {
  const ids = Array.from(new Set([...Object.keys(then), ...Object.keys(now)]));
  const order: RecordStatus[] = ['changed', 'gone', 'added', 'same'];
  return ids.map(id => {
    const t = then[id], n = now[id];
    const status: RecordStatus = t === undefined ? 'added' : n === undefined ? 'gone' : sameRecord(t, n) ? 'same' : 'changed';
    return { id, label: recordLabel(t || n) || id, status };
  }).sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || a.label.localeCompare(b.label));
}

export interface FieldDiff { field: string; then: string; now: string; changed: boolean }

/** Field by field, changed fields first. */
export function fieldDiff(then: Encoded | undefined, now: Encoded | undefined): FieldDiff[] {
  const t = then || {}, n = now || {};
  const keys = Array.from(new Set([...Object.keys(t), ...Object.keys(n)])).sort();
  return keys.map(k => ({ field: k, then: showValue(t[k]), now: showValue(n[k]), changed: !sameRecord(t[k], n[k]) }))
    .sort((a, b) => Number(b.changed) - Number(a.changed));
}

/** What a restore will do: records to put back as they were, and records to remove (they didn't exist then). */
export function restorePlan(list: string, then: Record<string, Encoded>, now: Record<string, Encoded>, ids?: string[]) {
  const pick = ids ? new Set(ids) : null;
  const put: string[] = [], remove: string[] = [];
  new Set([...Object.keys(then), ...Object.keys(now)]).forEach(id => {
    if (pick && !pick.has(id)) return;
    if (!restorableDoc(list, id)) return;
    if (then[id] === undefined) remove.push(id);
    else if (!sameRecord(then[id], now[id])) put.push(id);
  });
  return { put, remove };
}

// ---------- Saved copies ----------
// Files are backups/snapshots/YYYY-MM-DD_HHMM.json.gz (Malaysia time).
export const SNAPSHOT_PREFIX = 'backups/snapshots/';
export const UNDO_PREFIX = 'backups/restores/';

export function snapshotName(ms: number): string {
  return new Date(ms + 8 * 3600000).toISOString().slice(0, 16).replace('T', '_').replace(':', '');
}
/** "2026-10-24_0915" → time in ms, or 0. */
export function snapshotTime(name: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})$/.exec(name);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - 8 * 3600000 : 0;
}

export type RestoreSource = { kind: 'copy'; name: string } | { kind: 'time'; at: number };

/** Checks what the browser sent. The exact time is rounded down to the minute (Google keeps whole minutes). */
export function sourceFrom(v: any, nowMs: number): RestoreSource | null {
  if (v?.kind === 'copy' && typeof v.name === 'string' && snapshotTime(v.name)) return { kind: 'copy', name: v.name };
  if (v?.kind === 'time') {
    const at = Math.floor(Number(v.at) / 60000) * 60000;
    if (at > nowMs - PITR_DAYS * 86400000 + 60000 && at <= nowMs) return { kind: 'time', at };
  }
  return null;
}

export function sourceLabel(s: RestoreSource): string {
  const t = s.kind === 'copy' ? snapshotTime(s.name) : s.at;
  const d = new Date(t + 8 * 3600000);   // Malaysia time, written out the same on any server
  const h = d.getUTCHours(), mins = String(d.getUTCMinutes()).padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const when = `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${h % 12 || 12}:${mins} ${h < 12 ? 'am' : 'pm'}`;
  return s.kind === 'copy' ? `saved copy of ${when}` : `as it was at ${when}`;
}
