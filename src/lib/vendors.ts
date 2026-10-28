// Vendors: everyone NEXT Academy pays for a training (Joel, 2026-10-20: "please decide for me how the vendor info is
// to be recorded"). One list, Admin work → Vendors, seen only by Admin and Management (bank account numbers).
// - vendors/{id}: name, type, contact, bank details. Rule: Admin and Management read and write; delete Management.
// - A trainer or venue isn't typed twice: its vendor record points to it (trainerId / venueId) and takes its name
//   from the Trainers or Venues list, so picking the trainer on a checklist finds their bank details.
// - Payment requests raised from a deal's checklist (money_out) keep vendorId; the payment summary for accounts
//   reads the bank details live from here, but only once a manager has checked them (process audit, 2026-10-22).

import { isSuperManager } from './superManager';

export type VendorType = 'trainer' | 'venue' | 'transport' | 'facilitator' | 'materials' | 'referrer' | 'other';

export const VENDOR_TYPES: [VendorType, string][] = [
  ['trainer', 'Trainer'], ['venue', 'Venue'], ['transport', 'Transport (bus)'], ['facilitator', 'Facilitator'],
  ['materials', 'Materials or printing'], ['referrer', 'Referrer (referral fee)'], ['other', 'Other'],
];
export const vendorTypeLabel = (t?: string) => VENDOR_TYPES.find(([k]) => k === t)?.[1] || 'Other';

export interface Vendor {
  id: string;
  name: string;
  type: VendorType;
  trainerId?: string;      // the trainer in Trainers (type trainer)
  venueId?: string;        // the venue in Venues (type venue)
  contactName?: string;
  phone?: string;
  email?: string;
  bankName?: string;
  accountName?: string;
  accountNo?: string;
  ssmNo?: string;          // company registration (optional)
  tin?: string;            // tax identification number (LHDN); a trainer types it in the trainer portal (2026-10-21)
  // The receiver's details accounts need for LHDN e-Invoice (Accounts portal, 2026-10-28; lib/accountsPortal.ts).
  // A trainer's IC and address come from trainer_private when these are blank, a venue's address from Venues.
  nric?: string;
  address?: string;
  sstNo?: string;
  msic?: string;           // MSIC code
  business?: string;       // business activities
  taxRegNo?: string;
  gstNo?: string;          // previous GST registration no.
  picPhone?: string;       // the person in charge's mobile (contactName is their name)
  notes?: string;
  createdAt?: string;
  createdById?: string;
  createdByName?: string;
  updatedAt?: string;
  updatedByName?: string;
  // Bank check (process audit, 2026-10-22; firestore.rules): who last set the bank details, the log of every change,
  // and the manager (not the one who set them) who checked them. No bankSetById = saved before this, counts as checked.
  bankSetById?: string;
  bankSetByName?: string;
  bankSetAt?: string;
  bankCheckedById?: string;
  bankCheckedByName?: string;
  bankCheckedAt?: string;
  bankLog?: BankLogEntry[];
}

export interface BankLogEntry { at: string; byId: string; byName: string; bankName: string; accountNo: string; accountName: string }

const bankKey = (v?: Partial<Vendor> | null) => [v?.bankName || '', v?.accountNo || '', v?.accountName || ''].join('|');

/** The bank details may be shown to accounts: checked by a manager, or saved before the check existed. */
export const bankChecked = (v?: Partial<Vendor> | null) => !!v && (!v.bankSetById || !!v.bankCheckedById);

/** The fields to save with a vendor: when its bank details are new or changed, stamped and logged, waiting for a
 *  manager's check (firestore.rules checks the same). */
export function withBankStamp(next: Vendor, before: Partial<Vendor> | null | undefined, viewer: { id: string; name: string }): Vendor {
  if (bankKey(next) === bankKey(before)) return next;
  const at = new Date().toISOString();
  const entry: BankLogEntry = { at, byId: viewer.id, byName: viewer.name, bankName: next.bankName || '', accountNo: next.accountNo || '', accountName: next.accountName || '' };
  return {
    ...next, bankSetById: viewer.id, bankSetByName: viewer.name, bankSetAt: at,
    bankCheckedById: '', bankCheckedByName: '', bankCheckedAt: '', bankLog: [...(before?.bankLog || []), entry],
  };
}

/** The fields Management saves to confirm a vendor's bank details. */
export const bankCheckFields = (viewer: { id: string; name: string }) => ({ bankCheckedById: viewer.id, bankCheckedByName: viewer.name, bankCheckedAt: new Date().toISOString() });

/** Can this person confirm the bank details? A manager who did not set them, or the owner override. */
export const canCheckBank = (v: Partial<Vendor>, viewer: { id: string; role: string }) =>
  viewer.role === 'management' && !!v.bankSetById && !v.bankCheckedById && (v.bankSetById !== viewer.id || isSuperManager(viewer));

// The checklist step's kind → the vendor type listed first in the picker.
export const STEP_VENDOR_TYPE: Record<string, VendorType> = {
  venue: 'venue', bus: 'transport', facilitator: 'facilitator', trainer: 'trainer', materials: 'materials',
};

/** The vendor's name: a linked trainer's or venue's own name wins (one source of truth). */
export function vendorName(v: Vendor, trainers: any[] = [], venues: any[] = []): string {
  if (v.trainerId) { const t = trainers.find(x => x.id === v.trainerId); if (t?.name) return String(t.name).trim(); }
  if (v.venueId) { const t = venues.find(x => x.id === v.venueId); if (t?.name) return String(t.name).trim(); }
  return (v.name || '').trim() || 'Unnamed vendor';
}

export const hasBank = (v?: Partial<Vendor> | null) => !!(v && (v.accountNo || '').trim() && (v.bankName || '').trim());

/** "Maybank · 5140 1234 5678 · NEXT TRANSPORT SDN BHD", or '' when nothing is recorded. */
export function bankText(v?: Partial<Vendor> | null): string {
  if (!v) return '';
  return [v.bankName, v.accountNo, v.accountName].map(x => (x || '').trim()).filter(Boolean).join(' · ');
}

/** Why the vendor form can't be saved, or ''. */
export function vendorProblem(v: Partial<Vendor>, others: Vendor[]): string {
  const name = (v.name || '').trim();
  if (!name && !v.trainerId && !v.venueId) return 'Enter the vendor name.';
  if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) return 'That email address looks mistyped.';
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (v.trainerId && others.some(o => o.id !== v.id && o.trainerId === v.trainerId)) return 'This trainer already has a vendor record.';
  if (v.venueId && others.some(o => o.id !== v.id && o.venueId === v.venueId)) return 'This venue already has a vendor record.';
  if (name && !v.trainerId && !v.venueId && others.some(o => o.id !== v.id && !o.trainerId && !o.venueId && key(o.name || '') === key(name))) return `There's already a vendor called "${name}".`;
  return '';
}

/** The vendor record for a trainer or venue picked on a checklist, if one exists. */
export const vendorForTrainer = (vendors: Vendor[], trainerId?: string) => (trainerId ? vendors.find(v => v.trainerId === trainerId) : undefined);
export const vendorForVenue = (vendors: Vendor[], venueId?: string) => (venueId ? vendors.find(v => v.venueId === venueId) : undefined);
