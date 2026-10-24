// Referrers (Joel, 2026-10-24): people who refer a deal to NEXT Academy and get a referral fee.
// - referrers/{id}: name, phone, who added them, vendorId (their vendor record, once Admin or Management accepted the
//   bank details they typed on their link) and link { token, at, byName, status: open | submitted | accepted }.
//   Every team member reads the names (to pick one on a deal) and may add a new one by name and phone; only Admin and
//   Management change them (firestore.rules). Their bank details never sit here: they're on the vendor record.
// - referrer_links/{token}: the referrer's own link (/ref/<token>, no login) to type their bank details. Written only by
//   the CRM server (serverReferrers.ts); Admin and Management read the submission and accept it (Admin work → Referrers).
//   Accepting saves it on the referrer's vendor record (type 'referrer'), so a manager checks the bank details like any
//   vendor's and the payment summary for accounts shows them.
// - On the deal: referrerId, referrerName, referralFeeType ('pct' of the deal value, the price before SST, or a fixed
//   'rm' amount) and referralFeeValue. Once won, only Management changes them (firestore.rules).
// - When the deal is won, the server raises a pending "Referral fee" payment request (money_out ref_<dealId>) for a
//   manager to approve (never the requester's own). Approved, it's a cost in the deal's P&L.

import { dealValue } from './deals';

export type ReferralFeeType = 'pct' | 'rm';
export type ReferrerLinkStatus = 'open' | 'submitted' | 'accepted';

export interface Referrer {
  id: string;
  name: string;
  phone?: string;
  createdById?: string;
  createdByName?: string;
  createdAt?: number;
  vendorId?: string;
  link?: { token: string; at: string; byName: string; status: ReferrerLinkStatus } | null;
  notes?: string;
}

export const REFERRAL_CATEGORY = 'Referral fee';
export const referralOutId = (dealId: string) => `ref_${dealId}`;
export const referrerLinkUrl = (token: string, origin = typeof window !== 'undefined' ? window.location.origin : '') => `${origin}/ref/${token}`;
export const REFERRER_LINK_DAYS = 30;

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The referral fee in RM for this deal (0 when no referrer or no fee). */
export function referralFee(deal: any): number {
  if (!deal?.referrerId) return 0;
  const v = Number(deal.referralFeeValue) || 0;
  if (!(v > 0)) return 0;
  return deal.referralFeeType === 'rm' ? r2(v) : r2((dealValue(deal) * v) / 100);
}

/** "10% of the deal value" or "fixed RM 500.00". */
export function referralFeeText(deal: any): string {
  const v = Number(deal?.referralFeeValue) || 0;
  if (!deal?.referrerId || !(v > 0)) return 'No fee set';
  return deal.referralFeeType === 'rm' ? `fixed RM ${v.toFixed(2)}` : `${v}% of the deal value`;
}

/** Why the referral details on the deal form can't be saved, or ''. */
export function referralProblem(referrerId: string, type: string, valueText: string): string {
  if (!referrerId) return '';
  const t = String(valueText ?? '').trim();
  if (!t) return '';   // fee not agreed yet: it can be added later
  const v = Number(t);
  if (!Number.isFinite(v) || v < 0) return 'Enter the referral fee as a number, for example 5 (%) or 500 (RM).';
  if (type === 'pct' && v > 50) return 'A referral fee of more than 50% of the deal value looks mistyped.';
  return '';
}

// ---------- What the referrer types on their link (checked again on the server) ----------

export interface ReferrerSubmission {
  name: string; phone: string; email: string; bankName: string; accountName: string; accountNo: string;
}

const str = (x: any, max: number) => String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function cleanReferrerSubmission(x: any): ReferrerSubmission {
  return {
    name: str(x?.name, 120), phone: str(x?.phone, 40), email: str(x?.email, 120),
    bankName: str(x?.bankName, 80), accountName: str(x?.accountName, 120), accountNo: str(x?.accountNo, 40).replace(/[^0-9 -]/g, ''),
  };
}

export function referrerSubmissionProblem(s: ReferrerSubmission): string {
  if (!s.name) return 'Enter your full name.';
  if (!s.phone) return 'Enter your phone number.';
  if (s.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email)) return 'That email address looks mistyped.';
  if (!s.bankName) return 'Enter your bank.';
  if (!s.accountName) return 'Enter the name on the bank account.';
  if (s.accountNo.replace(/\D/g, '').length < 6) return 'Enter the bank account number.';
  return '';
}

export const LINK_STATUS_LABELS: Record<ReferrerLinkStatus, string> = {
  open: 'Link sent, waiting for their bank details',
  submitted: 'Bank details received, waiting for Admin to accept',
  accepted: 'Bank details accepted',
};
