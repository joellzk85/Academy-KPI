// Deleting course outlines and teambuilding proposals (Joel, 2026-10-27). Nothing is erased: a rep or Admin asks
// (Delete → "Ask to delete", with a reason), Management approves or rejects it (never their own request), and an
// approved one is marked deleted (deleted: true), hidden everywhere (lib/linked.ts) and kept. Management deletes
// straight away (also kept). Management → Lost and deleted lists the requests and the deleted ones, with Restore.
// Only the owner override deletes one forever. firestore.rules: docDeleteOk.
import { deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { db } from './firebase';
import { isSuperManager, superConfirm } from './superManager';

export type DeletableColl = 'course_outlines' | 'teambuilding_proposals';
export const DELETE_NOUN: Record<DeletableColl, string> = { course_outlines: 'course outline', teambuilding_proposals: 'teambuilding proposal' };

type Viewer = { id: string; name: string; role?: string };

export interface DeleteRequest {
  status: 'pending' | 'approved' | 'rejected';
  byId: string; byName: string; at: string; reason: string;
  decidedById?: string; decidedByName?: string; decidedAt?: string;
}

export const pendingDelete = (r: any): DeleteRequest | null => (r?.deleteRequest?.status === 'pending' ? r.deleteRequest : null);

/** Management decides a request, never their own (the owner override may). */
export const canDecideDelete = (r: any, viewer: Viewer) => {
  const q = pendingDelete(r);
  return !!q && viewer.role === 'management' && (q.byId !== viewer.id || isSuperManager(viewer));
};

const now = () => new Date().toISOString();
const ref = (coll: DeletableColl, id: string) => doc(db, coll, id);
const nameOf = (coll: DeletableColl, r: any) => `${DELETE_NOUN[coll]} ${r?.refNumber || ''}`.trim();

function askReason(text: string): string | null {
  const v = window.prompt(text);
  if (v === null) return null;
  if (v.trim().length < 3) { window.alert('Please type a short reason (at least 3 letters).'); return null; }
  return v.trim().slice(0, 300);
}

/** Rep or Admin: ask Management to delete it. It stays in the lists, marked "Delete asked", until decided. */
export async function askToDelete(coll: DeletableColl, r: any, viewer: Viewer) {
  const reason = askReason(`Ask Management to delete ${nameOf(coll, r)}?\n\nWhy should it be deleted?`);
  if (reason === null) return;
  const q: DeleteRequest = { status: 'pending', byId: viewer.id, byName: viewer.name, at: now(), reason };
  await updateDoc(ref(coll, r.id), { deleteRequest: q });
}

export async function cancelDeleteRequest(coll: DeletableColl, r: any) {
  if (!window.confirm(`Cancel the request to delete ${nameOf(coll, r)}?`)) return;
  await updateDoc(ref(coll, r.id), { deleteRequest: null });
}

/** Management: delete straight away (kept, restorable in Management → Lost and deleted). */
export async function deleteNow(coll: DeletableColl, r: any, viewer: Viewer) {
  const reason = askReason(`Delete ${nameOf(coll, r)}? It is kept and can be restored in Management → Lost and deleted.\n\nReason:`);
  if (reason === null) return;
  await updateDoc(ref(coll, r.id), {
    deleted: true, deletedById: viewer.id, deletedByName: viewer.name, deletedAt: now(), deletedReason: reason, deleteRequest: null,
  });
}

export async function approveDelete(coll: DeletableColl, r: any, viewer: Viewer) {
  const q = pendingDelete(r);
  if (!q || !window.confirm(`Delete ${nameOf(coll, r)}, as ${q.byName} asked?\n\nReason: ${q.reason}\n\nIt is kept and can be restored.`)) return;
  const at = now();
  await updateDoc(ref(coll, r.id), {
    deleted: true, deletedById: viewer.id, deletedByName: viewer.name, deletedAt: at, deletedReason: q.reason,
    deleteRequest: { ...q, status: 'approved', decidedById: viewer.id, decidedByName: viewer.name, decidedAt: at },
  });
}

export async function rejectDelete(coll: DeletableColl, r: any, viewer: Viewer) {
  const q = pendingDelete(r);
  if (!q || !window.confirm(`Keep ${nameOf(coll, r)}? ${q.byName}'s request to delete it is turned down.`)) return;
  await updateDoc(ref(coll, r.id), { deleteRequest: { ...q, status: 'rejected', decidedById: viewer.id, decidedByName: viewer.name, decidedAt: now() } });
}

export async function restoreDeleted(coll: DeletableColl, r: any, viewer: Viewer) {
  if (!window.confirm(`Restore ${nameOf(coll, r)}? It comes back in the lists${r.pipelineId ? ' and on its deal' : ''}.`)) return;
  await updateDoc(ref(coll, r.id), { deleted: false, restoredById: viewer.id, restoredByName: viewer.name, restoredAt: now() });
}

/** Owner override only: erase it for good. */
export async function eraseForever(coll: DeletableColl, r: any) {
  if (!window.confirm(`Delete ${nameOf(coll, r)} forever?`)) return;
  if (!superConfirm(`delete ${nameOf(coll, r)} forever.`, 'it cannot be restored from the CRM, and its client links stop working.')) return;
  await deleteDoc(ref(coll, r.id));
}

export type DeleteAction = { key: string; label: string; danger?: boolean; run: () => Promise<void> };

/** The Delete entries for a row's ⋯ menu. `mayEdit`: the person may change this record (own, or Admin / Management). */
export function deleteActions(coll: DeletableColl, r: any, viewer: Viewer, mayEdit: boolean): DeleteAction[] {
  const q = pendingDelete(r);
  const out: DeleteAction[] = [];
  if (canDecideDelete(r, viewer)) {
    out.push({ key: 'approve', label: 'Approve delete', danger: true, run: () => approveDelete(coll, r, viewer) });
    out.push({ key: 'reject', label: 'Keep it (reject delete)', run: () => rejectDelete(coll, r, viewer) });
    return out;
  }
  if (q) {
    if (q.byId === viewer.id || viewer.role === 'management') out.push({ key: 'cancel', label: 'Cancel delete request', run: () => cancelDeleteRequest(coll, r) });
    return out;
  }
  if (viewer.role === 'management') out.push({ key: 'delete', label: 'Delete', danger: true, run: () => deleteNow(coll, r, viewer) });
  else if (mayEdit) out.push({ key: 'ask', label: 'Ask to delete', danger: true, run: () => askToDelete(coll, r, viewer) });
  return out;
}
