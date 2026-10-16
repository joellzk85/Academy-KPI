// Documents created from a deal, so nothing is retyped.

// Formats a YYYY-MM-DD training date as e.g. "20 Apr 2026". Returns '' if empty.
// Falls back to the raw text if it isn't a clean ISO date, so older records never break.
function formatTrainingDate(dateStr?: string): string {
  if (!dateStr) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  return dateStr;
}

type Person = { id: string; name: string };

// A draft quotation linked to the deal. "preparedBy" is whoever made it;
// "owner" is the person whose quotation library it belongs to.
export function buildQuotationForDeal(p: any, preparedBy: Person, owner: Person, client: any, existingCount: number) {
  const now = new Date();
  const newId = `q_${Date.now()}`;
  return {
    id: newId,
    refNumber: `1G/NA/${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}/${(existingCount + 1).toString().padStart(2, '0')}`,
    date: now.toISOString().substring(0, 10),
    attn: client?.contactName && client.contactName !== 'N/A' ? client.contactName : '',
    company: p.client || '',
    address: client?.address || '',
    venue: '',
    time: '',
    participants: '',
    trainingProvider: '',
    items: p.courseName ? [{
      id: `item_${Date.now()}`,
      no: 1,
      program: p.courseName,
      code: '',
      date: formatTrainingDate(p.trainingDate || p.potentialDate),
      trainer: '',
      feePerDay: p.proposalValue || 0,
      days: 1,
      totalFee: p.proposalValue || 0,
    }] : [],
    remarks: [],
    terms: [],
    preparedBy: preparedBy.name,
    creatorId: preparedBy.id,
    ownerId: owner.id,
    ownerName: owner.name,
    clientId: p.clientId || '',
    pipelineId: p.id,
  };
}
