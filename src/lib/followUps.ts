// Follow-up rules, notes and alerts (Joel, 2026-10-18).
//
// Rules (config/follow_up_rules, set by Management in Management → Follow-up rules): per stage, a list of
// checkpoints in days. The clock counts from the day the deal reached the stage (New: the date the client asked;
// Proposal sent: the proposal sent date; Quotation sent: the quotation sent date). Logging a note does not
// restart it; moving to the next stage starts that stage's clock. "Client approved" has no checkpoints.
//
// Alerts: when a checkpoint has passed and no follow-up note is dated on or after it, the deal shows
// "1st / 2nd / 3rd follow-up due". After the last checkpoint the rep must decide: "Keep open" (reason and next
// follow-up date) or "Mark lost". Until then it shows "Decision needed". If a Keep open's next follow-up date
// passes without a new decision, "Decision needed" comes back (Joel agreed).
//
// Notes are stored on the deal as followUps[] (who, when, how, what happened, next date).

// Pure logic (no database code), because the server shares src/lib/deals.ts. The live rules come from
// useFollowUpRules in src/lib/useFollowUpRules.ts.
import { dealStage } from './deals';

export type RuleStage = 'lead' | 'proposal' | 'quoted';
export const RULE_STAGES: RuleStage[] = ['lead', 'proposal', 'quoted'];
export const RULE_STAGE_LABELS: Record<RuleStage, string> = { lead: 'New deal', proposal: 'Proposal sent', quoted: 'Quotation sent' };
export const RULE_STAGE_FROM: Record<RuleStage, string> = {
  lead: 'the date the client asked', proposal: 'the proposal sent date', quoted: 'the quotation sent date',
};

export type StageRule = { on: boolean; days: number[] };
export type FollowUpRules = Record<RuleStage, StageRule>;

export const DEFAULT_FOLLOW_UP_RULES: FollowUpRules = {
  lead: { on: true, days: [15, 30, 45] },
  proposal: { on: true, days: [15, 30, 45] },
  quoted: { on: true, days: [15, 30, 45] },
};

// Clean days: whole numbers 1–365, no repeats, smallest first.
export function cleanDays(days: any): number[] {
  if (!Array.isArray(days)) return [];
  return [...new Set(days.map(d => Math.round(Number(d))).filter(d => Number.isFinite(d) && d >= 1 && d <= 365))].sort((a, b) => a - b);
}

export function readFollowUpRules(data: any): FollowUpRules {
  const out = {} as FollowUpRules;
  RULE_STAGES.forEach(st => {
    const r = data?.[st];
    out[st] = r && typeof r === 'object'
      ? { on: r.on !== false, days: cleanDays(r.days) }
      : { ...DEFAULT_FOLLOW_UP_RULES[st], days: [...DEFAULT_FOLLOW_UP_RULES[st].days] };
  });
  return out;
}

// The rules in use. The app keeps them up to date (useFollowUpRules in App.tsx), so the shared checks
// (dealNeedsAttention, the deal rows, My home) don't each need to load them.
let activeRules: FollowUpRules = DEFAULT_FOLLOW_UP_RULES;
export function setActiveFollowUpRules(r: FollowUpRules) { activeRules = r; }
export function activeFollowUpRules() { return activeRules; }

// ---------- Notes ----------
export type FollowUpHow = 'call' | 'whatsapp' | 'email' | 'visit' | 'other';
export const HOW_LABELS: Record<FollowUpHow, string> = { call: 'Call', whatsapp: 'WhatsApp', email: 'Email', visit: 'Visit', other: 'Other' };

export type FollowUpNote = {
  id: string; date: string; how: FollowUpHow; text: string; nextDate: string;
  at: string; byId: string; byName: string; stage: string;
  decision?: 'keep_open'; reason?: string;
  followUpById?: string; followUpByName?: string;   // who follows up next (2026-10-18; older notes: the deal owner)
};

const ymd = (v: any): string => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '');

export function followUpNotes(p: any): FollowUpNote[] {
  const list: FollowUpNote[] = Array.isArray(p?.followUps) ? p.followUps.filter((n: any) => n && ymd(n.date)) : [];
  return [...list].sort((a, b) => ymd(b.date).localeCompare(ymd(a.date)) || String(b.at || '').localeCompare(String(a.at || '')));
}

export function newNoteId(): string {
  return `fu_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// ---------- Dates ----------
const dayNum = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
export function daysBetween(from: string, to: string): number { return Math.round(dayNum(to) - dayNum(from)); }
export function addDays(iso: string, n: number): string {
  const d = new Date((dayNum(iso) + n) * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] || 'th';
  return `${n}${s}`;
}

// Which rule stage a deal is in, and the day its clock started. "Appointment" counts as New (as on the journey line).
export function stageClock(p: any): { stage: RuleStage; start: string } | null {
  const st = dealStage(p);
  if (st === 'lead' || st === 'appointment') return ymd(p?.requestDate) ? { stage: 'lead', start: ymd(p.requestDate) } : null;
  if (st === 'proposal') return ymd(p?.proposalSentDate) ? { stage: 'proposal', start: ymd(p.proposalSentDate) } : null;
  if (st === 'quoted') return ymd(p?.quotationSentDate) ? { stage: 'quoted', start: ymd(p.quotationSentDate) } : null;
  return null;
}

// ---------- Alerts ----------
export type FollowUpAlert = {
  stage: RuleStage;
  level: number;          // 1-based checkpoint reached
  total: number;          // checkpoints in this stage
  decision: boolean;      // after the last checkpoint: keep open or mark lost
  again: boolean;         // a Keep open's next date passed
  label: string;          // "1st follow-up due", "Decision needed"
  short: string;          // "1st", "2nd", "Decision"
  daysInStage: number;
  checkpointDate: string;
};

export function followUpAlert(p: any, today: string, rules: FollowUpRules = activeRules): FollowUpAlert | null {
  if (p?.deleted) return null;
  const clock = stageClock(p);
  if (!clock) return null;
  const rule = rules[clock.stage];
  if (!rule?.on || !rule.days.length) return null;
  const daysInStage = daysBetween(clock.start, today);
  const passed = rule.days.filter(d => d <= daysInStage);
  if (!passed.length) return null;
  const level = passed.length;
  const total = rule.days.length;
  const checkpointDate = addDays(clock.start, passed[passed.length - 1]);
  const notes = followUpNotes(p);
  const base = { stage: clock.stage, level, total, daysInStage, checkpointDate };
  if (level < total) {
    if (notes.some(n => ymd(n.date) >= checkpointDate)) return null;
    return { ...base, decision: false, again: false, label: `${ordinal(level)} follow-up due`, short: ordinal(level) };
  }
  // Last checkpoint passed: a Keep open decision dated on or after it, whose next date hasn't passed, clears it.
  const keep = notes.find(n => n.decision === 'keep_open' && ymd(n.date) >= checkpointDate);
  if (keep && ymd(keep.nextDate) && ymd(keep.nextDate) >= today) return null;
  return {
    ...base, decision: true, again: !!keep,
    label: keep ? 'Decision needed again' : 'Decision needed', short: 'Decision',
  };
}

// The text shown on a deal row and in lists.
export function alertText(a: FollowUpAlert): string {
  if (a.decision) return `${a.label}: keep open or mark lost`;
  return `${a.label} (${a.daysInStage} days at ${a.stage === 'lead' ? 'New' : RULE_STAGE_LABELS[a.stage]})`;
}
