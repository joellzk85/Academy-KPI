import React, { useState } from 'react';
import { CheckCircle2, Plus } from 'lucide-react';
import { doc } from 'firebase/firestore';
import { db, friendlyError } from '../lib/firebase';
import { formatDate, formatRM, todayIso, trainingEndDate } from '../lib/deals';
import { DEFAULT_MONEY_SETTINGS, InSource, MoneyIn, MoneyOut, MoneySettings, OUT_STATUS_LABELS, TIMING_LABELS, isPaid, isPayable, payableFrom, shortfall } from '../lib/money';
import { INVOICE_WORDS, Receipt, invoicesNeeded, postTraining, receiptsFor } from '../lib/postTraining';
import { hrdcClaimBlock, progress } from '../lib/checklist';
import { askReason, withDealHistory } from '../lib/moneyActions';
import DealChecklist from './DealChecklist';
import { InForm, InRow } from './Money';
import { useReceipts } from './PaymentReceipts';
import { ClaimBackStep, useClaimBacks } from './ClaimBacks';
import { ClaimBack } from '../lib/onBehalf';

// A won deal's "After training" section (Joel, 2026-10-20): one journey to "Case closed".
//   1. Issue invoice (HRDC claim and/or client invoice), 2. the post-training documents (JD14, T3, training report,
//   output assessment; certificates optional), 3. Payment received, with the receipt, 4. Payments out (2026-10-21:
//   the training's payment requests approved and paid), 5. Claim back from client (2026-10-22, only when something was
//   paid on the client's behalf). Logic: lib/postTraining.ts.
// Admin and Management do it; reps see where it stands (no amounts' actions, no receipts).

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };

const btnPrimary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';

export default function AfterTraining({ deal, checklist, quotes, viewer, ins, outs, settings }: {
  deal: any;
  checklist: any | null;
  quotes: any[];
  viewer: Viewer;
  ins: MoneyIn[];            // this deal's invoices and claims
  outs: MoneyOut[];          // this deal's payment requests
  settings: MoneySettings;
}) {
  const staff = viewer.role !== 'rep';
  const receipts = useReceipts(staff, deal.id);
  const claims = useClaimBacks(staff, deal.id);
  const st = postTraining(deal, checklist?.tasks, ins, outs, receipts, claims, todayIso(), settings);
  const [adding, setAdding] = useState<InSource | null>(null);
  // HRDC claim only once the grant is approved and the training delivered; Management can record it anyway, with a
  // reason in the History (process audit, 2026-10-22).
  const claimBlock = hrdcClaimBlock(deal, checklist?.tasks);
  const [override, setOverride] = useState('');
  const [topUp, setTopUp] = useState<{ claimId: string; amount: number; claimNo: string } | null>(null);
  const [error, setError] = useState('');
  const startAdding = (src: InSource) => {
    setError('');
    if (src === 'hrdc' && claimBlock && !override) {
      if (viewer.role !== 'management') return setError(`${claimBlock} Record the HRDC claim once it is, or ask Management.`);
      const why = askReason(`${claimBlock}\n\nRecord the HRDC claim anyway? Why?`);
      if (!why) return;
      setOverride(why);
    }
    setAdding(src);
  };
  const writeOff = (m: MoneyIn) => {
    const gap = shortfall(m, settings);
    const why = askReason(`Write off the ${formatRM(gap)} HRDC didn't pay on claim ${m.invoiceNo || ''}? No top-up invoice goes to the client.\n\nWhy?`);
    if (!why) return;
    setError('');
    withDealHistory(deal.id, viewer, `HRDC shortfall of ${formatRM(gap)} written off (claim ${m.invoiceNo || ''}): ${why}`,
      batch => batch.update(doc(db, 'money_in', m.id), { shortfallWriteOff: { byId: viewer.id, byName: viewer.name, at: new Date().toISOString(), reason: why, amount: gap } }))
      .catch(e => setError(friendlyError(e)));
  };
  const needed = invoicesNeeded(deal.fundingType);
  const docsPr = progress(checklist?.tasks, deal.fundingType, 'after');
  const end = trainingEndDate(deal);
  const sortedIns = [...ins].sort((a, b) => String(a.invoiceDate).localeCompare(String(b.invoiceDate)));
  const sortedOuts = outs.filter(o => o.status !== 'rejected').sort((a, b) => String(a.requestedAt).localeCompare(String(b.requestedAt)));

  const banner = st.closed
    ? { tone: 'bg-accent-soft text-accent', text: `Case closed${st.closedOn ? ` on ${formatDate(st.closedOn)}` : ''}. Every step is done and every payment is in${staff ? ' with its receipt' : ''}.` }
    : !end
      ? { tone: 'bg-surface text-ink-soft', text: 'Set the training date first. Post-training starts the day after the training.' }
      : !st.ended
        ? { tone: 'bg-surface text-ink-soft', text: `Post-training starts after the training (last day ${formatDate(end)}). The invoice can be recorded earlier, e.g. direct-pay clients are invoiced before training.` }
        : !st.started
          ? { tone: 'bg-attention-soft text-attention', text: `Training ended ${st.daysSince} day${st.daysSince === 1 ? '' : 's'} ago. Start post-training: record the invoice${needed.includes('hrdc') ? ' or HRDC claim' : ''} first.` }
          : { tone: 'bg-attention-soft text-attention', text: `Next: ${st.next}` };

  return (
    <div className="space-y-4">
      <p className={`flex items-start gap-2 rounded-lg px-3.5 py-2.5 text-[15px] font-semibold ${banner.tone}`}>
        {st.closed && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}{banner.text}
      </p>

      {/* 1. Issue invoice */}
      <Step n={1} title="Issue invoice" done={st.invoiceDone}
        sub={needed.length ? `The ${needed.map(s => INVOICE_WORDS[s]).join(' and the ')}: issued by accounts, recorded here` : 'Set how the deal is paid to see what to invoice'}>
        {sortedIns.length > 0 && (
          <ul className="space-y-1.5">
            {sortedIns.map(m => (
              <li key={m.id} className="rounded-lg border border-line bg-white px-3 py-2 text-[15px]">
                <span className="font-semibold">{m.source === 'hrdc' ? 'HRDC claim' : 'Client invoice'}{m.invoiceNo ? ` ${m.invoiceNo}` : ''}</span>
                {staff && <> · {formatRM(m.amount)}</>}
                <span className="text-ink-soft"> · {m.source === 'hrdc' ? 'submitted' : 'invoiced'} {formatDate(m.invoiceDate)}</span>
              </li>
            ))}
          </ul>
        )}
        {!sortedIns.length && <p className="text-[15px] text-ink-soft">{staff ? 'Nothing recorded yet.' : 'Not issued yet.'}</p>}
        {staff && (adding ? (
          <InForm deal={deal} source={adding} viewer={viewer} settings={settings} override={adding === 'hrdc' ? override : ''} onDone={() => { setAdding(null); setOverride(''); }} />
        ) : (
          <div className="flex flex-wrap gap-2">
            {st.missingInvoices.map(src => (
              <button key={src} type="button" className={btnPrimary} onClick={() => startAdding(src)}><Plus className="h-4 w-4" /> Record the {INVOICE_WORDS[src]}</button>
            ))}
            {(needed.includes('hrdc') || !needed.length) && !st.missingInvoices.includes('hrdc') && (
              <button type="button" className={btnSecondary} onClick={() => startAdding('hrdc')}><Plus className="h-4 w-4" /> {ins.some(m => m.source === 'hrdc') ? 'Another HRDC claim' : 'Record HRDC claim'}</button>
            )}
            {!st.missingInvoices.includes('client') && (
              <button type="button" className={btnSecondary} onClick={() => startAdding('client')}><Plus className="h-4 w-4" /> {ins.some(m => m.source === 'client') ? 'Another client invoice' : 'Record client invoice'}</button>
            )}
          </div>
        ))}
        {staff && claimBlock && st.missingInvoices.includes('hrdc') && !adding && (
          <p className="text-sm font-semibold text-attention">Before the HRDC claim: {claimBlock}</p>
        )}
        {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      </Step>

      {/* 2. Documents */}
      <Step n={2} title="Post-training documents" done={!!checklist && st.docsOpen.length === 0 && docsPr.total > 0}
        sub={checklist ? `${docsPr.done} of ${docsPr.total} done` : undefined}>
        <DealChecklist deal={deal} checklist={checklist} quotes={quotes} viewer={viewer} part="after" hideProgress />
      </Step>

      {/* 3. Payment received */}
      <Step n={3} title="Payment received" done={st.paymentInDone}
        sub={staff ? 'Mark each invoice or claim received and upload the receipt from the client or HRDC. Also in Payment tracking.' : undefined}>
        {sortedIns.length === 0 ? (
          <p className="text-[15px] text-ink-soft">Record the invoice{needed.includes('hrdc') ? ' or HRDC claim' : ''} first (step 1).</p>
        ) : (
          <ul className="space-y-2">
            {sortedIns.map(m => staff
              ? <InRow key={m.id} m={m} viewer={viewer} settings={settings} receipts={receiptsFor(m, receipts)} />
              : (
                <li key={m.id} className="rounded-lg border border-line bg-white px-3 py-2 text-[15px]">
                  <span className="font-semibold">{m.source === 'hrdc' ? 'HRDC claim' : 'Client invoice'}{m.invoiceNo ? ` ${m.invoiceNo}` : ''}</span>
                  <span className={isPaid(m) ? 'text-accent' : 'text-ink-soft'}> · {isPaid(m) ? `paid ${formatDate(m.paidDate || '')}` : 'waiting for payment'}</span>
                </li>
              ))}
          </ul>
        )}
        {/* HRDC paid less (process audit, 2026-10-22): a top-up invoice to the client, or Management writes it off. */}
        {staff && st.shortfallsOpen.map(m => (
          topUp?.claimId === m.id ? (
            <InForm key={m.id} deal={deal} source="client" viewer={viewer} settings={settings} topUp={topUp} onDone={() => setTopUp(null)} />
          ) : (
            <div key={m.id} className="rounded-lg border border-danger/30 bg-danger-soft/50 px-3 py-2.5">
              <p className="text-[15px] font-semibold text-danger">HRDC paid {formatRM(shortfall(m, settings))} less than expected on claim {m.invoiceNo || ''}.</p>
              <p className="text-sm text-ink-soft">Bill the client for the difference on a top-up invoice. The case can't close until it's raised{viewer.role === 'management' ? ' or written off' : ''}.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className={btnPrimary} onClick={() => setTopUp({ claimId: m.id, amount: shortfall(m, settings), claimNo: m.invoiceNo || '' })}><Plus className="h-4 w-4" /> Raise top-up invoice</button>
                {viewer.role === 'management' && <button type="button" className={btnSecondary} onClick={() => writeOff(m)}>Write it off</button>}
              </div>
            </div>
          )
        ))}
        {staff && ins.filter(m => m.shortfallWriteOff).map(m => (
          <p key={m.id} className="text-sm text-ink-soft">HRDC shortfall of {formatRM(m.shortfallWriteOff!.amount)} on claim {m.invoiceNo || ''} written off by {m.shortfallWriteOff!.byName}: {m.shortfallWriteOff!.reason}</p>
        ))}
      </Step>

      {/* 4. Payments out (2026-10-21): what we still owe on this training before the case can close */}
      {staff && (
        <Step n={4} title="Payments out" done={st.outsDone}
          sub="Every payment request on this training approved and paid. Post-training payments go on the accounts summary from the day after the training.">
          {sortedOuts.length === 0 ? (
            <p className="text-[15px] text-ink-soft">No payment requests on this training.</p>
          ) : (
            <ul className="space-y-1.5">
              {sortedOuts.map(o => {
                const from = o.status === 'approved' && !isPayable(o, deal) ? payableFrom(o, deal) : '';
                return (
                  <li key={o.id} className="flex flex-wrap items-baseline gap-x-2 rounded-lg border border-line bg-white px-3 py-2 text-[15px]">
                    <span className="font-semibold">{o.category} · {o.payee}</span>
                    <span className="tabular-nums">{formatRM(o.amount)}</span>
                    <span className="text-sm text-ink-soft">{TIMING_LABELS[o.timing] || TIMING_LABELS.after}</span>
                    <span className={`text-sm font-semibold ${o.status === 'paid' ? 'text-accent' : 'text-attention'}`}>
                      {OUT_STATUS_LABELS[o.status]}{from ? `, payable from ${formatDate(from)}` : ''}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-sm text-ink-soft">Costs are added on the Before training checklist; approved ones are sent to accounts from Admin work → Money → Payment summary.</p>
        </Step>
      )}

      {/* 5. Claim back from client (2026-10-22): only when something was paid on the client's behalf */}
      {staff && st.behalf.has && (
        <Step n={5} title="Claim back from client" done={st.behalf.done}
          sub={`Paid on the client's behalf: ${formatRM(st.behalf.owed)}${st.behalf.outstanding > 0 ? `, still to get back ${formatRM(st.behalf.outstanding)}` : ', all paid back'}`}>
          <ClaimBackStep deal={deal} viewer={viewer} b={st.behalf} receipts={receipts} settings={settings} />
        </Step>
      )}
    </div>
  );
}

function Step({ n, title, done, sub, children }: { n: number; title: string; done: boolean; sub?: string; children: React.ReactNode }) {
  return (
    <section className={`rounded-xl border p-3.5 ${done ? 'border-accent/25 bg-accent-soft/30' : 'border-line bg-white'}`}>
      <div className="mb-2.5 flex items-start gap-2.5">
        {done
          ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
          : <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-ink-soft/40 text-xs font-bold text-ink-soft">{n}</span>}
        <div className="min-w-0">
          <h5 className="font-bold">{title}</h5>
          {sub && <p className="text-sm text-ink-soft">{sub}</p>}
        </div>
      </div>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

/** One line for a fold's hint: where the deal's post-training stands. */
export function afterTrainingHint(deal: any, checklist: any | null, ins: MoneyIn[], outs: MoneyOut[], receipts: Receipt[], claims: ClaimBack[], settings: MoneySettings = DEFAULT_MONEY_SETTINGS): string {
  const st = postTraining(deal, checklist?.tasks, ins, outs, receipts, claims, todayIso(), settings);
  if (st.closed) return 'Case closed';
  if (!st.ended) return 'Starts after the training';
  return `Step ${Math.min(st.step, st.steps)} of ${st.steps}: ${st.next}`;
}
