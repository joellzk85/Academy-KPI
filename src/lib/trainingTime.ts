// Training time (Joel, 2026-10-17): read from the deal's quotation ("Time", e.g. "9:00 AM – 5:00 PM"),
// unless a different time was typed on the deal (deal.trainingTime). Used by the deal panels and
// the Google Calendar training event (a timed event when the time can be read, else all day).

import { mainQuote } from './checklist';

export interface TrainingTime { text: string; from: 'deal' | 'quotation' }

export function trainingTimeOf(deal: any, dealQuotes: any[]): TrainingTime | null {
  const own = String(deal?.trainingTime || '').trim();
  if (own) return { text: own, from: 'deal' };
  const q = mainQuote(dealQuotes);
  const t = String(q?.time || '').trim();
  return t ? { text: t, from: 'quotation' } : null;
}

type HM = [number, number];

// One side of a range: "9", "9am", "9:30 AM", "09.00", "17:00". Meridiem is returned separately.
function side(s: string): { h: number; m: number; ap: '' | 'am' | 'pm' } | null {
  const x = s.trim().toLowerCase().replace(/\s+/g, '').replace(/(\d)\.(\d)/, '$1:$2');
  const m = x.match(/^(\d{1,2})(?::(\d{2}))?(am|pm|a\.m\.|p\.m\.)?$/);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2] || 0);
  if (h > 23 || min > 59) return null;
  const ap = m[3] ? (m[3].startsWith('a') ? 'am' : 'pm') : '';
  return { h, m: min, ap };
}

const to24 = (h: number, ap: '' | 'am' | 'pm') => (ap === 'pm' && h < 12 ? h + 12 : ap === 'am' && h === 12 ? 0 : h);

// "9:00 AM – 5:00 PM", "9am-5pm", "09:00 - 17:00", "9.00am to 5.00pm", "1-5pm" -> start and end (24-hour).
// Returns null when it can't be read, so the event stays all day.
export function parseTimeRange(text?: string): { start: HM; end: HM } | null {
  const parts = String(text || '').split(/\s*(?:-|–|—|\bto\b|\buntil\b)\s*/i).filter(p => p.trim());
  if (parts.length !== 2) return null;
  const a = side(parts[0]), b = side(parts[1]);
  if (!a || !b) return null;
  const end = to24(b.h, b.ap);
  let start = to24(a.h, a.ap || '');
  // "1-5pm": the start takes the end's pm when that still keeps it before the end.
  if (!a.ap && b.ap === 'pm' && a.h < 12 && a.h + 12 < end) start = a.h + 12;
  if (start * 60 + a.m >= end * 60 + b.m) return null;
  return { start: [start, a.m], end: [end, b.m] };
}
