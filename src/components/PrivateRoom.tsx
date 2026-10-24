import React, { useState } from 'react';
import { Loader2, X } from 'lucide-react';
import BackupPanel from './BackupPanel';
import RestorePanel from './RestorePanel';
import { friendlyError } from '../lib/firebase';
import { MOVABLE_SCREENS, MovableScreen, saveScreensOff } from '../lib/privateScreens';

// The private room (2026-10-24): opened only by the owner, by double-clicking the clock (App.tsx). Nothing on screen
// points to it. Login log, Backup and Restore always live here; Management screens ticked under "Screens" move here.

type Tab = 'logins' | 'backup' | 'restore' | MovableScreen | 'screens';

export default function PrivateRoom({ off, loginLog, screen, onClose }: {
  off: MovableScreen[];
  loginLog: React.ReactNode;
  screen: (key: MovableScreen) => React.ReactNode;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('logins');
  const [ticks, setTicks] = useState<MovableScreen[]>(off);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const tabs: [Tab, string][] = [
    ['logins', 'Login log'], ['backup', 'Backup'], ['restore', 'Restore'],
    ...MOVABLE_SCREENS.filter(s => off.includes(s.key)).map(s => [s.key, s.label] as [Tab, string]),
    ['screens', 'Screens'],
  ];
  const current = tabs.some(([k]) => k === tab) ? tab : 'logins';

  const save = async () => {
    setSaving(true); setNote(''); setError('');
    try {
      await saveScreensOff(ticks);
      setNote('Saved. Ticked screens are now only here; unticked ones are back in Management for both managers.');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-surface" role="dialog" aria-modal="true" aria-label="Private">
      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-xl font-bold text-ink">Private</h2>
          <button type="button" onClick={onClose} aria-label="Close"
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-surface">
            <X className="h-4 w-4" /> Close
          </button>
        </div>
        <div className="mb-5 inline-flex max-w-full flex-wrap rounded-xl border border-line bg-white p-1" role="tablist">
          {tabs.map(([key, label]) => (
            <button key={key} role="tab" aria-selected={current === key} onClick={() => setTab(key)}
              className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors ${current === key ? 'bg-accent text-white' : 'text-ink-soft hover:text-ink'}`}>
              {label}
            </button>
          ))}
        </div>

        {current === 'logins' ? loginLog
          : current === 'backup' ? <BackupPanel />
          : current === 'restore' ? <RestorePanel />
          : current === 'screens' ? (
            <div className="max-w-2xl rounded-xl border border-line bg-white p-5">
              <h3 className="text-lg font-bold">Screens kept here</h3>
              <p className="mt-1 text-[15px] text-ink-soft">
                Login log, Backup and Restore are always here only. Tick a Management screen to move it here too: it leaves
                the Management menu and My home for everyone else.
              </p>
              <div className="mt-4 space-y-3">
                {MOVABLE_SCREENS.map(s => (
                  <label key={s.key} className="flex cursor-pointer items-start gap-3">
                    <input type="checkbox" checked={ticks.includes(s.key)} disabled={saving}
                      onChange={() => setTicks(t => (t.includes(s.key) ? t.filter(k => k !== s.key) : [...t, s.key]))}
                      className="mt-1 h-4 w-4 shrink-0 accent-[#0E6E62]" />
                    <span>
                      <span className="block text-[15px] font-semibold">{s.label}</span>
                      <span className="block text-sm text-ink-soft">{s.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
              <button type="button" onClick={save} disabled={saving}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-[#0B5A50] disabled:opacity-60">
                {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save
              </button>
              <p className="mt-3 text-sm text-ink-soft">
                Kept in the Management menu on purpose: Deal checks, Project P&amp;L, Payment tracking and Team, which the other
                manager and Admin need day to day.
              </p>
              {note && <p className="mt-3 text-sm text-accent">{note}</p>}
              {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
            </div>
          )
          : screen(current)}
      </div>
    </div>
  );
}
