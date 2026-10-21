// 360 rating (Joel, 2026-10-22; KPI Part C). People rate each other 1-5 and MUST say why.
// - rating_rounds/{id}: a round Management opens: { name, month 'YYYY-MM' (the KPI month it counts in), mode, people,
//   pairs, view, dueDate, status open/closed, createdAt, createdById, createdByName, closedAt }.
//   mode 'all': everyone in `people` rates everyone else in it. mode 'picked': only the rater → person pairs Management chose.
//   view 'closed': people see their ratings and comments without names; 'open': with who gave them. Management always
//   sees who rated whom (Joel: "management can see - optional to allow others to see who rate who").
// - ratings_360/{roundId}_{raterId}_{rateeId}: { roundId, raterId, raterName, rateeId, stars, comment, at }.
//   Readable only by the rater and Management (database rules). The person rated gets theirs from the server
//   (serverKpi.ts), and only once the round is closed, so they can't work out who rated them from the timing.
// - The "360 rating" KPI (lib/kpiLibrary.ts) is the average stars received in closed rounds of that month.

export type RoundMode = 'all' | 'picked';
export type RoundView = 'open' | 'closed';
export interface RatingPair { raterId: string; rateeId: string }
export interface RatingRound {
  id: string;
  name: string;
  month: string;
  mode: RoundMode;
  people: string[];
  pairs: RatingPair[];
  view: RoundView;
  dueDate?: string;
  status: 'open' | 'closed';
  createdAt?: string; createdById?: string; createdByName?: string; closedAt?: string;
}
export interface Rating360 { id: string; roundId: string; raterId: string; raterName: string; rateeId: string; stars: number; comment: string; at: string }

export const MIN_COMMENT = 20;
export const ratingId = (roundId: string, raterId: string, rateeId: string) => `${roundId}_${raterId}_${rateeId}`;

export function readRound(id: string, d: any): RatingRound {
  return {
    id,
    name: String(d?.name || 'Rating round'),
    month: typeof d?.month === 'string' ? d.month : '',
    mode: d?.mode === 'picked' ? 'picked' : 'all',
    people: Array.isArray(d?.people) ? d.people.filter((x: any) => typeof x === 'string') : [],
    pairs: Array.isArray(d?.pairs) ? d.pairs.filter((p: any) => p && typeof p.raterId === 'string' && typeof p.rateeId === 'string') : [],
    view: d?.view === 'open' ? 'open' : 'closed',
    dueDate: typeof d?.dueDate === 'string' ? d.dueDate : '',
    status: d?.status === 'closed' ? 'closed' : 'open',
    createdAt: d?.createdAt, createdById: d?.createdById, createdByName: d?.createdByName, closedAt: d?.closedAt,
  };
}

// Every rater → person pair of a round.
export function roundPairs(r: RatingRound): RatingPair[] {
  if (r.mode === 'picked') return r.pairs.filter(p => p.raterId !== p.rateeId);
  const out: RatingPair[] = [];
  r.people.forEach(raterId => r.people.forEach(rateeId => { if (raterId !== rateeId) out.push({ raterId, rateeId }); }));
  return out;
}

// The people this person has to rate in a round.
export const toRate = (r: RatingRound, raterId: string): string[] => roundPairs(r).filter(p => p.raterId === raterId).map(p => p.rateeId);

export function commentProblem(text: string): string {
  const t = text.trim();
  if (t.length < MIN_COMMENT) return `Say why you gave this rating (at least ${MIN_COMMENT} characters).`;
  return '';
}

export const STAR_WORDS = ['', 'Poor', 'Below expectations', 'Meets expectations', 'Good', 'Excellent'];
