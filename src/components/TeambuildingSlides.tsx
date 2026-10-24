import React from 'react';
import { clientTitle } from '../lib/programmes';
import { CalendarDays, Check, Clock, MapPin, Navigation, Sparkles, Users } from 'lucide-react';
import logoUrl from '../assets/outline/next-logo.png';
import hrdcRegisteredUrl from '../assets/outline/hrdc-registered.png';
import hrdcClaimableUrl from '../assets/outline/hrdc-claimable.png';
import { COMPANY, COMPANY_ADDRESS } from '../lib/company';
import { formatDate } from '../lib/deals';
import { parseTerms } from '../lib/outlineContent';
import { AGENDA_TAGS, RATINGS, ResolvedTb, TbProposalActivity, TbSectionKey, cellFor, formatPrice, priceFor, sortedBands } from '../lib/teambuilding';
import { Rich, TB, initials } from './TeambuildingSite';

// The teambuilding proposal as landscape slides (Joel, 2026-10-23: "Download PDF - Horizontal", following his
// JM Bariani PowerPoint): one topic per 16:9 slide, mint background, title top left, NEXT logo top right.
// Only used to draw the horizontal PDF (lib/tbPdf.ts photographs each [data-slide]). Long lists are split over
// several slides; anything still too tall is shrunk to fit its page by the PDF maker.

export const SLIDE_W = 1280;
export const SLIDE_H = 720;

const MINT_BG = '#e3f1eb';
const chunk = <T,>(list: T[], n: number): T[][] => { const out: T[][] = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; };
const cont = (title: string, i: number, n: number) => (n > 1 && i > 0 ? `${title} (continued)` : title);

export default function TeambuildingSlides({ r, pax }: { r: ResolvedTb; pax: number }) {
  const p = r.p;
  const titleOf = (k: TbSectionKey) => r.sections.find(s => s.key === k)?.title || '';
  const slides: React.ReactNode[] = [<Cover key="cover" r={r} pax={pax} />];

  for (const s of r.sections) {
    const title = titleOf(s.key);
    switch (s.key) {
      case 'objectives': {
        const parts = chunk(p.objectives.filter(o => (o.title || o.text).trim()), 6);
        parts.forEach((list, i) => slides.push(
          <Slide key={`ob${i}`} title={cont(title, i, parts.length)}>
            <div className={`grid gap-5 ${list.length === 4 ? 'grid-cols-2' : 'grid-cols-3'}`}>
              {list.map((o, k) => (
                <div key={o.id} className="rounded-3xl bg-white p-6 shadow-[0_10px_30px_-20px_rgba(30,45,41,0.4)]">
                  <span className="flex h-11 w-11 items-center justify-center rounded-full text-base font-bold text-white" style={{ background: TB.teal }}>{String(i * 6 + k + 1).padStart(2, '0')}</span>
                  {o.title.trim() && <h3 className="mt-4 text-xl font-bold leading-snug">{o.title}</h3>}
                  {o.text.trim() && <p className="mt-2 text-[16px] leading-relaxed text-[#3c4c47]">{o.text}</p>}
                </div>
              ))}
            </div>
          </Slide>,
        ));
        break;
      }
      case 'trainers':
        p.trainers.filter(t => (t.name || '').trim()).forEach(t => slides.push(
          <Slide key={`tr${t.id}`} title={title}>
            <div className="grid grid-cols-[1fr_20rem] items-center gap-10">
              <div className="rounded-3xl bg-white p-8 shadow-[0_10px_30px_-20px_rgba(30,45,41,0.4)]">
                <h3 className="text-3xl font-bold">{t.name}</h3>
                {t.role && <p className="mt-2 inline-flex rounded-full px-3 py-1 text-sm font-semibold" style={{ background: TB.mintLight, color: TB.tealDark }}>{t.role}</p>}
                <Rich text={t.bio || ''} className="mt-5 text-[16px] leading-relaxed text-[#3c4c47]" />
              </div>
              <div className="relative">
                <div className="absolute -bottom-3 -right-3 h-full w-full rounded-[1.75rem]" style={{ background: TB.mint }} />
                {t.photo
                  ? <img src={t.photo} alt={t.name} className="relative aspect-[4/5] w-full rounded-[1.75rem] object-cover" />
                  : <div className="relative flex aspect-[4/5] w-full items-center justify-center rounded-[1.75rem] text-6xl font-bold text-white" style={{ background: TB.teal }}>{initials(t.name || '')}</div>}
              </div>
            </div>
          </Slide>,
        ));
        break;
      case 'agenda':
        p.agenda.filter(d => d.rows.some(x => x.text.trim())).forEach(d => {
          const parts = chunk(d.rows.filter(x => x.text.trim()), 9);
          parts.forEach((rows, i) => slides.push(
            <Slide key={`ag${d.id}${i}`} title={cont(`${title}${d.title ? ` – ${d.title}` : ''}`, i, parts.length)} top>
              <AgendaTable rows={rows} />
            </Slide>,
          ));
        });
        break;
      case 'activities':
        p.activities.filter(a => a.name.trim()).forEach(a => {
          slides.push(<Slide key={`ac${a.id}`} title={title}><ActivityMain a={a} /></Slide>);
          const details = activityDetails(a);
          if (details.length) slides.push(<Slide key={`acd${a.id}`} title={`${a.name}: the details`} top><Columns items={details} /></Slide>);
        });
        break;
      case 'venues': {
        const list = p.venues.filter(v => (v.name || '').trim());
        if (list.length > 1) slides.push(
          <Slide key="vn" title={title} top>
            <Table head={['Option', 'Venue', 'Stay', 'Distance', 'Travel time']}
              rows={list.map((v, i) => [`${i + 1}`, v.name || '', v.stay || '-', v.distance || '-', v.travelTime || '-'])} bold={1} />
          </Slide>,
        );
        list.forEach((v, i) => slides.push(
          <Slide key={`v${v.id}`} title={list.length > 1 ? `Option ${i + 1}: ${v.name}` : `${title}: ${v.name}`}>
            <div className={`grid items-center gap-8 ${v.photos?.[0] ? 'grid-cols-[1.15fr_1fr]' : ''}`}>
              {v.photos?.[0] && <img src={v.photos[0]} alt={v.name} className="aspect-[16/11] w-full rounded-3xl object-cover" />}
              <div className="rounded-3xl bg-white p-7 shadow-[0_10px_30px_-20px_rgba(30,45,41,0.4)]">
                {v.stay && <p className="text-sm font-semibold uppercase tracking-wider" style={{ color: TB.teal }}>{v.stay}</p>}
                <h3 className="mt-1 text-2xl font-bold">{v.name}</h3>
                <ul className="mt-4 space-y-2 text-[16px] text-[#3c4c47]">
                  {v.distance && <li className="flex gap-2"><Navigation className="mt-1 h-4 w-4 shrink-0" style={{ color: TB.teal }} />{v.distance}</li>}
                  {v.travelTime && <li className="flex gap-2"><Clock className="mt-1 h-4 w-4 shrink-0" style={{ color: TB.teal }} />{v.travelTime}</li>}
                </ul>
                {v.notes && <Rich text={v.notes} className="mt-4 text-[16px] leading-relaxed text-[#3c4c47]" />}
              </div>
            </div>
          </Slide>,
        ));
        break;
      }
      case 'packages': slides.push(...packageSlides(r, pax, title)); break;
      case 'takeaways': {
        const parts = chunk(p.takeaways.filter(o => (o.title || o.text).trim()), 6);
        parts.forEach((list, i) => slides.push(
          <Slide key={`tk${i}`} title={cont(title, i, parts.length)}>
            <div className="grid grid-cols-2 gap-5">
              {list.map(o => (
                <div key={o.id} className="flex gap-4 rounded-3xl bg-white p-6 shadow-[0_10px_30px_-20px_rgba(30,45,41,0.4)]">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white" style={{ background: TB.teal }}><Check className="h-5 w-5" /></span>
                  <div>
                    {o.title.trim() && <h3 className="text-lg font-bold">{o.title}</h3>}
                    {o.text.trim() && <p className="mt-1 text-[16px] leading-relaxed text-[#3c4c47]">{o.text}</p>}
                  </div>
                </div>
              ))}
            </div>
          </Slide>,
        ));
        break;
      }
      case 'hrdc': slides.push(
        <Slide key="hrdc" tone="teal">
          <div className="flex flex-col items-center gap-8 text-center">
            <div className="flex gap-4">
              <img src={hrdcRegisteredUrl} alt="HRD Corp registered training provider" className="h-28 w-auto rounded-2xl bg-white p-3" />
              <img src={hrdcClaimableUrl} alt="HRD Corp claimable" className="h-28 w-auto rounded-2xl bg-white p-3" />
            </div>
            <h2 className="text-4xl font-bold text-white">{title}</h2>
            <p className="max-w-3xl text-lg leading-relaxed text-white/90">{p.hrdcNote}</p>
          </div>
        </Slide>,
      ); break;
      case 'terms': {
        const parts = termChunks(p.terms || '');
        parts.forEach((list, i) => slides.push(
          <Slide key={`te${i}`} title={cont(title, i, parts.length)} top>
            <div className="columns-2 gap-10 text-[13.5px] leading-relaxed text-[#3c4c47]">
              {list.map((t, k) => t.kind === 'heading'
                ? <h3 key={k} className={`break-after-avoid font-bold text-[#1e2d29] ${k ? 'pt-3' : ''}`}>{t.no}. {t.text}</h3>
                : t.kind === 'bullet'
                  ? <p key={k} className="flex gap-2 pl-1 pt-1"><span className="mt-[0.6em] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: TB.teal }} /><span>{t.label && <strong className="text-[#1e2d29]">{t.label}: </strong>}{t.text}</span></p>
                  : <p key={k} className="pt-1">{t.text}</p>)}
            </div>
          </Slide>,
        ));
        break;
      }
    }
  }
  slides.push(<Closing key="end" r={r} />);

  return (
    <div className="tb-site tb-static" style={{ width: SLIDE_W, fontFamily: "'Poppins', 'Plus Jakarta Sans', ui-sans-serif, sans-serif", color: TB.ink }}>
      {slides}
    </div>
  );
}

// ---------- One slide ----------
function Slide({ title, tone = 'mint', top, children }: { title?: string; tone?: 'mint' | 'teal'; top?: boolean; children: React.ReactNode }) {
  const teal = tone === 'teal';
  return (
    <section data-slide data-bg={teal ? TB.tealDark : MINT_BG} className="relative flex flex-col overflow-hidden px-14 pb-12 pt-10"
      style={{ width: SLIDE_W, minHeight: SLIDE_H, background: teal ? TB.tealDark : MINT_BG }}>
      {!teal && (
        <div className="mb-6 flex items-start justify-between gap-8">
          <h2 className="text-[34px] font-bold leading-tight">{title}</h2>
          <img src={logoUrl} alt="NEXT Academy" className="h-11 w-auto shrink-0" />
        </div>
      )}
      <div className={`flex flex-1 flex-col ${top ? '' : 'justify-center'}`}>{children}</div>
      <span className={`absolute bottom-4 left-14 text-xs font-semibold uppercase tracking-[0.2em] ${teal ? 'text-white/60' : 'text-[#7d8f89]'}`}>Private &amp; Confidential</span>
    </section>
  );
}

function Cover({ r, pax }: { r: ResolvedTb; pax: number }) {
  const p = r.p;
  const facts = [
    r.eventDate && { icon: <CalendarDays className="h-5 w-5" />, text: formatDate(r.eventDate) },
    p.stay && { icon: <Clock className="h-5 w-5" />, text: p.stay },
    pax > 0 && { icon: <Users className="h-5 w-5" />, text: `${pax} participants` },
  ].filter(Boolean) as { icon: React.ReactNode; text: string }[];
  return (
    <section data-slide data-bg={MINT_BG} className="relative grid grid-cols-[34%_1fr] overflow-hidden" style={{ width: SLIDE_W, height: SLIDE_H, background: MINT_BG }}>
      <div className="relative overflow-hidden">
        {p.coverPhoto
          ? <img src={p.coverPhoto} alt="" className="absolute inset-0 h-full w-full object-cover" />
          : (
            <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${TB.tealDark} 0%, ${TB.teal} 55%, ${TB.chevron} 100%)` }}>
              <svg className="absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 opacity-80" viewBox="0 0 200 200" aria-hidden="true">
                <path d="M20 20 L90 100 L20 180 L60 180 L130 100 L60 20 Z" fill={TB.mint} opacity="0.55" />
                <path d="M80 20 L150 100 L80 180 L120 180 L190 100 L120 20 Z" fill="#ffffff" opacity="0.6" />
              </svg>
            </div>
          )}
      </div>
      <div className="flex flex-col justify-center px-16 py-14">
        {r.clientLogo && <img src={r.clientLogo} alt={r.company || 'Client logo'} className="mb-8 h-20 w-auto max-w-[14rem] self-start object-contain" />}
        <p className="text-sm font-semibold uppercase tracking-[0.2em]" style={{ color: TB.tealDark }}>Teambuilding proposal{r.company ? ` · Prepared for ${r.company}` : ''}</p>
        <h1 className="mt-3 text-[52px] font-extrabold leading-[1.05]">{clientTitle(p.title) || 'Teambuilding proposal'}</h1>
        {p.subtitle && <p className="mt-4 max-w-2xl text-lg leading-relaxed text-[#3c4c47]">{p.subtitle}</p>}
        {facts.length > 0 && (
          <div className="mt-8 flex flex-wrap gap-3">
            {facts.map(f => <span key={f.text} className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[15px] font-semibold text-white" style={{ background: TB.tealDark }}>{f.icon}{f.text}</span>)}
          </div>
        )}
        <div className="mt-auto flex items-end justify-between pt-10">
          <img src={logoUrl} alt="NEXT Academy" className="h-14 w-auto" />
          {r.isHrdc && (
            <div className="flex gap-2">
              <img src={hrdcRegisteredUrl} alt="HRD Corp registered training provider" className="h-16 w-auto rounded-lg bg-white p-1.5" />
              <img src={hrdcClaimableUrl} alt="HRD Corp claimable" className="h-16 w-auto rounded-lg bg-white p-1.5" />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Closing({ r }: { r: ResolvedTb }) {
  return (
    <Slide tone="teal">
      <div className="flex flex-col items-center gap-6 text-center text-white">
        <span className="rounded-2xl bg-white px-5 py-3"><img src={logoUrl} alt="NEXT Academy" className="h-14 w-auto" /></span>
        <h2 className="text-5xl font-bold">Thank you</h2>
        {r.p.ownerName && <p className="text-lg text-white/90">Your contact: <span className="font-semibold text-white">{r.p.ownerName}</span></p>}
        <div className="text-[15px] leading-relaxed text-white/85">
          <p className="font-semibold text-white">{COMPANY.name}</p>
          <p>{COMPANY_ADDRESS}</p>
          <p>{COMPANY.phone} · {COMPANY.email}</p>
        </div>
      </div>
    </Slide>
  );
}

// ---------- Pieces ----------
function Table({ head, rows, bold, align }: { head: string[]; rows: React.ReactNode[][]; bold?: number; align?: ('left' | 'center')[] }) {
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-[0_10px_30px_-20px_rgba(30,45,41,0.4)]">
      <table className="w-full text-[15px]">
        <thead>
          <tr className="text-white" style={{ background: TB.tealDark }}>
            {head.map((h, i) => <th key={i} className={`px-5 py-3 font-semibold ${align?.[i] === 'center' ? 'text-center' : 'text-left'}`}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={i % 2 ? 'bg-[#f4faf7]' : ''}>
              {row.map((c, k) => <td key={k} className={`px-5 py-3 align-top text-[#3c4c47] ${k === bold ? 'font-semibold text-[#1e2d29]' : ''} ${align?.[k] === 'center' ? 'text-center' : ''}`}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AgendaTable({ rows }: { rows: { id: string; time: string; text: string; tag?: string }[] }) {
  const tagLabel = (t?: string) => AGENDA_TAGS.find(x => x.key === t)?.label || '';
  const tags = rows.some(x => x.tag);
  return (
    <Table head={tags ? ['Time', 'Activity', 'Where'] : ['Time', 'Activity']} bold={0}
      rows={rows.map(x => [
        <span className="whitespace-nowrap" style={{ color: TB.tealDark }}>{x.time}</span>,
        <span className="font-medium text-[#1e2d29]">{x.text}</span>,
        ...(tags ? [x.tag ? <span className="inline-flex rounded-full px-3 py-0.5 text-xs font-semibold" style={{ background: x.tag === 'dining' ? '#fdf1e2' : TB.mintLight, color: x.tag === 'dining' ? '#a8650f' : TB.tealDark }}>{tagLabel(x.tag)}</span> : ''] : []),
      ])} />
  );
}

function ActivityMain({ a }: { a: TbProposalActivity }) {
  const facts = [
    a.duration && { icon: <Clock className="h-4 w-4" />, label: 'Duration', text: a.duration },
    a.location && { icon: <MapPin className="h-4 w-4" />, label: 'Location', text: a.location },
    a.format && { icon: <Sparkles className="h-4 w-4" />, label: 'Format', text: a.format },
    a.groupSize && { icon: <Users className="h-4 w-4" />, label: 'Group size', text: a.groupSize },
  ].filter(Boolean) as { icon: React.ReactNode; label: string; text: string }[];
  const ratings = RATINGS.filter(x => (a.ratings?.[x.key] || 0) > 0);
  const photo = a.photos?.[0];
  return (
    <div className={`grid items-start gap-8 ${photo || ratings.length ? 'grid-cols-[1.1fr_1fr]' : ''}`}>
      <div>
        <p className="text-sm font-semibold uppercase tracking-wider" style={{ color: TB.teal }}>Highlight activity</p>
        <h3 className="mt-1 text-3xl font-bold">{a.name}</h3>
        {a.summary && <p className="mt-3 text-[16px] leading-relaxed text-[#3c4c47]">{a.summary}</p>}
        {facts.length > 0 && (
          <dl className="mt-5 grid grid-cols-2 gap-3">
            {facts.map(f => (
              <div key={f.label} className="rounded-2xl bg-white px-4 py-3">
                <dt className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider" style={{ color: TB.teal }}>{f.icon}{f.label}</dt>
                <dd className="mt-0.5 text-[15px] font-semibold">{f.text}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      {(photo || ratings.length > 0) && (
        <div className="space-y-5">
          {photo && <img src={photo} alt={a.name} className={`w-full rounded-3xl object-cover ${ratings.length ? 'aspect-[16/9]' : 'aspect-[4/3]'}`} />}
          {ratings.length > 0 && (
            <div className="space-y-2 rounded-3xl bg-white p-5">
              {ratings.map(x => (
                <div key={x.key}>
                  <div className="flex justify-between text-sm"><span className="font-medium">{x.label}</span><span className="text-[#5b6b66]">{a.ratings[x.key]}%</span></div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-[#e6f1ed]">
                    <div className="h-full rounded-full" style={{ width: `${Math.min(100, a.ratings[x.key] || 0)}%`, background: `linear-gradient(90deg, ${TB.chevron}, ${TB.tealDark})` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function activityDetails(a: TbProposalActivity): { title: string; node: React.ReactNode }[] {
  const list = (items: string[]) => (
    <ul className="space-y-1.5">{items.map((t, i) => <li key={i} className="flex gap-2.5"><Check className="mt-1 h-4 w-4 shrink-0" style={{ color: TB.teal }} />{t}</li>)}</ul>
  );
  return [
    a.objectives.length > 0 && { title: 'Learning objectives', node: list(a.objectives) },
    a.takeaways.length > 0 && { title: 'Learning takeaways', node: list(a.takeaways) },
    a.howPlayed.trim() && { title: 'How it is played', node: <Rich text={a.howPlayed} /> },
    a.deliverables.trim() && { title: 'Expected deliverables', node: <Rich text={a.deliverables} /> },
    a.materials.length > 0 && { title: 'Materials', node: list(a.materials) },
  ].filter(Boolean) as { title: string; node: React.ReactNode }[];
}

function Columns({ items }: { items: { title: string; node: React.ReactNode }[] }) {
  return (
    <div className="columns-2 gap-6">
      {items.map(m => (
        <div key={m.title} className="mb-6 break-inside-avoid rounded-3xl bg-white p-6 text-[15px] leading-relaxed text-[#3c4c47]">
          <h4 className="mb-3 text-lg font-bold" style={{ color: TB.tealDark }}>{m.title}</h4>
          {m.node}
        </div>
      ))}
    </div>
  );
}

function packageSlides(r: ResolvedTb, pax: number, title: string): React.ReactNode[] {
  const pk = r.p.packages;
  const cols = pk.cols;
  if (!cols.length) return [];
  const prices = Object.fromEntries(cols.map(c => [c.id, priceFor(pk, c.id, pax)]));
  const any = prices[cols[0].id];
  const bands = sortedBands(pk);
  const note = !any.band ? `For more than ${any.maxPax} participants, we'll prepare a tailored quote.`
    : any.belowMin ? `Minimum ${any.minPax} participants: the ${any.minPax}-participant price applies.`
    : bands.length > 1 ? `Prices for ${any.band.min} to ${any.band.max} participants.` : '';
  const out: React.ReactNode[] = [
    <Slide key="pk" title={title}>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between rounded-3xl bg-white px-7 py-5">
          <div><p className="text-lg font-bold">Number of participants</p>{note && <p className="text-[15px] text-[#5b6b66]">{note}</p>}</div>
          <p className="text-4xl font-bold" style={{ color: TB.tealDark }}>{pax} pax</p>
        </div>
        <div className={`grid gap-5 ${cols.length >= 3 ? 'grid-cols-3' : cols.length === 2 ? 'grid-cols-2' : ''}`}>
          {cols.map(c => {
            const pr = prices[c.id];
            return (
              <div key={c.id} className="relative rounded-3xl border-2 bg-white p-7" style={{ borderColor: c.highlight ? TB.teal : '#d7ebe3' }}>
                {c.highlight && <span className="absolute -top-3 left-6 rounded-full px-3 py-0.5 text-xs font-bold uppercase tracking-wider text-white" style={{ background: TB.tealDark }}>Recommended</span>}
                <p className="text-sm font-semibold uppercase tracking-wider" style={{ color: TB.teal }}>Package</p>
                <p className="text-2xl font-bold">"{c.name}"</p>
                <p className="mt-4 text-4xl font-extrabold" style={{ color: TB.tealDark }}>{pr?.price ? formatPrice(pr.price) : 'Contact us'}</p>
                <p className="text-[15px] text-[#5b6b66]">{pr?.price ? `about ${formatPrice(pr.perPax || 0)} per participant` : 'for a tailored quote'}</p>
              </div>
            );
          })}
        </div>
        {pk.note && <p className="text-sm text-[#5b6b66]">{pk.note}</p>}
      </div>
    </Slide>,
  ];
  const rows = pk.rows.filter(x => x.label.trim());
  const parts = chunk(rows, rows.length <= 10 ? 10 : 9);
  parts.forEach((list, i) => {
    const last = i === parts.length - 1;
    out.push(
      <Slide key={`pkt${i}`} title={cont(`What's included${pax ? ` (${pax} pax)` : ''}`, i, parts.length)} top>
        <Table head={['', ...cols.map(c => `"${c.name}"`)]} bold={0} align={['left', ...cols.map(() => 'center' as const)]}
          rows={[
            ...list.map(row => [row.label, ...cols.map(c => { const v = cellFor(pk, row.id, c.id, prices[c.id]?.band || null); return v.trim() ? v : '-'; })]),
            ...(last ? [[<span className="font-bold">Professional fee</span>, ...cols.map(c => <span className="text-lg font-extrabold" style={{ color: TB.tealDark }}>{prices[c.id]?.price ? formatPrice(prices[c.id].price!) : 'Contact us'}</span>)]] : []),
          ]} />
      </Slide>,
    );
  });
  return out;
}

// Terms split into slides of about the same length (two columns each).
function termChunks(text: string) {
  const terms = parseTerms(text);
  const out: (typeof terms)[] = [];
  let cur: typeof terms = [];
  let size = 0;
  for (const t of terms) {
    const len = (t.text || '').length + ((t as any).label || '').length + 60;
    if (cur.length && (size + len > 2600 || (t.kind === 'heading' && size + len > 2200))) { out.push(cur); cur = []; size = 0; }
    cur.push(t); size += len;
  }
  if (cur.length) out.push(cur);
  return out;
}
