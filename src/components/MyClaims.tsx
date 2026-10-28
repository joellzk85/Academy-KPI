import React, { useMemo, useState } from 'react';
import { Plus, Receipt } from 'lucide-react';
import { formatRM, todayIso } from '../lib/deals';
import { Claim, ClaimStatus, CLAIM_STATUS_LABELS, canRaiseForOthers, limitsFor, usageFor } from '../lib/claims';
import { useClaimPaid, useClaimSettings, useClaims, useClaimsRaisedBy, withdrawClaim } from '../lib/useClaims';
import { usePaged } from '../lib/listPaging';
import ListPager, { listSelect } from './ListPager';
import { useClientList } from './GrantEmployers';
import { ClaimDetails, ClaimFiles, ClaimForm, ClaimPerson, ClaimRow, ClaimViewer, LimitLines, btnPrimary, btnSecondary } from './ClaimParts';

// My claims (Joel, 2026-10-28): everyone's own claims in their workspace. Submit a new claim, see each claim's status
// (waiting, approved and with accounts, paid, rejected), fix a rejected one and send it again, or withdraw one still
// waiting. The balance of each limit shows at the top. People Management ticked can also raise claims for someone else.

export default function MyClaims({ viewer, people, deals }: { viewer: ClaimViewer; people: ClaimPerson[]; deals: any[] }) {
  const { settings, loaded } = useClaimSettings();
  const forOthers = canRaiseForOthers(settings, viewer);
  const mine = useClaims(true, viewer.id);
  // For limits and duplicates on someone else's claim: everyone's claims (the rules allow it only to those people).
  const everyone = useClaims(forOthers, '');
  const raised = useClaimsRaisedBy(true, viewer.id).filter(c => c.memberId !== viewer.id);
  const clients = useClientList(true);
  const [form, setForm] = useState<{ editing?: Claim } | null>(null);
  const [open, setOpen] = useState('');
  const [status, setStatus] = useState<'' | ClaimStatus>('');
  const [year, setYear] = useState(todayIso().slice(0, 4));
  const [error, setError] = useState('');
  const paid = useClaimPaid(mine || []);

  const pool = forOthers && everyone ? everyone : mine || [];
  const years = useMemo(() => Array.from(new Set([todayIso().slice(0, 4), ...(mine || []).map(c => c.date.slice(0, 4))])).sort().reverse(), [mine]);
  const shown = useMemo(() => (mine || [])
    .filter(c => (!status || c.status === status) && (!year || c.date.startsWith(year)))
    .sort((a, b) => b.date.localeCompare(a.date) || String(b.submittedAt).localeCompare(String(a.submittedAt))), [mine, status, year]);
  const paged = usePaged(shown, [status, year]);
  const withLimits = settings.categories.filter(c => c.active).map(c => ({ c, lim: limitsFor(settings, c, viewer.id) }))
    .filter(({ lim }) => Object.values(lim).some(v => v !== null));
  const waitingTotal = (mine || []).filter(c => c.status === 'pending').reduce((t, c) => t + (Number(c.amount) || 0), 0);

  const withdraw = async (c: Claim) => {
    if (!window.confirm(`Withdraw this ${c.categoryName} claim of ${formatRM(c.amount)}? It and its files are removed.`)) return;
    setError('');
    try { await withdrawClaim(c); } catch { setError('The claim could not be withdrawn. Try again.'); }
  };

  if (form) {
    return (
      <ClaimForm viewer={viewer} settings={settings} claims={pool} people={people} clients={clients} deals={deals}
        editing={form.editing} onDone={() => setForm(null)} />
    );
  }

  const actions = (c: Claim) => (c.status === 'pending' || c.status === 'rejected') && (c.memberId === viewer.id || c.raisedById === viewer.id) && (
    <div className="flex flex-wrap gap-2">
      <button type="button" className={btnSecondary} onClick={() => setForm({ editing: c })}>{c.status === 'rejected' ? 'Fix and send again' : 'Change'}</button>
      <button type="button" className={`${btnSecondary} text-danger`} onClick={() => withdraw(c)}>Withdraw</button>
    </div>
  );
  const body = (c: Claim) => (
    <>
      {c.status === 'rejected' && c.rejectReason && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">Rejected by {c.decidedByName}: {c.rejectReason}</p>}
      {c.status === 'approved' && <p className="text-sm text-ink-soft">Approved by {c.decidedByName}{paid[c.id] ? ', paid' : ', now with accounts for payment'}.</p>}
      {c.special && c.specialReason && <p className="text-sm text-attention">Special request: {c.specialReason}</p>}
      <ClaimDetails c={c} />
      <ClaimFiles files={c.files} />
      {actions(c)}
    </>
  );

  return (
    <section className="space-y-4 font-sans text-ink">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-bold">My claims</h2>
          <p className="text-[15px] text-ink-soft">Medical, travel, sales process, benefits and other claims. A manager approves each one; then accounts pay it.</p>
        </div>
        <button type="button" className={btnPrimary} disabled={!loaded} onClick={() => setForm({})}><Plus className="h-4 w-4" /> New claim</button>
      </div>

      {withLimits.length > 0 && (
        <div className="rounded-2xl border border-line bg-white p-4">
          <p className="mb-2 font-semibold">My limits</p>
          <ul className="space-y-1 text-sm text-ink-soft">
            {withLimits.map(({ c, lim }) => (
              <li key={c.id}><span className="font-semibold text-ink">{c.name}:</span> <LimitLines lim={lim} used={usageFor(mine || [], viewer.id, c.id, todayIso())} asksPax={!!c.fields.attendees} /></li>
            ))}
          </ul>
        </div>
      )}

      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      <div className="overflow-hidden rounded-2xl border border-line bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <select value={status} onChange={e => setStatus(e.target.value as any)} className={listSelect} aria-label="Status">
            <option value="">All claims</option>
            {(Object.keys(CLAIM_STATUS_LABELS) as ClaimStatus[]).map(s => <option key={s} value={s}>{CLAIM_STATUS_LABELS[s]}</option>)}
          </select>
          <select value={year} onChange={e => setYear(e.target.value)} className={listSelect} aria-label="Year">
            <option value="">All years</option>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          {waitingTotal > 0 && <span className="text-sm text-ink-soft">Waiting for approval: <strong className="text-ink">{formatRM(waitingTotal)}</strong></span>}
        </div>
        {mine === null ? <p className="px-4 py-6 text-[15px] text-ink-soft">Loading…</p>
          : !shown.length ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-ink-soft">
              <Receipt className="h-8 w-8" />
              <p className="text-[15px]">{mine.length ? 'No claims match these filters.' : 'No claims yet. Click "New claim" to submit one.'}</p>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {paged.pageItems.map(c => (
                <ClaimRow key={c.id} c={c} open={open === c.id} onToggle={() => setOpen(o => (o === c.id ? '' : c.id))} paidOn={paid[c.id]}>{body(c)}</ClaimRow>
              ))}
            </ul>
          )}
        <ListPager paged={paged} noun="claims" />
      </div>

      {raised.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-line bg-white">
          <p className="border-b border-line px-4 py-3 font-semibold">Claims I raised for others</p>
          <ul className="divide-y divide-line">
            {[...raised].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30).map(c => (
              <ClaimRow key={c.id} c={c} showWho open={open === c.id} onToggle={() => setOpen(o => (o === c.id ? '' : c.id))}>{body(c)}</ClaimRow>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
