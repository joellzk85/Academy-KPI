import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import { db } from './firebase';
import { DocLink } from './docLinks';
import { dealOwnerId } from './deals';
import { ProposalView, TrackingAccess, seesLink, trackingAccess } from './proposalTracking';
import { useProposalSettings } from './useProposalSettings';

// Client links in the CRM (teambuilding push B 2026-10-19; every link kind since 2026-10-20).
// - Links (doc_links), live.
// - Visits (proposal_views): only Management, and the people Management ticked for their own deals. The database
//   rule says the same, so those people's queries must ask for their own visits only (ownerId == them).
// - Red dot for the deal owner when the client accepts a teambuilding proposal online (everyone), or opens a link again
//   (only people allowed to see tracking), cleared when the owner opens the deal: what the owner has seen is kept on
//   their own prefs (user_prefs/{id}.proposalSeen[token] = { views, accepted }).

type Viewer = { id: string; role: string };

const toLinks = (s: any) => s.docs.map((d: any) => ({ ...(d.data() as any), token: d.id } as DocLink));

export function useTbLinks(): DocLink[] {
  const [links, setLinks] = useState<DocLink[]>([]);
  useEffect(() => onSnapshot(query(collection(db, 'doc_links'), where('kind', '==', 'teambuilding')),
    s => setLinks(toLinks(s)), () => setLinks([])), []);
  return links;
}

// Every client link (quotations, course outlines, teambuilding proposals).
export function useAllLinks(): DocLink[] {
  const [links, setLinks] = useState<DocLink[]>([]);
  useEffect(() => onSnapshot(collection(db, 'doc_links'), s => setLinks(toLinks(s)), () => setLinks([])), []);
  return links;
}

export function useTrackingAccess(viewer: Viewer | null | undefined): TrackingAccess {
  return trackingAccess(viewer, useProposalSettings());
}

const toViews = (s: any) => s.docs.map((d: any) => ({ ...(d.data() as any), id: d.id } as ProposalView));

// Visits of one deal or one link, as far as this person may see them.
export function useLinkVisits(by: { dealId?: string; token?: string }, viewer: Viewer | null | undefined): { views: ProposalView[]; blocked: boolean } {
  const access = useTrackingAccess(viewer);
  const [state, setState] = useState<{ views: ProposalView[]; blocked: boolean }>({ views: [], blocked: false });
  const field = by.token ? 'token' : 'dealId';
  const value = by.token || by.dealId || '';
  useEffect(() => {
    if (!value || access === 'none') { setState({ views: [], blocked: access === 'none' }); return; }
    const parts = [where(field, '==', value), ...(access === 'own' ? [where('ownerId', '==', viewer!.id)] : [])];
    return onSnapshot(query(collection(db, 'proposal_views'), ...parts),
      s => setState({ views: toViews(s), blocked: false }),
      () => setState({ views: [], blocked: true }));
  }, [field, value, access, viewer?.id]);
  return state;
}

// Recent visits (last 14 days) for the "Reading now" and Hot / Warm / Cold lists, re-checked every 30 seconds.
export function useRecentVisits(viewer: Viewer | null | undefined): { views: ProposalView[]; now: number } {
  const access = useTrackingAccess(viewer);
  const [views, setViews] = useState<ProposalView[]>([]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(t); }, []);
  const since = useMemo(() => Math.floor((Date.now() - 14 * 864e5) / 3600_000) * 3600_000, []);
  useEffect(() => {
    if (access === 'none') { setViews([]); return; }
    const q = access === 'all'
      ? query(collection(db, 'proposal_views'), where('lastSeenAt', '>', since))
      : query(collection(db, 'proposal_views'), where('ownerId', '==', viewer!.id));
    return onSnapshot(q, s => setViews(toViews(s).filter((v: ProposalView) => (v.lastSeenAt || 0) > since)), () => setViews([]));
  }, [access, viewer?.id, since]);
  return { views, now };
}

export function useProposalAlerts(viewer: Viewer, deals: any[]) {
  const links = useAllLinks();
  const settings = useProposalSettings();
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
      const noun = l.kind === 'quotation' ? 'quotation' : l.kind === 'outline' ? 'course outline' : 'proposal';
      if (l.accepted && !s.accepted) out[deal.id] = 'Proposal accepted online';
      else if (seesLink(viewer, settings, l) && (l.views || 0) > (s.views || 0) && !out[deal.id]) out[deal.id] = (s.views || 0) > 0 ? `Client opened the ${noun} again` : `Client opened the ${noun}`;
    });
    return out;
  }, [links, deals, seen, settings, viewer.id, viewer.role]);

  // The owner opened the deal: everything on its links so far is seen.
  const markSeen = (dealId: string) => {
    if (!alerts[dealId]) return;
    const patch: Record<string, any> = {};
    links.filter(l => l.dealId === dealId).forEach(l => { patch[l.token] = { views: l.views || 0, accepted: !!l.accepted }; });
    setDoc(doc(db, 'user_prefs', viewer.id), { proposalSeen: patch }, { merge: true }).catch(() => { /* shown again next time */ });
  };
  return { alerts, markSeen, links, settings };
}
