// NEXT Academy CRM: saved daily copies and restore, run on the server (2026-10-24).
//
// How it works, in plain terms:
// - Once a Malaysian day (with the daily backup) the server saves a full copy of the CRM's lists as one compressed
//   file in Firebase Storage (backups/snapshots/). Copies older than the "keep for" setting are removed.
// - Restore reads the CRM as it was, from one of those copies or at any minute in the last 7 days (Google's own
//   point-in-time recovery), shows what changed since, and puts back one record, a whole list or every list.
// - Before every restore the records it will change are saved (backups/restores/), so it can be undone.
//   Each restore is listed in restore_log, which no browser except the owner's can read.
// - Logins, passwords, the people list and the login log are never saved here or restored (src/lib/restore.ts).
// - Only the owner (Management with an owner_access record) can use any of it.

import type { Express, Request } from 'express';
import zlib from 'zlib';
import { getApps } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { GeoPoint, Timestamp } from 'firebase-admin/firestore';
import firebaseConfig from './firebase-applet-config.json';
import { admin, UserError, callerFrom, route } from './serverAuth';
import { LIST_NAMES, malaysiaDay } from './src/lib/backup';
import {
  DEFAULT_KEEP_DAYS, Decoders, Encoded, RestoreSource, SNAPSHOT_PREFIX, UNDO_PREFIX, compareList,
  encodeValue, decodeValue, fieldDiff, keepDaysFrom, recordLabel, restorable, restorableDoc, restorePlan, snapshotName,
  snapshotTime, sourceFrom, sourceLabel,
} from './src/lib/restore';

type ListData = Record<string, Encoded>;            // record id → encoded record
type CopyData = Record<string, ListData>;           // list → records

// ---------- Who may use it: only the owner ----------
export async function ownerFrom(req: Request) {
  const caller = await callerFrom(req);
  if (caller.role !== 'management' || !caller.superManager) throw new UserError(403, 'not-allowed', 'This is not available.');
  return caller;
}

const bucket = () => getStorage(getApps()[0]).bucket((firebaseConfig as any).storageBucket);

function storageProblem(e: any): UserError {
  console.error('[restore] storage problem:', e?.message || e);
  if (Number(e?.code) === 403 || /permission|forbidden/i.test(String(e?.message))) {
    return new UserError(503, 'storage-no-access',
      "The CRM server isn't allowed to use Firebase Storage yet. In Google Cloud → IAM, give firebase-app-hosting-compute@gen-lang-client-0779528352.iam.gserviceaccount.com the role \"Storage Object Admin\", then try again.");
  }
  return new UserError(503, 'storage-error', "Firebase Storage couldn't be used just now. Try again in a minute.");
}

const decoders = (): Decoders => {
  const { db } = admin();
  return {
    ts: (s, n) => new Timestamp(s, n),
    ref: path => db.doc(path),
    geo: (lat, lng) => new GeoPoint(lat, lng),
    bytes: b64 => Buffer.from(b64, 'base64'),
  };
};

const listName = (id: string) => LIST_NAMES.find(([k]) => k === id)?.[1] || id;

// ---------- Settings (config/backup_settings, server only) ----------
async function settings(): Promise<any> {
  return (await admin().db.collection('config').doc('backup_settings').get()).data() || {};
}
const saveSettings = (patch: any) => admin().db.collection('config').doc('backup_settings').set(patch, { merge: true });

// ---------- Reading the CRM now ----------
async function listsNow(): Promise<string[]> {
  return (await admin().db.listCollections()).map(c => c.id).filter(restorable).sort();
}

const encodeDocs = (list: string, docs: { id: string; data: () => any }[]): ListData => {
  const out: ListData = {};
  docs.forEach(d => { if (restorableDoc(list, d.id)) out[d.id] = encodeValue(d.data()); });
  return out;
};

async function readNow(list: string): Promise<ListData> {
  return encodeDocs(list, (await admin().db.collection(list).get()).docs);
}

// ---------- Saved copies ----------
async function writeGz(path: string, data: any) {
  await bucket().file(path).save(zlib.gzipSync(Buffer.from(JSON.stringify(data))), { contentType: 'application/gzip', resumable: false });
}
async function readGz(path: string): Promise<any> {
  const [buf] = await bucket().file(path).download();
  return JSON.parse(zlib.gunzipSync(buf).toString('utf8'));
}

/** Saves a full copy of every restorable list now. Returns the copy's name and how many records. */
export async function saveCopy(reason: string): Promise<{ name: string; records: number }> {
  const now = Date.now();
  const lists = await listsNow();
  const data: CopyData = {};
  await Promise.all(lists.map(async l => { data[l] = await readNow(l); }));
  const name = snapshotName(now);
  const records = Object.values(data).reduce((n, l) => n + Object.keys(l).length, 0);
  try {
    await writeGz(`${SNAPSHOT_PREFIX}${name}.json.gz`, { at: now, reason, lists: data });
  } catch (e) {
    throw storageProblem(e);
  }
  await removeOldCopies(keepDaysFrom((await settings()).copyKeepDays));
  return { name, records };
}

async function removeOldCopies(keepDays: number) {
  const cutoff = Date.now() - keepDays * 86400000;
  const [files] = await bucket().getFiles({ prefix: SNAPSHOT_PREFIX });
  await Promise.all(files.filter(f => {
    const t = snapshotTime(f.name.slice(SNAPSHOT_PREFIX.length).replace(/\.json\.gz$/, ''));
    return t && t < cutoff;
  }).map(f => f.delete().catch(() => {})));
}

let copying: Promise<any> | null = null;

/** The daily copy: once a Malaysian day, started by the daily backup (serverBackup.ts). Never throws. */
export async function dailyCopy() {
  try {
    const s = await settings();
    const today = malaysiaDay(Date.now());
    if (s.lastCopyDay === today || copying) return;
    if (s.copyErrorAt && Date.now() - s.copyErrorAt < 3600_000) return;   // a failed try waits an hour
    copying = saveCopy('Daily copy');
    const r = await copying;
    await saveSettings({ lastCopyDay: today, lastCopyAt: Date.now(), lastCopyName: r.name, copyError: '', copyErrorAt: 0 });
  } catch (e: any) {
    await saveSettings({ copyError: e?.message || 'The daily copy failed', copyErrorAt: Date.now() }).catch(() => {});
  } finally {
    copying = null;
  }
}

// One copy read at a time is kept in memory for a few minutes, so moving around a copy stays quick.
let cache: { name: string; data: CopyData; until: number } | null = null;
async function readCopy(name: string): Promise<CopyData> {
  if (cache && cache.name === name && cache.until > Date.now()) return cache.data;
  let file: any;
  try {
    file = await readGz(`${SNAPSHOT_PREFIX}${name}.json.gz`);
  } catch (e: any) {
    if (Number(e?.code) === 404) throw new UserError(404, 'copy-not-found', 'That saved copy no longer exists.');
    throw storageProblem(e);
  }
  cache = { name, data: file.lists || {}, until: Date.now() + 5 * 60_000 };
  return cache.data;
}

// ---------- Reading the CRM as it was ----------
async function readThen(source: RestoreSource, list: string): Promise<ListData> {
  if (source.kind === 'copy') return (await readCopy(source.name))[list] || {};
  const { db } = admin();
  try {
    const snap = await db.runTransaction(t => t.get(db.collection(list)), { readOnly: true, readTime: Timestamp.fromMillis(source.at) });
    return encodeDocs(list, snap.docs);
  } catch (e: any) {
    console.error('[restore] read at time failed:', e?.message || e);
    throw new UserError(400, 'time-not-kept',
      "Google doesn't have the CRM as it was at that time. Point-in-time recovery keeps only the last 7 days, and only since it was switched on. Pick a later time or a saved copy.");
  }
}

async function listsThen(source: RestoreSource): Promise<string[]> {
  if (source.kind === 'copy') return Object.keys(await readCopy(source.name)).filter(restorable).sort();
  return listsNow();
}

function sourceOf(req: Request): RestoreSource {
  const s = sourceFrom(req.body?.source, Date.now());
  if (!s) throw new UserError(400, 'bad-time', 'Pick a saved copy, or a time within the last 7 days.');
  return s;
}
function listOf(req: Request, allowAll = false): string {
  const l = String(req.body?.list || '');
  if (allowAll && l === '*') return l;
  if (!restorable(l)) throw new UserError(400, 'bad-list', 'Pick a list.');
  return l;
}

// ---------- Putting records back ----------
type UndoFile = { at: number; lists: Record<string, Record<string, Encoded | null>> };

async function applyRecords(writes: Record<string, Record<string, Encoded | null>>) {
  const { db } = admin();
  const d = decoders();
  const writer = db.bulkWriter();
  let failed = 0;
  writer.onWriteError(err => { if (err.failedAttempts < 3) return true; failed++; return false; });
  Object.entries(writes).forEach(([list, recs]) => Object.entries(recs).forEach(([id, data]) => {
    const ref = db.collection(list).doc(id);
    if (data === null) writer.delete(ref);
    else writer.set(ref, decodeValue(data, d));
  }));
  await writer.close();
  if (failed) throw new UserError(500, 'restore-partly', `${failed} records couldn't be written. Try again, or undo this restore from the history.`);
}

// ---------- Routes ----------
export function registerRestoreRoutes(app: Express) {
  // What can be restored from: saved copies, the 7-day window and the settings.
  app.post('/api/restore/points', route(async req => {
    await ownerFrom(req);
    const s = await settings();
    let copies: { name: string; at: number; size: number }[] = [];
    let storageError = '';
    try {
      const [files] = await bucket().getFiles({ prefix: SNAPSHOT_PREFIX });
      copies = files.map(f => {
        const name = f.name.slice(SNAPSHOT_PREFIX.length).replace(/\.json\.gz$/, '');
        return { name, at: snapshotTime(name), size: Number(f.metadata?.size) || 0 };
      }).filter(c => c.at).sort((a, b) => b.at - a.at);
    } catch (e) {
      storageError = storageProblem(e).message;
    }
    return {
      copies, storageError,
      keepDays: keepDaysFrom(s.copyKeepDays ?? DEFAULT_KEEP_DAYS),
      lastCopyAt: s.lastCopyAt || 0, copyError: s.copyError || '', copyErrorAt: s.copyErrorAt || 0,
    };
  }));

  app.post('/api/restore/settings', route(async req => {
    await ownerFrom(req);
    const keepDays = keepDaysFrom(req.body?.keepDays);
    await saveSettings({ copyKeepDays: keepDays });
    await removeOldCopies(keepDays).catch(e => { throw storageProblem(e); });
    return { keepDays };
  }));

  // "Save a copy now".
  app.post('/api/restore/copy', route(async req => {
    await ownerFrom(req);
    if (copying) throw new UserError(409, 'busy', 'A copy is being saved already. Try again in a minute.');
    copying = saveCopy('Saved by hand');
    try {
      const r = await copying;
      await saveSettings({ lastCopyAt: Date.now(), lastCopyName: r.name, copyError: '' });
      return r;
    } finally {
      copying = null;
    }
  }));

  // The lists at that time, with how many records changed since.
  app.post('/api/restore/lists', route(async req => {
    await ownerFrom(req);
    const source = sourceOf(req);
    const ids = await listsThen(source);
    const lists = await Promise.all(ids.map(async id => {
      const rows = compareList(await readThen(source, id), await readNow(id));
      const count = (st: string) => rows.filter(r => r.status === st).length;
      return { id, name: listName(id), changed: count('changed'), gone: count('gone'), added: count('added'), total: rows.length - count('added') };
    }));
    return { lists: lists.sort((a, b) => a.name.localeCompare(b.name)), label: sourceLabel(source) };
  }));

  // The records in one list, then against now. Search by name or id; at most 300 rows.
  app.post('/api/restore/records', route(async req => {
    await ownerFrom(req);
    const source = sourceOf(req);
    const list = listOf(req);
    const q = String(req.body?.search || '').trim().toLowerCase();
    const showSame = !!req.body?.showSame;
    const rows = compareList(await readThen(source, list), await readNow(list))
      .filter(r => (showSame || r.status !== 'same') && (!q || r.label.toLowerCase().includes(q) || r.id.toLowerCase().includes(q)));
    return { rows: rows.slice(0, 300), more: Math.max(0, rows.length - 300) };
  }));

  // One record, field by field.
  app.post('/api/restore/record', route(async req => {
    await ownerFrom(req);
    const source = sourceOf(req);
    const list = listOf(req);
    const id = String(req.body?.id || '');
    const [then, now] = await Promise.all([readThen(source, list), readNow(list)]);
    return { label: recordLabel(then[id] || now[id]) || id, existedThen: id in then, existsNow: id in now, fields: fieldDiff(then[id], now[id]) };
  }));

  // Restore: `ids` = those records of one list; no ids = the whole list; list '*' = every list.
  app.post('/api/restore/apply', route(async req => {
    const caller = await ownerFrom(req);
    const source = sourceOf(req);
    const list = listOf(req, true);
    const ids: string[] | undefined = Array.isArray(req.body?.ids) ? req.body.ids.map(String).slice(0, 500) : undefined;
    if (list === '*' && ids) throw new UserError(400, 'bad-list', 'Pick one list to restore single records.');
    const lists = list === '*' ? await listsThen(source) : [list];
    const writes: Record<string, Record<string, Encoded | null>> = {};
    const undo: UndoFile = { at: Date.now(), lists: {} };
    let put = 0, removed = 0;
    for (const l of lists) {
      const [then, now] = await Promise.all([readThen(source, l), readNow(l)]);
      const plan = restorePlan(l, then, now, ids);
      if (!plan.put.length && !plan.remove.length) continue;
      writes[l] = {}; undo.lists[l] = {};
      plan.put.forEach(id => { writes[l][id] = then[id]; undo.lists[l][id] = now[id] ?? null; });
      plan.remove.forEach(id => { writes[l][id] = null; undo.lists[l][id] = now[id]; });
      put += plan.put.length; removed += plan.remove.length;
    }
    if (!put && !removed) return { put: 0, removed: 0, note: 'Nothing to restore: it is the same as now.' };
    const { db } = admin();
    const ref = db.collection('restore_log').doc();
    const undoPath = `${UNDO_PREFIX}${ref.id}.json.gz`;
    try {
      await writeGz(undoPath, undo);   // saved first, so the restore can always be undone
    } catch (e) {
      throw storageProblem(e);
    }
    const byName = String((await db.collection('team').doc(caller.memberId).get()).data()?.name || '');
    await ref.set({
      at: Date.now(), byId: caller.memberId, byName, source: sourceLabel(source),
      what: list === '*' ? 'Every list' : ids?.length === 1 ? `${listName(list)}: ${recordLabel(undo.lists[list][ids[0]] || writes[list]?.[ids[0]]) || ids[0]}`
        : ids ? `${listName(list)}: ${ids.length} records` : `${listName(list)} (whole list)`,
      put, removed, lists: Object.keys(writes), undoPath, undone: false,
    });
    await applyRecords(writes);
    return { put, removed, restoreId: ref.id };
  }));

  app.post('/api/restore/history', route(async req => {
    await ownerFrom(req);
    const snap = await admin().db.collection('restore_log').orderBy('at', 'desc').limit(30).get();
    return { items: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
  }));

  // Undo a restore: the records go back to how they were just before it.
  app.post('/api/restore/undo', route(async req => {
    const caller = await ownerFrom(req);
    const { db } = admin();
    const ref = db.collection('restore_log').doc(String(req.body?.restoreId || 'x'));
    const entry = (await ref.get()).data();
    if (!entry) throw new UserError(404, 'not-found', 'That restore is not in the history.');
    if (entry.undone) throw new UserError(409, 'already-undone', 'That restore was undone already.');
    let file: UndoFile;
    try {
      file = await readGz(entry.undoPath);
    } catch (e) {
      throw storageProblem(e);
    }
    await applyRecords(file.lists);
    await ref.update({ undone: true, undoneAt: Date.now(), undoneById: caller.memberId });
    return {};
  }));
}
