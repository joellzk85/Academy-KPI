// Logins and sensitive actions (Joel, 2026-10-24). Pure logic, shared by the browser (Team → Login log) and the server
// (serverActivity.ts), so no database code here. Never shown or mentioned to staff (Joel, 2026-10-24).
// - login_sessions/{sessionId}, written only by the server: each password login, each time the CRM is opened with a
//   saved login, and each wrong password. IP address, rough place from the IP (town, not an exact spot), device,
//   browser, system, active minutes and first / last time, and warning flags.
// - activity_log/{id}, written only by the server: downloads of backups and files, deletes, password and team changes.
// - login_live/{memberId} and login_devices/{memberId}, server only: who is online now (for "two places at once"), and
//   the devices and places each person has used before (for "new device" and "new place").
// Only Management reads them.

export type SessionKind = 'login' | 'open' | 'fail';
export type SessionFlag = 'new_device' | 'new_place' | 'after_hours' | 'shared' | 'many_fails';

export interface LoginSession {
  id: string;
  memberId: string;
  kind: SessionKind;
  at: number;            // started (ms)
  lastAt: number;        // last active minute (ms)
  minutes: number;       // active minutes in this session
  ip: string;
  city?: string; region?: string; country?: string; isp?: string;
  device: string;        // laptop | phone | tablet
  browser: string;
  os: string;
  deviceId: string;
  flags: SessionFlag[];
  sharedWith?: { ip: string; city?: string; device?: string };
}

export interface ActivityEntry {
  id: string;
  memberId: string;
  at: number;
  kind: ActivityKind;
  what: string;          // plain words, e.g. "Deal" or "Excel backup (whole CRM)"
  path?: string;         // the record, for deletes
  ip?: string;
  city?: string;
}

export type ActivityKind = 'download' | 'delete' | 'soft_delete' | 'password' | 'team';
export const ACTIVITY_KINDS: ActivityKind[] = ['download', 'delete', 'soft_delete', 'password', 'team'];

export const KIND_LABELS: Record<SessionKind, string> = { login: 'Logged in', open: 'Opened the CRM', fail: 'Wrong password' };

export const FLAG_LABELS: Record<SessionFlag, string> = {
  new_device: 'New device', new_place: 'New place', after_hours: 'After hours', shared: 'Two places at once', many_fails: 'Many wrong passwords',
};
export const FLAG_HELP: Record<SessionFlag, string> = {
  new_device: 'First time this person used the CRM on this device or browser.',
  new_place: 'First time this person used the CRM from this town.',
  after_hours: 'Outside working hours, or on a day off (Rules).',
  shared: 'Used at the same time on another device from another internet connection. It may be their own phone on mobile data.',
  many_fails: '3 or more wrong passwords within 10 minutes.',
};

export const ACTIVITY_LABELS: Record<ActivityKind, string> = {
  download: 'Download', delete: 'Deleted forever', soft_delete: 'Deleted (restorable)', password: 'Password', team: 'Team change',
};

// Records named in plain words (deletes). Others show as "Other record (name)".
const RECORD_LABELS: Record<string, string> = {
  pipelines: 'Deal', quotations: 'Quotation', course_outlines: 'Course outline', teambuilding_proposals: 'Teambuilding proposal',
  clients: 'Client', trainers_directory: 'Trainer', venues_directory: 'Venue', appointments: 'Appointment', tasks: 'To-do task',
  money_out: 'Payment request', money_in: 'Money in', payment_records: 'Payment record', project_pl: 'Project P&L', vendors: 'Vendor',
  programmes: 'Programme', proposal_files: 'Proposal file', checklist_files: 'Checklist file', payment_receipts: 'Payment receipt',
  hrdc_queries: 'HRDC query', cost_estimates: 'Costing estimate', reliability_excused: 'Day out of office', tb_activities: 'Teambuilding activity',
  reliability_incidents: 'Reliability incident', training_reports: 'Training report', deal_checklists: 'Deal checklist', claim_backs: 'Claim back',
  trainer_private: 'Trainer personal details', doc_links: 'Client link', ratings_360: '360 rating', appraisal_notes: 'Appraisal note',
  month_kpis: 'Month KPIs', events: 'Calendar event', trainer_docs: 'Trainer document',
};
export const recordLabel = (path: string) => {
  const coll = String(path || '').split('/')[0];
  return RECORD_LABELS[coll] || `Other record (${coll || 'unknown'})`;
};

export function osOf(ua: string): string {
  const u = ua || '';
  if (/iPhone|iPod/.test(u)) return 'iPhone';
  if (/iPad/.test(u)) return 'iPad';
  if (/Android/.test(u)) return 'Android';
  if (/CrOS/.test(u)) return 'ChromeOS';
  if (/Windows/.test(u)) return 'Windows';
  if (/Macintosh|Mac OS X/.test(u)) return 'Mac';
  if (/Linux/.test(u)) return 'Linux';
  return 'Other';
}

export const DEVICE_LABELS: Record<string, string> = { laptop: 'Computer', phone: 'Phone', tablet: 'Tablet' };

/** "Computer · Windows · Chrome" */
export const deviceLine = (s: { device?: string; os?: string; browser?: string }) =>
  [DEVICE_LABELS[s.device || ''] || 'Device', s.os, s.browser].filter(Boolean).join(' · ');

/** "Petaling Jaya, MY" (or "" when not known). */
export const placeLine = (s: { city?: string; region?: string; country?: string }) =>
  [s.city || s.region, s.country].filter(Boolean).join(', ');

// ---------- Working hours (config/login_rules: workStart, workEnd in minutes after midnight; workDays) ----------
export interface WorkHours { workDays: number[]; workStart: number; workEnd: number }
export const DEFAULT_WORK_START = 7 * 60;    // 7:00 am
export const DEFAULT_WORK_END = 22 * 60;     // 10:00 pm

/** Malaysia time (UTC+8, no daylight saving): the day of the week and minutes after midnight. */
export function myTime(ms: number): { day: number; minutes: number } {
  const d = new Date(ms + 8 * 3600_000);
  return { day: d.getUTCDay(), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

/** After hours: a day off, or before the start / after the end of the working day (Malaysia time). */
export function isAfterHours(ms: number, h: WorkHours): boolean {
  const { day, minutes } = myTime(ms);
  if (!h.workDays.includes(day)) return true;
  return minutes < h.workStart || minutes >= h.workEnd;
}

export const clockOf = (minutes: number) => {
  const h = Math.floor(minutes / 60) % 24, m = minutes % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};

export const SAFE_ID = /^[a-z0-9]{10,40}$/;
