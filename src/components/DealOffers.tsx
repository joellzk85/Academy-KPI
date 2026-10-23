import React, { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, query, updateDoc, where } from 'firebase/firestore';
import { BadgePercent, Check, Loader2, PartyPopper, X } from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import { canMoveDeal, dealValue, formatDate, formatRM } from '../lib/deals';
import {
  AcceptedOnline, DiscountRequest, acceptToConfirm, canDecideDiscount, discountPct, discountProblem, pendingDiscount,
} from '../lib/dealOffers';
import { CostEstimate, estimateResult } from '../lib/costEstimate';
import { gpLight } from '../lib/kpiLibrary';
import { isSuperManager, superConfirm } from '../lib/superManager';
import { askReason } from '../lib/moneyActions';

// Online acceptance and discount requests on a deal (Joel, 2026-10-23). Logic in lib/dealOffers.ts.

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };

const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';
const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const LIGHT_TEXT: Record<string, string> = { green: 'text-accent', amber: 'text-attention', red: 'text-danger', grey: 'text-ink-soft' };

const historyLine = (viewer: Viewer, action: string) => ({ at: new Date().toISOString(), byId: viewer.id, byName: viewer.name, action });
const gpText = (pct?: number | null) => (pct === null || pct === undefined ? '' : `${pct.toFixed(1)}%`);

function useRun() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<any>) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };
  return { busy, error, run };
}

/** The client accepted a package online: the owner confirms the amount (use it, or keep the deal as it is). */
export function AcceptedOnlineBox({ deal, viewer }: { deal: any; viewer: Viewer }) {
  const a = acceptToConfirm(deal);
  const { busy, error, run } = useRun();
  if (!a) return null;
  const can = canMoveDeal(deal, viewer);
  const priceDiffers = a.price !== null && Math.abs((a.price || 0) - dealValue(deal)) > 0.005;
  const paxDiffers = a.pax > 0 && a.pax !== Number(deal.participants || 0);
  const confirm = (choice: 'accepted' | 'kept') => run(() => {
    const done: AcceptedOnline = { ...a, confirmed: true, choice, confirmedByName: viewer.name, confirmedAt: new Date().toISOString() };
    const use = choice === 'accepted';
    const what = use ? [priceDiffers ? `value ${formatRM(a.price || 0)}` : '', paxDiffers ? `${a.pax} pax` : ''].filter(Boolean).join(' and ') : '';
    return updateDoc(doc(db, 'pipelines', deal.id), {
      acceptedOnline: done,
      ...(use && priceDiffers ? { proposalValue: a.price } : {}),
      ...(use && paxDiffers ? { participants: a.pax } : {}),
      history: [...(deal.history || []), historyLine(viewer, use
        ? `Confirmed the online acceptance${what ? `: ${what}` : ''}`
        : `Kept the deal at ${formatRM(dealValue(deal))} after the online acceptance`)],
    });
  });
  return (
    <div className="rounded-xl border-2 border-attention bg-attention-soft p-4">
      <p className="flex items-center gap-2 font-semibold"><PartyPopper className="h-4 w-4 text-attention" /> Client accepted online: confirm the amount</p>
      <p className="mt-1 text-[15px]">
        {a.name}{a.position ? `, ${a.position}` : ''} accepted{a.packageName ? ` package "${a.packageName}"` : ''}{a.pax ? ` for ${a.pax} pax` : ''}
        {a.price !== null ? ` at ${formatRM(a.price || 0)}` : ''} on {formatDate(new Date(a.at).toISOString().slice(0, 10))}.
      </p>
      <p className="mt-1 text-sm text-ink-soft">The deal is at {formatRM(dealValue(deal))}{deal.participants ? `, ${deal.participants} pax` : ''}. Clients often negotiate, so the deal only changes when you confirm.</p>
      {can ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={busy} className={btnPrimary} onClick={() => confirm('accepted')}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {priceDiffers || paxDiffers ? `Use ${[priceDiffers ? formatRM(a.price || 0) : '', paxDiffers ? `${a.pax} pax` : ''].filter(Boolean).join(' and ')}` : 'Confirm, the deal already matches'}
          </button>
          {(priceDiffers || paxDiffers) && <button type="button" disabled={busy} className={btnSecondary} onClick={() => confirm('kept')}>Keep {formatRM(dealValue(deal))}</button>}
        </div>
      ) : <p className="mt-2 text-sm text-ink-soft">The deal owner confirms it.</p>}
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}

/** A discount waiting for approval, or just decided, on the deal panel. Managers approve or reject it here. */
export function DiscountBox({ deal, viewer }: { deal: any; viewer: Viewer }) {
  const r = deal?.discountRequest as DiscountRequest | undefined;
  const { busy, error, run } = useRun();
  if (!r || r.status === 'withdrawn') return null;
  const decidedLongAgo = r.status !== 'pending' && r.decidedAt && Date.now() - Date.parse(r.decidedAt) > 14 * 864e5;
  if (decidedLongAgo) return null;
  const decide = canDecideDiscount(r, viewer);
  const now = () => new Date().toISOString();
  const approve = () => {
    if (r.byId === viewer.id && isSuperManager(viewer) && !superConfirm('approve your own discount request.', 'Nobody else checks this price before it reaches the client.')) return;
    return run(() => updateDoc(doc(db, 'pipelines', deal.id), {
      discountRequest: { ...r, status: 'approved', decidedById: viewer.id, decidedByName: viewer.name, decidedAt: now() },
      proposalValue: r.toValue,
      history: [...(deal.history || []), historyLine(viewer, `Approved the discount: ${formatRM(r.fromValue)} to ${formatRM(r.toValue)} (${discountPct(r).toFixed(1)}% off)`)],
    }));
  };
  const reject = () => {
    const why = askReason('Why is this discount rejected? The rep sees this.');
    if (!why) return;
    return run(() => updateDoc(doc(db, 'pipelines', deal.id), {
      discountRequest: { ...r, status: 'rejected', decidedById: viewer.id, decidedByName: viewer.name, decidedAt: now(), rejectReason: why },
      history: [...(deal.history || []), historyLine(viewer, `Rejected the discount to ${formatRM(r.toValue)}: ${why}`)],
    }));
  };
  const withdraw = () => run(() => updateDoc(doc(db, 'pipelines', deal.id), {
    discountRequest: { ...r, status: 'withdrawn' },
    history: [...(deal.history || []), historyLine(viewer, 'Withdrew the discount request')],
  }));
  const tone = r.status === 'pending' ? 'border-attention bg-attention-soft' : r.status === 'approved' ? 'border-accent/40 bg-accent-soft' : 'border-danger/40 bg-danger-soft';
  return (
    <div className={`rounded-xl border-2 p-4 ${tone}`}>
      <p className="flex items-center gap-2 font-semibold"><BadgePercent className="h-4 w-4" />
        {r.status === 'pending' ? 'Discount waiting for a manager' : r.status === 'approved' ? `Discount approved by ${r.decidedByName}` : `Discount rejected by ${r.decidedByName}`}
      </p>
      <p className="mt-1 text-[15px]">{formatRM(r.fromValue)} to <strong>{formatRM(r.toValue)}</strong> ({discountPct(r).toFixed(1)}% off) on {r.quoteRef || 'the quotation'} · asked by {r.byName}</p>
      <p className="text-sm text-ink-soft">Why: {r.reason}</p>
      <GpLine r={r} />
      {r.status === 'rejected' && r.rejectReason && <p className="mt-1 text-sm text-danger">Reason: {r.rejectReason}</p>}
      {r.status === 'approved' && <p className="mt-1 text-sm text-ink-soft">The deal value is now {formatRM(r.toValue)}. Set the quotation to this price, then send it.</p>}
      {r.status === 'pending' && (
        <div className="mt-3 flex flex-wrap gap-2">
          {decide && <button type="button" disabled={busy} className={btnPrimary} onClick={approve}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Approve discount</button>}
          {decide && <button type="button" disabled={busy} className={btnSecondary} onClick={reject}><X className="h-4 w-4" /> Reject</button>}
          {r.byId === viewer.id && <button type="button" disabled={busy} className={btnSecondary} onClick={withdraw}>Withdraw</button>}
          {!decide && r.byId !== viewer.id && <p className="text-sm text-ink-soft">A manager approves it{viewer.role === 'management' ? ' (not the person who asked)' : ''}.</p>}
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}

function GpLine({ r }: { r: DiscountRequest }) {
  if (r.gpTo === null || r.gpTo === undefined) return <p className="mt-1 text-sm text-ink-soft">No Costing estimate linked, so no GP % to compare.</p>;
  return (
    <p className="mt-1 text-sm">
      GP from {r.estimateTitle ? `"${r.estimateTitle}"` : 'the Costing estimate'}: <span className={LIGHT_TEXT[gpLight(r.gpFrom || 0)]}>{gpText(r.gpFrom)}</span> now,{' '}
      <strong className={LIGHT_TEXT[gpLight(r.gpTo)]}>{gpText(r.gpTo)}</strong> at the new price
    </p>
  );
}

/** The rep's Costing estimates (Admin and Management see all), for the GP % of a discount. */
function useEstimates(viewer: Viewer) {
  const [list, setList] = useState<CostEstimate[]>([]);
  useEffect(() => {
    const q = viewer.role === 'rep' ? query(collection(db, 'cost_estimates'), where('ownerId', '==', viewer.id)) : query(collection(db, 'cost_estimates'));
    return onSnapshot(q, s => setList(s.docs.map(d => ({ ...(d.data() as CostEstimate), id: d.id }))), () => setList([]));
  }, [viewer.id, viewer.role]);
  return list;
}

/** "Request discount" on a quotation priced below the deal value. */
export function RequestDiscountBox({ deal, quoteId, quoteRef, price, viewer, onOpenEstimator, onClose }: {
  deal: any; quoteId: string; quoteRef: string; price: number; viewer: Viewer; onOpenEstimator?: () => void; onClose: () => void;
}) {
  const estimates = useEstimates(viewer);
  const [toValue, setToValue] = useState(price > 0 ? String(price) : '');
  const [reason, setReason] = useState('');
  const [estimateId, setEstimateId] = useState('');
  const { busy, error, run } = useRun();
  const [problem, setProblem] = useState('');
  const fromValue = dealValue(deal);
  const est = estimates.find(e => e.id === estimateId) || null;
  const to = Number(toValue);
  const gpFrom = est ? estimateResult(est, fromValue).gpPct : null;
  const gpTo = est && to > 0 ? estimateResult(est, to).gpPct : null;
  const send = () => {
    const p = discountProblem(fromValue, to, reason);
    if (p) return setProblem(p);
    setProblem('');
    if (pendingDiscount(deal)) return setProblem('A discount is already waiting for approval on this deal.');
    const req: DiscountRequest = {
      id: `disc_${Date.now()}`, quoteId, quoteRef, fromValue, toValue: to, reason: reason.trim(),
      byId: viewer.id, byName: viewer.name, at: new Date().toISOString(), status: 'pending',
      ...(est ? { estimateId: est.id, estimateTitle: est.title || '', gpFrom: Math.round((gpFrom || 0) * 10) / 10, gpTo: Math.round((gpTo || 0) * 10) / 10 } : { gpFrom: null, gpTo: null }),
    };
    return run(async () => {
      await updateDoc(doc(db, 'pipelines', deal.id), {
        discountRequest: req,
        history: [...(deal.history || []), historyLine(viewer, `Asked for a discount: ${formatRM(fromValue)} to ${formatRM(to)} (${discountPct(req).toFixed(1)}% off) on ${quoteRef}`)],
      });
      onClose();
    });
  };
  return (
    <div className="space-y-3 rounded-xl border-2 border-attention bg-attention-soft p-4">
      <p className="flex items-center gap-2 font-semibold"><BadgePercent className="h-4 w-4" /> Request a discount</p>
      <p className="text-sm text-ink-soft">The deal value is {formatRM(fromValue)}. A manager approves the new price before this quotation can be sent; Admin and Management see the request on My home.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm font-semibold" htmlFor="disc-to">New price (RM, before SST)</label>
          <input id="disc-to" inputMode="decimal" value={toValue} onChange={e => setToValue(e.target.value.replace(/[^0-9.]/g, ''))} className={input} />
          {to > 0 && to < fromValue && <p className="mt-0.5 text-sm text-ink-soft">{(((fromValue - to) / fromValue) * 100).toFixed(1)}% off</p>}
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-semibold" htmlFor="disc-est">Costing estimate (for the GP %)</label>
          <select id="disc-est" value={estimateId} onChange={e => setEstimateId(e.target.value)} className={input}>
            <option value="">None linked</option>
            {estimates.map(e => <option key={e.id} value={e.id}>{e.title || 'Untitled estimate'}{e.clientName ? ` · ${e.clientName}` : ''}</option>)}
          </select>
          {est ? (
            <p className="mt-0.5 text-sm">GP <span className={LIGHT_TEXT[gpLight(gpFrom || 0)]}>{gpText(gpFrom)}</span> now, <strong className={LIGHT_TEXT[gpLight(gpTo || 0)]}>{gpText(gpTo)}</strong> at the new price</p>
          ) : onOpenEstimator ? (
            <button type="button" className="mt-0.5 text-sm font-semibold text-accent hover:underline" onClick={onOpenEstimator}>No estimate yet? Open the Costing estimator</button>
          ) : null}
        </div>
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-semibold" htmlFor="disc-why">Why does the client need it?</label>
        <textarea id="disc-why" rows={2} value={reason} onChange={e => setReason(e.target.value)} className={`${input} resize-y`} placeholder="e.g. Budget capped at RM 16,000; repeat client" />
      </div>
      {(problem || error) && <p role="alert" className="text-sm text-danger">{problem || error}</p>}
      <div className="flex gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>Cancel</button>
        <button type="button" disabled={busy} className={btnPrimary} onClick={send}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Send for approval</button>
      </div>
    </div>
  );
}
