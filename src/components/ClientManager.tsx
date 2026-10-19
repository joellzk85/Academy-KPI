import React, { useEffect, useMemo, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, query, setDoc, updateDoc } from 'firebase/firestore';
import {
  Building2, CheckCircle2, ChevronRight, Circle, Download, FileText, ListTodo, Loader2, Mail, MapPin, MessageCircle, Pencil, Phone, Plus, Repeat2, Search, Trash2, X,
} from 'lucide-react';
import { Representative, Client } from '../types';
import { db, friendlyError } from '../lib/firebase';
import { pdfErrorText } from '../lib/oldTab';
import { STAGE_LABELS, dealOwnerId, dealStage, dealValue, dealWonDate, formatDate, formatRM, todayIso } from '../lib/deals';
import { lastWonDeal, repeatDeal, repeatOwner } from '../lib/repeatDeal';
import { MoneyIn } from '../lib/money';
import { linkedOnly } from '../lib/linked';
import { Contact, clientContacts, mainContactFields, newContactId } from '../lib/contacts';
import { ProposalFile } from '../lib/proposals';
import { openProposalFile } from './ProposalFiles';
import {
  COLOUR_LABELS, ClientSummary, ClientTouchPoint, ContactColour, FILTER_LABELS, TOUCH_HOW_LABELS, TimelineEntry, TimelineFilter, TouchHow,
  agoText, clientDeals, clientQuotes, entryInFilter, newTouchPointId, summariseClient, taskAssignees, taskClientIds,
} from '../lib/touchPoints';
import { daysBetween } from '../lib/followUps';
import { useContactLimits, useTeamList, useTouchPoints } from '../lib/useClientHistory';
import { ContactBadge, ContactDot } from './ClientContactDot';
import { useTbLinks } from '../lib/useProposalLinks';
import { useProposalSettings } from '../lib/useProposalSettings';
import { canSeeTracking } from '../lib/proposalTracking';

// Clients (redesigned 2026-10-17): one shared list, the same details as before.
// Anyone can add and edit; only Management can delete, and only a client no deal or quotation uses.
// Client history (2026-10-18): the client page shows every touch point (lib/touchPoints.ts), "Add touch point",
// last touch point and next follow-up, open To-dos tagged with the client, and the client's Notes. The list shows
// a colour dot for how recently each client was contacted, with sorting, filters and counts.

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };

interface ClientManagerProps {
  rep: Representative;
  reps: Representative[];
  viewer: Viewer;
  onOpenDeal?: (dealId: string) => void;
  onOpenQuotation?: (quoteId: string) => void;
  onOpenQuoteFromDeal?: (dealId: string, quoteId: string) => void;   // "Repeat last deal": open the copied quotation, Back to deal
  onOpenOutline?: (outlineId: string) => void;
  onOpenTask?: (taskId: string) => void;
  openClientId?: string | null;          // open this client's page (from a To-do tag or My home)
  onOpenClientHandled?: () => void;
}

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const label = 'mb-1.5 block text-sm font-semibold text-ink';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';
const select = 'rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';

// Contact persons (PICs): a client can have several (Joel, 2026-10-17). The first is the main one.
const emptyContact = (): Contact => ({ id: newContactId(), name: '', designation: '', phone: '', email: '' });
const emptyForm = () => ({
  companyName: '', employerName: '', industry: '', address: '', hrdcRegistered: true,
  contacts: [emptyContact()] as Contact[],
});
type Form = ReturnType<typeof emptyForm>;

const norm = (s?: string) => (s || '').trim().toLowerCase();
const shown = (s?: string) => (s && s.trim() && s.trim() !== 'N/A' ? s.trim() : '');

// Malaysian numbers: 012-345 6789 -> 60123456789 for WhatsApp.
function whatsappLink(phone: string): string {
  let d = phone.replace(/\D/g, '');
  if (d.startsWith('0')) d = '6' + d;
  return d.length >= 9 ? `https://wa.me/${d}` : '';
}

type SortBy = 'name' | 'quiet' | 'recent' | 'next';
const SORT_LABELS: Record<SortBy, string> = {
  name: 'Client name A to Z',
  quiet: 'Longest without a touch point',
  recent: 'Most recently contacted',
  next: 'Next follow-up soonest',
};
const COLOURS: ContactColour[] = ['green', 'amber', 'red', 'never'];

// "12 Oct 2026 by Alif (call)"
const lastLine = (e: TimelineEntry) => `${formatDate(e.date)}${e.byName ? ` by ${e.byName}` : ''}${e.how ? ` (${e.how === 'WhatsApp' ? e.how : e.how.toLowerCase()})` : ''}`;

export default function ClientManager({ rep, reps, viewer, onOpenDeal, onOpenQuotation, onOpenQuoteFromDeal, onOpenOutline, onOpenTask, openClientId, onOpenClientHandled }: ClientManagerProps) {
  const [clients, setClients] = useState<Client[]>([]);
  const [deals, setDeals] = useState<any[]>([]);
  const [quotes, setQuotes] = useState<any[]>([]);
  const [outlines, setOutlines] = useState<any[]>([]);
  const [files, setFiles] = useState<ProposalFile[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  // Every record, including old ones not linked yet (hidden on screen), so nothing they use can be deleted.
  const [allDeals, setAllDeals] = useState<any[]>([]);
  const [allQuotes, setAllQuotes] = useState<any[]>([]);
  const [moneyIn, setMoneyIn] = useState<MoneyIn[]>([]);
  const [loaded, setLoaded] = useState(false);
  const touchPoints = useTouchPoints();
  const { limits } = useContactLimits();
  const team = useTeamList();

  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('name');
  const [colourFilter, setColourFilter] = useState<ContactColour | ''>('');
  const [quietDays, setQuietDays] = useState(0);
  const [followUpBy, setFollowUpBy] = useState('');
  const [whose, setWhose] = useState('');          // '' everyone, else a person's id ("My clients" = mine)
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<'new' | string | null>(null);
  const [form, setForm] = useState<Form>(emptyForm());
  const [formError, setFormError] = useState('');
  const [dupId, setDupId] = useState<string | null>(null);
  const [panelError, setPanelError] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    const subs = [
      onSnapshot(query(collection(db, 'clients')), s => { setClients(s.docs.map(d => ({ ...(d.data() as Client), id: d.id }))); setLoaded(true); }, () => setLoaded(true)),
      onSnapshot(query(collection(db, 'pipelines')), s => { const all = s.docs.map(d => ({ ...d.data(), id: d.id })); setAllDeals(all); setDeals(linkedOnly(all)); }),
      onSnapshot(query(collection(db, 'quotations')), s => { const all = s.docs.map(d => ({ ...d.data(), id: d.id })); setAllQuotes(all); setQuotes(linkedOnly(all)); }),
      onSnapshot(query(collection(db, 'course_outlines')), s => setOutlines(linkedOnly(s.docs.map(d => ({ ...d.data(), id: d.id })))), () => {}),
      onSnapshot(query(collection(db, 'proposal_files')), s => setFiles(s.docs.map(d => ({ ...(d.data() as ProposalFile), id: d.id }))), () => {}),
      onSnapshot(query(collection(db, 'tasks')), s => setTasks(s.docs.map(d => ({ ...d.data(), id: d.id })).filter((t: any) => !t.isDuplicate && taskClientIds(t).length)), () => {}),
      onSnapshot(query(collection(db, 'money_in')), s => setMoneyIn(s.docs.map(d => ({ ...(d.data() as MoneyIn), id: d.id })))),
    ];
    return () => subs.forEach(u => u());
  }, []);

  // Opened from a To-do tag or My home.
  useEffect(() => {
    if (!openClientId) return;
    setOpenId(openClientId);
    setEditing(null);
    onOpenClientHandled?.();
  }, [openClientId]);

  // "Repeat last deal" (Joel, 2026-10-19): the client's most recently won deal again (lib/repeatDeal.ts).
  const repeatLast = async (c: Client) => {
    const src = lastWonDeal(deals, c.id);
    if (!src) return;
    const owner = repeatOwner(src, viewer, reps.map(r => ({ id: r.id, name: r.name })));
    const prog = src.courseName || 'the same programme';
    if (!window.confirm(`Start a new deal for ${c.companyName}: ${prog}${dealValue(src) ? `, ${formatRM(dealValue(src))}` : ''}, for ${owner.name}?

It repeats the deal won on ${formatDate(dealWonDate(src))}, goes straight to "Client approved" (no proposal needed) and opens a copy of its quotation with today's date.`)) return;
    setBusy(true);
    setPanelError('');
    try {
      const r = await repeatDeal(src, viewer, reps.map(x => ({ id: x.id, name: x.name })), quotes);
      flash('Repeat deal created');
      if (onOpenQuoteFromDeal) onOpenQuoteFromDeal(r.dealId, r.quoteId);
      else onOpenDeal?.(r.dealId);
    } catch (e) {
      setPanelError(`The repeat deal couldn't be created: ${friendlyError(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const flash = (t: string) => { setToast(t); window.setTimeout(() => setToast(x => (x === t ? '' : x)), 3500); };
  const personName = (id: string) => team.find(p => p.id === id)?.name || reps.find(r => r.id === id)?.name || (id === viewer.id ? viewer.name : 'Former team member');
  const today = todayIso();
  const staff = viewer.role !== 'rep';

  // Teambuilding proposal links: "Client opened the proposal" on the timeline, for people allowed to see tracking.
  const tbLinks = useTbLinks();
  const seeTracking = canSeeTracking(viewer.role, useProposalSettings());
  const summaries = useMemo(() => {
    const out: Record<string, ClientSummary> = {};
    const all = { deals, quotes, outlines, files, touchPoints, tasks, links: seeTracking ? tbLinks : [] };
    clients.forEach(c => { out[c.id] = summariseClient(c, all, personName, today, limits); });
    return out;
  }, [clients, deals, quotes, outlines, files, touchPoints, tasks, limits, team, today, tbLinks, seeTracking]);

  const dealCount = (c: Client) => clientDeals(c, deals).length;

  // Everything but the colour filter, so the counts show what tapping a colour would leave.
  const filtered = useMemo(() => {
    const q = norm(search);
    return clients.filter(c => {
      const s = summaries[c.id];
      if (!s) return false;
      if (q && ![c.companyName, c.employerName, c.industry, ...clientContacts(c).flatMap(p => [p.name, p.phone, p.email])].some(v => norm(v).includes(q))) return false;
      if (whose && !s.people.has(whose)) return false;
      if (followUpBy && !s.followUps.some(f => f.byId === followUpBy)) return false;
      if (quietDays && s.last && daysBetween(s.last.date, today) <= quietDays) return false;
      return true;
    });
  }, [clients, summaries, search, whose, followUpBy, quietDays, today]);

  const counts = useMemo(() => {
    const out: Record<ContactColour, number> = { green: 0, amber: 0, red: 0, never: 0 };
    filtered.forEach(c => { out[summaries[c.id].colour]++; });
    return out;
  }, [filtered, summaries]);

  const visible = useMemo(() => {
    const list = colourFilter ? filtered.filter(c => summaries[c.id].colour === colourFilter) : filtered;
    const byName = (a: Client, b: Client) => (a.companyName || '').localeCompare(b.companyName || '', 'en', { sensitivity: 'base' });
    const lastOf = (c: Client) => summaries[c.id].last?.date || '';
    const nextOf = (c: Client) => summaries[c.id].next?.date || '';
    return [...list].sort((a, b) => {
      if (sortBy === 'quiet') return (lastOf(a) || '0000').localeCompare(lastOf(b) || '0000') || byName(a, b);   // never contacted first
      if (sortBy === 'recent') return lastOf(b).localeCompare(lastOf(a)) || byName(a, b);
      if (sortBy === 'next') return (nextOf(a) || '9999').localeCompare(nextOf(b) || '9999') || byName(a, b);
      return byName(a, b);
    });
  }, [filtered, colourFilter, sortBy, summaries]);

  const openClient = clients.find(c => c.id === openId) || null;
  const activeTeam = team.filter(p => p.active);
  const anyFilter = !!(colourFilter || quietDays || followUpBy || whose || search.trim());

  // ---------- Add / edit ----------
  const startNew = () => {
    setForm({ ...emptyForm(), companyName: search.trim() });
    setFormError(''); setDupId(null); setEditing('new');
  };
  const startEdit = (c: Client) => {
    setForm({
      companyName: c.companyName || '', employerName: c.employerName || '', industry: c.industry || '', address: c.address || '', hrdcRegistered: !!c.hrdcRegistered,
      contacts: clientContacts(c).length ? clientContacts(c) : [emptyContact()],
    });
    setFormError(''); setDupId(null); setEditing(c.id);
  };
  const set = (patch: Partial<Form>) => setForm(f => ({ ...f, ...patch }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(''); setDupId(null);
    const name = form.companyName.trim();
    if (!name) return setFormError('Enter the company name.');
    const dup = clients.find(c => c.id !== editing && norm(c.companyName) === norm(name));
    if (dup) { setDupId(dup.id); return setFormError(`"${dup.companyName}" is already in the client list.`); }
    const contacts = form.contacts
      .map(p => ({ id: p.id || newContactId(), name: (p.name || '').trim(), designation: (p.designation || '').trim(), phone: (p.phone || '').trim(), email: (p.email || '').trim() }))
      .filter(p => p.name || p.phone || p.email);
    if (contacts.some(p => !p.name)) return setFormError('Every contact person needs a name.');
    const badEmail = contacts.find(p => p.email && !/^\S+@\S+\.\S+$/.test(p.email));
    if (badEmail) return setFormError(`${badEmail.name}'s email address doesn't look right.`);

    // Notes have their own box on the client page (with who changed them last), so the form leaves them alone.
    const details = {
      companyName: name, employerName: form.employerName.trim(), industry: form.industry.trim(), address: form.address.trim(), hrdcRegistered: form.hrdcRegistered,
      contacts, ...mainContactFields(contacts),
    };
    setBusy(true);
    try {
      if (editing === 'new') {
        const id = `client_${Date.now()}`;
        await setDoc(doc(db, 'clients', id), { id, ...details, notes: '', createdAt: Date.now(), createdBy: viewer.id, createdByName: viewer.name });
        setOpenId(id);
        flash('Client added');
      } else if (editing) {
        await setDoc(doc(db, 'clients', editing), details, { merge: true });
        flash('Client saved');
      }
      setEditing(null);
    } catch (err) {
      setFormError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  // ---------- Delete (Management only) ----------
  const remove = async (c: Client) => {
    setPanelError('');
    const nd = clientDeals(c, allDeals).length, nq = clientQuotes(c, allQuotes, allDeals).length;
    if (nd || nq) {
      const parts = [nd ? `${nd} deal${nd === 1 ? '' : 's'}` : '', nq ? `${nq} quotation${nq === 1 ? '' : 's'}` : ''].filter(Boolean);
      return setPanelError(`This client can't be deleted because ${parts.join(' and ')} use${nd + nq === 1 ? 's' : ''} it.`);
    }
    if (!window.confirm(`Delete ${c.companyName} from the client list? This can't be undone.`)) return;
    setBusy(true);
    try {
      await deleteDoc(doc(db, 'clients', c.id));
      setOpenId(null);
      flash('Client deleted');
    } catch (err) {
      setPanelError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5 font-sans text-ink">
      {toast && (
        <div role="status" className="fixed right-4 top-4 z-[60] rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white shadow-lg">{toast}</div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Clients</h2>
          <p className="text-[15px] text-ink-soft">{clients.length} {clients.length === 1 ? 'company' : 'companies'}, shared by the whole team</p>
        </div>
        <button type="button" onClick={startNew} className={btnPrimary}><Plus className="h-4 w-4" /> Add client</button>
      </div>

      {/* Colour counts: tap one to show only those */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by how recently each client was contacted">
        {COLOURS.map(col => (
          <button key={col} type="button" aria-pressed={colourFilter === col} onClick={() => setColourFilter(f => (f === col ? '' : col))}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold ${colourFilter === col ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink hover:bg-surface'}`}>
            <ContactDot colour={col} /> {COLOUR_LABELS[col]} {counts[col]}
          </button>
        ))}
        <span className="self-center text-sm text-ink-soft">Green up to {limits.green} days, amber up to {limits.amber}, red after that</span>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search company, person, phone or email" className={`${input} pl-9`} aria-label="Search clients" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm text-ink-soft">Sort
          <select value={sortBy} onChange={e => setSortBy(e.target.value as SortBy)} className={select} aria-label="Sort clients">
            {(Object.keys(SORT_LABELS) as SortBy[]).map(k => <option key={k} value={k}>{SORT_LABELS[k]}</option>)}
          </select>
        </label>
        <select value={whose} onChange={e => setWhose(e.target.value)} className={select} aria-label="Whose clients">
          <option value="">All clients</option>
          <option value={viewer.id}>My clients</option>
          {staff && activeTeam.filter(p => p.id !== viewer.id).map(p => <option key={p.id} value={p.id}>{p.name}'s clients</option>)}
        </select>
        <select value={quietDays} onChange={e => setQuietDays(Number(e.target.value))} className={select} aria-label="Not contacted in">
          <option value={0}>Any last contact</option>
          {[30, 60, 90].map(d => <option key={d} value={d}>Not contacted in {d} days</option>)}
        </select>
        <select value={followUpBy} onChange={e => setFollowUpBy(e.target.value)} className={select} aria-label="Follow-up by">
          <option value="">Follow-up by anyone</option>
          {activeTeam.map(p => <option key={p.id} value={p.id}>Follow-up by {p.id === viewer.id ? 'me' : p.name}</option>)}
        </select>
        {anyFilter && (
          <button type="button" className="text-sm font-semibold text-accent hover:underline"
            onClick={() => { setColourFilter(''); setQuietDays(0); setFollowUpBy(''); setWhose(''); setSearch(''); }}>Clear filters</button>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-white">
        {!loaded ? (
          <p className="flex items-center gap-2 p-6 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading clients…</p>
        ) : visible.length === 0 ? (
          <div className="p-8 text-center">
            <p className="font-semibold">{clients.length === 0 ? 'No clients yet' : search.trim() ? `No client matches "${search.trim()}"` : 'No client matches these filters'}</p>
            <p className="mt-1 text-[15px] text-ink-soft">
              {clients.length === 0 ? 'Add your first client, or add one from a deal.' : search.trim() ? 'Check the spelling, or add them as a new client.' : 'Try clearing a filter.'}
            </p>
            {clients.length > 0 && search.trim() && <button type="button" onClick={startNew} className={`${btnSecondary} mt-3`}><Plus className="h-4 w-4" /> Add "{search.trim()}"</button>}
          </div>
        ) : (
          <>
            <div className="hidden gap-4 border-b border-line bg-surface px-5 py-2 text-xs font-semibold uppercase tracking-wide text-ink-soft lg:grid lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_5rem]">
              <span>Client</span><span>Last touch point</span><span>Next follow-up</span><span className="text-right">Deals</span>
            </div>
            <ul className="divide-y divide-line">
              {visible.map(c => {
                const s = summaries[c.id];
                const contact = [shown(c.contactName), shown(c.phone)].filter(Boolean).join(' · ');
                const n = dealCount(c);
                const late = !!s.next && s.next.date < today;
                return (
                  <li key={c.id}>
                    <button type="button" onClick={() => { setOpenId(c.id); setPanelError(''); }}
                      className="grid w-full gap-1 px-5 py-3.5 text-left hover:bg-surface lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_5rem] lg:items-center lg:gap-4">
                      <span className="min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="truncate font-semibold">{c.companyName}</span>
                          {c.hrdcRegistered && <span className="hidden shrink-0 rounded-md bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent sm:inline">HRDC</span>}
                        </span>
                        {shown(c.employerName) && <span className="block truncate text-sm text-ink-soft">Employer: {c.employerName}</span>}
                        <span className="block truncate text-sm text-ink-soft">{contact || 'No contact person yet'}</span>
                      </span>
                      <span className="min-w-0 text-sm">
                        <ContactBadge colour={s.colour} text={agoText(s.last?.date || '', today)} />
                        {s.last && <span className="block truncate text-ink-soft">{lastLine(s.last)}</span>}
                      </span>
                      <span className={`min-w-0 text-sm ${late ? 'font-semibold text-danger' : 'text-ink-soft'}`}>
                        {s.next ? <><span className="lg:hidden">Next follow-up: </span>{formatDate(s.next.date)} by {s.next.byName}{late ? ' (overdue)' : ''}</> : <span className="hidden lg:inline">None planned</span>}
                      </span>
                      <span className="text-sm text-ink-soft lg:text-right">{n ? `${n} deal${n === 1 ? '' : 's'}` : 'No deals'}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      {/* Client panel */}
      {openClient && !editing && summaries[openClient.id] && (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" role="dialog" aria-modal="true" onClick={() => setOpenId(null)}>
          <div className="h-full w-full md:w-1/2 md:min-w-[40rem] overflow-y-auto bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <ClientPanel
              key={openClient.id}
              client={openClient}
              summary={summaries[openClient.id]}
              deals={clientDeals(openClient, deals)}
              quotes={clientQuotes(openClient, quotes, deals)}
              outlines={outlines}
              files={files}
              tasks={tasks.filter(t => taskClientIds(t).includes(openClient.id))}
              touchPoints={touchPoints}
              moneyIn={moneyIn}
              team={activeTeam}
              personName={personName}
              viewer={viewer}
              today={today}
              canDelete={viewer.role === 'management'}
              busy={busy}
              error={panelError}
              onClose={() => setOpenId(null)}
              onEdit={() => startEdit(openClient)}
              onDelete={() => remove(openClient)}
              onRepeat={lastWonDeal(deals, openClient.id) ? () => repeatLast(openClient) : undefined}
              flash={flash}
              onOpenDeal={onOpenDeal}
              onOpenQuotation={onOpenQuotation}
              onOpenOutline={onOpenOutline}
              onOpenTask={onOpenTask}
            />
          </div>
        </div>
      )}

      {/* Add / edit form */}
      {editing && (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" role="dialog" aria-modal="true">
          <div className="h-full w-full md:w-1/2 md:min-w-[40rem] overflow-y-auto bg-white p-6 shadow-xl">
            <div className="mb-5 flex items-start justify-between gap-4">
              <h3 className="text-lg font-bold">{editing === 'new' ? 'Add client' : 'Edit client'}</h3>
              <button type="button" onClick={() => setEditing(null)} className="rounded-md p-1 text-ink-soft hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={save} className="space-y-6">
              <fieldset className="space-y-4">
                <legend className="mb-3 text-[15px] font-bold">Company</legend>
                <div>
                  <label className={label} htmlFor="c-name">Company name</label>
                  <input id="c-name" value={form.companyName} onChange={e => set({ companyName: e.target.value })} placeholder="e.g. ABC Manufacturing Sdn Bhd" className={input} autoFocus />
                </div>
                <div>
                  <label className={label} htmlFor="c-employer">Employer name <span className="font-normal text-ink-soft">(optional, e.g. the name registered with HRD Corp if it differs)</span></label>
                  <input id="c-employer" value={form.employerName} onChange={e => set({ employerName: e.target.value })} placeholder="e.g. ABC Holdings Sdn Bhd" className={input} />
                  <p className="mt-1 text-sm text-ink-soft">Shown in Project P&amp;L. Each quotation can be addressed to this name instead of the company name.</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className={label} htmlFor="c-industry">Industry <span className="font-normal text-ink-soft">(optional)</span></label>
                    <input id="c-industry" value={form.industry} onChange={e => set({ industry: e.target.value })} placeholder="e.g. Manufacturing" className={input} />
                  </div>
                  <label className="flex cursor-pointer items-center gap-2.5 self-end pb-2 text-[15px]">
                    <input type="checkbox" checked={form.hrdcRegistered} onChange={e => set({ hrdcRegistered: e.target.checked })} className="h-4 w-4 accent-[#0E6E62]" />
                    HRDC registered
                  </label>
                </div>
                <div>
                  <label className={label} htmlFor="c-address">Address <span className="font-normal text-ink-soft">(optional, printed on quotations)</span></label>
                  <textarea id="c-address" value={form.address} onChange={e => set({ address: e.target.value })} rows={3} className={`${input} resize-y`} />
                </div>
              </fieldset>

              <fieldset className="space-y-3">
                <legend className="mb-1 text-[15px] font-bold">Contact persons</legend>
                <p className="text-sm text-ink-soft">The first is the main contact. Deals pick their attention person from this list.</p>
                {form.contacts.map((p, i) => {
                  const setP = (patch: Partial<Contact>) => set({ contacts: form.contacts.map((x, k) => (k === i ? { ...x, ...patch } : x)) });
                  return (
                    <div key={p.id} className="rounded-xl border border-line p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-ink-soft">{i === 0 ? 'Main contact' : `Contact ${i + 1}`}</span>
                        <span className="flex gap-3 text-sm font-semibold">
                          {i > 0 && <button type="button" className="text-accent hover:underline" onClick={() => set({ contacts: [p, ...form.contacts.filter((_, k) => k !== i)] })}>Make main</button>}
                          {form.contacts.length > 1 && <button type="button" className="text-danger hover:underline" onClick={() => set({ contacts: form.contacts.filter((_, k) => k !== i) })}>Remove</button>}
                        </span>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <input value={p.name} onChange={e => setP({ name: e.target.value })} placeholder="Name" aria-label={`Contact ${i + 1} name`} className={input} />
                        <input value={p.designation || ''} onChange={e => setP({ designation: e.target.value })} placeholder="Job title, e.g. HR Manager" aria-label={`Contact ${i + 1} job title`} className={input} />
                        <input type="tel" value={p.phone || ''} onChange={e => setP({ phone: e.target.value })} placeholder="Phone, e.g. 012-345 6789" aria-label={`Contact ${i + 1} phone`} className={input} />
                        <input type="email" value={p.email || ''} onChange={e => setP({ email: e.target.value })} placeholder="Email" aria-label={`Contact ${i + 1} email`} className={input} />
                      </div>
                    </div>
                  );
                })}
                <button type="button" className={btnSecondary} onClick={() => set({ contacts: [...form.contacts, emptyContact()] })}><Plus className="h-4 w-4" /> Add another contact person</button>
              </fieldset>

              <p className="text-sm text-ink-soft">Notes about the client are in the Notes box on the client page.</p>

              {formError && (
                <div role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">
                  {formError}
                  {dupId && (
                    <button type="button" onClick={() => { setEditing(null); setOpenId(dupId); }} className="ml-2 font-semibold underline">Open it</button>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                <button type="submit" disabled={busy} className={btnPrimary}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{editing === 'new' ? 'Add client' : 'Save'}</button>
                <button type="button" onClick={() => setEditing(null)} className={btnSecondary}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function ClientPanel(props: {
  client: Client; summary: ClientSummary; deals: any[]; quotes: any[]; outlines: any[]; files: ProposalFile[]; tasks: any[];
  touchPoints: ClientTouchPoint[]; moneyIn: MoneyIn[]; team: { id: string; name: string }[]; personName: (id: string) => string;
  viewer: Viewer; today: string; canDelete: boolean; busy: boolean; error: string; key?: string;
  onClose: () => void; onEdit: () => void; onDelete: () => void; flash: (t: string) => void;
  onRepeat?: () => void;   // the client has a won deal: "Repeat last deal"
  onOpenDeal?: (dealId: string) => void; onOpenQuotation?: (quoteId: string) => void; onOpenOutline?: (outlineId: string) => void; onOpenTask?: (taskId: string) => void;
}) {
  const { client: c, deals, summary: s, today } = props;
  const contacts = clientContacts(c);
  const dealIds = new Set(deals.map(d => d.id));
  const money = props.moneyIn.filter(m => dealIds.has(m.dealId));
  const invoiced = money.reduce((sum, m) => sum + (Number(m.amount) || 0), 0);
  const received = money.reduce((sum, m) => sum + (Number(m.paidAmount) || 0), 0);
  const won = deals.filter(d => dealStage(d) === 'won');
  const sortedDeals = [...deals].sort((a, b) => String(b.requestDate || b.id).localeCompare(String(a.requestDate || a.id)));
  const openTasks = props.tasks.filter(t => t.status !== 'Done').sort((a, b) => String(a.dateline || '9999').localeCompare(String(b.dateline || '9999')));
  const [adding, setAdding] = useState(false);
  const late = !!s.next && s.next.date < today;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-lg font-bold"><Building2 className="h-5 w-5 shrink-0 text-accent" /> <span className="truncate">{c.companyName}</span></h3>
          {shown(c.employerName) && <p className="mt-0.5 text-[15px]"><span className="text-ink-soft">Employer name:</span> {c.employerName}</p>}
          <p className="mt-0.5 text-[15px] text-ink-soft">{[shown(c.industry), c.hrdcRegistered ? 'HRDC registered' : 'Not HRDC registered'].filter(Boolean).join(' · ')}</p>
        </div>
        <button type="button" onClick={props.onClose} className="rounded-md p-1 text-ink-soft hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
      </div>

      {/* Last touch point and next follow-up: both from the timeline, never typed */}
      <section className="space-y-1.5 rounded-xl border border-line bg-surface p-4 text-[15px]">
        <p className="flex flex-wrap items-center gap-x-2">
          <span className="font-semibold">Last touch point:</span>
          {s.last ? <><span>{lastLine(s.last)}</span><ContactBadge colour={s.colour} text={agoText(s.last.date, today)} /></> : <ContactBadge colour="never" text="Never contacted" />}
        </p>
        <p className={late ? 'font-semibold text-danger' : ''}>
          <span className="font-semibold">Next follow-up:</span>{' '}
          {s.next ? `${formatDate(s.next.date)} by ${s.next.byName}${late ? ' (overdue)' : ''}` : <span className="text-ink-soft">none planned</span>}
          {s.followUps.length > 1 && <span className="font-normal text-ink-soft"> · {s.followUps.length - 1} more</span>}
        </p>
      </section>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setAdding(true)} className={btnPrimary}><Plus className="h-4 w-4" /> Add touch point</button>
        <button type="button" onClick={props.onEdit} className={btnSecondary}><Pencil className="h-4 w-4" /> Edit details</button>
        {props.onRepeat && <button type="button" disabled={props.busy} onClick={props.onRepeat} className={btnSecondary}><Repeat2 className="h-4 w-4" /> Repeat last deal</button>}
      </div>

      {adding && (
        <TouchPointForm client={c} team={props.team} viewer={props.viewer} today={today}
          onCancel={() => setAdding(false)} onSaved={() => { setAdding(false); props.flash('Touch point added'); }} />
      )}

      {openTasks.length > 0 && (
        <section className="rounded-xl border border-attention/30 bg-attention-soft/50 p-4">
          <h4 className="flex items-center gap-1.5 text-[15px] font-bold"><ListTodo className="h-4 w-4 text-attention" /> Open To-dos ({openTasks.length})</h4>
          <ul className="mt-2 divide-y divide-line/70">
            {openTasks.map(t => {
              const due = /^\d{4}-\d{2}-\d{2}/.test(t.dateline || '') ? t.dateline.slice(0, 10) : '';
              return (
                <li key={t.id} className="py-2">
                  <button type="button" disabled={!props.onOpenTask} onClick={() => props.onOpenTask?.(t.id)} className="flex w-full items-start gap-2 text-left disabled:cursor-default">
                    <Circle className={`mt-0.5 h-4 w-4 shrink-0 ${due && due < today ? 'text-danger' : 'text-ink-soft/60'}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block whitespace-pre-line text-[15px]">{t.detail}</span>
                      <span className={`block text-sm ${due && due < today ? 'font-semibold text-danger' : 'text-ink-soft'}`}>
                        For {taskAssignees(t).map(props.personName).join(', ')}{due ? ` · due ${formatDate(due)}` : ''}
                      </span>
                    </span>
                    {props.onOpenTask && <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-ink-soft" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <NotesBox client={c} viewer={props.viewer} flash={props.flash} />

      {/* Contact persons */}
      <section className="rounded-xl border border-line p-4">
        <h4 className="text-sm font-semibold text-ink-soft">Contact person{contacts.length === 1 ? '' : 's'}</h4>
        {contacts.length ? (
          <ul className="mt-1 divide-y divide-line">
            {contacts.map((p, i) => {
              const phone = shown(p.phone);
              const wa = phone ? whatsappLink(phone) : '';
              return (
                <li key={p.id} className="py-2.5">
                  <p className="font-semibold">{p.name}{p.designation ? <span className="font-normal text-ink-soft">, {p.designation}</span> : null}{i === 0 && contacts.length > 1 && <span className="ml-2 rounded bg-accent-soft px-1.5 text-xs font-semibold text-accent">Main</span>}</p>
                  {(phone || p.email) && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {phone && <a href={`tel:${phone.replace(/\s/g, '')}`} className={btnSecondary}><Phone className="h-4 w-4" /> {phone}</a>}
                      {wa && <a href={wa} target="_blank" rel="noreferrer" className={btnSecondary}><MessageCircle className="h-4 w-4" /> WhatsApp</a>}
                      {p.email && <a href={`mailto:${p.email}`} className={btnSecondary}><Mail className="h-4 w-4" /> {p.email}</a>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-1 text-[15px] text-ink-soft">No contact details yet. Click Edit details to add them.</p>
        )}
      </section>

      {c.address && (
        <section>
          <h4 className="text-sm font-semibold text-ink-soft">Address</h4>
          <p className="mt-1 flex items-start gap-1.5 whitespace-pre-line text-[15px]"><MapPin className="mt-1 h-4 w-4 shrink-0 text-ink-soft" />{c.address}</p>
        </section>
      )}

      <Timeline {...props} />

      {/* Deals */}
      <section>
        <h4 className="text-[15px] font-bold">Deals ({deals.length})</h4>
        {won.length > 0 && <p className="text-sm text-ink-soft">Won {won.length}, worth {formatRM(won.reduce((sum, d) => sum + dealValue(d), 0))}</p>}
        {deals.length === 0 ? (
          <p className="mt-1 text-[15px] text-ink-soft">No deals with this client yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
            {sortedDeals.map(d => (
              <li key={d.id}>
                <button type="button" disabled={!props.onOpenDeal} onClick={() => props.onOpenDeal?.(d.id)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[15px] hover:bg-surface disabled:cursor-default disabled:hover:bg-transparent">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{d.courseName || (d.enquiryNote ? `Asked for: ${d.enquiryNote}` : 'No programme yet')}</span>
                    <span className="block truncate text-sm text-ink-soft">{props.personName(dealOwnerId(d))}{d.requestDate ? `, ${formatDate(d.requestDate)}` : ''}</span>
                  </span>
                  <span className="shrink-0 text-sm text-ink-soft">{STAGE_LABELS[dealStage(d)]}</span>
                  <span className="w-24 shrink-0 text-right font-semibold tabular-nums">{dealValue(d) ? formatRM(dealValue(d)) : '—'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {money.length > 0 && (
        <section>
          <h4 className="text-[15px] font-bold">Money</h4>
          <p className="mt-1 text-[15px]">Invoiced or claimed {formatRM(invoiced)}, received {formatRM(received)}</p>
        </section>
      )}

      {props.canDelete && (
        <div className="border-t border-line pt-4">
          {props.error && <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{props.error}</p>}
          <button type="button" disabled={props.busy} onClick={props.onDelete} className="inline-flex items-center gap-1.5 text-sm font-semibold text-danger hover:underline"><Trash2 className="h-4 w-4" /> Delete client</button>
        </div>
      )}
    </div>
  );
}

// ---------- Notes: lasting facts about the client, anyone on the team edits ----------
function NotesBox({ client: c, viewer, flash }: { client: Client; viewer: Viewer; flash: (t: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(c.notes || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const meta = c as any;

  const save = async () => {
    setBusy(true); setErr('');
    try {
      await updateDoc(doc(db, 'clients', c.id), {
        notes: text.trim().slice(0, 4000), notesById: viewer.id, notesByName: viewer.name, notesAt: new Date().toISOString(),
      });
      setEditing(false);
      flash('Notes saved');
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-line p-4">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[15px] font-bold">Notes</h4>
        {!editing && <button type="button" onClick={() => { setText(c.notes || ''); setEditing(true); }} className="inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline"><Pencil className="h-3.5 w-3.5" /> {c.notes ? 'Edit' : 'Add notes'}</button>}
      </div>
      {editing ? (
        <div className="mt-2 space-y-2">
          <textarea value={text} onChange={e => setText(e.target.value)} rows={4} maxLength={4000} autoFocus aria-label="Notes about this client"
            onFocus={e => { const n = e.target.value.length; e.target.setSelectionRange(n, n); }}
            placeholder="Lasting facts, e.g. HR approves in the first week of each month; prefers WhatsApp" className={`${input} resize-y`} />
          {err && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p>}
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={save} className={btnPrimary}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save notes</button>
            <button type="button" onClick={() => setEditing(false)} className={btnSecondary}>Cancel</button>
          </div>
        </div>
      ) : c.notes ? (
        <p className="mt-1 whitespace-pre-line text-[15px]">{c.notes}</p>
      ) : (
        <p className="mt-1 text-[15px] text-ink-soft">Nothing yet. Add lasting facts the team should know, such as when HR approves or how they like to be contacted.</p>
      )}
      {!editing && meta.notesByName && <p className="mt-2 text-sm text-ink-soft">Last changed by {meta.notesByName}, {formatDate(String(meta.notesAt || ''))}</p>}
    </section>
  );
}

// ---------- Add touch point ----------
function TouchPointForm({ client, team, viewer, today, onCancel, onSaved }: {
  client: Client; team: { id: string; name: string }[]; viewer: Viewer; today: string; onCancel: () => void; onSaved: () => void;
}) {
  const contacts = clientContacts(client);
  const [date, setDate] = useState(today);
  const [how, setHow] = useState<TouchHow>('call');
  const [contactId, setContactId] = useState(contacts[0]?.id || '');
  const [text, setText] = useState('');
  const [nextDate, setNextDate] = useState('');
  const [byId, setById] = useState(viewer.id);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const people = team.some(p => p.id === viewer.id) ? team : [{ id: viewer.id, name: viewer.name }, ...team];

  const save = async () => {
    setErr('');
    if (!date || date > today) return setErr('The date can\'t be in the future.');
    if (!text.trim()) return setErr('Say what happened.');
    if (nextDate && nextDate < today) return setErr('The next follow-up date must be today or later.');
    if (nextDate && !byId) return setErr('Pick who follows up.');
    const contact = contacts.find(p => p.id === contactId);
    const id = newTouchPointId();
    const tp: ClientTouchPoint = {
      id, clientId: client.id, date, how, contactId: contact?.id || '', contactName: contact?.name || '',
      text: text.trim().slice(0, 2000), nextDate: nextDate || '',
      followUpById: nextDate ? byId : '', followUpByName: nextDate ? (people.find(p => p.id === byId)?.name || '') : '',
      at: new Date().toISOString(), byId: viewer.id, byName: viewer.name, source: 'manual',
    };
    setBusy(true);
    try {
      await setDoc(doc(db, 'client_touch_points', id), tp);
      onSaved();
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-accent/40 bg-white p-4">
      <p className="font-semibold">Add touch point</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="tp-date" className={label}>Date</label>
          <input id="tp-date" type="date" max={today} value={date} onChange={e => setDate(e.target.value)} className={input} />
        </div>
        <div>
          <label htmlFor="tp-contact" className={label}>Contact person</label>
          <select id="tp-contact" value={contactId} onChange={e => setContactId(e.target.value)} className={input}>
            <option value="">Not one person / not listed</option>
            {contacts.map(p => <option key={p.id} value={p.id}>{p.name}{p.designation ? `, ${p.designation}` : ''}</option>)}
          </select>
        </div>
      </div>
      <div>
        <span className={label}>How</span>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(TOUCH_HOW_LABELS) as TouchHow[]).map(h => (
            <button key={h} type="button" aria-pressed={how === h} onClick={() => setHow(h)}
              className={`rounded-full border px-3 py-1 text-sm font-medium ${how === h ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-soft hover:bg-surface'}`}>
              {TOUCH_HOW_LABELS[h]}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label htmlFor="tp-text" className={label}>What happened</label>
        <textarea id="tp-text" value={text} onChange={e => setText(e.target.value)} className={`${input} min-h-[72px]`} maxLength={2000}
          placeholder="e.g. Called Puan Aida about next year's training plan; she'll share the budget in November" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="tp-next" className={label}>Next follow-up date <span className="font-normal text-ink-soft">(optional)</span></label>
          <input id="tp-next" type="date" min={today} value={nextDate} onChange={e => setNextDate(e.target.value)} className={input} />
        </div>
        <div>
          <label htmlFor="tp-by" className={label}>Follow-up by</label>
          <select id="tp-by" value={byId} onChange={e => setById(e.target.value)} disabled={!nextDate} className={`${input} disabled:bg-surface disabled:text-ink-soft`}>
            {people.map(p => <option key={p.id} value={p.id}>{p.name}{p.id === viewer.id ? ' (me)' : ''}</option>)}
          </select>
          {!nextDate && <p className="mt-1 text-sm text-ink-soft">Pick a follow-up date first.</p>}
        </div>
      </div>
      {err && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{err}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel}>Cancel</button>
        <button type="button" disabled={busy} className={btnPrimary} onClick={save}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save touch point</button>
      </div>
    </div>
  );
}

// ---------- Touch points timeline ----------
function Timeline(props: React.ComponentProps<typeof ClientPanel>) {
  const { summary: s, deals, quotes, outlines, files, touchPoints, viewer, today } = props;
  const [filter, setFilter] = useState<TimelineFilter>('all');
  const [limit, setLimit] = useState(25);
  const [busyKey, setBusyKey] = useState('');
  const [err, setErr] = useState('');
  const shownEntries = s.entries.filter(e => entryInFilter(e, filter));
  const staff = viewer.role !== 'rep';
  const dealLabel = (id?: string) => {
    const d = deals.find(x => x.id === id);
    return d ? (d.courseName || (d.enquiryNote ? `Asked for: ${d.enquiryNote}` : 'Deal')) : '';
  };
  // Opening a file follows its own permissions: its owner, people it's shared with, Admin and Management.
  const mayOpen = (r: any) => staff || !(r.ownerId || r.creatorId) || r.ownerId === viewer.id || r.creatorId === viewer.id || (r.sharedWithIds || []).includes(viewer.id);

  const downloadPdf = async (q: any, key: string) => {
    setBusyKey(key); setErr('');
    try {
      const { makeQuotationPdf, pdfFileName, downloadBlob } = await import('../lib/quotePdf');
      downloadBlob(await makeQuotationPdf(q), pdfFileName(q));
    } catch (e) {
      setErr(pdfErrorText(e));
    } finally {
      setBusyKey('');
    }
  };
  const removeTouch = async (id: string) => {
    if (!window.confirm('Delete this touch point? This can\'t be undone.')) return;
    setErr('');
    try { await deleteDoc(doc(db, 'client_touch_points', id)); } catch (e) { setErr(friendlyError(e)); }
  };
  const link = 'inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline disabled:opacity-60';

  return (
    <section>
      <h4 className="text-[15px] font-bold">Touch points ({s.entries.length})</h4>
      <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Show">
        {(Object.keys(FILTER_LABELS) as TimelineFilter[]).map(f => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}
            className={`rounded-full border px-3 py-1 text-sm font-medium ${filter === f ? 'border-ink bg-ink text-white' : 'border-line text-ink-soft hover:bg-surface'}`}>
            {FILTER_LABELS[f]}
          </button>
        ))}
      </div>
      {err && <p role="alert" className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p>}
      {shownEntries.length === 0 ? (
        <p className="mt-2 text-[15px] text-ink-soft">{s.entries.length ? 'Nothing of this kind yet.' : 'No touch points yet. Click Add touch point to record a call, message or visit.'}</p>
      ) : (
        <ol className="mt-3 space-y-2">
          {shownEntries.slice(0, limit).map(e => {
            const q = e.quoteId ? quotes.find(x => x.id === e.quoteId) : null;
            const o = e.outlineId ? outlines.find(x => x.id === e.outlineId) : null;
            const tp = e.touchPointId ? touchPoints.find(x => x.id === e.touchPointId) : null;
            const fileList = (e.fileIds || []).map(id => files.find(f => f.id === id)).filter(Boolean) as ProposalFile[];
            const nextLate = !!e.open && !!e.nextDate && e.nextDate < today;
            return (
              <li key={e.key} className={`rounded-lg px-3 py-2.5 text-sm ${e.counts ? 'bg-surface' : 'border border-dashed border-line'}`}>
                <p className="flex flex-wrap items-center gap-x-2 text-ink-soft">
                  <span className="font-semibold text-ink">{formatDate(e.date)}</span>
                  {e.how && <span>{e.how}</span>}
                  {e.byName && <span>· {e.byName}</span>}
                  {e.kind === 'todo' && (e.done ? <CheckCircle2 className="h-3.5 w-3.5 text-accent" /> : <Circle className="h-3.5 w-3.5" />)}
                </p>
                <p className="mt-0.5 font-semibold text-ink">{e.title}</p>
                {e.text && <p className="mt-0.5 whitespace-pre-line text-ink">{e.text}</p>}
                {e.nextDate && (
                  <p className={`mt-0.5 ${nextLate ? 'font-semibold text-danger' : 'text-ink-soft'}`}>
                    Next follow-up {formatDate(e.nextDate)}{e.followUpByName ? ` by ${e.followUpByName}` : ''}{nextLate ? ' (overdue)' : ''}
                  </p>
                )}
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                  {e.dealId && dealLabel(e.dealId) && (
                    props.onOpenDeal
                      ? <button type="button" className={link} onClick={() => props.onOpenDeal!(e.dealId!)}>Deal: {dealLabel(e.dealId)} <ChevronRight className="h-3.5 w-3.5" /></button>
                      : <span className="text-ink-soft">Deal: {dealLabel(e.dealId)}</span>
                  )}
                  {fileList.map(f => (
                    <button key={f.id} type="button" className={link} onClick={async () => setErr(await openProposalFile(f))}><FileText className="h-3.5 w-3.5" /> {f.name}</button>
                  ))}
                  {q && props.onOpenQuotation && mayOpen(q) && <button type="button" className={link} onClick={() => props.onOpenQuotation!(q.id)}><FileText className="h-3.5 w-3.5" /> Open quotation</button>}
                  {q && q.status === 'sent' && (
                    <button type="button" disabled={busyKey === e.key} className={link} onClick={() => downloadPdf(q, e.key)}>
                      {busyKey === e.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Download PDF
                    </button>
                  )}
                  {q && q.status !== 'sent' && !mayOpen(q) && <span className="text-ink-soft">Only its owner, people it's shared with, Admin and Management can open this draft.</span>}
                  {o && props.onOpenOutline && mayOpen(o) && <button type="button" className={link} onClick={() => props.onOpenOutline!(o.id)}><FileText className="h-3.5 w-3.5" /> Open course outline</button>}
                  {o && !mayOpen(o) && <span className="text-ink-soft">Only its owner, people it's shared with, Admin and Management can open this outline.</span>}
                  {e.kind === 'todo' && e.taskId && props.onOpenTask && <button type="button" className={link} onClick={() => props.onOpenTask!(e.taskId!)}><ListTodo className="h-3.5 w-3.5" /> Open To-do</button>}
                  {tp && (tp.byId === viewer.id || viewer.role === 'management') && (
                    <button type="button" className="inline-flex items-center gap-1 text-sm font-semibold text-danger hover:underline" onClick={() => removeTouch(tp.id)}><Trash2 className="h-3.5 w-3.5" /> Delete</button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {shownEntries.length > limit && (
        <button type="button" className="mt-2 text-sm font-semibold text-accent hover:underline" onClick={() => setLimit(l => l + 50)}>Show {Math.min(50, shownEntries.length - limit)} more</button>
      )}
      <p className="mt-2 text-sm text-ink-soft">Solid entries count as contact with the client; dashed ones (drafts, booked appointments, To-dos, lost deals, proposals opened by the client) don't.</p>
    </section>
  );
}
