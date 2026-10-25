// Gross profit KPIs (Joel, 2026-10-22). Reps can't read costs (money_out, project_pl), so the server works
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
import { gpAlerts } from './src/lib/gpAlerts';
import { readKpiLibrary } from './src/lib/kpiLibrary';
import { itemStars, readRound, RatingRound, ratingOverall, summarise } from './src/lib/rating360';
import { heldDatesByPerson } from './src/lib/oneToOne';

const MONTH = /^\d{4}-\d{2}$/;

// 360 rating (Part C, src/lib/rating360.ts). Ratings are readable only by the rater and Management, so:
// - POST /api/ratings/about-me {} → the ratings about the caller in closed rounds: stars per attitude item, the
//   average per item and overall, and comments, with who gave them only when the round's view is open.
// - POST /api/ratings/scores { months } → { scores: { [month]: { [memberId]: { avg, count } } } } from closed rounds
//   (the old 360 rating KPI; avg = overall attitude). Management gets everyone; anyone else only their own.
// A round started by Commence appraisal counts only once Management releases that appraisal (Joel, 2026-10-25).
async function closedRounds(db: any, months?: string[]) {
  const [snap, cycles] = await Promise.all([db.collection('rating_rounds').where('status', '==', 'closed').get(), db.collection('appraisal_cycles').get()]);
  const hidden = new Set(cycles.docs.filter((d: any) => d.data()?.status !== 'released').map((d: any) => String(d.data()?.roundId || '')));
  return snap.docs.map((d: any) => readRound(d.id, d.data())).filter((r: RatingRound) => !hidden.has(r.id) && (!months || months.includes(r.month)));
}

export function registerRatingRoutes(app: Express) {
  app.post('/api/ratings/about-me', route(async req => {
    const caller = await callerFrom(req);
    const { db } = admin();
    const rounds: RatingRound[] = await closedRounds(db);
    const snap = await db.collection('ratings_360').where('rateeId', '==', caller.memberId).get();
    const all = snap.docs.map(d => d.data() as any);
    const out = rounds
      .map(r => {
        const mine = all.filter(x => x.roundId === r.id && ratingOverall(x) !== null);
        if (!mine.length) return null;
        const sum = summarise(mine);
        const comments = (x: any) => Object.fromEntries(Object.entries(x.comments && typeof x.comments === 'object' ? x.comments : {})
          .filter(([, v]) => typeof v === 'string' && v.trim()).map(([k, v]) => [k, String(v)]));
        return {
          roundId: r.id, name: r.name, month: r.month, view: r.view, closedAt: r.closedAt || '',
          avg: sum.overall?.avg || 0,
          count: mine.length,
          itemAvgs: sum.items,
          items: mine
            .sort(() => Math.random() - 0.5)   // closed view: no order to guess from
            .map(x => ({
              stars: Math.round((ratingOverall(x) || 0) * 10) / 10, itemStars: itemStars(x), itemComments: comments(x),
              comment: String(x.comment || ''), ...(r.view === 'open' ? { raterName: String(x.raterName || '') } : {}),
            })),
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => String(b.closedAt).localeCompare(String(a.closedAt)));
    return { rounds: out };
  }));

  app.post('/api/ratings/scores', route(async req => {
    const caller = await callerFrom(req);
    const months: string[] = Array.isArray(req.body?.months) ? req.body.months.filter((m: any) => typeof m === 'string' && MONTH.test(m)).slice(0, 13) : [];
    if (!months.length) throw new UserError(400, 'bad-months', 'Choose a month.');
    const { db } = admin();
    const rounds: RatingRound[] = await closedRounds(db, months);
    const scores: Record<string, Record<string, { avg: number; count: number }>> = Object.fromEntries(months.map(m => [m, {}]));
    if (rounds.length) {
      const byRound = new Map(rounds.map(r => [r.id, r]));
      const snap = caller.role === 'management'
        ? await db.collection('ratings_360').get()
        : await db.collection('ratings_360').where('rateeId', '==', caller.memberId).get();
      const sums: Record<string, Record<string, { t: number; n: number }>> = {};
      snap.docs.forEach(d => {
        const x: any = d.data();
        const r = byRound.get(x.roundId);
        const overall = ratingOverall(x);
        if (!r || overall === null) return;
        const s = ((sums[r.month] ||= {})[x.rateeId] ||= { t: 0, n: 0 });
        s.t += overall; s.n += 1;
      });
      Object.entries(sums).forEach(([m, people]) => Object.entries(people).forEach(([id, s]) => {
        scores[m][id] = { avg: Math.round((s.t / s.n) * 100) / 100, count: s.n };
      }));
    }
    return { scores };
  }));
}

export function registerKpiRoutes(app: Express) {
  registerRatingRoutes(app);
  // 1-to-1 sessions held (2026-10-25, src/lib/oneToOne.ts). Sessions are private to the two people in them, so the
  // "1-to-1 sessions held" KPI gets only the dates of held sessions:
  // POST /api/one-to-one/held { months } → { held: { [memberId]: ['YYYY-MM-DD', ...] } }. Management gets everyone,
  // anyone else only their own.
  app.post('/api/one-to-one/held', route(async req => {
    const caller = await callerFrom(req);
    const months: string[] = Array.isArray(req.body?.months) ? req.body.months.filter((m: any) => typeof m === 'string' && MONTH.test(m)).slice(0, 13) : [];
    if (!months.length) throw new UserError(400, 'bad-months', 'Choose a month.');
    const { db } = admin();
    const snap = await db.collection('one_to_ones').where('status', '==', 'held').get();
    const all = heldDatesByPerson(snap.docs.map(d => d.data() as any));
    const held: Record<string, string[]> = {};
    Object.entries(all).forEach(([id, dates]) => {
      if (caller.role !== 'management' && id !== caller.memberId) return;
      const inMonths = dates.filter(d => months.includes(d.slice(0, 7)));
      if (inMonths.length) held[id] = inMonths;
    });
    return { held };
  }));
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

  // Strange GP or a cost left out of the P&L on my own deals (full deal test, 2026-10-23): the deal owner's My home
  // alert. Only the GP % and the cost's category and reason go back; reps can't see costs (src/lib/gpAlerts.ts).
  app.post('/api/kpi/deal-alerts', route(async req => {
    const caller = await callerFrom(req);
    const { db } = admin();
    const list = async (id: string) => (await db.collection(id).get()).docs.map(d => ({ ...(d.data() as any), id: d.id }));
    const live = (r: any) => r.deleted !== true && r.dealDeleted !== true;
    const deals = (await list('pipelines')).filter(d => live(d) && dealOwnerId(d) === caller.memberId);
    if (!deals.length) return { alerts: [] };
    const [ins, outs, quotes, plSnap, settingsDoc, libDoc] = await Promise.all([
      list('money_in'), list('money_out'), list('quotations'), db.collection('project_pl').get(),
      db.collection('config').doc('money_settings').get(), db.collection('config').doc('kpi_library').get(),
    ]);
    const today = malaysiaDay(Date.now());
    const since = new Date(Date.parse(today) - ALERT_DAYS * 864e5).toISOString().slice(0, 10);
    const plDocs = Object.fromEntries(plSnap.docs.map(d => [d.id, d.data()]));
    const red = readKpiLibrary(libDoc.data()).gpBands.red;
    const rows = projectRows(deals, ins.filter(live), outs.filter(live), readMoneySettings(settingsDoc.data()), today, { quotes, plDocs })
      .filter(r => !r.trainingDate || r.trainingDate >= since);
    return { alerts: rows.flatMap(r => gpAlerts(r, outs.filter(live), red, true)) };
  }));
}

// Alerts look at trainings from this many days ago onwards (older ones are settled).
const ALERT_DAYS = 90;
