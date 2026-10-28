import { useEffect, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import { deleteObject, ref, uploadBytesResumable } from 'firebase/storage';
import { db, storage } from './firebase';
import { checklistFileProblem, checklistFileType, safeFileName } from './checklistFiles';
import { Claim, ClaimFile, ClaimSettings, claimPayment, claimPaymentId, readClaimSettings } from './claims';

// Reading and saving staff claims (lib/claims.ts). The database rules check the same things (firestore.rules claims).

type Viewer = { id: string; name: string };

export function useClaimSettings(): { settings: ClaimSettings; loaded: boolean } {
  const [state, setState] = useState<{ settings: ClaimSettings; loaded: boolean }>({ settings: readClaimSettings(null), loaded: false });
  useEffect(() => onSnapshot(doc(db, 'config', 'claim_settings'),
    s => setState({ settings: readClaimSettings(s.data()), loaded: true }),
    () => setState({ settings: readClaimSettings(null), loaded: true })), []);
  return state;
}

export const saveClaimSettings = (s: ClaimSettings, viewer: Viewer) =>
  setDoc(doc(db, 'config', 'claim_settings'), { ...s, updatedAt: new Date().toISOString(), updatedById: viewer.id, updatedByName: viewer.name });

/** Claims, live. memberId: only that person's (their own My claims); '' = everyone's (Management, or someone allowed to
 *  raise for others). Null while loading. */
export function useClaims(enabled: boolean, memberId: string): Claim[] | null {
  const [list, setList] = useState<Claim[] | null>(null);
  useEffect(() => {
    if (!enabled) { setList([]); return; }
    setList(null);
    const q = memberId ? query(collection(db, 'claims'), where('memberId', '==', memberId)) : query(collection(db, 'claims'));
    return onSnapshot(q, s => setList(s.docs.map(d => ({ ...(d.data() as Claim), id: d.id }))), () => setList([]));
  }, [enabled, memberId]);
  return list;
}

/** Claims this person raised for someone else (they can always read those). */
export function useClaimsRaisedBy(enabled: boolean, viewerId: string): Claim[] {
  const [list, setList] = useState<Claim[]>([]);
  useEffect(() => {
    if (!enabled || !viewerId) { setList([]); return; }
    return onSnapshot(query(collection(db, 'claims'), where('raisedById', '==', viewerId)), s => setList(s.docs.map(d => ({ ...(d.data() as Claim), id: d.id }))), () => setList([]));
  }, [enabled, viewerId]);
  return list;
}

/** Paid or not, for the person's own approved claims: they may read the payment made from their claim. */
export function useClaimPaid(claims: Claim[]): Record<string, string> {
  const ids = claims.filter(c => c.status === 'approved').map(c => c.id).sort().join(',');
  const [paid, setPaid] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!ids) { setPaid({}); return; }
    const offs = ids.split(',').map(id => onSnapshot(doc(db, 'money_out', claimPaymentId(id)),
      s => { const o: any = s.data(); setPaid(p => ({ ...p, [id]: o?.status === 'paid' ? String(o.paidDate || o.paidAt || 'paid').slice(0, 10) : '' })); },
      () => { /* not readable: shows "Approved" */ }));
    return () => offs.forEach(f => f());
  }, [ids]);
  return paid;
}

/** Uploads the files of one claim, one after another; if one fails, the ones already up are removed. */
export async function uploadClaimFiles(files: File[], memberId: string, claimId: string, viewer: Viewer, onProgress?: (text: string) => void): Promise<ClaimFile[]> {
  const done: ClaimFile[] = [];
  try {
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const problem = checklistFileProblem(f.name, f.size);
      if (problem) throw new Error(problem);
      const name = safeFileName(f.name);
      const path = `claims/${memberId}/${claimId}_${Date.now().toString(36)}${i}_${name}`;
      const type = checklistFileType(name);
      const up = uploadBytesResumable(ref(storage, path), f, { contentType: type, customMetadata: { uploadedBy: viewer.id, claimId } });
      await new Promise<void>((resolve, reject) => {
        up.on('state_changed', s => {
          const pct = s.totalBytes ? Math.round((s.bytesTransferred / s.totalBytes) * 100) : 0;
          onProgress?.(files.length > 1 ? `${i + 1} of ${files.length}, ${pct}%` : `${pct}%`);
        }, reject, () => resolve());
      });
      done.push({ name, size: f.size, type, path, at: new Date().toISOString() });
    }
  } catch (e) {
    await removeClaimFiles(done);
    throw e;
  }
  return done;
}

export const removeClaimFiles = (files: ClaimFile[]) =>
  Promise.all(files.map(f => deleteObject(ref(storage, f.path)).catch(() => { /* already gone, or not ours */ })));

/** A new claim, or a pending / rejected one fixed and sent (again). */
export async function sendClaim(c: Claim, isNew: boolean) {
  const now = new Date().toISOString();
  if (isNew) {
    await setDoc(doc(db, 'claims', c.id), { ...c, status: 'pending', submittedAt: now, decidedById: '', decidedByName: '', decidedAt: '', rejectReason: '' });
  } else {
    const { id, memberId, memberName, raisedById, raisedByName, submittedAt, moneyOutId, decidedTs, ...rest } = c;
    await updateDoc(doc(db, 'claims', id), { ...rest, status: 'pending', resubmittedAt: now, decidedById: '', decidedByName: '', decidedAt: '', decidedTs: null, rejectReason: '' });
  }
}

/** Approve: the claim, its company payment (approved, ready for accounts) and its files on that payment, in one save. */
export async function approveClaim(c: Claim, viewer: Viewer) {
  const at = new Date().toISOString();
  const outId = claimPaymentId(c.id);
  const batch = writeBatch(db);
  batch.update(doc(db, 'claims', c.id), { status: 'approved', decidedById: viewer.id, decidedByName: viewer.name, decidedAt: at, decidedTs: serverTimestamp(), rejectReason: '', moneyOutId: outId });
  batch.set(doc(db, 'money_out', outId), { ...claimPayment(c, viewer, at), decidedTs: serverTimestamp() });
  (c.files || []).forEach((f, i) => {
    const id = `rc_${outId}_${i}`;
    batch.set(doc(db, 'payment_receipts', id), {
      id, dealId: '', moneyInId: '', recordId: '', moneyOutId: outId, kind: 'support',
      name: f.name, size: f.size, type: f.type, path: f.path, at, byId: viewer.id, byName: viewer.name, claimId: c.id,
    });
  });
  await batch.commit();
}

export const rejectClaim = (c: Claim, viewer: Viewer, reason: string) =>
  updateDoc(doc(db, 'claims', c.id), { status: 'rejected', decidedById: viewer.id, decidedByName: viewer.name, decidedAt: new Date().toISOString(), decidedTs: serverTimestamp(), rejectReason: reason.trim() });

/** Withdraw a claim still waiting (or rejected): the record and its files go. */
export async function withdrawClaim(c: Claim) {
  await deleteDoc(doc(db, 'claims', c.id));
  await removeClaimFiles(c.files || []);
}
