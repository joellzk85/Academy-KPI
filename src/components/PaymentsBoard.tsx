import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { ArrowRight, Check, ChevronDown, Download, ExternalLink, Link2, Loader2, MessageCircle, Search, Send, X } from 'lucide-react';
import { callServer, db, friendlyError } from '../lib/firebase';
import { pdfErrorText } from '../lib/oldTab';
import { formatDate, todayIso } from '../lib/deals';
import { ACCOUNTS_PAID_BY, MoneyOut, TIMING_LABELS, canDecide, isCompanyPayment, paidViaLink, paymentRef } from '../lib/money';
import { ListSort, sortList, usePaged } from '../lib/listPaging';
import ListPager, { SortSelect, listSelect } from './ListPager';
import { buildSummary, payToProblem, PaymentSummary, summaryProblem, summaryRef } from '../lib/paymentSummary';
import { isTrainerFee } from '../lib/feeChecks';
import { feeIsAgreed } from '../lib/trainerPortal';
import { Receipt } from '../lib/postTraining';
import { VendorForm, useTrainersVenues, useVendors } from './VendorsPage';
import { ReceiptDrop, ReceiptList, useReceipts } from './PaymentReceipts';
import PaymentSummaryDocument from './PaymentSummaryDocument';
import PanelResizer from './PanelResizer';
import { OutRow, approveMany } from './Money';

// Admin work → Money → Payments out (Joel, 2026-10-26: "the payment raise to account process feels very tedious, a lot
// of steps and the view is unfriendly"). One board with four lanes, left to right, so every payment out is in one place:
//   1. Waiting approval   pending requests; a manager approves on the card (never their own), or all at once
//   2. Ready for accounts approved, not on a summary; ready ones start ticked, blocked ones say why (bank details, date)
//   3. With accounts      the summaries sent (one card per summary), and older per-payment links
//   4. Paid, receipt needed paid since receipts came in (2026-10-20) with no receipt yet; drop it on the card
// "Send N to accounts" makes the summary and its link in one click and copies the approval link for accounts.
// Under the lanes, History (2026-10-26): paid, approved, rejected, deleted and fully paid summaries, with search, month
// filter and total, who raised / approved / paid, and a "No receipt" flag.
// Clicking a card opens the full request in a side panel (reject, fix, trainer fee checks, mark paid, take off).
// The rules are unchanged: lib/paymentSummary.ts decides what can go on a summary, the server checks it again.

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };

const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';
const btnTiny = `${btnSecondary} px-2.5 py-1 text-xs`;
const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const small = 'mb-1 block text-sm font-medium text-ink-soft';
const sen = (n: number) => 'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sum = (list: MoneyOut[]) => list.reduce((t, o) => t + (Number(o.amount) || 0), 0);
const RECEIPTS_FROM = '2026-10-20';   // receipts on payments out started then; older paid ones never ask for one
const LANE_SHOW = 8;

const paidDay = (o: MoneyOut) => String(o.paidDate || o.paidAt || '').slice(0, 10);
const refOf = (o: MoneyOut) => (o.summaryAt ? summaryRef(o.summaryAt, o.summaryToken) : `PS-${String(o.summaryToken || '').slice(0, 4).toUpperCase()}`);
const linkOf = (token: string) => `${window.location.origin}/pay/${token}`;

export function summaryMessage(summary: PaymentSummary, ref: string, url: string) {
  return [
    `Payment summary ${ref}`,
    `${summary.count} payment${summary.count === 1 ? '' : 's'} to ${summary.groups.length} vendor${summary.groups.length === 1 ? '' : 's'}, total ${sen(summary.total)}`,
    '',
    'Please open this link for the bank details, and click "Payment made" for each vendor once paid:',
    url,
  ].join('\n');
}

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

async function downloadSummaryPdf(summary: PaymentSummary, ref: string, madeBy: string, madeAt: string) {
  const { makeDocumentPdf, downloadBlob } = await import('../lib/quotePdf');
  const blob = await makeDocumentPdf(React.createElement(PaymentSummaryDocument, { summary, refText: ref, madeBy, madeAt }), `Payment summary ${ref}`);
  downloadBlob(blob, `Payment summary ${ref} - ${summary.groups.length} vendors.pdf`);
}

type Open = { kind: 'pay'; id: string } | { kind: 'summary'; token: string } | null;

export default function PaymentsBoard({ outs, deletedOuts = [], deals, viewer, dealLabel, onOpenDeal }: {
  outs: MoneyOut[]; deletedOuts?: MoneyOut[]; deals: any[]; viewer: Viewer; dealLabel: (dealId: string) => string; onOpenDeal?: (dealId: string) => void;
}) {
  const vendors = useVendors(true);
  const receipts = useReceipts(true);
  const today = todayIso();
  const [skipped, setSkipped] = useState<Set<string>>(new Set());   // ready payments unticked (new ones start ticked)
  const [open, setOpen] = useState<Open>(null);
  const [sent, setSent] = useState<{ token: string; copied: boolean } | null>(null);
  const [busy, setBusy] = useState<'' | 'send' | 'approve'>('');
  const [error, setError] = useState('');

  const dealOf = (o: MoneyOut) => deals.find(d => d.id === o.dealId);
  const vendorOf = (o: MoneyOut) => vendors.find(v => v.id === o.vendorId);
  const forText = (o: MoneyOut) => dealLabel(o.dealId);

  const pending = outs.filter(o => o.status === 'pending').sort((a, b) => String(a.requestedAt).localeCompare(String(b.requestedAt)));
  const mineInBulk = pending.filter(o => canDecide(o, viewer) && !isTrainerFee(o) && feeIsAgreed(o));
  const approved = outs.filter(o => o.status === 'approved');
  const withAccounts = approved.filter(o => o.summaryToken || o.accountsLink?.token);
  const toSend = approved.filter(o => !o.summaryToken && !o.accountsLink?.token);
  const problemOf = (o: MoneyOut) => summaryProblem(o, dealOf(o), vendorOf(o), today);
  const ready = toSend.filter(o => !problemOf(o)).sort((a, b) => String(a.payee).localeCompare(String(b.payee)));
  const blocked = toSend.filter(o => problemOf(o)).sort((a, b) => String(a.payee).localeCompare(String(b.payee)));
  const ticked = ready.filter(o => !skipped.has(o.id));
  const receiptsOf = (o: MoneyOut) => receipts.filter(r => r.moneyOutId === o.id);
  const paidNoReceipt = outs.filter(o => o.status === 'paid' && paidDay(o) >= RECEIPTS_FROM && !receiptsOf(o).length)
    .sort((a, b) => paidDay(b).localeCompare(paidDay(a)));

  // Every summary sent: lane 3 shows those with payments still to pay (then each older per-payment link), History the rest.
  const summaries = useMemo(() => {
    const tokens = [...new Set(outs.filter(o => o.summaryToken).map(o => o.summaryToken as string))];
    return tokens.map(token => {
      const all = outs.filter(o => o.summaryToken === token);
      return { token, all, unpaid: all.filter(o => o.status === 'approved'), first: all[0] };
    }).sort((a, b) => (Number(b.first.summaryAt) || 0) - (Number(a.first.summaryAt) || 0));
  }, [outs]);
  const ownLinks = withAccounts.filter(o => !o.summaryToken);

  const approveAll = async () => {
    setBusy('approve'); setError('');
    try { await approveMany(mineInBulk, viewer); } catch (e) { setError(friendlyError(e)); } finally { setBusy(''); }
  };
  // One click: the summary is saved on the server (one summary per payment, checked again there), its link made, and
  // the message for accounts copied.
  const send = async () => {
    if (!ticked.length) return;
    setBusy('send'); setError(''); setSent(null);
    try {
      const ids = ticked.map(o => o.id);
      const { token } = await callServer<{ token: string }>('/api/pay-batch/create', { ids }, true);
      const copied = await copyText(linkOf(token));
      setSent({ token, copied });
      setSkipped(new Set());
    } catch (e) { setError(friendlyError(e)); } finally { setBusy(''); }
  };

  const openPay = (o: MoneyOut) => setOpen({ kind: 'pay', id: o.id });
  const openOut = open?.kind === 'pay' ? outs.find(o => o.id === open.id) : undefined;
  const openSummary = open?.kind === 'summary' ? summaries.find(s => s.token === open.token) : undefined;
  const sentSummary = sent ? summaries.find(s => s.token === sent.token) : undefined;

  return (
    <div className="space-y-4">
      {sent && sentSummary && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-accent/30 bg-accent-soft/60 px-4 py-3" role="status">
          <Check className="h-5 w-5 text-accent" />
          <p className="min-w-[14rem] flex-1 text-[15px]">
            <strong>Sent to accounts:</strong> {sentSummary.all.length} payment{sentSummary.all.length === 1 ? '' : 's'}, {sen(sum(sentSummary.all))}.{' '}
            {sent.copied ? 'The approval link is copied: paste it to accounts.' : 'Copy the link below and send it to accounts.'}
          </p>
          <SummaryButtons s={sentSummary} vendors={vendors} forText={forText} viewer={viewer} />
          <button type="button" className="rounded-md p-1.5 text-ink-soft hover:bg-white" aria-label="Close" onClick={() => setSent(null)}><X className="h-4 w-4" /></button>
        </div>
      )}
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Lane n={1} title="Waiting approval" list={pending}
          top={mineInBulk.length > 1 && (
            <button type="button" disabled={!!busy} className={`${btnPrimary} w-full`} onClick={approveAll}>
              {busy === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Approve all {mineInBulk.length}
            </button>
          )}
          empty="Nothing waiting for approval.">
          {pending.map(o => <PendingCard key={o.id} o={o} viewer={viewer} forText={forText(o)} onOpen={() => openPay(o)} />)}
        </Lane>

        <Lane n={2} title="Ready for accounts" list={toSend}
          bottom={ready.length > 0 && (
            <button type="button" disabled={!!busy || !ticked.length} className={`${btnPrimary} w-full`} onClick={send}>
              {busy === 'send' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {ticked.length ? `Send ${ticked.length} to accounts · ${sen(sum(ticked))}` : 'Tick a payment to send'}
            </button>
          )}
          empty="No approved payments waiting to go to accounts.">
          {[
            ...ready.map(o => (
              <Card key={o.id} o={o} forText={forText(o)} onOpen={() => openPay(o)}
                lead={<input type="checkbox" checked={!skipped.has(o.id)} aria-label={`Send ${o.payee} to accounts`} className="mt-1 h-4 w-4 accent-[#0E6E62]"
                  onClick={e => e.stopPropagation()}
                  onChange={() => setSkipped(s => { const n = new Set(s); n.has(o.id) ? n.delete(o.id) : n.add(o.id); return n; })} />} />
            )),
            ...blocked.map(o => (
              <Card key={o.id} o={o} forText={forText(o)} onOpen={() => openPay(o)} muted
                note={<span className="font-semibold text-attention">{problemOf(o)}</span>} />
            )),
          ]}
        </Lane>

        <Lane n={3} title="With accounts" list={withAccounts} empty="Nothing with accounts right now.">
          {[
            ...summaries.filter(s => s.unpaid.length).map(s => (
              <FoldCard key={s.token} onOpen={() => setOpen({ kind: 'summary', token: s.token })}
                name={refOf(s.first)} amount={sum(s.unpaid)}>
                <p className="text-sm text-ink-soft">
                  {s.unpaid.length} to pay{s.all.length > s.unpaid.length ? `, ${s.all.length - s.unpaid.length} paid` : ''}
                  {s.first.summaryAt ? ` · sent ${formatDate(new Date(s.first.summaryAt).toISOString())}` : ''}
                </p>
                <p className="truncate text-sm text-ink-soft">{[...new Set(s.unpaid.map(o => o.payee))].join(', ')}</p>
                <div className="mt-2 flex flex-wrap gap-1" onClick={e => e.stopPropagation()}>
                  <SummaryButtons s={s} vendors={vendors} forText={forText} viewer={viewer} compact />
                </div>
              </FoldCard>
            )),
            ...ownLinks.map(o => <Card key={o.id} o={o} forText={forText(o)} onOpen={() => openPay(o)} note="Older link of its own" />),
          ]}
        </Lane>

        <Lane n={4} title="Paid, receipt needed" list={paidNoReceipt} empty="Every payment has its receipt.">
          {paidNoReceipt.map(o => (
            <Card key={o.id} o={o} forText={forText(o)} onOpen={() => openPay(o)}
              note={`Paid ${formatDate(paidDay(o))}${o.paidByName ? ` by ${o.paidByName}` : o.paidAt ? ' by accounts' : ''}`}
              extra={<div onClick={e => e.stopPropagation()}><ReceiptDrop target={{ dealId: o.dealId, moneyInId: '', recordId: '', moneyOutId: o.id }} viewer={viewer} small prompt="Drop the receipt" /></div>} />
          ))}
        </Lane>
      </div>

      <History outs={outs} deletedOuts={deletedOuts} summaries={summaries.filter(s => !s.unpaid.length)} forText={forText}
        noReceipt={o => paidDay(o) >= RECEIPTS_FROM && !receiptsOf(o).length}
        onOpenPay={openPay} onOpenSummary={token => setOpen({ kind: 'summary', token })} />

      {(openOut || openSummary) && (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" role="dialog" aria-modal="true" onClick={() => setOpen(null)}>
          <PanelResizer />
          <div className="h-full w-full overflow-y-auto bg-white p-6 shadow-xl md:w-[var(--panel-w,max(50vw,40rem))] md:min-w-[24rem] md:max-w-[95vw]" onClick={e => e.stopPropagation()}>
            <div className="mb-4 flex items-center gap-2">
              <h3 className="text-lg font-bold">{openOut ? `${openOut.payee} · ${sen(openOut.amount)}` : `Payment summary ${refOf(openSummary!.first)}`}</h3>
              <button type="button" className="ml-auto rounded-md p-1.5 text-ink-soft hover:bg-surface" aria-label="Close" onClick={() => setOpen(null)}><X className="h-5 w-5" /></button>
            </div>
            {openOut && <PaymentDetail o={openOut} viewer={viewer} forText={forText(openOut)} problem={openOut.status === 'approved' ? problemOf(openOut) : ''}
              receipts={receiptsOf(openOut)} onOpenDeal={onOpenDeal && openOut.dealId ? () => { setOpen(null); onOpenDeal(openOut.dealId); } : undefined}
              onOpenSummary={openOut.summaryToken ? () => setOpen({ kind: 'summary', token: openOut.summaryToken! }) : undefined} />}
            {openSummary && <SummaryDetail s={openSummary} vendors={vendors} forText={forText} viewer={viewer} onOpenPay={openPay} onGone={() => setOpen(null)} />}
          </div>
        </div>
      )}
    </div>
  );
}

function Lane({ n, title, list, top, bottom, empty, children }: {
  n: number; title: string; list: MoneyOut[]; top?: React.ReactNode; bottom?: React.ReactNode; empty: string; children: React.ReactNode[];
}) {
  const [all, setAll] = useState(false);
  const [fold, setFold] = useState({ folded: false, stamp: 0 });
  const shown = all ? children : children.slice(0, LANE_SHOW);
  return (
    <section className="space-y-2 rounded-2xl bg-surface p-3" aria-label={title}>
      <div className="flex items-baseline gap-2 px-1">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-bold text-ink-soft">{n}</span>
        <h4 className="font-bold">{title}</h4>
        {children.length > 0 && (
          <button type="button" className="ml-auto text-sm font-semibold text-accent hover:underline"
            onClick={() => setFold(f => ({ folded: !f.folded, stamp: f.stamp + 1 }))}>
            {fold.folded ? 'Unfold all' : 'Fold all'}
          </button>
        )}
      </div>
      {list.length > 0 && <p className="-mt-1 px-1 pl-9 text-sm text-ink-soft">{list.length} · {sen(sum(list))}</p>}
      {top}
      {children.length === 0 ? <p className="px-1 py-2 text-sm text-ink-soft">{empty}</p>
        : <LaneFold.Provider value={fold}><ul className="space-y-2">{shown}</ul></LaneFold.Provider>}
      {children.length > LANE_SHOW && (
        <button type="button" className="w-full text-center text-sm font-semibold text-accent hover:underline" onClick={() => setAll(a => !a)}>
          {all ? 'Show fewer' : `Show all ${children.length}`}
        </button>
      )}
      {bottom}
    </section>
  );
}

// Fold a card to its name and amount (Joel, 2026-10-26: "make each card collapsible"): the arrow on each card, or
// Fold all / Unfold all on the lane (a lane-wide click resets every card in it).
const LaneFold = createContext({ folded: false, stamp: 0 });

function FoldCard({ name, amount, onOpen, lead, muted, children }: {
  name: React.ReactNode; amount: number; onOpen: () => void; lead?: React.ReactNode; muted?: boolean; children: React.ReactNode; key?: string;
}) {
  const lane = useContext(LaneFold);
  const [folded, setFolded] = useState(lane.folded);
  useEffect(() => { setFolded(lane.folded); }, [lane.stamp]);
  return (
    <li>
      <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={e => e.key === 'Enter' && onOpen()}
        className={`flex cursor-pointer gap-2.5 rounded-xl border border-line bg-white px-3 py-2.5 hover:border-accent/40 ${muted ? 'opacity-80' : ''}`}>
        {lead}
        <div className="min-w-0 flex-1">
          <p className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 break-words font-semibold">{name}</span>
            <span className="ml-auto shrink-0 font-semibold tabular-nums">{sen(amount)}</span>
            <button type="button" className="-my-1 -mr-1 shrink-0 self-center rounded-md p-1 text-ink-soft hover:bg-surface"
              aria-expanded={!folded} aria-label={folded ? 'Unfold card' : 'Fold card'}
              onClick={e => { e.stopPropagation(); setFolded(f => !f); }} onKeyDown={e => e.stopPropagation()}>
              <ChevronDown className={`h-4 w-4 transition-transform ${folded ? '-rotate-90' : ''}`} />
            </button>
          </p>
          {!folded && children}
        </div>
      </div>
    </li>
  );
}

function Card({ o, forText, onOpen, lead, note, extra, muted }: {
  o: MoneyOut; forText: string; onOpen: () => void; lead?: React.ReactNode; note?: React.ReactNode; extra?: React.ReactNode; muted?: boolean; key?: string;
}) {
  return (
    <FoldCard name={o.payee || 'Not named'} amount={o.amount} onOpen={onOpen} lead={lead} muted={muted}>
      <p className="truncate text-sm text-ink-soft">{o.category}{o.description ? `: ${o.description}` : ''}</p>
      <p className="truncate text-sm text-ink-soft">{isCompanyPayment(o) ? 'Company payment' : `${forText} · ${TIMING_LABELS[o.timing] || TIMING_LABELS.after}`}</p>
      {note && <p className="mt-0.5 text-sm">{note}</p>}
      {extra && <div className="mt-2">{extra}</div>}
    </FoldCard>
  );
}

// Lane 1: a manager approves right on the card (the same check as Approve all); trainer fees open their checks first.
function PendingCard({ o, viewer, forText, onOpen }: { o: MoneyOut; viewer: Viewer; forText: string; onOpen: () => void; key?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const decide = canDecide(o, viewer);
  const toAgree = !feeIsAgreed(o);
  const quick = decide && !toAgree && !isTrainerFee(o);
  const approve = async () => {
    setBusy(true); setError('');
    try { await approveMany([o], viewer); } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };
  const note = toAgree ? <span className="font-semibold text-attention">Fee to agree on the deal's Trainer step</span>
    : !decide ? <span className="text-ink-soft">Raised by {o.requestedByName}{viewer.role === 'management' ? ' · waiting for the other manager' : ' · waiting for a manager'}</span>
    : <span className="text-ink-soft">Raised by {o.requestedByName}, {formatDate(o.requestDate || o.requestedAt)}</span>;
  return (
    <Card o={o} forText={forText} onOpen={onOpen} note={note}
      extra={decide && !toAgree ? (
        <div className="flex flex-wrap items-center gap-1" onClick={e => e.stopPropagation()}>
          {quick
            ? <button type="button" disabled={busy} className={`${btnPrimary} px-3 py-1`} onClick={approve}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Approve</button>
            : <button type="button" className={`${btnPrimary} px-3 py-1`} onClick={onOpen}>Check and approve <ArrowRight className="h-3.5 w-3.5" /></button>}
          <button type="button" className={btnTiny} onClick={onOpen}>Reject…</button>
          {error && <span role="alert" className="basis-full text-sm text-danger">{error}</span>}
        </div>
      ) : undefined} />
  );
}

// Copy link, WhatsApp, PDF and Open for one summary (lane 3 card, the "sent" bar and the summary panel). Copy link copies
// only the approval link accounts open (Joel, 2026-10-26); WhatsApp still sends the short message with the link.
function SummaryButtons({ s, vendors, forText, viewer, compact }: {
  s: { token: string; all: MoneyOut[]; first: MoneyOut }; vendors: any[]; forText: (o: MoneyOut) => string; viewer: Viewer; compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ref = refOf(s.first);
  const summary = buildSummary(s.all, vendors, forText);
  const msg = summaryMessage(summary, ref, linkOf(s.token));
  const cls = compact ? btnTiny : `${btnSecondary} py-1.5`;
  const copy = async () => {
    if (!(await copyText(linkOf(s.token)))) window.prompt('Copy this link:', linkOf(s.token));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };
  const pdf = async () => {
    setBusy(true); setError('');
    try { await downloadSummaryPdf(summary, ref, s.first.summaryByName || '—', s.first.summaryAt ? new Date(s.first.summaryAt).toISOString() : new Date().toISOString()); }
    catch (e) { setError(pdfErrorText(e)); } finally { setBusy(false); }
  };
  return (
    <>
      <button type="button" className={cls} onClick={copy}>{copied ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}{copied ? 'Link copied' : 'Copy link'}</button>
      <a className={cls} href={`https://wa.me/?text=${encodeURIComponent(msg)}`} target="_blank" rel="noopener"><MessageCircle className="h-3.5 w-3.5" /> WhatsApp</a>
      <button type="button" disabled={busy} className={cls} onClick={pdf}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} PDF</button>
      {!compact && <a className={cls} href={linkOf(s.token)} target="_blank" rel="noopener"><ExternalLink className="h-3.5 w-3.5" /> Open link</a>}
      {error && <span role="alert" className="basis-full text-sm text-danger">{error}</span>}
    </>
  );
}

// The side panel for one payment: the full request (approve, reject, fix, trainer fee checks, delete, undo paid), then
// what to do next by its lane: bank details, mark paid or take off the summary, the receipt.
function PaymentDetail({ o, viewer, forText, problem, receipts, onOpenDeal, onOpenSummary }: {
  o: MoneyOut; viewer: Viewer; forText: string; problem: string; receipts: Receipt[]; onOpenDeal?: () => void; onOpenSummary?: () => void;
}) {
  const vendors = useVendors(true);
  const { trainers, venues } = useTrainersVenues();
  const [editingVendor, setEditingVendor] = useState(false);
  const v = vendors.find(x => x.id === o.vendorId);
  const payTo = o.status === 'approved' && !o.summaryToken ? payToProblem(o, v) : '';
  return (
    <div className="space-y-4">
      <ul><OutRow o={o} viewer={viewer} context={isCompanyPayment(o) ? 'Company payment' : forText} /></ul>
      <div className="flex flex-wrap gap-2">
        {onOpenDeal && <button type="button" className={btnSecondary} onClick={onOpenDeal}>Open the deal <ArrowRight className="h-4 w-4" /></button>}
        {onOpenSummary && <button type="button" className={btnSecondary} onClick={onOpenSummary}>Open its payment summary <ArrowRight className="h-4 w-4" /></button>}
      </div>
      {o.status === 'approved' && problem && !o.summaryToken && (
        <div className="space-y-2 rounded-xl border border-attention/30 bg-attention-soft px-3 py-2.5">
          <p className="text-[15px] font-semibold text-attention">Can't go to accounts yet: {problem}</p>
          {payTo === 'No bank details yet' && (v
            ? !editingVendor && <button type="button" className={btnSecondary} onClick={() => setEditingVendor(true)}>Add bank details</button>
            : <p className="text-sm text-ink-soft">{isCompanyPayment(o) ? 'No vendor or payment details on this request: fix it and send it again, or ask a manager.' : "No vendor picked: pick one on the deal's checklist."}</p>)}
          {payTo && payTo !== 'No bank details yet' && <p className="text-sm text-ink-soft">A manager checks it in Admin work → Vendors.</p>}
        </div>
      )}
      {editingVendor && v && <VendorForm vendor={v} vendors={vendors} trainers={trainers} venues={venues} viewer={viewer} onSaved={() => setEditingVendor(false)} onCancel={() => setEditingVendor(false)} />}
      {o.status === 'approved' && <MarkPaid outs={[o]} viewer={viewer} label="Paid another way? Mark it paid" />}
      {o.status === 'paid' && (
        <div className="space-y-2">
          <h4 className="font-bold">Receipt</h4>
          <ReceiptList receipts={receipts} viewer={viewer} />
          <ReceiptDrop target={{ dealId: o.dealId, moneyInId: '', recordId: '', moneyOutId: o.id }} viewer={viewer} prompt={receipts.length ? 'Add another receipt' : 'Drop the payment receipt here, or click to choose'} />
        </div>
      )}
    </div>
  );
}

// Mark one or several approved payments paid (paid from the PDF, or another way). Accounts on the link click Payment made.
function MarkPaid({ outs, viewer, label }: { outs: MoneyOut[]; viewer: Viewer; label: string }) {
  const [opened, setOpened] = useState(false);
  const [pay, setPay] = useState({ date: todayIso(), ref: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    if (!pay.date) return setError('Enter the date it was paid.');
    setBusy(true); setError('');
    try {
      for (const o of outs) await updateDoc(doc(db, 'money_out', o.id), { status: 'paid', paidDate: pay.date, paidRef: pay.ref.trim(), paidById: viewer.id, paidByName: viewer.name });
      setOpened(false);
    } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };
  if (!outs.length) return null;
  if (!opened) return <button type="button" className={btnSecondary} onClick={() => setOpened(true)}><Check className="h-4 w-4" /> {label}</button>;
  return (
    <div className="space-y-2 rounded-xl border border-line px-3 py-2.5">
      <div className="flex flex-wrap items-end gap-2">
        <div><label className={small} htmlFor="mp-date">Paid on</label><input id="mp-date" type="date" value={pay.date} onChange={e => setPay(p => ({ ...p, date: e.target.value }))} className={input} /></div>
        <div className="min-w-[12rem] flex-1"><label className={small} htmlFor="mp-ref">Payment reference (optional)</label><input id="mp-ref" value={pay.ref} onChange={e => setPay(p => ({ ...p, ref: e.target.value }))} className={input} placeholder="Bank transfer ref" /></div>
        <button type="button" className={btnSecondary} onClick={() => setOpened(false)}>Cancel</button>
        <button type="button" disabled={busy} className={btnPrimary} onClick={save}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save</button>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}

// The side panel for one summary: what accounts see, each line (open it, take it off), mark all paid, cancel.
function SummaryDetail({ s, vendors, forText, viewer, onOpenPay, onGone }: {
  s: { token: string; all: MoneyOut[]; unpaid: MoneyOut[]; first: MoneyOut }; vendors: any[]; forText: (o: MoneyOut) => string; viewer: Viewer;
  onOpenPay: (o: MoneyOut) => void; onGone: () => void;
}) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const ref = refOf(s.first);
  const summary = buildSummary(s.all, vendors, forText);
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key); setError('');
    try { await fn(); } catch (e) { setError(friendlyError(e)); } finally { setBusy(''); }
  };
  const takeOff = (o: MoneyOut) => {
    if (!window.confirm(`Take ${o.payee} (${sen(o.amount)}) off this summary? Accounts will no longer see it on the link, so tell them not to pay it from the PDF either. It goes back to Ready for accounts.`)) return;
    return run(o.id, () => callServer('/api/pay-batch/remove', { id: o.id }, true));
  };
  const cancel = () => {
    if (!window.confirm('Cancel this summary? Its link stops working and its unpaid payments go back to Ready for accounts. Tell accounts not to use the PDF either.')) return;
    return run('cancel', async () => { await callServer('/api/pay-link/stop', { token: s.token }, true); onGone(); });
  };
  return (
    <div className="space-y-4">
      <p className="text-[15px] text-ink-soft">
        {s.unpaid.length} to pay, {s.all.length - s.unpaid.length} paid · {summary.groups.length} vendor{summary.groups.length === 1 ? '' : 's'} · {sen(summary.total)}
        {s.first.summaryAt ? ` · sent ${formatDate(new Date(s.first.summaryAt).toISOString())}${s.first.summaryByName ? ` by ${s.first.summaryByName}` : ''}` : ''}
      </p>
      <div className="flex flex-wrap gap-2"><SummaryButtons s={s} vendors={vendors} forText={forText} viewer={viewer} /></div>
      <ul className="divide-y divide-line rounded-xl border border-line">
        {s.all.map(o => (
          <li key={o.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
            <button type="button" className="min-w-0 flex-1 text-left hover:underline" onClick={() => onOpenPay(o)}>
              <span className="font-semibold">{o.payee}</span> <span className="text-sm text-ink-soft">· {o.category} · {isCompanyPayment(o) ? 'Company payment' : forText(o)}</span>
            </button>
            <span className="font-semibold tabular-nums">{sen(o.amount)}</span>
            {o.status === 'paid'
              ? <span className="rounded-md bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">Paid {formatDate(paidDay(o))}</span>
              : <button type="button" disabled={!!busy} className={btnTiny} onClick={() => takeOff(o)}>{busy === o.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Take off</button>}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <MarkPaid outs={s.unpaid} viewer={viewer} label={`Paid from the PDF? Mark all ${s.unpaid.length} paid`} />
        {s.unpaid.length > 0 && <button type="button" disabled={!!busy} className={`${btnSecondary} text-danger hover:bg-danger-soft`} onClick={cancel}>{busy === 'cancel' && <Loader2 className="h-4 w-4 animate-spin" />}Cancel summary</button>}
      </div>
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="overflow-x-auto rounded-lg border border-line bg-white">
        <div className="min-w-[680px]"><PaymentSummaryDocument summary={summary} refText={ref} madeBy={s.first.summaryByName || '—'} madeAt={s.first.summaryAt ? new Date(s.first.summaryAt).toISOString() : new Date().toISOString()} /></div>
      </div>
    </div>
  );
}

// ---------- History (Joel, 2026-10-26: "a list of past payment / approval / withdrawn") ----------
// Five tabs under the board. Each row says who raised, approved (or rejected) and paid it, with dates; paid ones since
// receipts started without a receipt are flagged. Search, month (with the total shown), sort and pages.
// Deleted holds approved or paid requests marked deleted (a request withdrawn while waiting is erased, so not listed).

type Summary = { token: string; all: MoneyOut[]; unpaid: MoneyOut[]; first: MoneyOut };
type HistTab = 'paid' | 'approved' | 'rejected' | 'deleted' | 'summaries';
type HistRow = { key: string; name: string; date: string; amount: number; search: string; o?: MoneyOut; s?: Summary };

const HIST_TABS: [HistTab, string][] = [['paid', 'Paid'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['deleted', 'Deleted'], ['summaries', 'Past summaries']];
const monthLabel = (m: string) => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }); };
const isoOf = (ms?: number) => (ms ? new Date(ms).toISOString() : '');

function History({ outs, deletedOuts, summaries, forText, noReceipt, onOpenPay, onOpenSummary }: {
  outs: MoneyOut[]; deletedOuts: MoneyOut[]; summaries: Summary[]; forText: (o: MoneyOut) => string;
  noReceipt: (o: MoneyOut) => boolean; onOpenPay: (o: MoneyOut) => void; onOpenSummary: (token: string) => void;
}) {
  const [tab, setTab] = useState<HistTab>('paid');
  const [q, setQ] = useState('');
  const [month, setMonth] = useState('');
  const [missing, setMissing] = useState(false);
  const [sort, setSort] = useState<ListSort>('newest');

  const outRow = (o: MoneyOut, date: string): HistRow => ({
    key: o.id, name: o.payee || '', date, amount: Number(o.amount) || 0, o,
    search: [o.payee, o.category, o.description, forText(o), paymentRef(o), o.requestedByName, o.decidedByName, o.paidByName, o.rejectReason, o.deletedReason].join(' ').toLowerCase(),
  });
  const rows: HistRow[] = useMemo(() => {
    if (tab === 'paid') return outs.filter(o => o.status === 'paid').map(o => outRow(o, paidDay(o)));
    if (tab === 'approved') return outs.filter(o => o.status === 'approved' || o.status === 'paid').map(o => outRow(o, o.decidedAt || ''));
    if (tab === 'rejected') return outs.filter(o => o.status === 'rejected').map(o => outRow(o, o.decidedAt || o.requestedAt || ''));
    if (tab === 'deleted') return deletedOuts.map(o => outRow(o, o.deletedAt || ''));
    return summaries.map(s => ({
      key: s.token, name: refOf(s.first), date: isoOf(s.first.summaryAt), amount: sum(s.all), s,
      search: [refOf(s.first), s.first.summaryByName, ...s.all.map(o => `${o.payee} ${forText(o)}`)].join(' ').toLowerCase(),
    }));
  }, [tab, outs, deletedOuts, summaries]);

  const months = [...new Set(rows.map(r => r.date.slice(0, 7)).filter(Boolean))].sort().reverse();
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = sortList(rows.filter(r =>
    (!month || r.date.slice(0, 7) === month)
    && words.every(w => r.search.includes(w))
    && (!missing || tab !== 'paid' || (!!r.o && noReceipt(r.o)))), sort, r => r.name, r => r.date);
  const paged = usePaged(shown, [tab, q, month, missing, sort]);
  const total = shown.reduce((t, r) => t + r.amount, 0);
  const pick = (t: HistTab) => { setTab(t); setMonth(''); setMissing(false); };

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-white" aria-label="Payment history">
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h4 className="text-base font-bold">History</h4>
          <div className="inline-flex flex-wrap rounded-lg border border-line bg-white p-0.5" role="tablist" aria-label="History">
            {HIST_TABS.map(([k, t]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => pick(k)}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold ${tab === k ? 'bg-accent text-white' : 'text-ink-soft hover:text-ink'}`}>{t}</button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[14rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search vendor, deal, reference or person" aria-label="Search history" className={`${input} pl-9`} />
          </label>
          <select value={month} onChange={e => setMonth(e.target.value)} className={listSelect} aria-label="Month">
            <option value="">All months</option>
            {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
          <SortSelect value={sort} onChange={setSort} />
          {tab === 'paid' && (
            <label className="flex items-center gap-1.5 text-sm text-ink">
              <input type="checkbox" checked={missing} onChange={e => setMissing(e.target.checked)} className="h-4 w-4 accent-[#0E6E62]" /> No receipt only
            </label>
          )}
        </div>
        <p className="text-sm text-ink-soft">
          {shown.length} {tab === 'summaries' ? `summar${shown.length === 1 ? 'y' : 'ies'}` : `payment${shown.length === 1 ? '' : 's'}`}
          {month ? ` in ${monthLabel(month)}` : ''} · total <strong className="tabular-nums text-ink">{sen(total)}</strong>
        </p>
      </div>
      {shown.length === 0
        ? <p className="border-t border-line px-4 py-4 text-sm text-ink-soft">Nothing here{q || month || missing ? ' for this search' : ' yet'}.</p>
        : (
          <ul className="divide-y divide-line border-t border-line">
            {paged.pageItems.map(r => r.s
              ? <SummaryRow key={r.key} s={r.s} onOpen={() => onOpenSummary(r.s!.token)} />
              : <HistoryRow key={r.key} o={r.o!} forText={forText(r.o!)} flag={tab === 'paid' || tab === 'approved' ? noReceipt(r.o!) : false}
                  showStatus={tab === 'approved'} onOpen={tab === 'deleted' ? undefined : () => onOpenPay(r.o!)} />)}
          </ul>
        )}
      <ListPager paged={paged} noun={tab === 'summaries' ? 'summaries' : 'payments'} />
    </section>
  );
}

function HistoryRow({ o, forText, flag, showStatus, onOpen }: {
  o: MoneyOut; forText: string; flag: boolean; showStatus: boolean; onOpen?: () => void; key?: string;
}) {
  const steps: string[] = [`Raised by ${o.requestedByName || '—'}, ${formatDate(o.requestDate || o.requestedAt)}`];
  if (o.status === 'rejected') steps.push(`${o.trainingCancelled ? 'Stopped' : 'Rejected'} by ${o.decidedByName || '—'}, ${formatDate(o.decidedAt || '')}${o.rejectReason ? `: ${o.rejectReason}` : ''}`);
  else if (o.decidedByName) steps.push(`Approved by ${o.decidedByName}, ${formatDate(o.decidedAt || '')}`);
  if (o.status === 'paid') steps.push(`Paid ${formatDate(paidDay(o))} by ${paidViaLink(o) ? ACCOUNTS_PAID_BY : o.paidByName || '—'}${o.paidRef ? ` (ref ${o.paidRef})` : ''}`);
  if (o.deleted) steps.push(`Deleted by ${o.deletedByName || '—'}, ${formatDate(o.deletedAt || '')}${o.deletedReason ? `: ${o.deletedReason}` : ''}`);
  const chip = 'rounded-md px-2 py-0.5 text-xs font-semibold';
  const body = (
    <>
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="min-w-0 break-words font-semibold">{o.payee || 'Not named'}</span>
        {showStatus && <span className={`${chip} ${o.status === 'paid' ? 'bg-accent-soft text-accent' : 'bg-surface text-ink-soft'}`}>{o.status === 'paid' ? 'Paid' : 'Not paid yet'}</span>}
        {o.trainingCancelled && <span className={`${chip} bg-surface text-ink-soft`}>Training cancelled</span>}
        {flag && <span className={`${chip} bg-attention-soft text-attention`}>No receipt</span>}
        <span className="ml-auto shrink-0 font-semibold tabular-nums">{sen(o.amount)}</span>
      </p>
      <p className="truncate text-sm text-ink-soft">{paymentRef(o)} · {o.category}{o.description ? `: ${o.description}` : ''} · {isCompanyPayment(o) ? 'Company payment' : forText}</p>
      <p className="text-sm text-ink-soft">{steps.join(' · ')}</p>
    </>
  );
  return (
    <li>
      {onOpen
        ? <button type="button" onClick={onOpen} className="block w-full px-4 py-2.5 text-left hover:bg-surface">{body}</button>
        : <div className="px-4 py-2.5">{body}</div>}
    </li>
  );
}

function SummaryRow({ s, onOpen }: { s: Summary; onOpen: () => void; key?: string }) {
  const lastPaid = s.all.map(paidDay).sort().pop() || '';
  return (
    <li>
      <button type="button" onClick={onOpen} className="block w-full px-4 py-2.5 text-left hover:bg-surface">
        <p className="flex items-baseline gap-2">
          <span className="font-semibold">{refOf(s.first)}</span>
          <span className="ml-auto font-semibold tabular-nums">{sen(sum(s.all))}</span>
        </p>
        <p className="truncate text-sm text-ink-soft">{s.all.length} payment{s.all.length === 1 ? '' : 's'} · {[...new Set(s.all.map(o => o.payee))].join(', ')}</p>
        <p className="text-sm text-ink-soft">
          Sent {formatDate(isoOf(s.first.summaryAt))}{s.first.summaryByName ? ` by ${s.first.summaryByName}` : ''}{lastPaid ? ` · all paid by ${formatDate(lastPaid)}` : ''}
        </p>
      </button>
    </li>
  );
}
