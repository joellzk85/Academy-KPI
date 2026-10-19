// Teambuilding proposal links: expiry and tracking (push B, Joel 2026-10-19). Pure logic, shared by the browser and
// the server (serverProposalLinks.ts), so no database code here.
// - The person who makes the link sets its expiry date (quick picks 7 / 14 / 30 days). It ends at 23:59 Malaysian time.
// - Each visit by the client is one record in proposal_views/{visitId}, written only by the server: when it started and
//   was last seen, device and browser, seconds per section (only while the tab is visible), and "possible" screenshot,
//   print, copy and right-click attempts. No IP addresses are stored. The client is never told.
// - Management decides whether reps see tracking (config/proposal_settings.repsSeeTracking, default off).
//   Admin and Management always see it.

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
export type EventType = 'screenshot' | 'print' | 'copy' | 'rightclick';
export const EVENT_LABELS: Record<EventType, string> = {
  screenshot: 'Possible screenshot attempt',
  print: 'Possible print attempt',
  copy: 'Possible copy attempt',
  rightclick: 'Right-click (possible save attempt)',
};
export interface VisitEvent { type: EventType; at: number; how?: string }

export interface ProposalView {
  id: string;           // visit id
  token: string;
  docId: string;
  dealId: string;
  startedAt: number;
  lastSeenAt: number;
  device: 'phone' | 'tablet' | 'laptop';
  browser: string;
  seconds: number;      // total time with the page visible
  sections: Record<string, number>;
  events: VisitEvent[];
}

export const SECTION_KEYS = ['cover', 'objectives', 'trainers', 'agenda', 'activities', 'venues', 'packages', 'takeaways', 'hrdc', 'terms', 'accept'];
export const SECTION_NAMES: Record<string, string> = {
  cover: 'Cover', objectives: 'Objectives', trainers: 'Trainers', agenda: 'Agenda', activities: 'Activities', venues: 'Venues',
  packages: 'Packages', takeaways: 'Takeaways', hrdc: 'HRDC note', terms: 'Terms', accept: 'Accept',
};

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

// What the server accepts from the page (anything else is dropped).
export function cleanVisitUpdate(b: any): { visitId: string; device: ProposalView['device']; browser: string; add: Record<string, number>; events: VisitEvent[] } | null {
  const visitId = String(b?.visitId || '');
  if (!/^[a-z0-9]{10,40}$/.test(visitId)) return null;
  const device = (['phone', 'tablet', 'laptop'] as const).includes(b?.device) ? b.device : 'laptop';
  const browser = String(b?.browser || 'Other').slice(0, 30);
  const add: Record<string, number> = {};
  for (const [k, v] of Object.entries(b?.add || {})) {
    if (!SECTION_KEYS.includes(k)) continue;
    const n = Math.round(Number(v) || 0);
    if (n > 0) add[k] = Math.min(n, 120);   // an update covers ~15 seconds; never trust more than 2 minutes
  }
  const events: VisitEvent[] = (Array.isArray(b?.events) ? b.events : []).slice(0, 30)
    .filter((e: any) => e && Object.keys(EVENT_LABELS).includes(e.type))
    .map((e: any) => ({ type: e.type, at: Math.round(Number(e.at) || Date.now()), ...(e.how ? { how: String(e.how).slice(0, 40) } : {}) }));
  return { visitId, device, browser, add, events };
}

// ---------- Summaries for the CRM ----------
export interface TrackingSummary {
  visits: number;
  seconds: number;
  last: number;
  first: number;
  sections: { key: string; seconds: number }[];
  events: (VisitEvent & { visitId: string })[];
}

export function summarise(views: ProposalView[]): TrackingSummary {
  const sec: Record<string, number> = {};
  views.forEach(v => Object.entries(v.sections || {}).forEach(([k, n]) => { sec[k] = (sec[k] || 0) + (Number(n) || 0); }));
  return {
    visits: views.length,
    seconds: views.reduce((t, v) => t + (Number(v.seconds) || 0), 0),
    last: Math.max(0, ...views.map(v => v.lastSeenAt || v.startedAt || 0)),
    first: views.length ? Math.min(...views.map(v => v.startedAt || Infinity)) : 0,
    sections: SECTION_KEYS.filter(k => sec[k]).map(k => ({ key: k, seconds: sec[k] })),
    events: views.flatMap(v => (v.events || []).map(e => ({ ...e, visitId: v.id }))).sort((a, b) => b.at - a.at),
  };
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

// ---------- Who sees tracking ----------
export interface ProposalSettings { repsSeeTracking: boolean }
export const DEFAULT_PROPOSAL_SETTINGS: ProposalSettings = { repsSeeTracking: false };
export const canSeeTracking = (role: string, s: ProposalSettings | null | undefined) => role !== 'rep' || !!s?.repsSeeTracking;
