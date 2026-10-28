// Staff claims (Joel, 2026-10-28: "each claim should have more details - example entertainment - customer name - date
// time - and actual meal receipt"). Everyone raises their own claims in My claims; Admin raises for someone else only
// when Management ticks them (Management always may). Every claim needs a manager's approval, never their own. Over a
// limit it becomes a Special request with a reason. Once approved it becomes an approved company payment (Staff claim),
// with its files attached, ready for accounts.
// - claims/{id}: one claim (status pending → approved / rejected; a rejected one is fixed and sent again).
// - config/claim_settings: categories, the boxes each asks for, limits (default + per person), who may raise for others.
// - Files: Firebase Storage claims/{memberId}/{id}_{name} (storage.rules).
// - The payment: money_out/claim_{id} (kind 'company', category 'Staff claim'), files as payment_receipts kind 'support'.

import { formatDate, formatRM } from './deals';

export type ClaimStatus = 'pending' | 'approved' | 'rejected';

export const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  pending: 'Waiting for approval',
  approved: 'Approved',
  rejected: 'Rejected',
};

// The extra boxes a category can ask for, on top of the boxes every claim has.
export type ClaimField = 'client' | 'attendees' | 'time' | 'place' | 'deal' | 'clinic' | 'reason' | 'from' | 'to' | 'km' | 'purpose' | 'benefit' | 'description';
export const CLAIM_FIELDS: { key: ClaimField; label: string; hint: string }[] = [
  { key: 'client', label: 'Client', hint: 'Picked from the Clients list' },
  { key: 'attendees', label: 'Who attended', hint: 'Names on both sides, and how many people' },
  { key: 'time', label: 'Time', hint: '' },
  { key: 'place', label: 'Place', hint: 'Restaurant or venue' },
  { key: 'deal', label: 'Linked deal', hint: 'One of the person\'s deals' },
  { key: 'clinic', label: 'Clinic or hospital', hint: '' },
  { key: 'reason', label: 'Illness or reason', hint: '' },
  { key: 'from', label: 'From', hint: '' },
  { key: 'to', label: 'To', hint: '' },
  { key: 'km', label: 'Distance (km)', hint: '' },
  { key: 'purpose', label: 'Purpose', hint: '' },
  { key: 'benefit', label: 'Benefit', hint: 'For example optical, dental, gym' },
  { key: 'description', label: 'Description', hint: '' },
];
export const fieldLabel = (k: ClaimField) => CLAIM_FIELDS.find(f => f.key === k)?.label || k;

export type FieldNeed = 'required' | 'optional';

/** Limits in RM; null = no limit. perHead only counts when the category asks "Who attended". */
export interface ClaimLimits { perClaim: number | null; perMonth: number | null; perYear: number | null; perHead: number | null }
export const LIMIT_KEYS: { key: keyof ClaimLimits; label: string }[] = [
  { key: 'perClaim', label: 'Per claim' }, { key: 'perHead', label: 'Per head' }, { key: 'perMonth', label: 'Per month' }, { key: 'perYear', label: 'Per year' },
];
export const NO_LIMITS: ClaimLimits = { perClaim: null, perMonth: null, perYear: null, perHead: null };

export interface ClaimCategory {
  id: string;
  name: string;
  active: boolean;
  fields: Partial<Record<ClaimField, FieldNeed>>;
  receiptNeeded: boolean;
  submitDays: number | null;     // submitted later than this many days after the spend = flagged late (null = no check)
  limits: ClaimLimits;           // for everyone, unless the person has their own
}

export interface ClaimSettings {
  categories: ClaimCategory[];
  // Joel, 2026-10-28: "limits are different for everyone". personLimits[memberId][categoryId]: a blank (missing) limit
  // uses the category's limit for everyone.
  personLimits: Record<string, Record<string, Partial<ClaimLimits>>>;
  raiseForOthers: string[];      // people (not Management) Management ticked to raise claims for someone else
}

// Joel, 2026-10-28: Medical, Travel, Sales process, Employee benefit, Other. No company policy yet, so no limits.
export const DEFAULT_CATEGORIES: ClaimCategory[] = [
  { id: 'medical', name: 'Medical', active: true, receiptNeeded: true, submitDays: 30, limits: { ...NO_LIMITS },
    fields: { clinic: 'required', reason: 'optional' } },
  { id: 'travel', name: 'Travel', active: true, receiptNeeded: true, submitDays: 30, limits: { ...NO_LIMITS },
    fields: { from: 'required', to: 'required', purpose: 'required', km: 'optional', deal: 'optional' } },
  { id: 'sales', name: 'Sales process', active: true, receiptNeeded: true, submitDays: 30, limits: { ...NO_LIMITS },
    fields: { client: 'required', attendees: 'required', time: 'required', place: 'required', purpose: 'optional', deal: 'optional' } },
  { id: 'benefit', name: 'Employee benefit', active: true, receiptNeeded: true, submitDays: 30, limits: { ...NO_LIMITS },
    fields: { benefit: 'required', description: 'optional' } },
  { id: 'other', name: 'Other', active: true, receiptNeeded: true, submitDays: 30, limits: { ...NO_LIMITS },
    fields: { description: 'required' } },
];

const limitNum = (v: any): number | null => (v === null || v === undefined || v === '' || !(Number(v) >= 0) ? null : Math.round(Number(v) * 100) / 100);
const readLimits = (d: any): ClaimLimits => ({ perClaim: limitNum(d?.perClaim), perMonth: limitNum(d?.perMonth), perYear: limitNum(d?.perYear), perHead: limitNum(d?.perHead) });

export function readClaimSettings(data: any): ClaimSettings {
  const cats: ClaimCategory[] = Array.isArray(data?.categories) && data.categories.length
    ? data.categories.filter((c: any) => c && c.id && c.name).map((c: any) => ({
      id: String(c.id), name: String(c.name), active: c.active !== false, receiptNeeded: c.receiptNeeded !== false,
      submitDays: c.submitDays === null || c.submitDays === '' || c.submitDays === undefined ? null : Math.max(0, Math.round(Number(c.submitDays) || 0)),
      limits: readLimits(c.limits),
      fields: Object.fromEntries(Object.entries(c.fields || {}).filter(([k, v]) => CLAIM_FIELDS.some(f => f.key === k) && (v === 'required' || v === 'optional'))),
    }))
    : DEFAULT_CATEGORIES.map(c => ({ ...c, fields: { ...c.fields }, limits: { ...c.limits } }));
  const personLimits: ClaimSettings['personLimits'] = {};
  Object.entries(data?.personLimits || {}).forEach(([pid, byCat]: [string, any]) => {
    Object.entries(byCat || {}).forEach(([cid, l]: [string, any]) => {
      const one: Partial<ClaimLimits> = {};
      LIMIT_KEYS.forEach(({ key }) => { const n = limitNum(l?.[key]); if (n !== null) one[key] = n; });
      if (Object.keys(one).length) (personLimits[pid] ||= {})[cid] = one;
    });
  });
  return { categories: cats, personLimits, raiseForOthers: Array.isArray(data?.raiseForOthers) ? data.raiseForOthers.map(String) : [] };
}

/** The limits that apply to this person in this category: their own, else the category's. */
export function limitsFor(s: ClaimSettings, cat: ClaimCategory, memberId: string): ClaimLimits {
  const own = s.personLimits[memberId]?.[cat.id] || {};
  const out = { ...cat.limits };
  LIMIT_KEYS.forEach(({ key }) => { if (own[key] !== undefined && own[key] !== null) out[key] = own[key] as number; });
  return out;
}

/** May this person raise a claim for someone else? Management always; others when Management ticked them. */
export const canRaiseForOthers = (s: ClaimSettings, viewer: { id: string; role: string }) =>
  viewer.role === 'management' || s.raiseForOthers.includes(viewer.id);

// ---------- One claim ----------

export interface ClaimFile { name: string; size: number; type: string; path: string; at: string }

export interface ClaimExtra {
  clientId?: string; clientName?: string;
  attendees?: string; pax?: number;
  time?: string; place?: string;
  dealId?: string; dealName?: string;
  clinic?: string; reason?: string;
  from?: string; to?: string; km?: number;
  purpose?: string; benefit?: string; description?: string;
}

export interface Claim {
  id: string;
  memberId: string;              // whose claim it is (who is paid)
  memberName: string;
  raisedById: string;            // who typed it in (themselves, or someone Management allowed)
  raisedByName: string;
  categoryId: string;
  categoryName: string;
  date: string;                  // date of transaction, YYYY-MM-DD
  amount: number;                // total claimed (RM, with sen)
  includeSst?: boolean;          // the amount includes SST
  receiptNo?: string;            // tax invoice / receipt / e-Invoice no.
  uuid?: string;                 // e-Invoice unique identifier (LHDN)
  notes?: string;
  extra: ClaimExtra;
  files: ClaimFile[];
  paymentDetails: string;        // the person's bank, account number and name (remembered from their last claim)
  special?: boolean;             // over a limit when sent: a Special request
  specialReason?: string;
  overLimits?: string[];         // which limits, as sent ("Per month: RM 520.00 of RM 500.00")
  status: ClaimStatus;
  submittedAt: string;
  resubmittedAt?: string;
  decidedById?: string;
  decidedByName?: string;
  decidedAt?: string;
  decidedTs?: any;
  rejectReason?: string;
  moneyOutId?: string;           // the company payment made on approval (money_out/claim_{id})
}

export const newClaimId = () => `cl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export const claimPaymentId = (claimId: string) => `claim_${claimId}`;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Claims that use up a limit: waiting or approved (a rejected one doesn't count). */
const counts = (c: Claim) => c.status === 'pending' || c.status === 'approved';

export interface Usage { month: number; year: number }
/** What this person has already claimed in this category in the claim date's month and year (not counting `skipId`). */
export function usageFor(claims: Claim[], memberId: string, categoryId: string, date: string, skipId = ''): Usage {
  const ym = date.slice(0, 7), y = date.slice(0, 4);
  let month = 0, year = 0;
  claims.forEach(c => {
    if (c.id === skipId || c.memberId !== memberId || c.categoryId !== categoryId || !counts(c)) return;
    if (c.date.slice(0, 4) === y) year += Number(c.amount) || 0;
    if (c.date.slice(0, 7) === ym) month += Number(c.amount) || 0;
  });
  return { month: r2(month), year: r2(year) };
}

/** The limits this claim goes over, as plain lines. Empty = within every limit. */
export function overLimits(c: Pick<Claim, 'amount' | 'extra'>, lim: ClaimLimits, used: Usage, asksPax: boolean): string[] {
  const out: string[] = [];
  const amt = Number(c.amount) || 0;
  if (lim.perClaim !== null && amt > lim.perClaim) out.push(`Per claim: ${formatRM(amt)} is over ${formatRM(lim.perClaim)}`);
  const pax = Number(c.extra?.pax) || 0;
  if (asksPax && lim.perHead !== null && pax > 0 && amt / pax > lim.perHead) out.push(`Per head: ${formatRM(r2(amt / pax))} a person is over ${formatRM(lim.perHead)}`);
  if (lim.perMonth !== null && used.month + amt > lim.perMonth) out.push(`Per month: ${formatRM(r2(used.month + amt))} of ${formatRM(lim.perMonth)} (already ${formatRM(used.month)})`);
  if (lim.perYear !== null && used.year + amt > lim.perYear) out.push(`Per year: ${formatRM(r2(used.year + amt))} of ${formatRM(lim.perYear)} (already ${formatRM(used.year)})`);
  return out;
}

const dayDiff = (from: string, to: string) => Math.round((Date.parse(to.slice(0, 10) + 'T00:00:00Z') - Date.parse(from.slice(0, 10) + 'T00:00:00Z')) / 86400000);
// "inv 7781", "INV-7781" and "INV7781" are the same receipt.
const norm = (s?: string) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Sent more than submitDays after the spend: how many days late (0 = on time). */
export function lateDays(c: Pick<Claim, 'date' | 'submittedAt'>, cat: ClaimCategory | undefined): number {
  if (!cat || cat.submitDays === null || !c.date || !c.submittedAt) return 0;
  const d = dayDiff(c.date, c.submittedAt);
  return d > cat.submitDays ? d - cat.submitDays : 0;
}

/** Other claims (anyone's, not rejected) with the same receipt no. or e-Invoice UUID. */
export function duplicatesOf(c: Pick<Claim, 'id' | 'receiptNo' | 'uuid'>, claims: Claim[]): Claim[] {
  const no = norm(c.receiptNo), id = norm(c.uuid);
  if (!no && !id) return [];
  return claims.filter(x => x.id !== c.id && x.status !== 'rejected' && ((no && norm(x.receiptNo) === no) || (id && norm(x.uuid) === id)));
}

/** A Sales process claim with a client: was a meeting with that client logged that day (a deal's appointment held, or
 *  a touch point on the client)? Deals and touch points are read by the caller. */
export function meetingLogged(c: Pick<Claim, 'date' | 'extra'>, deals: any[], touchPoints: any[]): boolean {
  const cid = c.extra?.clientId;
  if (!cid) return true;
  const day = c.date.slice(0, 10);
  const held = deals.some(d => d.clientId === cid && d.appointment?.status === 'held' && String(d.appointment?.date || '').slice(0, 10) === day);
  return held || touchPoints.some(t => t.clientId === cid && String(t.date || '').slice(0, 10) === day);
}

export interface ClaimFlag { level: 'danger' | 'attention'; text: string }

/** Everything the approving manager should look at on this claim. */
export function claimFlags(c: Claim, s: ClaimSettings, all: Claim[], deals: any[] | null, touchPoints: any[] | null): ClaimFlag[] {
  const cat = s.categories.find(x => x.id === c.categoryId);
  const flags: ClaimFlag[] = [];
  if (cat) {
    // Only claims sent before this one count as "already used": a later claim doesn't push an earlier one over.
    const before = all.filter(x => String(x.submittedAt) < String(c.submittedAt));
    const over = overLimits(c, limitsFor(s, cat, c.memberId), usageFor(before, c.memberId, c.categoryId, c.date, c.id), !!cat.fields.attendees);
    over.forEach(t => flags.push({ level: 'danger', text: `Over the limit. ${t}` }));
  }
  if (c.special && c.specialReason) flags.push({ level: 'attention', text: `Special request: ${c.specialReason}` });
  const dups = duplicatesOf(c, all);
  if (dups.length) flags.push({ level: 'danger', text: `Same receipt no. or UUID as ${dups.map(d => `${d.memberName}'s ${d.categoryName} claim of ${formatRM(d.amount)} (${formatDate(d.date)})`).join(', ')}` });
  const late = lateDays(c, cat);
  if (late) flags.push({ level: 'attention', text: `Sent ${late} day${late === 1 ? '' : 's'} later than the ${cat!.submitDays}-day limit` });
  if (deals && touchPoints && c.extra?.clientId && !meetingLogged(c, deals, touchPoints))
    flags.push({ level: 'attention', text: `No meeting with ${c.extra.clientName || 'this client'} logged on ${formatDate(c.date)}` });
  if (cat?.receiptNeeded && !c.files?.length) flags.push({ level: 'danger', text: 'No receipt attached' });
  return flags;
}

/** "Medical · Klinik Ali · fever": what a claim is for, in one line (also the payment's description). */
export function claimSummary(c: Pick<Claim, 'categoryName' | 'extra' | 'notes'>): string {
  const e = c.extra || {};
  const bits = [
    e.clientName, e.attendees ? `${e.attendees}${e.pax ? ` (${e.pax} pax)` : ''}` : '', e.place, e.time,
    e.clinic, e.reason, e.from && e.to ? `${e.from} → ${e.to}${e.km ? ` (${e.km} km)` : ''}` : e.from || e.to,
    e.benefit, e.purpose, e.description, e.dealName ? `Deal: ${e.dealName}` : '',
  ].filter(Boolean);
  return [c.categoryName, ...bits].join(' · ');
}

/** The company payment made when a manager approves the claim (money_out/claim_{id}). */
export function claimPayment(c: Claim, viewer: { id: string; name: string }, at: string) {
  const what = claimSummary(c);
  return {
    id: claimPaymentId(c.id), dealId: '', kind: 'company', timing: 'before', category: 'Staff claim',
    payee: c.memberName, vendorId: '', amount: Number(c.amount) || 0,
    description: `${what}${c.receiptNo ? ` · Receipt ${c.receiptNo}` : ''}${c.notes ? ` · ${c.notes}` : ''}`,
    requestDate: at.slice(0, 10), items: [{ description: what, qty: 1, price: Number(c.amount) || 0 }], neededBy: '',
    paymentDetails: c.paymentDetails,
    status: 'approved', requestedById: c.memberId, requestedByName: c.memberName, requestedAt: c.submittedAt,
    decidedById: viewer.id, decidedByName: viewer.name, decidedAt: at, rejectReason: '',
    paidDate: '', paidRef: '', paidById: '', paidByName: '',
    claimId: c.id, deleted: false,
  };
}
