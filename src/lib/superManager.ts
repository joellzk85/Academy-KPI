// Owner override (2026-10-22). A Management login with a record in owner_access/{memberId} (made only in the Firebase
// console) can approve their own requests, bypass checks and delete forever. Only that person can read their own
// record, and nothing on screen tells anyone else it exists. The screens ask a second time, naming the risk
// (superConfirm). No names or IDs here: App.tsx reads the logged-in person's own record (setSuperManager).

let superId = '';

/** Called by the app with the logged-in person's id when their owner_access record exists ('' when it doesn't). */
export function setSuperManager(id: string) {
  superId = id;
}

/** Does this person have the owner override? */
export const isSuperManager = (viewer?: { id?: string } | null) => !!viewer?.id && !!superId && viewer.id === superId;

/** The second confirmation, naming the risk. True = go ahead. */
export function superConfirm(action: string, risk: string): boolean {
  return window.confirm(`Please confirm: ${action}\n\nRisk: ${risk}\n\nGo ahead anyway?`);
}
