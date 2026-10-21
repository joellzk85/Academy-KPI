import React, { useEffect, useState } from 'react';
import { Check, CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react';
import { MoneyOut, dateTimeMY, paidViaLink } from '../lib/money';
import { formatDate } from '../lib/deals';
import PaymentRequestDocument from './PaymentRequestDocument';
import PaymentSummaryDocument from './PaymentSummaryDocument';
import { PaymentSummary, groupPaid, groupPayable } from '../lib/paymentSummary';
import logoUrl from '../assets/outline/next-logo.png';

// What accounts see when they open a payment request link (/pay/<token>, Joel 2026-10-20). No login: the page asks
// serverPaymentLinks.ts for the request, shows where it stands with dates and times, and once it's approved offers one
// button, "Payment made", which marks it paid in the CRM.

async function post(path: string, body: any) {
  let res: Response;
  try {
    res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new Error('No internet connection. Check it and try again.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) throw new Error(data?.error || 'Something went wrong. Please try again in a minute.');
  return data;
}

type Data = { payment: MoneyOut; forText: string; ref: string };
const sen = (n: number) => 'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Step({ done, tone, icon, title, detail }: { done: boolean; tone: 'accent' | 'attention' | 'danger' | 'muted'; icon: React.ReactNode; title: string; detail?: string }) {
  const colour = tone === 'accent' ? 'text-accent' : tone === 'attention' ? 'text-attention' : tone === 'danger' ? 'text-danger' : 'text-ink-soft';
  return (
    <li className={`flex gap-3 ${done ? '' : 'opacity-60'}`}>
      <span className={`mt-0.5 shrink-0 ${colour}`}>{icon}</span>
      <span>
        <span className="block font-semibold">{title}</span>
        {detail && <span className="block text-sm text-ink-soft">{detail}</span>}
      </span>
    </li>
  );
}

type BatchData = { batch: true; ref: string; byName: string; createdAt: string; summary: PaymentSummary };

export default function PaymentLinkPage({ token }: { token: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [batch, setBatch] = useState<BatchData | null>(null);
  const [error, setError] = useState('');
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [payError, setPayError] = useState('');

  const load = () => post('/api/pay-link/get', { token }).then(d => { if (d.batch) setBatch(d); else setData(d); setError(''); }).catch(e => setError(e.message));
  useEffect(() => { load(); }, [token]);
  // While it waits for approval, check again every minute so the button appears without a reload.
  const status = data?.payment.status;
  useEffect(() => {
    if (status !== 'pending') return;
    const t = window.setInterval(load, 60_000);
    return () => window.clearInterval(t);
  }, [status]);
  useEffect(() => { document.title = data ? `Payment request ${data.ref} · NEXT Academy` : batch ? `Payment summary ${batch.ref} · NEXT Academy` : 'NEXT Academy'; }, [data, batch]);

  const markPaid = async () => {
    if (!data) return;
    if (!window.confirm(`Confirm you have paid ${sen(data.payment.amount)} to ${data.payment.payee}?`)) return;
    setBusy(true);
    setPayError('');
    try { setData(await post('/api/pay-link/paid', { token, ref })); }
    catch (e: any) { setPayError(e.message); load(); }
    finally { setBusy(false); }
  };

  if (batch) return <BatchView token={token} data={batch} onData={setBatch} />;

  const o = data?.payment;
  const raised = o ? (dateTimeMY(o.requestedAt) || formatDate(o.requestDate || '')) : '';

  return (
    <div className="min-h-screen bg-[#f3f5f4] font-sans text-ink">
      <header className="sticky top-0 z-10 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <img src={logoUrl} alt="NEXT Academy" className="h-8 w-auto" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold">{data ? `Payment request ${data.ref}` : 'Payment request'}</p>
            {o && <p className="truncate text-sm text-ink-soft">{o.payee} · {sen(o.amount)}</p>}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-4 py-5">
        {!data && !error && <p className="flex items-center gap-2 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
        {error && <p role="alert" className="rounded-xl border border-line bg-white px-4 py-4 text-[15px]">{error}</p>}

        {o && (
          <section className="rounded-2xl border border-line bg-white p-4 sm:p-5">
            <h1 className="text-lg font-semibold">Where this payment stands</h1>
            <ol className="mt-3 space-y-3">
              <Step done tone="accent" icon={<CheckCircle2 className="h-5 w-5" />} title={`Payment raised, ${raised}`}
                detail={`by ${o.requestedByName}${data.forText ? ` · ${data.forText}` : ''}`} />
              {o.status === 'pending' && (
                <Step done tone="attention" icon={<Clock className="h-5 w-5" />} title="Waiting for approval"
                  detail="Please don't pay yet. This page checks again every minute; the Payment made button appears once a manager approves it." />
              )}
              {o.status === 'rejected' && (
                <Step done tone="danger" icon={<XCircle className="h-5 w-5" />} title={`Rejected, ${dateTimeMY(o.decidedAt)}`}
                  detail={`by ${o.decidedByName}${o.rejectReason ? `: ${o.rejectReason}` : ''}. Please don't pay it.`} />
              )}
              {(o.status === 'approved' || o.status === 'paid') && (
                <Step done tone="accent" icon={<CheckCircle2 className="h-5 w-5" />} title={`Approved, ${dateTimeMY(o.decidedAt)}`} detail={`by ${o.decidedByName}`} />
              )}
              {o.status === 'paid' && (
                <Step done tone="accent" icon={<CheckCircle2 className="h-5 w-5" />}
                  title={`Payment made, ${paidViaLink(o) ? dateTimeMY(o.paidAt) : formatDate(o.paidDate || '')}`}
                  detail={`${paidViaLink(o) ? 'by accounts (this link)' : `marked by ${o.paidByName}`}${o.paidRef ? ` · ref ${o.paidRef}` : ''}`} />
              )}
            </ol>

            {o.status === 'approved' && (
              <div className="mt-4 space-y-3 border-t border-line pt-4">
                <p className="text-[15px]">Pay <strong>{sen(o.amount)}</strong> to <strong>{o.payee}</strong>{o.paymentDetails ? ` (${o.paymentDetails})` : ''}, then click Payment made.</p>
                <div>
                  <label htmlFor="pay-ref" className="mb-1 block text-sm font-medium text-ink-soft">Bank reference (optional)</label>
                  <input id="pay-ref" value={ref} onChange={e => setRef(e.target.value)} maxLength={80}
                    className="w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] outline-none focus:border-accent" placeholder="e.g. transfer reference" />
                </div>
                <button type="button" disabled={busy} onClick={markPaid}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-3 text-[15px] font-semibold text-white hover:opacity-90 disabled:opacity-60 sm:w-auto">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Payment made
                </button>
              </div>
            )}
            {payError && <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{payError}</p>}
            {o.status === 'paid' && <p className="mt-4 rounded-lg bg-accent-soft px-3 py-2.5 text-sm font-semibold text-accent">Thank you. NEXT Academy can see this payment is made.</p>}
          </section>
        )}

        {o && (
          <div className="overflow-x-auto rounded-2xl border border-line bg-white">
            <div className="min-w-[680px]"><PaymentRequestDocument o={o} forText={data.forText} /></div>
          </div>
        )}
      </main>
    </div>
  );
}

// A payment summary (several approved payments, grouped by vendor; Admin work → Money, 2026-10-20). Accounts pay each
// vendor, then click "Payment made" on that vendor's block; its lines show "Payment made" in the CRM.
function BatchView({ token, data, onData }: { token: string; data: BatchData; onData: (d: BatchData) => void }) {
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const s = data.summary;
  const open = s.groups.filter(g => !groupPaid(g));
  const payGroup = async (key: string, payee: string, amount: number) => {
    if (!window.confirm(`Confirm you have paid ${sen(amount)} to ${payee}?`)) return;
    setBusy(key); setError('');
    try { onData(await post('/api/pay-link/paid', { token, ids: [key], ref: refs[key] || '' })); }
    catch (e: any) { setError(e.message); }
    finally { setBusy(''); }
  };

  return (
    <div className="min-h-screen bg-[#f3f5f4] font-sans text-ink">
      <header className="sticky top-0 z-10 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <img src={logoUrl} alt="NEXT Academy" className="h-8 w-auto" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold">Payment summary {data.ref}</p>
            <p className="truncate text-sm text-ink-soft">{s.groups.length} vendor{s.groups.length === 1 ? '' : 's'} · {sen(s.total)}</p>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-5">
        <section className="rounded-2xl border border-line bg-white p-4 sm:p-5">
          <h1 className="text-lg font-semibold">{open.length ? `${open.length} vendor${open.length === 1 ? '' : 's'} to pay` : 'Everything on this summary is paid'}</h1>
          <p className="text-sm text-ink-soft">Prepared by {data.byName} on {formatDate(data.createdAt)}. Every payment here was approved by Management. Pay each vendor, then click Payment made on its block.</p>
          {error && <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</p>}
          <ul className="mt-4 space-y-3">
            {s.groups.map(g => {
              const payable = groupPayable(g);
              const due = payable.reduce((t, l) => t + l.amount, 0);
              const paid = groupPaid(g);
              const last = g.lines.filter(l => l.paidAt).sort((a, b) => String(b.paidAt).localeCompare(String(a.paidAt)))[0];
              return (
                <li key={g.key} className={`rounded-xl border p-3 ${paid ? 'border-accent/30 bg-accent-soft/40' : 'border-line'}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold">{g.payee}</p>
                      <p className="text-sm">{[g.bankName, g.accountNo, g.accountName].filter(Boolean).join(' · ') || g.paymentDetails || <span className="font-semibold text-attention">Bank details not recorded: ask NEXT Academy</span>}</p>
                      <p className="text-sm text-ink-soft">{g.lines.length} payment{g.lines.length === 1 ? '' : 's'}: {g.lines.map(l => `${l.category}${l.description ? ` (${l.description})` : ''}`).join(', ')}</p>
                    </div>
                    <p className="text-right font-bold tabular-nums">{sen(g.total)}</p>
                  </div>
                  {paid ? (
                    <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-accent"><CheckCircle2 className="h-4 w-4" /> Payment made{last ? ` ${dateTimeMY(last.paidAt)}` : ''}{last?.paidRef ? ` · ref ${last.paidRef}` : ''}</p>
                  ) : payable.length ? (
                    <div className="mt-3 flex flex-wrap items-end gap-2">
                      <div className="min-w-[12rem] flex-1">
                        <label htmlFor={`ref-${g.key}`} className="mb-1 block text-sm font-medium text-ink-soft">Bank reference (optional)</label>
                        <input id={`ref-${g.key}`} value={refs[g.key] || ''} onChange={e => setRefs(r => ({ ...r, [g.key]: e.target.value }))} maxLength={80}
                          className="w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] outline-none focus:border-accent" />
                      </div>
                      <button type="button" disabled={!!busy} onClick={() => payGroup(g.key, g.payee, due)}
                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-[15px] font-semibold text-white hover:opacity-90 disabled:opacity-60">
                        {busy === g.key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Payment made ({sen(due)})
                      </button>
                    </div>
                  ) : (
                    <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-danger"><XCircle className="h-4 w-4" /> Not approved any more: please don't pay it.</p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
        <div className="overflow-x-auto rounded-2xl border border-line bg-white">
          <div className="min-w-[680px]"><PaymentSummaryDocument summary={s} refText={data.ref} madeBy={data.byName} madeAt={data.createdAt} /></div>
        </div>
      </main>
    </div>
  );
}
