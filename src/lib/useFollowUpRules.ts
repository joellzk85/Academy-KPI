// Live follow-up rules from config/follow_up_rules (see src/lib/followUps.ts).
import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';
import { FollowUpRules, activeFollowUpRules, readFollowUpRules, setActiveFollowUpRules } from './followUps';

export function useFollowUpRules(): { rules: FollowUpRules; loaded: boolean; meta: any } {
  const [state, setState] = useState<{ rules: FollowUpRules; loaded: boolean; meta: any }>({ rules: activeFollowUpRules(), loaded: false, meta: null });
  useEffect(() => onSnapshot(doc(db, 'config', 'follow_up_rules'), s => {
    const rules = readFollowUpRules(s.exists() ? s.data() : null);
    setActiveFollowUpRules(rules);
    setState({ rules, loaded: true, meta: s.exists() ? s.data() : null });
  }, () => setState(x => ({ ...x, loaded: true }))), []);
  return state;
}
