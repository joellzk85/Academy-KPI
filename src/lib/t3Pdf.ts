// Fills HRDC's T3 attendance list (PSMB/SBL-KHAS/T3/01) with the trainees (2026-10-21). Joel: "the form cannot
// change its design, it has to look exactly as it is, but we may add lines to accommodate more names"; "if the
// training is multiple days ... each name will sign day 1 and day 2 in the same row" (they used to add the day
// columns by hand).
// - The real form (public/forms/t3-sbl-khas.pdf) is the background: page 1 (5 trainees, the certification and the
//   notes) and the "continued" page (10 trainees), copied as often as the list needs.
// - Course title and dates of training are written on their lines; each trainee goes in the boxes.
// - More than one day: only the table is redrawn in the form's own style, with one signature column per day.
//   Citizenship and Sex get narrower to make room. Up to 5 days fit on one sheet; a longer training gets one
//   set of sheets per 5 days.
// The places below were measured from the form itself (in PDF points, from the bottom left of an A4 page).

import { formatDateRange } from './deals';
import { Trainee } from './t3Names';
import { appUpdatedError, isOldTabError } from './oldTab';

export const T3_TEMPLATE_URL = '/forms/t3-sbl-khas.pdf';
export const T3_DAYS_PER_SHEET = 5;

type Layout = { cols: number[]; head: [number, number]; rows: number[] };   // rows: the lines between trainees, top to bottom
const LINE = 0.6;
const FIRST: Layout = {
  cols: [53.45, 82.88, 197.6, 287.7, 373.58, 454.68, 512.92, 577.2],
  head: [601.63, 638.85],
  rows: [601.03, 543.4, 483.35, 423.9, 361.45, 308.02],
};
const MORE: Layout = {
  cols: [40.85, 71.47, 193.4, 292.5, 373.58, 454.68, 517.73, 580.2],
  head: [706.7, 743.92],
  rows: [706.1, 647.25, 584.82, 526.57, 467.72, 409.5, 351.25, 293, 234.17, 175.92, 117.7],
};
const TITLE = { x: 191, y: 676.7, w: 380 };
const DATES = { x: 191, y: 656.3, w: 101 };
const HEAD_GREY = 229 / 255;

export interface T3Input {
  courseTitle: string;
  dates: string[];          // one ISO date per training day, in order
  trainees: Trainee[];
}

// "12/11/2026"
const dmy = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

// The text on the "Dates of Training" line: "12 – 13 Nov 2026"; days that aren't back to back as
// "12 – 14 Nov 2026, 19 Nov 2026".
export function t3DatesText(dates: string[]): string {
  const d = dates.filter(Boolean);
  const runs: [string, string][] = [];
  d.forEach((x, i) => {
    if (i && new Date(x).getTime() - new Date(d[i - 1]).getTime() === 864e5) runs[runs.length - 1][1] = x;
    else runs.push([x, x]);
  });
  return runs.map(([a, b]) => formatDateRange(a, b)).join(', ');
}

// Column widths for a table with `days` signature columns (the form's own widths for one day).
export function columnsFor(layout: Layout, days: number): number[] {
  const c = layout.cols;
  const w = c.slice(1).map((x, i) => x - c[i]);                   // No, Name, Employer, NRIC, Citizenship, Sex, Signature
  if (days <= 1) return c;
  const total = c[c.length - 1] - c[0];
  const out = [w[0], w[1], w[2], w[3], 62, 36];
  let sig = total - out.reduce((a, b) => a + b, 0);
  const need = days * 34;                                          // a signature needs about 34pt (12 mm)
  if (sig < need) {
    // Take the rest from Name, Employer and NRIC, in proportion.
    const short = need - sig, from = out[1] + out[2] + out[3];
    for (const i of [1, 2, 3]) out[i] -= (out[i] / from) * short;
    sig = need;
  }
  const xs = [c[0]];
  [...out, ...Array(days).fill(sig / days)].forEach(v => xs.push(xs[xs.length - 1] + v));
  return xs;
}

let pdfLib: Promise<any> | null = null;
const loadPdfLib = () => {
  if (!pdfLib) pdfLib = import('pdf-lib').catch(e => { pdfLib = null; throw isOldTabError(e) ? appUpdatedError() : e; });
  return pdfLib;
};

export async function makeT3Pdf(input: T3Input): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  const res = await fetch(T3_TEMPLATE_URL);
  if (!res.ok) throw new Error("the T3 form file couldn't be loaded");
  const template = await PDFDocument.load(await res.arrayBuffer());
  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.TimesRomanBold);   // the form's table headings
  const black = rgb(0, 0, 0);

  // Characters the standard PDF fonts can't show (e.g. Chinese) become "?" rather than stopping the form.
  const ok = new Map<string, boolean>();
  const safe = (s: string) => Array.from(s).map(ch => {
    if (!ok.has(ch)) { try { font.encodeText(ch); ok.set(ch, true); } catch { ok.set(ch, false); } }
    return ok.get(ch) ? ch : '?';
  }).join('');

  const wrap = (text: string, f: any, size: number, width: number, breakWords = true): string[] => {
    const lines: string[] = [];
    let cur = '';
    for (const word of text.split(/\s+/).filter(Boolean)) {
      const next = cur ? `${cur} ${word}` : word;
      if (f.widthOfTextAtSize(next, size) <= width || !cur) cur = next;
      else { lines.push(cur); cur = word; }
      // A single word wider than the box even at the smallest size (a long IC or email): break it.
      while (breakWords && f.widthOfTextAtSize(cur, size) > width && cur.length > 1) {
        let n = cur.length - 1;
        while (n > 1 && f.widthOfTextAtSize(cur.slice(0, n), size) > width) n--;
        lines.push(cur.slice(0, n));
        cur = cur.slice(n);
      }
    }
    if (cur) lines.push(cur);
    return lines;
  };

  // Text in a box: wrapped, shrunk until it fits, centred up and down.
  const box = (page: any, text: string, x0: number, x1: number, y0: number, y1: number, opts: { center?: boolean; f?: any; size?: number; min?: number } = {}) => {
    const f = opts.f || font;
    const t = safe(text.trim());
    if (!t) return;
    const pad = 3, width = x1 - x0 - pad * 2, height = y1 - y0 - 4;
    // Smaller text first; words are only cut when even the smallest size doesn't fit.
    let size = opts.size || 9, lines = wrap(t, f, size, width, false);
    while (size > (opts.min || 6) && (lines.length * size * 1.15 > height || lines.some(l => f.widthOfTextAtSize(l, size) > width))) {
      size -= 0.5;
      lines = wrap(t, f, size, width, false);
    }
    if (lines.some(l => f.widthOfTextAtSize(l, size) > width)) lines = wrap(t, f, size, width);
    const lead = size * 1.15;
    let y = (y0 + y1) / 2 + (lines.length * lead) / 2 - size * 0.85;
    for (const l of lines) {
      const lw = f.widthOfTextAtSize(l, size);
      page.drawText(l, { x: opts.center ? (x0 + x1 - lw) / 2 : x0 + pad, y, size, font: f, color: black });
      y -= lead;
    }
  };

  // A one-line text on a form line, made smaller (down to 7pt) when it's long.
  const onLine = (page: any, text: string, at: { x: number; y: number; w: number }) => {
    const t = safe(text.trim());
    if (!t) return;
    let size = 10;
    while (size > 7 && font.widthOfTextAtSize(t, size) > at.w) size -= 0.5;
    page.drawText(t, { x: at.x, y: at.y + 1, size, font, color: black });
  };

  // The table redrawn with one signature column per day (multi-day trainings).
  const redrawTable = (page: any, L: Layout, xs: number[], days: string[], firstDay: number) => {
    const top = L.head[1] + LINE, bottom = L.rows[L.rows.length - 1];
    const left = L.cols[0], right = L.cols[L.cols.length - 1] + LINE;
    page.drawRectangle({ x: left - 1, y: bottom - 1, width: right - left + 2, height: top - bottom + 2, color: rgb(1, 1, 1) });
    const [h0, h1] = L.head;
    const sigStart = xs.length - 1 - days.length;
    const mid = (h0 + h1) / 2 + 1;
    // Grey headings, then the lines.
    page.drawRectangle({ x: left, y: h0, width: right - left, height: h1 - h0, color: rgb(HEAD_GREY, HEAD_GREY, HEAD_GREY) });
    const hline = (y: number, a: number, b: number) => page.drawRectangle({ x: a, y, width: b - a, height: LINE, color: black });
    const vline = (x: number, a: number, b: number) => page.drawRectangle({ x, y: a, width: LINE, height: b - a, color: black });
    hline(h1, left, right);
    L.rows.forEach(y => hline(y, left, right));
    hline(mid, xs[sigStart], right);
    xs.forEach((x, i) => {
      // Lines between the days start below "Signature*".
      vline(x, bottom, i > sigStart && i < xs.length - 1 ? mid : top);
    });
    const heads = ['No.', 'Name of Trainee(s)', 'Name of Employer(s)', 'NRIC', 'Citizenship', 'Sex'];
    heads.forEach((h, i) => box(page, h, xs[i], xs[i + 1], h0, h1, { center: true, f: bold, size: 10.8, min: 7 }));
    box(page, 'Signature*', xs[sigStart], right, mid, h1, { center: true, f: bold, size: 10.8, min: 7 });
    days.forEach((d, i) => box(page, `Day ${firstDay + i} ${dmy(d)}`, xs[sigStart + i], xs[sigStart + i + 1], h0, mid, { center: true, f: bold, size: 7.5, min: 5.5 }));
  };

  const fill = (page: any, L: Layout, xs: number[], list: Trainee[], startNo: number) => {
    list.forEach((t, i) => {
      const y1 = L.rows[i], y0 = L.rows[i + 1] + LINE;
      const cell = (c: number, text: string, center = true) => box(page, text, xs[c] + LINE, xs[c + 1], y0, y1, { center });
      cell(0, String(startNo + i));
      cell(1, t.name, false);
      cell(2, t.employer, false);
      cell(3, t.ic);
      cell(4, t.citizenship);
      cell(5, t.sex);
    });
  };

  const dates = input.dates.length ? input.dates : [''];
  const trainees = input.trainees.filter(t => t.name.trim());
  const firstCap = FIRST.rows.length - 1, moreCap = MORE.rows.length - 1;
  for (let d = 0; d < dates.length; d += T3_DAYS_PER_SHEET) {
    const days = dates.slice(d, d + T3_DAYS_PER_SHEET);
    const multi = dates.length > 1;
    // Page 1, then as many "continued" pages as the names need.
    const pages = 1 + Math.max(0, Math.ceil((trainees.length - firstCap) / moreCap));
    for (let p = 0; p < pages; p++) {
      const L = p === 0 ? FIRST : MORE;
      const [page] = await out.copyPages(template, [p === 0 ? 0 : 1]);
      out.addPage(page);
      const xs = multi ? columnsFor(L, days.length) : L.cols;
      if (multi) redrawTable(page, L, xs, days, d + 1);
      if (p === 0) {
        onLine(page, input.courseTitle, TITLE);
        onLine(page, t3DatesText(dates), DATES);
      }
      const from = p === 0 ? 0 : firstCap + (p - 1) * moreCap;
      fill(page, L, xs, trainees.slice(from, from + (p === 0 ? firstCap : moreCap)), from + 1);
    }
  }
  out.setTitle(`T3 attendance list - ${input.courseTitle}`);
  return out.save();
}
