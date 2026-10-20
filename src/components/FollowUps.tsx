import React, { useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { Loader2, XCircle } from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import { dealOwnerId, dealStage, formatDate, todayIso, STAGE_LABELS } from '../lib/deals';
import { useTeamList } from '../lib/useClientHistory';
import { useFormDraft } from '../lib/useFormDraft';
import DraftBar from './DraftBar';
import { FollowUpAlert, FollowUpHow, FollowUpNote, HOW_LABELS, alertText, followUpNotes, newNoteId } from '../lib/followUps';

// Follow-up notes on a deal (Joel, 2026-10-18): "Log follow-up" in the deal panel's Next step box, and the
// "Follow-ups" section listing every note. After the last checkpoint the form asks for a decision:
// Keep open (reason and next follow-up date) or Mark lost.

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const label = 'mb-1.5 block text-sm font-semibold text-ink';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';

export function FollowUpForm({ deal, viewer, alert, onDone, onCancel, onMarkLost }: {
  deal: any; viewer: Viewer; alert: FollowUpAlert | null;
  onDone: (msg: string) => void; onCancel: () => void; onMarkLost: () => void;
}) {
  const today = todayIso();
  const decision = !!alert?.decision;
  const [date, setDate] = useState(today);
  const [how, setHow] = useState<FollowUpHow>('call');
  const [text, setText] = useState('');
  const [reason, setReason] = useState('');
  const [nextDate, setNextDate] = useState('');
  // Who follows up next (2026-10-18): defaults to the deal owner.
  const team = useTeamList().filter(p => p.active);
  const [byId, setById] = useState(dealOwnerId(deal) || viewer.id);
  const people = team.some(p => p.id === byId) || !byId ? team : [{ id: byId, name: deal.ownerName || 'Deal owner', role: '', active: true }, ...team];
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  // Kept in this browser until it's saved (lib/useFormDraft.ts).
  const draft = useFormDraft(viewer.id, `follow-up:${deal.id}`, { date, how, text, reason, nextDate, byId },
    v => { setDate(v.date); setHow(v.how); setText(v.text); setReason(v.reason); setNextDate(v.nextDate); setById(v.byId); });

  const save = async () => {
    setErr('');
    if (!date || date > today) return setErr('The follow-up date can\'t be in the future.');
    if (!text.trim()) return setErr('Say what happened.');
    if (decision && !reason.trim()) return setErr('Say why the deal should stay open.');
    if (!nextDate) return setErr(decision ? 'Pick the next follow-up date.' : 'Pick the next follow-up date, or mark the deal lost.');
    if (nextDate < today) return setErr('The next follow-up date must be today or later.');
    if (!byId) return setErr('Pick who follows up.');
    const byName = people.find(p => p.id === byId)?.name || (byId === viewer.id ? viewer.name : '');
    const note: FollowUpNote = {
      id: newNoteId(), date, how, text: text.trim().slice(0, 1000), nextDate, followUpById: byId, followUpByName: byName,
      at: new Date().toISOString(), byId: viewer.id, byName: viewer.name, stage: dealStage(deal),
      ...(decision ? { decision: 'keep_open' as const, reason: reason.trim().slice(0, 500) } : {}),
    };
    const action = decision
      ? `Kept open: ${note.reason}. Next follow-up ${formatDate(nextDate)} by ${byName}`
      : `Follow-up (${HOW_LABELS[how]}): ${note.text.length > 80 ? note.text.slice(0, 80) + '…' : note.text}. Next ${formatDate(nextDate)} by ${byName}`;
    setBusy(true);
    try {
      await updateDoc(doc(db, 'pipelines', deal.id), {
        followUps: [...(Array.isArray(deal.followUps) ? deal.followUps : []), note].slice(-200),
        followUpDate: nextDate,
        followUpById: byId, followUpByName: byName,
        history: [...(deal.history || []), { at: note.at, byId: viewer.id, byName: viewer.name, action }].slice(-40),
      });
      draft.clear();
      onDone(decision ? 'Kept open' : 'Follow-up logged');
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-line bg-white p-4">
      <p className="font-semibold">{decision ? 'Decide: keep this deal open, or mark it lost' : 'Log follow-up'}</p>
      <DraftBar draft={draft} what="follow-up note" />
      {decision && (
        <p className="text-sm text-ink-soft">
          It has been {alert!.daysInStage} days at {STAGE_LABELS[dealStage(deal)]}, past the last follow-up checkpoint.
          {' '}<button type="button" onClick={onMarkLost} className="inline-flex items-center gap-1 font-semibold text-danger hover:underline"><XCircle className="h-3.5 w-3.5" /> Mark lost instead</button>
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="fu-date" className={label}>Date</label>
          <input id="fu-date" type="date" max={today} value={date} onChange={e => setDate(e.target.value)} className={input} />
        </div>
        <div>
          <span className={label}>How</span>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(HOW_LABELS) as FollowUpHow[]).map(h => (
              <button key={h} type="button" aria-pressed={how === h} onClick={() => setHow(h)}
                className={`rounded-full border px-3 py-1 text-sm font-medium ${how === h ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-soft hover:bg-surface'}`}>
                {HOW_LABELS[h]}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div>
        <label htmlFor="fu-text" className={label}>What happened</label>
        <textarea id="fu-text" value={text} onChange={e => setText(e.target.value)} className={`${input} min-h-[72px]`} maxLength={1000}
          placeholder="e.g. Spoke to Puan Aida, waiting for their HR to confirm the budget" />
      </div>
      {decision && (
        <div>
          <label htmlFor="fu-reason" className={label}>Why keep it open?</label>
          <input id="fu-reason" value={reason} onChange={e => setReason(e.target.value)} className={input} maxLength={500}
            placeholder="e.g. Budget is approved in January" />
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="fu-next" className={label}>Next follow-up date</label>
          <input id="fu-next" type="date" min={today} value={nextDate} onChange={e => setNextDate(e.target.value)} className={input} />
          {!decision && <p className="mt-1 text-sm text-ink-soft">Not going ahead? <button type="button" onClick={onMarkLost} className="font-semibold text-danger hover:underline">Mark lost</button> instead.</p>}
        </div>
        <div>
          <label htmlFor="fu-by" className={label}>Follow-up by</label>
          <select id="fu-by" value={byId} onChange={e => setById(e.target.value)} className={input}>
            {people.map(p => <option key={p.id} value={p.id}>{p.name}{p.id === viewer.id ? ' (me)' : ''}{p.id === dealOwnerId(deal) ? ' · deal owner' : ''}</option>)}
          </select>
        </div>
      </div>
      {err && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{err}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel}>Cancel</button>
        <button type="button" disabled={busy} className={btnPrimary} onClick={save}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}{decision ? 'Keep open' : 'Save follow-up'}
        </button>
      </div>
    </div>
  );
}

export function followUpCountText(n: number): string {
  return n === 0 ? 'Not followed up yet' : `Followed up ${n} time${n === 1 ? '' : 's'}`;
}

export function FollowUpList({ deal, limit }: { deal: any; limit?: number }) {
  const notes = followUpNotes(deal);
  if (!notes.length) return <p className="text-sm text-ink-soft">No follow-up notes yet.</p>;
  const shown = limit ? notes.slice(0, limit) : notes;
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">{followUpCountText(notes.length)}</p>
      <ul className="space-y-2">
        {shown.map(n => (
          <li key={n.id} className="rounded-lg bg-surface px-3 py-2 text-sm">
            <p className="flex flex-wrap items-center gap-x-2 text-ink-soft">
              <span className="font-semibold text-ink">{formatDate(n.date)}</span>
              <span>{HOW_LABELS[n.how] || 'Other'}</span>
              <span>· {n.byName}</span>
              {n.decision === 'keep_open' && <span className="rounded bg-accent-soft px-1.5 py-0.5 text-xs font-semibold text-accent">Kept open</span>}
            </p>
            <p className="mt-0.5 whitespace-pre-line text-ink">{n.text}</p>
            {n.reason && <p className="mt-0.5 text-ink-soft">Why keep open: {n.reason}</p>}
            {n.nextDate && <p className="mt-0.5 text-ink-soft">Next follow-up {formatDate(n.nextDate)}{n.followUpByName ? ` by ${n.followUpByName}` : ''}</p>}
          </li>
        ))}
      </ul>
      {shown.length < notes.length && <p className="text-sm text-ink-soft">and {notes.length - shown.length} earlier</p>}
    </div>
  );
}

// The red line in the deal panel's Next step box.
export function AlertLine({ alert }: { alert: FollowUpAlert }) {
  return <p className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">{alertText(alert)}</p>;
}
