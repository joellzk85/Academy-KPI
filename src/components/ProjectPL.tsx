import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { db } from '../lib/firebase';
import { FUNDING_LABELS, FundingType, dealOwnerId, formatDate, formatRM, todayIso } from '../lib/deals';
import { IN_SOURCE_LABELS, MoneyIn, MoneyOut, OUT_STATUS_LABELS, isPaid } from '../lib/money';
import {
  MONEY_STATUS_LABELS, ProjectRow, TRAINING_STATUS_LABELS, costsByCategory, inPeriod, projectRows, projectTotals,
} from '../lib/projectPL';
import { useMoneySettings } from './Money';

// Management → Project P&L (2026-10-17). One row per won deal (training session), worked out
// live from the deal's money in and money out (lib/projectPL.ts). Nothing is typed here:
// invoices, claims and costs are recorded in each deal's Money section.

interface Props {
  pipelinesSync?: any[];
  people: { id: string; name: string }[];
}

const card = 'rounded-2xl border border-line bg-white p-5';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
type Show = 'all' | 'done' | 'upcoming' | 'open';

export default function ProjectPL({ pipelinesSync, people }: Props) {
  const deals = pipelinesSync || [];
  const settings = useMoneySettings();
  const [clients, setClients] = useState<any[]>([]);
  const [ins, setIns] = useState<MoneyIn[]>([]);
  const [outs, setOuts] = useState<MoneyOut[]>([]);
  useEffect(() => {
    const subs = [
      onSnapshot(query(collection(db, 'clients')), s => setClients(s.docs.map(d => ({ ...d.data(), id: d.id })))),
      onSnapshot(query(collection(db, 'money_in')), s => setIns(s.docs.map(d => ({ ...(d.data() as MoneyIn), id: d.id })))),
      onSnapshot(query(collection(db, 'money_out')), s => setOuts(s.docs.map(d => ({ ...(d.data() as MoneyOut), id: d.id })))),
    ];
    return () => subs.forEach(u => u());
  }, []);

  const today = todayIso();
  const [year, setYear] = useState(today.slice(0, 4));
  const [from, setFrom] = useState('01');          // months 'MM', inclusive
  const [to, setTo] = useState('12');
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [show, setShow] = useState<Show>('all');
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = useMemo(() => projectRows(deals, ins, outs, settings, today), [deals, ins, outs, settings, today]);
  const years = useMemo(() => {
    const ys = new Set<string>([today.slice(0, 4)]);
    rows.forEach(r => r.trainingDate && ys.add(r.trainingDate.slice(0, 4)));
    return [...ys].sort().reverse();
  }, [rows, today]);

  const passesShow = (r: ProjectRow) =>
    show === 'all' ? true
      : show === 'done' ? r.training === 'done'
        : show === 'upcoming' ? r.training !== 'done'
          : r.money !== 'settled';
  const shown = rows.filter(r => inPeriod(r, year, from, to) && passesShow(r));
  const totals = projectTotals(shown);
  const noDate = rows.filter(r => r.training === 'no_date');

  // Month-by-month summary for the chosen months.
  const monthKeys = MONTHS.map((_, i) => String(i + 1).padStart(2, '0')).filter(m => m >= from && m <= to);
  const byMonth = monthKeys.map(m => ({ m, t: projectTotals(shown.filter(r => r.trainingDate.slice(5, 7) === m)) }));

  // Ticked trainings, added up. They stay ticked when the filters change.
  const tickedRows = rows.filter(r => ticked.has(r.deal.id));
  const tickedTotals = projectTotals(tickedRows);
  const tickedHidden = tickedRows.filter(r => !shown.includes(r)).length;
  const toggle = (id: string) => setTicked(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allShownTicked = shown.length > 0 && shown.every(r => ticked.has(r.deal.id));
  const tickAllShown = () => setTicked(prev => {
    const n = new Set(prev);
    shown.forEach(r => (allShownTicked ? n.delete(r.deal.id) : n.add(r.deal.id)));
    return n;
  });
  const pickMonths = (f: string, t: string) => { setFrom(f); setTo(t); };

  const clientName = (p: any) => clients.find(c => c.id === p.clientId)?.companyName || p.client || 'No client';
  const personName = (id: string) => people.find(m => m.id === id)?.name || 'Former team member';
  const mName = (m: string) => MONTHS[Number(m) - 1];
  const periodLabel = from === '01' && to === '12' ? year : from === to ? `${mName(from)} ${year}` : `${mName(from)} to ${mName(to)} ${year}`;
  const monthOptions = MONTHS.map((m, i) => [String(i + 1).padStart(2, '0'), m] as [string, string]);

  return (
    <div className="space-y-5 font-sans text-ink">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Project P&amp;L</h2>
          <p className="text-[15px] text-ink-soft">
            One line per training, worked out from each won deal's money in and approved costs. Grouped by training date.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select label="Year" value={year} onChange={setYear} options={years.map(y => [y, y])} />
          <Select label="From" value={from} onChange={v => pickMonths(v, v > to ? v : to)} options={monthOptions} />
          <Select label="to" value={to} onChange={v => pickMonths(v < from ? v : from, v)} options={monthOptions} />
          {!(from === '01' && to === '12') && (
            <button type="button" onClick={() => pickMonths('01', '12')} className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold hover:bg-surface">Whole year</button>
          )}
          <Select label="Show" value={show} onChange={v => setShow(v as Show)}
            options={[['all', 'All trainings'], ['done', 'Training done'], ['upcoming', 'Upcoming'], ['open', 'Money still open']]} />
        </div>
      </div>

      {/* Tiles */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Trainings" value={String(totals.count)} sub={`${totals.done} done · ${totals.upcoming} upcoming`} />
        <Tile label="Income" value={formatRM(totals.income)}
          sub={totals.estimated ? `incl. ${formatRM(totals.estimated)} estimated (not invoiced yet)` : 'All invoiced or claimed'} />
        <Tile label="HRDC % and costs" value={formatRM(totals.hrdcFee + totals.costs)}
          sub={`HRDC ${formatRM(totals.hrdcFee)} · costs ${formatRM(totals.costs)}`} />
        <Tile label="Profit" value={formatRM(totals.profit)} sub={`${Math.round(totals.margin)}% margin`} tone={totals.profit < 0 ? 'danger' : 'accent'} />
      </div>
      <p className="-mt-2 text-sm text-ink-soft">
        Received so far {formatRM(totals.received)} · still to come in {formatRM(totals.toComeIn)} · approved, still to pay {formatRM(totals.toPayOut)}
        {totals.pendingApproval > 0 && <> · <span className="text-attention">{formatRM(totals.pendingApproval)} waiting for approval (not counted in costs)</span></>}
      </p>

      {/* Month by month */}
      {monthKeys.length > 1 && (
        <section className={card}>
          <h3 className="mb-1 font-bold">Month by month, {periodLabel}</h3>
          <p className="mb-3 text-sm text-ink-soft">Click a month to see only its trainings.</p>
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[40rem] text-[15px]">
              <thead>
                <tr className="border-b border-line text-left text-sm text-ink-soft">
                  <th className="py-2 pr-3 font-semibold">Month</th>
                  <th className="py-2 pr-3 text-right font-semibold">Trainings</th>
                  <th className="py-2 pr-3 text-right font-semibold">Income</th>
                  <th className="py-2 pr-3 text-right font-semibold">HRDC %</th>
                  <th className="py-2 pr-3 text-right font-semibold">Costs</th>
                  <th className="py-2 pr-3 text-right font-semibold">Profit</th>
                  <th className="py-2 text-right font-semibold">Margin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {byMonth.map(({ m, t }) => (
                  <tr key={m} onClick={() => pickMonths(m, m)} className={`cursor-pointer hover:bg-surface ${t.count ? '' : 'text-ink-soft'}`}>
                    <td className="py-2 pr-3 font-medium">{mName(m)} {year}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{t.count || '—'}</td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums">{t.count ? formatRM(t.income) : '—'}</td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums text-ink-soft">{t.hrdcFee ? `− ${formatRM(t.hrdcFee)}` : '—'}</td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums text-ink-soft">{t.costs ? `− ${formatRM(t.costs)}` : '—'}</td>
                    <td className={`whitespace-nowrap py-2 pr-3 text-right font-bold tabular-nums ${t.profit < 0 ? 'text-danger' : ''}`}>{t.count ? formatRM(t.profit) : '—'}</td>
                    <td className="whitespace-nowrap py-2 text-right tabular-nums text-ink-soft">{t.income > 0 ? `${Math.round(t.margin)}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line font-bold">
                  <td className="py-2 pr-3">Total</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{totals.count}</td>
                  <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums">{formatRM(totals.income)}</td>
                  <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums">{totals.hrdcFee ? `− ${formatRM(totals.hrdcFee)}` : '—'}</td>
                  <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums">{totals.costs ? `− ${formatRM(totals.costs)}` : '—'}</td>
                  <td className={`whitespace-nowrap py-2 pr-3 text-right tabular-nums ${totals.profit < 0 ? 'text-danger' : ''}`}>{formatRM(totals.profit)}</td>
                  <td className="whitespace-nowrap py-2 text-right tabular-nums">{totals.income > 0 ? `${Math.round(totals.margin)}%` : '—'}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}

      {/* Table */}
      <section className={card}>
        <h3 className="mb-3 font-bold">Trainings in {periodLabel} ({shown.length})</h3>
        {shown.length === 0 ? <p className="text-ink-soft">No won deals with a training date in {periodLabel}{show !== 'all' ? ' for this filter' : ''}.</p> : (
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[56rem] text-[15px]">
              <thead>
                <tr className="border-b border-line text-left text-sm text-ink-soft">
                  <th className="w-8 py-2 pr-2">
                    <input type="checkbox" checked={allShownTicked} onChange={tickAllShown} aria-label="Tick all trainings in this list" className="h-4 w-4 accent-accent" />
                  </th>
                  <th className="py-2 pr-3 font-semibold">Training</th>
                  <th className="py-2 pr-3 font-semibold">Client and programme</th>
                  <th className="py-2 pr-3 text-right font-semibold">Income</th>
                  <th className="py-2 pr-3 text-right font-semibold">HRDC %</th>
                  <th className="py-2 pr-3 text-right font-semibold">Costs</th>
                  <th className="py-2 pr-3 text-right font-semibold">Profit</th>
                  <th className="py-2 pr-3 text-right font-semibold">Margin</th>
                  <th className="py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shown.map(r => (
                  <React.Fragment key={r.deal.id}>
                    <tr className={`cursor-pointer align-top hover:bg-surface ${ticked.has(r.deal.id) ? 'bg-accent-soft' : ''}`} onClick={() => setOpenId(openId === r.deal.id ? null : r.deal.id)}>
                      <td className="py-2.5 pr-2" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={ticked.has(r.deal.id)} onChange={() => toggle(r.deal.id)} aria-label={`Tick ${clientName(r.deal)} to add up`} className="h-4 w-4 accent-accent" />
                      </td>
                      <td className="py-2.5 pr-3 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1">
                          {openId === r.deal.id ? <ChevronDown className="h-4 w-4 text-ink-soft" /> : <ChevronRight className="h-4 w-4 text-ink-soft" />}
                          {formatDate(r.trainingDate)}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3">
                        <span className="block font-medium">{clientName(r.deal)}</span>
                        <span className="block text-sm text-ink-soft">
                          {r.deal.courseName || 'No programme'} · {FUNDING_LABELS[r.deal.fundingType as FundingType] || 'Funding not set'} · {personName(dealOwnerId(r.deal))}
                        </span>
                      </td>
                      <td className="whitespace-nowrap py-2.5 pr-3 text-right tabular-nums">
                        {formatRM(r.income)}{r.estimate && <span className="block text-xs text-attention">estimate</span>}
                      </td>
                      <td className="whitespace-nowrap py-2.5 pr-3 text-right tabular-nums text-ink-soft">{r.hrdcFee ? `− ${formatRM(r.hrdcFee)}` : '—'}</td>
                      <td className="whitespace-nowrap py-2.5 pr-3 text-right tabular-nums text-ink-soft">{r.costs ? `− ${formatRM(r.costs)}` : '—'}</td>
                      <td className={`whitespace-nowrap py-2.5 pr-3 text-right font-bold tabular-nums ${r.profit < 0 ? 'text-danger' : ''}`}>{formatRM(r.profit)}</td>
                      <td className={`whitespace-nowrap py-2.5 pr-3 text-right tabular-nums ${r.profit < 0 ? 'text-danger' : 'text-ink-soft'}`}>{r.income > 0 ? `${Math.round(r.margin)}%` : '—'}</td>
                      <td className="py-2.5 text-sm">
                        <span className="block">{TRAINING_STATUS_LABELS[r.training]}</span>
                        <span className={`block ${r.money === 'settled' ? 'text-accent' : r.money === 'not_invoiced' ? 'text-attention' : 'text-ink-soft'}`}>{MONEY_STATUS_LABELS[r.money]}</span>
                      </td>
                    </tr>
                    {openId === r.deal.id && (
                      <tr><td colSpan={9}className="bg-surface px-4 py-4"><Breakdown r={r} /></td></tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line font-bold">
                  <td className="py-2.5 pr-3" colSpan={3}>Total, {shown.length} training{shown.length === 1 ? '' : 's'}</td>
                  <td className="whitespace-nowrap py-2.5 pr-3 text-right tabular-nums">{formatRM(totals.income)}</td>
                  <td className="whitespace-nowrap py-2.5 pr-3 text-right tabular-nums">{totals.hrdcFee ? `− ${formatRM(totals.hrdcFee)}` : '—'}</td>
                  <td className="whitespace-nowrap py-2.5 pr-3 text-right tabular-nums">{totals.costs ? `− ${formatRM(totals.costs)}` : '—'}</td>
                  <td className={`whitespace-nowrap py-2.5 pr-3 text-right tabular-nums ${totals.profit < 0 ? 'text-danger' : ''}`}>{formatRM(totals.profit)}</td>
                  <td className="whitespace-nowrap py-2.5 pr-3 text-right tabular-nums">{totals.income > 0 ? `${Math.round(totals.margin)}%` : '—'}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="mt-3 text-sm text-ink-soft">
          Profit = income − HRDC's {settings.hrdcDeductionPct}% (and anything else HRDC didn't pay) − approved and paid costs.
          "Estimate" means no invoice or claim is recorded yet, so the deal value is used. Click a line to see the details, or tick lines to add them up.
          Invoices, claims and costs are added in the deal's Money section (Admin work).
        </p>
      </section>

      {noDate.length > 0 && (
        <section className={card}>
          <h3 className="mb-1 font-bold text-attention">Won, but no training date yet ({noDate.length})</h3>
          <p className="mb-2 text-sm text-ink-soft">Not counted above. Set the training date on the deal (Admin work → Work queue) and it will appear in its month.</p>
          <ul className="divide-y divide-line">
            {noDate.map(r => (
              <li key={r.deal.id} className="flex flex-wrap justify-between gap-2 py-2 text-[15px]">
                <span className="min-w-0">{clientName(r.deal)} <span className="text-ink-soft">· {r.deal.courseName || 'No programme'} · {personName(dealOwnerId(r.deal))}</span></span>
                <span className="tabular-nums">{formatRM(r.income)}{r.estimate ? ' (estimate)' : ''} · profit {formatRM(r.profit)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {tickedRows.length > 0 && (
        <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-accent bg-white px-4 py-3 text-[15px] shadow-lg">
          <strong>{tickedRows.length} ticked training{tickedRows.length === 1 ? '' : 's'}</strong>
          <span>Income <strong className="tabular-nums">{formatRM(tickedTotals.income)}</strong></span>
          <span className="text-ink-soft">HRDC <span className="tabular-nums">− {formatRM(tickedTotals.hrdcFee)}</span></span>
          <span className="text-ink-soft">Costs <span className="tabular-nums">− {formatRM(tickedTotals.costs)}</span></span>
          <span>Profit <strong className={`tabular-nums ${tickedTotals.profit < 0 ? 'text-danger' : 'text-accent'}`}>{formatRM(tickedTotals.profit)}</strong> <span className="text-ink-soft">({Math.round(tickedTotals.margin)}%)</span></span>
          {tickedTotals.estimated > 0 && <span className="text-sm text-attention">incl. {formatRM(tickedTotals.estimated)} estimated</span>}
          {tickedHidden > 0 && <span className="text-sm text-ink-soft">{tickedHidden} not in this view</span>}
          <button type="button" onClick={() => setTicked(new Set())} className="ml-auto rounded-lg border border-line px-3 py-1 text-sm font-semibold hover:bg-surface">Clear ticks</button>
        </div>
      )}
    </div>
  );
}

function Breakdown({ r }: { r: ProjectRow }) {
  const cats = costsByCategory(r.outs);
  const pending = r.outs.filter(o => o.status === 'pending');
  return (
    <div className="grid gap-4 text-sm md:grid-cols-2">
      <div>
        <p className="mb-1 font-semibold">Money in</p>
        {r.ins.length === 0 ? (
          <p className="text-ink-soft">No invoice or HRDC claim yet. Using the deal value of {formatRM(r.income)} as an estimate.</p>
        ) : (
          <ul className="space-y-1">
            {r.ins.map(m => (
              <li key={m.id} className="flex justify-between gap-2">
                <span>{IN_SOURCE_LABELS[m.source]} {m.invoiceNo && <span className="text-ink-soft">{m.invoiceNo}</span>}</span>
                <span className="text-right tabular-nums">
                  {formatRM(Number(m.amount) || 0)}
                  <span className="text-ink-soft"> · {isPaid(m) ? `received ${formatRM(Number(m.paidAmount) || 0)}` : 'not paid yet'}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-ink-soft">Received {formatRM(r.received)} · still to come in {formatRM(r.toComeIn)}</p>
      </div>
      <div>
        <p className="mb-1 font-semibold">Costs (approved and paid)</p>
        {cats.length === 0 ? <p className="text-ink-soft">No approved costs yet.</p> : (
          <ul className="space-y-1">
            {cats.map(c => (
              <li key={c.category} className="flex justify-between gap-2"><span>{c.category}</span><span className="tabular-nums">{formatRM(c.amount)}</span></li>
            ))}
          </ul>
        )}
        {r.toPayOut > 0 && <p className="mt-2 text-ink-soft">Approved, still to pay {formatRM(r.toPayOut)}</p>}
        {pending.length > 0 && (
          <p className="mt-2 text-attention">
            Waiting for approval, not counted: {pending.map(o => `${o.category} ${formatRM(Number(o.amount) || 0)}`).join(', ')}
          </p>
        )}
        {r.outs.some(o => o.status === 'rejected') && (
          <p className="mt-1 text-ink-soft">{r.outs.filter(o => o.status === 'rejected').length} rejected request(s) not counted ({OUT_STATUS_LABELS.rejected.toLowerCase()}).</p>
        )}
      </div>
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="flex items-center gap-2 text-sm font-semibold text-ink-soft">
      {label}
      <select value={value} onChange={e => onChange(e.target.value)} className="rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink focus:border-accent focus:outline-none">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'accent' | 'danger' }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <p className="text-sm font-semibold text-ink-soft">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${tone === 'danger' ? 'text-danger' : tone === 'accent' ? 'text-accent' : ''}`}>{value}</p>
      {sub && <p className="text-sm text-ink-soft">{sub}</p>}
    </div>
  );
}
