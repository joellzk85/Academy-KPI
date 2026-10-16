import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDocs, writeBatch } from 'firebase/firestore';
import { AlertTriangle, Check, Link2, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import { TeamMember, ROLE_LABELS } from '../types';

interface DataToolsProps {
  teamMembers: TeamMember[];
}

// Records that carry people's IDs and should follow them to their new Team profile.
const LINKED_COLLECTIONS: { name: string; label: string }[] = [
  { name: 'pipelines', label: 'deals' },
  { name: 'quotations', label: 'quotations' },
  { name: 'course_outlines', label: 'course outlines' },
];

// Data agreed to be cleared when the new structure goes in.
const CLEAR_COLLECTIONS: { name: string; label: string }[] = [
  { name: 'appointments', label: 'Appointments' },
  { name: 'admin_records', label: 'Admin checklists' },
  { name: 'payments', label: 'Payment vouchers' },
  { name: 'client_payments', label: 'Client payments' },
  { name: 'month_kpis', label: 'KPI history' },
  { name: 'events', label: 'Calendar events' },
  { name: 'tasks', label: 'Tasks' },
  { name: 'project_pls', label: 'P&L sheets' },
  { name: 'links', label: 'Saved Google links' },
];

type Doc = { coll: string; id: string; data: any };

const btnPrimary = 'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-surface disabled:opacity-60';

async function commitInChunks(ops: ((b: ReturnType<typeof writeBatch>) => void)[]) {
  for (let i = 0; i < ops.length; i += 400) {
    const batch = writeBatch(db);
    ops.slice(i, i + 400).forEach(op => op(batch));
    await batch.commit();
  }
}

export default function DataTools({ teamMembers }: DataToolsProps) {
  const [records, setRecords] = useState<Doc[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [linking, setLinking] = useState(false);
  const [linkMsg, setLinkMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [clearCounts, setClearCounts] = useState<Record<string, number> | null>(null);
  const [oldWorkspaces, setOldWorkspaces] = useState<string[]>([]);
  const [confirmClear, setConfirmClear] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearMsg, setClearMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const teamIds = useMemo(() => new Set(teamMembers.map(m => m.id)), [teamMembers]);
  const activeMembers = useMemo(() => teamMembers.filter(m => m.active).sort((a, b) => a.name.localeCompare(b.name)), [teamMembers]);

  const load = async () => {
    setLoadError('');
    try {
      const all: Doc[] = [];
      for (const c of LINKED_COLLECTIONS) {
        const snap = await getDocs(collection(db, c.name));
        snap.forEach(d => all.push({ coll: c.name, id: d.id, data: d.data() }));
      }
      setRecords(all);
      const counts: Record<string, number> = {};
      for (const c of CLEAR_COLLECTIONS) {
        counts[c.name] = (await getDocs(collection(db, c.name))).size;
      }
      setClearCounts(counts);
      const reps = await getDocs(collection(db, 'reps'));
      setOldWorkspaces(reps.docs.map(d => d.id).filter(id => !teamIds.has(id)));
    } catch (err) {
      setLoadError(friendlyError(err));
    }
  };

  useEffect(() => { load(); }, [teamIds]);

  // Old person IDs found in records, with the name last seen for them.
  const oldPeople = useMemo(() => {
    const found: Record<string, { name: string; count: number }> = {};
    const note = (id: any, name: any) => {
      if (!id || typeof id !== 'string' || teamIds.has(id)) return;
      if (!found[id]) found[id] = { name: '', count: 0 };
      if (name && !found[id].name) found[id].name = String(name);
    };
    (records || []).forEach(({ data }) => {
      const ids = new Set<string>();
      [[data.ownerId, data.ownerName], [data.creatorId, data.creatorName], [data.taggedRepId, data.taggedRepName]].forEach(([id, name]) => {
        note(id, name);
        if (id && !teamIds.has(id)) ids.add(id);
      });
      (data.taggedRepIds || []).forEach((id: string) => { note(id, ''); if (id && !teamIds.has(id)) ids.add(id); });
      ids.forEach(id => { found[id].count++; });
    });
    return Object.entries(found)
      .map(([id, v]) => ({ id, name: v.name || id, count: v.count }))
      .sort((a, b) => b.count - a.count);
  }, [records, teamIds]);

  // Suggest a match when an old name equals a new team member's name.
  useEffect(() => {
    setMapping(prev => {
      const next = { ...prev };
      oldPeople.forEach(op => {
        if (next[op.id]) return;
        const guess = activeMembers.find(m => m.name.trim().toLowerCase() === op.name.trim().toLowerCase()
          || m.name.trim().toLowerCase() === op.id.replace(/-/g, ' '));
        if (guess) next[op.id] = guess.id;
      });
      return next;
    });
  }, [oldPeople, activeMembers]);

  const handleLink = async () => {
    setLinkMsg(null);
    const pairs = Object.entries(mapping).filter(([, to]) => to && teamIds.has(to));
    if (pairs.length === 0) return setLinkMsg({ ok: false, text: 'Choose a team member for at least one old name.' });
    const map: Record<string, string> = Object.fromEntries(pairs);
    const nameOf = (id: string) => teamMembers.find(m => m.id === id)?.name || '';
    const ops: ((b: ReturnType<typeof writeBatch>) => void)[] = [];
    let touched = 0;
    (records || []).forEach(({ coll, id, data }) => {
      const upd: any = {};
      if (map[data.ownerId]) { upd.ownerId = map[data.ownerId]; upd.ownerName = nameOf(map[data.ownerId]); }
      else if (!data.ownerId && map[data.creatorId]) { upd.ownerId = map[data.creatorId]; upd.ownerName = nameOf(map[data.creatorId]); }
      if (map[data.creatorId]) { upd.creatorId = map[data.creatorId]; upd.creatorName = nameOf(map[data.creatorId]); }
      if (map[data.taggedRepId]) { upd.taggedRepId = map[data.taggedRepId]; upd.taggedRepName = nameOf(map[data.taggedRepId]); }
      if (Array.isArray(data.taggedRepIds) && data.taggedRepIds.some((x: string) => map[x])) {
        upd.taggedRepIds = data.taggedRepIds.map((x: string) => map[x] || x);
      }
      if (Array.isArray(data.completedTags) && data.completedTags.some((x: string) => map[x])) {
        upd.completedTags = data.completedTags.map((x: string) => map[x] || x);
      }
      if (Object.keys(upd).length) {
        touched++;
        ops.push(b => b.update(doc(db, coll, id), upd));
      }
    });
    setLinking(true);
    try {
      await commitInChunks(ops);
      setLinkMsg({ ok: true, text: `${touched} record${touched === 1 ? '' : 's'} moved to their new Team profiles.` });
      setMapping({});
      await load();
    } catch (err) {
      setLinkMsg({ ok: false, text: friendlyError(err) });
    } finally {
      setLinking(false);
    }
  };

  const totalToClear = clearCounts ? Object.values(clearCounts).reduce((a: number, b: number) => a + b, 0) + oldWorkspaces.length : 0;

  const handleClear = async () => {
    setClearMsg(null);
    setClearing(true);
    try {
      const ops: ((b: ReturnType<typeof writeBatch>) => void)[] = [];
      for (const c of CLEAR_COLLECTIONS) {
        const snap = await getDocs(collection(db, c.name));
        snap.forEach(d => ops.push(b => b.delete(d.ref)));
      }
      oldWorkspaces.forEach(id => ops.push(b => b.delete(doc(db, 'reps', id))));
      await commitInChunks(ops);
      setClearMsg({ ok: true, text: `Cleared ${ops.length} old record${ops.length === 1 ? '' : 's'}. Clients, venues, trainers, quotations, deals and course outlines were kept.` });
      setConfirmClear(false);
      setUnderstood(false);
      await load();
    } catch (err) {
      setClearMsg({ ok: false, text: friendlyError(err) });
    } finally {
      setClearing(false);
    }
  };

  const linkedCounts = (records || []).reduce((acc: Record<string, number>, r) => { acc[r.coll] = (acc[r.coll] || 0) + 1; return acc; }, {});

  return (
    <div className="space-y-6 font-sans text-ink">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Data tools</h2>
          <p className="mt-1 max-w-2xl text-[15px] leading-relaxed text-ink-soft">One-time tools for moving from the old CRM. Use them once, right after this update goes live.</p>
        </div>
        <button type="button" className={btnSecondary} onClick={load}><RefreshCw className="h-4 w-4" /> Refresh</button>
      </div>
      {loadError && <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-[15px] text-danger">{loadError}</p>}

      {/* Link old records */}
      <section className="rounded-2xl border border-line bg-white p-5">
        <h3 className="flex items-center gap-2 font-bold"><Link2 className="h-4 w-4 text-accent" /> Link old records to the new team</h3>
        <p className="mt-1 text-[15px] leading-relaxed text-ink-soft">
          Old deals, quotations and course outlines are tagged with the old logins. Match each old name to the right person so their work appears in their workspace and counts toward their KPIs.
        </p>
        {records === null ? (
          <p className="mt-4 flex items-center gap-2 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Checking records…</p>
        ) : (
          <>
            <p className="mt-3 text-sm text-ink-soft">
              Found {linkedCounts.pipelines || 0} deals, {linkedCounts.quotations || 0} quotations and {linkedCounts.course_outlines || 0} course outlines.
            </p>
            {oldPeople.length === 0 ? (
              <p className="mt-4 flex items-center gap-2 rounded-lg bg-accent-soft px-4 py-3 text-[15px] text-accent"><Check className="h-4 w-4" /> Every record is already linked to someone on the Team list.</p>
            ) : (
              <>
                <ul className="mt-4 divide-y divide-line rounded-xl border border-line">
                  {oldPeople.map(op => (
                    <li key={op.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">{op.name}</span>
                        <span className="block text-sm text-ink-soft">On {op.count} record{op.count === 1 ? '' : 's'}</span>
                      </span>
                      <label className="sr-only" htmlFor={`map-${op.id}`}>New team member for {op.name}</label>
                      <select
                        id={`map-${op.id}`}
                        value={mapping[op.id] || ''}
                        onChange={e => setMapping(m => ({ ...m, [op.id]: e.target.value }))}
                        className="w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] focus:border-accent focus:outline-none sm:w-64"
                      >
                        <option value="">Leave unlinked for now</option>
                        {activeMembers.map(m => <option key={m.id} value={m.id}>{m.name} ({ROLE_LABELS[m.role]})</option>)}
                      </select>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 flex justify-end">
                  <button type="button" className={btnPrimary} disabled={linking} onClick={handleLink}>
                    {linking && <Loader2 className="h-4 w-4 animate-spin" />} Link records
                  </button>
                </div>
              </>
            )}
            {linkMsg && <p role="status" className={`mt-3 rounded-lg px-4 py-3 text-[15px] ${linkMsg.ok ? 'bg-accent-soft text-accent' : 'bg-danger-soft text-danger'}`}>{linkMsg.text}</p>}
          </>
        )}
      </section>

      {/* Clear old data */}
      <section className="rounded-2xl border border-line bg-white p-5">
        <h3 className="flex items-center gap-2 font-bold"><Trash2 className="h-4 w-4 text-danger" /> Clear old data</h3>
        <p className="mt-1 text-[15px] leading-relaxed text-ink-soft">
          Removes the old data you agreed to drop, so the rebuilt screens start clean. Your clients, venues, trainers, quotations, deals and course outlines are kept.
        </p>
        {clearCounts === null ? (
          <p className="mt-4 flex items-center gap-2 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Counting…</p>
        ) : (
          <>
            <ul className="mt-4 grid gap-x-6 gap-y-1.5 text-[15px] sm:grid-cols-2">
              {CLEAR_COLLECTIONS.map(c => (
                <li key={c.name} className="flex justify-between border-b border-line py-1.5"><span>{c.label}</span><span className="tabular-nums text-ink-soft">{clearCounts[c.name]}</span></li>
              ))}
              <li className="flex justify-between border-b border-line py-1.5"><span>Old login workspaces</span><span className="tabular-nums text-ink-soft">{oldWorkspaces.length}</span></li>
            </ul>
            {totalToClear === 0 ? (
              <p className="mt-4 flex items-center gap-2 rounded-lg bg-accent-soft px-4 py-3 text-[15px] text-accent"><Check className="h-4 w-4" /> Nothing left to clear.</p>
            ) : !confirmClear ? (
              <div className="mt-4 flex justify-end">
                <button type="button" className={`${btnSecondary} text-danger hover:bg-danger-soft`} onClick={() => setConfirmClear(true)}>
                  <Trash2 className="h-4 w-4" /> Clear {totalToClear} old records
                </button>
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-danger/30 bg-danger-soft p-4">
                <p className="flex items-center gap-2 font-semibold text-danger"><AlertTriangle className="h-4 w-4" /> This permanently deletes {totalToClear} records</p>
                <p className="mt-1 text-sm text-danger">It can't be undone. Any KPI numbers typed in since this update went live are also cleared.</p>
                <label className="mt-3 flex items-center gap-2 text-sm text-danger">
                  <input type="checkbox" checked={understood} onChange={e => setUnderstood(e.target.checked)} className="h-4 w-4 accent-[#B42318]" />
                  I understand, delete these records
                </label>
                <div className="mt-3 flex gap-2">
                  <button type="button" className={btnSecondary} onClick={() => { setConfirmClear(false); setUnderstood(false); }}>Cancel</button>
                  <button type="button" disabled={!understood || clearing} onClick={handleClear} className="inline-flex items-center gap-2 rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white hover:bg-[#931C13] disabled:opacity-60">
                    {clearing && <Loader2 className="h-4 w-4 animate-spin" />} Delete permanently
                  </button>
                </div>
              </div>
            )}
            {clearMsg && <p role="status" className={`mt-3 rounded-lg px-4 py-3 text-[15px] ${clearMsg.ok ? 'bg-accent-soft text-accent' : 'bg-danger-soft text-danger'}`}>{clearMsg.text}</p>}
          </>
        )}
      </section>
    </div>
  );
}
