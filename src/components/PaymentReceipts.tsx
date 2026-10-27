import React, { useEffect, useRef, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import { deleteObject, ref, uploadBytesResumable } from 'firebase/storage';
import { ExternalLink, FileCheck2, Loader2, Paperclip, Trash2, Upload, X } from 'lucide-react';
import { db, storage } from '../lib/firebase';
import { formatDate } from '../lib/deals';
import { CHECKLIST_FILE_ACCEPT, CHECKLIST_FILE_KINDS, checklistFileProblem, checklistFileType, safeFileName, sizeText } from '../lib/checklistFiles';
import { Receipt } from '../lib/postTraining';
import { openProposalFile, storageError } from './ProposalFiles';

// Payment receipts from the client or HRDC (Joel, 2026-10-20), on a deal's invoice or claim (money_in) or on an
// imported Payment tracking line (payment_records). Admin and Management upload, open and delete (uploader or
// Management); reps never see them.
// - The file: Firebase Storage receipts/{id}_{name} (storage.rules).
// - The record: payment_receipts/{id} (lib/postTraining.ts Receipt). The backup copies the records.
// Same file types and size as the checklist files: PDF, Word, Excel or a photo, up to 100 MB.
// Copies (Joel, 2026-10-24): the same boxes hold the copy of the HRDC claim or invoice we sent (kind 'copy'), and every
// box takes a pasted screenshot (Ctrl+V): the box under the mouse or focused, else the newest one in an open form.

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };
export type ReceiptTarget = { dealId: string; moneyInId: string; recordId: string; moneyOutId?: string; claimBackId?: string; kind?: 'copy' | 'invoice' | 'support';
  vendorInvoiceFor?: string; invoiceNo?: string; invoiceAmount?: number };

type PasteTaker = (f: File[]) => void;
let hovered: PasteTaker | null = null;
const pickers: PasteTaker[] = [];
let listening = false;
function onPaste(e: ClipboardEvent) {
  const take = hovered || pickers[pickers.length - 1];
  const files = Array.from(e.clipboardData?.files || []);
  if (!take || !files.length) return;
  // A screenshot comes in as "image.png": give it a name that says what it is.
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  const named = files.map((f, i) => f.type.startsWith('image/') && /^image\.\w+$/i.test(f.name)
    ? new File([f], `screenshot-${stamp}${i ? `-${i + 1}` : ''}.${f.type === 'image/jpeg' ? 'jpg' : 'png'}`, { type: f.type }) : f);
  e.preventDefault();
  take(named);
}
/** Lets a box take a pasted file: while hovered or focused, or (picker) as the newest open form's box. */
function usePaste(take: PasteTaker, picker: boolean) {
  const latest = useRef(take);
  latest.current = take;
  const me = useRef<PasteTaker>(f => latest.current(f)).current;
  useEffect(() => {
    if (!listening) { document.addEventListener('paste', onPaste); listening = true; }
    if (picker) pickers.push(me);
    return () => { const i = pickers.indexOf(me); if (i >= 0) pickers.splice(i, 1); if (hovered === me) hovered = null; };
  }, [picker, me]);
  const on = () => { hovered = me; };
  const off = () => { if (hovered === me) hovered = null; };
  return { onMouseEnter: on, onMouseLeave: off, onFocus: on, onBlur: off };
}
const PASTE_HINT = 'or paste a screenshot (Ctrl+V)';

/** Receipts, live: one deal's, or (no dealId) all of them. Only Admin and Management may read them. */
export function useReceipts(enabled: boolean, dealId?: string): Receipt[] {
  const [list, setList] = useState<Receipt[]>([]);
  useEffect(() => {
    if (!enabled) { setList([]); return; }
    const q = dealId ? query(collection(db, 'payment_receipts'), where('dealId', '==', dealId)) : query(collection(db, 'payment_receipts'));
    return onSnapshot(q, s => setList(s.docs.map(d => ({ ...(d.data() as Receipt), id: d.id }))), () => setList([]));
  }, [enabled, dealId]);
  return list;
}

export async function uploadReceipt(file: File, target: ReceiptTarget, viewer: Viewer, onProgress?: (pct: number) => void): Promise<Receipt> {
  const problem = checklistFileProblem(file.name, file.size);
  if (problem) throw new Error(problem);
  const id = `rc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const name = safeFileName(file.name);
  const path = `receipts/${id}_${name}`;
  const type = checklistFileType(name);
  const up = uploadBytesResumable(ref(storage, path), file, { contentType: type, customMetadata: { uploadedBy: viewer.id, dealId: target.dealId } });
  await new Promise<void>((resolve, reject) => {
    up.on('state_changed', s => onProgress?.(s.totalBytes ? Math.round((s.bytesTransferred / s.totalBytes) * 100) : 0), reject, () => resolve());
  });
  const rec: Receipt = { id, ...target, name, size: file.size, type, path, at: new Date().toISOString(), byId: viewer.id, byName: viewer.name };
  try {
    await setDoc(doc(db, 'payment_receipts', id), rec);
  } catch (e) {
    await deleteObject(ref(storage, path)).catch(() => {});   // don't leave a file without a record
    throw e;
  }
  return rec;
}

/** Removes a receipt's file and record (also used when the record it belongs to couldn't be saved). */
export async function removeReceipt(r: Receipt) {
  await deleteObject(ref(storage, r.path)).catch((e: any) => { if (e?.code !== 'storage/object-not-found') throw e; });
  await deleteDoc(doc(db, 'payment_receipts', r.id));
}

/** Several files to one target, one after another (Joel, 2026-10-26: "all uploads must be able to upload multiple
 *  documents"). If one fails, the ones already up are removed, so a form never saves with half its files. */
export async function uploadReceipts(files: File[], target: ReceiptTarget, viewer: Viewer, onProgress?: (text: string) => void): Promise<Receipt[]> {
  const done: Receipt[] = [];
  try {
    for (let i = 0; i < files.length; i++) {
      done.push(await uploadReceipt(files[i], target, viewer, pct => onProgress?.(files.length > 1 ? `${i + 1} of ${files.length}, ${pct}%` : `${pct}%`)));
    }
  } catch (e) {
    await Promise.all(done.map(r => removeReceipt(r).catch(() => {})));
    throw e;
  }
  return done;
}

export const receiptError = (e: any) => (e instanceof Error && !(e as any).code ? e.message : storageError(e));

/** The receipts already uploaded, with open and delete. */
export function ReceiptList({ receipts, viewer, copyLabel = 'Copy' }: { receipts: Receipt[]; viewer: Viewer; copyLabel?: string }) {
  const word = (r: Receipt) => (r.kind === 'copy' ? copyLabel : r.kind === 'support' ? 'Document' : r.kind === 'invoice' ? `Invoice${r.invoiceNo ? ` ${r.invoiceNo}` : ''}${r.invoiceAmount ? ` (RM ${Number(r.invoiceAmount).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})` : ''}` : 'Receipt');
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  if (!receipts.length) return null;
  const remove = async (r: Receipt) => {
    if (!window.confirm(`Delete "${r.name}"? This can't be undone.`)) return;
    setBusyId(r.id); setError('');
    try {
      await removeReceipt(r);
    } catch (e) {
      setError(storageError(e));
    } finally {
      setBusyId('');
    }
  };
  return (
    <div className="mt-2">
      <ul className="divide-y divide-line rounded-lg border border-line bg-white">
        {[...receipts].sort((a, b) => b.at.localeCompare(a.at)).map(r => (
          <li key={r.id} className="flex items-center gap-2 px-3 py-2">
            <FileCheck2 className="h-4 w-4 shrink-0 text-accent" />
            <button type="button" onClick={async () => { setError(''); setError(await openProposalFile(r as any)); }} className="min-w-0 flex-1 text-left">
              <span className="flex items-center gap-1.5 text-[15px] font-medium text-accent hover:underline"><span className="truncate">{word(r)}: {r.name}</span><ExternalLink className="h-3.5 w-3.5 shrink-0" /></span>
              <span className="block text-sm text-ink-soft">{r.byName} · {formatDate(r.at)} · {sizeText(r.size)}</span>
            </button>
            {(r.byId === viewer.id || viewer.role === 'management') && (
              <button type="button" disabled={busyId === r.id} onClick={() => remove(r)} className="rounded-md p-1.5 text-ink-soft hover:bg-danger-soft hover:text-danger" aria-label={`Delete receipt ${r.name}`}>
                {busyId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
    </div>
  );
}

/** Drop box that uploads a receipt straight away (for a payment already recorded). */
export function ReceiptDrop({ target, viewer, prompt = 'Drop the receipt here, or click to choose', small }: { target: ReceiptTarget; viewer: Viewer; prompt?: string; small?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState('');
  // Several files at once; each is kept even if a later one fails (they're saved straight away, not with a form).
  const upload = async (list: FileList | File[] | null) => {
    const files = Array.from(list || []);
    if (!files.length || progress !== null) return;
    setError(''); setProgress('0%');
    const failed: string[] = [];
    for (let i = 0; i < files.length; i++) {
      try { await uploadReceipt(files[i], target, viewer, pct => setProgress(files.length > 1 ? `${i + 1} of ${files.length}, ${pct}%` : `${pct}%`)); }
      catch (e) { failed.push(`${files[i].name}: ${receiptError(e)}`); }
    }
    setProgress(null);
    if (failed.length) setError(failed.join(' '));
  };
  const paste = usePaste(f => upload(f), false);
  const drag = {
    ...paste,
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setOver(true); },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files); },
  };
  return (
    <div className="mt-2">
      {small ? (
        <button type="button" onClick={() => input.current?.click()} {...drag} title={`Drop a file, ${PASTE_HINT}, or click to choose`}
          className={`inline-flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-1.5 text-sm font-semibold ${over ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink hover:bg-surface'}`}>
          {progress !== null ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading… {progress}%</> : <><Upload className="h-3.5 w-3.5 text-accent" /> {prompt}</>}
        </button>
      ) : (
        <div role="button" tabIndex={0} aria-label={prompt} onClick={() => input.current?.click()}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click(); } }} {...drag}
          className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-3 text-center ${over ? 'border-accent bg-accent-soft' : 'border-line bg-white hover:border-accent/50 hover:bg-surface'}`}>
          {progress !== null
            ? <span className="flex items-center gap-2 text-sm font-semibold text-accent"><Loader2 className="h-4 w-4 animate-spin" /> Uploading… {progress}%</span>
            : <><span className="flex items-center gap-2 text-[15px] font-semibold"><Upload className="h-4 w-4 text-accent" /> {prompt}</span><span className="text-sm text-ink-soft">{CHECKLIST_FILE_KINDS}, {PASTE_HINT}</span></>}
        </div>
      )}
      <input ref={input} type="file" accept={CHECKLIST_FILE_ACCEPT} multiple className="hidden" onChange={e => { upload(Array.from(e.target.files || [])); e.target.value = ''; }} />
      {error && <p role="alert" className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
    </div>
  );
}

/** Choose the receipts (one or more) inside a "payment received" form; they're uploaded when the form is saved. */
export function ReceiptPick({ files, onFiles, label = 'Receipt from the client or HRDC', what = 'receipt' }: {
  files: File[]; onFiles: (f: File[]) => void; label?: string; what?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [error, setError] = useState('');
  const take = (list: FileList | File[] | null) => {
    const picked = Array.from(list || []);
    if (!picked.length) return;
    const problems = picked.map(f => checklistFileProblem(f.name, f.size)).filter(Boolean);
    setError(problems.join(' '));
    const ok = picked.filter(f => !checklistFileProblem(f.name, f.size));
    if (ok.length) onFiles([...files, ...ok]);
  };
  const paste = usePaste(f => take(f), true);
  return (
    <div>
      <span className="mb-1 block text-sm font-medium text-ink-soft">{label}</span>
      {files.length > 0 && (
        <ul className="mb-2 space-y-1">
          {files.map((f, n) => (
            <li key={`${f.name}-${n}`} className="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent-soft/50 px-3 py-2 text-[15px]">
              <Paperclip className="h-4 w-4 shrink-0 text-accent" /><span className="min-w-0 flex-1 truncate">{f.name}</span>
              <button type="button" onClick={() => onFiles(files.filter((_, k) => k !== n))} className="rounded-md p-1 text-ink-soft hover:bg-white" aria-label={`Remove ${f.name}`}><X className="h-4 w-4" /></button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={() => input.current?.click()} {...paste}
        onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); take(e.dataTransfer.files); }}
        className={`flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed px-3 py-2.5 text-[15px] font-semibold ${over ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-white text-ink hover:bg-surface'}`}>
        <Upload className="h-4 w-4 shrink-0 text-accent" /> {files.length ? `Add another ${what}` : `Drop the ${what} here (one or more), ${PASTE_HINT}, or click to choose`}
      </button>
      <input ref={input} type="file" accept={CHECKLIST_FILE_ACCEPT} multiple className="hidden" onChange={e => { take(e.target.files); e.target.value = ''; }} />
      {error && <p role="alert" className="mt-1 text-sm text-danger">{error}</p>}
    </div>
  );
}
