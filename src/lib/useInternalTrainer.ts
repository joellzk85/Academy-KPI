import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, query, where } from 'firebase/firestore';
import { db } from './firebase';

// The trainer record a team member is linked to as an internal trainer (Team, Joel 2026-10-25), or null.
// Saved as trainers_directory/{trainerId}.memberId; only Management sets it (firestore.rules).
export function useInternalTrainer(memberId?: string): { id: string; name: string } | null {
  const [rec, setRec] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    if (!memberId) { setRec(null); return; }
    return onSnapshot(query(collection(db, 'trainers_directory'), where('memberId', '==', memberId), limit(1)),
      s => setRec(s.empty ? null : { id: s.docs[0].id, name: String(s.docs[0].data().name || '') }), () => setRec(null));
  }, [memberId]);
  return rec;
}
