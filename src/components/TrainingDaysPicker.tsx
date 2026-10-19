// How long the training runs (Joel, 2026-10-19: "some trainings are half day, some can be 5 days"):
// quick choices Half day, 1 to 5 days, or Other (any length, in half days, up to 60).
// The value is text, as typed ('' = 1 day); lib/deals.ts parseTrainingDays checks it before saving.
import React, { useState } from 'react';

const QUICK: { v: string; text: string }[] = [
  { v: '0.5', text: 'Half day' }, { v: '1', text: '1 day' }, { v: '2', text: '2 days' },
  { v: '3', text: '3 days' }, { v: '4', text: '4 days' }, { v: '5', text: '5 days' },
];

const same = (a: string, b: string) => (Number(a || 1) || 0) === Number(b);

export default function TrainingDaysPicker({ value, onChange, id, label }: {
  value: string; onChange: (v: string) => void; id: string; label?: string;
}) {
  const isQuick = QUICK.some(q => same(value, q.v));
  const [other, setOther] = useState(!isQuick);
  const chip = (on: boolean) => `rounded-full border px-3 py-1 text-sm font-medium ${on ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-soft hover:bg-surface'}`;
  return (
    <div role="group" aria-labelledby={label ? `${id}-label` : undefined} aria-label={label ? undefined : 'Training days'}>
      {label && <span id={`${id}-label`} className="mb-1.5 block text-sm font-semibold text-ink">{label}</span>}
      <div className="flex flex-wrap items-center gap-1.5">
        {QUICK.map(q => (
          <button key={q.v} type="button" aria-pressed={!other && same(value, q.v)} className={chip(!other && same(value, q.v))}
            onClick={() => { setOther(false); onChange(q.v); }}>
            {q.text}
          </button>
        ))}
        <button type="button" aria-pressed={other} className={chip(other)} onClick={() => setOther(true)}>Other</button>
        {other && (
          <span className="flex items-center gap-1.5 text-sm text-ink-soft">
            <input id={id} inputMode="decimal" autoFocus={isQuick /* just switched to Other */} value={value}
              onChange={e => onChange(e.target.value.replace(/[^0-9.]/g, ''))}
              placeholder="e.g. 1.5" aria-label="Number of training days"
              className="w-20 rounded-lg border border-line bg-white px-2.5 py-1 text-[15px] text-ink" />
            days
          </span>
        )}
      </div>
    </div>
  );
}
