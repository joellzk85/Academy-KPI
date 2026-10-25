import React, { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import { Award, ClipboardCheck, Gauge, Loader2, Star } from 'lucide-react';
import Rating360Panel, { useRatingItems, useToRateCount } from './Rating360';
import { SectionBox, SidePanel, SkillGroupFolds, StarRow, useScorecard } from './Scorecard';
import { CommentList, ScoreTable, useCycles, useSelfReviews } from './AppraisalParts';
import DraftBar from './DraftBar';
import { db, friendlyError } from '../lib/firebase';
import { formatDate, todayIso } from '../lib/deals';
import { useFormDraft } from '../lib/useFormDraft';
import { kpiLight, LIGHT_BADGE, LIGHT_TEXT } from '../lib/kpi';
import { activeItems } from '../lib/rating360';
import { LEVEL_LABELS, Level, levelFor, PART_LABELS, PARTS, quarterText, skillsFor } from '../lib/scorecard';
import {
  AppraisalCycle, AppraisalResult, cleanSections, readResult, Section, SectionComments, SelfReview, selfProblem, selfReviewId,
} from '../lib/appraisalCycle';

// My appraisal (Joel, 2026-10-25), on everyone's My home. Shows only when there is something to do or to read:
// - An open appraisal round you are in: your self review (stars on your skills and HEART values, comments on every
//   section) and the teammates you still have to rate (the 360 panel). Both can be changed until Management closes it.
// - A released round: your result (appraisal_results, copied when Management released it) with everyone's comments.
// Nothing about anyone's ratings shows before Management releases the round. Data: lib/appraisalCycle.ts.

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };
type Person = { id: string; name: string };

const card = 'rounded-2xl border border-line bg-white p-5';
const primaryBtn = 'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-[15px] font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const secondaryBtn = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-50';

function useMyResults(memberId: string): AppraisalResult[] {
  const [list, setList] = useState<AppraisalResult[]>([]);
  useEffect(() => onSnapshot(query(collection(db, 'appraisal_results'), where('memberId', '==', memberId), where('released', '==', true)),
    s => setList(s.docs.map(d => readResult(d.id, d.data())).sort((a, b) => String(b.releasedAt || '').localeCompare(String(a.releasedAt || '')))),
    () => setList([])), [memberId]);
  return list;
}

export default function MyAppraisalCard({ viewer, people }: { viewer: Viewer; people: Person[] }) {
  const cycles = useCycles().filter(c => c.status === 'open' && c.people.includes(viewer.id));
  const selfs = useSelfReviews(viewer.id);
  const toRate = useToRateCount(viewer.id);
  const results = useMyResults(viewer.id).slice(0, 3);
  const [selfFor, setSelfFor] = useState<AppraisalCycle | null>(null);
  const [rating, setRating] = useState(false);
  const [result, setResult] = useState<AppraisalResult | null>(null);
  if (!cycles.length && !results.length) return null;
  const today = todayIso();
  return (
    <section className={card}>
      <h2 className="mb-3 flex items-center gap-2 text-lg font-bold"><Award className="h-5 w-5 text-accent" /> My appraisal</h2>
      <div className="space-y-3">
        {cycles.map(c => {
          const mine = selfs.find(s => s.cycleId === c.id);
          const late = c.dueDate && c.dueDate < today;
          return (
            <div key={c.id} className="rounded-xl bg-surface p-3.5">
              <p className="font-semibold">{c.name}</p>
              <p className={`text-sm ${late ? 'text-danger' : 'text-ink-soft'}`}>{c.dueDate ? `Please finish by ${formatDate(c.dueDate)}${late ? ' (past due)' : ''}` : 'Open now'}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className={mine?.sentAt ? secondaryBtn : primaryBtn} onClick={() => setSelfFor(c)}>
                  <ClipboardCheck className="h-4 w-4" /> {mine?.sentAt ? 'Self review sent · change' : 'Do my self review'}
                </button>
                <button type="button" className={toRate > 0 ? primaryBtn : secondaryBtn} onClick={() => setRating(true)}>
                  <Star className="h-4 w-4" /> {toRate > 0 ? `Rate teammates (${toRate} to go)` : 'Teammates rated · change'}
                </button>
              </div>
            </div>
          );
        })}
        {results.map(r => (
          <button key={r.id} type="button" onClick={() => setResult(r)} className="flex w-full items-center gap-3 rounded-xl bg-surface p-3.5 text-left hover:bg-accent-soft">
            <Gauge className={`h-6 w-6 ${r.overall === null ? 'text-ink-soft' : LIGHT_TEXT[kpiLight(r.overall)]}`} />
            <span className="flex-1"><span className="block font-semibold">Your {quarterText(r.quarter)} appraisal</span><span className="block text-sm text-ink-soft">Open to read your scores and comments</span></span>
            <strong className="text-xl tabular-nums">{r.overall === null ? '–' : `${r.overall}%`}</strong>
          </button>
        ))}
      </div>
      {selfFor && <SelfReviewPanel viewer={viewer} cycle={selfFor} existing={selfs.find(s => s.cycleId === selfFor.id)} onClose={() => setSelfFor(null)} />}
      {rating && <Rating360Panel viewer={viewer} people={people} onClose={() => setRating(false)} />}
      {result && <ResultPanel result={result} onClose={() => setResult(null)} />}
    </section>
  );
}

// ---------- Self review ----------
function SelfReviewPanel({ viewer, cycle, existing, onClose }: { viewer: Viewer; cycle: AppraisalCycle; existing?: SelfReview; onClose: () => void }) {
  const settings = useScorecard();
  const level: Level = levelFor(settings, viewer.id, viewer.role);
  const skills = skillsFor(settings, level);
  const values = activeItems(useRatingItems());
  const [v, setV] = useState(() => ({
    skills: { ...(existing?.skills || {}) }, na: (existing?.na || []).slice(), values: { ...(existing?.values || {}) },
    sections: { ...(existing?.sections || {}) } as SectionComments,
  }));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const draft = useFormDraft(viewer.id, `self-review:${cycle.id}`, v, setV);
  const setStars = (k: 'skills' | 'values', id: string, n: number) => { setV(x => ({ ...x, [k]: { ...x[k], [id]: n } })); setError(''); };
  const toggleNa = (id: string) => { setV(x => ({ ...x, na: x.na.includes(id) ? x.na.filter(y => y !== id) : [...x.na, id] })); setError(''); };
  const setSection = (s: Section, t: string) => setV(x => ({ ...x, sections: { ...x.sections, [s]: t } }));
  const save = async () => {
    const p = selfProblem(v, skills, values);
    if (p) return setError(p);
    setBusy(true); setError('');
    try {
      const scored = skills.filter(k => !v.na.includes(k.id));
      await setDoc(doc(db, 'self_reviews', selfReviewId(cycle.id, viewer.id)), {
        cycleId: cycle.id, memberId: viewer.id, memberName: viewer.name, quarter: cycle.quarter,
        skills: Object.fromEntries(scored.map(k => [k.id, v.skills[k.id]])),
        na: skills.filter(k => v.na.includes(k.id)).map(k => k.id),
        values: Object.fromEntries(values.map(x => [x.id, v.values[x.id]])),
        sections: cleanSections(v.sections),
        sentAt: existing?.sentAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
      });
      draft.clear();
      onClose();
    } catch (e) { setError(friendlyError(e)); setBusy(false); }
  };
  const box = (s: Section, title: string, placeholder: string) => <SectionBox id={`self-${s}`} title={title} text={v.sections[s] || ''} onChange={t => setSection(s, t)} placeholder={placeholder} />;
  return (
    <SidePanel title={`My self review: ${quarterText(cycle.quarter)}`} note={`${LEVEL_LABELS[level]}${cycle.dueDate ? ` · please finish by ${formatDate(cycle.dueDate)}` : ''}. You can change it until the round closes.`} onClose={onClose}>
      <DraftBar draft={draft} what="self review" />
      <section className="space-y-3 rounded-2xl border border-line bg-white p-5">
        <h4 className="text-lg font-bold">Performance</h4>
        {box('kpi', 'My results and KPIs', 'What went well, what got in the way, what you will do next quarter')}
        {box('reliability', 'My reliability', 'Following through, keeping time, keeping promises')}
      </section>
      <section className="space-y-3 rounded-2xl border border-line bg-white p-5">
        <h4 className="text-lg font-bold">Competency: my skills</h4>
        <SkillGroupFolds skills={skills} render={k => (
          <StarRow key={k.id} id={`self-${k.id}`} name={k.name} low={k.low} high={k.high} stars={v.skills[k.id] || 0} onStars={n => setStars('skills', k.id, n)}
            na={v.na.includes(k.id)} onNa={() => toggleNa(k.id)} />
        )} />
        {box('skills', 'Comment on my skills', 'What you are strong at, what you want to learn')}
      </section>
      <section className="space-y-3 rounded-2xl border border-line bg-white p-5">
        <h4 className="text-lg font-bold">Behavioural: HEART values</h4>
        {values.map(x => <StarRow key={x.id} id={`self-${x.id}`} name={x.name} low={x.low} high={x.high} stars={v.values[x.id] || 0} onStars={n => setStars('values', x.id, n)} />)}
        {box('values', 'Comment on my values', 'Examples of how you showed the values')}
      </section>
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={secondaryBtn} onClick={onClose}>Cancel</button>
        <button type="button" className={primaryBtn} disabled={busy} onClick={save}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{existing ? 'Save changes' : 'Send self review'}</button>
      </div>
    </SidePanel>
  );
}

// ---------- Released result (also shown to Management in the appraisal round) ----------
export function ResultPanel({ result: r, onClose }: { result: AppraisalResult; onClose: () => void }) {
  const section = (title: string, score: React.ReactNode, body: React.ReactNode) => (
    <section className="space-y-3 rounded-2xl border border-line bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-lg font-bold">{title}</h4>{score}</div>
      {body}
    </section>
  );
  const pct = (n: number | null) => (n === null ? <span className="text-sm text-ink-soft">Nothing to score</span> : <span className={`rounded-full px-2.5 py-0.5 text-sm font-semibold ${LIGHT_BADGE[kpiLight(n)]}`}>{n}%</span>);
  return (
    <SidePanel title={`${r.name}: ${quarterText(r.quarter)} appraisal`} note={LEVEL_LABELS[r.level as Level] || r.level} onClose={onClose}>
      <section className="rounded-2xl border border-line bg-white p-5">
        <div className="flex items-center gap-3">
          <Gauge className={`h-8 w-8 ${r.overall === null ? 'text-ink-soft' : LIGHT_TEXT[kpiLight(r.overall)]}`} />
          <div><p className="text-3xl font-bold tabular-nums">{r.overall === null ? '–' : `${r.overall}%`}</p><p className="text-sm text-ink-soft">Overall score</p></div>
        </div>
        <ul className="mt-4 grid gap-2 sm:grid-cols-3">
          {PARTS.map(p => (
            <li key={p} className="flex items-center justify-between gap-2 rounded-xl bg-surface px-3.5 py-2.5 text-[15px] font-semibold">
              <span>{PART_LABELS[p]} <span className="block text-sm font-normal text-ink-soft">Weight {r.weights[p] ?? 0}%</span></span>{pct(r.parts[p])}
            </li>
          ))}
        </ul>
      </section>
      {section('Performance: KPI', pct(r.kpi), <CommentList list={r.comments.kpi} empty="No comments." />)}
      {section('Performance: reliability', <strong className="tabular-nums">{r.reliability === null ? '–' : `${r.reliability.toFixed(1)} / 5`}</strong>, <CommentList list={r.comments.reliability} empty="No comments." />)}
      {section('Competency: skills', pct(r.parts.competency), <><ScoreTable rows={r.skills} /><CommentList list={r.comments.skills} /></>)}
      {section('Behavioural: HEART values', pct(r.parts.behavioural), <><ScoreTable peers rows={r.values} /><CommentList list={r.comments.values} /></>)}
      {r.comments.overall.length > 0 && section("Manager's overall comment", null, <CommentList list={r.comments.overall} />)}
    </SidePanel>
  );
}
