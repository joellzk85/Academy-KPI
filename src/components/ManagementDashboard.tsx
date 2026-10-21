import React, { useEffect, useMemo, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, query, setDoc } from 'firebase/firestore';
import { ChevronRight, Target, TrendingUp, Trophy, Users, XCircle } from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import { Representative } from '../types';
import {
  DealStage, STAGE_LABELS, dealAppointmentDate, dealNeedsAttention, dealOwnerId, dealProposalDate, dealStage, dealValue,
  dealWonDate, formatDate, formatRM, journeyStage, todayIso,
} from '../lib/deals';
import { activeHold } from '../lib/dealHold';
import { closingMetric, kpiBarClass, kpiValueText, LIGHT_TEXT, monthChoices, monthKpi, monthLabel, monthPrefix } from '../lib/kpi';
import { LIGHT_LABELS } from '../lib/kpiLibrary';
import { useKpiSources } from '../lib/useKpiSources';
import { SalesTarget, monthsBetween, periodFor, ymLabel } from '../lib/salesTarget';
import { useSalesTarget } from '../lib/useSalesTarget';
import FollowUpAlerts from './FollowUpAlerts';
import SalesProjection from './SalesProjection';

// Management → Dashboard: Team performance (rebuilt 2026-10-17).
// Everything is counted from deals by the same rules as the KPI page and My home rings
// (lib/kpi.ts monthKpi), so the numbers always agree. Typed KPIs show as each person keyed them in.
// KPI sets and targets are set in Management → Team.

interface Props {
  reps: Representative[];               // people with a workspace, with this month's typed KPIs
  pipelinesSync?: any[];                // all deals
  selectedMonth: string;                // 'OCT-26'
  onMonthChange: (m: string) => void;
  onSelectRep: (rep: Representative) => void;
  onOpenTeam?: () => void;
  people?: { id: string; name: string }[];   // everyone on the Team list, for owner names
  onOpenDeal?: (deal: any) => void;     // opens the deal's panel in its owner's workspace
  viewer?: { id: string; name: string; role: string };   // for the sales projection's settings
}

const card = 'rounded-2xl border border-line bg-white p-5';
const OPEN_JOURNEY: DealStage[] = ['lead', 'proposal', 'agreed', 'quoted'];

export default function ManagementDashboard({ reps, pipelinesSync, selectedMonth, onMonthChange, onSelectRep, onOpenTeam, people = [], onOpenDeal, viewer }: Props) {
  const deals = pipelinesSync || [];
  const [clients, setClients] = useState<any[]>([]);
  useEffect(() => onSnapshot(query(collection(db, 'clients')), s => setClients(s.docs.map(d => ({ ...d.data(), id: d.id })))), []);

  const today = todayIso();
  const prefix = monthPrefix(selectedMonth) || today.slice(0, 7);
  // "So far" runs from the start of the company target period (Jan–Dec when none is set) to the chosen month.
  const target = useSalesTarget();
  const period = periodFor(target, `${prefix}-15`);
  const monthsSoFar = Math.max(0, Math.min(period.months, monthsBetween(period.start.slice(0, 7), prefix)));
  const inMonth = (d: string) => !!d && d.startsWith(prefix);
  const inYearToMonth = (d: string) => !!d && d >= period.start && d <= period.end && d.slice(0, 7) <= prefix;
  const clientName = (p: any) => clients.find(c => c.id === p.clientId)?.companyName || p.client || 'No client';
  const personName = (id: string) => reps.find(r => r.id === id)?.name || people.find(m => m.id === id)?.name || 'Former team member';

  // ---------- Tiles ----------
  const sellers = reps.filter(r => !!closingMetric(r));
  const sumMonthly = sellers.reduce((t, r) => t + (closingMetric(r)?.targetVal || 0), 0);
  const monthTarget = target ? target.monthly : sumMonthly;
  const periodTarget = target ? target.total : sumMonthly * monthsSoFar;
  const tiles = useMemo(() => {
    const sum = (pick: (p: any) => string, test: (d: string) => boolean, value = false) =>
      deals.reduce((t, p) => (test(pick(p)) ? t + (value ? dealValue(p) : 1) : t), 0);
    return {
      wonRM: sum(dealWonDate, inMonth, true), wonRMYear: sum(dealWonDate, inYearToMonth, true),
      wonCount: sum(dealWonDate, inMonth), wonCountYear: sum(dealWonDate, inYearToMonth),
      appts: sum(dealAppointmentDate, inMonth), apptsYear: sum(dealAppointmentDate, inYearToMonth),
      proposals: sum(dealProposalDate, inMonth), proposalsYear: sum(dealProposalDate, inYearToMonth),
    };
  }, [deals, prefix, period.start, period.end]);

  // ---------- Team table ----------
  const kpiSources = useKpiSources({ months: [selectedMonth], people: reps });
  const team = useMemo(() => reps
    .map(r => ({ rep: r, ...monthKpi(r, deals, selectedMonth, { ...kpiSources, people: reps }) }))
    .sort((a, b) => b.score - a.score || a.rep.name.localeCompare(b.rep.name)), [reps, deals, selectedMonth, kpiSources]);

  // ---------- Pipeline ----------
  const open = deals.filter(p => OPEN_JOURNEY.includes(journeyStage(dealStage(p))));
  const byStage = OPEN_JOURNEY.map(st => {
    const list = open.filter(p => journeyStage(dealStage(p)) === st);
    return { st, count: list.length, value: list.reduce((t, p) => t + dealValue(p), 0) };
  });
  const stuck = open.filter(p => dealNeedsAttention(p, today));
  const onHold = open.filter(p => activeHold(p));
  const wonList = deals.filter(p => inMonth(dealWonDate(p))).sort((a, b) => dealWonDate(b).localeCompare(dealWonDate(a)));
  const lostList = deals.filter(p => dealStage(p) === 'lost' && inMonth(String(p.lostDate || '').slice(0, 10)));
  const lostReasons = Object.entries<number>(lostList.reduce((m: Record<string, number>, p) => { const r = p.lostReason || 'No reason given'; m[r] = (m[r] || 0) + 1; return m; }, {}))
    .sort((a, b) => b[1] - a[1]);

  const pct = (v: number, t: number) => (t > 0 ? Math.round((v / t) * 100) : 0);
  const fmtVal = (isRM: boolean, v: number) => (isRM ? formatRM(v) : String(Math.round(v * 10) / 10));

  return (
    <div className="space-y-5 font-sans text-ink">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Team performance</h2>
          <p className="text-[15px] text-ink-soft">Counted from deals, the same way as each person's KPI page.{onOpenTeam && <> KPI sets and targets are set in <button type="button" onClick={onOpenTeam} className="font-semibold text-accent hover:underline">Team</button>.</>}</p>
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold text-ink-soft">
          Month
          <select value={selectedMonth} onChange={e => onMonthChange(e.target.value)} className="rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink focus:border-accent focus:outline-none">
            {monthChoices(today, selectedMonth).map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </label>
      </div>

      <CompanyTarget target={target} sumMonthly={sumMonthly} />

      {/* Tiles */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Sales won" value={formatRM(tiles.wonRM)} sub={monthTarget ? `of ${formatRM(monthTarget)} · ${pct(tiles.wonRM, monthTarget)}%` : 'No sales targets set'}
          year={`${period.label} so far: ${formatRM(tiles.wonRMYear)}${periodTarget ? ` of ${formatRM(periodTarget)}` : ''}`} bar={monthTarget ? pct(tiles.wonRM, monthTarget) : undefined} />
        <Tile label="Deals won" value={String(tiles.wonCount)} year={`${period.label} so far: ${tiles.wonCountYear}`} />
        <Tile label="Appointments held" value={String(tiles.appts)} year={`${period.label} so far: ${tiles.apptsYear}`} />
        <Tile label="Proposals sent" value={String(tiles.proposals)} year={`${period.label} so far: ${tiles.proposalsYear}`} />
      </div>

      {/* Team table */}
      <section className={card}>
        <h3 className="mb-3 flex items-center gap-2 font-bold"><Users className="h-4 w-4 text-accent" /> Each person, {monthLabel(selectedMonth)}</h3>
        {team.length === 0 ? <p className="text-ink-soft">No one with a workspace yet.</p> : (
          <ul className="divide-y divide-line">
            {team.map(({ rep, rows, score }) => (
              <li key={rep.id} className="flex flex-col gap-3 py-3 lg:flex-row lg:items-center">
                <div className="w-full shrink-0 lg:w-56">
                  <p className="font-semibold">{rep.name}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={score} aria-valuemin={0} aria-valuemax={100} aria-label={`${rep.name} KPI score`}>
                      <div className={`h-full rounded-full ${kpiBarClass(score)}`} style={{ width: `${Math.min(100, score)}%` }} />
                    </div>
                    <span className="w-16 text-right text-sm font-bold tabular-nums">{score}%</span>
                  </div>
                </div>
                <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {rows.map(({ m, total, pct: p, light, hasData }) => (
                    <div key={m.key} className="rounded-lg bg-surface px-3 py-2">
                      <p className="flex items-center justify-between gap-2 text-xs text-ink-soft"><span className="truncate">{m.label}{m.auto ? '' : ' (typed)'}</span>
                        <span className={`tabular-nums ${hasData ? LIGHT_TEXT[light] : ''}`}>{!hasData ? 'no data' : m.scoring === 'bands' ? LIGHT_LABELS[light] : `${p}%`}</span></p>
                      <p className="text-sm"><strong className="tabular-nums">{hasData ? kpiValueText(m, total, formatRM) : '–'}</strong>{m.scoring === 'target' && <span className="text-ink-soft"> / {kpiValueText(m, m.targetVal, formatRM)}</span>}</p>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={() => onSelectRep(rep)} className="inline-flex shrink-0 items-center gap-1 self-start rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-semibold hover:bg-surface lg:self-center">
                  Open workspace <ChevronRight className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Sales projection (2026-10-21): won + open deals x Hot / Warm / Cold chance, up to 6 months ahead */}
      {viewer && (
        <section className={card}>
          <h3 className="mb-3 flex items-center gap-2 font-bold"><TrendingUp className="h-4 w-4 text-accent" /> Sales projection</h3>
          <SalesProjection deals={deals} people={sellers.map(r => ({ id: r.id, name: r.name }))} viewer={viewer} today={today}
            monthlyTargetFor={who => who === 'all' ? monthTarget : (closingMetric(reps.find(r => r.id === who) || { id: who })?.targetVal || 0)}
            onOpenDeal={onOpenDeal} clientName={clientName} storeKey={`mgmt:${viewer.id}`} />
        </section>
      )}

      {/* Follow-up alerts (Joel, 2026-10-18): deals past a follow-up checkpoint with no note since */}
      <section className={card}>
        <h3 className="mb-3 font-bold">Follow-up alerts</h3>
        <FollowUpAlerts deals={deals} nameOf={personName} clientName={clientName} onOpen={onOpenDeal} />
      </section>

      {/* Pipeline snapshot */}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className={card}>
          <h3 className="mb-3 font-bold">Open pipeline now</h3>
          <ul className="space-y-2">
            {byStage.map(s => (
              <li key={s.st} className="flex items-center justify-between gap-2 text-[15px]">
                <span>{STAGE_LABELS[s.st]}</span>
                <span className="text-right"><strong className="tabular-nums">{s.count}</strong> <span className="text-ink-soft">· {formatRM(s.value)}</span></span>
              </li>
            ))}
            <li className="flex items-center justify-between gap-2 border-t border-line pt-2 text-[15px]">
              <span className="text-attention">On hold <span className="text-sm text-ink-soft">(included above)</span></span>
              <span className="text-right"><strong className="tabular-nums">{onHold.length}</strong> <span className="text-ink-soft">· {formatRM(onHold.reduce((t, p) => t + dealValue(p), 0))}</span></span>
            </li>
            <li className="flex items-center justify-between gap-2 text-[15px]">
              <span className={stuck.length ? 'font-semibold text-danger' : ''}>Need attention</span>
              <strong className={`tabular-nums ${stuck.length ? 'text-danger' : ''}`}>{stuck.length}</strong>
            </li>
          </ul>
          {stuck.length > 0 && (
            <p className="mt-2 text-sm text-ink-soft">
              {stuck.slice(0, 4).map(p => `${clientName(p)} (${personName(dealOwnerId(p))})`).join(', ')}{stuck.length > 4 ? ` and ${stuck.length - 4} more` : ''}
            </p>
          )}
        </section>

        <section className={card}>
          <h3 className="mb-3 flex items-center gap-2 font-bold"><Trophy className="h-4 w-4 text-accent" /> Won in {monthLabel(selectedMonth)} ({wonList.length})</h3>
          {wonList.length === 0 ? <p className="text-ink-soft">No deals won this month yet.</p> : (
            <ul className="max-h-72 divide-y divide-line overflow-y-auto">
              {wonList.map(p => (
                <li key={p.id}>
                  <button type="button" disabled={!onOpenDeal} onClick={() => onOpenDeal?.(p)} title={onOpenDeal ? 'Open this deal' : undefined}
                    className="flex w-full items-center justify-between gap-2 rounded-lg px-1 py-2 text-left text-[15px] enabled:hover:bg-accent-soft">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{clientName(p)}</span>
                      <span className="block truncate text-sm text-ink-soft">{personName(dealOwnerId(p))} · {formatDate(dealWonDate(p))}</span>
                    </span>
                    <strong className="shrink-0 tabular-nums">{formatRM(dealValue(p))}</strong>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={card}>
          <h3 className="mb-3 flex items-center gap-2 font-bold"><XCircle className="h-4 w-4 text-danger" /> Lost in {monthLabel(selectedMonth)} ({lostList.length})</h3>
          {lostList.length === 0 ? <p className="text-ink-soft">No deals lost this month.</p> : (
            <>
              <ul className="mb-3 space-y-1.5">
                {lostReasons.map(([reason, n]) => (
                  <li key={reason} className="flex items-center gap-2 text-[15px]">
                    <span className="min-w-0 flex-1 truncate">{reason}</span>
                    <span className="h-2 w-24 overflow-hidden rounded-full bg-line"><span className="block h-full rounded-full bg-danger/70" style={{ width: `${pct(n, lostList.length)}%` }} /></span>
                    <strong className="w-6 text-right tabular-nums">{n}</strong>
                  </li>
                ))}
              </ul>
              <ul className="max-h-40 divide-y divide-line overflow-y-auto border-t border-line text-sm">
                {lostList.map(p => (
                  <li key={p.id}>
                    <button type="button" disabled={!onOpenDeal} onClick={() => onOpenDeal?.(p)} title={onOpenDeal ? 'Open this deal' : undefined}
                      className="flex w-full justify-between gap-2 rounded-lg px-1 py-1.5 text-left enabled:hover:bg-accent-soft">
                      <span className="min-w-0 truncate">{clientName(p)} <span className="text-ink-soft">({personName(dealOwnerId(p))})</span></span>
                      <span className="shrink-0 text-ink-soft">{formatRM(dealValue(p))}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function Tile({ label, value, sub, year, bar }: { label: string; value: string; sub?: string; year: string; bar?: number }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <p className="text-sm font-semibold text-ink-soft">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      {sub && <p className="text-sm text-ink-soft">{sub}</p>}
      {bar !== undefined && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, bar)}%` }} /></div>
      )}
      <p className="mt-2 text-xs text-ink-soft">{year}</p>
    </div>
  );
}

// Company sales target and period (Joel, 2026-10-17). Used by the Company ring on My home and the tiles above.
// Each person's ring follows the same period (their monthly target x its months).
function CompanyTarget({ target, sumMonthly }: { target: SalesTarget | null; sumMonthly: number }) {
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({ total: '', monthly: '', start: '', end: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const thisYear = todayIso().slice(0, 4);
  const open = () => {
    setF(target
      ? { total: String(target.total), monthly: String(target.monthly), start: target.start, end: target.end }
      : { total: sumMonthly ? String(sumMonthly * 12) : '', monthly: sumMonthly ? String(sumMonthly) : '', start: `${thisYear}-01`, end: `${thisYear}-12` });
    setError('');
    setEditing(true);
  };
  const num = (v: string) => Number(v.replace(/[^0-9.]/g, ''));
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await fn(); setEditing(false); } catch (err) { setError(friendlyError(err)); } finally { setBusy(false); }
  };
  const save = () => {
    const total = num(f.total), monthly = num(f.monthly);
    if (!(total > 0)) return setError('Type the total sales target for the period.');
    if (!(monthly > 0)) return setError('Type the monthly sales target.');
    if (!f.start || !f.end) return setError('Choose the first and last month of the period.');
    if (f.end < f.start) return setError('The last month must be after the first month.');
    run(() => setDoc(doc(db, 'config', 'sales_target'), { total, monthly, start: f.start, end: f.end, updatedAt: new Date().toISOString() }));
  };
  const input = 'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] focus:border-accent focus:outline-none';

  return (
    <section className="rounded-2xl border border-line bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 font-bold"><Target className="h-4 w-4 text-accent" /> Company sales target</h3>
          {target ? (
            <p className="text-[15px] text-ink-soft">
              <strong className="text-ink">{formatRM(target.total)}</strong> for {ymLabel(target.start)} to {ymLabel(target.end)} ({monthsBetween(target.start, target.end)} months)
              · <strong className="text-ink">{formatRM(target.monthly)}</strong> a month
            </p>
          ) : (
            <p className="text-[15px] text-ink-soft">
              Not set. The Company ring uses January to December and adds up each person's monthly target{sumMonthly ? ` (${formatRM(sumMonthly)} a month)` : ''}.
            </p>
          )}
        </div>
        {!editing && (
          <button type="button" onClick={open} className="rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-semibold hover:bg-surface">
            {target ? 'Change' : 'Set company target'}
          </button>
        )}
      </div>
      {editing && (
        <div className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm font-semibold">Total for the period (RM)
              <input inputMode="decimal" value={f.total} onChange={e => setF(x => ({ ...x, total: e.target.value }))} className={`${input} mt-1`} />
            </label>
            <label className="text-sm font-semibold">Monthly target (RM)
              <input inputMode="decimal" value={f.monthly} onChange={e => setF(x => ({ ...x, monthly: e.target.value }))} className={`${input} mt-1`} />
            </label>
            <label className="text-sm font-semibold">First month
              <input type="month" value={f.start} onChange={e => setF(x => ({ ...x, start: e.target.value }))} className={`${input} mt-1`} />
            </label>
            <label className="text-sm font-semibold">Last month
              <input type="month" value={f.end} onChange={e => setF(x => ({ ...x, end: e.target.value }))} className={`${input} mt-1`} />
            </label>
          </div>
          <p className="text-sm text-ink-soft">
            The Company ring's outer ring counts sales won from the first month to today against the total; the inner ring counts this month against the monthly target.
            Each person's outer ring uses the same months, against their own monthly target (set in Team) times the number of months.
          </p>
          {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            {target && (
              <button type="button" disabled={busy} onClick={() => run(() => deleteDoc(doc(db, 'config', 'sales_target')))} className="mr-auto rounded-lg px-3 py-2 text-sm font-semibold text-danger hover:bg-danger-soft">
                Stop using a company target
              </button>
            )}
            <button type="button" onClick={() => setEditing(false)} className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold">Cancel</button>
            <button type="button" disabled={busy} onClick={save} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">Save target</button>
          </div>
        </div>
      )}
    </section>
  );
}
