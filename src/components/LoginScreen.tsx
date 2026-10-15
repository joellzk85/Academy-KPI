import React, { useMemo, useState } from 'react';
import { ChevronDown, Eye, EyeOff, Loader2, LogOut, ShieldCheck } from 'lucide-react';
import { signInWithCustomToken, signOut } from 'firebase/auth';
import { auth, callServer, friendlyError } from '../lib/firebase';
import { TeamMember, ROLE_LABELS } from '../types';
import Logo from './Logo';

// Remembers the password typed at login (in memory only, never saved) so a
// person who must change a temporary password isn't asked for it twice.
let passwordTypedAtLogin = '';

const LAST_NAME_KEY = 'next_last_login_member';

const inputClass =
  'w-full rounded-lg border border-line bg-white px-3.5 py-2.5 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const labelClass = 'mb-1.5 block text-sm font-semibold text-ink';
const primaryBtn =
  'inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-[15px] font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:cursor-not-allowed disabled:opacity-60';

function Shell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="mb-6 flex justify-center">
          <Logo className="h-12 w-auto object-contain" />
        </div>
        <div className="rounded-2xl border border-line bg-white p-7 shadow-[0_1px_2px_rgba(28,43,69,0.06)]">
          <h1 className="text-xl font-bold text-ink">{title}</h1>
          {subtitle && <p className="mt-1.5 text-[15px] leading-relaxed text-ink-soft">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  );
}

function PasswordInput({
  value,
  onChange,
  placeholder,
  autoFocus,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  id: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={`${inputClass} pr-11`}
        autoComplete="current-password"
      />
      <button
        type="button"
        onClick={() => setShow(s => !s)}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-ink-soft hover:text-ink"
        aria-label={show ? 'Hide password' : 'Show password'}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function ErrorNote({ text }: { text: string }) {
  if (!text) return null;
  return (
    <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm leading-relaxed text-danger">
      {text}
    </p>
  );
}

export function LoadingScreen({ message = 'Loading the CRM…' }: { message?: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-surface text-ink-soft">
      <Loader2 className="h-6 w-6 animate-spin text-accent" />
      <p className="text-[15px]">{message}</p>
    </div>
  );
}

// ---------- First-time setup: create the first Management account ----------
export function SetupScreen() {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) return setError('Enter your name.');
    if (password.length < 6) return setError('Passwords need at least 6 characters.');
    if (password !== confirm) return setError('The two passwords do not match.');

    setBusy(true);
    try {
      const { token, memberId } = await callServer<{ token: string; memberId: string }>('/api/auth/setup', {
        name: name.trim(),
        password,
      });
      localStorage.setItem(LAST_NAME_KEY, memberId);
      await signInWithCustomToken(auth, token);
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  };

  return (
    <Shell
      title="Set up the CRM"
      subtitle="This is a one-time step. Create the first Management account, then add everyone else from Management → Team."
    >
      <form onSubmit={handleCreate} className="space-y-4">
        <div>
          <label htmlFor="setup-name" className={labelClass}>Your name</label>
          <input id="setup-name" value={name} onChange={e => setName(e.target.value)} className={inputClass} placeholder="e.g. Joel" autoFocus />
        </div>
        <div>
          <label htmlFor="setup-pw" className={labelClass}>Password</label>
          <PasswordInput id="setup-pw" value={password} onChange={setPassword} placeholder="At least 6 characters" />
        </div>
        <div>
          <label htmlFor="setup-pw2" className={labelClass}>Type the password again</label>
          <PasswordInput id="setup-pw2" value={confirm} onChange={setConfirm} />
        </div>
        <ErrorNote text={error} />
        <button type="submit" disabled={busy} className={primaryBtn}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Create Management account
        </button>
      </form>
    </Shell>
  );
}

// ---------- Everyday login: pick your name, type your password ----------
export function LoginForm({ members }: { members: TeamMember[] }) {
  const active = useMemo(
    () => members.filter(m => m.active).sort((a, b) => a.name.localeCompare(b.name)),
    [members]
  );
  const [memberId, setMemberId] = useState(() => {
    const last = localStorage.getItem(LAST_NAME_KEY) || '';
    return active.some(m => m.id === last) ? last : '';
  });
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const member = active.find(m => m.id === memberId);
    if (!member) return setError('Choose your name from the list.');
    if (!password) return setError('Enter your password.');
    setBusy(true);
    try {
      const { token } = await callServer<{ token: string }>('/api/auth/login', { memberId: member.id, password });
      await signInWithCustomToken(auth, token);
      passwordTypedAtLogin = password;
      localStorage.setItem(LAST_NAME_KEY, member.id);
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  };

  return (
    <Shell title="Log in" subtitle="Choose your name and enter your password.">
      <form onSubmit={handleLogin} className="space-y-4">
        <div>
          <label htmlFor="login-name" className={labelClass}>Your name</label>
          <div className="relative">
            <select
              id="login-name"
              value={memberId}
              onChange={e => { setMemberId(e.target.value); setError(''); }}
              className={`${inputClass} appearance-none pr-10`}
            >
              <option value="">Select your name</option>
              {active.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name} ({ROLE_LABELS[m.role]})
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
          </div>
        </div>
        <div>
          <label htmlFor="login-pw" className={labelClass}>Password</label>
          <PasswordInput id="login-pw" value={password} onChange={v => { setPassword(v); setError(''); }} autoFocus={!!memberId} />
        </div>
        <ErrorNote text={error} />
        <button type="submit" disabled={busy} className={primaryBtn}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Log in
        </button>
        <p className="text-center text-sm text-ink-soft">Forgot your password? Ask Management to reset it.</p>
      </form>
    </Shell>
  );
}

// ---------- Change password (forced after a reset, or anytime from the menu) ----------
export function ChangePasswordForm({
  member,
  onDone,
  onCancel,
}: {
  member: TeamMember;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const knowsCurrent = member.mustChangePassword && !!passwordTypedAtLogin;
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const currentPw = knowsCurrent ? passwordTypedAtLogin : current;
    if (!currentPw) return setError('Enter your current password.');
    if (next.length < 6) return setError('New passwords need at least 6 characters.');
    if (next !== confirm) return setError('The two new passwords do not match.');
    if (next === currentPw) return setError('Choose a password that is different from the current one.');
    setBusy(true);
    try {
      await callServer('/api/auth/change-password', { currentPassword: currentPw, newPassword: next }, true);
      passwordTypedAtLogin = '';
      onDone();
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-4">
      {!knowsCurrent && (
        <div>
          <label htmlFor="cp-current" className={labelClass}>Current password</label>
          <PasswordInput id="cp-current" value={current} onChange={setCurrent} autoFocus />
        </div>
      )}
      <div>
        <label htmlFor="cp-new" className={labelClass}>New password</label>
        <PasswordInput id="cp-new" value={next} onChange={setNext} placeholder="At least 6 characters" autoFocus={knowsCurrent} />
      </div>
      <div>
        <label htmlFor="cp-confirm" className={labelClass}>Type the new password again</label>
        <PasswordInput id="cp-confirm" value={confirm} onChange={setConfirm} />
      </div>
      <ErrorNote text={error} />
      <div className="flex gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex flex-1 items-center justify-center rounded-lg border border-line px-4 py-2.5 text-[15px] font-semibold text-ink hover:bg-surface"
          >
            Cancel
          </button>
        )}
        <button type="submit" disabled={busy} className={`${primaryBtn} flex-1`}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Save new password
        </button>
      </div>
    </form>
  );
}

export function ForcedPasswordChangeScreen({ member }: { member: TeamMember }) {
  return (
    <Shell
      title={`Welcome, ${member.name}`}
      subtitle="You logged in with a temporary password. Set your own password to continue."
    >
      <ChangePasswordForm member={member} onDone={() => { /* the screen closes by itself once saved */ }} />
      <button
        type="button"
        onClick={() => signOut(auth)}
        className="mt-4 w-full text-center text-sm font-medium text-ink-soft hover:text-ink"
      >
        Log out instead
      </button>
    </Shell>
  );
}

export function NoAccessScreen() {
  return (
    <Shell
      title="No access"
      subtitle="This login is no longer linked to an active team member. If you think this is a mistake, ask Management to check the Team list."
    >
      <div className="mb-5 flex items-center gap-3 rounded-lg bg-surface px-3.5 py-3 text-sm text-ink-soft">
        <ShieldCheck className="h-5 w-5 shrink-0 text-accent" />
        Your access may have been removed by Management.
      </div>
      <button type="button" onClick={() => signOut(auth)} className={primaryBtn}>
        <LogOut className="h-4 w-4" />
        Back to login
      </button>
    </Shell>
  );
}
