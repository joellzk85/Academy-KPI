import React, { useEffect, useMemo, useState } from 'react';
import { Check, Copy, ExternalLink, Loader2, MessageCircleQuestion, Search, Users, X } from 'lucide-react';
import { callServer, friendlyError } from '../lib/firebase';
import { TeamMember } from '../types';
import { OUT_CATEGORIES, dateTimeMY } from '../lib/money';
import { DEFAULT_PORTAL_SETTINGS, PORTAL_COLUMNS, PortalLogEntry, PortalRow, PortalSettings, RECEIVER_FIELDS } from '../lib/accountsPortal';
import { usePaged } from '../lib/listPaging';
import ListPager from './ListPager';

// Management → Accounts portal (2026-10-28; lib/accountsPortal.ts): the portal's link, who has Accounts access (Team
// role Accounts), whether accounts may mark payments made there, which columns and receiver details they see, the
// names they see for each category, accounts' open questions (mark them sorted) and the log of everything done there.

const sen = (n: number) => 'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const input = 'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const btnPrimary = 'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';
const card = 'rounded-xl border border-line bg-white p-4 sm:p-5';

type Person = { id: string; name: string; active: boolean };
const LOG_LABELS: Record<PortalLogEntry['action'], string> = { paid: 'Payment made', query: 'Question', slip: 'Bank slip', cleared: 'Question sorted', settings: 'Settings' };

export default function AccountsPortalSettings({ teamMembers }: { teamMembers: TeamMember[] }) {
  const link = `${window.location.origin}/accounts`;
  const [settings, setSettings] = useState<PortalSettings>(DEFAULT_PORTAL_SETTINGS);
  const [saved, setSaved] = useState<PortalSettings>(DEFAULT_PORTAL_SETTINGS);
  const [log, setLog] = useState<PortalLogEntry[]>([]);
  const [rows, setRows] = useState<PortalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);
  const [logSearch, setLogSearch] = useState('');
  const [replies, setReplies] = useState<Record<string, string>>({});

  const load = async () => {
    setError('');
    try {
      const [a, p] = await Promise.all([
        callServer<{ ok: true; settings: PortalSettings; log: PortalLogEntry[]; people: Person[] }>('/api/accounts/admin', {}, true),
        callServer<{ ok: true; rows: PortalRow[] }>('/api/accounts/portal', {}, true),
      ]);
      setSettings(a.settings); setSaved(a.settings); setLog(a.log || []); setRows(p.rows || []);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const people = teamMembers.filter(m => m.role === 'accounts' && m.active);
  const dirty = JSON.stringify(settings) !== JSON.stringify(saved);
  const queries = rows.filter(r => r.query && r.section !== 'paid');
  const toPay = rows.filter(r => r.section === 'topay');
  const categories = useMemo(() => [...new Set([...OUT_CATEGORIES, ...rows.map(r => r.crmCategory)])], [rows]);
  const shownLog = useMemo(() => {
    const q = logSearch.trim().toLowerCase();
    return q ? log.filter(e => `${e.byName} ${e.text} ${LOG_LABELS[e.action]}`.toLowerCase().includes(q)) : log;
  }, [log, logSearch]);
  const pagedLog = usePaged(shownLog, [logSearch]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); window.setTimeout(() => setCopied(false), 2500); }
    catch { window.prompt('Copy the link:', link); }
  };
  const toggleIn = <T,>(list: T[], x: T) => (list.includes(x) ? list.filter(y => y !== x) : [...list, x]);

  const save = async () => {
    setBusy('save'); setError(''); setNotice('');
    try {
      const r = await callServer<{ ok: true; settings: PortalSettings }>('/api/accounts/settings', { settings }, true);
      setSettings(r.settings); setSaved(r.settings); setNotice('Settings saved. Accounts see them on their next refresh.');
      load();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy('');
    }
  };

  const clearQuery = async (r: PortalRow) => {
    setBusy(r.id); setError('');
    try { await callServer('/api/accounts/query-clear', { id: r.id, reply: replies[r.id] || '' }, true); await load(); }
    catch (e) { setError(friendlyError(e)); }
    finally { setBusy(''); }
  };

  if (loading) return <p className="flex items-center gap-2 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading the Accounts portal…</p>;

  return (
    <div className="space-y-4 text-ink">
      <div>
        <h3 className="text-lg font-bold">Accounts portal</h3>
        <p className="text-sm text-ink-soft">Where accounts pay approved payments, instead of a link per summary. You see the same portal, view only.</p>
      </div>
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</p>}
      {notice && <p role="status" className="rounded-lg bg-accent-soft px-3 py-2.5 text-sm font-semibold text-accent">{notice}</p>}

      <section className={card}>
        <h4 className="font-semibold">Portal link</h4>
        <p className="text-sm text-ink-soft">Accounts open it and log in with their name and password. Right now: {toPay.length} payment{toPay.length === 1 ? '' : 's'} to pay ({sen(toPay.reduce((t, r) => t + r.amount, 0))}).</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg border border-line bg-surface px-3 py-2 text-sm">{link}</code>
          <button type="button" className={btnSecondary} onClick={copy}>{copied ? <Check className="h-4 w-4 text-accent" /> : <Copy className="h-4 w-4" />} {copied ? 'Copied' : 'Copy link'}</button>
          <a href={link} className={btnSecondary}><ExternalLink className="h-4 w-4" /> Open</a>
        </div>
      </section>

      <section className={card}>
        <h4 className="flex items-center gap-1.5 font-semibold"><Users className="h-4 w-4 text-accent" /> Who has Accounts access</h4>
        {people.length ? (
          <ul className="mt-2 flex flex-wrap gap-2">{people.map(m => <li key={m.id} className="rounded-full bg-accent-soft px-3 py-1 text-sm font-semibold text-accent">{m.name}</li>)}</ul>
        ) : (
          <p className="mt-1 text-sm font-semibold text-attention">Nobody yet.</p>
        )}
        <p className="mt-2 text-sm text-ink-soft">Add, remove or set a password in Management → Team, with the role <strong>Accounts</strong>. They see only this portal, never the rest of the CRM. Management can open it too, view only.</p>
      </section>

      <section className={`${card} space-y-4`}>
        <h4 className="font-semibold">Settings</h4>
        <label className="flex cursor-pointer items-start gap-3">
          <input type="checkbox" checked={settings.allowPay} onChange={e => setSettings(s => ({ ...s, allowPay: e.target.checked }))} className="mt-1 h-4 w-4 accent-[#0E6E62]" />
          <span><span className="block font-semibold">Accounts can mark payments made in the portal</span>
            <span className="block text-sm text-ink-soft">Untick to make it view only for a while (they can still search and download).</span></span>
        </label>

        <div>
          <p className="text-sm font-semibold">Columns shown <span className="font-normal text-ink-soft">(No. and Amount always show)</span></p>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {PORTAL_COLUMNS.map(c => (
              <label key={c.key} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!settings.hiddenColumns.includes(c.key)} onChange={() => setSettings(s => ({ ...s, hiddenColumns: toggleIn(s.hiddenColumns, c.key) }))} className="h-4 w-4 accent-[#0E6E62]" />{c.label}
              </label>
            ))}
          </div>
        </div>

        <div>
          <p className="text-sm font-semibold">Receiver's details shown <span className="font-normal text-ink-soft">(Name always shows; filled in from Admin work → Vendors)</span></p>
          <div className="mt-1 grid gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
            {RECEIVER_FIELDS.filter(f => f.key !== 'name').map(f => (
              <label key={f.key} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!settings.hiddenFields.includes(f.key)} onChange={() => setSettings(s => ({ ...s, hiddenFields: toggleIn(s.hiddenFields, f.key) }))} className="h-4 w-4 accent-[#0E6E62]" />{f.label}
              </label>
            ))}
          </div>
        </div>

        <div>
          <p className="text-sm font-semibold">Category names accounts see <span className="font-normal text-ink-soft">(blank = same as in the CRM)</span></p>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            {categories.map(c => (
              <label key={c} className="flex items-center gap-2 text-sm">
                <span className="w-32 shrink-0 text-ink-soft">{c}</span>
                <input value={settings.categoryNames[c] || ''} onChange={e => setSettings(s => ({ ...s, categoryNames: { ...s.categoryNames, [c]: e.target.value } }))} className={`${input} py-1.5`} placeholder={c} maxLength={60} />
              </label>
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <button type="button" className={btnPrimary} onClick={save} disabled={!dirty || busy === 'save'}>{busy === 'save' && <Loader2 className="h-4 w-4 animate-spin" />} Save settings</button>
          {dirty && <button type="button" className={btnSecondary} onClick={() => setSettings(saved)}>Undo changes</button>}
        </div>
      </section>

      <section className={card}>
        <h4 className="flex items-center gap-1.5 font-semibold"><MessageCircleQuestion className="h-4 w-4 text-attention" /> Accounts' open questions ({queries.length})</h4>
        {queries.length === 0 ? <p className="mt-1 text-sm text-ink-soft">None.</p> : (
          <ul className="mt-2 divide-y divide-line">
            {queries.map(r => (
              <li key={r.id} className="space-y-2 py-3">
                <p className="text-sm"><span className="font-semibold">{r.receiver.name}</span> · {sen(r.amount)} · {r.category} · <span className="font-mono text-xs">{r.ref}</span></p>
                <p className="rounded bg-attention-soft px-2 py-1.5 text-sm text-attention">{r.query!.byName}, {dateTimeMY(r.query!.at)}: {r.query!.text}</p>
                <div className="flex flex-wrap gap-2">
                  <input value={replies[r.id] || ''} onChange={e => setReplies(x => ({ ...x, [r.id]: e.target.value }))} className={`${input} min-w-[14rem] flex-1 py-1.5`} placeholder="What was done (optional), e.g. bank details corrected" maxLength={500} />
                  <button type="button" className={btnSecondary} onClick={() => clearQuery(r)} disabled={busy === r.id}>{busy === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Sorted</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="overflow-hidden rounded-xl border border-line bg-white">
        <div className="space-y-2 p-4 sm:p-5">
          <h4 className="font-semibold">Activity log</h4>
          <p className="text-sm text-ink-soft">Everything done in the portal: payments made, questions, bank slips, settings (latest 300).</p>
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
            <input value={logSearch} onChange={e => setLogSearch(e.target.value)} className={`${input} pl-9`} placeholder="Search who, receiver, amount, reference" aria-label="Search the log" />
            {logSearch && <button type="button" onClick={() => setLogSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-soft hover:bg-surface" aria-label="Clear search"><X className="h-4 w-4" /></button>}
          </label>
        </div>
        {shownLog.length === 0 ? <p className="px-5 pb-5 text-sm text-ink-soft">{log.length ? 'Nothing matches.' : 'Nothing done in the portal yet.'}</p> : (
          <>
            <ul className="divide-y divide-line border-t border-line">
              {pagedLog.pageItems.map(e => (
                <li key={e.id} className="px-4 py-2.5 text-sm sm:px-5">
                  <p><span className="font-semibold">{LOG_LABELS[e.action]}</span> · {e.byName} · <span className="text-ink-soft">{dateTimeMY(e.at)}</span></p>
                  <p className="text-ink-soft">{e.text}</p>
                </li>
              ))}
            </ul>
            <ListPager paged={pagedLog} noun="entries" />
          </>
        )}
      </section>
    </div>
  );
}
