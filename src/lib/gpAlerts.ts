// Strange GP and costs left out of the P&L (Joel, 2026-10-23, full deal test batch 4): the manager and the deal owner
// get an alert on My home when
// - a training cost is left out of the P&L (not "Pay on behalf"), with the reason given;
// - a training's GP % is below the company's red band (KPI & appraisal → Settings → KPI library, 30% to start), once it has costs;
// - its GP % is above 85% after the training: usually a cost that was never raised.
// The owner's alert (from the server, serverKpi.ts) never shows cost amounts: reps can't see costs. Pure, so it can be tested.
import type { ProjectRow } from './projectPL';
import { MoneyOut, inPL } from './money';

export const GP_HIGH_PCT = 85;

export interface GpAlert { dealId: string; kind: 'gp_low' | 'gp_high' | 'not_in_pl'; level: 'danger' | 'attention'; text: string }

const pct = (n: number) => `${n.toFixed(1)}%`;
const rm = (n: number) => `RM ${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function gpAlerts(row: ProjectRow, outs: MoneyOut[], redPct: number, forOwner = false): GpAlert[] {
  const dealId = row.deal?.id || '';
  if (!dealId || row.training === 'cancelled') return [];
  const out: GpAlert[] = [];
  const mine = outs.filter(o => o.dealId === dealId && o.status !== 'rejected' && !(o as any).deleted);
  mine.filter(o => !o.onBehalf && !inPL(o)).forEach(o => out.push({
    dealId, kind: 'not_in_pl', level: 'attention',
    text: `Cost left out of the P&L: ${o.category}${forOwner ? '' : ` · ${o.payee} · ${rm(Number(o.amount) || 0)}`}${o.notInPLReason ? ` (${o.notInPLReason})` : ''}`,
  }));
  const base = row.income - row.sst;
  if (base > 0 && row.costs > 0 && row.margin < redPct) {
    out.push({ dealId, kind: 'gp_low', level: 'danger', text: `GP ${pct(row.margin)} is below ${pct(redPct)}${forOwner ? '' : `: profit ${rm(row.profit)}`}` });
  } else if (base > 0 && row.training === 'done' && row.margin > GP_HIGH_PCT) {
    out.push({ dealId, kind: 'gp_high', level: 'attention', text: `GP ${pct(row.margin)} after the training is unusually high: is a cost missing?` });
  }
  return out;
}
