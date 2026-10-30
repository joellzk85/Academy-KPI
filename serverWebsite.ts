// The public website (Joel, 2026-10-30; docs/features/website.md). Pages are edited in the CRM (Website) and drawn
// here as plain web pages Google can read. Only published pages are ever shown; drafts never leave the CRM.
// - Test address: <CRM address>/site and /site/<page> (hidden from Google).
// - The real address: when a visitor comes in on one of the website's own addresses (Website → Settings), the
//   homepage is / and pages are /<page>. Everything else on those addresses stays the CRM's (logos, API).
// - Batch 2: the calendar, programme pages (/programmes/<name>) and trainer pages (/trainers/<name>) come from the
//   CRM's runs, titles and trainers (src/lib/websiteData.ts); /training-calendar, /programmes and /trainers are made
//   automatically unless the owner made an edited page with that address.
import type { Express, Request, Response, NextFunction } from 'express';
import express from 'express';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { admin, callerFrom, route } from './serverAuth';
import { AUTO_PAGES, SitePageView, SiteCtx, SiteLink, SiteSpecial } from './src/website/blocks';
import { MEDIA, MENU_DOC, PAGES, PageData, SETTINGS_DOC, SITE_CSS, SiteMedia, SiteMenu, SitePage, SiteSettings, escapeHtml } from './src/lib/website';
import { EMPTY_SITE_DATA, SiteData, buildSiteData, todayMY } from './src/lib/websiteData';
import { formStamp } from './serverWebsiteForms';
import { STATS, STATS_TEST, hitScript, isRobot, pageKeyOf, sourceOf } from './src/lib/websiteStats';
import crypto from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';

type Snapshot = {
  at: number;
  pages: SitePage[];
  media: Record<string, SiteMedia>;
  menu: SiteMenu;
  settings: SiteSettings;
  data: SiteData;
};
let cache: Snapshot | null = null;
let loading: Promise<Snapshot> | null = null;
const FRESH_MS = 30_000;   // a change in the CRM shows on the website within half a minute

/** Firestore takes up to 30 values in an "in" search, so long lists are asked in parts. */
async function inChunks<T>(ids: string[], ask: (part: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 30) out.push(...await ask(ids.slice(i, i + 30)));
  return out;
}

async function loadData(): Promise<SiteData> {
  const { db } = admin();
  const today = todayMY();
  const [runsSnap, progSnap, trainerSnap] = await Promise.all([
    db.collection('public_programmes').where('trainingDate', '>=', today).get(),
    db.collection('programmes').get(),
    db.collection('trainers_directory').where('website.show', '==', true).get(),
  ]);
  const runs = runsSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })).filter(r => r.status !== 'cancelled');
  const programmes = progSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  const trainers = trainerSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  const outlineIds = [...new Set(programmes.filter(p => p.website?.show && p.website?.outlineId).map(p => String(p.website.outlineId)))];
  const venueIds = [...new Set(runs.map(r => String(r.venueId || '')).filter(Boolean))];
  const [deals, outlines, venues] = await Promise.all([
    inChunks(runs.map(r => r.id), async part => (await db.collection('pipelines').where('publicProgrammeId', 'in', part).get()).docs.map(d => ({ id: d.id, ...(d.data() as any) }))),
    outlineIds.length ? db.getAll(...outlineIds.map(id => db.collection('course_outlines').doc(id))).then(s => s.filter(d => d.exists).map(d => ({ id: d.id, ...(d.data() as any) }))) : Promise.resolve([]),
    venueIds.length ? db.getAll(...venueIds.map(id => db.collection('venues_directory').doc(id))).then(s => s.filter(d => d.exists).map(d => ({ id: d.id, ...(d.data() as any) }))) : Promise.resolve([]),
  ]);
  return buildSiteData({ runs, deals, programmes, trainers, outlines, venues, today });
}

async function load(): Promise<Snapshot> {
  if (cache && Date.now() - cache.at < FRESH_MS) return cache;
  if (loading) return loading;
  loading = (async () => {
    const { db } = admin();
    const [pages, media, menu, settings, data] = await Promise.all([
      db.collection(PAGES).get(),
      db.collection(MEDIA).get(),
      db.collection('config').doc(MENU_DOC).get(),
      db.collection('config').doc(SETTINGS_DOC).get(),
      loadData().catch(err => { console.error('Website: CRM data could not be read', err); return EMPTY_SITE_DATA; }),
    ]);
    const snap: Snapshot = {
      at: Date.now(),
      pages: pages.docs.map(d => ({ id: d.id, ...(d.data() as any) })).filter(p => p.published && !p.deleted),
      media: Object.fromEntries(media.docs.map(d => [d.id, { id: d.id, ...(d.data() as any) }])),
      menu: (menu.data() as SiteMenu) || { items: [] },
      settings: (settings.data() as SiteSettings) || {},
      data,
    };
    cache = snap;
    return snap;
  })().finally(() => { loading = null; });
  return loading;
}

/** The website as it is now (pages, menu, settings, runs, programmes, trainers), for the forms. */
export const siteSnapshot = () => load();

// Visit counting helpers: one person counted once a day (in memory, on this server), and a cap per connection.
const seen = new Map<string, Set<string>>();
function seenToday(day: string, who: string): boolean {
  if (!seen.has(day)) { seen.clear(); seen.set(day, new Set()); }
  const set = seen.get(day)!;
  if (set.has(who)) return true;
  if (set.size < 200000) set.add(who);
  return false;
}
const hitLog = new Map<string, number[]>();
function hitsTooMany(ip: string): boolean {
  const now = Date.now();
  const list = (hitLog.get(ip) || []).filter(t => now - t < 60_000);
  list.push(now);
  hitLog.set(ip, list);
  if (hitLog.size > 20000) hitLog.clear();
  return list.length > 60;
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

function pageHtml(opts: { data: PageData; title: string; description: string; snap: Snapshot; base: string; canonical?: string; hidden: boolean; special?: SiteSpecial; form?: SiteCtx['form'] }) {
  const ctx: SiteCtx = { media: opts.snap.media, menu: menuLinks(opts.snap, opts.base), settings: opts.snap.settings, data: opts.snap.data, editing: false, form: opts.form };
  let body = renderToString(React.createElement(SitePageView, { data: opts.data, ctx, special: opts.special }));
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
<script>${hitScript(opts.base)}</script>
</body>
</html>`;
}

const cut = (s: string, n = 155) => (s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s);

/** What a page address shows: an edited page, a page made from the CRM, or nothing (404). */
function pageFor(snap: Snapshot, slug: string): null | { data: PageData; title: string; description: string; special?: SiteSpecial; lastmod?: string } {
  const page = snap.pages.find(p => (p.slug || '') === slug);
  if (page?.published) {
    const root = page.published.root?.props || {};
    return { data: page.published, title: String(root.pageTitle || `${page.title} | Next Academy`), description: String(root.description || ''), lastmod: page.publishedAt };
  }
  const auto = AUTO_PAGES[slug];
  if (auto) return { data: { root: { props: {} }, content: auto.content }, title: `${auto.title} | Next Academy`, description: auto.description };
  const m = slug.match(/^(programmes|trainers)\/([a-z0-9-]+)$/);
  if (m?.[1] === 'programmes') {
    const x = snap.data.programmes.find(p => p.slug === m[2]);
    if (x) return { data: { root: { props: {} }, content: [] }, special: { kind: 'programme', slug: x.slug }, title: `${x.name} | Next Academy`, description: cut(x.summary || x.overview || `${x.name}: training by Next Academy.`) };
  }
  if (m?.[1] === 'trainers') {
    const t = snap.data.trainers.find(p => p.slug === m[2]);
    if (t) return { data: { root: { props: {} }, content: [] }, special: { kind: 'trainer', slug: t.slug }, title: `${t.name} | Next Academy trainer`, description: cut(t.headline || t.bio || `${t.name}, trainer at Next Academy.`) };
  }
  // Register on a calendar date (Batch 3): /register/<run>
  const r = slug.match(/^register\/([a-z0-9_-]+)$/);
  if (r) {
    const run = snap.data.runs.find(x => x.id.toLowerCase() === r[1]);
    if (run) return { data: { root: { props: {} }, content: [] }, special: { kind: 'register', slug: run.id }, title: `Register: ${run.title} | Next Academy`, description: '' };
  }
  return null;
}

async function sendPage(req: Request, res: Response, slug: string, base: string, hidden: boolean) {
  const snap = await load();
  const q = (k: string) => String(req.query[k] || '').slice(0, 300);
  // After a form: thank you, or what to fix (Batch 3).
  const found = slug === 'thank-you'
    ? { data: { root: { props: {} }, content: [] }, special: { kind: 'message' as const, slug: q('k') === 'register' ? 'register' : 'enquiry' }, title: 'Thank you | Next Academy', description: '' }
    : slug === 'form-problem'
      ? { data: { root: { props: {} }, content: [] }, special: { kind: 'problem' as const, slug: q('e') || 'Something is missing on the form.' }, title: 'Please check the form | Next Academy', description: '' }
      : pageFor(snap, slug);
  const form = { stamp: await formStamp().catch(() => ''), base, page: req.originalUrl.slice(0, 200), programme: q('programme'), back: /^\/[^/]/.test(q('back')) ? q('back') : '' };
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Cache-Control', hidden ? 'no-store' : 'public, max-age=60');
  if (!found) {
    const html = pageHtml({
      data: { root: { props: {} }, content: [{ type: 'HeadingBlock', props: { id: 'nf', eyebrow: 'Page not found', heading: "We couldn't find that page.", highlight: '', size: 'medium' } }, { type: 'ButtonBlock', props: { id: 'nfb', label: 'Go to the homepage', link: '/', look: 'blue' } }].map(b => ({ type: 'Section', props: { id: `s-${b.props.id}`, background: 'white', spacing: 'l', content: [b] } })) },
      title: 'Page not found | Next Academy', description: '', snap, base, hidden: true,
    });
    return res.status(404).type('html').send(html);
  }
  const quiet = !!found.special && ['register', 'message', 'problem'].includes(found.special.kind);
  if (quiet) res.set('Cache-Control', 'no-store');
  res.type('html').send(pageHtml({ ...found, snap, base, hidden: hidden || quiet, form, canonical: hidden || quiet ? undefined : `https://${req.hostname}/${slug}` }));
}

function sitemap(snap: Snapshot, host: string): string {
  const h = escapeHtml(host);
  const slugs = new Set<string>(snap.pages.map(p => p.slug || ''));
  Object.keys(AUTO_PAGES).forEach(s => slugs.add(s));
  snap.data.programmes.forEach(p => slugs.add(`programmes/${p.slug}`));
  snap.data.trainers.forEach(t => slugs.add(`trainers/${t.slug}`));
  const lastmod = (s: string) => snap.pages.find(p => (p.slug || '') === s)?.publishedAt?.slice(0, 10);
  const urls = [...slugs].map(s => `<url><loc>https://${h}/${escapeHtml(s)}</loc>${lastmod(s) ? `<lastmod>${lastmod(s)}</lastmod>` : ''}</url>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
}

const slugFromPath = (p: string) => decodeURIComponent(p.replace(/^\/+|\/+$/g, '')).toLowerCase();

// The old WordPress pages with no page of the same address (Joel, 2026-10-30): forwarded to the closest new page so
// Google and old links keep working. A published page with the old address always wins.
export const OLD_ADDRESSES: Record<string, string> = {
  'our-trainers': 'trainers',
  'mission-vision': 'about-us',
  'testimonial': 'about-us',
  'sales-marketing': 'training-courses',
  'shop': 'training-calendar', 'cart': 'training-calendar', 'checkout': 'training-calendar', 'my-account': 'training-calendar',
  'internship-opportunity': 'career',
};

/** Where an old address goes ('' = it isn't one, or a published page has it). */
export function oldAddressTarget(slug: string, publishedSlugs: string[]): string {
  const to = OLD_ADDRESSES[slug];
  return to && !publishedSlugs.includes(slug) ? to : '';
}

/** nextacademy.my → www.nextacademy.my when both are the website's addresses (the address Google already knows). */
export function wwwTarget(host: string, hosts: string[]): string {
  const h = host.toLowerCase();
  return !h.startsWith('www.') && hosts.includes(`www.${h}`) ? `www.${h}` : '';
}

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
      const www = wwwTarget(req.hostname, hosts);
      if (www) return res.redirect(301, `https://${www}${req.originalUrl}`);
      const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      const old = oldAddressTarget(slugFromPath(req.path), snap.pages.filter(p => p.published).map(p => p.slug || ''));
      if (old) return res.redirect(301, `/${old}${query}`);
      if (req.path === '/robots.txt') return res.type('text/plain').send(`User-agent: *\nAllow: /\nSitemap: https://${req.hostname}/sitemap.xml\n`);
      if (req.path === '/sitemap.xml') return res.type('application/xml').send(sitemap(snap, req.hostname));
      // Old WordPress addresses end in "/": send them to the same address without it.
      if (req.path.length > 1 && req.path.endsWith('/')) return res.redirect(301, req.path.replace(/\/+$/, '') + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''));
      await sendPage(req, res, slugFromPath(req.path), '', false);
    } catch (err) { next(err); }
  });
}

export function registerWebsiteRefresh(app: Express) {
  /** Clears the saved copy so a publish shows straight away on this server (the CRM calls it after publishing). */
  app.post('/api/site/refresh', route(async (req) => {
    await callerFrom(req);
    cache = null;
  }));
  /** A page was opened on the website (Batch 4): add to the day's counts. Nothing about the visitor is kept. */
  app.post('/api/site/hit', express.json({ limit: '4kb', type: () => true }), async (req, res) => {
    res.status(204).end();
    try {
      const ua = String(req.headers['user-agent'] || '');
      if (isRobot(ua)) return;
      const b = (req.body || {}) as Record<string, any>;
      const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      if (hitsTooMany(ip)) return;
      const snap = await load();
      const slug = String(b.p || '').replace(/^\/+|\/+$/g, '').toLowerCase().slice(0, 200);
      const known = slug === 'thank-you' || !!pageFor(snap, slug);
      if (!known) return;
      const day = todayMY();
      const first = b.f === 1 || b.f === '1';
      const source = first ? sourceOf(String(b.r || '').slice(0, 300), String(b.us || '').slice(0, 60), hostsOf(snap.settings)) : '';
      const campaign = first ? String(b.uc || '').toLowerCase().replace(/[^a-z0-9 _-]/g, '').slice(0, 40) : '';
      const who = crypto.createHash('sha256').update(`${day}|${ip}|${ua}`).digest('hex').slice(0, 20);
      const newVisitor = first && !seenToday(day, who);
      const inc = (n = 1) => FieldValue.increment(n);
      const data: any = { views: inc(), pages: { [pageKeyOf(slug)]: inc() }, day };
      if (first) {
        data.visits = inc();
        data.devices = { [b.d === 'phone' ? 'phone' : 'computer']: inc() };
        if (source) data.sources = { [source]: inc() };
        if (campaign) data.campaigns = { [campaign]: inc() };
      }
      if (newVisitor) data.visitors = inc();
      const { db } = admin();
      await db.collection(b.t ? STATS_TEST : STATS).doc(day).set(data, { merge: true });
    } catch (err) { console.error('Website visit not counted', err); }
  });
  /** The calendar, programmes and trainers as the website shows them, for the page editor's preview. */
  app.post('/api/site/data', route(async (req) => {
    await callerFrom(req);
    return { data: (await load()).data };
  }));
}
