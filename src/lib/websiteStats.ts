// Website visitors (Batch 4, Joel 2026-10-30; docs/features/website.md). A tiny script on each public page tells
// the server a page was opened (serverWebsite.ts /api/site/hit): the page, where the visitor came from (only on the
// first page of a visit), phone or computer. No cookies, no Google Analytics and nothing personal is kept: the server
// only adds to one record a day (site_stats/{YYYY-MM-DD}; visits to the test address in site_stats_test). Each
// enquiry also remembers where its visitor came from, so Website → Visitors (Management only) shows website
// enquiries → deals → won RM by where they came from. Pure, so the server and the CRM share it.

export const STATS = 'site_stats';
export const STATS_TEST = 'site_stats_test';

export type StatsDay = {
  views?: number;                       // pages opened
  visits?: number;                      // visits started (first page of a visit)
  visitors?: number;                    // different people that day (roughly: same connection and browser = one)
  pages?: Record<string, number>;       // page key → views
  sources?: Record<string, number>;     // where visits came from → visits
  campaigns?: Record<string, number>;   // campaign name → visits
  devices?: Record<string, number>;     // phone / computer → visits
  forms?: Record<string, number>;       // enquiry / register → forms sent
};

/** Where a visit came from, in plain words: a campaign tag wins, else the site the visitor clicked from. */
export function sourceOf(ref: string, utmSource: string, ownHosts: string[] = []): string {
  const u = String(utmSource || '').trim().toLowerCase();
  if (u) {
    if (/^(fb|facebook|meta)/.test(u)) return 'Facebook';
    if (/^(ig|insta)/.test(u)) return 'Instagram';
    if (/^(li|linkedin)/.test(u)) return 'LinkedIn';
    if (/^(wa|whatsapp)/.test(u)) return 'WhatsApp';
    if (/^(email|newsletter|mail)/.test(u)) return 'Email';
    if (/^google/.test(u)) return 'Google';
    return u.replace(/[^a-z0-9 _-]/g, '').slice(0, 30) || 'Other';
  }
  let host = '';
  try { host = new URL(String(ref || '')).hostname.toLowerCase().replace(/^www\./, ''); } catch { host = ''; }
  if (!host) return 'Typed in or bookmark';
  if (ownHosts.some(h => h.replace(/^www\./, '') === host)) return '';            // moving around the site itself
  if (/(^|\.)google\./.test(host)) return 'Google';
  if (/(^|\.)(bing|yahoo|duckduckgo)\./.test(host)) return 'Other search';
  if (/(^|\.)(facebook\.com|fb\.com|fb\.me)$/.test(host) || host.startsWith('l.facebook.') || host.startsWith('m.facebook.')) return 'Facebook';
  if (/instagram\.com$/.test(host)) return 'Instagram';
  if (/(linkedin\.com|lnkd\.in)$/.test(host)) return 'LinkedIn';
  if (/(whatsapp\.com|wa\.me)$/.test(host)) return 'WhatsApp';
  if (/(t\.co|twitter\.com|x\.com)$/.test(host)) return 'X (Twitter)';
  if (/youtube\.com$|youtu\.be$/.test(host)) return 'YouTube';
  if (/(mail\.|outlook\.|gmail)/.test(host)) return 'Email';
  return host.slice(0, 40);
}

/** A page address → the key it's counted under ('' = homepage). Register pages count together. */
export function pageKeyOf(slug: string): string {
  const s = String(slug || '').replace(/^\/+|\/+$/g, '').toLowerCase();
  if (!s) return 'home';
  if (s.startsWith('register/')) return 'register';
  return s.replace(/\//g, '~').slice(0, 80);
}
export const pageKeyLabel = (k: string) => k === 'home' ? 'Homepage' : k === 'register' ? 'Register forms' : '/' + k.replace(/~/g, '/');

export const isRobot = (ua: string) => !ua || /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp\/|headless|lighthouse|monitor|curl|wget|python|axios|node-fetch/i.test(ua);

/** Adds up a period's days. */
export function sumDays(days: StatsDay[]): Required<StatsDay> {
  const out: Required<StatsDay> = { views: 0, visits: 0, visitors: 0, pages: {}, sources: {}, campaigns: {}, devices: {}, forms: {} };
  const add = (to: Record<string, number>, from?: Record<string, number>) => Object.entries(from || {}).forEach(([k, v]) => { to[k] = (to[k] || 0) + (Number(v) || 0); });
  for (const d of days) {
    out.views += Number(d.views) || 0;
    out.visits += Number(d.visits) || 0;
    out.visitors += Number(d.visitors) || 0;
    add(out.pages, d.pages); add(out.sources, d.sources); add(out.campaigns, d.campaigns); add(out.devices, d.devices); add(out.forms, d.forms);
  }
  return out;
}

/** "Nov promo 2026" → "nov-promo-2026" (for campaign tags). */
export const campaignTag = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

/** The little script on every public page: counts the page, and puts where the visit came from into the forms. */
export function hitScript(base: string): string {
  return `(function(){try{var b=${JSON.stringify(base)},l=location,p=l.pathname;if(b&&p.indexOf(b)===0)p=p.slice(b.length)||'/';var q=new URLSearchParams(l.search),s=sessionStorage,f=!s.getItem('nw_v');var src={r:document.referrer||'',us:q.get('utm_source')||'',um:q.get('utm_medium')||'',uc:q.get('utm_campaign')||'',l:p};if(f){s.setItem('nw_v','1');s.setItem('nw_src',JSON.stringify(src));}var first=JSON.parse(s.getItem('nw_src')||'{}');var body=JSON.stringify({p:p,r:f?src.r:'',us:f?src.us:'',uc:f?src.uc:'',d:matchMedia('(max-width: 760px)').matches?'phone':'computer',f:f?1:0,t:b?1:0});if(navigator.sendBeacon)navigator.sendBeacon('/api/site/hit',new Blob([body],{type:'application/json'}));else fetch('/api/site/hit',{method:'POST',headers:{'Content-Type':'application/json'},body:body,keepalive:true});document.querySelectorAll('form.nw-form').forEach(function(fm){['r','us','um','uc','l'].forEach(function(k){var i=document.createElement('input');i.type='hidden';i.name='src_'+k;i.value=String(first[k]||'').slice(0,300);fm.appendChild(i);});});}catch(e){}})();`;
}
