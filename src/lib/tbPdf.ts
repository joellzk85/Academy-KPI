// The teambuilding proposal as a PDF (2026-10-19): a printout of the website, for internal use or for a client who
// insists on a PDF. Drawn in the browser like the course outline PDF: the website is laid out off screen at a
// desktop width, each part is photographed and placed on A4 pages (cut between cards, never through one),
// and a faint diagonal watermark with the client's company name is written over every page.
// Photos come through the CRM server (/api/photos/get), because the browser may not use Firebase photos in a picture.

import React from 'react';
import { createRoot } from 'react-dom/client';
import TeambuildingSite from '../components/TeambuildingSite';
import { callServer } from './firebase';
import { ResolvedTb } from './teambuilding';

const WIDTH = 1100;   // px: the website's computer layout
const SCALE = 1.5;            // sharp enough, and keeps the PDF small enough to email (Outlook: 3 MB)
const A4_W = 210;
const A4_H = 297;

export const tbPdfFileName = (r: ResolvedTb) =>
  `Teambuilding proposal ${String(r.p.refNumber || r.p.id).replace(/[\\/:*?"<>|]+/g, '-')}${r.p.title ? ` - ${r.p.title.replace(/[\\/:*?"<>|]+/g, '').slice(0, 60)}` : ''}${r.company ? ` - ${r.company.replace(/[\\/:*?"<>|]+/g, '').slice(0, 40)}` : ''}.pdf`;

function photoUrls(r: ResolvedTb): string[] {
  const p = r.p;
  return Array.from(new Set([
    p.coverPhoto || '',
    r.clientLogo || '',
    ...(p.trainers || []).map(t => t.photo || ''),
    ...(p.activities || []).flatMap(a => a.photos || []),
    ...(p.venues || []).flatMap(v => v.photos || []),
  ].filter(u => /^https:\/\/firebasestorage\.googleapis\.com\//.test(u))));
}

// The same proposal with its Firebase photos swapped for copies the browser may photograph.
async function withLocalPhotos(r: ResolvedTb): Promise<ResolvedTb> {
  const urls = photoUrls(r);
  if (!urls.length) return r;
  let map: Record<string, string> = {};
  try { map = (await callServer<{ photos: Record<string, string> }>('/api/photos/get', { urls }, true)).photos || {}; } catch { /* no photos in the PDF */ }
  const sw = (u?: string) => (u && map[u]) || u || '';
  const p = JSON.parse(JSON.stringify(r.p));
  p.coverPhoto = sw(p.coverPhoto);
  p.trainers = (p.trainers || []).map((t: any) => ({ ...t, photo: sw(t.photo) }));
  p.activities = (p.activities || []).map((a: any) => ({ ...a, photos: (a.photos || []).slice(0, 1).map(sw) }));
  p.venues = (p.venues || []).map((v: any) => ({ ...v, photos: (v.photos || []).slice(0, 1).map(sw) }));
  return { ...r, p, clientLogo: sw(r.clientLogo) };
}

async function settle(host: HTMLElement) {
  const doc: any = host.ownerDocument;
  if (doc.fonts?.ready) await doc.fonts.ready;
  const imgs = Array.from(host.querySelectorAll('img'));
  await Promise.all(imgs.map(img => (img.complete ? Promise.resolve() : new Promise<void>(res => {
    img.addEventListener('load', () => res(), { once: true });
    img.addEventListener('error', () => res(), { once: true });
    window.setTimeout(res, 8000);
  }))));
  await new Promise(r => window.setTimeout(r, 150));
}

export async function makeTbPdf(rIn: ResolvedTb, pax: number): Promise<Blob> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas-pro'), import('jspdf')]);
  const r = await withLocalPhotos(rIn);
  // Drawn in a hidden computer-width frame, so the website uses its computer layout even when the PDF is made on a phone.
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = `position:fixed;left:-12000px;top:0;width:${WIDTH}px;height:1200px;border:0;z-index:-1;`;
  document.body.appendChild(frame);
  await new Promise<void>(res => { if (frame.contentDocument?.readyState === 'complete') res(); else frame.addEventListener('load', () => res(), { once: true }); window.setTimeout(res, 1500); });
  const fdoc = frame.contentDocument!;
  document.querySelectorAll('style, link[rel="stylesheet"]').forEach(n => fdoc.head.appendChild(n.cloneNode(true)));
  fdoc.body.style.margin = '0';
  const host = fdoc.createElement('div');
  host.style.cssText = `width:${WIDTH}px;background:#fff;`;
  fdoc.body.appendChild(host);
  const root = createRoot(host);
  try {
    root.render(React.createElement(TeambuildingSite, { r, mode: 'pdf', pax }));
    await new Promise(res => window.setTimeout(res, 200));
    await settle(host);
    host.querySelectorAll('[data-pdf-skip]').forEach(el => ((el as HTMLElement).style.display = 'none'));
    const blocks = Array.from(host.querySelectorAll('[data-pdf-block]')) as HTMLElement[];
    if (!blocks.length) throw new Error('The proposal could not be drawn.');

    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    // Sections follow one another down the page; a section that doesn't fit the space left starts a new page, and one
    // taller than a page is cut between its cards. The cover is a page of its own.
    let page: HTMLCanvasElement | null = null;
    let y = 0;
    let pageH = 0;
    let done = 0;
    const flush = () => {
      if (!page) return;
      if (done++) pdf.addPage();
      pdf.addImage(page.toDataURL('image/jpeg', 0.8), 'JPEG', 0, 0, A4_W, A4_H);
      page = null;
    };
    const newPage = (w: number) => {
      flush();
      page = document.createElement('canvas');
      page.width = w; page.height = pageH;
      const c = page.getContext('2d')!; c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, pageH);
      y = 0;
    };
    for (let bi = 0; bi < blocks.length; bi++) {
      const block = blocks[bi];
      const top0 = block.getBoundingClientRect().top;
      // Good places to cut: the bottom of each card.
      const breaks = Array.from(block.querySelectorAll('[data-pdf-keep]'))
        .map(el => Math.round((el.getBoundingClientRect().bottom - top0 + 12) * SCALE))
        .sort((a, b) => a - b);
      const canvas = await html2canvas(block, { scale: SCALE, useCORS: true, backgroundColor: '#ffffff', logging: false, windowWidth: WIDTH });
      pageH = Math.floor(A4_H * (canvas.width / A4_W));
      const isCover = bi === 0;
      if (!page || (y > 0 && canvas.height > pageH - y)) newPage(canvas.width);
      let top = 0;
      while (top < canvas.height - 4) {
        if (!page) newPage(canvas.width);
        const room = pageH - y;
        let cut = Math.min(top + room, canvas.height);
        if (cut < canvas.height) {
          const at = breaks.filter(b => b <= cut && b > top + room * 0.3).pop();
          if (at) cut = at;
        }
        page!.getContext('2d')!.drawImage(canvas, 0, top, canvas.width, cut - top, 0, y, canvas.width, cut - top);
        y += cut - top;
        top = cut;
        if (top < canvas.height - 4) newPage(canvas.width);
      }
      if (isCover) flush();
    }
    flush();
    if (rIn.company) watermark(pdf, rIn.company);
    pdf.setProperties({ title: `Teambuilding proposal ${rIn.p.refNumber || ''}`.trim(), author: 'NEXT Academy' });
    return pdf.output('blob');
  } finally {
    root.unmount();
    frame.remove();
  }
}

// A faint diagonal line of the client's name, repeated across every page.
function watermark(pdf: any, text: string) {
  const n = pdf.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    pdf.setPage(i);
    pdf.saveGraphicsState();
    pdf.setGState(new pdf.GState({ opacity: 0.07 }));
    pdf.setTextColor(30, 45, 41);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(18);
    for (let y = 20; y < A4_H + 40; y += 55) {
      for (let x = -40; x < A4_W; x += 110) pdf.text(text, x + ((y / 55) % 2) * 55, y, { angle: 28 });
    }
    pdf.restoreGraphicsState();
  }
}
