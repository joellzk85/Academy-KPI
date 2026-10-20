// Client links: expiry and tracking (push B, Joel 2026-10-19; every link kind since 2026-10-20). Pure logic, shared
// by the browser and the server (serverProposalLinks.ts, serverLinkVisits.ts), so no database code here.
// - The person who makes the link sets its expiry date (quick picks 7 / 14 / 30 days). It ends at 23:59 Malaysian time.
// - Each visit by the client is one record in proposal_views/{visitId}, written only by the server: when it started and
//   was last seen, device and browser, visible and active time, seconds per part, a reading heatmap (how long each
//   band of each part was on screen), where the mouse rested, clicks and taps, how far down they got, packages tried
//   (teambuilding) and "possible" screenshot / print / copy / download attempts. No IP addresses are stored.
//   The client is never told (Joel, 2026-10-20).
// - Only Management sees tracking, plus the people Management ticks (config/proposal_settings.allowedIds), and those
//   only on their own deals (Joel, 2026-10-20).

import type { DocLink } from './docLinks';

export const MY_OFFSET_MS = 8 * 3600_000;   // Malaysia is UTC+8 all year

// "2026-11-02" → the last moment of that day in Malaysia.
export function endOfDayMY(dateIso: string): number {
  const [y, m, d] = String(dateIso).split('-').map(Number);
  if (!y || !m || !d) return 0;
  return Date.UTC(y, m - 1, d, 23, 59, 59, 999) - MY_OFFSET_MS;
}

// Today in Malaysia plus n days, as "YYYY-MM-DD".
export function plusDaysMY(n: number, now = Date.now()): string {
  return new Date(now + MY_OFFSET_MS + n * 864e5).toISOString().slice(0, 10);
}

export function expiryDateMY(expiresAt?: number): string {
  return expiresAt ? new Date(expiresAt + MY_OFFSET_MS).toISOString().slice(0, 10) : '';
}

export const isExpired = (l: Pick<DocLink, 'expiresAt'>, now = Date.now()) => !!l.expiresAt && l.expiresAt < now;

// Whole days until it expires (0 = today), or null with no expiry.
export function daysLeft(l: Pick<DocLink, 'expiresAt'>, now = Date.now()): number | null {
  if (!l.expiresAt) return null;
  const a = Date.parse(plusDaysMY(0, now));
  const b = Date.parse(expiryDateMY(l.expiresAt));
  return Math.round((b - a) / 864e5);
}

export const MAX_EXPIRY_DAYS = 180;

// Why this expiry date can't be used, or ''.
export function expiryProblem(dateIso: string, now = Date.now()): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso || '')) return 'Choose when the link expires.';
  if (dateIso < plusDaysMY(0, now)) return 'The expiry date has already passed.';
  if (dateIso > plusDaysMY(MAX_EXPIRY_DAYS, now)) return `A link can be open for up to ${MAX_EXPIRY_DAYS} days.`;
  return '';
}

// ---------- Visits ----------
export type EventType = 'screenshot' | 'print' | 'copy' | 'rightclick' | 'save';
export const EVENT_LABELS: Record<EventType, string> = {
  screenshot: 'Possible screenshot attempt',
  print: 'Possible print attempt',
  copy: 'Possible copy attempt',
  rightclick: 'Right-click (possible save attempt)',
  save: 'Possible download attempt',
};
export interface VisitEvent { type: EventType; at: number; how?: string }
export interface Tap { s: string; x: number; y: number; at: number; touch?: boolean }

export type LinkKind = 'quotation' | 'outline' | 'teambuilding';

export interface ProposalView {
  id: string;           // visit id
  token: string;
  kind?: LinkKind;      // missing on teambuilding visits before 2026-10-20
  docId: string;
  dealId: string;
  ownerId?: string;     // the deal owner (may see it when Management ticks them); missing before 2026-10-20
  deviceId?: string;    // a random id kept in that browser: several = possibly forwarded
  startedAt: number;
  lastSeenAt: number;
  open?: boolean;       // the page is still open (false once the tab is hidden or closed)
  device: 'phone' | 'tablet' | 'laptop';
  browser: string;
  seconds: number;      // total time with the page visible
  active?: number;      // of which someone scrolled, moved the mouse, tapped or typed in the last 30 seconds
  sections: Record<string, number>;
  heat?: Record<string, number>;    // "<part>_<band>": seconds that band was on screen (BANDS bands per part)
  hover?: Record<string, number>;   // "<part>_<row>_<col>": seconds the mouse rested there (BANDS × COLS per part)
  taps?: Tap[];                     // clicks and taps
  depth?: number;       // how far down the page they got (0 to 1)
  picks?: Record<string, number>;   // teambuilding: "pkg:<name>" or "pax:<n>" → times chosen
  events: VisitEvent[];
}

// The parts of each document that are timed (data-track="<key>" on the page).
export const SECTION_KEYS = ['cover', 'objectives', 'trainers', 'agenda', 'activities', 'venues', 'packages', 'takeaways', 'hrdc', 'terms', 'accept'];
export const SECTION_NAMES: Record<string, string> = {
  cover: 'Cover', objectives: 'Objectives', trainers: 'Trainers', agenda: 'Agenda', activities: 'Activities', venues: 'Venues',
  packages: 'Packages', takeaways: 'Takeaways', hrdc: 'HRDC note', terms: 'Terms', accept: 'Accept',
};
export const QUOTE_KEYS = ['letterhead', 'client', 'details', 'items', 'total', 'remarks', 'terms', 'sign'];
export const QUOTE_NAMES: Record<string, string> = {
  letterhead: 'Letterhead', client: 'Client details', details: 'Venue, time, participants', items: 'Programme lines',
  total: 'Price and total', remarks: 'Remarks', terms: 'Terms', sign: 'Signatures',
};
const OUTLINE_PART: Record<string, string> = { cover: 'Cover', overview: 'Overview', modules: 'Course outline', agenda: 'Agenda', terms: 'Terms' };
const OUTLINE_KEY = /^(cover|overview|modules|agenda|terms)(-\d{1,2})?$/;

export function sectionOk(kind: LinkKind, key: string): boolean {
  if (kind === 'quotation') return QUOTE_KEYS.includes(key);
  if (kind === 'outline') return OUTLINE_KEY.test(key);
  return SECTION_KEYS.includes(key);
}

export function sectionName(kind: LinkKind | undefined, key: string): string {
  if (kind === 'quotation') return QUOTE_NAMES[key] || key;
  if (kind === 'outline') {
    const m = key.match(OUTLINE_KEY);
    if (!m) return key;
    const n = m[2] ? Number(m[2].slice(1)) : 0;
    return `${OUTLINE_PART[m[1]]}${n ? ` (page ${n + 1})` : ''}`;
  }
  return SECTION_NAMES[key] || key;
}

// Parts that are about money: "spent most of the time on pricing".
export const PRICE_KEYS: Record<LinkKind, string[]> = { quotation: ['items', 'total'], outline: [], teambuilding: ['packages'] };

export const BANDS = 20;     // reading heat: bands down each part
export const COLS = 10;      // mouse: columns across each part

export function deviceOf(ua: string, touchPoints: number, width: number): ProposalView['device'] {
  const u = ua || '';
  if (/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(u) || (/Macintosh/.test(u) && touchPoints > 1)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android.*Mobile|Windows Phone/i.test(u)) return 'phone';
  if (touchPoints > 1 && width < 768) return 'phone';
  return 'laptop';
}

export function browserOf(ua: string): string {
  const u = ua || '';
  if (/Edg\//.test(u)) return 'Edge';
  if (/OPR\/|Opera/.test(u)) return 'Opera';
  if (/SamsungBrowser/.test(u)) return 'Samsung Internet';
  if (/CriOS|Chrome\//.test(u)) return 'Chrome';
  if (/FxiOS|Firefox\//.test(u)) return 'Firefox';
  if (/Safari\//.test(u)) return 'Safari';
  return 'Other';
}

export interface VisitUpdate {
  visitId: string; deviceId: string; device: ProposalView['device']; browser: string;
  vis: number; act: number; add: Record<string, number>; heat: Record<string, number>; hover: Record<string, number>;
  taps: Tap[]; depth: number; picks: Record<string, number>; events: VisitEvent[]; end: boolean;
}

const secs = (v: any, max = 120) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
const frac = (v: any) => Math.max(0, Math.min(1, Math.round((Number(v) || 0) * 1000) / 1000));

// What the server accepts from the page (anything else is dropped). An update covers about 15 seconds, so no number
// is trusted above 2 minutes.
export function cleanVisitUpdate(b: any, kind: LinkKind = 'teambuilding'): VisitUpdate | null {
  const visitId = String(b?.visitId || '');
  if (!/^[a-z0-9]{10,40}$/.test(visitId)) return null;
  const deviceId = /^[a-z0-9]{10,40}$/.test(String(b?.deviceId || '')) ? String(b.deviceId) : '';
  const device = (['phone', 'tablet', 'laptop'] as const).includes(b?.device) ? b.device : 'laptop';
  const browser = String(b?.browser || 'Other').slice(0, 30);
  const add: Record<string, number> = {};
  for (const [k, v] of Object.entries(b?.add || {}).slice(0, 60)) {
    if (!sectionOk(kind, k)) continue;
    const n = secs(v);
    if (n > 0) add[k] = n;
  }
  // "<part>_<band>" (heat) and "<part>_<row>_<col>" (mouse).
  const grid = (src: any, cells: number, limit: number) => {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(src || {}).slice(0, limit)) {
      const parts = k.split('_');
      if (parts.length !== cells + 1 || !sectionOk(kind, parts[0])) continue;
      const nums = parts.slice(1).map(Number);
      if (!Number.isInteger(nums[0]) || nums[0] < 0 || nums[0] >= BANDS) continue;
      if (cells === 2 && (!Number.isInteger(nums[1]) || nums[1] < 0 || nums[1] >= COLS)) continue;
      const n = secs(v);
      if (n > 0) out[k] = n;
    }
    return out;
  };
  const heat = grid(b?.heat, 1, 800);
  const hover = grid(b?.hover, 2, 400);
  const taps: Tap[] = (Array.isArray(b?.taps) ? b.taps : []).slice(0, 50)
    .filter((t: any) => t && sectionOk(kind, String(t.s || '')))
    .map((t: any) => ({ s: String(t.s), x: frac(t.x), y: frac(t.y), at: Math.round(Number(t.at) || Date.now()), ...(t.touch ? { touch: true } : {}) }));
  const picks: Record<string, number> = {};
  if (kind === 'teambuilding') {
    for (const [k, v] of Object.entries(b?.picks || {}).slice(0, 20)) {
      if (!/^(pkg:[^.~*/[\]]{1,60}|pax:\d{1,4})$/.test(k)) continue;
      const n = secs(v, 50);
      if (n > 0) picks[k] = n;
    }
  }
  const events: VisitEvent[] = (Array.isArray(b?.events) ? b.events : []).slice(0, 30)
    .filter((e: any) => e && Object.keys(EVENT_LABELS).includes(e.type))
    .map((e: any) => ({ type: e.type, at: Math.round(Number(e.at) || Date.now()), ...(e.how ? { how: String(e.how).slice(0, 40) } : {}) }));
  // Pages opened before 2026-10-20 send only seconds per part: count those as the visible time.
  const fromParts = Object.values(add).reduce((t, n) => t + n, 0);
  const vis = b?.vis === undefined ? Math.min(120, fromParts) : secs(b.vis);
  const act = Math.min(vis, b?.act === undefined ? vis : secs(b.act));
  return { visitId, deviceId, device, browser, vis, act, add, heat, hover, taps, depth: frac(b?.depth), picks, events, end: !!b?.end };
}

// Adds one update onto a stored visit (the server's part, kept here so it can be tested).
export function mergeVisit(v: any, u: VisitUpdate, now: number) {
  const addMap = (a: Record<string, number> | undefined, b: Record<string, number>, maxKeys: number) => {
    const out: Record<string, number> = { ...(a || {}) };
    let n = Object.keys(out).length;
    Object.entries(b).forEach(([k, x]) => {
      if (k in out) out[k] += x;
      else if (n < maxKeys) { out[k] = x; n++; }
    });
    return out;
  };
  return {
    seconds: (v?.seconds || 0) + u.vis,
    active: (v?.active ?? v?.seconds ?? 0) + u.act,
    sections: addMap(v?.sections, u.add, 100),
    heat: addMap(v?.heat, u.heat, 2000),
    hover: addMap(v?.hover, u.hover, 3000),
    taps: [...(v?.taps || []), ...u.taps].slice(-300),
    picks: addMap(v?.picks, u.picks, 40),
    depth: Math.max(v?.depth || 0, u.depth),
    events: [...(v?.events || []), ...u.events].slice(-200),
    lastSeenAt: now,
    open: !u.end,
  };
}

// ---------- Summaries for the CRM ----------
export const READING_NOW_MS = 45_000;
export const readingNow = (v: Pick<ProposalView, 'open' | 'lastSeenAt'>, now = Date.now()) => v.open !== false && now - (v.lastSeenAt || 0) < READING_NOW_MS;

export type Heat = 'hot' | 'warm' | 'cold';
export const HEAT_LABEL: Record<Heat, string> = { hot: 'Hot', warm: 'Warm', cold: 'Cold' };

export interface TrackingSummary {
  visits: number;
  seconds: number;
  active: number;
  idle: number;
  last: number;
  first: number;
  devices: number;           // different browsers or devices (several = possibly forwarded)
  readingNow: boolean;
  sections: { key: string; seconds: number }[];
  depth: number;             // furthest down, 0 to 1
  reachedEnd: boolean;
  stoppedAt: string;         // the last part they reached, when they didn't reach the end
  priceShare: number;        // share of time on price parts (0 to 1)
  priceFocus: boolean;
  picks: { label: string; times: number }[];
  events: (VisitEvent & { visitId: string })[];
  score: number;
  heat: Heat;
}

// The order the parts appear in, for "stopped at".
function inOrder(kind: LinkKind, keys: string[]): string[] {
  if (kind === 'quotation') return QUOTE_KEYS.filter(k => keys.includes(k));
  if (kind === 'outline') {
    const rank = (k: string) => {
      const m = k.match(OUTLINE_KEY);
      return m ? Object.keys(OUTLINE_PART).indexOf(m[1]) * 100 + (m[2] ? Number(m[2].slice(1)) : 0) : 9999;
    };
    return [...keys].sort((a, b) => rank(a) - rank(b));
  }
  return SECTION_KEYS.filter(k => keys.includes(k));
}

export function summarise(views: ProposalView[], kind?: LinkKind, now = Date.now()): TrackingSummary {
  const k: LinkKind = kind || views.find(v => v.kind)?.kind || 'teambuilding';
  const parts: Record<string, number> = {};
  views.forEach(v => Object.entries(v.sections || {}).forEach(([key, n]) => { parts[key] = (parts[key] || 0) + (Number(n) || 0); }));
  const seconds = views.reduce((t, v) => t + (Number(v.seconds) || 0), 0);
  const active = views.reduce((t, v) => t + (v.active === undefined ? Number(v.seconds) || 0 : Number(v.active) || 0), 0);
  const devices = new Set(views.map(v => v.deviceId || `${v.device}|${v.browser}`)).size;
  const depth = Math.max(0, ...views.map(v => v.depth || 0));
  const seen = inOrder(k, Object.keys(parts));
  const lastPart = seen[seen.length - 1] || '';
  const reachedEnd = depth >= 0.95;
  const partTotal = Object.values(parts).reduce((t, n) => t + n, 0);
  const priceSec = PRICE_KEYS[k].reduce((t, key) => t + (parts[key] || 0), 0);
  const priceShare = partTotal ? priceSec / partTotal : 0;
  const picks: Record<string, number> = {};
  views.forEach(v => Object.entries(v.picks || {}).forEach(([key, n]) => { picks[key] = (picks[key] || 0) + n; }));
  const last = Math.max(0, ...views.map(v => v.lastSeenAt || v.startedAt || 0));
  const score = scoreOf({ visits: views.length, active, devices, last, reachedEnd, priceShare }, now);
  return {
    visits: views.length, seconds, active, idle: Math.max(0, seconds - active), last,
    first: views.length ? Math.min(...views.map(v => v.startedAt || Infinity)) : 0,
    devices, readingNow: views.some(v => readingNow(v, now)),
    sections: Object.keys(parts).map(key => ({ key, seconds: parts[key] })),
    depth, reachedEnd, stoppedAt: reachedEnd || !lastPart ? '' : sectionName(k, lastPart),
    priceShare, priceFocus: priceShare >= 0.4 && priceSec >= 20,
    picks: Object.entries(picks).map(([key, times]) => ({ label: key.startsWith('pax:') ? `${key.slice(4)} pax` : key.slice(4), times })).sort((a, b) => b.times - a.times),
    events: views.flatMap(v => (v.events || []).map(e => ({ ...e, visitId: v.id }))).sort((a, b) => b.at - a.at),
    score, heat: score >= 60 ? 'hot' : score >= 30 ? 'warm' : 'cold',
  };
}

// Hot / Warm / Cold (0 to 100): opens, real reading time, several devices, how recent, read to the end, price focus.
export function scoreOf(s: { visits: number; active: number; devices: number; last: number; reachedEnd: boolean; priceShare: number }, now = Date.now()): number {
  if (!s.visits) return 0;
  const days = (now - s.last) / 864e5;
  let pts = Math.min(25, s.visits * 8);
  pts += Math.min(25, Math.floor(s.active / 60) * 5);
  if (s.devices > 1) pts += 15;
  pts += days <= 3 ? 15 : days <= 7 ? 8 : 0;
  if (s.reachedEnd) pts += 10;
  if (s.priceShare >= 0.4) pts += 10;
  return Math.min(100, pts);
}

export function durationText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds || 0));
  if (s < 60) return `${s} sec`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min${s % 60 >= 30 && m < 10 ? ' 30 sec' : ''}`;
  return `${Math.floor(m / 60)} hr ${m % 60} min`;
}

export function agoText(at: number, now = Date.now()): string {
  if (!at) return '';
  const m = Math.round((now - at) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

// ---------- Who sees tracking (Joel, 2026-10-20) ----------
// Management always, for every link. Anyone Management ticks (allowedIds) only for links on their own deals.
// The database rule for proposal_views says the same.
export interface ProposalSettings { allowedIds: string[] }
export const DEFAULT_PROPOSAL_SETTINGS: ProposalSettings = { allowedIds: [] };
type Who = { id: string; role: string };
export type TrackingAccess = 'all' | 'own' | 'none';
export function trackingAccess(viewer: Who | null | undefined, s: ProposalSettings | null | undefined): TrackingAccess {
  if (!viewer?.id) return 'none';
  if (viewer.role === 'management') return 'all';
  return (s?.allowedIds || []).includes(viewer.id) ? 'own' : 'none';
}
export const canSeeTracking = (viewer: Who | null | undefined, s: ProposalSettings | null | undefined) => trackingAccess(viewer, s) !== 'none';
// The person whose deal the link is on.
export const linkOwnerId = (l: { ownerId?: string; byId?: string }) => l.ownerId || l.byId || '';
export function seesLink(viewer: Who | null | undefined, s: ProposalSettings | null | undefined, l: { ownerId?: string; byId?: string }): boolean {
  const a = trackingAccess(viewer, s);
  return a === 'all' || (a === 'own' && linkOwnerId(l) === viewer!.id);
}
