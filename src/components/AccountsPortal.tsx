import React, { useEffect, useMemo, useRef, useState } from 'react';
import { signOut } from 'firebase/auth';
import { AlertTriangle, ArrowLeft, Check, CheckCircle2, Clock, Download, FileSpreadsheet, KeyRound, Loader2, LogOut, MessageCircleQuestion, Paperclip, RefreshCw, Search, X } from 'lucide-react';
import { auth, callServer, friendlyError } from '../lib/firebase';
import { TeamMember } from '../types';
import { formatDate } from '../lib/deals';
import { dateTimeMY } from '../lib/money';
import { DEFAULT_PORTAL_SETTINGS, PortalRow, PortalSection, PortalSettings, RECEIVER_FIELDS, bankLines, monthLabel, rowMatches, rowMonth, rowsTotal } from '../lib/accountsPortal';
import { usePaged } from '../lib/listPaging';
import ListPager, { listSelect } from './ListPager';
import { ChangePasswordForm } from './LoginScreen';
import AccountsSheetDocument, { sheetExcel } from './AccountsSheet';
import { blobToBase64, downloadBlob, makeDocumentPdf } from '../lib/quotePdf';
import { CHECKLIST_FILE_ACCEPT, CHECKLIST_FILE_KINDS } from '../lib/checklistFiles';
import logoUrl from '../assets/outline/next-logo.png';

// The Accounts portal (/accounts, 2026-10-28; lib/accountsPortal.ts, serverAccountsPortal.ts). Accounts staff see
// every approved payment that can be paid today, laid out like Joel's payment request sheet, tick lines, type the bank
// reference, add the bank slip and click Payment made; or send a line back with a question. Coming up and Paid
// (history) have search, month and category filters, and every list downloads as a PDF or Excel file.
// Management opens the same page (from Management → Accounts portal), view only.

type Viewer = { name: string; role: 'accounts' | 'management'; canPay: boolean };
type PortalData = { viewer: Viewer; settings: PortalSettings; rows: PortalRow[] };
type SortKey = 'event' | 'newest' | 'oldest' | 'az' | 'amount';

const SECTIONS: { key: PortalSection; label: string; hint: string }[] = [
  { key: 'topay', label: 'To pay', hint: 'Approved by a manager and payable today, with checked bank details.' },
  { key: 'coming', label: 'Coming up', hint: "Not payable yet: waiting for approval, a due date, the training to finish, or bank details. Don't pay these." },
  { key: 'paid', label: 'Paid', hint: 'Every payment made, with who marked it, when and the bank reference.' },
];
const SORTS: [SortKey, string][] = [['event', 'Date of event, soonest'], ['newest', 'Newest first'], ['oldest', 'Oldest first'], ['az', 'Receiver A to Z'], ['amount', 'Amount, highest']];

const sen = (n: number) => 'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const input = 'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const btnPrimary = 'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';

const whenOf = (r: PortalRow) => (r.section === 'paid' ? r.paidAt || r.paidDate : r.approvedAt || r.raisedAt);
function sortRows(rows: PortalRow[], by: SortKey): PortalRow[] {
  const name = (r: PortalRow) => r.receiver.name.toLowerCase();
  return [...rows].sort((a, b) => {
    if (by === 'az') return name(a).localeCompare(name(b)) || a.ref.localeCompare(b.ref);
    if (by === 'amount') return b.amount - a.amount;
    if (by === 'event') return (a.eventDate || '9999').localeCompare(b.eventDate || '9999') || name(a).localeCompare(name(b));
    const d = whenOf(a).localeCompare(whenOf(b));
    return by === 'newest' ? -d : d;
  });
}

/** Read a picked file as base64 for the server (bank slips up to 10 MB). */
const fileToBase64 = (f: File) => blobToBase64(f);

export default function AccountsPortal({ member }: { member: TeamMember }) {
  const [data, setData] = useState<PortalData | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(false);
  const [section, setSection] = useState<PortalSection>('topay');
  const [search, setSearch] = useState('');
  const [month, setMonth] = useState('');
  const [category, setCategory] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('event');
  const [ticked, setTicked] = useState<string[]>([]);
  const [payRef, setPayRef] = useState('');
  const [slip, setSlip] = useState<File | null>(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [asking, setAsking] = useState<PortalRow | null>(null);
  const [slipFor, setSlipFor] = useState<PortalRow | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);

  const load = async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const d = await callServer<PortalData & { ok: true }>('/api/accounts/portal', {}, true);
      setData({ viewer: d.viewer, settings: d.settings || DEFAULT_PORTAL_SETTINGS, rows: d.rows || [] });
      setLoadError('');
    } catch (e) {
      setLoadError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);
  // New approvals appear without a reload.
  useEffect(() => { const t = window.setInterval(() => load(true), 60_000); return () => window.clearInterval(t); }, []);
  useEffect(() => { document.title = 'Accounts portal · NEXT Academy'; }, []);

  const rows = data?.rows || [];
  const settings = data?.settings || DEFAULT_PORTAL_SETTINGS;
  const viewer = data?.viewer;
  const canPay = !!viewer?.canPay;
  const isAccounts = member.role === 'accounts';

  // Drop ticks on lines that left "To pay" (paid elsewhere, unapproved, ...).
  useEffect(() => { setTicked(t => t.filter(id => rows.some(r => r.id === id && r.section === 'topay'))); }, [rows]);
  // Paid opens newest first; the others by the date of the event.
  useEffect(() => { setMonth(''); setCategory(''); setSortBy(section === 'paid' ? 'newest' : 'event'); }, [section]);

  const inSection = useMemo(() => rows.filter(r => r.section === section), [rows, section]);
  const months = useMemo(() => [...new Set(inSection.map(rowMonth).filter(Boolean))].sort().reverse(), [inSection]);
  const categories = useMemo(() => [...new Set(inSection.map(r => r.category))].sort(), [inSection]);
  const shown = useMemo(() => sortRows(inSection.filter(r => (!month || rowMonth(r) === month) && (!category || r.category === category) && rowMatches(r, search)), sortBy),
    [inSection, month, category, search, sortBy]);
  const paged = usePaged(shown, [section, month, category, search, sortBy]);

  const count = (s: PortalSection) => rows.filter(r => r.section === s).length;
  const thisMonth = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 7);
  const paidThisMonth = rows.filter(r => r.section === 'paid' && rowMonth(r) === thisMonth);
  const openQueries = rows.filter(r => r.query && r.section !== 'paid');
  const tickedRows = rows.filter(r => ticked.includes(r.id));

  const flash = (tone: 'ok' | 'error', text: string) => { setNotice({ tone, text }); window.setTimeout(() => setNotice(n => (n?.text === text ? null : n)), 8000); };
  const toggle = (id: string) => setTicked(t => (t.includes(id) ? t.filter(x => x !== id) : [...t, id]));
  const allTicked = shown.length > 0 && shown.every(r => ticked.includes(r.id));

  const sendSlip = async (ids: string[], f: File) => {
    await callServer('/api/accounts/slip', { ids, name: f.name, data: await fileToBase64(f) }, true);
  };

  const markPaid = async () => {
    if (!tickedRows.length) return;
    const changed = tickedRows.filter(r => r.bankChangedAt);
    const total = rowsTotal(tickedRows);
    const lines = tickedRows.map(r => `• ${r.receiver.name}: ${sen(r.amount)}${r.accountNo ? ` to ${r.bankName} ${r.accountNo}` : ''}`).join('\n');
    const warn = changed.length ? `\n\nCAREFUL: the bank details of ${changed.map(r => r.receiver.name).join(', ')} changed since the last payment. Check the account before paying.` : '';
    if (!window.confirm(`Confirm you have paid these ${tickedRows.length} payment${tickedRows.length === 1 ? '' : 's'} (${sen(total)})?\n\n${lines}${warn}`)) return;
    setBusy('pay');
    try {
      const res = await callServer<{ ok: true; paid: string[]; skipped: number }>('/api/accounts/paid', { ids: tickedRows.map(r => r.id), ref: payRef }, true);
      let slipNote = '';
      if (slip && res.paid.length) {
        try { await sendSlip(res.paid, slip); slipNote = ' Bank slip added.'; }
        catch (e) { slipNote = ` The bank slip didn't upload (${friendlyError(e)}): add it from the Paid list.`; }
      }
      setTicked([]); setPayRef(''); setSlip(null);
      flash(res.skipped ? 'error' : 'ok', `${res.paid.length} payment${res.paid.length === 1 ? '' : 's'} marked paid.${res.skipped ? ` ${res.skipped} changed a moment ago and were left alone.` : ''}${slipNote}`);
      await load(true);
    } catch (e) {
      flash('error', friendlyError(e));
      await load(true);
    } finally {
      setBusy('');
    }
  };

  const download = async (kind: 'pdf' | 'xlsx') => {
    if (!shown.length) return;
    const sec = SECTIONS.find(s => s.key === section)!;
    const title = `${month ? monthLabel(month) : 'All months'} · ${sec.label}${category ? ` · ${category}` : ''}`;
    const file = `NEXT Academy payment request ${month ? monthLabel(month) : sec.label}`.replace(/[^\w .-]/g, '');
    setBusy(kind);
    try {
      if (kind === 'xlsx') downloadBlob(await sheetExcel(shown, settings, title), `${file}.xlsx`);
      else {
        const subtitle = `${shown.length} payment${shown.length === 1 ? '' : 's'} · ${sen(rowsTotal(shown))} · printed ${dateTimeMY(new Date().toISOString())}`;
        downloadBlob(await makeDocumentPdf(<AccountsSheetDocument rows={shown} settings={settings} title={title} subtitle={subtitle} />, `Payment request ${title}`), `${file}.pdf`);
      }
    } catch (e) {
      flash('error', friendlyError(e));
    } finally {
      setBusy('');
    }
  };

  const fields = RECEIVER_FIELDS.filter(f => f.key !== 'name' && !settings.hiddenFields.includes(f.key));
  const col = (k: string) => !settings.hiddenColumns.includes(k as any);

  return (
    <div className="min-h-screen bg-[#f3f5f4] font-sans text-ink">
      <header className="sticky top-0 z-20 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
          <img src={logoUrl} alt="NEXT Academy" className="h-8 w-auto" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold">Accounts portal</p>
            <p className="truncate text-sm text-ink-soft">{member.name}{!isAccounts && ' · view only (Accounts mark payments made)'}</p>
          </div>
          <button type="button" className={btnSecondary} onClick={() => load()} disabled={loading} aria-label="Refresh">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}<span className="hidden sm:inline">Refresh</span>
          </button>
          {isAccounts ? (
            <>
              <button type="button" className={btnSecondary} onClick={() => setShowPassword(true)}><KeyRound className="h-4 w-4" /><span className="hidden sm:inline">Change password</span></button>
              <button type="button" className={btnSecondary} onClick={() => signOut(auth)}><LogOut className="h-4 w-4" /><span className="hidden sm:inline">Log out</span></button>
            </>
          ) : (
            <a href="/" className={btnSecondary}><ArrowLeft className="h-4 w-4" /> Back to the CRM</a>
          )}
        </div>
      </header>

      <main ref={topRef} className="mx-auto max-w-7xl space-y-4 px-4 py-5 pb-40">
        {loadError && <p role="alert" className="rounded-xl border border-line bg-white px-4 py-4 text-[15px] text-danger">{loadError}</p>}
        {!data && !loadError && <p className="flex items-center gap-2 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading payments…</p>}
        {notice && (
          <p role="status" className={`rounded-lg px-3 py-2.5 text-sm font-semibold ${notice.tone === 'ok' ? 'bg-accent-soft text-accent' : 'bg-danger-soft text-danger'}`}>{notice.text}</p>
        )}
        {data && isAccounts && !canPay && (
          <p className="rounded-lg bg-attention-soft px-3 py-2.5 text-sm font-semibold text-attention">Marking payments made here is switched off by Management for now. You can still see, search and download.</p>
        )}

        {data && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Tile label="To pay now" value={sen(rowsTotal(rows.filter(r => r.section === 'topay')))} sub={`${count('topay')} payment${count('topay') === 1 ? '' : 's'}`} tone="accent" />
              <Tile label="Coming up" value={sen(rowsTotal(rows.filter(r => r.section === 'coming')))} sub={`${count('coming')} not payable yet`} />
              <Tile label="Paid this month" value={sen(rowsTotal(paidThisMonth))} sub={`${paidThisMonth.length} payment${paidThisMonth.length === 1 ? '' : 's'} in ${monthLabel(thisMonth)}`} />
              <Tile label="Questions open" value={String(openQueries.length)} sub={openQueries.length ? 'Waiting for Admin or Management' : 'None'} tone={openQueries.length ? 'attention' : undefined} />
            </div>

            <div className="flex flex-wrap gap-1 border-b border-line" role="tablist">
              {SECTIONS.map(s => (
                <button key={s.key} type="button" role="tab" aria-selected={section === s.key} onClick={() => setSection(s.key)}
                  className={`-mb-px border-b-2 px-4 py-2 text-[15px] font-semibold ${section === s.key ? 'border-accent text-accent' : 'border-transparent text-ink-soft hover:text-ink'}`}>
                  {s.label} <span className="font-normal">({count(s.key)})</span>
                </button>
              ))}
            </div>
            <p className="text-sm text-ink-soft">{SECTIONS.find(s => s.key === section)!.hint}</p>

            <div className="flex flex-wrap items-center gap-2">
              <label className="relative min-w-[14rem] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
                <input value={search} onChange={e => setSearch(e.target.value)} className={`${input} pl-9`} placeholder="Search receiver, amount, reference, bank, programme" aria-label="Search payments" />
                {search && <button type="button" onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-soft hover:bg-surface" aria-label="Clear search"><X className="h-4 w-4" /></button>}
              </label>
              <select value={month} onChange={e => setMonth(e.target.value)} className={listSelect} aria-label="Month">
                <option value="">All months</option>
                {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
              </select>
              <select value={category} onChange={e => setCategory(e.target.value)} className={listSelect} aria-label="Category">
                <option value="">All categories</option>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={sortBy} onChange={e => setSortBy(e.target.value as SortKey)} className={listSelect} aria-label="Sort">
                {SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <button type="button" className={btnSecondary} disabled={!shown.length || !!busy} onClick={() => download('pdf')}>
                {busy === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} PDF
              </button>
              <button type="button" className={btnSecondary} disabled={!shown.length || !!busy} onClick={() => download('xlsx')}>
                {busy === 'xlsx' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />} Excel
              </button>
            </div>

            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span className="text-ink-soft">{shown.length} payment{shown.length === 1 ? '' : 's'}{month ? ` in ${monthLabel(month)}` : ''}</span>
              <span className="font-semibold">Total {sen(rowsTotal(shown))}</span>
            </div>

            {shown.length === 0 ? (
              <p className="rounded-xl border border-line bg-white px-4 py-6 text-center text-[15px] text-ink-soft">
                {inSection.length ? 'No payments match.' : section === 'topay' ? 'Nothing to pay right now.' : section === 'coming' ? 'Nothing coming up.' : 'No payments made yet.'}
              </p>
            ) : (
              <div className="overflow-hidden rounded-xl border border-line bg-white">
                {/* Wide screens: the sheet's columns. */}
                <div className="hidden overflow-x-auto lg:block">
                  <table className="w-full text-sm">
                    <thead className="bg-surface text-left text-ink-soft">
                      <tr>
                        {section === 'topay' && canPay && (
                          <th className="w-10 px-3 py-2"><input type="checkbox" checked={allTicked} onChange={() => setTicked(allTicked ? [] : shown.map(r => r.id))} aria-label="Tick all shown" className="h-4 w-4 accent-[#0E6E62]" /></th>
                        )}
                        <th className="px-3 py-2 font-semibold">No.</th>
                        {col('category') && <th className="px-3 py-2 font-semibold">Category</th>}
                        {col('receiver') && <th className="px-3 py-2 font-semibold">Receiver</th>}
                        <th className="px-3 py-2 text-right font-semibold">Amount (RM)</th>
                        {col('bank') && <th className="px-3 py-2 font-semibold">Bank info</th>}
                        {col('details') && <th className="px-3 py-2 font-semibold">Details</th>}
                        {col('eventDate') && <th className="px-3 py-2 font-semibold">Date of event</th>}
                        {col('remarks') && <th className="px-3 py-2 font-semibold">Remarks</th>}
                        {!col('remarks') && isAccounts && <th className="px-3 py-2" />}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {paged.pageItems.map((r, i) => (
                        <tr key={r.id} className={`align-top ${ticked.includes(r.id) ? 'bg-accent-soft/50' : ''}`}>
                          {section === 'topay' && canPay && (
                            <td className="px-3 py-3"><input type="checkbox" checked={ticked.includes(r.id)} onChange={() => toggle(r.id)} aria-label={`Tick ${r.receiver.name} ${sen(r.amount)}`} className="h-4 w-4 accent-[#0E6E62]" /></td>
                          )}
                          <td className="px-3 py-3 text-ink-soft">{(paged.page - 1) * paged.pageSize + i + 1}</td>
                          {col('category') && <td className="px-3 py-3">{r.category}</td>}
                          {col('receiver') && <td className="min-w-[18rem] px-3 py-3"><ReceiverBlock r={r} fields={fields} /></td>}
                          <td className="whitespace-nowrap px-3 py-3 text-right font-semibold">{sen(r.amount).replace('RM ', '')}</td>
                          {col('bank') && <td className="min-w-[10rem] px-3 py-3"><BankBlock r={r} /></td>}
                          {col('details') && <td className="min-w-[10rem] px-3 py-3">{r.details}<span className="block font-mono text-xs text-ink-soft">{r.ref}</span></td>}
                          {col('eventDate') && <td className="whitespace-nowrap px-3 py-3">{r.eventDate ? formatDate(r.eventDate) : '—'}</td>}
                          {col('remarks') && <td className="min-w-[12rem] px-3 py-3"><Remarks r={r} /><div className="mt-2"><RowActions r={r} isAccounts={isAccounts} onAsk={() => setAsking(r)} onSlip={() => setSlipFor(r)} /></div></td>}
                          {!col('remarks') && isAccounts && <td className="px-3 py-3"><RowActions r={r} isAccounts={isAccounts} onAsk={() => setAsking(r)} onSlip={() => setSlipFor(r)} /></td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Phones and tablets: one card per payment. */}
                <ul className="divide-y divide-line lg:hidden">
                  {paged.pageItems.map((r, i) => (
                    <li key={r.id} className={`space-y-2 px-4 py-3 ${ticked.includes(r.id) ? 'bg-accent-soft/50' : ''}`}>
                      <div className="flex items-start gap-3">
                        {section === 'topay' && canPay && (
                          <input type="checkbox" checked={ticked.includes(r.id)} onChange={() => toggle(r.id)} aria-label={`Tick ${r.receiver.name} ${sen(r.amount)}`} className="mt-1 h-5 w-5 shrink-0 accent-[#0E6E62]" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-baseline justify-between gap-2">
                            <span className="font-semibold">{(paged.page - 1) * paged.pageSize + i + 1}. {r.receiver.name}</span>
                            <span className="font-semibold">{sen(r.amount)}</span>
                          </p>
                          <p className="text-sm text-ink-soft">{[col('category') ? r.category : '', col('eventDate') && r.eventDate ? formatDate(r.eventDate) : ''].filter(Boolean).join(' · ')}</p>
                        </div>
                      </div>
                      {col('bank') && <BankBlock r={r} />}
                      {col('details') && <p className="text-sm">{r.details} <span className="font-mono text-xs text-ink-soft">{r.ref}</span></p>}
                      {col('remarks') && <Remarks r={r} />}
                      {col('receiver') && fields.length > 0 && (
                        <details className="text-sm"><summary className="cursor-pointer font-semibold text-accent">Receiver's details</summary><ReceiverBlock r={r} fields={fields} hideName /></details>
                      )}
                      <RowActions r={r} isAccounts={isAccounts} onAsk={() => setAsking(r)} onSlip={() => setSlipFor(r)} />
                    </li>
                  ))}
                </ul>
                <ListPager paged={paged} noun="payments" top={topRef} />
              </div>
            )}
          </>
        )}
      </main>

      {/* The pay bar: ticked lines, one bank reference, the bank slip, Payment made. */}
      {canPay && section === 'topay' && tickedRows.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
          <div className="mx-auto flex max-w-7xl flex-wrap items-end gap-3 px-4 py-3">
            <div className="min-w-[10rem]">
              <p className="text-sm text-ink-soft">{tickedRows.length} ticked</p>
              <p className="text-lg font-bold">{sen(rowsTotal(tickedRows))}</p>
            </div>
            <label className="min-w-[12rem] flex-1">
              <span className="mb-1 block text-sm font-medium text-ink-soft">Bank reference (optional)</span>
              <input value={payRef} onChange={e => setPayRef(e.target.value)} className={input} placeholder="e.g. M2U 1234567890" maxLength={80} />
            </label>
            <label className="min-w-[12rem] flex-1">
              <span className="mb-1 block text-sm font-medium text-ink-soft">Bank slip (optional)</span>
              <input type="file" accept={CHECKLIST_FILE_ACCEPT} onChange={e => setSlip(e.target.files?.[0] || null)} className="block w-full text-sm file:mr-2 file:rounded-md file:border file:border-line file:bg-white file:px-2 file:py-1.5 file:text-sm file:font-semibold" />
            </label>
            <div className="flex gap-2">
              <button type="button" className={btnSecondary} onClick={() => setTicked([])}>Untick</button>
              <button type="button" className={btnPrimary} onClick={markPaid} disabled={busy === 'pay'}>
                {busy === 'pay' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Payment made
              </button>
            </div>
          </div>
        </div>
      )}

      {asking && <AskDialog row={asking} onClose={() => setAsking(null)} onSent={async () => { setAsking(null); flash('ok', 'Question sent to Admin and Management.'); await load(true); }} />}
      {slipFor && <SlipDialog row={slipFor} send={sendSlip} onClose={() => setSlipFor(null)} onSent={async () => { setSlipFor(null); flash('ok', 'Bank slip added.'); await load(true); }} />}
      {showPassword && (
        <Modal onClose={() => setShowPassword(false)} title="Change my password">
          <ChangePasswordForm member={member} onDone={() => { setShowPassword(false); flash('ok', 'Password changed.'); }} onCancel={() => setShowPassword(false)} />
        </Modal>
      )}
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'accent' | 'attention' }) {
  return (
    <div className="rounded-xl border border-line bg-white px-4 py-3">
      <p className="text-sm text-ink-soft">{label}</p>
      <p className={`text-lg font-bold ${tone === 'accent' ? 'text-accent' : tone === 'attention' ? 'text-attention' : ''}`}>{value}</p>
      <p className="text-xs text-ink-soft">{sub}</p>
    </div>
  );
}

function ReceiverBlock({ r, fields, hideName }: { r: PortalRow; fields: { key: keyof PortalRow['receiver']; label: string }[]; hideName?: boolean }) {
  return (
    <div className="text-sm">
      {!hideName && <p className="font-semibold">{r.receiver.name}</p>}
      <dl className="mt-0.5 grid grid-cols-[max-content_1fr] gap-x-2 text-xs">
        {fields.map(f => (
          <React.Fragment key={f.key}><dt className="whitespace-nowrap text-ink-soft">{f.label}</dt><dd className={r.receiver[f.key] ? '' : 'text-ink-soft'}>{r.receiver[f.key] || '-'}</dd></React.Fragment>
        ))}
      </dl>
    </div>
  );
}

function BankBlock({ r }: { r: PortalRow }) {
  const lines = bankLines(r);
  return (
    <div className="text-sm">
      {lines.length ? lines.map((x, i) => <p key={i} className={i === 1 && r.accountNo ? 'font-mono font-semibold tracking-wide' : ''}>{x}</p>)
        : <p className="font-semibold text-attention">{/check/i.test(r.waitReason) ? 'Hidden until a manager checks them' : 'No bank details yet'}</p>}
      {r.bankChangedAt && (
        <p className="mt-1 flex items-start gap-1 rounded bg-danger-soft px-1.5 py-1 text-xs font-semibold text-danger">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Bank details changed {formatDate(r.bankChangedAt.slice(0, 10))}, since the last payment. Check before paying.
        </p>
      )}
    </div>
  );
}

function Remarks({ r }: { r: PortalRow }) {
  return (
    <div className="space-y-1 text-sm">
      {r.remarks && <p className="text-ink-soft">{r.remarks}</p>}
      {r.section === 'coming' && <p className="flex items-start gap-1 font-semibold text-attention"><Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {r.waitReason}</p>}
      {r.section !== 'paid' && r.approvedByName && <p className="text-xs text-ink-soft">Approved by {r.approvedByName}, {dateTimeMY(r.approvedAt)}</p>}
      {r.section === 'paid' && (
        <p className="flex items-start gap-1 text-accent"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Paid {r.paidAt ? dateTimeMY(r.paidAt) : formatDate(r.paidDate)} by {r.paidByName || '—'}{r.paidRef ? ` · ref ${r.paidRef}` : ''}
            <span className="block text-xs text-ink-soft">{r.slips ? `${r.slips} bank slip${r.slips === 1 ? '' : 's'} or receipt${r.slips === 1 ? '' : 's'}` : 'No bank slip yet'}</span></span>
        </p>
      )}
      {r.query && (
        <p className="rounded bg-attention-soft px-1.5 py-1 text-xs text-attention"><span className="font-semibold">Question sent {dateTimeMY(r.query.at)}:</span> {r.query.text}</p>
      )}
    </div>
  );
}

function RowActions({ r, isAccounts, onAsk, onSlip }: { r: PortalRow; isAccounts: boolean; onAsk: () => void; onSlip: () => void }) {
  if (!isAccounts) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {r.section !== 'paid' && !r.query && (
        <button type="button" className={`${btnSecondary} px-2 py-1 text-xs`} onClick={onAsk}><MessageCircleQuestion className="h-3.5 w-3.5" /> Ask a question</button>
      )}
      {r.section === 'paid' && (
        <button type="button" className={`${btnSecondary} px-2 py-1 text-xs`} onClick={onSlip}><Paperclip className="h-3.5 w-3.5" /> Add bank slip</button>
      )}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-ink-soft hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function AskDialog({ row, onClose, onSent }: { row: PortalRow; onClose: () => void; onSent: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const send = async () => {
    setBusy(true); setError('');
    try { await callServer('/api/accounts/query', { id: row.id, text }, true); onSent(); }
    catch (e) { setError(friendlyError(e)); setBusy(false); }
  };
  return (
    <Modal title="Ask a question" onClose={onClose}>
      <p className="text-sm text-ink-soft">{row.receiver.name} · {sen(row.amount)} · {row.ref}. Admin and Management see your question on this payment.</p>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={4} maxLength={500} className={`${input} mt-3`} placeholder="e.g. The account name doesn't match the receiver. Please check." autoFocus />
      {error && <p role="alert" className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>Cancel</button>
        <button type="button" className={btnPrimary} onClick={send} disabled={busy || !text.trim()}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Send question</button>
      </div>
    </Modal>
  );
}

function SlipDialog({ row, send, onClose, onSent }: { row: PortalRow; send: (ids: string[], f: File) => Promise<void>; onClose: () => void; onSent: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    if (!file) return;
    setBusy(true); setError('');
    try { await send([row.id], file); onSent(); }
    catch (e) { setError(friendlyError(e)); setBusy(false); }
  };
  return (
    <Modal title="Add bank slip" onClose={onClose}>
      <p className="text-sm text-ink-soft">{row.receiver.name} · {sen(row.amount)} · paid {row.paidAt ? dateTimeMY(row.paidAt) : formatDate(row.paidDate)}</p>
      <input type="file" accept={CHECKLIST_FILE_ACCEPT} onChange={e => setFile(e.target.files?.[0] || null)} className="mt-3 block w-full text-sm" />
      <p className="mt-1 text-xs text-ink-soft">{CHECKLIST_FILE_KINDS}, up to 10 MB.</p>
      {error && <p role="alert" className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>Cancel</button>
        <button type="button" className={btnPrimary} onClick={go} disabled={busy || !file}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Add slip</button>
      </div>
    </Modal>
  );
}
