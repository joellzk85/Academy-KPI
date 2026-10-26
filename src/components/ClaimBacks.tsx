import React, { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { AlertTriangle, Check, Loader2, Plus, Trash2, Undo2 } from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import { daysUntil } from '../lib/checklist';
import { formatDate, formatRM, todayIso } from '../lib/deals';
import { MoneyOut, MoneySettings, OUT_STATUS_LABELS } from '../lib/money';
import { BehalfStatus, ClaimBack, behalfStatus, claimCopies, claimFor, claimPaid, claimReceipts, invoiceable } from '../lib/onBehalf';
import { Receipt, daysSinceTraining } from '../lib/postTraining';
import { withoutDeleted } from '../lib/linked';
import { askReason, deleteMoney, undoPayment, withDealHistory as withHistory } from '../lib/moneyActions';
import { useFormDraft } from '../lib/useFormDraft';
import DraftBar from './DraftBar';
import { ReceiptDrop, ReceiptList, ReceiptPick, receiptError, removeReceipt, uploadReceipts } from './PaymentReceipts';

// Claim back from client (Joel, 2026-10-22): costs we paid on the client's behalf (cost lines ticked "Pay on behalf
// of client" on the before-training checklist) are billed on a separate reimbursement invoice (claim_backs), then the
// client's payment is recorded with its receipt. The invoice's copy is uploaded too (2026-10-24, required on invoices
// made since). Logic: lib/onBehalf.ts. Admin and Management only.

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const small = 'mb-1 block text-sm font-medium text-ink-soft';
const btnPrimary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';
const btnSmall = `${btnSecondary} py-1.5`;
const num = (s: string) => Number(String(s).replace(/[^0-9.]/g, ''));
const round = (n: number) => Math.round(n * 100) / 100;

/** Reimbursement invoices, live: one deal's, or (no dealId) all of them. Admin and Management only. */
export function useClaimBacks(enabled: boolean, dealId?: string): ClaimBack[] {
  const [list, setList] = useState<ClaimBack[]>([]);
  useEffect(() => {
    if (!enabled) { setList([]); return; }
    const q = dealId ? query(collection(db, 'claim_backs'), where('dealId', '==', dealId)) : query(collection(db, 'claim_backs'));
    return onSnapshot(q, s => setList(withoutDeleted(s.docs.map(d => ({ ...(d.data() as ClaimBack), id: d.id })))), () => setList([]));
  }, [enabled, dealId]);
  return list;
}

/** After training, step 5: what was paid on the client's behalf, the reimbursement invoices and the payments back. */
export function ClaimBackStep({ deal, viewer, b, receipts, settings }: { deal: any; viewer: Viewer; b: BehalfStatus; receipts: Receipt[]; settings: MoneySettings }) {
  const [adding, setAdding] = useState(false);
  const ready = b.notInvoiced.filter(invoiceable);
  return (
    <div className="space-y-2.5">
      <ul className="space-y-1.5">
        {b.outs.map(o => {
          const c = claimFor(o, b.claims);
          return (
            <li key={o.id} className="flex flex-wrap items-baseline gap-x-2 rounded-lg border border-line bg-white px-3 py-2 text-[15px]">
              <span className="font-semibold">{o.description || o.category} · {o.payee}</span>
              <span className="tabular-nums">{formatRM(o.amount)}</span>
              <span className="text-sm text-ink-soft">we {o.status === 'paid' ? 'paid' : 'pay'}: {OUT_STATUS_LABELS[o.status].toLowerCase()}</span>
              <span className={`text-sm font-semibold ${c ? (claimPaid(c) ? 'text-accent' : 'text-ink-soft') : 'text-attention'}`}>
                {c ? (claimPaid(c) ? 'paid back' : `on invoice${c.invoiceNo ? ` ${c.invoiceNo}` : ''}`) : invoiceable(o) ? 'not claimed back yet' : 'claim back once approved'}
              </span>
            </li>
          );
        })}
      </ul>
      {b.claims.length > 0 && (
        <ul className="space-y-2">
          {[...b.claims].sort((x, y) => String(x.invoiceDate).localeCompare(String(y.invoiceDate))).map(c => (
            <ClaimRow key={c.id} c={c} viewer={viewer} receipts={claimReceipts(c, receipts)} copies={claimCopies(c, receipts)} outs={b.outs} settings={settings} />
          ))}
        </ul>
      )}
      {adding ? (
        <ClaimForm deal={deal} viewer={viewer} ready={ready} onDone={() => setAdding(false)} />
      ) : ready.length > 0 ? (
        <button type="button" className={btnPrimary} onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Record the reimbursement invoice ({formatRM(ready.reduce((t, o) => t + (Number(o.amount) || 0), 0))})</button>
      ) : null}
      <p className="text-sm text-ink-soft">Bill the client on a separate reimbursement invoice. These amounts are not in the training's P&L.</p>
    </div>
  );
}

function ClaimForm({ deal, viewer, ready, onDone }: { deal: any; viewer: Viewer; ready: MoneyOut[]; onDone: () => void }) {
  const [f, setF] = useState({ invoiceNo: '', invoiceDate: todayIso(), picked: ready.map(o => o.id), amount: '', note: '' });
  const draft = useFormDraft(viewer.id, `claim-back:${deal.id}`, f, setF);
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Draft ids that are no longer ready (e.g. invoiced since) are dropped.
  const picked = ready.filter(o => f.picked.includes(o.id));
  const total = round(picked.reduce((t, o) => t + (Number(o.amount) || 0), 0));
  const amount = f.amount === '' ? total : num(f.amount);
  const toggle = (id: string) => setF(x => ({ ...x, picked: x.picked.includes(id) ? x.picked.filter(p => p !== id) : [...x.picked, id], amount: '' }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!picked.length) return setError('Tick at least one cost to bill the client for.');
    if (!f.invoiceDate) return setError('Enter the invoice date.');
    if (!(amount > 0)) return setError('Enter the amount billed.');
    const id = `cb_${Date.now()}${Math.random().toString(36).slice(2, 5)}`;
    setBusy(true); setError('');
    let copies: Receipt[] = [];
    try {
      if (files.length) {
        setProgress('0%');
        try { copies = await uploadReceipts(files, { dealId: deal.id, moneyInId: '', recordId: '', claimBackId: id, kind: 'copy' }, viewer, setProgress); }
        catch (e) { throw new Error(receiptError(e)); }
        finally { setProgress(null); }
      }
      await withHistory(deal.id, viewer, `Reimbursement invoice${f.invoiceNo.trim() ? ` ${f.invoiceNo.trim()}` : ''} to the client: ${formatRM(amount)} paid on their behalf (${picked.map(o => o.description || o.category).join(', ')})`,
        batch => batch.set(doc(db, 'claim_backs', id), {
          id, dealId: deal.id, moneyOutIds: picked.map(o => o.id), invoiceNo: f.invoiceNo.trim(), invoiceDate: f.invoiceDate, amount: round(amount),
          paidDate: '', paidAmount: 0, paidAt: '', paidById: '', paidByName: '', note: f.note.trim(),
          copyNeeded: true, createdAt: Date.now(), createdById: viewer.id, createdByName: viewer.name,
        }));
      draft.clear();
      onDone();
    } catch (err) {
      await Promise.all(copies.map(c => removeReceipt(c).catch(() => {})));   // don't leave a copy without its invoice
      setError(err instanceof Error && !(err as any).code ? err.message : friendlyError(err));
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={save} className="space-y-3 rounded-xl border border-line bg-surface p-4">
      <p className="text-sm font-semibold">Reimbursement invoice to the client</p>
      <DraftBar draft={draft} what="reimbursement invoice" />
      <fieldset className="space-y-1">
        <legend className={small}>Costs on this invoice</legend>
        {ready.map(o => (
          <label key={o.id} className="flex items-center gap-2 text-[15px]">
            <input type="checkbox" checked={f.picked.includes(o.id)} onChange={() => toggle(o.id)} className="h-4 w-4 accent-[#0E6E62]" />
            {o.description || o.category} · {o.payee} <span className="tabular-nums text-ink-soft">{formatRM(o.amount)}</span>
          </label>
        ))}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        <div><label className={small} htmlFor="cb-no">Invoice no.</label><input id="cb-no" value={f.invoiceNo} onChange={e => setF(x => ({ ...x, invoiceNo: e.target.value }))} className={input} /></div>
        <div><label className={small} htmlFor="cb-date">Invoice date</label><input id="cb-date" type="date" value={f.invoiceDate} onChange={e => setF(x => ({ ...x, invoiceDate: e.target.value }))} className={input} /></div>
        <div><label className={small} htmlFor="cb-amt">Amount billed (RM)</label><input id="cb-amt" inputMode="decimal" value={f.amount === '' ? String(total) : f.amount} onChange={e => setF(x => ({ ...x, amount: e.target.value.replace(/[^0-9.]/g, '') }))} className={input} /></div>
      </div>
      {amount > 0 && Math.abs(amount - total) > 0.005 && <p className="text-sm text-attention">The costs add up to {formatRM(total)}; you're billing {formatRM(amount)}.</p>}
      <input value={f.note} onChange={e => setF(x => ({ ...x, note: e.target.value }))} className={input} placeholder="Note (optional)" aria-label="Note" />
      <ReceiptPick files={files} onFiles={setFiles} what="copy" label="Copy of the reimbursement invoice sent" />
      {!files.length && <p className="text-sm text-ink-soft">No copy at hand? Save now and add it later on the invoice; the case closes once it's in.</p>}
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <button type="button" className={btnSecondary} onClick={onDone}>Cancel</button>
        <button type="submit" disabled={busy} className={btnPrimary}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{progress !== null ? `Uploading… ${progress}` : 'Save'}</button>
      </div>
    </form>
  );
}

/** One reimbursement invoice, with "Record payment" (date, amount and the receipt) and its receipts. */
export function ClaimRow({ c, viewer, receipts, copies = [], outs, settings, context }: {
  c: ClaimBack; viewer: Viewer; receipts: Receipt[]; copies?: Receipt[]; outs: MoneyOut[]; settings?: MoneySettings; context?: string; key?: string;
}) {
  const [paying, setPaying] = useState(false);
  const [pay, setPay] = useState({ date: todayIso(), amount: String(c.amount) });
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const paid = claimPaid(c);
  const age = -(daysUntil(c.invoiceDate, todayIso()) ?? 0);
  const overdue = !paid && !!settings && age > settings.overdueDays;
  const items = outs.filter(o => (c.moneyOutIds || []).includes(o.id));
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };

  const recordPay = () => {
    const amount = num(pay.amount);
    if (!pay.date) return setError('Enter the date the money came in.');
    if (!(amount > 0)) return setError('Enter the amount received.');
    return run(async () => {
      if (files.length) {
        setProgress('0%');
        try { await uploadReceipts(files, { dealId: c.dealId, moneyInId: '', recordId: '', claimBackId: c.id }, viewer, setProgress); }
        catch (e) { setProgress(null); throw new Error(receiptError(e)); }
        setProgress(null);
      }
      await withHistory(c.dealId, viewer, `Client paid back ${formatRM(amount)} paid on their behalf${c.invoiceNo ? ` (invoice ${c.invoiceNo})` : ''}`,
        batch => batch.update(doc(db, 'claim_backs', c.id), { paidDate: pay.date, paidAmount: amount, paidAt: new Date().toISOString(), paidById: viewer.id, paidByName: viewer.name, updatedAt: Date.now() }));
      setFiles([]);
      setPaying(false);
    });
  };
  // Only Management undoes a payment; deleted invoices are kept, with a reason (process audit, 2026-10-22).
  const undo = () => {
    if (!window.confirm(`Undo the client's payment of ${formatRM(c.paidAmount || 0)}? It is noted in the deal's History.`)) return;
    return run(() => undoPayment('claim_backs', c, viewer, `reimbursement invoice${c.invoiceNo ? ` ${c.invoiceNo}` : ''}`));
  };
  const remove = () => {
    const reason = askReason(paid
      ? `Delete this reimbursement invoice? The client already paid it back (${formatRM(c.paidAmount || 0)}). Management can restore it later.\n\nWhy is it deleted?`
      : 'Delete this reimbursement invoice? Its costs go back to "not claimed back yet". Management can restore it later.\n\nWhy is it deleted?');
    if (!reason) return;
    return run(() => deleteMoney('claim_backs', c, viewer, `reimbursement invoice${c.invoiceNo ? ` ${c.invoiceNo}` : ''} (${formatRM(c.amount)}${paid ? `, paid back ${formatRM(c.paidAmount || 0)}` : ''})`, reason));
  };

  return (
    <li className={`rounded-xl border px-3.5 py-3 ${overdue ? 'border-danger/40 bg-danger-soft/50' : paid ? 'border-accent/25 bg-accent-soft/50' : 'border-line bg-white'}`}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          {context && <p className="text-sm font-semibold text-ink-soft">{context}</p>}
          <p className="font-semibold">Reimbursement invoice{c.invoiceNo ? ` ${c.invoiceNo}` : ''} · {formatRM(c.amount)}</p>
          <p className="text-sm text-ink-soft">
            Invoiced {formatDate(c.invoiceDate)}{items.length ? ` · for ${items.map(o => o.description || o.category).join(', ')}` : ''}{c.note ? ` · ${c.note}` : ''}
          </p>
          {paid
            ? <p className="text-sm text-accent">Paid back {formatRM(c.paidAmount || 0)} on {formatDate(c.paidDate || '')}{Number(c.paidAmount) < Number(c.amount) - 0.005 ? ` · ${formatRM(Number(c.amount) - Number(c.paidAmount))} less than billed` : ''}</p>
            : <p className={`text-sm ${overdue ? 'font-semibold text-danger' : 'text-ink-soft'}`}>{overdue && <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />}Not paid back yet ({age} day{age === 1 ? '' : 's'})</p>}
          {c.copyNeeded && !copies.length && <p className="text-sm font-semibold text-attention">Invoice copy not uploaded yet: the case closes once it's in.</p>}
          {paid && !!c.paidAt && !receipts.length && <p className="text-sm font-semibold text-attention">Receipt not uploaded yet: the case closes once it's in.</p>}
        </div>
        <span className="flex shrink-0 gap-1">
          {paid
            ? viewer.role === 'management' && <button type="button" disabled={busy} className={btnSmall} onClick={undo}><Undo2 className="h-3.5 w-3.5" /> Undo payment</button>
            : !paying && <button type="button" disabled={busy} className={btnSmall} onClick={() => { setPaying(true); setError(''); }}><Check className="h-3.5 w-3.5" /> Record payment</button>}
          {(!paid || viewer.role === 'management') && <button type="button" disabled={busy} className="rounded-md p-1.5 text-ink-soft hover:bg-surface hover:text-danger" onClick={remove} aria-label="Delete"><Trash2 className="h-4 w-4" /></button>}
        </span>
      </div>
      <ReceiptList receipts={copies} viewer={viewer} copyLabel="Invoice copy" />
      <ReceiptDrop target={{ dealId: c.dealId, moneyInId: '', recordId: '', claimBackId: c.id, kind: 'copy' }} viewer={viewer} small
        prompt={copies.length ? 'Add another invoice copy' : 'Upload the invoice copy'} />
      {paying && (
        <div className="mt-3 space-y-3 rounded-lg border border-line bg-white p-3">
          <ReceiptPick files={files} onFiles={setFiles} label="Receipt from the client" />
          <div className="flex flex-wrap items-end gap-2">
            <div><label className={small} htmlFor={`cbd-${c.id}`}>Received on</label><input id={`cbd-${c.id}`} type="date" value={pay.date} onChange={e => setPay(p => ({ ...p, date: e.target.value }))} className={input} /></div>
            <div><label className={small} htmlFor={`cba-${c.id}`}>Amount received (RM)</label><input id={`cba-${c.id}`} inputMode="decimal" value={pay.amount} onChange={e => setPay(p => ({ ...p, amount: e.target.value.replace(/[^0-9.]/g, '') }))} className={input} /></div>
            <button type="button" className={btnSecondary} onClick={() => { setPaying(false); setFiles([]); }}>Cancel</button>
            <button type="button" disabled={busy} className={btnPrimary} onClick={recordPay}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{progress !== null ? `Uploading… ${progress}` : 'Save'}</button>
          </div>
          {!files.length && <p className="text-sm text-ink-soft">No receipt yet? You can save now and upload it later; the case closes once it's in.</p>}
        </div>
      )}
      {paid && (
        <>
          <ReceiptList receipts={receipts} viewer={viewer} />
          <ReceiptDrop target={{ dealId: c.dealId, moneyInId: '', recordId: '', claimBackId: c.id }} viewer={viewer} small
            prompt={receipts.length ? 'Add another receipt' : 'Upload the receipt'} />
        </>
      )}
      {error && <p role="alert" className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
    </li>
  );
}

/** Admin work → Money: everything paid on clients' behalf that they still owe us, oldest training first. */
export function OwedByClients({ deals, outs, claims, receipts, settings, dealLabel, onOpenDeal }: {
  deals: any[]; outs: MoneyOut[]; claims: ClaimBack[]; receipts: Receipt[]; settings: MoneySettings;
  dealLabel: (dealId: string) => string; onOpenDeal?: (dealId: string) => void;
}) {
  const rows = deals
    .map(d => ({ d, b: behalfStatus(d.id, outs, claims, receipts) }))
    .filter(x => x.b.has && !x.b.done)
    .sort((x, y) => String(x.d.trainingDate || '9').localeCompare(String(y.d.trainingDate || '9')));
  const total = rows.reduce((t, x) => t + x.b.outstanding, 0);
  return (
    <section className="space-y-2">
      <h4 className="font-bold">Owed by clients <span className="font-normal text-ink-soft">(paid on their behalf{rows.length ? `: ${formatRM(total)}` : ''})</span></h4>
      {rows.length === 0 ? <p className="text-[15px] text-ink-soft">Nothing to claim back from clients.</p> : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-white">
          {rows.map(({ d, b }) => {
            const since = daysSinceTraining(d);
            const late = since !== null && since >= settings.behalfReminderDays;
            const status = b.notInvoiced.length ? 'Not claimed back yet' : b.unpaid.length ? 'Invoiced, waiting for the client' : 'Paid back, receipt to upload';
            return (
              <li key={d.id}>
                <button type="button" disabled={!onOpenDeal} onClick={() => onOpenDeal?.(d.id)} className="flex w-full flex-wrap items-baseline gap-x-3 px-3.5 py-2.5 text-left hover:bg-surface">
                  <span className="min-w-0 flex-1 text-[15px] font-semibold">{dealLabel(d.id)}</span>
                  <span className={`text-sm font-semibold ${b.notInvoiced.length && late ? 'text-danger' : 'text-attention'}`}>{status}</span>
                  <span className="font-semibold tabular-nums">{formatRM(b.outstanding)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-sm text-ink-soft">Tick "Pay on behalf of client" on a cost line in the Before training checklist. Claim it back in the deal's After training section. Turns red {settings.behalfReminderDays} days after the training.</p>
    </section>
  );
}
