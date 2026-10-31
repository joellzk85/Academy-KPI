// The website's building blocks (Joel, 2026-10-30; docs/features/website.md). The same blocks draw the page in the
// CRM's drag-and-drop editor (components/WebsiteEditor.tsx) and on the public site (serverWebsite.ts), so what you
// see while editing is what visitors get. Only the brand's colours and font can be picked (lib/website.ts SITE_CSS).
import React, { createContext, useContext, useRef } from 'react';
import type { Config, Field } from '@puckeditor/core';
import { COMPANY, COMPANY_ADDRESS } from '../lib/company';
import { PageData, SiteMedia, SiteSettings, cleanRichText, safeHref } from '../lib/website';
import { formatRM } from '../lib/deals';
import { CONSENT_TEXT } from '../lib/websiteEnquiries';
import { SiteData, WEB_TYPE_LABELS, WebProgramme, WebRun, WebTrainer, WebType, daysText, runDates, runDay, runMonth, seatsText } from '../lib/websiteData';

export type SiteLink = { label: string; href: string; button?: boolean };
/** Pages made from the CRM: a programme, a trainer, Register on a date, and the messages after a form. */
export type SiteSpecial = { kind: 'programme' | 'trainer' | 'register' | 'message' | 'problem'; slug: string };

export type SiteCtx = {
  media: Record<string, SiteMedia>;
  menu: SiteLink[];
  settings: SiteSettings;
  data?: SiteData;                                          // runs, programmes and trainers from the CRM
  form?: { stamp: string; base: string; page: string; programme?: string; back?: string };   // the website's forms (Batch 3; server only)
  editing: boolean;
  inlineCss?: string;                                       // the editor's preview carries the style sheet itself
  onResizeColumns?: (id: string, split: number) => void;    // dragging the line between two columns (editor only)
};

const SiteContext = createContext<SiteCtx>({ media: {}, menu: [], settings: {}, editing: false });
export const SiteProvider = SiteContext.Provider;
const useSite = () => useContext(SiteContext);

// A text box's value is a string on the public site and a ready-made piece of page while editing (typing on the page).
const has = (v: unknown) => v !== undefined && v !== null && v !== '';

type Bg = 'white' | 'light' | 'dark' | 'black' | 'blue' | 'teal';
// `edge` 'torn': the band's top edge is ripped paper over the band above (Facebook posts look, 2026-10-30).
const bandClass = (bg: Bg | undefined, pad: 's' | 'm' | 'l' = 'm', grid = true, edge?: string) =>
  `nw-band nw-bg-${bg || 'white'} nw-pad-${pad}${grid && (bg === 'dark' || bg === 'light' || bg === 'black') ? ' nw-grid' : ''}${edge === 'torn' ? ' nw-tear' : ''}`;

/** Highlights each of the words (separated by |) in mint, as on the Facebook posts. */
function markWords(line: string, words: string): React.ReactNode {
  const list = String(words || '').split('|').map(w => w.trim()).filter(Boolean);
  if (!list.length) return line;
  const esc = list.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return String(line || '').split(new RegExp(`(${esc.join('|')})`, 'g')).map((part, i) => list.includes(part) ? <span key={i} className="nw-mark">{part}</span> : part);
}

/** A white review card (Google review style) with the name in mint. */
function ReviewCard({ name, role, text, source }: { name?: any; role?: any; text?: any; source?: any }) {
  return (
    <div className="nw-review">
      {has(name) && <strong>{name}</strong>}
      {has(role) && <small>{role}</small>}
      {has(text) && <p>"{text}"</p>}
      {has(source) && <span className="nw-review-src">{source}<b aria-label="5 stars">★★★★★</b></span>}
    </div>
  );
}

function Heading({ eyebrow, heading, highlight, headingEnd, level = 2, text }: { eyebrow?: any; heading?: any; highlight?: any; headingEnd?: any; level?: 1 | 2 | 3; text?: any }) {
  const Tag = (`h${level}` as 'h1' | 'h2' | 'h3');
  return (
    <>
      {has(eyebrow) && <p className="nw-eyebrow">{eyebrow}</p>}
      {(has(heading) || has(highlight)) && (
        <Tag className={`nw-h${level}`}>{heading}{has(highlight) && <>{' '}<span className="nw-mark">{highlight}</span></>}{has(headingEnd) && <> {headingEnd}</>}</Tag>
      )}
      {has(text) && <p className="nw-lead">{text}</p>}
    </>
  );
}

/** A photo from the Media library (by id), cropped around its focus point. */
function MediaImage({ id, className, style, fallbackAlt }: { id?: string; className?: string; style?: React.CSSProperties; fallbackAlt?: string }) {
  const m = useSite().media[id || ''];
  if (!m || m.kind !== 'image') {
    return <div className={`nw-placeholder ${className || ''}`} style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Pick a photo</div>;
  }
  return (
    <img src={m.url} alt={m.alt || fallbackAlt || ''} loading="lazy" className={className}
      width={m.width || undefined} height={m.height || undefined}
      style={{ objectPosition: `${m.focusX ?? 50}% ${m.focusY ?? 50}%`, ...style }} />
  );
}

function MediaVideo({ id }: { id?: string }) {
  const { media, editing } = useSite();
  const m = media[id || ''];
  // An empty video slot shows only while editing; visitors never see a blank box (Joel, 2026-10-31).
  if (!m) return editing ? <div className="nw-placeholder">Pick a video or YouTube link</div> : null;
  if (m.kind === 'youtube' && m.youtubeId) {
    return (
      <div className="nw-video">
        <iframe src={`https://www.youtube-nocookie.com/embed/${m.youtubeId}`} title={m.alt || m.name} loading="lazy"
          allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" allowFullScreen
          style={editing ? { pointerEvents: 'none' } : undefined} />
      </div>
    );
  }
  if (m.kind === 'video') return <div className="nw-video"><video src={m.url} controls preload="metadata" aria-label={m.alt || m.name} /></div>;
  return <MediaImage id={id} className="nw-photo" />;
}

const PhotoWithStyle = ({ id, look, height, alt }: { id?: string; look?: string; height?: number; alt?: string }) => {
  if (look === 'tinted') {
    return <div className="nw-tint nw-torn"><MediaImage id={id} className="nw-photo" style={{ height: height || 380 }} fallbackAlt={alt} /></div>;
  }
  const img = <MediaImage id={id} className={`nw-photo${look === 'torn' ? ' nw-torn' : ''}`} style={{ height: height || 380 }} fallbackAlt={alt} />;
  return look === 'frame' ? <div className="nw-frame">{img}</div> : img;
};

const LOOK_OPTIONS = [{ label: 'Plain', value: 'plain' }, { label: 'Frame', value: 'frame' }, { label: 'Torn paper', value: 'torn' }, { label: 'Torn paper, mint tint', value: 'tinted' }];

// ---------- Ready-made sections ----------

const Hero = (p: any) => {
  const { editing, settings } = useSite();
  const rating = p.showRating === 'yes' && has(settings.googleRating);
  return (
  <section className={bandClass(p.background, 'l')}>
    <div className="nw-wrap nw-split">
      <div className="nw-stack" style={{ gap: 28 }}>
        <Heading eyebrow={p.eyebrow} heading={p.headline} highlight={p.highlight} headingEnd={p.headlineEnd} level={1} />
        {has(p.text) && <p className="nw-lead">{p.text}</p>}
        <div className="nw-btns">
          {has(p.button1Label) && <a className="nw-btn nw-btn-teal" href={safeHref(p.button1Link)}>{p.button1Label}</a>}
          {has(p.button2Label) && <a className="nw-btn nw-btn-outline" href={safeHref(p.button2Link)}>{p.button2Label}</a>}
        </div>
        {rating && <p className="nw-rating"><b aria-hidden="true">★★★★★</b> {settings.googleRating} on Google{has(settings.googleReviews) ? ` · ${settings.googleReviews} reviews` : ''}</p>}
      </div>
      {(p.image || editing) && (
        <div className="nw-hero-pic">
          <PhotoWithStyle id={p.image} look={p.imageStyle} height={440} />
          {(has(p.reviewName) || has(p.reviewText)) && <ReviewCard name={p.reviewName} role={p.reviewRole} text={p.reviewText} source={p.reviewSource} />}
        </div>
      )}
    </div>
  </section>
  );
};

const Section = ({ background, spacing, width, texture, edge, content: Content }: any) => (
  <section className={bandClass(background, spacing || 'm', texture !== 'no', edge)}>
    <div className={`nw-wrap${width === 'narrow' ? ' nw-narrow' : ''}`}>
      <Content className="nw-stack" />
    </div>
  </section>
);

const Points = (p: any) => p.look === 'squares' ? (
  // The Facebook checklist: heading on the left, mint squares with a bold line and a smaller line on the right.
  <section className={bandClass(p.background, 'm', true, p.edge)}>
    <div className="nw-wrap nw-split" style={{ alignItems: 'flex-start' }}>
      <div className="nw-stack" style={{ gap: 14 }}><Heading eyebrow={p.eyebrow} heading={p.heading} highlight={p.highlight} /></div>
      <ul className="nw-squares">
        {(p.items || []).map((it: any, i: number) => (
          <li key={i}><div><strong>{it.title}</strong>{has(it.text) && <span className="nw-muted">{it.text}</span>}</div></li>
        ))}
      </ul>
    </div>
  </section>
) : (
  <section className={bandClass(p.background, 'm', true, p.edge)}>
    <div className="nw-wrap nw-stack" style={{ gap: 48 }}>
      <div className="nw-stack" style={{ gap: 14, maxWidth: 760 }}><Heading eyebrow={p.eyebrow} heading={p.heading} highlight={p.highlight} /></div>
      <div className="nw-points">
        {(p.items || []).map((it: any, i: number) => (
          <div className="nw-point" key={i}>
            <span className="nw-point-n">{String(i + 1).padStart(2, '0')}</span>
            <h3 className="nw-h3" style={{ fontSize: 22 }}>{it.title}</h3>
            <p className="nw-muted">{it.text}</p>
          </div>
        ))}
      </div>
    </div>
  </section>
);

const LogoStrip = (p: any) => {
  const { editing } = useSite();
  if (!(p.items || []).length && !editing) return null;
  return (
  <section className="nw-band nw-bg-white" style={{ borderBottom: '1px solid #E4E4E1' }}>
    <div className="nw-wrap nw-logos" style={{ paddingTop: 28, paddingBottom: 28 }}>
      {has(p.label) && <strong style={{ color: '#0B0F0E' }}>{p.label}</strong>}
      {(p.items || []).map((it: any, i: number) => it.image ? <MediaImage key={i} id={it.image} fallbackAlt={it.name} /> : <span key={i}>{it.name}</span>)}
      {!(p.items || []).length && <span className="nw-placeholder" style={{ padding: '8px 16px' }}>Add client logos here (hidden on the website until you do)</span>}
    </div>
  </section>
  );
};

const ValuesBand = (p: any) => (
  <section className={bandClass(p.background || 'blue', 's', false, p.edge)}>
    <div className="nw-wrap nw-values">
      {has(p.label) && <span className="nw-eyebrow" style={{ fontSize: 13 }}>{p.label}</span>}
      {(p.items || []).map((it: any, i: number) => <span key={i}>{it.word}</span>)}
    </div>
  </section>
);

/** Reviews wall: black-and-white training photos with white review cards on top. */
const ReviewWall = (p: any) => (
  <section className={bandClass(p.background, 'm', true, p.edge)}>
    <div className="nw-wrap nw-stack" style={{ gap: 36 }}>
      <div className="nw-stack" style={{ gap: 14, maxWidth: 760 }}><Heading eyebrow={p.eyebrow} heading={p.heading} highlight={p.highlight} /></div>
      <div className="nw-wall">
        {(p.photos || []).slice(0, 4).map((ph: any, i: number) => <div key={i}><MediaImage id={ph.image} /></div>)}
        <div className="nw-wall-cards">
          {(p.reviews || []).slice(0, 3).map((r: any, i: number) => <ReviewCard key={i} name={r.name} role={r.role} text={r.text} source={r.source} />)}
        </div>
      </div>
    </div>
  </section>
);

/** Tiles: a photo on top, words on black under a torn edge (the programme tracks). */
const Tiles = (p: any) => (
  <section className={bandClass(p.background, 'm', true, p.edge)}>
    <div className="nw-wrap nw-stack" style={{ gap: 36 }}>
      <div className="nw-stack" style={{ gap: 14, maxWidth: 760 }}><Heading eyebrow={p.eyebrow} heading={p.heading} highlight={p.highlight} /></div>
      <div className="nw-tiles">
        {(p.items || []).map((it: any, i: number) => (
          <a key={i} className="nw-tile" href={safeHref(it.link)}>
            <MediaImage id={it.image} />
            <div className="nw-tile-body">
              {has(it.eyebrow) && <p className="nw-eyebrow">{it.eyebrow}</p>}
              <h3 className="nw-h3">{it.title}</h3>
              {has(it.tags) && <div className="nw-tags">{String(it.tags).split(',').map((t: string) => t.trim()).filter(Boolean).map((t: string) => <span key={t}>{t}</span>)}</div>}
              {has(it.linkLabel) && <span className="nw-tile-go">{it.linkLabel} →</span>}
            </div>
          </a>
        ))}
      </div>
    </div>
  </section>
);

/** HR insights: the Facebook posts as square cards, each opening the post (or a page). */
const Insights = (p: any) => (
  <section className={bandClass(p.background || 'black', 'm', true, p.edge)}>
    <div className="nw-wrap nw-stack" style={{ gap: 36 }}>
      <div className="nw-btns" style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 20 }}>
        <div className="nw-stack" style={{ gap: 14, maxWidth: 680 }}><Heading eyebrow={p.eyebrow} heading={p.heading} highlight={p.highlight} text={p.text} /></div>
        {has(p.moreLabel) && <a className="nw-btn nw-btn-outline" href={safeHref(p.moreLink)} target={/^https?:/.test(p.moreLink || '') ? '_blank' : undefined} rel="noopener">{p.moreLabel}</a>}
      </div>
      <div className="nw-posts">
        {(p.items || []).map((it: any, i: number) => {
          const out = /^https?:/.test(it.link || '');
          return (
            <a key={i} className={`nw-post${it.image ? ' nw-has-pic' : ''}`} href={safeHref(it.link)} target={out ? '_blank' : undefined} rel={out ? 'noopener' : undefined}>
              <h3>{markWords(it.title, it.highlight)}</h3>
              <div className="nw-post-meta"><span>{it.topic}</span><span>{it.note}</span></div>
              {it.image && <div className="nw-post-pic"><div className="nw-tint nw-torn" style={{ height: '100%' }}><MediaImage id={it.image} /></div></div>}
            </a>
          );
        })}
      </div>
    </div>
  </section>
);

const Quote = (p: any) => {
  const { editing } = useSite();
  return (
  <section className={bandClass(p.background || 'dark', 'l', true, p.edge)}>
    <div className="nw-wrap nw-split">
      <div className="nw-stack" style={{ gap: 24 }}>
        <svg className="nw-quote-mark" viewBox="0 0 56 56" aria-hidden="true"><path d="M0 0H56V30C56 46 44 56 24 56H0V40C14 40 22 36 24 28H0Z" fill="#5BC0A0" /></svg>
        <p className="nw-quote">{p.quote}</p>
        {has(p.name) && <p className="nw-muted">{p.name}</p>}
      </div>
      {(p.media || editing) && <div><MediaVideo id={p.media} /></div>}
    </div>
  </section>
  );
};

/** Client videos: up to three slots. Empty slots are left out, and with none filled the whole band is hidden. */
const VideoRow = (p: any) => {
  const { media, editing } = useSite();
  const vids = (p.videos || []).slice(0, 3).filter((v: any) => editing || media[v.video || '']);
  if (!vids.length && !editing) return null;
  return (
    <section className={bandClass(p.background, 'm', true, p.edge)}>
      <div className="nw-wrap nw-stack" style={{ gap: 36 }}>
        {(has(p.eyebrow) || has(p.heading) || has(p.highlight)) && <div className="nw-stack" style={{ gap: 14, maxWidth: 760 }}><Heading eyebrow={p.eyebrow} heading={p.heading} highlight={p.highlight} text={p.text} /></div>}
        <div className="nw-vids" style={{ gridTemplateColumns: `repeat(${Math.max(1, vids.length)}, minmax(0, 1fr))` }}>
          {vids.map((v: any, i: number) => (
            <figure key={i} style={{ margin: 0 }}>
              <MediaVideo id={v.video} />
              {has(v.caption) && <figcaption className="nw-caption">{v.caption}</figcaption>}
            </figure>
          ))}
        </div>
        {has(p.buttonLabel) && <div className="nw-btns"><a className="nw-btn nw-btn-teal" href={safeHref(p.buttonLink)}>{p.buttonLabel}</a></div>}
      </div>
    </section>
  );
};

/** Without / With: the StoryBrand failure and success side by side (2026-10-31). */
const Compare = (p: any) => {
  const rows = (p.rows || []).filter((r: any) => has(r.without) || has(r.with));
  return (
    <section className={bandClass(p.background, 'm', true, p.edge)}>
      <div className="nw-wrap nw-stack" style={{ gap: 36 }}>
        <div className="nw-stack" style={{ gap: 14, maxWidth: 760 }}><Heading eyebrow={p.eyebrow} heading={p.heading} highlight={p.highlight} text={p.text} /></div>
        <div className="nw-compare">
          <div className="nw-compare-col nw-compare-without">
            <h3>{p.withoutTitle}</h3>
            <ul>{rows.map((r: any, i: number) => has(r.without) && <li key={i}>{r.without}</li>)}</ul>
          </div>
          <div className="nw-compare-col nw-compare-with">
            <h3>{p.withTitle}</h3>
            <ul>{rows.map((r: any, i: number) => has(r.with) && <li key={i}>{r.with}</li>)}</ul>
          </div>
        </div>
        {has(p.buttonLabel) && <div className="nw-btns"><a className="nw-btn nw-btn-teal" href={safeHref(p.buttonLink)}>{p.buttonLabel}</a></div>}
      </div>
    </section>
  );
};

// ---------- From the CRM (Batch 2): calendar, programmes, trainers (lib/websiteData.ts) ----------

/** WhatsApp (or email) with the message already written, until the registration form (Batch 3). */
function registerHref(settings: SiteSettings, text: string): string {
  const wa = (settings.whatsapp || '').replace(/[^0-9]/g, '');
  return wa ? `https://wa.me/${wa}?text=${encodeURIComponent(text)}` : `mailto:${COMPANY.email}?subject=${encodeURIComponent(text)}`;
}

function RunCard({ r }: { r: WebRun }) {
  const { settings } = useSite();
  const seats = seatsText(r);
  const full = r.seatsLeft !== null && r.seatsLeft <= 0;
  const where = [r.venue, r.area && !r.venue.toLowerCase().includes(r.area.toLowerCase()) ? r.area : '', daysText(r.days)].filter(Boolean).join(' · ');
  return (
    <article className="nw-run">
      <div className="nw-run-date"><span className="nw-run-day">{runDay(r)}</span><span className="nw-run-mon">{runMonth(r)}</span></div>
      <div className="nw-run-body">
        <h3 className="nw-run-title">{r.titleSlug ? <a href={`/programmes/${r.titleSlug}`} style={{ color: 'inherit', textDecoration: 'none' }}>{r.title}</a> : r.title}</h3>
        <p className="nw-muted" style={{ fontSize: 15 }}>{runDates(r)}{where ? ` · ${where}` : ''}</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {r.price > 0 && <span className="nw-chip">{formatRM(r.price)} per pax</span>}
          {r.hrdc && <span className="nw-chip">HRD Corp claimable</span>}
          {seats && <span className={`nw-chip${full ? ' nw-chip-full' : ''}`}>{seats}</span>}
        </div>
        <div style={{ marginTop: 'auto', paddingTop: 6 }}>
          {full
            ? <a className="nw-link" href={`/register/${r.id}`}>Join the waiting list →</a>
            : <a className="nw-link" href={`/register/${r.id}`}>Register →</a>}
        </div>
      </div>
    </article>
  );
}

function RunList({ runs, empty }: { runs: WebRun[]; empty?: string }) {
  const { settings } = useSite();
  if (!runs.length) {
    return <p className="nw-muted">{empty || 'New dates are coming soon. '}<a href={registerHref(settings, "Hi Next Academy, I'd like to know your next training dates.")} target="_blank" rel="noopener">Ask us about the next dates</a>.</p>;
  }
  return <div className="nw-cards">{runs.map(r => <RunCard key={r.id} r={r} />)}</div>;
}

const Calendar = (p: any) => {
  const { data } = useSite();
  const all = (data?.runs || []).filter(r => !p.only || p.only === 'all' || r.type === p.only);
  const n = Number(p.count) || 0;
  const runs = n > 0 ? all.slice(0, n) : all;
  return (
    <section id="calendar" className={bandClass(p.background, 'm', true, p.edge)}>
      <div className="nw-wrap nw-stack" style={{ gap: 36 }}>
        <div className="nw-stack" style={{ gap: 14 }}><Heading eyebrow={p.eyebrow} heading={p.heading} text={p.text} /></div>
        <RunList runs={runs} />
        {n > 0 && all.length > n && <a className="nw-link" href="/training-calendar">See all {all.length} dates →</a>}
      </div>
    </section>
  );
};

function ProgrammeLinks({ list }: { list: WebProgramme[] }) {
  return (
    <div className="nw-stack" style={{ gap: 0 }}>
      {list.map(x => (
        <a key={x.id} href={`/programmes/${x.slug}`} className="nw-row-link">
          <span>{x.name}{x.hrdc && <span className="nw-chip" style={{ marginLeft: 10, verticalAlign: 'middle' }}>HRD Corp claimable</span>}</span>
          <span aria-hidden="true" style={{ color: '#2B6AA2' }}>→</span>
        </a>
      ))}
    </div>
  );
}

const Programmes = (p: any) => {
  const { data } = useSite();
  const list = (data?.programmes || []).filter(x => !p.only || p.only === 'all' || x.type === p.only);
  const groups = (['soft', 'technical', 'teambuilding'] as WebType[]).map(t => ({ t, items: list.filter(x => x.type === t) })).filter(g => g.items.length);
  return (
    <section id="programmes" className={bandClass(p.background, 'm', true, p.edge)}>
      <div className="nw-wrap nw-split" style={{ alignItems: 'flex-start' }}>
        <div className="nw-stack"><Heading eyebrow={p.eyebrow} heading={p.heading} text={p.text} /></div>
        <div className="nw-stack" style={{ gap: 28 }}>
          {groups.length === 0 && <p className="nw-muted">Programmes appear here once they are ticked "Show on the website" in the CRM.</p>}
          {groups.map(g => (
            <div key={g.t} className="nw-stack" style={{ gap: 4 }}>
              {groups.length > 1 && <h3 className="nw-eyebrow" style={{ color: 'inherit', opacity: 0.75 }}>{WEB_TYPE_LABELS[g.t]}</h3>}
              <ProgrammeLinks list={g.items} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

function TrainerCard({ t }: { t: WebTrainer }) {
  return (
    <a href={`/trainers/${t.slug}`} className="nw-stack nw-person" style={{ gap: 12 }}>
      <div className="nw-person-photo">{t.photo ? <img src={t.photo} alt={t.name} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span>{t.name}</span>}</div>
      <div><h3 style={{ fontSize: 19 }}>{t.name}</h3>{t.headline && <p className="nw-muted" style={{ fontSize: 15 }}>{t.headline}</p>}</div>
    </a>
  );
}

const Trainers = (p: any) => {
  const { data } = useSite();
  const all = data?.trainers || [];
  const n = Number(p.count) || 0;
  const list = n > 0 ? all.slice(0, n) : all;
  return (
    <section id="trainers" className={bandClass(p.background, 'm', true, p.edge)}>
      <div className="nw-wrap nw-stack" style={{ gap: 36 }}>
        <div className="nw-stack" style={{ gap: 14 }}><Heading eyebrow={p.eyebrow} heading={p.heading} highlight={p.highlight} /></div>
        {list.length === 0 && <p className="nw-muted">Trainers appear here once they agree and are ticked "Show on the website" in the CRM.</p>}
        <div className="nw-people">{list.map(t => <TrainerCard key={t.id} t={t} />)}</div>
        {n > 0 && all.length > n && <a className="nw-link" href="/trainers">Meet all {all.length} trainers →</a>}
      </div>
    </section>
  );
};

// ---------- Pages made from the CRM (no editing needed): calendar, a programme, a trainer, and their lists ----------

const Bullets = ({ items }: { items: string[] }) => <ul className="nw-list">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>;

export function ProgrammePage({ slug }: { slug: string }) {
  const { data, settings } = useSite();
  const x = data?.programmes.find(p => p.slug === slug);
  if (!x) return null;
  const runs = (data?.runs || []).filter(r => r.titleSlug === slug);
  const people = (data?.trainers || []).filter(t => x.trainerSlugs.includes(t.slug));
  const facts = [WEB_TYPE_LABELS[x.type], daysText(x.days), x.hrdc ? 'HRD Corp claimable' : ''].filter(Boolean);
  return (
    <>
      <section className={bandClass('dark', 'l')}>
        <div className="nw-wrap nw-stack" style={{ gap: 24, maxWidth: 980, marginLeft: 'auto', marginRight: 'auto' }}>
          <p className="nw-eyebrow"><a href="/programmes" style={{ color: 'inherit', textDecoration: 'none' }}>Programmes</a>{x.category ? ` / ${x.category}` : ''}</p>
          <h1 className="nw-h1" style={{ fontSize: 'clamp(36px, 5vw, 60px)' }}>{x.name}</h1>
          {(x.summary || x.overview) && <p className="nw-lead">{x.summary || x.overview}</p>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{facts.map(f => <span key={f} className="nw-chip">{f}</span>)}</div>
          <div className="nw-btns">
            {runs.length > 0 && <a className="nw-btn nw-btn-teal" href="#dates">See the dates</a>}
            <a className="nw-btn nw-btn-outline" href="#contact">{runs.length ? 'Ask a question' : 'Bring it to your team'}</a>
          </div>
        </div>
      </section>
      <section className={bandClass('white')}>
        <div className="nw-wrap nw-stack" style={{ gap: 48, maxWidth: 980, marginLeft: 'auto', marginRight: 'auto' }}>
          {x.summary && x.overview && <div className="nw-stack" style={{ gap: 12 }}><h2 className="nw-h3">About this programme</h2><p className="nw-muted" style={{ whiteSpace: 'pre-line' }}>{x.overview}</p></div>}
          {x.outcomes.length > 0 && <div className="nw-stack" style={{ gap: 12 }}><h2 className="nw-h3">What you'll be able to do</h2><Bullets items={x.outcomes} /></div>}
          {x.audience.length > 0 && <div className="nw-stack" style={{ gap: 12 }}><h2 className="nw-h3">Who it's for</h2><Bullets items={x.audience} /></div>}
          {x.modules.length > 0 && (
            <div className="nw-stack" style={{ gap: 16 }}>
              <h2 className="nw-h3">What it covers</h2>
              <ol className="nw-modules">
                {x.modules.map((m, i) => (
                  <li key={i}>
                    <span className="nw-point-n" style={{ fontSize: 28 }}>{String(i + 1).padStart(2, '0')}</span>
                    <div className="nw-stack" style={{ gap: 6 }}><strong style={{ fontSize: 19 }}>{m.title}</strong>{m.topics.length > 0 && <Bullets items={m.topics} />}</div>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {x.methods.length > 0 && <div className="nw-stack" style={{ gap: 12 }}><h2 className="nw-h3">How it's taught</h2><Bullets items={x.methods} /></div>}
        </div>
      </section>
      <section id="dates" className={bandClass('light')}>
        <div className="nw-wrap nw-stack" style={{ gap: 28 }}>
          <h2 className="nw-h2" style={{ fontSize: 'clamp(28px, 3.4vw, 40px)' }}>Upcoming dates</h2>
          <RunList runs={runs} empty="No public dates right now. We also run it in-house for your team. " />
        </div>
      </section>
      {people.length > 0 && (
        <section className={bandClass('white')}>
          <div className="nw-wrap nw-stack" style={{ gap: 28 }}>
            <h2 className="nw-h2" style={{ fontSize: 'clamp(28px, 3.4vw, 40px)' }}>Trainers</h2>
            <div className="nw-people">{people.map(t => <TrainerCard key={t.id} t={t} />)}</div>
          </div>
        </section>
      )}
      <ContactSection eyebrow="Talk to us" heading={runs.length ? 'Questions about this programme?' : 'Bring this programme to your team.'} text="Tell us about your team. We reply within one working day." background="light" programme={x.name} />
    </>
  );
}

export function TrainerPage({ slug }: { slug: string }) {
  const { data, settings } = useSite();
  const t = data?.trainers.find(x => x.slug === slug);
  if (!t) return null;
  const teaches = (data?.programmes || []).filter(p => t.programmeSlugs.includes(p.slug));
  return (
    <>
      <section className={bandClass('dark', 'l')}>
        <div className="nw-wrap nw-split">
          <div style={{ flex: '0 1 340px' }}>
            <div className="nw-frame"><div className="nw-person-photo" style={{ border: 0 }}>{t.photo ? <img src={t.photo} alt={t.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}</div></div>
          </div>
          <div className="nw-stack" style={{ gap: 20 }}>
            <p className="nw-eyebrow"><a href="/trainers" style={{ color: 'inherit', textDecoration: 'none' }}>Our trainers</a></p>
            <h1 className="nw-h1" style={{ fontSize: 'clamp(36px, 5vw, 60px)' }}>{t.name}</h1>
            {t.headline && <p className="nw-lead">{t.headline}</p>}
            {t.years > 0 && <span className="nw-chip" style={{ alignSelf: 'flex-start' }}>{t.years}+ years' experience</span>}
            <div className="nw-btns"><a className="nw-btn nw-btn-teal" href="#contact">Work with {t.name}</a></div>
          </div>
        </div>
      </section>
      <section className={bandClass('white')}>
        <div className="nw-wrap nw-stack" style={{ gap: 44, maxWidth: 980, marginLeft: 'auto', marginRight: 'auto' }}>
          {t.bio && <div className="nw-stack" style={{ gap: 12 }}><h2 className="nw-h3">About</h2><p className="nw-muted" style={{ whiteSpace: 'pre-line' }}>{t.bio}</p></div>}
          {t.qualifications.length > 0 && <div className="nw-stack" style={{ gap: 12 }}><h2 className="nw-h3">Qualifications</h2><Bullets items={t.qualifications} /></div>}
          {t.certifications.length > 0 && <div className="nw-stack" style={{ gap: 12 }}><h2 className="nw-h3">Certifications</h2><Bullets items={t.certifications} /></div>}
          {t.languages && <div className="nw-stack" style={{ gap: 12 }}><h2 className="nw-h3">Languages</h2><p className="nw-muted">{t.languages}</p></div>}
          {teaches.length > 0 && <div className="nw-stack" style={{ gap: 12 }}><h2 className="nw-h3">Programmes</h2><ProgrammeLinks list={teaches} /></div>}
        </div>
      </section>
      <ContactSection eyebrow="Talk to us" heading={`Plan a training with ${t.name}.`} text="Tell us about your team. We reply within one working day." background="light" message={`I'd like to arrange a training with ${t.name}.`} />
    </>
  );
}

/** The site's own lists, used when no edited page has these addresses. */
export const AUTO_PAGES: Record<string, { title: string; description: string; content: any[] }> = {
  'training-calendar': {
    title: 'Training calendar',
    description: 'Upcoming public training programmes by Next Academy: dates, venues, prices and seats left. Most are HRD Corp claimable.',
    content: [{ type: 'Calendar', props: { id: 'auto-cal', eyebrow: 'Training calendar', heading: 'Upcoming public programmes', text: 'Open to everyone. Most are HRD Corp claimable.', background: 'white', only: 'all', count: 0 } }],
  },
  programmes: {
    title: 'Programmes',
    description: 'Training programmes by Next Academy: soft skills, technical skills and team building, in-house or public.',
    content: [{ type: 'Programmes', props: { id: 'auto-prog', eyebrow: 'Programmes', heading: 'Training that moves people.', text: 'In-house for your team or public for individuals.', background: 'white', only: 'all' } }],
  },
  trainers: {
    title: 'Our trainers',
    description: "Meet Next Academy's trainers.",
    content: [{ type: 'Trainers', props: { id: 'auto-tr', eyebrow: 'Our trainers', heading: 'Become the person', highlight: 'they look up to.', background: 'white', count: 0 } }],
  },
};

// ---------- Forms (Batch 3): "Talk to us" and Register on a date. Plain web forms sent to the CRM's server
// (serverWebsiteForms.ts), which gives each one to the next rep in turn. ----------

function FormGuts({ kind, runId, programme, message, full }: { kind: 'enquiry' | 'register'; runId?: string; programme?: string; message?: string; full?: boolean }) {
  const { form, data, editing } = useSite();
  const programmes = data?.programmes || [];
  const preset = programme || form?.programme || '';
  const fieldId = (n: string) => `nw-${kind}-${n}`;
  return (
    <form className="nw-form" method="post" action="/api/site/enquiry">
      <fieldset disabled={editing} style={{ border: 0, margin: 0, padding: 0, display: 'contents' }}>
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="stamp" value={form?.stamp || ''} />
        <input type="hidden" name="base" value={form?.base || ''} />
        <input type="hidden" name="page" value={form?.page || ''} />
        {runId && <input type="hidden" name="runId" value={runId} />}
        {/* People never see or fill this box; robots do. */}
        <div aria-hidden="true" className="nw-trap"><label>Leave this empty<input type="text" name="website" tabIndex={-1} autoComplete="off" /></label></div>
        <label className="nw-field" htmlFor={fieldId('name')}>Your name<input id={fieldId('name')} name="name" required maxLength={80} autoComplete="name" /></label>
        <label className="nw-field" htmlFor={fieldId('company')}>Company<input id={fieldId('company')} name="company" required maxLength={120} autoComplete="organization" /></label>
        <label className="nw-field" htmlFor={fieldId('mobile')}>Mobile<input id={fieldId('mobile')} name="mobile" type="tel" required maxLength={30} autoComplete="tel" placeholder="e.g. 012 345 6789" /></label>
        <label className="nw-field" htmlFor={fieldId('email')}>Email <span className="nw-muted" style={{ fontWeight: 400 }}>(optional)</span><input id={fieldId('email')} name="email" type="email" maxLength={120} autoComplete="email" /></label>
        {kind === 'register' ? (
          <>
            <label className="nw-field" htmlFor={fieldId('pax')}>How many people<input id={fieldId('pax')} name="pax" type="number" min={1} max={200} required defaultValue={1} /></label>
            <fieldset className="nw-field nw-radios">
              <legend>HRD Corp claimable?</legend>
              <label><input type="radio" name="hrdc" value="yes" defaultChecked /> Yes</label>
              <label><input type="radio" name="hrdc" value="no" /> No, we pay directly</label>
              <label><input type="radio" name="hrdc" value="not_sure" /> Not sure</label>
            </fieldset>
          </>
        ) : (
          <label className="nw-field nw-wide" htmlFor={fieldId('programme')}>Programme you're interested in
            <select id={fieldId('programme')} name="programme" defaultValue={programmes.some(p => p.name === preset) ? preset : ''}>
              <option value="">Not sure yet / something else</option>
              {programmes.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
            </select>
          </label>
        )}
        <label className="nw-field nw-wide" htmlFor={fieldId('message')}>{kind === 'register' ? 'Anything we should know' : 'Tell us about your team'} <span className="nw-muted" style={{ fontWeight: 400 }}>(optional)</span>
          <textarea id={fieldId('message')} name="message" rows={4} maxLength={2000} defaultValue={message || ''} />
        </label>
        <label className="nw-consent nw-wide"><input type="checkbox" name="consent" value="yes" required /> <span>{CONSENT_TEXT}</span></label>
        <button type="submit" className="nw-btn nw-btn-dark nw-wide" style={{ justifyContent: 'center' }}>{kind === 'register' ? (full ? 'Join the waiting list' : 'Register') : 'Send message'}</button>
      </fieldset>
    </form>
  );
}

function ContactSection({ eyebrow, heading, text, background, programme, message, edge }: { eyebrow?: any; heading?: any; text?: any; background?: Bg; programme?: string; message?: string; edge?: string }) {
  const { settings } = useSite();
  const wa = (settings.whatsapp || '').replace(/[^0-9]/g, '');
  return (
    <section id="contact" className={bandClass(background || 'light', 'm', true, edge)}>
      <div className="nw-wrap nw-split" style={{ alignItems: 'flex-start' }}>
        <div className="nw-stack">
          <Heading eyebrow={eyebrow} heading={heading} text={text} />
          <div className="nw-contact" style={{ marginTop: 8 }}>
            <span><strong>Phone</strong> <a href={`tel:+6${COMPANY.phone.replace(/[^0-9]/g, '')}`}>{COMPANY.phone}</a></span>
            <span><strong>Email</strong> <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a></span>
            <span><strong>Address</strong> {COMPANY_ADDRESS}</span>
            {wa && <span><strong>WhatsApp</strong> <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener">Message us</a></span>}
          </div>
        </div>
        <div className="nw-card-box"><FormGuts kind="enquiry" programme={programme} message={message} /></div>
      </div>
    </section>
  );
}

const Contact = (p: any) => <ContactSection eyebrow={p.eyebrow} heading={p.heading} text={p.text} background={p.background} edge={p.edge} />;

/** /register/<run>: the date's details and the Register form (seats are held once a rep confirms). */
export function RegisterPage({ runId }: { runId: string }) {
  const { data } = useSite();
  const r = data?.runs.find(x => x.id === runId);
  if (!r) return null;
  const full = r.seatsLeft !== null && r.seatsLeft <= 0;
  const facts = [runDates(r), [r.venue, r.area].filter(Boolean).join(', '), daysText(r.days)].filter(Boolean);
  return (
    <section className={bandClass('light', 'l')}>
      <div className="nw-wrap nw-split" style={{ alignItems: 'flex-start' }}>
        <div className="nw-stack" style={{ gap: 18 }}>
          <p className="nw-eyebrow">{full ? 'Waiting list' : 'Register'}</p>
          <h1 className="nw-h1" style={{ fontSize: 'clamp(32px, 4.4vw, 52px)' }}>{r.title}</h1>
          <p className="nw-lead">{facts.join(' · ')}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {r.price > 0 && <span className="nw-chip">{formatRM(r.price)} per pax</span>}
            {r.hrdc && <span className="nw-chip">HRD Corp claimable</span>}
            {seatsText(r) && <span className={`nw-chip${full ? ' nw-chip-full' : ''}`}>{seatsText(r)}</span>}
          </div>
          <p className="nw-muted">{full ? "This date is full. Leave your details and we'll tell you when a seat opens or the next date is set." : "We'll call you to confirm your seats within one working day. Seats are held once confirmed."}</p>
          {r.titleSlug && <a className="nw-link" href={`/programmes/${r.titleSlug}`}>About this programme →</a>}
        </div>
        <div className="nw-card-box"><FormGuts kind="register" runId={r.id} full={full} /></div>
      </div>
    </section>
  );
}

/** After a form: thank you, or what to fix. */
export function FormMessage({ kind, text }: { kind: 'message' | 'problem'; text: string }) {
  const back = useSite().form?.back || '/';
  return (
    <section className={bandClass('white', 'l')}>
      <div className="nw-wrap nw-narrow nw-stack" style={{ gap: 20 }}>
        {kind === 'message' ? (
          <>
            <p className="nw-eyebrow">{text === 'register' ? 'Registration received' : 'Message received'}</p>
            <h1 className="nw-h2">Thank you. <span className="nw-mark">We'll be in touch.</span></h1>
            <p className="nw-lead">{text === 'register' ? 'We will call you within one working day to confirm your seats.' : 'One of our training experts will reply within one working day.'}</p>
          </>
        ) : (
          <>
            <p className="nw-eyebrow">Please check the form</p>
            <h1 className="nw-h2">{text}</h1>
            <p className="nw-lead">Go back, fix it and send it again.</p>
          </>
        )}
        <div className="nw-btns"><a className="nw-btn nw-btn-blue" href={kind === 'message' ? '/' : back}>{kind === 'message' ? 'Back to the homepage' : 'Go back to the form'}</a></div>
      </div>
    </section>
  );
}

// ---------- Blocks (inside a Section or Columns, or on their own) ----------

const HeadingBlock = (p: any) => (
  <div className={`nw-stack${p.align === 'center' ? ' nw-center' : ''}`} style={{ gap: 14 }}>
    <Heading eyebrow={p.eyebrow} heading={p.heading} highlight={p.highlight} level={p.size === 'big' ? 1 : p.size === 'small' ? 3 : 2} />
  </div>
);

const TextBlock = ({ body }: any) =>
  typeof body === 'string'
    ? <div className="nw-rich" dangerouslySetInnerHTML={{ __html: cleanRichText(body) }} />
    : <div className="nw-rich">{body}</div>;

const ImageBlock = (p: any) => (
  <figure style={{ margin: 0 }}>
    <PhotoWithStyle id={p.image} look={p.look} height={p.height === 'short' ? 240 : p.height === 'tall' ? 520 : 380} />
    {has(p.caption) && <figcaption className="nw-caption">{p.caption}</figcaption>}
  </figure>
);

const VideoBlock = (p: any) => {
  const { media, editing } = useSite();
  if (!editing && !media[p.video || '']) return null;
  return (
    <figure style={{ margin: 0 }}>
      <MediaVideo id={p.video} />
      {has(p.caption) && <figcaption className="nw-caption">{p.caption}</figcaption>}
    </figure>
  );
};

/** The Google rating and companies trained, typed once in Website → Settings; each hidden while empty. */
function proofItems(s: SiteSettings): { big: string; small: string }[] {
  const out: { big: string; small: string }[] = [];
  if (has(s.companiesTrained)) out.push({ big: String(s.companiesTrained), small: 'companies trained' });
  if (has(s.googleRating)) out.push({ big: `★ ${s.googleRating}`, small: has(s.googleReviews) ? `from ${s.googleReviews} Google reviews` : 'on Google' });
  return out;
}

const ProofBlock = (p: any) => {
  const { settings, editing } = useSite();
  const items = [...proofItems(settings), ...(p.items || []).filter((it: any) => has(it.big))];
  if (!items.length) return editing ? <div className="nw-placeholder">Numbers appear here once they're filled in Website → Settings</div> : null;
  return (
    <div className="nw-proof">
      {items.map((it, i) => <div key={i}><strong>{it.big}</strong><span>{it.small}</span></div>)}
    </div>
  );
};

const ButtonBlock = (p: any) => (
  <div className="nw-btns" style={{ justifyContent: p.align === 'center' ? 'center' : 'flex-start' }}>
    <a className={`nw-btn nw-btn-${p.look || 'blue'}`} href={safeHref(p.link)}>{p.label}</a>
  </div>
);

const SpacerBlock = ({ size }: any) => <div aria-hidden="true" style={{ height: size === 'small' ? 16 : size === 'big' ? 80 : 40 }} />;

/** The handle on the line between two columns: drag it to change their widths (editor only). */
function ColumnHandle({ id, split }: { id: string; split: number }) {
  const { onResizeColumns } = useSite();
  const ref = useRef<HTMLDivElement>(null);
  const [live, setLive] = React.useState<number | null>(null);
  const shown = live ?? split;
  const start = (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    const box = ref.current?.parentElement?.getBoundingClientRect();
    if (!box) return;
    // The editor's preview is its own page (an iframe): follow the mouse anywhere on it.
    const win = (e.currentTarget as HTMLElement).ownerDocument.defaultView || window;
    let last = split;
    const move = (ev: PointerEvent) => {
      last = Math.max(20, Math.min(80, Math.round(((ev.clientX - box.left) / box.width) * 100 / 5) * 5));
      setLive(last);
    };
    const end = () => {
      win.removeEventListener('pointermove', move, true);
      win.removeEventListener('pointerup', end, true);
      win.removeEventListener('pointercancel', end, true);
      setLive(null);
      if (last !== split) onResizeColumns?.(id, last);
    };
    win.addEventListener('pointermove', move, true);
    win.addEventListener('pointerup', end, true);
    win.addEventListener('pointercancel', end, true);
  };
  return (
    <div ref={ref} onPointerDown={start} role="separator" aria-label={`Column widths ${shown}% and ${100 - shown}%. Drag to change.`} title="Drag to change the column widths"
      style={{ position: 'absolute', top: 0, bottom: 0, left: `calc(${shown}% - 7px)`, width: 14, cursor: 'col-resize', zIndex: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'none' }}>
      <div style={{ position: 'absolute', top: 0, bottom: 0, width: 2, background: '#1F7AE0' }} />
      <div style={{ position: 'relative', width: 14, height: 36, borderRadius: 7, background: '#fff', border: '2px solid #1F7AE0' }} />
      <span style={{ position: 'absolute', top: -26, whiteSpace: 'nowrap', background: '#1C2421', color: '#fff', fontSize: 12, fontWeight: 600, padding: '3px 8px', borderRadius: 6, fontFamily: 'system-ui, sans-serif' }}>{shown}% | {100 - shown}%</span>
    </div>
  );
}

const Columns = ({ id, count, split, col1: C1, col2: C2, col3: C3, puck }: any) => {
  const three = count === '3';
  const s = Math.max(20, Math.min(80, Number(split) || 50));
  return (
    <div className="nw-cols" style={{ position: 'relative', gridTemplateColumns: three ? 'repeat(3, minmax(0, 1fr))' : `minmax(0, ${s}fr) minmax(0, ${100 - s}fr)` }}>
      <C1 className="nw-col" />
      <C2 className="nw-col" />
      {three && <C3 className="nw-col" />}
      {puck?.isEditing && !three && <ColumnHandle id={id} split={s} />}
    </div>
  );
};

// ---------- Header, footer and the page around the blocks ----------

function SiteHeader() {
  const { menu, editing } = useSite();
  return (
    <header className="nw-head" style={editing ? { position: 'relative', pointerEvents: 'none' } : undefined}>
      <div className="nw-wrap nw-head-in">
        <a className="nw-logo" href="/" aria-label="Next Academy home"><img src="/site-assets/logo-dark.png" alt="Next Academy" width={97} height={46} /></a>
        <input type="checkbox" id="nw-menu" className="nw-menu-toggle" />
        <label htmlFor="nw-menu" className="nw-menu-btn">Menu</label>
        <nav className="nw-nav" aria-label="Main">
          {menu.map((l, i) => <a key={i} href={safeHref(l.href)} className={l.button ? 'nw-btn nw-btn-blue' : undefined}>{l.label}</a>)}
        </nav>
      </div>
    </header>
  );
}

function SiteFooter() {
  const { menu, settings, editing } = useSite();
  const socials = ([['Facebook', settings.facebook], ['Instagram', settings.instagram], ['LinkedIn', settings.linkedin], ['WhatsApp', settings.whatsapp ? `https://wa.me/${settings.whatsapp.replace(/[^0-9]/g, '')}` : '']] as const).filter(([, v]) => !!v);
  return (
    <footer className="nw-foot" style={editing ? { pointerEvents: 'none' } : undefined}>
      <div className="nw-wrap nw-foot-in">
        <div className="nw-foot-top">
          <div className="nw-stack" style={{ gap: 16, maxWidth: 360 }}>
            <img src="/site-assets/logo-dark.png" alt="Next Academy" width={110} height={52} style={{ height: 52, width: 'auto', alignSelf: 'flex-start' }} />
            {has(settings.tagline) && <p style={{ fontSize: 15 }}>{settings.tagline}</p>}
            <p style={{ fontSize: 15 }}>{COMPANY_ADDRESS}<br />{COMPANY.phone} · {COMPANY.email}</p>
          </div>
          <nav className="nw-foot-links" aria-label="Footer">
            <div>{menu.filter(l => !l.button).map((l, i) => <a key={i} href={safeHref(l.href)}>{l.label}</a>)}</div>
            {socials.length > 0 && <div>{socials.map(([label, href]) => <a key={label} href={safeHref(href)} target="_blank" rel="noopener">{label}</a>)}</div>}
          </nav>
        </div>
        <div className="nw-foot-bottom">
          <span>© {new Date().getFullYear()} {COMPANY.name.replace('NEXT ACADEMY SDN BHD', 'Next Academy Sdn. Bhd.')} {COMPANY.regNo}. All rights reserved.</span>
          <a href="/privacynotice">Privacy notice</a>
        </div>
      </div>
    </footer>
  );
}

const PageFrame = ({ children }: { children: React.ReactNode }) => {
  const { inlineCss } = useSite();
  return (
    <div className="nw">
      {inlineCss && <style>{inlineCss}</style>}
      <SiteHeader />
      <main>{children}</main>
      <SiteFooter />
    </div>
  );
};

// ---------- The editor's settings for each block ----------

const BG_OPTIONS = [
  { label: 'White', value: 'white' }, { label: 'Light (grid)', value: 'light' }, { label: 'Dark (grid)', value: 'dark' },
  { label: 'Black', value: 'black' }, { label: 'Next Blue', value: 'blue' }, { label: 'Teal', value: 'teal' },
];
const bg = (label = 'Background'): Field => ({ type: 'select', label, options: BG_OPTIONS });
const text = (label: string, editOnPage = true): Field => ({ type: 'text', label, contentEditable: editOnPage } as Field);
const area = (label: string): Field => ({ type: 'textarea', label, contentEditable: true } as Field);
const edge: Field = { type: 'radio', label: 'Top edge', options: [{ label: 'Straight', value: 'straight' }, { label: 'Torn paper', value: 'torn' }] };
const link = (label: string): Field => ({ type: 'text', label: `${label} (a page like /training-calendar, #contact, or a web address)` });

export type MediaFieldMaker = (label: string, kind: 'image' | 'video') => Field;

const ONLY_FIELD: Field = { type: 'select', label: 'Show', options: [{ label: 'All types', value: 'all' }, { label: 'Soft skills', value: 'soft' }, { label: 'Technical skills', value: 'technical' }, { label: 'Team building', value: 'teambuilding' }] };

/** The editor and the public site use the same blocks; the editor adds its photo / video pickers. */
export function makeSiteConfig(mediaField?: MediaFieldMaker): Config {
  const photo: MediaFieldMaker = mediaField || ((label) => ({ type: 'text', label }));
  return {
    categories: {
      sections: { title: 'Ready-made sections', components: ['Hero', 'Section', 'Points', 'Compare', 'VideoRow', 'Calendar', 'Programmes', 'Trainers', 'Tiles', 'ReviewWall', 'Insights', 'Quote', 'LogoStrip', 'ValuesBand', 'Contact'] },
      blocks: { title: 'Blocks', components: ['HeadingBlock', 'TextBlock', 'ImageBlock', 'VideoBlock', 'ProofBlock', 'ButtonBlock', 'Columns', 'SpacerBlock'] },
    },
    root: {
      fields: {
        pageTitle: { type: 'text', label: 'Title in Google and the browser tab' },
        description: { type: 'textarea', label: 'Short description for Google (about 150 letters)' },
      },
      render: ({ children }: any) => <PageFrame>{children}</PageFrame>,
    },
    components: {
      Hero: {
        label: 'Hero banner',
        fields: {
          eyebrow: text('Small line above'), headline: area('Headline'), highlight: text('Highlighted words (teal)'), headlineEnd: text('Words after the highlight'),
          text: area('Text'), button1Label: text('Main button'), button1Link: link('Main button goes to'), button2Label: text('Second button'), button2Link: link('Second button goes to'),
          image: photo('Photo', 'image'),
          imageStyle: { type: 'radio', label: 'Photo look', options: LOOK_OPTIONS },
          reviewName: text('Review card on the photo: name (empty = no card)', false), reviewRole: text('Review card: who they are', false),
          reviewText: { type: 'textarea', label: 'Review card: what they said' }, reviewSource: text('Review card: where it is from (e.g. Google review)', false),
          showRating: { type: 'radio', label: 'Google rating under the buttons (from Website → Settings)', options: [{ label: 'Show', value: 'yes' }, { label: 'Hide', value: 'no' }] },
          background: bg(),
        },
        defaultProps: { eyebrow: 'HRD Corp registered training provider', headline: 'Your headline', highlight: 'highlight.', headlineEnd: '', text: '', button1Label: 'See the training calendar', button1Link: '/training-calendar', button2Label: '', button2Link: '', image: '', imageStyle: 'tinted', reviewName: '', reviewRole: '', reviewText: '', reviewSource: 'Google review', showRating: 'no', background: 'dark' },
        render: Hero,
      },
      Section: {
        label: 'Empty section (drop blocks in)',
        fields: {
          background: bg(),
          spacing: { type: 'radio', label: 'Space above and below', options: [{ label: 'Small', value: 's' }, { label: 'Medium', value: 'm' }, { label: 'Large', value: 'l' }] },
          width: { type: 'radio', label: 'Width', options: [{ label: 'Normal', value: 'normal' }, { label: 'Narrow', value: 'narrow' }] },
          texture: { type: 'radio', label: 'Grid texture', options: [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }] },
          edge,
          content: { type: 'slot', disallow: ['Hero', 'Section', 'Points', 'Compare', 'VideoRow', 'Calendar','Programmes', 'Trainers', 'Tiles', 'ReviewWall', 'Insights', 'Quote', 'LogoStrip', 'ValuesBand', 'Contact'] },
        },
        defaultProps: { background: 'white', spacing: 'm', width: 'normal', texture: 'yes', content: [] },
        render: Section,
      },
      Points: {
        label: 'Points (numbered or mint squares)',
        fields: {
          eyebrow: text('Small line above'), heading: area('Heading'), highlight: text('Highlighted words (teal)'),
          look: { type: 'radio', label: 'Look', options: [{ label: 'Numbered', value: 'numbers' }, { label: 'Mint squares', value: 'squares' }] },
          items: { type: 'array', label: 'Points', arrayFields: { title: { type: 'text', label: 'Title' }, text: { type: 'textarea', label: 'Text' } }, defaultItemProps: { title: 'Point', text: '' }, getItemSummary: (it: any) => it.title || 'Point' } as Field,
          background: bg(), edge,
        },
        defaultProps: { eyebrow: '', heading: 'Why Next Academy', highlight: '', look: 'squares', items: [{ title: 'Point one', text: '' }, { title: 'Point two', text: '' }, { title: 'Point three', text: '' }], background: 'dark', edge: 'straight' },
        render: Points,
      },
      Compare: {
        label: 'Without / With (two lists)',
        fields: {
          eyebrow: text('Small line above'), heading: area('Heading'), highlight: text('Highlighted words (teal)'), text: area('Text'),
          withoutTitle: text('Left title'), withTitle: text('Right title'),
          rows: { type: 'array', label: 'Lines', arrayFields: { without: { type: 'text', label: 'Without (left)' }, with: { type: 'text', label: 'With (right)' } }, defaultItemProps: { without: '', with: '' }, getItemSummary: (it: any) => it.with || it.without || 'Line' } as Field,
          buttonLabel: text('Button words (empty = no button)', false), buttonLink: link('Button goes to'),
          background: bg(), edge,
        },
        defaultProps: { eyebrow: '', heading: 'Where will your team be', highlight: 'in six months?', text: '', withoutTitle: 'Without a plan', withTitle: 'With Next Academy', rows: [{ without: '', with: '' }], buttonLabel: '', buttonLink: '#contact', background: 'white', edge: 'straight' },
        render: Compare,
      },
      VideoRow: {
        label: 'Client videos (up to 3)',
        fields: {
          eyebrow: text('Small line above'), heading: area('Heading'), highlight: text('Highlighted words (teal)'), text: area('Text'),
          videos: { type: 'array', label: 'Videos (empty ones are hidden on the website)', max: 3, arrayFields: { video: photo('Video (clip or YouTube)', 'video'), caption: { type: 'text', label: 'Who is speaking' } }, defaultItemProps: { video: '', caption: '' }, getItemSummary: (it: any, i?: number) => it.caption || `Video ${(i ?? 0) + 1}` } as Field,
          buttonLabel: text('Button words (empty = no button)', false), buttonLink: link('Button goes to'),
          background: bg(), edge,
        },
        defaultProps: { eyebrow: 'Client stories', heading: 'Hear it from', highlight: 'them.', text: '', videos: [{ video: '', caption: '' }], buttonLabel: '', buttonLink: '#contact', background: 'white', edge: 'straight' },
        render: VideoRow,
      },
      Calendar: {
        label: 'Training calendar',
        fields: {
          eyebrow: text('Small line above'), heading: area('Heading'), text: area('Text'),
          only: ONLY_FIELD,
          count: { type: 'number', label: 'How many dates (0 = all; more go to the Training calendar page)', min: 0, max: 60 },
          background: bg(), edge,
        },
        defaultProps: { eyebrow: 'Training calendar', heading: 'Upcoming public programmes', text: '', only: 'all', count: 6, background: 'white' },
        render: Calendar,
      },
      Programmes: {
        label: 'Programmes',
        fields: { eyebrow: text('Small line above'), heading: area('Heading'), text: area('Text'), only: ONLY_FIELD, background: bg(), edge },
        defaultProps: { eyebrow: 'Programmes', heading: 'Training that moves people.', text: '', only: 'all', background: 'white' },
        render: Programmes,
      },
      Trainers: {
        label: 'Trainers',
        fields: {
          eyebrow: text('Small line above'), heading: area('Heading'), highlight: text('Highlighted words (teal)'),
          count: { type: 'number', label: 'How many trainers (0 = all)', min: 0, max: 40 },
          background: bg(), edge,
        },
        defaultProps: { eyebrow: 'Our trainers', heading: 'Meet our trainers', highlight: '', count: 4, background: 'white' },
        render: Trainers,
      },
      Tiles: {
        label: 'Photo tiles (programme tracks)',
        fields: {
          eyebrow: text('Small line above'), heading: area('Heading'), highlight: text('Highlighted words (teal)'),
          items: { type: 'array', label: 'Tiles', arrayFields: {
            image: photo('Photo', 'image'), eyebrow: { type: 'text', label: 'Small line above' }, title: { type: 'text', label: 'Title' },
            tags: { type: 'text', label: 'Tags (separate with commas)' }, linkLabel: { type: 'text', label: 'Link words' }, link: { type: 'text', label: 'Goes to (a page like /training-courses, or a web address)' },
          }, defaultItemProps: { image: '', eyebrow: '', title: 'Title', tags: '', linkLabel: 'See more', link: '' }, getItemSummary: (it: any) => it.title || 'Tile' } as Field,
          background: bg(), edge,
        },
        defaultProps: { eyebrow: 'Programmes', heading: 'Two tracks. One goal:', highlight: 'people who perform.', items: [], background: 'light', edge: 'straight' },
        render: Tiles,
      },
      ReviewWall: {
        label: 'Reviews on photos',
        fields: {
          eyebrow: text('Small line above'), heading: area('Heading'), highlight: text('Highlighted words (teal)'),
          photos: { type: 'array', label: 'Photos (up to 4, shown black and white)', arrayFields: { image: photo('Photo', 'image') }, defaultItemProps: { image: '' }, getItemSummary: (_: any, i?: number) => `Photo ${(i ?? 0) + 1}` } as Field,
          reviews: { type: 'array', label: 'Review cards (up to 3)', arrayFields: {
            name: { type: 'text', label: 'Name' }, role: { type: 'text', label: 'Who they are' }, text: { type: 'textarea', label: 'What they said' }, source: { type: 'text', label: 'Where it is from (e.g. Google review)' },
          }, defaultItemProps: { name: '', role: 'Participant', text: '', source: 'Google review' }, getItemSummary: (it: any) => it.name || 'Review' } as Field,
          background: bg(), edge,
        },
        defaultProps: { eyebrow: 'What participants say', heading: 'Real rooms.', highlight: 'Real reviews.', photos: [], reviews: [], background: 'light', edge: 'straight' },
        render: ReviewWall,
      },
      Insights: {
        label: 'HR insights (post cards)',
        fields: {
          eyebrow: text('Small line above'), heading: area('Heading'), highlight: text('Highlighted words (teal)'), text: area('Text'),
          moreLabel: text('Button words (empty = no button)', false), moreLink: link('Button goes to'),
          items: { type: 'array', label: 'Posts', arrayFields: {
            title: { type: 'textarea', label: 'Headline' }, highlight: { type: 'text', label: 'Words to highlight in mint (separate with |)' },
            topic: { type: 'text', label: 'Topic' }, note: { type: 'text', label: 'Small note (e.g. 2 min read)' },
            image: photo('Photo at the bottom (optional)', 'image'), link: { type: 'text', label: 'Opens (the Facebook post, or a page)' },
          }, defaultItemProps: { title: 'Headline', highlight: '', topic: '', note: '', image: '', link: '' }, getItemSummary: (it: any) => it.title || 'Post' } as Field,
          background: bg(), edge,
        },
        defaultProps: { eyebrow: 'HR insights', heading: 'Spot the', highlight: 'signs early.', text: '', moreLabel: '', moreLink: '', items: [], background: 'black', edge: 'straight' },
        render: Insights,
      },
      Quote: {
        label: 'Client quote and video',
        fields: { quote: area('Quote'), name: text('Who said it'), media: photo('Video or photo', 'video'), background: bg(), edge },
        defaultProps: { quote: 'A line or two from a happy client.', name: '', media: '', background: 'dark' },
        render: Quote,
      },
      LogoStrip: {
        label: 'Client logos',
        fields: {
          label: text('Label'),
          items: { type: 'array', label: 'Clients', arrayFields: { name: { type: 'text', label: 'Client name' }, image: photo('Logo (optional)', 'image') }, defaultItemProps: { name: 'Client', image: '' }, getItemSummary: (it: any) => it.name || 'Client' } as Field,
        },
        defaultProps: { label: 'Trusted by teams at', items: [] },
        render: LogoStrip,
      },
      ValuesBand: {
        label: 'Values band',
        fields: {
          label: text('Label'),
          items: { type: 'array', label: 'Words', arrayFields: { word: { type: 'text', label: 'Word' } }, defaultItemProps: { word: 'Value' }, getItemSummary: (it: any) => it.word || 'Value' } as Field,
          background: bg(), edge,
        },
        defaultProps: { label: 'Our values', items: [{ word: 'Humility' }], background: 'blue' },
        render: ValuesBand,
      },
      Contact: {
        label: 'Contact us',
        fields: { eyebrow: text('Small line above'), heading: area('Heading'), text: area('Text'), background: bg(), edge },
        defaultProps: { eyebrow: 'Talk to us', heading: 'Schedule a session with our training experts.', text: '', background: 'light' },
        render: Contact,
      },
      HeadingBlock: {
        label: 'Heading',
        fields: {
          eyebrow: text('Small line above'), heading: area('Heading'), highlight: text('Highlighted words (teal)'),
          size: { type: 'radio', label: 'Size', options: [{ label: 'Big', value: 'big' }, { label: 'Medium', value: 'medium' }, { label: 'Small', value: 'small' }] },
          align: { type: 'radio', label: 'Line up', options: [{ label: 'Left', value: 'left' }, { label: 'Centre', value: 'center' }] },
        },
        defaultProps: { eyebrow: '', heading: 'Heading', highlight: '', size: 'medium', align: 'left' },
        render: HeadingBlock,
      },
      TextBlock: {
        label: 'Text',
        fields: { body: { type: 'richtext', label: 'Text', contentEditable: true } as Field },
        defaultProps: { body: '<p>Write here.</p>' },
        render: TextBlock,
      },
      ImageBlock: {
        label: 'Photo',
        fields: {
          image: photo('Photo', 'image'), caption: text('Caption'),
          look: { type: 'radio', label: 'Look', options: LOOK_OPTIONS },
          height: { type: 'radio', label: 'Height', options: [{ label: 'Short', value: 'short' }, { label: 'Medium', value: 'medium' }, { label: 'Tall', value: 'tall' }] },
        },
        defaultProps: { image: '', caption: '', look: 'plain', height: 'medium' },
        render: ImageBlock,
      },
      VideoBlock: {
        label: 'Video',
        fields: { video: photo('Video (clip or YouTube)', 'video'), caption: text('Caption') },
        defaultProps: { video: '', caption: '' },
        render: VideoBlock,
      },
      ProofBlock: {
        label: 'Numbers (rating, companies trained)',
        fields: {
          items: { type: 'array', label: 'More numbers (the Google rating and companies trained come from Website → Settings)', arrayFields: { big: { type: 'text', label: 'Number' }, small: { type: 'text', label: 'Words under it' } }, defaultItemProps: { big: '', small: '' }, getItemSummary: (it: any) => it.big || 'Number' } as Field,
        },
        defaultProps: { items: [] },
        render: ProofBlock,
      },
      ButtonBlock: {
        label: 'Button',
        fields: {
          label: text('Button words'), link: link('Goes to'),
          look: { type: 'radio', label: 'Colour', options: [{ label: 'Blue', value: 'blue' }, { label: 'Teal', value: 'teal' }, { label: 'Black', value: 'dark' }, { label: 'Outline', value: 'outline' }] },
          align: { type: 'radio', label: 'Line up', options: [{ label: 'Left', value: 'left' }, { label: 'Centre', value: 'center' }] },
        },
        defaultProps: { label: 'Talk to us', link: '#contact', look: 'blue', align: 'left' },
        render: ButtonBlock,
      },
      Columns: {
        label: 'Columns',
        fields: {
          count: { type: 'radio', label: 'Columns', options: [{ label: 'Two', value: '2' }, { label: 'Three', value: '3' }] },
          split: { type: 'number', label: 'Left column width % (or drag the line on the page)', min: 20, max: 80, step: 5 },
          col1: { type: 'slot' }, col2: { type: 'slot' }, col3: { type: 'slot' },
        },
        defaultProps: { count: '2', split: 50, col1: [], col2: [], col3: [] },
        render: Columns,
      },
      SpacerBlock: {
        label: 'Space',
        fields: { size: { type: 'radio', label: 'Size', options: [{ label: 'Small', value: 'small' }, { label: 'Medium', value: 'medium' }, { label: 'Big', value: 'big' }] } },
        defaultProps: { size: 'medium' },
        render: SpacerBlock,
      },
    },
  } as Config;
}

// ---------- Drawing a saved page without the editor (the public site) ----------

const SLOT_KEYS: Record<string, string[]> = { Section: ['content'], Columns: ['col1', 'col2', 'col3'] };

function renderItems(config: Config, items: any[] | undefined): React.ReactNode {
  return (items || []).map((item, i) => {
    const comp = (config.components as any)[item?.type];
    if (!comp) return null;
    const props: Record<string, any> = { ...(item.props || {}) };
    for (const key of SLOT_KEYS[item.type] || []) {
      const children = props[key];
      props[key] = ({ className, style }: { className?: string; style?: React.CSSProperties }) =>
        <div className={className} style={style}>{renderItems(config, children)}</div>;
    }
    props.puck = { isEditing: false, metadata: {}, dragRef: null, renderDropZone: () => null };
    return React.createElement(comp.render, { key: props.id || i, ...props });
  });
}

/** A published page (or a programme / trainer page made from the CRM), ready for renderToString on the server. */
export function SitePageView({ data, ctx, special }: { data: PageData; ctx: SiteCtx; special?: SiteSpecial }) {
  const config = makeSiteConfig();
  const Root = (config.root as any).render;
  return (
    <SiteProvider value={ctx}>
      <Root>
        {special?.kind === 'programme' && <ProgrammePage slug={special.slug} />}
        {special?.kind === 'trainer' && <TrainerPage slug={special.slug} />}
        {special?.kind === 'register' && <RegisterPage runId={special.slug} />}
        {(special?.kind === 'message' || special?.kind === 'problem') && <FormMessage kind={special.kind} text={special.slug} />}
        {renderItems(config, data.content)}
      </Root>
    </SiteProvider>
  );
}
