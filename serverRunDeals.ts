// Public programmes (2026-10-28, src/lib/publicProgrammes.ts): a run's checklist, costs and trainer jobs are stored under
// the run's id like a deal's. Server routes that read "the deal" behind one of them fall back to the run, shaped as a
// won deal (runAsDeal), so the trainer portal, the accounts portal and payment summaries work for runs too.
import type { Firestore } from 'firebase-admin/firestore';
import { runAsDeal } from './src/lib/publicProgrammes';

/** The deal with this id, else the public programme with it (as a deal), else undefined. */
export async function dealOrRun(db: Firestore, id: string): Promise<any | undefined> {
  if (!id) return undefined;
  const d = await db.collection('pipelines').doc(id).get();
  if (d.exists) return d.data();
  const r = await db.collection('public_programmes').doc(id).get();
  return r.exists ? runAsDeal({ ...(r.data() as any), id }) : undefined;
}

/** Fills in the ids not found as deals with the public programmes of the same id. */
export async function withRuns(db: Firestore, deals: Map<string, any>, ids: string[]): Promise<Map<string, any>> {
  const missing = [...new Set(ids.filter(id => id && !deals.has(id)))];
  if (!missing.length) return deals;
  const runs = await Promise.all(missing.map(id => db.collection('public_programmes').doc(id).get()));
  runs.forEach(r => { if (r.exists) deals.set(r.id, runAsDeal({ ...(r.data() as any), id: r.id })); });
  return deals;
}
