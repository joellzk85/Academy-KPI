import React, { useRef, useState } from 'react';
import { deleteDoc, doc, setDoc } from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';
import { ExternalLink, FileText, Loader2, Trash2, Upload } from 'lucide-react';
import { db, friendlyError, storage } from '../lib/firebase';
import { formatDate } from '../lib/deals';
import { PROPOSAL_ACCEPT, ProposalFile, proposalFileProblem, proposalType, safeFileName, sizeText } from '../lib/proposals';

// Proposal files on a deal (lib/proposals.ts). ProposalDrop is the "drop your proposal here" box next to
// "Proposal sent"; ProposalFilesList is the list in the deal's Documents, with "Add a file".

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };

const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';

export function storageError(e: any): string {
  const code = String(e?.code || '');
  if (code === 'storage/unauthorized') return "You aren't allowed to do that with this file (or the file rules aren't published yet).";
  if (code === 'storage/canceled') return 'The upload was stopped.';
  if (code === 'storage/retry-limit-exceeded' || code === 'storage/unknown') return "The file didn't go through. Check your internet and try again. If it keeps happening, file storage may not be switched on yet (Management: Firebase console → Storage → Get started).";
  if (code === 'storage/object-not-found') return 'That file is no longer there.';
  if (code === 'storage/bucket-not-found' || code === 'storage/project-not-found') return "File storage isn't switched on for the CRM yet. Ask Management (Firebase console → Storage → Get started).";
  return friendlyError(e);
}

// Uploads one file and records it. Returns the record.
async function uploadProposal(dealId: string, file: File, viewer: Viewer, onProgress: (pct: number) => void): Promise<ProposalFile> {
  const id = `pf_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const name = safeFileName(file.name);
  const path = `proposals/${dealId}/${id}_${name}`;
  const type = proposalType(name);
  const task = uploadBytesResumable(ref(storage, path), file, { contentType: type, customMetadata: { uploadedBy: viewer.id, dealId } });
  await new Promise<void>((resolve, reject) => {
    task.on('state_changed', s => onProgress(s.totalBytes ? Math.round((s.bytesTransferred / s.totalBytes) * 100) : 0), reject, () => resolve());
  });
  const rec: ProposalFile = { id, dealId, name, size: file.size, type, path, at: new Date().toISOString(), byId: viewer.id, byName: viewer.name };
  try {
    await setDoc(doc(db, 'proposal_files', id), rec);
  } catch (e) {
    await deleteObject(ref(storage, path)).catch(() => {});   // don't leave a file without a record
    throw e;
  }
  return rec;
}

function useUploader(dealId: string, viewer: Viewer, onUploaded?: (files: ProposalFile[]) => void) {
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const upload = async (list: FileList | File[] | null) => {
    const files = Array.from(list || []);
    if (!files.length) return;
    setError('');
    const problem = files.map(f => proposalFileProblem(f.name, f.size)).find(Boolean);
    if (problem) return setError(problem);
    const done: ProposalFile[] = [];
    try {
      for (const [i, f] of files.entries()) {
        done.push(await uploadProposal(dealId, f, viewer, pct => setProgress(Math.round(((i + pct / 100) / files.length) * 100))));
      }
    } catch (e) {
      setError(storageError(e));
    } finally {
      setProgress(null);
    }
    if (done.length) onUploaded?.(done);
  };
  return { progress, error, upload };
}

// The drop box shown next to "Proposal sent" while the deal is new.
export function ProposalDrop({ dealId, viewer, disabled, onUploaded }: {
  dealId: string; viewer: Viewer; disabled?: boolean; onUploaded: (files: ProposalFile[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const { progress, error, upload } = useUploader(dealId, viewer, onUploaded);
  const busy = progress !== null;
  return (
    <div>
      <div
        role="button" tabIndex={0} aria-label="Upload the proposal: drop a file here or click to choose"
        onClick={() => !busy && !disabled && input.current?.click()}
        onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && !busy && !disabled) { e.preventDefault(); input.current?.click(); } }}
        onDragOver={e => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); if (!busy && !disabled) upload(e.dataTransfer.files); }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-4 text-center transition-colors ${over ? 'border-accent bg-accent-soft' : 'border-line hover:border-accent/50 hover:bg-surface'} ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
      >
        {busy ? (
          <span className="flex items-center gap-2 text-sm font-semibold text-accent"><Loader2 className="h-4 w-4 animate-spin" /> Uploading… {progress}%</span>
        ) : (
          <>
            <span className="flex items-center gap-2 text-[15px] font-semibold text-ink"><Upload className="h-4 w-4 text-accent" /> Drop the proposal here, or click to choose</span>
            <span className="text-sm text-ink-soft">PDF, Word or PowerPoint, up to 100 MB. A copy is kept on the deal, and it's marked "Proposal sent".</span>
          </>
        )}
      </div>
      <input ref={input} type="file" accept={PROPOSAL_ACCEPT} multiple className="hidden" onChange={e => { upload(e.target.files); e.target.value = ''; }} />
      {error && <p role="alert" className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
    </div>
  );
}

// Open a proposal file in a new tab ('' when it worked, else a plain message). Also used by the client timeline.
export async function openProposalFile(f: ProposalFile): Promise<string> {
  const w = window.open('', '_blank');   // opened straight from the click so it isn't blocked
  try {
    const url = await getDownloadURL(ref(storage, f.path));
    if (w) w.location.href = url; else window.location.href = url;
    return '';
  } catch (e) {
    w?.close();
    return storageError(e);
  }
}

// The deal's proposal files, newest first.
export function ProposalFilesList({ dealId, files, viewer, editable, onUploaded }: {
  dealId: string; files: ProposalFile[]; viewer: Viewer; editable: boolean; onUploaded?: (files: ProposalFile[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const { progress, error, upload } = useUploader(dealId, viewer, onUploaded);
  const [busyId, setBusyId] = useState('');
  const [listError, setListError] = useState('');
  const sorted = [...files].sort((a, b) => b.at.localeCompare(a.at));

  const open = async (f: ProposalFile) => {
    setListError('');
    setListError(await openProposalFile(f));
  };
  const remove = async (f: ProposalFile) => {
    if (!window.confirm(`Delete "${f.name}"? The file and its backup copy in the CRM are removed. This can't be undone.`)) return;
    setBusyId(f.id);
    setListError('');
    try {
      await deleteObject(ref(storage, f.path)).catch((e: any) => { if (e?.code !== 'storage/object-not-found') throw e; });
      await deleteDoc(doc(db, 'proposal_files', f.id));
    } catch (e) {
      setListError(storageError(e));
    } finally {
      setBusyId('');
    }
  };
  const canDelete = (f: ProposalFile) => f.byId === viewer.id || viewer.role === 'management';

  return (
    <div className="rounded-xl border border-line px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-2 font-semibold"><FileText className="h-4 w-4 text-accent" /> Proposal files</span>
        <span className="text-sm text-ink-soft">{files.length ? `${files.length}` : 'None yet'}</span>
        {editable && (
          <button type="button" className={`${btnSecondary} ml-auto`} disabled={progress !== null} onClick={() => input.current?.click()}>
            {progress !== null ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {progress}%</> : <><Upload className="h-3.5 w-3.5" /> Add a file</>}
          </button>
        )}
      </div>
      <input ref={input} type="file" accept={PROPOSAL_ACCEPT} multiple className="hidden" onChange={e => { upload(e.target.files); e.target.value = ''; }} />
      {sorted.length > 0 && (
        <ul className="mt-2 divide-y divide-line">
          {sorted.map((f, i) => (
            <li key={f.id} className="flex items-center gap-2 py-2">
              <button type="button" onClick={() => open(f)} className="min-w-0 flex-1 text-left">
                <span className="flex items-center gap-1.5 truncate text-[15px] font-medium text-accent hover:underline">
                  <span className="truncate">{f.name}</span><ExternalLink className="h-3.5 w-3.5 shrink-0" />
                  {i === 0 && sorted.length > 1 && <span className="rounded bg-accent-soft px-1.5 text-xs font-semibold text-accent no-underline">Latest</span>}
                </span>
                <span className="block text-sm text-ink-soft">{f.byName} · {formatDate(f.at)} · {sizeText(f.size)}</span>
              </button>
              {canDelete(f) && (
                <button type="button" disabled={busyId === f.id} onClick={() => remove(f)} className="rounded-md p-1.5 text-ink-soft hover:bg-danger-soft hover:text-danger" aria-label={`Delete ${f.name}`}>
                  {busyId === f.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {(error || listError) && <p role="alert" className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error || listError}</p>}
    </div>
  );
}
