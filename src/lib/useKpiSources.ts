import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { db } from './firebase';
import { KpiSources } from './kpi';
import { withoutDeleted } from './linked';

// Live lists for the KPIs that aren't counted from deals (lib/kpi.ts): HRDC claims in money_in
// (Admin's Claim submission) and the venue list (Admin's Venue database).
export function useKpiSources(): KpiSources {
  const [claims, setClaims] = useState<any[]>([]);
  const [venues, setVenues] = useState<any[]>([]);
  useEffect(() => {
    const subs = [
      onSnapshot(query(collection(db, 'money_in')), s => setClaims(withoutDeleted(s.docs.map(d => ({ ...d.data(), id: d.id })))), () => setClaims([])),
      onSnapshot(query(collection(db, 'venues_directory')), s => setVenues(s.docs.map(d => ({ ...d.data(), id: d.id }))), () => setVenues([])),
    ];
    return () => subs.forEach(u => u());
  }, []);
  return useMemo(() => ({ claims, venues }), [claims, venues]);
}
