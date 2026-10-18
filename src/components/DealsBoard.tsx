import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useCloseOnOutside } from '../lib/useCloseOnOutside';
import { collection, doc, onSnapshot, query, setDoc, updateDoc, arrayUnion, writeBatch } from 'firebase/firestore';
import {
  AlertTriangle, Check, ChevronDown, ChevronRight, FileText, Loader2, Plus, Search, Tag, Trophy, X, XCircle, ClipboardList, Undo2, Hourglass,
} from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import { Representative } from '../types';
import {
  DealStage, FundingType, STAGE_LABELS, FUNDING_LABELS, LOST_REASONS, OPEN_STAGES, JOURNEY, journeyStage, canQuote, canManageDeal, dealNeedsAttention, stageDate,
  dealStage, statusForStage, dealOwnerId, dealValue, dealWonDate, todayIso, formatDate, formatRM, dealGaps, dealAskedFor, DealField,
} from '../lib/deals';
import { GapsBox, MarkWonBox } from './DealGates';
import { Picked, dealVenue, progress } from '../lib/checklist';
import DealChecklist from './DealChecklist';
import HrdcQueries from './HrdcQueries';
import DealAppointmentBox from './DealAppointmentBox';
import TrainingTimeBox from './TrainingTimeBox';
import { apptOf, apptOverdue, apptTime } from '../lib/appointments';
import MoneyPanel, { RepMoneyStatus, useMoneySettings } from './Money';
import { MoneyIn, MoneyOut, MoneySettings } from '../lib/money';
import { ProgrammePicker, StatusChip } from './Programmes';
import { HrdcQuery, Programme, grantBlockReason } from '../lib/programmes';
import { linkedOnly } from '../lib/linked';
import { clientContacts, dealContact, mainContactFields, newContactId } from '../lib/contacts';
import PickOrType from './PickOrType';
import { ProposalDrop, ProposalFilesList } from './ProposalFiles';
import { ProposalFile } from '../lib/proposals';

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };

interface DealsBoardProps {
  owner: Representative;          // whose workspace this is
  people: Representative[];       // active reps and admins (possible deal owners)
  viewer: Viewer;                 // who is logged in
  onCreateQuotation: (deal: any) => void;   // opens the deal's draft quotation in the editor (or makes one)
  onOpenQuotation?: (deal: any, quoteId: string) => void;   // opens one of the deal's quotations in the editor
  onCreateOutline: (deal: any) => void;
  onOpenQuotations: () => void;
  onOpenOutlines: () => void;
  openDealId?: string | null;          // reopen this deal's panel (coming back from its quotation)
  onOpenDealHandled?: () => void;
}

type Filter = 'open' | DealStage | 'tagged';

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const label = 'mb-1.5 block text-sm font-semibold text-ink';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';

const STAGE_TONE: Record<DealStage, string> = {
  lead: 'bg-surface text-ink-soft',
  appointment: 'bg-[#E8EEF8] text-[#2B4A7E]',
  proposal: 'bg-attention-soft text-attention',
  agreed: 'bg-[#E8EEF8] text-[#2B4A7E]',
  quoted: 'bg-[#EFE8F8] text-[#5B3A8C]',
  won: 'bg-accent-soft text-accent',
  lost: 'bg-danger-soft text-danger',
};

const emptyForm = () => ({
  clientId: '',
  contactId: '',          // attention person: one of the client's contact persons…
  contactName: '',        // …or typed
  contactPhone: '',
  saveContact: true,      // save a typed person to the client's contact list
  programmeId: '',
  courseName: '',
  enquiryNote: '',        // what they asked for, typed, when the programme isn't known yet
  type: 'Training',
  fundingType: '' as FundingType | '',
  proposalValue: '',
  requestDate: todayIso(),
  trainingDate: '',
  followUpDate: '',
  ownerId: '',
  taggedRepIds: [] as string[],
  tagNote: '',
  notes: '',
});

function historyEntry(viewer: Viewer, action: string) {
  return { at: new Date().toISOString(), byId: viewer.id, byName: viewer.name, action };
}

export default function DealsBoard({
  owner, people, viewer, onCreateQuotation, onOpenQuotation, onCreateOutline, onOpenQuotations, onOpenOutlines, openDealId, onOpenDealHandled,
}: DealsBoardProps) {
  const [deals, setDeals] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [quotes, setQuotes] = useState<any[]>([]);
  const [outlines, setOutlines] = useState<any[]>([]);
  const [checklists, setChecklists] = useState<Record<string, any>>({});
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [queries, setQueries] = useState<HrdcQuery[]>([]);
  const [moneyIn, setMoneyIn] = useState<MoneyIn[]>([]);
  const [proposalFiles, setProposalFiles] = useState<ProposalFile[]>([]);
  const [moneyOut, setMoneyOut] = useState<MoneyOut[]>([]);
  const [venues, setVenues] = useState<any[]>([]);
  const moneySettings = useMoneySettings();
  const [loaded, setLoaded] = useState(false);

  const [filter, setFilter] = useState<Filter>('open');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);   // deal shown in the panel
  const [editing, setEditing] = useState<'new' | string | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [stagePanel, setStagePanel] = useState<null | 'won' | 'lost'>(null);
  const [gate, setGate] = useState<null | { step: 'proposal' | 'quote'; gaps: DealField[] }>(null);   // missing details box
  const [listWonId, setListWonId] = useState('');   // "Client signed" opened on a list row
  const [lostReason, setLostReason] = useState('');
  const [lostNote, setLostNote] = useState('');
  const [stageError, setStageError] = useState('');

  useEffect(() => {
    const subs = [
      onSnapshot(query(collection(db, 'pipelines')), s => { setDeals(linkedOnly(s.docs.map(d => ({ ...d.data(), id: d.id })))); setLoaded(true); }, () => setLoaded(true)),
      onSnapshot(query(collection(db, 'clients')), s => setClients(s.docs.map(d => ({ ...d.data(), id: d.id })))),
      onSnapshot(query(collection(db, 'quotations')), s => setQuotes(linkedOnly(s.docs.map(d => ({ ...d.data(), id: d.id }))))),
      onSnapshot(query(collection(db, 'course_outlines')), s => setOutlines(linkedOnly(s.docs.map(d => ({ ...d.data(), id: d.id }))))),
      onSnapshot(query(collection(db, 'deal_checklists')), s => setChecklists(Object.fromEntries(s.docs.map(d => [d.id, d.data()])))),
      onSnapshot(query(collection(db, 'programmes')), s => setProgrammes(s.docs.map(d => ({ ...(d.data() as Programme), id: d.id })))),
      onSnapshot(query(collection(db, 'hrdc_queries')), s => setQueries(s.docs.map(d => ({ ...(d.data() as HrdcQuery), id: d.id })))),
      onSnapshot(query(collection(db, 'money_in')), s => setMoneyIn(s.docs.map(d => ({ ...(d.data() as MoneyIn), id: d.id })))),
      onSnapshot(query(collection(db, 'proposal_files')), s => setProposalFiles(s.docs.map(d => ({ ...(d.data() as ProposalFile), id: d.id }))), () => {}),
      onSnapshot(query(collection(db, 'venues_directory')), s => setVenues(s.docs.map(d => ({ ...d.data(), id: d.id })))),
    ];
    // Payouts and costs are for Admin and Management only.
    if (viewer.role !== 'rep') {
      subs.push(onSnapshot(query(collection(db, 'money_out')), s => setMoneyOut(s.docs.map(d => ({ ...(d.data() as MoneyOut), id: d.id })))));
    }
    return () => subs.forEach(u => u());
  }, []);

  // Coming back from the deal's quotation: open its panel again.
  useEffect(() => {
    if (!openDealId) return;
    setOpenId(openDealId);
    setEditing(null);
    setStagePanel(null);
    setGate(null);
    setStageError('');
    onOpenDealHandled?.();
  }, [openDealId]);

  const flash = (t: string) => { setToast(t); window.setTimeout(() => setToast(x => (x === t ? '' : x)), 3500); };

  const clientOf = (p: any) => clients.find(c => c.id === p.clientId);
  const programmeOf = (p: any) => programmes.find(x => x.id === p.programmeId);
  const courseOf = (p: any) => programmeOf(p)?.name || p.courseName || '';
  const askedFor = (p: any) => dealAskedFor(p, programmeOf(p)?.name);
  const known = { clientIds: clients.map(c => c.id), programmeIds: programmes.map(x => x.id) };
  const clientName = (p: any) => clientOf(p)?.companyName || p.client || 'No client';
  const personName = (id: string) => people.find(r => r.id === id)?.name || 'Former team member';
  const canEdit = (p: any) => viewer.role !== 'rep' || dealOwnerId(p) === viewer.id;
  const canCreateHere = viewer.role !== 'rep' || viewer.id === owner.id;

  const myDeals = useMemo(() => deals.filter(p => dealOwnerId(p) === owner.id), [deals, owner.id]);
  const taggedDeals = useMemo(
    () => deals.filter(p => dealOwnerId(p) !== owner.id && (p.taggedRepIds || []).includes(owner.id)),
    [deals, owner.id]
  );
  const openTagRequests = taggedDeals.filter(p => !(p.completedTags || []).includes(owner.id));

  const stageSummary = useMemo(() => {
    const out: Record<DealStage, { count: number; value: number }> = {
      lead: { count: 0, value: 0 }, appointment: { count: 0, value: 0 }, proposal: { count: 0, value: 0 },
      agreed: { count: 0, value: 0 }, quoted: { count: 0, value: 0 }, won: { count: 0, value: 0 }, lost: { count: 0, value: 0 },
    };
    myDeals.forEach(p => { const st = journeyStage(dealStage(p)); out[st].count++; out[st].value += dealValue(p); });
    return out;
  }, [myDeals]);

  const visible = useMemo(() => {
    const base = filter === 'tagged' ? taggedDeals : myDeals.filter(p => (filter === 'open' ? OPEN_STAGES.includes(dealStage(p)) : journeyStage(dealStage(p)) === filter));
    const q = search.trim().toLowerCase();
    const list = q ? base.filter(p => `${clientName(p)} ${courseOf(p)} ${p.enquiryNote || ''}`.toLowerCase().includes(q)) : base;
    return [...list].sort((a, b) => String(b.requestDate || b.id).localeCompare(String(a.requestDate || a.id)));
  }, [filter, myDeals, taggedDeals, search, clients, programmes]);

  const openDeal = deals.find(p => p.id === openId) || null;

  // ---------- Next step hint shown on each row ----------
  const nextStep = (p: any): { text: string; urgent: boolean } => {
    const st = dealStage(p);
    const today = todayIso();
    const fu = /^\d{4}-\d{2}-\d{2}/.test(p.followUpDate || '') ? p.followUpDate.slice(0, 10) : '';
    if (st === 'won') {
      const cl = checklists[p.id];
      const pr = cl ? progress(cl.tasks, p.fundingType) : null;
      return { text: `Won ${formatDate(dealWonDate(p))}${pr ? `, admin ${pr.done} of ${pr.total}` : ''}`, urgent: false };
    }
    if (st === 'lost') return { text: p.lostReason ? `Lost: ${p.lostReason}` : 'Lost', urgent: false };
    // Red or not comes from dealNeedsAttention, the same check as the red dot on the Deals menu.
    const urgent = dealNeedsAttention(p, today);
    const ap = apptOf(p);
    if (apptOverdue(p, today)) return { text: `Appointment on ${formatDate(ap!.date)} not logged`, urgent };
    if (ap?.status === 'booked') return { text: `Appointment ${formatDate(ap.date)}${ap.time ? `, ${apptTime(ap.time)}` : ''}`, urgent };
    if (fu && fu < today) return { text: `Follow-up overdue (${formatDate(fu)})`, urgent };
    if (st === 'lead') return { text: fu ? `Follow up ${formatDate(fu)}` : 'Book an appointment or send the proposal', urgent };
    if (st === 'appointment') return { text: fu ? `Follow up ${formatDate(fu)}` : 'Send the proposal', urgent };
    if (st === 'agreed') return { text: 'Client approved: send the quotation', urgent };
    if (st === 'quoted') return { text: fu ? `Follow up ${formatDate(fu)}` : 'Waiting for client signature', urgent };
    return { text: fu ? `Follow up ${formatDate(fu)}` : 'Follow up on the proposal', urgent };
  };

  // ---------- Create / edit ----------
  const startNew = () => {
    setForm({ ...emptyForm(), ownerId: owner.id });
    setFormError('');
    setEditing('new');
    setOpenId(null);
  };

  const startEdit = (p: any) => {
    setForm({
      clientId: p.clientId && clients.some(c => c.id === p.clientId) ? p.clientId : '',
      contactId: p.contactId || '',
      contactName: p.contactId ? '' : (p.contactName || ''),
      contactPhone: '',
      saveContact: true,
      programmeId: p.programmeId && programmes.some(x => x.id === p.programmeId) ? p.programmeId : '',
      courseName: courseOf(p),
      enquiryNote: p.enquiryNote || '',
      type: p.type || 'Training',
      fundingType: (p.fundingType as FundingType) || '',
      proposalValue: dealValue(p) ? String(dealValue(p)) : '',
      requestDate: (p.requestDate || todayIso()).slice(0, 10),
      trainingDate: /^\d{4}-\d{2}-\d{2}/.test(p.trainingDate || '') ? p.trainingDate.slice(0, 10) : '',
      followUpDate: /^\d{4}-\d{2}-\d{2}/.test(p.followUpDate || '') ? p.followUpDate.slice(0, 10) : '',
      ownerId: dealOwnerId(p) || owner.id,
      taggedRepIds: p.taggedRepIds || [],
      tagNote: p.tagNote || '',
      notes: p.notes || '',
    });
    setFormError('');
    setEditing(p.id);
  };

  const saveForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    const client = clients.find(c => c.id === form.clientId);
    if (!client) return setFormError('Choose the client from the client list, or add them as a new client.');
    // A new deal needs only the client, what they asked for and the date (Joel, 2026-10-18).
    // The programme can be a short typed note for now; value and funding type are asked for at the step that needs them.
    const programme = programmes.find(x => x.id === form.programmeId);
    const existingDeal = editing && editing !== 'new' ? deals.find(p => p.id === editing) : null;
    const legacyCourse = !programme && existingDeal && !existingDeal.programmeId ? (existingDeal.courseName || '') : '';
    if (!programme && !form.enquiryNote.trim() && !legacyCourse) return setFormError('Say what the client asked for: pick the programme from the list, or type a short note.');
    const value = form.proposalValue.trim() === '' ? 0 : Number(form.proposalValue);
    if (!Number.isFinite(value) || value < 0) return setFormError('Enter the deal value as a number, for example 15000.');
    if (!form.requestDate) return setFormError('Enter the date the client asked.');
    const newOwner = people.find(r => r.id === form.ownerId) || owner;
    if (viewer.role === 'rep' && newOwner.id !== viewer.id && editing === 'new') {
      return setFormError('You can only create deals for yourself.');
    }

    setBusy(true);
    try {
      const existing = editing && editing !== 'new' ? deals.find(p => p.id === editing) : null;
      const id = existing ? existing.id : `pipe_${Date.now()}`;
      // Attention person: one of the client's contact persons, or typed (and, if ticked, added to the client's list).
      const people_ = clientContacts(client);
      let contactId = people_.some(x => x.id === form.contactId) ? form.contactId : '';
      let contactName = '';
      const typed = form.contactName.trim();
      if (!contactId && typed) {
        const same = people_.find(x => x.name.trim().toLowerCase() === typed.toLowerCase());
        if (same) contactId = same.id;
        else if (form.saveContact) {
          const added = { id: newContactId(), name: typed, designation: '', phone: form.contactPhone.trim(), email: '' };
          const next = [...people_, added];
          await setDoc(doc(db, 'clients', client.id), { contacts: next, ...mainContactFields(next) }, { merge: true });
          contactId = added.id;
        } else contactName = typed;
      }
      const changes: string[] = [];
      if (existing && dealOwnerId(existing) !== newOwner.id) changes.push(`Owner changed to ${newOwner.name}`);
      const data: any = {
        id,
        clientId: client.id,
        client: client.companyName,
        contactId,
        contactName,
        programmeId: programme ? programme.id : '',
        courseName: programme ? programme.name : legacyCourse,
        enquiryNote: form.enquiryNote.trim(),
        type: form.type,
        fundingType: form.fundingType || '',
        proposalValue: value,
        requestDate: form.requestDate,
        trainingDate: form.trainingDate || '',
        followUpDate: form.followUpDate || 'TBD',
        ownerId: newOwner.id,
        ownerName: newOwner.name,
        taggedRepIds: form.taggedRepIds.filter(x => x !== newOwner.id),
        tagNote: form.tagNote.trim(),
        notes: form.notes.trim(),
      };
      if (!existing) {
        Object.assign(data, {
          stage: 'lead', status: 'Pending', proposalSentDate: 'not yet', creatorId: viewer.id, creatorName: viewer.name,
          completedTags: [], appointmentTicked: false, createdAt: Date.now(),
          history: [historyEntry(viewer, 'Deal created')],
        });
      } else {
        data.history = [...(existing.history || []), historyEntry(viewer, changes.length ? changes.join('. ') : 'Details updated')].slice(-40);
      }
      await setDoc(doc(db, 'pipelines', id), data, { merge: true });
      setEditing(null);
      setOpenId(id);
      flash(existing ? 'Deal saved' : 'Deal created');
    } catch (err) {
      setFormError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  // ---------- Moving through stages ----------
  const writeStage = async (p: any, changes: any, action: string): Promise<boolean> => {
    setBusy(true);
    setStageError('');
    try {
      await updateDoc(doc(db, 'pipelines', p.id), {
        ...changes,
        status: statusForStage(changes.stage),
        history: [...(p.history || []), historyEntry(viewer, action)].slice(-40),
      });
      setStagePanel(null);
      flash(action);
      return true;
    } catch (err) {
      setStageError(friendlyError(err));
      return false;
    } finally {
      setBusy(false);
    }
  };


  // A blocked step opens a small box asking only for what's missing (GapsBox), then carries on.
  const toProposal = (p: any, checked = false) => {
    const gaps = checked ? [] : dealGaps(p, 'proposal', known);
    if (gaps.length) { setStagePanel(null); setStageError(''); setGate({ step: 'proposal', gaps }); return; }
    setGate(null);
    const sent = /^\d{4}-\d{2}-\d{2}/.test(p.proposalSentDate || '') ? p.proposalSentDate : todayIso();
    return writeStage(p, { stage: 'proposal', proposalSentDate: sent }, 'Proposal sent');
  };

  // "Client approved: create quotation" (Joel, 2026-10-18): one click records the approval (stage stays 'agreed',
  // agreedDate today) and opens the new quotation in the editor.
  const approveAndQuote = async (p: any, checked = false) => {
    if (dealStage(p) === 'proposal') {
      const gaps = checked ? [] : dealGaps(p, 'quote', known);
      if (gaps.length) { setStagePanel(null); setStageError(''); setGate({ step: 'quote', gaps }); return; }
      setGate(null);
      const ok = await writeStage(p, { stage: 'agreed', agreedDate: todayIso() }, 'Client approved the proposal');
      if (!ok) return;
    }
    onCreateQuotation(p);
  };

  const toQuoted = (p: any) => {
    if (!quotes.some(q => q.pipelineId === p.id)) return setStageError('Create the quotation for this deal first.');
    return writeStage(p, { stage: 'quoted', quotationSentDate: todayIso() }, 'Quotation sent');
  };

  const confirmLost = (p: any) => {
    if (!lostReason) return setStageError('Choose why the deal was lost.');
    return writeStage(p, { stage: 'lost', lostDate: todayIso(), lostReason, lostNote: lostNote.trim() }, `Lost: ${lostReason}`);
  };

  const reopen = (p: any) => {
    const has = (v: any) => /^\d{4}-\d{2}-\d{2}/.test(v || '');
    const back: DealStage = has(p.quotationSentDate) ? 'quoted' : has(p.agreedDate) ? 'agreed' : has(p.proposalSentDate) ? 'proposal' : p.appointmentDate || p.appointmentTicked ? 'appointment' : 'lead';
    return writeStage(p, { stage: back, wonDate: '', lostReason: '', lostNote: '' }, dealStage(p) === 'won' ? 'Win undone' : 'Deal reopened');
  };

  // Delete a deal (creator or Management). Not allowed once it's won, or with a sent quotation, money or HRDC queries.
  // Draft quotations on the deal are deleted with it, after asking.
  const deleteDeal = async (p: any) => {
    const linked: string[] = [];
    if (dealStage(p) === 'won') linked.push('it is won');
    const dealQuotes = quotes.filter(q => q.pipelineId === p.id);
    const refs = (list: any[]) => list.map(q => q.refNumber || 'no reference').join(', ');
    const sent = dealQuotes.filter(q => q.status === 'sent');
    const drafts = dealQuotes.filter(q => q.status !== 'sent');
    if (sent.length) linked.push(`quotation ${refs(sent)} has been sent`);
    const nm = moneyIn.filter(m => m.dealId === p.id).length + moneyOut.filter(m => m.dealId === p.id).length;
    if (nm) linked.push(`${nm} money record${nm === 1 ? '' : 's'}`);
    const nh = queries.filter(q => q.dealId === p.id).length;
    if (nh) linked.push(`${nh} HRDC quer${nh === 1 ? 'y' : 'ies'}`);
    const npf = proposalFiles.filter(f => f.dealId === p.id).length;
    if (npf) linked.push(`it has ${npf} proposal file${npf === 1 ? '' : 's'} (delete ${npf === 1 ? 'it' : 'them'} under Documents first if the deal really is a mistake)`);
    if (linked.length) return setStageError(`This deal can't be deleted because ${linked.join(', ')}. Use "Mark lost" instead.`);
    // Reps can only delete their own quotations (database rule), so someone else's draft must go first.
    const notMine = viewer.role === 'rep' ? drafts.filter(q => q.ownerId !== viewer.id && q.creatorId !== viewer.id) : [];
    if (notMine.length) return setStageError(`Draft quotation ${refs(notMine)} on this deal belongs to someone else. Ask them, Admin or Management to delete it first.`);
    const also = drafts.length ? ` and its draft quotation${drafts.length === 1 ? '' : 's'} ${refs(drafts)}` : '';
    if (!window.confirm(`Delete the deal for ${clientName(p)}${also}? This can't be undone.`)) return;
    setBusy(true);
    try {
      // All or nothing: the deal and its drafts go together.
      const batch = writeBatch(db);
      drafts.forEach(q => batch.delete(doc(db, 'quotations', q.id)));
      batch.delete(doc(db, 'pipelines', p.id));
      await batch.commit();
      setOpenId(null);
      flash('Deal deleted');
    } catch (err) {
      setStageError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const markTagDone = async (p: any) => {
    try {
      await updateDoc(doc(db, 'pipelines', p.id), { completedTags: arrayUnion(viewer.id) });
      flash('Marked as done');
    } catch (err) {
      flash(friendlyError(err));
    }
  };

  // ---------- Render ----------
  return (
    <div className="space-y-5 font-sans text-ink">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Deals</h2>
          <p className="mt-0.5 text-[15px] text-ink-soft">
            {viewer.id === owner.id ? 'Your deals, from first contact to won.' : `${owner.name}'s deals, from first contact to won.`}
          </p>
        </div>
        {canCreateHere && (
          <button type="button" onClick={startNew} className={btnPrimary}>
            <Plus className="h-4 w-4" /> New deal
          </button>
        )}
      </div>

      {viewer.id === owner.id && openTagRequests.length > 0 && (
        <div className="rounded-xl border border-attention/30 bg-attention-soft p-4">
          <p className="flex items-center gap-2 font-semibold text-attention">
            <Tag className="h-4 w-4" /> You've been asked to help on {openTagRequests.length} deal{openTagRequests.length === 1 ? '' : 's'}
          </p>
          <ul className="mt-2 space-y-2">
            {openTagRequests.map(p => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm text-attention">
                <span>
                  <strong>{clientName(p)}</strong> ({personName(dealOwnerId(p))}){p.tagNote ? `: "${p.tagNote}"` : ''}
                </span>
                <span className="flex gap-2">
                  <button type="button" className={btnSecondary} onClick={() => setOpenId(p.id)}>View</button>
                  <button type="button" className={btnSecondary} onClick={() => markTagDone(p)}><Check className="h-3.5 w-3.5" /> Done</button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* The journey strip: counts and value per stage, click to filter */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" role="tablist" aria-label="Filter deals by stage">
        {(['lead', 'proposal', 'agreed', 'quoted', 'won', 'lost'] as DealStage[]).map((st, i) => {
          const active = filter === st;
          return (
            <button
              key={st}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setFilter(active ? 'open' : st)}
              className={`relative rounded-xl border px-3.5 py-3 text-left transition-colors ${active ? 'border-accent bg-accent-soft' : 'border-line bg-white hover:bg-surface'}`}
            >
              <span className="flex items-center gap-1 text-sm font-semibold text-ink-soft">
                {STAGE_LABELS[st]}
                {i < 4 && <ChevronRight className="hidden h-3.5 w-3.5 lg:inline" aria-hidden />}
              </span>
              <span className="mt-1 block text-2xl font-bold leading-none text-ink">{stageSummary[st].count}</span>
              <span className="mt-1 block text-sm text-ink-soft">{formatRM(stageSummary[st].value)}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-line bg-white p-0.5">
          {([['open', 'Open deals'], ['tagged', `Helping on (${taggedDeals.length})`]] as const).map(([k, t]) => (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k)}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold ${filter === k ? 'bg-ink text-white' : 'text-ink-soft hover:text-ink'}`}
            >
              {t}
            </button>
          ))}
        </div>
        {filter !== 'open' && filter !== 'tagged' && (
          <span className="text-sm text-ink-soft">Showing {STAGE_LABELS[filter as DealStage].toLowerCase()} deals</span>
        )}
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search client or programme" className={`${input} pl-9`} aria-label="Search deals" />
        </div>
      </div>

      {/* Deal list */}
      <div className="overflow-hidden rounded-2xl border border-line bg-white">
        {!loaded ? (
          <p className="flex items-center gap-2 p-6 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading deals…</p>
        ) : visible.length === 0 ? (
          <div className="p-8 text-center">
            <p className="font-semibold">{filter === 'tagged' ? 'No one has asked for help on a deal' : 'No deals here yet'}</p>
            {canCreateHere && filter !== 'tagged' && (
              <p className="mt-1 text-[15px] text-ink-soft">Create a deal when a client first gets in touch, then move it along as it progresses.</p>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {visible.map(p => {
              const st = dealStage(p);
              const step = nextStep(p);
              return (
                <li key={p.id}>
                  <div className="flex flex-col hover:bg-surface">
                  <button type="button" onClick={() => { setOpenId(p.id); setStagePanel(null); setGate(null); setStageError(''); }} className="flex w-full flex-col gap-1.5 px-5 py-3.5 text-left sm:flex-row sm:items-center sm:gap-4">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{clientName(p)}</span>
                      <span className="block truncate text-sm text-ink-soft">{askedFor(p) || 'No programme yet'}{p.type ? `, ${p.type}` : ''}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2 sm:justify-end">
                      <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${STAGE_TONE[st]}`}>{STAGE_LABELS[st]}</span>
                      {p.fundingType && <span className="rounded-md border border-line px-2 py-0.5 text-xs font-medium text-ink-soft">{FUNDING_LABELS[p.fundingType as FundingType]}</span>}
                      <span className="w-28 text-right font-semibold tabular-nums">{dealValue(p) ? formatRM(dealValue(p)) : '—'}</span>
                    </span>
                    <span className={`flex items-center gap-1 text-sm sm:w-52 sm:justify-end ${step.urgent ? 'font-semibold text-danger' : 'text-ink-soft'}`}>
                      {step.urgent && <AlertTriangle className="h-3.5 w-3.5" />}{step.text}
                    </span>
                  </button>
                  {/* Mark won without opening the panel (Joel, 2026-10-18) */}
                  {st === 'quoted' && canEdit(p) && listWonId !== p.id && (
                    <div className="-mt-1.5 flex px-5 pb-3 sm:justify-end">
                      <button type="button" onClick={() => setListWonId(p.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-accent/40 bg-white px-2.5 py-1.5 text-sm font-semibold text-accent hover:bg-accent-soft">
                        <Trophy className="h-3.5 w-3.5" /> Client signed
                      </button>
                    </div>
                  )}
                  </div>
                  {listWonId === p.id && (
                    <div className="px-5 pb-4">
                      <MarkWonBox deal={p} programmes={programmes} clients={clients} viewer={viewer}
                        onDone={msg => { setListWonId(''); flash(msg); }} onCancel={() => setListWonId('')} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Deal panel */}
      {openDeal && !editing && (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" role="dialog" aria-modal="true" onClick={() => setOpenId(null)}>
          <div className="h-full w-full md:w-1/2 md:min-w-[40rem] overflow-y-auto bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <DealPanel
              deal={openDeal}
              clientName={clientName(openDeal)}
              client={clientOf(openDeal)}
              ownerName={personName(dealOwnerId(openDeal))}
              personName={personName}
              editable={canEdit(openDeal)}
              viewer={viewer}
              quotes={quotes.filter(q => q.pipelineId === openDeal.id)}
              outlines={outlines.filter(o => o.pipelineId === openDeal.id)}
              checklist={checklists[openDeal.id] || null}
              venue={dealVenue(checklists[openDeal.id] || null, quotes.filter(q => q.pipelineId === openDeal.id), venues)}
              programme={programmeOf(openDeal)}
              courseName={askedFor(openDeal)}
              queries={queries.filter(q => q.dealId === openDeal.id)}
              moneyIn={moneyIn.filter(m => m.dealId === openDeal.id)}
              moneyOut={moneyOut.filter(m => m.dealId === openDeal.id)}
              moneySettings={moneySettings}
              team={[...people.map(r => ({ id: r.id, name: r.name })), ...(people.some(r => r.id === viewer.id) ? [] : [{ id: viewer.id, name: viewer.name }])]}
              busy={busy}
              stagePanel={stagePanel}
              setStagePanel={(v) => { setStagePanel(v); setGate(null); setStageError(''); }}
              stageError={stageError}
              gate={gate}
              clients={clients}
              onGapSaved={(updated) => { const step = gate?.step; setGate(null); if (step === 'proposal') toProposal(updated, true); else if (step === 'quote') approveAndQuote(updated, true); }}
              onGapCancel={() => setGate(null)}
              onWonDone={(msg) => { setStagePanel(null); flash(msg); }}
              lostReason={lostReason} setLostReason={setLostReason}
              lostNote={lostNote} setLostNote={setLostNote}
              onClose={() => setOpenId(null)}
              onEdit={() => startEdit(openDeal)}
              programmes={programmes}
              onApptDone={flash}
              onProposal={() => toProposal(openDeal)}
              proposalFiles={proposalFiles.filter(f => f.dealId === openDeal.id)}
              onProposalUploaded={(files) => {
                flash(files.length === 1 ? `Proposal "${files[0].name}" saved` : `${files.length} proposal files saved`);
                // Uploading at New = the proposal was sent.
                if (['lead', 'appointment'].includes(dealStage(openDeal))) toProposal(openDeal);
              }}
              onApproveQuote={() => approveAndQuote(openDeal)}
              onQuoted={() => toQuoted(openDeal)}
              onLost={() => confirmLost(openDeal)}
              onReopen={() => reopen(openDeal)}
              canManage={canManageDeal(openDeal, viewer)}
              onDelete={() => deleteDeal(openDeal)}
              onCreateQuotation={() => onCreateQuotation(openDeal)}
              onOpenQuotation={onOpenQuotation ? (id: string) => onOpenQuotation(openDeal, id) : undefined}
              onCreateOutline={() => onCreateOutline(openDeal)}
              onOpenQuotations={onOpenQuotations}
              onOpenOutlines={onOpenOutlines}
            />
          </div>
        </div>
      )}

      {/* Create / edit form */}
      {editing && (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" role="dialog" aria-modal="true">
          <div className="h-full w-full md:w-1/2 md:min-w-[40rem] overflow-y-auto bg-white p-6 shadow-xl">
            <div className="mb-5 flex items-start justify-between gap-4">
              <h3 className="text-lg font-bold">{editing === 'new' ? 'New deal' : 'Edit deal'}</h3>
              <button type="button" onClick={() => setEditing(null)} className="rounded-md p-1 text-ink-soft hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={saveForm} className="space-y-4">
              <div>
                <span className={label}>Client</span>
                <ClientPicker
                  clients={clients}
                  value={form.clientId}
                  legacyName={editing !== 'new' ? deals.find(p => p.id === editing)?.client : ''}
                  viewer={viewer}
                  onChange={id => setForm(f => ({ ...f, clientId: id, contactId: clientContacts(clients.find(c => c.id === id))[0]?.id || '', contactName: '', contactPhone: '' }))}
                />
              </div>
              {form.clientId && (() => {
                const client = clients.find(c => c.id === form.clientId);
                const people_ = clientContacts(client);
                const typedNew = !form.contactId && form.contactName.trim() !== '' && !people_.some(x => x.name.trim().toLowerCase() === form.contactName.trim().toLowerCase());
                return (
                  <div>
                    <label htmlFor="d-attn" className={label}>Attention to <span className="font-normal text-ink-soft">(the person at the client)</span></label>
                    <PickOrType id="d-attn" options={people_.map(x => ({ id: x.id, name: x.name, hint: x.designation || undefined }))}
                      linkedId={form.contactId} text={form.contactName}
                      onChange={v => setForm(f => ({ ...f, contactId: v.id, contactName: v.id ? '' : v.text }))}
                      placeholder={people_.length ? 'Pick from the list or type a name' : 'Type the name'} className={input}
                      note={form.contactId ? `From ${client?.companyName || 'the client'}'s contacts` : undefined} />
                    {typedNew && (
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <input value={form.contactPhone} onChange={e => setForm(f => ({ ...f, contactPhone: e.target.value }))} placeholder="Their phone (optional)" aria-label="Attention person's phone" className={input} />
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={form.saveContact} onChange={e => setForm(f => ({ ...f, saveContact: e.target.checked }))} className="h-4 w-4 accent-[#0E6E62]" />
                          Add to {client?.companyName || 'the client'}'s contact persons
                        </label>
                      </div>
                    )}
                  </div>
                );
              })()}
              <div>
                <span className={label}>What they asked for</span>
                <ProgrammePicker
                  programmes={programmes}
                  value={form.programmeId}
                  legacyName={editing !== 'new' ? form.courseName : ''}
                  viewer={viewer}
                  onChange={pg => setForm(f => ({ ...f, programmeId: pg.id, courseName: pg.name }))}
                />
                {!form.programmeId && (
                  <input value={form.enquiryNote} onChange={e => setForm(f => ({ ...f, enquiryNote: e.target.value }))} className={`${input} mt-2`}
                    placeholder="Not in the list yet? Type a short note, e.g. leadership for supervisors" aria-label="What the client asked for (short note)" maxLength={200} />
                )}
                <p className="mt-1.5 text-sm text-ink-soft">Pick the programme, or type a short note for now. The programme from the list is needed before "Proposal sent".</p>
                {(form.fundingType === 'hrdc' || form.fundingType === 'hrdc_topup') && form.programmeId && programmes.find(x => x.id === form.programmeId)?.hrdcStatus !== 'approved' && (
                  <p className="mt-1.5 text-sm text-attention">This programme isn't approved by HRDC yet. Admin must register it in the HRDC portal before the grant can be applied.</p>
                )}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="d-type" className={label}>Type</label>
                  <select id="d-type" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className={input}>
                    <option value="Training">Training</option>
                    <option value="Teambuilding">Teambuilding</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="d-value" className={label}>Deal value (RM) <span className="font-normal text-ink-soft">(optional for now)</span></label>
                  <input id="d-value" inputMode="decimal" value={form.proposalValue} onChange={e => setForm(f => ({ ...f, proposalValue: e.target.value.replace(/[^0-9.]/g, '') }))} className={input} placeholder="15000" />
                </div>
              </div>
              <div>
                <span className={label}>How will it be paid? <span className="font-normal text-ink-soft">(optional for now; needed before Won)</span></span>
                <div className="grid gap-2 sm:grid-cols-3">
                  {(Object.keys(FUNDING_LABELS) as FundingType[]).map(ft => (
                    <label key={ft} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold ${form.fundingType === ft ? 'border-accent bg-accent-soft text-accent' : 'border-line hover:bg-surface'}`}>
                      <input type="radio" name="d-funding" checked={form.fundingType === ft} onChange={() => setForm(f => ({ ...f, fundingType: ft }))} className="accent-[#0E6E62]" />
                      {FUNDING_LABELS[ft]}
                    </label>
                  ))}
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label htmlFor="d-req" className={label}>Client asked on</label>
                  <input id="d-req" type="date" value={form.requestDate} onChange={e => setForm(f => ({ ...f, requestDate: e.target.value }))} className={input} />
                </div>
                <div>
                  <label htmlFor="d-train" className={label}>Training date</label>
                  <input id="d-train" type="date" value={form.trainingDate} onChange={e => setForm(f => ({ ...f, trainingDate: e.target.value }))} className={input} />
                </div>
                <div>
                  <label htmlFor="d-fu" className={label}>Next follow-up</label>
                  <input id="d-fu" type="date" value={form.followUpDate} onChange={e => setForm(f => ({ ...f, followUpDate: e.target.value }))} className={input} />
                </div>
              </div>
              <div>
                <label htmlFor="d-owner" className={label}>Deal owner</label>
                <select
                  id="d-owner"
                  value={form.ownerId}
                  onChange={e => setForm(f => ({ ...f, ownerId: e.target.value }))}
                  className={input}
                  disabled={editing === 'new' && viewer.role === 'rep'}
                >
                  {people.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
                <p className="mt-1.5 text-sm text-ink-soft">The owner gets the KPI credit and is the only rep who can edit this deal.</p>
              </div>
              <div>
                <span className={label}>Ask teammates for help (optional)</span>
                <div className="flex flex-wrap gap-2">
                  {people.filter(r => r.id !== form.ownerId).map(r => {
                    const on = form.taggedRepIds.includes(r.id);
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => setForm(f => ({ ...f, taggedRepIds: on ? f.taggedRepIds.filter(x => x !== r.id) : [...f.taggedRepIds, r.id] }))}
                        className={`rounded-full border px-3 py-1 text-sm font-medium ${on ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-soft hover:bg-surface'}`}
                        aria-pressed={on}
                      >
                        {r.name}
                      </button>
                    );
                  })}
                </div>
                {form.taggedRepIds.length > 0 && (
                  <input value={form.tagNote} onChange={e => setForm(f => ({ ...f, tagNote: e.target.value }))} className={`${input} mt-2`} placeholder="What do you need help with?" aria-label="Note for teammates" />
                )}
              </div>
              <div>
                <label htmlFor="d-notes" className={label}>Notes</label>
                <textarea id="d-notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className={`${input} min-h-[90px]`} />
              </div>
              {formError && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{formError}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" className={btnSecondary} onClick={() => setEditing(null)}>Cancel</button>
                <button type="submit" disabled={busy} className={btnPrimary}>
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  {editing === 'new' ? 'Create deal' : 'Save deal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {toast && (
        <div role="status" className="fixed bottom-24 left-1/2 z-[60] -translate-x-1/2 rounded-xl bg-ink px-4 py-3 text-sm font-medium text-white shadow-lg">{toast}</div>
      )}
    </div>
  );
}

// ---------- Deal panel ----------
// Next step first (Joel, 2026-10-18): under the client name and journey line, one "Next step" box with the single
// main button for the stage and "Mark lost" as a small link. Everything else folds into sections that open on tap;
// the most useful one for the stage starts open.
type SectionKey = 'appointment' | 'details' | 'documents' | 'checklist' | 'hrdc' | 'money' | 'history';
function defaultSection(st: DealStage): SectionKey {
  if (st === 'lead' || st === 'appointment') return 'appointment';
  if (st === 'won') return 'checklist';
  if (st === 'lost') return 'history';
  return 'documents';
}

function DealPanel(props: {
  deal: any; clientName: string; client: any; ownerName: string; personName: (id: string) => string;
  editable: boolean; viewer: Viewer; quotes: any[]; outlines: any[]; checklist: any | null; busy: boolean;
  programme: Programme | undefined; courseName: string; queries: HrdcQuery[]; team: { id: string; name: string }[];
  venue: Picked | null;
  moneyIn: MoneyIn[]; moneyOut: MoneyOut[]; moneySettings: MoneySettings;
  stagePanel: null | 'won' | 'lost'; setStagePanel: (v: null | 'won' | 'lost') => void; stageError: string;
  gate: null | { step: 'proposal' | 'quote'; gaps: DealField[] }; clients: any[];
  onGapSaved: (updated: any) => void; onGapCancel: () => void; onWonDone: (msg: string) => void;
  lostReason: string; setLostReason: (v: string) => void;
  lostNote: string; setLostNote: (v: string) => void;
  onClose: () => void; onEdit: () => void; onProposal: () => void; onApproveQuote: () => void; onQuoted: () => void;
  proposalFiles: ProposalFile[]; onProposalUploaded: (files: ProposalFile[]) => void;
  programmes: Programme[]; onApptDone: (msg: string) => void;
  onLost: () => void; onReopen: () => void;
  canManage: boolean; onDelete: () => void;
  onCreateQuotation: () => void; onOpenQuotation?: (quoteId: string) => void; onCreateOutline: () => void; onOpenQuotations: () => void; onOpenOutlines: () => void;
}) {
  const p = props.deal;
  const st = dealStage(p);
  const journey: DealStage[] = JOURNEY;
  const reached = st === 'lost' ? -1 : journey.indexOf(journeyStage(st));
  const hasQuote = props.quotes.length > 0;
  const canUndoWin = props.viewer.role !== 'rep';
  const isHrdcDeal = p.fundingType === 'hrdc' || p.fundingType === 'hrdc_topup';
  const grantBlock = grantBlockReason(p, props.programme);
  const newest = (list: any[]) => [...list].sort((a, b) => String(b.date || b.id).localeCompare(String(a.date || a.id)))[0];
  const sentQuote = newest(props.quotes.filter(q => q.status === 'sent'));
  const draftQuote = newest(props.quotes.filter(q => q.status !== 'sent'));
  const openQuote = (q: any) => (props.onOpenQuotation ? props.onOpenQuotation(q.id) : props.onOpenQuotations());
  const pr = props.checklist ? progress(props.checklist.tasks, p.fundingType) : null;
  const ap = apptOf(p);
  const def = defaultSection(st);
  const main = 'inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0B5A50] disabled:opacity-60';
  const smallLink = 'inline-flex items-center gap-1 text-sm font-semibold hover:underline';
  const nHist = (p.history || []).length;
  const openQueries = props.queries.filter(q => !q.answeredDate).length;

  // The single main step for the stage
  const next: { title: string; hint?: string; button?: React.ReactNode } = (() => {
    if (st === 'lead' || st === 'appointment') return {
      title: 'Next step: send the proposal',
      hint: 'Meeting the client first is optional (Appointment, below).',
      button: <button type="button" disabled={props.busy} className={main} onClick={props.onProposal}>Proposal sent</button>,
    };
    if (st === 'proposal') return {
      title: 'Next step: client approves the proposal',
      hint: 'When they approve, one click records it and opens the quotation.',
      button: <button type="button" disabled={props.busy} className={main} onClick={props.onApproveQuote}><FileText className="h-4 w-4" /> Client approved: create quotation</button>,
    };
    if (st === 'agreed') return {
      title: 'Next step: send the quotation',
      hint: draftQuote ? `Draft ${draftQuote.refNumber || ''} is ready to finish and send.` : 'The client approved the proposal.',
      button: <button type="button" disabled={props.busy} className={main} onClick={props.onCreateQuotation}><FileText className="h-4 w-4" /> {draftQuote ? 'Open quotation' : 'Create quotation'}</button>,
    };
    if (st === 'quoted') return {
      title: 'Waiting for client signature',
      hint: sentQuote ? `Quotation ${sentQuote.refNumber || ''} sent ${formatDate(p.quotationSentDate || sentQuote.sentAt || '')}.` : undefined,
      button: <button type="button" className={main} onClick={() => props.setStagePanel('won')}><Trophy className="h-4 w-4" /> Client signed</button>,
    };
    if (st === 'won') return {
      title: `Won ${formatDate(dealWonDate(p))}: handed to admin`,
      hint: pr ? `Admin checklist ${pr.done} of ${pr.total} done.` : 'Admin will start the checklist.',
    };
    return { title: `Lost on ${formatDate(p.lostDate) || 'an earlier date'}${p.lostReason ? `: ${p.lostReason}` : ''}`, hint: p.lostNote || undefined };
  })();

  return (
    <div className="space-y-5 text-ink">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-bold">{props.clientName}</h3>
          <p className="text-[15px] text-ink-soft">{props.courseName || 'No programme yet'}</p>
        </div>
        <button type="button" onClick={props.onClose} className="rounded-md p-1 text-ink-soft hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
      </div>

      {/* Journey */}
      <ol className="flex items-center gap-1" aria-label="Deal stage">
        {journey.map((s, i) => (
          <li key={s} className="flex flex-1 flex-col gap-1.5">
            <span className={`h-1.5 rounded-full ${st === 'lost' ? 'bg-danger/30' : i <= reached ? 'bg-accent' : 'bg-line'}`} />
            <span className={`text-xs font-semibold ${i === reached ? 'text-ink' : 'text-ink-soft'}`}>{STAGE_LABELS[s]}</span>
            {/* The date the step was done (Joel, 2026-10-17) */}
            <span className="min-h-[1rem] text-xs text-ink-soft">{i <= reached ? formatDate(stageDate(p, s)) : ''}</span>
          </li>
        ))}
      </ol>

      {/* Next step */}
      <section aria-label="Next step" className={`rounded-2xl border p-4 ${st === 'lost' ? 'border-danger/30 bg-danger-soft' : st === 'won' ? 'border-accent/30 bg-accent-soft' : 'border-line bg-surface'}`}>
        <p className={`flex items-center gap-2 font-bold ${st === 'lost' ? 'text-danger' : st === 'won' ? 'text-accent' : ''}`}>
          {st === 'quoted' && <Hourglass className="h-4 w-4 text-ink-soft" />}{next.title}
        </p>
        {next.hint && <p className="mt-0.5 text-sm text-ink-soft">{next.hint}</p>}
        {props.editable ? (
          <div className="mt-3 space-y-3">
            {next.button && props.stagePanel !== 'won' && !props.gate && (
              <div className="flex flex-wrap items-center gap-2">
                {next.button}
                {st === 'agreed' && hasQuote && <button type="button" disabled={props.busy} className={btnSecondary} onClick={props.onQuoted}>Quotation sent another way</button>}
                {st === 'quoted' && sentQuote && <button type="button" className={btnSecondary} onClick={() => openQuote(sentQuote)}>Open quotation</button>}
              </div>
            )}
            {(st === 'lead' || st === 'appointment') && !props.gate && (
              <ProposalDrop dealId={p.id} viewer={props.viewer} disabled={props.busy} onUploaded={props.onProposalUploaded} />
            )}
            {props.gate && (
              <GapsBox deal={p} gaps={props.gate.gaps} step={props.gate.step === 'proposal' ? 'Proposal sent' : 'Client approved: create quotation'}
                programmes={props.programmes} clients={props.clients} viewer={props.viewer} onSaved={props.onGapSaved} onCancel={props.onGapCancel} />
            )}
            {props.stagePanel === 'won' && (
              <MarkWonBox deal={p} programmes={props.programmes} clients={props.clients} viewer={props.viewer}
                onDone={props.onWonDone} onCancel={() => props.setStagePanel(null)} />
            )}
            {props.stagePanel === 'lost' && (
              <div className="rounded-xl border border-danger/30 bg-danger-soft p-4">
                <span className="mb-1.5 block text-sm font-semibold text-danger">Why was it lost?</span>
                <div className="flex flex-wrap gap-2">
                  {LOST_REASONS.map(r => (
                    <button key={r} type="button" onClick={() => props.setLostReason(r)} aria-pressed={props.lostReason === r}
                      className={`rounded-full border px-3 py-1 text-sm font-medium ${props.lostReason === r ? 'border-danger bg-white text-danger' : 'border-danger/30 text-danger hover:bg-white'}`}>
                      {r}
                    </button>
                  ))}
                </div>
                <input value={props.lostNote} onChange={e => props.setLostNote(e.target.value)} className={`${input} mt-3`} placeholder="Anything worth remembering (optional)" aria-label="Lost note" />
                <div className="mt-3 flex gap-2">
                  <button type="button" className={btnSecondary} onClick={() => props.setStagePanel(null)}>Cancel</button>
                  <button type="button" disabled={props.busy} onClick={props.onLost} className="inline-flex items-center gap-2 rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white hover:bg-[#931C13]">Confirm lost</button>
                </div>
              </div>
            )}
            {props.stageError && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{props.stageError}</p>}
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {OPEN_STAGES.includes(st) && props.stagePanel !== 'lost' && <button type="button" className={`${smallLink} text-danger`} onClick={() => props.setStagePanel('lost')}><XCircle className="h-3.5 w-3.5" /> Mark lost</button>}
              {st === 'lost' && <button type="button" disabled={props.busy} className={`${smallLink} text-accent`} onClick={props.onReopen}><Undo2 className="h-3.5 w-3.5" /> Reopen deal</button>}
              {st === 'won' && canUndoWin && <button type="button" disabled={props.busy} className={`${smallLink} text-ink-soft`} onClick={props.onReopen}><Undo2 className="h-3.5 w-3.5" /> Undo win</button>}
            </div>
          </div>
        ) : (
          <p className="mt-2 text-sm text-ink-soft">Only {props.ownerName}, Admin and Management can change this deal.</p>
        )}
      </section>

      {st !== 'lost' && grantBlock && (
        <p className="rounded-lg bg-attention-soft px-3.5 py-2.5 text-sm text-attention">HRDC: {grantBlock}</p>
      )}

      <div className="divide-y divide-line rounded-2xl border border-line">
        {/* Appointment (optional, one per deal) */}
        <Fold title="Appointment" hint={ap ? (ap.status === 'booked' ? `Booked ${formatDate(ap.date)}` : `Held ${formatDate(ap.date)}`) : 'None'} defaultOpen={def === 'appointment'} id={p.id}>
          <DealAppointmentBox deal={p} viewer={props.viewer} editable={props.canManage} programmes={props.programmes} client={props.client} onDone={props.onApptDone} />
        </Fold>

        {/* Details */}
        <Fold title="Details" hint={[dealValue(p) ? formatRM(dealValue(p)) : 'No value yet', p.fundingType ? FUNDING_LABELS[p.fundingType as FundingType] : ''].filter(Boolean).join(' · ')} defaultOpen={def === 'details'} id={p.id}>
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[15px]">
              <Detail term="Value" value={dealValue(p) ? formatRM(dealValue(p)) : '—'} />
              <Detail term="Paid by" value={p.fundingType ? FUNDING_LABELS[p.fundingType as FundingType] : 'Not set'} />
              <Detail term="Owner" value={props.ownerName} />
              <Detail term="Type" value={p.type || '—'} />
              <Detail term="Client asked on" value={formatDate(p.requestDate) || '—'} />
              <Detail term="Training date" value={formatDate(p.trainingDate) || 'Not set'} />
              <div><dt className="text-sm text-ink-soft">Training time</dt><dd className="font-semibold"><TrainingTimeBox key={p.id} deal={p} quotes={props.quotes} viewer={props.viewer} editable={props.editable} /></dd></div>
              <Detail term="Venue" value={props.venue ? `${props.venue.name}${props.venue.from === 'quotation' ? ' (from quotation)' : ''}` : 'Not set'} />
              <Detail term="Proposal sent" value={formatDate(p.proposalSentDate) || 'Not yet'} />
              <Detail term="Next follow-up" value={formatDate(p.followUpDate) || 'Not set'} />
              {st === 'won' && <Detail term="Won on" value={formatDate(dealWonDate(p))} />}
              {props.client && (() => { const pic = dealContact(p, props.client); return <Detail term="Attention to" value={pic ? [pic.name + (pic.designation ? ` (${pic.designation})` : ''), pic.phone].filter(Boolean).join(', ') : '—'} />; })()}
              {props.client && <Detail term="HRDC registered" value={props.client.hrdcRegistered ? 'Yes' : 'No'} />}
              {p.enquiryNote && <Detail term="Asked for (note)" value={p.enquiryNote} />}
            </dl>
            {props.programme && (
              <p className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
                Programme: <StatusChip programme={props.programme} />{props.programme.hrdcCode && <span>HRDC code {props.programme.hrdcCode}</span>}
              </p>
            )}
            {!p.clientId && (
              <p className="rounded-lg bg-attention-soft px-3.5 py-2.5 text-sm text-attention">This older deal isn't linked to the client list yet. Use Edit details to pick the client.</p>
            )}
            {(p.taggedRepIds || []).length > 0 && (
              <p className="text-sm text-ink-soft">
                Helping: {(p.taggedRepIds || []).map((id: string) => `${props.personName(id)}${(p.completedTags || []).includes(id) ? ' (done)' : ''}`).join(', ')}
                {p.tagNote ? `. "${p.tagNote}"` : ''}
              </p>
            )}
            {p.notes && <p className="whitespace-pre-line rounded-lg bg-surface px-3.5 py-2.5 text-[15px]">{p.notes}</p>}
            {props.editable && <button type="button" className={btnSecondary} onClick={props.onEdit}>Edit details</button>}
          </div>
        </Fold>

        {/* Documents */}
        <Fold title="Documents and proposal files" hint={`${props.quotes.length} quotation${props.quotes.length === 1 ? '' : 's'} · ${props.proposalFiles.length} proposal file${props.proposalFiles.length === 1 ? '' : 's'}`} defaultOpen={def === 'documents'} id={p.id}>
          <div className="space-y-2">
            <DocRow icon={<FileText className="h-4 w-4" />} name="Quotations" items={props.quotes.map(q => `${q.refNumber || q.id}${q.status === 'sent' ? ' (sent)' : ''}`)}
              onOpen={() => { const q = sentQuote || draftQuote; if (q) openQuote(q); }} onCreate={props.editable && canQuote(p) && !draftQuote ? props.onCreateQuotation : undefined} createLabel="Create quotation" />
            {!canQuote(p) && st !== 'lost' && <p className="text-sm text-ink-soft">A quotation can be made once the client approves the proposal.</p>}
            <DocRow icon={<ClipboardList className="h-4 w-4" />} name="Course outlines" items={props.outlines.map(o => o.refNumber || o.courseTitle || o.id)} onOpen={props.onOpenOutlines} onCreate={props.editable ? props.onCreateOutline : undefined} createLabel="Create outline" />
            <ProposalFilesList dealId={p.id} files={props.proposalFiles} viewer={props.viewer} editable={props.editable} onUploaded={props.onProposalUploaded} />
          </div>
        </Fold>

        {/* Admin checklist (after the deal is won) */}
        {st === 'won' && (
          <Fold title="Admin checklist" hint={pr ? `${pr.done} of ${pr.total} done` : 'Not started'} defaultOpen={def === 'checklist'} id={p.id}>
            <DealChecklist
              deal={p}
              checklist={props.checklist}
              quotes={props.quotes}
              viewer={props.viewer}
              onCreateQuotation={props.editable ? props.onCreateQuotation : undefined}
              onOpenQuotations={props.onOpenQuotations}
              grantBlock={grantBlock}
            />
          </Fold>
        )}

        {/* HRDC queries (HRDC-funded won deals) */}
        {st === 'won' && isHrdcDeal && (
          <Fold title="HRDC queries" hint={openQueries ? `${openQueries} open` : 'None open'} defaultOpen={def === 'hrdc'} id={p.id}>
            <HrdcQueries deal={p} queries={props.queries} viewer={props.viewer} people={props.team} />
          </Fold>
        )}

        {/* Money (won deals): full view for Admin and Management, status only for reps */}
        {st === 'won' && (
          <Fold title={props.viewer.role === 'rep' ? 'Payment status' : 'Money'} defaultOpen={def === 'money'} id={p.id}>
            {props.viewer.role === 'rep'
              ? <RepMoneyStatus deal={p} ins={props.moneyIn} />
              : <MoneyPanel deal={p} viewer={props.viewer} ins={props.moneyIn} outs={props.moneyOut} settings={props.moneySettings} />}
          </Fold>
        )}

        {/* History */}
        {nHist > 0 && (
          <Fold title="History" hint={`${nHist} entr${nHist === 1 ? 'y' : 'ies'}`} defaultOpen={def === 'history'} id={p.id}>
            <ul className="space-y-1.5 text-sm text-ink-soft">
              {[...(p.history || [])].reverse().slice(0, 12).map((h: any, i: number) => (
                <li key={i}>{new Date(h.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}: {h.action} <span className="text-ink-soft/70">by {h.byName}</span></li>
              ))}
            </ul>
          </Fold>
        )}
      </div>

      {props.canManage && (
        <div className="pt-1">
          <button type="button" disabled={props.busy} onClick={props.onDelete} className="inline-flex items-center gap-1.5 text-sm font-semibold text-danger hover:underline"><XCircle className="h-4 w-4" /> Delete deal</button>
          {props.stageError && !props.editable && <p role="alert" className="mt-2 rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{props.stageError}</p>}
        </div>
      )}
    </div>
  );
}

// A section that opens on tap. It starts open or closed for the deal's stage, and resets when the deal or stage changes.
function Fold({ title, hint, defaultOpen, id, children }: { title: string; hint?: string; defaultOpen: boolean; id: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => setOpen(defaultOpen), [id, defaultOpen]);
  return (
    <section>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-surface">
        <ChevronDown className={`h-4 w-4 shrink-0 text-ink-soft transition-transform ${open ? '' : '-rotate-90'}`} />
        <span className="font-bold">{title}</span>
        {hint && <span className="ml-auto truncate pl-2 text-sm text-ink-soft">{hint}</span>}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </section>
  );
}

function Detail({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className="text-sm text-ink-soft">{term}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}

function DocRow({ icon, name, items, onOpen, onCreate, createLabel }: { icon: React.ReactNode; name: string; items: string[]; onOpen: () => void; onCreate?: () => void; createLabel: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3.5 py-2.5">
      <span className="flex min-w-0 items-center gap-2">
        <span className="text-accent">{icon}</span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold">{name} ({items.length})</span>
          {items.length > 0 && <span className="block truncate text-sm text-ink-soft">{items.join(', ')}</span>}
        </span>
      </span>
      <span className="flex gap-2">
        {items.length > 0 && <button type="button" className={btnSecondary} onClick={onOpen}>Open</button>}
        {onCreate && <button type="button" className={btnSecondary} onClick={onCreate}><Plus className="h-3.5 w-3.5" /> {createLabel}</button>}
      </span>
    </div>
  );
}

// ---------- Client picker with quick add ----------
function ClientPicker({ clients, value, legacyName, viewer, onChange }: {
  clients: any[]; value: string; legacyName?: string; viewer: Viewer; onChange: (id: string) => void;
}) {
  const selected = clients.find(c => c.id === value);
  const [queryText, setQueryText] = useState(selected ? '' : legacyName || '');
  const [open, setOpen] = useState(!selected && !!legacyName);
  const boxRef = useRef<HTMLDivElement>(null);
  useCloseOnOutside(boxRef, open, () => setOpen(false));
  const [adding, setAdding] = useState(false);
  const [newClient, setNewClient] = useState({ companyName: '', contactName: '', phone: '', hrdcRegistered: true });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const q = queryText.trim().toLowerCase();
  const matches = (q ? clients.filter(c => `${c.companyName} ${c.contactName || ''}`.toLowerCase().includes(q)) : clients)
    .slice()
    .sort((a, b) => String(a.companyName).localeCompare(String(b.companyName)))
    .slice(0, 8);

  const startAdd = () => {
    setNewClient({ companyName: queryText.trim(), contactName: '', phone: '', hrdcRegistered: true });
    setErr('');
    setAdding(true);
    setOpen(false);
  };

  const saveClient = async () => {
    setErr('');
    const name = newClient.companyName.trim();
    if (!name) return setErr('Enter the company name.');
    const dup = clients.find(c => String(c.companyName).trim().toLowerCase() === name.toLowerCase());
    if (dup) { onChange(dup.id); setAdding(false); return; }
    setBusy(true);
    try {
      const id = `client_${Date.now()}`;
      await setDoc(doc(db, 'clients', id), {
        id, companyName: name, contactName: newClient.contactName.trim(), designation: '', phone: newClient.phone.trim(),
        email: '', address: '', industry: '', hrdcRegistered: newClient.hrdcRegistered, notes: '',
        createdAt: Date.now(), createdBy: viewer.id, createdByName: viewer.name,
      });
      onChange(id);
      setAdding(false);
      setQueryText('');
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  if (adding) {
    return (
      <div className="space-y-3 rounded-xl border border-line bg-surface p-4">
        <p className="text-sm font-semibold">New client</p>
        <input value={newClient.companyName} onChange={e => setNewClient(n => ({ ...n, companyName: e.target.value }))} className={input} placeholder="Company name" aria-label="Company name" />
        <div className="grid gap-3 sm:grid-cols-2">
          <input value={newClient.contactName} onChange={e => setNewClient(n => ({ ...n, contactName: e.target.value }))} className={input} placeholder="Contact person" aria-label="Contact person" />
          <input value={newClient.phone} onChange={e => setNewClient(n => ({ ...n, phone: e.target.value }))} className={input} placeholder="Phone" aria-label="Phone" />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={newClient.hrdcRegistered} onChange={e => setNewClient(n => ({ ...n, hrdcRegistered: e.target.checked }))} className="h-4 w-4 accent-[#0E6E62]" />
          Registered with HRDC
        </label>
        <p className="text-sm text-ink-soft">Address and other details can be added later in the client list.</p>
        {err && <p role="alert" className="text-sm text-danger">{err}</p>}
        <div className="flex gap-2">
          <button type="button" className={btnSecondary} onClick={() => setAdding(false)}>Cancel</button>
          <button type="button" disabled={busy} className={btnPrimary} onClick={saveClient}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Add client</button>
        </div>
      </div>
    );
  }

  if (selected && !open) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-white px-3 py-2">
        <span className="min-w-0">
          <span className="block truncate font-semibold">{selected.companyName}</span>
          {selected.industry && <span className="block truncate text-sm text-ink-soft">{selected.industry}</span>}
        </span>
        <button type="button" className="text-sm font-semibold text-accent hover:underline" onClick={() => { setOpen(true); setQueryText(''); }}>Change</button>
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative">
      <Search className="pointer-events-none absolute left-3 top-[19px] h-4 w-4 -translate-y-1/2 text-ink-soft" />
      <input
        value={queryText}
        onChange={e => { setQueryText(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        className={`${input} pl-9`}
        placeholder="Search the client list"
        aria-label="Search the client list"
      />
      {open && (
        <div className="mt-1 overflow-hidden rounded-lg border border-line bg-white shadow-lg">
          {matches.map(c => (
            <button key={c.id} type="button" onClick={() => { onChange(c.id); setOpen(false); }} className="block w-full px-3 py-2 text-left hover:bg-surface">
              <span className="block text-sm font-semibold">{c.companyName}</span>
              {c.contactName && <span className="block text-sm text-ink-soft">{c.contactName}</span>}
            </button>
          ))}
          {matches.length === 0 && <p className="px-3 py-2 text-sm text-ink-soft">No client matches "{queryText}".</p>}
          <button type="button" onClick={startAdd} className="flex w-full items-center gap-2 border-t border-line px-3 py-2.5 text-left text-sm font-semibold text-accent hover:bg-accent-soft">
            <Plus className="h-4 w-4" /> Add {queryText.trim() ? `"${queryText.trim()}"` : 'a new client'}
          </button>
        </div>
      )}
    </div>
  );
}
