// Training report on the deal (2026-10-21; lib/trainingReport.ts): the box on the after-training "Training report"
// step, and the panel where Admin or Management read, fix or write the report (for a trainer without portal access),
// type the participants' rating from the Output assessment, send it back or mark it checked, and save HR's PDF.
// Marking it checked ticks the step; reopening it unticks it. Management ticks which sections HR sees and sends HR
// the PDF or a link (/r/<token>); the trainer's changes after sending are listed with date and time (2026-10-21).
// 2026-10-27: the questions follow Management's settings (lib/reportSettings.ts); two copies, HR's and the head of
// department's (HOD), each with its own ticks and PDF; a 30-day check-in link for the HOD (serverReportCheckin.ts).

import React, { useEffect, useState } from 'react';
import { collection, doc, getDoc, getDocs, onSnapshot, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { CheckCircle2, Copy, Download, FileText, Link2, Loader2, Lock, Plus, Undo2, X } from 'lucide-react';
import { callServer, db, friendlyError } from '../lib/firebase';
import { formatDate, todayIso, trainingDays, trainingEndDate } from '../lib/deals';
import { linkedOnly } from '../lib/linked';
import {
  ReportPhoto, SERVER_KEYS, STATUS_TEXT, TRAINER_KEYS, TrainingReport, cleanParticipant, copyOf, dealPax, newReport, outlineTopics, reportDates, reportGaps, revisionWhen, withDates, withPax,
} from '../lib/trainingReport';
import { CopyKey, CopyKind, ReportSettings, answerText, checkinQuestions, emptySettings, onCopy, readReportSettings, sectionsOf } from '../lib/reportSettings';
import { autoSaveText, leaveAfterSave, useAutoSave } from '../lib/useAutoSave';
import { jobId } from '../lib/trainerPortal';
import PanelResizer from './PanelResizer';
import TrainingReportForm, { RevisionList } from './TrainingReportForm';
import DocLinkBox, { openLinkOf, useDocLinks } from './DocLinkBox';
import type { ReportHeader } from './TrainingReportDocument';

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };

const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';
const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';

const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const plusDays = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const nowIso = () => new Date().toISOString();

export function useTrainingReport(dealId: string): TrainingReport | null | undefined {
  const [r, setR] = useState<TrainingReport | null | undefined>(undefined);
  useEffect(() => onSnapshot(doc(db, 'training_reports', dealId), s => setR(s.exists() ? (s.data() as TrainingReport) : null), () => setR(null)), [dealId]);
  return r;
}

// Management's training report settings (config/training_report, 2026-10-27); the defaults until it loads.
export function useReportSettings(): ReportSettings {
  const [s, setS] = useState<ReportSettings>(emptySettings);
  useEffect(() => onSnapshot(doc(db, 'config', 'training_report'), x => setS(readReportSettings(x.data())), () => setS(emptySettings())), []);
  return s;
}

// Every report (Admin work's red flag: a report waiting to be checked).
export function useTrainingReports(enabled = true): TrainingReport[] {
  const [list, setList] = useState<TrainingReport[]>([]);
  useEffect(() => {
    if (!enabled) { setList([]); return; }
    return onSnapshot(collection(db, 'training_reports'), s => setList(s.docs.map(d => ({ ...(d.data() as TrainingReport), dealId: d.id }))), () => setList([]));
  }, [enabled]);
  return list;
}

// Tick or untick the deal's "Training report" step from outside the deal (the Training reports list on Trainers).
export async function setReportStep(dealId: string, viewer: Viewer, done: boolean) {
  const ref = doc(db, 'deal_checklists', dealId);
  const cl: any = (await getDoc(ref)).data();
  const t = (cl?.tasks || []).find((x: any) => x.id === 'training_report');
  if (!t || !!t.done === done) return;
  const changes = done ? { done: true, doneAt: todayIso(), doneById: viewer.id, doneByName: viewer.name } : { done: false, doneAt: '', doneById: '', doneByName: '' };
  await updateDoc(ref, {
    tasks: clean(cl.tasks.map((x: any) => (x.id === t.id ? { ...x, ...changes } : x))),
    updatedAt: Date.now(),
    history: [...(cl.history || []), { at: nowIso(), byId: viewer.id, byName: viewer.name, action: `${t.label}: ${done ? 'checked, done' : 'reopened'}` }].slice(-60),
  });
}

// HR's copy or the head of department's (2026-10-27): only the sections ticked for that copy.
export async function savePdf(r: TrainingReport, h: ReportHeader, settings: ReportSettings, copy: CopyKind = 'hr') {
  const [{ default: TrainingReportDocument }, { makeDocumentPdf }] = await Promise.all([import('./TrainingReportDocument'), import('../lib/quotePdf')]);
  const blob = await makeDocumentPdf(React.createElement(TrainingReportDocument, { r: copyOf(r, settings, copy), h }), `Training report ${h.programme}`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Training report${copy === 'hod' ? ' for HOD' : ''} - ${[h.programme, h.client].filter(Boolean).join(' - ').replace(/[\\/:*?"<>|]/g, '')}.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** The box on the "Training report" step. */
export function TrainingReportBox({ deal, viewer, trainerId, trainerName, internalIds = [], header, names, outputFiles, onChecked, onReopened }: {
  deal: any;
  viewer: Viewer;
  trainerId: string;               // the trainer picked on the Trainer step ('' if none yet)
  trainerName: string;
  internalIds?: string[];          // trainer records linked to a team member (internal trainers write their own report)
  header: ReportHeader;
  names: string[];                 // the T3 participants list
  outputFiles: string[];           // names of the files on the Output assessment step
  onChecked: () => void;           // tick the step
  onReopened: () => void;          // untick it
}) {
  const r = useTrainingReport(deal.id);
  const settings = useReportSettings();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const staff = viewer.role !== 'rep';
  const started = String(deal.trainingDate || '').slice(0, 10) <= todayIso();
  const ended = !!trainingEndDate(deal) && trainingEndDate(deal) < todayIso();
  if (r === undefined) return null;
  const internal = internalIds.includes(r?.trainerId || trainerId);

  const pdf = async (copy: CopyKind) => {
    if (!r) return;
    setBusy(true); setError('');
    try { await savePdf(withPax(r, dealPax(deal)), header, settings, copy); } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };

  return (
    <div className="mt-2 rounded-xl border border-line bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          {r ? (
            <>
              <span className={`mr-2 rounded-full px-2 py-0.5 text-xs font-semibold ${r.status === 'checked' ? 'bg-accent-soft text-accent' : r.status === 'submitted' ? 'bg-attention-soft text-ink' : 'bg-surface text-ink-soft'}`}>{STATUS_TEXT[r.status]}</span>
              {r.submittedAt && r.status !== 'draft' && <span className="text-ink-soft">Sent {formatDate(r.submittedAt.slice(0, 10))} by {r.trainerName || trainerName}</span>}
              {r.status === 'checked' && r.checkedByName && <span className="text-ink-soft">. Checked by {r.checkedByName}</span>}
              {r.revisions?.length ? <span className="text-ink-soft">. Changed {r.revisions.length} time{r.revisions.length === 1 ? '' : 's'} after sending</span> : null}
            </>
          ) : (
            <span className="text-ink-soft">
              No report yet. {!trainerId ? 'Pick the trainer on the Trainer step first.'
                : internal ? `${trainerName} writes it in My trainings from the first training day (only they can write it).`
                : `${trainerName} can write it in the trainer portal from the first training day${staff ? ', or you can write it here.' : '.'}`}
            </span>
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          {staff && (r || (started && trainerId && !internal)) && (
            <button type="button" className={r?.status === 'submitted' ? btnPrimary : btnSecondary} onClick={() => setOpen(true)}>
              <FileText className="h-4 w-4" /> {!r ? 'Write the report' : r.status === 'submitted' ? 'Check the report' : 'Open the report'}
            </button>
          )}
          {!staff && r && <button type="button" className={btnSecondary} onClick={() => setOpen(true)}><FileText className="h-4 w-4" /> View the report</button>}
          {r && r.status === 'checked' && (['hr', 'hod'] as CopyKind[]).map(c => (
            <button key={c} type="button" className={btnSecondary} disabled={busy} onClick={() => pdf(c)}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} PDF for {c === 'hr' ? 'HR' : 'HOD'}</button>
          ))}
        </div>
      </div>
      {!r && ended && trainerId && <p className="mt-1 text-sm font-semibold text-attention">The training has ended: waiting for {trainerName}'s report.</p>}
      {error && <p role="alert" className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {open && (
        <ReportPanel deal={deal} viewer={viewer} saved={r} trainerId={r?.trainerId || trainerId} trainerName={r?.trainerName || trainerName} internal={internal} header={header}
          names={names} outputFiles={outputFiles} onClose={() => setOpen(false)} onChecked={onChecked} onReopened={onReopened} />
      )}
    </div>
  );
}

export function ReportPanel({ deal, viewer, saved, trainerId, trainerName, internal = false, header, names, outputFiles, onClose, onChecked, onReopened }: {
  deal: any; viewer: Viewer; saved: TrainingReport | null; trainerId: string; trainerName: string; internal?: boolean; header: ReportHeader;
  names: string[]; outputFiles: string[]; onClose: () => void; onChecked: () => void; onReopened: () => void;
}) {
  const staff = viewer.role !== 'rep';
  const isManager = viewer.role === 'management';
  const settings = useReportSettings();
  const dates = reportDates(String(deal.trainingDate || '').slice(0, 10), trainingDays(deal));
  const pax = dealPax(deal);   // the deal's Participants (2026-10-21)
  const [report, setReport] = useState<TrainingReport | null>(saved ? withPax(withDates(clean({ ...newReport(deal.id, trainerId, trainerName, { dates, objectives: [], names, pax }), ...saved }), dates), pax) : null);
  const [savedJson, setSavedJson] = useState(() => (report && saved ? JSON.stringify(report) : ''));
  const [programmes, setProgrammes] = useState<{ id: string; name: string }[]>([]);
  const [claimPhotos, setClaimPhotos] = useState<ReportPhoto[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [returning, setReturning] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    getDocs(collection(db, 'programmes')).then(s => setProgrammes(s.docs.map(d => ({ id: d.id, name: String(d.data().name || '').trim() })).filter(p => p.name).sort((a, b) => a.name.localeCompare(b.name)))).catch(() => {});
    if (trainerId) getDocs(query(collection(db, 'trainer_jobs'), where('dealId', '==', deal.id))).then(s => {
      const job: any = s.docs.find(d => d.id === jobId(deal.id, trainerId))?.data();
      setClaimPhotos((job?.claim?.photos || []) as ReportPhoto[]);
    }).catch(() => {});
    // A new report starts from the deal: the course outline's objectives (the sent one first) and the T3 names.
    if (!saved) getDocs(query(collection(db, 'course_outlines'), where('pipelineId', '==', deal.id))).then(s => {
      const outlines = linkedOnly(s.docs.map(d => ({ ...(d.data() as any), id: d.id })))
        .sort((a: any, b: any) => Number(b.status === 'sent') - Number(a.status === 'sent') || String(b.sentAt || b.date || '').localeCompare(String(a.sentAt || a.date || '')));
      const objectives = ((outlines[0] as any)?.outcomes || []).map((x: any) => String(x || '').trim()).filter(Boolean);
      const fresh = newReport(deal.id, trainerId, trainerName, { dates, objectives, names, pax, topics: outlineTopics(outlines[0]) });
      setReport(fresh);
      setSavedJson(JSON.stringify(fresh));   // nothing is saved until someone types
    }).catch(e => setError(friendlyError(e)));
  }, [deal.id]);

  const locked = !staff || report?.status === 'checked';
  // An internal trainer's own part is theirs alone (Joel, 2026-10-25): the team checks it, sends it back, adds the
  // participants' rating and picks HR's sections, but never writes it.
  const partLocked = locked || internal;
  const json = report ? JSON.stringify(report) : '';
  const dirty = !!report && json !== savedJson;
  // Merged, so the trainer's changes not sent yet and their change list (kept by the server) are never overwritten.
  // The deal details are saved with it for HR's link.
  const write = async (v: TrainingReport | null) => {
    if (!v) return;
    // Never the server's own fields (the trainer's draft and changes, the HOD's check-in).
    const all = Object.fromEntries(Object.entries(v).filter(([k]) => !(SERVER_KEYS as readonly string[]).includes(k)));
    const rest = internal ? Object.fromEntries(Object.entries(all).filter(([k]) => !(TRAINER_KEYS as readonly string[]).includes(k))) : all;
    await setDoc(doc(db, 'training_reports', deal.id), clean({ ...rest, hrHeader: header, updatedAt: nowIso(), updatedByName: viewer.name }), { merge: true });
  };
  const { state, flush } = useAutoSave({ value: report, dirty, enabled: !!report && !locked, write, onSaved: setSavedJson });
  const close = () => leaveAfterSave(flush, onClose);
  const line = autoSaveText(state, dirty, locked);

  // Status changes: saved at once with what's on screen.
  const act = async (key: string, changes: Partial<TrainingReport>, action: string, after?: () => void) => {
    if (!report) return;
    setBusy(key); setError('');
    try {
      const next = { ...report, ...changes, history: [...(report.history || []), { at: nowIso(), byName: viewer.name, action }].slice(-30) };
      await write(next);
      setReport(next); setSavedJson(JSON.stringify(next));
      after?.();
    } catch (e) { setError(friendlyError(e)); } finally { setBusy(''); }
  };
  const markChecked = () => {
    if (!report) return;
    const gaps = reportGaps(report, settings);
    if (gaps.length && !window.confirm(`Still missing: ${gaps.join(', ')}. Mark it checked anyway?`)) return;
    act('check', { status: 'checked', checkedAt: nowIso(), checkedByName: viewer.name, returnNote: '' }, 'Checked, ready for HR', onChecked);
  };
  const sendBack = () => {
    if (!note.trim()) { setError('Say what the trainer should fix.'); return; }
    act('return', { status: 'returned', returnNote: note.trim(), returnedByName: viewer.name }, `Sent back: ${note.trim()}`, () => { setReturning(false); setNote(''); });
  };
  const reopen = () => act('reopen', { status: 'submitted', checkedAt: '', checkedByName: '' }, 'Reopened', onReopened);
  const pdf = async (copy: CopyKind = 'hr') => {
    if (!report) return;
    setBusy(`pdf-${copy}`); setError('');
    try { await flush(); await savePdf(report, header, settings, copy); } catch (e) { setError(friendlyError(e)); } finally { setBusy(''); }
  };

  // Management picks each copy's sections (HR's, the HOD's); on a checked (locked) report the tick is saved at once.
  const setCopy = async (copy: CopyKind, key: CopyKey, on: boolean) => {
    if (!report) return;
    const field = copy === 'hr' ? 'showToHr' : 'showToHod';
    const ticks = { ...(report[field] || {}), [key]: on };
    if (!locked) { setReport({ ...report, [field]: ticks }); return; }
    setBusy('hr'); setError('');
    try {
      await updateDoc(doc(db, 'training_reports', deal.id), { [field]: ticks, updatedAt: nowIso(), updatedByName: viewer.name });
      const next = { ...report, [field]: ticks };
      setReport(next); setSavedJson(JSON.stringify(next));
    } catch (e) { setError(friendlyError(e)); } finally { setBusy(''); }
  };
  // The rows of the copies box: every section that is on, then Management's questions (and answers to removed ones).
  const copyRows: { key: CopyKey; label: string; internal: boolean; answer?: any }[] = report ? [
    ...sectionsOf(settings).filter(x => x.on).map(x => ({ key: x.key as CopyKey, label: x.label, internal: x.group === 'internal' })),
    ...settings.custom.map(q => ({ key: `q:${q.id}` as CopyKey, label: q.label || 'Untitled question', internal: q.internal })),
    ...(report.answers || []).filter(a => !settings.custom.some(q => q.id === a.id)).map(a => ({ key: `q:${a.id}` as CopyKey, label: a.label, internal: a.internal, answer: a })),
  ] : [];

  // The 30-day check-in with the HOD (2026-10-27): Management makes the link; the HOD's answers come back here.
  const checkin = saved?.checkin || null;
  const checkinAnswer = saved?.checkinAnswer || null;
  const checkinUrl = checkin?.token ? `${window.location.origin}/c/${checkin.token}` : '';
  const checkinDue = trainingEndDate(deal) ? plusDays(trainingEndDate(deal), 30) : '';
  const [copied, setCopied] = useState(false);
  const makeCheckin = async () => {
    setBusy('checkin'); setError('');
    try { await callServer('/api/report-checkin/create', { dealId: deal.id }, true); } catch (e) { setError(friendlyError(e)); } finally { setBusy(''); }
  };
  const stopCheckin = async () => {
    if (!window.confirm('Stop this check-in link? The HOD will no longer be able to answer.')) return;
    setBusy('checkin'); setError('');
    try { await callServer('/api/report-checkin/stop', { dealId: deal.id }, true); } catch (e) { setError(friendlyError(e)); } finally { setBusy(''); }
  };
  const copyCheckin = async () => {
    const text = `Dear Sir / Madam, it has been about a month since your team attended ${header.programme || 'our training'}. Could you spare 2 minutes to tell us how they are applying it? ${checkinUrl}`;
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { window.prompt('Copy this message:', text); }
  };

  // HR's link (Management): the report's deal details are saved first, so the link shows them.
  const hrLink = openLinkOf(useDocLinks(deal.id), 'report');
  const makeLink = async () => {
    setBusy('link'); setError('');
    try {
      await updateDoc(doc(db, 'training_reports', deal.id), { hrHeader: clean(header) });
      await callServer('/api/doc-link/create', { kind: 'report', id: deal.id }, true);
    } catch (e) { setError(friendlyError(e)); } finally { setBusy(''); }
  };

  const p = report?.participant || null;
  const setParticipant = (c: Partial<NonNullable<TrainingReport['participant']>>) =>
    report && setReport({ ...report, participant: { avg: 0, responses: 0, note: '', ...(p || {}), ...c, byName: viewer.name, at: nowIso() } });
  const morePhotos = claimPhotos.filter(x => !report?.photos.some(y => y.path === x.path));

  const teamPart = report && (
    <section className="rounded-2xl border border-accent/30 bg-accent-soft/30 p-4 sm:p-5">
      <h3 className="text-base font-bold">Participants' rating</h3>
      <p className="mb-2 text-sm text-ink-soft">
        From the Output assessment{outputFiles.length ? ` (${outputFiles.join(', ')})` : ': no file on the Output assessment step yet'}. Typed by Admin or Management; reading the file by itself comes later.
      </p>
      <div className="grid gap-3 sm:grid-cols-[10rem_10rem_1fr]">
        <div>
          <label className="mb-1 block text-sm font-semibold" htmlFor="rep-avg">Average (out of 5)</label>
          <input id="rep-avg" type="number" min={0} max={5} step={0.1} className={input} disabled={locked} value={p?.avg || ''}
            onChange={e => setParticipant({ avg: cleanParticipant({ avg: e.target.value })?.avg || 0 })} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-semibold" htmlFor="rep-resp">Participants who answered</label>
          <input id="rep-resp" type="number" min={0} className={input} disabled={locked} value={p?.responses || ''}
            onChange={e => setParticipant({ responses: Math.max(0, Math.round(Number(e.target.value) || 0)) })} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-semibold" htmlFor="rep-pnote">Summary of their comments</label>
          <textarea id="rep-pnote" rows={2} className={input} disabled={locked} value={p?.note || ''} onChange={e => setParticipant({ note: e.target.value })} />
        </div>
      </div>
    </section>
  );

  const photos = report && (
    <div className="space-y-3">
      {report.photos.length > 0 ? (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {report.photos.map(ph => (
            <li key={ph.path} className="relative">
              <img src={ph.url} alt="" className="aspect-square w-full rounded-lg object-cover" />
              {!partLocked && <button type="button" className="absolute right-1 top-1 rounded-full bg-white/90 p-1 text-ink-soft hover:text-danger" aria-label={`Take ${ph.name} off the report`}
                onClick={() => setReport({ ...report, photos: report.photos.filter(x => x.path !== ph.path) })}><X className="h-3.5 w-3.5" /></button>}
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-ink-soft">No photos on the report yet.</p>}
      {!partLocked && morePhotos.length > 0 && (
        <div>
          <p className="mb-1 text-sm font-semibold">From the trainer's fee request: click to add</p>
          <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {morePhotos.map(ph => (
              <li key={ph.path}>
                <button type="button" className="relative block w-full" disabled={report.photos.length >= 12} onClick={() => setReport({ ...report, photos: [...report.photos, ph] })} aria-label={`Add ${ph.name}`}>
                  <img src={ph.url} alt="" className="aspect-square w-full rounded-lg object-cover opacity-80 hover:opacity-100" />
                  <Plus className="absolute right-1 top-1 h-4 w-4 rounded-full bg-white text-accent" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" role="dialog" aria-modal="true" aria-label="Training report">
      <PanelResizer />
      <div className="flex h-full w-full flex-col bg-surface shadow-xl md:w-[var(--panel-w,max(50vw,40rem))] md:min-w-[24rem] md:max-w-[95vw]">
        <div className="flex items-start justify-between gap-3 border-b border-line bg-white px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-lg font-bold">Training report</h3>
            <p className="truncate text-sm text-ink-soft">{[header.programme, header.client, header.dates].filter(Boolean).join(' · ')}</p>
            <p className="text-sm text-ink-soft">Trainer: {trainerName || 'not picked yet'}{report ? ` · ${STATUS_TEXT[report.status]}` : ''}</p>
          </div>
          <button type="button" onClick={close} className="rounded-md p-1 text-ink-soft hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {!report && !error && <p className="flex items-center gap-2 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
          {report?.status === 'returned' && <p className="rounded-lg bg-attention-soft px-3 py-2.5 text-sm"><strong>Sent back{report.returnedByName ? ` by ${report.returnedByName}` : ''}:</strong> {report.returnNote}</p>}
          {report?.status === 'checked' && staff && <p className="flex items-center gap-2 rounded-lg bg-accent-soft px-3 py-2.5 text-sm text-accent"><Lock className="h-4 w-4" /> Checked{report.checkedByName ? ` by ${report.checkedByName}` : ''}. Reopen it to make changes.</p>}

          {saved?.trainerDraft && <p className="rounded-lg bg-surface px-3 py-2.5 text-sm text-ink-soft">{trainerName} is changing the report in {internal ? 'My trainings' : 'the trainer portal'}. You'll see the changes once they send them.</p>}
          {internal && staff && <p className="rounded-lg bg-surface px-3 py-2.5 text-sm text-ink-soft">{trainerName} is an internal trainer: only they write this report (in My trainings). You can check it, send it back with a note, and add the participants' rating.</p>}

          {/* Management: which sections go on HR's copy and the HOD's copy (2026-10-27) */}
          {report && staff && (
            <section className="rounded-2xl border border-line bg-white p-4">
              <h3 className="text-base font-bold">On each copy</h3>
              <p className="mb-2 text-sm text-ink-soft">Ticked sections go on HR's copy (PDF and link) and the head of department's copy (HOD). The starting ticks come from the training report settings.{isManager && locked ? ' Changes here are saved at once.' : ''}</p>
              {[{ title: 'Report', rows: copyRows.filter(x => !x.internal) }, { title: 'For NEXT Academy only, unless ticked', rows: copyRows.filter(x => x.internal) }].filter(g => g.rows.length).map(g => (
                <div key={g.title} className="mt-3">
                  <div className="mb-1 grid grid-cols-[1fr_3rem_3rem] items-end gap-2 text-sm font-semibold">
                    <span>{g.title}</span><span className="text-center">HR</span><span className="text-center">HOD</span>
                  </div>
                  <ul className="divide-y divide-line/60">
                    {g.rows.map(x => (
                      <li key={x.key} className="grid grid-cols-[1fr_3rem_3rem] items-center gap-2 py-1.5 text-[15px]">
                        <span className={isManager ? '' : 'text-ink-soft'}>{x.label}</span>
                        {(['hr', 'hod'] as CopyKind[]).map(c => (
                          <span key={c} className="flex justify-center">
                            <input type="checkbox" className="h-4 w-4 accent-[#0E6E62]" aria-label={`${x.label} on the ${c === 'hr' ? "HR's" : "HOD's"} copy`} disabled={!isManager || busy === 'hr'}
                              checked={onCopy(report, c, x.key, settings, x.answer)} onChange={e => setCopy(c, x.key, e.target.checked)} />
                          </span>
                        ))}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {!isManager && <p className="mt-2 text-sm text-ink-soft">Only Management can change these.</p>}
            </section>
          )}

          {/* Send to HR: PDF (Admin or Management), or a client link (Management) */}
          {report?.status === 'checked' && staff && (
            <section className="rounded-2xl border border-accent/30 bg-accent-soft/30 p-4">
              <h3 className="text-base font-bold">Send to HR and the HOD</h3>
              <p className="mb-3 text-sm text-ink-soft">Save the PDF and attach it, or send HR a private link that shows HR's copy (no download or copying). The HOD's copy leaves out the HRDC details and keeps the people and actions.</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={btnSecondary} disabled={!!busy} onClick={() => pdf('hr')}>{busy === 'pdf-hr' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} PDF for HR</button>
                <button type="button" className={btnSecondary} disabled={!!busy} onClick={() => pdf('hod')}>{busy === 'pdf-hod' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} PDF for HOD</button>
                {isManager && !hrLink && <button type="button" className={btnPrimary} disabled={!!busy} onClick={makeLink}>{busy === 'link' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Make the link for HR</button>}
              </div>
              {hrLink && isManager && <div className="mt-3"><DocLinkBox link={hrLink} viewer={viewer} message={`Dear HR, here is the training report for ${[header.programme, header.dates].filter(Boolean).join(', ')}.`} /></div>}
              {hrLink && !isManager && <p className="mt-2 text-sm text-ink-soft">Management has sent HR a link to this report.</p>}
            </section>
          )}

          {/* 30-day check-in with the HOD (2026-10-27) */}
          {report?.status === 'checked' && staff && (
            <section className="rounded-2xl border border-line bg-white p-4">
              <h3 className="text-base font-bold">30-day check-in with the HOD</h3>
              <p className="mb-3 text-sm text-ink-soft">
                About a month after the training, send the participants' head of department a short link: are they using what they learned?
                {checkinDue ? ` Best sent around ${formatDate(checkinDue)}.` : ''} Their answers show here, and a "yes" to more training is a lead for the deal owner.
              </p>
              {checkinAnswer ? (
                <div className="space-y-2 rounded-xl bg-accent-soft/40 p-3 text-[15px]">
                  <p className="text-sm text-ink-soft">Answered by <strong className="text-ink">{checkinAnswer.name}</strong>{checkinAnswer.role ? `, ${checkinAnswer.role}` : ''} · {revisionWhen(checkinAnswer.at)}</p>
                  {checkinAnswer.answers.map(a => <p key={a.id} className="whitespace-pre-line"><strong>{a.label}</strong><br />{answerText(a)}</p>)}
                </div>
              ) : checkin?.status === 'open' ? (
                <div className="space-y-2">
                  <p className="break-all rounded-lg bg-surface px-3 py-2 text-sm">{checkinUrl}</p>
                  <p className="text-sm text-ink-soft">Made by {checkin.byName} · {revisionWhen(checkin.createdAt)}. Not answered yet.</p>
                  {isManager && (
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={btnPrimary} onClick={copyCheckin}><Copy className="h-4 w-4" /> {copied ? 'Copied' : 'Copy message with the link'}</button>
                      <button type="button" className={btnSecondary} disabled={!!busy} onClick={stopCheckin}>Stop the link</button>
                    </div>
                  )}
                </div>
              ) : isManager ? (
                <button type="button" className={btnPrimary} disabled={!!busy} onClick={makeCheckin}>{busy === 'checkin' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Make the check-in link</button>
              ) : <p className="text-sm text-ink-soft">Management sends this link.</p>}
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer font-semibold text-ink-soft">Questions the HOD is asked</summary>
                <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-ink-soft">{checkinQuestions(settings).map(q => <li key={q.id}>{q.label}</li>)}</ol>
              </details>
            </section>
          )}

          {report && <TrainingReportForm value={report} onChange={setReport} names={names} pax={pax} paxNote="From the deal's Participants. Change it there if it's wrong." programmes={programmes} disabled={partLocked} photos={photos} teamPart={teamPart} settings={settings} />}

          {saved?.revisions?.length ? <RevisionList revisions={saved.revisions} title={`${trainerName}'s changes after sending`} /> : null}

          {report?.history?.length ? (
            <details className="rounded-2xl border border-line bg-white p-4 text-sm">
              <summary className="cursor-pointer font-semibold">History</summary>
              <ul className="mt-2 space-y-1 text-ink-soft">{[...report.history].reverse().map((h, i) => <li key={i}>{formatDate(h.at.slice(0, 10))} · {h.byName}: {h.action}</li>)}</ul>
            </details>
          ) : null}
        </div>

        {staff && report && (
          <div className="space-y-2 border-t border-line bg-white px-5 py-3">
            {returning && (
              <div className="space-y-2">
                <label className="block text-sm font-semibold" htmlFor="rep-return">What should the trainer fix?</label>
                <textarea id="rep-return" rows={2} className={input} value={note} onChange={e => setNote(e.target.value)} placeholder="Shown to the trainer in the portal" />
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={btnPrimary} disabled={!!busy} onClick={sendBack}>{busy === 'return' && <Loader2 className="h-4 w-4 animate-spin" />} Send back</button>
                  <button type="button" className={btnSecondary} onClick={() => setReturning(false)}>Cancel</button>
                </div>
              </div>
            )}
            {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
            {!returning && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={`text-sm ${line.tone === 'danger' ? 'text-danger' : line.tone === 'attention' ? 'text-attention' : 'text-ink-soft'}`}>{report.status === 'checked' ? 'Checked and locked' : line.text}</span>
                <div className="flex flex-wrap gap-2">
                  {report.status === 'checked' ? (
                    <>
                      <button type="button" className={btnSecondary} disabled={!!busy} onClick={reopen}>{busy === 'reopen' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />} Reopen</button>
                    </>
                  ) : (
                    <>
                      {report.status === 'submitted' && <button type="button" className={btnSecondary} disabled={!!busy} onClick={() => setReturning(true)}>Send back to the trainer</button>}
                      <button type="button" className={btnSecondary} disabled={!!busy} onClick={() => pdf('hr')}>{busy === 'pdf-hr' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Preview PDF</button>
                      <button type="button" className={btnPrimary} disabled={!!busy} onClick={markChecked}>{busy === 'check' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Checked, ready for HR</button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
