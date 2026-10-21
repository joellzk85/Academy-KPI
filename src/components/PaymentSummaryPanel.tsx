import React, { useMemo, useState } from 'react';
import { Check, Copy, Download, FileText, Link2, Loader2 } from 'lucide-react';
import { callServer, friendlyError } from '../lib/firebase';
import { pdfErrorText } from '../lib/oldTab';
import { formatDate } from '../lib/deals';
import { MoneyOut, TIMING_LABELS, isCompanyPayment } from '../lib/money';
import { buildSummary, summaryRef } from '../lib/paymentSummary';
import { hasBank } from '../lib/vendors';
import { useVendors } from './VendorsPage';
import PaymentSummaryDocument from './PaymentSummaryDocument';

// Admin work → Money → "Payment summary for accounts" (Joel, 2026-10-20). The approved payments not paid yet, with
// Pre-training / Post-training (and Company payments) tick boxes; tick the lines, then make the summary and send it to
// accounts as a PDF or a link (lib/paymentSummary.ts). Accounts click "Payment made" per vendor on the link.

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };

const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';
const sen = (n: number) => 'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ORDER = { before: 0, after: 1, company: 2 };

export default function PaymentSummaryPanel({ outs, viewer, forTextOf }: { outs: MoneyOut[]; viewer: Viewer; forTextOf: (o: MoneyOut) => string }) {
  const vendors = useVendors(true);
  const [show, setShow] = useState({ before: true, after: true, company: true });
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [made, setMade] = useState<{ ids: string[]; at: string } | null>(null);

  const approved = outs.filter(o => o.status === 'approved');
  const kindOf = (o: MoneyOut): 'before' | 'after' | 'company' => (isCompanyPayment(o) ? 'company' : o.timing === 'before' ? 'before' : 'after');
  const list = approved.filter(o => show[kindOf(o)])
    .sort((a, b) => ORDER[kindOf(a)] - ORDER[kindOf(b)] || String(a.payee).localeCompare(String(b.payee)));
  const tickedList = approved.filter(o => ticked.has(o.id));
  const total = tickedList.reduce((t, o) => t + (Number(o.amount) || 0), 0);
  const allShown = list.length > 0 && list.every(o => ticked.has(o.id));
  const toggle = (id: string) => setTicked(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const count = (k: 'before' | 'after' | 'company') => approved.filter(o => kindOf(o) === k).length;

  const madeOuts = made ? outs.filter(o => made.ids.includes(o.id)) : [];
  const summary = useMemo(() => buildSummary(madeOuts, vendors, forTextOf), [madeOuts.map(o => `${o.id}:${o.status}`).join(','), vendors]);

  return (
    <section className="space-y-3 rounded-2xl border border-line bg-white p-4">
      <div>
        <h4 className="font-bold">Payment summary for accounts</h4>
        <p className="text-sm text-ink-soft">Approved payments not paid yet. Tick the ones to pay, then make a summary and send it to accounts as a PDF or a link.</p>
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
          <table className="w-full min-w-[40rem] text-[15px]">
            <thead>
              <tr className="border-b border-line bg-surface text-left text-sm text-ink-soft">
                <th className="w-10 px-3 py-2"><input type="checkbox" checked={allShown} aria-label="Tick every line shown" className="h-4 w-4 accent-[#0E6E62]"
                  onChange={() => setTicked(s => { const n = new Set(s); list.forEach(o => (allShown ? n.delete(o.id) : n.add(o.id))); return n; })} /></th>
                <th className="px-3 py-2 font-semibold">Pay to</th>
                <th className="px-3 py-2 font-semibold">For</th>
                <th className="px-3 py-2 font-semibold">When</th>
                <th className="px-3 py-2 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.map(o => {
                const v = vendors.find(x => x.id === o.vendorId);
                return (
                  <tr key={o.id} className={`cursor-pointer align-top hover:bg-surface ${ticked.has(o.id) ? 'bg-accent-soft/60' : ''}`} onClick={() => toggle(o.id)}>
                    <td className="px-3 py-2" onClick={e => e.stopPropagation()}><input type="checkbox" checked={ticked.has(o.id)} onChange={() => toggle(o.id)} aria-label={`Tick ${o.payee}`} className="h-4 w-4 accent-[#0E6E62]" /></td>
                    <td className="px-3 py-2">
                      <span className="block font-semibold">{o.payee}</span>
                      {!isCompanyPayment(o) && !hasBank(v) && <span className="block text-xs font-semibold text-attention">No bank details yet</span>}
                    </td>
                    <td className="px-3 py-2">
                      <span className="block">{o.category}{o.description ? `: ${o.description}` : ''}</span>
                      <span className="block text-sm text-ink-soft">{forTextOf(o)}</span>
                      {o.summaryToken && <span className="block text-xs text-ink-soft">Already on a summary sent to accounts</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm">{isCompanyPayment(o) ? 'Company' : TIMING_LABELS[o.timing]}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{sen(o.amount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tickedList.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[15px]"><strong>{tickedList.length}</strong> ticked · <strong className="tabular-nums">{sen(total)}</strong></p>
          <button type="button" className={`${btnPrimary} ml-auto`} onClick={() => setMade({ ids: tickedList.map(o => o.id), at: new Date().toISOString() })}>
            <FileText className="h-4 w-4" /> Make summary
          </button>
          <button type="button" className={btnSecondary} onClick={() => setTicked(new Set())}>Clear ticks</button>
        </div>
      )}

      {made && summary.count > 0 && (
        <SummaryShare key={made.at} ids={made.ids} madeAt={made.at} viewer={viewer} summary={summary} onClose={() => setMade(null)} />
      )}
    </section>
  );
}

function SummaryShare({ ids, madeAt, viewer, summary, onClose }: { ids: string[]; madeAt: string; viewer: Viewer; summary: ReturnType<typeof buildSummary>; onClose: () => void }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState<'' | 'pdf' | 'link' | 'stop'>('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<'' | 'link' | 'msg'>('');
  const ref = summaryRef(madeAt, token);
  const url = token ? `${window.location.origin}/pay/${token}` : '';
  const missingBank = summary.groups.filter(g => !g.bankName && !g.accountNo && !g.paymentDetails).length;

  const pdf = async () => {
    setBusy('pdf'); setError('');
    try {
      const { makeDocumentPdf, downloadBlob } = await import('../lib/quotePdf');
      const blob = await makeDocumentPdf(React.createElement(PaymentSummaryDocument, { summary, refText: ref, madeBy: viewer.name, madeAt }), `Payment summary ${ref}`);
      downloadBlob(blob, `Payment summary ${ref} - ${summary.groups.length} vendors.pdf`);
    } catch (e) { setError(pdfErrorText(e)); } finally { setBusy(''); }
  };
  const link = async () => {
    setBusy('link'); setError('');
    try { const r = await callServer<{ token: string }>('/api/pay-batch/create', { ids }, true); setToken(r.token); }
    catch (e) { setError(friendlyError(e)); } finally { setBusy(''); }
  };
  const stop = async () => {
    if (!window.confirm('Stop this link? Accounts will no longer be able to open it.')) return;
    setBusy('stop'); setError('');
    try { await callServer('/api/pay-link/stop', { token }, true); setToken(''); }
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
        {!token && <button type="button" disabled={!!busy} className={btnPrimary} onClick={link}>{busy === 'link' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Make link for accounts</button>}
      </div>
      {token && (
        <div className="space-y-2 rounded-lg border border-line bg-white px-3 py-2.5">
          <p className="break-all font-mono text-xs">{url}</p>
          <p className="text-sm text-ink-soft">Accounts see each vendor's bank details and click Payment made per vendor; the lines then show "Payment made" in the CRM.</p>
          <span className="flex flex-wrap gap-1">
            <button type="button" className={`${btnSecondary} py-1.5`} onClick={() => copy('link')}>{copied === 'link' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copied === 'link' ? 'Copied' : 'Copy link'}</button>
            <button type="button" className={`${btnSecondary} py-1.5`} onClick={() => copy('msg')}>{copied === 'msg' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copied === 'msg' ? 'Copied' : 'Copy message with link'}</button>
            <a className={`${btnSecondary} py-1.5`} href={url} target="_blank" rel="noopener">Open</a>
            <button type="button" disabled={!!busy} className={`${btnSecondary} py-1.5 text-danger hover:bg-danger-soft`} onClick={stop}>Stop link</button>
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
