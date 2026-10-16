import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, query, setDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import {
  AlertTriangle, Check, ChevronRight, FileText, Loader2, Plus, Search, Tag, Trophy, X, XCircle, ClipboardList, Undo2,
} from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import { Representative } from '../types';
import {
  DealStage, FundingType, STAGE_LABELS, FUNDING_LABELS, LOST_REASONS, OPEN_STAGES,
  dealStage, statusForStage, dealOwnerId, dealValue, dealWonDate, todayIso, formatDate, formatRM,
} from '../lib/deals';
import { progress } from '../lib/checklist';
import DealChecklist, { startChecklist, useChecklistSettings } from './DealChecklist';
import HrdcQueries from './HrdcQueries';
import MoneyPanel, { RepMoneyStatus, useMoneySettings } from './Money';
import { MoneyIn, MoneyOut, MoneySettings } from '../lib/money';
import { ProgrammePicker, StatusChip } from './Programmes';
import { HrdcQuery, Programme, grantBlockReason } from '../lib/programmes';

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };

interface DealsBoardProps {
  owner: Representative;          // whose workspace this is
  people: Representative[];       // active reps and admins (possible deal owners)
  viewer: Viewer;                 // who is logged in
  onCreateQuotation: (deal: any) => void;
  onCreateOutline: (deal: any) => void;
  onOpenQuotations: () => void;
  onOpenOutlines: () => void;
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
  won: 'bg-accent-soft text-accent',
  lost: 'bg-danger-soft text-danger',
};

const emptyForm = () => ({
  clientId: '',
  programmeId: '',
  courseName: '',
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
  owner, people, viewer, onCreateQuotation, onCreateOutline, onOpenQuotations, onOpenOutlines,
}: DealsBoardProps) {
  const [deals, setDeals] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [quotes, setQuotes] = useState<any[]>([]);
  const [outlines, setOutlines] = useState<any[]>([]);
  const [checklists, setChecklists] = useState<Record<string, any>>({});
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [queries, setQueries] = useState<HrdcQuery[]>([]);
  const [moneyIn, setMoneyIn] = useState<MoneyIn[]>([]);
  const [moneyOut, setMoneyOut] = useState<MoneyOut[]>([]);
  const moneySettings = useMoneySettings();
  const checklistSettings = useChecklistSettings();
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
  const [wonDate, setWonDate] = useState(todayIso());
  const [lostReason, setLostReason] = useState('');
  const [lostNote, setLostNote] = useState('');
  const [stageError, setStageError] = useState('');

  useEffect(() => {
    const subs = [
      onSnapshot(query(collection(db, 'pipelines')), s => { setDeals(s.docs.map(d => ({ ...d.data(), id: d.id }))); setLoaded(true); }, () => setLoaded(true)),
      onSnapshot(query(collection(db, 'clients')), s => setClients(s.docs.map(d => ({ ...d.data(), id: d.id })))),
      onSnapshot(query(collection(db, 'quotations')), s => setQuotes(s.docs.map(d => ({ ...d.data(), id: d.id })))),
      onSnapshot(query(collection(db, 'course_outlines')), s => setOutlines(s.docs.map(d => ({ ...d.data(), id: d.id })))),
      onSnapshot(query(collection(db, 'deal_checklists')), s => setChecklists(Object.fromEntries(s.docs.map(d => [d.id, d.data()])))),
      onSnapshot(query(collection(db, 'programmes')), s => setProgrammes(s.docs.map(d => ({ ...(d.data() as Programme), id: d.id })))),
      onSnapshot(query(collection(db, 'hrdc_queries')), s => setQueries(s.docs.map(d => ({ ...(d.data() as HrdcQuery), id: d.id })))),
      onSnapshot(query(collection(db, 'money_in')), s => setMoneyIn(s.docs.map(d => ({ ...(d.data() as MoneyIn), id: d.id })))),
    ];
    // Payouts and costs are for Admin and Management only.
    if (viewer.role !== 'rep') {
      subs.push(onSnapshot(query(collection(db, 'money_out')), s => setMoneyOut(s.docs.map(d => ({ ...(d.data() as MoneyOut), id: d.id })))));
    }
    return () => subs.forEach(u => u());
  }, []);

  const flash = (t: string) => { setToast(t); window.setTimeout(() => setToast(x => (x === t ? '' : x)), 3500); };

  const clientOf = (p: any) => clients.find(c => c.id === p.clientId);
  const programmeOf = (p: any) => programmes.find(x => x.id === p.programmeId);
  const courseOf = (p: any) => programmeOf(p)?.name || p.courseName || '';
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
      won: { count: 0, value: 0 }, lost: { count: 0, value: 0 },
    };
    myDeals.forEach(p => { const st = dealStage(p); out[st].count++; out[st].value += dealValue(p); });
    return out;
  }, [myDeals]);

  const visible = useMemo(() => {
    const base = filter === 'tagged' ? taggedDeals : myDeals.filter(p => (filter === 'open' ? OPEN_STAGES.includes(dealStage(p)) : dealStage(p) === filter));
    const q = search.trim().toLowerCase();
    const list = q ? base.filter(p => `${clientName(p)} ${courseOf(p)}`.toLowerCase().includes(q)) : base;
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
    if (fu && fu < today) return { text: `Follow-up overdue (${formatDate(fu)})`, urgent: true };
    if (st === 'lead') {
      const age = p.requestDate ? (Date.now() - new Date(p.requestDate).getTime()) / 86400000 : 0;
      return { text: fu ? `Follow up ${formatDate(fu)}` : 'Book an appointment', urgent: age > 2 && !fu };
    }
    if (st === 'appointment') return { text: 'Send the proposal', urgent: false };
    return { text: fu ? `Follow up ${formatDate(fu)}` : 'Follow up on the proposal', urgent: false };
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
      programmeId: p.programmeId && programmes.some(x => x.id === p.programmeId) ? p.programmeId : '',
      courseName: courseOf(p),
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
    const programme = programmes.find(x => x.id === form.programmeId);
    if (!programme) return setFormError('Choose the programme from the programme list, or add it as a new programme.');
    if (!form.fundingType) return setFormError('Choose how this training will be paid for.');
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
      const changes: string[] = [];
      if (existing && dealOwnerId(existing) !== newOwner.id) changes.push(`Owner changed to ${newOwner.name}`);
      const data: any = {
        id,
        clientId: client.id,
        client: client.companyName,
        programmeId: programme.id,
        courseName: programme.name,
        type: form.type,
        fundingType: form.fundingType,
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

  const toAppointment = (p: any) =>
    writeStage(p, { stage: 'appointment', appointmentDate: todayIso(), appointmentTicked: true }, 'Appointment held');

  const toProposal = (p: any) => {
    if (dealValue(p) <= 0) return setStageError('Add the proposal value (Edit details) before marking the proposal as sent.');
    const sent = /^\d{4}-\d{2}-\d{2}/.test(p.proposalSentDate || '') ? p.proposalSentDate : todayIso();
    return writeStage(p, { stage: 'proposal', proposalSentDate: sent }, 'Proposal sent');
  };

  const confirmWon = async (p: any) => {
    if (!p.clientId || !clients.some(c => c.id === p.clientId)) return setStageError('Link this deal to a client from the client list first (Edit details).');
    if (dealValue(p) <= 0) return setStageError('Add the deal value first (Edit details).');
    if (!p.fundingType) return setStageError('Choose how this training will be paid for first (Edit details).');
    if (!wonDate) return setStageError('Enter the date the deal was won.');
    const ok = await writeStage(p, { stage: 'won', wonDate, lostReason: '', lostNote: '' }, `Won (${formatRM(dealValue(p))})`);
    // Hand over to admin: the deal gets its checklist straight away.
    if (ok) {
      try {
        await startChecklist(p, checklistSettings, viewer, checklists[p.id]);
      } catch (err) {
        console.error('Checklist could not be started:', err);
        flash('Deal won. Admin can start its checklist from the work queue.');
      }
    }
  };

  const confirmLost = (p: any) => {
    if (!lostReason) return setStageError('Choose why the deal was lost.');
    return writeStage(p, { stage: 'lost', lostDate: todayIso(), lostReason, lostNote: lostNote.trim() }, `Lost: ${lostReason}`);
  };

  const reopen = (p: any) => {
    const back: DealStage = /^\d{4}-\d{2}-\d{2}/.test(p.proposalSentDate || '') ? 'proposal' : p.appointmentDate || p.appointmentTicked ? 'appointment' : 'lead';
    return writeStage(p, { stage: back, wonDate: '', lostReason: '', lostNote: '' }, dealStage(p) === 'won' ? 'Win undone' : 'Deal reopened');
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
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" role="tablist" aria-label="Filter deals by stage">
        {(['lead', 'appointment', 'proposal', 'won', 'lost'] as DealStage[]).map((st, i) => {
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
                {i < 2 && <ChevronRight className="hidden h-3.5 w-3.5 sm:inline" aria-hidden />}
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
                  <button type="button" onClick={() => { setOpenId(p.id); setStagePanel(null); setStageError(''); }} className="flex w-full flex-col gap-1.5 px-5 py-3.5 text-left hover:bg-surface sm:flex-row sm:items-center sm:gap-4">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{clientName(p)}</span>
                      <span className="block truncate text-sm text-ink-soft">{courseOf(p) || 'No programme yet'}{p.type ? `, ${p.type}` : ''}</span>
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
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Deal panel */}
      {openDeal && !editing && (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" role="dialog" aria-modal="true" onClick={() => setOpenId(null)}>
          <div className="h-full w-full max-w-xl overflow-y-auto bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
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
              programme={programmeOf(openDeal)}
              courseName={courseOf(openDeal)}
              queries={queries.filter(q => q.dealId === openDeal.id)}
              moneyIn={moneyIn.filter(m => m.dealId === openDeal.id)}
              moneyOut={moneyOut.filter(m => m.dealId === openDeal.id)}
              moneySettings={moneySettings}
              team={[...people.map(r => ({ id: r.id, name: r.name })), ...(people.some(r => r.id === viewer.id) ? [] : [{ id: viewer.id, name: viewer.name }])]}
              busy={busy}
              stagePanel={stagePanel}
              setStagePanel={(v) => { setStagePanel(v); setStageError(''); }}
              stageError={stageError}
              wonDate={wonDate} setWonDate={setWonDate}
              lostReason={lostReason} setLostReason={setLostReason}
              lostNote={lostNote} setLostNote={setLostNote}
              onClose={() => setOpenId(null)}
              onEdit={() => startEdit(openDeal)}
              onAppointment={() => toAppointment(openDeal)}
              onProposal={() => toProposal(openDeal)}
              onWon={() => confirmWon(openDeal)}
              onLost={() => confirmLost(openDeal)}
              onReopen={() => reopen(openDeal)}
              onCreateQuotation={() => onCreateQuotation(openDeal)}
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
          <div className="h-full w-full max-w-xl overflow-y-auto bg-white p-6 shadow-xl">
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
                  onChange={id => setForm(f => ({ ...f, clientId: id }))}
                />
              </div>
              <div>
                <span className={label}>Programme</span>
                <ProgrammePicker
                  programmes={programmes}
                  value={form.programmeId}
                  legacyName={editing !== 'new' ? form.courseName : ''}
                  viewer={viewer}
                  onChange={pg => setForm(f => ({ ...f, programmeId: pg.id, courseName: pg.name }))}
                />
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
                  <label htmlFor="d-value" className={label}>Deal value (RM)</label>
                  <input id="d-value" inputMode="decimal" value={form.proposalValue} onChange={e => setForm(f => ({ ...f, proposalValue: e.target.value.replace(/[^0-9.]/g, '') }))} className={input} placeholder="15000" />
                </div>
              </div>
              <div>
                <span className={label}>How will it be paid?</span>
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
function DealPanel(props: {
  deal: any; clientName: string; client: any; ownerName: string; personName: (id: string) => string;
  editable: boolean; viewer: Viewer; quotes: any[]; outlines: any[]; checklist: any | null; busy: boolean;
  programme: Programme | undefined; courseName: string; queries: HrdcQuery[]; team: { id: string; name: string }[];
  moneyIn: MoneyIn[]; moneyOut: MoneyOut[]; moneySettings: MoneySettings;
  stagePanel: null | 'won' | 'lost'; setStagePanel: (v: null | 'won' | 'lost') => void; stageError: string;
  wonDate: string; setWonDate: (v: string) => void; lostReason: string; setLostReason: (v: string) => void;
  lostNote: string; setLostNote: (v: string) => void;
  onClose: () => void; onEdit: () => void; onAppointment: () => void; onProposal: () => void;
  onWon: () => void; onLost: () => void; onReopen: () => void;
  onCreateQuotation: () => void; onCreateOutline: () => void; onOpenQuotations: () => void; onOpenOutlines: () => void;
}) {
  const p = props.deal;
  const st = dealStage(p);
  const journey: DealStage[] = ['lead', 'appointment', 'proposal', 'won'];
  const reached = st === 'lost' ? -1 : journey.indexOf(st);
  const canUndoWin = props.viewer.role !== 'rep';
  const isHrdcDeal = p.fundingType === 'hrdc' || p.fundingType === 'hrdc_topup';
  const grantBlock = grantBlockReason(p, props.programme);

  return (
    <div className="space-y-6 text-ink">
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
          </li>
        ))}
      </ol>
      {st === 'lost' && (
        <p className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
          Lost on {formatDate(p.lostDate) || 'an earlier date'}{p.lostReason ? `: ${p.lostReason}` : ''}{p.lostNote ? `. ${p.lostNote}` : ''}
        </p>
      )}

      {/* Actions */}
      {props.editable ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {st === 'lead' && <button type="button" disabled={props.busy} className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-[#0B5A50]" onClick={props.onAppointment}>Appointment held</button>}
            {(st === 'lead' || st === 'appointment') && <button type="button" disabled={props.busy} className={st === 'appointment' ? 'inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-[#0B5A50]' : btnSecondary} onClick={props.onProposal}>Proposal sent</button>}
            {OPEN_STAGES.includes(st) && (
              <>
                <button type="button" className={st === 'proposal' ? 'inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-[#0B5A50]' : btnSecondary} onClick={() => props.setStagePanel('won')}><Trophy className="h-4 w-4" /> Mark won</button>
                <button type="button" className={`${btnSecondary} text-danger hover:bg-danger-soft`} onClick={() => props.setStagePanel('lost')}><XCircle className="h-4 w-4" /> Mark lost</button>
              </>
            )}
            {st === 'lost' && <button type="button" disabled={props.busy} className={btnSecondary} onClick={props.onReopen}><Undo2 className="h-4 w-4" /> Reopen deal</button>}
            {st === 'won' && canUndoWin && <button type="button" disabled={props.busy} className={btnSecondary} onClick={props.onReopen}><Undo2 className="h-4 w-4" /> Undo win</button>}
            <button type="button" className={btnSecondary} onClick={props.onEdit}>Edit details</button>
          </div>

          {props.stagePanel === 'won' && (
            <div className="rounded-xl border border-accent/30 bg-accent-soft p-4">
              <label htmlFor="won-date" className="mb-1.5 block text-sm font-semibold text-accent">Date the client confirmed</label>
              <input id="won-date" type="date" value={props.wonDate} onChange={e => props.setWonDate(e.target.value)} className={input} />
              <p className="mt-2 text-sm text-accent">The sale counts toward KPI in this month.</p>
              <div className="mt-3 flex gap-2">
                <button type="button" className={btnSecondary} onClick={() => props.setStagePanel(null)}>Cancel</button>
                <button type="button" disabled={props.busy} className={btnPrimary} onClick={props.onWon}>Confirm won</button>
              </div>
            </div>
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
        </div>
      ) : (
        <p className="rounded-lg bg-surface px-3.5 py-2.5 text-sm text-ink-soft">Only {props.ownerName}, Admin and Management can change this deal.</p>
      )}

      {/* Details */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[15px]">
        <Detail term="Value" value={dealValue(p) ? formatRM(dealValue(p)) : '—'} />
        <Detail term="Paid by" value={p.fundingType ? FUNDING_LABELS[p.fundingType as FundingType] : 'Not set'} />
        <Detail term="Owner" value={props.ownerName} />
        <Detail term="Type" value={p.type || '—'} />
        <Detail term="Client asked on" value={formatDate(p.requestDate) || '—'} />
        <Detail term="Training date" value={formatDate(p.trainingDate) || 'Not set'} />
        <Detail term="Proposal sent" value={formatDate(p.proposalSentDate) || 'Not yet'} />
        <Detail term="Next follow-up" value={formatDate(p.followUpDate) || 'Not set'} />
        {st === 'won' && <Detail term="Won on" value={formatDate(dealWonDate(p))} />}
        {props.client && <Detail term="Contact" value={[props.client.contactName, props.client.phone].filter(Boolean).join(', ') || '—'} />}
        {props.client && <Detail term="HRDC registered" value={props.client.hrdcRegistered ? 'Yes' : 'No'} />}
      </dl>
      {props.programme && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
          Programme: <StatusChip programme={props.programme} />{props.programme.hrdcCode && <span>HRDC code {props.programme.hrdcCode}</span>}
        </p>
      )}
      {!p.clientId && (
        <p className="rounded-lg bg-attention-soft px-3.5 py-2.5 text-sm text-attention">This older deal isn't linked to the client list yet. Use Edit details to pick the client.</p>
      )}
      {st !== 'lost' && grantBlock && (
        <p className="rounded-lg bg-attention-soft px-3.5 py-2.5 text-sm text-attention">HRDC: {grantBlock}</p>
      )}
      {(p.taggedRepIds || []).length > 0 && (
        <p className="text-sm text-ink-soft">
          Helping: {(p.taggedRepIds || []).map((id: string) => `${props.personName(id)}${(p.completedTags || []).includes(id) ? ' (done)' : ''}`).join(', ')}
          {p.tagNote ? `. "${p.tagNote}"` : ''}
        </p>
      )}
      {p.notes && <p className="whitespace-pre-line rounded-lg bg-surface px-3.5 py-2.5 text-[15px]">{p.notes}</p>}

      {/* Documents */}
      <section>
        <h4 className="mb-2 font-bold">Documents</h4>
        <div className="space-y-2">
          <DocRow icon={<FileText className="h-4 w-4" />} name="Quotations" items={props.quotes.map(q => q.refNumber || q.id)} onOpen={props.onOpenQuotations} onCreate={props.editable ? props.onCreateQuotation : undefined} createLabel="Create quotation" />
          <DocRow icon={<ClipboardList className="h-4 w-4" />} name="Course outlines" items={props.outlines.map(o => o.refNumber || o.courseTitle || o.id)} onOpen={props.onOpenOutlines} onCreate={props.editable ? props.onCreateOutline : undefined} createLabel="Create outline" />
        </div>
      </section>

      {/* Admin checklist (after the deal is won) */}
      {st === 'won' && (
        <section>
          <h4 className="mb-2 font-bold">Admin checklist</h4>
          <DealChecklist
            deal={p}
            checklist={props.checklist}
            quotes={props.quotes}
            viewer={props.viewer}
            onCreateQuotation={props.editable ? props.onCreateQuotation : undefined}
            onOpenQuotations={props.onOpenQuotations}
            grantBlock={grantBlock}
          />
        </section>
      )}

      {/* HRDC queries (HRDC-funded won deals) */}
      {st === 'won' && isHrdcDeal && (
        <section>
          <h4 className="mb-2 font-bold">HRDC queries</h4>
          <HrdcQueries deal={p} queries={props.queries} viewer={props.viewer} people={props.team} />
        </section>
      )}

      {/* Money (won deals): full view for Admin and Management, status only for reps */}
      {st === 'won' && (
        <section>
          <h4 className="mb-2 font-bold">{props.viewer.role === 'rep' ? 'Payment status' : 'Money'}</h4>
          {props.viewer.role === 'rep'
            ? <RepMoneyStatus deal={p} ins={props.moneyIn} />
            : <MoneyPanel deal={p} viewer={props.viewer} ins={props.moneyIn} outs={props.moneyOut} settings={props.moneySettings} />}
        </section>
      )}

      {/* History */}
      {(p.history || []).length > 0 && (
        <section>
          <h4 className="mb-2 font-bold">History</h4>
          <ul className="space-y-1.5 text-sm text-ink-soft">
            {[...(p.history || [])].reverse().slice(0, 12).map((h: any, i: number) => (
              <li key={i}>{new Date(h.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}: {h.action} <span className="text-ink-soft/70">by {h.byName}</span></li>
            ))}
          </ul>
        </section>
      )}
    </div>
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
          {selected.contactName && <span className="block truncate text-sm text-ink-soft">{selected.contactName}</span>}
        </span>
        <button type="button" className="text-sm font-semibold text-accent hover:underline" onClick={() => { setOpen(true); setQueryText(''); }}>Change</button>
      </div>
    );
  }

  return (
    <div className="relative">
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
