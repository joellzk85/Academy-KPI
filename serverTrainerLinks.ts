// Trainer links, the public part (Joel, 2026-10-17). A trainer opens /t/<token> without logging in.
// These two routes are the only way in: they read the link with the server's own access and
// return just what the form needs (the programme title, who is asking, the trainer's current
// details), and store what the trainer submits. The trainer never touches the database directly.
// The team reviews and accepts the submission inside the CRM (src/lib/trainerLinks.ts).

import type { Express, Request } from 'express';
import { admin, UserError, route } from './serverAuth';
import {
  cleanOutline, cleanProfile, isExpired, outlineProblem, profileProblem,
} from './src/lib/trainerLinks';

// Light protection against someone hammering the links: 40 requests a minute per address.
const hits = new Map<string, { n: number; since: number }>();
function slowDown(req: Request) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.since > 60_000) { hits.set(ip, { n: 1, since: now }); return; }
  if (++h.n > 40) throw new UserError(429, 'too-many', 'Too many tries. Wait a minute and try again.');
}

async function openLink(token: any) {
  const t = String(token || '');
  if (!/^[a-f0-9]{32}$/.test(t)) throw new UserError(404, 'link-not-found', 'This link is not valid. Ask NEXT Academy for a new one.');
  const { db } = admin();
  const ref = db.collection('trainer_links').doc(t);
  const snap = await ref.get();
  if (!snap.exists) throw new UserError(404, 'link-not-found', 'This link is not valid. Ask NEXT Academy for a new one.');
  const link: any = snap.data();
  if (link.status === 'cancelled') throw new UserError(410, 'link-closed', 'This link has been cancelled. Ask NEXT Academy for a new one if needed.');
  if (link.status === 'accepted') throw new UserError(410, 'link-done', 'Thank you, NEXT Academy has already received and accepted this. The link is now closed.');
  if (isExpired(link)) throw new UserError(410, 'link-expired', 'This link has expired. Ask NEXT Academy for a new one.');
  return { db, ref, link };
}

const firstName = (n: string) => String(n || '').trim().split(/\s+/)[0] || 'NEXT Academy';

export function registerTrainerLinkRoutes(app: Express) {
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
      const t: any = link.trainerId ? (await db.collection('trainers_directory').doc(link.trainerId).get()).data() || {} : null;
      // Files and photo already on their record: the form says so (a new upload replaces them). Links aren't sent.
      if (t) out.onFile = { photo: !!t.photoUrl, docs: Object.keys(t.docs || {}).filter(k => t.docs[k]) };
      // Whether we already have their IC / passport number (the number itself is never sent back).
      out.icOnFile = (await db.collection('trainer_link_private').doc(String(req.body?.token)).get()).exists
        || (!!link.trainerId && ((await db.collection('trainer_private').doc(link.trainerId).get()).exists || !!t?.icOnFile));
      if (link.submission) out.prefill = link.submission;
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
    } else {
      if (link.submission) out.prefill = link.submission;
      else if (link.outlineId) {
        const o = (await db.collection('course_outlines').doc(link.outlineId).get()).data();
        // What the outline already has (cleaned the same way as a submission, so only the outline's own content goes out).
        if (o) out.prefill = cleanOutline({ ...o, courseTitle: o.useProgrammeName ? '' : o.courseTitle, level: undefined });
      }
      // The course title starts as the programme's (or the outline's) name; the trainer can change it.
      if (out.prefill && !out.prefill.courseTitle) out.prefill.courseTitle = link.title || '';
    }
    return out;
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
      const ic = submission.icNumber;
      delete submission.icNumber;
      const priv = db.collection('trainer_link_private').doc(ref.id);
      if (ic) await priv.set({ icNumber: ic, at: Date.now() });
      submission.icSent = !!ic || (await priv.get()).exists;
    } else {
      submission = cleanOutline(req.body?.data);
      const problem = outlineProblem(submission);
      if (problem) throw new UserError(400, 'invalid', problem);
    }
    await ref.update({ submission, submittedAt: Date.now(), status: 'submitted' });
    return {};
  }));
}
