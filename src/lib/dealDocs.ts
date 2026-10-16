// Documents created from a deal, so nothing is retyped.
import { DEFAULT_TERMS } from './quoteResolve';

type Person = { id: string; name: string };

// A draft quotation linked to the deal. Nothing is copied: the client's details, the programme,
// the training date and the owner are read live from the deal and the lists (see lib/quoteResolve.ts).
// "preparedBy" is whoever made it; "owner" is the person whose quotation library it belongs to.
export function buildQuotationForDeal(p: any, preparedBy: Person, owner: Person, _client: any, existingCount: number) {
  const now = new Date();
  const stamp = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}`;
  return {
    id: `q_${Date.now()}`,
    refNumber: `1G/NA/${stamp}/${(existingCount + 1).toString().padStart(2, '0')}`,
    date: now.toISOString().substring(0, 10),
    attn: '', company: '', address: '', venue: '', time: '', participants: '',
    trainingProvider: 'NEXT Academy',
    items: [{
      id: `item_${Date.now()}`, no: 1, program: '', code: '', date: '', trainer: '',
      programmeId: p.programmeId || '', useDealDate: true,
      feePerDay: Number(p.proposalValue) || 0, days: 1, totalFee: Number(p.proposalValue) || 0,
    }],
    remarks: [],
    terms: DEFAULT_TERMS,
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
