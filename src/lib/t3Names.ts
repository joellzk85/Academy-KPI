// Reading HR's name list for the T3 attendance form (2026-10-21; Joel: "HR will pass us a name list, which we update
// into the T3 form ... upload the name list here and it auto fills the T3 form"). HR sends Excel, CSV, Word or PDF.
// Every format is turned into rows of cells, then the same steps find the columns (by their headings, or by what's
// in them when there are no headings) and make one trainee per row. PDF and Word are best effort, so Admin always
// sees the names in a table and can fix them before the form is made (T3Maker.tsx).
// Sex and citizenship left out by HR are worked out from a Malaysian IC: 12 digits = Malaysian, last digit odd = male.

import { extOf } from './proposals';
import { appUpdatedError, isOldTabError } from './oldTab';

export interface Trainee {
  name: string;
  employer: string;
  ic: string;
  citizenship: string;
  sex: string;
}

export const blankTrainee = (employer = ''): Trainee => ({ name: '', employer, ic: '', citizenship: '', sex: '' });

export const NAME_LIST_ACCEPT = '.xlsx,.csv,.docx,.pdf';
export const NAME_LIST_KINDS = 'Excel (.xlsx), CSV, Word (.docx) or PDF';

// ---------- IC, sex, citizenship ----------

const digits = (s: string) => s.replace(/\D/g, '');

// A Malaysian IC (MyKad) number: 12 digits whose first six are a date (YYMMDD).
export function isMyKad(ic: string): boolean {
  const d = digits(ic);
  if (d.length !== 12 || digits(ic).length !== ic.replace(/[\s-]/g, '').length) return false;
  const mm = Number(d.slice(2, 4)), dd = Number(d.slice(4, 6));
  return mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31;
}

// "900101-14-5678" for a MyKad (however it was typed); anything else (passports) as typed.
// Excel often drops an IC's leading zero (born 2000 to 2009), so 11 digits get it back.
export function formatIc(raw: string): string {
  const t = String(raw ?? '').trim();
  let d = digits(t);
  const onlyDigits = d.length === t.replace(/[\s-]/g, '').length;
  if (onlyDigits && d.length === 11) d = `0${d}`;
  if (onlyDigits && d.length === 12 && isMyKad(d)) return `${d.slice(0, 6)}-${d.slice(6, 8)}-${d.slice(8)}`;
  return t;
}

export function sexFromIc(ic: string): string {
  return isMyKad(ic) ? (Number(digits(ic).slice(-1)) % 2 ? 'Male' : 'Female') : '';
}

export function normaliseSex(raw: string): string {
  const t = raw.trim().toLowerCase().replace(/\.$/, '');
  if (['m', 'male', 'lelaki', 'l', 'man', 'boy'].includes(t)) return 'Male';
  if (['f', 'female', 'perempuan', 'p', 'woman', 'girl', 'w'].includes(t)) return 'Female';
  return raw.trim();
}

export function normaliseCitizenship(raw: string): string {
  const t = raw.trim().toLowerCase();
  if (!t) return '';
  if (/^(bukan|non|not|foreign|asing)/.test(t)) return 'Non-Malaysian';
  if (/^(malaysia|malaysian|warganegara|citizen|m'sia|msia|my|yes|ya)$/.test(t)) return 'Malaysian';
  return raw.trim();
}

// Fills in what can be worked out, and tidies the IC.
export function completeTrainee(t: Trainee): Trainee {
  const ic = formatIc(t.ic.replace(/\s+/g, ' '));
  return {
    // HR's own numbering ("39. MUHAMMAD ...") is dropped; the form has its own No. column.
    name: t.name.replace(/\s+/g, ' ').trim().replace(/^\d{1,3}\s*[.)]\s*(?=[a-z])/i, ''),
    employer: t.employer.replace(/\s+/g, ' ').trim(),
    ic,
    sex: normaliseSex(t.sex) || sexFromIc(ic),
    citizenship: normaliseCitizenship(t.citizenship) || (isMyKad(ic) ? 'Malaysian' : ''),
  };
}

// ---------- rows of cells → trainees ----------

type Col = 'no' | 'name' | 'employer' | 'ic' | 'citizenship' | 'sex';

// What a heading means. Employer is checked before name ("Name of employer", "Company name").
export function headingOf(cell: string): Col | null {
  const t = cell.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t || t.length > 60) return null;
  if (/employer|company|syarikat|majikan|organi[sz]ation/.test(t)) return 'employer';
  if (/citizen|nationality|warganegara|kewarganegaraan|bangsa/.test(t)) return 'citizenship';
  if (/^(sex|gender|jantina)\b|\bsex\b|\bgender\b|jantina/.test(t)) return 'sex';
  if (/\bnric\b|\bic\b|i\/c|mykad|kad pengenalan|k\/p|passport|pasport|identity|\bid no|\bic no/.test(t)) return 'ic';
  if (/name|nama|trainee|participant|peserta|staff|employee|pekerja/.test(t)) return 'name';
  if (/^(no|no\.|bil|bil\.|#|num|number|item)$/.test(t)) return 'no';
  return null;
}

const IC_LIKE = /^\s*\d{6}\s*-?\s*\d{2}\s*-?\s*\d{4}\s*$|^\s*\d{11,12}\s*$/;
const SEX_LIKE = /^(m|f|male|female|lelaki|perempuan)\.?$/i;
const CIT_LIKE = /^(malaysian?|warganegara|bukan warganegara|non[- ]?malaysian|foreigner)$/i;

// Which column holds what. Headings first (the row with at least two known headings, near the top);
// otherwise by what's in the cells. Returns the heading row's index (-1 when there are no headings).
export function findColumns(rows: string[][]): { map: Partial<Record<Col, number>>; headerRow: number } {
  const headings = rows.slice(0, 25).map(row => {
    const map: Partial<Record<Col, number>> = {};
    row.forEach((c, i) => {
      const h = headingOf(c);
      if (h && map[h] === undefined) map[h] = i;
    });
    return { map, known: Object.keys(map).filter(k => k !== 'no').length, cells: row.filter(Boolean).length };
  });
  // A heading row: a name heading and at least one more ("Nama", "No. K/P"). A title above the table
  // ("SENARAI PESERTA LATIHAN") has only one cell, so it isn't taken.
  const full = headings.findIndex(h => h.map.name !== undefined && h.known >= 2);
  if (full >= 0) return { map: headings[full].map, headerRow: full };
  // Only a name heading: take it, and guess the rest from the cells below.
  const nameOnly = headings.findIndex(h => h.map.name !== undefined && h.cells >= 2);
  if (nameOnly >= 0) return { map: { ...guessColumns(rows.slice(nameOnly + 1)), ...headings[nameOnly].map }, headerRow: nameOnly };
  return { map: guessColumns(rows), headerRow: -1 };
}

function guessColumns(rows: string[][]): Partial<Record<Col, number>> {
  const width = Math.max(0, ...rows.map(r => r.length));
  const score = (i: number, test: (s: string) => boolean) => rows.filter(r => r[i] && test(r[i].trim())).length;
  const map: Partial<Record<Col, number>> = {};
  const used = new Set<number>();
  const pick = (col: Col, test: (s: string) => boolean) => {
    let best = -1, bestN = 0;
    for (let i = 0; i < width; i++) if (!used.has(i)) { const n = score(i, test); if (n > bestN) { best = i; bestN = n; } }
    if (best >= 0 && bestN >= Math.max(1, rows.length * 0.3)) { map[col] = best; used.add(best); }
  };
  pick('ic', s => IC_LIKE.test(s));
  pick('sex', s => SEX_LIKE.test(s));
  pick('citizenship', s => CIT_LIKE.test(s));
  pick('no', s => /^\d{1,3}\.?$/.test(s));
  // The name: the column with the most letters; the employer: the next one, if it repeats (one company for many).
  const letters = (i: number) => rows.reduce((n, r) => n + ((r[i] || '').match(/[a-z]/gi)?.length || 0), 0);
  const textCols = Array.from({ length: width }, (_, i) => i).filter(i => !used.has(i) && letters(i) > 0).sort((a, b) => letters(b) - letters(a));
  const distinct = (i: number) => new Set(rows.map(r => (r[i] || '').trim().toLowerCase()).filter(Boolean)).size;
  const repeating = textCols.filter(i => distinct(i) <= Math.max(1, rows.length / 3));
  const nameCol = textCols.find(i => !repeating.includes(i)) ?? textCols[0];
  if (nameCol !== undefined) { map.name = nameCol; used.add(nameCol); }
  const emp = repeating.find(i => !used.has(i));
  if (emp !== undefined) map.employer = emp;
  return map;
}

// Rows of cells → trainees. Lines without a name (blank lines, totals, notes) are skipped.
// `wrapped`: in a PDF a long name runs onto a second line; a line with text but no IC or number then
// belongs to the trainee above.
// IC numbers in a piece of text ("900101-14-5678" or "900101145678").
const IC_TOKENS = /\d{6}\s*-\s*\d{2}\s*-\s*\d{4}|(?<!\d)\d{11,12}(?!\d)/g;
export const icCount = (s: string) => (s.match(IC_TOKENS) || []).length;

// One row holding several people (Joel, 2026-10-21: HR typed 38 numbered names in one cell and their 38 ICs in
// the next): one trainee per IC. Names are split by line, else by their numbering ("1. ALI 2. ABU");
// a cell with one value (the employer) is copied to everyone; a single sex or citizenship is left for the IC to decide.
export function splitStacked(t: Trainee): Trainee[] {
  const ics = t.ic.match(IC_TOKENS) || [];
  const n = ics.length;
  if (n < 2) return [t];
  const lines = (s: string) => s.split(/\n+/).map(x => x.trim()).filter(Boolean);
  const icLines = lines(t.ic);
  const icsEach = icLines.length === n && icLines.every(l => icCount(l) === 1) ? icLines : ics;
  const numbered = (s: string) => s.split(/(?:^|\s)\d{1,3}\s*[.)]\s+(?=[a-z'@])/i).map(x => x.trim()).filter(Boolean);
  const names = [lines(t.name), numbered(t.name.replace(/\n/g, ' '))].find(l => l.length === n)
    || numbered(t.name.replace(/\n/g, ' '));
  const spread = (s: string, copy: boolean) => {
    const l = lines(s);
    if (l.length === n) return l;
    const words = s.split(/\s+/).filter(Boolean);
    if (words.length === n) return words;
    return Array(n).fill(copy ? s.replace(/\s+/g, ' ').trim() : '');
  };
  const employers = spread(t.employer, true), sexes = spread(t.sex, false), cits = spread(t.citizenship, false);
  return icsEach.map((ic, i) => ({ name: names[i] || '', employer: employers[i], ic, sex: sexes[i], citizenship: cits[i] }));
}

export function rowsToTrainees(rows: string[][], wrapped = false): Trainee[] {
  // Line breaks inside a cell are kept for now: they can separate several people typed in one cell.
  const clean = rows.map(r => r.map(c => String(c ?? '').replace(/[^\S\n]+/g, ' ').replace(/ *\n[\s]*/g, '\n').trim())).filter(r => r.some(Boolean));
  const { map, headerRow } = findColumns(clean);
  if (map.name === undefined) return [];
  const get = (r: string[], c: Col) => (map[c] !== undefined ? r[map[c]!] || '' : '');
  const out: Trainee[] = [];
  for (const r of clean.slice(headerRow + 1)) {
    const name = get(r, 'name');
    if (headingOf(name) === 'name' && !get(r, 'ic')) continue;                    // a repeated heading row (next page)
    const looksNew = !!get(r, 'ic') || /^\d+\.?$/.test(get(r, 'no')) || !wrapped || !out.length;
    if (!looksNew) {
      const last = out[out.length - 1];
      if (name) last.name = `${last.name} ${name}`;
      if (get(r, 'employer')) last.employer = `${last.employer} ${get(r, 'employer')}`;
      continue;
    }
    if (!name || !/[a-z]/i.test(name)) continue;
    if (/^(total|jumlah|grand total)\b/i.test(name)) continue;
    out.push({ name, employer: get(r, 'employer'), ic: get(r, 'ic'), citizenship: get(r, 'citizenship'), sex: get(r, 'sex') });
  }
  return out.flatMap(splitStacked).map(completeTrainee);
}

// ---------- reading the files ----------

// One CSV (or tab / semicolon separated) text → rows of cells. Handles quotes and commas inside quotes.
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, '');
  const first = t.split(/\r?\n/, 1)[0] || '';
  const sep = [',', ';', '\t'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (quoted) {
      if (ch === '"' && t[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

async function excelRows(buf: ArrayBuffer): Promise<string[][]> {
  const ExcelJS: any = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  // The sheet that gives the most trainees (HR files sometimes have a cover sheet first).
  let best: string[][] = [], bestN = -1;
  wb.eachSheet((ws: any) => {
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row: any) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell: any, col: number) => {
        const v = cell.value;
        // A long number (an IC typed as a number) as plain digits, not "9.01E+11".
        cells[col - 1] = typeof v === 'number' && Number.isInteger(v) ? String(v) : String(cell.text ?? '');
      });
      rows.push(Array.from(cells, c => c ?? ''));
    });
    const n = rowsToTrainees(rows).length;
    if (n > bestN) { best = rows; bestN = n; }
  });
  return best;
}

async function wordRows(buf: ArrayBuffer): Promise<{ rows: string[][]; table: boolean }> {
  // @ts-ignore: the one-file browser build has no types of its own
  const mammoth: any = await import('mammoth/mammoth.browser.min.js');
  const { value: html } = await (mammoth.default || mammoth).convertToHtml({ arrayBuffer: buf });
  const page = new DOMParser().parseFromString(html, 'text/html');
  const tables = Array.from(page.querySelectorAll('table'));
  const rowsOf = (t: Element) => Array.from(t.querySelectorAll('tr')).map(tr => Array.from(tr.children).map(td => {
    // Each paragraph in a cell on its own line (several people can be typed in one cell).
    const paras = Array.from(td.querySelectorAll(td.querySelector('p') ? 'p' : 'li'));
    return (paras.length ? paras.map(p => p.textContent || '').join('\n') : td.textContent || '').trim();
  }));
  if (tables.length) {
    // All tables one after the other (a long list is often split over pages), the heading rows are skipped later.
    const best = tables.map(rowsOf).sort((a, b) => rowsToTrainees(b).length - rowsToTrainees(a).length)[0];
    const same = tables.map(rowsOf).filter(r => r[0]?.length === best[0]?.length);
    return { rows: same.flat(), table: true };
  }
  // No table: one name per line ("1. Ali bin Abu  900101-14-5678").
  return { rows: Array.from(page.querySelectorAll('p')).map(p => lineCells(p.textContent || '')), table: false };
}

// A line of plain text split into cells: tabs, or two or more spaces, or an IC in the middle.
function lineCells(line: string): string[] {
  let cells = line.split(/\t| {2,}/).map(s => s.trim()).filter(Boolean);
  if (cells.length === 1) {
    const m = line.match(/^\s*(\d{1,3}[.)]?)?\s*(.*?)\s+(\d{6}-?\d{2}-?\d{4})\s*(.*)$/);
    if (m) cells = [m[1] || '', m[2], m[3], m[4]].map(s => s.trim());
  }
  return cells;
}

let pdfjsLoad: Promise<any> | null = null;
function loadPdfjs() {
  if (!pdfjsLoad) {
    pdfjsLoad = Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([lib, worker]) => {
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return lib;
    }).catch(e => { pdfjsLoad = null; throw isOldTabError(e) ? appUpdatedError() : e; });
  }
  return pdfjsLoad;
}

// A PDF's words → lines (by height on the page) → table rows → cells.
// - Lines close together form one block: a table row whose cells run over several lines (a long name), or the
//   heading row ("Name of / Employer(s)"). Rows are further apart. A block with more than one IC is a tight list
//   of one-line rows, so its lines stay separate rows.
// - The columns come from the heading block: text pieces that sit over each other are one column.
// - Each piece of text goes under the column it starts below, so a blank cell doesn't shift the others.
// - The table ends at the certification or notes under it ("I certify ...", "Note").
type Piece = { x: number; y: number; w: number; h: number; s: string };
type Span = { x: number; end: number; text: string };

const joinPieces = (list: Piece[]) => {
  let out = '', end = -Infinity;
  for (const it of [...list].sort((a, b) => b.y - a.y || a.x - b.x)) {
    out += (out && (it.x - end > it.h * 0.15 || it.x < end - 1) ? ' ' : '') + it.s;
    end = it.x + it.w;
  }
  return out;
};

// Pieces of one line → spans of text (a gap wider than about a letter starts a new span).
const spansOf = (line: Piece[]): Span[] => {
  const spans: Span[] = [];
  for (const it of [...line].sort((a, b) => a.x - b.x)) {
    const last = spans[spans.length - 1];
    if (last && it.x - last.end < it.h * 0.9) { last.text += (it.x - last.end > it.h * 0.15 ? ' ' : '') + it.s; last.end = it.x + it.w; }
    else spans.push({ x: it.x, end: it.x + it.w, text: it.s });
  }
  return spans;
};

const END_OF_TABLE = /\bi certify\b|\bcertified by\b|\bprepared by\b|\bverified by\b|\bdisahkan\b|\bdisediakan\b|^\*?\s*note\b|^\*?\s*nota\b/i;

async function pdfRows(buf: ArrayBuffer): Promise<string[][]> {
  const pdfjs = await loadPdfjs();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const blocks: Piece[][][] = [];                 // blocks of lines of pieces, top to bottom, page after page
  for (let p = 1; p <= pdf.numPages; p++) {
    const tc = await (await pdf.getPage(p)).getTextContent();
    const items: Piece[] = tc.items.filter((i: any) => i.str && i.str.trim())
      .map((i: any) => ({ x: i.transform[4], y: i.transform[5], w: i.width, h: Math.abs(i.transform[3]) || 10, s: i.str }));
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const lines: Piece[][] = [];
    for (const it of items) {
      const line = lines.find(l => Math.abs(l[0].y - it.y) < Math.max(2, it.h * 0.4));
      if (line) line.push(it); else lines.push([it]);
    }
    let block: Piece[][] = [];
    lines.forEach((l, i) => {
      const gap = i ? lines[i - 1][0].y - l[0].y : 0;
      if (i && gap > Math.max(...l.map(x => x.h)) * 1.6) { blocks.push(block); block = []; }
      block.push(l);
    });
    if (block.length) blocks.push(block);
  }
  if (!blocks.length) return [];

  // The heading block: the one whose text (all its lines together) reads as a heading row.
  const flat = blocks.map(b => b.flatMap(l => spansOf(l)));
  const headIdx = flat.findIndex(spans => findColumns([spans.map(s => s.text)]).headerRow === 0
    || findColumns([mergeColumns(spans).map(c => c.text)]).headerRow === 0);
  if (headIdx < 0) return blocks.flatMap(b => b.map(l => spansOf(l).map(s => s.text)));
  const heads = mergeColumns(flat[headIdx]);
  const starts = heads.map((h, i) => (i === 0 ? -Infinity : (heads[i - 1].end + h.x) / 2));
  const toRow = (list: Piece[]) => {
    const cols: Piece[][] = heads.map(() => []);
    for (const it of list) {
      let col = 0;
      starts.forEach((s, i) => { if (it.x + 2 >= s) col = i; });
      cols[col].push(it);
    }
    return cols.map(joinPieces);
  };

  const rows: string[][] = [heads.map(h => h.text)];
  for (const b of blocks.slice(headIdx + 1)) {
    if (END_OF_TABLE.test(b.map(l => joinPieces(l)).join(' ').trim())) break;
    const ics = b.filter(l => l.some(it => IC_LIKE.test(it.s) || /\d{6}-\d{2}-\d{4}/.test(it.s))).length;
    if (ics > 1) b.forEach(l => rows.push(toRow(l)));
    else rows.push(toRow(b.flat()));
  }
  return rows;
}

// Heading pieces that sit over each other (on different lines) are one column; returned left to right.
function mergeColumns(spans: Span[]): Span[] {
  const cols: Span[] = [];
  for (const s of [...spans].sort((a, b) => a.x - b.x)) {
    const c = cols.find(c => s.x < c.end - 1 && s.end > c.x + 1);
    if (c) { c.text = `${c.text} ${s.text}`; c.x = Math.min(c.x, s.x); c.end = Math.max(c.end, s.end); }
    else cols.push({ ...s });
  }
  return cols.sort((a, b) => a.x - b.x);
}

// The whole step: a file → trainees, or a plain reason why not.
export async function readNameList(file: File): Promise<Trainee[]> {
  const ext = extOf(file.name);
  const buf = await file.arrayBuffer();
  let rows: string[][] = [];
  let wrapped = false;
  try {
    if (ext === 'xlsx') rows = await excelRows(buf);
    else if (ext === 'csv' || ext === 'txt') rows = parseCsv(new TextDecoder().decode(buf));
    else if (ext === 'docx') rows = (await wordRows(buf)).rows;
    else if (ext === 'pdf') { rows = await pdfRows(buf); wrapped = true; }
    else if (ext === 'xls' || ext === 'doc') throw new Error(`"${file.name}" is an old ${ext === 'xls' ? 'Excel' : 'Word'} file. Open it and use Save as → ${ext === 'xls' ? 'Excel Workbook (.xlsx)' : 'Word Document (.docx)'}, then choose the new file.`);
    else throw new Error(`"${file.name}" isn't a name list the CRM can read. Use ${NAME_LIST_KINDS}.`);
  } catch (e: any) {
    if (e?.appUpdated || isOldTabError(e)) throw appUpdatedError();
    if (e?.message?.startsWith(`"${file.name}"`)) throw e;
    throw new Error(`Couldn't read "${file.name}". It may be damaged or password protected.`);
  }
  const list = rowsToTrainees(rows, wrapped);
  if (!list.length) {
    throw new Error(ext === 'pdf' && !rows.length
      ? `"${file.name}" looks like a scan or photo, so there's no text to read. Ask HR for the Excel list, or add the names by hand.`
      : `No names found in "${file.name}". Check the list has a "Name" column, or add the names by hand.`);
  }
  return list;
}
