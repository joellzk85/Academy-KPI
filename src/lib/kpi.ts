// KPIs: each person's KPI set and how every KPI is counted and scored.
// Phase 2A had four fixed templates. Since 2026-10-22 (Joel) Management picks each person's KPIs from the KPI
// library (lib/kpiLibrary.ts) with their own target or colour bands and weight, saved as reps/{memberId}.kpiSet.
// People not yet given a set keep their old template (kpiTemplate), read as one of the ready-made sets.
// "Automatic" KPIs are counted from deals, HRDC claims, the venue list, the admin checklists or the P&L;
// typed KPIs are keyed in weekly. Some automatic KPIs also take typed numbers, added on top
// (plusTyped: Admin's claims and venues, Joel 2026-10-17).

import { dealOwnerId, dealWonDate, dealProposalDate, dealAppointmentDate, dealValue, dealStage, OPEN_STAGES, todayIso, trainingEndDate } from './deals';
import { followUpAlert, followUpNotes } from './followUps';
import { buildForecast, DEFAULT_FORECAST, ForecastSettings } from './forecast';
import { DEFAULT_MONEY_SETTINGS, expectedFor, MoneySettings, shortfall } from './money';
import { activeKpiLibrary, bandLight, Bands, isGpMeasure, kpiDef, KpiDef, KpiSetItem, KpiUnit, Light, MEASURE_INFO, presetById, Scoring, KPI_PRESETS } from './kpiLibrary';

export type MetricKey = 'salesFigure' | 'proposals' | 'preview' | 'extraMetric';
export type AutoSource = 'won' | 'proposals' | 'appointments' | 'claims' | 'venues' | null;

// Lists the non-deal KPIs are counted from. claims: every money_in record (HRDC claims are counted for the person
// who recorded them, by submission date; client invoices give invoice and payment days). venues: venues_directory.
// checklists: deal_checklists tasks by deal. gp: gross profit per person and 'company' by month ('YYYY-MM'),
// from the server (only your own unless you are Management). people: everyone with KPIs (Team average).
export interface GpFigure { margin: number; trainings: number }
export interface KpiSources {
  claims?: any[];
  venues?: any[];
  checklists?: Record<string, any[]>;
  moneySettings?: MoneySettings;
  forecast?: ForecastSettings;
  gp?: Record<string, Record<string, GpFigure>>;
  people?: (RepLike & { kpi?: any })[];
  trainingReports?: Record<string, any>;   // training_reports by deal id (trainer KPIs)
  activities?: any[];                      // tb_activities (Design new activity)
  rating360?: Record<string, Record<string, { avg: number; count: number }>>;   // 'YYYY-MM' → person → 360 rating (server)
  oneToOnes?: Record<string, string[]>;    // person → dates of 1-to-1 sessions held (server, lib/oneToOne.ts)
  oneToOnesAsked?: Record<string, string[]>;   // person → dates of held 1-to-1s they asked for themselves
}

// The old templates, kept for screens that list them (they are now the ready-made sets in lib/kpiLibrary.ts).
export interface KpiTemplate { id: string; name: string; description: string }
export const KPI_TEMPLATES: KpiTemplate[] = KPI_PRESETS.map(({ id, name, description }) => ({ id, name, description }));
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
  kpiSet?: { items?: KpiSetItem[]; trainerId?: string } | null;   // trainerId: their trainers_directory record (trainer KPIs)
  targets?: Record<string, number | undefined>;
  salesRing?: { monthly?: number } | null;   // sales contributor: a ring without a sales KPI (KPI & appraisal → Settings → KPIs)
}

// Has Management given this person KPIs? Reps and Admin always have some (their default set);
// Management only once a set is chosen for them (Joel, 2026-10-17).
export function hasKpis(settings: { kpiTemplate?: string; kpiSet?: { items?: any[] } | null } | undefined, role?: string): boolean {
  if (settings?.kpiSet?.items?.length) return true;
  if (templateById(settings?.kpiTemplate)) return true;
  return role !== 'management';
}

export interface ResolvedMetric {
  key: string;             // where typed weekly numbers are kept (month_kpis): the item's slot
  kpiId: string;
  label: string;
  targetLabel: string;
  unit: KpiUnit;
  isRM: boolean;
  weight: number;          // fraction of the score (0-1)
  auto: string | null;     // how it is counted (MEASURE_INFO key), null when typed in
  plusTyped?: boolean;
  typedAgg: 'sum' | 'average';
  scoring: Scoring;
  targetVal: number;
  bands: Bands;
  param?: number;
  perWeek?: boolean;
}

const UNIT_TARGET: Record<KpiUnit, string> = { rm: 'RM total / month', count: 'per month', pct: '%', days: 'days', rating: 'rating' };

function resolveItem(item: KpiSetItem, lib = activeKpiLibrary()): ResolvedMetric | null {
  const def: KpiDef | undefined = lib.defs.find(d => d.id === item.kpiId);
  if (!def) return null;
  const info = MEASURE_INFO[def.measure] || MEASURE_INFO.typed;
  const target = Number(item.target);
  return {
    key: item.slot || def.id,
    kpiId: def.id,
    label: item.label?.trim() || def.name,
    targetLabel: info.perWeek ? 'per week' : UNIT_TARGET[def.unit],
    unit: def.unit,
    isRM: def.unit === 'rm',
    weight: (Number(item.weight) || 0) / 100,
    auto: def.measure === 'typed' ? null : def.measure,
    plusTyped: def.plusTyped,
    typedAgg: def.typedAgg || 'sum',
    scoring: def.scoring,
    targetVal: Number.isFinite(target) && target > 0 ? target : def.target,
    // Gross profit always uses the company GP bands (Project P&L and the estimator use them too).
    bands: isGpMeasure(def.measure) ? lib.gpBands : item.bands || def.bands,
    param: item.param ?? def.param,
    perWeek: info.perWeek,
  };
}

// The KPI set items for one person: their own set, or their old template read as a ready-made set.
// Old saved targets are used only once a template has been chosen for them (so old default targets never mix in).
export function setItemsFor(rep: RepLike): KpiSetItem[] {
  if (rep.kpiSet?.items?.length) return rep.kpiSet.items;
  const chosen = presetById(rep.kpiTemplate);
  const preset = chosen || presetById(defaultTemplateIdFor(rep.role))!;
  return preset.items.map(i => {
    const saved = chosen ? Number(rep.targets?.[i.slot]) : NaN;
    return Number.isFinite(saved) && saved > 0 ? { ...i, target: saved } : i;
  });
}

export function metricsFor(rep: RepLike): ResolvedMetric[] {
  return setItemsFor(rep).map(i => resolveItem(i)).filter((m): m is ResolvedMetric => !!m);
}

// The person's Closing RM KPI (counted from deals won), if they have one. Rings and the company target use it.
export function closingMetric(rep: RepLike): ResolvedMetric | undefined {
  return metricsFor(rep).find(m => m.auto === 'won');
}

// Monthly RM target behind a person's sales ring, or null for no ring. The Closing RM KPI's target; otherwise the
// sales contributor target (Joel, 2026-10-24: Admin or Management who sell without a sales KPI still get the same
// inner and outer ring, and their target adds to the company target). Never part of the KPI score.
export function ringTarget(rep: RepLike): number | null {
  const closing = hasKpis(rep, rep.role) ? closingMetric(rep) : undefined;   // Management without KPIs: no default set
  if (closing) return closing.targetVal;
  const monthly = Number(rep.salesRing?.monthly);
  return monthly > 0 ? monthly : null;
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

// Counts one of the original automatic KPIs for a person in a month (optionally one week).
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

// ---------- How each automatic KPI is counted ----------
const WEEKS = [0, 1, 2, 3, 4];
const ymd = (v: any): string => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '');
const dayNum = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;
const daysFrom = (a: string, b: string) => Math.round(dayNum(b) - dayNum(a));
const average = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const isHrdcDeal = (p: any) => p?.fundingType === 'hrdc' || p?.fundingType === 'hrdc_topup';

interface Ctx {
  rep: RepLike & { kpi?: any };
  deals: any[];
  prefix: string;          // 'YYYY-MM'
  month: string;           // 'OCT-26'
  today: string;
  sources: KpiSources;
  param?: number;
}
interface Measured { value: number | null; weeks?: number[] }

// Has this client won a deal before the given date (any owner)?
function wonBefore(deals: any[], clientId: string, date: string, exceptId = ''): boolean {
  return deals.some(d => d.id !== exceptId && d.clientId === clientId && dealStage(d) === 'won' && dealWonDate(d) && dealWonDate(d) < date);
}

// Weeks of the month that have started (week 5's three days count into week 4 for per-week KPIs).
function weeksSoFar(prefix: string, today: string): number {
  const now = today.slice(0, 7);
  if (prefix < now) return 4;
  if (prefix > now) return 0;
  return Math.min(3, weekIndexOf(today)) + 1;
}

function byWeek(dates: string[], prefix: string): number[] {
  const w = [0, 0, 0, 0, 0];
  dates.forEach(d => { if (d.startsWith(prefix)) w[weekIndexOf(d)]++; });
  return w;
}

function trainerTrainings(c: Ctx): any[] {
  const tid = c.rep.kpiSet?.trainerId;
  if (!tid) return [];
  return c.deals.filter(p => {
    if (dealStage(p) !== 'won' || !trainingEndDate(p).startsWith(c.prefix) || trainingEndDate(p) >= c.today) return false;
    if (c.sources.trainingReports?.[p.id]?.trainerId === tid) return true;
    return (c.sources.checklists?.[p.id] || []).some((t: any) => (t.kind === 'trainer' || t.id === 'trainer') && t.trainerId === tid);
  });
}

function gpFor(c: Ctx, who: string): Measured {
  const g = c.sources.gp?.[c.prefix]?.[who];
  return { value: g && g.trainings > 0 ? g.margin : null };
}

const MEASURES: Record<string, (c: Ctx) => Measured> = {
  won: c => {
    const weeks = WEEKS.map(w => countAuto('won', c.deals, c.rep.id, c.month, w));
    return { value: weeks.reduce((a, b) => a + b, 0), weeks };
  },
  won_count: c => {
    const weeks = byWeek(c.deals.filter(p => dealOwnerId(p) === c.rep.id).map(dealWonDate).filter(Boolean), c.prefix);
    return { value: weeks.reduce((a, b) => a + b, 0), weeks };
  },
  proposals: c => {
    const weeks = WEEKS.map(w => countAuto('proposals', c.deals, c.rep.id, c.month, w));
    return { value: weeks.reduce((a, b) => a + b, 0), weeks };
  },
  appointments: c => {
    const weeks = WEEKS.map(w => countAuto('appointments', c.deals, c.rep.id, c.month, w));
    return { value: weeks.reduce((a, b) => a + b, 0), weeks };
  },
  claims: c => {
    const weeks = WEEKS.map(w => countAuto('claims', c.deals, c.rep.id, c.month, w, c.sources));
    return { value: weeks.reduce((a, b) => a + b, 0), weeks };
  },
  venues: c => {
    const weeks = WEEKS.map(w => countAuto('venues', c.deals, c.rep.id, c.month, w, c.sources));
    return { value: weeks.reduce((a, b) => a + b, 0), weeks };
  },
  // Different new customers (no won deal before the follow-up) this person followed up, per week (Joel, 2026-10-22).
  new_followups: c => {
    const seen: Set<string>[] = WEEKS.map(() => new Set());
    c.deals.forEach(p => {
      followUpNotes(p).forEach(n => {
        const d = ymd(n.date);
        if (n.byId !== c.rep.id || !d.startsWith(c.prefix)) return;
        if (p.clientId && wonBefore(c.deals, p.clientId, d)) return;
        seen[Math.min(3, weekIndexOf(d))].add(p.clientId || `deal:${p.id}`);
      });
    });
    const weeks = seen.map(s => s.size);
    const n = weeksSoFar(c.prefix, c.today);
    return { value: n ? weeks.slice(0, n).reduce((a, b) => a + b, 0) / n : null, weeks };
  },
  win_rate: c => {
    const mine = c.deals.filter(p => dealOwnerId(p) === c.rep.id);
    const sent = mine.filter(p => dealProposalDate(p).startsWith(c.prefix)).length;
    const won = mine.filter(p => dealWonDate(p).startsWith(c.prefix)).length;
    return { value: sent ? (won / sent) * 100 : null };
  },
  new_clients: c => {
    const dates = c.deals
      .filter(p => dealOwnerId(p) === c.rep.id && dealWonDate(p).startsWith(c.prefix) && !(p.clientId && wonBefore(c.deals, p.clientId, dealWonDate(p), p.id)))
      .map(dealWonDate);
    const weeks = byWeek(dates, c.prefix);
    return { value: weeks.reduce((a, b) => a + b, 0), weeks };
  },
  quote_speed: c => ({
    value: average(c.deals
      .filter(p => dealOwnerId(p) === c.rep.id && ymd(p.quotationSentDate).startsWith(c.prefix) && ymd(p.agreedDate))
      .map(p => Math.max(0, daysFrom(ymd(p.agreedDate), ymd(p.quotationSentDate))))),
  }),
  collect_days: c => {
    const mine = new Set(c.deals.filter(p => dealOwnerId(p) === c.rep.id).map(p => p.id));
    return {
      value: average((c.sources.claims || [])
        .filter(m => m.source === 'client' && mine.has(m.dealId) && ymd(m.paidDate).startsWith(c.prefix) && ymd(m.invoiceDate))
        .map(m => Math.max(0, daysFrom(ymd(m.invoiceDate), ymd(m.paidDate))))),
    };
  },
  overdue_followups: c => ({
    value: c.prefix === c.today.slice(0, 7)
      ? c.deals.filter(p => dealOwnerId(p) === c.rep.id && OPEN_STAGES.includes(dealStage(p)) && followUpAlert(p, c.today)).length
      : null,
  }),
  pipeline_cover: c => {
    const target = closingMetric(c.rep)?.targetVal || 0;
    if (!target) return { value: null };
    const now = c.today.slice(0, 7);
    if (c.prefix < now) return { value: (countAuto('won', c.deals, c.rep.id, c.month) / target) * 100 };
    const span = (Number(c.prefix.slice(0, 4)) - Number(now.slice(0, 4))) * 12 + Number(c.prefix.slice(5, 7)) - Number(now.slice(5, 7)) + 1;
    if (span > 6) return { value: null };
    const f = buildForecast(c.deals, { today: c.today, months: span, settings: c.sources.forecast || DEFAULT_FORECAST, ownerIds: [c.rep.id] });
    const row = f.months.find(m => m.month === c.prefix);
    return { value: row ? (row.projected / target) * 100 : null };
  },
  gp_own: c => gpFor(c, c.rep.id),
  gp_company: c => gpFor(c, 'company'),
  claim_days: c => {
    const dealById = new Map(c.deals.map(p => [p.id, p]));
    return {
      value: average((c.sources.claims || [])
        .filter(m => m.source === 'hrdc' && m.createdById === c.rep.id && ymd(m.invoiceDate).startsWith(c.prefix) && trainingEndDate(dealById.get(m.dealId)))
        .map(m => Math.max(0, daysFrom(trainingEndDate(dealById.get(m.dealId)), ymd(m.invoiceDate))))),
    };
  },
  grant_on_time: c => {
    const days = c.param ?? 7;
    const hrdc = c.deals.filter(p => dealStage(p) === 'won' && isHrdcDeal(p) && ymd(p.trainingDate).startsWith(c.prefix));
    if (!hrdc.length) return { value: null };
    const onTime = hrdc.filter(p => {
      const grant = (c.sources.checklists?.[p.id] || []).find((t: any) => t.id === 'grant' || t.kind === 'grant');
      const done = grant?.done && ymd(grant.doneAt);
      return !!done && daysFrom(done, ymd(p.trainingDate)) >= days;
    }).length;
    return { value: (onTime / hrdc.length) * 100 };
  },
  docs_days: c => {
    const DOCS = ['jd14', 't3', 'training_report', 'output_assessment'];
    const ended = c.deals.filter(p => dealStage(p) === 'won' && trainingEndDate(p).startsWith(c.prefix) && trainingEndDate(p) < c.today);
    return {
      value: average(ended.map(p => {
        const end = trainingEndDate(p);
        const tasks = (c.sources.checklists?.[p.id] || []).filter((t: any) => DOCS.includes(t.id) && (t.appliesTo !== 'hrdc' || isHrdcDeal(p)));
        const allDone = tasks.length > 0 && tasks.every((t: any) => t.done && ymd(t.doneAt));
        const finished = allDone ? tasks.map((t: any) => ymd(t.doneAt)).sort().pop()! : c.today;
        return Math.max(0, daysFrom(end, finished));
      })),
    };
  },
  invoice_days: c => {
    const ins = c.sources.claims || [];
    const ended = c.deals.filter(p => dealStage(p) === 'won' && (p.fundingType === 'direct' || p.fundingType === 'hrdc_topup')
      && trainingEndDate(p).startsWith(c.prefix) && trainingEndDate(p) < c.today);
    return {
      value: average(ended.map(p => {
        const first = ins.filter(m => m.source === 'client' && m.dealId === p.id && ymd(m.invoiceDate)).map(m => ymd(m.invoiceDate)).sort()[0];
        return Math.max(0, daysFrom(trainingEndDate(p), first || c.today));
      })),
    };
  },
  hrdc_shortfall: c => {
    const s = c.sources.moneySettings || DEFAULT_MONEY_SETTINGS;
    const paid = (c.sources.claims || []).filter(m => m.source === 'hrdc' && ymd(m.paidDate).startsWith(c.prefix));
    const expected = paid.reduce((t, m) => t + expectedFor(m, s), 0);
    return { value: expected > 0 ? (paid.reduce((t, m) => t + shortfall(m, s), 0) / expected) * 100 : null };
  },
  // Trainer KPIs (Part B): trainings that ended this month where this person's trainer record is the report's
  // trainer or the trainer picked on the deal's checklist.
  output_rating: c => ({
    value: average(trainerTrainings(c)
      .map(p => Number(c.sources.trainingReports?.[p.id]?.participant?.avg))
      .filter(v => Number.isFinite(v) && v > 0)),
  }),
  report_days: c => ({
    value: average(trainerTrainings(c).map(p => {
      const sent = dayOf(c.sources.trainingReports?.[p.id]?.submittedAt);
      return Math.max(0, daysFrom(trainingEndDate(p), sent || c.today));
    })),
  }),
  // Activities this person added that Management approved this month, by approval date (lib/teambuilding.ts).
  new_activities: c => {
    const dates = (c.sources.activities || [])
      .filter(a => a.createdById === c.rep.id && a.approval?.status === 'approved')
      .map(a => dayOf(a.approval.at));
    const weeks = byWeek(dates, c.prefix);
    return { value: weeks.reduce((a, b) => a + b, 0), weeks };
  },
  one_to_ones: c => {
    const weeks = byWeek(c.sources.oneToOnes?.[c.rep.id] || [], c.prefix);
    return { value: weeks.reduce((a, b) => a + b, 0), weeks };
  },
  one_to_ones_asked: c => {
    const weeks = byWeek(c.sources.oneToOnesAsked?.[c.rep.id] || [], c.prefix);
    return { value: weeks.reduce((a, b) => a + b, 0), weeks };
  },
  rating_360: c => {
    const r = c.sources.rating360?.[c.prefix]?.[c.rep.id];
    return { value: r && r.count > 0 ? r.avg : null };
  },
  team_avg: c => {
    const others = (c.sources.people || []).filter(p => p.id !== c.rep.id && !metricsFor(p).some(m => m.auto === 'team_avg'));
    const scores = others.map(p => monthKpi(p, c.deals, c.month, { ...c.sources, people: [] }).score);
    return { value: average(scores) };
  },
};

// Automatic value for one of a person's KPI keys, by week or for the month (0 when that KPI is typed in).
export function autoValueFor(rep: RepLike, key: string, deals: any[], month: string, week?: number): number {
  const metric = metricsFor(rep).find(m => m.key === key);
  if (!metric?.auto) return 0;
  const r = MEASURES[metric.auto]?.({ rep, deals, prefix: monthPrefix(month), month, today: todayIso(), sources: {}, param: metric.param });
  if (!r) return 0;
  return week === undefined ? r.value ?? 0 : r.weeks?.[week] ?? 0;
}

// Does this KPI take typed weekly numbers (typed only, or automatic plus typed)?
export function takesTyped(m: { auto: string | null; plusTyped?: boolean }): boolean {
  return !m.auto || !!m.plusTyped;
}

// Does this person's Closing RM come from deals? (Admins' first KPI is a rating instead.)
export function salesIsFromDeals(rep: RepLike): boolean {
  return !!closingMetric(rep);
}

// ---------- Scoring ----------
// One person's KPIs for a month: each KPI's weekly values, month value, colour and points, and the weighted score.
// Used by the KPI page, My home, Team performance and the weekly presentation, so all show the same numbers.
// - pct: how full the bar is (target KPIs: % of target; band KPIs: the points their colour earns).
// - A KPI with nothing to count this month (e.g. no trainings ended) is left out of the score, and the
//   other KPIs' weights count for more.
export interface KpiRow {
  m: ResolvedMetric;
  weeks: number[];
  total: number;           // the month figure (a sum, average or %)
  hasData: boolean;
  pct: number;
  light: Light;
  points: number;
  autoTotal: number;
  typedTotal: number;
  weekly: boolean;         // has a week-by-week breakdown
}

export function monthKpi(rep: RepLike & { kpi?: any }, deals: any[], month: string, sources: KpiSources = {}): { rows: KpiRow[]; score: number } {
  const kpi: any = rep.kpi || {};
  const lib = activeKpiLibrary();
  const prefix = monthPrefix(month);
  const today = todayIso();
  const rows: KpiRow[] = metricsFor(rep).map(m => {
    const typedWeeks = WEEKS.map(w => (takesTyped(m) ? Number(kpi[m.key]?.[w]) || 0 : 0));
    const typedFilled = typedWeeks.filter(v => v > 0);
    const typedTotal = m.typedAgg === 'average' && !m.auto ? average(typedFilled) ?? 0 : typedWeeks.reduce((a, b) => a + b, 0);
    let measured: Measured = { value: 0, weeks: [0, 0, 0, 0, 0] };
    if (m.auto) measured = MEASURES[m.auto]?.({ rep, deals: deals || [], prefix, month, today, sources, param: m.param }) || { value: null };
    const autoWeeks = measured.weeks || [0, 0, 0, 0, 0];
    const weekly = !m.auto || !!measured.weeks;
    const weeks = autoWeeks.map((a, w) => a + typedWeeks[w]);
    const autoTotal = measured.value ?? 0;
    const hasData = !m.auto || measured.value !== null || typedTotal > 0;
    const total = m.auto ? autoTotal + (m.plusTyped ? typedTotal : 0) : typedTotal;
    let pct: number, light: Light, points: number;
    if (m.scoring === 'bands') {
      light = bandLight(total, m.bands);
      points = Math.max(0, Math.min(100, lib.points[light]));
      pct = points;
    } else {
      pct = m.targetVal > 0 ? Math.min(100, Math.round((total / m.targetVal) * 100)) : 0;
      light = kpiLight(pct);
      points = pct;
    }
    return { m, weeks, total, hasData, pct, light, points, autoTotal, typedTotal: m.auto ? typedTotal : 0, weekly };
  });
  const scored = rows.filter(r => r.hasData);
  const weightSum = scored.reduce((t, r) => t + r.m.weight, 0);
  const score = weightSum > 0 ? Math.round(scored.reduce((t, r) => t + r.points * r.m.weight, 0) / weightSum) : 0;
  return { rows, score };
}

// A KPI's month figure in words: "RM 1,200.00", "45%", "6.5 days", "7.5 a week".
export function kpiValueText(m: Pick<ResolvedMetric, 'unit' | 'perWeek'>, v: number, formatRM: (n: number) => string): string {
  const r = (x: number) => String(Math.round(x * 10) / 10);
  if (m.unit === 'rm') return formatRM(v);
  if (m.unit === 'pct') return `${Math.round(v)}%`;
  if (m.unit === 'days') return `${r(v)} day${r(v) === '1' ? '' : 's'}`;
  if (m.perWeek) return `${r(v)} a week`;
  return r(v);
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
// Band KPIs (lib/kpiLibrary.ts) can also be grey: below red (Joel, 2026-10-22).
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

export const LIGHT_HEX: Record<Light, string> = { ...KPI_LIGHT_HEX, grey: '#9CA3AF' };
export const LIGHT_BG: Record<Light, string> = { ...KPI_LIGHT_BG, grey: 'bg-[#9CA3AF]' };
export const LIGHT_BADGE: Record<Light, string> = { ...KPI_LIGHT_BADGE, grey: 'bg-surface text-ink-soft' };
export const LIGHT_TEXT: Record<Light, string> = { red: 'text-danger', amber: 'text-attention', green: 'text-[#15803D]', grey: 'text-ink-soft' };
// The bar colour of one KPI row (band KPIs can be grey).
export const rowBarClass = (r: Pick<KpiRow, 'light'>) => LIGHT_BG[r.light];

export { kpiDef };
