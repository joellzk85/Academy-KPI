// Venues: which deals use a venue (2026-10-17), the same rule as the deal panel's Venue line:
// the admin checklist's venue, else the quotation's (the one marked sent, else the newest draft).

import { Venue } from '../types';
import { dealStage } from './deals';
import { dealVenue } from './checklist';
import { doc, setDoc } from 'firebase/firestore';
import { db } from './firebase';

const norm = (s?: string) => (s || '').trim().toLowerCase();

export interface VenueBooking { deal: any; confirmed: boolean; date: string }

export function venueBookings(v: Venue, deals: any[], checklists: Record<string, any>, quotes: any[], venues: any[]): VenueBooking[] {
  const out: VenueBooking[] = [];
  deals.forEach(d => {
    if (dealStage(d) === 'lost') return;
    const cl = checklists[d.id] || null;
    const picked = dealVenue(cl, quotes.filter(q => q.pipelineId === d.id), venues);
    if (!picked) return;
    if (picked.id !== v.id && norm(picked.name) !== norm(v.name)) return;
    const task = (cl?.tasks || []).find((x: any) => x.kind === 'venue');
    out.push({ deal: d, confirmed: !!task?.done, date: /^\d{4}-\d{2}-\d{2}/.test(d.trainingDate || '') ? d.trainingDate.slice(0, 10) : '' });
  });
  return out;
}

// The first phone number in a free-text contact, e.g. "Ms Wong (+6019-222 3344)" -> "+6019-222 3344".
export function phoneIn(text?: string): string {
  const m = (text || '').match(/\+?\d[\d\s-]{7,}\d/);
  return m ? m[0].trim() : '';
}

// A venue typed on a quotation or the checklist, saved to the Venues list in one click (full deal test, 2026-10-23:
// free text is fine, then the CRM offers to keep it). A venue of the same name already in the list is reused.
export async function saveTypedVenue(name: string, venues: { id: string; name?: string }[], by: { id: string; name: string }): Promise<string> {
  const clean = name.trim();
  const same = venues.find(v => norm(v.name) === norm(clean));
  if (same) return same.id;
  const id = `venue_${Date.now()}`;
  await setDoc(doc(db, 'venues_directory', id), {
    id, name: clean, region: '', distance: '', pictures: '', meetingPackagePrice: '', roomPackagePrice: '', dinnerPackage: '',
    quotationDate: '', facilities: '', contact: '', remarks: '', status: 'Available', photos: [],
    createdAt: Date.now(), createdBy: by.id, createdByName: by.name,
  });
  return id;
}
