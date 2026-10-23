import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { Loader2, Search, X } from 'lucide-react';
import { db } from '../lib/firebase';
import { linkedOnly, withoutDeleted } from '../lib/linked';
import { STAGE_LABELS, dealOwnerId, dealStage } from '../lib/deals';
import { vendorName, vendorTypeLabel } from '../lib/vendors';
import { useCloseOnOutside } from '../lib/useCloseOnOutside';
import { approvalCodeOf } from '../lib/checklist';

// Global search (2026-10-21): one box in the top bar (or Ctrl+K / "/") finds clients, deals, quotations,
// course outlines, teambuilding proposals, trainers, venues and (Admin, Management) vendors.
// Data is read only while the box is open. Each person finds only what their own screens already show them.

export type SearchKind = 'client' | 'deal' | 'quotation' | 'outline' | 'teambuilding' | 'trainer' | 'venue' | 'vendor';
export interface SearchHit { kind: SearchKind; id: string; title: string; sub: string; record: any }

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };

const GROUPS: [SearchKind, string][] = [
  ['client', 'Clients'], ['deal', 'Deals'], ['quotation', 'Quotations'], ['outline', 'Course outlines'],
  ['teambuilding', 'Teambuilding proposals'], ['trainer', 'Trainers'], ['venue', 'Venues'], ['vendor', 'Vendors'],
];
const KIND_LABEL: Record<SearchKind, string> = {
  client: 'Client', deal: 'Deal', quotation: 'Quotation', outline: 'Outline', teambuilding: 'Teambuilding',
  trainer: 'Trainer', venue: 'Venue', vendor: 'Vendor',
};
const PER_GROUP = 8;

// ---- Prefill a screen's own search box (trainers, venues, vendors can't open one record directly) ----
const PREFILL_EVENT = 'crm-search-prefill';
const prefillKey = (screen: string) => `search_prefill_${screen}`;
export function setSearchPrefill(screen: string, text: string) {
  try { sessionStorage.setItem(prefillKey(screen), text); } catch { /* private window */ }
  window.dispatchEvent(new CustomEvent(PREFILL_EVENT, { detail: { screen, text } }));
}
export function useSearchPrefill(screen: string, apply: (text: string) => void) {
  useEffect(() => {
    const take = () => {
      try {
        const t = sessionStorage.getItem(prefillKey(screen));
        if (t !== null) { sessionStorage.removeItem(prefillKey(screen)); apply(t); }
      } catch { /* ignore */ }
    };
    take();
    const on = (e: Event) => { if ((e as CustomEvent).detail?.screen === screen) take(); };
    window.addEventListener(PREFILL_EVENT, on);
    return () => window.removeEventListener(PREFILL_EVENT, on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);
}

const norm = (v: unknown) => String(v ?? '').toLowerCase();
const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');

function matcher(query: string) {
  const words = norm(query).trim().split(/\s+/).filter(Boolean);
  const phone = /^[\d\s+\-()]+$/.test(query.trim()) ? digits(query) : '';
  return (fields: unknown[]) => {
    const hay = fields.map(norm).join(' ');
    if (words.length && words.every(w => hay.includes(w))) return true;
    return phone.length >= 3 && fields.some(f => digits(f).includes(phone));
  };
}

export default function GlobalSearch({ viewer, people, deals, quotations, outlines, onOpen }: {
  viewer: Viewer;
  people: { id: string; name: string }[];
  deals: any[];          // App's live deals (already linkedOnly)
  quotations: any[];     // App's live quotations (already linkedOnly)
  outlines: any[];       // App's live course outlines (already linkedOnly)
  onOpen: (hit: SearchHit) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<{ clients: any[]; tbs: any[]; trainers: any[]; venues: any[]; vendors: any[]; programmes: any[]; codes: Map<string, string> }>({ clients: [], tbs: [], trainers: [], venues: [], vendors: [], programmes: [], codes: new Map() });
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const staff = viewer.role !== 'rep';

  const close = useCallback(() => { setOpen(false); setText(''); setActive(0); }, []);
  useCloseOnOutside(panelRef, open, close);

  // Ctrl+K anywhere; "/" when not typing in a box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(true); }
      else if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); setOpen(true); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Read the lists only while the search is open.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    const read = (name: string) => getDocs(collection(db, name)).then(s => s.docs.map(d => ({ ...d.data(), id: d.id }))).catch(() => [] as any[]);
    Promise.all([
      read('clients'), read('teambuilding_proposals'), read('trainers_directory'), read('venues_directory'),
      staff ? read('vendors') : Promise.resolve([] as any[]), read('programmes'),
      staff ? read('deal_checklists') : Promise.resolve([] as any[]),   // HRDC approval codes (Grant approved step)
    ]).then(([clients, tbs, trainers, venues, vendors, programmes, checklists]) => {
      if (!alive) return;
      const codes = new Map<string, string>(checklists.map(c => [c.id, approvalCodeOf(c.tasks)]));
      setData({ clients, tbs: linkedOnly<any>(tbs), trainers, venues, vendors, programmes, codes });
      setLoading(false);
    });
    return () => { alive = false; };
  }, [open, staff]);

  useEffect(() => { if (open) window.setTimeout(() => inputRef.current?.focus(), 0); }, [open]);

  const results = useMemo(() => {
    const q = text.trim();
    const groups: { kind: SearchKind; label: string; hits: SearchHit[]; more: number }[] = [];
    if (!q) return groups;
    const match = matcher(q);
    const { clients, tbs, trainers, venues, vendors, programmes, codes } = data;
    const clientById = new Map<string, any>(clients.map(c => [c.id, c]));
    const dealById = new Map<string, any>(deals.map(d => [d.id, d]));
    const progName = (id?: string) => (id ? programmes.find(p => p.id === id)?.name || '' : '');
    const personName = (id: string) => people.find(p => p.id === id)?.name || '';
    const clientOfDeal = (d: any) => clientById.get(d?.clientId)?.companyName || d?.client || '';
    // Files: Admin and Management see everyone's; a rep sees their own and those shared with them.
    const canSeeFile = (f: any) => {
      if (staff) return true;
      const deal = f.pipelineId ? dealById.get(f.pipelineId) : null;
      const owner = f.ownerId || (deal ? dealOwnerId(deal) : '');
      return owner === viewer.id || f.creatorId === viewer.id || (f.sharedWithIds || []).includes(viewer.id)
        || f.taggedRepId === viewer.id || (!f.creatorId && !f.ownerId && !!f.preparedBy && f.preparedBy === viewer.name);
    };
    const fileClient = (f: any) => {
      const deal = f.pipelineId ? dealById.get(f.pipelineId) : null;
      return clientById.get(deal?.clientId || f.clientId)?.companyName || '';
    };
    const join = (...xs: unknown[]) => xs.map(x => String(x ?? '').trim()).filter(Boolean).join(' · ');

    const add = (kind: SearchKind, all: SearchHit[]) => {
      const lq = norm(q);
      all.sort((a, b) => Number(!norm(a.title).startsWith(lq)) - Number(!norm(b.title).startsWith(lq)) || a.title.localeCompare(b.title));
      if (all.length) groups.push({ kind, label: GROUPS.find(g => g[0] === kind)![1], hits: all.slice(0, PER_GROUP), more: Math.max(0, all.length - PER_GROUP) });
    };

    add('client', clients
      .filter(c => match([c.companyName, c.code, c.employerName, c.employerCode, c.contactName, c.phone, c.email, c.industry]))
      .map(c => ({ kind: 'client', id: c.id, title: c.companyName || 'Unnamed client', sub: join(c.contactName, c.phone, c.email), record: c })));

    // Deals: Management and Admin see all; a rep sees their own and deals they are tagged on (like Deals).
    add('deal', withoutDeleted(deals)
      .filter(d => staff || dealOwnerId(d) === viewer.id || (d.taggedRepIds || []).includes(viewer.id))
      .map(d => ({ d, client: clientOfDeal(d), prog: progName(d.programmeId) || d.courseName || '' }))
      .filter(({ d, client, prog }) => match([client, prog, d.enquiryNote, d.contactPerson, d.contactName, codes.get(d.id), clientById.get(d.clientId)?.employerCode, clientById.get(d.clientId)?.contactName]))
      .map(({ d, client, prog }) => ({
        kind: 'deal', id: d.id, title: client || 'No client',
        sub: join(prog, STAGE_LABELS[dealStage(d)], staff && dealOwnerId(d) !== viewer.id ? personName(dealOwnerId(d)) : ''), record: d,
      })));

    add('quotation', withoutDeleted(quotations)
      .filter(x => x.id !== 'q_default' && !x.isHidden && canSeeFile(x))
      .map(x => ({ x, client: fileClient(x) || x.company || '', progs: (x.items || []).map((i: any) => i.program).filter(Boolean).join(', ') }))
      .filter(({ x, client, progs }) => match([x.refNumber, client, x.company, x.attn, x.attnOverride, progs]))
      .map(({ x, client, progs }) => ({ kind: 'quotation', id: x.id, title: x.refNumber || client || 'Quotation', sub: join(x.refNumber ? client : '', progs), record: x })));

    add('outline', withoutDeleted(outlines)
      .filter(o => o.id !== 'outline_default' && !o.isHidden && canSeeFile(o))
      .map(o => ({ o, client: fileClient(o) || o.preparedForCompany || '', title: o.courseTitle || progName(o.programmeId) || '' }))
      .filter(({ o, client, title }) => match([o.refNumber, title, client, o.preparedForCompany]))
      .map(({ o, client, title }) => ({ kind: 'outline', id: o.id, title: title || o.refNumber || 'Course outline', sub: join(o.refNumber, client), record: o })));

    add('teambuilding', withoutDeleted<any>(tbs)
      .filter(p => !p.isHidden && canSeeFile(p))
      .map(p => ({ p, client: fileClient(p) }))
      .filter(({ p, client }) => match([p.refNumber, p.title, p.subtitle, client]))
      .map(({ p, client }) => ({ kind: 'teambuilding', id: p.id, title: p.title || p.refNumber || 'Teambuilding proposal', sub: join(p.refNumber, client), record: p })));

    add('trainer', trainers
      .filter(t => match([t.name, t.specialization, t.contact, t.phone, t.email]))
      .map(t => ({ kind: 'trainer', id: t.id, title: t.name || 'Unnamed trainer', sub: join(t.contact || t.phone, t.email), record: t })));

    add('venue', venues
      .filter(v => match([v.name, v.region, v.contact]))
      .map(v => ({ kind: 'venue', id: v.id, title: v.name || 'Unnamed venue', sub: join(v.region, v.contact), record: v })));

    if (staff) add('vendor', vendors
      .map(v => ({ v, name: vendorName(v, trainers, venues) }))
      .filter(({ v, name }) => match([name, v.contactName, v.phone, v.email, v.ssmNo]))
      .map(({ v, name }) => ({ kind: 'vendor', id: v.id, title: name, sub: join(vendorTypeLabel(v.type), v.contactName, v.phone), record: { ...v, displayName: name } })));

    return groups;
  }, [text, data, deals, quotations, outlines, people, staff, viewer.id, viewer.name]);

  const flat = useMemo(() => results.flatMap(g => g.hits), [results]);
  useEffect(() => { setActive(0); }, [text]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (hit?: SearchHit) => {
    if (!hit) return;
    close();
    onOpen(hit);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(flat.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(flat[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  };

  let idx = -1;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm font-medium text-ink-soft hover:bg-surface hover:text-ink"
        aria-label="Search"
        title="Search (Ctrl+K)"
      >
        <Search className="h-4 w-4" />
        <span className="hidden sm:inline">Search</span>
        <kbd className="hidden lg:inline rounded border border-line px-1.5 text-[11px] font-medium text-ink-soft">Ctrl K</kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 px-4 pt-[10vh] font-sans" role="dialog" aria-modal="true" aria-label="Search">
          <div ref={panelRef} className="flex max-h-[75vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line bg-white text-left shadow-xl">
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <Search className="h-5 w-5 shrink-0 text-ink-soft" />
              <input
                ref={inputRef}
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search clients, deals, quotations, outlines, trainers, venues…"
                className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-soft"
                aria-label="Search everything"
                aria-controls="global-search-results"
                aria-activedescendant={flat[active] ? `gs-${active}` : undefined}
              />
              {loading && <Loader2 className="h-4 w-4 animate-spin text-ink-soft" />}
              <button type="button" onClick={close} className="rounded p-1 text-ink-soft hover:bg-surface hover:text-ink" aria-label="Close search">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div ref={listRef} id="global-search-results" role="listbox" className="overflow-y-auto py-2">
              {!text.trim() ? (
                <p className="px-4 py-6 text-center text-sm text-ink-soft">Type a name, reference number, programme, contact person or phone number.</p>
              ) : results.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-ink-soft">{loading ? 'Loading…' : `Nothing matches "${text.trim()}".`}</p>
              ) : results.map(g => (
                <div key={g.kind} className="pb-1">
                  <p className="px-4 pb-1 pt-2 text-xs font-semibold text-ink-soft">{g.label}</p>
                  {g.hits.map(hit => {
                    idx += 1;
                    const i = idx;
                    const on = i === active;
                    return (
                      <button
                        key={`${hit.kind}:${hit.id}`}
                        id={`gs-${i}`}
                        data-idx={i}
                        type="button"
                        role="option"
                        aria-selected={on}
                        onMouseMove={() => setActive(i)}
                        onClick={() => choose(hit)}
                        className={`flex w-full items-center gap-3 px-4 py-2 text-left ${on ? 'bg-accent-soft' : 'hover:bg-surface'}`}
                      >
                        <span className="w-24 shrink-0">
                          <span className="inline-block rounded-md border border-line bg-white px-1.5 py-0.5 text-[11px] font-semibold text-ink-soft">{KIND_LABEL[hit.kind]}</span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-ink">{hit.title}</span>
                          {hit.sub && <span className="block truncate text-xs text-ink-soft">{hit.sub}</span>}
                        </span>
                      </button>
                    );
                  })}
                  {g.more > 0 && <p className="px-4 pb-1 pt-0.5 text-xs text-ink-soft">and {g.more} more. Type more to narrow it down.</p>}
                </div>
              ))}
            </div>

            <div className="hidden border-t border-line px-4 py-2 text-xs text-ink-soft sm:block">
              Up and down arrows to move, Enter to open, Esc to close.
            </div>
          </div>
        </div>
      )}
    </>
  );
}
