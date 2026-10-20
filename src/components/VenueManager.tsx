import React, { useEffect, useMemo, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, query, setDoc } from 'firebase/firestore';
import { Building, Loader2, MapPin, MessageCircle, Pencil, Phone, Plus, Search, Trash2, X } from 'lucide-react';
import { Representative, Venue } from '../types';
import { db, friendlyError } from '../lib/firebase';
import { STAGE_LABELS, dealStage, formatDate, todayIso } from '../lib/deals';
import { VenueBooking, phoneIn, venueBookings } from '../lib/venues';
import { linkedOnly } from '../lib/linked';
import { deleteVenueEverywhere } from '../lib/detach';
import { venuePhotos } from '../lib/teambuilding';
import { useFormDraft } from '../lib/useFormDraft';
import DraftBar from './DraftBar';
import PhotoPicker from './PhotoPicker';

// Venues (redesigned 2026-10-17, like Clients and Trainers): one shared list, the same details as before.
// Status is only Available / Under renovation: bookings show by themselves from the deals (Joel removed "Booked").
// Anyone can add and edit; only Management can delete, and only a venue no quotation or checklist uses.

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };

interface VenueManagerProps {
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
const optional = <span className="font-normal text-ink-soft">(optional)</span>;

const emptyForm = () => ({
  name: '', distance: '', pictures: '', meetingPackagePrice: '', roomPackagePrice: '', dinnerPackage: '',
  facilities: '', contact: '', remarks: '', renovation: false, photos: [] as string[],
});
type Form = ReturnType<typeof emptyForm>;

const norm = (s?: string) => (s || '').trim().toLowerCase();
const isLink = (s?: string) => /^https?:\/\/\S+$/i.test((s || '').trim());

// Malaysian numbers: 012-345 6789 -> 60123456789 for WhatsApp.
function whatsappLink(phone: string): string {
  let d = phone.replace(/\D/g, '');
  if (d.startsWith('0')) d = '6' + d;
  return d.length >= 9 ? `https://wa.me/${d}` : '';
}

export default function VenueManager({ rep, reps, viewer }: VenueManagerProps) {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [deals, setDeals] = useState<any[]>([]);
  const [quotes, setQuotes] = useState<any[]>([]);
  // Every record, including old ones not linked yet (hidden on screen), so nothing they use can be deleted.
  const [allDeals, setAllDeals] = useState<any[]>([]);
  const [allQuotes, setAllQuotes] = useState<any[]>([]);
  const [checklists, setChecklists] = useState<Record<string, any>>({});
  const [clients, setClients] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<'new' | string | null>(null);
  const [form, setForm] = useState<Form>(emptyForm());
  // An unfinished new venue or edit is kept in this browser until it's saved (lib/useFormDraft.ts).
  const formDraft = useFormDraft(viewer.id, editing ? `venue:${editing}` : null, form, setForm);
  const [formError, setFormError] = useState('');
  const [dupId, setDupId] = useState<string | null>(null);
  const [panelError, setPanelError] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    const subs = [
      onSnapshot(query(collection(db, 'venues_directory')), s => { setVenues(s.docs.map(d => ({ ...(d.data() as Venue), id: d.id }))); setLoaded(true); }, () => setLoaded(true)),
      onSnapshot(query(collection(db, 'pipelines')), s => { const all = s.docs.map(d => ({ ...d.data(), id: d.id })); setAllDeals(all); setDeals(linkedOnly(all)); }),
      onSnapshot(query(collection(db, 'quotations')), s => { const all = s.docs.map(d => ({ ...d.data(), id: d.id })); setAllQuotes(all); setQuotes(linkedOnly(all)); }),
      onSnapshot(query(collection(db, 'deal_checklists')), s => setChecklists(Object.fromEntries(s.docs.map(d => [d.id, d.data()])))),
      onSnapshot(query(collection(db, 'clients')), s => setClients(s.docs.map(d => ({ ...d.data(), id: d.id })))),
    ];
    return () => subs.forEach(u => u());
  }, []);

  const flash = (t: string) => { setToast(t); window.setTimeout(() => setToast(x => (x === t ? '' : x)), 3500); };
  const today = todayIso();

  const bookingsOf = (v: Venue) => venueBookings(v, deals, checklists, quotes, venues);
  const nextTraining = useMemo(() => {
    const out: Record<string, string> = {};
    venues.forEach(v => {
      const next = bookingsOf(v).map(b => b.date).filter(d => d && d >= today).sort()[0];
      if (next) out[v.id] = next;
    });
    return out;
  }, [venues, deals, checklists, quotes]);

  const visible = useMemo(() => {
    const q = norm(search);
    const list = q ? venues.filter(v => [v.name, v.facilities, v.contact, v.distance, v.remarks].some(x => norm(x).includes(q))) : venues;
    return [...list].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'en', { sensitivity: 'base' }));
  }, [venues, search]);

  const openVenue = venues.find(v => v.id === openId) || null;

  // ---------- Add / edit ----------
  const startNew = () => { setForm({ ...emptyForm(), name: search.trim() }); setFormError(''); setDupId(null); setEditing('new'); };
  const startEdit = (v: Venue) => {
    setForm({
      name: v.name || '', distance: v.distance || '', pictures: v.pictures || '', meetingPackagePrice: v.meetingPackagePrice || '',
      roomPackagePrice: v.roomPackagePrice || '', dinnerPackage: v.dinnerPackage || '', facilities: v.facilities || '',
      contact: v.contact || '', remarks: v.remarks || '', renovation: v.status === 'Under Renovation', photos: v.photos || [],
    });
    setFormError(''); setDupId(null); setEditing(v.id);
  };
  const set = (patch: Partial<Form>) => setForm(f => ({ ...f, ...patch }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(''); setDupId(null);
    const name = form.name.trim();
    if (!name) return setFormError('Enter the venue name.');
    const dup = venues.find(v => v.id !== editing && norm(v.name) === norm(name));
    if (dup) { setDupId(dup.id); return setFormError(`"${dup.name}" is already in the venue list.`); }

    const details = {
      name, distance: form.distance.trim(), pictures: form.pictures.trim(),
      meetingPackagePrice: form.meetingPackagePrice.trim(), roomPackagePrice: form.roomPackagePrice.trim(), dinnerPackage: form.dinnerPackage.trim(),
      facilities: form.facilities.trim(), contact: form.contact.trim(), remarks: form.remarks.trim(),
      status: (form.renovation ? 'Under Renovation' : 'Available') as Venue['status'],
      photos: form.photos.filter(Boolean),
    };
    setBusy(true);
    try {
      if (editing === 'new') {
        const id = `venue_${Date.now()}`;
        await setDoc(doc(db, 'venues_directory', id), { id, ...details, createdAt: Date.now(), createdBy: viewer.id, createdByName: viewer.name });
        setOpenId(id);
        flash('Venue added');
      } else if (editing) {
        await setDoc(doc(db, 'venues_directory', editing), details, { merge: true });
        flash('Venue saved');
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
  const remove = async (v: Venue) => {
    setPanelError('');
    const inQuotes = allQuotes.filter(q => q.venueId === v.id).length;
    const inChecklists = Object.values(checklists).filter((c: any) => (c.tasks || []).some((x: any) => x.kind === 'venue' && x.venueId === v.id)).length;
    // Management can delete a venue in use (Joel, 2026-10-20): the name is kept on the quotations and checklists as typed text.
    const parts = [inQuotes ? `${inQuotes} quotation${inQuotes === 1 ? '' : 's'}` : '', inChecklists ? `${inChecklists} admin checklist${inChecklists === 1 ? '' : 's'}` : ''].filter(Boolean);
    const used = parts.length ? ` It is on ${parts.join(' and ')}; its name is kept there as typed text.` : '';
    if (!window.confirm(`Delete ${v.name} from the venue list?${used} This can't be undone.`)) return;
    setBusy(true);
    try {
      await deleteVenueEverywhere(v);
      setOpenId(null);
      flash('Venue deleted');
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
          <h2 className="text-xl font-bold">Venues</h2>
          <p className="text-[15px] text-ink-soft">{venues.length} venue{venues.length === 1 ? '' : 's'}, shared by the whole team</p>
        </div>
        <button type="button" onClick={startNew} className={btnPrimary}><Plus className="h-4 w-4" /> Add venue</button>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, facilities, contact or distance" className={`${input} pl-9`} aria-label="Search venues" />
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-white">
        {!loaded ? (
          <p className="flex items-center gap-2 p-6 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading venues…</p>
        ) : visible.length === 0 ? (
          <div className="p-8 text-center">
            <p className="font-semibold">{venues.length === 0 ? 'No venues yet' : `No venue matches "${search.trim()}"`}</p>
            <p className="mt-1 text-[15px] text-ink-soft">{venues.length === 0 ? 'Add your first venue.' : 'Check the spelling, or add it as a new venue.'}</p>
            {venues.length > 0 && <button type="button" onClick={startNew} className={`${btnSecondary} mt-3`}><Plus className="h-4 w-4" /> Add "{search.trim()}"</button>}
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {visible.map(v => {
              const sub = [v.distance, v.contact].map(x => (x || '').trim()).filter(Boolean).join(' · ');
              const next = nextTraining[v.id];
              return (
                <li key={v.id}>
                  <button type="button" onClick={() => { setOpenId(v.id); setPanelError(''); }} className="flex w-full items-center gap-4 px-5 py-3 text-left hover:bg-surface">
                    <Thumb src={venuePhotos(v)[0] || v.pictures} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-semibold">{v.name}</span>
                        {v.status === 'Under Renovation' && <span className="shrink-0 rounded-md bg-attention-soft px-2 py-0.5 text-xs font-semibold text-attention">Under renovation</span>}
                      </span>
                      <span className="block truncate text-sm text-ink-soft">{sub || 'No distance or contact yet'}</span>
                    </span>
                    <span className="hidden w-36 shrink-0 truncate text-right text-sm font-semibold sm:block">{v.meetingPackagePrice || ''}</span>
                    <span className="w-32 shrink-0 text-right text-sm text-ink-soft">{next ? `Next ${formatDate(next)}` : 'No training booked'}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Venue panel */}
      {openVenue && !editing && (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" role="dialog" aria-modal="true" onClick={() => setOpenId(null)}>
          <div className="h-full w-full md:w-1/2 md:min-w-[40rem] overflow-y-auto bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <VenuePanel
              venue={openVenue}
              bookings={bookingsOf(openVenue)}
              clients={clients}
              today={today}
              canDelete={viewer.role === 'management'}
              busy={busy}
              error={panelError}
              onClose={() => setOpenId(null)}
              onEdit={() => startEdit(openVenue)}
              onDelete={() => remove(openVenue)}
            />
          </div>
        </div>
      )}

      {/* Add / edit form */}
      {editing && (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" role="dialog" aria-modal="true">
          <div className="h-full w-full md:w-1/2 md:min-w-[40rem] overflow-y-auto bg-white p-6 shadow-xl">
            <div className="mb-5 flex items-start justify-between gap-4">
              <h3 className="text-lg font-bold">{editing === 'new' ? 'Add venue' : 'Edit venue'}</h3>
              <button type="button" onClick={() => setEditing(null)} className="rounded-md p-1 text-ink-soft hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={save} className="space-y-6">
              <DraftBar draft={formDraft} what={editing === 'new' ? 'new venue' : 'change to this venue'} />
              <fieldset className="space-y-4">
                <legend className="mb-3 text-[15px] font-bold">Venue</legend>
                <div>
                  <label className={label} htmlFor="v-name">Name</label>
                  <input id="v-name" value={form.name} onChange={e => set({ name: e.target.value })} placeholder="e.g. Happi Village, Janda Baik" className={input} autoFocus />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className={label} htmlFor="v-dist">Distance {optional}</label>
                    <input id="v-dist" value={form.distance} onChange={e => set({ distance: e.target.value })} placeholder="e.g. 45 km from office" className={input} />
                  </div>
                  <label className="flex cursor-pointer items-center gap-2.5 self-end pb-2 text-[15px]">
                    <input type="checkbox" checked={form.renovation} onChange={e => set({ renovation: e.target.checked })} className="h-4 w-4 accent-[#0E6E62]" />
                    Under renovation (can't be used for now)
                  </label>
                </div>
                <PhotoPicker photos={form.photos} onChange={photos => set({ photos })} folder="venues" me={viewer} max={8} label="Photos (shown on teambuilding proposals; the first is the main one)" />
                <div>
                  <label className={label} htmlFor="v-pic">Picture link {optional}</label>
                  <input id="v-pic" value={form.pictures} onChange={e => set({ pictures: e.target.value })} placeholder="https://…" className={input} />
                </div>
              </fieldset>

              <fieldset className="space-y-4">
                <legend className="mb-3 text-[15px] font-bold">Packages and prices</legend>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <label className={label} htmlFor="v-meet">Meeting package</label>
                    <input id="v-meet" value={form.meetingPackagePrice} onChange={e => set({ meetingPackagePrice: e.target.value })} placeholder="e.g. RM 150/pax/day" className={input} />
                  </div>
                  <div>
                    <label className={label} htmlFor="v-room">Room package</label>
                    <input id="v-room" value={form.roomPackagePrice} onChange={e => set({ roomPackagePrice: e.target.value })} placeholder="e.g. RM 280/pax" className={input} />
                  </div>
                  <div>
                    <label className={label} htmlFor="v-dinner">Dinner package</label>
                    <input id="v-dinner" value={form.dinnerPackage} onChange={e => set({ dinnerPackage: e.target.value })} placeholder="e.g. RM 120/pax (BBQ)" className={input} />
                  </div>
                </div>
              </fieldset>

              <div>
                <label className={label} htmlFor="v-fac">Facilities {optional}</label>
                <input id="v-fac" value={form.facilities} onChange={e => set({ facilities: e.target.value })} placeholder="e.g. WiFi, projector, sound system" className={input} />
              </div>
              <div>
                <label className={label} htmlFor="v-contact">Contact person {optional}</label>
                <input id="v-contact" value={form.contact} onChange={e => set({ contact: e.target.value })} placeholder="e.g. Ms Wong, 019-222 3344" className={input} />
              </div>
              <div>
                <label className={label} htmlFor="v-rem">Remarks {optional}</label>
                <textarea id="v-rem" value={form.remarks} onChange={e => set({ remarks: e.target.value })} rows={3} placeholder="Anything the team should know about this venue" className={`${input} resize-y`} />
              </div>

              {formError && (
                <div role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">
                  {formError}
                  {dupId && <button type="button" onClick={() => { setEditing(null); setOpenId(dupId); }} className="ml-2 font-semibold underline">Open it</button>}
                </div>
              )}

              <div className="flex gap-2">
                <button type="submit" disabled={busy} className={btnPrimary}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{editing === 'new' ? 'Add venue' : 'Save'}</button>
                <button type="button" onClick={() => setEditing(null)} className={btnSecondary}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// Small photo in the list, or a plain icon when there's no picture (or it doesn't load).
function Thumb({ src }: { src?: string }) {
  const [failed, setFailed] = useState(false);
  if (!isLink(src) || failed) {
    return <span className="flex h-11 w-14 shrink-0 items-center justify-center rounded-lg bg-surface text-ink-soft"><Building className="h-5 w-5" /></span>;
  }
  return <img src={src} alt="" onError={() => setFailed(true)} className="h-11 w-14 shrink-0 rounded-lg object-cover" />;
}

function VenuePanel(props: {
  venue: Venue; bookings: VenueBooking[]; clients: any[]; today: string;
  canDelete: boolean; busy: boolean; error: string; onClose: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const { venue: v, bookings, today } = props;
  const [picFailed, setPicFailed] = useState(false);
  const phone = phoneIn(v.contact);
  const wa = phone ? whatsappLink(phone) : '';
  const clientName = (d: any) => props.clients.find(c => c.id === d.clientId)?.companyName || d.client || 'No client';
  const upcoming = bookings.filter(b => !b.date || b.date >= today).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
  const past = bookings.filter(b => b.date && b.date < today).sort((a, b) => b.date.localeCompare(a.date));
  const packages = [['Meeting package', v.meetingPackagePrice], ['Room package', v.roomPackagePrice], ['Dinner package', v.dinnerPackage]].filter(([, x]) => (x || '').trim());

  const row = (b: VenueBooking) => (
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
          <h3 className="flex items-center gap-2 text-lg font-bold"><Building className="h-5 w-5 shrink-0 text-accent" /> <span className="truncate">{v.name}</span></h3>
          <p className="mt-0.5 text-[15px] text-ink-soft">{[v.distance, v.status === 'Under Renovation' ? 'Under renovation' : 'Available'].filter(Boolean).join(' · ')}</p>
        </div>
        <button type="button" onClick={props.onClose} className="rounded-md p-1 text-ink-soft hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
      </div>

      {venuePhotos(v)[0] && !picFailed && (
        <img src={venuePhotos(v)[0]} alt={v.name} onError={() => setPicFailed(true)} className="max-h-64 w-full rounded-xl object-cover" />
      )}
      {(v.photos || []).length > 1 && (
        <div className="-mt-3 flex gap-2 overflow-x-auto">{(v.photos || []).slice(1).map(src => <img key={src} src={src} alt="" className="h-16 w-24 shrink-0 rounded-lg object-cover" />)}</div>
      )}

      <button type="button" onClick={props.onEdit} className={btnSecondary}><Pencil className="h-4 w-4" /> Edit details</button>

      <section className="rounded-xl border border-line p-4">
        <h4 className="text-sm font-semibold text-ink-soft">Contact person</h4>
        {v.contact ? (
          <>
            <p className="mt-1 font-semibold">{v.contact}</p>
            {phone && (
              <div className="mt-3 flex flex-wrap gap-2">
                <a href={`tel:${phone.replace(/\s/g, '')}`} className={btnSecondary}><Phone className="h-4 w-4" /> Call</a>
                {wa && <a href={wa} target="_blank" rel="noreferrer" className={btnSecondary}><MessageCircle className="h-4 w-4" /> WhatsApp</a>}
              </div>
            )}
          </>
        ) : (
          <p className="mt-1 text-[15px] text-ink-soft">No contact yet. Click Edit details to add one.</p>
        )}
      </section>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[15px] sm:grid-cols-3">
        {packages.length === 0
          ? <div className="col-span-full"><dt className="text-sm text-ink-soft">Packages</dt><dd className="text-ink-soft">No prices yet</dd></div>
          : packages.map(([k, x]) => <div key={k}><dt className="text-sm text-ink-soft">{k}</dt><dd className="font-semibold">{x}</dd></div>)}
        {v.facilities && <div className="col-span-full"><dt className="text-sm text-ink-soft">Facilities</dt><dd>{v.facilities}</dd></div>}
        {v.remarks && <div className="col-span-full"><dt className="text-sm text-ink-soft">Remarks</dt><dd className="whitespace-pre-line">{v.remarks}</dd></div>}
        {v.pictures && !isLink(v.pictures) && <div className="col-span-full"><dt className="text-sm text-ink-soft">Pictures</dt><dd className="flex items-start gap-1.5"><MapPin className="mt-1 h-4 w-4 shrink-0 text-ink-soft" />{v.pictures}</dd></div>}
      </dl>

      <section>
        <h4 className="text-[15px] font-bold">Upcoming trainings here ({upcoming.length})</h4>
        {upcoming.length === 0
          ? <p className="mt-1 text-[15px] text-ink-soft">Nothing booked.</p>
          : <ul className="mt-2 divide-y divide-line rounded-xl border border-line">{upcoming.map(row)}</ul>}
        <p className="mt-1.5 text-sm text-ink-soft">From the deals: the venue on the admin checklist, or the venue on the quotation.</p>
      </section>

      {past.length > 0 && (
        <section>
          <h4 className="text-[15px] font-bold">Past trainings here ({past.length})</h4>
          <ul className="mt-2 divide-y divide-line rounded-xl border border-line">{past.map(row)}</ul>
        </section>
      )}

      {props.canDelete && (
        <div className="border-t border-line pt-4">
          {props.error && <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{props.error}</p>}
          <button type="button" disabled={props.busy} onClick={props.onDelete} className="inline-flex items-center gap-1.5 text-sm font-semibold text-danger hover:underline"><Trash2 className="h-4 w-4" /> Delete venue</button>
        </div>
      )}
    </div>
  );
}
