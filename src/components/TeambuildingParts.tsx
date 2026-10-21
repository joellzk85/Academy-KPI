import React, { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Plus, Star, Trash2 } from 'lucide-react';
import PhotoPicker, { PhotoUpload } from './PhotoPicker';
import {
  AGENDA_TAGS, AgendaTag, LOCATIONS, RATINGS, TbActivityContent, TbAgendaDay, TbPackages, TbPoint, TbPriceBand, bandProblems, cellKey, formatPrice, newTbId, sortedBands,
} from '../lib/teambuilding';

// Shared pieces for teambuilding: form styles, the package editor (template and proposals) and the activity form
// (library and proposals).

type Viewer = { id: string; name: string };

export const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15 disabled:bg-surface disabled:text-ink-soft';
export const label = 'mb-1 block text-sm font-semibold text-ink';
export const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
export const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';
export const linkBtn = 'text-sm font-semibold text-accent hover:underline disabled:opacity-50';
export const iconBtn = 'rounded-md p-1.5 text-ink-soft hover:bg-surface hover:text-ink disabled:opacity-30';

export function Card({ title, hint, action, children, id }: { title: React.ReactNode; hint?: string; action?: React.ReactNode; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="rounded-2xl border border-line bg-white p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-bold">{title}</h3>
          {hint && <p className="text-sm text-ink-soft">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function move<T>(list: T[], i: number, by: number): T[] {
  const next = [...list];
  const j = i + by;
  if (j < 0 || j >= next.length) return list;
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export function UpDown({ i, n, onMove, disabled }: { i: number; n: number; onMove: (by: number) => void; disabled?: boolean }) {
  return (
    <span className="flex shrink-0">
      <button type="button" className={iconBtn} disabled={disabled || i === 0} onClick={() => onMove(-1)} aria-label="Move up"><ArrowUp className="h-4 w-4" /></button>
      <button type="button" className={iconBtn} disabled={disabled || i === n - 1} onClick={() => onMove(1)} aria-label="Move down"><ArrowDown className="h-4 w-4" /></button>
    </span>
  );
}

// A whole number box that can be emptied while typing.
export function NumberBox({ value, onChange, id, className = '', placeholder, ariaLabel, disabled }: {
  value?: number; onChange: (n: number) => void; id?: string; className?: string; placeholder?: string; ariaLabel?: string; disabled?: boolean;
}) {
  const [text, setText] = useState(value ? String(value) : '');
  useEffect(() => { if ((Number(text) || 0) !== (value || 0)) setText(value ? String(value) : ''); }, [value]);
  return (
    <input id={id} inputMode="numeric" value={text} placeholder={placeholder} aria-label={ariaLabel} disabled={disabled} className={`${input} ${className}`}
      onChange={e => { const t = e.target.value.replace(/[^0-9]/g, '').slice(0, 7); setText(t); onChange(Number(t) || 0); }} />
  );
}

// A list typed one per line (blank lines are dropped when saved).
export function LinesBox({ value, onChange, id, placeholder, rows = 4, disabled }: { value: string[]; onChange: (v: string[]) => void; id?: string; placeholder?: string; rows?: number; disabled?: boolean }) {
  return <textarea id={id} value={(value || []).join('\n')} onChange={e => onChange(e.target.value.split('\n'))} rows={rows} placeholder={placeholder} disabled={disabled} className={`${input} resize-y`} />;
}

// ---------- Packages ----------
export function PackageEditor({ pk, onChange, disabled, pax }: { pk: TbPackages; onChange: (pk: TbPackages) => void; disabled?: boolean; pax?: number }) {
  const set = (c: Partial<TbPackages>) => onChange({ ...pk, ...c });
  const [openBand, setOpenBand] = useState<string | null>(null);
  const problems = bandProblems(pk);
  const setCell = (k: string, v: string) => set({ cells: { ...pk.cells, [k]: v } });
  const setBand = (id: string, c: Partial<TbPriceBand>) => set({ bands: pk.bands.map(b => (b.id === id ? { ...b, ...c } : b)) });
  const removeCol = (id: string) => {
    if (pk.cols.length <= 1) return;
    if (!window.confirm(`Remove package "${pk.cols.find(c => c.id === id)?.name}"?`)) return;
    set({ cols: pk.cols.filter(c => c.id !== id) });
  };
  const addCol = () => set({ cols: [...pk.cols, { id: newTbId('c'), name: `Package ${pk.cols.length + 1}` }] });
  const addRow = () => set({ rows: [...pk.rows, { id: newTbId('r'), label: '' }] });
  const addBand = () => {
    const last = sortedBands(pk).slice(-1)[0];
    const min = last ? last.max + 1 : 20;
    set({ bands: [...pk.bands, { id: newTbId('b'), min, max: min + 19, prices: { ...(last?.prices || {}) } }] });
  };
  const sorted = sortedBands(pk);
  const inBand = (b: TbPriceBand) => !!pax && pax >= b.min && pax <= b.max;

  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-5">
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[640px] border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="w-[34%] pb-2 text-left font-semibold text-ink-soft">Item</th>
              {pk.cols.map((c, i) => (
                <th key={c.id} className="px-1 pb-2 align-bottom">
                  <div className="flex items-center gap-1">
                    <input value={c.name} onChange={e => set({ cols: pk.cols.map(x => (x.id === c.id ? { ...x, name: e.target.value } : x)) })} className={`${input} font-semibold`} aria-label={`Package ${i + 1} name`} />
                    <button type="button" className={`${iconBtn} ${c.highlight ? 'text-attention' : ''}`} title={c.highlight ? 'Recommended (click to remove)' : 'Mark as recommended'}
                      onClick={() => set({ cols: pk.cols.map(x => ({ ...x, highlight: x.id === c.id ? !c.highlight : false })) })} aria-pressed={!!c.highlight} aria-label="Recommended">
                      <Star className={`h-4 w-4 ${c.highlight ? 'fill-current' : ''}`} />
                    </button>
                  </div>
                  <div className="mt-1 flex justify-center gap-1">
                    <button type="button" className={iconBtn} disabled={i === 0} onClick={() => set({ cols: move(pk.cols, i, -1) })} aria-label="Move package left">‹</button>
                    <button type="button" className={iconBtn} disabled={i === pk.cols.length - 1} onClick={() => set({ cols: move(pk.cols, i, 1) })} aria-label="Move package right">›</button>
                    <button type="button" className={iconBtn} disabled={pk.cols.length <= 1} onClick={() => removeCol(c.id)} aria-label="Remove package"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </th>
              ))}
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {pk.rows.map((r, i) => (
              <tr key={r.id}>
                <td className="py-1 pr-1"><input value={r.label} onChange={e => set({ rows: pk.rows.map(x => (x.id === r.id ? { ...x, label: e.target.value } : x)) })} className={input} placeholder="e.g. Photography" aria-label={`Item ${i + 1}`} /></td>
                {pk.cols.map(c => (
                  <td key={c.id} className="px-1 py-1"><input value={pk.cells[cellKey(r.id, c.id)] || ''} onChange={e => setCell(cellKey(r.id, c.id), e.target.value)} className={`${input} text-center`} placeholder="-" aria-label={`${r.label || 'Item'}, ${c.name}`} /></td>
                ))}
                <td className="py-1">
                  <span className="flex">
                    <UpDown i={i} n={pk.rows.length} onMove={by => set({ rows: move(pk.rows, i, by) })} />
                    <button type="button" className={iconBtn} onClick={() => set({ rows: pk.rows.filter(x => x.id !== r.id) })} aria-label="Remove item"><Trash2 className="h-4 w-4" /></button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnSecondary} onClick={addRow}><Plus className="h-4 w-4" /> Add item</button>
        <button type="button" className={btnSecondary} onClick={addCol}><Plus className="h-4 w-4" /> Add package</button>
      </div>
      <p className="text-sm text-ink-soft">Type what each package gives: "Yes", a number, a short description, or "-" for not included.</p>

      {/* Price bands */}
      <div className="rounded-xl border border-line">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div>
            <p className="font-semibold">Price by group size</p>
            <p className="text-sm text-ink-soft">The professional fee for the whole group. Fewer people than the smallest band pay the smallest band's price; more than the biggest band see "Contact us".</p>
          </div>
          <button type="button" className={btnSecondary} onClick={addBand}><Plus className="h-4 w-4" /> Add band</button>
        </div>
        <ul className="divide-y divide-line">
          {sorted.map(b => (
            <li key={b.id} className={`px-4 py-3 ${inBand(b) ? 'bg-accent-soft/40' : ''}`}>
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex items-end gap-2">
                  <div className="w-20"><label className={label}>From</label><NumberBox value={b.min} onChange={n => setBand(b.id, { min: n })} ariaLabel="From (pax)" /></div>
                  <div className="w-20"><label className={label}>To</label><NumberBox value={b.max} onChange={n => setBand(b.id, { max: n })} ariaLabel="To (pax)" /></div>
                  <span className="pb-2 text-sm text-ink-soft">pax</span>
                </div>
                {pk.cols.map(c => (
                  <div key={c.id} className="w-32">
                    <label className={label}>{c.name || 'Package'} (RM)</label>
                    <NumberBox value={b.prices?.[c.id]} onChange={n => setBand(b.id, { prices: { ...b.prices, [c.id]: n } })} ariaLabel={`${c.name} price, ${b.min} to ${b.max} pax`} />
                  </div>
                ))}
                <button type="button" className={`${iconBtn} mb-1`} disabled={pk.bands.length <= 1} onClick={() => set({ bands: pk.bands.filter(x => x.id !== b.id) })} aria-label="Remove band"><Trash2 className="h-4 w-4" /></button>
              </div>
              <button type="button" className={`${linkBtn} mt-2 inline-flex items-center gap-1`} onClick={() => setOpenBand(o => (o === b.id ? null : b.id))}>
                {openBand === b.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                What changes for {b.min} to {b.max} pax{Object.values(b.cells || {}).some(v => v) ? ` (${Object.values(b.cells || {}).filter(v => v).length} changed)` : ''}
              </button>
              {inBand(b) && <span className="ml-2 text-sm font-semibold text-accent">This proposal's group size</span>}
              {openBand === b.id && (
                <div className="mt-2 overflow-x-auto">
                  <p className="mb-2 text-sm text-ink-soft">Leave a box empty to keep the table's value. E.g. more facilitators for a bigger group.</p>
                  <table className="w-full min-w-[560px] text-sm">
                    <tbody>
                      {pk.rows.filter(r => r.label.trim()).map(r => (
                        <tr key={r.id}>
                          <td className="w-[34%] py-1 pr-2 font-medium">{r.label}</td>
                          {pk.cols.map(c => {
                            const k = cellKey(r.id, c.id);
                            return (
                              <td key={c.id} className="px-1 py-1">
                                <input value={b.cells?.[k] || ''} placeholder={pk.cells[k] || '-'} aria-label={`${r.label}, ${c.name}, ${b.min} to ${b.max} pax`}
                                  onChange={e => setBand(b.id, { cells: { ...(b.cells || {}), [k]: e.target.value } })} className={`${input} text-center`} />
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </li>
          ))}
        </ul>
        {problems.length > 0 && <ul className="space-y-0.5 border-t border-line bg-attention-soft/50 px-4 py-2 text-sm text-attention">{problems.map(p => <li key={p}>{p}</li>)}</ul>}
      </div>
      <div>
        <label className={label} htmlFor="pk-note">Note under the packages</label>
        <input id="pk-note" value={pk.note || ''} onChange={e => set({ note: e.target.value })} className={input} placeholder="e.g. Professional fee for the whole group. Venue, meals and transport are quoted separately." />
      </div>
      {pax ? (
        <p className="text-sm text-ink-soft">For {pax} pax: {pk.cols.map(c => {
          const b = sorted.find(x => pax >= x.min && pax <= x.max) || (pax < (sorted[0]?.min || 0) ? sorted[0] : null);
          const v = b?.prices?.[c.id];
          return `${c.name} ${v ? formatPrice(v) : 'Contact us'}`;
        }).join(' · ')}</p>
      ) : null}
    </fieldset>
  );
}

// ---------- Activity ----------
export function ActivityForm({ a, onChange, me, disabled, upload }: { a: TbActivityContent; onChange: (c: Partial<TbActivityContent>) => void; me: Viewer; disabled?: boolean; upload?: PhotoUpload }) {
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><label className={label} htmlFor="ac-name">Activity name</label><input id="ac-name" value={a.name} onChange={e => onChange({ name: e.target.value })} className={input} placeholder="e.g. The Million Ringgit Project" /></div>
        <div className="sm:col-span-2"><label className={label} htmlFor="ac-sum">Short description</label><textarea id="ac-sum" value={a.summary} onChange={e => onChange({ summary: e.target.value })} rows={2} className={`${input} resize-y`} placeholder="One or two lines that make the client want to play it" /></div>
      </div>
      <PhotoPicker photos={a.photos || []} onChange={photos => onChange({ photos })} folder="activities" me={me} disabled={disabled} upload={upload} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div><label className={label} htmlFor="ac-dur">Duration</label><input id="ac-dur" value={a.duration} onChange={e => onChange({ duration: e.target.value })} className={input} placeholder="75 - 90 minutes" /></div>
        <div>
          <label className={label} htmlFor="ac-loc">Location</label>
          <select id="ac-loc" value={a.location} onChange={e => onChange({ location: e.target.value })} className={input}>
            {(LOCATIONS.includes(a.location) || !a.location ? LOCATIONS : [a.location, ...LOCATIONS]).map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div><label className={label} htmlFor="ac-fmt">Format</label><input id="ac-fmt" value={a.format} onChange={e => onChange({ format: e.target.value })} className={input} placeholder="Rotational, 4 stations" /></div>
        <div><label className={label} htmlFor="ac-grp">Group size</label><input id="ac-grp" value={a.groupSize} onChange={e => onChange({ groupSize: e.target.value })} className={input} placeholder="10-12 per group" /></div>
        <div><label className={label} htmlFor="ac-min">Min pax</label><NumberBox id="ac-min" value={a.minPax} onChange={n => onChange({ minPax: n })} /></div>
        <div><label className={label} htmlFor="ac-max">Max pax</label><NumberBox id="ac-max" value={a.maxPax} onChange={n => onChange({ maxPax: n })} /></div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div><label className={label} htmlFor="ac-obj">Learning objectives (one per line)</label><LinesBox id="ac-obj" value={a.objectives} onChange={v => onChange({ objectives: v })} placeholder={'Understand the importance of clear goals\nAppreciate the role of managers in creating buy-in'} /></div>
        <div><label className={label} htmlFor="ac-tk">Learning takeaways (one per line)</label><LinesBox id="ac-tk" value={a.takeaways} onChange={v => onChange({ takeaways: v })} placeholder={'Clarity creates alignment\nAlignment creates commitment'} /></div>
      </div>
      <div><label className={label} htmlFor="ac-how">How it is played</label><textarea id="ac-how" value={a.howPlayed} onChange={e => onChange({ howPlayed: e.target.value })} rows={5} className={`${input} resize-y`} placeholder={'Teams build a paper product from vague instructions.\n- Limited resources\n- Strict time limit'} /></div>
      <div className="grid gap-3 md:grid-cols-2">
        <div><label className={label} htmlFor="ac-mat">Materials (one per line)</label><LinesBox id="ac-mat" value={a.materials} onChange={v => onChange({ materials: v })} placeholder={'Mahjong paper\nMarker pens'} /></div>
        <div><label className={label} htmlFor="ac-del">Expected deliverables</label><textarea id="ac-del" value={a.deliverables} onChange={e => onChange({ deliverables: e.target.value })} rows={4} className={`${input} resize-y`} placeholder={'1. Vision and mission board\n- Where are we going?'} /></div>
      </div>
      <p className="text-sm text-ink-soft">In "How it is played" and "Expected deliverables", lines starting with "- " show as bullet points.</p>
      <div>
        <p className={label}>Activity profile (0 = don't show)</p>
        <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {RATINGS.map(x => (
            <label key={x.key} className="flex items-center gap-3 text-sm">
              <span className="w-32 shrink-0 font-medium">{x.label}</span>
              <input type="range" min={0} max={100} step={10} value={a.ratings?.[x.key] || 0} onChange={e => onChange({ ratings: { ...(a.ratings || {}), [x.key]: Number(e.target.value) } })} className="flex-1 accent-[#0E6E62]" />
              <span className="w-10 text-right text-ink-soft">{a.ratings?.[x.key] || 0}</span>
            </label>
          ))}
        </div>
      </div>
    </fieldset>
  );
}

// ---------- Numbered points (objectives, takeaways) and the agenda: proposals and the trainer portal ----------
export function Points({ list, onChange, prefix, titlePh, textPh }: { list: TbPoint[]; onChange: (l: TbPoint[]) => void; prefix: string; titlePh: string; textPh: string }) {
  const setAt = (i: number, c: Partial<TbPoint>) => onChange(list.map((x, k) => (k === i ? { ...x, ...c } : x)));
  return (
    <div className="space-y-3">
      {list.map((o, i) => (
        <div key={o.id} className="flex gap-2 rounded-xl border border-line p-3">
          <span className="mt-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent">{i + 1}</span>
          <div className="min-w-0 flex-1 space-y-2">
            <input value={o.title} onChange={e => setAt(i, { title: e.target.value })} className={`${input} font-semibold`} placeholder={titlePh} aria-label="Heading" />
            <textarea value={o.text} onChange={e => setAt(i, { text: e.target.value })} rows={2} className={`${input} resize-y`} placeholder={textPh} aria-label="Text" />
          </div>
          <span className="flex flex-col">
            <UpDown i={i} n={list.length} onMove={by => onChange(move(list, i, by))} />
            <button type="button" className={iconBtn} onClick={() => onChange(list.filter((_, k) => k !== i))} aria-label="Remove"><Trash2 className="h-4 w-4" /></button>
          </span>
        </div>
      ))}
      <button type="button" className={btnSecondary} onClick={() => onChange([...list, { id: newTbId(prefix), title: '', text: '' }])}><Plus className="h-4 w-4" /> Add</button>
    </div>
  );
}

export function Agenda({ days, onChange }: { days: TbAgendaDay[]; onChange: (d: TbAgendaDay[]) => void }) {
  const setDay = (i: number, c: Partial<TbAgendaDay>) => onChange(days.map((d, k) => (k === i ? { ...d, ...c } : d)));
  return (
    <div className="space-y-4">
      {days.map((d, i) => (
        <div key={d.id} className="rounded-xl border border-line p-3">
          <div className="mb-2 flex items-center gap-2">
            <input value={d.title} onChange={e => setDay(i, { title: e.target.value })} className={`${input} font-semibold`} placeholder={`Day ${i + 1}: Leadership alignment and recognition`} aria-label="Day heading" />
            <UpDown i={i} n={days.length} onMove={by => onChange(move(days, i, by))} />
            <button type="button" className={iconBtn} onClick={() => { if (!d.rows.some(x => x.text.trim()) || window.confirm('Remove this day and its rows?')) onChange(days.filter((_, k) => k !== i)); }} aria-label="Remove day"><Trash2 className="h-4 w-4" /></button>
          </div>
          <div className="space-y-2">
            {d.rows.map((row, k) => (
              <div key={row.id} className="flex flex-wrap items-center gap-2 border-b border-line pb-2 last:border-0 sm:flex-nowrap sm:border-0 sm:pb-0">
                <input value={row.time} onChange={e => setDay(i, { rows: d.rows.map((x, j) => (j === k ? { ...x, time: e.target.value } : x)) })} className={`${input} min-w-0 flex-1 sm:w-44 sm:flex-none`} placeholder="2:00pm - 2:30pm" aria-label="Time" />
                <select value={row.tag || ''} onChange={e => setDay(i, { rows: d.rows.map((x, j) => (j === k ? { ...x, tag: e.target.value as AgendaTag } : x)) })} className={`${input} shrink-0 sm:w-44! sm:order-3`} aria-label="Where">
                  {AGENDA_TAGS.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
                <input value={row.text} onChange={e => setDay(i, { rows: d.rows.map((x, j) => (j === k ? { ...x, text: e.target.value } : x)) })} className={`${input} min-w-0 basis-full sm:order-2 sm:basis-auto sm:flex-1`} placeholder="Ice breaker and energizer" aria-label="What happens" />
                <span className="ml-auto flex sm:order-4 sm:ml-0">
                  <UpDown i={k} n={d.rows.length} onMove={by => setDay(i, { rows: move(d.rows, k, by) })} />
                  <button type="button" className={iconBtn} onClick={() => setDay(i, { rows: d.rows.filter((_, j) => j !== k) })} aria-label="Remove row"><Trash2 className="h-4 w-4" /></button>
                </span>
              </div>
            ))}
          </div>
          <button type="button" className={`${linkBtn} mt-2`} onClick={() => setDay(i, { rows: [...d.rows, { id: newTbId('ar'), time: '', text: '', tag: '' }] })}><Plus className="mr-1 inline h-4 w-4" />Add a time slot</button>
        </div>
      ))}
      <button type="button" className={btnSecondary} onClick={() => onChange([...days, { id: newTbId('day'), title: `Day ${days.length + 1}`, rows: [{ id: newTbId('ar'), time: '', text: '', tag: '' }] }])}><Plus className="h-4 w-4" /> Add day</button>
    </div>
  );
}
