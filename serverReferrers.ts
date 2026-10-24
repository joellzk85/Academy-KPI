// Referrers and referral fees (Joel, 2026-10-24; src/lib/referrers.ts).
// - POST /api/referral/link { referrerId }      any team member: the referrer's link for their bank details (the open
//                                                 one, or a new one). Returns { token }.
// - POST /api/referral/link-get { token }        public (/ref/<token>): what the form shows. The account number is
//                                                 never sent back.
// - POST /api/referral/link-submit { token, data } public: stores what the referrer typed, for Admin to accept.
// - POST /api/referral/accept { referrerId }     Admin and Management: puts the bank details on the referrer's vendor
//                                                 record (waiting for a manager's check, like any vendor's), and on
//                                                 their referral fee requests that have no vendor yet.
// - POST /api/referral/raise { dealId }          the deal owner, Admin or Management, after the deal is won: raises the
//                                                 pending "Referral fee" payment request (money_out ref_<dealId>) once;
//                                                 while still pending, a changed fee updates it. Returns { amount, status }.

import crypto from 'node:crypto';
import type { Express, Request } from 'express';
import { admin, UserError, callerFrom, route } from './serverAuth';
import { dealOwnerId, dealStage, formatRM, todayIso } from './src/lib/deals';
import {
  REFERRAL_CATEGORY, REFERRER_LINK_DAYS, cleanReferrerSubmission, referralFee, referralFeeText, referralOutId, referrerSubmissionProblem,
} from './src/lib/referrers';
import { withBankStamp } from './src/lib/vendors';

// Light protection against someone hammering the links: 40 requests a minute per address.
const hits = new Map<string, { n: number; since: number }>();
function slowDown(req: Request) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.since > 60_000) { hits.set(ip, { n: 1, since: now }); return; }
  if (++h.n > 40) throw new UserError(429, 'too-many', 'Too many tries. Wait a minute and try again.');
}

const NOT_FOUND = 'This link is not valid. Ask NEXT Academy for a new one.';

async function openLink(token: any) {
  const t = String(token || '');
  if (!/^[a-f0-9]{32}$/.test(t)) throw new UserError(404, 'link-not-found', NOT_FOUND);
  const { db } = admin();
  const ref = db.collection('referrer_links').doc(t);
  const snap = await ref.get();
  if (!snap.exists) throw new UserError(404, 'link-not-found', NOT_FOUND);
  const link: any = snap.data();
  if (link.status === 'cancelled') throw new UserError(410, 'link-closed', 'This link has been cancelled. Ask NEXT Academy for a new one if needed.');
  if (link.status === 'accepted') throw new UserError(410, 'link-done', 'Thank you, NEXT Academy has already received and accepted your details. The link is now closed.');
  if (Number(link.expiresAt) && Date.now() > Number(link.expiresAt)) throw new UserError(410, 'link-expired', 'This link has expired. Ask NEXT Academy for a new one.');
  return { db, ref, link };
}

async function memberName(db: any, id: string) {
  return String((await db.collection('team').doc(id).get()).data()?.name || 'Team member');
}

export function registerReferrerRoutes(app: Express) {
  app.post('/api/referral/link', route(async req => {
    const caller = await callerFrom(req);
    const { db } = admin();
    const id = String(req.body?.referrerId || '');
    const rRef = db.collection('referrers').doc(id);
    const r = id ? await rRef.get() : null;
    if (!r?.exists) throw new UserError(404, 'not-found', 'This referrer is not on the list any more.');
    const cur: any = r.data()?.link;
    if (cur?.token && cur.status !== 'accepted') {
      const l = await db.collection('referrer_links').doc(cur.token).get();
      const d: any = l.data();
      if (l.exists && d.status !== 'cancelled' && !(Number(d.expiresAt) && Date.now() > Number(d.expiresAt))) return { token: cur.token };
    }
    const token = crypto.randomBytes(16).toString('hex');
    const byName = await memberName(db, caller.memberId);
    const now = Date.now();
    await db.collection('referrer_links').doc(token).set({
      token, referrerId: id, referrerName: String(r.data()?.name || ''), status: 'open',
      createdById: caller.memberId, createdByName: byName, createdAt: now, expiresAt: now + REFERRER_LINK_DAYS * 86400000,
    });
    await rRef.update({ link: { token, at: new Date(now).toISOString(), byName, status: 'open' } });
    return { token };
  }));

  app.post('/api/referral/link-get', route(async req => {
    slowDown(req);
    const { link } = await openLink(req.body?.token);
    const s = link.submission || {};
    return {
      status: link.status, askedBy: String(link.createdByName || '').split(/\s+/)[0] || 'NEXT Academy',
      prefill: { name: s.name || link.referrerName || '', phone: s.phone || '', email: s.email || '', bankName: s.bankName || '', accountName: s.accountName || '', accountNo: '' },
      sent: !!link.submission,
    };
  }));

  app.post('/api/referral/link-submit', route(async req => {
    slowDown(req);
    const { db, ref, link } = await openLink(req.body?.token);
    const submission = cleanReferrerSubmission(req.body?.data);
    const problem = referrerSubmissionProblem(submission);
    if (problem) throw new UserError(400, 'invalid', problem);
    await ref.update({ submission, submittedAt: Date.now(), status: 'submitted' });
    await db.collection('referrers').doc(link.referrerId).update({ 'link.status': 'submitted' }).catch(() => {});
    return {};
  }));

  app.post('/api/referral/accept', route(async req => {
    const caller = await callerFrom(req);
    if (caller.role === 'rep') throw new UserError(403, 'staff-only', 'Only Admin and Management accept bank details.');
    const { db } = admin();
    const id = String(req.body?.referrerId || '');
    const rRef = db.collection('referrers').doc(id);
    const r: any = (await rRef.get()).data();
    if (!r) throw new UserError(404, 'not-found', 'This referrer is not on the list any more.');
    const token = r.link?.token;
    const lRef = token ? db.collection('referrer_links').doc(token) : null;
    const link: any = lRef ? (await lRef.get()).data() : null;
    if (!link?.submission || link.status !== 'submitted') throw new UserError(400, 'nothing', 'There are no new bank details to accept.');
    const s = link.submission;
    const viewer = { id: caller.memberId, name: await memberName(db, caller.memberId) };
    const now = new Date().toISOString();
    const fields = { name: s.name, phone: s.phone, email: s.email, bankName: s.bankName, accountName: s.accountName, accountNo: s.accountNo, updatedAt: now, updatedByName: viewer.name };
    let vendorId = String(r.vendorId || '');
    const vSnap = vendorId ? await db.collection('vendors').doc(vendorId).get() : null;
    if (vSnap?.exists) {
      const before: any = { ...vSnap.data(), id: vendorId };
      await vSnap.ref.set(withBankStamp({ ...before, ...fields }, before, viewer));
    } else {
      vendorId = `vd_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
      await db.collection('vendors').doc(vendorId).set(withBankStamp({ id: vendorId, type: 'referrer', ...fields, createdAt: now, createdById: viewer.id, createdByName: viewer.name } as any, null, viewer));
    }
    await rRef.update({ vendorId, name: s.name || r.name, phone: s.phone || r.phone || '', 'link.status': 'accepted' });
    await lRef!.update({ status: 'accepted', acceptedAt: Date.now(), acceptedByName: viewer.name });
    // Referral fee requests already raised for this referrer, not yet paid: now they know who to pay.
    const outs = await db.collection('money_out').where('referrerId', '==', id).get();
    await Promise.all(outs.docs.filter(d => !d.data().vendorId && d.data().status !== 'paid').map(d => d.ref.update({ vendorId, payee: s.name || r.name })));
    return { vendorId };
  }));

  app.post('/api/referral/raise', route(async req => {
    const caller = await callerFrom(req);
    const { db } = admin();
    const dealId = String(req.body?.dealId || '');
    const deal: any = dealId ? (await db.collection('pipelines').doc(dealId).get()).data() : null;
    if (!deal) throw new UserError(404, 'not-found', 'This deal is not there any more.');
    if (caller.role === 'rep' && dealOwnerId(deal) !== caller.memberId) throw new UserError(403, 'not-yours', "Only the deal's owner, Admin or Management can do this.");
    const amount = referralFee({ ...deal, id: dealId });
    if (dealStage(deal) !== 'won' || deal.deleted || !deal.referrerId || !(amount > 0)) return { amount: 0, status: 'none' };
    const ref = db.collection('money_out').doc(referralOutId(dealId));
    const old: any = (await ref.get()).data();
    const r: any = (await db.collection('referrers').doc(deal.referrerId).get()).data() || {};
    const payee = String(r.name || deal.referrerName || 'Referrer');
    const description = `Referral fee for ${deal.client || 'the client'}: ${referralFeeText(deal)}`;
    if (old) {
      // Still waiting for approval and the fee or referrer changed (Management can change them on a won deal): update it.
      if (old.status === 'pending' && !old.deleted && (old.amount !== amount || old.referrerId !== deal.referrerId)) {
        await ref.update({ amount, referrerId: deal.referrerId, payee, vendorId: r.vendorId || '', description });
      }
      return { amount: old.status === 'pending' ? amount : old.amount, status: old.status };
    }
    const byName = await memberName(db, caller.memberId);
    await ref.set({
      id: ref.id, dealId, kind: 'deal', category: REFERRAL_CATEGORY, payee, vendorId: r.vendorId || '', referrerId: deal.referrerId,
      description, amount, timing: 'after', inPL: true, onBehalf: false, notInPLReason: '', requestDate: todayIso(),
      status: 'pending', requestedById: caller.memberId, requestedByName: byName, requestedByRole: caller.role, requestedAt: new Date().toISOString(),
      decidedById: '', decidedByName: '', decidedAt: '', rejectReason: '', paidDate: '', paidRef: '', paidById: '', paidByName: '',
      deleted: false, autoRaised: true,
    });
    return { amount, status: 'pending', text: formatRM(amount) };
  }));
}
