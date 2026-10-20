// "Standard trainer biodata for HRDC" (Joel, 2026-10-20), filled in from the trainer's details.
// - The trainer sees it with Preview on their profile link (no download).
// - Admin and Management download it as a PDF from the trainer's panel (makeDocumentPdf).
// The sheet has the class "print-paper" so makeDocumentPdf can find it.

import React from 'react';
import { BIO_LISTS, BioListKey, BioRow, rowFilled } from '../lib/trainerProfile';

export interface BiodataInput {
  name: string;
  icNumber?: string;   // only when the viewer may see it (Admin and Management, or the trainer themselves)
  nationality?: string;
  race?: string;
  tttNumber?: string;
  academic?: BioRow[];
  professional?: BioRow[];
  career?: BioRow[];
  trainingExp?: BioRow[];
}

const SECTION_NO: Record<BioListKey, string> = { academic: '2', professional: '3', career: '4', trainingExp: '5' };

export default function TrainerBiodataDocument({ t, icHidden }: { t: BiodataInput; icHidden?: boolean }) {
  const cell = 'border border-slate-300 px-3 py-2 align-top';
  const personal: [string, string][] = [
    ['Name', t.name],
    ['IC / Passport No.', icHidden ? '(kept by NEXT Academy)' : t.icNumber || ''],
    ['Nationality', t.nationality || ''],
    ['Race', t.race || ''],
    ['TTT Certification / Exemption Number', t.tttNumber || ''],
  ];
  return (
    <div className="print-paper space-y-6 bg-white p-12 font-sans text-[13px] text-slate-900">
      <h1 className="text-center text-lg font-bold tracking-wide">STANDARD TRAINER BIODATA FOR HRDC</h1>

      <section>
        <h2 className="mb-2 font-bold">A. Personal Details</h2>
        <table className="w-full border-collapse">
          <tbody>
            {personal.map(([k, v]) => (
              <tr key={k}><td className={`${cell} w-[38%] font-semibold`}>{k}</td><td className={cell}>{v || ' '}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      {BIO_LISTS.map(l => {
        const rows = (t[l.key] || []).filter(rowFilled);
        return (
          <section key={l.key}>
            <h2 className="mb-2 font-bold">{SECTION_NO[l.key]}. {l.key === 'career' ? 'Years of Career Experience' : l.title.replace(/\b\w/g, c => c.toUpperCase())}</h2>
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-slate-100">
                  <th className={`${cell} w-10 text-left`}>No.</th>
                  {l.cols.map(c => <th key={c.k} className={`${cell} text-left ${c.year ? 'w-24' : ''}`}>{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {(rows.length ? rows : [{}]).map((r, i) => (
                  <tr key={i}>
                    <td className={cell}>{rows.length ? i + 1 : ' '}</td>
                    {l.cols.map(c => <td key={c.k} className={cell}>{r[c.k] || ' '}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}

// Downloads it as a PDF (Admin and Management). The PDF tools load only when needed.
export async function downloadBiodataPdf(t: BiodataInput) {
  const { makeDocumentPdf } = await import('../lib/quotePdf');
  const blob = await makeDocumentPdf(React.createElement(TrainerBiodataDocument, { t }), `Trainer biodata ${t.name}`);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `HRDC trainer biodata - ${String(t.name || 'Trainer').replace(/[\\/:*?"<>|]+/g, '').slice(0, 60)}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
