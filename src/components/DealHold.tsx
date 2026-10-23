// "On hold" boxes on the deal panel (Joel, 2026-10-19; logic in src/lib/dealHold.ts):
// HoldBox puts a deal on hold (or holds it longer) with a potential date and a reason;
// ResumeBox takes it off hold with the next follow-up date.
import React, { useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { PauseCircle, PlayCircle } from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import { dealOwnerId, dealStage, formatDate, todayIso } from '../lib/deals';
import { HOLD_REASONS, activeHold, holdProblem } from '../lib/dealHold';
import { addDays } from '../lib/followUps';

type Viewer = { id: string; name: string; role: string };

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';
const btnHold =
  'inline-flex items-center gap-2 rounded-lg bg-attention px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60';

const historyEntry = (viewer: Viewer, action: string) => ({ at: new Date().toISOString(), byId: viewer.id, byName: viewer.name, action });

export function HoldBox({ deal, viewer, ownerName, onDone, onCancel }: {
  deal: any; viewer: Viewer; ownerName: string; onDone: (msg: string) => void; onCancel: () => void;
}) {
  const today = todayIso();
  const current = activeHold(deal);
  const known = current && HOLD_REASONS.includes(current.reason) ? current.reason : current ? 'Other' : '';
  const [until, setUntil] = useState(current ? '' : addDays(today, 30));
  const [choice, setChoice] = useState(known);
  const [note, setNote] = useState(known === 'Other' ? current!.reason : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    const reason = choice === 'Other' ? note.trim() : choice;
    if (!choice) return setError('Choose why it is on hold.');
    const problem = holdProblem(until, reason, today);
    if (problem) return setError(problem);
    setBusy(true);
    setError('');
    try {
      const hold = { stage: dealStage(deal), since: current?.since || today, until, reason: reason.slice(0, 200), byId: viewer.id, byName: viewer.name, at: new Date().toISOString() };
      const action = current
        ? `Hold extended to ${formatDate(until)}: ${hold.reason}`
        : `Put on hold until ${formatDate(until)}: ${hold.reason}`;
      await updateDoc(doc(db, 'pipelines', deal.id), {
        onHold: hold,
        // The potential date is the next follow-up, so it shows in My follow-ups and Team follow-ups.
        followUpDate: until,
        followUpById: deal.followUpById || dealOwnerId(deal),
        followUpByName: deal.followUpByName || ownerName,
        history: [...(deal.history || []), historyEntry(viewer, action)],
      });
      onDone(current ? 'Hold extended' : 'Deal put on hold');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-attention/30 bg-attention-soft p-4">
      <span className="mb-1 block text-sm font-semibold text-attention">{current ? 'Hold longer' : 'Put on hold'}</span>
      <p className="mb-3 text-sm text-ink-soft">The deal stays at its stage. Follow-up reminders pause until the potential date, then it asks you to resume or mark it lost.</p>
      <label htmlFor="hold-until" className="mb-1.5 block text-sm font-semibold">Potential date <span className="font-normal text-ink-soft">(when the client might be ready)</span></label>
      <input id="hold-until" type="date" value={until} min={addDays(today, 1)} onChange={e => setUntil(e.target.value)} className={`${input} sm:w-56`} />
      <span className="mb-1.5 mt-3 block text-sm font-semibold">Why is it on hold?</span>
      <div className="flex flex-wrap gap-2">
        {HOLD_REASONS.map(r => (
          <button key={r} type="button" onClick={() => setChoice(r)} aria-pressed={choice === r}
            className={`rounded-full border px-3 py-1 text-sm font-medium ${choice === r ? 'border-attention bg-white text-attention' : 'border-attention/30 text-ink-soft hover:bg-white'}`}>
            {r}
          </button>
        ))}
      </div>
      {choice === 'Other' && (
        <input value={note} onChange={e => setNote(e.target.value)} className={`${input} mt-3`} maxLength={200}
          placeholder="e.g. New HR manager starts in January" aria-label="Why it is on hold" />
      )}
      {error && <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel}>Cancel</button>
        <button type="button" disabled={busy} className={btnHold} onClick={save}><PauseCircle className="h-4 w-4" /> {current ? 'Save new date' : 'Put on hold'}</button>
      </div>
    </div>
  );
}

export function ResumeBox({ deal, viewer, onDone, onCancel }: {
  deal: any; viewer: Viewer; onDone: (msg: string) => void; onCancel: () => void;
}) {
  const today = todayIso();
  const [next, setNext] = useState(addDays(today, 7));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next) || next < today) return setError('Pick the next follow-up date (today or later).');
    setBusy(true);
    setError('');
    try {
      await updateDoc(doc(db, 'pipelines', deal.id), {
        onHold: null,
        holdResumedDate: today,   // the follow-up rule clock starts again from today
        followUpDate: next,
        history: [...(deal.history || []), historyEntry(viewer, `Taken off hold. Next follow-up ${formatDate(next)}`)],
      });
      onDone('Deal taken off hold');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <span className="mb-1 block text-sm font-semibold">Resume the deal</span>
      <p className="mb-3 text-sm text-ink-soft">Follow-up reminders start counting again from today.</p>
      <label htmlFor="resume-next" className="mb-1.5 block text-sm font-semibold">Next follow-up date</label>
      <input id="resume-next" type="date" value={next} min={today} onChange={e => setNext(e.target.value)} className={`${input} sm:w-56`} />
      {error && <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel}>Cancel</button>
        <button type="button" disabled={busy} onClick={save} className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-[#0B5A50] disabled:opacity-60"><PlayCircle className="h-4 w-4" /> Resume</button>
      </div>
    </div>
  );
}
