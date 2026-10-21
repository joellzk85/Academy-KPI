// Trainers' own course outlines and teambuilding proposals (Joel, 2026-10-21: "in trainer portal, trainer can submit
// course outline - directly links to our course outline"; "trainer can edit their own course outline as well";
// "trainer can create teambuilding proposal as well - but cannot download").
// Shared by the server (serverTrainerDocs.ts), the portal (TrainerPortalDocs.tsx) and the CRM screens. Pure, so it can be tested.
//
// trainer_docs/{id}: the trainer's own copy, written only by the server (members read it).
//   { kind: 'outline' | 'teambuilding', trainerId, trainerName, draft, sent?, version, sentAt?, createdAt, updatedAt, archived? }
//   draft  what the trainer is typing (saved as they type)
//   sent   what they last sent to NEXT Academy ("Send to NEXT Academy" / "Send changes"); the team reads only this
//   version goes up by one on every send
// The team clicks "Use for a deal" (Course outlines / Teambuilding proposal → From trainers): that makes our own
// course outline or teambuilding proposal from the sent copy, remembering fromTrainerDocId and fromTrainerDocVersion.
// When the trainer sends a newer version, our copy shows "<trainer> updated this: bring in the changes?". Their
// edits never change our copy by themselves, so nothing already sent to a client changes.
// A trainer's teambuilding proposal has the content parts only (Joel's choice): cover, objectives, agenda, activities,
// trainers, key takeaways. Packages and prices, venues, HRDC and terms are added by the team.

import { OutlineSubmission, cleanOutline, outlineProblem, outlineSummary } from './trainerLinks';
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
// (the Activity library's). Anything else is dropped.
export function photoPath(url: string): string {
  const m = /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/[^/]+\/o\/([^?#]+)/.exec(String(url || ''));
  if (!m) return '';
  try { return decodeURIComponent(m[1]); } catch { return ''; }
}
export function photoOk(url: any, trainerId: string, bucket = ''): boolean {
  const u = String(url || '');
  if (u.length > 1000) return false;
  if (bucket && !u.startsWith(`https://firebasestorage.googleapis.com/v0/b/${bucket}/o/`)) return false;
  const path = photoPath(u);
  return !!path && !path.includes('..') && (path.startsWith(`trainer_portal/${trainerId}/`) || path.startsWith('photos/'));
}
const photos = (v: any, trainerId: string, bucket: string, most: number) =>
  (Array.isArray(v) ? v : []).filter((u: any) => photoOk(u, trainerId, bucket)).map(String).slice(0, most);

const points = (v: any, p: string) => (Array.isArray(v) ? v : []).slice(0, 20)
  .map((x: any, i: number) => ({ id: id(x?.id, p, i), title: text(x?.title, 200), text: text(x?.text, 1500) }));

export function cleanTrainerTb(d: any, trainerId: string, bucket = ''): TrainerTb {
  const tags = AGENDA_TAGS.map(t => t.key);
  return {
    title: text(d?.title, 200), subtitle: text(d?.subtitle, 500), stay: text(d?.stay, 60),
    coverPhoto: photos([d?.coverPhoto], trainerId, bucket, 1)[0] || '',
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
        name: text(a?.name, 120), summary: text(a?.summary, 400), photos: photos(a?.photos, trainerId, bucket, 8),
        duration: text(a?.duration, 60), location: LOCATIONS.includes(a?.location) ? a.location : 'Indoor', format: text(a?.format, 120),
        groupSize: text(a?.groupSize, 60), minPax: num(a?.minPax, 0, 10000) || undefined, maxPax: num(a?.maxPax, 0, 10000) || undefined,
        objectives: list(a?.objectives, 300, 20), howPlayed: text(a?.howPlayed, 4000), takeaways: list(a?.takeaways, 300, 20),
        materials: list(a?.materials, 200, 30), deliverables: text(a?.deliverables, 2000), ratings,
      };
    }).map((a: any) => JSON.parse(JSON.stringify(a))),
    trainers: (Array.isArray(d?.trainers) ? d.trainers : []).slice(0, 8).map((t: any, i: number) => {
      const self = t?.trainerId === trainerId;   // the trainer themself: name and photo come from their profile
      return JSON.parse(JSON.stringify({
        id: id(t?.id, 'tr', i), ...(self ? { trainerId } : { name: text(t?.name, 100), photo: photos([t?.photo], trainerId, bucket, 1)[0] || '' }),
        // Their own bio left empty = the bio on their profile.
        role: text(t?.role, 120), bio: self && !str(t?.bio, 3000) ? undefined : text(t?.bio, 3000),
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

// Typed but not sent yet.
export const hasUnsent = (d: Pick<TrainerDoc, 'draft' | 'sent'>) => !d.sent || JSON.stringify(d.draft) !== JSON.stringify(d.sent);

// The team's copy is behind the trainer's latest send.
export function newerFromTrainer(ours: { fromTrainerDocId?: string; fromTrainerDocVersion?: number }, docs: TrainerDoc[]): TrainerDoc | null {
  if (!ours.fromTrainerDocId) return null;
  const d = docs.find(x => x.id === ours.fromTrainerDocId);
  return d && d.sent && !d.archived && d.version > (ours.fromTrainerDocVersion || 0) ? d : null;
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
