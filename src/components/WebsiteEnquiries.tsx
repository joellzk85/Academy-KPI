// Website enquiries on My home (Batch 3, Joel 2026-10-30; docs/features/website.md). Each enquiry or registration
// from the website goes to the next rep in turn (serverWebsiteForms.ts). The box shows only when something waits:
// a rep sees their own; Admin and Management see all, the ones not touched within 24 hours first, and can give one
// to someone else. The rep makes it a deal (marked "Came from: Website"; a registration becomes a company deal on
// that run, which is when its seats are held), logs it as only a question, or closes it as not real.
import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, onSnapshot, query, updateDoc, where, writeBatch } from 'firebase/firestore';
import { Globe, Loader2, X } from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import { todayIso } from '../lib/deals';
import { PublicProgramme, joinProblem, listValue, runDays } from '../lib/publicProgrammes';
import { ENQUIRIES, HRDC_ANSWERS, SiteEnquiry, UNTOUCHED_HOURS, WEBSITE_SOURCE, isUntouched } from '../lib/websiteEnquiries';
import { foundByFields } from '../lib/foundBy';
import PanelResizer from './PanelResizer';
import { useFormDraft } from '../lib/useFormDraft';
import DraftBar from './DraftBar';

type Viewer = { id: string; name: string; role: string };
type Person = { id: string; name: string; role: string; active: boolean };

const input = 'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const label = 'mb-1.5 block text-sm font-semibold text-ink';
const btn = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold disabled:opacity-60';
const when = (iso: string) => new Date(iso).toLocaleString('en-MY', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const norm = (s: string) => String(s || '').toLowerCase().replace(/\b(sdn|bhd|berhad|plc|ltd|enterprise|the)\b/g, '').replace(/[^a-z0-9]+/g, '');

/** The enquiries this person should act on: their own (rep), or all still new (Admin, Management). */
export function useWebsiteEnquiries(viewer: Viewer) {
  const staff = viewer.role === 'admin' || viewer.role === 'management';
  const [list, setList] = useState<SiteEnquiry[]>([]);
  useEffect(() => {
    const q = staff ? query(collection(db, ENQUIRIES), where('status', '==', 'new')) : query(collection(db, ENQUIRIES), where('assignedTo', '==', viewer.id), where('status', '==', 'new'));
    return onSnapshot(q, s => setList(s.docs.map(d => ({ id: d.id, ...(d.data() as any) }))), () => setList([]));
  }, [viewer.id, staff]);
  return list;
}

function DealForm({ e, viewer, clients, deals, onDone }: { e: SiteEnquiry; viewer: Viewer; clients: any[]; deals: any[]; onDone: (dealId: string) => void }) {
  const matches = useMemo(() => {
    const k = norm(e.company);
    return k ? clients.filter(c => { const n = norm(c.companyName); return n && (n === k || n.includes(k) || k.includes(n)); }).slice(0, 5) : [];
  }, [clients, e.company]);
  const [f, setF] = useState({ clientId: matches[0]?.id || '', newName: e.company, funding: e.hrdc === 'no' ? 'direct' : 'hrdc', pax: String(e.pax || '') });
  const draft = useFormDraft(viewer.id, `enquiry-deal:${e.id}`, f, setF);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const make = async () => {
    setError('');
    const pax = Math.round(Number(f.pax) || 0);
    if (!f.clientId && !f.newName.trim()) return setError('Pick the client, or type the company name to add it.');
    if (f.clientId === '' && clients.some(c => norm(c.companyName) === norm(f.newName))) return setError('This company is already in the client list: pick it above.');
    setBusy(true);
    try {
      let run: PublicProgramme | null = null;
      if (e.kind === 'register' && e.runId) {
        const rs = await getDoc(doc(db, 'public_programmes', e.runId));
        run = rs.exists() ? ({ id: rs.id, ...(rs.data() as any) }) : null;
        if (!run) throw new Error('That public programme run no longer exists. Make the deal from Deals instead.');
        if (!(pax > 0)) throw new Error('Enter how many people.');
        const problem = joinProblem(run, deals, { participants: pax, value: listValue(run, pax), discountApproved: false }, viewer.role);
        if (problem) throw new Error(problem);
      }
      const now = Date.now();
      const batch = writeBatch(db);
      let clientId = f.clientId;
      let clientName = clients.find(c => c.id === clientId)?.companyName || '';
      if (!clientId) {
        clientId = `client_${now}`;
        clientName = f.newName.trim();
        const contact = { id: `ct_${now}`, name: e.name, designation: '', phone: e.mobile, email: e.email };
        batch.set(doc(db, 'clients', clientId), {
          id: clientId, companyName: clientName, contactName: e.name, designation: '', phone: e.mobile, email: e.email, address: '', industry: '',
          hrdcRegistered: e.hrdc === 'yes', notes: '', contacts: [contact], createdAt: now, createdBy: viewer.id, createdByName: viewer.name,
          ...foundByFields({ id: viewer.id, name: viewer.name }),
        });
      }
      const id = `pipe_${now}`;
      const at = new Date().toISOString();
      const note = [e.kind === 'register' ? `Registered on the website for ${e.runTitle} (${e.runDate}), ${e.pax} pax, HRD Corp: ${HRDC_ANSWERS[e.hrdc as keyof typeof HRDC_ANSWERS] || 'not said'}.` : `Website enquiry${e.programme ? `: ${e.programme}` : ''}.`,
        e.message, `${e.name} · ${e.mobile}${e.email ? ` · ${e.email}` : ''}`].filter(Boolean).join('\n');
      batch.set(doc(db, 'pipelines', id), {
        id, clientId, client: clientName, contactId: '', contactName: e.name,
        ...(run ? { publicMode: true, publicProgrammeId: run.id, programmeId: run.programmeId, courseName: run.title, type: run.type || 'Training', trainingDate: run.trainingDate, trainingDays: runDays(run) }
          : { programmeId: e.programmeId || '', courseName: e.programme || '', type: 'Training', trainingDate: '', trainingDays: 1 }),
        enquiryNote: note, fundingType: f.funding, proposalValue: run ? listValue(run, pax) : 0, participants: run ? pax : (pax || 0),
        requestDate: todayIso(), followUpDate: 'TBD', ownerId: e.assignedTo || viewer.id, ownerName: e.assignedName || viewer.name,
        taggedRepIds: [], notes: '', stage: 'lead', status: 'Pending', proposalSentDate: 'not yet', creatorId: viewer.id, creatorName: viewer.name,
        completedTags: [], appointmentTicked: false, createdAt: now, source: WEBSITE_SOURCE, websiteEnquiryId: e.id, websiteCame: e.came?.source || '', websiteCampaign: e.came?.campaign || '',
        history: [{ at, byId: viewer.id, byName: viewer.name, action: 'Deal created from a website ' + (e.kind === 'register' ? 'registration' : 'enquiry') }],
      });
      batch.update(doc(db, ENQUIRIES, e.id), { status: 'deal', dealId: id, handledById: viewer.id, handledByName: viewer.name, handledAt: at });
      await batch.commit();
      draft.discard();
      onDone(id);
    } catch (err) {
      setError(err instanceof Error && !(err as any).code ? err.message : friendlyError(err));
    }
    setBusy(false);
  };

  return (
    <div className="space-y-3 rounded-xl border border-line p-4">
      <DraftBar draft={draft} what="deal from this enquiry" />
      <div>
        <span className={label}>Client</span>
        <div className="grid gap-1">
          {matches.map(c => (
            <label key={c.id} className="flex min-h-10 items-center gap-2 text-[15px]"><input type="radio" name={`cl-${e.id}`} checked={f.clientId === c.id} onChange={() => setF(v => ({ ...v, clientId: c.id }))} className="accent-[#0E6E62]" /> {c.companyName} <span className="text-sm text-ink-soft">(already a client)</span></label>
          ))}
          <label className="flex min-h-10 items-center gap-2 text-[15px]"><input type="radio" name={`cl-${e.id}`} checked={f.clientId === ''} onChange={() => setF(v => ({ ...v, clientId: '' }))} className="accent-[#0E6E62]" /> New client</label>
          {f.clientId === '' && <input aria-label="New client's company name" value={f.newName} onChange={ev => setF(v => ({ ...v, newName: ev.target.value }))} className={input} />}
          {!matches.length && <p className="text-sm text-ink-soft">No client with a similar name. Check the client list if they may be there under another name.</p>}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`fund-${e.id}`} className={label}>Funding</label>
          <select id={`fund-${e.id}`} value={f.funding} onChange={ev => setF(v => ({ ...v, funding: ev.target.value }))} className={input}>
            <option value="hrdc">HRDC claimable</option><option value="direct">Direct pay</option><option value="hrdc_topup">HRDC + top-up</option>
          </select>
        </div>
        <div>
          <label htmlFor={`pax-${e.id}`} className={label}>Pax</label>
          <input id={`pax-${e.id}`} inputMode="numeric" value={f.pax} onChange={ev => setF(v => ({ ...v, pax: ev.target.value }))} className={input} />
        </div>
      </div>
      {e.kind === 'register' && <p className="text-sm text-ink-soft">It joins the public programme at its list price; its seats are held from now.</p>}
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <button type="button" onClick={make} disabled={busy} className={`${btn} bg-accent text-white hover:bg-[#0B5A50]`}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Make the deal</button>
    </div>
  );
}

function EnquiryPanel({ e, viewer, people, clients, deals, openDeal, onClose }: { e: SiteEnquiry; viewer: Viewer; people: Person[]; clients: any[]; deals: any[]; openDeal: (p: any) => void; onClose: () => void }) {
  const staff = viewer.role === 'admin' || viewer.role === 'management';
  const [mode, setMode] = useState<'' | 'deal' | 'question' | 'not_real'>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [made, setMade] = useState('');

  const close = async (status: 'question' | 'not_real') => {
    if (!note.trim()) return setError(status === 'question' ? 'Write what they asked and what you answered.' : 'Write why it isn\'t real (e.g. a job seeker, a sales pitch, a test).');
    setBusy(true); setError('');
    try {
      await updateDoc(doc(db, ENQUIRIES, e.id), { status, note: note.trim(), handledById: viewer.id, handledByName: viewer.name, handledAt: new Date().toISOString() });
      onClose();
    } catch (err) { setError(friendlyError(err)); }
    setBusy(false);
  };

  const giveTo = async (id: string) => {
    const p = people.find(x => x.id === id);
    if (!p || p.id === e.assignedTo) return;
    try {
      await updateDoc(doc(db, ENQUIRIES, e.id), { assignedTo: p.id, assignedName: p.name, reassigned: [...(e.reassigned || []), { at: new Date().toISOString(), byName: viewer.name, from: e.assignedName || '', to: p.name }] });
    } catch (err) { setError(friendlyError(err)); }
  };

  const row = (k: string, v: React.ReactNode) => v ? <div className="grid grid-cols-[8rem_1fr] gap-2 py-1.5 text-[15px]"><span className="text-ink-soft">{k}</span><span className="min-w-0 break-words">{v}</span></div> : null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" role="dialog" aria-modal="true" aria-label="Website enquiry" onClick={onClose}>
      <PanelResizer />
      <div className="h-full w-full overflow-y-auto bg-white p-6 font-sans text-ink shadow-xl md:w-[var(--panel-w,max(50vw,40rem))] md:min-w-[24rem] md:max-w-[95vw]" onClick={ev => ev.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-accent">{e.kind === 'register' ? 'Registration from the website' : 'Enquiry from the website'}</p>
            <h3 className="text-lg font-bold">{e.company}</h3>
            <p className="text-sm text-ink-soft">{when(e.at)} · given to {e.assignedName || 'nobody yet'}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-ink-soft hover:bg-surface"><X className="h-5 w-5" /></button>
        </div>
        <div className="divide-y divide-line rounded-xl border border-line px-4">
          {row('Name', e.name)}
          {row('Mobile', <a href={`tel:${e.mobile.replace(/[^0-9+]/g, '')}`} className="text-accent">{e.mobile}</a>)}
          {row('WhatsApp', <a href={`https://wa.me/${(e.mobile.replace(/[^0-9]/g, '').replace(/^0/, '60'))}`} target="_blank" rel="noopener" className="text-accent">Message {e.name.split(' ')[0]}</a>)}
          {row('Email', e.email && <a href={`mailto:${e.email}`} className="text-accent">{e.email}</a>)}
          {row('Training date', e.kind === 'register' && `${e.runTitle} · ${e.runDate}`)}
          {row('Pax', e.kind === 'register' && String(e.pax))}
          {row('HRD Corp', e.hrdc && HRDC_ANSWERS[e.hrdc as keyof typeof HRDC_ANSWERS])}
          {row('Programme', e.kind === 'enquiry' && (e.programme || 'Not sure yet'))}
          {row('Message', e.message && <span className="whitespace-pre-line">{e.message}</span>)}
          {row('Sent from', e.page)}
          {row('Came from', e.came && [e.came.source, e.came.campaign && `campaign ${e.came.campaign}`].filter(Boolean).join(' · '))}
        </div>

        {staff && (
          <div className="mt-4">
            <label htmlFor={`give-${e.id}`} className={label}>Give to</label>
            <select id={`give-${e.id}`} value={e.assignedTo} onChange={ev => giveTo(ev.target.value)} className={`${input} sm:w-72`}>
              {!e.assignedTo && <option value="">Nobody yet</option>}
              {people.filter(p => p.active && p.role !== 'accounts').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        )}

        {made ? (
          <div className="mt-5 rounded-xl bg-accent-soft p-4 text-[15px]">
            The deal is made and marked "Came from: Website".{' '}
            <button type="button" className="font-semibold text-accent hover:underline" onClick={() => { const d = deals.find(x => x.id === made); if (d) openDeal(d); onClose(); }}>Open the deal</button>
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="What to do">
              {([['deal', 'Make it a deal'], ['question', 'Only a question'], ['not_real', 'Not real']] as const).map(([k, l]) => (
                <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => { setMode(k); setError(''); }}
                  className={`rounded-lg border px-3 py-2 text-sm font-semibold ${mode === k ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-white text-ink hover:bg-surface'}`}>{l}</button>
              ))}
            </div>
            {mode === 'deal' && <DealForm e={e} viewer={viewer} clients={clients} deals={deals} onDone={setMade} />}
            {(mode === 'question' || mode === 'not_real') && (
              <div className="space-y-3 rounded-xl border border-line p-4">
                <label htmlFor={`note-${e.id}`} className={label}>{mode === 'question' ? 'What they asked and what you answered' : 'Why it isn\'t real'}</label>
                <textarea id={`note-${e.id}`} value={note} onChange={ev => setNote(ev.target.value)} className={`${input} min-h-[80px]`} />
                {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
                <button type="button" onClick={() => close(mode)} disabled={busy} className={`${btn} bg-accent text-white hover:bg-[#0B5A50]`}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} {mode === 'question' ? 'Close as only a question' : 'Close as not real'}</button>
              </div>
            )}
            {!mode && error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

/** The box at the top of My home; nothing shows when nothing waits. */
export default function WebsiteEnquiriesBox({ viewer, people, clients, deals, openDeal }: { viewer: Viewer; people: Person[]; clients: any[]; deals: any[]; openDeal: (p: any) => void }) {
  const list = useWebsiteEnquiries(viewer);
  const [picked, setPicked] = useState<SiteEnquiry | null>(null);   // kept after it's handled, so the panel can say what happened
  const staff = viewer.role === 'admin' || viewer.role === 'management';
  const now = Date.now();
  const sorted = [...list].sort((a, b) => Number(isUntouched(b, now)) - Number(isUntouched(a, now)) || a.at.localeCompare(b.at));
  const open = picked ? list.find(x => x.id === picked.id) || picked : null;
  if (!list.length && !open) return null;
  const late = list.filter(x => isUntouched(x, now)).length;
  return (
    <section className="rounded-2xl border border-accent/30 bg-white p-4" aria-label="Website enquiries">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Globe className="h-5 w-5 text-accent" />
        <h2 className="text-base font-bold">Website enquiries</h2>
        <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-semibold text-accent">{list.length} new</span>
        {staff && late > 0 && <span className="rounded-full bg-danger-soft px-2.5 py-0.5 text-xs font-semibold text-danger">{late} not touched in {UNTOUCHED_HOURS} hours</span>}
      </div>
      <ul className="divide-y divide-line">
        {sorted.slice(0, 8).map(x => (
          <li key={x.id}>
            <button type="button" onClick={() => setPicked(x)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-left hover:bg-surface">
              <span className="font-semibold">{x.company}</span>
              <span className="text-sm text-ink-soft">{x.kind === 'register' ? `Registered: ${x.runTitle}, ${x.pax} pax` : (x.programme || 'Enquiry')}</span>
              <span className="ml-auto text-sm text-ink-soft">{staff ? `${x.assignedName || 'Nobody'} · ` : ''}{when(x.at)}</span>
              {isUntouched(x, now) && <span className="rounded bg-danger-soft px-1.5 text-xs font-semibold text-danger">Waiting</span>}
            </button>
          </li>
        ))}
      </ul>
      {sorted.length > 8 && <p className="pt-1 text-sm text-ink-soft">and {sorted.length - 8} more</p>}
      {open && <EnquiryPanel e={open} viewer={viewer} people={people} clients={clients} deals={deals} openDeal={openDeal} onClose={() => setPicked(null)} />}
    </section>
  );
}
