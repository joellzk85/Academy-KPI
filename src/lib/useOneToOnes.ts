import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { db } from './firebase';
import {
  DEFAULT_REVISIT_MONTHS, OneToOne, OtoQuestions, OtoTemplate, PersonQuestions, personQuestions, readQuestions, readTemplates, readTopics,
} from './oneToOne';

// The 1-to-1 setting (who runs them, the questions, templates, topics) and the sessions this person is in: as the
// staff member, or as the coach (then everyone's). The database lets nobody else read a session (lib/oneToOne.ts).
// `questionsOf(personId)` is the set that person is asked (their own, a template, or Standard).
export function useOneToOnes(meId: string): {
  coachId: string; questions: OtoQuestions; templates: OtoTemplate[]; topics: string[]; revisitMonths: number;
  people: Record<string, PersonQuestions>; questionsOf: (personId: string) => OtoQuestions;
  sessions: OneToOne[]; loaded: boolean; configLoaded: boolean;
} {
  const [coachId, setCoachId] = useState('');
  const [questions, setQuestions] = useState<OtoQuestions>(readQuestions(null));
  const [templates, setTemplates] = useState<OtoTemplate[]>([]);
  const [topics, setTopics] = useState<string[]>(readTopics(null));
  const [revisitMonths, setRevisitMonths] = useState(DEFAULT_REVISIT_MONTHS);
  const [people, setPeople] = useState<Record<string, PersonQuestions>>({});
  const [mine, setMine] = useState<OneToOne[]>([]);
  const [coached, setCoached] = useState<OneToOne[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);

  useEffect(() => onSnapshot(doc(db, 'config', 'one_to_one'), s => {
    const d: any = s.data() || {};
    setCoachId(typeof d.coachId === 'string' ? d.coachId : '');
    setQuestions(readQuestions(d.questions));
    setTemplates(readTemplates(d.templates));
    setTopics(readTopics(d.topics));
    setRevisitMonths(Number(d.revisitMonths) > 0 ? Number(d.revisitMonths) : DEFAULT_REVISIT_MONTHS);
    setConfigLoaded(true);
  }, () => {}), []);

  // The question set of each person: the coach reads everyone's, a staff member only their own.
  const isCoach = !!meId && meId === coachId;
  useEffect(() => {
    if (!meId) return;
    if (isCoach) {
      return onSnapshot(collection(db, 'one_to_one_questions'), s => setPeople(Object.fromEntries(s.docs.map(d => [d.id, d.data() as PersonQuestions]))), () => setPeople({}));
    }
    return onSnapshot(doc(db, 'one_to_one_questions', meId), d => setPeople(d.exists() ? { [meId]: d.data() as PersonQuestions } : {}), () => setPeople({}));
  }, [meId, isCoach]);

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

  const questionsOf = (personId: string) => personQuestions(people[personId], questions, templates);

  return { coachId, questions, templates, topics, revisitMonths, people, questionsOf, sessions, loaded, configLoaded };
}
