// Makes a quotation PDF in the browser (2026-10-18), so it can be downloaded in one click, attached to an
// Outlook email or shared to WhatsApp. It draws the same printable layout (QuotationDocument) off screen,
// takes a picture of it and cuts that into A4 pages, preferring a blank line as the place to cut so text
// rows aren't split across pages.

import React from 'react';
import { createRoot } from 'react-dom/client';
import { Quotation } from '../types';
import QuotationDocument from '../components/QuotationDocument';

const PAGE_W_PX = 900;          // drawn at the on-screen preview's width (so the table fits), then shrunk to A4
const SCALE = 2;                // sharper text
const A4_W_MM = 210;
const A4_H_MM = 297;
const MARGIN_MM = 12;           // top margin on continued pages, and bottom margin on every page

export const pdfFileName = (q: Quotation) =>
  `Quotation ${String(q.refNumber || q.id).replace(/[\\/:*?"<>|]+/g, '-')}${q.company ? ` - ${q.company.replace(/[\\/:*?"<>|]+/g, '').slice(0, 60)}` : ''}.pdf`;

// Images from other sites (the logo) are copied in first, so the picture of the page can include them.
async function inlineImages(el: HTMLElement) {
  const imgs = Array.from(el.querySelectorAll('img')).filter(img => /^https?:/.test(img.src) && !img.src.startsWith(location.origin));
  await Promise.all(imgs.map(async img => {
    try {
      const blob = await (await fetch(img.src, { mode: 'cors', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(6000) })).blob();
      img.src = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(blob); });
    } catch { /* leave it; the PDF just won't have that image */ }
  }));
}

async function waitForImages(el: HTMLElement) {
  const imgs = Array.from(el.querySelectorAll('img'));
  await Promise.all(imgs.map(img => (img.complete ? Promise.resolve() : new Promise<void>(res => {
    img.addEventListener('load', () => res(), { once: true });
    img.addEventListener('error', () => res(), { once: true });
    window.setTimeout(res, 5000);
  }))));
}

// The lowest (almost) all-white row between `from` and `to` of the picture, or -1. Used to cut pages cleanly.
function lastBlankRow(ctx: CanvasRenderingContext2D, from: number, to: number, width: number) {
  const data = ctx.getImageData(0, from, width, to - from).data;
  for (let y = to - from - 1; y >= 0; y--) {
    let blank = true;
    for (let x = 0; x < width && blank; x += 4) {    // every 4th pixel is enough
      const i = (y * width + x) * 4;
      if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) blank = false;
    }
    if (blank) return from + y;
  }
  return -1;
}

export async function makeQuotationPdf(q: Quotation): Promise<Blob> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas-pro'), import('jspdf')]);

  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${PAGE_W_PX}px;background:#fff;z-index:-1;`;
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    root.render(React.createElement(QuotationDocument, { q }));
    await new Promise(r => window.setTimeout(r, 150));
    const paper = host.querySelector('.print-paper') as HTMLElement | null;
    if (!paper) throw new Error('The quotation could not be drawn.');
    // A plain sheet: no card border, shadow or rounded corners, A4 margins.
    Object.assign(paper.style, { border: 'none', boxShadow: 'none', borderRadius: '0', minWidth: '0', maxWidth: 'none', width: `${PAGE_W_PX}px`, margin: '0', padding: '48px' });
    await inlineImages(paper);
    await waitForImages(paper);
    if ((document as any).fonts?.ready) await (document as any).fonts.ready;

    // Good places to start a new page: the bottom of each table row, paragraph, list item or heading.
    const paperTop = paper.getBoundingClientRect().top;
    const breaks = Array.from(new Set(Array.from(paper.querySelectorAll('tr, p, li, h1, h2, h3, h4, table, ul, ol'))
      .map(el => Math.round((el.getBoundingClientRect().bottom - paperTop) * SCALE)))).sort((a, b) => a - b);

    const canvas = await html2canvas(paper, { scale: SCALE, useCORS: true, backgroundColor: '#ffffff', logging: false, windowWidth: PAGE_W_PX });
    const ctx = canvas.getContext('2d')!;
    const pxPerMm = canvas.width / A4_W_MM;
    const pageHpx = Math.floor(A4_H_MM * pxPerMm);
    const marginPx = Math.round(MARGIN_MM * pxPerMm);
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });

    let top = 0;
    let first = true;
    while (top < canvas.height - 4) {
      // The first page already has its top margin in the layout; later pages get one added.
      const room = pageHpx - marginPx - (first ? 0 : marginPx);
      let cut = Math.min(top + room, canvas.height);
      if (cut < canvas.height) {
        const minCut = top + room * 0.6;
        const atBreak = breaks.filter(b => b <= cut && b > minCut).pop();
        if (atBreak) cut = atBreak;
        else {
          // No row or paragraph ends near the bottom: look for a blank line to cut on.
          const y = lastBlankRow(ctx, Math.floor(minCut), cut, canvas.width);
          if (y > top) cut = y;
        }
      }
      const slice = document.createElement('canvas');
      slice.width = canvas.width;
      slice.height = cut - top;
      const sctx = slice.getContext('2d')!;
      sctx.fillStyle = '#ffffff';
      sctx.fillRect(0, 0, slice.width, slice.height);
      sctx.drawImage(canvas, 0, top, canvas.width, slice.height, 0, 0, canvas.width, slice.height);
      if (!first) pdf.addPage();
      pdf.addImage(slice.toDataURL('image/jpeg', 0.85), 'JPEG', 0, first ? 0 : MARGIN_MM, A4_W_MM, slice.height / pxPerMm);
      first = false;
      top = cut;
    }
    pdf.setProperties({ title: `Quotation ${q.refNumber || ''}`.trim(), author: 'NEXT Academy' });
    return pdf.output('blob');
  } finally {
    root.unmount();
    host.remove();
  }
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
