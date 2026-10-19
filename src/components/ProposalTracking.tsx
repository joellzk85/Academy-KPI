import React, { useState } from 'react';
import { AlertTriangle, Laptop, Smartphone, Tablet } from 'lucide-react';
import DocLinkBox from './DocLinkBox';
import { DocLink } from '../lib/docLinks';
import { formatDate } from '../lib/deals';
import { EVENT_LABELS, ProposalView, SECTION_NAMES, agoText, durationText, summarise } from '../lib/proposalTracking';
import { useDealVisits } from '../lib/useProposalLinks';

// The deal panel's "Proposal link" section (push B, 2026-10-19): each teambuilding proposal link on the deal with its
// status, expiry and Copy / Extend / Revoke, and, for people allowed to see tracking, how the client used it:
// views, last opened, total time, time per section, each visit, and "possible" screenshot / print / copy attempts.

const when = (at: number) => new Date(at).toLocaleString('en-MY', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const DeviceIcon = ({ d }: { d: string }) => (d === 'phone' ? <Smartphone className="h-4 w-4" /> : d === 'tablet' ? <Tablet className="h-4 w-4" /> : <Laptop className="h-4 w-4" />);

export default function ProposalTracking({ dealId, links, proposals, canSee }: {
  dealId: string; links: DocLink[]; proposals: any[]; canSee: boolean;
}) {
  const { views, blocked } = useDealVisits(dealId, canSee);
  const live = links.filter(l => l.status === 'open');
  if (!links.length) return <p className="text-[15px] text-ink-soft">No client link yet. Open the teambuilding proposal → Send → Client link.</p>;
  return (
    <div className="space-y-4">
      {(live.length ? live : links.slice(0, 1)).map(l => {
        const p = proposals.find(x => x.id === l.docId);
        const mine = views.filter(v => v.token === l.token);
        return (
          <div key={l.token} className="space-y-3 rounded-xl border border-line p-3.5">
            <p className="text-sm font-semibold">{p?.title || 'Teambuilding proposal'} <span className="font-normal text-ink-soft">{l.refNumber}{l.status !== 'open' ? ' · revoked' : ''}</span></p>
            {l.status === 'open' ? <DocLinkBox link={l} compact showViews={false} /> : <p className="text-sm text-ink-soft">This link was revoked{l.stoppedByName ? ` by ${l.stoppedByName}` : ''}. Make a new one from the proposal's Send window.</p>}
            {canSee && !blocked && <Usage link={l} views={mine} />}
            {!canSee && <p className="text-sm text-ink-soft">How the client uses the proposal is visible to Admin and Management.</p>}
          </div>
        );
      })}
    </div>
  );
}

function Usage({ link, views }: { link: DocLink; views: ProposalView[] }) {
  const [showAll, setShowAll] = useState(false);
  const s = summarise(views);
  if (!link.views && !views.length) return <p className="text-sm text-ink-soft">The client hasn't opened it yet.</p>;
  const max = Math.max(1, ...s.sections.map(x => x.seconds));
  const visits = [...views].sort((a, b) => b.startedAt - a.startedAt);
  return (
    <div className="space-y-3">
      <p className="text-[15px]">
        <strong>Viewed {link.views || views.length} time{(link.views || views.length) === 1 ? '' : 's'}</strong>
        {link.lastViewedAt ? `, last opened ${agoText(link.lastViewedAt)}` : ''}{s.seconds ? `, ${durationText(s.seconds)} in total` : ''}.
      </p>
      {s.sections.length > 0 && (
        <div>
          <p className="mb-1.5 text-sm font-semibold text-ink-soft">Time per section</p>
          <ul className="space-y-1">
            {s.sections.sort((a, b) => b.seconds - a.seconds).map(x => (
              <li key={x.key} className="grid grid-cols-[6.5rem_1fr_4.5rem] items-center gap-2 text-sm">
                <span className="truncate">{SECTION_NAMES[x.key] || x.key}</span>
                <span className="h-2 overflow-hidden rounded-full bg-surface"><span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(4, (x.seconds / max) * 100)}%` }} /></span>
                <span className="text-right text-ink-soft">{durationText(x.seconds)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {visits.length > 0 && (
        <div>
          <p className="mb-1.5 text-sm font-semibold text-ink-soft">Visits</p>
          <ul className="divide-y divide-line rounded-lg border border-line text-sm">
            {(showAll ? visits : visits.slice(0, 5)).map(v => (
              <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2">
                <span className="font-medium">{when(v.startedAt)}</span>
                <span className="flex items-center gap-1 text-ink-soft"><DeviceIcon d={v.device} />{v.device === 'laptop' ? 'Computer' : v.device === 'phone' ? 'Phone' : 'Tablet'} · {v.browser}</span>
                <span className="ml-auto text-ink-soft">{durationText(v.seconds || 0)}</span>
                {(v.events || []).some(e => e.type !== 'rightclick') && <span className="w-full text-xs font-semibold text-attention">{(v.events || []).filter(e => e.type !== 'rightclick').length} possible attempt{(v.events || []).filter(e => e.type !== 'rightclick').length === 1 ? '' : 's'}</span>}
              </li>
            ))}
          </ul>
          {visits.length > 5 && <button type="button" className="mt-1 text-sm font-semibold text-accent hover:underline" onClick={() => setShowAll(v => !v)}>{showAll ? 'Show fewer' : `Show all ${visits.length} visits`}</button>}
        </div>
      )}
      {s.events.length > 0 && (
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-attention"><AlertTriangle className="h-4 w-4" /> Possible screenshot, print or copy attempts</p>
          <ul className="space-y-0.5 text-sm">
            {s.events.slice(0, 20).map((e, i) => {
              const v = views.find(x => x.id === e.visitId);
              return <li key={`${e.visitId}-${e.at}-${i}`}>{EVENT_LABELS[e.type]}{e.how ? ` (${e.how})` : ''} · {when(e.at)}{v ? ` · ${v.device === 'laptop' ? 'computer' : v.device}, ${v.browser}` : ''}</li>;
            })}
          </ul>
          <p className="mt-1 text-xs text-ink-soft">"Possible" only: a browser can't be sure. Phones can't be detected at all.</p>
        </div>
      )}
      <p className="text-xs text-ink-soft">First opened {link.firstViewedAt ? formatDate(new Date(link.firstViewedAt + 8 * 3600_000).toISOString().slice(0, 10)) : '—'}. Team opens (CRM's Open button, or a browser logged in to the CRM) aren't counted.</p>
    </div>
  );
}
