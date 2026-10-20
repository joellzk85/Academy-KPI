import React, { useEffect, useRef, useState } from 'react';
import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';
import { ArrowLeft, ArrowRight, ClipboardPaste, ImagePlus, Loader2, X } from 'lucide-react';
import { storage } from '../lib/firebase';
import { storageError } from './ProposalFiles';

// Photos for teambuilding proposals, activities, trainers and venues (2026-10-19, push A1).
// - Photos are made smaller in the browser first (longest side 1600px, JPEG), so the client's page loads fast.
// - Stored in Firebase Storage at photos/{folder}/{id}.jpg (storage.rules), with who uploaded it.
// - What's saved on the record is the photo's download link. Removing a photo only takes the link off the
//   record: the file stays, so a proposal that already uses it (or was sent with it) never loses its picture.
// - Screenshots (2026-10-19, Joel): photos can also be dropped on the box, pasted with Ctrl+V (it goes to the
//   photo box last pointed at, clicked or tabbed into), or added with "Paste screenshot" (reads the clipboard).

type Viewer = { id: string; name: string };
export type PhotoFolder = 'activities' | 'trainers' | 'venues' | 'covers';

const MAX_SIDE = 1600;
const MAX_INPUT = 25 * 1024 * 1024;
const NOT_PHOTO = 'isn\'t a photo or screenshot (JPG, PNG, WebP, GIF or BMP).';

export async function shrink(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(`"${file.name}" couldn't be read as a photo.`)); i.src = url; });
    const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise<Blob>((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('The photo could not be prepared.'))), 'image/jpeg', 0.84));
  } finally {
    URL.revokeObjectURL(url);
  }
}

const isImage = (f: File) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(f.name);

// Image files from a paste, a drop or the file window. Screenshots arrive as "image.png", so they get a friendlier name.
function imagesFrom(list: DataTransferItemList | FileList | null | undefined): File[] {
  const out: File[] = [];
  for (const it of Array.from((list || []) as ArrayLike<DataTransferItem | File>)) {
    const f = it instanceof File ? it : it.kind === 'file' ? it.getAsFile() : null;
    if (f && isImage(f)) out.push(f.name && f.name !== 'image.png' ? f : new File([f], 'Screenshot.png', { type: f.type || 'image/png' }));
  }
  return out;
}

// Which photo box a Ctrl+V goes to: the one last pointed at, clicked or tabbed into.
let activePicker = 0;
let pickerCount = 0;

export async function uploadPhoto(file: File, folder: PhotoFolder, me: Viewer, onProgress?: (pct: number) => void): Promise<string> {
  if (!isImage(file)) throw new Error(`"${file.name}" ${NOT_PHOTO}`);
  if (file.size > MAX_INPUT) throw new Error(`"${file.name}" is too big (over 25 MB).`);
  const blob = await shrink(file);
  const id = `ph_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const r = ref(storage, `photos/${folder}/${id}.jpg`);
  const task = uploadBytesResumable(r, blob, { contentType: 'image/jpeg', customMetadata: { uploadedBy: me.id, uploadedByName: me.name } });
  await new Promise<void>((resolve, reject) => {
    task.on('state_changed', s => onProgress?.(s.totalBytes ? Math.round((s.bytesTransferred / s.totalBytes) * 100) : 0), reject, () => resolve());
  });
  return getDownloadURL(r);
}

// A row of photos with "Add photos", remove (×) and move left/right. The first photo is the main one.
export default function PhotoPicker({ photos, onChange, folder, me, max = 8, label = 'Photos', disabled, single }: {
  photos: string[]; onChange: (next: string[]) => void; folder: PhotoFolder; me: Viewer; max?: number; label?: string; disabled?: boolean; single?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [over, setOver] = useState(false);
  const [myId] = useState(() => ++pickerCount);
  const limit = single ? 1 : max;
  const list = (photos || []).filter(Boolean);
  const canAdd = !disabled && list.length < limit + (single ? 1 : 0);

  const add = async (files: File[]) => {
    if (!files.length || busy !== null) return;
    setError('');
    const room = single ? 1 : Math.max(0, limit - list.length);
    const chosen = files.slice(0, room);
    if (!chosen.length) { setError(`Up to ${limit} photos.`); return; }
    const added: string[] = [];
    try {
      for (const f of chosen) {
        setBusy(0);
        added.push(await uploadPhoto(f, folder, me, setBusy));
      }
    } catch (e: any) {
      setError(e?.code ? storageError(e) : String(e?.message || e));
    } finally {
      setBusy(null);
      if (added.length) onChange(single ? added.slice(0, 1) : [...list, ...added]);
      if (inputRef.current) inputRef.current.value = '';
    }
  };
  const addRef = useRef(add);
  addRef.current = add;
  const canAddRef = useRef(canAdd);
  canAddRef.current = canAdd;

  // Ctrl+V anywhere on the page goes to this box if it was the last one pointed at or clicked. Pasting into a
  // text box is left alone when the clipboard also has text (e.g. something copied from Word).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (activePicker !== myId || !canAddRef.current) return;
      const files = imagesFrom(e.clipboardData?.items);
      if (!files.length) return;
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      if (typing && e.clipboardData?.types.includes('text/plain')) return;
      e.preventDefault();
      addRef.current(files);
    };
    document.addEventListener('paste', onPaste);
    return () => { document.removeEventListener('paste', onPaste); if (activePicker === myId) activePicker = 0; };
  }, [myId]);

  const pasteButton = async () => {
    activePicker = myId;
    setError('');
    const clip: any = navigator.clipboard;
    if (!clip?.read) { setError('This browser can\'t read the clipboard from a button. Click the photo box, then press Ctrl+V.'); return; }
    try {
      const items = await clip.read();
      const files: File[] = [];
      for (const it of items) {
        const type = (it.types as string[]).find(t => t.startsWith('image/'));
        if (type) files.push(new File([await it.getType(type)], 'Screenshot.png', { type }));
      }
      if (!files.length) { setError('There\'s no picture on the clipboard. Take a screenshot first (Windows: Win+Shift+S; Mac: Cmd+Ctrl+Shift+4), then try again.'); return; }
      add(files);
    } catch {
      setError('The browser didn\'t allow reading the clipboard. Click the photo box, then press Ctrl+V.');
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    activePicker = myId;
    const files = imagesFrom(e.dataTransfer.files);
    if (files.length) { add(files); return; }
    if (e.dataTransfer.files.length) setError(`That ${NOT_PHOTO}`);
    else setError('That picture came from a web page. Save it to your computer first (or copy it and press Ctrl+V), then drop the file here.');
  };

  const move = (i: number, by: number) => {
    const next = [...list];
    const j = i + by;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  const mark = () => { if (!disabled) activePicker = myId; };
  return (
    <div onPointerEnter={mark} onFocusCapture={mark} onPointerDown={mark}
      onDragOver={e => { if (!canAdd || busy !== null) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (!over) setOver(true); }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }}
      onDrop={e => { if (canAdd && busy === null) onDrop(e); }}
      className={`rounded-lg transition-colors ${over ? 'bg-accent-soft outline-2 outline-offset-4 outline-dashed outline-accent' : ''}`}>
      {label && <p className="mb-1 text-sm font-semibold text-ink">{label}</p>}
      <div className="flex flex-wrap gap-2">
        {list.map((src, i) => (
          <div key={`${src}-${i}`} className="group relative h-20 w-28 overflow-hidden rounded-lg border border-line bg-surface">
            <img src={src} alt="" className="h-full w-full object-cover" />
            {i === 0 && !single && list.length > 1 && <span className="absolute left-1 top-1 rounded bg-ink/70 px-1 text-[11px] font-semibold text-white">Main</span>}
            {!disabled && (
              <div className="absolute inset-x-0 bottom-0 flex justify-between bg-ink/55 px-1 py-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                {!single ? (
                  <span className="flex">
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="rounded p-0.5 text-white disabled:opacity-30" aria-label="Move photo left"><ArrowLeft className="h-3.5 w-3.5" /></button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === list.length - 1} className="rounded p-0.5 text-white disabled:opacity-30" aria-label="Move photo right"><ArrowRight className="h-3.5 w-3.5" /></button>
                  </span>
                ) : <span />}
                <button type="button" onClick={() => onChange(list.filter((_, k) => k !== i))} className="rounded p-0.5 text-white" aria-label="Remove photo"><X className="h-3.5 w-3.5" /></button>
              </div>
            )}
          </div>
        ))}
        {canAdd && (
          <button type="button" onClick={() => inputRef.current?.click()} disabled={busy !== null}
            className={`flex h-20 w-28 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed text-sm font-semibold hover:border-accent hover:text-accent disabled:opacity-60 ${over ? 'border-accent text-accent' : 'border-line text-ink-soft'}`}>
            {busy !== null ? <><Loader2 className="h-5 w-5 animate-spin" />{busy}%</>
              : <><ImagePlus className="h-5 w-5" />{over ? 'Drop here' : single && list.length ? 'Change' : single ? 'Add photo' : 'Add photos'}</>}
          </button>
        )}
      </div>
      {canAdd && busy === null && (
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[13px] text-ink-soft">
          <span>Drop a photo or screenshot here, or press Ctrl+V to paste one.</span>
          <button type="button" onClick={pasteButton} className="inline-flex items-center gap-1 font-semibold text-accent hover:underline">
            <ClipboardPaste className="h-3.5 w-3.5" />Paste screenshot
          </button>
        </p>
      )}
      <input ref={inputRef} type="file" accept="image/*" multiple={!single} className="hidden"
        onChange={e => { const files = imagesFrom(e.target.files); if (files.length) add(files); else if (e.target.files?.length) setError(`That ${NOT_PHOTO}`); }} />
      {error && <p className="mt-1.5 text-sm text-danger">{error}</p>}
    </div>
  );
}
