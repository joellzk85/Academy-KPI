import React, { useEffect, useState } from 'react';
import { collection, deleteField, doc, getDoc, getDocs, onSnapshot, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { BadgeCheck, Check, Copy, FileText, KeyRound, Landmark, Loader2, MessageCircle, Star, X } from 'lucide-react';
import { auth, callServer, db, friendlyError } from '../lib/firebase';
import { sendPortalPasswordEmail } from '../lib/portalEmail';
import { dealStage, formatDate, formatDateRange, todayIso, trainingEndDate } from '../lib/deals';
import { linkedOnly } from '../lib/linked';
import { MoneyOut } from '../lib/money';
import { Vendor, withBankStamp } from '../lib/vendors';
import { newToken, whatsappShare } from '../lib/trainerLinks';
import { isTrainerFee } from '../lib/feeChecks';
import { FeeChecksBox } from './FeeChecks';
import {
  BankRequest, Booking, INVITE_DAYS, PORTAL_PATH, PortalInvite, STARS, STAR_WORDS, TrainerAccount, TrainerJob, claimFlag, clashesWith, cleanEmail, emailProblem, inviteLive, invitePath,
  jobId, poDeclinedFlag, poLines, ratingAverage,
} from '../lib/trainerPortal';

// The CRM side of the trainer portal (2026-10-21, lib/trainerPortal.ts): giving a trainer access (Trainers panel),
// bank account changes to check, the rating, PO acceptance and fee request on a deal's Trainer step, and the
// fee requests waiting in Admin work → Money.

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };
const isStaff = (v: Viewer) => v.role === 'admin' || v.role === 'management';

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';
const alertBox = 'rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger';
const isoDay = (s?: string) => (s ? formatDate(s.slice(0, 10)) : '');

export const portalUrl = () => `${window.location.origin}${PORTAL_PATH}`;

function useRun() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<any>) => {
    setBusy(true); setError('');
    try { await fn(); return true; } catch (e) { setError(passwordEmailError(e)); return false; } finally { setBusy(false); }
  };
  return { busy, error, setError, run };
}
function passwordEmailError(e: any): string {
  const c = String(e?.code || '');
  if (c === 'auth/operation-not-allowed' || c === 'auth/configuration-not-found')
    return 'Access is saved, but Firebase could not send the password email: Email/Password sign-in is not switched on yet (Firebase console → Authentication → Sign-in method). Switch it on, then click "Send password email again".';
  if (c === 'auth/too-many-requests') return 'Firebase is limiting emails for now. Wait a few minutes and try again.';
  return friendlyError(e);
}

// ---------- Live lists ----------
export function useTrainerAccounts(enabled = true): Record<string, TrainerAccount> {
  const [list, setList] = useState<Record<string, TrainerAccount>>({});
  useEffect(() => {
    if (!enabled) return;
    return onSnapshot(collection(db, 'trainer_accounts'), s => setList(Object.fromEntries(s.docs.map(d => [d.id, { ...(d.data() as TrainerAccount), id: d.id }]))), () => setList({}));
  }, [enabled]);
  return list;
}
export function useTrainerJobs(filter?: { dealId?: string; trainerId?: string }): TrainerJob[] {
  const [list, setList] = useState<TrainerJob[]>([]);
  const key = `${filter?.dealId || ''}|${filter?.trainerId || ''}`;
  useEffect(() => {
    const base = collection(db, 'trainer_jobs');
    const q = filter?.dealId ? query(base, where('dealId', '==', filter.dealId)) : filter?.trainerId ? query(base, where('trainerId', '==', filter.trainerId)) : query(base);
    return onSnapshot(q, s => setList(s.docs.map(d => ({ ...(d.data() as TrainerJob), id: d.id }))), () => setList([]));
  }, [key]);
  return list;
}
export function useBankRequests(enabled: boolean): BankRequest[] {
  const [list, setList] = useState<BankRequest[]>([]);
  useEffect(() => {
    if (!enabled) { setList([]); return; }
    return onSnapshot(query(collection(db, 'trainer_bank_requests'), where('status', '==', 'pending')),
      s => setList(s.docs.map(d => ({ ...(d.data() as BankRequest), id: d.id }))), () => setList([]));
  }, [enabled]);
  return list;
}

// ---------- Trainers panel: portal access (Admin and Management) ----------
export function PortalAccessBox({ trainer, account, viewer, onInvite }: { trainer: any; account?: TrainerAccount; viewer: Viewer; onInvite?: () => void }) {
  const [email, setEmail] = useState(account?.email || trainer.email || '');
  const [changing, setChanging] = useState(false);
  const [sent, setSent] = useState('');
  const { busy, error, setError, run } = useRun();
  useEffect(() => { setEmail(account?.email || trainer.email || ''); setChanging(false); setSent(''); setError(''); }, [trainer.id]);
  if (!isStaff(viewer)) {
    return account?.active ? <p className="text-sm text-ink-soft">{trainer.name} has trainer portal access.</p> : null;
  }

  const give = () => {
    const em = cleanEmail(email);
    const bad = emailProblem(em);
    if (bad) return setError(bad);
    return run(async () => {
      await callServer('/api/trainer-portal/access', { trainerId: trainer.id, email: em }, true);
      setChanging(false);
      await sendPortalPasswordEmail(auth, em);
      setSent(em);
    });
  };
  const resend = () => run(async () => {
    await callServer('/api/trainer-portal/access', { trainerId: trainer.id, email: account!.email }, true);
    await sendPortalPasswordEmail(auth, account!.email);
    setSent(account!.email);
  });
  const turnOff = () => {
    if (!window.confirm(`Turn off ${trainer.name}'s portal access? They can no longer log in. Their profile link and records stay as they are.`)) return;
    return run(() => callServer('/api/trainer-portal/off', { trainerId: trainer.id }, true));
  };
  const message = `Hi ${trainer.name}, you now have access to the NEXT Academy trainer portal: ${portalUrl()}\nWe've emailed you a link to choose your password. Log in with ${sent || account?.email || ''}.`;

  const emailForm = (
    <div className="flex flex-wrap gap-2">
      <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={`${input} min-w-[14rem] flex-1`} placeholder="Trainer's email" aria-label="Trainer's login email" />
      <button type="button" disabled={busy} className={btnPrimary} onClick={give}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} {account ? 'Save and send password email' : 'Give portal access'}</button>
      {changing && <button type="button" className={btnSecondary} onClick={() => setChanging(false)}>Cancel</button>}
    </div>
  );

  return (
    <div className="space-y-2">
      {account?.active ? (
        <>
          <p className="flex items-center gap-1.5 text-[15px]"><BadgeCheck className="h-4 w-4 text-accent" /> Has access · logs in with <strong>{account.email}</strong></p>
          <p className="text-sm text-ink-soft">{account.lastSeenAt ? `Last used ${isoDay(account.lastSeenAt)}` : 'Not logged in yet'}{account.createdByName ? ` · given by ${account.createdByName}${account.createdAt ? ` on ${isoDay(account.createdAt)}` : ''}` : ''}</p>
          {changing ? emailForm : (
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} className={btnSecondary} onClick={resend}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Send password email again</button>
              <button type="button" className={btnSecondary} onClick={() => setChanging(true)}>Change login email</button>
              <button type="button" disabled={busy} className={`${btnSecondary} text-danger`} onClick={turnOff}>Turn off access</button>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-sm text-ink-soft">
            {account ? 'Portal access is turned off.' : 'No portal access yet. Not every trainer needs it; their profile link keeps working either way.'}
            {' '}With access, {trainer.name} logs in at {portalUrl()} to update their profile, biodata and bank details, see their trainings, PO and rating, and request their fee.
          </p>
          {changing ? emailForm : (
            <div className="flex flex-wrap items-center gap-2">
              {onInvite && <button type="button" className={btnPrimary} onClick={onInvite}><KeyRound className="h-4 w-4" /> Invite to trainer portal</button>}
              <button type="button" className="text-sm font-semibold text-accent hover:underline" onClick={() => setChanging(true)}>or set it up with their email</button>
            </div>
          )}
        </>
      )}
      {error && <p role="alert" className={alertBox}>{error}</p>}
      {sent && (
        <div className="space-y-2 rounded-lg bg-accent-soft p-3 text-sm">
          <p className="text-accent">Done. Firebase has emailed {sent} a link to choose a password (it may land in spam). Let them know by WhatsApp too:</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnSecondary} onClick={() => navigator.clipboard?.writeText(message)}><Copy className="h-4 w-4" /> Copy message</button>
            <a href={whatsappShare(portalUrl(), message.replace(`: ${portalUrl()}`, ':'), trainer.contact)} target="_blank" rel="noreferrer" className={btnSecondary}><MessageCircle className="h-4 w-4" /> WhatsApp</a>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Trainers → "Invite to trainer portal" (Admin and Management): an invite link ----------
export function usePortalInvites(enabled: boolean): PortalInvite[] {
  const [list, setList] = useState<PortalInvite[]>([]);
  useEffect(() => {
    if (!enabled) { setList([]); return; }
    return onSnapshot(query(collection(db, 'portal_invites'), where('status', '==', 'open')),
      s => setList(s.docs.map(d => ({ ...(d.data() as PortalInvite), id: d.id })).sort((a, b) => b.createdAt - a.createdAt)), () => setList([]));
  }, [enabled]);
  return list;
}

const inviteUrl = (token: string) => `${window.location.origin}${invitePath(token)}`;
const inviteMessage = (name: string) => `Hi ${name || 'there'}, NEXT Academy is inviting you to our trainer portal. Open this link to set up your login (email and password):`;

function InviteShare({ inv, phone, onCancel }: { inv: PortalInvite; phone?: string; onCancel?: () => void }) {
  const [copied, setCopied] = useState(false);
  const url = inviteUrl(inv.token);
  const copy = async () => { try { await navigator.clipboard.writeText(url); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { /* shown, select by hand */ } };
  return (
    <div className="space-y-2 rounded-xl border border-line bg-surface p-3 text-sm">
      <input readOnly value={url} onFocus={e => e.target.select()} aria-label="Invite link" className="w-full rounded-md border border-line bg-white px-2 py-1.5 text-sm" />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={copy} className={btnSecondary}>{copied ? <Check className="h-4 w-4 text-accent" /> : <Copy className="h-4 w-4" />} {copied ? 'Copied' : 'Copy link'}</button>
        <a href={whatsappShare(url, inviteMessage(inv.name), phone ?? inv.phone)} target="_blank" rel="noreferrer" className={btnSecondary}><MessageCircle className="h-4 w-4" /> WhatsApp</a>
        <span className="text-ink-soft">Works once, until {formatDate(new Date(inv.expiresAt).toISOString().slice(0, 10))}</span>
        {onCancel && <button type="button" onClick={onCancel} className="ml-auto inline-flex items-center gap-1 font-semibold text-danger hover:underline"><X className="h-4 w-4" /> Cancel</button>}
      </div>
    </div>
  );
}

export function PortalInviteDialog({ viewer, trainers, onClose, preselect = '' }: { viewer: Viewer; trainers: any[]; onClose: () => void; preselect?: string }) {
  const accounts = useTrainerAccounts();
  const invites = usePortalInvites(true);
  const [who, setWho] = useState(preselect);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [made, setMade] = useState<PortalInvite | null>(null);
  const { busy, error, setError, run } = useRun();
  const isNew = who === '__new';
  const sorted = [...trainers].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const picked = trainers.find(t => t.id === who);

  const make = () => {
    if (!who) return setError('Choose the trainer, or "Someone new".');
    if (isNew && !name.trim()) return setError("Type the new trainer's name.");
    return run(async () => {
      const token = newToken();
      const inv: PortalInvite = {
        id: token, token, status: 'open', name: isNew ? name.trim() : String(picked?.name || ''), ...(isNew ? { phone: phone.trim() } : { trainerId: who }),
        createdAt: Date.now(), expiresAt: Date.now() + INVITE_DAYS * 86_400_000, createdById: viewer.id, createdByName: viewer.name,
      };
      await setDoc(doc(db, 'portal_invites', token), inv);
      setMade(inv); setWho(''); setName(''); setPhone('');
    });
  };
  const cancel = (inv: PortalInvite) => {
    if (!window.confirm(`Cancel the invite for ${inv.name}? The link stops working.`)) return;
    return run(() => updateDoc(doc(db, 'portal_invites', inv.id), { status: 'cancelled' }));
  };
  const phoneOf = (inv: PortalInvite) => (inv.trainerId ? trainers.find(t => t.id === inv.trainerId)?.contact : inv.phone);
  const waiting = invites.filter(i => inviteLive(i) && i.id !== made?.id);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" role="dialog" aria-modal="true" aria-label="Invite to trainer portal" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold">Invite to trainer portal</h3>
            <p className="text-sm text-ink-soft">Send the trainer a link. They type their email, choose a password and they're in. Portal address: {portalUrl()}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-ink-soft hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>

        {made ? (
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-[15px] font-semibold text-accent"><Check className="h-4 w-4" /> Invite link for {made.name} is ready. Send it by WhatsApp:</p>
            <InviteShare inv={made} phone={phoneOf(made)} />
            <button type="button" className={btnSecondary} onClick={() => setMade(null)}>Invite someone else</button>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-semibold" htmlFor="pi-who">Who?</label>
              <select id="pi-who" value={who} onChange={e => { setWho(e.target.value); setError(''); }} className={input}>
                <option value="">Choose a trainer…</option>
                <option value="__new">Someone new (not in the Trainers list yet)</option>
                {sorted.map(t => <option key={t.id} value={t.id}>{t.name}{accounts[t.id]?.active ? ' (has access already)' : ''}</option>)}
              </select>
              {picked && accounts[picked.id]?.active && <p className="mt-1 text-sm text-ink-soft">{picked.name} already logs in with {accounts[picked.id].email}. A new invite lets them set up their login again (new email or password).</p>}
            </div>
            {isNew && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div><label className="mb-1 block text-sm font-semibold" htmlFor="pi-name">Name</label><input id="pi-name" value={name} onChange={e => setName(e.target.value)} className={input} /></div>
                <div><label className="mb-1 block text-sm font-semibold" htmlFor="pi-phone">Phone (for WhatsApp)</label><input id="pi-phone" type="tel" value={phone} onChange={e => setPhone(e.target.value)} className={input} /></div>
                <p className="text-sm text-ink-soft sm:col-span-2">They're added to Trainers when they set up their login, and fill in their profile in the portal.</p>
              </div>
            )}
            <button type="button" disabled={busy} className={btnPrimary} onClick={make}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Make invite link</button>
          </div>
        )}
        {error && <p role="alert" className={alertBox}>{error}</p>}

        {waiting.length > 0 && (
          <section className="space-y-2 border-t border-line pt-3">
            <h4 className="text-sm font-semibold text-ink-soft">Invites not used yet ({waiting.length})</h4>
            {waiting.map(inv => (
              <div key={inv.id} className="space-y-1">
                <p className="text-[15px]"><strong>{inv.name}</strong> <span className="text-sm text-ink-soft">· {inv.trainerId ? 'on the list' : 'new trainer'} · by {inv.createdByName}</span></p>
                <InviteShare inv={inv} phone={phoneOf(inv)} onCancel={() => cancel(inv)} />
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

// ---------- Bank account changes from trainers (Admin and Management) ----------
export function BankRequestsBox({ viewer, trainers }: { viewer: Viewer; trainers: any[] }) {
  const list = useBankRequests(isStaff(viewer));
  const { busy, error, run } = useRun();
  if (!isStaff(viewer) || !list.length) return null;
  const nameOf = (r: BankRequest) => trainers.find(t => t.id === r.trainerId)?.name || r.trainerName || 'Trainer';

  const accept = (r: BankRequest) => run(async () => {
    const now = new Date().toISOString();
    const found = await getDocs(query(collection(db, 'vendors'), where('trainerId', '==', r.trainerId)));
    const bank = { bankName: r.bankName, accountNo: r.accountNo, accountName: r.accountName, updatedAt: now, updatedByName: viewer.name };
    // The new bank details wait for a manager's check before accounts see them (process audit, 2026-10-22).
    if (!found.empty) {
      const before = { ...(found.docs[0].data() as Vendor), id: found.docs[0].id };
      await setDoc(found.docs[0].ref, withBankStamp({ ...before, ...bank }, before, viewer));
    } else {
      const id = `vd_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      await setDoc(doc(db, 'vendors', id), withBankStamp({ id, type: 'trainer', name: nameOf(r), trainerId: r.trainerId, ...bank, createdAt: now, createdById: viewer.id, createdByName: viewer.name }, null, viewer));
    }
    await updateDoc(doc(db, 'trainer_bank_requests', r.id), { status: 'accepted', decidedByName: viewer.name, decidedAt: now });
  });
  const reject = (r: BankRequest) => {
    const reason = window.prompt(`Why isn't ${nameOf(r)}'s bank account accepted? They will see this in the portal.`, '');
    if (reason === null) return;
    return run(() => updateDoc(doc(db, 'trainer_bank_requests', r.id), { status: 'rejected', rejectReason: reason.trim(), decidedByName: viewer.name, decidedAt: new Date().toISOString() }));
  };

  return (
    <section className="space-y-2 rounded-xl border border-attention/40 bg-attention-soft/40 p-4">
      <h3 className="flex items-center gap-2 font-bold"><Landmark className="h-4 w-4" /> Bank accounts from trainers, to check ({list.length})</h3>
      <p className="text-sm text-ink-soft">Typed by the trainer in the portal. Check it with them (a call, or their bank statement) before accepting: payments go to this account.</p>
      <ul className="space-y-2">
        {list.map(r => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-white px-3 py-2">
            <span className="min-w-0 flex-1 text-[15px]"><strong>{nameOf(r)}</strong> · {r.bankName} · {r.accountNo} · {r.accountName}<span className="block text-sm text-ink-soft">Sent {isoDay(r.at)}</span></span>
            <button type="button" disabled={busy} className={btnPrimary} onClick={() => accept(r)}><Check className="h-4 w-4" /> Accept</button>
            <button type="button" disabled={busy} className={btnSecondary} onClick={() => reject(r)}><X className="h-4 w-4" /> Reject</button>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className={alertBox}>{error}</p>}
    </section>
  );
}

// ---------- Stars ----------
export function Stars({ n, size = 'h-4 w-4' }: { n: number; size?: string }) {
  return (
    <span className="inline-flex items-center" aria-label={`${n} out of 5 stars`}>
      {STARS.map(i => <Star key={i} className={`${size} ${i <= n ? 'fill-[#E2A400] text-[#E2A400]' : 'text-line'}`} />)}
    </span>
  );
}

// Trainers panel: ratings from every training.
export function TrainerRatings({ trainerId, dealLabel }: { trainerId: string; dealLabel: (dealId: string) => string }) {
  const jobs = useTrainerJobs({ trainerId }).filter(j => j.rating);
  const { avg, count } = ratingAverage(jobs);
  if (!count) return <p className="text-[15px] text-ink-soft">Not rated yet. Admin rates the trainer on each deal's Trainer step.</p>;
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-2 text-lg font-bold">{avg} <Stars n={Math.round(avg)} /> <span className="text-sm font-normal text-ink-soft">from {count} training{count === 1 ? '' : 's'}</span></p>
      <ul className="divide-y divide-line">
        {[...jobs].sort((a, b) => String(b.rating!.at).localeCompare(String(a.rating!.at))).map(j => (
          <li key={j.id} className="py-1.5 text-sm">
            <span className="flex items-center gap-2"><Stars n={j.rating!.stars} size="h-3.5 w-3.5" /> <span className="truncate">{dealLabel(j.dealId)}</span></span>
            {j.rating!.note && <span className="block whitespace-pre-line text-ink-soft">{j.rating!.note}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- A deal's Trainer step: already booked on these dates? (2026-10-21) ----------
// A trainer's dates are blocked by every other won deal with them picked on the Trainer step, unless they declined it.
export function TrainerClash({ deal, trainerId, trainerName }: { deal: any; trainerId: string; trainerName: string }) {
  const [bookings, setBookings] = useState<(Booking & { client: string })[]>([]);
  const jobs = useTrainerJobs({ trainerId });
  useEffect(() => {
    let live = true;
    (async () => {
      const lists = await getDocs(collection(db, 'deal_checklists'));
      const ids = lists.docs.filter(d => d.id !== deal.id && (d.data().tasks || []).some((t: any) => t.kind === 'trainer' && t.trainerId === trainerId)).map(d => d.id);
      const deals = (await Promise.all(ids.map(id => getDoc(doc(db, 'pipelines', id))))).filter(s => s.exists()).map(s => ({ ...(s.data() as any), id: s.id }));
      if (live) setBookings(linkedOnly(deals).filter(d => dealStage(d) === 'won' && d.trainingDate)
        .map(d => ({ dealId: d.id, start: String(d.trainingDate).slice(0, 10), end: trainingEndDate(d), title: d.courseName || 'Training', client: d.client || '' })));
    })().catch(() => live && setBookings([]));
    return () => { live = false; };
  }, [trainerId, deal.id]);
  const start = String(deal.trainingDate || '').slice(0, 10);
  if (!start) return null;
  const clash = clashesWith(bookings, { dealId: deal.id, start, end: trainingEndDate(deal) })
    .filter(b => !jobs.find(j => j.dealId === b.dealId)?.poDeclined);
  if (!clash.length) return null;
  return (
    <div role="alert" className="mt-3 rounded-lg bg-attention-soft px-3 py-2 text-sm">
      <p className="font-semibold">{trainerName} is already booked on these dates:</p>
      <ul className="mt-1 list-disc pl-5">
        {clash.map(b => <li key={b.dealId}>{formatDateRange(b.start, b.end)}: {b.title}{b.client ? ` (${b.client})` : ''}</li>)}
      </ul>
    </div>
  );
}

// ---------- A deal's Trainer step: rating, PO accepted or declined, the trainer's fee request ----------
export function TrainerJobBox({ deal, task, trainerName, viewer, outs, internal = false }: {
  deal: any; task: { id: string; trainerId?: string }; trainerName: string; viewer: Viewer; outs: MoneyOut[];
  internal?: boolean;   // an internal trainer (on the team, 2026-10-25): My trainings in the CRM, no PO or fee
}) {
  const trainerId = task.trainerId || '';
  const job = useTrainerJobs({ dealId: deal.id }).find(j => j.trainerId === trainerId);
  const accounts = useTrainerAccounts(!!trainerId);
  const staff = isStaff(viewer);
  const [stars, setStars] = useState(0);
  const [note, setNote] = useState('');
  const [rating, setRating] = useState(false);
  const { busy, error, run } = useRun();
  if (!trainerId) return null;
  // No rating before the session (Joel, 2026-10-23).
  const start = String(deal.trainingDate || '').slice(0, 10);
  const started = !!start && start <= todayIso();
  const ref = doc(db, 'trainer_jobs', jobId(deal.id, trainerId));
  const claim = job?.claim;
  const lines = outs.filter(o => o.dealId === deal.id && o.checklistTaskId === task.id);
  const flag = claimFlag(job, lines, trainerName);

  const startRating = () => { setStars(job?.rating?.stars || 0); setNote(job?.rating?.note || ''); setRating(true); };
  const saveRating = () => run(async () => {
    if (!stars) throw new Error('Choose 1 to 5 stars.');
    await setDoc(ref, { dealId: deal.id, trainerId, rating: { stars, note: note.trim(), byId: viewer.id, byName: viewer.name, at: new Date().toISOString() } }, { merge: true });
    setRating(false);
  });
  const sendBack = () => {
    const why = window.prompt(`What should ${trainerName} fix or add? They will see this in the portal.`, '');
    if (!why?.trim() || !claim) return;
    const at = new Date().toISOString();
    return run(() => updateDoc(ref, {
      'claim.status': 'returned', 'claim.returnNote': why.trim(), 'claim.returnedByName': viewer.name, 'claim.returnedAt': at,
      'claim.history': [...(claim.history || []), { at, byName: viewer.name, action: `Sent back: ${why.trim()}` }].slice(-20),
    }));
  };
  const hasPortal = !!accounts[trainerId]?.active;
  const declined = poDeclinedFlag(job, trainerName);
  const autoPo = poLines(outs, deal.id, task.id).length > 0;
  // They agreed after all (talked it over): the flag goes and the dates are blocked again.
  const clearDecline = () => run(() => updateDoc(ref, { poDeclined: null }));
  // The fee changed after they accepted the PO made automatically: they accept the new one.
  const newPo = () => window.confirm(`Send ${trainerName} a new PO? Their acceptance is cleared and the portal shows the PO made from the fee lines now.`)
    && run(() => updateDoc(ref, { poAcceptedAt: deleteField(), po: null }));

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-line bg-surface/60 p-3">
      <p className="text-sm font-semibold">{internal ? 'Internal trainer' : 'Trainer portal'}</p>
      {internal && !claim && <p className="text-sm text-ink-soft">{trainerName} sees this training in My trainings, sends the photos and T3 there and writes the training report. You can also upload the photos and T3 on the steps below.</p>}
      {!internal && !hasPortal && !job && <p className="text-sm text-ink-soft">{trainerName} has no portal access. Give it in Trainers if they should see this training, the PO and request their fee there.</p>}
      {!internal && hasPortal && !job?.poAcceptedAt && !declined && (
        <p className="text-sm text-ink-soft">{trainerName} sees this training in the portal; {autoPo ? 'their PO is made automatically from the trainer fee, waiting for them to accept' : 'their PO is made automatically once the trainer fee is added'}.</p>
      )}
      {job?.poAcceptedAt && (
        <p className="flex flex-wrap items-center gap-1.5 text-sm text-accent"><BadgeCheck className="h-4 w-4" /> {trainerName} accepted the PO{job.po ? ` ${job.po.number}` : ''} on {isoDay(job.poAcceptedAt)}.
          {job.po && staff && <button type="button" disabled={busy} className="font-semibold text-ink-soft hover:text-accent hover:underline" onClick={newPo}>Fee changed? Send a new PO</button>}</p>
      )}
      {declined && (
        <div className="space-y-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          <p className="font-semibold">{declined}</p>
          <p>Declined on {isoDay(job?.poDeclined?.at)}. Their dates are no longer blocked.</p>
          {staff && <button type="button" disabled={busy} className={btnSecondary} onClick={clearDecline}>They agreed after all: clear this</button>}
        </div>
      )}

      {claim && (
        <div className="space-y-2">
          <p className="text-sm">
            <strong>{claim.internal ? 'Photos and T3 sent' : 'Fee requested'}</strong> on {isoDay(claim.submittedAt)}
            {claim.status === 'returned' && <span className="text-attention"> · sent back to the trainer: {claim.returnNote}</span>}
          </p>
          {flag && staff && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">{flag}</p>}
          <div className="flex flex-wrap gap-2">
            {(claim.photos || []).map(f => (
              <a key={f.path} href={f.url} target="_blank" rel="noreferrer" title={f.name}><img src={f.url} alt={f.name} className="h-16 w-16 rounded-lg border border-line object-cover hover:opacity-80" /></a>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {(claim.t3 || []).map(f => (
              <a key={f.path} href={f.url} target="_blank" rel="noreferrer" className={btnSecondary}><FileText className="h-4 w-4" /> T3: {f.name}</a>
            ))}
          </div>
          {staff && claim.status === 'submitted' && <button type="button" disabled={busy} className={btnSecondary} onClick={sendBack}>Ask the trainer to fix something</button>}
        </div>
      )}
      {staff && lines.some(o => isTrainerFee(o) && o.status !== 'rejected') && <FeeChecksBox dealId={deal.id} taskId={task.id} viewer={viewer} />}

      <div>
        {rating ? (
          <div className="space-y-2">
            <div className="flex items-center gap-1" role="radiogroup" aria-label="Rating">
              {STARS.map(i => (
                <button key={i} type="button" role="radio" aria-checked={stars === i} aria-label={`${i} star${i === 1 ? '' : 's'}`} onClick={() => setStars(i)} className="rounded p-0.5 hover:bg-white">
                  <Star className={`h-6 w-6 ${i <= stars ? 'fill-[#E2A400] text-[#E2A400]' : 'text-ink-soft/40'}`} />
                </button>
              ))}
              <span className="ml-2 text-sm font-semibold">{STAR_WORDS[stars]}</span>
            </div>
            <textarea rows={2} value={note} onChange={e => setNote(e.target.value)} className={`${input} resize-y`} placeholder="Comments (the trainer sees these too): client feedback, punctuality, delivery…" aria-label="Rating comments" />
            <div className="flex gap-2">
              <button type="button" className={btnSecondary} onClick={() => setRating(false)}>Cancel</button>
              <button type="button" disabled={busy} className={btnPrimary} onClick={saveRating}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Save rating</button>
            </div>
          </div>
        ) : job?.rating ? (
          <div className="text-sm">
            <p className="flex flex-wrap items-center gap-2"><span className="font-semibold">Rating</span> <Stars n={job.rating.stars} /> {STAR_WORDS[job.rating.stars]} <span className="text-ink-soft">· by {job.rating.byName}, {isoDay(job.rating.at)}</span>
              {staff && <button type="button" className="font-semibold text-accent hover:underline" onClick={startRating}>Change</button>}</p>
            {job.rating.note && <p className="mt-0.5 whitespace-pre-line text-ink-soft">{job.rating.note}</p>}
          </div>
        ) : staff && started ? (
          <button type="button" className={btnSecondary} onClick={startRating}><Star className="h-4 w-4" /> Rate {trainerName} for this training</button>
        ) : staff ? <p className="text-sm text-ink-soft">You can rate {trainerName} once the training starts.</p>
        : <p className="text-sm text-ink-soft">Not rated yet.</p>}
      </div>
      {error && <p role="alert" className={alertBox}>{error}</p>}
    </div>
  );
}

// ---------- Admin work → Money: trainers asking for their fee ----------
export function TrainerFeeRequests({ outs, dealLabel, onOpenDeal }: { outs: MoneyOut[]; dealLabel: (dealId: string) => string; onOpenDeal?: (dealId: string) => void }) {
  const jobs = useTrainerJobs();
  const [trainers, setTrainers] = useState<any[]>([]);
  useEffect(() => onSnapshot(collection(db, 'trainers_directory'), s => setTrainers(s.docs.map(d => ({ ...d.data(), id: d.id }))), () => setTrainers([])), []);
  const waiting = jobs
    .filter(j => j.claim?.status === 'submitted')
    .map(j => {
      const name = trainers.find(t => t.id === j.trainerId)?.name || 'Trainer';
      // Fee lines = cost lines on the deal's Trainer step (the same lines the Trainer step and the work queue use).
      return { j, name, flag: claimFlag(j, outs.filter(o => o.dealId === j.dealId && !!o.checklistTaskId && o.category === 'Trainer'), name) };
    })
    .filter(x => x.flag && dealLabel(x.j.dealId) !== 'Deal no longer exists')
    .sort((a, b) => String(a.j.claim!.submittedAt).localeCompare(String(b.j.claim!.submittedAt)));
  if (!waiting.length) return null;
  return (
    <section className="space-y-2 rounded-xl border border-danger/30 bg-danger-soft/40 p-4">
      <h3 className="font-bold">Trainers asking for their fee ({waiting.length})</h3>
      <p className="text-sm text-ink-soft">Sent from the trainer portal (photos and T3 are optional). Check what they sent on the deal's Trainer step, then approve the fee line as usual.</p>
      <ul className="space-y-1.5">
        {waiting.map(({ j, name, flag }) => (
          <li key={j.id} className="rounded-lg border border-line bg-white px-3 py-2 text-[15px]">
            <strong>{name}</strong> · {dealLabel(j.dealId)}
            <span className="block text-sm text-danger">{flag} (sent {isoDay(j.claim!.submittedAt)})</span>
            {onOpenDeal && <button type="button" className="text-sm font-semibold text-accent hover:underline" onClick={() => onOpenDeal(j.dealId)}>Open the deal</button>}
          </li>
        ))}
      </ul>
    </section>
  );
}
