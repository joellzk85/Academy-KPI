// One source of truth for quotations.
// While a quotation is a draft, everything that lives elsewhere is read live:
//   company, attention, address  <- client list (the deal's client if a deal is linked);
//                                   company = the employer name instead when the quotation says addressTo 'employer'
//   programme name + HRDC code   <- programme list
//   training date                <- the deal
//   owner                        <- the deal's owner
//   venue / trainer              <- venue list / trainer list
//   participants                 <- the deal (when recorded at the appointment)
// The quotation's own text fields are only used when it has no link yet (older quotations),
// and to hold the locked copy once it is marked as sent.

import { Quotation, QuotationItem } from '../types';
import { dealOwnerId, formatDate, trainingDateText, trainingDays } from './deals';
import { dealContact } from './contacts';

// Standard terms and conditions printed on every quotation unless edited.
export const DEFAULT_TERMS = [
  'Cancellation or rescheduling of training must be made in writing at least fourteen (14) working days prior to the commencement of the course.',
  'Any cancellation received less than fourteen (14) working days but more than seven (7) working days prior to the course date will be subject to a cancellation fee of 50% of the total course fee.',
  'For cancellations received less than seven (7) working days, or in case of non-attendance, 100% of the course fee will be charged and invoiced.',
  'Rescheduling is permitted up to seven (7) working days before the course starts, subject to slot availability and a rescheduling admin fee.',
  'Substitution of participants is permitted at no extra charge, provided NEXT Academy is notified in writing at least three (3) working days prior to training.',
  'Participants must achieve a minimum of 75% attendance for HRD Corp claims and to qualify for the Certificate of Attendance / Completion.',
  'Participants are required to participate fully in all training activities, assessments, and feedback sessions as requested by the trainers.',
  'Participants must comply with the training schedule, starting promptly at 9:00 AM and concluding at 5:00 PM unless otherwise specified.',
  'Late arrivals or early departures may result in disqualification of attendance records for certification and employer HRD Corp grant claims.',
  'All training materials, slides, hand-outs, videos, and intellectual property remain the exclusive property of NEXT Academy (1 Group).',
  'No part of the provided training materials may be reproduced, recorded, stored, or shared in any form without prior written permission.',
  'Materials distributed are for individual participant use only and may not be distributed or used for internal corporate retraining.',
  'Both parties agree to treat all business information and trade secrets disclosed during training as strictly confidential.',
  "Personal data of participants is collected and processed in compliance with the Personal Data Protection Act 2010 (PDPA) of Malaysia.",
  "Participants' personal info, emails, and phone numbers will be used solely for training administration, feedback, and certification purposes.",
];

export interface QuoteSources {
  clients: any[];
  deals: any[];
  programmes: any[];
  trainers: any[];
  venues: any[];
  people: { id: string; name: string }[];
}

export interface Resolved {
  q: Quotation;          // with the text fields filled from the sources (what prints)
  deal: any | null;
  client: any | null;
  ownerId: string;
  issues: string[];      // missing details to fix at the source
  fixes: QuoteFix[];     // the same, with what kind each is (the editor's box offers a field to fill each in)
}

// What a missing detail is, so the "Fix these at the source" box can offer the right field (2026-10-18).
export type QuoteFixKind = 'client_address' | 'client_employer' | 'client_contact' | 'no_client' | 'programme_gone' | 'deal_date' | 'days_mismatch';
export interface QuoteFix { kind: QuoteFixKind; text: string }

/** The quotation's main programme line: the first programme line that follows the deal's date. */
export function isMainDealLine(items: QuotationItem[], it: QuotationItem): boolean {
  return items.find(x => x.kind !== 'item' && x.useDealDate) === it;
}

export function isSent(q: Quotation): boolean {
  return q.status === 'sent';
}

export function resolveQuotation(q: Quotation, s: QuoteSources): Resolved {
  const deal = q.pipelineId ? s.deals.find(d => d.id === q.pipelineId) || null : null;
  const clientId = deal?.clientId || q.clientId || '';
  const client = clientId ? s.clients.find(c => c.id === clientId) || null : null;
  const ownerId = (deal && dealOwnerId(deal)) || q.ownerId || q.creatorId || '';
  if (isSent(q)) return { q, deal, client, ownerId, issues: [], fixes: [] };

  const fixes: QuoteFix[] = [];
  const issues = { push: (text: string, kind: QuoteFixKind) => { if (!fixes.some(f => f.kind === kind)) fixes.push({ kind, text }); } };
  const out: Quotation = { ...q, clientId: clientId || q.clientId };

  const attnOverride = (q.attnOverride || '').trim();
  if (client) {
    // Addressed to the company name, or (chosen per quotation) the client's employer name (Joel, 2026-10-19).
    const employer = (client.employerName || '').trim();
    out.company = q.addressTo === 'employer' && employer ? employer : client.companyName || '';
    if (q.addressTo === 'employer' && !employer) issues.push(`${client.companyName || 'This client'} has no employer name in the client list.`, 'client_employer');
    // The deal's attention person (else the client's main contact), unless a different PIC was typed for this quotation.
    out.attn = attnOverride || dealContact(deal, client)?.name || '';
    out.address = client.address || '';
    if (!out.address) issues.push(`${out.company || 'This client'} has no address in the client list.`, 'client_address');
    if (!out.attn) issues.push(`${out.company || 'This client'} has no contact person in the client list.`, 'client_contact');
  } else if (attnOverride) {
    out.attn = attnOverride;
  }
  if (!client && !q.company) {
    issues.push('Choose the deal or client this quotation is for.', 'no_client');
  }

  // Number of participants agreed at the appointment lives on the deal.
  if (deal?.participants) out.participants = `Up to ${deal.participants} pax`;

  const venue = q.venueId ? s.venues.find(v => v.id === q.venueId) : null;
  if (venue) out.venue = venue.name || '';

  const owner = s.people.find(p => p.id === ownerId);
  if (owner) { out.ownerId = owner.id; out.ownerName = owner.name; }

  out.items = (q.items || []).map((it): QuotationItem => {
    const line = { ...it };
    // Other items (bus, T-shirts): only description, quantity and price.
    if (it.kind === 'item') {
      line.code = ''; line.trainer = ''; line.date = '';
      line.totalFee = (Number(line.feePerDay) || 0) * (Number(line.days) || 0);
      return line;
    }
    // Picked from a list = read live; typed in = kept as typed.
    const prog = it.programmeId ? s.programmes.find(p => p.id === it.programmeId) : null;
    if (prog) { line.program = prog.name || ''; line.code = prog.hrdcCode || ''; }
    else if (it.programmeId) issues.push('A programme on this quotation is no longer in the programme list.', 'programme_gone');
    const trainer = it.trainerId ? s.trainers.find(t => t.id === it.trainerId) : null;
    if (trainer) line.trainer = trainer.name || '';
    if (it.useDealDate && deal) {
      // A training of several days prints its dates as a range, e.g. "21 – 22 Oct 2026".
      line.date = trainingDateText(deal);
      if (!line.date) issues.push('The linked deal has no training date yet.', 'deal_date');
      // The training days live on the deal too (Joel, 2026-10-23): the main programme line reads them, and they're
      // changed on the deal. Other programme lines keep their own days.
      if (isMainDealLine(q.items || [], it)) line.days = trainingDays(deal);
    }
    line.totalFee = (Number(line.feePerDay) || 0) * (Number(line.days) || 0);
    return line;
  });

  return { q: out, deal, client, ownerId, issues: fixes.map(f => f.text), fixes };
}
