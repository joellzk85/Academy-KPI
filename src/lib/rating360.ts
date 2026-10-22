// 360 rating (Joel, 2026-10-22; KPI Part C). People rate each other 1-5 and MUST say why.
// - rating_rounds/{id}: a round Management opens: { name, month 'YYYY-MM' (the KPI month it counts in), mode, people,
//   pairs, view, dueDate, status open/closed, createdAt, createdById, createdByName, closedAt }.
//   mode 'all': everyone in `people` rates everyone else in it. mode 'picked': only the rater → person pairs Management chose.
//   view 'closed': people see their ratings and comments without names; 'open': with who gave them. Management always
//   sees who rated whom (Joel: "management can see - optional to allow others to see who rate who").
// - ratings_360/{roundId}_{raterId}_{rateeId}: { roundId, raterId, raterName, rateeId, items, comments, comment, at }.
//   Readable only by the rater and Management (database rules). The person rated gets theirs from the server
//   (serverKpi.ts), and only once the round is closed, so they can't work out who rated them from the timing.
// - Attitude items (Joel, 2026-10-22; appraisal Part B): each rater scores every active item 1-5 for each person
//   (items: { itemId: stars }). A comment is needed only for an item scored 1 or 2 (comments: { itemId: text },
//   at least MIN_COMMENT characters); `comment` is an optional general remark. Management keeps the item list in
//   config/rating_items: { items: [{ id, name, active, order }] } (add, rename, turn off, reorder; never deleted,
//   so old ratings keep their names). Ratings from before items have one `stars` and a required `comment`; they
//   stay readable and count in the overall average (ratingOverall).
// - Result per person per month (summarise): average per item, and overall = the average of each rating's own
//   average. Shown on the appraisal (components/Appraisal.tsx), separate from the KPI score.
// - The old "360 rating" KPI (lib/kpiLibrary.ts) is hidden and left out of the appraisal; it uses the overall.

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
export interface Rating360 {
  id: string; roundId: string; raterId: string; raterName: string; rateeId: string;
  stars?: number;                       // ratings from before attitude items
  items?: Record<string, number>;       // itemId → 1-5
  comments?: Record<string, string>;    // itemId → why (items scored 1 or 2)
  comment: string; at: string;
}

export interface RatingItem { id: string; name: string; active: boolean; order: number }
export const DEFAULT_RATING_ITEMS: RatingItem[] = [
  { id: 'teamwork', name: 'Teamwork', active: true, order: 1 },
  { id: 'leadership', name: 'Leadership', active: true, order: 2 },
  { id: 'communication', name: 'Communication', active: true, order: 3 },
];

export function readRatingItems(d: any): RatingItem[] {
  const list: RatingItem[] = (Array.isArray(d?.items) ? d.items : [])
    .filter((x: any) => x && typeof x.id === 'string' && x.id && typeof x.name === 'string' && x.name.trim())
    .map((x: any, i: number) => ({ id: x.id, name: x.name.trim(), active: x.active !== false, order: Number.isFinite(x.order) ? x.order : i + 1 }));
  return (list.length ? list : DEFAULT_RATING_ITEMS).slice().sort((a, b) => a.order - b.order);
}
export const activeItems = (items: RatingItem[]) => items.filter(i => i.active);
export const newItemId = () => `item_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

const validStars = (v: any) => Number.isInteger(v) && v >= 1 && v <= 5;
// A rating's stars per item (none for ratings from before items).
export function itemStars(r: Pick<Rating360, 'items'>): Record<string, number> {
  return Object.fromEntries(Object.entries(r.items || {}).filter(([, v]) => validStars(v)));
}
// A rating's own average: its items, or the single `stars` of an older rating. null when nothing valid.
export function ratingOverall(r: Pick<Rating360, 'items' | 'stars'>): number | null {
  const v = Object.values(itemStars(r));
  if (v.length) return v.reduce((a, b) => a + b, 0) / v.length;
  return validStars(r.stars) ? (r.stars as number) : null;
}

export interface AttitudeSummary { items: Record<string, { avg: number; count: number }>; overall: { avg: number; count: number } | null }
const round2 = (n: number) => Math.round(n * 100) / 100;
export function summarise(ratings: Pick<Rating360, 'items' | 'stars'>[]): AttitudeSummary {
  const sums: Record<string, { t: number; n: number }> = {};
  let t = 0, n = 0;
  ratings.forEach(r => {
    Object.entries(itemStars(r)).forEach(([id, v]) => { const s = (sums[id] ||= { t: 0, n: 0 }); s.t += v; s.n += 1; });
    const o = ratingOverall(r);
    if (o !== null) { t += o; n += 1; }
  });
  return {
    items: Object.fromEntries(Object.entries(sums).map(([id, s]) => [id, { avg: round2(s.t / s.n), count: s.n }])),
    overall: n ? { avg: round2(t / n), count: n } : null,
  };
}

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

// A low score (1 or 2) on an item needs a reason; higher scores don't.
export const needsComment = (stars: number) => stars >= 1 && stars <= 2;
export function itemProblem(item: RatingItem, stars: number, comment: string): string {
  if (!validStars(stars)) return `Choose 1 to 5 stars for ${item.name}.`;
  if (needsComment(stars) && comment.trim().length < MIN_COMMENT) return `${item.name}: say why you gave ${stars} star${stars > 1 ? 's' : ''} (at least ${MIN_COMMENT} characters).`;
  return '';
}

export const STAR_WORDS = ['', 'Poor', 'Below expectations', 'Meets expectations', 'Good', 'Excellent'];
