import React, { useEffect, useState } from 'react';
import { CalendarCheck, Copy, Loader2, RefreshCw, Settings2 } from 'lucide-react';
import { CalendarStatus, calendarStatus, saveCalendarId, syncCalendar } from '../lib/googleCalendar';
import { friendlyError } from '../lib/firebase';

// The shared Google Calendar's status, shown on the calendar (2026-10-17).
// Everyone: connected or not, last sync, "Sync now". Management: the setup steps and the Calendar ID.
export default function GoogleCalendarBar({ canManage, onChanged }: { canManage: boolean; onChanged?: () => void }) {
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);
  const [calId, setCalId] = useState('');
  const [copied, setCopied] = useState(false);

  const load = async () => {
    try {
      const s = await calendarStatus();
      setStatus(s);
      setCalId(s.calendarId || '');
      setError('');
    } catch (err) {
      setStatus(null);
      setError(friendlyError(err));
    }
  };
  useEffect(() => { load(); }, []);

  const syncNow = async () => {
    setBusy(true); setNote(''); setError('');
    try {
      const r = await syncCalendar(true);
      setNote(r.skipped === 'running' ? 'A sync is already running. Try again in a moment.' : `Synced: ${r.summary || 'nothing to change'}.`);
      onChanged?.();
      await load();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true); setNote(''); setError('');
    try {
      const r = await saveCalendarId(calId.trim());
      setNote(r.configured ? `Connected to "${r.calendarName}". Sending the CRM's events now…` : 'Google Calendar disconnected.');
      await load();
      if (r.configured) await syncNow();
      else onChanged?.();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ }
  };

  const connected = !!status?.configured;
  const ago = status?.lastSyncAt ? Math.max(0, Math.round((Date.now() - status.lastSyncAt) / 60000)) : null;

  return (
    <div className="my-2 rounded-lg border border-line bg-surface p-2.5 text-left font-sans text-sm text-ink">
      <div className="flex flex-wrap items-center gap-2">
        <CalendarCheck className={`h-4 w-4 shrink-0 ${connected ? 'text-accent' : 'text-ink-soft'}`} />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{connected ? `Google Calendar: ${status!.calendarName || status!.calendarId}` : 'Google Calendar not connected'}</span>
          <span className="block text-xs text-ink-soft">
            {connected
              ? status!.lastSyncError ? `Last sync failed: ${status!.lastSyncError}` : ago === null ? 'Not synced yet' : `Synced ${ago === 0 ? 'just now' : `${ago} min ago`}${status!.lastSyncSummary ? ` (${status!.lastSyncSummary})` : ''}`
              : canManage ? 'Set it up once, below.' : 'Management can connect the shared Google Calendar.'}
          </span>
        </span>
        {connected && (
          <button type="button" disabled={busy} onClick={syncNow} className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2 py-1 text-xs font-semibold hover:bg-white/60 disabled:opacity-60">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Sync now
          </button>
        )}
        {canManage && (
          <button type="button" onClick={() => setOpen(v => !v)} className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2 py-1 text-xs font-semibold hover:bg-white/60">
            <Settings2 className="h-3.5 w-3.5" /> {open ? 'Close' : connected ? 'Settings' : 'Set up'}
          </button>
        )}
      </div>

      {note && <p className="mt-2 text-xs text-accent">{note}</p>}
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}

      {canManage && open && (
        <div className="mt-3 space-y-3 border-t border-line pt-3 text-[13px]">
          <ol className="list-decimal space-y-1.5 pl-5 text-ink-soft">
            <li>In Google Cloud, switch on the <strong className="text-ink">Google Calendar API</strong> for the CRM's project (once).</li>
            <li>
              In Google Calendar, open the shared calendar's settings, then <strong className="text-ink">Share with specific people</strong>. Add this address with <strong className="text-ink">"Make changes to events"</strong>:
              {status?.shareWith ? (
                <span className="mt-1 flex items-center gap-2">
                  <code className="break-all rounded bg-white px-1.5 py-0.5 text-xs text-ink">{status.shareWith}</code>
                  <button type="button" onClick={() => copy(status.shareWith)} className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline"><Copy className="h-3 w-3" />{copied ? 'Copied' : 'Copy'}</button>
                </span>
              ) : (
                <span className="mt-1 block text-xs">(The address shows here on the live CRM website.)</span>
              )}
            </li>
            <li>Paste the calendar's <strong className="text-ink">Calendar ID</strong> (Google Calendar settings → Integrate calendar) and click Save and test.</li>
          </ol>
          <div className="flex flex-wrap gap-2">
            <input value={calId} onChange={e => setCalId(e.target.value)} placeholder="e.g. nextacademy24@gmail.com" aria-label="Calendar ID"
              className="min-w-[14rem] flex-1 rounded-lg border border-line bg-white px-3 py-1.5 text-sm focus:border-accent focus:outline-none" />
            <button type="button" disabled={busy || (!calId.trim() && !connected)} onClick={save}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#0B5A50] disabled:opacity-60">
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{calId.trim() ? 'Save and test' : 'Disconnect'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
