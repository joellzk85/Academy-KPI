import React, { useEffect, useMemo, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, query, setDoc, updateDoc } from 'firebase/firestore';
import { Landmark, Loader2, Plus, Search, Trash2, X } from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import { useFormDraft } from '../lib/useFormDraft';
import DraftBar from './DraftBar';
import { VENDOR_TYPES, Vendor, VendorType, bankCheckFields, bankChecked, bankText, canCheckBank, hasBank, vendorName, vendorProblem, vendorTypeLabel, withBankStamp } from '../lib/vendors';
import { formatDate } from '../lib/deals';
import { useSearchPrefill } from './GlobalSearch';

// Admin work → Vendors (2026-10-20): who NEXT Academy pays for trainings, with bank details for accounts.
// Admin and Management only (lib/vendors.ts). The same form opens from a checklist step ("New vendor",
// "Add bank details").

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const small = 'mb-1 block text-sm font-medium text-ink-soft';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';

/** Vendors, live. Only Admin and Management may read them (reps get an empty list). */
export function useVendors(enabled = true): Vendor[] {
  const [list, setList] = useState<Vendor[]>([]);
  useEffect(() => {
    if (!enabled) { setList([]); return; }
    return onSnapshot(query(collection(db, 'vendors')), s => setList(s.docs.map(d => ({ ...(d.data() as Vendor), id: d.id }))), () => setList([]));
  }, [enabled]);
  return list;
}

/** Trainers and venues, live (vendor names for linked records). */
export function useTrainersVenues(): { trainers: any[]; venues: any[] } {
  const [trainers, setTrainers] = useState<any[]>([]);
  const [venues, setVenues] = useState<any[]>([]);
  useEffect(() => {
    const subs = [
      onSnapshot(query(collection(db, 'trainers_directory')), s => setTrainers(s.docs.map(d => ({ ...d.data(), id: d.id })))),
      onSnapshot(query(collection(db, 'venues_directory')), s => setVenues(s.docs.map(d => ({ ...d.data(), id: d.id })))),
    ];
    return () => subs.forEach(u => u());
  }, []);
  return { trainers, venues };
}

type Draft = { name: string; type: VendorType; trainerId: string; venueId: string; contactName: string; phone: string; email: string; bankName: string; accountName: string; accountNo: string; ssmNo: string; tin: string; notes: string };

const toDraft = (v: Partial<Vendor>): Draft => ({
  name: v.name || '', type: v.type || 'other', trainerId: v.trainerId || '', venueId: v.venueId || '',
  contactName: v.contactName || '', phone: v.phone || '', email: v.email || '', bankName: v.bankName || '',
  accountName: v.accountName || '', accountNo: v.accountNo || '', ssmNo: v.ssmNo || '', tin: v.tin || '', notes: v.notes || '',
});

/** Add or edit a vendor. `start` prefills a new one (e.g. a trainer picked on a checklist). Calls onSaved with the record. */
export function VendorForm({ vendor, start, vendors, trainers, venues, viewer, onSaved, onCancel }: {
  vendor?: Vendor | null; start?: Partial<Vendor>; vendors: Vendor[]; trainers: any[]; venues: any[]; viewer: Viewer;
  onSaved: (v: Vendor) => void; onCancel: () => void;
}) {
  const [f, setF] = useState<Draft>(toDraft(vendor || start || {}));
  const draft = useFormDraft(viewer.id, `vendor:${vendor?.id || `new:${start?.trainerId || start?.venueId || start?.type || ''}`}`, f, setF);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof Draft, v: string) => setF(x => ({ ...x, [k]: v }));
  const linked = f.type === 'trainer' ? f.trainerId : f.type === 'venue' ? f.venueId : '';
  const linkList = f.type === 'trainer' ? trainers : f.type === 'venue' ? venues : [];

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = vendor?.id || `vd_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const rec: Vendor = {
      ...(vendor || {}),
      id, type: f.type,
      name: linked ? String(linkList.find(x => x.id === linked)?.name || f.name).trim() : f.name.trim(),
      trainerId: f.type === 'trainer' ? f.trainerId : '', venueId: f.type === 'venue' ? f.venueId : '',
      contactName: f.contactName.trim(), phone: f.phone.trim(), email: f.email.trim(),
      bankName: f.bankName.trim(), accountName: f.accountName.trim(), accountNo: f.accountNo.replace(/[^0-9A-Za-z -]/g, '').trim(),
      ssmNo: f.ssmNo.trim(), tin: (f.tin || '').toUpperCase().replace(/[^A-Z0-9]/g, ''), notes: f.notes.trim(),
      ...(vendor ? {} : { createdAt: new Date().toISOString(), createdById: viewer.id, createdByName: viewer.name }),
      updatedAt: new Date().toISOString(), updatedByName: viewer.name,
    };
    const problem = vendorProblem(rec, vendors);
    if (problem) return setError(problem);
    setBusy(true); setError('');
    try {
      // New or changed bank details wait for a manager's check (process audit, 2026-10-22).
      const saved = withBankStamp(rec, vendor, viewer);
      await setDoc(doc(db, 'vendors', id), saved);
      draft.clear();
      onSaved(saved);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-3 rounded-xl border border-line bg-surface p-4">
      <p className="font-semibold">{vendor ? `Edit ${vendorName(vendor, trainers, venues)}` : 'New vendor'}</p>
      <DraftBar draft={draft} what="vendor" />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={small} htmlFor="vd-type">Type</label>
          <select id="vd-type" value={f.type} onChange={e => set('type', e.target.value)} className={input}>
            {VENDOR_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        {f.type === 'trainer' || f.type === 'venue' ? (
          <div>
            <label className={small} htmlFor="vd-link">{f.type === 'trainer' ? 'Trainer (from the Trainers list)' : 'Venue (from the Venues list)'}</label>
            <select id="vd-link" value={linked} onChange={e => set(f.type === 'trainer' ? 'trainerId' : 'venueId', e.target.value)} className={input}>
              <option value="">Not in the list (type the name below)</option>
              {[...linkList].sort((a, b) => String(a.name).localeCompare(String(b.name))).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </div>
        ) : null}
        {!linked && (
          <div className={f.type === 'trainer' || f.type === 'venue' ? 'sm:col-span-2' : ''}>
            <label className={small} htmlFor="vd-name">Name (person or company)</label>
            <input id="vd-name" value={f.name} onChange={e => set('name', e.target.value)} className={input} placeholder="e.g. Sri Maju Transport Sdn Bhd" />
          </div>
        )}
        <div><label className={small} htmlFor="vd-cp">Contact person</label><input id="vd-cp" value={f.contactName} onChange={e => set('contactName', e.target.value)} className={input} /></div>
        <div><label className={small} htmlFor="vd-ph">Phone</label><input id="vd-ph" value={f.phone} onChange={e => set('phone', e.target.value)} className={input} inputMode="tel" /></div>
        <div><label className={small} htmlFor="vd-em">Email</label><input id="vd-em" value={f.email} onChange={e => set('email', e.target.value)} className={input} inputMode="email" /></div>
        <div><label className={small} htmlFor="vd-ssm">SSM / company no. (optional)</label><input id="vd-ssm" value={f.ssmNo} onChange={e => set('ssmNo', e.target.value)} className={input} /></div>
        <div><label className={small} htmlFor="vd-tin">Tax number, TIN (optional)</label><input id="vd-tin" value={f.tin || ''} onChange={e => set('tin', e.target.value)} className={input} placeholder="e.g. IG12345678090" /></div>
      </div>
      <div className="rounded-lg border border-line bg-white p-3">
        <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><Landmark className="h-4 w-4 text-accent" /> Bank details, for accounts</p>
        <p className="mb-2 text-sm text-ink-soft">New or changed bank details go to accounts only after a manager who didn't make the change checks them.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div><label className={small} htmlFor="vd-bank">Bank</label><input id="vd-bank" value={f.bankName} onChange={e => set('bankName', e.target.value)} className={input} placeholder="e.g. Maybank" /></div>
          <div><label className={small} htmlFor="vd-acc">Account number</label><input id="vd-acc" value={f.accountNo} onChange={e => set('accountNo', e.target.value)} className={input} inputMode="numeric" /></div>
          <div><label className={small} htmlFor="vd-an">Account name</label><input id="vd-an" value={f.accountName} onChange={e => set('accountName', e.target.value)} className={input} /></div>
        </div>
      </div>
      <div><label className={small} htmlFor="vd-notes">Notes (optional)</label><input id="vd-notes" value={f.notes} onChange={e => set('notes', e.target.value)} className={input} placeholder="e.g. 50% deposit, balance 7 days before" /></div>
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel}>Cancel</button>
        <button type="submit" disabled={busy} className={btnPrimary}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save vendor</button>
      </div>
    </form>
  );
}

export default function VendorsPage({ viewer }: { viewer: Viewer }) {
  const vendors = useVendors(true);
  const { trainers, venues } = useTrainersVenues();
  const [search, setSearch] = useState('');
  useSearchPrefill('vendors', setSearch);   // Global search opened a vendor
  const [type, setType] = useState<'' | VendorType>('');
  const [editing, setEditing] = useState<Vendor | 'new' | null>(null);
  const [error, setError] = useState('');

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vendors
      .map(v => ({ v, name: vendorName(v, trainers, venues) }))
      .filter(({ v, name }) => (!type || v.type === type) && (!q || [name, v.contactName, v.phone, v.email, v.bankName, v.accountName, v.notes].some(x => String(x || '').toLowerCase().includes(q))))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [vendors, trainers, venues, search, type]);

  const remove = async (v: Vendor) => {
    if (!window.confirm(`Delete the vendor "${vendorName(v, trainers, venues)}"? Payment requests already raised keep the name, but their bank details are no longer shown.`)) return;
    setError('');
    try { await deleteDoc(doc(db, 'vendors', v.id)); } catch (e) { setError(friendlyError(e)); }
  };
  // A manager who didn't set the bank details confirms them (process audit, 2026-10-22), e.g. after calling the vendor.
  const checkBank = async (v: Vendor) => {
    if (!window.confirm(`Confirm ${vendorName(v, trainers, venues)}'s bank details?\n\n${bankText(v) || 'No bank details'}\n\nChanged by ${v.bankSetByName}. Check them with the vendor (for example by phone) before confirming.`)) return;
    setError('');
    try { await updateDoc(doc(db, 'vendors', v.id), bankCheckFields(viewer)); } catch (e) { setError(friendlyError(e)); }
  };
  const waiting = vendors.filter(v => !bankChecked(v));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h3 className="text-lg font-bold">Vendors <span className="font-normal text-ink-soft">({vendors.length})</span></h3>
          <p className="text-sm text-ink-soft">Who we pay for trainings, with bank details for accounts. Only Admin and Management see this list.</p>
        </div>
        {!editing && <button type="button" className={`${btnPrimary} ml-auto`} onClick={() => setEditing('new')}><Plus className="h-4 w-4" /> Add vendor</button>}
      </div>

      {waiting.length > 0 && (
        <p className="rounded-lg bg-attention-soft px-3 py-2.5 text-sm font-semibold text-attention">
          {waiting.length} vendor{waiting.length === 1 ? '' : 's'} with new or changed bank details waiting for a manager's check: {waiting.map(v => vendorName(v, trainers, venues)).join(', ')}
        </p>
      )}

      {editing && (
        <VendorForm vendor={editing === 'new' ? null : editing} vendors={vendors} trainers={trainers} venues={venues} viewer={viewer}
          onSaved={() => setEditing(null)} onCancel={() => setEditing(null)} />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[14rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
          <input value={search} onChange={e => setSearch(e.target.value)} className={`${input} pl-9`} placeholder="Search name, contact, bank" aria-label="Search vendors" />
          {search && <button type="button" onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-soft hover:bg-surface" aria-label="Clear search"><X className="h-4 w-4" /></button>}
        </label>
        <div className="flex flex-wrap gap-1">
          {([['', 'All'], ...VENDOR_TYPES] as [string, string][]).map(([k, l]) => (
            <button key={k || 'all'} type="button" onClick={() => setType(k as any)}
              className={`rounded-full border px-3 py-1 text-sm font-semibold ${type === k ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-white text-ink-soft hover:text-ink'}`}>
              {l} {k ? `(${vendors.filter(v => v.type === k).length})` : ''}
            </button>
          ))}
        </div>
      </div>
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</p>}

      {shown.length === 0 ? (
        <p className="text-[15px] text-ink-soft">{vendors.length ? 'No vendors match.' : 'No vendors yet. Add them here, or straight from a deal\'s checklist when you enter a cost.'}</p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-white">
          {shown.map(({ v, name }) => (
            <li key={v.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
              <button type="button" className="min-w-[14rem] flex-1 text-left" onClick={() => setEditing(v)}>
                <p className="font-semibold">{name} <span className="ml-1 rounded bg-surface px-1.5 py-0.5 text-xs font-medium text-ink-soft">{vendorTypeLabel(v.type)}</span>
                  {(v.trainerId || v.venueId) && <span className="ml-1 text-xs font-medium text-accent">From the {v.trainerId ? 'Trainers' : 'Venues'} list</span>}</p>
                <p className="text-sm text-ink-soft">{[v.contactName, v.phone, v.email].filter(Boolean).join(' · ') || 'No contact details'}</p>
                <p className={`text-sm ${hasBank(v) ? 'text-ink' : 'font-semibold text-attention'}`}>{hasBank(v) ? bankText(v) : 'No bank details yet'}</p>
                {!bankChecked(v) && (
                  <p className="text-sm font-semibold text-attention">Bank details {hasBank(v) ? 'changed' : 'removed'} by {v.bankSetByName} on {formatDate(v.bankSetAt || '')}: waiting for a manager's check. Accounts don't see them yet.</p>
                )}
                {(v.bankLog || []).length > 1 && <p className="text-xs text-ink-soft">Bank changed {(v.bankLog || []).length} times; last by {v.bankSetByName}{v.bankCheckedByName ? `, checked by ${v.bankCheckedByName}` : ''}</p>}
              </button>
              {canCheckBank(v, viewer) && (
                <button type="button" onClick={() => checkBank(v)} className={`${btnSecondary} py-1.5`}>Bank details checked</button>
              )}
              {viewer.role === 'management' && (
                <button type="button" onClick={() => remove(v)} className="rounded-md p-1.5 text-ink-soft hover:bg-danger-soft hover:text-danger" aria-label={`Delete ${name}`}><Trash2 className="h-4 w-4" /></button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
