// NEXT Academy CRM: the data backup, the parts that don't talk to Google (2026-10-17).
// Turns every database list into a plain table (one row per record, one column per field), used for
// both the Google Sheet copy and the Excel download (serverBackup.ts). Pure, so it can be tested.

// Never backed up: login data and the server's own bookkeeping.
export const SKIP_COLLECTIONS = ['secrets', 'server_secrets', 'auth_map', 'calendar_sync', 'user_prefs', 'payment_links'];
// Never backed up from the config list.
export const SKIP_CONFIG_DOCS = ['passwords', 'google_calendar', 'backup_settings', 'outlook'];

// Friendly tab names, in the order they appear. Lists not named here (older ones) follow, A to Z.
export const LIST_NAMES: [string, string][] = [
  ['pipelines', 'Deals'],
  ['clients', 'Clients'],
  ['client_touch_points', 'Client touch points'],
  ['quotations', 'Quotations'],
  ['course_outlines', 'Course outlines'],
  ['teambuilding_proposals', 'Teambuilding proposals'],
  ['tb_activities', 'Teambuilding activities'],
  ['tb_settings', 'Teambuilding settings'],
  ['doc_links', 'Client links'],
  ['proposal_views', 'Client link visits'],
  ['proposal_files', 'Proposal files'],
  ['money_in', 'Money in'],
  ['money_out', 'Money out'],
  ['vendors', 'Vendors'],
  ['project_pl', 'Project P&L SST typed'],
  ['payment_records', 'Payment tracking'],
  ['payment_receipts', 'Payment receipts'],
  ['deal_checklists', 'Admin checklists'],
  ['checklist_files', 'Checklist files'],
  ['training_reports', 'Training reports'],
  ['trainer_docs', 'Trainers outlines and proposals'],
  ['hrdc_queries', 'HRDC queries'],
  ['programmes', 'Programmes'],
  ['trainers_directory', 'Trainers'],
  ['trainer_private', 'Trainer IC numbers'],
  ['trainer_link_private', 'Trainer IC numbers from links'],
  ['venues_directory', 'Venues'],
  ['tasks', 'To-do'],
  ['events', 'Calendar events'],
  ['month_kpis', 'KPI history'],
  ['reps', 'KPI sets and targets'],
  ['team', 'Team'],
  ['team_emails', 'Team work emails'],
  ['config', 'Settings'],
];

export const INFO_TAB = 'Backup info';
const MAX_CELL = 45000;   // Google Sheets allows 50,000 characters in a cell
// Fields left out wherever they appear (e.g. old records from the previous login system).
const SECRET_FIELD = /password|passwd|secret|token|hash|salt/i;

export function tabName(collectionId: string): string {
  const known = LIST_NAMES.find(([id]) => id === collectionId);
  // Sheet names can't contain : \ / ? * [ ]
  return (known ? known[1] : collectionId).replace(/[:\\/?*[\]]/g, '_').slice(0, 90);
}

export function orderCollections(ids: string[]): string[] {
  const known = LIST_NAMES.map(([id]) => id).filter(id => ids.includes(id));
  const rest = ids.filter(id => !known.includes(id)).sort();
  return [...known, ...rest].filter(id => !SKIP_COLLECTIONS.includes(id));
}

// One cell's value: plain text, numbers and yes/no stay as they are; dates become text;
// anything with parts (a list of steps, an address block…) is written as JSON so nothing is lost.
export function cellValue(v: any): string | number | boolean {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? v : String(v);
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return cut(v);
  if (typeof v?.toDate === 'function') {           // a Firestore date
    try { return v.toDate().toISOString(); } catch { return ''; }
  }
  if (v instanceof Date) return v.toISOString();
  try { return cut(JSON.stringify(v, (_k, x) => (typeof x?.toDate === 'function' ? x.toDate().toISOString() : x))); }
  catch { return cut(String(v)); }
}

function cut(s: string): string {
  return s.length > MAX_CELL ? `${s.slice(0, MAX_CELL)} …(cut: too long for one cell)` : s;
}

// Google Sheets (and Excel) treat "Venues" and "venues" as the same tab name. When two lists would clash
// (e.g. an older "venues" list next to the Venues directory), the later one is renamed so both are kept.
export function uniqueTabs(tables: Table[]): Table[] {
  const used = new Set<string>([INFO_TAB.toLowerCase()]);
  return tables.map(t => {
    let tab = t.tab;
    if (used.has(tab.toLowerCase())) tab = `${t.tab} (older list)`;
    for (let i = 2; used.has(tab.toLowerCase()); i++) tab = `${t.tab} (${i})`;
    used.add(tab.toLowerCase());
    return tab === t.tab ? t : { ...t, tab };
  });
}

export type Table = { collectionId: string; tab: string; rows: (string | number | boolean)[][]; count: number };

// Records → a table with a header row. "id" comes first, then the fields A to Z.
export function toTable(collectionId: string, docs: { id: string; data: Record<string, any> }[]): Table {
  const fields = new Set<string>();
  docs.forEach(d => Object.keys(d.data || {}).forEach(k => { if (k !== 'id' && !SECRET_FIELD.test(k)) fields.add(k); }));
  const columns = [...fields].sort((a, b) => a.localeCompare(b));
  const rows: (string | number | boolean)[][] = [['id', ...columns]];
  [...docs].sort((a, b) => a.id.localeCompare(b.id)).forEach(d => {
    rows.push([d.id, ...columns.map(c => cellValue(d.data?.[c]))]);
  });
  return { collectionId, tab: tabName(collectionId), rows, count: docs.length };
}

// The "Backup info" tab: when, who, and how many records each list had.
export function infoTable(tables: Table[], whenIso: string, byName: string, reason: string): (string | number)[][] {
  return [
    ['NEXT Academy CRM backup'],
    ['Made at (Malaysia time)', malaysiaTime(whenIso)],
    ['Started by', byName],
    ['Why', reason],
    ['Passwords and login data are never included.'],
    [],
    ['List', 'Records', 'Database name'],
    ...tables.map(t => [t.tab, t.count, t.collectionId]),
  ];
}

export function malaysiaTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', dateStyle: 'medium', timeStyle: 'short' });
}

// The Malaysia date (YYYY-MM-DD) of a moment, so "once a day" follows Malaysian days.
export function malaysiaDay(ms: number): string {
  return new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
}

// Pulls the spreadsheet ID out of a pasted link (or accepts the ID itself).
export function sheetIdFrom(input: string): string {
  const s = String(input || '').trim();
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/);
  if (m) return m[1];
  return /^[a-zA-Z0-9_-]{20,}$/.test(s) ? s : '';
}
