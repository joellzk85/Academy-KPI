// Link for accounts on a payment request (Joel, 2026-10-20: "raise payment need to be able to be exported as a link
// for my accounts to make payment; when completed it shows 'payment made' in the raise payment ticket").
// Admin or Management makes the link from the request (Money.tsx, AccountsLink). Accounts open /pay/<token> without
// logging in (PaymentLinkPage.tsx): they see the request and its status ("Payment raised …, waiting approval" with
// the date and time, then who approved it), and once it's approved, one button: "Payment made". That marks the
// request paid with the exact time, and the CRM ticket shows "Payment made".
// - payment_links/{token}: { moneyOutId, forText, status open/stopped, createdAt, byId, byName }. No database rule,
//   so only this server reads or writes it. money_out.accountsLink keeps the token so the CRM can show the link again.
// - The link has no open limit (accounts may check it several times while it waits for approval); Stop link ends it.

import type { Express, Request } from 'express';
import crypto from 'crypto';
import { admin, UserError, callerFrom, route } from './serverAuth';
import { addDealHistory } from './serverDocLinks';
import { isLinkToken } from './src/lib/docLinks';
import { ACCOUNTS_PAID_BY, paymentRef } from './src/lib/money';
import { COMPANY } from './src/lib/company';

const hits = new Map<string, { n: number; since: number }>();
function slowDown(req: Request) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.since > 60_000) { hits.set(ip, { n: 1, since: now }); return; }
  if (++h.n > 60) throw new UserError(429, 'too-many', 'Too many tries. Wait a minute and try again.');
}

async function staffFrom(req: Request) {
  const caller = await callerFrom(req);
  if (caller.role !== 'admin' && caller.role !== 'management') throw new UserError(403, 'staff-only', 'Only Admin or Management can do this.');
  return caller;
}

// YYYY-MM-DD in Malaysia.
const todayMY = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
const money = (n: any) => 'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Only what the payment request sheet shows: no deal, client or people ids.
function publicPayment(id: string, o: any, forText: string) {
  const pick = ['kind', 'category', 'payee', 'description', 'amount', 'timing', 'status', 'requestedByName', 'requestedAt', 'requestDate',
    'decidedByName', 'decidedAt', 'rejectReason', 'paidDate', 'paidRef', 'paidByName', 'paidAt', 'items', 'neededBy', 'paymentDetails'];
  const out: any = { id, dealId: o.dealId ? 'deal' : '', paidById: o.paidById ? 'crm' : '' };
  for (const k of pick) if (o[k] !== undefined) out[k] = o[k];
  return { payment: out, forText, ref: paymentRef({ id, requestDate: o.requestDate, requestedAt: o.requestedAt }) };
}

async function openLink(token: string) {
  const gone = 'This link is not valid. Ask NEXT Academy for a new one.';
  if (!isLinkToken(token)) throw new UserError(404, 'link-not-found', gone);
  const { db } = admin();
  const ref = db.collection('payment_links').doc(token);
  const link: any = (await ref.get()).data();
  if (!link) throw new UserError(404, 'link-not-found', gone);
  if (link.status !== 'open') throw new UserError(410, 'link-stopped', `This payment link is no longer active. Please contact NEXT Academy (${COMPANY.phone}).`);
  const outRef = db.collection('money_out').doc(link.moneyOutId);
  const o: any = (await outRef.get()).data();
  if (!o || o.dealDeleted) throw new UserError(410, 'payment-gone', `This payment request was cancelled. Please contact NEXT Academy (${COMPANY.phone}).`);
  return { db, link, outRef, o };
}

export function registerPaymentLinkRoutes(app: Express) {
  // Make the link (or give back the one the request already has).
  app.post('/api/pay-link/create', route(async req => {
    const caller = await staffFrom(req);
    const id = String(req.body?.id || '');
    const { db } = admin();
    const outRef = id ? db.collection('money_out').doc(id) : null;
    const o: any = outRef ? (await outRef.get()).data() : null;
    if (!outRef || !o || o.dealDeleted) throw new UserError(404, 'not-found', 'That payment request was not found.');
    if (o.status === 'rejected') throw new UserError(409, 'rejected', 'This request was rejected, so there is nothing to pay.');
    const had = o.accountsLink?.token;
    if (had && (await db.collection('payment_links').doc(had).get()).data()?.status === 'open') return { token: had };
    const byName = String((await db.collection('team').doc(caller.memberId).get()).data()?.name || '');
    const token = crypto.randomBytes(16).toString('hex');
    await db.collection('payment_links').doc(token).set({
      moneyOutId: id, forText: String(req.body?.forText || '').slice(0, 200), status: 'open',
      createdAt: Date.now(), byId: caller.memberId, byName,
    });
    await outRef.update({ accountsLink: { token, at: new Date().toISOString(), byName } });
    return { token };
  }));

  // Stop the link. Making one again gives a new link.
  app.post('/api/pay-link/stop', route(async req => {
    const caller = await staffFrom(req);
    const token = String(req.body?.token || '');
    if (!isLinkToken(token)) throw new UserError(404, 'link-not-found', 'That link was not found.');
    const { db } = admin();
    const ref = db.collection('payment_links').doc(token);
    const link: any = (await ref.get()).data();
    if (!link) throw new UserError(404, 'link-not-found', 'That link was not found.');
    const byName = String((await db.collection('team').doc(caller.memberId).get()).data()?.name || '');
    await ref.update({ status: 'stopped', stoppedAt: Date.now(), stoppedByName: byName });
    const outRef = db.collection('money_out').doc(link.moneyOutId);
    const o: any = (await outRef.get()).data();
    if (o?.accountsLink?.token === token) await outRef.update({ accountsLink: null });
    return {};
  }));

  // What accounts see.
  app.post('/api/pay-link/get', route(async req => {
    slowDown(req);
    const { link, o } = await openLink(String(req.body?.token || ''));
    return publicPayment(link.moneyOutId, o, link.forText || '');
  }));

  // Accounts click "Payment made". Only an approved request can be paid (same rule as in the CRM).
  app.post('/api/pay-link/paid', route(async req => {
    slowDown(req);
    const { db, link, outRef } = await openLink(String(req.body?.token || ''));
    const paidRef = String(req.body?.ref || '').trim().slice(0, 80);
    const now = new Date().toISOString();
    const result = await db.runTransaction(async tx => {
      const o: any = (await tx.get(outRef)).data();
      if (!o) throw new UserError(410, 'payment-gone', 'This payment request was cancelled.');
      if (o.status === 'paid') return { o, already: true };
      if (o.status === 'pending') throw new UserError(409, 'not-approved', 'This payment is still waiting for approval. Please don\'t pay it yet.');
      if (o.status !== 'approved') throw new UserError(409, 'rejected', 'This payment request was rejected. Please don\'t pay it.');
      const patch = { status: 'paid', paidDate: todayMY(), paidAt: now, paidRef, paidById: '', paidByName: ACCOUNTS_PAID_BY };
      tx.update(outRef, patch);
      return { o: { ...o, ...patch }, already: false };
    });
    if (!result.already && result.o.dealId) {
      await addDealHistory(db, result.o.dealId, '', ACCOUNTS_PAID_BY,
        `Payment made: ${result.o.category} · ${result.o.payee} (${money(result.o.amount)})${paidRef ? `, ref ${paidRef}` : ''}`);
    }
    return publicPayment(link.moneyOutId, result.o, link.forText || '');
  }));
}
