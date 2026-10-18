import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { ChevronRight, Loader2 } from 'lucide-react';
import { db } from '../lib/firebase';
import { formatDate, todayIso } from '../lib/deals';
import { linkedOnly } from '../lib/linked';
import { daysBetween } from '../lib/followUps';
import { COLOUR_LABELS, ContactColour, DUE_LABELS, DueBucket, TeamFollowUp, agoText, dueBucket, teamFollowUps } from '../lib/touchPoints';
import { useContactLimits, useTeamList, useTouchPoints } from '../lib/useClientHistory';
import { ContactBadge, ContactDot } from './ClientContactDot';

// Team follow-ups (Joel, 2026-10-18: "I want to see who's everyone following up with"). Management only.
// My home: a summary per person. Management → Team follow-ups: the whole list, plus the clients that have gone
// quiet (red or never contacted) with nobody following up.

const select = 'rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';

function useTeamFollowUpData() {
  const [clients, setClients] = useState<any[]>([]);
  const [deals, setDeals] = useState<any[]>([]);
  const [quotes, setQuotes] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const touchPoints = useTouchPoints();
  const { limits } = useContactLimits();
  const team = useTeamList();
  useEffect(() => {
    const subs = [
      onSnapshot(query(collection(db, 'clients')), s => { setClients(s.docs.map(d => ({ ...d.data(), id: d.id }))); setLoaded(true); }, () => setLoaded(true)),
      onSnapshot(query(collection(db, 'pipelines')), s => setDeals(linkedOnly(s.docs.map(d => ({ ...d.data(), id: d.id }))))),
      onSnapshot(query(collection(db, 'quotations')), s => setQuotes(linkedOnly(s.docs.map(d => ({ ...d.data(), id: d.id })))), () => {}),
    ];
    return () => subs.forEach(u => u());
  }, []);
  const today = todayIso();
  const nameOf = (id: string) => team.find(p => p.id === id)?.name || 'Former team member';
  const data = useMemo(
    () => teamFollowUps(clients, { deals, quotes, outlines: [], files: [], touchPoints, tasks: [] }, nameOf, today, limits),
    [clients, deals, quotes, touchPoints, limits, team, today],
  );
  return { ...data, team, today, loaded, limits };
}

type PersonCount = { id: string; name: string; open: number; overdue: number; week: number };
function perPerson(items: TeamFollowUp[], today: string): PersonCount[] {
  const out: Record<string, PersonCount> = {};
  items.forEach(f => {
    const p = (out[f.byId] ||= { id: f.byId, name: f.byName, open: 0, overdue: 0, week: 0 });
    p.open++;
    const b = dueBucket(f.date, today);
    if (b === 'overdue') p.overdue++;
    else if (b !== 'later') p.week++;
  });
  return Object.values(out).sort((a, b) => b.overdue - a.overdue || b.open - a.open || a.name.localeCompare(b.name));
}

// ---------- My home: the summary ----------
export function TeamFollowUpsSummary({ onOpenFull }: { onOpenFull?: (personId?: string) => void }) {
  const { items, quiet, today, loaded } = useTeamFollowUpData();
  if (!loaded) return <p className="flex items-center gap-2 text-sm text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>;
  const people = perPerson(items, today);
  const overdue = items.filter(f => dueBucket(f.date, today) === 'overdue').length;
  return (
    <div className="space-y-3">
      <p className="text-[15px]"><strong>{items.length}</strong> open{overdue > 0 && <> · <strong className="text-danger">{overdue} overdue</strong></>}</p>
      {people.length === 0 ? <p className="text-[15px] text-ink-soft">Nobody has a follow-up planned.</p> : (
        <ul className="divide-y divide-line">
          {people.map(p => (
            <li key={p.id}>
              <button type="button" disabled={!onOpenFull} onClick={() => onOpenFull?.(p.id)} className="flex w-full items-center gap-2 py-2 text-left enabled:hover:bg-surface">
                <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
                <span className="shrink-0 text-sm text-ink-soft">
                  {p.open} open
                  {p.overdue > 0 && <> · <span className="font-semibold text-danger">{p.overdue} overdue</span></>}
                  {p.week > 0 && <> · {p.week} this week</>}
                </span>
                {onOpenFull && <ChevronRight className="h-4 w-4 shrink-0 text-ink-soft" />}
              </button>
            </li>
          ))}
        </ul>
      )}
      {quiet.length > 0 && (
        <button type="button" disabled={!onOpenFull} onClick={() => onOpenFull?.('__quiet')} className="flex w-full items-center gap-2 rounded-lg bg-danger-soft px-3 py-2 text-left text-sm font-semibold text-danger enabled:hover:underline">
          <ContactDot colour="red" /> {quiet.length} client{quiet.length === 1 ? '' : 's'} gone quiet, nobody following up
        </button>
      )}
      {onOpenFull && <button type="button" onClick={() => onOpenFull()} className={btnSecondary}>See the full list</button>}
    </div>
  );
}

// ---------- Management → Team follow-ups: the whole list ----------
export default function TeamFollowUpsPage({ initialPerson, onOpenClient, onOpenDeal }: {
  initialPerson?: string;                  // a person's id, or '__quiet' to jump to the gone-quiet list
  onOpenClient: (clientId: string) => void;
  onOpenDeal: (deal: { id: string }) => void;
}) {
  const { items, quiet, today, loaded, limits, team } = useTeamFollowUpData();
  const [person, setPerson] = useState(initialPerson && initialPerson !== '__quiet' ? initialPerson : '');
  const [when, setWhen] = useState<'' | DueBucket | 'week_all'>('');
  const [colour, setColour] = useState<'' | ContactColour>('');
  useEffect(() => {
    if (initialPerson === '__quiet') window.setTimeout(() => document.getElementById('gone-quiet')?.scrollIntoView({ behavior: 'smooth' }), 300);
  }, [initialPerson, loaded]);

  const people = perPerson(items, today);
  const shown = items.filter(f => (!person || f.byId === person)
    && (!when || (when === 'week_all' ? dueBucket(f.date, today) !== 'later' : dueBucket(f.date, today) === when))
    && (!colour || f.colour === colour));
  const quietShown = quiet.filter(q => !colour || q.summary.colour === colour);
  const overdue = items.filter(f => dueBucket(f.date, today) === 'overdue').length;
  const open = (f: TeamFollowUp) => (f.touchPointId || !f.dealId ? (f.clientId ? onOpenClient(f.clientId) : undefined) : onOpenDeal({ id: f.dealId }));

  return (
    <div className="space-y-5 font-sans text-ink">
      <div>
        <h2 className="text-xl font-bold">Team follow-ups</h2>
        <p className="mt-0.5 max-w-3xl text-[15px] text-ink-soft">
          Every follow-up waiting across the team: from client touch points and from deals. Overdue first. At the bottom, clients that have gone quiet
          (no touch point for over {limits.amber} days, or never) with nobody following up.
        </p>
      </div>

      {!loaded ? <p className="flex items-center gap-2 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p> : (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by person">
            <button type="button" aria-pressed={!person} onClick={() => setPerson('')}
              className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${!person ? 'border-ink bg-ink text-white' : 'border-line bg-white hover:bg-surface'}`}>
              Everyone {items.length}{overdue > 0 && <span className={!person ? '' : 'text-danger'}> · {overdue} overdue</span>}
            </button>
            {people.map(p => (
              <button key={p.id} type="button" aria-pressed={person === p.id} onClick={() => setPerson(x => (x === p.id ? '' : p.id))}
                className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${person === p.id ? 'border-ink bg-ink text-white' : 'border-line bg-white hover:bg-surface'}`}>
                {p.name} {p.open}{p.overdue > 0 && <span className={person === p.id ? '' : 'text-danger'}> · {p.overdue} overdue</span>}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select value={person} onChange={e => setPerson(e.target.value)} className={select} aria-label="Who follows up">
              <option value="">Everyone</option>
              {team.filter(p => p.active || people.some(x => x.id === p.id)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select value={when} onChange={e => setWhen(e.target.value as any)} className={select} aria-label="When">
              <option value="">Any date</option>
              <option value="overdue">Overdue</option>
              <option value="today">Today</option>
              <option value="week_all">This week (overdue to 7 days)</option>
              <option value="later">Later</option>
            </select>
            <select value={colour} onChange={e => setColour(e.target.value as any)} className={select} aria-label="Client colour">
              <option value="">Any client colour</option>
              {(['green', 'amber', 'red', 'never'] as ContactColour[]).map(c => <option key={c} value={c}>{COLOUR_LABELS[c]}</option>)}
            </select>
            {(person || when || colour) && <button type="button" className="text-sm font-semibold text-accent hover:underline" onClick={() => { setPerson(''); setWhen(''); setColour(''); }}>Clear filters</button>}
          </div>

          <div className="overflow-hidden rounded-2xl border border-line bg-white">
            {shown.length === 0 ? (
              <p className="p-6 text-center text-[15px] text-ink-soft">{items.length ? 'No follow-up matches these filters.' : 'Nobody has a follow-up planned.'}</p>
            ) : (
              <>
                <div className="hidden gap-4 border-b border-line bg-surface px-5 py-2 text-xs font-semibold uppercase tracking-wide text-ink-soft lg:grid lg:grid-cols-[8rem_minmax(0,1.3fr)_9rem_minmax(0,1.6fr)_minmax(0,1fr)]">
                  <span>Due</span><span>Client</span><span>Who</span><span>Last note</span><span>Last touch point</span>
                </div>
                <ul className="divide-y divide-line">
                  {shown.map(f => {
                    const b = dueBucket(f.date, today);
                    const tone = b === 'overdue' ? 'font-semibold text-danger' : b === 'today' ? 'font-semibold text-attention' : 'text-ink';
                    return (
                      <li key={f.key}>
                        <button type="button" onClick={() => open(f)} className="grid w-full gap-1 px-5 py-3 text-left hover:bg-surface lg:grid-cols-[8rem_minmax(0,1.3fr)_9rem_minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start lg:gap-4">
                          <span className={`text-sm ${tone}`}>{formatDate(f.date)}<span className="block text-xs font-normal text-ink-soft">{b === 'overdue' ? `${daysBetween(f.date, today)} day${daysBetween(f.date, today) === 1 ? '' : 's'} overdue` : DUE_LABELS[b]}</span></span>
                          <span className="min-w-0">
                            <span className="block truncate font-semibold">{f.clientName}</span>
                            <span className="block truncate text-sm text-ink-soft">{f.dealId ? `Deal: ${f.dealLabel}` : 'Client touch point'}</span>
                          </span>
                          <span className="text-sm font-semibold"><span className="font-normal text-ink-soft lg:hidden">Follow-up by </span>{f.byName}</span>
                          <span className={`min-w-0 text-sm text-ink-soft ${f.note ? '' : 'hidden lg:block'}`}><span className="line-clamp-2">{f.note || '—'}</span></span>
                          <span className="text-sm"><ContactBadge colour={f.colour} text={agoText(f.lastTouch?.date || '', today)} />{f.lastTouch?.byName && <span className="block text-ink-soft">by {f.lastTouch.byName}</span>}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>

          <section id="gone-quiet" className="space-y-2 scroll-mt-4">
            <h3 className="text-[15px] font-bold">Gone quiet, nobody following up ({quietShown.length})</h3>
            <p className="text-sm text-ink-soft">Red or never contacted, and no follow-up planned on the client or any open deal. Open one to add a touch point with a Follow-up by.</p>
            {quietShown.length === 0 ? (
              <p className="rounded-2xl border border-line bg-white p-5 text-center text-[15px] text-ink-soft">None. Every quiet client has someone following up.</p>
            ) : (
              <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">
                {quietShown.map(({ client: c, summary: s }) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => onOpenClient(c.id)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-left hover:bg-surface">
                      <span className="min-w-0 flex-1 truncate font-semibold">{c.companyName}</span>
                      <ContactBadge colour={s.colour} text={s.last ? `${agoText(s.last.date, today)}${s.last.byName ? `, by ${s.last.byName}` : ''}` : 'Never contacted'} />
                      <ChevronRight className="h-4 w-4 shrink-0 text-ink-soft" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
