// One training, several employers claiming (Joel, 2026-10-27: "1 program, but claim many companies. but costing is
// 1 costing. is considered 1 deal."). E.g. Padini's training claimed by Padini Dot Com, Seed Corporation, Vincci...
// each with its own HRD Corp Employer code, Approval code and approved amount, and its own HRDC claim.
//
// - The employers are listed on the deal's Grant approved step (grant task `employers`). Each is a client from the
//   client list (Joel's choice): its name and Employer code live on the client and are reused on its next deals.
//   The Approval code and approved amount are this training's.
// - No list = one employer, as before (the deal's client, the step's approvalCode).
// - Each HRDC claim (money_in) names its employer (employerClientId). Every employer needs its claim before the
//   invoice step is done; shortfalls are per claim, so per employer.
// - Still one deal: one costing, one P&L, one Closing RM. The deal value is never changed from here; when the
//   approved amounts add up to something else, a reminder points to "Change value / pax" (Joel's choice).

import type { ChecklistTask } from './checklist';

export interface GrantEmployer {
  id: string;
  clientId: string;
  approvalCode?: string;
  approvedAmount?: number;
}

const grantOf = (tasks: ChecklistTask[] | undefined) => (tasks || []).find(t => t.kind === 'grant');

/** The employers claiming for this training ([] = the single-employer deal, as before). */
export function grantEmployers(tasks: ChecklistTask[] | undefined): GrantEmployer[] {
  const list = grantOf(tasks)?.employers;
  return Array.isArray(list) ? list.filter(e => e && e.clientId) : [];
}
export const isGroupClaim = (tasks: ChecklistTask[] | undefined) => grantEmployers(tasks).length > 0;

/** The name HRDC knows the employer by: the client's employer name, else its company name. */
export const employerLabel = (client: any) => String(client?.employerName || '').trim() || String(client?.companyName || '').trim() || 'Employer';

/** Total of the approved amounts typed so far. */
export const approvedTotal = (list: GrantEmployer[]) =>
  Math.round(list.reduce((t, e) => t + (Number(e.approvedAmount) || 0), 0) * 100) / 100;

/** What each line still needs before Grant approved can be ticked ('' = nothing). */
export function lineMissing(e: GrantEmployer, client: any): string {
  return [!String(client?.employerCode || '').trim() && 'Employer code', !String(e.approvalCode || '').trim() && 'Approval code',
    !(Number(e.approvedAmount) > 0) && 'approved amount'].filter(Boolean).join(', ');
}

/** Why Grant approved can't be ticked on a group claim ('' = it can). */
export function groupGrantBlock(list: GrantEmployer[], clientsById: Record<string, any>): string {
  const gaps = list.map(e => ({ name: employerLabel(clientsById[e.clientId]), miss: lineMissing(e, clientsById[e.clientId]) })).filter(x => x.miss);
  if (!gaps.length) return '';
  return `Fill in for each employer first: ${gaps.map(x => `${x.name} (${x.miss})`).join('; ')}.`;
}

/** The employers with no HRDC claim recorded yet. */
export function employersWithoutClaim(tasks: ChecklistTask[] | undefined, ins: { source: string; employerClientId?: string }[]): GrantEmployer[] {
  return grantEmployers(tasks).filter(e => !ins.some(m => m.source === 'hrdc' && m.employerClientId === e.clientId));
}

/** The approved amounts add up to something other than the deal value (RM 1 or more apart, every amount typed). */
export function valueGap(list: GrantEmployer[], dealValue: number): number {
  if (!list.length || list.some(e => !(Number(e.approvedAmount) > 0)) || !(dealValue > 0)) return 0;
  const gap = Math.round((approvedTotal(list) - dealValue) * 100) / 100;
  return Math.abs(gap) >= 1 ? gap : 0;
}
