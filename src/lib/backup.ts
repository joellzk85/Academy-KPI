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
  ['claim_backs', 'Paid on behalf of client'],
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

// ---------- The files ZIP (Admin work → Backup → Download all files) ----------
// Groups the person can tick. 'deals' = proposals and checklist step files (read from their records, one folder per deal);
// the rest are read straight from their storage folders (2026-10-24), so a file without a record is never missed.
export type ZipGroup = 'deals' | 'receipts' | 'programmes' | 'trainers' | 'photos';
export const ZIP_GROUPS: { id: ZipGroup; label: string; prefixes: string[] }[] = [
  { id: 'deals', label: 'Proposals and checklist files (JD14, T3, ...)', prefixes: [] },
  { id: 'receipts', label: 'Payment receipts', prefixes: [] },
  { id: 'programmes', label: 'Programme files (course outlines)', prefixes: ['programme_files/'] },
  { id: 'trainers', label: 'Trainer files (profiles, biodata, TTT, training photos and T3 from the portal)', prefixes: ['trainer_files/', 'trainer_uploads/', 'trainer_portal/'] },
  { id: 'photos', label: 'Photos (teambuilding, trainers, venues, covers, client logos)', prefixes: ['photos/'] },
];
export const zipGroupsFrom = (v: any): ZipGroup[] => {
  const all = ZIP_GROUPS.map(g => g.id);
  const picked = Array.isArray(v) ? all.filter(id => v.includes(id)) : [];
  return Array.isArray(v) ? picked : all;   // nothing sent (older screens) = everything
};

const PHOTO_FOLDERS: Record<string, string> = { activities: 'Activities', trainers: 'Trainers', venues: 'Venues', covers: 'Covers', logos: 'Client logos' };

export interface ZipLookups {
  programmeName: (id: string) => string;   // '' when not found
  trainerName: (id: string) => string;
  linkTrainer: (token: string) => { trainerId?: string; name?: string } | null;   // trainer_links/{token}
  dealFolder: (dealId: string) => string;
  clean: (name: string, max?: number) => string;   // safeFileName
}

// "{kind}_{time}_{name}" (trainer files) → "2026-10-20 biodata name.pdf"; "photo_{time}.jpg" → "2026-10-20 photo.jpg".
function readableTrainerFile(file: string): string {
  const m = /^([a-z0-9]+)_(\d{12,13})(.*)$/i.exec(file);
  if (!m) return file;
  const day = new Date(Number(m[2]) + 8 * 3600000).toISOString().slice(0, 10);
  const rest = m[3].replace(/^_/, '');
  return `${day} ${rest.startsWith('.') || !rest ? `${m[1]}${rest}` : `${m[1]} ${rest}`}`;
}

// Where a stored file goes inside the ZIP, and what it is. Null = not one of the storage-listed groups.
export function zipPlace(path: string, look: ZipLookups): { zipPath: string; what: string } | null {
  const parts = path.split('/');
  const file = parts[parts.length - 1];
  if (!file) return null;
  const trainerFolder = (id: string) => look.clean(look.trainerName(id) || `Trainer removed (${id.slice(-6)})`, 90);
  if (parts[0] === 'programme_files' && parts.length === 3) {
    const name = look.programmeName(parts[1]) || `Programme removed (${parts[1].slice(-6)})`;
    return { zipPath: `Programmes/${look.clean(name, 90)}/${file.replace(/^pgf_[a-z0-9]+_/i, '')}`, what: 'Programme file' };
  }
  if (parts[0] === 'trainer_files' && parts.length === 3) {
    return { zipPath: `Trainers/${trainerFolder(parts[1])}/${readableTrainerFile(file)}`, what: 'Trainer file' };
  }
  if (parts[0] === 'trainer_uploads' && parts.length === 3) {
    const link = look.linkTrainer(parts[1]);
    const folder = link?.trainerId && look.trainerName(link.trainerId) ? trainerFolder(link.trainerId)
      : look.clean(`New trainer - ${link?.name || 'name not given'}`, 90);
    return { zipPath: `Trainers/${folder}/From profile link/${readableTrainerFile(file)}`, what: 'Trainer file (profile link)' };
  }
  if (parts[0] === 'trainer_portal' && parts.length >= 3) {
    if (parts[2] === 'claims' && parts.length === 5) {
      return { zipPath: `Trainers/${trainerFolder(parts[1])}/Trainings/${look.dealFolder(parts[3])}/${readableTrainerFile(file)}`, what: 'Trainer training photo or T3' };
    }
    const sub = parts.slice(2, -1).map(p => look.clean(p, 60)).join('/');
    return { zipPath: `Trainers/${trainerFolder(parts[1])}/${sub ? `${sub}/` : ''}${readableTrainerFile(file)}`, what: 'Trainer file (portal)' };
  }
  if (parts[0] === 'photos' && parts.length === 3) {
    return { zipPath: `Photos/${PHOTO_FOLDERS[parts[1]] || look.clean(parts[1], 60)}/${file}`, what: 'Photo' };
  }
  return null;
}

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
