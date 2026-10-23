// What the client agreed online, and price discounts (Joel, 2026-10-23, full deal test batch 3).
// - acceptedOnline (set by the server when a client accepts a teambuilding proposal online): the package, pax and
//   price the client picked. Clients negotiate, so it doesn't change the deal; the owner confirms the amount
//   (use the accepted price and pax, or keep the deal as it is).
// - discountRequest: a quotation priced below the deal value needs a manager's approval first (never your own;
//   the owner override can, after a warning). Approving sets the deal value to the discounted price. The GP % comes
//   from a Costing estimate the rep links to the request. Pure, so it can be tested.
import { dealStage, dealValue } from './deals';
import { isSuperManager } from './superManager';

export interface AcceptedOnline {
  packageName: string; pax: number; price: number | null; name: string; position: string; at: number;
  confirmed: boolean; choice?: 'accepted' | 'kept'; confirmedByName?: string; confirmedAt?: string;
}

export type DiscountStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';
export interface DiscountRequest {
  id: string; quoteId: string; quoteRef: string;
  fromValue: number; toValue: number; reason: string;
  byId: string; byName: string; at: string;
  estimateId?: string; estimateTitle?: string; gpFrom?: number | null; gpTo?: number | null;
  status: DiscountStatus;
  decidedById?: string; decidedByName?: string; decidedAt?: string; rejectReason?: string;
}

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };

/** The online acceptance still waiting for the owner to confirm the amount (none once the deal is won or lost). */
export function acceptToConfirm(p: any): AcceptedOnline | null {
  const a = p?.acceptedOnline as AcceptedOnline | undefined;
  if (!a || a.confirmed || ['won', 'lost'].includes(dealStage(p))) return null;
  return a;
}

export const pendingDiscount = (p: any): DiscountRequest | null =>
  p?.discountRequest?.status === 'pending' ? (p.discountRequest as DiscountRequest) : null;

export function canDecideDiscount(r: DiscountRequest | null, viewer: Viewer): boolean {
  return !!r && r.status === 'pending' && viewer.role === 'management' && (r.byId !== viewer.id || isSuperManager(viewer));
}

/** Why a quotation can't be sent yet because of its price ('' = it can): below the deal value with no approved discount. */
export function discountBlock(p: any, quoteId: string, programmeTotal: number): string {
  const value = dealValue(p);
  if (!p || value <= 0 || programmeTotal <= 0 || programmeTotal >= value - 0.005) return '';
  const r = p.discountRequest as DiscountRequest | undefined;
  if (r?.status === 'pending' && r.quoteId === quoteId) return 'The discount on this quotation is waiting for a manager\'s approval.';
  return `This quotation (RM ${programmeTotal.toLocaleString('en-MY', { minimumFractionDigits: 2 })}) is below the deal value (RM ${value.toLocaleString('en-MY', { minimumFractionDigits: 2 })}). Request a discount first; a manager approves it.`;
}

/** A lower value typed in Edit details after the proposal went out needs a discount request instead (Management can). */
export function valueDropBlocked(p: any, newValue: number, viewer: Viewer): boolean {
  if (!p || viewer.role === 'management') return false;
  return ['proposal', 'agreed', 'quoted'].includes(dealStage(p)) && dealValue(p) > 0 && newValue < dealValue(p) - 0.005;
}

export function discountProblem(fromValue: number, toValue: number, reason: string): string {
  if (!Number.isFinite(toValue) || toValue <= 0) return 'Enter the new price as a number, for example 16000.';
  if (toValue >= fromValue) return `The new price must be below the deal value (RM ${fromValue.toLocaleString('en-MY')}).`;
  if (reason.trim().length < 5) return 'Say why the client needs a discount (a few words).';
  return '';
}

export const discountPct = (r: Pick<DiscountRequest, 'fromValue' | 'toValue'>) => (r.fromValue > 0 ? ((r.fromValue - r.toValue) / r.fromValue) * 100 : 0);
