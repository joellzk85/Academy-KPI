import React, { useMemo, useState } from 'react';
import { AlertTriangle, ExternalLink, Loader2, Paperclip, X } from 'lucide-react';
import { dealOwnerId, formatDate, formatRM, todayIso } from '../lib/deals';
import {
  CLAIM_FIELDS, CLAIM_STATUS_LABELS, Claim, ClaimCategory, ClaimExtra, ClaimField, ClaimFile, ClaimFlag, ClaimLimits, ClaimSettings, ClaimStatus,
  LIMIT_KEYS, canRaiseForOthers, claimSummary, duplicatesOf, limitsFor, newClaimId, overLimits, usageFor,
} from '../lib/claims';
import { removeClaimFiles, sendClaim, uploadClaimFiles } from '../lib/useClaims';
import { useFormDraft } from '../lib/useFormDraft';
import { storageError, openProposalFile } from './ProposalFiles';
import { ReceiptPick } from './PaymentReceipts';
import DraftBar from './DraftBar';
import DownloadButton from './DownloadButton';

// Parts shared by My claims (everyone) and Management → Claims (lib/claims.ts).

export type ClaimViewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };
export type ClaimPerson = { id: string; name: string; role?: string };

export const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
export const small = 'mb-1 block text-sm font-medium text-ink-soft';
export const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
export const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';

const TONE: Record<ClaimStatus, string> = {
  pending: 'bg-attention-soft text-attention',
  approved: 'bg-[#E8EEF8] text-[#2B4A7E]',
  rejected: 'bg-danger-soft text-danger',
};

export function StatusChip({ c, paidOn }: { c: Claim; paidOn?: string }) {
  if (c.status === 'approved' && paidOn) return <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-semibold text-accent">Paid{/^\d{4}-\d{2}-\d{2}$/.test(paidOn) ? ` ${formatDate(paidOn)}` : ''}</span>;
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE[c.status]}`}>
      {c.status === 'approved' ? 'Approved, with accounts' : CLAIM_STATUS_LABELS[c.status]}{c.special && c.status === 'pending' ? ' · Special request' : ''}
    </span>
  );
}

export function FlagList({ flags }: { flags: ClaimFlag[] }) {
  if (!flags.length) return null;
  return (
    <ul className="space-y-1">
      {flags.map((f, i) => (
        <li key={i} className={`flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-sm ${f.level === 'danger' ? 'bg-danger-soft text-danger' : 'bg-attention-soft text-attention'}`}>
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{f.text}
        </li>
      ))}
    </ul>
  );
}

/** The claim's files: open (new tab) and ⬇. */
export function ClaimFiles({ files }: { files: ClaimFile[] }) {
  const [error, setError] = useState('');
  if (!files?.length) return <p className="text-sm text-ink-soft">No files attached</p>;
  return (
    <div>
      <ul className="flex flex-wrap gap-1.5">
        {files.map(f => (
          <li key={f.path} className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2 py-1 text-sm">
            <button type="button" onClick={async () => setError(await openProposalFile({ path: f.path } as any))}
              className="inline-flex max-w-[16rem] items-center gap-1 font-semibold text-accent hover:underline">
              <Paperclip className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{f.name}</span><ExternalLink className="h-3 w-3 shrink-0" />
            </button>
            <DownloadButton file={{ name: f.name, path: f.path }} />
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="mt-1 text-sm text-danger">{error}</p>}
    </div>
  );
}

/** The details of one claim, as plain lines (both screens). */
export function ClaimDetails({ c }: { c: Claim }) {
  const e = c.extra || {};
  const rows: [string, string][] = [
    ['Date of transaction', `${formatDate(c.date)}${e.time ? `, ${e.time}` : ''}`],
    ['Amount', `${formatRM(c.amount)}${c.includeSst ? ' (includes SST)' : ''}`],
    ['Receipt / e-Invoice no.', c.receiptNo || ''],
    ['UUID', c.uuid || ''],
    ['Client', e.clientName || ''],
    ['Who attended', e.attendees ? `${e.attendees}${e.pax ? ` (${e.pax} pax)` : ''}` : ''],
    ['Place', e.place || ''],
    ['Clinic or hospital', e.clinic || ''],
    ['Illness or reason', e.reason || ''],
    ['From', e.from || ''], ['To', e.to || ''], ['Distance', e.km ? `${e.km} km` : ''],
    ['Benefit', e.benefit || ''], ['Purpose', e.purpose || ''], ['Description', e.description || ''],
    ['Linked deal', e.dealName || ''],
    ['Notes', c.notes || ''],
    ['Pay to', c.paymentDetails || ''],
    ['Raised by', c.raisedById !== c.memberId ? c.raisedByName : ''],
  ];
  return (
    <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[11rem_minmax(0,1fr)]">
      {rows.filter(([, v]) => v).map(([k, v]) => (
        <React.Fragment key={k}><dt className="text-ink-soft">{k}</dt><dd className="min-w-0 break-words text-ink">{v}</dd></React.Fragment>
      ))}
    </dl>
  );
}

/** "Per year: RM 300.00 used of RM 1,000.00" for each limit that's set. */
export function LimitLines({ lim, used, asksPax }: { lim: ClaimLimits; used: { month: number; year: number }; asksPax: boolean }) {
  const lines = LIMIT_KEYS.filter(({ key }) => lim[key] !== null && (key !== 'perHead' || asksPax)).map(({ key, label }) => {
    const max = lim[key] as number;
    if (key === 'perMonth') return `${label}: ${formatRM(used.month)} used of ${formatRM(max)}`;
    if (key === 'perYear') return `${label}: ${formatRM(used.year)} used of ${formatRM(max)}`;
    return `${label}: up to ${formatRM(max)}`;
  });
  if (!lines.length) return <span>No limit set</span>;
  return <>{lines.join(' · ')}</>;
}

// ---------- The claim form ----------

type Form = {
  memberId: string; categoryId: string; date: string; amount: string; receiptNo: string; uuid: string; includeSst: boolean;
  notes: string; paymentDetails: string; specialReason: string;
  extra: { clientId: string; attendees: string; pax: string; time: string; place: string; dealId: string; clinic: string; reason: string;
    from: string; to: string; km: string; purpose: string; benefit: string; description: string };
};

const blankExtra = (): Form['extra'] => ({ clientId: '', attendees: '', pax: '', time: '', place: '', dealId: '', clinic: '', reason: '', from: '', to: '', km: '', purpose: '', benefit: '', description: '' });
const numOf = (s: string) => Number(String(s).replace(/[^0-9.]/g, ''));

/** New claim, or fix a pending / rejected one (editing). claims: what the person (or everyone) has, for limits and duplicates. */
export function ClaimForm({ viewer, settings, claims, people, clients, deals, editing, onDone }: {
  viewer: ClaimViewer; settings: ClaimSettings; claims: Claim[]; people: ClaimPerson[]; clients: any[]; deals: any[];
  editing?: Claim; onDone: () => void;
}) {
  const forOthers = canRaiseForOthers(settings, viewer) && !editing;
  const lastPay = useMemo(() => [...claims].filter(c => c.memberId === viewer.id && c.paymentDetails)
    .sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)))[0]?.paymentDetails || '', [claims, viewer.id]);
  const [f, setF] = useState<Form>(() => editing ? {
    memberId: editing.memberId, categoryId: editing.categoryId, date: editing.date, amount: String(editing.amount ?? ''),
    receiptNo: editing.receiptNo || '', uuid: editing.uuid || '', includeSst: !!editing.includeSst, notes: editing.notes || '',
    paymentDetails: editing.paymentDetails || '', specialReason: editing.specialReason || '',
    extra: { ...blankExtra(), ...Object.fromEntries(Object.entries(editing.extra || {}).filter(([k]) => k in blankExtra()).map(([k, v]) => [k, String(v ?? '')])) },
  } : {
    memberId: viewer.id, categoryId: '', date: todayIso(), amount: '', receiptNo: '', uuid: '', includeSst: false, notes: '',
    paymentDetails: '', specialReason: '', extra: blankExtra(),
  });
  const draft = useFormDraft(viewer.id, editing ? `claim:fix:${editing.id}` : 'claim:new', f, setF);
  const [files, setFiles] = useState<File[]>([]);
  const [kept, setKept] = useState<ClaimFile[]>(editing?.files || []);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState('');

  const active = settings.categories.filter(c => c.active || c.id === editing?.categoryId);
  const cat: ClaimCategory | undefined = settings.categories.find(c => c.id === f.categoryId);
  const need = (k: ClaimField) => cat?.fields[k];
  const member = people.find(p => p.id === f.memberId) || (f.memberId === viewer.id ? { id: viewer.id, name: viewer.name } : undefined);
  const payDefault = f.memberId === viewer.id ? lastPay : '';
  const payText = f.paymentDetails || payDefault;
  const amount = numOf(f.amount);
  const pax = Math.round(numOf(f.extra.pax));
  const lim = cat ? limitsFor(settings, cat, f.memberId) : null;
  const used = cat ? usageFor(claims, f.memberId, cat.id, f.date || todayIso(), editing?.id) : { month: 0, year: 0 };
  const over = cat && lim && amount > 0 ? overLimits({ amount, extra: { pax } }, lim, used, !!need('attendees')) : [];
  const dups = duplicatesOf({ id: editing?.id || '', receiptNo: f.receiptNo, uuid: f.uuid }, claims);
  const myDeals = deals.filter(d => dealOwnerId(d) === f.memberId && !d.deleted && d.stage !== 'discovery');
  const dealName = (d: any) => [clients.find(c => c.id === d.clientId)?.companyName || d.client || 'Deal', d.courseName].filter(Boolean).join(' · ');
  const setX = (ch: Partial<Form['extra']>) => setF(x => ({ ...x, extra: { ...x.extra, ...ch } }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!member) return setError('Pick whose claim this is.');
    if (!cat) return setError('Choose a category.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) return setError('Enter the date of transaction.');
    if (f.date > todayIso()) return setError('The date of transaction can\'t be in the future.');
    if (!(amount > 0)) return setError('Enter the total claim amount, for example 85.50.');
    const missing = CLAIM_FIELDS.filter(({ key }) => need(key) === 'required' && (key === 'client' ? !f.extra.clientId : key === 'deal' ? !f.extra.dealId : key === 'km' ? !(numOf(f.extra.km) > 0) : !String((f.extra as any)[key] || '').trim()));
    if (missing.length) return setError(`Fill in: ${missing.map(m => m.label).join(', ')}.`);
    if (need('attendees') && !(pax > 0)) return setError('Enter how many people attended.');
    if (!payText.trim()) return setError('Enter the bank, account number and account name to pay this claim to.');
    if (cat.receiptNeeded && !files.length && !kept.length) return setError('Attach the receipt (a photo or PDF of the actual receipt).');
    if (over.length && f.specialReason.trim().length < 10) return setError('This claim is over a limit. Say why in "Reason for the special request" (at least 10 characters).');
    if (dups.length) return setError(`This receipt no. or UUID is already on your ${dups[0].categoryName} claim of ${formatRM(dups[0].amount)} (${formatDate(dups[0].date)}). Each receipt can be claimed once.`);

    const client = clients.find(c => c.id === f.extra.clientId);
    const deal = myDeals.find(d => d.id === f.extra.dealId);
    const x = f.extra;
    const extra: ClaimExtra = {};
    const put = (k: ClaimField, v: any) => { if (need(k) && v !== '' && v !== undefined && v !== 0) (extra as any)[k] = v; };
    if (need('client') && client) { extra.clientId = client.id; extra.clientName = String(client.companyName || client.name || '').trim(); }
    if (need('attendees')) { put('attendees', x.attendees.trim()); if (pax > 0) extra.pax = pax; }
    put('time', x.time); put('place', x.place.trim()); put('clinic', x.clinic.trim()); put('reason', x.reason.trim());
    put('from', x.from.trim()); put('to', x.to.trim()); if (need('km') && numOf(x.km) > 0) extra.km = numOf(x.km);
    put('purpose', x.purpose.trim()); put('benefit', x.benefit.trim()); put('description', x.description.trim());
    if (need('deal') && deal) { extra.dealId = deal.id; extra.dealName = dealName(deal); }

    const id = editing?.id || newClaimId();
    setBusy(true);
    let up: ClaimFile[] = [];
    try {
      if (files.length) {
        setProgress('0%');
        try { up = await uploadClaimFiles(files, member.id, id, viewer, setProgress); }
        catch (err: any) { throw new Error(err instanceof Error && !(err as any).code ? err.message : storageError(err)); }
        setProgress(null);
      }
      const claim: Claim = {
        id, memberId: member.id, memberName: member.name, raisedById: editing?.raisedById || viewer.id, raisedByName: editing?.raisedByName || viewer.name,
        categoryId: cat.id, categoryName: cat.name, date: f.date, amount: Math.round(amount * 100) / 100, includeSst: f.includeSst,
        receiptNo: f.receiptNo.trim(), uuid: f.uuid.trim(), notes: f.notes.trim(), extra, files: [...kept, ...up],
        paymentDetails: payText.trim(), special: over.length > 0, specialReason: over.length ? f.specialReason.trim() : '', overLimits: over,
        status: 'pending', submittedAt: editing?.submittedAt || '',
      };
      try { await sendClaim(claim, !editing); }
      catch (err) { await removeClaimFiles(up); throw err; }
      // Files taken off a claim being fixed: removed once the fixed claim is saved.
      if (editing) await removeClaimFiles((editing.files || []).filter(o => !kept.some(k => k.path === o.path)));
      draft.clear();
      onDone();
    } catch (err: any) {
      setProgress(null);
      setError(err?.code === 'permission-denied' ? 'The database refused this claim. Check every box, then try again, or ask Management.' : err?.message || 'The claim could not be sent. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const text = (k: keyof Form['extra'], label: string, placeholder = '', type = 'text') => (
    <div>
      <label className={small} htmlFor={`cl-${k}`}>{need(k as ClaimField) === 'required' && <span className="text-danger">* </span>}{label}{need(k as ClaimField) === 'optional' ? ' (optional)' : ''}</label>
      <input id={`cl-${k}`} type={type} value={f.extra[k]} onChange={e => setX({ [k]: e.target.value } as any)} className={input} placeholder={placeholder} />
    </div>
  );
  const star = (k: ClaimField) => need(k) === 'required' ? <span className="text-danger">* </span> : null;
  const opt = (k: ClaimField) => need(k) === 'optional' ? ' (optional)' : '';

  return (
    <form onSubmit={save} className="space-y-4 rounded-2xl border border-line bg-white p-5">
      <div>
        <p className="text-lg font-bold text-ink">{editing ? (editing.status === 'rejected' ? 'Fix and send again' : 'Change this claim') : 'Submit a new claim for approval'}</p>
        {editing?.status === 'rejected' && editing.rejectReason && <p className="mt-1 text-sm text-danger">Rejected by {editing.decidedByName}: {editing.rejectReason}</p>}
      </div>
      <DraftBar draft={draft} what="claim" />

      {forOthers && (
        <div>
          <label className={small} htmlFor="cl-who"><span className="text-danger">* </span>Whose claim</label>
          <select id="cl-who" value={f.memberId} onChange={e => setF(x => ({ ...x, memberId: e.target.value, paymentDetails: '' }))} className={input}>
            <option value={viewer.id}>My own claim</option>
            {people.filter(p => p.id !== viewer.id).sort((a, b) => a.name.localeCompare(b.name)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={small} htmlFor="cl-cat"><span className="text-danger">* </span>Category</label>
          <select id="cl-cat" value={f.categoryId} onChange={e => setF(x => ({ ...x, categoryId: e.target.value }))} className={input}>
            <option value="">Choose a category</option>
            {active.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {cat && lim && <p className="mt-1 text-sm text-ink-soft">{member && member.id !== viewer.id ? `${member.name}'s limits: ` : 'Your limits: '}<LimitLines lim={lim} used={used} asksPax={!!need('attendees')} /></p>}
        </div>
        <div><label className={small} htmlFor="cl-date"><span className="text-danger">* </span>Date of transaction</label><input id="cl-date" type="date" max={todayIso()} value={f.date} onChange={e => setF(x => ({ ...x, date: e.target.value }))} className={input} /></div>
        <div>
          <label className={small} htmlFor="cl-amt"><span className="text-danger">* </span>Total claim amount</label>
          <div className="flex">
            <span className="inline-flex items-center rounded-l-lg border border-r-0 border-line bg-surface px-3 text-sm text-ink-soft">RM</span>
            <input id="cl-amt" inputMode="decimal" value={f.amount} onChange={e => setF(x => ({ ...x, amount: e.target.value.replace(/[^0-9.]/g, '') }))} className={`${input} rounded-l-none`} placeholder="0.00" />
          </div>
        </div>
        <div><label className={small} htmlFor="cl-rno">Tax invoice / Receipt no. / e-Invoice no.</label><input id="cl-rno" value={f.receiptNo} onChange={e => setF(x => ({ ...x, receiptNo: e.target.value }))} className={input} /></div>
        <div><label className={small} htmlFor="cl-uuid">Unique identifier no. / UUID</label><input id="cl-uuid" value={f.uuid} onChange={e => setF(x => ({ ...x, uuid: e.target.value }))} className={input} placeholder="On an e-Invoice" /></div>
        <label className="flex items-center gap-2 text-[15px] text-ink sm:col-span-2">
          <input type="checkbox" checked={f.includeSst} onChange={e => setF(x => ({ ...x, includeSst: e.target.checked }))} className="h-4 w-4 accent-accent" /> The amount includes SST
        </label>
      </div>

      {cat && Object.keys(cat.fields).length > 0 && (
        <div className="grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2">
          <p className="text-sm font-semibold text-ink sm:col-span-2">{cat.name} details</p>
          {need('client') && (
            <div className="sm:col-span-2">
              <label className={small} htmlFor="cl-client">{star('client')}Client{opt('client')}</label>
              <select id="cl-client" value={f.extra.clientId} onChange={e => setX({ clientId: e.target.value })} className={input}>
                <option value="">Pick the client</option>
                {[...clients].filter(c => !c.deleted).sort((a, b) => String(a.companyName || '').localeCompare(String(b.companyName || ''))).map(c => <option key={c.id} value={c.id}>{c.companyName || c.name || 'Client'}</option>)}
              </select>
              <span className="mt-0.5 block text-xs text-ink-soft">Not on the list? Add the client in Clients first.</span>
            </div>
          )}
          {need('attendees') && (
            <>
              <div className="sm:col-span-2">
                <label className={small} htmlFor="cl-att">{star('attendees')}Who attended{opt('attendees')}</label>
                <input id="cl-att" value={f.extra.attendees} onChange={e => setX({ attendees: e.target.value })} className={input} placeholder="e.g. Encik Ali (HR Manager, client), Siti (us)" />
              </div>
              <div>
                <label className={small} htmlFor="cl-pax">{star('attendees')}How many people</label>
                <input id="cl-pax" inputMode="numeric" value={f.extra.pax} onChange={e => setX({ pax: e.target.value.replace(/[^0-9]/g, '') })} className={input} placeholder="e.g. 3" />
              </div>
            </>
          )}
          {need('time') && text('time', 'Time', '', 'time')}
          {need('place') && text('place', 'Place', 'Restaurant or venue')}
          {need('clinic') && text('clinic', 'Clinic or hospital')}
          {need('reason') && text('reason', 'Illness or reason')}
          {need('from') && text('from', 'From', 'e.g. Office, Petaling Jaya')}
          {need('to') && text('to', 'To', 'e.g. Client office, Shah Alam')}
          {need('km') && (
            <div>
              <label className={small} htmlFor="cl-km">{star('km')}Distance (km){opt('km')}</label>
              <input id="cl-km" inputMode="decimal" value={f.extra.km} onChange={e => setX({ km: e.target.value.replace(/[^0-9.]/g, '') })} className={input} />
            </div>
          )}
          {need('benefit') && text('benefit', 'Benefit', 'e.g. Optical, dental, gym')}
          {need('purpose') && text('purpose', 'Purpose', 'e.g. Proposal discussion')}
          {need('description') && <div className="sm:col-span-2">{text('description', 'Description')}</div>}
          {need('deal') && (
            <div className="sm:col-span-2">
              <label className={small} htmlFor="cl-deal">{star('deal')}Linked deal{opt('deal')}</label>
              <select id="cl-deal" value={f.extra.dealId} onChange={e => setX({ dealId: e.target.value })} className={input}>
                <option value="">No deal</option>
                {myDeals.map(d => <option key={d.id} value={d.id}>{dealName(d)}</option>)}
              </select>
            </div>
          )}
        </div>
      )}

      <div><label className={small} htmlFor="cl-notes">Notes about this claim</label><textarea id="cl-notes" rows={2} value={f.notes} onChange={e => setF(x => ({ ...x, notes: e.target.value }))} className={input} placeholder='For example "Met ABC Sdn Bhd CEO for dinner"' /></div>
      <div>
        <label className={small} htmlFor="cl-pay"><span className="text-danger">* </span>Pay to (bank, account no., account name)</label>
        <input id="cl-pay" value={payText} onChange={e => setF(x => ({ ...x, paymentDetails: e.target.value }))} className={input} placeholder="e.g. Maybank 1234 5678 9012, Siti Aminah" />
        {payDefault && !f.paymentDetails && <span className="mt-0.5 block text-xs text-ink-soft">From your last claim.</span>}
      </div>

      <div className="space-y-2">
        {kept.length > 0 && (
          <ul className="space-y-1">
            {kept.map(k => (
              <li key={k.path} className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-[15px]">
                <Paperclip className="h-4 w-4 shrink-0 text-accent" /><span className="min-w-0 flex-1 truncate">{k.name}</span>
                <button type="button" onClick={() => setKept(list => list.filter(x => x.path !== k.path))} className="rounded-md p-1 text-ink-soft hover:bg-white" aria-label={`Remove ${k.name}`}><X className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        )}
        <ReceiptPick files={files} onFiles={setFiles} what="receipt"
          label={cat?.receiptNeeded === false ? 'Receipt or documents (optional)' : 'Receipt (the actual receipt, not only the card slip) and any other documents'} />
      </div>

      {over.length > 0 && (
        <div className="space-y-2 rounded-xl border border-danger/30 bg-danger-soft p-4">
          <p className="flex items-center gap-1.5 font-semibold text-danger"><AlertTriangle className="h-4 w-4" /> Over the limit: this becomes a special request</p>
          <ul className="list-disc pl-5 text-sm text-danger">{over.map(o => <li key={o}>{o}</li>)}</ul>
          <label className={small} htmlFor="cl-why"><span className="text-danger">* </span>Reason for the special request</label>
          <textarea id="cl-why" rows={2} value={f.specialReason} onChange={e => setF(x => ({ ...x, specialReason: e.target.value }))} className={input} placeholder="Why it's over the limit" />
        </div>
      )}
      {dups.length > 0 && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">This receipt no. or UUID is already on a claim of {formatRM(dups[0].amount)} ({formatDate(dups[0].date)}).</p>}

      <p className="text-sm text-ink-soft">{viewer.role === 'management' && f.memberId === viewer.id ? 'The other manager must approve this claim.' : 'A manager must approve this claim. Once approved it goes to accounts for payment.'}</p>
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnSecondary} onClick={onDone}>Cancel</button>
        <button type="submit" disabled={busy} className={btnPrimary}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}{progress !== null ? `Uploading… ${progress}` : editing?.status === 'pending' ? 'Save changes' : editing ? 'Send for approval again' : over.length ? 'Send special request' : 'Send for approval'}
        </button>
      </div>
    </form>
  );
}

/** One line in a claims list; click to open its details. */
export function ClaimRow({ c, open, onToggle, paidOn, showWho, children }: {
  c: Claim; open: boolean; onToggle: () => void; paidOn?: string; showWho?: boolean; children?: React.ReactNode;
}) {
  return (
    <li className="px-4 py-3">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-left">
        <span className="min-w-0 flex-1 basis-60">
          <span className="block truncate text-[15px] font-semibold text-ink">{showWho ? `${c.memberName} · ` : ''}{claimSummary(c)}</span>
          <span className="block text-sm text-ink-soft">{formatDate(c.date)}{c.receiptNo ? ` · Receipt ${c.receiptNo}` : ''}</span>
        </span>
        <strong className="tabular-nums text-ink">{formatRM(c.amount)}</strong>
        <StatusChip c={c} paidOn={paidOn} />
      </button>
      {open && <div className="mt-3 space-y-3 border-t border-line pt-3">{children}</div>}
    </li>
  );
}
