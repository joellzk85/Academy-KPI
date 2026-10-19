import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Loader2, Phone, Mail } from 'lucide-react';
import logoUrl from '../assets/outline/next-logo.png';
import TeambuildingSite, { TB } from './TeambuildingSite';
import { formatPrice, priceFor, ResolvedTb } from '../lib/teambuilding';
import { EventType, VisitEvent, browserOf, deviceOf } from '../lib/proposalTracking';

// The client's private link to a teambuilding proposal: /p/<token> (push B, Joel 2026-10-19). No login. It talks only
// to the CRM server (serverProposalLinks.ts), which returns just what the website shows.
// - The same website as the CRM's Preview (TeambuildingSite), with the client's company name and today's date as a
//   faint watermark, and "Accept proposal" at the end.
// - Protection: no download button; printing gives a blank "Private & Confidential" page; right-click, copying, text
//   selection and image dragging are blocked.
// - Tracking (never shown or mentioned to the client): which section is on screen while the tab is visible, sent
//   about every 15 seconds and when the page closes, plus "possible" screenshot / print / copy / right-click attempts.
//   Not tracked when someone from NEXT Academy opens it (the CRM's Open button, or a browser logged in to the CRM).

type Gone = { code: string; message: string; contact?: { name: string; phone: string; email: string } };
type Accepted = { name: string; position: string; note?: string; packageName?: string; pax?: number; price?: number | null; at: number };

async function post<T>(path: string, body: any): Promise<T> {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let data: any = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok || !data?.ok) throw new Error(data?.error || 'Something went wrong. Please try again in a moment.');
  return data as T;
}

// Is someone from the team logged in to the CRM in this browser? (Firebase keeps the login in IndexedDB.)
async function teamBrowser(): Promise<boolean> {
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

const todayText = () => new Date().toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });

export default function ProposalLinkPage({ token }: { token: string }) {
  const [state, setState] = useState<{ loading: true } | { gone: Gone } | { r: ResolvedTb; accepted: Accepted | null }>({ loading: true });
  const [team, setTeam] = useState<boolean | null>(null);
  const [pax, setPax] = useState(0);
  const [chosen, setChosen] = useState('');

  useEffect(() => {
    document.title = 'Proposal · NEXT Academy';
    let live = true;
    (async () => {
      const t = await teamBrowser();
      if (!live) return;
      setTeam(t);
      try {
        const d = await post<any>('/api/proposal-link/get', { token, team: t });
        if (!live) return;
        if (d.gone) { setState({ gone: d.gone }); return; }
        const p = d.proposal;
        const r: ResolvedTb = { p: { ...p, id: '', kind: 'teambuilding' }, deal: null, client: null, ownerId: '', company: p.company, pax: p.pax, eventDate: p.eventDate, isHrdc: p.isHrdc, sections: p.sections };
        setPax(p.pax || 0);
        setState({ r, accepted: d.accepted });
      } catch (e: any) {
        if (live) setState({ gone: { code: 'error', message: e?.message || 'This page could not be loaded.' } });
      }
    })();
    return () => { live = false; };
  }, [token]);

  const ready = 'r' in state;
  useProtection(ready);
  useTracking(token, ready && team === false);

  if ('loading' in state) {
    return <div className="flex min-h-screen items-center justify-center bg-white" style={{ fontFamily: "'Poppins', sans-serif" }}><Loader2 className="h-8 w-8 animate-spin" style={{ color: TB.teal }} /></div>;
  }
  if ('gone' in state) return <GonePage g={state.gone} />;

  const { r, accepted } = state;
  return (
    <div className="tb-client">
      <style>{CLIENT_CSS}</style>
      <TeambuildingSite r={r} mode="client" pax={pax} onPax={setPax} chosen={chosen} onChosen={setChosen}
        watermark={`${r.company ? `${r.company} · ` : ''}${todayText()}`}
        endSlot={<AcceptBlock token={token} r={r} pax={pax} chosen={chosen} accepted={accepted}
          onAccepted={a => setState({ r, accepted: a })} />} />
      <div className="tb-print-note" aria-hidden="true">
        <img src={logoUrl} alt="" />
        <p>Private &amp; Confidential</p>
      </div>
    </div>
  );
}

// Blank "Private & Confidential" page when printed; no selecting text or dragging images.
const CLIENT_CSS = `
.tb-client { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
.tb-client input, .tb-client textarea { -webkit-user-select: text; user-select: text; }
.tb-client img { -webkit-user-drag: none; user-drag: none; pointer-events: auto; }
.tb-print-note { display: none; }
@media print {
  body * { visibility: hidden !important; }
  .tb-print-note, .tb-print-note * { visibility: visible !important; }
  .tb-print-note { display: flex !important; position: fixed; inset: 0; flex-direction: column; align-items: center; justify-content: center; gap: 16px; background: #fff; font-family: Poppins, sans-serif; font-size: 20px; font-weight: 600; letter-spacing: .2em; text-transform: uppercase; color: #1e2d29; }
  .tb-print-note img { height: 56px; }
}`;

// ---------- Accept proposal ----------
export function AcceptBlock({ token, r, pax, chosen, accepted, onAccepted, preview }: {
  token: string; r: ResolvedTb; pax: number; chosen: string; accepted: Accepted | null; onAccepted: (a: Accepted) => void;
  preview?: boolean;   // in the CRM's Preview: shown, but it does nothing
}) {
  const [name, setName] = useState('');
  const [position, setPosition] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pk = r.p.packages;
  const col = pk?.cols.find(c => c.id === chosen) || pk?.cols.find(c => c.highlight) || pk?.cols[0];
  const pr = col ? priceFor(pk, col.id, pax) : null;
  const field = 'w-full rounded-xl border-2 bg-white px-4 py-3 text-[15px] outline-none focus:border-[#50a88b]';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (preview) return;
    setError('');
    if (name.trim().length < 2) return setError('Please type your name.');
    if (position.trim().length < 2) return setError('Please type your position.');
    setBusy(true);
    try {
      const d = await post<{ accepted: Accepted }>('/api/proposal-link/accept', { token, name, position, note, packageId: col?.id || '', pax });
      onAccepted(d.accepted);
    } catch (err: any) { setError(err?.message || 'Please try again.'); } finally { setBusy(false); }
  };

  return (
    <section id="tb-accept" className="scroll-mt-14 px-4 py-14 sm:px-6 sm:py-20" style={{ background: TB.mintLight }}>
      <div className="mx-auto max-w-2xl">
        {accepted ? (
          <div className="rounded-3xl bg-white p-6 text-center shadow-[0_20px_60px_-30px_rgba(30,45,41,0.45)] sm:p-10">
            <CheckCircle2 className="mx-auto h-14 w-14" style={{ color: TB.teal }} />
            <h2 className="mt-4 text-2xl font-bold sm:text-3xl">Thank you, {accepted.name}!</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-[#3c4c47]">
              This proposal was accepted by {accepted.name} ({accepted.position}) on {new Date(accepted.at).toLocaleDateString('en-MY', { day: 'numeric', month: 'long', year: 'numeric' })}
              {accepted.packageName ? ` for package "${accepted.packageName}"${accepted.pax ? `, ${accepted.pax} participants` : ''}` : ''}.
              {' '}{r.p.ownerName || 'Our team'} will be in touch with the next steps.
            </p>
          </div>
        ) : (
          <form onSubmit={submit} className="rounded-3xl bg-white p-6 shadow-[0_20px_60px_-30px_rgba(30,45,41,0.45)] sm:p-10">
            <p className="text-sm font-semibold uppercase tracking-[0.2em]" style={{ color: TB.teal }}>Ready to go?</p>
            <h2 className="mt-2 text-3xl font-bold">Accept this proposal</h2>
            {col && (
              <p className="mt-3 rounded-2xl px-4 py-3 text-[15px]" style={{ background: TB.mintLight }}>
                Package <strong>"{col.name}"</strong>{pax ? <> for <strong>{pax} participants</strong></> : null}
                {pr?.price ? <>: <strong>{formatPrice(pr.price)}</strong></> : <>: we'll confirm the price with you</>}
              </p>
            )}
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-semibold">Your name<input value={name} onChange={e => setName(e.target.value)} className={`${field} mt-1`} style={{ borderColor: TB.mint }} autoComplete="name" disabled={preview} /></label>
              <label className="block text-sm font-semibold">Your position<input value={position} onChange={e => setPosition(e.target.value)} className={`${field} mt-1`} style={{ borderColor: TB.mint }} autoComplete="organization-title" disabled={preview} /></label>
            </div>
            <label className="mt-3 block text-sm font-semibold">Note <span className="font-normal text-[#5b6b66]">(optional)</span>
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} className={`${field} mt-1 resize-y`} style={{ borderColor: TB.mint }} disabled={preview} />
            </label>
            {error && <p role="alert" className="mt-3 text-sm font-medium text-[#b42318]">{error}</p>}
            <button type="submit" disabled={busy || preview} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full px-6 py-4 text-lg font-bold text-white shadow-lg transition-transform hover:-translate-y-0.5 disabled:opacity-70 sm:w-auto" style={{ background: TB.tealDark }}>
              {busy && <Loader2 className="h-5 w-5 animate-spin" />}Accept proposal
            </button>
            <p className="mt-3 text-sm text-[#5b6b66]">{preview ? 'The client sees this at the end of their link. It does nothing in this preview.' : 'Accepting tells our team you would like to go ahead. We will then send the quotation for your confirmation.'}</p>
          </form>
        )}
      </div>
    </section>
  );
}

function GonePage({ g }: { g: Gone }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f1f8f5] px-4" style={{ fontFamily: "'Poppins', sans-serif" }}>
      <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-xl">
        <img src={logoUrl} alt="NEXT Academy" className="mx-auto h-12 w-auto" />
        <h1 className="mt-6 text-2xl font-bold text-[#1e2d29]">{g.code === 'link-expired' ? 'This proposal has expired' : g.code === 'link-stopped' ? 'This proposal is no longer active' : 'Proposal not available'}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-[#3c4c47]">
          {g.contact ? `Please contact ${g.contact.name || 'NEXT Academy'} for the latest version. We'll be happy to help.` : g.message}
        </p>
        {g.contact && (
          <div className="mt-5 space-y-2 text-[15px]">
            {g.contact.name && <p className="font-semibold text-[#1e2d29]">{g.contact.name}, NEXT Academy</p>}
            <a href={`tel:${g.contact.phone.replace(/\s/g, '')}`} className="flex items-center justify-center gap-2" style={{ color: TB.tealDark }}><Phone className="h-4 w-4" />{g.contact.phone}</a>
            <a href={`mailto:${g.contact.email}`} className="flex items-center justify-center gap-2" style={{ color: TB.tealDark }}><Mail className="h-4 w-4" />{g.contact.email}</a>
          </div>
        )}
        <p className="mt-8 text-xs font-semibold uppercase tracking-[0.2em] text-[#5b6b66]">Private &amp; Confidential</p>
      </div>
    </div>
  );
}

// ---------- Protection ----------
function useProtection(on: boolean) {
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

// ---------- Tracking ----------
const SECTION_IDS = ['cover', 'objectives', 'trainers', 'agenda', 'activities', 'venues', 'packages', 'takeaways', 'hrdc', 'terms', 'accept'];

function useTracking(token: string, on: boolean) {
  const visitId = useMemo(() => Array.from(crypto.getRandomValues(new Uint8Array(12))).map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 20), []);
  const acc = useRef<Record<string, number>>({});
  const events = useRef<VisitEvent[]>([]);
  const lastShortcut = useRef(0);
  useEffect(() => {
    if (!on) return;
    const base = { token, visitId, device: deviceOf(navigator.userAgent, navigator.maxTouchPoints || 0, window.innerWidth), browser: browserOf(navigator.userAgent) };
    const take = () => {
      const body = { ...base, add: acc.current, events: events.current };
      acc.current = {};
      events.current = [];
      return body;
    };
    const hasData = () => Object.keys(acc.current).length > 0 || events.current.length > 0;
    const send = () => {
      if (!hasData()) return;
      fetch('/api/proposal-link/visit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(take()), keepalive: true }).catch(() => {});
    };
    const beacon = () => {
      if (!hasData()) return;
      const blob = new Blob([JSON.stringify(take())], { type: 'application/json' });
      if (!navigator.sendBeacon?.('/api/proposal-link/visit', blob)) send();
    };
    const record = (type: EventType, how?: string) => {
      const now = Date.now();
      // The same kind within 3 seconds is one attempt.
      if (events.current.some(e => e.type === type && now - e.at < 3000)) return;
      events.current.push({ type, at: now, ...(how ? { how } : {}) });
    };
    // Which section is in the middle of the screen, once a second, while the page is visible.
    const tick = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const mid = window.innerHeight / 2;
      const key = SECTION_IDS.find(k => {
        const el = document.getElementById(`tb-${k}`);
        if (!el) return false;
        const b = el.getBoundingClientRect();
        return b.top <= mid && b.bottom >= mid;
      });
      if (key) acc.current[key] = (acc.current[key] || 0) + 1;
    }, 1000);
    const every = window.setInterval(send, 15000);
    const onVis = () => { if (document.visibilityState === 'hidden') beacon(); };
    const onKey = (e: KeyboardEvent) => {
      const k = e.key || '';
      if (k === 'PrintScreen' || e.code === 'PrintScreen') { record('screenshot', 'Print Screen key'); return; }
      if (e.metaKey && e.shiftKey && ['3', '4', '5', '#', '$', '%'].includes(k)) { record('screenshot', 'Cmd+Shift+3/4/5'); return; }
      if (e.shiftKey && (k === 's' || k === 'S') && (e.metaKey || e.getModifierState?.('OS'))) { record('screenshot', 'Win+Shift+S'); return; }
      if ((e.metaKey || e.ctrlKey) && (k === 'p' || k === 'P')) { e.preventDefault(); record('print', 'Ctrl+P'); return; }
      if ((e.metaKey || e.ctrlKey) && (k === 's' || k === 'S')) { e.preventDefault(); return; }
      if ((e.metaKey || e.ctrlKey) && (k === 'c' || k === 'C') && !(e.target as HTMLElement)?.closest?.('input, textarea')) record('copy', 'Ctrl+C');
      if (e.metaKey || k === 'Meta' || k === 'OS') lastShortcut.current = Date.now();
    };
    const onKeyUp = (e: KeyboardEvent) => { if (e.key === 'PrintScreen' || e.code === 'PrintScreen') record('screenshot', 'Print Screen key'); };
    // Screenshot tools often take the focus away right after their shortcut.
    const onBlur = () => { if (Date.now() - lastShortcut.current < 1500) record('screenshot', 'Window lost focus after a shortcut'); };
    const onCopy = (e: Event) => { if (!(e.target as HTMLElement)?.closest?.('input, textarea')) record('copy'); };
    const onMenu = () => record('rightclick');
    const onPrint = () => record('print');
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', beacon);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);
    document.addEventListener('copy', onCopy);
    document.addEventListener('contextmenu', onMenu);
    window.addEventListener('beforeprint', onPrint);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(every);
      beacon();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', beacon);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('contextmenu', onMenu);
      window.removeEventListener('beforeprint', onPrint);
    };
  }, [on]);
}
