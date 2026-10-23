import React, { useEffect, useState } from 'react';
import { collection, deleteField, doc, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import { AlertTriangle, Check, CheckCircle2, Circle, Loader2, X } from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import { formatDate, formatRM } from '../lib/deals';
import { MoneyOut } from '../lib/money';
import { FeeCheck, FeeCheckKey, allChecked, feeChecks } from '../lib/feeChecks';
import { TrainerJob, jobId } from '../lib/trainerPortal';

// Trainer fee checks (lib/feeChecks.ts, Joel 2026-10-21): the box on the deal's Trainer step where the CRM ticks
// T3, training photos and training report by itself and Admin can tick "Checked by me", and the "Are you sure?"
// window Management sees when approving a trainer fee (Approve only once every check is ticked).

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };
const isStaff = (v: Viewer) => v.role === 'admin' || v.role === 'management';

const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';
const isoDay = (s?: string) => (s ? formatDate(s.slice(0, 10)) : '');

/** Everything the checks read for one trainer fee: the deal, its checklist (the Trainer step gives the trainer), the
 *  trainer's job (fee request, Admin's ticks) and the training report. */
export function useFeeChecks(dealId: string, taskId: string) {
  const [deal, setDeal] = useState<any>(null);
  const [tasks, setTasks] = useState<any[] | null>(null);
  const [jobs, setJobs] = useState<TrainerJob[]>([]);
  const [report, setReport] = useState<any>(null);
  useEffect(() => {
    if (!dealId) return;
    const subs = [
      onSnapshot(doc(db, 'pipelines', dealId), s => setDeal(s.exists() ? { ...s.data(), id: s.id } : null), () => setDeal(null)),
      onSnapshot(doc(db, 'deal_checklists', dealId), s => setTasks(((s.data() as any)?.tasks) || []), () => setTasks([])),
      onSnapshot(query(collection(db, 'trainer_jobs'), where('dealId', '==', dealId)), s => setJobs(s.docs.map(d => ({ ...(d.data() as TrainerJob), id: d.id }))), () => setJobs([])),
      onSnapshot(doc(db, 'training_reports', dealId), s => setReport(s.exists() ? s.data() : null), () => setReport(null)),
    ];
    return () => subs.forEach(u => u());
  }, [dealId]);
  const trainerId = (tasks || []).find(t => t.id === taskId)?.trainerId || '';
  const job = jobs.find(j => j.trainerId === trainerId) || null;
  return { loading: tasks === null, trainerId, checks: feeChecks(deal, job, report, tasks) };
}

function CheckRow({ c, onMark, onUnmark, busy }: { c: FeeCheck; onMark?: () => void; onUnmark?: () => void; busy?: boolean; key?: string }) {
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px]">
      {c.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 text-accent" /> : <Circle className="h-4 w-4 shrink-0 text-danger" />}
      <span className="font-semibold">{c.label}</span>
      <span className={`text-sm ${c.ok ? 'text-ink-soft' : 'text-danger'}`}>
        {c.auto ? `CRM: ${c.auto}` : c.manual ? `checked by ${c.manual.byName} on ${isoDay(c.manual.at)}` : c.waiting || 'not found in the CRM'}
      </span>
      {!c.auto && !c.manual && onMark && <button type="button" disabled={busy} className={`${btnSecondary} px-2.5 py-1`} onClick={onMark}><Check className="h-3.5 w-3.5" /> Checked by me</button>}
      {!c.auto && c.manual && onUnmark && <button type="button" disabled={busy} className="text-sm font-semibold text-ink-soft hover:text-danger hover:underline" onClick={onUnmark}>Untick</button>}
    </li>
  );
}

/** On the deal's Trainer step: the checks for the trainer fee. Admin or Management tick what the CRM can't see. */
export function FeeChecksBox({ dealId, taskId, viewer }: { dealId: string; taskId: string; viewer: Viewer }) {
  const { trainerId, checks } = useFeeChecks(dealId, taskId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const staff = isStaff(viewer);
  const save = (key: FeeCheckKey, value: any) => async () => {
    setBusy(true); setError('');
    try {
      await setDoc(doc(db, 'trainer_jobs', jobId(dealId, trainerId)), { dealId, trainerId, feeChecks: { [key]: value } }, { merge: true });
    } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };
  const done = allChecked(checks);
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">Before the trainer fee is approved {done ? <span className="font-normal text-accent">· all checked</span> : <span className="font-normal text-attention">· Management approves once all are ticked</span>}</p>
      <ul className="space-y-1.5">
        {checks.map(c => (
          <CheckRow key={c.key} c={c} busy={busy}
            onMark={staff && trainerId ? save(c.key, { byId: viewer.id, byName: viewer.name, at: new Date().toISOString() }) : undefined}
            onUnmark={staff && trainerId ? save(c.key, deleteField()) : undefined} />
        ))}
      </ul>
      {staff && !trainerId && <p className="text-sm text-ink-soft">Pick the trainer from the trainer list on this step to tick these by hand.</p>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}

/** "Are you sure?" before approving a trainer fee: the checks, and Approve only when all are ticked. */
export function ApproveFeeDialog({ o, payee, onApprove, onClose }: { o: MoneyOut; payee?: string; onApprove: () => Promise<void> | void; onClose: () => void }) {
  const { loading, checks } = useFeeChecks(o.dealId, o.checklistTaskId || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const done = !loading && allChecked(checks);
  const approve = async () => {
    setBusy(true); setError('');
    try { await onApprove(); onClose(); } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" role="dialog" aria-modal="true" aria-label="Approve trainer fee" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-2">
          <h3 className="flex-1 text-lg font-bold">Are you sure?</h3>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-ink-soft hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <p className="text-[15px]">Approve the trainer fee for <strong>{payee || o.payee}</strong>: <strong>{formatRM(o.amount)}</strong>{o.description ? ` (${o.description})` : ''}.</p>
        {loading ? <p className="flex items-center gap-2 text-sm text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Checking…</p> : (
          <ul className="space-y-1.5 rounded-xl border border-line bg-surface/60 p-3">
            {checks.map(c => <CheckRow key={c.key} c={c} />)}
          </ul>
        )}
        {!loading && !done && (
          <p className="flex items-start gap-2 rounded-lg bg-attention-soft px-3 py-2.5 text-sm text-attention">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Not everything is checked yet. Admin ticks "Checked by me" on the deal's Trainer step once they have checked it.
          </p>
        )}
        {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onClose}>Cancel</button>
          <button type="button" disabled={!done || busy} className={btnPrimary} onClick={approve}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Yes, approve</button>
        </div>
      </div>
    </div>
  );
}
