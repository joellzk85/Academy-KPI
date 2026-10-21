import { useLayoutEffect, useRef } from 'react';
import { auth } from '../lib/firebase';

// Grab bar on the left edge of every side panel. Dragging it sets the --panel-w width that all
// side panels share (see panelWidth in index.css); double-click goes back to the default.
// The width is remembered per person on this browser. Hidden on phones, where panels are full screen.
const MIN_PX = 384;
const MAX_SHARE = 0.95;
const key = () => `crm:panelWidth:${auth.currentUser?.uid ?? 'anon'}`;

function applyWidth(px: number | null) {
  const root = document.documentElement.style;
  if (px == null) root.removeProperty('--panel-w');
  else root.setProperty('--panel-w', `${Math.round(px)}px`);
}

function clamp(px: number) {
  return Math.min(Math.max(px, MIN_PX), window.innerWidth * MAX_SHARE);
}

function save(px: number | null) {
  try {
    if (px == null) localStorage.removeItem(key());
    else localStorage.setItem(key(), String(Math.round(px)));
  } catch { /* storage blocked: width still works until the page reloads */ }
}

function load(): number | null {
  try {
    const n = Number(localStorage.getItem(key()));
    return n > 0 ? n : null;
  } catch { return null; }
}

export default function PanelResizer() {
  const dragging = useRef(false);

  useLayoutEffect(() => {
    const saved = load();
    applyWidth(saved == null ? null : clamp(saved));
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    applyWidth(clamp(window.innerWidth - e.clientX));
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    const px = clamp(window.innerWidth - e.clientX);
    applyWidth(px);
    save(px);
  };

  const reset = (e: React.MouseEvent) => {
    e.stopPropagation();
    applyWidth(null);
    save(null);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Drag to change the panel width (double-click to reset)"
      title="Drag to change the width · double-click to reset"
      className="group hidden w-3 shrink-0 cursor-col-resize touch-none items-center justify-center md:flex"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={e => e.stopPropagation()}
      onDoubleClick={reset}
    >
      <span className="h-14 w-1.5 rounded-full bg-white/70 shadow transition-colors group-hover:bg-accent" />
    </div>
  );
}
