// Trainer portal, the server side (Joel, 2026-10-21; see src/lib/trainerPortal.ts for the records).
// - Admin and Management give a trainer access (email) or turn it off: /api/trainer-portal/access and /off.
// - A trainer logs in at /trainer with Firebase email + password. Their login has no auth_map record, so the
//   database gives them nothing directly; every /api/portal/* route below checks who they are and returns
//   only that trainer's own details, trainings, PO, fee and rating.
// - Bank account changes wait for Admin or Management (trainer_bank_requests). Everything else saves straight away.

import type { Express, Request, Response } from 'express';
import crypto from 'crypto';
import { getApps } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import type { Firestore } from 'firebase-admin/firestore';
import firebaseConfig from './firebase-applet-config.json';
import { UserError, admin, callerFrom, route } from './serverAuth';
import { addDealHistory } from './serverDocLinks';
import { cleanProfile, profileProblem } from './src/lib/trainerLinks';
import { DOC_KINDS } from './src/lib/trainerProfile';
import { dealStage, todayIso, trainingDateText, trainingDays, trainingEndDate } from './src/lib/deals';
import { effectiveVenue } from './src/lib/checklist';
import { isDeletedRecord, ownedByTeam } from './src/lib/linked';
import {
  bankProblem, buildPo, calendarPath, claimFolder, claimProblem, cleanBank, cleanEmail, cleanFiles, cleanTin, emailProblem, feeStatusText,
  icsCalendar, inviteLive, jobId, passwordProblem, portalFolder, portalUid, sameBank, trainerIdFromUid,
} from './src/lib/trainerPortal';
import { FieldValue } from 'firebase-admin/firestore';

const BUCKET = String((firebaseConfig as any).storageBucket || '');
const nowIso = () => new Date().toISOString();
const PORTAL = ' (trainer portal)';

// ---------- Who is calling ----------
async function staffFrom(req: Request) {
  const caller = await callerFrom(req);
  if (caller.role !== 'admin' && caller.role !== 'management') throw new UserError(403, 'staff-only', 'Only Admin and Management can do this.');
  const me = (await admin().db.collection('team').doc(caller.memberId).get()).data();
  return { ...caller, name: String(me?.name || 'Team') };
}

const seen = new Map<string, number>();
async function trainerFrom(req: Request) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) throw new UserError(401, 'not-logged-in', 'You are logged out. Log in again.');
  const { auth, db } = admin();
  let uid = '';
  try { uid = (await auth.verifyIdToken(token, true)).uid; }
  catch { throw new UserError(401, 'not-logged-in', 'Your login has expired. Log in again.'); }
  const trainerId = trainerIdFromUid(uid);
  if (!trainerId) throw new UserError(403, 'no-access', 'This login is not a trainer portal login.');
  const [acc, tr] = await Promise.all([db.collection('trainer_accounts').doc(trainerId).get(), db.collection('trainers_directory').doc(trainerId).get()]);
  if (!acc.exists || !acc.data()?.active || !tr.exists) throw new UserError(403, 'no-access', 'Your portal access has been turned off. Contact NEXT Academy if you think this is a mistake.');
  if (Date.now() - (seen.get(trainerId) || 0) > 10 * 60_000) {
    seen.set(trainerId, Date.now());
    acc.ref.update({ lastSeenAt: nowIso() }).catch(() => {});
  }
  return { db, trainerId, trainer: { ...(tr.data() as any), id: trainerId }, account: acc.data() as any };
}

async function logAccount(db: Firestore, trainerId: string, byName: string, action: string) {
  const ref = db.collection('trainer_accounts').doc(trainerId);
  await db.runTransaction(async tx => {
    const a: any = (await tx.get(ref)).data();
    if (!a) return;
    tx.update(ref, { history: [...(a.history || []), { at: nowIso(), byName, action }].slice(-40) });
  }).catch(e => console.error('[portal] history', e));
}

// ---------- The trainer's trainings ----------
// A training is a won deal (not deleted, owner on the Team list) whose checklist Trainer step names this trainer.
async function myTrainings(db: Firestore, trainerId: string) {
  const [lists, team] = await Promise.all([db.collection('deal_checklists').get(), db.collection('team').get()]);
  const teamIds = new Set(team.docs.map(d => d.id));
  const mine = lists.docs
    .map(d => ({ dealId: d.id, data: d.data() as any }))
    .map(c => ({ ...c, task: (c.data.tasks || []).find((t: any) => t.kind === 'trainer' && t.trainerId === trainerId) }))
    .filter(c => c.task);
  const out: any[] = [];
  for (const c of mine) {
    const snap = await db.collection('pipelines').doc(c.dealId).get();
    const deal: any = snap.exists ? { ...snap.data(), id: snap.id } : null;
    if (!deal || dealStage(deal) !== 'won' || !ownedByTeam(deal, teamIds)) continue;
    out.push({ deal, checklist: c.data, task: c.task });
  }
  return out;
}

// Fee lines for this trainer on that training: cost lines on the Trainer step whose vendor is this trainer (or no vendor).
async function feeLines(db: Firestore, dealId: string, taskId: string, trainerId: string) {
  const snap = await db.collection('money_out').where('dealId', '==', dealId).get();
  const lines = snap.docs.map(d => ({ ...(d.data() as any), id: d.id, ref: d.ref })).filter(o => o.checklistTaskId === taskId && !isDeletedRecord(o));
  const vendorIds = [...new Set(lines.map(o => o.vendorId).filter(Boolean))];
  const vendorTrainer: Record<string, string> = {};
  for (const v of vendorIds) vendorTrainer[v] = String((await db.collection('vendors').doc(v).get()).data()?.trainerId || '');
  return lines.filter(o => !o.vendorId || !vendorTrainer[o.vendorId] || vendorTrainer[o.vendorId] === trainerId);
}

async function trainerVendor(db: Firestore, trainerId: string) {
  const snap = await db.collection('vendors').where('trainerId', '==', trainerId).limit(1).get();
  return snap.empty ? null : snap.docs[0];
}

async function assigned(db: Firestore, trainerId: string, dealId: any) {
  const id = String(dealId || '');
  const found = (await myTrainings(db, trainerId)).find(x => x.deal.id === id);
  if (!found) throw new UserError(404, 'not-yours', "That training isn't on your list. Refresh the page.");
  return found;
}

async function poFiles(db: Firestore, dealId: string, taskId: string) {
  const snap = await db.collection('checklist_files').where('dealId', '==', dealId).get();
  return snap.docs.map(d => ({ ...(d.data() as any), id: d.id })).filter(f => f.taskId === taskId);
}

// Everything the portal shows about each training (My trainings, My calendar and the calendar link).
// The PO: files uploaded on the Trainer step if any; else, once there's a fee line, the PO made automatically
// (poAuto); once accepted, the copy kept on trainer_jobs.po.
async function trainingDetails(db: Firestore, trainerId: string, trainer: any, pre?: { progs?: any; venues?: any; clients?: any; vendor?: any }) {
  const [progs, venues, clients, vendor] = await Promise.all([
    pre?.progs || db.collection('programmes').get(), pre?.venues || db.collection('venues_directory').get(), pre?.clients || db.collection('clients').get(),
    pre?.vendor !== undefined ? pre.vendor : trainerVendor(db, trainerId).then(d => d?.data() || null),
  ]);
  const progName = (id?: string) => String(progs.docs.find((d: any) => d.id === id)?.data().name || '').trim();
  const today = todayIso();
  const trainings = [];
  for (const { deal, task, checklist } of await myTrainings(db, trainerId)) {
    const quotes = (await db.collection('quotations').where('pipelineId', '==', deal.id).get()).docs.map(d => ({ ...d.data(), id: d.id }));
    const venue = effectiveVenue((checklist.tasks || []).find((x: any) => x.kind === 'venue'), quotes, venues.docs.map((d: any) => ({ ...d.data(), id: d.id })));
    const venueRec: any = venue?.id ? venues.docs.find((d: any) => d.id === venue.id)?.data() : null;
    const job: any = (await db.collection('trainer_jobs').doc(jobId(deal.id, trainerId)).get()).data() || {};
    const lines = (await feeLines(db, deal.id, task.id, trainerId)).filter(o => o.status !== 'rejected');
    const files = await poFiles(db, deal.id, task.id);
    const start = String(deal.trainingDate || '').slice(0, 10);
    const client = String(clients.docs.find((d: any) => d.id === deal.clientId)?.data().companyName || deal.client || '');
    const venueOn = venue && !(checklist.tasks || []).some((x: any) => x.kind === 'venue' && x.needed === false);
    const programme = progName(deal.programmeId) || deal.courseName || 'Training';
    trainings.push({
      dealId: deal.id,
      programme, client,
      start, end: trainingEndDate(deal), days: trainingDays(deal),
      venue: venueOn ? { name: venue.name, region: venueRec?.region || '' } : null,
      confirmed: !!task.done,
      po: files.map(f => ({ id: f.id, name: f.name, at: f.at })),
      poAuto: !files.length && lines.length
        ? buildPo({ deal: { ...deal, courseName: deal.courseName || programme }, dates: trainingDateText(deal, true), date: today, trainer, client, venue: venueOn ? venue.name : '',
            lines: lines.map(o => ({ description: String(o.description || '').trim() || 'Trainer fee', amount: Number(o.amount) || 0 })), vendor })
        : null,
      poAccepted: job.po || null,
      poAcceptedAt: job.poAcceptedAt || '',
      poDeclined: job.poDeclined || null,
      fee: lines.map(o => ({ id: o.id, description: o.description || '', amount: Number(o.amount) || 0, status: o.status, statusText: feeStatusText(o) })),
      claim: job.claim ? { status: job.claim.status, submittedAt: job.claim.submittedAt, returnNote: job.claim.returnNote || '', photos: job.claim.photos || [], t3: job.claim.t3 || [] } : null,
      rating: job.rating ? { stars: job.rating.stars, note: job.rating.note || '', at: job.rating.at } : null,
      started: !!start && start <= today,
      ended: !!trainingEndDate(deal) && trainingEndDate(deal) < today,
    });
  }
  trainings.sort((a, b) => (a.start || '9999').localeCompare(b.start || '9999'));
  return trainings;
}

// The trainer's private calendar link (trainer_calendars/{token}, server only). A new one stops the old one.
async function calendarToken(db: Firestore, trainerId: string, fresh: boolean) {
  const mine = await db.collection('trainer_calendars').where('trainerId', '==', trainerId).get();
  if (!fresh && !mine.empty) return mine.docs[0].id;
  await Promise.all(mine.docs.map(d => d.ref.delete()));
  const token = crypto.randomBytes(20).toString('hex');
  await db.collection('trainer_calendars').doc(token).set({ trainerId, at: nowIso() });
  return token;
}

// Makes or updates a trainer's Firebase email login (id tr_<trainerId>). With no password, a random one is set
// (the trainer then chooses theirs through the reset email).
async function upsertLogin(db: Firestore, trainerId: string, email: string, password?: string) {
  const { auth } = admin();
  const clash = await db.collection('trainer_accounts').where('email', '==', email).get();
  if (clash.docs.some(d => d.id !== trainerId)) throw new UserError(409, 'email-taken', 'Another trainer already logs in with that email.');
  const uid = portalUid(trainerId);
  const taken = () => new UserError(409, 'email-taken', 'That email is already used by another login. Use a different email, or ask NEXT Academy.');
  try {
    await auth.updateUser(uid, { email, disabled: false, ...(password ? { password } : {}) });
  } catch (e: any) {
    if (e?.code === 'auth/email-already-exists') throw taken();
    if (e?.code !== 'auth/user-not-found') throw e;
    try { await auth.createUser({ uid, email, password: password || crypto.randomBytes(24).toString('base64url'), emailVerified: false }); }
    catch (e2: any) { if (e2?.code === 'auth/email-already-exists') throw taken(); throw e2; }
  }
}

// Light protection for the invite routes (no login): 30 requests a minute per address.
const hits = new Map<string, { n: number; since: number }>();
function slowDown(req: Request) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.since > 60_000) { hits.set(ip, { n: 1, since: now }); return; }
  if (++h.n > 30) throw new UserError(429, 'too-many', 'Too many tries. Wait a minute and try again.');
}

async function openInvite(db: Firestore, token: any) {
  const t = String(token || '');
  const bad = () => new UserError(404, 'invite-not-found', 'This invite link is not valid. Ask NEXT Academy for a new one.');
  if (!/^[a-f0-9]{32}$/.test(t)) throw bad();
  const ref = db.collection('portal_invites').doc(t);
  const inv: any = (await ref.get()).data();
  if (!inv) throw bad();
  if (inv.status === 'used') throw new UserError(410, 'invite-used', 'This invite has already been used. Log in with your email and password, or use "Forgot password".');
  if (inv.status === 'cancelled') throw new UserError(410, 'invite-cancelled', 'This invite was cancelled. Ask NEXT Academy for a new one.');
  if (!inviteLive(inv)) throw new UserError(410, 'invite-expired', 'This invite has expired. Ask NEXT Academy for a new one.');
  const trainer: any = inv.trainerId ? (await db.collection('trainers_directory').doc(inv.trainerId).get()).data() : null;
  if (inv.trainerId && !trainer) throw new UserError(410, 'invite-trainer-gone', 'This invite is no longer valid. Ask NEXT Academy for a new one.');
  return { ref, inv, trainer };
}

export function registerTrainerPortalRoutes(app: Express) {
  // ---------- Invite links (no login) ----------
  app.post('/api/portal-invite/get', route(async req => {
    slowDown(req);
    const { db } = admin();
    const { inv, trainer } = await openInvite(db, req.body?.token);
    const acc: any = inv.trainerId ? (await db.collection('trainer_accounts').doc(inv.trainerId).get()).data() : null;
    return { name: trainer?.name || inv.name || '', email: acc?.email || trainer?.email || '', isNew: !inv.trainerId, invitedBy: String(inv.createdByName || '').split(' ')[0] || 'NEXT Academy' };
  }));

  // The trainer types their email and a password: the login is made, a new person is added to Trainers.
  app.post('/api/portal-invite/accept', route(async req => {
    slowDown(req);
    const { db } = admin();
    const { ref, inv, trainer } = await openInvite(db, req.body?.token);
    const email = cleanEmail(req.body?.email);
    const bad = emailProblem(email) || passwordProblem(req.body?.password);
    if (bad) throw new UserError(400, 'invalid', bad);
    const name = String(req.body?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 100) || trainer?.name || inv.name;
    if (!name) throw new UserError(400, 'invalid', 'Type your full name.');
    // Claim the invite first, so the same link can't make two logins.
    await db.runTransaction(async tx => {
      const now: any = (await tx.get(ref)).data();
      if (now?.status !== 'open') throw new UserError(410, 'invite-used', 'This invite has already been used. Log in with your email and password.');
      tx.update(ref, { status: 'used', usedAt: nowIso(), usedEmail: email });
    });
    let trainerId = inv.trainerId || '';
    try {
      if (!trainerId) {
        const tRef = db.collection('trainers_directory').doc();
        trainerId = tRef.id;
        await tRef.set({ id: trainerId, name, email, contact: String(inv.phone || ''), specialization: '', programmeIds: [], status: 'Available', notes: '',
          createdAt: Date.now(), createdBy: inv.createdById || '', createdByName: `${name}${PORTAL} invite` });
      }
      await upsertLogin(db, trainerId, email, String(req.body.password));
    } catch (e) {
      // Give the link back so the trainer can try again (e.g. another email), and drop a half-made new trainer.
      await ref.update({ status: 'open', usedAt: null, usedEmail: null });
      if (!inv.trainerId && trainerId) await db.collection('trainers_directory').doc(trainerId).delete().catch(() => {});
      throw e;
    }
    const accRef = db.collection('trainer_accounts').doc(trainerId);
    const before = (await accRef.get()).exists;
    await accRef.set({ trainerId, email, active: true, updatedAt: nowIso(), ...(before ? {} : { createdAt: nowIso(), createdById: inv.createdById || '', createdByName: inv.createdByName || '' }) }, { merge: true });
    if (trainer && !trainer.email) await db.collection('trainers_directory').doc(trainerId).update({ email });
    await ref.update({ usedTrainerId: trainerId });
    await logAccount(db, trainerId, name, `Joined the portal from ${inv.createdByName || 'a team'}'s invite (${email})`);
    return { email };
  }));

  // ---------- Admin and Management ----------
  // Give a trainer portal access (or change their login email). The CRM then asks Firebase to email them a
  // "set your password" link (TrainerManager.tsx). Their profile and outline links are not touched.
  app.post('/api/trainer-portal/access', route(async req => {
    const caller = await staffFrom(req);
    const { auth, db } = admin();
    const trainerId = String(req.body?.trainerId || '');
    const email = cleanEmail(req.body?.email);
    const bad = emailProblem(email);
    if (bad) throw new UserError(400, 'bad-email', bad);
    const tr = await db.collection('trainers_directory').doc(trainerId).get();
    if (!trainerId || !tr.exists) throw new UserError(404, 'no-trainer', 'That trainer is no longer on the list.');
    await upsertLogin(db, trainerId, email);
    const ref = db.collection('trainer_accounts').doc(trainerId);
    const before: any = (await ref.get()).data();
    await ref.set({
      trainerId, email, active: true, updatedAt: nowIso(),
      ...(before ? {} : { createdAt: nowIso(), createdById: caller.memberId, createdByName: caller.name }),
    }, { merge: true });
    await logAccount(db, trainerId, caller.name, !before ? `Portal access given (${email})` : before.email !== email ? `Login email changed to ${email}` : before.active ? 'Password email sent again' : `Portal access turned on again (${email})`);
    return { email };
  }));

  app.post('/api/trainer-portal/off', route(async req => {
    const caller = await staffFrom(req);
    const { auth, db } = admin();
    const trainerId = String(req.body?.trainerId || '');
    const ref = db.collection('trainer_accounts').doc(trainerId);
    if (!trainerId || !(await ref.get()).exists) throw new UserError(404, 'no-account', "This trainer doesn't have portal access.");
    await ref.update({ active: false, updatedAt: nowIso() });
    try { await auth.updateUser(portalUid(trainerId), { disabled: true }); await auth.revokeRefreshTokens(portalUid(trainerId)); } catch { /* never logged in */ }
    await logAccount(db, trainerId, caller.name, 'Portal access turned off');
  }));

  // ---------- The trainer ----------
  // Everything the portal shows.
  app.post('/api/portal/me', route(async req => {
    const { db, trainerId, trainer: t, account } = await trainerFrom(req);
    const [progs, venues, clients, vendorDoc, bankReq, priv] = await Promise.all([
      db.collection('programmes').get(), db.collection('venues_directory').get(), db.collection('clients').get(),
      trainerVendor(db, trainerId), db.collection('trainer_bank_requests').doc(trainerId).get(), db.collection('trainer_private').doc(trainerId).get(),
    ]);
    const vendor: any = vendorDoc?.data() || null;
    const trainings = await trainingDetails(db, trainerId, t, { progs, venues, clients, vendor });
    return {
      trainerId, email: account.email,
      programmes: progs.docs.map(d => ({ id: d.id, name: String(d.data().name || '').trim() })).filter(p => p.name).sort((a, b) => a.name.localeCompare(b.name)),
      icOnFile: priv.exists || !!t.icOnFile,
      profile: {
        name: t.name || '', contact: t.contact || '', email: t.email || '', bio: t.bio || '', experienceYears: t.experienceYears || 0,
        qualifications: t.qualifications || '', pastClients: t.pastClients || '', programmeIds: t.programmeIds || [],
        suggestedTopics: t.suggestedTopics || '', rate: t.rate || 0,
        gender: t.gender || '', address: t.address || '', emergencyContact: t.emergencyContact || {}, languages: t.languages || [],
        languagesOther: t.languagesOther || '', trainingTypes: t.trainingTypes || [], otherCerts: t.otherCerts || '',
        linkedin: t.linkedin || '', youtube: t.youtube || '', otherSocial: t.otherSocial || '', photoUrl: t.photoUrl || '', docs: t.docs || {},
        nationality: t.nationality || '', race: t.race || '', tttNumber: t.tttNumber || '', academic: t.academic || [],
        professional: t.professional || [], career: t.career || [], trainingExp: t.trainingExp || [],
      },
      payment: {
        bankName: vendor?.bankName || '', accountNo: vendor?.accountNo || '', accountName: vendor?.accountName || '', tin: vendor?.tin || '',
        pending: bankReq.exists && bankReq.data()?.status === 'pending' ? cleanBank(bankReq.data()) : null,
        rejected: bankReq.exists && bankReq.data()?.status === 'rejected' ? { reason: bankReq.data()?.rejectReason || '', at: bankReq.data()?.decidedAt || '' } : null,
      },
      trainings,
    };
  }));

  // Save my profile and HRDC biodata (straight away, Joel 2026-10-21).
  app.post('/api/portal/profile', route(async req => {
    const { db, trainerId, trainer: t } = await trainerFrom(req);
    const ids = (await db.collection('programmes').get()).docs.map(d => d.id);
    const raw = req.body?.data || {};
    const s = cleanProfile(raw, ids, '', [portalFolder(trainerId)]);
    const problem = profileProblem(s);
    if (problem) throw new UserError(400, 'invalid', problem);
    // Files and photo already on the record (uploaded by the team or a link) stay when sent back unchanged.
    for (const k of DOC_KINDS) if (!s.docs[k.id] && t.docs?.[k.id] && raw.docs?.[k.id]?.url === t.docs[k.id].url) s.docs[k.id] = t.docs[k.id];
    if (!s.photoUrl && t.photoUrl && raw.photoUrl === t.photoUrl) s.photoUrl = t.photoUrl;
    const ic = s.icNumber;
    delete s.icNumber; delete s.icSent;
    const name = s.name || t.name;
    await db.collection('trainers_directory').doc(trainerId).update({ ...s, name, ...(ic ? { icOnFile: true } : {}), updatedAt: Date.now(), portalUpdatedAt: nowIso() });
    if (ic) await db.collection('trainer_private').doc(trainerId).set({ icNumber: ic, at: Date.now(), byName: name + PORTAL });
    await logAccount(db, trainerId, name, 'Profile updated');
    return {};
  }));

  // Payment details: address and TIN save straight away; a new bank account waits for Admin or Management.
  app.post('/api/portal/payment', route(async req => {
    const { db, trainerId, trainer: t } = await trainerFrom(req);
    const by = (t.name || 'Trainer') + PORTAL;
    const address = String(req.body?.address ?? '').replace(/\u0000/g, '').trim().slice(0, 500);
    const tin = cleanTin(req.body?.tin);
    const bank = cleanBank(req.body?.bank);
    const vDoc = await trainerVendor(db, trainerId);
    const vendor: any = vDoc?.data() || {};
    const bankChanged = !!(bank.bankName || bank.accountNo || bank.accountName) && !sameBank(bank, vendor);
    if (bankChanged) { const p = bankProblem(bank); if (p) throw new UserError(400, 'invalid', p); }

    await db.collection('trainers_directory').doc(trainerId).update({ address, updatedAt: Date.now(), portalUpdatedAt: nowIso() });
    if (vDoc) { if ((vendor.tin || '') !== tin) await vDoc.ref.update({ tin, updatedAt: nowIso(), updatedByName: by }); }
    else if (tin) await db.collection('vendors').add({ name: t.name || '', type: 'trainer', trainerId, tin, createdAt: nowIso(), createdById: '', createdByName: by, updatedAt: nowIso(), updatedByName: by });
    const reqRef = db.collection('trainer_bank_requests').doc(trainerId);
    if (bankChanged) {
      await reqRef.set({ trainerId, trainerName: t.name || '', ...bank, status: 'pending', at: nowIso() });
    } else if (sameBank(bank, vendor) && (await reqRef.get()).data()?.status === 'pending') {
      await reqRef.delete();   // they typed back the account already on record: nothing to review
    }
    await logAccount(db, trainerId, t.name || 'Trainer', bankChanged ? 'Payment details updated; new bank account sent for review' : 'Payment details updated');
    return { bankPending: bankChanged };
  }));

  // Download a PO from a training (only that trainer's own trainings).
  app.post('/api/portal/po', async (req: Request, res: Response) => {
    try {
      const { db, trainerId } = await trainerFrom(req);
      const { deal, task } = await assigned(db, trainerId, req.body?.dealId);
      const f = (await poFiles(db, deal.id, task.id)).find(x => x.id === String(req.body?.fileId || ''));
      if (!f) throw new UserError(404, 'no-file', 'That PO is no longer there. Refresh the page.');
      const [buf] = await getStorage(getApps()[0]).bucket(BUCKET).file(f.path).download();
      res.setHeader('Content-Type', f.type || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${String(f.name || 'PO').replace(/[^A-Za-z0-9._ -]/g, '_')}"`);
      res.send(buf);
    } catch (err: any) {
      const e = err instanceof UserError ? err : new UserError(500, 'server-error', "The PO couldn't be read. Try again in a minute.");
      if (!(err instanceof UserError)) console.error('[portal] po', err);
      res.status(e.status).json({ ok: false, code: e.code, error: e.message });
    }
  });

  app.post('/api/portal/accept-po', route(async req => {
    const { db, trainerId, trainer: t } = await trainerFrom(req);
    const { deal } = await assigned(db, trainerId, req.body?.dealId);
    const mine = (await trainingDetails(db, trainerId, t)).find(x => x.dealId === deal.id)!;
    if (!mine.po.length && !mine.poAuto) throw new UserError(400, 'no-po', "There's no PO on this training yet.");
    // A PO made automatically is kept as accepted, so later changes don't change what the trainer agreed to.
    await db.collection('trainer_jobs').doc(jobId(deal.id, trainerId)).set({
      dealId: deal.id, trainerId, poAcceptedAt: nowIso(), po: mine.po.length ? null : mine.poAuto, poDeclined: null,
    }, { merge: true });
    await addDealHistory(db, deal.id, '', (t.name || 'Trainer') + PORTAL, `Trainer accepted the PO${mine.poAuto && !mine.po.length ? ` (${mine.poAuto.number})` : ''}`);
    return {};
  }));

  // Decline the PO (Joel, 2026-10-21: "trainer can reject - it notifies in Admin work"): a reason is needed. The
  // dates are no longer blocked, and Admin work shows a red flag until another trainer is picked or Admin clears it.
  app.post('/api/portal/decline-po', route(async req => {
    const { db, trainerId, trainer: t } = await trainerFrom(req);
    const { deal } = await assigned(db, trainerId, req.body?.dealId);
    const reason = String(req.body?.reason ?? '').replace(/\u0000/g, '').trim().slice(0, 500);
    if (!reason) throw new UserError(400, 'invalid', 'Tell NEXT Academy why, so they can arrange things.');
    const start = String(deal.trainingDate || '').slice(0, 10);
    if (start && start <= todayIso()) throw new UserError(400, 'started', 'This training has already started. Call NEXT Academy instead.');
    await db.collection('trainer_jobs').doc(jobId(deal.id, trainerId)).set({
      dealId: deal.id, trainerId, poDeclined: { reason, at: nowIso() }, poAcceptedAt: FieldValue.delete(), po: null,
    }, { merge: true });
    await addDealHistory(db, deal.id, '', (t.name || 'Trainer') + PORTAL, `Trainer declined the PO: ${reason}`);
    return {};
  }));

  // "Link to my calendar": the private address for Google, Outlook or Apple calendar. { fresh: true } makes a new one.
  app.post('/api/portal/calendar-link', route(async req => {
    const { db, trainerId } = await trainerFrom(req);
    return { path: calendarPath(await calendarToken(db, trainerId, req.body?.fresh === true)) };
  }));

  // The calendar itself (no login: the calendar app fetches it every few hours). Blocked dates only, not money.
  app.get('/api/portal/calendar/:file', async (req: Request, res: Response) => {
    try {
      slowDown(req);
      const token = String(req.params.file || '').replace(/\.ics$/, '');
      if (!/^[a-f0-9]{40}$/.test(token)) throw new UserError(404, 'not-found', 'Not found');
      const { db } = admin();
      const cal: any = (await db.collection('trainer_calendars').doc(token).get()).data();
      if (!cal?.trainerId) throw new UserError(404, 'not-found', 'Not found');
      const [acc, tr] = await Promise.all([db.collection('trainer_accounts').doc(cal.trainerId).get(), db.collection('trainers_directory').doc(cal.trainerId).get()]);
      if (!acc.data()?.active || !tr.exists) throw new UserError(404, 'not-found', 'Not found');
      const list = (await trainingDetails(db, cal.trainerId, { ...tr.data(), id: cal.trainerId })).filter(x => x.start && !x.poDeclined);
      const host = `${req.headers['x-forwarded-proto'] || req.protocol}://${req.headers['x-forwarded-host'] || req.headers.host}`;
      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Cache-Control', 'private, max-age=900');
      res.send(icsCalendar('NEXT Academy trainings', list.map(x => ({
        uid: `${x.dealId}-${cal.trainerId}@nextacademy`, start: x.start, end: x.end,
        summary: `NEXT Academy: ${x.programme}${x.client ? ` (${x.client})` : ''}`,
        location: x.venue ? [x.venue.name, x.venue.region].filter(Boolean).join(', ') : '',
        description: `${x.confirmed ? 'Confirmed' : 'Being arranged'}. Details and PO: ${host}/trainer`,
      }))));
    } catch (err: any) {
      if (!(err instanceof UserError)) console.error('[portal] calendar', err);
      res.status(err instanceof UserError ? err.status : 500).type('text/plain').send(err instanceof UserError ? err.message : 'Try again later');
    }
  });

  // Request training fee: photos + T3 (the training report comes later). Saved once, on trainer_jobs (one per
  // trainer per training); the fee lines Admin raised on the Trainer step are not copied or changed, and the red
  // flag in Admin work reads both. No amount is typed here, and no payment request is made.
  app.post('/api/portal/claim', route(async req => {
    const { db, trainerId, trainer: t } = await trainerFrom(req);
    const { deal, task } = await assigned(db, trainerId, req.body?.dealId);
    const start = String(deal.trainingDate || '').slice(0, 10);
    if (!start || start > todayIso()) throw new UserError(400, 'too-early', 'You can request your fee once the training has started.');
    const folder = claimFolder(trainerId, deal.id);
    const photos = cleanFiles(req.body?.photos, folder, 40);
    const t3 = cleanFiles(req.body?.t3, folder, 10);
    const problem = claimProblem(photos, t3);
    if (problem) throw new UserError(400, 'invalid', problem);
    const lines = await feeLines(db, deal.id, task.id, trainerId);
    const live = lines.filter(o => o.status !== 'rejected');
    if (live.length && live.every(o => o.status === 'paid')) throw new UserError(400, 'paid', 'Your fee for this training has already been paid.');
    const ref = db.collection('trainer_jobs').doc(jobId(deal.id, trainerId));
    const before: any = (await ref.get()).data()?.claim;
    const at = nowIso();
    const by = (t.name || 'Trainer') + PORTAL;
    await ref.set({
      dealId: deal.id, trainerId,
      claim: { status: 'submitted', photos, t3, submittedAt: at, returnNote: '', history: [...(before?.history || []), { at, byName: by, action: before ? 'Sent again' : 'Fee requested' }].slice(-20) },
    }, { merge: true });
    await addDealHistory(db, deal.id, '', by, `Trainer requested their fee (${photos.length} photo${photos.length === 1 ? '' : 's'}, T3 attached)`);
    return {};
  }));
}
