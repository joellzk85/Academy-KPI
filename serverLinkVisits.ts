// Tracking of every client link (Joel, 2026-10-20: quotations, course outlines and teambuilding proposals).
// - /api/link-visit (public): the client's page sends a small update about every 15 seconds while it's visible, and one
//   when the tab is hidden or closed (sendBeacon). Each visit is one proposal_views/{visitId} record, written only here,
//   with no IP address. The client is never told. Team opens (the CRM's Open button, or a browser logged in to the CRM)
//   send nothing.
// - /api/link-preview (logged in, tracking allowed): the document as the client saw it, for the heatmap, whatever the
//   link's state (stopped or expired links included).
// Nothing here writes to the deal's History: History is seen by everyone on the deal, and only Management (and the
// people Management ticks) may see tracking.

import type { Express, Request } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { admin, UserError, callerFrom, route } from './serverAuth';
import { isLinkToken, publicDocFields } from './src/lib/docLinks';
import { LinkKind, cleanVisitUpdate, mergeVisit, seesLink } from './src/lib/proposalTracking';
import { loadProposal, publicProposal } from './serverProposalLinks';

// 120 requests a minute per address: a whole office may share one address.
const hits = new Map<string, { n: number; since: number }>();
function slowDown(req: Request) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.since > 60_000) { hits.set(ip, { n: 1, since: now }); return; }
  if (++h.n > 120) throw new UserError(429, 'too-many', 'Too many tries. Wait a minute and try again.');
}

const KINDS: LinkKind[] = ['quotation', 'outline', 'teambuilding'];

// One update from the client's page.
export async function recordVisit(body: any) {
  if (body?.team) return;
  const token = String(body?.token || '');
  if (!isLinkToken(token)) return;
  const { db } = admin();
  const linkRef = db.collection('doc_links').doc(token);
  const link: any = (await linkRef.get()).data();
  if (!link || link.status !== 'open' || !KINDS.includes(link.kind)) return;
  const kind = link.kind as LinkKind;
  const u = cleanVisitUpdate(body, kind);
  if (!u) return;
  const vRef = db.collection('proposal_views').doc(u.visitId);
  const now = Date.now();
  await db.runTransaction(async tx => {
    const v: any = (await tx.get(vRef)).data();
    if (v && v.token !== token) return;   // someone else's visit id
    tx.set(vRef, {
      token, kind, docId: link.docId, dealId: link.dealId || '', ownerId: String(link.ownerId || link.byId || ''),
      device: u.device, browser: u.browser, deviceId: v?.deviceId || u.deviceId,
      startedAt: v?.startedAt || now,
      ...mergeVisit(v, u, now),
    });
    if (u.vis) tx.update(linkRef, { totalSeconds: FieldValue.increment(u.vis) });
  });
}

const COLLECTION: Record<LinkKind, string> = { quotation: 'quotations', outline: 'course_outlines', teambuilding: 'teambuilding_proposals' };

export function registerLinkVisitRoutes(app: Express) {
  const visit = route(async req => {
    slowDown(req);
    await recordVisit(req.body);
    return {};
  });
  app.post('/api/link-visit', visit);
  app.post('/api/proposal-link/visit', visit);   // teambuilding pages opened before 2026-10-20

  app.post('/api/link-preview', route(async req => {
    const caller = await callerFrom(req);
    const token = String(req.body?.token || '');
    if (!isLinkToken(token)) throw new UserError(404, 'link-not-found', 'That link was not found.');
    const { db } = admin();
    const link: any = (await db.collection('doc_links').doc(token).get()).data();
    if (!link) throw new UserError(404, 'link-not-found', 'That link was not found.');
    const settings: any = (await db.collection('config').doc('proposal_settings').get()).data() || {};
    if (!seesLink({ id: caller.memberId, role: caller.role }, { allowedIds: settings.allowedIds || [] }, link)) {
      throw new UserError(403, 'not-allowed', 'Only Management can see how clients use links.');
    }
    const kind = link.kind as LinkKind;
    if (kind === 'teambuilding') {
      const { r } = await loadProposal(db, link);
      return { kind, proposal: publicProposal(r) };
    }
    const d: any = (await db.collection(COLLECTION[kind] || 'quotations').doc(link.docId).get()).data();
    if (!d) throw new UserError(404, 'doc-gone', 'The document behind this link was deleted.');
    return { kind, doc: { ...publicDocFields(d), id: link.docId }, revised: d.status !== 'sent' };
  }));
}
