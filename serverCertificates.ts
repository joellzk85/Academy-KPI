// HR's certificate link (Joel, 2026-10-31: "a HTML link that can be sent to HR to download PDF"). Admin or Management
// make it on a deal whose certificates were generated; HR opens /cert/<token> without logging in and downloads all the
// certificates as one PDF, or each person's (one by one or a ZIP). The page draws the PDFs itself from what this route
// sends: only what is printed (no ids, nobody left out, IC numbers only when the certificates show them).
//
// cert_links/{token}: { dealId, status: open | stopped, createdAt, byId, byName, expiresAt, company, opens,
//   lastOpenedAt, stoppedAt, stoppedByName }. Written only here; Admin and Management read them (firestore.rules).

import type { Express } from 'express';
import crypto from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { admin, UserError, callerFrom, route } from './serverAuth';
import { addDealHistory, slowDown } from './serverDocLinks';
import { photoDataUrl } from './serverPhotos';
import { isDeletedRecord } from './src/lib/linked';
import { COMPANY } from './src/lib/company';
import { endOfDayMY, plusDaysMY } from './src/lib/proposalTracking';
import { DealCertificates, included, printOf, readCertSettings } from './src/lib/certificates';

const isToken = (t: any) => typeof t === 'string' && /^[a-f0-9]{32}$/.test(t);

async function staffFrom(req: any) {
  const caller = await callerFrom(req);
  if (caller.role !== 'admin' && caller.role !== 'management') throw new UserError(403, 'not-allowed', 'Only Admin and Management can send certificates.');
  return caller;
}

async function memberName(db: FirebaseFirestore.Firestore, id: string) {
  return String((await db.collection('team').doc(id).get()).data()?.name || '');
}

async function companyOf(db: FirebaseFirestore.Firestore, deal: any) {
  if (deal?.clientId) {
    const c: any = (await db.collection('clients').doc(deal.clientId).get()).data();
    if (c) return { name: String(c.companyName || deal.client || ''), logoUrl: String(c.logoUrl || '') };
  }
  return { name: String(deal?.client || ''), logoUrl: '' };
}

export function registerCertificateRoutes(app: Express) {
  // Make HR's link (or give back the open one that still works).
  app.post('/api/cert-link/create', route(async req => {
    const caller = await staffFrom(req);
    const dealId = String(req.body?.dealId || '').slice(0, 80);
    const { db } = admin();
    const deal: any = dealId ? (await db.collection('pipelines').doc(dealId).get()).data() : null;
    if (!deal || isDeletedRecord(deal)) throw new UserError(404, 'not-found', 'That deal was not found.');
    const certs = (await db.collection('deal_certificates').doc(dealId).get()).data() as DealCertificates | undefined;
    if (!certs?.generatedAt || !included(certs.people || []).some(p => p.number)) throw new UserError(409, 'not-generated', 'Generate the certificates first.');
    const existing = await db.collection('cert_links').where('dealId', '==', dealId).get();
    const open = existing.docs.find(x => x.data().status === 'open' && (x.data().expiresAt || 0) > Date.now());
    if (open) return { token: open.id };
    const settings = readCertSettings((await db.collection('config').doc('certificate_settings').get()).data());
    const token = crypto.randomBytes(16).toString('hex');
    const byName = await memberName(db, caller.memberId);
    await db.collection('cert_links').doc(token).set({
      dealId, status: 'open', createdAt: Date.now(), byId: caller.memberId, byName,
      expiresAt: endOfDayMY(plusDaysMY(settings.linkDays)), company: (await companyOf(db, deal)).name, opens: 0,
    });
    await addDealHistory(db, dealId, caller.memberId, byName, `Certificates link for HR made (works ${settings.linkDays} days)`);
    return { token };
  }));

  app.post('/api/cert-link/stop', route(async req => {
    const caller = await staffFrom(req);
    const token = String(req.body?.token || '');
    if (!isToken(token)) throw new UserError(404, 'link-not-found', 'That link was not found.');
    const { db } = admin();
    const ref = db.collection('cert_links').doc(token);
    const link: any = (await ref.get()).data();
    if (!link) throw new UserError(404, 'link-not-found', 'That link was not found.');
    const byName = await memberName(db, caller.memberId);
    await ref.update({ status: 'stopped', stoppedAt: Date.now(), stoppedByName: byName });
    await addDealHistory(db, link.dealId, caller.memberId, byName, 'Certificates link for HR stopped');
    return {};
  }));

  // What HR's page shows. `team: true` (a browser logged in to the CRM) isn't counted.
  app.post('/api/cert-link/get', route(async req => {
    slowDown(req);
    const token = String(req.body?.token || '');
    const gone = { code: 'link-stopped', message: 'This certificate link is no longer active.', contact: { phone: COMPANY.phone, email: COMPANY.email } };
    if (!isToken(token)) return { gone };
    const { db } = admin();
    const ref = db.collection('cert_links').doc(token);
    const link: any = (await ref.get()).data();
    if (!link || link.status !== 'open') return { gone };
    if ((link.expiresAt || 0) < Date.now()) return { gone: { ...gone, code: 'link-expired', message: 'This certificate link has expired.' } };
    const deal: any = (await db.collection('pipelines').doc(link.dealId).get()).data();
    const certs = (await db.collection('deal_certificates').doc(link.dealId).get()).data() as DealCertificates | undefined;
    if (!deal || isDeletedRecord(deal) || !certs) return { gone };
    const settings = readCertSettings((await db.collection('config').doc('certificate_settings').get()).data());
    const company = await companyOf(db, deal);
    const logo = certs.logoUrl === 'none' ? '' : await photoDataUrl(certs.logoUrl || company.logoUrl);
    if (!req.body?.team) await ref.update({ opens: FieldValue.increment(1), lastOpenedAt: Date.now() });
    return { print: printOf(certs, settings, logo, company.name), expiresAt: link.expiresAt };
  }));
}
