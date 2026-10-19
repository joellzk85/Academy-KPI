import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Check, ChevronDown, Clock, MapPin, Minus, Navigation, Plus, Sparkles, Users } from 'lucide-react';
import logoUrl from '../assets/outline/next-logo.png';
import hrdcRegisteredUrl from '../assets/outline/hrdc-registered.png';
import hrdcClaimableUrl from '../assets/outline/hrdc-claimable.png';
import { COMPANY, COMPANY_ADDRESS } from '../lib/company';
import { formatDate } from '../lib/deals';
import { parseTerms } from '../lib/outlineContent';
import {
  AGENDA_TAGS, RATINGS, ResolvedTb, TbProposalActivity, TbSectionKey, blocks, cellFor, formatPrice, priceFor, sortedBands,
} from '../lib/teambuilding';

// The teambuilding proposal as a website (Joel, 2026-10-19: "it should look like a standalone website, custom made
// for the customer", keeping NEXT Academy's look). The same page is used for the Preview in the CRM, the PDF
// (mode 'pdf': everything open, no animation) and, in push B, the client's private link.
// Phone first: one column on phones, wider layouts from tablets up. Colours from Joel's PDFs.

export const TB = { teal: '#50a88b', tealDark: '#2f7d66', chevron: '#5bc09f', mint: '#b6dccf', mintLight: '#e6f3ee', ink: '#1e2d29', soft: '#5b6b66' };

type Mode = 'preview' | 'pdf';

export default function TeambuildingSite({ r, mode = 'preview', pax: paxIn, onPax, watermark }: {
  r: ResolvedTb; mode?: Mode;
  pax?: number; onPax?: (n: number) => void;   // group size (the editor keeps it in step)
  watermark?: string;                           // faint repeating text (PDF: the client's name)
}) {
  const p = r.p;
  const pdf = mode === 'pdf';
  const [ownPax, setOwnPax] = useState(r.pax || sortedBands(p.packages)[0]?.min || 0);
  const pax = paxIn ?? ownPax;
  const setPax = (n: number) => { const v = Math.max(1, Math.min(9999, Math.round(n || 0))); setOwnPax(v); onPax?.(v); };
  const rootRef = useRef<HTMLDivElement>(null);
  useReveal(rootRef, !pdf);

  const titleOf = (k: TbSectionKey) => r.sections.find(s => s.key === k)?.title || '';
  const go = (k: string) => rootRef.current?.querySelector(`#tb-${k}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  let n = 0;
  const num = () => String(++n).padStart(2, '0');

  return (
    <div ref={rootRef} className={`tb-site relative bg-white text-[#1e2d29] ${pdf ? "tb-static" : ""}`} style={{ fontFamily: "'Poppins', 'Plus Jakarta Sans', ui-sans-serif, sans-serif" }}>
      {watermark && <Watermark text={watermark} />}
      {!pdf && <Nav r={r} onGo={go} />}
      <Hero r={r} pax={pax} pdf={pdf} onGo={go} />

      {r.sections.map(s => {
        const no = num();
        const head = <SectionHead no={no} title={titleOf(s.key)} />;
        switch (s.key) {
          case 'objectives': return (
            <Section key={s.key} id={s.key} tone="white">
              {head}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {p.objectives.filter(o => (o.title || o.text).trim()).map((o, i) => (
                  <div key={o.id} className="tb-reveal rounded-3xl border border-[#d7ebe3] bg-[#f4faf7] p-6" data-pdf-keep>
                    <span className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white" style={{ background: TB.teal }}>{i + 1}</span>
                    {o.title.trim() && <h3 className="mt-4 text-lg font-bold uppercase leading-snug tracking-wide" style={{ color: TB.tealDark }}>{o.title}</h3>}
                    {o.text.trim() && <p className="mt-2 text-[15px] leading-relaxed text-[#3c4c47]">{o.text}</p>}
                  </div>
                ))}
              </div>
            </Section>
          );
          case 'trainers': return (
            <Section key={s.key} id={s.key} tone="mint">
              {head}
              <div className="space-y-6">
                {p.trainers.filter(t => (t.name || '').trim()).map((t, i) => (
                  <div key={t.id} className={`tb-reveal grid items-start gap-6 overflow-hidden rounded-3xl bg-white p-5 shadow-[0_10px_40px_-20px_rgba(30,45,41,0.35)] sm:p-7 ${i % 2 ? 'md:grid-cols-[1fr_15rem]' : 'md:grid-cols-[15rem_1fr]'}`} data-pdf-keep>
                    <div className={`relative mx-auto w-48 md:w-full ${i % 2 ? 'md:order-2' : ''}`}>
                      <div className="absolute -bottom-3 -right-3 h-full w-full rounded-[1.75rem]" style={{ background: TB.mint }} />
                      {t.photo
                        ? <img src={t.photo} alt={t.name} className="relative aspect-[4/5] w-full rounded-[1.75rem] object-cover" />
                        : <div className="relative flex aspect-[4/5] w-full items-center justify-center rounded-[1.75rem] text-5xl font-bold text-white" style={{ background: TB.teal }}>{initials(t.name || '')}</div>}
                    </div>
                    <div>
                      <h3 className="text-2xl font-bold">{t.name}</h3>
                      {t.role && <p className="mt-1 inline-flex rounded-full px-3 py-0.5 text-sm font-semibold" style={{ background: TB.mintLight, color: TB.tealDark }}>{t.role}</p>}
                      <Rich text={t.bio || ''} className="mt-4 text-[15px] leading-relaxed text-[#3c4c47]" />
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          );
          case 'agenda': return <Section key={s.key} id={s.key} tone="white">{head}<Agenda r={r} pdf={pdf} /></Section>;
          case 'activities': return (
            <Section key={s.key} id={s.key} tone="mint">
              {head}
              <div className="space-y-8">
                {p.activities.filter(a => a.name.trim()).map(a => <Activity key={a.id} a={a} pdf={pdf} />)}
              </div>
            </Section>
          );
          case 'venues': return (
            <Section key={s.key} id={s.key} tone="white">
              {head}
              <div className="grid gap-6 md:grid-cols-2">
                {p.venues.filter(v => (v.name || '').trim()).map((v, i) => (
                  <div key={v.id} className="tb-reveal overflow-hidden rounded-3xl border border-[#d7ebe3] bg-white shadow-[0_10px_40px_-24px_rgba(30,45,41,0.35)]" data-pdf-keep>
                    <Gallery photos={v.photos || []} alt={v.name || ''} tall />
                    <div className="p-5 sm:p-6">
                      <p className="text-sm font-semibold uppercase tracking-wider" style={{ color: TB.teal }}>Option {i + 1}{v.stay ? ` · ${v.stay}` : ''}</p>
                      <h3 className="mt-1 text-xl font-bold">{v.name}</h3>
                      <ul className="mt-3 space-y-1.5 text-[15px] text-[#3c4c47]">
                        {v.distance && <li className="flex gap-2"><Navigation className="mt-0.5 h-4 w-4 shrink-0" style={{ color: TB.teal }} />{v.distance}</li>}
                        {v.travelTime && <li className="flex gap-2"><Clock className="mt-0.5 h-4 w-4 shrink-0" style={{ color: TB.teal }} />{v.travelTime}</li>}
                      </ul>
                      {v.notes && <Rich text={v.notes} className="mt-3 text-[15px] leading-relaxed text-[#3c4c47]" />}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          );
          case 'packages': return <Section key={s.key} id={s.key} tone="mint">{head}<Packages r={r} pax={pax} setPax={setPax} pdf={pdf} /></Section>;
          case 'takeaways': return (
            <Section key={s.key} id={s.key} tone="white">
              {head}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {p.takeaways.filter(o => (o.title || o.text).trim()).map(o => (
                  <div key={o.id} className="tb-reveal flex gap-4 rounded-3xl bg-[#f4faf7] p-6" data-pdf-keep>
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white" style={{ background: TB.teal }}><Check className="h-5 w-5" /></span>
                    <div>
                      {o.title.trim() && <h3 className="font-bold">{o.title}</h3>}
                      {o.text.trim() && <p className="mt-1 text-[15px] leading-relaxed text-[#3c4c47]">{o.text}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          );
          case 'hrdc': return (
            <Section key={s.key} id={s.key} tone="teal">
              <div className="tb-reveal flex flex-col items-center gap-6 text-center md:flex-row md:text-left" data-pdf-keep>
                <div className="flex shrink-0 gap-3">
                  <img src={hrdcRegisteredUrl} alt="HRD Corp registered training provider" className="h-20 w-auto rounded-xl bg-white p-2" />
                  <img src={hrdcClaimableUrl} alt="HRD Corp claimable" className="h-20 w-auto rounded-xl bg-white p-2" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-white sm:text-3xl">{titleOf('hrdc')}</h2>
                  <p className="mt-2 text-[15px] leading-relaxed text-white/90">{p.hrdcNote}</p>
                </div>
              </div>
            </Section>
          );
          case 'terms': return (
            <Section key={s.key} id={s.key} tone="white">
              {head}
              <Terms text={p.terms || ''} />
            </Section>
          );
        }
      })}

      <Footer r={r} />
    </div>
  );
}

// ---------- Pieces ----------
function useReveal(ref: React.RefObject<HTMLDivElement | null>, on: boolean) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const els = Array.from(root.querySelectorAll('.tb-reveal'));
    if (!on || typeof IntersectionObserver === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      els.forEach(e => e.classList.add('tb-in'));
      return;
    }
    root.classList.add('tb-animate');
    const io = new IntersectionObserver(entries => entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('tb-in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    els.forEach(e => io.observe(e));
    return () => io.disconnect();
  });
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();

function Nav({ r, onGo }: { r: ResolvedTb; onGo: (k: string) => void }) {
  const short: Partial<Record<TbSectionKey, string>> = { objectives: 'Objectives', trainers: 'Trainers', agenda: 'Agenda', activities: 'Activities', venues: 'Venues', packages: 'Packages', takeaways: 'Takeaways', terms: 'Terms' };
  const items = r.sections.filter(s => short[s.key]);
  return (
    <nav className="sticky top-0 z-30 border-b border-black/5 bg-white/85 backdrop-blur-md" data-pdf-skip>
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-2.5 sm:px-6">
        <img src={logoUrl} alt="NEXT Academy" className="h-8 w-auto shrink-0" />
        <div className="no-scrollbar -mr-4 flex flex-1 gap-1 overflow-x-auto pr-4 sm:mr-0 sm:justify-end sm:pr-0">
          {items.map(s => (
            <button key={s.key} type="button" onClick={() => onGo(s.key)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${s.key === 'packages' ? 'text-white' : 'text-[#3c4c47] hover:bg-[#eef7f3]'}`}
              style={s.key === 'packages' ? { background: TB.teal } : undefined}>
              {short[s.key]}
            </button>
          ))}
        </div>
      </div>
    </nav>
  );
}

function Hero({ r, pax, pdf, onGo }: { r: ResolvedTb; pax: number; pdf: boolean; onGo: (k: string) => void }) {
  const p = r.p;
  const facts = [
    r.eventDate && { icon: <CalendarDays className="h-4 w-4" />, text: formatDate(r.eventDate) },
    p.stay && { icon: <Clock className="h-4 w-4" />, text: p.stay },
    pax > 0 && { icon: <Users className="h-4 w-4" />, text: `${pax} participants` },
  ].filter(Boolean) as { icon: React.ReactNode; text: string }[];
  return (
    <header className={`relative flex items-end overflow-hidden ${pdf ? '' : 'min-h-[calc(100svh-52px)]'}`} style={pdf ? { minHeight: Math.round(1100 * 297 / 210) } : undefined} data-pdf-block>
      {p.coverPhoto ? (
        <>
          <img src={p.coverPhoto} alt="" className="tb-hero-img absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(20,40,34,0.15) 0%, rgba(20,40,34,0.35) 45%, rgba(20,40,34,0.88) 100%)' }} />
        </>
      ) : (
        <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${TB.tealDark} 0%, ${TB.teal} 55%, ${TB.chevron} 100%)` }} />
      )}
      {/* The NEXT chevrons */}
      <svg className="pointer-events-none absolute -right-10 top-10 h-64 w-64 opacity-70 sm:h-96 sm:w-96" viewBox="0 0 200 200" aria-hidden="true">
        <path d="M20 20 L90 100 L20 180 L60 180 L130 100 L60 20 Z" fill={TB.mint} opacity="0.55" />
        <path d="M80 20 L150 100 L80 180 L120 180 L190 100 L120 20 Z" fill={TB.chevron} opacity="0.75" />
      </svg>
      {pdf && <div className="absolute left-6 top-6 rounded-2xl bg-white/95 px-3 py-2"><img src={logoUrl} alt="NEXT Academy" className="h-10 w-auto" /></div>}
      <div className="relative mx-auto w-full max-w-6xl px-4 pb-14 pt-28 sm:px-6 sm:pb-20">
        <p className="tb-rise text-sm font-semibold uppercase tracking-[0.2em] text-white/85">Teambuilding proposal{r.company ? ` · Prepared for ${r.company}` : ''}</p>
        <h1 className="tb-rise mt-3 max-w-4xl text-4xl font-extrabold uppercase leading-[1.05] text-white sm:text-6xl" style={{ animationDelay: '80ms' }}>{p.title || 'Teambuilding proposal'}</h1>
        {p.subtitle && <p className="tb-rise mt-4 max-w-2xl text-lg leading-relaxed text-white/90" style={{ animationDelay: '160ms' }}>{p.subtitle}</p>}
        {facts.length > 0 && (
          <div className="tb-rise mt-6 flex flex-wrap gap-2" style={{ animationDelay: '240ms' }}>
            {facts.map(f => <span key={f.text} className="inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-sm font-medium text-white ring-1 ring-white/30 backdrop-blur">{f.icon}{f.text}</span>)}
          </div>
        )}
        <p className="tb-rise mt-6 font-semibold text-white/90" style={{ animationDelay: '300ms' }}>by NEXT Academy</p>
        {!pdf && r.sections.length > 0 && (
          <button type="button" onClick={() => onGo(r.sections[0].key)} className="tb-bob mt-10 inline-flex items-center gap-2 text-sm font-semibold text-white/85 hover:text-white">
            Scroll to explore <ChevronDown className="h-4 w-4" />
          </button>
        )}
      </div>
    </header>
  );
}

function Section({ id, tone, children }: { id: string; tone: 'white' | 'mint' | 'teal'; children: React.ReactNode }) {
  const bg = tone === 'mint' ? '#f1f8f5' : tone === 'teal' ? TB.tealDark : '#ffffff';
  return (
    <section id={`tb-${id}`} className="scroll-mt-14 px-4 py-14 sm:px-6 sm:py-20" style={{ background: bg }} data-pdf-block>
      <div className="mx-auto max-w-6xl">{children}</div>
    </section>
  );
}

function SectionHead({ no, title }: { no: string; title: string }) {
  return (
    <div className="tb-reveal mb-8 sm:mb-10">
      <p className="flex items-center gap-3 text-sm font-semibold tracking-[0.2em]" style={{ color: TB.teal }}>
        <span>{no}</span><span className="h-px w-10" style={{ background: TB.teal }} />
      </p>
      <h2 className="mt-2 text-3xl font-bold leading-tight sm:text-4xl">{title}</h2>
    </div>
  );
}

function Rich({ text, className = '' }: { text: string; className?: string }) {
  const bl = blocks(text);
  if (!bl.length) return null;
  return (
    <div className={`space-y-2 ${className}`}>
      {bl.map((b, i) => b.kind === 'p'
        ? <p key={i}>{b.items[0]}</p>
        : <ul key={i} className="space-y-1.5">{b.items.map((t, k) => <li key={k} className="flex gap-2.5"><span className="mt-[0.6em] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: TB.teal }} />{t}</li>)}</ul>)}
    </div>
  );
}

function Agenda({ r, pdf }: { r: ResolvedTb; pdf: boolean }) {
  const days = r.p.agenda.filter(d => d.rows.some(x => x.text.trim()));
  const [day, setDay] = useState(0);
  const shown = pdf ? days : [days[Math.min(day, days.length - 1)]].filter(Boolean);
  const tagLabel = (t?: string) => AGENDA_TAGS.find(x => x.key === t)?.label || '';
  return (
    <div className="tb-reveal">
      {!pdf && days.length > 1 && (
        <div className="no-scrollbar -mx-4 mb-6 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          {days.map((d, i) => (
            <button key={d.id} type="button" onClick={() => setDay(i)}
              className={`shrink-0 rounded-full px-5 py-2.5 text-sm font-semibold transition-colors ${i === day ? 'text-white shadow' : 'bg-[#eef7f3] text-[#3c4c47] hover:bg-[#e2f1eb]'}`}
              style={i === day ? { background: TB.teal } : undefined}>
              {d.title || `Day ${i + 1}`}
            </button>
          ))}
        </div>
      )}
      <div className="space-y-8">
        {shown.map(d => (
          <div key={d.id} data-pdf-keep>
            {(pdf || days.length === 1) && <h3 className="mb-4 text-xl font-bold" style={{ color: TB.tealDark }}>{d.title}</h3>}
            <ol className="relative space-y-3 border-l-2 pl-6 sm:pl-8" style={{ borderColor: TB.mint }}>
              {d.rows.filter(x => x.text.trim()).map(x => (
                <li key={x.id} className="relative rounded-2xl bg-[#f6fbf9] px-4 py-3 sm:flex sm:items-center sm:gap-6">
                  <span className="absolute -left-[33px] top-4 h-3.5 w-3.5 rounded-full border-[3px] border-white sm:-left-[41px]" style={{ background: TB.teal }} />
                  <span className="block text-sm font-semibold sm:w-48 sm:shrink-0" style={{ color: TB.tealDark }}>{x.time}</span>
                  <span className="mt-0.5 block flex-1 text-[15px] font-medium sm:mt-0">{x.text}</span>
                  {x.tag && <span className="mt-2 inline-flex rounded-full px-3 py-0.5 text-xs font-semibold sm:mt-0" style={{ background: x.tag === 'dining' ? '#fdf1e2' : TB.mintLight, color: x.tag === 'dining' ? '#a8650f' : TB.tealDark }}>{tagLabel(x.tag)}</span>}
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </div>
  );
}

function Gallery({ photos, alt, tall }: { photos: string[]; alt: string; tall?: boolean }) {
  const list = photos.filter(Boolean);
  const [i, setI] = useState(0);
  if (!list.length) return null;
  const main = list[Math.min(i, list.length - 1)];
  return (
    <div>
      <div className={`overflow-hidden ${tall ? 'aspect-[16/10]' : 'aspect-[16/10]'} bg-[#eef7f3]`}>
        <img src={main} alt={alt} className="h-full w-full object-cover transition-transform duration-700 hover:scale-[1.03]" />
      </div>
      {list.length > 1 && (
        <div className="flex gap-2 p-2" data-pdf-skip>
          {list.slice(0, 6).map((src, k) => (
            <button key={`${src}-${k}`} type="button" onClick={() => setI(k)} className={`h-14 w-20 overflow-hidden rounded-lg ring-2 ${k === i ? '' : 'opacity-70 ring-transparent hover:opacity-100'}`} style={k === i ? { boxShadow: `0 0 0 2px ${TB.teal}` } : undefined} aria-label={`Photo ${k + 1}`}>
              <img src={src} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Activity({ a, pdf }: { a: TbProposalActivity; pdf: boolean }) {
  const facts = [
    a.duration && { icon: <Clock className="h-4 w-4" />, label: 'Duration', text: a.duration },
    a.location && { icon: <MapPin className="h-4 w-4" />, label: 'Location', text: a.location },
    a.format && { icon: <Sparkles className="h-4 w-4" />, label: 'Format', text: a.format },
    a.groupSize && { icon: <Users className="h-4 w-4" />, label: 'Group size', text: a.groupSize },
  ].filter(Boolean) as { icon: React.ReactNode; label: string; text: string }[];
  const ratings = RATINGS.filter(x => (a.ratings?.[x.key] || 0) > 0);
  const more = [
    a.howPlayed.trim() && { title: 'How it is played', node: <Rich text={a.howPlayed} /> },
    a.deliverables.trim() && { title: 'Expected deliverables', node: <Rich text={a.deliverables} /> },
    a.materials.length > 0 && { title: 'Materials', node: <Rich text={a.materials.map(m => `- ${m}`).join('\n')} /> },
  ].filter(Boolean) as { title: string; node: React.ReactNode }[];
  return (
    <article className="tb-reveal overflow-hidden rounded-[2rem] bg-white shadow-[0_20px_60px_-30px_rgba(30,45,41,0.45)]" data-pdf-keep>
      <div className="grid lg:grid-cols-2">
        <div className="lg:order-2"><Gallery photos={a.photos} alt={a.name} /></div>
        <div className="p-6 sm:p-8">
          <p className="text-sm font-semibold uppercase tracking-wider" style={{ color: TB.teal }}>Highlight activity</p>
          <h3 className="mt-1 text-2xl font-bold sm:text-3xl">{a.name}</h3>
          {a.summary && <p className="mt-3 text-[15px] leading-relaxed text-[#3c4c47]">{a.summary}</p>}
          {facts.length > 0 && (
            <dl className="mt-5 grid grid-cols-2 gap-3">
              {facts.map(f => (
                <div key={f.label} className="rounded-2xl bg-[#f4faf7] px-3.5 py-2.5">
                  <dt className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider" style={{ color: TB.teal }}>{f.icon}{f.label}</dt>
                  <dd className="mt-0.5 text-sm font-semibold">{f.text}</dd>
                </div>
              ))}
            </dl>
          )}
          {ratings.length > 0 && (
            <div className="mt-6 space-y-2.5">
              {ratings.map(x => (
                <div key={x.key}>
                  <div className="flex justify-between text-sm"><span className="font-medium">{x.label}</span><span className="text-[#5b6b66]">{a.ratings[x.key]}%</span></div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-[#e6f1ed]">
                    <div className="tb-bar h-full rounded-full" style={{ width: `${Math.min(100, a.ratings[x.key] || 0)}%`, background: `linear-gradient(90deg, ${TB.chevron}, ${TB.tealDark})` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {(a.objectives.length > 0 || a.takeaways.length > 0) && (
        <div className="grid gap-6 border-t border-[#e6f1ed] p-6 sm:p-8 md:grid-cols-2">
          {a.objectives.length > 0 && <ListBlock title="Learning objectives" items={a.objectives} />}
          {a.takeaways.length > 0 && <ListBlock title="Learning takeaways" items={a.takeaways} />}
        </div>
      )}
      {more.length > 0 && (
        <div className="divide-y divide-[#e6f1ed] border-t border-[#e6f1ed]">
          {more.map(m => (
            <details key={m.title} open={pdf} className="group px-6 sm:px-8">
              <summary className="flex cursor-pointer list-none items-center justify-between py-4 font-semibold">
                {m.title}<ChevronDown className="h-5 w-5 transition-transform group-open:rotate-180" style={{ color: TB.teal }} />
              </summary>
              <div className="pb-5 text-[15px] leading-relaxed text-[#3c4c47]">{m.node}</div>
            </details>
          ))}
        </div>
      )}
    </article>
  );
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h4 className="font-bold" style={{ color: TB.tealDark }}>{title}</h4>
      <ul className="mt-3 space-y-2">
        {items.map((t, i) => <li key={i} className="flex gap-2.5 text-[15px] leading-relaxed text-[#3c4c47]"><Check className="mt-1 h-4 w-4 shrink-0" style={{ color: TB.teal }} />{t}</li>)}
      </ul>
    </div>
  );
}

function Packages({ r, pax, setPax, pdf }: { r: ResolvedTb; pax: number; setPax: (n: number) => void; pdf: boolean }) {
  const pk = r.p.packages;
  const cols = pk.cols;
  const first = cols.find(c => c.id === r.p.chosenPackage) || cols.find(c => c.highlight) || cols[0];
  const [chosen, setChosen] = useState(first?.id || '');
  const bands = sortedBands(pk);
  const prices = useMemo(() => Object.fromEntries(cols.map(c => [c.id, priceFor(pk, c.id, pax)])), [pk, pax]);
  const any = prices[chosen] || priceFor(pk, chosen, pax);
  const band = any.band;
  const [paxText, setPaxText] = useState(String(pax || ''));
  useEffect(() => { if ((Number(paxText) || 0) !== pax) setPaxText(String(pax || '')); }, [pax]);
  const contact = !band;

  return (
    <div className="tb-reveal space-y-6">
      {/* Group size */}
      <div className="flex flex-col gap-4 rounded-3xl bg-white p-5 shadow-[0_10px_40px_-24px_rgba(30,45,41,0.4)] sm:flex-row sm:items-center sm:justify-between sm:p-6" data-pdf-keep>
        <div>
          <p className="font-bold">Number of participants</p>
          <p className="text-sm text-[#5b6b66]">
            {contact ? `For more than ${any.maxPax} participants, we'll prepare a tailored quote.`
              : any.belowMin ? `Minimum ${any.minPax} participants: the ${any.minPax}-participant price applies.`
              : bands.length > 1 ? `Prices for ${band!.min} to ${band!.max} participants.` : 'Prices update as you change the number.'}
          </p>
        </div>
        {pdf ? (
          <p className="text-3xl font-bold" style={{ color: TB.tealDark }}>{pax} pax</p>
        ) : (
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setPax(pax - 1)} className="flex h-11 w-11 items-center justify-center rounded-full border-2 text-[#2f7d66] hover:bg-[#eef7f3]" style={{ borderColor: TB.mint }} aria-label="Fewer participants"><Minus className="h-5 w-5" /></button>
            <input inputMode="numeric" value={paxText} aria-label="Number of participants"
              onChange={e => { const t = e.target.value.replace(/[^0-9]/g, '').slice(0, 4); setPaxText(t); if (Number(t) > 0) setPax(Number(t)); }}
              onBlur={() => setPaxText(String(pax))}
              className="h-11 w-20 rounded-xl border-2 text-center text-xl font-bold outline-none focus:border-[#50a88b]" style={{ borderColor: TB.mint }} />
            <button type="button" onClick={() => setPax(pax + 1)} className="flex h-11 w-11 items-center justify-center rounded-full border-2 text-[#2f7d66] hover:bg-[#eef7f3]" style={{ borderColor: TB.mint }} aria-label="More participants"><Plus className="h-5 w-5" /></button>
          </div>
        )}
      </div>

      {/* Package cards */}
      <div className={`grid gap-4 ${cols.length >= 3 ? 'md:grid-cols-3' : cols.length === 2 ? 'md:grid-cols-2' : ''}`}>
        {cols.map(c => {
          const pr = prices[c.id];
          const on = c.id === chosen;
          return (
            <button key={c.id} type="button" onClick={() => setChosen(c.id)} disabled={pdf}
              className={`relative rounded-3xl border-2 bg-white p-5 text-left transition-all sm:p-6 ${on && !pdf ? 'shadow-[0_20px_50px_-25px_rgba(47,125,102,0.7)] md:-translate-y-1' : 'hover:-translate-y-0.5'}`}
              style={{ borderColor: on && !pdf ? TB.teal : '#e3efe9' }} aria-pressed={on} data-pdf-keep>
              {c.highlight && <span className="absolute -top-3 left-5 rounded-full px-3 py-0.5 text-xs font-bold uppercase tracking-wider text-white" style={{ background: TB.tealDark }}>Recommended</span>}
              <p className="text-sm font-semibold uppercase tracking-wider" style={{ color: TB.teal }}>Package</p>
              <p className="text-2xl font-bold">"{c.name}"</p>
              <p className="mt-3 text-3xl font-extrabold" style={{ color: TB.tealDark }}>{pr?.price ? formatPrice(pr.price) : 'Contact us'}</p>
              <p className="text-sm text-[#5b6b66]">{pr?.price ? `about ${formatPrice(pr.perPax || 0)} per participant` : 'for a tailored quote'}</p>
              {!pdf && <span className={`mt-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${on ? 'text-white' : 'text-[#2f7d66]'}`} style={{ background: on ? TB.teal : TB.mintLight }}>{on ? <><Check className="h-4 w-4" /> Selected</> : 'See what\'s included'}</span>}
            </button>
          );
        })}
      </div>

      {/* What's included: table on wide screens, the chosen package's list on phones */}
      <div className={`overflow-hidden rounded-3xl bg-white shadow-[0_10px_40px_-24px_rgba(30,45,41,0.4)] ${pdf ? '' : 'hidden md:block'}`} data-pdf-keep>
        <table className="w-full text-[15px]">
          <thead>
            <tr style={{ background: TB.teal }} className="text-white">
              <th className="px-5 py-3.5 text-left font-semibold">What's included{pax ? ` (${pax} pax)` : ''}</th>
              {cols.map(c => <th key={c.id} className={`px-4 py-3.5 text-center font-semibold ${c.id === chosen && !pdf ? 'bg-[#2f7d66]' : ''}`}>"{c.name}"</th>)}
            </tr>
          </thead>
          <tbody>
            {pk.rows.filter(x => x.label.trim()).map((row, i) => (
              <tr key={row.id} className={i % 2 ? 'bg-[#f6fbf9]' : ''}>
                <td className="px-5 py-3 font-semibold">{row.label}</td>
                {cols.map(c => <td key={c.id} className={`px-4 py-3 text-center text-[#3c4c47] ${c.id === chosen && !pdf ? 'bg-[#eaf5f0] font-medium text-[#1e2d29]' : ''}`}>{cellText(cellFor(pk, row.id, c.id, prices[c.id]?.band || null))}</td>)}
              </tr>
            ))}
            <tr className="border-t-2" style={{ borderColor: TB.mint }}>
              <td className="px-5 py-4 font-bold">Professional fee</td>
              {cols.map(c => <td key={c.id} className={`px-4 py-4 text-center text-lg font-extrabold ${c.id === chosen && !pdf ? 'bg-[#eaf5f0]' : ''}`} style={{ color: TB.tealDark }}>{prices[c.id]?.price ? formatPrice(prices[c.id].price!) : 'Contact us'}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
      {!pdf && (
        <div className="rounded-3xl bg-white p-5 shadow-[0_10px_40px_-24px_rgba(30,45,41,0.4)] md:hidden">
          <p className="font-bold">Package "{cols.find(c => c.id === chosen)?.name}" includes</p>
          <ul className="mt-3 divide-y divide-[#eef5f2]">
            {pk.rows.filter(x => x.label.trim()).map(row => {
              const v = cellFor(pk, row.id, chosen, band);
              const none = !v.trim() || /^[-–—]$/.test(v.trim()) || /^no$/i.test(v.trim());
              return (
                <li key={row.id} className={`flex items-start gap-3 py-2.5 text-[15px] ${none ? 'text-[#9aa8a3]' : ''}`}>
                  {none ? <Minus className="mt-0.5 h-4 w-4 shrink-0" /> : <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: TB.teal }} />}
                  <span className="flex-1"><span className="font-semibold">{row.label}</span>{!none && !/^yes$/i.test(v.trim()) && <span className="block text-sm text-[#5b6b66]">{v}</span>}</span>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 border-t-2 pt-3 text-xl font-extrabold" style={{ borderColor: TB.mint, color: TB.tealDark }}>{any.price ? formatPrice(any.price) : 'Contact us for a quote'}</p>
        </div>
      )}
      {pk.note && <p className="text-sm text-[#5b6b66]">{pk.note}</p>}
    </div>
  );
}

const cellText = (v: string) => (v.trim() ? v : '-');

function Terms({ text }: { text: string }) {
  const terms = parseTerms(text);
  return (
    <div className="tb-reveal max-w-3xl space-y-1.5 text-[14.5px] leading-relaxed text-[#3c4c47]" data-pdf-keep>
      {terms.map((t, i) => t.kind === 'heading'
        ? <h3 key={i} className={`font-bold text-[#1e2d29] ${i ? 'pt-4' : ''}`}>{t.no}. {t.text}</h3>
        : t.kind === 'bullet'
          ? <p key={i} className="flex gap-2.5 pl-1"><span className="mt-[0.6em] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: TB.teal }} /><span>{t.label && <strong className="text-[#1e2d29]">{t.label}: </strong>}{t.text}</span></p>
          : <p key={i}>{t.text}</p>)}
    </div>
  );
}

function Footer({ r }: { r: ResolvedTb }) {
  return (
    <footer className="px-4 py-10 text-white sm:px-6" style={{ background: TB.teal }} data-pdf-block>
      <div className="mx-auto flex max-w-6xl flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <span className="rounded-2xl bg-white px-3 py-2"><img src={logoUrl} alt="NEXT Academy" className="h-9 w-auto" /></span>
          <div className="text-sm leading-relaxed text-white/90">
            <p className="font-semibold text-white">{COMPANY.name}</p>
            <p>{COMPANY_ADDRESS}</p>
            <p>{COMPANY.phone} · {COMPANY.email}</p>
          </div>
        </div>
        <div className="text-sm text-white/90 md:text-right">
          {r.p.ownerName && <p>Your contact: <span className="font-semibold text-white">{r.p.ownerName}</span></p>}
          <p className="mt-1 font-semibold uppercase tracking-[0.2em] text-white">Private &amp; Confidential</p>
        </div>
      </div>
    </footer>
  );
}

// A faint repeating line of text across the page (the client's name).
function Watermark({ text }: { text: string }) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='420' height='260'><text x='20' y='150' transform='rotate(-24 210 130)' font-family='Poppins, sans-serif' font-size='20' font-weight='600' fill='%231e2d29' fill-opacity='0.07'>${text.replace(/[<>&'"#]/g, '')}</text></svg>`;
  return <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-40" style={{ backgroundImage: `url("data:image/svg+xml;utf8,${svg}")`, backgroundRepeat: 'repeat' }} />;
}
