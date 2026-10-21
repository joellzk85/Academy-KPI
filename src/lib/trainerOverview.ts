// Trainers → Overview (Joel, 2026-10-21): everything about trainers at a glance, whose details are incomplete,
// and what needs attention. Admin and Management see it, plus people Management ticks (config/trainer_overview
// allowedIds); those see no money or bank details (the database doesn't give them money_out or vendors anyway).
// Pure, so it can be tested.

import { addDays, dealStage, isDeletedDeal, trainingEndDate } from './deals';
import { isHrdc } from './checklist';
import { PROFILE_PARTS, profileGaps } from './trainerProfile';
import { inviteLive, ratingAverage } from './trainerPortal';
import type { BankRequest, PortalInvite, TrainerAccount, TrainerJob } from './trainerPortal';

export const SOON_DAYS = 14;          // upcoming trainings checked for trainer, PO and bank
export const CLAIM_WAIT_DAYS = 7;     // a fee request waiting longer than this is red
export const LOOK_BACK_DAYS = 90;     // ended trainings checked for a missing fee request / rating

export type PortalState = 'active' | 'off' | 'invited' | 'none';

export interface TrainerRow {
  trainer: any;
  pct: number;
  missing: string[];
  hasBank: boolean | null;          // null = this viewer can't see bank details
  hasTin: boolean | null;
  portal: PortalState;
  lastSeen: string;
  trainingsYear: number;
  upcoming: number;
  nextDate: string;
  avg: number;
  rated: number;
  feesPaidYear: number | null;
}

export interface Attention {
  level: 'danger' | 'attention';
  kind: 'no-trainer' | 'no-po' | 'po-not-accepted' | 'no-bank' | 'no-claim' | 'claim-waiting' | 'bank-check' | 'not-rated' | 'low-rating' | 'programme';
  text: string;
  dealId?: string;
  trainerId?: string;
  when?: string;                   // date it's about, for sorting
}

export interface OverviewInput {
  trainers: any[];
  deals: any[];                    // already linkedOnly
  checklists: Record<string, any>;
  programmes: any[];
  accounts: Record<string, TrainerAccount>;
  invites: PortalInvite[];         // open invites ([] when the viewer can't read them)
  jobs: TrainerJob[];
  poDeals: Set<string>;            // deals whose Trainer step has a PO file
  outs: any[] | null;              // money_out (null: not allowed to see money)
  vendors: any[] | null;           // vendors (null: not allowed)
  bankRequests: BankRequest[] | null;
  dealLabel: (deal: any) => string;
  today: string;
}

const s = (n: number) => (n === 1 ? '' : 's');
const daysBetween = (a: string, b: string) => Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000);
const day = (iso?: string) => (/^\d{4}-\d{2}-\d{2}/.test(iso || '') ? String(iso).slice(0, 10) : '');

// Staff wording for profileGaps (written for the trainer: "your name" → "name").
export const gapText = (g: string) => g.replace(/^your /, '');

// One training per won deal with its checklist Trainer step.
export function trainingsOf(deals: any[], checklists: Record<string, any>) {
  return deals
    .filter(d => dealStage(d) === 'won' && !isDeletedDeal(d))
    .map(d => {
      const task = (checklists[d.id]?.tasks || []).find((t: any) => t.kind === 'trainer');
      return { deal: d, task, trainerId: String(task?.trainerId || ''), named: !!(task?.trainerId || String(task?.trainerName || '').trim()), start: day(d.trainingDate), end: trainingEndDate(d) };
    });
}

export function overview(i: OverviewInput): { rows: TrainerRow[]; attention: Attention[]; programmes: { id: string; name: string; trainers: number; deals: number }[] } {
  const year = i.today.slice(0, 4);
  const trainings = trainingsOf(i.deals, i.checklists);
  const jobOf = (dealId: string, trainerId: string) => i.jobs.find(j => j.dealId === dealId && j.trainerId === trainerId);
  const vendorOf = (trainerId: string) => i.vendors?.find(v => v.trainerId === trainerId);
  const name = (id: string) => String(i.trainers.find(t => t.id === id)?.name || 'The trainer');
  // Fee lines of a training: cost lines on its Trainer step.
  const feeLines = (dealId: string, taskId: string) => (i.outs || []).filter(o => o.dealId === dealId && o.checklistTaskId === taskId && o.status !== 'rejected');

  const rows: TrainerRow[] = i.trainers.map(t => {
    const gaps = profileGaps(t).map(gapText);
    const v = vendorOf(t.id);
    const hasBank = i.vendors ? !!(v && String(v.accountNo || '').trim() && String(v.bankName || '').trim()) : null;
    const hasTin = i.vendors ? !!String(v?.tin || '').trim() : null;
    const missing = [...gaps, ...(hasBank === false ? ['bank details'] : []), ...(hasTin === false ? ['TIN'] : [])];
    const acc = i.accounts[t.id];
    const portal: PortalState = acc?.active ? 'active' : i.invites.some(x => x.trainerId === t.id && inviteLive(x)) ? 'invited' : acc ? 'off' : 'none';
    const mine = trainings.filter(x => x.trainerId === t.id);
    const upcoming = mine.filter(x => x.start && (x.end || x.start) >= i.today).sort((a, b) => a.start.localeCompare(b.start));
    const r = ratingAverage(i.jobs.filter(j => j.trainerId === t.id));
    const paid = i.outs ? mine.reduce((sum, x) => sum + feeLines(x.deal.id, x.task?.id).filter(o => o.status === 'paid' && day(o.paidDate || o.paidAt).startsWith(year)).reduce((a, o) => a + (Number(o.amount) || 0), 0), 0) : null;
    return {
      trainer: t,
      pct: Math.round(((PROFILE_PARTS - gaps.length) / PROFILE_PARTS) * 100),
      missing, hasBank, hasTin, portal, lastSeen: acc?.lastSeenAt || '',
      trainingsYear: mine.filter(x => x.start.startsWith(year)).length,
      upcoming: upcoming.length, nextDate: upcoming[0]?.start || '',
      avg: r.avg, rated: r.count, feesPaidYear: paid,
    };
  });

  const att: Attention[] = [];
  const soon = addDays(i.today, SOON_DAYS);
  for (const x of trainings) {
    if (!x.start) continue;
    const label = i.dealLabel(x.deal);
    const left = daysBetween(i.today, x.start);
    const when = left === 0 ? 'today' : left === 1 ? 'tomorrow' : `in ${left} days`;
    // Coming up: trainer, PO, PO accepted, bank.
    if (x.start >= i.today && x.start <= soon) {
      if (!x.named) { att.push({ level: 'danger', kind: 'no-trainer', text: `No trainer confirmed: ${label} (${when})`, dealId: x.deal.id, when: x.start }); continue; }
      if (!i.poDeals.has(x.deal.id)) att.push({ level: left <= 7 ? 'danger' : 'attention', kind: 'no-po', text: `No trainer PO uploaded: ${label} (${when})`, dealId: x.deal.id, trainerId: x.trainerId, when: x.start });
      else if (x.trainerId && i.accounts[x.trainerId]?.active && !jobOf(x.deal.id, x.trainerId)?.poAcceptedAt) att.push({ level: 'attention', kind: 'po-not-accepted', text: `${name(x.trainerId)} hasn't accepted the PO yet: ${label} (${when})`, dealId: x.deal.id, trainerId: x.trainerId, when: x.start });
      if (x.trainerId && i.vendors && !rows.find(r => r.trainer.id === x.trainerId)?.hasBank) att.push({ level: 'attention', kind: 'no-bank', text: `${name(x.trainerId)} has no bank details on record, training ${when}`, trainerId: x.trainerId, when: x.start });
    }
    // Over: the trainer's photos and T3 (needed for the HRDC claim), and the rating.
    const ended = x.end && x.end < i.today ? daysBetween(x.end, i.today) : -1;
    if (ended > 0 && ended <= LOOK_BACK_DAYS && x.trainerId) {
      const job = jobOf(x.deal.id, x.trainerId);
      const lines = feeLines(x.deal.id, x.task?.id);
      const allPaid = lines.length > 0 && lines.every(o => o.status === 'paid');
      if (i.accounts[x.trainerId]?.active && !job?.claim && !allPaid) {
        att.push({ level: isHrdc(x.deal.fundingType) ? 'danger' : 'attention', kind: 'no-claim', text: `${name(x.trainerId)} hasn't sent photos and T3 yet (training ended ${ended} day${s(ended)} ago${isHrdc(x.deal.fundingType) ? ', needed for the HRDC claim' : ''}): ${label}`, dealId: x.deal.id, trainerId: x.trainerId, when: x.end });
      }
      if (job?.claim?.status === 'submitted' && i.outs) {
        const waiting = daysBetween(day(job.claim.submittedAt), i.today);
        const open = !lines.length || lines.some(o => o.status === 'pending');
        if (open && waiting > CLAIM_WAIT_DAYS) att.push({ level: 'danger', kind: 'claim-waiting', text: `${name(x.trainerId)}'s fee request has waited ${waiting} days: ${label}`, dealId: x.deal.id, trainerId: x.trainerId, when: day(job.claim.submittedAt) });
      }
      if (!job?.rating) att.push({ level: 'attention', kind: 'not-rated', text: `Not rated yet: ${name(x.trainerId)}, ${label}`, dealId: x.deal.id, trainerId: x.trainerId, when: x.end });
    }
  }
  (i.bankRequests || []).forEach(b => att.push({ level: 'attention', kind: 'bank-check', text: `New bank account from ${name(b.trainerId) === 'The trainer' ? b.trainerName : name(b.trainerId)} to check`, trainerId: b.trainerId, when: day(b.at) }));
  rows.filter(r => r.rated > 0 && r.avg <= 2).forEach(r => att.push({ level: 'attention', kind: 'low-rating', text: `${r.trainer.name} averages ${r.avg} stars from ${r.rated} training${s(r.rated)}`, trainerId: r.trainer.id }));

  // Programmes used on deals with no trainer, or only one, ticked to teach them.
  const programmes = i.programmes
    .map(p => ({ id: p.id, name: String(p.name || '').trim(), trainers: i.trainers.filter(t => (t.programmeIds || []).includes(p.id)).length, deals: i.deals.filter(d => d.programmeId === p.id && !isDeletedDeal(d)).length }))
    .filter(p => p.name)
    .sort((a, b) => a.trainers - b.trainers || b.deals - a.deals || a.name.localeCompare(b.name));
  programmes.filter(p => p.deals > 0 && p.trainers === 0).forEach(p => att.push({ level: 'attention', kind: 'programme', text: `No trainer teaches "${p.name}" (used on ${p.deals} deal${s(p.deals)})` }));

  const order: Attention['kind'][] = ['no-trainer', 'no-claim', 'claim-waiting', 'no-po', 'po-not-accepted', 'no-bank', 'bank-check', 'not-rated', 'low-rating', 'programme'];
  att.sort((a, b) => (a.level === b.level ? 0 : a.level === 'danger' ? -1 : 1) || order.indexOf(a.kind) - order.indexOf(b.kind) || String(a.when || '').localeCompare(String(b.when || '')));
  return { rows, attention: att, programmes };
}
