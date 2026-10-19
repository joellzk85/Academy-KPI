import React, { useMemo, useState } from 'react';
import { CalendarClock, CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { dealOwnerId } from '../lib/deals';
import { DocLink } from '../lib/docLinks';
import { agoText, canSeeTracking, daysLeft, isExpired, plusDaysMY } from '../lib/proposalTracking';
import { useTbLinks } from '../lib/useProposalLinks';
import { useProposalSettings } from '../lib/useProposalSettings';

// My home card "Proposal activity" (push B, Joel 2026-10-19): teambuilding proposal links that need a look.
// - Accepted online (last 14 days), opened today, sent but not opened after 3 days, expiring in the next 3 days.
// - Reps see their own deals; Admin sees everyone's; Management sees everyone's and can pick one rep.
// - "Opened" and "not opened" are tracking: reps see them only when Management has switched it on.

type Viewer = { id: string; role: string };
type Row = { key: string; link: DocLink; deal: any; kind: 'accepted' | 'opened' | 'unopened' | 'expiring'; text: string };

const ICON: Record<Row['kind'], React.ReactNode> = {
  accepted: <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />,
  opened: <Eye className="mt-0.5 h-4 w-4 shrink-0 text-accent" />,
  unopened: <EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-attention" />,
  expiring: <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-attention" />,
};

export default function ProposalActivity({ viewer, deals, people, nameOf, clientName, onOpen }: {
  viewer: Viewer; deals: any[]; people: { id: string; name: string }[]; nameOf: (id: string) => string;
  clientName: (p: any) => string; onOpen?: (deal: any) => void;
}) {
  const links = useTbLinks();
  const see = canSeeTracking(viewer.role, useProposalSettings());
  const [rep, setRep] = useState('');
  const rows = useMemo(() => {
    const now = Date.now();
    const today = plusDaysMY(0, now);
    const out: Row[] = [];
    links.filter(l => l.status === 'open').forEach(l => {
      const deal = deals.find(d => d.id === l.dealId);
      if (!deal) return;
      const owner = dealOwnerId(deal);
      if (viewer.role === 'rep' && owner !== viewer.id) return;
      if (rep && owner !== rep) return;
      const left = daysLeft(l, now);
      if (l.accepted && now - l.accepted.at < 14 * 864e5) {
        out.push({ key: `a_${l.token}`, link: l, deal, kind: 'accepted', text: `Accepted online by ${l.accepted.name} (${l.accepted.position}) ${agoText(l.accepted.at, now)}` });
        return;
      }
      if (l.accepted) return;
      if (see && l.lastViewedAt && new Date(l.lastViewedAt + 8 * 3600_000).toISOString().slice(0, 10) === today) {
        out.push({ key: `o_${l.token}`, link: l, deal, kind: 'opened', text: `Opened today, ${agoText(l.lastViewedAt, now)} (${l.views} time${l.views === 1 ? '' : 's'} in all)` });
      } else if (see && !l.views && now - l.createdAt > 3 * 864e5 && !isExpired(l, now)) {
        out.push({ key: `u_${l.token}`, link: l, deal, kind: 'unopened', text: `Sent ${agoText(l.createdAt, now)}, not opened yet` });
      }
      if (left !== null && left >= 0 && left <= 3) {
        out.push({ key: `e_${l.token}`, link: l, deal, kind: 'expiring', text: left === 0 ? 'Link expires today' : `Link expires in ${left} day${left === 1 ? '' : 's'}` });
      }
    });
    const order = { accepted: 0, opened: 1, unopened: 2, expiring: 3 };
    return out.sort((a, b) => order[a.kind] - order[b.kind]);
  }, [links, deals, viewer.id, viewer.role, rep, see]);

  const owners = viewer.role === 'management'
    ? people.filter(p => links.some(l => { const d = deals.find(x => x.id === l.dealId); return d && dealOwnerId(d) === p.id; }))
    : [];

  return (
    <div className="space-y-2">
      {owners.length > 1 && (
        <select value={rep} onChange={e => setRep(e.target.value)} aria-label="Whose deals"
          className="w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm text-ink focus:border-accent focus:outline-none">
          <option value="">Everyone</option>
          {owners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      )}
      {rows.length === 0 ? (
        <p className="text-[15px] text-ink-soft">Nothing new on teambuilding proposal links.</p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map(r => (
            <li key={r.key}>
              <button type="button" disabled={!onOpen} onClick={() => onOpen?.(r.deal)} className="flex w-full items-start gap-2 py-2 text-left enabled:hover:bg-surface">
                {ICON[r.kind]}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{clientName(r.deal)}</span>
                  <span className="block text-sm text-ink-soft">{r.text}{viewer.role !== 'rep' ? ` · ${nameOf(dealOwnerId(r.deal))}` : ''}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
