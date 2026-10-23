// Link for accounts on a payment request (Joel, 2026-10-20: "raise payment need to be able to be exported as a link
// for my accounts to make payment; when completed it shows 'payment made' in the raise payment ticket").
// Admin or Management makes the link from the request (Money.tsx, AccountsLink). Accounts open /pay/<token> without
// logging in (PaymentLinkPage.tsx): they see the request and its status ("Payment raised …, waiting approval" with
// the date and time, then who approved it), and once it's approved, one button: "Payment made". That marks the
// request paid with the exact time, and the CRM ticket shows "Payment made".
// - payment_links/{token}: { moneyOutId, forText, status open/stopped, createdAt, byId, byName }. No database rule,
//   so only this server reads or writes it. money_out.accountsLink keeps the token so the CRM can show the link again.
// - The link has no open limit (accounts may check it several times while it waits for approval); Stop link ends it.
// Since 2026-10-21 new links are made only for payment summaries (below): each payment can be on one summary at a
// time, so accounts never get it twice. Single-payment links made before keep working until stopped.

import type { Express, Request } from 'express';
import crypto from 'crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { admin, UserError, callerFrom, route } from './serverAuth';
import { addDealHistory } from './serverDocLinks';
import { isLinkToken } from './src/lib/docLinks';
import { ACCOUNTS_PAID_BY, paymentRef } from './src/lib/money';
import { buildSummary, summaryProblem, summaryRef } from './src/lib/paymentSummary';
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
  if (link.kind === 'batch') return { db, link, outRef: db.collection('money_out').doc('_batch'), o: null as any };  // a summary: see payBatch
  const outRef = db.collection('money_out').doc(link.moneyOutId);
  const o: any = (await outRef.get()).data();
  if (!o || o.dealDeleted || o.deleted) throw new UserError(410, 'payment-gone', `This payment request was cancelled. Please contact NEXT Academy (${COMPANY.phone}).`);
  return { db, link, outRef, o };
}

export function registerPaymentLinkRoutes(app: Express) {
  registerBatchRoutes(app);

  // Make the link (or give back the one the request already has).
  app.post('/api/pay-link/create', route(async req => {
    await staffFrom(req);
    const id = String(req.body?.id || '');
    const { db } = admin();
    const outRef = id ? db.collection('money_out').doc(id) : null;
    const o: any = outRef ? (await outRef.get()).data() : null;
    if (!outRef || !o || o.dealDeleted || o.deleted) throw new UserError(404, 'not-found', 'That payment request was not found.');
    if (o.status === 'rejected') throw new UserError(409, 'rejected', 'This request was rejected, so there is nothing to pay.');
    const had = o.accountsLink?.token;
    if (had && (await db.collection('payment_links').doc(had).get()).data()?.status === 'open') return { token: had };
    // Since 2026-10-21 accounts are sent payment summaries only (one summary per payment, so nothing is paid twice);
    // links made before keep working until stopped.
    throw new UserError(410, 'use-summary', 'Payments now go to accounts on a payment summary (Admin work → Money).');
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
    if (link.kind === 'batch') {
      const batch = db.batch();
      const docs = await Promise.all((link.moneyOutIds || []).map((id: string) => db.collection('money_out').doc(id).get()));
      docs.forEach(d => { if (d.exists && (d.data() as any).summaryToken === token) batch.update(d.ref, { summaryToken: '' }); });
      await batch.commit();
      return {};
    }
    const outRef = db.collection('money_out').doc(link.moneyOutId);
    const o: any = (await outRef.get()).data();
    if (o?.accountsLink?.token === token) await outRef.update({ accountsLink: null });
    return {};
  }));

  // What accounts see.
  app.post('/api/pay-link/get', route(async req => {
    slowDown(req);
    const token = String(req.body?.token || '');
    const { db, link, o } = await openLink(token);
    if (link.kind === 'batch') return publicBatch(db, token, link);
    return publicPayment(link.moneyOutId, o, link.forText || '');
  }));

  // Accounts click "Payment made". Only an approved request can be paid (same rule as in the CRM).
  app.post('/api/pay-link/paid', route(async req => {
    slowDown(req);
    const token = String(req.body?.token || '');
    const { db, link, outRef } = await openLink(token);
    const paidRef = String(req.body?.ref || '').trim().slice(0, 80);
    if (link.kind === 'batch') return payBatch(db, token, link, req.body?.ids, paidRef);
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

// ---------- Payment summary for accounts (2026-10-20) ----------
// Admin work → Money → "Payment summary for accounts": several approved requests on one link, grouped by vendor with
// their bank details (vendors). payment_links/{token}: { kind: 'batch', moneyOutIds, status, createdAt, byId, byName }.
// Each request keeps summaryToken so the CRM shows it was sent. Accounts click "Payment made" per vendor (ids).

const dayText = (iso: string) => {
  const d = /^\d{4}-\d{2}-\d{2}/.test(iso || '') ? new Date(iso.slice(0, 10) + 'T00:00:00') : null;
  return d ? d.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
};

async function loadBatch(db: Firestore, link: any) {
  const ids: string[] = (link.moneyOutIds || []).slice(0, 200);
  const docs = await Promise.all(ids.map(id => db.collection('money_out').doc(id).get()));
  const outs: any[] = docs.filter(d => d.exists).map(d => ({ ...(d.data() as any), id: d.id })).filter(o => !o.dealDeleted && !o.deleted);
  const vendorIds = [...new Set(outs.map(o => o.vendorId).filter(Boolean))] as string[];
  const vendors = (await Promise.all(vendorIds.map(id => db.collection('vendors').doc(id).get()))).filter(d => d.exists).map(d => ({ ...(d.data() as any), id: d.id }));
  const dealIds = [...new Set(outs.map(o => o.dealId).filter(Boolean))] as string[];
  const deals = new Map((await Promise.all(dealIds.map(id => db.collection('pipelines').doc(id).get()))).filter(d => d.exists).map(d => [d.id, d.data() as any]));
  const clientIds = [...new Set([...deals.values()].map(d => d.clientId).filter(Boolean))] as string[];
  const clients = new Map((await Promise.all(clientIds.map(id => db.collection('clients').doc(id).get()))).filter(d => d.exists).map(d => [d.id, d.data() as any]));
  const forText = (o: any) => {
    if (!o.dealId) return 'Company payment';
    const d = deals.get(o.dealId);
    if (!d) return 'Training';
    const client = clients.get(d.clientId)?.companyName || d.client || 'Client';
    return [client, d.courseName, dayText(d.trainingDate)].filter(Boolean).join(' · ');
  };
  return { outs, summary: buildSummary(outs, vendors, forText) };
}

async function publicBatch(db: Firestore, token: string, link: any) {
  const { summary } = await loadBatch(db, link);
  // Only what the summary shows: no deal, client, vendor or people ids.
  const groups = summary.groups.map((g, i) => ({ ...g, key: `g${i}` }));
  return { batch: true, ref: summaryRef(link.createdAt, token), byName: link.byName || '', createdAt: new Date(link.createdAt || Date.now()).toISOString(), summary: { ...summary, groups } };
}

async function payBatch(db: Firestore, token: string, link: any, rawIds: any, paidRef: string) {
  const { summary } = await loadBatch(db, link);
  const groupKey = String(Array.isArray(rawIds) ? rawIds[0] : rawIds || '');
  const group = summary.groups.find((_, i) => `g${i}` === groupKey);
  if (!group) throw new UserError(404, 'not-found', 'That vendor is not on this summary. Reload the page.');
  if (group.bankUnchecked) throw new UserError(409, 'bank-unchecked', "The bank details of this vendor are being checked by NEXT Academy. Please don't pay yet.");
  const now = new Date().toISOString();
  const paid: any[] = [];
  for (const line of group.lines) {
    const ref = db.collection('money_out').doc(line.id);
    const o: any = await db.runTransaction(async tx => {
      const cur: any = (await tx.get(ref)).data();
      if (!cur || cur.status !== 'approved' || cur.deleted) return null;          // pending, rejected or already paid: left alone
      const patch = { status: 'paid', paidDate: todayMY(), paidAt: now, paidRef, paidById: '', paidByName: ACCOUNTS_PAID_BY };
      tx.update(ref, patch);
      return { ...cur, ...patch };
    });
    if (o) paid.push(o);
  }
  if (!paid.length && group.lines.some(l => l.status !== 'paid')) {
    throw new UserError(409, 'not-approved', 'These payments are not approved any more. Please don\'t pay them, and contact NEXT Academy.');
  }
  for (const o of paid) {
    if (o.dealId) await addDealHistory(db, o.dealId, '', ACCOUNTS_PAID_BY, `Payment made: ${o.category} · ${o.payee}${o.description ? ` · ${o.description}` : ''} (${money(o.amount)})${paidRef ? `, ref ${paidRef}` : ''}`);
  }
  return publicBatch(db, token, link);
}

function registerBatchRoutes(app: Express) {
  // Make the link for a summary of approved requests.
  app.post('/api/pay-batch/create', route(async req => {
    const caller = await staffFrom(req);
    const ids = Array.isArray(req.body?.ids) ? [...new Set(req.body.ids.map((x: any) => String(x)).filter(Boolean))] as string[] : [];
    if (!ids.length) throw new UserError(400, 'nothing', 'Tick at least one payment.');
    if (ids.length > 200) throw new UserError(400, 'too-many', 'A summary can have up to 200 payments.');
    const { db } = admin();
    const docs = await Promise.all(ids.map(id => db.collection('money_out').doc(id).get()));
    const bad = docs.find(d => !d.exists || (d.data() as any).dealDeleted || (d.data() as any).deleted || (d.data() as any).status !== 'approved');
    if (bad) throw new UserError(409, 'not-approved', 'Only approved payments that are not paid yet can go on a summary. Reload and try again.');
    // One summary per payment, post-training payments only after the training (2026-10-21), and only with bank
    // details accounts can use (2026-10-23; summaryProblem).
    const dealIds = [...new Set(docs.map(d => (d.data() as any).dealId).filter(Boolean))] as string[];
    const deals = new Map((await Promise.all(dealIds.map(id => db.collection('pipelines').doc(id).get()))).map(d => [d.id, d.data()]));
    const vendorIds = [...new Set(docs.map(d => (d.data() as any).vendorId).filter(Boolean))] as string[];
    const vendors = new Map((await Promise.all(vendorIds.map(id => db.collection('vendors').doc(id).get()))).filter(d => d.exists).map(d => [d.id, { ...(d.data() as any), id: d.id }]));
    for (const d of docs) {
      const o: any = { ...d.data(), id: d.id };
      const problem = summaryProblem(o, deals.get(o.dealId), vendors.get(o.vendorId), todayMY());
      if (problem) throw new UserError(409, 'cannot-add', `${o.payee || 'A payment'}: ${problem}. Reload and try again.`);
    }
    const byName = String((await db.collection('team').doc(caller.memberId).get()).data()?.name || '');
    const token = crypto.randomBytes(16).toString('hex');
    await db.collection('payment_links').doc(token).set({ kind: 'batch', moneyOutIds: ids, status: 'open', createdAt: Date.now(), byId: caller.memberId, byName });
    const batch = db.batch();
    docs.forEach(d => batch.update(d.ref, { summaryToken: token }));
    await batch.commit();
    return { token };
  }));

  // Take one payment off the summary it's on (2026-10-21), so it can go on another one. The summary's link no longer
  // shows it; a summary left with nothing on it is stopped.
  app.post('/api/pay-batch/remove', route(async req => {
    const caller = await staffFrom(req);
    const id = String(req.body?.id || '');
    const { db } = admin();
    const outRef = id ? db.collection('money_out').doc(id) : null;
    const o: any = outRef ? (await outRef.get()).data() : null;
    if (!outRef || !o) throw new UserError(404, 'not-found', 'That payment request was not found.');
    if (o.status === 'paid') throw new UserError(409, 'paid', 'This payment is already paid, so it stays on its summary.');
    const token = String(o.summaryToken || '');
    if (!token) return {};
    const ref = db.collection('payment_links').doc(token);
    const byName = String((await db.collection('team').doc(caller.memberId).get()).data()?.name || '');
    await db.runTransaction(async tx => {
      const link: any = (await tx.get(ref)).data();
      if (link) {
        const left = (link.moneyOutIds || []).filter((x: string) => x !== id);
        tx.update(ref, left.length ? { moneyOutIds: left } : { moneyOutIds: left, status: 'stopped', stoppedAt: Date.now(), stoppedByName: byName });
      }
      tx.update(outRef, { summaryToken: '' });
    });
    if (o.dealId) await addDealHistory(db, o.dealId, caller.memberId, byName, `Taken off the payment summary: ${o.category} · ${o.payee} (${money(o.amount)})`);
    return {};
  }));
}
