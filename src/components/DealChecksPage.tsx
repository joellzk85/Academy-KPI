// Management → Deal checks (Joel, 2026-10-22; KPI integrity phase 1). Logic in src/lib/dealIntegrity.ts and
// src/lib/monthLock.ts.
// - Month lock card: reopen a locked month for everyone (with a reason), or lock it again.
// - Per person: deals won, original and adjusted Closing RM, cancelled and reduced deals, cancel rate.
// - Cancelled and reduced deals, and red flags (each can be marked "Checked, OK" with a note).
// DealFlagsBox shows a deal's open red flags in the deal panel (Management only).
import React, { useMemo, useState } from 'react';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { AlertTriangle, CheckCircle2, Loader2, Lock, LockOpen, ShieldCheck } from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import { formatDate, formatRM, todayIso } from '../lib/deals';
import {
  ClosingRow, DealFlag, FlagKey, IntegrityCheck, CANCEL_RATE_RED, allFlags, checkNoteProblem, closingTotals, daysBetween, flagChecked, openFlags,
} from '../lib/dealIntegrity';
import { MonthLockLog, lockMoment, validYm, ymLabel } from '../lib/monthLock';
import { useMonthLocks } from '../lib/useMonthLocks';

type Viewer = { id: string; name: string; role: string };

const card = 'rounded-2xl border border-line bg-white p-5';
const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';

const pctText = (r: number) => `${Math.round(r * 100)}%`;
const historyLine = (deal: any, viewer: Viewer, action: string) =>
  [...(deal.history || []), { at: new Date().toISOString(), byId: viewer.id, byName: viewer.name, action }].slice(-40);

export default function DealChecksPage({ deals, people, viewer, onOpenDeal }: {
  deals: any[]; people: { id: string; name: string }[]; viewer: Viewer; onOpenDeal?: (deal: any) => void;
}) {
  const today = todayIso();
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01`);
  const [to, setTo] = useState(today.slice(0, 7));
  const [person, setPerson] = useState('');
  const [showChecked, setShowChecked] = useState(false);
  const nameOf = (id: string) => people.find(p => p.id === id)?.name || 'Former team member';
  const range = from <= to ? { from, to } : { from: to, to: from };

  const totals = useMemo(() => closingTotals(deals, person, range.from, range.to), [deals, person, range.from, range.to]);
  const byPerson = useMemo(() => {
    const ids = Array.from(new Set(totals.rows.map(r => r.ownerId)));
    return ids.map(id => ({ id, name: nameOf(id), t: closingTotals(deals, id, range.from, range.to) }))
      .sort((a, b) => b.t.adjusted - a.t.adjusted || a.name.localeCompare(b.name));
  }, [totals, deals, people, range.from, range.to]);
  const changed = totals.rows.filter(r => r.cancelled || r.original - r.adjusted >= 0.01)
    .sort((a, b) => b.wonDate.localeCompare(a.wonDate));
  const flags = useMemo(() => allFlags(deals), [deals]);
  const shownFlags = flags.filter(f => (showChecked || !f.checked) && (!person || (f.deal.ownerId || f.deal.creatorId) === person));
  const openCount = flags.filter(f => !f.checked).length;

  return (
    <div className="space-y-5 font-sans text-ink">
      <div>
        <h2 className="text-xl font-bold">Deal checks</h2>
        <p className="text-[15px] text-ink-soft">What deals were worth when won against now, cancellations, red flags, and the month lock.</p>
      </div>

      <MonthLockCard viewer={viewer} />

      <section className={card}>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm font-semibold">From
            <input type="month" value={from} onChange={e => e.target.value && setFrom(e.target.value)} className={`${input} mt-1 w-44`} />
          </label>
          <label className="text-sm font-semibold">To
            <input type="month" value={to} onChange={e => e.target.value && setTo(e.target.value)} className={`${input} mt-1 w-44`} />
          </label>
          <label className="text-sm font-semibold">Person
            <select value={person} onChange={e => setPerson(e.target.value)} className={`${input} mt-1 w-56`}>
              <option value="">Everyone</option>
              {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        </div>

        <h3 className="mb-2 mt-5 font-bold">Each person, {ymLabel(range.from)} to {ymLabel(range.to)}</h3>
        {byPerson.length === 0 ? <p className="text-ink-soft">No deals won in these months.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[15px]">
              <thead>
                <tr className="border-b border-line text-left text-sm text-ink-soft">
                  <th className="py-2 pr-3 font-semibold">Person</th>
                  <th className="px-2 py-2 text-right font-semibold">Deals won</th>
                  <th className="px-2 py-2 text-right font-semibold">Original</th>
                  <th className="px-2 py-2 text-right font-semibold">Adjusted</th>
                  <th className="px-2 py-2 text-right font-semibold">Cancelled</th>
                  <th className="px-2 py-2 text-right font-semibold">Reduced</th>
                  <th className="py-2 pl-2 text-right font-semibold">Cancel rate</th>
                </tr>
              </thead>
              <tbody>
                {[...byPerson, ...(byPerson.length > 1 ? [{ id: '_all', name: 'Total', t: totals }] : [])].map(({ id, name, t }) => (
                  <tr key={id} className={`border-b border-line last:border-0 ${id === '_all' ? 'font-bold' : ''}`}>
                    <td className="py-2.5 pr-3 font-semibold">{name}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{t.dealsWon}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{formatRM(t.original)}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{formatRM(t.adjusted)}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{t.cancelledCount ? `${t.cancelledCount} · ${formatRM(t.cancelledRM)}` : '–'}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{t.reducedCount ? `${t.reducedCount} · ${formatRM(t.reducedRM)}` : '–'}</td>
                    <td className={`py-2.5 pl-2 text-right tabular-nums ${t.cancelRate >= CANCEL_RATE_RED ? 'font-bold text-danger' : ''}`}>{pctText(t.cancelRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-sm text-ink-soft">Original is the value on the day each deal was won; adjusted is the value now (a cancelled training counts 0). Closing RM counts the adjusted value. A cancel rate of 20% or more is red.</p>
      </section>

      <section className={card}>
        <h3 className="mb-3 font-bold">Cancelled and reduced deals ({changed.length})</h3>
        {changed.length === 0 ? <p className="text-ink-soft">None in these months.</p> : (
          <ul className="divide-y divide-line">
            {changed.map(r => <ChangedRow key={r.id} row={r} ownerName={nameOf(r.ownerId)} onOpen={onOpenDeal} />)}
          </ul>
        )}
      </section>

      <section className={card}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 font-bold"><AlertTriangle className="h-4 w-4 text-danger" /> Red flags ({openCount} to look at)</h3>
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={showChecked} onChange={e => setShowChecked(e.target.checked)} className="h-4 w-4 accent-[#0E6E62]" /> Show checked ones too
          </label>
        </div>
        {shownFlags.length === 0 ? <p className="text-ink-soft">{showChecked ? 'No red flags.' : 'Nothing to look at.'}</p> : (
          <ul className="space-y-3">
            {shownFlags.map(({ deal, flag, checked }) => (
              <li key={`${deal.id}_${flag.key}`} className={`rounded-xl border p-3.5 ${checked ? 'border-line bg-surface' : 'border-danger/30 bg-danger-soft'}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <button type="button" disabled={!onOpenDeal} onClick={() => onOpenDeal?.(deal)} className="min-w-0 text-left enabled:hover:underline">
                    <span className="block font-semibold">{deal.client || 'No client'}{deal.courseName ? ` · ${deal.courseName}` : ''}</span>
                    <span className="block text-sm text-ink-soft">{nameOf(deal.ownerId || deal.creatorId)}</span>
                  </button>
                  <span className={`text-sm font-semibold ${checked ? 'text-ink-soft' : 'text-danger'}`}>{flag.label}</span>
                </div>
                <p className="mt-1 text-sm">{flag.detail}</p>
                <FlagCheck deal={deal} flag={flag} checked={checked} viewer={viewer} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ChangedRow({ row: r, ownerName, onOpen }: { row: ClosingRow; ownerName: string; onOpen?: (deal: any) => void }) {
  const p = r.deal;
  const days = r.cancelled && r.cancelDate ? daysBetween(r.wonDate, r.cancelDate) : null;
  const why = r.cancelled
    ? [p.trainingCancelled?.reason, p.trainingCancelled?.note].filter(Boolean).join(': ')
    : (() => { const last = (Array.isArray(p.valueChanges) ? p.valueChanges : []).slice(-1)[0]; return last ? [last.reason, last.note].filter(Boolean).join(': ') : ''; })();
  return (
    <li>
      <button type="button" disabled={!onOpen} onClick={() => onOpen?.(p)} className="flex w-full flex-col gap-1 rounded-lg px-1 py-2.5 text-left enabled:hover:bg-accent-soft sm:flex-row sm:items-start sm:justify-between">
        <span className="min-w-0">
          <span className="block font-semibold">{p.client || 'No client'}{p.courseName ? ` · ${p.courseName}` : ''}</span>
          <span className="block text-sm text-ink-soft">
            {ownerName} · won {formatDate(r.wonDate)}
            {r.cancelled ? ` · cancelled ${r.cancelDate ? formatDate(r.cancelDate) : ''}${days !== null ? ` (${days} day${days === 1 ? '' : 's'} after winning)` : ''}` : ''}
          </span>
          {why && <span className="block text-sm text-ink-soft">{why}</span>}
        </span>
        <span className="shrink-0 text-right text-sm tabular-nums">
          {formatRM(r.original)} → <strong className={r.cancelled ? 'text-danger' : ''}>{formatRM(r.adjusted)}</strong>
          <span className="block text-xs text-ink-soft">{r.cancelled ? 'Training cancelled' : 'Reduced'}</span>
        </span>
      </button>
    </li>
  );
}

// "Checked, OK" with a note (Management). Saved as deal.integrityChecks.<flag>, with a History line.
function FlagCheck({ deal, flag, checked, viewer }: { deal: any; flag: DealFlag; checked: IntegrityCheck | null; viewer: Viewer }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (checked) {
    return <p className="mt-1.5 flex items-start gap-1.5 text-sm text-ink-soft"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" /> Checked, OK by {checked.byName} on {formatDate(checked.at)}: {checked.note}</p>;
  }
  if (viewer.role !== 'management') return null;
  const save = async () => {
    const problem = checkNoteProblem(note);
    if (problem) return setError(problem);
    setBusy(true);
    setError('');
    try {
      const entry: IntegrityCheck = { at: new Date().toISOString(), byId: viewer.id, byName: viewer.name, note: note.trim().slice(0, 300) };
      await updateDoc(doc(db, 'pipelines', deal.id), {
        [`integrityChecks.${flag.key}`]: entry,
        history: historyLine(deal, viewer, `Deal check "${flag.label}" marked Checked, OK: ${entry.note}`),
      });
      setOpen(false);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };
  if (!open) return <button type="button" className={`${btnSecondary} mt-2`} onClick={() => setOpen(true)}><ShieldCheck className="h-4 w-4" /> Checked, OK</button>;
  return (
    <div className="mt-2 space-y-2">
      <label htmlFor={`chk-${deal.id}-${flag.key}`} className="block text-sm font-semibold">What did you check?</label>
      <input id={`chk-${deal.id}-${flag.key}`} value={note} onChange={e => setNote(e.target.value)} maxLength={300} className={input}
        placeholder="e.g. Spoke to the client: two separate departments" />
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <button type="button" className={btnSecondary} onClick={() => { setOpen(false); setError(''); }}>Cancel</button>
        <button type="button" disabled={busy} className={btnPrimary} onClick={save}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Save</button>
      </div>
    </div>
  );
}

// Open red flags in the deal panel (Management only).
export function DealFlagsBox({ deal, allDeals, viewer }: { deal: any; allDeals: any[]; viewer: Viewer }) {
  const flags = openFlags(deal, allDeals);
  if (viewer.role !== 'management' || flags.length === 0) return null;
  return (
    <div className="space-y-2 rounded-xl border border-danger/30 bg-danger-soft p-4">
      <p className="flex items-center gap-2 font-semibold text-danger"><AlertTriangle className="h-4 w-4" /> Deal check{flags.length > 1 ? 's' : ''} to look at</p>
      {flags.map(f => (
        <div key={f.key}>
          <p className="text-sm"><strong className="text-danger">{f.label}.</strong> {f.detail}</p>
          <FlagCheck deal={deal} flag={f} checked={flagChecked(deal, f.key as FlagKey)} viewer={viewer} />
        </div>
      ))}
    </div>
  );
}

// ---------- Month lock ----------
// Months lock 2 days after they end; Management reopens one for everyone (with a reason) or locks it again.
function MonthLockCard({ viewer }: { viewer: Viewer }) {
  const { locks, loaded } = useMonthLocks();
  const now = new Date();
  // The last 24 months that have locked (newest first).
  const lockedMonths = useMemo(() => {
    const out: string[] = [];
    const d = new Date(now.getTime() + 8 * 3600 * 1000);   // Malaysia time
    let y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
    for (let i = 0; i < 26 && out.length < 24; i++) {
      const ym = `${y}-${String(m).padStart(2, '0')}`;
      if (now.getTime() >= lockMoment(ym).getTime()) out.push(ym);
      m -= 1; if (m === 0) { m = 12; y -= 1; }
    }
    return out;
  }, [now.toDateString()]);
  const [ym, setYm] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const pick = ym || lockedMonths.find(x => !locks.open.includes(x)) || '';

  const write = async (key: string, open: string[], entry: MonthLockLog) => {
    setBusy(key);
    setError('');
    try {
      await setDoc(doc(db, 'config', 'month_locks'), { open: open.filter(validYm).sort(), log: [...locks.log, entry].slice(-100), updatedAt: entry.at });
      setReason('');
      setYm('');
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy('');
    }
  };
  const reopen = () => {
    if (!pick) return setError('Pick the month to open.');
    if (locks.open.includes(pick)) return setError(`${ymLabel(pick)} is already open.`);
    if (reason.trim().length < 3) return setError('Give a short reason for opening it.');
    write('open', [...locks.open, pick], { ym: pick, action: 'open', reason: reason.trim().slice(0, 300), at: new Date().toISOString(), byId: viewer.id, byName: viewer.name });
  };
  const relock = (m: string) => write(m, locks.open.filter(x => x !== m), { ym: m, action: 'lock', reason: '', at: new Date().toISOString(), byId: viewer.id, byName: viewer.name });
  const lastOpen = (m: string) => [...locks.log].reverse().find(l => l.ym === m && l.action === 'open');
  // Locked months that are closed now, plus the reopened ones still before their own lock (shown open anyway).
  const reopened = locks.open.filter(m => now.getTime() >= lockMoment(m).getTime());
  const prev = lockedMonths[0];

  return (
    <section className={card}>
      <h3 className="flex items-center gap-2 font-bold"><Lock className="h-4 w-4 text-accent" /> Month lock</h3>
      <p className="mt-1 text-[15px] text-ink-soft">
        A month locks 2 days after it ends (00:00 on the 3rd, Malaysia time). After that only Management can add or change typed KPI numbers,
        check-ins, appointment meeting dates and follow-up notes dated in it.{prev ? ` Last locked: ${ymLabel(prev)}.` : ''}
      </p>
      {!loaded ? <p className="mt-3 flex items-center gap-2 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p> : (
        <>
          {reopened.length > 0 && (
            <ul className="mt-3 space-y-2">
              {reopened.map(m => {
                const l = lastOpen(m);
                return (
                  <li key={m} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-attention-soft px-3.5 py-2.5 text-sm">
                    <span className="flex items-center gap-2 text-attention"><LockOpen className="h-4 w-4" /> <strong>{ymLabel(m)} is open for everyone</strong>{l ? ` · ${l.byName}, ${formatDate(l.at)}: ${l.reason}` : ''}</span>
                    <button type="button" disabled={!!busy} className={btnSecondary} onClick={() => relock(m)}>{busy === m && <Loader2 className="h-4 w-4 animate-spin" />}<Lock className="h-4 w-4" /> Lock again</button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="text-sm font-semibold">Month
              <select value={pick} onChange={e => setYm(e.target.value)} className={`${input} mt-1 w-48`}>
                {lockedMonths.filter(m => !locks.open.includes(m)).map(m => <option key={m} value={m}>{ymLabel(m)}</option>)}
              </select>
            </label>
            <label className="min-w-[14rem] flex-1 text-sm font-semibold">Reason
              <input value={reason} onChange={e => setReason(e.target.value)} maxLength={300} className={`${input} mt-1`} placeholder="e.g. Aina was on leave and still has to key in week 4" />
            </label>
            <button type="button" disabled={!!busy || !pick} className={btnPrimary} onClick={reopen}>{busy === 'open' && <Loader2 className="h-4 w-4 animate-spin" />}<LockOpen className="h-4 w-4" /> Open</button>
          </div>
          {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
          {locks.log.length > 0 && (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer font-semibold text-ink-soft">History ({locks.log.length})</summary>
              <ul className="mt-2 space-y-1 text-ink-soft">
                {[...locks.log].reverse().slice(0, 20).map((l, i) => (
                  <li key={i}>{formatDate(l.at)} · {l.byName} {l.action === 'open' ? `opened ${ymLabel(l.ym)}: ${l.reason}` : `locked ${ymLabel(l.ym)} again`}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
