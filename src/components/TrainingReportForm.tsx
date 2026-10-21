// The training report form (2026-10-21; lib/trainingReport.ts). One form for the trainer (trainer portal) and for
// Admin or Management writing it on the deal for a trainer without portal access (TrainingReportAdmin.tsx).
// First the part HR sees, then "For NEXT Academy only" (shown to HR only when Management ticks it).

import React, { useId, useState } from 'react';
import { Lock, Plus, Star, X } from 'lucide-react';
import {
  FollowUp, NamedReason, REVIEW_PARTS, ReportDay, Revision, TIME_LABELS, TimeKey, TrainingReport, absentCount, attendancePct, presentCount, revisionWhen,
} from '../lib/trainingReport';

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15 disabled:bg-surface';
const label = 'mb-1 block text-sm font-semibold text-ink';
const hint = 'mb-2 text-sm text-ink-soft';
const card = 'rounded-2xl border border-line bg-white p-4 sm:p-5';
const addBtn = 'inline-flex items-center gap-1.5 rounded-lg border border-dashed border-line px-3 py-1.5 text-sm font-semibold text-accent hover:bg-accent-soft disabled:opacity-50';
const removeBtn = 'rounded-md p-1.5 text-ink-soft hover:bg-surface hover:text-danger';

const dayText = (iso: string) => (iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '');

export function StarPicker({ value, onChange, disabled, label: name }: { value: number; onChange: (n: number) => void; disabled?: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-0.5" role="radiogroup" aria-label={name}>
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n === 1 ? '' : 's'}`} disabled={disabled}
          onClick={() => onChange(value === n ? 0 : n)} className="rounded p-0.5 disabled:cursor-default">
          <Star className={`h-6 w-6 ${n <= value ? 'fill-[#E2A400] text-[#E2A400]' : 'text-line'}`} />
        </button>
      ))}
    </span>
  );
}

// Names typed one at a time (Enter or Add), suggested from the participants list.
function NameChips({ names, onChange, suggestions, disabled, placeholder, aria }: {
  names: string[]; onChange: (n: string[]) => void; suggestions: string[]; disabled?: boolean; placeholder: string; aria: string;
}) {
  const [text, setText] = useState('');
  const listId = useId();
  const add = () => {
    const n = text.replace(/\s+/g, ' ').trim();
    if (!n) return;
    if (!names.some(x => x.toLowerCase() === n.toLowerCase())) onChange([...names, n]);
    setText('');
  };
  return (
    <div>
      {names.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {names.map(n => (
            <li key={n} className="flex items-center gap-1 rounded-full bg-surface py-1 pl-3 pr-1 text-sm">
              {n}
              {!disabled && <button type="button" className="rounded-full p-0.5 text-ink-soft hover:text-danger" aria-label={`Remove ${n}`} onClick={() => onChange(names.filter(x => x !== n))}><X className="h-3.5 w-3.5" /></button>}
            </li>
          ))}
        </ul>
      )}
      {!disabled && (
        <div className="flex gap-2">
          <input className={input} value={text} list={listId} placeholder={placeholder} aria-label={aria} onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
          <button type="button" className={addBtn} onClick={add}><Plus className="h-4 w-4" /> Add</button>
          <datalist id={listId}>{suggestions.filter(s => !names.includes(s)).map(s => <option key={s} value={s} />)}</datalist>
        </div>
      )}
    </div>
  );
}

// Several people, each with a reason (outstanding participants, participants who need attention).
function PeopleList({ rows, onChange, suggestions, disabled, reasonHint, what }: {
  rows: NamedReason[]; onChange: (r: NamedReason[]) => void; suggestions: string[]; disabled?: boolean; reasonHint: string; what: string;
}) {
  const listId = useId();
  const set = (i: number, c: Partial<NamedReason>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...c } : r)));
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="flex items-start gap-2 rounded-xl border border-line p-2.5">
          <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(0,14rem)_1fr]">
            <input className={input} value={r.name} list={listId} disabled={disabled} placeholder="Name" aria-label={`${what} ${i + 1}: name`} onChange={e => set(i, { name: e.target.value })} />
            <input className={input} value={r.reason} disabled={disabled} placeholder={reasonHint} aria-label={`${what} ${i + 1}: why`} onChange={e => set(i, { reason: e.target.value })} />
          </div>
          {!disabled && <button type="button" className={removeBtn} aria-label={`Remove ${what} ${i + 1}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}><X className="h-4 w-4" /></button>}
        </div>
      ))}
      <datalist id={listId}>{suggestions.map(s => <option key={s} value={s} />)}</datalist>
      {!disabled && <button type="button" className={addBtn} onClick={() => onChange([...rows, { name: '', reason: '' }])}><Plus className="h-4 w-4" /> Add {rows.length ? 'another' : 'a person'}</button>}
      {disabled && !rows.length && <p className="text-sm text-ink-soft">None.</p>}
    </div>
  );
}

// The trainer's changes after sending: when (date and time), who, and what changed. Newest first.
export function RevisionList({ revisions, title = 'Changes after sending' }: { revisions: Revision[]; title?: string }) {
  return (
    <section className={card}>
      <h3 className="text-base font-bold">{title}</h3>
      <ol className="mt-2 space-y-3">
        {[...revisions].reverse().map((v, i) => (
          <li key={i} className="text-sm">
            <p className="font-semibold">{revisionWhen(v.at)} · {v.byName}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-soft">{v.changes.map((c, j) => <li key={j}>{c}</li>)}</ul>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function TrainingReportForm({ value: r, onChange, names, pax = 0, paxNote = 'From the training details. Ask NEXT Academy if this number is wrong.', programmes, disabled, photos, teamPart }: {
  value: TrainingReport;
  onChange: (r: TrainingReport) => void;
  names: string[];                              // participants (T3 list), for suggestions
  pax?: number;                                 // the deal's Participants: shown, not typed (0 = type it)
  paxNote?: string;
  programmes: { id: string; name: string }[];   // for recommended follow-up training
  disabled?: boolean;
  photos?: React.ReactNode;                     // the photo picker (portal upload or the team's pick)
  teamPart?: React.ReactNode;                   // Admin and Management: participant rating
}) {
  const set = (c: Partial<TrainingReport>) => onChange({ ...r, ...c });
  const setDay = (i: number, c: Partial<ReportDay>) => set({ days: r.days.map((d, j) => (j === i ? { ...d, ...c } : d)) });
  const setInt = (c: Partial<TrainingReport['internal']>) => set({ internal: { ...r.internal, ...c } });
  const setFollow = (i: number, c: Partial<FollowUp>) => set({ followUps: r.followUps.map((f, j) => (j === i ? { ...f, ...c } : f)) });
  const pct = attendancePct(r);

  return (
    <div className="space-y-5">
      {/* 1. Attendance */}
      <section className={card}>
        <h3 className="text-base font-bold">Attendance</h3>
        <p className={hint}>Who wasn't there, day by day. The number absent and the attendance rate are counted for you.</p>
        <div className="max-w-xs">
          <label className={label} htmlFor="rep-registered">Participants registered</label>
          {/* The deal's Participants (2026-10-21); typed here only when the deal has none */}
          {pax > 0 ? (
            <>
              <p id="rep-registered" className="text-[15px]"><strong>{pax} pax</strong></p>
              <p className={hint}>{paxNote}</p>
            </>
          ) : (
            <>
              <input id="rep-registered" type="number" min={0} inputMode="numeric" className={input} disabled={disabled} value={r.registered || ''}
                onChange={e => set({ registered: Math.max(0, Math.round(Number(e.target.value) || 0)) })} />
              {names.length > 0 && r.registered !== names.length && !disabled && (
                <button type="button" className="mt-1 text-sm font-semibold text-accent hover:underline" onClick={() => set({ registered: names.length })}>Use {names.length} from the participants list</button>
              )}
            </>
          )}
        </div>
        <div className="mt-4 space-y-3">
          {r.days.map((d, i) => (
            <div key={d.date || i} className="rounded-xl border border-line p-3">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold">{r.days.length > 1 ? `Day ${i + 1}` : 'Training day'}{d.date ? ` · ${dayText(d.date)}` : ''}</p>
                <p className="text-sm text-ink-soft">
                  {r.registered ? <><strong className="text-ink">{presentCount(r.registered, d)}</strong> present · </> : null}
                  <strong className={absentCount(d) ? 'text-danger' : 'text-ink'}>{absentCount(d)}</strong> absent
                </p>
              </div>
              <p className="mb-1 text-sm font-semibold">Absent</p>
              <NameChips names={d.absent} onChange={absent => setDay(i, { absent })} suggestions={names} disabled={disabled} placeholder="Type a name, then Enter" aria={`Absent on ${d.date || 'the day'}`} />
              <p className="mb-1 mt-3 text-sm font-semibold">Came late or left early <span className="font-normal text-ink-soft">(HRDC may not count part attendance)</span></p>
              <NameChips names={d.late} onChange={late => setDay(i, { late })} suggestions={names} disabled={disabled} placeholder="Type a name, then Enter" aria={`Late or left early on ${d.date || 'the day'}`} />
              <input className={`${input} mt-3`} disabled={disabled} value={d.note} placeholder="Note for this day (optional)" aria-label={`Note for ${d.date || 'the day'}`} onChange={e => setDay(i, { note: e.target.value })} />
            </div>
          ))}
        </div>
        {r.registered > 0 && <p className="mt-3 text-sm">Attendance rate: <strong>{pct}%</strong></p>}
      </section>

      {/* 2. Objectives */}
      <section className={card}>
        <h3 className="text-base font-bold">Did we achieve the agreed objectives?</h3>
        <p className={hint}>Rate each objective from 1 to 5 stars and say why. {r.objectives.length ? 'They come from the course outline.' : 'Add the objectives agreed with the client.'}</p>
        <div className="space-y-3">
          {r.objectives.map((o, i) => (
            <div key={i} className="rounded-xl border border-line p-3">
              <div className="flex items-start gap-2">
                <input className={`${input} font-semibold`} disabled={disabled} value={o.text} aria-label={`Objective ${i + 1}`} placeholder="Objective"
                  onChange={e => set({ objectives: r.objectives.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />
                {!disabled && <button type="button" className={removeBtn} aria-label={`Remove objective ${i + 1}`} onClick={() => set({ objectives: r.objectives.filter((_, j) => j !== i) })}><X className="h-4 w-4" /></button>}
              </div>
              <div className="mt-2"><StarPicker value={o.stars} disabled={disabled} label={`Objective ${i + 1} rating`} onChange={stars => set({ objectives: r.objectives.map((x, j) => (j === i ? { ...x, stars } : x)) })} /></div>
              <textarea className={`${input} mt-2`} rows={2} disabled={disabled} value={o.comment} placeholder="Comment: what shows it was (or wasn't) achieved" aria-label={`Objective ${i + 1} comment`}
                onChange={e => set({ objectives: r.objectives.map((x, j) => (j === i ? { ...x, comment: e.target.value } : x)) })} />
            </div>
          ))}
          {!disabled && <button type="button" className={addBtn} onClick={() => set({ objectives: [...r.objectives, { text: '', stars: 0, comment: '' }] })}><Plus className="h-4 w-4" /> Add an objective</button>}
        </div>
      </section>

      {/* 3. Participant rating (the team fills it from the Output assessment) */}
      {teamPart}

      {/* 4. Observations */}
      <section className={card}>
        <h3 className="text-base font-bold">Trainer's observations</h3>
        <p className={hint}>How the group took part, what they did well, where they still have gaps.</p>
        <textarea className={input} rows={5} disabled={disabled} value={r.observations} aria-label="Trainer's observations" onChange={e => set({ observations: e.target.value })} />
      </section>

      {/* 5. People */}
      <section className={card}>
        <h3 className="text-base font-bold">Outstanding participants</h3>
        <p className={hint}>Anyone who stood out. Add as many as you like.</p>
        <PeopleList rows={r.outstanding} onChange={outstanding => set({ outstanding })} suggestions={names} disabled={disabled} reasonHint="Why they stood out" what="Outstanding participant" />
      </section>
      <section className={card}>
        <h3 className="text-base font-bold">Participants who may need special attention</h3>
        <p className={hint}>Keep it factual and kind: HR will read this about their own staff.</p>
        <PeopleList rows={r.attention} onChange={attention => set({ attention })} suggestions={names} disabled={disabled} reasonHint="What they need help with" what="Participant needing attention" />
      </section>

      {/* 6. Follow-up training */}
      <section className={card}>
        <h3 className="text-base font-bold">Recommended follow-up training</h3>
        <p className={hint}>What this group should do next. Pick from our programmes or type one.</p>
        <div className="space-y-2">
          {r.followUps.map((f, i) => (
            <div key={i} className="flex items-start gap-2 rounded-xl border border-line p-2.5">
              <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(0,16rem)_1fr]">
                <input className={input} list="rep-programmes" disabled={disabled} value={f.name} placeholder="Programme" aria-label={`Follow-up ${i + 1}: programme`}
                  onChange={e => { const p = programmes.find(x => x.name === e.target.value); setFollow(i, { name: e.target.value, programmeId: p?.id || '' }); }} />
                <input className={input} disabled={disabled} value={f.reason} placeholder="Why, and for whom" aria-label={`Follow-up ${i + 1}: why`} onChange={e => setFollow(i, { reason: e.target.value })} />
              </div>
              {!disabled && <button type="button" className={removeBtn} aria-label={`Remove follow-up ${i + 1}`} onClick={() => set({ followUps: r.followUps.filter((_, j) => j !== i) })}><X className="h-4 w-4" /></button>}
            </div>
          ))}
          <datalist id="rep-programmes">{programmes.map(p => <option key={p.id} value={p.name} />)}</datalist>
          {!disabled && <button type="button" className={addBtn} onClick={() => set({ followUps: [...r.followUps, { programmeId: '', name: '', reason: '' }] })}><Plus className="h-4 w-4" /> Add a recommendation</button>}
          {disabled && !r.followUps.length && <p className="text-sm text-ink-soft">None.</p>}
        </div>
      </section>

      {photos && (
        <section className={card}>
          <h3 className="text-base font-bold">Photos for the report</h3>
          <p className={hint}>4 to 6 good photos of the training. Up to 12.</p>
          {photos}
        </section>
      )}

      {/* 7. For NEXT Academy only */}
      <section className={`${card} border-ink/15 bg-surface/60`}>
        <h3 className="flex items-center gap-2 text-base font-bold"><Lock className="h-4 w-4 text-ink-soft" /> For NEXT Academy only</h3>
        <p className={hint}>HR doesn't see this part unless NEXT Academy decides to include it.</p>
        <div className="space-y-4">
          <div>
            <p className={label}>Your rating of the training</p>
            <StarPicker value={r.internal.trainerStars} disabled={disabled} label="Trainer's rating of the training" onChange={trainerStars => setInt({ trainerStars })} />
          </div>
          <div>
            <p className={label}>Time management</p>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(TIME_LABELS) as Exclude<TimeKey, ''>[]).map(k => (
                <button key={k} type="button" disabled={disabled} aria-pressed={r.internal.time === k} onClick={() => setInt({ time: r.internal.time === k ? '' : k })}
                  className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${r.internal.time === k ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-white text-ink-soft hover:bg-surface'}`}>{TIME_LABELS[k]}</button>
              ))}
            </div>
            <input className={`${input} mt-2`} disabled={disabled} value={r.internal.timeNote} placeholder="Which part ran over or was rushed? (optional)" aria-label="Time management note" onChange={e => setInt({ timeNote: e.target.value })} />
          </div>
          <div>
            <label className={label} htmlFor="rep-missing">What was missing</label>
            <textarea id="rep-missing" className={input} rows={2} disabled={disabled} value={r.internal.missing} placeholder="Materials, equipment, information, content..." onChange={e => setInt({ missing: e.target.value })} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {REVIEW_PARTS.map(p => (
              <div key={p.key}>
                <label className={label} htmlFor={`rep-${p.key}`}>{p.label}</label>
                <textarea id={`rep-${p.key}`} className={input} rows={2} disabled={disabled} value={r.internal[p.key]} placeholder={p.hint} onChange={e => setInt({ [p.key]: e.target.value })} />
              </div>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="rep-issues">Issues on the day</label>
              <textarea id="rep-issues" className={input} rows={2} disabled={disabled} value={r.internal.issues} placeholder="Venue, equipment, food, transport" onChange={e => setInt({ issues: e.target.value })} />
            </div>
            <div>
              <label className={label} htmlFor="rep-leads">Sales leads spotted</label>
              <textarea id="rep-leads" className={input} rows={2} disabled={disabled} value={r.internal.leads} placeholder="Other departments interested, a manager asking about other courses" onChange={e => setInt({ leads: e.target.value })} />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
