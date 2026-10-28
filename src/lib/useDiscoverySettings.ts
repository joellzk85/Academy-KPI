// Live discovery settings from config/discovery_settings (see src/lib/discovery.ts). Management only writes it.
import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';
import { DEFAULT_MOVE_BACK_HOURS } from './discovery';

export function readMoveBackHours(data: any): number {
  const h = Number(data?.moveBackHours);
  return Number.isFinite(h) && h >= 0 ? h : DEFAULT_MOVE_BACK_HOURS;
}

export function useDiscoverySettings(): { moveBackHours: number; loaded: boolean; meta: any } {
  const [state, setState] = useState({ moveBackHours: DEFAULT_MOVE_BACK_HOURS, loaded: false, meta: null as any });
  useEffect(() => onSnapshot(doc(db, 'config', 'discovery_settings'), s => {
    setState({ moveBackHours: readMoveBackHours(s.exists() ? s.data() : null), loaded: true, meta: s.exists() ? s.data() : null });
  }, () => setState(x => ({ ...x, loaded: true }))), []);
  return state;
}
