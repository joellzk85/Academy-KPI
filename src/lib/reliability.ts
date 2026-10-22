// Reliability (Joel, 2026-10-22; appraisal Part C). Read from the Login log (lib/loginActivity.ts): no new tracking.
// - We work flexi time, so the time of day someone starts is never scored. Each past working day (the Login log's
//   working days) gets its light from that day's counted CRM minutes (dayLight on useLoginData's countedOf, the same
//   minutes the Login log's lights use; online with no work counts 0): green, amber or red; no time at all = red.
// - Excused days are left out of the count: reliability_excused/{memberId}_{YYYY-MM-DD}: { memberId, date, reason,
//   note, byId, byName, at }. Admin and Management mark them (Admin work → Days out; the appraisal). Reasons below.
// - Incidents: reliability_incidents/{id}: { memberId, date, kind, note, byId, byName, at }. Management only.
// - Monthly score 1-5: the share of counted (not excused) working days that are green or amber picks a starting
//   score from the bands, then each incident takes off `incidentDeduction`, never below `minScore`.
//   Settings in config/reliability (Management only), with the defaults below.
// - Only Management sees the detail (the appraisal). Staff-facing screens say "days out of office", nothing more.

import { addDays, dayKey, dayLight, LoginRules, parseDay } from './loginActivity';

export type ExcuseReason = 'client_visit' | 'training' | 'leave' | 'mc' | 'public_holiday' | 'other';
export const EXCUSE_LABELS: Record<ExcuseReason, string> = {
  client_visit: 'Client visit', training: 'Training / event', leave: 'Leave', mc: 'MC', public_holiday: 'Public holiday', other: 'Other',
};
export interface ExcusedDay { id: string; memberId: string; date: string; reason: ExcuseReason; note: string; byId?: string; byName?: string; at?: string }

export type IncidentKind = 'late_commitment' | 'unreachable' | 'missed_deadline';
export const INCIDENT_LABELS: Record<IncidentKind, string> = {
  late_commitment: 'Late for a fixed commitment', unreachable: 'Unreachable without notice', missed_deadline: 'Missed deadline',
};
export interface Incident { id: string; memberId: string; date: string; kind: IncidentKind; note: string; byId?: string; byName?: string; at?: string }

// Starting score by the % of counted days that are green or amber: at or above s5 → 5, s4 → 4, s3 → 3, s2 → 2, else 1.
export interface ReliabilitySettings { s5: number; s4: number; s3: number; s2: number; incidentDeduction: number; minScore: number }
export const DEFAULT_RELIABILITY: ReliabilitySettings = { s5: 95, s4: 85, s3: 70, s2: 50, incidentDeduction: 0.5, minScore: 1 };

export const excusedId = (memberId: string, date: string) => `${memberId}_${date}`;

export function readExcused(id: string, d: any): ExcusedDay {
  return {
    id, memberId: String(d?.memberId || ''), date: String(d?.date || ''),
    reason: (EXCUSE_LABELS as any)[d?.reason] ? d.reason : 'other', note: String(d?.note || ''),
    byId: d?.byId, byName: d?.byName, at: d?.at,
  };
}
export function readIncident(id: string, d: any): Incident {
  return {
    id, memberId: String(d?.memberId || ''), date: String(d?.date || ''),
    kind: (INCIDENT_LABELS as any)[d?.kind] ? d.kind : 'missed_deadline', note: String(d?.note || ''),
    byId: d?.byId, byName: d?.byName, at: d?.at,
  };
}
export function readReliabilitySettings(d: any): ReliabilitySettings {
  const num = (v: any, def: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : def);
  return {
    s5: num(d?.s5, DEFAULT_RELIABILITY.s5), s4: num(d?.s4, DEFAULT_RELIABILITY.s4),
    s3: num(d?.s3, DEFAULT_RELIABILITY.s3), s2: num(d?.s2, DEFAULT_RELIABILITY.s2),
    incidentDeduction: num(d?.incidentDeduction, DEFAULT_RELIABILITY.incidentDeduction),
    minScore: Math.min(5, Math.max(1, num(d?.minScore, DEFAULT_RELIABILITY.minScore))),
  };
}
export function settingsProblem(s: ReliabilitySettings): string {
  if (![s.s5, s.s4, s.s3, s.s2].every(v => v >= 0 && v <= 100)) return 'Each % must be between 0 and 100.';
  if (!(s.s5 > s.s4 && s.s4 > s.s3 && s.s3 > s.s2)) return 'Each score must ask for a higher % than the one below it.';
  if (s.incidentDeduction < 0 || s.incidentDeduction > 4) return 'Take off between 0 and 4 for each incident.';
  return '';
}

export function startScore(sharePct: number, s: ReliabilitySettings): number {
  return sharePct >= s.s5 ? 5 : sharePct >= s.s4 ? 4 : sharePct >= s.s3 ? 3 : sharePct >= s.s2 ? 2 : 1;
}

export interface ReliabilityResult {
  workDays: number;          // past working days in the period
  excused: ExcusedDay[];     // excused working days (left out)
  counted: number;           // working days counted
  green: number; amber: number; red: number;
  sharePct: number | null;   // % of counted days green or amber
  base: number | null;       // starting score from the bands
  incidents: Incident[];
  deduction: number;
  score: number | null;      // 1-5, one decimal; null when there was no day to count
}

/**
 * One person's reliability from `from` to `to` (YYYY-MM-DD, both included). Only working days before `today`
 * count (today is still in progress). `minutesOf(day)` is that person's CRM minutes on the day (Login log).
 */
export function reliabilityFor(opts: {
  from: string; to: string; today: string; rules: LoginRules; minutesOf: (day: string) => number;
  excused: ExcusedDay[]; incidents: Incident[]; settings: ReliabilitySettings;
}): ReliabilityResult {
  const { from, to, today, rules, minutesOf, settings } = opts;
  const days: string[] = [];
  for (let d = parseDay(from), guard = 0; dayKey(d) <= to && dayKey(d) < today && guard < 800; d = addDays(d, 1), guard++) {
    if (rules.workDays.includes(d.getDay())) days.push(dayKey(d));
  }
  const excusedOn = new Map(opts.excused.map(e => [e.date, e]));
  const excused = days.filter(d => excusedOn.has(d)).map(d => excusedOn.get(d)!);
  const counted = days.filter(d => !excusedOn.has(d));
  let green = 0, amber = 0, red = 0;
  counted.forEach(d => {
    const l = dayLight(minutesOf(d), rules);
    if (l === 'green') green++; else if (l === 'amber') amber++; else red++;
  });
  const incidents = opts.incidents.filter(i => i.date >= from && i.date <= to).sort((a, b) => a.date.localeCompare(b.date));
  const deduction = incidents.length * settings.incidentDeduction;
  const sharePct = counted.length ? Math.round(((green + amber) / counted.length) * 1000) / 10 : null;
  const base = sharePct === null ? null : startScore(sharePct, settings);
  const score = base === null ? null : Math.round(Math.max(settings.minScore, base - deduction) * 10) / 10;
  return { workDays: days.length, excused, counted: counted.length, green, amber, red, sharePct, base, incidents, deduction, score };
}
