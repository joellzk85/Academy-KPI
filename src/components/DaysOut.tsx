import React, { useEffect, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, query, where, writeBatch } from 'firebase/firestore';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import DraftBar from './DraftBar';
import { db, friendlyError } from '../lib/firebase';
import { useFormDraft } from '../lib/useFormDraft';
import { formatDate, todayIso } from '../lib/deals';
import { addDays, dayKey, parseDay } from '../lib/loginActivity';
import { EXCUSE_LABELS, ExcuseReason, ExcusedDay, excusedId, readExcused } from '../lib/reliability';

// Days out of office (Joel, 2026-10-22; appraisal Part C, lib/reliability.ts). Admin and Management note the days
// someone was out on a client visit, training or event, leave, MC, a public holiday or another reason (with a note).
// Used in Admin work → Days out and on the appraisal. Plain wording only: this screen is seen by Admin.

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };
type Person = { id: string; name: string };

const input = 'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const label = 'mb-1 block text-sm font-semibold text-ink';
const primaryBtn = 'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-[15px] font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const MAX_DAYS = 31;

// Days out from `fromKey` onward (everyone, or one person).
export function useExcusedDays(fromKey: string, memberId?: string): ExcusedDay[] | null {
  const [list, setList] = useState<ExcusedDay[] | null>(null);
  useEffect(() => {
    const q = memberId
      ? query(collection(db, 'reliability_excused'), where('memberId', '==', memberId))
      : query(collection(db, 'reliability_excused'), where('date', '>=', fromKey));
    return onSnapshot(q,
      s => setList(s.docs.map(d => readExcused(d.id, d.data())).filter(e => e.date >= fromKey).sort((a, b) => b.date.localeCompare(a.date))),
      () => setList([]));
  }, [fromKey, memberId]);
  return list;
}

export default function DaysOut({ viewer, people, memberId, fromKey }: {
  viewer: Viewer; people: Person[];
  memberId?: string;     // one person only (the appraisal); otherwise pick anyone
  fromKey?: string;      // list from this day (default: the last 60 days)
}) {
  const since = fromKey || dayKey(addDays(new Date(), -60));
  const list = useExcusedDays(since, memberId);
  const blank = { memberId: memberId || '', from: todayIso(), to: '', reason: 'client_visit' as ExcuseReason, note: '' };
  const [f, setF] = useState(blank);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const draft = useFormDraft(viewer.id, `days-out:${memberId || 'any'}`, f, setF);
  const set = (c: Partial<typeof f>) => { setF(x => ({ ...x, ...c })); setError(''); };
  const nameOf = (id: string) => people.find(p => p.id === id)?.name || 'Former team member';

  const save = async () => {
    const who = memberId || f.memberId;
    if (!who) return setError('Choose the person.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.from)) return setError('Choose the date.');
    const to = f.to || f.from;
    if (to < f.from) return setError('The last day must be on or after the first day.');
    const days: string[] = [];
    for (let d = parseDay(f.from); dayKey(d) <= to && days.length <= MAX_DAYS; d = addDays(d, 1)) days.push(dayKey(d));
    if (days.length > MAX_DAYS) return setError(`Up to ${MAX_DAYS} days at a time.`);
    if (f.reason === 'other' && !f.note.trim()) return setError('Add a short note for "Other".');
    setBusy(true);
    try {
      const batch = writeBatch(db);
      const at = new Date().toISOString();
      days.forEach(date => batch.set(doc(db, 'reliability_excused', excusedId(who, date)), {
        memberId: who, date, reason: f.reason, note: f.note.trim(), byId: viewer.id, byName: viewer.name, at,
      }));
      await batch.commit();
      draft.clear();
      setF({ ...blank, memberId: who });
    } catch (e) { setError(friendlyError(e)); }
    setBusy(false);
  };
  const remove = async (e: ExcusedDay) => {
    setError('');
    try { await deleteDoc(doc(db, 'reliability_excused', e.id)); } catch (x) { setError(friendlyError(x)); }
  };

  return (
    <div className="space-y-4">
      <DraftBar draft={draft} what="day out of office" />
      <section className="space-y-3 rounded-2xl border border-line bg-white p-5">
        <div>
          <h4 className="font-bold">Days out of office</h4>
          <p className="text-sm text-ink-soft">Note days someone was away from their desk for work or time off.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {!memberId && (
            <div>
              <label htmlFor="do-who" className={label}>Person</label>
              <select id="do-who" className={input} value={f.memberId} onChange={e => set({ memberId: e.target.value })}>
                <option value="">Choose…</option>
                {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label htmlFor="do-reason" className={label}>Reason</label>
            <select id="do-reason" className={input} value={f.reason} onChange={e => set({ reason: e.target.value as ExcuseReason })}>
              {(Object.keys(EXCUSE_LABELS) as ExcuseReason[]).map(k => <option key={k} value={k}>{EXCUSE_LABELS[k]}</option>)}
            </select>
          </div>
          <div><label htmlFor="do-from" className={label}>Date</label><input id="do-from" type="date" className={input} value={f.from} onChange={e => set({ from: e.target.value })} /></div>
          <div><label htmlFor="do-to" className={label}>Until (optional, for several days)</label><input id="do-to" type="date" className={input} value={f.to} onChange={e => set({ to: e.target.value })} /></div>
        </div>
        <div>
          <label htmlFor="do-note" className={label}>Note {f.reason === 'other' ? '' : '(optional)'}</label>
          <input id="do-note" className={input} value={f.note} onChange={e => set({ note: e.target.value })} placeholder="e.g. client name, event" />
        </div>
        {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end">
          <button type="button" className={primaryBtn} disabled={busy} onClick={save}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Add</button>
        </div>
      </section>
      <section className="overflow-hidden rounded-2xl border border-line bg-white">
        {list === null ? (
          <p className="flex items-center gap-2 px-5 py-4 text-sm text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
        ) : !list.length ? (
          <p className="px-5 py-4 text-sm text-ink-soft">No days out noted since {formatDate(since)}.</p>
        ) : (
          <ul className="divide-y divide-line">
            {list.map(e => (
              <li key={e.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-[15px]">
                <span className="w-32 font-semibold">{formatDate(e.date)}</span>
                {!memberId && <span className="w-40">{nameOf(e.memberId)}</span>}
                <span className="flex-1">{EXCUSE_LABELS[e.reason]}{e.note ? <span className="text-ink-soft"> · {e.note}</span> : null}</span>
                <span className="text-sm text-ink-soft">{e.byName}</span>
                <button type="button" onClick={() => remove(e)} className="rounded-md p-1.5 text-ink-soft hover:bg-surface hover:text-danger" aria-label="Remove"><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
