// Live data for client history (see src/lib/touchPoints.ts): the colour limits and the client touch points.
import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, query } from 'firebase/firestore';
import { db } from './firebase';
import { ClientTouchPoint, ContactLimits, DEFAULT_CONTACT_LIMITS, readContactLimits } from './touchPoints';

export function useContactLimits(): { limits: ContactLimits; meta: any } {
  const [state, setState] = useState<{ limits: ContactLimits; meta: any }>({ limits: DEFAULT_CONTACT_LIMITS, meta: null });
  useEffect(() => onSnapshot(doc(db, 'config', 'client_contact_colours'),
    s => setState({ limits: readContactLimits(s.exists() ? s.data() : null), meta: s.exists() ? s.data() : null }),
    () => { /* defaults */ }), []);
  return state;
}

export function useTouchPoints(): ClientTouchPoint[] {
  const [list, setList] = useState<ClientTouchPoint[]>([]);
  useEffect(() => onSnapshot(query(collection(db, 'client_touch_points')),
    s => setList(s.docs.map(d => ({ ...(d.data() as ClientTouchPoint), id: d.id }))),
    () => setList([])), []);
  return list;
}

// The Team list (public read), for names and "Follow-up by" pickers: everyone, including Management without a workspace.
export type TeamPerson = { id: string; name: string; role: string; active: boolean };
export function useTeamList(): TeamPerson[] {
  const [list, setList] = useState<TeamPerson[]>([]);
  useEffect(() => onSnapshot(collection(db, 'team'),
    s => setList(s.docs.map(d => ({ id: d.id, name: String(d.data().name || ''), role: String(d.data().role || 'rep'), active: d.data().active !== false }))
      .sort((a, b) => a.name.localeCompare(b.name))),
    () => { /* keep what we have */ }), []);
  return list;
}
