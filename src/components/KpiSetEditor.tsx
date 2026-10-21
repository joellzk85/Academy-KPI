import React, { useMemo, useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { ArrowDown, ArrowUp, Loader2, Trash2, X } from 'lucide-react';
import PanelResizer from './PanelResizer';
import DraftBar from './DraftBar';
import { BandsDraft, BandsEditor, bandsToDraft, draftToBands } from './KpiLibraryPanel';
import { db, friendlyError } from '../lib/firebase';
import { useFormDraft } from '../lib/useFormDraft';
import { setItemsFor } from '../lib/kpi';
import { TeamMember } from '../types';
import {
  activeKpiLibrary, bandsProblem, GROUP_LABELS, isGpMeasure, KPI_PRESETS, KpiGroup, KpiSetItem, MEASURE_INFO, presetById, slotFor,
} from '../lib/kpiLibrary';

// Team → KPIs for one person (Management, Joel 2026-10-22): pick KPIs from the KPI library, set each one's target
// or colour bands and its weight; the weights must add up to 100%. Saved as reps/{memberId}.kpiSet (lib/kpi.ts).
// A ready-made set (the old templates) can be the starting point. Management people can also have no KPIs.

const small = 'w-24 rounded-lg border border-line bg-white px-2.5 py-1.5 text-right text-[15px] focus:border-accent focus:outline-none';
const input = 'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const primaryBtn = 'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-[15px] font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const secondaryBtn = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-50';
const iconBtn = 'rounded-md p-1.5 text-ink-soft hover:bg-surface hover:text-ink disabled:opacity-30';
const numText = (v: string) => v.replace(/[^0-9.]/g, '');

interface ItemDraft { kpiId: string; slot: string; label: string; weight: string; target: string; bands: BandsDraft | null; param: string }
interface SetDraft { none: boolean; items: ItemDraft[] }

function toDraft(items: KpiSetItem[]): ItemDraft[] {
  const lib = activeKpiLibrary();
  return items.filter(i => lib.defs.some(d => d.id === i.kpiId)).map(i => {
    const def = lib.defs.find(d => d.id === i.kpiId)!;
    return {
      kpiId: i.kpiId, slot: i.slot, label: i.label || '', weight: String(i.weight),
      target: String(i.target ?? def.target), bands: i.bands ? bandsToDraft(i.bands) : null,
      param: i.param === undefined ? '' : String(i.param),
    };
  });
}

export default function KpiSetEditor({ member, viewer, saved, onClose, onSaved }: {
  member: TeamMember;
  viewer: TeamMember;
  saved: any;                       // reps/{memberId}
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const lib = activeKpiLibrary();
  const [draft, setDraft] = useState<SetDraft>(() => {
    const noneYet = member.role === 'management' && !saved?.kpiSet?.items?.length && !presetById(saved?.kpiTemplate);
    return { none: noneYet, items: noneYet ? [] : toDraft(setItemsFor({ id: member.id, role: member.role, kpiTemplate: saved?.kpiTemplate, kpiSet: saved?.kpiSet, targets: saved?.targets })) };
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const formDraft = useFormDraft(viewer.id, `kpi-set:${member.id}`, draft, setDraft);

  const setItem = (i: number, ch: Partial<ItemDraft>) => { setDraft(d => ({ ...d, items: d.items.map((x, j) => (j === i ? { ...x, ...ch } : x)) })); setError(''); };
  const move = (i: number, by: number) => setDraft(d => {
    const items = [...d.items];
    const [x] = items.splice(i, 1);
    items.splice(i + by, 0, x);
    return { ...d, items };
  });
  const remove = (i: number) => setDraft(d => ({ ...d, items: d.items.filter((_, j) => j !== i) }));
  const add = (kpiId: string) => {
    const def = lib.defs.find(d => d.id === kpiId);
    if (!def) return;
    setDraft(d => ({ none: false, items: [...d.items, { kpiId, slot: slotFor(kpiId, d.items.map(x => x.slot)), label: '', weight: '0', target: String(def.target), bands: null, param: '' }] }));
    setError('');
  };
  const usePreset = (id: string) => {
    const p = presetById(id);
    if (p) setDraft({ none: false, items: toDraft(p.items) });
    setError('');
  };
  const spread = () => setDraft(d => {
    const n = d.items.length;
    if (!n) return d;
    const each = Math.floor(100 / n);
    return { ...d, items: d.items.map((x, i) => ({ ...x, weight: String(i === 0 ? 100 - each * (n - 1) : each) })) };
  });

  const total = draft.items.reduce((t, x) => t + (Number(x.weight) || 0), 0);
  const available = useMemo(() => {
    const inSet = new Set(draft.items.map(x => x.kpiId));
    return (Object.keys(GROUP_LABELS) as KpiGroup[])
      .map(g => ({ g, defs: lib.defs.filter(d => d.group === g && !d.hidden && !inSet.has(d.id)) }))
      .filter(x => x.defs.length);
  }, [draft.items, lib]);

  const save = async () => {
    const ref = doc(db, 'reps', member.id);
    const by = { updatedAt: new Date().toISOString(), updatedById: viewer.id, updatedByName: viewer.name };
    if (draft.none) {
      setBusy(true);
      try {
        await setDoc(ref, { kpiTemplate: '', kpiSet: null }, { merge: true });
        formDraft.clear();
        onSaved(`${member.name} has no KPIs.`);
      } catch (err) { setError(friendlyError(err)); setBusy(false); }
      return;
    }
    if (!draft.items.length) return setError('Add at least one KPI.');
    const items: KpiSetItem[] = [];
    for (const x of draft.items) {
      const def = lib.defs.find(d => d.id === x.kpiId)!;
      const name = x.label.trim() || def.name;
      const weight = Number(x.weight);
      if (!Number.isFinite(weight) || weight < 0) return setError(`Enter a weight for ${name}.`);
      const item: KpiSetItem = { kpiId: x.kpiId, slot: x.slot, weight: Math.round(weight * 100) / 100 };
      if (x.label.trim()) item.label = x.label.trim();
      if (def.scoring === 'target') {
        const t = Number(x.target);
        if (!(t > 0)) return setError(`Enter a target above 0 for ${name}.`);
        item.target = t;
      } else if (x.bands && !isGpMeasure(def.measure)) {
        const b = draftToBands(x.bands);
        const p = bandsProblem(b);
        if (p) return setError(`${name}: ${p}`);
        item.bands = b;
      }
      if (MEASURE_INFO[def.measure]?.paramLabel && x.param !== '') item.param = Number(x.param);
      items.push(item);
    }
    if (Math.abs(total - 100) > 0.01) return setError(`The weights add up to ${Math.round(total * 100) / 100}%. They must add up to 100%.`);
    // Old screens still read targets by slot.
    const targets = Object.fromEntries(items.filter(i => i.target).map(i => [i.slot, i.target]));
    setBusy(true);
    try {
      await setDoc(ref, { kpiTemplate: 'custom', kpiSet: { items, ...by }, targets }, { merge: true });
      formDraft.clear();
      onSaved(`${member.name}'s KPIs have been saved.`);
    } catch (err) { setError(friendlyError(err)); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" role="dialog" aria-modal="true" aria-label={`KPIs for ${member.name}`}>
      <PanelResizer />
      <div className="flex h-full w-full flex-col bg-surface shadow-xl md:w-[var(--panel-w,max(50vw,40rem))] md:min-w-[24rem] md:max-w-[95vw]">
        <div className="flex items-start justify-between gap-3 border-b border-line bg-white px-5 py-4">
          <div>
            <h3 className="text-lg font-bold">KPIs for {member.name}</h3>
            <p className="text-sm text-ink-soft">Pick KPIs from the KPI library, then set each one's target or colour bands and its weight.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-ink-soft hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <DraftBar draft={formDraft} what={`change to ${member.name}'s KPIs`} />

          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm font-semibold" htmlFor="kpi-preset">Start from a ready-made set</label>
            <select id="kpi-preset" className={`${input} w-auto`} value="" onChange={e => usePreset(e.target.value)}>
              <option value="">Choose…</option>
              {KPI_PRESETS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          {member.role === 'management' && (
            <label className="flex items-center gap-2 rounded-xl border border-line bg-white px-4 py-3 text-[15px]">
              <input type="checkbox" className="accent-[#0E6E62]" checked={draft.none} onChange={e => { setDraft(d => ({ ...d, none: e.target.checked })); setError(''); }} />
              <span><strong>No KPIs.</strong> <span className="text-ink-soft">They keep a workspace, but no KPI page or performance ring.</span></span>
            </label>
          )}

          {!draft.none && (
            <>
              <ul className="space-y-3">
                {draft.items.map((x, i) => {
                  const def = lib.defs.find(d => d.id === x.kpiId)!;
                  const info = MEASURE_INFO[def.measure] || MEASURE_INFO.typed;
                  const gp = isGpMeasure(def.measure);
                  return (
                    <li key={`${x.kpiId}_${x.slot}`} className="rounded-2xl border border-line bg-white p-4">
                      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                        <div className="min-w-0 flex-1 basis-56">
                          <p className="font-semibold">{x.label.trim() || def.name}</p>
                          <p className="text-sm text-ink-soft">{def.measure === 'typed' ? 'Typed in weekly' : info.label}{info.scope === 'company' ? ' (whole company)' : ''}</p>
                        </div>
                        <label className="flex items-center gap-1.5 text-sm font-semibold" htmlFor={`w-${i}`}>
                          Weight
                          <input id={`w-${i}`} inputMode="decimal" className="w-16 rounded-lg border border-line bg-white px-2.5 py-1.5 text-right text-[15px] focus:border-accent focus:outline-none" value={x.weight} onChange={e => setItem(i, { weight: numText(e.target.value) })} />%
                        </label>
                        <span className="flex">
                          <button type="button" className={iconBtn} disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp className="h-4 w-4" /></button>
                          <button type="button" className={iconBtn} disabled={i === draft.items.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown className="h-4 w-4" /></button>
                          <button type="button" className={iconBtn} onClick={() => remove(i)} aria-label={`Remove ${def.name}`}><Trash2 className="h-4 w-4" /></button>
                        </span>
                      </div>
                      <div className="mt-3 space-y-3 border-t border-line pt-3">
                        {def.scoring === 'target' ? (
                          <label className="flex items-center gap-2 text-sm font-semibold" htmlFor={`t-${i}`}>
                            Target
                            <input id={`t-${i}`} inputMode="decimal" className={small} value={x.target} onChange={e => setItem(i, { target: numText(e.target.value) })} />
                            <span className="font-normal text-ink-soft">{def.unit === 'rm' ? 'RM ' : ''}{info.perWeek ? 'a week' : 'a month'}</span>
                          </label>
                        ) : gp ? (
                          <p className="text-sm text-ink-soft">Colour bands: the company gross profit bands (KPI library).</p>
                        ) : x.bands ? (
                          <div>
                            <BandsEditor id={`b-${i}`} value={x.bands} unit={def.unit} onChange={b => setItem(i, { bands: b })} />
                            <button type="button" className="mt-2 text-sm font-semibold text-accent hover:underline" onClick={() => setItem(i, { bands: null })}>Use the library's bands</button>
                          </div>
                        ) : (
                          <p className="text-sm text-ink-soft">
                            Colour bands from the KPI library.{' '}
                            <button type="button" className="font-semibold text-accent hover:underline" onClick={() => setItem(i, { bands: bandsToDraft(def.bands) })}>Set {member.name}'s own</button>
                          </p>
                        )}
                        {info.paramLabel && (
                          <label className="flex items-center gap-2 text-sm font-semibold" htmlFor={`p-${i}`}>
                            <input id={`p-${i}`} inputMode="decimal" className={small} placeholder={String(def.param ?? '')} value={x.param} onChange={e => setItem(i, { param: numText(e.target.value) })} />
                            {info.paramLabel}
                          </label>
                        )}
                        <label className="flex flex-wrap items-center gap-2 text-sm" htmlFor={`l-${i}`}>
                          <span className="font-semibold">Name shown</span>
                          <input id={`l-${i}`} className={`${input} max-w-xs py-1.5`} placeholder={def.name} value={x.label} onChange={e => setItem(i, { label: e.target.value })} />
                        </label>
                      </div>
                    </li>
                  );
                })}
              </ul>

              {available.length > 0 && (
                <div className="flex flex-wrap items-center gap-3">
                  <label className="text-sm font-semibold" htmlFor="kpi-add">Add a KPI</label>
                  <select id="kpi-add" className={`${input} w-auto max-w-full`} value="" onChange={e => add(e.target.value)}>
                    <option value="">Choose from the library…</option>
                    {available.map(({ g, defs }) => (
                      <optgroup key={g} label={GROUP_LABELS[g]}>
                        {defs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}
        </div>

        <div className="border-t border-line bg-white px-5 py-3">
          {!draft.none && (
            <p className={`mb-2 flex flex-wrap items-center gap-3 text-sm font-semibold ${Math.abs(total - 100) > 0.01 ? 'text-danger' : 'text-accent'}`}>
              Weights add up to {Math.round(total * 100) / 100}%{Math.abs(total - 100) > 0.01 ? ' (must be 100%)' : ''}
              {draft.items.length > 1 && <button type="button" className="font-semibold text-ink-soft underline hover:text-ink" onClick={spread}>Spread evenly</button>}
            </p>
          )}
          {error && <p role="alert" className="mb-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className={secondaryBtn} onClick={onClose}>Cancel</button>
            <button type="button" className={primaryBtn} disabled={busy} onClick={save}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Save KPIs</button>
          </div>
        </div>
      </div>
    </div>
  );
}
