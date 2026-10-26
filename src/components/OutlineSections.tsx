import React, { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { CourseOutline, CourseOutlineItem, OutlineAgendaRow } from '../types';
import { BLOOM_LEVELS, DIFFICULTIES, durationText } from '../lib/outlineContent';
import { typingCaps } from '../lib/programmes';
import { OUTLINE_TYPES, OutlineType, agendaToDays, daysToAgenda, outlineTypeFields, outlineTypeOf, programmeTypeOf, programmesFor } from '../lib/outlineTb';
import { Agenda as DayAgenda } from './TeambuildingParts';

// The course outline's content parts: type and course details, overview and outcomes, modules, agenda, optional extras.
// One form for everyone (Joel, 2026-10-26: "just use exact same one from crm"): the CRM's outline editor
// (CourseOutlinesPage.tsx, with deal, terms and sharing around it), the trainer portal and the trainer's outline link
// (OutlineLinkForm.tsx) all show these same parts.

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15 disabled:bg-surface disabled:text-ink-soft';
const label = 'mb-1 block text-sm font-semibold text-ink';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';
const linkBtn = 'text-sm font-semibold text-accent hover:underline';
const iconBtn = 'rounded-md p-1.5 text-ink-soft hover:bg-surface hover:text-ink disabled:opacity-30';

const TYPE_GROUP: Record<OutlineType, string> = { soft: 'Soft skill', teambuilding: 'Team building', technical: 'Technical skill' };
const newId = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
export const newModule = (): CourseOutlineItem => ({ id: newId('m'), no: 0, moduleTitle: '', topics: '', duration: '', methodology: '' });
const newRow = (isDay = false): OutlineAgendaRow => ({ id: newId('a'), time: '', text: '', ...(isDay ? { isDay: true } : {}) });

/** A drop-down's titles under Soft skill / Team building / Technical skill (the outline's own type first). */
export function ProgrammeOptions({ programmes, outlines, first }: { programmes: any[]; outlines: any[]; first?: OutlineType }) {
  const order = (['soft', 'teambuilding', 'technical'] as OutlineType[]).sort((a, b) => Number(b === first) - Number(a === first));
  const sorted = [...programmes].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return <>{order.map(t => {
    const list = sorted.filter(p => programmeTypeOf(p, outlines) === t);
    return list.length ? <optgroup key={t} label={TYPE_GROUP[t]}>{list.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup> : null;
  })}</>;
}

// A number box that lets "0." be typed on the way to "0.5".
export function DecimalInput({ id, value, onChange, placeholder }: { id: string; value?: number; onChange: (v: number) => void; placeholder?: string }) {
  const [text, setText] = useState(value ? String(value) : '');
  useEffect(() => { if ((Number(text) || 0) !== (value || 0)) setText(value ? String(value) : ''); }, [value]);
  return (
    <input id={id} inputMode="decimal" value={text} placeholder={placeholder} className={input}
      onChange={e => { const t = e.target.value.replace(/[^0-9.]/g, ''); setText(t); onChange(Number(t) || 0); }} />
  );
}

export function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-white p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="font-bold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export default function OutlineSections({ o, setO, locked = false, programmes, typeOutlines = [], programmeId, programmeName, dealProgrammeId, titleExtra, tbHint, firstNo = 2 }: {
  o: CourseOutline; setO: (f: (x: CourseOutline) => CourseOutline) => void; locked?: boolean;
  programmes: any[];            // the titles list; empty = no "Title from the list" (the outline link: its title is set)
  typeOutlines?: any[];         // outlines, to sort titles by type (CRM)
  programmeId: string;          // the title it prints with (its own, else its deal's)
  programmeName: string;
  dealProgrammeId?: string;     // its deal has a title: "Use the deal's title"
  titleExtra?: React.ReactNode; // CRM: category and #tags of the title
  tbHint?: string;
  firstNo?: number;             // the first part's number (the CRM puts "1. Deal and client" before)
}) {
  const set = (c: Partial<CourseOutline>) => setO(x => ({ ...x, ...c }));
  const n = (k: number) => `${firstNo + k}.`;
  const items = o.items || [];
  const type = outlineTypeOf(o);
  const isTb = type === 'teambuilding';
  // A different type keeps the title only when it's of the same kind (a title set as Team building is for teambuilding
  // outlines); a title that just follows its outlines follows this one.
  const setType = (t: OutlineType) => {
    const prog = o.programmeId ? programmes.find(p => p.id === o.programmeId) : null;
    const keep = !prog || !prog.skillType || (prog.skillType === 'teambuilding') === (t === 'teambuilding');
    set({ ...outlineTypeFields(t), ...(keep ? {} : { programmeId: '', useProgrammeName: false, courseTitle: o.courseTitle || '' }) });
  };

  // Modules
  const setItem = (i: number, c: Partial<CourseOutlineItem>) => setO(x => ({ ...x, items: (x.items || []).map((m, k) => (k === i ? { ...m, ...c } : m)) }));
  const addItem = () => setO(x => ({ ...x, items: [...(x.items || []), newModule()] }));
  const removeItem = (i: number) => setO(x => ({ ...x, items: (x.items || []).filter((_, k) => k !== i) }));
  const moveItem = (i: number, dir: -1 | 1) => setO(x => {
    const list = [...(x.items || [])];
    const j = i + dir;
    if (j < 0 || j >= list.length) return x;
    [list[i], list[j]] = [list[j], list[i]];
    return { ...x, items: list };
  });
  // Training days (multi-day outlines): each module can be put on a day; "Day N: title" prints above them.
  const dayCount = Math.max(1, Math.ceil(o.durationDays || 0));
  const setDayTitle = (d: number, v: string) => setO(x => {
    const t = [...(x.dayTitles || [])];
    while (t.length < d) t.push('');
    t[d - 1] = v;
    return { ...x, dayTitles: t };
  });

  // Agenda rows
  const agenda = o.agenda || [];
  const setRow = (i: number, c: Partial<OutlineAgendaRow>) => setO(x => ({ ...x, agenda: (x.agenda || []).map((r, k) => (k === i ? { ...r, ...c } : r)) }));
  const addRow = (isDay = false) => setO(x => ({ ...x, agenda: [...(x.agenda || []), newRow(isDay)] }));
  const removeRow = (i: number) => setO(x => ({ ...x, agenda: (x.agenda || []).filter((_, k) => k !== i) }));
  const moveRow = (i: number, dir: -1 | 1) => setO(x => {
    const list = [...(x.agenda || [])];
    const j = i + dir;
    if (j < 0 || j >= list.length) return x;
    [list[i], list[j]] = [list[j], list[i]];
    return { ...x, agenda: list };
  });
  // A start: one row per module (and day headings), times left for the person to type.
  const agendaFromModules = () => setO(x => {
    const mods = (x.items || []).filter(m => (m.moduleTitle || '').trim());
    const byDay = dayCount > 1 && mods.some(m => m.day);
    const rows: OutlineAgendaRow[] = [];
    let last = 0;
    mods.forEach((m, i) => {
      const d = m.day || 1;
      if (byDay && d !== last) { rows.push({ ...newRow(true), text: `Day ${d}` }); last = d; }
      rows.push({ ...newRow(), text: `Module ${i + 1}: ${m.moduleTitle.trim()}` });
    });
    return { ...x, agenda: rows };
  });

  return (
    <>
      {/* Course details */}
      <Card title={`${n(0)} Course details`}>
        <div className="space-y-3">
          <div>
            <p className={label}>Type of outline</p>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Type of outline">
              {OUTLINE_TYPES.map(t => (
                <button key={t.key} type="button" role="radio" aria-checked={type === t.key} onClick={() => setType(t.key)}
                  className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${type === t.key ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-white text-ink hover:bg-surface'}`}>
                  {t.label}
                </button>
              ))}
            </div>
            {isTb && <p className="mt-1 text-sm text-ink-soft">{tbHint || 'For registering the teambuilding programme with HRDC. The client is pitched with the teambuilding proposal.'}</p>}
          </div>
          {programmes.length > 0 && (
            <div>
              <label className={label} htmlFor="o-prog">Title from the list <span className="font-normal text-ink-soft">(optional; outlines with the same title are one programme)</span></label>
              <select id="o-prog" value={programmeId} onChange={e => set({ programmeId: e.target.value, useProgrammeName: !!e.target.value })} className={input}>
                <option value="">{dealProgrammeId ? 'Use the deal\'s title' : 'None: type the title below'}</option>
                <ProgrammeOptions programmes={programmesFor(programmes, isTb ? 'teambuilding' : 'training', typeOutlines)} outlines={typeOutlines} first={type} />
              </select>
              {!o.programmeId && dealProgrammeId && <p className="mt-0.5 text-xs text-ink-soft">From the deal.</p>}
            </div>
          )}
          <div>
            <label className={label} htmlFor="o-title">Course title</label>
            {o.useProgrammeName && programmeName ? (
              <div className="rounded-lg bg-surface px-3 py-2">
                <p className="font-semibold">{programmeName}</p>
                <p className="text-sm text-ink-soft">The title from the list. {!locked && <button type="button" className={linkBtn} onClick={() => set({ useProgrammeName: false, courseTitle: programmeName })}>Type a different title</button>}</p>
              </div>
            ) : (
              <>
                <input id="o-title" value={o.courseTitle || ''} onChange={e => set({ courseTitle: typingCaps(e.target.value) })} className={input} placeholder="e.g. LEADERSHIP ESSENTIALS FOR NEW MANAGERS" />
                {programmeName && !locked && <button type="button" className={`${linkBtn} mt-1`} onClick={() => set({ useProgrammeName: true })}>Use the title from the list ({programmeName})</button>}
              </>
            )}
          </div>
          {titleExtra}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="o-days">Course duration (days)</label>
              <DecimalInput id="o-days" value={o.durationDays} onChange={v => set({ durationDays: v })} placeholder="e.g. 0.5 for half a day" />
            </div>
            <div>
              <label className={label} htmlFor="o-hours">Total hours <span className="font-normal text-ink-soft">(optional)</span></label>
              <DecimalInput id="o-hours" value={o.totalHours} onChange={v => set({ totalHours: v })} placeholder="e.g. 4" />
            </div>
          </div>
          <p className="-mt-1 text-sm text-ink-soft">Prints as "{durationText(o.durationDays, o.totalHours) || '…'}".</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="o-aud">Target audience <span className="font-normal text-ink-soft">(one per line)</span></label>
              <textarea id="o-aud" value={o.audience || ''} onChange={e => set({ audience: e.target.value })} className={`${input} min-h-[76px]`} placeholder="e.g. All employees across departments and levels" />
            </div>
            <div>
              <label className={label} htmlFor="o-pre">Pre-requisites</label>
              <textarea id="o-pre" value={o.prerequisites || ''} onChange={e => set({ prerequisites: e.target.value })} className={`${input} min-h-[76px]`} placeholder="e.g. None" />
            </div>
          </div>
        </div>
      </Card>

      {/* Overview and outcomes */}
      <Card title={`${n(1)} Overview and learning outcomes`}>
        <div className="space-y-3">
          <div>
            <label className={label} htmlFor="o-over">Overview</label>
            <textarea id="o-over" value={o.overview || ''} onChange={e => set({ overview: e.target.value })} className={`${input} min-h-[110px]`} placeholder="A short summary of what the course covers and why it matters." />
          </div>
          <div>
            <label className={label} htmlFor="o-out">Learning outcomes (one per line)</label>
            <p className="mb-1 text-sm text-ink-soft">Printed under "Upon completion of this program, the participants should be able to:"</p>
            <textarea id="o-out" value={(o.outcomes || []).join('\n')} onChange={e => set({ outcomes: e.target.value.split('\n') })} className={`${input} min-h-[110px]`} placeholder={'Understand their own and others\' personality styles\nCommunicate more effectively across differences'} />
          </div>
          <div>
            <label className={label} htmlFor="o-methods">Learning methods (one per line)</label>
            <textarea id="o-methods" value={(o.methods || []).join('\n')} onChange={e => set({ methods: e.target.value.split('\n') })} className={`${input} min-h-[90px]`} placeholder={'Interactive lecture & guided discussion\nRole-play simulations\nCase studies'} />
          </div>
        </div>
      </Card>

      {/* Modules */}
      <Card title={`${n(2)} Modules (${items.length})`}>
        {dayCount > 1 && (
          <div className="mb-3 space-y-2 rounded-xl bg-surface p-3">
            <p className="text-sm text-ink-soft">This is a {dayCount}-day course: pick each module's day below. Day titles are optional (e.g. "Sales Planning Foundations").</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {Array.from({ length: dayCount }, (_, k) => (
                <div key={k}>
                  <label className={label} htmlFor={`o-day-${k}`}>Day {k + 1} title</label>
                  <input id={`o-day-${k}`} value={o.dayTitles?.[k] || ''} onChange={e => setDayTitle(k + 1, e.target.value)} className={input} placeholder="Optional" />
                </div>
              ))}
            </div>
          </div>
        )}
        <ol className="space-y-3">
          {items.map((m, i) => (
            <li key={m.id} className="rounded-xl border border-line p-3.5">
              <div className="flex items-start gap-3">
                <span className="mt-2 w-6 shrink-0 text-center font-bold text-ink-soft">{i + 1}</span>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className={dayCount > 1 ? 'grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem]' : ''}>
                    <input value={m.moduleTitle} onChange={e => setItem(i, { moduleTitle: e.target.value })} className={input} placeholder="Module title" aria-label={`Module ${i + 1} title`} />
                    {dayCount > 1 && (
                      <select value={m.day || 1} onChange={e => setItem(i, { day: Number(e.target.value) })} className={input} aria-label={`Module ${i + 1} day`}>
                        {Array.from({ length: dayCount }, (_, k) => <option key={k} value={k + 1}>Day {k + 1}</option>)}
                      </select>
                    )}
                  </div>
                  <textarea value={m.topics} onChange={e => setItem(i, { topics: e.target.value })} className={`${input} min-h-[80px]`} placeholder={'Topics, one per line\nIcebreakers to create engagement and trust\nSetting the tone for collaboration'} aria-label={`Module ${i + 1} topics`} />
                </div>
                {!locked && (
                  <span className="flex shrink-0 flex-col">
                    <button type="button" className={iconBtn} disabled={i === 0} onClick={() => moveItem(i, -1)} aria-label={`Move module ${i + 1} up`}><ArrowUp className="h-4 w-4" /></button>
                    <button type="button" className={iconBtn} disabled={i === items.length - 1} onClick={() => moveItem(i, 1)} aria-label={`Move module ${i + 1} down`}><ArrowDown className="h-4 w-4" /></button>
                    <button type="button" className={`${iconBtn} hover:text-danger`} onClick={() => removeItem(i)} aria-label={`Remove module ${i + 1}`}><X className="h-4 w-4" /></button>
                  </span>
                )}
              </div>
            </li>
          ))}
        </ol>
        {!locked && <button type="button" className={`${btnSecondary} mt-3`} onClick={addItem}><Plus className="h-4 w-4" /> Add module</button>}
      </Card>

      {/* Agenda: teambuilding outlines use the proposal's day-by-day builder (each day folds) */}
      {isTb ? (
        <Card title={`${n(3)} Agenda (optional${agenda.length ? `, ${agenda.filter(r => !r.isDay).length} time slots` : ''})`}>
          <p className="mb-3 text-[15px] text-ink-soft">Day by day, like the teambuilding proposal. Click a day's arrow to fold it. Leave it empty and the outline has no agenda page.</p>
          {locked ? (
            <p className="text-[15px] text-ink-soft">{agenda.length ? 'See Preview.' : 'No agenda.'}</p>
          ) : (
            <DayAgenda collapsible days={agendaToDays(agenda)} onChange={d => set({ agenda: daysToAgenda(d) })} />
          )}
        </Card>
      ) : (
      <Card title={`${n(3)} Course agenda (optional${agenda.length ? `, ${agenda.filter(r => !r.isDay).length} time slots` : ''})`}>
        <p className="mb-3 text-[15px] text-ink-soft">Only some courses need an agenda. Leave this empty and the outline has no agenda page, just the modules. If you add time slots, they print as a table on their own page. "Module 1" at the start prints in bold.</p>
        {agenda.length > 0 && (
          <ol className="space-y-2">
            {agenda.map((row, i) => (
              <li key={row.id} className={`flex items-start gap-2 rounded-xl border border-line p-2.5 ${row.isDay ? 'bg-surface' : ''}`}>
                <div className={`min-w-0 flex-1 ${row.isDay ? '' : 'grid gap-2 sm:grid-cols-[13rem_minmax(0,1fr)]'}`}>
                  {!row.isDay && <input value={row.time} onChange={e => setRow(i, { time: e.target.value })} className={input} placeholder="9:00 AM – 9:35 AM" aria-label={`Agenda row ${i + 1} time`} />}
                  <input value={row.text} onChange={e => setRow(i, { text: e.target.value })} className={`${input} ${row.isDay ? 'font-semibold' : ''}`}
                    placeholder={row.isDay ? 'Day 1' : 'Module 1: Ice breaker & team warm-up'} aria-label={row.isDay ? `Day heading ${i + 1}` : `Agenda row ${i + 1}`} />
                </div>
                {!locked && (
                  <span className="flex shrink-0 items-center">
                    <button type="button" className={iconBtn} disabled={i === 0} onClick={() => moveRow(i, -1)} aria-label={`Move agenda row ${i + 1} up`}><ArrowUp className="h-4 w-4" /></button>
                    <button type="button" className={iconBtn} disabled={i === agenda.length - 1} onClick={() => moveRow(i, 1)} aria-label={`Move agenda row ${i + 1} down`}><ArrowDown className="h-4 w-4" /></button>
                    <button type="button" className={`${iconBtn} hover:text-danger`} onClick={() => removeRow(i)} aria-label={`Remove agenda row ${i + 1}`}><X className="h-4 w-4" /></button>
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
        {!locked && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={btnSecondary} onClick={() => addRow()}><Plus className="h-4 w-4" /> Add time slot</button>
            {dayCount > 1 && <button type="button" className={btnSecondary} onClick={() => addRow(true)}><Plus className="h-4 w-4" /> Add day heading</button>}
            {items.some(m => (m.moduleTitle || '').trim()) && (
              <button type="button" className={btnSecondary}
                onClick={() => { if (!agenda.length || window.confirm('Replace the agenda with one row per module?')) agendaFromModules(); }}>
                Fill in from the modules
              </button>
            )}
          </div>
        )}
      </Card>
      )}

      {/* Optional extras */}
      <Card title={`${n(4)} Optional extras`}>
        <p className="mb-3 text-[15px] text-ink-soft">Printed on the overview page only when filled in.</p>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className={label} htmlFor="o-diff">Difficulty</label>
              <select id="o-diff" value={o.difficulty || ''} onChange={e => set({ difficulty: e.target.value })} className={input}>
                <option value="">Don't show</option>
                {DIFFICULTIES.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className={label} htmlFor="o-bloom">Bloom's taxonomy level</label>
              <select id="o-bloom" value={o.bloomLevel || 0} onChange={e => set({ bloomLevel: Number(e.target.value) })} className={input}>
                <option value={0}>Don't show</option>
                {BLOOM_LEVELS.map((b, k) => <option key={b} value={k + 1}>Level {k + 1}: {b}</option>)}
              </select>
            </div>
            <div>
              <label className={label} htmlFor="o-by">Designed by</label>
              <input id="o-by" value={o.designedBy || ''} onChange={e => set({ designedBy: e.target.value })} className={input} placeholder="e.g. the trainer's name" />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="o-eval">Evaluation method (one per line)</label>
              <textarea id="o-eval" value={(o.evaluation || []).join('\n')} onChange={e => set({ evaluation: e.target.value.split('\n') })} className={`${input} min-h-[76px]`} placeholder={'Quiz\nGroup presentation'} />
            </div>
            <div>
              <label className={label} htmlFor="o-next">Recommended next training (one per line)</label>
              <textarea id="o-next" value={(o.nextTraining || []).join('\n')} onChange={e => set({ nextTraining: e.target.value.split('\n') })} className={`${input} min-h-[76px]`} placeholder={'Emotional Quotient - Level 1'} />
            </div>
          </div>
        </div>
      </Card>
    </>
  );
}
