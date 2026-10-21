import React, { useMemo, useState } from 'react';
import { Check, Copy, Download, FileText, Link2, Loader2 } from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { callServer, db, friendlyError } from '../lib/firebase';
import { pdfErrorText } from '../lib/oldTab';
import { formatDate, todayIso } from '../lib/deals';
import { MoneyOut, TIMING_LABELS, isCompanyPayment } from '../lib/money';
import { buildSummary, summaryProblem, summaryRef } from '../lib/paymentSummary';
import { Vendor, hasBank } from '../lib/vendors';
import { useVendors } from './VendorsPage';
import PaymentSummaryDocument from './PaymentSummaryDocument';

// Admin work → Money → "Payment summary for accounts" (Joel, 2026-10-20). The approved payments not paid yet, with
// Pre-training / Post-training (and Company payments) tick boxes; tick the lines, then make the summary and send it to
// accounts as a PDF or a link (lib/paymentSummary.ts). Accounts click "Payment made" per vendor on the link.
// Since 2026-10-21 this is the only way payments go to accounts: each payment can be on one summary only (until it's
// taken off or the summary is cancelled), post-training ones only from the day after the training, and payments
// paid from a PDF are marked paid here.

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };

const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';
const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const small = 'mb-1 block text-sm font-medium text-ink-soft';
const sen = (n: number) => 'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ORDER = { before: 0, after: 1, company: 2 };

export default function PaymentSummaryPanel({ outs, viewer, forTextOf, dealOf }: {
  outs: MoneyOut[]; viewer: Viewer; forTextOf: (o: MoneyOut) => string; dealOf: (o: MoneyOut) => any;
}) {
  const vendors = useVendors(true);
  const [show, setShow] = useState({ before: true, after: true, company: true });
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [made, setMade] = useState<{ ids: string[]; at: string; token?: string } | null>(null);
  const today = todayIso();

  const approved = outs.filter(o => o.status === 'approved');
  const kindOf = (o: MoneyOut): 'before' | 'after' | 'company' => (isCompanyPayment(o) ? 'company' : o.timing === 'before' ? 'before' : 'after');
  // Can go on a new summary first, then the ones already on a summary, then post-training ones still waiting.
  const problemOf = (o: MoneyOut) => summaryProblem(o, dealOf(o), today);
  const rank = (o: MoneyOut) => (!problemOf(o) ? 0 : o.summaryToken ? 1 : 2);
  const list = approved.filter(o => show[kindOf(o)])
    .sort((a, b) => rank(a) - rank(b) || ORDER[kindOf(a)] - ORDER[kindOf(b)] || String(a.payee).localeCompare(String(b.payee)));
  const free = list.filter(o => !problemOf(o));
  const tickedList = approved.filter(o => ticked.has(o.id) && !problemOf(o));
  const total = tickedList.reduce((t, o) => t + (Number(o.amount) || 0), 0);
  const allShown = free.length > 0 && free.every(o => ticked.has(o.id));
  const toggle = (id: string) => setTicked(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const count = (k: 'before' | 'after' | 'company') => approved.filter(o => kindOf(o) === k).length;

  // Once saved, only the payments still on this summary (one taken off drops out of it, PDF included).
  const madeOuts = made ? outs.filter(o => made.ids.includes(o.id) && (!made.token || o.summaryToken === made.token)) : [];
  const summary = useMemo(() => buildSummary(madeOuts, vendors, forTextOf), [madeOuts.map(o => `${o.id}:${o.status}`).join(','), vendors]);

  return (
    <section className="space-y-3 rounded-2xl border border-line bg-white p-4">
      <div>
        <h4 className="font-bold">Payment summary for accounts</h4>
        <p className="text-sm text-ink-soft">Approved payments not paid yet. Tick the ones to pay, make a summary, and send it to accounts as a PDF or a link. Each payment can be on one summary only. Post-training payments can be added from the day after the training.</p>
      </div>
      <div className="flex flex-wrap gap-3 text-[15px]">
        {([['before', 'Pre-training payments'], ['after', 'Post-training payments'], ['company', 'Company payments']] as const).map(([k, l]) => (
          <label key={k} className="flex items-center gap-2">
            <input type="checkbox" checked={show[k]} onChange={e => setShow(s => ({ ...s, [k]: e.target.checked }))} className="h-4 w-4 accent-[#0E6E62]" />
            {l} <span className="text-ink-soft">({count(k)})</span>
          </label>
        ))}
      </div>

      {list.length === 0 ? (
        <p className="text-[15px] text-ink-soft">{approved.length ? 'Nothing approved under these ticks.' : 'No approved payments waiting to be paid.'}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[44rem] text-[15px]">
            <thead>
              <tr className="border-b border-line bg-surface text-left text-sm text-ink-soft">
                <th className="w-10 px-3 py-2"><input type="checkbox" checked={allShown} disabled={!free.length} aria-label="Tick every payment that can go on a summary" className="h-4 w-4 accent-[#0E6E62]"
                  onChange={() => setTicked(s => { const n = new Set(s); free.forEach(o => (allShown ? n.delete(o.id) : n.add(o.id))); return n; })} /></th>
                <th className="px-3 py-2 font-semibold">Pay to</th>
                <th className="px-3 py-2 font-semibold">For</th>
                <th className="px-3 py-2 font-semibold">When</th>
                <th className="px-3 py-2 text-right font-semibold">Amount</th>
                <th className="px-3 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.map(o => <SummaryRow key={o.id} o={o} viewer={viewer} vendors={vendors} forText={forTextOf(o)} problem={problemOf(o)} ticked={ticked.has(o.id)} onToggle={() => toggle(o.id)} />)}
            </tbody>
          </table>
        </div>
      )}

      {tickedList.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[15px]"><strong>{tickedList.length}</strong> ticked · <strong className="tabular-nums">{sen(total)}</strong></p>
          <button type="button" className={`${btnPrimary} ml-auto`} onClick={() => { setMade({ ids: tickedList.map(o => o.id), at: new Date().toISOString() }); setTicked(new Set()); }}>
            <FileText className="h-4 w-4" /> Make summary
          </button>
          <button type="button" className={btnSecondary} onClick={() => setTicked(new Set())}>Clear ticks</button>
        </div>
      )}

      {made && summary.count > 0 && (
        <SummaryShare key={made.at} ids={made.ids} madeAt={made.at} viewer={viewer} summary={summary} onSaved={token => setMade(m => (m ? { ...m, token } : m))} onClose={() => setMade(null)} />
      )}
    </section>
  );
}

// One approved payment in the list: tick it for a summary, or (once paid from a PDF or another way) mark it paid
// here, the one place payments are marked paid in the CRM (2026-10-21). A payment on a summary can be taken off it.
function SummaryRow({ o, viewer, vendors, forText, problem, ticked, onToggle }: {
  o: MoneyOut; viewer: Viewer; vendors: Vendor[]; forText: string; problem: string; ticked: boolean; onToggle: () => void; key?: string;
}) {
  const [paying, setPaying] = useState(false);
  const [pay, setPay] = useState({ date: todayIso(), ref: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const v = vendors.find(x => x.id === o.vendorId);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };
  const markPaid = () => {
    if (!pay.date) return setError('Enter the date it was paid.');
    return run(async () => {
      await updateDoc(doc(db, 'money_out', o.id), { status: 'paid', paidDate: pay.date, paidRef: pay.ref.trim(), paidById: viewer.id, paidByName: viewer.name });
      setPaying(false);
    });
  };
  const takeOff = () => {
    if (!window.confirm('Take this payment off its summary? Accounts will no longer see it on that link, so tell them not to pay it from the PDF either. It can then go on a new summary.')) return;
    return run(async () => { await callServer('/api/pay-batch/remove', { id: o.id }, true); });
  };
  const waitingForTraining = !!problem && !o.summaryToken;

  return (
    <>
      <tr className={`align-top ${problem ? '' : 'cursor-pointer hover:bg-surface'} ${ticked && !problem ? 'bg-accent-soft/60' : ''} ${waitingForTraining ? 'text-ink-soft' : ''}`} onClick={problem ? undefined : onToggle}>
        <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
          <input type="checkbox" checked={ticked && !problem} disabled={!!problem} onChange={onToggle} aria-label={`Tick ${o.payee}`} className="h-4 w-4 accent-[#0E6E62]" />
        </td>
        <td className="px-3 py-2">
          <span className="block font-semibold">{o.payee}</span>
          {!hasBank(v) && !o.paymentDetails && <span className="block text-xs font-semibold text-attention">No bank details yet</span>}
        </td>
        <td className="px-3 py-2">
          <span className="block">{o.category}{o.description ? `: ${o.description}` : ''}</span>
          <span className="block text-sm text-ink-soft">{forText}</span>
          {problem && <span className={`block text-xs font-semibold ${o.summaryToken ? 'text-accent' : 'text-ink-soft'}`}>{problem}</span>}
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-sm">{isCompanyPayment(o) ? 'Company' : TIMING_LABELS[o.timing]}</td>
        <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{sen(o.amount)}</td>
        <td className="whitespace-nowrap px-3 py-2 text-right" onClick={e => e.stopPropagation()}>
          {!waitingForTraining && !paying && <button type="button" disabled={busy} className={`${btnSecondary} px-2.5 py-1`} onClick={() => setPaying(true)}><Check className="h-3.5 w-3.5" /> Mark paid</button>}
          {o.summaryToken && <button type="button" disabled={busy} className={`${btnSecondary} ml-1 px-2.5 py-1`} onClick={takeOff}>Take off summary</button>}
        </td>
      </tr>
      {(paying || error) && (
        <tr>
          <td />
          <td colSpan={5} className="px-3 pb-3">
            {paying && (
              <div className="flex flex-wrap items-end gap-2">
                <div><label className={small} htmlFor={`sp-${o.id}`}>Paid on</label><input id={`sp-${o.id}`} type="date" value={pay.date} onChange={e => setPay(p => ({ ...p, date: e.target.value }))} className={input} /></div>
                <div className="min-w-[12rem] flex-1"><label className={small} htmlFor={`sr-${o.id}`}>Payment reference (optional)</label><input id={`sr-${o.id}`} value={pay.ref} onChange={e => setPay(p => ({ ...p, ref: e.target.value }))} className={input} placeholder="e.g. bank transfer ref" /></div>
                <button type="button" className={btnSecondary} onClick={() => setPaying(false)}>Cancel</button>
                <button type="button" disabled={busy} className={btnPrimary} onClick={markPaid}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save</button>
              </div>
            )}
            {error && <p role="alert" className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
          </td>
        </tr>
      )}
    </>
  );
}

function SummaryShare({ ids, madeAt, viewer, summary, onSaved, onClose }: { ids: string[]; madeAt: string; viewer: Viewer; summary: ReturnType<typeof buildSummary>; onSaved: (token: string) => void; onClose: () => void }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState<'' | 'pdf' | 'link' | 'stop'>('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<'' | 'link' | 'msg'>('');
  const ref = summaryRef(madeAt, token);
  const url = token ? `${window.location.origin}/pay/${token}` : '';
  const missingBank = summary.groups.filter(g => !g.bankName && !g.accountNo && !g.paymentDetails).length;

  // The PDF and the link are the same summary (2026-10-21): the first of them saves it on the server, which puts its
  // payments on this summary only, so they can't be sent to accounts twice.
  const [showLink, setShowLink] = useState(false);
  const save = async (): Promise<string> => {
    if (token) return token;
    const r = await callServer<{ token: string }>('/api/pay-batch/create', { ids }, true);
    setToken(r.token);
    onSaved(r.token);
    return r.token;
  };
  const pdf = async () => {
    setBusy('pdf'); setError('');
    let tok = '';
    try { tok = await save(); } catch (e) { setError(friendlyError(e)); setBusy(''); return; }
    try {
      const refText = summaryRef(madeAt, tok);
      const { makeDocumentPdf, downloadBlob } = await import('../lib/quotePdf');
      const blob = await makeDocumentPdf(React.createElement(PaymentSummaryDocument, { summary, refText, madeBy: viewer.name, madeAt }), `Payment summary ${refText}`);
      downloadBlob(blob, `Payment summary ${refText} - ${summary.groups.length} vendors.pdf`);
    } catch (e) { setError(pdfErrorText(e)); } finally { setBusy(''); }
  };
  const link = async () => {
    setBusy('link'); setError('');
    try { await save(); setShowLink(true); }
    catch (e) { setError(friendlyError(e)); } finally { setBusy(''); }
  };
  const stop = async () => {
    if (!window.confirm('Cancel this summary? Its link stops working and its unpaid payments can go on a new summary. Tell accounts not to use the PDF either.')) return;
    setBusy('stop'); setError('');
    try { await callServer('/api/pay-link/stop', { token }, true); setToken(''); setShowLink(false); onClose(); }
    catch (e) { setError(friendlyError(e)); } finally { setBusy(''); }
  };
  const message = [
    `Payment summary ${ref}`,
    `${summary.count} payment${summary.count === 1 ? '' : 's'} to ${summary.groups.length} vendor${summary.groups.length === 1 ? '' : 's'}, total ${sen(summary.total)}`,
    '',
    'Please open this link for the bank details, and click "Payment made" for each vendor once paid:',
    url,
  ].join('\n');
  const copy = async (what: 'link' | 'msg') => {
    const text = what === 'link' ? url : message;
    try { await navigator.clipboard.writeText(text); } catch { window.prompt('Copy this:', text); }
    setCopied(what);
    window.setTimeout(() => setCopied(''), 2000);
  };

  return (
    <div className="space-y-3 rounded-xl border border-accent/30 bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold">Summary {ref}: {summary.groups.length} vendor{summary.groups.length === 1 ? '' : 's'}, {sen(summary.total)}</p>
        <button type="button" className="ml-auto text-sm font-semibold text-ink-soft hover:underline" onClick={onClose}>Close</button>
      </div>
      {missingBank > 0 && <p className="rounded-lg bg-attention-soft px-3 py-2 text-sm text-attention">{missingBank} vendor{missingBank === 1 ? ' has' : 's have'} no bank details yet. Add them in Admin work → Vendors; the summary updates by itself.</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!!busy} className={btnSecondary} onClick={pdf}>{busy === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download PDF</button>
        {!showLink && <button type="button" disabled={!!busy} className={btnPrimary} onClick={link}>{busy === 'link' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} {token ? 'Show link for accounts' : 'Make link for accounts'}</button>}
        {token && <button type="button" disabled={!!busy} className={`${btnSecondary} text-danger hover:bg-danger-soft`} onClick={stop}>Cancel summary</button>}
      </div>
      <p className="text-sm text-ink-soft">{token
        ? 'These payments are on this summary only. Paid by PDF? Mark them paid in the list above. Paid by link? Accounts click Payment made.'
        : 'Downloading the PDF or making the link puts these payments on this summary, so they can\'t be sent to accounts twice.'}</p>
      {token && showLink && (
        <div className="space-y-2 rounded-lg border border-line bg-white px-3 py-2.5">
          <p className="break-all font-mono text-xs">{url}</p>
          <p className="text-sm text-ink-soft">Accounts see each vendor's bank details and click Payment made per vendor; the lines then show "Payment made" in the CRM.</p>
          <span className="flex flex-wrap gap-1">
            <button type="button" className={`${btnSecondary} py-1.5`} onClick={() => copy('link')}>{copied === 'link' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copied === 'link' ? 'Copied' : 'Copy link'}</button>
            <button type="button" className={`${btnSecondary} py-1.5`} onClick={() => copy('msg')}>{copied === 'msg' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copied === 'msg' ? 'Copied' : 'Copy message with link'}</button>
            <a className={`${btnSecondary} py-1.5`} href={url} target="_blank" rel="noopener">Open</a>
          </span>
        </div>
      )}
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="overflow-x-auto rounded-lg border border-line bg-white">
        <div className="min-w-[680px]"><PaymentSummaryDocument summary={summary} refText={ref} madeBy={viewer.name} madeAt={madeAt} /></div>
      </div>
      <p className="text-xs text-ink-soft">Made {formatDate(madeAt)}. Lines paid since show "Payment made".</p>
    </div>
  );
}
