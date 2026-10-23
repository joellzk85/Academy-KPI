import React, { useEffect, useRef, useState } from 'react';
import { collection, doc, onSnapshot, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { ArrowDown, ArrowUp, Check, CheckCircle2, Circle, FileText, ListChecks, Loader2, Plus, Trash2, Undo2, X } from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import { formatDate, todayIso, trainingDateText, trainingDayList, trainingEndDate } from '../lib/deals';
import { TrainingReportBox } from './TrainingReportAdmin';
import {
  ChecklistSettings, ChecklistTask, DEFAULT_SETTINGS, MaterialItem, NEW_STEPS, Picked, applicableTasks, asksNeeded, buildChecklist,
  approvalCodeOf, coTrainerShort, coTrainerText, isLockedStep, effectiveTrainer, isCoTrainer, leadTrainerTask, effectiveVenue, hasCosts, hasFiles, isHrdc, isOptional, materialItems, newTaskId, notNeeded, progress, readSettings, taskGate,
  upgradeTasks, withSteps,
} from '../lib/checklist';
import { ChecklistFile } from '../lib/checklistFiles';
import { MoneyOut } from '../lib/money';
import { withoutDeleted } from '../lib/linked';
import PickOrType, { nameOptions, trainerOptions } from './PickOrType';
import StepFiles from './ChecklistFiles';
import SaveVenueButton from './SaveVenueButton';
import T3Maker, { useT3 } from './T3Maker';
import StepCosts, { VendorHint } from './StepCosts';
import { useVendors } from './VendorsPage';
import { useReceipts } from './PaymentReceipts';
import { TrainerClash, TrainerJobBox } from './TrainerPortalAdmin';
import { MakePoButton } from './TrainerPoDocument';
import { hasAutoPo } from '../lib/trainerPortal';
import { vendorForTrainer } from '../lib/vendors';
import { askReason } from '../lib/moneyActions';

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';
const iconBtn = 'rounded-md p-1.5 text-ink-soft hover:bg-surface hover:text-ink disabled:opacity-30';
const small = 'mb-1 block text-sm font-medium text-ink-soft';

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
const DOCS_WORD: Record<string, string> = { venue: 'venue documents', bus: 'transporter documents', facilitator: 'facilitator documents', trainer: "trainer's PO" };

export default function DealChecklist({
  deal, checklist, quotes, viewer, onCreateQuotation, onOpenQuotations, grantBlock = '', part, hideProgress,
}: {
  deal: any;
  checklist: any | null;           // deal_checklists document, or null if not started
  quotes: any[];                   // quotations linked to this deal
  viewer: Viewer;
  onCreateQuotation?: () => void;
  onOpenQuotations?: () => void;
  grantBlock?: string;             // why the grant step can't be ticked yet (programme not HRDC approved)
  part?: 'before' | 'after';       // only the steps before training day, or only the after-training ones (AfterTraining.tsx)
  hideProgress?: boolean;
}) {
  const settings = useChecklistSettings();
  const [venues, setVenues] = useState<any[]>([]);
  const [trainers, setTrainers] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [arranging, setArranging] = useState(false);
  const [newTask, setNewTask] = useState('');
  const client = useClient(deal.clientId);   // its HRD Corp employer code, needed to tick Grant approved (2026-10-23)
  const editable = viewer.role !== 'rep';
  const money = editable && part !== 'after';   // costs, vendors and receipts: Admin and Management, before training

  // Everyone needs the lists: the venue and trainer names show on the checklist for reps too.
  useEffect(() => {
    const subs = [
      onSnapshot(query(collection(db, 'venues_directory')), s => setVenues(s.docs.map(d => ({ ...d.data(), id: d.id })))),
      onSnapshot(query(collection(db, 'trainers_directory')), s => setTrainers(s.docs.map(d => ({ ...d.data(), id: d.id })))),
    ];
    return () => subs.forEach(u => u());
  }, []);

  // Files uploaded on this deal's steps (attendance, venue documents, PO, JD14, T3, Output assessment, ...).
  const [files, setFiles] = useState<ChecklistFile[]>([]);
  useEffect(() => onSnapshot(query(collection(db, 'checklist_files'), where('dealId', '==', deal.id)),
    s => setFiles(s.docs.map(d => ({ ...(d.data() as ChecklistFile), id: d.id }))), () => setFiles([])), [deal.id]);
  const filesOf = (t: ChecklistTask) => files.filter(f => f.taskId === t.id);
  // The T3 form maker on the Attendance list step: HRDC deals, Admin and Management.
  const t3Shown = editable && isHrdc(deal.fundingType);
  const t3 = useT3(deal.id, editable, checklist?.t3);
  const [nameList, setNameList] = useState<{ files: File[]; at: number } | null>(null);

  // Costs raised from the steps (money_out), their receipts, and the vendors: Admin and Management only.
  const [outs, setOuts] = useState<MoneyOut[]>([]);
  useEffect(() => {
    if (!money) { setOuts([]); return; }
    return onSnapshot(query(collection(db, 'money_out'), where('dealId', '==', deal.id)),
      s => setOuts(withoutDeleted(s.docs.map(d => ({ ...(d.data() as MoneyOut), id: d.id })))), () => setOuts([]));
  }, [deal.id, money]);
  const receipts = useReceipts(money, deal.id);
  const vendors = useVendors(money);

  const allTasks: ChecklistTask[] = upgradeTasks(checklist?.tasks);
  const inPart = (t: { after?: boolean }) => !part || (part === 'after') === !!t.after;
  const tasks = applicableTasks(allTasks, deal.fundingType).filter(inPart);
  const { done, total } = progress(allTasks, deal.fundingType, part);

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

  // Newer steps (Bus, Facilitator, Output assessment QR, Co-trainer: NEW_STEPS in lib/checklist.ts) are added once to a won deal whose training
  // hasn't ended yet. Trainings already over are left as they were ("Add new steps from the master list" adds them).
  const added = useRef('');
  const end = trainingEndDate(deal);
  const ended = !!end && end < todayIso();
  const missingNew = settings.tasks.filter(m => NEW_STEPS.includes(m.id) && !m.retired && !allTasks.some(t => t.id === m.id));
  useEffect(() => {
    if (!editable || !checklist || ended || part === 'after' || !missingNew.length || added.current === deal.id) return;
    added.current = deal.id;
    save(withSteps(allTasks, missingNew), `New steps added: ${missingNew.map(m => m.label).join(', ')}`);
  }, [editable, !!checklist, ended, missingNew.length, deal.id]);

  const patch = (id: string, changes: Partial<ChecklistTask>, action: string) =>
    save(allTasks.map(t => (t.id === id ? { ...t, ...changes } : t)), action);
  const doneBy = () => ({ done: true, doneAt: todayIso(), doneById: viewer.id, doneByName: viewer.name });
  const openAgain = { done: false, doneAt: '', doneById: '', doneByName: '' };

  const markDone = (t: ChecklistTask) => {
    const venue = t.kind === 'venue' ? effectiveVenue(t, quotes, venues) : null;
    const trainer = t.kind === 'trainer' ? effectiveTrainer(t, quotes, trainers) : null;
    // The trainer's PO is made automatically once the trainer is picked from the list and has a fee line (2026-10-21).
    const autoPo = t.kind === 'trainer' && hasAutoPo({ id: t.id, trainerId: trainer?.id }, outs, deal.id) ? 1 : 0;
    const gate = taskGate(t, quotes.length, grantBlock, !!venue, !!trainer, filesOf(t).length + autoPo);
    if (gate) return setError(gate);
    // HRDC deals: Grant approved needs the Employer code and the Approval code (Joel, 2026-10-23).
    if (t.kind === 'grant' && isHrdc(deal.fundingType)) {
      const missing = [!String(client?.employerCode || '').trim() && 'Employer code', !approvalCodeOf(allTasks) && 'Approval code'].filter(Boolean).join(' and ');
      if (missing) return setError(`Fill in the ${missing} below first: Grant approved needs both.`);
    }
    // A venue or trainer still coming from the quotation is saved on the checklist when ticked,
    // so later changes to the quotation don't change what Admin confirmed.
    const keep: Partial<ChecklistTask> = {};
    if (venue?.from === 'quotation' && !notNeeded(t)) Object.assign(keep, { venueId: venue.id, venueName: venue.name });
    if (trainer?.from === 'quotation') Object.assign(keep, { trainerId: trainer.id, trainerName: trainer.name });
    return patch(t.id, { ...keep, ...doneBy() }, `${t.label}: done`);
  };
  const undo = (t: ChecklistTask) => patch(t.id, openAgain, `${t.label}: reopened`);

  // "Needed for this training?" No = done ("Not needed"); Yes reopens it for the details.
  const answerNeeded = (t: ChecklistTask, yes: boolean) =>
    patch(t.id, yes ? { needed: true, ...openAgain } : { needed: false, ...doneBy() }, `${t.label}: ${yes ? 'needed' : 'not needed'}`);

  // Materials: tick, add or remove lines. All ticked = done; unticking one reopens it.
  const setItems = (t: ChecklistTask, items: MaterialItem[], action: string) => {
    const all = items.length > 0 && items.every(i => i.done);
    return patch(t.id, { items, ...(all && !t.done ? doneBy() : !all && t.done ? openAgain : {}) }, `${t.label}: ${action}${all && !t.done ? ', done' : !all && t.done ? ', reopened' : ''}`);
  };

  // Uploading a file on a step with a drop box ticks it (Joel, 2026-10-19); deleting its last file reopens it.
  const fileUploaded = (t: ChecklistTask, list: ChecklistFile[]) => {
    const what = list.length === 1 ? `"${list[0].name}" uploaded` : `${list.length} files uploaded`;
    const now = allTasks.find(x => x.id === t.id);
    if (!now) return;
    if (now.done || !hasFiles(t)) return save(allTasks, `${t.label}: ${what}`);
    return patch(t.id, doneBy(), `${t.label}: ${what}, done`);
  };
  const lastFileRemoved = (t: ChecklistTask) => {
    const now = allTasks.find(x => x.id === t.id);
    if (now?.done && hasFiles(t)) return patch(t.id, openAgain, `${t.label}: last file deleted, reopened`);
    return save(allTasks, `${t.label}: file deleted`);
  };

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

  // Grant, JD14, T3, Training delivered and Training report can't be removed except by Management, with a reason
  // (process audit, 2026-10-22: removing them switched their reminders off).
  const remove = (t: ChecklistTask) => {
    if (isLockedStep(t)) {
      if (viewer.role !== 'management') return setError(`"${t.label}" can't be removed: HRDC and the case depend on it. Ask Management if it really doesn't apply.`);
      const reason = askReason(`Remove "${t.label}" from this deal's checklist? Its reminders stop.\n\nWhy doesn't it apply to this deal?`);
      if (!reason) return;
      return save(allTasks.filter(x => x.id !== t.id), `${t.label}: removed from this deal by Management (${reason})`);
    }
    if (!window.confirm(`Remove "${t.label}" from this deal's checklist?`)) return;
    return save(allTasks.filter(x => x.id !== t.id), `${t.label}: removed from this deal`);
  };

  const addOneOff = (e: React.FormEvent) => {
    e.preventDefault();
    const label = newTask.trim();
    if (!label) return;
    setNewTask('');
    return save([...allTasks, { id: newTaskId(), label, kind: 'basic', appliesTo: 'all', oneOff: true, ...(part === 'after' ? { after: true } : {}), done: false }], `${label}: added`);
  };

  const missing = settings.tasks.filter(m => !m.retired && inPart(m) && !allTasks.some(t => t.id === m.id));
  const addMissing = () => save(withSteps(allTasks, missing), `Added from the master list: ${missing.map(m => m.label).join(', ')}`);
  // Optional steps (Certificates) show last, except while arranging (the arrows move the saved order).
  const last = (t: ChecklistTask) => isOptional(t) && !isCoTrainer(t);   // co-trainers stay next to the trainer
  const shown = arranging ? tasks : [...tasks.filter(t => !last(t)), ...tasks.filter(last)];

  // Co-trainer (2026-10-22): another one after the last co-trainer ("cotrainer_2", "Co-trainer 2"...).
  const coTasks = allTasks.filter(isCoTrainer);
  const addCoTrainer = () => {
    let n = coTasks.length + 1;
    while (allTasks.some(x => x.id === `cotrainer_${n}`)) n++;
    const at = allTasks.findIndex(x => x.id === coTasks[coTasks.length - 1]?.id) + 1 || allTasks.findIndex(x => x.id === leadTrainerTask(allTasks)?.id) + 1 || allTasks.length;
    const next = [...allTasks];
    next.splice(at, 0, { id: `cotrainer_${n}`, label: `Co-trainer ${n}`, kind: 'trainer', appliesTo: 'all', optional: true, needed: true, done: false });
    return save(next, `Co-trainer ${n}: added`);
  };
  const short = coTrainerShort(deal, allTasks);
  const days = trainingDayList(deal);

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

  const hintFor = (t: ChecklistTask): VendorHint | undefined => {
    if (t.kind === 'trainer') { const p = effectiveTrainer(t, quotes, trainers); return { type: 'trainer', trainerId: p?.id || undefined, name: p?.name }; }
    if (t.kind === 'venue') { const p = effectiveVenue(t, quotes, venues); return { type: 'venue', venueId: p?.id || undefined, name: p?.name }; }
    return undefined;
  };

  return (
    <div className="space-y-3">
      {!hideProgress && <ProgressBar done={done} total={total} />}
      {short && part !== 'after' && (
        <p className="rounded-lg bg-attention-soft px-3 py-2.5 text-sm"><strong>Co-trainer reminder.</strong> {coTrainerText(short)} Choose one on the Co-trainer step, or answer No if it isn't needed.</p>
      )}
      {!isHrdc(deal.fundingType) && allTasks.some(t => t.appliesTo === 'hrdc' && inPart(t)) && (
        <p className="text-sm text-ink-soft">HRDC-only steps are hidden because this deal isn't HRDC funded.</p>
      )}

      {tasks.length === 0 && <p className="text-[15px] text-ink-soft">No steps here for this deal.</p>}
      <ul className="space-y-2">
        {part !== 'after' && !arranging && <QuotationRow quotes={quotes} onOpenQuotations={onOpenQuotations} onCreateQuotation={editable ? onCreateQuotation : undefined} />}
        {shown.map((t, i) => (
          <li key={t.id} className={`rounded-xl border px-3.5 py-3 ${t.done ? 'border-accent/25 bg-accent-soft/50' : 'border-line bg-white'}`}>
            <div className="flex items-start gap-3">
              {t.done ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-accent" /> : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-ink-soft/50" />}
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{t.label}{t.after && !part && <span className="ml-2 rounded bg-surface px-1.5 py-0.5 text-xs font-medium text-ink-soft">After training</span>}{isOptional(t) && <span className="ml-2 rounded bg-surface px-1.5 py-0.5 text-xs font-medium text-ink-soft">Optional</span>}{t.oneOff && <span className="ml-2 rounded bg-surface px-1.5 py-0.5 text-xs font-medium text-ink-soft">This deal only</span>}{notNeeded(t) && <span className="ml-2 rounded bg-surface px-1.5 py-0.5 text-xs font-medium text-ink-soft">Not needed</span>}</p>
                <TaskSummary t={t} days={days} venues={venues} trainers={trainers} quotes={quotes} withNote={!(editable && !t.done && !arranging)} />
                {t.done && <p className="text-sm text-ink-soft">Done {formatDate(t.doneAt || '')} by {t.doneByName}</p>}
                {t.kind === 'grant' && !t.done && grantBlock && <p className="mt-1 text-sm font-semibold text-attention">{grantBlock}</p>}
                {t.kind === 'grant' && !arranging && (
                  <HrdcCodes deal={deal} tasks={allTasks} editable={editable} busy={busy}
                    onApproval={code => patch(t.id, { approvalCode: code }, `${t.label}: approval code ${code ? `set to ${code}` : 'cleared'}`)}
                    onEmployerSaved={code => save(allTasks, `${t.label}: employer code ${code ? `set to ${code}` : 'cleared'} (saved on the client)`)} />
                )}
              </div>
              {editable && arranging ? (
                <span className="flex shrink-0 items-center">
                  <button type="button" className={iconBtn} disabled={busy || i === 0} onClick={() => move(t, -1)} aria-label={`Move ${t.label} up`}><ArrowUp className="h-4 w-4" /></button>
                  <button type="button" className={iconBtn} disabled={busy || i === tasks.length - 1} onClick={() => move(t, 1)} aria-label={`Move ${t.label} down`}><ArrowDown className="h-4 w-4" /></button>
                  <button type="button" className={`${iconBtn} hover:text-danger`} disabled={busy} onClick={() => remove(t)} aria-label={`Remove ${t.label}`}><Trash2 className="h-4 w-4" /></button>
                </span>
              ) : editable && (
                t.done
                  ? <button type="button" disabled={busy} className={`${btnSecondary} shrink-0 py-1.5`} onClick={() => (notNeeded(t) ? answerNeeded(t, true) : undo(t))}><Undo2 className="h-3.5 w-3.5" /> {notNeeded(t) ? 'It is needed' : 'Undo'}</button>
                  : !(hasFiles(t) && !filesOf(t).length) && t.kind !== 'materials' && !(asksNeeded(t) && t.needed === undefined) && t.id !== 'training_report' &&
                    <button type="button" disabled={busy} className={`${btnSecondary} shrink-0 py-1.5`} onClick={() => markDone(t)}><Check className="h-3.5 w-3.5" /> Done</button>
              )}
            </div>

            {!arranging && (
              <div className="pl-8">
                {/* "Needed for this training?" */}
                {asksNeeded(t) && editable && !t.done && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">Needed for this training?</span>
                    {([true, false] as const).map(yes => (
                      <button key={String(yes)} type="button" disabled={busy} aria-pressed={t.needed === yes} onClick={() => answerNeeded(t, yes)}
                        className={`rounded-lg border px-3 py-1 text-sm font-semibold ${t.needed === yes ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-white text-ink-soft hover:bg-surface'}`}>{yes ? 'Yes' : 'No'}</button>
                    ))}
                  </div>
                )}

                {editable && !t.done && t.kind !== 'basic' && (
                  <TaskFields t={t} days={days} busy={busy} venues={venues} trainers={trainers} quotes={quotes} programmeId={deal.programmeId} viewer={viewer}
                    onPatch={(c, a) => patch(t.id, c, a)} />
                )}

                {/* Files: the drop box steps (attendance, QR, JD14...), plus documents on venue, bus, facilitator and the trainer's PO */}
                {hasFiles(t) && (
                  <StepFiles dealId={deal.id} task={t} files={filesOf(t)} viewer={viewer} editable={editable}
                    onUploaded={list => fileUploaded(t, list)} onLastRemoved={() => lastFileRemoved(t)}
                    onPicked={t.id === 'attendance' && t3Shown ? files => setNameList({ files, at: Date.now() }) : undefined} />
                )}
                {/* HRDC deals: HR's name list fills the T3 attendance form (T3Maker.tsx) */}
                {t.id === 'attendance' && t3Shown && <T3Maker deal={deal} saved={t3} viewer={viewer} incoming={nameList} />}
                {DOCS_WORD[t.kind] && ((t.kind === 'trainer' && !asksNeeded(t)) || t.needed === true) && (
                  <div className="mt-2">
                    <p className="text-sm font-semibold">{t.kind === 'trainer' ? 'PO' : 'Documents'}</p>
                    <StepFiles dealId={deal.id} task={t} files={filesOf(t)} viewer={viewer} editable={editable} what={DOCS_WORD[t.kind]} ticks={false}
                      onUploaded={list => fileUploaded(t, list)} onLastRemoved={() => lastFileRemoved(t)} />
                    {/* Trainer PO as a PDF, made from the deal and the fee line(s) below (2026-10-21) */}
                    {t.kind === 'trainer' && money && (() => {
                      const tr = t.trainerId ? trainers.find(x => x.id === t.trainerId) || null : null;
                      return <MakePoButton deal={deal} task={t} trainer={tr} venueName={effectiveVenue(allTasks.find(x => x.kind === 'venue'), quotes, venues)?.name || ''}
                        outs={outs} vendor={vendorForTrainer(vendors, t.trainerId) || null} viewer={viewer} onSaved={list => fileUploaded(t, list)} />;
                    })()}
                  </div>
                )}

                {t.kind === 'materials' && (
                  <MaterialsList t={t} busy={busy} editable={editable} onChange={(items, action) => setItems(t, items, action)} />
                )}

                {editable && !t.done && t.kind === 'basic' && (
                  <TaskFields t={t} days={days} busy={busy} venues={venues} trainers={trainers} quotes={quotes} programmeId={deal.programmeId} viewer={viewer}
                    onPatch={(c, a) => patch(t.id, c, a)} />
                )}

                {money && hasCosts(t) && !notNeeded(t) && (t.needed === true || !asksNeeded(t)) && (
                  <StepCosts deal={deal} task={t} viewer={viewer} outs={outs} receipts={receipts} vendors={vendors} trainers={trainers} venues={venues} hint={hintFor(t)} />
                )}
                {/* Blocked dates (2026-10-21): warn when the trainer is already booked on these dates */}
                {t.kind === 'trainer' && editable && (() => {
                  const tr = effectiveTrainer(t, quotes, trainers);
                  return tr?.id ? <TrainerClash deal={deal} trainerId={tr.id} trainerName={tr.name} /> : null;
                })()}
                {/* Training report (2026-10-21): written in the trainer portal or here, checked, PDF for HR */}
                {t.id === 'training_report' && (() => {
                  const trainerTask = leadTrainerTask(allTasks);
                  const tr = effectiveTrainer(trainerTask, quotes, trainers);
                  const outputFiles = files.filter(f => f.taskId === 'output_assessment').map(f => f.name);
                  return (
                    <TrainingReportBox deal={deal} viewer={viewer} trainerId={tr?.id || ''} trainerName={tr?.name || 'The trainer'}
                      header={{ programme: deal.courseName || '', client: deal.client || '', dates: trainingDateText(deal, true), venue: effectiveVenue(allTasks.find(x => x.kind === 'venue'), quotes, venues)?.name || '', trainer: tr?.name || '', grantNumber: approvalCodeOf(allTasks) }}
                      names={(t3?.trainees || []).map((x: any) => String(x?.name || '').trim()).filter(Boolean)} outputFiles={outputFiles}
                      onChecked={() => { if (!t.done) patch(t.id, doneBy(), `${t.label}: checked, done`); }}
                      onReopened={() => { if (t.done) patch(t.id, openAgain, `${t.label}: reopened`); }} />
                  );
                })()}
                {/* Trainer portal (2026-10-21): rating, PO accepted or declined, the trainer's fee request */}
                {t.kind === 'trainer' && t.trainerId && (
                  <TrainerJobBox deal={deal} task={t} trainerName={effectiveTrainer(t, quotes, trainers)?.name || 'The trainer'} viewer={viewer} outs={outs} />
                )}
                {editable && isCoTrainer(t) && t.needed === true && t.id === coTasks[coTasks.length - 1]?.id && (
                  <button type="button" disabled={busy} onClick={addCoTrainer} className={`${btnSecondary} mt-3 py-1.5`}><Plus className="h-3.5 w-3.5" /> Add another co-trainer</button>
                )}
              </div>
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
                <input value={newTask} onChange={e => setNewTask(e.target.value)} className={input} placeholder={part === 'after' ? 'Add an after-training step for this deal only' : 'Add a step for this deal only'} aria-label="New step for this deal" />
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

// 1. Quotation: ticked by itself (Joel, 2026-10-20). A deal is won only after its quotation, so this is a reminder
// of which quotation it was, not a step to do. Not counted in "X of Y".
function QuotationRow({ quotes, onOpenQuotations, onCreateQuotation }: { quotes: any[]; onOpenQuotations?: () => void; onCreateQuotation?: () => void }) {
  const sent = quotes.filter(q => q.status === 'sent');
  const list = sent.length ? sent : quotes;
  return (
    <li className={`rounded-xl border px-3.5 py-3 ${quotes.length ? 'border-accent/25 bg-accent-soft/50' : 'border-line bg-white'}`}>
      <div className="flex items-start gap-3">
        {quotes.length ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-accent" /> : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-ink-soft/50" />}
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Quotation <span className="ml-1 rounded bg-surface px-1.5 py-0.5 text-xs font-medium text-ink-soft">Ticks itself</span></p>
          <p className="text-sm text-ink-soft">
            {quotes.length ? `${list.map(q => q.refNumber || q.id).join(', ')}${sent.length ? ` · sent ${formatDate(String(sent[0].sentAt || '').slice(0, 10))}` : ' · draft'}` : 'No quotation linked to this deal yet'}
          </p>
        </div>
        {quotes.length > 0 && onOpenQuotations && <button type="button" className={`${btnSecondary} shrink-0 py-1.5`} onClick={onOpenQuotations}><FileText className="h-3.5 w-3.5" /> Open</button>}
        {!quotes.length && onCreateQuotation && <button type="button" className={`${btnSecondary} shrink-0 py-1.5`} onClick={onCreateQuotation}><Plus className="h-3.5 w-3.5" /> Create</button>}
      </div>
    </li>
  );
}

// 9. Materials: T-shirt, Banner, Print-out to start with; add, tick and remove lines.
function MaterialsList({ t, busy, editable, onChange }: { t: ChecklistTask; busy: boolean; editable: boolean; onChange: (items: MaterialItem[], action: string) => void }) {
  const items = materialItems(t);
  const [text, setText] = useState('');
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const label = text.trim();
    if (!label) return;
    setText('');
    onChange([...items, { id: `m_${Date.now().toString(36)}`, label, done: false }], `"${label}" added to the list`);
  };
  return (
    <div className="mt-2 space-y-2">
      <ul className="divide-y divide-line rounded-lg border border-line bg-white">
        {items.length === 0 && <li className="px-3 py-2 text-sm text-ink-soft">No items yet.</li>}
        {items.map(i => (
          <li key={i.id} className="flex items-center gap-2 px-3 py-1.5">
            <label className="flex min-w-0 flex-1 items-center gap-2 text-[15px]">
              <input type="checkbox" disabled={!editable || busy} checked={i.done} className="h-4 w-4 accent-[#0E6E62]"
                onChange={e => onChange(items.map(x => (x.id === i.id ? { ...x, done: e.target.checked, at: e.target.checked ? todayIso() : '' } : x)), `${i.label} ${e.target.checked ? 'ticked' : 'unticked'}`)} />
              <span className={`truncate ${i.done ? 'text-ink-soft line-through' : ''}`}>{i.label}</span>
            </label>
            {editable && (
              <button type="button" disabled={busy} onClick={() => onChange(items.filter(x => x.id !== i.id), `"${i.label}" removed from the list`)}
                className="rounded-md p-1 text-ink-soft hover:bg-danger-soft hover:text-danger" aria-label={`Remove ${i.label}`}><X className="h-4 w-4" /></button>
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <form onSubmit={add} className="flex gap-2">
          <input value={text} onChange={e => setText(e.target.value)} className={input} placeholder="Add an item, e.g. Lanyards" aria-label="New materials item" />
          <button type="submit" disabled={busy || !text.trim()} className={btnSecondary}><Plus className="h-4 w-4" /> Add</button>
        </form>
      )}
    </div>
  );
}

// One line of detail under each task title.
function TaskSummary({ t, days, venues, trainers, quotes, withNote }: { t: ChecklistTask; days: string[]; venues: any[]; trainers: any[]; quotes: any[]; withNote: boolean }) {
  const bits: string[] = [];
  const fromQuote = (p: Picked) => (p.from === 'quotation' ? ' (from quotation)' : '');
  const venue = t.kind === 'venue' && !notNeeded(t) ? effectiveVenue(t, quotes, venues) : null;
  if (venue) bits.push(`${venue.name}${fromQuote(venue)}`);
  if (t.kind === 'bus' && t.needed && Number(t.busCount) > 0) bits.push(`${t.busCount} bus${Number(t.busCount) === 1 ? '' : 'es'}${Number(t.busSeats) > 0 ? ` × ${t.busSeats} seats` : ''}`);
  if (t.kind === 'facilitator' && t.needed && Number(t.facilitatorCount) > 0) bits.push(`${t.facilitatorCount} facilitator${Number(t.facilitatorCount) === 1 ? '' : 's'}`);
  const fd = facilitatorDaysOf(t, days);
  if (t.kind === 'facilitator' && t.needed && days.length > 1) bits.push(fd.length ? `on ${fd.map(shortDay).join(', ')}` : 'every day');
  if (asksNeeded(t) && t.needed === undefined) bits.push('Needed? Not answered yet');
  const trainer = t.kind === 'trainer' ? effectiveTrainer(t, quotes, trainers) : null;
  if (trainer) bits.push(`${trainer.name}${fromQuote(trainer)}`);
  if (t.kind === 'materials') { const items = materialItems(t); bits.push(`${items.filter(i => i.done).length} of ${items.length} ticked`); }
  if (withNote && t.note) bits.push(t.note);
  if (!bits.length) return null;
  return <p className="text-sm text-ink-soft">{bits.join(' · ')}</p>;
}

// Venue or trainer on the checklist: starts with the quotation's, and can be picked from the list or typed.
// A pick from the list saves at once; typed text saves when you leave the box. Clearing it goes back to the quotation's.
function ChosenBox({ id, busy, options, picked, fromQuote, what, onSave }: {
  id: string; busy: boolean; options: { id: string; name: string; hint?: string }[];
  picked: Picked | null; fromQuote: Picked | null; what: 'venue' | 'trainer';
  onSave: (v: { id: string; text: string }, action: string) => void;
}) {
  const [v, setV] = useState({ id: picked?.id || '', text: picked?.name || '' });
  useEffect(() => setV({ id: picked?.id || '', text: picked?.name || '' }), [picked?.id, picked?.name, picked?.from]);
  const unchanged = v.id === (picked?.id || '') && v.text.trim() === (picked?.name || '');

  const change = (next: { id: string; text: string }) => {
    setV(next);
    if (next.id && next.id !== picked?.id) onSave(next, `${what} chosen`);
  };
  const leave = () => {
    if (unchanged || v.id) return;
    if (!v.text.trim()) { if (picked?.from === 'checklist') onSave({ id: '', text: '' }, `set back to the quotation's ${what}`); return; }
    onSave({ id: '', text: v.text.trim() }, `${what} typed`);
  };

  return (
    <div>
      <PickOrType id={id} options={options} linkedId={v.id} text={v.text} onChange={change} onBlur={leave} disabled={busy}
        placeholder={`Pick from the ${what} list or type one`} className={input}
        note={unchanged && picked?.from === 'quotation' ? 'From quotation' : undefined} />
      {picked?.from === 'checklist' && fromQuote && fromQuote.name !== picked.name && (
        <button type="button" disabled={busy} className="mt-1 text-xs font-semibold text-accent hover:underline"
          onClick={() => onSave({ id: '', text: '' }, `set back to the quotation's ${what}`)}>
          Use the quotation's {what} ({fromQuote.name})
        </button>
      )}
    </div>
  );
}

// Facilitator days (2026-10-22): the ticked days still in the training (a date change can move it). None = every day.
const facilitatorDaysOf = (t: ChecklistTask, days: string[]) => (t.facilitatorDays || []).filter(d => days.includes(d)).sort();
const shortDay = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }); };

// A number box that saves when you leave it.
function NumberBox({ id, label, value, busy, onSave }: { id: string; label: string; value?: number; busy: boolean; onSave: (n: number) => void }) {
  const [v, setV] = useState(value ? String(value) : '');
  useEffect(() => setV(value ? String(value) : ''), [value]);
  return (
    <div>
      <label className={small} htmlFor={id}>{label}</label>
      <input id={id} inputMode="numeric" disabled={busy} value={v} onChange={e => setV(e.target.value.replace(/[^0-9]/g, ''))}
        onBlur={() => Number(v || 0) !== Number(value || 0) && onSave(Number(v || 0))} className={input} />
    </div>
  );
}

// The inputs each kind of task needs before it can be ticked.
function TaskFields({ t, days, busy, venues, trainers, quotes, onPatch, programmeId, viewer }: {
  t: ChecklistTask; days: string[]; busy: boolean; venues: any[]; trainers: any[]; quotes: any[]; programmeId?: string; viewer: Viewer;
  onPatch: (c: Partial<ChecklistTask>, action: string) => void;
}) {
  const [note, setNote] = useState(t.note || '');
  useEffect(() => setNote(t.note || ''), [t.note]);
  const waiting = asksNeeded(t) && t.needed !== true;   // not answered yet (No = done, so not here)

  return (
    <div className="mt-3 space-y-3">
      {t.kind === 'venue' && !waiting && (
        <div>
          <label className={small} htmlFor={`v-${t.id}`}>Venue</label>
          <ChosenBox id={`v-${t.id}`} busy={busy} options={nameOptions(venues)} picked={effectiveVenue(t, quotes, venues)}
            fromQuote={effectiveVenue(undefined, quotes, venues)} what="venue"
            onSave={(v, action) => onPatch({ venueId: v.id, venueName: v.text }, `${t.label}: ${action}`)} />
          {(() => {
            const picked = effectiveVenue(t, quotes, venues);
            return picked && !picked.id && !busy ? (
              <SaveVenueButton name={picked.name} venues={venues} by={viewer}
                onSaved={(id, name) => onPatch({ venueId: id, venueName: name }, `${t.label}: saved "${name}" to Venues`)} />
            ) : null;
          })()}
        </div>
      )}
      {t.kind === 'bus' && !waiting && (
        <div className="grid gap-3 sm:grid-cols-2">
          <NumberBox id={`bc-${t.id}`} label="How many buses" value={t.busCount} busy={busy} onSave={n => onPatch({ busCount: n }, `${t.label}: ${n} bus${n === 1 ? '' : 'es'}`)} />
          <NumberBox id={`bs-${t.id}`} label="Seats per bus" value={t.busSeats} busy={busy} onSave={n => onPatch({ busSeats: n }, `${t.label}: ${n} seats per bus`)} />
        </div>
      )}
      {t.kind === 'facilitator' && !waiting && (
        <div className="space-y-3">
          <div className="sm:w-1/2">
            <NumberBox id={`fc-${t.id}`} label="How many facilitators (pax)" value={t.facilitatorCount} busy={busy} onSave={n => onPatch({ facilitatorCount: n }, `${t.label}: ${n} facilitator${n === 1 ? '' : 's'}`)} />
          </div>
          {days.length > 1 && (() => {
            const on = facilitatorDaysOf(t, days);
            const toggle = (d: string) => {
              const next = on.includes(d) ? on.filter(x => x !== d) : [...on, d].sort();
              const all = !next.length || next.length === days.length;
              onPatch({ facilitatorDays: all ? [] : next }, `${t.label}: ${all ? 'every day' : `on ${next.map(shortDay).join(', ')}`}`);
            };
            return (
              <div>
                <p className={small}>Which days? <span className="font-normal">(none ticked = every day)</span></p>
                <div className="flex flex-wrap gap-2">
                  {days.map(d => (
                    <button key={d} type="button" disabled={busy} aria-pressed={on.includes(d)} onClick={() => toggle(d)}
                      className={`rounded-lg border px-3 py-1 text-sm font-semibold ${on.includes(d) ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-white text-ink-soft hover:bg-surface'}`}>{shortDay(d)}</button>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      )}
      {t.kind === 'trainer' && !waiting && (
        <div>
          <label className={small} htmlFor={`tr-${t.id}`}>{isCoTrainer(t) ? 'Co-trainer' : 'Trainer'}</label>
          <ChosenBox id={`tr-${t.id}`} busy={busy} options={trainerOptions(trainers, programmeId)} picked={effectiveTrainer(t, quotes, trainers)}
            fromQuote={isCoTrainer(t) ? null : effectiveTrainer(undefined, quotes, trainers)} what="trainer"
            onSave={(v, action) => onPatch({ trainerId: v.id, trainerName: v.text }, `${t.label}: ${action}`)} />
        </div>
      )}
      {!waiting && (
        <input disabled={busy} value={note} onChange={e => setNote(e.target.value)} onBlur={() => note.trim() !== (t.note || '') && onPatch({ note: note.trim() }, `${t.label}: note updated`)}
          className={input} placeholder="Note (optional)" aria-label={`Note for ${t.label}`} />
      )}
    </div>
  );
}

// HRDC codes (Joel, 2026-10-23), typed on the Grant approved step by Admin or Management and read wherever HRDC needs
// them (the HRDC claim, Payment tracking, the training report for HR, search). The Employer code is the client's own
// HRD Corp code, so it lives on the client and is filled in for its next deals; the Approval code is this deal's.
// Required to tick Grant approved since 2026-10-23 (Joel); on older ticked steps a missing one is a reminder. Reps and the After training section see them read-only.
export function useClient(clientId?: string) {
  const [client, setClient] = useState<any | null>(null);
  useEffect(() => {
    if (!clientId) { setClient(null); return; }
    return onSnapshot(doc(db, 'clients', clientId), s => setClient(s.exists() ? { ...s.data(), id: s.id } : null), () => setClient(null));
  }, [clientId]);
  return client;
}

export function HrdcCodes({ deal, tasks, editable, busy = false, onApproval, onEmployerSaved }: {
  deal: any; tasks: ChecklistTask[] | undefined; editable: boolean; busy?: boolean;
  onApproval?: (code: string) => void; onEmployerSaved?: (code: string) => void;
}) {
  const client = useClient(deal.clientId);
  const [error, setError] = useState('');
  if (!isHrdc(deal.fundingType)) return null;
  const employer = String(client?.employerCode || '').trim();
  const approval = approvalCodeOf(tasks);
  const grantDone = !!(tasks || []).find(t => t.kind === 'grant')?.done;
  const missing = [!employer && 'Employer code', !approval && 'Approval code'].filter(Boolean).join(' and ');

  if (!editable || !onApproval) {
    return (
      <p className="mt-1 text-sm text-ink-soft">
        Employer code <strong className="font-mono text-ink">{employer || '—'}</strong> · Approval code <strong className="font-mono text-ink">{approval || '—'}</strong>
        {missing && grantDone && <span className="text-attention"> · {missing} not filled in on Grant approved yet</span>}
      </p>
    );
  }

  const saveEmployer = async (code: string) => {
    if (!client) return setError('Pick the client from the client list on the deal first: the employer code is kept on the client.');
    setError('');
    try {
      await updateDoc(doc(db, 'clients', client.id), { employerCode: code });
      onEmployerSaved?.(code);
    } catch (err) {
      setError(friendlyError(err));
    }
  };
  return (
    <div className="mt-3 space-y-2">
      <div className="grid gap-3 sm:grid-cols-2">
        <CodeBox id={`emp-${deal.id}`} label="Employer code" hint={client ? `Kept on ${client.companyName || 'the client'} for its next deals` : 'Kept on the client'}
          value={employer} busy={busy} onSave={saveEmployer} />
        <CodeBox id={`apc-${deal.id}`} label="Approval code" hint="HRDC's approval for this training" value={approval} busy={busy} onSave={onApproval} />
      </div>
      {missing && grantDone && <p className="text-sm font-semibold text-attention">Fill in the {missing}: the HRDC claim needs {missing.includes(' and ') ? 'them' : 'it'}.</p>}
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
    </div>
  );
}

// A code typed in a box, saved when you leave it or press Enter.
function CodeBox({ id, label, hint, value, busy, onSave }: { id: string; label: string; hint: string; value: string; busy: boolean; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => { const next = v.trim(); if (next !== value) onSave(next); };
  return (
    <div>
      <label className={small} htmlFor={id}>{label} <span className="font-normal">({hint})</span></label>
      <input id={id} value={v} disabled={busy} onChange={e => setV(e.target.value)} onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }} className={`${input} font-mono`} />
    </div>
  );
}
