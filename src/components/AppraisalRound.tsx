import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, query, where, writeBatch } from 'firebase/firestore';
import { Eye, Loader2, Lock, Play, Send, Unlock, Users } from 'lucide-react';
import { monthsBetween, PersonScorecardData, ScorecardSources, usePersonScorecard } from './Appraisal';
import { useAllRatings, useRatingRounds } from './Rating360';
import { SidePanel } from './Scorecard';
import { useCycleSelfReviews, useCycles } from './AppraisalParts';
import { ResultPanel } from './MyAppraisal';
import DraftBar from './DraftBar';
import { db, friendlyError } from '../lib/firebase';
import { formatDate, todayIso } from '../lib/deals';
import { useFormDraft } from '../lib/useFormDraft';
import { kpiLight, LIGHT_BADGE } from '../lib/kpi';
import { RatingPair, roundPairs } from '../lib/rating360';
import { prevQuarter, quarterMonths, quarterOf, quarterText, readReview, Review } from '../lib/scorecard';
import { AppraisalCycle, AppraisalResult, readResult, resultId } from '../lib/appraisalCycle';

// Appraisal round (Joel, 2026-10-25), Management → KPI & appraisal → Appraisal round. Data: lib/appraisalCycle.ts.
// - Commence appraisal: pick the quarter, the deadline and who is in it. Everyone in it then sees My appraisal on
//   My home: their self review and the teammates to rate (a 360 round, everyone rates everyone, made with it).
// - Follow who has done their self review, their 360 ratings and has a manager review; change the deadline.
// - Close: no more self reviews or ratings (the 360 round closes too, so its ratings count on the scorecards).
//   Reopen if needed.
// - Who rates whom (Joel, 2026-10-26): everyone rates everyone, or Management ticks each reviewer → person pair
//   (the round's mode 'picked'). Can be changed while the round is open; ratings already given are kept.
// - Release results: shows everyone's scores first, then copies each person's scorecard to appraisal_results, and
//   only then can each person see theirs. Releasing again updates the copies.

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };
type Person = { id: string; name: string; role: string };

const input = 'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const label = 'mb-1 block text-sm font-semibold text-ink';
const primaryBtn = 'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-[15px] font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const secondaryBtn = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-50';
type Who = { mode: 'all' | 'picked'; pairs: RatingPair[] };
const allPairs = (ids: string[]): RatingPair[] => ids.flatMap(raterId => ids.filter(id => id !== raterId).map(rateeId => ({ raterId, rateeId })));
// Only pairs between people in the round, never yourself.
const keepPairs = (pairs: RatingPair[], ids: string[]) => pairs.filter(p => p.raterId !== p.rateeId && ids.includes(p.raterId) && ids.includes(p.rateeId));
const STATUS_TEXT: Record<AppraisalCycle['status'], [string, string]> = {
  open: ['Open', 'bg-attention-soft text-attention'], closed: ['Closed, not released', 'bg-surface text-ink'], released: ['Released', 'bg-accent-soft text-accent'],
};

function useQuarterReviews(quarter: string): Review[] {
  const [list, setList] = useState<Review[]>([]);
  useEffect(() => onSnapshot(query(collection(db, 'scorecard_reviews'), where('quarter', '==', quarter)),
    s => setList(s.docs.map(d => readReview(d.id, d.data()))), () => setList([])), [quarter]);
  return list;
}
function useCycleResults(cycleId: string): AppraisalResult[] {
  const [list, setList] = useState<AppraisalResult[]>([]);
  useEffect(() => onSnapshot(query(collection(db, 'appraisal_results'), where('cycleId', '==', cycleId)),
    s => setList(s.docs.map(d => readResult(d.id, d.data()))), () => setList([])), [cycleId]);
  return list;
}

export default function AppraisalRound({ viewer, src }: { viewer: Viewer; src: ScorecardSources }) {
  const cycles = useCycles();
  const [starting, setStarting] = useState(false);
  const open = cycles.find(c => c.status === 'open');
  return (
    <div className="space-y-4 font-sans text-ink">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-[15px] text-ink-soft">
          Commence an appraisal to let everyone write their self review and rate their teammates by the deadline. Nobody sees any rating until you release the results.
        </p>
        <button type="button" className={primaryBtn} disabled={!!open} onClick={() => setStarting(true)} title={open ? 'Close the open round first' : undefined}>
          <Play className="h-4 w-4" /> Commence appraisal
        </button>
      </div>
      {open && <p className="text-sm text-ink-soft">{open.name} is open. Close it before commencing the next one.</p>}
      {starting && <CommenceForm viewer={viewer} people={src.people} onDone={() => setStarting(false)} />}
      {cycles.length === 0 && !starting && <p className="rounded-2xl border border-line bg-white p-6 text-center text-ink-soft">No appraisal rounds yet.</p>}
      {cycles.map(c => <CycleCard key={c.id} viewer={viewer} cycle={c} src={src} />)}
    </div>
  );
}

function CommenceForm({ viewer, people, onDone }: { viewer: Viewer; people: Person[]; onDone: () => void }) {
  const now = quarterOf(todayIso().slice(0, 7));
  const choices = [prevQuarter(now), now];
  const [f, setF] = useState(() => ({ quarter: now, dueDate: '', people: people.map(p => p.id), mode: 'all' as Who['mode'], pairs: [] as RatingPair[] }));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const draft = useFormDraft(viewer.id, 'appraisal-round:new', f, v => setF({ mode: 'all', pairs: [], ...v }));
  const pairs = keepPairs(f.pairs, f.people);
  const set = (c: Partial<typeof f>) => { setF(x => ({ ...x, ...c })); setError(''); };
  const save = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.dueDate)) return setError('Choose the deadline.');
    if (f.dueDate < todayIso()) return setError('The deadline has passed. Choose a later date.');
    if (f.people.length < 2) return setError('Tick at least two people.');
    if (f.mode === 'picked' && pairs.length === 0) return setError('Tick at least one reviewer and person to review.');
    setBusy(true);
    try {
      const stamp = Date.now().toString(36);
      const cycleId = `ap_${stamp}`, roundId = `r360_${stamp}`;
      const name = `Appraisal ${quarterText(f.quarter)}`;
      const at = new Date().toISOString();
      const b = writeBatch(db);
      // The 360 round: everyone in it rates everyone else, or only the pairs picked; it counts in the quarter's last month.
      b.set(doc(db, 'rating_rounds', roundId), {
        name, month: quarterMonths(f.quarter)[1], mode: f.mode, view: 'open', dueDate: f.dueDate, people: f.people, pairs: f.mode === 'picked' ? pairs : [],
        status: 'open', cycleId, createdAt: at, createdById: viewer.id, createdByName: viewer.name,
      });
      b.set(doc(db, 'appraisal_cycles', cycleId), {
        name, quarter: f.quarter, dueDate: f.dueDate, people: f.people, roundId, status: 'open',
        createdAt: at, createdById: viewer.id, createdByName: viewer.name,
      });
      await b.commit();
      draft.clear();
      onDone();
    } catch (e) { setError(friendlyError(e)); setBusy(false); }
  };
  return (
    <section className="space-y-4 rounded-2xl border border-line bg-white p-5">
      <DraftBar draft={draft} what="new appraisal round" />
      <h3 className="text-lg font-bold">Commence appraisal</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="ar-q" className={label}>Quarter</label>
          <select id="ar-q" className={input} value={f.quarter} onChange={e => set({ quarter: e.target.value })}>
            {choices.map(q => <option key={q} value={q}>{quarterText(q)}</option>)}
          </select>
        </div>
        <div><label htmlFor="ar-due" className={label}>Deadline</label><input id="ar-due" type="date" min={todayIso()} className={input} value={f.dueDate} onChange={e => set({ dueDate: e.target.value })} /></div>
      </div>
      <div>
        <span className={label}>Who is in this round (each person reviews themselves)</span>
        <div className="flex flex-wrap gap-2">
          {people.map(p => {
            const on = f.people.includes(p.id);
            return <button key={p.id} type="button" aria-pressed={on} onClick={() => set({ people: on ? f.people.filter(x => x !== p.id) : [...f.people, p.id] })}
              className={`rounded-full border px-3 py-1 text-sm font-medium ${on ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-soft hover:bg-surface'}`}>{p.name}</button>;
          })}
        </div>
      </div>
      <WhoRatesWhom people={people.filter(p => f.people.includes(p.id))} value={{ mode: f.mode, pairs }} onChange={w => set(w)} />
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={secondaryBtn} onClick={onDone}>Cancel</button>
        <button type="button" className={primaryBtn} disabled={busy} onClick={save}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Commence</button>
      </div>
    </section>
  );
}

function CycleCard({ viewer, cycle: c, src }: { viewer: Viewer; cycle: AppraisalCycle; src: ScorecardSources; key?: string }) {
  const selfs = useCycleSelfReviews(c.id);
  const reviews = useQuarterReviews(c.quarter);
  const round = useRatingRounds().find(r => r.id === c.roundId);
  const ratings = useAllRatings().filter(x => x.roundId === c.roundId);
  const results = useCycleResults(c.id);
  const [due, setDue] = useState(c.dueDate);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [viewing, setViewing] = useState<AppraisalResult | null>(null);
  const [who, setWho] = useState<Who | null>(null);
  const pairs = round ? roundPairs(round) : [];
  const nameOf = (id: string) => src.people.find(p => p.id === id)?.name || 'Former team member';
  const late = c.status === 'open' && c.dueDate && c.dueDate < todayIso();
  // Change the cycle and its 360 round together.
  const update = async (cycle: Record<string, any>, roundChange: Record<string, any> = cycle) => {
    setBusy(true); setError('');
    try {
      const b = writeBatch(db);
      b.set(doc(db, 'appraisal_cycles', c.id), cycle, { merge: true });
      if (c.roundId) b.set(doc(db, 'rating_rounds', c.roundId), roundChange, { merge: true });
      await b.commit();
    } catch (e) { setError(friendlyError(e)); }
    setBusy(false);
  };
  const at = () => new Date().toISOString();
  return (
    <section className="space-y-4 rounded-2xl border border-line bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-lg font-bold">{c.name} <span className={`ml-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_TEXT[c.status][1]}`}>{STATUS_TEXT[c.status][0]}</span></p>
          <p className={`text-sm ${late ? 'text-danger' : 'text-ink-soft'}`}>
            Deadline {c.dueDate ? formatDate(c.dueDate) : 'not set'}{late ? ' (passed)' : ''} · commenced by {c.createdByName || 'Management'}
            {c.releasedAt ? ` · released by ${c.releasedByName || 'Management'}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {c.status === 'open' && <button type="button" className={secondaryBtn} disabled={busy} onClick={() => update({ status: 'closed', closedAt: at(), closedByName: viewer.name }, { status: 'closed', closedAt: at(), closedByName: viewer.name })}><Lock className="h-4 w-4" /> Close round</button>}
          {c.status === 'closed' && <button type="button" className={secondaryBtn} disabled={busy} onClick={() => update({ status: 'open' }, { status: 'open' })}><Unlock className="h-4 w-4" /> Reopen</button>}
          {c.status !== 'open' && <button type="button" className={primaryBtn} disabled={busy} onClick={() => setReleasing(true)}><Send className="h-4 w-4" /> {c.status === 'released' ? 'Release again (update)' : 'Release results'}</button>}
        </div>
      </div>
      {c.status === 'open' && (
        <div className="flex flex-wrap items-end gap-2">
          <div><label htmlFor={`due-${c.id}`} className={label}>Change the deadline</label><input id={`due-${c.id}`} type="date" className={`${input} w-auto`} value={due} onChange={e => setDue(e.target.value)} /></div>
          <button type="button" className={secondaryBtn} disabled={busy || !due || due === c.dueDate} onClick={() => update({ dueDate: due })}>Save deadline</button>
          {round && !who && <button type="button" className={secondaryBtn} onClick={() => setWho({ mode: round.mode, pairs })}><Users className="h-4 w-4" /> Change who rates whom</button>}
        </div>
      )}
      {c.status === 'open' && round && who && (() => {
        const kept = keepPairs(who.pairs, c.people);
        const givenGone = who.mode === 'picked' ? ratings.filter(x => !kept.some(p => p.raterId === x.raterId && p.rateeId === x.rateeId)).length : 0;
        const save = async () => {
          if (who.mode === 'picked' && kept.length === 0) return setError('Tick at least one reviewer and person to review.');
          setBusy(true); setError('');
          try {
            await writeBatch(db).set(doc(db, 'rating_rounds', round.id), { mode: who.mode, pairs: who.mode === 'picked' ? kept : [] }, { merge: true }).commit();
            setWho(null);
          } catch (e) { setError(friendlyError(e)); }
          setBusy(false);
        };
        return (
          <div className="space-y-3 rounded-xl border border-line bg-surface/50 p-4">
            <WhoRatesWhom people={c.people.map(id => ({ id, name: nameOf(id), role: '' }))} value={{ mode: who.mode, pairs: kept }} onChange={setWho} />
            {givenGone > 0 && <p className="text-sm text-attention">{givenGone} rating{givenGone === 1 ? ' was' : 's were'} already given for a pair you untick. {givenGone === 1 ? 'It is' : 'They are'} kept and still count.</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className={secondaryBtn} onClick={() => { setWho(null); setError(''); }}>Cancel</button>
              <button type="button" className={primaryBtn} disabled={busy} onClick={save}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save who rates whom</button>
            </div>
          </div>
        );
      })()}
      {c.status === 'closed' && <p className="text-sm text-ink-soft">Finish the manager reviews in Scorecards (pick the person and {quarterText(c.quarter)}), then release the results.</p>}
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-[15px]">
          <thead>
            <tr className="text-left text-sm text-ink-soft">
              <th className="py-1 pr-2 font-semibold">Person</th>
              <th className="px-2 py-1 font-semibold">Self review</th>
              <th className="px-2 py-1 font-semibold">Teammates rated</th>
              <th className="px-2 py-1 font-semibold">Manager review</th>
              {c.status === 'released' && <th className="py-1 pl-2 font-semibold">Result</th>}
            </tr>
          </thead>
          <tbody>
            {c.people.map(id => {
              const s = selfs.find(x => x.memberId === id);
              const owed = pairs.filter(p => p.raterId === id).length;
              const given = ratings.filter(x => x.raterId === id).length;
              const rv = reviews.find(r => r.memberId === id);
              const res = results.find(r => r.memberId === id);
              return (
                <tr key={id} className="border-t border-line">
                  <td className="py-2 pr-2 font-semibold">{nameOf(id)}</td>
                  <td className="px-2 py-2">{s ? <span className="text-accent">Done</span> : <span className="text-attention">Not yet</span>}</td>
                  <td className="px-2 py-2 tabular-nums">{given} of {owed}</td>
                  <td className="px-2 py-2">{rv ? <span className="text-accent">Done ({rv.byName || 'Management'})</span> : <span className="text-attention">Not yet</span>}</td>
                  {c.status === 'released' && (
                    <td className="py-2 pl-2">{res ? <button type="button" className="inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline" onClick={() => setViewing(res)}><Eye className="h-4 w-4" /> {res.overall === null ? '–' : `${res.overall}%`}</button> : '–'}</td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {releasing && <ReleasePanel viewer={viewer} cycle={c} src={src} onClose={() => setReleasing(false)} />}
      {viewing && <ResultPanel result={viewing} onClose={() => setViewing(null)} />}
    </section>
  );
}

// ---------- Who rates whom ----------
// Everyone rates everyone, or a tick box for each reviewer (row) → person reviewed (column).
function WhoRatesWhom({ people, value, onChange }: { people: Person[]; value: Who; onChange: (w: Who) => void }) {
  const ids = people.map(p => p.id);
  const has = (raterId: string, rateeId: string) => value.pairs.some(p => p.raterId === raterId && p.rateeId === rateeId);
  const toggle = (raterId: string, rateeId: string) => onChange({ mode: 'picked', pairs: has(raterId, rateeId)
    ? value.pairs.filter(p => !(p.raterId === raterId && p.rateeId === rateeId)) : [...value.pairs, { raterId, rateeId }] });
  // Switching to "I pick" starts with everyone ticked, so you only untick.
  const choice = (mode: Who['mode'], text: string) => (
    <button type="button" aria-pressed={value.mode === mode}
      onClick={() => onChange({ mode, pairs: mode === 'picked' && value.mode !== 'picked' ? allPairs(ids) : value.pairs })}
      className={`rounded-full border px-3 py-1 text-sm font-medium ${value.mode === mode ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-soft hover:bg-surface'}`}>{text}</button>
  );
  return (
    <div className="space-y-2">
      <span className={label}>Who rates whom</span>
      <div className="flex flex-wrap gap-2">{choice('all', 'Everyone rates everyone')}{choice('picked', 'I pick who rates whom')}</div>
      {value.mode === 'picked' && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm text-ink-soft">
            <span>Each row is the reviewer: tick the people they rate. {value.pairs.length} pair{value.pairs.length === 1 ? '' : 's'} ticked.</span>
            <button type="button" className="font-semibold text-accent hover:underline" onClick={() => onChange({ mode: 'picked', pairs: allPairs(ids) })}>Tick all</button>
            <button type="button" className="font-semibold text-accent hover:underline" onClick={() => onChange({ mode: 'picked', pairs: [] })}>Clear all</button>
          </div>
          {people.length < 2 ? <p className="text-sm text-ink-soft">Tick at least two people in the round first.</p> : (
            <div className="overflow-x-auto rounded-xl border border-line bg-white">
              <table className="text-sm">
                <thead>
                  <tr className="text-left text-ink-soft">
                    <th className="sticky left-0 bg-white px-3 py-2 font-semibold">Reviewer ↓ rates →</th>
                    {people.map(p => <th key={p.id} className="whitespace-nowrap px-2 py-2 text-center font-semibold">{p.name}</th>)}
                    <th className="px-3 py-2 text-center font-semibold">Rates</th>
                  </tr>
                </thead>
                <tbody>
                  {people.map(r => (
                    <tr key={r.id} className="border-t border-line">
                      <td className="sticky left-0 whitespace-nowrap bg-white px-3 py-2 font-semibold">{r.name}</td>
                      {people.map(p => (
                        <td key={p.id} className="px-2 py-2 text-center">
                          {r.id === p.id ? <span className="text-ink-soft">–</span>
                            : <input type="checkbox" className="h-4 w-4 accent-[#0E6E62]" aria-label={`${r.name} rates ${p.name}`} checked={has(r.id, p.id)} onChange={() => toggle(r.id, p.id)} />}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-center tabular-nums text-ink-soft">{value.pairs.filter(x => x.raterId === r.id).length}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-line text-ink-soft">
                    <td className="sticky left-0 bg-white px-3 py-2">Rated by</td>
                    {people.map(p => <td key={p.id} className="px-2 py-2 text-center tabular-nums">{value.pairs.filter(x => x.rateeId === p.id).length}</td>)}
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------- Release ----------
type Snapshot = Record<string, any>;
function snapshotOf(c: AppraisalCycle, person: Person, sc: PersonScorecardData): Snapshot {
  const has = (r: { self: number | null; manager: number | null; peers?: number | null }) => r.self !== null || r.manager !== null || (r.peers ?? null) !== null;
  // JSON drops anything undefined, which the database refuses.
  return JSON.parse(JSON.stringify({
    cycleId: c.id, memberId: person.id, name: person.name, quarter: c.quarter, level: sc.level, weights: sc.weights,
    overall: sc.overall.score, parts: sc.parts, kpi: sc.kpi.avg, reliability: sc.rel.r.score,
    skills: sc.skillRows.filter(has), values: sc.valueRows.filter(has), comments: sc.comments,
  }));
}

function ReleasePanel({ viewer, cycle: c, src, onClose }: { viewer: Viewer; cycle: AppraisalCycle; src: ScorecardSources; onClose: () => void }) {
  const [snaps, setSnaps] = useState<Record<string, Snapshot>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const people = c.people.map(id => src.people.find(p => p.id === id) || { id, name: 'Former team member', role: 'rep' });
  const months = useMemo(() => monthsBetween(...quarterMonths(c.quarter)), [c.quarter]);
  // Ratings and reviews arrive a moment after the Login log; wait until nothing has changed for 2 seconds.
  const [settled, setSettled] = useState(false);
  const snapsJson = JSON.stringify(snaps);
  useEffect(() => { setSettled(false); const t = window.setTimeout(() => setSettled(true), 2000); return () => window.clearTimeout(t); }, [snapsJson]);
  const ready = settled && people.every(p => snaps[p.id]);
  const release = async () => {
    setBusy(true); setError('');
    try {
      const at = new Date().toISOString();
      const b = writeBatch(db);
      people.forEach(p => b.set(doc(db, 'appraisal_results', resultId(c.id, p.id)), { ...snaps[p.id], released: true, releasedAt: at, releasedById: viewer.id, releasedByName: viewer.name }));
      b.set(doc(db, 'appraisal_cycles', c.id), { status: 'released', releasedAt: at, releasedById: viewer.id, releasedByName: viewer.name }, { merge: true });
      await b.commit();
      onClose();
    } catch (e) { setError(friendlyError(e)); setBusy(false); }
  };
  return (
    <SidePanel title={`Release ${c.name}`} note="Check the scores. Once released, each person sees their own scorecard and every comment on it." onClose={onClose}>
      <ul className="space-y-2">
        {people.map(p => (
          <ResultMaker key={p.id} cycle={c} person={p} months={months} src={src}
            onReady={s => setSnaps(x => (JSON.stringify(x[p.id]) === JSON.stringify(s) ? x : { ...x, [p.id]: s }))} />
        ))}
      </ul>
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={secondaryBtn} onClick={onClose}>Cancel</button>
        <button type="button" className={primaryBtn} disabled={busy || !ready} onClick={release}>{(busy || !ready) && <Loader2 className="h-4 w-4 animate-spin" />}Release to everyone</button>
      </div>
    </SidePanel>
  );
}

// Works out one person's scorecard for the quarter and hands it up once the Login log has loaded.
function ResultMaker({ cycle, person, months, src, onReady }: { cycle: AppraisalCycle; person: Person; months: string[]; src: ScorecardSources; onReady: (s: Snapshot) => void; key?: string }) {
  const sc = usePersonScorecard(person, months, src);
  const snap = sc.ready ? snapshotOf(cycle, person, sc) : null;
  const json = snap ? JSON.stringify(snap) : '';
  useEffect(() => { if (snap) onReady(snap); }, [json]);
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white px-4 py-3">
      <span className="font-semibold">{person.name}</span>
      {!snap ? <span className="flex items-center gap-1.5 text-sm text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Working out…</span> : (
        <span className="flex flex-wrap items-center gap-2 text-sm">
          {(['performance', 'competency', 'behavioural'] as const).map(k => (
            <span key={k} className="text-ink-soft">{k[0].toUpperCase() + k.slice(1)} {sc.parts[k] === null ? '–' : `${sc.parts[k]}%`}</span>
          ))}
          <span className={`rounded-full px-2.5 py-0.5 font-semibold ${sc.overall.score === null ? 'bg-surface text-ink-soft' : LIGHT_BADGE[kpiLight(sc.overall.score)]}`}>{sc.overall.score === null ? 'No score' : `${sc.overall.score}%`}</span>
        </span>
      )}
    </li>
  );
}
