// The private room (2026-10-24): opened only by the owner (lib/superManager.ts) by double-clicking the clock.
// Login log, Backup and Restore always live there. Management screens ticked here move there too and leave the
// normal menus for everyone. The ticks are in config/screens ({ off: [...] }), which only the owner can change.

import { useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from './firebase';

export type MovableScreen = 'data' | 'appraisal' | 'lost';

export const MOVABLE_SCREENS: { key: MovableScreen; label: string; hint: string }[] = [
  { key: 'data', label: 'Data tools', hint: 'Suggested: linking and clearing old records is one-off work for you alone.' },
  { key: 'appraisal', label: 'Appraisal', hint: 'Optional: staff appraisals, if only you should see and write them.' },
  { key: 'lost', label: 'Lost and deleted', hint: 'Optional: bringing back deleted deals. Without it, others can only delete, not restore.' },
];

export const DEFAULT_OFF: MovableScreen[] = ['data'];

export const offFrom = (d: any): MovableScreen[] =>
  Array.isArray(d?.off) ? MOVABLE_SCREENS.map(s => s.key).filter(k => d.off.includes(k)) : DEFAULT_OFF;

/** Which screens are moved to the private room (read by every Management screen menu). */
export function useScreensOff(): MovableScreen[] {
  const [off, setOff] = useState<MovableScreen[]>(DEFAULT_OFF);
  useEffect(() => onSnapshot(doc(db, 'config', 'screens'), d => setOff(offFrom(d.data())), () => setOff(DEFAULT_OFF)), []);
  return off;
}

export const saveScreensOff = (off: MovableScreen[]) => setDoc(doc(db, 'config', 'screens'), { off, updatedAt: Date.now() });
