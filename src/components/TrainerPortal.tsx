import React, { useEffect, useRef, useState } from 'react';
import { initializeApp, getApps } from 'firebase/app';
import { User, getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { sendPortalPasswordEmail } from '../lib/portalEmail';
import { getDownloadURL, getStorage, ref, uploadBytesResumable } from 'firebase/storage';
import {
  BadgeCheck, BookOpen, CalendarCheck, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Copy, Download, Eye, FileText, Home, Image as ImageIcon, Landmark, Loader2, LogOut, MapPin, Menu, Wallet, Star, Upload, User as UserIcon, Users, X,
} from 'lucide-react';
import firebaseConfig from '../../firebase-applet-config.json';
import Logo from './Logo';
import TrainerProfileFields from './TrainerProfileFields';
import TrainerBiodataDocument from './TrainerBiodataDocument';
import { shrink } from './PhotoPicker';
import { sizeText } from './TrainerExtrasFields';
import { ProfileSubmission, cleanProfile, profileProblem } from '../lib/trainerLinks';
import { PROFILE_PARTS, emptyExtras, profileGaps, safeName, trainerFileProblem, trainerFileType } from '../lib/trainerProfile';
import {
  MIN_PORTAL_PASSWORD, PORTAL_PATH, PortalFile, STAR_WORDS, bankProblem, calendarLinks, claimFilesText, claimFolder, cleanBank, cleanEmail, cleanTin, emailProblem, greetName, passwordProblem, portalFolder,
} from '../lib/trainerPortal';
import { formatDateRange, formatRM, daysText } from '../lib/deals';
import { COMPANY } from '../lib/company';
import { TrainingReport, reportGaps, revisionWhen } from '../lib/trainingReport';
import { autoSaveText, leaveAfterSave, useAutoSave } from '../lib/useAutoSave';
import TrainingReportForm, { RevisionList } from './TrainingReportForm';
import DocsTab from './TrainerPortalDocs';

// The trainer portal (Joel, 2026-10-21), at /trainer. A trainer whom Admin or Management gave access logs in with
// their email and password (Firebase's own email + password login; "Forgot password" is Firebase's reset email).
// It uses its own Firebase connection, so a team member logged in to the CRM in the same browser stays logged in.
// Everything goes through the CRM server (serverTrainerPortal.ts); only uploads go straight to the trainer's own
// storage folder (storage.rules: trainer_portal/{trainerId}/).

const portalApp = getApps().find(a => a.name === 'trainer-portal') || initializeApp(firebaseConfig, 'trainer-portal');
const pAuth = getAuth(portalApp);
const pStorage = getStorage(portalApp);
pStorage.maxUploadRetryTime = 60_000;

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const label = 'mb-1 block text-sm font-semibold text-ink';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-[15px] font-semibold text-white hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-surface disabled:opacity-60';
const card = 'rounded-2xl border border-line bg-white p-5';
const alertBox = 'rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger';

class PortalError extends Error { code: string; constructor(code: string, m: string) { super(m); this.code = code; } }

async function token() {
  const u = pAuth.currentUser;
  if (!u) throw new PortalError('not-logged-in', 'You are logged out. Log in again.');
  return u.getIdToken();
}
async function api(path: string, body: any = {}) {
  let res: Response;
  try {
    res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` }, body: JSON.stringify(body) });
  } catch (e: any) {
    if (e instanceof PortalError) throw e;
    throw new PortalError('network', 'No internet connection. Check it and try again.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) throw new PortalError(data?.code || 'server-error', data?.error || 'Something went wrong. Please try again in a minute.');
  return data;
}

function loginError(e: any): string {
  const c = String(e?.code || '');
  if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-login-credentials'].includes(c)) return 'That email or password is not correct.';
  if (c === 'auth/invalid-email') return "That email address doesn't look right.";
  if (c === 'auth/user-disabled') return 'Your portal access is turned off. Contact NEXT Academy if you think this is a mistake.';
  if (c === 'auth/too-many-requests') return 'Too many tries. Wait a few minutes, then try again.';
  if (c === 'auth/network-request-failed') return 'No internet connection. Check it and try again.';
  if (c === 'auth/operation-not-allowed' || c === 'auth/configuration-not-found') return "Trainer login isn't switched on yet. Please let NEXT Academy know.";
  return e?.message || 'Something went wrong. Try again.';
}

async function uploadTo(path: string, data: Blob, type: string, onProgress: (p: number) => void): Promise<string> {
  const r = ref(pStorage, path);
  const task = uploadBytesResumable(r, data, { contentType: type });
  await new Promise<void>((resolve, reject) => task.on('state_changed', s => onProgress(s.totalBytes ? Math.round((s.bytesTransferred / s.totalBytes) * 100) : 0), reject, () => resolve()));
  return getDownloadURL(r);
}
function uploadError(e: any): string {
  const c = String(e?.code || '');
  if (c === 'storage/unauthorized') return "The file couldn't be saved (no permission). Log out and in again; if it keeps happening, let NEXT Academy know.";
  if (c.startsWith('storage/')) return "The file didn't go through. Check your internet and try again.";
  return e?.message || 'The upload failed. Try again.';
}

const shell = (children: React.ReactNode, right?: React.ReactNode, wide = false) => (
  <div className="min-h-screen bg-surface font-sans text-ink">
    <header className="border-b border-line bg-white">
      <div className={`mx-auto flex ${wide ? 'max-w-6xl' : 'max-w-4xl'} items-center justify-between gap-3 px-4 py-3`}><Logo />{right}</div>
    </header>
    <main className={`mx-auto ${wide ? 'max-w-6xl' : 'max-w-4xl'} px-4 py-6`}>{children}</main>
  </div>
);

export default function TrainerPortal({ inviteToken }: { inviteToken?: string }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [invite, setInvite] = useState(inviteToken || '');
  useEffect(() => { document.title = 'NEXT Academy trainer portal'; return onAuthStateChanged(pAuth, setUser); }, []);
  const leaveInvite = () => { setInvite(''); window.history.replaceState(null, '', PORTAL_PATH); };
  if (user === undefined) return shell(<p className="flex items-center gap-2 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>);
  if (invite) return <JoinScreen token={invite} onDone={leaveInvite} />;
  if (!user) return <Landing />;
  return <Portal user={user} />;
}

// ---------- Landing page (Joel, 2026-10-21): what the portal is, and log in ----------
const FEATURES: { icon: React.ReactNode; title: string; text: string }[] = [
  { icon: <CalendarDays className="h-5 w-5" />, title: 'Your trainings', text: 'Upcoming trainings with dates and venue, and your training history with us.' },
  { icon: <FileText className="h-5 w-5" />, title: 'Purchase orders', text: 'Download and accept your PO as soon as a training is confirmed.' },
  { icon: <Upload className="h-5 w-5" />, title: 'Request your fee', text: 'Ask for your fee (photos and T3 optional), and follow your payment until it is paid.' },
  { icon: <UserIcon className="h-5 w-5" />, title: 'Your profile', text: 'Keep your profile, topics and HRDC biodata up to date in one place.' },
  { icon: <Landmark className="h-5 w-5" />, title: 'Payment details', text: 'Your bank account, tax number (TIN) and address, kept safely.' },
  { icon: <Star className="h-5 w-5" />, title: 'Your rating', text: 'See how NEXT Academy rated each training, with comments.' },
  { icon: <BookOpen className="h-5 w-5" />, title: 'Course outlines and teambuilding', text: 'Write your course outlines and teambuilding proposals, preview them, and send them to NEXT Academy.' },
];

function Landing() {
  return (
    <div className="min-h-screen bg-surface font-sans text-ink">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3"><Logo /><a href="#login" className={`${btnSecondary} lg:hidden`}>Log in</a></div>
      </header>
      <main className="mx-auto grid max-w-5xl gap-8 px-4 py-8 lg:grid-cols-[minmax(0,1fr)_24rem] lg:py-12">
        <div className="space-y-6">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-accent">For NEXT Academy trainers</p>
            <h1 className="mt-2 text-3xl font-bold leading-tight sm:text-4xl">Your trainings, PO and payments, all in one place</h1>
            <p className="mt-3 max-w-xl text-[16px] text-ink-soft">The NEXT Academy trainer portal is where you see the trainings you run with us, accept your PO, request your fee and keep your profile up to date.</p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {FEATURES.map(f => (
              <li key={f.title} className="flex gap-3 rounded-2xl border border-line bg-white p-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">{f.icon}</span>
                <span><span className="block font-semibold">{f.title}</span><span className="block text-sm text-ink-soft">{f.text}</span></span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-ink-soft">New here? NEXT Academy sends you an invite link to set up your login. Questions: {COMPANY.phone} · {COMPANY.email}</p>
        </div>
        <div id="login" className="lg:pt-8"><LoginBox /></div>
      </main>
    </div>
  );
}

// ---------- Joining from an invite link (/trainer/join/<token>): email + choose a password ----------
function JoinScreen({ token, onDone }: { token: string; onDone: () => void }) {
  const [info, setInfo] = useState<any>(null);
  const [error, setError] = useState('');
  const [f, setF] = useState({ name: '', email: '', password: '', again: '' });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const post = async (path: string, body: any) => {
    let res: Response;
    try { res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
    catch { throw new Error('No internet connection. Check it and try again.'); }
    const d = await res.json().catch(() => null);
    if (!res.ok || !d?.ok) throw new Error(d?.error || 'Something went wrong. Please try again in a minute.');
    return d;
  };
  useEffect(() => {
    post('/api/portal-invite/get', { token }).then(d => { setInfo(d); setF(x => ({ ...x, name: d.name || '', email: d.email || '' })); }).catch(e => setError(e.message));
  }, [token]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProblem('');
    if (!f.name.trim()) return setProblem('Type your full name.');
    const bad = emailProblem(cleanEmail(f.email)) || passwordProblem(f.password);
    if (bad) return setProblem(bad);
    if (f.password !== f.again) return setProblem("The two passwords aren't the same.");
    setBusy(true);
    try {
      const r = await post('/api/portal-invite/accept', { token, name: f.name, email: f.email, password: f.password });
      try { await signInWithEmailAndPassword(pAuth, r.email, f.password); onDone(); }
      catch (err: any) { setProblem(`Your login is ready. ${loginError(err)}`); }
    } catch (err: any) { setProblem(err.message); } finally { setBusy(false); }
  };
  if (error) return shell(
    <div className={`${card} mx-auto max-w-md space-y-3`}>
      <p className="text-[15px]">{error}</p>
      <button type="button" className={btnSecondary} onClick={onDone}>Go to the trainer portal</button>
    </div>
  );
  if (!info) return shell(<p className="flex items-center gap-2 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading your invite…</p>);
  return shell(
    <form onSubmit={submit} className={`${card} mx-auto max-w-md space-y-4`}>
      <div>
        <h1 className="text-xl font-bold">Welcome{greetName(info.name) ? `, ${greetName(info.name)}` : ''}!</h1>
        <p className="mt-1 text-[15px] text-ink-soft">{info.invitedBy} from NEXT Academy invited you to the trainer portal. Set up your login below; you'll use this email and password from now on.</p>
      </div>
      <div><label className={label} htmlFor="j-name">Full name</label><input id="j-name" autoComplete="name" value={f.name} onChange={e => setF(x => ({ ...x, name: e.target.value }))} className={input} /></div>
      <div><label className={label} htmlFor="j-email">Your email</label><input id="j-email" type="email" autoComplete="email" value={f.email} onChange={e => setF(x => ({ ...x, email: e.target.value }))} className={input} /></div>
      <div><label className={label} htmlFor="j-pw">Choose a password</label><input id="j-pw" type="password" autoComplete="new-password" value={f.password} onChange={e => setF(x => ({ ...x, password: e.target.value }))} className={input} />
        <p className="mt-1 text-sm text-ink-soft">At least {MIN_PORTAL_PASSWORD} characters.</p></div>
      <div><label className={label} htmlFor="j-pw2">Type it again</label><input id="j-pw2" type="password" autoComplete="new-password" value={f.again} onChange={e => setF(x => ({ ...x, again: e.target.value }))} className={input} /></div>
      {problem && <p role="alert" className={alertBox}>{problem}</p>}
      <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Set up my login</button>
      <button type="button" className="w-full text-center text-sm font-semibold text-accent hover:underline" onClick={onDone}>I already have a login</button>
    </form>
  );
}

// ---------- Log in / forgot password ----------
function LoginBox() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'forgot' | 'sent'>('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const em = email.trim();
    if (!em) return setError('Enter your email.');
    setBusy(true);
    try {
      if (mode === 'forgot') { await sendPortalPasswordEmail(pAuth, em); setMode('sent'); }
      else await signInWithEmailAndPassword(pAuth, em, password);
    } catch (err: any) {
      // A reset for an email with no access looks the same as one that worked, so nobody can test which emails have access.
      if (mode === 'forgot' && err?.code === 'auth/user-not-found') setMode('sent');
      else setError(loginError(err));
    } finally { setBusy(false); }
  };
  return (
    <div>
      <form onSubmit={submit} className={`${card} space-y-4 shadow-sm`}>
        <div>
          <h2 className="text-xl font-bold">{mode === 'login' ? 'Log in' : 'Reset your password'}</h2>
          <p className="mt-1 text-[15px] text-ink-soft">{mode === 'login' ? 'With the email and password you set up from your invite.' : mode === 'forgot' ? "Type your email and we'll send you a link to choose a new password." : ''}</p>
        </div>
        {mode === 'sent' ? (
          <>
            <p className="flex items-start gap-2 rounded-lg bg-accent-soft px-3 py-2.5 text-[15px] text-accent"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" /> If {email.trim()} has portal access, a link to choose a new password is on its way. Check your spam folder too.</p>
            <button type="button" className={btnSecondary} onClick={() => { setMode('login'); setPassword(''); }}>Back to log in</button>
          </>
        ) : (
          <>
            <div><label className={label} htmlFor="tp-email">Email</label><input id="tp-email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} className={input} /></div>
            {mode === 'login' && <div><label className={label} htmlFor="tp-pw">Password</label><input id="tp-pw" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} className={input} /></div>}
            {error && <p role="alert" className={alertBox}>{error}</p>}
            <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} {mode === 'login' ? 'Log in' : 'Send me the link'}</button>
            <button type="button" className="w-full text-center text-sm font-semibold text-accent hover:underline" onClick={() => { setError(''); setMode(mode === 'login' ? 'forgot' : 'login'); }}>
              {mode === 'login' ? 'Forgot password?' : 'Back to log in'}
            </button>
          </>
        )}
      </form>
    </div>
  );
}

// ---------- After logging in ----------
type Tab = 'home' | 'trainings' | 'fees' | 'calendar' | 'outlines' | 'teambuilding' | 'profile' | 'payment';
const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'home', label: 'Home', icon: <Home className="h-4 w-4" /> },
  { id: 'trainings', label: 'My trainings', icon: <CalendarDays className="h-4 w-4" /> },
  { id: 'fees', label: 'Fee claims', icon: <Wallet className="h-4 w-4" /> },
  { id: 'calendar', label: 'My calendar', icon: <CalendarCheck className="h-4 w-4" /> },
  { id: 'outlines', label: 'Course outlines', icon: <BookOpen className="h-4 w-4" /> },
  { id: 'teambuilding', label: 'Teambuilding', icon: <Users className="h-4 w-4" /> },
  { id: 'profile', label: 'My profile', icon: <UserIcon className="h-4 w-4" /> },
  { id: 'payment', label: 'Payment details', icon: <Landmark className="h-4 w-4" /> },
];

function Portal({ user }: { user: User }) {
  const [info, setInfo] = useState<any>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('home');
  const [menuOpen, setMenuOpen] = useState(false);
  const [note, setNote] = useState('');
  const load = () => api('/api/portal/me').then(setInfo).catch(e => setError(e.message));
  useEffect(() => { load(); }, [user.uid]);
  const go = (t: Tab) => { setTab(t); setMenuOpen(false); window.scrollTo(0, 0); };
  const passwordEmail = async () => {
    try { await sendPortalPasswordEmail(pAuth, user.email || ''); setNote(`We've emailed ${user.email} a link to choose a new password.`); }
    catch (e: any) { setNote(loginError(e)); }
  };
  const right = (
    <div className="flex items-center gap-2">
      <span className="hidden text-sm text-ink-soft sm:inline">{info?.profile?.name || user.email}</span>
      <button type="button" className={btnSecondary} onClick={() => signOut(pAuth)}><LogOut className="h-4 w-4" /> Log out</button>
    </div>
  );
  if (error) return shell(<div className={`${card} space-y-3`}><p className="text-[15px]">{error}</p><button type="button" className={btnSecondary} onClick={() => signOut(pAuth)}>Log out</button></div>, right);
  if (!info) return shell(<p className="flex items-center gap-2 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading your portal…</p>, right);

  // Side menu like the CRM's (Joel, 2026-10-21); on phones a Menu button opens the same list.
  const menu = (
    <ul className="space-y-0.5">
      {TABS.map(t => (
        <li key={t.id}>
          <button type="button" onClick={() => go(t.id)} aria-current={tab === t.id ? 'page' : undefined}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[15px] font-semibold ${tab === t.id ? 'bg-accent-soft text-accent' : 'text-ink-soft hover:bg-surface'}`}>{t.icon} {t.label}</button>
        </li>
      ))}
    </ul>
  );
  const here = TABS.find(t => t.id === tab);

  return shell(
    <div className="md:flex md:items-start md:gap-6">
      <nav className="mb-4 md:hidden" aria-label="Portal sections">
        <button type="button" onClick={() => setMenuOpen(o => !o)} aria-expanded={menuOpen}
          className="flex w-full items-center justify-between gap-2 rounded-xl border border-line bg-white px-4 py-2.5 text-[15px] font-semibold">
          <span className="flex items-center gap-2 text-accent">{here?.icon} {here?.label}</span>
          <span className="flex items-center gap-1.5 text-ink-soft"><Menu className="h-4 w-4" /> Menu</span>
        </button>
        {menuOpen && <div className="mt-1 rounded-xl border border-line bg-white p-1">{menu}</div>}
      </nav>
      <nav className="sticky top-4 hidden w-56 shrink-0 rounded-xl border border-line bg-white p-2 md:block" aria-label="Portal sections">{menu}</nav>
      <div className="min-w-0 flex-1 space-y-5">
      {note && <p className="flex items-start justify-between gap-2 rounded-lg bg-accent-soft px-3 py-2.5 text-sm text-accent">{note}<button type="button" onClick={() => setNote('')} aria-label="Close"><X className="h-4 w-4" /></button></p>}
      {tab === 'home' && <HomeTab info={info} go={go} onPassword={passwordEmail} />}
      {tab === 'trainings' && <TrainingsTab info={info} reload={load} />}
      {tab === 'calendar' && <CalendarTab info={info} />}
      {(tab === 'outlines' || tab === 'teambuilding') && <DocsTab key={tab} kind={tab === 'outlines' ? 'outline' : 'teambuilding'} info={info} api={api} upload={uploadTo} />}
      {tab === 'profile' && <ProfileTab info={info} reload={load} />}
      {tab === 'fees' && <FeesTab info={info} go={go} />}
      {tab === 'payment' && <PaymentTab info={info} reload={load} />}
      </div>
    </div>,
    right,
    true,
  );
}

const when = (t: any) => (t.start ? `${formatDateRange(t.start, t.end)}${t.days ? ` · ${daysText(t.days)}` : ''}` : 'Date not set yet');
const isoDay = (s: string) => (s ? new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

function Stars({ n, size = 'h-4 w-4' }: { n: number; size?: string }) {
  return (
    <span className="inline-flex items-center" aria-label={`${n} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map(i => <Star key={i} className={`${size} ${i <= n ? 'fill-[#E2A400] text-[#E2A400]' : 'text-line'}`} />)}
    </span>
  );
}

// What the trainer still needs to do, from their trainings and profile.
function todos(info: any) {
  const out: { text: string; tab: Tab }[] = [];
  info.trainings.forEach((t: any) => {
    if (t.cancelled) return;
    if ((t.po.length || t.poAuto) && !t.poAcceptedAt && !t.poDeclined && !t.ended) out.push({ text: `Accept the PO for ${t.programme} (${when(t)})`, tab: 'trainings' });
    const allPaid = t.fee.length > 0 && t.fee.every((f: any) => f.status === 'paid');
    if (t.started && !allPaid && (!t.claim || t.claim.status === 'returned')) out.push({ text: `${t.claim ? 'Fix and resend' : 'Request'} your fee for ${t.programme} (${when(t)})`, tab: 'trainings' });
    if (t.ended && !t.coTrainer && (!t.report || t.report.status === 'draft' || t.report.status === 'returned')) out.push({ text: `${t.report?.status === 'returned' ? 'Fix and resend' : 'Write'} the training report for ${t.programme} (${when(t)})`, tab: 'trainings' });
  });
  if (!info.payment.accountNo && !info.payment.pending) out.push({ text: 'Add your bank details so we can pay you', tab: 'payment' });
  if (!info.payment.tin) out.push({ text: 'Add your tax identification number (TIN)', tab: 'payment' });
  return out;
}

function HomeTab({ info, go, onPassword }: { info: any; go: (t: Tab) => void; onPassword: () => void }) {
  const p = info.profile;
  const pct = Math.round(((PROFILE_PARTS - profileGaps({ ...p, icOnFile: info.icOnFile }).length) / PROFILE_PARTS) * 100);
  const next = info.trainings.filter((t: any) => !t.ended && !t.cancelled)[0];
  const rated = info.trainings.filter((t: any) => t.rating);
  const avg = rated.length ? Math.round((rated.reduce((s: number, t: any) => s + t.rating.stars, 0) / rated.length) * 10) / 10 : 0;
  const list = todos(info);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">Hi {greetName(p.name) || 'there'}</h1>
        <p className="text-[15px] text-ink-soft">Your trainings with NEXT Academy, your profile and your payments, in one place.</p>
      </div>
      <section className={card}>
        <h2 className="font-bold">To do</h2>
        {list.length ? (
          <ul className="mt-2 space-y-1.5">
            {list.map((x, i) => <li key={i}><button type="button" onClick={() => go(x.tab)} className="w-full rounded-lg border border-attention/40 bg-attention-soft/40 px-3 py-2 text-left text-[15px] hover:bg-attention-soft">{x.text}</button></li>)}
          </ul>
        ) : <p className="mt-1 flex items-center gap-2 text-[15px] text-ink-soft"><CheckCircle2 className="h-5 w-5 text-accent" /> Nothing waiting for you. Thank you!</p>}
      </section>
      <div className="grid gap-4 sm:grid-cols-3">
        <button type="button" onClick={() => go('trainings')} className={`${card} text-left hover:border-accent`}>
          <p className="text-sm text-ink-soft">Next training</p>
          {next ? <><p className="mt-1 font-bold">{next.programme}</p><p className="text-sm text-ink-soft">{when(next)}</p></> : <p className="mt-1 font-semibold">None scheduled</p>}
        </button>
        <div className={card}>
          <p className="text-sm text-ink-soft">Your rating</p>
          {rated.length ? <><p className="mt-1 flex items-center gap-2 text-lg font-bold">{avg} <Stars n={Math.round(avg)} /></p><p className="text-sm text-ink-soft">From {rated.length} training{rated.length === 1 ? '' : 's'}</p></> : <p className="mt-1 font-semibold">Not rated yet</p>}
        </div>
        <button type="button" onClick={() => go('profile')} className={`${card} text-left hover:border-accent`}>
          <p className="text-sm text-ink-soft">Your profile</p>
          <p className="mt-1 font-bold">{pct}% complete</p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface"><div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} /></div>
        </button>
      </div>
      <section className={`${card} text-sm text-ink-soft`}>
        <p>Logged in as <strong className="text-ink">{info.email}</strong>. <button type="button" className="font-semibold text-accent hover:underline" onClick={onPassword}>Change my password</button> (we email you a link).</p>
        <p className="mt-1">Questions? NEXT Academy: {COMPANY.phone} · {COMPANY.email}</p>
      </section>
    </div>
  );
}

// ---------- My trainings ----------
function TrainingsTab({ info, reload }: { info: any; reload: () => Promise<any> }) {
  const upcoming = info.trainings.filter((t: any) => !t.ended);
  const past = info.trainings.filter((t: any) => t.ended).reverse();
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold">My trainings</h1>
      <section className="space-y-3">
        <h2 className="font-bold text-ink-soft">Upcoming</h2>
        {upcoming.length ? upcoming.map((t: any) => <TrainingCard key={t.dealId} t={t} reload={reload} trainerId={info.trainerId} />) : <p className={`${card} text-[15px] text-ink-soft`}>No upcoming trainings yet.</p>}
      </section>
      <section className="space-y-3">
        <h2 className="font-bold text-ink-soft">Training history with NEXT Academy</h2>
        {past.length ? past.map((t: any) => <TrainingCard key={t.dealId} t={t} reload={reload} trainerId={info.trainerId} />) : <p className={`${card} text-[15px] text-ink-soft`}>No past trainings yet.</p>}
      </section>
    </div>
  );
}

function TrainingCard({ t, reload, trainerId }: { t: any; reload: () => Promise<any>; trainerId: string }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [reporting, setReporting] = useState(false);
  const run =async (key: string, fn: () => Promise<any>) => {
    setBusy(key); setError('');
    try { await fn(); } catch (e: any) { setError(e.message); } finally { setBusy(''); }
  };
  const downloadPo = (f: any) => run(`po-${f.id}`, async () => {
    const res = await fetch('/api/portal/po', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` }, body: JSON.stringify({ dealId: t.dealId, fileId: f.id }) });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "The PO couldn't be downloaded. Try again.");
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a'); a.href = url; a.download = f.name || 'PO'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  });
  // The PO made automatically (or the copy kept when accepted): the PDF is made here, in the browser.
  const autoPo = t.po.length ? null : t.poAccepted || t.poAuto;
  const downloadAutoPo = () => run('po-auto', async () => {
    const [{ default: TrainerPoDocument }, { makeDocumentPdf }] = await Promise.all([import('./TrainerPoDocument'), import('../lib/quotePdf')]);
    const blob = await makeDocumentPdf(React.createElement(TrainerPoDocument, { po: autoPo }), `PO ${autoPo.number}`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${autoPo.number}.pdf`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  });
  const acceptPo = () => run('accept', async () => { await api('/api/portal/accept-po', { dealId: t.dealId }); await reload(); });
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const declinePo = () => run('decline', async () => {
    if (!reason.trim()) throw new Error('Tell NEXT Academy why, so they can arrange things.');
    await api('/api/portal/decline-po', { dealId: t.dealId, reason: reason.trim() });
    setDeclining(false); await reload();
  });
  const hasPo = t.po.length > 0 || !!autoPo;
  const allPaid = t.fee.length > 0 && t.fee.every((f: any) => f.status === 'paid');

  return (
    <article className={`${card} space-y-4`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-bold">{t.programme}{t.coTrainer && <span className="ml-2 rounded bg-surface px-1.5 py-0.5 align-middle text-xs font-medium text-ink-soft">Co-trainer</span>}</h3>
          {t.client && <p className="text-[15px]">{t.client}</p>}
          <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-soft"><CalendarDays className="h-4 w-4" /> {when(t)}</p>
          {t.movedFrom && !t.cancelled && <p className="text-sm font-semibold text-attention">Date changed (was {isoDay(t.movedFrom)})</p>}
          {t.venue && <p className="flex items-center gap-1.5 text-sm text-ink-soft"><MapPin className="h-4 w-4" /> {t.venue.name}{t.venue.region ? `, ${t.venue.region}` : ''}</p>}
        </div>
        <span className={`rounded-full px-2.5 py-1 text-sm font-semibold ${t.cancelled || t.poDeclined ? 'bg-danger-soft text-danger' : t.confirmed || t.ended ? 'bg-accent-soft text-accent' : 'bg-attention-soft text-ink'}`}>
          {t.cancelled ? 'Cancelled' : t.poDeclined ? 'You declined' : t.ended ? 'Training done' : t.confirmed ? 'Confirmed' : 'Being arranged'}
        </span>
      </div>
      {t.cancelled && <p className={alertBox}>This training was cancelled, so its PO no longer applies. NEXT Academy will contact you about it.</p>}

      {/* PO */}
      <div className="rounded-xl border border-line p-3">
        <p className="text-sm font-semibold">Purchase order (PO)</p>
        {hasPo ? (
          <div className="mt-2 space-y-2">
            <div className="flex flex-wrap gap-2">
              {t.po.map((f: any) => (
                <button key={f.id} type="button" className={btnSecondary} disabled={!!busy} onClick={() => downloadPo(f)}>
                  {busy === `po-${f.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} {f.name}
                </button>
              ))}
              {autoPo && (
                <button type="button" className={btnSecondary} disabled={!!busy} onClick={downloadAutoPo}>
                  {busy === 'po-auto' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} {autoPo.number} (PDF)
                </button>
              )}
            </div>
            {t.poDeclined ? (
              <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">You declined this PO on {isoDay(t.poDeclined.at)}: {t.poDeclined.reason}. NEXT Academy has been told. Changed your mind? Accept it below.</p>
            ) : t.poAcceptedAt ? (
              <p className="flex items-center gap-1.5 text-sm text-accent"><BadgeCheck className="h-4 w-4" /> You accepted this PO on {isoDay(t.poAcceptedAt)}. These dates are blocked in My calendar.</p>
            ) : null}
            {!t.cancelled && !t.poAcceptedAt && !declining && (
              <div className="flex flex-wrap gap-2">
                <button type="button" className={btnPrimary} disabled={!!busy} onClick={acceptPo}>{busy === 'accept' && <Loader2 className="h-4 w-4 animate-spin" />} Accept the PO</button>
                {!t.poDeclined && !t.started && <button type="button" className={btnSecondary} disabled={!!busy} onClick={() => setDeclining(true)}>Decline</button>}
              </div>
            )}
            {!t.cancelled && t.poAcceptedAt && !t.started && !declining && (
              <button type="button" className="text-sm font-semibold text-ink-soft hover:text-danger hover:underline" onClick={() => setDeclining(true)}>Can't do it after all? Decline</button>
            )}
            {declining && (
              <div className="space-y-2 rounded-lg bg-surface p-3">
                <label className={label} htmlFor={`why-${t.dealId}`}>Why can't you take this training?</label>
                <textarea id={`why-${t.dealId}`} className={input} rows={2} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} placeholder="For example: I'm already booked on these dates" />
                <p className="text-sm text-ink-soft">NEXT Academy is told straight away and will arrange another trainer. The dates are freed in your calendar.</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={btnPrimary} disabled={!!busy} onClick={declinePo}>{busy === 'decline' && <Loader2 className="h-4 w-4 animate-spin" />} Decline the PO</button>
                  <button type="button" className={btnSecondary} disabled={!!busy} onClick={() => setDeclining(false)}>Keep it</button>
                </div>
              </div>
            )}
          </div>
        ) : <p className="mt-1 text-sm text-ink-soft">Your PO will appear here once NEXT Academy sets up your fee for this training.</p>}
      </div>

      {/* Fee */}
      <div className="rounded-xl border border-line p-3">
        <p className="text-sm font-semibold">Training fee</p>
        {t.fee.length ? (
          <ul className="mt-1 divide-y divide-line">
            {t.fee.map((f: any) => (
              <li key={f.id} className="flex items-center justify-between gap-3 py-1.5 text-[15px]">
                <span>{f.description || 'Trainer fee'} <span className="block text-sm text-ink-soft">{f.statusText}</span></span>
                <span className="font-semibold tabular-nums">{formatRM(f.amount)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="mt-1 text-sm text-ink-soft">NEXT Academy will set up your fee from the PO.</p>}
        {t.claim?.status === 'submitted' && <p className="mt-2 flex items-center gap-1.5 text-sm text-accent"><CheckCircle2 className="h-4 w-4" /> Fee requested on {isoDay(t.claim.submittedAt)} ({claimFilesText(t.claim.photos, t.claim.t3)}). NEXT Academy is checking it.</p>}
        {t.claim?.status === 'returned' && <p className="mt-2 rounded-lg bg-attention-soft px-3 py-2 text-sm"><strong>Please fix and send again:</strong> {t.claim.returnNote || 'NEXT Academy asked for changes.'}</p>}
        {!allPaid && !t.cancelled && (t.started
          ? !claiming && <button type="button" className={`${t.claim?.status === 'submitted' ? btnSecondary : btnPrimary} mt-3`} onClick={() => setClaiming(true)}>{t.claim?.status === 'returned' ? 'Fix and send again' : t.claim ? 'Change my fee request' : 'Request training fee'}</button>
          : <p className="mt-2 text-sm text-ink-soft">You can request your fee once the training has started.</p>)}
        {claiming && <ClaimForm t={t} trainerId={trainerId} onCancel={() => setClaiming(false)} onDone={async () => { setClaiming(false); await reload(); }} />}
      </div>

      {/* Training report (2026-10-21); a co-trainer's lead trainer writes it (2026-10-22) */}
      {!t.cancelled && !t.coTrainer && (
        <div className="rounded-xl border border-line p-3">
          <p className="text-sm font-semibold">Training report</p>
          {t.report?.status === 'returned' && <p className="mt-2 rounded-lg bg-attention-soft px-3 py-2 text-sm"><strong>Please fix and send again:</strong> {t.report.returnNote || 'NEXT Academy asked for changes.'}</p>}
          {t.report && t.report.status !== 'returned' && (
            <p className={`mt-1 flex items-center gap-1.5 text-sm ${t.report.status === 'draft' ? 'text-ink-soft' : 'text-accent'}`}>
              {t.report.status !== 'draft' && <CheckCircle2 className="h-4 w-4" />}
              {t.report.status === 'draft' ? 'Started, not sent yet.' : t.report.status === 'checked' ? 'Checked by NEXT Academy. Thank you! You can still change it.' : `Sent on ${isoDay(t.report.submittedAt)}. NEXT Academy is checking it.`}
            </p>
          )}
          {t.started
            ? <button type="button" className={`${!t.report || t.report.status === 'draft' || t.report.status === 'returned' ? btnPrimary : btnSecondary} mt-3`} onClick={() => setReporting(true)}>
                {!t.report ? 'Write the training report' : t.report.status === 'returned' ? 'Fix and send again' : t.report.status === 'draft' ? 'Continue the report' : 'Change my report'}
              </button>
            : <p className="mt-1 text-sm text-ink-soft">You can write the report once the training has started.</p>}
        </div>
      )}
      {reporting && <ReportEditor t={t} trainerId={trainerId} onClose={async () => { setReporting(false); await reload(); }} />}

      {/* Rating */}
      {t.rating && (
        <div className="rounded-xl border border-line p-3">
          <p className="text-sm font-semibold">NEXT Academy's rating</p>
          <p className="mt-1 flex items-center gap-2"><Stars n={t.rating.stars} /> <span className="text-sm font-semibold">{STAR_WORDS[t.rating.stars]}</span></p>
          {t.rating.note && <p className="mt-1 whitespace-pre-line text-[15px]">{t.rating.note}</p>}
        </div>
      )}
      {error && <p role="alert" className={alertBox}>{error}</p>}
    </article>
  );
}

// ---------- My calendar (2026-10-21) ----------
// Dates blocked for NEXT Academy: every training on My trainings, except a PO the trainer declined. "Link to my
// calendar" gives a private address that Google, Outlook or Apple calendar reads by itself every few hours.
const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function CalendarTab({ info }: { info: any }) {
  const blocked = info.trainings.filter((t: any) => t.start && !t.poDeclined && !t.cancelled);
  const today = isoOf(new Date());
  const firstUpcoming = blocked.find((t: any) => (t.end || t.start) >= today)?.start || today;
  const [month, setMonth] = useState(() => new Date(Number(firstUpcoming.slice(0, 4)), Number(firstUpcoming.slice(5, 7)) - 1, 1));
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7;   // Monday first
  const daysIn = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => isoOf(new Date(month.getFullYear(), month.getMonth(), i + 1)))];
  const on = (iso: string) => blocked.filter((t: any) => iso >= t.start && iso <= (t.end || t.start));
  const monthKey = isoOf(first).slice(0, 7);
  const inMonth = blocked.filter((t: any) => t.start.slice(0, 7) <= monthKey && (t.end || t.start).slice(0, 7) >= monthKey);
  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">My calendar</h1>
        <p className="text-[15px] text-ink-soft">Your dates booked for NEXT Academy trainings. They're blocked as soon as a training is on your list.</p>
      </div>
      <section className={card}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <button type="button" className={btnSecondary} onClick={() => shift(-1)} aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></button>
          <h2 className="font-bold">{first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</h2>
          <button type="button" className={btnSecondary} onClick={() => shift(1)} aria-label="Next month"><ChevronRight className="h-4 w-4" /></button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center">
          {WEEKDAYS.map(d => <div key={d} className="pb-1 text-xs font-semibold text-ink-soft">{d}</div>)}
          {cells.map((iso, i) => {
            if (!iso) return <div key={`x${i}`} />;
            const here = on(iso);
            const confirmed = here.some((t: any) => t.confirmed);
            return (
              <div key={iso} title={here.map((t: any) => t.programme).join(', ')}
                className={`flex aspect-square flex-col items-center justify-center rounded-lg text-sm ${here.length ? (confirmed ? 'bg-accent font-bold text-white' : 'bg-attention-soft font-bold text-ink') : 'text-ink'} ${iso === today ? 'ring-2 ring-ink/40' : ''}`}>
                {Number(iso.slice(8))}
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-sm text-ink-soft">
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-accent" /> Confirmed</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-attention-soft ring-1 ring-attention/40" /> Being arranged</span>
        </div>
        {inMonth.length > 0 && (
          <ul className="mt-4 divide-y divide-line border-t border-line">
            {inMonth.map((t: any) => (
              <li key={t.dealId} className="py-2 text-[15px]">
                <span className="font-semibold">{t.programme}</span>{t.client ? ` · ${t.client}` : ''}
                <span className="block text-sm text-ink-soft">{when(t)}{t.venue ? ` · ${t.venue.name}` : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <CalendarLinkBox />
    </div>
  );
}

function CalendarLinkBox() {
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const get = async (fresh = false) => {
    if (fresh && !window.confirm('Make a new link? The old link stops working, so you will need to add the new one to your calendar again.')) return;
    setBusy(true); setError('');
    try { setPath((await api('/api/portal/calendar-link', { fresh })).path); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const url = path ? `${window.location.origin}${path}` : '';
  const links = url ? calendarLinks(url) : null;
  const copy = async () => { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setError('Copy didn\'t work. Select the link and copy it.'); } };
  return (
    <section className={`${card} space-y-3`}>
      <div>
        <h2 className="font-bold">Link to my own calendar</h2>
        <p className="text-[15px] text-ink-soft">Show your NEXT Academy trainings in Google Calendar, Outlook or your iPhone calendar. It updates by itself (your calendar app checks every few hours), so new or changed trainings appear without doing anything.</p>
      </div>
      {!links ? (
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => get()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarCheck className="h-4 w-4" />} Link to my calendar</button>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <a className={btnSecondary} href={links.google} target="_blank" rel="noreferrer">Add to Google Calendar</a>
            <a className={btnSecondary} href={links.outlook} target="_blank" rel="noreferrer">Add to Outlook</a>
            <a className={btnSecondary} href={links.apple}>Add to Apple / iPhone calendar</a>
          </div>
          <div>
            <p className="mb-1 text-sm text-ink-soft">Other calendar apps: subscribe to this address ("add calendar from URL").</p>
            <div className="flex gap-2">
              <input readOnly value={url} className={`${input} text-sm`} onFocus={e => e.currentTarget.select()} aria-label="Your calendar link" />
              <button type="button" className={btnSecondary} onClick={copy}><Copy className="h-4 w-4" /> {copied ? 'Copied' : 'Copy'}</button>
            </div>
          </div>
          <p className="text-sm text-ink-soft">Keep this link private: anyone with it can see your training dates. <button type="button" className="font-semibold text-accent hover:underline" disabled={busy} onClick={() => get(true)}>Make a new link</button> if you shared it by mistake.</p>
        </div>
      )}
      {error && <p role="alert" className={alertBox}>{error}</p>}
    </section>
  );
}

// Request training fee: training photos and the T3 form, both optional (Joel, 2026-10-21; the training report comes later).
function ClaimForm({ t, trainerId, onCancel, onDone }: { t: any; trainerId: string; onCancel: () => void; onDone: () => void }) {
  const [photos, setPhotos] = useState<PortalFile[]>(t.claim?.photos || []);
  const [t3, setT3] = useState<PortalFile[]>(t.claim?.t3 || []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const send = async () => {
    setError('');
    setBusy(true);
    try { await api('/api/portal/claim', { dealId: t.dealId, photos, t3 }); onDone(); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const folder = claimFolder(trainerId, t.dealId);
  return (
    <div className="mt-3 space-y-4 rounded-xl bg-surface p-4">
      <p className="text-[15px]">Ask for your fee. Training photos and the signed T3 attendance form help us, but they are optional. Your fee is then approved and paid by NEXT Academy as per your PO.</p>
      <FileDrop title="Training photos (optional)" hint="Photos of the training (JPG or PNG)." photo folder={folder} kind="photo" files={photos} setFiles={setPhotos} />
      <FileDrop title="T3 attendance form (optional)" hint="The signed T3 form (PDF, JPG or PNG; a clear phone photo is fine)." folder={folder} kind="t3" files={t3} setFiles={setT3} />
      {error && <p role="alert" className={alertBox}>{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel}>Cancel</button>
        <button type="button" className={btnPrimary} disabled={busy} onClick={send}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Send to NEXT Academy</button>
      </div>
    </div>
  );
}

// The training report (2026-10-21; lib/trainingReport.ts), full screen. It saves itself as a draft as the trainer
// types (useAutoSave); "Send to NEXT Academy" sends it to be checked. After sending they can still change it
// (2026-10-21): their typing is kept aside until they click "Send changes", which records what changed.
function ReportEditor({ t, trainerId, onClose }: { t: any; trainerId: string; onClose: () => void }) {
  const [report, setReport] = useState<TrainingReport | null>(null);
  const [extra, setExtra] = useState<{ names: string[]; pax: number; programmes: { id: string; name: string }[] }>({ names: [], pax: 0, programmes: [] });
  const [savedJson, setSavedJson] = useState('');
  const [pending, setPending] = useState(false);   // changes kept aside, not sent yet
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  useEffect(() => {
    api('/api/portal/report/get', { dealId: t.dealId })
      .then(d => { setReport(d.report); setSavedJson(JSON.stringify(d.report)); setPending(!!d.pending); setExtra({ names: d.names || [], pax: Number(d.pax) || 0, programmes: d.programmes || [] }); })
      .catch(e => setError(e.message));
  }, [t.dealId]);
  const sentBefore = !!report?.submittedAt;
  const json = report ? JSON.stringify(report) : '';
  const { state, flush } = useAutoSave({
    value: report, dirty: !!report && json !== savedJson, enabled: !!report,
    write: async v => { const d = await api('/api/portal/report/save', { dealId: t.dealId, report: v }); if (d?.pending) setPending(true); }, onSaved: setSavedJson,
  });
  const close = () => leaveAfterSave(flush, onClose);
  const send = async () => {
    if (!report) return;
    setError('');
    const gaps = reportGaps(report);
    if (gaps.length) { setError(`Please fill in: ${gaps.join(', ')}.`); return; }
    setSending(true);
    try {
      const d = await api('/api/portal/report/save', { dealId: t.dealId, report, submit: true });
      setSavedJson(json);
      if (d?.nothing) { setPending(false); setError('Nothing has changed since you sent it.'); return; }
      onClose();
    } catch (e: any) { setError(e.message); } finally { setSending(false); }
  };
  const setPhotos: React.Dispatch<React.SetStateAction<PortalFile[]>> = fn =>
    setReport(r => (r ? { ...r, photos: typeof fn === 'function' ? fn(r.photos as PortalFile[]) : fn } : r));
  const line = autoSaveText(state, !!report && json !== savedJson, false);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-surface" role="dialog" aria-modal="true" aria-label="Training report">
      <header className="sticky top-0 z-10 border-b border-line bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate font-bold">Training report · {t.programme}</p>
            <p className="truncate text-sm text-ink-soft">{[t.client, when(t)].filter(Boolean).join(' · ')}</p>
          </div>
          <button type="button" className={btnSecondary} onClick={close}><X className="h-4 w-4" /> Close</button>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-5 pb-28">
        {!report && !error && <p className="flex items-center gap-2 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
        {report?.status === 'returned' && <p className="rounded-lg bg-attention-soft px-3 py-2.5 text-sm"><strong>NEXT Academy asked for changes:</strong> {report.returnNote || 'Please check the report and send it again.'}</p>}
        {sentBefore && report?.status !== 'returned' && (
          <p className="rounded-lg bg-accent-soft px-3 py-2.5 text-sm text-ink">
            {report?.status === 'checked' ? 'NEXT Academy has checked this report.' : `You sent this on ${revisionWhen(report?.submittedAt || '')}.`} You can still change it: your changes are kept as you type, and NEXT Academy sees them once you click <strong>Send changes</strong>{report?.status === 'checked' ? ' (they will check it again)' : ''}.
          </p>
        )}
        {pending && <p className="rounded-lg bg-attention-soft px-3 py-2.5 text-sm">You have changes that are not sent yet.</p>}
        {report && (
          <TrainingReportForm value={report} onChange={setReport} names={extra.names} pax={extra.pax} programmes={extra.programmes}
            photos={<FileDrop title="Photos" hint="JPG or PNG. Photos are made smaller before they upload." photo folder={claimFolder(trainerId, t.dealId)} kind="report" files={report.photos as PortalFile[]} setFiles={setPhotos} />} />
        )}
        {report?.revisions?.length ? <RevisionList revisions={report.revisions} title="Your changes after sending" /> : null}
        {error && <p role="alert" className={alertBox}>{error}</p>}
      </main>
      {report && (
        <div className="fixed inset-x-0 bottom-0 border-t border-line bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 px-4 py-3">
            <span className={`text-sm ${line.tone === 'danger' ? 'text-danger' : line.tone === 'attention' ? 'text-attention' : 'text-ink-soft'}`}>{line.text}</span>
            <button type="button" className={btnPrimary} disabled={sending} onClick={send}>{sending && <Loader2 className="h-4 w-4 animate-spin" />} {!sentBefore ? 'Send to NEXT Academy' : report.status === 'returned' ? 'Send again' : 'Send changes'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function FileDrop({ title, hint, photo, folder, kind, files, setFiles }: {
  title: string; hint: string; photo?: boolean; folder: string; kind: string; files: PortalFile[]; setFiles: React.Dispatch<React.SetStateAction<PortalFile[]>>;
}) {
  const pick = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [over, setOver] = useState(false);
  const add = async (list: FileList | null) => {
    if (!list?.length) return;
    setError('');
    for (const f of Array.from(list)) {
      try {
        setProgress(0);
        let blob: Blob = f, type = trainerFileType(f.name), name = safeName(f.name);
        if (photo || /^image\//.test(f.type)) {
          if (!/^image\//.test(f.type) && !/\.(jpe?g|png|webp|heic)$/i.test(f.name)) throw new Error(`"${f.name}" isn't a photo.`);
          blob = await shrink(f); type = 'image/jpeg'; name = safeName(f.name.replace(/\.[^.]+$/, '') + '.jpg');
        } else {
          const p = trainerFileProblem(f.name, f.size);
          if (p) throw new Error(p);
        }
        const path = `${folder}${kind}_${Date.now()}_${name}`;
        const url = await uploadTo(path, blob, type, setProgress);
        setFiles(cur => [...cur, { name: f.name.slice(0, 200), size: blob.size, type, path, url, at: Date.now() }]);
      } catch (e: any) { setError(e?.code ? uploadError(e) : String(e?.message || e)); }
    }
    setProgress(null);
  };
  return (
    <div>
      <p className={label}>{title}</p>
      <p className="mb-2 text-sm text-ink-soft">{hint}</p>
      {files.length > 0 && (
        <ul className="mb-2 grid gap-2 sm:grid-cols-2">
          {files.map(f => (
            <li key={f.path} className="flex items-center gap-2 rounded-lg border border-line bg-white p-2 text-sm">
              {/^image\//.test(f.type) ? <img src={f.url} alt="" className="h-10 w-10 shrink-0 rounded object-cover" /> : <FileText className="h-5 w-5 shrink-0 text-ink-soft" />}
              <a href={f.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-medium hover:underline">{f.name}</a>
              <span className="shrink-0 text-ink-soft">{sizeText(f.size)}</span>
              <button type="button" className="rounded p-1 text-ink-soft hover:bg-surface hover:text-danger" aria-label={`Remove ${f.name}`} onClick={() => setFiles(cur => cur.filter(x => x.path !== f.path))}><X className="h-4 w-4" /></button>
            </li>
          ))}
        </ul>
      )}
      <div role="button" tabIndex={0} onClick={() => pick.current?.click()} onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && pick.current?.click()}
        onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={e => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}
        className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-5 text-[15px] ${over ? 'border-accent bg-accent-soft' : 'border-line bg-white hover:border-accent'}`}>
        {progress !== null ? <><Loader2 className="h-4 w-4 animate-spin" /> Uploading… {progress}%</> : <>{photo ? <ImageIcon className="h-5 w-5 text-ink-soft" /> : <Upload className="h-5 w-5 text-ink-soft" />} Drop {photo ? 'photos' : 'the file'} here, or click to choose</>}
      </div>
      <input ref={pick} type="file" multiple className="hidden" accept={photo ? 'image/*' : '.pdf,.jpg,.jpeg,.png'} onChange={e => { add(e.target.files); e.target.value = ''; }} />
      {error && <p role="alert" className={`${alertBox} mt-2`}>{error}</p>}
    </div>
  );
}

// ---------- My profile ----------
function ProfileTab({ info, reload }: { info: any; reload: () => Promise<any> }) {
  const ids = info.programmes.map((p: any) => p.id);
  const [profile, setProfile] = useState<ProfileSubmission>(() => ({
    ...emptyExtras(), ...cleanProfile({}, ids, ''), ...info.profile, icNumber: '',
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [preview, setPreview] = useState(false);
  const pct = Math.round(((PROFILE_PARTS - profileGaps({ ...profile, icOnFile: info.icOnFile }).length) / PROFILE_PARTS) * 100);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setSaved(false);
    const p = profileProblem(profile);
    if (p) return setError(p);
    setBusy(true);
    try { await api('/api/portal/profile', { data: profile }); setSaved(true); setProfile(x => ({ ...x, icNumber: '' })); await reload(); }
    catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };
  const extrasProps = {
    value: profile,
    onChange: (p: any) => setProfile(cur => ({ ...cur, ...(typeof p === 'function' ? p(cur) : p) })),
    uploader: { prefix: portalFolder(info.trainerId), byName: profile.name.trim() || 'Trainer', store: pStorage },
    ic: {
      value: profile.icNumber || '',
      onChange: (v: string) => setProfile(p => ({ ...p, icNumber: v })),
      note: info.icOnFile
        ? 'We already have your IC / passport number. Type it again only if it has changed. Only NEXT Academy Admin and Management can see it.'
        : 'Kept private: only NEXT Academy Admin and Management can see it.',
    },
    idPrefix: 'p',
    wrap: (title: string, children: React.ReactNode, hint?: string) => (
      <section className={`space-y-3 ${card}`}>
        <div><h2 className="font-bold">{title}</h2>{hint && <p className="text-sm text-ink-soft">{hint}</p>}</div>
        {children}
      </section>
    ),
  };
  return (
    <form onSubmit={save} className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">My profile</h1>
        <p className="text-[15px] text-ink-soft">Your trainer profile, the programmes and topics you teach, and your HRDC biodata. Changes save straight to NEXT Academy's records.</p>
        <div className={`mt-3 ${card} p-4`}>
          <p className="text-sm font-semibold">Your profile is {pct}% complete</p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} /></div>
        </div>
      </div>
      <TrainerProfileFields profile={profile} setProfile={setProfile} programmes={info.programmes} extrasProps={extrasProps} />
      {error && <p role="alert" className={alertBox}>{error}</p>}
      {saved && <p className="flex items-center gap-2 rounded-lg bg-accent-soft px-3 py-2.5 text-sm text-accent"><CheckCircle2 className="h-4 w-4" /> Saved. Thank you!</p>}
      <div className="sticky bottom-0 -mx-4 flex flex-wrap justify-end gap-2 border-t border-line bg-surface/95 px-4 py-3">
        <button type="button" className={btnSecondary} onClick={() => setPreview(true)}><Eye className="h-4 w-4" /> Preview HRDC biodata</button>
        <button type="submit" disabled={busy} className={btnPrimary}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Save my profile</button>
      </div>
      {preview && (
        <div className="fixed inset-0 z-50 flex flex-col bg-ink/50" role="dialog" aria-modal="true" aria-label="Preview of your HRDC biodata" onClick={() => setPreview(false)}>
          <div className="flex items-center justify-between gap-3 bg-white px-4 py-3 shadow" onClick={e => e.stopPropagation()}>
            <p className="text-[15px] font-semibold">Preview: your HRDC trainer biodata</p>
            <button type="button" className={btnSecondary} onClick={() => setPreview(false)}><X className="h-4 w-4" /> Close</button>
          </div>
          <div className="flex-1 overflow-auto p-4" onClick={e => e.stopPropagation()} onContextMenu={e => e.preventDefault()}>
            <div className="mx-auto max-w-[900px] overflow-x-auto rounded-lg shadow-lg"><div className="min-w-[640px]">
              <TrainerBiodataDocument t={profile} icHidden={!profile.icNumber && !!info.icOnFile} />
            </div></div>
          </div>
        </div>
      )}
    </form>
  );
}

// ---------- Payment details: bank (checked by NEXT Academy first), TIN, address ----------
// Fee claims (Joel, 2026-10-21): every fee line across the trainer's trainings. Paid so far, pending
// (waiting for approval, or approved and not paid yet), and the total of both. Not approved lines are left out.
function FeesTab({ info, go }: { info: any; go: (t: Tab) => void }) {
  const rows = (info.trainings as any[]).flatMap(t => t.fee.filter((f: any) => f.status !== 'rejected').map((f: any) => ({ ...f, t })));
  const paid = rows.filter(r => r.status === 'paid').sort((a, b) => (b.paidDate || b.t.start || '').localeCompare(a.paidDate || a.t.start || ''));
  const pending = rows.filter(r => r.status !== 'paid');
  const sum = (list: any[]) => list.reduce((n, r) => n + r.amount, 0);
  const box = (label: string, amount: number, note: string, accent = false) => (
    <div className="rounded-2xl border border-line bg-white p-4">
      <p className="text-sm text-ink-soft">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${accent ? 'text-accent' : ''}`}>{formatRM(amount)}</p>
      <p className="mt-0.5 text-sm text-ink-soft">{note}</p>
    </div>
  );
  const list = (items: any[], empty: string) => items.length ? (
    <ul className="divide-y divide-line">
      {items.map(r => (
        <li key={`${r.t.dealId}-${r.id}`} className="flex items-start justify-between gap-3 py-2.5">
          <span className="min-w-0 text-[15px]">
            <span className="font-semibold">{r.t.programme}</span>{r.t.client ? ` · ${r.t.client}` : ''}
            <span className="block text-sm text-ink-soft">{when(r.t)} · {r.description || 'Trainer fee'}</span>
            <span className={`block text-sm ${r.status === 'paid' ? 'text-accent' : 'text-ink-soft'}`}>{r.statusText}</span>
          </span>
          <span className="shrink-0 font-semibold tabular-nums">{formatRM(r.amount)}</span>
        </li>
      ))}
    </ul>
  ) : <p className="text-[15px] text-ink-soft">{empty}</p>;
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        {box('Paid so far', sum(paid), `${paid.length} payment${paid.length === 1 ? '' : 's'}`, true)}
        {box('Pending', sum(pending), `${pending.length} fee${pending.length === 1 ? '' : 's'} not paid yet`)}
        {box('Total', sum(paid) + sum(pending), 'Paid and pending')}
      </div>
      <section className={card}>
        <h2 className="text-lg font-bold">Pending</h2>
        <p className="mb-2 text-sm text-ink-soft">Fees waiting for approval, or approved and being paid. To request a fee, open <button type="button" className="font-semibold text-accent underline" onClick={() => go('trainings')}>My trainings</button>.</p>
        {list(pending, 'Nothing pending.')}
      </section>
      <section className={card}>
        <h2 className="mb-2 text-lg font-bold">Past payments</h2>
        {list(paid, 'No payments yet.')}
      </section>
    </div>
  );
}

function PaymentTab({ info, reload }: { info: any; reload: () => Promise<any> }) {
  const pay = info.payment;
  const start = pay.pending || pay;
  const [bank, setBank] = useState({ bankName: start.bankName || '', accountNo: start.accountNo || '', accountName: start.accountName || '' });
  const [tin, setTin] = useState(pay.tin || '');
  const [address, setAddress] = useState(info.profile.address || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setDone('');
    const b = cleanBank(bank);
    if ((b.bankName || b.accountNo || b.accountName)) { const p = bankProblem(b); if (p) return setError(p); }
    setBusy(true);
    try {
      const r = await api('/api/portal/payment', { bank: b, tin: cleanTin(tin), address });
      setDone(r.bankPending ? 'Saved. Your new bank account is with NEXT Academy for checking; we pay into it once it is approved.' : 'Saved. Thank you!');
      await reload();
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={save} className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">Payment details</h1>
        <p className="text-[15px] text-ink-soft">Where we pay your training fees. For your safety, a new or changed bank account is checked by NEXT Academy before we use it.</p>
      </div>
      <section className={`${card} space-y-3`}>
        <h2 className="font-bold">Bank account</h2>
        {pay.accountNo && <p className="rounded-lg bg-surface px-3 py-2 text-sm"><span className="font-semibold">On record:</span> {[pay.bankName, pay.accountNo, pay.accountName].filter(Boolean).join(' · ')}</p>}
        {pay.pending && <p className="rounded-lg bg-attention-soft px-3 py-2 text-sm"><span className="font-semibold">Waiting for NEXT Academy to check:</span> {[pay.pending.bankName, pay.pending.accountNo, pay.pending.accountName].join(' · ')}</p>}
        {pay.rejected && !pay.pending && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">Your last bank change wasn't accepted{pay.rejected.reason ? `: ${pay.rejected.reason}` : '.'} Please check it and send it again.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className={label} htmlFor="b-bank">Bank</label><input id="b-bank" value={bank.bankName} onChange={e => setBank(b => ({ ...b, bankName: e.target.value }))} className={input} placeholder="e.g. Maybank" /></div>
          <div><label className={label} htmlFor="b-no">Account number</label><input id="b-no" inputMode="numeric" value={bank.accountNo} onChange={e => setBank(b => ({ ...b, accountNo: e.target.value }))} className={input} /></div>
        </div>
        <div><label className={label} htmlFor="b-name">Name on the account</label><input id="b-name" value={bank.accountName} onChange={e => setBank(b => ({ ...b, accountName: e.target.value }))} className={input} placeholder="As printed on your bank statement" /></div>
      </section>
      <section className={`${card} space-y-3`}>
        <h2 className="font-bold">Tax and address</h2>
        <div><label className={label} htmlFor="b-tin">Tax identification number (TIN)</label><input id="b-tin" value={tin} onChange={e => setTin(e.target.value)} className={input} placeholder="e.g. IG12345678090" />
          <p className="mt-1 text-sm text-ink-soft">Your LHDN income tax number, used for e-invoicing.</p></div>
        <div><label className={label} htmlFor="b-addr">Address</label><textarea id="b-addr" rows={3} value={address} onChange={e => setAddress(e.target.value)} className={`${input} resize-y`} />
          <p className="mt-1 text-sm text-ink-soft">The same address as on your profile.</p></div>
      </section>
      {error && <p role="alert" className={alertBox}>{error}</p>}
      {done && <p className="flex items-center gap-2 rounded-lg bg-accent-soft px-3 py-2.5 text-sm text-accent"><CheckCircle2 className="h-4 w-4 shrink-0" /> {done}</p>}
      <div className="flex justify-end"><button type="submit" disabled={busy} className={btnPrimary}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Save payment details</button></div>
    </form>
  );
}
