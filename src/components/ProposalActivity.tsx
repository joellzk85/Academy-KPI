import React, { useMemo, useState } from 'react';
import { CalendarClock, CheckCircle2, Eye, EyeOff, Flame } from 'lucide-react';
import { dealOwnerId } from '../lib/deals';
import { DocLink } from '../lib/docLinks';
import { ProposalView, agoText, daysLeft, isExpired, plusDaysMY, readingNow, seesLink, summarise } from '../lib/proposalTracking';
import { useAllLinks, useRecentVisits } from '../lib/useProposalLinks';
import { useProposalSettings } from '../lib/useProposalSettings';
import { ReadingNow } from './ProposalTracking';

// My home card "Client link activity" (teambuilding push B 2026-10-19; every link kind since 2026-10-20): client links
// that need a look.
// - Everyone: accepted online (last 14 days), links expiring in the next 3 days.
// - Tracking, only for Management (every deal) and the people Management ticked (their own deals): reading now,
//   Hot (score 60+, last 14 days), opened today, sent but not opened after 3 days.
// - Reps see their own deals; Admin sees everyone's; Management sees everyone's and can pick one person.

type Viewer = { id: string; role: string };
type Kind = 'reading' | 'accepted' | 'hot' | 'opened' | 'unopened' | 'expiring';
type Row = { key: string; link: DocLink; deal: any; kind: Kind; text: string };

const ICON: Record<Kind, React.ReactNode> = {
  reading: <Eye className="mt-0.5 h-4 w-4 shrink-0 text-accent" />,
  accepted: <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />,
  hot: <Flame className="mt-0.5 h-4 w-4 shrink-0 text-danger" />,
  opened: <Eye className="mt-0.5 h-4 w-4 shrink-0 text-accent" />,
  unopened: <EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-attention" />,
  expiring: <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-attention" />,
};
const NOUN: Record<string, string> = { quotation: 'Quotation', outline: 'Course outline', teambuilding: 'Teambuilding proposal' };

export default function ProposalActivity({ viewer, deals, people, nameOf, clientName, onOpen }: {
  viewer: Viewer; deals: any[]; people: { id: string; name: string }[]; nameOf: (id: string) => string;
  clientName: (p: any) => string; onOpen?: (deal: any) => void;
}) {
  const links = useAllLinks();
  const settings = useProposalSettings();
  const { views, now } = useRecentVisits(viewer);
  const [rep, setRep] = useState('');
  const rows = useMemo(() => {
    const today = plusDaysMY(0, now);
    const byToken: Record<string, ProposalView[]> = {};
    views.forEach(v => { (byToken[v.token] ||= []).push(v); });
    const out: Row[] = [];
    links.filter(l => l.status === 'open').forEach(l => {
      const deal = deals.find(d => d.id === l.dealId);
      if (!deal) return;
      const owner = dealOwnerId(deal);
      if (viewer.role === 'rep' && owner !== viewer.id) return;
      if (rep && owner !== rep) return;
      const see = seesLink(viewer, settings, l);
      const noun = NOUN[l.kind] || 'Link';
      const vs = see ? byToken[l.token] || [] : [];
      if (vs.some(v => readingNow(v, now))) {
        out.push({ key: `r_${l.token}`, link: l, deal, kind: 'reading', text: `Reading the ${noun.toLowerCase()} ${l.refNumber || ''} right now: a good moment to call` });
      }
      if (l.accepted && now - l.accepted.at < 14 * 864e5) {
        out.push({ key: `a_${l.token}`, link: l, deal, kind: 'accepted', text: `Accepted online by ${l.accepted.name} (${l.accepted.position}) ${agoText(l.accepted.at, now)}` });
        return;
      }
      if (l.accepted) return;
      const s = vs.length ? summarise(vs, l.kind as any, now) : null;
      if (s && s.heat === 'hot' && !s.readingNow) {
        const why = [s.devices > 1 ? `${s.devices} devices` : '', s.priceFocus ? 'mostly on pricing' : '', `${s.visits} visit${s.visits === 1 ? '' : 's'}`].filter(Boolean).join(', ');
        out.push({ key: `h_${l.token}`, link: l, deal, kind: 'hot', text: `Hot: ${noun} ${l.refNumber || ''} (${why}), last ${agoText(s.last, now)}` });
      } else if (see && !s?.readingNow && l.lastViewedAt && new Date(l.lastViewedAt + 8 * 3600_000).toISOString().slice(0, 10) === today) {
        out.push({ key: `o_${l.token}`, link: l, deal, kind: 'opened', text: `${noun} opened today, ${agoText(l.lastViewedAt, now)} (${l.views} time${l.views === 1 ? '' : 's'} in all)` });
      } else if (see && !l.views && now - l.createdAt > 3 * 864e5 && !isExpired(l, now)) {
        out.push({ key: `u_${l.token}`, link: l, deal, kind: 'unopened', text: `${noun} sent ${agoText(l.createdAt, now)}, not opened yet` });
      }
      const left = daysLeft(l, now);
      if (left !== null && left >= 0 && left <= 3) {
        out.push({ key: `e_${l.token}`, link: l, deal, kind: 'expiring', text: `${noun} link ${left === 0 ? 'expires today' : `expires in ${left} day${left === 1 ? '' : 's'}`}` });
      }
    });
    const order: Record<Kind, number> = { reading: 0, accepted: 1, hot: 2, opened: 3, unopened: 4, expiring: 5 };
    return out.sort((a, b) => order[a.kind] - order[b.kind]);
  }, [links, deals, views, now, viewer.id, viewer.role, rep, settings]);

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
        <p className="text-[15px] text-ink-soft">Nothing new on client links.</p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map(r => (
            <li key={r.key}>
              <button type="button" disabled={!onOpen} onClick={() => onOpen?.(r.deal)} className="flex w-full items-start gap-2 py-2 text-left enabled:hover:bg-surface">
                {ICON[r.kind]}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2"><span className="truncate font-semibold">{clientName(r.deal)}</span>{r.kind === 'reading' && <ReadingNow />}</span>
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
