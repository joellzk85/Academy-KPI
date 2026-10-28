// The Accounts portal's list as Joel's "Next Academy Payment Request" sheet (2026-10-28): month on top, then No.,
// Category, Receiver (the e-Invoice details), Amount (RM), Bank Info, Details, Date of Event, Remarks, and the total.
// Used for the PDF (makeDocumentPdf finds "print-paper") and the Excel download.

import React from 'react';
import { formatDate } from '../lib/deals';
import { PORTAL_COLUMNS, PortalColumn, PortalRow, PortalSettings, bankLines, receiverLines, rowsTotal } from '../lib/accountsPortal';

const amt = (n: number) => (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type SheetCol = PortalColumn | 'no' | 'amount';

/** The sheet's columns in order: No., the ones Management shows, and Amount right after Receiver (or last). */
export function sheetColumns(s: PortalSettings): { key: SheetCol; label: string }[] {
  const shown = PORTAL_COLUMNS.filter(c => !s.hiddenColumns.includes(c.key));
  const out: { key: SheetCol; label: string }[] = [{ key: 'no', label: 'No.' }];
  shown.forEach(c => { out.push(c); if (c.key === 'receiver') out.push({ key: 'amount', label: 'Amount (RM)' }); });
  if (!out.some(c => c.key === 'amount')) out.push({ key: 'amount', label: 'Amount (RM)' });
  return out;
}

/** The text lines of each cell of one line (shared by the PDF and Excel). */
export function sheetCells(r: PortalRow, s: PortalSettings, no: number): Record<SheetCol, string[]> {
  const paid = r.section === 'paid'
    ? [`Paid ${formatDate(r.paidDate || r.paidAt.slice(0, 10))} by ${r.paidByName || '—'}${r.paidRef ? `, ref ${r.paidRef}` : ''}`] : [];
  return {
    no: [String(no)],
    amount: [amt(r.amount)],
    category: [r.category],
    receiver: receiverLines(r, s),
    bank: bankLines(r),
    details: [r.details, r.ref].filter(Boolean),
    eventDate: r.eventDate ? [formatDate(r.eventDate)] : [],
    remarks: [r.remarks, r.waitReason,
      r.raised ? `Raised by ${r.raised.byName} ${formatDate(r.raised.at.slice(0, 10))}${r.raised.ref ? `, ref ${r.raised.ref}` : ''}${r.section === 'raised' ? ', pending release' : ''}` : '',
      ...paid, r.query ? `Question: ${r.query.text}` : ''].filter(Boolean),
  };
}

export default function AccountsSheetDocument({ rows, settings, title, subtitle }: { rows: PortalRow[]; settings: PortalSettings; title: string; subtitle: string }) {
  const cols = sheetColumns(settings);
  const amountAt = cols.findIndex(c => c.key === 'amount');
  const th = 'border border-slate-300 bg-slate-100 px-1.5 py-1 text-left align-bottom font-bold';
  const td = 'border border-slate-300 px-1.5 py-1 align-top';
  return (
    <div className="print-paper bg-white p-8 font-sans text-[10px] leading-snug text-slate-900">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 pb-2">
        <h2 className="text-sm font-extrabold">NEXT Academy · Payment request · {title}</h2>
        <span className="text-slate-600">{subtitle}</span>
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr>{cols.map(c => <th key={c.key} className={`${th} ${c.key === 'amount' ? 'text-right' : ''}`}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const cells = sheetCells(r, settings, i + 1);
            return (
              <tr key={r.id}>
                {cols.map(c => (
                  <td key={c.key} className={`${td} ${c.key === 'amount' ? 'whitespace-nowrap text-right font-semibold' : ''}`}>
                    {cells[c.key].map((x, j) => <div key={j} className={c.key === 'receiver' && j === 0 ? 'font-semibold' : ''}>{x}</div>)}
                  </td>
                ))}
              </tr>
            );
          })}
          <tr>
            <td className={`${td} font-bold`} colSpan={amountAt}>Total ({rows.length} payment{rows.length === 1 ? '' : 's'})</td>
            <td className={`${td} whitespace-nowrap text-right font-bold`}>{amt(rowsTotal(rows))}</td>
            {cols.length - amountAt - 1 > 0 && <td className={td} colSpan={cols.length - amountAt - 1} />}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** The same list as an Excel file, one row per payment, with the total at the bottom. */
export async function sheetExcel(rows: PortalRow[], settings: PortalSettings, title: string): Promise<Blob> {
  const ExcelJS: any = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Payment request');
  const cols = sheetColumns(settings);
  const amountCol = cols.findIndex(c => c.key === 'amount') + 1;
  ws.addRow([`NEXT Academy · Payment request · ${title}`]).font = { bold: true, size: 13 };
  ws.addRow([]);
  const h = ws.addRow(cols.map(c => c.label));
  h.font = { bold: true };
  h.eachCell((c: any) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF2F1' } }; });
  rows.forEach((r, i) => {
    const cells = sheetCells(r, settings, i + 1);
    const row = ws.addRow(cols.map(c => (c.key === 'amount' ? r.amount : c.key === 'no' ? i + 1 : cells[c.key].join('\n'))));
    row.alignment = { wrapText: true, vertical: 'top' };
  });
  const total = ws.addRow([]);
  total.getCell(1).value = 'Total';
  total.getCell(amountCol).value = rowsTotal(rows);
  total.font = { bold: true };
  ws.getColumn(amountCol).numFmt = '#,##0.00';
  cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.key === 'no' ? 6 : c.key === 'receiver' ? 48 : c.key === 'amount' ? 14 : 26; });
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
