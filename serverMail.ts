// NEXT Academy CRM: send quotations by Outlook email, run on the server (2026-10-18).
//
// How it works, in plain terms:
// - The company's Microsoft 365 has an "app registration" for the CRM with the Mail.Send permission
//   (application, admin consent). Management pastes its Tenant ID, Client ID and Client secret into the CRM once.
// - The IDs are in config/outlook; the secret is in server_secrets/outlook. Only this server reads or writes them.
// - Each person's work email is in team_emails/{memberId} (Management sets it in Team).
// - /api/mail/send sends the email FROM the logged-in person's own mailbox (never anyone else's), with the
//   quotation PDF attached, through Microsoft Graph. It lands in their Outlook Sent Items, and replies come to them.
// - Nobody signs in to Microsoft; the CRM login stays name + password.

import express from 'express';
import type { Express } from 'express';
import { admin, UserError, callerFrom, managementFrom, route } from './serverAuth';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const MAX_PDF_BYTES = 3 * 1024 * 1024;        // Graph's simple send takes about 4 MB in all
const MAX_RECIPIENTS = 10;
const SENDS_PER_HOUR = 40;
const EMAIL_RE = /^[^\s@<>(),;:"\[\]]+@[^\s@<>(),;:"\[\]]+\.[^\s@<>(),;:"\[\]]{2,}$/;
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type OutlookSettings = { tenantId?: string; clientId?: string; checkedAt?: number; lastError?: string; lastSentAt?: number };

export const cleanEmail = (v: unknown): string => {
  const e = String(v || '').trim().toLowerCase();
  return e.length <= 200 && EMAIL_RE.test(e) ? e : '';
};

async function readSettings(): Promise<OutlookSettings> {
  const { db } = admin();
  return ((await db.collection('config').doc('outlook').get()).data() || {}) as OutlookSettings;
}

async function readSecret(): Promise<string> {
  const { db } = admin();
  return String((await db.collection('server_secrets').doc('outlook').get()).data()?.clientSecret || '');
}

// ---------- Microsoft access ----------
let cachedToken: { key: string; token: string; expires: number } | null = null;

async function graphToken(tenantId: string, clientId: string, secret: string): Promise<string> {
  const key = `${tenantId}|${clientId}|${secret.slice(-6)}`;
  if (cachedToken && cachedToken.key === key && cachedToken.expires > Date.now() + 60_000) return cachedToken.token;
  let res: Response;
  try {
    res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: secret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new UserError(503, 'outlook-unreachable', "The CRM couldn't reach Microsoft. Try again in a minute.");
  }
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const text = `${data.error || ''} ${data.error_description || ''}`;
    console.error('[mail] Microsoft token error', res.status, text.slice(0, 300));
    if (/AADSTS7000215|AADSTS7000222|AADSTS7000216/.test(text)) throw new UserError(400, 'outlook-bad-secret', 'The client secret is wrong or has expired. Make a new one (Certificates & secrets) and paste its Value, not its Secret ID.');
    if (/AADSTS700016|AADSTS900144/.test(text)) throw new UserError(400, 'outlook-bad-client', "Microsoft doesn't recognise that Client ID. Copy the \"Application (client) ID\" from the app's Overview page.");
    if (/AADSTS90002|AADSTS900023/.test(text)) throw new UserError(400, 'outlook-bad-tenant', "Microsoft doesn't recognise that Tenant ID. Copy the \"Directory (tenant) ID\" from the app's Overview page.");
    throw new UserError(502, 'outlook-token', `Microsoft didn't accept the CRM's sign-in (${res.status}). Check the three codes.`);
  }
  cachedToken = { key, token: data.access_token, expires: Date.now() + (Number(data.expires_in) || 600) * 1000 };
  return cachedToken.token;
}

// Which application permissions the token carries (from its "roles" claim).
function tokenRoles(token: string): string[] {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return Array.isArray(payload.roles) ? payload.roles : [];
  } catch {
    return [];
  }
}

async function readyToken(): Promise<string> {
  const s = await readSettings();
  const secret = await readSecret();
  if (!s.tenantId || !s.clientId || !secret) throw new UserError(400, 'outlook-not-set-up', 'Outlook sending isn\'t set up yet. Management can set it up in Management → Team → Outlook email.');
  return graphToken(s.tenantId, s.clientId, secret);
}

// ---------- Sending ----------
const sendTimes = new Map<string, number[]>();
function assertSendAllowance(memberId: string) {
  const now = Date.now();
  const recent = (sendTimes.get(memberId) || []).filter(t => now - t < 3600_000);
  if (recent.length >= SENDS_PER_HOUR) throw new UserError(429, 'too-many-emails', 'You have sent a lot of emails in the last hour. Wait a little, then try again.');
  recent.push(now);
  sendTimes.set(memberId, recent);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const bodyHtml = (text: string) =>
  `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#1f2937">${esc(text).replace(/\r?\n/g, '<br>')}</div>`;

function recipientList(v: unknown, what: string): string[] {
  const raw = Array.isArray(v) ? v : String(v || '').split(/[,;\s]+/);
  const out: string[] = [];
  for (const x of raw) {
    if (!String(x || '').trim()) continue;
    const e = cleanEmail(x);
    if (!e) throw new UserError(400, 'bad-email', `"${String(x).slice(0, 80)}" in ${what} isn't a valid email address.`);
    if (!out.includes(e)) out.push(e);
  }
  if (out.length > MAX_RECIPIENTS) throw new UserError(400, 'too-many-recipients', `Keep ${what} to ${MAX_RECIPIENTS} addresses or fewer.`);
  return out;
}

export function canSendQuotation(q: any, caller: { memberId: string; role: string }) {
  if (caller.role !== 'rep') return true;
  const id = caller.memberId;
  return q.ownerId === id || q.creatorId === id || q.taggedRepId === id || (q.sharedWithIds || []).includes(id)
    || (!q.ownerId && !q.creatorId);
}

function explainGraphError(status: number, data: any, from: string): UserError {
  const code = String(data?.error?.code || '');
  const msg = String(data?.error?.message || '');
  console.error('[mail] Graph said', status, code, msg.slice(0, 300));
  if (status === 403 || /AccessDenied|Authorization_RequestDenied/i.test(code)) {
    return new UserError(503, 'outlook-no-permission',
      `Microsoft didn't allow the CRM to send from ${from}. Check that the app has the Mail.Send application permission with admin consent, and, if access is limited to certain mailboxes, that ${from} is included.`);
  }
  if (status === 404 || /ErrorInvalidUser|MailboxNotEnabledForRESTAPI|ResourceNotFound|ErrorItemNotFound/i.test(code)) {
    return new UserError(400, 'outlook-no-mailbox', `Microsoft 365 has no mailbox for ${from}. Ask Management to check your work email in Team.`);
  }
  if (status === 413 || /RequestEntityTooLarge|ErrorMessageSizeExceeded/i.test(code)) {
    return new UserError(400, 'outlook-too-large', 'The email is too large to send. Try again; if it keeps happening, download the PDF and send it from Outlook.');
  }
  if (/ErrorInvalidRecipients/i.test(code)) return new UserError(400, 'outlook-bad-recipient', 'Microsoft rejected one of the email addresses. Check To and CC.');
  return new UserError(502, 'outlook-error', `Outlook didn't send the email (${status}). Try again in a minute.`);
}

// ---------- Routes ----------
export function registerMailRoutes(app: Express) {
  // Is Outlook sending ready, and what's my work email? Management also sees the setup.
  app.post('/api/mail/status', express.json(), route(async req => {
    const caller = await callerFrom(req);
    const { db } = admin();
    const [s, secret, mine] = await Promise.all([readSettings(), readSecret(), db.collection('team_emails').doc(caller.memberId).get()]);
    const configured = !!(s.tenantId && s.clientId && secret);
    return {
      configured,
      myEmail: String(mine.data()?.email || ''),
      ...(caller.role === 'management'
        ? { tenantId: s.tenantId || '', clientId: s.clientId || '', secretSet: !!secret, checkedAt: s.checkedAt || 0, lastError: s.lastError || '' }
        : {}),
    };
  }));

  // Management saves the Microsoft codes; they're tested before they're saved. All blank = disconnect.
  app.post('/api/mail/settings', express.json(), route(async req => {
    await managementFrom(req);
    const { db } = admin();
    const tenantId = String(req.body?.tenantId || '').trim();
    const clientId = String(req.body?.clientId || '').trim();
    const typedSecret = String(req.body?.clientSecret || '').trim();
    if (!tenantId && !clientId && !typedSecret) {
      await Promise.all([
        db.collection('config').doc('outlook').set({ tenantId: '', clientId: '', lastError: '', checkedAt: 0 }, { merge: true }),
        db.collection('server_secrets').doc('outlook').delete(),
      ]);
      cachedToken = null;
      return { configured: false };
    }
    if (!GUID_RE.test(tenantId)) throw new UserError(400, 'outlook-bad-tenant', 'The Tenant ID looks like 8-4-4-4-12 letters and numbers, e.g. 1a2b3c4d-…. Copy "Directory (tenant) ID" from the app\'s Overview page.');
    if (!GUID_RE.test(clientId)) throw new UserError(400, 'outlook-bad-client', 'The Client ID looks like 8-4-4-4-12 letters and numbers. Copy "Application (client) ID" from the app\'s Overview page.');
    const secret = typedSecret || (await readSecret());
    if (!secret) throw new UserError(400, 'outlook-no-secret', 'Paste the client secret Value.');
    if (secret.length > 200 || /\s/.test(secret)) throw new UserError(400, 'outlook-bad-secret', "That doesn't look like a client secret Value.");

    cachedToken = null;
    const token = await graphToken(tenantId, clientId, secret);
    if (!tokenRoles(token).includes('Mail.Send')) {
      throw new UserError(400, 'outlook-no-mail-send',
        'The codes work, but the app doesn\'t have permission to send email yet. In the app, open API permissions → Add a permission → Microsoft Graph → Application permissions → Mail.Send, then click "Grant admin consent". Wait a minute and try again.');
    }
    await Promise.all([
      db.collection('config').doc('outlook').set({ tenantId, clientId, checkedAt: Date.now(), lastError: '' }, { merge: true }),
      db.collection('server_secrets').doc('outlook').set({ clientSecret: secret, updatedAt: Date.now() }),
    ]);
    return { configured: true };
  }));

  // Management: set (or clear) a team member's work email, used as the "From" address.
  app.post('/api/team/email', express.json(), route(async req => {
    const caller = await managementFrom(req);
    const { db } = admin();
    const memberId = String(req.body?.memberId || '');
    if (!memberId || !(await db.collection('team').doc(memberId).get()).exists) throw new UserError(404, 'member-not-found', 'That person is not on the team list.');
    const typed = String(req.body?.email || '').trim();
    const email = cleanEmail(typed);
    if (typed && !email) throw new UserError(400, 'bad-email', "That isn't a valid email address.");
    if (email) {
      const clash = await db.collection('team_emails').where('email', '==', email).get();
      if (clash.docs.some(d => d.id !== memberId)) throw new UserError(409, 'email-taken', 'Someone else on the team already has that work email.');
      await db.collection('team_emails').doc(memberId).set({ email, updatedAt: Date.now(), updatedById: caller.memberId });
    } else {
      await db.collection('team_emails').doc(memberId).delete();
    }
    return { email };
  }));

  // Send a quotation or course outline from my own Outlook mailbox, with its PDF attached.
  app.post('/api/mail/send', express.json({ limit: '6mb' }), route(async req => {
    const caller = await callerFrom(req);
    const { db } = admin();
    const [mine, member] = await Promise.all([db.collection('team_emails').doc(caller.memberId).get(), db.collection('team').doc(caller.memberId).get()]);
    const from = cleanEmail(mine.data()?.email);
    if (!from) throw new UserError(400, 'no-work-email', "Your work email isn't in the CRM yet. Ask Management to add it in Team.");

    // A quotation, or (2026-10-19) a course outline or teambuilding proposal sent as the proposal. Same people may send any.
    const outlineId = String(req.body?.outlineId || '');
    const tbId = String(req.body?.tbProposalId || '');
    const docId = outlineId || tbId || String(req.body?.quotationId || '');
    const noun = outlineId ? 'course outline' : tbId ? 'teambuilding proposal' : 'quotation';
    const coll = outlineId ? 'course_outlines' : tbId ? 'teambuilding_proposals' : 'quotations';
    const code = outlineId ? 'outline' : tbId ? 'proposal' : 'quotation';
    const qSnap = docId ? await db.collection(coll).doc(docId).get() : null;
    if (!qSnap?.exists) throw new UserError(404, `${code}-not-found`, `Save the ${noun} first, then send it.`);
    if (!canSendQuotation(qSnap.data(), caller)) throw new UserError(403, `not-your-${code}`, `You can only send ${noun}s you own or that are shared with you.`);

    const to = recipientList(req.body?.to, 'To');
    const cc = recipientList(req.body?.cc, 'CC');
    if (!to.length) throw new UserError(400, 'no-recipient', 'Add at least one email address in To.');
    const subject = String(req.body?.subject || '').trim().slice(0, 250);
    if (!subject) throw new UserError(400, 'no-subject', 'Add a subject.');
    const text = String(req.body?.body || '').slice(0, 20000);
    const fileName = (String(req.body?.fileName || 'Quotation.pdf').replace(/[\\/:*?"<>|\r\n]+/g, '-').slice(0, 150) || 'Quotation.pdf').replace(/(\.pdf)?$/i, '.pdf');
    const pdf = String(req.body?.pdfBase64 || '');
    const bytes = Math.floor((pdf.length * 3) / 4);
    if (!pdf || !/^[A-Za-z0-9+/=]+$/.test(pdf) || !Buffer.from(pdf.slice(0, 8), 'base64').toString('latin1').startsWith('%PDF')) {
      throw new UserError(400, 'no-pdf', `The ${noun} PDF is missing. Try again.`);
    }
    if (bytes > MAX_PDF_BYTES) throw new UserError(400, 'pdf-too-large', 'The PDF is too large to email. Download it and send it from Outlook instead.');

    assertSendAllowance(caller.memberId);
    const token = await readyToken();
    let res: Response;
    try {
      res = await fetch(`${GRAPH}/users/${encodeURIComponent(from)}/sendMail`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            subject,
            body: { contentType: 'HTML', content: bodyHtml(text) },
            toRecipients: to.map(address => ({ emailAddress: { address } })),
            ccRecipients: cc.map(address => ({ emailAddress: { address } })),
            attachments: [{ '@odata.type': '#microsoft.graph.fileAttachment', name: fileName, contentType: 'application/pdf', contentBytes: pdf }],
          },
          saveToSentItems: true,
        }),
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new UserError(503, 'outlook-unreachable', "The CRM couldn't reach Microsoft. The email was not sent. Try again in a minute.");
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const err = explainGraphError(res.status, data, from);
      await db.collection('config').doc('outlook').set({ lastError: `${new Date().toISOString()} ${err.message}` }, { merge: true }).catch(() => {});
      throw err;
    }
    await db.collection('config').doc('outlook').set({ lastSentAt: Date.now(), lastError: '' }, { merge: true }).catch(() => {});
    return { from, to, cc, byName: String(member.data()?.name || '') };
  }));
}
