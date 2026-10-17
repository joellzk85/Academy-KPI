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

export function ownedByTeam(r: any, ids: Set<string>): boolean {
  const owner = recordOwnerId(r);
  return !!owner && ids.has(owner);
}

export function isLinked(r: any): boolean {
  return !teamIds || ownedByTeam(r, teamIds);
}

export function linkedOnly<T>(list: T[]): T[] {
  return list.filter(isLinked);
}
