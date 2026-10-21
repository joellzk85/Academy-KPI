import React, { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db, friendlyError } from '../lib/firebase';
import { formatRM } from '../lib/deals';
import {
  buildForecast, DEFAULT_FORECAST, FORECAST_SPANS, Forecast, ForecastSettings, forecastMonthLabel, POTENTIALS, POTENTIAL_LABELS, readForecastSettings,
} from '../lib/forecast';
import { PotentialChip } from './DealPotential';

// Sales projection (Joel, 2026-10-21): won so far + open deals x their Hot / Warm / Cold chance, 1 to 6 months ahead.
// Used on My home (card), Management → Team performance and the weekly presentation. See lib/forecast.ts.

export function useForecastSettings(): ForecastSettings {
  const [s, setS] = useState<ForecastSettings>(DEFAULT_FORECAST);
  useEffect(() => onSnapshot(doc(db, 'config', 'forecast_settings'), d => setS(readForecastSettings(d.data())), () => setS(DEFAULT_FORECAST)), []);
  return s;
}

// How many months to show, remembered per person on this browser.
export function useForecastSpan(key: string, fallback = 3): [number, (n: number) => void] {
  const storeKey = `forecastSpan:${key}`;
  const [n, setN] = useState(() => {
    try { const v = Number(localStorage.getItem(storeKey)); return FORECAST_SPANS.includes(v) ? v : fallback; } catch { return fallback; }
  });
  const set = (v: number) => { setN(v); try { localStorage.setItem(storeKey, String(v)); } catch { /* ignore */ } };
  return [n, set];
}

export function SpanPicker({ value, onChange, id }: { value: number; onChange: (n: number) => void; id: string }) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-sm text-ink-soft">
      Show
      <select id={id} value={value} onChange={e => onChange(Number(e.target.value))} className="rounded-lg border border-line bg-white px-2 py-1 text-sm text-ink">
        {FORECAST_SPANS.map(n => <option key={n} value={n}>{n === 1 ? 'This month' : `${n} months`}</option>)}
      </select>
    </label>
  );
}

// Bars per month: won (solid) and projected from open deals (light), with the target line when there is one.
export function ProjectionBars({ f, target, big }: { f: Forecast; target?: number; big?: boolean }) {
  const max = Math.max(1, target || 0, ...f.months.map(m => m.won + m.weighted));
  const h = big ? 220 : 120;
  return (
    <div>
      <div className="flex items-end gap-2" style={{ height: h }}>
        {f.months.map(m => {
          const wonH = (m.won / max) * h, wH = (m.weighted / max) * h;
          return (
            <div key={m.month} className="relative flex h-full flex-1 flex-col items-center justify-end" title={`${forecastMonthLabel(m.month)}: won ${formatRM(m.won)}, projected ${formatRM(m.projected)}`}>
              <span className={`mb-1 font-semibold tabular-nums ${big ? 'text-sm' : 'text-xs'}`}>{m.projected ? formatRM(Math.round(m.projected)).replace(/\.00$/, '') : ''}</span>
              <div className="w-full max-w-16 rounded-t-md bg-accent/35" style={{ height: wH }} />
              <div className={`w-full max-w-16 bg-accent ${wH ? '' : 'rounded-t-md'}`} style={{ height: wonH }} />
              {target ? <div className="pointer-events-none absolute left-0 right-0 border-t-2 border-dashed border-attention" style={{ bottom: (target / max) * h }} /> : null}
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-2 border-t border-line pt-1">
        {f.months.map(m => <span key={m.month} className={`flex-1 text-center text-ink-soft ${big ? 'text-sm' : 'text-xs'}`}>{forecastMonthLabel(m.month).slice(0, 3)}</span>)}
      </div>
      <p className={`mt-2 flex flex-wrap gap-x-4 gap-y-1 text-ink-soft ${big ? 'text-sm' : 'text-xs'}`}>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-accent" />Won</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-accent/35" />Projected from open deals</span>
        {target ? <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-attention" />Monthly target {formatRM(target)}</span> : null}
      </p>
    </div>
  );
}

export function ProjectionTable({ f, big }: { f: Forecast; big?: boolean }) {
  const cell = big ? 'py-2 text-[15px]' : 'py-1.5 text-sm';
  return (
    <table className="w-full">
      <thead>
        <tr className="border-b border-line text-left text-xs text-ink-soft">
          <th className="py-1.5 font-semibold">Month</th>
          <th className="py-1.5 text-right font-semibold">Won</th>
          <th className="py-1.5 text-right font-semibold">From open deals</th>
          <th className="py-1.5 text-right font-semibold">Projected</th>
          <th className="hidden py-1.5 text-right font-semibold sm:table-cell">If all sign</th>
        </tr>
      </thead>
      <tbody>
        {f.months.map(m => (
          <tr key={m.month} className="border-b border-line/60">
            <td className={cell}>{forecastMonthLabel(m.month)}</td>
            <td className={`${cell} text-right tabular-nums`}>{formatRM(m.won)}</td>
            <td className={`${cell} text-right tabular-nums`}>{formatRM(m.weighted)}</td>
            <td className={`${cell} text-right font-semibold tabular-nums`}>{formatRM(m.projected)}</td>
            <td className={`${cell} hidden text-right tabular-nums text-ink-soft sm:table-cell`}>{formatRM(m.won + m.pipeline)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="font-semibold">
          <td className={cell}>Total</td>
          <td className={`${cell} text-right tabular-nums`}>{formatRM(f.totals.won)}</td>
          <td className={`${cell} text-right tabular-nums`}>{formatRM(f.totals.weighted)}</td>
          <td className={`${cell} text-right tabular-nums`}>{formatRM(f.totals.projected)}</td>
          <td className={`${cell} hidden text-right tabular-nums text-ink-soft sm:table-cell`}>{formatRM(f.totals.won + f.totals.pipeline)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

function ChanceEditor({ settings, viewer }: { settings: ForecastSettings; viewer: { id: string; name: string } }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setV({ hot: String(settings.hot), warm: String(settings.warm), cold: String(settings.cold) }); }, [open, settings]);
  const save = async () => {
    const n = { hot: Number(v.hot), warm: Number(v.warm), cold: Number(v.cold) };
    if (Object.values(n).some(x => !Number.isFinite(x) || x < 0 || x > 100)) return setErr('Each chance is a number from 0 to 100.');
    setBusy(true); setErr('');
    try {
      await setDoc(doc(db, 'config', 'forecast_settings'), { ...n, updatedAt: Date.now(), updatedById: viewer.id, updatedByName: viewer.name });
      setOpen(false);
    } catch (e) { setErr(friendlyError(e)); }
    setBusy(false);
  };
  if (!open) return <button type="button" className="text-sm font-semibold text-accent hover:underline" onClick={() => setOpen(true)}>Change the chances</button>;
  return (
    <div className="mt-2 rounded-lg bg-surface p-3">
      <p className="text-sm text-ink-soft">How much of a deal's value counts in the projection.</p>
      <div className="mt-2 flex flex-wrap gap-3">
        {POTENTIALS.map(k => (
          <label key={k} className="flex items-center gap-1.5 text-sm font-semibold">{POTENTIAL_LABELS[k]}
            <input inputMode="numeric" value={v[k] ?? ''} onChange={e => setV(x => ({ ...x, [k]: e.target.value.replace(/[^0-9]/g, '') }))} className="w-16 rounded-lg border border-line bg-white px-2 py-1 text-right" />%
          </label>
        ))}
      </div>
      {err && <p className="mt-2 text-sm text-danger">{err}</p>}
      <div className="mt-3 flex gap-2">
        <button type="button" disabled={busy} onClick={save} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60">Save</button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-ink-soft hover:bg-white">Cancel</button>
      </div>
    </div>
  );
}

// The full projection: span picker, person picker (Management), bars, table, deals counted, and what is left out.
export default function SalesProjection({
  deals, people, viewer, today, ownerIds, monthlyTargetFor, onOpenDeal, clientName, compact, storeKey,
}: {
  deals: any[];                                      // already linkedOnly / withoutDeleted
  people: { id: string; name: string }[];            // people Management can pick (with deals)
  viewer: { id: string; name: string; role: string };
  today: string;
  ownerIds?: string[];                               // fixed owners (a rep's own); empty + Management = pick
  monthlyTargetFor?: (ownerId: string | 'all') => number;
  onOpenDeal?: (p: any) => void;
  clientName: (p: any) => string;
  compact?: boolean;
  storeKey: string;
}) {
  const settings = useForecastSettings();
  const [span, setSpan] = useForecastSpan(storeKey, compact ? 3 : 6);
  const isMgmt = viewer.role === 'management';
  const [who, setWho] = useState<string>('all');
  const [showDeals, setShowDeals] = useState(false);
  const owners = ownerIds?.length ? ownerIds : isMgmt ? (who === 'all' ? [] : [who]) : [viewer.id];
  const f = useMemo(() => buildForecast(deals, { today, months: span, settings, ownerIds: owners }), [deals, today, span, settings, owners.join(',')]);
  const target = monthlyTargetFor ? monthlyTargetFor(owners.length === 1 ? owners[0] : 'all') : 0;
  const counted = f.months.flatMap(m => m.deals);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <SpanPicker id={`fs-${storeKey}`} value={span} onChange={setSpan} />
        {isMgmt && !ownerIds?.length && (
          <select value={who} onChange={e => setWho(e.target.value)} aria-label="Whose projection" className="rounded-lg border border-line bg-white px-2 py-1 text-sm">
            <option value="all">Whole team</option>
            {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <span className="ml-auto text-sm text-ink-soft">Projected <strong className="text-ink">{formatRM(f.totals.projected)}</strong></span>
      </div>
      <ProjectionBars f={f} target={target} />
      {!compact && <ProjectionTable f={f} />}
      <p className="text-xs text-ink-soft">Open deals count at Hot {settings.hot}%, Warm {settings.warm}%, Cold {settings.cold}% of their value, in the month they're expected to close.</p>
      {(f.unrated.length > 0 || f.noMonth.length > 0) && (
        <p className="rounded-lg bg-attention-soft px-3 py-2 text-sm text-attention">
          Not counted: {[
            f.unrated.length ? `${f.unrated.length} deal${f.unrated.length === 1 ? '' : 's'} with no Hot / Warm / Cold (${formatRM(f.unrated.reduce((t, d) => t + d.value, 0))})` : '',
            f.noMonth.length ? `${f.noMonth.length} open deal${f.noMonth.length === 1 ? '' : 's'} with no expected month or training date` : '',
          ].filter(Boolean).join('; ')}. Set them on the deal (Potential).
        </p>
      )}
      {(counted.length > 0 || f.unrated.length > 0) && (
        <div>
          <button type="button" className="text-sm font-semibold text-accent hover:underline" onClick={() => setShowDeals(s => !s)}>{showDeals ? 'Hide the deals' : `Show the deals (${counted.length + f.unrated.length})`}</button>
          {showDeals && (
            <ul className="mt-2 divide-y divide-line">
              {[...counted, ...f.unrated].map(d => (
                <li key={d.deal.id}>
                  <button type="button" disabled={!onOpenDeal} onClick={() => onOpenDeal?.(d.deal)} className="flex w-full flex-wrap items-center gap-2 py-1.5 text-left text-sm enabled:hover:bg-surface">
                    <span className="min-w-0 flex-1 truncate font-semibold">{clientName(d.deal)}</span>
                    {d.potential ? <PotentialChip deal={d.deal} /> : <span className="text-xs text-attention">Not rated</span>}
                    <span className={`text-xs ${d.overdue ? 'font-semibold text-danger' : 'text-ink-soft'}`}>{d.overdue ? 'Overdue, ' : ''}{forecastMonthLabel(d.month).slice(0, 3)}</span>
                    <span className="w-28 text-right tabular-nums">{formatRM(d.value)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {isMgmt && <ChanceEditor settings={settings} viewer={viewer} />}
    </div>
  );
}

// The weekly presentation's slide (a choice in the Present tab, person and company).
export function ProjectionSlide({ deals, ownerId, today, monthlyTarget, clientName, storeKey }: {
  deals: any[]; ownerId?: string; today: string; monthlyTarget: number; clientName: (p: any) => string; storeKey: string;
}) {
  const settings = useForecastSettings();
  const [span, setSpan] = useForecastSpan(storeKey, 6);
  const f = useMemo(() => buildForecast(deals, { today, months: span, settings, ownerIds: ownerId ? [ownerId] : [] }), [deals, today, span, settings, ownerId]);
  const top = f.months.flatMap(m => m.deals).sort((a, b) => b.weighted - a.weighted).slice(0, 8);
  const stat = 'rounded-xl bg-surface px-4 py-3';
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <SpanPicker id={`fs-slide-${storeKey}`} value={span} onChange={setSpan} />
        <span className="text-sm text-ink-soft">Hot {settings.hot}% · Warm {settings.warm}% · Cold {settings.cold}% of each open deal's value</span>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className={`${stat} bg-accent text-white`}><p className="text-sm opacity-90">Projected</p><p className="text-2xl font-extrabold tabular-nums">{formatRM(f.totals.projected)}</p></div>
        <div className={stat}><p className="text-sm text-ink-soft">Won so far</p><p className="text-2xl font-extrabold tabular-nums">{formatRM(f.totals.won)}</p></div>
        <div className={stat}><p className="text-sm text-ink-soft">From open deals</p><p className="text-2xl font-extrabold tabular-nums">{formatRM(f.totals.weighted)}</p></div>
        <div className={stat}><p className="text-sm text-ink-soft">{monthlyTarget ? `Target (${span} month${span === 1 ? '' : 's'})` : 'If every deal signs'}</p><p className="text-2xl font-extrabold tabular-nums">{formatRM(monthlyTarget ? monthlyTarget * span : f.totals.won + f.totals.pipeline)}</p></div>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <ProjectionBars f={f} target={monthlyTarget} big />
        <ProjectionTable f={f} big />
      </div>
      {top.length > 0 && (
        <div>
          <p className="mb-1 font-bold">Deals that count the most</p>
          <ul className="divide-y divide-line">
            {top.map(d => (
              <li key={d.deal.id} className="flex flex-wrap items-center gap-2 py-2 text-[15px]">
                <span className="min-w-0 flex-1 truncate font-semibold">{clientName(d.deal)}</span>
                <PotentialChip deal={d.deal} size="sm" />
                <span className={`text-sm ${d.overdue ? 'font-semibold text-danger' : 'text-ink-soft'}`}>{d.overdue ? 'Overdue, ' : ''}{forecastMonthLabel(d.month)}</span>
                <span className="w-32 text-right tabular-nums">{formatRM(d.value)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {f.unrated.length > 0 && <p className="text-sm text-attention">{f.unrated.length} open deal{f.unrated.length === 1 ? '' : 's'} in these months have no Hot / Warm / Cold and aren't counted.</p>}
    </div>
  );
}
