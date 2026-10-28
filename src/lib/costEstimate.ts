// Costing estimator (Joel, 2026-10-21): a mock P&L to help set the price of a training before quoting.
// "Selling price − cost of training − expenses = GP", GP per training only (no net profit).
// SST and HRDC's % are optional switches; every cost and expense line is typed line by line and shows its % of the price; % lines are a % of net sales (after HRDC's %).
// Several prices can be compared side by side against the same costs.
// Saved in `cost_estimates` (owner sees their own; Admin and Management see all). Nothing here touches deals or money.
// Public programme estimates (Joel, 2026-10-28, kind 'public'): one run that many companies join, each at its own fee per
// pax and HRDC or direct; options A to D are different mixes of companies (bookings so far, expected, full room...);
// cost lines are per run, per pax (× total pax) or a % of net sales; shows the break-even head-count.

export type EstimateLine = {
  id: string;
  label: string;
  mode: 'rm' | 'pax' | 'pct';  // rm: qty × unit price; pax: qty × unit price × pax (meals, materials); pct: a % of net sales, the price after HRDC's % (e.g. sales commission, Joel 2026-10-27)
  qty: number;
  unit: number;
  pct: number;
};

// Public programme: one company (or a block of open seats) in an option.
export type SeatGroup = {
  id: string;
  name: string;
  pax: number;
  fee: number;             // fee per pax before SST
  hrdc: boolean;           // HRDC claimable: HRDC keeps its % of this company's fee
};

export type SeatOption = { id: string; name: string; groups: SeatGroup[] };

export type CostEstimate = {
  id: string;
  kind?: 'one' | 'public'; // missing = one client
  runId?: string;          // public: the run it was made from (Deals → Public programmes → Cost this programme)
  listPrice?: number;      // public: list price per pax (new companies and open seats start at it)
  seatLimit?: number;
  minPax?: number;
  options?: SeatOption[];  // public: 1 to 4 mixes of companies
  ownerId: string;
  title: string;
  clientName: string;
  pax: number;
  days: number;
  prices: number[];        // selling price options before SST, 1 to 4
  sstOn: boolean;
  sstRate: number;
  hrdcOn: boolean;
  hrdcPct: number;
  costs: EstimateLine[];   // cost of training
  expenses: EstimateLine[];
  targetGpPct?: number;
  createdAt?: string;
  updatedAt?: string;
};

export const MAX_PRICES = 4;

export const newLineId = () => Math.random().toString(36).slice(2, 10);

const rmLine = (label: string, qty = 1, unit = 0): EstimateLine => ({ id: newLineId(), label, mode: 'rm', qty, unit, pct: 0 });

// Starting lines follow the admin pre-training flow (trainer, venue, bus, facilitator, materials) plus hotel and meals.
export function blankEstimate(ownerId: string, opts: { hrdcPct: number; commissionPct: number }): Omit<CostEstimate, 'id'> {
  return {
    ownerId,
    title: '',
    clientName: '',
    pax: 0,
    days: 1,
    prices: [0],
    sstOn: false,
    sstRate: 8,
    hrdcOn: false,
    hrdcPct: opts.hrdcPct,
    costs: [
      rmLine('Trainer fee'),
      rmLine('Venue'),
      rmLine('Meals'),
      rmLine('Hotel'),
      rmLine('Bus'),
      rmLine('Facilitator'),
      rmLine('Materials (T-shirt, banner, print-out)'),
    ],
    expenses: [
      { id: newLineId(), label: 'Sales commission', mode: 'pct', qty: 1, unit: 0, pct: opts.commissionPct },
      rmLine('Staff claims (travel, meals)'),
    ],
  };
}

const n = (v: any) => Number(v) || 0;

// The amount of one line. % lines are a % of net sales (the price after HRDC's %), like the sales commission in the Project P&L.
export function lineAmount(l: EstimateLine, netSales: number, pax = 0): number {
  if (l.mode === 'pct') return (netSales * n(l.pct)) / 100;
  return n(l.qty) * n(l.unit) * (l.mode === 'pax' ? n(pax) : 1);
}

export type EstimateResult = {
  price: number;          // selling price before SST
  sst: number;
  clientPays: number;     // price + SST
  hrdcFee: number;        // HRDC's % of what's claimed (same basis as the Project P&L: the amount incl. SST)
  netSales: number;       // price − HRDC's %
  costs: number;
  expenses: number;
  gp: number;
  gpPct: number;          // GP as % of the selling price
  perPax: number;         // selling price per pax (0 when pax not given)
};

export function estimateResult(e: Pick<CostEstimate, 'sstOn' | 'sstRate' | 'hrdcOn' | 'hrdcPct' | 'costs' | 'expenses' | 'pax'>, priceIn: number): EstimateResult {
  const price = n(priceIn);
  const sst = e.sstOn ? (price * n(e.sstRate)) / 100 : 0;
  const clientPays = price + sst;
  const hrdcFee = e.hrdcOn ? (clientPays * n(e.hrdcPct)) / 100 : 0;
  const netSales = price - hrdcFee;
  const costs = e.costs.reduce((s, l) => s + lineAmount(l, netSales, e.pax), 0);
  const expenses = e.expenses.reduce((s, l) => s + lineAmount(l, netSales, e.pax), 0);
  const gp = netSales - costs - expenses;
  return { price, sst, clientPays, hrdcFee, netSales, costs, expenses, gp, gpPct: price ? (gp / price) * 100 : 0, perPax: n(e.pax) > 0 ? price / n(e.pax) : 0 };
}

// The selling price that gives the target GP %. Fixed RM lines don't change with price; % lines (of net sales) and HRDC's % do.
// Returns null when the target can't be reached (the %s alone already eat the whole price).
export function priceForTarget(e: Pick<CostEstimate, 'sstOn' | 'sstRate' | 'hrdcOn' | 'hrdcPct' | 'costs' | 'expenses' | 'pax'>, targetPct: number): number | null {
  const lines = [...e.costs, ...e.expenses];
  const fixed = lines.filter(l => l.mode !== 'pct').reduce((s, l) => s + lineAmount(l, 0, e.pax), 0);
  const pctShare = lines.filter(l => l.mode === 'pct').reduce((s, l) => s + n(l.pct), 0) / 100;
  const hrdcShare = e.hrdcOn ? (n(e.hrdcPct) / 100) * (1 + (e.sstOn ? n(e.sstRate) / 100 : 0)) : 0;
  const left = (1 - hrdcShare) * (1 - pctShare) - n(targetPct) / 100;
  if (left <= 0 || fixed <= 0) return null;
  return Math.ceil(fixed / left / 10) * 10;   // rounded up to the next RM 10
}

// Only the fields that are saved (no id).
export function estimateData(e: CostEstimate): Omit<CostEstimate, 'id'> {
  const { id, ...rest } = e;
  return rest;
}

// ---------- Public programme (Joel, 2026-10-28) ----------

export const newSeatGroup = (name = '', pax = 0, fee = 0, hrdc = true): SeatGroup => ({ id: newLineId(), name, pax, fee, hrdc });

export function blankPublicEstimate(ownerId: string, opts: { hrdcPct: number; commissionPct: number }): Omit<CostEstimate, 'id'> {
  const paxLine = (label: string): EstimateLine => ({ id: newLineId(), label, mode: 'pax', qty: 1, unit: 0, pct: 0 });
  return {
    ...blankEstimate(ownerId, opts),
    kind: 'public',
    listPrice: 0,
    seatLimit: 0,
    minPax: 0,
    options: [{ id: newLineId(), name: 'Bookings so far', groups: [newSeatGroup()] }],
    costs: [
      rmLine('Trainer fee'),
      rmLine('Venue hire'),
      paxLine('Meals and tea breaks'),
      paxLine('Materials and certificates'),
      rmLine('Facilitator'),
      rmLine('Marketing (ads, flyers)'),
    ],
  };
}

export type PublicResult = EstimateResult & {
  pax: number;
  avgFee: number;               // selling price ÷ pax
  hrdcPrice: number;            // the part of the price from HRDC companies
  runCosts: number;             // per run lines (don't change with pax)
  paxCosts: number;             // per pax lines, all pax
  breakEvenPax: number | null;  // pax needed (at this option's average fee and HRDC mix) for GP ≥ 0; null = never
};

type PublicInputs = Pick<CostEstimate, 'sstOn' | 'sstRate' | 'hrdcPct' | 'costs' | 'expenses'>;

export function optionPax(o: SeatOption | undefined): number {
  return (o?.groups || []).reduce((t, g) => t + Math.max(0, n(g.pax)), 0);
}

/** One option's P&L: sales add up company by company; HRDC keeps its % only of HRDC companies' fees (incl. SST, as in the Project P&L). */
export function publicResult(e: PublicInputs, o: SeatOption | undefined): PublicResult {
  const groups = (o?.groups || []).map(g => ({ pax: Math.max(0, n(g.pax)), fee: n(g.fee), hrdc: !!g.hrdc }));
  const pax = groups.reduce((t, g) => t + g.pax, 0);
  const price = groups.reduce((t, g) => t + g.pax * g.fee, 0);
  const hrdcPrice = groups.filter(g => g.hrdc).reduce((t, g) => t + g.pax * g.fee, 0);
  const sstF = e.sstOn ? n(e.sstRate) / 100 : 0;
  const sst = price * sstF;
  const hrdcFee = (hrdcPrice * (1 + sstF) * n(e.hrdcPct)) / 100;
  const netSales = price - hrdcFee;
  const lines = [...e.costs, ...e.expenses];
  const costs = e.costs.reduce((s, l) => s + lineAmount(l, netSales, pax), 0);
  const expenses = e.expenses.reduce((s, l) => s + lineAmount(l, netSales, pax), 0);
  const gp = netSales - costs - expenses;
  const runCosts = lines.filter(l => l.mode === 'rm').reduce((s, l) => s + lineAmount(l, 0), 0);
  const perPaxCost = lines.filter(l => l.mode === 'pax').reduce((s, l) => s + lineAmount(l, 0, 1), 0);
  const pctShare = lines.filter(l => l.mode === 'pct').reduce((s, l) => s + n(l.pct), 0) / 100;
  // Each extra pax brings the average net fee less the % lines and the per pax costs; together they must cover the per run costs.
  const avgFee = pax ? price / pax : 0;
  const perPaxGain = pax ? (netSales / pax) * (1 - pctShare) - perPaxCost : 0;
  const breakEvenPax = perPaxGain > 0 ? Math.ceil(runCosts / perPaxGain - 1e-9) : null;
  return {
    price, sst, clientPays: price + sst, hrdcFee, netSales, costs, expenses, gp, gpPct: price ? (gp / price) * 100 : 0,
    perPax: avgFee, pax, avgFee, hrdcPrice, runCosts, paxCosts: perPaxCost * pax, breakEvenPax,
  };
}

/** The average fee per pax that gives the target GP % with this option's head-count and HRDC mix (rounded up to RM 10). */
export function feeForTarget(e: PublicInputs, o: SeatOption | undefined, targetPct: number): number | null {
  const r = publicResult(e, o);
  if (!r.pax) return null;
  const pctShare = [...e.costs, ...e.expenses].filter(l => l.mode === 'pct').reduce((s, l) => s + n(l.pct), 0) / 100;
  // HRDC share of the price: by money when fees are typed, else by pax.
  const hrdcPax = (o?.groups || []).filter(g => g.hrdc).reduce((t, g) => t + Math.max(0, n(g.pax)), 0);
  const hShare = r.price > 0 ? r.hrdcPrice / r.price : hrdcPax / r.pax;
  const hrdcF = hShare * (n(e.hrdcPct) / 100) * (1 + (e.sstOn ? n(e.sstRate) / 100 : 0));
  const left = (1 - hrdcF) * (1 - pctShare) - n(targetPct) / 100;
  const fixed = r.runCosts + r.paxCosts;
  if (left <= 0 || fixed <= 0) return null;
  return Math.ceil(fixed / left / r.pax / 10) * 10;
}
