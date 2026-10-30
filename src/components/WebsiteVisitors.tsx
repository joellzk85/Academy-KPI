// Website → Visitors (Batch 4, Joel 2026-10-30: Management only; docs/features/website.md). Visits counted by the
// website itself (lib/websiteStats.ts, no cookies), and the money they lead to: website enquiries → deals made →
// won deals and RM, by where the visitor came from. Plus a maker for tracked links (campaign tags).
import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { Check, Copy, Loader2 } from 'lucide-react';
import { callServer, db } from '../lib/firebase';
import { dealStage, dealValue, formatRM } from '../lib/deals';
import { ENQUIRIES, SiteEnquiry, WEBSITE_SOURCE } from '../lib/websiteEnquiries';
import { STATS, STATS_TEST, StatsDay, campaignTag, pageKeyLabel, sumDays } from '../lib/websiteStats';
import { SiteData, todayMY } from '../lib/websiteData';
import { SitePage, SiteSettings } from '../lib/website';

const DAY = 864e5;
const isoDay = (t: number) => new Date(t + 8 * 3600e3).toISOString().slice(0, 10);
const shortDay = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-MY', { day: 'numeric', month: 'short' });
const input = 'rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';

function Tile({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) {
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <p className="text-sm text-ink-soft">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-ink">{value}</p>
      {note && <p className="mt-0.5 text-xs text-ink-soft">{note}</p>}
    </div>
  );
}

/** One measure per day: thin teal bars on the baseline, a hover label on each, the dates under the ends. */
function DailyBars({ days, values }: { days: string[]; values: number[] }) {
  const max = Math.max(1, ...values);
  return (
    <figure className="m-0">
      <div className="flex h-40 items-end gap-[2px] border-b border-line" role="img" aria-label={`Visits per day, highest ${max}`}>
        {days.map((d, i) => (
          <div key={d} className="group relative flex h-full flex-1 items-end" title={`${shortDay(d)}: ${values[i]} visit${values[i] === 1 ? '' : 's'}`}>
            <div className="w-full rounded-t-[4px] bg-accent transition-opacity group-hover:opacity-80" style={{ height: `${(values[i] / max) * 100}%`, minHeight: values[i] ? 2 : 0 }} />
            <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-ink px-2 py-1 text-xs text-white group-hover:block">{shortDay(d)}: {values[i]}</span>
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs text-ink-soft"><span>{shortDay(days[0])}</span><span>{shortDay(days[days.length - 1])}</span></div>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-ink-soft">Show as a table</summary>
        <table className="mt-2 w-full max-w-sm text-left text-sm">
          <thead><tr className="text-ink-soft"><th className="py-1 font-semibold">Day</th><th className="py-1 text-right font-semibold">Visits</th></tr></thead>
          <tbody>{days.map((d, i) => <tr key={d} className="border-t border-line"><td className="py-1">{shortDay(d)}</td><td className="py-1 text-right tabular-nums">{values[i]}</td></tr>)}</tbody>
        </table>
      </details>
    </figure>
  );
}

/** A ranked list with a bar behind each number (one colour; the words say what each row is). */
function RankList({ title, rows, empty, label = (k: string) => k }: { title: string; rows: Record<string, number>; empty: string; label?: (k: string) => string }) {
  const list = Object.entries(rows).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const max = Math.max(1, ...list.map(([, v]) => v));
  return (
    <section className="rounded-xl border border-line bg-white p-4">
      <h3 className="mb-3 font-semibold text-ink">{title}</h3>
      {list.length === 0 ? <p className="text-sm text-ink-soft">{empty}</p> : (
        <ul className="space-y-2">
          {list.map(([k, v]) => (
            <li key={k} className="text-sm">
              <div className="flex justify-between gap-3"><span className="min-w-0 truncate text-ink">{label(k)}</span><span className="tabular-nums text-ink-soft">{v}</span></div>
              <div className="mt-1 h-1.5 rounded-full bg-surface"><div className="h-1.5 rounded-full bg-accent" style={{ width: `${(v / max) * 100}%` }} /></div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LinkMaker({ settings, pages, data }: { settings: SiteSettings; pages: SitePage[]; data: SiteData | null }) {
  const domain = (settings.domains || [])[0];
  const base = domain ? `https://${domain}` : `${window.location.origin}/site`;
  const options = useMemo(() => {
    const list: { path: string; label: string }[] = [{ path: '', label: 'Homepage' }, { path: 'training-calendar', label: 'Training calendar' }, { path: 'programmes', label: 'Programmes' }, { path: 'trainers', label: 'Trainers' }];
    pages.filter(p => p.published && !(p as any).deleted && p.slug && !list.some(x => x.path === p.slug)).forEach(p => list.push({ path: p.slug, label: p.title }));
    (data?.programmes || []).forEach(p => list.push({ path: `programmes/${p.slug}`, label: `Programme: ${p.name}` }));
    return list;
  }, [pages, data]);
  const [path, setPath] = useState('');
  const [source, setSource] = useState('facebook');
  const [other, setOther] = useState('');
  const [campaign, setCampaign] = useState('');
  const [copied, setCopied] = useState(false);
  const src = source === 'other' ? campaignTag(other) : source;
  const medium = source === 'email' ? 'email' : source === 'whatsapp' ? 'message' : 'social';
  const link = `${base}/${path}?utm_source=${encodeURIComponent(src || 'other')}&utm_medium=${medium}${campaign.trim() ? `&utm_campaign=${encodeURIComponent(campaignTag(campaign))}` : ''}`;
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { /* the link can be selected by hand */ } };
  return (
    <section className="rounded-xl border border-line bg-white p-4">
      <h3 className="font-semibold text-ink">Make a tracked link</h3>
      <p className="mt-1 text-sm text-ink-soft">Use it in a post, an ad or a message: visits and enquiries from it show under its own name here.{!domain && ' Until the website has its own address, links go to the test site.'}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm font-semibold text-ink">Page
          <select className={input} value={path} onChange={e => setPath(e.target.value)}>{options.map(o => <option key={o.path} value={o.path}>{o.label}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold text-ink">Where you'll post it
          <select className={input} value={source} onChange={e => setSource(e.target.value)}>
            <option value="facebook">Facebook</option><option value="instagram">Instagram</option><option value="linkedin">LinkedIn</option>
            <option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="other">Somewhere else…</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold text-ink">Campaign name <span className="font-normal text-ink-soft">(optional)</span>
          <input className={input} value={campaign} onChange={e => setCampaign(e.target.value)} placeholder="e.g. December leadership promo" />
        </label>
        {source === 'other' && (
          <label className="flex flex-col gap-1 text-sm font-semibold text-ink sm:col-span-3">Where
            <input className={input} value={other} onChange={e => setOther(e.target.value)} placeholder="e.g. HR newsletter" />
          </label>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-lg bg-surface px-3 py-2 text-sm text-ink">{link}</code>
        <button type="button" onClick={copy} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-semibold text-white">{copied ? <><Check className="h-4 w-4" /> Copied</> : <><Copy className="h-4 w-4" /> Copy</>}</button>
      </div>
    </section>
  );
}

export default function WebsiteVisitors({ settings, pages }: { settings: SiteSettings; pages: SitePage[] }) {
  const [period, setPeriod] = useState(30);
  const [test, setTest] = useState(!(settings.domains || []).length);
  const [days, setDays] = useState<(StatsDay & { day: string })[] | null>(null);
  const [enquiries, setEnquiries] = useState<SiteEnquiry[]>([]);
  const [deals, setDeals] = useState<any[]>([]);
  const [data, setData] = useState<SiteData | null>(null);
  const from = isoDay(Date.now() - (period - 1) * DAY);

  useEffect(() => {
    setDays(null);
    return onSnapshot(query(collection(db, test ? STATS_TEST : STATS), where('day', '>=', from)),
      s => setDays(s.docs.map(d => ({ day: d.id, ...(d.data() as any) }))), () => setDays([]));
  }, [test, from]);
  useEffect(() => onSnapshot(query(collection(db, ENQUIRIES), where('at', '>=', from)),
    s => setEnquiries(s.docs.map(d => ({ id: d.id, ...(d.data() as any) }))), () => setEnquiries([])), [from]);
  useEffect(() => onSnapshot(query(collection(db, 'pipelines'), where('source', '==', WEBSITE_SOURCE)),
    s => setDeals(s.docs.map(d => ({ id: d.id, ...(d.data() as any) })).filter(p => !p.deleted)), () => setDeals([])), []);
  useEffect(() => { callServer<{ data: SiteData }>('/api/site/data', {}, true).then(r => setData(r.data)).catch(() => setData(null)); }, []);

  const dayList = useMemo(() => Array.from({ length: period }, (_, i) => isoDay(Date.now() - (period - 1 - i) * DAY)), [period]);
  const total = useMemo(() => sumDays(days || []), [days]);
  const byDay = useMemo(() => dayList.map(d => Number((days || []).find(x => x.day === d)?.visits) || 0), [dayList, days]);
  // Enquiries are real ones only (the test address's own forms count under Test address in the tiles).
  const fromIso = from + 'T00:00:00';
  const periodDeals = deals.filter(p => String(p.requestDate || '') >= from);
  const won = periodDeals.filter(p => dealStage(p) === 'won');
  const funnel = useMemo(() => {
    const rows: Record<string, { visits: number; enquiries: number; deals: number; won: number; rm: number }> = {};
    const row = (k: string) => (rows[k || 'Not known'] ||= { visits: 0, enquiries: 0, deals: 0, won: 0, rm: 0 });
    Object.entries(total.sources).forEach(([k, v]) => { row(k).visits += v; });
    enquiries.filter(e => e.at >= fromIso).forEach(e => { row(e.came?.source || '').enquiries++; });
    periodDeals.forEach(p => { const r = row(p.websiteCame || ''); r.deals++; if (dealStage(p) === 'won') { r.won++; r.rm += dealValue(p); } });
    return Object.entries(rows).sort((a, b) => b[1].rm - a[1].rm || b[1].enquiries - a[1].enquiries || b[1].visits - a[1].visits);
  }, [total, enquiries, periodDeals, fromIso]);

  const chip = (on: boolean) => `min-h-9 rounded-full border px-3.5 text-sm ${on ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink hover:border-ink-soft'}`;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        {[7, 30, 90].map(n => <button key={n} type="button" className={chip(period === n)} onClick={() => setPeriod(n)}>Last {n} days</button>)}
        <span className="mx-1 h-6 w-px bg-line" aria-hidden="true" />
        <button type="button" className={chip(!test)} onClick={() => setTest(false)}>The website</button>
        <button type="button" className={chip(test)} onClick={() => setTest(true)}>Test address</button>
      </div>
      {days === null ? <p className="flex items-center gap-2 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Tile label="Visits" value={total.visits} />
            <Tile label="People" value={total.visitors} note="Roughly: same connection and browser on a day = one" />
            <Tile label="Pages opened" value={total.views} />
            <Tile label="Forms sent" value={(total.forms.enquiry || 0) + (total.forms.register || 0)} note={`${total.forms.register || 0} registrations`} />
            <Tile label="Deals from the website" value={periodDeals.length} note="Made in this period" />
            <Tile label="Won from the website" value={formatRM(won.reduce((t, p) => t + dealValue(p), 0))} note={`${won.length} deal${won.length === 1 ? '' : 's'}`} />
          </div>
          <section className="rounded-xl border border-line bg-white p-4">
            <h3 className="mb-3 font-semibold text-ink">Visits per day</h3>
            <DailyBars days={dayList} values={byDay} />
          </section>
          <div className="grid gap-4 lg:grid-cols-2">
            <RankList title="Where visits came from" rows={total.sources} empty="No visits yet." />
            <RankList title="Pages people opened" rows={total.pages} empty="No visits yet." label={pageKeyLabel} />
            <RankList title="Campaigns (tracked links)" rows={total.campaigns} empty="None yet. Make a tracked link below." />
            <RankList title="Phone or computer" rows={total.devices} empty="No visits yet." label={k => (k === 'phone' ? 'Phone' : 'Computer')} />
          </div>
          <section className="overflow-x-auto rounded-xl border border-line bg-white p-4">
            <h3 className="mb-1 font-semibold text-ink">From visit to money</h3>
            <p className="mb-3 text-sm text-ink-soft">Website enquiries and the deals made from them, by where the visitor came from{test ? ' (visits from the test address; enquiries and deals are the real ones)' : ''}.</p>
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead><tr className="text-ink-soft"><th className="py-1.5 font-semibold">Came from</th><th className="py-1.5 text-right font-semibold">Visits</th><th className="py-1.5 text-right font-semibold">Enquiries</th><th className="py-1.5 text-right font-semibold">Deals</th><th className="py-1.5 text-right font-semibold">Won</th><th className="py-1.5 text-right font-semibold">Won RM</th></tr></thead>
              <tbody>
                {funnel.length === 0 && <tr><td colSpan={6} className="py-3 text-ink-soft">Nothing yet in this period.</td></tr>}
                {funnel.map(([k, r]) => (
                  <tr key={k} className="border-t border-line">
                    <td className="py-1.5">{k}</td><td className="py-1.5 text-right tabular-nums">{r.visits}</td><td className="py-1.5 text-right tabular-nums">{r.enquiries}</td>
                    <td className="py-1.5 text-right tabular-nums">{r.deals}</td><td className="py-1.5 text-right tabular-nums">{r.won}</td><td className="py-1.5 text-right tabular-nums">{r.rm ? formatRM(r.rm) : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <LinkMaker settings={settings} pages={pages} data={data} />
          <p className="text-xs text-ink-soft">Counted by the website itself: no cookies and nothing personal kept. Robots aren't counted. Visits on {todayMY()} keep adding up through the day.</p>
        </>
      )}
    </div>
  );
}
