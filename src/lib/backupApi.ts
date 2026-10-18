// The data backup, from the browser (2026-10-17). The CRM server does the work (serverBackup.ts).

import { ServerError, auth, callServer } from './firebase';

export interface BackupStatus {
  configured: boolean;
  sheetId: string;
  sheetName: string;
  lastBackupAt: number;
  lastBackupBy: string;
  lastSummary: string;
  lastError: string;
  lastErrorAt: number;
  shareWith: string;          // the CRM server's address to share the Google Sheet with
}

export const backupStatus = () => callServer<BackupStatus & { ok: true }>('/api/backup/status', {}, true);

export const saveBackupSheet = (sheet: string) =>
  callServer<{ configured: boolean; sheetName?: string }>('/api/backup/settings', { sheet }, true);

export const runBackup = (force = false) =>
  callServer<{ skipped?: string; summary?: string }>('/api/backup/run', { force }, true);

// Downloads the Excel backup file to this computer.
export const downloadBackup = () => downloadFrom('/api/backup/download', 'NEXT-Academy-CRM-backup.xlsx', 'The backup file could not be made. Try again in a minute.');

// Downloads every proposal file as one ZIP (2026-10-18).
export const downloadProposals = () => downloadFrom('/api/backup/proposals', 'NEXT-Academy-proposals.zip', "The ZIP file couldn't be made. Try again in a minute.");

async function downloadFrom(path: string, fallbackName: string, failMessage: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new ServerError('not-logged-in', 'You are logged out. Log in again.');
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` },
      body: '{}',
    });
  } catch {
    throw new ServerError('network', 'No connection to the CRM server. Check your internet and try again.');
  }
  if (!res.ok) {
    let data: any = null;
    try { data = await res.json(); } catch { /* not JSON */ }
    throw new ServerError(data?.code || 'server-error', data?.error || failMessage);
  }
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}
