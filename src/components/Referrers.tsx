import React, { useEffect, useMemo, useState } from 'react';
import { collection, deleteDoc, doc, getDoc, onSnapshot, query, setDoc, updateDoc } from 'firebase/firestore';
import { CheckCircle2, Copy, Link2, Loader2, MessageCircle, Pencil, Plus, Trash2, X } from 'lucide-react';
import { callServer, db, friendlyError } from '../lib/firebase';
import { dealStage, formatRM } from '../lib/deals';
import { withoutDeleted } from '../lib/linked';
import {
  LINK_STATUS_LABELS, Referrer, ReferralFeeType, ReferrerSubmission, referralFee, referralFeeText, referrerLinkUrl,
} from '../lib/referrers';
import { bankChecked, bankText, hasBank } from '../lib/vendors';
import { useVendors } from './VendorsPage';

// Referrers (Joel, 2026-10-24; lib/referrers.ts): the "Referred by" box on the deal form, the referrer line on the deal
// (with "Send link" for their bank details) and Admin work → Referrers (Admin and Management).

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const label = 'mb-1.5 block text-sm font-semibold text-ink';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';

const norm = (s?: string) => (s || '').trim().toLowerCase();

// Malaysian numbers: 012-345 6789 -> 60123456789 for WhatsApp.
function whatsappTo(phone?: string): string {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.startsWith('0')) d = '6' + d;
  return d.length >= 9 ? d : '';
}

/** Every referrer, A to Z, live. Every team member reads the names. */
export function useReferrers(): Referrer[] {
  const [list, setList] = useState<Referrer[]>([]);
  useEffect(() => onSnapshot(query(collection(db, 'referrers')),
    s => setList(s.docs.map(d => ({ ...(d.data() as Referrer), id: d.id })).sort((a, b) => (a.name || '').localeCompare(b.name || ''))),
    () => setList([])), []);
  return list;
}

/** Adds a referrer by name and phone (anyone may; only Admin and Management change them later). */
async function addReferrer(name: string, phone: string, viewer: Viewer): Promise<string> {
  const id = `rf_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await setDoc(doc(db, 'referrers', id), { id, name: name.trim(), phone: phone.trim(), createdById: viewer.id, createdByName: viewer.name, createdAt: Date.now() });
  return id;
}

/** After a win (or a change by Management on a won deal): the server raises the referral fee request. '' = nothing to say. */
export async function raiseReferralFee(dealId: string): Promise<string> {
  try {
    const r = await callServer<{ amount: number; status: string }>('/api/referral/raise', { dealId }, true);
    return r.status === 'pending' && r.amount > 0 ? `Referral fee of ${formatRM(r.amount)} sent for a manager's approval.` : '';
  } catch (e) {
    return `The referral fee request wasn't raised: ${friendlyError(e)} Admin can raise it from Admin work → Referrers.`;
  }
}

// ---------- On the deal form ----------

export function ReferralFields({ referrers, referrerId, feeType, feeValue, dealValue, disabled, viewer, onChange }: {
  referrers: Referrer[]; referrerId: string; feeType: ReferralFeeType; feeValue: string; dealValue: number; disabled: boolean; viewer: Viewer;
  onChange: (patch: { referrerId?: string; referralFeeType?: ReferralFeeType; referralFeeValue?: string }) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const add = async () => {
    setError('');
    if (!name.trim()) return setError("Enter the referrer's name.");
    const same = referrers.find(r => norm(r.name) === norm(name));
    if (same) { onChange({ referrerId: same.id }); setAdding(false); setName(''); setPhone(''); return; }
    setBusy(true);
    try {
      onChange({ referrerId: await addReferrer(name, phone, viewer) });
      setAdding(false); setName(''); setPhone('');
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };
  const fee = referralFee({ referrerId, referralFeeType: feeType, referralFeeValue: feeValue, proposalValue: dealValue });
  return (
    <div>
      <label htmlFor="d-referrer" className={label}>Referred by <span className="font-normal text-ink-soft">(optional)</span></label>
      <select id="d-referrer" value={adding ? '__new' : referrerId} disabled={disabled} className={input}
        onChange={e => { if (e.target.value === '__new') setAdding(true); else { setAdding(false); onChange({ referrerId: e.target.value }); } }}>
        <option value="">No referrer</option>
        {referrers.map(r => <option key={r.id} value={r.id}>{r.name}{r.phone ? ` (${r.phone})` : ''}</option>)}
        <option value="__new">+ New referrer…</option>
      </select>
      {adding && !disabled && (
        <div className="mt-2 space-y-2 rounded-lg border border-line bg-surface p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <input value={name} onChange={e => setName(e.target.value)} className={input} placeholder="Referrer's full name" aria-label="Referrer's name" />
            <input value={phone} onChange={e => setPhone(e.target.value)} className={input} placeholder="Phone (for WhatsApp)" aria-label="Referrer's phone" inputMode="tel" />
          </div>
          <p className="text-sm text-ink-soft">After saving the deal, send them the link on the deal to fill in their bank details.</p>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={add} disabled={busy} className={btnPrimary}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Add referrer</button>
            <button type="button" onClick={() => { setAdding(false); setError(''); }} className={btnSecondary}>Cancel</button>
          </div>
        </div>
      )}
      {referrerId && !adding && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select value={feeType} disabled={disabled} onChange={e => onChange({ referralFeeType: e.target.value as ReferralFeeType })}
            className="rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink" aria-label="Referral fee type">
            <option value="pct">% of the deal value</option>
            <option value="rm">Fixed RM</option>
          </select>
          <input value={feeValue} disabled={disabled} onChange={e => onChange({ referralFeeValue: e.target.value })} inputMode="decimal"
            className={`${input} w-32`} placeholder={feeType === 'pct' ? 'e.g. 5' : 'e.g. 500'} aria-label="Referral fee" />
          <span className="text-sm text-ink-soft">{fee > 0 ? `Fee ${formatRM(fee)}` : 'Fee can be added later'}</span>
        </div>
      )}
      <p className="mt-1.5 text-sm text-ink-soft">When the deal is won, the referral fee goes to a manager for approval and then into this deal's P&L.</p>
    </div>
  );
}

// ---------- On the deal ----------

/** "Referred by …" with the fee and the referrer's link for their bank details. */
export function ReferralLine({ deal, referrers, editable }: { deal: any; referrers: Referrer[]; editable: boolean }) {
  const r = referrers.find(x => x.id === deal.referrerId);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  if (!deal.referrerId) return null;
  const fee = referralFee(deal);
  const status = r?.link?.status;
  const makeLink = async () => {
    setBusy(true); setError('');
    try {
      const { token } = await callServer<{ token: string }>('/api/referral/link', { referrerId: deal.referrerId }, true);
      setUrl(referrerLinkUrl(token));
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { window.prompt('Copy this link:', url); }
  };
  const wa = whatsappTo(r?.phone);
  const message = `Hi ${(r?.name || '').split(/\s+/)[0]}, thank you for referring ${deal.client || 'the client'} to NEXT Academy. Please fill in your bank details for the referral fee here: ${url}`;
  return (
    <div className="rounded-lg bg-surface px-3.5 py-2.5 text-sm">
      <p>
        <span className="text-ink-soft">Referred by</span> <span className="font-semibold">{r?.name || deal.referrerName || 'Referrer'}</span>
        <span className="text-ink-soft"> · {referralFeeText(deal)}{fee > 0 ? ` (${formatRM(fee)})` : ''}</span>
      </p>
      <p className="mt-0.5 text-ink-soft">{r?.vendorId && status === 'accepted' ? 'Bank details on file' : status ? LINK_STATUS_LABELS[status] : 'No bank details yet'}</p>
      {editable && status !== 'accepted' && !url && (
        <button type="button" onClick={makeLink} disabled={busy} className={`${btnSecondary} mt-2`}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Send link for bank details
        </button>
      )}
      {url && (
        <div className="mt-2 space-y-2">
          <input readOnly value={url} className={`${input} font-mono text-sm`} aria-label="Referrer's link" onFocus={e => e.target.select()} />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={copy} className={btnSecondary}><Copy className="h-4 w-4" /> {copied ? 'Copied' : 'Copy link'}</button>
            <a href={`https://wa.me/${wa}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer" className={btnSecondary}><MessageCircle className="h-4 w-4" /> WhatsApp{wa ? '' : ' (pick the chat)'}</a>
          </div>
          <p className="text-ink-soft">The link works for 30 days. They only see a form for their bank details.</p>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-danger">{error}</p>}
    </div>
  );
}

// ---------- Admin work → Referrers (Admin and Management) ----------

export default function ReferrersPage({ viewer }: { viewer: Viewer }) {
  const referrers = useReferrers();
  const vendors = useVendors(true);
  const [deals, setDeals] = useState<any[]>([]);
  const [edit, setEdit] = useState<Referrer | 'new' | null>(null);
  const [open, setOpen] = useState<string | null>(null);   // referrer whose submission is shown
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState('');
  useEffect(() => onSnapshot(query(collection(db, 'pipelines')), s => setDeals(withoutDeleted(s.docs.map(d => ({ ...d.data(), id: d.id })).filter((d: any) => d.referrerId)))), []);
  const flash = (t: string) => { setToast(t); window.setTimeout(() => setToast(x => (x === t ? '' : x)), 3500); };
  const dealsOf = (id: string) => deals.filter(d => d.referrerId === id);

  const run = async (key: string, fn: () => Promise<any>, done?: string) => {
    setBusy(key); setError('');
    try { await fn(); if (done) flash(done); } catch (e) { setError(friendlyError(e)); } finally { setBusy(''); }
  };
  const accept = (r: Referrer) => run(`accept:${r.id}`, async () => {
    await callServer('/api/referral/accept', { referrerId: r.id }, true);
    setOpen(null);
  }, `${r.name}'s bank details saved. A manager checks them in Vendors before accounts see them.`);
  const remove = (r: Referrer) => {
    if (dealsOf(r.id).length) return setError(`${r.name} is on ${dealsOf(r.id).length} deal(s). Take them off those deals first.`);
    if (!window.confirm(`Delete ${r.name} from the referrers list?`)) return;
    run(`del:${r.id}`, () => deleteDoc(doc(db, 'referrers', r.id)), 'Referrer deleted');
  };
  const raise = (d: any) => run(`raise:${d.id}`, async () => { const m = await raiseReferralFee(d.id); flash(m || 'Nothing to raise: no fee set, or already raised.'); });

  return (
    <div className="space-y-5 font-sans text-ink">
      {toast && <div role="status" className="fixed right-4 top-4 z-[60] rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white shadow-lg">{toast}</div>}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Referrers</h2>
          <p className="text-[15px] text-ink-soft">People who refer deals for a referral fee. Reps see only the names; bank details are saved on the referrer's vendor record.</p>
        </div>
        <button type="button" onClick={() => setEdit('new')} className={btnPrimary}><Plus className="h-4 w-4" /> Add referrer</button>
      </div>
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</p>}
      {edit && <ReferrerForm referrer={edit === 'new' ? null : edit} referrers={referrers} viewer={viewer} onDone={msg => { setEdit(null); flash(msg); }} onCancel={() => setEdit(null)} />}
      <div className="overflow-hidden rounded-2xl border border-line bg-white">
        {referrers.length === 0 ? (
          <p className="p-6 text-center text-ink-soft">No referrers yet. Add one here or from a deal's "Referred by" box.</p>
        ) : (
          <ul className="divide-y divide-line">
            {referrers.map(r => {
              const v = vendors.find(x => x.id === r.vendorId);
              const list = dealsOf(r.id);
              const fees = list.filter(d => dealStage(d) === 'won').reduce((t, d) => t + referralFee(d), 0);
              return (
                <li key={r.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold">{r.name}</p>
                      <p className="text-sm text-ink-soft">{[r.phone, r.createdByName && `added by ${r.createdByName}`].filter(Boolean).join(' · ')}</p>
                      <p className="mt-1 text-sm">
                        {v && hasBank(v) ? <>{bankText(v)} <span className={bankChecked(v) ? 'text-accent' : 'text-attention'}>{bankChecked(v) ? '(checked)' : "(waiting for a manager's check in Vendors)"}</span></>
                          : r.link?.status ? LINK_STATUS_LABELS[r.link.status] : 'No bank details yet: send the link from one of their deals.'}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {r.link?.status === 'submitted' && <button type="button" onClick={() => setOpen(o => (o === r.id ? null : r.id))} className={btnPrimary}>See bank details</button>}
                      <button type="button" onClick={() => setEdit(r)} className={btnSecondary} aria-label={`Edit ${r.name}`}><Pencil className="h-4 w-4" /></button>
                      {viewer.role === 'management' && <button type="button" onClick={() => remove(r)} disabled={!!busy} className={btnSecondary} aria-label={`Delete ${r.name}`}><Trash2 className="h-4 w-4" /></button>}
                    </div>
                  </div>
                  {open === r.id && r.link?.token && <SubmissionBox token={r.link.token} busy={busy === `accept:${r.id}`} onAccept={() => accept(r)} onClose={() => setOpen(null)} />}
                  {list.length > 0 && (
                    <div className="mt-3 rounded-lg bg-surface px-3.5 py-2.5 text-sm">
                      <p className="font-semibold">{list.length} deal{list.length === 1 ? '' : 's'}{fees > 0 ? ` · won deals' fees ${formatRM(fees)}` : ''}</p>
                      <ul className="mt-1 space-y-1">
                        {list.map(d => (
                          <li key={d.id} className="flex flex-wrap items-center justify-between gap-2">
                            <span>{d.client || 'Client'} · {d.courseName || d.enquiryNote || 'Training'} · <span className="text-ink-soft">{dealStage(d) === 'won' ? 'won' : dealStage(d)}, {referralFeeText(d)}</span></span>
                            {dealStage(d) === 'won' && referralFee(d) > 0 && (
                              <button type="button" onClick={() => raise(d)} disabled={!!busy} className="text-sm font-semibold text-accent hover:underline">Raise fee request</button>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <p className="text-sm text-ink-soft">A won deal's referral fee request is raised by itself; "Raise fee request" only does it again if it was missed (never twice).</p>
    </div>
  );
}

function SubmissionBox({ token, busy, onAccept, onClose }: { token: string; busy: boolean; onAccept: () => void; onClose: () => void }) {
  const [s, setS] = useState<ReferrerSubmission | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    getDoc(doc(db, 'referrer_links', token)).then(d => setS((d.data() as any)?.submission || null)).catch(e => setError(friendlyError(e)));
  }, [token]);
  return (
    <div className="mt-3 rounded-lg border border-accent/30 bg-accent-soft p-3.5 text-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-accent">What they typed on their link</p>
        <button type="button" onClick={onClose} className="rounded-md p-1 text-ink-soft hover:bg-white" aria-label="Close"><X className="h-4 w-4" /></button>
      </div>
      {error ? <p className="text-danger">{error}</p> : !s ? <p className="flex items-center gap-2 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p> : (
        <>
          <dl className="mt-1 grid gap-x-4 gap-y-1 sm:grid-cols-2">
            {([['Name', s.name], ['Phone', s.phone], ['Email', s.email || '—'], ['Bank', s.bankName], ['Account name', s.accountName], ['Account number', s.accountNo]] as [string, string][]).map(([k, v]) => (
              <div key={k}><dt className="text-ink-soft">{k}</dt><dd className="font-semibold">{v}</dd></div>
            ))}
          </dl>
          <button type="button" onClick={onAccept} disabled={busy} className={`${btnPrimary} mt-3`}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Accept bank details</button>
        </>
      )}
    </div>
  );
}

function ReferrerForm({ referrer, referrers, viewer, onDone, onCancel }: {
  referrer: Referrer | null; referrers: Referrer[]; viewer: Viewer; onDone: (msg: string) => void; onCancel: () => void;
}) {
  const [name, setName] = useState(referrer?.name || '');
  const [phone, setPhone] = useState(referrer?.phone || '');
  const [notes, setNotes] = useState(referrer?.notes || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dup = useMemo(() => referrers.find(r => r.id !== referrer?.id && norm(r.name) === norm(name)), [referrers, name, referrer?.id]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError('Enter the name.');
    if (dup) return setError(`${dup.name} is already on the list.`);
    setBusy(true); setError('');
    try {
      if (referrer) await updateDoc(doc(db, 'referrers', referrer.id), { name: name.trim(), phone: phone.trim(), notes: notes.trim() });
      else await addReferrer(name, phone, viewer);
      onDone(referrer ? 'Referrer saved' : 'Referrer added');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={save} className="space-y-3 rounded-2xl border border-line bg-white p-4">
      <p className="text-[15px] font-semibold">{referrer ? `Edit ${referrer.name}` : 'Add referrer'}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className={label} htmlFor="rf-name">Full name</label><input id="rf-name" value={name} onChange={e => setName(e.target.value)} className={input} autoFocus /></div>
        <div><label className={label} htmlFor="rf-phone">Phone</label><input id="rf-phone" value={phone} onChange={e => setPhone(e.target.value)} className={input} inputMode="tel" /></div>
      </div>
      <div><label className={label} htmlFor="rf-notes">Notes <span className="font-normal text-ink-soft">(optional; the team can see these)</span></label><input id="rf-notes" value={notes} onChange={e => setNotes(e.target.value)} className={input} /></div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={btnPrimary}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{referrer ? 'Save' : 'Add referrer'}</button>
        <button type="button" onClick={onCancel} className={btnSecondary}>Cancel</button>
      </div>
    </form>
  );
}
