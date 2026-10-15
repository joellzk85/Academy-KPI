// NEXT Academy CRM: login and team management, run on the server.
//
// How it works, in plain terms:
// - Passwords are checked HERE, on the server, never in the browser.
// - Passwords are stored scrambled (scrypt hash + salt) in the "secrets"
//   part of the database, which no browser is ever allowed to read.
// - When a name + password is correct, the server hands the browser a
//   one-time pass (a Firebase "custom token") so it can use the database.
// - No emails are used anywhere.

import type { Express, Request, Response } from 'express';
import crypto from 'crypto';
import { initializeApp, getApps, App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import firebaseConfig from './firebase-applet-config.json';

type Role = 'rep' | 'admin' | 'management';
const ROLES: Role[] = ['rep', 'admin', 'management'];
const MIN_PASSWORD = 6;
const DEFAULT_TARGETS = { salesFigure: 30000, proposals: 2, preview: 1 };
const EMPTY_KPI = { salesFigure: [0, 0, 0, 0, 0], proposals: [0, 0, 0, 0, 0], preview: [0, 0, 0, 0, 0] };

// ---------- Firebase (admin) connection, started on first use ----------
let adminApp: App | null = null;
function admin() {
  if (!adminApp) {
    adminApp = getApps()[0] || initializeApp({ projectId: (firebaseConfig as any).projectId });
  }
  const databaseId = (firebaseConfig as any).firestoreDatabaseId;
  const db: Firestore = databaseId ? getFirestore(adminApp, databaseId) : getFirestore(adminApp);
  return { auth: getAuth(adminApp), db };
}

// ---------- Errors shown to people in plain language ----------
class UserError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function explainServerError(err: any): UserError {
  if (err instanceof UserError) return err;
  const msg = String(err?.message || err);
  console.error('[auth] server error:', msg);
  if (/default credentials|Could not load the default|Failed to determine service account|metadata/i.test(msg)) {
    return new UserError(503, 'server-no-credentials',
      'Logins only work on the live CRM website, not inside the AI Studio preview. Open the live site to log in.');
  }
  if (/signBlob|iamcredentials|Service Account Credentials|serviceAccountTokenCreator|iam\.serviceAccounts/i.test(msg)) {
    return new UserError(503, 'server-not-allowed',
      "The CRM server isn't allowed to issue logins yet. Finish the one-time Google Cloud permission step from the setup instructions, then try again.");
  }
  if (/PERMISSION_DENIED|permission/i.test(msg)) {
    return new UserError(503, 'server-no-database-access',
      "The CRM server can't reach the database yet. Finish the one-time Google Cloud permission step from the setup instructions, then try again.");
  }
  return new UserError(500, 'server-error', 'Something went wrong on the server. Try again in a minute.');
}

// ---------- Password scrambling ----------
function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = crypto.randomBytes(16).toString('hex');
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, key) => (err ? reject(err) : resolve({ hash: key.toString('hex'), salt })));
  });
}

function checkPassword(password: string, salt: string, hash: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, key) => {
      if (err) return reject(err);
      const expected = Buffer.from(hash, 'hex');
      resolve(expected.length === key.length && crypto.timingSafeEqual(expected, key));
    });
  });
}

function validatePassword(pw: unknown): string {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) {
    throw new UserError(400, 'weak-password', `Passwords need at least ${MIN_PASSWORD} characters.`);
  }
  if (pw.length > 200) throw new UserError(400, 'weak-password', 'That password is too long.');
  return pw;
}

function validateName(name: unknown): string {
  const clean = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
  if (!clean) throw new UserError(400, 'name-required', 'Enter a name.');
  if (clean.length > 60) throw new UserError(400, 'name-too-long', 'Keep names under 60 characters.');
  return clean;
}

function validateRole(role: unknown): Role {
  if (!ROLES.includes(role as Role)) throw new UserError(400, 'bad-role', 'Choose a valid role.');
  return role as Role;
}

function newMemberId(): string {
  return 'm' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
}

// ---------- Slow down password guessing ----------
const failedAttempts = new Map<string, { count: number; since: number }>();
const MAX_FAILS = 8;
const WINDOW_MS = 10 * 60 * 1000;

function assertNotLockedOut(memberId: string) {
  const entry = failedAttempts.get(memberId);
  if (entry && Date.now() - entry.since < WINDOW_MS && entry.count >= MAX_FAILS) {
    throw new UserError(429, 'too-many-attempts', 'Too many wrong passwords. Wait 10 minutes, then try again.');
  }
}
function recordFail(memberId: string) {
  const entry = failedAttempts.get(memberId);
  if (!entry || Date.now() - entry.since > WINDOW_MS) failedAttempts.set(memberId, { count: 1, since: Date.now() });
  else entry.count += 1;
}

// ---------- Who is calling? ----------
async function callerFrom(req: Request) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) throw new UserError(401, 'not-logged-in', 'You are logged out. Log in again.');
  const { auth, db } = admin();
  let uid: string;
  try {
    uid = (await auth.verifyIdToken(token, true)).uid;
  } catch {
    throw new UserError(401, 'not-logged-in', 'Your login has expired. Log in again.');
  }
  const link = await db.collection('auth_map').doc(uid).get();
  const data = link.data();
  if (!link.exists || !data?.active) throw new UserError(403, 'no-access', 'This login no longer has access.');
  return { memberId: uid, role: data.role as Role };
}

async function managementFrom(req: Request) {
  const caller = await callerFrom(req);
  if (caller.role !== 'management') throw new UserError(403, 'management-only', 'Only Management can do this.');
  return caller;
}

async function assertNameFree(db: Firestore, name: string, exceptId?: string) {
  const snap = await db.collection('team').where('active', '==', true).get();
  const clash = snap.docs.some(d => d.id !== exceptId && String(d.data().name || '').trim().toLowerCase() === name.toLowerCase());
  if (clash) {
    throw new UserError(409, 'name-taken',
      `Someone called "${name}" is already on the team. Add a surname or initial so people can tell them apart at login.`);
  }
}

async function activeManagementCount(db: Firestore): Promise<number> {
  const snap = await db.collection('team').where('active', '==', true).where('role', '==', 'management').get();
  return snap.size;
}

async function getMember(db: Firestore, memberId: unknown) {
  if (typeof memberId !== 'string' || !memberId) throw new UserError(400, 'bad-member', 'Choose a person.');
  const snap = await db.collection('team').doc(memberId).get();
  if (!snap.exists) throw new UserError(404, 'member-not-found', 'That person is not on the team list.');
  return { id: snap.id, ...(snap.data() as any) };
}

// Wraps each route so every error becomes a clear message.
function route(handler: (req: Request, res: Response) => Promise<any>) {
  return async (req: Request, res: Response) => {
    try {
      const result = await handler(req, res);
      res.json({ ok: true, ...(result || {}) });
    } catch (err) {
      const e = explainServerError(err);
      res.status(e.status).json({ ok: false, code: e.code, error: e.message });
    }
  };
}

// ---------- Routes ----------
export function registerAuthRoutes(app: Express) {
  // First-time setup: creates the first Management person.
  app.post('/api/auth/setup', route(async req => {
    const name = validateName(req.body?.name);
    const password = validatePassword(req.body?.password);
    const { auth, db } = admin();
    const memberId = newMemberId();
    const { hash, salt } = await hashPassword(password);

    await db.runTransaction(async tx => {
      const setupRef = db.collection('config').doc('setup');
      if ((await tx.get(setupRef)).exists) {
        throw new UserError(409, 'already-set-up', 'The CRM is already set up. Refresh the page to log in.');
      }
      const now = Date.now();
      tx.set(db.collection('team').doc(memberId), {
        name, role: 'management', active: true, mustChangePassword: false, createdAt: now, createdById: memberId,
      });
      tx.set(db.collection('auth_map').doc(memberId), { memberId, role: 'management', active: true });
      tx.set(db.collection('secrets').doc(memberId), { hash, salt, updatedAt: now });
      tx.set(db.collection('reps').doc(memberId), { kpi: EMPTY_KPI, targets: DEFAULT_TARGETS }, { merge: true });
      tx.set(setupRef, { initialized: true, at: now, byMemberId: memberId });
    });
    return { token: await auth.createCustomToken(memberId), memberId };
  }));

  // Everyday login: name (member id) + password.
  app.post('/api/auth/login', route(async req => {
    const memberId = req.body?.memberId;
    const password = req.body?.password;
    if (typeof memberId !== 'string' || !memberId) throw new UserError(400, 'bad-member', 'Choose your name from the list.');
    if (typeof password !== 'string' || !password) throw new UserError(400, 'no-password', 'Enter your password.');
    assertNotLockedOut(memberId);

    const { auth, db } = admin();
    const [memberSnap, secretSnap] = await Promise.all([
      db.collection('team').doc(memberId).get(),
      db.collection('secrets').doc(memberId).get(),
    ]);
    const member = memberSnap.data();
    const secret = secretSnap.data();
    const valid = !!(member?.active && secret && (await checkPassword(password, secret.salt, secret.hash)));
    if (!valid) {
      recordFail(memberId);
      throw new UserError(401, 'wrong-password', 'That password is not correct. Check it and try again.');
    }
    failedAttempts.delete(memberId);
    return { token: await auth.createCustomToken(memberId) };
  }));

  // Anyone: change my own password.
  app.post('/api/auth/change-password', route(async req => {
    const caller = await callerFrom(req);
    const current = req.body?.currentPassword;
    const next = validatePassword(req.body?.newPassword);
    if (typeof current !== 'string' || !current) throw new UserError(400, 'no-password', 'Enter your current password.');
    if (current === next) throw new UserError(400, 'same-password', 'Choose a password that is different from the current one.');
    assertNotLockedOut(caller.memberId);

    const { db } = admin();
    const secret = (await db.collection('secrets').doc(caller.memberId).get()).data();
    if (!secret || !(await checkPassword(current, secret.salt, secret.hash))) {
      recordFail(caller.memberId);
      throw new UserError(401, 'wrong-password', 'Your current password is not correct.');
    }
    const { hash, salt } = await hashPassword(next);
    const batch = db.batch();
    batch.set(db.collection('secrets').doc(caller.memberId), { hash, salt, updatedAt: Date.now() });
    batch.update(db.collection('team').doc(caller.memberId), { mustChangePassword: false });
    await batch.commit();
  }));

  // Management: add a person.
  app.post('/api/team/add', route(async req => {
    const caller = await managementFrom(req);
    const name = validateName(req.body?.name);
    const role = validateRole(req.body?.role);
    const password = validatePassword(req.body?.password);
    const mustChange = req.body?.mustChangePassword !== false;
    const { db } = admin();
    await assertNameFree(db, name);

    const memberId = newMemberId();
    const { hash, salt } = await hashPassword(password);
    const now = Date.now();
    const batch = db.batch();
    batch.set(db.collection('team').doc(memberId), {
      name, role, active: true, mustChangePassword: mustChange, createdAt: now, createdById: caller.memberId,
    });
    batch.set(db.collection('auth_map').doc(memberId), { memberId, role, active: true });
    batch.set(db.collection('secrets').doc(memberId), { hash, salt, updatedAt: now });
    batch.set(db.collection('reps').doc(memberId), { kpi: EMPTY_KPI, targets: DEFAULT_TARGETS }, { merge: true });
    await batch.commit();
    return { memberId };
  }));

  // Management: change someone's role (permissions).
  app.post('/api/team/role', route(async req => {
    const caller = await managementFrom(req);
    const role = validateRole(req.body?.role);
    const { db } = admin();
    const member = await getMember(db, req.body?.memberId);
    if (member.id === caller.memberId) throw new UserError(400, 'self-role', 'You cannot change your own role.');
    if (!member.active) throw new UserError(400, 'inactive', 'Give this person access again before changing their role.');
    if (member.role === 'management' && role !== 'management' && (await activeManagementCount(db)) <= 1) {
      throw new UserError(400, 'last-management', 'The CRM needs at least one Management person.');
    }
    const batch = db.batch();
    batch.update(db.collection('team').doc(member.id), { role });
    batch.set(db.collection('auth_map').doc(member.id), { memberId: member.id, role, active: true });
    await batch.commit();
  }));

  // Management: set a new password for someone.
  app.post('/api/team/password', route(async req => {
    const caller = await managementFrom(req);
    const password = validatePassword(req.body?.password);
    const mustChange = req.body?.mustChangePassword !== false;
    const { auth, db } = admin();
    const member = await getMember(db, req.body?.memberId);
    if (member.id === caller.memberId) {
      throw new UserError(400, 'self-password', 'Use "Change my password" in the top-right menu to change your own password.');
    }
    const { hash, salt } = await hashPassword(password);
    const batch = db.batch();
    batch.set(db.collection('secrets').doc(member.id), { hash, salt, updatedAt: Date.now() });
    batch.update(db.collection('team').doc(member.id), { mustChangePassword: mustChange });
    await batch.commit();
    failedAttempts.delete(member.id);
    // Log them out everywhere so the old password can't keep a session alive.
    try { await auth.revokeRefreshTokens(member.id); } catch { /* never logged in yet */ }
  }));

  // Management: remove someone (and hand over their open deals).
  app.post('/api/team/remove', route(async req => {
    const caller = await managementFrom(req);
    const { auth, db } = admin();
    const member = await getMember(db, req.body?.memberId);
    if (member.id === caller.memberId) throw new UserError(400, 'self-remove', 'You cannot remove yourself. Ask the other Management person to do it.');
    if (member.role === 'management' && (await activeManagementCount(db)) <= 1) {
      throw new UserError(400, 'last-management', 'The CRM needs at least one Management person.');
    }

    const deals = await db.collection('pipelines').where('ownerId', '==', member.id).get();
    const openDeals = deals.docs.filter(d => !['Won', 'Lost'].includes(d.data().status));
    let receiver: any = null;
    if (openDeals.length > 0) {
      receiver = await getMember(db, req.body?.transferToId);
      if (!receiver.active || receiver.id === member.id) throw new UserError(400, 'bad-receiver', 'Choose an active person to take over the open deals.');
    }

    const batch = db.batch();
    batch.update(db.collection('team').doc(member.id), { active: false, removedAt: Date.now() });
    batch.delete(db.collection('auth_map').doc(member.id));
    openDeals.forEach(d => batch.update(d.ref, { ownerId: receiver.id, ownerName: receiver.name }));
    await batch.commit();
    try { await auth.revokeRefreshTokens(member.id); } catch { /* never logged in yet */ }
    return { movedDeals: openDeals.length, receiverName: receiver?.name || null };
  }));

  // Management: give a removed person access again.
  app.post('/api/team/reactivate', route(async req => {
    await managementFrom(req);
    const password = validatePassword(req.body?.password);
    const mustChange = req.body?.mustChangePassword !== false;
    const { db } = admin();
    const member = await getMember(db, req.body?.memberId);
    await assertNameFree(db, String(member.name || ''), member.id);
    const { hash, salt } = await hashPassword(password);
    const batch = db.batch();
    batch.update(db.collection('team').doc(member.id), { active: true, mustChangePassword: mustChange, removedAt: null });
    batch.set(db.collection('auth_map').doc(member.id), { memberId: member.id, role: member.role, active: true });
    batch.set(db.collection('secrets').doc(member.id), { hash, salt, updatedAt: Date.now() });
    await batch.commit();
  }));
}
