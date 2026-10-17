// To-do tasks (redesigned 2026-10-17). One shared task per job in the "tasks" collection:
// the person it's assigned to and the person who assigned it both see the same task, so ticking it
// done shows for both. Field names are kept from the old screen so old tasks still show:
//   detail, dateline (due date), status 'Not done' | 'Done', assignedById/assignedBy, assignedToId/assignedTo.
// New: doneAt, doneByName, pipelineId (the deal it's about). Old copies made for the assignee
// (isDuplicate: true) are skipped; the original is the one task.

export interface Task {
  id: string;
  detail: string;
  dateline?: string;          // due date (YYYY-MM-DD), optional
  status: 'Not done' | 'Done';
  assignedById: string;
  assignedBy?: string;
  assignedToId: string;
  assignedTo?: string;
  pipelineId?: string;
  doneAt?: string;
  doneByName?: string;
  dateCreated?: string;
  createdAt?: number;
  isDuplicate?: boolean;
  ownerRepId?: string;        // old field: whose list the old copy sat in
  isHidden?: boolean;
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
  if (!isRealTask(t) || isDone(t) || assigneeOf(t) !== personId) return false;
  const g = taskGroup(t, today);
  return g === 'overdue' || g === 'today';
}
