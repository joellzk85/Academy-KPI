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

function saved(path: string) {
  if (!listener || NOT_WORK.includes(path.split('/')[0])) return;
  try { listener(path); } catch { /* never let counting break a save */ }
}

// Wraps a batch's or transaction's set / update / delete so the records are known when it succeeds.
function recordWrites<T extends object>(target: T, paths: string[]): T {
  (['set', 'update', 'delete'] as const).forEach(m => {
    const orig = (target as any)[m];
    if (typeof orig !== 'function') return;
    (target as any)[m] = (ref: any, ...rest: any[]) => {
      if (ref?.path) paths.push(ref.path);
      orig.call(target, ref, ...rest);
      return target;
    };
  });
  return target;
}

export const addDoc = ((ref: any, data: any) =>
  fs.addDoc(ref, data).then(r => { saved(r.path); return r; })) as typeof fs.addDoc;

export const setDoc = ((ref: any, ...rest: any[]) =>
  (fs.setDoc as any)(ref, ...rest).then((r: any) => { saved(ref.path); return r; })) as typeof fs.setDoc;

export const updateDoc = ((ref: any, ...rest: any[]) =>
  (fs.updateDoc as any)(ref, ...rest).then((r: any) => { saved(ref.path); return r; })) as typeof fs.updateDoc;

export const deleteDoc = ((ref: any) =>
  fs.deleteDoc(ref).then(r => { saved(ref.path); return r; })) as typeof fs.deleteDoc;

export const writeBatch = ((firestore: any) => {
  const batch = fs.writeBatch(firestore);
  const paths: string[] = [];
  recordWrites(batch, paths);
  const commit = batch.commit.bind(batch);
  (batch as any).commit = () => commit().then(r => { paths.forEach(saved); return r; });
  return batch;
}) as typeof fs.writeBatch;

export const runTransaction = ((firestore: any, update: (t: any) => Promise<any>, options?: any) => {
  let paths: string[] = [];
  return fs.runTransaction(firestore, t => { paths = []; return update(recordWrites(t, paths)); }, options)
    .then(r => { paths.forEach(saved); return r; });
}) as typeof fs.runTransaction;
