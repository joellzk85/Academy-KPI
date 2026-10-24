// Co-closed deals (Joel, 2026-10-24): a deal closed together with a teammate. The co-closer gets coClosePct % of the
// sales commission and the deal owner keeps the rest. KPIs (Closing RM, won deals, GP %) stay 100% with the owner
// (Joel's choice: "commission only").
// Deal fields: coCloserId, coCloserName, coClosePct (1 to 99). Once won, only Management changes them (firestore.rules).

export interface CommissionShare { id: string; pct: number; amount: number }

export function coCloser(deal: any): { id: string; name: string; pct: number } | null {
  const id = String(deal?.coCloserId || '');
  const pct = Number(deal?.coClosePct) || 0;
  if (!id || !(pct > 0 && pct < 100)) return null;
  return { id, name: String(deal?.coCloserName || ''), pct };
}

/** Who gets the commission: the owner alone, or the owner and the co-closer by the agreed %. */
export function commissionShares(deal: any, ownerId: string, commission: number): CommissionShare[] {
  const co = coCloser(deal);
  if (!co || co.id === ownerId) return [{ id: ownerId, pct: 100, amount: commission }];
  const coAmount = Math.round(commission * co.pct) / 100;
  return [{ id: ownerId, pct: 100 - co.pct, amount: Math.round((commission - coAmount) * 100) / 100 }, { id: co.id, pct: co.pct, amount: coAmount }];
}

/** Why the co-closed details can't be saved, or ''. pctText is what was typed. */
export function coCloseProblem(ownerId: string, coId: string, pctText: string): string {
  if (!coId) return '';
  if (coId === ownerId) return 'The co-closer must be someone other than the deal owner.';
  const pct = Number(String(pctText).trim());
  if (!String(pctText).trim() || !Number.isFinite(pct) || pct <= 0 || pct >= 100) return "Enter the co-closer's share of the commission, from 1 to 99 (%).";
  return '';
}

/** "Alif 60%, Siti 40%" */
export const sharesText = (shares: CommissionShare[], personName: (id: string) => string) =>
  shares.length === 1 ? personName(shares[0].id) : shares.map(s => `${personName(s.id)} ${s.pct}%`).join(', ');
