// Accounts portal (Joel, 2026-10-28: "instead of sending the Accounts a link, create a portal"; lib/accountsPortal.ts).
// Accounts staff (Team role Accounts) log in like everyone else but have no auth_map record, so the database rules
// give them nothing: everything they see and do goes through these routes. Management sees the same portal, view
// only, and manages it (settings, open questions, the log) in Management → Accounts portal.
// - config/accounts_portal: the settings (lib/accountsPortal.ts PortalSettings). Written only here.
// - accounts_log/{id}: who did what in the portal (paid, question, bank slip, settings). No database rule: only this
//   server reads or writes it.
// - money_out.accountsQuery: { text, at, byId, byName } while a line is sent back with a question; Admin or
//   Management clear it once sorted (the Payments out board).
// - Payment raised (accounts): money_out.accountsRaised = { at, byId, byName, ref, note }; only a line under "To pay"
//   (approved, payable today, bank details checked). It waits under "Raised, pending release".
// - Payment done (Management only, Joel 2026-10-28): status 'paid', paidDate, paidAt, paidRef, paidById / paidByName = the
//   manager, paidVia 'portal'. Only a raised line. Back to To pay (accounts or a manager) clears accountsRaised.
// - Bank slip (Management in the portal; Admin and Management also drop it on the board): saved like any payment receipt (Storage receipts/{id}_{name}, payment_receipts with moneyOutId), so the
//   board's "Paid, receipt needed" lane clears.

import express from 'express';
import type { Express, Request } from 'express';
import crypto from 'crypto';
import { getApps } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import type { Firestore } from 'firebase-admin/firestore';
import firebaseConfig from './firebase-applet-config.json';
import { admin, UserError, callerFrom, memberFrom, route } from './serverAuth';
import { addDealHistory } from './serverDocLinks';
import { MoneyOut } from './src/lib/money';
import { Vendor } from './src/lib/vendors';
import { PortalDoc, PortalLogEntry, PortalRow, buildPortalRows, cleanPortalSettings, paymentDocs, sectionOf } from './src/lib/accountsPortal';
import { autoPoFor } from './serverTrainerPortal';
import { checklistFileProblem, checklistFileType, safeFileName } from './src/lib/checklistFiles';

const todayMY = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
const money = (n: any) => 'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const SETTINGS = () => admin().db.collection('config').doc('accounts_portal');
const MAX_SLIP = 10 * 1024 * 1024;

/** The accounts person or a manager: the only ones who open the portal. */
async function portalViewer(req: Request) {
  const who = await memberFrom(req);
  if (who.role !== 'accounts' && who.role !== 'management') throw new UserError(403, 'no-access', 'Only Accounts and Management can open the Accounts portal.');
  return who;
}
async function accountsOnly(req: Request) {
  const who = await memberFrom(req);
  if (who.role !== 'accounts') throw new UserError(403, 'accounts-only', 'Only Accounts mark payments made in the portal. Management sees it, view only.');
  return who;
}
async function staffFrom(req: Request) {
  const caller = await callerFrom(req);
  if (caller.role !== 'admin' && caller.role !== 'management') throw new UserError(403, 'staff-only', 'Only Admin or Management can do this.');
  return caller;
}
async function managementFrom(req: Request) {
  const caller = await callerFrom(req);
  if (caller.role !== 'management') throw new UserError(403, 'management-only', 'Only Management can do this.');
  return caller;
}
const nameOf = async (db: Firestore, id: string) => String((await db.collection('team').doc(id).get()).data()?.name || '');

async function readSettings() {
  return cleanPortalSettings((await SETTINGS().get()).data());
}

async function log(db: Firestore, e: Omit<PortalLogEntry, 'id' | 'at'>) {
  const at = new Date().toISOString();
  const id = `${at.replace(/\D/g, '').slice(0, 14)}_${crypto.randomBytes(3).toString('hex')}`;
  await db.collection('accounts_log').doc(id).set({ ...e, at });
}

const byIds = async (db: Firestore, col: string, ids: string[]) => new Map(
  (await Promise.all([...new Set(ids.filter(Boolean))].map(id => db.collection(col).doc(id).get())))
    .filter(d => d.exists).map(d => [d.id, { ...(d.data() as any), id: d.id }]));

/** Every line of the portal, worked out from the live records. */
async function loadRows(db: Firestore): Promise<PortalRow[]> {
  const [outSnap, vendorSnap, receiptSnap, fileSnap, settings] = await Promise.all([
    db.collection('money_out').get(), db.collection('vendors').get(),
    db.collection('payment_receipts').get(), db.collection('checklist_files').get(), readSettings(),
  ]);
  const outs = outSnap.docs.map(d => ({ ...(d.data() as any), id: d.id }) as MoneyOut);
  const vendors = vendorSnap.docs.map(d => ({ ...(d.data() as any), id: d.id }) as Vendor);
  const receipts = receiptSnap.docs.map(d => ({ ...(d.data() as any), id: d.id }));
  const files = fileSnap.docs.map(d => ({ ...(d.data() as any), id: d.id }));
  const docsOf = new Map<string, PortalDoc[]>(outs.map(o => [o.id, paymentDocs(o, receipts, files)]));
  const poOf = await posFor(db, outs.filter(o => !o.deleted && o.status !== 'rejected'));
  const deals = await byIds(db, 'pipelines', outs.map(o => o.dealId));
  const [clients, trainers, trainerPrivate, venues] = await Promise.all([
    byIds(db, 'clients', [...deals.values()].map(d => d.clientId)),
    byIds(db, 'trainers_directory', vendors.map(v => v.trainerId || '')),
    byIds(db, 'trainer_private', vendors.map(v => v.trainerId || '')),
    byIds(db, 'venues_directory', vendors.map(v => v.venueId || '')),
  ]);
  return buildPortalRows({ outs, vendors, deals, clients, trainers, trainerPrivate, venues, docsOf, poOf, settings, today: todayMY() });
}

/** Trainer fees: the PO made automatically on their Trainer step (one per step, shared by its fee lines). */
async function posFor(db: Firestore, outs: MoneyOut[]) {
  const byStep = new Map<string, any>();
  const out = new Map<string, any>();
  for (const o of outs) {
    if (o.category !== 'Trainer' || !o.dealId || !o.checklistTaskId) continue;
    const key = `${o.dealId}/${o.checklistTaskId}`;
    if (!byStep.has(key)) byStep.set(key, await autoPoFor(db, o.dealId, o.checklistTaskId).catch(() => null));
    out.set(o.id, byStep.get(key));
  }
  return out;
}

/** One payment's documents, as the portal lists them; only for a payment the portal shows. */
async function docsForPayment(db: Firestore, id: string) {
  const o: any = (await db.collection('money_out').doc(id).get()).data();
  if (!o) throw new UserError(404, 'not-found', 'That payment was not found. Reload the page.');
  const out = { ...o, id } as MoneyOut;
  const deal: any = out.dealId ? (await db.collection('pipelines').doc(out.dealId).get()).data() : undefined;
  const vendor: any = out.vendorId ? (await db.collection('vendors').doc(out.vendorId).get()).data() : undefined;
  if ((out.dealId && (!deal || deal.deleted)) || !sectionOf(out, deal, vendor, todayMY())) throw new UserError(404, 'not-found', 'That payment is not in the portal any more. Reload the page.');
  const [receipts, files] = await Promise.all([
    db.collection('payment_receipts').get().then(q => q.docs.map(d => ({ ...(d.data() as any), id: d.id }))),
    out.dealId ? db.collection('checklist_files').where('dealId', '==', out.dealId).get().then(q => q.docs.map(d => ({ ...(d.data() as any), id: d.id }))) : Promise.resolve([]),
  ]);
  const docs = paymentDocs(out, receipts, files);
  const paths = new Map<string, string>([...receipts, ...files].map((r: any) => [`${r.id}`, String(r.path || '')]));
  return { docs, paths };
}

/** The lines asked for, each checked again as it is now: are they all in this list (To pay, or Raised)? */
async function linesIn(db: Firestore, ids: string[], want: 'topay' | 'raised') {
  const docs = await Promise.all(ids.map(id => db.collection('money_out').doc(id).get()));
  const outs = docs.filter(d => d.exists).map(d => ({ ...(d.data() as any), id: d.id }) as MoneyOut);
  if (outs.length !== ids.length) throw new UserError(404, 'not-found', 'A payment was not found. Reload the page.');
  const deals = await byIds(db, 'pipelines', outs.map(o => o.dealId));
  const vendors = await byIds(db, 'vendors', outs.map(o => o.vendorId || ''));
  for (const o of outs) {
    const deal = o.dealId ? deals.get(o.dealId) : undefined;
    const where = (o.dealId && !deal) || deal?.deleted ? null : sectionOf(o, deal, vendors.get(o.vendorId || ''), todayMY());
    if (!where || where.section !== want) {
      const why = !where ? 'it was cancelled' : where.section === 'paid' ? 'it is already paid'
        : where.section === 'raised' ? 'it is already raised, waiting for release' : where.section === 'topay' ? 'it was not raised by accounts yet'
        : where.wait.charAt(0).toLowerCase() + where.wait.slice(1);
      throw new UserError(409, 'not-payable', `${o.payee || 'A payment'} (${money(o.amount)}) can't be ${want === 'topay' ? 'raised' : 'marked done'} now: ${why}. Nothing was marked. Reload the page.`);
    }
  }
  return outs;
}

const cleanIds = (raw: any, max = 200) => (Array.isArray(raw) ? [...new Set(raw.map((x: any) => String(x)).filter(x => /^[A-Za-z0-9_-]{1,80}$/.test(x)))] : []).slice(0, max) as string[];

/** The bank slip: a file (base64) bigger than the general 100 KB limit, so this route reads its own body and is
 *  registered before the general JSON reader (server.ts). */
export function registerAccountsSlipRoute(app: Express) {
  app.post('/api/accounts/slip', express.json({ limit: '15mb' }), route(async req => {
    const caller = await managementFrom(req);
    const who = { memberId: caller.memberId, name: await nameOf(admin().db, caller.memberId) };
    const ids = cleanIds(req.body?.ids, 50);
    if (!ids.length) throw new UserError(400, 'nothing', 'Choose the payment the slip is for.');
    const name = safeFileName(String(req.body?.name || 'bank-slip'));
    const data = Buffer.from(String(req.body?.data || ''), 'base64');
    if (!data.length) throw new UserError(400, 'no-file', 'The file was empty. Choose it again.');
    if (data.length > MAX_SLIP) throw new UserError(400, 'too-big', 'Bank slips can be up to 10 MB. Take a smaller photo or save it as a PDF.');
    const problem = checklistFileProblem(name, data.length);
    if (problem) throw new UserError(400, 'bad-file', problem);
    const { db } = admin();
    const docs = await Promise.all(ids.map(id => db.collection('money_out').doc(id).get()));
    const outs = docs.filter(d => d.exists && !(d.data() as any).deleted).map(d => ({ ...(d.data() as any), id: d.id }) as MoneyOut);
    if (outs.length !== ids.length || outs.some(o => o.status !== 'paid')) throw new UserError(409, 'not-paid', 'A bank slip goes on a payment once it is marked paid. Reload the page.');
    const bucket = getStorage(getApps()[0]).bucket((firebaseConfig as any).storageBucket);
    const type = checklistFileType(name);
    const at = new Date().toISOString();
    for (const o of outs) {
      const id = `rc_${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
      const path = `receipts/${id}_${name}`;
      await bucket.file(path).save(data, { contentType: type, resumable: false, metadata: { metadata: { uploadedBy: who.memberId, dealId: o.dealId || '' } } });
      await db.collection('payment_receipts').doc(id).set({
        id, dealId: o.dealId || '', moneyInId: '', recordId: '', moneyOutId: o.id, name, size: data.length, type, path, at, byId: who.memberId, byName: who.name,
      });
    }
    await log(db, { byId: who.memberId, byName: who.name, action: 'slip', text: `Bank slip ${name} added to ${outs.map(o => `${o.payee} ${money(o.amount)}`).join(', ')}`, moneyOutIds: ids });
    return { added: outs.length };
  }));
}

export function registerAccountsPortalRoutes(app: Express) {
  // One document of a payment (Joel, 2026-10-28): accounts can't read Storage, so the server checks and sends the file.
  app.post('/api/accounts/file', async (req, res) => {
    try {
      await portalViewer(req);
      const id = cleanIds([req.body?.id])[0];
      const docId = String(req.body?.docId || '');
      if (!id || !docId) throw new UserError(400, 'nothing', 'Choose a document.');
      const { db } = admin();
      const { docs, paths } = await docsForPayment(db, id);
      const d = docs.find(x => x.id === docId);
      const path = d ? paths.get(d.id) || '' : '';
      if (!d || !/^(receipts|checklist_files)\//.test(path)) throw new UserError(404, 'not-found', 'That document is not on this payment any more. Reload the page.');
      let buf: Buffer;
      try { [buf] = await getStorage(getApps()[0]).bucket((firebaseConfig as any).storageBucket).file(path).download(); }
      catch { throw new UserError(404, 'file-missing', `"${d.name}" could not be found in the file storage. Ask Admin to upload it again.`); }
      res.set('Content-Type', d.type || 'application/octet-stream');
      res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(d.name)}`);
      res.send(buf);
    } catch (err: any) {
      const e = err instanceof UserError ? err : new UserError(500, 'server-error', 'Something went wrong on the server. Try again in a minute.');
      if (!(err instanceof UserError)) console.error('[accounts file]', err);
      res.status(e.status).json({ ok: false, code: e.code, error: e.message });
    }
  });

  // Everything the portal shows.
  app.post('/api/accounts/portal', route(async req => {
    const who = await portalViewer(req);
    const { db } = admin();
    const [rows, settings] = await Promise.all([loadRows(db), readSettings()]);
    return { viewer: { name: who.name, role: who.role, canRaise: who.role === 'accounts' && settings.allowPay, canRelease: who.role === 'management' }, settings, rows };
  }));

  // Accounts tick lines they keyed in the bank and click Payment raised (one bank reference and note for them all).
  // They wait under "Raised, pending release" until a manager releases them in the bank (Payment done, below).
  app.post('/api/accounts/raise', route(async req => {
    const who = await accountsOnly(req);
    const settings = await readSettings();
    if (!settings.allowPay) throw new UserError(403, 'raising-off', 'Marking payments raised in the portal is switched off by Management.');
    const ids = cleanIds(req.body?.ids);
    if (!ids.length) throw new UserError(400, 'nothing', 'Tick at least one payment.');
    const ref = String(req.body?.ref || '').trim().slice(0, 80);
    const note = String(req.body?.note || '').trim().slice(0, 300);
    const { db } = admin();
    await linesIn(db, ids, 'topay');
    const raised = { at: new Date().toISOString(), byId: who.memberId, byName: who.name, ref, note };
    const done: MoneyOut[] = [];
    for (const id of ids) {
      const docRef = db.collection('money_out').doc(id);
      const o = await db.runTransaction(async tx => {
        const cur: any = (await tx.get(docRef)).data();
        if (!cur || cur.status !== 'approved' || cur.deleted || cur.accountsRaised?.at) return null;   // changed a moment ago
        tx.update(docRef, { accountsRaised: raised });
        return { ...cur, id } as MoneyOut;
      });
      if (o) done.push(o);
    }
    for (const o of done) {
      if (o.dealId) await addDealHistory(db, o.dealId, who.memberId, who.name,
        `Payment raised by accounts, pending release: ${o.category} · ${o.payee} (${money(o.amount)})${ref ? `, ref ${ref}` : ''}`);
    }
    if (done.length) {
      await log(db, { byId: who.memberId, byName: who.name, action: 'raised', moneyOutIds: done.map(o => o.id),
        text: `Payment raised, pending release: ${done.map(o => `${o.payee} ${money(o.amount)}`).join(', ')} (total ${money(done.reduce((t, o) => t + (Number(o.amount) || 0), 0))})${ref ? `, ref ${ref}` : ''}${note ? ` · ${note}` : ''}` });
    }
    return { raised: done.map(o => o.id), skipped: ids.length - done.length };
  }));

  // Back to To pay (the bank rejected it, or it was raised by mistake): accounts or a manager.
  app.post('/api/accounts/unraise', route(async req => {
    const who = await portalViewer(req);
    const id = cleanIds([req.body?.id])[0];
    const why = String(req.body?.reason || '').trim().slice(0, 300);
    const { db } = admin();
    const docRef = id ? db.collection('money_out').doc(id) : null;
    const o: any = docRef ? (await docRef.get()).data() : null;
    if (!docRef || !o) throw new UserError(404, 'not-found', 'That payment was not found. Reload the page.');
    if (o.status !== 'approved' || !o.accountsRaised?.at) throw new UserError(409, 'not-raised', 'This payment is not waiting for release any more. Reload the page.');
    await docRef.update({ accountsRaised: null });
    if (o.dealId) await addDealHistory(db, o.dealId, who.memberId, who.name, `Payment back to "to pay" (not released): ${o.payee} (${money(o.amount)})${why ? `: ${why}` : ''}`);
    await log(db, { byId: who.memberId, byName: who.name, action: 'unraised', moneyOutIds: [id], text: `Back to To pay: ${o.payee} ${money(o.amount)}${why ? ` · ${why}` : ''}` });
    return {};
  }));

  // A manager released the raised payments in the bank and clicks Payment done (portal or the Payments out board).
  // Admin completes one by uploading its payment receipt (Joel, 2026-10-28: "admin uploads the payment receipt as payment
  // done as well"): only with a receipt on it, uploaded after it was raised.
  app.post('/api/accounts/done', route(async req => {
    const caller = await staffFrom(req);
    const ids = cleanIds(req.body?.ids);
    if (!ids.length) throw new UserError(400, 'nothing', 'Tick at least one payment.');
    const typedRef = String(req.body?.ref || '').trim().slice(0, 80);
    const { db } = admin();
    const byName = await nameOf(db, caller.memberId);
    const outs = await linesIn(db, ids, 'raised');
    const withReceipt = new Set<string>();
    for (const o of outs) {
      const recs = await db.collection('payment_receipts').where('moneyOutId', '==', o.id).get();
      if (recs.docs.some(d => { const r: any = d.data(); return !r.kind && String(r.at || '') >= String(o.accountsRaised?.at || ''); })) withReceipt.add(o.id);
    }
    if (caller.role !== 'management' && withReceipt.size < outs.length) {
      throw new UserError(403, 'receipt-needed', 'Admin marks a raised payment done by uploading its payment receipt. Upload the receipt first.');
    }
    const now = new Date().toISOString();
    const paid: MoneyOut[] = [];
    for (const id of ids) {
      const docRef = db.collection('money_out').doc(id);
      const o = await db.runTransaction(async tx => {
        const cur: any = (await tx.get(docRef)).data();
        if (!cur || cur.status !== 'approved' || cur.deleted || !cur.accountsRaised?.at) return null;   // changed a moment ago
        const patch = { status: 'paid', paidDate: todayMY(), paidAt: now, paidRef: typedRef || cur.accountsRaised.ref || '', paidById: caller.memberId, paidByName: byName, paidVia: 'portal' };
        tx.update(docRef, patch);
        return { ...cur, ...patch, id } as MoneyOut;
      });
      if (o) paid.push(o);
    }
    for (const o of paid) {
      if (o.dealId) await addDealHistory(db, o.dealId, caller.memberId, byName,
        `Payment done (released${withReceipt.has(o.id) ? `, receipt uploaded by ${byName}` : ''}): ${o.category} · ${o.payee}${o.description ? ` · ${o.description}` : ''} (${money(o.amount)})${o.paidRef ? `, ref ${o.paidRef}` : ''}`);
    }
    if (paid.length) {
      await log(db, { byId: caller.memberId, byName, action: 'paid', moneyOutIds: paid.map(o => o.id),
        text: `Payment done (released${paid.every(o => withReceipt.has(o.id)) ? `, receipt uploaded by ${byName}` : ''}): ${paid.map(o => `${o.payee} ${money(o.amount)}`).join(', ')} (total ${money(paid.reduce((t, o) => t + (Number(o.amount) || 0), 0))})` });
    }
    return { paid: paid.map(o => o.id), skipped: ids.length - paid.length };
  }));

  // Accounts send a line back with a question (wrong bank details, amount looks off, ...).
  app.post('/api/accounts/query', route(async req => {
    const who = await accountsOnly(req);
    const id = cleanIds([req.body?.id])[0];
    const text = String(req.body?.text || '').trim().slice(0, 500);
    if (!id) throw new UserError(400, 'nothing', 'Choose the payment.');
    if (!text) throw new UserError(400, 'no-text', 'Type your question.');
    const { db } = admin();
    const ref = db.collection('money_out').doc(id);
    const o: any = (await ref.get()).data();
    if (!o || o.deleted) throw new UserError(404, 'not-found', 'That payment was not found. Reload the page.');
    if (o.status === 'paid') throw new UserError(409, 'paid', 'This payment is already marked paid.');
    await ref.update({ accountsQuery: { text, at: new Date().toISOString(), byId: who.memberId, byName: who.name } });
    if (o.dealId) await addDealHistory(db, o.dealId, who.memberId, who.name, `Accounts asked about ${o.category} · ${o.payee} (${money(o.amount)}): ${text}`);
    await log(db, { byId: who.memberId, byName: who.name, action: 'query', moneyOutIds: [id], text: `Question on ${o.payee} ${money(o.amount)}: ${text}` });
    return {};
  }));

  // Admin or Management: the question is sorted (the Payments out board, Management → Accounts portal).
  app.post('/api/accounts/query-clear', route(async req => {
    const caller = await staffFrom(req);
    const id = cleanIds([req.body?.id])[0];
    const reply = String(req.body?.reply || '').trim().slice(0, 500);
    const { db } = admin();
    const ref = id ? db.collection('money_out').doc(id) : null;
    const o: any = ref ? (await ref.get()).data() : null;
    if (!ref || !o) throw new UserError(404, 'not-found', 'That payment was not found.');
    if (!o.accountsQuery) return {};
    const byName = await nameOf(db, caller.memberId);
    await ref.update({ accountsQuery: null, accountsQueryLast: { ...o.accountsQuery, clearedAt: new Date().toISOString(), clearedByName: byName, reply } });
    if (o.dealId) await addDealHistory(db, o.dealId, caller.memberId, byName, `Accounts' question on ${o.payee} sorted${reply ? `: ${reply}` : ''}`);
    await log(db, { byId: caller.memberId, byName, action: 'cleared', moneyOutIds: [id], text: `Question on ${o.payee} ${money(o.amount)} sorted${reply ? `: ${reply}` : ''}` });
    return {};
  }));

  // Management: the settings, the people with Accounts access and the log.
  app.post('/api/accounts/admin', route(async req => {
    await managementFrom(req);
    const { db } = admin();
    const [settings, logSnap, team] = await Promise.all([
      readSettings(), db.collection('accounts_log').orderBy('at', 'desc').limit(300).get(),
      db.collection('team').where('role', '==', 'accounts').get(),
    ]);
    return {
      settings,
      log: logSnap.docs.map(d => ({ ...(d.data() as any), id: d.id })),
      people: team.docs.map(d => ({ id: d.id, name: String(d.data().name || ''), active: !!d.data().active })),
    };
  }));

  app.post('/api/accounts/settings', route(async req => {
    const caller = await managementFrom(req);
    const { db } = admin();
    const before = await readSettings();
    const next = cleanPortalSettings(req.body?.settings);
    const byName = await nameOf(db, caller.memberId);
    await SETTINGS().set({ ...next, updatedAt: new Date().toISOString(), updatedByName: byName });
    const changes = [
      before.allowPay !== next.allowPay ? (next.allowPay ? 'raising payments in the portal switched on' : 'raising payments in the portal switched off') : '',
      before.raisedDays !== next.raisedDays ? `pending release turns amber after ${next.raisedDays} working days` : '',
      JSON.stringify(before.hiddenColumns) !== JSON.stringify(next.hiddenColumns) ? 'columns shown changed' : '',
      JSON.stringify(before.hiddenFields) !== JSON.stringify(next.hiddenFields) ? 'receiver details shown changed' : '',
      JSON.stringify(before.categoryNames) !== JSON.stringify(next.categoryNames) ? 'category names changed' : '',
    ].filter(Boolean);
    if (changes.length) await log(db, { byId: caller.memberId, byName, action: 'settings', text: `Settings: ${changes.join(', ')}` });
    return { settings: next };
  }));
}
