import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, onSnapshot, query, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { AlertTriangle, Check, Download, Loader2, MessageCircle, Plus, Trash2, Undo2, X } from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import { pdfErrorText } from '../lib/oldTab';
import { dealValue, formatDate, formatRM, todayIso } from '../lib/deals';
import {
  COMPANY_CATEGORIES, DEFAULT_MONEY_SETTINGS, IN_SOURCE_LABELS, InSource, MoneyIn, MoneyOut, MoneySettings, OUT_CATEGORIES, OUT_STATUS_LABELS, OutStatus, OutTiming,
  canDecide, dealPL, expectedFor, isCompanyPayment, isPaid, itemsTotal, readMoneySettings, shortfall,
} from '../lib/money';
import { daysUntil } from '../lib/checklist';
import { linkedOnly, withoutDeleted } from '../lib/linked';
import { onPhone } from '../lib/whatsapp';
import PaymentRequestDocument, { paymentRef, paymentStatusText } from './PaymentRequestDocument';

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const small = 'mb-1 block text-sm font-medium text-ink-soft';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';
const btnSmall = `${btnSecondary} py-1.5`;

const OUT_TONE: Record<OutStatus, string> = {
  pending: 'bg-attention-soft text-attention',
  approved: 'bg-[#E8EEF8] text-[#2B4A7E]',
  rejected: 'bg-danger-soft text-danger',
  paid: 'bg-accent-soft text-accent',
};

const isHrdcDeal = (d: any) => d?.fundingType === 'hrdc' || d?.fundingType === 'hrdc_topup';
const billsClient = (d: any) => d?.fundingType === 'direct' || d?.fundingType === 'hrdc_topup';
const num = (s: string) => Number(String(s).replace(/[^0-9.]/g, ''));
const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
// Company payments are often small, so they show sen (formatRM rounds to whole ringgit).
const formatSen = (n: number) => 'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function useMoneySettings(): MoneySettings {
  const [s, setS] = useState<MoneySettings>(DEFAULT_MONEY_SETTINGS);
  useEffect(() => onSnapshot(doc(db, 'config', 'money_settings'), d => setS(readMoneySettings(d.data())), () => setS(DEFAULT_MONEY_SETTINGS)), []);
  return s;
}

function useRun() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try { await fn(); } catch (err) { setError(friendlyError(err)); } finally { setBusy(false); }
  };
  return { busy, error, setError, run };
}

// Delete a money record and say so in its deal's History (Joel, 2026-10-20: Management can delete any money
// record, paid ones included, so the deal keeps a trail of what was deleted, by whom and when).
async function deleteMoney(coll: 'money_in' | 'money_out', id: string, dealId: string, viewer: Viewer, what: string) {
  const batch = writeBatch(db);
  batch.delete(doc(db, coll, id));
  if (dealId) {
    const d = await getDoc(doc(db, 'pipelines', dealId));
    if (d.exists()) {
      const entry = { at: new Date().toISOString(), byId: viewer.id, byName: viewer.name, action: `Deleted ${what}` };
      batch.update(d.ref, { history: [...((d.data() as any).history || []), entry].slice(-40) });
    }
  }
  await batch.commit();
}

// ---------- Rep view: status only ----------
export function RepMoneyStatus({ deal, ins }: { deal: any; ins: MoneyIn[] }) {
  const line = (source: InSource) => {
    const list = ins.filter(m => m.source === source);
    if (!list.length) return source === 'hrdc' ? 'Not submitted yet' : 'Not sent yet';
    if (list.every(isPaid)) return `Paid ${formatDate(list[list.length - 1].paidDate || '')}`;
    return `${source === 'hrdc' ? 'Submitted' : 'Sent'} ${formatDate(list[0].invoiceDate)}, waiting for payment`;
  };
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[15px]">
      {isHrdcDeal(deal) && <div><dt className="text-sm text-ink-soft">HRDC claim</dt><dd className="font-semibold">{line('hrdc')}</dd></div>}
      {billsClient(deal) && <div><dt className="text-sm text-ink-soft">Client invoice</dt><dd className="font-semibold">{line('client')}</dd></div>}
      {!isHrdcDeal(deal) && !billsClient(deal) && <p className="col-span-2 text-sm text-ink-soft">Set how the deal is paid to see its payment status.</p>}
    </dl>
  );
}

// ---------- Full money panel for one deal (Admin and Management) ----------
export default function MoneyPanel({ deal, viewer, ins, outs, settings }: {
  deal: any; viewer: Viewer; ins: MoneyIn[]; outs: MoneyOut[]; settings: MoneySettings;
}) {
  const pl = dealPL(ins, outs, settings);
  const [addingIn, setAddingIn] = useState<InSource | null>(null);
  const [addingOut, setAddingOut] = useState(false);

  return (
    <div className="space-y-5">
      {/* P&L */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Invoiced and claimed" value={formatRM(pl.invoiced)} />
        <Stat label={`HRDC ${settings.hrdcDeductionPct}% and costs`} value={formatRM(pl.hrdcFee + pl.shortfall + pl.costs)} />
        <Stat label="Profit" value={formatRM(pl.profit)} tone={pl.profit < 0 ? 'danger' : 'accent'} />
        <Stat label="Received so far" value={formatRM(pl.received)} />
      </div>
      <p className="text-sm text-ink-soft">
        Still to come in: <strong className="text-ink">{formatRM(pl.toComeIn)}</strong> · Still to pay out: <strong className="text-ink">{formatRM(pl.toPayOut)}</strong>
        {pl.pendingApproval > 0 && <> · Waiting for approval (not counted yet): <strong className="text-ink">{formatRM(pl.pendingApproval)}</strong></>}
        {pl.invoiced === 0 && dealValue(deal) > 0 && <> · Deal value {formatRM(dealValue(deal))}, nothing invoiced or claimed yet</>}
      </p>

      {/* Money in */}
      <section className="space-y-2">
        <h5 className="text-sm font-bold uppercase tracking-wide text-ink-soft">Money in</h5>
        {ins.length === 0 && !addingIn && <p className="text-[15px] text-ink-soft">No claim or invoice recorded yet.</p>}
        <ul className="space-y-2">
          {ins.map(m => <InRow key={m.id} m={m} viewer={viewer} settings={settings} />)}
        </ul>
        {addingIn ? (
          <InForm deal={deal} source={addingIn} viewer={viewer} settings={settings} onDone={() => setAddingIn(null)} />
        ) : (
          <div className="flex flex-wrap gap-2">
            {isHrdcDeal(deal) && <button type="button" className={btnSecondary} onClick={() => setAddingIn('hrdc')}><Plus className="h-4 w-4" /> Record HRDC claim</button>}
            <button type="button" className={btnSecondary} onClick={() => setAddingIn('client')}><Plus className="h-4 w-4" /> Record client invoice</button>
          </div>
        )}
      </section>

      {/* Money out */}
      <section className="space-y-2">
        <h5 className="text-sm font-bold uppercase tracking-wide text-ink-soft">Money out</h5>
        {outs.length === 0 && !addingOut && <p className="text-[15px] text-ink-soft">No payment requests yet.</p>}
        <ul className="space-y-2">
          {[...outs].sort((a, b) => String(a.requestedAt).localeCompare(String(b.requestedAt))).map(o => <OutRow key={o.id} o={o} viewer={viewer} docFor={`${deal.client || 'Client'} · ${deal.courseName || 'Training'}`} />)}
        </ul>
        {addingOut ? (
          <OutForm deal={deal} viewer={viewer} onDone={() => setAddingOut(false)} />
        ) : (
          <button type="button" className={btnSecondary} onClick={() => setAddingOut(true)}><Plus className="h-4 w-4" /> Request a payment</button>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'danger' | 'accent' }) {
  return (
    <div className="rounded-xl border border-line bg-white px-3 py-2.5">
      <p className="text-xs font-semibold text-ink-soft">{label}</p>
      <p className={`mt-0.5 text-lg font-bold tabular-nums ${tone === 'danger' ? 'text-danger' : tone === 'accent' ? 'text-accent' : 'text-ink'}`}>{value}</p>
    </div>
  );
}

// ---------- Money in ----------
function InForm({ deal, source, viewer, settings, onDone }: { deal: any; source: InSource; viewer: Viewer; settings: MoneySettings; onDone: () => void }) {
  const [f, setF] = useState({ invoiceNo: '', invoiceDate: todayIso(), amount: dealValue(deal) ? String(dealValue(deal)) : '', note: '' });
  const { busy, error, setError, run } = useRun();
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = num(f.amount);
    if (!f.invoiceDate) return setError(source === 'hrdc' ? 'Enter the date the claim was submitted.' : 'Enter the invoice date.');
    if (!(amount > 0)) return setError('Enter the amount, for example 15000.');
    const id = `in_${Date.now()}`;
    return run(async () => {
      await setDoc(doc(db, 'money_in', id), {
        id, dealId: deal.id, source, invoiceNo: f.invoiceNo.trim(), invoiceDate: f.invoiceDate, amount, paidDate: '', paidAmount: 0, note: f.note.trim(),
        createdAt: Date.now(), createdById: viewer.id, createdByName: viewer.name,
      });
      onDone();
    });
  };
  const amt = num(f.amount);
  return (
    <form onSubmit={save} className="space-y-3 rounded-xl border border-line bg-surface p-4">
      <p className="text-sm font-semibold">{source === 'hrdc' ? 'HRDC claim' : 'Client invoice'}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className={small} htmlFor="mi-no">{source === 'hrdc' ? 'Claim / invoice no.' : 'Invoice no.'}</label><input id="mi-no" value={f.invoiceNo} onChange={e => setF(x => ({ ...x, invoiceNo: e.target.value }))} className={input} /></div>
        <div><label className={small} htmlFor="mi-date">{source === 'hrdc' ? 'Submitted on' : 'Invoice date'}</label><input id="mi-date" type="date" value={f.invoiceDate} onChange={e => setF(x => ({ ...x, invoiceDate: e.target.value }))} className={input} /></div>
        <div><label className={small} htmlFor="mi-amt">{source === 'hrdc' ? 'Amount claimed (RM)' : 'Amount (RM)'}</label><input id="mi-amt" inputMode="decimal" value={f.amount} onChange={e => setF(x => ({ ...x, amount: e.target.value.replace(/[^0-9.]/g, '') }))} className={input} /></div>
      </div>
      {source === 'hrdc' && amt > 0 && <p className="text-sm text-ink-soft">HRDC keeps {settings.hrdcDeductionPct}%, so we expect {formatRM(amt * (1 - settings.hrdcDeductionPct / 100))}.</p>}
      <input value={f.note} onChange={e => setF(x => ({ ...x, note: e.target.value }))} className={input} placeholder="Note (optional)" aria-label="Note" />
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <button type="button" className={btnSecondary} onClick={onDone}>Cancel</button>
        <button type="submit" disabled={busy} className={btnPrimary}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save</button>
      </div>
    </form>
  );
}

export function InRow({ m, viewer, settings, context }: { m: MoneyIn; viewer: Viewer; settings: MoneySettings; context?: string; key?: string }) {
  const [paying, setPaying] = useState(false);
  const [pay, setPay] = useState({ date: todayIso(), amount: String(Math.round(expectedFor(m, settings) * 100) / 100) });
  const { busy, error, setError, run } = useRun();
  const paid = isPaid(m);
  const gap = shortfall(m, settings);
  const age = -(daysUntil(m.invoiceDate, todayIso()) ?? 0);
  const overdue = !paid && age > settings.overdueDays;

  const recordPay = () => {
    const amount = num(pay.amount);
    if (!pay.date) return setError('Enter the date the money came in.');
    if (!(amount > 0)) return setError('Enter the amount received.');
    return run(async () => {
      await updateDoc(doc(db, 'money_in', m.id), { paidDate: pay.date, paidAmount: amount, paidById: viewer.id, paidByName: viewer.name, updatedAt: Date.now() });
      setPaying(false);
    });
  };
  const undo = () => run(() => updateDoc(doc(db, 'money_in', m.id), { paidDate: '', paidAmount: 0, updatedAt: Date.now() }));
  const remove = () => {
    const label = IN_SOURCE_LABELS[m.source].toLowerCase();
    if (!window.confirm(paid
      ? `Delete this ${label}? It has been paid (${formatRM(m.paidAmount || 0)}), so the deal's P&L and Project P&L change. This can't be undone.`
      : `Delete this ${label}?`)) return;
    const what = `${label}${m.invoiceNo ? ` ${m.invoiceNo}` : ''} (${formatRM(m.amount)}${paid ? `, paid ${formatRM(m.paidAmount || 0)}` : ''})`;
    return run(() => deleteMoney('money_in', m.id, m.dealId, viewer, what));
  };

  return (
    <li className={`rounded-xl border px-3.5 py-3 ${gap || overdue ? 'border-danger/40 bg-danger-soft/50' : paid ? 'border-accent/25 bg-accent-soft/50' : 'border-line bg-white'}`}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          {context && <p className="text-sm font-semibold text-ink-soft">{context}</p>}
          <p className="font-semibold">{IN_SOURCE_LABELS[m.source]}{m.invoiceNo ? ` ${m.invoiceNo}` : ''} · {formatRM(m.amount)}</p>
          <p className="text-sm text-ink-soft">
            {m.source === 'hrdc' ? 'Submitted' : 'Invoiced'} {formatDate(m.invoiceDate)}
            {m.source === 'hrdc' && ` · expect ${formatRM(expectedFor(m, settings))}`}
            {m.note ? ` · ${m.note}` : ''}
          </p>
          {paid ? (
            <p className={`text-sm ${gap ? 'font-semibold text-danger' : 'text-accent'}`}>
              Received {formatRM(m.paidAmount || 0)} on {formatDate(m.paidDate || '')}{gap ? ` · ${formatRM(gap)} less than expected` : ''}
            </p>
          ) : (
            <p className={`text-sm ${overdue ? 'font-semibold text-danger' : 'text-ink-soft'}`}>{overdue && <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />}Not paid yet ({age} day{age === 1 ? '' : 's'})</p>
          )}
        </div>
        <span className="flex shrink-0 gap-1">
          {paid
            ? <button type="button" disabled={busy} className={btnSmall} onClick={undo}><Undo2 className="h-3.5 w-3.5" /> Undo payment</button>
            : !paying && <button type="button" disabled={busy} className={btnSmall} onClick={() => { setPaying(true); setError(''); }}><Check className="h-3.5 w-3.5" /> Record payment</button>}
          {(!paid || viewer.role === 'management') && <button type="button" disabled={busy} className="rounded-md p-1.5 text-ink-soft hover:bg-surface hover:text-danger" onClick={remove} aria-label="Delete"><Trash2 className="h-4 w-4" /></button>}
        </span>
      </div>
      {paying && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div><label className={small} htmlFor={`pd-${m.id}`}>Received on</label><input id={`pd-${m.id}`} type="date" value={pay.date} onChange={e => setPay(p => ({ ...p, date: e.target.value }))} className={input} /></div>
          <div><label className={small} htmlFor={`pa-${m.id}`}>Amount received (RM)</label><input id={`pa-${m.id}`} inputMode="decimal" value={pay.amount} onChange={e => setPay(p => ({ ...p, amount: e.target.value.replace(/[^0-9.]/g, '') }))} className={input} /></div>
          <button type="button" className={btnSecondary} onClick={() => setPaying(false)}>Cancel</button>
          <button type="button" disabled={busy} className={btnPrimary} onClick={recordPay}>Save</button>
        </div>
      )}
      {error && <p role="alert" className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
    </li>
  );
}

// ---------- Money out ----------
function OutForm({ deal, viewer, onDone }: { deal: any; viewer: Viewer; onDone: () => void }) {
  const [f, setF] = useState({ category: 'Trainer', payee: '', description: '', amount: '', timing: 'after' as OutTiming });
  const { busy, error, setError, run } = useRun();
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = num(f.amount);
    if (!f.payee.trim()) return setError('Enter who is being paid.');
    if (!(amount > 0)) return setError('Enter the amount, for example 2500.');
    const id = `out_${Date.now()}`;
    return run(async () => {
      await setDoc(doc(db, 'money_out', id), {
        id, dealId: deal.id, category: f.category, payee: f.payee.trim(), description: f.description.trim(), amount, timing: f.timing,
        status: 'pending', requestedById: viewer.id, requestedByName: viewer.name, requestedByRole: viewer.role, requestedAt: new Date().toISOString(),
        decidedById: '', decidedByName: '', decidedAt: '', rejectReason: '', paidDate: '', paidRef: '', paidById: '', paidByName: '',
      });
      onDone();
    });
  };
  return (
    <form onSubmit={save} className="space-y-3 rounded-xl border border-line bg-surface p-4">
      <p className="text-sm font-semibold">Request a payment</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={small} htmlFor="mo-cat">What for</label>
          <select id="mo-cat" value={f.category} onChange={e => setF(x => ({ ...x, category: e.target.value }))} className={input}>
            {OUT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div><label className={small} htmlFor="mo-payee">Pay to</label><input id="mo-payee" value={f.payee} onChange={e => setF(x => ({ ...x, payee: e.target.value }))} className={input} placeholder="Name of person or company" /></div>
        <div><label className={small} htmlFor="mo-amt">Amount (RM)</label><input id="mo-amt" inputMode="decimal" value={f.amount} onChange={e => setF(x => ({ ...x, amount: e.target.value.replace(/[^0-9.]/g, '') }))} className={input} /></div>
        <div>
          <span className={small}>When</span>
          <div className="flex gap-2">
            {([['before', 'Deposit before training'], ['after', 'After training']] as const).map(([k, t]) => (
              <button key={k} type="button" aria-pressed={f.timing === k} onClick={() => setF(x => ({ ...x, timing: k }))}
                className={`flex-1 rounded-lg border px-2 py-2 text-sm font-semibold ${f.timing === k ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-white text-ink-soft hover:bg-surface'}`}>{t}</button>
            ))}
          </div>
        </div>
      </div>
      <input value={f.description} onChange={e => setF(x => ({ ...x, description: e.target.value }))} className={input} placeholder="Details (optional), e.g. 2 days, 50% deposit" aria-label="Details" />
      <p className="text-sm text-ink-soft">{viewer.role === 'management' ? 'The other manager must approve this before it can be paid.' : 'A manager must approve this before it can be paid.'}</p>
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <button type="button" className={btnSecondary} onClick={onDone}>Cancel</button>
        <button type="submit" disabled={busy} className={btnPrimary}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Send for approval</button>
      </div>
    </form>
  );
}

// ---------- Payment request PDF: download, or share to WhatsApp (Joel, 2026-10-18) ----------
// The PDF tools load only when someone makes one, like quotations.
async function paymentPdf(o: MoneyOut, forText: string): Promise<{ blob: Blob; name: string }> {
  const { makeDocumentPdf } = await import('../lib/quotePdf');
  const blob = await makeDocumentPdf(React.createElement(PaymentRequestDocument, { o, forText }), `Payment request ${paymentRef(o)}`);
  const name = `Payment request ${paymentRef(o)} - ${String(o.payee || '').replace(/[\\/:*?"<>|]+/g, '').slice(0, 60)}.pdf`;
  return { blob, name };
}

function paymentWaText(o: MoneyOut, forText: string): string {
  return [
    `Payment request ${paymentRef(o)}`,
    `${o.category} · ${forText}`,
    `Pay to: ${o.payee}`,
    `Total: ${formatSen(o.amount)}`,
    `Status: ${paymentStatusText(o)}`,
    '',
    '(PDF attached)',
  ].join('\n');
}

async function saveBlob(blob: Blob, name: string) {
  const { downloadBlob } = await import('../lib/quotePdf');
  downloadBlob(blob, name);
}

function PaymentShare({ o, forText }: { o: MoneyOut; forText: string }) {
  const [busy, setBusy] = useState<'' | 'pdf' | 'wa'>('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [ready, setReady] = useState<File | null>(null);   // phone: PDF made, share needs one more tap

  const download = async () => {
    setBusy('pdf'); setMsg(null);
    try { const { blob, name } = await paymentPdf(o, forText); await saveBlob(blob, name); }
    catch (e) { setMsg({ ok: false, text: pdfErrorText(e) }); }
    finally { setBusy(''); }
  };

  const share = async (file: File) => {
    try {
      await navigator.share({ files: [file], text: paymentWaText(o, forText), title: `Payment request ${paymentRef(o)}` });
      setReady(null);
      setMsg({ ok: true, text: 'Shared. Check it went to the right chat in WhatsApp.' });
    } catch (e: any) {
      if (e?.name === 'AbortError') return setReady(null);              // closed the share menu
      if (e?.name === 'NotAllowedError') return setReady(file);          // took too long: ask for one more tap
      setReady(null);
      setMsg({ ok: false, text: 'Your phone could not open the share menu. Use PDF instead and attach it in WhatsApp.' });
    }
  };

  const whatsapp = async () => {
    setMsg(null);
    const phone = onPhone() && typeof navigator.share === 'function';
    // Computer: open WhatsApp first (straight from the click, so it isn't blocked); you pick the chat.
    if (!phone) window.open(`https://wa.me/?text=${encodeURIComponent(paymentWaText(o, forText))}`, '_blank', 'noopener');
    setBusy('wa');
    try {
      const { blob, name } = await paymentPdf(o, forText);
      const file = new File([blob], name, { type: 'application/pdf' });
      if (phone && navigator.canShare?.({ files: [file] })) { await share(file); return; }
      await saveBlob(blob, name);
      setMsg({ ok: true, text: phone
        ? 'The PDF was downloaded. Open WhatsApp, pick the chat and attach it (📎, Document).'
        : `WhatsApp opened: pick the chat, then drag "${name}" from your downloads into it and press send.` });
    } catch (e) {
      setMsg({ ok: false, text: `The PDF could not be made: ${friendlyError(e)}` });
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      <button type="button" disabled={!!busy} className={btnSmall} onClick={download} title="Download as PDF">
        {busy === 'pdf' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} PDF
      </button>
      <button type="button" disabled={!!busy} className={btnSmall} onClick={whatsapp} title="Send the PDF by WhatsApp">
        {busy === 'wa' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageCircle className="h-3.5 w-3.5" />} WhatsApp
      </button>
      {(ready || msg) && (
        <span className="basis-full">
          {ready && <button type="button" className={`${btnPrimary} mt-1 py-1.5`} onClick={() => share(ready)}><MessageCircle className="h-3.5 w-3.5" /> PDF ready: share now</button>}
          {msg && <span role="status" className={`mt-1 block rounded-lg px-2.5 py-1.5 text-sm ${msg.ok ? 'bg-accent-soft text-accent' : 'bg-danger-soft text-danger'}`}>{msg.text}</span>}
        </span>
      )}
    </>
  );
}

export function OutRow({ o, viewer, context, docFor }: { o: MoneyOut; viewer: Viewer; context?: string; docFor?: string; key?: string }) {
  const [mode, setMode] = useState<null | 'reject' | 'pay'>(null);
  const [reason, setReason] = useState('');
  const [pay, setPay] = useState({ date: todayIso(), ref: '' });
  const { busy, error, setError, run } = useRun();
  const decide = canDecide(o, viewer);
  const isMine = o.requestedById === viewer.id;
  const company = isCompanyPayment(o);
  const forText = company ? 'Company payment' : docFor || context || 'Training';

  const approve = () => run(() => updateDoc(doc(db, 'money_out', o.id), clean({ status: 'approved', decidedById: viewer.id, decidedByName: viewer.name, decidedAt: new Date().toISOString(), rejectReason: '' })));
  const reject = () => {
    if (!reason.trim()) return setError('Say briefly why it is rejected.');
    return run(async () => {
      await updateDoc(doc(db, 'money_out', o.id), { status: 'rejected', decidedById: viewer.id, decidedByName: viewer.name, decidedAt: new Date().toISOString(), rejectReason: reason.trim() });
      setMode(null);
    });
  };
  const markPaid = () => {
    if (!pay.date) return setError('Enter the date it was paid.');
    return run(async () => {
      await updateDoc(doc(db, 'money_out', o.id), { status: 'paid', paidDate: pay.date, paidRef: pay.ref.trim(), paidById: viewer.id, paidByName: viewer.name });
      setMode(null);
    });
  };
  const undoPaid = () => run(() => updateDoc(doc(db, 'money_out', o.id), { status: 'approved', paidDate: '', paidRef: '', paidById: '', paidByName: '' }));
  const cancel = () => {
    const settled = o.status === 'approved' || o.status === 'paid';
    if (!window.confirm(settled
      ? `Delete this ${o.status} payment request? ${o.status === 'paid' ? 'It has been paid, so the' : 'The'} P&L changes. This can't be undone.`
      : 'Cancel this payment request?')) return;
    const what = `payment request: ${o.category} · ${o.payee} (${company ? formatSen(o.amount) : formatRM(o.amount)}, ${OUT_STATUS_LABELS[o.status].toLowerCase()})`;
    return run(() => deleteMoney('money_out', o.id, o.dealId || '', viewer, what));
  };

  return (
    <li className="rounded-xl border border-line bg-white px-3.5 py-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-[14rem] flex-1">
          {context && <p className="text-sm font-semibold text-ink-soft">{context}</p>}
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            {o.category} · {o.payee} · {company ? formatSen(o.amount) : formatRM(o.amount)}
            <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${OUT_TONE[o.status]}`}>{OUT_STATUS_LABELS[o.status]}</span>
            {!company && <span className="rounded-md border border-line px-2 py-0.5 text-xs font-medium text-ink-soft">{o.timing === 'before' ? 'Deposit before training' : 'After training'}</span>}
          </p>
          {company && (o.items || []).length > 0 && (
            <ul className="mt-1 text-sm text-ink">
              {(o.items || []).map((it, i) => (
                <li key={i} className="flex gap-2"><span className="min-w-0 flex-1">{it.description}{Number(it.qty) !== 1 ? ` × ${it.qty}` : ''}</span><span className="tabular-nums">{formatSen(Number(it.qty) * Number(it.price))}</span></li>
              ))}
            </ul>
          )}
          {o.description && <p className="text-sm text-ink-soft">{o.description}</p>}
          {company && o.neededBy && <p className="text-sm text-ink-soft">Needed by {formatDate(o.neededBy)}</p>}
          {company && o.paymentDetails && <p className="text-sm text-ink-soft">Payment details: {o.paymentDetails}</p>}
          <p className="text-sm text-ink-soft">
            Requested by {o.requestedByName} on {formatDate(o.requestDate || o.requestedAt)}
            {o.decidedByName && ` · ${o.status === 'rejected' ? 'rejected' : 'approved'} by ${o.decidedByName} on ${formatDate(o.decidedAt || '')}`}
            {o.status === 'rejected' && o.rejectReason ? `: ${o.rejectReason}` : ''}
            {o.status === 'paid' && ` · paid ${formatDate(o.paidDate || '')}${o.paidRef ? ` (ref ${o.paidRef})` : ''} by ${o.paidByName}`}
          </p>
          {o.status === 'pending' && isMine && <p className="text-sm text-attention">{viewer.role === 'management' ? 'Waiting for the other manager to approve.' : 'Waiting for a manager to approve.'}</p>}
        </div>
        {viewer.role !== 'rep' && !mode && (
          <span className="flex max-w-full shrink-0 flex-wrap justify-end gap-1 sm:max-w-[22rem]">
            <PaymentShare o={o} forText={forText} />
            {decide && <button type="button" disabled={busy} className={`${btnPrimary} py-1.5`} onClick={approve}><Check className="h-3.5 w-3.5" /> Approve</button>}
            {decide && <button type="button" disabled={busy} className={`${btnSmall} text-danger hover:bg-danger-soft`} onClick={() => { setMode('reject'); setError(''); }}><X className="h-3.5 w-3.5" /> Reject</button>}
            {o.status === 'approved' && <button type="button" disabled={busy} className={btnSmall} onClick={() => { setMode('pay'); setError(''); }}><Check className="h-3.5 w-3.5" /> Mark paid</button>}
            {o.status === 'paid' && <button type="button" disabled={busy} className={btnSmall} onClick={undoPaid}><Undo2 className="h-3.5 w-3.5" /> Undo paid</button>}
            {(viewer.role === 'management' || ((o.status === 'pending' || o.status === 'rejected') && isMine)) && (
              <button type="button" disabled={busy} className="rounded-md p-1.5 text-ink-soft hover:bg-surface hover:text-danger" onClick={cancel} aria-label="Cancel request"><Trash2 className="h-4 w-4" /></button>
            )}
          </span>
        )}
      </div>
      {mode === 'reject' && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <input value={reason} onChange={e => setReason(e.target.value)} className={`${input} min-w-[14rem] flex-1`} placeholder="Why it is rejected" aria-label="Reason for rejecting" />
          <button type="button" className={btnSecondary} onClick={() => setMode(null)}>Cancel</button>
          <button type="button" disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white hover:bg-[#931C13]" onClick={reject}>Reject</button>
        </div>
      )}
      {mode === 'pay' && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div><label className={small} htmlFor={`op-${o.id}`}>Paid on</label><input id={`op-${o.id}`} type="date" value={pay.date} onChange={e => setPay(p => ({ ...p, date: e.target.value }))} className={input} /></div>
          <div className="min-w-[12rem] flex-1"><label className={small} htmlFor={`or-${o.id}`}>Payment reference (optional)</label><input id={`or-${o.id}`} value={pay.ref} onChange={e => setPay(p => ({ ...p, ref: e.target.value }))} className={input} placeholder="e.g. bank transfer ref" /></div>
          <button type="button" className={btnSecondary} onClick={() => setMode(null)}>Cancel</button>
          <button type="button" disabled={busy} className={btnPrimary} onClick={markPaid}>Save</button>
        </div>
      )}
      {error && <p role="alert" className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
    </li>
  );
}

// ---------- Company payments: not tied to a training (Joel, 2026-10-18) ----------
// Stored in money_out with dealId '' and kind 'company', so the same approval rules apply.
type ItemDraft = { description: string; qty: string; price: string };
const blankItem = (): ItemDraft => ({ description: '', qty: '1', price: '' });

function CompanyForm({ viewer, onDone }: { viewer: Viewer; onDone: () => void }) {
  const [f, setF] = useState({ requestDate: todayIso(), category: COMPANY_CATEGORIES[0], payee: '', info: '', neededBy: '', paymentDetails: '' });
  const [items, setItems] = useState<ItemDraft[]>([blankItem()]);
  const { busy, error, setError, run } = useRun();
  const parsed = items.map(i => ({ description: i.description.trim(), qty: num(i.qty), price: num(i.price) }));
  const total = itemsTotal(parsed);
  const setItem = (i: number, ch: Partial<ItemDraft>) => setItems(list => list.map((x, j) => (j === i ? { ...x, ...ch } : x)));

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const used = parsed.filter((it, i) => it.description || items[i].price.trim());
    if (!f.requestDate) return setError('Enter the date of request.');
    if (!f.payee.trim()) return setError('Enter who is being paid.');
    if (!used.length) return setError('Add at least one item.');
    if (used.some(it => !it.description)) return setError('Every item needs a description.');
    if (used.some(it => !(it.qty > 0) || !(it.price > 0))) return setError('Every item needs a quantity and a price, for example 1 and 250.');
    const amount = itemsTotal(used);
    const id = `out_${Date.now()}`;
    return run(async () => {
      await setDoc(doc(db, 'money_out', id), {
        id, dealId: '', kind: 'company', category: f.category, payee: f.payee.trim(), description: f.info.trim(), amount, timing: 'before',
        requestDate: f.requestDate, items: used, neededBy: f.neededBy, paymentDetails: f.paymentDetails.trim(),
        status: 'pending', requestedById: viewer.id, requestedByName: viewer.name, requestedByRole: viewer.role, requestedAt: new Date().toISOString(),
        decidedById: '', decidedByName: '', decidedAt: '', rejectReason: '', paidDate: '', paidRef: '', paidById: '', paidByName: '',
      });
      onDone();
    });
  };

  return (
    <form onSubmit={save} className="space-y-4 rounded-2xl border border-line bg-surface p-4">
      <p className="font-semibold">Raise a company payment</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className={small} htmlFor="cp-date">Date of request</label><input id="cp-date" type="date" value={f.requestDate} onChange={e => setF(x => ({ ...x, requestDate: e.target.value }))} className={input} /></div>
        <div>
          <label className={small} htmlFor="cp-cat">Category</label>
          <select id="cp-cat" value={f.category} onChange={e => setF(x => ({ ...x, category: e.target.value }))} className={input}>
            {COMPANY_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div><label className={small} htmlFor="cp-payee">Pay to</label><input id="cp-payee" value={f.payee} onChange={e => setF(x => ({ ...x, payee: e.target.value }))} className={input} placeholder="Name of person or company" /></div>
        <div><label className={small} htmlFor="cp-need">Needed by (optional)</label><input id="cp-need" type="date" value={f.neededBy} onChange={e => setF(x => ({ ...x, neededBy: e.target.value }))} className={input} /></div>
      </div>

      <div>
        <span className={small}>Items</span>
        <div className="space-y-2">
          {items.map((it, i) => (
            <div key={i} className="grid grid-cols-[4rem_minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_4rem_6.5rem_auto]">
              <input value={it.description} onChange={e => setItem(i, { description: e.target.value })} className={`${input} col-span-3 sm:col-span-1`} placeholder="What it is, e.g. Printer toner" aria-label={`Item ${i + 1} description`} />
              <input inputMode="decimal" value={it.qty} onChange={e => setItem(i, { qty: e.target.value.replace(/[^0-9.]/g, '') })} className={input} aria-label={`Item ${i + 1} quantity`} placeholder="Qty" />
              <input inputMode="decimal" value={it.price} onChange={e => setItem(i, { price: e.target.value.replace(/[^0-9.]/g, '') })} className={input} aria-label={`Item ${i + 1} price each in RM`} placeholder="RM each" />
              <button type="button" disabled={items.length === 1} onClick={() => setItems(list => list.filter((_, j) => j !== i))}
                className="rounded-md p-1.5 text-ink-soft hover:bg-white hover:text-danger disabled:opacity-30" aria-label={`Remove item ${i + 1}`}><X className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <button type="button" className={btnSmall} onClick={() => setItems(list => [...list, blankItem()])}><Plus className="h-3.5 w-3.5" /> Add item</button>
          <p className="text-[15px]">Total <strong className="tabular-nums">{formatSen(total)}</strong></p>
        </div>
      </div>

      <div><label className={small} htmlFor="cp-info">Info</label><textarea id="cp-info" rows={2} value={f.info} onChange={e => setF(x => ({ ...x, info: e.target.value }))} className={input} placeholder="Why it's needed, invoice number, anything the approver should know" /></div>
      <div><label className={small} htmlFor="cp-bank">Payment details (optional)</label><input id="cp-bank" value={f.paymentDetails} onChange={e => setF(x => ({ ...x, paymentDetails: e.target.value }))} className={input} placeholder="e.g. Maybank, account name, account number" /></div>

      <p className="text-sm text-ink-soft">{viewer.role === 'management' ? 'The other manager must approve this before it can be paid.' : 'A manager must approve this before it can be paid.'}</p>
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <button type="button" className={btnSecondary} onClick={onDone}>Cancel</button>
        <button type="submit" disabled={busy} className={btnPrimary}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Send for approval</button>
      </div>
    </form>
  );
}

function CompanyPayments({ outs, viewer }: { outs: MoneyOut[]; viewer: Viewer }) {
  const [adding, setAdding] = useState(false);
  const [month, setMonth] = useState('');   // '' = all months
  const list = outs.filter(isCompanyPayment);
  const dateOf = (o: MoneyOut) => String(o.requestDate || o.requestedAt || '').slice(0, 10);
  const months = Array.from(new Set(list.map(o => dateOf(o).slice(0, 7)).filter(Boolean))).sort().reverse();
  const shown = list.filter(o => !month || dateOf(o).startsWith(month))
    .sort((a, b) => dateOf(b).localeCompare(dateOf(a)) || String(b.requestedAt).localeCompare(String(a.requestedAt)));
  const sum = (st: OutStatus[]) => shown.filter(o => st.includes(o.status)).reduce((t, o) => t + (Number(o.amount) || 0), 0);
  const monthName = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-MY', { month: 'long', year: 'numeric' });

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h4 className="font-bold">Company payments</h4>
          <p className="text-sm text-ink-soft">Payments not tied to a training. Same approval rules.</p>
        </div>
        {!adding && <button type="button" className={`${btnPrimary} ml-auto`} onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Raise a company payment</button>}
      </div>
      {adding && <CompanyForm viewer={viewer} onDone={() => setAdding(false)} />}
      {list.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <select value={month} onChange={e => setMonth(e.target.value)} className={`${input} sm:w-56`} aria-label="Show company payments for one month">
            <option value="">All months</option>
            {months.map(m => <option key={m} value={m}>{monthName(m)}</option>)}
          </select>
          <p className="text-sm text-ink-soft">
            Paid <strong className="text-ink">{formatSen(sum(['paid']))}</strong> · Approved, to pay <strong className="text-ink">{formatSen(sum(['approved']))}</strong> · Waiting for approval <strong className="text-ink">{formatSen(sum(['pending']))}</strong>
          </p>
        </div>
      )}
      {shown.length === 0
        ? <p className="text-[15px] text-ink-soft">{list.length ? 'No company payments in this month.' : 'No company payments yet.'}</p>
        : <ul className="space-y-2">{shown.map(o => <OutRow key={o.id} o={o} viewer={viewer} />)}</ul>}
    </section>
  );
}

// ---------- Admin work → Money: everything across deals ----------
export function MoneyOverview({ viewer }: { viewer: Viewer }) {
  const settings = useMoneySettings();
  const [deals, setDeals] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [ins, setIns] = useState<MoneyIn[]>([]);
  const [outs, setOuts] = useState<MoneyOut[]>([]);

  useEffect(() => {
    const subs = [
      onSnapshot(query(collection(db, 'pipelines')), s => setDeals(linkedOnly(s.docs.map(d => ({ ...d.data(), id: d.id }))))),
      onSnapshot(query(collection(db, 'clients')), s => setClients(s.docs.map(d => ({ ...d.data(), id: d.id })))),
      onSnapshot(query(collection(db, 'money_in')), s => setIns(withoutDeleted(s.docs.map(d => ({ ...(d.data() as MoneyIn), id: d.id }))))),
      onSnapshot(query(collection(db, 'money_out')), s => setOuts(withoutDeleted(s.docs.map(d => ({ ...(d.data() as MoneyOut), id: d.id }))))),
    ];
    return () => subs.forEach(u => u());
  }, []);

  const dealLabel = (dealId: string) => {
    if (!dealId) return 'Company payment';
    const d = deals.find(x => x.id === dealId);
    if (!d) return 'Deal no longer exists';
    const c = clients.find(x => x.id === d.clientId)?.companyName || d.client || 'No client';
    return `${c} · ${d.courseName || 'No programme'}`;
  };

  const pending = outs.filter(o => o.status === 'pending').sort((a, b) => String(a.requestedAt).localeCompare(String(b.requestedAt)));
  const mine = pending.filter(o => canDecide(o, viewer));
  const toPay = outs.filter(o => o.status === 'approved');
  const owed = useMemo(() => ins.filter(m => !isPaid(m)).sort((a, b) => String(a.invoiceDate).localeCompare(String(b.invoiceDate))), [ins]);
  const owedTotal = owed.reduce((t, m) => t + expectedFor(m, settings), 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={viewer.role === 'management' ? 'Waiting for your approval' : 'Waiting for approval'} value={String(viewer.role === 'management' ? mine.length : pending.length)} />
        <Stat label="Approved, to pay" value={`${toPay.length} · ${formatRM(toPay.reduce((t, o) => t + o.amount, 0))}`} />
        <Stat label="Still to come in" value={formatRM(owedTotal)} />
        <Stat label="Invoices and claims unpaid" value={String(owed.length)} />
      </div>

      <Section title="Payment requests waiting for approval" empty="Nothing waiting for approval.">
        {pending.map(o => <OutRow key={o.id} o={o} viewer={viewer} context={dealLabel(o.dealId)} />)}
      </Section>
      <Section title="Approved, not paid yet" empty="Nothing approved and waiting to be paid.">
        {toPay.map(o => <OutRow key={o.id} o={o} viewer={viewer} context={dealLabel(o.dealId)} />)}
      </Section>
      <Section title="Money still to come in (oldest first)" empty="Every recorded invoice and claim has been paid.">
        {owed.map(m => <InRow key={m.id} m={m} viewer={viewer} settings={settings} context={dealLabel(m.dealId)} />)}
      </Section>

      <CompanyPayments outs={outs} viewer={viewer} />

      <MoneySettingsCard settings={settings} viewer={viewer} />
    </div>
  );
}

function Section({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <section className="space-y-2">
      <h4 className="font-bold">{title}</h4>
      {children.length === 0 ? <p className="text-[15px] text-ink-soft">{empty}</p> : <ul className="space-y-2">{children}</ul>}
    </section>
  );
}

function MoneySettingsCard({ settings, viewer }: { settings: MoneySettings; viewer: Viewer }) {
  const [f, setF] = useState<{ pct: string; overdue: string; deadline: string; reminder: string } | null>(null);
  const { busy, error, setError, run } = useRun();
  const [saved, setSaved] = useState(false);
  const v = f || { pct: String(settings.hrdcDeductionPct), overdue: String(settings.overdueDays), deadline: settings.claimDeadlineDays === null ? '' : String(settings.claimDeadlineDays), reminder: String(settings.claimReminderDays) };
  const set = (k: 'pct' | 'overdue' | 'deadline' | 'reminder', val: string) => { setF({ ...v, [k]: val.replace(/[^0-9.]/g, '') }); setSaved(false); };
  const save = () => {
    const pct = Number(v.pct);
    const overdue = Number(v.overdue);
    if (!(pct >= 0 && pct < 100)) return setError('The HRDC deduction must be a percentage, for example 4.');
    if (!(overdue >= 1)) return setError('Overdue days must be at least 1.');
    const reminder = Number(v.reminder);
    if (!(reminder >= 1)) return setError('The claim reminder must be at least 1 day.');
    if (v.deadline !== '' && Number(v.deadline) <= reminder) return setError('The claim deadline must be later than the reminder.');
    return run(async () => {
      await setDoc(doc(db, 'config', 'money_settings'), {
        hrdcDeductionPct: pct, overdueDays: overdue, claimDeadlineDays: v.deadline === '' ? null : Number(v.deadline), claimReminderDays: reminder,
        updatedAt: Date.now(), updatedById: viewer.id, updatedByName: viewer.name,
      });
      setF(null);
      setSaved(true);
    });
  };
  return (
    <section className="max-w-2xl space-y-3 rounded-2xl border border-line bg-white p-4">
      <h4 className="font-bold">Money settings</h4>
      <div className="grid gap-3 sm:grid-cols-3">
        <div><label className={small} htmlFor="ms-pct">HRDC keeps (%)</label><input id="ms-pct" inputMode="decimal" value={v.pct} onChange={e => set('pct', e.target.value)} className={input} /></div>
        <div><label className={small} htmlFor="ms-od">Overdue after (days)</label><input id="ms-od" inputMode="numeric" value={v.overdue} onChange={e => set('overdue', e.target.value)} className={input} /></div>
        <div><label className={small} htmlFor="ms-dl">HRDC claim deadline (days after training)</label><input id="ms-dl" inputMode="numeric" value={v.deadline} onChange={e => set('deadline', e.target.value)} className={input} placeholder="Not set" /></div>
        <div><label className={small} htmlFor="ms-rm">Claim reminder turns red after (days after training)</label><input id="ms-rm" inputMode="numeric" value={v.reminder} onChange={e => set('reminder', e.target.value)} className={input} /></div>
      </div>
      <p className="text-sm text-ink-soft">HRD Corp allows 6 months (180 days) after training to submit a claim. The work queue shows an amber reminder straight after training and turns it red after the reminder days, well before the deadline.</p>
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</p>}
      {saved && <p role="status" className="text-sm text-accent">Saved.</p>}
      <button type="button" disabled={busy || !f} onClick={save} className={btnPrimary}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save settings</button>
    </section>
  );
}
