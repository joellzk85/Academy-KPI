// Template A (2026-10-31): Joel's Canva design "NA MIE Appreciation Certificate", redrawn: a black page with a mint
// glow and a fine wave in the corner, the client's logo next to NEXT Academy's (white), "Training: …", a large
// CERTIFICATE, "of participation", the name and IC, the paragraph, the signature drawn from the signer's name in a
// handwriting font (Joel: "just AI generate the signature"), the signer, the training date and the certificate number.
// Everything that is the same on every certificate is drawn once in the browser (a picture, reused on every page so
// the PDF stays small); each person's name, IC and number are written on top as text.
// Used by the CRM (CertificatePanel) and HR's link page (/cert/<token>), so both make the same PDF.

import nextLogoUrl from '../assets/outline/next-logo.png';
import { CertPrint, KIND_HEADING, SIGNATURE_STYLES, safeFileName } from './certificates';

export const PAGE_W = 1123;   // the Canva page, px (A4 landscape)
export const PAGE_H = 794;
const PT = 841.89 / PAGE_W;   // px → PDF points
const SCALE = 2;              // sharp enough to print
const LEFT = 78;
const NAME_X = 345;           // the name is centred over its line (LEFT to LINE_END)
const LINE_END = 612;
const WHITE = '#ffffff';
const SOFT = 'rgba(255,255,255,0.78)';
const DISPLAY = 'Poppins';

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
async function whiteLogo(): Promise<HTMLCanvasElement | null> {
  const img = await loadImage(nextLogoUrl);
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

// A thin rule ending in a small dot, as on the Canva design.
function rule(ctx: CanvasRenderingContext2D, x1: number, x2: number, y: number) {
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
  ctx.fillStyle = WHITE;
  ctx.beginPath(); ctx.arc(x2, y, 2.6, 0, Math.PI * 2); ctx.fill();
}

function background(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#040607';
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  const teal = ctx.createRadialGradient(880, 260, 0, 880, 260, 560);
  teal.addColorStop(0, 'rgba(22,86,92,0.55)');
  teal.addColorStop(1, 'rgba(22,86,92,0)');
  ctx.fillStyle = teal; ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  const mint = ctx.createRadialGradient(1180, 930, 0, 1180, 930, 820);
  mint.addColorStop(0, 'rgba(214,250,240,1)');
  mint.addColorStop(0.22, 'rgba(126,226,205,0.95)');
  mint.addColorStop(0.5, 'rgba(34,128,120,0.75)');
  mint.addColorStop(0.78, 'rgba(10,44,46,0.35)');
  mint.addColorStop(1, 'rgba(4,6,7,0)');
  ctx.fillStyle = mint; ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  // The fine wave mesh across the top right.
  ctx.lineWidth = 0.7;
  for (let i = 0; i < 70; i++) {
    ctx.strokeStyle = `rgba(255,255,255,${0.035 + 0.05 * Math.sin((i / 70) * Math.PI)})`;
    ctx.beginPath();
    for (let x = 330; x <= PAGE_W + 20; x += 8) {
      const t = (x - 330) / (PAGE_W - 330);
      const y = 40 + i * 4.2 + 70 * Math.sin(t * 3.4 + i * 0.045) * (0.6 + t * 0.6) + t * t * 150 - t * 60;
      if (x === 330) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

// The signature: the signer's name in a handwriting font, slightly slanted, with a small flourish.
export function drawSignature(ctx: CanvasRenderingContext2D, name: string, styleFont: string, x: number, baseline: number, color = WHITE, maxWidth = 260) {
  if (!name.trim()) return;
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  spaced(ctx, 0);
  const size = fitFont(ctx, name, 400, 50, 26, maxWidth, `"${styleFont}", cursive`);
  ctx.translate(x, baseline);
  ctx.transform(1, 0, -0.12, 1, 0, 0);
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(name, 0, 0);
  const w = ctx.measureText(name).width;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(w * 0.15, size * 0.18);
  ctx.bezierCurveTo(w * 0.45, size * 0.32, w * 0.8, size * 0.05, w + 12, size * 0.12);
  ctx.stroke();
  ctx.restore();
}

export interface CertAssets { white: HTMLCanvasElement | null; client: HTMLImageElement | null }

export async function loadAssets(p: CertPrint): Promise<CertAssets> {
  await loadFonts();
  const [white, client] = await Promise.all([whiteLogo(), loadImage(p.clientLogo)]);
  return { white, client };
}

// Everything that is the same on every certificate of this training.
export function drawBase(ctx: CanvasRenderingContext2D, p: CertPrint, a: CertAssets) {
  background(ctx);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  // Logos: the client's on a white tile (any logo reads on the dark page), a divider, then NEXT Academy's.
  let x = LEFT;
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
  lines.forEach((l, i) => ctx.fillText(l, LEFT, titleBase + i * (size + 4)));
  const widest = Math.max(...lines.map(l => ctx.measureText(l).width));
  rule(ctx, LEFT, Math.min(1040, Math.max(LINE_END + 40, LEFT + widest + 8)), 200);

  // CERTIFICATE / of participation
  spaced(ctx, 2);
  ctx.font = `700 118px ${DISPLAY}`;
  ctx.fillText('CERTIFICATE', LEFT - 6, 304);
  spaced(ctx, 1);
  ctx.font = `500 27px ${DISPLAY}`;
  ctx.fillText(KIND_HEADING[p.kind].toUpperCase(), LEFT, 344);
  spaced(ctx, 4.5);
  ctx.font = `500 10.5px ${DISPLAY}`;
  ctx.fillStyle = SOFT;
  ctx.fillText('THIS IS TO CERTIFY THAT', LEFT, 383);

  rule(ctx, LEFT, LINE_END, 476);

  // The paragraph
  ctx.fillStyle = WHITE;
  spaced(ctx, 0.4);
  ctx.font = `500 10.5px ${DISPLAY}`;
  wrap(ctx, p.paragraph.toUpperCase(), 820).slice(0, 5).forEach((l, i) => ctx.fillText(l, LEFT, 512 + i * 16));

  // Signature, signer, title, date
  const style = SIGNATURE_STYLES.find(s => s.id === p.signatureStyle) || SIGNATURE_STYLES[0];
  drawSignature(ctx, p.signerName, style.font, LEFT + 6, 618);
  rule(ctx, LEFT, 312, 636);
  ctx.fillStyle = WHITE;
  spaced(ctx, 0.3);
  ctx.font = `700 18px ${DISPLAY}`;
  ctx.fillText(p.signerName, LEFT, 664);
  spaced(ctx, 4.5);
  ctx.font = `500 9.5px ${DISPLAY}`;
  ctx.fillStyle = SOFT;
  ctx.fillText(p.signerTitle.toUpperCase(), LEFT, 684);
  ctx.fillText(p.dateText.toUpperCase(), LEFT, 742);
  spaced(ctx, 0);
}

const LATIN = /^[\u0000-ÿ‘’“”–—]*$/;

// The person's part, drawn on a canvas (the preview, and names with letters the PDF's own font doesn't have).
function drawPerson(ctx: CanvasRenderingContext2D, person: { name: string; ic: string }, font: string) {
  ctx.fillStyle = WHITE;
  ctx.textAlign = 'center';
  spaced(ctx, 0.3);
  fitFont(ctx, person.name.toUpperCase(), 700, 22, 12, LINE_END - LEFT - 10, font);
  ctx.fillText(person.name.toUpperCase(), NAME_X, 432);
  if (person.ic) { ctx.font = `700 17px ${font}`; ctx.fillText(person.ic, NAME_X, 460); }
  ctx.textAlign = 'left';
  spaced(ctx, 0);
}

function drawNumber(ctx: CanvasRenderingContext2D, number: string) {
  if (!number) return;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.textAlign = 'right';
  spaced(ctx, 2);
  ctx.font = `500 9.5px ${DISPLAY}`;
  ctx.fillText(`CERTIFICATE NO. ${number}`, PAGE_W - 70, 742);
  ctx.textAlign = 'left';
  spaced(ctx, 0);
}

function canvas(w = PAGE_W, h = PAGE_H) {
  const c = document.createElement('canvas');
  c.width = w * SCALE; c.height = h * SCALE;
  const ctx = c.getContext('2d')!;
  ctx.scale(SCALE, SCALE);
  return { c, ctx };
}

/** One certificate as a picture (the preview in the CRM and on HR's page). */
export async function previewImage(p: CertPrint, person: { name: string; ic: string; number: string }): Promise<string> {
  const a = await loadAssets(p);
  const { c, ctx } = canvas();
  drawBase(ctx, p, a);
  drawPerson(ctx, person, `${DISPLAY}, sans-serif`);
  drawNumber(ctx, person.number);
  return c.toDataURL('image/jpeg', 0.85);
}

/** The certificates as one PDF, one page each. onProgress gets 0 to 100. */
export async function makeCertificatesPdf(p: CertPrint, people = p.people, onProgress?: (pct: number) => void): Promise<Blob> {
  return pdfOf(await basePicture(p), people, onProgress);
}

async function basePicture(p: CertPrint) {
  const a = await loadAssets(p);
  const base = canvas();
  drawBase(base.ctx, p, a);
  return base.c.toDataURL('image/jpeg', 0.9);
}

async function pdfOf(baseJpg: string, people: CertPrint['people'], onProgress?: (pct: number) => void): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4', compress: true });
  const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight();
  people.forEach((person, i) => {
    if (i) pdf.addPage('a4', 'landscape');
    pdf.addImage(baseJpg, 'JPEG', 0, 0, W, H, 'cert-base', 'FAST');   // the same picture on every page, stored once
    // The name and IC in the design's font (any language), as a see-through strip over the line; for names in
    // Latin letters an invisible copy as text too, so the PDF can be searched.
    const strip = canvas(PAGE_W, 70);
    strip.ctx.translate(0, -400);
    drawPerson(strip.ctx, person, `${DISPLAY}, sans-serif`);
    pdf.addImage(strip.c.toDataURL('image/png'), 'PNG', 0, 400 * PT, W, 70 * PT, undefined, 'FAST');
    const name = person.name.toUpperCase();
    if (LATIN.test(name) && LATIN.test(person.ic)) {
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(16 * PT);
      pdf.text(name, NAME_X * PT, 432 * PT, { align: 'center', renderingMode: 'invisible' });
      if (person.ic) pdf.text(person.ic, NAME_X * PT, 460 * PT, { align: 'center', renderingMode: 'invisible' });
    }
    if (person.number) {
      pdf.setTextColor(235, 245, 242);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9.5 * PT);
      pdf.setCharSpace(1.5 * PT);
      pdf.text(`CERTIFICATE NO. ${person.number}`, (PAGE_W - 70) * PT, 742 * PT, { align: 'right' });
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
    zip.file(personFileName(person), await pdfOf(base, [person]));
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
