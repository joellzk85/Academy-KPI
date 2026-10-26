import React, { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Loader2, Plus, X } from 'lucide-react';
import PanelResizer from './PanelResizer';
import DraftBar from './DraftBar';
import { HintInput, LevelHints, Stars } from './Rating360';
import { db, friendlyError } from '../lib/firebase';
import { useFormDraft } from '../lib/useFormDraft';
import { activeItems, RatingItem, STAR_WORDS } from '../lib/rating360';
import { cleanSections, readSections, Section, SectionComments } from '../lib/appraisalCycle';
import {
  DEFAULT_SCORECARD, Level, LEVEL_LABELS, LEVELS, levelFor, MIN_REASON, newSkillId, PART_LABELS, PARTS, quarterText, readReview,
  readScorecard, Review, reviewId, reviewProblem, ScorecardSettings, Skill, SKILL_GROUP_LABELS, SKILL_GROUPS, SkillGroup, skillsFor, scorecardProblem,
} from '../lib/scorecard';

// Performance scorecard screens (Joel, 2026-10-25), in Management → KPI & appraisal. Logic: lib/scorecard.ts.
// - Settings (KPI & appraisal → Settings): weights per level, each person's level and the two shares (one form), and
//   the competency skills (another form), each group of skills folding away (Joel: "distinct, collapsible, tidy").
//   Skills are added, renamed, moved between groups, turned off and reordered; never deleted.
// - Quarterly review: a manager scores each skill that applies (or marks it not applicable) and each HEART value,
//   1-5, with a reason for any 1 or 2, and comments on every section (`sections`). Never your own review.

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };
type Person = { id: string; name: string; role: string };

const input = 'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const label = 'mb-1 block text-sm font-semibold text-ink';
const primaryBtn = 'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-[15px] font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const secondaryBtn = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-50';

export function useScorecard(): ScorecardSettings {
  const [s, setS] = useState<ScorecardSettings>(DEFAULT_SCORECARD);
  useEffect(() => onSnapshot(doc(db, 'config', 'scorecard'), d => setS(readScorecard(d.data())), () => {}), []);
  return s;
}

export function useReviews(memberId: string): Review[] {
  const [list, setList] = useState<Review[]>([]);
  useEffect(() => onSnapshot(query(collection(db, 'scorecard_reviews'), where('memberId', '==', memberId)),
    s => setList(s.docs.map(d => readReview(d.id, d.data()))), () => setList([])), [memberId]);
  return list;
}
// The manager's comments per section in a review (`sections`).
export const reviewSections = (r: Review): SectionComments => readSections(r.sections);

export function SidePanel({ title, note, onClose, children }: { title: string; note?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" role="dialog" aria-modal="true" aria-label={title}>
      <PanelResizer />
      <div className="flex h-full w-full flex-col bg-surface font-sans text-ink shadow-xl md:w-[var(--panel-w,max(50vw,40rem))] md:min-w-[24rem] md:max-w-[95vw]">
        <div className="flex items-start justify-between gap-3 border-b border-line bg-white px-5 py-4">
          <div>
            <h3 className="text-lg font-bold">{title}</h3>
            {note && <p className="text-sm text-ink-soft">{note}</p>}
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-ink-soft hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

// A section that folds away. `inner` is the lighter look for a fold inside a card.
export function Fold({ title, note, open: startOpen = false, inner, children }: { title: React.ReactNode; note?: string; open?: boolean; inner?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <section className={inner ? 'overflow-hidden rounded-xl border border-line bg-white' : 'overflow-hidden rounded-2xl border border-line bg-white'}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)} className={`flex w-full items-start gap-2 text-left hover:bg-surface ${inner ? 'px-3.5 py-2.5' : 'px-5 py-4'}`}>
        {open ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-ink-soft" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-ink-soft" />}
        <span className="flex-1">
          <span className={`block font-bold ${inner ? 'text-[15px]' : ''}`}>{title}</span>
          {note && <span className="block text-sm text-ink-soft">{note}</span>}
        </span>
      </button>
      {open && <div className={`space-y-3 border-t border-line ${inner ? 'p-3' : 'px-5 py-4'}`}>{children}</div>}
    </section>
  );
}

// One item to score 1-5: what 1 and 5 look like, the stars, "not applicable" (skills), and a reason for 1 or 2.
export function StarRow({ id, name, low, high, stars, onStars, na, onNa, reason, onReason }: {
  id: string; name: string; low?: string; high?: string; stars: number; onStars: (n: number) => void;
  na?: boolean; onNa?: () => void; reason?: string; onReason?: (t: string) => void; key?: string;
}) {
  const left = Math.max(0, MIN_REASON - (reason || '').trim().length);
  return (
    <div className="rounded-xl bg-surface p-3.5">
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className={label}>{name}</span>
        {onNa && <label className="flex items-center gap-1.5 text-sm text-ink-soft"><input type="checkbox" className="accent-[#0E6E62]" checked={!!na} onChange={onNa} /> Not applicable</label>}
      </span>
      {!na && (
        <>
          <LevelHints low={low} high={high} />
          <span className="flex flex-wrap items-center gap-3"><Stars value={stars} onChange={onStars} /><span className="text-sm text-ink-soft">{STAR_WORDS[stars]}</span></span>
          {onReason && stars >= 1 && stars <= 2 && (
            <div className="mt-2">
              <label htmlFor={`why-${id}`} className={label}>Why {stars} star{stars > 1 ? 's' : ''}?</label>
              <textarea id={`why-${id}`} value={reason || ''} onChange={e => onReason(e.target.value)} className={`${input} min-h-[72px]`} placeholder="What happened, and what would make it better. Give an example." />
              <p className={`mt-1 text-sm ${left ? 'text-ink-soft' : 'text-accent'}`}>{left ? `${left} more character${left === 1 ? '' : 's'} needed` : 'Thank you'}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// A comment box for one section.
export function SectionBox({ id, text, onChange, title = 'Comment', placeholder }: { id: string; text: string; onChange: (t: string) => void; title?: string; placeholder?: string }) {
  return (
    <div>
      <label htmlFor={id} className={label}>{title}</label>
      <textarea id={id} value={text} onChange={e => onChange(e.target.value)} className={`${input} min-h-[72px]`} placeholder={placeholder} />
    </div>
  );
}

// Skills split into their groups, each folding away; the first group starts open.
export function SkillGroupFolds({ skills, render }: { skills: Skill[]; render: (k: Skill) => React.ReactNode }) {
  const groups = SKILL_GROUPS.filter(g => skills.some(k => k.group === g));
  return (
    <div className="space-y-2">
      {groups.map((g, i) => {
        const list = skills.filter(k => k.group === g);
        return <Fold key={g} inner open={i === 0} title={SKILL_GROUP_LABELS[g]} note={`${list.length} skill${list.length === 1 ? '' : 's'}`}>{list.map(render)}</Fold>;
      })}
    </div>
  );
}

// ---------- Settings: weights, levels and shares ----------
export function WeightsForm({ viewer, people, settings }: { viewer: Viewer; people: Person[]; settings: ScorecardSettings }) {
  const [s, setS] = useState<ScorecardSettings>(() => JSON.parse(JSON.stringify(settings)));
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const draft = useFormDraft(viewer.id, 'scorecard:weights', s, setS);
  const set = (c: Partial<ScorecardSettings>) => { setS(x => ({ ...x, ...c })); setError(''); setNote(''); };
  const setWeight = (l: Level, p: typeof PARTS[number], v: string) => set({ weights: { ...s.weights, [l]: { ...s.weights[l], [p]: Number(v) } } });
  const save = async () => {
    const p = scorecardProblem({ ...s, skills: settings.skills });
    if (p) return setError(p);
    setBusy(true);
    try {
      await setDoc(doc(db, 'config', 'scorecard'), {
        weights: s.weights,
        levelOf: Object.fromEntries(people.map(m => [m.id, levelFor(s, m.id, m.role)])),
        peerShare: s.peerShare, reliabilityShare: s.reliabilityShare, photoShare: s.photoShare,
        updatedAt: new Date().toISOString(), updatedById: viewer.id, updatedByName: viewer.name,
      }, { merge: true });
      draft.clear();
      setNote('Saved.');
    } catch (e) { setError(friendlyError(e)); }
    setBusy(false);
  };
  return (
    <div className="space-y-4">
      <DraftBar draft={draft} what="weights and levels" />
      <div>
        <h4 className="font-bold">Weights per level</h4>
        <p className="mb-3 text-sm text-ink-soft">Each level's three parts add up to 100%.</p>
        <div className="space-y-3">
          {LEVELS.map(l => {
            const total = PARTS.reduce((t, p) => t + (Number(s.weights[l][p]) || 0), 0);
            return (
              <div key={l} className="rounded-xl bg-surface p-3">
                <p className="mb-2 flex justify-between text-[15px] font-semibold">{LEVEL_LABELS[l]}<span className={total === 100 ? 'text-ink-soft' : 'text-danger'}>{total}%</span></p>
                <div className="grid grid-cols-3 gap-2">
                  {PARTS.map(p => (
                    <label key={p} className="text-sm">
                      <span className="mb-1 block text-ink-soft">{PART_LABELS[p]} %</span>
                      <input type="number" min={0} max={100} className={input} value={s.weights[l][p]} onChange={e => setWeight(l, p, e.target.value)} />
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div>
        <h4 className="mb-3 font-bold">Each person's level</h4>
        <ul className="space-y-2">
          {people.map(m => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[15px]">{m.name}</span>
              <select className={`${input} w-auto`} value={levelFor(s, m.id, m.role)} aria-label={`${m.name}'s level`}
                onChange={e => set({ levelOf: { ...s.levelOf, [m.id]: e.target.value as Level } })}>
                {LEVELS.map(l => <option key={l} value={l}>{LEVEL_LABELS[l]}</option>)}
              </select>
            </li>
          ))}
        </ul>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="sc-peer" className={label}>Behavioural from teammates (360) %</label>
          <input id="sc-peer" type="number" min={0} max={100} className={input} value={s.peerShare} onChange={e => set({ peerShare: Number(e.target.value) })} />
          <p className="mt-1 text-sm text-ink-soft">The rest, {Math.max(0, 100 - (s.peerShare || 0))}%, from the manager's review.</p>
        </div>
        <div>
          <label htmlFor="sc-rel" className={label}>Performance from reliability %</label>
          <input id="sc-rel" type="number" min={0} max={100} className={input} value={s.reliabilityShare} onChange={e => set({ reliabilityShare: Number(e.target.value) })} />
          <p className="mt-1 text-sm text-ink-soft">The rest, {Math.max(0, 100 - (s.reliabilityShare || 0))}%, from the KPI score.</p>
        </div>
        <div>
          <label htmlFor="sc-photo" className={label}>Accountability and Trustworthiness from meeting photos %</label>
          <input id="sc-photo" type="number" min={0} max={100} className={input} value={s.photoShare} onChange={e => set({ photoShare: Number(e.target.value) })} />
          <p className="mt-1 text-sm text-ink-soft">The % of face-to-face meetings with a photo; the rest, {Math.max(0, 100 - (s.photoShare || 0))}%, from the ratings. 0 turns it off.</p>
        </div>
      </div>
      <p className="text-sm text-ink-soft">Self reviews are shown next to the manager's and teammates' ratings but never count in the score.</p>
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {note && <p role="status" className="rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">{note}</p>}
      <div className="flex justify-between gap-2">
        <button type="button" className={secondaryBtn} onClick={() => set({ weights: DEFAULT_SCORECARD.weights, peerShare: DEFAULT_SCORECARD.peerShare, reliabilityShare: DEFAULT_SCORECARD.reliabilityShare, photoShare: DEFAULT_SCORECARD.photoShare })}>Default weights</button>
        <button type="button" className={primaryBtn} disabled={busy} onClick={save}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save weights and levels</button>
      </div>
    </div>
  );
}

// ---------- Settings: competency skills, one fold per group ----------
export function SkillsForm({ viewer, settings }: { viewer: Viewer; settings: ScorecardSettings }) {
  const [skills, setSkills] = useState<Skill[]>(() => settings.skills.map(k => ({ ...k })));
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const draft = useFormDraft(viewer.id, 'scorecard:skills', skills, setSkills);
  const change = (id: string, c: Partial<Skill>) => { setSkills(l => l.map(k => (k.id === id ? { ...k, ...c } : k))); setError(''); setNote(''); };
  // Move up or down within its own group.
  const move = (id: string, by: -1 | 1) => setSkills(l => {
    const k = l.find(x => x.id === id)!;
    const same = l.map((x, i) => [x, i] as const).filter(([x]) => x.group === k.group);
    const at = same.findIndex(([x]) => x.id === id);
    const other = same[at + by];
    if (!other) return l;
    const next = l.slice();
    next[same[at][1]] = other[0];
    next[other[1]] = k;
    return next;
  });
  const add = (group: SkillGroup) => { setSkills(l => [...l, { id: newSkillId(), name: '', group, active: true, order: l.length + 1, low: '', high: '' }]); setNote(''); };
  const save = async () => {
    const p = scorecardProblem({ ...settings, skills });
    if (p) return setError(p);
    setBusy(true);
    try {
      // Saved in group order, so the review shows them the same way.
      const ordered = SKILL_GROUPS.flatMap(g => skills.filter(k => k.group === g));
      await setDoc(doc(db, 'config', 'scorecard'), {
        skills: ordered.map((k, n) => ({ id: k.id, name: k.name.trim(), group: k.group, active: k.active, order: n + 1, low: k.low.trim(), high: k.high.trim() })),
        updatedAt: new Date().toISOString(), updatedById: viewer.id, updatedByName: viewer.name,
      }, { merge: true });
      draft.clear();
      setNote('Saved.');
    } catch (e) { setError(friendlyError(e)); }
    setBusy(false);
  };
  return (
    <div className="space-y-3">
      <DraftBar draft={draft} what="competency skills" />
      <p className="text-sm text-ink-soft">Scored 1 to 5 in each quarterly review and the self review. A skill that doesn't fit someone can be marked not applicable. Turning a skill off keeps its past scores.</p>
      {SKILL_GROUPS.map((g, gi) => {
        const list = skills.filter(k => k.group === g);
        return (
          <Fold key={g} inner open={gi === 0} title={SKILL_GROUP_LABELS[g]} note={`${list.filter(k => k.active).length} on, ${list.filter(k => !k.active).length} off`}>
            <ul className="space-y-2">
              {list.map((k, idx) => (
                <li key={k.id} className={`space-y-2 rounded-lg bg-surface px-3 py-2 ${k.active ? '' : 'opacity-70'}`}>
                  <span className="flex flex-wrap items-center gap-2">
                    <input className={`${input} min-w-[10rem] flex-1`} value={k.name} onChange={e => change(k.id, { name: e.target.value })} aria-label="Skill name" />
                    <select className={`${input} w-auto`} value={k.group} onChange={e => change(k.id, { group: e.target.value as SkillGroup })} aria-label="Move to group">
                      {SKILL_GROUPS.map(x => <option key={x} value={x}>{SKILL_GROUP_LABELS[x]}</option>)}
                    </select>
                    <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" className="accent-[#0E6E62]" checked={k.active} onChange={e => change(k.id, { active: e.target.checked })} /> On</label>
                    <button type="button" className="rounded-md p-1.5 text-ink-soft hover:bg-white disabled:opacity-30" disabled={idx === 0} onClick={() => move(k.id, -1)} aria-label="Move up"><ArrowUp className="h-4 w-4" /></button>
                    <button type="button" className="rounded-md p-1.5 text-ink-soft hover:bg-white disabled:opacity-30" disabled={idx === list.length - 1} onClick={() => move(k.id, 1)} aria-label="Move down"><ArrowDown className="h-4 w-4" /></button>
                  </span>
                  {k.active && (
                    <span className="grid gap-2">
                      <HintInput stars={1} className={input} value={k.low} onChange={e => change(k.id, { low: e.target.value })} placeholder="What 1 star looks like" aria-label={`${k.name || 'Skill'}: what 1 star looks like`} />
                      <HintInput stars={5} className={input} value={k.high} onChange={e => change(k.id, { high: e.target.value })} placeholder="What 5 stars look like" aria-label={`${k.name || 'Skill'}: what 5 stars look like`} />
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <button type="button" className={secondaryBtn} onClick={() => add(g)}><Plus className="h-4 w-4" /> Add a skill here</button>
          </Fold>
        );
      })}
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {note && <p role="status" className="rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">{note}</p>}
      <div className="flex justify-end">
        <button type="button" className={primaryBtn} disabled={busy} onClick={save}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save skills</button>
      </div>
    </div>
  );
}

// ---------- Quarterly review ----------
export function ReviewPanel({ viewer, person, level, quarters, reviews, settings, ratingItems, onClose }: {
  viewer: Viewer; person: Person; level: Level; quarters: string[]; reviews: Review[]; settings: ScorecardSettings; ratingItems: RatingItem[]; onClose: () => void;
}) {
  const [quarter, setQuarter] = useState(quarters[quarters.length - 1]);
  return (
    <SidePanel title={`Review: ${person.name}`} note={`${LEVEL_LABELS[level]} · scored by a manager each quarter`} onClose={onClose}>
      {quarters.length > 1 && (
        <div className="inline-flex flex-wrap rounded-lg border border-line bg-white p-0.5" role="tablist">
          {quarters.map(q => (
            <button key={q} type="button" role="tab" aria-selected={quarter === q} onClick={() => setQuarter(q)}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold ${quarter === q ? 'bg-accent text-white' : 'text-ink-soft hover:text-ink'}`}>
              {quarterText(q)}{reviews.some(r => r.quarter === q) ? ' ✓' : ''}
            </button>
          ))}
        </div>
      )}
      <ReviewForm key={quarter} viewer={viewer} person={person} level={level} quarter={quarter} reviews={reviews} settings={settings} ratingItems={ratingItems} onDone={onClose} />
    </SidePanel>
  );
}

function ReviewForm({ viewer, person, level, quarter, reviews, settings, ratingItems, onDone }: {
  viewer: Viewer; person: Person; level: Level; quarter: string; reviews: Review[]; settings: ScorecardSettings; ratingItems: RatingItem[]; onDone: () => void; key?: string;
}) {
  const existing = reviews.find(r => r.quarter === quarter);
  // A new review starts with last quarter's "not applicable" skills.
  const earlier = reviews.filter(r => r.quarter < quarter).sort((a, b) => b.quarter.localeCompare(a.quarter))[0];
  const skills = skillsFor(settings, level);
  const values = activeItems(ratingItems);
  const [v, setV] = useState(() => ({
    skills: { ...(existing?.skills || {}) }, values: { ...(existing?.values || {}) }, notes: { ...(existing?.notes || {}) },
    na: existing ? existing.na.slice() : (earlier?.na || []).slice(), comment: existing?.comment || '',
    sections: existing ? reviewSections(existing) : {} as SectionComments,
  }));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const draft = useFormDraft(viewer.id, `scorecard-review:${person.id}:${quarter}`, v, setV);
  const own = person.id === viewer.id;
  const setStars = (k: 'skills' | 'values', id: string, n: number) => { setV(x => ({ ...x, [k]: { ...x[k], [id]: n } })); setError(''); };
  const setNote = (id: string, t: string) => { setV(x => ({ ...x, notes: { ...x.notes, [id]: t } })); setError(''); };
  const setSection = (s: Section, t: string) => setV(x => ({ ...x, sections: { ...x.sections, [s]: t } }));
  const toggleNa = (id: string) => { setV(x => ({ ...x, na: x.na.includes(id) ? x.na.filter(y => y !== id) : [...x.na, id] })); setError(''); };
  const save = async () => {
    if (own) return setError('Your own review is done by another manager.');
    const p = reviewProblem(v, skills, values);
    if (p) return setError(p);
    setBusy(true); setError('');
    try {
      const scored = skills.filter(k => !v.na.includes(k.id));
      const low = [...scored.map(k => [k.id, v.skills[k.id]] as const), ...values.map(x => [x.id, v.values[x.id]] as const)].filter(([, n]) => n <= 2).map(([id]) => id);
      await setDoc(doc(db, 'scorecard_reviews', reviewId(person.id, quarter)), {
        memberId: person.id, quarter, level,
        skills: Object.fromEntries(scored.map(k => [k.id, v.skills[k.id]])),
        na: skills.filter(k => v.na.includes(k.id)).map(k => k.id),
        values: Object.fromEntries(values.map(x => [x.id, v.values[x.id]])),
        notes: Object.fromEntries(low.map(id => [id, (v.notes[id] || '').trim()])),
        sections: cleanSections(v.sections),
        comment: v.comment.trim(), byId: viewer.id, byName: viewer.name, updatedAt: new Date().toISOString(),
      });
      draft.clear();
      onDone();
    } catch (e) { setError(friendlyError(e)); setBusy(false); }
  };
  if (own) return <p className="rounded-2xl border border-line bg-white p-6 text-center text-ink-soft">Your own review is done by another manager.</p>;
  const box = (s: Section, title: string, placeholder: string) => <SectionBox id={`rv-${s}`} title={title} text={v.sections[s] || ''} onChange={t => setSection(s, t)} placeholder={placeholder} />;
  return (
    <div className="space-y-4">
      <DraftBar draft={draft} what={`review of ${person.name}`} />
      <p className="text-[15px]"><strong>{quarterText(quarter)}</strong>{existing ? ` · last saved by ${existing.byName || 'Management'}` : ' · not reviewed yet'}</p>
      <section className="space-y-3 rounded-2xl border border-line bg-white p-5">
        <h4 className="text-lg font-bold">Performance</h4>
        {box('kpi', 'Comment on their KPIs', 'Results this quarter, what drove them')}
        {box('reliability', 'Comment on their reliability', 'Follow-through, punctuality, keeping commitments')}
      </section>
      <section className="space-y-3 rounded-2xl border border-line bg-white p-5">
        <h4 className="text-lg font-bold">Competency</h4>
        <SkillGroupFolds skills={skills} render={k => (
          <StarRow key={k.id} id={`rv-${k.id}`} name={k.name} low={k.low} high={k.high} stars={v.skills[k.id] || 0} onStars={n => setStars('skills', k.id, n)}
            na={v.na.includes(k.id)} onNa={() => toggleNa(k.id)} reason={v.notes[k.id]} onReason={t => setNote(k.id, t)} />
        )} />
        {box('skills', 'Comment on their skills', 'Strengths, what to learn next')}
      </section>
      <section className="space-y-3 rounded-2xl border border-line bg-white p-5">
        <div>
          <h4 className="text-lg font-bold">Behavioural: HEART values</h4>
          <p className="text-sm text-ink-soft">Your rating as manager. Teammates' 360 ratings are added to it.</p>
        </div>
        {values.length ? values.map(x => (
          <StarRow key={x.id} id={`rv-${x.id}`} name={x.name} low={x.low} high={x.high} stars={v.values[x.id] || 0} onStars={n => setStars('values', x.id, n)}
            reason={v.notes[x.id]} onReason={t => setNote(x.id, t)} />
        )) : <p className="text-ink-soft">No values to rate. Set them in KPI & appraisal → Settings → HEART values.</p>}
        {box('values', 'Comment on their values', 'Examples of how they showed (or missed) the values')}
      </section>
      <SectionBox id="rv-comment" title="Overall comment (optional)" text={v.comment} onChange={t => setV(x => ({ ...x, comment: t }))} placeholder="Strengths, what to work on, agreed next steps" />
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={secondaryBtn} onClick={onDone}>Cancel</button>
        <button type="button" className={primaryBtn} disabled={busy} onClick={save}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{existing ? 'Save changes' : 'Save review'}</button>
      </div>
    </div>
  );
}
