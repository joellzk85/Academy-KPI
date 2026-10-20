import React, { useEffect, useState } from 'react';
import logoUrl from '../assets/outline/next-logo.png';

// Protection on every client link page (Joel, 2026-10-20: "client cannot download or screenshot"):
// - no download or print buttons; printing gives a blank "Private & Confidential" page;
// - right-click, copying, cutting, text selection and dragging pictures are blocked;
// - a faint repeating watermark of the client's company name and today's date;
// - on a computer, the page blurs as soon as the window loses focus (most screenshot tools, the Snipping Tool, switching
//   to another program) or the Windows / Cmd key is pressed, and clears when they come back.
// A phone's own screenshot buttons, or a photo of the screen, can't be stopped by any website: the watermark is there
// for that. Nothing on the page says it is protected or tracked.

export function useProtection(on: boolean) {
  useEffect(() => {
    if (!on) return;
    const stop = (e: Event) => { if (!(e.target as HTMLElement)?.closest?.('input, textarea')) e.preventDefault(); };
    const drag = (e: DragEvent) => e.preventDefault();
    document.addEventListener('contextmenu', stop);
    document.addEventListener('copy', stop);
    document.addEventListener('cut', stop);
    document.addEventListener('dragstart', drag);
    return () => {
      document.removeEventListener('contextmenu', stop);
      document.removeEventListener('copy', stop);
      document.removeEventListener('cut', stop);
      document.removeEventListener('dragstart', drag);
    };
  }, [on]);
}

// True while the page should be covered.
export function useBlurGuard(on: boolean): boolean {
  const [covered, setCovered] = useState(false);
  useEffect(() => {
    if (!on) { setCovered(false); return; }
    let timer = 0;
    const cover = () => { window.clearTimeout(timer); setCovered(true); };
    const uncover = (delay = 0) => { window.clearTimeout(timer); timer = window.setTimeout(() => { if (document.hasFocus()) setCovered(false); }, delay); };
    const onBlur = () => cover();
    const onFocus = () => uncover(150);
    const onVis = () => (document.visibilityState === 'hidden' ? cover() : uncover(150));
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Meta' || e.key === 'OS' || e.key === 'PrintScreen') cover(); };
    const onKeyUp = (e: KeyboardEvent) => { if (e.key === 'Meta' || e.key === 'OS' || e.key === 'PrintScreen') uncover(900); };
    const onDown = () => uncover(0);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [on]);
  return covered;
}

const GUARD_CSS = `
.link-guard { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
.link-guard input, .link-guard textarea { -webkit-user-select: text; user-select: text; }
.link-guard img { -webkit-user-drag: none; user-drag: none; }
.lg-print-note { display: none; }
@media print {
  .link-guard { display: none !important; }
  body * { visibility: hidden !important; }
  .lg-print-note, .lg-print-note * { visibility: visible !important; }
  .lg-print-note { display: flex !important; position: fixed; inset: 0; flex-direction: column; align-items: center; justify-content: center; gap: 16px; background: #fff; font-family: Poppins, sans-serif; font-size: 20px; font-weight: 600; letter-spacing: .2em; text-transform: uppercase; color: #1e2d29; }
  .lg-print-note img { height: 56px; }
}`;

// Wraps the client's page: styles, the print page, the watermark (when `watermark` is given) and the blur cover.
export default function LinkGuard({ on, watermark, children }: { on: boolean; watermark?: string; children: React.ReactNode }) {
  useProtection(on);
  const covered = useBlurGuard(on);
  return (
    <>
      <style>{GUARD_CSS}</style>
      <div className="link-guard">{children}</div>
      {watermark && <GuardWatermark text={watermark} />}
      {covered && (
        <div aria-hidden="true" className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-white/80 backdrop-blur-2xl">
          <img src={logoUrl} alt="" className="h-14 w-auto" />
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#1e2d29]">Private &amp; Confidential</p>
        </div>
      )}
      <div className="lg-print-note" aria-hidden="true">
        <img src={logoUrl} alt="" />
        <p>Private &amp; Confidential</p>
      </div>
    </>
  );
}

// A faint repeating line over the whole screen (stays put while scrolling).
export function GuardWatermark({ text }: { text: string }) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='420' height='260'><text x='20' y='150' transform='rotate(-24 210 130)' font-family='Poppins, sans-serif' font-size='20' font-weight='600' fill='%231e2d29' fill-opacity='0.07'>${text.replace(/[<>&'"#%]/g, '')}</text></svg>`;
  return <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[60]" style={{ backgroundImage: `url("data:image/svg+xml;utf8,${svg}")`, backgroundRepeat: 'repeat' }} />;
}

export const todayText = () => new Date().toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
