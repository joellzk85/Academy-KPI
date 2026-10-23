// Money actions that leave a trail (process audit, 2026-10-22), shared by the deal's money screens, the checklist cost
// lines and reimbursement invoices:
// - every change is saved together with a line in the deal's History (older lines are never removed: firestore.rules);
// - nothing that counts is erased: invoices, HRDC claims, reimbursement invoices and approved or paid payment requests
//   are marked deleted with a reason, and Management restores them in Management → Lost and deleted;
// - only Management undoes a payment, stamped with who, when and what it was (lastUndo).

import { doc, getDoc, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import { formatDate, formatRM } from './deals';
import { deletedStamp, undoStamp } from './money';
import { isSuperManager, superConfirm } from './superManager';

type Viewer = { id: string; name: string; role?: string };
export type MoneyColl = 'money_in' | 'money_out' | 'claim_backs';

/** Save a change together with a line in its deal's History. */
export async function withDealHistory(dealId: string, viewer: Viewer, action: string, change: (batch: ReturnType<typeof writeBatch>) => void) {
  const batch = writeBatch(db);
  change(batch);
  if (dealId) {
    const d = await getDoc(doc(db, 'pipelines', dealId));
    if (d.exists()) {
      const entry = { at: new Date().toISOString(), byId: viewer.id, byName: viewer.name, action };
      batch.update(d.ref, { history: [...((d.data() as any).history || []), entry] });
    }
  }
  await batch.commit();
}

/** Ask why (at least 3 characters); null when cancelled. */
export function askReason(question: string): string | null {
  const r = window.prompt(question, '');
  if (r === null) return null;
  if (r.trim().length < 3) { window.alert('Please give a short reason (at least 3 characters).'); return null; }
  return r.trim();
}

/** Delete a money record with a History line: a payment request still waiting for approval (or rejected) is removed;
 *  anything else is marked deleted with the reason. */
export async function deleteMoney(coll: MoneyColl, rec: { id: string; dealId?: string; status?: string }, viewer: Viewer, what: string, reason: string) {
  // Owner override (lib/superManager.ts): may delete forever instead, after two confirmations naming the risk.
  const forever = isSuperManager(viewer) && !(coll === 'money_out' && (rec.status === 'pending' || rec.status === 'rejected'))
    && window.confirm('Delete it forever instead of keeping it as deleted (restorable)?\n\nOK = delete forever. Cancel = keep it restorable.')
    && superConfirm(`delete ${what} forever.`, 'it cannot be restored, and the deal\'s P&L and money history lose it for good.');
  const erase = forever || (coll === 'money_out' && (rec.status === 'pending' || rec.status === 'rejected'));
  await withDealHistory(rec.dealId || '', viewer, `Deleted ${forever ? 'forever ' : ''}${what}${reason ? `: ${reason}` : ''}`, batch => {
    if (erase) batch.delete(doc(db, coll, rec.id));
    else batch.update(doc(db, coll, rec.id), deletedStamp(viewer, reason));
  });
}

/** Management undoes a payment, stamped, with a History line. */
export async function undoPayment(coll: MoneyColl, rec: any, viewer: Viewer, what: string) {
  const amount = coll === 'money_out' ? Number(rec.amount) || 0 : Number(rec.paidAmount) || 0;
  const lastUndo = undoStamp(viewer, rec.paidDate, amount, rec.paidRef || '');
  const patch = coll === 'money_out'
    ? { status: 'approved', paidDate: '', paidAt: '', paidRef: '', paidById: '', paidByName: '', lastUndo }
    : { paidDate: '', paidAmount: 0, paidAt: '', paidById: '', paidByName: '', updatedAt: Date.now(), lastUndo };
  await withDealHistory(rec.dealId || '', viewer, `Undid payment: ${what} (was paid ${formatDate(rec.paidDate || '')}, ${formatRM(amount)})`,
    batch => batch.update(doc(db, coll, rec.id), patch));
}
