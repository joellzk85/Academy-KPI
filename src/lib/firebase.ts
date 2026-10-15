import { initializeApp, getApps, deleteApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

// The main CRM app. We look it up by name so other helpers (like the Google
// Calendar sync, which uses its own named app) never get mixed up with it.
const app = getApps().find(a => a.name === '[DEFAULT]') || initializeApp(firebaseConfig);

const databaseId = (firebaseConfig as any).firestoreDatabaseId || undefined;
export const db = databaseId ? getFirestore(app, databaseId) : getFirestore(app);

// CRM login. People never see or type an email: each team member gets a hidden
// internal login ID built from their member ID. The version number changes
// whenever management resets that person's password.
export const auth = getAuth(app);

export const LOGIN_DOMAIN = 'next-academy-crm.app';

export function buildLoginId(memberId: string, version: number): string {
  return `${memberId}.v${version}@${LOGIN_DOMAIN}`;
}

export function newMemberId(): string {
  return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Creates a login for someone else (used by management in the Team tab)
// without logging the manager out. It uses a temporary, separate connection.
export async function createLoginForSomeoneElse(loginId: string, password: string): Promise<string> {
  const temp = initializeApp(firebaseConfig, `team-setup-${Date.now()}`);
  try {
    const tempAuth = getAuth(temp);
    const cred = await createUserWithEmailAndPassword(tempAuth, loginId, password);
    const uid = cred.user.uid;
    await signOut(tempAuth);
    return uid;
  } finally {
    await deleteApp(temp);
  }
}

// Turns technical login/database errors into plain-language messages.
export function friendlyError(err: any): string {
  const code: string = err?.code || '';
  if (code === 'auth/operation-not-allowed' || code === 'auth/configuration-not-found') {
    return 'Login is not switched on in Firebase yet. Follow step 1 of the setup instructions (enable Email/Password sign-in), then try again.';
  }
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found' || code === 'auth/invalid-login-credentials') {
    return 'That password is not correct. Check it and try again.';
  }
  if (code === 'auth/weak-password') return 'Passwords need at least 6 characters.';
  if (code === 'auth/too-many-requests') return 'Too many attempts. Wait a few minutes, then try again.';
  if (code === 'auth/network-request-failed') return 'No internet connection. Check your connection and try again.';
  if (code === 'auth/requires-recent-login') return 'For safety, log out and log in again, then change your password.';
  if (code === 'permission-denied' || String(err?.message || '').includes('Missing or insufficient permissions')) {
    return 'The database blocked this action. Make sure the new database rules are published (step 2 of the setup instructions).';
  }
  return err?.message || 'Something went wrong. Try again.';
}
