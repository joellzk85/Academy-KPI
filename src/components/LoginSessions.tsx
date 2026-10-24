import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db, friendlyError } from '../lib/firebase';
import { formatMinutes } from '../lib/loginActivity';
import {
  ACTIVITY_KINDS, ACTIVITY_LABELS, ActivityEntry, ActivityKind, FLAG_HELP, FLAG_LABELS, KIND_LABELS, LoginSession, SessionFlag,
  deviceLine, placeLine,
} from '../lib/loginSessions';
import { TeamMember } from '../types';

// Team → Login log → Logins and Actions (Management only; Joel 2026-10-24). Records are written by the server
// (serverActivity.ts); what each one holds is in lib/loginSessions.ts.

const MAX_ROWS = 2000;
const FLAGS = Object.keys(FLAG_LABELS) as SessionFlag[];
const selectClass = 'rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm text-ink';
const whenText = (ms: number) => new Date(ms).toLocaleString('en-MY', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const timeText = (ms: number) => new Date(ms).toLocaleTimeString('en-MY', { hour: 'numeric', minute: '2-digit' });

function useRecords<T>(name: string, fromMs: number) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setRows(null);
    return onSnapshot(
      query(collection(db, name), where('at', '>=', fromMs), orderBy('at', 'desc'), limit(MAX_ROWS)),
      snap => { setRows(snap.docs.map(d => ({ ...(d.data() as any), id: d.id }))); setError(''); },
      e => { setError(friendlyError(e)); setRows([]); },
    );
  }, [name, fromMs]);
  return { rows, error };
}

export const useLoginSessions = (fromMs: number) => useRecords<LoginSession>('login_sessions', fromMs);
export const useActivityLog = (fromMs: number) => useRecords<ActivityEntry>('activity_log', fromMs);

/** Who is online now: memberId → minutes since their last active minute (login_live, kept by the server). */
export function useOnlineNow(): Map<string, number> {
  const [live, setLive] = useState<Map<string, number>>(new Map());
  useEffect(() => onSnapshot(collection(db, 'login_live'), snap => {
    const m = new Map<string, number>();
    const now = Date.now();
    snap.docs.forEach(d => {
      const last = Math.max(0, ...Object.values((d.data().sessions || {}) as Record<string, any>).map(s => Number(s?.lastAt) || 0));
      if (now - last < 3 * 60_000) m.set(d.id, last);
    });
    setLive(m);
  }, () => {}), []);
  return live;
}

export function FlagChip({ flag }: { flag: SessionFlag }) {
  const strong = flag === 'shared' || flag === 'many_fails';
  return (
    <span title={FLAG_HELP[flag]} className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${strong ? 'bg-danger-soft text-danger' : 'bg-attention/15 text-attention'}`}>
      {FLAG_LABELS[flag]}
    </span>
  );
}

const nameIn = (members: TeamMember[]) => (id: string) => members.find(m => m.id === id)?.name || 'Someone no longer on the team';

export function LoginsView({ members, fromMs }: { members: TeamMember[]; fromMs: number }) {
  const { rows, error } = useLoginSessions(fromMs);
  const [who, setWho] = useState('all');
  const [kind, setKind] = useState<'all' | 'login' | 'fail'>('all');
  const [flag, setFlag] = useState<'any' | 'none' | SessionFlag>('none');
  const [shown, setShown] = useState(200);
  const nameOf = nameIn(members);

  const byPerson = useMemo(() => (rows || []).filter(s => who === 'all' || s.memberId === who), [rows, who]);
  const counts = useMemo(() => {
    const c = {} as Record<SessionFlag, number>;
    byPerson.forEach(s => (s.flags || []).forEach(f => { c[f] = (c[f] || 0) + 1; }));
    return c;
  }, [byPerson]);
  const list = byPerson.filter(s =>
    (kind === 'all' || (kind === 'login' ? s.kind !== 'fail' : s.kind === 'fail'))
    && (flag === 'none' || (flag === 'any' ? (s.flags || []).length > 0 : (s.flags || []).includes(flag))));

  return (
    <div className="px-5 py-4">
      <p className="mb-3 text-sm text-ink-soft">
        Each login, each time the CRM was opened with a saved login, and each wrong password. The place comes from the internet
        address (town, not an exact spot; phone data is often shown as another town). Point at a warning for what it means.
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select value={who} onChange={e => setWho(e.target.value)} className={selectClass} aria-label="Whose logins">
          <option value="all">Everyone</option>
          {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <select value={kind} onChange={e => setKind(e.target.value as any)} className={selectClass} aria-label="Kind">
          <option value="all">Logins and wrong passwords</option>
          <option value="login">Logins and opens only</option>
          <option value="fail">Wrong passwords only</option>
        </select>
        <button type="button" onClick={() => setFlag(flag === 'any' ? 'none' : 'any')}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold ${flag === 'any' ? 'border-danger bg-danger-soft text-danger' : 'border-line bg-white text-ink-soft hover:bg-surface'}`}>
          <AlertTriangle className="h-4 w-4" /> Only with warnings
        </button>
        {FLAGS.filter(f => counts[f]).map(f => (
          <button key={f} type="button" title={FLAG_HELP[f]} onClick={() => setFlag(flag === f ? 'none' : f)}
            className={`rounded-lg border px-2.5 py-1.5 text-sm ${flag === f ? 'border-accent bg-accent-soft font-semibold text-accent' : 'border-line bg-white text-ink-soft hover:bg-surface'}`}>
            {FLAG_LABELS[f]} · {counts[f]}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</p>}
      {rows === null ? (
        <p className="flex items-center gap-2 py-2 text-sm text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
      ) : !list.length ? (
        <p className="py-2 text-sm text-ink-soft">Nothing in this period. Logins are recorded from 24 Oct 2026.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[60rem] text-[15px]">
            <thead>
              <tr className="border-b border-line bg-surface text-left text-sm text-ink-soft">
                <th className="px-3 py-2 font-semibold">When</th>
                <th className="px-3 py-2 font-semibold">Person</th>
                <th className="px-3 py-2 font-semibold">What</th>
                <th className="px-3 py-2 font-semibold">Time used</th>
                <th className="px-3 py-2 font-semibold">Place and internet address</th>
                <th className="px-3 py-2 font-semibold">Device</th>
                <th className="px-3 py-2 font-semibold">Warnings</th>
              </tr>
            </thead>
            <tbody>
              {list.slice(0, shown).map(s => (
                <tr key={s.id} className={`border-b border-line align-top last:border-0 ${s.kind === 'fail' ? 'bg-danger-soft/40' : ''}`}>
                  <td className="whitespace-nowrap px-3 py-2.5">{whenText(s.at)}</td>
                  <td className="px-3 py-2.5 font-semibold">{nameOf(s.memberId)}</td>
                  <td className={`px-3 py-2.5 ${s.kind === 'fail' ? 'font-semibold text-danger' : ''}`}>{KIND_LABELS[s.kind] || s.kind}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-sm">
                    {s.kind === 'fail' ? <span className="text-ink-soft">–</span> : (
                      <>{formatMinutes(s.minutes || 0)} active<span className="block text-ink-soft">{timeText(s.at)} to {timeText(s.lastAt || s.at)}</span></>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-sm">
                    {placeLine(s) || <span className="text-ink-soft">Place not found</span>}
                    <span className="block text-ink-soft">{[s.ip, s.isp].filter(Boolean).join(' · ')}</span>
                  </td>
                  <td className="px-3 py-2.5 text-sm">{deviceLine(s)}</td>
                  <td className="px-3 py-2.5">
                    <span className="flex flex-wrap gap-1">{(s.flags || []).map(f => <FlagChip key={f} flag={f} />)}</span>
                    {s.sharedWith && (
                      <span className="mt-1 block text-xs text-ink-soft">
                        Also on: {[placeLine({ city: s.sharedWith.city }) || 'unknown place', s.sharedWith.ip].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.length > shown && (
        <button type="button" onClick={() => setShown(shown + 200)} className="mt-3 rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-semibold text-ink hover:bg-surface">
          Show more ({list.length - shown} left)
        </button>
      )}
    </div>
  );
}

export function ActionsView({ members, fromMs }: { members: TeamMember[]; fromMs: number }) {
  const { rows, error } = useActivityLog(fromMs);
  const [who, setWho] = useState('all');
  const [kind, setKind] = useState<'all' | ActivityKind>('all');
  const [shown, setShown] = useState(200);
  const nameOf = nameIn(members);
  const list = (rows || []).filter(r => (who === 'all' || r.memberId === who) && (kind === 'all' || r.kind === kind));

  return (
    <div className="px-5 py-4">
      <p className="mb-3 text-sm text-ink-soft">
        Downloads of the whole CRM, files and personal details, everything deleted (forever or restorable), password changes
        and team changes. Recorded from 24 Oct 2026.
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select value={who} onChange={e => setWho(e.target.value)} className={selectClass} aria-label="Whose actions">
          <option value="all">Everyone</option>
          {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <select value={kind} onChange={e => setKind(e.target.value as any)} className={selectClass} aria-label="Kind of action">
          <option value="all">Every kind</option>
          {ACTIVITY_KINDS.map(k => <option key={k} value={k}>{ACTIVITY_LABELS[k]}</option>)}
        </select>
      </div>
      {error && <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</p>}
      {rows === null ? (
        <p className="flex items-center gap-2 py-2 text-sm text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
      ) : !list.length ? (
        <p className="py-2 text-sm text-ink-soft">Nothing in this period.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[44rem] text-[15px]">
            <thead>
              <tr className="border-b border-line bg-surface text-left text-sm text-ink-soft">
                <th className="px-3 py-2 font-semibold">When</th>
                <th className="px-3 py-2 font-semibold">Person</th>
                <th className="px-3 py-2 font-semibold">Kind</th>
                <th className="px-3 py-2 font-semibold">What</th>
                <th className="px-3 py-2 font-semibold">Place and internet address</th>
              </tr>
            </thead>
            <tbody>
              {list.slice(0, shown).map(r => (
                <tr key={r.id} className="border-b border-line align-top last:border-0">
                  <td className="whitespace-nowrap px-3 py-2.5">{whenText(r.at)}</td>
                  <td className="px-3 py-2.5 font-semibold">{nameOf(r.memberId)}</td>
                  <td className={`px-3 py-2.5 ${r.kind === 'delete' ? 'font-semibold text-danger' : ''}`}>{ACTIVITY_LABELS[r.kind] || r.kind}</td>
                  <td className="px-3 py-2.5 text-sm">{r.what}</td>
                  <td className="px-3 py-2.5 text-sm">
                    {r.city || <span className="text-ink-soft">Place not found</span>}
                    {r.ip && <span className="block text-ink-soft">{r.ip}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.length > shown && (
        <button type="button" onClick={() => setShown(shown + 200)} className="mt-3 rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-semibold text-ink hover:bg-surface">
          Show more ({list.length - shown} left)
        </button>
      )}
    </div>
  );
}
