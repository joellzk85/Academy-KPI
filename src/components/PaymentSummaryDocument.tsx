// Printable payment summary for accounts (2026-10-20): one block per vendor with bank details, lines and subtotal,
// and the grand total. Used for the PDF (makeDocumentPdf finds "print-paper") and on accounts' link page.

import React from 'react';
import { TIMING_LABELS, dateTimeMY } from '../lib/money';
import { formatDate } from '../lib/deals';
import { PaymentSummary, SummaryGroup } from '../lib/paymentSummary';

const sen = (n: number) => 'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Where to pay one vendor, each detail on its own labelled line (2026-10-23), also on accounts' link page. */
export function PayTo({ g }: { g: SummaryGroup }) {
  if (g.bankUnchecked) return <p className="mt-0.5 font-semibold text-red-700">Bank details are being checked: don't pay yet</p>;
  const rows: [string, string][] = g.bankName || g.accountNo
    ? [['Bank', g.bankName], ['Account no.', g.accountNo], ['Account name', g.accountName]]
    : g.paymentDetails ? [['Payment details', g.paymentDetails]] : [];
  if (g.contact) rows.push(['Contact', g.contact]);
  if (!rows.some(([k, x]) => k !== 'Contact' && x)) return <p className="mt-0.5 font-semibold text-amber-700">Bank details not recorded: don't pay yet</p>;
  return (
    <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
      {rows.filter(([, x]) => x).map(([k, x]) => (
        <React.Fragment key={k}><dt className="text-slate-500">{k}</dt><dd className={`font-semibold ${k === 'Account no.' ? 'font-mono tracking-wide' : ''}`}>{x}</dd></React.Fragment>
      ))}
    </dl>
  );
}

export default function PaymentSummaryDocument({ summary, refText, madeBy, madeAt }: { summary: PaymentSummary; refText: string; madeBy: string; madeAt: string }) {
  return (
    <div className="print-paper space-y-4 bg-white p-8 font-sans text-sm text-slate-900">
      {/* One thin line instead of the letterhead (Joel, 2026-10-23: the header took up too much space). */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-slate-200 pb-2">
        <h2 className="text-base font-extrabold text-slate-800">NEXT Academy · Payment summary <span className="font-mono text-xs font-bold text-slate-500">{refText}</span></h2>
        <span className="text-slate-600">{summary.count} payment{summary.count === 1 ? '' : 's'} · {summary.groups.length} vendor{summary.groups.length === 1 ? '' : 's'} · by {madeBy}, {formatDate(madeAt)}</span>
      </div>

      {summary.groups.map((g, gi) => (
        <div key={g.key} className="break-inside-avoid rounded-lg border border-slate-200">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{gi + 1}. Pay to</p>
              <p className="text-base font-extrabold text-slate-800">{g.payee}</p>
              <PayTo g={g} />
            </div>
            <p className="text-right"><span className="block text-xs font-bold uppercase tracking-wider text-slate-500">Subtotal</span><span className="text-base font-extrabold tabular-nums">{sen(g.total)}</span></p>
          </div>
          <table className="w-full border-collapse text-sm">
            <tbody>
              {g.lines.map(l => (
                <tr key={l.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2 align-top">
                    <span className="block font-semibold">{l.category}{l.description ? `: ${l.description}` : ''}</span>
                    <span className="block text-xs text-slate-500">{l.forText}{!l.company ? ` · ${TIMING_LABELS[l.timing] || ''}` : ''}</span>
                    {l.status === 'paid' && <span className="block text-xs font-semibold text-emerald-700">Payment made {l.paidAt ? dateTimeMY(l.paidAt) : formatDate(l.paidDate || '')}{l.paidRef ? `, ref ${l.paidRef}` : ''}</span>}
                  </td>
                  <td className="w-36 px-4 py-2 text-right align-top font-semibold tabular-nums">{sen(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <div className="flex items-center justify-between border-y-2 border-slate-300 px-4 py-3">
        <span className="font-extrabold uppercase tracking-wider">Grand total</span>
        <span className="text-lg font-extrabold tabular-nums">{sen(summary.total)}</span>
      </div>
      <p className="text-xs text-slate-400">Made from the NEXT Academy CRM. Every line was approved by Management before it was put on this summary.</p>
    </div>
  );
}
