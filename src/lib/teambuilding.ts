// Teambuilding proposals (Joel, 2026-10-19; push A1). A proposal for a team-building event, shown as a
// custom website (TeambuildingSite.tsx), not as A4 pages. It is a separate list from course outlines
// (teambuilding_proposals/{id}), so course outlines are not affected in any way.
// Pure logic only (no database code), so it can be tested and later shared with the server (push B).
//
// One source of truth:
//   client company, attention person   <- the deal's client (client list)
//   training date, group size, funding <- the deal (group size can be changed on the proposal; it changes the price)
//   trainer name and photo             <- the trainer list (the bio can be tailored per proposal)
//   venue name and photos              <- the venue list (distance and travel time are typed per proposal)
//   activities                         <- copied from the Activity library, then tailored per proposal
//   packages                           <- start from the Package template (tb_settings/package_template)
// "Mark as sent" (or Email / WhatsApp) writes the resolved text into the proposal and locks it; "Revise" unlocks it.

import { dealOwnerId } from './deals';
import { nextDocRef } from './docRefs';
import { DEFAULT_OUTLINE_TERMS } from './outlineContent';
import type { QuoteSendEntry } from '../types';

// ---------- Sections ----------
export type TbSectionKey = 'objectives' | 'trainers' | 'agenda' | 'activities' | 'venues' | 'packages' | 'takeaways' | 'hrdc' | 'terms';
export interface TbSection { key: TbSectionKey; title: string; hidden?: boolean }

export const SECTION_DEFAULTS: TbSection[] = [
  { key: 'objectives', title: 'Teambuilding objectives' },
  { key: 'trainers', title: 'Our trainers' },
  { key: 'agenda', title: 'Agenda' },
  { key: 'activities', title: 'Featured activities' },
  { key: 'venues', title: 'Recommended venues' },
  { key: 'packages', title: "What's included in our packages" },
  { key: 'takeaways', title: 'Key takeaways and next steps' },
  { key: 'hrdc', title: 'HRD Corp claimable' },
  { key: 'terms', title: 'Terms and conditions' },
];
export const SECTION_HINTS: Record<TbSectionKey, string> = {
  objectives: 'What the event sets out to achieve',
  trainers: 'Who leads it (from the trainer list)',
  agenda: 'Day by day, time by time',
  activities: 'From the Activity library, tailored for this client',
  venues: 'Options from the venue list',
  packages: 'Package comparison and price by group size',
  takeaways: 'What they leave with, and what happens next',
  hrdc: 'Shown only on HRDC deals',
  terms: 'The same standard terms as course outlines',
};

// Saved sections in their order, with any built-in section that's missing added at the end.
export function sectionsOf(p: { sections?: TbSection[] }): TbSection[] {
  const saved = (p.sections || []).filter(s => SECTION_DEFAULTS.some(d => d.key === s.key));
  const missing = SECTION_DEFAULTS.filter(d => !saved.some(s => s.key === d.key));
  return [...saved, ...missing].map(s => ({ ...s, title: s.title ?? SECTION_DEFAULTS.find(d => d.key === s.key)!.title }));
}

// ---------- Content ----------
export interface TbPoint { id: string; title: string; text: string }
export type AgendaTag = '' | 'indoor' | 'outdoor' | 'dining' | 'both';
export const AGENDA_TAGS: { key: AgendaTag; label: string }[] = [
  { key: '', label: 'No tag' }, { key: 'indoor', label: 'Indoor' }, { key: 'outdoor', label: 'Outdoor' },
  { key: 'both', label: 'Indoor / Outdoor' }, { key: 'dining', label: 'Dining' },
];
export interface TbAgendaRow { id: string; time: string; text: string; tag?: AgendaTag }
export interface TbAgendaDay { id: string; title: string; rows: TbAgendaRow[] }

export interface TbTrainer {
  id: string;
  trainerId?: string;          // trainer list: name and photo read live
  name?: string;               // typed (no trainer picked), or the locked copy once sent
  photo?: string;
  role?: string;               // e.g. "Accredited HRDC Trainer"
  bio?: string;                // undefined = the trainer's bio from the trainer list; typed = tailored for this proposal
}

export type RatingKey = 'collaboration' | 'creativity' | 'problemSolving' | 'intensity' | 'difficulty';
export const RATINGS: { key: RatingKey; label: string }[] = [
  { key: 'collaboration', label: 'Collaboration' },
  { key: 'creativity', label: 'Creativity' },
  { key: 'problemSolving', label: 'Problem solving' },
  { key: 'intensity', label: 'Intensity' },
  { key: 'difficulty', label: 'Difficulty' },
];
export const LOCATIONS = ['Indoor', 'Outdoor', 'Indoor or outdoor'];

// What an activity holds, in the library and (copied, then tailored) on a proposal.
export interface TbActivityContent {
  name: string;
  summary: string;             // one or two lines under the name
  photos: string[];            // links (Firebase Storage download links)
  duration: string;            // "75 - 90 minutes"
  location: string;            // Indoor / Outdoor / Indoor or outdoor
  format: string;              // "Rotational challenge, 4 stations"
  groupSize: string;           // "10-12 per group"
  minPax?: number;
  maxPax?: number;
  objectives: string[];        // learning objectives
  howPlayed: string;           // how it's played (paragraphs; "- " lines are bullets)
  takeaways: string[];         // learning takeaways
  materials: string[];
  deliverables: string;        // expected deliverables (paragraphs; "- " lines are bullets)
  ratings: Partial<Record<RatingKey, number>>;   // 0-100
}
// Management approval of new activities (Joel, 2026-10-22: "Design new activity" KPI counts only approved ones).
// New activities start pending; any Management person except the one who added it approves or says "Not approved"
// (with a note). The creator's next save of a not-approved activity sends it back for approval. Activities from
// before approvals have no `approval` and stay as they are (not counted).
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export interface ActivityApproval { status: ApprovalStatus; at?: string; byId?: string; byName?: string; note?: string }
export const PENDING_APPROVAL: ActivityApproval = { status: 'pending' };
export const APPROVAL_LABELS: Record<ApprovalStatus, string> = { pending: 'Waiting for approval', approved: 'Approved', rejected: 'Not approved' };
export const canApproveActivity = (a: { createdById?: string; approval?: ActivityApproval | null }, viewer: { id: string; role: string }) =>
  viewer.role === 'management' && !!a.approval && a.createdById !== viewer.id;

export interface TbActivity extends TbActivityContent {
  id: string;
  approval?: ActivityApproval | null;
  archived?: boolean;
  createdAt?: string; createdById?: string; createdByName?: string;
  updatedAt?: string; updatedById?: string; updatedByName?: string;
}
export interface TbProposalActivity extends TbActivityContent { id: string; libraryId?: string }

export interface TbVenueOption {
  id: string;
  venueId?: string;            // venue list: name and photos read live
  name?: string;               // typed (not in the list), or the locked copy once sent
  photos?: string[];
  stay: string;                // "2 Days 1 Night"
  distance: string;            // "Travel distance from HQ: 102 km"
  travelTime: string;          // "~1 hr 30 mins"
  notes: string;
}

// ---------- Packages and price bands ----------
// Columns are the packages (Champion, Leader, Learner), rows are the items. A cell holds what the package
// gives for that item ("Yes", "2", "Medals for 3 winning teams", "-"). Price bands set the price of each
// package by group size, and can change some cells (e.g. more facilitators for a bigger group).
export interface TbPackageRow { id: string; label: string }
export interface TbPackageCol { id: string; name: string; highlight?: boolean }
export interface TbPriceBand {
  id: string;
  min: number;                 // pax, inclusive
  max: number;                 // pax, inclusive
  prices: Record<string, number>;   // column id -> RM for the whole group
  cells?: Record<string, string>;   // `${rowId}|${colId}` -> what changes in this band
}
export interface TbPackages {
  rows: TbPackageRow[];
  cols: TbPackageCol[];
  cells: Record<string, string>;    // `${rowId}|${colId}`
  bands: TbPriceBand[];
  note?: string;               // shown under the table, e.g. "Prices exclude SST"
}
export const cellKey = (rowId: string, colId: string) => `${rowId}|${colId}`;

// Joel's Texas Chicken package table (for 30 pax), used until the team saves its own template.
export function defaultPackages(): TbPackages {
  const rows: [string, string, string, string][] = [
    ['Trainer', '2', '2', '1'],
    ['Facilitators', '4', '3', '2'],
    ['Activities equipment and materials', 'Yes', 'Yes', 'Yes'],
    ['E-certificate of participation', 'Yes', 'Yes', 'Yes'],
    ['Photography', 'Yes', 'Yes', 'Yes'],
    ['Videography and drone', 'Videography and drone (depends on location)', 'Videography', '-'],
    ['Medals / prizes for winners', 'Medals and plaque for 3 winning teams', 'Medals for 3 winning teams', 'Medals for 1 winning team'],
    ['Door gifts', 'Door gifts', 'Door gifts', '-'],
    ['Team building T-shirts', '1 pc for each participant', '1 pc for each participant', '-'],
    ['Banner', 'Yes', 'Yes', 'Yes'],
  ];
  const cols: TbPackageCol[] = [
    { id: 'c1', name: 'Champion', highlight: true },
    { id: 'c2', name: 'Leader' },
    { id: 'c3', name: 'Learner' },
  ];
  const cells: Record<string, string> = {};
  const rowList = rows.map(([label, a, b, c], i) => {
    const id = `r${i + 1}`;
    cells[cellKey(id, 'c1')] = a; cells[cellKey(id, 'c2')] = b; cells[cellKey(id, 'c3')] = c;
    return { id, label };
  });
  return {
    rows: rowList, cols, cells,
    bands: [{ id: 'b1', min: 20, max: 30, prices: { c1: 21000, c2: 16000, c3: 14000 } }],
    note: 'Professional fee for the whole group. Venue, meals and transport are quoted separately.',
  };
}

export interface PriceResult {
  band: TbPriceBand | null;
  price: number | null;        // null = above the largest band ("Contact us")
  perPax: number | null;
  belowMin: boolean;           // fewer than the smallest band: the smallest band's price applies
  minPax: number;
  maxPax: number;
}

export function sortedBands(pk: TbPackages): TbPriceBand[] {
  return [...(pk.bands || [])].filter(b => b.max >= b.min).sort((a, b) => a.min - b.min);
}

// The price of one package for a group size.
export function priceFor(pk: TbPackages, colId: string, pax: number): PriceResult {
  const bands = sortedBands(pk);
  const minPax = bands[0]?.min || 0;
  const maxPax = bands.length ? Math.max(...bands.map(b => b.max)) : 0;
  const n = Math.max(0, Math.round(pax || 0));
  if (!bands.length) return { band: null, price: null, perPax: null, belowMin: false, minPax, maxPax };
  let band = bands.find(b => n >= b.min && n <= b.max) || null;
  const belowMin = n < minPax;
  if (!band && belowMin) band = bands[0];
  // In a gap between two bands: the next band up.
  if (!band && n <= maxPax) band = bands.find(b => b.min > n) || null;
  if (!band) return { band: null, price: null, perPax: null, belowMin: false, minPax, maxPax };
  const price = Number(band.prices?.[colId]) || 0;
  const people = Math.max(n, band.min);
  return { band, price: price || null, perPax: price && people ? Math.round(price / people) : null, belowMin, minPax, maxPax };
}

// What a package gives for an item at this group size (a band's own value wins).
export function cellFor(pk: TbPackages, rowId: string, colId: string, band: TbPriceBand | null): string {
  const k = cellKey(rowId, colId);
  const own = band?.cells?.[k];
  return own !== undefined && own !== '' ? own : (pk.cells || {})[k] || '';
}

// Problems with the bands, shown in the editor.
export function bandProblems(pk: TbPackages): string[] {
  const out: string[] = [];
  const bands = sortedBands(pk);
  if (!(pk.bands || []).length) out.push('Add at least one price band.');
  (pk.bands || []).forEach(b => { if (b.max < b.min) out.push(`A band runs from ${b.min} to ${b.max} pax: the second number must be bigger.`); });
  for (let i = 1; i < bands.length; i++) {
    if (bands[i].min <= bands[i - 1].max) out.push(`The bands ${bands[i - 1].min}-${bands[i - 1].max} and ${bands[i].min}-${bands[i].max} pax overlap.`);
  }
  return out;
}

// ---------- The proposal ----------
export interface TbProposal {
  id: string;
  kind: 'teambuilding';
  refNumber: string;
  refAuto?: boolean;       // numbered by the CRM (lib/docRefs.ts): the client's code is put in while it's a draft
  date: string;
  title: string;
  subtitle: string;
  coverPhoto?: string;
  stay?: string;               // "2 Days 1 Night", shown under the title
  eventDate?: string;          // typed; else the deal's training date
  pax?: number;                // group size; 0/undefined = the deal's participants
  sections?: TbSection[];
  objectives: TbPoint[];
  trainers: TbTrainer[];
  agenda: TbAgendaDay[];
  activities: TbProposalActivity[];
  venues: TbVenueOption[];
  packages: TbPackages;
  chosenPackage?: string;      // column id shown first (optional)
  takeaways: TbPoint[];
  hrdcNote?: string;           // undefined = the standard note
  terms?: string;              // undefined = the standard terms
  // Who and where
  creatorId: string;
  ownerId: string;
  ownerName?: string;
  preparedBy: string;
  clientId?: string;
  pipelineId?: string;
  preparedForCompany?: string; // typed for a general proposal; the client's name once locked
  attn?: string;
  status?: 'draft' | 'sent';
  sentAt?: string; sentById?: string; sentByName?: string;
  sendLog?: QuoteSendEntry[];
  sharedWithIds?: string[];
  sharedLog?: Record<string, { at: string; byId: string; byName: string }>;
  isHidden?: boolean;
  dealDeleted?: boolean;
  updatedAt?: string;
  fromTrainerDocId?: string;       // made from a trainer's own proposal in the portal (trainer_docs, lib/trainerDocs.ts)
  fromTrainerDocVersion?: number;  // which version of it we have
  writerTrainerId?: string;        // written by a trainer (2026-10-26): see CourseOutline and lib/trainerDocs.ts
  writerTrainerName?: string;
  trainerEditedAt?: number;
  writerRemoved?: boolean;
  programmeId?: string;            // its title from the list (the deal's when made for a deal)
  fromOutlineId?: string;          // made with "Speed build proposal" from this course outline (2026-10-24, lib/outlineTb.ts)
  hideClientLogo?: boolean;        // the cover shows the client's logo (read live from clients/{id}.logoUrl) unless this is on
}

export const DEFAULT_HRDC_NOTE =
  'This programme is HRD Corp claimable. NEXT Academy is an HRD Corp registered training provider, so your company can claim the professional fee under the HRD Corp levy, subject to HRD Corp approval of the grant before the event.';

export const TB_TERMS_DEFAULT = DEFAULT_OUTLINE_TERMS;

const rid = (p: string) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
export const newTbId = rid;

export function blankActivity(): TbActivityContent {
  return { name: '', summary: '', photos: [], duration: '', location: 'Indoor', format: '', groupSize: '', objectives: [], howPlayed: '', takeaways: [], materials: [], deliverables: '', ratings: {} };
}

export function activityFromLibrary(a: TbActivity): TbProposalActivity {
  const { id, archived: _a, createdAt: _1, createdById: _2, createdByName: _3, updatedAt: _4, updatedById: _5, updatedByName: _6, ...content } = a;
  return JSON.parse(JSON.stringify({ ...blankActivity(), ...content, id: rid('pa'), libraryId: id }));
}

// A fresh proposal's content (Joel's Texas Chicken proposal as the starting shape).
export function blankProposalContent(packages: TbPackages | null): Omit<TbProposal, 'id' | 'refNumber' | 'date' | 'creatorId' | 'ownerId' | 'preparedBy'> {
  return {
    kind: 'teambuilding',
    title: '', subtitle: 'This itinerary outlines engaging activities designed for your team.', stay: '',
    sections: SECTION_DEFAULTS.map(s => ({ ...s })),
    objectives: [
      { id: rid('ob'), title: '', text: '' },
      { id: rid('ob'), title: '', text: '' },
      { id: rid('ob'), title: '', text: '' },
    ],
    trainers: [],
    agenda: [{ id: rid('day'), title: 'Day 1', rows: [{ id: rid('ar'), time: '', text: '', tag: '' }] }],
    activities: [],
    venues: [],
    packages: JSON.parse(JSON.stringify(packages || defaultPackages())),
    takeaways: [],
    status: 'draft', sharedWithIds: [], isHidden: false,
  };
}

// The content worth copying from an earlier proposal ("Start from").
export function copyContent(base: TbProposal): Partial<TbProposal> {
  const c = JSON.parse(JSON.stringify(base)) as TbProposal;
  return {
    kind: 'teambuilding', title: c.title, subtitle: c.subtitle, coverPhoto: c.coverPhoto, stay: c.stay, sections: c.sections,
    objectives: (c.objectives || []).map(x => ({ ...x, id: rid('ob') })),
    trainers: (c.trainers || []).map(x => ({ ...x, id: rid('tr') })),
    agenda: (c.agenda || []).map(d => ({ ...d, id: rid('day'), rows: (d.rows || []).map(r => ({ ...r, id: rid('ar') })) })),
    activities: (c.activities || []).map(a => ({ ...a, id: rid('pa') })),
    venues: (c.venues || []).map(v => ({ ...v, id: rid('vo') })),
    packages: c.packages || defaultPackages(),
    takeaways: (c.takeaways || []).map(x => ({ ...x, id: rid('tk') })),
    hrdcNote: c.hrdcNote, terms: c.terms,
  };
}

// HKL/NA/TB/YYYYMMDD/NN (2026-10-19): the client's code, then the next number for the day across all teambuilding
// proposals (older TB/ numbers count too). See lib/docRefs.ts.
export function nextTbRef(list: { refNumber?: string }[], dateIso: string, code = ''): string {
  return nextDocRef('teambuilding', list, dateIso, code);
}

export const tbSent = (p: { status?: string }) => p.status === 'sent';

export interface TbSources {
  clients: any[];
  deals: any[];
  trainers: any[];
  venues: any[];
  people: { id: string; name: string }[];
}

export interface ResolvedTb {
  p: TbProposal;               // with live details filled in (what the client sees)
  deal: any | null;
  client: any | null;
  ownerId: string;
  company: string;
  pax: number;
  eventDate: string;
  isHrdc: boolean;
  sections: TbSection[];       // in order, with the ones not shown left out
  clientLogo?: string;         // the client's logo for the cover ('' = none, or switched off on this proposal)
}

const isHrdcDeal = (deal: any) => ['hrdc', 'hrdc_topup'].includes(deal?.fundingType);

export function resolveTb(p: TbProposal, s: TbSources): ResolvedTb {
  const deal = p.pipelineId ? s.deals.find(d => d.id === p.pipelineId) || null : null;
  const clientId = deal?.clientId || p.clientId || '';
  const client = clientId ? s.clients.find(c => c.id === clientId) || null : null;
  const ownerId = (deal && dealOwnerId(deal)) || p.ownerId || p.creatorId || '';
  const locked = tbSent(p);
  const out: TbProposal = locked ? p : JSON.parse(JSON.stringify(p));
  if (!locked) {
    if (client) out.preparedForCompany = client.companyName || '';
    const owner = s.people.find(x => x.id === ownerId);
    if (owner) { out.ownerId = owner.id; out.ownerName = owner.name; }
    out.trainers = (p.trainers || []).map(t => {
      const tr = t.trainerId ? s.trainers.find(x => x.id === t.trainerId) : null;
      return tr ? { ...t, name: tr.name || t.name, photo: tr.photoUrl || t.photo || '', bio: t.bio !== undefined ? t.bio : tr.bio || '' } : t;
    });
    out.venues = (p.venues || []).map(v => {
      const vn = v.venueId ? s.venues.find(x => x.id === v.venueId) : null;
      return vn ? { ...v, name: vn.name || v.name, photos: venuePhotos(vn).length ? venuePhotos(vn) : v.photos || [] } : v;
    });
    if (out.hrdcNote === undefined) out.hrdcNote = DEFAULT_HRDC_NOTE;
    if (out.terms === undefined) out.terms = TB_TERMS_DEFAULT;
    out.eventDate = p.eventDate || deal?.trainingDate || '';
    out.pax = p.pax || Number(deal?.participants) || 0;
  }
  // A general proposal (no deal) shows the HRDC note unless it's switched off.
  const isHrdc = deal ? isHrdcDeal(deal) : true;
  const sections = sectionsOf(out).filter(x => !x.hidden && hasContent(out, x.key, isHrdc));
  return {
    p: out, deal, client, ownerId, company: out.preparedForCompany || '',
    pax: out.pax || 0, eventDate: out.eventDate || '', isHrdc, sections,
    // Always read live from the client record (never copied into the proposal), even after it's sent.
    clientLogo: p.hideClientLogo ? '' : String(client?.logoUrl || ''),
  };
}

// A section with nothing in it isn't shown on the website.
export function hasContent(p: TbProposal, key: TbSectionKey, isHrdc: boolean): boolean {
  switch (key) {
    case 'objectives': return (p.objectives || []).some(o => (o.title || o.text || '').trim());
    case 'trainers': return (p.trainers || []).some(t => (t.name || '').trim());
    case 'agenda': return (p.agenda || []).some(d => (d.rows || []).some(r => (r.text || '').trim()));
    case 'activities': return (p.activities || []).some(a => (a.name || '').trim());
    case 'venues': return (p.venues || []).some(v => (v.name || '').trim());
    case 'packages': return (p.packages?.cols || []).length > 0;
    case 'takeaways': return (p.takeaways || []).some(o => (o.title || o.text || '').trim());
    case 'hrdc': return isHrdc && !!(p.hrdcNote || '').trim();
    case 'terms': return !!(p.terms || '').trim();
  }
}

// Venue photos: the uploaded ones, else the old single picture link.
export function venuePhotos(v: any): string[] {
  const list = (Array.isArray(v?.photos) ? v.photos : []).filter((x: any) => typeof x === 'string' && x);
  if (list.length) return list;
  return /^https?:\/\//i.test(String(v?.pictures || '').trim()) ? [String(v.pictures).trim()] : [];
}

// When locking: the resolved copy, so it stays exactly as sent.
export function lockedCopy(r: ResolvedTb): TbProposal {
  return JSON.parse(JSON.stringify({ ...r.p, pax: r.pax, eventDate: r.eventDate }));
}

export const tbSummary = (p: TbProposal) => {
  const days = (p.agenda || []).filter(d => (d.rows || []).some(r => r.text.trim())).length;
  const acts = (p.activities || []).filter(a => a.name.trim()).length;
  return [days ? `${days} day${days === 1 ? '' : 's'}` : '', `${acts} activit${acts === 1 ? 'y' : 'ies'}`, p.pax ? `${p.pax} pax` : ''].filter(Boolean).join(' · ');
};

export const formatPrice = (n: number) => `RM ${(Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Lines of text to a list ("one per line").
export const lines = (v: string) => v.split('\n');
export const trimLines = (v?: string[]) => (v || []).map(x => x.trim()).filter(Boolean);

// "- " lines become bullets, others paragraphs.
export function blocks(text: string): { kind: 'p' | 'ul'; items: string[] }[] {
  const out: { kind: 'p' | 'ul'; items: string[] }[] = [];
  String(text || '').split('\n').forEach(raw => {
    const l = raw.trim();
    if (!l) return;
    const bullet = /^[-•*]\s+/.test(l);
    const t = l.replace(/^[-•*]\s+/, '');
    const last = out[out.length - 1];
    if (bullet) { if (last?.kind === 'ul') last.items.push(t); else out.push({ kind: 'ul', items: [t] }); }
    else out.push({ kind: 'p', items: [t] });
  });
  return out;
}

// Cleans the proposal before saving: numbers are numbers, empty list lines dropped.
export function cleanForSave(p: TbProposal): TbProposal {
  const c: TbProposal = JSON.parse(JSON.stringify(p));
  c.activities = (c.activities || []).map(a => ({ ...a, objectives: trimLines(a.objectives), takeaways: trimLines(a.takeaways), materials: trimLines(a.materials), photos: (a.photos || []).filter(Boolean) }));
  c.pax = Math.max(0, Math.round(Number(c.pax) || 0));
  if (c.packages) c.packages.bands = (c.packages.bands || []).map(b => ({ ...b, min: Math.max(0, Math.round(+b.min || 0)), max: Math.max(0, Math.round(+b.max || 0)) }));
  return c;
}
