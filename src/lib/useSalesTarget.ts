import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';
import { SalesTarget, readSalesTarget } from './salesTarget';

// The company sales target set by Management (config/sales_target), live. null = not set.
export function useSalesTarget(): SalesTarget | null {
  const [t, setT] = useState<SalesTarget | null>(null);
  useEffect(() => onSnapshot(doc(db, 'config', 'sales_target'), d => setT(readSalesTarget(d.data())), () => setT(null)), []);
  return t;
}
