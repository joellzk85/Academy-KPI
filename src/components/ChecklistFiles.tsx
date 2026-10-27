import React, { useRef, useState } from 'react';
import { deleteDoc, doc, setDoc } from 'firebase/firestore';
import { deleteObject, ref, uploadBytesResumable } from 'firebase/storage';
import { ExternalLink, Loader2, Trash2, Upload } from 'lucide-react';
import { db, storage } from '../lib/firebase';
import { formatDate } from '../lib/deals';
import {
  CHECKLIST_FILE_ACCEPT, CHECKLIST_FILE_KINDS, ChecklistFile, checklistFileProblem, checklistFileType, safeFileName, sizeText,
} from '../lib/checklistFiles';
import { openProposalFile, storageError } from './ProposalFiles';
import DownloadButton from './DownloadButton';

// The file drop box and file list on a checklist step that has "Has a file upload" (lib/checklistFiles.ts).
// Admin and Management upload; everyone sees the list and can open the files.

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };

// Uploads one file and records it. Returns the record. (Also used by "Make PO", TrainerPoDocument.tsx.)
export async function uploadOne(dealId: string, task: { id: string; label: string }, file: File, viewer: Viewer, onProgress: (pct: number) => void): Promise<ChecklistFile> {
  const id = `cf_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const name = safeFileName(file.name);
  const path = `checklist_files/${dealId}/${id}_${name}`;
  const type = checklistFileType(name);
  const up = uploadBytesResumable(ref(storage, path), file, { contentType: type, customMetadata: { uploadedBy: viewer.id, dealId, taskId: task.id } });
  await new Promise<void>((resolve, reject) => {
    up.on('state_changed', s => onProgress(s.totalBytes ? Math.round((s.bytesTransferred / s.totalBytes) * 100) : 0), reject, () => resolve());
  });
  const rec: ChecklistFile = {
    id, dealId, taskId: task.id, taskLabel: task.label, name, size: file.size, type, path,
    at: new Date().toISOString(), byId: viewer.id, byName: viewer.name,
  };
  try {
    await setDoc(doc(db, 'checklist_files', id), rec);
  } catch (e) {
    await deleteObject(ref(storage, path)).catch(() => {});   // don't leave a file without a record
    throw e;
  }
  return rec;
}

export default function StepFiles({ dealId, task, files, viewer, editable, onUploaded, onLastRemoved, onPicked, what, ticks = true }: {
  dealId: string;
  task: { id: string; label: string; done?: boolean };
  files: ChecklistFile[];                 // this step's files
  viewer: Viewer;
  editable: boolean;                      // Admin and Management
  onUploaded: (files: ChecklistFile[]) => void;
  onLastRemoved: () => void;              // the step's last file was deleted
  onPicked?: (files: File[]) => void;     // the files chosen, before uploading (the Attendance list reads HR's list for the T3 form)
  what?: string;                          // e.g. "venue documents" (default: "<step> file")
  ticks?: boolean;                        // uploading ticks the step (false: venue, bus, facilitator documents, trainer PO)
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const busy = progress !== null;
  // An upload can take a while; call the latest handlers so the checklist saved is the current one.
  const latest = useRef({ onUploaded, onLastRemoved });
  latest.current = { onUploaded, onLastRemoved };
  const sorted = [...files].sort((a, b) => b.at.localeCompare(a.at));

  const upload = async (list: FileList | File[] | null) => {
    const chosen = Array.from(list || []);
    if (!chosen.length || busy) return;
    setError('');
    const problem = chosen.map(f => checklistFileProblem(f.name, f.size)).find(Boolean);
    if (problem) return setError(problem);
    onPicked?.(chosen);
    const done: ChecklistFile[] = [];
    try {
      for (const [i, f] of chosen.entries()) {
        done.push(await uploadOne(dealId, task, f, viewer, pct => setProgress(Math.round(((i + pct / 100) / chosen.length) * 100))));
      }
    } catch (e) {
      setError(storageError(e));
    } finally {
      setProgress(null);
    }
    if (done.length) latest.current.onUploaded(done);
  };

  const open = async (f: ChecklistFile) => {
    setError('');
    setError(await openProposalFile(f));
  };
  const remove = async (f: ChecklistFile) => {
    const last = ticks && files.length === 1 && task.done;
    if (!window.confirm(`Delete "${f.name}"? The file and its backup copy in the CRM are removed. This can't be undone.${last ? ` It's the only file, so "${task.label}" is reopened.` : ''}`)) return;
    setBusyId(f.id);
    setError('');
    try {
      await deleteObject(ref(storage, f.path)).catch((e: any) => { if (e?.code !== 'storage/object-not-found') throw e; });
      await deleteDoc(doc(db, 'checklist_files', f.id));
      if (files.length === 1) latest.current.onLastRemoved();
    } catch (e) {
      setError(storageError(e));
    } finally {
      setBusyId('');
    }
  };
  const canDelete = (f: ChecklistFile) => editable && (f.byId === viewer.id || viewer.role === 'management');
  const pick = () => !busy && input.current?.click();

  return (
    <div className="mt-2 space-y-2">
      {sorted.length > 0 && (
        <ul className="divide-y divide-line rounded-lg border border-line bg-white">
          {sorted.map((f, i) => (
            <li key={f.id} className="flex items-center gap-2 px-3 py-2">
              <button type="button" onClick={() => open(f)} className="min-w-0 flex-1 text-left">
                <span className="flex items-center gap-1.5 text-[15px] font-medium text-accent hover:underline">
                  <span className="truncate">{f.name}</span><ExternalLink className="h-3.5 w-3.5 shrink-0" />
                  {i === 0 && sorted.length > 1 && <span className="rounded bg-accent-soft px-1.5 text-xs font-semibold text-accent">Latest</span>}
                </span>
                <span className="block text-sm text-ink-soft">{f.byName} · {formatDate(f.at)} · {sizeText(f.size)}</span>
              </button>
              <DownloadButton file={f} />
              {canDelete(f) && (
                <button type="button" disabled={busyId === f.id} onClick={() => remove(f)} className="rounded-md p-1.5 text-ink-soft hover:bg-danger-soft hover:text-danger" aria-label={`Delete ${f.name}`}>
                  {busyId === f.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!editable && !files.length && <p className="text-sm text-ink-soft">No file uploaded yet.</p>}
      {editable && (
        sorted.length > 0 ? (
          <button type="button" disabled={busy} onClick={pick}
            onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={e => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files); }}
            className={`inline-flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-1.5 text-sm font-semibold transition-colors ${over ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink hover:bg-surface'}`}>
            {busy ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading… {progress}%</> : <><Upload className="h-3.5 w-3.5 text-accent" /> Add another file</>}
          </button>
        ) : (
          <div
            role="button" tabIndex={0} aria-label={`Upload the ${what || `${task.label} file`}: drop it here or click to choose`}
            onClick={pick}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } }}
            onDragOver={e => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={e => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files); }}
            className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-4 text-center transition-colors ${over ? 'border-accent bg-accent-soft' : 'border-line bg-white hover:border-accent/50 hover:bg-surface'}`}
          >
            {busy ? (
              <span className="flex items-center gap-2 text-sm font-semibold text-accent"><Loader2 className="h-4 w-4 animate-spin" /> Uploading… {progress}%</span>
            ) : (
              <>
                <span className="flex items-center gap-2 text-[15px] font-semibold text-ink"><Upload className="h-4 w-4 text-accent" /> Drop the {what || `${task.label} file`} here, or click to choose</span>
                <span className="text-sm text-ink-soft">{CHECKLIST_FILE_KINDS}, up to 100 MB.{ticks ? ' Uploading marks this step done.' : ' You can add several.'}</span>
              </>
            )}
          </div>
        )
      )}
      <input ref={input} type="file" accept={CHECKLIST_FILE_ACCEPT} multiple className="hidden" onChange={e => { upload(e.target.files); e.target.value = ''; }} />
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
