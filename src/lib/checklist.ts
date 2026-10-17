// Admin checklist after a deal is won (Phase 2B).
// - The master task list lives in config/checklist_tasks. Admin and Management
//   can add, rename, reorder and retire tasks there.
// - Each won deal gets its own copy in deal_checklists/{dealId}, made when the
//   deal is won. Later changes to the master list only affect new won deals,
//   so work in progress never jumps around.
// - Whether a task applies (e.g. "Apply grant" only for HRDC deals) is worked
//   out from the deal's current funding type, so changing it later just works.

import { FundingType } from './deals';

export type TaskKind = 'grant' | 'quotation' | 'venue' | 'trainer' | 'basic';
export type AppliesTo = 'all' | 'hrdc';

export interface TaskTemplate {
  id: string;
  label: string;
  kind: TaskKind;
  appliesTo: AppliesTo;
  after?: boolean;        // done after training day (post-training documents)
  retired?: boolean;      // hidden from new checklists, kept for the record
}

export interface ChecklistTask {
  id: string;
  label: string;
  kind: TaskKind;
  appliesTo: AppliesTo;
  after?: boolean;        // done after training day
  oneOff?: boolean;       // added for this deal only
  done: boolean;
  doneAt?: string;
  doneById?: string;
  doneByName?: string;
  note?: string;
  // Apply grant
  grantAppliedDate?: string;
  grantNumber?: string;
  grantApprovedDate?: string;
  // Check venue + payment (picked from the venue list, or typed)
  venueId?: string;
  venueName?: string;
  venuePaid?: boolean;
  // Confirm trainer (picked from the trainer list, or typed)
  trainerId?: string;
  trainerName?: string;
}

export interface ChecklistSettings {
  tasks: TaskTemplate[];
  flagDays: number;       // red flag when training is this many days away or fewer
}

export const KIND_LABELS: Record<TaskKind, string> = {
  grant: 'HRDC grant',
  quotation: 'Quotation',
  venue: 'Venue',
  trainer: 'Trainer',
  basic: 'Simple tick',
};

export const APPLIES_LABELS: Record<AppliesTo, string> = {
  all: 'All won deals',
  hrdc: 'HRDC deals only',
};

export const DEFAULT_SETTINGS: ChecklistSettings = {
  flagDays: 7,
  tasks: [
    { id: 'grant', label: 'Apply grant', kind: 'grant', appliesTo: 'hrdc' },
    { id: 'quotation', label: 'Quotation', kind: 'quotation', appliesTo: 'all' },
    { id: 'attendance', label: 'Follow up attendance list', kind: 'basic', appliesTo: 'all' },
    { id: 'venue', label: 'Check venue + payment', kind: 'venue', appliesTo: 'all' },
    { id: 'materials', label: 'Prepare materials', kind: 'basic', appliesTo: 'all' },
    { id: 'trainer', label: 'Confirm trainer', kind: 'trainer', appliesTo: 'all' },
    // After training day
    { id: 'jd14', label: 'JD14', kind: 'basic', appliesTo: 'hrdc', after: true },
    { id: 'certificates', label: 'Certificates', kind: 'basic', appliesTo: 'all', after: true },
    { id: 'training_report', label: 'Training report', kind: 'basic', appliesTo: 'all', after: true },
    { id: 'output_assessment', label: 'Output assessment', kind: 'basic', appliesTo: 'all', after: true },
  ],
};

export function readSettings(data: any): ChecklistSettings {
  const saved: TaskTemplate[] = Array.isArray(data?.tasks) && data.tasks.length ? data.tasks : [];
  // Built-in tasks added in later updates appear even if the list was saved before.
  // Ones Joel stopped using stay in the saved list as "retired", so they never come back.
  const tasks = saved.length ? [...saved, ...DEFAULT_SETTINGS.tasks.filter(d => !saved.some(t => t.id === d.id))] : DEFAULT_SETTINGS.tasks;
  const flagDays = Number.isFinite(Number(data?.flagDays)) && Number(data.flagDays) >= 0 ? Number(data.flagDays) : DEFAULT_SETTINGS.flagDays;
  return { tasks, flagDays };
}

export function newTaskId(): string {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function isHrdc(fundingType?: string): boolean {
  return fundingType === 'hrdc' || fundingType === 'hrdc_topup';
}

// A fresh checklist for a deal, from the master list.
export function buildChecklist(settings: ChecklistSettings): ChecklistTask[] {
  return settings.tasks
    .filter(t => !t.retired)
    .map(t => ({ id: t.id, label: t.label, kind: t.kind, appliesTo: t.appliesTo, after: !!t.after, done: false }));
}

// Tasks that apply to this deal, in the checklist's own order.
export function applicableTasks(tasks: ChecklistTask[] | undefined, fundingType?: FundingType | string): ChecklistTask[] {
  return (tasks || []).filter(t => t.appliesTo !== 'hrdc' || isHrdc(fundingType));
}

export function progress(tasks: ChecklistTask[] | undefined, fundingType?: string): { done: number; total: number } {
  const list = applicableTasks(tasks, fundingType);
  return { done: list.filter(t => t.done).length, total: list.length };
}

// ---------- Venue and trainer from the quotation (Joel, 2026-10-17) ----------
// Until Admin chooses one on the checklist (or ticks the step), the venue and trainer
// are read from the deal's quotation: the one marked sent, else the newest draft.

export interface Picked { id: string; name: string; from: 'checklist' | 'quotation' }

export function mainQuote(quotes: any[]): any | null {
  const sent = quotes.filter(q => q.status === 'sent').sort((a, b) => String(b.sentAt || '').localeCompare(String(a.sentAt || '')));
  if (sent.length) return sent[0];
  const drafts = [...quotes].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.id).localeCompare(String(a.id)));
  return drafts[0] || null;
}

const nameIn = (list: any[], id?: string) => (id ? String(list.find(x => x.id === id)?.name || '').trim() : '');

export function effectiveVenue(t: Partial<ChecklistTask> | undefined, quotes: any[], venues: any[]): Picked | null {
  if (t?.venueId || t?.venueName?.trim()) {
    return { id: t.venueId || '', name: nameIn(venues, t.venueId) || (t.venueName || '').trim() || 'Venue chosen', from: 'checklist' };
  }
  const q = mainQuote(quotes);
  const name = q ? nameIn(venues, q.venueId) || String(q.venue || '').trim() : '';
  return name ? { id: q.venueId || '', name, from: 'quotation' } : null;
}

export function effectiveTrainer(t: Partial<ChecklistTask> | undefined, quotes: any[], trainers: any[]): Picked | null {
  if (t?.trainerId || t?.trainerName?.trim()) {
    return { id: t.trainerId || '', name: nameIn(trainers, t.trainerId) || (t.trainerName || '').trim() || 'Trainer chosen', from: 'checklist' };
  }
  const q = mainQuote(quotes);
  // Every trainer on the quotation's programme lines (other items have none).
  const found: { id: string; name: string }[] = [];
  (q?.items || []).filter((it: any) => it.kind !== 'item').forEach((it: any) => {
    const name = nameIn(trainers, it.trainerId) || String(it.trainer || '').trim();
    if (name && !found.some(f => f.name.toLowerCase() === name.toLowerCase())) found.push({ id: it.trainerId || '', name });
  });
  if (!found.length) return null;
  return { id: found.length === 1 ? found[0].id : '', name: found.map(f => f.name).join(', '), from: 'quotation' };
}

// The deal's venue for the deal panel: the checklist's, else the quotation's.
export function dealVenue(checklist: any | null, quotes: any[], venues: any[]): Picked | null {
  const t = (checklist?.tasks || []).find((x: ChecklistTask) => x.kind === 'venue');
  return effectiveVenue(t, quotes, venues);
}

// What still has to be filled in before a task can be ticked. Empty = ready.
// hasVenue / hasTrainer: a venue or trainer is chosen on the checklist or comes from the quotation.
export function taskGate(t: ChecklistTask, dealQuoteCount: number, grantBlock = '', hasVenue = !!t.venueId, hasTrainer = !!t.trainerId): string {
  if (t.kind === 'grant' && grantBlock) return grantBlock;
  if (t.kind === 'grant' && !(t.grantNumber || '').trim()) return 'Enter the grant number once HRDC approves it.';
  if (t.kind === 'venue' && !hasVenue) return 'Choose or type the venue first.';
  if (t.kind === 'venue' && !t.venuePaid) return 'Tick "Venue paid" first.';
  if (t.kind === 'trainer' && !hasTrainer) return 'Choose or type the trainer first.';
  if (t.kind === 'quotation' && dealQuoteCount === 0) return 'Create or link a quotation for this deal first.';
  return '';
}

export function daysUntil(iso: string, today: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso || '')) return null;
  const a = new Date(iso.slice(0, 10) + 'T00:00:00');
  const b = new Date(today + 'T00:00:00');
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

export interface Flag { level: 'danger' | 'attention'; text: string }

// Red flags for the admin work queue.
export function checklistFlags(deal: any, tasks: ChecklistTask[] | undefined, settings: ChecklistSettings, today: string): Flag[] {
  const list = applicableTasks(tasks, deal?.fundingType);
  const openAll = list.filter(t => !t.done);
  if (openAll.length === 0) return [];
  const open = openAll.filter(t => !t.after);          // must be done before training day
  const openAfter = openAll.filter(t => t.after);      // post-training documents
  const s = (n: number) => (n === 1 ? '' : 's');
  const days = daysUntil(deal?.trainingDate, today);
  if (days === null) return [{ level: 'attention', text: 'No training date yet' }];
  if (days < 0) {
    const flags: Flag[] = [];
    if (open.length) flags.push({ level: 'danger', text: `Training date has passed with ${open.length} step${s(open.length)} open` });
    if (openAfter.length) flags.push({ level: 'attention', text: `After training: ${openAfter.map(t => t.label).join(', ')} still to do` });
    return flags;
  }
  if (open.length === 0) return [];
  const flags: Flag[] = [];
  if (days <= settings.flagDays) {
    const when = days === 0 ? 'Training is today' : days === 1 ? 'Training is tomorrow' : `Training in ${days} days`;
    open.filter(t => t.kind === 'grant').forEach(() => flags.push({ level: 'danger', text: `${when}, grant not approved` }));
    open.filter(t => t.kind === 'trainer').forEach(() => flags.push({ level: 'danger', text: `${when}, trainer not confirmed` }));
    if (!flags.length) flags.push({ level: 'attention', text: `${when}, ${open.length} step${open.length === 1 ? '' : 's'} open` });
  }
  return flags;
}
