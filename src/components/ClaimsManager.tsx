import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { Check, Loader2, Plus, Trash2, X } from 'lucide-react';
import { db } from '../lib/firebase';
import { formatRM } from '../lib/deals';
import {
  CLAIM_FIELDS, CLAIM_STATUS_LABELS, Claim, ClaimCategory, ClaimField, ClaimLimits, ClaimSettings, ClaimStatus, LIMIT_KEYS, NO_LIMITS, claimFlags,
} from '../lib/claims';
import { approveClaim, rejectClaim, saveClaimSettings, useClaimSettings, useClaims } from '../lib/useClaims';
import { isSuperManager, superConfirm } from '../lib/superManager';
import { usePaged } from '../lib/listPaging';
import ListPager, { listSelect } from './ListPager';
import { ClaimDetails, ClaimFiles, ClaimPerson, ClaimRow, ClaimViewer, FlagList, btnPrimary, btnSecondary, input, small } from './ClaimParts';

// Management → Claims (Joel, 2026-10-28): approve or reject staff claims (never your own), see every claim, and the
// settings: categories, the boxes each asks for, limits for everyone and per person, and who may raise for others.
// Approving makes the company payment (Staff claim) for accounts in the same save (lib/useClaims.ts approveClaim).

type View = 'waiting' | 'all' | 'settings';

export default function ClaimsManager({ viewer, people, deals }: { viewer: ClaimViewer; people: ClaimPerson[]; deals: any[] }) {
  const [view, setView] = useState<View>('waiting');
  const { settings, loaded } = useClaimSettings();
  const claims = useClaims(true, '');
  const waiting = (claims || []).filter(c => c.status === 'pending');
  return (
    <div className="space-y-4 font-sans text-ink">
      <div className="inline-flex max-w-full flex-wrap rounded-xl border border-line bg-white p-1" role="tablist">
        {([['waiting', `Waiting for approval${waiting.length ? ` (${waiting.length})` : ''}`], ['all', 'All claims'], ['settings', 'Settings']] as const).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)}
            className={`rounded-lg px-4 py-1.5 text-sm font-semibold ${view === k ? 'bg-accent text-white' : 'text-ink-soft hover:text-ink'}`}>{label}</button>
        ))}
      </div>
      {view === 'settings'
        ? (loaded ? <ClaimSettingsPanel start={settings} viewer={viewer} people={people} /> : <p className="text-ink-soft">Loading…</p>)
        : <ClaimList claims={claims} waitingOnly={view === 'waiting'} settings={settings} viewer={viewer} people={people} deals={deals} />}
    </div>
  );
}

function useTouchPoints(): any[] | null {
  const [list, setList] = useState<any[] | null>(null);
  useEffect(() => onSnapshot(collection(db, 'client_touch_points'), s => setList(s.docs.map(d => ({ ...d.data(), id: d.id }))), () => setList([])), []);
  return list;
}

function ClaimList({ claims, waitingOnly, settings, viewer, people, deals }: {
  claims: Claim[] | null; waitingOnly: boolean; settings: ClaimSettings; viewer: ClaimViewer; people: ClaimPerson[]; deals: any[];
}) {
  const touchPoints = useTouchPoints();
  const [open, setOpen] = useState('');
  const [person, setPerson] = useState('');
  const [cat, setCat] = useState('');
  const [status, setStatus] = useState<'' | ClaimStatus>('');
  const [month, setMonth] = useState('');
  const all = claims || [];
  const months = useMemo(() => Array.from(new Set(all.map(c => c.date.slice(0, 7)))).sort().reverse(), [all]);
  const shown = useMemo(() => all
    .filter(c => (waitingOnly ? c.status === 'pending' : (!status || c.status === status))
      && (!person || c.memberId === person) && (!cat || c.categoryId === cat) && (!month || c.date.startsWith(month)))
    .sort((a, b) => waitingOnly ? String(a.submittedAt).localeCompare(String(b.submittedAt)) : b.date.localeCompare(a.date)),
  [all, waitingOnly, status, person, cat, month]);
  const paged = usePaged(shown, [waitingOnly, status, person, cat, month]);
  const total = shown.reduce((t, c) => t + (Number(c.amount) || 0), 0);
  const monthName = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-MY', { month: 'long', year: 'numeric' });
  const memberIds = Array.from(new Set(all.map(c => c.memberId)));

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <select value={person} onChange={e => setPerson(e.target.value)} className={listSelect} aria-label="Person">
          <option value="">Everyone</option>
          {memberIds.map(id => ({ id, name: people.find(p => p.id === id)?.name || all.find(c => c.memberId === id)?.memberName || 'Someone' }))
            .sort((a, b) => a.name.localeCompare(b.name)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={cat} onChange={e => setCat(e.target.value)} className={listSelect} aria-label="Category">
          <option value="">All categories</option>
          {settings.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {!waitingOnly && (
          <select value={status} onChange={e => setStatus(e.target.value as any)} className={listSelect} aria-label="Status">
            <option value="">Any status</option>
            {(Object.keys(CLAIM_STATUS_LABELS) as ClaimStatus[]).map(s => <option key={s} value={s}>{CLAIM_STATUS_LABELS[s]}</option>)}
          </select>
        )}
        <select value={month} onChange={e => setMonth(e.target.value)} className={listSelect} aria-label="Month">
          <option value="">All months</option>
          {months.map(m => <option key={m} value={m}>{monthName(m)}</option>)}
        </select>
        <span className="text-sm text-ink-soft">{shown.length} claim{shown.length === 1 ? '' : 's'} · <strong className="text-ink">{formatRM(total)}</strong></span>
      </div>
      {claims === null ? <p className="px-4 py-6 text-ink-soft">Loading…</p>
        : !shown.length ? <p className="px-4 py-8 text-center text-[15px] text-ink-soft">{waitingOnly ? 'No claims waiting for approval.' : 'No claims match these filters.'}</p>
        : (
          <ul className="divide-y divide-line">
            {paged.pageItems.map(c => {
              const flags = claimFlags(c, settings, all, deals, touchPoints);
              return (
                <ClaimRow key={c.id} c={c} showWho open={open === c.id} onToggle={() => setOpen(o => (o === c.id ? '' : c.id))}>
                  <FlagList flags={flags} />
                  {c.status === 'rejected' && c.rejectReason && <p className="text-sm text-danger">Rejected by {c.decidedByName}: {c.rejectReason}</p>}
                  {c.status === 'approved' && <p className="text-sm text-ink-soft">Approved by {c.decidedByName}; the payment is in Payments out.</p>}
                  <ClaimDetails c={c} />
                  <ClaimFiles files={c.files} />
                  {c.status === 'pending' && <Decide c={c} viewer={viewer} flagged={flags.length > 0} />}
                </ClaimRow>
              );
            })}
          </ul>
        )}
      {flagHint(waitingOnly)}
      <ListPager paged={paged} noun="claims" />
    </div>
  );
}

const flagHint = (waitingOnly: boolean) => waitingOnly && (
  <p className="border-t border-line px-4 py-2.5 text-sm text-ink-soft">Red and amber notes on a claim: over a limit, same receipt claimed before, sent late, no meeting with the client logged that day, or no receipt.</p>
);

/** Approve or reject. Nobody approves a claim that is theirs or that they raised. */
function Decide({ c, viewer, flagged }: { c: Claim; viewer: ClaimViewer; flagged: boolean }) {
  const own = c.memberId === viewer.id || c.raisedById === viewer.id;
  const owner = isSuperManager(viewer);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (own && !owner) return <p className="text-sm text-ink-soft">{c.memberId === viewer.id ? 'This is your own claim: the other manager approves it.' : 'You raised this claim: the other manager approves it.'}</p>;
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e: any) { setError(e?.code === 'permission-denied' ? 'The database refused this. Reload the page and try again.' : 'That did not save. Try again.'); } finally { setBusy(false); }
  };
  const approve = () => {
    if (own && !superConfirm(`approve a claim that is yours (${formatRM(c.amount)})`, 'you approve your own spending')) return;
    if (flagged && !window.confirm(`This claim has notes in red or amber. Approve ${c.memberName}'s ${c.categoryName} claim of ${formatRM(c.amount)} anyway?`)) return;
    run(() => approveClaim(c, viewer));
  };
  if (rejecting) {
    return (
      <div className="space-y-2">
        <label className={small} htmlFor={`rj-${c.id}`}>Why is it rejected? {c.memberName} sees this and can fix the claim.</label>
        <textarea id={`rj-${c.id}`} rows={2} value={reason} onChange={e => setReason(e.target.value)} className={input} placeholder="e.g. Please attach the itemised receipt, not the card slip" />
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <div className="flex gap-2">
          <button type="button" className={btnSecondary} onClick={() => setRejecting(false)}>Cancel</button>
          <button type="button" disabled={busy || reason.trim().length < 3} className={`${btnPrimary} bg-danger hover:bg-danger`} onClick={() => run(() => rejectClaim(c, viewer, reason))}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}Reject claim
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} className={btnPrimary} onClick={approve}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Approve{c.special ? ' special request' : ''}</button>
        <button type="button" disabled={busy} className={btnSecondary} onClick={() => setRejecting(true)}><X className="h-4 w-4" />Reject</button>
      </div>
      <p className="text-sm text-ink-soft">Approving sends {formatRM(c.amount)} to accounts as a company payment (Staff claim), with the receipts.</p>
    </div>
  );
}

// ---------- Settings ----------

const limitText = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
const limitVal = (s: string): number | null => (s.trim() === '' || !(Number(s) >= 0) ? null : Math.round(Number(s) * 100) / 100);

function ClaimSettingsPanel({ start, viewer, people }: { start: ClaimSettings; viewer: ClaimViewer; people: ClaimPerson[] }) {
  const [s, setS] = useState<ClaimSettings>(start);
  const [catId, setCatId] = useState(start.categories[0]?.id || '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const changed = JSON.stringify(s) !== JSON.stringify(start);
  const cat = s.categories.find(c => c.id === catId);
  const setCat = (ch: Partial<ClaimCategory>) => setS(x => ({ ...x, categories: x.categories.map(c => (c.id === catId ? { ...c, ...ch } : c)) }));
  const staff = people.filter(p => p.role !== 'accounts').sort((a, b) => a.name.localeCompare(b.name));

  const save = async () => {
    if (s.categories.some(c => !c.name.trim())) return setMsg({ ok: false, text: 'Every category needs a name.' });
    setBusy(true); setMsg(null);
    try { await saveClaimSettings({ ...s, categories: s.categories.map(c => ({ ...c, name: c.name.trim() })) }, viewer); setMsg({ ok: true, text: 'Saved.' }); }
    catch { setMsg({ ok: false, text: 'The settings did not save. Try again.' }); }
    finally { setBusy(false); }
  };
  const addCat = () => {
    const id = `cat_${Date.now().toString(36)}`;
    setS(x => ({ ...x, categories: [...x.categories, { id, name: 'New category', active: true, receiptNeeded: true, submitDays: 30, limits: { ...NO_LIMITS }, fields: { description: 'required' } }] }));
    setCatId(id);
  };
  const setNeed = (k: ClaimField, v: '' | 'required' | 'optional') => {
    if (!cat) return;
    const fields = { ...cat.fields };
    if (v) fields[k] = v; else delete fields[k];
    setCat({ fields });
  };
  const setPerson = (pid: string, key: keyof ClaimLimits, v: string) => setS(x => {
    const byCat = { ...(x.personLimits[pid] || {}) };
    const one = { ...(byCat[catId] || {}) };
    const n = limitVal(v);
    if (n === null) delete one[key]; else one[key] = n;
    if (Object.keys(one).length) byCat[catId] = one; else delete byCat[catId];
    const personLimits = { ...x.personLimits };
    if (Object.keys(byCat).length) personLimits[pid] = byCat; else delete personLimits[pid];
    return { ...x, personLimits };
  });
  const showKeys = LIMIT_KEYS.filter(k => k.key !== 'perHead' || cat?.fields.attendees);

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-2xl border border-line bg-white p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="min-w-0 flex-1 text-lg font-bold">Categories</h3>
          <button type="button" className={btnSecondary} onClick={addCat}><Plus className="h-4 w-4" /> Add category</button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {s.categories.map(c => (
            <button key={c.id} type="button" onClick={() => setCatId(c.id)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${c.id === catId ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-white text-ink'} ${c.active ? '' : 'opacity-60'}`}>
              {c.name || 'No name'}{c.active ? '' : ' (off)'}
            </button>
          ))}
        </div>

        {cat && (
          <div className="space-y-4 rounded-xl border border-line bg-surface p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className={small} htmlFor="cs-name">Name</label><input id="cs-name" value={cat.name} onChange={e => setCat({ name: e.target.value })} className={input} /></div>
              <div>
                <label className={small} htmlFor="cs-days">Submit within (days after the spend)</label>
                <input id="cs-days" inputMode="numeric" value={cat.submitDays === null ? '' : String(cat.submitDays)} placeholder="No limit"
                  onChange={e => setCat({ submitDays: e.target.value.trim() === '' ? null : Math.max(0, Math.round(Number(e.target.value.replace(/[^0-9]/g, '')) || 0)) })} className={input} />
                <span className="mt-0.5 block text-xs text-ink-soft">Later claims can still be sent; the approver sees a note.</span>
              </div>
              <label className="flex items-center gap-2 text-[15px]"><input type="checkbox" checked={cat.active} onChange={e => setCat({ active: e.target.checked })} className="h-4 w-4 accent-accent" /> In use (untick to hide it from new claims)</label>
              <label className="flex items-center gap-2 text-[15px]"><input type="checkbox" checked={cat.receiptNeeded} onChange={e => setCat({ receiptNeeded: e.target.checked })} className="h-4 w-4 accent-accent" /> Receipt must be attached</label>
            </div>

            <div>
              <p className="mb-1 text-sm font-semibold">Boxes this category asks for</p>
              <p className="mb-2 text-sm text-ink-soft">Every claim always has date, amount, receipt / e-Invoice no., UUID, SST, notes, pay to and files.</p>
              <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
                {CLAIM_FIELDS.map(fl => (
                  <label key={fl.key} className="flex items-center gap-2 text-[15px]">
                    <select value={cat.fields[fl.key] || ''} onChange={e => setNeed(fl.key, e.target.value as any)} className={`${listSelect} w-32 shrink-0 py-1`} aria-label={fl.label}>
                      <option value="">Not asked</option><option value="required">Required</option><option value="optional">Optional</option>
                    </select>
                    <span className="min-w-0">{fl.label}{fl.hint && <span className="block text-xs text-ink-soft">{fl.hint}</span>}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-1 text-sm font-semibold">Limits (RM) for {cat.name || 'this category'}</p>
              <p className="mb-2 text-sm text-ink-soft">Blank = no limit. A person's own limit replaces the one for everyone; blank uses everyone's. Over a limit, the claim becomes a special request with a reason.</p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[34rem] text-sm">
                  <thead><tr className="text-left text-ink-soft"><th className="py-1.5 pr-2 font-medium">Who</th>{showKeys.map(k => <th key={k.key} className="px-1 py-1.5 font-medium">{k.label}</th>)}</tr></thead>
                  <tbody className="divide-y divide-line">
                    <tr className="bg-white">
                      <td className="py-1.5 pr-2 font-semibold">Everyone</td>
                      {showKeys.map(k => (
                        <td key={k.key} className="px-1 py-1.5"><input inputMode="decimal" value={limitText(cat.limits[k.key])} placeholder="No limit" aria-label={`${k.label} for everyone`}
                          onChange={e => setCat({ limits: { ...cat.limits, [k.key]: limitVal(e.target.value.replace(/[^0-9.]/g, '')) } })} className={`${input} py-1`} /></td>
                      ))}
                    </tr>
                    {staff.map(p => {
                      const own = s.personLimits[p.id]?.[cat.id] || {};
                      return (
                        <tr key={p.id}>
                          <td className="py-1.5 pr-2">{p.name}</td>
                          {showKeys.map(k => (
                            <td key={k.key} className="px-1 py-1.5"><input inputMode="decimal" value={limitText(own[k.key])} placeholder={limitText(cat.limits[k.key]) || 'No limit'} aria-label={`${k.label} for ${p.name}`}
                              onChange={e => setPerson(p.id, k.key, e.target.value.replace(/[^0-9.]/g, ''))} className={`${input} py-1`} /></td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {!['medical', 'travel', 'sales', 'benefit', 'other'].includes(cat.id) && (
              <button type="button" className={`${btnSecondary} text-danger`} onClick={() => {
                if (!window.confirm(`Delete the category "${cat.name}"? Claims already made keep their category name. To keep it but stop new claims, untick "In use" instead.`)) return;
                setS(x => ({ ...x, categories: x.categories.filter(c => c.id !== cat.id) }));
                setCatId(s.categories.find(c => c.id !== cat.id)?.id || '');
              }}><Trash2 className="h-4 w-4" /> Delete category</button>
            )}
          </div>
        )}
      </section>

      <section className="space-y-2 rounded-2xl border border-line bg-white p-5">
        <h3 className="text-lg font-bold">Raise claims for someone else</h3>
        <p className="text-sm text-ink-soft">Everyone raises their own claims. Tick who may also raise a claim for another person (for example Admin keying in a receipt handed to them). Management always may.</p>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {staff.filter(p => p.role !== 'management').map(p => (
            <label key={p.id} className="flex items-center gap-2 text-[15px]">
              <input type="checkbox" checked={s.raiseForOthers.includes(p.id)} className="h-4 w-4 accent-accent"
                onChange={e => setS(x => ({ ...x, raiseForOthers: e.target.checked ? [...x.raiseForOthers, p.id] : x.raiseForOthers.filter(i => i !== p.id) }))} />
              {p.name}
            </label>
          ))}
        </div>
      </section>

      <div className="sticky bottom-3 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-white p-3 shadow-sm">
        <button type="button" className={btnPrimary} disabled={busy || !changed} onClick={save}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save settings</button>
        {changed && <button type="button" className={btnSecondary} onClick={() => { setS(start); setMsg(null); }}>Undo changes</button>}
        {msg && <span role="status" className={`text-sm ${msg.ok ? 'text-accent' : 'text-danger'}`}>{msg.text}</span>}
        {!changed && !msg && <span className="text-sm text-ink-soft">No changes.</span>}
      </div>
    </div>
  );
}
