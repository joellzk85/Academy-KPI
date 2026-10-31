// Certificates drawn in the browser (2026-10-31), used by the CRM (CertificatePanel) and HR's link page (/cert/<token>),
// so both make the same PDF. Everything that is the same on every certificate is drawn once (a picture, reused on every
// page so the PDF stays small); each person's name and IC are a see-through strip on top, the number is text.
// - Template A: Joel's Canva design "NA MIE Appreciation Certificate": landscape, a black page with a mint glow and a
//   fine wave in the corner, the client's logo next to NEXT Academy's (white), "Training: …", a large CERTIFICATE,
//   "of participation", the name and IC, the paragraph, the signature, the signer, the date and the number.
// - Template B (2026-11-01): Joel's "HASHIM BIN KUDER" sample: portrait, white with navy, grey and mint waves at the top
//   and bottom, NEXT Academy's logo (and the client's), CERTIFICATE / of participation, "Proudly Presented to :", the
//   name and IC over a line, "has successfully completed the course of", the title in quotes, the dates, the venue,
//   the signature, the signer and title, and the number in the bottom corner.
// The signature is the signer's name in a handwriting font (Joel: "just AI generate the signature").

import nextLogoUrl from '../assets/outline/next-logo.png';
import { B_LINE, CertPrint, CertTemplate, KIND_HEADING, SIGNATURE_STYLES, safeFileName } from './certificates';

const SCALE = 2;              // sharp enough to print
const WHITE = '#ffffff';
const SOFT = 'rgba(255,255,255,0.78)';
const DISPLAY = 'Poppins';
const A4_LONG = 841.89, A4_SHORT = 595.28;   // PDF points

let fontsReady: Promise<void> | null = null;
// Poppins and Great Vibes come with the CRM's style sheet; the other signature fonts are fetched the first time.
export function loadFonts(): Promise<void> {
  if (!fontsReady) {
    if (!document.querySelector('link[data-cert-fonts]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=Allura&family=Mrs+Saint+Delafield&family=Poppins:wght@400;500;600;700&family=Great+Vibes&display=swap';
      link.dataset.certFonts = '1';
      document.head.appendChild(link);
    }
    const wanted = [`400 20px ${DISPLAY}`, `500 20px ${DISPLAY}`, `600 20px ${DISPLAY}`, `700 20px ${DISPLAY}`, ...SIGNATURE_STYLES.map(s => `40px "${s.font}"`)];
    fontsReady = Promise.race([
      Promise.all(wanted.map(f => document.fonts.load(f).catch(() => []))).then(() => undefined),
      new Promise<void>(r => setTimeout(r, 6000)),   // a slow connection still gets a certificate, in a plainer font
    ]);
  }
  return fontsReady;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    if (!src) return resolve(null);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// NEXT Academy's logo in white, for the dark page.
function whiteLogo(img: HTMLImageElement | null): HTMLCanvasElement | null {
  if (!img) return null;
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const x = c.getContext('2d')!;
  x.drawImage(img, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = WHITE;
  x.fillRect(0, 0, c.width, c.height);
  return c;
}

function spaced(ctx: CanvasRenderingContext2D, px: number) {
  (ctx as any).letterSpacing = `${px}px`;
}

function fitFont(ctx: CanvasRenderingContext2D, text: string, weight: number, size: number, min: number, width: number, family = DISPLAY) {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  while (s > min && ctx.measureText(text).width > width) { s -= 0.5; ctx.font = `${weight} ${s}px ${family}`; }
  return s;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > width) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

// The signature: the signer's name in a handwriting font, slightly slanted, with a small flourish.
export function drawSignature(ctx: CanvasRenderingContext2D, name: string, styleFont: string, x: number, baseline: number, color = WHITE, maxWidth = 260, center = false) {
  if (!name.trim()) return;
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.textAlign = 'left';
  spaced(ctx, 0);
  const size = fitFont(ctx, name, 400, 50, 26, maxWidth, `"${styleFont}", cursive`);
  const w = ctx.measureText(name).width;
  ctx.translate(center ? x - w / 2 : x, baseline);
  ctx.transform(1, 0, -0.12, 1, 0, 0);
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(name, 0, 0);
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(w * 0.15, size * 0.18);
  ctx.bezierCurveTo(w * 0.45, size * 0.32, w * 0.8, size * 0.05, w + 12, size * 0.12);
  ctx.stroke();
  ctx.restore();
}

export interface CertAssets { next: HTMLImageElement | null; white: HTMLCanvasElement | null; client: HTMLImageElement | null }

export async function loadAssets(p: CertPrint): Promise<CertAssets> {
  await loadFonts();
  const [next, client] = await Promise.all([loadImage(nextLogoUrl), loadImage(p.clientLogo)]);
  return { next, white: whiteLogo(next), client };
}

const signatureFont = (p: CertPrint) => (SIGNATURE_STYLES.find(s => s.id === p.signatureStyle) || SIGNATURE_STYLES[0]).font;
type Person = { name: string; ic: string };

// ---------- Template A ----------

const A = { w: 1123, h: 794, left: 78, nameX: 345, lineEnd: 612 };

// A thin rule ending in a small dot, as on the Canva design.
function rule(ctx: CanvasRenderingContext2D, x1: number, x2: number, y: number) {
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
  ctx.fillStyle = WHITE;
  ctx.beginPath(); ctx.arc(x2, y, 2.6, 0, Math.PI * 2); ctx.fill();
}

function backgroundA(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#040607';
  ctx.fillRect(0, 0, A.w, A.h);
  const teal = ctx.createRadialGradient(880, 260, 0, 880, 260, 560);
  teal.addColorStop(0, 'rgba(22,86,92,0.55)');
  teal.addColorStop(1, 'rgba(22,86,92,0)');
  ctx.fillStyle = teal; ctx.fillRect(0, 0, A.w, A.h);
  const mint = ctx.createRadialGradient(1180, 930, 0, 1180, 930, 820);
  mint.addColorStop(0, 'rgba(214,250,240,1)');
  mint.addColorStop(0.22, 'rgba(126,226,205,0.95)');
  mint.addColorStop(0.5, 'rgba(34,128,120,0.75)');
  mint.addColorStop(0.78, 'rgba(10,44,46,0.35)');
  mint.addColorStop(1, 'rgba(4,6,7,0)');
  ctx.fillStyle = mint; ctx.fillRect(0, 0, A.w, A.h);
  // The fine wave mesh across the top right.
  ctx.lineWidth = 0.7;
  for (let i = 0; i < 70; i++) {
    ctx.strokeStyle = `rgba(255,255,255,${0.035 + 0.05 * Math.sin((i / 70) * Math.PI)})`;
    ctx.beginPath();
    for (let x = 330; x <= A.w + 20; x += 8) {
      const t = (x - 330) / (A.w - 330);
      const y = 40 + i * 4.2 + 70 * Math.sin(t * 3.4 + i * 0.045) * (0.6 + t * 0.6) + t * t * 150 - t * 60;
      if (x === 330) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function baseA(ctx: CanvasRenderingContext2D, p: CertPrint, a: CertAssets) {
  backgroundA(ctx);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const L = A.left;

  // Logos: the client's on a white tile (any logo reads on the dark page), a divider, then NEXT Academy's.
  let x = L;
  const top = 64, h = 46;
  if (a.client) {
    const w = Math.min(170, (a.client.naturalWidth / a.client.naturalHeight) * (h - 12));
    ctx.fillStyle = WHITE;
    ctx.beginPath(); (ctx as any).roundRect(x, top, w + 16, h, 8); ctx.fill();
    ctx.drawImage(a.client, x + 8, top + 6, w, h - 12);
    x += w + 16 + 16;
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillRect(x, top + 4, 1.2, h - 8);
    x += 16;
  }
  if (a.white) ctx.drawImage(a.white, x, top + 3, (a.white.width / a.white.height) * (h - 6), h - 6);

  // Training: …
  ctx.fillStyle = WHITE;
  spaced(ctx, 1);
  const head = `TRAINING: ${p.title.toUpperCase()}`;
  const size = fitFont(ctx, head, 500, 20, 13, 960);
  const lines = ctx.measureText(head).width > 960 ? wrap(ctx, head, 960).slice(0, 2) : [head];
  const titleBase = 186 - (lines.length - 1) * (size + 4);
  lines.forEach((l, i) => ctx.fillText(l, L, titleBase + i * (size + 4)));
  const widest = Math.max(...lines.map(l => ctx.measureText(l).width));
  rule(ctx, L, Math.min(1040, Math.max(A.lineEnd + 40, L + widest + 8)), 200);

  // CERTIFICATE / of participation
  spaced(ctx, 2);
  ctx.font = `700 118px ${DISPLAY}`;
  ctx.fillText('CERTIFICATE', L - 6, 304);
  spaced(ctx, 1);
  ctx.font = `500 27px ${DISPLAY}`;
  ctx.fillText(KIND_HEADING[p.kind].toUpperCase(), L, 344);
  spaced(ctx, 4.5);
  ctx.font = `500 10.5px ${DISPLAY}`;
  ctx.fillStyle = SOFT;
  ctx.fillText('THIS IS TO CERTIFY THAT', L, 383);

  rule(ctx, L, A.lineEnd, 476);

  // The paragraph
  ctx.fillStyle = WHITE;
  spaced(ctx, 0.4);
  ctx.font = `500 10.5px ${DISPLAY}`;
  wrap(ctx, p.paragraph.toUpperCase(), 820).slice(0, 5).forEach((l, i) => ctx.fillText(l, L, 512 + i * 16));

  // Signature, signer, title, date
  drawSignature(ctx, p.signatureName || p.signerName, signatureFont(p), L + 6, 618);
  rule(ctx, L, 312, 636);
  ctx.fillStyle = WHITE;
  spaced(ctx, 0.3);
  ctx.font = `700 18px ${DISPLAY}`;
  ctx.fillText(p.signerName, L, 664);
  spaced(ctx, 4.5);
  ctx.font = `500 9.5px ${DISPLAY}`;
  ctx.fillStyle = SOFT;
  ctx.fillText(p.signerTitle.toUpperCase(), L, 684);
  ctx.fillText(p.dateText.toUpperCase(), L, 742);
  spaced(ctx, 0);
}

function personA(ctx: CanvasRenderingContext2D, person: Person) {
  ctx.fillStyle = WHITE;
  ctx.textAlign = 'center';
  spaced(ctx, 0.3);
  const font = `${DISPLAY}, sans-serif`;
  fitFont(ctx, person.name.toUpperCase(), 700, 22, 12, A.lineEnd - A.left - 10, font);
  ctx.fillText(person.name.toUpperCase(), A.nameX, 432);
  if (person.ic) { ctx.font = `700 17px ${font}`; ctx.fillText(person.ic, A.nameX, 460); }
  ctx.textAlign = 'left';
  spaced(ctx, 0);
}

function numberA(ctx: CanvasRenderingContext2D, number: string) {
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.textAlign = 'right';
  spaced(ctx, 2);
  ctx.font = `500 9.5px ${DISPLAY}`;
  ctx.fillText(`CERTIFICATE NO. ${number}`, A.w - 70, 742);
  ctx.textAlign = 'left';
  spaced(ctx, 0);
}

// ---------- Template B ----------

const B = { w: 794, h: 1123, cx: 397 };
const NAVY = '#2a2d43', GREY = '#5d5e60', MINT = '#5cc6a7', INK = '#111111';

function path(ctx: CanvasRenderingContext2D, d: (c: CanvasRenderingContext2D) => void, fill?: string, stroke?: string, width = 0) {
  ctx.beginPath(); d(ctx);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.stroke(); }
}

function backgroundB(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = WHITE;
  ctx.fillRect(0, 0, B.w, B.h);
  // Top: a grey wave under a navy one, with mint lines across them.
  path(ctx, c => { c.moveTo(0, 0); c.lineTo(B.w, 0); c.lineTo(B.w, 62); c.bezierCurveTo(560, 30, 300, 85, 0, 172); c.closePath(); }, GREY);
  path(ctx, c => { c.moveTo(0, 0); c.lineTo(B.w, 0); c.lineTo(B.w, 24); c.bezierCurveTo(560, 2, 300, 42, 0, 128); c.closePath(); }, NAVY);
  path(ctx, c => { c.moveTo(-10, 102); c.bezierCurveTo(230, 30, 520, 40, B.w + 10, 6); }, undefined, MINT, 5);
  path(ctx, c => { c.moveTo(500, -5); c.bezierCurveTo(630, 28, 720, 46, B.w + 10, 78); }, undefined, MINT, 4);
  // Bottom: the same, rising to the right.
  path(ctx, c => { c.moveTo(0, B.h); c.lineTo(0, 1066); c.bezierCurveTo(220, 1044, 470, 1046, B.w, 930); c.lineTo(B.w, B.h); c.closePath(); }, GREY);
  path(ctx, c => { c.moveTo(0, B.h); c.lineTo(0, 1094); c.bezierCurveTo(260, 1064, 520, 1084, B.w, 996); c.lineTo(B.w, B.h); c.closePath(); }, NAVY);
  path(ctx, c => { c.moveTo(-10, 1112); c.bezierCurveTo(250, 1080, 520, 1102, B.w + 10, 1032); }, undefined, WHITE, 5);
  path(ctx, c => { c.moveTo(-10, 1056); c.bezierCurveTo(250, 1026, 520, 1052, B.w + 10, 972); }, undefined, MINT, 5);
  path(ctx, c => { c.moveTo(-10, 1030); c.bezierCurveTo(90, 1060, 170, 1096, 250, B.h + 10); }, undefined, MINT, 4);
}

function centred(ctx: CanvasRenderingContext2D, text: string, y: number, weight: number, size: number, opts: { min?: number; width?: number; spacing?: number; color?: string } = {}) {
  ctx.fillStyle = opts.color || INK;
  ctx.textAlign = 'center';
  spaced(ctx, opts.spacing || 0);
  fitFont(ctx, text, weight, size, opts.min || size, opts.width || 680);
  ctx.fillText(text, B.cx, y);
  ctx.textAlign = 'left';
  spaced(ctx, 0);
}

function baseB(ctx: CanvasRenderingContext2D, p: CertPrint, a: CertAssets) {
  backgroundB(ctx);
  ctx.textBaseline = 'alphabetic';

  // Logos, centred: the client's (if any), a divider, NEXT Academy's.
  const top = 196 - 92;
  const nextH = 88, nextW = a.next ? (a.next.naturalWidth / a.next.naturalHeight) * nextH : 0;
  const clientH = 64, clientW = a.client ? Math.min(190, (a.client.naturalWidth / a.client.naturalHeight) * clientH) : 0;
  const gap = a.client ? 30 : 0;
  let x = B.cx - (clientW + gap + nextW) / 2;
  if (a.client) {
    ctx.drawImage(a.client, x, top + (nextH - clientH) / 2, clientW, clientH);
    x += clientW + gap / 2;
    ctx.fillStyle = '#c9ccd1';
    ctx.fillRect(x - 0.6, top + 10, 1.2, nextH - 20);
    x += gap / 2;
  }
  if (a.next) ctx.drawImage(a.next, x, top, nextW, nextH);

  centred(ctx, 'CERTIFICATE', 316, 700, 74, { spacing: 9, min: 50, width: 660 });
  centred(ctx, KIND_HEADING[p.kind].toUpperCase(), 386, 700, 33, { spacing: 0.5, min: 22, width: 640 });
  centred(ctx, 'Proudly Presented to :', 488, 400, 21);

  // The line under the name and IC
  ctx.fillStyle = INK;
  ctx.fillRect(125, 629, 548, 3);

  centred(ctx, B_LINE[p.kind], 681, 400, 25, { min: 18, width: 640 });
  // The title in quotes, on two lines if it's long
  ctx.font = `700 26px ${DISPLAY}`;
  const title = `"${p.title}"`;
  let y = 717;
  if (ctx.measureText(title).width > 660) {
    const size = fitFont(ctx, title, 700, 26, 20, 660);
    if (ctx.measureText(title).width > 660) {
      const lines = wrap(ctx, title, 660).slice(0, 2);
      lines.forEach((l, i) => centred(ctx, l, y + i * (size + 6), 700, size));
      y += size + 6;
    } else centred(ctx, title, y, 700, size);
  } else centred(ctx, title, y, 700, 26);
  centred(ctx, p.dateText, y + 74, 400, 25, { min: 16, width: 660 });
  if (p.venue) centred(ctx, p.venue, y + 108, 400, 18, { min: 13, width: 640, color: '#555a60' });

  // Signature, the line, the signer and title
  drawSignature(ctx, p.signatureName || p.signerName, signatureFont(p), B.cx, 916, INK, 220, true);
  ctx.fillStyle = INK;
  ctx.fillRect(285, 929, 226, 1.2);
  centred(ctx, p.signerName.toUpperCase(), 955, 500, 17, { min: 12, width: 420 });
  centred(ctx, p.signerTitle.toUpperCase(), 978, 500, 17, { min: 12, width: 420 });
}

function personB(ctx: CanvasRenderingContext2D, person: Person) {
  centred(ctx, person.name.toUpperCase(), 571, 400, 22, { min: 13, width: 540 });
  if (person.ic) centred(ctx, person.ic, 608, 400, 22, { min: 14, width: 540 });
}

function numberB(ctx: CanvasRenderingContext2D, number: string) {
  ctx.fillStyle = WHITE;
  ctx.textAlign = 'right';
  spaced(ctx, 0.5);
  ctx.font = `500 14px ${DISPLAY}`;
  ctx.fillText(number, B.w - 42, 1100);
  ctx.textAlign = 'left';
  spaced(ctx, 0);
}

// ---------- both ----------

type Layout = {
  w: number; h: number; orientation: 'landscape' | 'portrait';
  base: (ctx: CanvasRenderingContext2D, p: CertPrint, a: CertAssets) => void;
  person: (ctx: CanvasRenderingContext2D, person: Person) => void;
  number: (ctx: CanvasRenderingContext2D, number: string) => void;
  strip: { top: number; h: number };                         // where the name and IC are
  text: { x: number; name: number; ic: number; size: number }; // the invisible (searchable) copy
  pdfNumber: { x: number; y: number; size: number; spacing: number; rgb: [number, number, number]; text: (n: string) => string };
};

const LAYOUTS: Record<CertTemplate, Layout> = {
  A: {
    w: A.w, h: A.h, orientation: 'landscape', base: baseA, person: personA, number: numberA,
    strip: { top: 400, h: 70 }, text: { x: A.nameX, name: 432, ic: 460, size: 16 },
    pdfNumber: { x: A.w - 70, y: 742, size: 9.5, spacing: 1.5, rgb: [235, 245, 242], text: n => `CERTIFICATE NO. ${n}` },
  },
  B: {
    w: B.w, h: B.h, orientation: 'portrait', base: baseB, person: personB, number: numberB,
    strip: { top: 540, h: 80 }, text: { x: B.cx, name: 571, ic: 608, size: 16 },
    pdfNumber: { x: B.w - 42, y: 1100, size: 14, spacing: 0.3, rgb: [255, 255, 255], text: n => n },
  },
};
const layoutOf = (p: CertPrint) => LAYOUTS[p.template] || LAYOUTS.A;

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w * SCALE; c.height = h * SCALE;
  const ctx = c.getContext('2d')!;
  ctx.scale(SCALE, SCALE);
  return { c, ctx };
}

const LATIN = /^[\u0000-ÿ‘’“”–—]*$/;

/** One certificate as a picture (the preview in the CRM and on HR's page). */
export async function previewImage(p: CertPrint, person: { name: string; ic: string; number: string }): Promise<string> {
  const L = layoutOf(p);
  const a = await loadAssets(p);
  const { c, ctx } = canvas(L.w, L.h);
  L.base(ctx, p, a);
  L.person(ctx, person);
  if (person.number) L.number(ctx, person.number);
  return c.toDataURL('image/jpeg', 0.85);
}

/** The certificates as one PDF, one page each. onProgress gets 0 to 100. */
export async function makeCertificatesPdf(p: CertPrint, people = p.people, onProgress?: (pct: number) => void): Promise<Blob> {
  return pdfOf(layoutOf(p), await basePicture(p), people, onProgress);
}

async function basePicture(p: CertPrint) {
  const L = layoutOf(p);
  const a = await loadAssets(p);
  const base = canvas(L.w, L.h);
  L.base(base.ctx, p, a);
  return base.c.toDataURL('image/jpeg', 0.9);
}

async function pdfOf(L: Layout, baseJpg: string, people: CertPrint['people'], onProgress?: (pct: number) => void): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: L.orientation, unit: 'pt', format: 'a4', compress: true });
  const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight();
  const PT = (L.orientation === 'landscape' ? A4_LONG : A4_SHORT) / L.w;   // px → PDF points
  const n = L.pdfNumber;
  people.forEach((person, i) => {
    if (i) pdf.addPage('a4', L.orientation);
    pdf.addImage(baseJpg, 'JPEG', 0, 0, W, H, 'cert-base', 'FAST');   // the same picture on every page, stored once
    // The name and IC in the design's font (any language), as a see-through strip; for names in Latin letters an
    // invisible copy as text too, so the PDF can be searched.
    const strip = canvas(L.w, L.strip.h);
    strip.ctx.translate(0, -L.strip.top);
    L.person(strip.ctx, person);
    pdf.addImage(strip.c.toDataURL('image/png'), 'PNG', 0, L.strip.top * PT, W, L.strip.h * PT, undefined, 'FAST');
    const name = person.name.toUpperCase();
    if (LATIN.test(name) && LATIN.test(person.ic)) {
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(L.text.size * PT);
      pdf.text(name, L.text.x * PT, L.text.name * PT, { align: 'center', renderingMode: 'invisible' });
      if (person.ic) pdf.text(person.ic, L.text.x * PT, L.text.ic * PT, { align: 'center', renderingMode: 'invisible' });
    }
    if (person.number) {
      pdf.setTextColor(...n.rgb);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(n.size * PT);
      pdf.setCharSpace(n.spacing * PT);
      pdf.text(n.text(person.number), n.x * PT, n.y * PT, { align: 'right' });
      pdf.setCharSpace(0);
    }
    onProgress?.(Math.round(((i + 1) / people.length) * 100));
  });
  return pdf.output('blob');
}

export const certFileName = (p: CertPrint) => `Certificates - ${safeFileName(p.title)}${p.company ? ` - ${safeFileName(p.company)}` : ''}.pdf`;
export const personFileName = (person: { name: string; number: string }) =>
  `${safeFileName(person.number.split('/').pop() || '')} - ${safeFileName(person.name)}.pdf`.replace(/^ - /, '');

/** One PDF per person, in a ZIP. */
export async function makeCertificatesZip(p: CertPrint, onProgress?: (pct: number) => void): Promise<Blob> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const base = await basePicture(p);
  for (let i = 0; i < p.people.length; i++) {
    const person = p.people[i];
    zip.file(personFileName(person), await pdfOf(layoutOf(p), base, [person]));
    onProgress?.(Math.round(((i + 1) / p.people.length) * 100));
  }
  return zip.generateAsync({ type: 'blob' });
}

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
