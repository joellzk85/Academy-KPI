// What the public website shows from the CRM (Batch 2, Joel 2026-10-30; docs/features/website.md). Nothing is typed
// twice: the calendar comes from Public programmes runs, programme pages from titles (and the course outline Admin
// picks), trainer pages from the Trainers list. Only titles and trainers Admin or Management tick "Show on the
// website" appear. Only public fields leave the CRM: never client names, deal values, phone, email, IC, rates or
// past clients. Pure, so the server (serverWebsite.ts) and the editor's preview use the same code.
import { PublicProgramme, runEnd, runSeats } from './publicProgrammes';
import { lines } from './outlineContent';
import { clientTitle, programmeStatus } from './programmes';
import { slugify } from './website';

/** On a title (programmes/{id}.website), set in the title's details by Admin or Management. */
export type TitleWebsite = { show?: boolean; name?: string; summary?: string; outlineId?: string };
/** On a trainer (trainers_directory/{id}.website): shown only with the trainer's OK (their personal data). */
export type TrainerWebsite = { show?: boolean; headline?: string; agreed?: boolean };

export type WebRun = {
  id: string;
  title: string;
  titleSlug: string;          // the programme page, '' when the title isn't on the website
  date: string;               // YYYY-MM-DD
  end: string;
  days: number;
  venue: string;
  area: string;
  price: number;              // list price per pax, RM (0 = not given)
  seatsLeft: number | null;   // null = no seat limit
  hrdc: boolean;
  type: WebType;
};
export type WebType = 'soft' | 'technical' | 'teambuilding';
export type WebModule = { title: string; topics: string[] };
export type WebProgramme = {
  id: string;
  slug: string;
  name: string;
  type: WebType;
  category: string;
  hrdc: boolean;
  days: number;
  summary: string;
  overview: string;
  outcomes: string[];
  audience: string[];
  modules: WebModule[];
  methods: string[];
  trainerSlugs: string[];
};
export type WebTrainer = {
  id: string;
  slug: string;
  name: string;
  photo: string;
  headline: string;
  bio: string;
  years: number;
  qualifications: string[];
  certifications: string[];
  languages: string;
  programmeSlugs: string[];
};
export type SiteData = { runs: WebRun[]; programmes: WebProgramme[]; trainers: WebTrainer[] };
export const EMPTY_SITE_DATA: SiteData = { runs: [], programmes: [], trainers: [] };

export const WEB_TYPE_LABELS: Record<WebType, string> = { soft: 'Soft skills', teambuilding: 'Team building', technical: 'Technical skills' };

/** Today in Malaysia (the server runs on UTC). */
export const todayMY = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

// Titles are kept in capitals in the CRM; the website shows them in normal case unless a website name is typed.
const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'the', 'to', 'with', 'vs']);
const ACRONYMS = new Set(['HR', 'HRD', 'HRDC', 'KPI', 'KPIS', 'OKR', 'OKRS', 'TNA', 'DISC', 'AI', 'ESG', 'TTT', 'OSHA', 'SOP', 'SOPS', 'CEO', 'IT', 'PR', 'MS', 'SST', 'CSR', 'UX', 'UI', 'ISO', 'QA', 'QC', 'B2B', 'B2C', 'TB', 'NLP', 'MBTI', 'ROI', 'GST', 'FMCG', 'HSE', 'PPE', 'EQ', 'IQ', 'SME', 'SMES', 'GEN', 'Z']);
export function niceTitle(name: string): string {
  const s = clientTitle(name).trim();
  if (s !== s.toUpperCase()) return s;   // already typed in mixed case
  return s.split(/(\s+|-|\/|:)/).map((w, i) => {
    if (!/[A-Z]/.test(w)) return w;
    const core = w.replace(/[^A-Z0-9&]/g, '');
    if (ACRONYMS.has(core) || /\d/.test(core)) return w;
    const lower = w.toLowerCase();
    if (i > 0 && SMALL.has(lower)) return lower;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join('').replace(/^./, c => c.toUpperCase());
}

const uniqueSlugs = <T extends { slug: string }>(list: T[]) => {
  const seen = new Set<string>();
  for (const x of list) {
    let s = x.slug || 'page', n = 2;
    while (seen.has(s)) s = `${x.slug}-${n++}`;
    seen.add(s);
    x.slug = s;
  }
  return list;
};

function typeOf(p: any): WebType {
  if (p?.skillType === 'technical' || p?.skillType === 'teambuilding' || p?.skillType === 'soft') return p.skillType;
  return /\(TB\)\s*$/i.test(String(p?.name || '')) ? 'teambuilding' : 'soft';
}

/** Builds everything the website shows. `deals` only needs the deals of these runs (for seats). */
export function buildSiteData(input: {
  runs: PublicProgramme[];
  deals: any[];
  programmes: any[];        // every title (runs need their HRDC status and page)
  trainers: any[];          // trainers ticked for the website
  outlines: any[];          // the outlines picked on ticked titles
  venues: any[];            // the runs' venues
  today?: string;
}): SiteData {
  const today = input.today || todayMY();
  const outlineById = new Map(input.outlines.map(o => [o.id, o]));
  const shown = input.programmes.filter(p => p?.website?.show);

  const programmes: WebProgramme[] = uniqueSlugs(shown.map(p => {
    const w: TitleWebsite = p.website || {};
    const o = w.outlineId ? outlineById.get(w.outlineId) : undefined;
    const usable = o && !o.deleted && !o.isHidden;
    const name = (w.name || '').trim() || niceTitle(p.name);
    return {
      id: p.id,
      slug: slugify(name),
      name,
      type: typeOf(p),
      category: String(p.category || ''),
      hrdc: programmeStatus(p) === 'approved',
      days: Number(usable ? o.durationDays : 0) || Number(p.days) || 0,
      summary: String(w.summary || '').trim(),
      overview: usable ? String(o.overview || '').trim() : '',
      outcomes: usable ? lines(o.outcomes) : [],
      audience: usable ? lines(o.audience) : [],
      modules: usable ? (o.items || []).map((it: any) => ({ title: String(it.moduleTitle || '').trim(), topics: lines(it.topics) })).filter((m: WebModule) => m.title || m.topics.length) : [],
      methods: usable ? lines(o.methods) : [],
      trainerSlugs: [],
    };
  })).sort((a, b) => a.name.localeCompare(b.name));
  const progById = new Map(programmes.map(p => [p.id, p]));

  const trainers: WebTrainer[] = uniqueSlugs(input.trainers.filter(t => t?.website?.show && t?.website?.agreed).map(t => {
    const w: TrainerWebsite = t.website || {};
    const certs = (Array.isArray(t.professional) ? t.professional : [])
      .map((c: any) => [c?.certification, c?.body].map(x => String(x || '').trim()).filter(Boolean).join(', ')).filter(Boolean);
    const academic = (Array.isArray(t.academic) ? t.academic : [])
      .map((c: any) => [c?.qualification, c?.institute].map(x => String(x || '').trim()).filter(Boolean).join(', ')).filter(Boolean);
    const langs = [...(Array.isArray(t.languages) ? t.languages : []), String(t.languagesOther || '').trim()].filter(Boolean).join(', ');
    return {
      id: t.id,
      slug: slugify(String(t.name || 'trainer')),
      name: String(t.name || '').trim(),
      photo: String(t.photoUrl || ''),
      headline: String(w.headline || '').trim(),
      bio: String(t.bio || '').trim(),
      years: Number(t.experienceYears) || 0,
      qualifications: [...lines(t.qualifications), ...academic],
      certifications: certs,
      languages: langs,
      programmeSlugs: (t.programmeIds || []).map((id: string) => progById.get(id)?.slug).filter(Boolean),
    };
  })).sort((a, b) => a.name.localeCompare(b.name));
  for (const t of input.trainers) {
    const wt = trainers.find(x => x.id === t.id);
    if (!wt) continue;
    for (const id of t.programmeIds || []) progById.get(id)?.trainerSlugs.push(wt.slug);
  }

  const venueById = new Map(input.venues.map(v => [v.id, v]));
  const titleById = new Map(input.programmes.map(p => [p.id, p]));
  const runs: WebRun[] = input.runs
    .filter(r => r && r.status !== 'cancelled' && /^\d{4}-\d{2}-\d{2}/.test(r.trainingDate || '') && r.trainingDate.slice(0, 10) >= today)
    .map(r => {
      const p = titleById.get(r.programmeId);
      const v = venueById.get(r.venueId);
      const seats = runSeats(r, input.deals);
      const wp = progById.get(r.programmeId);
      return {
        id: r.id,
        title: wp?.name || niceTitle(r.title || p?.name || ''),
        titleSlug: wp?.slug || '',
        date: r.trainingDate.slice(0, 10),
        end: runEnd(r),
        days: Number(r.trainingDays) || 0,
        venue: String(r.venueName || v?.name || '').trim(),
        area: String(v?.region || v?.state || '').trim(),
        price: Number(r.pricePerPax) || 0,
        seatsLeft: seats.left,
        hrdc: programmeStatus(p) === 'approved',
        type: p ? typeOf(p) : (r.type === 'Teambuilding' ? 'teambuilding' : 'soft'),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  return { runs, programmes, trainers };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "12 Nov 2026" or "12 – 13 Nov 2026" or "30 Nov – 1 Dec 2026". */
export function runDates(r: Pick<WebRun, 'date' | 'end'>): string {
  const [y1, m1, d1] = r.date.split('-').map(Number);
  const [y2, m2, d2] = (r.end || r.date).split('-').map(Number);
  if (r.end === r.date || !r.end) return `${d1} ${MONTHS[m1 - 1]} ${y1}`;
  if (y1 === y2 && m1 === m2) return `${d1} – ${d2} ${MONTHS[m1 - 1]} ${y1}`;
  if (y1 === y2) return `${d1} ${MONTHS[m1 - 1]} – ${d2} ${MONTHS[m2 - 1]} ${y1}`;
  return `${d1} ${MONTHS[m1 - 1]} ${y1} – ${d2} ${MONTHS[m2 - 1]} ${y2}`;
}
export const runDay = (r: WebRun) => String(Number(r.date.slice(8, 10)));
export const runMonth = (r: WebRun) => MONTHS[Number(r.date.slice(5, 7)) - 1];
export const daysText = (n: number) => !n ? '' : n === 0.5 ? 'Half day' : `${n} day${n === 1 ? '' : 's'}`;
export const seatsText = (r: WebRun) => r.seatsLeft === null ? '' : r.seatsLeft <= 0 ? 'Full' : `${r.seatsLeft} seat${r.seatsLeft === 1 ? '' : 's'} left`;
