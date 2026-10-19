// Documents created from a deal, so nothing is retyped.
import { DEFAULT_TERMS } from './quoteResolve';
import { todayIso, trainingDays } from './deals';
import { clientCode, nextDocRef } from './docRefs';

type Person = { id: string; name: string };

// A draft quotation linked to the deal. Nothing is copied: the client's details, the programme,
// the training date and the owner are read live from the deal and the lists (see lib/quoteResolve.ts).
// "preparedBy" is whoever made it; "owner" is the person whose quotation library it belongs to.
// A training of several days starts with that many days and the deal value spread over them, so the total stays the deal value.
// extra (2026-10-19): another quotation on the same deal (bus, T-shirts...): one blank "other item" line and
// no training terms (the standard terms are one click away in the editor).
// The reference is the next number for today across all quotations, starting with the client's code (lib/docRefs.ts).
export function buildQuotationForDeal(p: any, preparedBy: Person, owner: Person, client: any, allQuotes: { refNumber?: string }[], extra = false) {
  const date = todayIso();
  const days = trainingDays(p);
  const value = Number(p.proposalValue) || 0;
  return {
    id: `q_${Date.now()}`,
    refNumber: nextDocRef('quotation', allQuotes, date, clientCode(client)),
    refAuto: true,
    date,
    attn: '', company: '', address: '', venue: '', time: '', participants: '',
    trainingProvider: 'NEXT Academy',
    items: extra
      ? [{ id: `item_${Date.now()}`, no: 1, kind: 'item' as const, program: '', code: '', date: '', trainer: '', programmeId: '', useDealDate: false, feePerDay: 0, days: 1, totalFee: 0 }]
      : [{
        id: `item_${Date.now()}`, no: 1, program: '', code: '', date: '', trainer: '',
        programmeId: p.programmeId || '', useDealDate: true,
        feePerDay: Math.round((value / days) * 100) / 100, days, totalFee: value,
      }],
    remarks: [],
    terms: extra ? [] : DEFAULT_TERMS,
    status: 'draft' as const,
    preparedBy: preparedBy.name,
    creatorId: preparedBy.id,
    ownerId: owner.id,
    ownerName: owner.name,
    clientId: p.clientId || '',
    pipelineId: p.id,
    sharedWithIds: [] as string[],
  };
}
