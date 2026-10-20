import React, { useEffect, useState } from 'react';
import { CheckCircle2, Copy, Download, ExternalLink, FileArchive, Loader2, RefreshCw, Settings2, XCircle } from 'lucide-react';
import { BackupStatus, backupStatus, downloadBackup, downloadProposals, runBackup, saveBackupSheet } from '../lib/backupApi';
import { friendlyError } from '../lib/firebase';
import { malaysiaTime } from '../lib/backup';

// Admin work → Backup (2026-10-17): the daily Google Sheet copy, "Back up now" and the Excel download.
// Admin and Management only. The server does the work (serverBackup.ts).

const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';
const SHEETS_API = 'https://console.cloud.google.com/apis/library/sheets.googleapis.com?project=gen-lang-client-0779528352';

export default function BackupPanel() {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState<'' | 'run' | 'download' | 'zip' | 'save'>('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [setupOpen, setSetupOpen] = useState(false);
  const [sheet, setSheet] = useState('');
  const [copied, setCopied] = useState(false);

  const load = async () => {
    try {
      const s = await backupStatus();
      setStatus(s);
      setSheet(s.sheetId ? `https://docs.google.com/spreadsheets/d/${s.sheetId}/edit` : '');
      setSetupOpen(open => open || !s.configured);
      setLoadError('');
    } catch (err) {
      setLoadError(friendlyError(err));
    }
  };
  useEffect(() => { load(); }, []);

  const act = async (kind: 'run' | 'download' | 'zip' | 'save', fn: () => Promise<string>) => {
    setBusy(kind); setNote(''); setError('');
    try {
      setNote(await fn());
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy('');
      load();
    }
  };

  const backUpNow = () => act('run', async () => {
    const r = await runBackup(true);
    return r.skipped === 'running' ? 'A backup is already running. Check again in a minute.' : `Backed up: ${r.summary}.`;
  });
  const download = () => act('download', async () => { await downloadBackup(); return 'The Excel file is downloading. Keep it somewhere safe, it holds all client and money details.'; });
  const downloadZip = () => act('zip', async () => { await downloadProposals(); return 'The ZIP of all proposal and checklist files (JD14, T3 and others) is downloading, one folder per deal. Keep it somewhere safe.'; });
  const save = () => act('save', async () => {
    const r = await saveBackupSheet(sheet.trim());
    if (!r.configured) return 'Google Sheet disconnected. The daily backup is off.';
    setSetupOpen(false);
    const b = await runBackup(true);
    return `Connected to "${r.sheetName}" and backed up: ${b.summary || 'done'}.`;
  });
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ }
  };

  const connected = !!status?.configured;
  const failedLast = !!status?.lastError && (status.lastErrorAt || 0) >= (status.lastBackupAt || 0);
  const sheetUrl = status?.sheetId ? `https://docs.google.com/spreadsheets/d/${status.sheetId}/edit` : '';

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-white p-5">
        <h3 className="text-lg font-bold">Backup</h3>
        <p className="mt-1 text-[15px] text-ink-soft">
          A copy of every list in the CRM (deals, clients, quotations, money, trainers, venues, checklists and more).
          Passwords and login data are never included.
        </p>

        {loadError && <p role="alert" className="mt-3 text-sm text-danger">{loadError}</p>}

        <div className="mt-4 rounded-lg border border-line bg-surface p-4">
          <div className="flex flex-wrap items-start gap-3">
            {connected && !failedLast ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
              : <XCircle className={`mt-0.5 h-5 w-5 shrink-0 ${failedLast ? 'text-danger' : 'text-ink-soft'}`} />}
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {!status ? 'Checking…' : connected ? `Daily copy to Google Sheet: ${status.sheetName || 'connected'}` : 'Daily Google Sheet copy is not set up yet'}
              </p>
              {status && (
                <p className="mt-0.5 text-sm text-ink-soft">
                  {status.lastBackupAt
                    ? `Last backup ${malaysiaTime(new Date(status.lastBackupAt).toISOString())} by ${status.lastBackupBy || 'the CRM'}${status.lastSummary ? ` (${status.lastSummary})` : ''}.`
                    : connected ? 'No backup yet.' : 'Set it up once, below. The Excel download works already.'}
                </p>
              )}
              {failedLast && <p className="mt-1 text-sm text-danger">Last try failed: {status!.lastError}</p>}
              {connected && <p className="mt-1 text-sm text-ink-soft">Runs once a day, the first time Admin or Management opens the CRM.</p>}
            </div>
            {sheetUrl && (
              <a href={sheetUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline">
                Open the Google Sheet <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className={btnPrimary} disabled={!!busy || !connected} onClick={backUpNow}>
            {busy === 'run' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Back up to Google Sheet now
          </button>
          <button type="button" className={btnSecondary} disabled={!!busy} onClick={download}>
            {busy === 'download' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download Excel file
          </button>
          <button type="button" className={btnSecondary} disabled={!!busy} onClick={downloadZip}>
            {busy === 'zip' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileArchive className="h-4 w-4" />} Download all proposals, checklist files and receipts (ZIP)
          </button>
          <button type="button" className={btnSecondary} onClick={() => setSetupOpen(v => !v)}>
            <Settings2 className="h-4 w-4" /> {setupOpen ? 'Close setup' : connected ? 'Change Google Sheet' : 'Set up'}
          </button>
        </div>

        {note && <p className="mt-3 text-sm text-accent">{note}</p>}
        {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      </div>

      {setupOpen && (
        <div className="rounded-xl border border-line bg-white p-5">
          <h3 className="font-bold">Set up the daily Google Sheet copy (once)</h3>
          <ol className="mt-3 list-decimal space-y-3 pl-5 text-[15px] text-ink-soft">
            <li>
              Switch on the <strong className="text-ink">Google Sheets API</strong> for the CRM's Google Cloud project:{' '}
              <a href={SHEETS_API} target="_blank" rel="noreferrer" className="font-semibold text-accent hover:underline">open it here</a>, then click <strong className="text-ink">Enable</strong>.
            </li>
            <li>
              In Google Drive, make a new blank Google Sheet (for example "NEXT Academy CRM backup"). Click <strong className="text-ink">Share</strong>, add this address as <strong className="text-ink">Editor</strong>, untick "Notify people", and click Share:
              {status?.shareWith ? (
                <span className="mt-1 flex flex-wrap items-center gap-2">
                  <code className="break-all rounded bg-surface px-1.5 py-0.5 text-xs text-ink">{status.shareWith}</code>
                  <button type="button" onClick={() => copy(status.shareWith)} className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
                    <Copy className="h-3 w-3" />{copied ? 'Copied' : 'Copy'}
                  </button>
                </span>
              ) : (
                <span className="mt-1 block text-sm">(The address shows here on the live CRM website.)</span>
              )}
            </li>
            <li>Copy the sheet's address from your browser's address bar, paste it here, and click Save and test. The first backup runs straight away.</li>
          </ol>
          <div className="mt-3 flex flex-wrap gap-2">
            <input value={sheet} onChange={e => setSheet(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" aria-label="Google Sheet link"
              className="min-w-[16rem] flex-1 rounded-lg border border-line bg-white px-3 py-2 text-[15px] focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15" />
            <button type="button" className={btnPrimary} disabled={!!busy || (!sheet.trim() && !connected)} onClick={save}>
              {busy === 'save' && <Loader2 className="h-4 w-4 animate-spin" />}{connected && !sheet.trim() ? 'Disconnect' : 'Save and test'}
            </button>
          </div>
          <p className="mt-3 text-sm text-ink-soft">
            Each backup replaces the sheet's tabs with fresh data. To see an earlier day, open the sheet and use
            File → Version history. Don't type in the backup sheet; your changes would be replaced.
          </p>
        </div>
      )}
    </div>
  );
}
