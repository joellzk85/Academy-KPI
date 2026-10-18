import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDocs, onSnapshot, query, where, writeBatch } from 'firebase/firestore';
import { ChevronDown, Loader2, RotateCcw, Undo2 } from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import {
  LOST_REASONS, STAGE_LABELS, dealAskedFor, dealOwnerId, dealStage, dealValue, formatDate, formatRM, reachedStage, statusForStage,
} from '../lib/deals';
import { linkedWithDeleted } from '../lib/linked';
import { daysBetween, followUpNotes } from '../lib/followUps';
import { FollowUpList, followUpCountText } from './FollowUps';

// Management → Lost and deleted (Joel, 2026-10-18). Two lists, filters by rep, date range and reason, a count by
// reason to spot patterns, and Reopen (lost) or Restore (deleted). No permanent delete.

type Viewer = { id: string; name: string };
type Tab = 'lost' | 'deleted';

const card = 'rounded-2xl border border-line bg-white';
const field = 'rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';

const ymd = (v: any) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '');

export default function LostDeletedPage({ viewer, people }: { viewer: Viewer; people: { id: string; name: string }[] }) {
  const [deals, setDeals] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [programmes, setProgrammes] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<Tab>('lost');
  const [rep, setRep] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [openId, setOpenId] = useState('');
  const [busyId, setBusyId] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const subs = [
      onSnapshot(query(collection(db, 'pipelines')), s => { setDeals(linkedWithDeleted(s.docs.map(d => ({ ...d.data(), id: d.id })))); setLoaded(true); }, () => setLoaded(true)),
      onSnapshot(query(collection(db, 'clients')), s => setClients(s.docs.map(d => ({ ...d.data(), id: d.id })))),
      onSnapshot(query(collection(db, 'programmes')), s => setProgrammes(s.docs.map(d => ({ ...d.data(), id: d.id })))),
    ];
    return () => subs.forEach(u => u());
  }, []);

  const nameOf = (id: string) => people.find(p => p.id === id)?.name || 'Former team member';
  const clientName = (p: any) => clients.find(c => c.id === p.clientId)?.companyName || p.client || 'No client';
  const askedFor = (p: any) => dealAskedFor(p, programmes.find(x => x.id === p.programmeId)?.name) || 'Not recorded';

  const lost = deals.filter(p => !p.deleted && dealStage(p) === 'lost');
  const deleted = deals.filter(p => p.deleted === true);
  const endDate = (p: any) => (tab === 'lost' ? ymd(p.lostDate) || ymd(p.lostAt) : ymd(p.deletedAt));
  const reasonOf = (p: any) => (tab === 'lost' ? p.lostReason || 'No reason given' : p.deletedReason?.trim() || 'No reason given');
  const list = tab === 'lost' ? lost : deleted;

  const filtered = useMemo(() => list
    .filter(p => (!rep || dealOwnerId(p) === rep)
      && (!from || (endDate(p) && endDate(p) >= from))
      && (!to || (endDate(p) && endDate(p) <= to))
      && (!reason || (tab === 'lost' ? reasonOf(p) === reason : reasonOf(p).toLowerCase().includes(reason.toLowerCase()))))
    .sort((a, b) => endDate(b).localeCompare(endDate(a))),
  [list, rep, from, to, reason, tab]);

  // Count by reason (lost: the chosen reason; deleted: the typed reason) for the filtered list, ignoring the reason filter.
  const byReason = useMemo(() => {
    const base = list.filter(p => (!rep || dealOwnerId(p) === rep) && (!from || (endDate(p) && endDate(p) >= from)) && (!to || (endDate(p) && endDate(p) <= to)));
    const m: Record<string, number> = {};
    base.forEach(p => { const r = reasonOf(p); m[r] = (m[r] || 0) + 1; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [list, rep, from, to, tab]);

  const owners = [...new Set(list.map(dealOwnerId))].map(id => ({ id, name: nameOf(id) })).sort((a, b) => a.name.localeCompare(b.name));
  const totalValue = filtered.reduce((t, p) => t + dealValue(p), 0);

  const history = (p: any, action: string) => [...(p.history || []), { at: new Date().toISOString(), byId: viewer.id, byName: viewer.name, action }].slice(-40);

  const reopen = async (p: any) => {
    if (!window.confirm(`Reopen the deal for ${clientName(p)}? It goes back to ${STAGE_LABELS[reachedStage(p)]} in ${nameOf(dealOwnerId(p))}'s Deals.`)) return;
    setBusyId(p.id); setMsg(null);
    try {
      const batch = writeBatch(db);
      const st = reachedStage(p);
      batch.update(doc(db, 'pipelines', p.id), {
        stage: st, status: statusForStage(st), lostReason: '', lostNote: '', lostById: '', lostByName: '', lostAt: '',
        history: history(p, `Deal reopened by Management (was lost: ${p.lostReason || 'no reason'}${p.lostNote ? `, ${String(p.lostNote).slice(0, 80)}` : ''})`),
      });
      await batch.commit();
      setMsg({ ok: true, text: `${clientName(p)} reopened.` });
    } catch (e) { setMsg({ ok: false, text: friendlyError(e) }); } finally { setBusyId(''); }
  };

  const restore = async (p: any) => {
    if (!window.confirm(`Restore the deal for ${clientName(p)}? It comes back in ${nameOf(dealOwnerId(p))}'s Deals, with its draft quotations and course outlines.`)) return;
    setBusyId(p.id); setMsg(null);
    try {
      const [qs, os] = await Promise.all([
        getDocs(query(collection(db, 'quotations'), where('pipelineId', '==', p.id))),
        getDocs(query(collection(db, 'course_outlines'), where('pipelineId', '==', p.id))),
      ]);
      const batch = writeBatch(db);
      qs.docs.filter(d => d.data().dealDeleted === true).forEach(d => batch.update(d.ref, { dealDeleted: false }));
      os.docs.filter(d => d.data().dealDeleted === true).forEach(d => batch.update(d.ref, { dealDeleted: false }));
      batch.update(doc(db, 'pipelines', p.id), {
        deleted: false, restoredAt: new Date().toISOString(), restoredById: viewer.id, restoredByName: viewer.name,
        history: history(p, `Deal restored (was deleted by ${p.deletedByName || 'someone'}${p.deletedReason ? `: ${String(p.deletedReason).slice(0, 80)}` : ''})`),
      });
      await batch.commit();
      setMsg({ ok: true, text: `${clientName(p)} restored.` });
    } catch (e) { setMsg({ ok: false, text: friendlyError(e) }); } finally { setBusyId(''); }
  };

  const daysOpen = (p: any) => {
    const start = ymd(p.requestDate), end = endDate(p);
    return start && end ? Math.max(0, daysBetween(start, end)) : null;
  };

  return (
    <div className="space-y-5 font-sans text-ink">
      <div>
        <h2 className="text-xl font-bold">Lost and deleted deals</h2>
        <p className="mt-0.5 text-[15px] text-ink-soft">Why deals don't go ahead, to spot patterns. Reopen a lost deal or restore a deleted one; nothing here is erased.</p>
      </div>

      <div className="inline-flex rounded-xl border border-line bg-white p-1" role="tablist">
        {([['lost', `Lost (${lost.length})`], ['deleted', `Deleted (${deleted.length})`]] as const).map(([k, t]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setReason(''); setOpenId(''); setMsg(null); }}
            className={`rounded-lg px-4 py-1.5 text-sm font-semibold ${tab === k ? 'bg-accent text-white' : 'text-ink-soft hover:text-ink'}`}>{t}</button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm font-semibold">Rep<br />
          <select value={rep} onChange={e => setRep(e.target.value)} className={`${field} mt-1`}>
            <option value="">Everyone</option>
            {owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold">{tab === 'lost' ? 'Lost' : 'Deleted'} from<br />
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={`${field} mt-1`} />
        </label>
        <label className="text-sm font-semibold">to<br />
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className={`${field} mt-1`} />
        </label>
        {tab === 'lost' ? (
          <label className="text-sm font-semibold">Reason<br />
            <select value={reason} onChange={e => setReason(e.target.value)} className={`${field} mt-1`}>
              <option value="">All reasons</option>
              {[...new Set([...LOST_REASONS, ...lost.map(reasonOf)])].map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
        ) : (
          <label className="text-sm font-semibold">Reason contains<br />
            <input value={reason} onChange={e => setReason(e.target.value)} className={`${field} mt-1`} placeholder="e.g. duplicate" />
          </label>
        )}
        {(rep || from || to || reason) && <button type="button" className={btnSecondary} onClick={() => { setRep(''); setFrom(''); setTo(''); setReason(''); }}><RotateCcw className="h-4 w-4" /> Clear filters</button>}
      </div>

      {/* Count by reason */}
      {byReason.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Count by reason">
          {byReason.slice(0, 12).map(([r, n]) => (
            <button key={r} type="button" onClick={() => setReason(reason === r ? '' : r)} aria-pressed={reason === r}
              className={`rounded-full border px-3 py-1 text-sm font-medium ${reason === r ? 'border-danger bg-danger-soft text-danger' : 'border-line bg-white text-ink hover:bg-surface'}`}>
              {r.length > 40 ? r.slice(0, 40) + '…' : r} <strong className="tabular-nums">{n}</strong>
            </button>
          ))}
        </div>
      )}

      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`rounded-lg px-3 py-2.5 text-sm ${msg.ok ? 'bg-accent-soft text-accent' : 'bg-danger-soft text-danger'}`}>{msg.text}</p>}

      <div className={card}>
        <p className="border-b border-line px-5 py-3 text-sm text-ink-soft">{filtered.length} deal{filtered.length === 1 ? '' : 's'} · {formatRM(totalValue)}</p>
        {!loaded ? <p className="flex items-center gap-2 p-5 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
          : filtered.length === 0 ? <p className="p-5 text-ink-soft">{list.length ? 'No deals match these filters.' : tab === 'lost' ? 'No lost deals.' : 'No deleted deals.'}</p> : (
          <ul className="divide-y divide-line">
            {filtered.map(p => {
              const open = openId === p.id;
              const d = daysOpen(p);
              const nNotes = followUpNotes(p).length;
              const who = tab === 'lost' ? p.lostByName : p.deletedByName;
              const explanation = tab === 'lost' ? p.lostNote : '';
              return (
                <li key={p.id}>
                  <button type="button" onClick={() => setOpenId(open ? '' : p.id)} aria-expanded={open} className="flex w-full flex-col gap-1 px-5 py-3.5 text-left hover:bg-surface sm:flex-row sm:items-start sm:gap-4">
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 font-semibold"><ChevronDown className={`h-4 w-4 shrink-0 text-ink-soft transition-transform ${open ? '' : '-rotate-90'}`} /><span className="truncate">{clientName(p)}</span></span>
                      <span className="block truncate pl-5 text-sm text-ink-soft">{askedFor(p)} · reached {STAGE_LABELS[tab === 'lost' ? reachedStage(p) : dealStage(p)]} · {nameOf(dealOwnerId(p))}</span>
                      <span className="block pl-5 text-sm"><strong className="text-danger">{reasonOf(p)}</strong>{explanation ? <span className="text-ink-soft">: {explanation}</span> : null}</span>
                    </span>
                    <span className="shrink-0 pl-5 text-sm text-ink-soft sm:w-56 sm:pl-0 sm:text-right">
                      <span className="block font-semibold text-ink tabular-nums">{dealValue(p) ? formatRM(dealValue(p)) : '—'}</span>
                      <span className="block">{formatDate(endDate(p)) || 'Date not recorded'}{who ? ` by ${who}` : ''}</span>
                      <span className="block">{d === null ? '' : `Open ${d} day${d === 1 ? '' : 's'} · `}{followUpCountText(nNotes).toLowerCase()}</span>
                    </span>
                  </button>
                  {open && (
                    <div className="space-y-3 px-5 pb-4 sm:pl-10">
                      <FollowUpList deal={p} />
                      <button type="button" disabled={busyId === p.id} className={btnSecondary} onClick={() => (tab === 'lost' ? reopen(p) : restore(p))}>
                        {busyId === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
                        {tab === 'lost' ? 'Reopen deal' : 'Restore deal'}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <p className="text-sm text-ink-soft">Old deals not yet linked to a Team member (Data tools) aren't listed.</p>
    </div>
  );
}
