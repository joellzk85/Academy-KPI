// The 30-day check-in with the participants' head of department (Joel, 2026-10-27: the training report "had to be
// beneficial to HR and the HOD"). About a month after the training, Management makes a private link (/c/<token>) on
// the checked training report and sends it to the HOD. With no login, the HOD answers a few questions (set in
// Trainers → Training reports → Settings, lib/reportSettings.ts): are their people using what they learned?
// The answers are saved on the report (checkinAnswer) and the deal's History; a "yes" to more training is a lead.
//
// report_checkins/{token}: { dealId, status: open | answered | stopped, createdAt, byId, byName, expiresAt,
//   questions (as they were when the link was made), header { programme, client, dates } }. Server only.
// training_reports/{dealId}.checkin { token, status, createdAt, byName } and .checkinAnswer: written only here.

import type { Express } from 'express';
import crypto from 'crypto';
import { admin, UserError, callerFrom, route } from './serverAuth';
import { addDealHistory, slowDown } from './serverDocLinks';
import { CustomQuestion, checkinQuestions, cleanAnswerValue, cleanQuestion, readReportSettings } from './src/lib/reportSettings';
import { isDeletedRecord } from './src/lib/linked';
import { COMPANY } from './src/lib/company';

const DAY = 86_400_000;
const clientTitle = (name: string) => name.replace(/\s*\(TB\)\s*$/i, '');   // as lib/programmes.ts
const LIFE_DAYS = 60;   // the HOD has two months to answer
const isToken = (t: any) => typeof t === 'string' && /^[a-f0-9]{32}$/.test(t);
const nowIso = () => new Date().toISOString();
const str = (v: any, max: number) => String(v ?? '').replace(/\u0000/g, '').trim().slice(0, max);

async function managerName(db: FirebaseFirestore.Firestore, memberId: string) {
  return String((await db.collection('team').doc(memberId).get()).data()?.name || '');
}

export function registerReportCheckinRoutes(app: Express) {
  // Management makes the link (or gets back the open one). The report must be checked.
  app.post('/api/report-checkin/create', route(async req => {
    const caller = await callerFrom(req);
    if (caller.role !== 'management') throw new UserError(403, 'not-allowed', 'Only Management can send the check-in link.');
    const dealId = str(req.body?.dealId, 80);
    const { db } = admin();
    const ref = db.collection('training_reports').doc(dealId || '-');
    const r: any = (await ref.get()).data();
    if (!r) throw new UserError(404, 'not-found', 'There is no training report for this training yet.');
    if (r.status !== 'checked') throw new UserError(409, 'not-checked', 'Mark the report "Checked, ready for HR" first.');
    if (r.checkin?.status === 'open' && isToken(r.checkin.token)) return { token: r.checkin.token };
    const deal: any = (await db.collection('pipelines').doc(dealId).get()).data();
    if (!deal || isDeletedRecord(deal)) throw new UserError(404, 'not-found', 'This deal was deleted.');
    const settings = readReportSettings((await db.collection('config').doc('training_report').get()).data());
    const token = crypto.randomBytes(16).toString('hex');
    const byName = await managerName(db, caller.memberId);
    const h = r.hrHeader || {};
    await db.collection('report_checkins').doc(token).set({
      dealId, status: 'open', createdAt: Date.now(), byId: caller.memberId, byName, expiresAt: Date.now() + LIFE_DAYS * DAY,
      questions: checkinQuestions(settings),
      header: { programme: clientTitle(String(h.programme || deal.courseName || '')), client: String(h.client || deal.client || ''), dates: String(h.dates || '') },
    });
    await ref.update({ checkin: { token, status: 'open', createdAt: nowIso(), byName } });
    await addDealHistory(db, dealId, caller.memberId, byName, 'Training report: 30-day check-in link made for the HOD');
    return { token };
  }));

  app.post('/api/report-checkin/stop', route(async req => {
    const caller = await callerFrom(req);
    if (caller.role !== 'management') throw new UserError(403, 'not-allowed', 'Only Management can stop the check-in link.');
    const dealId = str(req.body?.dealId, 80);
    const { db } = admin();
    const ref = db.collection('training_reports').doc(dealId || '-');
    const r: any = (await ref.get()).data();
    if (!r?.checkin?.token || r.checkin.status !== 'open') return {};
    await db.collection('report_checkins').doc(r.checkin.token).update({ status: 'stopped', stoppedAt: Date.now() });
    await ref.update({ checkin: null });
    return {};
  }));

  // What the HOD's page shows. No login.
  app.post('/api/report-checkin/get', route(async req => {
    slowDown(req);
    const { link } = await openLink(String(req.body?.token || ''));
    return { header: link.header, questions: link.questions, contact: { phone: COMPANY.phone, email: COMPANY.email } };
  }));

  // The HOD's answers. Saved once.
  app.post('/api/report-checkin/answer', route(async req => {
    slowDown(req);
    const token = String(req.body?.token || '');
    const { db, ref, link } = await openLink(token);
    const name = str(req.body?.name, 80);
    const role = str(req.body?.role, 80);
    if (name.length < 2) throw new UserError(400, 'no-name', 'Please type your name.');
    const questions: CustomQuestion[] = (link.questions || []).map(cleanQuestion).filter(Boolean);
    const sent = req.body?.answers && typeof req.body.answers === 'object' ? req.body.answers : {};
    const answers = questions.map(q => ({ id: q.id, label: q.label, type: q.type, internal: false, value: cleanAnswerValue(q.type, sent[q.id], q.options) }));
    const missing = questions.filter(q => q.required && !answers.find(a => a.id === q.id)?.value);
    if (missing.length) throw new UserError(400, 'invalid', `Please answer: ${missing.map(q => q.label).join('; ')}`);
    const at = nowIso();
    const kept = answers.filter(a => a.value);
    await db.runTransaction(async tx => {
      const again: any = (await tx.get(ref)).data();
      if (again?.status !== 'open') throw new UserError(409, 'answered', 'Thank you, we already have your answers.');
      tx.update(ref, { status: 'answered', answeredAt: Date.now() });
      tx.set(db.collection('training_reports').doc(link.dealId), {
        checkin: { token, status: 'answered', createdAt: new Date(link.createdAt || Date.now()).toISOString(), byName: link.byName || '' },
        checkinAnswer: { name, role, at, answers: kept },
      }, { merge: true });
    });
    const more = kept.find(a => a.type === 'yesno' && a.value === 'yes' && /training|coaching|session/i.test(a.label));
    await addDealHistory(db, link.dealId, '', name, `HOD answered the 30-day check-in${more ? `: said yes to "${more.label}" (a lead)` : ''}`);
    return {};
  }));
}

async function openLink(token: string) {
  const gone = 'This link is not valid. Please contact NEXT Academy.';
  if (!isToken(token)) throw new UserError(404, 'link-not-found', gone);
  const { db } = admin();
  const ref = db.collection('report_checkins').doc(token);
  const link: any = (await ref.get()).data();
  if (!link) throw new UserError(404, 'link-not-found', gone);
  if (link.status === 'answered') throw new UserError(409, 'answered', 'Thank you, we already have your answers.');
  if (link.status !== 'open') throw new UserError(410, 'link-stopped', 'This link is no longer active. Please contact NEXT Academy.');
  if ((link.expiresAt || 0) < Date.now()) throw new UserError(410, 'link-expired', 'This link has expired. Please contact NEXT Academy if you would still like to share your feedback.');
  return { db, ref, link };
}
