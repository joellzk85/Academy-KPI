import React, { useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import { dealOwnerId, formatDate, trainingDateText, trainingDays, parseTrainingDays } from '../lib/deals';
import TrainingDaysPicker from './TrainingDaysPicker';
import { clientContacts, mainContactFields, newContactId } from '../lib/contacts';
import { QuoteFix } from '../lib/quoteResolve';

// "Fix these at the source" on a quotation (Joel, 2026-10-18): each missing detail gets a small field and Save.
// Saving writes to where the detail lives (the deal or the client list), never to the quotation, so the
// quotation updates by itself. The deal's History records it. Same permissions as the screens that own them:
// a deal's training date by its owner, Admin or Management; client details by any team member. Anyone else
// keeps the link to the right tab.

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const btn = 'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white hover:bg-[#0B5A50] disabled:opacity-60';
const linkBtn = 'text-sm font-semibold text-accent hover:underline';

export default function QuoteFixBox({ fixes, deal, client, refNumber, me, onRelink, onShowProgrammes, goto, onSaved }: {
  fixes: QuoteFix[]; deal: any | null; client: any | null; refNumber: string; me: Viewer;
  onRelink: () => void;                 // "Choose the deal or client": the editor's own Link box
  onShowProgrammes: () => void;         // scroll to the programme lines
  goto: (tab: 'client' | 'pipeline', what: string) => React.ReactNode;   // today's link to the right tab
  onSaved: (msg: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-attention/30 bg-attention-soft p-4 text-sm text-attention">
      <p className="mb-2 flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" /> Fill these in at the source, and the quotation updates by itself:</p>
      <ul className="space-y-3">
        {fixes.map(f => (
          <li key={f.kind} className="rounded-xl bg-white/70 px-3 py-2.5 text-ink">
            <p className="font-semibold text-attention">{f.text}</p>
            <div className="mt-1.5">
              <FixField fix={f} deal={deal} client={client} refNumber={refNumber} me={me} onRelink={onRelink} onShowProgrammes={onShowProgrammes} goto={goto} onSaved={onSaved} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FixField({ fix, deal, client, refNumber, me, onRelink, onShowProgrammes, goto, onSaved }: {
  fix: QuoteFix; deal: any | null; client: any | null; refNumber: string; me: Viewer;
  onRelink: () => void; onShowProgrammes: () => void; goto: (tab: 'client' | 'pipeline', what: string) => React.ReactNode; onSaved: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [date, setDate] = useState('');
  const [days, setDays] = useState(deal ? String(trainingDays(deal)) : '1');
  const [address, setAddress] = useState('');
  const [employer, setEmployer] = useState('');
  const [pic, setPic] = useState({ name: '', designation: '', phone: '' });

  const run = async (fn: () => Promise<void>, msg: string) => {
    setBusy(true);
    setError('');
    try { await fn(); onSaved(msg); } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };
  const saveBtn = (disabled: boolean, onClick: () => void) => (
    <button type="button" className={btn} disabled={busy || disabled} onClick={onClick}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save</button>
  );
  const err = error ? <p role="alert" className="mt-1 text-sm text-danger">{error}</p> : null;

  switch (fix.kind) {
    case 'deal_date': {
      if (!deal) return null;
      // Same people as the deal itself: its owner, Admin or Management.
      if (me.role === 'rep' && dealOwnerId(deal) !== me.id) return <>{goto('pipeline', 'Set it on the deal')}</>;
      return (
        <>
          <div className="space-y-2">
            <label className="sr-only" htmlFor="fix-date">Training date</label>
            <input id="fix-date" type="date" value={date} onChange={e => setDate(e.target.value)} className={input.replace('w-full', 'w-full sm:w-56')} />
            <TrainingDaysPicker id="fix-days" value={days} onChange={setDays} />
            <div className="flex flex-wrap items-center gap-2">
              {saveBtn(!date || parseTrainingDays(days) === null, () => run(() => updateDoc(doc(db, 'pipelines', deal.id), {
                trainingDate: date,
                trainingDays: parseTrainingDays(days),
                history: [...(deal.history || []), { at: new Date().toISOString(), byId: me.id, byName: me.name, action: `Training date set to ${trainingDateText({ trainingDate: date, trainingDays: parseTrainingDays(days) }, true)} from quotation ${refNumber}` }],
              }), 'Training date saved on the deal'))}
              <span className="text-sm text-ink-soft">Saved on the deal.</span>
            </div>
          </div>
          {err}
        </>
      );
    }
    case 'client_address': {
      if (!client) return null;
      return (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <label className="sr-only" htmlFor="fix-address">Address</label>
            <textarea id="fix-address" rows={2} value={address} onChange={e => setAddress(e.target.value)} placeholder="Company address" className={input} />
            {saveBtn(!address.trim(), () => run(() => updateDoc(doc(db, 'clients', client.id), { address: address.trim()}), 'Address saved in the client list'))}
          </div>
          <p className="mt-1 text-sm text-ink-soft">Saved in the client list.</p>
          {err}
        </>
      );
    }
    case 'client_employer': {
      if (!client) return null;
      return (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <label className="sr-only" htmlFor="fix-employer">Employer name</label>
            <input id="fix-employer" value={employer} onChange={e => setEmployer(e.target.value)} placeholder="Employer name" className={input} />
            {saveBtn(!employer.trim(), () => run(() => updateDoc(doc(db, 'clients', client.id), { employerName: employer.trim() }), 'Employer name saved in the client list'))}
          </div>
          <p className="mt-1 text-sm text-ink-soft">Saved in the client list. Or address the quotation to the company name instead (section 1).</p>
          {err}
        </>
      );
    }
    case 'client_contact': {
      if (!client) return null;
      const save = () => {
        const person = { id: newContactId(), name: pic.name.trim(), designation: pic.designation.trim(), phone: pic.phone.trim(), email: '' };
        const list = [person, ...clientContacts(client)];
        return run(() => updateDoc(doc(db, 'clients', client.id), { contacts: list, ...mainContactFields(list)}), 'Contact person saved in the client list');
      };
      return (
        <>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
            <input value={pic.name} onChange={e => setPic(p => ({ ...p, name: e.target.value }))} placeholder="Name" aria-label="Contact person's name" className={input} />
            <input value={pic.designation} onChange={e => setPic(p => ({ ...p, designation: e.target.value }))} placeholder="Job title (optional)" aria-label="Job title" className={input} />
            <input value={pic.phone} onChange={e => setPic(p => ({ ...p, phone: e.target.value }))} placeholder="Phone (optional)" aria-label="Phone" inputMode="tel" className={input} />
            {saveBtn(!pic.name.trim(), save)}
          </div>
          <p className="mt-1 text-sm text-ink-soft">Saved in the client list as the main contact person.</p>
          {err}
        </>
      );
    }
    case 'no_client':
      return <button type="button" className={linkBtn} onClick={onRelink}>Link a deal or client</button>;
    case 'days_mismatch':
      return <button type="button" className={linkBtn} onClick={onShowProgrammes}>Change the days on that line (section 3), or the training days on the deal</button>;
    case 'programme_gone':
      return <button type="button" className={linkBtn} onClick={onShowProgrammes}>Pick another programme on that line (section 3)</button>;
    default:
      return null;
  }
}
