// KPI library (Joel, 2026-10-22). Management keeps one list of KPIs; each person's KPI set picks from it, with
// their own target or colour bands and weight (KPI & appraisal → Settings → KPIs). The list starts with the built-in KPIs below; Management
// can rename them, change their default target or bands, hide them, and add their own ("create KPIs as we go").
// - Stored in config/kpi_library: { overrides: { [builtInId]: changes }, custom: KpiDef[], points, gpBands }
//   (Management only). Built-ins live here in code so new ones reach everyone; only the changes are saved.
// - Scoring: "target" KPIs score their % of target (the 0-35 / 36-75 / 76+ traffic light, lib/kpi.ts kpiLight);
//   "bands" KPIs score by colour: green, amber, red or grey earn `points` (default 100 / 60 / 30 / 0) of their weight.
// - The gross profit bands (gpBands) are one company setting, also used by Project P&L and the Costing estimator.
// How each KPI is counted lives in lib/kpi.ts (MEASURES); the plain words for it are in MEASURE_INFO below.
// - Appraisal (Joel, 2026-10-22): KPIs are results only. Attitude (360 rating) and reliability are separate parts of
//   the appraisal (components/Appraisal.tsx), so the 360 rating KPI is hidden for new sets and left out of a saved
//   set's score on the appraisal (appraisalSetItems). Its library entry stays so old months still show it.

export type KpiUnit = 'rm' | 'count' | 'pct' | 'days' | 'rating';
export type KpiGroup = 'sales' | 'admin' | 'trainer' | 'management' | 'other';
export type Light = 'green' | 'amber' | 'red' | 'grey';
export type Scoring = 'target' | 'bands';

// higher: green at or above `green`, amber at or above `amber`, red at or above `red`, grey below.
// lower (higher = false): green at or below `green`, and so on. red = null: everything past amber is red (no grey).
export interface Bands { higher: boolean; green: number; amber: number; red: number | null }

export interface KpiDef {
  id: string;
  name: string;
  group: KpiGroup;
  description: string;
  measure: string;                 // a MEASURE_INFO key, or 'typed' (keyed in weekly)
  typedAgg?: 'sum' | 'average';    // typed KPIs: add the weeks up, or average the weeks filled in
  plusTyped?: boolean;             // automatic, plus anything typed in weekly
  unit: KpiUnit;
  scoring: Scoring;
  target: number;                  // default monthly target (scoring 'target')
  bands: Bands;                    // default colour bands (scoring 'bands')
  param?: number;                  // the measure's setting, e.g. "days before training"
  custom?: boolean;                // made by Management
  hidden?: boolean;                // not offered for new KPI sets
}

export interface MeasureInfo {
  label: string;                   // how it is counted, in plain words
  unit: KpiUnit;
  perWeek?: boolean;               // counted per week; the month shows the average week
  paramLabel?: string;             // what `param` means, when the measure has one
  scope?: 'company';               // counted for the whole company, not the person
  asOfToday?: boolean;             // a count of how things stand today (not by month)
  weekly?: boolean;                // has a week-by-week breakdown
  trainer?: boolean;               // counted for the person's trainer record (KPI & appraisal → Settings → KPIs → Internal trainer)
}

export const MEASURE_INFO: Record<string, MeasureInfo> = {
  typed: { label: 'typed in weekly', unit: 'count', weekly: true },
  won: { label: 'value of deals won this month', unit: 'rm', weekly: true },
  won_count: { label: 'deals won this month', unit: 'count', weekly: true },
  proposals: { label: 'proposals sent, from deals', unit: 'count', weekly: true },
  appointments: { label: 'appointments logged, from deals', unit: 'count', weekly: true },
  new_followups: { label: 'new customers followed up each week, no earlier won deal', unit: 'count', perWeek: true, weekly: true },
  win_rate: { label: 'deals won ÷ proposals sent this month', unit: 'pct' },
  new_clients: { label: 'deals won from clients with no earlier won deal', unit: 'count', weekly: true },
  quote_speed: { label: 'days from client approved to quotation sent', unit: 'days' },
  collect_days: { label: 'days from invoice to payment, client payments received this month', unit: 'days' },
  overdue_followups: { label: 'open deals with a follow-up overdue, as of today', unit: 'count', asOfToday: true },
  pipeline_cover: { label: 'expected sales, won + open deals × chance, ÷ Closing RM target', unit: 'pct' },
  gp_own: { label: 'gross profit % of own trainings this month', unit: 'pct' },
  claims: { label: 'HRDC claims recorded', unit: 'count', weekly: true },
  claim_days: { label: 'days from last training day to HRDC claim recorded', unit: 'days' },
  venues: { label: 'venues added', unit: 'count', weekly: true },
  grant_on_time: { label: 'HRDC trainings this month with the grant ticked in time', unit: 'pct', paramLabel: 'days before training', scope: 'company' },
  docs_days: { label: 'days from last training day to JD14, T3, training report and output assessment done', unit: 'days', scope: 'company' },
  invoice_days: { label: 'days from last training day to client invoice (direct and top-up trainings)', unit: 'days', scope: 'company' },
  hrdc_shortfall: { label: 'HRDC paid less than expected, % of claims paid this month', unit: 'pct', scope: 'company' },
  gp_company: { label: 'gross profit % of every training this month', unit: 'pct', scope: 'company' },
  team_avg: { label: 'average KPI score of everyone else with KPIs', unit: 'pct', scope: 'company' },
  // Trainer KPIs (Part B, 2026-10-22): the first two need the person's trainer record.
  output_rating: { label: 'output assessment rating by participants, trainings ended this month', unit: 'rating', trainer: true },
  report_days: { label: 'days from last training day to training report sent, trainings ended this month', unit: 'days', trainer: true },
  new_activities: { label: 'new teambuilding activities approved by Management this month', unit: 'count', weekly: true },
  // 360 rating (Part C): average stars received in closed rating rounds of this month (lib/rating360.ts).
  rating_360: { label: 'average 360 rating received, closed rounds this month', unit: 'rating' },
  // 1-to-1 (2026-10-25, lib/oneToOne.ts): sessions held this month, from the server (sessions are private).
  one_to_ones: { label: '1-to-1 sessions held this month', unit: 'count', weekly: true },
};

export const GROUP_LABELS: Record<KpiGroup, string> = { sales: 'Sales', admin: 'Admin and operations', trainer: 'Trainer', management: 'Management', other: 'Other' };
export const UNIT_LABELS: Record<KpiUnit, string> = { rm: 'RM', count: 'Number', pct: '%', days: 'Days', rating: 'Rating (1-5)' };
export const LIGHT_LABELS: Record<Light, string> = { green: 'Green', amber: 'Amber', red: 'Red', grey: 'Grey' };

const T = (target: number): Pick<KpiDef, 'scoring' | 'target' | 'bands'> => ({ scoring: 'target', target, bands: { higher: true, green: target, amber: target * 0.6, red: null } });
const HI = (green: number, amber: number, red: number | null, target = green): Pick<KpiDef, 'scoring' | 'target' | 'bands'> => ({ scoring: 'bands', target, bands: { higher: true, green, amber, red } });
const LO = (green: number, amber: number, red: number | null, target = green): Pick<KpiDef, 'scoring' | 'target' | 'bands'> => ({ scoring: 'bands', target, bands: { higher: false, green, amber, red } });

export const BUILT_IN_KPIS: KpiDef[] = [
  // Sales
  { id: 'closing_rm', name: 'Closing RM', group: 'sales', description: 'Sales won this month, for the deal owner.', measure: 'won', unit: 'rm', ...T(30000) },
  { id: 'closing_count', name: 'Number of closings', group: 'sales', description: 'Deals won this month.', measure: 'won_count', unit: 'count', ...T(4) },
  { id: 'proposals', name: 'Proposals sent', group: 'sales', description: 'Proposals sent this month.', measure: 'proposals', unit: 'count', ...T(8) },
  { id: 'appointments', name: 'Appointments', group: 'sales', description: 'Appointments logged this month.', measure: 'appointments', unit: 'count', ...T(12) },
  { id: 'new_followups', name: 'Follow-up on new customers', group: 'sales', description: 'Different new customers (no earlier won deal) followed up each week.', measure: 'new_followups', unit: 'count', ...HI(10, 5, 1) },
  { id: 'gp_own', name: 'Gross profit', group: 'sales', description: 'Overall gross profit % of own trainings held this month. Bands are the company GP setting.', measure: 'gp_own', unit: 'pct', ...HI(50, 40, 30) },
  { id: 'win_rate', name: 'Win rate', group: 'sales', description: 'Deals won ÷ proposals sent this month.', measure: 'win_rate', unit: 'pct', ...HI(30, 20, 10) },
  { id: 'new_clients', name: 'New clients won', group: 'sales', description: 'Deals won from clients who never won a deal before.', measure: 'new_clients', unit: 'count', ...T(2) },
  { id: 'quote_speed', name: 'Quotation speed', group: 'sales', description: 'Average days from client approved to quotation sent.', measure: 'quote_speed', unit: 'days', ...LO(2, 5, null) },
  { id: 'collect_days', name: 'Days to get paid', group: 'sales', description: 'Average days from invoice to client payment, on own deals.', measure: 'collect_days', unit: 'days', ...LO(30, 60, null) },
  { id: 'overdue_followups', name: 'Overdue follow-ups', group: 'sales', description: 'Open deals with a follow-up overdue, as of today.', measure: 'overdue_followups', unit: 'count', ...LO(0, 3, null) },
  { id: 'pipeline_cover', name: 'Pipeline cover', group: 'sales', description: 'Expected sales for the month (won + open deals × their chance) ÷ Closing RM target.', measure: 'pipeline_cover', unit: 'pct', ...HI(100, 70, 40) },
  { id: 'public_pax', name: 'Public programme', group: 'sales', description: 'Public programme pax, typed in weekly.', measure: 'typed', typedAgg: 'sum', unit: 'count', ...T(6) },
  { id: 'trainer_day', name: 'Trainer opportunity day', group: 'sales', description: 'Events, typed in weekly.', measure: 'typed', typedAgg: 'sum', unit: 'count', ...T(1) },
  // Admin and operations
  { id: 'perf_rating', name: 'Performance rating (1-5)', group: 'admin', description: 'A 1-5 rating typed in each week; the target is the month total.', measure: 'typed', typedAgg: 'sum', unit: 'rating', ...T(25) },
  { id: 'claims', name: 'Claim submissions', group: 'admin', description: 'HRDC claims recorded, plus any typed.', measure: 'claims', plusTyped: true, unit: 'count', ...T(1) },
  { id: 'claim_days', name: 'Claim submission speed', group: 'admin', description: 'Average days from the last training day to the HRDC claim, for claims recorded this month.', measure: 'claim_days', unit: 'days', ...LO(7, 14, null) },
  { id: 'venues', name: 'Venue database', group: 'admin', description: 'Venues added, plus any typed.', measure: 'venues', plusTyped: true, unit: 'count', ...T(20) },
  { id: 'grant_on_time', name: 'HRDC grant approved on time', group: 'admin', description: 'HRDC trainings this month whose grant step was ticked at least the set days before training.', measure: 'grant_on_time', unit: 'pct', param: 7, ...HI(100, 80, 60) },
  { id: 'docs_days', name: 'Post-training documents', group: 'admin', description: 'Average days to finish the post-training documents; ones still open count the days so far.', measure: 'docs_days', unit: 'days', ...LO(7, 14, null) },
  { id: 'invoice_days', name: 'Invoice speed', group: 'admin', description: 'Average days from the last training day to the client invoice.', measure: 'invoice_days', unit: 'days', ...LO(3, 7, null) },
  { id: 'hrdc_shortfall', name: 'HRDC shortfall', group: 'admin', description: 'How much less HRDC paid than expected, as % of claims paid this month.', measure: 'hrdc_shortfall', unit: 'pct', ...LO(1, 3, null) },
  // Trainer (Joel, 2026-10-22): output assessment 4.5+ green, 4.0-4.49 amber, below red; report sent within 2 days green,
  // 3-5 amber, 6-7 red, later grey; new activities 3 a month green, 2 amber, 1 red, 0 grey.
  { id: 'output_rating', name: 'Output assessment rating', group: 'trainer', description: 'Average rating (1-5) by participants on the training reports of trainings ended this month.', measure: 'output_rating', unit: 'rating', ...HI(4.5, 4, null) },
  { id: 'report_days', name: 'Trainer feedback speed', group: 'trainer', description: 'Average days from the last training day to the training report sent; reports not sent yet count the days so far.', measure: 'report_days', unit: 'days', ...LO(2, 5, 7) },
  { id: 'new_activities', name: 'Design new activity', group: 'trainer', description: 'New teambuilding activities this person added that Management approved this month.', measure: 'new_activities', unit: 'count', ...HI(3, 2, 1) },
  // Everyone. Hidden (appraisal Part B now, not a KPI); kept so old months still show it.
  { id: 'rating_360', name: '360 rating', group: 'other', description: 'Average stars (1-5) teammates gave in the 360 rating rounds of this month, once Management closes the round. Now part of the appraisal (attitude), not a KPI.', measure: 'rating_360', unit: 'rating', ...HI(4.5, 4, 3), hidden: true },
  { id: 'one_to_ones', name: '1-to-1 sessions held', group: 'other', description: '1-to-1 sessions held this month (marked Meeting done). Counts for the staff member and for the person running them.', measure: 'one_to_ones', unit: 'count', ...T(1) },
  // Management
  { id: 'gp_company', name: 'Company gross profit', group: 'management', description: 'Overall gross profit % of every training held this month. Bands are the company GP setting.', measure: 'gp_company', unit: 'pct', ...HI(50, 40, 30) },
  { id: 'team_avg', name: 'Team average KPI score', group: 'management', description: 'Average KPI score of everyone else with KPIs.', measure: 'team_avg', unit: 'pct', ...T(80) },
];

export interface ScorePoints { green: number; amber: number; red: number; grey: number }
export const DEFAULT_POINTS: ScorePoints = { green: 100, amber: 60, red: 30, grey: 0 };
// Company gross profit bands (Joel, 2026-10-22): 50%+ green, 40-49.9% amber, 30-39.9% red, below 30% grey.
export const DEFAULT_GP_BANDS: Bands = { higher: true, green: 50, amber: 40, red: 30 };

export interface KpiLibrary {
  defs: KpiDef[];                                  // built-ins with Management's changes, then custom ones
  points: ScorePoints;
  gpBands: Bands;
  overrides: Record<string, Partial<KpiDef>>;
  custom: KpiDef[];
}

const num = (v: any, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

export function readBands(v: any, fallback: Bands): Bands {
  if (!v || typeof v !== 'object') return fallback;
  return {
    higher: typeof v.higher === 'boolean' ? v.higher : fallback.higher,
    green: num(v.green, fallback.green),
    amber: num(v.amber, fallback.amber),
    red: v.red === null ? null : num(v.red, fallback.red ?? 0),
  };
}

const UNITS: KpiUnit[] = ['rm', 'count', 'pct', 'days', 'rating'];
function readDef(base: KpiDef, ch: any): KpiDef {
  if (!ch || typeof ch !== 'object') return base;
  return {
    ...base,
    name: typeof ch.name === 'string' && ch.name.trim() ? ch.name.trim() : base.name,
    description: typeof ch.description === 'string' ? ch.description : base.description,
    scoring: ch.scoring === 'target' || ch.scoring === 'bands' ? ch.scoring : base.scoring,
    target: num(ch.target, base.target),
    bands: readBands(ch.bands, base.bands),
    param: ch.param === undefined ? base.param : num(ch.param, base.param ?? 0),
    hidden: typeof ch.hidden === 'boolean' ? ch.hidden : base.hidden,
    // Custom KPIs may also change how they are counted.
    ...(base.custom ? {
      group: (GROUP_LABELS as any)[ch.group] ? ch.group : base.group,
      measure: MEASURE_INFO[ch.measure] ? ch.measure : base.measure,
      unit: UNITS.includes(ch.unit) ? ch.unit : base.unit,
      typedAgg: ch.typedAgg === 'average' ? 'average' : 'sum',
      plusTyped: !!ch.plusTyped,
    } : {}),
  };
}

export function readKpiLibrary(data: any): KpiLibrary {
  const overrides: Record<string, Partial<KpiDef>> = data?.overrides && typeof data.overrides === 'object' ? data.overrides : {};
  const custom: KpiDef[] = (Array.isArray(data?.custom) ? data.custom : [])
    .filter((c: any) => c && typeof c.id === 'string' && c.id && typeof c.name === 'string')
    .map((c: any) => readDef({ id: c.id, name: c.name, group: 'other', description: '', measure: 'typed', typedAgg: 'sum', unit: 'count', ...T(1), custom: true }, c));
  const p = data?.points || {};
  return {
    defs: [...BUILT_IN_KPIS.map(b => readDef(b, overrides[b.id])), ...custom],
    points: { green: num(p.green, DEFAULT_POINTS.green), amber: num(p.amber, DEFAULT_POINTS.amber), red: num(p.red, DEFAULT_POINTS.red), grey: num(p.grey, DEFAULT_POINTS.grey) },
    gpBands: readBands(data?.gpBands, DEFAULT_GP_BANDS),
    overrides, custom,
  };
}

// The library in use, kept current by useKpiLibrary (App.tsx), like the follow-up rules.
let active: KpiLibrary = readKpiLibrary(null);
export function setActiveKpiLibrary(l: KpiLibrary) { active = l; }
export function activeKpiLibrary(): KpiLibrary { return active; }

export function kpiDef(id: string): KpiDef | undefined {
  return active.defs.find(d => d.id === id);
}

// Gross profit KPIs always use the company GP bands, so the KPI page, Project P&L and the estimator agree.
export const isGpMeasure = (measure: string) => measure === 'gp_own' || measure === 'gp_company';

export function bandLight(value: number, b: Bands): Light {
  if (b.higher) {
    if (value >= b.green) return 'green';
    if (value >= b.amber) return 'amber';
    return b.red === null || value >= b.red ? 'red' : 'grey';
  }
  if (value <= b.green) return 'green';
  if (value <= b.amber) return 'amber';
  return b.red === null || value <= b.red ? 'red' : 'grey';
}

export function gpLight(pct: number): Light {
  return bandLight(pct, active.gpBands);
}

// Problems with a set of bands, in plain words ('' when fine).
export function bandsProblem(b: Bands): string {
  if (![b.green, b.amber].every(Number.isFinite) || (b.red !== null && !Number.isFinite(b.red))) return 'Enter a number for each colour.';
  if (b.higher) {
    if (!(b.green > b.amber)) return 'Green must be above amber.';
    if (b.red !== null && !(b.amber > b.red)) return 'Amber must be above red.';
  } else {
    if (!(b.green < b.amber)) return 'Green must be below amber.';
    if (b.red !== null && !(b.amber < b.red)) return 'Amber must be below red.';
  }
  return '';
}

const n = (v: number) => String(Math.round(v * 100) / 100);
// "Green 50 and up · Amber 40 and up · Red 30 and up · Grey below 30"
export function bandsText(b: Bands, unit: KpiUnit): string {
  const u = (v: number) => (unit === 'pct' ? `${n(v)}%` : unit === 'rm' ? `RM ${n(v)}` : unit === 'days' ? `${n(v)} days` : n(v));
  if (b.higher) {
    return [`Green ${u(b.green)}+`, `amber ${u(b.amber)}+`, b.red === null ? 'red below' : `red ${u(b.red)}+`, ...(b.red === null ? [] : [`grey below ${u(b.red)}`])].join(' · ');
  }
  return [`Green ${u(b.green)} or less`, `amber ${u(b.amber)} or less`, b.red === null ? 'red above' : `red ${u(b.red)} or less`, ...(b.red === null ? [] : [`grey above ${u(b.red)}`])].join(' · ');
}

// ---------- KPI sets (old templates become ready-made starting sets) ----------
// One KPI in a person's set, saved on reps/{memberId}.kpiSet.items. `slot` is where its typed weekly numbers are
// kept in month_kpis (the old salesFigure / proposals / preview / extraMetric keys for the KPIs the old templates
// had, so typed history carries on; the KPI's id for anything new).
export interface KpiSetItem {
  kpiId: string;
  weight: number;          // % of the score, all items add up to 100
  slot: string;
  label?: string;          // a name for this person only (e.g. "Preview" for appointments)
  target?: number;
  bands?: Bands;
  param?: number;
}

export interface KpiPreset { id: string; name: string; description: string; items: KpiSetItem[] }

export const KPI_PRESETS: KpiPreset[] = [
  {
    id: 'sales_standard',
    name: 'Sales: closing, appointments, proposals',
    description: 'Closing RM 60%, Appointment 20%, Proposal 20%. All counted from deals.',
    items: [
      { kpiId: 'closing_rm', weight: 60, slot: 'salesFigure' },
      { kpiId: 'appointments', weight: 20, slot: 'preview', label: 'Appointment', target: 25 },
      { kpiId: 'proposals', weight: 20, slot: 'proposals', label: 'Proposal', target: 120 },
    ],
  },
  {
    id: 'sales_public',
    name: 'Sales: public programmes',
    description: 'Closing RM 60%, Appointment 20%, Public Program pax 20%.',
    items: [
      { kpiId: 'closing_rm', weight: 60, slot: 'salesFigure', target: 60000 },
      { kpiId: 'appointments', weight: 20, slot: 'proposals', label: 'Appointment' },
      { kpiId: 'public_pax', weight: 20, slot: 'preview', label: 'Public Program' },
    ],
  },
  {
    id: 'sales_trainer',
    name: 'Sales and trainer',
    description: 'Closing RM 50%, Preview 17%, Proposal 17%, Trainer Opportunity Day 16%.',
    items: [
      { kpiId: 'closing_rm', weight: 50, slot: 'salesFigure' },
      { kpiId: 'appointments', weight: 17, slot: 'preview', label: 'Preview', target: 1 },
      { kpiId: 'proposals', weight: 17, slot: 'proposals', label: 'Proposal' },
      { kpiId: 'trainer_day', weight: 16, slot: 'extraMetric' },
    ],
  },
  {
    id: 'admin_ops',
    name: 'Admin: rating, claims, venues',
    description: 'Performance rating 50%, Claim submission 40%, Venue database 10%. Claims and venues counted automatically, plus typed.',
    items: [
      { kpiId: 'perf_rating', weight: 50, slot: 'salesFigure', label: 'Perf. Rating (1-5)' },
      { kpiId: 'claims', weight: 40, slot: 'proposals', label: 'Claim Submission' },
      { kpiId: 'venues', weight: 10, slot: 'preview', label: 'Venue Database' },
    ],
  },
];

export const presetById = (id?: string) => KPI_PRESETS.find(p => p.id === id);

// KPIs that are not results and so never count in the appraisal's KPI part (Part A): attitude is Part B.
export const NOT_IN_APPRAISAL = ['rating_360'];
export const appraisalSetItems = (items: KpiSetItem[]): KpiSetItem[] => items.filter(i => !NOT_IN_APPRAISAL.includes(i.kpiId));

// The usual typed-number slot for a KPI added to a set: the old keys for the three deal KPIs (other screens
// still look them up by these keys), the KPI's id for the rest; never one already used in the set.
export function slotFor(kpiId: string, used: string[]): string {
  const usual: Record<string, string> = { closing_rm: 'salesFigure', proposals: 'proposals', appointments: 'preview' };
  const want = usual[kpiId] || kpiId;
  if (!used.includes(want)) return want;
  let i = 2;
  while (used.includes(`${kpiId}_${i}`)) i++;
  return `${kpiId}_${i}`;
}

export function newCustomKpiId(): string {
  return `custom_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
