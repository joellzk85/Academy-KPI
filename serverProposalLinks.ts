// Teambuilding proposal links, the public part (push B, Joel 2026-10-19). The client opens /p/<token> without logging
// in. These routes are the only way in: they read the proposal with the server's own access and return only what the
// website shows (never other clients, deals or CRM details), record each visit (proposal_views, server-written only,
// no IP addresses), and record "Accept proposal". The team makes, extends and revokes links in the CRM
// (serverDocLinks.ts, the same doc_links list as quotation and outline links).

import type { Express, Request } from 'express';
import { FieldValue, Firestore } from 'firebase-admin/firestore';
import { admin, UserError, route } from './serverAuth';
import { isLinkToken } from './src/lib/docLinks';
import { COMPANY } from './src/lib/company';
import { statusForStage } from './src/lib/deals';
import { EVENT_LABELS, cleanVisitUpdate, isExpired, plusDaysMY } from './src/lib/proposalTracking';
import { TbProposal, priceFor, resolveTb } from './src/lib/teambuilding';

// Light protection against someone hammering the links: 120 requests a minute per address (tracking sends a small
// update about every 15 seconds, and a whole office may share one address).
const hits = new Map<string, { n: number; since: number }>();
function slowDown(req: Request) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.since > 60_000) { hits.set(ip, { n: 1, since: now }); return; }
  if (++h.n > 120) throw new UserError(429, 'too-many', 'Too many tries. Wait a minute and try again.');
}

const GONE = 'This link is not valid. Please contact NEXT Academy for the latest proposal.';

// The rep's name for the polite "expired / no longer active" message (the team has no phone numbers in the CRM,
// so the company's number is shown).
async function contactOf(db: Firestore, link: any) {
  const id = link.ownerId || link.byId || '';
  const name = id ? String((await db.collection('team').doc(id).get()).data()?.name || link.byName || '') : String(link.byName || '');
  return { name, phone: COMPANY.phone, email: COMPANY.email };
}

async function openLink(db: Firestore, token: any, { allowExpired = false } = {}) {
  const t = String(token || '');
  if (!isLinkToken(t)) throw new UserError(404, 'link-not-found', GONE);
  const ref = db.collection('doc_links').doc(t);
  const link: any = (await ref.get()).data();
  if (!link || link.kind !== 'teambuilding') throw new UserError(404, 'link-not-found', GONE);
  if (link.status !== 'open' || (!allowExpired && isExpired(link))) {
    const c = await contactOf(db, link);
    const err: any = new UserError(410, link.status !== 'open' ? 'link-stopped' : 'link-expired',
      link.status !== 'open' ? 'This proposal link is no longer active.' : 'This proposal link has expired.');
    err.extra = { contact: c };
    throw err;
  }
  return { ref, link, token: t };
}

// The proposal as the client sees it: the latest saved version (Joel: a fix after Revise + Save shows on the same link).
async function loadProposal(db: Firestore, link: any) {
  const snap = await db.collection('teambuilding_proposals').doc(link.docId).get();
  const p = snap.data() as TbProposal | undefined;
  if (!p || p.dealDeleted) throw new UserError(404, 'doc-gone', GONE);
  const deal = p.pipelineId ? (await db.collection('pipelines').doc(p.pipelineId).get()).data() : null;
  const clientId = (deal as any)?.clientId || p.clientId || '';
  const client = clientId ? (await db.collection('clients').doc(clientId).get()).data() : null;
  const ids = (list: any[], key: string) => Array.from(new Set(list.map(x => x?.[key]).filter(Boolean))) as string[];
  const fetch = async (coll: string, list: string[]) => (await Promise.all(list.map(id => db.collection(coll).doc(id).get())))
    .filter(s => s.exists).map(s => ({ ...(s.data() as any), id: s.id }));
  const [trainers, venues] = await Promise.all([fetch('trainers_directory', ids(p.trainers || [], 'trainerId')), fetch('venues_directory', ids(p.venues || [], 'venueId'))]);
  const ownerId = (deal as any)?.ownerId || (deal as any)?.creatorId || p.ownerId || p.creatorId || '';
  const owner = ownerId ? (await db.collection('team').doc(ownerId).get()).data() : null;
  const r = resolveTb({ ...p, id: snap.id }, {
    clients: client ? [{ ...client, id: clientId }] : [], deals: deal ? [{ ...deal, id: p.pipelineId }] : [],
    trainers, venues, people: owner ? [{ id: ownerId, name: String((owner as any).name || '') }] : [],
  });
  return { r, deal, dealId: p.pipelineId || '' };
}

// Only what the website shows goes to the client's browser.
function publicProposal(r: ReturnType<typeof resolveTb>) {
  const p = r.p;
  return {
    refNumber: p.refNumber, title: p.title, subtitle: p.subtitle, coverPhoto: p.coverPhoto || '', stay: p.stay || '',
    objectives: p.objectives || [], takeaways: p.takeaways || [],
    trainers: (p.trainers || []).filter(t => (t.name || '').trim()).map(t => ({ id: t.id, name: t.name, photo: t.photo || '', role: t.role || '', bio: t.bio || '' })),
    agenda: p.agenda || [],
    activities: (p.activities || []).filter(a => a.name.trim()).map(({ libraryId: _l, ...a }) => a),
    venues: (p.venues || []).filter(v => (v.name || '').trim()).map(({ venueId: _v, ...v }) => v),
    packages: p.packages, chosenPackage: p.chosenPackage || '', hrdcNote: p.hrdcNote || '', terms: p.terms || '',
    ownerName: p.ownerName || '', preparedForCompany: r.company,
    sections: r.sections, company: r.company, pax: r.pax, eventDate: r.eventDate, isHrdc: r.isHrdc,
  };
}

const historyLine = (action: string, at = Date.now()) => ({ at: new Date(at).toISOString(), byId: '', byName: 'Client', action });

async function addDealHistory(db: Firestore, dealId: string, action: string) {
  if (!dealId) return;
  const ref = db.collection('pipelines').doc(dealId);
  await db.runTransaction(async tx => {
    const deal: any = (await tx.get(ref)).data();
    if (!deal) return;
    tx.update(ref, { history: [...(deal.history || []), historyLine(action)].slice(-40) });
  }).catch(e => console.error('[proposal-link] deal history', e));
}

export function registerProposalLinkRoutes(app: Express) {
  // What the client's page shows. `team: true` (the CRM's Open button, or a browser where someone from the team is
  // logged in to the CRM) isn't counted.
  app.post('/api/proposal-link/get', route(async req => {
    slowDown(req);
    const { db } = admin();
    try {
      const { ref, link } = await openLink(db, req.body?.token);
      const { r, dealId } = await loadProposal(db, link);
      if (!req.body?.team) {
        const now = Date.now();
        await ref.update({ views: FieldValue.increment(1), lastViewedAt: now, ...(link.firstViewedAt ? {} : { firstViewedAt: now }) });
        if (!link.firstViewedAt) await addDealHistory(db, dealId || link.dealId, `Client opened the teambuilding proposal${link.refNumber ? ` ${link.refNumber}` : ''} (link)`);
      }
      return { proposal: publicProposal(r), accepted: link.accepted || null, expiresAt: link.expiresAt || 0 };
    } catch (e: any) {
      if (e?.extra) return { gone: { code: e.code, message: e.message, ...e.extra } };
      throw e;
    }
  }));

  // A small update about every 15 seconds while the page is visible, and one when it closes (sendBeacon).
  app.post('/api/proposal-link/visit', route(async req => {
    slowDown(req);
    if (req.body?.team) return {};
    const u = cleanVisitUpdate(req.body);
    if (!u) return {};
    const { db } = admin();
    const { ref: linkRef, link, token } = await openLink(db, req.body?.token, { allowExpired: true });
    const vRef = db.collection('proposal_views').doc(u.visitId);
    const now = Date.now();
    const added = Object.values(u.add).reduce((t, n) => t + n, 0);
    let note = '';
    await db.runTransaction(async tx => {
      const v: any = (await tx.get(vRef)).data();
      if (v && v.token !== token) return;   // someone else's visit id
      const sections = { ...(v?.sections || {}) };
      Object.entries(u.add).forEach(([k, n]) => { sections[k] = (sections[k] || 0) + n; });
      const events = [...(v?.events || []), ...u.events].slice(-200);
      const flagged = u.events.filter(e => e.type !== 'rightclick');
      if (flagged.length && !v?.historyNoted) {
        const kinds = Array.from(new Set(flagged.map(e => EVENT_LABELS[e.type].replace(/ attempt$/, '').toLowerCase())));
        note = `${kinds.join(', ').replace(/^./, c => c.toUpperCase())} attempt while viewing the teambuilding proposal${link.refNumber ? ` ${link.refNumber}` : ''} (${u.device}, ${u.browser})`;
      }
      tx.set(vRef, {
        token, docId: link.docId, dealId: link.dealId || '', device: u.device, browser: u.browser,
        startedAt: v?.startedAt || now, lastSeenAt: now, seconds: (v?.seconds || 0) + added, sections, events,
        ...(note || v?.historyNoted ? { historyNoted: true } : {}),
      });
      if (added) tx.update(linkRef, { totalSeconds: FieldValue.increment(added) });
    });
    // One History line per visit, however many keys were pressed.
    if (note) await addDealHistory(db, link.dealId, note);
    return {};
  }));

  // "Accept proposal": the client's name and position (and an optional note). A deal at New or Proposal sent moves to
  // Client approved; it is never marked Won (Won = the signed quotation). Further along, it's just recorded.
  app.post('/api/proposal-link/accept', route(async req => {
    slowDown(req);
    const { db } = admin();
    const { ref, link } = await openLink(db, req.body?.token);
    if (link.accepted) throw new UserError(409, 'already-accepted', `This proposal was already accepted by ${link.accepted.name} on ${new Date(link.accepted.at).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kuala_Lumpur' })}. Thank you.`);
    const name = String(req.body?.name || '').trim().slice(0, 80);
    const position = String(req.body?.position || '').trim().slice(0, 80);
    const note = String(req.body?.note || '').trim().slice(0, 1000);
    if (name.length < 2) throw new UserError(400, 'no-name', 'Please type your name.');
    if (position.length < 2) throw new UserError(400, 'no-position', 'Please type your position.');
    const { r, dealId } = await loadProposal(db, link);
    const pk = r.p.packages;
    const col = (pk?.cols || []).find(c => c.id === String(req.body?.packageId || '')) || null;
    const pax = Math.max(0, Math.min(9999, Math.round(Number(req.body?.pax) || r.pax || 0)));
    const price = col ? priceFor(pk, col.id, pax).price : null;
    const now = Date.now();
    const accepted = { name, position, ...(note ? { note } : {}), ...(col ? { packageName: col.name } : {}), pax, price, at: now };
    const what = [col ? `package "${col.name}"` : '', pax ? `${pax} pax` : '', price ? `RM ${price.toLocaleString('en-MY')}` : ''].filter(Boolean).join(', ');
    const dRef = dealId ? db.collection('pipelines').doc(dealId) : null;
    await db.runTransaction(async tx => {
      const l: any = (await tx.get(ref)).data();
      if (l?.accepted) throw new UserError(409, 'already-accepted', 'This proposal was already accepted. Thank you.');
      const deal: any = dRef ? (await tx.get(dRef)).data() : null;
      tx.update(ref, { accepted });
      if (!deal || !dRef) return;
      const stage = String(deal.stage || '');
      const moves = ['lead', 'appointment', 'proposal'].includes(stage);
      const action = `Client accepted the proposal online: ${name}, ${position}${what ? ` (${what})` : ''}${note ? `. Note: "${note.slice(0, 200)}"` : ''}${moves ? '' : ' (recorded only; the deal was already further along)'}`;
      tx.update(dRef, {
        ...(moves ? { stage: 'agreed', status: statusForStage('agreed'), agreedDate: plusDaysMY(0, now) } : {}),
        proposalAcceptedAt: now,
        history: [...(deal.history || []), historyLine(action, now)].slice(-40),
      });
    });
    return { accepted };
  }));
}
