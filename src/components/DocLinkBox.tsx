import React, { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { CalendarClock, Check, CheckCircle2, Copy, ExternalLink, Eye, Link2, Loader2, MessageSquareWarning, RotateCcw } from 'lucide-react';
import { callServer, db, friendlyError } from '../lib/firebase';
import { DocKind, DocLink, docLinkPath, openedText } from '../lib/docLinks';
import { expiryDateMY, expiryProblem, plusDaysMY, seesLink } from '../lib/proposalTracking';
import { useProposalSettings } from '../lib/useProposalSettings';
import { DEFAULT_LINK_SETTINGS, LinkSettings, MAX_OPENS, defaultExpiry, linkState, opensProblem, readLinkSettings, untilText } from '../lib/linkLimits';
import { formatDate } from '../lib/deals';

// The client link of a quotation, course outline or teambuilding proposal (2026-10-19): the link, Copy / Copy message /
// Open, its limits (works until, opens used), the client's request to open it again, Change limits / Reopen, how often
// the client opened it, and Stop link. Used in the Send window and on the sent document.

const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';
const btnPrimary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';

export const docLinkUrl = (l: Pick<DocLink, 'kind' | 'token'>) => `${window.location.origin}${docLinkPath(l.kind, l.token)}`;

// All links of one document, newest first (live).
export function useDocLinks(docId: string | undefined): DocLink[] {
  const [links, setLinks] = useState<DocLink[]>([]);
  useEffect(() => {
    if (!docId) { setLinks([]); return; }
    return onSnapshot(query(collection(db, 'doc_links'), where('docId', '==', docId)),
      s => setLinks(s.docs.map(d => ({ ...(d.data() as any), token: d.id } as DocLink)).sort((a, b) => b.createdAt - a.createdAt)),
      () => setLinks([]));
  }, [docId]);
  return links;
}

// The default limits for new links (config/link_settings; Management changes them in Management → Client links).
export function useLinkSettings(): LinkSettings {
  const [s, setS] = useState<LinkSettings>(DEFAULT_LINK_SETTINGS);
  useEffect(() => onSnapshot(doc(db, 'config', 'link_settings'), d => setS(readLinkSettings(d.data())), () => {}), []);
  return s;
}

export const openLinkOf = (links: DocLink[], kind: DocKind) => links.find(l => l.kind === kind && l.status === 'open') || null;

export async function stopDocLink(token: string) {
  await callServer('/api/doc-link/stop', { token }, true);
}

export default function DocLinkBox({ link, message, compact, viewer }: {
  link: DocLink;
  message?: string;            // a ready-to-paste message with the link at the end
  compact?: boolean;           // on the Sent banner
  viewer?: { id: string; role: string } | null;   // how often the client opened it: Management, or a person Management ticked (own deals)
}) {
  const tb = link.kind === 'teambuilding';
  const showViews = seesLink(viewer, useProposalSettings(), link);
  const settings = useLinkSettings();
  const state = linkState(link);
  const blocked = state === 'expired' || state === 'limit';
  const [changing, setChanging] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [newOpens, setNewOpens] = useState('');
  const url = docLinkUrl(link);
  const [copied, setCopied] = useState<'' | 'link' | 'msg'>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const req = link.reopenRequest;

  const startChange = () => {
    setNewDate(defaultExpiry(settings));
    setNewOpens(String(settings.opens));
    setError('');
    setChanging(true);
  };
  const saveLimits = async () => {
    const problem = expiryProblem(newDate) || opensProblem(Number(newOpens));
    if (problem) { setError(problem); return; }
    setBusy(true); setError('');
    try { await callServer('/api/doc-link/limits', { token: link.token, expires: newDate, opens: Number(newOpens) }, true); setChanging(false); }
    catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };
  const copy = async (what: 'link' | 'msg') => {
    const text = what === 'link' ? url : `${message}\n\n${url}`;
    try { await navigator.clipboard.writeText(text); } catch {
      // Older browsers: select the text so it can be copied by hand.
      window.prompt('Copy this:', text);
    }
    setCopied(what);
    window.setTimeout(() => setCopied(''), 2000);
  };
  const stop = async () => {
    if (!window.confirm(tb ? 'Stop this link? The client will see "no longer active" with your name and the company phone number. Making a new link gives a new address.' : `Stop this link? The client will no longer be able to open it. Sending again makes a new link.`)) return;
    setBusy(true);
    setError('');
    try { await stopDocLink(link.token); } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };

  const opensText = link.maxOpens
    ? showViews ? `Opened ${link.views || 0} of ${link.maxOpens} times` : `Up to ${link.maxOpens} opens`
    : '';

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      <div className="flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2">
        <Link2 className="h-4 w-4 shrink-0 text-accent" />
        <input readOnly value={url} onFocus={e => e.currentTarget.select()} aria-label="Client link"
          className="min-w-0 flex-1 bg-transparent text-sm text-ink focus:outline-none" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btnSecondary} onClick={() => copy('link')}>{copied === 'link' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied === 'link' ? 'Copied' : 'Copy link'}</button>
        {message && <button type="button" className={btnSecondary} onClick={() => copy('msg')}>{copied === 'msg' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied === 'msg' ? 'Copied' : 'Copy message with link'}</button>}
        <a className={btnSecondary} href={`${url}?team=1`} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" /> Open</a>
        <button type="button" className={blocked || req ? btnPrimary : btnSecondary} disabled={busy} onClick={() => (changing ? setChanging(false) : startChange())}>
          {blocked || req ? <RotateCcw className="h-4 w-4" /> : <CalendarClock className="h-4 w-4" />}{blocked || req ? 'Reopen' : 'Change limits'}
        </button>
        <button type="button" className="text-sm font-semibold text-ink-soft hover:text-danger" disabled={busy} onClick={stop}>{busy ? 'Working…' : 'Stop link'}</button>
      </div>

      {/* Limits */}
      <p className={`flex flex-wrap items-center gap-1.5 text-sm ${blocked ? 'font-semibold text-danger' : 'text-ink-soft'}`}>
        <CalendarClock className="h-4 w-4" />
        {state === 'limit' ? `Open limit reached (${link.views || 0} of ${link.maxOpens})` : untilText(link, formatDate)}
        {opensText && state !== 'limit' && <span>· {opensText}</span>}
        {blocked && <span>· The client sees "expired" and can ask for access again.</span>}
      </p>

      {req && (
        <div className="flex items-start gap-2 rounded-lg border border-attention/40 bg-attention-soft px-3 py-2 text-sm text-attention">
          <MessageSquareWarning className="mt-0.5 h-4 w-4 shrink-0" />
          <span><strong>{req.name}</strong> asked to open it again on {formatDate(expiryDateMY(req.at))}{req.note ? `: "${req.note}"` : '.'} Click Reopen to give new limits.</span>
        </div>
      )}

      {changing && (
        <div className="space-y-3 rounded-lg bg-surface p-3">
          <LimitsPicker date={newDate} onDate={setNewDate} opens={newOpens} onOpens={setNewOpens} settings={settings}
            opensLabel={`More opens from now${link.views ? ` (already opened ${link.views} time${link.views === 1 ? '' : 's'})` : ''}`} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnPrimary} disabled={busy} onClick={saveLimits}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {blocked || req ? 'Reopen the link' : 'Save limits'}</button>
            <button type="button" className={btnSecondary} onClick={() => setChanging(false)}>Cancel</button>
          </div>
        </div>
      )}

      {tb && link.accepted && (
        <p className="flex items-start gap-1.5 rounded-lg bg-accent-soft px-3 py-2 text-sm font-semibold text-accent">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />Accepted online by {link.accepted.name} ({link.accepted.position}) on {formatDate(expiryDateMY(link.accepted.at))}{link.accepted.packageName ? `: package "${link.accepted.packageName}"${link.accepted.pax ? `, ${link.accepted.pax} pax` : ''}` : ''}
        </p>
      )}
      {showViews && (
        <p className={`flex items-center gap-1.5 text-sm ${link.views ? 'font-semibold text-accent' : 'text-ink-soft'}`}>
          <Eye className="h-4 w-4" />{link.views ? `Client ${openedText(link).charAt(0).toLowerCase()}${openedText(link).slice(1)}` : 'The client hasn\'t opened it yet'}
        </p>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}

// How long a link works and how many times it can be opened (making it, Change limits, Reopen).
export function LimitsPicker({ date, onDate, opens, onOpens, settings, opensLabel = 'Can be opened (times)' }: {
  date: string; onDate: (v: string) => void; opens: string; onOpens: (v: string) => void; settings: LinkSettings; opensLabel?: string;
}) {
  return (
    <div className="space-y-3">
      <ExpiryPicker value={date} onChange={onDate} label="The link works until" defaultDays={settings.days} />
      <div>
        <label htmlFor="lk-opens" className="mb-1 block text-sm font-semibold text-ink">{opensLabel}</label>
        <input id="lk-opens" inputMode="numeric" value={opens} onChange={e => onOpens(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
          className="w-28 rounded-lg border border-line bg-white px-3 py-1.5 text-sm text-ink focus:border-accent focus:outline-none" />
        <p className="mt-1 text-xs text-ink-soft">A refresh by the client within 30 minutes counts once. Your own opens from the CRM don't count. Up to {MAX_OPENS}.</p>
      </div>
    </div>
  );
}

// The link's expiry date: quick picks (the default days, 7 / 14 / 30 days), or any date up to 180 days ahead.
export function ExpiryPicker({ value, onChange, label = 'Expires on', defaultDays }: { value: string; onChange: (v: string) => void; label?: string; defaultDays?: number }) {
  const days = Array.from(new Set([defaultDays, 7, 14, 30].filter((n): n is number => !!n))).sort((a, b) => a - b);
  return (
    <div>
      <p className="mb-1 text-sm font-semibold text-ink">{label}</p>
      <div className="flex flex-wrap items-center gap-2">
        {days.map(n => {
          const d = plusDaysMY(n);
          return <button key={n} type="button" onClick={() => onChange(d)} aria-pressed={value === d}
            className={`rounded-full border px-3 py-1 text-sm font-semibold ${value === d ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-soft hover:bg-surface'}`}>{n} days</button>;
        })}
        <input type="date" value={value} min={plusDaysMY(0)} max={plusDaysMY(180)} onChange={e => onChange(e.target.value)} aria-label={label}
          className="rounded-lg border border-line bg-white px-3 py-1.5 text-sm text-ink focus:border-accent focus:outline-none" />
      </div>
      <p className="mt-1 text-xs text-ink-soft">Until {formatDate(value)}, 11:59 pm. You can change, reopen or stop it any time.</p>
    </div>
  );
}

// "Make the client link" (Send window): makes it on the server, then the caller locks and logs the send.
export function MakeLinkButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <button type="button" disabled={busy} onClick={onClick}
      className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60">
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}Make the client link
    </button>
  );
}
