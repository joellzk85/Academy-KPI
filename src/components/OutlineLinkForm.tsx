import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Eye, Loader2, Plus, X } from 'lucide-react';
import CourseOutlineDocument from './CourseOutlineDocument';
import { BLOOM_LEVELS, DIFFICULTIES, durationText } from '../lib/outlineContent';
import { OutlineSubmission, cleanOutline, outlineProblem, previewOutline } from '../lib/trainerLinks';

// The trainer's course outline form on a private link (/t/<token>), with the same parts as the CRM's
// outline editor, and a Preview of the outline as NEXT Academy prints it (Joel, 2026-10-20).
// Talks only to the CRM server. No download or print: the team sends the finished outline.

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const label = 'mb-1 block text-sm font-semibold text-ink';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-[15px] font-semibold text-white hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-surface disabled:opacity-60';
const iconBtn = 'rounded-md p-1.5 text-ink-soft hover:bg-surface hover:text-ink disabled:opacity-30';
const NO_PRINT = '@media print { html { display: none !important; } }';

type Module = { key: number; moduleTitle: string; topics: string; day?: number; duration?: string; methodology?: string };
type Row = { key: number; time: string; text: string; isDay?: boolean };
let keys = 0;
const k = () => ++keys;

// Lists are typed one per line, like the editor.
interface Draft {
  courseTitle: string; durationDays: number; totalHours: number; audience: string; prerequisites: string; overview: string;
  outcomes: string; methods: string; items: Module[]; dayTitles: string[]; agenda: Row[];
  difficulty: string; evaluation: string; bloomLevel: number; nextTraining: string; designedBy: string;
}

function toDraft(s: OutlineSubmission | null, title: string): Draft {
  const items = (s?.items || []).map(m => ({ ...m, key: k() }));
  return {
    courseTitle: s?.courseTitle || title || '', durationDays: s?.durationDays ?? 1, totalHours: s?.totalHours ?? 8,
    audience: s?.audience || '', prerequisites: s?.prerequisites || '', overview: s?.overview || '',
    outcomes: (s?.outcomes || []).join('\n'), methods: (s?.methods || []).join('\n'),
    items: items.length ? items : [{ key: k(), moduleTitle: '', topics: '' }],
    dayTitles: s?.dayTitles || [], agenda: (s?.agenda || []).map(r => ({ ...r, key: k() })),
    difficulty: s?.difficulty || '', evaluation: (s?.evaluation || []).join('\n'), bloomLevel: s?.bloomLevel || 0,
    nextTraining: (s?.nextTraining || []).join('\n'), designedBy: s?.designedBy || '',
  };
}

// A number box that lets "0." be typed on the way to "0.5".
function DecimalInput({ id, value, onChange, placeholder }: { id: string; value: number; onChange: (v: number) => void; placeholder?: string }) {
  const [text, setText] = useState(value ? String(value) : '');
  return (
    <input id={id} inputMode="decimal" value={text} placeholder={placeholder} className={input}
      onChange={e => { const t = e.target.value.replace(/[^0-9.]/g, ''); setText(t); onChange(Number(t) || 0); }} />
  );
}

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl border border-line bg-white p-5">
      <div><h2 className="font-bold">{title}</h2>{hint && <p className="text-sm text-ink-soft">{hint}</p>}</div>
      {children}
    </section>
  );
}

function move<T>(list: T[], i: number, dir: number): T[] {
  const j = i + dir;
  if (j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

// The trainer portal (2026-10-21) uses the same form for a trainer's own outlines: onData gets every change (saved as
// they type) and actions replaces the Submit button.
export default function OutlineLinkForm({ info, token = '', post, onDone, onData, actions }: {
  info: any; token?: string; post?: (path: string, body: any) => Promise<any>; onDone?: (sent: OutlineSubmission) => void;
  onData?: (data: OutlineSubmission) => void; actions?: React.ReactNode;
}) {
  const [d, setD] = useState<Draft>(() => toDraft(info.prefill ? cleanOutline(info.prefill) : null, info.title || ''));
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const set = (c: Partial<Draft>) => setD(x => ({ ...x, ...c }));

  const data = useMemo(() => cleanOutline(d), [d]);
  useEffect(() => { onData?.(data); }, [data]);
  const shown = useMemo(() => (preview ? previewOutline(data, info.title || '') : null), [preview, data, info.title]);
  const dayCount = Math.max(1, Math.ceil(d.durationDays || 0));

  const setItem = (i: number, c: Partial<Module>) => setD(x => ({ ...x, items: x.items.map((m, n) => (n === i ? { ...m, ...c } : m)) }));
  const setRow = (i: number, c: Partial<Row>) => setD(x => ({ ...x, agenda: x.agenda.map((r, n) => (n === i ? { ...r, ...c } : r)) }));
  const setDayTitle = (n: number, v: string) => setD(x => {
    const t = [...x.dayTitles];
    while (t.length < n) t.push('');
    t[n - 1] = v;
    return { ...x, dayTitles: t };
  });
  // A start: one row per module (and day headings), times left to type.
  const agendaFromModules = () => setD(x => {
    const mods = x.items.filter(m => m.moduleTitle.trim());
    const byDay = dayCount > 1 && mods.some(m => m.day);
    const rows: Row[] = [];
    let last = 0;
    mods.forEach((m, i) => {
      const day = m.day || 1;
      if (byDay && day !== last) { rows.push({ key: k(), time: '', text: `Day ${day}`, isDay: true }); last = day; }
      rows.push({ key: k(), time: '', text: `Module ${i + 1}: ${m.moduleTitle.trim()}` });
    });
    return { ...x, agenda: rows };
  });

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setProblem('');
    const p = outlineProblem(data);
    if (p) { setPreview(false); setProblem(p); return; }
    setBusy(true);
    try {
      await post?.('/api/trainer-link/submit', { token, data });
      onDone?.(data);
      window.scrollTo(0, 0);
    } catch (err: any) {
      setProblem(err.message);
    } finally {
      setBusy(false);
    }
  };

  const submitBar = (
    <>
      {problem && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{problem}</p>}
      <div className="flex flex-wrap justify-end gap-2 pb-10">
        {preview
          ? <button type="button" className={btnSecondary} onClick={() => { setPreview(false); window.scrollTo(0, 0); }}><ArrowLeft className="h-4 w-4" /> Back to edit</button>
          : <button type="button" className={btnSecondary} onClick={() => { setPreview(true); window.scrollTo(0, 0); }}><Eye className="h-4 w-4" /> Preview</button>}
        {actions ?? <button type="button" disabled={busy} className={btnPrimary} onClick={() => submit()}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Submit</button>}
      </div>
    </>
  );

  if (preview && shown) {
    return (
      <div className="space-y-4">
        <style dangerouslySetInnerHTML={{ __html: NO_PRINT }} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" className={btnSecondary} onClick={() => { setPreview(false); window.scrollTo(0, 0); }}><ArrowLeft className="h-4 w-4" /> Back to edit</button>
          <p className="text-sm text-ink-soft">How your outline will look when NEXT Academy sends it. The client's name goes on the cover.</p>
        </div>
        <CourseOutlineDocument o={shown} />
        {submitBar}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <Card title="1. Course details">
        <div><label className={label} htmlFor="t-title">Course title</label>
          <input id="t-title" value={d.courseTitle} onChange={e => set({ courseTitle: e.target.value })} className={input} placeholder="e.g. Leadership Essentials for New Managers" /></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className={label} htmlFor="t-days">Course duration (days)</label>
            <DecimalInput id="t-days" value={d.durationDays} onChange={v => set({ durationDays: v })} placeholder="e.g. 0.5 for half a day" /></div>
          <div><label className={label} htmlFor="t-hours">Total hours <span className="font-normal text-ink-soft">(optional)</span></label>
            <DecimalInput id="t-hours" value={d.totalHours} onChange={v => set({ totalHours: v })} placeholder="e.g. 7" /></div>
        </div>
        <p className="-mt-1 text-sm text-ink-soft">Prints as "{durationText(data.durationDays, data.totalHours) || '…'}".</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className={label} htmlFor="t-aud">Target audience <span className="font-normal text-ink-soft">(one per line)</span></label>
            <textarea id="t-aud" value={d.audience} onChange={e => set({ audience: e.target.value })} className={`${input} min-h-[76px] resize-y`} placeholder="e.g. All employees across departments and levels" /></div>
          <div><label className={label} htmlFor="t-pre">Pre-requisites</label>
            <textarea id="t-pre" value={d.prerequisites} onChange={e => set({ prerequisites: e.target.value })} className={`${input} min-h-[76px] resize-y`} placeholder="e.g. None" /></div>
        </div>
      </Card>

      <Card title="2. Overview and learning outcomes">
        <div><label className={label} htmlFor="t-ov">Overview</label>
          <textarea id="t-ov" value={d.overview} onChange={e => set({ overview: e.target.value })} className={`${input} min-h-[110px] resize-y`} placeholder="A short summary of what the course covers and why it matters." /></div>
        <div><label className={label} htmlFor="t-out">Learning outcomes (one per line)</label>
          <p className="mb-1 text-sm text-ink-soft">Printed under "Upon completion of this program, the participants should be able to:"</p>
          <textarea id="t-out" value={d.outcomes} onChange={e => set({ outcomes: e.target.value })} className={`${input} min-h-[110px] resize-y`} placeholder={"Understand their own and others' personality styles\nCommunicate more effectively across differences"} /></div>
        <div><label className={label} htmlFor="t-meth">Learning methods (one per line)</label>
          <textarea id="t-meth" value={d.methods} onChange={e => set({ methods: e.target.value })} className={`${input} min-h-[90px] resize-y`} placeholder={'Interactive lecture & guided discussion\nRole-play simulations\nCase studies'} /></div>
      </Card>

      <Card title={`3. Modules (${d.items.length})`}>
        {dayCount > 1 && (
          <div className="space-y-2 rounded-xl bg-surface p-3">
            <p className="text-sm text-ink-soft">This is a {dayCount}-day course: pick each module's day below. Day titles are optional.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {Array.from({ length: dayCount }, (_, n) => (
                <div key={n}><label className={label} htmlFor={`t-day-${n}`}>Day {n + 1} title</label>
                  <input id={`t-day-${n}`} value={d.dayTitles[n] || ''} onChange={e => setDayTitle(n + 1, e.target.value)} className={input} placeholder="Optional" /></div>
              ))}
            </div>
          </div>
        )}
        <ol className="space-y-3">
          {d.items.map((m, i) => (
            <li key={m.key} className="rounded-xl border border-line p-3.5">
              <div className="flex items-start gap-3">
                <span className="mt-2 w-6 shrink-0 text-center font-bold text-ink-soft">{i + 1}</span>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className={dayCount > 1 ? 'grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem]' : ''}>
                    <input value={m.moduleTitle} onChange={e => setItem(i, { moduleTitle: e.target.value })} className={input} placeholder="Module title" aria-label={`Module ${i + 1} title`} />
                    {dayCount > 1 && (
                      <select value={m.day || 1} onChange={e => setItem(i, { day: Number(e.target.value) })} className={input} aria-label={`Module ${i + 1} day`}>
                        {Array.from({ length: dayCount }, (_, n) => <option key={n} value={n + 1}>Day {n + 1}</option>)}
                      </select>
                    )}
                  </div>
                  <textarea value={m.topics} onChange={e => setItem(i, { topics: e.target.value })} className={`${input} min-h-[80px] resize-y`} placeholder={'Topics, one per line\nIcebreakers to create engagement and trust'} aria-label={`Module ${i + 1} topics`} />
                </div>
                <span className="flex shrink-0 flex-col">
                  <button type="button" className={iconBtn} disabled={i === 0} onClick={() => set({ items: move(d.items, i, -1) })} aria-label={`Move module ${i + 1} up`}><ArrowUp className="h-4 w-4" /></button>
                  <button type="button" className={iconBtn} disabled={i === d.items.length - 1} onClick={() => set({ items: move(d.items, i, 1) })} aria-label={`Move module ${i + 1} down`}><ArrowDown className="h-4 w-4" /></button>
                  <button type="button" className={`${iconBtn} hover:text-danger`} disabled={d.items.length === 1} onClick={() => set({ items: d.items.filter((_, n) => n !== i) })} aria-label={`Remove module ${i + 1}`}><X className="h-4 w-4" /></button>
                </span>
              </div>
            </li>
          ))}
        </ol>
        <button type="button" className={btnSecondary} onClick={() => set({ items: [...d.items, { key: k(), moduleTitle: '', topics: '' }] })}><Plus className="h-4 w-4" /> Add module</button>
      </Card>

      <Card title="4. Course agenda (optional)" hint='Leave it empty if the course has no agenda. Time slots print as a table on their own page; "Module 1" at the start prints in bold.'>
        {d.agenda.length > 0 && (
          <ol className="space-y-2">
            {d.agenda.map((row, i) => (
              <li key={row.key} className={`flex items-start gap-2 rounded-xl border border-line p-2.5 ${row.isDay ? 'bg-surface' : ''}`}>
                <div className={`min-w-0 flex-1 ${row.isDay ? '' : 'grid gap-2 sm:grid-cols-[13rem_minmax(0,1fr)]'}`}>
                  {!row.isDay && <input value={row.time} onChange={e => setRow(i, { time: e.target.value })} className={input} placeholder="9:00 AM – 9:35 AM" aria-label={`Agenda row ${i + 1} time`} />}
                  <input value={row.text} onChange={e => setRow(i, { text: e.target.value })} className={`${input} ${row.isDay ? 'font-semibold' : ''}`}
                    placeholder={row.isDay ? 'Day 1' : 'Module 1: Ice breaker & team warm-up'} aria-label={row.isDay ? `Day heading ${i + 1}` : `Agenda row ${i + 1}`} />
                </div>
                <span className="flex shrink-0 items-center">
                  <button type="button" className={iconBtn} disabled={i === 0} onClick={() => set({ agenda: move(d.agenda, i, -1) })} aria-label={`Move agenda row ${i + 1} up`}><ArrowUp className="h-4 w-4" /></button>
                  <button type="button" className={iconBtn} disabled={i === d.agenda.length - 1} onClick={() => set({ agenda: move(d.agenda, i, 1) })} aria-label={`Move agenda row ${i + 1} down`}><ArrowDown className="h-4 w-4" /></button>
                  <button type="button" className={`${iconBtn} hover:text-danger`} onClick={() => set({ agenda: d.agenda.filter((_, n) => n !== i) })} aria-label={`Remove agenda row ${i + 1}`}><X className="h-4 w-4" /></button>
                </span>
              </li>
            ))}
          </ol>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnSecondary} onClick={() => set({ agenda: [...d.agenda, { key: k(), time: '', text: '' }] })}><Plus className="h-4 w-4" /> Add time slot</button>
          {dayCount > 1 && <button type="button" className={btnSecondary} onClick={() => set({ agenda: [...d.agenda, { key: k(), time: '', text: '', isDay: true }] })}><Plus className="h-4 w-4" /> Add day heading</button>}
          {d.items.some(m => m.moduleTitle.trim()) && (
            <button type="button" className={btnSecondary} onClick={() => { if (!d.agenda.length || window.confirm('Replace the agenda with one row per module?')) agendaFromModules(); }}>Fill in from the modules</button>
          )}
        </div>
      </Card>

      <Card title="5. Optional extras" hint="Printed on the overview page only when filled in.">
        <div className="grid gap-3 sm:grid-cols-3">
          <div><label className={label} htmlFor="t-diff">Difficulty</label>
            <select id="t-diff" value={d.difficulty} onChange={e => set({ difficulty: e.target.value })} className={input}>
              <option value="">Don't show</option>
              {DIFFICULTIES.map(x => <option key={x} value={x}>{x}</option>)}
            </select></div>
          <div><label className={label} htmlFor="t-bloom">Bloom's taxonomy level</label>
            <select id="t-bloom" value={d.bloomLevel} onChange={e => set({ bloomLevel: Number(e.target.value) })} className={input}>
              <option value={0}>Don't show</option>
              {BLOOM_LEVELS.map((b, n) => <option key={b} value={n + 1}>Level {n + 1}: {b}</option>)}
            </select></div>
          <div><label className={label} htmlFor="t-by">Designed by</label>
            <input id="t-by" value={d.designedBy} onChange={e => set({ designedBy: e.target.value })} className={input} placeholder={info.trainerName || 'Your name'} /></div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className={label} htmlFor="t-eval">Evaluation method (one per line)</label>
            <textarea id="t-eval" value={d.evaluation} onChange={e => set({ evaluation: e.target.value })} className={`${input} min-h-[76px] resize-y`} placeholder={'Quiz\nGroup presentation'} /></div>
          <div><label className={label} htmlFor="t-next">Recommended next training (one per line)</label>
            <textarea id="t-next" value={d.nextTraining} onChange={e => set({ nextTraining: e.target.value })} className={`${input} min-h-[76px] resize-y`} /></div>
        </div>
      </Card>

      {submitBar}
    </form>
  );
}
