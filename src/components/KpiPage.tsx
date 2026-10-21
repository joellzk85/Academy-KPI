import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { Check, HandHelping, Loader2, Pencil, Presentation, UserCheck } from 'lucide-react';
import PresentPage from './PresentPage';
import { db } from '../lib/firebase';
import { Representative } from '../types';
import { KpiRow, kpiValueText, LIGHT_BADGE, metricsFor, monthChoices, monthKpi, monthLabel, monthPrefix, ResolvedMetric, rowBarClass, takesTyped, weekIndexOf } from '../lib/kpi';
import { bandsText, LIGHT_LABELS, MEASURE_INFO } from '../lib/kpiLibrary';
import { useKpiSources } from '../lib/useKpiSources';
import { formatDate, formatRM, todayIso } from '../lib/deals';
import { linkedOnly } from '../lib/linked';

// The KPI page (redesigned 2026-10-16).
// - Numbers: automatic KPIs are counted from deals (or, for Admin, HRDC claims recorded and venues
//   added); typed KPIs (e.g. Admin's rating) are keyed in per week. Admin's claims and venues also
//   take typed numbers, added on top of the automatic count. Saved per person per month in month_kpis (via onUpdateRepKpi).
// - Weekly check-in: what I got done, where I need help, target date, accountability partner,
//   and teammates I'd like help from. Stored in the same per-week lists as before, so old entries show.
// - "Done" on a teammate's request is saved in the helper's own month doc (helpDoneList) because
//   people can only change their own KPI records.

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };
const WEEKS = [0, 1, 2, 3, 4];

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const label = 'mb-1 block text-sm font-semibold text-ink';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';

const listAt = (kpi: any, key: string, w: number): any => (Array.isArray(kpi?.[key]) ? kpi[key][w] : undefined);
const doneKey = (askerId: string, w: number) => `${askerId}:${w}`;

export interface Ask { from: Representative; week: number; partner: boolean; note: string; done: boolean }

// Requests from teammates to this person (as accountability partner or asked for help), this month.
export function asksFor(rep: Representative, reps: Representative[]): Ask[] {
  const mine: string[] = (rep.kpi as any)?.helpDoneList || [];
  const out: Ask[] = [];
  reps.filter(r => r.id !== rep.id).forEach(r => {
    WEEKS.forEach(w => {
      const tagged: string[] = listAt(r.kpi, 'taggedRepIdsList', w) || (w === 0 ? (r.kpi as any)?.taggedRepIds || [] : []);
      const partner = listAt(r.kpi, 'accountabilityPartnerIdList', w) === rep.id;
      if (!partner && !tagged.includes(rep.id)) return;
      const legacyDone = (listAt(r.kpi, 'completedTagsList', w) || []).includes(rep.id) || (partner && !!listAt(r.kpi, 'completedAccountabilityList', w));
      out.push({ from: r, week: w, partner, note: listAt(r.kpi, 'tagNoteList', w) || '', done: mine.includes(doneKey(r.id, w)) || legacyDone });
    });
  });
  return out;
}

export default function KpiPage({ rep, reps, viewer, selectedMonth, onMonthChange, onUpdateRepKpi }: {
  rep: Representative;
  reps: Representative[];
  viewer?: Viewer;
  selectedMonth: string;
  onMonthChange: (m: string) => void;
  onUpdateRepKpi: (repId: string, kpi: Representative['kpi']) => void;
}) {
  const [deals, setDeals] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => onSnapshot(query(collection(db, 'pipelines')), s => { setDeals(linkedOnly(s.docs.map(d => ({ ...d.data(), id: d.id })))); setLoaded(true); }, () => setLoaded(true)), []);
  const sources = useKpiSources({ months: [selectedMonth], people: reps });

  const isMe = !viewer || viewer.id === rep.id;
  const canEdit = isMe || (viewer && viewer.role !== 'rep');
  const metrics = metricsFor(rep);
  const kpi: any = rep.kpi || {};
  const thisMonth = monthPrefix(selectedMonth) === todayIso().slice(0, 7);

  // Shared with Management's Team performance (lib/kpi.ts), so both show the same numbers.
  const { rows, score } = monthKpi(rep, deals, selectedMonth, { ...sources, people: reps });
  const typed = metrics.filter(takesTyped);

  const save = (changes: Record<string, any>) => onUpdateRepKpi(rep.id, { ...JSON.parse(JSON.stringify(rep.kpi || {})), ...changes });
  const fmt = (m: ResolvedMetric, v: number) => kpiValueText(m, v, formatRM);

  // Present tab (2026-10-21): the weekly presentation, built from these same numbers.
  const [tab, setTab] = useState<'numbers' | 'present'>('numbers');
  const tabs = (
    <div className="inline-flex rounded-xl border border-line bg-white p-1" role="tablist" aria-label="KPI page">
      {([['numbers', 'Numbers and check-in'], ['present', 'Present']] as const).map(([k, l]) => (
        <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
          className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors ${tab === k ? 'bg-accent text-white' : 'text-ink-soft hover:text-ink'}`}>
          {k === 'present' && <Presentation className="h-4 w-4" />}{l}
        </button>
      ))}
    </div>
  );
  if (tab === 'present') {
    return (
      <div className="space-y-5">
        {tabs}
        <PresentPage viewer={viewer || { id: rep.id, name: rep.name, role: rep.role || 'rep' }} person={rep} reps={reps} month={selectedMonth} />
      </div>
    );
  }

  return (
    <div className="space-y-5 font-sans text-ink">
      {tabs}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">KPI</h2>
          <p className="mt-0.5 text-[15px] text-ink-soft">{isMe ? 'Your' : `${rep.name}'s`} numbers and weekly check-in.</p>
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold text-ink-soft">
          Month
          <select value={selectedMonth} onChange={e => onMonthChange(e.target.value)} className={`${input} w-auto`}>
            {monthChoices(todayIso(), selectedMonth).map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </label>
      </div>

      {/* This month */}
      <section className="rounded-2xl border border-line bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-bold">This month</h3>
          <span className="text-sm text-ink-soft">{metrics.map(m => `${m.label} ${Math.round(m.weight * 100)}%`).join(' · ')}</span>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <div className="h-3 flex-1 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-accent" style={{ width: `${score}%` }} /></div>
          <span className="w-24 text-right text-lg font-bold tabular-nums">{score}% score</span>
        </div>
        {!loaded ? (
          <p className="mt-4 flex items-center gap-2 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Counting from deals…</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {rows.map(row => <KpiLine key={row.m.key} row={row} fmt={fmt} />)}
          </ul>
        )}
      </section>

      <WeeklyTable rows={rows} typed={typed} canEdit={!!canEdit} kpi={kpi} fmt={fmt} onSave={save} />

      <CheckIn rep={rep} reps={reps} canEdit={!!canEdit} isMe={isMe} thisMonth={thisMonth} onSave={save} />
    </div>
  );
}

// ---------- One KPI this month ----------
// Target KPIs: "12 of 20 · 60%". Band KPIs (lib/kpiLibrary.ts): the figure and its colour, with the bands.
function KpiLine({ row, fmt }: { row: KpiRow; fmt: (m: ResolvedMetric, v: number) => string }) {
  const { m, total, pct, autoTotal, typedTotal, hasData, light } = row;
  const how = !m.auto ? 'typed in weekly' : `${MEASURE_INFO[m.auto]?.label || 'automatic'}${m.plusTyped ? ', plus any typed' : ''}`;
  return (
    <li>
      <div className="flex flex-wrap justify-between gap-2 text-[15px]">
        <span className="font-semibold">{m.label} <span className="text-sm font-normal text-ink-soft">({how}) · {Math.round(m.weight * 100)}%</span></span>
        {!hasData ? (
          <span className="text-sm text-ink-soft">Nothing to count this month, left out of the score</span>
        ) : m.scoring === 'bands' ? (
          <span className="flex items-center gap-2 tabular-nums">
            <strong>{fmt(m, total)}</strong>
            <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${LIGHT_BADGE[light]}`}>{LIGHT_LABELS[light]}</span>
          </span>
        ) : (
          <span className="tabular-nums text-ink-soft">
            <strong className="text-ink">{fmt(m, total)}</strong> of {fmt(m, m.targetVal)} · {pct}%
            {m.plusTyped && typedTotal > 0 && <span className="block text-right text-xs">{fmt(m, autoTotal)} automatic + {fmt(m, typedTotal)} typed</span>}
          </span>
        )}
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-line"><div className={`h-full rounded-full ${rowBarClass(row)}`} style={{ width: `${hasData ? Math.max(pct, 3) : 0}%` }} /></div>
      {m.scoring === 'bands' && <p className="mt-1 text-xs text-ink-soft">{bandsText(m.bands, m.unit)}{m.perWeek ? ', per week' : ''}</p>}
    </li>
  );
}

// ---------- Weekly numbers ----------
function WeeklyTable({ rows, typed, canEdit, kpi, fmt, onSave }: {
  rows: KpiRow[]; typed: ResolvedMetric[]; canEdit: boolean; kpi: any;
  fmt: (m: ResolvedMetric, v: number) => string; onSave: (c: Record<string, any>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  const start = () => {
    const d: Record<string, string[]> = {};
    typed.forEach(m => { d[m.key] = WEEKS.map(w => (Number(kpi[m.key]?.[w]) ? String(kpi[m.key][w]) : '')); });
    setDraft(d);
    setEditing(true);
  };
  const saveDraft = () => {
    const changes: Record<string, number[]> = {};
    typed.forEach(m => {
      changes[m.key] = WEEKS.map(w => {
        let v = parseFloat(draft[m.key]?.[w] || '') || 0;
        if (m.unit === 'rating' || /rating/i.test(m.label)) v = Math.max(0, Math.min(5, v));
        return Math.max(0, v);
      });
    });
    onSave(changes);
    setEditing(false);
  };

  return (
    <section className="rounded-2xl border border-line bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold">By week</h3>
        {canEdit && typed.length > 0 && !editing && <button type="button" className={btnSecondary} onClick={start}><Pencil className="h-4 w-4" /> Key in weekly numbers</button>}
        {editing && (
          <span className="flex gap-2">
            <button type="button" className={btnSecondary} onClick={() => setEditing(false)}>Cancel</button>
            <button type="button" className={btnPrimary} onClick={saveDraft}>Save</button>
          </span>
        )}
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[560px] text-[15px]">
          <thead>
            <tr className="border-b border-line text-left text-sm text-ink-soft">
              <th className="py-2 pr-3 font-semibold">KPI</th>
              {WEEKS.map(w => <th key={w} className="px-2 py-2 text-center font-semibold">Week {w + 1}</th>)}
              <th className="py-2 pl-3 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ m, weeks, total, weekly, hasData }) => {
              const editable = editing && takesTyped(m);
              return (
                <tr key={m.key} className="border-b border-line last:border-0">
                  <td className="py-2.5 pr-3 font-semibold">{m.label}</td>
                  {weeks.map((v, w) => (
                    <td key={w} className="px-2 py-2 text-center tabular-nums">
                      {editable ? (
                        <input inputMode="decimal" value={draft[m.key]?.[w] ?? ''} aria-label={`${m.label}, week ${w + 1}`}
                          onChange={e => setDraft(d => ({ ...d, [m.key]: (d[m.key] || []).map((x, i) => (i === w ? e.target.value.replace(/[^0-9.]/g, '') : x)) }))}
                          className="w-20 rounded-md border border-line px-2 py-1 text-center focus:border-accent focus:outline-none" />
                      ) : weekly && v ? (m.isRM ? formatRM(v) : String(Math.round(v * 10) / 10)) : <span className="text-ink-soft/50">–</span>}
                    </td>
                  ))}
                  <td className="py-2.5 pl-3 text-right font-semibold tabular-nums">{hasData ? fmt(m, total) : '–'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {editing && typed.some(m => m.unit === 'rating' || /rating/i.test(m.label)) &&<p className="mt-2 text-sm text-ink-soft">Ratings are from 1 to 5 each week.</p>}
      {editing && typed.some(m => m.plusTyped) && (
        <p className="mt-1 text-sm text-ink-soft">
          {typed.filter(m => m.plusTyped).map(m => m.label).join(' and ')} {typed.filter(m => m.plusTyped).length > 1 ? 'are' : 'is'} counted automatically.
          Only type extras the CRM doesn't know about; they are added on top.
        </p>
      )}
    </section>
  );
}

// ---------- Weekly check-in ----------
function CheckIn({ rep, reps, canEdit, isMe, thisMonth, onSave }: {
  rep: Representative; reps: Representative[]; canEdit: boolean; isMe: boolean; thisMonth: boolean; onSave: (c: Record<string, any>) => void;
}) {
  const kpi: any = rep.kpi || {};
  const [week, setWeek] = useState(() => (thisMonth ? weekIndexOf(todayIso()) : 0));
  const [editing, setEditing] = useState(false);
  const teammates = reps.filter(r => r.id !== rep.id);
  const nameOf = (id: string) => reps.find(r => r.id === id)?.name || 'Former team member';

  const current = useMemo(() => ({
    progress: listAt(kpi, 'lastWeekProgressList', week) ?? (week === 0 ? kpi.lastWeekProgress || '' : ''),
    help: listAt(kpi, 'helpNeededList', week) ?? (week === 0 ? kpi.helpNeeded || '' : ''),
    date: listAt(kpi, 'datelineList', week) ?? (week === 0 ? kpi.dateline || '' : ''),
    partner: listAt(kpi, 'accountabilityPartnerIdList', week) ?? (week === 0 ? kpi.accountabilityPartnerId || '' : ''),
    tagged: (listAt(kpi, 'taggedRepIdsList', week) ?? (week === 0 ? kpi.taggedRepIds || [] : [])) as string[],
    note: listAt(kpi, 'tagNoteList', week) ?? (week === 0 ? kpi.tagNote || '' : ''),
  }), [kpi, week]);
  const [form, setForm] = useState(current);
  useEffect(() => { if (!editing) setForm(current); }, [current, editing]);

  const setAt = (key: string, value: any, fill: any) => {
    const arr = Array.isArray(kpi[key]) ? [...kpi[key]] : [];
    while (arr.length < 5) arr.push(fill);
    arr[week] = value;
    return arr;
  };
  const saveForm = () => {
    onSave({
      lastWeekProgressList: setAt('lastWeekProgressList', form.progress.trim(), ''),
      helpNeededList: setAt('helpNeededList', form.help.trim(), ''),
      datelineList: setAt('datelineList', form.date, ''),
      accountabilityPartnerIdList: setAt('accountabilityPartnerIdList', form.partner, ''),
      taggedRepIdsList: setAt('taggedRepIdsList', form.tagged, []),
      tagNoteList: setAt('tagNoteList', form.note.trim(), ''),
    });
    setEditing(false);
  };

  // Requests to this person from teammates, for the chosen week first.
  const asks = asksFor(rep, reps);
  const open = asks.filter(a => !a.done);
  const markDone = (a: Ask) => {
    const list: string[] = [...((kpi.helpDoneList as string[]) || [])];
    if (!list.includes(doneKey(a.from.id, a.week))) list.push(doneKey(a.from.id, a.week));
    onSave({ helpDoneList: list });
  };
  // Who has answered this person's own requests for the chosen week.
  const answered = (helperId: string) => {
    const helper = reps.find(r => r.id === helperId);
    return ((helper?.kpi as any)?.helpDoneList || []).includes(doneKey(rep.id, week)) || (listAt(kpi, 'completedTagsList', week) || []).includes(helperId);
  };

  return (
    <section className="space-y-4">
      {isMe && open.length > 0 && (
        <div className="rounded-2xl border border-attention/30 bg-attention-soft p-4">
          <p className="flex items-center gap-2 font-semibold text-attention"><HandHelping className="h-4 w-4" /> Teammates asking for your help ({open.length})</p>
          <ul className="mt-2 space-y-2">
            {open.map(a => (
              <li key={`${a.from.id}_${a.week}`} className="flex flex-wrap items-center justify-between gap-2 text-sm text-attention">
                <span>
                  <strong>{a.from.name}</strong>, week {a.week + 1}: {a.partner ? 'you are their accountability partner' : 'asked for your help'}
                  {a.note ? ` — "${a.note}"` : ''}
                </span>
                <button type="button" className={btnSecondary} onClick={() => markDone(a)}><Check className="h-3.5 w-3.5" /> Done</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-2xl border border-line bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-bold">Weekly check-in</h3>
          <div className="inline-flex rounded-lg border border-line bg-white p-0.5" role="tablist" aria-label="Week">
            {WEEKS.map(w => (
              <button key={w} type="button" role="tab" aria-selected={week === w} onClick={() => { setWeek(w); setEditing(false); }}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold ${week === w ? 'bg-ink text-white' : 'text-ink-soft hover:text-ink'}`}>
                Week {w + 1}
              </button>
            ))}
          </div>
        </div>

        {editing ? (
          <div className="mt-4 space-y-4">
            <div>
              <label htmlFor="ci-p" className={label}>What did I get done?</label>
              <textarea id="ci-p" value={form.progress} onChange={e => setForm(f => ({ ...f, progress: e.target.value }))} className={`${input} min-h-[70px]`} />
            </div>
            <div>
              <label htmlFor="ci-h" className={label}>Where do I need help?</label>
              <textarea id="ci-h" value={form.help} onChange={e => setForm(f => ({ ...f, help: e.target.value }))} className={`${input} min-h-[60px]`} placeholder="Leave blank if nothing" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="ci-d" className={label}>Target date</label>
                <input id="ci-d" type="date" value={/^\d{4}-\d{2}-\d{2}$/.test(form.date) ? form.date : ''} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className={input} />
              </div>
              <div>
                <label htmlFor="ci-ap" className={label}>Accountability partner</label>
                <select id="ci-ap" value={form.partner} onChange={e => setForm(f => ({ ...f, partner: e.target.value }))} className={input}>
                  <option value="">No one</option>
                  {teammates.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
            </div>
            <div>
              <span className={label}>Ask teammates for help (optional)</span>
              <div className="flex flex-wrap gap-2">
                {teammates.map(r => {
                  const on = form.tagged.includes(r.id);
                  return (
                    <button key={r.id} type="button" aria-pressed={on} onClick={() => setForm(f => ({ ...f, tagged: on ? f.tagged.filter(x => x !== r.id) : [...f.tagged, r.id] }))}
                      className={`rounded-full border px-3 py-1 text-sm font-medium ${on ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-soft hover:bg-surface'}`}>
                      {r.name}
                    </button>
                  );
                })}
              </div>
              {form.tagged.length > 0 && <input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} className={`${input} mt-2`} placeholder="What do you need from them?" aria-label="Note for teammates" />}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className={btnSecondary} onClick={() => setEditing(false)}>Cancel</button>
              <button type="button" className={btnPrimary} onClick={saveForm}>Save week {week + 1}</button>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <dl className="grid gap-3 sm:grid-cols-2">
              <Field term="What I got done" value={current.progress} />
              <Field term="Where I need help" value={current.help} />
              <Field term="Target date" value={/^\d{4}-\d{2}-\d{2}$/.test(current.date) ? formatDate(current.date) : current.date} />
              <Field term="Accountability partner" value={current.partner ? nameOf(current.partner) : ''} icon={<UserCheck className="h-4 w-4 text-accent" />} />
            </dl>
            {current.tagged.length > 0 && (
              <p className="text-sm text-ink-soft">
                Asked for help: {current.tagged.map(id => `${nameOf(id)}${answered(id) ? ' (done)' : ''}`).join(', ')}{current.note ? ` — "${current.note}"` : ''}
              </p>
            )}
            {canEdit && <button type="button" className={btnSecondary} onClick={() => setEditing(true)}><Pencil className="h-4 w-4" /> {current.progress || current.help || current.partner ? 'Edit' : 'Fill in'} week {week + 1}</button>}
          </div>
        )}
      </div>
    </section>
  );
}

function Field({ term, value, icon }: { term: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-surface px-3.5 py-2.5">
      <dt className="flex items-center gap-1.5 text-sm text-ink-soft">{icon}{term}</dt>
      <dd className={`mt-0.5 whitespace-pre-line ${value ? 'font-semibold' : 'text-ink-soft/70'}`}>{value || 'Not filled in'}</dd>
    </div>
  );
}
