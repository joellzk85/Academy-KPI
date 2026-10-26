// Performance scorecard (Joel, 2026-10-25): the appraisal has three parts that add up to one overall score.
// - Performance ("what did you achieve, and how?"): the KPI score (lib/kpi.ts monthKpi, results) mixed with
//   reliability (lib/reliability.ts, process); reliability is `reliabilityShare` % of Performance.
// - Competency ("can you do the job well?"): skills Management keeps here, each scored 1-5 by a manager in the
//   quarterly review. Groups: role skills, growth, and leadership (Manager and Senior management only).
// - Behavioural ("how do you show up?"): the HEART values (the 360 rating items, lib/rating360.ts). `peerShare` %
//   comes from teammates' 360 ratings in closed rounds, the rest from the manager's rating in the quarterly review.
//   Meeting photos (Joel, 2026-10-26): the % of the person's face-to-face meetings with a photo (lib/meetingPhotos.ts)
//   counts `photoShare` % of the Accountability and Trustworthiness values (as stars, % ÷ 20); see withMeetingPhotos.
// - Each person has a level (Executive, Manager, Senior management); each level has its own weights for the three
//   parts, adding up to 100. A part with nothing to score in the period is left out, and the others count for more
//   (the KPI rule for "nothing to count").
// - Stars become % as stars ÷ 5 (3 = 60%, 4 = 80%, 5 = 100%), so every part uses the KPI traffic light.
// Settings: config/scorecard (Management only). Reviews: scorecard_reviews/{memberId}_{YYYY-Qn} (Management only,
// never your own), with comments per section since the appraisal round (lib/appraisalCycle.ts). Screens: components/Appraisal.tsx and components/Scorecard.tsx.

export type Level = 'executive' | 'manager' | 'senior';
export const LEVELS: Level[] = ['executive', 'manager', 'senior'];
export const LEVEL_LABELS: Record<Level, string> = { executive: 'Executive', manager: 'Manager', senior: 'Senior management' };

export type Part = 'performance' | 'competency' | 'behavioural';
export const PARTS: Part[] = ['performance', 'competency', 'behavioural'];
export const PART_LABELS: Record<Part, string> = { performance: 'Performance', competency: 'Competency', behavioural: 'Behavioural' };
export const PART_QUESTIONS: Record<Part, string> = {
  performance: 'What did you achieve, and how?', competency: 'Can you do the job well?', behavioural: 'How do you show up?',
};
export type Weights = Record<Part, number>;

export type SkillGroup = 'role' | 'growth' | 'leadership';
export const SKILL_GROUPS: SkillGroup[] = ['role', 'growth', 'leadership'];
export const SKILL_GROUP_LABELS: Record<SkillGroup, string> = { role: 'Role skills', growth: 'Growth', leadership: 'Leadership (Manager and Senior management)' };
// Level 1 and level 5 describe the ends of the scale, so every reviewer reads the stars the same way.
export interface Skill { id: string; name: string; group: SkillGroup; active: boolean; order: number; low: string; high: string }

export interface ScorecardSettings {
  weights: Record<Level, Weights>;
  levelOf: Record<string, Level>;   // memberId → level; people not listed use defaultLevel(role)
  peerShare: number;                // % of Behavioural from teammates (360); the rest from the manager
  reliabilityShare: number;         // % of Performance from reliability; the rest from the KPI score
  photoShare: number;               // % of Accountability and Trustworthiness from meeting photos (2026-10-26)
  skills: Skill[];
}

export const DEFAULT_WEIGHTS: Record<Level, Weights> = {
  executive: { performance: 60, competency: 20, behavioural: 20 },
  manager: { performance: 50, competency: 30, behavioural: 20 },
  senior: { performance: 50, competency: 25, behavioural: 25 },
};

const S = (id: string, name: string, group: SkillGroup, order: number, low: string, high: string): Skill => ({ id, name, group, active: true, order, low, high });
export const DEFAULT_SKILLS: Skill[] = [
  S('sales', 'Selling and negotiation', 'role', 1, 'Needs help to run a sales conversation or handle objections', 'Closes complex deals alone and coaches others to sell'),
  S('presentation', 'Presentation and communication', 'role', 2, 'Struggles to present clearly to clients or the team', 'Confident, persuasive presenter; clients ask for them'),
  S('product', 'Programme and product knowledge', 'role', 3, 'Knows only a few of our programmes', 'Knows every programme and can match any client need'),
  S('hrdc', 'HRDC portal and claims', 'role', 4, 'Needs help with grants and claims', 'Handles any grant, claim or query alone, first time right'),
  S('excel', 'Excel and reporting', 'role', 5, 'Basic data entry only', 'Builds clear reports and finds insights in the numbers'),
  S('facilitation', 'Facilitation and training delivery', 'role', 6, 'Delivers content but struggles to engage the room', 'Participants rate them highly and remember the session'),
  S('coordination', 'Event and project coordination', 'role', 7, 'Misses details; needs reminders', 'Runs trainings and events end to end without a hitch'),
  S('learning', 'Courses and certifications', 'growth', 8, 'Learns only when asked', 'Completes courses or certifications and applies them at work'),
  S('ideas', 'Ideas and improvements', 'growth', 9, 'Rarely suggests improvements', 'Brings ideas, SOPs or automation that the company adopts'),
  S('coaching', 'Coaching and developing people', 'leadership', 10, 'Little time spent developing the team', 'Team members grow and step up because of their coaching'),
  S('engagement', 'Team engagement and retention', 'leadership', 11, 'Team is unclear or unsettled', 'Team is motivated, stays, and knows what is expected'),
  S('planning', 'Planning and decisions', 'leadership', 12, 'Reacts to problems as they come', 'Plans ahead, decides well, and turns plans into results'),
];

export const DEFAULT_SCORECARD: ScorecardSettings = { weights: DEFAULT_WEIGHTS, levelOf: {}, peerShare: 50, reliabilityShare: 10, photoShare: 20, skills: DEFAULT_SKILLS };

export const defaultLevel = (role?: string): Level => (role === 'management' ? 'manager' : 'executive');
export const levelFor = (s: ScorecardSettings, memberId: string, role?: string): Level => s.levelOf[memberId] || defaultLevel(role);
// Leadership skills are scored only for Manager and Senior management.
export const skillsFor = (s: ScorecardSettings, level: Level): Skill[] =>
  s.skills.filter(k => k.active && (k.group !== 'leadership' || level !== 'executive')).sort((a, b) => a.order - b.order);
export const newSkillId = () => `skill_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

const isLevel = (v: any): v is Level => LEVELS.includes(v);
const pctNum = (v: any, def: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100 ? Math.round(v) : def);

export function readScorecard(d: any): ScorecardSettings {
  const weights = Object.fromEntries(LEVELS.map(l => {
    const w = d?.weights?.[l];
    const read: Weights = { performance: pctNum(w?.performance, -1), competency: pctNum(w?.competency, -1), behavioural: pctNum(w?.behavioural, -1) };
    return [l, weightsProblem(read) ? DEFAULT_WEIGHTS[l] : read];
  })) as Record<Level, Weights>;
  const levelOf = Object.fromEntries(Object.entries(d?.levelOf || {}).filter(([k, v]) => typeof k === 'string' && isLevel(v))) as Record<string, Level>;
  const skills: Skill[] = (Array.isArray(d?.skills) ? d.skills : [])
    .filter((x: any) => x && typeof x.id === 'string' && x.id && typeof x.name === 'string' && x.name.trim())
    .map((x: any, i: number) => ({
      id: x.id, name: x.name.trim(), group: SKILL_GROUPS.includes(x.group) ? x.group : 'role', active: x.active !== false,
      order: Number.isFinite(x.order) ? x.order : i + 1, low: String(x.low || ''), high: String(x.high || ''),
    }));
  return {
    weights, levelOf,
    peerShare: pctNum(d?.peerShare, DEFAULT_SCORECARD.peerShare),
    reliabilityShare: pctNum(d?.reliabilityShare, DEFAULT_SCORECARD.reliabilityShare),
    photoShare: pctNum(d?.photoShare, DEFAULT_SCORECARD.photoShare),
    skills: (skills.length ? skills : DEFAULT_SKILLS).slice().sort((a, b) => a.order - b.order),
  };
}

export function weightsProblem(w: Weights): string {
  if (!PARTS.every(p => Number.isInteger(w[p]) && w[p] >= 0 && w[p] <= 100)) return 'Each weight must be a whole number from 0 to 100.';
  if (PARTS.reduce((t, p) => t + w[p], 0) !== 100) return 'The three weights must add up to 100%.';
  return '';
}
export function scorecardProblem(s: ScorecardSettings): string {
  for (const l of LEVELS) {
    const p = weightsProblem(s.weights[l]);
    if (p) return `${LEVEL_LABELS[l]}: ${p}`;
  }
  if (!(s.peerShare >= 0 && s.peerShare <= 100)) return 'The teammates share must be from 0 to 100%.';
  if (!(s.reliabilityShare >= 0 && s.reliabilityShare <= 100)) return 'The reliability share must be from 0 to 100%.';
  if (!(s.photoShare >= 0 && s.photoShare <= 100)) return 'The meeting photos share must be from 0 to 100%.';
  if (s.skills.some(k => !k.name.trim())) return 'Give every skill a name.';
  if (!s.skills.some(k => k.active)) return 'Keep at least one skill turned on.';
  return '';
}

// ---------- Quarters ----------
// '2026-11' → '2026-Q4'
export const quarterOf = (ym: string) => `${ym.slice(0, 4)}-Q${Math.floor((Number(ym.slice(5, 7)) - 1) / 3) + 1}`;
export const quarterText = (q: string) => `${q.slice(5)} ${q.slice(0, 4)}`;
// The quarters a list of months touches, in order.
export const quartersIn = (months: string[]) => Array.from(new Set(months.map(quarterOf))).sort();
// The first and last month of a quarter: '2026-Q4' → ['2026-10', '2026-12']
export function quarterMonths(q: string): [string, string] {
  const y = q.slice(0, 4), n = Number(q.slice(6));
  return [`${y}-${String(n * 3 - 2).padStart(2, '0')}`, `${y}-${String(n * 3).padStart(2, '0')}`];
}
export const prevQuarter = (q: string) => {
  const y = Number(q.slice(0, 4)), n = Number(q.slice(6));
  return n === 1 ? `${y - 1}-Q4` : `${y}-Q${n - 1}`;
};

// ---------- Quarterly review ----------
export interface Review {
  id: string; memberId: string; quarter: string;
  skills: Record<string, number>;        // skillId → 1-5
  na: string[];                          // skills that don't apply to this person this quarter
  values: Record<string, number>;        // HEART item id → 1-5 (the manager's rating)
  notes: Record<string, string>;         // skill or value id → why (needed for 1 or 2)
  comment: string;
  sections?: Record<string, string>;     // comments per section: kpi, reliability, skills, values (lib/appraisalCycle.ts)
  byId?: string; byName?: string; updatedAt?: string;
}
export const reviewId = (memberId: string, quarter: string) => `${memberId}_${quarter}`;
const validStars = (v: any) => Number.isInteger(v) && v >= 1 && v <= 5;
const starsMap = (m: any): Record<string, number> => Object.fromEntries(Object.entries(m || {}).filter(([, v]) => validStars(v))) as Record<string, number>;
export function readReview(id: string, d: any): Review {
  return {
    id, memberId: String(d?.memberId || ''), quarter: String(d?.quarter || ''),
    skills: starsMap(d?.skills), na: Array.isArray(d?.na) ? d.na.filter((x: any) => typeof x === 'string') : [],
    values: starsMap(d?.values),
    notes: Object.fromEntries(Object.entries(d?.notes || {}).filter(([, v]) => typeof v === 'string')) as Record<string, string>,
    comment: String(d?.comment || ''),
    sections: Object.fromEntries(Object.entries(d?.sections || {}).filter(([, v]) => typeof v === 'string')) as Record<string, string>,
    byId: d?.byId, byName: d?.byName, updatedAt: d?.updatedAt,
  };
}

export const MIN_REASON = 20;
// Every item scored 1-5 (or marked not applicable, for skills); a reason of MIN_REASON+ characters for a 1 or 2.
export function reviewProblem(r: Pick<Review, 'skills' | 'na' | 'values' | 'notes'>, skills: { id: string; name: string }[], values: { id: string; name: string }[]): string {
  const check = (x: { id: string; name: string }, stars: number | undefined) => {
    if (!validStars(stars)) return `Choose 1 to 5 stars for ${x.name}.`;
    if ((stars as number) <= 2 && (r.notes[x.id] || '').trim().length < MIN_REASON) return `${x.name}: say why you gave ${stars} star${stars === 1 ? '' : 's'} (at least ${MIN_REASON} characters).`;
    return '';
  };
  for (const k of skills) {
    if (r.na.includes(k.id)) continue;
    const p = check(k, r.skills[k.id]);
    if (p) return p;
  }
  if (skills.length && skills.every(k => r.na.includes(k.id))) return 'Score at least one skill, or this review has no competency score.';
  for (const v of values) {
    const p = check(v, r.values[v.id]);
    if (p) return p;
  }
  return '';
}

const avg = (list: number[]) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
const round2 = (n: number) => Math.round(n * 100) / 100;
export const starsPct = (stars: number) => Math.round((stars / 5) * 100);

// A review's average skill stars, counting only the skills that apply (on, right level, not N/A).
export function reviewSkillAvg(r: Pick<Review, 'skills' | 'na'>, skills: Skill[]): number | null {
  const a = avg(skills.filter(k => !r.na.includes(k.id) && validStars(r.skills[k.id])).map(k => r.skills[k.id]));
  return a === null ? null : round2(a);
}
// A review's average value stars (the manager's HEART rating), over the values that are on.
export function reviewValuesAvg(r: Pick<Review, 'values'>, valueIds: string[]): number | null {
  const a = avg(valueIds.filter(id => validStars(r.values[id])).map(id => r.values[id]));
  return a === null ? null : round2(a);
}

// Average per skill (or value) across several reviews.
export function perItemAvg(maps: Record<string, number>[], skip: (id: string, i: number) => boolean = () => false): Record<string, { avg: number; count: number }> {
  const sums: Record<string, { t: number; n: number }> = {};
  maps.forEach((m, i) => Object.entries(m).forEach(([id, v]) => {
    if (!validStars(v) || skip(id, i)) return;
    const s = (sums[id] ||= { t: 0, n: 0 }); s.t += v; s.n += 1;
  }));
  return Object.fromEntries(Object.entries(sums).map(([id, s]) => [id, { avg: round2(s.t / s.n), count: s.n }]));
}

// ---------- Part scores (0-100, or null when there is nothing to score) ----------
const mix = (a: number | null, b: number | null, bShare: number): number | null => {
  if (a === null && b === null) return null;
  if (a === null) return b;
  if (b === null) return a;
  return (a * (100 - bShare) + b * bShare) / 100;
};

// Performance: the KPI score (%) mixed with reliability (1-5 → %).
export function performanceScore(kpiPct: number | null, reliability: number | null, reliabilityShare: number): number | null {
  const m = mix(kpiPct, reliability === null ? null : (reliability / 5) * 100, reliabilityShare);
  return m === null ? null : Math.round(m);
}
// Competency: average of each quarter's skill average (stars → %).
export function competencyScore(quarterAvgs: (number | null)[]): number | null {
  const a = avg(quarterAvgs.filter((x): x is number => x !== null));
  return a === null ? null : starsPct(a);
}
// Behavioural: teammates' 360 average and the manager's average, by peerShare.
export function behaviouralScore(peerAvg: number | null, managerAvg: number | null, peerShare: number): { score: number | null; stars: number | null } {
  const s = mix(managerAvg, peerAvg, peerShare);
  return { score: s === null ? null : starsPct(s), stars: s === null ? null : round2(s) };
}

// Meeting photos (2026-10-26): each of these values' stars become (100 - photoShare)% their rating and photoShare% the
// photo % as stars (% ÷ 20). Behavioural is the values' average, so its stars move by that change ÷ the number of values.
// No ratings yet, or no face-to-face meetings in the period: unchanged.
export const PHOTO_VALUES = ['accountability', 'trustworthiness'];
export function withMeetingPhotos(base: { score: number | null; stars: number | null }, itemStars: Record<string, number | null>, values: number, photoPct: number | null, photoShare: number): { score: number | null; stars: number | null } {
  if (base.stars === null || photoPct === null || !photoShare || values < 1) return base;
  const photoStars = photoPct / 20;
  const ids = PHOTO_VALUES.filter(id => id in itemStars);
  if (!ids.length) return base;
  const change = ids.reduce((t, id) => t + (photoShare / 100) * (photoStars - (itemStars[id] ?? (base.stars as number))), 0);
  const stars = Math.max(0, Math.min(5, base.stars + change / values));
  return { score: starsPct(stars), stars: round2(stars) };
}

// Overall: the parts' weighted average, over the parts that have a score.
export function overallScore(parts: Record<Part, number | null>, w: Weights): { score: number | null; used: Part[]; missing: Part[]; effective: Weights } {
  const used = PARTS.filter(p => parts[p] !== null && w[p] > 0);
  const missing = PARTS.filter(p => parts[p] === null && w[p] > 0);
  const sum = used.reduce((t, p) => t + w[p], 0);
  const effective = Object.fromEntries(PARTS.map(p => [p, sum > 0 && used.includes(p) ? Math.round((w[p] / sum) * 1000) / 10 : 0])) as Weights;
  if (!sum) return { score: null, used, missing, effective };
  return { score: Math.round(used.reduce((t, p) => t + (parts[p] as number) * w[p], 0) / sum), used, missing, effective };
}
