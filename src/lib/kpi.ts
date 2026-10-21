// KPI templates and counting (Phase 2A).
// Each person's KPI set is chosen by Management from these templates in the
// Team tab. "Automatic" KPIs are counted from deals, HRDC claims or the venue list;
// the rest are typed in weekly, exactly as before. Some automatic KPIs also take typed
// numbers, added on top (plusTyped: Admin's claims and venues, Joel 2026-10-17).

import { dealOwnerId, dealWonDate, dealProposalDate, dealAppointmentDate, dealValue } from './deals';

export type MetricKey = 'salesFigure' | 'proposals' | 'preview' | 'extraMetric';
export type AutoSource = 'won' | 'proposals' | 'appointments' | 'claims' | 'venues' | null;

// Where each automatic KPI is counted from, in plain words (KPI page).
export const AUTO_SOURCE_LABELS: Record<string, string> = {
  won: 'from deals', proposals: 'from deals', appointments: 'from deals',
  claims: 'HRDC claims recorded', venues: 'venues added',
};

// Lists the non-deal KPIs are counted from: money_in (HRDC claims, counted for the person who
// recorded them, by submission date) and venues_directory (counted for who added it, by date added).
export interface KpiSources { claims?: any[]; venues?: any[] }

export interface TemplateMetric {
  key: MetricKey;
  label: string;
  targetLabel: string;
  defaultTarget: number;
  isRM: boolean;
  weight: number;
  auto: AutoSource;
  plusTyped?: boolean;     // automatic, plus anything typed in weekly
}

export interface KpiTemplate {
  id: string;
  name: string;
  description: string;
  metrics: TemplateMetric[];
}

export const KPI_TEMPLATES: KpiTemplate[] = [
  {
    id: 'sales_standard',
    name: 'Sales: closing, appointments, proposals',
    description: 'Closing RM 60%, Appointment 20%, Proposal 20%. All counted from deals.',
    metrics: [
      { key: 'salesFigure', label: 'Closing RM', targetLabel: 'RM total / month', defaultTarget: 30000, isRM: true, weight: 0.6, auto: 'won' },
      { key: 'preview', label: 'Appointment', targetLabel: 'appointments / month', defaultTarget: 25, isRM: false, weight: 0.2, auto: 'appointments' },
      { key: 'proposals', label: 'Proposal', targetLabel: 'proposals / month', defaultTarget: 120, isRM: false, weight: 0.2, auto: 'proposals' },
    ],
  },
  {
    id: 'sales_public',
    name: 'Sales + public programme',
    description: 'Closing RM 60%, Appointment 20% (from deals), Public Programme pax 20% (typed in weekly).',
    metrics: [
      { key: 'salesFigure', label: 'Closing RM', targetLabel: 'RM total / month', defaultTarget: 60000, isRM: true, weight: 0.6, auto: 'won' },
      { key: 'proposals', label: 'Appointment', targetLabel: 'appointments / month', defaultTarget: 12, isRM: false, weight: 0.2, auto: 'appointments' },
      { key: 'preview', label: 'Public Program', targetLabel: 'pax / month', defaultTarget: 6, isRM: false, weight: 0.2, auto: null },
    ],
  },
  {
    id: 'sales_trainer',
    name: 'Sales + preview + trainer opportunity day',
    description: 'Closing RM 50%, Preview 17%, Proposal 17% (from deals), Trainer Opportunity Day 16% (typed in weekly).',
    metrics: [
      { key: 'salesFigure', label: 'Closing RM', targetLabel: 'RM total / month', defaultTarget: 30000, isRM: true, weight: 0.5, auto: 'won' },
      { key: 'preview', label: 'Preview', targetLabel: 'previews / month', defaultTarget: 1, isRM: false, weight: 0.17, auto: 'appointments' },
      { key: 'proposals', label: 'Proposal', targetLabel: 'proposals / month', defaultTarget: 8, isRM: false, weight: 0.17, auto: 'proposals' },
      { key: 'extraMetric', label: 'Trainer Opportunity Day', targetLabel: 'events / month', defaultTarget: 1, isRM: false, weight: 0.16, auto: null },
    ],
  },
  {
    id: 'admin_ops',
    name: 'Admin: rating, claims, venues',
    description: 'Performance rating 50% (typed in weekly), Claim submission 40% (HRDC claims they recorded, plus any typed), Venue database 10% (venues they added, plus any typed).',
    metrics: [
      { key: 'salesFigure', label: 'Perf. Rating (1-5)', targetLabel: '5 / week (25 total)', defaultTarget: 25, isRM: false, weight: 0.5, auto: null },
      { key: 'proposals', label: 'Claim Submission', targetLabel: 'claims / month', defaultTarget: 1, isRM: false, weight: 0.4, auto: 'claims', plusTyped: true },
      { key: 'preview', label: 'Venue Database', targetLabel: 'venues / month', defaultTarget: 20, isRM: false, weight: 0.1, auto: 'venues', plusTyped: true },
    ],
  },
];

export function templateById(id?: string): KpiTemplate | undefined {
  return KPI_TEMPLATES.find(t => t.id === id);
}

export function defaultTemplateIdFor(role?: string): string {
  return role === 'admin' ? 'admin_ops' : 'sales_standard';
}

export interface RepLike {
  id: string;
  role?: string;
  kpiTemplate?: string;
  targets?: Record<string, number | undefined>;
}

export interface ResolvedMetric extends TemplateMetric {
  targetVal: number;
}

// The KPI list for one person. Saved targets are used only once a template
// has been chosen for them (so old default targets never mix with a template).
export function metricsFor(rep: RepLike): ResolvedMetric[] {
  const chosen = templateById(rep.kpiTemplate);
  const tpl = chosen || templateById(defaultTemplateIdFor(rep.role))!;
  return tpl.metrics.map(m => {
    const saved = chosen ? Number(rep.targets?.[m.key]) : NaN;
    return { ...m, targetVal: Number.isFinite(saved) && saved > 0 ? saved : m.defaultTarget };
  });
}

export function targetsForTemplate(templateId: string): Record<string, number> {
  const tpl = templateById(templateId);
  const out: Record<string, number> = {};
  tpl?.metrics.forEach(m => { out[m.key] = m.defaultTarget; });
  return out;
}

// 'OCT-26' -> '2026-10'
const MONTHS: Record<string, string> = {
  JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
  JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
};
export function monthPrefix(month: string): string {
  const [m, y] = (month || '').split('-');
  return MONTHS[m] && y ? `20${y}-${MONTHS[m]}` : '';
}

// Week of month as used on the KPI screens: days 1-7 = week 1 ... 29-31 = week 5.
export function weekIndexOf(iso: string): number {
  const day = parseInt(iso.slice(8, 10), 10);
  if (!day || day <= 7) return 0;
  if (day <= 14) return 1;
  if (day <= 21) return 2;
  if (day <= 28) return 3;
  return 4;
}

// Malaysia date (YYYY-MM-DD) of a saved time: a number (ms) or a Firestore date.
function dayOf(v: any): string {
  const ms = typeof v === 'number' ? v : typeof v?.toMillis === 'function' ? v.toMillis() : typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(ms) ? new Date(ms + 8 * 3600000).toISOString().slice(0, 10) : '';
}

// Counts one automatic KPI for a person in a month (optionally one week).
export function countAuto(source: AutoSource, deals: any[], ownerId: string, month: string, week?: number, sources: KpiSources = {}): number {
  if (!source) return 0;
  const prefix = monthPrefix(month);
  const inRange = (date: string) => !!date && (!prefix || date.startsWith(prefix)) && (week === undefined || weekIndexOf(date) === week);
  if (source === 'claims') {
    return (sources.claims || []).filter(m => m.source === 'hrdc' && m.createdById === ownerId && inRange(String(m.invoiceDate || '').slice(0, 10))).length;
  }
  if (source === 'venues') {
    return (sources.venues || []).filter(v => v.createdBy === ownerId && inRange(dayOf(v.createdAt))).length;
  }
  let total = 0;
  for (const p of deals || []) {
    if (dealOwnerId(p) !== ownerId) continue;
    const date = source === 'won' ? dealWonDate(p) : source === 'proposals' ? dealProposalDate(p) : dealAppointmentDate(p);
    if (!date || (prefix && !date.startsWith(prefix))) continue;
    if (week !== undefined && weekIndexOf(date) !== week) continue;
    total += source === 'won' ? dealValue(p) : 1;
  }
  return total;
}

// Automatic value for one of a person's deal-counted KPI keys (0 when that KPI is typed in).
export function autoValueFor(rep: RepLike, key: MetricKey, deals: any[], month: string, week?: number): number {
  const metric = metricsFor(rep).find(m => m.key === key);
  return metric ? countAuto(metric.auto, deals, rep.id, month, week) : 0;
}

// Does this KPI take typed weekly numbers (typed only, or automatic plus typed)?
export function takesTyped(m: TemplateMetric): boolean {
  return !m.auto || !!m.plusTyped;
}

// Does this person's Closing RM come from deals? (Admins' first KPI is a rating instead.)
export function salesIsFromDeals(rep: RepLike): boolean {
  const m = metricsFor(rep).find(x => x.key === 'salesFigure');
  return !!m && m.auto === 'won';
}

// One person's KPIs for a month: each KPI's weekly values, total and % of target, and the weighted score.
// Used by the KPI page and Management's Team performance, so both always show the same numbers.
export interface KpiRow { m: ResolvedMetric; weeks: number[]; total: number; pct: number; autoTotal: number; typedTotal: number }
export function monthKpi(rep: RepLike & { kpi?: any }, deals: any[], month: string, sources: KpiSources = {}): { rows: KpiRow[]; score: number } {
  const kpi: any = rep.kpi || {};
  const rows = metricsFor(rep).map(m => {
    const autoWeeks = [0, 1, 2, 3, 4].map(w => (m.auto ? countAuto(m.auto, deals, rep.id, month, w, sources) : 0));
    const typedWeeks = [0, 1, 2, 3, 4].map(w => (takesTyped(m) ? Number(kpi[m.key]?.[w]) || 0 : 0));
    const weeks = autoWeeks.map((a, w) => a + typedWeeks[w]);
    const total = weeks.reduce((a, b) => a + b, 0);
    const pct = m.targetVal > 0 ? Math.min(100, Math.round((total / m.targetVal) * 100)) : 0;
    return { m, weeks, total, pct, autoTotal: autoWeeks.reduce((a, b) => a + b, 0), typedTotal: typedWeeks.reduce((a, b) => a + b, 0) };
  });
  return { rows, score: Math.round(rows.reduce((t, r) => t + r.pct * r.m.weight, 0)) };
}

// Months to choose from ('OCT-26' style): the last 12 months up to 3 months ahead, always current.
const MONTH_CODES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
export function monthChoices(todayIso: string, selected?: string): string[] {
  const y = Number(todayIso.slice(0, 4)), m = Number(todayIso.slice(5, 7)) - 1;
  const out: string[] = [];
  for (let i = -12; i <= 3; i++) {
    const d = new Date(y, m + i, 1);
    out.push(`${MONTH_CODES[d.getMonth()]}-${String(d.getFullYear()).slice(2)}`);
  }
  if (selected && !out.includes(selected)) out.unshift(selected);
  return out;
}

// 'OCT-26' -> 'October 2026'
export function monthLabel(month: string): string {
  const p = monthPrefix(month);
  if (!p) return month;
  return new Date(Number(p.slice(0, 4)), Number(p.slice(5, 7)) - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

// Traffic light for every KPI bar and ring (Joel, 2026-10-21): 0-35% red, 36-75% amber, 76% and up green.
export type KpiLight = 'red' | 'amber' | 'green';
export function kpiLight(pct: number): KpiLight {
  const p = Math.round(pct);
  return p >= 76 ? 'green' : p >= 36 ? 'amber' : 'red';
}
export const KPI_LIGHT_HEX: Record<KpiLight, string> = { red: '#DC2626', amber: '#F59E0B', green: '#16A34A' };
export const KPI_LIGHT_BG: Record<KpiLight, string> = { red: 'bg-[#DC2626]', amber: 'bg-[#F59E0B]', green: 'bg-[#16A34A]' };
export const KPI_LIGHT_BADGE: Record<KpiLight, string> = { red: 'bg-danger-soft text-danger', amber: 'bg-attention-soft text-attention', green: 'bg-[#E7F6EC] text-[#15803D]' };
export const kpiBarClass = (pct: number) => KPI_LIGHT_BG[kpiLight(pct)];
export const kpiHex = (pct: number) => KPI_LIGHT_HEX[kpiLight(pct)];
