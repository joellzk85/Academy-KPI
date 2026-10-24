import { useEffect, useMemo, useRef } from 'react';
import { BANDS, COLS, EventType, Tap, VisitEvent, browserOf, deviceOf } from './proposalTracking';

// The tracker on every client link page (/q, /o, /p; Joel 2026-10-20). Never shown or mentioned to the client.
// Once a second, while the page is visible:
// - visible time, and active time (scrolled, moved the mouse, tapped or typed in the last 30 seconds);
// - the part in the middle of the screen (its seconds);
// - the reading heatmap: each band of each part that is on screen gets a second (parts are marked data-track="<key>");
// - on a computer, where the mouse rests (part, row, column), if it moved in the last 5 seconds;
// - how far down the page they got.
// Plus clicks and taps (where), "possible" screenshot / print / copy / download attempts, and on teambuilding pages
// the packages and group sizes the client tries (`pick`). Sent about every 15 seconds and when the tab is hidden or
// closed (sendBeacon) to /api/link-visit (serverLinkVisits.ts).

const IDLE_MS = 30_000;
const randomId = (n = 20) => Array.from(crypto.getRandomValues(new Uint8Array(n))).map(b => (b % 36).toString(36)).join('');

// A random id kept in this browser, so the CRM can tell "opened on 3 different devices" (possibly forwarded).
// Also used by the Login log's "New device" (lib/loginActivity.ts).
export function deviceId(): string {
  try {
    const old = localStorage.getItem('next_dev');
    if (old && /^[a-z0-9]{10,40}$/.test(old)) return old;
    const id = randomId();
    localStorage.setItem('next_dev', id);
    return id;
  } catch { return ''; }
}

// The marked part at a point, and where in it (0 to 1). The innermost wins.
function partAt(x: number, y: number): { s: string; x: number; y: number } | null {
  const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest?.('[data-track]') as HTMLElement | null;
  if (!el) return null;
  const b = el.getBoundingClientRect();
  if (!b.width || !b.height) return null;
  return { s: el.dataset.track || '', x: Math.min(1, Math.max(0, (x - b.left) / b.width)), y: Math.min(1, Math.max(0, (y - b.top) / b.height)) };
}

export function useLinkTracking(token: string, on: boolean) {
  const visitId = useMemo(() => randomId(20), []);
  const acc = useRef({ vis: 0, act: 0, add: {} as Record<string, number>, heat: {} as Record<string, number>, hover: {} as Record<string, number>, taps: [] as Tap[], picks: {} as Record<string, number>, events: [] as VisitEvent[], depth: 0 });
  const record = useRef<(type: EventType, how?: string) => void>(() => {});

  useEffect(() => {
    if (!on) return;
    const base = { token, visitId, deviceId: deviceId(), device: deviceOf(navigator.userAgent, navigator.maxTouchPoints || 0, window.innerWidth), browser: browserOf(navigator.userAgent) };
    let lastAct = Date.now();
    let mouse: { x: number; y: number; at: number } | null = null;
    let lastShortcut = 0;
    const a = acc.current;
    const bump = (m: Record<string, number>, k: string, n = 1) => { m[k] = (m[k] || 0) + n; };

    const hasData = () => a.vis > 0 || a.events.length > 0 || a.taps.length > 0 || Object.keys(a.picks).length > 0;
    const take = (end = false) => {
      const body = { ...base, vis: a.vis, act: a.act, add: a.add, heat: a.heat, hover: a.hover, taps: a.taps, picks: a.picks, events: a.events, depth: a.depth, ...(end ? { end: true } : {}) };
      Object.assign(a, { vis: 0, act: 0, add: {}, heat: {}, hover: {}, taps: [], picks: {}, events: [] });
      return body;
    };
    const send = () => {
      if (!hasData()) return;
      fetch('/api/link-visit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(take()), keepalive: true }).catch(() => {});
    };
    const beacon = () => {
      // Always tell the server the page was put away, so "Reading now" ends.
      const blob = new Blob([JSON.stringify(take(true))], { type: 'application/json' });
      if (!navigator.sendBeacon?.('/api/link-visit', blob)) {
        fetch('/api/link-visit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(take(true)), keepalive: true }).catch(() => {});
      }
    };
    record.current = (type, how) => {
      const now = Date.now();
      // The same kind within 3 seconds is one attempt.
      if (a.events.some(e => e.type === type && now - e.at < 3000)) return;
      a.events.push({ type, at: now, ...(how ? { how } : {}) });
    };

    const tick = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      a.vis++;
      if (now - lastAct < IDLE_MS) a.act++;
      const vh = window.innerHeight;
      const mid = vh / 2;
      let middle = '';
      document.querySelectorAll<HTMLElement>('[data-track]').forEach(el => {
        const k = el.dataset.track || '';
        const b = el.getBoundingClientRect();
        if (!k || b.height <= 0 || b.bottom <= 0 || b.top >= vh) return;
        if (b.top <= mid && b.bottom >= mid) middle = k;   // later (inner) parts win
        // Reading heat: the bands of this part in the reading zone (the middle 70% of the screen, where eyes rest).
        const zoneTop = vh * 0.15, zoneBottom = vh * 0.85;
        if (b.bottom <= zoneTop || b.top >= zoneBottom) return;
        const from = Math.max(0, Math.floor(((zoneTop - b.top) / b.height) * BANDS));
        const to = Math.min(BANDS - 1, Math.floor(((zoneBottom - b.top) / b.height) * BANDS));
        for (let i = Math.max(0, from); i <= to; i++) bump(a.heat, `${k}_${i}`);
      });
      if (middle) bump(a.add, middle);
      // Where the mouse rests (computers).
      if (mouse && now - mouse.at < 5000) {
        const p = partAt(mouse.x, mouse.y);
        if (p) bump(a.hover, `${p.s}_${Math.min(BANDS - 1, Math.floor(p.y * BANDS))}_${Math.min(COLS - 1, Math.floor(p.x * COLS))}`);
      }
      const doc = document.documentElement;
      const depth = Math.min(1, (window.scrollY + vh) / Math.max(1, doc.scrollHeight));
      if (depth > a.depth) a.depth = Math.round(depth * 1000) / 1000;
    }, 1000);
    const every = window.setInterval(send, 15000);

    const active = () => { lastAct = Date.now(); };
    const onMove = (e: PointerEvent) => { if (e.pointerType === 'mouse') mouse = { x: e.clientX, y: e.clientY, at: Date.now() }; active(); };
    const onDown = (e: PointerEvent) => {
      active();
      if (e.button !== 0) return;   // right-clicks are counted as attempts, not clicks
      const p = partAt(e.clientX, e.clientY);
      if (p && a.taps.length < 50) a.taps.push({ ...p, at: Date.now(), ...(e.pointerType === 'touch' ? { touch: true } : {}) });
    };
    const onVis = () => { if (document.visibilityState === 'hidden') beacon(); else active(); };
    const onKey = (e: KeyboardEvent) => {
      active();
      const k = e.key || '';
      if (k === 'PrintScreen' || e.code === 'PrintScreen') { record.current('screenshot', 'Print Screen key'); return; }
      if (e.metaKey && e.shiftKey && ['3', '4', '5', '#', '$', '%'].includes(k)) { record.current('screenshot', 'Cmd+Shift+3/4/5'); return; }
      if (e.shiftKey && (k === 's' || k === 'S') && (e.metaKey || e.getModifierState?.('OS'))) { record.current('screenshot', 'Win+Shift+S'); return; }
      if ((e.metaKey || e.ctrlKey) && (k === 'p' || k === 'P')) { e.preventDefault(); record.current('print', 'Ctrl+P'); return; }
      if ((e.metaKey || e.ctrlKey) && (k === 's' || k === 'S')) { e.preventDefault(); record.current('save', 'Ctrl+S'); return; }
      if ((e.metaKey || e.ctrlKey) && (k === 'c' || k === 'C') && !(e.target as HTMLElement)?.closest?.('input, textarea')) record.current('copy', 'Ctrl+C');
      if (e.metaKey || k === 'Meta' || k === 'OS') lastShortcut = Date.now();
    };
    const onKeyUp = (e: KeyboardEvent) => { if (e.key === 'PrintScreen' || e.code === 'PrintScreen') record.current('screenshot', 'Print Screen key'); };
    // Screenshot tools often take the focus away right after their shortcut.
    const onBlur = () => { if (Date.now() - lastShortcut < 1500) record.current('screenshot', 'Window lost focus after a shortcut'); };
    const onCopy = (e: Event) => { if (!(e.target as HTMLElement)?.closest?.('input, textarea')) record.current('copy'); };
    const onMenu = () => record.current('rightclick');
    const onPrint = () => record.current('print');
    const onDrag = (e: DragEvent) => { if ((e.target as HTMLElement)?.tagName === 'IMG') record.current('save', 'Dragged a picture'); };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('scroll', active, { passive: true });
    window.addEventListener('wheel', active, { passive: true });
    window.addEventListener('touchmove', active, { passive: true });
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', beacon);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);
    document.addEventListener('copy', onCopy);
    document.addEventListener('contextmenu', onMenu);
    document.addEventListener('dragstart', onDrag);
    window.addEventListener('beforeprint', onPrint);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(every);
      beacon();
      record.current = () => {};
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', active);
      window.removeEventListener('wheel', active);
      window.removeEventListener('touchmove', active);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', beacon);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('contextmenu', onMenu);
      document.removeEventListener('dragstart', onDrag);
      window.removeEventListener('beforeprint', onPrint);
    };
  }, [on, token, visitId]);

  // Teambuilding: the client chose a package or changed the group size.
  const pick = (key: string) => {
    if (!on) return;
    const k = key.replace(/[.~*/[\]]/g, ' ').slice(0, 64);
    acc.current.picks[k] = (acc.current.picks[k] || 0) + 1;
  };
  return { pick };
}

// Is someone from the team logged in to the CRM in this browser? (Firebase keeps the login in IndexedDB.) Team opens
// are never counted or tracked.
export async function teamBrowser(): Promise<boolean> {
  if (new URLSearchParams(window.location.search).get('team') === '1') return true;
  try {
    return await new Promise<boolean>(resolve => {
      const req = indexedDB.open('firebaseLocalStorageDb');
      req.onerror = () => resolve(false);
      req.onupgradeneeded = () => { req.transaction?.abort(); resolve(false); };
      req.onsuccess = () => {
        const db = req.result;
        try {
          const tx = db.transaction('firebaseLocalStorage', 'readonly');
          const all = tx.objectStore('firebaseLocalStorage').getAllKeys();
          all.onsuccess = () => { resolve((all.result || []).some(k => String(k).startsWith('firebase:authUser:'))); db.close(); };
          all.onerror = () => { resolve(false); db.close(); };
        } catch { resolve(false); db.close(); }
      };
      window.setTimeout(() => resolve(false), 1500);
    });
  } catch { return false; }
}
