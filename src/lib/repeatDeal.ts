// "Repeat this deal" (Joel, 2026-10-19): repeat clients with a repeated programme. A won deal (from the deal panel or
// the client page) becomes a new deal with the same client, attention person, programme, funding type, value and type,
// straight at "Client approved" with "No proposal needed: Repeat client, same programme" (so the Proposal KPI doesn't
// count it). The quotation is a copy of the won deal's quotation (the sent one, else the newest draft) with today's date,
// a new reference and no training date (the new deal's date is read live), so only what changed needs typing.
// No quotation on the old deal: a fresh one is built from the new deal, as "Create quotation" does.

import { doc, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { buildQuotationForDeal } from './dealDocs';
import { dealOwnerId, dealStage, dealWonDate, formatDate, todayIso } from './deals';

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };
type Person = { id: string; name: string };

export const REPEAT_REASON = 'Repeat client, same programme';

const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const newest = (list: any[]) => [...list].sort((a, b) => String(b.date || b.id).localeCompare(String(a.date || a.id)))[0];

// The won deal to repeat for a client: the most recently won one.
export function lastWonDeal(deals: any[], clientId: string): any | null {
  const won = deals.filter(p => p.clientId === clientId && dealStage(p) === 'won' && !p.deleted);
  return won.sort((a, b) => String(dealWonDate(b)).localeCompare(String(dealWonDate(a))))[0] || null;
}

// The next free quotation reference for today (same numbering as "New quotation" and "Create quotation").
function nextQuoteRef(base: string, quotes: any[]): string {
  const prefix = base.slice(0, base.lastIndexOf('/') + 1);
  const used = quotes.map(q => String(q.refNumber || '')).filter(r => r.startsWith(prefix)).map(r => parseInt(r.slice(prefix.length), 10) || 0);
  return `${prefix}${String((used.length ? Math.max(...used) : 0) + 1).padStart(2, '0')}`;
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
    participants: src.participants || '',
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

  const oldQuotes = allQuotes.filter(q => q.pipelineId === src.id);
  const base = newest(oldQuotes.filter(q => q.status === 'sent')) || newest(oldQuotes);
  const fresh: any = buildQuotationForDeal(deal, { id: viewer.id, name: viewer.name }, owner, null, 0);
  const quote: any = base
    ? clean({
        ...base,
        id: fresh.id, refNumber: fresh.refNumber, date: fresh.date,
        status: 'draft', sentAt: '', sentById: '', sentByName: '', sendLog: [],
        preparedBy: viewer.name, creatorId: viewer.id, ownerId: owner.id, ownerName: owner.name,
        pipelineId: id, clientId: deal.clientId,
        sharedWithIds: [], sharedLog: {}, isHidden: false, dealDeleted: false,
        taggedRepId: '', taggedRepName: '', taggedBy: '', tagNote: '',
        // The new deal's training date is read live; a typed old date is dropped.
        items: (base.items || []).map((it: any) => (it.kind === 'item' ? it : { ...it, date: '', useDealDate: true })),
      })
    : fresh;
  quote.refNumber = nextQuoteRef(fresh.refNumber, allQuotes);

  await setDoc(doc(db, 'pipelines', id), deal);
  await setDoc(doc(db, 'quotations', quote.id), quote);
  return { dealId: id, quoteId: quote.id };
}
