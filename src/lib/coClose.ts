// Co-closed deals (Joel, 2026-10-24): a deal closed together with a teammate. Two ways to pay the co-closer:
// - 'share' (default): they get coClosePct % of the sales commission and the deal owner keeps the rest; the total
//   commission doesn't change.
// - 'own': the owner keeps the full commission and the co-closer gets their own coClosePct % of the price after SST and HRDC's %
//   (like commissionPct), on top; that extra commission comes off the deal's profit.
// KPIs (Closing RM, won deals, GP % credit) stay 100% with the owner (Joel's choice: "commission only").
// Deal fields: coCloserId, coCloserName, coCloseMode, coClosePct. Once won, only Management changes them (firestore.rules).

export type CoCloseMode = 'share' | 'own';

export interface CommissionShare { id: string; amount: number; label: string }   // label: "60% of the commission"

export function coCloser(deal: any): { id: string; name: string; pct: number; mode: CoCloseMode } | null {
  const id = String(deal?.coCloserId || '');
  const pct = Number(deal?.coClosePct) || 0;
  if (!id || !(pct > 0 && pct < 100)) return null;
  return { id, name: String(deal?.coCloserName || ''), pct, mode: deal?.coCloseMode === 'own' ? 'own' : 'share' };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Who gets the commission. commission = the owner's (commissionPct of base); base = the price after SST and HRDC's % (0 if cancelled). */
export function commissionShares(deal: any, ownerId: string, commission: number, base: number, ownerPct: number): CommissionShare[] {
  const co = coCloser(deal);
  if (!co || co.id === ownerId) return [{ id: ownerId, amount: commission, label: 'the whole commission' }];
  if (co.mode === 'own') {
    return [
      { id: ownerId, amount: commission, label: `${ownerPct}% of the price` },
      { id: co.id, amount: Math.round(Math.max(0, base) * co.pct) / 100, label: `own ${co.pct}% of the price` },
    ];
  }
  const coAmount = Math.round(commission * co.pct) / 100;
  return [
    { id: ownerId, amount: r2(commission - coAmount), label: `${100 - co.pct}% of the commission` },
    { id: co.id, amount: coAmount, label: `${co.pct}% of the commission` },
  ];
}

export const sharesTotal = (shares: CommissionShare[]) => r2(shares.reduce((t, s) => t + s.amount, 0));

/** Why the co-closed details can't be saved, or ''. pctText is what was typed. */
export function coCloseProblem(ownerId: string, coId: string, pctText: string, mode: CoCloseMode = 'share'): string {
  if (!coId) return '';
  if (coId === ownerId) return 'The co-closer must be someone other than the deal owner.';
  const pct = Number(String(pctText).trim());
  if (mode === 'own') {
    if (!String(pctText).trim() || !Number.isFinite(pct) || pct <= 0 || pct > 20) return "Enter the co-closer's own commission as a % of the price, for example 1 (up to 20).";
    return '';
  }
  if (!String(pctText).trim() || !Number.isFinite(pct) || pct <= 0 || pct >= 100) return "Enter the co-closer's share of the commission, from 1 to 99 (%).";
  return '';
}

/** "Alif 60% of the commission, Siti 40% of the commission" */
export const sharesText = (shares: CommissionShare[], personName: (id: string) => string) =>
  shares.length === 1 ? personName(shares[0].id) : shares.map(s => `${personName(s.id)} ${s.label}`).join(', ');

/** On the deal page: "Siti: 40% of the commission (owner 60%)" or "Siti: own 1% of the price (owner keeps the full commission)". */
export function coCloseText(deal: any, name: string): string {
  const co = coCloser(deal);
  if (!co) return '';
  return co.mode === 'own'
    ? `${name}: own ${co.pct}% of the price after SST and HRDC's %, on top (owner keeps the full commission)`
    : `${name}: ${co.pct}% of the commission (owner ${100 - co.pct}%)`;
}
