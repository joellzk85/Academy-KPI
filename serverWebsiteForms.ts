// Website forms (Batch 3, Joel 2026-10-30; docs/features/website.md): "Talk to us" and Register on a calendar date.
// Plain web forms (they work without JavaScript). The server checks them, keeps out robots without any puzzle (a hidden
// box people never fill in, a signed time stamp: sent too fast or too late is refused, and a few per hour per visitor),
// gives each one to the next rep in turn and saves it in site_enquiries. Nothing else from the CRM is touched: seats
// are held only once the rep makes the deal.
import type { Express, Request, Response } from 'express';
import express from 'express';
import crypto from 'crypto';
import { admin } from './serverAuth';
import { siteSnapshot } from './serverWebsite';
import { ENQUIRIES, ROTATION_DOC, checkForm, nextInTurn } from './src/lib/websiteEnquiries';

let key: Buffer | null = null;
/** The key that signs each form's time stamp (kept in server_secrets, so every server agrees). */
async function formKey(): Promise<Buffer> {
  if (key) return key;
  const { db } = admin();
  const ref = db.collection('server_secrets').doc('site_forms');
  const k = await db.runTransaction(async tx => {
    const s = await tx.get(ref);
    const have = String(s.data()?.key || '');
    if (have) return have;
    const fresh = crypto.randomBytes(32).toString('hex');
    tx.set(ref, { key: fresh, createdAt: Date.now() });
    return fresh;
  });
  key = Buffer.from(k, 'hex');
  return key;
}

/** A signed time stamp put in every form when the page is made. */
export async function formStamp(): Promise<string> {
  const t = String(Date.now());
  return `${t}.${crypto.createHmac('sha256', await formKey()).update(t).digest('hex').slice(0, 32)}`;
}

async function stampOk(stamp: string): Promise<boolean> {
  const [t, sig] = String(stamp || '').split('.');
  if (!t || !sig) return false;
  const want = crypto.createHmac('sha256', await formKey()).update(t).digest('hex').slice(0, 32);
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return false;
  const age = Date.now() - Number(t);
  return age > 3_000 && age < 2 * 24 * 3600e3;   // a person takes a few seconds; a page left open two days is stale
}

const recent = new Map<string, number[]>();
function tooMany(ip: string): boolean {
  const now = Date.now();
  const list = (recent.get(ip) || []).filter(t => now - t < 3600e3);
  list.push(now);
  recent.set(ip, list);
  if (recent.size > 5000) recent.clear();
  return list.length > 6;
}

const baseOf = (b: unknown) => (b === '/site' ? '/site' : '');

export function registerWebsiteFormRoutes(app: Express) {
  app.post('/api/site/enquiry', express.urlencoded({ extended: false, limit: '20kb' }), async (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, any>;
    const base = baseOf(body.base);
    const back = /^\/[^/]/.test(String(body.page || '')) ? String(body.page).slice(0, 200) : '';
    const problem = (e: string) => res.redirect(303, `${base}/form-problem?e=${encodeURIComponent(e)}${back ? `&back=${encodeURIComponent(back)}` : ''}`);
    try {
      // Robots: the hidden "website" box is filled, or the form came back too fast / too late. Treated as sent.
      if (String(body.website || '').trim()) return res.redirect(303, `${base}/thank-you`);
      if (!(await stampOk(body.stamp))) return problem('Please fill in the form again and send it.');
      const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      if (tooMany(ip)) return problem("We've received several forms from you already. We'll be in touch soon, or WhatsApp us.");
      const checked = checkForm(body);
      if (checked.ok === false) return problem(checked.error);
      const f = checked.form;

      const snap = await siteSnapshot();
      const run = f.runId ? snap.data.runs.find(r => r.id === f.runId) : undefined;
      if (f.kind === 'register' && !run) return problem('That training date is no longer open. Please pick another date.');
      const prog = snap.data.programmes.find(p => p.name === f.programme || (run && p.slug === run.titleSlug));

      const { db } = admin();
      const reps = (await db.collection('team').where('active', '==', true).where('role', '==', 'rep').get()).docs.map(d => ({ id: d.id, name: String(d.data().name || '') }));
      const rotRef = db.collection('config').doc(ROTATION_DOC);
      const ref = db.collection(ENQUIRIES).doc();
      await db.runTransaction(async tx => {
        const rot = await tx.get(rotRef);
        const rep = nextInTurn(reps, String(rot.data()?.lastId || ''));
        tx.set(ref, {
          ...f,
          programme: f.programme || run?.title || '',
          programmeId: prog?.id || '',
          runTitle: run?.title || '',
          runDate: run?.date || '',
          at: new Date().toISOString(),
          assignedTo: rep?.id || '',
          assignedName: rep?.name || '',
          status: 'new',
        });
        if (rep) tx.set(rotRef, { lastId: rep.id, at: Date.now() });
      });
      res.redirect(303, `${base}/thank-you?k=${f.kind}`);
    } catch (err) {
      console.error('Website form could not be saved', err);
      problem('Sorry, something went wrong on our side. Please try again, or WhatsApp us.');
    }
  });
}
