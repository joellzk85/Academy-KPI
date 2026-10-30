// Website (Joel, 2026-10-30; docs/features/website.md): the CRM's screen for the public website, full screen.
// Pages (edit, approve, history), Media (photos and videos), Menu and Settings. The owner creates pages, sets the
// menu and settings and publishes; everyone else allowed to edit changes pages' content, which waits for approval.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, setDoc, updateDoc } from 'firebase/firestore';
import { ArrowDown, ArrowUp, ExternalLink, History, Loader2, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import { MEDIA, MENU_DOC, MenuItem, PAGES, PageData, RESERVED_SLUGS, SETTINGS_DOC, SiteMenu, SitePage, SiteSettings, emptyPage, slugify, starterHome } from '../lib/website';
import { ListSort, sortList, usePaged } from '../lib/listPaging';
import ListPager, { SortSelect } from './ListPager';
import { MediaLibrary, uploadFile, useSiteMedia } from './WebsiteMedia';
import { STARTER_MENU, STARTER_PHOTOS, STARTER_VIDEOS, starterPages } from '../lib/websiteStarter';
import { useFormDraft } from '../lib/useFormDraft';
import DraftBar from './DraftBar';
import { refreshSite, useSiteSettings } from '../lib/useWebsite';

const WebsiteEditor = React.lazy(() => import('./WebsiteEditor'));
const WebsiteVisitors = React.lazy(() => import('./WebsiteVisitors'));

type Viewer = { id: string; name: string; role: string };
type Person = { id: string; name: string; role: string; active?: boolean };

const newPageId = () => `pg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const when = (iso?: string) => iso ? new Date(iso).toLocaleString('en-MY', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
const btn = 'inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-sm font-semibold text-ink hover:bg-surface';
const input = 'rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';

function StatusChip({ p }: { p: SitePage }) {
  if (p.status === 'waiting') return <span className="rounded-full bg-attention-soft px-2.5 py-0.5 text-xs font-semibold text-attention">Waiting for approval</span>;
  if (!p.published) return <span className="rounded-full bg-surface px-2.5 py-0.5 text-xs font-semibold text-ink-soft">Not live yet</span>;
  if (p.status === 'draft') return <span className="rounded-full bg-surface px-2.5 py-0.5 text-xs font-semibold text-ink-soft">Live · changes not published</span>;
  return <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-semibold text-accent">Live</span>;
}

function HistoryPanel({ page, onClose, onRestore }: { page: SitePage; onClose: () => void; onRestore: (d: PageData) => void }) {
  const [list, setList] = useState<{ id: string; at: string; byName: string; data: PageData }[] | null>(null);
  useEffect(() => {
    getDocs(query(collection(db, PAGES, page.id, 'versions'), orderBy('at', 'desc'), limit(20)))
      .then(s => setList(s.docs.map(d => ({ id: d.id, ...(d.data() as any) }))))
      .catch(() => setList([]));
  }, [page.id]);
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <div className="mb-2 flex items-center justify-between"><p className="font-semibold text-ink">Published versions of {page.title}</p><button type="button" onClick={onClose} aria-label="Close history" className="rounded p-1 hover:bg-surface"><X className="h-4 w-4" /></button></div>
      {list === null ? <p className="text-sm text-ink-soft">Loading…</p> : list.length === 0 ? <p className="text-sm text-ink-soft">Not published yet.</p> : (
        <ul className="divide-y divide-line">
          {list.map(v => (
            <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span>{when(v.at)} · {v.byName}</span>
              <button type="button" className="font-semibold text-accent hover:underline" onClick={() => onRestore(v.data)}>Put back as the draft</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Website → Pages → "Load the designed pages" (owner): copies the designed photos into Media (once), makes each
 *  designed page or puts the design in an existing page's draft (what's live stays until Publish), and sets the menu
 *  when it is still empty. Safe to run again: photos already in Media are kept. */
async function loadDesignedPages(pages: SitePage[], menu: SiteMenu, me: Viewer, step: (s: string) => void): Promise<string> {
  const now = () => new Date().toISOString();
  for (const [i, ph] of STARTER_PHOTOS.entries()) {
    if ((await getDoc(doc(db, MEDIA, ph.id))).exists()) continue;
    step(`Copying photos into Media… ${i + 1} of ${STARTER_PHOTOS.length}`);
    const blob = await (await fetch(`/site-assets/starter/${ph.file}`)).blob();
    const rec = await uploadFile(new File([blob], ph.file, { type: 'image/jpeg' }), ph.id, me, () => {});
    await setDoc(doc(db, MEDIA, ph.id), { ...rec, name: ph.name, folder: ph.folder, alt: ph.alt, tags: ph.tags, ...(ph.focusX !== undefined ? { focusX: ph.focusX } : {}) });
  }
  for (const v of STARTER_VIDEOS) {
    if ((await getDoc(doc(db, MEDIA, v.id))).exists()) continue;
    await setDoc(doc(db, MEDIA, v.id), { kind: 'youtube', youtubeId: v.youtubeId, url: `https://www.youtube.com/watch?v=${v.youtubeId}`, name: v.name, folder: 'Videos', alt: `Client testimonial: ${v.name}`, tags: ['testimonial'], createdBy: me.id, createdByName: me.name, createdAt: now() });
  }
  step('Making the pages…');
  const ids: Record<string, string> = {};
  let made = 0, updated = 0;
  for (const sp of starterPages()) {
    const found = pages.find(p => p.slug === sp.slug && !(p as any).deleted);
    if (found) {
      await updateDoc(doc(db, PAGES, found.id), { draft: sp.data, status: 'draft', note: '', draftBy: me.id, draftByName: me.name, draftAt: now() });
      ids[sp.slug] = found.id; updated++;
    } else {
      const id = newPageId();
      await setDoc(doc(db, PAGES, id), { title: sp.title, slug: sp.slug, draft: sp.data, published: null, status: 'draft', createdAt: now(), draftBy: me.id, draftByName: me.name, draftAt: now() });
      ids[sp.slug] = id; made++;
    }
  }
  let menuNote = ' The menu was left as it is.';
  if (!(menu.items || []).length) {
    await setDoc(doc(db, 'config', MENU_DOC), { items: STARTER_MENU.map(({ slug, ...it }) => slug !== undefined ? { label: it.label, pageId: ids[slug], button: !!it.button } : { label: it.label, url: it.url, button: !!it.button }) });
    menuNote = ' The menu is set.';
  }
  return `Done: ${made} new page${made === 1 ? '' : 's'}, ${updated} page${updated === 1 ? '' : 's'} with the design in the draft.${menuNote} Check each page, then Publish.`;
}

function PagesTab({ pages, menu, me, owner, onEdit }: { pages: SitePage[]; menu: SiteMenu; me: Viewer; owner: boolean; onEdit: (id: string) => void }) {
  const [loading, setLoading] = useState('');
  const [loaded, setLoaded] = useState('');
  const [sort, setSort] = useState<ListSort>('az');
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ title: '', slug: '' });
  const draft = useFormDraft(me.id, adding ? 'site-page:new' : null, f, setF);
  const [historyOf, setHistoryOf] = useState('');
  const [renaming, setRenaming] = useState<null | { id: string; title: string; slug: string }>(null);
  const [error, setError] = useState('');
  const top = useRef<HTMLDivElement>(null);
  const live = pages.filter(p => !(p as any).deleted);
  const deleted = pages.filter(p => (p as any).deleted);
  // Waiting pages first, then the chosen order; the homepage leads A to Z.
  const sorted = useMemo(() => {
    const s = sortList(live, sort, p => (p.slug === '' ? ' ' : '') + p.title, p => p.createdAt);
    return [...s.filter(p => p.status === 'waiting'), ...s.filter(p => p.status !== 'waiting')];
  }, [live, sort]);
  const paged = usePaged(sorted, [sort]);

  const slugProblem = (slug: string, id?: string) =>
    RESERVED_SLUGS.includes(slug) ? `"/${slug}" is used by the CRM itself. Pick another address.`
      : pages.some(p => p.slug === slug && p.id !== id && !(p as any).deleted) ? `Another page already uses /${slug}.` : '';

  const create = async (title: string, slug: string, data: PageData) => {
    const problem = slugProblem(slug);
    if (problem) { setError(problem); return; }
    const id = newPageId();
    try {
      await setDoc(doc(db, PAGES, id), { title, slug, draft: data, published: null, status: 'draft', createdAt: new Date().toISOString(), draftBy: me.id, draftByName: me.name, draftAt: new Date().toISOString() });
      draft.discard(); setAdding(false); setF({ title: '', slug: '' }); setError('');
      onEdit(id);
    } catch (e) { setError(friendlyError(e)); }
  };

  const rename = async () => {
    if (!renaming) return;
    const slug = renaming.slug === '' ? '' : slugify(renaming.slug);
    const problem = slugProblem(slug, renaming.id);
    if (problem) { setError(problem); return; }
    try { await updateDoc(doc(db, PAGES, renaming.id), { title: renaming.title.trim() || 'Page', slug }); setRenaming(null); setError(''); } catch (e) { setError(friendlyError(e)); }
  };

  const setDeleted = async (p: SitePage, on: boolean) => {
    if (on && !window.confirm(`Take "${p.title}" off the website? It is kept and can be put back.`)) return;
    try { await updateDoc(doc(db, PAGES, p.id), { deleted: on }); } catch (e) { setError(friendlyError(e)); }
  };

  const loadDesign = async () => {
    const existing = live.filter(p => starterPages().some(sp => sp.slug === p.slug));
    if (!window.confirm(`Load the designed website? ${existing.length ? `${existing.map(p => p.title).join(', ')} already exist: their draft is replaced by the design (what's live stays until you Publish; History keeps every published version). ` : ''}New pages are made for the rest, and the photos are copied into Media.`)) return;
    setError(''); setLoaded('');
    try { setLoaded(await loadDesignedPages(pages, menu, me, setLoading)); } catch (e) { setError(e instanceof Error && !(e as any).code ? e.message : friendlyError(e)); }
    setLoading('');
  };

  const restore = async (p: SitePage, d: PageData) => {
    try { await updateDoc(doc(db, PAGES, p.id), { draft: d, status: 'draft' }); setHistoryOf(''); onEdit(p.id); } catch (e) { setError(friendlyError(e)); }
  };

  return (
    <div ref={top} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <SortSelect value={sort} onChange={setSort} />
        <div className="ml-auto flex flex-wrap gap-2">
          <a href="/site" target="_blank" rel="noopener" className={btn}><ExternalLink className="h-4 w-4" /> Open the test site</a>
          {owner && <button type="button" onClick={loadDesign} disabled={!!loading} className={btn}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} {loading || 'Load the designed pages'}</button>}
          {owner && <button type="button" onClick={() => setAdding(v => !v)} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:opacity-90"><Plus className="h-4 w-4" /> New page</button>}
        </div>
      </div>

      {owner && live.length === 0 && (
        <div className="rounded-xl border border-line bg-white p-5">
          <p className="font-semibold text-ink">No pages yet.</p>
          <p className="mt-1 text-sm text-ink-soft">Load the designed website above (homepage, About us, both programme pages, Contact us, Careers and the privacy notice, with copy and photos), start with the homepage from the mock-up, or make an empty page.</p>
          <button type="button" onClick={() => create('Home', '', starterHome())} className="mt-3 min-h-10 rounded-lg bg-accent px-4 text-sm font-semibold text-white">Start with the homepage</button>
        </div>
      )}

      {adding && owner && (
        <div className="flex flex-col gap-3 rounded-xl border border-line bg-white p-4">
          <DraftBar draft={draft} what="new page" />
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-[14rem] flex-1 flex-col gap-1 text-sm font-semibold text-ink">Page name
              <input className={input} value={f.title} onChange={e => setF({ title: e.target.value, slug: f.slug && f.slug !== slugify(f.title) ? f.slug : slugify(e.target.value) })} placeholder="e.g. Training calendar" />
            </label>
            <label className="flex min-w-[14rem] flex-1 flex-col gap-1 text-sm font-semibold text-ink">Address
              <span className="flex items-center gap-1 font-normal"><span className="text-ink-soft">/</span><input className={`${input} flex-1`} value={f.slug} onChange={e => setF(v => ({ ...v, slug: slugify(e.target.value) }))} placeholder="training-calendar" /></span>
            </label>
            <button type="button" disabled={!f.title.trim() || !f.slug} onClick={() => create(f.title.trim(), f.slug, emptyPage(f.title.trim()))} className="min-h-10 rounded-lg bg-accent px-4 text-sm font-semibold text-white disabled:opacity-50">Make the page</button>
            <button type="button" onClick={() => setAdding(false)} className={btn}>Cancel</button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {loaded && <p role="status" className="rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">{loaded}</p>}

      <div className="overflow-hidden rounded-xl border border-line bg-white">
        {paged.pageItems.map(p => (
          <div key={p.id} className={`flex flex-col gap-2 border-b border-line px-4 py-3 last:border-b-0 ${p.status === 'waiting' ? 'bg-attention-soft/40' : ''}`}>
            {renaming?.id === p.id ? (
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-1 flex-col gap-1 text-sm font-semibold">Page name<input className={input} value={renaming.title} onChange={e => setRenaming({ ...renaming, title: e.target.value })} /></label>
                {p.slug !== '' && <label className="flex flex-1 flex-col gap-1 text-sm font-semibold">Address<input className={input} value={renaming.slug} onChange={e => setRenaming({ ...renaming, slug: e.target.value })} /></label>}
                <button type="button" onClick={rename} className="min-h-10 rounded-lg bg-accent px-4 text-sm font-semibold text-white">Save</button>
                <button type="button" onClick={() => setRenaming(null)} className={btn}>Cancel</button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink">{p.title} <span className="font-normal text-ink-soft">{p.slug === '' ? '· Homepage' : `· /${p.slug}`}</span></p>
                  <p className="text-xs text-ink-soft">{p.status === 'waiting' ? `Changed by ${p.draftByName || 'someone'} · ${when(p.draftAt)}` : p.publishedAt ? `Published ${when(p.publishedAt)} by ${p.publishedByName}` : `Made ${when(p.createdAt)}`}</p>
                  {p.note && p.status !== 'waiting' && <p className="text-xs text-attention">Sent back: {p.note}</p>}
                </div>
                <StatusChip p={p} />
                <button type="button" onClick={() => onEdit(p.id)} className="min-h-10 rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:opacity-90">{owner && p.status === 'waiting' ? 'Check and approve' : 'Edit'}</button>
                {p.published && <a href={`/site/${p.slug}`} target="_blank" rel="noopener" className={btn} aria-label={`See ${p.title} on the test site`}><ExternalLink className="h-4 w-4" /></a>}
                {owner && <>
                  <button type="button" onClick={() => setRenaming({ id: p.id, title: p.title, slug: p.slug })} className={btn}>Rename</button>
                  <button type="button" onClick={() => setHistoryOf(historyOf === p.id ? '' : p.id)} className={btn} aria-label="Published versions"><History className="h-4 w-4" /></button>
                  <button type="button" onClick={() => setDeleted(p, true)} className={`${btn} text-danger`} aria-label={`Take ${p.title} off the website`}><Trash2 className="h-4 w-4" /></button>
                </>}
              </div>
            )}
            {historyOf === p.id && <HistoryPanel page={p} onClose={() => setHistoryOf('')} onRestore={d => restore(p, d)} />}
          </div>
        ))}
        {live.length === 0 && !owner && <p className="px-4 py-6 text-center text-ink-soft">No pages yet.</p>}
      </div>
      <ListPager paged={paged} noun="pages" top={top} />

      {owner && deleted.length > 0 && (
        <details className="rounded-xl border border-line bg-white p-4 text-sm">
          <summary className="cursor-pointer font-semibold text-ink">Pages taken off the website ({deleted.length})</summary>
          <ul className="mt-2 divide-y divide-line">
            {deleted.map(p => <li key={p.id} className="flex items-center justify-between py-2"><span>{p.title} · /{p.slug}</span><button type="button" onClick={() => setDeleted(p, false)} className="font-semibold text-accent hover:underline">Put back</button></li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

function MenuTab({ menu, pages, owner, me }: { menu: SiteMenu; pages: SitePage[]; owner: boolean; me: Viewer }) {
  const [items, setItems] = useState<MenuItem[]>(menu.items || []);
  const draft = useFormDraft(me.id, owner ? 'site-menu' : null, items, setItems);
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState('');
  useEffect(() => { setItems(menu.items || []); }, [JSON.stringify(menu.items || [])]);   // eslint-disable-line react-hooks/exhaustive-deps
  const live = pages.filter(p => !(p as any).deleted);
  const set = (i: number, patch: Partial<MenuItem>) => setItems(list => list.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const move = (i: number, d: -1 | 1) => setItems(list => { const l = [...list]; const j = i + d; if (j < 0 || j >= l.length) return l; [l[i], l[j]] = [l[j], l[i]]; return l; });
  const save = async () => {
    setState('saving'); setError('');
    try {
      await setDoc(doc(db, 'config', MENU_DOC), { items: items.map(it => ({ label: it.label.trim(), ...(it.pageId ? { pageId: it.pageId } : { url: (it.url || '').trim() }), button: !!it.button })) });
      draft.discard(); setState('saved'); refreshSite();
    } catch (e) { setError(friendlyError(e)); setState('idle'); }
  };
  if (!owner) {
    return <div className="rounded-xl border border-line bg-white p-4 text-sm"><p className="mb-2 text-ink-soft">The website's menu:</p>{(menu.items || []).map((it, i) => <p key={i} className="py-1 text-ink">{it.label}</p>)}</div>;
  }
  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <DraftBar draft={draft} what="change to the menu" />
      <p className="text-sm text-ink-soft">The menu at the top of every page (and in the footer). Tick "Button" for the one that stands out, like "Talk to us". A page shows in the menu once it's live.</p>
      {items.map((it, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2 rounded-xl border border-line bg-white p-3">
          <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-sm font-semibold">Words<input className={input} value={it.label} onChange={e => set(i, { label: e.target.value })} /></label>
          <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-sm font-semibold">Goes to
            <select className={input} value={it.pageId || '__url'} onChange={e => set(i, e.target.value === '__url' ? { pageId: undefined, url: it.url || '' } : { pageId: e.target.value, url: undefined })}>
              {live.map(p => <option key={p.id} value={p.id}>{p.title}{p.slug ? ` (/${p.slug})` : ' (Homepage)'}</option>)}
              <option value="__url">A section or web address…</option>
            </select>
          </label>
          {!it.pageId && <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-sm font-semibold">Address<input className={input} value={it.url || ''} placeholder="#contact or https://…" onChange={e => set(i, { url: e.target.value })} /></label>}
          <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={!!it.button} onChange={e => set(i, { button: e.target.checked })} /> Button</label>
          <button type="button" onClick={() => move(i, -1)} className={btn} aria-label="Move up"><ArrowUp className="h-4 w-4" /></button>
          <button type="button" onClick={() => move(i, 1)} className={btn} aria-label="Move down"><ArrowDown className="h-4 w-4" /></button>
          <button type="button" onClick={() => setItems(l => l.filter((_, j) => j !== i))} className={`${btn} text-danger`} aria-label="Remove"><Trash2 className="h-4 w-4" /></button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setItems(l => [...l, { label: '', pageId: live[0]?.id }])} className={btn}><Plus className="h-4 w-4" /> Add to the menu</button>
        <button type="button" onClick={save} disabled={state === 'saving' || items.some(it => !it.label.trim())} className="min-h-10 rounded-lg bg-accent px-4 text-sm font-semibold text-white disabled:opacity-50">{state === 'saving' ? 'Saving…' : 'Save the menu'}</button>
        {state === 'saved' && <span className="text-sm text-accent">Saved. It shows on the website now.</span>}
      </div>
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
    </div>
  );
}

function SettingsTab({ settings, people, me }: { settings: SiteSettings; people: Person[]; me: Viewer }) {
  const blank = { editors: [] as string[], tagline: '', facebook: '', instagram: '', linkedin: '', whatsapp: '', domains: '' };
  const fromSettings = () => ({ ...blank, ...settings, editors: settings.editors || [], domains: (settings.domains || []).join('\n') });
  const [f, setF] = useState(fromSettings);
  const draft = useFormDraft(me.id, 'site-settings', f, setF);
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState('');
  const others = people.filter(p => p.active !== false && p.role !== 'admin' && p.role !== 'management');
  const save = async () => {
    setState('saving'); setError('');
    try {
      await setDoc(doc(db, 'config', SETTINGS_DOC), {
        editors: f.editors, tagline: f.tagline.trim(), facebook: f.facebook.trim(), instagram: f.instagram.trim(), linkedin: f.linkedin.trim(),
        whatsapp: f.whatsapp.replace(/[^0-9]/g, ''),
        domains: f.domains.split(/[\s,]+/).map(d => d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean),
      });
      draft.discard(); setState('saved'); refreshSite();
    } catch (e) { setError(friendlyError(e)); setState('idle'); }
  };
  const field = (key: 'tagline' | 'facebook' | 'instagram' | 'linkedin' | 'whatsapp', label: string, ph = '') => (
    <label className="flex flex-col gap-1 text-sm font-semibold text-ink">{label}<input className={input} value={f[key]} placeholder={ph} onChange={e => setF(v => ({ ...v, [key]: e.target.value }))} /></label>
  );
  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <DraftBar draft={draft} what="change to the website settings" />
      <section className="rounded-xl border border-line bg-white p-4">
        <h3 className="font-semibold text-ink">Who can edit the website</h3>
        <p className="mt-1 text-sm text-ink-soft">Admin and Management can always edit. Tick anyone else. Their changes wait for approval before they go live.</p>
        <div className="mt-3 grid gap-1 sm:grid-cols-2">
          {others.map(p => (
            <label key={p.id} className="flex min-h-10 items-center gap-2 text-sm">
              <input type="checkbox" checked={f.editors.includes(p.id)} onChange={e => setF(v => ({ ...v, editors: e.target.checked ? [...v.editors, p.id] : v.editors.filter(x => x !== p.id) }))} /> {p.name}
            </label>
          ))}
          {others.length === 0 && <p className="text-sm text-ink-soft">Everyone else is Admin or Management already.</p>}
        </div>
      </section>
      <section className="flex flex-col gap-3 rounded-xl border border-line bg-white p-4">
        <h3 className="font-semibold text-ink">Footer and contact</h3>
        <p className="text-sm text-ink-soft">The address, phone and email come from the company details the CRM already uses.</p>
        {field('tagline', 'Line under the logo', 'Shaping leaders for a sustainable tomorrow.')}
        {field('whatsapp', 'WhatsApp number', '60183634888')}
        {field('facebook', 'Facebook page', 'https://facebook.com/…')}
        {field('instagram', 'Instagram', 'https://instagram.com/…')}
        {field('linkedin', 'LinkedIn', 'https://linkedin.com/company/…')}
      </section>
      <section className="flex flex-col gap-2 rounded-xl border border-line bg-white p-4">
        <h3 className="font-semibold text-ink">The website's own addresses</h3>
        <p className="text-sm text-ink-soft">Leave empty until you're ready to switch from WordPress. Then add both, one per line: nextacademy.my and www.nextacademy.my. Until then the website is only at the test address.</p>
        <textarea rows={2} className={input} value={f.domains} onChange={e => setF(v => ({ ...v, domains: e.target.value }))} placeholder={'nextacademy.my\nwww.nextacademy.my'} />
      </section>
      <div className="flex items-center gap-2">
        <button type="button" onClick={save} disabled={state === 'saving'} className="min-h-10 rounded-lg bg-accent px-4 text-sm font-semibold text-white disabled:opacity-50">{state === 'saving' ? 'Saving…' : 'Save settings'}</button>
        {state === 'saved' && <span className="text-sm text-accent">Saved.</span>}
      </div>
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
    </div>
  );
}

export default function WebsiteStudio({ me, owner, people, onClose }: { me: Viewer; owner: boolean; people: Person[]; onClose: () => void }) {
  const [tab, setTab] = useState<'pages' | 'media' | 'menu' | 'visitors' | 'settings'>('pages');
  const [editId, setEditId] = useState('');
  const [pages, setPages] = useState<SitePage[] | null>(null);
  const [menu, setMenu] = useState<SiteMenu>({ items: [] });
  const settings = useSiteSettings();
  const media = useSiteMedia();
  const [error, setError] = useState('');

  useEffect(() => onSnapshot(collection(db, PAGES), s => setPages(s.docs.map(d => ({ id: d.id, ...(d.data() as any) }))), e => { setError(friendlyError(e)); setPages([]); }), []);
  useEffect(() => onSnapshot(doc(db, 'config', MENU_DOC), s => setMenu((s.data() as SiteMenu) || { items: [] }), () => { /* no menu yet */ }), []);
  // Escape closes the Website screen (not while editing a page: the editor has its own Back).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !editId && !document.querySelector('[aria-modal="true"]')) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editId, onClose]);

  const editing = editId && pages ? pages.find(p => p.id === editId) : null;
  const tabs = ([['pages', 'Pages'], ['media', 'Media'], ['menu', 'Menu'], ...(me.role === 'management' ? [['visitors', 'Visitors']] : []), ...(owner ? [['settings', 'Settings']] : [])] as [typeof tab, string][]);

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-surface font-sans text-ink" role="dialog" aria-label="Website">
      {editing && media && settings ? (
        <React.Suspense fallback={<p className="flex items-center gap-2 p-6 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Opening the editor…</p>}>
          <WebsiteEditor key={editing.id} page={editing} me={me} owner={owner} pages={pages || []} media={media} menu={menu} settings={settings} onBack={() => setEditId('')} />
        </React.Suspense>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-white px-4 py-2.5">
            <span className="mr-3 text-base font-bold">Website</span>
            <div role="tablist" className="flex flex-wrap gap-1">
              {tabs.map(([k, label]) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                  className={`min-h-10 rounded-lg px-4 text-sm font-semibold ${tab === k ? 'bg-accent text-white' : 'text-ink-soft hover:text-ink'}`}>{label}</button>
              ))}
            </div>
            <button type="button" onClick={onClose} className="ml-auto inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-ink-soft hover:bg-surface hover:text-ink"><X className="h-4 w-4" /> Close</button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
            {error && <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
            {pages === null || settings === null ? <p className="flex items-center gap-2 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
              : tab === 'pages' ? <PagesTab pages={pages} menu={menu} me={me} owner={owner} onEdit={setEditId} />
              : tab === 'media' ? <div className="flex min-h-[70vh] flex-col"><MediaLibrary me={me} owner={owner} pages={pages} /></div>
              : tab === 'menu' ? <MenuTab menu={menu} pages={pages} owner={owner} me={me} />
              : tab === 'visitors' && me.role === 'management' ? <React.Suspense fallback={<p className="flex items-center gap-2 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}><WebsiteVisitors settings={settings} pages={pages} /></React.Suspense>
              : owner ? <SettingsTab settings={settings} people={people} me={me} /> : null}
          </div>
        </>
      )}
    </div>
  );
}
