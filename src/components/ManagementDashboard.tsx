import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { ChevronRight, Trophy, Users, XCircle } from 'lucide-react';
import { db } from '../lib/firebase';
import { Representative } from '../types';
import {
  DealStage, STAGE_LABELS, dealAppointmentDate, dealNeedsAttention, dealOwnerId, dealProposalDate, dealStage, dealValue,
  dealWonDate, formatDate, formatRM, journeyStage, todayIso,
} from '../lib/deals';
import { metricsFor, monthChoices, monthKpi, monthLabel, monthPrefix } from '../lib/kpi';
import { useKpiSources } from '../lib/useKpiSources';

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
}

const card = 'rounded-2xl border border-line bg-white p-5';
const OPEN_JOURNEY: DealStage[] = ['lead', 'proposal', 'agreed', 'quoted'];

export default function ManagementDashboard({ reps, pipelinesSync, selectedMonth, onMonthChange, onSelectRep, onOpenTeam }: Props) {
  const deals = pipelinesSync || [];
  const [clients, setClients] = useState<any[]>([]);
  useEffect(() => onSnapshot(query(collection(db, 'clients')), s => setClients(s.docs.map(d => ({ ...d.data(), id: d.id })))), []);

  const today = todayIso();
  const prefix = monthPrefix(selectedMonth) || today.slice(0, 7);
  const year = prefix.slice(0, 4);
  const monthsSoFar = Number(prefix.slice(5, 7));
  const inMonth = (d: string) => !!d && d.startsWith(prefix);
  const inYearToMonth = (d: string) => !!d && d.slice(0, 4) === year && d.slice(0, 7) <= prefix;
  const clientName = (p: any) => clients.find(c => c.id === p.clientId)?.companyName || p.client || 'No client';
  const personName = (id: string) => reps.find(r => r.id === id)?.name || 'Former team member';

  // ---------- Tiles ----------
  const sellers = reps.filter(r => metricsFor(r).some(m => m.key === 'salesFigure' && m.auto === 'won'));
  const monthTarget = sellers.reduce((t, r) => t + (metricsFor(r).find(m => m.key === 'salesFigure')?.targetVal || 0), 0);
  const tiles = useMemo(() => {
    const sum = (pick: (p: any) => string, test: (d: string) => boolean, value = false) =>
      deals.reduce((t, p) => (test(pick(p)) ? t + (value ? dealValue(p) : 1) : t), 0);
    return {
      wonRM: sum(dealWonDate, inMonth, true), wonRMYear: sum(dealWonDate, inYearToMonth, true),
      wonCount: sum(dealWonDate, inMonth), wonCountYear: sum(dealWonDate, inYearToMonth),
      appts: sum(dealAppointmentDate, inMonth), apptsYear: sum(dealAppointmentDate, inYearToMonth),
      proposals: sum(dealProposalDate, inMonth), proposalsYear: sum(dealProposalDate, inYearToMonth),
    };
  }, [deals, prefix]);

  // ---------- Team table ----------
  const kpiSources = useKpiSources();
  const team = useMemo(() => reps
    .map(r => ({ rep: r, ...monthKpi(r, deals, selectedMonth, kpiSources) }))
    .sort((a, b) => b.score - a.score || a.rep.name.localeCompare(b.rep.name)), [reps, deals, selectedMonth, kpiSources]);

  // ---------- Pipeline ----------
  const open = deals.filter(p => OPEN_JOURNEY.includes(journeyStage(dealStage(p))));
  const byStage = OPEN_JOURNEY.map(st => {
    const list = open.filter(p => journeyStage(dealStage(p)) === st);
    return { st, count: list.length, value: list.reduce((t, p) => t + dealValue(p), 0) };
  });
  const stuck = open.filter(p => dealNeedsAttention(p, today));
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

      {/* Tiles */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Sales won" value={formatRM(tiles.wonRM)} sub={monthTarget ? `of ${formatRM(monthTarget)} · ${pct(tiles.wonRM, monthTarget)}%` : 'No sales targets set'}
          year={`${year} so far: ${formatRM(tiles.wonRMYear)}${monthTarget ? ` of ${formatRM(monthTarget * monthsSoFar)}` : ''}`} bar={monthTarget ? pct(tiles.wonRM, monthTarget) : undefined} />
        <Tile label="Deals won" value={String(tiles.wonCount)} year={`${year} so far: ${tiles.wonCountYear}`} />
        <Tile label="Appointments held" value={String(tiles.appts)} year={`${year} so far: ${tiles.apptsYear}`} />
        <Tile label="Proposals sent" value={String(tiles.proposals)} year={`${year} so far: ${tiles.proposalsYear}`} />
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
                      <div className={`h-full rounded-full ${score >= 100 ? 'bg-accent' : score >= 50 ? 'bg-accent/70' : 'bg-attention'}`} style={{ width: `${Math.min(100, score)}%` }} />
                    </div>
                    <span className="w-16 text-right text-sm font-bold tabular-nums">{score}%</span>
                  </div>
                </div>
                <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {rows.map(({ m, total, pct: p }) => (
                    <div key={m.key} className="rounded-lg bg-surface px-3 py-2">
                      <p className="flex items-center justify-between gap-2 text-xs text-ink-soft"><span className="truncate">{m.label}{m.auto ? '' : ' (typed)'}</span><span className="tabular-nums">{p}%</span></p>
                      <p className="text-sm"><strong className="tabular-nums">{fmtVal(m.isRM, total)}</strong> <span className="text-ink-soft">/ {fmtVal(m.isRM, m.targetVal)}</span></p>
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
                <li key={p.id} className="flex items-center justify-between gap-2 py-2 text-[15px]">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{clientName(p)}</span>
                    <span className="block truncate text-sm text-ink-soft">{personName(dealOwnerId(p))} · {formatDate(dealWonDate(p))}</span>
                  </span>
                  <strong className="shrink-0 tabular-nums">{formatRM(dealValue(p))}</strong>
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
                  <li key={p.id} className="flex justify-between gap-2 py-1.5">
                    <span className="min-w-0 truncate">{clientName(p)} <span className="text-ink-soft">({personName(dealOwnerId(p))})</span></span>
                    <span className="shrink-0 text-ink-soft">{formatRM(dealValue(p))}</span>
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
