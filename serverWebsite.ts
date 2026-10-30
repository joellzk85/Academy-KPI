// The public website (Joel, 2026-10-30; docs/features/website.md). Pages are edited in the CRM (Website) and drawn
// here as plain web pages Google can read. Only published pages are ever shown; drafts never leave the CRM.
// - Test address: <CRM address>/site and /site/<page> (hidden from Google).
// - The real address: when a visitor comes in on one of the website's own addresses (Website → Settings), the
//   homepage is / and pages are /<page>. Everything else on those addresses stays the CRM's (logos, API).
import type { Express, Request, Response, NextFunction } from 'express';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { admin, callerFrom, route } from './serverAuth';
import { SitePageView, SiteCtx, SiteLink } from './src/website/blocks';
import { MEDIA, MENU_DOC, PAGES, PageData, SETTINGS_DOC, SITE_CSS, SiteMedia, SiteMenu, SitePage, SiteSettings, escapeHtml } from './src/lib/website';

type Snapshot = {
  at: number;
  pages: SitePage[];
  media: Record<string, SiteMedia>;
  menu: SiteMenu;
  settings: SiteSettings;
};
let cache: Snapshot | null = null;
let loading: Promise<Snapshot> | null = null;
const FRESH_MS = 30_000;   // a published change shows on the website within half a minute

async function load(): Promise<Snapshot> {
  if (cache && Date.now() - cache.at < FRESH_MS) return cache;
  if (loading) return loading;
  loading = (async () => {
    const { db } = admin();
    const [pages, media, menu, settings] = await Promise.all([
      db.collection(PAGES).get(),
      db.collection(MEDIA).get(),
      db.collection('config').doc(MENU_DOC).get(),
      db.collection('config').doc(SETTINGS_DOC).get(),
    ]);
    const snap: Snapshot = {
      at: Date.now(),
      pages: pages.docs.map(d => ({ id: d.id, ...(d.data() as any) })).filter(p => p.published && !p.deleted),
      media: Object.fromEntries(media.docs.map(d => [d.id, { id: d.id, ...(d.data() as any) }])),
      menu: (menu.data() as SiteMenu) || { items: [] },
      settings: (settings.data() as SiteSettings) || {},
    };
    cache = snap;
    return snap;
  })().finally(() => { loading = null; });
  return loading;
}

const hostsOf = (s: SiteSettings) => (s.domains || []).map(d => d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean);

function menuLinks(snap: Snapshot, base: string): SiteLink[] {
  return (snap.menu.items || []).map((item): SiteLink | null => {
    const page = item.pageId ? snap.pages.find(p => p.id === item.pageId) : undefined;
    if (item.pageId && !page) return null;   // a page not published yet stays out of the menu
    const href = page ? `${base}/${page.slug}` : (item.url || '#');
    return { label: item.label || page?.title || '', href: href || '/', button: !!item.button };
  }).filter((l): l is SiteLink => !!l && !!l.label);
}

function pageHtml(opts: { data: PageData; title: string; description: string; snap: Snapshot; base: string; canonical?: string; hidden: boolean }) {
  const ctx: SiteCtx = { media: opts.snap.media, menu: menuLinks(opts.snap, opts.base), settings: opts.snap.settings, editing: false };
  let body = renderToString(React.createElement(SitePageView, { data: opts.data, ctx }));
  // On the test address every link inside the site gets /site in front, so clicking around stays on the test pages.
  if (opts.base) body = body.replace(/href="\/(?!site-assets\/|site\/|site"|\/)/g, `href="${opts.base}/`);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.title)}</title>
${opts.description ? `<meta name="description" content="${escapeHtml(opts.description)}">` : ''}
${opts.hidden ? '<meta name="robots" content="noindex, nofollow">' : ''}
${opts.canonical ? `<link rel="canonical" href="${escapeHtml(opts.canonical)}">` : ''}
<meta property="og:title" content="${escapeHtml(opts.title)}">
${opts.description ? `<meta property="og:description" content="${escapeHtml(opts.description)}">` : ''}
<meta property="og:type" content="website">
<link rel="icon" href="/site-assets/logo-light.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<style>${SITE_CSS}body{margin:0}</style>
</head>
<body>
${body}
</body>
</html>`;
}

async function sendPage(req: Request, res: Response, slug: string, base: string, hidden: boolean) {
  const snap = await load();
  const page = snap.pages.find(p => (p.slug || '') === slug);
  const host = req.hostname;
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Cache-Control', hidden ? 'no-store' : 'public, max-age=60');
  if (!page?.published) {
    const html = pageHtml({
      data: { root: { props: {} }, content: [{ type: 'HeadingBlock', props: { id: 'nf', eyebrow: 'Page not found', heading: "We couldn't find that page.", highlight: '', size: 'medium' } }, { type: 'ButtonBlock', props: { id: 'nfb', label: 'Go to the homepage', link: '/', look: 'blue' } }].map(b => ({ type: 'Section', props: { id: `s-${b.props.id}`, background: 'white', spacing: 'l', content: [b] } })) },
      title: 'Page not found | Next Academy', description: '', snap, base, hidden: true,
    });
    return res.status(404).type('html').send(html);
  }
  const root = page.published.root?.props || {};
  res.type('html').send(pageHtml({
    data: page.published,
    title: String(root.pageTitle || `${page.title} | Next Academy`),
    description: String(root.description || ''),
    snap, base, hidden,
    canonical: hidden ? undefined : `https://${host}/${page.slug || ''}`,
  }));
}

const slugFromPath = (p: string) => decodeURIComponent(p.replace(/^\/+|\/+$/g, '')).toLowerCase();

export function registerWebsiteRoutes(app: Express) {
  // Test address on the CRM: /site and /site/<page>, never shown to Google.
  app.get(['/site', '/site/*'], async (req, res, next) => {
    try {
      await sendPage(req, res, slugFromPath(req.path.replace(/^\/site/, '')), '/site', true);
    } catch (err) { next(err); }
  });

  // The website's own addresses (Website → Settings).
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/site-assets/') || req.path.startsWith('/api/') || req.path.startsWith('/assets/')) return next();
    // The CRM's own address never needs the website's data.
    if (/(^localhost$|^127\.|\.hosted\.app$|\.web\.app$|\.firebaseapp\.com$)/i.test(req.hostname)) return next();
    let snap: Snapshot;
    try { snap = await load(); } catch (err) { return next(); }   // the CRM keeps working even if the site can't load
    const hosts = hostsOf(snap.settings);
    if (!hosts.includes(req.hostname.toLowerCase())) return next();
    try {
      if (req.path === '/robots.txt') return res.type('text/plain').send(`User-agent: *\nAllow: /\nSitemap: https://${req.hostname}/sitemap.xml\n`);
      if (req.path === '/sitemap.xml') {
        const urls = snap.pages.map(p => `<url><loc>https://${escapeHtml(req.hostname)}/${escapeHtml(p.slug || '')}</loc>${p.publishedAt ? `<lastmod>${p.publishedAt.slice(0, 10)}</lastmod>` : ''}</url>`).join('');
        return res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
      }
      // Old WordPress addresses end in "/": send them to the same address without it.
      if (req.path.length > 1 && req.path.endsWith('/')) return res.redirect(301, req.path.replace(/\/+$/, '') + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''));
      await sendPage(req, res, slugFromPath(req.path), '', false);
    } catch (err) { next(err); }
  });
}

/** Clears the saved copy so a publish shows straight away on this server (the CRM calls it after publishing). */
export function registerWebsiteRefresh(app: Express) {
  app.post('/api/site/refresh', route(async (req) => {
    await callerFrom(req);
    cache = null;
  }));
}
