// Found by (Joel, 2026-10-24): the rep, Admin or manager who brought the client in. It doesn't lock the client:
// everyone still sees and uses it. Set to whoever adds the client; only Management changes it (e.g. when a rep leaves),
// checked in firestore.rules. Clients added before this show who typed them in.

export const foundById = (c: any): string => c?.foundById || c?.createdBy || '';
export const foundByName = (c: any): string => c?.foundByName || c?.createdByName || '';
export const foundByFields = (p: { id: string; name: string }) => ({ foundById: p.id, foundByName: p.name });
