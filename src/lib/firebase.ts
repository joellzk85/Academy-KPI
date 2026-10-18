import { initializeApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';

// The main CRM app. We look it up by name so other helpers (like the Google
// Calendar sync, which uses its own named app) never get mixed up with it.
const app = getApps().find(a => a.name === '[DEFAULT]') || initializeApp(firebaseConfig);

const databaseId = (firebaseConfig as any).firestoreDatabaseId || undefined;
export const db = databaseId ? getFirestore(app, databaseId) : getFirestore(app);

// CRM login session. Passwords are checked by the CRM's own server, which
// then gives the browser a pass for the database. No emails are used.
export const auth = getAuth(app);

// Stored files (proposal files on deals, 2026-10-18). Rules: storage.rules.
export const storage = getStorage(app);
// Give up after a minute (default 10) so a failed upload says so instead of sitting at 0%.
storage.maxUploadRetryTime = 60_000;
storage.maxOperationRetryTime = 30_000;

export class ServerError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

// Sends a request to the CRM server. When signedIn is true, it proves who
// is asking by attaching the current login pass.
export async function callServer<T = any>(path: string, body: Record<string, any>, signedIn = false): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (signedIn) {
    const user = auth.currentUser;
    if (!user) throw new ServerError('not-logged-in', 'You are logged out. Log in again.');
    headers.Authorization = `Bearer ${await user.getIdToken()}`;
  }
  let res: Response;
  try {
    res = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch {
    throw new ServerError('network', 'No connection to the CRM server. Check your internet and try again.');
  }
  let data: any = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok || !data?.ok) {
    throw new ServerError(data?.code || 'server-error', data?.error || 'The CRM server did not respond properly. Try again in a minute.');
  }
  return data as T;
}

// Turns technical login/database errors into plain-language messages.
export function friendlyError(err: any): string {
  if (err instanceof ServerError) return err.message;
  const code: string = err?.code || '';
  if (code === 'auth/configuration-not-found' || code === 'auth/operation-not-allowed' || code === 'auth/admin-restricted-operation') {
    return 'Firebase login is not started for this project yet. Follow the one-time Firebase step in the setup instructions, then try again.';
  }
  if (code === 'auth/invalid-custom-token' || code === 'auth/custom-token-mismatch') {
    return "The CRM server's login pass was rejected. Finish the one-time Google Cloud permission step, then try again.";
  }
  if (code === 'auth/too-many-requests') return 'Too many attempts. Wait a few minutes, then try again.';
  if (code === 'auth/network-request-failed') return 'No internet connection. Check your connection and try again.';
  if (code === 'permission-denied' || String(err?.message || '').includes('Missing or insufficient permissions')) {
    return 'The database blocked this action. Make sure the new database rules are published (see the setup instructions).';
  }
  return err?.message || 'Something went wrong. Try again.';
}
