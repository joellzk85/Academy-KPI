// Public programmes (Joel, 2026-10-28, lib/publicProgrammes.ts): runs on fixed dates that many companies join.
// Opened from Deals → "Public programmes". Everyone sees the runs and their seats; Admin and Management set up,
// change, cancel or move a run. Each company is a normal deal: "Add a company" opens the New deal form on this run.
import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, onSnapshot, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { ArrowLeft, Calculator, CalendarDays, GraduationCap, ListChecks, Loader2, MapPin, Pencil, Plus, Search, Users, X, XCircle } from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import {
  FUNDING_LABELS, FundingType, STAGE_LABELS, dealOwnerId, dealStage, dealValue, formatRM, parseTrainingDays, todayIso, trainingDateText, trainingDays,
} from '../lib/deals';
import {
  PublicProgramme, RUN_STATE_LABELS, RunState, cancelProblem, howToMove, joinableRuns, paxOf, runAsDeal, runDeals, runPL, runProblem, runSeats, runState, waitingDeals, withRunPicks,
} from '../lib/publicProgrammes';
import { CANCEL_LOST_REASON, CANCEL_REASONS, TrainingChange } from '../lib/trainingChange';
import { Programme } from '../lib/programmes';
import { ProgrammePicker } from './Programmes';
import TrainingDaysPicker from './TrainingDaysPicker';
import PanelResizer from './PanelResizer';
import DraftBar from './DraftBar';
import ListPager from './ListPager';
import { useFormDraft } from '../lib/useFormDraft';
import { usePaged } from '../lib/listPaging';
import DealChecklist from './DealChecklist';
import CostEstimator, { RunStart } from './CostEstimator';
import { newLineId } from '../lib/costEstimate';
import { useMoneySettings } from './Money';
import { projectRows } from '../lib/projectPL';
import { MoneyIn, MoneyOut, inPL } from '../lib/money';
import { linkedOnly, withoutDeleted } from '../lib/linked';

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const label = 'mb-1.5 block text-sm font-semibold text-ink';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';
const btnDanger =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-60';

const STATE_TONE: Record<RunState, string> = {
  cancelled: 'bg-danger-soft text-danger',
  done: 'bg-surface text-ink-soft',
  running: 'bg-[#E8EEF8] text-[#2B4A7E]',
  go: 'bg-accent-soft text-accent',
  short: 'bg-attention-soft text-attention',
  open: 'bg-[#EFE8F8] text-[#5B3A8C]',
};

type Tab = 'upcoming' | 'past' | 'cancelled';

const emptyForm = () => ({
  programmeId: '', type: 'Training', trainingDate: '', trainingDays: '', venueId: '', trainerId: '', outlineId: '',
  pricePerPax: '', seatLimit: '', minPax: '', notes: '', moveNote: '',
});

const waitingText = (names: string[]) =>
  names.length ? `${names.join(', ')} ${names.length === 1 ? 'has' : 'have'} a change waiting for Management's approval. Approve or withdraw it on the deal first, then come back.` : '';

const entry = (viewer: Viewer, action: string) => ({ at: new Date().toISOString(), byId: viewer.id, byName: viewer.name, action });

export default function PublicProgrammes({ runs, deals, programmes, outlines, venues, trainers, clients, people, viewer, onBack, onAddCompany, onOpenDeal }: {
  runs: PublicProgramme[];
  deals: any[];
  programmes: Programme[];
  outlines: any[];
  venues: any[];
  trainers: any[];
  clients: any[];
  people: { id: string; name: string }[];
  viewer: Viewer;
  onBack: () => void;
  onAddCompany: (run: PublicProgramme) => void;
  onOpenDeal: (dealId: string) => void;
}) {
  const staff = viewer.role !== 'rep';
  const [tab, setTab] = useState<Tab>('upcoming');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<'new' | string | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [formError, setFormError] = useState('');
  const formDraft = useFormDraft(viewer.id, editing === 'new' ? 'public:new' : editing ? `public:${editing}` : null, form, setForm);
  const [cancelling, setCancelling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [costing, setCosting] = useState<string | null>(null);   // run id: its Costing estimator estimate open (2026-10-28)
  const [toast, setToast] = useState('');
  const flash = (t: string) => { setToast(t); window.setTimeout(() => setToast(x => (x === t ? '' : x)), 4500); };

  const today = todayIso();
  const personName = (id: string) => people.find(r => r.id === id)?.name || 'Former team member';
  const clientName = (p: any) => clients.find(c => c.id === p.clientId)?.companyName || p.client || 'No client';

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = runs.filter(r => {
      const st = runState(r, deals, today);
      if (tab === 'cancelled' ? st !== 'cancelled' : tab === 'past' ? st !== 'done' : st === 'cancelled' || st === 'done') return false;
      return !q || `${r.title} ${r.venueName} ${r.trainerName}`.toLowerCase().includes(q);
    });
    // Upcoming: soonest first; past and cancelled: latest first.
    return list.sort((a, b) => tab === 'upcoming'
      ? String(a.trainingDate || '9999').localeCompare(String(b.trainingDate || '9999'))
      : String(b.trainingDate || '').localeCompare(String(a.trainingDate || '')));
  }, [runs, deals, tab, search, today]);
  const paged = usePaged(visible, [tab, search]);

  const openRun = runs.find(r => r.id === openId) || null;

  // ---------- Set up / change a run ----------
  const startNew = () => { setForm(emptyForm()); setFormError(''); setEditing('new'); setOpenId(null); };
  const startEdit = (r: PublicProgramme) => {
    setForm({
      programmeId: r.programmeId || '', type: r.type || 'Training', trainingDate: r.trainingDate || '', trainingDays: trainingDays(r) !== 1 ? String(trainingDays(r)) : '',
      venueId: r.venueId || '', trainerId: r.trainerId || '', outlineId: r.outlineId || '',
      pricePerPax: r.pricePerPax ? String(r.pricePerPax) : '', seatLimit: r.seatLimit ? String(r.seatLimit) : '', minPax: r.minPax ? String(r.minPax) : '',
      notes: r.notes || '', moveNote: '',
    });
    setFormError('');
    setEditing(r.id);
  };
  const existing = editing && editing !== 'new' ? runs.find(r => r.id === editing) || null : null;
  const joined = existing ? runDeals(existing.id, deals) : [];
  const days = parseTrainingDays(form.trainingDays);
  const dateMoved = !!existing && (form.trainingDate !== existing.trainingDate || days !== trainingDays(existing));

  // A run's new date reaches its companies' deals: open ones now; won ones as a date change a manager approves.
  const moveDeals = async (list: any[], newDate: string, newDays: number, why: string, toRun: PublicProgramme | null): Promise<{ moved: number; asked: number; busyNames: string[]; failed: string[] }> => {
    const out = { moved: 0, asked: 0, busyNames: [] as string[], failed: [] as string[] };
    for (const p of list) {
      const how = howToMove(p);
      const name = clientName(p);
      try {
        if (how.kind === 'busy') { out.busyNames.push(name); continue; }
        if (how.kind === 'direct') {
          await updateDoc(doc(db, 'pipelines', p.id), {
            trainingDate: newDate, trainingDays: newDays,
            ...(toRun ? { publicProgrammeId: toRun.id } : {}),
            history: [...(p.history || []), entry(viewer, toRun ? `Moved to the public programme on ${trainingDateText({ trainingDate: newDate, trainingDays: newDays }, true)}: ${why}` : `Public programme date changed to ${trainingDateText({ trainingDate: newDate, trainingDays: newDays }, true)}: ${why}`)],
          });
          out.moved++;
        } else {
          const c: TrainingChange = {
            id: `tc_${Date.now()}_${out.asked}`, kind: 'date', status: 'pending', newDate, newDays,
            ...(toRun ? { newRunId: toRun.id, newRunTitle: toRun.title } : {}),
            oldDate: String(p.trainingDate || '').slice(0, 10), oldDays: trainingDays(p),
            reason: 'Public programme moved', note: why.slice(0, 500),
            byId: viewer.id, byName: viewer.name, byRole: viewer.role, at: new Date().toISOString(),
          };
          await updateDoc(doc(db, 'pipelines', p.id), {
            trainingChange: c,
            history: [...(p.history || []), entry(viewer, `Asked: move the training to ${trainingDateText({ trainingDate: newDate, trainingDays: newDays }, true)} with the public programme (${why}). Waiting for Management approval`)],
          });
          out.asked++;
        }
      } catch (err) {
        out.failed.push(`${name} (${friendlyError(err)})`);
      }
    }
    return out;
  };
  const moveText = (r: { moved: number; asked: number; busyNames: string[]; failed: string[] }) => [
    r.moved ? `${r.moved} deal${r.moved === 1 ? '' : 's'} moved` : '',
    r.asked ? `${r.asked} won deal${r.asked === 1 ? '' : 's'} sent to Management to approve the new date` : '',
    r.busyNames.length ? `Not moved (a request is already waiting): ${r.busyNames.join(', ')}` : '',
    r.failed.length ? `Couldn't be changed: ${r.failed.join('; ')}` : '',
  ].filter(Boolean).join('. ');
  // Won deals with a change already waiting for approval: the run waits until it's decided, so no company is left behind.
  const waitingProblem = (list: any[], cancel = false) => waitingText(waitingDeals(list, cancel).map(clientName));

  const saveRun = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    const programme = programmes.find(x => x.id === form.programmeId);
    const price = Number(form.pricePerPax);
    const seatLimit = form.seatLimit.trim() === '' ? 0 : Number(form.seatLimit);
    const minPax = form.minPax.trim() === '' ? 0 : Number(form.minPax);
    const problem = runProblem({ programmeId: programme ? programme.id : '', trainingDate: form.trainingDate, trainingDays: days, pricePerPax: price, seatLimit, minPax });
    if (problem) return setFormError(problem);
    if (existing && joined.length && programme!.id !== existing.programmeId) {
      return setFormError('Companies have joined this run, so its title can\'t change. Cancel the run (or move the companies) and set up a new one.');
    }
    if (existing && seatLimit > 0 && runSeats(existing, deals).seats > seatLimit) {
      return setFormError(`${runSeats(existing, deals).seats} seats are already taken. The seat limit can't be lower than that.`);
    }
    if (dateMoved && joined.length && form.moveNote.trim().length < 5) return setFormError('Say in a few words why the date is moving. Each company\'s deal records it.');
    if (dateMoved && waitingProblem(joined)) return setFormError(waitingProblem(joined));
    const venue = venues.find(v => v.id === form.venueId);
    const trainer = trainers.find(t => t.id === form.trainerId);
    setBusy(true);
    try {
      const id = existing ? existing.id : `pub_${Date.now()}`;
      const data: any = {
        id,
        programmeId: programme!.id, title: programme!.name,
        type: form.type === 'Teambuilding' ? 'Teambuilding' : 'Training',
        trainingDate: form.trainingDate, trainingDays: days,
        venueId: venue ? venue.id : '', venueName: venue ? venue.name || '' : '',
        trainerId: trainer ? trainer.id : '', trainerName: trainer ? trainer.name || '' : '',
        outlineId: outlines.some(o => o.id === form.outlineId) ? form.outlineId : '',
        pricePerPax: Math.round(price * 100) / 100, seatLimit, minPax, notes: form.notes.trim().slice(0, 1000),
      };
      if (!existing) {
        Object.assign(data, { status: 'open', createdAt: Date.now(), createdById: viewer.id, createdByName: viewer.name, history: [entry(viewer, 'Public programme set up')] });
      } else {
        const changes: string[] = [];
        if (dateMoved) changes.push(`Date changed from ${trainingDateText(existing, true)} to ${trainingDateText({ trainingDate: form.trainingDate, trainingDays: days }, true)}: ${form.moveNote.trim()}`);
        if (Math.abs(data.pricePerPax - (Number(existing.pricePerPax) || 0)) > 0.005) changes.push(`List price per pax changed from ${formatRM(existing.pricePerPax)} to ${formatRM(data.pricePerPax)} (companies already in keep their price)`);
        if (seatLimit !== (Number(existing.seatLimit) || 0)) changes.push(`Seat limit ${seatLimit || 'none'}`);
        if (minPax !== (Number(existing.minPax) || 0)) changes.push(`Minimum pax ${minPax || 'none'}`);
        data.history = [...(existing.history || []), entry(viewer, changes.join('. ') || 'Details updated')];
      }
      await setDoc(doc(db, 'public_programmes', id), data, { merge: true });
      // A changed venue or trainer reaches the run's checklist steps that aren't done yet (typed once).
      if (existing && (data.venueId !== (existing.venueId || '') || data.trainerId !== (existing.trainerId || ''))) {
        const cl = await getDoc(doc(db, 'deal_checklists', id)).catch(() => null);
        const cd: any = cl?.exists() ? cl.data() : null;
        if (cd) {
          const next = withRunPicks(cd.tasks || [], data);
          if (JSON.stringify(next) !== JSON.stringify(cd.tasks || [])) {
            await updateDoc(doc(db, 'deal_checklists', id), {
              tasks: next, updatedAt: Date.now(),
              history: [...(cd.history || []), entry(viewer, 'Venue / trainer updated from the public programme')].slice(-60),
            });
          }
        }
      }
      let msg = existing ? 'Public programme saved' : 'Public programme set up';
      if (dateMoved && joined.length) {
        const r = await moveDeals(joined, form.trainingDate, days as number, form.moveNote.trim(), null);
        msg += `. ${moveText(r)}`;
      }
      formDraft.clear();
      setEditing(null);
      setOpenId(id);
      flash(msg);
    } catch (err) {
      setFormError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  // ---------- Render ----------
  // Cost this programme (Admin and Management, 2026-10-28): the Costing estimator's public programme estimate for this
  // run, option A filled in with each company's pax, fee per pax (deal value ÷ pax) and HRDC or direct.
  const costRun = costing ? runs.find(r => r.id === costing) : null;
  if (costRun && staff) {
    const start: RunStart = {
      runId: costRun.id, title: costRun.title, days: Number(costRun.trainingDays) || 1,
      listPrice: Number(costRun.pricePerPax) || 0, seatLimit: Number(costRun.seatLimit) || 0, minPax: Number(costRun.minPax) || 0,
      groups: runDeals(costRun.id, deals).map(p => {
        const pax = paxOf(p);
        return {
          id: newLineId(), name: clientName(p), pax,
          fee: pax ? Math.round((dealValue(p) / pax) * 100) / 100 : Number(costRun.pricePerPax) || 0,
          hrdc: p.fundingType === 'hrdc' || p.fundingType === 'hrdc_topup',
        };
      }),
    };
    return <CostEstimator viewer={viewer} people={people} run={start} backText="Back to the programme" onClose={() => setCosting(null)} />;
  }

  return (
    <div className="space-y-5 font-sans text-ink">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <button type="button" onClick={onBack} className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline">
            <ArrowLeft className="h-4 w-4" /> Back to deals
          </button>
          <h2 className="text-xl font-bold">Public programmes</h2>
          <p className="mt-0.5 text-[15px] text-ink-soft">Programmes on fixed dates that many companies join. Each company is its own deal, owned by the rep who sold it.</p>
        </div>
        {staff && (
          <button type="button" onClick={startNew} className={btnPrimary}><Plus className="h-4 w-4" /> New public programme</button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-line bg-white p-0.5">
          {([['upcoming', 'Upcoming'], ['past', 'Past'], ['cancelled', 'Cancelled']] as [Tab, string][]).map(([k, t]) => (
            <button key={k} type="button" onClick={() => setTab(k)}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold ${tab === k ? 'bg-ink text-white' : 'text-ink-soft hover:text-ink'}`}>{t}</button>
          ))}
        </div>
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search title, venue or trainer" className={`${input} pl-9`} aria-label="Search public programmes" />
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-white">
        {visible.length === 0 ? (
          <div className="p-8 text-center">
            <p className="font-semibold">{tab === 'upcoming' ? 'No upcoming public programmes' : tab === 'past' ? 'No past public programmes' : 'No cancelled public programmes'}</p>
            {tab === 'upcoming' && <p className="mt-1 text-[15px] text-ink-soft">{staff ? 'Set one up with its dates, venue, trainer and price per pax. Reps then add the companies that join.' : 'Admin or Management set them up; you then add the companies you sell seats to.'}</p>}
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {paged.pageItems.map(r => <RunRow key={r.id} run={r} deals={deals} today={today} onOpen={() => setOpenId(r.id)} />)}
          </ul>
        )}
        <ListPager paged={paged} noun="public programmes" />
      </div>

      {/* Run panel */}
      {openRun && !editing && (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" role="dialog" aria-modal="true" onClick={() => { setOpenId(null); setCancelling(false); }}>
          <PanelResizer />
          <div className="h-full w-full md:w-[var(--panel-w,max(50vw,40rem))] md:min-w-[24rem] md:max-w-[95vw] overflow-y-auto bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <RunPanel
              run={openRun} runs={runs} deals={deals} outlines={outlines} viewer={viewer} today={today}
              clientName={clientName} personName={personName}
              cancelling={cancelling} setCancelling={setCancelling}
              onClose={() => { setOpenId(null); setCancelling(false); }}
              onEdit={() => startEdit(openRun)}
              onCost={() => setCosting(openRun.id)}
              onAddCompany={() => onAddCompany(openRun)}
              onOpenDeal={onOpenDeal}
              moveDeals={moveDeals} moveText={moveText} flash={flash}
            />
          </div>
        </div>
      )}

      {/* Set up / change */}
      {editing && (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" role="dialog" aria-modal="true">
          <PanelResizer />
          <div className="h-full w-full md:w-[var(--panel-w,max(50vw,40rem))] md:min-w-[24rem] md:max-w-[95vw] overflow-y-auto bg-white p-6 shadow-xl">
            <div className="mb-5 flex items-start justify-between gap-4">
              <h3 className="text-lg font-bold">{editing === 'new' ? 'New public programme' : 'Change public programme'}</h3>
              <button type="button" onClick={() => setEditing(null)} className="rounded-md p-1 text-ink-soft hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={saveRun} className="space-y-4">
              <DraftBar draft={formDraft} what={editing === 'new' ? 'new public programme' : 'change to this public programme'} />
              <div className={existing && joined.length ? 'pointer-events-none opacity-60' : ''} aria-disabled={(existing && joined.length > 0) || undefined}>
                <span className={label}>Title</span>
                <ProgrammePicker programmes={programmes} value={form.programmeId} viewer={viewer} outlines={outlines} showLinks
                  onChange={(pg, t) => setForm(f => ({ ...f, programmeId: pg.id, type: t === 'teambuilding' ? 'Teambuilding' : 'Training', outlineId: '' }))} />
                {existing && joined.length > 0 && <p className="mt-1.5 text-sm text-ink-soft">Companies have joined, so the title stays.</p>}
              </div>
              {form.programmeId && (
                <div>
                  <label htmlFor="pp-outline" className={label}>Course outline <span className="font-normal text-ink-soft">(optional)</span></label>
                  <select id="pp-outline" value={form.outlineId} onChange={e => setForm(f => ({ ...f, outlineId: e.target.value }))} className={input}>
                    <option value="">Not picked yet</option>
                    {outlines.filter(o => o.programmeId === form.programmeId).map(o => (
                      <option key={o.id} value={o.id}>{o.courseTitle || 'Course outline'}{o.refNumber ? ` (${o.refNumber})` : ''}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="pp-date" className={label}>Training date</label>
                  <input id="pp-date" type="date" value={form.trainingDate} onChange={e => setForm(f => ({ ...f, trainingDate: e.target.value }))} className={input} />
                </div>
                <div>
                  <TrainingDaysPicker id="pp-days" label="How long is the training?" value={form.trainingDays} onChange={v => setForm(f => ({ ...f, trainingDays: v }))} />
                </div>
              </div>
              {dateMoved && joined.length > 0 && (
                <div className="rounded-lg border border-attention/30 bg-attention-soft p-3">
                  <p className="text-sm text-attention">
                    {joined.length} compan{joined.length === 1 ? 'y has' : 'ies have'} joined. Their deals move to the new date; won deals need a manager to approve the new date first.
                  </p>
                  <label htmlFor="pp-why" className={`${label} mt-2`}>Why is the date moving?</label>
                  <input id="pp-why" value={form.moveNote} onChange={e => setForm(f => ({ ...f, moveNote: e.target.value }))} className={input} maxLength={300} placeholder="e.g. Venue not available on the first date" />
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="pp-venue" className={label}>Venue</label>
                  <select id="pp-venue" value={form.venueId} onChange={e => setForm(f => ({ ...f, venueId: e.target.value }))} className={input}>
                    <option value="">Not picked yet</option>
                    {[...venues].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))).map(v => <option key={v.id} value={v.id}>{v.name || 'Venue'}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="pp-trainer" className={label}>Trainer</label>
                  <select id="pp-trainer" value={form.trainerId} onChange={e => setForm(f => ({ ...f, trainerId: e.target.value }))} className={input}>
                    <option value="">Not picked yet</option>
                    {[...trainers].filter(t => !t.deleted).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))).map(t => <option key={t.id} value={t.id}>{t.name || 'Trainer'}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label htmlFor="pp-price" className={label}>List price per pax (RM)</label>
                  <input id="pp-price" inputMode="decimal" value={form.pricePerPax} onChange={e => setForm(f => ({ ...f, pricePerPax: e.target.value.replace(/[^0-9.]/g, '') }))} className={input} placeholder="1500" />
                </div>
                <div>
                  <label htmlFor="pp-seats" className={label}>Seat limit <span className="font-normal text-ink-soft">(blank = none)</span></label>
                  <input id="pp-seats" inputMode="numeric" value={form.seatLimit} onChange={e => setForm(f => ({ ...f, seatLimit: e.target.value.replace(/[^0-9]/g, '') }))} className={input} placeholder="30" />
                </div>
                <div>
                  <label htmlFor="pp-min" className={label}>Minimum pax to run</label>
                  <input id="pp-min" inputMode="numeric" value={form.minPax} onChange={e => setForm(f => ({ ...f, minPax: e.target.value.replace(/[^0-9]/g, '') }))} className={input} placeholder="10" />
                </div>
              </div>
              <p className="text-sm text-ink-soft">Each company's deal starts at the list price × its pax. A bulk or special price goes through "Request discount" on the quotation, which a manager approves. Changing the list price later doesn't change companies already in.</p>
              <div>
                <label htmlFor="pp-notes" className={label}>Notes</label>
                <textarea id="pp-notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className={`${input} min-h-[80px]`} maxLength={1000} />
              </div>
              {formError && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{formError}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" className={btnSecondary} onClick={() => setEditing(null)}>Cancel</button>
                <button type="submit" disabled={busy} className={btnPrimary}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{editing === 'new' ? 'Set up' : 'Save'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {toast && <div role="status" className="fixed bottom-24 left-1/2 z-[60] max-w-[90vw] -translate-x-1/2 rounded-xl bg-ink px-4 py-3 text-sm font-medium text-white shadow-lg">{toast}</div>}
    </div>
  );
}

// ---------- Seats bar ----------
function SeatsLine({ run, deals }: { run: PublicProgramme; deals: any[] }) {
  const s = runSeats(run, deals);
  const limit = Number(run.seatLimit) || 0;
  const min = Number(run.minPax) || 0;
  const scale = Math.max(limit, min, s.seats, 1);
  return (
    <div className="space-y-1">
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-surface" aria-hidden>
        <div className="absolute inset-y-0 left-0 bg-accent/30" style={{ width: `${(s.seats / scale) * 100}%` }} />
        <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${(s.wonSeats / scale) * 100}%` }} />
        {min > 0 && <div className="absolute inset-y-0 w-0.5 bg-ink" style={{ left: `${Math.min(100, (min / scale) * 100)}%` }} />}
      </div>
      <p className="text-[13px] text-ink-soft">
        <strong className="text-ink">{s.wonSeats}</strong> confirmed (won) · {s.seats} sold so far{limit ? ` of ${limit} seats` : ''}{min ? ` · minimum ${min}` : ''} · {s.companies} compan{s.companies === 1 ? 'y' : 'ies'}
      </p>
    </div>
  );
}

function RunRow({ run, deals, today, onOpen }: { run: PublicProgramme; deals: any[]; today: string; onOpen: () => void }) {
  const st = runState(run, deals, today);
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full flex-col gap-2 px-5 py-3.5 text-left hover:bg-surface sm:flex-row sm:items-center sm:gap-5">
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{run.title}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-ink-soft">
            {trainingDateText(run, true) && <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{trainingDateText(run, true)}</span>}
            {run.venueName && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{run.venueName}</span>}
            {run.trainerName && <span className="inline-flex items-center gap-1"><GraduationCap className="h-3.5 w-3.5" />{run.trainerName}</span>}
            <span>{formatRM(run.pricePerPax)} per pax</span>
          </span>
        </span>
        <span className="w-full sm:w-72"><SeatsLine run={run} deals={deals} /></span>
        <span className={`self-start rounded-md px-2 py-0.5 text-xs font-semibold sm:self-center ${STATE_TONE[st]}`}>{RUN_STATE_LABELS[st]}</span>
      </button>
    </li>
  );
}

// ---------- One run: its companies, cancel or move ----------
function RunPanel({ run, runs, deals, outlines, viewer, today, clientName, personName, cancelling, setCancelling, onClose, onEdit, onCost, onAddCompany, onOpenDeal, moveDeals, moveText, flash }: {
  run: PublicProgramme; runs: PublicProgramme[]; deals: any[]; outlines: any[]; viewer: Viewer; today: string;
  clientName: (p: any) => string; personName: (id: string) => string;
  cancelling: boolean; setCancelling: (v: boolean) => void;
  onClose: () => void; onEdit: () => void; onCost: () => void; onAddCompany: () => void; onOpenDeal: (id: string) => void;
  moveDeals: (list: any[], newDate: string, newDays: number, why: string, toRun: PublicProgramme | null) => Promise<{ moved: number; asked: number; busyNames: string[]; failed: string[] }>;
  moveText: (r: { moved: number; asked: number; busyNames: string[]; failed: string[] }) => string;
  flash: (t: string) => void;
}) {
  const staff = viewer.role !== 'rep';
  const st = runState(run, deals, today);
  const s = runSeats(run, deals);
  const list = runDeals(run.id, deals);
  // Lost companies stay listed below so nobody wonders where they went.
  const gone = deals.filter(p => p?.publicProgrammeId === run.id && p?.deleted !== true && dealStage(p) === 'lost');
  const outline = outlines.find(o => o.id === run.outlineId);
  const movedTo = run.movedToId ? runs.find(r => r.id === run.movedToId) : null;
  const canJoin = st !== 'cancelled' && st !== 'done' && (!run.trainingDate || run.trainingDate >= today);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-accent">Public programme</p>
          <h3 className="text-lg font-bold">{run.title}</h3>
          <span className={`mt-1 inline-block rounded-md px-2 py-0.5 text-xs font-semibold ${STATE_TONE[st]}`}>{RUN_STATE_LABELS[st]}</span>
        </div>
        <button type="button" onClick={onClose} className="rounded-md p-1 text-ink-soft hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
      </div>

      {run.status === 'cancelled' && (
        <p className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
          Cancelled: {run.cancelReason}{run.cancelNote ? `. ${run.cancelNote}` : ''}{movedTo ? `. Companies moved to the run on ${trainingDateText(movedTo, true)}.` : ''}
        </p>
      )}
      {st === 'short' && (
        <p className="rounded-lg bg-attention-soft px-3.5 py-2.5 text-sm text-attention">
          The training is within 2 weeks and only {s.wonSeats} of the minimum {run.minPax} seats are confirmed. Decide whether it runs, or move the companies to another date.
        </p>
      )}

      <dl className="grid gap-x-6 gap-y-2 text-[15px] sm:grid-cols-2">
        <div><dt className="text-sm text-ink-soft">Dates</dt><dd className="font-semibold">{trainingDateText(run, true) || 'Not set'}</dd></div>
        <div><dt className="text-sm text-ink-soft">List price</dt><dd className="font-semibold">{formatRM(run.pricePerPax)} per pax</dd></div>
        <div><dt className="text-sm text-ink-soft">Venue</dt><dd className="font-semibold">{run.venueName || 'Not picked yet'}</dd></div>
        <div><dt className="text-sm text-ink-soft">Trainer</dt><dd className="font-semibold">{run.trainerName || 'Not picked yet'}</dd></div>
        <div><dt className="text-sm text-ink-soft">Course outline</dt><dd className="font-semibold">{outline ? `${outline.courseTitle || 'Course outline'}${outline.refNumber ? ` (${outline.refNumber})` : ''}` : 'Not picked yet'}</dd></div>
        <div><dt className="text-sm text-ink-soft">Seats</dt><dd className="font-semibold">{Number(run.seatLimit) ? `${run.seatLimit} (${s.left} left)` : 'No limit'}{Number(run.minPax) ? `, minimum ${run.minPax}` : ''}</dd></div>
      </dl>
      {run.notes && <p className="whitespace-pre-wrap rounded-lg bg-surface px-3.5 py-2.5 text-sm">{run.notes}</p>}

      <SeatsLine run={run} deals={deals} />

      <div className="flex flex-wrap gap-2">
        {canJoin && <button type="button" onClick={onAddCompany} className={btnPrimary}><Plus className="h-4 w-4" /> Add a company</button>}
        {staff && run.status !== 'cancelled' && <button type="button" onClick={onEdit} className={btnSecondary}><Pencil className="h-4 w-4" /> Change</button>}
        {staff && <button type="button" onClick={onCost} className={btnSecondary}><Calculator className="h-4 w-4" /> Cost this programme</button>}
        {staff && run.status !== 'cancelled' && st !== 'done' && !cancelling && (
          <button type="button" onClick={() => setCancelling(true)} className={`${btnSecondary} text-danger`}><XCircle className="h-4 w-4" /> Cancel or move companies</button>
        )}
      </div>

      {cancelling && (
        <CancelBox run={run} runs={runs} deals={deals} list={list} viewer={viewer} today={today} clientName={clientName}
          moveDeals={moveDeals} moveText={moveText} onDone={msg => { setCancelling(false); flash(msg); }} onCancel={() => setCancelling(false)} />
      )}

      <section>
        <h4 className="mb-2 flex items-center gap-2 font-semibold"><Users className="h-4 w-4" /> Companies ({list.length})</h4>
        {list.length === 0 ? (
          <p className="text-sm text-ink-soft">No companies yet. {canJoin ? 'Click "Add a company" to make a deal for a company that joins.' : ''}</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-line">
            <ul className="divide-y divide-line">
              {list.map(p => (
                <li key={p.id}>
                  <button type="button" onClick={() => onOpenDeal(p.id)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-left hover:bg-surface">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{clientName(p)}</span>
                      <span className="block text-sm text-ink-soft">{personName(dealOwnerId(p))} · {paxOf(p) ? `${paxOf(p)} pax` : 'pax not set'}{p.fundingType ? ` · ${FUNDING_LABELS[p.fundingType as FundingType]}` : ''}</span>
                    </span>
                    <span className="rounded-md bg-surface px-2 py-0.5 text-xs font-semibold text-ink-soft">{STAGE_LABELS[dealStage(p)]}</span>
                    {p.trainingChange?.status === 'pending' && <span className="rounded-md bg-attention-soft px-2 py-0.5 text-xs font-semibold text-attention">Change waiting approval</span>}
                    <span className="w-28 text-right font-semibold tabular-nums">{dealValue(p) ? formatRM(dealValue(p)) : '—'}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap justify-between gap-2 border-t border-line bg-surface px-4 py-2.5 text-sm">
              <span>{s.seats} pax · {s.companies} compan{s.companies === 1 ? 'y' : 'ies'}</span>
              <span>Won <strong>{formatRM(s.wonValue)}</strong> of {formatRM(s.value)}</span>
            </div>
          </div>
        )}
        {gone.length > 0 && (
          <p className="mt-2 text-sm text-ink-soft">Lost: {gone.map(p => `${clientName(p)}${p.lostReason ? ` (${p.lostReason})` : ''}`).join(', ')}</p>
        )}
      </section>

      {/* Batch 2, part A (2026-10-28): venue, trainer, logistics, costs and training day, once for the whole run */}
      <RunOperations run={run} pax={s.seats} viewer={viewer} />
      {staff && <RunPL run={run} deals={deals} />}

      {Array.isArray(run.history) && run.history.length > 0 && (
        <section>
          <h4 className="mb-2 font-semibold">History</h4>
          <ul className="space-y-1.5 text-sm">
            {[...run.history].reverse().map((h, i) => (
              <li key={i}><span className="text-ink-soft">{new Date(h.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · {h.byName}:</span> {h.action}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// One P&L for the run (part B, 2026-10-28; Admin and Management, it shows costs): the won companies' P&L rows, each with
// its pax share of the run's costs (projectRows → runCostShares), added up; one line per company.
function RunPL({ run, deals }: { run: PublicProgramme; deals: any[] }) {
  const settings = useMoneySettings();
  const [ins, setIns] = useState<MoneyIn[]>([]);
  const [outs, setOuts] = useState<MoneyOut[]>([]);
  const [quotes, setQuotes] = useState<any[]>([]);
  const [plDocs, setPlDocs] = useState<Record<string, any>>({});
  const companies = useMemo(() => deals.filter(p => p.publicProgrammeId === run.id && p.deleted !== true && dealStage(p) === 'won'), [deals, run.id]);
  const ids = companies.map(p => p.id).join(',');
  useEffect(() => {
    const want = new Set([run.id, ...ids.split(',').filter(Boolean)]);
    const subs = [
      onSnapshot(query(collection(db, 'money_in'), where('dealId', 'in', [...want].slice(0, 30))), s => setIns(withoutDeleted(s.docs.map(d => ({ ...(d.data() as MoneyIn), id: d.id })))), () => setIns([])),
      onSnapshot(query(collection(db, 'money_out'), where('dealId', 'in', [...want].slice(0, 30))), s => setOuts(withoutDeleted(s.docs.map(d => ({ ...(d.data() as MoneyOut), id: d.id })))), () => setOuts([])),
      onSnapshot(query(collection(db, 'quotations'), where('pipelineId', 'in', [...want].slice(0, 30))), s => setQuotes(linkedOnly(s.docs.map(d => ({ ...d.data(), id: d.id })))), () => setQuotes([])),
      onSnapshot(query(collection(db, 'project_pl')), s => setPlDocs(Object.fromEntries(s.docs.filter(d => want.has(d.id)).map(d => [d.id, d.data()]))), () => setPlDocs({})),
    ];
    return () => subs.forEach(u => u());
  }, [run.id, ids]);
  const rows = useMemo(() => projectRows(companies, ins, outs, settings, todayIso(), { quotes, plDocs }), [companies, ins, outs, settings, quotes, plDocs]);
  const pl = runPL(rows);
  const runCosts = outs.filter(o => o.dealId === run.id && (o.status === 'approved' || o.status === 'paid') && inPL(o)).reduce((t, o) => t + (Number(o.amount) || 0), 0);
  const waiting = outs.filter(o => o.dealId === run.id && o.status === 'pending').reduce((t, o) => t + (Number(o.amount) || 0), 0);
  if (!companies.length) return null;
  const tile = (labelText: string, value: string, tone = '') => (
    <div className="rounded-xl border border-line bg-white px-3 py-2.5"><p className="text-xs font-semibold text-ink-soft">{labelText}</p><p className={`mt-0.5 font-bold tabular-nums ${tone}`}>{value}</p></div>
  );
  return (
    <section>
      <h4 className="mb-1 font-semibold">P&amp;L for this programme</h4>
      <p className="mb-2 text-sm text-ink-soft">All won companies together. The programme's costs ({formatRM(runCosts)} approved or paid{waiting ? `, ${formatRM(waiting)} waiting approval` : ''}) are shared out to the companies by pax, so each company's own P&amp;L and its rep's GP % carry their share.</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tile(rows.some(r => r.estimate) ? 'Income (some estimated)' : 'Income', formatRM(pl.income))}
        {tile('SST, HRDC %, commission', formatRM(pl.sst + pl.hrdcFee + pl.commission))}
        {tile('Costs', formatRM(pl.costs))}
        {tile(`Profit · GP ${pl.margin.toFixed(1)}%`, formatRM(pl.profit), pl.profit < 0 ? 'text-danger' : 'text-accent')}
      </div>
      <div className="mt-2 overflow-hidden rounded-xl border border-line">
        <ul className="divide-y divide-line text-sm">
          {rows.map(r => (
            <li key={r.deal.id} className="flex flex-wrap items-center gap-x-4 gap-y-0.5 px-3.5 py-2">
              <span className="min-w-0 flex-1 font-semibold">{r.deal.client || 'Company'} <span className="font-normal text-ink-soft">· {paxOf(r.deal)} pax</span></span>
              <span className="tabular-nums text-ink-soft">Income {formatRM(r.income)}</span>
              <span className="tabular-nums text-ink-soft">Costs {formatRM(r.costs)}</span>
              <span className={`w-36 text-right font-semibold tabular-nums ${r.profit < 0 ? 'text-danger' : ''}`}>Profit {formatRM(r.profit)}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// The run's own checklist (deal_checklists/{runId}): the shared steps, with costs raised from them as on a deal.
// Each company's deal keeps its grant, attendance, JD14, T3, invoice and claim.
function RunOperations({ run, pax, viewer }: { run: PublicProgramme; pax: number; viewer: Viewer }) {
  const [checklist, setChecklist] = useState<any | null>(null);
  useEffect(() => onSnapshot(doc(db, 'deal_checklists', run.id), s => setChecklist(s.exists() ? s.data() : null), () => setChecklist(null)), [run.id]);
  const deal = useMemo(() => runAsDeal(run, pax), [run, pax]);
  return (
    <section>
      <h4 className="mb-1 flex items-center gap-2 font-semibold"><ListChecks className="h-4 w-4" /> Operations, once for all companies</h4>
      <p className="mb-2 text-sm text-ink-soft">Venue, trainer (with the PO and fee), bus, facilitator, materials, costs and the training day. Each company's own deal keeps its grant, attendance list, JD14, T3, invoice and claim.</p>
      <DealChecklist deal={deal} checklist={checklist} quotes={[]} viewer={viewer} />
    </section>
  );
}

function CancelBox({ run, runs, deals, list, viewer, today, clientName, moveDeals, moveText, onDone, onCancel }: {
  run: PublicProgramme; runs: PublicProgramme[]; deals: any[]; list: any[]; viewer: Viewer; today: string; clientName: (p: any) => string;
  moveDeals: (list: any[], newDate: string, newDays: number, why: string, toRun: PublicProgramme | null) => Promise<{ moved: number; asked: number; busyNames: string[]; failed: string[] }>;
  moveText: (r: { moved: number; asked: number; busyNames: string[]; failed: string[] }) => string;
  onDone: (msg: string) => void; onCancel: () => void;
}) {
  const [mode, setMode] = useState<'move' | 'cancel'>('move');
  const [toId, setToId] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const targets = joinableRuns(runs, today).filter(r => r.id !== run.id);
  const sameTitle = targets.filter(r => r.programmeId === run.programmeId);
  const others = targets.filter(r => r.programmeId !== run.programmeId);
  const target = runs.find(r => r.id === toId) || null;
  const targetSeats = target ? runSeats(target, deals) : null;
  const moving = list.reduce((t, p) => t + paxOf(p), 0);
  const overLimit = !!target && Number(target.seatLimit) > 0 && (targetSeats!.seats + moving) > Number(target.seatLimit);

  const go = async () => {
    const problem = cancelProblem(reason, note, mode === 'move' ? toId : null, run.id) || waitingText(waitingDeals(list, mode === 'cancel').map(clientName));
    if (problem) return setError(problem);
    if (overLimit) return setError(`The run on ${trainingDateText(target!, true)} has only ${targetSeats!.left} seats left for ${moving} pax. Raise its seat limit first.`);
    if (!window.confirm(mode === 'move'
      ? `Move ${list.length} compan${list.length === 1 ? 'y' : 'ies'} to the run on ${trainingDateText(target!, true)} and cancel this run?`
      : `Cancel this run? ${list.length} compan${list.length === 1 ? 'y\'s deal' : 'ies\' deals'} will be lost ("${CANCEL_LOST_REASON}"); won deals need a manager to approve the cancellation.`)) return;
    setBusy(true);
    setError('');
    const why = `${reason}: ${note.trim()}`;
    try {
      let msg = '', moved = 0, waiting = 0;
      if (mode === 'move') {
        const r = await moveDeals(list, target!.trainingDate, trainingDays(target), why, target);
        msg = moveText(r);
        moved = r.moved; waiting = r.asked;
      } else {
        let lost = 0, asked = 0;
        const busyNames: string[] = [], failed: string[] = [];
        for (const p of list) {
          const how = howToMove(p, true);
          try {
            if (how.kind === 'busy') { busyNames.push(clientName(p)); continue; }
            if (how.kind === 'direct') {
              await updateDoc(doc(db, 'pipelines', p.id), {
                ...(p.onHold ? { onHold: null } : {}),
                stage: 'lost', status: 'Lost', lostDate: todayIso(), lostReason: CANCEL_LOST_REASON, lostNote: why.slice(0, 500),
                lostById: viewer.id, lostByName: viewer.name, lostAt: new Date().toISOString(),
                history: [...(p.history || []), entry(viewer, `Lost: public programme on ${trainingDateText(run, true)} cancelled. ${why.slice(0, 160)}`)],
              });
              lost++;
            } else {
              const c: TrainingChange = {
                id: `tc_${Date.now()}_${asked}`, kind: 'cancel', status: 'pending',
                oldDate: String(p.trainingDate || '').slice(0, 10), oldDays: trainingDays(p),
                reason, note: `Public programme cancelled. ${note.trim()}`.slice(0, 500),
                byId: viewer.id, byName: viewer.name, byRole: viewer.role, at: new Date().toISOString(),
              };
              await updateDoc(doc(db, 'pipelines', p.id), {
                trainingChange: c,
                history: [...(p.history || []), entry(viewer, `Asked: cancel the training (public programme cancelled: ${why.slice(0, 160)}). Waiting for Management approval`)],
              });
              asked++;
            }
          } catch (err) {
            failed.push(`${clientName(p)} (${friendlyError(err)})`);
          }
        }
        msg = [
          lost ? `${lost} deal${lost === 1 ? '' : 's'} marked lost` : '',
          asked ? `${asked} won deal${asked === 1 ? '' : 's'} sent to Management to approve the cancellation` : '',
          busyNames.length ? `not changed (a request is already waiting): ${busyNames.join(', ')}` : '',
          failed.length ? `couldn't be changed: ${failed.join('; ')}` : '',
        ].filter(Boolean).join('. ');
      }
      await updateDoc(doc(db, 'public_programmes', run.id), {
        status: 'cancelled', cancelReason: reason, cancelNote: note.trim().slice(0, 500), movedToId: mode === 'move' ? target!.id : '',
        history: [...(run.history || []), entry(viewer, mode === 'move' ? `Cancelled, companies moved to the run on ${trainingDateText(target!, true)}: ${why}` : `Cancelled: ${why}`)],
      });
      if (mode === 'move') {
        await updateDoc(doc(db, 'public_programmes', target!.id), {
          history: [...(target!.history || []), entry(viewer, `${moved} compan${moved === 1 ? 'y' : 'ies'} moved here from the cancelled run on ${trainingDateText(run, true)}${waiting ? `; ${waiting} won deal${waiting === 1 ? '' : 's'} follow${waiting === 1 ? 's' : ''} once a manager approves the new date` : ''}`)],
        });
      }
      onDone(`Run cancelled${msg ? `. ${msg}` : ''}`);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface p-4">
      <div className="inline-flex rounded-lg border border-line bg-white p-0.5" role="radiogroup" aria-label="Cancel or move">
        {(['move', 'cancel'] as const).map(k => (
          <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => { setMode(k); setError(''); }}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold ${mode === k ? (k === 'cancel' ? 'bg-danger text-white' : 'bg-ink text-white') : 'text-ink-soft hover:text-ink'}`}>
            {k === 'move' ? 'Move companies to another run' : 'Cancel, no new date'}
          </button>
        ))}
      </div>
      {mode === 'move' && (
        <div>
          <label htmlFor="pp-to" className={label}>Move to</label>
          {targets.length === 0 ? (
            <p className="text-sm text-ink-soft">There is no other upcoming run. Set up the new run first, then come back here.</p>
          ) : (
            <select id="pp-to" value={toId} onChange={e => setToId(e.target.value)} className={input}>
              <option value="">Pick the run</option>
              {sameTitle.length > 0 && <optgroup label="Same title">{sameTitle.map(r => <option key={r.id} value={r.id}>{trainingDateText(r, true)} · {r.title}</option>)}</optgroup>}
              {others.length > 0 && <optgroup label="Other titles">{others.map(r => <option key={r.id} value={r.id}>{trainingDateText(r, true)} · {r.title}</option>)}</optgroup>}
            </select>
          )}
          {target && target.programmeId !== run.programmeId && <p className="mt-1.5 text-sm text-attention">That run has a different title. Each company's deal keeps its own title; check with the clients first.</p>}
          {overLimit && <p className="mt-1.5 text-sm text-danger">Not enough seats there: {targetSeats!.left} left for {moving} pax.</p>}
        </div>
      )}
      <p className="text-sm text-ink-soft">
        {list.length} compan{list.length === 1 ? 'y' : 'ies'} in this run. {mode === 'move' ? 'Open deals move now; won deals move once a manager approves the new date.' : 'Open deals become lost now; won deals become lost once a manager approves the cancellation.'}
      </p>
      <div>
        <span className="mb-1.5 block text-sm font-semibold">Why?</span>
        <div className="flex flex-wrap gap-2">
          {CANCEL_REASONS.filter(r => r !== 'Client cancelled' && r !== 'No HRDC grant / levy').concat(['Venue not available']).map(r => (
            <button key={r} type="button" onClick={() => setReason(r)} aria-pressed={reason === r}
              className={`rounded-full border px-3 py-1 text-sm font-medium ${reason === r ? 'border-accent bg-white text-accent' : 'border-line text-ink-soft hover:bg-white'}`}>{r}</button>
          ))}
        </div>
      </div>
      <div>
        <label htmlFor="pp-cnote" className="mb-1.5 block text-sm font-semibold">What happened? <span className="font-normal text-ink-soft">(required, a few words)</span></label>
        <textarea id="pp-cnote" value={note} onChange={e => setNote(e.target.value)} maxLength={500} className={`${input} min-h-[64px]`} placeholder="e.g. Only 6 confirmed by the cut-off, moved to the March run" />
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel}>Back</button>
        <button type="button" disabled={busy || (mode === 'move' && targets.length === 0)} className={mode === 'cancel' ? btnDanger : btnPrimary} onClick={go}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}{mode === 'move' ? 'Move and cancel this run' : 'Cancel this run'}
        </button>
      </div>
    </div>
  );
}
