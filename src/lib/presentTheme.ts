import React, { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';

// The team meeting's set-up (Joel, 2026-10-21): the title slide's wording, the question for the week and the look
// (company colours and font). One copy for everyone, in present_settings/main; Management and Admin change it.
// The look applies to every slideshow and "Save as PDF", not to the rest of the CRM.

export interface PresentSettings {
  title: string;
  question: string;
  primary: string;      // main colour: title slide, charts, highlights
  text: string;         // text colour
  background: string;   // slide background
  font: string;         // a Google font from PRESENT_FONTS
  updatedBy?: string;
  updatedAt?: number;
}

// NEXT Academy's company identity, as given by Joel.
export const DEFAULT_PRESENT_SETTINGS: PresentSettings = {
  title: 'Weekly review',
  question: '',
  primary: '#5BC09F',
  text: '#58585A',
  background: '#FFFFFF',
  font: 'Archivo',
};

export const PRESENT_FONTS = ['Archivo', 'Plus Jakarta Sans', 'Poppins', 'Inter', 'Montserrat', 'Open Sans', 'Roboto', 'Lato'];

export const isHex = (s: string) => /^#[0-9a-fA-F]{6}$/.test(s);

export function usePresentSettings(): PresentSettings {
  const [s, setS] = useState<PresentSettings>(DEFAULT_PRESENT_SETTINGS);
  useEffect(() => onSnapshot(doc(db, 'present_settings', 'main'),
    d => setS(cleanSettings(d.data())), () => setS(DEFAULT_PRESENT_SETTINGS)), []);
  return s;
}

export function cleanSettings(raw: any): PresentSettings {
  const d = DEFAULT_PRESENT_SETTINGS;
  const r = raw || {};
  return {
    ...r,
    title: typeof r.title === 'string' && r.title.trim() ? r.title : d.title,
    question: typeof r.question === 'string' ? r.question : '',
    primary: isHex(r.primary || '') ? r.primary : d.primary,
    text: isHex(r.text || '') ? r.text : d.text,
    background: isHex(r.background || '') ? r.background : d.background,
    font: PRESENT_FONTS.includes(r.font) ? r.font : d.font,
  };
}

// Blend two colours: t = 0 gives a, t = 1 gives b.
export function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const x = p(a), y = p(b);
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

// Chart colours in the meeting's look: main colour first, then a lighter shade, then the usual contrasting ones.
export function presentPalette(s: PresentSettings): string[] {
  return [s.primary, mix(s.primary, '#FFFFFF', 0.45), '#E0A458', s.text, '#8FA3BF', '#B45309', '#7C6CB0', '#C2554B'];
}

// The CRM's colour tokens (src/index.css) redefined inside the slideshow and the PDF, so every slide takes the look.
export function presentStyle(s: PresentSettings): React.CSSProperties {
  const font = `"${s.font}", ui-sans-serif, system-ui, sans-serif`;
  return {
    '--color-accent': s.primary,
    '--color-accent-soft': mix(s.primary, '#FFFFFF', 0.85),
    '--color-ink': s.text,
    '--color-ink-soft': mix(s.text, '#FFFFFF', 0.25),
    '--font-sans': font,
    fontFamily: font,
    background: s.background,
    color: s.text,
  } as React.CSSProperties;
}

// Loads the chosen Google font once.
export function useGoogleFont(font: string) {
  useEffect(() => {
    if (!PRESENT_FONTS.includes(font)) return;
    const id = `gf-${font.replace(/\s+/g, '-')}`;
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${font.replace(/\s+/g, '+')}:wght@400;500;600;700;800&display=swap`;
    document.head.appendChild(link);
  }, [font]);
}

// "19 October 2026"
export const longDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
