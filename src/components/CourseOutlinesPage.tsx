import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, query, setDoc, updateDoc } from 'firebase/firestore';
import {
  AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, Copy, Download, Eye, EyeOff, FilePlus2, Link2, Loader2, Lock, MoreHorizontal, Pencil, Plus, Printer, Search, Send, Trash2, Unlock, X,
} from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import { CourseOutline, CourseOutlineItem, OutlineAgendaRow, QuoteSendEntry, Representative } from '../types';
import { BLOOM_LEVELS, DEFAULT_OUTLINE_TERMS, DIFFICULTIES, durationText } from '../lib/outlineContent';
import { DealField, STAGE_LABELS, canMoveDeal, dealGaps, dealOwnerId, dealStage, formatDate, statusForStage, todayIso } from '../lib/deals';
import { GapsBox } from './DealGates';
import { Programme } from '../lib/programmes';
import { OutlineSources, dealProgrammeName, nextOutlineRef, outlineSent, resolveOutline } from '../lib/outlineResolve';
import CourseOutlineDocument from './CourseOutlineDocument';
import { OutlineSendDialog } from './QuoteSendDialog';
import { downloadBlob, makeOutlinePdf, outlinePdfFileName, preloadPdfLibs } from '../lib/quotePdf';
import { pdfErrorText } from '../lib/oldTab';
import DocLinkBox, { openLinkOf, useDocLinks } from './DocLinkBox';
import { linkedOnly } from '../lib/linked';
import ShareWithBox, { NewCount } from './ShareWithBox';
import { isUnseen, markSharedSeen, useSharedSeen } from '../lib/sharedInbox';
import { LinkShareBox, closeTrainerLink, createTrainerLink, useTrainerLinks } from './TrainerLinkTools';
import { OutlineSubmission, TrainerLink, isLive } from '../lib/trainerLinks';
import { trainerOptions } from './PickOrType';

// Course outlines (redesigned 2026-10-17, like quotations).
// An outline is made for a deal (or as a general outline with no client), starting blank or from a copy
// of an earlier outline, so a programme's modules are typed once and reused. While it's a draft, the
// company, course title (the deal's programme) and owner are read live (lib/outlineResolve.ts).
// "Mark as sent" locks a copy; "Revise" unlocks it. Sharing: teammates in sharedWithIds can edit the same outline.

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };
type Tab = 'client' | 'pipeline';

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15 disabled:bg-surface disabled:text-ink-soft';
const label = 'mb-1 block text-sm font-semibold text-ink';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';
const linkBtn = 'text-sm font-semibold text-accent hover:underline';
const iconBtn = 'rounded-md p-1.5 text-ink-soft hover:bg-surface hover:text-ink disabled:opacity-30';

const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const newId = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const newModule = (): CourseOutlineItem => ({ id: newId('m'), no: 0, moduleTitle: '', topics: '', duration: '', methodology: '' });
const newRow = (isDay = false): OutlineAgendaRow => ({ id: newId('a'), time: '', text: '', ...(isDay ? { isDay: true } : {}) });
const summary = (o: CourseOutline) => `${durationText(o.durationDays) || '0 days'} · ${(o.items || []).length} module${(o.items || []).length === 1 ? '' : 's'}`;
const trimList = (v?: string[]) => (v || []).map(x => x.trim()).filter(Boolean);

export default function CourseOutlinesPage({ rep, reps, viewer, startDeal, onStartHandled, onOpenTab, openId, onOpenHandled, startOnShared, fromDealId, onBackToDeal }: {
  rep: Representative; reps: Representative[]; viewer?: Viewer; key?: string;
  fromDealId?: string | null;        // opened from this deal: the editor shows "Back to deal"
  onBackToDeal?: (dealId: string) => void;
  startDeal?: any | null;            // "Create outline" on a deal: go straight to "Start from" for it
  openId?: string | null;            // My home's "Shared with me": open this outline straight in the editor
  onOpenHandled?: () => void;
  startOnShared?: boolean;           // opened from a menu red dot: start on "Shared with me"
  onStartHandled?: () => void;
  onOpenTab?: (tab: Tab) => void;
}) {
  const me: Viewer = viewer || { id: rep.id, name: rep.name, role: (rep.role as any) || 'rep' };
  const staff = me.role !== 'rep';
  const [outlines, setOutlines] = useState<CourseOutline[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [programmes, setProgrammes] = useState<any[]>([]);
  const [deals, setDeals] = useState<any[]>([]);
  const [trainers, setTrainers] = useState<any[]>([]);
  const links = useTrainerLinks();
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState<{ o: CourseOutline; isNew: boolean } | null>(null);
  const [choosing, setChoosing] = useState<null | { step: 'deal' } | { step: 'start'; deal: any | null }>(null);
  const [backDeal, setBackDeal] = useState<string | null>(null);   // opened from a deal: "Back to deal"

  useEffect(() => {
    const subs = [
      onSnapshot(query(collection(db, 'course_outlines')), s => { setOutlines(linkedOnly(s.docs.map(d => ({ ...(d.data() as CourseOutline), id: d.id })))); setLoaded(true); }, () => setLoaded(true)),
      onSnapshot(query(collection(db, 'clients')), s => setClients(s.docs.map(d => ({ ...d.data(), id: d.id })))),
      onSnapshot(query(collection(db, 'programmes')), s => setProgrammes(s.docs.map(d => ({ ...d.data(), id: d.id })))),
      onSnapshot(query(collection(db, 'trainers_directory')), s => setTrainers(s.docs.map(d => ({ ...d.data(), id: d.id })))),
      onSnapshot(query(collection(db, 'pipelines')), s => setDeals(linkedOnly(s.docs.map(d => ({ ...d.data(), id: d.id }))))),
    ];
    return () => subs.forEach(u => u());
  }, []);

  // "Create outline" on a deal: if it already has a draft outline, open that (no duplicates); else "Start from".
  useEffect(() => {
    if (!startDeal || !loaded) return;
    setBackDeal(fromDealId || null);
    const existing = outlines
      .filter(o => o.pipelineId === startDeal.id && !outlineSent(o))
      .sort((a, b) => String(b.date || b.id).localeCompare(String(a.date || a.id)))[0];
    if (existing) { setChoosing(null); open(existing); }
    else { setDraft(null); setChoosing({ step: 'start', deal: startDeal }); }
    onStartHandled?.();
  }, [startDeal, loaded]);
  const leave = () => {
    const d = backDeal;
    setDraft(null);
    setChoosing(null);
    setBackDeal(null);
    if (d && onBackToDeal) onBackToDeal(d);
  };

  const sources: OutlineSources = useMemo(() => ({ clients, deals, programmes, people: reps.map(r => ({ id: r.id, name: r.name })) }), [clients, deals, programmes, reps]);
  const personName = (id?: string) => reps.find(r => r.id === id)?.name || '';

  // Outlines often go out with the proposal, so any open or won deal can have one.
  const dealsForPicker = deals.filter(d => (staff && me.id === rep.id ? true : dealOwnerId(d) === rep.id) && dealStage(d) !== 'lost');

  const createFrom = (deal: any | null, base: CourseOutline | null) => {
    const date = todayIso();
    const ownerId = (deal && dealOwnerId(deal)) || rep.id;
    const content = base ? clean({
      courseTitle: base.courseTitle, durationDays: base.durationDays, totalHours: base.totalHours, category: base.category, level: base.level,
      audience: base.audience, prerequisites: base.prerequisites, overview: base.overview, outcomes: base.outcomes || [],
      items: (base.items || []).map(m => ({ ...m, id: newModule().id })),
      // The new details (2026-10-19) come along too; the terms only when the earlier outline had its own.
      kind: 'training' as const, methods: base.methods || [], dayTitles: base.dayTitles || [],
      agenda: (base.agenda || []).map(r => ({ ...r, id: newRow().id })),
      difficulty: base.difficulty || '', evaluation: base.evaluation || [], bloomLevel: base.bloomLevel || 0,
      nextTraining: base.nextTraining || [], designedBy: base.designedBy || '', terms: base.terms, hideTerms: !!base.hideTerms,
    }) : {
      courseTitle: '', durationDays: 1, totalHours: 8, category: '', level: 'Beginner' as const, audience: '', prerequisites: '', overview: '',
      outcomes: [], items: [newModule()], kind: 'training' as const, methods: [], agenda: [],
    };
    const o: CourseOutline = {
      ...content,
      id: `outline_${Date.now()}`, refNumber: nextOutlineRef(outlines, date), date,
      preparedBy: me.name, creatorId: me.id, ownerId, ownerName: personName(ownerId) || rep.name,
      clientId: deal?.clientId || '', pipelineId: deal?.id || '', preparedForCompany: '',
      programmeId: deal?.programmeId || base?.programmeId || '',
      useProgrammeName: !!(deal?.programmeId || base?.programmeId) || (!!deal && !!dealProgrammeName(deal, programmes)),
      status: 'draft', sharedWithIds: [], isHidden: false,
    };
    setChoosing(null);
    setDraft({ o, isNew: true });
  };
  const open = (o: CourseOutline) => {
    markSharedSeen(me.id, 'outline', o);   // clears this person's "Shared with me" alert for it
    setDraft({ o: clean({ ...o, items: o.items || [], outcomes: o.outcomes || [] }), isNew: false });
  };
  useEffect(() => {
    if (!openId) return;
    const o = outlines.find(x => x.id === openId);
    if (!o) return;
    setBackDeal(fromDealId || null);
    open(o);
    onOpenHandled?.();
  }, [openId, outlines]);
  const duplicate = async (o: CourseOutline) => {
    const date = todayIso();
    const copy: CourseOutline = clean({
      ...o, id: `outline_${Date.now()}`, refNumber: nextOutlineRef(outlines, date), date, preparedBy: me.name, creatorId: me.id,
      status: 'draft', sentAt: '', sentById: '', sentByName: '', sharedWithIds: [], isHidden: false,
      taggedRepId: '', taggedRepName: '', taggedBy: '', tagNote: '', isCompleted: false,
    } as CourseOutline);
    await setDoc(doc(db, 'course_outlines', copy.id), copy);
    open(copy);
  };

  return (
    <>
      {draft ? (
        <Editor key={draft.o.id} initial={draft.o} isNew={draft.isNew} me={me} staff={staff} reps={reps} sources={sources}
          dealsForPicker={dealsForPicker} onOpenTab={onOpenTab} onClose={() => { setDraft(null); setBackDeal(null); }} trainers={trainers} links={links}
          backToDeal={backDeal && onBackToDeal ? leave : undefined} />
      ) : (
        <OutlineList rep={rep} me={me} staff={staff} outlines={outlines} loaded={loaded} sources={sources} personName={personName} links={links} startOnShared={startOnShared}
          onNew={() => setChoosing({ step: 'deal' })} onOpen={open} onDuplicate={duplicate} />
      )}
      {choosing?.step === 'deal' && (
        <DealChooser deals={dealsForPicker} sources={sources} personName={personName}
          onPick={deal => setChoosing({ step: 'start', deal })} onCancel={() => setChoosing(null)} allowGeneral />
      )}
      {choosing?.step === 'start' && (
        <StartChooser deal={choosing.deal} outlines={outlines} sources={sources}
          onPick={base => createFrom(choosing.deal, base)} onBack={() => setChoosing({ step: 'deal' })} onCancel={() => (backDeal ? leave() : setChoosing(null))} />
      )}
    </>
  );
}

// ---------- Step 1: which deal ----------
function DealChooser({ deals, sources, personName, onPick, onCancel, allowGeneral, title = 'Which deal is this outline for?' }: {
  deals: any[]; sources: OutlineSources; personName: (id?: string) => string;
  onPick: (deal: any | null) => void; onCancel: () => void; allowGeneral?: boolean; title?: string;
}) {
  const [search, setSearch] = useState('');
  const clientName = (d: any) => sources.clients.find(c => c.id === d.clientId)?.companyName || d.client || 'No client';
  const t = search.trim().toLowerCase();
  const list = deals
    .filter(d => !t || `${clientName(d)} ${dealProgrammeName(d, sources.programmes)} ${personName(dealOwnerId(d))}`.toLowerCase().includes(t))
    .sort((a, b) => String(b.requestDate || b.id).localeCompare(String(a.requestDate || a.id)))
    .slice(0, 40);

  return (
    <Modal title={title} onCancel={onCancel}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
        <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search client, programme or rep" className={`${input} pl-9`} aria-label="Search deals" />
      </div>
      <ul className="mt-3 max-h-[50vh] divide-y divide-line overflow-y-auto rounded-xl border border-line">
        {list.length === 0 && <li className="p-4 text-ink-soft">No deals found.</li>}
        {list.map(d => (
          <li key={d.id}>
            <button type="button" onClick={() => onPick(d)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-surface">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{clientName(d)}</span>
                <span className="block truncate text-sm text-ink-soft">{dealProgrammeName(d, sources.programmes) || 'No programme'} · {personName(dealOwnerId(d))}</span>
              </span>
              <span className="shrink-0 text-sm text-ink-soft">{STAGE_LABELS[dealStage(d)]}</span>
            </button>
          </li>
        ))}
      </ul>
      {allowGeneral && (
        <button type="button" className={`${linkBtn} mt-3`} onClick={() => onPick(null)}>Make a general outline, not for a client</button>
      )}
    </Modal>
  );
}

// ---------- Step 2: start blank or from a copy ----------
function StartChooser({ deal, outlines, sources, onPick, onBack, onCancel }: {
  deal: any | null; outlines: CourseOutline[]; sources: OutlineSources;
  onPick: (base: CourseOutline | null) => void; onBack: () => void; onCancel: () => void;
}) {
  const [search, setSearch] = useState('');
  const progName = dealProgrammeName(deal, sources.programmes).toLowerCase();
  const resolved = useMemo(() => outlines.filter(o => o.id !== 'outline_default' && !o.isHidden).map(o => resolveOutline(o, sources)), [outlines, sources]);
  const sameProgramme = (r: ReturnType<typeof resolveOutline>) =>
    !!progName && ((!!deal?.programmeId && r.programmeId === deal.programmeId) || (r.o.courseTitle || '').trim().toLowerCase() === progName);
  const t = search.trim().toLowerCase();
  const list = resolved
    .filter(r => !t || `${r.o.courseTitle} ${r.o.preparedForCompany} ${r.o.refNumber}`.toLowerCase().includes(t))
    .sort((a, b) => Number(sameProgramme(b)) - Number(sameProgramme(a)) || String(b.o.date || '').localeCompare(String(a.o.date || '')))
    .slice(0, 40);
  const clientName = deal ? sources.clients.find(c => c.id === deal.clientId)?.companyName || deal.client || '' : '';

  return (
    <Modal title="Start from" onCancel={onCancel}>
      <p className="-mt-1 mb-3 text-[15px] text-ink-soft">{deal ? `For ${clientName || 'this deal'}${progName ? `, ${dealProgrammeName(deal, sources.programmes)}` : ''}` : 'General outline, not for a client'}</p>
      <button type="button" onClick={() => onPick(null)} className={`${btnSecondary} w-full justify-start`}><FilePlus2 className="h-4 w-4" /> Blank outline</button>
      <p className="mb-2 mt-4 text-sm font-semibold">Or copy an earlier outline{progName ? ' (same programme first)' : ''}</p>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search course title or client" className={`${input} pl-9`} aria-label="Search outlines" />
      </div>
      <ul className="mt-3 max-h-[40vh] divide-y divide-line overflow-y-auto rounded-xl border border-line">
        {list.length === 0 && <li className="p-4 text-ink-soft">No outlines to copy yet.</li>}
        {list.map(r => (
          <li key={r.o.id}>
            <button type="button" onClick={() => onPick(r.o)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-surface">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{r.o.courseTitle || 'Untitled'}{sameProgramme(r) && <span className="ml-2 rounded bg-accent-soft px-1.5 text-xs font-semibold text-accent">Same programme</span>}</span>
                <span className="block truncate text-sm text-ink-soft">{r.o.preparedForCompany || 'General'} · {r.o.refNumber} · {summary(r.o)}</span>
              </span>
              <Copy className="h-4 w-4 shrink-0 text-ink-soft" />
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className={`${linkBtn} mt-3`} onClick={onBack}>Choose a different deal</button>
    </Modal>
  );
}

function Modal({ title, onCancel, children }: { title: string; onCancel: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4 pt-16" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="w-full max-w-2xl rounded-2xl bg-white p-5 font-sans text-ink shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <h3 className="text-lg font-bold">{title}</h3>
          <button type="button" onClick={onCancel} className="rounded-md p-1 text-ink-soft hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------- List ----------
type Scope = 'mine' | 'shared' | 'everyone';

function OutlineList({ rep, me, staff, outlines, loaded, sources, personName, links, onNew, onOpen, onDuplicate, startOnShared }: {
  rep: Representative; me: Viewer; staff: boolean; outlines: CourseOutline[]; loaded: boolean; sources: OutlineSources; personName: (id?: string) => string;
  links: TrainerLink[]; startOnShared?: boolean;
  onNew: () => void; onOpen: (o: CourseOutline) => void; onDuplicate: (o: CourseOutline) => Promise<void>;
}) {
  const canSeeEveryone = staff && me.id === rep.id;
  const [scope, setScope] = useState<Scope>(startOnShared ? 'shared' : canSeeEveryone ? 'everyone' : 'mine');
  // "Shared with me" alerts are the viewer's own, so they show only in their own workspace.
  const seen = useSharedSeen(me.id === rep.id ? me.id : undefined);
  const unseen = (o: CourseOutline) => me.id === rep.id && isUnseen('outline', o, me.id, seen);
  const [search, setSearch] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [error, setError] = useState('');

  const resolved = useMemo(() => outlines.map(o => ({ raw: o, r: resolveOutline(o, sources) })), [outlines, sources]);
  const isMine = (x: { raw: CourseOutline; r: { ownerId: string } }) => x.r.ownerId === rep.id || x.raw.creatorId === rep.id || (!x.raw.creatorId && !x.raw.ownerId && !!x.raw.preparedBy && x.raw.preparedBy === rep.name);
  const isShared = (o: CourseOutline) => (o.sharedWithIds || []).includes(rep.id) || o.taggedRepId === rep.id;
  const counts = { mine: resolved.filter(isMine).length, shared: resolved.filter(x => !isMine(x) && isShared(x.raw)).length, unseen: outlines.filter(unseen).length };

  const visible = useMemo(() => {
    const t = search.trim().toLowerCase();
    return resolved
      .filter(x => x.raw.id !== 'outline_default' && (scope === 'everyone' ? true : scope === 'shared' ? !isMine(x) && isShared(x.raw) : isMine(x)))
      .filter(x => showHidden || !x.raw.isHidden)
      .filter(x => !t || `${x.r.o.refNumber} ${x.r.o.courseTitle} ${x.r.o.preparedForCompany}`.toLowerCase().includes(t))
      .sort((a, b) => String(b.raw.date || '').localeCompare(String(a.raw.date || '')) || String(b.raw.id).localeCompare(String(a.raw.id)));
  }, [resolved, scope, search, showHidden, rep.id]);

  const canDelete = (o: CourseOutline) => staff || o.creatorId === me.id || o.ownerId === me.id;
  const act = async (fn: () => Promise<void>) => { setMenu(null); setError(''); try { await fn(); } catch (e) { setError(friendlyError(e)); } };

  return (
    <div className="space-y-4 font-sans text-ink">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Course outlines</h2>
          <p className="mt-0.5 text-[15px] text-ink-soft">Click an outline to open it.</p>
        </div>
        <button type="button" className={btnPrimary} onClick={onNew}><Plus className="h-4 w-4" /> New outline</button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-line bg-white p-0.5">
          {([...(canSeeEveryone ? [['everyone', "Everyone's"]] : []), ['mine', `Mine (${counts.mine})`], ['shared', `Shared with me (${counts.shared})`]] as [Scope, string][]).map(([k, t]) => (
            <button key={k} type="button" onClick={() => setScope(k)} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold ${scope === k ? 'bg-ink text-white' : 'text-ink-soft hover:text-ink'}`}>
              {t}{k === 'shared' && counts.unseen > 0 && <NewCount n={counts.unseen} />}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input type="checkbox" checked={showHidden} onChange={e => setShowHidden(e.target.checked)} className="h-4 w-4 accent-[#0E6E62]" /> Show hidden
        </label>
        <div className="relative ml-auto w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search ref, course or client" className={`${input} pl-9`} aria-label="Search outlines" />
        </div>
      </div>
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</p>}

      <div className="rounded-2xl border border-line bg-white">
        {!loaded ? (
          <p className="flex items-center gap-2 p-6 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading outlines…</p>
        ) : visible.length === 0 ? (
          <div className="p-8 text-center">
            <p className="font-semibold">No outlines here</p>
            <p className="mt-1 text-[15px] text-ink-soft">Create one with New outline, or from a deal (Deals → open a deal → Create outline).</p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {visible.map(({ raw: o, r }) => (
              <li key={o.id} className="relative flex items-center gap-2 px-4 hover:bg-surface">
                <button type="button" onClick={() => onOpen(o)} className="grid min-w-0 flex-1 gap-1 py-3 text-left sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_8rem] sm:items-center sm:gap-4">
                  <span className="min-w-0">
                    <span className="flex min-w-0 items-center gap-1.5 font-semibold"><span className="truncate">{r.o.courseTitle || 'Untitled outline'}</span>{unseen(o) && <span className="shrink-0 rounded bg-danger px-1.5 text-xs font-semibold text-white">New</span>}</span>
                    <span className="flex items-center gap-1.5 truncate text-sm text-ink-soft">
                      {o.refNumber}
                      {outlineSent(o) ? <span className="rounded bg-accent-soft px-1.5 text-xs font-semibold text-accent">Sent</span> : <span className="rounded bg-surface px-1.5 text-xs font-semibold">Draft</span>}
                      {o.isHidden && <span className="text-xs">hidden</span>}
                      {links.some(l => l.outlineId === o.id && l.status === 'submitted' && isLive(l)) && <span className="rounded bg-attention-soft px-1.5 text-xs font-semibold text-attention">Trainer submitted: review</span>}
                    </span>
                  </span>
                  <span className="min-w-0 text-[15px] text-ink-soft">
                    <span className="block truncate">{r.o.preparedForCompany || 'General'}</span>
                    <span className="block truncate text-sm">{summary(r.o)}</span>
                  </span>
                  <span className="text-sm text-ink-soft sm:text-right">
                    {formatDate(o.date) || '—'}
                    <span className="block truncate">{personName(r.ownerId) || o.preparedBy || ''}{(o.sharedWithIds || []).length ? ' · shared' : ''}</span>
                  </span>
                </button>
                <button type="button" onClick={() => setMenu(m => (m === o.id ? null : o.id))} className="rounded-md p-2 text-ink-soft hover:bg-white hover:text-ink" aria-label={`More for ${o.refNumber}`} aria-expanded={menu === o.id}>
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                {menu === o.id && (
                  <div role="menu" className="absolute right-4 top-12 z-20 w-48 overflow-hidden rounded-xl border border-line bg-white py-1 shadow-lg">
                    <MenuBtn icon={<Pencil className="h-4 w-4" />} text="Open" onClick={() => { setMenu(null); onOpen(o); }} />
                    <MenuBtn icon={<Copy className="h-4 w-4" />} text="Duplicate" onClick={() => act(() => onDuplicate(o))} />
                    <MenuBtn icon={o.isHidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />} text={o.isHidden ? 'Unhide' : 'Hide'}
                      onClick={() => act(() => setDoc(doc(db, 'course_outlines', o.id), { isHidden: !o.isHidden }, { merge: true }))} />
                    {canDelete(o) && (
                      <MenuBtn danger icon={<Trash2 className="h-4 w-4" />} text="Delete"
                        onClick={() => { if (window.confirm(`Delete outline ${o.refNumber}? This can't be undone.`)) act(() => deleteDoc(doc(db, 'course_outlines', o.id))); else setMenu(null); }} />
                    )}
                  </div>
                )}
              </li>
            ))}
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
function Editor({ initial, isNew, me, staff, reps, sources, dealsForPicker, onOpenTab, onClose, trainers, links, backToDeal }: {
  initial: CourseOutline; isNew: boolean; me: Viewer; staff: boolean; reps: Representative[]; sources: OutlineSources; dealsForPicker: any[];
  onOpenTab?: (tab: Tab) => void; onClose: () => void; key?: string; trainers: any[]; links: TrainerLink[];
  backToDeal?: () => void;   // shown as "Back to deal" when opened from a deal
}) {
  const [o, setO] = useState<CourseOutline>(initial);
  const [saved, setSaved] = useState<string>(isNew ? '' : JSON.stringify(initial));
  const [preview, setPreview] = useState(false);
  const [editMeta, setEditMeta] = useState(false);
  const [relinking, setRelinking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [gate, setGate] = useState<DealField[] | null>(null);   // the deal is missing details for "Proposal sent"
  const [dealWarn, setDealWarn] = useState('');                 // sent, but the deal couldn't be moved
  const [gapDeal, setGapDeal] = useState<any | null>(null);     // the deal right after the box saved its details
  const [sending, setSending] = useState(false);
  const [sentNow, setSentNow] = useState(false);                // sent in this visit: closing the Send window goes back to the deal
  const [pdfBusy, setPdfBusy] = useState(false);

  const r = resolveOutline(o, sources);
  const shownO = r.o;                       // what prints
  const locked = outlineSent(o);
  const clientLink = openLinkOf(useDocLinks(o.id), 'outline');   // the private client link, if one was made
  const dirty = JSON.stringify(o) !== saved;
  const set = (c: Partial<CourseOutline>) => setO(x => ({ ...x, ...c }));
  const shared: string[] = o.sharedWithIds || [];
  const nameOf = (id?: string) => reps.find(p => p.id === id)?.name || '';
  const items = o.items || [];
  const clientName = r.client?.companyName || '';

  const persist = async (out: CourseOutline, msg: string) => {
    setBusy(true);
    setError('');
    try {
      const final = clean({
        ...out,
        outcomes: trimList(out.outcomes),
        items: (out.items || []).map((m, i) => ({ ...m, no: i + 1 })),
        ...(out.methods ? { methods: trimList(out.methods) } : {}),
        ...(out.evaluation ? { evaluation: trimList(out.evaluation) } : {}),
        ...(out.nextTraining ? { nextTraining: trimList(out.nextTraining) } : {}),
      });
      await setDoc(doc(db, 'course_outlines', final.id), final);
      setO(final);
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
  const save = () => persist(o, 'Saved');
  // Sending the outline is sending the proposal (Joel, 2026-10-19): a deal at New moves to "Proposal sent", with the
  // same check as the deal's own button (programme from the list and the deal value; GapsBox asks for what's missing).
  // Only from New, so re-sending keeps the first date, and "Revise" never moves the deal back. Only the deal's
  // owner, Admin or Management may move it; anyone else still sends the outline and is told the deal stayed.
  // Send (2026-10-19, round 2): Email, WhatsApp or Download PDF + "Mark as sent", in the same window as quotations.
  // Before it opens, a deal at New is checked like its "Proposal sent" button; the box asks for anything missing.
  const deal = gapDeal || r.deal;
  const dealAtNew = !!deal && ['lead', 'appointment'].includes(dealStage(deal));
  // What prints now. After the box added details, it's read again with them; an outline with no title of its own
  // then takes the programme just picked on the deal.
  const sendO = gapDeal
    ? resolveOutline(!o.courseTitle?.trim() && !o.programmeId ? { ...o, useProgrammeName: true } : o, { ...sources, deals: sources.deals.map(d => (d.id === gapDeal.id ? gapDeal : d)) }).o
    : shownO;
  const startSend = () => {
    if (!locked) {
      const mayMove = dealAtNew && canMoveDeal(deal, me);
      const gaps = mayMove ? dealGaps(deal, 'proposal', { clientIds: sources.clients.map(c => c.id), programmeIds: sources.programmes.map(x => x.id) }) : [];
      // No title yet, and no programme coming from the box either: check first.
      if (!sendO.courseTitle?.trim() && !gaps.includes('programme') && !window.confirm('This outline has no course title. Send it anyway?')) return;
      if (gaps.length) { setGate(gaps); return; }
    }
    setGate(null);
    setSending(true);
  };
  const ensureSaved = async () => (dirty ? persist(o, 'Saved') : true);
  // Sent by email, WhatsApp or by hand: lock a copy of what prints now and log how it went (a resend only logs).
  const lockAsSent = async (entry: QuoteSendEntry) => {
    const how = entry.channel === 'email' ? 'Emailed' : entry.channel === 'whatsapp' ? 'Sent by WhatsApp' : entry.channel === 'link' ? 'Client link made' : 'Marked as sent';
    const sendLog = [...(o.sendLog || []), entry].slice(-30);
    const out: CourseOutline = locked ? { ...o, sendLog } : { ...sendO, status: 'sent', sentAt: entry.at, sentById: me.id, sentByName: me.name, sendLog };
    const ok = await persist(out, locked ? how : `${how} and locked`);
    if (ok) setSentNow(true);
    if (ok && !locked && dealAtNew) await toProposalSent(deal);
    return ok;
  };
  // Sending the outline is sending the proposal (Joel, 2026-10-19): the deal moves from New to "Proposal sent". Only from
  // New, so re-sending keeps the first date, and "Revise" never moves it back. Only the deal's owner, Admin or Management
  // may move it; anyone else still sends the outline and is told the deal stayed.
  const toProposalSent = async (d: any) => {
    setDealWarn('');
    if (!canMoveDeal(d, me)) {
      setDealWarn(`The deal is still at "New": only ${nameOf(dealOwnerId(d)) || 'the deal owner'}, Admin or Management can move it to "Proposal sent". Ask them to open the deal and click "Proposal sent".`);
      return;
    }
    try {
      const sent = /^\d{4}-\d{2}-\d{2}/.test(d.proposalSentDate || '') ? d.proposalSentDate : todayIso();
      await updateDoc(doc(db, 'pipelines', d.id), {
        stage: 'proposal', status: statusForStage('proposal'), proposalSentDate: sent,
        history: [...(d.history || []), { at: new Date().toISOString(), byId: me.id, byName: me.name, action: `Proposal sent: course outline ${o.refNumber || ''}`.trim() }].slice(-40),
      });
    } catch (e) {
      setDealWarn(`The outline is sent, but the deal couldn't be moved to "Proposal sent" (${friendlyError(e)}). Open the deal and click "Proposal sent".`);
    }
  };
  const downloadPdf = async () => {
    setPdfBusy(true);
    setError('');
    try {
      downloadBlob(await makeOutlinePdf(shownO), outlinePdfFileName(shownO));
    } catch (e: any) {
      setError(pdfErrorText(e));
    } finally {
      setPdfBusy(false);
    }
  };
  const revise = () => {
    if (!window.confirm('Unlock this outline to revise it? It will read the latest deal and client details again.')) return;
    return persist({ ...o, status: 'draft', sentAt: '', sentById: '', sentByName: '' }, 'Unlocked for revision');
  };
  const close = () => { if (!dirty || window.confirm('You have unsaved changes. Leave without saving?')) onClose(); };
  const goBackToDeal = () => { if (backToDeal && (!dirty || window.confirm('You have unsaved changes. Leave without saving?'))) backToDeal(); };
  const printIt = () => {
    const t = document.title;
    document.title = o.refNumber || 'Course outline';
    window.setTimeout(() => { window.print(); document.title = t; }, 100);
  };
  const relink = (deal: any | null) => {
    set(deal
      ? { pipelineId: deal.id, clientId: deal.clientId || '', programmeId: o.programmeId || deal.programmeId || '', useProgrammeName: !!(o.programmeId || deal.programmeId) || !!dealProgrammeName(deal, sources.programmes) }
      : { pipelineId: '', clientId: '', useProgrammeName: !!o.programmeId });
    setRelinking(false);
  };

  // Modules
  const setItem = (i: number, c: Partial<CourseOutlineItem>) => setO(x => ({ ...x, items: (x.items || []).map((m, k) => (k === i ? { ...m, ...c } : m)) }));
  const addItem = () => setO(x => ({ ...x, items: [...(x.items || []), newModule()] }));
  const removeItem = (i: number) => setO(x => ({ ...x, items: (x.items || []).filter((_, k) => k !== i) }));
  const moveItem = (i: number, dir: -1 | 1) => setO(x => {
    const list = [...(x.items || [])];
    const j = i + dir;
    if (j < 0 || j >= list.length) return x;
    [list[i], list[j]] = [list[j], list[i]];
    return { ...x, items: list };
  });
  // Training days (multi-day outlines): each module can be put on a day; "Day N: title" prints above them.
  const dayCount = Math.max(1, Math.ceil(o.durationDays || 0));
  const setDayTitle = (d: number, v: string) => setO(x => {
    const t = [...(x.dayTitles || [])];
    while (t.length < d) t.push('');
    t[d - 1] = v;
    return { ...x, dayTitles: t };
  });

  // Agenda rows
  const agenda = o.agenda || [];
  const setRow = (i: number, c: Partial<OutlineAgendaRow>) => setO(x => ({ ...x, agenda: (x.agenda || []).map((r, k) => (k === i ? { ...r, ...c } : r)) }));
  const addRow = (isDay = false) => setO(x => ({ ...x, agenda: [...(x.agenda || []), newRow(isDay)] }));
  const removeRow = (i: number) => setO(x => ({ ...x, agenda: (x.agenda || []).filter((_, k) => k !== i) }));
  const moveRow = (i: number, dir: -1 | 1) => setO(x => {
    const list = [...(x.agenda || [])];
    const j = i + dir;
    if (j < 0 || j >= list.length) return x;
    [list[i], list[j]] = [list[j], list[i]];
    return { ...x, agenda: list };
  });
  // A start: one row per module (and day headings), times left for the person to type.
  const agendaFromModules = () => setO(x => {
    const mods = (x.items || []).filter(m => (m.moduleTitle || '').trim());
    const byDay = dayCount > 1 && mods.some(m => m.day);
    const rows: OutlineAgendaRow[] = [];
    let last = 0;
    mods.forEach((m, i) => {
      const d = m.day || 1;
      if (byDay && d !== last) { rows.push({ ...newRow(true), text: `Day ${d}` }); last = d; }
      rows.push({ ...newRow(), text: `Module ${i + 1}: ${m.moduleTitle.trim()}` });
    });
    return { ...x, agenda: rows };
  });
  const termsText = o.terms === undefined ? DEFAULT_OUTLINE_TERMS : o.terms;

  const sendLabel = locked ? 'Send again' : dealAtNew ? 'Send proposal' : 'Send';
  const sendDialog = sending ? (
    <OutlineSendDialog
      shownO={sendO} locked={locked} issues={[]} deal={deal} client={r.client} ownerId={r.ownerId} me={me}
      ensureSaved={ensureSaved} onSent={lockAsSent}
      onClose={() => { setSending(false); if (sentNow && backToDeal && !dealWarn) backToDeal(); }}
    />
  ) : null;

  if (preview) {
    return (
      <div className="space-y-4 font-sans text-ink">
        <div className="no-print flex flex-wrap items-center justify-between gap-2">
          <span className="flex flex-wrap items-center gap-2">
            {backToDeal && <button type="button" className={btnSecondary} onClick={goBackToDeal}><ArrowLeft className="h-4 w-4" /> Back to deal</button>}
            <button type="button" className={btnSecondary} onClick={() => setPreview(false)}>{backToDeal ? <Pencil className="h-4 w-4" /> : <ArrowLeft className="h-4 w-4" />} Back to edit</button>
          </span>
          <span className="flex flex-wrap items-center gap-2">
            {dirty && <span className="text-sm text-attention">Not saved yet</span>}
            <button type="button" className={btnSecondary} onClick={printIt}><Printer className="h-4 w-4" /> Print</button>
            <button type="button" className={btnSecondary} disabled={pdfBusy} onClick={downloadPdf}>{pdfBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download PDF</button>
            <button type="button" className={btnPrimary} disabled={busy} onClick={startSend}><Send className="h-4 w-4" /> {sendLabel}</button>
          </span>
        </div>
        {error && <p role="alert" className="no-print rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</p>}
        <CourseOutlineDocument o={shownO} />
        {sendDialog}
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-24 font-sans text-ink">
      {/* Top line */}
      <div className="flex flex-wrap items-center gap-3">
        {backToDeal
          ? <button type="button" className={btnSecondary} onClick={goBackToDeal}><ArrowLeft className="h-4 w-4" /> Back to deal</button>
          : <button type="button" className={btnSecondary} onClick={close}><ArrowLeft className="h-4 w-4" /> Course outlines</button>}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-bold">{shownO.courseTitle || 'New course outline'}</h2>
          <p className="text-sm text-ink-soft">
            {o.refNumber} · {formatDate(o.date)} · Prepared by {o.preparedBy || me.name}{r.ownerId ? ` · Owner ${nameOf(r.ownerId) || o.ownerName || ''}` : ''}
            {!locked && <> {' '}<button type="button" className={linkBtn} onClick={() => setEditMeta(v => !v)}>{editMeta ? 'Done' : 'Edit'}</button></>}
          </p>
        </div>
      </div>

      {locked && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-accent/30 bg-accent-soft p-4 text-accent">
          <Lock className="h-5 w-5" />
          <div className="min-w-0 flex-1 text-[15px]">
            <p><strong>Sent {formatDate(o.sentAt || '')}</strong> by {o.sentByName}. This is the locked copy the client received.</p>
            {(o.sendLog || []).length > 0 && (
              <ul className="mt-1 space-y-0.5 text-sm">
                {(o.sendLog || []).slice().reverse().map((x, i) => (
                  <li key={`${x.at}-${i}`}>
                    {x.channel === 'email' ? 'Emailed' : x.channel === 'whatsapp' ? 'WhatsApp' : x.channel === 'link' ? 'Client link made' : 'Marked as sent'}
                    {x.to ? ` to ${x.to}` : ''}{x.cc ? ` (cc ${x.cc})` : ''} · {x.byName} · {formatDate(x.at)} {new Date(x.at).toLocaleTimeString('en-MY', { hour: 'numeric', minute: '2-digit' })}
                  </li>
                ))}
              </ul>
            )}
            {clientLink && <div className="mt-3 text-ink"><DocLinkBox link={clientLink} compact /></div>}
          </div>
          <button type="button" className={btnSecondary} onClick={revise}><Unlock className="h-4 w-4" /> Revise</button>
        </div>
      )}

      {!locked && editMeta && (
        <div className="grid gap-3 rounded-2xl border border-line bg-white p-4 sm:grid-cols-3">
          <div><label className={label} htmlFor="o-ref">Reference number</label><input id="o-ref" value={o.refNumber} onChange={e => set({ refNumber: e.target.value })} className={input} /></div>
          <div><label className={label} htmlFor="o-date">Date</label><input id="o-date" type="date" value={o.date} onChange={e => set({ date: e.target.value })} className={input} /></div>
          {staff && !r.deal && (
            <div>
              <label className={label} htmlFor="o-owner">Owner</label>
              <select id="o-owner" value={o.ownerId || ''} onChange={e => set({ ownerId: e.target.value, ownerName: nameOf(e.target.value) })} className={input}>
                {reps.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}
        </div>
      )}

      {!locked && (
        <TrainerCard o={o} r={r} me={me} trainers={trainers} links={links} saved={!!saved}
          onTrainer={id => set({ trainerId: id })}
          onAccept={s => {
            const hasContent = !!(o.overview || '').trim() || (o.items || []).some(m => (m.moduleTitle || m.topics || '').trim());
            if (hasContent && !window.confirm("Replace this outline's overview, outcomes and modules with what the trainer submitted?")) return false;
            set({
              durationDays: s.durationDays, totalHours: s.totalHours, audience: s.audience, prerequisites: s.prerequisites,
              overview: s.overview, outcomes: s.outcomes, items: s.items.map(m => ({ ...newModule(), ...m })),
            });
            setNote("Filled in from the trainer's submission. Check it, then click Save.");
            return true;
          }} />
      )}

      <fieldset disabled={locked} className="space-y-4">
        {/* 1. Deal and client */}
        <Card title="1. Deal and client" action={!locked && <button type="button" className={linkBtn} onClick={() => setRelinking(true)}><Link2 className="mr-1 inline h-4 w-4" />{r.deal ? 'Change' : 'Link a deal'}</button>}>
          {r.deal ? (
            <div className="rounded-xl bg-surface px-4 py-3">
              <p className="font-semibold">{clientName || r.deal.client || 'No client'}</p>
              <p className="text-sm text-ink-soft">
                {r.programmeName || 'No programme'} · {STAGE_LABELS[dealStage(r.deal)]} · {nameOf(dealOwnerId(r.deal))}
                {onOpenTab && <> · <button type="button" className={linkBtn} onClick={() => { if (!dirty || window.confirm('Leave this outline without saving?')) onOpenTab('pipeline'); }}>Edit deal</button></>}
              </p>
            </div>
          ) : r.client ? (
            <div className="rounded-xl bg-surface px-4 py-3">
              <p className="font-semibold">{clientName}</p>
              <p className="text-sm text-ink-soft">From the client list, not linked to a deal.</p>
            </div>
          ) : (
            <div>
              <label className={label} htmlFor="o-for">Prepared for <span className="font-normal text-ink-soft">(optional, for a general outline)</span></label>
              <input id="o-for" value={o.preparedForCompany || ''} onChange={e => set({ preparedForCompany: e.target.value })} className={input} placeholder="Leave blank for a general outline" />
            </div>
          )}
        </Card>

        {/* 2. Course details */}
        <Card title="2. Course details">
          <div className="space-y-3">
            <div>
              <label className={label} htmlFor="o-prog">Programme <span className="font-normal text-ink-soft">(optional; links this outline to the Programme list)</span></label>
              <select id="o-prog" value={r.programmeId} onChange={e => set({ programmeId: e.target.value, useProgrammeName: !!e.target.value })} className={input}>
                <option value="">{r.deal?.programmeId ? 'Use the deal\'s programme' : 'None (general outline)'}</option>
                {[...sources.programmes].sort((a, b) => String(a.name).localeCompare(String(b.name))).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {!o.programmeId && r.deal?.programmeId && <p className="mt-0.5 text-xs text-ink-soft">From the deal.</p>}
            </div>
            <div>
              <label className={label} htmlFor="o-title">Course title</label>
              {o.useProgrammeName && r.programmeName ? (
                <div className="rounded-lg bg-surface px-3 py-2">
                  <p className="font-semibold">{r.programmeName}</p>
                  <p className="text-sm text-ink-soft">The programme's name. {!locked && <button type="button" className={linkBtn} onClick={() => set({ useProgrammeName: false, courseTitle: r.programmeName })}>Type a different title</button>}</p>
                </div>
              ) : (
                <>
                  <input id="o-title" value={o.courseTitle || ''} onChange={e => set({ courseTitle: e.target.value })} className={input} placeholder="e.g. Leadership Essentials for New Managers" />
                  {r.programmeName && !locked && <button type="button" className={`${linkBtn} mt-1`} onClick={() => set({ useProgrammeName: true })}>Use the programme's name ({r.programmeName})</button>}
                </>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={label} htmlFor="o-days">Course duration (days)</label>
                <DecimalInput id="o-days" value={o.durationDays} onChange={v => set({ durationDays: v })} placeholder="e.g. 0.5 for half a day" />
              </div>
              <div>
                <label className={label} htmlFor="o-hours">Total hours <span className="font-normal text-ink-soft">(optional)</span></label>
                <DecimalInput id="o-hours" value={o.totalHours} onChange={v => set({ totalHours: v })} placeholder="e.g. 4" />
              </div>
            </div>
            <p className="-mt-1 text-sm text-ink-soft">Prints as "{durationText(o.durationDays, o.totalHours) || '…'}".</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={label} htmlFor="o-aud">Target audience <span className="font-normal text-ink-soft">(one per line)</span></label>
                <textarea id="o-aud" value={o.audience || ''} onChange={e => set({ audience: e.target.value })} className={`${input} min-h-[76px]`} placeholder="e.g. All employees across departments and levels" />
              </div>
              <div>
                <label className={label} htmlFor="o-pre">Pre-requisites</label>
                <textarea id="o-pre" value={o.prerequisites || ''} onChange={e => set({ prerequisites: e.target.value })} className={`${input} min-h-[76px]`} placeholder="e.g. None" />
              </div>
            </div>
          </div>
        </Card>

        {/* 3. Overview and outcomes */}
        <Card title="3. Overview and learning outcomes">
          <div className="space-y-3">
            <div>
              <label className={label} htmlFor="o-over">Overview</label>
              <textarea id="o-over" value={o.overview || ''} onChange={e => set({ overview: e.target.value })} className={`${input} min-h-[110px]`} placeholder="A short summary of what the course covers and why it matters." />
            </div>
            <div>
              <label className={label} htmlFor="o-out">Learning outcomes (one per line)</label>
              <p className="mb-1 text-sm text-ink-soft">Printed under "Upon completion of this program, the participants should be able to:"</p>
              <textarea id="o-out" value={(o.outcomes || []).join('\n')} onChange={e => set({ outcomes: e.target.value.split('\n') })} className={`${input} min-h-[110px]`} placeholder={'Understand their own and others\' personality styles\nCommunicate more effectively across differences'} />
            </div>
            <div>
              <label className={label} htmlFor="o-methods">Learning methods (one per line)</label>
              <textarea id="o-methods" value={(o.methods || []).join('\n')} onChange={e => set({ methods: e.target.value.split('\n') })} className={`${input} min-h-[90px]`} placeholder={'Interactive lecture & guided discussion\nRole-play simulations\nCase studies'} />
            </div>
          </div>
        </Card>

        {/* 4. Modules */}
        <Card title={`4. Modules (${items.length})`}>
          {dayCount > 1 && (
            <div className="mb-3 space-y-2 rounded-xl bg-surface p-3">
              <p className="text-sm text-ink-soft">This is a {dayCount}-day course: pick each module's day below. Day titles are optional (e.g. "Sales Planning Foundations").</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {Array.from({ length: dayCount }, (_, k) => (
                  <div key={k}>
                    <label className={label} htmlFor={`o-day-${k}`}>Day {k + 1} title</label>
                    <input id={`o-day-${k}`} value={o.dayTitles?.[k] || ''} onChange={e => setDayTitle(k + 1, e.target.value)} className={input} placeholder="Optional" />
                  </div>
                ))}
              </div>
            </div>
          )}
          <ol className="space-y-3">
            {items.map((m, i) => (
              <li key={m.id} className="rounded-xl border border-line p-3.5">
                <div className="flex items-start gap-3">
                  <span className="mt-2 w-6 shrink-0 text-center font-bold text-ink-soft">{i + 1}</span>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className={dayCount > 1 ? 'grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem]' : ''}>
                      <input value={m.moduleTitle} onChange={e => setItem(i, { moduleTitle: e.target.value })} className={input} placeholder="Module title" aria-label={`Module ${i + 1} title`} />
                      {dayCount > 1 && (
                        <select value={m.day || 1} onChange={e => setItem(i, { day: Number(e.target.value) })} className={input} aria-label={`Module ${i + 1} day`}>
                          {Array.from({ length: dayCount }, (_, k) => <option key={k} value={k + 1}>Day {k + 1}</option>)}
                        </select>
                      )}
                    </div>
                    <textarea value={m.topics} onChange={e => setItem(i, { topics: e.target.value })} className={`${input} min-h-[80px]`} placeholder={'Topics, one per line\nIcebreakers to create engagement and trust\nSetting the tone for collaboration'} aria-label={`Module ${i + 1} topics`} />
                  </div>
                  {!locked && (
                    <span className="flex shrink-0 flex-col">
                      <button type="button" className={iconBtn} disabled={i === 0} onClick={() => moveItem(i, -1)} aria-label={`Move module ${i + 1} up`}><ArrowUp className="h-4 w-4" /></button>
                      <button type="button" className={iconBtn} disabled={i === items.length - 1} onClick={() => moveItem(i, 1)} aria-label={`Move module ${i + 1} down`}><ArrowDown className="h-4 w-4" /></button>
                      <button type="button" className={`${iconBtn} hover:text-danger`} onClick={() => removeItem(i)} aria-label={`Remove module ${i + 1}`}><X className="h-4 w-4" /></button>
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ol>
          {!locked && <button type="button" className={`${btnSecondary} mt-3`} onClick={addItem}><Plus className="h-4 w-4" /> Add module</button>}
        </Card>

        {/* 5. Agenda */}
        <Card title={`5. Course agenda (optional${agenda.length ? `, ${agenda.filter(r => !r.isDay).length} time slots` : ''})`}>
          <p className="mb-3 text-[15px] text-ink-soft">Only some courses need an agenda. Leave this empty and the outline has no agenda page, just the modules. If you add time slots, they print as a table on their own page. "Module 1" at the start prints in bold.</p>
          {agenda.length > 0 && (
            <ol className="space-y-2">
              {agenda.map((row, i) => (
                <li key={row.id} className={`flex items-start gap-2 rounded-xl border border-line p-2.5 ${row.isDay ? 'bg-surface' : ''}`}>
                  <div className={`min-w-0 flex-1 ${row.isDay ? '' : 'grid gap-2 sm:grid-cols-[13rem_minmax(0,1fr)]'}`}>
                    {!row.isDay && <input value={row.time} onChange={e => setRow(i, { time: e.target.value })} className={input} placeholder="9:00 AM – 9:35 AM" aria-label={`Agenda row ${i + 1} time`} />}
                    <input value={row.text} onChange={e => setRow(i, { text: e.target.value })} className={`${input} ${row.isDay ? 'font-semibold' : ''}`}
                      placeholder={row.isDay ? 'Day 1' : 'Module 1: Ice breaker & team warm-up'} aria-label={row.isDay ? `Day heading ${i + 1}` : `Agenda row ${i + 1}`} />
                  </div>
                  {!locked && (
                    <span className="flex shrink-0 items-center">
                      <button type="button" className={iconBtn} disabled={i === 0} onClick={() => moveRow(i, -1)} aria-label={`Move agenda row ${i + 1} up`}><ArrowUp className="h-4 w-4" /></button>
                      <button type="button" className={iconBtn} disabled={i === agenda.length - 1} onClick={() => moveRow(i, 1)} aria-label={`Move agenda row ${i + 1} down`}><ArrowDown className="h-4 w-4" /></button>
                      <button type="button" className={`${iconBtn} hover:text-danger`} onClick={() => removeRow(i)} aria-label={`Remove agenda row ${i + 1}`}><X className="h-4 w-4" /></button>
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
          {!locked && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className={btnSecondary} onClick={() => addRow()}><Plus className="h-4 w-4" /> Add time slot</button>
              {dayCount > 1 && <button type="button" className={btnSecondary} onClick={() => addRow(true)}><Plus className="h-4 w-4" /> Add day heading</button>}
              {items.some(m => (m.moduleTitle || '').trim()) && (
                <button type="button" className={btnSecondary}
                  onClick={() => { if (!agenda.length || window.confirm('Replace the agenda with one row per module?')) agendaFromModules(); }}>
                  Fill in from the modules
                </button>
              )}
            </div>
          )}
        </Card>

        {/* 6. Optional extras */}
        <Card title="6. Optional extras">
          <p className="mb-3 text-[15px] text-ink-soft">Printed on the overview page only when filled in.</p>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className={label} htmlFor="o-diff">Difficulty</label>
                <select id="o-diff" value={o.difficulty || ''} onChange={e => set({ difficulty: e.target.value })} className={input}>
                  <option value="">Don't show</option>
                  {DIFFICULTIES.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className={label} htmlFor="o-bloom">Bloom's taxonomy level</label>
                <select id="o-bloom" value={o.bloomLevel || 0} onChange={e => set({ bloomLevel: Number(e.target.value) })} className={input}>
                  <option value={0}>Don't show</option>
                  {BLOOM_LEVELS.map((b, k) => <option key={b} value={k + 1}>Level {k + 1}: {b}</option>)}
                </select>
              </div>
              <div>
                <label className={label} htmlFor="o-by">Designed by</label>
                <input id="o-by" value={o.designedBy || ''} onChange={e => set({ designedBy: e.target.value })} className={input} placeholder="e.g. the trainer's name" />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={label} htmlFor="o-eval">Evaluation method (one per line)</label>
                <textarea id="o-eval" value={(o.evaluation || []).join('\n')} onChange={e => set({ evaluation: e.target.value.split('\n') })} className={`${input} min-h-[76px]`} placeholder={'Quiz\nGroup presentation'} />
              </div>
              <div>
                <label className={label} htmlFor="o-next">Recommended next training (one per line)</label>
                <textarea id="o-next" value={(o.nextTraining || []).join('\n')} onChange={e => set({ nextTraining: e.target.value.split('\n') })} className={`${input} min-h-[76px]`} placeholder={'Emotional Quotient - Level 1'} />
              </div>
            </div>
          </div>
        </Card>

        {/* 7. Terms */}
        <Card title="7. Terms and conditions"
          action={!locked && !o.hideTerms && o.terms !== undefined && o.terms !== DEFAULT_OUTLINE_TERMS && (
            <button type="button" className={linkBtn} onClick={() => { if (window.confirm('Go back to the standard terms? Your changes to the terms will be lost.')) setO(x => { const { terms: _t, ...rest } = x; return rest as CourseOutline; }); }}>Use the standard terms</button>
          )}>
          <label className="mb-3 flex items-center gap-2 text-[15px]">
            <input type="checkbox" checked={!o.hideTerms} onChange={e => set({ hideTerms: !e.target.checked })} className="h-4 w-4 accent-[#0E6E62]" />
            Include the "Administrative details" page (terms and HRD Corp badges)
          </label>
          {!o.hideTerms && (
            <>
              <textarea value={termsText} onChange={e => set({ terms: e.target.value })} className={`${input} min-h-[220px] text-sm`} aria-label="Terms and conditions" />
              <p className="mt-1 text-sm text-ink-soft">"1. …" lines are headings, "- …" lines are bullet points, and "Label: …" prints the label in bold.{o.terms === undefined || o.terms === DEFAULT_OUTLINE_TERMS ? ' These are the standard terms.' : ' Changed for this outline only.'}</p>
            </>
          )}
        </Card>
      </fieldset>

      {/* 8. Sharing (allowed even when sent) */}
      <Card title="8. Share with teammates">
        <p className="mb-2 text-[15px] text-ink-soft">People you add can open and edit this same outline. It appears in their list under "Shared with me".</p>
        <ShareWithBox people={reps.map(p => ({ id: p.id, name: p.name, role: p.role }))} ownerId={r.ownerId} shared={shared} log={o.sharedLog} me={me}
          onChange={c => set(c)} />
      </Card>

      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</p>}
      {gate && r.deal && (
        <GapsBox deal={r.deal} gaps={gate} step="Proposal sent" programmes={sources.programmes as Programme[]} clients={sources.clients} viewer={me}
          onSaved={updated => { setGapDeal(updated); setGate(null); setSending(true); }} onCancel={() => setGate(null)} />
      )}
      {dealWarn && (
        <p role="alert" className="flex items-start gap-2 rounded-xl border border-attention/30 bg-attention-soft px-4 py-3 text-[15px] text-attention">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{dealWarn}
        </p>
      )}

      {/* Bottom bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3">
          <span className="text-[15px] font-semibold">{summary(shownO)}</span>
          <span className={`text-sm ${dirty ? 'text-attention' : 'text-ink-soft'}`}>{note || (dirty ? 'Not saved yet' : locked ? 'Sent and locked' : 'All changes saved')}</span>
          <span className="ml-auto flex flex-wrap gap-2">
            <button type="button" className={btnSecondary} onClick={() => setPreview(true)}><Eye className="h-4 w-4" /> Preview</button>
            <button type="button" className={btnSecondary} disabled={pdfBusy} onClick={downloadPdf}>{pdfBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download PDF</button>
            <button type="button" className={btnSecondary} disabled={busy || !!gate} onClick={startSend}><Send className="h-4 w-4" /> {sendLabel}</button>
            <button type="button" className={btnPrimary} disabled={busy || !dirty} onClick={save}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save</button>
          </span>
        </div>
      </div>
      {sendDialog}

      {relinking && (
        <DealChooser deals={dealsForPicker} sources={sources} personName={nameOf} onPick={relink} onCancel={() => setRelinking(false)} allowGeneral title="Link this outline to a deal" />
      )}
    </div>
  );
}

// ---------- The trainer's part: who wrote it, and the private link to fill it in (Joel, 2026-10-17) ----------
function TrainerCard({ o, r, me, trainers, links, saved, onTrainer, onAccept }: {
  o: CourseOutline; r: ReturnType<typeof resolveOutline>; me: Viewer; trainers: any[]; links: TrainerLink[]; saved: boolean;
  onTrainer: (id: string) => void; onAccept: (s: OutlineSubmission) => boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const trainer = trainers.find(t => t.id === o.trainerId);
  const link = links.filter(l => l.kind === 'outline' && l.outlineId === o.id && isLive(l)).sort((a, b) => b.createdAt - a.createdAt)[0];
  const title = r.programmeName || r.o.courseTitle || 'this training';
  const run = async (fn: () => Promise<any>) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };
  const send = () => run(() => createTrainerLink({ kind: 'outline', outlineId: o.id, trainerId: trainer?.id || '', trainerName: trainer?.name || '', title }, me));
  const sub = link?.status === 'submitted' ? (link.submission as OutlineSubmission) : null;

  return (
    <section className="space-y-3 rounded-2xl border border-line bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold">Trainer</h3>
        <span className="text-sm text-ink-soft">The trainer can fill in this outline from a private link, no login needed.</span>
      </div>
      <select value={o.trainerId || ''} onChange={e => onTrainer(e.target.value)} className={input} aria-label="Trainer for this outline">
        <option value="">No trainer chosen</option>
        {trainerOptions(trainers, r.programmeId).map(t => <option key={t.id} value={t.id}>{t.name}{t.hint ? ` (${t.hint.toLowerCase()})` : ''}</option>)}
      </select>
      {!link ? (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={btnSecondary} disabled={busy || !saved} onClick={send}>Send to trainer</button>
          {!saved && <span className="text-sm text-ink-soft">Save the outline first.</span>}
        </div>
      ) : (
        <>
          {sub && (
            <div className="rounded-xl border border-attention/40 bg-attention-soft/40 p-3">
              <p className="font-semibold">{link.trainerName || 'The trainer'} submitted the outline{link.submittedAt ? ` on ${formatDate(new Date(link.submittedAt).toISOString().slice(0, 10))}` : ''}.</p>
              <p className="text-sm text-ink-soft">{sub.durationDays} day{sub.durationDays === 1 ? '' : 's'} · {sub.totalHours} hours · {sub.items.length} module{sub.items.length === 1 ? '' : 's'}: {sub.items.map(m => m.moduleTitle).join(', ')}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className={btnPrimary} disabled={busy} onClick={() => { if (onAccept(sub)) run(() => closeTrainerLink(link, 'accepted', me)); }}>Accept into this outline</button>
                <button type="button" className={btnSecondary} disabled={busy} onClick={() => { if (window.confirm("Discard what the trainer submitted? The link will be closed.")) run(() => closeTrainerLink(link, 'cancelled', me)); }}>Discard</button>
              </div>
            </div>
          )}
          <LinkShareBox link={link} phone={trainer?.contact}
            message={`Hi${link.trainerName ? ` ${link.trainerName}` : ''}, please fill in your course outline for "${link.title || title}" for NEXT Academy here:`}
            onCancel={() => { if (window.confirm('Cancel this link? The trainer will no longer be able to open it.')) run(() => closeTrainerLink(link, 'cancelled', me)); }} />
        </>
      )}
      {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
    </section>
  );
}

// A number box that lets "0." be typed on the way to "0.5".
function DecimalInput({ id, value, onChange, placeholder }: { id: string; value?: number; onChange: (v: number) => void; placeholder?: string }) {
  const [text, setText] = useState(value ? String(value) : '');
  useEffect(() => { if ((Number(text) || 0) !== (value || 0)) setText(value ? String(value) : ''); }, [value]);
  return (
    <input id={id} inputMode="decimal" value={text} placeholder={placeholder} className={input}
      onChange={e => { const t = e.target.value.replace(/[^0-9.]/g, ''); setText(t); onChange(Number(t) || 0); }} />
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
