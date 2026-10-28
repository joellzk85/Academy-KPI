import React, { useMemo, useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { ArrowLeft, Plus, RefreshCw, X } from 'lucide-react';
import { db } from '../lib/firebase';
import { formatRM } from '../lib/deals';
import { useAutoSave, autoSaveText, leaveAfterSave } from '../lib/useAutoSave';
import {
  CostEstimate, EstimateLine, MAX_PRICES, SeatGroup, SeatOption, estimateData, feeForTarget, newLineId, newSeatGroup, optionPax, publicResult,
} from '../lib/costEstimate';
import {
  LineRows, NumInput, OPTION_NAMES, Switch, btnLink, btnSecondary, cellInput, gpTone, input, label, pctText,
} from './EstimateParts';
import type { RunStart } from './CostEstimator';

// Public programme estimate (Joel, 2026-10-28): one class many companies join, each at its own fee per pax and HRDC or
// direct. Options A to D are different mixes of companies (bookings so far, expected, full room); costs are per run,
// per pax or a % of net sales; shows GP, the break-even head-count and the average fee for a target GP.

export default function PublicEstimateEditor({ start, isNew, onBack, backText, run }: {
  start: CostEstimate; isNew: boolean; onBack: () => void; backText: string; run?: RunStart;
}) {
  const [e, setE] = useState<CostEstimate>(start);
  // Made from a run: saved straight away, so Cost this programme finds it next time.
  const fromRun = isNew && !!start.runId;
  const [saved, setSaved] = useState(() => (fromRun ? '' : JSON.stringify(estimateData(start))));
  const [active, setActive] = useState(0);
  const [touched, setTouched] = useState(!isNew || fromRun);
  const json = JSON.stringify(estimateData(e));
  const dirty = json !== saved;

  const { state, flush } = useAutoSave({
    value: e,
    dirty,
    enabled: touched,
    write: v => setDoc(doc(db, 'cost_estimates', v.id), JSON.parse(JSON.stringify({ ...estimateData(v), updatedAt: new Date().toISOString() }))),
    onSaved: out => setSaved(JSON.stringify(estimateData(JSON.parse(out)))),
  });
  const saveLine = autoSaveText(state, dirty, false, touched);

  const set = (patch: Partial<CostEstimate>) => { setTouched(true); setE(prev => ({ ...prev, ...patch })); };
  const setLine = (key: 'costs' | 'expenses', id: string, patch: Partial<EstimateLine>) =>
    set({ [key]: e[key].map(l => (l.id === id ? { ...l, ...patch } : l)) } as any);
  const addLine = (key: 'costs' | 'expenses') =>
    set({ [key]: [...e[key], { id: newLineId(), label: '', mode: 'rm', qty: 1, unit: 0, pct: 0 }] } as any);
  const removeLine = (key: 'costs' | 'expenses', id: string) => set({ [key]: e[key].filter(l => l.id !== id) } as any);

  const options = e.options && e.options.length ? e.options : [{ id: 'a', name: '', groups: [] }];
  const activeIdx = Math.min(active, options.length - 1);
  const opt = options[activeIdx];
  const listPrice = Number(e.listPrice) || 0;
  const seatLimit = Number(e.seatLimit) || 0;
  const minPax = Number(e.minPax) || 0;

  const setOptions = (next: SeatOption[]) => set({ options: next });
  const setOpt = (patch: Partial<SeatOption>) => setOptions(options.map((o, i) => (i === activeIdx ? { ...o, ...patch } : o)));
  const setGroup = (id: string, patch: Partial<SeatGroup>) => setOpt({ groups: opt.groups.map(g => (g.id === id ? { ...g, ...patch } : g)) });
  const addGroup = (g: SeatGroup) => setOpt({ groups: [...opt.groups, g] });
  const removeGroup = (id: string) => setOpt({ groups: opt.groups.filter(g => g.id !== id) });
  // A new option starts as a copy of the one shown, so only what's different needs changing.
  const addOption = () => {
    if (options.length >= MAX_PRICES) return;
    setOptions([...options, { id: newLineId(), name: '', groups: opt.groups.map(g => ({ ...g, id: newLineId() })) }]);
    setActive(options.length);
  };
  const removeOption = (i: number) => {
    setOptions(options.filter((_, j) => j !== i));
    setActive(a => Math.max(0, a >= i ? a - 1 : a));
  };
  const refreshFromRun = () => {
    if (!run) return;
    setOptions(options.map((o, i) => (i === 0 ? { ...o, groups: run.groups.map(g => ({ ...g, id: newLineId() })) } : o)));
    setActive(0);
  };

  const r = publicResult(e, opt);
  const all = useMemo(() => options.map(o => publicResult(e, o)), [json]);
  const best = all.reduce((b, x, i) => (x.price > 0 && (b < 0 || x.gp > all[b].gp) ? i : b), -1);
  const ofPrice = (amt: number) => (r.price ? (amt / r.price) * 100 : 0);
  const target = e.targetGpPct ?? 0;
  const suggested = target > 0 ? feeForTarget(e, opt, target) : null;
  const openSeats = seatLimit > r.pax ? seatLimit - r.pax : 0;

  const lineRows = (key: 'costs' | 'expenses') => (
    <LineRows lines={e[key]} netSales={r.netSales} pax={r.pax} ofPrice={ofPrice} rmText="RM per run"
      onChange={(id, patch) => setLine(key, id, patch)} onRemove={id => removeLine(key, id)} />
  );

  const sumRow = (text: string, amt: number, strong = false, tone = '') => (
    <div className={`grid grid-cols-[1fr_auto_64px] items-center gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_120px_64px_32px] ${strong ? 'bg-surface font-bold' : ''}`}>
      <p className={strong ? 'text-[15px]' : 'text-sm font-semibold'}>{text}</p>
      <p className={`text-right tabular-nums ${tone}`}>{formatRM(amt)}</p>
      <p className={`text-right text-sm tabular-nums ${tone || 'text-ink-soft'}`}>{pctText(ofPrice(amt))}</p>
    </div>
  );

  const optionLabel = (i: number) => `Option ${OPTION_NAMES[i]}${options[i]?.name ? `: ${options[i].name}` : ''}`;

  return (
    <div className="space-y-5 pb-16 font-sans text-ink">
      <div>
        <button type="button" onClick={() => leaveAfterSave(flush, onBack)} className={btnLink}><ArrowLeft className="h-4 w-4" /> {backText}</button>
        <h2 className="mt-1 text-xl font-bold">{e.title || 'New public programme estimate'}</h2>
        <p className="mt-0.5 text-[15px] text-ink-soft">A mock P&L for one public programme: several companies, each at its own fee. Nothing here changes a deal, a run or a quotation.</p>
      </div>

      {/* About the programme */}
      <section className="grid gap-4 rounded-xl border border-line bg-white p-4 sm:grid-cols-4">
        <div className="sm:col-span-3">
          <label className={label} htmlFor="pe-title">Programme</label>
          <input id="pe-title" className={input} value={e.title} placeholder="e.g. Leadership for supervisors" onChange={ev => set({ title: ev.target.value })} />
        </div>
        <div>
          <label className={label}>Days</label>
          <NumInput value={e.days} onChange={v => set({ days: v })} className={input} placeholder="1" />
        </div>
        <div className="sm:col-span-2">
          <label className={label}>List price per pax (RM)</label>
          <NumInput value={listPrice} onChange={v => set({ listPrice: v })} className={input} />
        </div>
        <div>
          <label className={label}>Seat limit <span className="font-normal text-ink-soft">(blank = none)</span></label>
          <NumInput value={seatLimit} onChange={v => set({ seatLimit: Math.round(v) })} className={input} />
        </div>
        <div>
          <label className={label}>Minimum pax</label>
          <NumInput value={minPax} onChange={v => set({ minPax: Math.round(v) })} className={input} />
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 sm:col-span-4">
          <div className="flex flex-wrap items-center gap-2">
            <Switch on={e.sstOn} onChange={v => set({ sstOn: v })}>Add SST</Switch>
            {e.sstOn && <span className="flex items-center gap-1 text-sm"><NumInput value={e.sstRate} onChange={v => set({ sstRate: v })} className={`${cellInput} w-16`} ariaLabel="SST rate" />%</span>}
          </div>
          <span className="flex flex-wrap items-center gap-1 text-sm font-semibold">
            HRDC keeps <NumInput value={e.hrdcPct} onChange={v => set({ hrdcPct: v })} className={`${cellInput} w-16`} ariaLabel="HRDC percent" />%
            <span className="font-normal text-ink-soft">of HRDC companies' fees</span>
          </span>
        </div>
      </section>

      {/* Options: different mixes of companies */}
      <section className="rounded-xl border border-line bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          {options.map((o, i) => (
            <span key={o.id} className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-sm font-semibold ${i === activeIdx ? 'border-accent bg-accent-soft text-ink' : 'border-line text-ink-soft hover:text-ink'}`}>
              <button type="button" onClick={() => setActive(i)}>{optionLabel(i)} · {optionPax(o)} pax</button>
              {options.length > 1 && (
                <button type="button" aria-label={`Remove option ${OPTION_NAMES[i]}`} onClick={() => removeOption(i)} className="text-ink-soft hover:text-danger"><X className="h-3.5 w-3.5" /></button>
              )}
            </span>
          ))}
          {options.length < MAX_PRICES && (
            <button type="button" onClick={addOption} className={btnSecondary}><Plus className="h-4 w-4" /> Add an option (copy of {OPTION_NAMES[activeIdx]})</button>
          )}
          {run && <button type="button" onClick={refreshFromRun} className={btnLink}><RefreshCw className="h-4 w-4" /> Option A: companies on the programme now</button>}
        </div>

        <div className="mt-3 max-w-md">
          <label className={label} htmlFor="pe-optname">Name of option {OPTION_NAMES[activeIdx]}</label>
          <input id="pe-optname" className={input} value={opt.name} placeholder="e.g. Bookings so far, Expected, Full room" onChange={ev => setOpt({ name: ev.target.value })} />
        </div>

        <div className="mt-4 overflow-hidden rounded-lg border border-line">
          <div className="hidden grid-cols-[minmax(0,1fr)_72px_120px_70px_120px_32px] gap-2 border-b border-line bg-surface px-3 py-2 text-xs font-semibold uppercase tracking-wide text-ink-soft sm:grid">
            <span>Company</span><span>Pax</span><span>Fee per pax</span><span>HRDC</span><span className="text-right">Amount</span><span />
          </div>
          {opt.groups.length === 0 && <p className="px-3 py-3 text-sm text-ink-soft">No companies in this option yet.</p>}
          {opt.groups.map(g => (
            <div key={g.id} className="grid grid-cols-[1fr_auto] items-center gap-2 border-b border-line/60 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_72px_120px_70px_120px_32px]">
              <input className={`${cellInput} w-full`} value={g.name} placeholder="Company" aria-label="Company" onChange={ev => setGroup(g.id, { name: ev.target.value })} />
              <button type="button" aria-label="Remove company" onClick={() => removeGroup(g.id)} className="rounded-md p-1.5 text-ink-soft hover:bg-danger-soft hover:text-danger sm:order-last">
                <X className="h-4 w-4" />
              </button>
              <div className="col-span-2 flex flex-wrap items-center gap-2 sm:contents">
                <span className="flex items-center gap-1 sm:block"><span className="text-xs text-ink-soft sm:hidden">Pax</span><NumInput ariaLabel="Pax" value={g.pax} onChange={v => setGroup(g.id, { pax: Math.round(v) })} className={`${cellInput} w-16 sm:w-full`} /></span>
                <span className="flex items-center gap-1 sm:block"><span className="text-xs text-ink-soft sm:hidden">Fee per pax</span><NumInput ariaLabel="Fee per pax" value={g.fee} onChange={v => setGroup(g.id, { fee: v })} className={`${cellInput} w-28 sm:w-full`} /></span>
                <label className="inline-flex items-center gap-1.5 text-sm">
                  <input type="checkbox" className="h-4 w-4 accent-[#0E6E62]" checked={g.hrdc} onChange={ev => setGroup(g.id, { hrdc: ev.target.checked })} />
                  <span className="sm:hidden">HRDC</span>
                </label>
                <span className="ml-auto text-right text-sm font-semibold tabular-nums sm:ml-0 sm:text-[15px]">
                  {formatRM((Number(g.pax) || 0) * (Number(g.fee) || 0))}
                  {listPrice > 0 && g.fee > 0 && g.fee < listPrice && <span className="block text-xs font-normal text-attention">{pctText((1 - g.fee / listPrice) * 100)} below list</span>}
                </span>
              </div>
            </div>
          ))}
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-3 py-2">
            <button type="button" onClick={() => addGroup(newSeatGroup('', 0, listPrice))} className={btnLink}><Plus className="h-4 w-4" /> Add a company</button>
            {openSeats > 0 && (
              <button type="button" onClick={() => addGroup(newSeatGroup('Open seats', openSeats, listPrice))} className={btnLink}><Plus className="h-4 w-4" /> Fill the {openSeats} open seats at list price</button>
            )}
          </div>
          <div className="flex flex-wrap justify-between gap-2 border-t border-line bg-surface px-3 py-2.5 text-sm">
            <span><strong>{r.pax}</strong> pax{seatLimit ? ` of ${seatLimit} seats` : ''} · average fee <strong>{r.pax ? formatRM(r.avgFee) : '—'}</strong> per pax</span>
            <span>Total fees <strong>{formatRM(r.price)}</strong></span>
          </div>
        </div>
        {seatLimit > 0 && r.pax > seatLimit && <p className="mt-2 text-sm font-semibold text-danger">{r.pax - seatLimit} pax over the seat limit.</p>}
        {minPax > 0 && r.pax < minPax && <p className="mt-2 text-sm font-semibold text-attention">{minPax - r.pax} pax short of the minimum of {minPax}.</p>}
      </section>

      {/* Break-even and target */}
      <section className="grid gap-3 rounded-xl border border-line bg-white p-4 sm:grid-cols-2">
        <div>
          <p className="text-sm font-semibold">Break-even</p>
          {r.pax === 0 ? (
            <p className="text-sm text-ink-soft">Add companies to see how many pax the programme needs.</p>
          ) : r.breakEvenPax === null ? (
            <p className="text-sm font-semibold text-danger">Never: at an average fee of {formatRM(r.avgFee)}, each pax costs more than they bring in.</p>
          ) : (
            <p className="text-sm">
              <strong className="text-lg">{r.breakEvenPax} pax</strong> at this option's average fee of {formatRM(r.avgFee)} cover the costs per run of {formatRM(r.runCosts)}.{' '}
              <span className={r.pax >= r.breakEvenPax ? 'font-semibold text-accent' : 'font-semibold text-danger'}>
                {r.pax >= r.breakEvenPax ? `${r.pax - r.breakEvenPax} pax above it.` : `${r.breakEvenPax - r.pax} pax short.`}
              </span>
            </p>
          )}
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">Aim for a GP of</span>
            <NumInput value={target} onChange={v => set({ targetGpPct: v })} className={`${cellInput} w-16`} ariaLabel="Target GP percent" />
            <span>%</span>
          </div>
          {target > 0 && (
            <p className="mt-1 text-sm text-ink-soft">
              {suggested
                ? <>With {r.pax} pax, charge an average of about <strong className="text-ink">{formatRM(suggested)}</strong> per pax{listPrice ? ` (list price ${formatRM(listPrice)})` : ''}.</>
                : 'Add companies and costs first (or the target is too high).'}
            </p>
          )}
        </div>
      </section>

      {/* The P&L for the option shown */}
      <section className="overflow-hidden rounded-xl border border-line bg-white">
        <div className="flex items-center justify-between border-b border-line bg-surface px-3 py-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">
          <span>P&amp;L · {optionLabel(activeIdx)} · {r.pax} pax</span>
          <span>Amount · % of price</span>
        </div>

        {sumRow('Selling price (all companies)', r.price, true)}
        {e.sstOn && (
          <p className="px-3 pb-2 text-sm text-ink-soft">
            Plus SST {e.sstRate}%: {formatRM(r.sst)}. Companies pay {formatRM(r.clientPays)} in all. SST goes to the government, not into GP.
          </p>
        )}
        {r.hrdcFee > 0 && (
          <>
            {sumRow(`Less HRDC's ${e.hrdcPct}% (HRDC companies, ${formatRM(r.hrdcPrice)})`, -r.hrdcFee, false, 'text-danger')}
            {sumRow('Net sales', r.netSales, true)}
          </>
        )}

        <p className="border-t border-line px-3 pb-1 pt-3 text-sm font-bold">Cost of training</p>
        {lineRows('costs')}
        <div className="px-3 py-2"><button type="button" onClick={() => addLine('costs')} className={btnLink}><Plus className="h-4 w-4" /> Add a cost line</button></div>
        {sumRow('Total cost of training', r.costs)}

        <p className="border-t border-line px-3 pb-1 pt-3 text-sm font-bold">Expenses</p>
        {lineRows('expenses')}
        <div className="px-3 py-2"><button type="button" onClick={() => addLine('expenses')} className={btnLink}><Plus className="h-4 w-4" /> Add an expense line</button></div>
        {sumRow('Total expenses', r.expenses)}

        <div className="border-t-2 border-ink/20">
          {sumRow('Gross profit (GP)', r.gp, true, gpTone(r.gpPct))}
        </div>
      </section>

      {/* Side by side */}
      {options.length > 1 && (
        <section className="overflow-x-auto rounded-xl border border-line bg-white">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="border-b border-line bg-surface text-left">
                <th className="px-3 py-2 font-semibold">Compare</th>
                {all.map((_, i) => (
                  <th key={i} className="px-3 py-2 text-right font-semibold">
                    {optionLabel(i)}{i === best && all.filter(x => x.price > 0).length > 1 ? ' ★' : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {([
                ['Pax', (x: typeof r) => String(x.pax)],
                ['Average fee per pax', (x: typeof r) => (x.pax ? formatRM(x.avgFee) : '—')],
                ['Selling price', (x: typeof r) => formatRM(x.price)],
                ["HRDC's %", (x: typeof r) => formatRM(-x.hrdcFee)],
                ['Cost of training', (x: typeof r) => formatRM(-x.costs)],
                ['Expenses', (x: typeof r) => formatRM(-x.expenses)],
                ['Break-even pax', (x: typeof r) => (!x.pax ? '—' : x.breakEvenPax === null ? 'Never' : String(x.breakEvenPax))],
              ] as [string, (x: typeof r) => string][]).map(([name, f]) => (
                <tr key={name} className="border-b border-line/60">
                  <td className="px-3 py-2 text-ink-soft">{name}</td>
                  {all.map((x, i) => <td key={i} className="px-3 py-2 text-right">{f(x)}</td>)}
                </tr>
              ))}
              <tr className="bg-surface font-bold">
                <td className="px-3 py-2">GP</td>
                {all.map((x, i) => <td key={i} className={`px-3 py-2 text-right ${gpTone(x.gpPct)}`}>{formatRM(x.gp)}</td>)}
              </tr>
              <tr className="bg-surface font-bold">
                <td className="px-3 py-2">GP %</td>
                {all.map((x, i) => <td key={i} className={`px-3 py-2 text-right ${gpTone(x.gpPct)}`}>{pctText(x.gpPct)}</td>)}
              </tr>
            </tbody>
          </table>
        </section>
      )}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white/95 px-4 py-2 text-sm backdrop-blur">
        <p className={saveLine.tone === 'danger' ? 'text-danger' : saveLine.tone === 'attention' ? 'text-attention' : 'text-ink-soft'}>{saveLine.text}</p>
      </div>
    </div>
  );
}
