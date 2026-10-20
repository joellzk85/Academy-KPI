// NEXT Academy CRM: the data backup, run on the server (2026-10-17).
//
// How it works, in plain terms:
// - The server reads every list in the database (never passwords or login data) and turns each into a table
//   (src/lib/backup.ts).
// - Google Sheet copy: Admin or Management makes one blank Google Sheet and shares it (Editor) with the CRM
//   server's own Google address (the App Hosting service account, the same one the calendar uses). Each run
//   replaces the sheet's tabs with fresh data; Google Sheets' own version history keeps the earlier days.
//   It runs once a Malaysian day, the first time Admin or Management opens the CRM, or any time with "Back up now".
// - Excel download: the same tables as an .xlsx file, built here and sent straight to the browser.
// - Settings and the last result are in config/backup_settings, which only the server writes.
// - Proposal files (2026-10-18): the file records are a normal list ("Proposal files" tab); the files themselves
//   download as one ZIP (/api/backup/proposals), one folder per deal. Since 2026-10-19 the ZIP also has the checklist
//   step files (checklist_files: JD14, T3, ...), in a sub-folder per step.

import type { Express, Request, Response as ExpressResponse } from 'express';
import ExcelJS from 'exceljs';
import archiver from 'archiver';
import { getApps } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import firebaseConfig from './firebase-applet-config.json';
import { safeFileName } from './src/lib/proposals';
import { admin, UserError, callerFrom, route } from './serverAuth';
import {
  INFO_TAB, SKIP_CONFIG_DOCS, Table, infoTable, malaysiaDay, orderCollections, sheetIdFrom, toTable, uniqueTabs,
} from './src/lib/backup';
import { readMoneySettings } from './src/lib/money';
import { projectPLBackupRows, projectRows } from './src/lib/projectPL';

const API = 'https://sheets.googleapis.com/v4/spreadsheets';
const METADATA = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const CHUNK_ROWS = 2000;
const CHUNK_BYTES = 4_000_000;

// ---------- Who may use it: Admin and Management ----------
async function staffFrom(req: Request) {
  const caller = await callerFrom(req);
  if (caller.role !== 'admin' && caller.role !== 'management') throw new UserError(403, 'staff-only', 'Only Admin and Management can use the backup.');
  return caller;
}

async function nameOf(memberId: string): Promise<string> {
  const { db } = admin();
  const snap = await db.collection('team').doc(memberId).get();
  return String(snap.data()?.name || memberId);
}

// ---------- The server's own Google access ----------
let cachedToken: { token: string; expires: number } | null = null;

async function metadata(path: string): Promise<Response> {
  try {
    return await fetch(`${METADATA}${path}`, { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(4000) });
  } catch {
    throw new UserError(503, 'backup-not-live', 'The Google Sheet backup only works on the live CRM website, not on a test copy. The Excel download works anywhere.');
  }
}

async function serverToken(): Promise<string> {
  if (cachedToken && cachedToken.expires > Date.now() + 60_000) return cachedToken.token;
  const res = await metadata(`/token?scopes=${encodeURIComponent(SCOPE)}`);
  if (!res.ok) throw new UserError(503, 'backup-not-live', 'The CRM server could not get Google access. Try again in a minute.');
  const data: any = await res.json();
  cachedToken = { token: data.access_token, expires: Date.now() + (Number(data.expires_in) || 300) * 1000 };
  return cachedToken.token;
}

async function serverEmail(): Promise<string> {
  try {
    const res = await metadata('/email');
    return res.ok ? (await res.text()).trim() : '';
  } catch {
    return '';
  }
}

// Calls Google Sheets and turns its errors into plain language.
async function sheets(path: string, body?: any): Promise<any> {
  const token = await serverToken();
  const res = await fetch(`${API}/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (res.ok) return data;
  const text = JSON.stringify(data || {});
  console.error('[backup] Google said', res.status, text.slice(0, 500));
  if (/accessNotConfigured|SERVICE_DISABLED|has not been used|is disabled/i.test(text)) {
    throw new UserError(503, 'sheets-api-off', "The Google Sheets API isn't switched on yet for the CRM's Google Cloud project (setup step 1).");
  }
  if (res.status === 404 || res.status === 403) {
    throw new UserError(503, 'sheet-not-shared',
      "The CRM can't open that Google Sheet. Check the link, and that the sheet is shared with the CRM's address as Editor (setup step 2).");
  }
  // Show Google's own reason, so a problem can be fixed from a screenshot.
  const reason = String(data?.error?.message || '').trim().replace(/\.+$/, '').slice(0, 300);
  throw new UserError(502, 'sheets-error', `Google Sheets didn't accept the backup (${res.status})${reason ? `: ${reason}` : ''}. Try again in a minute, or send a screenshot of this message.`);
}

// ---------- Settings ----------
type BackupSettings = {
  sheetId?: string; sheetName?: string; tabs?: string[];
  lastBackupAt?: number; lastBackupDay?: string; lastBackupBy?: string; lastError?: string; lastErrorAt?: number; lastSummary?: string;
};

async function readSettings(): Promise<BackupSettings> {
  const { db } = admin();
  return ((await db.collection('config').doc('backup_settings').get()).data() || {}) as BackupSettings;
}

async function saveSettings(patch: BackupSettings) {
  const { db } = admin();
  await db.collection('config').doc('backup_settings').set(patch, { merge: true });
}

// ---------- Read the whole database as tables ----------
async function readAllTables(): Promise<Table[]> {
  const { db } = admin();
  const ids = orderCollections((await db.listCollections()).map(c => c.id));
  const raw: Record<string, { id: string; data: Record<string, any> }[]> = {};
  const tables = await Promise.all(ids.map(async id => {
    const snap = await db.collection(id).get();
    const docs = snap.docs
      .filter(d => !(id === 'config' && SKIP_CONFIG_DOCS.includes(d.id)))
      .map(d => ({ id: d.id, data: d.data() }));
    raw[id] = docs;
    return toTable(id, docs);
  }));
  // The ready-made Project P&L goes straight after Deals.
  const at = tables.findIndex(t => t.collectionId === 'pipelines') + 1;
  tables.splice(at, 0, projectPLTable(raw));
  return uniqueTabs(tables);
}

// "Project P&L" tab: one line per won deal, worked out from the lists just read, the same way as
// Management → Project P&L (src/lib/projectPL.ts), so the backup is readable without the CRM.
function projectPLTable(raw: Record<string, { id: string; data: Record<string, any> }[]>): Table {
  const list = (id: string): any[] => (raw[id] || []).map(d => ({ ...d.data, id: d.id }));
  const settings = readMoneySettings((raw.config || []).find(d => d.id === 'money_settings')?.data);
  const plDocs = Object.fromEntries((raw.project_pl || []).map(d => [d.id, d.data]));
  // Deals Management deleted (and their money) are left out, as on the screen.
  const live = (id: string) => list(id).filter(r => r.deleted !== true && r.dealDeleted !== true);
  const rows = projectRows(live('pipelines'), live('money_in'), live('money_out'), settings, malaysiaDay(Date.now()),
    { quotes: list('quotations'), plDocs });
  const clients = list('clients');
  const team = list('team');
  const table = projectPLBackupRows(rows,
    p => clients.find(c => c.id === p.clientId)?.companyName || p.client || '',
    id => team.find(m => m.id === id)?.name || '',
    p => clients.find(c => c.id === p.clientId)?.employerName || '');
  return { collectionId: 'project_pl_report', tab: 'Project P&L', rows: table, count: rows.length };
}

// ---------- Write to the Google Sheet ----------
const a1 = (tab: string) => `'${tab.replace(/'/g, "''")}'`;

export async function writeToSheet(sheetId: string, tables: Table[], info: (string | number)[][], oldTabs: string[]) {
  const meta = await sheets(`${sheetId}?fields=sheets.properties(sheetId,title)`);
  // Tab names are matched ignoring upper and lower case, as Google does.
  const existing = new Map<string, number>();
  (meta?.sheets || []).forEach((s: any) => existing.set(String(s.properties.title).toLowerCase(), s.properties.sheetId));
  const idOf = (tab: string) => existing.get(tab.toLowerCase());

  // What each tab should hold. Tabs from an earlier backup whose list is now empty say so (so old data doesn't linger).
  const wanted: { tab: string; rows: any[][] }[] = [{ tab: INFO_TAB, rows: info }, ...tables.map(t => ({ tab: t.tab, rows: t.rows }))];
  oldTabs.filter(t => !wanted.some(w => w.tab.toLowerCase() === t.toLowerCase())).forEach(tab => wanted.push({ tab, rows: [['No records at this backup.']] }));

  // 1) Add missing tabs.
  const add = wanted.filter(w => idOf(w.tab) === undefined).map(w => ({ addSheet: { properties: { title: w.tab } } }));
  if (add.length) {
    const r = await sheets(`${sheetId}:batchUpdate`, { requests: add });
    (r?.replies || []).forEach((rep: any) => existing.set(String(rep.addSheet.properties.title).toLowerCase(), rep.addSheet.properties.sheetId));
  }
  // 2) Size every tab to its data (this also removes leftover rows), freeze the header row, put "Backup info" first.
  const requests: any[] = wanted.map((w, i) => ({
    updateSheetProperties: {
      properties: {
        sheetId: idOf(w.tab), title: w.tab, index: i,
        gridProperties: {
          rowCount: Math.max(w.rows.length, 2),
          columnCount: Math.max(1, ...w.rows.map(r => r.length)),
          frozenRowCount: w.tab === INFO_TAB ? 0 : 1,
        },
      },
      fields: 'title,index,gridProperties.rowCount,gridProperties.columnCount,gridProperties.frozenRowCount',
    },
  }));
  await sheets(`${sheetId}:batchUpdate`, { requests });
  // 3) Clear, then write the values (in pieces, so big lists stay within Google's limits).
  await sheets(`${sheetId}/values:batchClear`, { ranges: wanted.map(w => a1(w.tab)) });
  let batch: any[] = [], bytes = 0;
  const flush = async () => {
    if (!batch.length) return;
    await sheets(`${sheetId}/values:batchUpdate`, { valueInputOption: 'RAW', data: batch });
    batch = []; bytes = 0;
  };
  for (const w of wanted) {
    for (let start = 0; start < w.rows.length; start += CHUNK_ROWS) {
      const values = w.rows.slice(start, start + CHUNK_ROWS);
      const size = JSON.stringify(values).length;
      if (bytes + size > CHUNK_BYTES) await flush();
      batch.push({ range: `${a1(w.tab)}!A${start + 1}`, values });
      bytes += size;
    }
  }
  await flush();
  return wanted.map(w => w.tab).filter(t => t !== INFO_TAB);
}

let running: Promise<any> | null = null;

async function runBackup(memberId: string, reason: string) {
  const s = await readSettings();
  if (!s.sheetId) throw new UserError(400, 'backup-not-set-up', 'Connect a Google Sheet first (Set up, below).');
  const now = Date.now();
  const byName = await nameOf(memberId);
  const tables = await readAllTables();
  const info = infoTable(tables, new Date(now).toISOString(), byName, reason);
  const tabs = await writeToSheet(s.sheetId, tables, info, s.tabs || []);
  const records = tables.reduce((n, t) => n + t.count, 0);
  const summary = `${records} records in ${tables.length} lists`;
  await saveSettings({ tabs, lastBackupAt: now, lastBackupDay: malaysiaDay(now), lastBackupBy: byName, lastError: '', lastSummary: summary });
  return { summary };
}

// ---------- Routes ----------
export function registerBackupRoutes(app: Express) {
  // Is the backup set up, and how did the last one go? Includes the address to share the sheet with.
  app.post('/api/backup/status', route(async req => {
    await staffFrom(req);
    const s = await readSettings();
    return {
      configured: !!s.sheetId, sheetId: s.sheetId || '', sheetName: s.sheetName || '',
      lastBackupAt: s.lastBackupAt || 0, lastBackupBy: s.lastBackupBy || '', lastSummary: s.lastSummary || '',
      lastError: s.lastError || '', lastErrorAt: s.lastErrorAt || 0,
      shareWith: await serverEmail(),
    };
  }));

  // Save the Google Sheet (a link or its ID); it's tested before it's saved. Blank = disconnect.
  app.post('/api/backup/settings', route(async req => {
    await staffFrom(req);
    const raw = String(req.body?.sheet || '').trim();
    if (!raw) {
      await saveSettings({ sheetId: '', sheetName: '', tabs: [], lastError: '' });
      return { configured: false };
    }
    const sheetId = sheetIdFrom(raw);
    if (!sheetId) throw new UserError(400, 'bad-sheet', "That doesn't look like a Google Sheet link. Copy the whole address from the sheet's browser tab.");
    const meta = await sheets(`${sheetId}?fields=properties.title`);
    const old = await readSettings();
    await saveSettings({ sheetId, sheetName: meta?.properties?.title || 'Google Sheet', lastError: '', ...(old.sheetId !== sheetId ? { tabs: [] } : {}) });
    return { configured: true, sheetName: meta?.properties?.title || 'Google Sheet' };
  }));

  // Back up to the Google Sheet. Without "force" it runs only once a Malaysian day (the app asks on opening).
  app.post('/api/backup/run', route(async req => {
    const caller = await staffFrom(req);
    const force = !!req.body?.force;
    const s = await readSettings();
    if (!s.sheetId) {
      if (!force) return { skipped: 'not-configured' };
      throw new UserError(400, 'backup-not-set-up', 'Connect a Google Sheet first (Set up, below).');
    }
    if (!force && s.lastBackupDay === malaysiaDay(Date.now())) return { skipped: 'done-today', summary: s.lastSummary || '' };
    // An automatic run that failed waits an hour before trying again, so a setup problem doesn't repeat on every page load.
    if (!force && s.lastErrorAt && Date.now() - s.lastErrorAt < 3600_000) return { skipped: 'recent-error' };
    if (running) return { skipped: 'running' };
    running = runBackup(caller.memberId, force ? 'Back up now (button)' : 'Daily automatic backup');
    try {
      return await running;
    } catch (err: any) {
      await saveSettings({ lastError: err?.message || 'Backup failed', lastErrorAt: Date.now() }).catch(() => {});
      throw err;
    } finally {
      running = null;
    }
  }));

  // Every proposal file and checklist step file (JD14, T3, ...) as one ZIP, one folder per deal ("Client - Programme").
  // Proposals sit in the deal's folder; checklist files in a sub-folder named after the step.
  app.post('/api/backup/proposals', async (req: Request, res: ExpressResponse) => {
    try {
      await staffFrom(req);
      const { db } = admin();
      const all = async (name: string) => (await db.collection(name).get()).docs.map(d => ({ ...d.data(), id: d.id }) as any);
      const [proposals, stepFiles, deals, clients, programmes] = await Promise.all([all('proposal_files'), all('checklist_files'), all('pipelines'), all('clients'), all('programmes')]);
      const files = [
        ...proposals.map((f: any) => ({ ...f, what: 'Proposal', sub: '' })),
        ...stepFiles.map((f: any) => ({ ...f, what: f.taskLabel || 'Checklist', sub: `${safeFileName(f.taskLabel || 'Checklist', 60)}/` })),
      ];
      if (!files.length) throw new UserError(404, 'no-proposals', 'There are no proposal or checklist files yet.');
      const bucket = getStorage(getApps()[0]).bucket((firebaseConfig as any).storageBucket);
      try {
        await bucket.file(files[0].path).getMetadata();
      } catch (e: any) {
        const code = Number(e?.code);
        console.error('[backup] storage check failed:', e?.message || e);
        if (code === 403 || /permission|forbidden/i.test(String(e?.message))) {
          throw new UserError(503, 'storage-no-access',
            "The CRM server isn't allowed to read the stored files yet. In Google Cloud → IAM, give firebase-app-hosting-compute@gen-lang-client-0779528352.iam.gserviceaccount.com the role \"Storage Object Viewer\", then try again.");
        }
        if (code !== 404) throw new UserError(503, 'storage-error', "The stored files couldn't be read. Try again in a minute.");
      }
      const folderOf = new Map<string, string>();
      const usedFolders = new Set<string>();
      const folder = (dealId: string) => {
        if (folderOf.has(dealId)) return folderOf.get(dealId)!;
        const d = deals.find((x: any) => x.id === dealId);
        const client = clients.find((c: any) => c.id === d?.clientId)?.companyName || d?.client || 'Deal removed';
        const prog = programmes.find((x: any) => x.id === d?.programmeId)?.name || d?.courseName || '';
        let name = safeFileName(`${client}${prog ? ` - ${prog}` : ''}`, 90);
        if (usedFolders.has(name.toLowerCase())) name = `${name} (${dealId.slice(-6)})`;
        usedFolders.add(name.toLowerCase());
        folderOf.set(dealId, name);
        return name;
      };
      const stamp = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 16).replace('T', '_').replace(':', '');
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="NEXT-Academy-files-${stamp}.zip"`);
      const zip = archiver('zip', { zlib: { level: 6 } });
      zip.on('warning', (w: any) => console.warn('[backup] zip warning:', w?.message || w));
      zip.on('error', (e: any) => { console.error('[backup] zip failed:', e); res.end(); });
      zip.pipe(res);
      const missing: string[] = [];
      const usedNames = new Set<string>();
      for (const f of files.sort((a: any, b: any) => String(a.at).localeCompare(String(b.at)))) {
        const file = bucket.file(String(f.path || ''));
        const [exists] = await file.exists().catch(() => [false]);
        if (!exists) { missing.push(`${folder(f.dealId)}/${f.sub}${f.name}`); continue; }
        let name = `${folder(f.dealId)}/${f.sub}${String(f.at || '').slice(0, 10)} ${safeFileName(f.name)}`;
        if (usedNames.has(name.toLowerCase())) name = name.replace(/(\.[^.\/]+)?$/, ` (${f.id.slice(-4)})$1`);
        usedNames.add(name.toLowerCase());
        zip.append(file.createReadStream(), { name, date: f.at ? new Date(f.at) : new Date() });
      }
      const rows = files.map((f: any) => [String(f.at || '').slice(0, 10), folder(f.dealId), f.what, f.name, f.byName || ''].join('\t'));
      const list = [
        `NEXT Academy CRM: proposal and checklist files, downloaded ${new Date().toISOString()}`, '',
        ['Date', 'Deal', 'What', 'File', 'Uploaded by'].join('\t'), ...rows,
        ...(missing.length ? ['', 'Missing from storage:', ...missing] : []),
      ].join('\r\n');
      zip.append(list, { name: 'List of files.txt' });
      await zip.finalize();
    } catch (err: any) {
      const e = err instanceof UserError ? err : new UserError(500, 'zip-failed', "The ZIP file couldn't be made. Try again in a minute.");
      if (!(err instanceof UserError)) console.error('[backup] proposals zip failed:', err);
      if (!res.headersSent) res.status(e.status).json({ ok: false, code: e.code, error: e.message });
      else res.end();
    }
  });

  // Download everything as an Excel file.
  app.post('/api/backup/download', async (req: Request, res: ExpressResponse) => {
    try {
      const caller = await staffFrom(req);
      const tables = await readAllTables();
      const now = new Date();
      const wb = new ExcelJS.Workbook();
      wb.creator = 'NEXT Academy CRM';
      wb.created = now;
      const used = new Set<string>();
      const sheetName = (name: string) => {   // Excel: at most 31 characters, and unique
        let n = name.slice(0, 31), i = 2;
        while (used.has(n.toLowerCase())) n = `${name.slice(0, 27)} (${i++})`;
        used.add(n.toLowerCase());
        return n;
      };
      const infoWs = wb.addWorksheet(sheetName(INFO_TAB));
      infoWs.addRows(infoTable(tables, now.toISOString(), await nameOf(caller.memberId), 'Excel download'));
      infoWs.getColumn(1).width = 28;
      for (const t of tables) {
        const ws = wb.addWorksheet(sheetName(t.tab), { views: [{ state: 'frozen', ySplit: 1 }] });
        // Excel allows 32,767 characters in a cell.
        ws.addRows(t.rows.map(r => r.map(v => (typeof v === 'string' && v.length > 32000 ? `${v.slice(0, 32000)} …(cut)` : v))));
        ws.getRow(1).font = { bold: true };
      }
      const stamp = new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 16).replace('T', '_').replace(':', '');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="NEXT-Academy-CRM-backup-${stamp}.xlsx"`);
      await wb.xlsx.write(res);
      res.end();
    } catch (err: any) {
      const e = err instanceof UserError ? err : new UserError(500, 'backup-failed', 'The backup file could not be made. Try again in a minute.');
      if (!(err instanceof UserError)) console.error('[backup] download failed:', err);
      if (!res.headersSent) res.status(e.status).json({ ok: false, code: e.code, error: e.message });
      else res.end();
    }
  });
}
