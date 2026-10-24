import React, { useEffect, useRef, useState } from 'react';
import { collection, doc, onSnapshot, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';
import { ExternalLink, FileText, Loader2, Search, Trash2, Upload, X } from 'lucide-react';
import { db, friendlyError, storage } from '../lib/firebase';
import { linkedOnly } from '../lib/linked';
import { Programme, ProgrammeFile } from '../lib/programmes';
import { PROPOSAL_ACCEPT, proposalFileProblem, proposalType, safeFileName, sizeText } from '../lib/proposals';
import { useCloseOnOutside } from '../lib/useCloseOnOutside';
import { storageError } from './ProposalFiles';

// A programme's course outlines, outline files and trainers, linked from the programme itself (Joel, 2026-10-23:
// "the programme approved is not linked to the course outline"). An outline points to one programme (programmeId);
// its own title is kept, so an outline can suit a programme with a different name. A trainer ticks programmes
// (programmeIds). Outline files (PDF, Word or PowerPoint) are kept on the programme at programme_files/{id}/...

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';

const norm = (s?: string) => String(s || '').trim().toLowerCase();

/** The title an outline shows: the programme's name while it follows it, else its own. */
export function outlineTitle(o: any, programmes: Programme[]): string {
  const own = String(o.courseTitle || '').trim();
  if (o.status !== 'sent' && o.useProgrammeName && o.programmeId) return String(programmes.find(p => p.id === o.programmeId)?.name || own).trim();
  return own;
}

/** Links an outline to a programme (or unlinks it with ''). A draft keeps the title it shows now. */
export async function linkOutline(o: any, programmeId: string, programmes: Programme[]) {
  const data: any = { programmeId };
  if (o.status !== 'sent') {
    const title = outlineTitle(o, programmes);
    const progName = String(programmes.find(p => p.id === programmeId)?.name || '').trim();
    data.useProgrammeName = !!programmeId && (!title || norm(title) === norm(progName));
    data.courseTitle = title || progName;
  }
  await updateDoc(doc(db, 'course_outlines', o.id), data);
}

/** Opens a programme's outline file in a new tab. */
export async function openProgrammeFile(f: ProgrammeFile) {
  const w = window.open('', '_blank');   // opened straight from the click so it isn't blocked
  try {
    const url = await getDownloadURL(ref(storage, f.path));
    if (w) w.location.href = url; else window.open(url, '_blank');
  } catch (e) {
    w?.close();
    window.alert(storageError(e));
  }
}

// ---------- Search box with a short list of matches ----------
function AddSearch<T>({ placeholder, items, text, sub, onPick }: {
  placeholder: string; items: T[]; text: (x: T) => string; sub?: (x: T) => string; onPick: (x: T) => void;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useCloseOnOutside(box, open, () => setOpen(false));
  const t = norm(q);
  const matches = (t ? items.filter(x => norm(`${text(x)} ${sub ? sub(x) : ''}`).includes(t)) : items).slice(0, 8);
  return (
    <div ref={box} className="relative mt-2">
      <Search className="pointer-events-none absolute left-3 top-[19px] h-4 w-4 -translate-y-1/2 text-ink-soft" />
      <input value={q} onChange={e => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder={placeholder} aria-label={placeholder} className={`${input} pl-9`} />
      {open && (
        <div className="mt-1 max-h-72 overflow-y-auto rounded-lg border border-line bg-white shadow-lg">
          {matches.map((x, i) => (
            <button key={i} type="button" onClick={() => { onPick(x); setQ(''); setOpen(false); }} className="block w-full px-3 py-2 text-left hover:bg-surface">
              <span className="block truncate text-sm font-semibold">{text(x)}</span>
              {sub && sub(x) && <span className="block truncate text-sm text-ink-soft">{sub(x)}</span>}
            </button>
          ))}
          {matches.length === 0 && <p className="px-3 py-2 text-sm text-ink-soft">Nothing matches.</p>}
        </div>
      )}
    </div>
  );
}

// ---------- On the title's details (Course outlines / Teambuilding proposal → By title) ----------
export default function ProgrammeLinks({ programme, programmes, outlines, deals, trainers, viewer, hideOutlines }: {
  programme: Programme; programmes: Programme[]; outlines: any[]; deals: any[]; trainers: any[]; viewer: Viewer;
  hideOutlines?: boolean;   // a teambuilding title: no course outlines to link
}) {
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const progName = (id: string) => String(programmes.find(p => p.id === id)?.name || '').trim();
  const dealOf = (o: any) => (o.pipelineId ? deals.find(d => d.id === o.pipelineId) || null : null);
  const live = outlines.filter(o => !o.isHidden && o.id !== 'outline_default' && !o.dealDeleted);
  const own = live.filter(o => o.programmeId === programme.id);
  const viaDeal = live.filter(o => !o.programmeId && dealOf(o)?.programmeId === programme.id);
  const others = live.filter(o => o.programmeId !== programme.id && !viaDeal.includes(o));
  const teachers = trainers.filter(t => (t.programmeIds || []).includes(programme.id)).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const files = programme.outlineFiles || [];

  const run = async (fn: () => Promise<void>) => {
    setError('');
    try { await fn(); } catch (e) { setError(friendlyError(e)); }
  };

  const link = (o: any) => {
    if (o.programmeId && o.programmeId !== programme.id
      && !window.confirm(`"${outlineTitle(o, programmes) || o.refNumber}" is linked to "${progName(o.programmeId)}". Move it to "${programme.name}"?`)) return;
    run(() => linkOutline(o, programme.id, programmes));
  };

  const upload = async (list: FileList | null) => {
    const picked = Array.from(list || []);
    if (!picked.length) return;
    setError('');
    const problem = picked.map(f => proposalFileProblem(f.name, f.size)).find(Boolean);
    if (problem) return setError(problem);
    const added: ProgrammeFile[] = [];
    try {
      for (const [i, f] of picked.entries()) {
        const id = `pgf_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        const name = safeFileName(f.name);
        const path = `programme_files/${programme.id}/${id}_${name}`;
        const task = uploadBytesResumable(ref(storage, path), f, { contentType: proposalType(name), customMetadata: { uploadedBy: viewer.id, programmeId: programme.id } });
        await new Promise<void>((resolve, reject) => task.on('state_changed',
          s => setProgress(Math.round(((i + (s.totalBytes ? s.bytesTransferred / s.totalBytes : 0)) / picked.length) * 100)), reject, () => resolve()));
        added.push({ id, name, size: f.size, path, at: new Date().toISOString(), byId: viewer.id, byName: viewer.name });
      }
      await setDoc(doc(db, 'programmes', programme.id), { outlineFiles: [...files, ...added] }, { merge: true });
    } catch (e) {
      setError(storageError(e));
    } finally {
      setProgress(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const removeFile = (f: ProgrammeFile) => {
    if (!window.confirm(`Remove "${f.name}" from this programme?`)) return;
    run(async () => {
      await setDoc(doc(db, 'programmes', programme.id), { outlineFiles: files.filter(x => x.id !== f.id) }, { merge: true });
      await deleteObject(ref(storage, f.path)).catch(() => {});   // the record is what counts; a stray file is harmless
    });
  };

  const setTeaches = (t: any, on: boolean) => run(() => updateDoc(doc(db, 'trainers_directory', t.id), {
    programmeIds: on ? [...new Set([...(t.programmeIds || []), programme.id])] : (t.programmeIds || []).filter((x: string) => x !== programme.id),
  }));

  const outlineRow = (o: any, note?: string, unlink?: boolean) => (
    <li key={o.id} className="flex items-start justify-between gap-2">
      <span className="min-w-0">
        <span className="block truncate text-[15px] font-semibold">{outlineTitle(o, programmes) || 'Untitled outline'}</span>
        <span className="block text-sm text-ink-soft">{[o.refNumber, o.status === 'sent' ? 'Sent' : 'Draft', o.preparedForCompany, note].filter(Boolean).join(' · ')}</span>
      </span>
      {unlink && (
        <button type="button" onClick={() => run(() => linkOutline(o, '', programmes))} className="shrink-0 text-sm font-semibold text-ink-soft hover:text-danger">Unlink</button>
      )}
    </li>
  );

  return (
    <div className="space-y-4">
      {!hideOutlines && <div className="rounded-xl border border-line p-3">
        <p className="text-sm font-semibold text-ink-soft">Course outlines</p>
        {own.length + viaDeal.length === 0 ? <p className="mt-1 text-sm text-ink-soft">None linked yet.</p> : (
          <ul className="mt-2 space-y-2">
            {own.map(o => outlineRow(o, '', true))}
            {viaDeal.map(o => outlineRow(o, 'through its deal'))}
          </ul>
        )}
        <AddSearch placeholder="Link a course outline: search title, ref or company" items={others}
          text={o => outlineTitle(o, programmes) || o.refNumber || 'Untitled outline'}
          sub={o => [o.refNumber, o.preparedForCompany, o.programmeId ? `now linked to ${progName(o.programmeId)}` : ''].filter(Boolean).join(' · ')}
          onPick={link} />
        <p className="mt-1.5 text-sm text-ink-soft">An outline keeps its own title, so one with a different name can still be linked here.</p>
      </div>}

      <div className="rounded-xl border border-line p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-ink-soft">Outline files</p>
          <button type="button" className={btnSecondary} disabled={progress !== null} onClick={() => fileInput.current?.click()}>
            {progress !== null ? <><Loader2 className="h-4 w-4 animate-spin" /> {progress}%</> : <><Upload className="h-4 w-4" /> Upload</>}
          </button>
          <input ref={fileInput} type="file" multiple accept={PROPOSAL_ACCEPT} className="hidden" onChange={e => upload(e.target.files)} />
        </div>
        {files.length === 0 ? <p className="mt-1 text-sm text-ink-soft">No file yet. Upload the outline as PDF, Word or PowerPoint.</p> : (
          <ul className="mt-2 space-y-1.5">
            {files.map(f => (
              <li key={f.id} className="flex items-center justify-between gap-2">
                <button type="button" onClick={() => openProgrammeFile(f)} className="flex min-w-0 items-center gap-2 text-left text-[15px] font-semibold text-accent hover:underline">
                  <FileText className="h-4 w-4 shrink-0" /><span className="truncate">{f.name}</span><ExternalLink className="h-3.5 w-3.5 shrink-0" />
                </button>
                <span className="flex shrink-0 items-center gap-2 text-sm text-ink-soft">
                  {sizeText(f.size)}
                  <button type="button" onClick={() => removeFile(f)} aria-label={`Remove ${f.name}`} className="rounded p-1 hover:bg-danger-soft hover:text-danger"><Trash2 className="h-4 w-4" /></button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-xl border border-line p-3">
        <p className="text-sm font-semibold text-ink-soft">Trainers who teach it</p>
        {teachers.length === 0 ? <p className="mt-1 text-sm text-ink-soft">None linked yet.</p> : (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {teachers.map(t => (
              <span key={t.id} className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 text-sm font-semibold text-accent">
                {t.name}{t.status === 'On Leave' && <span className="font-normal text-attention"> · on leave</span>}
                <button type="button" onClick={() => setTeaches(t, false)} aria-label={`Unlink ${t.name}`}><X className="h-3.5 w-3.5" /></button>
              </span>
            ))}
          </div>
        )}
        <AddSearch placeholder="Link a trainer: search name" items={trainers.filter(t => !teachers.includes(t)).sort((a, b) => String(a.name).localeCompare(String(b.name)))}
          text={t => t.name || 'Unnamed trainer'} sub={t => t.specialization || ''} onPick={t => setTeaches(t, true)} />
      </div>
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</p>}
    </div>
  );
}

// ---------- Under the programme on a deal: what's linked to it ----------
export function ProgrammeLinkedInfo({ programme, programmes }: { programme: Programme; programmes: Programme[] }) {
  const [outlines, setOutlines] = useState<any[]>([]);
  const [trainers, setTrainers] = useState<any[]>([]);
  useEffect(() => {
    const subs = [
      onSnapshot(query(collection(db, 'course_outlines'), where('programmeId', '==', programme.id)),
        s => setOutlines(linkedOnly(s.docs.map(d => ({ ...d.data(), id: d.id }))).filter((o: any) => !o.isHidden && !o.dealDeleted)), () => setOutlines([])),
      onSnapshot(query(collection(db, 'trainers_directory'), where('programmeIds', 'array-contains', programme.id)),
        s => setTrainers(s.docs.map(d => ({ ...d.data(), id: d.id }))), () => setTrainers([])),
    ];
    return () => subs.forEach(u => u());
  }, [programme.id]);
  const files = programme.outlineFiles || [];
  // One line per outline title: the same outline is often reused for many clients.
  const titles = [...new Set(outlines.map(o => outlineTitle(o, programmes)).filter(Boolean))];
  if (!titles.length && !files.length && !trainers.length) {
    return <p className="mt-1.5 text-sm text-ink-soft">No course outline or trainer linked to this programme yet (Course outlines → By title).</p>;
  }
  return (
    <div className="mt-2 space-y-1 rounded-lg bg-surface px-3 py-2 text-sm">
      {(titles.length > 0 || files.length > 0) && (
        <p><span className="font-semibold text-ink-soft">Course outline: </span>
          {titles.join(' · ')}{titles.length > 0 && files.length > 0 && ' · '}
          {files.map((f, i) => (
            <React.Fragment key={f.id}>{i > 0 && ' · '}
              <button type="button" onClick={() => openProgrammeFile(f)} className="font-semibold text-accent hover:underline">{f.name}</button>
            </React.Fragment>
          ))}
        </p>
      )}
      {trainers.length > 0 && <p><span className="font-semibold text-ink-soft">Trainers: </span>{trainers.map(t => t.name).sort().join(', ')}</p>}
    </div>
  );
}
