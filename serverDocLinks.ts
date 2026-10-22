// Private client links for quotations and course outlines (Joel, 2026-10-19). The client opens /q/<token> or
// /o/<token> without logging in. These routes are the only way in: they read the sent (locked) document with the
// server's own access, return just what prints (publicDocFields), and record each time the client opens it.
// The team makes and stops links from the Send window (src/components/QuoteSendDialog.tsx).
// Limits (2026-10-19, lib/linkLimits.ts): every link has an expiry date and an open limit, set when it's made
// (defaults in config/link_settings). Once either runs out the client sees "expired" and can ask for access again;
// the team reopens it with new limits (/api/doc-link/limits). It never reopens by itself.

import type { Express, Request } from 'express';
import crypto from 'crypto';
import { DocumentReference, FieldValue, Firestore } from 'firebase-admin/firestore';
import { admin, UserError, callerFrom, route } from './serverAuth';
import { canSendQuotation } from './serverMail';
import { DOC_NOUN, DocKind, isLinkToken, publicDocFields } from './src/lib/docLinks';
import { dealPax, hrCopy, withPax } from './src/lib/trainingReport';
import { isDeletedRecord } from './src/lib/linked';
import { endOfDayMY, expiryDateMY, expiryProblem, isExpired, plusDaysMY } from './src/lib/proposalTracking';
import { COMPANY } from './src/lib/company';
import { LinkSettings, REPEAT_WINDOW_MS, linkState, opensProblem, readLinkSettings } from './src/lib/linkLimits';

// Teambuilding proposals (push B, 2026-10-19) share this list and these routes for make / stop / limits; their client
// page has its own routes (serverProposalLinks.ts), which use admitOpen below.
// Training reports (2026-10-21): HR's copy, opened at /r/<token>; only Management makes, changes or stops these links.
const COLLECTION: Record<DocKind, string> = { quotation: 'quotations', outline: 'course_outlines', teambuilding: 'teambuilding_proposals', report: 'training_reports' };
const NOUN = DOC_NOUN;
const canLink = (kind: DocKind, d: any, caller: { memberId: string; role: string }) => (kind === 'report' ? caller.role === 'management' : canSendQuotation(d, caller));

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
  if (v === 'quotation' || v === 'outline' || v === 'teambuilding' || v === 'report') return v;
  throw new UserError(400, 'bad-kind', 'Unknown document.');
};

async function memberName(db: Firestore, id: string) {
  return String((await db.collection('team').doc(id).get()).data()?.name || '');
}

// Default limits for new links (config/link_settings, set by Management; 5 days and 10 opens to start with).
export async function linkSettings(db: Firestore): Promise<LinkSettings> {
  return readLinkSettings((await db.collection('config').doc('link_settings').get()).data());
}

// Who the client should contact when a link no longer opens: the deal owner (or whoever made the link).
export async function contactOf(db: Firestore, link: any) {
  const id = link.ownerId || link.byId || '';
  const name = id ? String((await db.collection('team').doc(id).get()).data()?.name || link.byName || '') : String(link.byName || '');
  return { name, phone: COMPANY.phone, email: COMPANY.email };
}

// The expiry date and number of opens asked for (else the defaults), checked.
function limitsFrom(body: any, s: LinkSettings) {
  const expires = String(body?.expires || '') || plusDaysMY(s.days);
  const problem = expiryProblem(expires);
  if (problem) throw new UserError(400, 'bad-expiry', problem);
  const opens = body?.opens === undefined || body?.opens === null || body?.opens === '' ? s.opens : Number(body.opens);
  const op = opensProblem(opens);
  if (op) throw new UserError(400, 'bad-opens', op);
  return { expiresAt: endOfDayMY(expires), opens };
}

const cleanVisit = (v: any) => (typeof v === 'string' && /^[a-z0-9]{8,40}$/.test(v) ? v : '');

// One client open of a link (every kind; serverProposalLinks.ts uses it too). Gives older links the standard limits
// the first time, then checks the time and open limits. A refresh by the same visitor within 30 minutes counts once;
// the team's own opens never count. Returns why it's blocked (if it is) and whether this was the first open.
export async function admitOpen(db: Firestore, ref: DocumentReference, link: any, opts: { visit?: any; team?: boolean }) {
  if (!link.expiresAt || !link.maxOpens) {
    const s = await linkSettings(db);
    const patch: any = {};
    if (!link.expiresAt) patch.expiresAt = endOfDayMY(plusDaysMY(s.days));
    if (!link.maxOpens) patch.maxOpens = (link.views || 0) + s.opens;
    await ref.update(patch);
    Object.assign(link, patch);
  }
  type Blocked = { code: string; message: string } | null;
  if (opts.team) return { blocked: null as Blocked, first: false };
  const now = Date.now();
  const visit = cleanVisit(opts.visit);
  const repeat = !!visit && link.lastVisit === visit && now - (link.lastViewedAt || 0) < REPEAT_WINDOW_MS;
  const noun = NOUN[kindOf(link.kind)];
  if (isExpired(link, now)) return { blocked: { code: 'link-expired', message: `This ${noun} link has expired.` } as Blocked, first: false };
  if (!repeat && (link.views || 0) >= link.maxOpens) return { blocked: { code: 'link-limit', message: `This ${noun} link has been opened the maximum number of times.` } as Blocked, first: false };
  if (repeat) { await ref.update({ lastViewedAt: now }); return { blocked: null as Blocked, first: false }; }
  await ref.update({ views: FieldValue.increment(1), lastViewedAt: now, lastVisit: visit, ...(link.firstViewedAt ? {} : { firstViewedAt: now }) });
  return { blocked: null as Blocked, first: !link.firstViewedAt };
}

export async function addDealHistory(db: Firestore, dealId: string, byId: string, byName: string, action: string) {
  if (!dealId) return;
  const dealRef = db.collection('pipelines').doc(dealId);
  await db.runTransaction(async tx => {
    const deal: any = (await tx.get(dealRef)).data();
    if (!deal) return;
    tx.update(dealRef, { history: [...(deal.history || []), { at: new Date().toISOString(), byId, byName, action }] });
  }).catch(e => console.error('[doc-link] deal history', e));
}

async function linkAndDoc(db: Firestore, caller: { memberId: string; role: string }, token: string, verb: string) {
  if (!isLinkToken(token)) throw new UserError(404, 'link-not-found', 'That link was not found.');
  const ref = db.collection('doc_links').doc(token);
  const link: any = (await ref.get()).data();
  if (!link) throw new UserError(404, 'link-not-found', 'That link was not found.');
  const kind = kindOf(link.kind);
  const d: any = (await db.collection(COLLECTION[kind]).doc(link.docId).get()).data() || {};
  if (!canLink(kind, d, caller)) throw new UserError(403, 'not-yours', kind === 'report' ? `Only Management can ${verb} this link.` : `Only the owner, people it is shared with, Admin or Management can ${verb} this link.`);
  return { ref, link, kind };
}

export function registerDocLinkRoutes(app: Express) {
  // Make the link for a quotation, outline or teambuilding proposal (or give back the one it already has).
  app.post('/api/doc-link/create', route(async req => {
    const caller = await callerFrom(req);
    const kind = kindOf(req.body?.kind);
    const docId = String(req.body?.id || '');
    const { db } = admin();
    const snap = docId ? await db.collection(COLLECTION[kind]).doc(docId).get() : null;
    if (!snap?.exists) throw new UserError(404, 'not-found', `Save the ${NOUN[kind]} first.`);
    const d: any = snap.data();
    if (!canLink(kind, d, caller)) throw new UserError(403, 'not-yours', kind === 'report' ? 'Only Management can send the training report to HR by link.' : `You can only send ${NOUN[kind]}s you own or that are shared with you.`);
    if (kind === 'report' && d.status !== 'checked') throw new UserError(409, 'not-checked', 'Mark the report "Checked, ready for HR" first.');
    const existing = await db.collection('doc_links').where('docId', '==', docId).get();
    const open = existing.docs.find(x => x.data().kind === kind && x.data().status === 'open');
    if (open) return { token: open.id };
    // Every link has a time and open limit, and keeps the deal owner and client name for alerts and the Management list.
    const lim = limitsFrom(req.body, await linkSettings(db));
    const dealId = String(kind === 'report' ? docId : d.pipelineId || '');
    let company = String(d.company || d.preparedForCompany || '');
    const deal: any = dealId ? (await db.collection('pipelines').doc(dealId).get()).data() : null;
    const clientId = deal?.clientId || d.clientId || '';
    if (!company && clientId) company = String((await db.collection('clients').doc(clientId).get()).data()?.companyName || '');
    if (!company) company = String(deal?.client || '');
    const token = crypto.randomBytes(16).toString('hex');
    await db.collection('doc_links').doc(token).set({
      kind, docId, dealId, refNumber: String(d.refNumber || ''),
      company, status: 'open',
      createdAt: Date.now(), byId: caller.memberId, byName: await memberName(db, caller.memberId), views: 0,
      expiresAt: lim.expiresAt, maxOpens: lim.opens,
      ownerId: String(deal?.ownerId || deal?.creatorId || d.ownerId || d.creatorId || ''),
      totalSeconds: 0,
    });
    return { token };
  }));

  // Switch a link off (e.g. the quotation was replaced). Sending again later makes a new link.
  app.post('/api/doc-link/stop', route(async req => {
    const caller = await callerFrom(req);
    const { db } = admin();
    const { ref } = await linkAndDoc(db, caller, String(req.body?.token || ''), 'stop');
    await ref.update({ status: 'stopped', stoppedAt: Date.now(), stoppedByName: await memberName(db, caller.memberId) });
    return {};
  }));

  // Change limits / Reopen: a new expiry date and N more opens from now. Clears the client's request.
  // (/api/doc-link/extend is the older teambuilding "new date only" version, kept for any page still using it.)
  const setLimits = route(async req => {
    const caller = await callerFrom(req);
    const { db } = admin();
    const { ref, link, kind } = await linkAndDoc(db, caller, String(req.body?.token || ''), 'change');
    if (link.status !== 'open') throw new UserError(409, 'link-stopped', 'This link was stopped. Make a new link instead.');
    const s = await linkSettings(db);
    const lim = limitsFrom(req.body, s);
    const name = await memberName(db, caller.memberId);
    const state = linkState(link);
    const wasBlocked = state === 'expired' || state === 'limit' || !!link.reopenRequest;
    // Only a new date (the older Extend): keep the opens that are left, or give the standard number if none are.
    const moreOpens = req.body?.opens === undefined && link.maxOpens && (link.views || 0) < link.maxOpens
      ? link.maxOpens - (link.views || 0) : lim.opens;
    const now = Date.now();
    await ref.update({
      expiresAt: lim.expiresAt, maxOpens: (link.views || 0) + moreOpens, reopenRequest: null,
      extendedAt: now, extendedByName: name, ...(wasBlocked ? { reopenedAt: now, reopenedByName: name } : {}),
    });
    if (wasBlocked) {
      await addDealHistory(db, link.dealId, caller.memberId, name,
        `Client link for the ${NOUN[kind]}${link.refNumber ? ` ${link.refNumber}` : ''} reopened: until ${expiryDateMY(lim.expiresAt)}, ${moreOpens} more open${moreOpens === 1 ? '' : 's'}`);
    }
    return {};
  });
  app.post('/api/doc-link/limits', setLimits);
  app.post('/api/doc-link/extend', setLimits);

  // The client asks for access again after the link expired or ran out of opens. It doesn't reopen by itself.
  app.post('/api/doc-link/request', route(async req => {
    slowDown(req);
    const token = String(req.body?.token || '');
    if (!isLinkToken(token)) throw new UserError(404, 'link-not-found', 'This link is not valid.');
    const { db } = admin();
    const ref = db.collection('doc_links').doc(token);
    const link: any = (await ref.get()).data();
    if (!link) throw new UserError(404, 'link-not-found', 'This link is not valid.');
    const state = linkState(link);
    if (state === 'stopped') throw new UserError(410, 'link-stopped', 'This link is no longer active. Please contact NEXT Academy.');
    if (state === 'active') throw new UserError(409, 'link-open', 'This link is open again. Reload the page.');
    const name = String(req.body?.name || '').trim().slice(0, 80);
    const note = String(req.body?.note || '').trim().slice(0, 500);
    if (name.length < 2) throw new UserError(400, 'no-name', 'Please type your name.');
    const reason = state === 'expired' ? 'expired' : 'limit';
    await ref.update({ reopenRequest: { name, ...(note ? { note } : {}), at: Date.now(), reason } });
    await addDealHistory(db, link.dealId, '', 'Client',
      `${name} asked to open the ${NOUN[kindOf(link.kind)]}${link.refNumber ? ` ${link.refNumber}` : ''} again (${reason === 'expired' ? 'link expired' : 'open limit reached'})${note ? `: "${note.slice(0, 200)}"` : ''}`);
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
    if (link.status !== 'open') return { gone: { code: 'link-stopped', message: `This ${NOUN[kind]} link is no longer active.`, contact: await contactOf(db, link) } };
    const d: any = (await db.collection(COLLECTION[kind]).doc(link.docId).get()).data();
    if (!d || d.dealDeleted) throw new UserError(404, 'doc-gone', gone);
    if (d.status !== (kind === 'report' ? 'checked' : 'sent')) throw new UserError(409, 'being-revised', `NEXT Academy is updating this ${NOUN[kind]}. You'll receive the new version shortly.`);
    // A training report: only the sections Management chose for HR, with the deal's number of participants.
    let report: any = null;
    if (kind === 'report') {
      const deal: any = (await db.collection('pipelines').doc(link.docId).get()).data();
      if (!deal || isDeletedRecord(deal)) throw new UserError(404, 'doc-gone', gone);
      report = hrCopy(withPax(d, dealPax(deal)));
    }

    // No "Client opened" History line (2026-10-20): History is seen by everyone on the deal, tracking only by Management.
    const { blocked } = await admitOpen(db, ref, link, { visit: req.body?.visit, team: !!req.body?.team });
    if (blocked) return { gone: { ...blocked, canRequest: true, requested: !!link.reopenRequest, contact: await contactOf(db, link) } };
    return { kind, doc: report || { ...publicDocFields(d), id: link.docId }, expiresAt: link.expiresAt || 0 };
  }));
}
