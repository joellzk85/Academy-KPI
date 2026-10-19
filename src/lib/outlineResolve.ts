// Course outlines, one source of truth (2026-10-17, like quotations).
// While an outline is a draft, these are read live:
//   prepared for (company)  <- client list (the deal's client if a deal is linked)
//   course title            <- the programme's name, when useProgrammeName is on. The programme is the
//                              outline's own (programmeId), else the linked deal's (Joel, 2026-10-17).
//   owner                   <- the deal's owner
// "Mark as sent" writes the resolved text into the outline and locks it; "Revise" unlocks it.

import { CourseOutline } from '../types';
import { dealOwnerId } from './deals';
import { DEFAULT_OUTLINE_TERMS } from './outlineContent';
import { nextDocRef } from './docRefs';

export interface OutlineSources {
  clients: any[];
  deals: any[];
  programmes: any[];
  people: { id: string; name: string }[];
}

export interface ResolvedOutline {
  o: CourseOutline;      // with the live details filled in (what prints)
  deal: any | null;
  client: any | null;
  ownerId: string;
  programmeName: string; // the outline's programme name (its own, else the deal's), if any
  programmeId: string;
}

// The programme an outline is for: its own, else its deal's.
export function outlineProgrammeId(o: { programmeId?: string }, deal: any | null): string {
  return o.programmeId || deal?.programmeId || '';
}

export function outlineSent(o: CourseOutline): boolean {
  return o.status === 'sent';
}

export function dealProgrammeName(deal: any, programmes: any[]): string {
  if (!deal) return '';
  return String(programmes.find(p => p.id === deal.programmeId)?.name || deal.courseName || '').trim();
}

export function resolveOutline(o: CourseOutline, s: OutlineSources): ResolvedOutline {
  const deal = o.pipelineId ? s.deals.find(d => d.id === o.pipelineId) || null : null;
  const clientId = deal?.clientId || o.clientId || '';
  const client = clientId ? s.clients.find(c => c.id === clientId) || null : null;
  const ownerId = (deal && dealOwnerId(deal)) || o.ownerId || o.creatorId || '';
  const programmeId = outlineProgrammeId(o, deal);
  const programmeName = o.programmeId
    ? String(s.programmes.find(p => p.id === o.programmeId)?.name || '').trim()
    : dealProgrammeName(deal, s.programmes);
  if (outlineSent(o)) return { o, deal, client, ownerId, programmeName, programmeId };

  const out: CourseOutline = { ...o, clientId: clientId || o.clientId };
  if (client) out.preparedForCompany = client.companyName || '';
  if (o.useProgrammeName && programmeName) out.courseTitle = programmeName;
  const owner = s.people.find(p => p.id === ownerId);
  if (owner) { out.ownerId = owner.id; out.ownerName = owner.name; }
  out.items = (o.items || []).map((m, i) => ({ ...m, no: i + 1 }));
  // No terms of its own yet: the standard terms (written into the outline when it's sent, so they stay as sent).
  if (o.terms === undefined) out.terms = DEFAULT_OUTLINE_TERMS;
  return { o: out, deal, client, ownerId, programmeName, programmeId };
}

// Reference numbers (2026-10-19): HKL/NA/PRO/YYYYMMDD/NN, the client's code then the next number for the day across
// all course outlines (older CO/ numbers count too). See lib/docRefs.ts.
export function nextOutlineRef(all: { refNumber?: string }[], dateIso: string, code = ''): string {
  return nextDocRef('outline', all, dateIso, code);
}
