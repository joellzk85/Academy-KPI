import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { ChevronDown, ChevronRight, Download, ExternalLink, Loader2, Search } from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import { DocKind, DocLink } from '../lib/docLinks';
import { LINK_STATE_LABEL, LinkState, MAX_OPENS, linkState, readLinkSettings } from '../lib/linkLimits';
import { ProposalView, durationText, expiryDateMY, summarise } from '../lib/proposalTracking';
import { useLinkVisits, useRecentVisits } from '../lib/useProposalLinks';
import { HeatBadge, LinkUsage, ReadingNow } from './ProposalTracking';
import { formatDate } from '../lib/deals';
import { docLinkUrl, useLinkSettings } from './DocLinkBox';

// Management → Client links (Joel, 2026-10-19: "management should be able to gather data on these as well. all links
// all data"). Every client link (quotations, course outlines, teambuilding proposals) with its limits, opens and
// requests; totals and a per-person summary; filters; a CSV download; and the default limits for new links.
// Since 2026-10-20 also how each client used the link (Management only): reading now, Hot / Warm / Cold, and the full
// tracking and heatmap in each link's details.

type Person = { id: string; name: string };
type Status = LinkState | 'requested';

const KIND_LABEL: Record<DocKind, string> = { quotation: 'Quotation', outline: 'Course outline', teambuilding: 'Teambuilding proposal', report: 'Training report' };
const input = 'rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink focus:border-accent focus:outline-none';
const btnSecondary = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-surface disabled:opacity-60';
const btnPrimary = 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-[#0B5A50] disabled:opacity-60';
const STATUS_STYLE: Record<Status, string> = {
  active: 'bg-accent-soft text-accent', expired: 'bg-danger-soft text-danger', limit: 'bg-danger-soft text-danger',
  stopped: 'bg-surface text-ink-soft', requested: 'bg-attention-soft text-attention',
};
const ymdOf = (ms?: number) => (ms ? expiryDateMY(ms) : '');
const whenText = (ms?: number) => (ms ? new Date(ms).toLocaleString('en-MY', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const statusOf = (l: DocLink): Status => (l.status === 'open' && l.reopenRequest ? 'requested' : linkState(l));
const statusLabel = (s: Status) => (s === 'requested' ? 'Reopen requested' : LINK_STATE_LABEL[s]);
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

export default function ClientLinksPage({ people, viewer }: { people: Person[]; viewer: Person }) {
  const [links, setLinks] = useState<DocLink[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [kind, setKind] = useState<'' | DocKind>('');
  const [person, setPerson] = useState('');
  const [status, setStatus] = useState<'' | Status>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState('');
  const mgmt = { id: viewer.id, role: 'management' };   // this page is Management only
  const { views: recent, now } = useRecentVisits(mgmt);
  const live = useMemo(() => {
    const by: Record<string, ProposalView[]> = {};
    recent.forEach(v => { (by[v.token] ||= []).push(v); });
    const out: Record<string, ReturnType<typeof summarise>> = {};
    Object.entries(by).forEach(([t, vs]) => { out[t] = summarise(vs, vs[0]?.kind, now); });
    return out;
  }, [recent, now]);

  useEffect(() => onSnapshot(collection(db, 'doc_links'),
    s => { setLinks(s.docs.map(d => ({ ...(d.data() as any), token: d.id } as DocLink)).sort((a, b) => b.createdAt - a.createdAt)); setLoaded(true); },
    () => setLoaded(true)), []);

  const nameOf = (id?: string) => people.find(p => p.id === id)?.name || '';
  const repOf = (l: DocLink) => l.ownerId || l.byId;

  const shown = useMemo(() => links.filter(l => {
    if (kind && l.kind !== kind) return false;
    if (person && repOf(l) !== person && l.byId !== person) return false;
    if (status && statusOf(l) !== status) return false;
    const made = ymdOf(l.createdAt);
    if (from && made < from) return false;
    if (to && made > to) return false;
    if (q.trim()) {
      const t = q.trim().toLowerCase();
      if (!`${l.company} ${l.refNumber} ${l.byName} ${nameOf(l.ownerId)}`.toLowerCase().includes(t)) return false;
    }
    return true;
  }), [links, kind, person, status, from, to, q, people]);

  const totals = useMemo(() => {
    const opened = shown.filter(l => l.views);
    const totalOpens = shown.reduce((t, l) => t + (l.views || 0), 0);
    return {
      made: shown.length, opened: opened.length, totalOpens,
      avg: opened.length ? (totalOpens / opened.length).toFixed(1) : '0',
      requests: shown.filter(l => l.status === 'open' && l.reopenRequest).length,
      expired: shown.filter(l => ['expired', 'limit'].includes(linkState(l))).length,
      accepted: shown.filter(l => l.accepted).length,
      tbSeconds: shown.reduce((t, l) => t + (l.totalSeconds || 0), 0),
    };
  }, [shown]);

  const byPerson = useMemo(() => {
    const m = new Map<string, { id: string; made: number; opened: number; opens: number; requests: number }>();
    shown.forEach(l => {
      const id = repOf(l) || '';
      const r = m.get(id) || { id, made: 0, opened: 0, opens: 0, requests: 0 };
      r.made++; if (l.views) r.opened++; r.opens += l.views || 0; if (l.status === 'open' && l.reopenRequest) r.requests++;
      m.set(id, r);
    });
    return Array.from(m.values()).sort((a, b) => b.made - a.made);
  }, [shown]);

  const downloadCsv = () => {
    const head = ['Type', 'Reference', 'Client', 'Rep (deal owner)', 'Link made by', 'Made on', 'Works until', 'Opens used', 'Open limit',
      'First opened', 'Last opened', 'Time on page (teambuilding)', 'Status', 'Reopen requested by', 'Request note', 'Requested on',
      'Last reopened by', 'Accepted online by', 'Stopped by', 'Link'];
    const rows = shown.map(l => [
      KIND_LABEL[l.kind], l.refNumber, l.company, nameOf(repOf(l)), l.byName, whenText(l.createdAt), ymdOf(l.expiresAt), l.views || 0, l.maxOpens || '',
      whenText(l.firstViewedAt), whenText(l.lastViewedAt), l.totalSeconds ? durationText(l.totalSeconds) : '', statusLabel(statusOf(l)),
      l.reopenRequest?.name || '', l.reopenRequest?.note || '', whenText(l.reopenRequest?.at), l.reopenedByName || '',
      l.accepted ? `${l.accepted.name} (${l.accepted.position})` : '', l.stoppedByName || '', docLinkUrl(l),
    ]);
    const csv = [head, ...rows].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `NEXT-Academy-client-links-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
  };

  return (
    <div className="space-y-5 font-sans text-ink">
      <div>
        <h2 className="text-xl font-bold">Client links</h2>
        <p className="text-[15px] text-ink-soft">Every link sent to clients for quotations, course outlines and teambuilding proposals: how long it works, how often it was opened, and requests to open it again.</p>
      </div>

      <DefaultsCard viewer={viewer} />

      {/* Totals */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Reading now" value={shown.filter(l => live[l.token]?.readingNow).length} sub="Clients on a link this minute" />
        <Tile label="Hot links" value={shown.filter(l => live[l.token]?.heat === 'hot').length} sub="Last 14 days" />
        <Tile label="Links sent" value={totals.made} />
        <Tile label="Opened by the client" value={`${totals.opened}`} sub={`${pct(totals.opened, totals.made)}% of links`} />
        <Tile label="Total opens" value={totals.totalOpens} sub={`${totals.avg} per opened link`} />
        <Tile label="Expired or out of opens" value={totals.expired} />
        <Tile label="Reopen requests waiting" value={totals.requests} warn={totals.requests > 0} />
        <Tile label="Accepted online" value={totals.accepted} sub={totals.tbSeconds ? `${durationText(totals.tbSeconds)} on teambuilding pages` : 'Teambuilding proposals'} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-line bg-white p-4">
        <label className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Client, reference or person" aria-label="Search links" className={`${input} w-full pl-9`} />
        </label>
        <select value={kind} onChange={e => setKind(e.target.value as any)} className={input} aria-label="Type">
          <option value="">All types</option>
          {(Object.keys(KIND_LABEL) as DocKind[]).map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
        <select value={person} onChange={e => setPerson(e.target.value)} className={input} aria-label="Person">
          <option value="">Everyone</option>
          {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={status} onChange={e => setStatus(e.target.value as any)} className={input} aria-label="Status">
          <option value="">Any status</option>
          {(['active', 'requested', 'expired', 'limit', 'stopped'] as Status[]).map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </select>
        <label className="text-sm">Sent from<input type="date" value={from} onChange={e => setFrom(e.target.value)} className={`${input} ml-1`} /></label>
        <label className="text-sm">to<input type="date" value={to} onChange={e => setTo(e.target.value)} className={`${input} ml-1`} /></label>
        <button type="button" className={btnSecondary} onClick={downloadCsv} disabled={!shown.length}><Download className="h-4 w-4" /> Download (Excel CSV)</button>
      </div>

      {/* By person */}
      {byPerson.length > 0 && (
        <section className="rounded-2xl border border-line bg-white p-4">
          <h3 className="mb-2 font-bold">By person</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left text-[15px]">
              <thead className="text-sm text-ink-soft"><tr><th className="py-1.5 pr-3 font-semibold">Person</th><th className="pr-3 font-semibold">Links sent</th><th className="pr-3 font-semibold">Opened</th><th className="pr-3 font-semibold">Total opens</th><th className="font-semibold">Requests waiting</th></tr></thead>
              <tbody className="divide-y divide-line">
                {byPerson.map(r => (
                  <tr key={r.id}>
                    <td className="py-1.5 pr-3"><button type="button" className="font-semibold text-accent hover:underline" onClick={() => setPerson(r.id)}>{nameOf(r.id) || 'Unknown'}</button></td>
                    <td className="pr-3">{r.made}</td>
                    <td className="pr-3">{r.opened} ({pct(r.opened, r.made)}%)</td>
                    <td className="pr-3">{r.opens}</td>
                    <td className={r.requests ? 'font-semibold text-attention' : ''}>{r.requests}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* All links */}
      <section className="rounded-2xl border border-line bg-white">
        {!loaded ? <p className="flex items-center gap-2 p-4 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
          : !shown.length ? <p className="p-4 text-[15px] text-ink-soft">{links.length ? 'No links match these filters.' : 'No client links yet. They appear here when someone sends a quotation, course outline or teambuilding proposal by client link.'}</p>
          : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[60rem] text-left text-[15px]">
                <thead className="border-b border-line text-sm text-ink-soft">
                  <tr>
                    <th className="w-8" /><th className="py-2 pr-3 font-semibold">Document</th><th className="pr-3 font-semibold">Client</th><th className="pr-3 font-semibold">Rep</th>
                    <th className="pr-3 font-semibold">Sent</th><th className="pr-3 font-semibold">Works until</th><th className="pr-3 font-semibold">Opens</th>
                    <th className="pr-3 font-semibold">Last opened</th><th className="pr-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {shown.map(l => {
                    const s = statusOf(l);
                    const isOpen = open === l.token;
                    return (
                      <React.Fragment key={l.token}>
                        <tr className="cursor-pointer hover:bg-surface" onClick={() => setOpen(isOpen ? '' : l.token)}>
                          <td className="pl-3 text-ink-soft">{isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                          <td className="py-2 pr-3"><span className="block font-semibold">{l.refNumber || '—'}</span><span className="text-sm text-ink-soft">{KIND_LABEL[l.kind]}</span>
                            {live[l.token] && (live[l.token].readingNow || live[l.token].heat !== 'cold') && <span className="mt-1 flex flex-wrap gap-1">{live[l.token].readingNow && <ReadingNow />}{live[l.token].heat !== 'cold' && <HeatBadge level={live[l.token].heat} score={live[l.token].score} />}</span>}</td>
                          <td className="pr-3">{l.company || '—'}</td>
                          <td className="pr-3">{nameOf(repOf(l)) || l.byName}</td>
                          <td className="pr-3 text-sm">{formatDate(ymdOf(l.createdAt))}</td>
                          <td className="pr-3 text-sm">{l.expiresAt ? formatDate(ymdOf(l.expiresAt)) : 'Standard (from next open)'}</td>
                          <td className="pr-3">{l.views || 0}{l.maxOpens ? ` / ${l.maxOpens}` : ''}</td>
                          <td className="pr-3 text-sm">{l.lastViewedAt ? whenText(l.lastViewedAt) : <span className="text-ink-soft">Not opened</span>}</td>
                          <td className="pr-3"><span className={`whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[s]}`}>{statusLabel(s)}</span></td>
                        </tr>
                        {isOpen && (
                          <tr className="bg-surface/60">
                            <td />
                            <td colSpan={8} className="py-3 pr-3 text-sm">
                              <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                                <Detail k="Link made by" v={`${l.byName || '—'}, ${whenText(l.createdAt)}`} />
                                <Detail k="First opened" v={whenText(l.firstViewedAt) || 'Not yet'} />
                                {l.totalSeconds ? <Detail k="Time on the page" v={durationText(l.totalSeconds)} /> : null}
                                {l.reopenRequest && <Detail k="Reopen requested" v={`${l.reopenRequest.name}, ${whenText(l.reopenRequest.at)}${l.reopenRequest.note ? `: "${l.reopenRequest.note}"` : ''}`} />}
                                {l.reopenedByName && <Detail k="Last reopened" v={`${l.reopenedByName}, ${whenText(l.reopenedAt)}`} />}
                                {l.extendedByName && !l.reopenedByName && <Detail k="Limits changed" v={`${l.extendedByName}, ${whenText(l.extendedAt)}`} />}
                                {l.accepted && <Detail k="Accepted online" v={`${l.accepted.name} (${l.accepted.position}), ${whenText(l.accepted.at)}${l.accepted.packageName ? `, package "${l.accepted.packageName}"` : ''}`} />}
                                {l.stoppedByName && <Detail k="Stopped" v={`${l.stoppedByName}, ${whenText(l.stoppedAt)}`} />}
                              </dl>
                              <div className="mt-3 rounded-xl border border-line bg-white p-3.5"><UsageOf link={l} viewer={mgmt} /></div>
                              <a href={`${docLinkUrl(l)}?team=1`} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 font-semibold text-accent hover:underline"><ExternalLink className="h-4 w-4" /> Open the link (not counted)</a>
                              <p className="mt-1 text-ink-soft">To reopen or change limits, open the {KIND_LABEL[l.kind].toLowerCase()} in the CRM.</p>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </section>
    </div>
  );
}

// How the client used one link (every visit, not just the last 14 days).
function UsageOf({ link, viewer }: { link: DocLink; viewer: { id: string; role: string } }) {
  const { views, blocked } = useLinkVisits({ token: link.token }, viewer);
  if (blocked) return <p className="text-sm text-ink-soft">Tracking couldn't be loaded.</p>;
  return <LinkUsage link={link} views={views} />;
}

function Tile({ label, value, sub, warn }: { label: string; value: React.ReactNode; sub?: string; warn?: boolean }) {
  return (
    <div className={`rounded-2xl border bg-white p-4 ${warn ? 'border-attention/50' : 'border-line'}`}>
      <p className="text-sm text-ink-soft">{label}</p>
      <p className={`text-2xl font-bold ${warn ? 'text-attention' : ''}`}>{value}</p>
      {sub && <p className="text-xs text-ink-soft">{sub}</p>}
    </div>
  );
}

function Detail({ k, v }: { k: string; v: string }) {
  return <div className="flex gap-2"><dt className="shrink-0 font-semibold">{k}:</dt><dd className="min-w-0">{v}</dd></div>;
}

// The default limits for new links (Management).
function DefaultsCard({ viewer }: { viewer: Person }) {
  const current = useLinkSettings();
  const [days, setDays] = useState('');
  const [opens, setOpens] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { setDays(String(current.days)); setOpens(String(current.opens)); }, [current.days, current.opens]);
  const save = async () => {
    const d = Number(days), o = Number(opens);
    if (!Number.isInteger(d) || d < 1 || d > 180) return setMsg({ ok: false, text: 'Days must be 1 to 180.' });
    if (!Number.isInteger(o) || o < 1 || o > MAX_OPENS) return setMsg({ ok: false, text: `Opens must be 1 to ${MAX_OPENS}.` });
    setBusy(true); setMsg(null);
    try {
      await setDoc(doc(db, 'config', 'link_settings'), { ...readLinkSettings({ days: d, opens: o }), updatedAt: Date.now(), updatedById: viewer.id, updatedByName: viewer.name });
      setMsg({ ok: true, text: 'Saved. New links start with these limits.' });
    } catch (e) { setMsg({ ok: false, text: friendlyError(e) }); } finally { setBusy(false); }
  };
  const dirty = days !== String(current.days) || opens !== String(current.opens);
  return (
    <section className="rounded-2xl border border-line bg-white p-4">
      <h3 className="font-bold">Default limits for new links</h3>
      <p className="mb-3 text-[15px] text-ink-soft">What the Send window starts with. The person sending can change them for each link. Links already sent keep their own limits.</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm font-semibold">Works for (days)<input inputMode="numeric" value={days} onChange={e => setDays(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} className={`${input} mt-1 block w-28`} /></label>
        <label className="text-sm font-semibold">Can be opened (times)<input inputMode="numeric" value={opens} onChange={e => setOpens(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} className={`${input} mt-1 block w-28`} /></label>
        <button type="button" className={btnPrimary} disabled={busy || !dirty} onClick={save}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save</button>
        {msg && <p role={msg.ok ? 'status' : 'alert'} className={`text-sm ${msg.ok ? 'text-accent' : 'text-danger'}`}>{msg.text}</p>}
      </div>
    </section>
  );
}
