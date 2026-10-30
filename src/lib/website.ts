// The public website (nextacademy.my), edited in the CRM (Joel, 2026-10-30). See docs/features/website.md.
// - site_pages/{id}: one page. `draft` is what the editor shows, `published` what visitors see. Editors' changes wait
//   for the owner's OK (status 'waiting'); the owner publishes. Every publish is kept in site_pages/{id}/versions.
// - site_media/{id}: photos, short video clips and YouTube links (Website → Media). Pages point to them by id.
// - config/site_menu and config/site_settings: the menu, who may edit, social links and the website's own addresses.
// Shared by the CRM screens and the server (serverWebsite.ts), so nothing here touches the browser or the database.

export const PAGES = 'site_pages';
export const MEDIA = 'site_media';
export const MENU_DOC = 'site_menu';          // config/site_menu
export const SETTINGS_DOC = 'site_settings';  // config/site_settings

export type PageData = { root: { props?: Record<string, any> }; content: any[]; zones?: Record<string, any[]> };

export type SitePage = {
  id: string;
  title: string;              // its name in the CRM's page list
  slug: string;               // '' = the homepage; else 'training-calendar' → /training-calendar
  draft?: PageData;
  draftBy?: string;
  draftByName?: string;
  draftAt?: string;
  status?: 'live' | 'draft' | 'waiting';   // live = nothing unpublished
  note?: string;              // the owner's note when sending changes back
  published?: PageData | null;
  publishedAt?: string;
  publishedByName?: string;
  createdAt?: string;
};

export type SiteMedia = {
  id: string;
  name: string;
  kind: 'image' | 'video' | 'youtube';
  url: string;                 // download link (image / clip), or the YouTube watch link
  storagePath?: string;
  youtubeId?: string;
  folder?: string;
  alt?: string;                // "Describe the photo"
  tags?: string[];
  focusX?: number;             // 0–100, where phones crop around
  focusY?: number;
  width?: number;
  height?: number;
  size?: number;
  createdBy?: string;
  createdByName?: string;
  createdAt?: string;
};

export type MenuItem = { label: string; pageId?: string; url?: string; button?: boolean };
export type SiteMenu = { items: MenuItem[] };

export type SiteSettings = {
  editors?: string[];          // team member ids who may edit besides Admin and Management
  tagline?: string;
  facebook?: string;
  instagram?: string;
  linkedin?: string;
  whatsapp?: string;           // number, e.g. 60183634888
  domains?: string[];          // the website's own addresses, e.g. nextacademy.my, www.nextacademy.my
};

export const MEDIA_FOLDERS = ['Homepage', 'Programmes', 'Trainers', 'Training days', 'Client logos', 'Videos', 'Other'];

/** Admin and Management, plus anyone ticked in Website → Settings. */
export function canEditSite(member: { id: string; role: string }, settings?: SiteSettings | null): boolean {
  return member.role === 'admin' || member.role === 'management' || !!settings?.editors?.includes(member.id);
}

/** 'Training Calendar!' → 'training-calendar'. */
export function slugify(text: string): string {
  return text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

/** Addresses the website itself uses (never a page's). */
export const RESERVED_SLUGS = ['site', 'site-assets', 'api', 'assets', 'robots.txt', 'sitemap.xml', 'trainer', 'accounts', 'q', 'o', 'p', 't', 'c', 'pay', 'ref'];

/** The YouTube video id from any YouTube link, or '' when it isn't one. */
export function youtubeIdOf(link: string): string {
  const s = (link || '').trim();
  const m = s.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : '';
}

/** Is this link safe to put in an href on the public site? */
export function safeHref(link: string | undefined): string {
  const s = (link || '').trim();
  if (!s) return '#';
  if (/^(https?:|mailto:|tel:)/i.test(s) || s.startsWith('/') || s.startsWith('#')) return s;
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(s)) return 'https://' + s;
  return '#';
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s: string) => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);

// Rich text from the editor, cleaned before it reaches the public site: only plain formatting tags, links only to
// web, email or phone addresses, no scripts, styles or event handlers.
const ALLOWED_TAGS = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'a', 'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'blockquote', 'hr']);
export function cleanRichText(html: string): string {
  return String(html || '')
    .replace(/<(script|style|iframe|object|embed|template|noscript)[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?([a-zA-Z0-9]+)([^>]*)>/g, (whole, tag: string, attrs: string) => {
      const t = tag.toLowerCase();
      if (!ALLOWED_TAGS.has(t)) return '';
      if (whole.startsWith('</')) return `</${t}>`;
      if (t === 'a') {
        const href = attrs.match(/href\s*=\s*("([^"]*)"|'([^']*)')/i);
        const link = safeHref(href ? (href[2] ?? href[3]) : '');
        const outside = /^https?:/i.test(link);
        return `<a href="${escapeHtml(link)}"${outside ? ' target="_blank" rel="noopener"' : ''}>`;
      }
      return `<${t}>`;
    });
}

// The brand (Joel's brand deck, 2026-10-30): Archivo Regular and Bold only; Next Blue, the mint teal, black, clay grey, white.
export const BRAND = {
  blue: '#2B6AA2',
  teal: '#5BC0A0',
  black: '#0B0F0E',
  dark: '#111716',
  grey: '#C1C1C1',
  paper: '#F6F6F4',
  white: '#FFFFFF',
  body: '#4B5250',
};

// The website's whole style sheet: printed into every public page and into the editor's preview.
export const SITE_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;700&display=swap');
.nw{font-family:'Archivo',system-ui,sans-serif;color:${BRAND.black};font-size:17px;line-height:1.55;background:#fff;-webkit-font-smoothing:antialiased}
.nw *{box-sizing:border-box}
.nw img{max-width:100%}
.nw a{color:${BRAND.blue}}
.nw h1,.nw h2,.nw h3,.nw p{margin:0}
.nw-wrap{max-width:1240px;margin:0 auto;padding-left:32px;padding-right:32px}
.nw-narrow{max-width:860px}
.nw-band{position:relative}
.nw-pad-s{padding-top:48px;padding-bottom:48px}.nw-pad-m{padding-top:80px;padding-bottom:80px}.nw-pad-l{padding-top:112px;padding-bottom:112px}
.nw-bg-white{background:#fff}
.nw-bg-light{background:${BRAND.paper}}
.nw-bg-dark{background:${BRAND.dark};color:#fff}
.nw-bg-black{background:#000;color:#fff}
.nw-bg-blue{background:${BRAND.blue};color:#fff}
.nw-bg-teal{background:${BRAND.teal};color:${BRAND.black}}
.nw-bg-black.nw-grid,.nw-bg-dark.nw-grid{background-image:linear-gradient(rgba(255,255,255,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.045) 1px,transparent 1px);background-size:56px 56px}
.nw-bg-light.nw-grid,.nw-bg-white.nw-grid{background-image:linear-gradient(rgba(0,0,0,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(0,0,0,.04) 1px,transparent 1px);background-size:56px 56px}
.nw-bg-dark a,.nw-bg-black a,.nw-bg-blue a{color:#fff}
.nw-stack{display:flex;flex-direction:column;gap:20px}
.nw-eyebrow{font-size:13px;letter-spacing:.16em;text-transform:uppercase;font-weight:700;color:${BRAND.blue}}
.nw-bg-dark .nw-eyebrow,.nw-bg-black .nw-eyebrow{color:${BRAND.teal}}
.nw-bg-blue .nw-eyebrow{color:#fff}
.nw-h1{font-size:clamp(40px,6vw,76px);line-height:1.02;font-weight:700;letter-spacing:-.02em}
.nw-h2{font-size:clamp(32px,4vw,52px);line-height:1.08;font-weight:700;letter-spacing:-.015em}
.nw-h3{font-size:clamp(24px,2.6vw,32px);line-height:1.15;font-weight:700}
.nw-lead{font-size:20px;color:${BRAND.body};max-width:620px}
.nw-bg-dark .nw-lead,.nw-bg-black .nw-lead{color:#D9DEDC}
.nw-bg-blue .nw-lead{color:#fff}
.nw-muted{color:${BRAND.body}}
.nw-bg-dark .nw-muted,.nw-bg-black .nw-muted{color:${BRAND.grey}}
.nw-bg-blue .nw-muted{color:#fff}
.nw-mark{background:${BRAND.teal};color:#fff;padding:0 .18em;box-decoration-break:clone;-webkit-box-decoration-break:clone}
.nw-center{text-align:center;align-items:center}
.nw-btns{display:flex;flex-wrap:wrap;gap:14px}
.nw-btn{display:inline-flex;align-items:center;gap:10px;min-height:48px;padding:0 24px;border-radius:2px;font-weight:700;font-size:16px;text-decoration:none;border:1px solid transparent}
.nw .nw-btn-teal{background:${BRAND.teal};color:${BRAND.black}}
.nw .nw-btn-blue{background:${BRAND.blue};color:#fff}
.nw .nw-btn-dark{background:${BRAND.black};color:#fff}
.nw .nw-btn-outline{border-color:currentColor;color:inherit}
.nw-btn:hover{filter:brightness(.94)}
.nw-split{display:flex;flex-wrap:wrap;align-items:center;gap:56px}
.nw-split>*{flex:1 1 420px;min-width:0}
.nw-photo{display:block;width:100%;object-fit:cover}
.nw-frame{background:${BRAND.paper};padding:14px;box-shadow:14px 14px 0 ${BRAND.blue}}
/* Torn paper (Facebook posts, 2026-10-30): a photo with a ripped top edge and a mint tint, and bands that tear into the one above */
.nw-tint{position:relative;display:block;overflow:hidden}
.nw-tint img{filter:grayscale(1) contrast(1.08)}
.nw-tint::after{content:"";position:absolute;inset:0;background:${BRAND.teal};mix-blend-mode:multiply;opacity:.55;pointer-events:none}
.nw-tear{position:relative;margin-top:-1px}
.nw-tear::before{content:"";position:absolute;left:0;right:0;top:-30px;height:31px;background-color:inherit;clip-path:polygon(0 60%,5% 30%,11% 55%,17% 20%,24% 50%,30% 25%,37% 58%,44% 22%,50% 48%,57% 18%,63% 52%,70% 28%,77% 56%,83% 24%,90% 50%,96% 30%,100% 45%,100% 100%,0 100%);pointer-events:none;z-index:1}
.nw-torn{clip-path:polygon(0 3%,4% 1%,8% 4%,12% 1.5%,17% 3.5%,22% .5%,27% 3%,31% 1%,36% 4%,41% 1.5%,46% 3%,51% .5%,56% 3.5%,61% 1%,66% 3%,71% .5%,76% 3.5%,81% 1.5%,86% 4%,91% 1%,96% 3%,100% 1.5%,100% 100%,0 100%)}
.nw-cols{display:grid;gap:40px;align-items:start}
.nw-col{min-width:0;display:flex;flex-direction:column;gap:20px}
.nw-points{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:32px}
.nw-point{border-top:2px solid currentColor;padding-top:20px;display:flex;flex-direction:column;gap:10px}
.nw-point-n{font-size:40px;font-weight:700;color:${BRAND.blue};line-height:1}
.nw-bg-dark .nw-point-n,.nw-bg-black .nw-point-n{color:${BRAND.teal}}
.nw-bg-blue .nw-point-n{color:#fff}
.nw-squares{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:26px}
.nw-squares li{display:flex;gap:18px;align-items:flex-start}
.nw-squares li::before{content:"";flex:0 0 28px;height:28px;background:${BRAND.teal};margin-top:2px}
.nw-squares strong{display:block;font-size:22px;line-height:1.2;letter-spacing:-.01em}
.nw-review{background:#fff;color:${BRAND.black};padding:16px 18px;width:min(270px,100%);box-shadow:0 18px 40px rgba(0,0,0,.3);display:flex;flex-direction:column;gap:6px;text-align:left}
.nw-review strong{color:#2F8F72;font-size:17px}
.nw-review small{color:${BRAND.body};font-size:13px;margin-top:-4px}
.nw-review p{font-size:16px;line-height:1.35}
.nw-review-src{font-size:12px;color:${BRAND.body}}
.nw-review-src b{color:#E8A317;letter-spacing:1px;font-weight:400;margin-left:6px}
.nw-hero-pic{position:relative}
.nw-hero-pic .nw-review{position:absolute;left:-28px;bottom:32px}
.nw-wall{position:relative;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));grid-auto-rows:170px;gap:6px}
.nw-wall>div{min-width:0;overflow:hidden}
.nw-wall img,.nw-wall .nw-placeholder{width:100%;height:100%;object-fit:cover;filter:grayscale(1) contrast(1.05)}
.nw-wall>div:first-child{grid-column:span 2;grid-row:span 2}
.nw-wall>div:nth-child(2){grid-row:span 2}
.nw-wall>.nw-wall-cards{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:24px;flex-wrap:wrap;padding:20px;overflow:visible}
.nw-wall-cards .nw-review:nth-child(even){transform:translateY(36px)}
.nw-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:24px}
.nw .nw-tile{position:relative;background:${BRAND.black};color:#fff;min-height:440px;display:flex;flex-direction:column;justify-content:flex-end;overflow:hidden;text-decoration:none}
.nw-tile>img,.nw-tile>.nw-placeholder{position:absolute;left:0;right:0;top:0;width:100%;height:64%;object-fit:cover}
.nw-tile-body{position:relative;padding:28px;display:flex;flex-direction:column;gap:12px;background:${BRAND.black}}
.nw-tile-body::before{content:"";position:absolute;left:0;right:0;top:-22px;height:24px;background:${BRAND.black};clip-path:polygon(0 60%,6% 25%,12% 55%,19% 15%,26% 50%,33% 20%,40% 60%,47% 25%,54% 50%,61% 15%,68% 55%,75% 25%,82% 58%,89% 20%,95% 50%,100% 30%,100% 100%,0 100%)}
.nw-tags{display:flex;flex-wrap:wrap;gap:8px}
.nw-tags span{font-size:13px;border:1px solid rgba(255,255,255,.28);padding:4px 10px;color:#D9DEDC}
.nw-tile-go,.nw-tile .nw-eyebrow{font-weight:700;color:${BRAND.teal}}
.nw-posts{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:20px}
.nw .nw-post{position:relative;aspect-ratio:1/1;max-width:100%;background-color:#15191B;background-image:linear-gradient(rgba(255,255,255,.055) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.055) 1px,transparent 1px);background-size:40px 40px;border:1px solid rgba(255,255,255,.08);color:#fff;padding:26px;display:flex;flex-direction:column;justify-content:space-between;gap:16px;text-decoration:none;overflow:hidden}
.nw-post:hover{border-color:${BRAND.teal}}
.nw-post h3{position:relative;z-index:1;font-size:clamp(22px,2.2vw,27px);line-height:1.15;letter-spacing:-.01em}
.nw-post-meta{position:relative;z-index:1;display:flex;justify-content:space-between;gap:12px;font-size:13px;color:#A9B1AE}
.nw-post-pic{position:absolute;left:0;right:0;bottom:0;height:38%}
.nw-post-pic img{width:100%;height:100%;object-fit:cover;display:block}
.nw-post.nw-has-pic{justify-content:flex-start}
.nw-post.nw-has-pic .nw-post-meta{order:-1}
.nw-logos{display:flex;flex-wrap:wrap;align-items:center;gap:16px 48px;color:${BRAND.body};font-size:15px}
.nw-logos img{height:40px;width:auto;object-fit:contain}
.nw-values{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:16px 40px}
.nw-values span{font-size:clamp(22px,2.4vw,30px);font-weight:700}
.nw-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:20px}
.nw-run{border:1px solid #E4E4E1;display:flex;background:#fff;color:${BRAND.black}}
.nw-run-date{flex:0 0 92px;background:${BRAND.dark};color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px 8px;text-align:center}
.nw-run-day{font-size:34px;font-weight:700;line-height:1}
.nw-run-mon{font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:${BRAND.teal};font-weight:700;margin-top:6px}
.nw-run-body{flex:1 1 auto;min-width:0;padding:20px 22px;display:flex;flex-direction:column;gap:8px}
.nw-run-title{font-size:19px;line-height:1.3;font-weight:700}
.nw-chip{display:inline-block;font-size:13px;font-weight:700;background:#E3F4EE;color:${BRAND.black};padding:3px 10px}
.nw-card-box{background:#fff;border:1px solid #E4E4E1;padding:32px;color:${BRAND.black}}
.nw-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}
.nw-field{display:flex;flex-direction:column;gap:6px;font-size:15px;font-weight:700;color:${BRAND.black};min-width:0}
.nw-field input:not([type=radio]):not([type=checkbox]),.nw-field select,.nw-field textarea{font:inherit;font-weight:400;font-size:16px;min-height:48px;border:1px solid ${BRAND.grey};border-radius:2px;padding:10px 12px;background:#fff;color:${BRAND.black};width:100%}
.nw-field textarea{resize:vertical}
.nw-field input:not([type=radio]):not([type=checkbox]):focus,.nw-field select:focus,.nw-field textarea:focus{outline:2px solid ${BRAND.blue};outline-offset:1px}
.nw-radios{border:0;margin:0;padding:0}
.nw-radios legend{padding:0;margin-bottom:6px}
.nw-radios label{display:flex;align-items:center;gap:8px;font-weight:400;min-height:32px}
.nw-radios input{width:18px;height:18px;margin:0}
.nw-wide{grid-column:1/-1}
.nw-consent{display:flex;gap:10px;align-items:flex-start;font-size:14px;color:${BRAND.body}}
.nw-consent input{margin-top:3px;width:18px;height:18px;flex:0 0 auto}
.nw-trap{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}
.nw-chip-full{background:#FDE8E7;color:#8A1C14}
.nw-link{font-weight:700;text-decoration:none}
.nw-row-link{display:flex;justify-content:space-between;align-items:center;gap:12px;min-height:56px;padding:8px 0;border-bottom:1px solid #E4E4E1;color:inherit!important;text-decoration:none;font-size:18px;font-weight:700}
.nw-row-link:hover>span:first-child{color:${BRAND.blue}}
.nw-bg-dark .nw-row-link:hover>span:first-child,.nw-bg-black .nw-row-link:hover>span:first-child{color:${BRAND.teal}}
.nw-list{margin:0;padding-left:22px;display:flex;flex-direction:column;gap:6px}
.nw-modules{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:20px}
.nw-modules>li{display:flex;gap:20px;border-top:1px solid #E4E4E1;padding-top:18px}
.nw-person{color:inherit!important;text-decoration:none}
.nw-person:hover h3{color:${BRAND.blue}}
.nw-sample{display:inline-block;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;background:#FFF3C4;color:#5B4A00;padding:3px 8px}
.nw-people{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:24px}
.nw-person-photo{aspect-ratio:4/5;background:${BRAND.paper};border:1px solid #E4E4E1;display:flex;align-items:center;justify-content:center;color:${BRAND.body};font-size:14px;overflow:hidden}
.nw-quote-mark{width:56px;height:56px}
.nw-quote{font-size:clamp(24px,3vw,36px);line-height:1.25;font-weight:700}
.nw-video{position:relative;width:100%;aspect-ratio:16/9;background:#000}
.nw-video iframe,.nw-video video{position:absolute;inset:0;width:100%;height:100%;border:0}
.nw-caption{font-size:14px;color:${BRAND.body};margin-top:8px}
.nw-rich p+p,.nw-rich p+ul,.nw-rich ul+p{margin-top:14px}
.nw-rich h2{font-size:30px;line-height:1.15;margin:8px 0}
.nw-rich h3{font-size:22px;margin:6px 0}
.nw-rich ul,.nw-rich ol{padding-left:22px;margin:0}
.nw-rich blockquote{border-left:3px solid ${BRAND.teal};margin:0;padding-left:16px}
.nw-contact{display:flex;flex-direction:column;gap:8px;font-size:16px}
.nw-placeholder{border:2px dashed #C9CFCB;padding:28px;text-align:center;color:${BRAND.body};font-size:15px}
/* Header and footer */
.nw-head{background:${BRAND.black};border-bottom:1px solid rgba(255,255,255,.08);position:sticky;top:0;z-index:20}
.nw-head-in{display:flex;align-items:center;justify-content:space-between;gap:16px 32px;padding-top:16px;padding-bottom:16px;flex-wrap:wrap}
.nw-logo img{height:46px;width:auto;display:block}
.nw-nav{display:flex;flex-wrap:wrap;align-items:center;gap:8px 28px}
.nw .nw-nav a{color:#C9CFCD;text-decoration:none;font-size:15px}
.nw .nw-nav a:hover{color:#fff}
.nw .nw-nav a.nw-btn{background:${BRAND.teal};color:${BRAND.black};min-height:44px;padding:0 20px}
.nw-menu-toggle{display:none}
.nw-menu-btn{display:none;min-height:44px;min-width:44px;align-items:center;justify-content:center;border:1px solid rgba(255,255,255,.25);color:#fff;cursor:pointer;font-weight:700}
.nw-foot{background:${BRAND.black};color:${BRAND.grey}}
.nw-foot a{color:${BRAND.grey};text-decoration:none}
.nw-foot a:hover{color:#fff}
.nw-foot-in{display:flex;flex-direction:column;gap:40px;padding-top:64px;padding-bottom:40px}
.nw-foot-top{display:flex;flex-wrap:wrap;justify-content:space-between;gap:32px}
.nw-foot-links{display:flex;flex-wrap:wrap;gap:12px 48px;font-size:15px}
.nw-foot-links div{display:flex;flex-direction:column;gap:10px}
.nw-foot-bottom{border-top:1px solid rgba(255,255,255,.12);padding-top:24px;display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px;font-size:13px;color:#A9B0AE}
@media (max-width:760px){
  .nw-wrap{padding-left:16px;padding-right:16px}
  .nw-pad-m{padding-top:56px;padding-bottom:56px}.nw-pad-l{padding-top:72px;padding-bottom:72px}
  .nw-cols{grid-template-columns:1fr!important}
  .nw-split{gap:32px}
  .nw-menu-btn{display:inline-flex}
  .nw-nav{display:none;width:100%;flex-direction:column;align-items:flex-start;gap:4px}
  .nw-nav a{min-height:44px;display:flex;align-items:center}
  .nw-menu-toggle:checked~.nw-nav{display:flex}
  .nw-frame{box-shadow:8px 8px 0 ${BRAND.blue};padding:8px}
  .nw-cards{grid-template-columns:1fr}
  .nw-form{grid-template-columns:1fr}
  .nw-card-box{padding:20px}
  .nw-hero-pic .nw-review{left:12px;bottom:16px}
  .nw-wall{grid-template-columns:1fr 1fr;grid-auto-rows:120px}
  .nw-wall>div:nth-child(2){grid-row:span 1}
  .nw-wall>div:nth-child(4):not(.nw-wall-cards){display:none}
  .nw-wall>.nw-wall-cards{position:relative;inset:auto;grid-column:1/-1;padding:14px 0 0}
  .nw-wall-cards .nw-review:nth-child(even){transform:none}
  .nw-tear::before{top:-18px;height:19px}
}
`;

/** The homepage as drawn in the mock-up (Website → Pages → "Start with the homepage"). */
export function starterHome(): PageData {
  let n = 0;
  const id = (t: string) => `${t}-start-${++n}`;
  return {
    root: { props: { pageTitle: 'Next Academy | HRD Corp claimable training in Malaysia', description: 'Personalised, practical training and coaching for teams across Malaysia. HRD Corp registered training provider.' } },
    content: [
      { type: 'Hero', props: { id: id('Hero'), eyebrow: 'HRD Corp registered training provider', headline: 'The path to leadership is', highlight: 'practice.', headlineEnd: '', text: "Behind every great employee is a trainer who didn't use 100 slides. Personalised, practical training and coaching for teams across Malaysia.", button1Label: 'See the training calendar', button1Link: '/training-calendar', button2Label: 'Plan a training with us', button2Link: '#contact', image: '', imageStyle: 'frame', background: 'dark' } },
      { type: 'LogoStrip', props: { id: id('LogoStrip'), label: 'Trusted by teams at', items: [{ name: 'HLA Garment', image: '' }, { name: 'Impiana Hotel KLCC', image: '' }, { name: 'Trinitium', image: '' }] } },
      { type: 'Calendar', props: { id: id('Calendar'), eyebrow: '01 / Training calendar', heading: 'Upcoming public programmes', text: 'Open to everyone. Most are HRD Corp claimable.', only: 'all', count: 6, background: 'white' } },
      { type: 'Points', props: { id: id('Points'), eyebrow: '02 / Why Next Academy', heading: 'Designed to be seen, read,', highlight: 'remembered.', background: 'light', items: [
        { title: 'Personalised', text: 'Every programme is tailored to your goals, industry and where your team is heading.' },
        { title: 'Purpose-driven', text: 'Growth anchored in integrity and real impact, for your people and your business.' },
        { title: 'Holistic', text: 'Beyond skills: ethical leadership, fresh thinking and a habit of lifelong learning.' },
      ] } },
      { type: 'Programmes', props: { id: id('Programmes'), eyebrow: '03 / Programmes', heading: 'Training that moves people.', text: 'In-house for your team or public for individuals. Classroom, team building and technical skills.', background: 'white' } },
      { type: 'Quote', props: { id: id('Quote'), quote: '[A line or two from a happy client goes here.]', name: 'Julie and Jonathan, HLA Garment', media: '', background: 'dark' } },
      { type: 'Trainers', props: { id: id('Trainers'), eyebrow: '04 / Our trainers', heading: 'Become the person', highlight: 'they look up to.', count: 4, background: 'white' } },
      { type: 'ValuesBand', props: { id: id('ValuesBand'), label: 'Our HEART values', items: [{ word: 'Humility' }, { word: 'Expertise' }, { word: 'Accountability' }, { word: 'Remarkable' }, { word: 'Trustworthiness' }], background: 'blue' } },
      { type: 'Contact', props: { id: id('Contact'), eyebrow: '05 / Talk to us', heading: 'Schedule a session with our training experts.', text: 'Tell us about your team. We reply within one working day.', background: 'light' } },
    ],
  };
}

export const emptyPage = (title: string): PageData => ({ root: { props: { pageTitle: `${title} | Next Academy`, description: '' } }, content: [] });
