import React, { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import { Award, CalendarCheck, ClipboardList, Gauge, GraduationCap, Loader2, Plus, Smile, Target, Trash2, X } from 'lucide-react';
import DaysOut, { useExcusedDays } from './DaysOut';
import { useAllRatings, useRatingItems, useRatingRounds } from './Rating360';
import { ReviewPanel, useReviews } from './Scorecard';
import { CardComments, collectComments, ScoreTable, useSelfReviews } from './AppraisalParts';
import { db, friendlyError } from '../lib/firebase';
import { formatDate, formatRM, todayIso } from '../lib/deals';
import { hasKpis, kpiBarClass, kpiLight, kpiValueText, LIGHT_BADGE, LIGHT_TEXT, monthKpi, RepLike, setItemsFor } from '../lib/kpi';
import { appraisalSetItems, LIGHT_LABELS } from '../lib/kpiLibrary';
import { useKpiSources } from '../lib/useKpiSources';
import { useLoginData } from '../lib/loginActivity';
import { activeItems, RatingItem, summarise } from '../lib/rating360';
import { ResultRow } from '../lib/appraisalCycle';
import {
  DEFAULT_RELIABILITY, EXCUSE_LABELS, Incident, INCIDENT_LABELS, IncidentKind, readIncident, readReliabilitySettings, reliabilityFor,
  ReliabilitySettings, settingsProblem,
} from '../lib/reliability';
import {
  behaviouralScore, competencyScore, Level, LEVEL_LABELS, levelFor, overallScore, Part, PART_LABELS, PART_QUESTIONS, PARTS, perItemAvg,
  performanceScore, PHOTO_VALUES, quarterMonths, quartersIn, quarterText, reviewSkillAvg, reviewValuesAvg, ScorecardSettings, skillsFor, Weights,
  withMeetingPhotos,
} from '../lib/scorecard';
import { photoShare } from '../lib/meetingPhotos';
import { useMeetingPhotos } from './MeetingPhotos';
import { useAutoSave } from '../lib/useAutoSave';
import { useFormDraft } from '../lib/useFormDraft';
import DraftBar from './DraftBar';

// Appraisal (Joel, 2026-10-22), Management → KPI & appraisal → Scorecards, Management only. One person and a month
// (or a range of months, with quick picks for quarters and half years). Since 2026-10-25 it is the performance
// scorecard (lib/scorecard.ts): three parts that add up to one overall score, weighted by the person's level:
// - Performance: the KPI score (results; lib/kpi.ts monthKpi without the 360 rating KPI, lib/kpiLibrary.ts
//   appraisalSetItems; a range averages the months) mixed with reliability (process; from the Login log, with days
//   out of office left out and incidents taken off, lib/reliability.ts). Incidents are kept here.
// - Competency: the manager's quarterly review of skills (scorecard_reviews); the quarters touching the period averaged.
// - Behavioural: the HEART values; teammates' closed 360 rounds of those months mixed with the manager's review.
// - Since the appraisal round (lib/appraisalCycle.ts): the person's self review is shown next to the manager's and
//   teammates' stars (never counted), and every card lists everyone's comments on that section.
// - Management notes per person per period: appraisal_notes/{memberId}_{from}_{to}, saving themselves.
// The settings (weights, levels, skills, HEART values, reliability score) are in KPI & appraisal → Settings.

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };
type Person = { id: string; name: string; role: string };

const input = 'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const label = 'mb-1 block text-sm font-semibold text-ink';
const card = 'rounded-2xl border border-line bg-white p-5';
const primaryBtn = 'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-[15px] font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const secondaryBtn = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-50';

const CODES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
// '2026-10' → 'OCT-26' (the KPI screens' month code)
const kpiCode = (ym: string) => `${CODES[Number(ym.slice(5, 7)) - 1]}-${ym.slice(2, 4)}`;
const monthText = (ym: string) => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const lastDay = (ym: string) => {
  const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0);
  return `${ym}-${String(d.getDate()).padStart(2, '0')}`;
};
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7));
  while (out.length < 12) {
    const ym = `${y}-${String(m).padStart(2, '0')}`;
    if (ym > to) break;
    out.push(ym);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}
const one = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

export type ScorecardSources = {
  people: Person[];                                        // active team members
  settings: ScorecardSettings;
  settingsOf: (memberId: string) => RepLike;               // KPI set, template and targets (reps/{id})
  kpiOf: (memberId: string, month: string) => any;         // typed weekly numbers for 'OCT-26'
  deals: any[];
};

export default function Appraisal({ viewer, people, settings, settingsOf, kpiOf, deals }: { viewer: Viewer } & ScorecardSources) {
  const thisMonth = todayIso().slice(0, 7);
  const [who, setWho] = useState(people[0]?.id || '');
  const [from, setFrom] = useState(thisMonth);
  const [to, setTo] = useState(thisMonth);
  const person = people.find(p => p.id === who);
  const months = useMemo(() => monthsBetween(from, to < from ? from : to), [from, to]);
  const period = { from: months[0], to: months[months.length - 1] };
  const periodText = months.length > 1 ? `${monthText(period.from)} to ${monthText(period.to)}` : monthText(period.from);
  // Quick picks: the quarters and half years of this year and last year.
  const year = Number(thisMonth.slice(0, 4));
  const picks: [string, string, string][] = [year, year - 1].flatMap(y => [
    ...[1, 2, 3, 4].map(n => [quarterText(`${y}-Q${n}`), ...quarterMonths(`${y}-Q${n}`)] as [string, string, string]),
    [`First half ${y}`, `${y}-01`, `${y}-06`] as [string, string, string],
    [`Second half ${y}`, `${y}-07`, `${y}-12`] as [string, string, string],
  ]);

  return (
    <div className="space-y-5 font-sans text-ink">
      <p className="text-[15px] text-ink-soft">Performance, competency and behavioural add up to one overall score, weighted by each person's level.</p>
      <section className={`${card} grid gap-3 sm:grid-cols-2 lg:grid-cols-4`}>
        <div>
          <label htmlFor="ap-who" className={label}>Person</label>
          <select id="ap-who" className={input} value={who} onChange={e => setWho(e.target.value)}>
            {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div><label htmlFor="ap-from" className={label}>From month</label><input id="ap-from" type="month" className={input} value={from} onChange={e => { setFrom(e.target.value || thisMonth); if (to < e.target.value) setTo(e.target.value); }} /></div>
        <div><label htmlFor="ap-to" className={label}>To month (up to 12)</label><input id="ap-to" type="month" className={input} value={to} min={from} onChange={e => setTo(e.target.value || from)} /></div>
        <div>
          <label htmlFor="ap-pick" className={label}>Quarter or half year</label>
          <select id="ap-pick" className={input} value={picks.find(([, f, t]) => f === from && t === to)?.[0] || ''}
            onChange={e => { const x = picks.find(([n]) => n === e.target.value); if (x) { setFrom(x[1]); setTo(x[2]); } }}>
            <option value="">Choose…</option>
            {picks.map(([n]) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </section>
      {!person ? (
        <p className={`${card} text-center text-ink-soft`}>Choose a person.</p>
      ) : (
        <>
          <PersonScorecard key={person.id} viewer={viewer} person={person} months={months} periodText={periodText}
            src={{ people, settings, settingsOf, kpiOf, deals }} />
          <NotesCard key={`${person.id}_${period.from}_${period.to}`} viewer={viewer} memberId={person.id} from={period.from} to={period.to} />
        </>
      )}
    </div>
  );
}

// Everything on one person's scorecard for a period: each part, the overall score, the star rows and the comments.
// Also used to make the released copy (AppraisalRound.tsx).
export function usePersonScorecard(person: Person, months: string[], src: ScorecardSources) {
  const { people, settings, settingsOf, kpiOf, deals } = src;
  const from = `${months[0]}-01`, to = lastDay(months[months.length - 1]);
  const level = levelFor(settings, person.id, person.role);
  const weights = settings.weights[level];
  const quarters = quartersIn(months);
  const kpi = useKpiPart(person, months, people, settingsOf, kpiOf, deals);
  const rel = useReliabilityPart(person.id, from, to);
  const ratingItems = useRatingItems();
  const peers = usePeerPart(person.id, months);
  const allReviews = useReviews(person.id);
  const reviews = allReviews.filter(r => quarters.includes(r.quarter)).sort((a, b) => a.quarter.localeCompare(b.quarter));
  const selfs = useSelfReviews(person.id).filter(s => quarters.includes(s.quarter));
  const skills = skillsFor(settings, level);
  const meetingPhotos = useMeetingPhotos();
  const photos = photoShare(deals, meetingPhotos, person.id, from, to);

  // Every value rated in the review counts, as with the 360 ratings (older reviews keep items now turned off).
  const managerValues = reviews.map(r => reviewValuesAvg(r, Object.keys(r.values))).filter((x): x is number => x !== null);
  const managerAvg = managerValues.length ? managerValues.reduce((a, b) => a + b, 0) / managerValues.length : null;
  const ratedBehaviour = behaviouralScore(peers.sum.overall?.avg ?? null, managerAvg, settings.peerShare);
  const mValues = perItemAvg(reviews.map(r => r.values));
  // Meeting photos (2026-10-26) count for part of Accountability and Trustworthiness (lib/scorecard.ts withMeetingPhotos).
  const ratedValues = activeItems(ratingItems).map(i => i.id);
  const itemStars = Object.fromEntries(ratedValues.filter(id => PHOTO_VALUES.includes(id)).map(id => {
    const m = mValues[id]?.avg ?? null, pr = peers.sum.items[id]?.avg ?? null;
    return [id, m === null ? pr : pr === null ? m : (m * (100 - settings.peerShare) + pr * settings.peerShare) / 100];
  }));
  const behaviour = withMeetingPhotos(ratedBehaviour, itemStars, ratedValues.length, photos.pct, settings.photoShare);
  const parts: Record<Part, number | null> = {
    performance: performanceScore(kpi.avg, rel.r.score, settings.reliabilityShare),
    competency: competencyScore(reviews.map(r => reviewSkillAvg(r, skills))),
    behavioural: behaviour.score,
  };
  const overall = overallScore(parts, weights);

  const nameOf = (id: string) => people.find(p => p.id === id)?.name || 'Former team member';
  const skillName = (id: string) => settings.skills.find(k => k.id === id)?.name || 'Skill no longer used';
  const valueName = (id: string) => ratingItems.find(i => i.id === id)?.name || 'Item no longer used';
  const mSkills = perItemAvg(reviews.map(r => r.skills), (id, i) => reviews[i].na.includes(id));
  const sSkills = perItemAvg(selfs.map(s => s.skills), (id, i) => selfs[i].na.includes(id));
  const sValues = perItemAvg(selfs.map(s => s.values));
  const ids = (base: string[], ...maps: Record<string, unknown>[]) => Array.from(new Set([...base, ...maps.flatMap(m => Object.keys(m))]));
  const skillRows: ResultRow[] = ids(skills.map(k => k.id), mSkills, sSkills).map(id => ({
    id, name: skillName(id), group: settings.skills.find(k => k.id === id)?.group, self: sSkills[id]?.avg ?? null, manager: mSkills[id]?.avg ?? null,
  }));
  const valueRows: ResultRow[] = ids(activeItems(ratingItems).map(i => i.id), mValues, sValues, peers.sum.items).map(id => ({
    id, name: valueName(id), self: sValues[id]?.avg ?? null, peers: peers.sum.items[id]?.avg ?? null, manager: mValues[id]?.avg ?? null,
  }));
  const comments = collectComments({
    personName: person.name, selfs, reviews, ratings: peers.mine, raterName: x => x.raterName || nameOf(x.raterId), skillName, valueName,
  });
  return {
    from, to, level, weights, quarters, kpi, rel, ratingItems, peers, allReviews, reviews, selfs, managerAvg, behaviour, parts, overall,
    skillRows, valueRows, comments, photos, ready: !rel.loading,
  };
}
export type PersonScorecardData = ReturnType<typeof usePersonScorecard>;

// One person's scorecard for the period: works out each part, then the overall score on top.
function PersonScorecard({ viewer, person, months, periodText, src }: {
  viewer: Viewer; person: Person; months: string[]; periodText: string; src: ScorecardSources; key?: string;
}) {
  const sc = usePersonScorecard(person, months, src);
  const [reviewing, setReviewing] = useState(false);
  const canReview = person.id !== viewer.id;
  const review = () => setReviewing(true);
  return (
    <>
      <OverallCard name={person.name} periodText={periodText} level={sc.level} weights={sc.weights} parts={sc.parts} overall={sc.overall} />
      {sc.selfs.length === 0 && <p className="rounded-xl bg-surface px-4 py-2.5 text-sm text-ink-soft">No self review from {person.name} for {sc.quarters.map(quarterText).join(', ')}.</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        <KpiCard person={person} kpi={sc.kpi} comments={sc.comments.kpi} />
        <ReliabilityCard viewer={viewer} person={person} people={src.people} from={sc.from} rel={sc.rel} comments={sc.comments.reliability} />
        <CompetencyCard person={person} sc={sc} canReview={canReview} onReview={review} />
        <BehaviouralCard person={person} sc={sc} peerShare={src.settings.peerShare} photoShare={src.settings.photoShare} canReview={canReview} onReview={review} />
      </div>
      {sc.comments.overall.length > 0 && (
        <section className={card}>
          <h3 className="mb-2 text-lg font-bold">Manager's overall comment</h3>
          <CardComments list={sc.comments.overall} />
        </section>
      )}
      {reviewing && <ReviewPanel viewer={viewer} person={person} level={sc.level} quarters={sc.quarters} reviews={sc.allReviews} settings={src.settings} ratingItems={sc.ratingItems} onClose={() => setReviewing(false)} />}
    </>
  );
}

function CardHead({ icon: Icon, part, title }: { icon: React.ElementType; part: string; title: string }) {
  return (
    <div className="mb-3">
      <p className="text-sm font-semibold text-ink-soft">{part}</p>
      <h3 className="flex items-center gap-2 text-lg font-bold"><Icon className="h-5 w-5 text-accent" /> {title}</h3>
    </div>
  );
}
function Big({ value, unit, note }: { value: string; unit?: string; note?: string }) {
  return (
    <div className="mb-3 rounded-xl bg-surface px-4 py-3">
      <p className="text-3xl font-bold tabular-nums">{value}{unit && <span className="ml-1 text-base font-semibold text-ink-soft">{unit}</span>}</p>
      {note && <p className="text-sm text-ink-soft">{note}</p>}
    </div>
  );
}
function Bar({ pct }: { pct: number }) {
  return <span className="block h-2 overflow-hidden rounded-full bg-white"><span className={`block h-full rounded-full ${kpiBarClass(pct)}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></span>;
}

// ---------- Overall ----------
export function OverallCard({ name, periodText, level, weights, parts, overall }: {
  name: string; periodText: string; level: Level | string; weights: Weights; parts: Record<Part, number | null>;
  overall: { score: number | null; used: Part[]; missing: Part[]; effective: Weights };
}) {
  return (
    <section className={card}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-lg font-bold">{name}</p>
          <p className="text-[15px] text-ink-soft">{periodText} · {LEVEL_LABELS[level as Level] || level}</p>
        </div>
        <div className="flex items-center gap-3 rounded-xl bg-surface px-4 py-3">
          <Gauge className={`h-8 w-8 ${overall.score === null ? 'text-ink-soft' : LIGHT_TEXT[kpiLight(overall.score)]}`} />
          <div>
            <p className="text-3xl font-bold tabular-nums">{overall.score === null ? '–' : `${overall.score}%`}</p>
            <p className="text-sm text-ink-soft">Overall score</p>
          </div>
        </div>
      </div>
      <ul className="mt-4 grid gap-3 sm:grid-cols-3">
        {PARTS.map(p => (
          <li key={p} className="rounded-xl bg-surface px-3.5 py-2.5">
            <p className="flex items-center justify-between gap-2 text-[15px] font-semibold">
              {PART_LABELS[p]}
              {parts[p] === null
                ? <span className="text-sm font-normal text-ink-soft">Nothing yet</span>
                : <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${LIGHT_BADGE[kpiLight(parts[p] as number)]}`}>{parts[p]}%</span>}
            </p>
            <p className="mb-2 text-sm text-ink-soft">
              {PART_QUESTIONS[p]} Weight {weights[p]}%{overall.used.includes(p) && overall.effective[p] !== weights[p] ? `, counts ${overall.effective[p]}% now` : ''}.
            </p>
            <Bar pct={parts[p] ?? 0} />
          </li>
        ))}
      </ul>
      {overall.missing.length > 0 && (
        <p className="mt-3 text-sm text-attention">
          {overall.missing.map(p => PART_LABELS[p]).join(' and ')} {overall.missing.length === 1 ? 'has' : 'have'} nothing to score in this period, so the overall score uses the other parts only.
        </p>
      )}
    </section>
  );
}

// ---------- Performance: KPI (results) ----------
function useKpiPart(person: Person, period: string[], people: Person[], settingsOf: (id: string) => RepLike, kpiOf: (id: string, month: string) => any, deals: any[]) {
  // Months still to come are left out of the average (a quarter or half year picked early).
  const thisMonth = todayIso().slice(0, 7);
  const months = period.filter(m => m <= thisMonth);
  const codes = months.map(kpiCode);
  const withKpis = people.map(p => ({ ...settingsOf(p.id), id: p.id, role: p.role })).filter(r => hasKpis(r, r.role));
  const sources = useKpiSources({ months: codes, people: withKpis });
  const base = { ...settingsOf(person.id), id: person.id, role: person.role };
  const items = hasKpis(base, person.role) ? appraisalSetItems(setItemsFor(base)) : [];
  const rep: RepLike = { ...base, kpiSet: { ...(base.kpiSet || {}), items } };
  const results = useMemo(() => items.length ? codes.map(code => ({
    code,
    ...monthKpi({ ...rep, kpi: kpiOf(person.id, code) }, deals, code, { ...sources, people: withKpis.map(p => ({ ...p, kpi: kpiOf(p.id, code) })) }),
  })) : [], [person.id, codes.join(), sources, deals, JSON.stringify(items)]);
  const avg = results.length ? Math.round(results.reduce((t, r) => t + r.score, 0) / results.length) : null;
  return { items, months, results, avg };
}

function KpiCard({ person, kpi, comments }: { person: Person; kpi: ReturnType<typeof useKpiPart>; comments: PersonScorecardData['comments']['kpi'] }) {
  const { items, months, results, avg } = kpi;
  return (
    <section className={card}>
      <CardHead icon={Target} part="Performance · results" title="KPI" />
      {!items.length ? (
        <p className="text-ink-soft">No KPIs set for {person.name}. Set them in KPI & appraisal → Settings → KPIs for each person.</p>
      ) : !results.length ? (
        <p className="text-ink-soft">This period hasn't started yet.</p>
      ) : (
        <>
          <Big value={`${avg}%`} note={results.length > 1 ? `Average of ${results.length} months` : 'KPI score'} />
          {results.length > 1 ? (
            <ul className="space-y-1.5">
              {results.map((r, i) => (
                <li key={r.code} className="flex justify-between rounded-lg bg-surface px-3 py-1.5 text-[15px]"><span>{monthText(months[i])}</span><strong className="tabular-nums">{r.score}%</strong></li>
              ))}
            </ul>
          ) : (
            <ul className="space-y-1.5">
              {results[0]?.rows.map(r => (
                <li key={r.m.key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface px-3 py-1.5 text-[15px]">
                  <span>{r.m.label} <span className="text-sm text-ink-soft">({Math.round(r.m.weight * 100)}%)</span></span>
                  {r.hasData ? (
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums">{kpiValueText(r.m, r.total, formatRM)}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${LIGHT_BADGE[r.light]}`}>{r.m.scoring === 'bands' ? LIGHT_LABELS[r.light] : `${r.pct}%`}</span>
                    </span>
                  ) : <span className="text-sm text-ink-soft">Nothing to count</span>}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-sm text-ink-soft">The 360 rating is not part of this score; it counts in Behavioural.</p>
        </>
      )}
      <CardComments list={comments} />
    </section>
  );
}

// ---------- Competency (quarterly review) ----------
function CompetencyCard({ person, sc, canReview, onReview }: { person: Person; sc: PersonScorecardData; canReview: boolean; onReview: () => void }) {
  const { quarters, reviews, parts, skillRows, comments } = sc;
  const score = parts.competency;
  const missing = quarters.filter(q => !reviews.some(r => r.quarter === q));
  return (
    <section className={card}>
      <CardHead icon={GraduationCap} part="Competency" title="Skills (quarterly review)" />
      {score === null
        ? <p className="mb-3 text-ink-soft">No manager review for {quarters.map(quarterText).join(', ')} yet.</p>
        : <Big value={`${score}%`} note={`From ${reviews.length} review${reviews.length === 1 ? '' : 's'} (stars ÷ 5)`} />}
      <ScoreTable rows={skillRows.filter(r => r.self !== null || r.manager !== null)} />
      <CardComments list={comments.skills} />
      {missing.length > 0 && reviews.length > 0 && <p className="mt-3 text-sm text-attention">Not reviewed yet: {missing.map(quarterText).join(', ')}.</p>}
      {canReview
        ? <button type="button" className={`${secondaryBtn} mt-3`} onClick={onReview}><Award className="h-4 w-4" /> Review {person.name}</button>
        : <p className="mt-3 text-sm text-ink-soft">Your own review is done by another manager.</p>}
    </section>
  );
}

// ---------- Behavioural: HEART values (teammates' 360 + the manager's review) ----------
function usePeerPart(memberId: string, months: string[]) {
  const rounds = useRatingRounds().filter(r => months.includes(r.month));
  const closed = rounds.filter(r => r.status === 'closed');
  const stillOpen = rounds.filter(r => r.status === 'open').length;
  const all = useAllRatings();
  const mine = all.filter(x => x.rateeId === memberId && closed.some(r => r.id === x.roundId));
  return { mine, sum: summarise(mine), stillOpen };
}

function BehaviouralCard({ person, sc, peerShare, photoShare: photoPart, canReview, onReview }: { person: Person; sc: PersonScorecardData; peerShare: number; photoShare: number; canReview: boolean; onReview: () => void }) {
  const { peers, managerAvg, behaviour, valueRows, comments, photos } = sc;
  const { sum, stillOpen } = peers;
  return (
    <section className={card}>
      <CardHead icon={Smile} part="Behavioural" title="HEART values" />
      {behaviour.score === null ? (
        <p className="mb-3 text-ink-soft">No closed 360 ratings or manager review in this period.</p>
      ) : (
        <Big value={`${behaviour.score}%`} note={`${one(behaviour.stars as number)} / 5 · teammates ${peerShare}%, manager ${100 - peerShare}% (if one is missing, the other counts in full)`} />
      )}
      <div className="mb-3 grid gap-2 sm:grid-cols-2">
        <p className="flex justify-between rounded-lg bg-surface px-3 py-2 text-[15px]">Teammates (360) <strong className="tabular-nums">{sum.overall ? `${one(sum.overall.avg)} / 5` : '–'}</strong></p>
        <p className="flex justify-between rounded-lg bg-surface px-3 py-2 text-[15px]">Manager <strong className="tabular-nums">{managerAvg === null ? '–' : `${one(managerAvg)} / 5`}</strong></p>
      </div>
      {photoPart > 0 && photos.meetings > 0 && (
        <p className="mb-3 rounded-lg bg-surface px-3 py-2 text-[15px]">
          Meeting photos: <strong className="tabular-nums">{photos.withPhoto} of {photos.meetings}</strong> meetings ({photos.pct}%) · {photoPart}% of Accountability and Trustworthiness
        </p>
      )}
      <ScoreTable peers rows={valueRows.filter(r => r.self !== null || r.manager !== null || (r.peers ?? null) !== null)} />
      {sum.overall && <p className="mt-1 text-sm text-ink-soft">From {sum.overall.count} teammate rating{sum.overall.count === 1 ? '' : 's'}.</p>}
      <CardComments list={comments.values} />
      {stillOpen > 0 && <p className="mt-3 text-sm text-attention">{stillOpen} 360 round{stillOpen === 1 ? '' : 's'} in this period still open; ratings count once closed.</p>}
      {canReview && <button type="button" className={`${secondaryBtn} mt-3`} onClick={onReview}><Award className="h-4 w-4" /> Review {person.name}</button>}
    </section>
  );
}

// ---------- Performance: reliability (process) ----------
function useIncidents(memberId: string): Incident[] {
  const [list, setList] = useState<Incident[]>([]);
  useEffect(() => onSnapshot(query(collection(db, 'reliability_incidents'), where('memberId', '==', memberId)),
    s => setList(s.docs.map(d => readIncident(d.id, d.data()))), () => setList([])), [memberId]);
  return list;
}
export function useReliabilitySettings(): ReliabilitySettings {
  const [s, setS] = useState<ReliabilitySettings>(DEFAULT_RELIABILITY);
  useEffect(() => onSnapshot(doc(db, 'config', 'reliability'), d => setS(readReliabilitySettings(d.data())), () => {}), []);
  return s;
}

function useReliabilityPart(memberId: string, from: string, to: string) {
  const { rules, days, error, countedOf } = useLoginData(from);
  const excusedAll = useExcusedDays(from, memberId);
  const incidents = useIncidents(memberId);
  const settings = useReliabilitySettings();
  const excused = (excusedAll || []).filter(e => e.date <= to);
  const r = reliabilityFor({ from, to, today: todayIso(), rules, minutesOf: d => countedOf(memberId, d), excused, incidents, settings });
  // Nothing counts until the Login log has loaded.
  return { r: days === null ? { ...r, score: null } : r, loading: days === null, error, settings };
}

function ReliabilityCard({ viewer, person, people, from, rel, comments }: {
  viewer: Viewer; person: Person; people: Person[]; from: string; rel: ReturnType<typeof useReliabilityPart>; comments: PersonScorecardData['comments']['reliability'];
}) {
  const { r, loading, error } = rel;
  const [show, setShow] = useState<'' | 'days' | 'incident'>('');
  const byReason = Object.entries(r.excused.reduce((m, e) => ({ ...m, [e.reason]: (m[e.reason] || 0) + 1 }), {} as Record<string, number>));
  const removeIncident = async (i: Incident) => { try { await deleteDoc(doc(db, 'reliability_incidents', i.id)); } catch { /* shown by the list staying */ } };
  return (
    <section className={card}>
      <CardHead icon={CalendarCheck} part="Performance · process" title="Reliability" />
      {error && <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {loading ? (
        <p className="flex items-center gap-2 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
      ) : (
        <>
          {r.score === null
            ? <Big value="–" note="No working days to count yet" />
            : <Big value={one(r.score)} unit="/ 5" note={`${r.sharePct}% of ${r.counted} counted day${r.counted === 1 ? '' : 's'} green or amber → ${r.base}${r.deduction ? `, minus ${one(r.deduction)} for incidents` : ''}`} />}
          <ul className="grid grid-cols-3 gap-1.5 text-center text-sm">
            {(['green', 'amber', 'red'] as const).map(l => (
              <li key={l} className="rounded-lg bg-surface px-2 py-1.5"><span className={`block text-lg font-bold ${LIGHT_TEXT[l]}`}>{r[l]}</span>{LIGHT_LABELS[l]}</li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-ink-soft">
            {r.workDays} working day{r.workDays === 1 ? '' : 's'} so far, {r.excused.length} out of office{byReason.length ? ` (${byReason.map(([k, n]) => `${EXCUSE_LABELS[k as keyof typeof EXCUSE_LABELS]} ${n}`).join(', ')})` : ''}. A day is judged by its CRM time only; start time is never scored.
          </p>
          <div className="mt-3">
            <p className="text-sm font-semibold">Incidents</p>
            {!r.incidents.length ? <p className="text-sm text-ink-soft">None in this period.</p> : (
              <ul className="mt-1 space-y-1.5">
                {r.incidents.map(i => (
                  <li key={i.id} className="flex items-start gap-2 rounded-lg bg-surface px-3 py-1.5 text-[15px]">
                    <span className="flex-1"><strong>{formatDate(i.date)}</strong> · {INCIDENT_LABELS[i.kind]}{i.note && <span className="block text-sm text-ink-soft">{i.note}</span>}</span>
                    <button type="button" onClick={() => removeIncident(i)} className="rounded-md p-1 text-ink-soft hover:bg-white hover:text-danger" aria-label="Remove incident"><Trash2 className="h-4 w-4" /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={secondaryBtn} onClick={() => setShow(show === 'days' ? '' : 'days')}>Days out of office</button>
        <button type="button" className={secondaryBtn} onClick={() => setShow(show === 'incident' ? '' : 'incident')}><Plus className="h-4 w-4" /> Incident</button>
      </div>
      {show === 'days' && <div className="mt-3"><DaysOut viewer={viewer} people={people} memberId={person.id} fromKey={from} /></div>}
      {show === 'incident' && <IncidentForm viewer={viewer} memberId={person.id} onDone={() => setShow('')} />}
      <CardComments list={comments} />
    </section>
  );
}

function IncidentForm({ viewer, memberId, onDone }: { viewer: Viewer; memberId: string; onDone: () => void }) {
  const [f, setF] = useState({ date: todayIso(), kind: 'late_commitment' as IncidentKind, note: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const draft = useFormDraft(viewer.id, `incident:${memberId}`, f, setF);
  const save = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) return setError('Choose the date.');
    if (!f.note.trim()) return setError('Add a short note on what happened.');
    setBusy(true);
    try {
      await addDoc(collection(db, 'reliability_incidents'), { memberId, date: f.date, kind: f.kind, note: f.note.trim(), byId: viewer.id, byName: viewer.name, at: new Date().toISOString() });
      draft.clear();
      onDone();
    } catch (e) { setError(friendlyError(e)); setBusy(false); }
  };
  return (
    <div className="mt-3 space-y-3 rounded-xl border border-line p-3.5">
      <DraftBar draft={draft} what="incident" />
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label htmlFor="inc-date" className={label}>Date</label><input id="inc-date" type="date" className={input} value={f.date} onChange={e => setF(x => ({ ...x, date: e.target.value }))} /></div>
        <div>
          <label htmlFor="inc-kind" className={label}>What</label>
          <select id="inc-kind" className={input} value={f.kind} onChange={e => setF(x => ({ ...x, kind: e.target.value as IncidentKind }))}>
            {(Object.keys(INCIDENT_LABELS) as IncidentKind[]).map(k => <option key={k} value={k}>{INCIDENT_LABELS[k]}</option>)}
          </select>
        </div>
      </div>
      <div><label htmlFor="inc-note" className={label}>Note</label><textarea id="inc-note" className={`${input} min-h-[64px]`} value={f.note} onChange={e => { setF(x => ({ ...x, note: e.target.value })); setError(''); }} /></div>
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={secondaryBtn} onClick={onDone}>Cancel</button>
        <button type="button" className={primaryBtn} disabled={busy} onClick={save}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save incident</button>
      </div>
    </div>
  );
}

export function ReliabilitySettingsDialog({ viewer, settings, onClose }: { viewer: Viewer; settings: ReliabilitySettings; onClose: () => void }) {
  const [s, setS] = useState<ReliabilitySettings>(settings);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const num = (k: keyof ReliabilitySettings) => (e: React.ChangeEvent<HTMLInputElement>) => { setS(x => ({ ...x, [k]: Number(e.target.value) })); setError(''); };
  const save = async () => {
    const p = settingsProblem(s);
    if (p) return setError(p);
    setBusy(true);
    try {
      await setDoc(doc(db, 'config', 'reliability'), { ...s, updatedAt: new Date().toISOString(), updatedById: viewer.id, updatedByName: viewer.name });
      onClose();
    } catch (e) { setError(friendlyError(e)); setBusy(false); }
  };
  const row = (score: number, k: 's5' | 's4' | 's3' | 's2') => (
    <label className="flex items-center gap-2 text-[15px]">
      <span className="w-16 font-semibold">{score} / 5</span> when at least
      <input type="number" min={0} max={100} className={`${input} w-20`} value={s[k]} onChange={num(k)} /> % of days are green or amber
    </label>
  );
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <h3 className="text-lg font-bold">Reliability score settings</h3>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-ink-soft hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-2">
          {row(5, 's5')}{row(4, 's4')}{row(3, 's3')}{row(2, 's2')}
          <p className="text-sm text-ink-soft">Below that: 1 / 5. Days out of office are not counted.</p>
          <label className="flex items-center gap-2 text-[15px]">
            Take off <input type="number" min={0} max={4} step={0.1} className={`${input} w-20`} value={s.incidentDeduction} onChange={num('incidentDeduction')} /> for each incident
          </label>
        </div>
        {error && <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="mt-5 flex justify-between gap-2">
          <button type="button" className={secondaryBtn} onClick={() => setS(DEFAULT_RELIABILITY)}>Reset to default</button>
          <div className="flex gap-2">
            <button type="button" className={secondaryBtn} onClick={onClose}>Cancel</button>
            <button type="button" className={primaryBtn} disabled={busy} onClick={save}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Management notes ----------
function NotesCard({ viewer, memberId, from, to }: { viewer: Viewer; memberId: string; from: string; to: string; key?: string }) {
  const id = `${memberId}_${from}_${to}`;
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState('');
  const [base, setBase] = useState('');
  const [meta, setMeta] = useState('');
  useEffect(() => onSnapshot(doc(db, 'appraisal_notes', id), d => {
    const v = String(d.data()?.text || '');
    if (!loaded) { setText(v); setBase(v); setLoaded(true); }
    setMeta(d.exists() ? `Last saved by ${d.data()?.byName || 'Management'}` : '');
  }, () => setLoaded(true)), [id, loaded]);
  const { state } = useAutoSave({
    value: text, dirty: loaded && text !== base, enabled: loaded, delay: 1500,
    write: v => setDoc(doc(db, 'appraisal_notes', id), { memberId, from, to, text: v, byId: viewer.id, byName: viewer.name, updatedAt: new Date().toISOString() }),
    onSaved: json => setBase(JSON.parse(json)),
  });
  return (
    <section className={card}>
      <label htmlFor="ap-notes" className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-lg font-bold"><ClipboardList className="h-5 w-5 text-accent" /> Management notes</span>
        <span className={`text-sm ${state.status === 'error' ? 'text-danger' : 'text-ink-soft'}`}>
          {state.status === 'error' ? `Couldn't save (${state.error}), trying again` : state.status === 'saving' ? 'Saving…' : text !== base ? 'Saves in a moment' : meta}
        </span>
      </label>
      <p className="mb-2 text-sm text-ink-soft">Kept for this person and this period. Only Management sees them.</p>
      <textarea id="ap-notes" className={`${input} min-h-[120px]`} value={text} disabled={!loaded} onChange={e => setText(e.target.value)} placeholder="Strengths, what to work on, agreed next steps" />
    </section>
  );
}
