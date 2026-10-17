import React, { useEffect, useMemo, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, query, setDoc } from 'firebase/firestore';
import { Building2, Loader2, Mail, MapPin, MessageCircle, Pencil, Phone, Plus, Search, Trash2, X } from 'lucide-react';
import { Representative, Client } from '../types';
import { db, friendlyError } from '../lib/firebase';
import { STAGE_LABELS, dealOwnerId, dealStage, dealValue, formatDate, formatRM } from '../lib/deals';
import { MoneyIn } from '../lib/money';
import { linkedOnly } from '../lib/linked';

// Clients (redesigned 2026-10-17): one shared list, the same details as before.
// Anyone can add and edit; only Management can delete, and only a client no deal or quotation uses.

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };

interface ClientManagerProps {
  rep: Representative;
  reps: Representative[];
  viewer: Viewer;
}

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const label = 'mb-1.5 block text-sm font-semibold text-ink';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';

const emptyForm = () => ({
  companyName: '', industry: '', address: '', hrdcRegistered: true,
  contactName: '', designation: '', phone: '', email: '', notes: '',
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

export default function ClientManager({ rep, reps, viewer }: ClientManagerProps) {
  const [clients, setClients] = useState<Client[]>([]);
  const [deals, setDeals] = useState<any[]>([]);
  const [quotes, setQuotes] = useState<any[]>([]);
  // Every record, including old ones not linked yet (hidden on screen), so nothing they use can be deleted.
  const [allDeals, setAllDeals] = useState<any[]>([]);
  const [allQuotes, setAllQuotes] = useState<any[]>([]);
  const [moneyIn, setMoneyIn] = useState<MoneyIn[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [search, setSearch] = useState('');
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
      onSnapshot(query(collection(db, 'money_in')), s => setMoneyIn(s.docs.map(d => ({ ...(d.data() as MoneyIn), id: d.id })))),
    ];
    return () => subs.forEach(u => u());
  }, []);

  const flash = (t: string) => { setToast(t); window.setTimeout(() => setToast(x => (x === t ? '' : x)), 3500); };
  const personName = (id: string) => reps.find(r => r.id === id)?.name || (id === viewer.id ? viewer.name : 'Former team member');

  // A client's deals: linked by clientId, or older deals typed with the same company name.
  const dealsOf = (c: Client, list = deals) => list.filter(p => p.clientId === c.id || (!p.clientId && norm(p.client) === norm(c.companyName)));
  const quotesOf = (c: Client, list = quotes, dealList = deals) => {
    const ids = new Set(dealsOf(c, dealList).map(p => p.id));
    return list.filter(q => q.clientId === c.id || (q.pipelineId && ids.has(q.pipelineId)) || (!q.clientId && !q.pipelineId && norm(q.company) === norm(c.companyName)));
  };

  const dealCount = useMemo(() => {
    const out: Record<string, number> = {};
    clients.forEach(c => { out[c.id] = dealsOf(c).length; });
    return out;
  }, [clients, deals]);

  const visible = useMemo(() => {
    const q = norm(search);
    const list = q
      ? clients.filter(c => [c.companyName, c.contactName, c.phone, c.email, c.industry].some(v => norm(v).includes(q)))
      : clients;
    return [...list].sort((a, b) => (a.companyName || '').localeCompare(b.companyName || '', 'en', { sensitivity: 'base' }));
  }, [clients, search]);

  const openClient = clients.find(c => c.id === openId) || null;

  // ---------- Add / edit ----------
  const startNew = () => {
    setForm({ ...emptyForm(), companyName: search.trim() });
    setFormError(''); setDupId(null); setEditing('new');
  };
  const startEdit = (c: Client) => {
    setForm({
      companyName: c.companyName || '', industry: c.industry || '', address: c.address || '', hrdcRegistered: !!c.hrdcRegistered,
      contactName: shown(c.contactName), designation: c.designation || '', phone: c.phone || '', email: c.email || '', notes: c.notes || '',
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
    const email = form.email.trim();
    if (email && !/^\S+@\S+\.\S+$/.test(email)) return setFormError('That email address doesn\'t look right.');

    const details = {
      companyName: name, industry: form.industry.trim(), address: form.address.trim(), hrdcRegistered: form.hrdcRegistered,
      contactName: form.contactName.trim(), designation: form.designation.trim(), phone: form.phone.trim(), email, notes: form.notes.trim(),
    };
    setBusy(true);
    try {
      if (editing === 'new') {
        const id = `client_${Date.now()}`;
        await setDoc(doc(db, 'clients', id), { id, ...details, createdAt: Date.now(), createdBy: viewer.id, createdByName: viewer.name });
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
    const nd = dealsOf(c, allDeals).length, nq = quotesOf(c, allQuotes, allDeals).length;
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

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search company, person, phone or email" className={`${input} pl-9`} aria-label="Search clients" />
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-white">
        {!loaded ? (
          <p className="flex items-center gap-2 p-6 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading clients…</p>
        ) : visible.length === 0 ? (
          <div className="p-8 text-center">
            <p className="font-semibold">{clients.length === 0 ? 'No clients yet' : `No client matches "${search.trim()}"`}</p>
            <p className="mt-1 text-[15px] text-ink-soft">
              {clients.length === 0 ? 'Add your first client, or add one from a deal.' : 'Check the spelling, or add them as a new client.'}
            </p>
            {clients.length > 0 && <button type="button" onClick={startNew} className={`${btnSecondary} mt-3`}><Plus className="h-4 w-4" /> Add "{search.trim()}"</button>}
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {visible.map(c => {
              const contact = [shown(c.contactName), shown(c.phone)].filter(Boolean).join(' · ');
              const n = dealCount[c.id] || 0;
              return (
                <li key={c.id}>
                  <button type="button" onClick={() => { setOpenId(c.id); setPanelError(''); }} className="flex w-full items-center gap-4 px-5 py-3.5 text-left hover:bg-surface">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{c.companyName}</span>
                      <span className="block truncate text-sm text-ink-soft">{contact || 'No contact person yet'}</span>
                    </span>
                    {c.hrdcRegistered && <span className="hidden rounded-md bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent sm:inline">HRDC</span>}
                    <span className="w-20 shrink-0 text-right text-sm text-ink-soft">{n ? `${n} deal${n === 1 ? '' : 's'}` : 'No deals'}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Client panel */}
      {openClient && !editing && (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" role="dialog" aria-modal="true" onClick={() => setOpenId(null)}>
          <div className="h-full w-full md:w-1/2 md:min-w-[40rem] overflow-y-auto bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <ClientPanel
              client={openClient}
              deals={dealsOf(openClient)}
              quotes={quotesOf(openClient)}
              moneyIn={moneyIn}
              personName={personName}
              canDelete={viewer.role === 'management'}
              busy={busy}
              error={panelError}
              onClose={() => setOpenId(null)}
              onEdit={() => startEdit(openClient)}
              onDelete={() => remove(openClient)}
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

              <fieldset className="space-y-4">
                <legend className="mb-3 text-[15px] font-bold">Contact person</legend>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className={label} htmlFor="c-contact">Name</label>
                    <input id="c-contact" value={form.contactName} onChange={e => set({ contactName: e.target.value })} className={input} />
                  </div>
                  <div>
                    <label className={label} htmlFor="c-designation">Job title</label>
                    <input id="c-designation" value={form.designation} onChange={e => set({ designation: e.target.value })} placeholder="e.g. HR Manager" className={input} />
                  </div>
                  <div>
                    <label className={label} htmlFor="c-phone">Phone</label>
                    <input id="c-phone" type="tel" value={form.phone} onChange={e => set({ phone: e.target.value })} placeholder="e.g. 012-345 6789" className={input} />
                  </div>
                  <div>
                    <label className={label} htmlFor="c-email">Email</label>
                    <input id="c-email" type="email" value={form.email} onChange={e => set({ email: e.target.value })} className={input} />
                  </div>
                </div>
              </fieldset>

              <div>
                <label className={label} htmlFor="c-notes">Notes <span className="font-normal text-ink-soft">(optional)</span></label>
                <textarea id="c-notes" value={form.notes} onChange={e => set({ notes: e.target.value })} rows={3} placeholder="Anything the team should know about this client" className={`${input} resize-y`} />
              </div>

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
  client: Client; deals: any[]; quotes: any[]; moneyIn: MoneyIn[]; personName: (id: string) => string;
  canDelete: boolean; busy: boolean; error: string; onClose: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const { client: c, deals, quotes } = props;
  const contact = shown(c.contactName);
  const phone = shown(c.phone);
  const wa = phone ? whatsappLink(phone) : '';
  const dealIds = new Set(deals.map(d => d.id));
  const money = props.moneyIn.filter(m => dealIds.has(m.dealId));
  const invoiced = money.reduce((s, m) => s + (Number(m.amount) || 0), 0);
  const received = money.reduce((s, m) => s + (Number(m.paidAmount) || 0), 0);
  const won = deals.filter(d => dealStage(d) === 'won');
  const sortedDeals = [...deals].sort((a, b) => String(b.requestDate || b.id).localeCompare(String(a.requestDate || a.id)));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-lg font-bold"><Building2 className="h-5 w-5 shrink-0 text-accent" /> <span className="truncate">{c.companyName}</span></h3>
          <p className="mt-0.5 text-[15px] text-ink-soft">{[shown(c.industry), c.hrdcRegistered ? 'HRDC registered' : 'Not HRDC registered'].filter(Boolean).join(' · ')}</p>
        </div>
        <button type="button" onClick={props.onClose} className="rounded-md p-1 text-ink-soft hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
      </div>

      <button type="button" onClick={props.onEdit} className={btnSecondary}><Pencil className="h-4 w-4" /> Edit details</button>

      {/* Contact */}
      <section className="rounded-xl border border-line p-4">
        <h4 className="text-sm font-semibold text-ink-soft">Contact person</h4>
        {contact || phone || c.email ? (
          <>
            <p className="mt-1 font-semibold">{contact || 'No name'}{c.designation ? <span className="font-normal text-ink-soft">, {c.designation}</span> : null}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {phone && <a href={`tel:${phone.replace(/\s/g, '')}`} className={btnSecondary}><Phone className="h-4 w-4" /> {phone}</a>}
              {wa && <a href={wa} target="_blank" rel="noreferrer" className={btnSecondary}><MessageCircle className="h-4 w-4" /> WhatsApp</a>}
              {c.email && <a href={`mailto:${c.email}`} className={btnSecondary}><Mail className="h-4 w-4" /> {c.email}</a>}
            </div>
          </>
        ) : (
          <p className="mt-1 text-[15px] text-ink-soft">No contact details yet. Click Edit details to add them.</p>
        )}
      </section>

      {(c.address || c.notes) && (
        <section className="space-y-3">
          {c.address && (
            <div>
              <h4 className="text-sm font-semibold text-ink-soft">Address</h4>
              <p className="mt-1 flex items-start gap-1.5 whitespace-pre-line text-[15px]"><MapPin className="mt-1 h-4 w-4 shrink-0 text-ink-soft" />{c.address}</p>
            </div>
          )}
          {c.notes && (
            <div>
              <h4 className="text-sm font-semibold text-ink-soft">Notes</h4>
              <p className="mt-1 whitespace-pre-line text-[15px]">{c.notes}</p>
            </div>
          )}
        </section>
      )}

      {/* History */}
      <section>
        <h4 className="text-[15px] font-bold">Deals ({deals.length})</h4>
        {won.length > 0 && <p className="text-sm text-ink-soft">Won {won.length}, worth {formatRM(won.reduce((s, d) => s + dealValue(d), 0))}</p>}
        {deals.length === 0 ? (
          <p className="mt-1 text-[15px] text-ink-soft">No deals with this client yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
            {sortedDeals.map(d => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-2.5 text-[15px]">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{d.courseName || 'No programme yet'}</span>
                  <span className="block truncate text-sm text-ink-soft">{props.personName(dealOwnerId(d))}{d.requestDate ? `, ${formatDate(d.requestDate)}` : ''}</span>
                </span>
                <span className="shrink-0 text-sm text-ink-soft">{STAGE_LABELS[dealStage(d)]}</span>
                <span className="w-24 shrink-0 text-right font-semibold tabular-nums">{dealValue(d) ? formatRM(dealValue(d)) : '—'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h4 className="text-[15px] font-bold">Quotations ({quotes.length})</h4>
        {quotes.length === 0 ? (
          <p className="mt-1 text-[15px] text-ink-soft">No quotations for this client yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
            {quotes.map(q => (
              <li key={q.id} className="flex items-center gap-3 px-4 py-2.5 text-[15px]">
                <span className="min-w-0 flex-1 truncate font-medium">{q.refNumber || 'No reference'}</span>
                <span className="shrink-0 text-sm text-ink-soft">{q.date ? formatDate(q.date) : ''}</span>
                <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold ${q.status === 'sent' ? 'bg-accent-soft text-accent' : 'bg-surface text-ink-soft'}`}>{q.status === 'sent' ? 'Sent' : 'Draft'}</span>
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
