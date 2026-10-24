// Counts work saved in the CRM for the Login log (2026-10-22). vite.config.ts points every
// `import … from 'firebase/firestore'` in src/ to this file, which passes everything through unchanged
// and, after each save that succeeds (add, set, update, delete, batch, transaction), tells the
// listener which record was saved. lib/loginActivity.ts listens and turns this into the day's "actions".
import * as fs from 'firebase/firestore';
export * from 'firebase/firestore';

// Saves that are not work: the Login log's own minutes.
const NOT_WORK = ['login_days'];

let listener: ((path: string) => void) | null = null;
export function setWriteListener(fn: ((path: string) => void) | null) { listener = fn; }

// Since 2026-10-24 deletes are also reported for Team → Login log's Actions: 'delete' = gone forever,
// 'soft_delete' = marked deleted (deleted: true), still restorable.
export type DeleteKind = 'delete' | 'soft_delete';
let deleteListener: ((path: string, kind: DeleteKind) => void) | null = null;
export function setDeleteListener(fn: ((path: string, kind: DeleteKind) => void) | null) { deleteListener = fn; }

const marksDeleted = (data: any) => !!data && typeof data === 'object' && data.deleted === true;

function saved(path: string, del?: DeleteKind) {
  if (NOT_WORK.includes(path.split('/')[0])) return;
  try { listener?.(path); } catch { /* never let counting break a save */ }
  if (del) try { deleteListener?.(path, del); } catch { /* never let counting break a save */ }
}

type Write = { path: string; del?: DeleteKind };

// Wraps a batch's or transaction's set / update / delete so the records are known when it succeeds.
function recordWrites<T extends object>(target: T, writes: Write[]): T {
  (['set', 'update', 'delete'] as const).forEach(m => {
    const orig = (target as any)[m];
    if (typeof orig !== 'function') return;
    (target as any)[m] = (ref: any, ...rest: any[]) => {
      if (ref?.path) writes.push({ path: ref.path, del: m === 'delete' ? 'delete' : marksDeleted(rest[0]) ? 'soft_delete' : undefined });
      orig.call(target, ref, ...rest);
      return target;
    };
  });
  return target;
}

export const addDoc = ((ref: any, data: any) =>
  fs.addDoc(ref, data).then(r => { saved(r.path); return r; })) as typeof fs.addDoc;

export const setDoc = ((ref: any, ...rest: any[]) =>
  (fs.setDoc as any)(ref, ...rest).then((r: any) => { saved(ref.path, marksDeleted(rest[0]) ? 'soft_delete' : undefined); return r; })) as typeof fs.setDoc;

export const updateDoc = ((ref: any, ...rest: any[]) =>
  (fs.updateDoc as any)(ref, ...rest).then((r: any) => { saved(ref.path, marksDeleted(rest[0]) ? 'soft_delete' : undefined); return r; })) as typeof fs.updateDoc;

export const deleteDoc = ((ref: any) =>
  fs.deleteDoc(ref).then(r => { saved(ref.path, 'delete'); return r; })) as typeof fs.deleteDoc;

export const writeBatch = ((firestore: any) => {
  const batch = fs.writeBatch(firestore);
  const writes: Write[] = [];
  recordWrites(batch, writes);
  const commit = batch.commit.bind(batch);
  (batch as any).commit = () => commit().then(r => { writes.forEach(w => saved(w.path, w.del)); return r; });
  return batch;
}) as typeof fs.writeBatch;

export const runTransaction = ((firestore: any, update: (t: any) => Promise<any>, options?: any) => {
  let writes: Write[] = [];
  return fs.runTransaction(firestore, t => { writes = []; return update(recordWrites(t, writes)); }, options)
    .then(r => { writes.forEach(w => saved(w.path, w.del)); return r; });
}) as typeof fs.runTransaction;
