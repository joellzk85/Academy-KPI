// Meeting photos (Joel, 2026-10-26): proof that a face-to-face meeting with a client really happened.
// - Taken on a face-to-face appointment (booked from its day on, or held) or a follow-up logged as "Visit", with
//   "Take photo" (the phone camera) or "From gallery".
// - meeting_photos/{id}: the photo itself (dealId, which meeting, the link, who, camera or gallery, "Show in
//   presentation"). Every team member can see it. Files: Storage meeting_photos/{id}.jpg.
// - meeting_photo_places/{id} (same id): when it was submitted (the database's own clock, not the phone's), where the
//   phone was, and the time and place stored inside the photo when it has them. Nobody can read these from a browser
//   except through the owner override (firestore.rules); the screen shows them only to that login.
// - KPI "Meeting photos" (lib/kpi.ts): the % of a person's face-to-face meetings this month that have a photo. The
//   appointment counts for the deal owner (like the Appointments KPI), a visit for whoever logged it.
// - Appraisal (lib/scorecard.ts photoShare): the same % counts for part of the Accountability and Trustworthiness values.
// - The person who took a photo can tick "Show in presentation"; the weekly presentation's Meeting photos slide shows it.

import { apptOf } from './appointments';
import { dealOwnerId } from './deals';
import { followUpNotes } from './followUps';

export type MeetingKind = 'appointment' | 'visit';
export const MEETING_KIND_LABELS: Record<MeetingKind, string> = { appointment: 'Appointment', visit: 'Visit' };

export interface MeetingPhoto {
  id: string;
  dealId: string;
  clientId: string;
  kind: MeetingKind;
  noteId: string;            // the follow-up note of a visit ('' for an appointment)
  meetingDate: string;       // YYYY-MM-DD
  url: string;
  path: string;
  byId: string; byName: string;
  source: 'camera' | 'gallery';
  present: boolean;
  createdAt: number;         // ms
}

export interface PhotoPlace {
  at: number | null;                   // submitted, by the database's clock (ms)
  lat?: number; lng?: number; accuracy?: number;
  locNote?: string;                    // why there is no location
  exifTime?: string;                   // the photo's own time, 'YYYY-MM-DD HH:MM:SS'
  exifLat?: number; exifLng?: number;  // the photo's own place
  source?: 'camera' | 'gallery';
}

export const MAX_PER_MEETING = 5;
export const meetingKey = (dealId: string, kind: MeetingKind, noteId = '') => (kind === 'appointment' ? `appt:${dealId}` : `visit:${dealId}:${noteId}`);
export const photoKey = (p: Pick<MeetingPhoto, 'dealId' | 'kind' | 'noteId'>) => meetingKey(p.dealId, p.kind, p.noteId);

const msOf = (v: any): number => (typeof v === 'number' ? v : typeof v?.toMillis === 'function' ? v.toMillis() : 0);

export function readMeetingPhoto(id: string, d: any): MeetingPhoto {
  return {
    id, dealId: String(d?.dealId || ''), clientId: String(d?.clientId || ''), kind: d?.kind === 'visit' ? 'visit' : 'appointment',
    noteId: String(d?.noteId || ''), meetingDate: String(d?.meetingDate || '').slice(0, 10), url: String(d?.url || ''), path: String(d?.path || ''),
    byId: String(d?.byId || ''), byName: String(d?.byName || ''), source: d?.source === 'gallery' ? 'gallery' : 'camera',
    present: d?.present === true, createdAt: msOf(d?.createdAt),
  };
}
export function readPhotoPlace(d: any): PhotoPlace {
  const num = (v: any) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  return {
    at: msOf(d?.at) || null, lat: num(d?.lat), lng: num(d?.lng), accuracy: num(d?.accuracy), locNote: d?.locNote || undefined,
    exifTime: d?.exifTime || undefined, exifLat: num(d?.exifLat), exifLng: num(d?.exifLng), source: d?.source,
  };
}

// ---------- Which meetings need a photo ----------
export interface FaceMeeting { key: string; dealId: string; kind: MeetingKind; noteId: string; date: string; personId: string }

// Every face-to-face meeting on these deals: held face-to-face appointments (not the old ones without details) and
// follow-ups logged as "Visit".
export function faceMeetings(deals: any[]): FaceMeeting[] {
  const out: FaceMeeting[] = [];
  (deals || []).forEach(d => {
    const a = apptOf(d);
    if (a && a.status === 'held' && !a.legacy && a.mode === 'face') {
      out.push({ key: meetingKey(d.id, 'appointment'), dealId: d.id, kind: 'appointment', noteId: '', date: a.date.slice(0, 10), personId: dealOwnerId(d) });
    }
    followUpNotes(d).filter(n => n.how === 'visit').forEach(n => {
      out.push({ key: meetingKey(d.id, 'visit', n.id), dealId: d.id, kind: 'visit', noteId: n.id, date: n.date.slice(0, 10), personId: n.byId || dealOwnerId(d) });
    });
  });
  return out;
}

// A person's face-to-face meetings dated from..to (YYYY-MM-DD) and how many have a photo. pct is null with no meetings.
export function photoShare(deals: any[], photos: MeetingPhoto[], personId: string, from: string, to: string): { meetings: number; withPhoto: number; pct: number | null } {
  const have = new Set((photos || []).map(photoKey));
  const mine = faceMeetings(deals).filter(m => m.personId === personId && m.date >= from && m.date <= to);
  const withPhoto = mine.filter(m => have.has(m.key)).length;
  return { meetings: mine.length, withPhoto, pct: mine.length ? Math.round((withPhoto / mine.length) * 100) : null };
}

// ---------- The time and place stored inside a JPEG (EXIF) ----------
// Only what we need: DateTimeOriginal (or DateTime) and the GPS position. Anything unreadable gives {}.
export function readExif(buf: ArrayBuffer): { time?: string; lat?: number; lng?: number } {
  try {
    const v = new DataView(buf);
    if (v.getUint16(0) !== 0xffd8) return {};
    let off = 2;
    while (off + 4 < v.byteLength) {
      const marker = v.getUint16(off);
      const size = v.getUint16(off + 2);
      if (marker === 0xffe1 && v.getUint32(off + 4) === 0x45786966) return readTiff(v, off + 10);
      if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) return {};
      off += 2 + size;
    }
  } catch { /* not a readable JPEG */ }
  return {};
}

function readTiff(v: DataView, start: number): { time?: string; lat?: number; lng?: number } {
  const little = v.getUint16(start) === 0x4949;
  const u16 = (o: number) => v.getUint16(start + o, little);
  const u32 = (o: number) => v.getUint32(start + o, little);
  const ascii = (o: number, n: number) => { let s = ''; for (let i = 0; i < n; i++) { const c = v.getUint8(start + o + i); if (!c) break; s += String.fromCharCode(c); } return s; };
  const entries = (ifd: number) => {
    const out: Record<number, { type: number; count: number; at: number }> = {};
    const n = u16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      const type = u16(e + 2), count = u32(e + 4);
      const bytes = count * ({ 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 } as Record<number, number>)[type] || 0;
      out[u16(e)] = { type, count, at: bytes > 4 ? u32(e + 8) : e + 8 };
    }
    return out;
  };
  const text = (t?: { count: number; at: number }) => (t ? ascii(t.at, t.count) : '');
  const rational = (o: number) => { const d = u32(o + 4); return d ? u32(o) / d : 0; };
  const degrees = (t?: { count: number; at: number }) => (t && t.count >= 3 ? rational(t.at) + rational(t.at + 8) / 60 + rational(t.at + 16) / 3600 : NaN);

  const ifd0 = entries(u32(4));
  const exifIfd = ifd0[0x8769] ? entries(u32(ifd0[0x8769].at)) : {};
  const raw = text(exifIfd[0x9003]) || text(ifd0[0x0132]);
  const m = raw.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}:\d{2}:\d{2})/);
  const out: { time?: string; lat?: number; lng?: number } = m ? { time: `${m[1]}-${m[2]}-${m[3]} ${m[4]}` } : {};
  if (ifd0[0x8825]) {
    const g = entries(u32(ifd0[0x8825].at));
    const lat = degrees(g[2]), lng = degrees(g[4]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && (lat || lng)) {
      out.lat = Math.round((text(g[1]) === 'S' ? -lat : lat) * 1e6) / 1e6;
      out.lng = Math.round((text(g[3]) === 'W' ? -lng : lng) * 1e6) / 1e6;
    }
  }
  return out;
}

export const mapLink = (lat: number, lng: number) => `https://www.google.com/maps?q=${lat},${lng}`;
