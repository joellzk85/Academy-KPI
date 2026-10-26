// Clean slate until old records are linked (Joel, 2026-10-17).
// Deals, quotations and course outlines from the previous system still carry old person IDs.
// Until Joel links them to Team members (Management → Data tools → Link old records), they are
// hidden everywhere in the CRM, so totals, KPIs and lists show only work done in the new CRM.
// Nothing is deleted: Data tools and the backup still read everything.
// A record counts as linked when its owner (or, for older records, its creator) is on the Team
// list. Removed people stay on the list (switched off), so their records stay visible.

let teamIds: Set<string> | null = null;

// Called by the app once the Team list is loaded.
export function setLinkedTeam(ids: string[]) {
  teamIds = ids.length ? new Set(ids) : null;
}

export function recordOwnerId(r: any): string {
  return r?.ownerId || r?.creatorId || '';
}

// Deleted deals are kept but hidden everywhere (Joel, 2026-10-18), together with the draft quotations and
// course outlines that were on them (marked dealDeleted). Management sees them in Management → Lost and deleted.
export function isDeletedRecord(r: any): boolean {
  return r?.deleted === true || r?.dealDeleted === true;
}

export function ownedByTeam(r: any, ids: Set<string>): boolean {
  if (isDeletedRecord(r)) return false;
  const owner = recordOwnerId(r);
  return !!owner && ids.has(owner);
}

// A course outline or teambuilding proposal an outside trainer started in the portal (2026-10-26) has no owner yet;
// it shows until someone picks it up.
const trainerWritten = (r: any) => !recordOwnerId(r) && !!(r?.writerTrainerId || r?.writerTrainerName);

export function isLinked(r: any): boolean {
  if (isDeletedRecord(r)) return false;
  return !teamIds || ownedByTeam(r, teamIds) || trainerWritten(r);
}

export function linkedOnly<T>(list: T[]): T[] {
  return list.filter(isLinked);
}

// Money records and HRDC queries on a deal Management deleted (2026-10-20) are marked dealDeleted and hidden
// with the deal; Restore brings them back. Lists of them filter with this.
export function withoutDeleted<T>(list: T[]): T[] {
  return list.filter(r => !isDeletedRecord(r));
}

// Linked records including deleted ones (only for Management → Lost and deleted).
export function linkedWithDeleted<T>(list: T[]): T[] {
  return list.filter((r: any) => !teamIds || (!!recordOwnerId(r) && teamIds.has(recordOwnerId(r))) || trainerWritten(r));
}
