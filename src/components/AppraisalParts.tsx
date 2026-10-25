import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { AppraisalCycle, CommentKey, COMMENT_KEYS, readCycle, readSelfReview, readSections, ResultComment, ResultRow, SelfReview } from '../lib/appraisalCycle';
import { Rating360 } from '../lib/rating360';
import { Review } from '../lib/scorecard';

// Pieces shared by Management's scorecard (Appraisal.tsx), the appraisal round (AppraisalRound.tsx) and each
// person's own appraisal (MyAppraisal.tsx): the data hooks, the self / teammates / manager star table, and the
// list of comments per section. Data: lib/appraisalCycle.ts.

export function useCycles(): AppraisalCycle[] {
  const [list, setList] = useState<AppraisalCycle[]>([]);
  useEffect(() => onSnapshot(query(collection(db, 'appraisal_cycles')),
    s => setList(s.docs.map(d => readCycle(d.id, d.data())).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))),
    () => setList([])), []);
  return list;
}

// One person's self reviews (the rules let the person read only their own; Management reads all).
export function useSelfReviews(memberId: string): SelfReview[] {
  const [list, setList] = useState<SelfReview[]>([]);
  useEffect(() => {
    if (!memberId) return;
    return onSnapshot(query(collection(db, 'self_reviews'), where('memberId', '==', memberId)),
      s => setList(s.docs.map(d => readSelfReview(d.id, d.data()))), () => setList([]));
  }, [memberId]);
  return list;
}
// Every self review of one round (Management).
export function useCycleSelfReviews(cycleId: string): SelfReview[] {
  const [list, setList] = useState<SelfReview[]>([]);
  useEffect(() => onSnapshot(query(collection(db, 'self_reviews'), where('cycleId', '==', cycleId)),
    s => setList(s.docs.map(d => readSelfReview(d.id, d.data()))), () => setList([])), [cycleId]);
  return list;
}

// Everyone's comments, per section: the person's own, the manager's (with reasons for low stars) and teammates'.
export function collectComments({ personName, selfs, reviews, ratings, raterName, skillName, valueName }: {
  personName: string; selfs: SelfReview[]; reviews: Review[]; ratings: Rating360[];
  raterName: (r: Rating360) => string; skillName: (id: string) => string; valueName: (id: string) => string;
}): Record<CommentKey, ResultComment[]> {
  const out = Object.fromEntries(COMMENT_KEYS.map(k => [k, [] as ResultComment[]])) as Record<CommentKey, ResultComment[]>;
  const add = (k: CommentKey, c: ResultComment) => { if (c.text.trim()) out[k].push(c); };
  selfs.forEach(s => Object.entries(s.sections).forEach(([k, t]) => add(k as CommentKey, { from: 'self', name: personName, text: String(t) })));
  reviews.forEach(r => {
    const name = r.byName || 'Management';
    Object.entries(readSections(r.sections)).forEach(([k, t]) => add(k as CommentKey, { from: 'manager', name, text: String(t) }));
    Object.entries(r.notes).forEach(([id, t]) => {
      if (r.skills[id] !== undefined) add('skills', { from: 'manager', name, text: `${skillName(id)} (${r.skills[id]}/5): ${t}` });
      else if (r.values[id] !== undefined) add('values', { from: 'manager', name, text: `${valueName(id)} (${r.values[id]}/5): ${t}` });
    });
    add('overall', { from: 'manager', name, text: r.comment });
  });
  ratings.forEach(x => {
    const name = raterName(x);
    Object.entries(readSections(x.sections)).forEach(([k, t]) => add(k as CommentKey, { from: 'teammate', name, text: String(t) }));
    Object.entries(x.comments || {}).forEach(([id, t]) => add('values', { from: 'teammate', name, text: `${valueName(id)} (${x.items?.[id] ?? '?'}/5): ${t}` }));
    add('values', { from: 'teammate', name, text: x.comment || '' });
  });
  return out;
}

const FROM_LABELS: Record<ResultComment['from'], string> = { self: 'Self', manager: 'Manager', teammate: 'Teammate' };
const FROM_ORDER: Record<ResultComment['from'], number> = { self: 0, manager: 1, teammate: 2 };

export function CommentList({ list, empty }: { list: ResultComment[]; empty?: string }) {
  if (!list.length) return empty ? <p className="text-sm text-ink-soft">{empty}</p> : null;
  return (
    <ul className="space-y-1.5">
      {list.slice().sort((a, b) => FROM_ORDER[a.from] - FROM_ORDER[b.from]).map((c, i) => (
        <li key={i} className="rounded-lg bg-surface px-3 py-2 text-[15px]">
          <span className="block text-sm text-ink-soft">{FROM_LABELS[c.from]}{c.name ? ` · ${c.name}` : ''}</span>
          <span className="whitespace-pre-line">{c.text}</span>
        </li>
      ))}
    </ul>
  );
}

// Comments under a card, with a small heading.
export function CardComments({ list }: { list: ResultComment[] }) {
  if (!list.length) return null;
  return (
    <div className="mt-3">
      <p className="mb-1 text-sm font-semibold">Comments</p>
      <CommentList list={list} />
    </div>
  );
}

const cell = (n: number | null | undefined) => (n === null || n === undefined ? '–' : n.toFixed(1));
// Stars per skill or value: self (never counted), teammates (values only) and manager.
export function ScoreTable({ rows, peers }: { rows: ResultRow[]; peers?: boolean }) {
  if (!rows.length) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[15px]">
        <thead>
          <tr className="text-left text-sm text-ink-soft">
            <th className="py-1 pr-2 font-semibold">{peers ? 'Value' : 'Skill'}</th>
            <th className="px-2 py-1 text-right font-semibold">Self</th>
            {peers && <th className="px-2 py-1 text-right font-semibold">Teammates</th>}
            <th className="py-1 pl-2 text-right font-semibold">Manager</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} className="border-t border-line">
              <td className="py-1.5 pr-2">{r.name}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-ink-soft">{cell(r.self)}</td>
              {peers && <td className="px-2 py-1.5 text-right tabular-nums">{cell(r.peers)}</td>}
              <td className="py-1.5 pl-2 text-right font-semibold tabular-nums">{cell(r.manager)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-sm text-ink-soft">Stars out of 5. Self is shown for comparison and doesn't count in the score.</p>
    </div>
  );
}
