// Website → Pages → Edit (Joel, 2026-10-30): the drag-and-drop page editor. It saves a draft by itself
// (useAutoSave); visitors keep seeing the published page until it's published.
// - The owner builds pages: add, drag, resize columns, delete blocks, and Publish.
// - Everyone else allowed to edit changes the words, photos and settings of the blocks already there, then
//   "Ask to publish": the change waits for approval (never named on screen who approves).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Puck, useGetPuck } from '@puckeditor/core';
import '@puckeditor/core/puck.css';
import { addDoc, collection, doc, updateDoc } from 'firebase/firestore';
import { ArrowLeft, CheckCircle2, Clock, ImageIcon, Loader2, Send, Undo2 } from 'lucide-react';
import { callServer, db, friendlyError } from '../lib/firebase';
import { SiteData } from '../lib/websiteData';
import { refreshSite } from '../lib/useWebsite';
import { useAutoSave } from '../lib/useAutoSave';
import { PAGES, PageData, SITE_CSS, SiteMedia, SiteMenu, SitePage, SiteSettings, emptyPage } from '../lib/website';
import { SiteProvider, SiteLink, makeSiteConfig } from '../website/blocks';
import { MediaPickerDialog } from './WebsiteMedia';

type Viewer = { id: string; name: string; role: string };

const clean = (d: PageData): PageData => JSON.parse(JSON.stringify(d));   // the database refuses empty (undefined) values

/** Publishes a page's draft: visitors see it, and a copy goes into the page's history. */
export async function publishPage(page: SitePage, data: PageData, me: Viewer) {
  const at = new Date().toISOString();
  const d = clean(data);
  await addDoc(collection(db, PAGES, page.id, 'versions'), { data: d, at, byName: me.name, by: me.id });
  await updateDoc(doc(db, PAGES, page.id), { published: d, publishedAt: at, publishedByName: me.name, draft: d, status: 'live', note: '' });
  refreshSite();
}

function MediaBox({ value, onChange, kind, label, media, open }: { value: string; onChange: (v: string) => void; kind: 'image' | 'video'; label: string; media: Record<string, SiteMedia>; open: (kind: 'image' | 'video', done: (m: SiteMedia) => void) => void }) {
  const m = media[value || ''];
  const thumb = m?.kind === 'image' ? m.url : m?.kind === 'youtube' ? `https://i.ytimg.com/vi/${m.youtubeId}/mqdefault.jpg` : '';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 14, fontWeight: 600 }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 72, height: 48, borderRadius: 6, background: '#F5F6F3', border: '1px solid #E2E5DE', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {thumb ? <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <ImageIcon size={18} color="#4A5872" />}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <span style={{ fontSize: 13, color: '#4A5872', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m ? m.name : 'None picked'}</span>
          <span style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => open(kind, picked => onChange(picked.id))} style={{ fontSize: 13, fontWeight: 600, color: '#0E6E62', background: 'none', border: 0, padding: 0, cursor: 'pointer' }}>{m ? 'Change' : 'Pick from Media'}</button>
            {m && <button type="button" onClick={() => onChange('')} style={{ fontSize: 13, color: '#B42318', background: 'none', border: 0, padding: 0, cursor: 'pointer' }}>Remove</button>}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Lets the column handle on the page change the block's widths (it lives inside the editor). */
function GetPuckBridge({ into }: { into: React.MutableRefObject<null | (() => any)> }) {
  into.current = useGetPuck();
  return null;
}

export default function WebsiteEditor({ page, me, owner, pages, media, menu, settings, onBack }: {
  page: SitePage;
  me: Viewer;
  owner: boolean;
  pages: SitePage[];
  media: SiteMedia[];
  menu: SiteMenu;
  settings: SiteSettings;
  onBack: () => void;
}) {
  const start = useMemo(() => clean(page.draft || page.published || emptyPage(page.title)), [page.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const [data, setData] = useState<PageData>(start);
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(start));
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [picker, setPicker] = useState<null | { kind: 'image' | 'video'; done: (m: SiteMedia) => void }>(null);
  const getPuck = useRef<null | (() => any)>(null);

  const waiting = page.status === 'waiting';
  const live = page.status === 'live' || (!page.status && !!page.published);
  const dirty = JSON.stringify(data) !== savedJson;

  const save = useAutoSave<PageData>({
    value: data,
    dirty,
    enabled: true,
    write: v => updateDoc(doc(db, PAGES, page.id), {
      draft: clean(v), draftBy: me.id, draftByName: me.name, draftAt: new Date().toISOString(),
      status: waiting ? 'waiting' : 'draft',
    }),
    onSaved: setSavedJson,
  });

  const mediaById = useMemo(() => Object.fromEntries(media.map(m => [m.id, m])), [media]);
  const openPicker = useCallback((kind: 'image' | 'video', done: (m: SiteMedia) => void) => setPicker({ kind, done }), []);
  const mediaRef = useRef(mediaById);
  mediaRef.current = mediaById;
  // The block settings are made once; the photo boxes read the latest media through mediaRef.
  const config = useMemo(() => makeSiteConfig((label, kind) => ({
    type: 'custom',
    label,
    render: ({ value, onChange }: any) => <MediaBox value={value} onChange={onChange} kind={kind} label={label} media={mediaRef.current} open={openPicker} />,
  } as any)), [openPicker]);

  const links: SiteLink[] = useMemo(() => (menu.items || []).map(i => ({ label: i.label, href: '#', button: i.button })), [menu]);

  const onResizeColumns = useCallback((id: string, split: number) => {
    const p = getPuck.current?.();
    if (!p) return;
    const sel = p.getSelectorForId(id);
    const item = p.getItemById(id);
    if (!sel || !item) return;
    p.dispatch({ type: 'replace', destinationIndex: sel.index, destinationZone: sel.zone, data: { ...item, props: { ...item.props, split } } });
  }, []);

  // The calendar, programmes and trainers exactly as the website shows them (the server works them out).
  const [siteData, setSiteData] = useState<SiteData | undefined>(undefined);
  useEffect(() => { callServer<{ data: SiteData }>('/api/site/data', {}, true).then(r => setSiteData(r.data)).catch(() => setSiteData(undefined)); }, []);

  const ctx = useMemo(() => ({ media: mediaById, menu: links, settings, data: siteData, editing: true, inlineCss: SITE_CSS, onResizeColumns }), [mediaById, links, settings, siteData, onResizeColumns]);

  const leave = async () => { if (await save.flush()) onBack(); };

  const askToPublish = async () => {
    setError('');
    setBusy('Sending…');
    try {
      await save.flush();
      await updateDoc(doc(db, PAGES, page.id), { draft: clean(data), draftBy: me.id, draftByName: me.name, draftAt: new Date().toISOString(), status: 'waiting', note: '' });
    } catch (e) { setError(friendlyError(e)); }
    setBusy('');
  };

  const publish = async () => {
    setError('');
    setBusy('Publishing…');
    try {
      await save.flush();
      await publishPage(page, data, me);
      setSavedJson(JSON.stringify(clean(data)));
    } catch (e) { setError(friendlyError(e)); }
    setBusy('');
  };

  const sendBack = async () => {
    const note = window.prompt('What should be changed? (shown to whoever made the change)');
    if (note === null) return;
    try { await updateDoc(doc(db, PAGES, page.id), { status: 'draft', note: note.trim() }); } catch (e) { setError(friendlyError(e)); }
  };

  const undoChanges = async () => {
    if (!page.published) return;
    if (!window.confirm('Throw away the changes and go back to what visitors see now?')) return;
    try {
      const d = clean(page.published);
      await updateDoc(doc(db, PAGES, page.id), { draft: d, status: 'live', note: '' });
      setData(d);
      setSavedJson(JSON.stringify(d));
      getPuck.current?.()?.dispatch({ type: 'setData', data: d });
    } catch (e) { setError(friendlyError(e)); }
  };

  const statusPill = waiting
    ? <span className="inline-flex items-center gap-1.5 rounded-full bg-attention-soft px-3 py-1 text-xs font-semibold text-attention"><Clock className="h-3.5 w-3.5" /> Waiting for approval</span>
    : dirty || save.state.status === 'saving' ? <span className="rounded-full bg-surface px-3 py-1 text-xs text-ink-soft">Saving draft…</span>
    : page.status === 'draft' ? <span className="rounded-full bg-surface px-3 py-1 text-xs text-ink-soft">Draft saved · not live yet</span>
    : <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent"><CheckCircle2 className="h-3.5 w-3.5" /> Live</span>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-white px-4 py-2.5">
        <button type="button" onClick={leave} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-accent hover:bg-surface"><ArrowLeft className="h-4 w-4" /> Pages</button>
        <span className="font-semibold text-ink">{page.title}</span>
        <span className="text-sm text-ink-soft">/{page.slug}</span>
        {statusPill}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {busy && <span className="inline-flex items-center gap-1.5 text-sm text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> {busy}</span>}
          {page.published && page.status !== 'live' && <button type="button" onClick={undoChanges} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-line px-3 text-sm font-semibold text-ink hover:bg-surface"><Undo2 className="h-4 w-4" /> Undo all changes</button>}
          {live && <a href={`/site/${page.slug}`} target="_blank" rel="noopener" className="inline-flex min-h-10 items-center rounded-lg border border-line px-3 text-sm font-semibold text-ink hover:bg-surface">See it on the test site</a>}
          {owner ? (
            <>
              {waiting && <button type="button" onClick={sendBack} className="min-h-10 rounded-lg border border-line px-3 text-sm font-semibold text-ink hover:bg-surface">Send back</button>}
              <button type="button" onClick={publish} disabled={!!busy} className="min-h-10 rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60">{waiting ? 'Approve and publish' : 'Publish'}</button>
            </>
          ) : (
            <button type="button" onClick={askToPublish} disabled={!!busy || (waiting && !dirty)} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"><Send className="h-4 w-4" /> {waiting ? 'Asked to publish' : 'Ask to publish'}</button>
          )}
        </div>
      </div>
      {(waiting && owner && page.draftByName) && <p className="border-b border-line bg-attention-soft px-4 py-2 text-sm text-attention">{page.draftByName} changed this page{page.draftAt ? ` on ${new Date(page.draftAt).toLocaleString('en-MY', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : ''}. Check the page, then approve and publish, or send it back with a note.</p>}
      {page.note && !waiting && <p className="border-b border-line bg-attention-soft px-4 py-2 text-sm text-attention">Sent back: {page.note}</p>}
      {!owner && <p className="border-b border-line bg-surface px-4 py-2 text-sm text-ink-soft">Click any text on the page to type over it, or click a block to change its photo and settings on the right.</p>}
      {error && <p role="alert" className="border-b border-line bg-danger-soft px-4 py-2 text-sm text-danger">{error}</p>}

      <div className="min-h-0 flex-1">
        <SiteProvider value={ctx}>
          <Puck
            config={config}
            data={start as any}
            onChange={(d: any) => setData(d)}
            headerTitle={page.title}
            permissions={owner ? undefined : { drag: false, duplicate: false, delete: false, insert: false }}
            ui={owner ? undefined : { leftSideBarVisible: false }}
            viewports={[{ width: 390, label: 'Phone' }, { width: 820, label: 'Tablet' }, { width: 1280, label: 'Computer' }]}
            overrides={{
              // Our own Publish / Ask to publish buttons sit above the editor, so the kit's own Publish button goes.
              headerActions: () => <GetPuckBridge into={getPuck} />,
            }}
          />
        </SiteProvider>
      </div>

      {picker && (
        <MediaPickerDialog me={me} owner={owner} pages={pages} kind={picker.kind}
          onPick={m => { picker.done(m); setPicker(null); }} onClose={() => setPicker(null)} />
      )}
    </div>
  );
}
