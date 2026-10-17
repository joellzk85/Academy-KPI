import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, query, setDoc, updateDoc } from 'firebase/firestore';
import {
  AlertTriangle, ArrowLeft, Copy, Download, Eye, EyeOff, Link2, Loader2, Lock, MoreHorizontal, Pencil, Plus, Search, Send, Share2, Trash2, Unlock, Users, X,
} from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import { Quotation, QuotationItem, Representative } from '../types';
import { STAGE_LABELS, canQuote, dealOwnerId, dealStage, dealValue, formatDate, formatRM, todayIso } from '../lib/deals';
import { buildQuotationForDeal } from '../lib/dealDocs';
import { DEFAULT_TERMS, QuoteSources, isSent, resolveQuotation } from '../lib/quoteResolve';
import QuotationDocument from './QuotationDocument';

// Quotations (redesigned 2026-10-16; one source of truth).
// A quotation is made for a deal (or a client). While it's a draft, the client's details, programme,
// HRDC code, training date, owner, venue and trainer are read live from their lists (lib/quoteResolve.ts).
// "Mark as sent" locks a copy of exactly what was sent; "Revise" unlocks it again.
// Sharing: teammates in sharedWithIds can open and edit the same quotation (no copies).

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };
type Tab = 'client' | 'pipeline' | 'trainerList' | 'venue';

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15 disabled:bg-surface disabled:text-ink-soft';
const cell = 'w-full rounded-md border border-line bg-white px-2 py-1.5 text-[15px] focus:border-accent focus:outline-none disabled:bg-surface';
const label = 'mb-1 block text-sm font-semibold text-ink';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';
const linkBtn = 'text-sm font-semibold text-accent hover:underline';

const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const totalOf = (q: Quotation) => {
  const sub = (q.items || []).reduce((t, i) => t + (Number(i.totalFee) || 0), 0);
  return sub + (q.applySST ? (sub * (q.sstRate || 8)) / 100 : 0);
};

function nextRef(all: Quotation[], dateIso: string) {
  const prefix = `1G/NA/${dateIso.replace(/-/g, '')}/`;
  const used = all.map(q => q.refNumber || '').filter(r => r.startsWith(prefix)).map(r => parseInt(r.slice(prefix.length), 10) || 0);
  return `${prefix}${String((used.length ? Math.max(...used) : 0) + 1).padStart(2, '0')}`;
}

export default function QuotationsPage({ rep, reps, viewer, onOpenTab }: {
  rep: Representative; reps: Representative[]; viewer?: Viewer; key?: string;
  onOpenTab?: (tab: Tab) => void;   // jump to where a detail is edited
}) {
  const me: Viewer = viewer || { id: rep.id, name: rep.name, role: (rep.role as any) || 'rep' };
  const staff = me.role !== 'rep';
  const [quotes, setQuotes] = useState<Quotation[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [venues, setVenues] = useState<any[]>([]);
  const [trainers, setTrainers] = useState<any[]>([]);
  const [programmes, setProgrammes] = useState<any[]>([]);
  const [deals, setDeals] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState<{ q: Quotation; isNew: boolean } | null>(null);
  const [choosing, setChoosing] = useState(false);

  useEffect(() => {
    const subs = [
      onSnapshot(query(collection(db, 'quotations')), s => { setQuotes(s.docs.map(d => ({ ...(d.data() as Quotation), id: d.id }))); setLoaded(true); }, () => setLoaded(true)),
      onSnapshot(query(collection(db, 'clients')), s => setClients(s.docs.map(d => ({ ...d.data(), id: d.id })))),
      onSnapshot(query(collection(db, 'venues_directory')), s => setVenues(s.docs.map(d => ({ ...d.data(), id: d.id })))),
      onSnapshot(query(collection(db, 'trainers_directory')), s => setTrainers(s.docs.map(d => ({ ...d.data(), id: d.id })))),
      onSnapshot(query(collection(db, 'programmes')), s => setProgrammes(s.docs.map(d => ({ ...d.data(), id: d.id })))),
      onSnapshot(query(collection(db, 'pipelines')), s => setDeals(s.docs.map(d => ({ ...d.data(), id: d.id })))),
    ];
    return () => subs.forEach(u => u());
  }, []);

  const sources: QuoteSources = useMemo(() => ({ clients, deals, programmes, trainers, venues, people: reps.map(r => ({ id: r.id, name: r.name })) }), [clients, deals, programmes, trainers, venues, reps]);
  const personName = (id?: string) => reps.find(r => r.id === id)?.name || '';

  // New quotation: always for a deal, or a client when there's no deal yet.
  const createFor = (pick: { deal?: any; clientId?: string }) => {
    const date = todayIso();
    let q: Quotation;
    if (pick.deal) {
      const ownerId = dealOwnerId(pick.deal) || rep.id;
      q = buildQuotationForDeal(pick.deal, { id: me.id, name: me.name }, { id: ownerId, name: personName(ownerId) || rep.name }, null, 0) as Quotation;
      q.refNumber = nextRef(quotes, date);
    } else {
      q = {
        id: `q_${Date.now()}`, refNumber: nextRef(quotes, date), date, attn: '', company: '', address: '', venue: '', time: '', participants: '',
        trainingProvider: 'NEXT Academy', items: [], remarks: [], terms: DEFAULT_TERMS, applySST: false, sstRate: 8, status: 'draft',
        preparedBy: me.name, creatorId: me.id, ownerId: rep.id, ownerName: rep.name, clientId: pick.clientId || '', pipelineId: '', sharedWithIds: [], isHidden: false,
      };
    }
    setChoosing(false);
    setDraft({ q, isNew: true });
  };
  const open = (q: Quotation) => setDraft({ q: clean({ ...q, items: q.items || [], remarks: q.remarks || [], terms: q.terms || [] }), isNew: false });
  const duplicate = async (q: Quotation) => {
    const date = todayIso();
    const copy: Quotation = clean({
      ...q, id: `q_${Date.now()}`, refNumber: nextRef(quotes, date), date, preparedBy: me.name, creatorId: me.id,
      status: 'draft', sentAt: '', sentById: '', sentByName: '', sharedWithIds: [], isHidden: false,
      taggedRepId: '', taggedRepName: '', taggedBy: '', tagNote: '', isCompleted: false,
    } as Quotation);
    await setDoc(doc(db, 'quotations', copy.id), copy);
    open(copy);
  };

  // Quotations come after the client agrees to the proposal.
  const dealsForPicker = deals.filter(d => (staff && me.id === rep.id ? true : dealOwnerId(d) === rep.id) && canQuote(d));

  return (
    <>
      {draft ? (
        <Editor
          key={draft.q.id}
          initial={draft.q}
          isNew={draft.isNew}
          me={me} staff={staff} reps={reps} sources={sources} dealsForPicker={dealsForPicker}
          onOpenTab={onOpenTab}
          onClose={() => setDraft(null)}
        />
      ) : (
        <QuoteList rep={rep} me={me} staff={staff} quotes={quotes} loaded={loaded} sources={sources} personName={personName}
          onNew={() => setChoosing(true)} onOpen={open} onDuplicate={duplicate} />
      )}
      {choosing && <Chooser deals={dealsForPicker} clients={clients} sources={sources} personName={personName} onPick={createFor} onCancel={() => setChoosing(false)} />}
    </>
  );
}

// ---------- Choose the deal (or client) ----------
function Chooser({ deals, clients, sources, personName, onPick, onCancel, title = 'Which agreed deal is this quotation for?' }: {
  deals: any[]; clients: any[]; sources: QuoteSources; personName: (id?: string) => string;
  onPick: (p: { deal?: any; clientId?: string }) => void; onCancel: () => void; title?: string;
}) {
  const [search, setSearch] = useState('');
  const [clientOnly, setClientOnly] = useState(false);
  const [clientId, setClientId] = useState('');
  const clientName = (d: any) => clients.find(c => c.id === d.clientId)?.companyName || d.client || 'No client';
  const progName = (d: any) => sources.programmes.find(p => p.id === d.programmeId)?.name || d.courseName || 'No programme';
  const t = search.trim().toLowerCase();
  const list = deals
    .filter(d => !t || `${clientName(d)} ${progName(d)} ${personName(dealOwnerId(d))}`.toLowerCase().includes(t))
    .sort((a, b) => String(b.requestDate || b.id).localeCompare(String(a.requestDate || a.id)))
    .slice(0, 40);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4 pt-16" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="w-full max-w-2xl rounded-2xl bg-white p-5 font-sans text-ink shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <h3 className="text-lg font-bold">{title}</h3>
          <button type="button" onClick={onCancel} className="rounded-md p-1 text-ink-soft hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        {!clientOnly ? (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
              <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search client, programme or rep" className={`${input} pl-9`} aria-label="Search deals" />
            </div>
            <ul className="mt-3 max-h-[50vh] divide-y divide-line overflow-y-auto rounded-xl border border-line">
              {list.length === 0 && <li className="p-4 text-ink-soft">No agreed deals found.</li>}
              {list.map(d => (
                <li key={d.id}>
                  <button type="button" onClick={() => onPick({ deal: d })} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-surface">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{clientName(d)}</span>
                      <span className="block truncate text-sm text-ink-soft">{progName(d)} · {personName(dealOwnerId(d))} · {STAGE_LABELS[dealStage(d)]}</span>
                    </span>
                    <span className="text-sm font-semibold tabular-nums">{dealValue(d) ? formatRM(dealValue(d)) : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-ink-soft">Only deals where the client has agreed to the proposal are listed. On the deal, click "Client agreed" first.</p>
          </>
        ) : (
          <div className="space-y-3">
            <label className={label} htmlFor="ch-client">Client</label>
            <select id="ch-client" value={clientId} onChange={e => setClientId(e.target.value)} className={input}>
              <option value="">Choose from the client list…</option>
              {[...clients].sort((a, b) => String(a.companyName).localeCompare(String(b.companyName))).map(c => <option key={c.id} value={c.id}>{c.companyName}</option>)}
            </select>
            <p className="text-sm text-ink-soft">Tip: it's better to create the deal first (in Deals) so the programme, date and value fill in by themselves.</p>
            <div className="flex justify-between gap-2">
              <button type="button" className={linkBtn} onClick={() => setClientOnly(false)}>Back to deals</button>
              <button type="button" className={btnPrimary} disabled={!clientId} onClick={() => onPick({ clientId })}>Continue</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- List ----------
type Scope = 'mine' | 'shared' | 'everyone';

export function QuoteList({ rep, me, staff, quotes, loaded, sources, personName, onNew, onOpen, onDuplicate }: {
  rep: Representative; me: Viewer; staff: boolean; quotes: Quotation[]; loaded: boolean; sources: QuoteSources; personName: (id?: string) => string;
  onNew: () => void; onOpen: (q: Quotation) => void; onDuplicate: (q: Quotation) => Promise<void>;
}) {
  const canSeeEveryone = staff && me.id === rep.id;
  const [scope, setScope] = useState<Scope>(canSeeEveryone ? 'everyone' : 'mine');
  const [search, setSearch] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [error, setError] = useState('');

  const resolved = useMemo(() => quotes.map(q => ({ raw: q, r: resolveQuotation(q, sources) })), [quotes, sources]);
  const isMine = (x: { raw: Quotation; r: { ownerId: string } }) => x.r.ownerId === rep.id || x.raw.creatorId === rep.id || (!x.raw.creatorId && !x.raw.ownerId && !!x.raw.preparedBy && x.raw.preparedBy === rep.name);
  const isShared = (q: Quotation) => (q.sharedWithIds || []).includes(rep.id) || q.taggedRepId === rep.id;
  const counts = { mine: resolved.filter(isMine).length, shared: resolved.filter(x => !isMine(x) && isShared(x.raw)).length };

  const visible = useMemo(() => {
    const t = search.trim().toLowerCase();
    return resolved
      .filter(x => x.raw.id !== 'q_default' && (scope === 'everyone' ? true : scope === 'shared' ? !isMine(x) && isShared(x.raw) : isMine(x)))
      .filter(x => showHidden || !x.raw.isHidden)
      .filter(x => !t || `${x.r.q.refNumber} ${x.r.q.company} ${x.r.q.attn} ${(x.r.q.items || []).map(i => i.program).join(' ')}`.toLowerCase().includes(t))
      .sort((a, b) => String(b.raw.date || '').localeCompare(String(a.raw.date || '')) || String(b.raw.id).localeCompare(String(a.raw.id)));
  }, [resolved, scope, search, showHidden, rep.id]);

  const canDelete = (q: Quotation) => staff || q.creatorId === me.id || q.ownerId === me.id;
  const act = async (fn: () => Promise<void>) => { setMenu(null); setError(''); try { await fn(); } catch (e) { setError(friendlyError(e)); } };

  return (
    <div className="space-y-4 font-sans text-ink">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Quotations</h2>
          <p className="mt-0.5 text-[15px] text-ink-soft">Click a quotation to open it.</p>
        </div>
        <button type="button" className={btnPrimary} onClick={onNew}><Plus className="h-4 w-4" /> New quotation</button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-line bg-white p-0.5">
          {([...(canSeeEveryone ? [['everyone', "Everyone's"]] : []), ['mine', `Mine (${counts.mine})`], ['shared', `Shared with me (${counts.shared})`]] as [Scope, string][]).map(([k, t]) => (
            <button key={k} type="button" onClick={() => setScope(k)} className={`rounded-md px-3 py-1.5 text-sm font-semibold ${scope === k ? 'bg-ink text-white' : 'text-ink-soft hover:text-ink'}`}>{t}</button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input type="checkbox" checked={showHidden} onChange={e => setShowHidden(e.target.checked)} className="h-4 w-4 accent-[#0E6E62]" /> Show hidden
        </label>
        <div className="relative ml-auto w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search ref, client or programme" className={`${input} pl-9`} aria-label="Search quotations" />
        </div>
      </div>
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</p>}

      <div className="rounded-2xl border border-line bg-white">
        {!loaded ? (
          <p className="flex items-center gap-2 p-6 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading quotations…</p>
        ) : visible.length === 0 ? (
          <div className="p-8 text-center">
            <p className="font-semibold">No quotations here</p>
            <p className="mt-1 text-[15px] text-ink-soft">Create one with New quotation, or from a deal (Deals → open a deal → Create quotation).</p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {visible.map(({ raw: q, r }) => {
              const progs = (r.q.items || []).map(i => i.program).filter(Boolean);
              return (
                <li key={q.id} className="relative flex items-center gap-2 px-4 hover:bg-surface">
                  <button type="button" onClick={() => onOpen(q)} className="grid min-w-0 flex-1 gap-1 py-3 text-left sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1.3fr)_8rem_7rem] sm:items-center sm:gap-4">
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{r.q.company || 'No client yet'}</span>
                      <span className="flex items-center gap-1.5 truncate text-sm text-ink-soft">
                        {q.refNumber}
                        {isSent(q) ? <span className="rounded bg-accent-soft px-1.5 text-xs font-semibold text-accent">Sent</span> : <span className="rounded bg-surface px-1.5 text-xs font-semibold">Draft</span>}
                        {q.isHidden && <span className="text-xs">hidden</span>}
                      </span>
                    </span>
                    <span className="min-w-0 truncate text-[15px] text-ink-soft">{progs.length ? `${progs[0]}${progs.length > 1 ? ` +${progs.length - 1} more` : ''}` : 'No programme yet'}</span>
                    <span className="text-[15px] font-semibold tabular-nums sm:text-right">{formatRM(totalOf(r.q))}</span>
                    <span className="text-sm text-ink-soft sm:text-right">
                      {formatDate(q.date) || '—'}
                      <span className="block truncate">{personName(r.ownerId) || q.preparedBy || ''}{(q.sharedWithIds || []).length ? ' · shared' : ''}</span>
                    </span>
                  </button>
                  <button type="button" onClick={() => setMenu(m => (m === q.id ? null : q.id))} className="rounded-md p-2 text-ink-soft hover:bg-white hover:text-ink" aria-label={`More for ${q.refNumber}`} aria-expanded={menu === q.id}>
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                  {menu === q.id && (
                    <div role="menu" className="absolute right-4 top-12 z-20 w-48 overflow-hidden rounded-xl border border-line bg-white py-1 shadow-lg">
                      <MenuBtn icon={<Pencil className="h-4 w-4" />} text="Open" onClick={() => { setMenu(null); onOpen(q); }} />
                      <MenuBtn icon={<Copy className="h-4 w-4" />} text="Duplicate" onClick={() => act(() => onDuplicate(q))} />
                      <MenuBtn icon={q.isHidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />} text={q.isHidden ? 'Unhide' : 'Hide'}
                        onClick={() => act(() => setDoc(doc(db, 'quotations', q.id), { isHidden: !q.isHidden }, { merge: true }))} />
                      {canDelete(q) && (
                        <MenuBtn danger icon={<Trash2 className="h-4 w-4" />} text="Delete"
                          onClick={() => { if (window.confirm(`Delete quotation ${q.refNumber}? This can't be undone.`)) act(() => deleteDoc(doc(db, 'quotations', q.id))); else setMenu(null); }} />
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function MenuBtn({ icon, text, onClick, danger }: { icon: React.ReactNode; text: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm font-medium ${danger ? 'text-danger hover:bg-danger-soft' : 'text-ink hover:bg-surface'}`}>
      {icon}{text}
    </button>
  );
}

// ---------- Editor ----------
export function Editor({ initial, isNew, me, staff, reps, sources, dealsForPicker, onOpenTab, onClose }: {
  initial: Quotation; isNew: boolean; me: Viewer; staff: boolean; reps: Representative[]; sources: QuoteSources; dealsForPicker: any[];
  onOpenTab?: (tab: Tab) => void; onClose: () => void; key?: string;
}) {
  const [q, setQ] = useState<Quotation>(initial);
  const [saved, setSaved] = useState<string>(isNew ? '' : JSON.stringify(initial));
  const [preview, setPreview] = useState(false);
  const [editMeta, setEditMeta] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [relinking, setRelinking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const printAfterRender = useRef(false);

  const r = resolveQuotation(q, sources);
  const shownQ = r.q;                       // what prints
  const locked = isSent(q);
  const dirty = JSON.stringify(q) !== saved;
  const set = (c: Partial<Quotation>) => setQ(x => ({ ...x, ...c }));
  const shared: string[] = q.sharedWithIds || [];
  const nameOf = (id?: string) => reps.find(p => p.id === id)?.name || '';
  const sub = (shownQ.items || []).reduce((t, i) => t + (Number(i.totalFee) || 0), 0);
  const total = totalOf(shownQ);
  const legacy = !r.deal && !r.client && !!(q.company || q.address);

  useEffect(() => {
    if (preview && printAfterRender.current) {
      printAfterRender.current = false;
      const t = document.title;
      document.title = q.refNumber || 'Quotation';
      window.setTimeout(() => { window.print(); document.title = t; }, 200);
    }
  }, [preview]);

  const persist = async (out: Quotation, msg: string) => {
    setBusy(true);
    setError('');
    try {
      const final = clean({ ...out, items: (out.items || []).map((it, i) => ({ ...it, no: i + 1 })) });
      await setDoc(doc(db, 'quotations', final.id), final);
      setQ(final);
      setSaved(JSON.stringify(final));
      setNote(msg);
      window.setTimeout(() => setNote(''), 2500);
      return true;
    } catch (e) {
      setError(friendlyError(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const save = () => persist(q, 'Saved');
  const markSent = () => {
    if (r.issues.length && !window.confirm(`Some details are missing:\n\n• ${r.issues.join('\n• ')}\n\nMark as sent anyway?`)) return;
    // Lock a copy of exactly what prints now.
    return persist({ ...shownQ, status: 'sent', sentAt: new Date().toISOString(), sentById: me.id, sentByName: me.name }, 'Marked as sent and locked').then(async ok => {
      // The deal moves to "Quotation sent" (if it was at "Client agreed").
      if (!ok || !r.deal || dealStage(r.deal) !== 'agreed') return;
      try {
        await updateDoc(doc(db, 'pipelines', r.deal.id), {
          stage: 'quoted', status: 'Pending', quotationSentDate: todayIso(),
          history: [...(r.deal.history || []), { at: new Date().toISOString(), byId: me.id, byName: me.name, action: `Quotation ${q.refNumber} sent` }].slice(-40),
        });
      } catch { /* the deal owner or Admin can move it on the deal */ }
    });
  };
  const revise = () => {
    if (!window.confirm('Unlock this quotation to revise it? It will read the latest client, deal and programme details again.')) return;
    return persist({ ...q, status: 'draft', sentAt: '', sentById: '', sentByName: '' }, 'Unlocked for revision');
  };
  const close = () => { if (!dirty || window.confirm('You have unsaved changes. Leave without saving?')) onClose(); };
  const downloadPdf = () => { if (preview) window.print(); else { printAfterRender.current = true; setPreview(true); } };

  // Re-link to a deal or client
  const relink = (pick: { deal?: any; clientId?: string }) => {
    if (pick.deal) {
      const d = pick.deal;
      const first = (q.items || [])[0];
      const items = first ? [{ ...first, programmeId: d.programmeId || first.programmeId || '', useDealDate: true }, ...(q.items || []).slice(1)]
        : [{ id: `item_${Date.now()}`, no: 1, program: '', code: '', date: '', trainer: '', programmeId: d.programmeId || '', useDealDate: true, feePerDay: dealValue(d), days: 1, totalFee: dealValue(d) }];
      set({ pipelineId: d.id, clientId: d.clientId || '', items });
    } else {
      set({ pipelineId: '', clientId: pick.clientId || '' });
    }
    setRelinking(false);
  };

  // Lines
  const setItem = (i: number, c: Partial<QuotationItem>) => setQ(x => {
    const items = [...(x.items || [])];
    const it = { ...items[i], ...c };
    it.totalFee = (Number(it.feePerDay) || 0) * (Number(it.days) || 0);
    items[i] = it;
    return { ...x, items };
  });
  const addItem = (kind: 'programme' | 'item') => setQ(x => ({ ...x, items: [...(x.items || []), { id: `item_${Date.now()}`, no: (x.items || []).length + 1, kind, program: '', code: '', date: '', trainer: '', programmeId: '', trainerId: '', useDealDate: kind === 'programme' && !!x.pipelineId, feePerDay: 0, days: 1, totalFee: 0 }] }));
  const removeItem = (i: number) => setQ(x => ({ ...x, items: (x.items || []).filter((_, k) => k !== i) }));

  if (preview) {
    return (
      <div className="space-y-4 font-sans text-ink">
        <div className="no-print flex flex-wrap items-center justify-between gap-2">
          <button type="button" className={btnSecondary} onClick={() => setPreview(false)}><ArrowLeft className="h-4 w-4" /> Back to edit</button>
          <span className="flex items-center gap-2">
            {dirty && <span className="text-sm text-attention">Not saved yet</span>}
            <button type="button" className={btnPrimary} onClick={() => window.print()}><Download className="h-4 w-4" /> Download PDF</button>
          </span>
        </div>
        <p className="no-print text-sm text-ink-soft">In the print window, choose "Save as PDF" as the printer.</p>
        <QuotationDocument q={shownQ} />
      </div>
    );
  }

  // List choices for the "pick or type" boxes, A–Z.
  const opts = (list: any[]) => list.filter(x => String(x.name || '').trim())
    .map(x => ({ id: x.id, name: String(x.name).trim() }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const goto = (tab: Tab, what: string) => onOpenTab ? (
    <button type="button" className={linkBtn} onClick={() => { if (!dirty || window.confirm('Leave this quotation without saving?')) onOpenTab(tab); }}>{what}</button>
  ) : null;

  return (
    <div className="space-y-4 pb-24 font-sans text-ink">
      {/* Top line */}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={btnSecondary} onClick={close}><ArrowLeft className="h-4 w-4" /> Quotations</button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-bold">{shownQ.company || 'New quotation'}</h2>
          <p className="text-sm text-ink-soft">
            {q.refNumber} · {formatDate(q.date)} · Prepared by {q.preparedBy || me.name}{r.ownerId ? ` · Owner ${nameOf(r.ownerId) || q.ownerName || ''}` : ''}
            {!locked && <> {' '}<button type="button" className={linkBtn} onClick={() => setEditMeta(v => !v)}>{editMeta ? 'Done' : 'Edit'}</button></>}
          </p>
        </div>
      </div>

      {locked && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-accent/30 bg-accent-soft p-4 text-accent">
          <Lock className="h-5 w-5" />
          <p className="min-w-0 flex-1 text-[15px]"><strong>Sent {formatDate(q.sentAt || '')}</strong> by {q.sentByName}. This is the locked copy the client received.</p>
          <button type="button" className={btnSecondary} onClick={revise}><Unlock className="h-4 w-4" /> Revise</button>
        </div>
      )}

      {!locked && editMeta && (
        <div className="grid gap-3 rounded-2xl border border-line bg-white p-4 sm:grid-cols-3">
          <div><label className={label} htmlFor="q-ref">Reference number</label><input id="q-ref" value={q.refNumber} onChange={e => set({ refNumber: e.target.value })} className={input} /></div>
          <div><label className={label} htmlFor="q-date">Date</label><input id="q-date" type="date" value={q.date} onChange={e => set({ date: e.target.value })} className={input} /></div>
          {staff && !r.deal && (
            <div>
              <label className={label} htmlFor="q-owner">Owner</label>
              <select id="q-owner" value={q.ownerId || ''} onChange={e => set({ ownerId: e.target.value, ownerName: nameOf(e.target.value) })} className={input}>
                {reps.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}
        </div>
      )}

      {!locked && r.issues.length > 0 && (
        <div className="rounded-2xl border border-attention/30 bg-attention-soft p-4 text-sm text-attention">
          <p className="mb-1 flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" /> Fix these at the source, and the quotation updates by itself:</p>
          <ul className="list-disc space-y-0.5 pl-6">{r.issues.map(i => <li key={i}>{i}</li>)}</ul>
        </div>
      )}

      <fieldset disabled={locked} className="space-y-4">
        {/* 1. Deal and client (read live) */}
        <Card title="1. Deal and client" action={!locked && <button type="button" className={linkBtn} onClick={() => setRelinking(true)}><Link2 className="mr-1 inline h-4 w-4" />{r.deal || r.client ? 'Change' : 'Link a deal or client'}</button>}>
          {r.deal && (
            <div className="mb-3 rounded-xl bg-surface px-4 py-3">
              <p className="text-sm text-ink-soft">Deal</p>
              <p className="font-semibold">{sources.programmes.find(p => p.id === r.deal.programmeId)?.name || r.deal.courseName || 'No programme'} · {STAGE_LABELS[dealStage(r.deal)]}</p>
              <p className="text-sm text-ink-soft">Training {r.deal.trainingDate ? formatDate(r.deal.trainingDate) : 'date not set'} · value {formatRM(dealValue(r.deal))} · {nameOf(dealOwnerId(r.deal))} {goto('pipeline', '· Edit deal')}</p>
            </div>
          )}
          {r.client ? (
            <dl className="grid gap-3 sm:grid-cols-3">
              <Fact term="Company" value={shownQ.company} />
              <AttentionBox
                value={shownQ.attn}
                override={q.attnOverride || ''}
                clientContact={r.client.contactName && r.client.contactName !== 'N/A' ? r.client.contactName : ''}
                locked={locked}
                onChange={v => set({ attnOverride: v })}
              />
              <Fact term="Address" value={shownQ.address} />
              <div className="sm:col-span-3">{goto('client', 'Edit these in the client list')}</div>
            </dl>
          ) : legacy ? (
            <div className="text-[15px]">
              <p className="text-sm text-attention">This older quotation isn't linked yet. It shows the details typed in before:</p>
              <p className="mt-1 font-semibold">{q.company}</p>
              <p className="text-ink-soft">{q.attn}{q.address ? ` · ${q.address}` : ''}</p>
            </div>
          ) : (
            <p className="text-[15px] text-ink-soft">Not linked to a deal or client yet.</p>
          )}
        </Card>

        {/* 2. Training details */}
        <Card title="2. Training details">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="q-venue">Venue</label>
              <PickOrType id="q-venue" options={opts(sources.venues)} linkedId={q.venueId || ''} text={q.venue || ''}
                onChange={v => set({ venueId: v.id, venue: v.text })} placeholder="Pick from the venue list or type one" className={input} />
              {!q.venueId && q.venue?.trim() && <div className="mt-1">{goto('venue', 'Using it often? Add it in Venues')}</div>}
            </div>
            <div><label className={label} htmlFor="q-time">Time</label><input id="q-time" value={q.time} onChange={e => set({ time: e.target.value })} className={input} placeholder="9:00 AM – 5:00 PM" /></div>
            <div><label className={label} htmlFor="q-pax">Participants{r.deal?.participants ? ' (from the deal)' : ''}</label><input id="q-pax" value={r.deal?.participants ? shownQ.participants : q.participants} disabled={!!r.deal?.participants} onChange={e => set({ participants: e.target.value })} className={input} placeholder="Up to 25 pax" /></div>
            <div><label className={label} htmlFor="q-prov">Prepared by (as printed)</label><input id="q-prov" value={q.trainingProvider} onChange={e => set({ trainingProvider: e.target.value })} className={input} /></div>
          </div>
        </Card>

        {/* 3. Programmes */}
        <Card title="3. Programmes and other items">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-[15px]">
              <thead>
                <tr className="text-left text-sm text-ink-soft">
                  <th className="min-w-[220px] pb-2 font-semibold">Programme or item</th>
                  <th className="w-28 pb-2 font-semibold">HRDC code</th>
                  <th className="w-44 pb-2 font-semibold">Dates</th>
                  <th className="w-44 pb-2 font-semibold">Trainer</th>
                  <th className="w-24 pb-2 font-semibold">Rate</th>
                  <th className="w-16 pb-2 font-semibold">Days / Qty</th>
                  <th className="w-28 pb-2 text-right font-semibold">Total</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {(q.items || []).map((it, i) => {
                  const shown = shownQ.items[i] || it;
                  const money = (
                    <>
                      <td className="py-1 pr-2"><input inputMode="decimal" value={it.feePerDay ? String(it.feePerDay) : ''} onChange={e => setItem(i, { feePerDay: Number(e.target.value.replace(/[^0-9.]/g, '')) || 0 })} className={cell} aria-label={`${it.kind === 'item' ? 'Price each' : 'Rate per day'}, line ${i + 1}`} /></td>
                      <td className="py-1 pr-2"><input inputMode="numeric" value={it.days ? String(it.days) : ''} onChange={e => setItem(i, { days: Number(e.target.value.replace(/[^0-9.]/g, '')) || 0 })} className={cell} aria-label={`${it.kind === 'item' ? 'Quantity' : 'Days'}, line ${i + 1}`} /></td>
                      <td className="py-2.5 text-right font-semibold tabular-nums">{formatRM(shown.totalFee || 0)}</td>
                      <td className="py-1 pl-1">{!locked && <button type="button" onClick={() => removeItem(i)} className="rounded-md p-1.5 text-ink-soft hover:bg-danger-soft hover:text-danger" aria-label={`Remove line ${i + 1}`}><X className="h-4 w-4" /></button>}</td>
                    </>
                  );
                  if (it.kind === 'item') {
                    return (
                      <tr key={it.id} className="align-top">
                        <td className="py-1 pr-2">
                          <input value={it.program} onChange={e => setItem(i, { program: e.target.value })} className={cell} placeholder="e.g. Bus, T-shirts, lunch" aria-label={`Item, line ${i + 1}`} />
                        </td>
                        <td colSpan={3} className="py-2.5 pr-2 text-sm text-ink-soft">Other item: price each × quantity</td>
                        {money}
                      </tr>
                    );
                  }
                  return (
                    <tr key={it.id} className="align-top">
                      <td className="py-1 pr-2">
                        <PickOrType id={`q-prog-${it.id}`} options={opts(sources.programmes)} linkedId={it.programmeId || ''} text={it.program || ''}
                          onChange={v => setItem(i, { programmeId: v.id, program: v.text, ...(v.id ? {} : { code: it.programmeId ? '' : it.code }) })}
                          placeholder="Pick or type a programme" className={cell} ariaLabel={`Programme, line ${i + 1}`} />
                      </td>
                      <td className="py-1 pr-2">
                        {it.programmeId ? (
                          <p className="py-1.5 text-ink-soft">{shown.code || '—'}</p>
                        ) : (
                          <input value={it.code || ''} onChange={e => setItem(i, { code: e.target.value })} className={cell} placeholder="If any" aria-label={`HRDC code, line ${i + 1}`} />
                        )}
                      </td>
                      <td className="py-1 pr-2">
                        {it.useDealDate && r.deal ? (
                          <div className="py-1.5">
                            <span>{shown.date || 'Not set on deal'}</span>
                            {!locked && <button type="button" className="block text-xs font-semibold text-accent hover:underline" onClick={() => setItem(i, { useDealDate: false, date: shown.date })}>Type a different date</button>}
                          </div>
                        ) : (
                          <>
                            <input value={it.date} onChange={e => setItem(i, { date: e.target.value })} className={cell} placeholder="e.g. 5–6 Nov 2026" aria-label={`Dates, line ${i + 1}`} />
                            {r.deal && !locked && <button type="button" className="text-xs font-semibold text-accent hover:underline" onClick={() => setItem(i, { useDealDate: true })}>Use the deal's date</button>}
                          </>
                        )}
                      </td>
                      <td className="py-1 pr-2">
                        <PickOrType id={`q-trainer-${it.id}`} options={opts(sources.trainers)} linkedId={it.trainerId || ''} text={it.trainer || ''}
                          onChange={v => setItem(i, { trainerId: v.id, trainer: v.text })}
                          placeholder="Pick or type" className={cell} ariaLabel={`Trainer, line ${i + 1}`} />
                      </td>
                      {money}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!locked && (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <button type="button" className={btnSecondary} onClick={() => addItem('programme')}><Plus className="h-4 w-4" /> Add programme</button>
              <button type="button" className={btnSecondary} onClick={() => addItem('item')}><Plus className="h-4 w-4" /> Add other item</button>
              <span className="text-sm text-ink-soft">Pick a programme or trainer from the list, or type one. Picked ones stay up to date with the list.</span>
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center justify-end gap-x-6 gap-y-2 border-t border-line pt-3 text-[15px]">
            <label className="flex items-center gap-2"><input type="checkbox" checked={!!q.applySST} onChange={e => set({ applySST: e.target.checked })} className="h-4 w-4 accent-[#0E6E62]" /> Add SST</label>
            {q.applySST && (
              <label className="flex items-center gap-2">Rate <input inputMode="decimal" value={String(q.sstRate || 8)} onChange={e => set({ sstRate: Number(e.target.value.replace(/[^0-9.]/g, '')) || 0 })} className="w-16 rounded-md border border-line px-2 py-1 text-center" aria-label="SST rate" />%</label>
            )}
            <span className="text-ink-soft">Subtotal <strong className="text-ink">{formatRM(sub)}</strong></span>
            <span className="text-lg">Total <strong>{formatRM(total)}</strong></span>
          </div>
        </Card>

        {/* 4. Remarks and terms */}
        <Card title="4. Remarks and terms">
          {!showTerms ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[15px] text-ink-soft">{(q.remarks || []).filter(Boolean).length} remark{(q.remarks || []).filter(Boolean).length === 1 ? '' : 's'} · {(q.terms || []).length} terms{JSON.stringify(q.terms) === JSON.stringify(DEFAULT_TERMS) ? ' (standard)' : ' (edited)'}</p>
              <button type="button" className={btnSecondary} onClick={() => setShowTerms(true)}><Pencil className="h-4 w-4" /> Edit</button>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className={label} htmlFor="q-rem">Remarks (one per line)</label>
                <textarea id="q-rem" value={(q.remarks || []).join('\n')} onChange={e => set({ remarks: e.target.value.split('\n') })} className={`${input} min-h-[80px]`} />
              </div>
              <div>
                <label className={label} htmlFor="q-terms">Terms and conditions (one per line)</label>
                <textarea id="q-terms" value={(q.terms || []).join('\n')} onChange={e => set({ terms: e.target.value.split('\n') })} className={`${input} min-h-[220px] text-sm`} />
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <button type="button" className={btnSecondary} onClick={() => set({ terms: DEFAULT_TERMS })}>Use standard terms</button>
                <button type="button" className={btnSecondary} onClick={() => { set({ remarks: (q.remarks || []).filter(x => x.trim()), terms: (q.terms || []).filter(x => x.trim()) }); setShowTerms(false); }}>Done</button>
              </div>
            </div>
          )}
        </Card>
      </fieldset>

      {/* 5. Sharing (allowed even when sent) */}
      <Card title="5. Share with teammates">
        <p className="mb-2 text-[15px] text-ink-soft">People you add can open and edit this same quotation. It appears in their list under "Shared with me".</p>
        <div className="flex flex-wrap gap-2">
          {reps.filter(p => p.id !== r.ownerId).map(p => {
            const on = shared.includes(p.id);
            return (
              <button key={p.id} type="button" aria-pressed={on}
                onClick={() => set({ sharedWithIds: on ? shared.filter(x => x !== p.id) : [...shared, p.id] })}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium ${on ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-soft hover:bg-surface'}`}>
                {on ? <Users className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}{p.name}
              </button>
            );
          })}
        </div>
      </Card>

      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</p>}

      {/* Bottom bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3">
          <span className="text-lg font-bold tabular-nums">{formatRM(total)}</span>
          <span className={`text-sm ${dirty ? 'text-attention' : 'text-ink-soft'}`}>{note || (dirty ? 'Not saved yet' : locked ? 'Sent and locked' : 'All changes saved')}</span>
          <span className="ml-auto flex flex-wrap gap-2">
            <button type="button" className={btnSecondary} onClick={() => setPreview(true)}><Eye className="h-4 w-4" /> Preview</button>
            <button type="button" className={btnSecondary} onClick={downloadPdf}><Download className="h-4 w-4" /> Download PDF</button>
            {!locked && <button type="button" className={btnSecondary} disabled={busy} onClick={markSent}><Send className="h-4 w-4" /> Mark as sent</button>}
            <button type="button" className={btnPrimary} disabled={busy || !dirty} onClick={save}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save</button>
          </span>
        </div>
      </div>

      {relinking && (
        <Chooser deals={dealsForPicker} clients={sources.clients} sources={sources} personName={nameOf} onPick={relink} onCancel={() => setRelinking(false)} title="Link this quotation to a deal" />
      )}
    </div>
  );
}

// "Attention to": the client's contact person, or a different PIC typed for this quotation only.
function AttentionBox({ value, override, clientContact, locked, onChange }: {
  value: string; override: string; clientContact: string; locked: boolean; onChange: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const typed = !!override.trim();
  if (editing && !locked) {
    return (
      <div className="rounded-xl bg-surface px-3.5 py-2.5">
        <label className="text-sm text-ink-soft" htmlFor="q-attn">Attention to (this quotation only)</label>
        <input id="q-attn" autoFocus value={override} onChange={e => onChange(e.target.value)} placeholder={clientContact || 'Name of the PIC'} className={`${cell} mt-1`} />
        <div className="mt-1 flex flex-wrap gap-3">
          <button type="button" className="text-xs font-semibold text-accent hover:underline" onClick={() => setEditing(false)}>Done</button>
          {clientContact && <button type="button" className="text-xs font-semibold text-accent hover:underline" onClick={() => { onChange(''); setEditing(false); }}>Use the client's contact ({clientContact})</button>}
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-xl bg-surface px-3.5 py-2.5">
      <dt className="text-sm text-ink-soft">Attention to</dt>
      <dd className={value ? 'font-semibold' : 'text-ink-soft/70'}>{value || 'Missing'}</dd>
      {!locked && (
        <button type="button" className="text-xs font-semibold text-accent hover:underline" onClick={() => setEditing(true)}>
          {typed ? 'Changed for this quotation · Edit' : 'Change'}
        </button>
      )}
    </div>
  );
}

// One box for "pick from the list or type your own" (venue, programme, trainer).
// Typing a name that's in the list links it (read live afterwards); anything else is kept as typed.
function PickOrType({ id, options, linkedId, text, onChange, placeholder, className, ariaLabel }: {
  id: string; options: { id: string; name: string }[]; linkedId: string; text: string;
  onChange: (v: { id: string; text: string }) => void; placeholder?: string; className: string; ariaLabel?: string;
}) {
  const linked = linkedId ? options.find(o => o.id === linkedId) : undefined;
  const value = linked ? linked.name : text;
  const pick = (v: string) => {
    const hit = options.find(o => o.name.trim().toLowerCase() === v.trim().toLowerCase() && v.trim());
    onChange(hit ? { id: hit.id, text: hit.name } : { id: '', text: v });
  };
  return (
    <div>
      <input id={id} list={`${id}-list`} value={value} onChange={e => pick(e.target.value)} placeholder={placeholder} className={className} aria-label={ariaLabel} autoComplete="off" />
      <datalist id={`${id}-list`}>
        {options.map(o => <option key={o.id} value={o.name} />)}
      </datalist>
      {(linked || value.trim()) && (
        <span className={`mt-0.5 block text-xs ${linked ? 'text-accent' : 'text-ink-soft'}`}>{linked ? 'From list' : 'Typed'}</span>
      )}
    </div>
  );
}

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-white p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="font-bold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Fact({ term, value }: { term: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface px-3.5 py-2.5">
      <dt className="text-sm text-ink-soft">{term}</dt>
      <dd className={`whitespace-pre-line ${value ? 'font-semibold' : 'text-ink-soft/70'}`}>{value || 'Missing'}</dd>
    </div>
  );
}
