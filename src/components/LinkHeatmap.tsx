import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Laptop, Loader2, MousePointer2, ScanEye, Smartphone, X } from 'lucide-react';
import QuotationDocument from './QuotationDocument';
import CourseOutlineDocument from './CourseOutlineDocument';
import TeambuildingSite from './TeambuildingSite';
import PhoneFrame from './PhoneFrame';
import { KIND_NOUN, deviceName, when } from './ProposalTracking';
import { DocLink } from '../lib/docLinks';
import { callServer, friendlyError } from '../lib/firebase';
import { BANDS, COLS, LinkKind, ProposalView, Tap, durationText, sectionName } from '../lib/proposalTracking';

// The heatmap of one client link (Joel, 2026-10-20), for Management and the people Management ticked: the document as
// the client saw it (/api/link-preview), with one of three layers on top: Reading (how long each band of each part was
// on screen), Mouse (where the mouse rested, computers only) and Clicks and taps. All visits or one visit.
// Teambuilding proposals can be shown at computer or phone width, because their layout differs.

type Layer = 'reading' | 'mouse' | 'taps';
type Box = { key: string; top: number; left: number; width: number; height: number };

// One hue, light (little time) to dark (a lot of time). Orange stands apart from the documents' teal and blue.
const shade = (v: number, max: number) => (v > 0 ? `rgba(234, 88, 12, ${(0.08 + 0.55 * Math.sqrt(v / Math.max(1, max))).toFixed(3)})` : 'transparent');

function gather(views: ProposalView[]) {
  const heat: Record<string, number[]> = {};
  const hover: Record<string, number[]> = {};
  const taps: Tap[] = [];
  views.forEach(v => {
    Object.entries(v.heat || {}).forEach(([k, n]) => {
      const i = k.lastIndexOf('_');
      const part = k.slice(0, i), band = Number(k.slice(i + 1));
      (heat[part] ||= Array(BANDS).fill(0))[band] += n;
    });
    Object.entries(v.hover || {}).forEach(([k, n]) => {
      const [part, r, c] = k.split('_');
      (hover[part] ||= Array(BANDS * COLS).fill(0))[Number(r) * COLS + Number(c)] += n;
    });
    taps.push(...(v.taps || []));
  });
  const max = (m: Record<string, number[]>) => Math.max(1, ...Object.values(m).flat());
  return { heat, hover, taps, heatMax: max(heat), hoverMax: max(hover) };
}

export default function LinkHeatmap({ link, views, onClose }: { link: DocLink; views: ProposalView[]; onClose: () => void }) {
  const kind = link.kind as LinkKind;
  const [doc, setDoc] = useState<{ doc?: any; proposal?: any; revised?: boolean } | null>(null);
  const [error, setError] = useState('');
  const [layer, setLayer] = useState<Layer>('reading');
  const [visitId, setVisitId] = useState('');
  const sorted = useMemo(() => [...views].sort((a, b) => b.startedAt - a.startedAt), [views]);
  const picked = visitId ? sorted.filter(v => v.id === visitId) : sorted;
  const phones = picked.filter(v => v.device === 'phone').length;
  const [phone, setPhone] = useState(phones > picked.length / 2);
  const data = useMemo(() => gather(picked), [picked]);
  const hasMouse = Object.keys(data.hover).length > 0;

  useEffect(() => {
    callServer('/api/link-preview', { token: link.token }, true)
      .then(d => setDoc(d))
      .catch(e => setError(friendlyError(e)));
  }, [link.token]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const page = (() => {
    if (!doc) return null;
    if (kind === 'quotation') return <div style={{ width: 900 }} className="mx-auto"><QuotationDocument q={doc.doc} /></div>;
    if (kind === 'outline') return <CourseOutlineDocument o={doc.doc} />;
    const p = doc.proposal;
    const r = { p: { ...p, id: '', kind: 'teambuilding' }, deal: null, client: null, ownerId: '', company: p.company, pax: p.pax, eventDate: p.eventDate, isHrdc: p.isHrdc, sections: p.sections };
    return <TeambuildingSite r={r as any} />;
  })();

  const chip = (on: boolean) => `inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-semibold ${on ? 'bg-ink text-white' : 'text-ink-soft hover:bg-surface'}`;
  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-ink/50" role="dialog" aria-modal="true" aria-label="Heatmap">
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-white px-4 py-3">
        <p className="min-w-0 flex-1 truncate font-semibold">Heatmap · {KIND_NOUN[kind]} {link.refNumber}</p>
        <div className="flex rounded-lg border border-line p-0.5" role="group" aria-label="What to show">
          <button type="button" className={chip(layer === 'reading')} onClick={() => setLayer('reading')}><ScanEye className="h-4 w-4" />Reading</button>
          <button type="button" className={chip(layer === 'mouse')} onClick={() => setLayer('mouse')} disabled={!hasMouse} title={hasMouse ? undefined : 'No computer visits with a mouse yet'}><MousePointer2 className="h-4 w-4" />Mouse</button>
          <button type="button" className={chip(layer === 'taps')} onClick={() => setLayer('taps')}>Clicks and taps ({data.taps.length})</button>
        </div>
        <select value={visitId} onChange={e => setVisitId(e.target.value)} aria-label="Which visits"
          className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none">
          <option value="">All {sorted.length} visits</option>
          {sorted.map(v => <option key={v.id} value={v.id}>{when(v.startedAt)} · {deviceName(v.device)}, {v.browser}</option>)}
        </select>
        {kind === 'teambuilding' && (
          <div className="flex rounded-lg border border-line p-0.5" role="group" aria-label="Screen size">
            <button type="button" className={chip(!phone)} onClick={() => setPhone(false)}><Laptop className="h-4 w-4" />Computer</button>
            <button type="button" className={chip(phone)} onClick={() => setPhone(true)}><Smartphone className="h-4 w-4" />Phone</button>
          </div>
        )}
        <button type="button" onClick={onClose} className="rounded-lg p-2 text-ink-soft hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line bg-white px-4 py-2 text-sm text-ink-soft">
        {layer === 'taps'
          ? <span className="flex items-center gap-3"><span className="flex items-center gap-1.5"><Dot /> Click (computer)</span><span className="flex items-center gap-1.5"><Dot touch /> Tap (phone or tablet)</span></span>
          : <span className="flex items-center gap-2">Less time<span className="h-2.5 w-28 rounded-full" style={{ background: `linear-gradient(to right, ${shade(1, 100)}, ${shade(100, 100)})` }} />More time</span>}
        <span>{layer === 'reading' ? 'How long each part was on the client\'s screen.' : layer === 'mouse' ? 'Where the mouse rested (computers only).' : 'Where the client clicked or tapped.'} Point at a colour for the time.</span>
        {doc?.revised && <span className="text-attention">The document has been revised since; positions are on today's version.</span>}
        {kind === 'teambuilding' && <span>Phone and computer layouts differ: pick the one the visits were on.</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-[#e9ecea] p-4">
        {error ? <p className="mx-auto max-w-lg rounded-xl bg-white p-5 text-[15px] text-danger">{error}</p>
          : !doc ? <p className="flex items-center justify-center gap-2 py-20 text-ink-soft"><Loader2 className="h-5 w-5 animate-spin" /> Loading the document…</p>
          : kind === 'teambuilding' && phone ? (
            <div className="mx-auto h-[780px] w-[390px] overflow-hidden rounded-[2rem] border-[10px] border-ink bg-white shadow-xl">
              <PhoneFrame><Overlaid layer={layer} data={data} kind={kind}>{page}</Overlaid></PhoneFrame>
            </div>
          ) : (
            <div className={kind === 'teambuilding' ? 'mx-auto max-w-[1200px] overflow-hidden rounded-xl bg-white shadow-xl' : 'mx-auto w-fit'}>
              <Overlaid layer={layer} data={data} kind={kind}>{page}</Overlaid>
            </div>
          )}
      </div>
    </div>
  );
}

const Dot = ({ touch }: { touch?: boolean }) => <span className={`inline-block h-3 w-3 rounded-full ring-2 ring-white ${touch ? 'bg-[#7c3aed]' : 'bg-ink'}`} />;

// The document with the chosen layer on top. Positions come from the parts marked data-track, measured every second
// (pictures, fonts and the outline's page layout settle after loading).
function Overlaid({ layer, data, kind, children }: { layer: Layer; data: ReturnType<typeof gather>; kind: LinkKind; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  useEffect(() => {
    const measure = () => {
      const root = ref.current;
      if (!root) return;
      const r = root.getBoundingClientRect();
      const next: Box[] = Array.from(root.querySelectorAll<HTMLElement>('[data-track]')).map(el => {
        const b = el.getBoundingClientRect();
        return { key: el.dataset.track || '', top: b.top - r.top, left: b.left - r.left, width: b.width, height: b.height };
      }).filter(b => b.key && b.height > 0);
      setBoxes(old => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
    };
    measure();
    const t = window.setInterval(measure, 1000);
    return () => window.clearInterval(t);
  }, []);
  return (
    <div ref={ref} className="relative">
      {children}
      <div className="pointer-events-none absolute inset-0 z-[45]">
        {boxes.map(b => (
          <div key={`${b.key}-${b.top}`} className="absolute" style={{ top: b.top, left: b.left, width: b.width, height: b.height }}>
            {layer === 'reading' && (data.heat[b.key] || []).map((v, i) => v > 0 && (
              <div key={i} className="pointer-events-auto absolute inset-x-0" title={`${sectionName(kind, b.key)}: ${durationText(v)} on screen`}
                style={{ top: `${(i / BANDS) * 100}%`, height: `${100 / BANDS}%`, background: shade(v, data.heatMax) }} />
            ))}
            {layer === 'mouse' && (data.hover[b.key] || []).map((v, i) => v > 0 && (
              <div key={i} className="pointer-events-auto absolute" title={`${sectionName(kind, b.key)}: the mouse rested here ${durationText(v)}`}
                style={{ top: `${(Math.floor(i / COLS) / BANDS) * 100}%`, left: `${((i % COLS) / COLS) * 100}%`, width: `${100 / COLS}%`, height: `${100 / BANDS}%`, background: shade(v, data.hoverMax) }} />
            ))}
            {layer === 'taps' && data.taps.filter(t => t.s === b.key).map((t, i) => (
              <span key={i} className={`pointer-events-auto absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white ${t.touch ? 'bg-[#7c3aed]' : 'bg-ink'}`}
                style={{ top: `${t.y * 100}%`, left: `${t.x * 100}%` }} title={`${t.touch ? 'Tap' : 'Click'} · ${when(t.at)}`} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
