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
//   claim { status, photos[], t3[], submittedAt, returnNote?, returnedByName?, history[] }   "Request training fee"
// trainer_bank_requests/{trainerId}: a bank account change typed by the trainer, waiting for Admin or Management.
//   Accepting copies it onto the trainer's vendor record (Admin work → Vendors), where payments read it.
// Storage: trainer_portal/{trainerId}/{kind}_{time}_{name} (profile files) and
//   trainer_portal/{trainerId}/claims/{dealId}/{photo|t3}_{time}_{name} (storage.rules).

export const PORTAL_PATH = '/trainer';
export const portalUid = (trainerId: string) => `tr_${trainerId}`;
export const trainerIdFromUid = (uid: string) => (uid.startsWith('tr_') ? uid.slice(3) : '');
export const jobId = (dealId: string, trainerId: string) => `${dealId}_${trainerId}`;
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
}

export interface TrainerJob {
  id: string;
  dealId: string;
  trainerId: string;
  rating?: TrainerRating | null;
  poAcceptedAt?: string;
  claim?: TrainerClaim | null;
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

export function claimProblem(photos: PortalFile[], t3: PortalFile[]): string {
  if (!photos.length) return 'Add at least one training photo.';
  if (!t3.length) return 'Add the T3 attendance form.';
  return '';
}

// ---------- The trainer's PO (TrainerPoDocument.tsx) ----------
// The same number every time for a training: PO-<training year+month>-<last 5 of the deal id>.
export const poNumber = (deal: { id: string; trainingDate?: string }) =>
  `PO-${(/^\d{4}-\d{2}/.test(deal.trainingDate || '') ? deal.trainingDate!.slice(0, 7) : new Date().toISOString().slice(0, 7)).replace('-', '')}-${String(deal.id).slice(-5).toUpperCase()}`;
// Its lines: the fee lines on the deal's Trainer step (not rejected).
export const poLines = (outs: { dealId?: string; checklistTaskId?: string; status?: string; description?: string; amount?: number }[], dealId: string, taskId: string) =>
  outs.filter(o => o.dealId === dealId && o.checklistTaskId === taskId && o.status !== 'rejected')
    .map(o => ({ description: String(o.description || '').trim() || 'Trainer fee', amount: Number(o.amount) || 0 }));

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
  if (job?.claim?.status !== 'submitted') return '';
  const live = feeLines.filter(o => o.status !== 'rejected');
  if (!live.length) return `${trainerName} asked for their fee, but there's no trainer fee line yet: add it on the Trainer step`;
  if (live.every(o => o.status === 'approved' || o.status === 'paid')) return '';
  return `${trainerName} asked for their fee: check the photos and T3, then approve`;
}
