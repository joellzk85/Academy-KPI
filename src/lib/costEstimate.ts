// Costing estimator (Joel, 2026-10-21): a mock P&L to help set the price of a training before quoting.
// "Selling price − cost of training − expenses = GP", GP per training only (no net profit).
// SST and HRDC's % are optional switches; every cost and expense line is typed line by line and shows its % of the price.
// Several prices can be compared side by side against the same costs.
// Saved in `cost_estimates` (owner sees their own; Admin and Management see all). Nothing here touches deals or money.

export type EstimateLine = {
  id: string;
  label: string;
  mode: 'rm' | 'pct';     // rm: qty × unit price; pct: a % of the selling price (e.g. sales commission)
  qty: number;
  unit: number;
  pct: number;
};

export type CostEstimate = {
  id: string;
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

// The amount of one line at a given selling price.
export function lineAmount(l: EstimateLine, price: number): number {
  return l.mode === 'pct' ? (price * n(l.pct)) / 100 : n(l.qty) * n(l.unit);
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
  const costs = e.costs.reduce((s, l) => s + lineAmount(l, price), 0);
  const expenses = e.expenses.reduce((s, l) => s + lineAmount(l, price), 0);
  const gp = netSales - costs - expenses;
  return { price, sst, clientPays, hrdcFee, netSales, costs, expenses, gp, gpPct: price ? (gp / price) * 100 : 0, perPax: n(e.pax) > 0 ? price / n(e.pax) : 0 };
}

// The selling price that gives the target GP %. Fixed RM lines don't change with price; % lines and HRDC's % do.
// Returns null when the target can't be reached (the %s alone already eat the whole price).
export function priceForTarget(e: Pick<CostEstimate, 'sstOn' | 'sstRate' | 'hrdcOn' | 'hrdcPct' | 'costs' | 'expenses'>, targetPct: number): number | null {
  const lines = [...e.costs, ...e.expenses];
  const fixed = lines.filter(l => l.mode === 'rm').reduce((s, l) => s + n(l.qty) * n(l.unit), 0);
  const pctShare = lines.filter(l => l.mode === 'pct').reduce((s, l) => s + n(l.pct), 0) / 100;
  const hrdcShare = e.hrdcOn ? (n(e.hrdcPct) / 100) * (1 + (e.sstOn ? n(e.sstRate) / 100 : 0)) : 0;
  const left = 1 - hrdcShare - pctShare - n(targetPct) / 100;
  if (left <= 0 || fixed <= 0) return null;
  return Math.ceil(fixed / left / 10) * 10;   // rounded up to the next RM 10
}

// Only the fields that are saved (no id).
export function estimateData(e: CostEstimate): Omit<CostEstimate, 'id'> {
  const { id, ...rest } = e;
  return rest;
}
