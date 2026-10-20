import React, { Suspense, lazy, useState } from 'react';
import { AlertTriangle, Flame, Laptop, ScanEye, Smartphone, Tablet } from 'lucide-react';
import DocLinkBox from './DocLinkBox';
import { DocLink } from '../lib/docLinks';
import { formatDate } from '../lib/deals';
import {
  EVENT_LABELS, HEAT_LABEL, LinkKind, ProposalView, agoText, durationText, readingNow, sectionName, seesLink, summarise,
} from '../lib/proposalTracking';
import { useProposalSettings } from '../lib/useProposalSettings';
import { useLinkVisits } from '../lib/useProposalLinks';

// The deal panel's "Client links" section (teambuilding push B 2026-10-19; every link kind since 2026-10-20): each
// client link on the deal with its status, limits and Copy / Change limits / Stop, and, only for Management (and the
// people Management ticked, on their own deals), how the client used it: reading now, Hot / Warm / Cold, views,
// active and idle time, devices (possibly forwarded), read to the end or where they stopped, time on pricing, time
// per part, packages tried, each visit, possible screenshot / print / copy / download attempts, and the heatmap.

type Viewer = { id: string; role: string };

// The heatmap loads only when someone opens it (it brings the document layouts with it).
const LinkHeatmap = lazy(() => import('./LinkHeatmap'));

export const when = (at: number) => new Date(at).toLocaleString('en-MY', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const DeviceIcon = ({ d }: { d: string }) => (d === 'phone' ? <Smartphone className="h-4 w-4" /> : d === 'tablet' ? <Tablet className="h-4 w-4" /> : <Laptop className="h-4 w-4" />);
export const deviceName = (d: string) => (d === 'laptop' ? 'Computer' : d === 'phone' ? 'Phone' : 'Tablet');
export const KIND_NOUN: Record<string, string> = { quotation: 'Quotation', outline: 'Course outline', teambuilding: 'Teambuilding proposal' };

export default function ProposalTracking({ dealId, links, viewer }: { dealId: string; links: DocLink[]; viewer: Viewer }) {
  const settings = useProposalSettings();
  const { views, blocked } = useLinkVisits({ dealId }, viewer);
  if (!links.length) return <p className="text-[15px] text-ink-soft">No client link yet. Send a quotation, course outline or teambuilding proposal → Client link.</p>;
  // Live links first, then the newest stopped one of each document.
  const shown = [...links].sort((a, b) => Number(b.status === 'open') - Number(a.status === 'open') || b.createdAt - a.createdAt)
    .filter((l, i, all) => l.status === 'open' || !all.slice(0, i).some(x => x.docId === l.docId));
  return (
    <div className="space-y-4">
      {shown.map(l => {
        const sees = seesLink(viewer, settings, l) && !blocked;
        return (
          <div key={l.token} className="space-y-3 rounded-xl border border-line p-3.5">
            <p className="text-sm font-semibold">{KIND_NOUN[l.kind] || 'Document'} <span className="font-normal text-ink-soft">{l.refNumber}{l.status !== 'open' ? ' · stopped' : ''}</span></p>
            {l.status === 'open'
              ? <DocLinkBox link={l} compact viewer={viewer} />
              : <p className="text-sm text-ink-soft">This link was stopped{l.stoppedByName ? ` by ${l.stoppedByName}` : ''}. Make a new one from the document's Send window.</p>}
            {sees && <LinkUsage link={l} views={views.filter(v => v.token === l.token)} />}
          </div>
        );
      })}
    </div>
  );
}

const HEAT_STYLE: Record<string, string> = {
  hot: 'bg-danger-soft text-danger',
  warm: 'bg-attention-soft text-attention',
  cold: 'bg-surface text-ink-soft',
};

export function HeatBadge({ level, score }: { level: 'hot' | 'warm' | 'cold'; score?: number }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${HEAT_STYLE[level]}`} title={score !== undefined ? `Interest score ${score} of 100` : undefined}>
      <Flame className="h-3.5 w-3.5" />{HEAT_LABEL[level]}
    </span>
  );
}

export function ReadingNow() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">
      <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-accent" /></span>
      Reading now
    </span>
  );
}

// How the client used one link.
export function LinkUsage({ link, views }: { link: DocLink; views: ProposalView[] }) {
  const [showAll, setShowAll] = useState(false);
  const [heatmap, setHeatmap] = useState(false);
  const kind = link.kind as LinkKind;
  const s = summarise(views, kind);
  if (!link.views && !views.length) return <p className="text-sm text-ink-soft">The client hasn't opened it yet.</p>;
  const max = Math.max(1, ...s.sections.map(x => x.seconds));
  const visits = [...views].sort((a, b) => b.startedAt - a.startedAt);
  const opens = link.views || views.length;
  const attempts = s.events.filter(e => e.type !== 'rightclick');
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {s.readingNow && <ReadingNow />}
        {views.length > 0 && <HeatBadge level={s.heat} score={s.score} />}
        <p className="text-[15px]">
          <strong>Viewed {opens} time{opens === 1 ? '' : 's'}</strong>
          {link.lastViewedAt ? `, last opened ${agoText(link.lastViewedAt)}` : ''}.
        </p>
      </div>
      {s.seconds > 0 && (
        <p className="text-sm text-ink-soft">
          Open for {durationText(s.seconds)}: <strong className="text-ink">{durationText(s.active)} reading</strong>{s.idle >= 5 ? `, ${durationText(s.idle)} idle (open but not touched)` : ''}.
        </p>
      )}
      {views.length > 0 && (
        <ul className="space-y-1 text-sm">
          {s.devices > 1 && <li className="font-semibold text-accent">Possibly forwarded: opened on {s.devices} different devices or browsers.</li>}
          {s.depth > 0 && <li>{s.reachedEnd ? 'Read to the end.' : `Got ${Math.round(s.depth * 100)}% of the way down${s.stoppedAt ? `, last part reached: ${s.stoppedAt}` : ''}.`}</li>}
          {s.priceFocus && <li className="font-semibold text-attention">Spent most of the time on pricing ({Math.round(s.priceShare * 100)}% of reading time).</li>}
          {s.picks.length > 0 && <li>Tried: {s.picks.slice(0, 6).map(p => `${p.label}${p.times > 1 ? ` (${p.times}×)` : ''}`).join(', ')}.</li>}
        </ul>
      )}
      {s.sections.length > 0 && (
        <div>
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-ink-soft">Time on each part</p>
            <button type="button" onClick={() => setHeatmap(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1 text-sm font-semibold text-ink hover:bg-surface">
              <ScanEye className="h-4 w-4" /> Show heatmap
            </button>
          </div>
          <ul className="space-y-1">
            {s.sections.sort((a, b) => b.seconds - a.seconds).map(x => (
              <li key={x.key} className="grid grid-cols-[8.5rem_1fr_4.5rem] items-center gap-2 text-sm">
                <span className="truncate" title={sectionName(kind, x.key)}>{sectionName(kind, x.key)}</span>
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
            {(showAll ? visits : visits.slice(0, 5)).map(v => {
              const tries = (v.events || []).filter(e => e.type !== 'rightclick').length;
              return (
                <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2">
                  <span className="font-medium">{when(v.startedAt)}</span>
                  <span className="flex items-center gap-1 text-ink-soft"><DeviceIcon d={v.device} />{deviceName(v.device)} · {v.browser}</span>
                  {readingNow(v) && <ReadingNow />}
                  <span className="ml-auto text-ink-soft">{durationText(v.active ?? v.seconds ?? 0)} reading{v.depth ? ` · ${Math.round(v.depth * 100)}% down` : ''}</span>
                  {tries > 0 && <span className="w-full text-xs font-semibold text-attention">{tries} possible attempt{tries === 1 ? '' : 's'}</span>}
                </li>
              );
            })}
          </ul>
          {visits.length > 5 && <button type="button" className="mt-1 text-sm font-semibold text-accent hover:underline" onClick={() => setShowAll(v => !v)}>{showAll ? 'Show fewer' : `Show all ${visits.length} visits`}</button>}
        </div>
      )}
      {attempts.length > 0 && (
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-attention"><AlertTriangle className="h-4 w-4" /> Possible screenshot, print, copy or download attempts</p>
          <ul className="space-y-0.5 text-sm">
            {attempts.slice(0, 20).map((e, i) => {
              const v = views.find(x => x.id === e.visitId);
              return <li key={`${e.visitId}-${e.at}-${i}`}>{EVENT_LABELS[e.type]}{e.how ? ` (${e.how})` : ''} · {when(e.at)}{v ? ` · ${deviceName(v.device).toLowerCase()}, ${v.browser}` : ''}</li>;
            })}
          </ul>
          <p className="mt-1 text-xs text-ink-soft">"Possible" only: a browser can't be sure, and a phone's own screenshot buttons can't be detected. All were blocked or blurred.</p>
        </div>
      )}
      <p className="text-xs text-ink-soft">First opened {link.firstViewedAt ? formatDate(new Date(link.firstViewedAt + 8 * 3600_000).toISOString().slice(0, 10)) : '—'}. Team opens (the CRM's Open button, or a browser logged in to the CRM) aren't counted. The client isn't told.</p>
      {heatmap && <Suspense fallback={null}><LinkHeatmap link={link} views={views} onClose={() => setHeatmap(false)} /></Suspense>}
    </div>
  );
}
