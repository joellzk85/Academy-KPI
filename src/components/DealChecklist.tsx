import React, { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, query, setDoc, updateDoc } from 'firebase/firestore';
import { ArrowDown, ArrowUp, Check, CheckCircle2, Circle, FileText, ListChecks, Loader2, Plus, Trash2, Undo2 } from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import { formatDate, todayIso } from '../lib/deals';
import {
  ChecklistSettings, ChecklistTask, DEFAULT_SETTINGS, applicableTasks, buildChecklist, isHrdc, newTaskId, progress, readSettings, taskGate,
} from '../lib/checklist';

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';
const iconBtn = 'rounded-md p-1.5 text-ink-soft hover:bg-surface hover:text-ink disabled:opacity-30';

// The master task list and flag setting, live.
export function useChecklistSettings(): ChecklistSettings {
  const [settings, setSettings] = useState<ChecklistSettings>(DEFAULT_SETTINGS);
  useEffect(() => onSnapshot(doc(db, 'config', 'checklist_tasks'), s => setSettings(readSettings(s.data())), () => setSettings(DEFAULT_SETTINGS)), []);
  return settings;
}

// Creates a deal's checklist from the master list, unless it already has one.
export async function startChecklist(deal: any, settings: ChecklistSettings, viewer: Viewer, existing?: any) {
  if (existing) return;
  await setDoc(doc(db, 'deal_checklists', deal.id), {
    dealId: deal.id,
    tasks: buildChecklist(settings),
    createdAt: Date.now(),
    createdById: viewer.id,
    createdByName: viewer.name,
    history: [{ at: new Date().toISOString(), byId: viewer.id, byName: viewer.name, action: 'Checklist started' }],
  });
}

export function ProgressBar({ done, total, label = true }: { done: number; total: number; label?: boolean }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Admin checklist progress">
        <div className={`h-full rounded-full ${done === total && total > 0 ? 'bg-accent' : 'bg-accent/70'}`} style={{ width: `${pct}%` }} />
      </div>
      {label && <span className="shrink-0 text-sm font-semibold tabular-nums text-ink-soft">{done} of {total} done</span>}
    </div>
  );
}

const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export default function DealChecklist({
  deal, checklist, quotes, viewer, onCreateQuotation, onOpenQuotations,
}: {
  deal: any;
  checklist: any | null;           // deal_checklists document, or null if not started
  quotes: any[];                   // quotations linked to this deal
  viewer: Viewer;
  onCreateQuotation?: () => void;
  onOpenQuotations?: () => void;
}) {
  const settings = useChecklistSettings();
  const [venues, setVenues] = useState<any[]>([]);
  const [trainers, setTrainers] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [arranging, setArranging] = useState(false);
  const [newTask, setNewTask] = useState('');
  const editable = viewer.role !== 'rep';

  useEffect(() => {
    if (!editable) return;
    const subs = [
      onSnapshot(query(collection(db, 'venues_directory')), s => setVenues(s.docs.map(d => ({ ...d.data(), id: d.id })))),
      onSnapshot(query(collection(db, 'trainers_directory')), s => setTrainers(s.docs.map(d => ({ ...d.data(), id: d.id })))),
    ];
    return () => subs.forEach(u => u());
  }, [editable]);

  const allTasks: ChecklistTask[] = checklist?.tasks || [];
  const tasks = applicableTasks(allTasks, deal.fundingType);
  const { done, total } = progress(allTasks, deal.fundingType);

  const save = async (next: ChecklistTask[], action: string) => {
    setBusy(true);
    setError('');
    try {
      await updateDoc(doc(db, 'deal_checklists', deal.id), {
        tasks: clean(next),
        updatedAt: Date.now(),
        history: [...(checklist?.history || []), { at: new Date().toISOString(), byId: viewer.id, byName: viewer.name, action }].slice(-60),
      });
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const patch = (id: string, changes: Partial<ChecklistTask>, action: string) =>
    save(allTasks.map(t => (t.id === id ? { ...t, ...changes } : t)), action);

  const markDone = (t: ChecklistTask) => {
    const gate = taskGate(t, quotes.length);
    if (gate) return setError(gate);
    return patch(t.id, { done: true, doneAt: todayIso(), doneById: viewer.id, doneByName: viewer.name }, `${t.label}: done`);
  };
  const undo = (t: ChecklistTask) => patch(t.id, { done: false, doneAt: '', doneById: '', doneByName: '' }, `${t.label}: reopened`);

  const move = (t: ChecklistTask, dir: -1 | 1) => {
    // Move among the tasks shown, keeping hidden (not applicable) ones in place.
    const shown = tasks.map(x => x.id);
    const i = shown.indexOf(t.id);
    const j = i + dir;
    if (j < 0 || j >= shown.length) return;
    const a = allTasks.findIndex(x => x.id === shown[i]);
    const b = allTasks.findIndex(x => x.id === shown[j]);
    const next = [...allTasks];
    [next[a], next[b]] = [next[b], next[a]];
    return save(next, 'Steps reordered');
  };

  const remove = (t: ChecklistTask) => {
    if (!window.confirm(`Remove "${t.label}" from this deal's checklist?`)) return;
    return save(allTasks.filter(x => x.id !== t.id), `${t.label}: removed from this deal`);
  };

  const addOneOff = (e: React.FormEvent) => {
    e.preventDefault();
    const label = newTask.trim();
    if (!label) return;
    setNewTask('');
    return save([...allTasks, { id: newTaskId(), label, kind: 'basic', appliesTo: 'all', oneOff: true, done: false }], `${label}: added`);
  };

  const missing = settings.tasks.filter(m => !m.retired && !allTasks.some(t => t.id === m.id));
  const addMissing = () =>
    save([...allTasks, ...missing.map(m => ({ id: m.id, label: m.label, kind: m.kind, appliesTo: m.appliesTo, done: false }))], `Added from the master list: ${missing.map(m => m.label).join(', ')}`);

  const begin = async () => {
    setBusy(true);
    setError('');
    try {
      await startChecklist(deal, settings, viewer, checklist);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  if (!checklist) {
    return (
      <div className="rounded-xl border border-dashed border-line p-4">
        <p className="text-[15px] text-ink-soft">
          {editable ? "This won deal doesn't have an admin checklist yet." : "Admin hasn't started the checklist for this deal yet."}
        </p>
        {editable && (
          <button type="button" disabled={busy} onClick={begin} className={`${btnPrimary} mt-3`}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListChecks className="h-4 w-4" />} Start checklist
          </button>
        )}
        {error && <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ProgressBar done={done} total={total} />
      {!isHrdc(deal.fundingType) && allTasks.some(t => t.appliesTo === 'hrdc') && (
        <p className="text-sm text-ink-soft">HRDC-only steps are hidden because this deal isn't HRDC funded.</p>
      )}

      <ul className="space-y-2">
        {tasks.map((t, i) => (
          <li key={t.id} className={`rounded-xl border px-3.5 py-3 ${t.done ? 'border-accent/25 bg-accent-soft/50' : 'border-line bg-white'}`}>
            <div className="flex items-start gap-3">
              {t.done ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-accent" /> : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-ink-soft/50" />}
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{t.label}{t.oneOff && <span className="ml-2 rounded bg-surface px-1.5 py-0.5 text-xs font-medium text-ink-soft">This deal only</span>}</p>
                <TaskSummary t={t} venues={venues} trainers={trainers} quotes={quotes} withNote={!(editable && !t.done && !arranging)} />
                {t.done && <p className="text-sm text-ink-soft">Done {formatDate(t.doneAt || '')} by {t.doneByName}</p>}
              </div>
              {editable && arranging ? (
                <span className="flex shrink-0 items-center">
                  <button type="button" className={iconBtn} disabled={busy || i === 0} onClick={() => move(t, -1)} aria-label={`Move ${t.label} up`}><ArrowUp className="h-4 w-4" /></button>
                  <button type="button" className={iconBtn} disabled={busy || i === tasks.length - 1} onClick={() => move(t, 1)} aria-label={`Move ${t.label} down`}><ArrowDown className="h-4 w-4" /></button>
                  <button type="button" className={`${iconBtn} hover:text-danger`} disabled={busy} onClick={() => remove(t)} aria-label={`Remove ${t.label}`}><Trash2 className="h-4 w-4" /></button>
                </span>
              ) : editable && (
                t.done
                  ? <button type="button" disabled={busy} className={`${btnSecondary} shrink-0 py-1.5`} onClick={() => undo(t)}><Undo2 className="h-3.5 w-3.5" /> Undo</button>
                  : <button type="button" disabled={busy} className={`${btnSecondary} shrink-0 py-1.5`} onClick={() => markDone(t)}><Check className="h-3.5 w-3.5" /> Done</button>
              )}
            </div>
            {editable && !t.done && !arranging && (
              <TaskFields t={t} busy={busy} venues={venues} trainers={trainers} quotes={quotes}
                onPatch={(c, a) => patch(t.id, c, a)} onCreateQuotation={onCreateQuotation} onOpenQuotations={onOpenQuotations} />
            )}
          </li>
        ))}
      </ul>

      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</p>}

      {editable && (
        <div className="space-y-3">
          {arranging && (
            <>
              <form onSubmit={addOneOff} className="flex gap-2">
                <input value={newTask} onChange={e => setNewTask(e.target.value)} className={input} placeholder="Add a step for this deal only" aria-label="New step for this deal" />
                <button type="submit" disabled={busy || !newTask.trim()} className={btnSecondary}><Plus className="h-4 w-4" /> Add</button>
              </form>
              {missing.length > 0 && (
                <button type="button" disabled={busy} onClick={addMissing} className={btnSecondary}>
                  <Plus className="h-4 w-4" /> Add new steps from the master list ({missing.map(m => m.label).join(', ')})
                </button>
              )}
            </>
          )}
          <button type="button" onClick={() => setArranging(a => !a)} className="text-sm font-semibold text-accent hover:underline">
            {arranging ? 'Finish arranging' : 'Arrange, add or remove steps for this deal'}
          </button>
        </div>
      )}
    </div>
  );
}

// One line of detail under each task title.
function TaskSummary({ t, venues, trainers, quotes, withNote }: { t: ChecklistTask; venues: any[]; trainers: any[]; quotes: any[]; withNote: boolean }) {
  const bits: string[] = [];
  if (t.kind === 'grant') {
    if (t.grantAppliedDate) bits.push(`Applied ${formatDate(t.grantAppliedDate)}`);
    if (t.grantNumber) bits.push(`Grant no. ${t.grantNumber}${t.grantApprovedDate ? `, approved ${formatDate(t.grantApprovedDate)}` : ''}`);
  }
  if (t.kind === 'venue' && t.venueId) bits.push(`${venues.find(v => v.id === t.venueId)?.name || 'Venue chosen'}${t.venuePaid ? ', paid' : ', not paid yet'}`);
  if (t.kind === 'trainer' && t.trainerId) bits.push(trainers.find(x => x.id === t.trainerId)?.name || 'Trainer chosen');
  if (t.kind === 'quotation') bits.push(quotes.length ? `Quotation ${quotes.map(q => q.refNumber || q.id).join(', ')}` : 'No quotation linked yet');
  if (withNote && t.note) bits.push(t.note);
  if (!bits.length) return null;
  return <p className="text-sm text-ink-soft">{bits.join(' · ')}</p>;
}

// The inputs each kind of task needs before it can be ticked.
function TaskFields({ t, busy, venues, trainers, quotes, onPatch, onCreateQuotation, onOpenQuotations }: {
  t: ChecklistTask; busy: boolean; venues: any[]; trainers: any[]; quotes: any[];
  onPatch: (c: Partial<ChecklistTask>, action: string) => void;
  onCreateQuotation?: () => void; onOpenQuotations?: () => void;
}) {
  const [note, setNote] = useState(t.note || '');
  const [grantNo, setGrantNo] = useState(t.grantNumber || '');
  useEffect(() => setNote(t.note || ''), [t.note]);
  useEffect(() => setGrantNo(t.grantNumber || ''), [t.grantNumber]);
  const small = 'mb-1 block text-sm font-medium text-ink-soft';
  const byName = (a: any, b: any) => String(a.name || '').localeCompare(String(b.name || ''));

  return (
    <div className="mt-3 space-y-3 pl-8">
      {t.kind === 'grant' && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className={small} htmlFor={`ga-${t.id}`}>Applied on</label>
            <input id={`ga-${t.id}`} type="date" disabled={busy} value={t.grantAppliedDate || ''} onChange={e => onPatch({ grantAppliedDate: e.target.value }, `${t.label}: applied date set`)} className={input} />
          </div>
          <div>
            <label className={small} htmlFor={`gn-${t.id}`}>Grant number</label>
            <input id={`gn-${t.id}`} disabled={busy} value={grantNo} onChange={e => setGrantNo(e.target.value)}
              onBlur={() => grantNo.trim() !== (t.grantNumber || '') && onPatch({ grantNumber: grantNo.trim(), grantApprovedDate: t.grantApprovedDate || (grantNo.trim() ? todayIso() : '') }, `${t.label}: grant number saved`)}
              className={input} placeholder="Once approved" />
          </div>
          <div>
            <label className={small} htmlFor={`gd-${t.id}`}>Approved on</label>
            <input id={`gd-${t.id}`} type="date" disabled={busy} value={t.grantApprovedDate || ''} onChange={e => onPatch({ grantApprovedDate: e.target.value }, `${t.label}: approved date set`)} className={input} />
          </div>
        </div>
      )}
      {t.kind === 'venue' && (
        <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto]">
          <div>
            <label className={small} htmlFor={`v-${t.id}`}>Venue</label>
            <select id={`v-${t.id}`} disabled={busy} value={t.venueId || ''} onChange={e => onPatch({ venueId: e.target.value }, `${t.label}: venue chosen`)} className={input}>
              <option value="">Choose from the venue list</option>
              {[...venues].sort(byName).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 pb-2 text-[15px]">
            <input type="checkbox" disabled={busy} checked={!!t.venuePaid} onChange={e => onPatch({ venuePaid: e.target.checked }, `${t.label}: ${e.target.checked ? 'marked paid' : 'marked not paid'}`)} className="h-4 w-4 accent-[#0E6E62]" />
            Venue paid
          </label>
        </div>
      )}
      {t.kind === 'trainer' && (
        <div>
          <label className={small} htmlFor={`tr-${t.id}`}>Trainer</label>
          <select id={`tr-${t.id}`} disabled={busy} value={t.trainerId || ''} onChange={e => onPatch({ trainerId: e.target.value }, `${t.label}: trainer chosen`)} className={input}>
            <option value="">Choose from the trainer list</option>
            {[...trainers].sort(byName).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </div>
      )}
      {t.kind === 'quotation' && (onCreateQuotation || (onOpenQuotations && quotes.length > 0)) && (
        <div className="flex flex-wrap gap-2">
          {quotes.length > 0 && onOpenQuotations && <button type="button" className={btnSecondary} onClick={onOpenQuotations}><FileText className="h-4 w-4" /> Open quotations</button>}
          {onCreateQuotation && <button type="button" className={btnSecondary} onClick={onCreateQuotation}><Plus className="h-4 w-4" /> Create quotation</button>}
        </div>
      )}
      <input disabled={busy} value={note} onChange={e => setNote(e.target.value)} onBlur={() => note.trim() !== (t.note || '') && onPatch({ note: note.trim() }, `${t.label}: note updated`)}
        className={input} placeholder="Note (optional), e.g. 18 of 20 confirmed" aria-label={`Note for ${t.label}`} />
    </div>
  );
}
