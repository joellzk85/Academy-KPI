import React, { useEffect, useMemo, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, query, setDoc } from 'firebase/firestore';
import { GraduationCap, Loader2, Mail, MessageCircle, Pencil, Phone, Plus, Search, Trash2, X } from 'lucide-react';
import { Representative, Trainer } from '../types';
import { db, friendlyError } from '../lib/firebase';
import { STAGE_LABELS, dealStage, formatDate, formatRM, todayIso } from '../lib/deals';
import { ChecklistTask } from '../lib/checklist';
import { Booking, trainerBookings } from '../lib/trainers';
import { linkedOnly } from '../lib/linked';

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

const emptyForm = () => ({ name: '', specialization: '', programmeIds: [] as string[], contact: '', email: '', rate: '', onLeave: false, notes: '' });
type Form = ReturnType<typeof emptyForm>;

const norm = (s?: string) => (s || '').trim().toLowerCase();

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

  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<'new' | string | null>(null);
  const [form, setForm] = useState<Form>(emptyForm());
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

  const bookingsOf = (t: Trainer) => trainerBookings(t, deals, checklists, quotes, trainers);
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
    const list = q ? trainers.filter(t => [t.name, t.specialization, t.contact, t.email, teaches(t).join(' ')].some(v => norm(v).includes(q))) : trainers;
    return [...list].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'en', { sensitivity: 'base' }));
  }, [trainers, search, programmes]);

  const openTrainer = trainers.find(t => t.id === openId) || null;

  // ---------- Add / edit ----------
  const startNew = () => { setForm({ ...emptyForm(), name: search.trim() }); setFormError(''); setDupId(null); setEditing('new'); };
  const startEdit = (t: Trainer) => {
    setForm({ name: t.name || '', specialization: t.specialization || '', programmeIds: (t.programmeIds || []).filter(id => programmes.some(p => p.id === id)), contact: t.contact || '', email: t.email || '', rate: t.rate ? String(t.rate) : '', onLeave: t.status === 'On Leave', notes: t.notes || '' });
    setProgSearch('');
    setFormError(''); setDupId(null); setEditing(t.id);
  };
  const set = (patch: Partial<Form>) => setForm(f => ({ ...f, ...patch }));

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
    };
    setBusy(true);
    try {
      if (editing === 'new') {
        const id = `trainer_${Date.now()}`;
        await setDoc(doc(db, 'trainers_directory', id), { id, ...details, createdAt: Date.now(), createdBy: viewer.id, createdByName: viewer.name });
        setOpenId(id);
        flash('Trainer added');
      } else if (editing) {
        await setDoc(doc(db, 'trainers_directory', editing), details, { merge: true });
        flash('Trainer saved');
      }
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
    if (inQuotes || inChecklists) {
      const parts = [inQuotes ? `${inQuotes} quotation${inQuotes === 1 ? '' : 's'}` : '', inChecklists ? `${inChecklists} admin checklist${inChecklists === 1 ? '' : 's'}` : ''].filter(Boolean);
      return setPanelError(`This trainer can't be deleted because ${parts.join(' and ')} use${inQuotes + inChecklists === 1 ? 's' : ''} them.`);
    }
    if (!window.confirm(`Delete ${t.name} from the trainer list? This can't be undone.`)) return;
    setBusy(true);
    try {
      await deleteDoc(doc(db, 'trainers_directory', t.id));
      setOpenId(null);
      flash('Trainer deleted');
    } catch (err) {
      setPanelError(friendlyError(err));
    } finally {
      setBusy(false);
    }
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
        <button type="button" onClick={startNew} className={btnPrimary}><Plus className="h-4 w-4" /> Add trainer</button>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, topic, phone or email" className={`${input} pl-9`} aria-label="Search trainers" />
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-white">
        {!loaded ? (
          <p className="flex items-center gap-2 p-6 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading trainers…</p>
        ) : visible.length === 0 ? (
          <div className="p-8 text-center">
            <p className="font-semibold">{trainers.length === 0 ? 'No trainers yet' : `No trainer matches "${search.trim()}"`}</p>
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

      {/* Trainer panel */}
      {openTrainer && !editing && (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" role="dialog" aria-modal="true" onClick={() => setOpenId(null)}>
          <div className="h-full w-full md:w-1/2 md:min-w-[40rem] overflow-y-auto bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <TrainerPanel
              trainer={openTrainer}
              teaches={teaches(openTrainer)}
              bookings={bookingsOf(openTrainer)}
              clients={clients}
              today={today}
              canDelete={viewer.role === 'management'}
              busy={busy}
              error={panelError}
              onClose={() => setOpenId(null)}
              onEdit={() => startEdit(openTrainer)}
              onDelete={() => remove(openTrainer)}
            />
          </div>
        </div>
      )}

      {/* Add / edit form */}
      {editing && (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" role="dialog" aria-modal="true">
          <div className="h-full w-full md:w-1/2 md:min-w-[40rem] overflow-y-auto bg-white p-6 shadow-xl">
            <div className="mb-5 flex items-start justify-between gap-4">
              <h3 className="text-lg font-bold">{editing === 'new' ? 'Add trainer' : 'Edit trainer'}</h3>
              <button type="button" onClick={() => setEditing(null)} className="rounded-md p-1 text-ink-soft hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={save} className="space-y-4">
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
}) {
  const { trainer: t, bookings, today } = props;
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
        <div className="min-w-0">
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

      <button type="button" onClick={props.onEdit} className={btnSecondary}><Pencil className="h-4 w-4" /> Edit details</button>

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
        {t.notes && <div className="col-span-2"><dt className="text-sm text-ink-soft">Notes</dt><dd className="whitespace-pre-line">{t.notes}</dd></div>}
      </dl>

      <section>
        <h4 className="text-[15px] font-bold">Upcoming trainings ({upcoming.length})</h4>
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
