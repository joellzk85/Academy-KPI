import React, { useMemo, useState } from 'react';
import { Eye, EyeOff, KeyRound, Loader2, RotateCcw, UserMinus, UserPlus, X } from 'lucide-react';
import { collection, doc, getDocs, query, where, writeBatch } from 'firebase/firestore';
import { db, buildLoginId, newMemberId, createLoginForSomeoneElse, friendlyError } from '../lib/firebase';
import { TeamMember, TeamRole, ROLE_LABELS } from '../types';

interface TeamManagerProps {
  currentMember: TeamMember;
  teamMembers: TeamMember[];
}

const inputClass =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const labelClass = 'mb-1.5 block text-sm font-semibold text-ink';
const primaryBtn =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-[15px] font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:cursor-not-allowed disabled:opacity-60';
const secondaryBtn =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-50';

const DEFAULT_TARGETS = { salesFigure: 30000, proposals: 2, preview: 1 };
const EMPTY_KPI = { salesFigure: [0, 0, 0, 0, 0], proposals: [0, 0, 0, 0, 0], preview: [0, 0, 0, 0, 0] };

const ROLE_HELP: Record<TeamRole, string> = {
  rep: 'Works on their own clients and deals.',
  admin: 'Everything a rep can do, plus operations for every deal.',
  management: 'Sees everything, manages the team, approves payments.',
};

function TempPasswordField({ value, onChange, id }: { value: string; onChange: (v: string) => void; id: string }) {
  const [show, setShow] = useState(true);
  return (
    <div className="relative">
      <input
        id={id}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="At least 6 characters"
        className={`${inputClass} pr-10`}
        autoComplete="new-password"
      />
      <button
        type="button"
        onClick={() => setShow(s => !s)}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-ink-soft hover:text-ink"
        aria-label={show ? 'Hide password' : 'Show password'}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-2xl border border-line bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <h3 className="text-lg font-bold text-ink">{title}</h3>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-ink-soft hover:bg-surface hover:text-ink" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

type DialogState =
  | { kind: 'reset'; member: TeamMember }
  | { kind: 'reactivate'; member: TeamMember }
  | { kind: 'remove'; member: TeamMember; openDeals: { id: string; client: string }[] | null }
  | null;

export default function TeamManager({ currentMember, teamMembers }: TeamManagerProps) {
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<TeamRole>('rep');
  const [newPassword, setNewPassword] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');

  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [dialog, setDialog] = useState<DialogState>(null);
  const [dialogPassword, setDialogPassword] = useState('');
  const [transferTo, setTransferTo] = useState('');
  const [dialogError, setDialogError] = useState('');
  const [dialogBusy, setDialogBusy] = useState(false);

  const roleOrder: Record<TeamRole, number> = { management: 0, admin: 1, rep: 2 };
  const activeMembers = useMemo(
    () => teamMembers.filter(m => m.active).sort((a, b) => roleOrder[a.role] - roleOrder[b.role] || a.name.localeCompare(b.name)),
    [teamMembers]
  );
  const removedMembers = useMemo(() => teamMembers.filter(m => !m.active).sort((a, b) => a.name.localeCompare(b.name)), [teamMembers]);
  const activeManagementCount = activeMembers.filter(m => m.role === 'management').length;

  const flash = (tone: 'ok' | 'error', text: string) => {
    setNotice({ tone, text });
    window.setTimeout(() => setNotice(n => (n?.text === text ? null : n)), 6000);
  };

  const nameTaken = (name: string, exceptId?: string) =>
    activeMembers.some(m => m.id !== exceptId && m.name.trim().toLowerCase() === name.trim().toLowerCase());

  const closeDialog = () => {
    setDialog(null);
    setDialogPassword('');
    setTransferTo('');
    setDialogError('');
    setDialogBusy(false);
  };

  // ---- Add a person ----
  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError('');
    const name = newName.trim();
    if (!name) return setAddError('Enter a name.');
    if (nameTaken(name)) return setAddError(`Someone called "${name}" is already on the team. Add a surname or initial so people can tell them apart at login.`);
    if (newPassword.length < 6) return setAddError('The temporary password needs at least 6 characters.');

    setAdding(true);
    try {
      const memberId = newMemberId();
      const loginId = buildLoginId(memberId, 1);
      const uid = await createLoginForSomeoneElse(loginId, newPassword);
      const member: TeamMember = {
        id: memberId,
        name,
        role: newRole,
        active: true,
        loginId,
        authUid: uid,
        authVersion: 1,
        mustChangePassword: true,
        createdAt: Date.now(),
        createdById: currentMember.id,
      };
      const batch = writeBatch(db);
      batch.set(doc(db, 'team', memberId), member);
      batch.set(doc(db, 'auth_map', uid), { memberId, role: newRole, active: true });
      // Workspace for KPI and targets (no name stored here; names live only in Team).
      batch.set(doc(db, 'reps', memberId), { kpi: EMPTY_KPI, targets: DEFAULT_TARGETS }, { merge: true });
      await batch.commit();
      flash('ok', `${name} has been added. Give them the temporary password; they will be asked to set their own when they first log in.`);
      setNewName('');
      setNewPassword('');
      setNewRole('rep');
    } catch (err) {
      setAddError(friendlyError(err));
    } finally {
      setAdding(false);
    }
  };

  // ---- Change role ----
  const handleRoleChange = async (member: TeamMember, role: TeamRole) => {
    if (role === member.role) return;
    if (member.role === 'management' && activeManagementCount <= 1) {
      flash('error', 'The CRM needs at least one Management person. Add another Management person before changing this role.');
      return;
    }
    setBusyId(member.id);
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'team', member.id), { role });
      batch.set(doc(db, 'auth_map', member.authUid), { memberId: member.id, role, active: true });
      await batch.commit();
      flash('ok', `${member.name} is now ${ROLE_LABELS[role]}.`);
    } catch (err) {
      flash('error', friendlyError(err));
    } finally {
      setBusyId(null);
    }
  };

  // ---- Reset password / reactivate (both give the person a new login) ----
  const handleNewLogin = async () => {
    if (!dialog || (dialog.kind !== 'reset' && dialog.kind !== 'reactivate')) return;
    const member = dialog.member;
    setDialogError('');
    if (dialogPassword.length < 6) return setDialogError('The temporary password needs at least 6 characters.');
    if (dialog.kind === 'reactivate' && nameTaken(member.name, member.id)) {
      return setDialogError(`Someone called "${member.name}" is already active. Rename one of them first.`);
    }
    setDialogBusy(true);
    try {
      const version = (member.authVersion || 1) + 1;
      const loginId = buildLoginId(member.id, version);
      const uid = await createLoginForSomeoneElse(loginId, dialogPassword);
      const batch = writeBatch(db);
      if (member.authUid) batch.delete(doc(db, 'auth_map', member.authUid));
      batch.set(doc(db, 'auth_map', uid), { memberId: member.id, role: member.role, active: true });
      batch.update(doc(db, 'team', member.id), {
        authUid: uid,
        loginId,
        authVersion: version,
        mustChangePassword: true,
        active: true,
      });
      await batch.commit();
      flash(
        'ok',
        dialog.kind === 'reset'
          ? `${member.name}'s password has been reset. Give them the temporary password; their old password no longer works.`
          : `${member.name} can log in again with the temporary password.`
      );
      closeDialog();
    } catch (err) {
      setDialogError(friendlyError(err));
      setDialogBusy(false);
    }
  };

  // ---- Remove ----
  const openRemove = async (member: TeamMember) => {
    if (member.id === currentMember.id) return flash('error', 'You cannot remove yourself. Ask the other Management person to do it.');
    if (member.role === 'management' && activeManagementCount <= 1) {
      return flash('error', 'The CRM needs at least one Management person, so this person cannot be removed.');
    }
    setDialog({ kind: 'remove', member, openDeals: null });
    try {
      const snap = await getDocs(query(collection(db, 'pipelines'), where('ownerId', '==', member.id)));
      const open = snap.docs
        .map(d => ({ id: d.id, ...(d.data() as any) }))
        .filter(p => p.status !== 'Won' && p.status !== 'Lost')
        .map(p => ({ id: p.id, client: p.client || 'Unnamed client' }));
      setDialog(d => (d && d.kind === 'remove' && d.member.id === member.id ? { ...d, openDeals: open } : d));
    } catch (err) {
      setDialogError(friendlyError(err));
      setDialog(d => (d && d.kind === 'remove' ? { ...d, openDeals: [] } : d));
    }
  };

  const handleRemove = async () => {
    if (!dialog || dialog.kind !== 'remove' || dialog.openDeals === null) return;
    const { member, openDeals } = dialog;
    setDialogError('');
    const receiver = activeMembers.find(m => m.id === transferTo);
    if (openDeals.length > 0 && !receiver) return setDialogError('Choose who takes over the open deals.');
    setDialogBusy(true);
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'team', member.id), { active: false, removedAt: Date.now() });
      if (member.authUid) batch.delete(doc(db, 'auth_map', member.authUid));
      if (receiver) {
        openDeals.forEach(d => batch.update(doc(db, 'pipelines', d.id), { ownerId: receiver.id, ownerName: receiver.name }));
      }
      await batch.commit();
      flash(
        'ok',
        receiver
          ? `${member.name} has been removed and ${openDeals.length} open deal${openDeals.length === 1 ? '' : 's'} moved to ${receiver.name}.`
          : `${member.name} has been removed. Their history is kept.`
      );
      closeDialog();
    } catch (err) {
      setDialogError(friendlyError(err));
      setDialogBusy(false);
    }
  };

  return (
    <div className="space-y-6 font-sans text-ink">
      <div>
        <h2 className="text-xl font-bold">Team</h2>
        <p className="mt-1 max-w-2xl text-[15px] leading-relaxed text-ink-soft">
          This is the only place people are added or removed. Names here appear on the login screen and in every dropdown across the CRM.
        </p>
      </div>

      {notice && (
        <div
          role="status"
          className={`rounded-lg px-4 py-3 text-[15px] leading-relaxed ${
            notice.tone === 'ok' ? 'bg-accent-soft text-accent' : 'bg-danger-soft text-danger'
          }`}
        >
          {notice.text}
        </div>
      )}

      {activeManagementCount < 2 && (
        <div className="rounded-lg bg-attention-soft px-4 py-3 text-[15px] leading-relaxed text-attention">
          Payment approvals need two Management people who approve each other's requests. Add a second Management person when you're ready.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* People list */}
        <section className="overflow-hidden rounded-2xl border border-line bg-white">
          <div className="border-b border-line px-5 py-3.5">
            <h3 className="font-bold">People with access ({activeMembers.length})</h3>
          </div>
          <ul className="divide-y divide-line">
            {activeMembers.map(m => {
              const isMe = m.id === currentMember.id;
              return (
                <li key={m.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      {m.name} {isMe && <span className="font-normal text-ink-soft">(you)</span>}
                    </p>
                    <p className="mt-0.5 text-sm text-ink-soft">
                      {m.mustChangePassword ? 'Has not set their own password yet' : 'Active'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="sr-only" htmlFor={`role-${m.id}`}>Role for {m.name}</label>
                    <select
                      id={`role-${m.id}`}
                      value={m.role}
                      disabled={isMe || busyId === m.id}
                      onChange={e => handleRoleChange(m, e.target.value as TeamRole)}
                      className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm font-medium text-ink focus:border-accent focus:outline-none disabled:bg-surface disabled:text-ink-soft"
                      title={isMe ? 'You cannot change your own role' : undefined}
                    >
                      <option value="rep">{ROLE_LABELS.rep}</option>
                      <option value="admin">{ROLE_LABELS.admin}</option>
                      <option value="management">{ROLE_LABELS.management}</option>
                    </select>
                    {!isMe && (
                      <>
                        <button type="button" className={secondaryBtn} onClick={() => setDialog({ kind: 'reset', member: m })}>
                          <KeyRound className="h-3.5 w-3.5" /> Reset password
                        </button>
                        <button
                          type="button"
                          className={`${secondaryBtn} text-danger hover:bg-danger-soft`}
                          onClick={() => openRemove(m)}
                        >
                          <UserMinus className="h-3.5 w-3.5" /> Remove
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {removedMembers.length > 0 && (
            <>
              <div className="border-y border-line bg-surface px-5 py-3">
                <h3 className="text-sm font-bold text-ink-soft">Removed ({removedMembers.length})</h3>
              </div>
              <ul className="divide-y divide-line">
                {removedMembers.map(m => (
                  <li key={m.id} className="flex items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-ink-soft">{m.name}</p>
                      <p className="text-sm text-ink-soft">Was {ROLE_LABELS[m.role]}, cannot log in now</p>
                    </div>
                    <button type="button" className={secondaryBtn} onClick={() => setDialog({ kind: 'reactivate', member: m })}>
                      <RotateCcw className="h-3.5 w-3.5" /> Give access again
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        {/* Add person */}
        <section className="h-fit rounded-2xl border border-line bg-white p-5">
          <h3 className="flex items-center gap-2 font-bold">
            <UserPlus className="h-4 w-4 text-accent" /> Add a person
          </h3>
          <form onSubmit={handleAdd} className="mt-4 space-y-4">
            <div>
              <label htmlFor="tm-name" className={labelClass}>Name</label>
              <input id="tm-name" value={newName} onChange={e => { setNewName(e.target.value); setAddError(''); }} className={inputClass} placeholder="As it should appear at login" />
            </div>
            <div>
              <span className={labelClass}>Role</span>
              <div className="space-y-2">
                {(['rep', 'admin', 'management'] as TeamRole[]).map(r => (
                  <label
                    key={r}
                    className={`flex cursor-pointer gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                      newRole === r ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface'
                    }`}
                  >
                    <input type="radio" name="tm-role" value={r} checked={newRole === r} onChange={() => setNewRole(r)} className="mt-1 accent-[#0E6E62]" />
                    <span>
                      <span className="block text-[15px] font-semibold">{ROLE_LABELS[r]}</span>
                      <span className="block text-sm text-ink-soft">{ROLE_HELP[r]}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label htmlFor="tm-pw" className={labelClass}>Temporary password</label>
              <TempPasswordField id="tm-pw" value={newPassword} onChange={v => { setNewPassword(v); setAddError(''); }} />
              <p className="mt-1.5 text-sm text-ink-soft">They'll be asked to set their own password the first time they log in.</p>
            </div>
            {addError && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{addError}</p>}
            <button type="submit" disabled={adding} className={`${primaryBtn} w-full`}>
              {adding && <Loader2 className="h-4 w-4 animate-spin" />}
              Add to team
            </button>
          </form>
        </section>
      </div>

      {/* Dialogs */}
      {dialog && (dialog.kind === 'reset' || dialog.kind === 'reactivate') && (
        <Dialog title={dialog.kind === 'reset' ? `Reset ${dialog.member.name}'s password` : `Give ${dialog.member.name} access again`} onClose={closeDialog}>
          <p className="mb-4 text-[15px] leading-relaxed text-ink-soft">
            {dialog.kind === 'reset'
              ? 'Their current password will stop working straight away. Set a temporary one and pass it to them; they will choose their own at next login.'
              : 'They will be able to log in again as ' + ROLE_LABELS[dialog.member.role] + '. Set a temporary password and pass it to them.'}
          </p>
          <label htmlFor="dlg-pw" className={labelClass}>Temporary password</label>
          <TempPasswordField id="dlg-pw" value={dialogPassword} onChange={v => { setDialogPassword(v); setDialogError(''); }} />
          {dialogError && <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{dialogError}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className={secondaryBtn} onClick={closeDialog}>Cancel</button>
            <button type="button" className={primaryBtn} disabled={dialogBusy} onClick={handleNewLogin}>
              {dialogBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              {dialog.kind === 'reset' ? 'Reset password' : 'Give access'}
            </button>
          </div>
        </Dialog>
      )}

      {dialog && dialog.kind === 'remove' && (
        <Dialog title={`Remove ${dialog.member.name}?`} onClose={closeDialog}>
          <p className="text-[15px] leading-relaxed text-ink-soft">
            They will be logged out and can no longer log in. Their past work and history stay in the CRM. You can give them access again later.
          </p>
          {dialog.openDeals === null ? (
            <p className="mt-4 flex items-center gap-2 text-sm text-ink-soft">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking their open deals…
            </p>
          ) : dialog.openDeals.length > 0 ? (
            <div className="mt-4 rounded-lg bg-attention-soft p-3.5">
              <p className="text-[15px] font-semibold text-attention">
                {dialog.openDeals.length} open deal{dialog.openDeals.length === 1 ? '' : 's'} need a new owner
              </p>
              <p className="mt-1 text-sm text-attention">
                {dialog.openDeals.slice(0, 4).map(d => d.client).join(', ')}
                {dialog.openDeals.length > 4 ? ` and ${dialog.openDeals.length - 4} more` : ''}
              </p>
              <label htmlFor="dlg-transfer" className={`${labelClass} mt-3`}>Move them to</label>
              <select id="dlg-transfer" value={transferTo} onChange={e => { setTransferTo(e.target.value); setDialogError(''); }} className={inputClass}>
                <option value="">Choose a person</option>
                {activeMembers.filter(m => m.id !== dialog.member.id).map(m => (
                  <option key={m.id} value={m.id}>{m.name} ({ROLE_LABELS[m.role]})</option>
                ))}
              </select>
            </div>
          ) : (
            <p className="mt-4 text-sm text-ink-soft">They have no open deals.</p>
          )}
          {dialogError && <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{dialogError}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className={secondaryBtn} onClick={closeDialog}>Cancel</button>
            <button
              type="button"
              disabled={dialogBusy || dialog.openDeals === null}
              onClick={handleRemove}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-danger px-4 py-2 text-[15px] font-semibold text-white hover:bg-[#931C13] disabled:opacity-60"
            >
              {dialogBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              Remove {dialog.member.name}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
