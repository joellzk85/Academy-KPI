// Weekly presentation (Joel, 2026-10-21). Everyone has a Present tab on their KPI page; Management also presents
// the company's overall performance (Joel, without KPIs, from the Present item on his workspace menu).
// Nothing here is typed: every slide is counted from deals, the KPI month, the check-in, touch points,
// To-dos and money, so the numbers always match the rest of the CRM.
// Each person's slide choices are saved in present_prefs/{memberId} (readable by the team, so Management's
// meeting mode can play each person's own choice). Action points from a meeting are To-dos (lib/tasks.ts)
// with source 'meeting', a deadline and the responsible person.

import {
  addDays, dealOwnerId, dealProposalDate, dealAppointmentDate, dealStage, dealValue, dealWonDate,
  FUNDING_LABELS, FundingType, OPEN_STAGES, DealStage, trainingEndDate,
} from './deals';
import { followUpNotes } from './followUps';
import type { KpiSources } from './kpi';
import { expectedFor, isPaid, MoneyIn, MoneySettings } from './money';

// ---------- Periods ----------
export type PeriodKey = 'week' | 'month' | 'ytd' | 'year12' | 'all';
export const PERIOD_LABELS: Record<PeriodKey, string> = {
  week: 'Last 7 days', month: 'This month', ytd: 'Year to date', year12: 'Last 12 months', all: 'All time',
};
export const PERIOD_KEYS: PeriodKey[] = ['week', 'month', 'ytd', 'year12', 'all'];

export interface Range { from: string; to: string }
export interface Period extends Range { key: PeriodKey; label: string; prev: Range | null; prevLabel: string }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dm = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
const monthName = (iso: string) => new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
function lastOfMonth(y: number, m: number): number { return new Date(y, m, 0).getDate(); }
function monthStart(iso: string, back: number): string {
  const d = new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1 - back, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export function periodOf(key: PeriodKey, today: string): Period {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)), d = Number(today.slice(8, 10));
  if (key === 'week') {
    const from = addDays(today, -6);
    return { key, from, to: today, label: `Last 7 days (${dm(from)} – ${dm(today)})`, prev: { from: addDays(today, -13), to: addDays(today, -7) }, prevLabel: 'the 7 days before' };
  }
  if (key === 'month') {
    const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y;
    const prevTo = `${py}-${String(pm).padStart(2, '0')}-${String(Math.min(d, lastOfMonth(py, pm))).padStart(2, '0')}`;
    return { key, from: `${today.slice(0, 7)}-01`, to: today, label: `${monthName(today)} to date`, prev: { from: `${prevTo.slice(0, 7)}-01`, to: prevTo }, prevLabel: 'the same days last month' };
  }
  if (key === 'ytd') {
    const prevTo = `${y - 1}-${today.slice(5, 7)}-${String(Math.min(d, lastOfMonth(y - 1, m))).padStart(2, '0')}`;
    return { key, from: `${y}-01-01`, to: today, label: `${y} to date`, prev: { from: `${y - 1}-01-01`, to: prevTo }, prevLabel: `the same time in ${y - 1}` };
  }
  if (key === 'year12') {
    const from = addDays(today, -364);
    return { key, from, to: today, label: `Last 12 months (${dm(from)} ${from.slice(0, 4)} – ${dm(today)} ${y})`, prev: { from: addDays(from, -365), to: addDays(from, -1) }, prevLabel: 'the 12 months before' };
  }
  return { key, from: '0000-01-01', to: today, label: 'All time', prev: null, prevLabel: '' };
}

export const inRange = (date: string, r: Range | null) => !!r && !!date && date >= r.from && date <= r.to;

// Trend buckets around a period: weekly for the last 7 days (8 weeks), monthly for month / year views, yearly for all time.
export interface Bucket extends Range { label: string }
export function trendBuckets(p: Period, today: string, earliest = ''): Bucket[] {
  if (p.key === 'week') {
    return Array.from({ length: 8 }, (_, i) => {
      const to = addDays(today, -7 * (7 - i)), from = addDays(to, -6);
      return { from, to, label: i === 7 ? 'This week' : dm(from) };
    });
  }
  if (p.key === 'all') {
    const first = Number((earliest || today).slice(0, 4)), last = Number(today.slice(0, 4));
    const ys = [];
    for (let yr = Math.max(first, last - 9); yr <= last; yr++) ys.push({ from: `${yr}-01-01`, to: `${yr}-12-31`, label: String(yr) });
    return ys;
  }
  const count = p.key === 'ytd' ? Number(today.slice(5, 7)) : 12;
  return Array.from({ length: count }, (_, i) => {
    const from = monthStart(today, count - 1 - i);
    const yy = Number(from.slice(0, 4)), mm = Number(from.slice(5, 7));
    return { from, to: `${from.slice(0, 7)}-${String(lastOfMonth(yy, mm)).padStart(2, '0')}`, label: `${MONTHS[mm - 1]}${p.key === 'ytd' ? '' : ` ${String(yy).slice(2)}`}` };
  });
}

// ---------- Slide lists ----------
export type PersonSlide = 'scorecard' | 'numbers' | 'checkin' | 'won' | 'pipeline' | 'next' | 'touch' | 'heatmap' | 'lost' | 'admin' | 'actions' | 'projection';
export type CompanySlide = 'headline' | 'trend' | 'team' | 'funnel' | 'clients' | 'funding' | 'programmes' | 'collect' | 'profit' | 'touch' | 'lost' | 'trainings' | 'actions' | 'projection' | 'logins';

export interface SlideInfo<K> { key: K; label: string; hint: string; admin?: boolean; manager?: boolean }

export const PERSON_SLIDES: SlideInfo<PersonSlide>[] = [
  { key: 'scorecard', label: 'KPI scorecard', hint: 'Score ring and each KPI against its target this month' },
  { key: 'numbers', label: 'My numbers', hint: 'Appointments, proposals, deals won and client contacts, with up or down against the period before' },
  { key: 'checkin', label: 'Weekly check-in', hint: 'What I got done, where I need help, target date' },
  { key: 'won', label: 'Deals won', hint: 'Each deal won, with client, programme and RM' },
  { key: 'pipeline', label: 'My pipeline', hint: 'Funnel of open deals at each stage, with their value' },
  { key: 'projection', label: 'Sales projection', hint: 'Won plus open deals by Hot / Warm / Cold, up to 6 months ahead' },
  { key: 'next', label: 'Coming up', hint: 'Appointments, follow-ups, trainings and To-dos in the next 7 days' },
  { key: 'touch', label: 'Client touch points', hint: 'Who I contacted and how (call, WhatsApp, visit…)' },
  { key: 'heatmap', label: 'Activity heatmap', hint: 'Every day of the last 12 weeks, darker = busier' },
  { key: 'lost', label: 'Deals lost', hint: 'Deals lost and why' },
  { key: 'admin', label: 'Operations', hint: 'HRDC claims submitted, venues added, trainings delivered and coming up', admin: true },
  { key: 'actions', label: 'My action points', hint: 'Action points from earlier meetings still open' },
];

export const COMPANY_SLIDES: SlideInfo<CompanySlide>[] = [
  { key: 'headline', label: 'Headline numbers', hint: 'Sales won, deals, proposals, appointments, win rate, average deal, with up or down' },
  { key: 'trend', label: 'Sales and cash trend', hint: 'Bars of sales won against cash collected, over time' },
  { key: 'team', label: 'Team leaderboard', hint: 'Sales, proposals and appointments per person, and this month\'s KPI score' },
  { key: 'funnel', label: 'Pipeline funnel', hint: 'Deals started in the period: how many reached each stage, and open pipeline value' },
  { key: 'projection', label: 'Sales projection', hint: 'Won plus open deals by Hot / Warm / Cold, up to 6 months ahead, for the team or one person' },
  { key: 'clients', label: 'Best clients and industries', hint: 'Top clients by sales, and sales by industry' },
  { key: 'funding', label: 'Funding mix', hint: 'HRDC, Direct pay and HRDC + top-up, by RM' },
  { key: 'programmes', label: 'Top programmes', hint: 'Programmes that sold the most' },
  { key: 'collect', label: 'Money not collected', hint: 'What clients and HRDC still owe, by how overdue' },
  { key: 'profit', label: 'Profit', hint: 'Income, costs and profit from trainings in the period (Project P&L)', manager: true },
  { key: 'touch', label: 'Client contact heatmap', hint: 'Touch points per person per week, and clients nobody contacted in 60 days' },
  { key: 'lost', label: 'Why we lost deals', hint: 'Lost deals by reason, with RM' },
  { key: 'trainings', label: 'Trainings', hint: 'Trainings delivered in the period and coming up in the next 30 days' },
  { key: 'actions', label: 'Open action points', hint: 'Every meeting action point not done yet, overdue first' },
  { key: 'logins', label: 'Login log', hint: 'Time each person spent in the CRM: lights for the last working days and a 4-week heatmap', manager: true },
];

export function defaultPersonSlides(role?: string): PersonSlide[] {
  return role === 'admin'
    ? ['scorecard', 'checkin', 'admin', 'heatmap', 'next', 'actions']
    : ['scorecard', 'numbers', 'checkin', 'won', 'pipeline', 'next', 'actions'];
}
export const DEFAULT_COMPANY_SLIDES: CompanySlide[] = ['headline', 'trend', 'team', 'funnel', 'clients', 'collect', 'touch', 'actions'];

export interface PresentPrefs { slides?: PersonSlide[]; period?: PeriodKey; companySlides?: CompanySlide[]; companyPeriod?: PeriodKey }

export function chosenPersonSlides(prefs: PresentPrefs | undefined, role?: string): PersonSlide[] {
  const valid = (prefs?.slides || []).filter(k => PERSON_SLIDES.some(s => s.key === k && (!s.admin || role !== 'rep')));
  return valid.length ? valid : defaultPersonSlides(role);
}
export function chosenCompanySlides(prefs: PresentPrefs | undefined): CompanySlide[] {
  const valid = (prefs?.companySlides || []).filter(k => COMPANY_SLIDES.some(s => s.key === k));
  return valid.length ? valid : DEFAULT_COMPANY_SLIDES;
}

// ---------- Counting ----------
export interface PresentData {
  deals: any[];
  clients: any[];
  programmes: any[];
  touchPoints: any[];
  tasks: any[];
  ins: MoneyIn[];
  venues: any[];
  kpi?: KpiSources;          // everything the KPI scorecard counts from (lib/useKpiSources.ts)
}

const ymd = (v: any): string => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '');

export function clientNameOf(p: any, clients: any[]): string {
  return clients.find(c => c.id === p?.clientId)?.companyName || p?.client || p?.companyName || 'No client';
}
export function programmeNameOf(p: any, programmes: any[]): string {
  return programmes.find(x => x.id === p?.programmeId)?.name || p?.courseName || p?.enquiryNote || 'Programme not set';
}

// One client contact: a touch point typed on the client page, or a follow-up note on a deal.
export interface Touch { date: string; byId: string; clientId: string; how: string }
export function touchesOf(d: PresentData): Touch[] {
  const out: Touch[] = d.touchPoints.filter(t => ymd(t.date)).map(t => ({ date: ymd(t.date), byId: t.byId, clientId: t.clientId, how: t.how || 'other' }));
  d.deals.forEach(p => followUpNotes(p).forEach(n => out.push({ date: ymd(n.date), byId: n.byId || dealOwnerId(p), clientId: p.clientId || '', how: n.how || 'other' })));
  return out;
}

// Everything a person did, by day: new deals, appointments, proposals, approvals, quotations, wins, contacts and To-dos ticked.
export function activityDates(d: PresentData, personId: string): string[] {
  const out: string[] = [];
  d.deals.filter(p => dealOwnerId(p) === personId).forEach(p => {
    [ymd(p.requestDate), dealAppointmentDate(p), dealProposalDate(p), ymd(p.agreedDate), ymd(p.quotationSentDate), dealWonDate(p)].forEach(x => x && out.push(x));
  });
  touchesOf(d).filter(t => t.byId === personId).forEach(t => out.push(t.date));
  d.tasks.filter(t => t.status === 'Done' && (t.doneById === personId || (!t.doneById && (t.assignedToIds || [t.assignedToId]).includes(personId)))).forEach(t => ymd(t.doneAt) && out.push(ymd(t.doneAt)));
  return out;
}

export interface PersonNumbers { appointments: number; proposals: number; won: number; wonRM: number; lost: number; touches: number; newDeals: number; tasksDone: number }
export function personNumbers(d: PresentData, personId: string, r: Range | null): PersonNumbers {
  const mine = d.deals.filter(p => dealOwnerId(p) === personId);
  const wonDeals = mine.filter(p => inRange(dealWonDate(p), r));
  return {
    appointments: mine.filter(p => inRange(dealAppointmentDate(p), r)).length,
    proposals: mine.filter(p => inRange(dealProposalDate(p), r)).length,
    won: wonDeals.length,
    wonRM: wonDeals.reduce((t, p) => t + dealValue(p), 0),
    lost: mine.filter(p => dealStage(p) === 'lost' && inRange(ymd(p.lostDate), r)).length,
    touches: touchesOf(d).filter(t => t.byId === personId && inRange(t.date, r)).length,
    newDeals: mine.filter(p => inRange(ymd(p.requestDate), r)).length,
    tasksDone: d.tasks.filter(t => t.status === 'Done' && inRange(ymd(t.doneAt), r) && (t.doneById === personId || (t.assignedToIds || [t.assignedToId]).includes(personId))).length,
  };
}

// Open pipeline: deals at each open stage, with value.
export const FUNNEL_STAGES: { stage: DealStage; label: string }[] = [
  { stage: 'lead', label: 'New' }, { stage: 'proposal', label: 'Proposal sent' }, { stage: 'agreed', label: 'Client approved' }, { stage: 'quoted', label: 'Quotation sent' },
];
export function openPipeline(deals: any[], ownerId?: string): { label: string; count: number; value: number }[] {
  const open = deals.filter(p => (!ownerId || dealOwnerId(p) === ownerId) && OPEN_STAGES.includes(dealStage(p)));
  return FUNNEL_STAGES.map(({ stage, label }) => {
    const list = open.filter(p => (dealStage(p) === 'appointment' ? 'lead' : dealStage(p)) === stage);
    return { label, count: list.length, value: list.reduce((t, p) => t + dealValue(p), 0) };
  });
}

// Conversion: of the deals started in the period, how many got to each step (by their dates).
export function conversionFunnel(deals: any[], r: Range | null): { label: string; count: number }[] {
  const started = deals.filter(p => inRange(ymd(p.requestDate), r));
  const reached = (p: any, st: string) => {
    const s = dealStage(p);
    if (st === 'won') return s === 'won';
    if (st === 'quoted') return s === 'won' || !!ymd(p.quotationSentDate);
    if (st === 'agreed') return s === 'won' || !!ymd(p.agreedDate) || !!ymd(p.quotationSentDate);
    return s === 'won' || !!dealProposalDate(p) || !!ymd(p.agreedDate);
  };
  return [
    { label: 'Deals started', count: started.length },
    { label: 'Proposal sent', count: started.filter(p => reached(p, 'proposal')).length },
    { label: 'Client approved', count: started.filter(p => reached(p, 'agreed')).length },
    { label: 'Quotation sent', count: started.filter(p => reached(p, 'quoted')).length },
    { label: 'Won', count: started.filter(p => reached(p, 'won')).length },
  ];
}

export interface Headline { wonRM: number; won: number; proposals: number; appointments: number; newDeals: number; lost: number; winRate: number; avgDeal: number; collected: number }
export function headline(d: PresentData, r: Range | null): Headline {
  const won = d.deals.filter(p => inRange(dealWonDate(p), r));
  const lost = d.deals.filter(p => dealStage(p) === 'lost' && inRange(ymd(p.lostDate), r)).length;
  const wonRM = won.reduce((t, p) => t + dealValue(p), 0);
  return {
    wonRM, won: won.length, lost,
    proposals: d.deals.filter(p => inRange(dealProposalDate(p), r)).length,
    appointments: d.deals.filter(p => inRange(dealAppointmentDate(p), r)).length,
    newDeals: d.deals.filter(p => inRange(ymd(p.requestDate), r)).length,
    winRate: won.length + lost > 0 ? Math.round((won.length / (won.length + lost)) * 100) : 0,
    avgDeal: won.length ? wonRM / won.length : 0,
    collected: d.ins.filter(m => isPaid(m) && inRange(ymd(m.paidDate), r)).reduce((t, m) => t + (Number(m.paidAmount) || 0), 0),
  };
}

// Sum of won RM grouped by a key, biggest first.
export function wonBy(deals: any[], r: Range | null, keyOf: (p: any) => string): { name: string; value: number; count: number }[] {
  const m = new Map<string, { value: number; count: number }>();
  deals.filter(p => inRange(dealWonDate(p), r)).forEach(p => {
    const k = keyOf(p) || 'Not set';
    const e = m.get(k) || { value: 0, count: 0 };
    e.value += dealValue(p); e.count += 1;
    m.set(k, e);
  });
  return [...m.entries()].map(([name, e]) => ({ name, ...e })).sort((a, b) => b.value - a.value);
}

export const fundingName = (p: any) => FUNDING_LABELS[p?.fundingType as FundingType] || 'Not set';

// Money still to come in (unpaid invoices and HRDC claims), by age since the invoice or claim date.
export const AGE_BUCKETS = ['0–30 days', '31–60 days', '61–90 days', 'Over 90 days'];
export function notCollected(ins: MoneyIn[], s: MoneySettings, today: string) {
  const open = ins.filter(m => !isPaid(m));
  const ageOf = (m: MoneyIn) => { const dte = ymd(m.invoiceDate); return dte ? Math.round((Date.parse(today) - Date.parse(dte)) / 86400000) : 0; };
  const buckets = AGE_BUCKETS.map(label => ({ label, client: 0, hrdc: 0 }));
  open.forEach(m => {
    const a = ageOf(m), i = a <= 30 ? 0 : a <= 60 ? 1 : a <= 90 ? 2 : 3;
    buckets[i][m.source === 'hrdc' ? 'hrdc' : 'client'] += expectedFor(m, s);
  });
  const total = open.reduce((t, m) => t + expectedFor(m, s), 0);
  return { total, hrdc: open.filter(m => m.source === 'hrdc').reduce((t, m) => t + expectedFor(m, s), 0), buckets, oldest: [...open].sort((a, b) => ageOf(b) - ageOf(a)).slice(0, 6).map(m => ({ m, age: ageOf(m) })) };
}

// Trainings (won deals) whose last day falls in a range.
export function trainingsIn(deals: any[], r: Range): any[] {
  return deals.filter(p => dealStage(p) === 'won' && inRange(trainingEndDate(p) || ymd(p.trainingDate), r))
    .sort((a, b) => ymd(a.trainingDate).localeCompare(ymd(b.trainingDate)));
}

// Clients nobody has contacted (touch point, follow-up, or a deal step) in the last `days` days, among clients with any deal.
export function quietClients(d: PresentData, today: string, days = 60): { client: any; last: string }[] {
  const last = new Map<string, string>();
  const bump = (id: string, date: string) => { if (id && date && date > (last.get(id) || '')) last.set(id, date); };
  touchesOf(d).forEach(t => bump(t.clientId, t.date));
  d.deals.forEach(p => [ymd(p.requestDate), dealAppointmentDate(p), dealProposalDate(p), ymd(p.agreedDate), ymd(p.quotationSentDate), dealWonDate(p)].forEach(x => bump(p.clientId, x)));
  const cutoff = addDays(today, -days);
  return d.clients.filter(c => last.has(c.id) && (last.get(c.id) as string) < cutoff)
    .map(c => ({ client: c, last: last.get(c.id) as string }))
    .sort((a, b) => b.last.localeCompare(a.last));
}

// Up or down against the period before, as a whole percentage (null when there is nothing to compare).
export function change(now: number, before: number | null | undefined): number | null {
  if (before === null || before === undefined) return null;
  if (before === 0) return now === 0 ? 0 : null;
  return Math.round(((now - before) / Math.abs(before)) * 100);
}

// Action points: To-dos raised in a meeting.
export const isActionPoint = (t: any) => t?.source === 'meeting' && !t?.isDuplicate;
