import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, query, setDoc, updateDoc, where } from 'firebase/firestore';
import {
  AlertTriangle, ArrowLeft, BookmarkPlus, ClipboardList, ChevronDown, ChevronRight, Copy, Download, Eye, EyeOff, FilePlus2, Laptop, Library, Link2, Loader2, Lock,
  MoreHorizontal, Pencil, Plus, RectangleHorizontal, RectangleVertical, RotateCcw, Search, Send, Smartphone, Table2, Trash2, Unlock, UserPlus, X,
} from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import { CourseOutline, QuoteSendEntry, Representative } from '../types';
import { proposalFromOutline } from '../lib/outlineTb';
import { DealField, STAGE_LABELS, canMoveDeal, dealGaps, dealOwnerId, dealStage, formatDate, statusForStage, todayIso } from '../lib/deals';
import { dealProgrammeName } from '../lib/outlineResolve';
import { linkedOnly } from '../lib/linked';
import { isUnseen, markSharedSeen, useSharedSeen } from '../lib/sharedInbox';
import {
  AGENDA_TAGS, AgendaTag, DEFAULT_HRDC_NOTE, ResolvedTb, SECTION_HINTS, TB_TERMS_DEFAULT, TbAgendaDay, TbPoint, TbProposal, TbProposalActivity,
  TbSectionKey, TbSources, TbTrainer, TbVenueOption, activityFromLibrary, blankActivity, blankProposalContent, cleanForSave, copyContent,
  lockedCopy, newTbId, nextTbRef, PENDING_APPROVAL, resolveTb, sectionsOf, tbSent, tbSummary, venuePhotos,
} from '../lib/teambuilding';
import { downloadBlob } from '../lib/quotePdf';
import type { TbPdfLayout } from '../lib/tbPdf';
import { useCloseOnOutside } from '../lib/useCloseOnOutside';
import { GapsBox } from './DealGates';
import { Programme, typingCaps } from '../lib/programmes';
import TitlesView, { TitleDoc, TitleGroup } from './TitleList';
import TitleTagsBox from './TitleTagsBox';
import ShareWithBox, { NewCount } from './ShareWithBox';
import { TeambuildingSendDialog } from './QuoteSendDialog';
import TeambuildingSite from './TeambuildingSite';
import PhoneFrame from './PhoneFrame';
import PhotoPicker from './PhotoPicker';
import DocLinkBox, { openLinkOf, useDocLinks } from './DocLinkBox';
import CustomerCodeBox, { needsCustomerCode, nudgeCustomerCode } from './CustomerCodeBox';
import { clientCode, refWithCode } from '../lib/docRefs';
import { autoSaveText, leaveAfterSave, useAutoSave } from '../lib/useAutoSave';
import { AcceptBlock } from './ProposalLinkPage';
import { ActivityLibrary, PackageTemplate, cleanActivity, useActivities, usePackageTemplate } from './TeambuildingLibrary';
import { LinkShareBox, closeTrainerLink, createTrainerLink, useTrainerLinks } from './TrainerLinkTools';
import { TrainerLink, isLive } from '../lib/trainerLinks';
import { programmeTypeOf } from '../lib/outlineTb';
import ListPager, { SortSelect, listSelect } from './ListPager';
import { sortList, usePaged, type ListSort } from '../lib/listPaging';
import { ActivityForm, Agenda, Card, NumberBox, PackageEditor, Points, UpDown, btnPrimary, btnSecondary, iconBtn, input, label, linkBtn, move } from './TeambuildingParts';

// Teambuilding proposal (Joel, 2026-10-19; push A1). Its own menu item next to Course outlines, which it doesn't touch.
// Three tabs: Proposals · Activity library · Package template (everyone can amend all three).
// A proposal is made for a deal (or as a general one), blank or copied from an earlier proposal. While it's a draft,
// the client, date, group size, trainers' names/photos and venues are read live (lib/teambuilding.ts resolveTb).
// The client sees a website (TeambuildingSite.tsx); Preview shows exactly that, on a computer or phone width.
// Sending (Email / WhatsApp / Download PDF + Mark as sent) locks it and moves a New deal to "Proposal sent",
// exactly like sending a course outline. Download PDF is a printout of the website with the client's name watermarked.

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };
type Tab = 'proposals' | 'activities' | 'template';
const TAB_KEY = 'next_tb_tab';
const toneClass = { soft: 'text-ink-soft', attention: 'text-attention', danger: 'text-danger' };

export default function TeambuildingPage({ rep, reps, viewer, startDeal, onStartHandled, openId, onOpenHandled, startOnShared, fromDealId, onBackToDeal, onOpenDeals, fromOutline, onFromOutlineHandled, onSpeedOutline }: {
  rep: Representative; reps: Representative[]; viewer?: Viewer; key?: string;
  fromOutline?: CourseOutline | null;   // "Speed build proposal" on a teambuilding outline: open the proposal made from it, or make one
  onFromOutlineHandled?: () => void;
  onSpeedOutline?: (p: TbProposal, dealId: string | null) => void;   // "Speed course outline" on a proposal
  startDeal?: any | null;            // "Create teambuilding proposal" on a deal
  onStartHandled?: () => void;
  openId?: string | null;            // open this proposal straight in the editor
  onOpenHandled?: () => void;
  startOnShared?: boolean;
  fromDealId?: string | null;        // opened from this deal: "Back to deal"
  onBackToDeal?: (dealId: string) => void;
  onOpenDeals?: () => void;
}) {
  const me: Viewer = viewer || { id: rep.id, name: rep.name, role: (rep.role as any) || 'rep' };
  const staff = me.role !== 'rep';
  const [tab, setTabState] = useState<Tab>(() => { try { return (localStorage.getItem(TAB_KEY) as Tab) || 'proposals'; } catch { return 'proposals'; } });
  const setTab = (t: Tab) => { setTabState(t); try { localStorage.setItem(TAB_KEY, t); } catch { /* private window */ } };
  const [list, setList] = useState<TbProposal[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [deals, setDeals] = useState<any[]>([]);
  const [trainers, setTrainers] = useState<any[]>([]);
  const [venues, setVenues] = useState<any[]>([]);
  const [programmes, setProgrammes] = useState<any[]>([]);
  const [tbOutlines, setTbOutlines] = useState<CourseOutline[]>([]);   // teambuilding course outlines (for HRDC), shown on their title
  const [loaded, setLoaded] = useState(false);
  const template = usePackageTemplate();
  const [draft, setDraft] = useState<{ p: TbProposal; isNew: boolean } | null>(null);
  const [choosing, setChoosing] = useState<null | { step: 'deal'; forTitle?: ForTitle } | { step: 'start'; deal: any | null; forTitle?: ForTitle }>(null);
  const [backDeal, setBackDeal] = useState<string | null>(null);
  const [docError, setDocError] = useState('');
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    const all = (s: any) => s.docs.map((d: any) => ({ ...d.data(), id: d.id }));
    const subs = [
      onSnapshot(query(collection(db, 'teambuilding_proposals')), s => { setList(linkedOnly(all(s)) as TbProposal[]); setLoaded(true); }, () => setLoaded(true)),
      onSnapshot(query(collection(db, 'clients')), s => setClients(all(s)), () => {}),
      onSnapshot(query(collection(db, 'pipelines')), s => setDeals(linkedOnly(all(s))), () => {}),
      onSnapshot(query(collection(db, 'trainers_directory')), s => setTrainers(all(s)), () => {}),
      onSnapshot(query(collection(db, 'venues_directory')), s => setVenues(all(s)), () => {}),
      onSnapshot(query(collection(db, 'programmes')), s => setProgrammes(all(s)), () => {}),
      onSnapshot(query(collection(db, 'course_outlines'), where('kind', '==', 'teambuilding')), s => setTbOutlines(linkedOnly(all(s)) as CourseOutline[]), () => {}),
    ];
    return () => subs.forEach(u => u());
  }, []);

  const sources: TbSources = useMemo(() => ({ clients, deals, trainers, venues, people: reps.map(r => ({ id: r.id, name: r.name })) }), [clients, deals, trainers, venues, reps]);
  const personName = (id?: string) => reps.find(r => r.id === id)?.name || '';
  const dealsForPicker = deals.filter(d => (staff && me.id === rep.id ? true : dealOwnerId(d) === rep.id) && dealStage(d) !== 'lost');

  // "Create teambuilding proposal" on a deal: open its draft if it has one (no duplicates), else "Start from".
  useEffect(() => {
    if (!startDeal || !loaded) return;
    setTab('proposals');
    setBackDeal(fromDealId || null);
    const existing = list.filter(p => p.pipelineId === startDeal.id && !tbSent(p)).sort((a, b) => String(b.date || b.id).localeCompare(String(a.date || a.id)))[0];
    if (existing) { setChoosing(null); open(existing); } else { setDraft(null); setChoosing({ step: 'start', deal: startDeal }); }
    onStartHandled?.();
  }, [startDeal, loaded]);
  useEffect(() => {
    if (!openId) return;
    const p = list.find(x => x.id === openId);
    if (!p) return;
    setTab('proposals');
    setBackDeal(fromDealId || null);
    open(p);
    onOpenHandled?.();
  }, [openId, list]);
  // "Speed build proposal" on a teambuilding course outline (2026-10-24): the proposal already made from it opens; else a
  // draft is saved from the outline (objectives, activities, agenda, trainer, terms; lib/outlineTb.ts) with the package
  // template, for the same deal, and opened to add photos, venues and packages.
  useEffect(() => {
    if (!fromOutline || !loaded || !template.loaded) return;
    onFromOutlineHandled?.();
    setTab('proposals');
    setBackDeal(fromDealId || null);
    const made = list.filter(x => x.fromOutlineId === fromOutline.id).sort((a, b) => String(b.date || b.id).localeCompare(String(a.date || a.id)))[0];
    if (made) { setChoosing(null); open(made); return; }
    const deal = fromOutline.pipelineId ? deals.find(d => d.id === fromOutline.pipelineId) || null : null;
    const date = todayIso();
    const ownerId = (deal && dealOwnerId(deal)) || fromOutline.ownerId || rep.id;
    const p: TbProposal = JSON.parse(JSON.stringify({
      ...blankProposalContent(template.pk), ...proposalFromOutline(fromOutline, fromOutline.programmeId || ''),
      id: `tb_${Date.now()}`, refNumber: nextTbRef(list, date, clientCode(clients.find(c => c.id === (deal?.clientId || fromOutline.clientId)))), refAuto: true, date,
      preparedBy: me.name, creatorId: me.id, ownerId, ownerName: personName(ownerId) || rep.name,
      clientId: deal?.clientId || fromOutline.clientId || '', pipelineId: deal?.id || '', preparedForCompany: deal ? '' : fromOutline.preparedForCompany || '',
      status: 'draft', sharedWithIds: [], isHidden: false,
    }));
    setDocError('');
    setDoc(doc(db, 'teambuilding_proposals', p.id), cleanForSave(p)).then(() => { setChoosing(null); open(p); })
      .catch(e => setDocError(`Couldn't make the proposal: ${friendlyError(e)}`));
  }, [fromOutline, loaded, template.loaded]);
  const leave = () => {
    const d = backDeal;
    setDraft(null); setChoosing(null); setBackDeal(null);
    if (d && onBackToDeal) onBackToDeal(d);
  };

  // forTitle: "Write proposal" on a title (By title view) makes it for that title.
  const createFrom = (deal: any | null, base: TbProposal | null, forTitle?: ForTitle) => {
    const date = todayIso();
    const ownerId = (deal && dealOwnerId(deal)) || rep.id;
    const content = base ? { ...blankProposalContent(template.pk), ...copyContent(base) } : blankProposalContent(template.pk);
    const p: TbProposal = {
      ...content,
      id: `tb_${Date.now()}`, refNumber: nextTbRef(list, date, clientCode(clients.find(c => c.id === deal?.clientId))), refAuto: true, date,
      preparedBy: me.name, creatorId: me.id, ownerId, ownerName: personName(ownerId) || rep.name,
      clientId: deal?.clientId || '', pipelineId: deal?.id || '', preparedForCompany: '',
      title: forTitle?.name || content.title || (deal ? dealProgrammeName(deal, programmes) : ''),
      programmeId: forTitle?.programmeId || deal?.programmeId || '',
      status: 'draft', sharedWithIds: [], isHidden: false,
    } as TbProposal;
    setChoosing(null);
    setDraft({ p, isNew: true });
  };
  // "Invite a trainer to write one" (Joel, 2026-10-26): the proposal is made first, general, with our package template;
  // the trainer's link (and their portal, if they have one) writes their parts straight into it.
  const makeForTrainer = async (programmeId: string, trainer: any): Promise<TbProposal> => {
    const date = todayIso();
    const prog = programmes.find(x => x.id === programmeId);
    const p: TbProposal = JSON.parse(JSON.stringify({
      ...blankProposalContent(template.pk),
      id: `tb_${Date.now()}`, refNumber: nextTbRef(list, date, ''), refAuto: true, date,
      preparedBy: me.name, creatorId: me.id, ownerId: rep.id, ownerName: rep.name,
      clientId: '', pipelineId: '', preparedForCompany: '', title: prog?.name || '', programmeId: prog?.id || '',
      writerTrainerId: trainer?.id || '', writerTrainerName: trainer?.name || '',
      ...(trainer ? { trainers: [{ id: newTbId('tr'), trainerId: trainer.id, role: 'Accredited HRDC Trainer' }] } : {}),
      status: 'draft', sharedWithIds: [], isHidden: false,
    }));
    await setDoc(doc(db, 'teambuilding_proposals', p.id), cleanForSave(p));
    return p;
  };
  const open = (p: TbProposal) => {
    markSharedSeen(me.id, 'teambuilding', p);
    setDraft({ p: JSON.parse(JSON.stringify({ ...blankProposalContent(null), ...p })), isNew: false });
  };
  const duplicate = async (p: TbProposal) => {
    const date = todayIso();
    const copy: TbProposal = JSON.parse(JSON.stringify({
      ...p, id: `tb_${Date.now()}`, refNumber: nextTbRef(list, date, clientCode(resolveTb(p, sources).client)), refAuto: true, date, preparedBy: me.name, creatorId: me.id,
      status: 'draft', sentAt: '', sentById: '', sentByName: '', sendLog: [], sharedWithIds: [], sharedLog: {}, isHidden: false,
    }));
    await setDoc(doc(db, 'teambuilding_proposals', copy.id), copy);
    open(copy);
  };

  if (draft) {
    return (
      <Editor key={draft.p.id} initial={draft.p} isNew={draft.isNew} me={me} staff={staff} reps={reps} sources={sources} programmes={programmes}
        dealsForPicker={dealsForPicker} templatePk={template.pk} onClose={() => { setDraft(null); setBackDeal(null); }}
        backToDeal={backDeal && onBackToDeal ? leave : undefined} onOpenDeals={onOpenDeals} live={list.find(x => x.id === draft.p.id)}
        onSpeedOutline={onSpeedOutline ? (x: TbProposal) => onSpeedOutline(x, backDeal) : undefined} />
    );
  }

  return (
    <div className="space-y-4 font-sans text-ink">
      <div>
        <h2 className="text-xl font-bold">Teambuilding proposal</h2>
        <p className="mt-0.5 text-[15px] text-ink-soft">A website made for each client: objectives, trainers, agenda, activities, venues and packages.</p>
      </div>
      <div className="inline-flex rounded-xl border border-line bg-white p-1" role="tablist">
        {([['proposals', 'Proposals', <FilePlus2 className="h-4 w-4" />], ['activities', 'Activity library', <Library className="h-4 w-4" />], ['template', 'Package template', <Table2 className="h-4 w-4" />]] as [Tab, string, React.ReactNode][]).map(([k, t, icon]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === k ? 'bg-ink text-white' : 'text-ink-soft hover:text-ink'}`}>
            {icon}<span>{t}</span>
          </button>
        ))}
      </div>
      {tab === 'activities' ? <ActivityLibrary me={me} />
        : tab === 'template' ? <PackageTemplate me={me} />
        : (
          <>
          {docError && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{docError}</p>}
          <ProposalList rep={rep} me={me} staff={staff} list={list} loaded={loaded} sources={sources} personName={personName} startOnShared={startOnShared}
            onNew={() => setChoosing({ step: 'deal' })} onInvite={() => setInviting(true)} onOpen={open} onDuplicate={duplicate} programmes={programmes} tbOutlines={tbOutlines}
            onWriteTitle={g => setChoosing({ step: 'deal', forTitle: { programmeId: g.programme?.id, name: g.name } })} />
          </>
        )}
      {inviting && <InviteModal me={me} trainers={trainers} programmes={programmes} outlines={tbOutlines} onMake={makeForTrainer} onClose={() => setInviting(false)} />}
      {choosing?.step === 'deal' && (
        <DealChooser deals={dealsForPicker} clients={clients} programmes={programmes} personName={personName}
          onPick={deal => setChoosing({ step: 'start', deal, forTitle: choosing.forTitle })} onCancel={() => setChoosing(null)} allowGeneral />
      )}
      {choosing?.step === 'start' && (
        <StartChooser deal={choosing.deal} list={list} sources={sources} clients={clients}
          onPick={base => createFrom(choosing.deal, base, choosing.forTitle)} onBack={() => setChoosing({ step: 'deal', forTitle: choosing.forTitle })} onCancel={() => (backDeal ? leave() : setChoosing(null))} />
      )}
    </div>
  );
}

// ---------- Choosers ----------
// ---------- A trainer writing the proposal (Joel, 2026-10-26) ----------
const tbLinkMessage = (l: TrainerLink, title: string) =>
  `Hi${l.trainerName ? ` ${l.trainerName}` : ''}, please fill in your teambuilding proposal${title ? ` "${title}"` : ''} for NEXT Academy here. It saves as you type, and you can preview it:`;
const sortedTrainers = (trainers: any[]) => trainers.filter(t => String(t.name || '').trim() && !t.archived).sort((a, b) => String(a.name).localeCompare(String(b.name)));

function InviteModal({ me, trainers, programmes, outlines, onMake, onClose }: {
  me: Viewer; trainers: any[]; programmes: any[]; outlines: any[]; onMake: (programmeId: string, trainer: any) => Promise<TbProposal>; onClose: () => void;
}) {
  const [programmeId, setProgrammeId] = useState('');
  const [trainerId, setTrainerId] = useState('');
  const [link, setLink] = useState<TrainerLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const tbTitles = programmes.filter(x => programmeTypeOf(x, outlines) === 'teambuilding').sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const progName = String(programmes.find(x => x.id === programmeId)?.name || '').trim();
  const trainer = trainers.find(t => t.id === trainerId);
  const make = async () => {
    setBusy(true); setError('');
    try {
      const p = await onMake(programmeId, trainer);
      setLink(await createTrainerLink({ kind: 'teambuilding', proposalId: p.id, programmeId, title: progName, trainerId: trainer?.id || '', trainerName: trainer?.name || '' }, me));
    } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title="Invite a trainer to write a teambuilding proposal" onCancel={onClose}>
      {!link ? (
        <div className="space-y-3">
          <p className="text-[15px] text-ink-soft">A new proposal is made here now (general, marked "by" the trainer). The trainer gets a private link (no login) and writes the cover, objectives, trainers, agenda, activities and takeaways straight into it, as they type. You add the packages, venues and the rest.</p>
          <div>
            <label className={label} htmlFor="tinv-prog">Title <span className="font-normal text-ink-soft">(optional; the trainer can type one)</span></label>
            <select id="tinv-prog" value={programmeId} onChange={e => setProgrammeId(e.target.value)} className={input}>
              <option value="">Not chosen</option>
              {tbTitles.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="tinv-trainer">Trainer <span className="font-normal text-ink-soft">(optional, for a trainer already in the list)</span></label>
            <select id="tinv-trainer" value={trainerId} onChange={e => setTrainerId(e.target.value)} className={input}>
              <option value="">Someone not in the list / not chosen</option>
              {sortedTrainers(trainers).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className={btnSecondary} onClick={onClose}>Cancel</button>
            <button type="button" className={btnPrimary} disabled={busy} onClick={make}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Make the link</button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-[15px]">Send this link to {link.trainerName || 'the trainer'}. It works for 14 days. The proposal is in your list, marked "by {link.trainerName || 'trainer'}".</p>
          <LinkShareBox link={link} phone={trainer?.contact} message={tbLinkMessage(link, progName)} />
          <div className="flex justify-end"><button type="button" className={btnPrimary} onClick={onClose}>Done</button></div>
        </div>
      )}
    </Modal>
  );
}

// In the editor: who writes it, and the private link for the trainer (make, share, cancel).
function TrainerLinkCard({ p, me, trainers, saved }: { p: TbProposal; me: Viewer; trainers: any[]; saved: boolean }) {
  const links = useTrainerLinks();
  const link = links.filter(l => l.kind === 'teambuilding' && l.proposalId === p.id && isLive(l)).sort((a, b) => b.createdAt - a.createdAt)[0];
  const [trainerId, setTrainerId] = useState(p.writerTrainerId || (p.trainers || []).find(t => t.trainerId)?.trainerId || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<any>) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };
  const trainer = trainers.find(t => t.id === (link?.trainerId || trainerId));
  const send = () => run(() => createTrainerLink({
    kind: 'teambuilding', proposalId: p.id, programmeId: p.programmeId || '', title: p.title || '', trainerId: trainer?.id || '', trainerName: trainer?.name || '',
  }, me));
  return (
    <section className="space-y-3 rounded-2xl border border-line bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold">Trainer link</h3>
        <span className="text-sm text-ink-soft">A trainer can write their parts of this proposal from a private link, no login needed. It goes straight in here.</span>
      </div>
      {p.writerTrainerName && (
        <p className="text-[15px]">
          <strong>Written with {p.writerTrainerName}</strong>{p.writerTrainerId ? ' (also in their trainer portal)' : ''}. They change the cover, objectives, trainers,
          agenda, activities and takeaways until it's sent to a client.
          {p.trainerEditedAt ? ` Their last change: ${formatDate(new Date(p.trainerEditedAt).toISOString().slice(0, 10))}.` : ''}
        </p>
      )}
      {link ? (
        <LinkShareBox link={link} phone={trainer?.contact} message={tbLinkMessage(link, p.title || '')}
          onCancel={() => { if (window.confirm('Cancel this link? The trainer will no longer be able to open it.')) run(() => closeTrainerLink(link, 'cancelled', me)); }} />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <select value={trainerId} onChange={e => setTrainerId(e.target.value)} className={`${input} w-auto min-w-[14rem]`} aria-label="Trainer to send the link to">
            <option value="">Someone not in the list</option>
            {sortedTrainers(trainers).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button type="button" className={btnSecondary} disabled={busy || !saved} onClick={send}><UserPlus className="h-4 w-4" /> Send to trainer</button>
          {!saved && <span className="text-sm text-ink-soft">It saves first: type something.</span>}
        </div>
      )}
      {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
    </section>
  );
}

function Modal({ title, onCancel, children, wide }: { title: string; onCancel: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4 pt-16" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className={`w-full ${wide ? 'max-w-4xl' : 'max-w-2xl'} rounded-2xl bg-white p-5 font-sans text-ink shadow-xl`} onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <h3 className="text-lg font-bold">{title}</h3>
          <button type="button" onClick={onCancel} className="rounded-md p-1 text-ink-soft hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function SearchBox({ value, onChange, placeholder, autoFocus }: { value: string; onChange: (v: string) => void; placeholder: string; autoFocus?: boolean }) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
      <input autoFocus={autoFocus} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={`${input} pl-9`} aria-label={placeholder} />
    </div>
  );
}

function DealChooser({ deals, clients, programmes, personName, onPick, onCancel, allowGeneral, title = 'Which deal is this proposal for?' }: {
  deals: any[]; clients: any[]; programmes: any[]; personName: (id?: string) => string;
  onPick: (deal: any | null) => void; onCancel: () => void; allowGeneral?: boolean; title?: string;
}) {
  const [search, setSearch] = useState('');
  const clientName = (d: any) => clients.find(c => c.id === d.clientId)?.companyName || d.client || 'No client';
  const t = search.trim().toLowerCase();
  const shown = deals
    .filter(d => !t || `${clientName(d)} ${dealProgrammeName(d, programmes)} ${d.enquiryNote || ''} ${personName(dealOwnerId(d))}`.toLowerCase().includes(t))
    .sort((a, b) => String(b.requestDate || b.id).localeCompare(String(a.requestDate || a.id)))
    .slice(0, 40);
  return (
    <Modal title={title} onCancel={onCancel}>
      <SearchBox value={search} onChange={setSearch} placeholder="Search client, programme or rep" autoFocus />
      <ul className="mt-3 max-h-[50vh] divide-y divide-line overflow-y-auto rounded-xl border border-line">
        {shown.length === 0 && <li className="p-4 text-ink-soft">No deals found.</li>}
        {shown.map(d => (
          <li key={d.id}>
            <button type="button" onClick={() => onPick(d)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-surface">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{clientName(d)}</span>
                <span className="block truncate text-sm text-ink-soft">{dealProgrammeName(d, programmes) || d.enquiryNote || 'No programme'} · {personName(dealOwnerId(d))}</span>
              </span>
              <span className="shrink-0 text-sm text-ink-soft">{STAGE_LABELS[dealStage(d)]}</span>
            </button>
          </li>
        ))}
      </ul>
      {allowGeneral && <button type="button" className={`${linkBtn} mt-3`} onClick={() => onPick(null)}>Make a general proposal, not for a client</button>}
    </Modal>
  );
}

function StartChooser({ deal, list, sources, clients, onPick, onBack, onCancel }: {
  deal: any | null; list: TbProposal[]; sources: TbSources; clients: any[];
  onPick: (base: TbProposal | null) => void; onBack: () => void; onCancel: () => void;
}) {
  const [search, setSearch] = useState('');
  const t = search.trim().toLowerCase();
  const resolved = useMemo(() => list.filter(p => !p.isHidden).map(p => resolveTb(p, sources)), [list, sources]);
  const shown = resolved
    .filter(r => !t || `${r.p.title} ${r.company} ${r.p.refNumber}`.toLowerCase().includes(t))
    .sort((a, b) => String(b.p.date || '').localeCompare(String(a.p.date || '')))
    .slice(0, 40);
  const clientName = deal ? clients.find(c => c.id === deal.clientId)?.companyName || deal.client || '' : '';
  return (
    <Modal title="Start from" onCancel={onCancel}>
      <p className="-mt-1 mb-3 text-[15px] text-ink-soft">{deal ? `For ${clientName || 'this deal'}` : 'General proposal, not for a client'}</p>
      <button type="button" onClick={() => onPick(null)} className={`${btnSecondary} w-full justify-start`}><FilePlus2 className="h-4 w-4" /> Blank proposal (packages from the template)</button>
      <p className="mb-2 mt-4 text-sm font-semibold">Or copy an earlier proposal</p>
      <SearchBox value={search} onChange={setSearch} placeholder="Search title or client" />
      <ul className="mt-3 max-h-[40vh] divide-y divide-line overflow-y-auto rounded-xl border border-line">
        {shown.length === 0 && <li className="p-4 text-ink-soft">No proposals to copy yet.</li>}
        {shown.map(r => (
          <li key={r.p.id}>
            <button type="button" onClick={() => onPick(r.p)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-surface">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{r.p.title || 'Untitled'}</span>
                <span className="block truncate text-sm text-ink-soft">{r.company || 'General'} · {r.p.refNumber} · {tbSummary(r.p)}</span>
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

// ---------- List ----------
type Scope = 'mine' | 'shared' | 'everyone';

type ForTitle = { programmeId?: string; name: string };
// By title (2026-10-24): one row per title with every client's proposal under it; All proposals is the list as before.
type ListView = 'titles' | 'all';
const VIEW_KEY = 'tb_view';

function ProposalList({ rep, me, staff, list, loaded, sources, personName, onNew, onInvite, onOpen, onDuplicate, startOnShared, programmes, onWriteTitle, tbOutlines }: {
  tbOutlines: CourseOutline[];
  rep: Representative; me: Viewer; staff: boolean; list: TbProposal[]; loaded: boolean; sources: TbSources; personName: (id?: string) => string;
  startOnShared?: boolean; onNew: () => void; onInvite: () => void; onOpen: (p: TbProposal) => void; onDuplicate: (p: TbProposal) => Promise<void>;
  programmes: Programme[]; onWriteTitle: (g: TitleGroup) => void;
}) {
  const [view, setViewState] = useState<ListView>(() => { try { return startOnShared ? 'all' : (localStorage.getItem(VIEW_KEY) as ListView) || 'titles'; } catch { return 'titles'; } });
  const setView = (v: ListView) => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* private window */ } };
  const canSeeEveryone = staff && me.id === rep.id;
  const [scope, setScope] = useState<Scope>(startOnShared ? 'shared' : canSeeEveryone ? 'everyone' : 'mine');
  const seen = useSharedSeen(me.id === rep.id ? me.id : undefined);
  const unseen = (p: TbProposal) => me.id === rep.id && isUnseen('teambuilding', p, me.id, seen);
  const [search, setSearch] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [sortBy, setSortBy] = useState<ListSort>('newest');
  const [ownerFilter, setOwnerFilter] = useState('');
  const resolved = useMemo(() => list.map(p => ({ raw: p, r: resolveTb(p, sources) })), [list, sources]);
  const titleDocs: TitleDoc[] = useMemo(() => resolved
    .filter(x => !x.raw.isHidden && !(x.raw as any).dealDeleted)
    .map(({ raw, r }) => ({
      id: raw.id, title: String(r.p.title || '').trim(),
      programmeId: (raw as any).programmeId || sources.deals.find(d => d.id === raw.pipelineId)?.programmeId || '',
      company: r.company || '', ref: raw.refNumber || '', date: raw.date || '', sent: tbSent(raw), raw,
    })), [resolved, sources.deals]);
  const isMine = (x: { raw: TbProposal; r: ResolvedTb }) => x.r.ownerId === rep.id || x.raw.creatorId === rep.id;
  const isShared = (p: TbProposal) => (p.sharedWithIds || []).includes(rep.id);
  const counts = { mine: resolved.filter(isMine).length, shared: resolved.filter(x => !isMine(x) && isShared(x.raw)).length, unseen: list.filter(unseen).length };
  const shown = useMemo(() => {
    const t = search.trim().toLowerCase();
    const rows = resolved
      .filter(x => (scope === 'everyone' ? true : scope === 'shared' ? !isMine(x) && isShared(x.raw) : isMine(x)))
      .filter(x => showHidden || !x.raw.isHidden)
      .filter(x => !t || `${x.raw.refNumber} ${x.r.p.title} ${x.r.company}`.toLowerCase().includes(t))
      .filter(x => !ownerFilter || x.r.ownerId === ownerFilter);
    return sortList(rows, sortBy, x => x.r.p.title || '', x => (x.raw as any).createdAt || x.raw.date);
  }, [resolved, scope, search, showHidden, rep.id, ownerFilter, sortBy]);
  const paged = usePaged(shown, [scope, search, showHidden, ownerFilter, sortBy]);
  const owners = useMemo(() => [...new Set(resolved.map(x => x.r.ownerId).filter(Boolean))]
    .map(id => ({ id, name: personName(id) })).filter(o => o.name).sort((a, b) => a.name.localeCompare(b.name)), [resolved]);
  const canDelete = (p: TbProposal) => staff || p.creatorId === me.id || p.ownerId === me.id;
  const act = async (fn: () => Promise<void>) => { setMenu(null); setError(''); try { await fn(); } catch (e) { setError(friendlyError(e)); } };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-line bg-white p-0.5" role="tablist" aria-label="Show">
          {([['titles', 'By title'], ['all', 'All proposals']] as [ListView, string][]).map(([k, t]) => (
            <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold ${view === k ? 'bg-accent text-white' : 'text-ink-soft hover:text-ink'}`}>{t}</button>
          ))}
        </div>
        <span className="ml-auto flex flex-wrap gap-2">
          <button type="button" className={btnSecondary} onClick={onInvite}><UserPlus className="h-4 w-4" /> Invite a trainer to write one</button>
          {view === 'titles' && <button type="button" className={btnPrimary} onClick={onNew}><Plus className="h-4 w-4" /> New proposal</button>}
        </span>
      </div>
      {view === 'titles' ? (
        <TitlesView kind="teambuilding" programmes={programmes} docs={titleDocs} deals={sources.deals} trainers={sources.trainers} outlines={tbOutlines}
          viewer={me} loaded={loaded} onOpenDoc={d => onOpen(d.raw)} onWrite={onWriteTitle} />
      ) : <>
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-line bg-white p-0.5">
          {([...(canSeeEveryone ? [['everyone', "Everyone's"]] : []), ['mine', `Mine (${counts.mine})`], ['shared', `Shared with me (${counts.shared})`]] as [Scope, string][]).map(([k, t]) => (
            <button key={k} type="button" onClick={() => setScope(k)} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold ${scope === k ? 'bg-ink text-white' : 'text-ink-soft hover:text-ink'}`}>
              {t}{k === 'shared' && counts.unseen > 0 && <NewCount n={counts.unseen} />}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-soft"><input type="checkbox" checked={showHidden} onChange={e => setShowHidden(e.target.checked)} className="h-4 w-4 accent-[#0E6E62]" /> Show hidden</label>
        <span className="ml-auto flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <span className="w-full sm:w-64"><SearchBox value={search} onChange={setSearch} placeholder="Search ref, title or client" /></span>
          <button type="button" className={btnPrimary} onClick={onNew}><Plus className="h-4 w-4" /> New proposal</button>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SortSelect value={sortBy} onChange={setSortBy} label="Sort proposals" />
        {scope !== 'mine' && owners.length > 1 && (
          <select value={ownerFilter} onChange={e => setOwnerFilter(e.target.value)} className={listSelect} aria-label="Rep">
            <option value="">Any rep</option>
            {owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        )}
      </div>
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</p>}
      <div className="rounded-2xl border border-line bg-white">
        {!loaded ? (
          <p className="flex items-center gap-2 p-6 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading proposals…</p>
        ) : shown.length === 0 ? (
          <div className="p-8 text-center">
            <p className="font-semibold">No teambuilding proposals here</p>
            <p className="mt-1 text-[15px] text-ink-soft">Create one with New proposal, or from a deal (Deals → open a deal → Create teambuilding proposal).</p>
          </div>
        ) : (
          <><ul className="divide-y divide-line">
            {paged.pageItems.map(({ raw: p, r }) => (
              <li key={p.id} className="relative flex items-center gap-2 px-4 hover:bg-surface">
                <button type="button" onClick={() => onOpen(p)} className="grid min-w-0 flex-1 gap-1 py-3 text-left sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_8rem] sm:items-center sm:gap-4">
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="hidden h-11 w-16 shrink-0 overflow-hidden rounded-lg bg-accent-soft sm:block">{p.coverPhoto && <img src={p.coverPhoto} alt="" className="h-full w-full object-cover" />}</span>
                    <span className="min-w-0">
                      <span className="flex min-w-0 items-center gap-1.5 font-semibold"><span className="truncate">{r.p.title || 'Untitled proposal'}</span>{unseen(p) && <span className="shrink-0 rounded bg-danger px-1.5 text-xs font-semibold text-white">New</span>}</span>
                      <span className="flex items-center gap-1.5 truncate text-sm text-ink-soft">
                        {p.refNumber}
                        {tbSent(p) ? <span className="rounded bg-accent-soft px-1.5 text-xs font-semibold text-accent">Sent</span> : <span className="rounded bg-surface px-1.5 text-xs font-semibold">Draft</span>}
                        {p.isHidden && <span className="text-xs">hidden</span>}
                        {p.writerTrainerName && <span className="truncate rounded bg-surface px-1.5 text-xs font-semibold text-ink">by {p.writerTrainerName}</span>}
                      </span>
                    </span>
                  </span>
                  <span className="min-w-0 text-[15px] text-ink-soft">
                    <span className="block truncate">{r.company || 'General'}</span>
                    <span className="block truncate text-sm">{tbSummary(r.p)}</span>
                  </span>
                  <span className="text-sm text-ink-soft sm:text-right">
                    {formatDate(p.date) || '—'}
                    <span className="block truncate">{personName(r.ownerId) || p.preparedBy || ''}{(p.sharedWithIds || []).length ? ' · shared' : ''}</span>
                  </span>
                </button>
                <button type="button" onClick={() => setMenu(m => (m === p.id ? null : p.id))} className="rounded-md p-2 text-ink-soft hover:bg-white hover:text-ink" aria-label={`More for ${p.refNumber}`} aria-expanded={menu === p.id}>
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                {menu === p.id && (
                  <div role="menu" className="absolute right-4 top-12 z-20 w-48 overflow-hidden rounded-xl border border-line bg-white py-1 shadow-lg">
                    <MenuBtn icon={<Pencil className="h-4 w-4" />} text="Open" onClick={() => { setMenu(null); onOpen(p); }} />
                    <MenuBtn icon={<Copy className="h-4 w-4" />} text="Duplicate" onClick={() => act(() => onDuplicate(p))} />
                    <MenuBtn icon={p.isHidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />} text={p.isHidden ? 'Unhide' : 'Hide'}
                      onClick={() => act(() => setDoc(doc(db, 'teambuilding_proposals', p.id), { isHidden: !p.isHidden }, { merge: true }))} />
                    {canDelete(p) && (
                      <MenuBtn danger icon={<Trash2 className="h-4 w-4" />} text="Delete"
                        onClick={() => { if (window.confirm(`Delete proposal ${p.refNumber}? This can't be undone.`)) act(() => deleteDoc(doc(db, 'teambuilding_proposals', p.id))); else setMenu(null); }} />
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
          <ListPager paged={paged} noun="proposals" /></>
        )}
      </div>
      </>}
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
function Editor({ initial, isNew, me, staff, reps, sources, programmes, dealsForPicker, templatePk, onClose, backToDeal, onOpenDeals, live, onSpeedOutline }: {
  initial: TbProposal; isNew: boolean; me: Viewer; staff: boolean; reps: Representative[]; sources: TbSources; programmes: any[];
  onSpeedOutline?: (p: TbProposal) => void;   // "Speed course outline"
  live?: TbProposal;   // the record as it is in the database now (a trainer may be writing it)
  dealsForPicker: any[]; templatePk: any; onClose: () => void; backToDeal?: () => void; onOpenDeals?: () => void; key?: string;
}) {
  const [p, setP] = useState<TbProposal>(initial);
  const [saved, setSaved] = useState(isNew ? '' : JSON.stringify(initial));
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [relinking, setRelinking] = useState(false);
  const [gate, setGate] = useState<DealField[] | null>(null);
  const [gapDeal, setGapDeal] = useState<any | null>(null);
  const [dealWarn, setDealWarn] = useState('');
  const [sending, setSending] = useState(false);
  const [sentNow, setSentNow] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const { list: library } = useActivities();

  const set = (c: Partial<TbProposal>) => setP(x => ({ ...x, ...c }));
  const srcNow = gapDeal ? { ...sources, deals: sources.deals.map(d => (d.id === gapDeal.id ? gapDeal : d)) } : sources;
  const r = resolveTb(p, srcNow);
  const locked = tbSent(p);
  // A draft numbered by the CRM takes its client's customer code (added, or swapped when the client changes).
  const wantRef = !locked && p.refAuto ? refWithCode(p.refNumber, clientCode(r.client)) : p.refNumber;
  useEffect(() => { if (wantRef !== p.refNumber) set({ refNumber: wantRef }); }, [wantRef]);
  const clientLink = openLinkOf(useDocLinks(p.id), 'teambuilding');   // the client's private link, if one was made
  const dirty = JSON.stringify(p) !== saved;
  // The trainer writes straight into this proposal (2026-10-26). Their newer change comes in by itself when nothing is
  // typed here yet; otherwise saving waits until it's loaded, so neither side overwrites the other.
  const theirs = live && (live.trainerEditedAt || 0) > (p.trainerEditedAt || 0) ? live : null;
  const takeTheirs = () => {
    if (!theirs) return;
    const c = JSON.parse(JSON.stringify({ ...blankProposalContent(null), ...theirs }));
    setP(c);
    setSaved(JSON.stringify(c));
  };
  useEffect(() => { if (theirs && !dirty) takeTheirs(); }, [theirs?.trainerEditedAt]);
  const nameOf = (id?: string) => reps.find(x => x.id === id)?.name || '';
  const deal = r.deal;
  const dealAtNew = !!deal && ['lead', 'appointment'].includes(dealStage(deal));
  const [pax, setPax] = useState(r.pax || 0);
  useEffect(() => { if (!p.pax && r.pax !== pax) setPax(r.pax); }, [r.pax]);
  const changePax = (n: number) => { setPax(n); set({ pax: n }); };

  const persist = async (out: TbProposal, msg: string) => {
    if (theirs && dirty) { setError(`Load ${theirs.writerTrainerName || "the trainer"}'s changes first (the box above).`); return false; }
    setBusy(true); setError('');
    try {
      const final = cleanForSave({ ...out, updatedAt: new Date().toISOString() });
      await setDoc(doc(db, 'teambuilding_proposals', final.id), JSON.parse(JSON.stringify(final)));
      setP(final); setSaved(JSON.stringify(final));
      setNote(msg); window.setTimeout(() => setNote(''), 2500);
      return true;
    } catch (e) { setError(friendlyError(e)); return false; } finally { setBusy(false); }
  };
  const save = () => persist(p, 'Saved');
  const ensureSaved = async () => (dirty ? persist(p, 'Saved') : true);
  // Drafts save themselves a couple of seconds after the last change, and before leaving (see lib/useAutoSave.ts).
  // A new proposal only once something in it was changed (the customer code going in doesn't count).
  const touched = !isNew || saved !== '' || JSON.stringify({ ...p, refNumber: '' }) !== JSON.stringify({ ...initial, refNumber: '' });
  const auto = useAutoSave({
    value: p, dirty, enabled: !locked && touched && !busy && !theirs,
    write: async v => { await setDoc(doc(db, 'teambuilding_proposals', v.id), JSON.parse(JSON.stringify(cleanForSave({ ...v, updatedAt: new Date().toISOString() })))); },
    onSaved: setSaved,
  });
  const status = note ? { text: note, tone: 'soft' as const }
    : theirs && dirty ? { text: "Not saved: load the trainer's changes first", tone: 'attention' as const }
      : autoSaveText(auto.state, dirty && touched, locked, touched);
  const close = () => leaveAfterSave(auto.flush, onClose);
  // "Speed course outline": saved first, then the course outline made from it (or the one already made) opens.
  const speedOutline = () => {
    if (!onSpeedOutline) return;
    const go = () => onSpeedOutline({ ...p, programmeId: p.programmeId || deal?.programmeId || '' });
    if (locked || !dirty) go(); else persist(p, 'Saved').then(ok => { if (ok) go(); });
  };
  const goBack = () => { if (backToDeal) leaveAfterSave(auto.flush, backToDeal); };

  // Sending the proposal: a deal at New moves to "Proposal sent", with the same check as its own button
  // (programme from the list and the deal value). Same rules as course outlines.
  const startSend = () => {
    if (!locked && needsCustomerCode(r.client, p.refAuto)) return nudgeCustomerCode();
    if (!locked) {
      const mayMove = dealAtNew && canMoveDeal(deal, me);
      const gaps = mayMove ? dealGaps(deal, 'proposal', { clientIds: sources.clients.map(c => c.id), programmeIds: programmes.map(x => x.id) }) : [];
      if (!r.p.title.trim() && !window.confirm('This proposal has no title. Send it anyway?')) return;
      if (gaps.length) { setGate(gaps); return; }
    }
    setGate(null);
    setSending(true);
  };
  const lockAsSent = async (entry: QuoteSendEntry) => {
    const how = entry.channel === 'email' ? 'Emailed' : entry.channel === 'whatsapp' ? 'Sent by WhatsApp' : entry.channel === 'link' ? 'Client link made' : 'Marked as sent';
    const sendLog = [...(p.sendLog || []), entry].slice(-30);
    const out: TbProposal = locked ? { ...p, sendLog } : { ...lockedCopy({ ...r, pax }), status: 'sent', sentAt: entry.at, sentById: me.id, sentByName: me.name, sendLog };
    const ok = await persist(out, locked ? how : `${how} and locked`);
    if (ok) setSentNow(true);
    if (ok && !locked && dealAtNew) await toProposalSent(deal);
    return ok;
  };
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
        history: [...(d.history || []), { at: new Date().toISOString(), byId: me.id, byName: me.name, action: `Proposal sent: teambuilding proposal ${p.refNumber || ''}`.trim() }],
      });
    } catch (e) {
      setDealWarn(`The proposal is sent, but the deal couldn't be moved to "Proposal sent" (${friendlyError(e)}). Open the deal and click "Proposal sent".`);
    }
  };
  const revise = () => {
    if (!window.confirm('Unlock this proposal to revise it? It will read the latest deal, client, trainer and venue details again.')) return;
    return persist({ ...p, status: 'draft', sentAt: '', sentById: '', sentByName: '' }, 'Unlocked for revision');
  };
  const makePdf = async () => (await import('../lib/tbPdf')).makeTbPdf(r, pax);
  const downloadPdf = async (layout: TbPdfLayout) => {
    setPdfBusy(true); setError('');
    try { const { makeTbPdf, tbPdfFileName } = await import('../lib/tbPdf'); downloadBlob(await makeTbPdf(r, pax, layout), tbPdfFileName(r, layout)); }
    catch (e: any) { setError(`The PDF couldn't be made (${e?.message || e}).`); }
    finally { setPdfBusy(false); }
  };
  const relink = (d: any | null) => {
    set(d ? { pipelineId: d.id, clientId: d.clientId || '', title: p.title || dealProgrammeName(d, programmes) } : { pipelineId: '', clientId: '' });
    setRelinking(false);
  };

  const sendDialog = sending ? (
    <TeambuildingSendDialog
      sendDoc={{ id: p.id, refNumber: p.refNumber, company: r.company, attn: '', programmes: r.p.title ? [r.p.title] : [], fileName: `Teambuilding proposal ${p.refNumber.replace(/[\\/:*?"<>|]+/g, '-')}${r.company ? ` - ${r.company.replace(/[\\/:*?"<>|]+/g, '').slice(0, 40)}` : ''}.pdf`, makePdf }}
      locked={locked} issues={[]} deal={deal} client={r.client} ownerId={r.ownerId} me={me}
      ensureSaved={ensureSaved} onSent={lockAsSent}
      onClose={() => { setSending(false); if (sentNow && backToDeal && !dealWarn) backToDeal(); }}
    />
  ) : null;
  const sendLabel = locked ? 'Send again' : dealAtNew ? 'Send proposal' : 'Send';

  if (preview) {
    return <Preview r={r} pax={pax} onPax={locked ? undefined : changePax} onBack={() => setPreview(false)} dirty={dirty && touched}
      pdfBusy={pdfBusy} onPdf={downloadPdf} onSend={startSend} sendLabel={sendLabel} busy={busy} error={error} sendDialog={sendDialog} />;
  }

  const sections = sectionsOf(p);
  const setSections = (next: typeof sections) => set({ sections: next });
  const editCard = (key: TbSectionKey) => {
    const s = sections.find(x => x.key === key)!;
    const title = <span className="flex flex-wrap items-center gap-2">{s.title}{s.hidden && <span className="rounded bg-surface px-1.5 text-xs font-semibold text-ink-soft">Not shown</span>}</span>;
    switch (key) {
      case 'objectives': return <Card key={key} id={`ed-${key}`} title={title} hint={SECTION_HINTS[key]}><Points list={p.objectives} onChange={objectives => set({ objectives })} prefix="ob" titlePh="e.g. Growth mindset and resilient leadership" textPh="Why it matters for this team" /></Card>;
      case 'trainers': return <Card key={key} id={`ed-${key}`} title={title} hint={SECTION_HINTS[key]}><Trainers list={p.trainers} trainers={sources.trainers} me={me} onChange={trainers => set({ trainers })} /></Card>;
      case 'agenda': return <Card key={key} id={`ed-${key}`} title={title} hint={SECTION_HINTS[key]}><Agenda days={p.agenda} onChange={agenda => set({ agenda })} /></Card>;
      case 'activities': return (
        <Card key={key} id={`ed-${key}`} title={title} hint={SECTION_HINTS[key]}
          action={<button type="button" className={btnSecondary} onClick={() => setPicking(true)}><Library className="h-4 w-4" /> Add from library</button>}>
          <Activities list={p.activities} me={me} library={library} onChange={activities => set({ activities })} />
        </Card>
      );
      case 'venues': return <Card key={key} id={`ed-${key}`} title={title} hint={SECTION_HINTS[key]}><Venues list={p.venues} venues={sources.venues} me={me} company={r.company} onChange={venues => set({ venues })} /></Card>;
      case 'packages': return (
        <Card key={key} id={`ed-${key}`} title={title} hint={SECTION_HINTS[key]}
          action={<button type="button" className={linkBtn} onClick={() => { if (window.confirm('Replace this proposal\'s packages with the Package template?')) set({ packages: JSON.parse(JSON.stringify(templatePk || blankProposalContent(null).packages)) }); }}><RotateCcw className="mr-1 inline h-4 w-4" />Use the template</button>}>
          <PackageEditor pk={p.packages} onChange={packages => set({ packages })} pax={pax} />
        </Card>
      );
      case 'takeaways': return <Card key={key} id={`ed-${key}`} title={title} hint={SECTION_HINTS[key]}><Points list={p.takeaways} onChange={takeaways => set({ takeaways })} prefix="tk" titlePh="e.g. Enhanced collaboration" textPh="One or two lines" /></Card>;
      case 'hrdc': return (
        <Card key={key} id={`ed-${key}`} title={title} hint={deal && !r.isHrdc ? 'This deal isn\'t HRDC funded, so the note is not shown.' : SECTION_HINTS[key]}
          action={p.hrdcNote !== undefined && p.hrdcNote !== DEFAULT_HRDC_NOTE && <button type="button" className={linkBtn} onClick={() => setP(x => { const { hrdcNote: _h, ...rest } = x; return rest as TbProposal; })}>Use the standard note</button>}>
          <textarea value={p.hrdcNote ?? DEFAULT_HRDC_NOTE} onChange={e => set({ hrdcNote: e.target.value })} rows={3} className={`${input} resize-y`} aria-label="HRDC note" />
        </Card>
      );
      case 'terms': return (
        <Card key={key} id={`ed-${key}`} title={title} hint={SECTION_HINTS[key]}
          action={p.terms !== undefined && p.terms !== TB_TERMS_DEFAULT && <button type="button" className={linkBtn} onClick={() => { if (window.confirm('Go back to the standard terms?')) setP(x => { const { terms: _t, ...rest } = x; return rest as TbProposal; }); }}>Use the standard terms</button>}>
          <textarea value={p.terms ?? TB_TERMS_DEFAULT} onChange={e => set({ terms: e.target.value })} className={`${input} min-h-[200px] text-sm`} aria-label="Terms and conditions" />
          <p className="mt-1 text-sm text-ink-soft">"1. …" lines are headings, "- …" lines are bullet points, "Label: …" shows the label in bold.{p.terms === undefined ? ' These are the standard terms.' : ' Changed for this proposal only.'}</p>
        </Card>
      );
    }
  };

  return (
    <div className="space-y-4 pb-24 font-sans text-ink">
      <div className="flex flex-wrap items-center gap-3">
        {backToDeal
          ? <button type="button" className={btnSecondary} onClick={goBack}><ArrowLeft className="h-4 w-4" /> Back to deal</button>
          : <button type="button" className={btnSecondary} onClick={close}><ArrowLeft className="h-4 w-4" /> Teambuilding proposals</button>}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-bold">{r.p.title || 'New teambuilding proposal'}</h2>
          <p className="text-sm text-ink-soft">{p.refNumber} · {formatDate(p.date)} · Prepared by {p.preparedBy || me.name}{r.ownerId ? ` · Owner ${nameOf(r.ownerId) || p.ownerName || ''}` : ''}</p>
        </div>
        {onSpeedOutline && (
          <button type="button" className={btnSecondary} disabled={busy} onClick={speedOutline} title="Make a course outline from this proposal (for HRDC), to check and update">
            <ClipboardList className="h-4 w-4" /> Speed course outline
          </button>
        )}
      </div>

      {locked && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-accent/30 bg-accent-soft p-4 text-accent">
          <Lock className="h-5 w-5" />
          <div className="min-w-0 flex-1 text-[15px]">
            <p><strong>Sent {formatDate(p.sentAt || '')}</strong> by {p.sentByName}. This is the locked copy the client received.</p>
            {(p.sendLog || []).length > 0 && (
              <ul className="mt-1 space-y-0.5 text-sm">
                {(p.sendLog || []).slice().reverse().map((x, i) => (
                  <li key={`${x.at}-${i}`}>{x.channel === 'email' ? 'Emailed' : x.channel === 'whatsapp' ? 'WhatsApp' : x.channel === 'link' ? 'Client link made' : 'Marked as sent'}{x.to ? ` to ${x.to}` : ''}{x.cc ? ` (cc ${x.cc})` : ''} · {x.byName} · {formatDate(x.at)}</li>
                ))}
              </ul>
            )}
          </div>
          <button type="button" className={btnSecondary} onClick={revise}><Unlock className="h-4 w-4" /> Revise</button>
        </div>
      )}

      {theirs && dirty && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border border-attention/40 bg-attention-soft/40 p-4">
          <AlertTriangle className="h-5 w-5 text-attention" />
          <p className="min-w-0 flex-1 text-[15px]">{theirs.writerTrainerName || 'The trainer'} changed this proposal while you were editing. Load their changes before saving; what you typed since your last save will need typing again.</p>
          <button type="button" className={btnPrimary} onClick={takeTheirs}>Load their changes</button>
        </div>
      )}
      {!locked && <TrainerLinkCard p={p} me={me} trainers={sources.trainers} saved={!!saved} />}
      {locked && p.writerTrainerName && <p className="text-sm text-ink-soft">Written with {p.writerTrainerName}. Locked for them too until you click Revise.</p>}

      {!locked && p.refAuto && (
        <CustomerCodeBox client={r.client} clients={sources.clients} refNumber={p.refNumber}
          onSaved={msg => { setNote(msg); window.setTimeout(() => setNote(''), 3000); }} />
      )}

      <fieldset disabled={locked} className="min-w-0 space-y-4">
        {/* Deal and client */}
        <Card title="Deal and client" action={!locked && <button type="button" className={linkBtn} onClick={() => setRelinking(true)}><Link2 className="mr-1 inline h-4 w-4" />{deal ? 'Change' : 'Link a deal'}</button>}>
          {deal ? (
            <div className="rounded-xl bg-surface px-4 py-3">
              <p className="font-semibold">{r.company || deal.client || 'No client'}</p>
              <p className="text-sm text-ink-soft">
                {dealProgrammeName(deal, programmes) || deal.enquiryNote || 'No programme'} · {STAGE_LABELS[dealStage(deal)]} · {nameOf(dealOwnerId(deal))}
                {onOpenDeals && <> · <button type="button" className={linkBtn} onClick={() => leaveAfterSave(auto.flush, onOpenDeals)}>Edit deal</button></>}
              </p>
            </div>
          ) : (
            <div>
              <label className={label} htmlFor="tb-for">Prepared for</label>
              <input id="tb-for" value={p.preparedForCompany || ''} onChange={e => set({ preparedForCompany: e.target.value })} className={input} placeholder="Company name (or leave blank for a general proposal)" />
            </div>
          )}
        </Card>

        {/* Cover */}
        <Card title="Cover" hint="The first thing the client sees: a big photo with the title over it.">
          <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
            <div className="space-y-3">
              <div><label className={label} htmlFor="tb-title">Title</label><input id="tb-title" value={p.title} onChange={e => set({ title: typingCaps(e.target.value) })} className={input} placeholder="e.g. LEADING BEYOND EXPECTATIONS: RESTAURANT MANAGER SUMMIT" /></div>
              <TitleTagsBox kind="teambuilding" programmeId={(p as any).programmeId || r.deal?.programmeId} title={p.title || ''} programmes={programmes} viewer={me} />
              <div><label className={label} htmlFor="tb-sub">Line under the title</label><textarea id="tb-sub" value={p.subtitle} onChange={e => set({ subtitle: e.target.value })} rows={2} className={`${input} resize-y`} /></div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div><label className={label} htmlFor="tb-stay">Length</label><input id="tb-stay" value={p.stay || ''} onChange={e => set({ stay: e.target.value })} className={input} placeholder="2 Days 1 Night" /></div>
                <div>
                  <label className={label} htmlFor="tb-date">Event date</label>
                  <input id="tb-date" type="date" value={p.eventDate || ''} onChange={e => set({ eventDate: e.target.value })} className={input} />
                  {!p.eventDate && deal?.trainingDate && <p className="mt-0.5 text-xs text-ink-soft">Blank = the deal's date ({formatDate(deal.trainingDate)})</p>}
                </div>
                <div>
                  <label className={label} htmlFor="tb-pax">Group size (pax)</label>
                  <NumberBox id="tb-pax" value={pax} onChange={changePax} />
                  <p className="mt-0.5 text-xs text-ink-soft">{deal?.participants && Number(deal.participants) !== pax ? `The deal says ${deal.participants}. ` : ''}Changes the price.</p>
                </div>
              </div>
            </div>
            <div>
              <PhotoPicker photos={p.coverPhoto ? [p.coverPhoto] : []} onChange={ph => set({ coverPhoto: ph[0] || '' })} folder="covers" me={me} single label="Cover photo" disabled={locked} />
              {/* The client's logo on the cover is read live from the client record (Clients → Edit). */}
              {r.client && (
                <div className="mt-3">
                  <label className="flex items-center gap-2 text-sm text-ink">
                    <input type="checkbox" checked={!p.hideClientLogo} onChange={e => set({ hideClientLogo: !e.target.checked })} className="h-4 w-4 accent-[#0E6E62]" />
                    Show client logo on the cover
                  </label>
                  {r.client.logoUrl
                    ? !p.hideClientLogo && <img src={r.client.logoUrl} alt="" className="mt-2 h-10 w-auto max-w-[10rem] rounded border border-line bg-white object-contain p-1" />
                    : <p className="mt-0.5 text-xs text-ink-soft">{r.client.companyName || 'This client'} has no logo yet. Add one in Clients → Edit.</p>}
                </div>
              )}
            </div>
          </div>
        </Card>

        {/* Sections: order, show, rename */}
        <SectionsCard sections={sections} onChange={setSections} />

        {sections.map(s => editCard(s.key))}
      </fieldset>

      <Card title="Client link" hint={clientLink ? 'The client always sees the latest saved version on this link.' : undefined}>
        {clientLink
          ? <DocLinkBox link={clientLink} viewer={me} />
          : <p className="text-[15px] text-ink-soft">No client link yet. Use {locked ? 'Send again' : 'Send'} → Client link to make one: a private website of this proposal the client opens without logging in.</p>}
      </Card>

      <Card title="Share with teammates">
        <p className="mb-2 text-[15px] text-ink-soft">People you add can open and edit this same proposal. It appears in their list under "Shared with me".</p>
        <ShareWithBox people={reps.map(x => ({ id: x.id, name: x.name, role: x.role }))} ownerId={r.ownerId} shared={p.sharedWithIds || []} log={p.sharedLog} me={me} onChange={c => set(c)} />
      </Card>

      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</p>}
      {gate && deal && (
        <GapsBox deal={deal} gaps={gate} step="Proposal sent" programmes={programmes as Programme[]} clients={sources.clients} viewer={me}
          onSaved={updated => { setGapDeal(updated); setGate(null); setSending(true); }} onCancel={() => setGate(null)} />
      )}
      {dealWarn && <p role="alert" className="flex items-start gap-2 rounded-xl border border-attention/30 bg-attention-soft px-4 py-3 text-[15px] text-attention"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{dealWarn}</p>}

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3">
          <span className="text-[15px] font-semibold">{tbSummary({ ...r.p, pax })}</span>
          <span className={`text-sm ${toneClass[status.tone]}`}>{status.text}</span>
          <span className="ml-auto flex flex-wrap gap-2">
            <button type="button" className={btnSecondary} onClick={() => setPreview(true)}><Eye className="h-4 w-4" /> Preview</button>
            <PdfButton busy={pdfBusy} onPick={downloadPdf} up />
            <button type="button" className={btnSecondary} disabled={busy || !!gate} onClick={startSend}><Send className="h-4 w-4" /> {sendLabel}</button>
            <button type="button" className={btnPrimary} disabled={busy || !dirty} onClick={save}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save</button>
          </span>
        </div>
      </div>
      {sendDialog}
      {relinking && <DealChooser deals={dealsForPicker} clients={sources.clients} programmes={programmes} personName={nameOf} onPick={relink} onCancel={() => setRelinking(false)} allowGeneral title="Link this proposal to a deal" />}
      {picking && <LibraryPicker library={library} used={p.activities} onPick={a => { set({ activities: [...p.activities, activityFromLibrary(a)] }); setPicking(false); }} onCancel={() => setPicking(false)} />}
    </div>
  );
}

// ---------- Download PDF: Vertical (A4, the website printed) or Horizontal (16:9 slides, Joel 2026-10-23) ----------
function PdfButton({ busy, onPick, up }: { busy: boolean; onPick: (layout: TbPdfLayout) => void; up?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useCloseOnOutside(ref, open, useCallback(() => setOpen(false), []));
  const pick = (layout: TbPdfLayout) => { setOpen(false); onPick(layout); };
  const item = 'flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-surface';
  return (
    <div ref={ref} className="relative">
      <button type="button" className={btnSecondary} disabled={busy} aria-expanded={open} onClick={() => setOpen(o => !o)}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download PDF <ChevronDown className="h-4 w-4" />
      </button>
      {open && (
        <div className={`absolute right-0 z-50 w-72 rounded-xl border border-line bg-white p-1.5 shadow-lg ${up ? 'bottom-full mb-2' : 'top-full mt-2'}`}>
          <button type="button" className={item} onClick={() => pick('vertical')}>
            <RectangleVertical className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
            <span><span className="block text-[15px] font-semibold">Vertical (A4)</span><span className="block text-sm text-ink-soft">The proposal website, printed page by page</span></span>
          </button>
          <button type="button" className={item} onClick={() => pick('horizontal')}>
            <RectangleHorizontal className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
            <span><span className="block text-[15px] font-semibold">Horizontal (slides)</span><span className="block text-sm text-ink-soft">One topic per slide, like a PowerPoint deck</span></span>
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- Preview: exactly what the client sees ----------
function Preview({ r, pax, onPax, onBack, dirty, pdfBusy, onPdf, onSend, sendLabel, busy, error, sendDialog }: {
  r: ResolvedTb; pax: number; onPax?: (n: number) => void; onBack: () => void; dirty: boolean; pdfBusy: boolean; onPdf: (layout: TbPdfLayout) => void;
  onSend: () => void; sendLabel: string; busy: boolean; error: string; sendDialog: React.ReactNode;
}) {
  const [phone, setPhone] = useState(false);
  const [chosen, setChosen] = useState('');
  // What the client sees at the end of their link; here it does nothing.
  const accept = <AcceptBlock token="" r={r} pax={pax} chosen={chosen} accepted={null} onAccepted={() => {}} preview />;
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-[#e9efed] font-sans text-ink">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-white px-4 py-2.5">
        <button type="button" className={btnSecondary} onClick={onBack}><Pencil className="h-4 w-4" /> Back to edit</button>
        <div className="inline-flex rounded-lg border border-line bg-white p-0.5">
          <button type="button" onClick={() => setPhone(false)} className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-semibold ${!phone ? 'bg-ink text-white' : 'text-ink-soft'}`}><Laptop className="h-4 w-4" /> Computer</button>
          <button type="button" onClick={() => setPhone(true)} className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-semibold ${phone ? 'bg-ink text-white' : 'text-ink-soft'}`}><Smartphone className="h-4 w-4" /> Phone</button>
        </div>
        <span className="hidden text-sm text-ink-soft md:inline">This is what the client will see.</span>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {dirty && <span className="text-sm text-attention">Draft saves in a moment</span>}
          <PdfButton busy={pdfBusy} onPick={onPdf} />
          <button type="button" className={btnPrimary} disabled={busy} onClick={onSend}><Send className="h-4 w-4" /> {sendLabel}</button>
        </span>
        {error && <p role="alert" className="w-full rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      </div>
      <div className="flex-1 overflow-hidden p-0 sm:p-4">
        {phone ? (
          <div className="mx-auto h-full w-[410px] max-w-full overflow-hidden rounded-[2rem] border-[10px] border-ink bg-white shadow-xl">
            <PhoneFrame><TeambuildingSite r={r} pax={pax} onPax={onPax} chosen={chosen} onChosen={setChosen} endSlot={accept} /></PhoneFrame>
          </div>
        ) : (
          <div className="mx-auto h-full max-w-[1400px] overflow-y-auto bg-white shadow-xl sm:rounded-xl">
            <TeambuildingSite r={r} pax={pax} onPax={onPax} chosen={chosen} onChosen={setChosen} endSlot={accept} />
          </div>
        )}
      </div>
      {sendDialog}
    </div>
  );
}

// ---------- Section editors ----------
function SectionsCard({ sections, onChange }: { sections: ReturnType<typeof sectionsOf>; onChange: (s: ReturnType<typeof sectionsOf>) => void }) {
  const [open, setOpen] = useState(false);
  const shown = sections.filter(s => !s.hidden).length;
  return (
    <Card title="Sections" hint={`${shown} of ${sections.length} shown. Choose which appear, their order and their headings.`}
      action={<button type="button" className={linkBtn} onClick={() => setOpen(o => !o)}>{open ? <><ChevronDown className="mr-1 inline h-4 w-4" />Done</> : <><ChevronRight className="mr-1 inline h-4 w-4" />Arrange</>}</button>}>
      {open ? (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {sections.map((s, i) => (
            <li key={s.key} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <input type="checkbox" checked={!s.hidden} onChange={e => onChange(sections.map(x => (x.key === s.key ? { ...x, hidden: !e.target.checked } : x)))} className="h-4 w-4 accent-[#0E6E62]" aria-label={`Show ${s.title}`} />
              <input value={s.title} onChange={e => onChange(sections.map(x => (x.key === s.key ? { ...x, title: e.target.value } : x)))} className={`${input} min-w-0 flex-1 py-1.5`} aria-label="Section heading" />
              <span className="hidden w-56 text-sm text-ink-soft lg:block">{SECTION_HINTS[s.key]}</span>
              <UpDown i={i} n={sections.length} onMove={by => onChange(move(sections, i, by))} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {sections.map(s => (
            <a key={s.key} href={`#ed-${s.key}`} onClick={e => { e.preventDefault(); document.getElementById(`ed-${s.key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
              className={`rounded-full border px-3 py-1 text-sm ${s.hidden ? 'border-dashed border-line text-ink-soft line-through' : 'border-line hover:bg-surface'}`}>{s.title}</a>
          ))}
        </div>
      )}
    </Card>
  );
}

function Trainers({ list, trainers, me, onChange }: { list: TbTrainer[]; trainers: any[]; me: Viewer; onChange: (l: TbTrainer[]) => void }) {
  const setAt = (i: number, c: Partial<TbTrainer>) => onChange(list.map((x, k) => (k === i ? { ...x, ...c } : x)));
  const sorted = [...trainers].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  return (
    <div className="space-y-3">
      {list.map((t, i) => {
        const tr = t.trainerId ? trainers.find(x => x.id === t.trainerId) : null;
        const ownBio = t.bio !== undefined;
        return (
          <div key={t.id} className="space-y-3 rounded-xl border border-line p-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[12rem] flex-1">
                <label className={label}>Trainer</label>
                <select value={t.trainerId || ''} onChange={e => setAt(i, { trainerId: e.target.value || undefined, ...(e.target.value ? { name: '' } : {}) })} className={input}>
                  <option value="">Not in the trainer list (type below)</option>
                  {sorted.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </div>
              <div className="min-w-[12rem] flex-1"><label className={label}>Title under the name</label><input value={t.role || ''} onChange={e => setAt(i, { role: e.target.value })} className={input} placeholder="Accredited HRDC Trainer" /></div>
              <span className="flex"><UpDown i={i} n={list.length} onMove={by => onChange(move(list, i, by))} /><button type="button" className={iconBtn} onClick={() => onChange(list.filter((_, k) => k !== i))} aria-label="Remove trainer"><Trash2 className="h-4 w-4" /></button></span>
            </div>
            {!t.trainerId && (
              <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <div><label className={label}>Name</label><input value={t.name || ''} onChange={e => setAt(i, { name: e.target.value })} className={input} /></div>
                <PhotoPicker photos={t.photo ? [t.photo] : []} onChange={ph => setAt(i, { photo: ph[0] || '' })} folder="trainers" me={me} single label="Photo" />
              </div>
            )}
            {tr && !tr.photoUrl && <p className="text-sm text-attention">{tr.name} has no photo yet. Add one in Trainers (open the trainer → Edit).</p>}
            <div>
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <span className={label}>Bio</span>
                {t.trainerId && (ownBio
                  ? <button type="button" className={linkBtn} onClick={() => setAt(i, { bio: undefined })}>Use the bio from the trainer list</button>
                  : <button type="button" className={linkBtn} onClick={() => setAt(i, { bio: tr?.bio || '' })}>Tailor for this client</button>)}
              </div>
              {t.trainerId && !ownBio
                ? <p className="whitespace-pre-line rounded-lg bg-surface px-3 py-2 text-sm text-ink-soft">{tr?.bio || 'No bio in the trainer list yet.'}</p>
                : <textarea value={t.bio || ''} onChange={e => setAt(i, { bio: e.target.value })} rows={5} className={`${input} resize-y`} placeholder={'Why this trainer suits this client. Lines starting with "- " show as bullet points.'} />}
            </div>
          </div>
        );
      })}
      <button type="button" className={btnSecondary} onClick={() => onChange([...list, { id: newTbId('tr'), role: 'Accredited HRDC Trainer' }])}><Plus className="h-4 w-4" /> Add trainer</button>
    </div>
  );
}

function Activities({ list, library, me, onChange }: { list: TbProposalActivity[]; library: any[]; me: Viewer; onChange: (l: TbProposalActivity[]) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const setAt = (id: string, c: Partial<TbProposalActivity>) => onChange(list.map(x => (x.id === id ? { ...x, ...c } : x)));
  const toLibrary = async (a: TbProposalActivity) => {
    setSaving(a.id); setMsg('');
    try {
      const id = `act_${Date.now().toString(36)}`;
      const { id: _i, libraryId: _l, ...content } = a;
      const at = new Date().toISOString();
      await setDoc(doc(db, 'tb_activities', id), JSON.parse(JSON.stringify({ ...cleanActivity(content), createdAt: at, createdById: me.id, createdByName: me.name, updatedAt: at, updatedById: me.id, updatedByName: me.name, approval: PENDING_APPROVAL })));
      setAt(a.id, { libraryId: id });
      setMsg(`"${a.name}" is now in the Activity library.`);
    } catch (e) { setMsg(friendlyError(e)); } finally { setSaving(null); }
  };
  return (
    <div className="space-y-3">
      {list.length === 0 && <p className="text-[15px] text-ink-soft">No activities yet. Add them from the library, or type a new one.</p>}
      {list.map((a, i) => {
        const lib = a.libraryId ? library.find(x => x.id === a.libraryId) : null;
        return (
          <div key={a.id} className="rounded-xl border border-line">
            <div className="flex items-center gap-3 p-3">
              <span className="h-12 w-16 shrink-0 overflow-hidden rounded-lg bg-surface">{a.photos?.[0] && <img src={a.photos[0]} alt="" className="h-full w-full object-cover" />}</span>
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen(o => (o === a.id ? null : a.id))}>
                <span className="block truncate font-semibold">{a.name || 'New activity'}</span>
                <span className="block truncate text-sm text-ink-soft">{[a.duration, a.location].filter(Boolean).join(' · ')}{lib ? ' · from the library' : a.libraryId ? '' : ' · only in this proposal'}</span>
              </button>
              <UpDown i={i} n={list.length} onMove={by => onChange(move(list, i, by))} />
              <button type="button" className={iconBtn} onClick={() => setOpen(o => (o === a.id ? null : a.id))} aria-label={open === a.id ? 'Close' : 'Edit for this client'}>{open === a.id ? <ChevronDown className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}</button>
              <button type="button" className={iconBtn} onClick={() => onChange(list.filter(x => x.id !== a.id))} aria-label="Remove activity"><Trash2 className="h-4 w-4" /></button>
            </div>
            {open === a.id && (
              <div className="space-y-3 border-t border-line p-3">
                <p className="text-sm text-ink-soft">Changes here are for this proposal only{lib ? '; the library keeps its own version.' : '.'}</p>
                <ActivityForm a={a} onChange={c => setAt(a.id, c)} me={me} />
                <div className="flex flex-wrap gap-2">
                  {lib && <button type="button" className={btnSecondary} onClick={() => { if (window.confirm('Replace this activity with the library\'s latest version?')) setAt(a.id, { ...activityFromLibrary(lib), id: a.id }); }}><RotateCcw className="h-4 w-4" /> Use the library's latest version</button>}
                  {!a.libraryId && a.name.trim() && <button type="button" className={btnSecondary} disabled={saving === a.id} onClick={() => toLibrary(a)}>{saving === a.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookmarkPlus className="h-4 w-4" />} Also save to the Activity library</button>}
                </div>
              </div>
            )}
          </div>
        );
      })}
      {msg && <p className="text-sm text-accent">{msg}</p>}
      <button type="button" className={btnSecondary} onClick={() => { const a = { ...blankActivity(), id: newTbId('pa') }; onChange([...list, a]); setOpen(a.id); }}><Plus className="h-4 w-4" /> Type a new activity</button>
    </div>
  );
}

function LibraryPicker({ library, used, onPick, onCancel }: { library: any[]; used: TbProposalActivity[]; onPick: (a: any) => void; onCancel: () => void }) {
  const [search, setSearch] = useState('');
  const t = search.trim().toLowerCase();
  const shown = library.filter(a => !a.archived && (!t || `${a.name} ${a.summary} ${a.location}`.toLowerCase().includes(t))).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <Modal title="Add from the Activity library" onCancel={onCancel} wide>
      <SearchBox value={search} onChange={setSearch} placeholder="Search activities" autoFocus />
      <ul className="mt-3 grid max-h-[60vh] gap-3 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
        {shown.length === 0 && <li className="p-4 text-ink-soft">No activities in the library yet. Add them in Teambuilding proposal → Activity library.</li>}
        {shown.map(a => {
          const inIt = used.some(u => u.libraryId === a.id);
          return (
            <li key={a.id}>
              <button type="button" onClick={() => onPick(a)} className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-line text-left hover:shadow-md">
                <span className="block aspect-[16/9] w-full bg-surface">{a.photos?.[0] && <img src={a.photos[0]} alt="" className="h-full w-full object-cover" />}</span>
                <span className="p-3">
                  <span className="block font-semibold">{a.name}{inIt && <span className="ml-2 rounded bg-accent-soft px-1.5 text-xs font-semibold text-accent">Already added</span>}</span>
                  <span className="block text-sm text-ink-soft">{[a.duration, a.location, a.groupSize].filter(Boolean).join(' · ')}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}

function Venues({ list, venues, me, company, onChange }: { list: TbVenueOption[]; venues: any[]; me: Viewer; company: string; onChange: (l: TbVenueOption[]) => void }) {
  const setAt = (i: number, c: Partial<TbVenueOption>) => onChange(list.map((x, k) => (k === i ? { ...x, ...c } : x)));
  const sorted = [...venues].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  const from = company ? `Travel distance from ${company}: ` : 'Travel distance: ';
  return (
    <div className="space-y-3">
      {list.map((v, i) => {
        const vn = v.venueId ? venues.find(x => x.id === v.venueId) : null;
        return (
          <div key={v.id} className="space-y-3 rounded-xl border border-line p-3">
            <div className="flex flex-wrap items-end gap-2">
              <span className="mb-2 rounded-full bg-accent-soft px-2.5 py-0.5 text-sm font-semibold text-accent">Option {i + 1}</span>
              <div className="min-w-[12rem] flex-1">
                <label className={label}>Venue</label>
                <select value={v.venueId || ''} onChange={e => setAt(i, { venueId: e.target.value || undefined })} className={input}>
                  <option value="">Not in the venue list (type below)</option>
                  {sorted.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </div>
              <div className="w-44"><label className={label}>Stay</label><input value={v.stay} onChange={e => setAt(i, { stay: e.target.value })} className={input} placeholder="2 Days 1 Night" /></div>
              <span className="flex"><UpDown i={i} n={list.length} onMove={by => onChange(move(list, i, by))} /><button type="button" className={iconBtn} onClick={() => onChange(list.filter((_, k) => k !== i))} aria-label="Remove venue"><Trash2 className="h-4 w-4" /></button></span>
            </div>
            {!v.venueId ? (
              <div className="space-y-3">
                <div><label className={label}>Venue name</label><input value={v.name || ''} onChange={e => setAt(i, { name: e.target.value })} className={input} /></div>
                <PhotoPicker photos={v.photos || []} onChange={photos => setAt(i, { photos })} folder="venues" me={me} max={6} />
              </div>
            ) : vn && !venuePhotos(vn).length && <p className="text-sm text-attention">{vn.name} has no photos yet. Add them in Venues (open the venue → Edit).</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className={label}>Travel distance</label><input value={v.distance} onChange={e => setAt(i, { distance: e.target.value })} className={input} placeholder={`${from}102 km`} /></div>
              <div><label className={label}>Travel time</label><input value={v.travelTime} onChange={e => setAt(i, { travelTime: e.target.value })} className={input} placeholder="Travelling time: ~1 hr 30 mins" /></div>
            </div>
            <div><label className={label}>Notes</label><textarea value={v.notes} onChange={e => setAt(i, { notes: e.target.value })} rows={2} className={`${input} resize-y`} placeholder="e.g. Beachfront, own hall for 200 pax. Lines starting with &quot;- &quot; show as bullets." /></div>
          </div>
        );
      })}
      <button type="button" className={btnSecondary} onClick={() => onChange([...list, { id: newTbId('vo'), stay: list[list.length - 1]?.stay || '', distance: '', travelTime: '', notes: '' }])}><Plus className="h-4 w-4" /> Add venue option</button>
    </div>
  );
}
