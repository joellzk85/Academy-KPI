import React from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, GraduationCap, ListTodo, PhoneCall, UserCheck } from 'lucide-react';
import { Representative } from '../types';
import { KPI_LIGHT_BADGE, kpiBarClass, kpiLight, monthKpi, monthLabel, monthPrefix, weekIndexOf } from '../lib/kpi';
import { addDays, dealAppointmentDate, dealNeedsAttention, dealOwnerId, dealStage, dealValue, dealWonDate, formatDate, formatRM, trainingDateText } from '../lib/deals';
import { HOW_LABELS } from '../lib/followUps';
import { MoneySettings } from '../lib/money';
import { ProjectRow, projectTotals } from '../lib/projectPL';
import {
  activityDates, AGE_BUCKETS, change, clientNameOf, CompanySlide, conversionFunnel, fundingName, headline, inRange, isActionPoint,
  notCollected, openPipeline, Period, PersonSlide, personNumbers, PresentData, programmeNameOf, quietClients, Range, touchesOf,
  trainingsIn, trendBuckets, wonBy,
} from '../lib/present';
import { ProjectionSlide } from './SalesProjection';
import { LoginHeatmap } from './LoginCharts';
import { LoginRules, formatMinutes, heatColumns, lastWorkDays, loginLight } from '../lib/loginActivity';
import { metricsFor } from '../lib/kpi';
import { Bars, compactRM, Donut, DayHeatmap, Empty, Funnel, MatrixHeatmap, Panel, Ring, StatCard } from './PresentCharts';

// The slides of the weekly presentation (lib/present.ts has the counting and the slide lists).
// personSlides: one person's week; companySlides: Management's overall view. Each returns ready slides.

export interface Slide { key: string; title: string; subtitle?: string; body: React.ReactNode }

const ymd = (v: any): string => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '');
const grid2 = 'grid gap-4 lg:grid-cols-2';
const statGrid = 'grid grid-cols-2 gap-3 lg:grid-cols-3';

function List({ items, empty }: { items: { key: string; main: React.ReactNode; side?: React.ReactNode; tone?: 'danger' }[]; empty?: string }) {
  if (!items.length) return <Empty text={empty} />;
  return (
    <ul className="divide-y divide-line">
      {items.map(it => (
        <li key={it.key} className={`flex items-start justify-between gap-3 py-2.5 text-[15px] ${it.tone === 'danger' ? 'text-danger' : ''}`}>
          <span className="min-w-0">{it.main}</span>
          {it.side && <span className="shrink-0 text-right font-semibold tabular-nums">{it.side}</span>}
        </li>
      ))}
    </ul>
  );
}

// The latest check-in up to this week of the KPI month (the person may fill it in at the start or end of the week).
function checkInOf(rep: Representative, month: string, today: string) {
  const kpi: any = rep.kpi || {};
  const at = (key: string, w: number) => (Array.isArray(kpi[key]) ? kpi[key][w] : undefined);
  const upTo = monthPrefix(month) === today.slice(0, 7) ? weekIndexOf(today) : 4;
  for (let w = upTo; w >= 0; w--) {
    const progress = at('lastWeekProgressList', w) ?? (w === 0 ? kpi.lastWeekProgress : '');
    const help = at('helpNeededList', w) ?? (w === 0 ? kpi.helpNeeded : '');
    if (progress || help) {
      return {
        week: w, progress: progress || '', help: help || '',
        date: at('datelineList', w) ?? (w === 0 ? kpi.dateline || '' : ''),
        partner: at('accountabilityPartnerIdList', w) ?? (w === 0 ? kpi.accountabilityPartnerId || '' : ''),
        tagged: (at('taggedRepIdsList', w) ?? (w === 0 ? kpi.taggedRepIds || [] : [])) as string[],
        note: at('tagNoteList', w) ?? '',
      };
    }
  }
  return null;
}

function actionItems(tasks: any[], filter: (t: any) => boolean, nameOf: (id: string) => string, today: string) {
  return tasks.filter(t => isActionPoint(t) && t.status !== 'Done' && filter(t))
    .sort((a, b) => String(a.dateline || '9999').localeCompare(String(b.dateline || '9999')))
    .map(t => ({
      key: t.id,
      tone: (ymd(t.dateline) && ymd(t.dateline) < today ? 'danger' : undefined) as 'danger' | undefined,
      main: <><strong>{t.detail}</strong><span className="block text-sm text-ink-soft">{(t.assignedToIds || [t.assignedToId]).map(nameOf).join(', ')} · raised {formatDate(t.meetingDate || t.dateCreated)}</span></>,
      side: ymd(t.dateline) ? <>{ymd(t.dateline) < today && <AlertTriangle className="mr-1 inline h-4 w-4" />}{formatDate(t.dateline)}</> : 'No date',
    }));
}

// Small series per day (short periods) or per month (long ones), for the "My numbers" bars.
function seriesBuckets(p: Period, today: string): (Range & { label: string })[] {
  if (p.key === 'week' || p.key === 'month') {
    const out = [];
    for (let d = p.from; d <= p.to; d = addDays(d, 1)) out.push({ from: d, to: d, label: p.key === 'week' ? new Date(d).toLocaleDateString('en-GB', { weekday: 'short' }) : String(Number(d.slice(8, 10))) });
    return out;
  }
  return trendBuckets(p, today);
}

// ---------- One person ----------
export function personSlides(args: {
  rep: Representative; reps: { id: string; name: string }[]; keys: PersonSlide[]; data: PresentData; period: Period; month: string; today: string; animate: boolean;
}): Slide[] {
  const { rep, reps, keys, data, period, month, today, animate } = args;
  const nameOf = (id: string) => reps.find(r => r.id === id)?.name || 'Former team member';
  const mine = data.deals.filter(p => dealOwnerId(p) === rep.id);
  const now = personNumbers(data, rep.id, period);
  const before = period.prev ? personNumbers(data, rep.id, period.prev) : null;
  const was = (n: number | undefined, rm = false) => (period.prev && n !== undefined ? `${rm ? formatRM(n) : n} in ${period.prevLabel}` : undefined);
  const out: Slide[] = [];

  for (const key of keys) {
    if (key === 'scorecard') {
      const { rows, score } = monthKpi(rep, data.deals, month, { claims: data.ins, venues: data.venues });
      out.push({
        key, title: 'KPI scorecard', subtitle: monthLabel(month),
        body: (
          <div className="grid items-center gap-6 lg:grid-cols-[auto_1fr]">
            <div className="flex justify-center"><Ring pct={score} label={`${score}%`} sub="KPI score" size={220} /></div>
            <div className="space-y-4">
              {rows.map(({ m, total, pct }) => (
                <div key={m.key}>
                  <div className="flex flex-wrap justify-between gap-2 text-[15px]">
                    <span className="font-bold">{m.label} <span className="font-normal text-ink-soft">({Math.round(m.weight * 100)}%)</span></span>
                    <span className="tabular-nums text-ink-soft"><strong className="text-ink">{m.isRM ? formatRM(total) : total}</strong> of {m.isRM ? formatRM(m.targetVal) : m.targetVal} · {pct}%</span>
                  </div>
                  <div className="mt-1.5 h-4 overflow-hidden rounded-full bg-line"><div className={`h-full rounded-full ${kpiBarClass(pct)}`} style={{ width: `${pct}%` }} /></div>
                </div>
              ))}
              {rows[0] && (
                <Bars animate={animate} height={170} money={rows[0].m.isRM} data={rows[0].weeks.map((v, w) => ({ label: `Week ${w + 1}`, v }))} bars={[{ key: 'v', name: rows[0].m.label }]} />
              )}
            </div>
          </div>
        ),
      });
    } else if (key === 'numbers') {
      const series = seriesBuckets(period, today).map(b => {
        const n = personNumbers(data, rep.id, b);
        return { label: b.label, Appointments: n.appointments, Proposals: n.proposals, 'Client contacts': n.touches };
      });
      out.push({
        key, title: 'My numbers', subtitle: period.label,
        body: (
          <div className="space-y-5">
            <div className={statGrid}>
              <StatCard tone="accent" label="Sales won" value={formatRM(now.wonRM)} delta={change(now.wonRM, before?.wonRM)} sub={`${now.won} deal${now.won === 1 ? '' : 's'}`} />
              <StatCard label="Proposals sent" value={String(now.proposals)} delta={change(now.proposals, before?.proposals)} sub={was(before?.proposals)} />
              <StatCard label="Appointments" value={String(now.appointments)} delta={change(now.appointments, before?.appointments)} sub={was(before?.appointments)} />
              <StatCard label="Client contacts" value={String(now.touches)} delta={change(now.touches, before?.touches)} sub={was(before?.touches)} />
              <StatCard label="New deals" value={String(now.newDeals)} delta={change(now.newDeals, before?.newDeals)} sub={was(before?.newDeals)} />
              <StatCard label="To-dos done" value={String(now.tasksDone)} delta={change(now.tasksDone, before?.tasksDone)} sub={was(before?.tasksDone)} />
            </div>
            <Panel><Bars animate={animate} height={220} data={series} bars={[{ key: 'Appointments', name: 'Appointments' }, { key: 'Proposals', name: 'Proposals' }, { key: 'Client contacts', name: 'Client contacts' }]} /></Panel>
          </div>
        ),
      });
    } else if (key === 'checkin') {
      const ci = checkInOf(rep, month, today);
      out.push({
        key, title: 'Weekly check-in', subtitle: ci ? `${monthLabel(month)}, week ${ci.week + 1}` : monthLabel(month),
        body: !ci ? <Empty text="The weekly check-in isn't filled in yet. Fill it in on the KPI page." /> : (
          <div className={grid2}>
            <Panel title="What I got done"><p className="whitespace-pre-line text-lg">{ci.progress || '—'}</p></Panel>
            <Panel title="Where I need help"><p className="whitespace-pre-line text-lg">{ci.help || 'Nothing this week'}</p></Panel>
            <Panel title="Target date"><p className="text-lg font-semibold">{/^\d{4}-\d{2}-\d{2}$/.test(ci.date) ? formatDate(ci.date) : ci.date || '—'}</p></Panel>
            <Panel title="Accountability and help">
              <p className="flex items-center gap-2 text-lg"><UserCheck className="h-5 w-5 text-accent" /> {ci.partner ? nameOf(ci.partner) : 'No partner'}</p>
              {ci.tagged.length > 0 && <p className="mt-2 text-ink-soft">Asked for help: {ci.tagged.map(nameOf).join(', ')}{ci.note ? ` — "${ci.note}"` : ''}</p>}
            </Panel>
          </div>
        ),
      });
    } else if (key === 'won') {
      const won = mine.filter(p => inRange(dealWonDate(p), period)).sort((a, b) => dealValue(b) - dealValue(a));
      out.push({
        key, title: 'Deals won', subtitle: `${period.label} · ${won.length} deal${won.length === 1 ? '' : 's'}, ${formatRM(won.reduce((t, p) => t + dealValue(p), 0))}`,
        body: !won.length ? <Empty text="No deals won in this period." /> : (
          <div className={grid2}>
            <Panel title="Deals">
              <List items={won.slice(0, 10).map(p => ({ key: p.id, main: <><strong>{clientNameOf(p, data.clients)}</strong><span className="block text-sm text-ink-soft">{programmeNameOf(p, data.programmes)} · {fundingName(p)}</span></>, side: formatRM(dealValue(p)) }))} />
            </Panel>
            <Panel title="How they're paid"><Donut animate={animate} money data={wonBy(won, period, fundingName).map(x => ({ name: x.name, value: x.value }))} /></Panel>
          </div>
        ),
      });
    } else if (key === 'pipeline') {
      const pipe = openPipeline(data.deals, rep.id);
      const attention = mine.filter(p => dealNeedsAttention(p, today)).length;
      out.push({
        key, title: 'My pipeline', subtitle: 'Open deals today',
        body: (
          <div className="space-y-5">
            <div className={statGrid}>
              <StatCard tone="accent" label="Open pipeline value" value={formatRM(pipe.reduce((t, s) => t + s.value, 0))} sub={`${pipe.reduce((t, s) => t + s.count, 0)} open deals`} />
              <StatCard label="Close to winning" value={formatRM(pipe.slice(2).reduce((t, s) => t + s.value, 0))} sub="Client approved or quotation sent" />
              <StatCard tone={attention ? 'danger' : 'plain'} label="Need attention" value={String(attention)} sub="follow-ups late or nothing planned" />
            </div>
            <Panel title="Funnel"><Funnel money conversion={false} data={pipe} /></Panel>
          </div>
        ),
      });
    } else if (key === 'projection') {
      out.push({
        key, title: 'Sales projection', subtitle: 'Won and expected, month by month',
        body: <ProjectionSlide deals={data.deals} ownerId={rep.id} today={today} clientName={p => clientNameOf(p, data.clients)} storeKey={`present:${rep.id}`}
          monthlyTarget={metricsFor(rep).find(m => m.key === 'salesFigure' && m.auto === 'won')?.targetVal || 0} />,
      });
    } else if (key === 'next') {
      const until = addDays(today, 7);
      const soon = (d: string) => !!d && d >= today && d <= until;
      const appts = mine.filter(p => soon(dealAppointmentDate(p)) && (p.appointment?.status === 'booked' || dealAppointmentDate(p) >= today));
      const follow = mine.filter(p => ['lead', 'appointment', 'proposal', 'agreed', 'quoted'].includes(dealStage(p)) && ymd(p.followUpDate) && ymd(p.followUpDate) <= until);
      const trainings = mine.filter(p => dealStage(p) === 'won' && ymd(p.trainingDate) >= today && ymd(p.trainingDate) <= addDays(today, 14));
      const todos = data.tasks.filter(t => !t.isDuplicate && t.status !== 'Done' && (t.assignedToIds || [t.assignedToId]).includes(rep.id) && ymd(t.dateline) && ymd(t.dateline) <= until);
      const col = (icon: React.ReactNode, title: string, items: { key: string; main: React.ReactNode; side?: React.ReactNode; tone?: 'danger' }[]) => (
        <Panel><h4 className="mb-2 flex items-center gap-2 font-bold">{icon}{title} <span className="text-ink-soft">({items.length})</span></h4><List items={items.slice(0, 6)} empty="Nothing" /></Panel>
      );
      out.push({
        key, title: 'Coming up', subtitle: `Next 7 days (trainings: next 14 days)`,
        body: (
          <div className={grid2}>
            {col(<CalendarClock className="h-5 w-5 text-accent" />, 'Appointments', appts.map(p => ({ key: p.id, main: clientNameOf(p, data.clients), side: formatDate(dealAppointmentDate(p)) })))}
            {col(<PhoneCall className="h-5 w-5 text-accent" />, 'Follow-ups due', follow.map(p => ({ key: p.id, tone: ymd(p.followUpDate) < today ? 'danger' as const : undefined, main: clientNameOf(p, data.clients), side: formatDate(p.followUpDate) })))}
            {col(<GraduationCap className="h-5 w-5 text-accent" />, 'Trainings', trainings.map(p => ({ key: p.id, main: <>{clientNameOf(p, data.clients)}<span className="block text-sm text-ink-soft">{programmeNameOf(p, data.programmes)}</span></>, side: trainingDateText(p) })))}
            {col(<ListTodo className="h-5 w-5 text-accent" />, 'To-dos due', todos.map(t => ({ key: t.id, tone: ymd(t.dateline) < today ? 'danger' as const : undefined, main: t.detail, side: formatDate(t.dateline) })))}
          </div>
        ),
      });
    } else if (key === 'touch') {
      const touches = touchesOf(data).filter(t => t.byId === rep.id && inRange(t.date, period));
      const byHow = Object.entries(HOW_LABELS).map(([k, name]) => ({ name, value: touches.filter(t => t.how === k).length }));
      const byClient = new Map<string, number>();
      touches.forEach(t => byClient.set(t.clientId, (byClient.get(t.clientId) || 0) + 1));
      const top = [...byClient.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
      out.push({
        key, title: 'Client touch points', subtitle: `${period.label} · ${touches.length} contact${touches.length === 1 ? '' : 's'} with ${byClient.size} client${byClient.size === 1 ? '' : 's'}`,
        body: !touches.length ? <Empty text="No client contacts logged in this period." /> : (
          <div className={grid2}>
            <Panel title="How"><Donut animate={animate} data={byHow} centre={String(touches.length)} /></Panel>
            <Panel title="Clients contacted most">
              <List items={top.map(([id, n]) => ({ key: id || 'none', main: data.clients.find(c => c.id === id)?.companyName || 'Client not on the list', side: `${n}×` }))} />
            </Panel>
          </div>
        ),
      });
    } else if (key === 'heatmap') {
      out.push({ key, title: 'Activity heatmap', subtitle: 'Last 12 weeks: deals moved, contacts and To-dos done', body: <Panel><DayHeatmap dates={activityDates(data, rep.id)} today={today} /></Panel> });
    } else if (key === 'lost') {
      const lost = mine.filter(p => dealStage(p) === 'lost' && inRange(ymd(p.lostDate), period));
      const reasons = new Map<string, number>();
      lost.forEach(p => reasons.set(p.lostReason || 'Not given', (reasons.get(p.lostReason || 'Not given') || 0) + 1));
      out.push({
        key, title: 'Deals lost', subtitle: `${period.label} · ${lost.length} deal${lost.length === 1 ? '' : 's'}`,
        body: !lost.length ? <Empty text="No deals lost in this period." /> : (
          <div className={grid2}>
            <Panel title="Why"><Donut animate={animate} data={[...reasons.entries()].map(([name, value]) => ({ name, value }))} centre={String(lost.length)} /></Panel>
            <Panel title="Deals"><List items={lost.slice(0, 8).map(p => ({ key: p.id, main: <><strong>{clientNameOf(p, data.clients)}</strong><span className="block text-sm text-ink-soft">{p.lostReason || 'No reason'}{p.lostNote ? ` — ${p.lostNote}` : ''}</span></>, side: dealValue(p) ? compactRM(dealValue(p)) : '' }))} /></Panel>
          </div>
        ),
      });
    } else if (key === 'admin') {
      const claims = data.ins.filter(m => m.source === 'hrdc' && (m as any).createdById === rep.id && inRange(ymd(m.invoiceDate), period));
      const claimsBefore = period.prev ? data.ins.filter(m => m.source === 'hrdc' && (m as any).createdById === rep.id && inRange(ymd(m.invoiceDate), period.prev)).length : null;
      const venues = data.venues.filter(v => v.createdBy === rep.id && inRange(dayOfSaved(v.createdAt), period)).length;
      const delivered = trainingsIn(data.deals, period);
      const upcoming = data.deals.filter(p => dealStage(p) === 'won' && ymd(p.trainingDate) > today && ymd(p.trainingDate) <= addDays(today, 14)).sort((a, b) => ymd(a.trainingDate).localeCompare(ymd(b.trainingDate)));
      out.push({
        key, title: 'Operations', subtitle: period.label,
        body: (
          <div className="space-y-5">
            <div className={statGrid}>
              <StatCard tone="accent" label="HRDC claims submitted" value={String(claims.length)} delta={change(claims.length, claimsBefore)} sub={formatRM(claims.reduce((t, m) => t + (Number(m.amount) || 0), 0))} />
              <StatCard label="Venues added" value={String(venues)} />
              <StatCard label="Trainings delivered" value={String(delivered.length)} sub="whole company" />
            </div>
            <Panel title="Trainings in the next 14 days">
              <List items={upcoming.slice(0, 8).map(p => ({ key: p.id, main: <><strong>{clientNameOf(p, data.clients)}</strong><span className="block text-sm text-ink-soft">{programmeNameOf(p, data.programmes)}</span></>, side: trainingDateText(p) }))} empty="No trainings in the next 14 days." />
            </Panel>
          </div>
        ),
      });
    } else if (key === 'actions') {
      const open = actionItems(data.tasks, t => (t.assignedToIds || [t.assignedToId]).includes(rep.id), nameOf, today);
      const doneLately = data.tasks.filter(t => isActionPoint(t) && t.status === 'Done' && inRange(ymd(t.doneAt), period) && (t.assignedToIds || [t.assignedToId]).includes(rep.id)).length;
      out.push({
        key, title: 'My action points', subtitle: `${open.length} open · ${doneLately} done in this period`,
        body: <Panel><List items={open} empty="No open action points. Well done." /></Panel>,
      });
    }
  }
  return out;
}

// A saved time (number, Firestore date or text) as a Malaysia date.
function dayOfSaved(v: any): string {
  const ms = typeof v === 'number' ? v : typeof v?.toMillis === 'function' ? v.toMillis() : typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(ms) ? new Date(ms + 8 * 3600000).toISOString().slice(0, 10) : '';
}

// ---------- The company ----------
export function companySlides(args: {
  keys: CompanySlide[]; data: PresentData; period: Period; today: string; month: string; animate: boolean;
  reps: Representative[]; people: { id: string; name: string }[]; settings: MoneySettings; plRows: ProjectRow[];
  logins?: { rules: LoginRules; days: unknown[] | null; minutesOf: (memberId: string, day: string) => number; people: { id: string; name: string }[] };
}): Slide[] {
  const { keys, data, period, today, month, animate, reps, people, settings, plRows, logins } = args;
  const nameOf = (id: string) => people.find(r => r.id === id)?.name || 'Former team member';
  const now = headline(data, period);
  const before = period.prev ? headline(data, period.prev) : null;
  const was = (n: number | undefined, rm = false) => (period.prev && n !== undefined ? `${rm ? formatRM(n) : n} in ${period.prevLabel}` : undefined);
  const firstDate = data.deals.map(p => ymd(p.requestDate)).filter(Boolean).sort()[0] || today;
  const out: Slide[] = [];

  for (const key of keys) {
    if (key === 'headline') {
      out.push({
        key, title: 'Headline numbers', subtitle: period.label,
        body: (
          <div className={statGrid}>
            <StatCard tone="accent" label="Sales won" value={formatRM(now.wonRM)} delta={change(now.wonRM, before?.wonRM)} sub={was(before?.wonRM, true)} />
            <StatCard label="Deals won" value={String(now.won)} delta={change(now.won, before?.won)} sub={was(before?.won)} />
            <StatCard label="Cash collected" value={formatRM(now.collected)} delta={change(now.collected, before?.collected)} sub={was(before?.collected, true)} />
            <StatCard label="Proposals sent" value={String(now.proposals)} delta={change(now.proposals, before?.proposals)} sub={was(before?.proposals)} />
            <StatCard label="Appointments" value={String(now.appointments)} delta={change(now.appointments, before?.appointments)} sub={was(before?.appointments)} />
            <StatCard label="New deals" value={String(now.newDeals)} delta={change(now.newDeals, before?.newDeals)} sub={was(before?.newDeals)} />
            <StatCard label="Win rate" value={`${now.winRate}%`} sub={`${now.won} won, ${now.lost} lost`} />
            <StatCard label="Average deal" value={formatRM(now.avgDeal)} delta={change(now.avgDeal, before?.avgDeal)} sub={was(before?.avgDeal, true)} />
            <StatCard label="Open pipeline" value={formatRM(openPipeline(data.deals).reduce((t, s) => t + s.value, 0))} sub="today" />
          </div>
        ),
      });
    } else if (key === 'trend') {
      const series = trendBuckets(period, today, firstDate).map(b => ({ label: b.label, won: headline(data, b).wonRM, cash: headline(data, b).collected }));
      out.push({
        key, title: 'Sales and cash trend', subtitle: period.key === 'week' ? 'Last 8 weeks' : period.key === 'all' ? 'By year' : 'By month',
        body: <Panel><Bars animate={animate} money height={360} data={series} bars={[{ key: 'won', name: 'Sales won' }, { key: 'cash', name: 'Cash collected', colour: '#E0A458' }]} /></Panel>,
      });
    } else if (key === 'team') {
      const rows = reps.map(r => {
        const n = personNumbers(data, r.id, period);
        return { label: r.name, id: r.id, wonRM: n.wonRM, won: n.won, proposals: n.proposals, appointments: n.appointments, touches: n.touches, score: monthKpi(r, data.deals, month, { claims: data.ins, venues: data.venues }).score };
      }).sort((a, b) => b.wonRM - a.wonRM);
      out.push({
        key, title: 'Team leaderboard', subtitle: `${period.label} · KPI score for ${monthLabel(month)}`,
        body: (
          <div className={grid2}>
            <Panel title="Sales won"><Bars animate={animate} money horizontal height={Math.max(200, rows.length * 44)} data={rows} bars={[{ key: 'wonRM', name: 'Sales won' }]} /></Panel>
            <Panel title="Activity">
              <table className="w-full text-[15px]">
                <thead><tr className="border-b border-line text-left text-sm text-ink-soft"><th className="py-2">Person</th><th className="text-right">Proposals</th><th className="text-right">Appts</th><th className="text-right">Contacts</th><th className="text-right">KPI</th></tr></thead>
                <tbody>{rows.map((r, i) => (
                  <tr key={r.id} className="border-b border-line last:border-0">
                    <td className="py-2 font-semibold">{i === 0 && r.wonRM > 0 ? '🏆 ' : ''}{r.label}</td>
                    <td className="text-right tabular-nums">{r.proposals}</td><td className="text-right tabular-nums">{r.appointments}</td><td className="text-right tabular-nums">{r.touches}</td>
                    <td className="text-right"><span className={`rounded-full px-2 py-0.5 text-sm font-bold ${KPI_LIGHT_BADGE[kpiLight(r.score)]}`}>{r.score}%</span></td>
                  </tr>
                ))}</tbody>
              </table>
            </Panel>
          </div>
        ),
      });
    } else if (key === 'funnel') {
      const pipe = openPipeline(data.deals);
      out.push({
        key, title: 'Pipeline funnel', subtitle: period.label,
        body: (
          <div className={grid2}>
            <Panel title="Deals started in the period: how far they got"><Funnel data={conversionFunnel(data.deals, period)} /></Panel>
            <Panel title="Open pipeline today"><Funnel money conversion={false} data={pipe} />
              <p className="mt-3 text-sm text-ink-soft">Total open: <strong className="text-ink">{formatRM(pipe.reduce((t, s) => t + s.value, 0))}</strong> in {pipe.reduce((t, s) => t + s.count, 0)} deals</p>
            </Panel>
          </div>
        ),
      });
    } else if (key === 'projection') {
      out.push({
        key, title: 'Sales projection', subtitle: 'The whole team: won and expected, month by month',
        body: <ProjectionSlide deals={data.deals} today={today} clientName={p => clientNameOf(p, data.clients)} storeKey="present:company"
          monthlyTarget={reps.reduce((t, r) => t + (metricsFor(r).find(m => m.key === 'salesFigure' && m.auto === 'won')?.targetVal || 0), 0)} />,
      });
    } else if (key === 'clients') {
      const top = wonBy(data.deals, period, p => clientNameOf(p, data.clients)).slice(0, 8);
      const ind = wonBy(data.deals, period, p => data.clients.find(c => c.id === p.clientId)?.industry || 'Industry not set');
      out.push({
        key, title: 'Best clients and industries', subtitle: period.label,
        body: !top.length ? <Empty text="No deals won in this period." /> : (
          <div className={grid2}>
            <Panel title="Top clients by sales"><Bars animate={animate} money horizontal height={Math.max(220, top.length * 40)} xKey="name" data={top} bars={[{ key: 'value', name: 'Sales won' }]} /></Panel>
            <Panel title="Sales by industry"><Donut animate={animate} money data={ind.slice(0, 7).map(x => ({ name: x.name, value: x.value }))} /></Panel>
          </div>
        ),
      });
    } else if (key === 'funding') {
      const mix = wonBy(data.deals, period, fundingName);
      out.push({
        key, title: 'Funding mix', subtitle: period.label,
        body: !mix.length ? <Empty text="No deals won in this period." /> : (
          <div className={grid2}>
            <Panel title="Sales by funding"><Donut animate={animate} money data={mix.map(x => ({ name: x.name, value: x.value }))} centre={compactRM(now.wonRM)} /></Panel>
            <Panel title="Deals by funding"><List items={mix.map(x => ({ key: x.name, main: <><strong>{x.name}</strong><span className="block text-sm text-ink-soft">{x.count} deal{x.count === 1 ? '' : 's'}, average {formatRM(x.value / Math.max(1, x.count))}</span></>, side: formatRM(x.value) }))} /></Panel>
          </div>
        ),
      });
    } else if (key === 'programmes') {
      const top = wonBy(data.deals, period, p => programmeNameOf(p, data.programmes)).slice(0, 10);
      out.push({
        key, title: 'Top programmes', subtitle: period.label,
        body: !top.length ? <Empty text="No deals won in this period." /> : (
          <Panel><Bars animate={animate} money horizontal height={Math.max(240, top.length * 40)} xKey="name" data={top} bars={[{ key: 'value', name: 'Sales won' }]} /></Panel>
        ),
      });
    } else if (key === 'collect') {
      const nc = notCollected(data.ins, settings, today);
      const over60 = nc.buckets.slice(2).reduce((t, b) => t + b.client + b.hrdc, 0);
      const dealOf = (id: string) => data.deals.find(p => p.id === id);
      out.push({
        key, title: 'Money not collected', subtitle: 'Today: invoices and HRDC claims not paid yet',
        body: (
          <div className="space-y-4">
            <div className={statGrid}>
              <StatCard tone="accent" label="Still to come in" value={formatRM(nc.total)} />
              <StatCard label="From HRDC" value={formatRM(nc.hrdc)} sub="after HRDC's %" />
              <StatCard tone={over60 > 0 ? 'danger' : 'plain'} label="Over 60 days" value={formatRM(over60)} />
            </div>
            <div className={grid2}>
              <Panel title="How long it's been waiting"><Bars animate={animate} money stacked height={240} data={nc.buckets} bars={[{ key: 'client', name: 'Clients' }, { key: 'hrdc', name: 'HRDC', colour: '#E0A458' }]} /></Panel>
              <Panel title="Waiting longest">
                <List items={nc.oldest.map(({ m, age }) => ({ key: m.id, tone: age > 60 ? 'danger' as const : undefined, main: <><strong>{dealOf(m.dealId) ? clientNameOf(dealOf(m.dealId), data.clients) : m.invoiceNo}</strong><span className="block text-sm text-ink-soft">{m.source === 'hrdc' ? 'HRDC claim' : 'Invoice'} {m.invoiceNo} · {age} days</span></>, side: formatRM(Number(m.amount) || 0) }))} empty="Everything is collected." />
              </Panel>
            </div>
            <p className="text-sm text-ink-soft">Age groups: {AGE_BUCKETS.join(', ')}, counted from the invoice or claim date.</p>
          </div>
        ),
      });
    } else if (key === 'profit') {
      const rows = plRows.filter(r => r.training !== 'cancelled' && inRange(r.trainingDate, period));
      const t = projectTotals(rows);
      const series = trendBuckets(period, today, firstDate).map(b => {
        const tb = projectTotals(plRows.filter(r => inRange(r.trainingDate, b)));
        return { label: b.label, income: tb.income - tb.sst, costs: tb.costs + tb.hrdcFee + tb.commission, profit: tb.profit };
      });
      out.push({
        key, title: 'Profit', subtitle: `${period.label} · trainings by training date (Project P&L)`,
        body: (
          <div className="space-y-4">
            <div className={statGrid}>
              <StatCard label="Income (before SST)" value={formatRM(t.income - t.sst)} sub={`${t.count} training${t.count === 1 ? '' : 's'}`} />
              <StatCard label="Costs, HRDC % and commission" value={formatRM(t.costs + t.hrdcFee + t.commission)} />
              <StatCard tone={t.profit < 0 ? 'danger' : 'accent'} label="Profit" value={formatRM(t.profit)} sub={`${Math.round(t.margin)}% margin`} />
            </div>
            <Panel><Bars animate={animate} money height={260} data={series} bars={[{ key: 'income', name: 'Income' }, { key: 'costs', name: 'Costs', colour: '#E0A458' }, { key: 'profit', name: 'Profit', colour: '#1C2B45' }]} /></Panel>
            {t.estimated > 0 && <p className="text-sm text-ink-soft">Trainings not invoiced yet count at the deal value (estimate).</p>}
          </div>
        ),
      });
    } else if (key === 'touch') {
      const weeks = Array.from({ length: 8 }, (_, i) => { const to = addDays(today, -7 * (7 - i)); return { from: addDays(to, -6), to }; });
      const touches = touchesOf(data);
      const rows = reps.map(r => ({ name: r.name, values: weeks.map(w => touches.filter(t => t.byId === r.id && inRange(t.date, w)).length) }));
      const quiet = quietClients(data, today, 60);
      out.push({
        key, title: 'Client contact heatmap', subtitle: 'Touch points and follow-ups per person, last 8 weeks',
        body: (
          <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
            <Panel><MatrixHeatmap rows={rows} cols={weeks.map((w, i) => (i === 7 ? 'This wk' : `${Number(w.from.slice(8, 10))}/${Number(w.from.slice(5, 7))}`))} /></Panel>
            <Panel title={`Clients not contacted in 60 days (${quiet.length})`}>
              <List items={quiet.slice(0, 8).map(q => ({ key: q.client.id, main: q.client.companyName, side: <span className="text-sm font-normal text-ink-soft">last {formatDate(q.last)}</span> }))} empty="Every active client was contacted lately." />
            </Panel>
          </div>
        ),
      });
    } else if (key === 'logins' && logins) {
      // Team → Login log: last working days' light per person, and the last 4 weeks day by day.
      const now = new Date();
      const recent = lastWorkDays(now, logins.rules, logins.rules.workDays.length);
      const rows = logins.people.map(p => {
        const mins = (d: string) => logins.minutesOf(p.id, d);
        const total = recent.reduce((s, d) => s + mins(d), 0);
        return { p, light: loginLight(recent, mins, logins.rules), avg: Math.round(total / Math.max(1, recent.length)) };
      }).sort((a, b) => b.avg - a.avg);
      out.push({
        key, title: 'Login log', subtitle: `Time in the CRM · light for the last ${recent.length} working days, heatmap for the last 4 weeks`,
        body: logins.days === null ? <Empty text="Loading…" /> : (
          <div className="grid gap-4 lg:grid-cols-[2fr_3fr]">
            <Panel title="Light per person">
              <List items={rows.map(r => ({
                key: r.p.id,
                main: <><strong>{r.p.name}</strong><span className="block text-sm text-ink-soft">{formatMinutes(r.avg)} a working day on average</span></>,
                side: <span className={`rounded-full px-2.5 py-0.5 text-sm font-semibold ${KPI_LIGHT_BADGE[r.light]}`}>{r.light === 'green' ? 'Green' : r.light === 'amber' ? 'Amber' : 'Red'}</span>,
              }))} empty="Nobody on the team yet." />
            </Panel>
            <Panel><LoginHeatmap people={logins.people} columns={heatColumns(now, logins.rules, 4)} minutesOf={logins.minutesOf} rules={logins.rules} todayKey={today} /></Panel>
          </div>
        ),
      });
    } else if (key === 'lost') {
      const lost = data.deals.filter(p => dealStage(p) === 'lost' && inRange(ymd(p.lostDate), period));
      const reasons = new Map<string, { n: number; rm: number }>();
      lost.forEach(p => { const k = p.lostReason || 'Not given'; const e = reasons.get(k) || { n: 0, rm: 0 }; e.n += 1; e.rm += dealValue(p); reasons.set(k, e); });
      const list = [...reasons.entries()].sort((a, b) => b[1].n - a[1].n);
      out.push({
        key, title: 'Why we lost deals', subtitle: `${period.label} · ${lost.length} deal${lost.length === 1 ? '' : 's'}, ${formatRM(lost.reduce((t, p) => t + dealValue(p), 0))}`,
        body: !lost.length ? <Empty text="No deals lost in this period." /> : (
          <div className={grid2}>
            <Panel title="By reason"><Donut animate={animate} data={list.map(([name, e]) => ({ name, value: e.n }))} centre={String(lost.length)} /></Panel>
            <Panel title="Value lost by reason"><List items={list.map(([name, e]) => ({ key: name, main: <><strong>{name}</strong><span className="block text-sm text-ink-soft">{e.n} deal{e.n === 1 ? '' : 's'}</span></>, side: formatRM(e.rm) }))} /></Panel>
          </div>
        ),
      });
    } else if (key === 'trainings') {
      const done = trainingsIn(data.deals, { from: period.from, to: addDays(today, -1) < period.from ? period.from : addDays(today, -1) });
      const coming = data.deals.filter(p => dealStage(p) === 'won' && ymd(p.trainingDate) >= today && ymd(p.trainingDate) <= addDays(today, 30)).sort((a, b) => ymd(a.trainingDate).localeCompare(ymd(b.trainingDate)));
      const row = (p: any) => ({ key: p.id, main: <><strong>{clientNameOf(p, data.clients)}</strong><span className="block text-sm text-ink-soft">{programmeNameOf(p, data.programmes)} · {nameOf(dealOwnerId(p))}</span></>, side: trainingDateText(p) });
      out.push({
        key, title: 'Trainings', subtitle: period.label,
        body: (
          <div className={grid2}>
            <Panel title={`Delivered (${done.length})`}><List items={done.slice(-8).reverse().map(row)} empty="No trainings delivered in this period." /></Panel>
            <Panel title={`Coming up, next 30 days (${coming.length})`}><List items={coming.slice(0, 8).map(row)} empty="No trainings in the next 30 days." /></Panel>
          </div>
        ),
      });
    } else if (key === 'actions') {
      const open = actionItems(data.tasks, () => true, nameOf, today);
      const overdue = open.filter(i => i.tone === 'danger').length;
      out.push({
        key, title: 'Open action points', subtitle: `${open.length} open${overdue ? `, ${overdue} overdue` : ''}`,
        body: <Panel>{open.length ? <List items={open.slice(0, 12)} /> : <p className="flex items-center gap-2 py-6 text-lg text-accent"><CheckCircle2 className="h-6 w-6" /> Every action point is done.</p>}</Panel>,
      });
    }
  }
  return out;
}
