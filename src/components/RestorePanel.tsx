import React, { useEffect, useState } from 'react';
import { ArrowLeft, History, Loader2, RotateCcw, Save, Search, Undo2 } from 'lucide-react';
import { friendlyError } from '../lib/firebase';
import { FieldDiff, PITR_DAYS, RecordRow, RecordStatus, RestoreSource, STATUS_LABELS } from '../lib/restore';
import {
  RestoreList, RestoreLogItem, RestorePoints, applyRestore, restoreHistory, restoreLists, restorePoints, restoreRecord,
  restoreRecords, saveCopyNow, saveKeepDays, undoRestore,
} from '../lib/restoreApi';

// Private room → Restore (2026-10-24): go back to a saved daily copy or any minute in the last 7 days, see what
// changed since, and put back one record, a whole list or every list. Every restore can be undone. Owner only.

const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';
const btnDanger =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-danger/40 bg-white px-3 py-2 text-sm font-semibold text-danger transition-colors hover:bg-danger-soft disabled:opacity-60';
const input = 'rounded-lg border border-line bg-white px-3 py-2 text-[15px] focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';

const STATUS_STYLE: Record<RecordStatus, string> = {
  changed: 'bg-attention-soft text-attention',
  gone: 'bg-danger-soft text-danger',
  added: 'bg-accent-soft text-accent',
  same: 'bg-surface text-ink-soft',
};

const when = (ms: number) => new Date(ms).toLocaleString('en-MY', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const localInput = (ms: number) => {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
};
const twice = (first: string, second: string) => window.confirm(first) && window.confirm(second);

export default function RestorePanel() {
  const [points, setPoints] = useState<RestorePoints | null>(null);
  const [mode, setMode] = useState<'copy' | 'time'>('copy');
  const [copyName, setCopyName] = useState('');
  const [timeText, setTimeText] = useState(() => localInput(Date.now() - 3600000));
  const [source, setSource] = useState<RestoreSource | null>(null);
  const [label, setLabel] = useState('');
  const [lists, setLists] = useState<RestoreList[] | null>(null);
  const [list, setList] = useState<RestoreList | null>(null);
  const [search, setSearch] = useState('');
  const [showSame, setShowSame] = useState(false);
  const [rows, setRows] = useState<{ rows: RecordRow[]; more: number } | null>(null);
  const [openId, setOpenId] = useState('');
  const [detail, setDetail] = useState<{ label: string; existedThen: boolean; existsNow: boolean; fields: FieldDiff[] } | null>(null);
  const [history, setHistory] = useState<RestoreLogItem[]>([]);
  const [keepDays, setKeepDays] = useState('');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const loadPoints = async () => {
    try {
      const p = await restorePoints();
      setPoints(p);
      setKeepDays(String(p.keepDays));
      setCopyName(n => n || p.copies[0]?.name || '');
    } catch (err) { setError(friendlyError(err)); }
  };
  const loadHistory = async () => {
    try { setHistory((await restoreHistory()).items); } catch { /* shown elsewhere */ }
  };
  useEffect(() => { loadPoints(); loadHistory(); }, []);

  const act = async (kind: string, fn: () => Promise<string | void>) => {
    setBusy(kind); setNote(''); setError('');
    try {
      const msg = await fn();
      if (msg) setNote(msg);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy('');
    }
  };

  const pickedSource = (): RestoreSource | null => {
    if (mode === 'copy') return copyName ? { kind: 'copy', name: copyName } : null;
    const at = new Date(timeText).getTime();
    return Number.isFinite(at) ? { kind: 'time', at } : null;
  };

  const showChanges = () => act('lists', async () => {
    const s = pickedSource();
    if (!s) throw new Error(mode === 'copy' ? 'Pick a saved copy.' : 'Pick a date and time.');
    const r = await restoreLists(s);
    setSource(s); setLabel(r.label); setLists(r.lists); setList(null); setRows(null); setOpenId(''); setDetail(null);
  });

  const loadRows = (l: RestoreList, q = search, same = showSame) => act('rows', async () => {
    if (!source) return;
    setList(l); setOpenId(''); setDetail(null);
    setRows(await restoreRecords(source, l.id, q, same));
  });

  const openRow = (id: string) => {
    if (openId === id) { setOpenId(''); setDetail(null); return; }
    setOpenId(id); setDetail(null);
    act('detail', async () => { if (source && list) setDetail(await restoreRecord(source, list.id, id)); });
  };

  const done = (r: { put: number; removed: number; note?: string }) =>
    r.note || `Done: ${r.put} record${r.put === 1 ? '' : 's'} put back${r.removed ? `, ${r.removed} removed` : ''}. You can undo it under Restore history.`;

  const restoreOne = (row: RecordRow) => {
    if (!source || !list) return;
    const what = row.status === 'added' ? `remove "${row.label}" (it didn't exist ${label})` : `put "${row.label}" back to how it was (${label})`;
    if (!twice(`Restore: ${what}?`, 'Please confirm once more. The record as it is now is saved first, so you can undo this.')) return;
    act('apply', async () => {
      const r = await applyRestore(source, list.id, [row.id]);
      await loadHistory();
      setRows(await restoreRecords(source, list.id, search, showSame));
      setOpenId(''); setDetail(null);
      return done(r);
    });
  };

  const restoreList = (l: RestoreList) => {
    if (!source) return;
    if (!twice(`Restore the whole of "${l.name}" to the ${label}?\n\n${l.changed} changed records go back, ${l.gone} deleted records come back, ${l.added} records added since are removed.`,
      'Please confirm once more. Everything changed is saved first, so you can undo this.')) return;
    act('apply', async () => {
      const r = await applyRestore(source, l.id);
      await loadHistory();
      const fresh = await restoreLists(source);
      setLists(fresh.lists);
      if (list) setRows(await restoreRecords(source, list.id, search, showSame));
      return done(r);
    });
  };

  const restoreAll = () => {
    if (!source || !lists) return;
    const changes = lists.reduce((n, l) => n + l.changed + l.gone + l.added, 0);
    if (!twice(`Put the WHOLE CRM back to the ${label}?\n\n${changes} records in ${lists.filter(l => l.changed + l.gone + l.added).length} lists will change. Logins, passwords, the team list and the login log are not touched.`,
      'This is the biggest restore there is. Everything changed is saved first, so you can undo it. Go ahead?')) return;
    act('apply', async () => {
      const r = await applyRestore(source, '*');
      await loadHistory();
      setLists((await restoreLists(source)).lists); setList(null); setRows(null);
      return done(r);
    });
  };

  const undo = (item: RestoreLogItem) => {
    if (!window.confirm(`Undo "${item.what}" (${when(item.at)})? The records go back to how they were just before it.`)) return;
    act('undo', async () => {
      await undoRestore(item.id);
      await loadHistory();
      if (source) setLists((await restoreLists(source)).lists);
      if (source && list) setRows(await restoreRecords(source, list.id, search, showSame));
      return 'Undone.';
    });
  };

  const minTime = localInput(Date.now() - PITR_DAYS * 86400000 + 120000);
  const maxTime = localInput(Date.now());
  const withChanges = (lists || []).filter(l => l.changed + l.gone + l.added > 0);
  const unchanged = (lists || []).length - withChanges.length;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-white p-5">
        <h3 className="text-lg font-bold">Restore</h3>
        <p className="mt-1 text-[15px] text-ink-soft">
          Go back in time: see what changed since, then put back one record, a whole list or the whole CRM.
          Logins, passwords, the team list and the login log are never touched. Uploaded files aren't included.
        </p>

        <div className="mt-4 inline-flex rounded-xl border border-line bg-surface p-1" role="tablist">
          {([['copy', 'A saved daily copy'], ['time', `An exact time (last ${PITR_DAYS} days)`]] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={mode === k} onClick={() => setMode(k)}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${mode === k ? 'bg-white text-ink shadow-sm' : 'text-ink-soft hover:text-ink'}`}>
              {l}
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {mode === 'copy' ? (
            points && !points.copies.length ? (
              <p className="text-sm text-ink-soft">No saved copies yet. The first is made today; or click "Save a copy now" below.</p>
            ) : (
              <select value={copyName} onChange={e => setCopyName(e.target.value)} className={`${input} min-w-[16rem]`} aria-label="Saved copy">
                {(points?.copies || []).map(c => <option key={c.name} value={c.name}>{when(c.at)}</option>)}
              </select>
            )
          ) : (
            <input type="datetime-local" value={timeText} min={minTime} max={maxTime} onChange={e => setTimeText(e.target.value)}
              className={input} aria-label="Date and time" />
          )}
          <button type="button" className={btnPrimary} disabled={!!busy || (mode === 'copy' && !copyName)} onClick={showChanges}>
            {busy === 'lists' ? <Loader2 className="h-4 w-4 animate-spin" /> : <History className="h-4 w-4" />} Show what changed
          </button>
        </div>
        {mode === 'time' && <p className="mt-2 text-sm text-ink-soft">Google keeps every minute of the last {PITR_DAYS} days, counted from when it was switched on.</p>}

        {note && <p className="mt-3 text-sm text-accent">{note}</p>}
        {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      </div>

      {lists && !list && (
        <div className="rounded-xl border border-line bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-bold">What changed since the {label}</h3>
              <p className="mt-0.5 text-sm text-ink-soft">
                {withChanges.length ? `${withChanges.length} lists changed${unchanged ? `; ${unchanged} are the same as now` : ''}. Click a list to see its records.` : 'Nothing changed: the CRM is the same as then.'}
              </p>
            </div>
            {withChanges.length > 0 && (
              <button type="button" className={btnDanger} disabled={!!busy} onClick={restoreAll}>
                <RotateCcw className="h-4 w-4" /> Put the whole CRM back
              </button>
            )}
          </div>
          {withChanges.length > 0 && (
            <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
              {withChanges.map(l => (
                <li key={l.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                  <button type="button" onClick={() => loadRows(l, '', false)} className="min-w-0 flex-1 text-left">
                    <span className="block font-semibold text-ink hover:text-accent">{l.name}</span>
                    <span className="block text-sm text-ink-soft">
                      {[l.changed && `${l.changed} changed`, l.gone && `${l.gone} deleted since`, l.added && `${l.added} added since`].filter(Boolean).join(' · ')}
                    </span>
                  </button>
                  <button type="button" className={btnSecondary} disabled={!!busy} onClick={() => restoreList(l)}>Restore whole list</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {list && (
        <div className="rounded-xl border border-line bg-white p-5">
          <button type="button" onClick={() => { setList(null); setRows(null); setSearch(''); }} className="inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline">
            <ArrowLeft className="h-4 w-4" /> All lists
          </button>
          <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-bold">{list.name}</h3>
              <p className="mt-0.5 text-sm text-ink-soft">Compared with the {label}. Click a record to see it field by field.</p>
            </div>
            <button type="button" className={btnDanger} disabled={!!busy} onClick={() => restoreList(list)}>
              <RotateCcw className="h-4 w-4" /> Restore whole list
            </button>
          </div>
          <form className="mt-3 flex flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault(); loadRows(list); }}>
            <div className="relative min-w-[14rem] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name" className={`${input} w-full pl-9`} aria-label="Search records" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={showSame} onChange={e => { setShowSame(e.target.checked); loadRows(list, search, e.target.checked); }} className="h-4 w-4 accent-[#0E6E62]" />
              Show unchanged too
            </label>
            <button type="submit" className={btnSecondary} disabled={!!busy}>Search</button>
          </form>
          {busy === 'rows' && !rows ? <p className="mt-3 text-sm text-ink-soft">Loading…</p> : rows && (
            rows.rows.length ? (
              <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
                {rows.rows.map(r => (
                  <li key={r.id}>
                    <button type="button" onClick={() => openRow(r.id)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-surface">
                      <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{r.label}</span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[r.status]}`}>{STATUS_LABELS[r.status]}</span>
                    </button>
                    {openId === r.id && (
                      <div className="border-t border-line bg-surface px-3 py-3">
                        {!detail ? <p className="text-sm text-ink-soft">Loading…</p> : (
                          <>
                            <div className="max-h-80 overflow-auto rounded-lg border border-line bg-white">
                              <table className="w-full text-left text-sm">
                                <thead className="sticky top-0 bg-white text-ink-soft">
                                  <tr><th className="px-2 py-1.5 font-semibold">Field</th><th className="px-2 py-1.5 font-semibold">Then</th><th className="px-2 py-1.5 font-semibold">Now</th></tr>
                                </thead>
                                <tbody>
                                  {detail.fields.map(f => (
                                    <tr key={f.field} className={`border-t border-line align-top ${f.changed ? 'bg-attention-soft' : ''}`}>
                                      <td className="px-2 py-1.5 font-medium">{f.field}</td>
                                      <td className="break-all px-2 py-1.5">{detail.existedThen ? f.then : '—'}</td>
                                      <td className="break-all px-2 py-1.5">{detail.existsNow ? f.now : '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            {r.status !== 'same' && (
                              <button type="button" className={`${btnPrimary} mt-3`} disabled={!!busy} onClick={() => restoreOne(r)}>
                                {busy === 'apply' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                                {r.status === 'added' ? "Remove it (it didn't exist then)" : r.status === 'gone' ? 'Bring this record back' : 'Put this record back'}
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : <p className="mt-3 text-sm text-ink-soft">No records{search ? ' match' : ' changed'}.</p>
          )}
          {rows && rows.more > 0 && <p className="mt-2 text-sm text-ink-soft">{rows.more} more: search to narrow it down.</p>}
        </div>
      )}

      <div className="rounded-xl border border-line bg-white p-5">
        <h3 className="font-bold">Restore history</h3>
        {!history.length ? <p className="mt-1 text-sm text-ink-soft">No restores yet.</p> : (
          <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
            {history.map(h => (
              <li key={h.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-medium">{h.what}</p>
                  <p className="text-sm text-ink-soft">
                    {when(h.at)} · to the {h.source} · {h.put} put back{h.removed ? `, ${h.removed} removed` : ''}
                    {h.undone ? ` · undone${h.undoneAt ? ` ${when(h.undoneAt)}` : ''}` : ''}
                  </p>
                </div>
                {!h.undone && (
                  <button type="button" className={btnSecondary} disabled={!!busy} onClick={() => undo(h)}>
                    {busy === 'undo' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />} Undo
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-xl border border-line bg-white p-5">
        <h3 className="font-bold">Saved daily copies</h3>
        <p className="mt-1 text-[15px] text-ink-soft">
          A full copy of the CRM is saved once a day (the first time Admin or Management opens it), in Firebase Storage.
          {points ? ` ${points.copies.length} ${points.copies.length === 1 ? 'copy' : 'copies'} kept.` : ''}
          {points?.lastCopyAt ? ` Last one ${when(points.lastCopyAt)}.` : ''}
        </p>
        {points?.storageError && <p role="alert" className="mt-2 text-sm text-danger">{points.storageError}</p>}
        {points?.copyError && (points.copyErrorAt || 0) > (points.lastCopyAt || 0) && <p role="alert" className="mt-2 text-sm text-danger">Last daily copy failed: {points.copyError}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label htmlFor="keep-days" className="text-sm font-medium">Keep copies for</label>
          <input id="keep-days" type="number" min={30} max={3650} value={keepDays} onChange={e => setKeepDays(e.target.value)} className={`${input} w-24`} />
          <span className="text-sm text-ink-soft">days</span>
          <button type="button" className={btnSecondary} disabled={!!busy || !keepDays} onClick={() => act('keep', async () => {
            const r = await saveKeepDays(Number(keepDays));
            await loadPoints();
            return `Saved: copies are kept for ${r.keepDays} days.`;
          })}>Save</button>
          <button type="button" className={btnSecondary} disabled={!!busy} onClick={() => act('copy', async () => {
            const r = await saveCopyNow();
            await loadPoints();
            setCopyName(r.name);
            return `Copy saved (${r.records} records).`;
          })}>
            {busy === 'copy' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save a copy now
          </button>
        </div>
      </div>
    </div>
  );
}
