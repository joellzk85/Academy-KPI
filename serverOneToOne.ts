// 1-to-1 sessions (2026-10-25, src/lib/oneToOne.ts). Sessions are private to the two people in them, so the server
// answers the questions that need other records, giving back only counts, dates and plain labels:
// - POST /api/one-to-one/held { months: ['YYYY-MM'] } → { held, asked }: dates of held sessions per person (the
//   "1-to-1 sessions held" KPI, for the staff member and the coach) and of held sessions the staff member asked for
//   themselves ("1-to-1s asked for"). Management gets everyone, anyone else only their own.
// - POST /api/one-to-one/availability { date, time, personId, sessionId? } → { clashes: [{ who, text }] }: what is
//   already on the staff member's and the coach's calendars in those 90 minutes (other 1-to-1s, deal appointments,
//   CRM events they're tagged in). Only the staff member or the coach may ask.

import type { Express } from 'express';
import { admin, UserError, callerFrom, route } from './serverAuth';
import { askedDatesByPerson, BusyItem, clashesWith, heldDatesByPerson } from './src/lib/oneToOne';
import { dealOwnerId } from './src/lib/deals';

const MONTH = /^\d{4}-\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function registerOneToOneRoutes(app: Express) {
  app.post('/api/one-to-one/held', route(async req => {
    const caller = await callerFrom(req);
    const months: string[] = Array.isArray(req.body?.months) ? req.body.months.filter((m: any) => typeof m === 'string' && MONTH.test(m)).slice(0, 13) : [];
    if (!months.length) throw new UserError(400, 'bad-months', 'Choose a month.');
    const { db } = admin();
    const snap = await db.collection('one_to_ones').where('status', '==', 'held').get();
    const docs = snap.docs.map(d => d.data() as any);
    const pick = (all: Record<string, string[]>) => {
      const out: Record<string, string[]> = {};
      Object.entries(all).forEach(([id, dates]) => {
        if (caller.role !== 'management' && id !== caller.memberId) return;
        const inMonths = dates.filter(d => months.includes(d.slice(0, 7)));
        if (inMonths.length) out[id] = inMonths;
      });
      return out;
    };
    return { held: pick(heldDatesByPerson(docs)), asked: pick(askedDatesByPerson(docs)) };
  }));

  app.post('/api/one-to-one/availability', route(async req => {
    const caller = await callerFrom(req);
    const date = String(req.body?.date || '');
    const time = String(req.body?.time || '');
    const personId = String(req.body?.personId || '');
    const sessionId = String(req.body?.sessionId || '');
    if (!DATE.test(date) || !/^\d{2}:\d{2}$/.test(time) || !personId) throw new UserError(400, 'bad-request', 'Pick a date and a time.');
    const { db } = admin();
    const coachId = String((await db.collection('config').doc('one_to_one').get()).data()?.coachId || '');
    if (!coachId || (caller.memberId !== personId && caller.memberId !== coachId)) throw new UserError(403, 'not-yours', 'You can only check your own 1-to-1.');
    const people = [personId, coachId];
    const [team, otos, deals, events] = await Promise.all([
      db.collection('team').get(),
      db.collection('one_to_ones').where('date', '==', date).get(),
      db.collection('pipelines').get(),
      db.collection('events').where('date', '==', date).get(),
    ]);
    const nameOf = (id: string) => String(team.docs.find(d => d.id === id)?.data()?.name || 'Someone');
    const items: BusyItem[] = [];
    otos.docs.forEach(d => {
      const o: any = d.data();
      if (d.id === sessionId || !['requested', 'booked', 'held'].includes(o.status)) return;
      people.filter(p => p === o.personId || p === o.coachId).forEach(p => items.push({ who: p, label: 'Another 1-to-1', date: o.date, time: o.time, minutes: 90 }));
    });
    deals.docs.forEach(d => {
      const deal: any = d.data();
      const a = deal.appointment;
      if (deal.deleted || !a || a.date !== date) return;
      const owner = dealOwnerId(deal);
      if (people.includes(owner)) items.push({ who: owner, label: 'Client appointment', date: a.date, time: a.time, minutes: a.time ? 60 : null });
    });
    events.docs.forEach(d => {
      const ev: any = d.data();
      (Array.isArray(ev.attendees) ? ev.attendees : []).filter((p: string) => people.includes(p))
        .forEach((p: string) => items.push({ who: p, label: String(ev.title || 'Event'), date: ev.date, time: ev.time, minutes: /all day/i.test(ev.time || '') || !ev.time ? null : 60 }));
    });
    const clashes = clashesWith(date, time, items).map(c => ({ who: c.who === caller.memberId ? 'You' : nameOf(c.who), text: c.text }));
    return { clashes };
  }));
}
