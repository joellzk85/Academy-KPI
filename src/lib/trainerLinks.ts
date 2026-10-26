// Trainer links (Joel, 2026-10-17): a private link a trainer opens without logging in, to fill in
// either a course outline or their own profile. What they submit waits in the CRM until the team
// reviews it and clicks Accept. Shared by the server (serverTrainerLinks.ts), the public page
// (TrainerLinkPage.tsx) and the CRM screens. Pure, so it can be tested.
//
// trainer_links/{token}: { kind, token, status, createdAt, expiresAt, requestedById, requestedByName,
//   outlineId?, programmeId?, trainerId?, trainerName?, title?, submission?, submittedAt?, decidedById?, decidedByName?, decidedAt? }
// An outline link either belongs to an outline (outlineId: "Send to trainer" in the editor) or is an invite made
// from the Course outlines list (no outlineId; Joel, 2026-10-20): accepting that one makes a new outline.
// Since 2026-10-26 every new outline invite makes the outline first, and a teambuilding link (kind 'teambuilding',
// proposalId) belongs to its proposal: what the trainer sends goes straight into that record (applied: true), no Accept.

import { TrainerExtras, cleanExtras, cleanIc } from './trainerProfile';
import type { CourseOutline } from '../types';

export type LinkKind = 'outline' | 'profile' | 'teambuilding';
export type LinkStatus = 'open' | 'submitted' | 'accepted' | 'cancelled';
export const LINK_DAYS = 14;

// The same parts as the outline editor (2026-10-20; before, an older form with level, module duration and method).
export interface OutlineSubmission {
  courseTitle?: string;
  durationDays: number; totalHours: number;
  level?: 'Beginner' | 'Intermediate' | 'Advanced';   // older submissions only
  audience: string; prerequisites: string; overview: string; outcomes: string[];
  methods?: string[];
  items: { moduleTitle: string; topics: string; day?: number; duration?: string; methodology?: string }[];
  dayTitles?: string[];
  agenda?: { time: string; text: string; isDay?: boolean }[];
  difficulty?: string; evaluation?: string[]; bloomLevel?: number; nextTraining?: string[]; designedBy?: string;
}

export interface ProfileSubmission extends TrainerExtras {
  // IC / passport number (2026-10-20): typed by the trainer, but the server moves it to trainer_link_private/{token}
  // (Admin and Management only) and keeps just icSent: true in the submission everyone on the team can read.
  icNumber?: string;
  icSent?: boolean;
  name: string; contact: string; email: string; bio: string; experienceYears: number;
  qualifications: string; pastClients: string; programmeIds: string[]; suggestedTopics: string; rate: number;
}

export interface TrainerLink {
  id: string; token: string; kind: LinkKind; status: LinkStatus;
  createdAt: number; expiresAt: number; requestedById: string; requestedByName: string;
  outlineId?: string; proposalId?: string; programmeId?: string; trainerId?: string; trainerName?: string; title?: string;
  applied?: boolean;   // what the trainer sent went straight into the outline or proposal (2026-10-26)
  keptForReview?: boolean;   // an old submission left for Accept: its outline was already sent to a client
  submission?: OutlineSubmission | ProfileSubmission; submittedAt?: number;
  decidedById?: string; decidedByName?: string; decidedAt?: number;
}

// A long random code nobody can guess (32 hex characters).
export function newToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export const linkPath = (token: string) => `/t/${token}`;
export const isExpired = (l: { expiresAt?: number }, now = Date.now()) => !!l.expiresAt && now > l.expiresAt;
export const isLive = (l: TrainerLink, now = Date.now()) => (l.status === 'open' || l.status === 'submitted') && !isExpired(l, now);
/** An outline link from before 2026-10-26 still working the old way: an invite with no outline, or a submission
 *  waiting for Accept. The server switches it to the one-record way (serverTrainerLinks.ts upgradeOldOutlineLink). */
export const isOldOutlineLink = (l: TrainerLink, now = Date.now()) => l.kind === 'outline' && isLive(l, now)
  && (!l.outlineId || (l.status === 'submitted' && !l.applied && !l.keptForReview && !!l.submission));

// ---------- Cleaning what a trainer sends (the server uses these; nothing else is stored) ----------
const str = (v: any, max: number) => String(v ?? '').replace(/\u0000/g, '').trim().slice(0, max);
const num = (v: any, min: number, max: number) => {
  const n = Number(String(v ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : 0;
};
const list = (v: any, each: number, most: number) =>
  (Array.isArray(v) ? v : String(v ?? '').split('\n')).map((x: any) => str(x, each)).filter(Boolean).slice(0, most);
const LEVELS = ['Beginner', 'Intermediate', 'Advanced'];

export function cleanOutline(d: any): OutlineSubmission {
  const durationDays = Math.round(num(d?.durationDays, 0, 60) * 2) / 2;   // half days, like the editor
  const dayCount = Math.max(1, Math.ceil(durationDays));
  const items = (Array.isArray(d?.items) ? d.items : []).slice(0, 40)
    .map((m: any) => {
      const day = Math.round(num(m?.day, 0, dayCount));
      const duration = str(m?.duration, 60), methodology = str(m?.methodology, 200);
      return {
        moduleTitle: str(m?.moduleTitle, 200), topics: str(m?.topics, 2000),
        ...(dayCount > 1 && day >= 1 ? { day } : {}),
        // Older submissions had these; kept, no longer asked for.
        ...(duration ? { duration } : {}), ...(methodology ? { methodology } : {}),
      };
    })
    .filter((m: any) => m.moduleTitle || m.topics);
  const agenda = (Array.isArray(d?.agenda) ? d.agenda : []).slice(0, 80)
    .map((r: any) => (r?.isDay ? { time: '', text: str(r?.text, 300), isDay: true } : { time: str(r?.time, 60), text: str(r?.text, 300) }))
    .filter((r: any) => r.time || r.text);
  const out: OutlineSubmission = {
    courseTitle: str(d?.courseTitle, 200),
    durationDays, totalHours: num(d?.totalHours, 0, 500),
    audience: str(d?.audience, 1500), prerequisites: str(d?.prerequisites, 1000), overview: str(d?.overview, 4000),
    outcomes: list(d?.outcomes, 300, 20), methods: list(d?.methods, 200, 20), items,
    dayTitles: dayCount > 1 ? Array.from({ length: dayCount }, (_, k) => str(Array.isArray(d?.dayTitles) ? d.dayTitles[k] : '', 200)) : [],
    agenda,
    difficulty: LEVELS.includes(d?.difficulty) ? d.difficulty : '',
    evaluation: list(d?.evaluation, 200, 20), bloomLevel: Math.round(num(d?.bloomLevel, 0, 6)),
    nextTraining: list(d?.nextTraining, 200, 20), designedBy: str(d?.designedBy, 120),
  };
  if (LEVELS.includes(d?.level) && !out.difficulty) out.level = d.level;
  return out;
}

export function outlineProblem(s: OutlineSubmission): string {
  if (!s.items.length) return 'Add at least one module.';
  if (s.items.some(m => !m.moduleTitle)) return 'Every module needs a title.';
  return '';
}

// What a submission fills in on an outline (accepted into an outline, or as a new one).
let seq = 0;
const uid = (p: string) => `${p}_${Date.now()}_${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
export function outlineFieldsFrom(s: OutlineSubmission): Partial<CourseOutline> {
  return {
    durationDays: s.durationDays, totalHours: s.totalHours, audience: s.audience, prerequisites: s.prerequisites,
    overview: s.overview, outcomes: s.outcomes || [], methods: s.methods || [],
    items: (s.items || []).map((m, i) => ({
      id: uid('m'), no: i + 1, moduleTitle: m.moduleTitle, topics: m.topics, duration: m.duration || '', methodology: m.methodology || '',
      ...(m.day ? { day: m.day } : {}),
    })),
    dayTitles: s.dayTitles || [],
    agenda: (s.agenda || []).map(r => ({ id: uid('a'), time: r.time, text: r.text, ...(r.isDay ? { isDay: true } : {}) })),
    difficulty: s.difficulty || '', evaluation: s.evaluation || [], bloomLevel: s.bloomLevel || 0,
    nextTraining: s.nextTraining || [], designedBy: s.designedBy || '',
    ...(s.level ? { level: s.level } : {}),
  };
}

// The outline as it prints, from a submission: the trainer's Preview, and the team's before accepting.
export function previewOutline(s: OutlineSubmission, title: string, forCompany = 'NEXT Academy client'): CourseOutline {
  return {
    id: 'preview', refNumber: '', date: new Date().toISOString().slice(0, 10),
    courseTitle: s.courseTitle || title || '', category: '', level: 'Beginner', kind: 'training', preparedForCompany: forCompany,
    ...outlineFieldsFrom(s),
  } as CourseOutline;
}

export function outlineSummary(s: OutlineSubmission): string {
  const d = s.durationDays;
  return [
    d ? (d === 0.5 ? 'Half a day' : `${d} day${d === 1 ? '' : 's'}`) : '',
    s.totalHours ? `${s.totalHours} hours` : '',
    `${s.items.length} module${s.items.length === 1 ? '' : 's'}`,
  ].filter(Boolean).join(' · ');
}

// `token`: the link's own token; files must be in that link's upload folder (trainer_uploads/<token>/).
// The trainer portal passes its own folder instead (`prefixes`, trainer_portal/<trainerId>/).
export function cleanProfile(d: any, programmeIds: string[], token: string, prefixes = [`trainer_uploads/${token}/`]): ProfileSubmission {
  return {
    ...cleanExtras(d, prefixes),
    icNumber: cleanIc(d?.icNumber), icSent: !!d?.icSent,
    name: str(d?.name, 100), contact: str(d?.contact, 40), email: str(d?.email, 120),
    bio: str(d?.bio, 3000), experienceYears: num(d?.experienceYears, 0, 80),
    qualifications: str(d?.qualifications, 1500), pastClients: str(d?.pastClients, 1500),
    programmeIds: (Array.isArray(d?.programmeIds) ? d.programmeIds : []).map((x: any) => String(x)).filter((x: string) => programmeIds.includes(x)).slice(0, 100),
    suggestedTopics: str(d?.suggestedTopics, 3000), rate: num(d?.rate, 0, 100000),
  };
}

// Nothing is compulsory (Joel, 2026-10-20); only a mistyped email is pointed out.
export function profileProblem(s: ProfileSubmission): string {
  if (s.email && !/^\S+@\S+\.\S+$/.test(s.email)) return "That email address doesn't look right.";
  return '';
}

// WhatsApp message with the link (to the trainer's number when known).
export function whatsappShare(url: string, text: string, phone?: string): string {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.startsWith('0')) d = '6' + d;
  const msg = encodeURIComponent(`${text}\n${url}`);
  return d.length >= 9 ? `https://wa.me/${d}?text=${msg}` : `https://wa.me/?text=${msg}`;
}
