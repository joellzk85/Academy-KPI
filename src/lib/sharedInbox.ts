// "Shared with me" alerts (Joel, 2026-10-18): when someone shares a quotation or course outline with you, you get
// a red dot (with the count) on Quotations / Course outlines in your workspace menu and on the list's
// "Shared with me" button, and a line on My home's "Shared with me" card, until you open it.
// - Sharing records who shared it and when on the file: sharedLog[memberId] = { at, byId, byName }.
//   Files shared before this have no entry, so they never light up.
// - What each person has opened is kept on their own prefs: user_prefs/{id}.sharedSeen['quotation:<id>'] = when.
//   Sharing the same file with them again later lights it up again.

import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, query, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { linkedOnly } from './linked';

export type SharedKind = 'quotation' | 'outline';
export interface ShareEntry { at: string; byId: string; byName: string }
export type ShareLog = Record<string, ShareEntry>;

export interface SharedItem {
  kind: SharedKind;
  id: string;
  ref: string;
  title: string;        // programme / course title, if any
  client: string;
  byName: string;
  at: string;
}

export const seenKey = (kind: SharedKind, id: string) => `${kind}:${id}`;

// The sharedLog after ticking or unticking a person in the share box.
export function shareLogAfter(log: ShareLog | undefined, personId: string, on: boolean, me: { id: string; name: string }): ShareLog {
  const next = { ...(log || {}) };
  if (on) next[personId] = { at: new Date().toISOString(), byId: me.id, byName: me.name };
  else delete next[personId];
  return next;
}

// Is this file waiting for this person to open it?
export function isUnseen(kind: SharedKind, f: any, meId: string, seen: Record<string, string>): boolean {
  const entry: ShareEntry | undefined = f?.sharedLog?.[meId];
  if (!entry?.at || !(f.sharedWithIds || []).includes(meId)) return false;
  if (f.ownerId === meId || f.creatorId === meId) return false;
  const s = seen[seenKey(kind, f.id)];
  return !s || s < entry.at;
}

export function markSharedSeen(meId: string, kind: SharedKind, f: any) {
  if (!meId || !f?.id || !f?.sharedLog?.[meId]) return;
  setDoc(doc(db, 'user_prefs', meId), { sharedSeen: { [seenKey(kind, f.id)]: new Date().toISOString() } }, { merge: true })
    .catch(() => { /* stays as an alert; marked again next time it's opened */ });
}

// What this person has opened (their own prefs only).
export function useSharedSeen(meId?: string): Record<string, string> {
  const [seen, setSeen] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!meId) return;
    return onSnapshot(doc(db, 'user_prefs', meId), s => setSeen((s.data()?.sharedSeen as Record<string, string>) || {}), () => setSeen({}));
  }, [meId]);
  return seen;
}

// Everything shared with this person that they haven't opened yet, newest first.
export function useSharedInbox(meId?: string): { items: SharedItem[]; quotations: number; outlines: number } {
  const seen = useSharedSeen(meId);
  const [quotes, setQuotes] = useState<any[]>([]);
  const [outlines, setOutlines] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [deals, setDeals] = useState<any[]>([]);
  const [programmes, setProgrammes] = useState<any[]>([]);
  useEffect(() => {
    if (!meId) return;
    const all = (s: any) => s.docs.map((d: any) => ({ ...d.data(), id: d.id }));
    const subs = [
      onSnapshot(query(collection(db, 'quotations')), s => setQuotes(linkedOnly(all(s))), () => {}),
      onSnapshot(query(collection(db, 'course_outlines')), s => setOutlines(linkedOnly(all(s))), () => {}),
      onSnapshot(query(collection(db, 'clients')), s => setClients(all(s)), () => {}),
      onSnapshot(query(collection(db, 'pipelines')), s => setDeals(linkedOnly(all(s))), () => {}),
      onSnapshot(query(collection(db, 'programmes')), s => setProgrammes(all(s)), () => {}),
    ];
    return () => subs.forEach(u => u());
  }, [meId]);

  return useMemo(() => {
    if (!meId) return { items: [], quotations: 0, outlines: 0 };
    const clientOf = (f: any) => {
      const deal = f.pipelineId ? deals.find(d => d.id === f.pipelineId) : null;
      const cid = deal?.clientId || f.clientId;
      return clients.find(c => c.id === cid)?.companyName || f.company || f.preparedForCompany || '';
    };
    const progName = (id?: string) => (id ? programmes.find(p => p.id === id)?.name || '' : '');
    const item = (kind: SharedKind, f: any): SharedItem => {
      const deal = f.pipelineId ? deals.find(d => d.id === f.pipelineId) : null;
      const title = kind === 'quotation'
        ? (f.items || []).map((i: any) => progName(i.programmeId) || i.program).find(Boolean) || ''
        : progName(f.programmeId) || f.courseTitle || progName(deal?.programmeId) || deal?.courseName || '';
      const e: ShareEntry = f.sharedLog[meId];
      return { kind, id: f.id, ref: f.refNumber || '', title, client: clientOf(f), byName: e.byName || '', at: e.at };
    };
    const q = quotes.filter(f => isUnseen('quotation', f, meId, seen)).map(f => item('quotation', f));
    const o = outlines.filter(f => isUnseen('outline', f, meId, seen)).map(f => item('outline', f));
    return { items: [...q, ...o].sort((a, b) => b.at.localeCompare(a.at)), quotations: q.length, outlines: o.length };
  }, [meId, seen, quotes, outlines, clients, deals, programmes]);
}
