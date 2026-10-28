// Accounts portal (Joel, 2026-10-28: "instead of sending the Accounts a link, create a portal to approve payments";
// sample: his "Next Academy Payment Request" Google Sheet). Accounts log in at /accounts (Team role Accounts, own
// staff) and see every approved payment that can be paid now, laid out like the sheet: No., Category, Receiver (the
// 14 LHDN e-Invoice details), Amount, Bank info, Details, Date of event, Remarks. They tick lines, type the bank
// reference and click Payment raised (keyed in the bank), or send a line back with a question. Management sees the same
// portal and manages it in Management → Accounts portal.
// Release (Joel, 2026-10-28: "in portal - account will tick raised payment - pending boss release payment; Management will
// tick when payment is done - either admin or management can upload the payment slip"): a raised payment waits under
// "Raised, pending release" (money_out.accountsRaised) until a manager releases it in the bank and clicks Payment done
// (portal or the Payments out board). Amber after raisedDays working days.
// Pure code, shared by the server (serverAccountsPortal.ts) and the screens. The server builds the rows: accounts
// logins can't read the database at all (no auth_map record).

import { MoneyOut, outWhat, payableFrom, paymentRef } from './money';
import { formatDate } from './deals';
import { payToProblem, waitsForTraining } from './paymentSummary';
import { Vendor, bankChecked, hasBank } from './vendors';

// ---------- The sheet's columns and the receiver's details ----------

export type PortalColumn = 'category' | 'receiver' | 'bank' | 'details' | 'eventDate' | 'remarks';
// No. and Amount are always shown.
export const PORTAL_COLUMNS: { key: PortalColumn; label: string }[] = [
  { key: 'category', label: 'Category' }, { key: 'receiver', label: 'Receiver' }, { key: 'bank', label: 'Bank info' },
  { key: 'details', label: 'Details' }, { key: 'eventDate', label: 'Date of event' }, { key: 'remarks', label: 'Remarks' },
];

export type ReceiverField = 'name' | 'nric' | 'tin' | 'regNo' | 'sstNo' | 'email' | 'phone' | 'address' | 'msic' | 'business'
  | 'taxRegNo' | 'gstNo' | 'picName' | 'picPhone';
// Same order and wording as the sheet. Name is always shown.
export const RECEIVER_FIELDS: { key: ReceiverField; label: string }[] = [
  { key: 'name', label: 'Name' }, { key: 'nric', label: 'NRIC' }, { key: 'tin', label: 'TIN No / Income Tax No' },
  { key: 'regNo', label: 'Registration (Old & New)' }, { key: 'sstNo', label: 'SST Registration No' }, { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Contact No' }, { key: 'address', label: 'Address' }, { key: 'msic', label: 'MSIC Code' },
  { key: 'business', label: 'Business Activities' }, { key: 'taxRegNo', label: 'Tax Reg. No.' }, { key: 'gstNo', label: 'Prev. GST Reg. No.' },
  { key: 'picName', label: 'PIC Name' }, { key: 'picPhone', label: 'H/P No.' },
];
export type Receiver = Record<ReceiverField, string>;

// ---------- Settings (config/accounts_portal, Management → Accounts portal; the server reads and writes it) ----------

export interface PortalSettings {
  allowPay: boolean;                      // accounts may mark payments raised in the portal (off = view only)
  raisedDays: number;                     // working days a raised payment may wait for release before it turns amber
  hiddenColumns: PortalColumn[];
  hiddenFields: ReceiverField[];
  categoryNames: Record<string, string>;  // the CRM's category → the name accounts see (blank = same)
}
export const DEFAULT_PORTAL_SETTINGS: PortalSettings = { allowPay: true, raisedDays: 3, hiddenColumns: [], hiddenFields: [], categoryNames: {} };

export function cleanPortalSettings(d: any): PortalSettings {
  const cols = PORTAL_COLUMNS.map(c => c.key);
  const fields = RECEIVER_FIELDS.map(f => f.key).filter(k => k !== 'name');
  const names: Record<string, string> = {};
  if (d?.categoryNames && typeof d.categoryNames === 'object') {
    Object.entries(d.categoryNames).slice(0, 60).forEach(([k, v]) => {
      const key = String(k).slice(0, 60), val = String(v ?? '').trim().slice(0, 60);
      if (key && val && val !== key) names[key] = val;
    });
  }
  return {
    allowPay: d?.allowPay !== false,
    raisedDays: Number.isInteger(Number(d?.raisedDays)) && Number(d.raisedDays) >= 1 && Number(d.raisedDays) <= 30 ? Number(d.raisedDays) : 3,
    hiddenColumns: Array.isArray(d?.hiddenColumns) ? cols.filter(c => d.hiddenColumns.includes(c)) : [],
    hiddenFields: Array.isArray(d?.hiddenFields) ? fields.filter(f => d.hiddenFields.includes(f)) as ReceiverField[] : [],
    categoryNames: names,
  };
}

export const categoryName = (category: string, s: PortalSettings) => s.categoryNames[category] || category || 'Other';

// ---------- One line of the sheet ----------

export type PortalSection = 'topay' | 'raised' | 'coming' | 'paid';

/** Accounts keyed it in the bank (Payment raised); it waits for a manager to release it. */
export interface PortalRaised { at: string; byId: string; byName: string; ref: string; note: string }

export interface PortalQuery { text: string; at: string; byName: string }

export interface PortalRow {
  id: string;
  ref: string;                 // PR-YYYYMMDD-NNNN
  section: PortalSection;
  waitReason: string;          // why a "Coming up" line can't be paid yet
  category: string;            // as accounts see it (settings)
  crmCategory: string;
  payeeKey: string;            // lines to the same receiver are paid together
  receiver: Receiver;
  amount: number;
  bankName: string;
  accountNo: string;
  accountName: string;
  paymentDetails: string;      // typed on a company payment
  details: string;             // what it's for: "Trainer fee · Client · Programme"
  eventDate: string;           // YYYY-MM-DD: the training's first day, or the company payment's "needed by"
  payFrom: string;             // first day it can be paid ('' = now)
  remarks: string;
  raisedByName: string;
  raisedAt: string;
  approvedByName: string;
  approvedAt: string;
  paidAt: string;
  paidDate: string;
  paidByName: string;
  paidRef: string;
  // Since the last payment to this receiver, its bank details changed (a manager checked them): accounts double-check.
  bankChangedAt: string;
  query: PortalQuery | null;   // accounts sent it back with a question; cleared by Admin or Management
  raised: PortalRaised | null; // keyed in the bank by accounts, waiting for release (and kept once paid)
  slips: number;               // receipts and bank slips on the payment
}

export interface PortalInput {
  outs: MoneyOut[];
  vendors: Vendor[];
  deals: Map<string, any>;
  clients: Map<string, any>;
  trainers: Map<string, any>;
  trainerPrivate: Map<string, any>;
  venues: Map<string, any>;
  slipCount: Map<string, number>;
  settings: PortalSettings;
  today: string;
}

const clean = (x: any) => String(x ?? '').trim();
const venueAddress = (v: any) => [v?.address1, v?.address2, v?.address3, v?.address4, [v?.postcode, v?.state].filter(Boolean).join(' ')]
  .map(clean).filter(Boolean).join(', ');

/** The 14 details of who is paid, from the vendor record (one source of truth), with the trainer's or venue's own
 *  details where the vendor record has none. */
export function receiverOf(o: MoneyOut, v: Vendor | undefined, inp: Pick<PortalInput, 'trainers' | 'trainerPrivate' | 'venues'>): Receiver {
  const t = v?.trainerId ? inp.trainers.get(v.trainerId) : undefined;
  const tp = v?.trainerId ? inp.trainerPrivate.get(v.trainerId) : undefined;
  const vn = v?.venueId ? inp.venues.get(v.venueId) : undefined;
  return {
    name: clean(t?.name || vn?.name || v?.name || o.payee) || 'Not named',
    nric: clean(v?.nric || tp?.icNumber),
    tin: clean(v?.tin),
    regNo: clean(v?.ssmNo),
    sstNo: clean(v?.sstNo),
    email: clean(v?.email || t?.email),
    phone: clean(v?.phone || t?.contact),
    address: clean(v?.address || tp?.address || venueAddress(vn)),
    msic: clean(v?.msic),
    business: clean(v?.business),
    taxRegNo: clean(v?.taxRegNo),
    gstNo: clean(v?.gstNo),
    picName: clean(v?.contactName),
    picPhone: clean(v?.picPhone),
  };
}

/** Which list a request goes in, and why it waits ('' = can be paid now). Rejected, withdrawn and deleted ones: null. */
export function sectionOf(o: MoneyOut, deal: any, vendor: Vendor | undefined, today: string): { section: PortalSection; wait: string } | null {
  if (o.deleted || (o as any).dealDeleted) return null;
  if (o.status === 'paid') return { section: 'paid', wait: '' };
  if (o.status === 'pending') return { section: 'coming', wait: "Waiting for a manager's approval" };
  if (o.status !== 'approved') return null;
  if (o.accountsRaised?.at) return { section: 'raised', wait: '' };
  if (waitsForTraining(o, deal, today)) {
    const from = formatDate(payableFrom(o, deal));
    return { section: 'coming', wait: o.partGroup && o.dueDate ? `${o.partLabel || `Part ${o.partNo}`}: due ${from}` : `After the training: payable from ${from}` };
  }
  const pay = payToProblem(o, vendor);
  if (pay) return { section: 'coming', wait: pay };
  return { section: 'topay', wait: '' };
}

/** The bank details changed after this receiver was last paid: when ('' = no). */
export function bankChangedSince(v: Vendor | undefined, outs: MoneyOut[]): string {
  if (!v?.bankSetAt || !hasBank(v)) return '';
  const paid = outs.filter(o => o.vendorId === v.id && o.status === 'paid' && !o.deleted)
    .map(o => o.paidAt || (o.paidDate ? `${o.paidDate}T23:59:59` : '')).filter(Boolean).sort();
  const last = paid[paid.length - 1];
  return last && v.bankSetAt > last ? v.bankSetAt : '';
}

export function buildPortalRows(inp: PortalInput): PortalRow[] {
  const vendors = new Map(inp.vendors.map(v => [v.id, v]));
  const rows: PortalRow[] = [];
  inp.outs.forEach(o => {
    const deal = o.dealId ? inp.deals.get(o.dealId) : undefined;
    if (o.dealId && !deal) return;                                  // its deal was erased
    if (deal?.deleted) return;
    const v = o.vendorId ? vendors.get(o.vendorId) : undefined;
    const where = sectionOf(o, deal, v, inp.today);
    if (!where) return;
    const client = deal ? inp.clients.get(deal.clientId) : undefined;
    const forText = deal ? [clean(client?.companyName || deal.client), clean(deal.courseName)].filter(Boolean).join(' · ') : 'Company payment';
    const what = outWhat(o) || (o.items || []).map(i => i.description).filter(Boolean).join(', ');
    const showBank = !!v && hasBank(v) && bankChecked(v);
    const remarks = [
      o.timing === 'after' ? 'Post-training' : o.timing === 'before' ? 'Pre-training' : '',
      o.partGroup ? `${o.partLabel || `Part ${o.partNo}`} (part ${o.partNo} of ${o.partCount})` : '',
      o.onBehalf ? 'Paid on behalf of the client' : '',
      deal?.trainingCancelled ? 'Training cancelled' : '',
    ].filter(Boolean).join(' · ');
    rows.push({
      id: o.id,
      ref: paymentRef(o),
      section: where.section,
      waitReason: where.wait,
      category: categoryName(o.category, inp.settings),
      crmCategory: o.category || 'Other',
      payeeKey: v ? `v:${v.id}` : `p:${clean(o.payee).toLowerCase()}`,
      receiver: receiverOf(o, v, inp),
      amount: Number(o.amount) || 0,
      bankName: showBank ? clean(v!.bankName) : '',
      accountNo: showBank ? clean(v!.accountNo) : '',
      accountName: showBank ? clean(v!.accountName) : '',
      paymentDetails: clean(o.paymentDetails),
      details: [what, forText].filter(Boolean).join(' · '),
      eventDate: clean(deal?.trainingDate || o.neededBy).slice(0, 10),
      payFrom: o.status === 'approved' ? payableFrom(o, deal) : '',
      remarks,
      raisedByName: clean(o.requestedByName),
      raisedAt: clean(o.requestedAt || o.requestDate),
      approvedByName: clean(o.decidedByName),
      approvedAt: clean(o.decidedAt),
      paidAt: clean(o.paidAt),
      paidDate: clean(o.paidDate),
      paidByName: clean(o.paidByName),
      paidRef: clean(o.paidRef),
      bankChangedAt: where.section === 'paid' ? '' : bankChangedSince(v, inp.outs),
      query: o.accountsQuery?.text ? o.accountsQuery : null,
      raised: o.accountsRaised?.at ? o.accountsRaised : null,
      slips: inp.slipCount.get(o.id) || 0,
    });
  });
  return rows;
}

// ---------- Filters, months and search (the portal and its download) ----------

/** The month a line belongs to: paid ones by the day paid; others by the date of the event (else the day raised). */
export const rowMonth = (r: PortalRow) => (r.section === 'paid' ? (r.paidAt ? isoMY(r.paidAt) : r.paidDate) : r.eventDate || isoMY(r.raisedAt)).slice(0, 7);
const isoMY = (iso: string) => { const t = Date.parse(iso); return isNaN(t) ? String(iso || '').slice(0, 10) : new Date(t + 8 * 3600_000).toISOString().slice(0, 10); };

export const monthLabel = (ym: string) => {
  if (!/^\d{4}-\d{2}$/.test(ym)) return 'All months';
  return new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-MY', { month: 'short', year: 'numeric' });
};

/** Every word typed must be found somewhere on the line: receiver, category, amount, reference, bank, details. */
export function rowMatches(r: PortalRow, search: string): boolean {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [r.ref, r.category, r.crmCategory, ...Object.values(r.receiver), r.amount.toFixed(2), String(r.amount), r.bankName, r.accountNo, r.accountName,
    r.paymentDetails, r.details, r.remarks, r.paidRef, r.paidByName, r.raisedByName, r.approvedByName, formatDate(r.eventDate), r.waitReason]
    .join(' ').toLowerCase().replace(/,/g, '');
  return words.every(w => hay.includes(w.replace(/,/g, '')));
}

export const rowsTotal = (rows: PortalRow[]) => Math.round(rows.reduce((t, r) => t + r.amount, 0) * 100) / 100;

/** "Maybank\n5140 1234 5678\nNEXT TRANSPORT SDN BHD", or the typed payment details. */
export const bankLines = (r: PortalRow) => (r.accountNo ? [r.bankName, r.accountNo, r.accountName].filter(Boolean) : r.paymentDetails ? [r.paymentDetails] : []);

/** The receiver block as on the sheet: "1. Name : …" lines, without the fields Management hid. Empty shows "-". */
export function receiverLines(r: Pick<PortalRow, 'receiver'>, s: Pick<PortalSettings, 'hiddenFields'>): string[] {
  return RECEIVER_FIELDS.filter(f => !s.hiddenFields.includes(f.key)).map((f, i) => `${i + 1}. ${f.label} : ${r.receiver[f.key] || '-'}`);
}

// ---------- Activity log (accounts_log, written by the server, read by Management) ----------

export interface PortalLogEntry { id: string; at: string; byId: string; byName: string; action: 'raised' | 'unraised' | 'paid' | 'query' | 'slip' | 'cleared' | 'settings'; text: string; moneyOutIds?: string[] }

// ---------- Raised, pending release ----------

/** Working days (Monday to Friday) from the day raised to today, in Malaysia. */
export function workingDaysSince(iso: string, now = Date.now()): number {
  const t = Date.parse(iso);
  if (isNaN(t)) return 0;
  const day = (ms: number) => new Date(ms + 8 * 3600_000);
  const d = day(t), end = day(now);
  d.setUTCHours(0, 0, 0, 0); end.setUTCHours(0, 0, 0, 0);
  let n = 0;
  while (d < end) { d.setUTCDate(d.getUTCDate() + 1); const w = d.getUTCDay(); if (w !== 0 && w !== 6) n++; }
  return n;
}

/** Raised more than `days` working days ago and still not released: amber. */
export const releaseLate = (raised: { at: string } | null | undefined, days: number, now = Date.now()) => !!raised?.at && workingDaysSince(raised.at, now) > days;
