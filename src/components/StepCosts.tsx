import React, { useState } from 'react';
import { doc, setDoc, updateDoc, writeBatch, getDoc } from 'firebase/firestore';
import { AlertTriangle, Check, Loader2, Plus, Trash2, X } from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import { formatDate, todayIso } from '../lib/deals';
import { MoneyOut, OUT_STATUS_LABELS, OutStatus, OutTiming, TIMING_LABELS, canDecide, inPL } from '../lib/money';
import { ChecklistTask, costCategory, materialItems } from '../lib/checklist';
import { STEP_VENDOR_TYPE, Vendor, bankText, hasBank, vendorName } from '../lib/vendors';
import { Receipt } from '../lib/postTraining';
import { useFormDraft } from '../lib/useFormDraft';
import DraftBar from './DraftBar';
import { VendorForm } from './VendorsPage';
import { ReceiptDrop, ReceiptList } from './PaymentReceipts';

// Costs on a before-training checklist step (Joel, 2026-10-20: "able to key in amount, e.g. bus RM 5,000 + upload
// document; all these amounts automated into the training P&L and into payment requests, payable to different
// vendors, approved by Management, then sent to accounts as a summary").
// Each cost line is a payment request (money_out) on the deal, with the step (checklistTaskId), the vendor
// (vendorId, bank details in Vendors) and Pre-training / Post-training timing. So it shows in the deal's P&L and
// Project P&L straight away (waiting for approval), follows the usual approval rule (a manager, never your own),
// and once approved it can go on a payment summary for accounts (Admin work → Money). Its receipt is uploaded here.
// Admin and Management only (reps can't read money_out).

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const small = 'mb-1 block text-sm font-medium text-ink-soft';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';
const btnSmall = `${btnSecondary} py-1 px-2.5`;

const TONE: Record<OutStatus, string> = {
  pending: 'bg-attention-soft text-attention',
  approved: 'bg-[#E8EEF8] text-[#2B4A7E]',
  rejected: 'bg-danger-soft text-danger',
  paid: 'bg-accent-soft text-accent',
};
export const sen = (n: number) => 'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (s: string) => Number(String(s).replace(/[^0-9.]/g, ''));

// Quick descriptions per step (Joel: "Booking and final payment").
function quickWords(t: ChecklistTask): string[] {
  if (t.kind === 'venue' || t.kind === 'bus') return ['Booking', 'Final payment'];
  if (t.kind === 'trainer') return ['Trainer fee'];
  if (t.kind === 'facilitator') return ['Facilitator fee'];
  if (t.kind === 'materials') return materialItems(t).map(i => i.label);
  return [];
}
// The trainer is paid after training (Joel's example); everything else defaults to before.
const defaultTiming = (t: ChecklistTask): OutTiming => (t.kind === 'trainer' ? 'after' : 'before');

/** Who the vendor is for this step's trainer or venue (picked on the checklist), to suggest or create. */
export type VendorHint = { type: Vendor['type']; trainerId?: string; venueId?: string; name?: string };

export default function StepCosts({ deal, task, viewer, outs, receipts, vendors, trainers, venues, hint }: {
  deal: any; task: ChecklistTask; viewer: Viewer; outs: MoneyOut[]; receipts: Receipt[];
  vendors: Vendor[]; trainers: any[]; venues: any[]; hint?: VendorHint;
}) {
  const lines = outs.filter(o => o.checklistTaskId === task.id).sort((a, b) => String(a.requestedAt).localeCompare(String(b.requestedAt)));
  const [adding, setAdding] = useState(false);
  const counted = lines.filter(o => (o.status === 'approved' || o.status === 'paid') && inPL(o)).reduce((t, o) => t + (Number(o.amount) || 0), 0);
  const waiting = lines.filter(o => o.status === 'pending' && inPL(o)).reduce((t, o) => t + (Number(o.amount) || 0), 0);

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <p className="text-sm font-semibold">Costs</p>
        {lines.length > 0 && (
          <p className="text-sm text-ink-soft">In the P&L {sen(counted)}{waiting > 0 && ` · waiting for approval ${sen(waiting)}`}{lines.some(o => !inPL(o)) && ` · not in the P&L ${sen(lines.filter(o => !inPL(o) && o.status !== 'rejected').reduce((t, o) => t + (Number(o.amount) || 0), 0))}`}</p>
        )}
      </div>
      {lines.length > 0 && (
        <ul className="space-y-1.5">
          {lines.map(o => <CostLine key={o.id} o={o} viewer={viewer} vendors={vendors} trainers={trainers} venues={venues} receipts={receipts.filter(r => r.moneyOutId === o.id)} />)}
        </ul>
      )}
      {adding ? (
        <CostForm deal={deal} task={task} viewer={viewer} vendors={vendors} trainers={trainers} venues={venues} hint={hint} lines={lines} onDone={() => setAdding(false)} />
      ) : (
        <button type="button" className={btnSmall} onClick={() => setAdding(true)}><Plus className="h-3.5 w-3.5" /> Add a cost</button>
      )}
    </div>
  );
}

function CostLine({ o, viewer, vendors, trainers, venues, receipts }: {
  o: MoneyOut; viewer: Viewer; vendors: Vendor[]; trainers: any[]; venues: any[]; receipts: Receipt[]; key?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const vendor = vendors.find(v => v.id === o.vendorId);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };
  const decide = canDecide(o, viewer);
  const mine = o.requestedById === viewer.id;
  const approve = () => run(() => updateDoc(doc(db, 'money_out', o.id), { status: 'approved', decidedById: viewer.id, decidedByName: viewer.name, decidedAt: new Date().toISOString(), rejectReason: '' }));
  const reject = () => {
    const reason = window.prompt('Why is it rejected?');
    if (!reason?.trim()) return;
    return run(() => updateDoc(doc(db, 'money_out', o.id), { status: 'rejected', decidedById: viewer.id, decidedByName: viewer.name, decidedAt: new Date().toISOString(), rejectReason: reason.trim() }));
  };
  const remove = () => {
    const settled = o.status === 'approved' || o.status === 'paid';
    if (!window.confirm(settled ? `Delete this ${OUT_STATUS_LABELS[o.status].toLowerCase()} cost? The P&L changes. This can't be undone.` : 'Delete this cost?')) return;
    return run(async () => {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'money_out', o.id));
      const d = await getDoc(doc(db, 'pipelines', o.dealId));
      if (d.exists()) {
        const entry = { at: new Date().toISOString(), byId: viewer.id, byName: viewer.name, action: `Deleted cost: ${o.category} · ${o.payee} · ${o.description || ''} (${sen(o.amount)}, ${OUT_STATUS_LABELS[o.status].toLowerCase()})` };
        batch.update(d.ref, { history: [...((d.data() as any).history || []), entry].slice(-40) });
      }
      await batch.commit();
    });
  };
  const canDelete = viewer.role === 'management' || (mine && (o.status === 'pending' || o.status === 'rejected'));

  return (
    <li className="rounded-lg border border-line bg-white px-3 py-2">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-[12rem] flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-[15px]">
            <span className="font-semibold">{o.description || o.category}</span>
            <span className="text-ink-soft">· {vendor ? vendorName(vendor, trainers, venues) : o.payee}</span>
            <span className="font-semibold tabular-nums">· {sen(o.amount)}</span>
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="rounded border border-line px-1.5 py-0.5 font-medium text-ink-soft">{TIMING_LABELS[o.timing] || TIMING_LABELS.after}</span>
            <span className={`rounded px-1.5 py-0.5 font-semibold ${TONE[o.status]}`}>{OUT_STATUS_LABELS[o.status]}</span>
            {o.decidedByName && <span className="text-ink-soft">{o.status === 'rejected' ? 'rejected' : 'approved'} by {o.decidedByName}{o.status === 'rejected' && o.rejectReason ? `: ${o.rejectReason}` : ''}</span>}
            {o.status === 'paid' && <span className="text-ink-soft">paid {formatDate(o.paidDate || '')}{o.paidRef ? `, ref ${o.paidRef}` : ''}</span>}
            {o.status === 'pending' && mine && <span className="text-attention">{viewer.role === 'management' ? 'the other manager approves' : 'a manager approves'}</span>}
          </p>
          {o.status !== 'rejected' && o.status !== 'paid' && (!vendor || !hasBank(vendor)) && (
            <p className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-attention"><AlertTriangle className="h-3.5 w-3.5" /> No bank details for this vendor yet (Admin work → Vendors)</p>
          )}
          {vendor && hasBank(vendor) && o.status !== 'paid' && <p className="mt-0.5 text-xs text-ink-soft">{bankText(vendor)}</p>}
        </div>
        <span className="flex shrink-0 flex-wrap items-center gap-1">
          {o.status !== 'rejected' && <PLTick o={o} viewer={viewer} />}
          {decide && <button type="button" disabled={busy} className={`${btnPrimary} px-2.5 py-1`} onClick={approve}><Check className="h-3.5 w-3.5" /> Approve</button>}
          {decide && <button type="button" disabled={busy} className={`${btnSmall} text-danger hover:bg-danger-soft`} onClick={reject}><X className="h-3.5 w-3.5" /> Reject</button>}
          {canDelete && <button type="button" disabled={busy} onClick={remove} className="rounded-md p-1.5 text-ink-soft hover:bg-danger-soft hover:text-danger" aria-label="Delete this cost">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}</button>}
        </span>
      </div>
      {o.status === 'paid' && (
        <>
          <ReceiptList receipts={receipts} viewer={viewer} />
          <ReceiptDrop target={{ dealId: o.dealId, moneyInId: '', recordId: '', moneyOutId: o.id }} viewer={viewer} small
            prompt={receipts.length ? 'Add another receipt' : 'Upload the payment receipt'} />
        </>
      )}
      {error && <p role="alert" className="mt-1 text-sm text-danger">{error}</p>}
    </li>
  );
}

function CostForm({ deal, task, viewer, vendors, trainers, venues, hint, lines = [], onDone }: {
  deal: any; task: ChecklistTask; viewer: Viewer; vendors: Vendor[]; trainers: any[]; venues: any[]; hint?: VendorHint; lines?: MoneyOut[]; onDone: () => void;
}) {
  const vType = STEP_VENDOR_TYPE[task.kind] || 'other';
  const hinted = hint && vendors.find(v => (hint.trainerId && v.trainerId === hint.trainerId) || (hint.venueId && v.venueId === hint.venueId));
  // "Include in P&L" starts unticked (Joel, 2026-10-21).
  const [f, setF] = useState({ description: '', amount: '', timing: defaultTiming(task), vendorId: hinted?.id || '', inPL: false });
  const draft = useFormDraft(viewer.id, `cost:${deal.id}:${task.id}`, f, setF);
  const [newVendor, setNewVendor] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const words = quickWords(task);

  // The step's own type first, then everyone else, A to Z.
  const named = vendors.map(v => ({ v, name: vendorName(v, trainers, venues) }));
  const first = named.filter(x => x.v.type === vType).sort((a, b) => a.name.localeCompare(b.name));
  const rest = named.filter(x => x.v.type !== vType).sort((a, b) => a.name.localeCompare(b.name));
  const vendor = vendors.find(v => v.id === f.vendorId);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = num(f.amount);
    if (!f.description.trim()) return setError('Say what it is for, e.g. Booking.');
    if (!(amount > 0)) return setError('Enter the amount, for example 5000.');
    if (!vendor) return setError('Pick who is paid, or add a new vendor.');
    // No double payment by mistake (2026-10-21): this vendor already has a cost on this step?
    const same = lines.filter(o => o.vendorId === vendor.id && o.status !== 'rejected');
    if (same.length && !window.confirm(`${vendorName(vendor, trainers, venues)} already has ${same.length} cost line${same.length === 1 ? '' : 's'} on this step (${same.map(o => `${o.description || o.category} RM ${Number(o.amount).toFixed(2)}`).join(', ')}).\n\nAdd another one anyway (e.g. a balance payment)?`)) return;
    const id =`out_${Date.now()}${Math.random().toString(36).slice(2, 5)}`;
    setBusy(true); setError('');
    try {
      await setDoc(doc(db, 'money_out', id), {
        id, dealId: deal.id, kind: 'deal', category: costCategory(task), payee: vendorName(vendor, trainers, venues), vendorId: vendor.id,
        description: f.description.trim(), amount: Math.round(amount * 100) / 100, timing: f.timing, inPL: !!f.inPL, checklistTaskId: task.id, requestDate: todayIso(),
        status: 'pending', requestedById: viewer.id, requestedByName: viewer.name, requestedByRole: viewer.role, requestedAt: new Date().toISOString(),
        decidedById: '', decidedByName: '', decidedAt: '', rejectReason: '', paidDate: '', paidRef: '', paidById: '', paidByName: '',
      });
      draft.clear();
      onDone();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  if (newVendor) {
    return (
      <VendorForm vendors={vendors} trainers={trainers} venues={venues} viewer={viewer}
        start={{ type: hint?.type || vType, trainerId: hint?.trainerId, venueId: hint?.venueId, name: hint?.name || '' }}
        onSaved={v => { setF(x => ({ ...x, vendorId: v.id })); setNewVendor(false); }} onCancel={() => setNewVendor(false)} />
    );
  }

  return (
    <form onSubmit={save} className="space-y-3 rounded-xl border border-line bg-surface p-3">
      <DraftBar draft={draft} what="cost" />
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
        <div>
          <label className={small} htmlFor={`cd-${task.id}`}>What for</label>
          <input id={`cd-${task.id}`} value={f.description} onChange={e => setF(x => ({ ...x, description: e.target.value }))} className={input}
            placeholder={words[0] ? `e.g. ${words[0]}` : 'What it is for'} />
          {words.length > 0 && (
            <span className="mt-1 flex flex-wrap gap-1">
              {words.map(w => (
                <button key={w} type="button" onClick={() => setF(x => ({ ...x, description: w }))}
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${f.description === w ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-white text-ink-soft hover:text-ink'}`}>{w}</button>
              ))}
            </span>
          )}
        </div>
        <div>
          <label className={small} htmlFor={`ca-${task.id}`}>Amount (RM)</label>
          <input id={`ca-${task.id}`} inputMode="decimal" value={f.amount} onChange={e => setF(x => ({ ...x, amount: e.target.value.replace(/[^0-9.]/g, '') }))} className={input} placeholder="5000" />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={small} htmlFor={`cv-${task.id}`}>Pay to (vendor)</label>
          <select id={`cv-${task.id}`} value={f.vendorId} onChange={e => e.target.value === '__new' ? setNewVendor(true) : setF(x => ({ ...x, vendorId: e.target.value }))} className={input}>
            <option value="">Pick a vendor</option>
            {first.length > 0 && <optgroup label={`${task.label} vendors`}>{first.map(x => <option key={x.v.id} value={x.v.id}>{x.name}</option>)}</optgroup>}
            {rest.length > 0 && <optgroup label="Other vendors">{rest.map(x => <option key={x.v.id} value={x.v.id}>{x.name}</option>)}</optgroup>}
            <option value="__new">+ New vendor{hint?.name && !hinted ? ` (${hint.name})` : ''}…</option>
          </select>
          {vendor && <span className={`mt-0.5 block text-xs ${hasBank(vendor) ? 'text-ink-soft' : 'font-semibold text-attention'}`}>{hasBank(vendor) ? bankText(vendor) : 'No bank details yet: add them in Admin work → Vendors.'}</span>}
        </div>
        <div>
          <span className={small}>When it's paid</span>
          <div className="flex gap-2">
            {(['before', 'after'] as OutTiming[]).map(k => (
              <button key={k} type="button" aria-pressed={f.timing === k} onClick={() => setF(x => ({ ...x, timing: k }))}
                className={`flex-1 rounded-lg border px-2 py-2 text-sm font-semibold ${f.timing === k ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-white text-ink-soft hover:bg-surface'}`}>{TIMING_LABELS[k]}</button>
            ))}
          </div>
        </div>
      </div>
      <label className="flex items-center gap-2 text-[15px]">
        <input type="checkbox" checked={!!f.inPL} onChange={e => setF(x => ({ ...x, inPL: e.target.checked }))} className="h-4 w-4 accent-[#0E6E62]" />
        Include in P&L <span className="text-sm text-ink-soft">(count it as a cost of this training; can be changed later)</span>
      </label>
      <p className="text-sm text-ink-soft">It waits for {viewer.role === 'management' ? 'the other manager' : 'a manager'} to approve it, then goes on the payment summary for accounts.</p>
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <button type="button" className={btnSecondary} onClick={onDone}>Cancel</button>
        <button type="submit" disabled={busy} className={btnPrimary}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Add cost</button>
      </div>
    </form>
  );
}

/** "Include in P&L" tick beside a cost (Joel, 2026-10-21). Unticked = still a payment to approve and pay, but not a
 *  cost in the training's P&L. Admin and Management change it at any status; each change goes into the deal's History. */
export function PLTick({ o, viewer }: { o: MoneyOut; viewer: Viewer }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const on = inPL(o);
  const change = async (next: boolean) => {
    setBusy(true); setError('');
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'money_out', o.id), { inPL: next });
      const d = o.dealId ? await getDoc(doc(db, 'pipelines', o.dealId)) : null;
      if (d?.exists()) {
        const entry = { at: new Date().toISOString(), byId: viewer.id, byName: viewer.name, action: `${next ? 'Included in' : 'Left out of'} the P&L: ${o.category} · ${o.payee}${o.description ? ` · ${o.description}` : ''} (${sen(o.amount)})` };
        batch.update(d.ref, { history: [...((d.data() as any).history || []), entry].slice(-40) });
      }
      await batch.commit();
    } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };
  if (viewer.role === 'rep') return null;
  return (
    <label className={`inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-semibold ${on ? 'border-accent/40 bg-accent-soft text-accent' : 'border-line bg-white text-ink-soft'}`}
      title="Ticked: counted as a cost in this training's P&L. Unticked: still paid, but not in the P&L.">
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <input type="checkbox" checked={on} disabled={busy} onChange={e => change(e.target.checked)} className="h-3.5 w-3.5 accent-[#0E6E62]" />}
      Include in P&L
      {error && <span role="alert" className="ml-1 font-normal text-danger">{error}</span>}
    </label>
  );
}
