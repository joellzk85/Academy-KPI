import React, { useEffect, useMemo, useState } from 'react';
import { collection, deleteDoc, doc, getDoc, onSnapshot, query, setDoc } from 'firebase/firestore';
import { Download, FileText, GraduationCap, Loader2, Mail, MessageCircle, Pencil, Phone, Plus, Search, Trash2, X } from 'lucide-react';
import { Representative, Trainer } from '../types';
import { db, friendlyError } from '../lib/firebase';
import { STAGE_LABELS, dealStage, formatDate, formatRM, todayIso } from '../lib/deals';
import { ChecklistTask } from '../lib/checklist';
import { Booking, trainerBookings } from '../lib/trainers';
import { linkedOnly } from '../lib/linked';
import { deleteTrainerEverywhere } from '../lib/detach';
import { LinkShareBox, closeTrainerLink, createTrainerLink, useTrainerLinks } from './TrainerLinkTools';
import { ProfileSubmission, TrainerLink, isLive } from '../lib/trainerLinks';
import { useFormDraft } from '../lib/useFormDraft';
import DraftBar from './DraftBar';
import PhotoPicker from './PhotoPicker';
import { downloadBiodataPdf } from './TrainerBiodataDocument';
import TrainerOverview, { useOverviewAllowed } from './TrainerOverview';
import TrainingReportsList from './TrainingReportsList';
import { BankRequestsBox, PortalAccessBox, PortalInviteDialog, TrainerRatings, useTrainerAccounts } from './TrainerPortalAdmin';
import { pdfErrorText } from '../lib/oldTab';
import TrainerExtrasFields, { TopicList } from './TrainerExtrasFields';
import { DOC_KINDS, TRAINING_TYPES, TrainingType, emptyExtras, cleanIc, extrasFrom, extrasToSave, BIO_LISTS, rowFilled, languagesText, linkHref, topicList, trainingTypeLabel } from '../lib/trainerProfile';
import PanelResizer from './PanelResizer';

// Trainers (redesigned 2026-10-17, like Clients): one shared list, the same details as before.
// Topics are free text (was a fixed list of made-up options). Status is only Available / On leave:
// bookings show by themselves from the deals (Joel removed "Booked").
// Anyone can add and edit; only Management can delete, and only a trainer no quotation or checklist uses.

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };

interface TrainerManagerProps {
  rep: Representative;
  reps: Representative[];
  viewer: Viewer;
}

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const label = 'mb-1.5 block text-sm font-semibold text-ink';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';

const emptyForm = () => ({ ...emptyExtras(), name: '', specialization: '', programmeIds: [] as string[], contact: '', email: '', rate: '', onLeave: false, notes: '',
  bio: '', experienceYears: '', qualifications: '', pastClients: '', suggestedTopics: '', photoUrl: '' });
type Form = ReturnType<typeof emptyForm>;

const norm = (s?: string) => (s || '').trim().toLowerCase();

// IC / passport number (2026-10-20): kept apart, Admin and Management only (trainer_private/{id}); a number a trainer
// typed on a profile link that a rep accepted stays in trainer_link_private/{token} until Admin or Management save it.
async function readIc(t: { id: string; icLinkToken?: string }): Promise<string> {
  const own = await getDoc(doc(db, 'trainer_private', t.id));
  if (own.exists()) return String(own.data().icNumber || '');
  if (t.icLinkToken) {
    const fromLink = await getDoc(doc(db, 'trainer_link_private', t.icLinkToken));
    if (fromLink.exists()) return String(fromLink.data().icNumber || '');
  }
  return '';
}
function useIc(t: { id: string; icLinkToken?: string } | null, allowed: boolean) {
  const [ic, setIc] = useState<{ id: string; value: string } | null>(null);
  useEffect(() => {
    if (!t || !allowed) { setIc(null); return; }
    let live = true;
    readIc(t).then(v => live && setIc({ id: t.id, value: v })).catch(() => live && setIc({ id: t.id, value: '' }));
    return () => { live = false; };
  }, [t?.id, t?.icLinkToken, allowed]);
  return ic && t && ic.id === t.id ? ic.value : null;
}
// One biodata list as lines of text, e.g. "Bachelor of Business · Universiti Malaya · 2010".
const bioText = (rows?: Record<string, string>[]) => (rows || []).filter(rowFilled).map(r => Object.values(r).map(v => String(v || '').trim()).filter(Boolean).join(' · ')).join('\n');
const ecText = (e?: { name?: string; relationship?: string; phone?: string }) =>
  e ? [e.name, e.relationship ? `(${e.relationship})` : '', e.phone].filter(Boolean).join(' ') : '';

// Malaysian numbers: 012-345 6789 -> 60123456789 for WhatsApp.
function whatsappLink(phone: string): string {
  let d = phone.replace(/\D/g, '');
  if (d.startsWith('0')) d = '6' + d;
  return d.length >= 9 ? `https://wa.me/${d}` : '';
}

export default function TrainerManager({ rep, reps, viewer }: TrainerManagerProps) {
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [deals, setDeals] = useState<any[]>([]);
  const [quotes, setQuotes] = useState<any[]>([]);
  // Every record, including old ones not linked yet (hidden on screen), so nothing they use can be deleted.
  const [allDeals, setAllDeals] = useState<any[]>([]);
  const [allQuotes, setAllQuotes] = useState<any[]>([]);
  const [checklists, setChecklists] = useState<Record<string, any>>({});
  const [clients, setClients] = useState<any[]>([]);
  const [programmes, setProgrammes] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [progSearch, setProgSearch] = useState('');
  // Trainer links (Joel, 2026-10-17): invite a new trainer or ask one to update their profile.
  const links = useTrainerLinks();
  const [shareLink, setShareLink] = useState<TrainerLink | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const waiting = links.filter(l => l.kind === 'profile' && l.status === 'submitted' && isLive(l)).sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0));

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TrainingType | ''>('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<'new' | string | null>(null);
  const [form, setForm] = useState<Form>(emptyForm());
  // An unfinished new trainer or edit is kept in this browser until it's saved (lib/useFormDraft.ts).
  const formDraft = useFormDraft(viewer.id, editing ? `trainer:${editing}` : null, form, setForm);
  const [formError, setFormError] = useState('');
  const [dupId, setDupId] = useState<string | null>(null);
  const [panelError, setPanelError] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    const subs = [
      onSnapshot(query(collection(db, 'trainers_directory')), s => { setTrainers(s.docs.map(d => ({ ...(d.data() as Trainer), id: d.id }))); setLoaded(true); }, () => setLoaded(true)),
      onSnapshot(query(collection(db, 'pipelines')), s => { const all = s.docs.map(d => ({ ...d.data(), id: d.id })); setAllDeals(all); setDeals(linkedOnly(all)); }),
      onSnapshot(query(collection(db, 'quotations')), s => { const all = s.docs.map(d => ({ ...d.data(), id: d.id })); setAllQuotes(all); setQuotes(linkedOnly(all)); }),
      onSnapshot(query(collection(db, 'deal_checklists')), s => setChecklists(Object.fromEntries(s.docs.map(d => [d.id, d.data()])))),
      onSnapshot(query(collection(db, 'clients')), s => setClients(s.docs.map(d => ({ ...d.data(), id: d.id })))),
      onSnapshot(query(collection(db, 'programmes')), s => setProgrammes(s.docs.map(d => ({ ...d.data(), id: d.id })))),
    ];
    return () => subs.forEach(u => u());
  }, []);

  const flash = (t: string) => { setToast(t); window.setTimeout(() => setToast(x => (x === t ? '' : x)), 3500); };
  const today = todayIso();

  const inviteNew = async () => {
    try { setShareLink(await createTrainerLink({ kind: 'profile', title: 'Trainer profile' }, viewer)); }
    catch (err) { setFormError(friendlyError(err)); flash(friendlyError(err)); }
  };
  const sendProfileLink = async (t: Trainer) => {
    try { setShareLink(await createTrainerLink({ kind: 'profile', trainerId: t.id, trainerName: t.name, title: 'Trainer profile' }, viewer)); }
    catch (err) { setPanelError(friendlyError(err)); }
  };
  const liveProfileLink = (t: Trainer) => links.filter(l => l.kind === 'profile' && l.trainerId === t.id && isLive(l)).sort((a, b) => b.createdAt - a.createdAt)[0];

  // Accept a submitted profile: update that trainer, or add the invited one (or update a trainer with the same name).
  const acceptProfile = async (l: TrainerLink) => {
    const s = l.submission as ProfileSubmission;
    let targetId = l.trainerId || '';
    if (!targetId && s.name) {
      const same = trainers.find(t => norm(t.name) === norm(s.name));
      if (same && window.confirm(`"${same.name}" is already in the trainer list. Update that trainer with these details? (Cancel to add a separate trainer.)`)) targetId = same.id;
    }
    const cur = targetId ? trainers.find(t => t.id === targetId) : undefined;
    const x = extrasToSave({ ...emptyExtras(), ...s });
    // Nothing on the form is compulsory (2026-10-20): a blank name keeps the old one (or "New trainer"); a new upload
    // replaces that kind of file, and files or a photo they didn't upload again are kept.
    const details = {
      name: s.name || cur?.name || l.trainerName || `New trainer ${formatDate(todayIso())}`,
      contact: s.contact, email: s.email, bio: s.bio, experienceYears: s.experienceYears, qualifications: s.qualifications,
      pastClients: s.pastClients, programmeIds: s.programmeIds, suggestedTopics: s.suggestedTopics, rate: s.rate,
      ...x, docs: { ...(cur?.docs || {}), ...x.docs },
      ...(s.photoUrl ? { photoUrl: s.photoUrl } : {}),
      ...(s.icSent ? { icOnFile: true, icLinkToken: l.id } : {}),
    };
    delete (details as any).icNumber;
    delete (details as any).icSent;
    setBusy(true);
    try {
      if (targetId) await setDoc(doc(db, 'trainers_directory', targetId), details, { merge: true });
      else {
        targetId = `trainer_${Date.now()}`;
        await setDoc(doc(db, 'trainers_directory', targetId), { id: targetId, ...details, photoUrl: s.photoUrl || '', specialization: '', status: 'Available', notes: '', createdAt: Date.now(), createdBy: viewer.id, createdByName: viewer.name });
      }
      // Admin and Management copy the IC number into the trainer's own private record straight away.
      if (s.icSent && isStaff) {
        const fromLink = await getDoc(doc(db, 'trainer_link_private', l.id));
        if (fromLink.exists()) await setDoc(doc(db, 'trainer_private', targetId), { icNumber: fromLink.data().icNumber || '', at: Date.now(), byName: viewer.name });
      }
      await closeTrainerLink(l, 'accepted', viewer);
      setReviewId(null);
      setOpenId(targetId);
      flash('Profile accepted');
    } catch (err) {
      flash(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };
  const discardProfile = async (l: TrainerLink) => {
    if (!window.confirm('Discard what the trainer submitted? The link will be closed.')) return;
    try { await closeTrainerLink(l, 'cancelled', viewer); setReviewId(null); } catch (err) { flash(friendlyError(err)); }
  };

  const bookingsOf = (t: Trainer) => trainerBookings(t, deals, checklists, quotes, trainers);
  const accounts = useTrainerAccounts();
  const [portalInvite, setPortalInvite] = useState<string | null>(null);   // null = closed; '' = no one picked yet
  const overviewAllowed = useOverviewAllowed();
  const [tab, setTab] = useState<'list' | 'overview' | 'reports'>('list');
  const canOverview = viewer.role === 'admin' || viewer.role === 'management' || overviewAllowed.includes(viewer.id);
  const dealLabel = (dealId: string) => {
    const d = deals.find(x => x.id === dealId);
    if (!d) return 'Deal no longer exists';
    return `${clients.find(c => c.id === d.clientId)?.companyName || d.client || 'No client'} · ${d.courseName || 'No programme'}${d.trainingDate ? ` · ${formatDate(d.trainingDate)}` : ''}`;
  };
  const nextTraining = useMemo(() => {
    const out: Record<string, string> = {};
    trainers.forEach(t => {
      const next = bookingsOf(t).map(b => b.date).filter(d => d && d >= today).sort()[0];
      if (next) out[t.id] = next;
    });
    return out;
  }, [trainers, deals, checklists, quotes]);

  // What a trainer teaches comes from the Programme list (Joel, 2026-10-17). Old typed topics stay as a note.
  const progName = (id: string) => String(programmes.find(p => p.id === id)?.name || '').trim();
  const teaches = (t: Trainer) => (t.programmeIds || []).map(progName).filter(Boolean);
  const progOptions = useMemo(() => [...programmes].filter(p => String(p.name || '').trim()).sort((a, b) => String(a.name).localeCompare(String(b.name))), [programmes]);

  const visible = useMemo(() => {
    const q = norm(search);
    const byType = typeFilter ? trainers.filter(t => (t.trainingTypes || []).includes(typeFilter)) : trainers;
    const list = q ? byType.filter(t => [t.name, t.specialization, t.suggestedTopics, t.contact, t.email, teaches(t).join(' '), languagesText(t)].some(v => norm(v).includes(q))) : byType;
    return [...list].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'en', { sensitivity: 'base' }));
  }, [trainers, search, programmes, typeFilter]);

  const openTrainer = trainers.find(t => t.id === openId) || null;

  // ---------- Add / edit ----------
  // A new trainer's id is chosen when the form opens, so files can be uploaded before it's saved.
  const [newId, setNewId] = useState('');
  const startNew = () => { setNewId(`trainer_${Date.now()}`); setForm({ ...emptyForm(), name: search.trim() }); setFormError(''); setDupId(null); setEditing('new'); };
  const startEdit = (t: Trainer) => {
    setForm({ ...extrasFrom(t), name: t.name || '', specialization: t.specialization || '', programmeIds: (t.programmeIds || []).filter(id => programmes.some(p => p.id === id)), contact: t.contact || '', email: t.email || '', rate: t.rate ? String(t.rate) : '', onLeave: t.status === 'On Leave', notes: t.notes || '',
      bio: t.bio || '', experienceYears: t.experienceYears ? String(t.experienceYears) : '', qualifications: t.qualifications || '', pastClients: t.pastClients || '', suggestedTopics: t.suggestedTopics || '', photoUrl: t.photoUrl || '' });
    setProgSearch('');
    setFormError(''); setDupId(null); setEditing(t.id);
  };
  const set = (patch: Partial<Form>) => setForm(f => ({ ...f, ...patch }));
  const isStaff = viewer.role === 'admin' || viewer.role === 'management';
  const editingTrainer = editing && editing !== 'new' ? trainers.find(t => t.id === editing) || null : null;
  const savedIc = useIc(editingTrainer, isStaff);
  const [icInput, setIcInput] = useState<string | null>(null);   // null = not changed on the form
  useEffect(() => { setIcInput(null); }, [editing]);
  const icValue = icInput ?? savedIc ?? '';

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(''); setDupId(null);
    const name = form.name.trim();
    if (!name) return setFormError("Enter the trainer's name.");
    const dup = trainers.find(t => t.id !== editing && norm(t.name) === norm(name));
    if (dup) { setDupId(dup.id); return setFormError(`"${dup.name}" is already in the trainer list.`); }
    const email = form.email.trim();
    if (email && !/^\S+@\S+\.\S+$/.test(email)) return setFormError("That email address doesn't look right.");

    const details = {
      name, specialization: form.specialization.trim(), programmeIds: form.programmeIds, contact: form.contact.trim(), email,
      rate: parseFloat(form.rate.replace(/[^0-9.]/g, '')) || 0,
      status: (form.onLeave ? 'On Leave' : 'Available') as Trainer['status'],
      notes: form.notes.trim(),
      bio: form.bio.trim(), experienceYears: parseFloat(form.experienceYears.replace(/[^0-9.]/g, '')) || 0,
      qualifications: form.qualifications.trim(), pastClients: form.pastClients.trim(), suggestedTopics: form.suggestedTopics.trim(),
      photoUrl: form.photoUrl,
      ...extrasToSave(form),
    };
    setBusy(true);
    try {
      if (editing === 'new') {
        const id = newId || `trainer_${Date.now()}`;
        await setDoc(doc(db, 'trainers_directory', id), { id, ...details, createdAt: Date.now(), createdBy: viewer.id, createdByName: viewer.name });
        setOpenId(id);
        flash('Trainer added');
      } else if (editing) {
        // Each field is replaced as a whole, so a file removed on the form comes off the record.
        await setDoc(doc(db, 'trainers_directory', editing), details, { mergeFields: Object.keys(details) });
        flash('Trainer saved');
      }
      if (isStaff && icInput !== null && cleanIc(icInput) !== (savedIc || '')) {
        const id = editing === 'new' ? newId : editing!;
        const ic = cleanIc(icInput);
        await setDoc(doc(db, 'trainer_private', id), { icNumber: ic, at: Date.now(), byName: viewer.name });
        await setDoc(doc(db, 'trainers_directory', id), { icOnFile: !!ic }, { merge: true });
      }
      formDraft.clear();
      setEditing(null);
    } catch (err) {
      setFormError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  // ---------- Delete (Management only) ----------
  const usedOn = (t: Trainer) => {
    const inQuotes = allQuotes.filter(q => (q.items || []).some((it: any) => it.trainerId === t.id)).length;
    const inChecklists = Object.values(checklists).filter((c: any) => (c.tasks || []).some((x: ChecklistTask) => x.kind === 'trainer' && x.trainerId === t.id)).length;
    return { inQuotes, inChecklists };
  };
  const remove = async (t: Trainer) => {
    setPanelError('');
    const { inQuotes, inChecklists } = usedOn(t);
    // Management can delete a trainer in use (Joel, 2026-10-20): the name is kept on the quotations and checklists as typed text.
    const parts = [inQuotes ? `${inQuotes} quotation${inQuotes === 1 ? '' : 's'}` : '', inChecklists ? `${inChecklists} admin checklist${inChecklists === 1 ? '' : 's'}` : ''].filter(Boolean);
    const used = parts.length ? ` They are on ${parts.join(' and ')}; their name is kept there as typed text.` : '';
    if (!window.confirm(`Delete ${t.name} from the trainer list?${used} This can't be undone.`)) return;
    setBusy(true);
    try {
      await deleteTrainerEverywhere(t);
      setOpenId(null);
      flash('Trainer deleted');
    } catch (err) {
      setPanelError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  // The extra details on the Add / Edit form (shared with the trainer's own link page). Files go to trainer_files/<id>/.
  const teamExtras = {
    value: form,
    onChange: (p: any) => setForm(f => ({ ...f, ...(typeof p === 'function' ? p(f) : p) })),
    uploader: { prefix: `trainer_files/${editing === 'new' ? newId : editing}/`, byName: viewer.name, uploadedBy: viewer.id },
    idPrefix: 't',
    ic: isStaff ? {
      value: icValue,
      onChange: (v: string) => setIcInput(v),
      note: savedIc === null && editing !== 'new' ? 'Loading…' : 'Only Admin and Management can see this.',
    } : undefined,
    photoSlot: <div className="rounded-xl border border-line p-3"><PhotoPicker photos={form.photoUrl ? [form.photoUrl] : []} onChange={ph => set({ photoUrl: ph[0] || '' })} folder="trainers" me={viewer} single label="Professional photo (shown on teambuilding proposals)" /></div>,
    wrap: (title: string, children: React.ReactNode) => (
      <section className="space-y-3 border-t border-line pt-4">
        <h4 className="text-[15px] font-bold">{title}</h4>
        {children}
      </section>
    ),
  };

  return (
    <div className="space-y-5 font-sans text-ink">
      {toast && (
        <div role="status" className="fixed right-4 top-4 z-[60] rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white shadow-lg">{toast}</div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Trainers</h2>
          <p className="text-[15px] text-ink-soft">{trainers.length} trainer{trainers.length === 1 ? '' : 's'}, shared by the whole team</p>
        </div>
        <span className="flex flex-wrap gap-2">
          <button type="button" onClick={inviteNew} className={btnSecondary}>Invite a new trainer</button>
          {isStaff && <button type="button" onClick={() => setPortalInvite('')} className={btnSecondary}>Invite to trainer portal</button>}
          <button type="button" onClick={startNew} className={btnPrimary}><Plus className="h-4 w-4" /> Add trainer</button>
        </span>
      </div>

      {/* Trainers / Overview (2026-10-21): Admin and Management, plus people Management ticks.
          Training reports (2026-10-21): Admin and Management only. */}
      {canOverview && (
        <div className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-white p-1" role="tablist" aria-label="Trainers view">
          {([['list', 'Trainers'], ['overview', 'Overview'], ...(isStaff ? [['reports', 'Training reports'] as const] : [])] as const).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === k ? 'bg-accent-soft text-accent' : 'text-ink-soft hover:bg-surface'}`}>{l}</button>
          ))}
        </div>
      )}
      {isStaff && tab === 'reports' ? (
        <TrainingReportsList viewer={viewer} deals={deals} checklists={checklists} quotes={quotes} trainers={trainers} />
      ) : canOverview && tab === 'overview' ? (
        <TrainerOverview viewer={viewer} people={reps} trainers={trainers} deals={deals} checklists={checklists} programmes={programmes} clients={clients}
          onOpenTrainer={id => { setOpenId(id); setPanelError(''); }} />
      ) : (<>
      {waiting.length > 0 && (
        <section className="rounded-2xl border border-attention/40 bg-attention-soft/30 p-4">
          <h3 className="font-bold">Profiles waiting for review ({waiting.length})</h3>
          <ul className="mt-2 divide-y divide-line">
            {waiting.map(l => {
              const s = l.submission as ProfileSubmission;
              return (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[15px]">
                  <span><strong>{s?.name || 'Trainer'}</strong> <span className="text-ink-soft">· {l.trainerId ? 'update to their profile' : 'new trainer'}</span></span>
                  <button type="button" onClick={() => setReviewId(l.id)} className={btnSecondary}>Review</button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Bank accounts typed by trainers in the portal, to check (Admin and Management) */}
      <BankRequestsBox viewer={viewer} trainers={trainers} />

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, topic, language, phone or email" className={`${input} pl-9`} aria-label="Search trainers" />
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Type of training">
        {[{ id: '' as const, label: 'All trainers', n: trainers.length }, ...TRAINING_TYPES.map(t => ({ ...t, n: trainers.filter(x => (x.trainingTypes || []).includes(t.id)).length }))].map(t => (
          <button key={t.id || 'all'} type="button" aria-pressed={typeFilter === t.id} onClick={() => setTypeFilter(t.id)}
            className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${typeFilter === t.id ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-white text-ink hover:bg-surface'}`}>
            {t.label} <span className="font-normal text-ink-soft">{t.n}</span>
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-white">
        {!loaded ? (
          <p className="flex items-center gap-2 p-6 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading trainers…</p>
        ) : visible.length === 0 ? (
          <div className="p-8 text-center">
            <p className="font-semibold">{trainers.length === 0 ? 'No trainers yet' : search.trim() ? `No trainer matches "${search.trim()}"` : 'No trainers of this type yet'}</p>
            <p className="mt-1 text-[15px] text-ink-soft">{trainers.length === 0 ? 'Add your first trainer.' : 'Check the spelling, or add them as a new trainer.'}</p>
            {trainers.length > 0 && <button type="button" onClick={startNew} className={`${btnSecondary} mt-3`}><Plus className="h-4 w-4" /> Add "{search.trim()}"</button>}
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {visible.map(t => {
              const taught = teaches(t);
              const what = taught.length ? (taught.length > 2 ? `${taught.slice(0, 2).join(', ')} +${taught.length - 2} more` : taught.join(', ')) : t.specialization;
              const sub = [what, t.contact].map(x => (x || '').trim()).filter(Boolean).join(' · ');
              const next = nextTraining[t.id];
              return (
                <li key={t.id}>
                  <button type="button" onClick={() => { setOpenId(t.id); setPanelError(''); }} className="flex w-full items-center gap-4 px-5 py-3.5 text-left hover:bg-surface">
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-semibold">{t.name}</span>
                        {t.status === 'On Leave' && <span className="shrink-0 rounded-md bg-attention-soft px-2 py-0.5 text-xs font-semibold text-attention">On leave</span>}
                        {accounts[t.id]?.active && <span className="hidden shrink-0 rounded-md bg-surface px-2 py-0.5 text-xs font-semibold text-ink-soft sm:inline">Portal</span>}
                        {(t.trainingTypes || []).map(x => <span key={x} className="hidden shrink-0 rounded-md bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent sm:inline">{trainingTypeLabel(x)}</span>)}
                      </span>
                      <span className="block truncate text-sm text-ink-soft">{sub || 'No programmes or phone yet'}</span>
                    </span>
                    <span className="hidden w-28 shrink-0 text-right text-sm font-semibold tabular-nums sm:block">{t.rate ? `${formatRM(t.rate)}/day` : ''}</span>
                    <span className="w-32 shrink-0 text-right text-sm text-ink-soft">{next ? `Next ${formatDate(next)}` : 'No training booked'}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      </>)}

      {/* Trainer panel */}
      {openTrainer && !editing && (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" role="dialog" aria-modal="true" onClick={() => setOpenId(null)}>
          <PanelResizer />
          <div className="h-full w-full md:w-[var(--panel-w,max(50vw,40rem))] md:min-w-[24rem] md:max-w-[95vw] overflow-y-auto bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <TrainerPanel
              trainer={openTrainer}
              teaches={teaches(openTrainer)}
              bookings={bookingsOf(openTrainer)}
              clients={clients}
              today={today}
              canDelete={viewer.role === 'management'}
              isStaff={isStaff}
              busy={busy}
              error={panelError}
              onClose={() => setOpenId(null)}
              onEdit={() => startEdit(openTrainer)}
              onDelete={() => remove(openTrainer)}
            />
            <section className="mt-6 space-y-2 rounded-xl border border-line p-4">
              <h4 className="text-sm font-semibold text-ink-soft">Profile link</h4>
              <p className="text-sm text-ink-soft">Send {openTrainer.name} a private link to fill in or update their own profile. You review it before anything changes.</p>
              {liveProfileLink(openTrainer) ? (
                <LinkShareBox link={liveProfileLink(openTrainer)!} phone={openTrainer.contact}
                  message={`Hi ${openTrainer.name}, please fill in your trainer profile for NEXT Academy here:`}
                  onCancel={() => { const l = liveProfileLink(openTrainer); if (l && window.confirm('Cancel this link?')) closeTrainerLink(l, 'cancelled', viewer); }} />
              ) : (
                <button type="button" className={btnSecondary} onClick={() => sendProfileLink(openTrainer)}>Send profile link</button>
              )}
            </section>
            {/* Trainer portal (2026-10-21): access by email, for the trainers who need it */}
            <section className="mt-4 space-y-2 rounded-xl border border-line p-4">
              <h4 className="text-sm font-semibold text-ink-soft">Trainer portal</h4>
              <PortalAccessBox trainer={openTrainer} account={accounts[openTrainer.id]} viewer={viewer} onInvite={() => setPortalInvite(openTrainer.id)} />
            </section>
            <section className="mt-4 space-y-2 rounded-xl border border-line p-4">
              <h4 className="text-sm font-semibold text-ink-soft">Rating</h4>
              <TrainerRatings trainerId={openTrainer.id} dealLabel={dealLabel} />
            </section>
          </div>
        </div>
      )}

      {/* Invite to the trainer portal (2026-10-21): a link where the trainer sets up their own login */}
      {portalInvite !== null && (
        <PortalInviteDialog viewer={viewer} trainers={trainers} preselect={portalInvite} onClose={() => setPortalInvite(null)} />
      )}

      {/* A new link to share */}
      {shareLink && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" role="dialog" aria-modal="true" onClick={() => setShareLink(null)}>
          <div className="w-full max-w-lg space-y-3 rounded-2xl bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold">{shareLink.trainerId ? `Profile link for ${shareLink.trainerName}` : 'Invite a new trainer'}</h3>
            <p className="text-[15px] text-ink-soft">Send this link by WhatsApp. They fill in their profile without logging in; it appears here for review.</p>
            <LinkShareBox link={shareLink} phone={trainers.find(t => t.id === shareLink.trainerId)?.contact}
              message={shareLink.trainerName ? `Hi ${shareLink.trainerName}, please fill in your trainer profile for NEXT Academy here:` : 'Hi, please fill in your trainer profile for NEXT Academy here:'} />
            <div className="flex justify-end"><button type="button" className={btnPrimary} onClick={() => setShareLink(null)}>Done</button></div>
          </div>
        </div>
      )}

      {/* Review a submitted profile */}
      {reviewId && (() => {
        const l = links.find(x => x.id === reviewId);
        if (!l || !l.submission) return null;
        const s = l.submission as ProfileSubmission;
        const cur = l.trainerId ? trainers.find(t => t.id === l.trainerId) : null;
        const row = (label_: string, now: string, before?: string) => (
          <div className="grid gap-1 border-b border-line py-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <dt className="text-sm text-ink-soft">{label_}</dt>
            <dd className="whitespace-pre-line text-[15px]">{now || <span className="text-ink-soft">—</span>}
              {cur && (before || '') !== (now || '') && <span className="block text-xs text-ink-soft">Was: {before || '—'}</span>}</dd>
          </div>
        );
        return (
          <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" role="dialog" aria-modal="true" onClick={() => setReviewId(null)}>
            <PanelResizer />
            <div className="h-full w-full overflow-y-auto bg-white p-6 shadow-xl md:w-[var(--panel-w,max(50vw,40rem))] md:min-w-[24rem] md:max-w-[95vw]" onClick={e => e.stopPropagation()}>
              <div className="mb-3 flex items-start justify-between gap-4">
                <h3 className="text-lg font-bold">{cur ? `Profile update from ${cur.name}` : 'New trainer profile'}</h3>
                <button type="button" onClick={() => setReviewId(null)} className="rounded-md p-1 text-ink-soft hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
              </div>
              <dl>
                {row('Name', s.name, cur?.name)}
                {row('Phone', s.contact, cur?.contact)}
                {row('Email', s.email, cur?.email)}
                {row('Programmes', s.programmeIds.map(progName).filter(Boolean).join(', '), (cur?.programmeIds || []).map(progName).filter(Boolean).join(', '))}
                {row('Other topics', s.suggestedTopics, cur?.suggestedTopics)}
                {row('Years of experience', s.experienceYears ? String(s.experienceYears) : '', cur?.experienceYears ? String(cur.experienceYears) : '')}
                {row('Daily rate', s.rate ? formatRM(s.rate) : '', cur?.rate ? formatRM(cur.rate) : '')}
                {row('Bio', s.bio, cur?.bio)}
                {row('IC / Passport No.', s.icSent ? 'Sent (only Admin and Management can see it)' : '', cur?.icOnFile ? 'On file' : '')}
                {row('Nationality', s.nationality || '', cur?.nationality)}
                {row('Race', s.race || '', cur?.race)}
                {row('TTT number', s.tttNumber || '', cur?.tttNumber)}
                {BIO_LISTS.map(b => <React.Fragment key={b.key}>{row(b.title, bioText(s[b.key]), bioText(cur?.[b.key]))}</React.Fragment>)}
                {s.qualifications && s.qualifications !== (cur?.qualifications || '') && row('Qualifications (typed before)', s.qualifications, cur?.qualifications)}
                {row('Past clients', s.pastClients, cur?.pastClients)}
                {row('Gender', s.gender || '', cur?.gender)}
                {row('Address', s.address || '', cur?.address)}
                {row('Emergency contact', ecText(s.emergencyContact), ecText(cur?.emergencyContact))}
                {row('Languages', languagesText(s), cur ? languagesText(cur) : '')}
                {row('Type of training', (s.trainingTypes || []).map(trainingTypeLabel).join(', '), (cur?.trainingTypes || []).map(trainingTypeLabel).join(', '))}
                {row('LinkedIn', s.linkedin || '', cur?.linkedin)}
                {row('YouTube', s.youtube || '', cur?.youtube)}
                {row('Other social media', s.otherSocial || '', cur?.otherSocial)}
              </dl>
              <h4 className="mt-5 text-sm font-semibold text-ink-soft">Uploads</h4>
              <ul className="mt-1 divide-y divide-line text-[15px]">
                <li className="flex items-center justify-between gap-3 py-2">
                  <span className="text-sm text-ink-soft">Professional photo</span>
                  {s.photoUrl ? <a href={s.photoUrl} target="_blank" rel="noreferrer"><img src={s.photoUrl} alt="Photo they uploaded" className="h-14 w-14 rounded-lg object-cover" /></a>
                    : <span className="text-sm text-ink-soft">{cur?.photoUrl ? 'Not sent; their current photo is kept' : 'Not uploaded'}</span>}
                </li>
                {DOC_KINDS.map(k => (
                  <li key={k.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="text-sm text-ink-soft">{k.label}</span>
                    {s.docs?.[k.id] ? <a href={s.docs[k.id]!.url} target="_blank" rel="noreferrer" className="truncate font-semibold text-accent hover:underline">{s.docs[k.id]!.name}</a>
                      : <span className="text-sm text-ink-soft">{cur?.docs?.[k.id] ? 'Not sent; the current file is kept' : 'Not uploaded'}</span>}
                  </li>
                ))}
              </ul>
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button type="button" className={btnSecondary} onClick={() => discardProfile(l)}>Discard</button>
                <button type="button" className={btnPrimary} disabled={busy} onClick={() => acceptProfile(l)}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{cur ? 'Accept changes' : 'Add this trainer'}</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Add / edit form */}
      {editing && (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" role="dialog" aria-modal="true">
          <PanelResizer />
          <div className="h-full w-full md:w-[var(--panel-w,max(50vw,40rem))] md:min-w-[24rem] md:max-w-[95vw] overflow-y-auto bg-white p-6 shadow-xl">
            <div className="mb-5 flex items-start justify-between gap-4">
              <h3 className="text-lg font-bold">{editing === 'new' ? 'Add trainer' : 'Edit trainer'}</h3>
              <button type="button" onClick={() => setEditing(null)} className="rounded-md p-1 text-ink-soft hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={save} className="space-y-4">
              <DraftBar draft={formDraft} what={editing === 'new' ? 'new trainer' : 'change to this trainer'} />
              <div>
                <label className={label} htmlFor="t-name">Name</label>
                <input id="t-name" value={form.name} onChange={e => set({ name: e.target.value })} className={input} autoFocus />
              </div>
              <div>
                <span className={label}>Programmes they teach <span className="font-normal text-ink-soft">(from the Programme list)</span></span>
                {form.programmeIds.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {form.programmeIds.map(id => (
                      <span key={id} className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 text-sm font-semibold text-accent">
                        {progName(id)}
                        <button type="button" onClick={() => set({ programmeIds: form.programmeIds.filter(x => x !== id) })} aria-label={`Remove ${progName(id)}`}><X className="h-3.5 w-3.5" /></button>
                      </span>
                    ))}
                  </div>
                )}
                {progOptions.length === 0 ? (
                  <p className="text-sm text-ink-soft">The Programme list is empty. Programmes are added in Admin work → Programmes, or on a deal.</p>
                ) : (
                  <div className="rounded-lg border border-line">
                    <input value={progSearch} onChange={e => setProgSearch(e.target.value)} placeholder="Search programmes" aria-label="Search programmes" className="w-full rounded-t-lg border-b border-line px-3 py-2 text-[15px] focus:outline-none" />
                    <ul className="max-h-48 overflow-y-auto py-1">
                      {progOptions.filter(p => !progSearch.trim() || norm(p.name).includes(norm(progSearch))).map(p => (
                        <li key={p.id}>
                          <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[15px] hover:bg-surface">
                            <input type="checkbox" checked={form.programmeIds.includes(p.id)} className="h-4 w-4 accent-[#0E6E62]"
                              onChange={e => set({ programmeIds: e.target.checked ? [...form.programmeIds, p.id] : form.programmeIds.filter(x => x !== p.id) })} />
                            {p.name}
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {form.specialization.trim() && (
                  <div className="mt-2 rounded-lg bg-surface px-3 py-2 text-sm">
                    <span className="font-semibold">Topics typed before:</span> {form.specialization}
                    <span className="block text-ink-soft">Kept as a note. Tick the matching programmes above, then <button type="button" className="font-semibold text-accent hover:underline" onClick={() => set({ specialization: '' })}>remove this note</button>.</span>
                  </div>
                )}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={label} htmlFor="t-phone">Phone</label>
                  <input id="t-phone" type="tel" value={form.contact} onChange={e => set({ contact: e.target.value })} placeholder="e.g. 012-345 6789" className={input} />
                </div>
                <div>
                  <label className={label} htmlFor="t-email">Email</label>
                  <input id="t-email" type="email" value={form.email} onChange={e => set({ email: e.target.value })} className={input} />
                </div>
                <div>
                  <label className={label} htmlFor="t-rate">Daily rate (RM)</label>
                  <input id="t-rate" inputMode="decimal" value={form.rate} onChange={e => set({ rate: e.target.value })} placeholder="e.g. 2000" className={input} />
                </div>
                <label className="flex cursor-pointer items-center gap-2.5 self-end pb-2 text-[15px]">
                  <input type="checkbox" checked={form.onLeave} onChange={e => set({ onLeave: e.target.checked })} className="h-4 w-4 accent-[#0E6E62]" />
                  On leave (not taking trainings for now)
                </label>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={label} htmlFor="t-years">Years of experience</label>
                  <input id="t-years" inputMode="numeric" value={form.experienceYears} onChange={e => set({ experienceYears: e.target.value })} className={input} />
                </div>
              </div>
              <div>
                <span className={label}>Other topics they teach <span className="font-normal text-ink-soft">(not in the Programme list yet; one per box)</span></span>
                <TopicList value={form.suggestedTopics} onChange={t => set({ suggestedTopics: t })} idPrefix="t-topic" />
              </div>
              <TrainerExtrasFields {...teamExtras} only={['about', 'emergency', 'languages']} />
              <div>
                <label className={label} htmlFor="t-bio">Short bio</label>
                <textarea id="t-bio" value={form.bio} onChange={e => set({ bio: e.target.value })} rows={3} className={`${input} resize-y`} />
              </div>
              {(form.qualifications || form.otherCerts) && (
                <div className="rounded-lg bg-surface px-3 py-2 text-sm">
                  <span className="font-semibold">Qualifications typed before:</span> {[form.qualifications, form.otherCerts].filter(Boolean).join(' · ')}
                  <span className="block text-ink-soft">Kept as a note. Put them in the HRDC lists below, then <button type="button" className="font-semibold text-accent hover:underline" onClick={() => set({ qualifications: '', otherCerts: '' })}>remove this note</button>.</span>
                </div>
              )}
              <div>
                <label className={label} htmlFor="t-past">Past clients</label>
                <textarea id="t-past" value={form.pastClients} onChange={e => set({ pastClients: e.target.value })} rows={3} className={`${input} resize-y`} />
              </div>
              <TrainerExtrasFields {...teamExtras} only={['biodata', 'online', 'uploads']} />
              <div>
                <label className={label} htmlFor="t-notes">Notes <span className="font-normal text-ink-soft">(optional)</span></label>
                <textarea id="t-notes" value={form.notes} onChange={e => set({ notes: e.target.value })} rows={3} placeholder="Anything the team should know about this trainer" className={`${input} resize-y`} />
              </div>

              {formError && (
                <div role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">
                  {formError}
                  {dupId && <button type="button" onClick={() => { setEditing(null); setOpenId(dupId); }} className="ml-2 font-semibold underline">Open it</button>}
                </div>
              )}

              <div className="flex gap-2">
                <button type="submit" disabled={busy} className={btnPrimary}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{editing === 'new' ? 'Add trainer' : 'Save'}</button>
                <button type="button" onClick={() => setEditing(null)} className={btnSecondary}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function TrainerPanel(props: {
  trainer: Trainer; teaches: string[]; bookings: Booking[]; clients: any[]; today: string;
  canDelete: boolean; busy: boolean; error: string; onClose: () => void; onEdit: () => void; onDelete: () => void;
  isStaff: boolean;
}) {
  const { trainer: t, bookings, today } = props;
  // IC / passport number and the HRDC biodata PDF: Admin and Management only (Joel, 2026-10-20).
  const ic = useIc(t, props.isStaff);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const downloadBiodata = async () => {
    setPdfBusy(true); setPdfError('');
    try { await downloadBiodataPdf({ ...t, icNumber: ic || '' }); }
    catch (e: any) { setPdfError(pdfErrorText(e)); }
    finally { setPdfBusy(false); }
  };
  const hasBio = !!(t.nationality || t.race || t.tttNumber || t.icOnFile || BIO_LISTS.some(b => (t[b.key] || []).some(rowFilled)));
  const phone = (t.contact || '').trim();
  const wa = phone ? whatsappLink(phone) : '';
  const clientName = (d: any) => props.clients.find(c => c.id === d.clientId)?.companyName || d.client || 'No client';
  const upcoming = bookings.filter(b => !b.date || b.date >= today).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
  const past = bookings.filter(b => b.date && b.date < today).sort((a, b) => b.date.localeCompare(a.date));

  const row = (b: Booking) => (
    <li key={b.deal.id} className="flex items-center gap-3 px-4 py-2.5 text-[15px]">
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{clientName(b.deal)}</span>
        <span className="block truncate text-sm text-ink-soft">{b.deal.courseName || 'No programme yet'}</span>
      </span>
      <span className="shrink-0 text-right text-sm">
        <span className="block font-semibold">{b.date ? formatDate(b.date) : 'Date not set'}</span>
        <span className="block text-ink-soft">{b.confirmed ? 'Confirmed' : dealStage(b.deal) === 'won' ? 'Won, not confirmed yet' : `On the quotation · ${STAGE_LABELS[dealStage(b.deal)]}`}</span>
      </span>
    </li>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        {t.photoUrl && <img src={t.photoUrl} alt={t.name} className="h-16 w-16 shrink-0 rounded-xl object-cover" />}
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 text-lg font-bold"><GraduationCap className="h-5 w-5 shrink-0 text-accent" /> <span className="truncate">{t.name}</span></h3>
          <p className="mt-0.5 text-[15px] text-ink-soft">{t.status === 'On Leave' ? 'On leave' : 'Available'}</p>
        </div>
        <button type="button" onClick={props.onClose} className="rounded-md p-1 text-ink-soft hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
      </div>

      <section>
        <h4 className="text-sm font-semibold text-ink-soft">Programmes they teach</h4>
        {props.teaches.length ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5">{props.teaches.map(n => <span key={n} className="rounded-full bg-accent-soft px-2.5 py-1 text-sm font-semibold text-accent">{n}</span>)}</div>
        ) : <p className="mt-1 text-[15px] text-ink-soft">None ticked yet. Use Edit details.</p>}
        {(t.specialization || '').trim() && <p className="mt-1.5 text-sm text-ink-soft">Topics typed before: {t.specialization}</p>}
      </section>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={props.onEdit} className={btnSecondary}><Pencil className="h-4 w-4" /> Edit details</button>
        {props.isStaff && (
          <button type="button" onClick={downloadBiodata} disabled={pdfBusy} className={btnSecondary}>
            {pdfBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download HRDC biodata (PDF)
          </button>
        )}
      </div>
      {pdfError && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{pdfError}</p>}

      {hasBio && (
        <section className="rounded-xl border border-line p-4">
          <h4 className="text-sm font-semibold text-ink-soft">HRDC biodata</h4>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-[15px]">
            <div><dt className="text-sm text-ink-soft">IC / Passport No.</dt><dd className="font-semibold">{props.isStaff ? (ic === null ? '…' : ic || 'Not given') : t.icOnFile ? 'On file (Admin and Management can see it)' : 'Not given'}</dd></div>
            {t.tttNumber && <div><dt className="text-sm text-ink-soft">TTT number</dt><dd className="font-semibold">{t.tttNumber}</dd></div>}
            {t.nationality && <div><dt className="text-sm text-ink-soft">Nationality</dt><dd className="font-semibold">{t.nationality}</dd></div>}
            {t.race && <div><dt className="text-sm text-ink-soft">Race</dt><dd className="font-semibold">{t.race}</dd></div>}
            {BIO_LISTS.map(b => {
              const rows = (t[b.key] || []).filter(rowFilled);
              return rows.length ? (
                <div key={b.key} className="col-span-2"><dt className="text-sm text-ink-soft">{b.title}</dt>
                  <dd><ul className="mt-0.5 space-y-0.5">{rows.map((r, i) => <li key={i}>{b.cols.map(c => r[c.k]).filter(Boolean).join(' · ')}</li>)}</ul></dd></div>
              ) : null;
            })}
          </dl>
        </section>
      )}

      <section className="rounded-xl border border-line p-4">
        <h4 className="text-sm font-semibold text-ink-soft">Contact</h4>
        {phone || t.email ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {phone && <a href={`tel:${phone.replace(/\s/g, '')}`} className={btnSecondary}><Phone className="h-4 w-4" /> {phone}</a>}
            {wa && <a href={wa} target="_blank" rel="noreferrer" className={btnSecondary}><MessageCircle className="h-4 w-4" /> WhatsApp</a>}
            {t.email && <a href={`mailto:${t.email}`} className={btnSecondary}><Mail className="h-4 w-4" /> {t.email}</a>}
          </div>
        ) : (
          <p className="mt-1 text-[15px] text-ink-soft">No contact details yet. Click Edit details to add them.</p>
        )}
      </section>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[15px]">
        <div><dt className="text-sm text-ink-soft">Daily rate</dt><dd className="font-semibold">{t.rate ? formatRM(t.rate) : 'Not set'}</dd></div>
        <div><dt className="text-sm text-ink-soft">Status</dt><dd className="font-semibold">{t.status === 'On Leave' ? 'On leave' : 'Available'}</dd></div>
        {!!t.experienceYears && <div><dt className="text-sm text-ink-soft">Experience</dt><dd className="font-semibold">{t.experienceYears} year{t.experienceYears === 1 ? '' : 's'}</dd></div>}
        {!!(t.trainingTypes || []).length && <div><dt className="text-sm text-ink-soft">Type of training</dt><dd className="font-semibold">{(t.trainingTypes || []).map(trainingTypeLabel).join(', ')}</dd></div>}
        {languagesText(t) && <div><dt className="text-sm text-ink-soft">Languages</dt><dd className="font-semibold">{languagesText(t)}</dd></div>}
        {t.gender && <div><dt className="text-sm text-ink-soft">Gender</dt><dd className="font-semibold">{t.gender}</dd></div>}
        {topicList(t.suggestedTopics).length > 0 && (
          <div className="col-span-2"><dt className="text-sm text-ink-soft">Other topics (not in the Programme list yet)</dt>
            <dd className="mt-1 flex flex-wrap gap-1.5">{topicList(t.suggestedTopics).map(x => <span key={x} className="rounded-full bg-surface px-2.5 py-1 text-sm">{x}</span>)}</dd></div>
        )}
        {t.address && <div className="col-span-2"><dt className="text-sm text-ink-soft">Address</dt><dd className="whitespace-pre-line">{t.address}</dd></div>}
        {(t.emergencyContact?.name || t.emergencyContact?.phone) && (
          <div className="col-span-2"><dt className="text-sm text-ink-soft">Emergency contact</dt>
            <dd>{ecText(t.emergencyContact)}{t.emergencyContact?.phone && <a href={`tel:${t.emergencyContact.phone.replace(/\s/g, '')}`} className="ml-2 text-sm font-semibold text-accent hover:underline">Call</a>}</dd></div>
        )}
        {t.otherCerts && <div className="col-span-2"><dt className="text-sm text-ink-soft">Other certificates (typed before)</dt><dd className="whitespace-pre-line">{t.otherCerts}</dd></div>}
        {(t.linkedin || t.youtube || t.otherSocial) && (
          <div className="col-span-2"><dt className="text-sm text-ink-soft">Online</dt>
            <dd className="space-y-0.5">
              {t.linkedin && <a href={linkHref(t.linkedin)} target="_blank" rel="noreferrer" className="block truncate font-semibold text-accent hover:underline">LinkedIn: {t.linkedin}</a>}
              {t.youtube && <a href={linkHref(t.youtube)} target="_blank" rel="noreferrer" className="block truncate font-semibold text-accent hover:underline">YouTube: {t.youtube}</a>}
              {t.otherSocial && <span className="block whitespace-pre-line">{t.otherSocial}</span>}
            </dd></div>
        )}
        <div className="col-span-2"><dt className="text-sm text-ink-soft">Files</dt>
          <dd className="mt-1 divide-y divide-line rounded-xl border border-line">
            {DOC_KINDS.map(k => {
              const f = t.docs?.[k.id];
              return (
                <div key={k.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="text-sm">{k.label}</span>
                  {f ? <a href={f.url} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1.5 text-sm font-semibold text-accent hover:underline"><FileText className="h-4 w-4 shrink-0" /><span className="truncate">{f.name}</span></a>
                    : <span className="text-sm text-ink-soft">Not uploaded</span>}
                </div>
              );
            })}
          </dd></div>
        {t.bio && <div className="col-span-2"><dt className="text-sm text-ink-soft">Bio</dt><dd className="whitespace-pre-line">{t.bio}</dd></div>}
        {t.qualifications && <div className="col-span-2"><dt className="text-sm text-ink-soft">Qualifications (typed before)</dt><dd className="whitespace-pre-line">{t.qualifications}</dd></div>}
        {t.pastClients && <div className="col-span-2"><dt className="text-sm text-ink-soft">Past clients</dt><dd className="whitespace-pre-line">{t.pastClients}</dd></div>}
        {t.notes && <div className="col-span-2"><dt className="text-sm text-ink-soft">Notes</dt><dd className="whitespace-pre-line">{t.notes}</dd></div>}
      </dl>

      <section>
        <h4 className="text-[15px] font-bold">Upcoming trainings ({upcoming.length})</h4>
        <p className="text-sm text-ink-soft">Includes deals where they're only named on the quotation. The trainer portal shows only won deals with this trainer picked on the checklist's Trainer step.</p>
        {upcoming.length === 0
          ? <p className="mt-1 text-[15px] text-ink-soft">Nothing booked.</p>
          : <ul className="mt-2 divide-y divide-line rounded-xl border border-line">{upcoming.map(row)}</ul>}
        <p className="mt-1.5 text-sm text-ink-soft">From the deals: the confirmed trainer on the admin checklist, or the trainer on the quotation.</p>
      </section>

      {past.length > 0 && (
        <section>
          <h4 className="text-[15px] font-bold">Past trainings ({past.length})</h4>
          <ul className="mt-2 divide-y divide-line rounded-xl border border-line">{past.map(row)}</ul>
        </section>
      )}

      {props.canDelete && (
        <div className="border-t border-line pt-4">
          {props.error && <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{props.error}</p>}
          <button type="button" disabled={props.busy} onClick={props.onDelete} className="inline-flex items-center gap-1.5 text-sm font-semibold text-danger hover:underline"><Trash2 className="h-4 w-4" /> Delete trainer</button>
        </div>
      )}
    </div>
  );
}
