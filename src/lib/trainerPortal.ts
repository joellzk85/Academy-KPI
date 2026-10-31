// Trainer portal (Joel, 2026-10-21): trainers with portal access log in with their email and password at /trainer.
// Not every trainer gets access; profile and outline links (trainerLinks.ts) keep working for everyone.
// Shared by the server (serverTrainerPortal.ts), the portal page (TrainerPortal.tsx) and the CRM screens. Pure, so it can be tested.
//
// Logins: a Firebase Authentication email + password user whose id is "tr_<trainerId>". It has no auth_map record,
// so the database rules give it nothing: the portal talks only to the server's /api/portal/* routes.
// Forgot password and the first "set your password" email are Firebase's own reset emails.
//
// trainer_accounts/{trainerId}: { trainerId, email, active, createdAt, createdByName, updatedAt, lastSeenAt?, history[] }
//   written only by the server; members read it (Trainers shows who has access).
// trainer_jobs/{dealId}_{trainerId}: one per trainer per training.
//   rating { stars, note, byId, byName, at }      Admin and Management, on the deal's Trainer step; everyone sees it
//   poAcceptedAt                                    the trainer clicked Accept on the PO in the portal
//   po                                              the made-automatically PO as accepted (buildPo), so it doesn't change
//   poDeclined { reason, at }                       the trainer declined the PO (red flag in Admin work)
// trainer_calendars/{token}: { trainerId, at }: the trainer's private calendar link (server only).
//   claim { status, photos[], t3[], submittedAt, returnNote?, returnedByName?, history[] }   "Request training fee"
//   feeChecks { t3?, photos?, report? }: { byId, byName, at }   Admin ticked it by hand before the fee is approved
// trainer_bank_requests/{trainerId}: a bank account change typed by the trainer, waiting for Admin or Management.
//   Accepting copies it onto the trainer's vendor record (Admin work → Vendors), where payments read it.
// Storage: trainer_portal/{trainerId}/{kind}_{time}_{name} (profile files) and
//   trainer_portal/{trainerId}/claims/{dealId}/{photo|t3}_{time}_{name} (storage.rules).

export const PORTAL_PATH = '/trainer';
export const portalUid = (trainerId: string) => `tr_${trainerId}`;
export const trainerIdFromUid = (uid: string) => (uid.startsWith('tr_') ? uid.slice(3) : '');
export const jobId = (dealId: string, trainerId: string) => `${dealId}_${trainerId}`;
// Internal trainers (Joel, 2026-10-25): a trainer record Management linked to a team member in Team
// (trainers_directory.memberId). They use the trainer screens inside the CRM: no PO, no fee, and only they write
// their training report (Admin and Management upload photos and T3 and check the report, but never write it).
export const isInternalTrainer = (t: { memberId?: string } | null | undefined) => !!t?.memberId;
export const portalFolder = (trainerId: string) => `trainer_portal/${trainerId}/`;
export const claimFolder = (trainerId: string, dealId: string) => `trainer_portal/${trainerId}/claims/${dealId}/`;

export interface PortalFile { name: string; size: number; type: string; path: string; url: string; at: number }

export interface TrainerRating { stars: number; note: string; byId: string; byName: string; at: string }

export type ClaimStatus = 'submitted' | 'returned';
export interface TrainerClaim {
  status: ClaimStatus;
  photos: PortalFile[];
  t3: PortalFile[];
  submittedAt: string;
  returnNote?: string;
  returnedByName?: string;
  returnedAt?: string;
  history?: { at: string; byName: string; action: string }[];
  internal?: boolean;          // sent by an internal trainer: photos and T3 only, no fee (2026-10-25)
}

export interface TrainerJob {
  id: string;
  dealId: string;
  trainerId: string;
  rating?: TrainerRating | null;
  poAcceptedAt?: string;
  po?: PoInput | null;                              // the made-automatically PO as the trainer accepted it
  poDeclined?: { reason: string; at: string } | null;
  claim?: TrainerClaim | null;
  feeChecks?: Partial<Record<'t3' | 'photos' | 'report', { byId: string; byName: string; at: string }>>;  // ticked by Admin (lib/feeChecks.ts)
}

export interface TrainerAccount {
  id: string;
  trainerId: string;
  email: string;
  active: boolean;
  createdAt?: string;
  createdByName?: string;
  updatedAt?: string;
  lastSeenAt?: string;
}

export interface BankRequest {
  id: string;
  trainerId: string;
  trainerName: string;
  bankName: string;
  accountNo: string;
  accountName: string;
  status: 'pending' | 'accepted' | 'rejected';
  at: string;
  decidedByName?: string;
  decidedAt?: string;
  rejectReason?: string;
}

// ---------- Invite links (2026-10-21; Joel: "send invite via link") ----------
// portal_invites/{token}: made by Admin or Management (Trainers → Invite to trainer portal), for a trainer on the
// list (trainerId) or a new person (name only). The trainer opens /trainer/join/<token>, types their email and
// chooses a password, and is logged in. A new person is added to Trainers then. One use, 14 days.
export const INVITE_DAYS = 14;
export const MIN_PORTAL_PASSWORD = 8;
export const invitePath = (token: string) => `${PORTAL_PATH}/join/${token}`;
export interface PortalInvite {
  id: string;
  token: string;
  status: 'open' | 'used' | 'cancelled';
  trainerId?: string;
  name: string;
  phone?: string;
  createdAt: number;
  expiresAt: number;
  createdById: string;
  createdByName: string;
  usedAt?: string;
  usedTrainerId?: string;
  usedEmail?: string;
}
export const inviteLive = (i: { status?: string; expiresAt?: number }, now = Date.now()) => i.status === 'open' && !!i.expiresAt && now <= i.expiresAt;
export const passwordProblem = (p: string) =>
  typeof p !== 'string' || p.length < MIN_PORTAL_PASSWORD ? `Choose a password of at least ${MIN_PORTAL_PASSWORD} characters.` : p.length > 100 ? 'That password is too long.' : '';

// ---------- Cleaning what a trainer sends (the server keeps only this) ----------
const str = (v: any, max: number) => String(v ?? '').replace(/\u0000/g, '').trim().slice(0, max);

export const cleanEmail = (v: any) => str(v, 120).toLowerCase();
export const emailProblem = (e: string) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? '' : "That email address doesn't look right.");

export function cleanBank(d: any) {
  return {
    bankName: str(d?.bankName, 80),
    accountNo: str(d?.accountNo, 40).replace(/[^0-9 -]/g, '').trim(),
    accountName: str(d?.accountName, 120),
  };
}
export function bankProblem(b: { bankName: string; accountNo: string; accountName: string }): string {
  if (!b.bankName) return 'Enter the bank name.';
  if (b.accountNo.replace(/\D/g, '').length < 6) return 'Enter the full account number.';
  if (!b.accountName) return 'Enter the name on the account.';
  return '';
}
export const sameBank = (a: any, b: any) =>
  ['bankName', 'accountNo', 'accountName'].every(k => String(a?.[k] || '').replace(/\s+/g, ' ').trim().toLowerCase() === String(b?.[k] || '').replace(/\s+/g, ' ').trim().toLowerCase());

// Tax identification number (LHDN TIN, e.g. IG12345678090): letters and numbers only.
export const cleanTin = (v: any) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);

const FIREBASE_FILE = /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/[^/]+\/o\/([^?]+)\?alt=media&token=[A-Za-z0-9-]+$/;
// Files from storage, kept only when inside `prefix` (the trainer's own claim folder for that training).
export function cleanFiles(list: any, prefix: string, most = 30): PortalFile[] {
  return (Array.isArray(list) ? list : []).slice(0, most).map((f: any) => {
    const url = str(f?.url, 2000);
    const path = str(f?.path, 300);
    const m = url.match(FIREBASE_FILE);
    if (!m || decodeURIComponent(m[1]) !== path || !path.startsWith(prefix)) return null;
    return { name: str(f?.name, 200) || 'file', size: Math.max(0, Number(f?.size) || 0), type: str(f?.type, 120), path, url, at: Number(f?.at) || Date.now() };
  }).filter(Boolean) as PortalFile[];
}

// Photos and the T3 are optional (Joel, 2026-10-21): a fee request can be sent with or without them.
export function claimProblem(_photos: PortalFile[], _t3: PortalFile[]): string {
  return '';
}

// The name to greet a trainer by: their first name, skipping titles (full deal test, 2026-10-23: "Hi Dr").
const TITLES = new Set(['dr', 'mr', 'mrs', 'ms', 'mdm', 'madam', 'miss', 'puan', 'pn', 'encik', 'en', 'cik', 'tuan', 'dato', "dato'", 'datuk', 'datin', 'tan', 'sri', 'prof', 'ir', 'ts', 'sir', 'haji', 'hj', 'hajah', 'hjh', 'ustaz', 'ustazah']);
export function greetName(name: unknown): string {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  return words.find(w => !TITLES.has(w.toLowerCase().replace(/\.$/, ''))) || words[0] || '';
}

/** "2 photos, T3" / "no files": what came with a fee request (deal History, the portal). */
export function claimFilesText(photos: unknown[] = [], t3: unknown[] = []): string {
  const parts = [photos.length ? `${photos.length} photo${photos.length === 1 ? '' : 's'}` : '', t3.length ? 'T3' : ''].filter(Boolean);
  return parts.length ? parts.join(', ') : 'no files';
}

// ---------- The trainer's PO (TrainerPoDocument.tsx) ----------
// The same number every time for a training: PO-<training year+month>-<last 5 of the deal id>.
export const poNumber = (deal: { id: string; trainingDate?: string }) =>
  `PO-${(/^\d{4}-\d{2}/.test(deal.trainingDate || '') ? deal.trainingDate!.slice(0, 7) : new Date().toISOString().slice(0, 7)).replace('-', '')}-${String(deal.id).slice(-5).toUpperCase()}`;
// Its lines: the fee lines on the deal's Trainer step (not rejected).
// A trainer fee is agreed by a manager before the PO goes out (Joel, 2026-10-23): a line marked feeAgreeNeeded counts
// only once feeAgreed is there for its current amount. Approved or paid lines, and older lines without the mark, count.
export function feeIsAgreed(o: { status?: string; amount?: number; feeAgreeNeeded?: boolean; feeAgreed?: { amount?: number } | null }): boolean {
  if (!o.feeAgreeNeeded || o.status === 'approved' || o.status === 'paid') return true;
  return !!o.feeAgreed && Math.abs(Number(o.feeAgreed.amount) - Number(o.amount)) < 0.005;
}

// Mileage claim on the Trainer step (Joel, 2026-10-31): optional, km × RM per km or a fixed amount, on the PO or not.
// A line with onPo false is still paid and in the P&L, but never on the PO.
export const onPo = (o: { onPo?: boolean }) => o.onPo !== false;
export const mileageText = (km: number, rate: number) => `Mileage claim: ${km} km × RM ${rate.toFixed(2)}`;
/** The km and rate back from a "Mileage claim: 240 km × RM 0.60" description (to fix a rejected claim). */
export function mileageFrom(description = ''): { km: string; rate: string } {
  const m = /([\d.]+)\s*km\s*×\s*RM\s*([\d.]+)/.exec(description);
  return m ? { km: m[1], rate: m[2] } : { km: '', rate: '' };
}
export const mileageAmount = (km: number, rate: number) => Math.round(km * rate * 100) / 100;

// A fee paid in parts (2026-10-26) lists each part with its label, e.g. "Trainer fee · Deposit 50%".
export const poLines = (outs: { dealId?: string; checklistTaskId?: string; status?: string; description?: string; amount?: number; feeAgreeNeeded?: boolean; feeAgreed?: any; partGroup?: string; partLabel?: string; onPo?: boolean }[], dealId: string, taskId: string) =>
  outs.filter(o => o.dealId === dealId && o.checklistTaskId === taskId && o.status !== 'rejected' && feeIsAgreed(o) && onPo(o))
    .map(o => ({ description: [String(o.description || '').trim() || 'Trainer fee', o.partGroup ? o.partLabel || '' : ''].filter(Boolean).join(' · '), amount: Number(o.amount) || 0 }));

export interface PoInput {
  number: string;
  date: string;
  trainer: { name: string; contact?: string; email?: string; address?: string };
  programme: string;
  client: string;
  dates: string;
  venue: string;
  lines: { description: string; amount: number }[];
  bank: string;
}
// The PO, made automatically (Joel, 2026-10-21: "PO for trainer should auto generate"): a won deal with the trainer
// picked from the list on the Trainer step and at least one fee line has its PO, with nothing to click. The portal
// shows it (as a PDF); when the trainer accepts, the server keeps a copy on trainer_jobs.po so it doesn't change.
// "Make PO" on the Trainer step still saves a PDF copy there, e.g. to WhatsApp a trainer without portal access.
export function buildPo(i: {
  deal: { id: string; trainingDate?: string; courseName?: string }; dates: string; date: string; trainer: any; client: string; venue: string;
  lines: { description: string; amount: number }[]; vendor: any | null;
}): PoInput {
  return {
    number: poNumber(i.deal), date: i.date,
    trainer: { name: i.trainer?.name || '', contact: i.trainer?.contact || '', email: i.trainer?.email || '', address: i.trainer?.address || '' },
    programme: i.deal.courseName || '', client: i.client, dates: i.dates, venue: i.venue, lines: i.lines,
    bank: i.vendor ? [i.vendor.bankName, i.vendor.accountNo, i.vendor.accountName].filter(Boolean).join(' · ') : '',
  };
}
// A Trainer step with the trainer picked from the list and a fee line has its PO (so the step can be ticked).
export const hasAutoPo = (task: { id: string; trainerId?: string } | undefined, outs: any[], dealId: string) =>
  !!task?.trainerId && poLines(outs, dealId, task.id).length > 0;

// The trainer declined the PO in the portal: a red flag in Admin work until another trainer is picked, or Admin
// clears it on the Trainer step (they agreed after all).
export function poDeclinedFlag(job: TrainerJob | undefined, trainerName = 'The trainer'): string {
  return job?.poDeclined ? `${trainerName} declined the PO${job.poDeclined.reason ? ` ("${job.poDeclined.reason}")` : ''}: pick another trainer on the Trainer step` : '';
}

// ---------- Blocked dates and the trainer's own calendar (2026-10-21) ----------
// A trainer's dates are blocked by every won deal with them picked on the Trainer step, unless they declined the PO.
// The portal shows them in My calendar, and the CRM warns when a trainer is picked for dates already blocked.
export interface Booking { dealId: string; start: string; end: string; title: string }
export const overlaps = (a: { start: string; end?: string }, b: { start: string; end?: string }) =>
  !!a.start && !!b.start && a.start <= (b.end || b.start) && b.start <= (a.end || a.start);
export const clashesWith = <B extends Booking>(bookings: B[], mine: { dealId: string; start: string; end?: string }) =>
  bookings.filter(b => b.dealId !== mine.dealId && overlaps(b, mine));

// "Link to my calendar": a private address (trainer_calendars/{token}, server only) that Google, Outlook or Apple
// calendar reads every few hours. Making a new link stops the old one.
export const calendarPath = (token: string) => `/api/portal/calendar/${token}.ics`;
export interface IcsEvent { uid: string; start: string; end: string; summary: string; location?: string; description?: string }
const icsText = (s: string) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsDay = (iso: string) => iso.replace(/-/g, '');
const nextDay = (iso: string) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
// Lines longer than 75 characters are folded (a new line starting with a space), as calendars expect.
const fold = (line: string) => line.length <= 74 ? line : line.match(/.{1,73}/g)!.join('\r\n ');
export function icsCalendar(name: string, events: IcsEvent[], stamp = new Date()): string {
  const ts = stamp.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//NEXT Academy//Trainer portal//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(name)}`, 'X-WR-TIMEZONE:Asia/Kuala_Lumpur', 'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H',
  ];
  for (const e of events) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.start)) continue;
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${ts}`, `DTSTART;VALUE=DATE:${icsDay(e.start)}`, `DTEND;VALUE=DATE:${icsDay(nextDay(e.end && e.end >= e.start ? e.end : e.start))}`,
      `SUMMARY:${icsText(e.summary)}`, ...(e.location ? [`LOCATION:${icsText(e.location)}`] : []), ...(e.description ? [`DESCRIPTION:${icsText(e.description)}`] : []),
      'TRANSP:OPAQUE', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
// Buttons in the portal: Google and Outlook subscribe from the web address; Apple (iPhone, Mac) opens webcal://.
export function calendarLinks(httpsUrl: string) {
  const webcal = httpsUrl.replace(/^https?:\/\//, 'webcal://');
  return {
    google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`,
    outlook: `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(httpsUrl)}&name=${encodeURIComponent('NEXT Academy trainings')}`,
    apple: webcal,
  };
}

// ---------- Ratings ----------
export const STARS = [1, 2, 3, 4, 5];
export const STAR_WORDS = ['', 'Poor', 'Below expectations', 'Good', 'Very good', 'Excellent'];
export function ratingAverage(jobs: { rating?: TrainerRating | null }[]): { avg: number; count: number } {
  const r = jobs.map(j => Number(j.rating?.stars) || 0).filter(n => n >= 1 && n <= 5);
  return { avg: r.length ? Math.round((r.reduce((a, b) => a + b, 0) / r.length) * 10) / 10 : 0, count: r.length };
}

// ---------- The trainer's fee (cost lines on the deal's Trainer step, raised by Admin; money_out) ----------
export function feeStatusText(o: { status?: string; paidDate?: string }): string {
  if (o.status === 'paid') return o.paidDate ? `Paid on ${o.paidDate}` : 'Paid';
  if (o.status === 'approved') return 'Approved, payment being arranged';
  if (o.status === 'rejected') return 'Not approved';
  return 'Waiting for approval';
}

// The red flag in Admin work: a trainer asked for their fee. Gone once every fee line is approved or paid.
export function claimFlag(job: TrainerJob | undefined, feeLines: { status?: string }[], trainerName = 'The trainer'): string {
  if (job?.claim?.status !== 'submitted' || job.claim.internal) return '';   // an internal trainer's photos and T3: no fee
  const live = feeLines.filter(o => o.status !== 'rejected');
  if (!live.length) return `${trainerName} asked for their fee, but there's no trainer fee line yet: add it on the Trainer step`;
  if (live.every(o => o.status === 'approved' || o.status === 'paid')) return '';
  return `${trainerName} asked for their fee: check the T3, training photos and training report, then approve`;
}
