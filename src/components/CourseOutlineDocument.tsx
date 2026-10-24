import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Mail, Phone } from 'lucide-react';
import { CourseOutline } from '../types';
import { COMPANY } from '../lib/company';
import { clientTitle } from '../lib/programmes';
import { AGENDA_TAGS } from '../lib/teambuilding';
import {
  DEFAULT_OUTLINE_TERMS, bloomText, durationText, lines, moduleDays, parseTerms, splitModuleLabel,
} from '../lib/outlineContent';
import logoUrl from '../assets/outline/next-logo.png';
import hrdcRegisteredUrl from '../assets/outline/hrdc-registered.png';
import hrdcClaimableUrl from '../assets/outline/hrdc-claimable.png';

// The printed course outline (redesigned 2026-10-19 to NEXT Academy's look, following Joel's "Discover Your Office
// Persona" outline): a cover page, then A4 pages with the chevron header and the teal footer band on each.
// Pages: overview, course outline (modules), course agenda (if it has rows), administrative details (terms).
// Content is measured off screen and spread over as many pages as it needs. Print = window.print();
// the one-click PDF takes a picture of each page (makeOutlinePdf in lib/quotePdf.ts).

export const PAGE_W = 794;      // A4 at 96 px per inch
export const PAGE_H = 1122;
const HEADER_H = 124;
const FOOTER_H = 84;
const PAD_L = 76;
const PAD_R = 64;
const CONTENT_W = PAGE_W - PAD_L - PAD_R;
const CONTENT_H = PAGE_H - HEADER_H - FOOTER_H - 30;

const TEAL = '#50a88b';
const CHEVRON = '#5bc09f';
const MINT = '#b6dccf';
const MINT_LIGHT = '#cce6dd';
const INK = '#111111';
const FONT = "'Poppins', 'Plus Jakarta Sans', ui-sans-serif, sans-serif";

type Block = { key: string; node: React.ReactNode };
type Section = { key: string; title: string; blocks: Block[]; wrap?: (children: React.ReactNode) => React.ReactNode };

export default function CourseOutlineDocument({ o: given, forPdf }: { o: CourseOutline; forPdf?: boolean }) {
  // "(TB)" marks teambuilding titles inside the CRM only; the printed outline never shows it.
  const o = useMemo(() => ({ ...given, courseTitle: clientTitle(given.courseTitle) }), [given]);
  const sections = useMemo(() => buildSections(o), [o]);
  const measureRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<number[][][] | null>(null);
  const [fontsReady, setFontsReady] = useState(false);

  // Measure every block at the page's width, then fill pages top to bottom.
  const measure = useCallback(() => {
    const el = measureRef.current;
    if (!el) return;
    setLayout(sections.map((_, si) => {
      const heights = Array.from(el.querySelectorAll(`[data-s="${si}"] > [data-b]`)).map(b => (b as HTMLElement).getBoundingClientRect().height);
      return paginate(heights, CONTENT_H);
    }));
  }, [sections]);
  useLayoutEffect(() => { measure(); }, [measure]);
  // Poppins may still be loading on the first pass; measure again once it's in.
  useEffect(() => {
    const fonts = (document as any).fonts;
    let alive = true;
    const again = () => { if (alive) { measure(); setFontsReady(true); } };
    if (fonts?.ready) fonts.ready.then(again); else again();
    fonts?.addEventListener?.('loadingdone', again);
    return () => { alive = false; fonts?.removeEventListener?.('loadingdone', again); };
  }, [measure]);

  const pages: React.ReactNode[] = [<CoverPage key="cover" o={o} />];
  sections.forEach((s, si) => {
    const groups = layout?.[si] || [s.blocks.map((_, i) => i)];
    groups.forEach((g, pi) => {
      const nodes = g.map(i => <div key={s.blocks[i].key}>{s.blocks[i].node}</div>);
      pages.push(<Page key={`${s.key}-${pi}`} track={pi ? `${s.key}-${pi}` : s.key} title={s.title}>{s.wrap ? s.wrap(nodes) : nodes}</Page>);
    });
  });

  return (
    <div className="outline-print w-full" data-ready={layout && fontsReady ? '1' : undefined}>
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      {/* Off-screen copy used only to measure each block */}
      <div ref={measureRef} aria-hidden className="outline-measure"
        style={{ position: 'absolute', left: -99999, top: 0, width: CONTENT_W, visibility: 'hidden', fontFamily: FONT, color: INK }}>
        {sections.map((s, si) => (
          <div key={s.key} data-s={si}>
            {s.blocks.map(b => <div key={b.key} data-b>{b.node}</div>)}
          </div>
        ))}
      </div>
      <Fit on={!forPdf}>{pages}</Fit>
    </div>
  );
}

const PRINT_CSS = `
@media print {
  @page { size: A4; margin: 0; }
  body * { visibility: hidden !important; }
  .outline-print, .outline-print * { visibility: visible !important; }
  .outline-print { position: absolute !important; left: 0 !important; top: 0 !important; width: 210mm !important; }
  .outline-measure { display: none !important; }
  .outline-pages { zoom: 1 !important; }
  .outline-page { margin: 0 !important; box-shadow: none !important; break-after: page; page-break-after: always;
    -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
}`;

function paginate(heights: number[], max: number): number[][] {
  const pages: number[][] = [[]];
  let used = 0;
  heights.forEach((h, i) => {
    if (used + h > max && pages[pages.length - 1].length) { pages.push([]); used = 0; }
    pages[pages.length - 1].push(i);
    used += h;
  });
  return pages;
}

// On screen the A4 pages shrink to fit narrow screens (phones); print and PDF use the real size.
function Fit({ on, children }: { on: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!on || !el) return;
    const fit = () => setZoom(Math.min(1, el.clientWidth / (PAGE_W + 2)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [on]);
  return (
    <div ref={ref} className="w-full">
      <div className="outline-pages" style={on ? { zoom } : undefined}>{children}</div>
    </div>
  );
}

// ---------- Content ----------

const h2: React.CSSProperties = { fontSize: 14.5, fontWeight: 700, margin: 0, lineHeight: 1.4 };
const body: React.CSSProperties = { fontSize: 13.5, lineHeight: 1.6, margin: 0 };
const indent: React.CSSProperties = { ...body, paddingLeft: 38 };
const gap = (first: boolean): React.CSSProperties => ({ paddingTop: first ? 4 : 16 });

function Numbered({ items }: { items: string[] }) {
  return (
    <ol style={{ ...body, margin: 0, paddingLeft: 58, listStyle: 'decimal' }}>
      {items.map((x, i) => <li key={i} style={{ paddingLeft: 4 }}>{x}</li>)}
    </ol>
  );
}

function Bullets({ items, pad = 58 }: { items: string[]; pad?: number }) {
  return (
    <ul style={{ ...body, margin: 0, paddingLeft: pad, listStyle: 'none' }}>
      {items.map((x, i) => (
        <li key={i} style={{ position: 'relative', paddingLeft: 4 }}>
          <span style={{ position: 'absolute', left: -14, top: '0.62em', width: 6, height: 6, borderRadius: 6, border: `1.3px solid ${INK}` }} />
          {x}
        </li>
      ))}
    </ul>
  );
}

function buildSections(o: CourseOutline): Section[] {
  const out: Section[] = [];

  // 1. Overview page
  const ov: Block[] = [];
  const add = (key: string, heading: string, content: React.ReactNode) =>
    ov.push({ key, node: <div style={gap(!ov.length)}><p style={h2}>{heading}</p>{content}</div> });
  const paras = String(o.overview || '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  paras.forEach((p, i) => ov.push({
    key: `ov${i}`,
    node: (
      <div style={gap(i === 0)}>
        {i === 0 && <p style={h2}>Overview</p>}
        <p style={{ ...body, textAlign: 'justify', whiteSpace: 'pre-line' }}>{p}</p>
      </div>
    ),
  }));
  const outcomes = lines(o.outcomes);
  if (outcomes.length) add('outcomes', 'Learning Outcomes / Objectives', <>
    <p style={body}>Upon completion of this program, the participants should be able to:</p>
    <Numbered items={outcomes} />
  </>);
  const audience = lines(o.audience);
  if (audience.length) add('audience', 'Target Audience', <Bullets items={audience} />);
  const dur = durationText(o.durationDays, o.totalHours);
  if (dur) add('duration', 'Course Duration', <p style={indent}>{dur}</p>);
  if (String(o.prerequisites || '').trim()) add('pre', 'Pre-requisites', <p style={{ ...indent, whiteSpace: 'pre-line' }}>{o.prerequisites}</p>);
  const methods = lines(o.methods);
  if (methods.length) add('methods', 'Learning Methods', <Numbered items={methods} />);
  // Optional extras (only when filled in)
  if (o.difficulty) add('difficulty', 'Difficulty', <p style={indent}>{o.difficulty}</p>);
  const evaluation = lines(o.evaluation);
  if (evaluation.length) add('evaluation', 'Evaluation Method', <Numbered items={evaluation} />);
  if (bloomText(o.bloomLevel)) add('bloom', "Bloom's Taxonomy Level", <p style={indent}>{bloomText(o.bloomLevel)}</p>);
  const next = lines(o.nextTraining);
  if (next.length) add('next', 'Recommended Next Training', <Bullets items={next} />);
  if (String(o.designedBy || '').trim()) add('designed', 'Designed By', <p style={indent}>{o.designedBy}</p>);
  if (ov.length) out.push({ key: 'overview', title: o.courseTitle || 'Course outline', blocks: ov });

  // 2. Modules
  const items = (o.items || []).filter(m => String(m.moduleTitle || '').trim() || String(m.topics || '').trim());
  const days = moduleDays(o.durationDays, items);
  const mods: Block[] = [];
  let lastDay = 0;
  items.forEach((m, i) => {
    const day = days.length ? m.day || 1 : 0;
    const dayTitle = day && day !== lastDay ? `Day ${day}${o.dayTitles?.[day - 1]?.trim() ? `: ${o.dayTitles[day - 1].trim()}` : ''}` : '';
    lastDay = day;
    const topics = lines(m.topics);
    mods.push({
      key: m.id || `m${i}`,
      node: (
        <div style={{ paddingTop: i === 0 ? 4 : dayTitle ? 22 : 16 }}>
          {dayTitle && <p style={{ ...h2, color: TEAL, fontSize: 15.5, paddingBottom: 8 }}>{dayTitle}</p>}
          <div style={{ display: 'grid', gridTemplateColumns: '92px 1fr', columnGap: 4 }}>
            <p style={{ ...body, fontWeight: 700 }}>Module {i + 1}</p>
            <div>
              <p style={{ ...body, fontWeight: 700 }}>{m.moduleTitle}</p>
              {topics.length > 0 && <Bullets items={topics} pad={16} />}
            </div>
          </div>
        </div>
      ),
    });
  });
  if (mods.length) out.push({ key: 'modules', title: 'Course Outline', blocks: mods });

  // 3. Agenda (a bordered two-column table, one block per row)
  const agenda = (o.agenda || []).filter(r => String(r.text || '').trim() || String(r.time || '').trim());
  if (agenda.length) {
    const cell: React.CSSProperties = { fontSize: 12.5, lineHeight: 1.45, padding: '13px 14px' };
    const line = `1.5px solid ${INK}`;
    out.push({
      key: 'agenda', title: 'Course Agenda',
      wrap: children => <div style={{ paddingTop: 12 }}><div style={{ borderTop: line }}>{children}</div></div>,
      blocks: agenda.map((r, i) => {
        const { label, rest } = splitModuleLabel(r.text);
        return {
          key: r.id || `a${i}`,
          node: r.isDay ? (
            <div style={{ ...cell, borderLeft: line, borderRight: line, borderBottom: line, background: MINT_LIGHT, fontWeight: 700, fontSize: 13.5 }}>
              {r.text || r.time}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '170px 1fr', borderLeft: line, borderRight: line, borderBottom: line }}>
              <div style={{ ...cell, borderRight: line }}>{r.time}</div>
              <div style={cell}>{label ? <><strong>{label}</strong>{rest ? `: ${rest}` : ''}</> : r.text}{r.tag && <span style={{ color: '#5f6f6a' }}> ({AGENDA_TAGS.find(t => t.key === r.tag)?.label})</span>}</div>
            </div>
          ),
        };
      }),
    });
  }

  // 4. Administrative details (terms) with the HRD Corp badges
  const terms = parseTerms(o.terms === undefined ? DEFAULT_OUTLINE_TERMS : o.terms);
  if (!o.hideTerms && terms.length) {
    const small: React.CSSProperties = { fontSize: 12.5, lineHeight: 1.55, margin: 0 };
    const blocks: Block[] = [{ key: 't-head', node: <p style={{ ...small, fontWeight: 700, textDecoration: 'underline', paddingTop: 4, paddingBottom: 6 }}>Terms and Conditions</p> }];
    terms.forEach((t, i) => blocks.push({
      key: `t${i}`,
      node: t.kind === 'heading' ? (
        <p style={{ ...small, fontWeight: 700, paddingTop: i ? 8 : 4, paddingLeft: 20, display: 'flex', gap: 8 }}><span>{t.no}.</span><span>{t.text}:</span></p>
      ) : t.kind === 'bullet' ? (
        <p style={{ ...small, position: 'relative', paddingLeft: 20 }}>
          <span style={{ position: 'absolute', left: 4, top: '0.6em', width: 5, height: 5, borderRadius: 5, background: INK }} />
          {t.label && <strong>{t.label}: </strong>}{t.text}
        </p>
      ) : (
        <p style={{ ...small, paddingLeft: 20, paddingTop: 2 }}>{t.text}</p>
      ),
    }));
    blocks.push({
      key: 't-badges',
      node: (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 22 }}>
          <img src={hrdcRegisteredUrl} alt="HRD Corp registered training provider" style={{ width: 74, height: 74 }} />
          <img src={hrdcClaimableUrl} alt="HRD Corp claimable" style={{ width: 74, height: 74 }} />
        </div>
      ),
    });
    out.push({ key: 'terms', title: 'Administrative Details', blocks });
  }

  return out;
}

// ---------- Page parts ----------

const pageStyle: React.CSSProperties = {
  width: PAGE_W, height: PAGE_H, position: 'relative', overflow: 'hidden', background: '#ffffff',
  fontFamily: FONT, color: INK, margin: '0 auto 24px', boxShadow: '0 1px 3px rgba(15,23,42,.12), 0 10px 30px rgba(15,23,42,.08)',
};

// data-track: the page timed on the client's link (2026-10-20, lib/linkTracker.ts), e.g. "modules-1".
function Page({ title, track, children }: { title: string; track?: string; children: React.ReactNode }) {
  return (
    <section className="outline-page" style={pageStyle} data-track={track}>
      <div style={{ position: 'absolute', top: 26, left: 22, right: PAD_R - 10, height: 74, display: 'flex', alignItems: 'center', gap: 16 }}>
        <Chevrons color={CHEVRON} width={80} height={72} />
        <h1 style={{ flex: 1, margin: 0, fontWeight: 700, lineHeight: 1.2, fontSize: title.length > 48 ? 17 : title.length > 32 ? 19.5 : 22 }}>{title}</h1>
        <img src={logoUrl} alt="NEXT Academy" style={{ height: 50, width: 'auto' }} />
      </div>
      <div style={{ position: 'absolute', top: HEADER_H, left: PAD_L, right: PAD_R }}>{children}</div>
      <Footer />
    </section>
  );
}

function CoverPage({ o }: { o: CourseOutline }) {
  const title = o.courseTitle || 'Course outline';
  const dateText = o.date ? new Date(`${o.date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  return (
    <section className="outline-page" style={pageStyle} data-track="cover">
      <svg width={PAGE_W} height={780} viewBox="0 0 794 780" style={{ position: 'absolute', top: 0, left: 0 }} aria-hidden>
        <polygon points="36,0 246,0 470,390 246,780 36,780 260,390" fill={MINT} />
        <polygon points="300,0 510,0 734,390 510,780 300,780 524,390" fill={MINT} />
      </svg>
      <div style={{ position: 'absolute', top: 300, left: 230, right: 40, height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <h1 style={{ margin: 0, textAlign: 'center', fontWeight: 800, lineHeight: 1.15, fontSize: title.length > 60 ? 28 : title.length > 36 ? 32 : 38 }}>{title}</h1>
      </div>
      <div style={{ position: 'absolute', top: 812, left: PAD_L, right: 300 }}>
        {o.preparedForCompany && (
          <>
            <p style={{ margin: 0, fontSize: 12.5, color: '#555' }}>Prepared for</p>
            <p style={{ margin: 0, fontSize: 18, fontWeight: 700, lineHeight: 1.3 }}>{o.preparedForCompany}</p>
          </>
        )}
        {(o.refNumber || dateText) && (
          <p style={{ margin: '8px 0 0', fontSize: 12, color: '#555' }}>{[o.refNumber, dateText].filter(Boolean).join(' · ')}</p>
        )}
      </div>
      <img src={logoUrl} alt="NEXT Academy" style={{ position: 'absolute', right: 60, bottom: FOOTER_H + 40, height: 72, width: 'auto' }} />
      <Footer />
    </section>
  );
}

function Chevrons({ color, width, height }: { color: string; width: number; height: number }) {
  return (
    <svg width={width} height={height} viewBox="0 0 100 90" aria-hidden style={{ flexShrink: 0 }}>
      <polygon points="0,0 30,0 55,45 30,90 0,90 25,45" fill={color} />
      <polygon points="38,0 68,0 93,45 68,90 38,90 63,45" fill={color} />
    </svg>
  );
}

function Footer() {
  const iconCircle: React.CSSProperties = { width: 26, height: 26, borderRadius: 26, background: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 };
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: FOOTER_H, background: TEAL, color: '#ffffff', display: 'flex', alignItems: 'center' }}>
      <svg width={96} height={FOOTER_H} viewBox="0 0 96 84" aria-hidden style={{ flexShrink: 0 }}>
        <polygon points="0,0 22,0 46,42 22,84 0,84 24,42" fill={MINT_LIGHT} />
        <polygon points="34,0 56,0 80,42 56,84 34,84 58,42" fill="#f4f8f6" />
      </svg>
      <div style={{ flex: 1, paddingLeft: 52 }}>
        <p style={{ margin: 0, fontSize: 16, lineHeight: 1.2 }}><strong style={{ fontWeight: 800 }}>next</strong> <span style={{ fontWeight: 500 }}>Academy</span></p>
        <p style={{ margin: '4px 0 0', fontSize: 11, fontWeight: 600, lineHeight: 1.45 }}>{COMPANY.addressLines[0]}<br />{COMPANY.addressLines[1]}</p>
      </div>
      <div style={{ width: 1.5, height: 58, background: 'rgba(255,255,255,.9)' }} />
      <div style={{ flex: 1, paddingLeft: 44, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12.5, fontWeight: 600 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}><span style={iconCircle}><Mail size={14} color={TEAL} strokeWidth={2.4} /></span>{COMPANY.email}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}><span style={iconCircle}><Phone size={14} color={TEAL} strokeWidth={2.4} /></span>{COMPANY.phone}</span>
      </div>
    </div>
  );
}
