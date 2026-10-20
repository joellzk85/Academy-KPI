// Printable payment request (Joel, 2026-10-18): downloaded as a PDF or shared to WhatsApp from Money.
// Works for company payments (with items) and training payments (one line from the category and details).
// The sheet has the class "print-paper" so makeDocumentPdf can find it.

import React from 'react';
import Logo from './Logo';
import { COMPANY_ADDRESS } from '../lib/company';
import { MoneyOut, OUT_STATUS_LABELS, dateTimeMY, isCompanyPayment, paidViaLink, paymentRef } from '../lib/money';
import { formatDate } from '../lib/deals';

export { paymentRef };

const sen = (n: number) => 'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function paymentLines(o: MoneyOut): { description: string; qty: number; price: number }[] {
  if (isCompanyPayment(o) && (o.items || []).length) return o.items!.map(i => ({ description: i.description, qty: Number(i.qty) || 0, price: Number(i.price) || 0 }));
  return [{ description: o.category, qty: 1, price: Number(o.amount) || 0 }];
}

export function paymentStatusText(o: MoneyOut): string {
  if (o.status === 'paid') return `Payment made ${paidViaLink(o) ? dateTimeMY(o.paidAt) : formatDate(o.paidDate || '')}${o.paidRef ? `, ref ${o.paidRef}` : ''}${o.decidedByName ? ` (approved by ${o.decidedByName} on ${formatDate(o.decidedAt || '')})` : ''}`;
  if (o.status === 'approved') return `Approved by ${o.decidedByName} on ${formatDate(o.decidedAt || '')}, not paid yet`;
  if (o.status === 'rejected') return `Rejected by ${o.decidedByName} on ${formatDate(o.decidedAt || '')}${o.rejectReason ? `: ${o.rejectReason}` : ''}`;
  return OUT_STATUS_LABELS.pending;
}

export default function PaymentRequestDocument({ o, forText }: { o: MoneyOut; forText: string }) {
  const company = isCompanyPayment(o);
  const lines = paymentLines(o);
  const tone = o.status === 'rejected' ? 'border-red-300 bg-red-50 text-red-800'
    : o.status === 'pending' ? 'border-amber-300 bg-amber-50 text-amber-900'
    : 'border-emerald-300 bg-emerald-50 text-emerald-900';
  const row = (label: string, value?: string) => (value ? (
    <div className="flex gap-3"><span className="w-32 shrink-0 font-bold text-slate-500">{label}</span><span className="font-semibold text-slate-800">{value}</span></div>
  ) : null);

  return (
    <div className="print-paper space-y-6 bg-white p-12 font-sans text-sm text-slate-900">
      <div className="flex items-start justify-between border-b-2 border-slate-100 pb-5">
        <Logo className="h-[100px] w-auto object-contain" />
        <div className="space-y-1 text-right font-mono text-xs text-slate-500">
          <p className="font-bold text-slate-800">NEXT ACADEMY SDN BHD</p>
          <p>(Company No. 202401030750)</p>
          <p>{COMPANY_ADDRESS}</p>
        </div>
      </div>

      <div className="flex items-end justify-between border-b border-slate-200 pb-2">
        <h2 className="text-xl font-extrabold uppercase tracking-widest text-slate-800">Payment request</h2>
        <span className="font-mono text-xs font-bold text-slate-500">REF: {paymentRef(o)}</span>
      </div>

      <div className="grid grid-cols-2 gap-x-8 gap-y-2">
        <div className="space-y-2">
          {row('Date of request', formatDate(o.requestDate || o.requestedAt || ''))}
          {row('Requested by', o.requestedByName)}
          {row('For', forText)}
          {row('Category', o.category)}
          {!company && row('When', o.timing === 'before' ? 'Deposit before training' : 'After training')}
          {row('Needed by', o.neededBy ? formatDate(o.neededBy) : '')}
        </div>
        <div className="space-y-2">
          {row('Pay to', o.payee)}
          {row('Payment details', o.paymentDetails)}
        </div>
      </div>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-y-2 border-slate-300 bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-600">
            <th className="w-10 px-2 py-2">No.</th>
            <th className="px-2 py-2">Description</th>
            <th className="w-16 px-2 py-2 text-right">Qty</th>
            <th className="w-32 px-2 py-2 text-right">Price each</th>
            <th className="w-32 px-2 py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className="border-b border-slate-200">
              <td className="px-2 py-2 align-top">{i + 1}</td>
              <td className="px-2 py-2 align-top font-medium">{l.description}</td>
              <td className="px-2 py-2 text-right align-top tabular-nums">{l.qty}</td>
              <td className="px-2 py-2 text-right align-top tabular-nums">{sen(l.price)}</td>
              <td className="px-2 py-2 text-right align-top tabular-nums">{sen(l.qty * l.price)}</td>
            </tr>
          ))}
          <tr className="border-b-2 border-slate-300">
            <td colSpan={4} className="px-2 py-2.5 text-right font-extrabold uppercase tracking-wider">Total</td>
            <td className="px-2 py-2.5 text-right text-base font-extrabold tabular-nums">{sen(o.amount)}</td>
          </tr>
        </tbody>
      </table>

      {o.description && (
        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-500">Info</p>
          <p className="whitespace-pre-wrap leading-relaxed text-slate-700">{o.description}</p>
        </div>
      )}

      <div className={`rounded-lg border px-4 py-3 ${tone}`}>
        <p className="text-xs font-bold uppercase tracking-wider">Status</p>
        <p className="mt-0.5 text-[15px] font-bold">{paymentStatusText(o)}</p>
      </div>

      <p className="text-xs text-slate-400">Made from the NEXT Academy CRM on {formatDate(new Date().toISOString())}. Approvals are recorded in the CRM.</p>
    </div>
  );
}
