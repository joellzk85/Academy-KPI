import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, Loader2, Lock, Plus, Star, Unlock, Users, X } from 'lucide-react';
import PanelResizer from './PanelResizer';
import DraftBar from './DraftBar';
import { callServer, db, friendlyError } from '../lib/firebase';
import { useFormDraft } from '../lib/useFormDraft';
import { formatDate, todayIso } from '../lib/deals';
import {
  activeItems, isHeart, itemProblem, itemStars, MIN_COMMENT, needsComment, newItemId, Rating360, RatingItem, RatingPair, RatingRound, RoundMode, RoundView,
  ratingId, ratingOverall, readRatingItems, readRound, roundPairs, STAR_WORDS, summarise, toRate, withHeart,
} from '../lib/rating360';

// 360 rating (Joel, 2026-10-22; KPI Part C): one side panel with three tabs.
// - To rate: the people your open rounds give you; 1-5 stars on each attitude item, a reason (at least 20
//   characters) for any item scored 1 or 2, and an optional general comment.
// - About me: your ratings and comments from closed rounds (from the server; names only for open-view rounds).
// - Rounds (Management): open a round (everyone rates everyone, or picked pairs; open or closed view), follow who
//   has rated, read every rating with who gave it, close or reopen it, and keep the list of attitude items.
//   Data and rules: lib/rating360.ts.

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };
type Person = { id: string; name: string };

const input = 'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const label = 'mb-1 block text-sm font-semibold text-ink';
const primaryBtn = 'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-[15px] font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const secondaryBtn = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-50';
// Malaysia date of a saved time.
const myDay = (iso: string) => (Number.isFinite(Date.parse(iso)) ? new Date(Date.parse(iso) + 8 * 3600_000).toISOString().slice(0, 10) : '');
const monthText = (m: string) => (/^\d{4}-\d{2}$/.test(m) ? new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : m);

export function useRatingRounds(): RatingRound[] {
  const [rounds, setRounds] = useState<RatingRound[]>([]);
  useEffect(() => onSnapshot(query(collection(db, 'rating_rounds')),
    s => setRounds(s.docs.map(d => readRound(d.id, d.data())).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))),
    () => setRounds([])), []);
  return rounds;
}

// The attitude items Management keeps (config/rating_items), in order; the starting three until it is saved.
export function useRatingItems(): RatingItem[] {
  const [items, setItems] = useState<RatingItem[]>(() => readRatingItems(null));
  useEffect(() => onSnapshot(doc(db, 'config', 'rating_items'), d => setItems(readRatingItems(d.data())), () => {}), []);
  return items;
}

function StarsAvg({ avg, size = 'h-4 w-4' }: { avg: number; size?: string }) {
  return <span className="inline-flex items-center gap-1.5"><Stars value={Math.round(avg)} size={size} /><strong className="tabular-nums">{avg.toFixed(1)}</strong></span>;
}

// Your own ratings (the rules let you read only these, unless you are Management).
function useMyRatings(viewerId: string): Rating360[] {
  const [list, setList] = useState<Rating360[]>([]);
  useEffect(() => onSnapshot(query(collection(db, 'ratings_360'), where('raterId', '==', viewerId)),
    s => setList(s.docs.map(d => ({ ...(d.data() as any), id: d.id }))), () => setList([])), [viewerId]);
  return list;
}

// How many people you still have to rate in open rounds (the top-bar button).
export function useToRateCount(viewerId: string): number {
  const rounds = useRatingRounds();
  const mine = useMyRatings(viewerId);
  return rounds.filter(r => r.status === 'open')
    .reduce((t, r) => t + toRate(r, viewerId).filter(id => !mine.some(x => x.roundId === r.id && x.rateeId === id)).length, 0);
}

export default function Rating360Panel({ viewer, people, onClose, startTab }: {
  viewer: Viewer; people: Person[]; onClose: () => void; startTab?: 'rate' | 'me' | 'rounds';
}) {
  const isMgmt = viewer.role === 'management';
  const [tab, setTab] = useState<'rate' | 'me' | 'rounds'>(startTab || 'rate');
  const tabs: [typeof tab, string][] = [['rate', 'To rate'], ['me', 'About me'], ...(isMgmt ? [['rounds', 'Rounds'] as [typeof tab, string]] : [])];
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" role="dialog" aria-modal="true" aria-label="360 rating">
      <PanelResizer />
      <div className="flex h-full w-full flex-col bg-surface font-sans text-ink shadow-xl md:w-[var(--panel-w,max(50vw,40rem))] md:min-w-[24rem] md:max-w-[95vw]">
        <div className="border-b border-line bg-white px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold">360 rating</h3>
              <p className="text-sm text-ink-soft">Rate your teammates 1 to 5 on each item. Say why for any 1 or 2.</p>
            </div>
            <button type="button" onClick={onClose} className="rounded-md p-1 text-ink-soft hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
          </div>
          <div className="mt-3 inline-flex rounded-lg border border-line bg-white p-0.5" role="tablist">
            {tabs.map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold ${tab === k ? 'bg-accent text-white' : 'text-ink-soft hover:text-ink'}`}>{l}</button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {tab === 'rate' && <ToRate viewer={viewer} people={people} />}
          {tab === 'me' && <AboutMe />}
          {tab === 'rounds' && isMgmt && <Rounds viewer={viewer} people={people} />}
        </div>
      </div>
    </div>
  );
}

export function Stars({ value, onChange, size = 'h-7 w-7' }: { value: number; onChange?: (n: number) => void; size?: string }) {
  return (
    <span className="inline-flex items-center gap-0.5" role={onChange ? 'radiogroup' : undefined} aria-label="Stars">
      {[1, 2, 3, 4, 5].map(n => (
        onChange ? (
          <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n > 1 ? 's' : ''}, ${STAR_WORDS[n]}`} onClick={() => onChange(n)} className="rounded p-0.5 hover:bg-surface">
            <Star className={`${size} ${n <= value ? 'fill-[#F59E0B] text-[#F59E0B]' : 'text-line'}`} />
          </button>
        ) : <Star key={n} className={`${size} ${n <= value ? 'fill-[#F59E0B] text-[#F59E0B]' : 'text-line'}`} />
      ))}
    </span>
  );
}

// What Level 1 and Level 5 look like for an item (HEART values, scorecard skills).
export function LevelHints({ low, high }: { low?: string; high?: string }) {
  if (!low && !high) return null;
  return (
    <span className="mb-2 grid gap-1 text-sm text-ink-soft sm:grid-cols-2">
      {low && <span><strong className="text-ink">1 star:</strong> {low}</span>}
      {high && <span><strong className="text-ink">5 stars:</strong> {high}</span>}
    </span>
  );
}

// A full-width box for what 1 or 5 stars look like, with its label in front.
export function HintInput({ stars, ...rest }: { stars: 1 | 5 } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <span className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-sm font-semibold text-ink-soft">{stars} star{stars > 1 ? 's' : ''}</span>
      <input {...rest} />
    </span>
  );
}

// ---------- To rate ----------
function ToRate({ viewer, people }: { viewer: Viewer; people: Person[] }) {
  const rounds = useRatingRounds().filter(r => r.status === 'open' && toRate(r, viewer.id).length > 0);
  const mine = useMyRatings(viewer.id);
  const [editing, setEditing] = useState<{ round: RatingRound; rateeId: string } | null>(null);
  const nameOf = (id: string) => people.find(p => p.id === id)?.name || 'Former team member';
  if (editing) {
    const existing = mine.find(x => x.roundId === editing.round.id && x.rateeId === editing.rateeId);
    return <RateForm key={`${editing.round.id}_${editing.rateeId}`} viewer={viewer} round={editing.round} rateeId={editing.rateeId} rateeName={nameOf(editing.rateeId)} existing={existing} onDone={() => setEditing(null)} />;
  }
  if (!rounds.length) return <p className="rounded-2xl border border-line bg-white p-6 text-center text-ink-soft">Nothing to rate right now.</p>;
  return (
    <div className="space-y-4">
      {rounds.map(r => {
        const ids = toRate(r, viewer.id);
        const done = ids.filter(id => mine.some(x => x.roundId === r.id && x.rateeId === id)).length;
        return (
          <section key={r.id} className="overflow-hidden rounded-2xl border border-line bg-white">
            <div className="border-b border-line px-4 py-3">
              <p className="font-bold">{r.name}</p>
              <p className="text-sm text-ink-soft">{done} of {ids.length} rated{r.dueDate ? ` · by ${formatDate(r.dueDate)}` : ''} · {r.view === 'open' ? 'they will see your name' : 'your name is not shown to them'}</p>
            </div>
            <ul className="divide-y divide-line">
              {ids.map(id => {
                const x = mine.find(y => y.roundId === r.id && y.rateeId === id);
                return (
                  <li key={id}>
                    <button type="button" onClick={() => setEditing({ round: r, rateeId: id })} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface">
                      <span className="flex-1 font-semibold">{nameOf(id)}</span>
                      {x ? <><Stars value={Math.round(ratingOverall(x) || 0)} size="h-4 w-4" /><span className="text-sm text-accent">Change</span></> : <span className="rounded-full bg-attention-soft px-2.5 py-0.5 text-sm font-semibold text-attention">Rate now</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function RateForm({ viewer, round, rateeId, rateeName, existing, onDone }: {
  viewer: Viewer; round: RatingRound; rateeId: string; rateeName: string; existing?: Rating360; onDone: () => void; key?: string;
}) {
  const items = activeItems(useRatingItems());
  const [v, setV] = useState<{ items: Record<string, number>; comments: Record<string, string>; comment: string }>(() => ({
    items: itemStars(existing || {}), comments: { ...(existing?.comments || {}) }, comment: existing?.comment || '',
  }));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const draft = useFormDraft(viewer.id, `rating-items:${round.id}:${rateeId}`, v, setV);
  const setStars = (id: string, n: number) => { setV(x => ({ ...x, items: { ...x.items, [id]: n } })); setError(''); };
  const setWhy = (id: string, t: string) => { setV(x => ({ ...x, comments: { ...x.comments, [id]: t } })); setError(''); };
  const save = async () => {
    if (!items.length) return setError('Management has not set any items to rate yet.');
    for (const it of items) {
      const p = itemProblem(it, v.items[it.id] || 0, v.comments[it.id] || '');
      if (p) return setError(p);
    }
    setBusy(true); setError('');
    try {
      // Only the active items are saved; a reason is kept only where the score needs one.
      const stars = Object.fromEntries(items.map(it => [it.id, v.items[it.id]]));
      const why = Object.fromEntries(items.filter(it => needsComment(v.items[it.id])).map(it => [it.id, (v.comments[it.id] || '').trim()]));
      await setDoc(doc(db, 'ratings_360', ratingId(round.id, viewer.id, rateeId)), {
        roundId: round.id, raterId: viewer.id, raterName: viewer.name, rateeId, items: stars, comments: why, comment: v.comment.trim(), at: new Date().toISOString(),
      });
      draft.clear();
      onDone();
    } catch (e) { setError(friendlyError(e)); setBusy(false); }
  };
  return (
    <div className="space-y-4">
      <button type="button" className="text-sm font-semibold text-accent hover:underline" onClick={onDone}>← Back to the list</button>
      <DraftBar draft={draft} what={`rating for ${rateeName}`} />
      <section className="space-y-4 rounded-2xl border border-line bg-white p-5">
        <div>
          <h4 className="text-lg font-bold">{rateeName}</h4>
          <p className="text-sm text-ink-soft">{round.name} · {round.view === 'open' ? `${rateeName} will see your name with this rating.` : `${rateeName} sees the rating and comments, not your name. Management sees who gave it.`}</p>
        </div>
        {items.map(it => {
          const n = v.items[it.id] || 0;
          const left = Math.max(0, MIN_COMMENT - (v.comments[it.id] || '').trim().length);
          return (
            <div key={it.id} className="rounded-xl bg-surface p-3.5">
              <span className={label}>{it.name}</span>
              <LevelHints low={it.low} high={it.high} />
              <span className="flex flex-wrap items-center gap-3"><Stars value={n} onChange={x => setStars(it.id, x)} /><span className="text-sm text-ink-soft">{STAR_WORDS[n]}</span></span>
              {needsComment(n) && (
                <div className="mt-2">
                  <label htmlFor={`r360-why-${it.id}`} className={label}>Why {n} star{n > 1 ? 's' : ''}?</label>
                  <textarea id={`r360-why-${it.id}`} value={v.comments[it.id] || ''} onChange={e => setWhy(it.id, e.target.value)} className={`${input} min-h-[80px]`}
                    placeholder="What happened, and what would make it better. Give an example." />
                  <p className={`mt-1 text-sm ${left ? 'text-ink-soft' : 'text-accent'}`}>{left ? `${left} more character${left === 1 ? '' : 's'} needed` : 'Thank you'}</p>
                </div>
              )}
            </div>
          );
        })}
        <div>
          <label htmlFor="r360-why" className={label}>Anything else? (optional)</label>
          <textarea id="r360-why" value={v.comment} onChange={e => { setV(x => ({ ...x, comment: e.target.value })); setError(''); }} className={`${input} min-h-[80px]`}
            placeholder="What they did well, and what would make it better." />
        </div>
        {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={secondaryBtn} onClick={onDone}>Cancel</button>
          <button type="button" className={primaryBtn} disabled={busy} onClick={save}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{existing ? 'Save change' : 'Send rating'}</button>
        </div>
      </section>
    </div>
  );
}

// One rating's stars per item and its comments (older ratings: one row of stars).
export function RatingDetail({ r, items, who }: {
  r: { stars?: number; itemStars?: Record<string, number>; itemComments?: Record<string, string>; comment: string }; items: RatingItem[]; who?: React.ReactNode;
}) {
  const nameOf = (id: string) => items.find(i => i.id === id)?.name || 'Item no longer used';
  const per = Object.entries(r.itemStars || {});
  return (
    <>
      <span className="flex flex-wrap items-center gap-2 text-sm">{!per.length && r.stars ? <Stars value={r.stars} size="h-4 w-4" /> : null}{who}</span>
      {per.length > 0 && (
        <ul className="mt-1 space-y-1">
          {per.sort(([a], [b]) => (items.find(i => i.id === a)?.order ?? 99) - (items.find(i => i.id === b)?.order ?? 99)).map(([id, n]) => (
            <li key={id} className="text-[15px]">
              <span className="flex items-center gap-2"><span className="w-32 text-sm text-ink-soft">{nameOf(id)}</span><Stars value={n} size="h-3.5 w-3.5" /></span>
              {r.itemComments?.[id] && <p className="ml-34 whitespace-pre-line text-sm">{r.itemComments[id]}</p>}
            </li>
          ))}
        </ul>
      )}
      {r.comment && <p className="mt-1 whitespace-pre-line text-[15px]">{r.comment}</p>}
    </>
  );
}

// Average per item, in the items' order (items no longer used still show if they were rated).
export function ItemAverages({ avgs, items }: { avgs: Record<string, { avg: number; count: number }>; items: RatingItem[] }) {
  const ids = [...items.map(i => i.id).filter(id => avgs[id]), ...Object.keys(avgs).filter(id => !items.some(i => i.id === id))];
  if (!ids.length) return null;
  return (
    <ul className="grid gap-1.5 sm:grid-cols-2">
      {ids.map(id => (
        <li key={id} className="flex items-center justify-between gap-2 rounded-lg bg-surface px-3 py-1.5 text-sm">
          <span>{items.find(i => i.id === id)?.name || 'Item no longer used'}</span><StarsAvg avg={avgs[id].avg} />
        </li>
      ))}
    </ul>
  );
}

// ---------- About me ----------
type AboutItem = { stars: number; itemStars?: Record<string, number>; itemComments?: Record<string, string>; comment: string; raterName?: string };
type AboutRound = { roundId: string; name: string; month: string; view: RoundView; avg: number; count: number; itemAvgs?: Record<string, { avg: number; count: number }>; items: AboutItem[] };
function AboutMe() {
  const ratingItems = useRatingItems();
  const [rounds, setRounds] = useState<AboutRound[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    callServer<{ rounds: AboutRound[] }>('/api/ratings/about-me', {}, true).then(r => setRounds(r.rounds || [])).catch(e => setError(friendlyError(e)));
  }, []);
  if (error) return <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>;
  if (!rounds) return <p className="flex items-center gap-2 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>;
  if (!rounds.length) return <p className="rounded-2xl border border-line bg-white p-6 text-center text-ink-soft">No ratings about you yet. They show here once Management closes a round.</p>;
  return (
    <div className="space-y-4">
      {rounds.map(r => (
        <section key={r.roundId} className="rounded-2xl border border-line bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-bold">{r.name}</p>
              <p className="text-sm text-ink-soft">{monthText(r.month)} · {r.count} rating{r.count === 1 ? '' : 's'}</p>
            </div>
            <StarsAvg avg={r.avg} size="h-5 w-5" />
          </div>
          {r.itemAvgs && <div className="mt-3"><ItemAverages avgs={r.itemAvgs} items={ratingItems} /></div>}
          <ul className="mt-3 space-y-2">
            {r.items.map((x, i) => (
              <li key={i} className="rounded-xl bg-surface px-3.5 py-2.5">
                <RatingDetail r={x} items={ratingItems} who={x.raterName && <span className="font-semibold">{x.raterName}</span>} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ---------- Rounds (Management) ----------
export function useAllRatings(): Rating360[] {
  const [list, setList] = useState<Rating360[]>([]);
  useEffect(() => onSnapshot(query(collection(db, 'ratings_360')), s => setList(s.docs.map(d => ({ ...(d.data() as any), id: d.id }))), () => setList([])), []);
  return list;
}

function Rounds({ viewer, people }: { viewer: Viewer; people: Person[] }) {
  const rounds = useRatingRounds();
  const ratings = useAllRatings();
  const ratingItems = useRatingItems();
  const [creating, setCreating] = useState(false);
  const [editingItems, setEditingItems] = useState(false);
  const [open, setOpen] = useState('');
  const [error, setError] = useState('');
  const nameOf = (id: string) => people.find(p => p.id === id)?.name || 'Former team member';
  const setStatus = async (r: RatingRound, status: 'open' | 'closed') => {
    setError('');
    try { await setDoc(doc(db, 'rating_rounds', r.id), { status, ...(status === 'closed' ? { closedAt: new Date().toISOString(), closedByName: viewer.name } : {}) }, { merge: true }); }
    catch (e) { setError(friendlyError(e)); }
  };
  if (creating) return <RoundForm viewer={viewer} people={people} onDone={() => setCreating(false)} />;
  if (editingItems) return <ItemsForm viewer={viewer} items={ratingItems} onDone={() => setEditingItems(false)} />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-soft">People see their ratings once you close the round. Closed rounds show as attitude on the appraisal for their month.</p>
        <span className="flex gap-2">
          <button type="button" className={secondaryBtn} onClick={() => setEditingItems(true)}>Items to rate ({activeItems(ratingItems).length})</button>
          <button type="button" className={primaryBtn} onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New round</button>
        </span>
      </div>
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {rounds.length === 0 && <p className="rounded-2xl border border-line bg-white p-6 text-center text-ink-soft">No rounds yet.</p>}
      {rounds.map(r => {
        const pairs = roundPairs(r);
        const mine = ratings.filter(x => x.roundId === r.id && pairs.some(p => p.raterId === x.raterId && p.rateeId === x.rateeId));
        const rateeIds = Array.from(new Set(pairs.map(p => p.rateeId)));
        const raterIds = Array.from(new Set(pairs.map(p => p.raterId)));
        const isOpen = open === r.id;
        return (
          <section key={r.id} className="overflow-hidden rounded-2xl border border-line bg-white">
            <button type="button" onClick={() => setOpen(o => (o === r.id ? '' : r.id))} className="flex w-full items-start gap-2 px-4 py-3 text-left" aria-expanded={isOpen}>
              {isOpen ? <ChevronDown className="mt-0.5 h-4 w-4 text-ink-soft" /> : <ChevronRight className="mt-0.5 h-4 w-4 text-ink-soft" />}
              <span className="flex-1">
                <span className="font-bold">{r.name}</span>
                <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${r.status === 'open' ? 'bg-attention-soft text-attention' : 'bg-accent-soft text-accent'}`}>{r.status === 'open' ? 'Open' : 'Closed'}</span>
                <span className="block text-sm text-ink-soft">
                  {monthText(r.month)} · {r.mode === 'all' ? 'everyone rates everyone' : 'picked pairs'} · {r.view === 'open' ? 'open view (names shown)' : 'closed view (no names)'} · {mine.length} of {pairs.length} rated
                </span>
              </span>
            </button>
            {isOpen && (
              <div className="space-y-4 border-t border-line px-4 py-3">
                <div className="flex flex-wrap gap-2">
                  {r.status === 'open'
                    ? <button type="button" className={secondaryBtn} onClick={() => setStatus(r, 'closed')}><Lock className="h-4 w-4" /> Close round (people then see their ratings)</button>
                    : <button type="button" className={secondaryBtn} onClick={() => setStatus(r, 'open')}><Unlock className="h-4 w-4" /> Reopen</button>}
                </div>
                <div>
                  <p className="text-sm font-semibold">Still to rate</p>
                  <p className="text-sm text-ink-soft">
                    {raterIds.map(id => ({ id, left: pairs.filter(p => p.raterId === id).length - mine.filter(x => x.raterId === id).length })).filter(x => x.left > 0)
                      .map(x => `${nameOf(x.id)} (${x.left})`).join(', ') || 'Everyone has rated.'}
                  </p>
                </div>
                <ul className="space-y-3">
                  {rateeIds.map(id => {
                    const got = mine.filter(x => x.rateeId === id);
                    const sum = summarise(got);
                    return (
                      <li key={id} className="rounded-xl bg-surface p-3">
                        <p className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-semibold">{nameOf(id)}</span>
                          <span className="flex items-center gap-2 text-sm">{sum.overall ? <StarsAvg avg={sum.overall.avg} /> : null} <span className="text-ink-soft">{got.length} rating{got.length === 1 ? '' : 's'}</span></span>
                        </p>
                        {got.length > 0 && <div className="mt-2"><ItemAverages avgs={sum.items} items={ratingItems} /></div>}
                        {got.map(x => (
                          <div key={x.id} className="mt-2 rounded-lg bg-white px-3 py-2 text-[15px]">
                            <RatingDetail r={{ stars: x.stars, itemStars: itemStars(x), itemComments: x.comments, comment: x.comment }} items={ratingItems}
                              who={<><strong>{x.raterName}</strong><span className="text-ink-soft">{formatDate(myDay(x.at))}</span></>} />
                          </div>
                        ))}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function RoundForm({ viewer, people, onDone }: { viewer: Viewer; people: Person[]; onDone: () => void }) {
  const [f, setF] = useState(() => ({
    name: `360 rating ${monthText(todayIso().slice(0, 7))}`, month: todayIso().slice(0, 7), mode: 'all' as RoundMode, view: 'closed' as RoundView,
    people: people.map(p => p.id), pairs: [] as RatingPair[], dueDate: '',
  }));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const draft = useFormDraft(viewer.id, 'rating-round:new', f, setF);
  const set = (c: Partial<typeof f>) => { setF(x => ({ ...x, ...c })); setError(''); };
  const hasPair = (raterId: string, rateeId: string) => f.pairs.some(p => p.raterId === raterId && p.rateeId === rateeId);
  const togglePair = (raterId: string, rateeId: string) => set({
    pairs: hasPair(raterId, rateeId) ? f.pairs.filter(p => !(p.raterId === raterId && p.rateeId === rateeId)) : [...f.pairs, { raterId, rateeId }],
  });
  const count = useMemo(() => roundPairs({ ...f, id: '', status: 'open' } as RatingRound).length, [f]);
  const save = async () => {
    if (!f.name.trim()) return setError('Give the round a name.');
    if (!/^\d{4}-\d{2}$/.test(f.month)) return setError('Choose the KPI month.');
    if (!count) return setError(f.mode === 'all' ? 'Tick at least two people.' : 'Pick at least one person to rate someone.');
    setBusy(true);
    try {
      const id = `r360_${Date.now().toString(36)}`;
      await setDoc(doc(db, 'rating_rounds', id), {
        name: f.name.trim(), month: f.month, mode: f.mode, view: f.view, dueDate: f.dueDate,
        people: f.mode === 'all' ? f.people : [],
        pairs: f.mode === 'picked' ? f.pairs.map(p => ({ raterId: p.raterId, rateeId: p.rateeId })) : [],
        status: 'open', createdAt: new Date().toISOString(), createdById: viewer.id, createdByName: viewer.name,
      });
      draft.clear();
      onDone();
    } catch (e) { setError(friendlyError(e)); setBusy(false); }
  };
  return (
    <div className="space-y-4">
      <button type="button" className="text-sm font-semibold text-accent hover:underline" onClick={onDone}>← Back to rounds</button>
      <DraftBar draft={draft} what="new rating round" />
      <section className="space-y-4 rounded-2xl border border-line bg-white p-5">
        <h4 className="text-lg font-bold">New rating round</h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label htmlFor="rr-name" className={label}>Name</label><input id="rr-name" className={input} value={f.name} onChange={e => set({ name: e.target.value })} /></div>
          <div><label htmlFor="rr-month" className={label}>Counts in KPI month</label><input id="rr-month" type="month" className={input} value={f.month} onChange={e => set({ month: e.target.value })} /></div>
          <div><label htmlFor="rr-due" className={label}>Rate by (optional)</label><input id="rr-due" type="date" className={input} value={f.dueDate} onChange={e => set({ dueDate: e.target.value })} /></div>
        </div>
        <fieldset>
          <legend className={label}>Who rates whom</legend>
          {([['all', 'Everyone rates everyone', 'Everyone ticked below rates everyone else ticked.'], ['picked', 'Management picks', 'Choose who rates each person.']] as const).map(([k, t, h]) => (
            <label key={k} className={`mb-2 flex cursor-pointer gap-3 rounded-lg border px-3 py-2.5 ${f.mode === k ? 'border-accent bg-accent-soft' : 'border-line'}`}>
              <input type="radio" name="rr-mode" checked={f.mode === k} onChange={() => set({ mode: k })} className="mt-1 accent-[#0E6E62]" />
              <span><span className="block font-semibold">{t}</span><span className="block text-sm text-ink-soft">{h}</span></span>
            </label>
          ))}
        </fieldset>
        {f.mode === 'all' ? (
          <div>
            <span className={label}>People in this round</span>
            <div className="flex flex-wrap gap-2">
              {people.map(p => {
                const on = f.people.includes(p.id);
                return <button key={p.id} type="button" aria-pressed={on} onClick={() => set({ people: on ? f.people.filter(x => x !== p.id) : [...f.people, p.id] })}
                  className={`rounded-full border px-3 py-1 text-sm font-medium ${on ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-soft hover:bg-surface'}`}>{p.name}</button>;
              })}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <span className={label}>For each person, tick who rates them</span>
            {people.map(ratee => (
              <div key={ratee.id} className="rounded-xl bg-surface p-3">
                <p className="text-sm font-semibold"><Users className="mr-1 inline h-4 w-4 text-accent" />{ratee.name} is rated by</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {people.filter(r => r.id !== ratee.id).map(rater => {
                    const on = hasPair(rater.id, ratee.id);
                    return <button key={rater.id} type="button" aria-pressed={on} onClick={() => togglePair(rater.id, ratee.id)}
                      className={`rounded-full border px-3 py-1 text-sm font-medium ${on ? 'border-accent bg-white text-accent' : 'border-line bg-white text-ink-soft hover:bg-surface'}`}>{on && <Check className="mr-1 inline h-3.5 w-3.5" />}{rater.name}</button>;
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
        <fieldset>
          <legend className={label}>What people see about their ratings</legend>
          {([['closed', 'Closed view', 'Stars and comments, without who gave them.'], ['open', 'Open view', 'Stars and comments with who gave them.']] as const).map(([k, t, h]) => (
            <label key={k} className={`mb-2 flex cursor-pointer gap-3 rounded-lg border px-3 py-2.5 ${f.view === k ? 'border-accent bg-accent-soft' : 'border-line'}`}>
              <input type="radio" name="rr-view" checked={f.view === k} onChange={() => set({ view: k })} className="mt-1 accent-[#0E6E62]" />
              <span><span className="block font-semibold">{t}</span><span className="block text-sm text-ink-soft">{h} Management always sees who rated whom.</span></span>
            </label>
          ))}
        </fieldset>
        <p className="text-sm text-ink-soft">{count} rating{count === 1 ? '' : 's'} to give in this round.</p>
        {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={secondaryBtn} onClick={onDone}>Cancel</button>
          <button type="button" className={primaryBtn} disabled={busy} onClick={save}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Open round</button>
        </div>
      </section>
    </div>
  );
}

// ---------- Attitude items (Management) ----------
// Add, rename, turn off and reorder. Items are never deleted, so older ratings keep their names.
function ItemsForm({ viewer, items, onDone }: { viewer: Viewer; items: RatingItem[]; onDone: () => void }) {
  const [list, setList] = useState<RatingItem[]>(() => items.map(i => ({ ...i })));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const draft = useFormDraft(viewer.id, 'rating-items:settings', list, setList);
  const change = (id: string, c: Partial<RatingItem>) => { setList(l => l.map(i => (i.id === id ? { ...i, ...c } : i))); setError(''); };
  const move = (idx: number, by: number) => setList(l => {
    const next = l.slice();
    const [x] = next.splice(idx, 1);
    next.splice(idx + by, 0, x);
    return next;
  });
  const save = async () => {
    if (list.some(i => !i.name.trim())) return setError('Give every item a name.');
    if (!list.some(i => i.active)) return setError('Keep at least one item turned on.');
    setBusy(true);
    try {
      await setDoc(doc(db, 'config', 'rating_items'), {
        items: list.map((i, n) => ({ id: i.id, name: i.name.trim(), active: i.active, order: n + 1, low: (i.low || '').trim(), high: (i.high || '').trim() })),
        updatedAt: new Date().toISOString(), updatedById: viewer.id, updatedByName: viewer.name,
      });
      draft.clear();
      onDone();
    } catch (e) { setError(friendlyError(e)); setBusy(false); }
  };
  return (
    <div className="space-y-4">
      <button type="button" className="text-sm font-semibold text-accent hover:underline" onClick={onDone}>← Back to rounds</button>
      <DraftBar draft={draft} what="items to rate" />
      <section className="space-y-3 rounded-2xl border border-line bg-white p-5">
        <div>
          <h4 className="text-lg font-bold">Items to rate</h4>
          <p className="text-sm text-ink-soft">Everyone scores each item that is on, 1 to 5. Turning an item off keeps its past ratings. These are also the Behavioural part of the appraisal.</p>
        </div>
        {!isHeart(list) && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-accent-soft px-3.5 py-2.5">
            <span className="text-sm">Use the HEART values (Humility, Expertise, Accountability, Remarkable, Trustworthiness). Other items are turned off, not deleted.</span>
            <button type="button" className={secondaryBtn} onClick={() => { setList(withHeart(list)); setError(''); }}>Use HEART values</button>
          </div>
        )}
        <ul className="space-y-2">
          {list.map((it, idx) => (
            <li key={it.id} className={`space-y-2 rounded-lg bg-surface px-3 py-2 ${it.active ? '' : 'opacity-70'}`}>
              <span className="flex flex-wrap items-center gap-2">
                <input className={`${input} flex-1 min-w-[10rem]`} value={it.name} onChange={e => change(it.id, { name: e.target.value })} aria-label="Item name" />
                <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" className="accent-[#0E6E62]" checked={it.active} onChange={e => change(it.id, { active: e.target.checked })} /> On</label>
                <button type="button" className="rounded-md p-1.5 text-ink-soft hover:bg-white disabled:opacity-30" disabled={idx === 0} onClick={() => move(idx, -1)} aria-label="Move up"><ArrowUp className="h-4 w-4" /></button>
                <button type="button" className="rounded-md p-1.5 text-ink-soft hover:bg-white disabled:opacity-30" disabled={idx === list.length - 1} onClick={() => move(idx, 1)} aria-label="Move down"><ArrowDown className="h-4 w-4" /></button>
              </span>
              {it.active && (
                <span className="grid gap-2">
                  <HintInput stars={1} className={input} value={it.low || ''} onChange={e => change(it.id, { low: e.target.value })} placeholder="What 1 star looks like" aria-label={`${it.name || 'Item'}: what 1 star looks like`} />
                  <HintInput stars={5} className={input} value={it.high || ''} onChange={e => change(it.id, { high: e.target.value })} placeholder="What 5 stars look like" aria-label={`${it.name || 'Item'}: what 5 stars look like`} />
                </span>
              )}
            </li>
          ))}
        </ul>
        <button type="button" className={secondaryBtn} onClick={() => setList(l => [...l, { id: newItemId(), name: '', active: true, order: l.length + 1 }])}><Plus className="h-4 w-4" /> Add an item</button>
        {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={secondaryBtn} onClick={onDone}>Cancel</button>
          <button type="button" className={primaryBtn} disabled={busy} onClick={save}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save items</button>
        </div>
      </section>
    </div>
  );
}
