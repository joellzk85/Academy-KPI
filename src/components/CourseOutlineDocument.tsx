import React from 'react';
import { CourseOutline } from '../types';
import Logo from './Logo';

// The printable course outline (A4). Taken unchanged from the old outline screen so PDFs look the same.
// Print with window.print(): the styles below hide everything except .print-paper.
export default function CourseOutlineDocument({ o }: { o: CourseOutline }) {
  const { refNumber, date, courseTitle, preparedForCompany, category, level, durationDays, totalHours, audience, prerequisites, overview, preparedBy } = o;
  const outcomes = (o.outcomes || []).filter(x => String(x).trim());
  const items = o.items || [];

  return (
    <div className="w-full overflow-x-auto pb-4 print:overflow-visible print:pb-0">
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          body * {
            visibility: hidden !important;
          }
          #root,
          #root div,
          .print-container-wrapper,
          .print-paper,
          .print-paper * {
            visibility: visible !important;
          }
          .print-paper {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 15mm !important;
            border: none !important;
            box-shadow: none !important;
            background: white !important;
          }
          .outline-grid {
            border-collapse: collapse !important;
            width: 100% !important;
            border: 1px solid #000000 !important;
          }
          .outline-grid th, .outline-grid td {
            border: 1px solid #000000 !important;
            padding: 6px !important;
            color: #000000 !important;
          }
          .outline-grid th {
            background-color: #f1f5f9 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .page-break {
            page-break-before: always !important;
          }
        }
      `}} />

      <div className="bg-white border border-slate-300 rounded-xl shadow-xl overflow-hidden print-paper text-slate-900 font-sans p-8 md:p-12 space-y-6 max-w-4xl mx-auto min-w-[760px] lg:min-w-0">

        {/* Header block with logo */}
        <div className="flex justify-between items-start border-b-2 border-slate-100 pb-5">
          <div>
            <Logo className="h-[120px] w-auto object-contain" />
          </div>

          <div className="text-right text-[11px] md:text-xs text-slate-500 font-mono space-y-1">
            <p className="font-bold text-slate-800">NEXT ACADEMY SDN BHD</p>
            <p>(Company No. 202401030750)</p>
            <p>10, Jalan SS 5B/4, Ss 5, 47301 Petaling Jaya, Selangor</p>
            <p>Tel: +603-2201 1234 | Email: corporate@nextacademy.my</p>
          </div>
        </div>

        {/* Document Title Block */}
        <div className="border-b border-slate-200 pb-2 mb-4 flex justify-between items-end">
          <h2 className="text-lg md:text-xl font-extrabold tracking-widest text-slate-800 uppercase">
            COURSE OUTLINE
          </h2>
          <span className="text-[10px] font-bold text-slate-400 font-mono">
            REF: {refNumber || 'DRAFT'}
          </span>
        </div>

        <div className="space-y-1">
          <h1 className="text-base md:text-lg font-extrabold text-slate-900 uppercase tracking-tight leading-tight">
            {courseTitle || 'UNTITLED SYLLABUS COURSE'}
          </h1>
          {preparedForCompany && (
            <p className="text-xs text-slate-500 font-semibold">
              Prepared for: <span className="font-bold text-slate-700">{preparedForCompany}</span>
            </p>
          )}
        </div>

        {/* Address / Meta Reference details */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
          <div className="space-y-2">
            <div className="flex">
              <span className="font-extrabold text-slate-500 uppercase tracking-wider w-28">Category:</span>
              <span className="font-bold text-slate-800">{category || 'N/A'}</span>
            </div>
            <div className="flex">
              <span className="font-extrabold text-slate-500 uppercase tracking-wider w-28">Level:</span>
              <span className="inline-block bg-emerald-50 border border-emerald-200 text-emerald-700 font-black text-[11px] uppercase px-1.5 py-0.5 rounded">
                {level}
              </span>
            </div>
            <div className="flex">
              <span className="font-extrabold text-slate-500 uppercase tracking-wider w-28">Duration:</span>
              <span className="text-slate-600 font-medium leading-relaxed flex-1">{durationDays} Days ({totalHours} Hours)</span>
            </div>
          </div>

          <div className="space-y-2 md:pl-6 md:border-l border-slate-100 font-mono">
            <div className="flex">
              <span className="font-extrabold text-slate-500 uppercase tracking-wider w-32">Ref. Number:</span>
              <span className="font-extrabold text-emerald-700">{refNumber || 'N/A'}</span>
            </div>
            <div className="flex">
              <span className="font-extrabold text-slate-500 uppercase tracking-wider w-32">Date:</span>
              <span className="font-bold text-slate-700">{date || 'N/A'}</span>
            </div>
            <div className="flex">
              <span className="font-extrabold text-slate-500 uppercase tracking-wider w-32">Prepared By:</span>
              <span className="text-slate-600 font-semibold">{preparedBy || 'N/A'}</span>
            </div>
          </div>
        </div>

        {/* Logistics bar */}
        <div className="bg-slate-50/50 border border-slate-200/80 rounded-lg p-5 grid grid-cols-1 md:grid-cols-2 gap-5 text-sm font-sans shadow-2xs">
          <div>
            <span className="block text-[11px] font-black text-slate-400 uppercase tracking-widest font-mono">Target Audience</span>
            <span className="font-extrabold text-slate-800 mt-1.5 block">{audience || 'Open enrollment'}</span>
          </div>
          <div>
            <span className="block text-[11px] font-black text-slate-400 uppercase tracking-widest font-mono">Prerequisites</span>
            <span className="font-semibold text-slate-800 mt-1.5 block">{prerequisites || 'None specified'}</span>
          </div>
        </div>

        {/* Overview */}
        <div className="space-y-1.5">
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider font-mono border-b border-slate-100 pb-1">
            Course Synopsis
          </h3>
          <p className="text-xs md:text-sm text-slate-600 text-justify leading-relaxed whitespace-pre-line">
            {overview || ''}
          </p>
        </div>

        {/* Outcomes */}
        {outcomes.length > 0 && (
          <div className="space-y-1.5">
            <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider font-mono border-b border-slate-100 pb-1">
              Key Competency Outcomes
            </h3>
            <ul className="space-y-1 list-disc pl-4 text-xs md:text-sm text-slate-600 font-medium">
              {outcomes.map((out, idx) => (
                <li key={idx}>{out}</li>
              ))}
            </ul>
          </div>
        )}

        {/* PAGE BREAK before the modular curriculum table, matching Quotation's T&C pagination */}
        <div className="page-break" />

        {/* Modular Breakdown Table */}
        <div className="overflow-x-auto pt-2">
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider font-mono mb-3">
            Curriculum Path
          </h3>
          <table className="w-full text-left outline-grid border border-slate-300 text-sm">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-300 text-[11px] font-black text-slate-500 uppercase tracking-widest font-mono">
                <th className="p-3.5 w-12 text-center border-r border-slate-300">No.</th>
                <th className="p-3.5 border-r border-slate-300">Module Title</th>
                <th className="p-3.5 border-r border-slate-300">Topics Covered</th>
                <th className="p-3.5 w-28 border-r border-slate-300">Duration</th>
                <th className="p-3.5 w-40">Methodology</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-250 text-slate-800 font-sans">
              {items.map((m, i) => (
                <tr key={m.id} className="hover:bg-slate-50/40">
                  <td className="p-3.5 text-center font-mono font-bold border-r border-slate-200">{i + 1}</td>
                  <td className="p-3.5 font-extrabold text-slate-900 border-r border-slate-200 leading-normal">{m.moduleTitle}</td>
                  <td className="p-3.5 text-slate-600 font-medium border-r border-slate-200 leading-normal whitespace-pre-wrap">{m.topics}</td>
                  <td className="p-3.5 font-mono font-bold text-slate-600 border-r border-slate-200 text-xs">{m.duration}</td>
                  <td className="p-3.5 font-semibold text-slate-700 italic text-xs leading-normal">{m.methodology}</td>
                </tr>
              ))}

              {items.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-slate-400 italic text-xs">
                    No modules added yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Bottom corporate signature area */}
        <div className="pt-12 grid grid-cols-2 gap-12 text-sm font-sans">
          <div className="space-y-12">
            <p className="font-bold text-slate-500">Prepared By:</p>
            <div className="border-t border-slate-300 pt-1.5 w-48">
              <p className="font-extrabold text-slate-800">{preparedBy || ''}</p>
              <p className="text-xs text-slate-400 font-mono font-semibold">NEXT Academy Representative</p>
            </div>
          </div>

          <div className="space-y-12 text-right flex flex-col items-end">
            <p className="font-bold text-slate-500 text-left w-48">Approved By:</p>
            <div className="border-t border-slate-300 pt-1.5 w-48 text-left">
              <p className="font-extrabold text-slate-800">Academic Board Signatory</p>
              <p className="text-xs text-slate-400 font-mono font-semibold">Designation & Stamp</p>
            </div>
          </div>
        </div>

        <div className="text-center text-[10px] text-slate-400 pt-6 border-t border-slate-100 font-mono">
          © {new Date().getFullYear()} NEXT Academy. All Rights Reserved. This syllabus outline is proprietary information.
        </div>

      </div>
    </div>
  );
}
