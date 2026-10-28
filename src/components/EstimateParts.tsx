import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { formatRM } from '../lib/deals';
import { LIGHT_TEXT } from '../lib/kpi';
import { gpLight } from '../lib/kpiLibrary';
import { EstimateLine, lineAmount } from '../lib/costEstimate';

// Shared by the Costing estimator (one client) and the public programme estimate (2026-10-28).

export const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
export const cellInput =
  'min-w-0 rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
export const label = 'mb-1.5 block text-sm font-semibold text-ink';
export const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
export const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';
export const btnLink = 'inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline';

export const OPTION_NAMES = ['A', 'B', 'C', 'D'];
export const pctText = (v: number) => `${(Number.isFinite(v) ? v : 0).toFixed(1)}%`;
// GP colour: the company gross profit bands (KPI & appraisal → Settings → KPI library, Joel 2026-10-22); a loss is always red.
export const gpTone = (pct: number) => (pct < 0 ? 'text-danger' : LIGHT_TEXT[gpLight(pct)]);

// A number box that lets you type freely ("12.", "") and hands back a number.
export function NumInput({ value, onChange, className, placeholder = '0', ariaLabel }: {
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

export function Switch({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-ink">
      <input type="checkbox" className="h-4 w-4 accent-[#0E6E62]" checked={on} onChange={e => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

// Cost or expense lines: item, how it's worked out (RM, RM per pax, % of net sales), amount, % of the price.
export function LineRows({ lines, netSales, pax, ofPrice, rmText = 'RM', onChange, onRemove }: {
  lines: EstimateLine[]; netSales: number; pax: number; ofPrice: (amt: number) => number; rmText?: string;
  onChange: (id: string, patch: Partial<EstimateLine>) => void; onRemove: (id: string) => void;
}) {
  return (
    <>
      {lines.map(l => {
        const amt = lineAmount(l, netSales, pax);
        return (
          <div key={l.id} className="grid grid-cols-[1fr_auto] items-center gap-2 border-b border-line/60 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_270px_120px_64px_32px]">
            <input className={`${cellInput} w-full`} value={l.label} placeholder="Item" aria-label="Item" onChange={ev => onChange(l.id, { label: ev.target.value })} />
            <button type="button" aria-label="Remove line" onClick={() => onRemove(l.id)} className="rounded-md p-1.5 text-ink-soft hover:bg-danger-soft hover:text-danger sm:order-last">
              <X className="h-4 w-4" />
            </button>
            <div className="col-span-2 flex items-center gap-1.5 sm:col-span-1">
              <select
                aria-label="How it's worked out"
                className="w-[120px] shrink-0 rounded-md border border-line bg-white px-1.5 py-1.5 text-sm text-ink"
                value={l.mode}
                onChange={ev => onChange(l.id, { mode: ev.target.value as EstimateLine['mode'] })}
              >
                <option value="rm">{rmText}</option>
                <option value="pax">RM per pax</option>
                <option value="pct">% of net sales</option>
              </select>
              {l.mode === 'pct' ? (
                <NumInput ariaLabel="Percent of net sales" value={l.pct} onChange={v => onChange(l.id, { pct: v })} />
              ) : (
                <>
                  <NumInput ariaLabel={l.mode === 'pax' ? 'Quantity per pax' : 'Quantity'} value={l.qty} onChange={v => onChange(l.id, { qty: v })} className={`${cellInput} w-16 shrink-0`} placeholder="1" />
                  <span className="text-ink-soft">×</span>
                  <NumInput ariaLabel="Unit price" value={l.unit} onChange={v => onChange(l.id, { unit: v })} />
                </>
              )}
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold tabular-nums sm:text-[15px]">{formatRM(amt)}</p>
              {l.mode === 'pax' && <p className="text-xs text-ink-soft">× {pax} pax</p>}
            </div>
            <p className="text-right text-sm tabular-nums text-ink-soft">{pctText(ofPrice(amt))}</p>
          </div>
        );
      })}
    </>
  );
}
