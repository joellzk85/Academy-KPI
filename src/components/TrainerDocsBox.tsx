import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { ArrowLeft, ChevronDown, ChevronRight, Eye, Laptop, RefreshCw, Smartphone } from 'lucide-react';
import { db } from '../lib/firebase';
import { formatDate } from '../lib/deals';
import { resolveTb } from '../lib/teambuilding';
import { TrainerDoc, TrainerDocKind, TrainerTb, docSummary, docTitle, newerFromTrainer, trainerPreviewTb } from '../lib/trainerDocs';
import TeambuildingSite from './TeambuildingSite';
import PhoneFrame from './PhoneFrame';

// What trainers wrote in the trainer portal (2026-10-21; lib/trainerDocs.ts), in the CRM: the "From trainers" box on
// Course outlines and Teambuilding proposal ("Use for a deal" makes our own copy), and the notice on our copy when the
// trainer has sent a newer version.

const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';
const linkBtn = 'text-sm font-semibold text-accent hover:underline';
const day = (ms?: number) => (ms ? formatDate(new Date(ms).toISOString().slice(0, 10)) : '');

// Trainers' documents they have sent to us (drafts never reach the CRM; removed ones are left out).
export function useTrainerDocs(kind: TrainerDocKind): TrainerDoc[] {
  const [list, setList] = useState<TrainerDoc[]>([]);
  useEffect(() => onSnapshot(query(collection(db, 'trainer_docs')),
    s => setList(s.docs.map(d => ({ ...(d.data() as TrainerDoc), id: d.id })).filter(d => d.kind === kind && d.sent && !d.archived)),
    () => setList([])), [kind]);
  return list;
}

type Ours = { id: string; fromTrainerDocId?: string; fromTrainerDocVersion?: number };

export function FromTrainers({ kind, docs, ours, programmes, onUse, onPreview }: {
  kind: TrainerDocKind; docs: TrainerDoc[]; ours: Ours[]; programmes: { id: string; name: string }[];
  onUse: (d: TrainerDoc) => void; onPreview: (d: TrainerDoc) => void;
}) {
  const usedBy = (d: TrainerDoc) => ours.filter(o => o.fromTrainerDocId === d.id);
  const fresh = (d: TrainerDoc) => !usedBy(d).length;
  const behind = (d: TrainerDoc) => usedBy(d).some(o => newerFromTrainer(o, [d]));
  const sorted = [...docs].sort((a, b) => Number(fresh(b)) - Number(fresh(a)) || (b.sentAt || 0) - (a.sentAt || 0));
  const news = docs.filter(d => fresh(d) || behind(d)).length;
  const [open, setOpen] = useState<boolean | null>(null);
  const shown = open ?? news > 0;
  if (!docs.length) return null;
  const what = kind === 'outline' ? 'Course outlines' : 'Teambuilding proposals';
  return (
    <section className={`rounded-2xl border p-4 ${news ? 'border-accent/40 bg-accent-soft/40' : 'border-line bg-white'}`}>
      <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => setOpen(!shown)} aria-expanded={shown}>
        {shown ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <span className="font-bold">{what} from trainers ({docs.length})</span>
        {news > 0 && <span className="rounded bg-accent px-1.5 text-xs font-semibold text-white">{news} new or updated</span>}
      </button>
      {shown && (
        <>
          <p className="mt-1 text-sm text-ink-soft">Written by trainers in the trainer portal. <strong>Use for a deal</strong> makes our own copy, for a deal or as a general one; the trainer's version stays theirs.</p>
          <ul className="mt-3 space-y-2">
            {sorted.map(d => {
              const n = usedBy(d).length;
              return (
                <li key={d.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-white px-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5 font-semibold">
                      <span className="truncate">{docTitle(kind, d.sent, programmes) || 'Untitled'}</span>
                      {fresh(d) && <span className="rounded bg-accent-soft px-1.5 text-xs font-semibold text-accent">New</span>}
                      {behind(d) && <span className="rounded bg-attention-soft px-1.5 text-xs font-semibold text-attention">Updated by the trainer</span>}
                    </span>
                    <span className="block truncate text-sm text-ink-soft">
                      {[d.trainerName || 'A trainer', docSummary(kind, d.sent), `sent ${day(d.sentAt)}`, d.version > 1 ? `version ${d.version}` : '', n ? `used ${n === 1 ? 'once' : `${n} times`}` : ''].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <button type="button" className={btnSecondary} onClick={() => onPreview(d)}><Eye className="h-4 w-4" /> Preview</button>
                  <button type="button" className={btnPrimary} onClick={() => onUse(d)}>Use for a deal</button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

// On our copy: the trainer sent a newer version since we made (or last updated) it.
export function TrainerUpdateBanner({ doc, locked, onBring, onKeep, onPreview }: {
  doc: TrainerDoc; locked: boolean; onBring: () => void; onKeep: () => void; onPreview: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-attention/40 bg-attention-soft px-4 py-3 text-[15px]">
      <RefreshCw className="h-5 w-5 shrink-0 text-attention" />
      <p className="min-w-0 flex-1">
        <strong>{doc.trainerName || 'The trainer'} updated this on {day(doc.sentAt)}</strong> (version {doc.version}).{' '}
        {locked ? 'This copy is sent and locked: click Revise first to bring in their changes.' : 'Bring in their changes? It replaces the parts they write; check it, then save.'}
      </p>
      <span className="flex flex-wrap gap-2">
        <button type="button" className={btnSecondary} onClick={onPreview}><Eye className="h-4 w-4" /> See their version</button>
        {!locked && <button type="button" className={btnPrimary} onClick={onBring}>Bring in the changes</button>}
        <button type="button" className={linkBtn} onClick={onKeep}>Keep ours</button>
      </span>
    </div>
  );
}

// A trainer's teambuilding proposal as the client would see it (their parts only).
export function TbTrainerPreview({ tb, trainers, who, onClose, actions }: {
  tb: TrainerTb; trainers: any[]; who?: string; onClose: () => void; actions?: React.ReactNode;
}) {
  const [phone, setPhone] = useState(false);
  const r = useMemo(() => resolveTb(trainerPreviewTb(tb), { clients: [], deals: [], venues: [], people: [], trainers }), [tb, trainers]);
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#e9efed] font-sans text-ink" role="dialog" aria-modal="true" aria-label="Trainer's teambuilding proposal">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-white px-4 py-2.5">
        <button type="button" className={btnSecondary} onClick={onClose}><ArrowLeft className="h-4 w-4" /> Close preview</button>
        <div className="inline-flex rounded-lg border border-line bg-white p-0.5">
          <button type="button" onClick={() => setPhone(false)} className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-semibold ${!phone ? 'bg-ink text-white' : 'text-ink-soft'}`}><Laptop className="h-4 w-4" /> Computer</button>
          <button type="button" onClick={() => setPhone(true)} className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-semibold ${phone ? 'bg-ink text-white' : 'text-ink-soft'}`}><Smartphone className="h-4 w-4" /> Phone</button>
        </div>
        <span className="min-w-0 flex-1 text-sm text-ink-soft">By {who || 'the trainer'}. Packages, venues, HRDC and terms are added on our copy.</span>
        {actions}
      </div>
      <div className="flex-1 overflow-hidden p-0 sm:p-4">
        {phone ? (
          <div className="mx-auto h-full w-[410px] max-w-full overflow-hidden rounded-[2rem] border-[10px] border-ink bg-white shadow-xl">
            <PhoneFrame><TeambuildingSite r={r} /></PhoneFrame>
          </div>
        ) : (
          <div className="mx-auto h-full max-w-[1400px] overflow-y-auto bg-white shadow-xl sm:rounded-xl"><TeambuildingSite r={r} /></div>
        )}
      </div>
    </div>
  );
}
