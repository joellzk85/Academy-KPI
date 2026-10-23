// Super Manager (Joel, 2026-10-22: "Joel is Super Manager and can do any changes, no need anyone to approve; can
// bypass, approve anything, delete anything forever. Nobody supersedes. Only the system double confirms the decision
// and mentions the potential risk.")
// - One person, marked superManager on their Team record (set only by the CRM server: Team → Super Manager).
// - The database rules let them do anything (firestore.rules isSuper); the screens show the extra buttons and ask a
//   second time, naming the risk (superConfirm). What they do is still written in the deal's History.
// No names or IDs here: who it is comes from the Team list (App.tsx calls setSuperManager).

let superId = '';

/** Called by the app once the Team list is loaded. */
export function setSuperManager(members: { id: string; superManager?: boolean; active?: boolean }[]) {
  superId = members.find(m => m.superManager === true && m.active !== false)?.id || '';
}

/** Is this person the Super Manager? */
export const isSuperManager = (viewer?: { id?: string } | null) => !!viewer?.id && !!superId && viewer.id === superId;

/** The second confirmation, naming the risk. True = go ahead. */
export function superConfirm(action: string, risk: string): boolean {
  return window.confirm(`Super Manager: ${action}\n\nRisk: ${risk}\n\nGo ahead anyway?`);
}
