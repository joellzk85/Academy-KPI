import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';
import { DEFAULT_PROPOSAL_SETTINGS, ProposalSettings } from './proposalTracking';

// Management's switch "Reps can see proposal tracking" (config/proposal_settings; default off). Live.
export function useProposalSettings(): ProposalSettings {
  const [s, setS] = useState<ProposalSettings>(DEFAULT_PROPOSAL_SETTINGS);
  useEffect(() => onSnapshot(doc(db, 'config', 'proposal_settings'),
    snap => setS({ ...DEFAULT_PROPOSAL_SETTINGS, ...(snap.data() as any || {}) }),
    () => setS(DEFAULT_PROPOSAL_SETTINGS)), []);
  return s;
}
