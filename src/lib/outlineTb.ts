import { CourseOutline, CourseOutlineItem, OutlineAgendaRow } from '../types';
import { TbAgendaDay, TbProposal, TbProposalActivity, blankActivity, newTbId } from './teambuilding';
import { lines } from './outlineContent';
import { Programme, isTbProgramme, titleKey } from './programmes';

// Course outline types and the bridge between teambuilding outlines and proposals (Joel, 2026-10-24).
// HRDC registers a teambuilding programme from its course outline; the client is pitched with the proposal.
// "Speed build proposal" turns an outline into a draft proposal (photos, venues, packages added later), and
// "Speed course outline" turns a proposal back into an outline. Each remembers where it came from, so a second
// click opens the one already made instead of a duplicate.

export type OutlineType = 'teambuilding' | 'soft' | 'technical';
export const OUTLINE_TYPES: { key: OutlineType; label: string }[] = [
  { key: 'teambuilding', label: 'Teambuilding' },
  { key: 'soft', label: 'Soft skill' },
  { key: 'technical', label: 'Technical skill' },
];
/** Older outlines have no type: they count as Soft skill. */
export const outlineTypeOf = (o: Pick<CourseOutline, 'kind' | 'skillType'>): OutlineType =>
  o.kind === 'teambuilding' ? 'teambuilding' : o.skillType === 'technical' ? 'technical' : 'soft';
export const outlineTypeFields = (t: OutlineType): Pick<CourseOutline, 'kind' | 'skillType'> =>
  t === 'teambuilding' ? { kind: 'teambuilding', skillType: undefined } : { kind: 'training', skillType: t };
export const outlineTypeLabel = (o: Pick<CourseOutline, 'kind' | 'skillType'>) => OUTLINE_TYPES.find(x => x.key === outlineTypeOf(o))!.label;

// ---------- A title's type (Joel, 2026-10-24): every list of titles or outlines sorts into these three ----------
/** "(TB)" titles are Teambuilding. Otherwise what Admin set on the title, else its newest outline's type (the
 *  outline creator's choice), else Soft skill. */
export function programmeTypeOf(p: Pick<Programme, 'id' | 'name' | 'skillType'> | undefined, outlines: any[] = []): OutlineType {
  if (!p) return 'soft';
  if (isTbProgramme(p.name)) return 'teambuilding';
  if (p.skillType === 'technical' || p.skillType === 'soft') return p.skillType;
  const key = titleKey(p.name);
  const mine = outlines
    .filter(o => o && o.id !== 'outline_default' && !o.isHidden && !o.dealDeleted && outlineTypeOf(o) !== 'teambuilding'
      && (o.programmeId ? o.programmeId === p.id : titleKey(o.courseTitle) === key))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || Number(b.createdAt || 0) - Number(a.createdAt || 0));
  return mine.length ? outlineTypeOf(mine[0]) : 'soft';
}

// ---------- Agenda: the outline keeps one list (day headings + time slots); the builder works in days ----------
export function agendaToDays(rows: OutlineAgendaRow[] | undefined): TbAgendaDay[] {
  const days: TbAgendaDay[] = [];
  (rows || []).forEach(r => {
    if (r.isDay) { days.push({ id: r.id, title: r.text || r.time || '', rows: [] }); return; }
    if (!days.length) days.push({ id: `day_${r.id}`, title: 'Day 1', rows: [] });
    days[days.length - 1].rows.push({ id: r.id, time: r.time || '', text: r.text || '', tag: r.tag || '' });
  });
  return days;
}
export function daysToAgenda(days: TbAgendaDay[]): OutlineAgendaRow[] {
  const out: OutlineAgendaRow[] = [];
  days.forEach((d, i) => {
    out.push({ id: d.id, time: '', text: d.title || `Day ${i + 1}`, isDay: true });
    d.rows.forEach(r => out.push({ id: r.id, time: r.time, text: r.text, ...(r.tag ? { tag: r.tag } : {}) }));
  });
  return out;
}

// Only days with something typed in them, without their empty time slots.
const filledDays = (days: TbAgendaDay[]) => days
  .map(d => ({ ...d, rows: d.rows.filter(r => (r.time || r.text).trim()) }))
  .filter(d => d.rows.length);

// ---------- Outline → proposal ----------
/** The proposal's content from a teambuilding outline (as it prints now). Photos, venues and packages are left to add. */
export function proposalFromOutline(o: CourseOutline, programmeId: string): Partial<TbProposal> {
  const outcomes = (o.outcomes || []).map(x => x.trim()).filter(Boolean);
  const mods = (o.items || []).filter(m => (m.moduleTitle || m.topics || '').trim());
  const days = filledDays(agendaToDays(o.agenda));
  const overview = (o.overview || '').trim();
  return {
    title: (o.courseTitle || '').trim(),
    ...(overview && overview.length <= 220 ? { subtitle: overview } : {}),
    ...(outcomes.length ? { objectives: outcomes.map(t => ({ id: newTbId('ob'), title: t, text: '' })) } : {}),
    activities: mods.map((m): TbProposalActivity => ({
      ...blankActivity(), id: newTbId('pa'),
      name: (m.moduleTitle || '').trim(), objectives: lines(m.topics), duration: (m.duration || '').trim(), format: (m.methodology || '').trim(),
    })),
    ...(days.length ? { agenda: days.map(d => ({ ...d, id: newTbId('day'), rows: d.rows.map(r => ({ ...r, id: newTbId('ar') })) })) } : {}),
    trainers: o.trainerId ? [{ id: newTbId('tr'), trainerId: o.trainerId }] : [],
    ...(o.terms !== undefined ? { terms: o.terms } : {}),
    programmeId, fromOutlineId: o.id,
  } as Partial<TbProposal>;
}

// ---------- Proposal → outline ----------
/** A teambuilding outline's content from a proposal (the saved proposal, not the resolved one, so standard terms stay standard). */
export function outlineFromProposal(p: TbProposal, programmeName: string, defaultSubtitle: string): Partial<CourseOutline> {
  const title = (p.title || '').trim();
  const programmeId = String(p.programmeId || '');
  const useProg = !!programmeId && (!title || title === programmeName);
  const subtitle = (p.subtitle || '').trim();
  const days = filledDays(p.agenda || []);
  const nDays = Math.max(1, days.length);
  const items: CourseOutlineItem[] = (p.activities || []).filter(a => (a.name || '').trim()).map((a, i) => ({
    id: `m_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`, no: i + 1,
    moduleTitle: a.name.trim(),
    topics: [(a.summary || '').trim(), ...(a.objectives || []).map(x => x.trim())].filter(Boolean).join('\n'),
    duration: (a.duration || '').trim(), methodology: (a.format || '').trim(),
  }));
  const trainer = (p.trainers || []).find(t => t.trainerId);
  return {
    kind: 'teambuilding', skillType: undefined,
    courseTitle: useProg ? '' : title, useProgrammeName: useProg, programmeId,
    overview: subtitle && subtitle !== defaultSubtitle ? subtitle : '',
    outcomes: (p.objectives || []).map(x => [x.title.trim(), x.text.trim()].filter(Boolean).join(': ')).filter(Boolean),
    items: items.length ? items : [{ id: `m_${Date.now()}`, no: 1, moduleTitle: '', topics: '', duration: '', methodology: '' }],
    agenda: daysToAgenda(days),
    durationDays: nDays, totalHours: 8 * nDays,
    ...(trainer ? { trainerId: trainer.trainerId } : {}),
    ...(p.terms !== undefined ? { terms: p.terms } : {}),
    fromTbProposalId: p.id,
  };
}
