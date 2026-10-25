import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { db } from './firebase';
import { OneToOne, OtoQuestions, readQuestions } from './oneToOne';

// The 1-to-1 setting (who runs them, the questions) and the sessions this person is in: as the staff member, or
// as the coach (then everyone's). The database lets nobody else read a session (lib/oneToOne.ts).
export function useOneToOnes(meId: string): { coachId: string; questions: OtoQuestions; sessions: OneToOne[]; loaded: boolean } {
  const [coachId, setCoachId] = useState('');
  const [questions, setQuestions] = useState<OtoQuestions>(readQuestions(null));
  const [mine, setMine] = useState<OneToOne[]>([]);
  const [coached, setCoached] = useState<OneToOne[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => onSnapshot(doc(db, 'config', 'one_to_one'), s => {
    const d: any = s.data() || {};
    setCoachId(typeof d.coachId === 'string' ? d.coachId : '');
    setQuestions(readQuestions(d.questions));
  }, () => {}), []);

  useEffect(() => {
    if (!meId) return;
    const read = (s: any) => s.docs.map((d: any) => ({ ...d.data(), id: d.id }) as OneToOne);
    const subs = [
      onSnapshot(query(collection(db, 'one_to_ones'), where('personId', '==', meId)), s => { setMine(read(s)); setLoaded(true); }, () => { setMine([]); setLoaded(true); }),
      onSnapshot(query(collection(db, 'one_to_ones'), where('coachId', '==', meId)), s => setCoached(read(s)), () => setCoached([])),
    ];
    return () => subs.forEach(u => u());
  }, [meId]);

  const sessions = useMemo(() => {
    const seen = new Set<string>();
    return [...mine, ...coached].filter(s => !seen.has(s.id) && !!seen.add(s.id));
  }, [mine, coached]);

  return { coachId, questions, sessions, loaded };
}
