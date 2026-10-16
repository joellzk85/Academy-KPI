// KPI templates and counting (Phase 2A).
// Each person's KPI set is chosen by Management from these templates in the
// Team tab. "Automatic" KPIs are counted from deals; the rest are typed in
// weekly, exactly as before.

import { dealOwnerId, dealWonDate, dealProposalDate, dealAppointmentDate, dealValue } from './deals';

export type MetricKey = 'salesFigure' | 'proposals' | 'preview' | 'extraMetric';
export type AutoSource = 'won' | 'proposals' | 'appointments' | null;

export interface TemplateMetric {
  key: MetricKey;
  label: string;
  targetLabel: string;
  defaultTarget: number;
  isRM: boolean;
  weight: number;
  auto: AutoSource;
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
    description: 'Performance rating 50%, Claim submission 40%, Venue database 10%. All typed in weekly.',
    metrics: [
      { key: 'salesFigure', label: 'Perf. Rating (1-5)', targetLabel: '5 / week (25 total)', defaultTarget: 25, isRM: false, weight: 0.5, auto: null },
      { key: 'proposals', label: 'Claim Submission', targetLabel: 'claims / month', defaultTarget: 1, isRM: false, weight: 0.4, auto: null },
      { key: 'preview', label: 'Venue Database', targetLabel: 'venues / month', defaultTarget: 20, isRM: false, weight: 0.1, auto: null },
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

// Counts one automatic KPI for a person in a month (optionally one week).
export function countAuto(source: AutoSource, deals: any[], ownerId: string, month: string, week?: number): number {
  if (!source) return 0;
  const prefix = monthPrefix(month);
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

// Automatic value for one of a person's KPI keys (0 when that KPI is typed in).
export function autoValueFor(rep: RepLike, key: MetricKey, deals: any[], month: string, week?: number): number {
  const metric = metricsFor(rep).find(m => m.key === key);
  return metric ? countAuto(metric.auto, deals, rep.id, month, week) : 0;
}

// Does this person's Closing RM come from deals? (Admins' first KPI is a rating instead.)
export function salesIsFromDeals(rep: RepLike): boolean {
  const m = metricsFor(rep).find(x => x.key === 'salesFigure');
  return !!m && m.auto === 'won';
}
