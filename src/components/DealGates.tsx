import React, { useEffect, useRef, useState } from 'react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { Loader2, Trophy } from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import {
  DealField, FundingType, FUNDING_LABELS, GAP_LABELS, dealGaps, dealStage, dealValue, formatDate, formatRM, statusForStage, todayIso,
} from '../lib/deals';
import { paxOf } from '../lib/trainingChange';
import { ProgrammePicker } from './Programmes';
import { Programme } from '../lib/programmes';
import { startChecklist, useChecklistSettings } from './DealChecklist';
import { raiseReferralFee } from './Referrers';

// Asking for details when they matter (Joel, 2026-10-18). When a step is blocked, a small box asks only
// for what's missing, right there, then carries on with the step. Shared by the deal panel, the Deals list
// and the quotation editor ("Client signed: mark deal won").

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const label = 'mb-1.5 block text-sm font-semibold text-ink';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';

const history = (p: any, viewer: Viewer, action: string) =>
  [...(p.history || []), { at: new Date().toISOString(), byId: viewer.id, byName: viewer.name, action }];

// The inputs for the missing fields. Values are kept by the parent so they can be saved with the step.
// dealType: set by the picked programme's type (Team building: "Teambuilding", else "Training").
export type GapValues = { clientId: string; programmeId: string; programmeName: string; dealType?: string; value: string; fundingType: FundingType | ''; participants: string };
export const emptyGapValues = (): GapValues => ({ clientId: '', programmeId: '', programmeName: '', value: '', fundingType: '', participants: '' });

function GapInputs({ gaps, values, set, programmes, clients, viewer, kind }: {
  gaps: DealField[]; values: GapValues; set: (c: Partial<GapValues>) => void;
  programmes: Programme[]; clients: any[]; viewer: Viewer; kind?: 'training' | 'teambuilding';
}) {
  return (
    <div className="space-y-3">
      {gaps.includes('client') && (
        <div>
          <label htmlFor="gap-client" className={label}>Client</label>
          <select id="gap-client" value={values.clientId} onChange={e => set({ clientId: e.target.value })} className={input}>
            <option value="">Choose from the client list</option>
            {[...clients].sort((a, b) => String(a.companyName).localeCompare(String(b.companyName))).map(c => <option key={c.id} value={c.id}>{c.companyName}</option>)}
          </select>
        </div>
      )}
      {gaps.includes('programme') && (
        <div>
          <span className={label}>Programme</span>
          <ProgrammePicker programmes={programmes} value={values.programmeId} viewer={viewer} startType={kind === 'teambuilding' ? 'teambuilding' : undefined}
            onChange={(pg, t) => set({ programmeId: pg.id, programmeName: pg.name, dealType: t === 'teambuilding' ? 'Teambuilding' : 'Training' })} />
        </div>
      )}
      {gaps.includes('value') && (
        <div>
          <label htmlFor="gap-value" className={label}>Deal value (RM)</label>
          <input id="gap-value" inputMode="decimal" value={values.value} onChange={e => set({ value: e.target.value.replace(/[^0-9.]/g, '') })} className={input} placeholder="15000" />
        </div>
      )}
      {gaps.includes('funding') && (
        <div>
          <span className={label}>How will it be paid?</span>
          <div className="grid gap-2 sm:grid-cols-3">
            {(Object.keys(FUNDING_LABELS) as FundingType[]).map(ft => (
              <label key={ft} className={`flex cursor-pointer items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm font-semibold ${values.fundingType === ft ? 'border-accent text-accent' : 'border-line hover:bg-surface'}`}>
                <input type="radio" name="gap-funding" checked={values.fundingType === ft} onChange={() => set({ fundingType: ft })} className="accent-[#0E6E62]" />
                {FUNDING_LABELS[ft]}
              </label>
            ))}
          </div>
        </div>
      )}
      {gaps.includes('participants') && (
        <div>
          <label htmlFor="gap-pax" className={label}>Number of participants</label>
          <input id="gap-pax" inputMode="numeric" value={values.participants} onChange={e => set({ participants: e.target.value.replace(/[^0-9]/g, '') })} className={input} placeholder="e.g. 25" />
        </div>
      )}
    </div>
  );
}

// Checks the typed values and turns them into the deal's fields. Returns an error message or the changes.
function gapChanges(gaps: DealField[], v: GapValues, programmes: Programme[], clients: any[]): string | Record<string, any> {
  const out: Record<string, any> = {};
  if (gaps.includes('client')) {
    const c = clients.find(x => x.id === v.clientId);
    if (!c) return 'Choose the client from the client list.';
    Object.assign(out, { clientId: c.id, client: c.companyName });
  }
  if (gaps.includes('programme')) {
    const pg = programmes.find(x => x.id === v.programmeId);
    if (!v.programmeId) return 'Choose the programme from the programme list, or add it as a new programme.';
    Object.assign(out, { programmeId: v.programmeId, courseName: pg?.name || v.programmeName, ...(v.dealType ? { type: v.dealType } : {}) });
  }
  if (gaps.includes('value')) {
    const n = Number(v.value);
    if (!v.value.trim() || !Number.isFinite(n) || n <= 0) return 'Enter the deal value as a number, for example 15000.';
    out.proposalValue = n;
  }
  if (gaps.includes('funding')) {
    if (!v.fundingType) return 'Choose how this training will be paid for.';
    out.fundingType = v.fundingType;
  }
  if (gaps.includes('participants')) {
    const n = Number(v.participants);
    if (!Number.isInteger(n) || n <= 0 || n > 10000) return 'Enter the number of participants, for example 25.';
    out.participants = n;
  }
  return out;
}

// "Proposal sent" or "Client approved: create quotation" was blocked: ask for just the missing details,
// save them on the deal, then carry on with the step.
export function GapsBox({ deal, gaps, step, programmes, clients, viewer, onSaved, onCancel }: {
  deal: any; gaps: DealField[]; step: string; programmes: Programme[]; clients: any[]; viewer: Viewer;
  onSaved: (updated: any) => void; onCancel: () => void;
}) {
  const [v, setV] = useState<GapValues>(emptyGapValues());
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  // The box opens after a click on a step, often far down a long editor (full deal test, 2026-10-23):
  // bring it into view and put the cursor in its first box, so the click never seems to do nothing.
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    box.querySelector<HTMLElement>('input, select, textarea')?.focus({ preventScroll: true });
  }, []);
  const save = async () => {
    const ch = gapChanges(gaps, v, programmes, clients);
    if (typeof ch === 'string') return setErr(ch);
    setBusy(true);
    setErr('');
    try {
      const h = history(deal, viewer, `Added ${gaps.map(g => GAP_LABELS[g].replace(/^the /, '').replace(/ from the .*$/, '')).join(', ')}`);
      await updateDoc(doc(db, 'pipelines', deal.id), { ...ch, history: h });
      onSaved({ ...deal, ...ch, history: h });
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div ref={boxRef} className="rounded-xl border-2 border-attention bg-attention-soft p-4 shadow-md">
      <p className="mb-3 text-sm font-semibold text-attention">Before "{step}", add {gaps.map(g => GAP_LABELS[g]).join(' and ')}:</p>
      <GapInputs gaps={gaps} values={v} set={c => setV(x => ({ ...x, ...c }))} programmes={programmes} clients={clients} viewer={viewer} kind={deal.type === 'Teambuilding' ? 'teambuilding' : 'training'} />
      {err && <p role="alert" className="mt-3 text-sm text-danger">{err}</p>}
      <div className="mt-3 flex gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel}>Cancel</button>
        <button type="button" disabled={busy} className={btnPrimary} onClick={save}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save and continue</button>
      </div>
    </div>
  );
}

// Mark a deal won and hand it to admin (its checklist starts straight away, unless it already has one).
// KPI integrity (2026-10-22): wonOriginal keeps what the deal was worth the moment it was won (Deal checks compare
// it with the value now), and winCount counts every win (a second win is a red flag).
export async function markDealWon(deal: any, wonDate: string, extra: Record<string, any>, viewer: Viewer, settings: any): Promise<string> {
  const value = Number(extra.proposalValue ?? deal.proposalValue) || 0;
  const participants = paxOf({ participants: extra.participants ?? deal.participants });
  await updateDoc(doc(db, 'pipelines', deal.id), {
    ...extra, stage: 'won', status: statusForStage('won'), wonDate, lostReason: '', lostNote: '',
    // The first win's snapshot stays when a deal is won again (process audit, 2026-10-22).
    ...(deal.wonOriginal ? {} : { wonOriginal: { value, participants, date: wonDate, at: new Date().toISOString(), byId: viewer.id, byName: viewer.name } }),
    winCount: (Number(deal.winCount) || 0) + 1,
    history: history(deal, viewer, `Won (${formatRM(value)})`),
  });
  // Referred deal (2026-10-24): the server raises the referral fee request for a manager's approval.
  const refMsg = deal.referrerId ? await raiseReferralFee(deal.id) : '';
  try {
    const existing = await getDoc(doc(db, 'deal_checklists', deal.id));
    await startChecklist(deal, settings, viewer, existing.exists() ? existing.data() : undefined);
    return `Deal won and handed to admin${refMsg ? `. ${refMsg}` : ''}`;
  } catch (err) {
    console.error('Checklist could not be started:', err);
    return `Deal won. Admin can start its checklist from the work queue.${refMsg ? ` ${refMsg}` : ''}`;
  }
}

// "Client signed": the won date, plus any missing details (client, value, funding type), then Confirm.
// Same checks as before: a deal is won only from "Quotation sent".
// No backdating (2026-10-22): the won date is today. Only Management gets a date box (for a deal signed on another day).
export function MarkWonBox({ deal, programmes, clients, viewer, onDone, onCancel }: {
  deal: any; programmes: Programme[]; clients: any[]; viewer: Viewer;
  onDone: (msg: string) => void; onCancel: () => void;
}) {
  const settings = useChecklistSettings();
  const canPickDate = viewer.role === 'management';
  const [wonDate, setWonDate] = useState(todayIso());
  const [v, setV] = useState<GapValues>(emptyGapValues());
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const gaps = dealGaps(deal, 'won', { clientIds: clients.map(c => c.id), programmeIds: programmes.map(x => x.id) });
  const confirm = async () => {
    if (dealStage(deal) !== 'quoted') return setErr('A deal is won when the client signs the quotation. Send the quotation first.');
    if (!wonDate) return setErr('Enter the date the client signed.');
    if (canPickDate && wonDate > todayIso()) return setErr('The date the client signed can\'t be in the future.');
    const ch = gapChanges(gaps, v, programmes, clients);
    if (typeof ch === 'string') return setErr(ch);
    setBusy(true);
    setErr('');
    try {
      onDone(await markDealWon(deal, canPickDate ? wonDate : todayIso(), ch, viewer, settings));
    } catch (e) {
      setErr(friendlyError(e));
      setBusy(false);
    }
  };
  return (
    <div className="rounded-xl border border-accent/30 bg-accent-soft p-4 text-left">
      {canPickDate ? (
        <>
          <label htmlFor={`won-date-${deal.id}`} className="mb-1.5 block text-sm font-semibold text-accent">Date the client signed the quotation</label>
          <input id={`won-date-${deal.id}`} type="date" value={wonDate} max={todayIso()} onChange={e => setWonDate(e.target.value)} className={input} />
        </>
      ) : (
        <p className="text-sm font-semibold text-accent">Today, {formatDate(todayIso())}. Signed on another day? Ask Management.</p>
      )}
      {gaps.length > 0 && (
        <div className="mt-3">
          <p className="mb-2 text-sm font-semibold text-accent">Also add {gaps.map(g => GAP_LABELS[g]).join(' and ')}:</p>
          <GapInputs gaps={gaps} values={v} set={c => setV(x => ({ ...x, ...c }))} programmes={programmes} clients={clients} viewer={viewer} kind={deal.type === 'Teambuilding' ? 'teambuilding' : 'training'} />
        </div>
      )}
      <p className="mt-2 text-sm text-accent">The sale of {formatRM(Number(v.value) || dealValue(deal))} counts toward KPI in the month signed.</p>
      {err && <p role="alert" className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p>}
      <div className="mt-3 flex gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel}>Cancel</button>
        <button type="button" disabled={busy} className={btnPrimary} onClick={confirm}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trophy className="h-4 w-4" />} Confirm won</button>
      </div>
    </div>
  );
}
