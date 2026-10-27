// The training report as HR gets it (2026-10-21; lib/trainingReport.ts). A PDF made from the report and the deal,
// saved from the deal's "Training report" step, or opened by HR at /r/<token>. Since 2026-10-27 there are two copies,
// HR's and the head of department's (HOD), and the sections follow Management's settings (lib/reportSettings.ts):
// it always gets a copy made by copyOf, which says which sections print and their titles (r.printed).
// The sheet has the class "print-paper" so makeDocumentPdf can find it.

import React from 'react';
import { clientTitle } from '../lib/programmes';
import { COMPANY } from '../lib/company';
import {
  REVIEW_PARTS, ReportHeaderData, TIME_LABELS, TrainingReport, absentCount, attendancePct, objectivesAverage, presentCount, scoreSummary,
} from '../lib/trainingReport';
import { SECTIONS, SectionKey, answerText } from '../lib/reportSettings';

// Programme, client, dates, venue, trainer, HRDC approval code (Grant approved step; saved on the report for HR's link).
export type ReportHeader = ReportHeaderData;

const stars = (n: number) => (n ? `${'★'.repeat(n)}${'☆'.repeat(5 - n)}` : 'Not rated');
const day = (iso: string) => (iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export default function TrainingReportDocument({ r, h }: { r: TrainingReport; h: ReportHeader }) {
  const cell = 'border border-slate-300 px-3 py-2 align-top';
  const head = 'mb-2 border-b border-slate-300 pb-1 text-[15px] font-bold text-[#0E6E62]';
  // A copy made before 2026-10-27 has no r.printed: the main sections then print, the internal notes don't.
  const show = (k: SectionKey) => (r.printed ? !!r.printed[k]?.on : SECTIONS.find(x => x.key === k)?.group === 'main');
  const title = (k: SectionKey) => r.printed?.[k]?.label || SECTIONS.find(x => x.key === k)!.label;
  const hod = r.copy === 'hod';
  const extra = SECTIONS.filter(x => x.group === 'internal' && show(x.key));
  const answers = r.answers || [];
  const list = (items: string[] | undefined) => <ul className="list-disc space-y-1 pl-5">{(items || []).map((t, i) => <li key={i}>{t}</li>)}</ul>;
  const sc = scoreSummary(r.scores);
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
        <div className="text-right">
          <p className="text-xl font-bold tracking-wide text-[#0E6E62]">TRAINING REPORT</p>
          {hod && <p className="mt-1 text-[13px] font-semibold text-slate-600">For the head of department</p>}
        </div>
      </div>

      <table className="w-full border-collapse">
        <tbody>
          {([['Programme', clientTitle(h.programme)], ['Client', h.client], ['Date(s)', h.dates], ['Venue', h.venue], ['Trainer', h.trainer], ...(h.grantNumber && !hod ? [['HRDC approval code', h.grantNumber]] : []),
            ...(show('hours') && (r.hours || r.certificates) ? [['Training hours', `${r.hours || 0} hours${r.certificates ? ` · ${r.certificates} certificate${r.certificates === 1 ? '' : 's'} issued` : ''}`]] : [])] as [string, string][]).map(([k, v]) => (
            <tr key={k}><td className={`${cell} w-[28%] font-semibold`}>{k}</td><td className={cell}>{v || ' '}</td></tr>
          ))}
        </tbody>
      </table>

      {show('summary') && r.summary && (<section>
        <h2 className={head}>{title('summary')}</h2>
        <p className="whitespace-pre-line text-[14px]">{r.summary}</p>
      </section>)}

      {show('attendance') && (<section>
        <h2 className={head}>{title('attendance')}</h2>
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

      {show('topics') && (r.topics || []).length > 0 && <section><h2 className={head}>{title('topics')}</h2>{list(r.topics)}</section>}

      {show('objectives') && (<section>
        <h2 className={head}>Objectives achieved{avg ? ` (average ${avg} / 5)` : ''}</h2>
        <table className="w-full border-collapse">
          <thead><tr className="bg-slate-100"><th className={`${cell} text-left`}>Objective</th><th className={`${cell} w-28 text-left`}>Rating</th><th className={`${cell} text-left`}>Comment</th></tr></thead>
          <tbody>{r.objectives.map((o, i) => <tr key={i}><td className={cell}>{o.text}</td><td className={`${cell} text-[#B98500]`}>{stars(o.stars)}</td><td className={cell}>{o.comment}</td></tr>)}</tbody>
        </table>
      </section>)}

      {show('scores') && sc.count > 0 && (<section>
        <h2 className={head}>{title('scores')}</h2>
        <p className="mb-2">
          Class average: before <strong>{sc.pre ?? '-'}</strong>, after <strong>{sc.post ?? '-'}</strong> (out of {sc.outOf})
          {sc.gain !== null ? <>, improvement <strong>{sc.gain > 0 ? '+' : ''}{sc.gain}</strong></> : null}
        </p>
        <table className="w-full border-collapse">
          <thead><tr className="bg-slate-100"><th className={`${cell} text-left`}>Participant</th><th className={`${cell} w-24 text-right`}>Before</th><th className={`${cell} w-24 text-right`}>After</th><th className={`${cell} w-24 text-right`}>Change</th></tr></thead>
          <tbody>{(r.scores?.rows || []).map((x, i) => (
            <tr key={i}><td className={cell}>{x.name}</td><td className={`${cell} text-right`}>{x.pre ?? '-'}</td><td className={`${cell} text-right`}>{x.post ?? '-'}</td>
              <td className={`${cell} text-right`}>{x.pre !== null && x.post !== null ? `${x.post - x.pre > 0 ? '+' : ''}${Math.round((x.post - x.pre) * 10) / 10}` : '-'}</td></tr>
          ))}</tbody>
        </table>
      </section>)}

      {show('participant') && r.participant && (r.participant.avg > 0 || r.participant.note) && (
        <section>
          <h2 className={head}>{title('participant')}</h2>
          {r.participant.avg > 0 && <p><strong>{r.participant.avg} / 5</strong>{r.participant.responses ? ` from ${r.participant.responses} participant${r.participant.responses === 1 ? '' : 's'}` : ''}</p>}
          {r.participant.note && <p className="mt-1 whitespace-pre-line">{r.participant.note}</p>}
        </section>
      )}

      {show('observations') && (<section>
        <h2 className={head}>{title('observations')}</h2>
        <p className="whitespace-pre-line">{r.observations || 'None.'}</p>
      </section>)}
      {show('personNotes') && (r.personNotes || []).length > 0 && (<section>
        <h2 className={head}>{title('personNotes')}</h2>
        <table className="w-full border-collapse">
          <thead><tr className="bg-slate-100"><th className={`${cell} w-[28%] text-left`}>Participant</th><th className={`${cell} text-left`}>Strengths</th><th className={`${cell} text-left`}>To work on</th></tr></thead>
          <tbody>{(r.personNotes || []).map((x, i) => <tr key={i}><td className={`${cell} font-semibold`}>{x.name}</td><td className={cell}>{x.strengths}</td><td className={cell}>{x.improve}</td></tr>)}</tbody>
        </table>
      </section>)}
      {show('outstanding') && <section><h2 className={head}>{title('outstanding')}</h2>{people(r.outstanding)}</section>}
      {show('attention') && <section><h2 className={head}>{title('attention')}</h2>{people(r.attention)}</section>}
      {show('actions') && (r.actions || []).length > 0 && <section><h2 className={head}>{title('actions')}</h2>{list(r.actions)}</section>}
      {show('hodTips') && (r.hodTips || []).length > 0 && <section><h2 className={head}>{title('hodTips')}</h2>{list(r.hodTips)}</section>}
      {show('followUps') && (<section>
        <h2 className={head}>{title('followUps')}</h2>
        {people(r.followUps.map(f => ({ name: f.name, reason: f.reason })))}
      </section>)}

      {answers.filter(a => !a.internal).length > 0 && (
        <section className="space-y-2">
          <h2 className={head}>More from the trainer</h2>
          {answers.filter(a => !a.internal).map(a => <p key={a.id} className="whitespace-pre-line"><strong>{a.label}:</strong> {answerText(a)}</p>)}
        </section>
      )}

      {(extra.length > 0 || answers.some(a => a.internal)) && (
        <section className="space-y-2">
          <h2 className={head}>Further notes</h2>
          {show('trainerStars') && <p><strong>{title('trainerStars').replace(/^Your /, "Trainer's ")}:</strong> <span className="text-[#B98500]">{stars(r.internal.trainerStars)}</span></p>}
          {show('time') && <p><strong>{title('time')}:</strong> {r.internal.time ? TIME_LABELS[r.internal.time] : 'Not given'}{r.internal.timeNote ? `. ${r.internal.timeNote}` : ''}</p>}
          {show('missing') && r.internal.missing && <p className="whitespace-pre-line"><strong>{title('missing')}:</strong> {r.internal.missing}</p>}
          {show('review') && REVIEW_PARTS.filter(p => r.internal[p.key]).map(p => <p key={p.key} className="whitespace-pre-line"><strong>{p.label}:</strong> {r.internal[p.key]}</p>)}
          {show('issues') && r.internal.issues && <p className="whitespace-pre-line"><strong>{title('issues')}:</strong> {r.internal.issues}</p>}
          {show('leads') && r.internal.leads && <p className="whitespace-pre-line"><strong>Other interest spotted:</strong> {r.internal.leads}</p>}
          {answers.filter(a => a.internal).map(a => <p key={a.id} className="whitespace-pre-line"><strong>{a.label}:</strong> {answerText(a)}</p>)}
        </section>
      )}

      {show('photos') && r.photos.length > 0 && (
        <section>
          <h2 className={head}>{title('photos')}</h2>
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
