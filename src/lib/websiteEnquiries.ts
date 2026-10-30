// Website enquiries and registrations (Batch 3, Joel 2026-10-30; docs/features/website.md).
// A visitor fills in "Talk to us" or Register on a calendar date. The server (serverWebsiteForms.ts) checks it, gives
// it to the next rep in turn and saves it in site_enquiries/{id}. The rep sees it on My home and either makes it a
// deal (marked "Came from: Website"), logs it as only a question, or closes it as not real. Seats on a run are held
// only once the rep makes the deal (Joel). Shared by the server and the CRM screens; nothing here touches the database.

export const ENQUIRIES = 'site_enquiries';
export const ROTATION_DOC = 'site_rotation';     // config/site_rotation: who got the last one (server only)

export type EnquiryKind = 'enquiry' | 'register';
export type EnquiryStatus = 'new' | 'deal' | 'question' | 'not_real';
export type HrdcAnswer = 'yes' | 'no' | 'not_sure';

export type SiteEnquiry = {
  id: string;
  kind: EnquiryKind;
  company: string;
  name: string;
  mobile: string;
  email: string;
  message: string;
  programme: string;          // the programme they asked about (name), or ''
  programmeId: string;        // the title's id when picked from the list
  runId: string;              // Register: the public programme run
  runTitle: string;
  runDate: string;            // YYYY-MM-DD
  pax: number;                // Register: how many people
  hrdc: HrdcAnswer | '';      // Register: HRD Corp claimable?
  consent: boolean;           // PDPA notice accepted
  page: string;               // the website page it was sent from
  at: string;                 // ISO time
  assignedTo: string;         // team member id (reps take turns)
  assignedName: string;
  status: EnquiryStatus;
  note?: string;              // why it was closed, or the question's answer
  dealId?: string;            // the deal made from it
  handledById?: string;
  handledByName?: string;
  handledAt?: string;
  reassigned?: { at: string; byName: string; from: string; to: string }[];
  came?: { source: string; campaign: string; landing: string };   // where the visitor came from (Batch 4)
};

export const STATUS_LABELS: Record<EnquiryStatus, string> = { new: 'New', deal: 'Made a deal', question: 'Only a question', not_real: 'Not real' };
export const HRDC_ANSWERS: Record<HrdcAnswer, string> = { yes: 'Yes, HRD Corp claimable', no: 'No, we pay directly', not_sure: 'Not sure yet' };

/** How long a new one may wait before Management sees it as not touched (Joel: 24 hours to start). */
export const UNTOUCHED_HOURS = 24;
export const isUntouched = (e: Pick<SiteEnquiry, 'status' | 'at'>, now = Date.now()) =>
  e.status === 'new' && now - new Date(e.at).getTime() > UNTOUCHED_HOURS * 3600e3;

/** The deal source mark (lib/deals): every deal made from a website enquiry. */
export const WEBSITE_SOURCE = 'website';

const clip = (v: unknown, n: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, n);

/** Checks a form sent from the website. Returns the clean fields, or the first problem in plain words. */
export function checkForm(body: Record<string, any>): { ok: true; form: Omit<SiteEnquiry, 'id' | 'at' | 'assignedTo' | 'assignedName' | 'status' | 'runTitle' | 'runDate' | 'programmeId'> } | { ok: false; error: string } {
  const kind: EnquiryKind = body.kind === 'register' ? 'register' : 'enquiry';
  const company = clip(body.company, 120);
  const name = clip(body.name, 80);
  const mobile = clip(body.mobile, 30);
  const email = clip(body.email, 120).toLowerCase();
  const message = String(body.message ?? '').replace(/\r/g, '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ').trim().slice(0, 2000);
  const programme = clip(body.programme, 160);
  const runId = clip(body.runId, 80);
  const pax = Math.round(Number(body.pax) || 0);
  const hrdc = (['yes', 'no', 'not_sure'] as const).includes(body.hrdc) ? body.hrdc as HrdcAnswer : '';
  const consent = body.consent === 'yes' || body.consent === true || body.consent === 'on';
  if (!name) return { ok: false, error: 'Please enter your name.' };
  if (!company) return { ok: false, error: 'Please enter your company name.' };
  if (mobile.replace(/[^0-9]/g, '').length < 9) return { ok: false, error: 'Please enter a mobile number we can call.' };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "That email address doesn't look right." };
  if (kind === 'register' && !runId) return { ok: false, error: 'Please pick a training date.' };
  if (kind === 'register' && !(pax >= 1 && pax <= 200)) return { ok: false, error: 'Please enter how many people will attend.' };
  if (!consent) return { ok: false, error: 'Please tick that we may use your details to reply.' };
  return { ok: true, form: { kind, company, name, mobile, email, message, programme, runId, pax: kind === 'register' ? pax : 0, hrdc: kind === 'register' ? hrdc : '', consent, page: clip(body.page, 200) } };
}

/** The next rep in turn: active reps by name, starting after the one who got the last enquiry. */
export function nextInTurn(reps: { id: string; name: string }[], lastId: string): { id: string; name: string } | null {
  const list = [...reps].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  if (!list.length) return null;
  const i = list.findIndex(r => r.id === lastId);
  return list[(i + 1) % list.length];
}

/** The PDPA notice under every form. */
export const CONSENT_TEXT = 'I agree that Next Academy may use these details to reply to me about training (Personal Data Protection Act 2010).';
