import React, { useEffect, useRef, useState } from 'react';
import { collection, doc, onSnapshot, setDoc, updateDoc } from 'firebase/firestore';
import { Loader2, Plus, Search, Trash2 } from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import { dealValue, formatRM } from '../lib/deals';
import { GrantEmployer, approvedTotal, employerLabel, lineMissing, valueGap } from '../lib/grantEmployers';
import { useCloseOnOutside } from '../lib/useCloseOnOutside';

// Several employers claiming for one training (Joel, 2026-10-27), on the Grant approved step: each employer is a
// client from the client list (its name and Employer code are kept there for its next deals); the Approval code and
// approved amount are this training's. Logic: lib/grantEmployers.ts.

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';
const small = 'mb-1 block text-sm font-medium text-ink-soft';

/** The client list, read only while it's needed (enabled). */
export function useClientList(enabled: boolean): any[] {
  const [clients, setClients] = useState<any[]>([]);
  useEffect(() => {
    if (!enabled) { setClients([]); return; }
    return onSnapshot(collection(db, 'clients'), s => setClients(s.docs.map(d => ({ ...d.data(), id: d.id }))), () => setClients([]));
  }, [enabled]);
  return clients;
}
export const byId = (clients: any[]) => Object.fromEntries(clients.map(c => [c.id, c])) as Record<string, any>;

/** Read-only: the employers with their codes and approved amounts. */
export function EmployerList({ list, clients }: { list: GrantEmployer[]; clients: Record<string, any> }) {
  return (
    <ul className="mt-1 space-y-0.5 text-sm text-ink-soft">
      {list.map(e => {
        const c = clients[e.clientId];
        return (
          <li key={e.id}>
            <span className="font-semibold text-ink">{employerLabel(c)}</span>
            {' · '}Employer code <strong className="font-mono text-ink">{String(c?.employerCode || '').trim() || '—'}</strong>
            {' · '}Approval code <strong className="font-mono text-ink">{String(e.approvalCode || '').trim() || '—'}</strong>
            {Number(e.approvedAmount) > 0 && <> · {formatRM(Number(e.approvedAmount))}</>}
          </li>
        );
      })}
    </ul>
  );
}

/** Edit the employers on Grant approved. onChange saves the list on the step (an empty list = back to one employer). */
export function EmployersEditor({ deal, list, clients, viewer, busy, onChange, onLog }: {
  deal: any; list: GrantEmployer[]; clients: any[]; viewer: Viewer; busy: boolean;
  onChange: (next: GrantEmployer[], action: string) => void; onLog: (action: string) => void;
}) {
  const map = byId(clients);
  const [error, setError] = useState('');
  const total = approvedTotal(list);
  const value = dealValue(deal);
  const gap = valueGap(list, value);
  const setLine = (id: string, changes: Partial<GrantEmployer>, action: string) =>
    onChange(list.map(e => (e.id === id ? { ...e, ...changes } : e)), action);
  const saveEmployerCode = async (clientId: string, code: string) => {
    setError('');
    try {
      await updateDoc(doc(db, 'clients', clientId), { employerCode: code });
      onLog(`Grant approved: employer code of ${employerLabel(map[clientId])} ${code ? `set to ${code}` : 'cleared'} (saved on the client)`);
    } catch (err) {
      setError(friendlyError(err));
    }
  };
  const add = (clientId: string) => {
    if (list.some(e => e.clientId === clientId)) return setError(`${employerLabel(map[clientId])} is already on the list.`);
    setError('');
    onChange([...list, { id: `emp_${Date.now()}`, clientId }], `Grant approved: employer ${employerLabel(map[clientId])} added`);
  };
  const remove = (e: GrantEmployer) => {
    const name = employerLabel(map[e.clientId]);
    const last = list.length === 1;
    if (!window.confirm(last ? `Remove ${name}? The deal goes back to one employer (the deal's client).` : `Remove ${name} from the employers claiming?`)) return;
    onChange(list.filter(x => x.id !== e.id), `Grant approved: employer ${name} removed${last ? ', back to one employer' : ''}`);
  };

  return (
    <div className="mt-3 space-y-2">
      <p className="text-sm font-semibold">Employers claiming for this training</p>
      <p className="text-sm text-ink-soft">One training, one costing: each employer gets its own HRDC approval and claim. Employer names and codes are kept on the client list for their next deals.</p>
      <ul className="space-y-2">
        {list.map((e, i) => {
          const c = map[e.clientId];
          const miss = lineMissing(e, c);
          return (
            <li key={e.id} className="rounded-lg border border-line bg-white p-3">
              <div className="flex items-start gap-2">
                <p className="min-w-0 flex-1 font-semibold">{i + 1}. {employerLabel(c)}
                  {c && String(c.employerName || '').trim() && c.companyName && <span className="block text-sm font-normal text-ink-soft">{c.companyName}</span>}
                </p>
                <button type="button" disabled={busy} className="rounded-md p-1.5 text-ink-soft hover:bg-surface hover:text-danger" onClick={() => remove(e)} aria-label={`Remove ${employerLabel(c)}`}><Trash2 className="h-4 w-4" /></button>
              </div>
              <div className="mt-2 grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-2">
                <SaveBox id={`ec-${e.id}`} label="Employer code" value={String(c?.employerCode || '').trim()} busy={busy || !c} mono
                  onSave={v => saveEmployerCode(e.clientId, v)} />
                <SaveBox id={`ac-${e.id}`} label="Approval code" value={String(e.approvalCode || '').trim()} busy={busy} mono
                  onSave={v => setLine(e.id, { approvalCode: v }, `Grant approved: approval code of ${employerLabel(c)} ${v ? `set to ${v}` : 'cleared'}`)} />
                <SaveBox id={`aa-${e.id}`} label="Approved (RM)" value={Number(e.approvedAmount) > 0 ? String(e.approvedAmount) : ''} busy={busy} money
                  onSave={v => { const n = Math.round(Number(v) * 100) / 100; setLine(e.id, { approvedAmount: n > 0 ? n : 0 }, `Grant approved: approved amount of ${employerLabel(c)} ${n > 0 ? `set to ${formatRM(n)}` : 'cleared'}`); }} />
              </div>
              {miss && <p className="mt-1 text-sm text-attention">Still to fill in: {miss}</p>}
            </li>
          );
        })}
      </ul>
      <EmployerPicker clients={clients} taken={list.map(e => e.clientId)} viewer={viewer} busy={busy} onPick={add} />
      {list.length > 0 && (
        <p className="text-sm text-ink-soft">
          Total approved <strong className="text-ink">{formatRM(total)}</strong> for {list.length} employer{list.length === 1 ? '' : 's'}{value > 0 && <> · deal value <strong className="text-ink">{formatRM(value)}</strong></>}
        </p>
      )}
      {gap !== 0 && (
        <p className="rounded-lg bg-attention-soft px-3 py-2 text-sm font-semibold text-attention">
          The approved amounts add up to {formatRM(Math.abs(gap))} {gap > 0 ? 'more' : 'less'} than the deal value. If the deal value should change, ask for it with "Change value / pax" on the deal (a manager approves it).
        </p>
      )}
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
    </div>
  );
}

// A box saved when you leave it or press Enter.
function SaveBox({ id, label, value, busy, onSave, mono, money }: {
  id: string; label: string; value: string; busy: boolean; onSave: (v: string) => void; mono?: boolean; money?: boolean;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => { const next = v.trim(); if (next !== value) onSave(next); };
  return (
    <div>
      <label className={small} htmlFor={id}>{label}</label>
      <input id={id} value={v} disabled={busy} inputMode={money ? 'decimal' : undefined}
        onChange={e => setV(money ? e.target.value.replace(/[^0-9.]/g, '') : e.target.value)} onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }} className={`${input} ${mono ? 'font-mono' : ''}`} />
    </div>
  );
}

// Pick an employer from the client list, or add it there (company name, employer name, employer code).
function EmployerPicker({ clients, taken, viewer, busy, onPick }: {
  clients: any[]; taken: string[]; viewer: Viewer; busy: boolean; onPick: (clientId: string) => void;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  useCloseOnOutside(boxRef, open, () => setOpen(false));
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ companyName: '', employerName: '', employerCode: '' });
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const text = q.trim().toLowerCase();
  const matches = clients
    .filter(c => !taken.includes(c.id) && (!text || `${c.companyName || ''} ${c.employerName || ''} ${c.employerCode || ''}`.toLowerCase().includes(text)))
    .sort((a, b) => String(a.companyName).localeCompare(String(b.companyName)))
    .slice(0, 8);

  const save = async () => {
    setErr('');
    const name = f.companyName.trim();
    if (!name) return setErr('Enter the company name.');
    const dup = clients.find(c => String(c.companyName || '').trim().toLowerCase() === name.toLowerCase());
    if (dup) { onPick(dup.id); setAdding(false); setQ(''); return; }
    setSaving(true);
    try {
      const id = `client_${Date.now()}`;
      await setDoc(doc(db, 'clients', id), {
        id, companyName: name, employerName: f.employerName.trim(), employerCode: f.employerCode.trim(), contactName: '', designation: '', phone: '',
        email: '', address: '', industry: '', hrdcRegistered: true, notes: '',
        createdAt: Date.now(), createdBy: viewer.id, createdByName: viewer.name,
      });
      onPick(id);
      setAdding(false);
      setQ('');
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setSaving(false);
    }
  };

  if (adding) {
    return (
      <div className="space-y-3 rounded-xl border border-line bg-surface p-4">
        <p className="text-sm font-semibold">New employer (added to the client list)</p>
        <input value={f.companyName} onChange={e => setF(x => ({ ...x, companyName: e.target.value }))} className={input} placeholder="Company name" aria-label="Company name" />
        <div className="grid gap-3 sm:grid-cols-2">
          <input value={f.employerName} onChange={e => setF(x => ({ ...x, employerName: e.target.value }))} className={input} placeholder="Employer name at HRD Corp (if different)" aria-label="Employer name" />
          <input value={f.employerCode} onChange={e => setF(x => ({ ...x, employerCode: e.target.value }))} className={`${input} font-mono`} placeholder="Employer code" aria-label="Employer code" />
        </div>
        <p className="text-sm text-ink-soft">Address and contact can be added later in the client list.</p>
        {err && <p role="alert" className="text-sm text-danger">{err}</p>}
        <div className="flex gap-2">
          <button type="button" className={btnSecondary} onClick={() => setAdding(false)}>Cancel</button>
          <button type="button" disabled={saving} className={btnPrimary} onClick={save}>{saving && <Loader2 className="h-4 w-4 animate-spin" />}Add employer</button>
        </div>
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative">
      <Search className="pointer-events-none absolute left-3 top-[19px] h-4 w-4 -translate-y-1/2 text-ink-soft" />
      <input value={q} disabled={busy} onChange={e => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        className={`${input} pl-9`} placeholder="Add an employer: search the client list" aria-label="Add an employer from the client list" />
      {open && (
        <div className="mt-1 overflow-hidden rounded-lg border border-line bg-white shadow-lg">
          {matches.map(c => (
            <button key={c.id} type="button" onClick={() => { onPick(c.id); setOpen(false); setQ(''); }} className="block w-full px-3 py-2 text-left hover:bg-surface">
              <span className="block text-sm font-semibold">{c.companyName}</span>
              {(c.employerName || c.employerCode) && <span className="block text-sm text-ink-soft">{[c.employerName, c.employerCode].filter(Boolean).join(' · ')}</span>}
            </button>
          ))}
          {matches.length === 0 && <p className="px-3 py-2 text-sm text-ink-soft">No client matches "{q}".</p>}
          <button type="button" onClick={() => { setF({ companyName: q.trim(), employerName: '', employerCode: '' }); setErr(''); setAdding(true); setOpen(false); }}
            className="flex w-full items-center gap-2 border-t border-line px-3 py-2.5 text-left text-sm font-semibold text-accent hover:bg-accent-soft">
            <Plus className="h-4 w-4" /> Add {q.trim() ? `"${q.trim()}"` : 'a new employer'} to the client list
          </button>
        </div>
      )}
    </div>
  );
}
