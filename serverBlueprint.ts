// Import from the Blueprint spreadsheet (2026-10-20): the server only reads the Excel file Management picked
// into plain rows. Working out what to add or update, and writing it, happens in the browser
// (src/lib/blueprint.ts, BlueprintImport.tsx), with Management's own database rights. Nothing is stored here.

import express from 'express';
import type { Express } from 'express';
import ExcelJS from 'exceljs';
import { UserError, callerFrom, route } from './serverAuth';
import type { BlueprintRows, Cell } from './src/lib/blueprint';

const MAX_ROWS = 3000;
const MAX_COLS = 40;

function cellValue(v: any): Cell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    if ('result' in v) return cellValue(v.result);                       // a formula: its last worked-out value
    if ('error' in v) return null;                                         // #DIV/0! and the like
    if (Array.isArray(v.richText)) return v.richText.map((r: any) => r.text || '').join('');
    if ('hyperlink' in v || 'text' in v) {
      const text = typeof v.text === 'object' ? String(cellValue(v.text) ?? '') : String(v.text ?? '');
      const link = String(v.hyperlink || '');
      return link && !text.includes(link) ? [text.trim(), link].filter(Boolean).join('\n') : text;
    }
    if ('formula' in v || 'sharedFormula' in v) return null;
  }
  return String(v);
}

function sheetRows(ws: ExcelJS.Worksheet | undefined): Cell[][] {
  if (!ws) return [];
  const out: Cell[][] = [];
  const last = Math.min(ws.rowCount, MAX_ROWS);
  const cols = Math.min(ws.columnCount, MAX_COLS);
  for (let r = 1; r <= last; r++) {
    const row = ws.getRow(r);
    const vals: Cell[] = [];
    for (let c = 1; c <= cols; c++) vals.push(cellValue(row.getCell(c).value));
    out.push(vals);
  }
  return out;
}

export async function readBlueprint(file: Buffer): Promise<{ rows: BlueprintRows; sheets: string[] }> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(file as any);
  } catch {
    throw new UserError(400, 'bad-file', "That file couldn't be read as an Excel file (.xlsx). In Google Sheets use File → Download → Microsoft Excel (.xlsx), then choose that file.");
  }
  const find = (re: RegExp) => wb.worksheets.find(ws => re.test(ws.name));
  const rows: BlueprintRows = {
    training: sheetRows(find(/training/i)),
    venues: sheetRows(find(/venue/i)),
    sales: sheetRows(find(/sales/i)),
  };
  if (!rows.training.length && !rows.venues.length && !rows.sales.length) {
    throw new UserError(400, 'no-sheets', 'This file has no "List of Training", "Venue List" or "Sales" sheet. Check you picked the Blueprint file.');
  }
  return { rows, sheets: wb.worksheets.map(ws => ws.name) };
}

export function registerBlueprintRoutes(app: Express) {
  // Registered before the general JSON reader (server.ts): the file is bigger than its 100 KB limit.
  app.post('/api/blueprint/read', express.json({ limit: '15mb' }), route(async req => {
    const caller = await callerFrom(req);
    if (caller.role !== 'management') throw new UserError(403, 'management-only', 'Only Management can import from the Blueprint spreadsheet.');
    const b64 = String(req.body?.file || '');
    if (!b64) throw new UserError(400, 'no-file', 'Choose the Blueprint Excel file first.');
    return readBlueprint(Buffer.from(b64, 'base64'));
  }));
}
