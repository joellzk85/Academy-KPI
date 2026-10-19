import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import { db } from './firebase';
import { DocLink } from './docLinks';
import { dealOwnerId } from './deals';
import { ProposalView, canSeeTracking } from './proposalTracking';
import { useProposalSettings } from './useProposalSettings';

// Teambuilding proposal links in the CRM (push B, 2026-10-19).
// - Every teambuilding link (doc_links, kind 'teambuilding'), live.
// - Visits of one deal (proposal_views): only for people allowed to see tracking (the database rule says the same).
// - Red dot for the deal owner when the client opens the proposal (again) or accepts it, cleared when the owner opens
//   the deal: what the owner has seen is kept on their own prefs (user_prefs/{id}.proposalSeen[token] = { views, accepted }).

type Viewer = { id: string; role: string };

export function useTbLinks(): DocLink[] {
  const [links, setLinks] = useState<DocLink[]>([]);
  useEffect(() => onSnapshot(query(collection(db, 'doc_links'), where('kind', '==', 'teambuilding')),
    s => setLinks(s.docs.map(d => ({ ...(d.data() as any), token: d.id } as DocLink))), () => setLinks([])), []);
  return links;
}

export function useDealVisits(dealId: string | undefined, allowed: boolean): { views: ProposalView[]; blocked: boolean } {
  const [state, setState] = useState<{ views: ProposalView[]; blocked: boolean }>({ views: [], blocked: false });
  useEffect(() => {
    if (!dealId || !allowed) { setState({ views: [], blocked: !allowed }); return; }
    return onSnapshot(query(collection(db, 'proposal_views'), where('dealId', '==', dealId)),
      s => setState({ views: s.docs.map(d => ({ ...(d.data() as any), id: d.id } as ProposalView)), blocked: false }),
      () => setState({ views: [], blocked: true }));
  }, [dealId, allowed]);
  return state;
}

export function useProposalAlerts(viewer: Viewer, deals: any[]) {
  const links = useTbLinks();
  const settings = useProposalSettings();
  const see = canSeeTracking(viewer.role, settings);
  const [seen, setSeen] = useState<Record<string, { views?: number; accepted?: boolean }>>({});
  useEffect(() => {
    if (!viewer.id) return;
    return onSnapshot(doc(db, 'user_prefs', viewer.id), s => setSeen((s.data()?.proposalSeen as any) || {}), () => setSeen({}));
  }, [viewer.id]);

  // dealId → what to say
  const alerts = useMemo(() => {
    const out: Record<string, string> = {};
    links.forEach(l => {
      const deal = deals.find(d => d.id === l.dealId);
      if (!deal || dealOwnerId(deal) !== viewer.id) return;
      const s = seen[l.token] || {};
      if (l.accepted && !s.accepted) out[deal.id] = 'Proposal accepted online';
      else if (see && (l.views || 0) > (s.views || 0) && !out[deal.id]) out[deal.id] = (s.views || 0) > 0 ? 'Client opened the proposal again' : 'Client opened the proposal';
    });
    return out;
  }, [links, deals, seen, see, viewer.id]);

  // The owner opened the deal: everything on its links so far is seen.
  const markSeen = (dealId: string) => {
    if (!alerts[dealId]) return;
    const patch: Record<string, any> = {};
    links.filter(l => l.dealId === dealId).forEach(l => { patch[l.token] = { views: l.views || 0, accepted: !!l.accepted }; });
    setDoc(doc(db, 'user_prefs', viewer.id), { proposalSeen: patch }, { merge: true }).catch(() => { /* shown again next time */ });
  };
  return { alerts, markSeen, links, canSee: see };
}
