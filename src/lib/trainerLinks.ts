// Trainer links (Joel, 2026-10-17): a private link a trainer opens without logging in, to fill in
// either a course outline or their own profile. What they submit waits in the CRM until the team
// reviews it and clicks Accept. Shared by the server (serverTrainerLinks.ts), the public page
// (TrainerLinkPage.tsx) and the CRM screens. Pure, so it can be tested.
//
// trainer_links/{token}: { kind, token, status, createdAt, expiresAt, requestedById, requestedByName,
//   outlineId?, trainerId?, trainerName?, title?, submission?, submittedAt?, decidedById?, decidedByName?, decidedAt? }

export type LinkKind = 'outline' | 'profile';
export type LinkStatus = 'open' | 'submitted' | 'accepted' | 'cancelled';
export const LINK_DAYS = 14;

export interface OutlineSubmission {
  durationDays: number; totalHours: number; level: 'Beginner' | 'Intermediate' | 'Advanced';
  audience: string; prerequisites: string; overview: string; outcomes: string[];
  items: { moduleTitle: string; duration: string; methodology: string; topics: string }[];
}

export interface ProfileSubmission {
  name: string; contact: string; email: string; bio: string; experienceYears: number;
  qualifications: string; pastClients: string; programmeIds: string[]; suggestedTopics: string; rate: number;
}

export interface TrainerLink {
  id: string; token: string; kind: LinkKind; status: LinkStatus;
  createdAt: number; expiresAt: number; requestedById: string; requestedByName: string;
  outlineId?: string; trainerId?: string; trainerName?: string; title?: string;
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

// ---------- Cleaning what a trainer sends (the server uses these; nothing else is stored) ----------
const str = (v: any, max: number) => String(v ?? '').replace(/\u0000/g, '').trim().slice(0, max);
const num = (v: any, min: number, max: number) => {
  const n = Number(String(v ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : 0;
};
const LEVELS = ['Beginner', 'Intermediate', 'Advanced'] as const;

export function cleanOutline(d: any): OutlineSubmission {
  const items = (Array.isArray(d?.items) ? d.items : []).slice(0, 40)
    .map((m: any) => ({ moduleTitle: str(m?.moduleTitle, 200), duration: str(m?.duration, 60), methodology: str(m?.methodology, 200), topics: str(m?.topics, 2000) }))
    .filter((m: any) => m.moduleTitle || m.topics);
  const outcomes = (Array.isArray(d?.outcomes) ? d.outcomes : String(d?.outcomes ?? '').split('\n'))
    .map((x: any) => str(x, 300)).filter(Boolean).slice(0, 20);
  return {
    durationDays: num(d?.durationDays, 0, 60), totalHours: num(d?.totalHours, 0, 500),
    level: (LEVELS as readonly string[]).includes(d?.level) ? d.level : 'Beginner',
    audience: str(d?.audience, 500), prerequisites: str(d?.prerequisites, 500), overview: str(d?.overview, 4000), outcomes, items,
  };
}

export function outlineProblem(s: OutlineSubmission): string {
  if (!s.items.length) return 'Add at least one module.';
  if (s.items.some(m => !m.moduleTitle)) return 'Every module needs a title.';
  return '';
}

export function cleanProfile(d: any, programmeIds: string[]): ProfileSubmission {
  return {
    name: str(d?.name, 100), contact: str(d?.contact, 40), email: str(d?.email, 120),
    bio: str(d?.bio, 3000), experienceYears: num(d?.experienceYears, 0, 80),
    qualifications: str(d?.qualifications, 1500), pastClients: str(d?.pastClients, 1500),
    programmeIds: (Array.isArray(d?.programmeIds) ? d.programmeIds : []).map((x: any) => String(x)).filter((x: string) => programmeIds.includes(x)).slice(0, 100),
    suggestedTopics: str(d?.suggestedTopics, 1000), rate: num(d?.rate, 0, 100000),
  };
}

export function profileProblem(s: ProfileSubmission): string {
  if (!s.name) return 'Enter your name.';
  if (!s.contact && !s.email) return 'Enter a phone number or email so we can reach you.';
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
