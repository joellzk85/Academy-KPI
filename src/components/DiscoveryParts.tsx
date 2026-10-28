import React, { useEffect, useState } from 'react';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { ArrowRight, Compass, Loader2, Plus, Undo2, X, XCircle } from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import { Representative } from '../types';
import { dealOwnerId, formatDate, lostNoteProblem, todayIso } from '../lib/deals';
import { DISCOVERY_CLOSE_REASONS, discoveryClosed, discoveryDate, isFirstTouch } from '../lib/discovery';
import { apptOf } from '../lib/appointments';
import { clientContacts, dealContact, mainContactFields, newContactId } from '../lib/contacts';
import { followUpNotes } from '../lib/followUps';
import { useFormDraft } from '../lib/useFormDraft';
import DraftBar from './DraftBar';
import PickOrType from './PickOrType';
import PanelResizer from './PanelResizer';
import DealAppointmentBox from './DealAppointmentBox';
import { FollowUpForm, FollowUpList, followUpCountText } from './FollowUps';
import { ProgrammePicker } from './Programmes';
import { ClientPicker, Detail, Fold } from './DealsBoard';

// Discovery (Joel, 2026-10-28; lib/discovery.ts): the "Discovery" button on Deals and the discovery's panel.
// A discovery is made with the client (new clients can be added, like a new deal) and who we meet; the meeting is
// then booked or logged in the same box as a deal's appointment. It becomes a deal when the client asks for something.

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const label = 'mb-1.5 block text-sm font-semibold text-ink';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';
const smallLink = 'inline-flex items-center gap-1 text-sm font-semibold hover:underline';

const entry = (viewer: Viewer, action: string) => ({ at: new Date().toISOString(), byId: viewer.id, byName: viewer.name, action });

// ---------- New discovery / edit ----------
export function DiscoveryForm({ existing, clients, programmes, outlines, people, ownerId, viewer, onSaved, onCancel }: {
  existing: any | null; clients: any[]; programmes: any[]; outlines: any[]; people: Representative[]; ownerId: string; viewer: Viewer;
  onSaved: (id: string, msg: string) => void; onCancel: () => void;
}) {
  const [form, setForm] = useState(() => ({
    clientId: existing?.clientId && clients.some(c => c.id === existing.clientId) ? existing.clientId : '',
    contactId: existing?.contactId || '',
    contactName: existing?.contactId ? '' : existing?.contactName || '',
    contactPhone: '',
    saveContact: true,
    programmeId: existing?.programmeId || '',
    type: existing?.type || 'Training',
    enquiryNote: existing?.enquiryNote || '',
    ownerId: existing ? dealOwnerId(existing) : ownerId,
    notes: existing?.notes || '',
  }));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  // Kept in this browser until it's saved (lib/useFormDraft.ts).
  const draft = useFormDraft(viewer.id, existing ? `discovery:${existing.id}` : `discovery:new:${ownerId}`, form, setForm);
  const client = clients.find(c => c.id === form.clientId);
  const contacts = clientContacts(client);
  // A client just added arrives a moment after it's picked: then fill in its contact person.
  const firstContact = contacts[0]?.id || '';
  useEffect(() => {
    if (firstContact && !form.contactId && !form.contactName) setForm(f => ({ ...f, contactId: firstContact }));
  }, [form.clientId, firstContact]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (!client) return setErr('Choose the client from the client list, or add them as a new client.');
    const owner = people.find(r => r.id === form.ownerId) || people.find(r => r.id === ownerId);
    if (!owner) return setErr('Choose who owns this discovery.');
    if (viewer.role === 'rep' && owner.id !== viewer.id && !existing) return setErr('You can only make discoveries for yourself.');
    setBusy(true);
    try {
      // Who we meet: one of the client's contact persons, or typed (and, if ticked, added to the client's list).
      let contactId = contacts.some(x => x.id === form.contactId) ? form.contactId : '';
      let contactName = '';
      const typed = form.contactName.trim();
      if (!contactId && typed) {
        const same = contacts.find(x => x.name.trim().toLowerCase() === typed.toLowerCase());
        if (same) contactId = same.id;
        else if (form.saveContact) {
          const added = { id: newContactId(), name: typed, designation: '', phone: form.contactPhone.trim(), email: '' };
          const next = [...contacts, added];
          await setDoc(doc(db, 'clients', client.id), { contacts: next, ...mainContactFields(next) }, { merge: true });
          contactId = added.id;
        } else contactName = typed;
      }
      const prog = programmes.find(x => x.id === form.programmeId);
      const id = existing ? existing.id : `pipe_${Date.now()}`;
      const data: any = {
        id, clientId: client.id, client: client.companyName, contactId, contactName,
        programmeId: prog ? prog.id : '', courseName: prog ? prog.name : '', type: form.type,
        enquiryNote: form.enquiryNote.trim(), ownerId: owner.id, ownerName: owner.name, notes: form.notes.trim(),
      };
      if (existing) {
        data.history = [...(existing.history || []), entry(viewer, dealOwnerId(existing) !== owner.id ? `Owner changed to ${owner.name}` : 'Discovery details updated')];
      } else {
        Object.assign(data, {
          stage: 'discovery', status: 'Pending', discoveryDate: todayIso(), proposalSentDate: 'not yet', followUpDate: 'TBD',
          creatorId: viewer.id, creatorName: viewer.name, completedTags: [], taggedRepIds: [], appointmentTicked: false, createdAt: Date.now(),
          history: [entry(viewer, 'Discovery made')],
        });
      }
      await setDoc(doc(db, 'pipelines', id), data, { merge: true });
      draft.clear();
      onSaved(id, existing ? 'Discovery saved' : 'Discovery made. Book or log the meeting next.');
    } catch (e2) {
      setErr(friendlyError(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" role="dialog" aria-modal="true">
      <PanelResizer />
      <div className="h-full w-full md:w-[var(--panel-w,max(50vw,40rem))] md:min-w-[24rem] md:max-w-[95vw] overflow-y-auto bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold">{existing ? 'Edit discovery' : 'New discovery'}</h3>
            {!existing && <p className="mt-0.5 text-[15px] text-ink-soft">We meet the client and propose something. If the client has asked us for something, make a deal instead.</p>}
          </div>
          <button type="button" onClick={onCancel} className="rounded-md p-1 text-ink-soft hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <form onSubmit={save} className="space-y-4">
          <DraftBar draft={draft} what={existing ? 'change to this discovery' : 'new discovery'} />
          <div>
            <span className={label}>Client</span>
            <ClientPicker clients={clients} value={form.clientId} legacyName={existing?.client || ''} viewer={viewer}
              onChange={id => setForm(f => ({ ...f, clientId: id, contactId: clientContacts(clients.find(c => c.id === id))[0]?.id || '', contactName: '', contactPhone: '' }))} />
          </div>
          {client && (() => {
            const typedNew = !form.contactId && form.contactName.trim() !== '' && !contacts.some(x => x.name.trim().toLowerCase() === form.contactName.trim().toLowerCase());
            return (
              <div>
                <label htmlFor="ds-who" className={label}>Who we meet <span className="font-normal text-ink-soft">(the person at the client)</span></label>
                <PickOrType id="ds-who" options={contacts.map(x => ({ id: x.id, name: x.name, hint: x.designation || undefined }))}
                  linkedId={form.contactId} text={form.contactName}
                  onChange={v => setForm(f => ({ ...f, contactId: v.id, contactName: v.id ? '' : v.text }))}
                  placeholder={contacts.length ? 'Pick from the list or type a name' : 'Type the name'} className={input} />
                {typedNew && (
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <input value={form.contactPhone} onChange={e => setForm(f => ({ ...f, contactPhone: e.target.value }))} placeholder="Their phone (optional)" aria-label="Their phone" className={input} />
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={form.saveContact} onChange={e => setForm(f => ({ ...f, saveContact: e.target.checked }))} className="h-4 w-4 accent-[#0E6E62]" />
                      Add to {client.companyName}'s contact persons
                    </label>
                  </div>
                )}
              </div>
            );
          })()}
          <div>
            <span className={label}>What we'll propose <span className="font-normal text-ink-soft">(optional)</span></span>
            <ProgrammePicker programmes={programmes} value={form.programmeId} viewer={viewer} outlines={outlines}
              startType={form.type === 'Teambuilding' ? 'teambuilding' : undefined}
              onChange={(pg, t) => setForm(f => ({ ...f, programmeId: pg.id, type: t === 'teambuilding' ? 'Teambuilding' : 'Training' }))} />
            {!form.programmeId && (
              <input value={form.enquiryNote} onChange={e => setForm(f => ({ ...f, enquiryNote: e.target.value }))} className={`${input} mt-2`} maxLength={200}
                placeholder="Or a short note, e.g. our leadership and teambuilding range" aria-label="What we'll propose (short note)" />
            )}
          </div>
          {viewer.role !== 'rep' && (
            <div>
              <label htmlFor="ds-owner" className={label}>Owner</label>
              <select id="ds-owner" value={form.ownerId} onChange={e => setForm(f => ({ ...f, ownerId: e.target.value }))} className={input}>
                {people.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <p className="mt-1.5 text-sm text-ink-soft">The owner gets the Discovery meetings and Appointments KPI credit.</p>
            </div>
          )}
          <div>
            <label htmlFor="ds-notes" className={label}>Notes</label>
            <textarea id="ds-notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className={`${input} min-h-[80px]`} />
          </div>
          {err && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className={btnSecondary} onClick={onCancel}>Cancel</button>
            <button type="submit" disabled={busy} className={btnPrimary}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{existing ? 'Save discovery' : 'Make discovery'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------- The discovery's panel ----------
type Box = null | 'convert' | 'close' | 'followup';

export function DiscoveryPanel({ deal: p, allDeals, client, clientName, clientBadge, ownerName, programmes, outlines, editable, canManage, viewer, onClose, onEdit, onConverted, onDone, onDelete }: {
  deal: any; allDeals: any[]; client: any; clientName: string; clientBadge?: React.ReactNode; ownerName: string; programmes: any[]; outlines: any[];
  editable: boolean; canManage: boolean; viewer: Viewer;
  onClose: () => void; onEdit: () => void; onConverted: (msg: string) => void; onDone: (msg: string) => void; onDelete: (reason: string) => Promise<boolean>;
}) {
  const [box, setBox] = useState<Box>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [asked, setAsked] = useState({ programmeId: p.programmeId || '', type: p.type || 'Training', note: '', date: todayIso() });
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  useEffect(() => { setBox(null); setErr(''); setDeleting(false); }, [p.id]);

  const closed = discoveryClosed(p);
  const first = isFirstTouch(p, allDeals);
  const ap = apptOf(p);
  const nNotes = followUpNotes(p).length;
  const proposed = programmes.find(x => x.id === p.programmeId)?.name || p.courseName || p.enquiryNote || '';
  const pic = client ? dealContact(p, client) : null;

  const write = async (changes: any, action: string, done: (msg: string) => void) => {
    setBusy(true);
    setErr('');
    try {
      await updateDoc(doc(db, 'pipelines', p.id), { ...changes, history: [...(p.history || []), entry(viewer, action)] });
      setBox(null);
      done(action);
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  // The client asked for something: the same record becomes a New deal (New, met if the meeting was logged).
  const convert = () => {
    const prog = programmes.find(x => x.id === asked.programmeId);
    if (!prog && !asked.note.trim()) return setErr('Say what the client asked for: pick the programme, or type a short note.');
    if (!asked.date || asked.date > todayIso()) return setErr("Enter the day the client asked (today or earlier).");
    if (discoveryDate(p) && asked.date < discoveryDate(p)) return setErr(`The client asked after the discovery was made (${formatDate(discoveryDate(p))}).`);
    const stage = ap?.status === 'held' ? 'appointment' : 'lead';
    const what = prog ? prog.name : asked.note.trim();
    return write({
      stage, status: 'Pending', requestDate: asked.date,
      ...(prog ? { programmeId: prog.id, courseName: prog.name, type: asked.type, enquiryNote: '' } : { programmeId: '', courseName: '', enquiryNote: asked.note.trim().slice(0, 200) }),
      convertedDate: todayIso(), convertedAtMs: Date.now(), convertedById: viewer.id, convertedByName: viewer.name,
    }, `Converted to a deal: the client asked for ${what.slice(0, 120)}`, onConverted);
  };

  const close = () => {
    if (!reason) return setErr('Choose why it is being closed.');
    const problem = lostNoteProblem(note);
    if (problem) return setErr(problem);
    return write({
      discoveryClosed: { date: todayIso(), reason, note: note.trim().slice(0, 500), byId: viewer.id, byName: viewer.name, at: new Date().toISOString() },
    }, `Discovery closed, no interest: ${reason}. ${note.trim().slice(0, 120)}`, onDone);
  };

  const reopen = () => write({ discoveryClosed: null }, 'Discovery reopened', onDone);

  return (
    <div className="space-y-5 text-ink">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-bold">{clientName}</h3>
          <p className="flex flex-wrap items-center gap-2 text-[15px] text-ink-soft">
            <span className="inline-flex items-center gap-1"><Compass className="h-4 w-4" /> Discovery, made {formatDate(discoveryDate(p)) || 'earlier'}</span>
            {first && <span className="rounded-md bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">First touch point</span>}
          </p>
          {clientBadge && <p className="mt-0.5">{clientBadge}</p>}
        </div>
        <button type="button" onClick={onClose} className="rounded-md p-1 text-ink-soft hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
      </div>

      {/* Next step */}
      <section aria-label="Next step" className={`rounded-2xl border p-4 ${closed ? 'border-line bg-surface' : 'border-accent/30 bg-accent-soft/40'}`}>
        {closed ? (
          <>
            <p className="font-bold">Closed on {formatDate(closed.date)}: no interest ({closed.reason})</p>
            <p className="mt-0.5 text-sm text-ink-soft">{[closed.note, closed.byName ? `Closed by ${closed.byName}` : ''].filter(Boolean).join(' · ')}</p>
            <p className="mt-0.5 text-sm text-ink-soft">A closed discovery isn't a lost deal and doesn't count against anyone's closing ratio.</p>
            {editable && <button type="button" disabled={busy} className={`${smallLink} mt-2 text-accent`} onClick={reopen}><Undo2 className="h-3.5 w-3.5" /> Reopen discovery</button>}
          </>
        ) : (
          <>
            <p className="font-bold">{ap ? 'Next step: has the client asked us for something?' : 'Next step: book or log the discovery meeting'}</p>
            <p className="mt-0.5 text-sm text-ink-soft">
              {ap ? 'When the client asks for a training, a proposal or a quotation, convert this to a deal. Until then keep following up, or close it if there is no interest.'
                : 'Use the Meeting box below: book it, or log it if it has happened. It counts as an appointment.'}
            </p>
            {editable ? (
              <div className="mt-3 space-y-3">
                {!box && (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={busy} className={btnPrimary} onClick={() => { setBox('convert'); setErr(''); }}><ArrowRight className="h-4 w-4" /> Client asked: convert to deal</button>
                    <button type="button" disabled={busy} className={btnSecondary} onClick={() => { setBox('followup'); setErr(''); }}><Plus className="h-4 w-4" /> Log follow-up</button>
                    <button type="button" disabled={busy} className={btnSecondary} onClick={() => { setBox('close'); setErr(''); }}><XCircle className="h-4 w-4 text-ink-soft" /> No interest: close</button>
                  </div>
                )}
                {box === 'followup' && (
                  <FollowUpForm deal={p} viewer={viewer} alert={null} lostLabel="Close the discovery"
                    onDone={msg => { setBox(null); onDone(msg); }} onCancel={() => setBox(null)} onMarkLost={() => setBox('close')} />
                )}
                {box === 'convert' && (
                  <div className="space-y-3 rounded-xl border border-line bg-white p-4">
                    <p className="font-semibold">What did the client ask for?</p>
                    <ProgrammePicker programmes={programmes} value={asked.programmeId} viewer={viewer} outlines={outlines}
                      startType={asked.type === 'Teambuilding' ? 'teambuilding' : undefined}
                      onChange={(pg, t) => setAsked(a => ({ ...a, programmeId: pg.id, type: t === 'teambuilding' ? 'Teambuilding' : 'Training' }))} />
                    {!asked.programmeId && (
                      <input value={asked.note} onChange={e => setAsked(a => ({ ...a, note: e.target.value }))} className={input} maxLength={200}
                        placeholder="Not in the list yet? Type a short note" aria-label="What the client asked for (short note)" />
                    )}
                    <div className="sm:w-60">
                      <label htmlFor="ds-asked" className={label}>Client asked on</label>
                      <input id="ds-asked" type="date" value={asked.date} max={todayIso()} onChange={e => setAsked(a => ({ ...a, date: e.target.value }))} className={input} />
                    </div>
                    <p className="text-sm text-ink-soft">It becomes a New deal with everything on it (meeting, follow-ups, history). The discovery date is kept.</p>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={btnSecondary} onClick={() => setBox(null)}>Cancel</button>
                      <button type="button" disabled={busy} className={btnPrimary} onClick={convert}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Convert to deal</button>
                    </div>
                  </div>
                )}
                {box === 'close' && (
                  <div className="space-y-3 rounded-xl border border-line bg-white p-4">
                    <span className="block text-sm font-semibold">Why close it?</span>
                    <div className="flex flex-wrap gap-2">
                      {DISCOVERY_CLOSE_REASONS.map(r => (
                        <button key={r} type="button" onClick={() => setReason(r)} aria-pressed={reason === r}
                          className={`rounded-full border px-3 py-1 text-sm font-medium ${reason === r ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-soft hover:bg-surface'}`}>{r}</button>
                      ))}
                    </div>
                    <label htmlFor="ds-close" className="block text-sm font-semibold">What happened? <span className="font-normal text-ink-soft">(required, a few words)</span></label>
                    <textarea id="ds-close" value={note} onChange={e => setNote(e.target.value)} className={`${input} min-h-[64px]`} maxLength={500}
                      placeholder="e.g. HR says no training budget until next year" />
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={btnSecondary} onClick={() => setBox(null)}>Cancel</button>
                      <button type="button" disabled={busy} className={btnPrimary} onClick={close}>Close discovery</button>
                    </div>
                  </div>
                )}
                {err && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{err}</p>}
              </div>
            ) : (
              <p className="mt-2 text-sm text-ink-soft">Only {ownerName}, Admin and Management can change this discovery.</p>
            )}
          </>
        )}
      </section>

      <div className="divide-y divide-line rounded-2xl border border-line">
        <Fold title="Meeting" hint={ap ? (ap.status === 'booked' ? `Booked ${formatDate(ap.date)}` : `Held ${formatDate(ap.date)}`) : 'Not booked yet'} defaultOpen={!closed} id={p.id}>
          <DealAppointmentBox deal={p} viewer={viewer} canLog={editable} canManage={canManage} programmes={programmes} client={client} onDone={onDone} />
          {closed && !ap && <p className="text-sm text-ink-soft">No meeting was logged.</p>}
        </Fold>
        <Fold title="Follow-ups" hint={followUpCountText(nNotes)} defaultOpen={false} id={p.id}>
          <FollowUpList deal={p} viewer={viewer} canAdd={editable} />
        </Fold>
        <Fold title="Details" hint={proposed || 'Nothing proposed yet'} defaultOpen={false} id={p.id}>
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[15px]">
              <Detail term="Owner" value={ownerName} />
              <Detail term="Discovery made" value={formatDate(discoveryDate(p)) || '—'} />
              <Detail term="Who we meet" value={pic ? [pic.name + (pic.designation ? ` (${pic.designation})` : ''), pic.phone].filter(Boolean).join(', ') : '—'} />
              <Detail term="What we'll propose" value={proposed || '—'} />
              <Detail term="First touch point" value={first ? 'Yes, our first contact with this client' : 'No, we have met them before'} />
              <Detail term="Next follow-up" value={formatDate(p.followUpDate) || 'Not set'} />
              {p.movedToDiscovery?.at && <Detail term="Moved back from a deal" value={`${formatDate(p.movedToDiscovery.at)} by ${p.movedToDiscovery.byName || 'someone'}`} />}
            </dl>
            {p.notes && <p className="whitespace-pre-line rounded-lg bg-surface px-3.5 py-2.5 text-[15px]">{p.notes}</p>}
            {editable && <button type="button" className={btnSecondary} onClick={onEdit}>Edit details</button>}
          </div>
        </Fold>
        {(p.history || []).length > 0 && (
          <Fold title="History" hint={`${p.history.length} entr${p.history.length === 1 ? 'y' : 'ies'}`} defaultOpen={false} id={p.id}>
            <ul className="space-y-1.5 text-sm text-ink-soft">
              {[...p.history].reverse().slice(0, 12).map((h: any, i: number) => (
                <li key={i}>{new Date(h.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}: {h.action} <span className="text-ink-soft/70">by {h.byName}</span></li>
              ))}
            </ul>
          </Fold>
        )}
      </div>

      {canManage && (
        <div className="pt-1">
          {!deleting ? (
            <button type="button" disabled={busy} onClick={() => setDeleting(true)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-danger hover:underline"><XCircle className="h-4 w-4" /> Delete discovery</button>
          ) : (
            <div className="space-y-3 rounded-xl border border-danger/30 bg-danger-soft p-4">
              <p className="font-semibold text-danger">Delete this discovery?</p>
              <p className="text-sm text-ink-soft">Use this only if it was made by mistake; it stops counting in KPIs. If the client wasn't interested, close it instead. Management can restore it.</p>
              <input value={deleteReason} onChange={e => setDeleteReason(e.target.value)} className={input} maxLength={500}
                placeholder={viewer.role === 'management' ? 'Why? (optional)' : 'Why? (required), e.g. Made twice by mistake'} aria-label="Why delete" />
              <div className="flex flex-wrap gap-2">
                <button type="button" className={btnSecondary} onClick={() => setDeleting(false)}>Cancel</button>
                <button type="button" disabled={busy} onClick={async () => {
                  if (viewer.role !== 'management' && deleteReason.trim().length < 3) return setErr('Say why the discovery is being deleted.');
                  setErr('');
                  await onDelete(deleteReason);
                }} className="inline-flex items-center gap-2 rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white hover:bg-[#931C13]">Delete discovery</button>
              </div>
            </div>
          )}
          {err && !editable && <p role="alert" className="mt-2 rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{err}</p>}
          {err && editable && deleting && <p role="alert" className="mt-2 rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{err}</p>}
        </div>
      )}
    </div>
  );
}
