// Trainers' own course outlines and teambuilding proposals in the portal (2026-10-21; see src/lib/trainerDocs.ts).
// The trainer only ever reaches their own trainer_docs through these routes; the team reads them in the CRM
// (members read, nobody writes from a browser) and makes our own copy with "Use for a deal".

import type { Express } from 'express';
import type { Firestore } from 'firebase-admin/firestore';
import firebaseConfig from './firebase-applet-config.json';
import { UserError, route } from './serverAuth';
import { trainerFrom } from './serverTrainerPortal';
import { TrainerDoc, TrainerDocKind, blankTrainerTb, cleanDocContent, docProblem, docSummary, docTitle } from './src/lib/trainerDocs';
import { isDeletedRecord } from './src/lib/linked';

const BUCKET = String((firebaseConfig as any).storageBucket || '');
const KINDS: TrainerDocKind[] = ['outline', 'teambuilding'];
const PLACES: Record<TrainerDocKind, string> = { outline: 'course_outlines', teambuilding: 'teambuilding_proposals' };

async function programmes(db: Firestore) {
  return (await db.collection('programmes').get()).docs
    .map(d => ({ id: d.id, name: String(d.data().name || '').trim() })).filter(p => p.name);
}

async function myDoc(db: Firestore, trainerId: string, id: any) {
  const ref = db.collection('trainer_docs').doc(String(id || '').slice(0, 80) || 'none');
  const snap = await ref.get();
  const d = snap.data() as TrainerDoc | undefined;
  if (!d || d.trainerId !== trainerId || d.archived) throw new UserError(404, 'not-found', 'This document is no longer here. Go back to your list.');
  return { ref, d: { ...d, id: ref.id } };
}

// How many of our documents were made from each of the trainer's (not counting deleted ones).
async function usedCounts(db: Firestore, docs: TrainerDoc[]) {
  const out: Record<string, number> = {};
  for (const kind of KINDS) {
    const ids = docs.filter(d => d.kind === kind).map(d => d.id);
    for (let i = 0; i < ids.length; i += 30) {
      const snap = await db.collection(PLACES[kind]).where('fromTrainerDocId', 'in', ids.slice(i, i + 30)).get();
      snap.docs.forEach(x => { const r: any = x.data(); if (!isDeletedRecord(r)) out[r.fromTrainerDocId] = (out[r.fromTrainerDocId] || 0) + 1; });
    }
  }
  return out;
}

const forTrainer = (d: TrainerDoc, used = 0) => ({
  id: d.id, kind: d.kind, draft: d.draft, version: d.version || 0, sentAt: d.sentAt || 0, updatedAt: d.updatedAt,
  unsent: !d.sent || JSON.stringify(d.draft) !== JSON.stringify(d.sent), used,
});

export function registerTrainerDocRoutes(app: Express) {
  // My course outlines and teambuilding proposals.
  app.post('/api/portal/docs/list', route(async req => {
    const { db, trainerId } = await trainerFrom(req);
    const docs = (await db.collection('trainer_docs').where('trainerId', '==', trainerId).get()).docs
      .map(x => ({ ...(x.data() as TrainerDoc), id: x.id })).filter(d => !d.archived)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const [used, progs] = await Promise.all([usedCounts(db, docs), programmes(db)]);
    return {
      docs: docs.map(d => ({ ...forTrainer(d, used[d.id] || 0), title: docTitle(d.kind, d.draft, progs), summary: docSummary(d.kind, d.draft) })),
    };
  }));

  app.post('/api/portal/docs/new', route(async req => {
    const { db, trainerId, trainer } = await trainerFrom(req);
    const kind = req.body?.kind as TrainerDocKind;
    if (!KINDS.includes(kind)) throw new UserError(400, 'invalid', 'Choose a course outline or a teambuilding proposal.');
    const progs = await programmes(db);
    const programmeId = progs.some(p => p.id === req.body?.programmeId) ? String(req.body.programmeId) : '';
    const now = Date.now();
    const draft = kind === 'outline'
      ? cleanDocContent(kind, { programmeId, outline: { courseTitle: progs.find(p => p.id === programmeId)?.name || '', durationDays: 1, totalHours: 8, items: [], designedBy: trainer.name || '' } }, trainerId, [programmeId])
      : { programmeId, tb: blankTrainerTb(trainerId) };
    const ref = db.collection('trainer_docs').doc();
    const d: Omit<TrainerDoc, 'id'> = { kind, trainerId, trainerName: String(trainer.name || ''), draft, version: 0, createdAt: now, updatedAt: now };
    await ref.set(JSON.parse(JSON.stringify(d)));
    return { doc: forTrainer({ ...d, id: ref.id }) };
  }));

  app.post('/api/portal/docs/get', route(async req => {
    const { db, trainerId } = await trainerFrom(req);
    const { d } = await myDoc(db, trainerId, req.body?.id);
    return { doc: forTrainer(d) };
  }));

  // Saves what they typed; with send: true it also becomes what NEXT Academy sees (a new version).
  app.post('/api/portal/docs/save', route(async req => {
    const { db, trainerId, trainer } = await trainerFrom(req);
    const { ref, d } = await myDoc(db, trainerId, req.body?.id);
    const ids = (await programmes(db)).map(p => p.id);
    const draft = cleanDocContent(d.kind, req.body?.draft, trainerId, ids, BUCKET);
    const now = Date.now();
    const up: any = { draft, updatedAt: now, trainerName: String(trainer.name || d.trainerName || '') };
    if (req.body?.send) {
      const problem = docProblem(d.kind, draft);
      if (problem) throw new UserError(400, 'invalid', problem);
      if (d.sent && JSON.stringify(d.sent) === JSON.stringify(draft)) return { doc: forTrainer({ ...d, ...up }), nothing: true };
      Object.assign(up, { sent: draft, version: (d.version || 0) + 1, sentAt: now });
    }
    await ref.update(JSON.parse(JSON.stringify(up)));
    return { doc: forTrainer({ ...d, ...up }) };
  }));

  // Taking it off their list. Copies NEXT Academy already made stay as they are.
  app.post('/api/portal/docs/delete', route(async req => {
    const { db, trainerId } = await trainerFrom(req);
    const { ref } = await myDoc(db, trainerId, req.body?.id);
    await ref.update({ archived: true, updatedAt: Date.now() });
    return {};
  }));

  // The Activity library, to add activities from (names, photos, how it's played; nothing else).
  app.post('/api/portal/docs/library', route(async req => {
    const { db } = await trainerFrom(req);
    const list = (await db.collection('tb_activities').get()).docs
      .map(x => ({ ...(x.data() as any), id: x.id })).filter(a => !a.archived && String(a.name || '').trim())
      .map(({ createdById: _1, createdByName: _2, updatedById: _3, updatedByName: _4, createdAt: _5, updatedAt: _6, ...a }) => a)
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return { activities: list };
  }));
}
