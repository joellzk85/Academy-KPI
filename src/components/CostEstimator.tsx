import React, { useEffect, useMemo, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import { ArrowLeft, Calculator, Plus, Trash2, X } from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import { formatDate, formatRM } from '../lib/deals';
import { useMoneySettings } from './Money';
import { useAutoSave, autoSaveText, leaveAfterSave } from '../lib/useAutoSave';
import {
  CostEstimate, EstimateLine, MAX_PRICES, blankEstimate, estimateData, estimateResult, lineAmount, newLineId, priceForTarget,
} from '../lib/costEstimate';

// Costing estimator (Joel, 2026-10-21): beside New deal on the Deals page. Everyone can use it.
// A mock P&L to set the price: selling price − cost of training − expenses = GP, with several prices side by side.

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const cellInput =
  'min-w-0 rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const label = 'mb-1.5 block text-sm font-semibold text-ink';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';
const btnLink = 'inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline';

const OPTION_NAMES = ['A', 'B', 'C', 'D'];
const pctText = (v: number) => `${(Number.isFinite(v) ? v : 0).toFixed(1)}%`;
const gpTone = (pct: number) => (pct < 0 ? 'text-danger' : pct < 20 ? 'text-attention' : 'text-accent');

// A number box that lets you type freely ("12.", "") and hands back a number.
function NumInput({ value, onChange, className, placeholder = '0', ariaLabel }: {
  value: number; onChange: (v: number) => void; className?: string; placeholder?: string; ariaLabel?: string;
}) {
  const [text, setText] = useState(value ? String(value) : '');
  useEffect(() => {
    if ((Number(text) || 0) !== (Number(value) || 0)) setText(value ? String(value) : '');
  }, [value]);
  return (
    <input
      inputMode="decimal"
      aria-label={ariaLabel}
      className={className || `${cellInput} w-full`}
      placeholder={placeholder}
      value={text}
      onChange={e => {
        const t = e.target.value.replace(/[^0-9.]/g, '');
        setText(t);
        onChange(Number(t) || 0);
      }}
    />
  );
}

function Switch({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-ink">
      <input type="checkbox" className="h-4 w-4 accent-[#0E6E62]" checked={on} onChange={e => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

export default function CostEstimator({ viewer, people, onClose }: {
  viewer: Viewer;
  people: { id: string; name: string }[];
  onClose: () => void;
}) {
  const settings = useMoneySettings();
  const staff = viewer.role !== 'rep';
  const [list, setList] = useState<CostEstimate[]>([]);
  const [loadError, setLoadError] = useState('');
  const [open, setOpen] = useState<CostEstimate | null>(null);

  // Reps see their own estimates; Admin and Management see everyone's.
  useEffect(() => {
    const q = staff ? query(collection(db, 'cost_estimates')) : query(collection(db, 'cost_estimates'), where('ownerId', '==', viewer.id));
    return onSnapshot(q, s => {
      setList(s.docs.map(d => ({ ...(d.data() as CostEstimate), id: d.id })).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')));
      setLoadError('');
    }, err => setLoadError(friendlyError(err)));
  }, [staff, viewer.id]);

  const startNew = () => {
    const now = new Date().toISOString();
    setOpen({
      ...blankEstimate(viewer.id, { hrdcPct: settings.hrdcDeductionPct, commissionPct: settings.commissionPct }),
      id: doc(collection(db, 'cost_estimates')).id,
      createdAt: now,
      updatedAt: now,
    });
  };

  const remove = async (e: CostEstimate) => {
    if (!window.confirm(`Delete the estimate "${e.title || 'Untitled'}"?`)) return;
    try { await deleteDoc(doc(db, 'cost_estimates', e.id)); } catch (err) { window.alert(friendlyError(err)); }
  };

  const personName = (id: string) => (id === viewer.id ? 'You' : people.find(p => p.id === id)?.name || '');

  if (open) {
    return <EstimateEditor key={open.id} start={open} isNew={!list.some(e => e.id === open.id)} onBack={() => setOpen(null)} />;
  }

  return (
    <div className="space-y-5 font-sans text-ink">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <button type="button" onClick={onClose} className={btnLink}><ArrowLeft className="h-4 w-4" /> Back to deals</button>
          <h2 className="mt-1 text-xl font-bold">Costing estimator</h2>
          <p className="mt-0.5 text-[15px] text-ink-soft">Work out the price before you quote: selling price − cost of training − expenses = GP.</p>
        </div>
        <button type="button" onClick={startNew} className={btnPrimary}><Plus className="h-4 w-4" /> New estimate</button>
      </div>

      {loadError && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{loadError}</p>}

      {list.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-white p-8 text-center">
          <Calculator className="mx-auto h-8 w-8 text-ink-soft" />
          <p className="mt-2 text-[15px] text-ink-soft">No estimates yet. Click New estimate to cost a training.</p>
        </div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
          {list.map(e => {
            const results = (e.prices || []).filter(p => p > 0).map(p => estimateResult(e, p));
            return (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-surface">
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen(e)}>
                  <p className="font-semibold">{e.title || 'Untitled'}{e.clientName ? <span className="font-normal text-ink-soft"> · {e.clientName}</span> : null}</p>
                  <p className="text-sm text-ink-soft">
                    {results.length
                      ? results.map((r, i) => `${OPTION_NAMES[i]}: ${formatRM(r.price)} → GP ${pctText(r.gpPct)}`).join('   ')
                      : 'No price yet'}
                  </p>
                  <p className="text-xs text-ink-soft">
                    {staff && e.ownerId !== viewer.id ? `${personName(e.ownerId)} · ` : ''}Updated {formatDate((e.updatedAt || '').slice(0, 10))}
                  </p>
                </button>
                {(e.ownerId === viewer.id || staff) && (
                  <button type="button" aria-label="Delete estimate" onClick={() => remove(e)} className="rounded-md p-2 text-ink-soft hover:bg-danger-soft hover:text-danger">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function EstimateEditor({ start, isNew, onBack }: { start: CostEstimate; isNew: boolean; onBack: () => void }) {
  const [e, setE] = useState<CostEstimate>(start);
  const [saved, setSaved] = useState(() => JSON.stringify(estimateData(start)));
  const [active, setActive] = useState(0);
  const [touched, setTouched] = useState(!isNew);
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

  const setPrice = (i: number, v: number) => set({ prices: e.prices.map((p, j) => (j === i ? v : p)) });
  const addPrice = (v = 0) => {
    if (e.prices.length >= MAX_PRICES) return;
    set({ prices: [...e.prices, v] });
    setActive(e.prices.length);
  };
  const removePrice = (i: number) => {
    set({ prices: e.prices.filter((_, j) => j !== i) });
    setActive(a => Math.max(0, a >= i ? a - 1 : a));
  };

  const activeIdx = Math.min(active, e.prices.length - 1);
  const r = estimateResult(e, e.prices[activeIdx] || 0);
  const all = useMemo(() => e.prices.map(p => estimateResult(e, p)), [json]);
  const best = all.reduce((b, x, i) => (x.price > 0 && (b < 0 || x.gp > all[b].gp) ? i : b), -1);
  const ofPrice = (amt: number) => (r.price ? (amt / r.price) * 100 : 0);
  const target = e.targetGpPct ?? 0;
  const suggested = target > 0 ? priceForTarget(e, target) : null;

  const lineRows = (key: 'costs' | 'expenses') => e[key].map(l => {
    const amt = lineAmount(l, r.price);
    return (
      <div key={l.id} className="grid grid-cols-[1fr_auto] items-center gap-2 border-b border-line/60 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_270px_120px_64px_32px]">
        <input className={`${cellInput} w-full`} value={l.label} placeholder="Item" aria-label="Item" onChange={ev => setLine(key, l.id, { label: ev.target.value })} />
        <button type="button" aria-label="Remove line" onClick={() => removeLine(key, l.id)} className="rounded-md p-1.5 text-ink-soft hover:bg-danger-soft hover:text-danger sm:order-last">
          <X className="h-4 w-4" />
        </button>
        <div className="col-span-2 flex items-center gap-1.5 sm:col-span-1">
          <select
            aria-label="How it's worked out"
            className="w-[92px] shrink-0 rounded-md border border-line bg-white px-1.5 py-1.5 text-sm text-ink"
            value={l.mode}
            onChange={ev => setLine(key, l.id, { mode: ev.target.value as 'rm' | 'pct' })}
          >
            <option value="rm">RM</option>
            <option value="pct">% of price</option>
          </select>
          {l.mode === 'rm' ? (
            <>
              <NumInput ariaLabel="Quantity" value={l.qty} onChange={v => setLine(key, l.id, { qty: v })} className={`${cellInput} w-16 shrink-0`} placeholder="1" />
              <span className="text-ink-soft">×</span>
              <NumInput ariaLabel="Unit price" value={l.unit} onChange={v => setLine(key, l.id, { unit: v })} />
            </>
          ) : (
            <NumInput ariaLabel="Percent of price" value={l.pct} onChange={v => setLine(key, l.id, { pct: v })} />
          )}
        </div>
        <p className="text-right text-sm font-semibold tabular-nums sm:text-[15px]">{formatRM(amt)}</p>
        <p className="text-right text-sm tabular-nums text-ink-soft">{pctText(ofPrice(amt))}</p>
      </div>
    );
  });

  const sumRow = (text: string, amt: number, strong = false, tone = '') => (
    <div className={`grid grid-cols-[1fr_auto_64px] items-center gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_120px_64px_32px] ${strong ? 'bg-surface font-bold' : ''}`}>
      <p className={strong ? 'text-[15px]' : 'text-sm font-semibold'}>{text}</p>
      <p className={`text-right tabular-nums ${tone}`}>{formatRM(amt)}</p>
      <p className={`text-right text-sm tabular-nums ${tone || 'text-ink-soft'}`}>{pctText(ofPrice(amt))}</p>
    </div>
  );

  return (
    <div className="space-y-5 pb-16 font-sans text-ink">
      <div>
        <button type="button" onClick={() => leaveAfterSave(flush, onBack)} className={btnLink}><ArrowLeft className="h-4 w-4" /> All estimates</button>
        <h2 className="mt-1 text-xl font-bold">{e.title || 'New estimate'}</h2>
        <p className="mt-0.5 text-[15px] text-ink-soft">A mock P&L for one training. Nothing here changes a deal or a quotation.</p>
      </div>

      {/* About the training */}
      <section className="grid gap-4 rounded-xl border border-line bg-white p-4 sm:grid-cols-4">
        <div className="sm:col-span-2">
          <label className={label} htmlFor="ce-title">Programme</label>
          <input id="ce-title" className={input} value={e.title} placeholder="e.g. Leadership for supervisors" onChange={ev => set({ title: ev.target.value })} />
        </div>
        <div className="sm:col-span-2">
          <label className={label} htmlFor="ce-client">Client (optional)</label>
          <input id="ce-client" className={input} value={e.clientName} placeholder="Company name" onChange={ev => set({ clientName: ev.target.value })} />
        </div>
        <div>
          <label className={label}>Pax</label>
          <NumInput value={e.pax} onChange={v => set({ pax: v })} className={input} />
        </div>
        <div>
          <label className={label}>Days</label>
          <NumInput value={e.days} onChange={v => set({ days: v })} className={input} placeholder="1" />
        </div>
        <div className="flex flex-col justify-end gap-2 sm:col-span-2">
          <div className="flex flex-wrap items-center gap-2">
            <Switch on={e.sstOn} onChange={v => set({ sstOn: v })}>Add SST</Switch>
            {e.sstOn && <span className="flex items-center gap-1 text-sm"><NumInput value={e.sstRate} onChange={v => set({ sstRate: v })} className={`${cellInput} w-16`} ariaLabel="SST rate" />%</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Switch on={e.hrdcOn} onChange={v => set({ hrdcOn: v })}>HRDC keeps</Switch>
            {e.hrdcOn && <span className="flex items-center gap-1 text-sm"><NumInput value={e.hrdcPct} onChange={v => set({ hrdcPct: v })} className={`${cellInput} w-16`} ariaLabel="HRDC percent" />%</span>}
          </div>
        </div>
      </section>

      {/* Price options */}
      <section className="rounded-xl border border-line bg-white p-4">
        <p className={label}>Selling price options (before SST)</p>
        <div className="flex flex-wrap items-end gap-3">
          {e.prices.map((p, i) => (
            <div key={i} className={`rounded-lg border p-2 ${i === activeIdx ? 'border-accent bg-accent-soft' : 'border-line'}`}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <button type="button" onClick={() => setActive(i)} className="text-sm font-semibold">
                  Option {OPTION_NAMES[i]}{i === activeIdx ? ' (shown below)' : ''}
                </button>
                {e.prices.length > 1 && (
                  <button type="button" aria-label={`Remove option ${OPTION_NAMES[i]}`} onClick={() => removePrice(i)} className="text-ink-soft hover:text-danger"><X className="h-3.5 w-3.5" /></button>
                )}
              </div>
              <div className="flex items-center gap-1.5" onFocus={() => setActive(i)}>
                <span className="text-sm text-ink-soft">RM</span>
                <NumInput value={p} onChange={v => setPrice(i, v)} className={`${cellInput} w-32`} ariaLabel={`Price option ${OPTION_NAMES[i]}`} />
              </div>
            </div>
          ))}
          {e.prices.length < MAX_PRICES && (
            <button type="button" onClick={() => addPrice()} className={btnSecondary}><Plus className="h-4 w-4" /> Add a price to compare</button>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold">Aim for a GP of</span>
          <NumInput value={target} onChange={v => set({ targetGpPct: v })} className={`${cellInput} w-16`} ariaLabel="Target GP percent" />
          <span>%</span>
          {target > 0 && (suggested
            ? <>
                <span className="text-ink-soft">→ charge about <strong className="text-ink">{formatRM(suggested)}</strong></span>
                {e.prices.length < MAX_PRICES && <button type="button" className={btnLink} onClick={() => addPrice(suggested)}>Add as an option</button>}
              </>
            : <span className="text-ink-soft">Enter the costs first (or the target is too high).</span>)}
        </div>
      </section>

      {/* The P&L for the option shown */}
      <section className="overflow-hidden rounded-xl border border-line bg-white">
        <div className="flex items-center justify-between border-b border-line bg-surface px-3 py-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">
          <span>P&amp;L · Option {OPTION_NAMES[activeIdx]}</span>
          <span>Amount · % of price</span>
        </div>

        {sumRow('Selling price', r.price, true)}
        {e.sstOn && (
          <p className="px-3 pb-2 text-sm text-ink-soft">
            Plus SST {e.sstRate}%: {formatRM(r.sst)}. Client pays {formatRM(r.clientPays)}{e.pax > 0 ? ` (${formatRM(r.clientPays / e.pax)} per pax)` : ''}. SST goes to the government, not into GP.
          </p>
        )}
        {!e.sstOn && e.pax > 0 && r.price > 0 && <p className="px-3 pb-2 text-sm text-ink-soft">{formatRM(r.perPax)} per pax</p>}
        {e.hrdcOn && (
          <>
            {sumRow(`Less HRDC's ${e.hrdcPct}%`, -r.hrdcFee, false, 'text-danger')}
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
      {e.prices.length > 1 && (
        <section className="overflow-x-auto rounded-xl border border-line bg-white">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="border-b border-line bg-surface text-left">
                <th className="px-3 py-2 font-semibold">Compare</th>
                {all.map((_, i) => (
                  <th key={i} className="px-3 py-2 text-right font-semibold">
                    Option {OPTION_NAMES[i]}{i === best && all.filter(x => x.price > 0).length > 1 ? ' ★' : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {([
                ['Selling price', (x: typeof r) => formatRM(x.price)],
                ...(e.pax > 0 ? [['Per pax', (x: typeof r) => formatRM(x.perPax)]] : []),
                ...(e.sstOn ? [['Client pays (incl. SST)', (x: typeof r) => formatRM(x.clientPays)]] : []),
                ...(e.hrdcOn ? [[`HRDC's ${e.hrdcPct}%`, (x: typeof r) => formatRM(-x.hrdcFee)]] : []),
                ['Cost of training', (x: typeof r) => formatRM(-x.costs)],
                ['Expenses', (x: typeof r) => formatRM(-x.expenses)],
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
