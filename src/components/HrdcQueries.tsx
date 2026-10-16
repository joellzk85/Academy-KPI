import React, { useState } from 'react';
import { deleteDoc, doc, setDoc, updateDoc } from 'firebase/firestore';
import { AlertTriangle, Check, Loader2, MessageSquareWarning, Plus, Trash2, Undo2 } from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import { formatDate, todayIso } from '../lib/deals';
import { HrdcQuery, QUERY_PHASE_LABELS, QueryPhase, isQueryOpen, isQueryOverdue } from '../lib/programmes';

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const small = 'mb-1 block text-sm font-medium text-ink-soft';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';

// HRDC queries on one deal. Admin and Management add and close them; reps see them.
export default function HrdcQueries({ deal, queries, viewer, people }: {
  deal: any;
  queries: HrdcQuery[];               // this deal's queries
  viewer: Viewer;
  people: { id: string; name: string }[];   // who can handle a query
}) {
  const editable = viewer.role !== 'rep';
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ phase: 'before' as QueryPhase, question: '', receivedDate: todayIso(), replyBy: '', handledById: viewer.id });
  const [answering, setAnswering] = useState<string | null>(null);
  const [answer, setAnswer] = useState({ date: todayIso(), text: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const today = todayIso();

  const sorted = [...queries].sort((a, b) => {
    if (isQueryOpen(a) !== isQueryOpen(b)) return isQueryOpen(a) ? -1 : 1;
    return String(a.replyBy || a.receivedDate).localeCompare(String(b.replyBy || b.receivedDate));
  });

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.question.trim()) return setError('Write what HRDC asked.');
    if (!form.receivedDate) return setError('Enter the date the query came in.');
    if (!form.replyBy) return setError('Enter the date HRDC needs a reply by (from their email).');
    const handler = people.find(p => p.id === form.handledById) || { id: viewer.id, name: viewer.name };
    const id = `hq_${Date.now()}`;
    return run(async () => {
      await setDoc(doc(db, 'hrdc_queries', id), {
        id, dealId: deal.id, phase: form.phase, question: form.question.trim(), receivedDate: form.receivedDate, replyBy: form.replyBy,
        handledById: handler.id, handledByName: handler.name, answeredDate: '', answer: '',
        createdAt: Date.now(), createdById: viewer.id, createdByName: viewer.name,
      });
      setAdding(false);
      setForm({ phase: form.phase, question: '', receivedDate: todayIso(), replyBy: '', handledById: viewer.id });
    });
  };

  const markAnswered = (q: HrdcQuery) => {
    if (!answer.date) return setError('Enter the date you replied.');
    return run(async () => {
      await updateDoc(doc(db, 'hrdc_queries', q.id), { answeredDate: answer.date, answer: answer.text.trim(), answeredById: viewer.id, answeredByName: viewer.name });
      setAnswering(null);
    });
  };

  const reopen = (q: HrdcQuery) => run(() => updateDoc(doc(db, 'hrdc_queries', q.id), { answeredDate: '', answer: '' }));
  const remove = (q: HrdcQuery) => {
    if (!window.confirm('Delete this query? Only do this if it was logged by mistake.')) return;
    return run(() => deleteDoc(doc(db, 'hrdc_queries', q.id)));
  };

  return (
    <div className="space-y-3">
      {sorted.length === 0 && !adding && <p className="text-[15px] text-ink-soft">No HRDC queries on this deal.</p>}
      <ul className="space-y-2">
        {sorted.map(q => {
          const open = isQueryOpen(q);
          const overdue = isQueryOverdue(q, today);
          return (
            <li key={q.id} className={`rounded-xl border px-3.5 py-3 ${overdue ? 'border-danger/40 bg-danger-soft/60' : open ? 'border-attention/40 bg-attention-soft/60' : 'border-line bg-white'}`}>
              <div className="flex items-start gap-3">
                {open ? <MessageSquareWarning className={`mt-0.5 h-5 w-5 shrink-0 ${overdue ? 'text-danger' : 'text-attention'}`} /> : <Check className="mt-0.5 h-5 w-5 shrink-0 text-accent" />}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink-soft">{QUERY_PHASE_LABELS[q.phase] || 'HRDC query'} · received {formatDate(q.receivedDate)}</p>
                  <p className="whitespace-pre-line font-semibold">{q.question}</p>
                  {open ? (
                    <p className={`text-sm ${overdue ? 'font-semibold text-danger' : 'text-ink-soft'}`}>
                      {overdue && <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />}Reply by {formatDate(q.replyBy)} · {q.handledByName}
                    </p>
                  ) : (
                    <p className="text-sm text-ink-soft">Answered {formatDate(q.answeredDate || '')}{q.answer ? `: ${q.answer}` : ''} · {q.handledByName}</p>
                  )}
                </div>
                {editable && (
                  <span className="flex shrink-0 gap-1">
                    {open
                      ? answering !== q.id && <button type="button" disabled={busy} className={`${btnSecondary} py-1.5`} onClick={() => { setAnswering(q.id); setAnswer({ date: todayIso(), text: '' }); setError(''); }}><Check className="h-3.5 w-3.5" /> Answered</button>
                      : <button type="button" disabled={busy} className={`${btnSecondary} py-1.5`} onClick={() => reopen(q)}><Undo2 className="h-3.5 w-3.5" /> Reopen</button>}
                    <button type="button" disabled={busy} className="rounded-md p-1.5 text-ink-soft hover:bg-surface hover:text-danger" onClick={() => remove(q)} aria-label="Delete query"><Trash2 className="h-4 w-4" /></button>
                  </span>
                )}
              </div>
              {answering === q.id && (
                <div className="mt-3 space-y-2 pl-8">
                  <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
                    <div>
                      <label className={small} htmlFor={`ad-${q.id}`}>Replied on</label>
                      <input id={`ad-${q.id}`} type="date" value={answer.date} onChange={e => setAnswer(a => ({ ...a, date: e.target.value }))} className={input} />
                    </div>
                    <div>
                      <label className={small} htmlFor={`at-${q.id}`}>What we replied (optional)</label>
                      <input id={`at-${q.id}`} value={answer.text} onChange={e => setAnswer(a => ({ ...a, text: e.target.value }))} className={input} placeholder="e.g. Sent revised attendance list" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" className={btnSecondary} onClick={() => setAnswering(null)}>Cancel</button>
                    <button type="button" disabled={busy} className={btnPrimary} onClick={() => markAnswered(q)}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save</button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {editable && adding && (
        <form onSubmit={save} className="space-y-3 rounded-xl border border-line bg-surface p-4">
          <p className="text-sm font-semibold">New HRDC query</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="When the query came">
            {(Object.keys(QUERY_PHASE_LABELS) as QueryPhase[]).map(ph => (
              <button key={ph} type="button" role="radio" aria-checked={form.phase === ph} onClick={() => setForm(f => ({ ...f, phase: ph }))}
                className={`rounded-full border px-3 py-1 text-sm font-medium ${form.phase === ph ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-white text-ink-soft hover:bg-surface'}`}>
                {QUERY_PHASE_LABELS[ph]}
              </button>
            ))}
          </div>
          <div>
            <label className={small} htmlFor="hq-q">What HRDC asked</label>
            <textarea id="hq-q" value={form.question} onChange={e => setForm(f => ({ ...f, question: e.target.value }))} className={`${input} min-h-[70px]`} />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className={small} htmlFor="hq-r">Received on</label>
              <input id="hq-r" type="date" value={form.receivedDate} onChange={e => setForm(f => ({ ...f, receivedDate: e.target.value }))} className={input} />
            </div>
            <div>
              <label className={small} htmlFor="hq-b">Reply by</label>
              <input id="hq-b" type="date" value={form.replyBy} onChange={e => setForm(f => ({ ...f, replyBy: e.target.value }))} className={input} />
            </div>
            <div>
              <label className={small} htmlFor="hq-h">Handled by</label>
              <select id="hq-h" value={form.handledById} onChange={e => setForm(f => ({ ...f, handledById: e.target.value }))} className={input}>
                {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" className={btnSecondary} onClick={() => { setAdding(false); setError(''); }}>Cancel</button>
            <button type="submit" disabled={busy} className={btnPrimary}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Add query</button>
          </div>
        </form>
      )}

      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</p>}
      {editable && !adding && (
        <button type="button" className={btnSecondary} onClick={() => { setAdding(true); setError(''); }}><Plus className="h-4 w-4" /> Log an HRDC query</button>
      )}
    </div>
  );
}
