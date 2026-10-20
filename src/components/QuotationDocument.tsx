import React from 'react';
import { Quotation } from '../types';
import Logo from './Logo';
import { COMPANY, COMPANY_ADDRESS, QUOTE_SIGNATORY, SIGNATURE_FONT } from '../lib/company';
import { quoteSst } from '../lib/quoteSst';
import { isItemsOnly } from '../lib/dealQuotes';

// The printable quotation (A4). Taken unchanged from the old quotation screen so PDFs look the same.
// Print with window.print(): the styles below hide everything except .print-paper.
export default function QuotationDocument({ q }: { q: Quotation }) {
  const { refNumber, date, attn, company, address, venue, time, participants, trainingProvider } = q;
  // Only lines with details are printed (Joel, 2026-10-19): a line with no name and RM 0.00 is left out, and lines are numbered as printed.
  const items = (q.items || []).filter(it => (it.program || '').trim() || Number(it.totalFee) !== 0).map((it, i) => ({ ...it, no: i + 1 }));
  const remarks = q.remarks || [];
  const terms = q.terms || [];
  const { mode: sstMode, rate: sstRate, subtotal: grandTotal, sst: sstAmount, total: finalTotal } = quoteSst(q);
  const applySST = sstMode === 'added';
  // Other items only (bus, T-shirts...; 2026-10-19): no training columns or wording, venue/time only when filled in.
  const itemsOnly = isItemsOnly(q);
  const lead = itemsOnly ? 3 : 6;
  const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="w-full overflow-x-auto pb-4 print:overflow-visible print:pb-0">
            <style dangerouslySetInnerHTML={{ __html: `
              @media print {
                /* Hide EVERYTHING in the DOM by default */
                body * {
      visibility: hidden !important;
                }
                /* Make the ancestor chain of print-paper visible so browsers will render the child */
                #root,
                #root div,
                .print-container-wrapper,
                .print-paper, 
                .print-paper * {
      visibility: visible !important;
                }
                /* Absolute position the print-paper to print from the top-left corner of the page */
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
                /* Excel spreadsheet print simulation style */
                .spreadsheet-grid {
      border-collapse: collapse !important;
      width: 100% !important;
      border: 1px solid #000000 !important;
                }
                .spreadsheet-grid th, .spreadsheet-grid td {
      border: 1px solid #000000 !important; /* crisper black gridlines for physical printer */
      padding: 6px !important;
      color: #000000 !important;
                }
                .spreadsheet-grid th {
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
      
      {/* NEXT Academy vector/text logo matching PDF structure */}
      <div className="flex justify-between items-start border-b-2 border-slate-100 pb-5" data-track="letterhead">
        <div>
          <Logo className="h-[120px] w-auto object-contain" />
        </div>

        <div className="text-right text-[11px] md:text-xs text-slate-500 font-mono space-y-1">
          <p className="font-bold text-slate-800">NEXT ACADEMY SDN BHD</p>
          <p>(Company No. 202401030750)</p>
          <p>{COMPANY_ADDRESS}</p>
          <p>Tel: {COMPANY.phone} | Email: {COMPANY.email}</p>
        </div>
      </div>

      {/* Document Title Block - Clean and tidy above ATTN */}
      <div className="border-b border-slate-200 pb-2 mb-4 flex justify-between items-end">
        <h2 className="text-lg md:text-xl font-extrabold tracking-widest text-slate-800 uppercase">
          QUOTATION
        </h2>
        <span className="text-[10px] font-bold text-slate-400 font-mono">
          REF: {refNumber || 'N/A'}
        </span>
      </div>

      {/* Address & Invoice Reference details section */}
      {/* data-track: the parts timed on the client's link (2026-10-20, lib/linkTracker.ts); nothing changes on screen. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm" data-track="client">
        
        {/* Left Column: Client metadata */}
        <div className="space-y-2">
          <div className="flex">
            <span className="font-extrabold text-slate-500 uppercase tracking-wider w-24">Attn:</span>
            <span className="font-bold text-slate-800">{attn || 'N/A'}</span>
          </div>
          <div className="flex">
            <span className="font-extrabold text-slate-500 uppercase tracking-wider w-24">Company:</span>
            <span className="font-extrabold text-slate-900">{company || 'N/A'}</span>
          </div>
          <div className="flex">
            <span className="font-extrabold text-slate-500 uppercase tracking-wider w-24">Address:</span>
            <span className="text-slate-600 font-medium leading-relaxed flex-1">{address || 'N/A'}</span>
          </div>
        </div>

        {/* Right Column: Quotation identifiers */}
        {/* One label column, so the three values line up (Joel, 2026-10-19). */}
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 content-start md:pl-6 md:border-l border-slate-100 font-mono">
          <span className="font-extrabold text-slate-500 uppercase tracking-wider whitespace-nowrap">Ref. Number:</span>
          <span className="font-extrabold text-blue-700 break-all">{refNumber || 'N/A'}</span>
          <span className="font-extrabold text-slate-500 uppercase tracking-wider whitespace-nowrap">Date:</span>
          <span className="font-bold text-slate-700">{date || 'N/A'}</span>
          <span className="font-extrabold text-slate-500 uppercase tracking-wider whitespace-nowrap">Prepared by:</span>
          <span className="text-slate-600 font-semibold">{trainingProvider || 'N/A'}</span>
        </div>

      </div>

      {/* Quotation Logistics details bar */}
      {(!itemsOnly || venue || time) && <div className="bg-slate-50/50 border border-slate-200/80 rounded-lg p-5 grid grid-cols-1 md:grid-cols-3 gap-5 text-sm font-sans shadow-2xs" data-track="details">
        <div>
          <span className="block text-[11px] font-black text-slate-400 uppercase tracking-widest font-mono">Venue Selected</span>
          <span className="font-extrabold text-slate-800 mt-1.5 block">{venue || 'N/A'}</span>
        </div>
        <div>
          <span className="block text-[11px] font-black text-slate-400 uppercase tracking-widest font-mono">Timing Slot</span>
          <span className="font-semibold text-slate-800 mt-1.5 block">{time || 'N/A'}</span>
        </div>
        <div>
          <span className="block text-[11px] font-black text-slate-400 uppercase tracking-widest font-mono">Participants Count</span>
          <span className="font-bold text-blue-600 mt-1.5 block">{participants || 'N/A'}</span>
        </div>
      </div>}

      {/* Main Spreadsheet grid table for Training Courses */}
      <div className="overflow-x-auto pt-2">
        <table className="w-full text-left spreadsheet-grid border border-slate-300 text-sm">
          <thead>
            <tr className="bg-slate-100 border-b border-slate-300 text-[11px] font-black text-slate-500 uppercase tracking-widest font-mono">
              <th className="p-3.5 w-12 text-center border-r border-slate-300">No.</th>
              <th className="p-3.5 border-r border-slate-300">{itemsOnly ? 'Item' : 'Training Program'}</th>
              {!itemsOnly && <>
                <th className="p-3.5 w-32 border-r border-slate-300">Programme Code</th>
                <th className="p-3.5 w-40 border-r border-slate-300">Training Date</th>
                <th className="p-3.5 border-r border-slate-300">Trainer</th>
              </>}
              <th className="p-3.5 w-20 text-center border-r border-slate-300">{itemsOnly ? 'Qty' : 'Days / Qty'}</th>
              <th className="p-3.5 w-32 text-right border-r border-slate-300">{itemsOnly ? 'Price' : 'Rate'}</th>
              <th className="p-3.5 w-32 text-right">{itemsOnly ? 'Total' : 'Total Fee'}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-250 text-slate-800 font-sans" data-track="items">
            {items.map((item, index) => (
              <tr key={item.id} className="hover:bg-slate-50/40">
                <td className="p-3.5 text-center font-mono font-bold border-r border-slate-200">{item.no}</td>
                <td className="p-3.5 font-extrabold text-slate-900 border-r border-slate-200 leading-normal">{item.program}</td>
                {!itemsOnly && <>
                  <td className="p-3.5 font-mono font-semibold text-slate-600 border-r border-slate-200 text-xs">{item.code}</td>
                  <td className="p-3.5 text-slate-600 font-medium border-r border-slate-200 leading-normal">{item.date}</td>
                  <td className="p-3.5 font-semibold text-slate-700 border-r border-slate-200 leading-normal">{item.trainer}</td>
                </>}
                <td className="p-3.5 text-center font-mono font-semibold text-slate-600 border-r border-slate-200">{item.days}</td>
                <td className="p-3.5 text-right font-mono font-bold text-slate-600 border-r border-slate-200">
                  RM {item.feePerDay.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </td>
                <td className="p-3.5 text-right font-mono font-black text-slate-900">
                  RM {item.totalFee.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </td>
              </tr>
            ))}
          </tbody>
          <tbody className="divide-y divide-slate-250 text-slate-800 font-sans" data-track="total">
            {/* SST and Total Rows */}
            {applySST && (
              <>
                <tr className="bg-slate-50/40 border-t border-slate-200 font-bold text-slate-600">
                  <td colSpan={lead} className="p-3.5 border-r border-slate-200 text-right uppercase tracking-wider text-xs font-mono">
                    {itemsOnly ? 'SUB-TOTAL' : 'SUB-TOTAL COURSE FEES'}
                  </td>
                  <td colSpan={2} className="p-3.5 text-right text-sm font-mono font-bold text-slate-700 bg-slate-50/20">
                    RM {grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                </tr>
                <tr className="bg-slate-50/40 border-t border-slate-200 font-bold text-slate-600">
                  <td colSpan={lead} className="p-3.5 border-r border-slate-200 text-right uppercase tracking-wider text-xs font-mono">
                    ADD SST ({sstRate}%)
                  </td>
                  <td colSpan={2} className="p-3.5 text-right text-sm font-mono font-bold text-slate-700 bg-slate-50/20">
                    RM {sstAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              </>
            )}

            {/* Grand Total Row */}
            <tr className="bg-slate-55/60 border-t border-slate-300 font-black">
              <td colSpan={lead} className="p-4 border-r border-slate-200 text-right uppercase tracking-wider text-xs text-slate-500 font-mono">
                {itemsOnly ? 'GRAND TOTAL' : 'GRAND TOTAL COURSE FEES CLAIMABLE'}
                {sstMode === 'included' && <span className="block pt-1 text-[11px] normal-case tracking-normal">(inclusive of {sstRate}% SST)</span>}
                {sstMode === 'none' && <span className="block pt-1 text-[11px] normal-case tracking-normal">(SST not included)</span>}
              </td>
              <td colSpan={2} className="p-4 text-right text-base font-mono font-black text-blue-700 bg-slate-50">
                RM {finalTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </td>
            </tr>
            {sstMode === 'included' && (
              <tr className="border-t border-slate-200 text-slate-500">
                <td colSpan={lead} className="p-3 border-r border-slate-200 text-right uppercase tracking-wider text-xs font-mono">
                  SST INCLUDED ABOVE ({sstRate}%)
                </td>
                <td colSpan={2} className="p-3 text-right text-sm font-mono">
                  RM {money(sstAmount)}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Remarks Section */}
      <div className="space-y-2 pt-4 border-t border-slate-100" data-track="remarks">
        <h4 className="text-sm font-black text-slate-800 uppercase tracking-wider font-mono">
          Remarks:
        </h4>
        <ul className="space-y-1.5 text-xs md:text-sm text-slate-600 list-none leading-relaxed pl-1">
          {remarks.map((r, idx) => (
            <li key={idx} className="flex items-start gap-1">
              <span className="font-extrabold pr-1">•</span>
              <span className="font-medium">{r}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* PAGE BREAK INDICATOR (FOR PRINT PAGINATION TO ENSURE TERMS & CONDITIONS SPLIT TO PAGE 2 NICELY) */}
      <div className="page-break" />

      {/* Terms and Conditions Section */}
      {itemsOnly ? (terms.some(t => t.trim()) && (
        <div className="space-y-3 pt-4 border-t border-slate-200" data-track="terms">
          <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest font-mono border-b border-slate-100 pb-1">TERMS AND CONDITIONS</h3>
          <ul className="space-y-1 list-none pl-2 text-[11px] md:text-xs text-slate-600 leading-relaxed font-medium">
            {terms.filter(t => t.trim()).map((t, idx) => (
              <li key={idx} className="flex items-start gap-1"><span className="font-extrabold text-slate-400 pr-1">-</span><span>{t}</span></li>
            ))}
          </ul>
        </div>
      )) : (
      <div className="space-y-4 pt-4 border-t border-slate-200" data-track="terms">
        <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest font-mono border-b border-slate-100 pb-1">
          TERMS AND CONDITIONS
        </h3>

        <div className="grid grid-cols-1 gap-4 text-xs md:text-sm text-slate-600 leading-relaxed font-medium">
          
          {/* Standard bullet lines matching original document terms */}
          <div className="space-y-2.5">
            <p className="font-bold text-slate-800 uppercase tracking-wider">
              1. Cancellation & Rescheduling Policy:
            </p>
            <ul className="space-y-1 list-none pl-2 text-[11px] md:text-xs">
              {terms.filter(t => t.toLowerCase().includes('cancel') || t.toLowerCase().includes('resched')).map((t, idx) => (
                <li key={idx} className="flex items-start gap-1">
                  <span className="font-extrabold text-slate-400 pr-1">-</span>
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-2.5 pt-2">
            <p className="font-bold text-slate-800 uppercase tracking-wider">
              2. Participant Requirements:
            </p>
            <ul className="space-y-1 list-none pl-2 text-[11px] md:text-xs">
              {terms.filter(t => t.toLowerCase().includes('particip') || t.toLowerCase().includes('attend')).map((t, idx) => (
                <li key={idx} className="flex items-start gap-1">
                  <span className="font-extrabold text-slate-400 pr-1">-</span>
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            <div className="space-y-2">
              <p className="font-bold text-slate-800 uppercase tracking-wider">
                3. Training Materials & Intellectual Property:
              </p>
              <ul className="space-y-1 list-none pl-2 text-[11px] md:text-xs">
                {terms.filter(t => t.toLowerCase().includes('material') || t.toLowerCase().includes('intellect') || t.toLowerCase().includes('reproduce')).map((t, idx) => (
                  <li key={idx} className="flex items-start gap-1">
                    <span className="font-extrabold text-slate-400 pr-1">-</span>
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-2">
              <p className="font-bold text-slate-800 uppercase tracking-wider">
                4. Confidentiality & Data Protection:
              </p>
              <ul className="space-y-1 list-none pl-2 text-[11px] md:text-xs">
                {terms.filter(t => t.toLowerCase().includes('confident') || t.toLowerCase().includes('personal info') || t.toLowerCase().includes('data protect')).map((t, idx) => (
                  <li key={idx} className="flex items-start gap-1">
                    <span className="font-extrabold text-slate-400 pr-1">-</span>
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Additional / Unmatched terms */}
          {terms.some(t => {
            const text = t.toLowerCase();
            return !(text.includes('cancel') || text.includes('resched') ||
                     text.includes('particip') || text.includes('attend') ||
                     text.includes('material') || text.includes('intellect') || text.includes('reproduce') ||
                     text.includes('confident') || text.includes('personal info') || text.includes('data protect'));
          }) && (
            <div className="space-y-2.5 pt-2 border-t border-slate-100">
              <p className="font-bold text-slate-800 uppercase tracking-wider">
                5. Additional Terms & Conditions:
              </p>
              <ul className="space-y-1 list-none pl-2 text-[11px] md:text-xs">
                {terms.filter(t => {
                  const text = t.toLowerCase();
                  return !(text.includes('cancel') || text.includes('resched') ||
                           text.includes('particip') || text.includes('attend') ||
                           text.includes('material') || text.includes('intellect') || text.includes('reproduce') ||
                           text.includes('confident') || text.includes('personal info') || text.includes('data protect'));
                }).map((t, idx) => (
                  <li key={idx} className="flex items-start gap-1">
                    <span className="font-extrabold text-slate-400 pr-1">-</span>
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

        </div>
      </div>
      )}

      {/* Signatures: NEXT Academy's signatory on the left (QUOTE_SIGNATORY), the client's on the right. */}
      <div className="pt-12 flex justify-between items-end gap-8 text-sm font-sans" data-track="sign">
        <div className="w-56">
          <p className="font-bold text-slate-500">Prepared By:</p>
          <p className="h-16 flex items-end pl-2 pb-1 text-[40px] leading-none text-[#1e3a8a] -rotate-3 origin-bottom-left" style={{ fontFamily: SIGNATURE_FONT }}>
            {QUOTE_SIGNATORY.name}
          </p>
          <div className="border-t border-slate-300 pt-1.5">
            <p className="font-extrabold text-slate-800">{QUOTE_SIGNATORY.name}</p>
            <p className="text-xs text-slate-400 font-mono font-semibold">{QUOTE_SIGNATORY.title}, NEXT Academy</p>
          </div>
        </div>
        <div className="w-56">
          <p className="font-bold text-slate-500">Accepted By:</p>
          <div className="h-16" />
          <div className="border-t border-slate-300 pt-1.5">
            <p className="font-extrabold text-slate-800">Authorized Signatory</p>
            <p className="text-xs text-slate-400 font-mono font-semibold">Designation & Stamp</p>
          </div>
        </div>
      </div>

                </div>

    </div>
  );
}
