// To-do tasks (redesigned 2026-10-17). One shared task per job in the "tasks" collection:
// the person it's assigned to and the person who assigned it both see the same task, so ticking it
// done shows for both. Field names are kept from the old screen so old tasks still show:
//   detail, dateline (due date), status 'Not done' | 'Done', assignedById/assignedBy, assignedToId/assignedTo.
// New: doneAt, doneByName, pipelineId (the deal it's about). Old copies made for the assignee
// (isDuplicate: true) are skipped; the original is the one task.
// Client tags and several people (2026-10-18): assignedToIds lists everyone it's for (assignedToId stays the first,
// for older screens); anyone of them can tick it, and it's done for all. clientIds lists clients tagged with "@" in
// the text; the task shows on those clients' pages, and ticking it done can add a touch point (lib/touchPoints.ts).

export interface Task {
  id: string;
  detail: string;
  dateline?: string;          // due date (YYYY-MM-DD), optional
  status: 'Not done' | 'Done';
  assignedById: string;
  assignedBy?: string;
  assignedToId: string;
  assignedTo?: string;
  assignedToIds?: string[];
  clientIds?: string[];
  clientNames?: string[];     // as tagged, in the same order (the text shows "@<name>")
  pipelineId?: string;
  doneAt?: string;
  doneByName?: string;
  dateCreated?: string;
  createdAt?: number;
  isDuplicate?: boolean;
  ownerRepId?: string;        // old field: whose list the old copy sat in
  isHidden?: boolean;
  // Action points from the weekly presentation (2026-10-21, lib/present.ts): always a deadline and one responsible person.
  // 1-to-1 actions (2026-10-25, components/OneToOnePage.tsx): source '121', the session, its date as meetingDate.
  // Only the two people in the 1-to-1 see them in To-do (not in Management's "Everyone's").
  source?: 'meeting' | '121';
  oneToOneId?: string;
  meetingDate?: string;
  meetingSlide?: string;      // the slide on screen when it was raised
  // Shortcut from inside a deal (2026-10-24, components/DealTasks.tsx): the checklist step it's about, and for
  // "Raise payment" the details known when it was asked (blank = to be filled in by the person tagged).
  stepId?: string;
  stepLabel?: string;
  ask?: 'payment';
  payment?: TaskPayment;
}

export interface TaskPayment { what: string; amount: number; payee: string; vendorId: string; timing: 'before' | 'after' }

// What a "Raise payment" task still needs, in plain words.
export function paymentMissing(p?: TaskPayment): string[] {
  if (!p) return [];
  return [!p.what && 'what it is for', !(p.amount > 0) && 'the amount', !p.payee && !p.vendorId && 'who is paid'].filter(Boolean) as string[];
}

export type TaskGroup = 'overdue' | 'today' | 'week' | 'later' | 'nodate' | 'done';

export const GROUP_LABELS: Record<TaskGroup, string> = {
  overdue: 'Overdue',
  today: 'Today',
  week: 'Next 7 days',
  later: 'Later',
  nodate: 'No date',
  done: 'Done',
};

export const GROUP_ORDER: TaskGroup[] = ['overdue', 'today', 'week', 'later', 'nodate', 'done'];

const validDate = (d?: string) => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : '');

// Older tasks may lack the ids; fall back to whose list they sat in.
export function assigneeOf(t: Task): string {
  return t.assignedToId || t.ownerRepId || '';
}
// Everyone the task is for.
export function assigneesOf(t: Task): string[] {
  const list = Array.isArray(t.assignedToIds) && t.assignedToIds.length ? t.assignedToIds : [assigneeOf(t)];
  return [...new Set(list.filter(Boolean))];
}
export function isAssignedTo(t: Task, personId: string): boolean {
  return assigneesOf(t).includes(personId);
}
export function assignerOf(t: Task): string {
  return t.assignedById || t.ownerRepId || '';
}

export function isDone(t: Task): boolean {
  return t.status === 'Done';
}

// The one real task (old assignee copies are skipped).
export function isRealTask(t: Task): boolean {
  return !t.isDuplicate;
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const x = new Date(y, m - 1, d + n);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

export function taskGroup(t: Task, today: string): TaskGroup {
  if (isDone(t)) return 'done';
  const due = validDate(t.dateline);
  if (!due) return 'nodate';
  if (due < today) return 'overdue';
  if (due === today) return 'today';
  if (due <= addDays(today, 7)) return 'week';
  return 'later';
}

// Red dot on the menu: a task assigned to this person that's overdue or due today.
export function needsDoingNow(t: Task, personId: string, today: string): boolean {
  if (!isRealTask(t) || isDone(t) || !isAssignedTo(t, personId)) return false;
  const g = taskGroup(t, today);
  return g === 'overdue' || g === 'today';
}
