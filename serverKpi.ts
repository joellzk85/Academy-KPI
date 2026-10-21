// Gross profit KPIs (Joel, 2026-10-22). Reps and Admin can't read costs (money_out, project_pl), so the server works
// out the gross profit % with the same P&L as Management → Project P&L (src/lib/projectPL.ts) and returns only
// percentages:
// - POST /api/kpi/gp { months: ['YYYY-MM', ...] } → { gp: { [month]: { [memberId | 'company']: { margin, trainings } } } }
// - A training counts in the month of its training date. margin = profit ÷ income before SST, over those trainings.
// - Management gets everyone and the company figure. Anyone else gets only their own figure, plus the company
//   figure when Management gave them the Company gross profit KPI.

import type { Express } from 'express';
import { admin, UserError, callerFrom, route } from './serverAuth';
import { malaysiaDay } from './src/lib/backup';
import { readMoneySettings } from './src/lib/money';
import { projectRows } from './src/lib/projectPL';
import { dealOwnerId } from './src/lib/deals';

const MONTH = /^\d{4}-\d{2}$/;

export function registerKpiRoutes(app: Express) {
  app.post('/api/kpi/gp', route(async req => {
    const caller = await callerFrom(req);
    const months: string[] = Array.isArray(req.body?.months) ? req.body.months.filter((m: any) => typeof m === 'string' && MONTH.test(m)).slice(0, 13) : [];
    if (!months.length) throw new UserError(400, 'bad-months', 'Choose a month.');
    const { db } = admin();
    const list = async (id: string) => (await db.collection(id).get()).docs.map(d => ({ ...(d.data() as any), id: d.id }));
    const [deals, ins, outs, quotes, plSnap, settingsDoc, team, repDoc] = await Promise.all([
      list('pipelines'), list('money_in'), list('money_out'), list('quotations'), db.collection('project_pl').get(),
      db.collection('config').doc('money_settings').get(), list('team'), db.collection('reps').doc(caller.memberId).get(),
    ]);
    const isMgmt = caller.role === 'management';
    const seesCompany = isMgmt || ((repDoc.data()?.kpiSet?.items || []) as any[]).some(i => i?.kpiId === 'gp_company');
    // Hidden records stay hidden (src/lib/linked.ts): deleted deals and deals whose owner isn't on the Team list.
    const teamIds = new Set(team.map(m => m.id));
    const live = (r: any) => r.deleted !== true && r.dealDeleted !== true;
    const linked = deals.filter(d => live(d) && (!teamIds.size || teamIds.has(dealOwnerId(d))));
    const plDocs = Object.fromEntries(plSnap.docs.map(d => [d.id, d.data()]));
    const rows = projectRows(linked, ins.filter(live), outs.filter(live), readMoneySettings(settingsDoc.data()), malaysiaDay(Date.now()), { quotes, plDocs });

    const gp: Record<string, Record<string, { margin: number; trainings: number }>> = {};
    for (const month of months) {
      const sums: Record<string, { profit: number; base: number; trainings: number }> = {};
      const add = (who: string, profit: number, base: number) => {
        const s = (sums[who] ||= { profit: 0, base: 0, trainings: 0 });
        s.profit += profit; s.base += base; s.trainings += 1;
      };
      rows.filter(r => r.trainingDate.startsWith(month) && r.training !== 'cancelled').forEach(r => {
        const base = r.income - r.sst;
        if (base <= 0) return;
        add(r.commissionTo, r.profit, base);
        add('company', r.profit, base);
      });
      const out: Record<string, { margin: number; trainings: number }> = {};
      Object.entries(sums).forEach(([who, s]) => {
        if (!isMgmt && who !== caller.memberId && !(who === 'company' && seesCompany)) return;
        out[who] = { margin: Math.round((s.profit / s.base) * 1000) / 10, trainings: s.trainings };
      });
      gp[month] = out;
    }
    return { gp };
  }));
}
