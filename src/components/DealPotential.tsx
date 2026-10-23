import React, { useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db, friendlyError } from '../lib/firebase';
import { addMonths, forecastMonthLabel, Potential, POTENTIALS, POTENTIAL_DOT, POTENTIAL_HINTS, POTENTIAL_LABELS, POTENTIAL_TONE, potentialOf } from '../lib/forecast';
import { todayIso } from '../lib/deals';

// Hot / Warm / Cold tag on a deal (Joel, 2026-10-21). See lib/forecast.ts.
export function PotentialChip({ deal, size = 'xs' }: { deal: any; size?: 'xs' | 'sm' }) {
  const p = potentialOf(deal);
  if (!p) return null;
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-semibold ${size === 'xs' ? 'text-xs' : 'text-sm'} ${POTENTIAL_TONE[p]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${POTENTIAL_DOT[p]}`} />{POTENTIAL_LABELS[p]}
    </span>
  );
}

// The next 12 months to pick the expected closing month from (plus the deal's own month if it is older).
export function monthOptions(current = ''): string[] {
  const first = todayIso().slice(0, 7);
  const list = Array.from({ length: 12 }, (_, i) => addMonths(first, i));
  return current && !list.includes(current) ? [current, ...list] : list;
}

// Three buttons for the potential, used in the deal form and on the deal panel.
export function PotentialButtons({ value, onChange, disabled }: { value: Potential | ''; onChange: (v: Potential | '') => void; disabled?: boolean }) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {POTENTIALS.map(k => (
        <button key={k} type="button" disabled={disabled} aria-pressed={value === k} onClick={() => onChange(value === k ? '' : k)}
          className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm disabled:opacity-60 ${value === k ? POTENTIAL_TONE[k] : 'border-line hover:bg-surface'}`}>
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${POTENTIAL_DOT[k]}`} />
          <span><span className="block font-semibold">{POTENTIAL_LABELS[k]}</span><span className="block text-xs text-ink-soft">{POTENTIAL_HINTS[k]}</span></span>
        </button>
      ))}
    </div>
  );
}

// Quick change on the deal panel, saved straight away.
export function PotentialBox({ deal, editable, viewer }: { deal: any; editable: boolean; viewer: { id: string; name: string } }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const month = typeof deal.expectedMonth === 'string' ? deal.expectedMonth.slice(0, 7) : '';
  const save = async (patch: Record<string, string>, what: string) => {
    setBusy(true); setErr('');
    try {
      await updateDoc(doc(db, 'pipelines', deal.id), {
        ...patch,
        history: [...(deal.history || []), { at: new Date().toISOString(), byId: viewer.id, byName: viewer.name, action: what }],
      });
    } catch (e) { setErr(friendlyError(e)); }
    setBusy(false);
  };
  if (!editable) {
    const p = potentialOf(deal);
    return (
      <p className="text-[15px]">
        {p ? <PotentialChip deal={deal} size="sm" /> : <span className="text-ink-soft">Potential not set</span>}
        {month && <span className="ml-2 text-ink-soft">Expected to close {forecastMonthLabel(month)}</span>}
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <PotentialButtons value={potentialOf(deal)} disabled={busy}
        onChange={v => save({ potential: v }, v ? `Potential set to ${POTENTIAL_LABELS[v]}` : 'Potential cleared')} />
      <label className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-ink-soft">Expected to close in</span>
        <select value={month} disabled={busy} onChange={e => save({ expectedMonth: e.target.value }, e.target.value ? `Expected to close ${forecastMonthLabel(e.target.value)}` : 'Expected closing month cleared')}
          className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm">
          <option value="">Not set</option>
          {monthOptions(month).map(m => <option key={m} value={m}>{forecastMonthLabel(m)}</option>)}
        </select>
      </label>
      {err && <p className="text-sm text-danger">{err}</p>}
    </div>
  );
}
