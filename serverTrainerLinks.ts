// Trainer links, the public part (Joel, 2026-10-17). A trainer opens /t/<token> without logging in.
// These two routes are the only way in: they read the link with the server's own access and
// return just what the form needs (the programme title, who is asking, the trainer's current
// details), and store what the trainer submits. The trainer never touches the database directly.
// Since 2026-10-26 a course outline or teambuilding proposal link writes straight into that CRM record
// (serverTrainerDocs.ts writeTrainerParts), never once it's sent to a client. Profile links are still reviewed and
// accepted in the CRM (src/lib/trainerLinks.ts).

import type { Express, Request } from 'express';
import type { DocumentReference, Firestore } from 'firebase-admin/firestore';
import { admin, callerFrom, UserError, route } from './serverAuth';
import { activityLibrary, buildRecord, readForTrainer, writeTrainerParts } from './serverTrainerDocs';
import {
  cleanOutline, cleanProfile, isExpired, isOldOutlineLink, outlineProblem, profileProblem,
} from './src/lib/trainerLinks';
import { privateOf, splitTrainerPrivate, withPrivate } from './src/lib/trainerProfile';

// Light protection against someone hammering the links: 40 requests a minute per address.
const hits = new Map<string, { n: number; since: number }>();
function slowDown(req: Request, most = 40) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.since > 60_000) { hits.set(ip, { n: 1, since: now }); return; }
  if (++h.n > most) throw new UserError(429, 'too-many', 'Too many tries. Wait a minute and try again.');
}

async function openLink(token: any) {
  const t = String(token || '');
  if (!/^[a-f0-9]{32}$/.test(t)) throw new UserError(404, 'link-not-found', 'This link is not valid. Ask NEXT Academy for a new one.');
  const { db } = admin();
  const ref = db.collection('trainer_links').doc(t);
  const snap = await ref.get();
  if (!snap.exists) throw new UserError(404, 'link-not-found', 'This link is not valid. Ask NEXT Academy for a new one.');
  let link: any = snap.data();
  if (link.status === 'cancelled') throw new UserError(410, 'link-closed', 'This link has been cancelled. Ask NEXT Academy for a new one if needed.');
  if (link.status === 'accepted') throw new UserError(410, 'link-done', 'Thank you, NEXT Academy has already received and accepted this. The link is now closed.');
  if (isExpired(link)) throw new UserError(410, 'link-expired', 'This link has expired. Ask NEXT Academy for a new one.');
  link = await upgradeOldOutlineLink(db, ref, link);
  return { db, ref, link };
}

const firstName = (n: string) => String(n || '').trim().split(/\s+/)[0] || 'NEXT Academy';

// Outline links from before 2026-10-26 switched to the one-record way (Joel, 2026-10-26). An invite with no outline
// gets its outline now (general, owned by whoever invited, with what the trainer already sent); a submission waiting
// for Accept goes into its outline, unless that outline was sent to a client (then it stays for Accept). Runs when the
// trainer opens or submits the link, and when someone opens Course outlines (/api/trainer-link/upgrade-old).
export async function upgradeOldOutlineLink(db: Firestore, ref: DocumentReference, link: any): Promise<any> {
  if (!isOldOutlineLink(link)) return link;
  const sub = link.status === 'submitted' && link.submission ? link.submission : undefined;
  const who = { trainerId: String(link.trainerId || ''), trainerName: String(link.trainerName || '') };
  if (!link.outlineId) {
    const { rec } = await buildRecord(db, 'outline', String(link.programmeId || ''), who,
      sub ? { programmeId: String(link.programmeId || ''), outline: sub } : undefined, sub ? Number(link.submittedAt) || undefined : undefined,
      { id: String(link.requestedById || ''), name: String(link.requestedByName || '') });
    if (!sub && !rec.useProgrammeName && link.title) rec.courseTitle = String(link.title);   // the invite's title, typed then
    // One outline per link, even if two upgrades run at once: the second finds the link already done.
    return db.runTransaction(async tx => {
      const now: any = (await tx.get(ref)).data();
      if (!now || now.outlineId) return now;
      const up = { outlineId: rec.id, ...(sub ? { applied: true } : {}) };
      tx.set(db.collection('course_outlines').doc(rec.id), rec);
      tx.update(ref, up);
      return { ...now, ...up };
    });
  }
  try {
    await writeTrainerParts(db, 'outline', link.outlineId, { outline: sub }, who);
    await ref.update({ applied: true });
    return { ...link, applied: true };
  } catch (e: any) {
    if (e?.code !== 'locked' && e?.code !== 'not-found') throw e;
    await ref.update({ keptForReview: true });   // sent to a client (or the outline is gone): Accept stays
    return { ...link, keptForReview: true };
  }
}

export function registerTrainerLinkRoutes(app: Express) {
  // Course outlines opened in the CRM: switch every old outline link still working the old way (see above).
  app.post('/api/trainer-link/upgrade-old', route(async req => {
    await callerFrom(req);
    const { db } = admin();
    const old = (await db.collection('trainer_links').where('kind', '==', 'outline').get()).docs.filter(d => isOldOutlineLink(d.data() as any));
    let done = 0;
    for (const d of old) {
      try { await upgradeOldOutlineLink(db, d.ref, d.data()); done++; } catch (e) { console.error('Old outline link not switched:', d.id, e); }
    }
    return { done };
  }));

  // What the form shows.
  app.post('/api/trainer-link/get', route(async req => {
    slowDown(req);
    const { db, link } = await openLink(req.body?.token);
    const out: any = {
      kind: link.kind, title: link.title || '', askedBy: firstName(link.requestedByName),
      trainerName: link.trainerName || '', status: link.status, expiresAt: link.expiresAt,
    };
    if (link.kind === 'profile') {
      const progs = await db.collection('programmes').get();
      out.programmes = progs.docs.map(d => ({ id: d.id, name: String(d.data().name || '').trim() })).filter(p => p.name).sort((a, b) => a.name.localeCompare(b.name));
      // Their personal details (gender, address, emergency contact, race, nationality, rate) are kept apart, in
      // trainer_private / trainer_link_private (process audit, 2026-10-22: PDPA); the trainer still sees their own.
      const ownPriv: any = link.trainerId ? (await db.collection('trainer_private').doc(link.trainerId).get()).data() : undefined;
      const linkPriv: any = (await db.collection('trainer_link_private').doc(String(req.body?.token)).get()).data();
      const t: any = link.trainerId ? withPrivate((await db.collection('trainers_directory').doc(link.trainerId).get()).data() || {}, ownPriv) : null;
      // Files and photo already on their record: the form says so (a new upload replaces them). Links aren't sent.
      if (t) out.onFile = { photo: !!t.photoUrl, docs: Object.keys(t.docs || {}).filter(k => t.docs[k]) };
      // Whether we already have their IC / passport number (the number itself is never sent back).
      out.icOnFile = !!linkPriv?.icNumber || !!ownPriv?.icNumber || !!t?.icOnFile;
      if (link.submission) out.prefill = { ...link.submission, ...privateOf(linkPriv) };
      else if (t) {
        out.prefill = {
          name: t.name || '', contact: t.contact || '', email: t.email || '', bio: t.bio || '', experienceYears: t.experienceYears || 0,
          qualifications: t.qualifications || '', pastClients: t.pastClients || '', programmeIds: t.programmeIds || [],
          suggestedTopics: t.suggestedTopics || '', rate: t.rate || 0,
          gender: t.gender || '', address: t.address || '', emergencyContact: t.emergencyContact || {}, languages: t.languages || [],
          languagesOther: t.languagesOther || '', trainingTypes: t.trainingTypes || [], otherCerts: t.otherCerts || '',
          linkedin: t.linkedin || '', youtube: t.youtube || '', otherSocial: t.otherSocial || '',
          nationality: t.nationality || '', race: t.race || '', tttNumber: t.tttNumber || '', academic: t.academic || [],
          professional: t.professional || [], career: t.career || [], trainingExp: t.trainingExp || [],
        };
      }
    } else if (link.kind === 'teambuilding') {
      // The proposal itself (2026-10-26): the trainer's parts only, never packages, prices, venues or the client.
      const { row } = await readForTrainer(db, 'teambuilding', link.proposalId);
      out.prefill = row.draft.tb;
      out.stamp = row.stamp;
      out.locked = row.locked;
      out.trainerId = link.trainerId || '';
      const t: any = link.trainerId ? (await db.collection('trainers_directory').doc(link.trainerId).get()).data() : null;
      out.profile = { name: t?.name || link.trainerName || '', bio: t?.bio || '', photoUrl: t?.photoUrl || '' };
    } else if (link.outlineId) {
      // The outline itself (2026-10-26): what it has now, cleaned the same way as a submission, so only the
      // outline's own content goes out. The course title starts as the programme's name; the trainer can change it.
      const { row } = await readForTrainer(db, 'outline', link.outlineId);
      out.prefill = row.draft.outline;
      out.stamp = row.stamp;
      out.locked = row.locked;
      if (!out.prefill.courseTitle) out.prefill.courseTitle = row.title || link.title || '';
    } else {
      // An invite from before 2026-10-26 (no outline yet): it waits for the team to accept it.
      if (link.submission) out.prefill = link.submission;
      if (out.prefill && !out.prefill.courseTitle) out.prefill.courseTitle = link.title || '';
    }
    return out;
  }));

  // A teambuilding link saves as the trainer types, straight into the proposal.
  app.post('/api/trainer-link/save', route(async req => {
    slowDown(req, 120);
    const { db, ref, link } = await openLink(req.body?.token);
    if (link.kind !== 'teambuilding') throw new UserError(400, 'invalid', 'This link is not for a teambuilding proposal.');
    const row = await writeTrainerParts(db, 'teambuilding', link.proposalId, { tb: req.body?.tb }, {
      trainerId: link.trainerId || '', trainerName: link.trainerName || '', stamp: String(req.body?.stamp || ''), folder: `trainer_uploads/${ref.id}/`,
    });
    await ref.update({ submittedAt: Date.now(), status: 'submitted', applied: true });
    return { stamp: row.stamp };
  }));

  // The Activity library, for a teambuilding link.
  app.post('/api/trainer-link/library', route(async req => {
    slowDown(req);
    const { db, link } = await openLink(req.body?.token);
    if (link.kind !== 'teambuilding') throw new UserError(400, 'invalid', 'This link is not for a teambuilding proposal.');
    return { activities: await activityLibrary(db) };
  }));

  // The trainer submits (again, if they want to correct it, until the team accepts it).
  app.post('/api/trainer-link/submit', route(async req => {
    slowDown(req);
    const { db, ref, link } = await openLink(req.body?.token);
    let submission: any;
    if (link.kind === 'profile') {
      const ids = (await db.collection('programmes').get()).docs.map(d => d.id);
      submission = cleanProfile(req.body?.data, ids, ref.id);
      const problem = profileProblem(submission);
      if (problem) throw new UserError(400, 'invalid', problem);
      // The IC / passport number never goes in the link (which every team member can read): it's kept in
      // trainer_link_private/{token}, which only Admin and Management can read. Left blank = keep the earlier one.
      // The personal details go there too (process audit, 2026-10-22: PDPA); the link keeps just privateSent.
      const ic = submission.icNumber;
      delete submission.icNumber;
      const { publicPart, privatePart } = splitTrainerPrivate(submission);
      submission = publicPart;
      const priv = db.collection('trainer_link_private').doc(ref.id);
      await priv.set({ ...privatePart, detailsAt: Date.now(), ...(ic ? { icNumber: ic, at: Date.now() } : {}) }, { merge: true });
      submission.icSent = !!ic || !!(await priv.get()).data()?.icNumber;
      submission.privateSent = true;
    } else if (link.kind === 'outline') {
      submission = cleanOutline(req.body?.data);
      const problem = outlineProblem(submission);
      if (problem) throw new UserError(400, 'invalid', problem);
      // Straight into the outline (2026-10-26); the link keeps a note of what was sent.
      if (link.outlineId) {
        const row = await writeTrainerParts(db, 'outline', link.outlineId, { outline: submission }, {
          trainerId: link.trainerId || '', trainerName: link.trainerName || '', stamp: String(req.body?.stamp || ''),
        });
        await ref.update({ submission, submittedAt: Date.now(), status: 'submitted', applied: true });
        return { stamp: row.stamp };
      }
    } else {
      throw new UserError(400, 'invalid', 'This link is for a teambuilding proposal: it saves as you type.');
    }
    await ref.update({ submission, submittedAt: Date.now(), status: 'submitted' });
    return {};
  }));
}
