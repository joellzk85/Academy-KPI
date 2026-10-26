import React, { useEffect, useRef, useState } from 'react';
import { collection, deleteDoc, doc, getDoc, onSnapshot, query, serverTimestamp, updateDoc, where, writeBatch } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';
import { Camera, ImagePlus, Loader2, MapPin, X } from 'lucide-react';
import { db, friendlyError, storage } from '../lib/firebase';
import { MAX_PER_MEETING, MeetingKind, MeetingPhoto, PhotoPlace, mapLink, meetingKey, photoKey, readExif, readMeetingPhoto, readPhotoPlace } from '../lib/meetingPhotos';
import { isSuperManager } from '../lib/superManager';
import { formatDate } from '../lib/deals';
import { shrink } from './PhotoPicker';
import { storageError } from './ProposalFiles';

// Meeting photos on a face-to-face appointment or a "Visit" follow-up (lib/meetingPhotos.ts has the rules).

type Viewer = { id: string; name: string; role: string };

// All meeting photos of one deal, oldest first.
export function useDealMeetingPhotos(dealId: string): MeetingPhoto[] {
  const [list, setList] = useState<MeetingPhoto[]>([]);
  useEffect(() => onSnapshot(query(collection(db, 'meeting_photos'), where('dealId', '==', dealId)),
    s => setList(s.docs.map(d => readMeetingPhoto(d.id, d.data())).sort((a, b) => a.createdAt - b.createdAt)), () => setList([])), [dealId]);
  return list;
}

// Every meeting photo (KPI, appraisal and the weekly presentation).
export function useMeetingPhotos(): MeetingPhoto[] {
  const [list, setList] = useState<MeetingPhoto[]>([]);
  useEffect(() => onSnapshot(query(collection(db, 'meeting_photos')), s => setList(s.docs.map(d => readMeetingPhoto(d.id, d.data()))), () => setList([])), []);
  return list;
}

// Where the phone is now, or why we couldn't tell (never blocks the photo).
function whereNow(): Promise<{ lat?: number; lng?: number; accuracy?: number; locNote?: string }> {
  if (!navigator.geolocation) return Promise.resolve({ locNote: 'This browser can\'t give a location.' });
  return new Promise(res => navigator.geolocation.getCurrentPosition(
    p => res({ lat: Math.round(p.coords.latitude * 1e6) / 1e6, lng: Math.round(p.coords.longitude * 1e6) / 1e6, accuracy: Math.round(p.coords.accuracy) }),
    e => res({ locNote: e.code === 1 ? 'Location not allowed on this phone or browser.' : 'Location could not be found.' }),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
  ));
}

async function submitPhoto(file: File, source: 'camera' | 'gallery', deal: any, kind: MeetingKind, noteId: string, meetingDate: string, me: Viewer, onProgress: (pct: number) => void) {
  if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) throw new Error(`"${file.name}" isn't a photo.`);
  if (file.size > 25 * 1024 * 1024) throw new Error(`"${file.name}" is too big (over 25 MB).`);
  const place = whereNow();
  const exif = readExif(await file.arrayBuffer());
  const blob = await shrink(file);
  const id = doc(collection(db, 'meeting_photos')).id;
  const path = `meeting_photos/${id}.jpg`;
  const r = ref(storage, path);
  const task = uploadBytesResumable(r, blob, { contentType: 'image/jpeg', customMetadata: { uploadedBy: me.id, dealId: deal.id } });
  await new Promise<void>((resolve, reject) => task.on('state_changed', s => onProgress(s.totalBytes ? Math.round((s.bytesTransferred / s.totalBytes) * 100) : 0), reject, () => resolve()));
  const url = await getDownloadURL(r);
  const where = await place;
  const placeDoc: Record<string, any> = { byId: me.id, at: serverTimestamp(), source };
  (['lat', 'lng', 'accuracy', 'locNote'] as const).forEach(k => { if (where[k] !== undefined) placeDoc[k] = where[k]; });
  if (exif.time) placeDoc.exifTime = exif.time;
  if (exif.lat !== undefined && exif.lng !== undefined) { placeDoc.exifLat = exif.lat; placeDoc.exifLng = exif.lng; }
  const b = writeBatch(db);
  b.set(doc(db, 'meeting_photos', id), {
    dealId: deal.id, clientId: deal.clientId || '', kind, noteId, meetingDate, url, path,
    byId: me.id, byName: me.name, source, present: false, createdAt: serverTimestamp(),
  });
  b.set(doc(db, 'meeting_photo_places', id), placeDoc);
  await b.commit();
}

const myt = (ms: number) => new Date(ms).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const exifText = (t: string) => { const d = t.slice(0, 10); const [h, m] = t.slice(11, 16).split(':').map(Number); return `${formatDate(d)}, ${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };

function PlaceBox({ photo, onClose }: { photo: MeetingPhoto; onClose: () => void }) {
  const [p, setP] = useState<PhotoPlace | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { getDoc(doc(db, 'meeting_photo_places', photo.id)).then(d => setP(readPhotoPlace(d.data())), e => setError(friendlyError(e))); }, [photo.id]);
  const row = 'flex flex-wrap gap-x-2';
  const otherDay = p?.exifTime && p.exifTime.slice(0, 10) !== photo.meetingDate;
  return (
    <div className="mt-2 rounded-lg border border-line bg-white px-3 py-2 text-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold">Time & place · {photo.byName}</p>
        <button type="button" onClick={onClose} className="text-ink-soft hover:text-ink" aria-label="Close"><X className="h-4 w-4" /></button>
      </div>
      {error ? <p className="text-danger">{error}</p> : !p ? <p className="flex items-center gap-1.5 text-ink-soft"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</p> : (
        <div className="mt-1 space-y-1">
          <p className={row}><span className="text-ink-soft">Submitted:</span>{p.at ? myt(p.at) : '–'}<span className="text-ink-soft">({photo.source === 'camera' ? 'Take photo' : 'from gallery'})</span></p>
          <p className={row}><span className="text-ink-soft">Phone was at:</span>
            {p.lat !== undefined && p.lng !== undefined
              ? <a href={mapLink(p.lat, p.lng)} target="_blank" rel="noreferrer" className="font-semibold text-accent hover:underline">Open map{p.accuracy ? ` (within ${p.accuracy} m)` : ''}</a>
              : <span className="text-attention">{p.locNote || 'No location'}</span>}
          </p>
          <p className={row}><span className="text-ink-soft">Photo's own time:</span>{p.exifTime ? <span className={otherDay ? 'font-semibold text-attention' : ''}>{exifText(p.exifTime)}{otherDay ? ' · not the meeting day' : ''}</span> : <span className="text-ink-soft">not in the photo</span>}</p>
          <p className={row}><span className="text-ink-soft">Photo's own place:</span>
            {p.exifLat !== undefined && p.exifLng !== undefined
              ? <a href={mapLink(p.exifLat, p.exifLng)} target="_blank" rel="noreferrer" className="font-semibold text-accent hover:underline">Open map</a>
              : <span className="text-ink-soft">not in the photo</span>}
          </p>
        </div>
      )}
    </div>
  );
}

// The photos of one meeting, with Take photo / From gallery for people who can add.
export default function MeetingPhotos({ photos, deal, kind, noteId = '', meetingDate, viewer, canAdd }: {
  photos: MeetingPhoto[]; deal: any; kind: MeetingKind; noteId?: string; meetingDate: string; viewer: Viewer; canAdd: boolean;
}) {
  const camRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [placeOf, setPlaceOf] = useState('');
  const key = meetingKey(deal.id, kind, noteId);
  const mine = photos.filter(p => photoKey(p) === key);
  const owner = isSuperManager(viewer);
  const room = canAdd && mine.length < MAX_PER_MEETING;
  if (!mine.length && !room) return null;

  const add = async (files: FileList | null, source: 'camera' | 'gallery') => {
    const f = files?.[0];
    if (camRef.current) camRef.current.value = '';
    if (galRef.current) galRef.current.value = '';
    if (!f || busy !== null) return;
    setError('');
    setBusy(0);
    try { await submitPhoto(f, source, deal, kind, noteId, meetingDate, viewer, setBusy); }
    catch (e: any) { setError(e?.code?.startsWith?.('storage/') ? storageError(e) : e?.code ? friendlyError(e) : String(e?.message || e)); }
    finally { setBusy(null); }
  };
  const togglePresent = async (p: MeetingPhoto) => {
    try { await updateDoc(doc(db, 'meeting_photos', p.id), { present: !p.present }); } catch (e) { setError(friendlyError(e)); }
  };
  const remove = async (p: MeetingPhoto) => {
    if (!window.confirm('Remove this meeting photo? The meeting then counts as having no photo.')) return;
    try { await deleteDoc(doc(db, 'meeting_photos', p.id)); } catch (e) { setError(friendlyError(e)); }
  };

  return (
    <div className="mt-2">
      <p className="mb-1 text-sm font-semibold text-ink">Meeting photo{mine.length ? ` (${mine.length})` : ''}</p>
      {mine.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {mine.map(p => (
            <li key={p.id} className="w-36">
              <div className="relative h-24 w-36 overflow-hidden rounded-lg border border-line bg-surface">
                <a href={p.url} target="_blank" rel="noreferrer" aria-label="Open photo"><img src={p.url} alt="Meeting" className="h-full w-full object-cover" /></a>
                {(p.byId === viewer.id || viewer.role === 'management') && (
                  <button type="button" onClick={() => remove(p)} className="absolute right-1 top-1 rounded bg-ink/60 p-0.5 text-white" aria-label="Remove photo"><X className="h-3.5 w-3.5" /></button>
                )}
              </div>
              <p className="mt-0.5 truncate text-xs text-ink-soft">{p.byName}</p>
              {p.byId === viewer.id ? (
                <label className="flex items-center gap-1.5 text-xs">
                  <input type="checkbox" checked={p.present} onChange={() => togglePresent(p)} className="h-3.5 w-3.5 accent-[#0E6E62]" />Show in presentation
                </label>
              ) : p.present ? <p className="text-xs text-ink-soft">In presentation</p> : null}
              {owner && (
                <button type="button" onClick={() => setPlaceOf(placeOf === p.id ? '' : p.id)} className="mt-0.5 inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
                  <MapPin className="h-3.5 w-3.5" />Time & place
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {owner && placeOf && mine.some(p => p.id === placeOf) && <PlaceBox photo={mine.find(p => p.id === placeOf)!} onClose={() => setPlaceOf('')} />}
      {room && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {busy !== null ? (
            <span className="inline-flex items-center gap-1.5 text-sm text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" />Sending photo… {busy}%</span>
          ) : (
            <>
              <button type="button" onClick={() => camRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-semibold text-ink hover:bg-surface"><Camera className="h-4 w-4" />Take photo</button>
              <button type="button" onClick={() => galRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-semibold text-ink hover:bg-surface"><ImagePlus className="h-4 w-4" />From gallery</button>
              {!mine.length && <span className="text-sm text-ink-soft">Proof of the meeting; counts in your KPI.</span>}
            </>
          )}
        </div>
      )}
      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => add(e.target.files, 'camera')} />
      <input ref={galRef} type="file" accept="image/*" className="hidden" onChange={e => add(e.target.files, 'gallery')} />
      {error && <p role="alert" className="mt-1 text-sm text-danger">{error}</p>}
    </div>
  );
}
