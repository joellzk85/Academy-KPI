// Appraisal round (Joel, 2026-10-25): Management → KPI & appraisal → Appraisal round → Commence appraisal.
// - appraisal_cycles/{id}: { name, quarter 'YYYY-Qn', dueDate, people, roundId, status, createdAt, createdById,
//   createdByName, closedAt, releasedAt, releasedByName }. Everyone reads; Management writes.
//   status 'open': everyone in `people` writes their self review and rates their teammates (the linked 360 round,
//   rating_rounds/{roundId}, everyone rates everyone). 'closed': nothing more can be written; Management finishes
//   its reviews. 'released': each person sees their own result (appraisal_results).
// - self_reviews/{cycleId}_{memberId}: the person's own stars on skills and HEART values and their comments on each
//   section. Shown next to the manager's and teammates' views; it never counts in the score (Joel). Only the person
//   (while the round is open) and Management.
// - Comments on every section (kpi, reliability, skills, values) come from the person, each teammate (360 rating
//   `sections`) and the manager (scorecard review `sections`).
// - Nobody but Management sees any rating until Joel releases the round (Joel). Comments carry who wrote them in the
//   released result; the rating screens don't say so (Joel: "transparent, but don't tell them").
// - appraisal_results/{cycleId}_{memberId}: a copy of the person's scorecard made when Management releases the round
//   (released: true). Only the person and Management read it.

export type CycleStatus = 'open' | 'closed' | 'released';
export interface AppraisalCycle {
  id: string; name: string; quarter: string; dueDate: string; people: string[]; roundId: string; status: CycleStatus;
  createdAt?: string; createdByName?: string; closedAt?: string; releasedAt?: string; releasedByName?: string;
}
export function readCycle(id: string, d: any): AppraisalCycle {
  return {
    id, name: String(d?.name || 'Appraisal'), quarter: String(d?.quarter || ''), dueDate: String(d?.dueDate || ''),
    people: Array.isArray(d?.people) ? d.people.filter((x: any) => typeof x === 'string') : [],
    roundId: String(d?.roundId || ''),
    status: d?.status === 'released' ? 'released' : d?.status === 'closed' ? 'closed' : 'open',
    createdAt: d?.createdAt, createdByName: d?.createdByName, closedAt: d?.closedAt, releasedAt: d?.releasedAt, releasedByName: d?.releasedByName,
  };
}

// The four sections everyone can comment on.
export type Section = 'kpi' | 'reliability' | 'skills' | 'values';
export const SECTIONS: Section[] = ['kpi', 'reliability', 'skills', 'values'];
export const SECTION_LABELS: Record<Section, string> = {
  kpi: 'Performance: KPI', reliability: 'Performance: reliability', skills: 'Competency: skills', values: 'Behavioural: HEART values',
};
export type SectionComments = Partial<Record<Section, string>>;
export function readSections(d: any): SectionComments {
  return Object.fromEntries(SECTIONS.filter(s => typeof d?.[s] === 'string' && d[s].trim()).map(s => [s, String(d[s])])) as SectionComments;
}
export const cleanSections = (c: SectionComments): SectionComments =>
  Object.fromEntries(SECTIONS.filter(s => (c[s] || '').trim()).map(s => [s, (c[s] as string).trim()])) as SectionComments;

export interface SelfReview {
  id: string; cycleId: string; memberId: string; quarter: string;
  skills: Record<string, number>; na: string[]; values: Record<string, number>; sections: SectionComments; sentAt?: string;
}
export const selfReviewId = (cycleId: string, memberId: string) => `${cycleId}_${memberId}`;
const validStars = (v: any) => Number.isInteger(v) && v >= 1 && v <= 5;
const starsMap = (m: any): Record<string, number> => Object.fromEntries(Object.entries(m || {}).filter(([, v]) => validStars(v))) as Record<string, number>;
export function readSelfReview(id: string, d: any): SelfReview {
  return {
    id, cycleId: String(d?.cycleId || ''), memberId: String(d?.memberId || ''), quarter: String(d?.quarter || ''),
    skills: starsMap(d?.skills), na: Array.isArray(d?.na) ? d.na.filter((x: any) => typeof x === 'string') : [],
    values: starsMap(d?.values), sections: readSections(d?.sections), sentAt: d?.sentAt,
  };
}
// Every skill (or "not applicable") and every value needs stars; comments are optional.
export function selfProblem(r: Pick<SelfReview, 'skills' | 'na' | 'values'>, skills: { id: string; name: string }[], values: { id: string; name: string }[]): string {
  for (const k of skills) if (!r.na.includes(k.id) && !validStars(r.skills[k.id])) return `Choose 1 to 5 stars for ${k.name}, or tick Not applicable.`;
  for (const v of values) if (!validStars(r.values[v.id])) return `Choose 1 to 5 stars for ${v.name}.`;
  return '';
}

// Comments are kept per section, plus the manager's overall comment.
export type CommentKey = Section | 'overall';
export const COMMENT_KEYS: CommentKey[] = [...SECTIONS, 'overall'];

// One comment in a released result (and on Management's scorecard).
export type CommentFrom = 'self' | 'manager' | 'teammate';
export interface ResultComment { from: CommentFrom; name: string; text: string }
export interface ResultRow { id: string; name: string; group?: string; self: number | null; manager: number | null; peers?: number | null }
export interface AppraisalResult {
  id: string; cycleId: string; memberId: string; name: string; quarter: string; level: string;
  weights: Record<string, number>; overall: number | null; parts: Record<string, number | null>;
  kpi: number | null; reliability: number | null;
  skills: ResultRow[]; values: ResultRow[];
  comments: Record<CommentKey, ResultComment[]>;
  releasedAt?: string;
}
export function readResult(id: string, d: any): AppraisalResult {
  const num = (v: any) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const rows = (l: any): ResultRow[] => (Array.isArray(l) ? l : []).filter((x: any) => x && typeof x.id === 'string').map((x: any) => ({
    id: x.id, name: String(x.name || ''), group: typeof x.group === 'string' ? x.group : undefined, self: num(x.self), manager: num(x.manager), peers: num(x.peers),
  }));
  const comments = Object.fromEntries(COMMENT_KEYS.map(s => [s, (Array.isArray(d?.comments?.[s]) ? d.comments[s] : [])
    .filter((c: any) => c && typeof c.text === 'string' && c.text.trim())
    .map((c: any) => ({ from: ['self', 'manager', 'teammate'].includes(c.from) ? c.from : 'teammate', name: String(c.name || ''), text: String(c.text) }))])) as Record<CommentKey, ResultComment[]>;
  return {
    id, cycleId: String(d?.cycleId || ''), memberId: String(d?.memberId || ''), name: String(d?.name || ''), quarter: String(d?.quarter || ''),
    level: String(d?.level || ''), weights: d?.weights || {}, overall: num(d?.overall),
    parts: { performance: num(d?.parts?.performance), competency: num(d?.parts?.competency), behavioural: num(d?.parts?.behavioural) },
    kpi: num(d?.kpi), reliability: num(d?.reliability), skills: rows(d?.skills), values: rows(d?.values), comments, releasedAt: d?.releasedAt,
  };
}
export const resultId = (cycleId: string, memberId: string) => `${cycleId}_${memberId}`;
