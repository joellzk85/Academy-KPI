// Trainers' course outlines and teambuilding proposals in the portal and My trainings (2026-10-21; since 2026-10-26
// one record, no copies: see src/lib/trainerDocs.ts). The trainer writes straight into the CRM's course_outlines /
// teambuilding_proposals record, but only through these routes, only their own records, only their parts, and never
// once it has been sent to a client. Trainer links (serverTrainerLinks.ts) write through writeTrainerParts too.

import type { Express } from 'express';
import type { Firestore } from 'firebase-admin/firestore';
import firebaseConfig from './firebase-applet-config.json';
import { UserError, route } from './serverAuth';
import { trainerFrom } from './serverTrainerPortal';
import {
  RECORD_PLACE, TrainerDoc, TrainerDocContent, TrainerDocKind, cleanTrainerTb, docSummary, docTitle, keepOf, partsOf, partsStamp,
  recordUpdate, writerLocked,
} from './src/lib/trainerDocs';
import { cleanOutline } from './src/lib/trainerLinks';
import { isDeletedRecord } from './src/lib/linked';
import { nextOutlineRef } from './src/lib/outlineResolve';
import { blankProposalContent, cleanForSave, nextTbRef } from './src/lib/teambuilding';
import { outlineTypeFields, programmeTypeOf } from './src/lib/outlineTb';

const BUCKET = String((firebaseConfig as any).storageBucket || '');
const KINDS: TrainerDocKind[] = ['outline', 'teambuilding'];
const myDate = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);   // Malaysia
const rand = () => Math.random().toString(36).slice(2, 6);

type Prog = { id: string; name: string; skillType?: any };
async function programmes(db: Firestore): Promise<Prog[]> {
  return (await db.collection('programmes').get()).docs
    .map(d => ({ id: d.id, name: String(d.data().name || '').trim(), skillType: d.data().skillType })).filter(p => p.name);
}

// The programme it prints with: its own, else its deal's.
async function programmeOf(db: Firestore, r: any, deals?: Map<string, any>): Promise<string> {
  if (r?.programmeId) return String(r.programmeId);
  if (!r?.pipelineId) return '';
  const deal = deals ? deals.get(r.pipelineId) : (await db.collection('pipelines').doc(String(r.pipelineId)).get()).data();
  return String(deal?.programmeId || '');
}

export function rowFor(kind: TrainerDocKind, id: string, r: any, programmeId: string, progs: Prog[]) {
  const draft = partsOf(kind, r, programmeId);
  const shown: TrainerDocContent = kind === 'teambuilding' ? { ...draft, tb: cleanTrainerTb(draft.tb, '', '', { keep: keepOf(r) }) } : draft;
  return {
    id, kind, draft, stamp: partsStamp(kind, r, programmeId), updatedAt: Number(r?.trainerEditedAt || 0),
    locked: writerLocked(r), forClient: !!(r?.pipelineId || r?.clientId),
    title: docTitle(kind, shown, progs), summary: docSummary(kind, shown),
  };
}

const gone = () => new UserError(404, 'not-found', 'This is no longer available. Ask NEXT Academy if you need it.');

/** The record as the trainer's form shows it. `writerId`: only that trainer's own record (the portal). */
export async function readForTrainer(db: Firestore, kind: TrainerDocKind, id: any, writerId?: string) {
  const ref = db.collection(RECORD_PLACE[kind]).doc(String(id || '').slice(0, 120) || 'none');
  const r: any = (await ref.get()).data();
  if (!r || isDeletedRecord(r)) throw gone();
  if (writerId !== undefined && (r.writerTrainerId !== writerId || r.writerRemoved)) throw gone();
  const [programmeId, progs] = await Promise.all([programmeOf(db, r), programmes(db)]);
  return { ref, r, programmeId, progs, row: rowFor(kind, ref.id, r, programmeId, progs) };
}

/** Writes what the trainer typed into the record (their parts only). `draft.programmeId` undefined keeps the
 *  programme; `stamp` (from when they opened it) refuses a save on top of someone else's newer change. */
export async function writeTrainerParts(db: Firestore, kind: TrainerDocKind, id: any, draft: any, who: {
  trainerId: string; trainerName: string; stamp?: string; folder?: string; writerId?: string;
}) {
  const { ref, programmeId, progs } = await readForTrainer(db, kind, id, who.writerId);
  return db.runTransaction(async tx => {
    const r: any = (await tx.get(ref)).data();
    if (!r || isDeletedRecord(r)) throw gone();
    if (writerLocked(r)) throw new UserError(409, 'locked', 'NEXT Academy has sent this to a client, so it is locked. Ask NEXT Academy to revise it if it needs changes.');
    if (who.stamp && who.stamp !== partsStamp(kind, r, programmeId)) {
      throw new UserError(409, 'changed', 'NEXT Academy changed this while you were writing. Reload to see their changes, then make yours again.');
    }
    const asked = draft?.programmeId === undefined ? programmeId : String(draft.programmeId || '');
    const newProg = asked === programmeId || asked === '' || progs.some(p => p.id === asked) ? asked : programmeId;
    const c: TrainerDocContent = kind === 'outline'
      ? { programmeId: newProg, outline: cleanOutline(draft?.outline || {}) }
      : { programmeId: newProg, tb: cleanTrainerTb(draft?.tb || {}, who.trainerId, BUCKET, { folder: who.folder, keep: keepOf(r) }) };
    const name = progs.find(p => p.id === newProg)?.name || '';
    const up: any = {
      ...recordUpdate(kind, c, name, newProg !== programmeId), trainerEditedAt: Date.now(),
      ...(!r.writerTrainerId && !r.writerTrainerName ? { writerTrainerId: who.trainerId || '', writerTrainerName: who.trainerName || 'Trainer' } : {}),
      ...(who.trainerId && r.writerTrainerId === who.trainerId && who.trainerName ? { writerTrainerName: who.trainerName } : {}),
    };
    tx.update(ref, up);
    const after = { ...r, ...up };
    return rowFor(kind, ref.id, after, newProg, progs);
  });
}

/** A new record written by a trainer (the portal's "New", and moving their old trainer_docs over). General: no deal,
 *  no client. An internal trainer owns it; an outside trainer's has no owner (lib/linked.ts keeps it visible). */
async function newRecord(db: Firestore, kind: TrainerDocKind, programmeId: string, who: { trainerId: string; trainerName: string; memberId?: string },
  content?: TrainerDocContent, editedAt?: number) {
  const progs = await programmes(db);
  const prog = progs.find(p => p.id === programmeId);
  const progId = prog ? prog.id : '';
  const place = RECORD_PLACE[kind];
  const all = (await db.collection(place).select('refNumber').get()).docs.map(d => d.data() as { refNumber?: string });
  const date = myDate();
  const now = Date.now();
  const owner = who.memberId || '';
  const common = {
    refAuto: true, date, preparedBy: who.trainerName, creatorId: owner, ownerId: owner, ownerName: owner ? who.trainerName : '',
    clientId: '', pipelineId: '', preparedForCompany: '', status: 'draft', sharedWithIds: [], isHidden: false,
    writerTrainerId: who.trainerId, writerTrainerName: who.trainerName, trainerEditedAt: editedAt || now,
  };
  let rec: any;
  if (kind === 'outline') {
    // The title's type (Admin's choice, else what its outlines are), as the CRM's own "New outline" does.
    const progOutlines = progId ? (await db.collection('course_outlines').where('programmeId', '==', progId).get()).docs.map(d => d.data()) : [];
    rec = {
      courseTitle: '', durationDays: 1, totalHours: 8, category: '', level: 'Beginner', audience: '', prerequisites: '', overview: '',
      outcomes: [], items: [], methods: [], agenda: [], designedBy: who.trainerName,
      ...outlineTypeFields(programmeTypeOf(prog, progOutlines)),
      ...common, id: `outline_${now}_${rand()}`, refNumber: nextOutlineRef(all, date, ''),
      programmeId: progId, useProgrammeName: !!progId, trainerId: who.trainerId,
    };
  } else {
    const tpl: any = (await db.collection('tb_settings').doc('package_template').get()).data();
    rec = {
      ...blankProposalContent(tpl?.packages || null),
      ...common, id: `tb_${now}_${rand()}`, refNumber: nextTbRef(all, date, ''),
      title: prog?.name || '', programmeId: progId,
      trainers: [{ id: `tr_${now.toString(36)}`, trainerId: who.trainerId, role: 'Accredited HRDC Trainer' }],
    };
  }
  if (content) {
    const c: TrainerDocContent = kind === 'outline'
      ? { programmeId: progId, outline: cleanOutline(content.outline || {}) }
      : { programmeId: progId, tb: cleanTrainerTb(content.tb || {}, who.trainerId, BUCKET) };
    Object.assign(rec, recordUpdate(kind, c, prog?.name || '', false));
  }
  rec = JSON.parse(JSON.stringify(kind === 'teambuilding' ? cleanForSave(rec) : rec));
  await db.collection(place).doc(rec.id).set(rec);
  return { rec, row: rowFor(kind, rec.id, rec, progId, progs) };
}

// Before 2026-10-26 the trainer's own copies were in trainer_docs: the first time their list opens, each one becomes a
// CRM record (what they last typed), marked moved. Copies the team already made from them stay as they are.
async function moveOldDocs(db: Firestore, who: { trainerId: string; trainerName: string; memberId?: string }) {
  const old = (await db.collection('trainer_docs').where('trainerId', '==', who.trainerId).get()).docs
    .filter(d => !(d.data() as TrainerDoc).archived)
    .sort((a, b) => Number(a.data().createdAt || 0) - Number(b.data().createdAt || 0));
  for (const d of old) {
    const t = d.data() as TrainerDoc;
    if (!KINDS.includes(t.kind)) continue;
    const content = t.draft || t.sent;
    const { rec } = await newRecord(db, t.kind, content?.programmeId || '', who, content, t.updatedAt);
    if (t.sentAt) await db.collection(RECORD_PLACE[t.kind]).doc(rec.id).update({ fromTrainerDocId: d.id });
    await d.ref.update({ archived: true, movedTo: rec.id, updatedAt: Date.now() });
  }
}

function whoFrom(ctx: Awaited<ReturnType<typeof trainerFrom>>) {
  return { trainerId: ctx.trainerId, trainerName: String(ctx.trainer?.name || 'Trainer'), memberId: ctx.account?.memberId ? String(ctx.account.memberId) : undefined };
}
const kindOf = (k: any): TrainerDocKind => {
  if (!KINDS.includes(k)) throw new UserError(400, 'invalid', 'Choose a course outline or a teambuilding proposal.');
  return k;
};

export function registerTrainerDocRoutes(app: Express) {
  // My course outlines and teambuilding proposals: the CRM records I write.
  app.post('/api/portal/docs/list', route(async req => {
    const ctx = await trainerFrom(req);
    const { db, trainerId } = ctx;
    if (!ctx.account?.viewOnly) await moveOldDocs(db, whoFrom(ctx));   // the owner viewing as them saves nothing
    const [progs, ...snaps] = await Promise.all([programmes(db), ...KINDS.map(k => db.collection(RECORD_PLACE[k]).where('writerTrainerId', '==', trainerId).get())]);
    const recs = KINDS.flatMap((kind, i) => snaps[i].docs.map(d => ({ kind, id: d.id, r: d.data() as any })))
      .filter(x => !isDeletedRecord(x.r) && !x.r.writerRemoved);
    const dealIds = [...new Set(recs.filter(x => !x.r.programmeId && x.r.pipelineId).map(x => String(x.r.pipelineId)))];
    const deals = new Map<string, any>();
    for (let i = 0; i < dealIds.length; i += 100) {
      const got = await db.getAll(...dealIds.slice(i, i + 100).map(id => db.collection('pipelines').doc(id)));
      got.forEach(s => deals.set(s.id, s.data()));
    }
    const docs = await Promise.all(recs.map(async x => rowFor(x.kind, x.id, x.r, await programmeOf(db, x.r, deals), progs)));
    return { docs: docs.sort((a, b) => b.updatedAt - a.updatedAt) };
  }));

  app.post('/api/portal/docs/new', route(async req => {
    const ctx = await trainerFrom(req);
    const kind = kindOf(req.body?.kind);
    const { row } = await newRecord(ctx.db, kind, String(req.body?.programmeId || ''), whoFrom(ctx));
    return { doc: row };
  }));

  app.post('/api/portal/docs/get', route(async req => {
    const { db, trainerId } = await trainerFrom(req);
    const { row } = await readForTrainer(db, kindOf(req.body?.kind), req.body?.id, trainerId);
    return { doc: row };
  }));

  // Saves what they typed, straight into the record (the team sees it at once).
  app.post('/api/portal/docs/save', route(async req => {
    const ctx = await trainerFrom(req);
    const kind = kindOf(req.body?.kind);
    const row = await writeTrainerParts(ctx.db, kind, req.body?.id, req.body?.draft, {
      ...whoFrom(ctx), writerId: ctx.trainerId, stamp: String(req.body?.stamp || ''),
    });
    return { doc: row };
  }));

  // Taking it off their list. The record stays with NEXT Academy.
  app.post('/api/portal/docs/delete', route(async req => {
    const { db, trainerId } = await trainerFrom(req);
    const { ref } = await readForTrainer(db, kindOf(req.body?.kind), req.body?.id, trainerId);
    await ref.update({ writerRemoved: true });
    return {};
  }));

  // The Activity library, to add activities from (names, photos, how it's played; nothing else).
  app.post('/api/portal/docs/library', route(async req => {
    const { db } = await trainerFrom(req);
    return { activities: await activityLibrary(db) };
  }));
}

export async function activityLibrary(db: Firestore) {
  return (await db.collection('tb_activities').get()).docs
    .map(x => ({ ...(x.data() as any), id: x.id })).filter(a => !a.archived && String(a.name || '').trim())
    .map(({ createdById: _1, createdByName: _2, updatedById: _3, updatedByName: _4, createdAt: _5, updatedAt: _6, ...a }) => a)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}
