import React, { useRef, useState } from 'react';
import { FirebaseStorage, getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';
import { FileText, Loader2, Plus, Upload, X } from 'lucide-react';
import { storage } from '../lib/firebase';
import { shrink } from './PhotoPicker';
import { storageError } from './ProposalFiles';
import {
  BIO_LISTS, BioRow, DOC_KINDS, DocKind, rowFilled, GENDERS, LANGUAGES, TRAINER_FILE_ACCEPT, TRAINER_FILE_KINDS, TRAINING_TYPES, TrainerExtras, TrainerFile,
  safeName, topicList, topicText, trainerFileProblem, trainerFileType,
} from '../lib/trainerProfile';

// The extra trainer details (2026-10-20, lib/trainerProfile.ts), shared by the trainer's link page and Trainers → Edit.
// Nothing here is compulsory.

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const label = 'mb-1 block text-sm font-semibold text-ink';
const opt = '(optional)';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-surface disabled:opacity-60';
const check = 'h-4 w-4 accent-[#0E6E62]';

export interface Uploader {
  prefix: string;        // storage folder, ending in "/": trainer_uploads/<token>/ or trainer_files/<trainerId>/
  byName: string;
  uploadedBy?: string;   // the team member's id (the storage rule checks it for trainer_files)
  store?: FirebaseStorage; // the trainer portal's own login (TrainerPortal.tsx); else the CRM's
}

export const sizeText = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

async function put(path: string, data: Blob, type: string, u: Uploader, onProgress: (pct: number) => void): Promise<string> {
  const r = ref(u.store || storage, path);
  const task = uploadBytesResumable(r, data, { contentType: type, customMetadata: u.uploadedBy ? { uploadedBy: u.uploadedBy, uploadedByName: u.byName } : { uploadedByName: u.byName } });
  await new Promise<void>((resolve, reject) => {
    task.on('state_changed', s => onProgress(s.totalBytes ? Math.round((s.bytesTransferred / s.totalBytes) * 100) : 0), reject, () => resolve());
  });
  return getDownloadURL(r);
}

export async function uploadTrainerFile(file: File, kind: DocKind, u: Uploader, onProgress: (pct: number) => void): Promise<TrainerFile> {
  const problem = trainerFileProblem(file.name, file.size);
  if (problem) throw new Error(problem);
  const name = safeName(file.name);
  const path = `${u.prefix}${kind}_${Date.now()}_${name}`;
  const type = trainerFileType(name);
  const url = await put(path, file, type, u, onProgress);
  return { name: file.name.slice(0, 200), size: file.size, type, path, url, at: Date.now(), byName: u.byName };
}

export async function uploadTrainerPhoto(file: File, u: Uploader, onProgress: (pct: number) => void): Promise<string> {
  if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|gif|bmp)$/i.test(file.name)) throw new Error(`"${file.name}" isn't a photo (JPG or PNG).`);
  if (file.size > 25 * 1024 * 1024) throw new Error(`"${file.name}" is too big (over 25 MB).`);
  const blob = await shrink(file);
  return put(`${u.prefix}photo_${Date.now()}.jpg`, blob, 'image/jpeg', u, onProgress);
}

// One drop box: "Drop your biodata here, or click to choose". Shows the file once uploaded, with Replace and Remove.
function DropBox({ title, hint, accept, kinds, current, onFileNote, upload, onRemove, image }: {
  title: string; hint: string; accept: string; kinds: string; current?: { name: string; size?: number; url: string } | null;
  onFileNote?: string; upload: (f: File, onProgress: (p: number) => void) => Promise<void>; onRemove: () => void; image?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [over, setOver] = useState(false);
  const go = async (files: FileList | null | undefined) => {
    const f = files?.[0];
    if (!f || busy !== null) return;
    setError(''); setBusy(0);
    try { await upload(f, setBusy); }
    catch (e: any) { setError(e?.code ? storageError(e) : String(e?.message || e)); }
    finally { setBusy(null); if (inputRef.current) inputRef.current.value = ''; }
  };
  return (
    <div className="rounded-xl border border-line p-3">
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="text-sm text-ink-soft">{hint}</p>
      {current ? (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {image
            ? <img src={current.url} alt={title} className="h-20 w-20 rounded-lg object-cover" />
            : <a href={current.url} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1.5 text-[15px] font-semibold text-accent hover:underline"><FileText className="h-4 w-4 shrink-0" /><span className="truncate">{current.name}</span></a>}
          {!!current.size && <span className="text-sm text-ink-soft">{sizeText(current.size)}</span>}
          <span className="flex gap-2">
            <button type="button" className={btnSecondary} disabled={busy !== null} onClick={() => inputRef.current?.click()}>{busy !== null ? <><Loader2 className="h-4 w-4 animate-spin" /> {busy}%</> : 'Replace'}</button>
            <button type="button" className="rounded-md p-2 text-ink-soft hover:bg-surface" onClick={onRemove} aria-label={`Remove ${title}`}><X className="h-4 w-4" /></button>
          </span>
        </div>
      ) : (
        <button type="button" onClick={() => inputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={e => { e.preventDefault(); setOver(false); go(e.dataTransfer.files); }}
          className={`mt-2 flex w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-3 py-4 text-center text-sm ${over ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-soft hover:border-accent/60 hover:bg-surface'}`}>
          {busy !== null
            ? <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Uploading {busy}%</span>
            : <><Upload className="h-5 w-5" /><span><strong className="text-ink">Drop it here</strong>, or click to choose</span><span className="text-xs">{kinds}</span></>}
        </button>
      )}
      {!current && onFileNote && <p className="mt-1.5 text-sm text-accent">{onFileNote}</p>}
      {error && <p role="alert" className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={e => go(e.target.files)} />
    </div>
  );
}

// "Topics you teach": one row each, with Add another topic (Joel: "able to add multiple").
export function TopicList({ value, onChange, idPrefix }: { value: string; onChange: (text: string) => void; idPrefix: string }) {
  const [rows, setRows] = useState<string[]>(() => { const l = topicList(value); return l.length ? l : ['']; });
  // Keep rows in step when the text changes from outside (a draft brought back, a prefill).
  const last = useRef(value);
  if (value !== last.current && value !== topicText(rows)) { last.current = value; const l = topicList(value); setRows(l.length ? l : ['']); }
  const update = (next: string[]) => { setRows(next); const t = topicText(next); last.current = t; onChange(t); };
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2">
          <input id={`${idPrefix}-${i}`} value={r} onChange={e => update(rows.map((x, k) => (k === i ? e.target.value : x)))}
            placeholder={i === 0 ? 'e.g. Customer service excellence' : 'Another topic'} aria-label={`Topic ${i + 1}`} className={input} />
          <button type="button" className="rounded-md p-2 text-ink-soft hover:bg-surface disabled:opacity-30" disabled={rows.length === 1 && !r}
            onClick={() => update(rows.length === 1 ? [''] : rows.filter((_, k) => k !== i))} aria-label={`Remove topic ${i + 1}`}><X className="h-4 w-4" /></button>
        </div>
      ))}
      <button type="button" className={btnSecondary} onClick={() => setRows([...rows, ''])}><Plus className="h-4 w-4" /> Add another topic</button>
    </div>
  );
}

export type ExtrasPart = 'about' | 'emergency' | 'languages' | 'biodata' | 'online' | 'uploads';

// One HRDC biodata list (academic, professional, career, training): a card per row, with "Add another".
function BioList({ list, rows, onChange, idPrefix }: { list: typeof BIO_LISTS[number]; rows: BioRow[]; onChange: (rows: BioRow[]) => void; idPrefix: string }) {
  const shown = rows.length ? rows : [{}];
  const setRow = (i: number, k: string, val: string) => onChange(shown.map((r, j) => (j === i ? { ...r, [k]: val } : r)));
  return (
    <div className="space-y-3">
      {shown.map((r, i) => (
        <div key={i} className="rounded-xl border border-line p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-ink-soft">{list.title} {i + 1}</span>
            {(shown.length > 1 || rowFilled(r)) && (
              <button type="button" className="rounded-md p-1.5 text-ink-soft hover:bg-surface" onClick={() => onChange(shown.filter((_, j) => j !== i))} aria-label={`Remove ${list.title.toLowerCase()} ${i + 1}`}><X className="h-4 w-4" /></button>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {list.cols.map(c => (
              <div key={c.k}>
                <label className={label} htmlFor={`${idPrefix}-${list.key}-${i}-${c.k}`}>{c.label}</label>
                <input id={`${idPrefix}-${list.key}-${i}-${c.k}`} value={r[c.k] || ''} onChange={e => setRow(i, c.k, e.target.value)}
                  inputMode={c.year && c.k !== 'to' ? 'numeric' : undefined} placeholder={c.ph || (c.year ? 'e.g. 2018' : '')} className={input} />
              </div>
            ))}
          </div>
        </div>
      ))}
      <button type="button" className={btnSecondary} onClick={() => onChange([...shown, {}])}><Plus className="h-4 w-4" /> {list.add}</button>
    </div>
  );
}

export default function TrainerExtrasFields({ value, onChange, uploader, wrap, onFile, photoSlot, idPrefix = 'tx', only, ic, hidePrivate }: {
  // IC / passport number (kept apart from the rest, for Admin and Management only). Not given = the box isn't shown.
  ic?: { value: string; onChange: (v: string) => void; note?: string };
  // Hide the personal details (gender, nationality, race, address, emergency contact): a rep editing a trainer
  // can't see or save them (trainer_private, process audit 2026-10-22: PDPA).
  hidePrivate?: boolean;
  only?: ExtrasPart[];                           // which groups to show (default all)
  value: TrainerExtras;
  onChange: (patch: Partial<TrainerExtras> | ((cur: TrainerExtras) => Partial<TrainerExtras>)) => void;
  uploader: Uploader;
  wrap: (title: string, children: React.ReactNode, hint?: string) => React.ReactNode;
  onFile?: { photo?: boolean; docs?: string[] };  // already on their record (trainer's link page)
  photoSlot?: React.ReactNode;                   // the team's own photo box, instead of ours
  idPrefix?: string;
}) {
  const v = value;
  const ec = v.emergencyContact || { name: '', relationship: '', phone: '' };
  const setEc = (p: Partial<typeof ec>) => onChange({ emergencyContact: { ...ec, ...p } });
  const toggle = <T extends string>(list: T[], x: T, on: boolean) => (on ? [...list.filter(y => y !== x), x] : list.filter(y => y !== x));
  const [otherLang, setOtherLang] = useState(!!v.languagesOther);
  const id = (s: string) => `${idPrefix}-${s}`;
  const show = (p: ExtrasPart) => (!only || only.includes(p)) && !(hidePrivate && p === 'emergency');

  return (
    <>
      {show('about') && wrap('About you', (
        <>
          {!hidePrivate && <div>
            <span className={label}>Gender</span>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Gender">
              {GENDERS.map(g => (
                <button key={g} type="button" role="radio" aria-checked={v.gender === g} onClick={() => onChange({ gender: v.gender === g ? '' : g })}
                  className={`rounded-lg border px-4 py-2 text-[15px] font-semibold ${v.gender === g ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-white text-ink hover:bg-surface'}`}>{g}</button>
              ))}
            </div>
          </div>}
          <div className="grid gap-3 sm:grid-cols-2">
            {ic && (
              <div className="sm:col-span-2">
                <label className={label} htmlFor={id('ic')}>IC / Passport No.</label>
                <input id={id('ic')} value={ic.value} onChange={e => ic.onChange(e.target.value)} className={input} placeholder="e.g. 850101-14-5678" autoComplete="off" />
                <p className="mt-1 text-sm text-ink-soft">{ic.note || 'Kept private: only NEXT Academy Admin and Management can see it.'}</p>
              </div>
            )}
            {!hidePrivate && <div><label className={label} htmlFor={id('nat')}>Nationality</label><input id={id('nat')} value={v.nationality} onChange={e => onChange({ nationality: e.target.value })} className={input} placeholder="e.g. Malaysian" /></div>}
            {!hidePrivate && <div><label className={label} htmlFor={id('race')}>Race</label><input id={id('race')} value={v.race} onChange={e => onChange({ race: e.target.value })} className={input} /></div>}
            <div className="sm:col-span-2"><label className={label} htmlFor={id('ttt')}>TTT certification / exemption number</label><input id={id('ttt')} value={v.tttNumber} onChange={e => onChange({ tttNumber: e.target.value })} className={input} placeholder="From your HRD Corp Train the Trainer certificate" /></div>
          </div>
          {!hidePrivate && <div>
            <label className={label} htmlFor={id('addr')}>Address</label>
            <textarea id={id('addr')} rows={2} value={v.address} onChange={e => onChange({ address: e.target.value })} className={`${input} resize-y`} placeholder="Street, postcode, city, state" />
          </div>}
        </>
      ))}

      {show('emergency') && wrap('Emergency contact', (
        <div className="grid gap-3 sm:grid-cols-3">
          <div><label className={label} htmlFor={id('ec-name')}>Name</label><input id={id('ec-name')} value={ec.name} onChange={e => setEc({ name: e.target.value })} className={input} /></div>
          <div><label className={label} htmlFor={id('ec-rel')}>Relationship</label><input id={id('ec-rel')} value={ec.relationship} onChange={e => setEc({ relationship: e.target.value })} className={input} placeholder="e.g. Spouse" /></div>
          <div><label className={label} htmlFor={id('ec-phone')}>Phone</label><input id={id('ec-phone')} type="tel" value={ec.phone} onChange={e => setEc({ phone: e.target.value })} className={input} /></div>
        </div>
      ))}

      {show('languages') && wrap('Languages and type of training', (
        <>
          <div>
            <span className={label}>Languages you train in</span>
            <div className="flex flex-wrap gap-x-5 gap-y-1.5">
              {LANGUAGES.map(l => (
                <label key={l} className="flex cursor-pointer items-center gap-2 text-[15px]">
                  <input type="checkbox" className={check} checked={v.languages.includes(l)} onChange={e => onChange({ languages: toggle(v.languages, l, e.target.checked) })} /> {l}
                </label>
              ))}
              <label className="flex cursor-pointer items-center gap-2 text-[15px]">
                <input type="checkbox" className={check} checked={otherLang} onChange={e => { setOtherLang(e.target.checked); if (!e.target.checked) onChange({ languagesOther: '' }); }} /> Others
              </label>
            </div>
            {otherLang && <input value={v.languagesOther} onChange={e => onChange({ languagesOther: e.target.value })} className={`${input} mt-2`} placeholder="Which other languages? e.g. Tamil, Cantonese" aria-label="Other languages" autoFocus />}
          </div>
          <div>
            <span className={label}>Type of training</span>
            <div className="flex flex-wrap gap-x-5 gap-y-1.5">
              {TRAINING_TYPES.map(t => (
                <label key={t.id} className="flex cursor-pointer items-center gap-2 text-[15px]">
                  <input type="checkbox" className={check} checked={v.trainingTypes.includes(t.id)} onChange={e => onChange({ trainingTypes: toggle(v.trainingTypes, t.id, e.target.checked) })} /> {t.label}
                </label>
              ))}
            </div>
          </div>
        </>
      ))}

      {show('biodata') && BIO_LISTS.map(l => (
        <React.Fragment key={l.key}>
          {wrap(l.title, <BioList list={l} rows={v[l.key] || []} onChange={rows => onChange({ [l.key]: rows } as Partial<TrainerExtras>)} idPrefix={idPrefix} />)}
        </React.Fragment>
      ))}

      {show('online') && wrap('Online', (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className={label} htmlFor={id('li')}>LinkedIn</label><input id={id('li')} value={v.linkedin} onChange={e => onChange({ linkedin: e.target.value })} className={input} placeholder="linkedin.com/in/…" /></div>
            <div><label className={label} htmlFor={id('yt')}>YouTube link</label><input id={id('yt')} value={v.youtube} onChange={e => onChange({ youtube: e.target.value })} className={input} placeholder="youtube.com/…" /></div>
          </div>
          <div><label className={label} htmlFor={id('so')}>Other social media <span className="font-normal text-ink-soft">{opt}</span></label>
            <textarea id={id('so')} rows={2} value={v.otherSocial} onChange={e => onChange({ otherSocial: e.target.value })} className={`${input} resize-y`} placeholder="Instagram, Facebook, TikTok, website… one per line" /></div>
        </>
      ))}

      {show('uploads') && wrap('Uploads', (
        <div className="grid gap-3 sm:grid-cols-2">
          {photoSlot ?? (
            <DropBox title="Professional photo" hint="A clear headshot. It may be shown to clients on our proposals." accept="image/*" kinds="JPG or PNG" image
              current={v.photoUrl ? { name: 'Photo', url: v.photoUrl } : null}
              onFileNote={onFile?.photo ? 'We already have a photo of you. Upload a new one to replace it.' : ''}
              upload={async (f, p) => onChange({ photoUrl: await uploadTrainerPhoto(f, uploader, p) })}
              onRemove={() => onChange({ photoUrl: '' })} />
          )}
          {DOC_KINDS.map(k => (
            <DropBox key={k.id} title={k.label} hint={k.hint} accept={TRAINER_FILE_ACCEPT} kinds={`${TRAINER_FILE_KINDS}, up to 20 MB`}
              current={v.docs[k.id] || null}
              onFileNote={onFile?.docs?.includes(k.id) ? `We already have your ${k.label.toLowerCase()}. Upload a new one to replace it.` : ''}
              upload={async (f, p) => { const file = await uploadTrainerFile(f, k.id, uploader, p); onChange(cur => ({ docs: { ...cur.docs, [k.id]: file } })); }}
              onRemove={() => onChange(cur => { const d = { ...cur.docs }; delete d[k.id]; return { docs: d }; })} />
          ))}
        </div>
      ), 'PDF, Word, JPG or PNG. You can add these now or later.')}
    </>
  );
}
