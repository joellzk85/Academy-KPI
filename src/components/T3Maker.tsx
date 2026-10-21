import React, { useEffect, useRef, useState } from 'react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { ChevronDown, ChevronUp, Download, FileUp, Loader2, Plus, Trash2 } from 'lucide-react';
import { db } from '../lib/firebase';
import { addDays, trainingDays } from '../lib/deals';
import { NAME_LIST_ACCEPT, NAME_LIST_KINDS, Trainee, blankTrainee, completeTrainee, readNameList } from '../lib/t3Names';
import { T3_DAYS_PER_SHEET, makeT3Pdf } from '../lib/t3Pdf';
import { pdfErrorText } from '../lib/oldTab';
import { safeFileName } from '../lib/checklistFiles';
import { useAutoSave } from '../lib/useAutoSave';

// The T3 attendance form maker on the "Attendance list" step (HRDC deals; 2026-10-21, details in lib/t3Pdf.ts).
// HR's name list (dropped in the step's box, or chosen here) is read into a table Admin can check and fix;
// "Download T3 form" fills HRDC's form with it. The signed form goes back in at "Verify T3 attendance".
// The list is kept on the deal's checklist (deal_checklists/{dealId}.t3) and saves itself as it's edited.

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };
export type T3Data = { trainees: Trainee[]; courseTitle?: string; dates?: string[]; fileName?: string; updatedAt?: string; byName?: string };

const input =
  'w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';
const iconBtn = 'rounded-md p-1.5 text-ink-soft hover:bg-surface hover:text-danger disabled:opacity-30';

// The training days from the deal: back to back from the training date (half days count as a day).
export function dealDates(deal: any): string[] {
  const start = String(deal?.trainingDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return [];
  return Array.from({ length: Math.max(1, Math.ceil(trainingDays(deal))) }, (_, i) => addDays(start, i));
}

const NOT_ON_FORM = /[^\u0000-ÿ–—‘’“”]/;

export default function T3Maker({ deal, saved, viewer, incoming }: {
  deal: any;
  saved?: T3Data;                                         // deal_checklists/{dealId}.t3
  viewer: Viewer;
  incoming?: { files: File[]; at: number } | null;      // files just dropped in the Attendance list box
}) {
  const [data, setData] = useState<T3Data>(() => saved || { trainees: [] });
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(saved || { trainees: [] }));
  const [open, setOpen] = useState(false);
  const [reading, setReading] = useState(false);
  const [making, setMaking] = useState(false);
  const [error, setError] = useState('');
  const [found, setFound] = useState<{ list: Trainee[]; file: string } | null>(null);   // waiting for Replace / Add below
  const [programme, setProgramme] = useState('');
  const [employer, setEmployer] = useState('');
  const pick = useRef<HTMLInputElement>(null);

  // Someone else's change arriving, while nothing here is unsaved.
  const json = JSON.stringify(data);
  const dirty = json !== savedJson;
  useEffect(() => {
    const s = JSON.stringify(saved || { trainees: [] });
    if (!dirty && s !== savedJson) { setData(saved || { trainees: [] }); setSavedJson(s); }
  }, [JSON.stringify(saved)]);

  // The course title (the programme's name) and the employer (the client's employer name, else its company name).
  useEffect(() => {
    let live = true;
    if (deal.programmeId) getDoc(doc(db, 'programmes', deal.programmeId)).then(s => live && setProgramme(s.data()?.name || '')).catch(() => {});
    if (deal.clientId) {
      getDoc(doc(db, 'clients', deal.clientId)).then(s => {
        const c = s.data();
        if (live) setEmployer(String(c?.employerName || c?.companyName || deal.client || '').trim());
      }).catch(() => {});
    } else setEmployer(String(deal.client || '').trim());
    return () => { live = false; };
  }, [deal.programmeId, deal.clientId]);

  const auto = useAutoSave({
    value: data, dirty, enabled: true,
    write: async v => {
      await updateDoc(doc(db, 'deal_checklists', deal.id), {
        t3: JSON.parse(JSON.stringify({ ...v, updatedAt: new Date().toISOString(), byName: viewer.name })),
      });
    },
    onSaved: setSavedJson,
  });

  const courseTitle = data.courseTitle ?? (programme || deal.courseName || '');
  const dates = data.dates?.length ? data.dates : dealDates(deal);
  const named = data.trainees.filter(t => t.name.trim());

  const change = (next: Partial<T3Data>) => setData(d => ({ ...d, ...next }));
  const setTrainee = (i: number, c: Partial<Trainee>) => change({ trainees: data.trainees.map((t, j) => (j === i ? { ...t, ...c } : t)) });
  // After the IC is typed: tidy it and fill sex and citizenship when they're empty.
  const tidyTrainee = (i: number) => setTrainee(i, completeTrainee(data.trainees[i]));
  const withEmployer = (list: Trainee[]) => list.map(t => ({ ...t, employer: t.employer || employer }));

  const read = async (file: File) => {
    setError('');
    setReading(true);
    try {
      const list = withEmployer(await readNameList(file));
      if (named.length) setFound({ list, file: file.name });
      else change({ trainees: list, fileName: file.name });
      setOpen(true);
    } catch (e: any) {
      setError(e?.message || String(e));
      setOpen(true);
    } finally {
      setReading(false);
    }
  };

  // A name list dropped in the Attendance list box is read too.
  const seen = useRef(0);
  useEffect(() => {
    if (!incoming || incoming.at === seen.current) return;
    seen.current = incoming.at;
    const list = incoming.files.find(f => /\.(xlsx|csv|docx|pdf)$/i.test(f.name));
    if (list) read(list);
  }, [incoming?.at]);

  const download = async () => {
    setError('');
    if (!named.length) return setError('Add at least one name first.');
    setMaking(true);
    try {
      auto.flush();   // saves the list too; the download doesn't wait for it (slow internet)
      const bytes = await makeT3Pdf({ courseTitle, dates, trainees: named });
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = safeFileName(`T3 attendance - ${courseTitle || 'training'} - ${dates[0] || ''}.pdf`);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      setError(pdfErrorText(e).replace(' Open Preview and use Print → Save as PDF instead.', ''));
    } finally {
      setMaking(false);
    }
  };

  const status = auto.state.status === 'error' && dirty ? { t: `Couldn't save (${auto.state.error}). Trying again.`, c: 'text-danger' }
    : auto.state.status === 'saving' ? { t: 'Saving…', c: 'text-ink-soft' }
    : dirty ? { t: 'Saves in a moment', c: 'text-attention' }
    : { t: data.updatedAt ? 'Saved' : '', c: 'text-ink-soft' };
  const oddNames = named.filter(t => NOT_ON_FORM.test(t.name + t.employer));
  const sets = Math.ceil(dates.length / T3_DAYS_PER_SHEET);

  return (
    <div className="mt-3 rounded-xl border border-line bg-surface/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">T3 attendance form</p>
          <p className="text-sm text-ink-soft">
            {named.length ? `${named.length} name${named.length === 1 ? '' : 's'}${data.fileName ? ` from ${data.fileName}` : ''}` : "Drop HR's name list above, or choose it here, and the form fills itself."}
          </p>
        </div>
        <input ref={pick} type="file" accept={NAME_LIST_ACCEPT} className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) read(f); }} />
        <button type="button" className={btnSecondary} disabled={reading} onClick={() => pick.current?.click()}>
          {reading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />} {reading ? 'Reading…' : 'Read a name list'}
        </button>
        <button type="button" className={btnPrimary} disabled={making || !named.length} onClick={download}>
          {making ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download T3 form
        </button>
        <button type="button" className={btnSecondary} aria-expanded={open} onClick={() => setOpen(o => !o)}>
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />} {open ? 'Hide' : named.length ? 'Check names' : 'Type names'}
        </button>
      </div>

      {error && <p role="alert" className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      {found && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-attention/30 bg-attention-soft px-3 py-2 text-sm">
          <span className="flex-1">Found {found.list.length} name{found.list.length === 1 ? '' : 's'} in {found.file}. The list already has {named.length}.</span>
          <button type="button" className={btnSecondary} onClick={() => { change({ trainees: found.list, fileName: found.file }); setFound(null); }}>Replace the list</button>
          <button type="button" className={btnSecondary} onClick={() => { change({ trainees: [...named, ...found.list] }); setFound(null); }}>Add below</button>
          <button type="button" className="px-2 text-sm font-semibold text-ink-soft hover:text-ink" onClick={() => setFound(null)}>Cancel</button>
        </div>
      )}

      {open && (
        <div className="mt-3 space-y-3">
          <div className="grid gap-2 sm:grid-cols-[2fr_1fr]">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-ink-soft">Course title</span>
              <input className={input} value={courseTitle} onChange={e => change({ courseTitle: e.target.value })} placeholder="Programme name" />
            </label>
            <div>
              <span className="mb-1 block text-sm font-medium text-ink-soft">Training days</span>
              <div className="space-y-1.5">
                {dates.map((d, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <span className="w-12 shrink-0 text-sm text-ink-soft">Day {i + 1}</span>
                    <input type="date" className={input} value={d} aria-label={`Day ${i + 1} date`}
                      onChange={e => change({ dates: dates.map((x, j) => (j === i ? e.target.value : x)) })} />
                    {dates.length > 1 && (
                      <button type="button" className={iconBtn} aria-label={`Remove day ${i + 1}`} onClick={() => change({ dates: dates.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></button>
                    )}
                  </div>
                ))}
                <button type="button" className="inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline"
                  onClick={() => change({ dates: [...dates, dates.length ? addDays(dates[dates.length - 1], 1) : ''] })}><Plus className="h-3.5 w-3.5" /> Add a day</button>
              </div>
            </div>
          </div>
          {dates.length > 1 && (
            <p className="text-sm text-ink-soft">
              Each person signs every day on the same row (one signature column per day).
              {sets > 1 && ` Up to ${T3_DAYS_PER_SHEET} days fit on one sheet, so the form comes as ${sets} sets: days 1 to ${T3_DAYS_PER_SHEET}, then the rest.`}
            </p>
          )}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-ink-soft">
                  <th className="w-8 py-1 pr-1 font-medium">No.</th>
                  <th className="py-1 pr-1.5 font-medium">Name</th>
                  <th className="py-1 pr-1.5 font-medium">Employer</th>
                  <th className="w-36 py-1 pr-1.5 font-medium">NRIC</th>
                  <th className="w-32 py-1 pr-1.5 font-medium">Citizenship</th>
                  <th className="w-24 py-1 pr-1.5 font-medium">Sex</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {data.trainees.map((t, i) => (
                  <tr key={i}>
                    <td className="py-1 pr-1 tabular-nums text-ink-soft">{i + 1}</td>
                    <td className="py-1 pr-1.5"><input className={input} value={t.name} aria-label={`Name ${i + 1}`} onChange={e => setTrainee(i, { name: e.target.value })} /></td>
                    <td className="py-1 pr-1.5"><input className={input} value={t.employer} aria-label={`Employer ${i + 1}`} onChange={e => setTrainee(i, { employer: e.target.value })} /></td>
                    <td className="py-1 pr-1.5"><input className={input} value={t.ic} aria-label={`NRIC ${i + 1}`} onChange={e => setTrainee(i, { ic: e.target.value })} onBlur={() => tidyTrainee(i)} /></td>
                    <td className="py-1 pr-1.5">
                      <input className={input} list="t3-citizenship" value={t.citizenship} aria-label={`Citizenship ${i + 1}`} onChange={e => setTrainee(i, { citizenship: e.target.value })} />
                    </td>
                    <td className="py-1 pr-1.5">
                      <select className={input} value={t.sex} aria-label={`Sex ${i + 1}`} onChange={e => setTrainee(i, { sex: e.target.value })}>
                        <option value="" />
                        <option>Male</option>
                        <option>Female</option>
                        {t.sex && t.sex !== 'Male' && t.sex !== 'Female' && <option>{t.sex}</option>}
                      </select>
                    </td>
                    <td className="py-1"><button type="button" className={iconBtn} aria-label={`Remove ${t.name || `row ${i + 1}`}`} onClick={() => change({ trainees: data.trainees.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <datalist id="t3-citizenship"><option value="Malaysian" /><option value="Non-Malaysian" /></datalist>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={btnSecondary} onClick={() => change({ trainees: [...data.trainees, blankTrainee(employer)] })}><Plus className="h-4 w-4" /> Add a person</button>
            {data.trainees.length > 0 && (
              <button type="button" className="text-sm font-semibold text-ink-soft hover:text-danger"
                onClick={() => { if (window.confirm(`Clear all ${data.trainees.length} names from the T3 list?`)) change({ trainees: [], fileName: '' }); }}>Clear the list</button>
            )}
            <span className={`ml-auto text-sm ${status.c}`}>{status.t}</span>
          </div>
          {oddNames.length > 0 && (
            <p className="text-sm text-attention">
              The form can only print English letters, so characters like Chinese or Tamil script show as "?" for: {oddNames.map(t => t.name).join(', ')}. Type those names in English letters.
            </p>
          )}
          <p className="text-sm text-ink-soft">
            Reads {NAME_LIST_KINDS}. Sex and citizenship are worked out from a Malaysian IC when the list leaves them out. After the training, upload the signed form at "Verify T3 attendance".
          </p>
        </div>
      )}
    </div>
  );
}
