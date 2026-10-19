// Private client links for quotations and course outlines (Joel, 2026-10-19). The client opens /q/<token> or
// /o/<token> without logging in. These routes are the only way in: they read the sent (locked) document with the
// server's own access, return just what prints (publicDocFields), and record each time the client opens it.
// The team makes and stops links from the Send window (src/components/QuoteSendDialog.tsx).

import type { Express, Request } from 'express';
import crypto from 'crypto';
import { FieldValue, Firestore } from 'firebase-admin/firestore';
import { admin, UserError, callerFrom, route } from './serverAuth';
import { canSendQuotation } from './serverMail';
import { DocKind, isLinkToken, publicDocFields } from './src/lib/docLinks';
import { endOfDayMY, expiryProblem } from './src/lib/proposalTracking';

// Teambuilding proposals (push B, 2026-10-19) share this list and these routes for make / stop / extend; their client
// page has its own routes (serverProposalLinks.ts). Their links need an expiry date.
const COLLECTION: Record<DocKind, string> = { quotation: 'quotations', outline: 'course_outlines', teambuilding: 'teambuilding_proposals' };
const NOUN: Record<DocKind, string> = { quotation: 'quotation', outline: 'course outline', teambuilding: 'teambuilding proposal' };

// Light protection against someone hammering the links: 60 requests a minute per address.
const hits = new Map<string, { n: number; since: number }>();
function slowDown(req: Request) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.since > 60_000) { hits.set(ip, { n: 1, since: now }); return; }
  if (++h.n > 60) throw new UserError(429, 'too-many', 'Too many tries. Wait a minute and try again.');
}

const kindOf = (v: any): DocKind => {
  if (v === 'quotation' || v === 'outline' || v === 'teambuilding') return v;
  throw new UserError(400, 'bad-kind', 'Unknown document.');
};

async function memberName(db: Firestore, id: string) {
  return String((await db.collection('team').doc(id).get()).data()?.name || '');
}

export function registerDocLinkRoutes(app: Express) {
  // Make the link for a quotation or outline (or give back the one it already has).
  app.post('/api/doc-link/create', route(async req => {
    const caller = await callerFrom(req);
    const kind = kindOf(req.body?.kind);
    const docId = String(req.body?.id || '');
    const { db } = admin();
    const snap = docId ? await db.collection(COLLECTION[kind]).doc(docId).get() : null;
    if (!snap?.exists) throw new UserError(404, 'not-found', `Save the ${NOUN[kind]} first.`);
    const d: any = snap.data();
    if (!canSendQuotation(d, caller)) throw new UserError(403, 'not-yours', `You can only send ${NOUN[kind]}s you own or that are shared with you.`);
    const existing = await db.collection('doc_links').where('docId', '==', docId).get();
    const open = existing.docs.find(x => x.data().kind === kind && x.data().status === 'open');
    if (open) return { token: open.id };
    // A teambuilding proposal's link needs an expiry date (set by the person who makes it), and keeps the deal owner
    // and client name for alerts and the CRM lists.
    let extra: Record<string, any> = {};
    let company = String(d.company || d.preparedForCompany || '');
    if (kind === 'teambuilding') {
      const expires = String(req.body?.expires || '');
      const problem = expiryProblem(expires);
      if (problem) throw new UserError(400, 'bad-expiry', problem);
      const deal: any = d.pipelineId ? (await db.collection('pipelines').doc(d.pipelineId).get()).data() : null;
      const clientId = deal?.clientId || d.clientId || '';
      if (!company && clientId) company = String((await db.collection('clients').doc(clientId).get()).data()?.companyName || '');
      extra = { expiresAt: endOfDayMY(expires), ownerId: String(deal?.ownerId || deal?.creatorId || d.ownerId || d.creatorId || ''), totalSeconds: 0 };
    }
    const token = crypto.randomBytes(16).toString('hex');
    await db.collection('doc_links').doc(token).set({
      kind, docId, dealId: String(d.pipelineId || ''), refNumber: String(d.refNumber || ''),
      company, status: 'open',
      createdAt: Date.now(), byId: caller.memberId, byName: await memberName(db, caller.memberId), views: 0, ...extra,
    });
    return { token };
  }));

  // Switch a link off (e.g. the quotation was replaced). Sending again later makes a new link.
  app.post('/api/doc-link/stop', route(async req => {
    const caller = await callerFrom(req);
    const token = String(req.body?.token || '');
    if (!isLinkToken(token)) throw new UserError(404, 'link-not-found', 'That link was not found.');
    const { db } = admin();
    const ref = db.collection('doc_links').doc(token);
    const link: any = (await ref.get()).data();
    if (!link) throw new UserError(404, 'link-not-found', 'That link was not found.');
    const d: any = (await db.collection(COLLECTION[kindOf(link.kind)]).doc(link.docId).get()).data() || {};
    if (!canSendQuotation(d, caller)) throw new UserError(403, 'not-yours', 'Only the owner, people it is shared with, Admin or Management can stop this link.');
    await ref.update({ status: 'stopped', stoppedAt: Date.now(), stoppedByName: await memberName(db, caller.memberId) });
    return {};
  }));

  // A new expiry date for a teambuilding proposal's link (Extend). A stopped (revoked) link can't be reopened.
  app.post('/api/doc-link/extend', route(async req => {
    const caller = await callerFrom(req);
    const token = String(req.body?.token || '');
    if (!isLinkToken(token)) throw new UserError(404, 'link-not-found', 'That link was not found.');
    const expires = String(req.body?.expires || '');
    const problem = expiryProblem(expires);
    if (problem) throw new UserError(400, 'bad-expiry', problem);
    const { db } = admin();
    const ref = db.collection('doc_links').doc(token);
    const link: any = (await ref.get()).data();
    if (!link) throw new UserError(404, 'link-not-found', 'That link was not found.');
    if (link.status !== 'open') throw new UserError(409, 'link-stopped', 'This link was revoked. Make a new link instead.');
    const d: any = (await db.collection(COLLECTION[kindOf(link.kind)]).doc(link.docId).get()).data() || {};
    if (!canSendQuotation(d, caller)) throw new UserError(403, 'not-yours', 'Only the owner, people it is shared with, Admin or Management can change this link.');
    await ref.update({ expiresAt: endOfDayMY(expires), extendedAt: Date.now(), extendedByName: await memberName(db, caller.memberId) });
    return {};
  }));

  // What the client's page shows. `team: true` comes from the CRM's own "Open" button and isn't counted.
  app.post('/api/doc-link/get', route(async req => {
    slowDown(req);
    const token = String(req.body?.token || '');
    const gone = 'This link is not valid. Please contact NEXT Academy for the latest version.';
    if (!isLinkToken(token)) throw new UserError(404, 'link-not-found', gone);
    const { db } = admin();
    const ref = db.collection('doc_links').doc(token);
    const link: any = (await ref.get()).data();
    if (!link) throw new UserError(404, 'link-not-found', gone);
    const kind = kindOf(link.kind);
    if (kind === 'teambuilding') throw new UserError(404, 'link-not-found', gone);   // opened at /p/ (serverProposalLinks.ts)
    if (link.status !== 'open') throw new UserError(410, 'link-stopped', `This ${NOUN[kind]} link is no longer active. Please contact NEXT Academy for the latest version.`);
    const d: any = (await db.collection(COLLECTION[kind]).doc(link.docId).get()).data();
    if (!d || d.dealDeleted) throw new UserError(404, 'doc-gone', gone);
    if (d.status !== 'sent') throw new UserError(409, 'being-revised', `NEXT Academy is updating this ${NOUN[kind]}. You'll receive the new version shortly.`);

    if (!req.body?.team) {
      const now = Date.now();
      await ref.update({ views: FieldValue.increment(1), lastViewedAt: now, ...(link.firstViewedAt ? {} : { firstViewedAt: now }) });
      // The first time the client opens it, the deal's history says so.
      if (!link.firstViewedAt && link.dealId) {
        const dealRef = db.collection('pipelines').doc(link.dealId);
        await db.runTransaction(async tx => {
          const deal: any = (await tx.get(dealRef)).data();
          if (!deal) return;
          const action = `Client opened the ${NOUN[kind]}${link.refNumber ? ` ${link.refNumber}` : ''} (link)`;
          tx.update(dealRef, { history: [...(deal.history || []), { at: new Date(now).toISOString(), byId: '', byName: 'Client', action }].slice(-40) });
        }).catch(e => console.error('[doc-link] deal history', e));
      }
    }
    return { kind, doc: { ...publicDocFields(d), id: link.docId } };
  }));
}
