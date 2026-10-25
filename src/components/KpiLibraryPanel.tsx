import React, { useMemo, useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { ChevronDown, ChevronRight, EyeOff, Loader2, Plus, Trash2, X } from 'lucide-react';
import PanelResizer from './PanelResizer';
import DraftBar from './DraftBar';
import { db, friendlyError } from '../lib/firebase';
import { useFormDraft } from '../lib/useFormDraft';
import { TeamMember } from '../types';
import {
  activeKpiLibrary, Bands, BUILT_IN_KPIS, bandsProblem, bandsText, GROUP_LABELS, isGpMeasure, KpiDef, KpiGroup, KpiUnit,
  LIGHT_LABELS, MEASURE_INFO, newCustomKpiId, ScorePoints, UNIT_LABELS,
} from '../lib/kpiLibrary';

// KPI & appraisal → Settings → KPI library (Management, Joel 2026-10-22): every KPI that can go in a person's KPI set, the points each
// colour earns, and the company gross profit bands (also used by Project P&L and the Costing estimator).
// Saved to config/kpi_library (lib/kpiLibrary.ts): only the changes to built-in KPIs, plus the KPIs Management made.

const input = 'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const small = 'w-24 rounded-lg border border-line bg-white px-2.5 py-1.5 text-right text-[15px] focus:border-accent focus:outline-none';
const label = 'mb-1 block text-sm font-semibold text-ink';
const primaryBtn = 'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-[15px] font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const secondaryBtn = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-50';

// Bands as typed (text), so a half-typed number doesn't jump.
export interface BandsDraft { higher: boolean; green: string; amber: string; red: string; noGrey: boolean }
export const bandsToDraft = (b: Bands): BandsDraft => ({ higher: b.higher, green: String(b.green), amber: String(b.amber), red: b.red === null ? '' : String(b.red), noGrey: b.red === null });
export const draftToBands = (d: BandsDraft): Bands => ({ higher: d.higher, green: Number(d.green), amber: Number(d.amber), red: d.noGrey ? null : Number(d.red) });
const numText = (v: string) => v.replace(/[^0-9.]/g, '');

// The colour bands of one KPI: which way is better, and where green, amber and red start.
export function BandsEditor({ value, onChange, unit, id, fixedDirection }: {
  value: BandsDraft; onChange: (b: BandsDraft) => void; unit: KpiUnit; id: string; fixedDirection?: boolean;
}) {
  const word = value.higher ? 'or more' : 'or less';
  const u = unit === 'pct' ? '%' : unit === 'days' ? 'days' : unit === 'rm' ? 'RM' : '';
  const row = (key: 'green' | 'amber' | 'red', dot: string) => (
    <label className="flex items-center gap-2 text-sm" htmlFor={`${id}-${key}`}>
      <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
      <span className="w-14 font-semibold">{LIGHT_LABELS[key]}</span>
      <input id={`${id}-${key}`} inputMode="decimal" className={small} value={value[key]} onChange={e => onChange({ ...value, [key]: numText(e.target.value) })} />
      <span className="text-ink-soft">{u} {word}</span>
    </label>
  );
  return (
    <div className="space-y-2">
      {!fixedDirection && (
        <div className="inline-flex rounded-lg border border-line bg-white p-0.5 text-sm" role="radiogroup" aria-label="Which way is better">
          {[true, false].map(h => (
            <button key={String(h)} type="button" role="radio" aria-checked={value.higher === h} onClick={() => onChange({ ...value, higher: h })}
              className={`rounded-md px-3 py-1 font-semibold ${value.higher === h ? 'bg-ink text-white' : 'text-ink-soft hover:text-ink'}`}>
              {h ? 'Higher is better' : 'Lower is better'}
            </button>
          ))}
        </div>
      )}
      {row('green', 'bg-[#16A34A]')}
      {row('amber', 'bg-[#F59E0B]')}
      {value.noGrey
        ? <p className="flex items-center gap-2 text-sm"><span className="h-2.5 w-2.5 rounded-full bg-[#DC2626]" /><span className="w-14 font-semibold">Red</span><span className="text-ink-soft">everything past amber</span></p>
        : row('red', 'bg-[#DC2626]')}
      <label className="flex items-center gap-2 text-sm text-ink-soft">
        <input type="checkbox" className="accent-[#0E6E62]" checked={!value.noGrey} onChange={e => onChange({ ...value, noGrey: !e.target.checked, red: value.red || value.amber })} />
        Grey past red (scores {activeKpiLibrary().points.grey} points)
      </label>
    </div>
  );
}

interface DefDraft {
  id: string; name: string; description: string; group: KpiGroup; measure: string; unit: KpiUnit;
  typedAgg: 'sum' | 'average'; plusTyped: boolean; scoring: 'target' | 'bands'; target: string; bands: BandsDraft; param: string;
  hidden: boolean; custom: boolean;
}
interface LibDraft { defs: DefDraft[]; points: Record<keyof ScorePoints, string>; gpBands: BandsDraft }

const toDefDraft = (d: KpiDef): DefDraft => ({
  id: d.id, name: d.name, description: d.description, group: d.group, measure: d.measure, unit: d.unit,
  typedAgg: d.typedAgg || 'sum', plusTyped: !!d.plusTyped, scoring: d.scoring, target: String(d.target), bands: bandsToDraft(d.bands),
  param: d.param === undefined ? '' : String(d.param), hidden: !!d.hidden, custom: !!d.custom,
});

function startDraft(): LibDraft {
  const lib = activeKpiLibrary();
  return {
    defs: lib.defs.map(toDefDraft),
    points: { green: String(lib.points.green), amber: String(lib.points.amber), red: String(lib.points.red), grey: String(lib.points.grey) },
    gpBands: bandsToDraft(lib.gpBands),
  };
}

const sameBands = (a: Bands, b: Bands) => a.higher === b.higher && a.green === b.green && a.amber === b.amber && a.red === b.red;

export default function KpiLibraryPanel({ viewer, usedBy, onClose, onSaved }: {
  viewer: TeamMember;
  usedBy: (kpiId: string) => string[];     // names of people whose KPI set has this KPI
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const [draft, setDraft] = useState<LibDraft>(startDraft);
  const [open, setOpen] = useState<string>('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const formDraft = useFormDraft(viewer.id, 'kpi-library', draft, setDraft);

  const setDef = (id: string, ch: Partial<DefDraft>) => { setDraft(d => ({ ...d, defs: d.defs.map(x => (x.id === id ? { ...x, ...ch } : x)) })); setError(''); };

  const addCustom = () => {
    const id = newCustomKpiId();
    setDraft(d => ({
      ...d,
      defs: [...d.defs, {
        id, name: '', description: '', group: 'other', measure: 'typed', unit: 'count', typedAgg: 'sum', plusTyped: false,
        scoring: 'target', target: '1', bands: bandsToDraft({ higher: true, green: 3, amber: 2, red: 1 }), param: '', hidden: false, custom: true,
      }],
    }));
    setOpen(id);
  };
  const removeCustom = (d: DefDraft) => {
    const people = usedBy(d.id);
    if (people.length) return setError(`"${d.name || 'This KPI'}" is in the KPI set of ${people.join(', ')}. Take it out of their sets first.`);
    setDraft(x => ({ ...x, defs: x.defs.filter(y => y.id !== d.id) }));
  };

  const groups = useMemo(() => (Object.keys(GROUP_LABELS) as KpiGroup[]).map(g => ({ g, defs: draft.defs.filter(d => d.group === g) })).filter(x => x.defs.length), [draft.defs]);

  const save = async () => {
    const pts: any = {};
    for (const k of ['green', 'amber', 'red', 'grey'] as const) {
      const v = Number(draft.points[k]);
      if (!Number.isFinite(v) || v < 0 || v > 100) return setError('Points for each colour must be from 0 to 100.');
      pts[k] = v;
    }
    const gp = draftToBands({ ...draft.gpBands, higher: true });
    const gpProblem = bandsProblem(gp);
    if (gpProblem) return setError(`Company gross profit bands: ${gpProblem}`);
    const overrides: Record<string, any> = {};
    const custom: any[] = [];
    for (const d of draft.defs) {
      const name = d.name.trim();
      if (!name) return setError('Every KPI needs a name.');
      const target = Number(d.target);
      if (d.scoring === 'target' && !(target > 0)) return setError(`Enter a default target above 0 for ${name}.`);
      const bands = draftToBands(d.bands);
      if (d.scoring === 'bands' && !isGpMeasure(d.measure)) {
        const p = bandsProblem(bands);
        if (p) return setError(`${name}: ${p}`);
      }
      const param = d.param === '' ? undefined : Number(d.param);
      if (MEASURE_INFO[d.measure]?.paramLabel && !(param !== undefined && param >= 0)) return setError(`Enter the ${MEASURE_INFO[d.measure].paramLabel} for ${name}.`);
      const full: any = { name, description: d.description.trim(), scoring: d.scoring, target: Number.isFinite(target) ? target : 1, bands, hidden: d.hidden, ...(param !== undefined ? { param } : {}) };
      if (d.custom) {
        custom.push({ id: d.id, ...full, group: d.group, measure: d.measure, unit: d.unit, typedAgg: d.typedAgg, plusTyped: d.measure !== 'typed' && d.plusTyped, custom: true });
        continue;
      }
      // Built-in: keep only what differs from the CRM's own default.
      const base = BUILT_IN_KPIS.find(b => b.id === d.id)!;
      const ch: any = {};
      if (full.name !== base.name) ch.name = full.name;
      if (full.description !== base.description) ch.description = full.description;
      if (full.scoring !== base.scoring) ch.scoring = full.scoring;
      if (full.target !== base.target) ch.target = full.target;
      if (!sameBands(bands, base.bands)) ch.bands = bands;
      if (param !== undefined && param !== base.param) ch.param = param;
      if (!!full.hidden !== !!base.hidden) ch.hidden = full.hidden;
      if (Object.keys(ch).length) overrides[d.id] = ch;
    }
    setBusy(true);
    try {
      await setDoc(doc(db, 'config', 'kpi_library'), { overrides, custom, points: pts, gpBands: gp, updatedAt: new Date().toISOString(), updatedById: viewer.id, updatedByName: viewer.name });
      formDraft.clear();
      onSaved('The KPI library has been saved.');
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" role="dialog" aria-modal="true" aria-label="KPI library">
      <PanelResizer />
      <div className="flex h-full w-full flex-col bg-surface shadow-xl md:w-[var(--panel-w,max(50vw,40rem))] md:min-w-[24rem] md:max-w-[95vw]">
        <div className="flex items-start justify-between gap-3 border-b border-line bg-white px-5 py-4">
          <div>
            <h3 className="text-lg font-bold">KPI library</h3>
            <p className="text-sm text-ink-soft">Every KPI you can put in someone's KPI set. Targets and bands here are the starting values; each person's own can differ.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-ink-soft hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <DraftBar draft={formDraft} what="change to the KPI library" />

          <section className="rounded-2xl border border-line bg-white p-4">
            <h4 className="font-bold">Points each colour earns</h4>
            <p className="mt-0.5 text-sm text-ink-soft">For KPIs scored by colour bands: the share of the KPI's weight it earns. KPIs scored against a target earn their % of target.</p>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(['green', 'amber', 'red', 'grey'] as const).map(k => (
                <label key={k} className="text-sm font-semibold" htmlFor={`pts-${k}`}>
                  {LIGHT_LABELS[k]}
                  <span className="mt-1 flex items-center gap-1.5 font-normal">
                    <input id={`pts-${k}`} inputMode="decimal" className={small} value={draft.points[k]} onChange={e => { setDraft(d => ({ ...d, points: { ...d.points, [k]: numText(e.target.value) } })); setError(''); }} />%
                  </span>
                </label>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-line bg-white p-4">
            <h4 className="font-bold">Company gross profit bands</h4>
            <p className="mt-0.5 mb-3 text-sm text-ink-soft">Used by the Gross profit KPIs, Project P&amp;L and the Costing estimator.</p>
            <BandsEditor id="gp" value={draft.gpBands} unit="pct" fixedDirection onChange={b => { setDraft(d => ({ ...d, gpBands: { ...b, higher: true } })); setError(''); }} />
          </section>

          {groups.map(({ g, defs }) => (
            <section key={g} className="overflow-hidden rounded-2xl border border-line bg-white">
              <h4 className="border-b border-line px-4 py-3 font-bold">{GROUP_LABELS[g]}</h4>
              <ul className="divide-y divide-line">
                {defs.map(d => (
                  <DefRow key={d.id} d={d} open={open === d.id} onToggle={() => setOpen(o => (o === d.id ? '' : d.id))}
                    onChange={ch => setDef(d.id, ch)} onRemove={() => removeCustom(d)} gpBands={draftToBands(draft.gpBands)} />
                ))}
              </ul>
            </section>
          ))}

          <button type="button" className={secondaryBtn} onClick={addCustom}><Plus className="h-4 w-4" /> New KPI</button>
        </div>

        <div className="border-t border-line bg-white px-5 py-3">
          {error && <p role="alert" className="mb-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className={secondaryBtn} onClick={onClose}>Cancel</button>
            <button type="button" className={primaryBtn} disabled={busy} onClick={save}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Save library</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DefRow({ d, open, onToggle, onChange, onRemove, gpBands }: {
  d: DefDraft; open: boolean; onToggle: () => void; onChange: (ch: Partial<DefDraft>) => void; onRemove: () => void; gpBands: Bands;
}) {
  const info = MEASURE_INFO[d.measure] || MEASURE_INFO.typed;
  const gp = isGpMeasure(d.measure);
  const summary = d.scoring === 'target'
    ? `Target ${d.target || '–'}${info.perWeek ? ' a week' : ''}`
    : bandsText(gp ? gpBands : draftToBands(d.bands), d.unit);
  return (
    <li className="px-4 py-3">
      <button type="button" onClick={onToggle} className="flex w-full items-start gap-2 text-left" aria-expanded={open}>
        {open ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-ink-soft" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-ink-soft" />}
        <span className="min-w-0 flex-1">
          <span className="font-semibold">{d.name || 'New KPI'}</span>
          {d.hidden && <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-xs text-ink-soft"><EyeOff className="h-3 w-3" /> Hidden</span>}
          {d.custom && <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">Made by you</span>}
          <span className="block text-sm text-ink-soft">{d.measure === 'typed' ? 'Typed in weekly' : info.label}{info.scope === 'company' ? ' (whole company)' : ''} · {summary}</span>
        </span>
      </button>
      {open && (
        <div className="mt-3 space-y-3 pl-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor={`n-${d.id}`}>Name</label>
              <input id={`n-${d.id}`} className={input} value={d.name} onChange={e => onChange({ name: e.target.value })} />
            </div>
            {d.custom && (
              <div>
                <label className={label} htmlFor={`g-${d.id}`}>Group</label>
                <select id={`g-${d.id}`} className={input} value={d.group} onChange={e => onChange({ group: e.target.value as KpiGroup })}>
                  {(Object.keys(GROUP_LABELS) as KpiGroup[]).map(g => <option key={g} value={g}>{GROUP_LABELS[g]}</option>)}
                </select>
              </div>
            )}
          </div>
          <div>
            <label className={label} htmlFor={`d-${d.id}`}>What it means</label>
            <input id={`d-${d.id}`} className={input} value={d.description} onChange={e => onChange({ description: e.target.value })} />
          </div>
          {d.custom && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={label} htmlFor={`m-${d.id}`}>How it is counted</label>
                <select id={`m-${d.id}`} className={input} value={d.measure}
                  onChange={e => onChange({ measure: e.target.value, unit: e.target.value === 'typed' ? d.unit : MEASURE_INFO[e.target.value].unit })}>
                  {Object.entries(MEASURE_INFO).map(([k, v]) => <option key={k} value={k}>{k === 'typed' ? 'Typed in weekly' : v.label}</option>)}
                </select>
              </div>
              {d.measure === 'typed' ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={label} htmlFor={`u-${d.id}`}>Kind of number</label>
                    <select id={`u-${d.id}`} className={input} value={d.unit} onChange={e => onChange({ unit: e.target.value as KpiUnit, typedAgg: e.target.value === 'rating' ? 'average' : d.typedAgg })}>
                      {(Object.keys(UNIT_LABELS) as KpiUnit[]).map(u => <option key={u} value={u}>{UNIT_LABELS[u]}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={label} htmlFor={`a-${d.id}`}>The month is</label>
                    <select id={`a-${d.id}`} className={input} value={d.typedAgg} onChange={e => onChange({ typedAgg: e.target.value as 'sum' | 'average' })}>
                      <option value="sum">The weeks added up</option>
                      <option value="average">The average week</option>
                    </select>
                  </div>
                </div>
              ) : (
                <label className="flex items-center gap-2 self-end pb-2 text-sm">
                  <input type="checkbox" className="accent-[#0E6E62]" checked={d.plusTyped} onChange={e => onChange({ plusTyped: e.target.checked })} />
                  Also let people type extras, added on top
                </label>
              )}
            </div>
          )}
          {info.paramLabel && (
            <label className="flex items-center gap-2 text-sm font-semibold" htmlFor={`p-${d.id}`}>
              <input id={`p-${d.id}`} inputMode="decimal" className={small} value={d.param} onChange={e => onChange({ param: numText(e.target.value) })} />
              {info.paramLabel}
            </label>
          )}
          <div>
            <span className={label}>Scored by</span>
            <div className="inline-flex rounded-lg border border-line bg-white p-0.5 text-sm" role="radiogroup" aria-label="Scored by">
              {(['target', 'bands'] as const).map(s => (
                <button key={s} type="button" role="radio" aria-checked={d.scoring === s} onClick={() => onChange({ scoring: s })}
                  className={`rounded-md px-3 py-1 font-semibold ${d.scoring === s ? 'bg-ink text-white' : 'text-ink-soft hover:text-ink'}`}>
                  {s === 'target' ? '% of a target' : 'Colour bands'}
                </button>
              ))}
            </div>
          </div>
          {d.scoring === 'target' ? (
            <label className="flex items-center gap-2 text-sm font-semibold" htmlFor={`t-${d.id}`}>
              Default target
              <input id={`t-${d.id}`} inputMode="decimal" className={small} value={d.target} onChange={e => onChange({ target: numText(e.target.value) })} />
              <span className="font-normal text-ink-soft">{info.perWeek ? 'a week' : 'a month'}</span>
            </label>
          ) : gp ? (
            <p className="text-sm text-ink-soft">Uses the company gross profit bands above.</p>
          ) : (
            <BandsEditor id={`b-${d.id}`} value={d.bands} unit={d.unit} onChange={b => onChange({ bands: b })} />
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="accent-[#0E6E62]" checked={d.hidden} onChange={e => onChange({ hidden: e.target.checked })} />
              Hide (not offered for new KPI sets; people who have it keep it)
            </label>
            {d.custom && <button type="button" className={`${secondaryBtn} text-danger`} onClick={onRemove}><Trash2 className="h-4 w-4" /> Delete KPI</button>}
          </div>
        </div>
      )}
    </li>
  );
}
