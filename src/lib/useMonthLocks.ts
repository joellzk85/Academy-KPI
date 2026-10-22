// Live month locks from config/month_locks (see src/lib/monthLock.ts). App.tsx runs it once, so every screen
// (KPI page, appointments, follow-ups, Deal checks) uses the same open months.
import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';
import { MonthLocks, readMonthLocks, setActiveMonthLocks } from './monthLock';

export function useMonthLocks(): { locks: MonthLocks; loaded: boolean } {
  const [state, setState] = useState<{ locks: MonthLocks; loaded: boolean }>({ locks: { open: [], log: [] }, loaded: false });
  useEffect(() => onSnapshot(doc(db, 'config', 'month_locks'), s => {
    const locks = readMonthLocks(s.exists() ? s.data() : null);
    setActiveMonthLocks(locks.open);
    setState({ locks, loaded: true });
  }, () => setState(x => ({ ...x, loaded: true }))), []);
  return state;
}
