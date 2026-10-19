// "Repeat this deal" (Joel, 2026-10-19): repeat clients with a repeated programme. A won deal (from the deal panel or
// the client page) becomes a new deal with the same client, attention person, programme, funding type, value and type,
// straight at "Client approved" with "No proposal needed: Repeat client, same programme" (so the Proposal KPI doesn't
// count it). The quotation is a copy of the won deal's quotation (the sent one, else the newest draft) with today's date,
// a new reference and no training date (the new deal's date is read live), so only what changed needs typing.
// No quotation on the old deal: a fresh one is built from the new deal, as "Create quotation" does.
//
// "Duplicate deal" (Joel, 2026-10-19: "some programmes are literally the same, just need to change date, venue,
// trainer"): any deal, any stage, for the same or another client. See duplicateDeal below.

import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { buildQuotationForDeal } from './dealDocs';
import { dealOwnerId, dealStage, dealWonDate, formatDate, todayIso, trainingDateText, trainingDays } from './deals';
import { nextOutlineRef } from './outlineResolve';
import { clientCode } from './docRefs';

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };
type Person = { id: string; name: string };

export const REPEAT_REASON = 'Repeat client, same programme';

const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
// The client's customer code, for the new documents' numbers (blank if none yet: the editor adds it later).
async function codeOfClient(clientId: string): Promise<string> {
  if (!clientId) return '';
  try { const s = await getDoc(doc(db, 'clients', clientId)); return s.exists() ? clientCode(s.data()) : ''; } catch { return ''; }
}
const newest = (list: any[]) => [...list].sort((a, b) => String(b.date || b.id).localeCompare(String(a.date || a.id)))[0];

// The won deal to repeat for a client: the most recently won one.
export function lastWonDeal(deals: any[], clientId: string): any | null {
  const won = deals.filter(p => p.clientId === clientId && dealStage(p) === 'won' && !p.deleted);
  return won.sort((a, b) => String(dealWonDate(b)).localeCompare(String(dealWonDate(a))))[0] || null;
}

// Reps can only own deals they create (database rule); Admin and Management keep the old deal's owner if they're
// still on the team, else it's theirs.
export function repeatOwner(src: any, viewer: Viewer, people: Person[]): Person {
  if (viewer.role === 'rep') return { id: viewer.id, name: viewer.name };
  const old = people.find(p => p.id === dealOwnerId(src));
  return old ? { id: old.id, name: old.name } : { id: viewer.id, name: viewer.name };
}

export async function repeatDeal(src: any, viewer: Viewer, people: Person[], allQuotes: any[]): Promise<{ dealId: string; quoteId: string }> {
  const today = todayIso();
  const owner = repeatOwner(src, viewer, people);
  const id = `pipe_${Date.now()}`;
  const at = new Date().toISOString();
  const by = { byId: viewer.id, byName: viewer.name };
  const deal: any = clean({
    id,
    clientId: src.clientId || '', client: src.client || '',
    contactId: src.contactId || '', contactName: src.contactName || '',
    programmeId: src.programmeId || '', courseName: src.courseName || '', enquiryNote: src.programmeId ? '' : (src.enquiryNote || ''),
    type: src.type || 'Training', fundingType: src.fundingType || '', proposalValue: Number(src.proposalValue) || 0,
    participants: src.participants || '', trainingDays: trainingDays(src),
    requestDate: today, trainingDate: '', followUpDate: 'TBD',
    ownerId: owner.id, ownerName: owner.name, taggedRepIds: [], tagNote: '', notes: '',
    stage: 'agreed', status: 'Pending', agreedDate: today, proposalSentDate: 'not yet',
    proposalSkipped: true, proposalSkipReason: REPEAT_REASON, repeatOfDealId: src.id,
    creatorId: viewer.id, creatorName: viewer.name, completedTags: [], appointmentTicked: false, createdAt: Date.now(),
    history: [
      { at, ...by, action: `Deal created: repeat of the deal won ${formatDate(dealWonDate(src))}`.trim() },
      { at, ...by, action: `No proposal needed: ${REPEAT_REASON}` },
    ],
  });

  const quote = copyQuotation(src, deal, viewer, owner, allQuotes, true, await codeOfClient(deal.clientId));
  await setDoc(doc(db, 'pipelines', id), deal);
  await setDoc(doc(db, 'quotations', quote.id), quote);
  return { dealId: id, quoteId: quote.id };
}

// A draft copy of the old deal's quotation (the sent one, else the newest draft) for the new deal, or a fresh one.
// Lines read the new deal's training date; the venue, trainer, fees and terms stay as they were, to change if needed.
function copyQuotation(src: any, deal: any, viewer: Viewer, owner: Person, allQuotes: any[], sameClient: boolean, code: string): any {
  const oldQuotes = allQuotes.filter(q => q.pipelineId === src.id && !q.dealDeleted);
  const base = newest(oldQuotes.filter(q => q.status === 'sent')) || newest(oldQuotes);
  const fresh: any = buildQuotationForDeal(deal, { id: viewer.id, name: viewer.name }, owner, { code }, allQuotes);
  const quote: any = base
    ? clean({
        ...base,
        id: fresh.id, refNumber: fresh.refNumber, refAuto: true, date: fresh.date,
        status: 'draft', sentAt: '', sentById: '', sentByName: '', sendLog: [],
        preparedBy: viewer.name, creatorId: viewer.id, ownerId: owner.id, ownerName: owner.name,
        pipelineId: deal.id, clientId: deal.clientId,
        sharedWithIds: [], sharedLog: {}, isHidden: false, dealDeleted: false,
        taggedRepId: '', taggedRepName: '', taggedBy: '', tagNote: '',
        // Another client: their own company and attention person, not the ones typed for the old client.
        ...(sameClient ? {} : { attnOverride: '', addressTo: 'company', attn: '', company: '', address: '' }),
        // The new deal's training date is read live; a typed old date is dropped.
        items: (base.items || []).map((it: any) => (it.kind === 'item' ? it : { ...it, date: '', useDealDate: true })),
      })
    : fresh;
  return quote;
}

// "Duplicate deal": a new deal with the same programme, value, funding type, participants, type and training days,
// for the same or another client, with its own training date. It also gets a draft copy of the old deal's course
// outline and, when it starts at Client approved, of its quotation (venue, trainer and fees kept, to change).
// Nothing else is copied: no appointment, follow-ups, checklist, money, files or history.
// Starting at New: the proposal still has to be sent (counts for the Proposal KPI). Starting at Client approved:
// "No proposal needed" (doesn't count), like Repeat this deal.
export type DuplicateStart = 'lead' | 'agreed';
export const DUPLICATE_SKIP_REASON = 'Same programme as an earlier deal';

export async function duplicateDeal(src: any, viewer: Viewer, people: Person[], allQuotes: any[], allOutlines: any[], opt: {
  client: { id: string; companyName: string }; trainingDate: string; trainingDays: number; start: DuplicateStart;
}): Promise<{ dealId: string; quoteId: string; outlineId: string }> {
  const today = todayIso();
  const owner = repeatOwner(src, viewer, people);
  const id = `pipe_${Date.now()}`;
  const at = new Date().toISOString();
  const by = { byId: viewer.id, byName: viewer.name };
  const sameClient = opt.client.id === src.clientId;
  const reason = sameClient ? REPEAT_REASON : DUPLICATE_SKIP_REASON;
  const when = trainingDateText({ trainingDate: opt.trainingDate, trainingDays: opt.trainingDays }, true);
  const deal: any = clean({
    id,
    clientId: opt.client.id, client: opt.client.companyName,
    contactId: sameClient ? src.contactId || '' : '', contactName: sameClient ? src.contactName || '' : '',
    programmeId: src.programmeId || '', courseName: src.courseName || '', enquiryNote: src.programmeId ? '' : (src.enquiryNote || ''),
    type: src.type || 'Training', fundingType: src.fundingType || '', proposalValue: Number(src.proposalValue) || 0,
    participants: src.participants || '', trainingDays: opt.trainingDays,
    requestDate: today, trainingDate: opt.trainingDate || '', followUpDate: 'TBD',
    ownerId: owner.id, ownerName: owner.name, taggedRepIds: [], tagNote: '', notes: '',
    status: 'Pending', proposalSentDate: 'not yet', duplicateOfDealId: src.id,
    ...(opt.start === 'agreed'
      ? { stage: 'agreed', agreedDate: today, proposalSkipped: true, proposalSkipReason: reason }
      : { stage: 'lead' }),
    creatorId: viewer.id, creatorName: viewer.name, completedTags: [], appointmentTicked: false, createdAt: Date.now(),
    history: [
      { at, ...by, action: `Deal created: copy of the deal for ${src.client || 'another client'}${src.courseName ? ` (${src.courseName})` : ''}${when ? `, training ${when}` : ''}` },
      ...(opt.start === 'agreed' ? [{ at, ...by, action: `No proposal needed: ${reason}` }] : []),
    ],
  });

  // Quotations come after the client approves, so only a deal starting at Client approved gets one.
  const code = await codeOfClient(deal.clientId);
  const quote = opt.start === 'agreed' ? copyQuotation(src, deal, viewer, owner, allQuotes, sameClient, code) : null;

  const oldOutlines = allOutlines.filter(o => o.pipelineId === src.id && !o.dealDeleted);
  const baseOutline = newest(oldOutlines.filter(o => o.status === 'sent')) || newest(oldOutlines);
  const outline: any = baseOutline ? clean({
    ...baseOutline,
    id: `outline_${Date.now()}`, refNumber: nextOutlineRef(allOutlines, today, code), refAuto: true, date: today,
    status: 'draft', sentAt: '', sentById: '', sentByName: '', sendLog: [],
    preparedBy: viewer.name, creatorId: viewer.id, ownerId: owner.id, ownerName: owner.name,
    pipelineId: id, clientId: deal.clientId, preparedForCompany: '',
    sharedWithIds: [], sharedLog: {}, isHidden: false, dealDeleted: false,
    taggedRepId: '', taggedRepName: '', taggedBy: '', tagNote: '', isCompleted: false,
  }) : null;

  await setDoc(doc(db, 'pipelines', id), deal);
  if (quote) await setDoc(doc(db, 'quotations', quote.id), quote);
  if (outline) await setDoc(doc(db, 'course_outlines', outline.id), outline);
  return { dealId: id, quoteId: quote?.id || '', outlineId: outline?.id || '' };
}
