// Website → Media (Joel, 2026-10-30): photos, short video clips and YouTube links for the website, in folders.
// Uploaded once, used on any page (pages point to them by id). Photos are shrunk on upload so the site stays fast.
// Long videos go on YouTube (unlisted is fine) and are added as a link; only short clips are uploaded (Joel).
// The same library opens as a picker from the page editor (MediaPickerDialog).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, setDoc, updateDoc } from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';
import { Film, ImageIcon, Loader2, Search, Trash2, Upload, X, Youtube } from 'lucide-react';
import { db, friendlyError, storage } from '../lib/firebase';
import { MEDIA, MEDIA_FOLDERS, SiteMedia, SitePage, youtubeIdOf } from '../lib/website';
import { shrink } from './PhotoPicker';
import { usePaged } from '../lib/listPaging';
import ListPager from './ListPager';

type Viewer = { id: string; name: string; role: string };

const CLIP_MAX = 60 * 1024 * 1024;   // short clips only; longer videos go on YouTube
const isImage = (f: File) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(f.name);
const isClip = (f: File) => /^video\/(mp4|webm|quicktime)$/.test(f.type) || /\.(mp4|webm|mov)$/i.test(f.name);
const newId = () => `m_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const kb = (n?: number) => (!n ? '' : n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

export function useSiteMedia() {
  const [media, setMedia] = useState<SiteMedia[] | null>(null);
  useEffect(() => onSnapshot(collection(db, MEDIA),
    s => setMedia(s.docs.map(d => ({ id: d.id, ...(d.data() as any) })).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))),
    () => setMedia([])), []);
  return media;
}

const imageSize = (blob: Blob) => new Promise<{ width: number; height: number }>(res => {
  const url = URL.createObjectURL(blob);
  const i = new Image();
  i.onload = () => { res({ width: i.naturalWidth, height: i.naturalHeight }); URL.revokeObjectURL(url); };
  i.onerror = () => { res({ width: 0, height: 0 }); URL.revokeObjectURL(url); };
  i.src = url;
});

/** Uploads one photo or clip to the website's media; returns the new record's fields (not saved yet). */
export async function uploadFile(file: File, id: string, me: Viewer, onProgress: (pct: number) => void): Promise<Omit<SiteMedia, 'id' | 'name' | 'folder'>> {
  let blob: Blob = file;
  let ext = (file.name.split('.').pop() || 'bin').toLowerCase();
  let kind: SiteMedia['kind'] = 'image';
  let dims = { width: 0, height: 0 };
  if (isImage(file)) {
    if (file.size > 25 * 1024 * 1024) throw new Error(`"${file.name}" is too big (over 25 MB).`);
    blob = await shrink(file, false);
    ext = blob.type === 'image/png' ? 'png' : 'jpg';
    dims = await imageSize(blob);
  } else if (isClip(file)) {
    if (file.size > CLIP_MAX) throw new Error(`"${file.name}" is over 60 MB. Put longer videos on YouTube and add the link.`);
    kind = 'video';
  } else {
    throw new Error(`"${file.name}" isn't a photo or a video clip (MP4, WebM or MOV).`);
  }
  const path = `site_media/${id}.${ext}`;
  const r = ref(storage, path);
  const contentType = kind === 'image' ? (ext === 'png' ? 'image/png' : 'image/jpeg') : (file.type || 'video/mp4');
  const task = uploadBytesResumable(r, blob, { contentType, customMetadata: { uploadedBy: me.id, uploadedByName: me.name } });
  await new Promise<void>((resolve, reject) => task.on('state_changed', s => onProgress(s.totalBytes ? Math.round((s.bytesTransferred / s.totalBytes) * 100) : 0), reject, () => resolve()));
  return { kind, url: await getDownloadURL(r), storagePath: path, size: blob.size, ...dims, createdBy: me.id, createdByName: me.name, createdAt: new Date().toISOString() };
}

/** Which pages use a photo or video (draft or live). */
export function usedOn(mediaId: string, pages: SitePage[]): string[] {
  const needle = `"${mediaId}"`;
  return pages.filter(p => JSON.stringify(p.draft || '').includes(needle) || JSON.stringify(p.published || '').includes(needle)).map(p => p.title);
}

function Tile({ m, selected, onClick, used }: { m: SiteMedia; selected: boolean; onClick: () => void; used: number }) {
  return (
    <button type="button" onClick={onClick} className={`flex flex-col overflow-hidden rounded-xl border bg-white text-left ${selected ? 'border-accent ring-2 ring-accent' : 'border-line hover:border-ink-soft'}`}>
      <div className="relative flex h-28 items-center justify-center bg-surface">
        {m.kind === 'image' && <img src={m.url} alt="" loading="lazy" className="h-28 w-full object-cover" style={{ objectPosition: `${m.focusX ?? 50}% ${m.focusY ?? 50}%` }} />}
        {m.kind === 'youtube' && <img src={`https://i.ytimg.com/vi/${m.youtubeId}/mqdefault.jpg`} alt="" loading="lazy" className="h-28 w-full object-cover" />}
        {m.kind === 'video' && <Film className="h-8 w-8 text-ink-soft" />}
        {m.kind !== 'image' && <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold text-white">{m.kind === 'youtube' ? 'YouTube' : 'Clip'}</span>}
      </div>
      <div className="px-3 py-2">
        <p className="truncate text-sm font-semibold text-ink">{m.name}</p>
        <p className="text-xs text-ink-soft">{used ? `Used on ${used} page${used === 1 ? '' : 's'}` : 'Not used yet'}</p>
      </div>
    </button>
  );
}

/** The library: folders, search, upload / drop / paste, YouTube links, and the selected item's details. */
export function MediaLibrary({ me, owner, pages, pick, onPick }: {
  me: Viewer;
  owner: boolean;
  pages: SitePage[];
  pick?: 'image' | 'video';               // as a picker: only these, and "Use this"
  onPick?: (m: SiteMedia) => void;
}) {
  const media = useSiteMedia();
  const [folder, setFolder] = useState('');
  const [show, setShow] = useState<'all' | 'image' | 'video' | 'unused'>(pick === 'image' ? 'image' : pick === 'video' ? 'video' : 'all');
  const [q, setQ] = useState('');
  const [selId, setSelId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [ytOpen, setYtOpen] = useState(false);
  const [yt, setYt] = useState({ link: '', name: '' });
  const fileInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const top = useRef<HTMLDivElement>(null);

  const uses = useMemo(() => Object.fromEntries((media || []).map(m => [m.id, usedOn(m.id, pages)])), [media, pages]);
  const list = useMemo(() => (media || []).filter(m =>
    (!folder || (m.folder || 'Other') === folder)
    && (show === 'all' || (show === 'image' ? m.kind === 'image' : show === 'video' ? m.kind !== 'image' : !uses[m.id]?.length))
    && (!q.trim() || `${m.name} ${(m.tags || []).map(t => '#' + t).join(' ')} ${m.alt || ''}`.toLowerCase().includes(q.trim().toLowerCase()))
  ), [media, folder, show, q, uses]);
  const paged = usePaged(list, [folder, show, q]);
  const sel = (media || []).find(m => m.id === selId) || null;

  const upload = async (files: File[]) => {
    setError('');
    for (const f of files) {
      const id = newId();
      try {
        setBusy(`Uploading ${f.name}…`);
        const rec = await uploadFile(f, id, me, pct => setBusy(`Uploading ${f.name}… ${pct}%`));
        await setDoc(doc(db, MEDIA, id), { ...rec, name: f.name.replace(/\.[^.]+$/, '') || 'Photo', folder: folder || (rec.kind === 'video' ? 'Videos' : 'Other'), alt: '', tags: [] });
        setSelId(id);
      } catch (e) {
        setError(e instanceof Error && !(e as any).code ? e.message : friendlyError(e));
      }
    }
    setBusy(null);
  };

  // Paste a screenshot (Ctrl+V) anywhere on the library.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files || []).filter(f => isImage(f));
      if (files.length) { e.preventDefault(); upload(files.map(f => (f.name === 'image.png' ? new File([f], 'Screenshot.png', { type: f.type }) : f))); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  const addYoutube = async () => {
    const yid = youtubeIdOf(yt.link);
    if (!yid) { setError("That isn't a YouTube link. Copy it from the video's Share button."); return; }
    const id = newId();
    try {
      await setDoc(doc(db, MEDIA, id), { kind: 'youtube', youtubeId: yid, url: `https://www.youtube.com/watch?v=${yid}`, name: yt.name.trim() || 'YouTube video', folder: folder || 'Videos', alt: yt.name.trim(), tags: [], createdBy: me.id, createdByName: me.name, createdAt: new Date().toISOString() });
      setYt({ link: '', name: '' }); setYtOpen(false); setSelId(id); setError('');
    } catch (e) { setError(friendlyError(e)); }
  };

  const save = async (patch: Partial<SiteMedia>) => {
    if (!sel) return;
    try { await updateDoc(doc(db, MEDIA, sel.id), patch as any); } catch (e) { setError(friendlyError(e)); }
  };

  const replace = async (file: File) => {
    if (!sel || sel.kind === 'youtube') return;
    try {
      setBusy(`Replacing with ${file.name}…`);
      const rec = await uploadFile(file, newId(), me, pct => setBusy(`Replacing… ${pct}%`));
      if (rec.kind !== sel.kind) throw new Error(sel.kind === 'image' ? 'Replace a photo with a photo.' : 'Replace a clip with a clip.');
      const old = sel.storagePath;
      await updateDoc(doc(db, MEDIA, sel.id), { url: rec.url, storagePath: rec.storagePath, size: rec.size, width: rec.width || 0, height: rec.height || 0 });
      if (old) deleteObject(ref(storage, old)).catch(() => { /* the old file stays; nothing points to it */ });
    } catch (e) { setError(e instanceof Error && !(e as any).code ? e.message : friendlyError(e)); }
    setBusy(null);
  };

  const remove = async () => {
    if (!sel) return;
    if (uses[sel.id]?.length) return;
    if (!window.confirm(`Delete "${sel.name}" from the website's media?`)) return;
    try {
      await deleteDoc(doc(db, MEDIA, sel.id));
      if (sel.storagePath) deleteObject(ref(storage, sel.storagePath)).catch(() => { /* the record is gone; the file is unreachable */ });
      setSelId('');
    } catch (e) { setError(friendlyError(e)); }
  };

  const canChange = (m: SiteMedia) => owner || m.createdBy === me.id;
  const chip = (on: boolean) => `min-h-9 rounded-full border px-3.5 text-sm ${on ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink hover:border-ink-soft'}`;

  return (
    <div ref={top} className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
      <nav aria-label="Folders" className="flex shrink-0 flex-row flex-wrap gap-1 lg:w-48 lg:flex-col">
        {['', ...MEDIA_FOLDERS].map(f => (
          <button key={f || 'all'} type="button" onClick={() => setFolder(f)}
            className={`flex min-h-10 items-center justify-between gap-3 rounded-lg px-3 text-left text-sm ${folder === f ? 'bg-accent-soft font-semibold text-accent' : 'text-ink hover:bg-surface'}`}>
            <span>{f || 'All media'}</span>
            <span className="text-xs text-ink-soft">{(media || []).filter(m => !f || (m.folder || 'Other') === f).length}</span>
          </button>
        ))}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-h-10 flex-1 items-center gap-2 rounded-lg border border-line bg-white px-3 sm:max-w-xs">
            <Search className="h-4 w-4 text-ink-soft" />
            <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name or #tag" aria-label="Search media" className="w-full bg-transparent text-sm outline-none" />
          </label>
          {!pick && (['all', 'image', 'video', 'unused'] as const).map(v => (
            <button key={v} type="button" onClick={() => setShow(v)} className={chip(show === v)}>{v === 'all' ? 'All' : v === 'image' ? 'Photos' : v === 'video' ? 'Videos' : 'Not used yet'}</button>
          ))}
          <div className="ml-auto flex flex-wrap gap-2">
            {pick !== 'image' && <button type="button" onClick={() => setYtOpen(v => !v)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-line bg-white px-3.5 text-sm font-semibold text-ink hover:bg-surface"><Youtube className="h-4 w-4" /> Add YouTube link</button>}
            <button type="button" onClick={() => fileInput.current?.click()} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:opacity-90"><Upload className="h-4 w-4" /> Upload {pick === 'image' ? 'photos' : 'photos or clips'}</button>
            <input ref={fileInput} type="file" multiple hidden accept={pick === 'image' ? 'image/*' : 'image/*,video/mp4,video/webm,video/quicktime'} onChange={e => { const f = Array.from(e.target.files || []); e.target.value = ''; if (f.length) upload(f); }} />
          </div>
        </div>

        {ytOpen && (
          <div className="flex flex-wrap items-end gap-2 rounded-xl border border-line bg-white p-3">
            <label className="flex min-w-[16rem] flex-1 flex-col gap-1 text-sm font-semibold text-ink">YouTube link
              <input value={yt.link} onChange={e => setYt(v => ({ ...v, link: e.target.value }))} placeholder="https://youtu.be/…" className="rounded-lg border border-line px-3 py-2 font-normal" />
            </label>
            <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-sm font-semibold text-ink">Name
              <input value={yt.name} onChange={e => setYt(v => ({ ...v, name: e.target.value }))} placeholder="e.g. HLA Garment testimonial" className="rounded-lg border border-line px-3 py-2 font-normal" />
            </label>
            <button type="button" onClick={addYoutube} className="min-h-10 rounded-lg bg-accent px-4 text-sm font-semibold text-white">Add</button>
            <p className="basis-full text-xs text-ink-soft">Long videos go on YouTube (unlisted is fine): it streams them free and smoothly on any phone.</p>
          </div>
        )}

        <div
          onDragOver={e => { e.preventDefault(); }}
          onDrop={e => { e.preventDefault(); const f = Array.from(e.dataTransfer.files || []); if (f.length) upload(f); }}
          className="flex min-h-14 items-center justify-center gap-2 rounded-xl border-2 border-dashed border-accent/40 bg-accent-soft/40 px-4 text-center text-sm font-semibold text-accent">
          {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> {busy}</> : <><Upload className="h-4 w-4" /> Drop photos or clips here, or paste a screenshot (Ctrl+V)</>}
        </div>
        {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

        {media === null ? <p className="flex items-center gap-2 py-8 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
          : list.length === 0 ? <p className="py-8 text-center text-ink-soft">Nothing here yet. Upload photos or add a YouTube link.</p>
          : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {paged.pageItems.map(m => <Tile key={m.id} m={m} selected={m.id === selId} used={uses[m.id]?.length || 0} onClick={() => setSelId(m.id)} />)}
              </div>
              <ListPager paged={paged} noun="items" top={top} />
            </>
          )}
      </div>

      {sel && (
        <aside className="flex shrink-0 flex-col gap-4 rounded-xl border border-line bg-white p-4 lg:w-80">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs text-ink-soft">{sel.kind === 'image' ? `Photo · ${sel.width || '?'} × ${sel.height || '?'} · ${kb(sel.size)}` : sel.kind === 'video' ? `Clip · ${kb(sel.size)}` : 'YouTube video'}</p>
            <button type="button" onClick={() => setSelId('')} aria-label="Close details" className="rounded p-1 text-ink-soft hover:bg-surface"><X className="h-4 w-4" /></button>
          </div>
          {sel.kind === 'image' && (
            <div className="relative cursor-crosshair overflow-hidden rounded-lg" title="Click where the photo should stay in view on phones"
              onClick={e => { if (!canChange(sel)) return; const b = e.currentTarget.getBoundingClientRect(); save({ focusX: Math.round(((e.clientX - b.left) / b.width) * 100), focusY: Math.round(((e.clientY - b.top) / b.height) * 100) }); }}>
              <img src={sel.url} alt={sel.alt || ''} className="block w-full" />
              <span className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white shadow-[0_0_0_2px_#0E6E62]" style={{ left: `${sel.focusX ?? 50}%`, top: `${sel.focusY ?? 50}%` }} />
            </div>
          )}
          {sel.kind === 'youtube' && <img src={`https://i.ytimg.com/vi/${sel.youtubeId}/hqdefault.jpg`} alt="" className="w-full rounded-lg" />}
          {sel.kind === 'video' && <video src={sel.url} controls preload="metadata" className="w-full rounded-lg" />}
          {sel.kind === 'image' && <p className="-mt-2 text-xs text-ink-soft">Click the photo to set the focus point: phones crop around it.</p>}

          <label className="flex flex-col gap-1 text-sm font-semibold text-ink">Name
            <input defaultValue={sel.name} key={`n${sel.id}`} disabled={!canChange(sel)} onBlur={e => e.target.value.trim() !== sel.name && save({ name: e.target.value.trim() || sel.name })} className="rounded-lg border border-line px-3 py-2 font-normal" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold text-ink">Describe the {sel.kind === 'image' ? 'photo' : 'video'}
            <textarea rows={2} defaultValue={sel.alt || ''} key={`a${sel.id}`} disabled={!canChange(sel)} onBlur={e => e.target.value !== (sel.alt || '') && save({ alt: e.target.value })} className="resize-none rounded-lg border border-line px-3 py-2 font-normal" />
            <span className="text-xs font-normal text-ink-soft">Helps Google find it and helps blind visitors.</span>
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold text-ink">Folder
            <select value={sel.folder || 'Other'} disabled={!canChange(sel)} onChange={e => save({ folder: e.target.value })} className="rounded-lg border border-line bg-white px-3 py-2 font-normal">
              {MEDIA_FOLDERS.map(f => <option key={f}>{f}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold text-ink">Tags
            <input defaultValue={(sel.tags || []).map(t => '#' + t).join(' ')} key={`t${sel.id}`} disabled={!canChange(sel)} placeholder="#leadership #hero"
              onBlur={e => save({ tags: e.target.value.split(/[\s,]+/).map(t => t.replace(/^#/, '').trim().toLowerCase()).filter(Boolean) })} className="rounded-lg border border-line px-3 py-2 font-normal" />
          </label>
          <div className="text-sm">
            <p className="font-semibold text-ink">Used on</p>
            {uses[sel.id]?.length ? uses[sel.id].map(t => <p key={t} className="text-ink-soft">{t}</p>) : <p className="text-ink-soft">No page yet</p>}
          </div>
          {onPick && (pick !== 'image' || sel.kind === 'image') && (
            <button type="button" onClick={() => onPick(sel)} className="min-h-11 rounded-lg bg-accent px-4 font-semibold text-white">Use this</button>
          )}
          {!onPick && (
            <div className="mt-auto flex flex-wrap gap-2">
              {owner && sel.kind !== 'youtube' && <>
                <button type="button" onClick={() => replaceInput.current?.click()} className="min-h-10 flex-1 rounded-lg border border-line px-3 text-sm font-semibold text-ink hover:bg-surface">Replace everywhere</button>
                <input ref={replaceInput} type="file" hidden accept={sel.kind === 'image' ? 'image/*' : 'video/mp4,video/webm,video/quicktime'} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) replace(f); }} />
              </>}
              {canChange(sel) && (
                <button type="button" onClick={remove} disabled={!!uses[sel.id]?.length} title={uses[sel.id]?.length ? 'In use on a page' : undefined}
                  className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-line px-3 text-sm font-semibold text-danger hover:bg-danger-soft disabled:cursor-not-allowed disabled:text-ink-soft disabled:hover:bg-transparent">
                  <Trash2 className="h-4 w-4" /> Delete
                </button>
              )}
              {!!uses[sel.id]?.length && canChange(sel) && <p className="basis-full text-xs text-ink-soft">Can't delete while a page uses it.</p>}
            </div>
          )}
        </aside>
      )}
    </div>
  );
}

/** The picker the page editor opens from a photo or video box. */
export function MediaPickerDialog({ me, owner, pages, kind, onPick, onClose }: { me: Viewer; owner: boolean; pages: SitePage[]; kind: 'image' | 'video'; onPick: (m: SiteMedia) => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={kind === 'image' ? 'Pick a photo' : 'Pick a video'} onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-6xl flex-col gap-4 overflow-auto rounded-2xl bg-surface p-5 font-sans text-ink" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-bold">{kind === 'image' ? <ImageIcon className="h-5 w-5" /> : <Film className="h-5 w-5" />} {kind === 'image' ? 'Pick a photo' : 'Pick a video'}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 hover:bg-white"><X className="h-5 w-5" /></button>
        </div>
        <MediaLibrary me={me} owner={owner} pages={pages} pick={kind} onPick={onPick} />
      </div>
    </div>
  );
}
