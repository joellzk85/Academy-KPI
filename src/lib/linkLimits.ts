// Time and open limits on every client link: quotations, course outlines and teambuilding proposals (Joel,
// 2026-10-19: "all links to customers should have time limit control"). Pure logic, shared by the browser and the
// server, so no database code here.
// - Whoever makes the link (rep, Admin, Management) sets how long it works and how many times it can be opened.
//   Defaults come from config/link_settings (Management changes them; first set at 5 days and 10 opens).
// - A refresh by the same visitor within 30 minutes counts once. The team's own opens never count.
// - Once the time or the opens run out, the client sees "expired" and can ask for access again. The link never
//   reopens by itself: the rep, Admin or Management gives it new limits (Change limits / Reopen).

import type { DocLink } from './docLinks';
import { daysLeft, expiryDateMY, isExpired, plusDaysMY } from './proposalTracking';

export interface LinkSettings { days: number; opens: number }
export const DEFAULT_LINK_SETTINGS: LinkSettings = { days: 5, opens: 10 };
export const MAX_OPENS = 500;
export const REPEAT_WINDOW_MS = 30 * 60_000;

const int = (v: any, min: number, max: number, dflt: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : dflt;
};

export function readLinkSettings(d: any): LinkSettings {
  return { days: int(d?.days, 1, 180, DEFAULT_LINK_SETTINGS.days), opens: int(d?.opens, 1, MAX_OPENS, DEFAULT_LINK_SETTINGS.opens) };
}

export function opensProblem(v: any): string {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) return 'Allow at least 1 open.';
  if (n > MAX_OPENS) return `Up to ${MAX_OPENS} opens.`;
  return '';
}

export const opensLeft = (l: Pick<DocLink, 'maxOpens' | 'views'>) =>
  l.maxOpens ? Math.max(0, l.maxOpens - (l.views || 0)) : null;

export type LinkState = 'active' | 'expired' | 'limit' | 'stopped';
export function linkState(l: Pick<DocLink, 'status' | 'expiresAt' | 'maxOpens' | 'views'>, now = Date.now()): LinkState {
  if (l.status !== 'open') return 'stopped';
  if (isExpired(l, now)) return 'expired';
  if (l.maxOpens && (l.views || 0) >= l.maxOpens) return 'limit';
  return 'active';
}
export const LINK_STATE_LABEL: Record<LinkState, string> = {
  active: 'Active', expired: 'Expired', limit: 'Open limit reached', stopped: 'Stopped',
};

// "Works until 24 Oct 2026 (3 days left)". `fmt` formats a YYYY-MM-DD date.
export function untilText(l: Pick<DocLink, 'expiresAt'>, fmt: (d: string) => string, now = Date.now()): string {
  if (!l.expiresAt) return 'No time limit yet (the standard limit starts the next time it is opened)';
  const left = daysLeft(l, now);
  if (isExpired(l, now)) return `Expired on ${fmt(expiryDateMY(l.expiresAt))}`;
  return `Works until ${fmt(expiryDateMY(l.expiresAt))}${left === 0 ? ' (today)' : left !== null && left <= 3 ? ` (${left} day${left === 1 ? '' : 's'} left)` : ''}`;
}

// The default expiry date for a new link: today plus the default days.
export const defaultExpiry = (s: LinkSettings, now = Date.now()) => plusDaysMY(s.days, now);
