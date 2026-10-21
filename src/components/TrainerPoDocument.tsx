// Trainer PO (Joel, 2026-10-21: "trainer can download their PO - PDF"). Made from the deal, the trainer and the fee
// line(s) Admin raised on the deal's Trainer step, so nothing is typed twice. "Make PO" on the Trainer step saves the
// PDF as that step's PO file (checklist_files), the one place the CRM, the Overview and the trainer portal read it.
// The sheet has the class "print-paper" so makeDocumentPdf can find it.
// Since 2026-10-21 the PO is also made automatically (buildPo, lib/trainerPortal.ts): the portal makes the PDF from
// it, so "Make PO" is optional (a saved copy, e.g. for a trainer without portal access).

import React, { useState } from 'react';
import { getDoc, doc } from 'firebase/firestore';
import { FileText, Loader2 } from 'lucide-react';
import { db } from '../lib/firebase';
import { COMPANY, QUOTE_SIGNATORY } from '../lib/company';
import { formatDate, formatRM, todayIso, trainingDateText } from '../lib/deals';
import { ChecklistFile } from '../lib/checklistFiles';
import { PoInput, buildPo, poLines } from '../lib/trainerPortal';
import { uploadOne } from './ChecklistFiles';

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };

export type { PoInput };

export default function TrainerPoDocument({ po }: { po: PoInput }) {
  const cell = 'border border-slate-300 px-3 py-2 align-top';
  const total = po.lines.reduce((t, l) => t + l.amount, 0);
  return (
    <div className="print-paper space-y-6 bg-white p-12 font-sans text-[13px] text-slate-900">
      <div className="flex items-start justify-between gap-6 border-b-2 border-[#0E6E62] pb-4">
        <div>
          <p className="text-base font-bold">{COMPANY.name} <span className="text-xs font-normal">({COMPANY.regNo})</span></p>
          {COMPANY.addressLines.map(l => <p key={l}>{l}</p>)}
          <p>{COMPANY.phone} · {COMPANY.email}</p>
        </div>
        <div className="text-right">
          <p className="text-xl font-bold tracking-wide text-[#0E6E62]">PURCHASE ORDER</p>
          <p className="mt-1"><span className="font-semibold">PO No.:</span> {po.number}</p>
          <p><span className="font-semibold">Date:</span> {formatDate(po.date)}</p>
        </div>
      </div>

      <section className="grid grid-cols-2 gap-6">
        <div>
          <p className="mb-1 font-bold">To (trainer)</p>
          <p className="font-semibold">{po.trainer.name}</p>
          {po.trainer.address && <p className="whitespace-pre-line">{po.trainer.address}</p>}
          {po.trainer.contact && <p>{po.trainer.contact}</p>}
          {po.trainer.email && <p>{po.trainer.email}</p>}
        </div>
        <table className="w-full border-collapse self-start">
          <tbody>
            {([['Programme', po.programme], ['Client', po.client], ['Date(s)', po.dates], ['Venue', po.venue]] as const).map(([k, v]) => (
              <tr key={k}><td className={`${cell} w-[34%] font-semibold`}>{k}</td><td className={cell}>{v || ' '}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-slate-100"><th className={`${cell} w-10 text-left`}>No.</th><th className={`${cell} text-left`}>Description</th><th className={`${cell} w-40 text-right`}>Amount (RM)</th></tr>
        </thead>
        <tbody>
          {po.lines.map((l, i) => (
            <tr key={i}><td className={cell}>{i + 1}</td><td className={cell}>{l.description}</td><td className={`${cell} text-right tabular-nums`}>{formatRM(l.amount).replace(/^RM\s?/, '')}</td></tr>
          ))}
          <tr><td className={cell} /><td className={`${cell} text-right font-bold`}>Total</td><td className={`${cell} text-right font-bold tabular-nums`}>{formatRM(total)}</td></tr>
        </tbody>
      </table>

      <section className="space-y-1">
        <p className="font-bold">Terms</p>
        <p>1. Payment is made after the training, once NEXT Academy receives the training photos and the signed T3 attendance form (through the NEXT Academy trainer portal).</p>
        <p>2. Please accept this PO in the trainer portal, or sign and return a copy.</p>
        {po.bank && <p>3. Payment to: {po.bank}</p>}
      </section>

      <section className="grid grid-cols-2 gap-10 pt-8">
        <div><div className="h-10 border-b border-slate-400" /><p className="mt-1 font-semibold">{QUOTE_SIGNATORY.name}, {QUOTE_SIGNATORY.title}</p><p>For {COMPANY.name}</p></div>
        <div><div className="h-10 border-b border-slate-400" /><p className="mt-1 font-semibold">Accepted by {po.trainer.name}</p><p>Date:</p></div>
      </section>
    </div>
  );
}

// "Make PO" on the deal's Trainer step (Admin and Management): builds the PDF and saves it as the step's PO file.
export function MakePoButton({ deal, task, trainer, venueName, outs, vendor, viewer, onSaved }: {
  deal: any; task: { id: string; label: string }; trainer: any | null; venueName: string; outs: any[]; vendor: any | null; viewer: Viewer;
  onSaved: (list: ChecklistFile[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lines = poLines(outs, deal.id, task.id);
  const make = async () => {
    setError('');
    if (!trainer) return setError('Choose the trainer from the Trainers list first.');
    if (!lines.length) return setError("Add the trainer's fee below first, so the PO shows the amount.");
    setBusy(true);
    try {
      const client = deal.clientId ? (await getDoc(doc(db, 'clients', deal.clientId))).data() : null;
      const po = buildPo({ deal, dates: trainingDateText(deal, true), date: todayIso(), trainer, client: String(client?.companyName || deal.client || ''), venue: venueName, lines, vendor });
      const { makeDocumentPdf } = await import('../lib/quotePdf');
      const blob = await makeDocumentPdf(React.createElement(TrainerPoDocument, { po }), `PO ${po.number}`);
      const file = new File([blob], `${po.number} ${trainer.name}.pdf`.replace(/[\\/:*?"<>|]+/g, ''), { type: 'application/pdf' });
      const rec = await uploadOne(deal.id, task, file, viewer, () => {});
      onSaved([rec]);
    } catch (e: any) {
      setError(e?.message || "The PO couldn't be made. Try again.");
    } finally { setBusy(false); }
  };
  return (
    <div className="mt-2 space-y-1">
      <button type="button" disabled={busy} onClick={make}
        className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-semibold text-ink hover:bg-surface disabled:opacity-60">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} Make PO (PDF)
      </button>
      <p className="text-xs text-ink-soft">Portal trainers get their PO automatically once the trainer fee below is added. This saves a PDF copy here, e.g. to WhatsApp a trainer without portal access.</p>
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
