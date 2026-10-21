import React from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { KPI_LIGHT_HEX, KpiLight } from '../lib/kpi';
import { LoginRules, dayLight, formatMinutes, loginLight } from '../lib/loginActivity';

// Charts for Team → Login log and the Present slide "Login log" (Management only).
// Colours are the KPI traffic light; grey = no time; days still to come are left blank.

const EMPTY = '#EEF0EB';
const short = (m: number) => (!m ? '' : m < 60 ? `${m}m` : `${Math.round(m / 6) / 10}h`);

export interface HeatColumn { key: string; label: string; days: string[]; week: boolean }

/** People down the side, days (or weeks) across. A day is coloured by its minutes, a week by its light. */
export function LoginHeatmap({ people, columns, minutesOf, rules, todayKey }: {
  people: { id: string; name: string }[];
  columns: HeatColumn[];
  minutesOf: (memberId: string, day: string) => number;
  rules: LoginRules;
  todayKey: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-1 text-sm">
        <thead>
          <tr>
            <th />
            {columns.map(c => <th key={c.key} className="whitespace-nowrap px-0.5 text-center text-xs font-semibold text-ink-soft">{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {people.map(p => (
            <tr key={p.id}>
              <td className="whitespace-nowrap pr-2 font-semibold">{p.name}</td>
              {columns.map(c => {
                const past = c.days.filter(d => d <= todayKey);
                const total = past.reduce((s, d) => s + minutesOf(p.id, d), 0);
                const future = !past.length;
                const inProgress = c.days.includes(todayKey) || (c.week && c.days.some(d => d > todayKey));
                const light: KpiLight | null = future ? null
                  : c.week ? (inProgress ? null : loginLight(c.days, d => minutesOf(p.id, d), rules))
                  : dayLight(total, rules);
                const bg = future ? 'transparent' : light ? KPI_LIGHT_HEX[light] : EMPTY;
                return (
                  <td
                    key={c.key}
                    title={`${p.name}, ${c.label}: ${formatMinutes(total)}${inProgress ? ' (so far)' : ''}`}
                    className="h-8 min-w-[2.25rem] rounded-md px-1 text-center text-xs font-bold tabular-nums"
                    style={{ background: bg, color: light ? '#fff' : 'var(--color-ink-soft)', outline: inProgress && !future ? '2px dashed #8FA3BF' : undefined, outlineOffset: -2 }}
                  >
                    {short(total)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-soft">
        {(['green', 'amber', 'red'] as KpiLight[]).map(l => (
          <span key={l} className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm" style={{ background: KPI_LIGHT_HEX[l] }} /> {l === 'green' ? 'Green' : l === 'amber' ? 'Amber' : 'Red'}</span>
        ))}
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm" style={{ background: EMPTY }} /> No time</span>
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm" style={{ outline: '2px dashed #8FA3BF', outlineOffset: -2 }} /> Still in progress</span>
      </div>
    </div>
  );
}

/** Bars of hours per day or per week (average per working day), coloured by the rules, with the green and amber lines. */
export function LoginGraph({ data, rules, height = 300, animate = true }: {
  data: { label: string; minutes: number; light: KpiLight | null }[];
  rules: LoginRules;
  height?: number;
  animate?: boolean;
}) {
  const rows = data.map(d => ({ ...d, hours: Math.round(d.minutes / 6) / 10 }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} margin={{ top: 16, right: 48, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E2E5DE" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#4A5872' }} interval="preserveStartEnd" minTickGap={4} />
        <YAxis tick={{ fontSize: 12, fill: '#4A5872' }} width={36} unit="h" />
        <Tooltip formatter={(_v: any, _n: any, item: any) => [formatMinutes(item.payload.minutes), 'Time']} cursor={{ fill: 'rgba(14,110,98,0.06)' }} />
        <ReferenceLine y={rules.greenMinutes / 60} stroke={KPI_LIGHT_HEX.green} strokeDasharray="5 4" label={{ value: 'Green', position: 'right', fontSize: 11, fill: KPI_LIGHT_HEX.green }} />
        <ReferenceLine y={rules.amberMinutes / 60} stroke={KPI_LIGHT_HEX.amber} strokeDasharray="5 4" label={{ value: 'Amber', position: 'right', fontSize: 11, fill: KPI_LIGHT_HEX.amber }} />
        <Bar dataKey="hours" radius={[6, 6, 0, 0]} maxBarSize={40} isAnimationActive={animate}>
          {rows.map((r, i) => <Cell key={i} fill={r.light ? KPI_LIGHT_HEX[r.light] : '#8FA3BF'} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
