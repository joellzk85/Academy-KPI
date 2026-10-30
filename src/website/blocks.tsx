// The website's building blocks (Joel, 2026-10-30; docs/features/website.md). The same blocks draw the page in the
// CRM's drag-and-drop editor (components/WebsiteEditor.tsx) and on the public site (serverWebsite.ts), so what you
// see while editing is what visitors get. Only the brand's colours and font can be picked (lib/website.ts SITE_CSS).
import React, { createContext, useContext, useRef } from 'react';
import type { Config, Field } from '@puckeditor/core';
import { COMPANY, COMPANY_ADDRESS } from '../lib/company';
import { PageData, SiteMedia, SiteSettings, cleanRichText, safeHref } from '../lib/website';

export type SiteLink = { label: string; href: string; button?: boolean };

export type SiteCtx = {
  media: Record<string, SiteMedia>;
  menu: SiteLink[];
  settings: SiteSettings;
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
const bandClass = (bg: Bg | undefined, pad: 's' | 'm' | 'l' = 'm', grid = true) =>
  `nw-band nw-bg-${bg || 'white'} nw-pad-${pad}${grid && (bg === 'dark' || bg === 'light') ? ' nw-grid' : ''}`;

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
  if (!m) return <div className="nw-placeholder">Pick a video or YouTube link</div>;
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
  const img = <MediaImage id={id} className={`nw-photo${look === 'torn' ? ' nw-torn' : ''}`} style={{ height: height || 380 }} fallbackAlt={alt} />;
  return look === 'frame' ? <div className="nw-frame">{img}</div> : img;
};

// ---------- Ready-made sections ----------

const Hero = (p: any) => {
  const { editing } = useSite();
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
      </div>
      {(p.image || editing) && <div><PhotoWithStyle id={p.image} look={p.imageStyle} /></div>}
    </div>
  </section>
  );
};

const Section = ({ background, spacing, width, texture, content: Content }: any) => (
  <section className={bandClass(background, spacing || 'm', texture !== 'no')}>
    <div className={`nw-wrap${width === 'narrow' ? ' nw-narrow' : ''}`}>
      <Content className="nw-stack" />
    </div>
  </section>
);

const Points = (p: any) => (
  <section className={bandClass(p.background)}>
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

const LogoStrip = (p: any) => (
  <section className="nw-band nw-bg-white" style={{ borderBottom: '1px solid #E4E4E1' }}>
    <div className="nw-wrap nw-logos" style={{ paddingTop: 28, paddingBottom: 28 }}>
      {has(p.label) && <strong style={{ color: '#0B0F0E' }}>{p.label}</strong>}
      {(p.items || []).map((it: any, i: number) => it.image ? <MediaImage key={i} id={it.image} fallbackAlt={it.name} /> : <span key={i}>{it.name}</span>)}
    </div>
  </section>
);

const ValuesBand = (p: any) => (
  <section className={bandClass(p.background || 'blue', 's', false)}>
    <div className="nw-wrap nw-values">
      {has(p.label) && <span className="nw-eyebrow" style={{ fontSize: 13 }}>{p.label}</span>}
      {(p.items || []).map((it: any, i: number) => <span key={i}>{it.word}</span>)}
    </div>
  </section>
);

const Quote = (p: any) => {
  const { editing } = useSite();
  return (
  <section className={bandClass(p.background || 'dark', 'l')}>
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

// Training calendar, programmes and trainers come from the CRM in Batch 2. Until then they show samples, marked so.
const SAMPLE_RUNS = [
  { day: '12', mon: 'Nov', title: '[Public programme title]', where: '[Venue] · 2 days', seats: '6 seats left' },
  { day: '19', mon: 'Nov', title: '[Public programme title]', where: '[Venue] · 1 day', seats: '10 seats left' },
  { day: '03', mon: 'Dec', title: '[Public programme title]', where: '[Venue] · 2 days', seats: '4 seats left' },
];
const Calendar = (p: any) => (
  <section id="calendar" className={bandClass(p.background)}>
    <div className="nw-wrap nw-stack" style={{ gap: 36 }}>
      <div className="nw-stack" style={{ gap: 14 }}><Heading eyebrow={p.eyebrow} heading={p.heading} text={p.text} /></div>
      <p><span className="nw-sample">Sample</span> <span className="nw-muted" style={{ fontSize: 14 }}>Real dates and seats come from Deals → Public programmes.</span></p>
      <div className="nw-cards">
        {SAMPLE_RUNS.map((r, i) => (
          <article className="nw-run" key={i}>
            <div className="nw-run-date"><span className="nw-run-day">{r.day}</span><span className="nw-run-mon">{r.mon}</span></div>
            <div className="nw-run-body"><h3 className="nw-run-title">{r.title}</h3><p className="nw-muted" style={{ fontSize: 15 }}>{r.where}</p><span className="nw-chip" style={{ alignSelf: 'flex-start' }}>{r.seats}</span></div>
          </article>
        ))}
      </div>
    </div>
  </section>
);

const Programmes = (p: any) => (
  <section id="programmes" className={bandClass(p.background)}>
    <div className="nw-wrap nw-split" style={{ alignItems: 'flex-start' }}>
      <div className="nw-stack"><Heading eyebrow={p.eyebrow} heading={p.heading} text={p.text} /></div>
      <div className="nw-stack" style={{ gap: 10 }}>
        <p><span className="nw-sample">Sample</span> <span className="nw-muted" style={{ fontSize: 14 }}>Programmes come from your titles marked for the website.</span></p>
        {[1, 2, 3, 4].map(i => <div key={i} style={{ minHeight: 56, borderBottom: '1px solid #E4E4E1', display: 'flex', alignItems: 'center', fontWeight: 700, fontSize: 18 }}>[Programme title]</div>)}
      </div>
    </div>
  </section>
);

const Trainers = (p: any) => (
  <section id="trainers" className={bandClass(p.background)}>
    <div className="nw-wrap nw-stack" style={{ gap: 36 }}>
      <div className="nw-stack" style={{ gap: 14 }}><Heading eyebrow={p.eyebrow} heading={p.heading} highlight={p.highlight} /></div>
      <p><span className="nw-sample">Sample</span> <span className="nw-muted" style={{ fontSize: 14 }}>Photos and roles come from the Trainers list.</span></p>
      <div className="nw-people">
        {[1, 2, 3, 4].map(i => (
          <div className="nw-stack" style={{ gap: 12 }} key={i}>
            <div className="nw-person-photo">[Trainer photo]</div>
            <div><h3 style={{ fontSize: 19 }}>[Trainer name]</h3><p className="nw-muted" style={{ fontSize: 15 }}>[Role]</p></div>
          </div>
        ))}
      </div>
    </div>
  </section>
);

const Contact = (p: any) => {
  const { settings } = useSite();
  const wa = (settings.whatsapp || '').replace(/[^0-9]/g, '');
  return (
    <section id="contact" className={bandClass(p.background || 'light')}>
      <div className="nw-wrap nw-split" style={{ alignItems: 'flex-start' }}>
        <div className="nw-stack"><Heading eyebrow={p.eyebrow} heading={p.heading} text={p.text} /></div>
        <div className="nw-stack" style={{ background: '#fff', border: '1px solid #E4E4E1', padding: 32, gap: 18 }}>
          <div className="nw-contact">
            <span><strong>Phone</strong> <a href={`tel:+6${COMPANY.phone.replace(/[^0-9]/g, '')}`}>{COMPANY.phone}</a></span>
            <span><strong>Email</strong> <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a></span>
            <span><strong>Address</strong> {COMPANY_ADDRESS}</span>
          </div>
          <div className="nw-btns">
            {wa && <a className="nw-btn nw-btn-teal" href={`https://wa.me/${wa}`} target="_blank" rel="noopener">WhatsApp us</a>}
            <a className="nw-btn nw-btn-dark" href={`mailto:${COMPANY.email}`}>Email us</a>
          </div>
        </div>
      </div>
    </section>
  );
};

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

const VideoBlock = (p: any) => (
  <figure style={{ margin: 0 }}>
    <MediaVideo id={p.video} />
    {has(p.caption) && <figcaption className="nw-caption">{p.caption}</figcaption>}
  </figure>
);

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
        <a className="nw-logo" href="/" aria-label="Next Academy home"><img src="/site-assets/logo-light.png" alt="Next Academy" width={97} height={46} /></a>
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
const link = (label: string): Field => ({ type: 'text', label: `${label} (a page like /training-calendar, #contact, or a web address)` });

export type MediaFieldMaker = (label: string, kind: 'image' | 'video') => Field;

/** The editor and the public site use the same blocks; the editor adds its photo / video pickers. */
export function makeSiteConfig(mediaField?: MediaFieldMaker): Config {
  const photo: MediaFieldMaker = mediaField || ((label) => ({ type: 'text', label }));
  return {
    categories: {
      sections: { title: 'Ready-made sections', components: ['Hero', 'Section', 'Points', 'Calendar', 'Programmes', 'Trainers', 'Quote', 'LogoStrip', 'ValuesBand', 'Contact'] },
      blocks: { title: 'Blocks', components: ['HeadingBlock', 'TextBlock', 'ImageBlock', 'VideoBlock', 'ButtonBlock', 'Columns', 'SpacerBlock'] },
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
          imageStyle: { type: 'radio', label: 'Photo look', options: [{ label: 'Frame', value: 'frame' }, { label: 'Torn paper', value: 'torn' }, { label: 'Plain', value: 'plain' }] },
          background: bg(),
        },
        defaultProps: { eyebrow: 'HRD Corp registered training provider', headline: 'Your headline', highlight: 'highlight.', headlineEnd: '', text: '', button1Label: 'See the training calendar', button1Link: '/training-calendar', button2Label: '', button2Link: '', image: '', imageStyle: 'frame', background: 'dark' },
        render: Hero,
      },
      Section: {
        label: 'Empty section (drop blocks in)',
        fields: {
          background: bg(),
          spacing: { type: 'radio', label: 'Space above and below', options: [{ label: 'Small', value: 's' }, { label: 'Medium', value: 'm' }, { label: 'Large', value: 'l' }] },
          width: { type: 'radio', label: 'Width', options: [{ label: 'Normal', value: 'normal' }, { label: 'Narrow', value: 'narrow' }] },
          texture: { type: 'radio', label: 'Grid texture', options: [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }] },
          content: { type: 'slot', disallow: ['Hero', 'Section', 'Points', 'Calendar', 'Programmes', 'Trainers', 'Quote', 'LogoStrip', 'ValuesBand', 'Contact'] },
        },
        defaultProps: { background: 'white', spacing: 'm', width: 'normal', texture: 'yes', content: [] },
        render: Section,
      },
      Points: {
        label: 'Numbered points',
        fields: {
          eyebrow: text('Small line above'), heading: area('Heading'), highlight: text('Highlighted words (teal)'),
          items: { type: 'array', label: 'Points', arrayFields: { title: { type: 'text', label: 'Title' }, text: { type: 'textarea', label: 'Text' } }, defaultItemProps: { title: 'Point', text: '' }, getItemSummary: (it: any) => it.title || 'Point' } as Field,
          background: bg(),
        },
        defaultProps: { eyebrow: '', heading: 'Why Next Academy', highlight: '', items: [{ title: 'Point one', text: '' }, { title: 'Point two', text: '' }, { title: 'Point three', text: '' }], background: 'light' },
        render: Points,
      },
      Calendar: {
        label: 'Training calendar',
        fields: { eyebrow: text('Small line above'), heading: area('Heading'), text: area('Text'), background: bg() },
        defaultProps: { eyebrow: 'Training calendar', heading: 'Upcoming public programmes', text: '', background: 'white' },
        render: Calendar,
      },
      Programmes: {
        label: 'Programmes',
        fields: { eyebrow: text('Small line above'), heading: area('Heading'), text: area('Text'), background: bg() },
        defaultProps: { eyebrow: 'Programmes', heading: 'Training that moves people.', text: '', background: 'white' },
        render: Programmes,
      },
      Trainers: {
        label: 'Trainers',
        fields: { eyebrow: text('Small line above'), heading: area('Heading'), highlight: text('Highlighted words (teal)'), background: bg() },
        defaultProps: { eyebrow: 'Our trainers', heading: 'Meet our trainers', highlight: '', background: 'white' },
        render: Trainers,
      },
      Quote: {
        label: 'Client quote and video',
        fields: { quote: area('Quote'), name: text('Who said it'), media: photo('Video or photo', 'video'), background: bg() },
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
          background: bg(),
        },
        defaultProps: { label: 'Our values', items: [{ word: 'Humility' }], background: 'blue' },
        render: ValuesBand,
      },
      Contact: {
        label: 'Contact us',
        fields: { eyebrow: text('Small line above'), heading: area('Heading'), text: area('Text'), background: bg() },
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
          look: { type: 'radio', label: 'Look', options: [{ label: 'Plain', value: 'plain' }, { label: 'Frame', value: 'frame' }, { label: 'Torn paper', value: 'torn' }] },
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

/** A published page, ready for renderToString on the server. */
export function SitePageView({ data, ctx }: { data: PageData; ctx: SiteCtx }) {
  const config = makeSiteConfig();
  const Root = (config.root as any).render;
  return (
    <SiteProvider value={ctx}>
      <Root>{renderItems(config, data.content)}</Root>
    </SiteProvider>
  );
}
