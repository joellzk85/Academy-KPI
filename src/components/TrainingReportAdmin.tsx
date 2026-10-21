// Training report on the deal (2026-10-21; lib/trainingReport.ts): the box on the after-training "Training report"
// step, and the panel where Admin or Management read, fix or write the report (for a trainer without portal access),
// type the participants' rating from the Output assessment, send it back or mark it checked, and save HR's PDF.
// Marking it checked ticks the step; reopening it unticks it. Management ticks which internal notes HR may see.

import React, { useEffect, useState } from 'react';
import { collection, doc, getDocs, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import { CheckCircle2, Download, FileText, Loader2, Lock, Plus, Undo2, X } from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import { formatDate, todayIso, trainingDays, trainingEndDate } from '../lib/deals';
import { linkedOnly } from '../lib/linked';
import {
  INTERNAL_PARTS, ReportPhoto, STATUS_TEXT, TrainingReport, cleanParticipant, newReport, reportDates, reportGaps, withDates,
} from '../lib/trainingReport';
import { autoSaveText, leaveAfterSave, useAutoSave } from '../lib/useAutoSave';
import { jobId } from '../lib/trainerPortal';
import PanelResizer from './PanelResizer';
import TrainingReportForm from './TrainingReportForm';
import type { ReportHeader } from './TrainingReportDocument';

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };

const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';
const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';

const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const nowIso = () => new Date().toISOString();

export function useTrainingReport(dealId: string): TrainingReport | null | undefined {
  const [r, setR] = useState<TrainingReport | null | undefined>(undefined);
  useEffect(() => onSnapshot(doc(db, 'training_reports', dealId), s => setR(s.exists() ? (s.data() as TrainingReport) : null), () => setR(null)), [dealId]);
  return r;
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

async function savePdf(r: TrainingReport, h: ReportHeader) {
  const [{ default: TrainingReportDocument }, { makeDocumentPdf }] = await Promise.all([import('./TrainingReportDocument'), import('../lib/quotePdf')]);
  const blob = await makeDocumentPdf(React.createElement(TrainingReportDocument, { r, h }), `Training report ${h.programme}`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Training report - ${[h.programme, h.client].filter(Boolean).join(' - ').replace(/[\\/:*?"<>|]/g, '')}.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** The box on the "Training report" step. */
export function TrainingReportBox({ deal, viewer, trainerId, trainerName, header, names, outputFiles, onChecked, onReopened }: {
  deal: any;
  viewer: Viewer;
  trainerId: string;               // the trainer picked on the Trainer step ('' if none yet)
  trainerName: string;
  header: ReportHeader;
  names: string[];                 // the T3 participants list
  outputFiles: string[];           // names of the files on the Output assessment step
  onChecked: () => void;           // tick the step
  onReopened: () => void;          // untick it
}) {
  const r = useTrainingReport(deal.id);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const staff = viewer.role !== 'rep';
  const started = String(deal.trainingDate || '').slice(0, 10) <= todayIso();
  const ended = !!trainingEndDate(deal) && trainingEndDate(deal) < todayIso();
  if (r === undefined) return null;

  const pdf = async () => {
    if (!r) return;
    setBusy(true); setError('');
    try { await savePdf(r, header); } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
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
            </>
          ) : (
            <span className="text-ink-soft">
              No report yet. {trainerId ? `${trainerName} can write it in the trainer portal from the first training day` : 'Pick the trainer on the Trainer step first'}{staff ? ', or you can write it here.' : '.'}
            </span>
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          {staff && (r || (started && trainerId)) && (
            <button type="button" className={r?.status === 'submitted' ? btnPrimary : btnSecondary} onClick={() => setOpen(true)}>
              <FileText className="h-4 w-4" /> {!r ? 'Write the report' : r.status === 'submitted' ? 'Check the report' : 'Open the report'}
            </button>
          )}
          {!staff && r && <button type="button" className={btnSecondary} onClick={() => setOpen(true)}><FileText className="h-4 w-4" /> View the report</button>}
          {r && r.status === 'checked' && (
            <button type="button" className={btnSecondary} disabled={busy} onClick={pdf}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} PDF for HR</button>
          )}
        </div>
      </div>
      {!r && ended && trainerId && <p className="mt-1 text-sm font-semibold text-attention">The training has ended: waiting for {trainerName}'s report.</p>}
      {error && <p role="alert" className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {open && (
        <ReportPanel deal={deal} viewer={viewer} saved={r} trainerId={r?.trainerId || trainerId} trainerName={r?.trainerName || trainerName} header={header}
          names={names} outputFiles={outputFiles} onClose={() => setOpen(false)} onChecked={onChecked} onReopened={onReopened} />
      )}
    </div>
  );
}

function ReportPanel({ deal, viewer, saved, trainerId, trainerName, header, names, outputFiles, onClose, onChecked, onReopened }: {
  deal: any; viewer: Viewer; saved: TrainingReport | null; trainerId: string; trainerName: string; header: ReportHeader;
  names: string[]; outputFiles: string[]; onClose: () => void; onChecked: () => void; onReopened: () => void;
}) {
  const staff = viewer.role !== 'rep';
  const isManager = viewer.role === 'management';
  const dates = reportDates(String(deal.trainingDate || '').slice(0, 10), trainingDays(deal));
  const [report, setReport] = useState<TrainingReport | null>(saved ? withDates(clean({ ...newReport(deal.id, trainerId, trainerName, { dates, objectives: [], names }), ...saved }), dates) : null);
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
      const fresh = newReport(deal.id, trainerId, trainerName, { dates, objectives, names });
      setReport(fresh);
      setSavedJson(JSON.stringify(fresh));   // nothing is saved until someone types
    }).catch(e => setError(friendlyError(e)));
  }, [deal.id]);

  const locked = !staff || report?.status === 'checked';
  const json = report ? JSON.stringify(report) : '';
  const dirty = !!report && json !== savedJson;
  const write = async (v: TrainingReport | null) => {
    if (!v) return;
    await setDoc(doc(db, 'training_reports', deal.id), clean({ ...v, updatedAt: nowIso(), updatedByName: viewer.name }));
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
    const gaps = reportGaps(report);
    if (gaps.length && !window.confirm(`Still missing: ${gaps.join(', ')}. Mark it checked anyway?`)) return;
    act('check', { status: 'checked', checkedAt: nowIso(), checkedByName: viewer.name, returnNote: '' }, 'Checked, ready for HR', onChecked);
  };
  const sendBack = () => {
    if (!note.trim()) { setError('Say what the trainer should fix.'); return; }
    act('return', { status: 'returned', returnNote: note.trim(), returnedByName: viewer.name }, `Sent back: ${note.trim()}`, () => { setReturning(false); setNote(''); });
  };
  const reopen = () => act('reopen', { status: 'submitted', checkedAt: '', checkedByName: '' }, 'Reopened', onReopened);
  const pdf = async () => {
    if (!report) return;
    setBusy('pdf'); setError('');
    try { await flush(); await savePdf(report, header); } catch (e) { setError(friendlyError(e)); } finally { setBusy(''); }
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
              {!locked && <button type="button" className="absolute right-1 top-1 rounded-full bg-white/90 p-1 text-ink-soft hover:text-danger" aria-label={`Take ${ph.name} off the report`}
                onClick={() => setReport({ ...report, photos: report.photos.filter(x => x.path !== ph.path) })}><X className="h-3.5 w-3.5" /></button>}
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-ink-soft">No photos on the report yet.</p>}
      {!locked && morePhotos.length > 0 && (
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

          {/* Management: which internal notes go on HR's copy */}
          {report && (
            <section className="rounded-2xl border border-line bg-white p-4">
              <h3 className="text-base font-bold">On HR's copy</h3>
              <p className="mb-2 text-sm text-ink-soft">Attendance, objectives, participants' rating, observations, people, follow-up training and photos always go on it. The internal notes go on only when Management ticks them.</p>
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {INTERNAL_PARTS.map(x => (
                  <li key={x.key}>
                    <label className={`flex items-center gap-2 text-[15px] ${isManager && !locked ? 'cursor-pointer' : 'text-ink-soft'}`}>
                      <input type="checkbox" className="h-4 w-4 accent-[#0E6E62]" disabled={!isManager || locked} checked={!!report.showToHr?.[x.key]}
                        onChange={e => setReport({ ...report, showToHr: { ...(report.showToHr || {}), [x.key]: e.target.checked } })} />
                      {x.label}
                    </label>
                  </li>
                ))}
              </ul>
              {!isManager && <p className="mt-1 text-sm text-ink-soft">Only Management can change these.</p>}
            </section>
          )}

          {report && <TrainingReportForm value={report} onChange={setReport} names={names} programmes={programmes} disabled={locked} photos={photos} teamPart={teamPart} />}

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
                      <button type="button" className={btnPrimary} disabled={!!busy} onClick={pdf}>{busy === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} PDF for HR</button>
                    </>
                  ) : (
                    <>
                      {report.status === 'submitted' && <button type="button" className={btnSecondary} disabled={!!busy} onClick={() => setReturning(true)}>Send back to the trainer</button>}
                      <button type="button" className={btnSecondary} disabled={!!busy} onClick={pdf}>{busy === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Preview PDF</button>
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
