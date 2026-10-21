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
import { dealStage, todayIso, trainingDays, trainingEndDate } from './src/lib/deals';
import { effectiveVenue } from './src/lib/checklist';
import { isDeletedRecord, ownedByTeam } from './src/lib/linked';
import {
  bankProblem, claimFolder, claimProblem, cleanBank, cleanEmail, cleanFiles, cleanTin, emailProblem, feeStatusText,
  jobId, portalFolder, portalUid, sameBank, trainerIdFromUid,
} from './src/lib/trainerPortal';

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

export function registerTrainerPortalRoutes(app: Express) {
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
    const clash = await db.collection('trainer_accounts').where('email', '==', email).get();
    if (clash.docs.some(d => d.id !== trainerId)) throw new UserError(409, 'email-taken', 'Another trainer already logs in with that email.');
    const uid = portalUid(trainerId);
    try {
      await auth.updateUser(uid, { email, disabled: false });
    } catch (e: any) {
      if (e?.code === 'auth/user-not-found') {
        try { await auth.createUser({ uid, email, password: crypto.randomBytes(24).toString('base64url'), emailVerified: false }); }
        catch (e2: any) {
          if (e2?.code === 'auth/email-already-exists') throw new UserError(409, 'email-taken', 'That email is already used by another login.');
          throw e2;
        }
      } else if (e?.code === 'auth/email-already-exists') {
        throw new UserError(409, 'email-taken', 'That email is already used by another login.');
      } else throw e;
    }
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
    const progName = (id?: string) => String(progs.docs.find(d => d.id === id)?.data().name || '').trim();
    const vendor: any = vendorDoc?.data() || null;
    const today = todayIso();
    const trainings = [];
    for (const { deal, task, checklist } of await myTrainings(db, trainerId)) {
      const quotes = (await db.collection('quotations').where('pipelineId', '==', deal.id).get()).docs.map(d => ({ ...d.data(), id: d.id }));
      const venue = effectiveVenue((checklist.tasks || []).find((x: any) => x.kind === 'venue'), quotes, venues.docs.map(d => ({ ...d.data(), id: d.id })));
      const venueRec: any = venue?.id ? venues.docs.find(d => d.id === venue.id)?.data() : null;
      const job: any = (await db.collection('trainer_jobs').doc(jobId(deal.id, trainerId)).get()).data() || {};
      const lines = await feeLines(db, deal.id, task.id, trainerId);
      const start = String(deal.trainingDate || '').slice(0, 10);
      trainings.push({
        dealId: deal.id,
        programme: progName(deal.programmeId) || deal.courseName || 'Training',
        client: String(clients.docs.find(d => d.id === deal.clientId)?.data().companyName || deal.client || ''),
        start, end: trainingEndDate(deal), days: trainingDays(deal),
        venue: venue && !(checklist.tasks || []).some((x: any) => x.kind === 'venue' && x.needed === false) ? { name: venue.name, region: venueRec?.region || '' } : null,
        confirmed: !!task.done,
        po: (await poFiles(db, deal.id, task.id)).map(f => ({ id: f.id, name: f.name, at: f.at })),
        poAcceptedAt: job.poAcceptedAt || '',
        fee: lines.filter(o => o.status !== 'rejected').map(o => ({ id: o.id, description: o.description || '', amount: Number(o.amount) || 0, status: o.status, statusText: feeStatusText(o) })),
        claim: job.claim ? { status: job.claim.status, submittedAt: job.claim.submittedAt, returnNote: job.claim.returnNote || '', photos: job.claim.photos || [], t3: job.claim.t3 || [] } : null,
        rating: job.rating ? { stars: job.rating.stars, note: job.rating.note || '', at: job.rating.at } : null,
        started: !!start && start <= today,
        ended: !!trainingEndDate(deal) && trainingEndDate(deal) < today,
      });
    }
    trainings.sort((a, b) => (a.start || '9999').localeCompare(b.start || '9999'));
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
    const { deal, task } = await assigned(db, trainerId, req.body?.dealId);
    if (!(await poFiles(db, deal.id, task.id)).length) throw new UserError(400, 'no-po', "There's no PO on this training yet.");
    await db.collection('trainer_jobs').doc(jobId(deal.id, trainerId)).set({ dealId: deal.id, trainerId, poAcceptedAt: nowIso() }, { merge: true });
    await addDealHistory(db, deal.id, '', (t.name || 'Trainer') + PORTAL, 'Trainer accepted the PO');
    return {};
  }));

  // Request training fee: photos + T3 (the training report comes later). Marks the deal's trainer fee lines
  // (raised by Admin on the Trainer step) and puts a red flag in Admin work. No amount is typed here.
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
    await Promise.all(live.filter(o => o.status !== 'paid').map(o => o.ref.update({ trainerClaimAt: at })));
    await addDealHistory(db, deal.id, '', by, `Trainer requested their fee (${photos.length} photo${photos.length === 1 ? '' : 's'}, T3 attached)`);
    return {};
  }));
}
