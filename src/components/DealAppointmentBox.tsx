import React, { useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { AlertTriangle, CalendarClock, CalendarPlus, Loader2, NotebookPen, Pencil, X } from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import { FUNDING_LABELS, FundingType, dealStage, dealValue, formatDate, statusForStage, todayIso, trainingDays, parseTrainingDays, TRAINING_DAYS_PROBLEM } from '../lib/deals';
import TrainingDaysPicker from './TrainingDaysPicker';
import { ApptMode, DealAppointment, MODE_LABELS, apptLateDays, apptOf, apptOverdue, apptTime } from '../lib/appointments';
import { ProgrammePicker } from './Programmes';
import { dealContact } from '../lib/contacts';
import { forgetDraft, useFormDraft } from '../lib/useFormDraft';
import DraftBar from './DraftBar';
import { lockedDateProblem, minOpenDate } from '../lib/monthLock';
import { valueLocked } from '../lib/trainingChange';
import MeetingPhotos, { useDealMeetingPhotos } from './MeetingPhotos';
import { MeetingPhoto } from '../lib/meetingPhotos';

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const label = 'mb-1 block text-sm font-semibold text-ink';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';

const history = (deal: any, viewer: Viewer, action: string) =>
  [...(deal.history || []), { at: new Date().toISOString(), byId: viewer.id, byName: viewer.name, action }];
const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

// The deal's one appointment: book it, log it (meeting + what the client wants), or see it.
// Who (2026-10-19): the deal owner, Admin and Management book and log it (canLog), so a rep keeps the
// Appointment KPI when Admin created the deal. Changing or cancelling a booking, or editing a logged one, stays
// with the deal's creator and Management (Joel, 2026-10-16), plus whoever booked or logged it.
export default function DealAppointmentBox({ deal, viewer, canLog, canManage, programmes, client, onDone }: {
  deal: any; viewer: Viewer; canLog: boolean; canManage: boolean; programmes: any[]; client: any; onDone: (msg: string) => void;
}) {
  const a = apptOf(deal);
  const canChangeBooking = canLog && (canManage || (!!a?.bookedById && a.bookedById === viewer.id));
  const canEditLogged = canLog && (canManage || (!!a?.loggedById && a.loggedById === viewer.id));
  const st = dealStage(deal);
  // A discovery's meeting (2026-10-28, lib/discovery.ts) is booked and logged the same way, and stays a discovery.
  const disc = st === 'discovery';
  const word = disc ? 'Discovery meeting' : 'Appointment';
  const open = (disc && !deal.discoveryClosed) || st === 'lead' || st === 'appointment' || st === 'proposal' || st === 'agreed' || st === 'quoted';   // any time before Won
  const [mode, setMode] = useState<null | 'book' | 'log'>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const photos = useDealMeetingPhotos(deal.id);
  // Meeting photos (2026-10-26): face-to-face (photo) and online (screenshot), from the meeting day on.
  const proof = !!a && !a.legacy && (a.mode === 'face' || a.mode === 'online');
  const photoBox = !proof ? null : a.date.slice(0, 10) <= todayIso()
    ? <MeetingPhotos photos={photos} deal={deal} kind="appointment" meetingDate={a.date.slice(0, 10)} viewer={viewer} canAdd={canLog} online={a.mode === 'online'} />
    : <p className="mt-1 text-sm text-ink-soft">{a.mode === 'online' ? 'Meeting screenshot' : 'Meeting photo'}: from the meeting day.</p>;

  const write = async (changes: any, msg: string) => {
    setBusy(true);
    setError('');
    try {
      await updateDoc(doc(db, 'pipelines', deal.id), clean(changes));
      if (mode === 'log') forgetDraft(viewer.id, `appt-log:${deal.id}`);
      setMode(null);
      onDone(msg);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const cancelBooking = () => {
    if (!window.confirm('Cancel this booked appointment?')) return;
    return write({ appointment: null, history: history(deal, viewer, `${word} cancelled`) }, `${word} cancelled`);
  };

  if (mode === 'book') return <BookForm a={a} busy={busy} error={error} onCancel={() => setMode(null)}
    onSave={(v) => write({
      appointment: { ...(deal.appointment || {}), status: 'booked', date: v.date, time: v.time, mode: v.mode, bookedAt: new Date().toISOString(), bookedById: viewer.id, bookedByName: viewer.name },
      history: history(deal, viewer, `${word} booked for ${formatDate(v.date)}`),
    }, `${word} booked and added to the calendar`)} title={`Book ${word.toLowerCase()}`} />;

  if (mode === 'log') return <LogForm deal={deal} a={a} disc={disc} word={word} client={client} programmes={programmes} viewer={viewer} busy={busy} error={error} photos={photos} onCancel={() => setMode(null)}
    onSave={(v) => {
      const stage = st === 'lead' ? 'appointment' : st;
      // A won deal's programme, value, pax and funding type are locked (2026-10-22): the log doesn't change them.
      const locked = valueLocked(deal);
      const prog = locked ? undefined : programmes.find(p => p.id === v.programmeId);
      return write({
        appointment: {
          ...(deal.appointment || {}), status: 'held', date: v.date, time: v.time, mode: v.mode, metWith: v.metWith.trim(), outcome: v.outcome.trim(), nextStep: v.nextStep.trim(),
          loggedAt: new Date().toISOString(), loggedById: viewer.id, loggedByName: viewer.name,
          ...(disc ? { discovery: true } : {}),
        },
        appointmentDate: v.date, appointmentTicked: true,
        stage, status: statusForStage(stage as any),
        followUpDate: v.followUpDate,
        ...(prog ? { programmeId: prog.id, courseName: prog.name, ...(v.dealType ? { type: v.dealType } : {}) } : {}),
        ...(v.trainingDate && !locked ? { trainingDate: v.trainingDate } : {}),
        ...(v.trainingDays.trim() && parseTrainingDays(v.trainingDays) && !locked ? { trainingDays: parseTrainingDays(v.trainingDays) } : {}),
        ...(v.participants && !locked ? { participants: v.participants } : {}),
        ...(v.value && !locked ? { proposalValue: Number(v.value) } : {}),
        ...(v.fundingType && !locked ? { fundingType: v.fundingType } : {}),
        history: history(deal, viewer, a?.status === 'held' && !a.legacy ? `${word} details updated` : `${word} held on ${formatDate(v.date)}`),
      }, `${word} logged`);
    }} />;

  // Nothing yet
  if (!a) {
    if (!canLog || !open) return null;
    return (
      <div className="rounded-xl border border-dashed border-line p-3.5">
        <p className="text-[15px] text-ink-soft">{disc ? 'Book the discovery meeting, or log it if it has happened. It counts as an appointment.' : `Appointment (optional). Skip it and go straight to "Proposal sent" if there's no meeting.`}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className={btnSecondary} onClick={() => setMode('book')}><CalendarPlus className="h-4 w-4" /> Book {disc ? 'meeting' : 'appointment'}</button>
          <button type="button" className={btnSecondary} onClick={() => setMode('log')}><NotebookPen className="h-4 w-4" /> Log {disc ? 'meeting' : 'appointment'}</button>
        </div>
      </div>
    );
  }

  // Booked
  if (a.status === 'booked') {
    const overdue = apptOverdue(deal);
    return (
      <div className={`rounded-xl border p-3.5 ${overdue ? 'border-danger/40 bg-danger-soft' : 'border-accent/30 bg-accent-soft'}`}>
        <p className={`flex items-center gap-2 font-semibold ${overdue ? 'text-danger' : 'text-accent'}`}>
          {overdue ? <AlertTriangle className="h-4 w-4" /> : <CalendarClock className="h-4 w-4" />}
          {overdue ? `${word} on ${formatDate(a.date)} not logged yet` : `${word} booked: ${formatDate(a.date)}${a.time ? `, ${apptTime(a.time)}` : ''}`}
        </p>
        <p className="text-sm text-ink-soft">{MODE_LABELS[a.mode]} · booked by {a.bookedByName || 'someone'} · on the team calendar</p>
        {canLog && (
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={btnPrimary} onClick={() => setMode('log')}><NotebookPen className="h-4 w-4" /> Log what happened</button>
            {canChangeBooking && <button type="button" className={btnSecondary} onClick={() => setMode('book')}>Change</button>}
            {canChangeBooking && <button type="button" className={btnSecondary} disabled={busy} onClick={cancelBooking}><X className="h-4 w-4" /> Cancel</button>}
          </div>
        )}
        {photoBox}
        {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      </div>
    );
  }

  // Held
  const late = apptLateDays(a);
  return (
    <div className="rounded-xl border border-line bg-surface p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-semibold">{a.discovery ? 'Discovery meeting' : 'Appointment'} held {formatDate(a.date)}{a.metWith ? ` with ${a.metWith}` : ''}{a.legacy ? '' : ` · ${MODE_LABELS[a.mode]}`}</p>
        {canEditLogged && <button type="button" className="text-sm font-semibold text-accent hover:underline" onClick={() => setMode('log')}><Pencil className="mr-1 inline h-3.5 w-3.5" />Edit</button>}
      </div>
      {a.legacy ? (
        <p className="text-sm text-ink-soft">Recorded before appointment details were kept.{canEditLogged ? ' Click Edit to add them.' : ''}</p>
      ) : (
        <>
          {a.outcome && <p className="mt-1 text-[15px]"><span className="text-ink-soft">Outcome:</span> {a.outcome}</p>}
          {a.nextStep && <p className="text-[15px]"><span className="text-ink-soft">Next step:</span> {a.nextStep}</p>}
          <p className="mt-1 text-sm text-ink-soft">Logged by {a.loggedByName}{late > 3 ? <span className="font-semibold text-attention"> · logged {late} days late</span> : ''}</p>
        </>
      )}
      {photoBox}
    </div>
  );
}

function ModePick({ value, onChange }: { value: ApptMode; onChange: (m: ApptMode) => void }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Type of meeting">
      {(Object.keys(MODE_LABELS) as ApptMode[]).map(m => (
        <button key={m} type="button" role="radio" aria-checked={value === m} onClick={() => onChange(m)}
          className={`rounded-full border px-3 py-1 text-sm font-medium ${value === m ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-white text-ink-soft hover:bg-surface'}`}>
          {MODE_LABELS[m]}
        </button>
      ))}
    </div>
  );
}

function BookForm({ a, busy, error, onCancel, onSave, title = 'Book appointment' }: {
  a: DealAppointment | null; busy: boolean; error: string; onCancel: () => void; onSave: (v: { date: string; time: string; mode: ApptMode }) => void; title?: string;
}) {
  const [v, setV] = useState({ date: a?.status === 'booked' ? a.date : '', time: a?.time || '', mode: (a?.mode || 'face') as ApptMode });
  const [err, setErr] = useState('');
  return (
    <div className="space-y-3 rounded-xl border border-accent/30 bg-accent-soft/50 p-4">
      <p className="font-semibold">{title}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className={label} htmlFor="ap-d">Date</label><input id="ap-d" type="date" value={v.date} onChange={e => setV(x => ({ ...x, date: e.target.value }))} className={input} /></div>
        <div><label className={label} htmlFor="ap-t">Time</label><input id="ap-t" type="time" value={v.time} onChange={e => setV(x => ({ ...x, time: e.target.value }))} className={input} /></div>
      </div>
      <ModePick value={v.mode} onChange={m => setV(x => ({ ...x, mode: m }))} />
      {(err || error) && <p role="alert" className="text-sm text-danger">{err || error}</p>}
      <div className="flex gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel}>Cancel</button>
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => (v.date ? onSave(v) : setErr('Choose the date.'))}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Book</button>
      </div>
    </div>
  );
}

function LogForm({ deal, a, disc = false, word = 'Appointment', client, programmes, viewer, busy, error, photos, onCancel, onSave }: {
  deal: any; a: DealAppointment | null; disc?: boolean; word?: string; client: any; programmes: any[]; viewer: Viewer; busy: boolean; error: string; photos: MeetingPhoto[]; onCancel: () => void;
  onSave: (v: any) => void;
}) {
  const held = a?.status === 'held' && !a.legacy ? a : null;
  const [v, setV] = useState({
    date: held?.date || (a?.status === 'booked' ? a.date : todayIso()),
    time: a?.time || '',
    mode: (a?.mode || 'face') as ApptMode,
    metWith: held?.metWith || dealContact(deal, client)?.name || '',
    programmeId: deal.programmeId || '',
    dealType: '',   // set by the picked programme's type
    trainingDate: /^\d{4}-\d{2}-\d{2}/.test(deal.trainingDate || '') ? deal.trainingDate.slice(0, 10) : '',
    trainingDays: trainingDays(deal) !== 1 ? String(trainingDays(deal)) : '',
    participants: deal.participants ? String(deal.participants) : '',
    value: dealValue(deal) ? String(dealValue(deal)) : '',
    fundingType: (deal.fundingType || '') as FundingType | '',
    outcome: held?.outcome || '',
    nextStep: held?.nextStep || '',
    followUpDate: /^\d{4}-\d{2}-\d{2}/.test(deal.followUpDate || '') ? deal.followUpDate.slice(0, 10) : '',
  });
  const [err, setErr] = useState('');
  // Kept in this browser until it's saved (lib/useFormDraft.ts; cleared by the box once the log is saved).
  const draft = useFormDraft(viewer.id, `appt-log:${deal.id}`, v, setV);
  const set = (c: Partial<typeof v>) => setV(x => ({ ...x, ...c }));

  const submit = () => {
    if (!v.date) return setErr('Enter the date of the meeting.');
    if (v.date > todayIso()) return setErr(`The meeting date is in the future. Use "Book ${disc ? 'meeting' : 'appointment'}" for upcoming meetings.`);
    // Month lock (2026-10-22): a meeting date in a locked month, or moving one out of it, is for Management only.
    const oldDate = /^\d{4}-\d{2}-\d{2}/.test(deal.appointmentDate || '') ? deal.appointmentDate.slice(0, 10) : '';
    if (v.date !== oldDate) {
      const locked = lockedDateProblem(v.date, viewer.role) || (oldDate ? lockedDateProblem(oldDate, viewer.role) : '');
      if (locked) return setErr(locked);
    }
    if (!v.outcome.trim()) return setErr(disc ? 'Write one line on what you proposed and how they reacted.' : 'Write one line on what was agreed.');
    if (!v.nextStep.trim()) return setErr('Write the next step.');
    if (!v.followUpDate) return setErr('Set the follow-up date.');
    if (parseTrainingDays(v.trainingDays) === null) return setErr(TRAINING_DAYS_PROBLEM);
    setErr('');
    onSave(v);
  };

  return (
    <div className="space-y-4 rounded-xl border border-accent/30 bg-accent-soft/40 p-4">
      <p className="font-semibold">Log {word.toLowerCase()}</p>
      <DraftBar draft={draft} what={`${word.toLowerCase()} log`} />
      <div className="grid gap-3 sm:grid-cols-3">
        <div><label className={label} htmlFor="lg-d">Date of meeting</label><input id="lg-d" type="date" value={v.date} min={minOpenDate(viewer.role) || undefined} max={todayIso()} onChange={e => set({ date: e.target.value })} className={input} /></div>
        <div className="sm:col-span-2"><label className={label} htmlFor="lg-m">Met with</label><input id="lg-m" value={v.metWith} onChange={e => set({ metWith: e.target.value })} className={input} placeholder="Contact person" /></div>
      </div>
      <ModePick value={v.mode} onChange={m => set({ mode: m })} />
      {(v.mode === 'face' || v.mode === 'online') && v.date && v.date <= todayIso() && (
        <MeetingPhotos photos={photos} deal={deal} kind="appointment" meetingDate={v.date} viewer={viewer} canAdd online={v.mode === 'online'} />
      )}

      {disc && (
        <div className="rounded-xl bg-white p-3.5">
          <span className={label}>What we proposed <span className="font-normal text-ink-soft">(optional)</span></span>
          <ProgrammePicker programmes={programmes} value={v.programmeId} legacyName={!v.programmeId ? deal.courseName : ''} viewer={viewer} startType={deal.type === 'Teambuilding' ? 'teambuilding' : undefined}
            onChange={(pg, t) => set({ programmeId: pg.id, dealType: t === 'teambuilding' ? 'Teambuilding' : 'Training' })} />
        </div>
      )}
      {!disc && !valueLocked(deal) && <div className="rounded-xl bg-white p-3.5">
        <p className="mb-2 text-sm font-semibold text-ink-soft">What the client wants (saved on the deal)</p>
        <div className="space-y-3">
          <div>
            <span className={label}>Programme</span>
            <ProgrammePicker programmes={programmes} value={v.programmeId} legacyName={!v.programmeId ? deal.courseName : ''} viewer={viewer} startType={deal.type === 'Teambuilding' ? 'teambuilding' : undefined}
              onChange={(pg, t) => set({ programmeId: pg.id, dealType: t === 'teambuilding' ? 'Teambuilding' : 'Training' })} />
          </div>
          <TrainingDaysPicker id="lg-dy" label="How long is the training?" value={v.trainingDays} onChange={d => set({ trainingDays: d })} />
          <div className="grid gap-3 sm:grid-cols-3">
            <div><label className={label} htmlFor="lg-td">Preferred training date</label><input id="lg-td" type="date" value={v.trainingDate} onChange={e => set({ trainingDate: e.target.value })} className={input} /></div>
            <div><label className={label} htmlFor="lg-px">Participants</label><input id="lg-px" inputMode="numeric" value={v.participants} onChange={e => set({ participants: e.target.value.replace(/[^0-9]/g, '') })} className={input} placeholder="e.g. 20" /></div>
            <div><label className={label} htmlFor="lg-v">Estimated value (RM)</label><input id="lg-v" inputMode="decimal" value={v.value} onChange={e => set({ value: e.target.value.replace(/[^0-9.]/g, '') })} className={input} /></div>
          </div>
          <div>
            <span className={label}>How will it be paid?</span>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(FUNDING_LABELS) as FundingType[]).map(ft => (
                <button key={ft} type="button" aria-pressed={v.fundingType === ft} onClick={() => set({ fundingType: ft })}
                  className={`rounded-full border px-3 py-1 text-sm font-medium ${v.fundingType === ft ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-soft hover:bg-surface'}`}>
                  {FUNDING_LABELS[ft]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><label className={label} htmlFor="lg-o">{disc ? 'Outcome: what we proposed and how they reacted' : 'Outcome: what was agreed'}</label><input id="lg-o" value={v.outcome} onChange={e => set({ outcome: e.target.value })} className={input} placeholder={disc ? "e.g. Showed our leadership programme; HR will check next year's budget" : 'e.g. Interested in a 2-day run in November for 20 staff'} /></div>
        <div><label className={label} htmlFor="lg-n">Next step</label><input id="lg-n" value={v.nextStep} onChange={e => set({ nextStep: e.target.value })} className={input} placeholder={disc ? 'e.g. Call HR in two weeks' : 'e.g. Send proposal by Friday'} /></div>
        <div><label className={label} htmlFor="lg-f">Follow-up date</label><input id="lg-f" type="date" value={v.followUpDate} onChange={e => set({ followUpDate: e.target.value })} className={input} /></div>
      </div>

      {(err || error) && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{err || error}</p>}
      <div className="flex gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel}>Cancel</button>
        <button type="button" className={btnPrimary} disabled={busy} onClick={submit}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save {disc ? 'meeting' : 'appointment'}</button>
      </div>
    </div>
  );
}
