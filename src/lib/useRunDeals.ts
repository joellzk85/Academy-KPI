import { useEffect, useState } from 'react';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { db } from './firebase';
import { PublicProgramme, runAsDeal } from './publicProgrammes';

// Public programmes shaped like deals (lib/publicProgrammes.ts runAsDeal), for screens that look up the deal behind a
// cost, checklist or trainer job by its id (Payments out, My home). Only for look-ups: never add them to sales lists.
export function useRunDeals(on = true): any[] {
  const [runs, setRuns] = useState<any[]>([]);
  useEffect(() => {
    if (!on) { setRuns([]); return; }
    return onSnapshot(query(collection(db, 'public_programmes')), s => setRuns(s.docs.map(d => runAsDeal({ ...(d.data() as PublicProgramme), id: d.id }))), () => setRuns([]));
  }, [on]);
  return runs;
}
