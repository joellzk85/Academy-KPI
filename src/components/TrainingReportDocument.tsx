// The training report as HR gets it (2026-10-21; lib/trainingReport.ts). A PDF made from the report and the deal,
// saved from the deal's "Training report" step, or opened by HR at /r/<token>. Each section appears only where
// Management left it on (lib/trainingReport.ts onHrCopy: main sections on unless unticked, internal notes off unless ticked).
// The sheet has the class "print-paper" so makeDocumentPdf can find it.

import React from 'react';
import { clientTitle } from '../lib/programmes';
import { COMPANY } from '../lib/company';
import {
  HrKey, INTERNAL_PARTS, REVIEW_PARTS, ReportHeaderData, TIME_LABELS, TrainingReport, absentCount, attendancePct, objectivesAverage, onHrCopy, presentCount,
} from '../lib/trainingReport';

// Programme, client, dates, venue, trainer, HRDC approval code (Grant approved step; saved on the report for HR's link).
export type ReportHeader = ReportHeaderData;

const stars = (n: number) => (n ? `${'★'.repeat(n)}${'☆'.repeat(5 - n)}` : 'Not rated');
const day = (iso: string) => (iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export default function TrainingReportDocument({ r, h }: { r: TrainingReport; h: ReportHeader }) {
  const cell = 'border border-slate-300 px-3 py-2 align-top';
  const head = 'mb-2 border-b border-slate-300 pb-1 text-[15px] font-bold text-[#0E6E62]';
  const show = (k: HrKey) => onHrCopy(r, k);
  const extra = INTERNAL_PARTS.filter(p => show(p.key));
  const people = (rows: { name: string; reason: string }[]) => rows.length
    ? <table className="w-full border-collapse"><tbody>{rows.map((x, i) => <tr key={i}><td className={`${cell} w-[32%] font-semibold`}>{x.name}</td><td className={cell}>{x.reason}</td></tr>)}</tbody></table>
    : <p>None.</p>;
  const avg = objectivesAverage(r.objectives);

  return (
    <div className="print-paper space-y-6 bg-white p-12 font-sans text-[13px] text-slate-900">
      <div className="flex items-start justify-between gap-6 border-b-2 border-[#0E6E62] pb-4">
        <div>
          <p className="text-base font-bold">{COMPANY.name} <span className="text-xs font-normal">({COMPANY.regNo})</span></p>
          {COMPANY.addressLines.map(l => <p key={l}>{l}</p>)}
          <p>{COMPANY.phone} · {COMPANY.email}</p>
        </div>
        <p className="text-right text-xl font-bold tracking-wide text-[#0E6E62]">TRAINING REPORT</p>
      </div>

      <table className="w-full border-collapse">
        <tbody>
          {([['Programme', clientTitle(h.programme)], ['Client', h.client], ['Date(s)', h.dates], ['Venue', h.venue], ['Trainer', h.trainer], ...(h.grantNumber ? [['HRDC approval code', h.grantNumber]] : [])] as [string, string][]).map(([k, v]) => (
            <tr key={k}><td className={`${cell} w-[28%] font-semibold`}>{k}</td><td className={cell}>{v || ' '}</td></tr>
          ))}
        </tbody>
      </table>

      {show('attendance') && (<section>
        <h2 className={head}>Attendance</h2>
        <table className="w-full border-collapse">
          <thead><tr className="bg-slate-100">
            <th className={`${cell} text-left`}>Day</th><th className={`${cell} w-20 text-right`}>Registered</th><th className={`${cell} w-20 text-right`}>Present</th>
            <th className={`${cell} w-20 text-right`}>Absent</th><th className={`${cell} text-left`}>Who was absent</th><th className={`${cell} text-left`}>Late / left early</th>
          </tr></thead>
          <tbody>
            {r.days.map((d, i) => (
              <tr key={i}>
                <td className={cell}>{r.days.length > 1 ? `Day ${i + 1}` : 'Training day'}{d.date ? <><br />{day(d.date)}</> : null}{d.note ? <><br /><span className="text-slate-600">{d.note}</span></> : null}</td>
                <td className={`${cell} text-right`}>{r.registered}</td>
                <td className={`${cell} text-right`}>{presentCount(r.registered, d)}</td>
                <td className={`${cell} text-right`}>{absentCount(d)}</td>
                <td className={cell}>{d.absent.join(', ') || 'None'}</td>
                <td className={cell}>{d.late.join(', ') || 'None'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2">Attendance rate: <strong>{attendancePct(r)}%</strong></p>
      </section>)}

      {show('objectives') && (<section>
        <h2 className={head}>Objectives achieved{avg ? ` (average ${avg} / 5)` : ''}</h2>
        <table className="w-full border-collapse">
          <thead><tr className="bg-slate-100"><th className={`${cell} text-left`}>Objective</th><th className={`${cell} w-28 text-left`}>Rating</th><th className={`${cell} text-left`}>Comment</th></tr></thead>
          <tbody>{r.objectives.map((o, i) => <tr key={i}><td className={cell}>{o.text}</td><td className={`${cell} text-[#B98500]`}>{stars(o.stars)}</td><td className={cell}>{o.comment}</td></tr>)}</tbody>
        </table>
      </section>)}

      {show('participant') && r.participant && (r.participant.avg > 0 || r.participant.note) && (
        <section>
          <h2 className={head}>Participants' rating</h2>
          {r.participant.avg > 0 && <p><strong>{r.participant.avg} / 5</strong>{r.participant.responses ? ` from ${r.participant.responses} participant${r.participant.responses === 1 ? '' : 's'}` : ''}</p>}
          {r.participant.note && <p className="mt-1 whitespace-pre-line">{r.participant.note}</p>}
        </section>
      )}

      {show('observations') && (<section>
        <h2 className={head}>Trainer's observations</h2>
        <p className="whitespace-pre-line">{r.observations || 'None.'}</p>
      </section>)}
      {show('outstanding') && <section><h2 className={head}>Outstanding participants</h2>{people(r.outstanding)}</section>}
      {show('attention') && <section><h2 className={head}>Participants who may need special attention</h2>{people(r.attention)}</section>}
      {show('followUps') && (<section>
        <h2 className={head}>Recommended follow-up training</h2>
        {people(r.followUps.map(f => ({ name: f.name, reason: f.reason })))}
      </section>)}

      {extra.length > 0 && (
        <section className="space-y-2">
          <h2 className={head}>Further notes</h2>
          {show('trainerStars') && <p><strong>Trainer's rating of the training:</strong> <span className="text-[#B98500]">{stars(r.internal.trainerStars)}</span></p>}
          {show('time') && <p><strong>Time management:</strong> {r.internal.time ? TIME_LABELS[r.internal.time] : 'Not given'}{r.internal.timeNote ? `. ${r.internal.timeNote}` : ''}</p>}
          {show('missing') && r.internal.missing && <p className="whitespace-pre-line"><strong>What was missing:</strong> {r.internal.missing}</p>}
          {show('review') && REVIEW_PARTS.filter(p => r.internal[p.key]).map(p => <p key={p.key} className="whitespace-pre-line"><strong>{p.label}:</strong> {r.internal[p.key]}</p>)}
          {show('issues') && r.internal.issues && <p className="whitespace-pre-line"><strong>Issues on the day:</strong> {r.internal.issues}</p>}
          {show('leads') && r.internal.leads && <p className="whitespace-pre-line"><strong>Other interest spotted:</strong> {r.internal.leads}</p>}
        </section>
      )}

      {show('photos') && r.photos.length > 0 && (
        <section>
          <h2 className={head}>Photos</h2>
          <div className="grid grid-cols-3 gap-2">
            {r.photos.map(p => <img key={p.path} src={p.url} alt="" crossOrigin="anonymous" className="aspect-[4/3] w-full rounded object-cover" />)}
          </div>
        </section>
      )}

      <div className="grid grid-cols-2 gap-10 pt-6">
        <div><p className="font-semibold">Prepared by</p><p className="mt-8 border-t border-slate-400 pt-1">{h.trainer || r.trainerName}, Trainer</p></div>
        <div><p className="font-semibold">Reviewed by</p><p className="mt-8 border-t border-slate-400 pt-1">{r.checkedByName ? `${r.checkedByName}, ${COMPANY.name}` : COMPANY.name}{r.checkedAt ? ` · ${day(r.checkedAt.slice(0, 10))}` : ''}</p></div>
      </div>
    </div>
  );
}
