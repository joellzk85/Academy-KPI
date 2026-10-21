// Training reports (Joel, 2026-10-21): every training report in one list, on the Trainers page (Admin and Management).
// Trainings that have started with no report yet show as "Not written yet". A row opens the same panel as the deal's
// "Training report" step; marking it checked or reopening it ticks or unticks that step (setReportStep).

import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { FileText, Search } from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import { dealStage, formatDate, isDeletedDeal, todayIso, trainingDateText } from '../lib/deals';
import { effectiveTrainer, effectiveVenue } from '../lib/checklist';
import { STATUS_TEXT, ReportStatus, TrainingReport } from '../lib/trainingReport';
import { ReportPanel, setReportStep, useTrainingReport, useTrainingReports } from './TrainingReportAdmin';
import type { ReportHeader } from './TrainingReportDocument';

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };
type Status = ReportStatus | 'none';
type Filter = 'all' | 'check' | 'waiting' | 'checked';

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';

const STATUS_LABEL: Record<Status, string> = { ...STATUS_TEXT, none: 'Not written yet' };
const inFilter = (s: Status, f: Filter) =>
  f === 'all' || (f === 'check' ? s === 'submitted' : f === 'checked' ? s === 'checked' : s === 'none' || s === 'draft' || s === 'returned');
const FILTERS: [Filter, string][] = [['all', 'All'], ['check', 'Needs checking'], ['waiting', 'With the trainer'], ['checked', 'Checked']];

interface Row { deal: any; report: TrainingReport | null; status: Status; trainerId: string; trainerName: string; header: ReportHeader; names: string[] }

export default function TrainingReportsList({ viewer, deals, checklists, quotes, trainers }: {
  viewer: Viewer; deals: any[]; checklists: Record<string, any>; quotes: any[]; trainers: any[];
}) {
  const reports = useTrainingReports();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const today = todayIso();

  const rows: Row[] = useMemo(() => deals
    .filter(d => !isDeletedDeal(d))
    .map(d => {
      const report = reports.find(r => r.dealId === d.id) || null;
      const tasks: any[] = checklists[d.id]?.tasks || [];
      const hasStep = tasks.some(t => t.id === 'training_report');
      const started = !!d.trainingDate && String(d.trainingDate).slice(0, 10) <= today;
      // No report yet: only won trainings with the step that have started.
      if (!report && !(hasStep && started && dealStage(d) === 'won')) return null;
      const dealQuotes = quotes.filter(q => q.pipelineId === d.id);
      const tr = effectiveTrainer(tasks.find(t => t.kind === 'trainer'), dealQuotes, trainers);
      const trainerName = report?.trainerName || tr?.name || '';
      const header: ReportHeader = {
        programme: d.courseName || '', client: d.client || '', dates: trainingDateText(d, true),
        venue: effectiveVenue(tasks.find(t => t.kind === 'venue'), dealQuotes, [])?.name || '', trainer: tr?.name || trainerName,
        grantNumber: tasks.find(t => t.kind === 'grant')?.grantNumber || '',
      };
      const names = (checklists[d.id]?.t3?.trainees || []).map((x: any) => String(x?.name || '').trim()).filter(Boolean);
      return { deal: d, report, status: (report?.status || 'none') as Status, trainerId: report?.trainerId || tr?.id || '', trainerName, header, names };
    })
    .filter((x): x is Row => !!x)
    // Waiting to be checked first, then the latest training first.
    .sort((a, b) => Number(b.status === 'submitted') - Number(a.status === 'submitted') || String(b.deal.trainingDate || '').localeCompare(String(a.deal.trainingDate || ''))),
  [deals, reports, checklists, quotes, trainers, today]);

  const q = search.trim().toLowerCase();
  const shown = rows.filter(r => inFilter(r.status, filter)
    && (!q || [r.header.programme, r.header.client, r.trainerName].some(x => x.toLowerCase().includes(q))));
  const open = rows.find(r => r.deal.id === openId) || null;

  const tick = (done: boolean) => {
    if (!open) return;
    setReportStep(open.deal.id, viewer, done).catch(e => setError(`The report was saved, but the deal's Training report step wasn't ${done ? 'ticked' : 'unticked'}: ${friendlyError(e)}`));
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1 rounded-xl border border-line bg-white p-1" role="tablist" aria-label="Show reports">
          {FILTERS.map(([k, l]) => {
            const n = rows.filter(r => inFilter(r.status, k)).length;
            return (
              <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${filter === k ? 'bg-accent-soft text-accent' : 'text-ink-soft hover:bg-surface'}`}>
                {l} <span className={k === 'check' && n ? 'text-attention' : ''}>({n})</span>
              </button>
            );
          })}
        </div>
        <label className="relative min-w-[14rem] flex-1">
          <span className="sr-only">Search reports</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
          <input className={`${input} pl-9`} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search programme, client or trainer" />
        </label>
      </div>

      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      {shown.length === 0 ? (
        <p className="rounded-2xl border border-line bg-white p-6 text-center text-[15px] text-ink-soft">
          {rows.length ? 'No reports match.' : 'No training reports yet. They show here from the first training day.'}
        </p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">
          {shown.map(r => (
            <li key={r.deal.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold">{r.header.programme || 'Training'}{r.header.client ? <span className="font-normal text-ink-soft"> · {r.header.client}</span> : null}</p>
                <p className="text-sm text-ink-soft">
                  {r.header.dates || 'No training date'} · Trainer: {r.trainerName || 'not picked yet'}
                  {r.report?.submittedAt && r.status !== 'draft' ? ` · Sent ${formatDate(r.report.submittedAt.slice(0, 10))}` : ''}
                  {r.status === 'checked' && r.report?.checkedByName ? ` · Checked by ${r.report.checkedByName}` : ''}
                </p>
              </div>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${r.status === 'checked' ? 'bg-accent-soft text-accent' : r.status === 'submitted' ? 'bg-attention-soft text-ink' : r.status === 'returned' ? 'bg-danger-soft text-danger' : 'bg-surface text-ink-soft'}`}>
                {STATUS_LABEL[r.status]}
              </span>
              {r.status === 'none' && !r.trainerId ? (
                <span className="text-sm text-ink-soft">Pick the trainer on the deal first</span>
              ) : (
                <button type="button" className={r.status === 'submitted' ? btnPrimary : btnSecondary} onClick={() => { setError(''); setOpenId(r.deal.id); }}>
                  <FileText className="h-4 w-4" /> {r.status === 'none' ? 'Write the report' : r.status === 'submitted' ? 'Check' : 'Open'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {open && <OpenReport row={open} viewer={viewer} onClose={() => setOpenId(null)} onChecked={() => tick(true)} onReopened={() => tick(false)} />}
    </section>
  );
}

// Waits for the live report and the Output assessment file names, then shows the deal's report panel.
function OpenReport({ row, viewer, onClose, onChecked, onReopened }: { row: Row; viewer: Viewer; onClose: () => void; onChecked: () => void; onReopened: () => void }) {
  const saved = useTrainingReport(row.deal.id);
  const [outputFiles, setOutputFiles] = useState<string[] | null>(null);
  useEffect(() => {
    getDocs(query(collection(db, 'checklist_files'), where('dealId', '==', row.deal.id)))
      .then(s => setOutputFiles(s.docs.map(d => d.data() as any).filter(f => f.taskId === 'output_assessment').map(f => String(f.name || ''))))
      .catch(() => setOutputFiles([]));
  }, [row.deal.id]);
  if (saved === undefined || outputFiles === null) return null;
  return (
    <ReportPanel deal={row.deal} viewer={viewer} saved={saved} trainerId={row.trainerId} trainerName={row.trainerName || 'The trainer'} header={row.header}
      names={row.names} outputFiles={outputFiles} onClose={onClose} onChecked={onChecked} onReopened={onReopened} />
  );
}
