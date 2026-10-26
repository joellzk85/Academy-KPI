// Trainers' own course outlines and teambuilding proposals (Joel, 2026-10-21: "in trainer portal, trainer can submit
// course outline - directly links to our course outline"; "trainer can edit their own course outline as well";
// "trainer can create teambuilding proposal as well - but cannot download").
// Shared by the server (serverTrainerDocs.ts), the portal (TrainerPortalDocs.tsx) and the CRM screens. Pure, so it can be tested.
//
// One record, no copies (Joel, 2026-10-26: "trainer portal, trainer links to fill up proposal and course outline, it
// all should just link back to crm database"). A trainer's course outline or teambuilding proposal IS the CRM's
// course_outlines / teambuilding_proposals record, marked writerTrainerId / writerTrainerName. The portal, My trainings
// (internal trainers) and trainer links write only the trainer's parts into it, through the server
// (serverTrainerDocs.ts writeTrainerParts), saved as they type; the team sees every change straight away.
// Once the team sends it to a client (status 'sent') it's locked for the trainer too, until the team clicks Revise.
// partsStamp: the server refuses a save made on top of an older version of the trainer's parts (someone else changed
// them in between), so nobody's work is silently overwritten.
// A trainer's teambuilding proposal has the content parts only (Joel's choice): cover, objectives, agenda, activities,
// trainers, key takeaways. Packages and prices, venues, HRDC and terms are added by the team.
//
// Before 2026-10-26 the trainer kept their own copy in trainer_docs/{id} (draft, sent, version) and the team made our
// own copy with "Use for a deal" (fromTrainerDocId / fromTrainerDocVersion). The server moves each trainer's
// trainer_docs into the CRM the first time their list is opened (archived: true, movedTo: <record id>); copies the
// team already made stay as they are.

import { OutlineSubmission, cleanOutline, outlineFieldsFrom, outlineProblem, outlineSummary } from './trainerLinks';
import {
  AGENDA_TAGS, AgendaTag, LOCATIONS, RATINGS, TbAgendaDay, TbPoint, TbProposal, TbProposalActivity, TbSection, TbTrainer,
  SECTION_DEFAULTS, blankActivity, defaultPackages,
} from './teambuilding';

export type TrainerDocKind = 'outline' | 'teambuilding';

export interface TrainerTb {
  title: string; subtitle: string; stay: string; coverPhoto: string;
  objectives: TbPoint[]; agenda: TbAgendaDay[]; activities: TbProposalActivity[]; trainers: TbTrainer[]; takeaways: TbPoint[];
}
export interface TrainerDocContent {
  programmeId: string;
  outline?: OutlineSubmission;
  tb?: TrainerTb;
}
export interface TrainerDoc {
  id: string; kind: TrainerDocKind; trainerId: string; trainerName: string;
  draft: TrainerDocContent; sent?: TrainerDocContent; version: number; sentAt?: number;
  createdAt: number; updatedAt: number; archived?: boolean;
}

// The sections a trainer's proposal fills in; the rest are the team's.
export const TRAINER_TB_SECTIONS = ['objectives', 'trainers', 'agenda', 'activities', 'takeaways'] as const;

// ---------- Cleaning (the server stores only what these return) ----------
const str = (v: any, max: number) => String(v ?? '').replace(/\u0000/g, '').trim().slice(0, max);
const text = (v: any, max: number) => String(v ?? '').replace(/\u0000/g, '').slice(0, max);   // keeps spaces while typing
const num = (v: any, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : 0;
};
const id = (v: any, p: string, i: number) => (/^[A-Za-z0-9_-]{1,60}$/.test(String(v || '')) ? String(v) : `${p}_${i}`);
const list = (v: any, each: number, most: number) =>
  (Array.isArray(v) ? v : []).map((x: any) => text(x, each)).slice(0, most);

// A photo must be a Firebase download link from our own bucket, in the trainer's portal folder or the team's photos
// (the Activity library's). Anything else is dropped. A trainer link (no login) uploads into its own folder,
// trainer_uploads/<token>/ (`folder`).
export function photoPath(url: string): string {
  const m = /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/[^/]+\/o\/([^?#]+)/.exec(String(url || ''));
  if (!m) return '';
  try { return decodeURIComponent(m[1]); } catch { return ''; }
}
export function photoOk(url: any, trainerId: string, bucket = '', folder = `trainer_portal/${trainerId}/`): boolean {
  const u = String(url || '');
  if (u.length > 1000) return false;
  if (bucket && !u.startsWith(`https://firebasestorage.googleapis.com/v0/b/${bucket}/o/`)) return false;
  const path = photoPath(u);
  return !!path && !path.includes('..') && ((!!folder && !folder.includes('//') && path.startsWith(folder)) || path.startsWith('photos/'));
}

// What the record already has stays allowed: photos the team added, trainers the team picked from the list.
export interface TbKeep { photos: Set<string>; trainerIds: Set<string> }
export interface TbCleanOptions { folder?: string; keep?: TbKeep }
export function keepOf(record: any): TbKeep {
  const photos = new Set<string>();
  const json = JSON.stringify(record || {});
  for (const m of json.matchAll(/"(https:\/\/firebasestorage\.googleapis\.com\/[^"\\]+)"/g)) photos.add(m[1]);
  const trainerIds = new Set<string>((record?.trainers || []).map((t: any) => String(t?.trainerId || '')).filter(Boolean));
  return { photos, trainerIds };
}

const points = (v: any, p: string) => (Array.isArray(v) ? v : []).slice(0, 20)
  .map((x: any, i: number) => ({ id: id(x?.id, p, i), title: text(x?.title, 200), text: text(x?.text, 1500) }));

export function cleanTrainerTb(d: any, trainerId: string, bucket = '', opt: TbCleanOptions = {}): TrainerTb {
  const tags = AGENDA_TAGS.map(t => t.key);
  const folder = opt.folder ?? (trainerId ? `trainer_portal/${trainerId}/` : '');
  const photos = (v: any, most: number) => (Array.isArray(v) ? v : [])
    .filter((u: any) => opt.keep?.photos.has(String(u || '')) || photoOk(u, trainerId, bucket, folder)).map(String).slice(0, most);
  return {
    title: text(d?.title, 200), subtitle: text(d?.subtitle, 500), stay: text(d?.stay, 60),
    coverPhoto: photos([d?.coverPhoto], 1)[0] || '',
    objectives: points(d?.objectives, 'ob'),
    takeaways: points(d?.takeaways, 'tk'),
    agenda: (Array.isArray(d?.agenda) ? d.agenda : []).slice(0, 7).map((day: any, i: number) => ({
      id: id(day?.id, 'day', i), title: text(day?.title, 200),
      rows: (Array.isArray(day?.rows) ? day.rows : []).slice(0, 40).map((r: any, k: number) => ({
        id: id(r?.id, `ar${i}`, k), time: text(r?.time, 60), text: text(r?.text, 300),
        tag: (tags.includes(r?.tag) ? r.tag : '') as AgendaTag,
      })),
    })),
    activities: (Array.isArray(d?.activities) ? d.activities : []).slice(0, 20).map((a: any, i: number) => {
      const ratings: Record<string, number> = {};
      RATINGS.forEach(r => { const n = num(a?.ratings?.[r.key], 0, 100); if (n) ratings[r.key] = n; });
      const libraryId = /^[A-Za-z0-9_-]{1,60}$/.test(String(a?.libraryId || '')) ? String(a.libraryId) : '';
      return {
        ...blankActivity(),
        id: id(a?.id, 'pa', i), ...(libraryId ? { libraryId } : {}),
        name: text(a?.name, 120), summary: text(a?.summary, 400), photos: photos(a?.photos, 8),
        duration: text(a?.duration, 60), location: LOCATIONS.includes(a?.location) ? a.location : 'Indoor', format: text(a?.format, 120),
        groupSize: text(a?.groupSize, 60), minPax: num(a?.minPax, 0, 10000) || undefined, maxPax: num(a?.maxPax, 0, 10000) || undefined,
        objectives: list(a?.objectives, 300, 20), howPlayed: text(a?.howPlayed, 4000), takeaways: list(a?.takeaways, 300, 20),
        materials: list(a?.materials, 200, 30), deliverables: text(a?.deliverables, 2000), ratings,
      };
    }).map((a: any) => JSON.parse(JSON.stringify(a))),
    trainers: (Array.isArray(d?.trainers) ? d.trainers : []).slice(0, 8).map((t: any, i: number) => {
      // The trainer themself, or a trainer from our list the team already put on it: name and photo come from the list.
      const listed = !!t?.trainerId && ((!!trainerId && t.trainerId === trainerId) || !!opt.keep?.trainerIds.has(String(t.trainerId)));
      return JSON.parse(JSON.stringify({
        id: id(t?.id, 'tr', i), ...(listed ? { trainerId: String(t.trainerId) } : { name: text(t?.name, 100), photo: photos([t?.photo], 1)[0] || '' }),
        // Their bio left empty = the bio on their profile.
        role: text(t?.role, 120), bio: listed && !str(t?.bio, 3000) ? undefined : text(t?.bio, 3000),
      }));
    }),
  };
}

export function cleanDocContent(kind: TrainerDocKind, d: any, trainerId: string, programmeIds: string[], bucket = ''): TrainerDocContent {
  const programmeId = programmeIds.includes(String(d?.programmeId || '')) ? String(d.programmeId) : '';
  return kind === 'outline'
    ? { programmeId, outline: cleanOutline(d?.outline || {}) }
    : { programmeId, tb: cleanTrainerTb(d?.tb || {}, trainerId, bucket) };
}

// What must be there before sending to NEXT Academy.
export function docProblem(kind: TrainerDocKind, c: TrainerDocContent): string {
  if (kind === 'outline') {
    if (!c.outline) return 'Add at least one module.';
    if (!str(c.outline.courseTitle, 200) && !c.programmeId) return 'Type the course title.';
    return outlineProblem(c.outline);
  }
  const t = c.tb;
  if (!t || !str(t.title, 200)) return 'Type the title.';
  if (!t.activities.some(a => str(a.name, 120)) && !t.agenda.some(d => d.rows.some(r => str(r.text, 300)))) return 'Add an activity or an agenda.';
  return '';
}

// ---------- Showing ----------
export function docTitle(kind: TrainerDocKind, c: TrainerDocContent | undefined, programmes: { id: string; name: string }[] = []): string {
  const own = str(kind === 'outline' ? c?.outline?.courseTitle : c?.tb?.title, 200);
  return own || String(programmes.find(p => p.id === c?.programmeId)?.name || '').trim();
}

export function docSummary(kind: TrainerDocKind, c: TrainerDocContent | undefined): string {
  if (kind === 'outline') return c?.outline ? outlineSummary(c.outline) : '';
  const t = c?.tb;
  if (!t) return '';
  const days = t.agenda.filter(d => d.rows.some(r => r.text.trim())).length;
  const acts = t.activities.filter(a => a.name.trim()).length;
  return [days ? `${days} day${days === 1 ? '' : 's'} of agenda` : '', `${acts} activit${acts === 1 ? 'y' : 'ies'}`].filter(Boolean).join(' · ');
}

// ---------- The trainer's parts of a CRM record (2026-10-26) ----------
export const RECORD_PLACE: Record<TrainerDocKind, string> = { outline: 'course_outlines', teambuilding: 'teambuilding_proposals' };

/** Sent to a client: locked for the trainer until the team clicks Revise. */
export const writerLocked = (r: { status?: string } | null | undefined) => r?.status === 'sent';

/** What the trainer's form starts from: the record's trainer parts. `programmeId` is the one it prints with (its own,
 *  else its deal's). */
export function partsOf(kind: TrainerDocKind, r: any, programmeId: string): TrainerDocContent {
  if (kind === 'outline') return { programmeId, outline: cleanOutline({ ...r, courseTitle: r?.useProgrammeName ? '' : r?.courseTitle, level: undefined }) };
  return {
    programmeId,
    tb: JSON.parse(JSON.stringify({
      title: r?.title || '', subtitle: r?.subtitle || '', stay: r?.stay || '', coverPhoto: r?.coverPhoto || '',
      objectives: r?.objectives || [], agenda: r?.agenda || [], activities: r?.activities || [], trainers: r?.trainers || [], takeaways: r?.takeaways || [],
    })),
  };
}

/** A short fingerprint of the trainer's parts: a save made on an older one is refused. */
export function partsStamp(kind: TrainerDocKind, r: any, programmeId: string): string {
  const s = JSON.stringify(partsOf(kind, r, programmeId));
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${s.length.toString(36)}${(h >>> 0).toString(36)}`;
}

/** The change to the record from what the trainer typed (already cleaned). The programme is written only when they
 *  picked another one (a deal's outline otherwise keeps following its deal). */
export function recordUpdate(kind: TrainerDocKind, c: TrainerDocContent, programmeName: string, programmeChanged: boolean): Record<string, any> {
  const prog = programmeChanged ? { programmeId: c.programmeId } : {};
  if (kind === 'outline') {
    const s = c.outline!;
    const title = str(s.courseTitle, 200);
    const useProg = !!c.programmeId && (!title || title.toUpperCase() === programmeName.trim().toUpperCase());
    const { courseTitle: _t, ...rest } = outlineFieldsFrom(s) as any;
    return JSON.parse(JSON.stringify({ ...rest, courseTitle: useProg ? '' : title, useProgrammeName: useProg, ...prog }));
  }
  return JSON.parse(JSON.stringify({ ...tbFieldsFrom(c.tb!), coverPhoto: c.tb!.coverPhoto || '', ...prog }));
}

// ---------- A trainer's proposal as ours ----------
// The parts a trainer writes, put onto a proposal (a new one, or "bring in the changes" on ours).
export function tbFieldsFrom(t: TrainerTb): Partial<TbProposal> {
  const c: TrainerTb = JSON.parse(JSON.stringify(t));
  return {
    title: c.title, subtitle: c.subtitle, stay: c.stay, ...(c.coverPhoto ? { coverPhoto: c.coverPhoto } : {}),
    objectives: c.objectives, agenda: c.agenda, activities: c.activities, trainers: c.trainers, takeaways: c.takeaways,
  };
}

// For the trainer's Preview: their parts only, no prices, venues, HRDC note or terms.
export function trainerPreviewTb(t: TrainerTb): TbProposal {
  const sections: TbSection[] = SECTION_DEFAULTS.map(s => ({ ...s, hidden: !(TRAINER_TB_SECTIONS as readonly string[]).includes(s.key) }));
  return {
    id: 'preview', kind: 'teambuilding', refNumber: '', date: new Date().toISOString().slice(0, 10),
    ...tbFieldsFrom(t), sections, venues: [], packages: { ...defaultPackages(), cols: [], bands: [] },
    hrdcNote: '', terms: '', creatorId: '', ownerId: '', preparedBy: '', preparedForCompany: 'NEXT Academy client',
  } as TbProposal;
}

export const blankTrainerTb = (trainerId: string): TrainerTb => ({
  title: '', subtitle: 'This itinerary outlines engaging activities designed for your team.', stay: '', coverPhoto: '',
  objectives: [{ id: 'ob_0', title: '', text: '' }],
  agenda: [{ id: 'day_0', title: 'Day 1', rows: [{ id: 'ar_0', time: '', text: '', tag: '' }] }],
  activities: [], trainers: [{ id: 'tr_0', trainerId, role: 'Accredited HRDC Trainer' }], takeaways: [],
});
