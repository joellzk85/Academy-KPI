import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { AlertTriangle, BadgeCheck, CheckCircle2, MessageCircle } from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import { formatDate, formatRM, todayIso } from '../lib/deals';
import { leadTrainerTask } from '../lib/checklist';
import { whatsappShare } from '../lib/trainerLinks';
import { Attention, TrainerRow, overview } from '../lib/trainerOverview';
import { useBankRequests, usePortalInvites, useTrainerAccounts, useTrainerJobs, portalUrl, Stars } from './TrainerPortalAdmin';
import { useVendors } from './VendorsPage';

// Trainers → Overview (2026-10-21; lib/trainerOverview.ts). Admin and Management, plus people Management ticks.

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };

const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';
const chip = (on: boolean) => `rounded-full border px-3 py-1.5 text-sm font-semibold ${on ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-white text-ink hover:bg-surface'}`;

// Who else (besides Admin and Management) may open the Overview: config/trainer_overview.allowedIds.
export function useOverviewAllowed(): string[] {
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => onSnapshot(doc(db, 'config', 'trainer_overview'), s => setIds((s.data()?.allowedIds as string[]) || []), () => setIds([])), []);
  return ids;
}

const PORTAL_TEXT: Record<TrainerRow['portal'], string> = { active: 'Has access', invited: 'Invited', off: 'Turned off', none: 'No access' };

export default function TrainerOverview({ viewer, people, trainers, deals, checklists, programmes, clients, onOpenTrainer }: {
  viewer: Viewer; people: { id: string; name: string; role?: string }[];
  trainers: any[]; deals: any[]; checklists: Record<string, any>; programmes: any[]; clients: any[];
  onOpenTrainer: (id: string) => void;
}) {
  const staff = viewer.role === 'admin' || viewer.role === 'management';
  const accounts = useTrainerAccounts();
  const invites = usePortalInvites(staff);
  const jobs = useTrainerJobs();
  const vendors = useVendors(staff);
  const bankRequests = useBankRequests(staff);
  const allowed = useOverviewAllowed();
  const [outs, setOuts] = useState<any[]>([]);
  const [poDeals, setPoDeals] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!staff) return;
    return onSnapshot(collection(db, 'money_out'), s => setOuts(s.docs.map(d => ({ ...d.data(), id: d.id })).filter((o: any) => !o.deleted && !o.dealDeleted)), () => setOuts([]));
  }, [staff]);
  // Deals whose Trainer step has a PO file (the built-in step's id is "trainer"; any trainer step counts).
  useEffect(() => onSnapshot(collection(db, 'checklist_files'), s => {
    const set = new Set<string>();
    s.docs.forEach(d => {
      const f: any = d.data();
      const task: any = leadTrainerTask(checklists[f.dealId]?.tasks);
      if (task && f.taskId === task.id) set.add(f.dealId);
    });
    setPoDeals(set);
  }, () => setPoDeals(new Set())), [checklists]);

  const today = todayIso();
  const dealLabel = (d: any) => `${clients.find(c => c.id === d.clientId)?.companyName || d.client || 'No client'} · ${programmes.find(p => p.id === d.programmeId)?.name || d.courseName || 'No programme'}${d.trainingDate ? ` · ${formatDate(d.trainingDate)}` : ''}`;
  const data = useMemo(() => overview({
    trainers, deals, checklists, programmes, accounts, invites, jobs, poDeals,
    outs: staff ? outs : null, vendors: staff ? vendors : null, bankRequests: staff ? bankRequests : null, dealLabel, today,
  }), [trainers, deals, checklists, programmes, accounts, invites, jobs, poDeals, outs, vendors, bankRequests, staff, clients, today]);

  const [filter, setFilter] = useState<'all' | 'incomplete' | 'noportal' | 'upcoming'>('incomplete');
  const [showAll, setShowAll] = useState(false);
  const rows = data.rows
    .filter(r => filter === 'all' || (filter === 'incomplete' ? r.missing.length > 0 : filter === 'noportal' ? r.portal !== 'active' : r.upcoming > 0))
    .sort((a, b) => a.pct - b.pct || String(a.trainer.name).localeCompare(String(b.trainer.name)));
  const complete = data.rows.filter(r => r.missing.length === 0).length;
  const withPortal = data.rows.filter(r => r.portal === 'active').length;
  const danger = data.attention.filter(a => a.level === 'danger').length;
  const shown = showAll ? data.attention : data.attention.slice(0, 12);

  const nudge = (r: TrainerRow) => {
    const first = String(r.trainer.name || '').split(' ')[0];
    const what = r.missing.slice(0, 6).join(', ');
    return r.portal === 'active'
      ? whatsappShare(portalUrl(), `Hi ${first}, please complete your NEXT Academy trainer profile in the portal (still missing: ${what}):`, r.trainer.contact)
      : '';
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Trainers" value={String(trainers.length)} />
        <Tile label="With portal access" value={`${withPortal} of ${trainers.length}`} />
        <Tile label="Details complete" value={`${complete} of ${trainers.length}`} />
        <Tile label="Needs attention" value={String(data.attention.length)} sub={danger ? `${danger} urgent` : ''} red={danger > 0} />
      </div>

      <section className="rounded-2xl border border-line bg-white p-4">
        <h3 className="flex items-center gap-2 font-bold"><AlertTriangle className="h-4 w-4 text-attention" /> Needs attention</h3>
        {data.attention.length === 0 ? <p className="mt-2 flex items-center gap-2 text-[15px] text-ink-soft"><CheckCircle2 className="h-5 w-5 text-accent" /> Nothing needs attention. All good.</p> : (
          <>
            <ul className="mt-2 space-y-1.5">
              {shown.map((a, k) => <AttentionRow key={k} a={a} onOpenTrainer={onOpenTrainer} />)}
            </ul>
            {data.attention.length > 12 && <button type="button" className="mt-2 text-sm font-semibold text-accent hover:underline" onClick={() => setShowAll(x => !x)}>{showAll ? 'Show fewer' : `Show all ${data.attention.length}`}</button>}
          </>
        )}
        <p className="mt-3 text-xs text-ink-soft">Checks: trainings in the next 14 days (trainer, PO, PO accepted{staff ? ', bank details' : ''}); trainings that ended in the last 90 days (photos and T3 from portal trainers, rating){staff ? '; fee requests waiting over 7 days; bank accounts to check' : ''}; low ratings; programmes nobody teaches.</p>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold">Trainer details</h3>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Show">
            {([['incomplete', `Incomplete ${data.rows.filter(r => r.missing.length).length}`], ['noportal', `No portal ${data.rows.filter(r => r.portal !== 'active').length}`], ['upcoming', `Training coming up ${data.rows.filter(r => r.upcoming).length}`], ['all', `All ${data.rows.length}`]] as const).map(([k, l]) => (
              <button key={k} type="button" aria-pressed={filter === k} className={chip(filter === k)} onClick={() => setFilter(k)}>{l}</button>
            ))}
          </div>
        </div>
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">
          {rows.length === 0 && <li className="p-5 text-[15px] text-ink-soft">No trainers here.</li>}
          {rows.map(r => (
            <li key={r.trainer.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
              <button type="button" className="min-w-[12rem] flex-1 text-left" onClick={() => onOpenTrainer(r.trainer.id)}>
                <span className="flex items-center gap-2 font-semibold">{r.trainer.name}{r.portal === 'active' && <BadgeCheck className="h-4 w-4 text-accent" aria-label="Has portal access" />}</span>
                <span className="mt-1 flex items-center gap-2">
                  <span className="h-2 w-28 overflow-hidden rounded-full bg-surface"><span className={`block h-full rounded-full ${r.pct >= 80 ? 'bg-accent' : r.pct >= 50 ? 'bg-attention' : 'bg-danger'}`} style={{ width: `${r.pct}%` }} /></span>
                  <span className="text-sm font-semibold tabular-nums">{r.pct}%</span>
                </span>
                {r.missing.length > 0 && <span className="mt-1 block text-sm text-ink-soft">Missing: {r.missing.slice(0, 5).join(', ')}{r.missing.length > 5 ? ` +${r.missing.length - 5} more` : ''}</span>}
              </button>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                <div><dt className="text-ink-soft">Portal</dt><dd className="font-semibold">{PORTAL_TEXT[r.portal]}{r.portal === 'active' && <span className="block font-normal text-ink-soft">{r.lastSeen ? `Used ${formatDate(r.lastSeen.slice(0, 10))}` : 'Not logged in yet'}</span>}</dd></div>
                <div><dt className="text-ink-soft">This year</dt><dd className="font-semibold">{r.trainingsYear} training{r.trainingsYear === 1 ? '' : 's'}{r.feesPaidYear !== null && r.feesPaidYear > 0 && <span className="block font-normal text-ink-soft">{formatRM(r.feesPaidYear)} paid</span>}</dd></div>
                <div><dt className="text-ink-soft">Next</dt><dd className="font-semibold">{r.nextDate ? formatDate(r.nextDate) : '—'}</dd></div>
                <div><dt className="text-ink-soft">Rating</dt><dd className="font-semibold">{r.rated ? <span className="flex items-center gap-1">{r.avg} <Stars n={Math.round(r.avg)} size="h-3.5 w-3.5" /></span> : '—'}</dd></div>
              </dl>
              <div className="flex shrink-0 gap-2">
                {r.missing.length > 0 && nudge(r) && <a href={nudge(r)} target="_blank" rel="noreferrer" className={btnSecondary}><MessageCircle className="h-4 w-4" /> Remind</a>}
                <button type="button" className={btnSecondary} onClick={() => onOpenTrainer(r.trainer.id)}>Open</button>
              </div>
            </li>
          ))}
        </ul>
        <p className="text-xs text-ink-soft">"Remind" sends a WhatsApp asking a portal trainer to fill in what's missing. For trainers without the portal, open them and send a profile link or a portal invite.{staff ? '' : ' Bank details and TIN are checked by Admin and Management only.'}</p>
      </section>

      <section className="rounded-2xl border border-line bg-white p-4">
        <h3 className="font-bold">Programmes and their trainers</h3>
        <p className="text-sm text-ink-soft">How many trainers are ticked to teach each programme. One or none is a risk if that trainer is unavailable.</p>
        <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
          {data.programmes.map(p => (
            <li key={p.id} className="flex items-center justify-between gap-2 rounded-lg bg-surface px-3 py-1.5 text-sm">
              <span className="min-w-0 truncate">{p.name}{p.deals > 0 && <span className="text-ink-soft"> · {p.deals} deal{p.deals === 1 ? '' : 's'}</span>}</span>
              <span className={`shrink-0 font-semibold ${p.trainers === 0 ? 'text-danger' : p.trainers === 1 ? 'text-attention' : 'text-accent'}`}>{p.trainers} trainer{p.trainers === 1 ? '' : 's'}</span>
            </li>
          ))}
        </ul>
      </section>

      {viewer.role === 'management' && <WhoCanSee people={people} allowed={allowed} />}
    </div>
  );
}

function Tile({ label, value, sub, red }: { label: string; value: string; sub?: string; red?: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-white px-3 py-2.5">
      <p className="text-xs font-semibold text-ink-soft">{label}</p>
      <p className={`mt-0.5 text-lg font-bold tabular-nums ${red ? 'text-danger' : ''}`}>{value}</p>
      {sub && <p className="text-xs font-semibold text-danger">{sub}</p>}
    </div>
  );
}

function AttentionRow({ a, onOpenTrainer }: { a: Attention; onOpenTrainer: (id: string) => void }) {
  return (
    <li className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-[15px] ${a.level === 'danger' ? 'border-danger/30 bg-danger-soft/50' : 'border-attention/30 bg-attention-soft/40'}`}>
      <span className="min-w-0 flex-1">{a.text}</span>
      {a.trainerId && <button type="button" className="shrink-0 text-sm font-semibold text-accent hover:underline" onClick={() => onOpenTrainer(a.trainerId!)}>Open trainer</button>}
    </li>
  );
}

// Management: who else may open the Overview (no money or bank details for them).
function WhoCanSee({ people, allowed }: { people: { id: string; name: string; role?: string }[]; allowed: string[] }) {
  const [error, setError] = useState('');
  const others = people.filter(p => p.role !== 'admin' && p.role !== 'management');
  const toggle = async (id: string, on: boolean) => {
    setError('');
    try { await setDoc(doc(db, 'config', 'trainer_overview'), { allowedIds: on ? [...new Set([...allowed, id])] : allowed.filter(x => x !== id) }, { merge: true }); }
    catch (e) { setError(friendlyError(e)); }
  };
  return (
    <section className="rounded-2xl border border-line bg-white p-4">
      <h3 className="font-bold">Who else can see this Overview</h3>
      <p className="text-sm text-ink-soft">Admin and Management always can. Tick others to let them see it too (without money or bank details).</p>
      {others.length === 0 ? <p className="mt-2 text-sm text-ink-soft">No one else on the team.</p> : (
        <div className="mt-2 flex flex-wrap gap-3">
          {others.map(p => (
            <label key={p.id} className="flex cursor-pointer items-center gap-2 text-[15px]">
              <input type="checkbox" className="h-4 w-4 accent-[#0E6E62]" checked={allowed.includes(p.id)} onChange={e => toggle(p.id, e.target.checked)} /> {p.name}
            </label>
          ))}
        </div>
      )}
      {error && <p role="alert" className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
    </section>
  );
}
