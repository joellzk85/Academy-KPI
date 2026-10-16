import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, query, setDoc } from 'firebase/firestore';
import {
  ArrowLeft, Copy, Download, Eye, EyeOff, Loader2, MoreHorizontal, Pencil, Plus, Search, Share2, Trash2, Users, X,
} from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import { Quotation, QuotationItem, Representative } from '../types';
import { dealOwnerId, dealStage, formatDate, formatRM, todayIso } from '../lib/deals';
import QuotationDocument from './QuotationDocument';

// Quotations (redesigned 2026-10-16): a clean list, then one full-width editor, then a full-width preview.
// Sharing: teammates in sharedWithIds can open and edit the same quotation (no copies).

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };

export const DEFAULT_TERMS = [
  'Cancellation or rescheduling of training must be made in writing at least fourteen (14) working days prior to the commencement of the course.',
  'Any cancellation received less than fourteen (14) working days but more than seven (7) working days prior to the course date will be subject to a cancellation fee of 50% of the total course fee.',
  'For cancellations received less than seven (7) working days, or in case of non-attendance, 100% of the course fee will be charged and invoiced.',
  'Rescheduling is permitted up to seven (7) working days before the course starts, subject to slot availability and a rescheduling admin fee.',
  'Substitution of participants is permitted at no extra charge, provided NEXT Academy is notified in writing at least three (3) working days prior to training.',
  'Participants must achieve a minimum of 75% attendance for HRD Corp claims and to qualify for the Certificate of Attendance / Completion.',
  'Participants are required to participate fully in all training activities, assessments, and feedback sessions as requested by the trainers.',
  'Participants must comply with the training schedule, starting promptly at 9:00 AM and concluding at 5:00 PM unless otherwise specified.',
  'Late arrivals or early departures may result in disqualification of attendance records for certification and employer HRD Corp grant claims.',
  'All training materials, slides, hand-outs, videos, and intellectual property remain the exclusive property of NEXT Academy (1 Group).',
  'No part of the provided training materials may be reproduced, recorded, stored, or shared in any form without prior written permission.',
  'Materials distributed are for individual participant use only and may not be distributed or used for internal corporate retraining.',
  'Both parties agree to treat all business information and trade secrets disclosed during training as strictly confidential.',
  "Personal data of participants is collected and processed in compliance with the Personal Data Protection Act 2010 (PDPA) of Malaysia.",
  "Participants' personal info, emails, and phone numbers will be used solely for training administration, feedback, and certification purposes.",
];

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const cell = 'w-full rounded-md border border-line bg-white px-2 py-1.5 text-[15px] focus:border-accent focus:outline-none';
const label = 'mb-1 block text-sm font-semibold text-ink';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';

const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const totalOf = (q: Quotation) => {
  const sub = (q.items || []).reduce((t, i) => t + (Number(i.totalFee) || 0), 0);
  return sub + (q.applySST ? (sub * (q.sstRate || 8)) / 100 : 0);
};

function nextRef(all: Quotation[], dateIso: string) {
  const stamp = dateIso.replace(/-/g, '');
  const prefix = `1G/NA/${stamp}/`;
  const used = all.map(q => q.refNumber || '').filter(r => r.startsWith(prefix)).map(r => parseInt(r.slice(prefix.length), 10) || 0);
  return `${prefix}${String((used.length ? Math.max(...used) : 0) + 1).padStart(2, '0')}`;
}

export default function QuotationsPage({ rep, reps, viewer }: { rep: Representative; reps: Representative[]; viewer?: Viewer; key?: string }) {
  const me: Viewer = viewer || { id: rep.id, name: rep.name, role: (rep.role as any) || 'rep' };
  const staff = me.role !== 'rep';
  const [quotes, setQuotes] = useState<Quotation[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [venues, setVenues] = useState<any[]>([]);
  const [trainers, setTrainers] = useState<any[]>([]);
  const [programmes, setProgrammes] = useState<any[]>([]);
  const [deals, setDeals] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Quotation | null>(null);

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

  const personName = (id?: string) => reps.find(r => r.id === id)?.name || '';

  const startNew = () => {
    const date = todayIso();
    setDraft({
      id: `q_${Date.now()}`, refNumber: nextRef(quotes, date), date, attn: '', company: '', address: '', venue: '', time: '', participants: '',
      trainingProvider: 'NEXT Academy', items: [], remarks: [], terms: DEFAULT_TERMS, applySST: false, sstRate: 8,
      preparedBy: me.name, creatorId: me.id, ownerId: rep.id, ownerName: rep.name, sharedWithIds: [], isHidden: false,
    } as Quotation);
    setOpenId('new');
  };
  const open = (q: Quotation) => { setDraft(clean({ ...q, items: q.items || [], remarks: q.remarks || [], terms: q.terms || [] })); setOpenId(q.id); };
  const duplicate = async (q: Quotation) => {
    const date = todayIso();
    const copy: Quotation = clean({
      ...q, id: `q_${Date.now()}`, refNumber: nextRef(quotes, date), date, preparedBy: me.name, creatorId: me.id, ownerId: rep.id, ownerName: rep.name,
      sharedWithIds: [], isHidden: false, pipelineId: '', taggedRepId: '', taggedRepName: '', taggedBy: '', tagNote: '', isCompleted: false,
    } as Quotation);
    await setDoc(doc(db, 'quotations', copy.id), copy);
    open(copy);
  };

  if (openId && draft) {
    return (
      <Editor
        key={draft.id}
        initial={draft}
        isNew={openId === 'new'}
        me={me}
        staff={staff}
        reps={reps}
        quotes={quotes}
        clients={clients}
        venues={venues}
        trainers={trainers}
        programmes={programmes}
        deals={deals}
        onClose={() => { setOpenId(null); setDraft(null); }}
        onSaved={(q) => { setDraft(q); setOpenId(q.id); }}
      />
    );
  }

  return (
    <QuoteList
      rep={rep} me={me} staff={staff} quotes={quotes} loaded={loaded} personName={personName}
      onNew={startNew} onOpen={open} onDuplicate={duplicate}
    />
  );
}

// ---------- List ----------
type Scope = 'mine' | 'shared' | 'everyone';

export function QuoteList({ rep, me, staff, quotes, loaded, personName, onNew, onOpen, onDuplicate }: {
  rep: Representative; me: Viewer; staff: boolean; quotes: Quotation[]; loaded: boolean; personName: (id?: string) => string;
  onNew: () => void; onOpen: (q: Quotation) => void; onDuplicate: (q: Quotation) => Promise<void>;
}) {
  const canSeeEveryone = staff && me.id === rep.id;
  const [scope, setScope] = useState<Scope>(canSeeEveryone ? 'everyone' : 'mine');
  const [search, setSearch] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [error, setError] = useState('');

  const isMine = (q: Quotation) => q.creatorId === rep.id || q.ownerId === rep.id || (!q.creatorId && !q.ownerId && !!q.preparedBy && q.preparedBy === rep.name);
  const isShared = (q: Quotation) => (q.sharedWithIds || []).includes(rep.id) || q.taggedRepId === rep.id;
  const counts = { mine: quotes.filter(isMine).length, shared: quotes.filter(q => !isMine(q) && isShared(q)).length };

  const visible = useMemo(() => {
    const base = quotes.filter(q => q.id !== 'q_default' && (scope === 'everyone' ? true : scope === 'shared' ? !isMine(q) && isShared(q) : isMine(q)));
    const t = search.trim().toLowerCase();
    return base
      .filter(q => showHidden || !q.isHidden)
      .filter(q => !t || `${q.refNumber} ${q.company} ${q.attn} ${(q.items || []).map(i => i.program).join(' ')}`.toLowerCase().includes(t))
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.id).localeCompare(String(a.id)));
  }, [quotes, scope, search, showHidden, rep.id]);

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
            {visible.map(q => {
              const progs = (q.items || []).map(i => i.program).filter(Boolean);
              const shared = (q.sharedWithIds || []) as string[];
              return (
                <li key={q.id} className="relative flex items-center gap-2 px-4 hover:bg-surface">
                  <button type="button" onClick={() => onOpen(q)} className="grid min-w-0 flex-1 gap-1 py-3 text-left sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1.3fr)_8rem_7rem] sm:items-center sm:gap-4">
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{q.company || 'No client yet'}</span>
                      <span className="block truncate text-sm text-ink-soft">{q.refNumber}{q.isHidden ? ' · hidden' : ''}</span>
                    </span>
                    <span className="min-w-0 truncate text-[15px] text-ink-soft">{progs.length ? `${progs[0]}${progs.length > 1 ? ` +${progs.length - 1} more` : ''}` : 'No programme yet'}</span>
                    <span className="text-[15px] font-semibold tabular-nums sm:text-right">{formatRM(totalOf(q))}</span>
                    <span className="text-sm text-ink-soft sm:text-right">
                      {formatDate(q.date) || '—'}
                      <span className="block truncate">{personName(q.ownerId || q.creatorId) || q.preparedBy || ''}{shared.length ? ` · shared` : ''}</span>
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
function Editor({ initial, isNew, me, staff, reps, quotes, clients, venues, trainers, programmes, deals, onClose, onSaved }: {
  initial: Quotation; isNew: boolean; me: Viewer; staff: boolean; reps: Representative[]; quotes: Quotation[];
  clients: any[]; venues: any[]; trainers: any[]; programmes: any[]; deals: any[];
  onClose: () => void; onSaved: (q: Quotation) => void; key?: string;
}) {
  const [q, setQ] = useState<Quotation>(initial);
  const [saved, setSaved] = useState<string>(isNew ? '' : JSON.stringify(initial));
  const [preview, setPreview] = useState(false);
  const [editMeta, setEditMeta] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const printAfterRender = useRef(false);

  const dirty = JSON.stringify(q) !== saved;
  const set = (c: Partial<Quotation>) => setQ(x => ({ ...x, ...c }));
  const shared: string[] = (q.sharedWithIds || []) as string[];
  const ownerId = q.ownerId || q.creatorId || '';
  const nameOf = (id?: string) => reps.find(r => r.id === id)?.name || '';
  const sub = (q.items || []).reduce((t, i) => t + (Number(i.totalFee) || 0), 0);
  const total = totalOf(q);

  useEffect(() => {
    if (preview && printAfterRender.current) {
      printAfterRender.current = false;
      const t = document.title;
      document.title = q.refNumber || 'Quotation';
      window.setTimeout(() => { window.print(); document.title = t; }, 200);
    }
  }, [preview]);

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const out: Quotation = clean({ ...q, items: (q.items || []).map((it, i) => ({ ...it, no: i + 1 })) });
      await setDoc(doc(db, 'quotations', out.id), out);
      setQ(out);
      setSaved(JSON.stringify(out));
      setNote('Saved');
      window.setTimeout(() => setNote(''), 2500);
      onSaved(out);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };
  const close = () => { if (!dirty || window.confirm('You have unsaved changes. Leave without saving?')) onClose(); };
  const downloadPdf = () => { printAfterRender.current = true; if (preview) { printAfterRender.current = false; window.print(); } else setPreview(true); };

  // Client
  const pickClient = (id: string) => {
    const c = clients.find(x => x.id === id);
    if (!c) return set({ clientId: '' });
    set({ clientId: c.id, company: c.companyName || '', attn: c.contactName && c.contactName !== 'N/A' ? c.contactName : q.attn, address: c.address || q.address });
  };
  const clientDeals = deals.filter(d => (q.clientId ? d.clientId === q.clientId : false) && dealStage(d) !== 'lost');

  // Lines
  const setItem = (i: number, c: Partial<QuotationItem>) => setQ(x => {
    const items = [...(x.items || [])];
    const it = { ...items[i], ...c };
    it.totalFee = (Number(it.feePerDay) || 0) * (Number(it.days) || 0);
    items[i] = it;
    return { ...x, items };
  });
  const addItem = () => setQ(x => ({ ...x, items: [...(x.items || []), { id: `item_${Date.now()}`, no: (x.items || []).length + 1, program: '', code: '', date: '', trainer: '', feePerDay: 0, days: 1, totalFee: 0 }] }));
  const removeItem = (i: number) => setQ(x => ({ ...x, items: (x.items || []).filter((_, k) => k !== i) }));
  const onProgramme = (i: number, name: string) => {
    const p = programmes.find(x => String(x.name).trim().toLowerCase() === name.trim().toLowerCase());
    setItem(i, p ? { program: p.name, code: p.hrdcCode || (q.items || [])[i]?.code || '' } : { program: name });
  };

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
        <QuotationDocument q={q} />
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-24 font-sans text-ink">
      {/* Top line */}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={btnSecondary} onClick={close}><ArrowLeft className="h-4 w-4" /> Quotations</button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-bold">{q.company || 'New quotation'}</h2>
          <p className="text-sm text-ink-soft">
            {q.refNumber} · {formatDate(q.date)} · Prepared by {q.preparedBy || me.name}{ownerId ? ` · Owner ${nameOf(ownerId) || q.ownerName || ''}` : ''}
            {' '}<button type="button" className="font-semibold text-accent hover:underline" onClick={() => setEditMeta(v => !v)}>{editMeta ? 'Done' : 'Edit'}</button>
          </p>
        </div>
      </div>
      {editMeta && (
        <div className="grid gap-3 rounded-2xl border border-line bg-white p-4 sm:grid-cols-3">
          <div><label className={label} htmlFor="q-ref">Reference number</label><input id="q-ref" value={q.refNumber} onChange={e => set({ refNumber: e.target.value })} className={input} /></div>
          <div><label className={label} htmlFor="q-date">Date</label><input id="q-date" type="date" value={q.date} onChange={e => set({ date: e.target.value })} className={input} /></div>
          {staff && (
            <div>
              <label className={label} htmlFor="q-owner">Owner</label>
              <select id="q-owner" value={ownerId} onChange={e => set({ ownerId: e.target.value, ownerName: nameOf(e.target.value) })} className={input}>
                {reps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
          )}
        </div>
      )}

      {/* 1. Client */}
      <Card title="1. Client">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={label} htmlFor="q-client">Client</label>
            <select id="q-client" value={q.clientId || ''} onChange={e => pickClient(e.target.value)} className={input}>
              <option value="">Choose from the client list…</option>
              {[...clients].sort((a, b) => String(a.companyName).localeCompare(String(b.companyName))).map(c => <option key={c.id} value={c.id}>{c.companyName}</option>)}
            </select>
          </div>
          <div><label className={label} htmlFor="q-company">Company name (as printed)</label><input id="q-company" value={q.company} onChange={e => set({ company: e.target.value })} className={input} /></div>
          <div><label className={label} htmlFor="q-attn">Attention to</label><input id="q-attn" value={q.attn} onChange={e => set({ attn: e.target.value })} className={input} placeholder="Contact person" /></div>
          <div className="sm:col-span-2"><label className={label} htmlFor="q-addr">Address</label><textarea id="q-addr" value={q.address} onChange={e => set({ address: e.target.value })} className={`${input} min-h-[60px]`} /></div>
          {q.clientId && (
            <div className="sm:col-span-2">
              <label className={label} htmlFor="q-deal">Linked deal (optional)</label>
              <select id="q-deal" value={q.pipelineId || ''} onChange={e => set({ pipelineId: e.target.value })} className={input}>
                <option value="">Not linked</option>
                {clientDeals.map(d => <option key={d.id} value={d.id}>{d.courseName || 'Deal'} · {nameOf(dealOwnerId(d)) || 'owner'} · {d.stage || d.status}</option>)}
              </select>
            </div>
          )}
        </div>
      </Card>

      {/* 2. Training details */}
      <Card title="2. Training details">
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className={label} htmlFor="q-venue">Venue</label><input id="q-venue" list="q-venues" value={q.venue} onChange={e => set({ venue: e.target.value })} className={input} placeholder="Pick or type" /></div>
          <div><label className={label} htmlFor="q-time">Time</label><input id="q-time" value={q.time} onChange={e => set({ time: e.target.value })} className={input} placeholder="9:00 AM – 5:00 PM" /></div>
          <div><label className={label} htmlFor="q-pax">Participants</label><input id="q-pax" value={q.participants} onChange={e => set({ participants: e.target.value })} className={input} placeholder="Up to 25 pax" /></div>
          <div><label className={label} htmlFor="q-prov">Prepared by (as printed)</label><input id="q-prov" value={q.trainingProvider} onChange={e => set({ trainingProvider: e.target.value })} className={input} /></div>
        </div>
        <datalist id="q-venues">{venues.map(v => <option key={v.id} value={v.name} />)}</datalist>
      </Card>

      {/* 3. Programmes */}
      <Card title="3. Programmes">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-[15px]">
            <thead>
              <tr className="text-left text-sm text-ink-soft">
                <th className="min-w-[220px] pb-2 font-semibold">Programme</th>
                <th className="w-32 pb-2 font-semibold">HRDC code</th>
                <th className="w-36 pb-2 font-semibold">Dates</th>
                <th className="w-40 pb-2 font-semibold">Trainer</th>
                <th className="w-28 pb-2 font-semibold">Fee / day</th>
                <th className="w-16 pb-2 font-semibold">Days</th>
                <th className="w-28 pb-2 text-right font-semibold">Total</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {(q.items || []).map((it, i) => (
                <tr key={it.id} className="align-top">
                  <td className="py-1 pr-2"><input list="q-progs" value={it.program} onChange={e => onProgramme(i, e.target.value)} className={cell} placeholder="Pick or type" aria-label={`Programme, line ${i + 1}`} /></td>
                  <td className="py-1 pr-2"><input value={it.code} onChange={e => setItem(i, { code: e.target.value })} className={cell} aria-label={`HRDC code, line ${i + 1}`} /></td>
                  <td className="py-1 pr-2"><input value={it.date} onChange={e => setItem(i, { date: e.target.value })} className={cell} placeholder="e.g. 5–6 Nov 2026" aria-label={`Dates, line ${i + 1}`} /></td>
                  <td className="py-1 pr-2"><input list="q-trainers" value={it.trainer} onChange={e => setItem(i, { trainer: e.target.value })} className={cell} aria-label={`Trainer, line ${i + 1}`} /></td>
                  <td className="py-1 pr-2"><input inputMode="decimal" value={it.feePerDay ? String(it.feePerDay) : ''} onChange={e => setItem(i, { feePerDay: Number(e.target.value.replace(/[^0-9.]/g, '')) || 0 })} className={cell} aria-label={`Fee per day, line ${i + 1}`} /></td>
                  <td className="py-1 pr-2"><input inputMode="numeric" value={it.days ? String(it.days) : ''} onChange={e => setItem(i, { days: Number(e.target.value.replace(/[^0-9.]/g, '')) || 0 })} className={cell} aria-label={`Days, line ${i + 1}`} /></td>
                  <td className="py-2.5 text-right font-semibold tabular-nums">{formatRM(it.totalFee || 0)}</td>
                  <td className="py-1 pl-1"><button type="button" onClick={() => removeItem(i)} className="rounded-md p-1.5 text-ink-soft hover:bg-danger-soft hover:text-danger" aria-label={`Remove line ${i + 1}`}><X className="h-4 w-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <datalist id="q-progs">{programmes.map(p => <option key={p.id} value={p.name} />)}</datalist>
          <datalist id="q-trainers">{trainers.map(t => <option key={t.id} value={t.name} />)}</datalist>
        </div>
        <button type="button" className={`${btnSecondary} mt-2`} onClick={addItem}><Plus className="h-4 w-4" /> Add programme</button>
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
              <button type="button" className={btnSecondary} onClick={() => { set({ remarks: (q.remarks || []).filter(r => r.trim()), terms: (q.terms || []).filter(t => t.trim()) }); setShowTerms(false); }}>Done</button>
            </div>
          </div>
        )}
      </Card>

      {/* 5. Sharing */}
      <Card title="5. Share with teammates">
        <p className="mb-2 text-[15px] text-ink-soft">People you add can open and edit this same quotation. It appears in their list under "Shared with me".</p>
        <div className="flex flex-wrap gap-2">
          {reps.filter(r => r.id !== ownerId).map(r => {
            const on = shared.includes(r.id);
            return (
              <button key={r.id} type="button" aria-pressed={on}
                onClick={() => set({ sharedWithIds: on ? shared.filter(x => x !== r.id) : [...shared, r.id] })}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium ${on ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-soft hover:bg-surface'}`}>
                {on ? <Users className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}{r.name}
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
          <span className={`text-sm ${dirty ? 'text-attention' : 'text-ink-soft'}`}>{note || (dirty ? 'Not saved yet' : 'All changes saved')}</span>
          <span className="ml-auto flex gap-2">
            <button type="button" className={btnSecondary} onClick={() => setPreview(true)}><Eye className="h-4 w-4" /> Preview</button>
            <button type="button" className={btnSecondary} onClick={downloadPdf}><Download className="h-4 w-4" /> Download PDF</button>
            <button type="button" className={btnPrimary} disabled={busy || !dirty} onClick={save}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save</button>
          </span>
        </div>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-white p-5">
      <h3 className="mb-3 font-bold">{title}</h3>
      {children}
    </section>
  );
}
