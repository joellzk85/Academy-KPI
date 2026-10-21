// Printable payment summary for accounts (2026-10-20): one block per vendor with bank details, lines and subtotal,
// and the grand total. Used for the PDF (makeDocumentPdf finds "print-paper") and on accounts' link page.

import React from 'react';
import Logo from './Logo';
import { COMPANY_ADDRESS } from '../lib/company';
import { TIMING_LABELS, dateTimeMY } from '../lib/money';
import { formatDate } from '../lib/deals';
import { PaymentSummary } from '../lib/paymentSummary';

const sen = (n: number) => 'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PaymentSummaryDocument({ summary, refText, madeBy, madeAt }: { summary: PaymentSummary; refText: string; madeBy: string; madeAt: string }) {
  return (
    <div className="print-paper space-y-6 bg-white p-12 font-sans text-sm text-slate-900">
      <div className="flex items-start justify-between border-b-2 border-slate-100 pb-5">
        <Logo className="h-[90px] w-auto object-contain" />
        <div className="space-y-1 text-right font-mono text-xs text-slate-500">
          <p className="font-bold text-slate-800">NEXT ACADEMY SDN BHD</p>
          <p>(Company No. 202401030750)</p>
          <p>{COMPANY_ADDRESS}</p>
        </div>
      </div>

      <div className="flex items-end justify-between border-b border-slate-200 pb-2">
        <h2 className="text-xl font-extrabold uppercase tracking-widest text-slate-800">Payment summary</h2>
        <span className="font-mono text-xs font-bold text-slate-500">REF: {refText}</span>
      </div>
      <div className="flex flex-wrap justify-between gap-2 text-slate-600">
        <span>Prepared by <strong className="text-slate-800">{madeBy}</strong> on {formatDate(madeAt)}</span>
        <span>{summary.count} payment{summary.count === 1 ? '' : 's'} to {summary.groups.length} vendor{summary.groups.length === 1 ? '' : 's'} · all approved in the CRM</span>
      </div>

      {summary.groups.map((g, gi) => (
        <div key={g.key} className="break-inside-avoid rounded-lg border border-slate-200">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{gi + 1}. Pay to</p>
              <p className="text-base font-extrabold text-slate-800">{g.payee}</p>
              {(g.bankName || g.accountNo) ? (
                <p className="mt-0.5 font-semibold text-slate-700">{[g.bankName, g.accountNo, g.accountName].filter(Boolean).join(' · ')}</p>
              ) : g.paymentDetails ? (
                <p className="mt-0.5 font-semibold text-slate-700">{g.paymentDetails}</p>
              ) : (
                <p className="mt-0.5 font-semibold text-amber-700">Bank details not recorded</p>
              )}
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
