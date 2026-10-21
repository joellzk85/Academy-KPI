import React, { createContext, useContext } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { addDays, formatRM } from '../lib/deals';
import { mix } from '../lib/presentTheme';

// Charts for the weekly presentation (lib/present.ts): number cards with up/down, a score ring, a funnel,
// bars, donuts and two heatmaps. Colours follow the CRM palette (src/index.css): teal accent first.

export const CHART_COLOURS = ['#0E6E62', '#5DB3A6', '#E0A458', '#1C2B45', '#8FA3BF', '#B45309', '#7C6CB0', '#C2554B'];
// The slideshow and the PDF give the charts the meeting's colours (lib/presentTheme.ts); elsewhere the CRM palette.
export const ChartPalette = createContext<string[]>(CHART_COLOURS);
const usePalette = () => useContext(ChartPalette);

export const compactRM = (n: number) => {
  const a = Math.abs(n);
  return a >= 1e6 ? `RM ${(n / 1e6).toFixed(1)}m` : a >= 1e3 ? `RM ${Math.round(n / 1e3)}k` : `RM ${Math.round(n)}`;
};

export function StatCard({ label, value, delta, sub, tone = 'plain' }: {
  label: string; value: string; delta?: number | null; sub?: string; tone?: 'plain' | 'accent' | 'danger';
}) {
  const bg = tone === 'accent' ? 'bg-accent text-white' : tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-surface text-ink';
  const soft = tone === 'accent' ? 'text-white/80' : 'text-ink-soft';
  return (
    <div className={`rounded-2xl p-4 sm:p-5 ${bg}`}>
      <p className={`text-sm font-semibold ${soft}`}>{label}</p>
      <p className="mt-1 text-2xl font-extrabold tabular-nums sm:text-3xl">{value}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 text-sm">
        {delta !== undefined && delta !== null && (
          <span className={`inline-flex items-center gap-0.5 font-bold ${tone === 'accent' ? 'text-white' : delta > 0 ? 'text-accent' : delta < 0 ? 'text-danger' : 'text-ink-soft'}`}>
            {delta > 0 ? <ArrowUpRight className="h-4 w-4" /> : delta < 0 ? <ArrowDownRight className="h-4 w-4" /> : <Minus className="h-4 w-4" />}{Math.abs(delta)}%
          </span>
        )}
        {sub && <span className={soft}>{sub}</span>}
      </div>
    </div>
  );
}

export function Ring({ pct, size = 180, label, sub }: { pct: number; size?: number; label: string; sub?: string }) {
  const r = size / 2 - 12, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, pct));
  const pal = usePalette();
  const colour = p >= 100 ? pal[0] : p >= 50 ? pal[1] : '#E0A458';
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E2E5DE" strokeWidth={14} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={colour} strokeWidth={14} strokeLinecap="round" strokeDasharray={`${(p / 100) * c} ${c}`} />
      </svg>
      <div className="absolute text-center">
        <p className="text-4xl font-extrabold tabular-nums">{label}</p>
        {sub && <p className="text-sm font-semibold text-ink-soft">{sub}</p>}
      </div>
    </div>
  );
}

// A funnel: centred bars getting narrower, with the count, value and how many moved on from the step before.
export function Funnel({ data, money, conversion = true }: { data: { label: string; count: number; value?: number }[]; money?: boolean; conversion?: boolean }) {
  const pal = usePalette();
  const max = Math.max(1, ...data.map(d => d.count));
  return (
    <div className="space-y-2">
      {data.map((d, i) => {
        const w = Math.max(14, (d.count / max) * 100);
        const prev = i > 0 ? data[i - 1].count : 0;
        return (
          <div key={d.label} className="grid grid-cols-[minmax(7rem,10rem)_1fr_minmax(4rem,6rem)] items-center gap-3">
            <span className="text-right text-sm font-semibold text-ink-soft">{d.label}</span>
            <div className="flex justify-center">
              <div className="flex h-11 items-center justify-center rounded-lg text-sm font-bold text-white transition-all"
                style={{ width: `${w}%`, background: pal[i % 2 === 0 ? 0 : 1], opacity: 1 - i * 0.08 }}>
                {d.count}{money && d.value ? <span className="ml-2 hidden font-semibold text-white/85 sm:inline">{compactRM(d.value)}</span> : null}
              </div>
            </div>
            <span className="text-sm tabular-nums text-ink-soft">{conversion && i > 0 && prev > 0 ? `${Math.round((d.count / prev) * 100)}% moved on` : ''}</span>
          </div>
        );
      })}
    </div>
  );
}

export interface BarSpec { key: string; name: string; colour?: string }
export function Bars({ data, bars, xKey = 'label', money, horizontal, stacked, height = 300, animate = true }: {
  data: any[]; bars: BarSpec[]; xKey?: string; money?: boolean; horizontal?: boolean; stacked?: boolean; height?: number; animate?: boolean;
}) {
  const pal = usePalette();
  const fmt = (v: any) => (money ? compactRM(Number(v)) : String(v));
  const tip = (v: any) => (money ? formatRM(Number(v)) : String(v));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 8, right: 16, bottom: 4, left: horizontal ? 8 : 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E2E5DE" vertical={!!horizontal} horizontal={!horizontal} />
        {/* Recharts finds its axes among its direct children, so no fragments here. */}
        {horizontal
          ? <XAxis type="number" tickFormatter={fmt} tick={{ fontSize: 12, fill: '#4A5872' }} />
          : <XAxis dataKey={xKey} tick={{ fontSize: 12, fill: '#4A5872' }} interval="preserveStartEnd" minTickGap={4} />}
        {horizontal
          ? <YAxis type="category" dataKey={xKey} width={130} tick={{ fontSize: 13, fill: '#1C2B45' }} />
          : <YAxis tickFormatter={fmt} tick={{ fontSize: 12, fill: '#4A5872' }} width={money ? 64 : 36} allowDecimals={false} />}
        <Tooltip formatter={tip} cursor={{ fill: 'rgba(14,110,98,0.06)' }} />
        {bars.length > 1 && <Legend wrapperStyle={{ fontSize: 13 }} />}
        {bars.map((b, i) => (
          <Bar key={b.key} dataKey={b.key} name={b.name} fill={b.colour || pal[i]} stackId={stacked ? 'all' : undefined}
            radius={stacked && i < bars.length - 1 ? 0 : horizontal ? [0, 6, 6, 0] : [6, 6, 0, 0]} isAnimationActive={animate} maxBarSize={48} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

// A donut with its legend beside it (name, value, share).
export function Donut({ data, money, height = 260, animate = true, centre }: {
  data: { name: string; value: number }[]; money?: boolean; height?: number; animate?: boolean; centre?: string;
}) {
  const pal = usePalette();
  const total = data.reduce((t, d) => t + d.value, 0);
  const shown = data.filter(d => d.value > 0);
  if (!shown.length) return <Empty />;
  return (
    <div className="grid items-center gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="relative">
        <ResponsiveContainer width="100%" height={height}>
          <PieChart>
            <Pie data={shown} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="92%" paddingAngle={2} isAnimationActive={animate} stroke="none">
              {shown.map((_, i) => <Cell key={i} fill={pal[i % pal.length]} />)}
            </Pie>
            <Tooltip formatter={(v: any) => (money ? formatRM(Number(v)) : String(v))} />
          </PieChart>
        </ResponsiveContainer>
        {centre && <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-center text-lg font-extrabold">{centre}</p>}
      </div>
      <ul className="space-y-2">
        {shown.map((d, i) => (
          <li key={d.name} className="flex items-center gap-2 text-[15px]">
            <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: pal[i % pal.length] }} />
            <span className="min-w-0 flex-1 truncate">{d.name}</span>
            <span className="font-semibold tabular-nums">{money ? compactRM(d.value) : d.value}</span>
            <span className="w-12 text-right text-sm tabular-nums text-ink-soft">{total ? Math.round((d.value / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Five shades, from empty to the main colour.
const shades = (main: string) => ['#EEF0EB', mix('#FFFFFF', main, 0.25), mix('#FFFFFF', main, 0.5), mix('#FFFFFF', main, 0.78), main];
const heat = (sh: string[], v: number, max: number) => {
  if (!v) return sh[0];
  const t = Math.min(1, v / Math.max(1, max));
  return t > 0.75 ? sh[4] : t > 0.5 ? sh[3] : t > 0.25 ? sh[2] : sh[1];
};
function HeatKey() {
  const sh = shades(usePalette()[0]);
  return (
    <span className="inline-flex items-center gap-1 text-xs text-ink-soft">
      Less {sh.map(c => <span key={c} className="h-3 w-3 rounded-sm" style={{ background: c }} />)} More
    </span>
  );
}

// Every day of the last `weeks` weeks (Monday to Sunday rows), darker = more done that day.
export function DayHeatmap({ dates, today, weeks = 12 }: { dates: string[]; today: string; weeks?: number }) {
  const sh = shades(usePalette()[0]);
  const counts = new Map<string, number>();
  dates.forEach(d => counts.set(d, (counts.get(d) || 0) + 1));
  const dow = (new Date(today).getDay() + 6) % 7;   // Monday = 0
  const start = addDays(today, -dow - 7 * (weeks - 1));
  const cols = Array.from({ length: weeks }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)));
  const max = Math.max(1, ...cols.flat().filter(d => d <= today).map(d => counts.get(d) || 0));
  const total = cols.flat().filter(d => d <= today).reduce((t, d) => t + (counts.get(d) || 0), 0);
  const active = cols.flat().filter(d => d <= today && counts.get(d)).length;
  return (
    <div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        <div className="grid grid-rows-7 gap-1 pt-6 text-xs text-ink-soft">{['Mon', '', 'Wed', '', 'Fri', '', 'Sun'].map((l, i) => <span key={i} className="h-5 leading-5 sm:h-7 sm:leading-7">{l}</span>)}</div>
        {cols.map((col, w) => (
          <div key={w} className="grid gap-1">
            <span className="h-5 text-xs text-ink-soft">{col[0].slice(8, 10) <= '07' ? new Date(col[0]).toLocaleDateString('en-GB', { month: 'short' }) : ''}</span>
            {col.map(d => (
              <span key={d} title={`${d}: ${counts.get(d) || 0}`} className="h-5 w-5 rounded sm:h-7 sm:w-7"
                style={{ background: d > today ? 'transparent' : heat(sh, counts.get(d) || 0, max), outline: d === today ? '2px solid var(--color-ink)' : undefined }} />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-ink-soft">
        <span><strong className="text-ink">{total}</strong> things done on <strong className="text-ink">{active}</strong> days</span>
        <HeatKey />
      </div>
    </div>
  );
}

// Rows (people) by columns (weeks): darker = more.
export function MatrixHeatmap({ rows, cols }: { rows: { name: string; values: number[] }[]; cols: string[] }) {
  const sh = shades(usePalette()[0]);
  const max = Math.max(1, ...rows.flatMap(r => r.values));
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-1 text-sm">
        <thead>
          <tr>
            <th />
            {cols.map(c => <th key={c} className="px-1 text-center text-xs font-semibold text-ink-soft">{c}</th>)}
            <th className="pl-2 text-right text-xs font-semibold text-ink-soft">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.name}>
              <td className="whitespace-nowrap pr-2 font-semibold">{r.name}</td>
              {r.values.map((v, i) => (
                <td key={i} title={`${r.name}, ${cols[i]}: ${v}`} className="h-9 w-12 rounded-md text-center text-xs font-bold tabular-nums"
                  style={{ background: heat(sh, v, max), color: v / max > 0.5 ? '#fff' : 'var(--color-ink)' }}>{v || ''}</td>
              ))}
              <td className="pl-2 text-right font-bold tabular-nums">{r.values.reduce((a, b) => a + b, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2"><HeatKey /></div>
    </div>
  );
}

export function Empty({ text = 'Nothing in this period.' }: { text?: string }) {
  return <p className="rounded-xl bg-surface px-4 py-6 text-center text-ink-soft">{text}</p>;
}

export function Panel({ title, children, className = '' }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-line bg-white p-4 sm:p-5 ${className}`}>
      {title && <h4 className="mb-3 font-bold">{title}</h4>}
      {children}
    </div>
  );
}
