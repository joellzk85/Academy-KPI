// Admin checklist after a deal is won (Phase 2B).
// - The master task list lives in config/checklist_tasks. Admin and Management
//   can add, rename, reorder and retire tasks there.
// - Each won deal gets its own copy in deal_checklists/{dealId}, made when the
//   deal is won. Later changes to the master list only affect new won deals,
//   so work in progress never jumps around.
// - Whether a task applies (e.g. "Apply grant" only for HRDC deals) is worked
//   out from the deal's current funding type, so changing it later just works.

import { FundingType, trainingEndDate } from './deals';
import { isItemsOnly } from './dealQuotes';

// Before training (Joel, 2026-10-20): venue, bus and facilitator first ask "Needed? Yes / No"; materials is a small
// tick list of its own. Costs on these steps are payment requests (money_out with checklistTaskId, StepCosts.tsx).
export type TaskKind = 'grant' | 'quotation' | 'venue' | 'trainer' | 'basic' | 'bus' | 'facilitator' | 'materials';
export type AppliesTo = 'all' | 'hrdc';

export interface TaskTemplate {
  id: string;
  label: string;
  kind: TaskKind;
  appliesTo: AppliesTo;
  after?: boolean;        // done after training day (post-training documents)
  files?: boolean;        // has a file drop box; uploading ticks it, and it can't be ticked without a file
  optional?: boolean;     // shown, but never needed for "Case closed" and not counted in "X of Y" (Certificates)
  retired?: boolean;      // hidden from new checklists, kept for the record
}

export interface ChecklistTask {
  id: string;
  label: string;
  kind: TaskKind;
  appliesTo: AppliesTo;
  after?: boolean;        // done after training day
  oneOff?: boolean;       // added for this deal only
  files?: boolean;        // has a file drop box (lib/checklistFiles.ts)
  optional?: boolean;     // not needed for "Case closed" (lib/postTraining.ts)
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
  // Venue, bus, facilitator: answered "Needed?" (undefined = not answered yet). No = done, "Not needed".
  needed?: boolean;
  busCount?: number;
  busSeats?: number;        // seats per bus
  facilitatorCount?: number;
  // Materials: lines to tick (undefined = the standard T-shirt, Banner, Print-out, none ticked)
  items?: MaterialItem[];
}

export interface MaterialItem { id: string; label: string; done: boolean; byName?: string; at?: string }
export const DEFAULT_MATERIALS = ['T-shirt', 'Banner', 'Print-out'];
export const materialItems = (t: Partial<ChecklistTask>): MaterialItem[] =>
  Array.isArray(t.items) ? t.items : DEFAULT_MATERIALS.map((label, i) => ({ id: `m${i + 1}`, label, done: false }));

// Steps that ask "Needed for this training?" first.
export const ASKS_NEEDED: TaskKind[] = ['venue', 'bus', 'facilitator'];
export const asksNeeded = (t: { kind?: string }) => ASKS_NEEDED.includes(t.kind as TaskKind);
export const notNeeded = (t: Partial<ChecklistTask>) => asksNeeded(t) && t.needed === false;

// What a step's payment requests are filed under (money_out.category), so the P&L shows them by kind.
export const COST_CATEGORY: Partial<Record<TaskKind, string>> = { venue: 'Venue', bus: 'Bus', facilitator: 'Facilitator', trainer: 'Trainer', materials: 'Materials' };
export const costCategory = (t: { kind?: string }) => COST_CATEGORY[t.kind as TaskKind] || 'Other';
export const hasCosts = (t: { kind?: string }) => !!COST_CATEGORY[t.kind as TaskKind];

export interface ChecklistSettings {
  tasks: TaskTemplate[];
  flagDays: number;       // red flag when training is this many days away or fewer
  grantDays: number;      // flag an HRDC deal won this many days ago whose grant isn't applied yet
}

// Built-in steps that are retired for good (Joel, 2026-10-18): "Quotation" is always
// already done, because a deal can only be won after its quotation is sent.
// They stay retired even if a saved master list still has them switched on.
export const RETIRED_BUILTINS = ['quotation'];
const isRetiredStep = (t: { id?: string; kind?: string }) => t.kind === 'quotation' || RETIRED_BUILTINS.includes(t.id || '');

export const KIND_LABELS: Record<TaskKind, string> = {
  grant: 'HRDC grant',
  quotation: 'Quotation',
  venue: 'Venue',
  trainer: 'Trainer',
  basic: 'Simple tick',
  bus: 'Bus',
  facilitator: 'Facilitator',
  materials: 'Materials list',
};

export const APPLIES_LABELS: Record<AppliesTo, string> = {
  all: 'All won deals',
  hrdc: 'HRDC deals only',
};

export const DEFAULT_SETTINGS: ChecklistSettings = {
  flagDays: 7,
  grantDays: 3,
  tasks: [
    // Before training, in Joel's order (2026-10-20). The quotation isn't a step any more: the checklist shows it
    // ticked by itself (a deal is won only after its quotation).
    { id: 'grant', label: 'Grant approved', kind: 'grant', appliesTo: 'hrdc' },
    { id: 'quotation', label: 'Quotation', kind: 'quotation', appliesTo: 'all', retired: true },
    { id: 'attendance', label: 'Attendance list', kind: 'basic', appliesTo: 'all', files: true },
    { id: 'venue', label: 'Venue', kind: 'venue', appliesTo: 'all' },
    { id: 'bus', label: 'Bus', kind: 'bus', appliesTo: 'all' },
    { id: 'facilitator', label: 'Facilitator', kind: 'facilitator', appliesTo: 'all' },
    { id: 'trainer', label: 'Trainer', kind: 'trainer', appliesTo: 'all' },
    { id: 'output_qr', label: 'Output assessment QR', kind: 'basic', appliesTo: 'all', files: true },
    { id: 'materials', label: 'Materials', kind: 'materials', appliesTo: 'all' },
    // After training day, in Joel's order (2026-10-20): the invoice comes first (recorded in the deal's
    // "After training" section, lib/postTraining.ts), then JD14, T3, training report, output assessment.
    // Certificates is optional (not in Joel's list): shown last, never needed for "Case closed".
    { id: 'jd14', label: 'JD14', kind: 'basic', appliesTo: 'hrdc', after: true, files: true },
    { id: 't3', label: 'Verify T3 attendance', kind: 'basic', appliesTo: 'hrdc', after: true, files: true },
    { id: 'training_report', label: 'Training report', kind: 'basic', appliesTo: 'all', after: true },
    { id: 'output_assessment', label: 'Output assessment', kind: 'basic', appliesTo: 'all', after: true, files: true },
    { id: 'certificates', label: 'Certificates', kind: 'basic', appliesTo: 'all', after: true, optional: true },
  ],
};

// Built-in steps that have a file drop box unless switched off. Older saved lists and checklists
// don't have the "files" setting yet, so this decides for them (Joel, 2026-10-19).
const FILE_BUILTINS = DEFAULT_SETTINGS.tasks.filter(t => t.files).map(t => t.id);
export const hasFiles = (t: { id?: string; kind?: string; files?: boolean }) =>
  t.kind === 'basic' && (t.files ?? FILE_BUILTINS.includes(t.id || ''));

// Built-in steps renamed or changed on 2026-10-20 (Joel's pre-training flow). Lists and checklists saved before keep
// their own names if someone renamed them; untouched ones take the new name and kind.
const OLD_LABELS: Record<string, string> = {
  grant: 'Apply grant', attendance: 'Follow up attendance list', venue: 'Check venue + payment', materials: 'Prepare materials', trainer: 'Confirm trainer',
};
export function upgradeTask<T extends { id: string; label: string; kind: TaskKind; files?: boolean }>(t: T): T {
  if (!OLD_LABELS[t.id] && t.id !== 'attendance' && t.id !== 'materials') return t;
  const builtin = DEFAULT_SETTINGS.tasks.find(d => d.id === t.id);
  const next = { ...t };
  if (builtin && t.label === OLD_LABELS[t.id]) next.label = builtin.label;
  if (t.id === 'attendance' && t.kind === 'basic') next.files = true;                 // now an upload
  if (t.id === 'materials' && t.kind === 'basic') next.kind = 'materials';           // now a tick list
  return next;
}
export const upgradeTasks = (tasks: ChecklistTask[] | undefined): ChecklistTask[] => (tasks || []).map(upgradeTask);

// Steps added in the 2026-10-20 update. A won deal whose training hasn't ended gets them on its checklist
// (DealChecklist.tsx), placed after the built-in step before them.
export const NEW_STEPS_2026_10_20 = ['bus', 'facilitator', 'output_qr'];
export function withSteps(tasks: ChecklistTask[], add: TaskTemplate[]): ChecklistTask[] {
  const next = [...tasks];
  add.forEach(m => {
    if (next.some(t => t.id === m.id)) return;
    const i = DEFAULT_SETTINGS.tasks.findIndex(d => d.id === m.id);
    const before = DEFAULT_SETTINGS.tasks.slice(0, Math.max(i, 0)).reverse().find(p => next.some(t => t.id === p.id));
    const at = before ? next.findIndex(t => t.id === before.id) + 1 : next.filter(t => !t.after).length;
    next.splice(at, 0, { id: m.id, label: m.label, kind: m.kind, appliesTo: m.appliesTo, after: !!m.after, files: hasFiles(m), optional: isOptional(m), done: false });
  });
  return next;
}
// Optional built-in steps (Certificates). Older lists and checklists don't have the setting yet, so this decides for them.
const OPTIONAL_BUILTINS = DEFAULT_SETTINGS.tasks.filter(t => t.optional).map(t => t.id);
export const isOptional = (t: { id?: string; optional?: boolean }) => t.optional ?? OPTIONAL_BUILTINS.includes(t.id || '');

export function readSettings(data: any): ChecklistSettings {
  const saved: TaskTemplate[] = Array.isArray(data?.tasks) && data.tasks.length ? data.tasks : [];
  // Built-in tasks added in later updates appear even if the list was saved before, placed after
  // the built-in step that comes before them (e.g. T3 after JD14).
  // Ones Joel stopped using stay in the saved list as "retired", so they never come back.
  let merged: TaskTemplate[] = DEFAULT_SETTINGS.tasks;
  if (saved.length) {
    merged = [...saved];
    DEFAULT_SETTINGS.tasks.forEach((d, i) => {
      if (merged.some(t => t.id === d.id)) return;
      const before = DEFAULT_SETTINGS.tasks.slice(0, i).reverse().find(p => merged.some(t => t.id === p.id));
      merged.splice(before ? merged.findIndex(t => t.id === before.id) + 1 : merged.length, 0, d);
    });
  }
  const tasks = merged.map(upgradeTask).map(t => ({ ...t, files: hasFiles(t), optional: isOptional(t), ...(isRetiredStep(t) ? { retired: true } : {}) }));
  const num = (v: any, fallback: number) => (Number.isFinite(Number(v)) && v !== '' && v !== null && Number(v) >= 0 ? Number(v) : fallback);
  return { tasks, flagDays: num(data?.flagDays, DEFAULT_SETTINGS.flagDays), grantDays: num(data?.grantDays, DEFAULT_SETTINGS.grantDays) };
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
    .map(t => ({ id: t.id, label: t.label, kind: t.kind, appliesTo: t.appliesTo, after: !!t.after, files: hasFiles(t), optional: isOptional(t), done: false }));
}

// Tasks that apply to this deal, in the checklist's own order (older built-in names and kinds upgraded).
// The Quotation step on older checklists is left out: the checklist shows the quotation ticked by itself
// (2026-10-20), so it never counts in "X of Y" or blocks "All done".
export function applicableTasks(tasks: ChecklistTask[] | undefined, fundingType?: FundingType | string): ChecklistTask[] {
  return upgradeTasks(tasks).filter(t => (t.appliesTo !== 'hrdc' || isHrdc(fundingType)) && !isRetiredStep(t));
}

// Optional steps (Certificates) aren't counted. part: only the steps before, or after, training day.
export function progress(tasks: ChecklistTask[] | undefined, fundingType?: string, part?: 'before' | 'after'): { done: number; total: number } {
  const list = applicableTasks(tasks, fundingType).filter(t => !isOptional(t) && (!part || (part === 'after') === !!t.after));
  return { done: list.filter(t => t.done).length, total: list.length };
}

// ---------- Venue and trainer from the quotation (Joel, 2026-10-17) ----------
// Until Admin chooses one on the checklist (or ticks the step), the venue and trainer
// are read from the deal's quotation: the one marked sent, else the newest draft.

export interface Picked { id: string; name: string; from: 'checklist' | 'quotation' }

// A deal can have several quotations (2026-10-19): the training one (with programme lines) wins over
// add-on quotations for other items only (bus, T-shirts...).
export function mainQuote(allQuotes: any[]): any | null {
  const training = allQuotes.filter(q => !isItemsOnly(q));
  const quotes = training.length ? training : allQuotes;
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
// fileCount: files uploaded on this step (the drop box steps, and the trainer's PO).
export function taskGate(t: ChecklistTask, dealQuoteCount: number, grantBlock = '', hasVenue = !!t.venueId, hasTrainer = !!t.trainerId, fileCount = 0): string {
  if (hasFiles(t) && fileCount === 0) return `Upload the ${t.label} file first (drop it in the box).`;
  if (t.kind === 'grant' && grantBlock) return grantBlock;
  if (asksNeeded(t) && t.needed === undefined) return 'Answer "Needed for this training?" first.';
  if (notNeeded(t)) return '';
  if (t.kind === 'venue' && !hasVenue) return 'Choose or type the venue first.';
  if (t.kind === 'bus' && !(Number(t.busCount) > 0)) return 'Enter how many buses first.';
  if (t.kind === 'facilitator' && !(Number(t.facilitatorCount) > 0)) return 'Enter how many facilitators first.';
  if (t.kind === 'trainer' && !hasTrainer) return 'Choose or type the trainer first.';
  if (t.kind === 'trainer' && fileCount === 0) return "Add the trainer's fee below first (the PO is made from it), or upload a PO.";
  if (t.kind === 'materials') {
    const items = materialItems(t);
    if (!items.length) return 'Add at least one item to the materials list.';
    if (items.some(i => !i.done)) return 'Tick every item on the materials list first.';
  }
  if (t.kind === 'quotation' && dealQuoteCount === 0) return 'Create or link a quotation for this deal first.';
  return '';
}

export function daysUntil(iso: string, today: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso || '')) return null;
  const a = new Date(iso.slice(0, 10) + 'T00:00:00');
  const b = new Date(today + 'T00:00:00');
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

export interface Flag { level: 'danger' | 'attention'; text: string; grant?: boolean }

// HRDC deal won a while ago and "Grant approved" not ticked yet (Joel, 2026-10-18; a tick only since 2026-10-20).
// Amber from settings.grantDays after the won date; red when training is within the red-flag window.
// Stops once the training date has passed (the "training date has passed" flag covers it).
// A won deal with no checklist yet counts as not approved. Direct-pay deals never get it.
export function grantNotAppliedFlag(deal: any, tasks: ChecklistTask[] | undefined, settings: ChecklistSettings, today: string, wonDate: string): Flag | null {
  if (!isHrdc(deal?.fundingType) || !wonDate) return null;
  const grant = (tasks || []).find(t => t.kind === 'grant');
  if (grant?.done) return null;
  if (tasks && !grant) return null;                      // grant step removed from this deal
  const since = -(daysUntil(wonDate, today) ?? 0);
  if (since < settings.grantDays) return null;
  const train = daysUntil(deal?.trainingDate, today);
  const trainEnd = daysUntil(trainingEndDate(deal), today);
  if (trainEnd !== null && trainEnd < 0) return null;
  const red = train !== null && train <= settings.flagDays;
  return { level: red ? 'danger' : 'attention', text: `Won ${since} day${since === 1 ? '' : 's'} ago, grant not approved`, grant: true };
}

// Red flags for the admin work queue.
export function checklistFlags(deal: any, tasks: ChecklistTask[] | undefined, settings: ChecklistSettings, today: string, wonDate = ''): Flag[] {
  const g = grantNotAppliedFlag(deal, tasks, settings, today, wonDate);
  const rest = trainingFlags(deal, tasks, settings, today);
  // "Not applied" already says more than "not approved", so only one shows.
  return g ? [g, ...rest.filter(f => !/grant not approved$/.test(f.text))] : rest;
}

function trainingFlags(deal: any, tasks: ChecklistTask[] | undefined, settings: ChecklistSettings, today: string): Flag[] {
  // After-training steps have their own reminders (postTrainingFlags in lib/postTraining.ts).
  const list = applicableTasks(tasks, deal?.fundingType);
  const open = list.filter(t => !t.done && !t.after && !isOptional(t));   // must be done before training day
  const s = (n: number) => (n === 1 ? '' : 's');
  const start = daysUntil(deal?.trainingDate, today);
  if (start === null) return list.some(t => !t.done && !isOptional(t)) ? [{ level: 'attention', text: 'No training date yet' }] : [];
  // A training of several days has "passed" only after its last day; while it's on, it counts as today.
  const end = daysUntil(trainingEndDate(deal), today) ?? start;
  const days = start < 0 && end >= 0 ? 0 : start;
  if (end < 0) return open.length ? [{ level: 'danger', text: `Training date has passed with ${open.length} step${s(open.length)} open before training` }] : [];
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
