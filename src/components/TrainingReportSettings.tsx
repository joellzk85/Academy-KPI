// Training report settings (Joel, 2026-10-27: "Training report setting page. Preview. Set questions. Only viewable by
// managers"). Opened from Trainers → Training reports → Settings, Management only. Two tabs:
//   Questions: each section on or off, its title and hint, required or optional, on HR's / the HOD's copy by default;
//     Management's own questions; the questions of the HOD's 30-day check-in; Back to default.
//   Preview: the trainer's form, HR's copy, the HOD's copy and the check-in page, with a made-up example.
// Saves by itself (useAutoSave) to config/training_report (lib/reportSettings.ts); changes apply to reports from then on.

import React, { useEffect, useState } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { ArrowDown, ArrowUp, Lock, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import {
  ANSWER_TYPES, AnswerType, CopyKind, CustomQuestion, DEFAULT_CHECKIN, ReportSettings, SECTIONS, SectionKey, SectionSetting, checkinQuestions, emptySettings,
  newQuestionId, readReportSettings, sampleReport, sectionOf,
} from '../lib/reportSettings';
import { TrainingReport, copyOf } from '../lib/trainingReport';
import { autoSaveText, leaveAfterSave, useAutoSave } from '../lib/useAutoSave';
import PanelResizer from './PanelResizer';
import TrainingReportForm from './TrainingReportForm';
import TrainingReportDocument from './TrainingReportDocument';
import { CheckinForm } from './CheckinPage';
import FitWidth from './FitWidth';

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15 disabled:bg-surface';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';
const addBtn = 'inline-flex items-center gap-1.5 rounded-lg border border-dashed border-line px-3 py-1.5 text-sm font-semibold text-accent hover:bg-accent-soft';
const iconBtn = 'rounded-md p-1.5 text-ink-soft hover:bg-surface hover:text-ink disabled:opacity-30';
const tick = 'h-4 w-4 accent-[#0E6E62]';
const card = 'rounded-2xl border border-line bg-white p-4';

const SAMPLE_HEADER = { programme: 'Coaching for team leaders', client: 'Example Sdn Bhd', dates: '10 to 11 Nov 2026', venue: 'Example hotel, Kuala Lumpur', trainer: 'Trainer name', grantNumber: '1234567' };
const SAMPLE_NAMES = ['Participant A', 'Participant B', 'Participant C', 'Participant D'];

// Saved without empty overrides, so a default stays a default.
function toSave(s: ReportSettings, viewer: Viewer) {
  const sections: Record<string, SectionSetting> = {};
  Object.entries(s.sections).forEach(([k, v]) => {
    const d = SECTIONS.find(x => x.key === k)!;
    const x: SectionSetting = {};
    if (v?.label && v.label.trim() && v.label.trim() !== d.label) x.label = v.label.trim();
    if (v?.hint !== undefined && v.hint.trim() !== d.hint) x.hint = v.hint.trim();
    if (v?.off === true && !d.locked) x.off = true;
    if (v?.required !== undefined && v.required !== d.required && d.canRequire) x.required = v.required;
    if (v?.hr !== undefined && v.hr !== d.hr) x.hr = v.hr;
    if (v?.hod !== undefined && v.hod !== d.hod) x.hod = v.hod;
    if (Object.keys(x).length) sections[k] = x;
  });
  return JSON.parse(JSON.stringify({ sections, custom: s.custom, checkin: s.checkin, updatedAt: new Date().toISOString(), updatedByName: viewer.name }));
}

export default function TrainingReportSettings({ viewer, onClose }: { viewer: Viewer; onClose: () => void }) {
  const [s, setS] = useState<ReportSettings | null>(null);
  const [savedJson, setSavedJson] = useState('');
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'questions' | 'preview'>('questions');

  useEffect(() => {
    getDoc(doc(db, 'config', 'training_report'))
      .then(x => { const v = readReportSettings(x.data()); setS(v); setSavedJson(JSON.stringify(v)); })
      .catch(e => setError(friendlyError(e)));
  }, []);

  const json = s ? JSON.stringify(s) : '';
  const dirty = !!s && json !== savedJson;
  const { state, flush } = useAutoSave({
    value: s, dirty, enabled: !!s,
    write: async v => { if (v) await setDoc(doc(db, 'config', 'training_report'), toSave(v, viewer)); },
    onSaved: setSavedJson,
  });
  const close = () => leaveAfterSave(flush, onClose);
  const line = autoSaveText(state, dirty, false);

  const setSection = (k: SectionKey, c: SectionSetting) => s && setS({ ...s, sections: { ...s.sections, [k]: { ...(s.sections[k] || {}), ...c } } });
  const backToDefault = () => {
    if (!s || !window.confirm('Go back to the default questions? Your own questions, changed wording and check-in questions will be cleared. Reports already written keep their answers.')) return;
    setS(emptySettings());
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" role="dialog" aria-modal="true" aria-label="Training report settings">
      <PanelResizer />
      <div className="flex h-full w-full flex-col bg-surface shadow-xl md:w-[var(--panel-w,max(50vw,40rem))] md:min-w-[24rem] md:max-w-[95vw]">
        <div className="flex items-start justify-between gap-3 border-b border-line bg-white px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-lg font-bold">Training report settings</h3>
            <p className="text-sm text-ink-soft">What trainers are asked, and what HR and the head of department (HOD) see. Only Management sees this page.</p>
          </div>
          <button type="button" onClick={close} className="rounded-md p-1 text-ink-soft hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex gap-1 border-b border-line bg-white px-5 py-2" role="tablist" aria-label="Settings">
          {([['questions', 'Questions'], ['preview', 'Preview']] as const).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === k ? 'bg-accent-soft text-accent' : 'text-ink-soft hover:bg-surface'}`}>{l}</button>
          ))}
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
          {!s && !error && <p className="text-ink-soft">Loading…</p>}
          {s && tab === 'questions' && <QuestionsTab s={s} setS={setS} setSection={setSection} />}
          {s && tab === 'preview' && <PreviewTab s={s} />}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-white px-5 py-3">
          <span className={`text-sm ${line.tone === 'danger' ? 'text-danger' : line.tone === 'attention' ? 'text-attention' : 'text-ink-soft'}`}>
            {line.text.replace('Draft saves', 'Saves').replace('draft', 'settings').replace('Draft saved', 'Saved')}
            {s?.updatedByName && !dirty ? ` · last changed by ${s.updatedByName}` : ''}
          </span>
          <button type="button" className={btnSecondary} disabled={!s} onClick={backToDefault}><RotateCcw className="h-4 w-4" /> Back to default</button>
        </div>
      </div>
    </div>
  );
}

function QuestionsTab({ s, setS, setSection }: { s: ReportSettings; setS: (s: ReportSettings) => void; setSection: (k: SectionKey, c: SectionSetting) => void }) {
  const groups = [
    { title: 'The report', note: 'Shown to HR and the HOD unless you untick their copy.', group: 'main' as const },
    { title: 'For NEXT Academy only', note: 'Internal notes. Tick HR or HOD to put one on their copy by default.', group: 'internal' as const },
  ];
  return (
    <>
      <p className="rounded-lg bg-accent-soft/50 px-3 py-2.5 text-sm">
        Changes save by themselves and apply to every report from then on, including reports being written. Reports already written keep their answers.
        Attendance and objectives are always on: the HRDC claim relies on them.
      </p>
      {groups.map(g => (
        <section key={g.group} className={card}>
          <h4 className="text-base font-bold">{g.title}</h4>
          <p className="mb-2 text-sm text-ink-soft">{g.note}</p>
          <div className="mb-1 hidden grid-cols-[1fr_5rem_3rem_3rem] gap-2 text-xs font-semibold text-ink-soft sm:grid">
            <span>Section</span><span className="text-center">Required</span><span className="text-center">HR</span><span className="text-center">HOD</span>
          </div>
          <ul className="divide-y divide-line/60">
            {SECTIONS.filter(d => d.group === g.group).map(d => <SectionRow key={d.key} sec={sectionOf(s, d.key)} saved={s.sections[d.key] || {}} onChange={c => setSection(d.key, c)} />)}
          </ul>
        </section>
      ))}

      <section className={card}>
        <h4 className="text-base font-bold">Your own questions</h4>
        <p className="mb-3 text-sm text-ink-soft">Extra questions for the trainer. They show after the report's sections (or under "For NEXT Academy only" if you tick it).</p>
        <QuestionList list={s.custom} onChange={custom => setS({ ...s, custom })} copies />
      </section>

      <section className={card}>
        <h4 className="text-base font-bold">30-day check-in questions for the HOD</h4>
        <p className="mb-3 text-sm text-ink-soft">The HOD answers these on a private link about a month after the training. Their name and position are always asked.</p>
        <QuestionList list={checkinQuestions(s)} onChange={checkin => setS({ ...s, checkin })} />
        {s.checkin && (
          <button type="button" className="mt-2 text-sm font-semibold text-accent hover:underline" onClick={() => setS({ ...s, checkin: null })}>Use the default check-in questions</button>
        )}
      </section>
    </>
  );
}

function SectionRow({ sec, saved, onChange }: { sec: ReturnType<typeof sectionOf>; saved: SectionSetting; onChange: (c: SectionSetting) => void }) {
  const [open, setOpen] = useState(false);
  const def = SECTIONS.find(x => x.key === sec.key)!;
  return (
    <li className="py-2">
      <div className="grid grid-cols-[1fr_auto] items-center gap-2 sm:grid-cols-[1fr_5rem_3rem_3rem]">
        <div className="flex min-w-0 items-center gap-2">
          {sec.locked ? (
            <span title="Always on" className="flex h-4 w-4 items-center justify-center"><Lock className="h-3.5 w-3.5 text-ink-soft" /></span>
          ) : (
            <input type="checkbox" className={tick} checked={sec.on} aria-label={`${sec.label}: on`} onChange={e => onChange({ off: !e.target.checked })} />
          )}
          <button type="button" className={`min-w-0 truncate text-left text-[15px] hover:underline ${sec.on ? 'font-semibold' : 'text-ink-soft line-through'}`} onClick={() => setOpen(o => !o)} aria-expanded={open}>
            {sec.label}
          </button>
          {sec.team && <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 text-xs text-ink-soft">Typed by Admin</span>}
        </div>
        <div className="col-span-2 flex items-center gap-4 pl-6 text-sm sm:contents">
          <label className="flex items-center justify-center gap-1.5">
            <input type="checkbox" className={tick} disabled={!def.canRequire || !sec.on} checked={sec.required} aria-label={`${sec.label}: required`} onChange={e => onChange({ required: e.target.checked })} />
            <span className="sm:hidden">Required</span>
          </label>
          {(['hr', 'hod'] as CopyKind[]).map(c => (
            <label key={c} className="flex items-center justify-center gap-1.5">
              <input type="checkbox" className={tick} disabled={!sec.on} checked={sec.on && sec[c]} aria-label={`${sec.label}: on the ${c === 'hr' ? "HR's" : "HOD's"} copy`} onChange={e => onChange({ [c]: e.target.checked })} />
              <span className="sm:hidden">{c === 'hr' ? 'HR' : 'HOD'}</span>
            </label>
          ))}
        </div>
      </div>
      {open && (
        <div className="mt-2 grid gap-2 rounded-xl bg-surface/60 p-3">
          <label className="text-sm font-semibold">Title
            <input className={`${input} mt-1 font-normal`} value={saved.label ?? sec.label} placeholder={def.label} onChange={e => onChange({ label: e.target.value })} />
          </label>
          <label className="text-sm font-semibold">Hint for the trainer
            <textarea className={`${input} mt-1 font-normal`} rows={2} value={saved.hint ?? sec.hint} placeholder={def.hint} onChange={e => onChange({ hint: e.target.value })} />
          </label>
          {(saved.label !== undefined || saved.hint !== undefined) && (
            <button type="button" className="justify-self-start text-sm font-semibold text-accent hover:underline" onClick={() => onChange({ label: undefined, hint: undefined })}>Use the original wording</button>
          )}
        </div>
      )}
    </li>
  );
}

function QuestionList({ list, onChange, copies }: { list: CustomQuestion[]; onChange: (l: CustomQuestion[]) => void; copies?: boolean }) {
  const set = (i: number, c: Partial<CustomQuestion>) => onChange(list.map((q, j) => (j === i ? { ...q, ...c } : q)));
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const add = () => onChange([...list, { id: newQuestionId(), label: '', hint: '', type: 'long', options: [], required: false, internal: false, hr: copies ? true : false, hod: copies ? true : false }]);
  return (
    <div className="space-y-3">
      {list.map((q, i) => (
        <div key={q.id} className="rounded-xl border border-line p-3">
          <div className="flex items-start gap-2">
            <span className="mt-2 w-6 shrink-0 text-sm font-semibold text-ink-soft">{i + 1}.</span>
            <div className="grid min-w-0 flex-1 gap-2">
              <input className={`${input} font-semibold`} value={q.label} placeholder="The question" aria-label={`Question ${i + 1}`} onChange={e => set(i, { label: e.target.value })} />
              <input className={input} value={q.hint} placeholder="Hint (optional)" aria-label={`Question ${i + 1}: hint`} onChange={e => set(i, { hint: e.target.value })} />
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <select className={`${input} w-auto`} value={q.type} aria-label={`Question ${i + 1}: answer type`} onChange={e => set(i, { type: e.target.value as AnswerType })}>
                  {ANSWER_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
                <label className="flex items-center gap-1.5"><input type="checkbox" className={tick} checked={q.required} onChange={e => set(i, { required: e.target.checked })} /> Required</label>
                {copies && (
                  <>
                    <label className="flex items-center gap-1.5"><input type="checkbox" className={tick} checked={q.internal} onChange={e => set(i, { internal: e.target.checked, ...(e.target.checked ? { hr: false, hod: false } : {}) })} /> NEXT Academy only</label>
                    <label className="flex items-center gap-1.5"><input type="checkbox" className={tick} checked={q.hr} onChange={e => set(i, { hr: e.target.checked })} /> On HR's copy</label>
                    <label className="flex items-center gap-1.5"><input type="checkbox" className={tick} checked={q.hod} onChange={e => set(i, { hod: e.target.checked })} /> On HOD's copy</label>
                  </>
                )}
              </div>
              {q.type === 'choice' && (
                <textarea className={input} rows={3} value={q.options.join('\n')} placeholder={'The choices, one per line'} aria-label={`Question ${i + 1}: choices`}
                  onChange={e => set(i, { options: e.target.value.split('\n').map(x => x.slice(0, 120)).slice(0, 12) })} onBlur={() => set(i, { options: q.options.map(x => x.trim()).filter(Boolean) })} />
              )}
            </div>
            <div className="flex shrink-0 flex-col">
              <button type="button" className={iconBtn} disabled={i === 0} aria-label={`Move question ${i + 1} up`} onClick={() => move(i, -1)}><ArrowUp className="h-4 w-4" /></button>
              <button type="button" className={iconBtn} disabled={i === list.length - 1} aria-label={`Move question ${i + 1} down`} onClick={() => move(i, 1)}><ArrowDown className="h-4 w-4" /></button>
              <button type="button" className={`${iconBtn} hover:text-danger`} aria-label={`Delete question ${i + 1}`}
                onClick={() => { if (!q.label.trim() || window.confirm(`Delete "${q.label}"? Reports already written keep their answer.`)) onChange(list.filter((_, j) => j !== i)); }}><Trash2 className="h-4 w-4" /></button>
            </div>
          </div>
        </div>
      ))}
      {!list.length && <p className="text-sm text-ink-soft">None yet.</p>}
      <button type="button" className={addBtn} onClick={add}><Plus className="h-4 w-4" /> Add a question</button>
    </div>
  );
}

// The preview: the settings as they are on screen (saved or not), with a made-up example. Nothing is saved.
function PreviewTab({ s }: { s: ReportSettings }) {
  const [view, setView] = useState<'form' | 'hr' | 'hod' | 'checkin'>('form');
  const [blank, setBlank] = useState<TrainingReport>(() => ({ ...sampleReport(), status: 'draft', summary: '', observations: '', answers: [] }));
  const example = sampleReport();
  // The example answers Management's own questions, so they show on the copies.
  example.answers = s.custom.map(q => ({ id: q.id, label: q.label || 'Untitled question', type: q.type, internal: q.internal, value: q.type === 'stars' ? '4' : q.type === 'yesno' ? 'yes' : q.type === 'choice' ? q.options[0] || 'Example' : 'Example answer' }));
  return (
    <>
      <div className="flex flex-wrap gap-1 rounded-xl border border-line bg-white p-1" role="tablist" aria-label="Preview">
        {([['form', "Trainer's form"], ['hr', "HR's copy"], ['hod', "HOD's copy"], ['checkin', 'HOD check-in']] as const).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${view === k ? 'bg-accent-soft text-accent' : 'text-ink-soft hover:bg-surface'}`}>{l}</button>
        ))}
      </div>
      {view === 'form' && (
        <>
          <p className="text-sm text-ink-soft">What the trainer sees in the trainer portal. You can type in it to try it; nothing is saved.</p>
          <TrainingReportForm value={blank} onChange={setBlank} names={SAMPLE_NAMES} pax={12} programmes={[]} settings={s}
            photos={<p className="text-sm text-ink-soft">The trainer uploads photos here.</p>}
            teamPart={<section className="rounded-2xl border border-accent/30 bg-accent-soft/30 p-4 text-sm"><strong>Participants' rating</strong>: typed by Admin or Management (the trainer doesn't see this box).</section>} />
        </>
      )}
      {(view === 'hr' || view === 'hod') && (
        <>
          <p className="text-sm text-ink-soft">A made-up example of {view === 'hr' ? "HR's" : "the HOD's"} copy with the sections ticked for it.</p>
          <div className="overflow-hidden rounded-xl border border-line bg-white">
            <FitWidth width={820}><TrainingReportDocument r={copyOf(example, s, view)} h={SAMPLE_HEADER} /></FitWidth>
          </div>
        </>
      )}
      {view === 'checkin' && (
        <>
          <p className="text-sm text-ink-soft">What the HOD sees when they open the check-in link.</p>
          <CheckinForm header={{ programme: SAMPLE_HEADER.programme, client: SAMPLE_HEADER.client, dates: SAMPLE_HEADER.dates }} questions={s.checkin?.length ? s.checkin : DEFAULT_CHECKIN} preview />
        </>
      )}
    </>
  );
}
