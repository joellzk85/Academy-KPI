import React, { useEffect, useMemo, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, query, setDoc, writeBatch } from 'firebase/firestore';
import { ExternalLink, Loader2, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import { formatDate, formatRM, todayIso } from '../lib/deals';
import { MoneyIn, MoneyOut } from '../lib/money';
import { projectRows } from '../lib/projectPL';
import { linkedOnly, withoutDeleted } from '../lib/linked';
import { PaymentLine } from '../lib/blueprint';
import {
  COST_FIELDS, TrackLine, byPerson, dealLines, isIsoDay, lineNet, linePaid, mergeLines, statusText, totalsOf,
} from '../lib/paymentTracking';
import { useMoneySettings } from './Money';
import { useFormDraft } from '../lib/useFormDraft';
import DraftBar from './DraftBar';

// Management → Payment tracking (2026-10-20). Logic and sources: lib/paymentTracking.ts.

interface Props {
  pipelinesSync?: any[];
  people: { id: string; name: string }[];
  viewer: { id: string; name: string };
  onOpenDeal: (deal: any) => void;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const card = 'rounded-2xl border border-line bg-white p-5';
const input = 'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const label = 'mb-1.5 block text-sm font-semibold text-ink';
const btnPrimary = 'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-surface disabled:opacity-60';
type Show = 'all' | 'waiting' | 'paid';

const monthName = (ym: string) => (ym ? `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}` : 'No date');
const rm = (n: number | null | undefined) => (n === null || n === undefined ? '—' : formatRM(n));

// ---------- The edit form ----------
const TEXT_FIELDS: [keyof PaymentLine, string][] = [
  ['programme', 'Programme'], ['salesPerson', 'Sales person'], ['client', 'Client'], ['employer', 'Employer name'],
  ['claimId', 'Claim ID'], ['grantId', 'Grant ID'], ['trainer', 'Trainer'],
];
const MONEY_FIELDS: [keyof PaymentLine, string][] = [['approved', 'Approved amount (RM)'], ['afterDeduct', 'After HRDC 4% (RM)'], ['afterTax', 'After all tax (RM)']];
const EDIT_COSTS = COST_FIELDS.filter(([k]) => k !== 'grossProfit' && k !== 'margin');

type Form = Record<string, string>;
const toForm = (l: Partial<PaymentLine>): Form => {
  const f: Form = {};
  [...TEXT_FIELDS, ...MONEY_FIELDS, ...EDIT_COSTS, ['date', ''], ['dateText', ''], ['venue', ''], ['paidDate', ''], ['paidNote', ''], ['paidAmount', ''], ['remarks', '']]
    .forEach(([k]) => { const v = (l as any)[k]; f[k as string] = v === null || v === undefined ? '' : String(v); });
  return f;
};
const numOrNull = (s: string) => { const t = s.replace(/[, ]|RM/gi, ''); return t === '' || !Number.isFinite(Number(t)) ? null : Math.round(Number(t) * 100) / 100; };

/** Gross profit = training fee minus every cost; margin = profit ÷ fee. For a line that already has a profit (from the
 *  sheet, which sometimes includes figures outside these columns), only the change in fee and costs is applied. */
function profitOf(c: Record<string, number | null>, before?: TrackLine | null): { grossProfit: number | null; margin: number | null } {
  if (c.trainingFee === null || c.trainingFee === undefined) return { grossProfit: before?.grossProfit ?? null, margin: before?.margin ?? null };
  const costsOf = (x: Record<string, any>) => EDIT_COSTS.filter(([k]) => k !== 'trainingFee').reduce((t, [k]) => t + (Number(x[k as string]) || 0), 0);
  const gp = Math.round((before && before.grossProfit !== null && before.grossProfit !== undefined
    ? before.grossProfit + (c.trainingFee - (before.trainingFee || 0)) - (costsOf(c) - costsOf(before))
    : c.trainingFee - costsOf(c)) * 100) / 100;
  return { grossProfit: gp, margin: c.trainingFee ? Math.round((gp / c.trainingFee) * 10000) / 100 : null };
}

export default function PaymentTracking({ pipelinesSync, people, viewer, onOpenDeal }: Props) {
  const deals = pipelinesSync || [];
  const settings = useMoneySettings();
  const [records, setRecords] = useState<TrackLine[] | null>(null);
  const [ins, setIns] = useState<MoneyIn[]>([]);
  const [outs, setOuts] = useState<MoneyOut[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [checklists, setChecklists] = useState<Record<string, any>>({});
  const [programmes, setProgrammes] = useState<any[]>([]);
  const [quotes, setQuotes] = useState<any[]>([]);
  const [plDocs, setPlDocs] = useState<Record<string, any>>({});
  const [loadError, setLoadError] = useState('');
  useEffect(() => {
    const subs = [
      onSnapshot(query(collection(db, 'payment_records')), s => setRecords(s.docs.map(d => ({ ...(d.data() as TrackLine), id: d.id }))), e => { setRecords([]); setLoadError(friendlyError(e)); }),
      onSnapshot(query(collection(db, 'money_in')), s => setIns(withoutDeleted(s.docs.map(d => ({ ...(d.data() as MoneyIn), id: d.id }))))),
      onSnapshot(query(collection(db, 'money_out')), s => setOuts(withoutDeleted(s.docs.map(d => ({ ...(d.data() as MoneyOut), id: d.id }))))),
      onSnapshot(query(collection(db, 'clients')), s => setClients(s.docs.map(d => ({ ...d.data(), id: d.id })))),
      onSnapshot(query(collection(db, 'deal_checklists')), s => setChecklists(Object.fromEntries(s.docs.map(d => [d.id, d.data()])))),
      onSnapshot(query(collection(db, 'programmes')), s => setProgrammes(s.docs.map(d => ({ ...d.data(), id: d.id })))),
      onSnapshot(query(collection(db, 'quotations')), s => setQuotes(linkedOnly(s.docs.map(d => ({ ...d.data(), id: d.id }))))),
      onSnapshot(query(collection(db, 'project_pl')), s => setPlDocs(Object.fromEntries(s.docs.map(d => [d.id, d.data()])))),
    ];
    return () => subs.forEach(u => u());
  }, []);

  const today = todayIso();
  const plRows = useMemo(() => projectRows(deals, ins, outs, settings, today, { quotes, plDocs }), [deals, ins, outs, settings, today, quotes, plDocs]);
  const fromDeals = useMemo(() => dealLines({
    deals, ins, settings, checklists, clients, rows: plRows,
    programmeName: d => programmes.find(p => p.id === d.programmeId)?.name || '',
    personName: id => people.find(p => p.id === id)?.name || 'Former team member',
  }), [deals, ins, settings, checklists, clients, plRows, programmes, people]);
  const all = useMemo(() => mergeLines(records || [], fromDeals), [records, fromDeals]);
  const lines = all.filter(l => !l.hiddenBy);
  const hiddenCount = all.length - lines.length;

  // ---------- Filters ----------
  const years = useMemo(() => [...new Set([today.slice(0, 4), ...lines.map(l => l.month.slice(0, 4)).filter(Boolean)])].sort().reverse(), [lines, today]);
  const [year, setYear] = useState(today.slice(0, 4));
  const [month, setMonth] = useState('');           // '' = whole year, else 'MM'
  const [person, setPerson] = useState('');
  const [show, setShow] = useState<Show>('all');
  const [search, setSearch] = useState('');
  const people2 = useMemo(() => [...new Set(lines.map(l => (l.salesPerson || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [lines]);

  const inYear = lines.filter(l => l.month.startsWith(year) && (!person || l.salesPerson.trim() === person));
  const q = search.trim().toLowerCase();
  const shown = inYear
    .filter(l => !month || l.month.slice(5, 7) === month)
    .filter(l => show === 'all' || (show === 'paid' ? linePaid(l) : !linePaid(l)))
    .filter(l => !q || [l.programme, l.client, l.employer, l.claimId, l.grantId, l.salesPerson, l.trainer].some(x => (x || '').toLowerCase().includes(q)))
    .sort((a, b) => (b.date || b.month).localeCompare(a.date || a.month) || a.groupNo.localeCompare(b.groupNo) || a.id.localeCompare(b.id));
  const t = totalsOf(shown);
  const byMonth = MONTHS.map((_, i) => String(i + 1).padStart(2, '0'))
    .map(m => ({ m, t: totalsOf(inYear.filter(l => l.month.slice(5, 7) === m)) })).filter(x => x.t.lines);
  const persons = byPerson(shown);

  // ---------- Panel and edit ----------
  const [openId, setOpenId] = useState<string | null>(null);
  const open = all.find(l => l.id === openId) || null;
  const [editing, setEditing] = useState<'new' | string | null>(null);
  const [form, setForm] = useState<Form>(toForm({}));
  const draft = useFormDraft(viewer.id, editing ? `payment_record:${editing}` : null, form, setForm);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [payDate, setPayDate] = useState(today);
  const [payAmount, setPayAmount] = useState('');
  const groupOf = (l: TrackLine) => (records || []).filter(x => x.groupNo === l.groupNo);

  const startEdit = (l: TrackLine | null) => {
    setErr('');
    setForm(l ? toForm(l) : toForm({ date: today }));
    setEditing(l ? l.id : 'new');
  };
  const saveForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.programme.trim()) return setErr('Enter the programme.');
    if (!isIsoDay(form.date)) return setErr('Enter the training date.');
    if (numOrNull(form.approved) === null) return setErr('Enter the approved amount.');
    if (form.paidDate && !isIsoDay(form.paidDate)) return setErr('Check the paid date.');
    setBusy(true); setErr('');
    try {
      const costs: Record<string, number | null> = Object.fromEntries(EDIT_COSTS.map(([k]) => [k, numOrNull(form[k as string])]));
      const base: any = {
        date: form.date, dateText: form.dateText.trim(), month: form.date.slice(0, 7), venue: form.venue.trim(), remarks: form.remarks.trim(),
        paidDate: form.paidDate, paidNote: form.paidDate ? '' : form.paidNote.trim(), paidAmount: numOrNull(form.paidAmount),
        updatedAt: Date.now(), updatedById: viewer.id, updatedByName: viewer.name,
      };
      TEXT_FIELDS.forEach(([k]) => { base[k] = form[k as string].trim(); });
      MONEY_FIELDS.forEach(([k]) => { base[k] = numOrNull(form[k as string]); });
      base.approved = base.approved || 0;
      const before = editing === 'new' ? null : (records || []).find(x => x.id === editing) || null;
      const shared = { ...costs, ...profitOf(costs, before) };
      if (editing === 'new') {
        const id = `pr_${Date.now()}`;
        await setDoc(doc(db, 'payment_records', id), {
          ...toBlank(), ...base, ...shared, id, source: 'manual', groupNo: `manual#${id}`, otherFeeLabel: 'Admin fee', employerAddress: '',
          createdAt: Date.now(), createdById: viewer.id, createdByName: viewer.name,
        });
        setOpenId(id);
      } else if (editing) {
        const me = (records || []).find(x => x.id === editing);
        // The training's costs are the same on all its lines (several employers on one training).
        const batch = writeBatch(db);
        batch.set(doc(db, 'payment_records', editing), { ...base, ...shared }, { merge: true });
        (me ? groupOf(me) : []).filter(x => x.id !== editing).forEach(x => batch.set(doc(db, 'payment_records', x.id), shared, { merge: true }));
        await batch.commit();
      }
      draft.clear();
      setEditing(null);
    } catch (e2) {
      setErr(friendlyError(e2));
    } finally {
      setBusy(false);
    }
  };

  const markPaid = async (l: TrackLine, paid: boolean) => {
    if (paid && !isIsoDay(payDate)) return setErr('Enter the date it was paid.');
    setBusy(true); setErr('');
    try {
      await setDoc(doc(db, 'payment_records', l.id), paid
        ? { paidDate: payDate, paidNote: '', paidAmount: numOrNull(payAmount), updatedAt: Date.now(), updatedById: viewer.id, updatedByName: viewer.name }
        : { paidDate: '', paidNote: '', paidAmount: null, updatedAt: Date.now(), updatedById: viewer.id, updatedByName: viewer.name }, { merge: true });
      setPayAmount('');
    } catch (e2) {
      setErr(friendlyError(e2));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (l: TrackLine) => {
    if (!window.confirm(`Delete this line (${l.programme}, ${l.employer || l.client}, ${formatRM(l.approved)})? This can't be undone.`)) return;
    try {
      await deleteDoc(doc(db, 'payment_records', l.id));
      setOpenId(null);
    } catch (e2) {
      setErr(friendlyError(e2));
    }
  };

  return (
    <div className="space-y-5 font-sans text-ink">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Payment tracking</h2>
          <p className="max-w-3xl text-[15px] text-ink-soft">
            Every HRDC claim and client invoice, and whether it has been paid. Lines from the Blueprint spreadsheet are kept here; claims and invoices recorded on deals show by themselves.
          </p>
        </div>
        <button type="button" className={btnPrimary} onClick={() => startEdit(null)}><Plus className="h-4 w-4" /> Add a line</button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select label="Year" value={year} onChange={v => { setYear(v); setMonth(''); }} options={years.map(y => [y, y])} />
        <Select label="Month" value={month} onChange={setMonth} options={[['', 'Whole year'], ...MONTHS.map((m, i) => [String(i + 1).padStart(2, '0'), m] as [string, string])]} />
        <Select label="Sales person" value={person} onChange={setPerson} options={[['', 'Everyone'], ...people2.map(p => [p, p] as [string, string])]} />
        <Select label="Show" value={show} onChange={v => setShow(v as Show)} options={[['all', 'All lines'], ['waiting', 'Waiting for payment'], ['paid', 'Paid']]} />
        <span className="relative min-w-[14rem] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Programme, client, claim or grant ID" aria-label="Search payment lines" className={`${input} pl-9`} />
        </span>
      </div>

      {loadError && <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-[15px] text-danger">{loadError}</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Approved (claimed or invoiced)" value={formatRM(t.approved)} sub={`After HRDC 4%: ${formatRM(t.afterDeduct)}`} />
        <Tile label="Paid" value={formatRM(t.received)} sub={`${t.lines - t.waitingLines} of ${t.lines} lines`} />
        <Tile label="Waiting for payment" value={formatRM(t.waiting)} sub={`${t.waitingLines} line${t.waitingLines === 1 ? '' : 's'}`} tone={t.waitingLines ? 'attention' : undefined} />
        <Tile label="Gross profit" value={formatRM(t.grossProfit)} sub={`${t.trainings} training${t.trainings === 1 ? '' : 's'}${t.income ? ` · margin ${Math.round((t.grossProfit / t.income) * 100)}%` : ''}`} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className={card}>
          <h3 className="font-bold">Month by month, {year}</h3>
          {byMonth.length === 0 ? <p className="mt-2 text-[15px] text-ink-soft">No lines in {year}.</p> : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[30rem] text-sm">
                <thead><tr className="text-left text-ink-soft"><th className="py-1.5 font-semibold">Month</th><th className="text-right font-semibold">Approved</th><th className="text-right font-semibold">Paid</th><th className="text-right font-semibold">Waiting</th><th className="text-right font-semibold">Gross profit</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {byMonth.map(({ m, t: mt }) => (
                    <tr key={m} onClick={() => setMonth(month === m ? '' : m)} className={`cursor-pointer hover:bg-surface ${month === m ? 'bg-accent-soft' : ''}`}>
                      <td className="py-2 font-semibold">{MONTHS[Number(m) - 1]} <span className="font-normal text-ink-soft">· {mt.lines}</span></td>
                      <td className="text-right tabular-nums">{formatRM(mt.approved)}</td>
                      <td className="text-right tabular-nums">{formatRM(mt.received)}</td>
                      <td className={`text-right tabular-nums ${mt.waitingLines ? 'font-semibold text-attention' : ''}`}>{mt.waitingLines ? formatRM(mt.waiting) : '—'}</td>
                      <td className="text-right tabular-nums">{formatRM(mt.grossProfit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className={card}>
          <h3 className="font-bold">By sales person{month ? `, ${MONTHS[Number(month) - 1]}` : ''}</h3>
          {persons.length === 0 ? <p className="mt-2 text-[15px] text-ink-soft">Nothing in this view.</p> : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[26rem] text-sm">
                <thead><tr className="text-left text-ink-soft"><th className="py-1.5 font-semibold">Sales person</th><th className="text-right font-semibold">Sales amount</th><th className="text-right font-semibold">Commission</th><th className="text-right font-semibold">Waiting</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {persons.map(p => (
                    <tr key={p.name} onClick={() => setPerson(person === p.name ? '' : p.name)} className="cursor-pointer hover:bg-surface">
                      <td className="py-2 font-semibold">{p.name} <span className="font-normal text-ink-soft">· {p.lines}</span></td>
                      <td className="text-right tabular-nums">{formatRM(p.approved)}</td>
                      <td className="text-right tabular-nums">{formatRM(p.commission)}</td>
                      <td className={`text-right tabular-nums ${p.waiting ? 'text-attention' : ''}`}>{p.waiting ? formatRM(p.waiting) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-xs text-ink-soft">Sales amount is the approved amount. Commission is counted once per training. Lines from deals have no commission here; it's in their payment requests.</p>
        </section>
      </div>

      <section className="overflow-hidden rounded-2xl border border-line bg-white">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3">
          <h3 className="font-bold">{shown.length} line{shown.length === 1 ? '' : 's'}{month ? ` in ${MONTHS[Number(month) - 1]} ${year}` : ` in ${year}`}</h3>
          {hiddenCount > 0 && <p className="text-sm text-ink-soft">{hiddenCount} imported line{hiddenCount === 1 ? ' is' : 's are'} shown from {hiddenCount === 1 ? 'its deal' : 'their deals'} instead (same claim ID).</p>}
        </div>
        {records === null ? (
          <p className="flex items-center gap-2 px-5 pb-5 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
        ) : shown.length === 0 ? (
          <p className="px-5 pb-5 text-[15px] text-ink-soft">{lines.length === 0 ? 'No lines yet. Import the Blueprint spreadsheet in Data tools, or add a line.' : 'No lines match these filters.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-sm">
              <thead className="border-y border-line bg-surface text-left text-ink-soft">
                <tr><th className="px-5 py-2 font-semibold">Training</th><th className="font-semibold">Programme and client</th><th className="font-semibold">Sales</th><th className="font-semibold">Claim / grant ID</th><th className="pl-3 text-right font-semibold">Approved</th><th className="whitespace-nowrap pl-3 text-right font-semibold">After 4%</th><th className="px-5 text-right font-semibold">Payment</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shown.map(l => {
                  const paid = linePaid(l);
                  return (
                    <tr key={l.id} onClick={() => { setOpenId(l.id); setErr(''); setPayDate(today); setPayAmount(''); }} className="cursor-pointer align-top hover:bg-surface">
                      <td className="whitespace-nowrap px-5 py-2.5">{l.dateText && !isIsoDay(l.dateText) ? l.dateText : formatDate(l.date) || monthName(l.month)}</td>
                      <td className="max-w-[22rem] py-2.5 pr-3">
                        <span className="block truncate font-semibold">{l.programme}</span>
                        <span className="block truncate text-ink-soft">{[l.client, l.employer && l.employer !== l.client ? l.employer : ''].filter(Boolean).join(' · ')}</span>
                        {l.dealId && <span className="mt-0.5 inline-block rounded-md bg-accent-soft px-1.5 py-0.5 text-xs font-semibold text-accent">From deal</span>}
                      </td>
                      <td className="whitespace-nowrap py-2.5 pr-3">{l.salesPerson}</td>
                      <td className="py-2.5 pr-3 font-mono text-xs text-ink-soft"><span className="block">{l.claimId || '—'}</span><span className="block">{l.grantId}</span></td>
                      <td className="whitespace-nowrap py-2.5 pl-3 text-right tabular-nums">{formatRM(l.approved)}</td>
                      <td className="whitespace-nowrap py-2.5 pl-3 text-right tabular-nums">{rm(l.afterDeduct)}</td>
                      <td className="whitespace-nowrap px-5 py-2.5 text-right">
                        <span className={`font-semibold ${paid ? 'text-accent' : 'text-attention'}`}>{statusText(l, today)}</span>
                        {isIsoDay(l.paidDate) && <span className="block text-ink-soft">{formatDate(l.paidDate)}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Line panel */}
      {open && !editing && (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" role="dialog" aria-modal="true" onClick={() => setOpenId(null)}>
          <div className="h-full w-full overflow-y-auto bg-white p-6 shadow-xl md:w-1/2 md:min-w-[40rem]" onClick={e => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="text-lg font-bold">{open.programme}</h3>
                <p className="text-[15px] text-ink-soft">{[open.client, open.employer].filter(Boolean).join(' · ')}</p>
              </div>
              <button type="button" onClick={() => setOpenId(null)} className="rounded-md p-1 text-ink-soft hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
            </div>

            <div className={`rounded-xl px-4 py-3 ${linePaid(open) ? 'bg-accent-soft' : 'bg-attention-soft'}`}>
              <p className={`font-semibold ${linePaid(open) ? 'text-accent' : 'text-attention'}`}>
                {statusText(open, today)}{isIsoDay(open.paidDate) ? ` on ${formatDate(open.paidDate)}` : ''}{linePaid(open) ? `: ${formatRM(lineNet(open))}` : `, expecting ${formatRM(lineNet(open))}`}
              </p>
              {!open.dealId && (linePaid(open) ? (
                <button type="button" disabled={busy} onClick={() => markPaid(open, false)} className="mt-1 text-sm font-semibold text-ink-soft hover:underline">Undo paid</button>
              ) : (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <label className="text-sm">Paid on<input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} className={`${input} mt-1 w-44`} /></label>
                  <label className="text-sm">Amount received (optional)<input value={payAmount} onChange={e => setPayAmount(e.target.value)} placeholder={String(lineNet(open))} inputMode="decimal" className={`${input} mt-1 w-44`} /></label>
                  <button type="button" disabled={busy} onClick={() => markPaid(open, true)} className={btnPrimary}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Mark paid</button>
                </div>
              ))}
            </div>

            {open.dealId && (
              <div className="mt-4 rounded-xl border border-line p-4 text-[15px]">
                <p>This claim is recorded on the deal, so it's changed there (deal panel → Money). Costs and profit come from Project P&amp;L.</p>
                <button type="button" className={`${btnSecondary} mt-3`} onClick={() => { const d = deals.find(x => x.id === open.dealId); if (d) onOpenDeal(d); }}><ExternalLink className="h-4 w-4" /> Open the deal</button>
              </div>
            )}

            <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 text-[15px]">
              <Item k="Training date" v={open.dateText && !isIsoDay(open.dateText) ? open.dateText : formatDate(open.date)} />
              <Item k="Sales person" v={open.salesPerson} />
              <Item k="Claim ID" v={open.claimId} mono />
              <Item k="Grant ID" v={open.grantId} mono />
              <Item k="Approved amount" v={formatRM(open.approved)} />
              <Item k="After HRDC 4%" v={rm(open.afterDeduct)} />
              {open.afterTax !== null && <Item k="After all tax" v={rm(open.afterTax)} />}
              <Item k="Trainer" v={open.trainer} />
              {open.employerAddress && <Item k="Employer address" v={open.employerAddress} wide />}
              {open.venue && <Item k="Training venue" v={open.venue} wide />}
              {open.remarks && <Item k="Remarks" v={open.remarks} wide />}
            </dl>

            {!open.dealId && (
              <section className="mt-5 rounded-xl border border-line p-4">
                <h4 className="font-bold">The training's costs{groupOf(open).length > 1 ? ` (shared by its ${groupOf(open).length} lines)` : ''}</h4>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-[15px] sm:grid-cols-3">
                  {COST_FIELDS.map(([k, name]) => (open as any)[k] !== null && (open as any)[k] !== undefined && (
                    <div key={k as string}><dt className="text-sm text-ink-soft">{k === 'otherFee' ? open.otherFeeLabel || name : name}</dt><dd className="font-semibold tabular-nums">{k === 'margin' ? `${(open as any)[k]}%` : formatRM((open as any)[k])}</dd></div>
                  ))}
                </dl>
                {groupOf(open).length > 1 && (
                  <ul className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
                    {groupOf(open).map(x => <li key={x.id} className="flex justify-between gap-3"><span className="truncate">{x.employer || x.client}</span><span className="tabular-nums">{formatRM(x.approved)} · {statusText(x, today)}</span></li>)}
                  </ul>
                )}
              </section>
            )}

            {err && <p role="alert" className="mt-4 rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{err}</p>}
            {!open.dealId && (
              <div className="mt-5 flex flex-wrap justify-between gap-2 border-t border-line pt-4">
                <button type="button" onClick={() => remove(open)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-danger hover:underline"><Trash2 className="h-4 w-4" /> Delete line</button>
                <button type="button" onClick={() => startEdit(open)} className={btnSecondary}><Pencil className="h-4 w-4" /> Edit</button>
              </div>
            )}
            {(open as any).importedByName && <p className="mt-3 text-xs text-ink-soft">Imported from the Blueprint spreadsheet by {(open as any).importedByName}{(open as any).updatedByName ? ` · last changed by ${(open as any).updatedByName}` : ''}.</p>}
          </div>
        </div>
      )}

      {/* Add / edit form */}
      {editing && (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" role="dialog" aria-modal="true">
          <div className="h-full w-full overflow-y-auto bg-white p-6 shadow-xl md:w-1/2 md:min-w-[40rem]">
            <div className="mb-5 flex items-start justify-between gap-4">
              <h3 className="text-lg font-bold">{editing === 'new' ? 'Add a payment line' : 'Edit payment line'}</h3>
              <button type="button" onClick={() => setEditing(null)} className="rounded-md p-1 text-ink-soft hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={saveForm} className="space-y-5">
              <DraftBar draft={draft} what={editing === 'new' ? 'new payment line' : 'change to this payment line'} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="pt-date" name="Training date (first day)"><input id="pt-date" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className={input} /></Field>
                <Field id="pt-dtext" name="Dates as written (optional)"><input id="pt-dtext" value={form.dateText} onChange={e => setForm(f => ({ ...f, dateText: e.target.value }))} placeholder="e.g. 4-5 Jul 2026" className={input} /></Field>
                {TEXT_FIELDS.map(([k, name]) => (
                  <Field key={k as string} id={`pt-${k as string}`} name={name}><input id={`pt-${k as string}`} value={form[k as string]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} className={input} /></Field>
                ))}
                {MONEY_FIELDS.map(([k, name]) => (
                  <Field key={k as string} id={`pt-${k as string}`} name={name}><input id={`pt-${k as string}`} inputMode="decimal" value={form[k as string]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} className={input} /></Field>
                ))}
                <Field id="pt-paid" name="Paid on"><input id="pt-paid" type="date" value={form.paidDate} onChange={e => setForm(f => ({ ...f, paidDate: e.target.value }))} className={input} /></Field>
                <Field id="pt-paidamt" name="Amount received (optional)"><input id="pt-paidamt" inputMode="decimal" value={form.paidAmount} onChange={e => setForm(f => ({ ...f, paidAmount: e.target.value }))} className={input} /></Field>
                {!form.paidDate && <Field id="pt-note" name="Or a payment note (counts as paid)"><input id="pt-note" value={form.paidNote} onChange={e => setForm(f => ({ ...f, paidNote: e.target.value }))} placeholder="e.g. Paid before training" className={input} /></Field>}
              </div>
              <Field id="pt-venue" name="Training venue (optional)"><textarea id="pt-venue" rows={2} value={form.venue} onChange={e => setForm(f => ({ ...f, venue: e.target.value }))} className={input} /></Field>
              <fieldset>
                <legend className="mb-2 text-[15px] font-bold">The training's costs (RM){editing !== 'new' && open && groupOf(open).length > 1 ? `: saved on all ${groupOf(open).length} lines of this training` : ''}</legend>
                <div className="grid gap-4 sm:grid-cols-3">
                  {EDIT_COSTS.map(([k, name]) => (
                    <Field key={k as string} id={`pt-${k as string}`} name={name}><input id={`pt-${k as string}`} inputMode="decimal" value={form[k as string]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} className={input} /></Field>
                  ))}
                </div>
                {(() => { const before = editing === 'new' ? null : (records || []).find(x => x.id === editing) || null; const p = profitOf(Object.fromEntries(EDIT_COSTS.map(([k]) => [k, numOrNull(form[k as string])])), before); return p.grossProfit !== null && <p className="mt-2 text-sm text-ink-soft">Gross profit {formatRM(p.grossProfit)}{p.margin !== null ? ` · margin ${p.margin}%` : ''}{before ? ' (changes to the fee or costs are taken off or added to it)' : ' (training fee minus the costs)'}.</p>; })()}
              </fieldset>
              <Field id="pt-rem" name="Remarks (optional)"><textarea id="pt-rem" rows={2} value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} className={input} /></Field>
              {err && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{err}</p>}
              <div className="flex gap-2">
                <button type="submit" disabled={busy} className={btnPrimary}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{editing === 'new' ? 'Add line' : 'Save'}</button>
                <button type="button" onClick={() => setEditing(null)} className={btnSecondary}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const toBlank = (): Partial<PaymentLine> => ({
  claimId: '', grantId: '', employer: '', venue: '', afterDeduct: null, afterTax: null, paidAmount: null, trainer: '', remarks: '',
});

function Select({ label: l, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="flex items-center gap-1.5 text-sm text-ink-soft">
      {l}
      <select value={value} onChange={e => onChange(e.target.value)} className="rounded-lg border border-line bg-white px-2.5 py-2 text-sm font-semibold text-ink focus:border-accent focus:outline-none">
        {options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
    </label>
  );
}

function Tile({ label: l, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'attention' }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <p className="text-sm font-semibold text-ink-soft">{l}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${tone === 'attention' ? 'text-attention' : ''}`}>{value}</p>
      <p className="mt-0.5 text-sm text-ink-soft">{sub}</p>
    </div>
  );
}

function Item({ k, v, mono, wide }: { k: string; v?: string; mono?: boolean; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-full' : ''}>
      <dt className="text-sm text-ink-soft">{k}</dt>
      <dd className={`whitespace-pre-line ${mono ? 'font-mono text-sm' : ''}`}>{v || '—'}</dd>
    </div>
  );
}

function Field({ id, name, children }: { id: string; name: string; children: React.ReactNode }) {
  return <div><label htmlFor={id} className={label}>{name}</label>{children}</div>;
}
