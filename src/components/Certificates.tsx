import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, getDoc, getDocs, onSnapshot, query, runTransaction, setDoc, updateDoc, where } from 'firebase/firestore';
import { Award, Check, Copy, Download, ExternalLink, FileArchive, ImagePlus, Link2, Loader2, Plus, RefreshCw, Search, Settings, StopCircle, Trash2, X } from 'lucide-react';
import { callServer, db, friendlyError } from '../lib/firebase';
import { dealStage, todayIso, trainingEndDate } from '../lib/deals';
import { titleCaps } from '../lib/programmes';
import { effectiveVenue, upgradeTasks } from '../lib/checklist';
import { linkedOnly } from '../lib/linked';
import { isRunDeal } from '../lib/publicProgrammes';
import { cancelledTraining } from '../lib/trainingChange';
import { formatIc } from '../lib/t3Names';
import { useAutoSave } from '../lib/useAutoSave';
import { usePaged, sortList, ListSort } from '../lib/listPaging';
import {
  CERT_KINDS, CERT_TEMPLATES, CertKind, isTemplate, CertPerson, CertPrint, CertSettings, DEFAULT_CERT_SETTINGS, DEFAULT_WORDING, DealCertificates, KIND_HEADING, SIGNATURE_STYLES,
  certNumber, cleanPrefix, included, mergePeople, personKey, printOf, readCertSettings,
} from '../lib/certificates';
import { certFileName, drawSignature, loadFonts, makeCertificatesPdf, makeCertificatesZip, personFileName, previewImage, saveBlob } from '../lib/certificatePdf';
import { useT3 } from './T3Maker';
import { uploadPhoto } from './PhotoPicker';
import { usePaste } from './PaymentReceipts';
import { storageError } from './ProposalFiles';
import PanelResizer from './PanelResizer';
import ListPager, { SortSelect, listSelect } from './ListPager';

// Certificates (Joel, 2026-10-31): see lib/certificates.ts. The deal's Certificates step shows CertificateBox; Admin
// work → Certificates lists every training that needs them (CertificatesPage), with Settings for Management.

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';
const small = 'mb-1 block text-sm font-medium text-ink-soft';

// ---------- data ----------

export function useCertSettings(): CertSettings {
  const [s, setS] = useState<CertSettings>(DEFAULT_CERT_SETTINGS);
  useEffect(() => onSnapshot(doc(db, 'config', 'certificate_settings'), d => setS(readCertSettings(d.data())), () => setS(DEFAULT_CERT_SETTINGS)), []);
  return s;
}

export function useDealCertificates(dealId: string, enabled = true): DealCertificates | null | undefined {
  const [c, setC] = useState<DealCertificates | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled || !dealId) { setC(undefined); return; }
    return onSnapshot(doc(db, 'deal_certificates', dealId), d => setC(d.exists() ? (d.data() as DealCertificates) : null), () => setC(null));
  }, [dealId, enabled]);
  return c;
}

export type CertLink = { token: string; dealId: string; status: 'open' | 'stopped'; createdAt: number; byName: string; expiresAt: number; opens?: number; lastOpenedAt?: number };

function useCertLinks(dealId: string): CertLink[] {
  const [links, setLinks] = useState<CertLink[]>([]);
  useEffect(() => {
    if (!dealId) return;
    return onSnapshot(query(collection(db, 'cert_links'), where('dealId', '==', dealId)),
      s => setLinks(s.docs.map(d => ({ ...(d.data() as any), token: d.id })).sort((a, b) => b.createdAt - a.createdAt)), () => setLinks([]));
  }, [dealId]);
  return links;
}
const liveLink = (links: CertLink[]) => links.find(l => l.status === 'open' && l.expiresAt > Date.now()) || null;

// "28 October 2026", "28–29 October 2026", "30 October – 1 November 2026"
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function longDateRange(start: string, end: string): string {
  const parse = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s.split('-').map(Number) : null);
  const a = parse(String(start || '').slice(0, 10));
  if (!a) return '';
  const b = parse(String(end || '').slice(0, 10));
  const full = (x: number[]) => `${x[2]} ${MONTHS[x[1] - 1]} ${x[0]}`;
  if (!b || String(end) <= String(start)) return full(a);
  if (a[0] === b[0] && a[1] === b[1]) return `${a[2]}–${b[2]} ${MONTHS[a[1] - 1]} ${a[0]}`;
  if (a[0] === b[0]) return `${a[2]} ${MONTHS[a[1] - 1]} – ${full(b)}`;
  return `${full(a)} – ${full(b)}`;
}

// The venue as the checklist (or the quotation, or the public programme run) has it.
async function dealVenue(deal: any): Promise<string> {
  try {
    if (deal.publicProgrammeId && !isRunDeal(deal)) {
      const run: any = (await getDoc(doc(db, 'public_programmes', deal.publicProgrammeId))).data();
      if (run?.venueName) return String(run.venueName);
    }
    const [cl, qs, vs] = await Promise.all([
      getDoc(doc(db, 'deal_checklists', deal.id)),
      getDocs(query(collection(db, 'quotations'), where('pipelineId', '==', deal.id))),
      getDocs(collection(db, 'venues')),
    ]);
    const venueTask = upgradeTasks((cl.data() as any)?.tasks).find(t => t.kind === 'venue');
    return effectiveVenue(venueTask, linkedOnly(qs.docs.map(d => ({ ...d.data(), id: d.id }))), vs.docs.map(d => ({ ...d.data(), id: d.id })))?.name || '';
  } catch {
    return '';
  }
}

async function logoData(url: string): Promise<string> {
  if (!url || url === 'none') return '';
  try {
    const r = await callServer<{ photos: Record<string, string> }>('/api/photos/get', { urls: [url] }, true);
    return r.photos[url] || '';
  } catch {
    return '';
  }
}

// Generating ticks the deal's Certificates step (if the checklist has one and it isn't ticked yet).
async function tickStep(dealId: string, viewer: Viewer, action: string) {
  const ref = doc(db, 'deal_checklists', dealId);
  const cl: any = (await getDoc(ref)).data();
  const tasks: any[] = cl?.tasks || [];
  const t = tasks.find(x => x.id === 'certificates');
  if (!t || t.done) return;
  await updateDoc(ref, {
    tasks: tasks.map(x => (x.id === 'certificates' ? { ...x, done: true, doneAt: todayIso(), doneById: viewer.id, doneByName: viewer.name } : x)),
    updatedAt: Date.now(),
    history: [...(cl.history || []), { at: new Date().toISOString(), byId: viewer.id, byName: viewer.name, action }].slice(-60),
  });
}

// ---------- the box on the deal's Certificates step ----------

export function CertificateBox({ deal, viewer }: { deal: any; viewer: Viewer }) {
  const staff = viewer.role !== 'rep';
  const certs = useDealCertificates(deal.id, staff);
  const [open, setOpen] = useState(false);
  if (!staff) return null;
  const n = certs ? included(certs.people || []).filter(p => p.number).length : 0;
  return (
    <div className="mt-2 rounded-xl border border-line bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Award className="h-4 w-4 text-accent" />
        <p className="min-w-0 flex-1 text-sm">
          {certs === undefined ? 'Loading…'
            : certs?.generatedAt ? <><strong>{n} certificate{n === 1 ? '' : 's'}</strong> generated{certs.generatedByName ? ` by ${certs.generatedByName}` : ''} on {certs.generatedAt.slice(0, 10).split('-').reverse().join('/')}</>
            : 'Not generated yet. Names come from the T3 attendance list.'}
        </p>
        <button type="button" className={`${btnPrimary} py-1.5`} onClick={() => setOpen(true)}>
          <Award className="h-4 w-4" /> {certs?.generatedAt ? 'Open certificates' : 'Generate certificates'}
        </button>
      </div>
      {open && <CertificatePanel deal={deal} viewer={viewer} onClose={() => setOpen(false)} />}
    </div>
  );
}

// ---------- the generator ----------

type Form = Omit<DealCertificates, 'generatedAt' | 'generatedById' | 'generatedByName' | 'count'>;
const formOf = (c: DealCertificates): Form => ({ template: isTemplate(c.template) ? c.template : 'A', kind: c.kind, title: c.title, dateText: c.dateText, venue: c.venue, logoUrl: c.logoUrl || '', showIc: c.showIc !== false, people: c.people || [] });

export function CertificatePanel({ deal, viewer, onClose }: { deal: any; viewer: Viewer; onClose: () => void }) {
  const settings = useCertSettings();
  const saved = useDealCertificates(deal.id);
  const t3 = useT3(deal.id, true);
  const links = useCertLinks(deal.id);
  const [form, setForm] = useState<Form | null>(null);
  const [savedJson, setSavedJson] = useState('');
  const [client, setClient] = useState<{ name: string; logoUrl: string }>({ name: String(deal.client || ''), logoUrl: '' });
  const [busy, setBusy] = useState('');
  const [pct, setPct] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState('');
  const [adding, setAdding] = useState(false);
  const [pasted, setPasted] = useState('');
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [alsoClient, setAlsoClient] = useState(true);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!deal.clientId) return;
    getDoc(doc(db, 'clients', deal.clientId)).then(s => {
      const c: any = s.data();
      if (c) setClient({ name: String(c.companyName || deal.client || ''), logoUrl: String(c.logoUrl || '') });
    }).catch(() => {});
  }, [deal.clientId]);

  // Start from what was saved, else from the deal. Nothing is saved until someone changes something.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || saved === undefined) return;
    started.current = true;
    (async () => {
      const start: Form = saved ? formOf(saved) : {
        template: settings.defaultTemplate, kind: 'participation', title: titleCaps(deal.courseName || ''),
        dateText: longDateRange(deal.trainingDate, trainingEndDate(deal)), venue: await dealVenue(deal),
        logoUrl: '', showIc: settings.showIc, people: [],
      };
      setForm(start);
      setSavedJson(JSON.stringify(start));
    })();
  }, [saved]);
  // The T3 list's names join the list as it loads (and when it changes); names already there keep their numbers.
  const t3Json = JSON.stringify(t3?.trainees || []);
  useEffect(() => {
    if (!form || !t3?.trainees?.length) return;
    const people = mergePeople(t3.trainees.map(t => ({ name: t.name, ic: formatIc(t.ic || '') })), form.people);
    if (JSON.stringify(people) === JSON.stringify(form.people)) return;
    const untouched = JSON.stringify(form) === savedJson;
    const next = { ...form, people };
    setForm(next);
    if (untouched && !saved) setSavedJson(JSON.stringify(next));
  }, [t3Json, !!form]);

  const json = JSON.stringify(form);
  const dirty = !!form && json !== savedJson;
  const auto = useAutoSave({
    value: form, dirty, enabled: !!form,
    write: async v => { if (v) await setDoc(doc(db, 'deal_certificates', deal.id), v, { merge: true }); },
    onSaved: setSavedJson,
  });

  const set = (c: Partial<Form>) => setForm(f => (f ? { ...f, ...c } : f));
  const setPerson = (key: string, c: Partial<CertPerson>) => setForm(f => (f ? { ...f, people: f.people.map(p => (p.key === key ? { ...p, ...c } : p)) } : f));
  const people = form?.people || [];
  const chosen = included(people);
  const logoUrl = form?.logoUrl === 'none' ? '' : form?.logoUrl || client.logoUrl;

  const [logo, setLogo] = useState('');
  useEffect(() => { let live = true; logoData(logoUrl).then(d => live && setLogo(d)); return () => { live = false; }; }, [logoUrl]);
  const print = (c: Form): CertPrint => printOf({ ...c } as DealCertificates, settings, logo, client.name);

  // The preview: the first person ticked (or a sample name), redrawn shortly after each change.
  useEffect(() => {
    if (!form) return;
    const t = window.setTimeout(() => {
      const first = chosen[0];
      previewImage(print(form), first ? { name: first.name, ic: form.showIc ? first.ic : '', number: first.number || certNumber(settings.prefix, Number(todayIso().slice(0, 4)), 1) }
        : { name: 'Participant name', ic: form.showIc ? '900101-14-5678' : '', number: '' })
        .then(setPreview).catch(() => {});
    }, 350);
    return () => window.clearTimeout(t);
  }, [json, logo, JSON.stringify(settings)]);

  const refreshFromT3 = () => {
    if (!form) return;
    set({ people: mergePeople((t3?.trainees || []).map(t => ({ name: t.name, ic: formatIc(t.ic || '') })), form.people) });
    setNote(t3?.trainees?.length ? 'New names from the T3 list added.' : 'There is no T3 list on this deal yet. Add the names below.');
  };

  const addPasted = () => {
    if (!form) return;
    const rows = pasted.split(/\r?\n/).map(l => l.split(/\t|,|;/).map(x => x.trim())).filter(r => r[0]);
    const added = rows.map(r => ({ name: r[0].replace(/^\d{1,3}\s*[.)]\s*/, ''), ic: formatIc(r[1] || '') }));
    const known = new Set(form.people.map(p => p.key));
    const fresh = added.filter(p => !known.has(personKey(p))).map(p => ({ key: personKey(p), name: p.name, ic: p.ic, number: '' }));
    set({ people: [...form.people, ...fresh] });
    setPasted(''); setAdding(false);
    setNote(`${fresh.length} name${fresh.length === 1 ? '' : 's'} added.`);
  };

  // The client's logo from a file, a dropped image or a pasted screenshot (Joel, 2026-11-01).
  const pickLogo = async (f?: File | null) => {
    if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { setLogoError('The logo must be a picture (PNG, JPG or WebP) or a screenshot.'); return; }
    setLogoError(''); setUploadPct(0);
    try {
      const url = await uploadPhoto(f, 'logos', viewer, setUploadPct);
      set({ logoUrl: url });
      if (alsoClient && deal.clientId) {
        await updateDoc(doc(db, 'clients', deal.clientId), { logoUrl: url });
        setClient(c => ({ ...c, logoUrl: url }));
      }
    } catch (e: any) {
      setLogoError(e?.code ? storageError(e) : String(e?.message || e));
    } finally {
      setUploadPct(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  // Ctrl+V anywhere in the panel puts a copied screenshot in as the logo.
  const paste = usePaste(files => pickLogo(files[0]), true);
  const [logoError, setLogoError] = useState('');

  const problem = !form ? '' : !settings.signerName ? `Management: type who signs in Admin work → Certificates → Settings first.`
    : !form.title.trim() ? 'Type the training title.' : !form.dateText.trim() ? 'Type the training date.' : !chosen.length ? 'Tick at least one name.' : '';

  // Give numbers to everyone ticked who has none (one running number per year, never given twice), save, tick the
  // step, then download the PDF.
  const generate = async () => {
    if (!form || problem) return;
    setBusy('generate'); setError(''); setNote('');
    try {
      await auto.flush();
      const year = todayIso().slice(0, 4);
      const now = new Date().toISOString();
      const result = await runTransaction(db, async tx => {
        const cref = doc(db, 'cert_counters', year);
        let last = Number((await tx.get(cref)).data()?.last) || 0;
        const start = last;
        const numbered = form.people.map(p => (!p.left && p.name.trim() && !p.number ? { ...p, number: certNumber(settings.prefix, Number(year), ++last), issuedAt: now } : p));
        if (last > start) tx.set(cref, { last, year: Number(year), updatedAt: now });
        const next: DealCertificates = {
          ...form, people: numbered, generatedAt: now, generatedById: viewer.id, generatedByName: viewer.name, count: included(numbered).length,
        };
        tx.set(doc(db, 'deal_certificates', deal.id), next);
        return { next, given: last - start };
      });
      const f = formOf(result.next);
      setForm(f);
      setSavedJson(JSON.stringify(f));
      await tickStep(deal.id, viewer, `Certificates: ${result.next.count} generated${result.given ? `, ${result.given} new number${result.given === 1 ? '' : 's'}` : ''}, done`).catch(() => {});
      setNote(`${result.next.count} certificate${result.next.count === 1 ? '' : 's'} ready${result.given ? ` (${result.given} new number${result.given === 1 ? '' : 's'})` : ''}. The PDF is downloading.`);
      const p = print(f);
      setPct(0);
      saveBlob(await makeCertificatesPdf(p, p.people, setPct), certFileName(p));
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(''); setPct(null);
    }
  };

  const generated = !!saved?.generatedAt;
  const ready = generated && form ? print(form) : null;
  const download = async (kind: 'pdf' | 'zip' | string) => {
    if (!ready) return;
    setBusy(kind); setError(''); setPct(0);
    try {
      if (kind === 'pdf') saveBlob(await makeCertificatesPdf(ready, ready.people, setPct), certFileName(ready));
      else if (kind === 'zip') saveBlob(await makeCertificatesZip(ready, setPct), certFileName(ready).replace(/\.pdf$/, '.zip'));
      else {
        const person = ready.people.find(p => p.number === kind);
        if (person) saveBlob(await makeCertificatesPdf(ready, [person]), personFileName(person));
      }
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(''); setPct(null);
    }
  };

  // Changed since the last generate (names ticked, wording…): the PDFs and HR's link use the saved copy.
  const changed = generated && form && JSON.stringify(formOf(saved!)) !== JSON.stringify(form);
  const unnumbered = chosen.filter(p => !p.number).length;

  const close = async () => { await auto.flush(); onClose(); };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" role="dialog" aria-modal="true" aria-label="Certificates">
      <PanelResizer />
      <div className="flex h-full w-full flex-col bg-surface shadow-xl md:w-[var(--panel-w,max(50vw,40rem))] md:min-w-[24rem] md:max-w-[95vw]">
        <div className="flex items-start justify-between gap-3 border-b border-line bg-white px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-lg font-bold">Certificates</h3>
            <p className="truncate text-sm text-ink-soft">{[titleCaps(deal.courseName || ''), client.name, longDateRange(deal.trainingDate, trainingEndDate(deal))].filter(Boolean).join(' · ')}</p>
            <p className="text-sm text-ink-soft">{auto.state.status === 'saving' ? 'Saving…' : auto.state.status === 'error' ? <span className="text-danger">Not saved: {auto.state.error}</span> : form && !dirty ? 'Saved' : ''}</p>
          </div>
          <button type="button" onClick={close} className="rounded-md p-1 text-ink-soft hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {!form ? <p className="flex items-center gap-2 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p> : (
            <>
              {/* Template A or B (2026-11-01) */}
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Template">
                {CERT_TEMPLATES.map(t => (
                  <button key={t.id} type="button" role="radio" aria-checked={form.template === t.id} onClick={() => set({ template: t.id })}
                    className={`rounded-xl border p-3 text-left ${form.template === t.id ? 'border-accent bg-accent-soft' : 'border-line bg-white hover:bg-surface'}`}>
                    <span className={`block text-sm font-bold ${form.template === t.id ? 'text-accent' : ''}`}>{t.label}</span>
                    <span className="block text-sm text-ink-soft">{t.hint}</span>
                  </button>
                ))}
              </div>
              {preview && <img src={preview} alt="Certificate preview" className={`rounded-xl border border-line shadow-sm ${form.template === 'B' ? 'mx-auto w-full max-w-sm' : 'w-full'}`} />}
              <p className="-mt-2 text-xs text-ink-soft">{form.template === 'B' ? 'Template B' : 'Template A'}. Preview of the first name ticked.</p>

              <section className="space-y-3 rounded-2xl border border-line bg-white p-4">
                <h4 className="text-base font-bold">On the certificate</h4>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Certificate of">
                  {CERT_KINDS.map(k => (
                    <button key={k} type="button" role="radio" aria-checked={form.kind === k} onClick={() => set({ kind: k })}
                      className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${form.kind === k ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-white text-ink-soft hover:bg-surface'}`}>
                      Certificate {KIND_HEADING[k].toLowerCase()}
                    </button>
                  ))}
                </div>
                <label className="block"><span className={small}>Training title</span>
                  <input className={input} value={form.title} onChange={e => set({ title: e.target.value })} /></label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block"><span className={small}>Training date</span>
                    <input className={input} value={form.dateText} onChange={e => set({ dateText: e.target.value })} placeholder="28 October 2026" /></label>
                  <label className="block"><span className={small}>Venue</span>
                    <input className={input} value={form.venue} onChange={e => set({ venue: e.target.value })} placeholder="Where the training took place" /></label>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.showIc} onChange={e => set({ showIc: e.target.checked })} className="h-4 w-4 accent-[#0E6E62]" />
                  Show the IC number under each name
                </label>

                <div>
                  <span className={small}>Client company logo</span>
                  <div {...paste} tabIndex={-1}
                    onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
                    onDrop={e => { e.preventDefault(); setDragging(false); pickLogo(e.dataTransfer.files?.[0]); }}
                    className={`flex flex-wrap items-center gap-3 rounded-xl border-2 border-dashed p-3 outline-none ${dragging ? 'border-accent bg-accent-soft' : 'border-line bg-surface/50'}`}>
                    {logo && form.logoUrl !== 'none'
                      ? <img src={logo} alt="Client logo" className="h-14 w-auto max-w-[10rem] rounded-lg border border-line bg-white object-contain p-1.5" />
                      : <span className="flex h-14 w-28 items-center justify-center rounded-lg border border-dashed border-line bg-white px-2 text-center text-xs text-ink-soft">{form.logoUrl === 'none' ? 'Hidden' : 'No logo yet'}</span>}
                    <div className="min-w-0 flex-1">
                      <button type="button" className={btnPrimary} disabled={uploadPct !== null} onClick={() => fileRef.current?.click()}>
                        {uploadPct !== null ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                        {uploadPct !== null ? `Uploading ${uploadPct}%` : logo ? 'Upload a different logo' : 'Upload client logo'}
                      </button>
                      <p className="mt-1 text-sm text-ink-soft">Choose a file, drop it here, or paste a screenshot (Ctrl+V). A PNG with a see-through background looks best.</p>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {form.logoUrl && form.logoUrl !== 'none' && client.logoUrl && form.logoUrl !== client.logoUrl && (
                      <button type="button" className={btnSecondary} onClick={() => set({ logoUrl: '' })}>Use the client's logo</button>
                    )}
                    {form.logoUrl !== 'none'
                      ? <button type="button" className={`${btnSecondary} text-danger`} onClick={() => set({ logoUrl: 'none' })}><X className="h-4 w-4" /> No client logo</button>
                      : <button type="button" className={btnSecondary} onClick={() => set({ logoUrl: '' })}>Show the client logo</button>}
                    <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={e => pickLogo(e.target.files?.[0])} />
                  </div>
                  {deal.clientId && (
                    <label className="mt-1 flex items-center gap-2 text-sm text-ink-soft">
                      <input type="checkbox" checked={alsoClient} onChange={e => setAlsoClient(e.target.checked)} className="h-4 w-4 accent-[#0E6E62]" />
                      Save an uploaded logo on the client's record too (used next time)
                    </label>
                  )}
                  {logoError && <p className="mt-1 text-sm text-danger">{logoError}</p>}
                </div>
                <p className="text-sm text-ink-soft">Signed by <strong className="text-ink">{settings.signerName || 'nobody yet'}</strong>{settings.signerTitle ? `, ${settings.signerTitle}` : ''}. Wording, signer and signature are in Certificates → Settings (Management).</p>
              </section>

              <section className="rounded-2xl border border-line bg-white p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <h4 className="flex-1 text-base font-bold">Names <span className="text-sm font-medium text-ink-soft">({chosen.length} of {people.length} ticked)</span></h4>
                  <button type="button" className={`${btnSecondary} py-1.5`} onClick={refreshFromT3}><RefreshCw className="h-3.5 w-3.5" /> Add new names from T3</button>
                  <button type="button" className={`${btnSecondary} py-1.5`} onClick={() => setAdding(a => !a)}><Plus className="h-3.5 w-3.5" /> Add names</button>
                </div>
                <p className="mb-2 text-sm text-ink-soft">From the T3 attendance list. Untick anyone who didn't attend. A person keeps their number if you generate again.</p>
                {adding && (
                  <div className="mb-3 space-y-2 rounded-xl bg-surface p-3">
                    <textarea className={`${input} min-h-[6rem]`} value={pasted} onChange={e => setPasted(e.target.value)}
                      placeholder={'One person per line: name, then IC (optional)\nAHMAD BIN ALI, 900101-14-5678'} />
                    <div className="flex gap-2">
                      <button type="button" className={btnPrimary} disabled={!pasted.trim()} onClick={addPasted}>Add</button>
                      <button type="button" className={btnSecondary} onClick={() => { setAdding(false); setPasted(''); }}>Cancel</button>
                    </div>
                  </div>
                )}
                {!people.length ? <p className="rounded-lg bg-surface px-3 py-2.5 text-sm text-ink-soft">No names yet. Fill in the T3 list on the Attendance step, or add the names here.</p> : (
                  <ul className="divide-y divide-line">
                    {people.map((p, i) => (
                      <li key={p.key} className="flex flex-wrap items-center gap-2 py-2">
                        <input type="checkbox" checked={!p.left} onChange={e => setPerson(p.key, { left: !e.target.checked })} className="h-4 w-4 accent-[#0E6E62]" aria-label={`Certificate for ${p.name}`} />
                        <span className="w-6 text-right text-sm text-ink-soft">{i + 1}.</span>
                        <input className={`${input} min-w-[12rem] flex-1 py-1.5 ${p.left ? 'opacity-50' : ''}`} value={p.name} onChange={e => setPerson(p.key, { name: e.target.value })} aria-label="Name" />
                        <input className={`${input} w-40 py-1.5 ${p.left ? 'opacity-50' : ''}`} value={p.ic} onChange={e => setPerson(p.key, { ic: e.target.value })} onBlur={() => setPerson(p.key, { ic: formatIc(p.ic) })} placeholder="IC" aria-label="IC number" />
                        <span className="w-36 text-sm tabular-nums text-ink-soft">{p.number || (p.left ? 'Left out' : 'Number when generated')}</span>
                        {generated && p.number && !p.left && saved?.people?.some(x => x.number === p.number) && (
                          <button type="button" className="rounded-md p-1.5 text-ink-soft hover:bg-surface hover:text-ink" disabled={!!busy} onClick={() => download(p.number)} aria-label={`Download ${p.name}'s certificate`}>
                            {busy === p.number ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                          </button>
                        )}
                        {!p.number && (
                          <button type="button" className="rounded-md p-1.5 text-ink-soft hover:bg-surface hover:text-danger" onClick={() => set({ people: people.filter(x => x.key !== p.key) })} aria-label={`Remove ${p.name}`}><Trash2 className="h-4 w-4" /></button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {problem && <p className="rounded-lg bg-attention-soft px-3 py-2.5 text-sm">{problem}</p>}
              {error && <p className="rounded-lg bg-danger/10 px-3 py-2.5 text-sm text-danger">{error}</p>}
              {note && <p className="rounded-lg bg-accent-soft px-3 py-2.5 text-sm text-accent">{note}</p>}

              <div className="flex flex-wrap gap-2">
                <button type="button" className={btnPrimary} disabled={!!busy || !!problem} onClick={generate}>
                  {busy === 'generate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Award className="h-4 w-4" />}
                  {busy === 'generate' && pct !== null ? `Making the PDF ${pct}%` : generated ? `Generate again${unnumbered ? ` (${unnumbered} new number${unnumbered === 1 ? '' : 's'})` : ''}` : `Generate ${chosen.length} certificate${chosen.length === 1 ? '' : 's'}`}
                </button>
                {generated && (
                  <>
                    <button type="button" className={btnSecondary} disabled={!!busy} onClick={() => download('pdf')}>
                      {busy === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} {busy === 'pdf' && pct !== null ? `${pct}%` : 'All in one PDF'}
                    </button>
                    <button type="button" className={btnSecondary} disabled={!!busy} onClick={() => download('zip')}>
                      {busy === 'zip' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileArchive className="h-4 w-4" />} {busy === 'zip' && pct !== null ? `${pct}%` : 'One PDF each (ZIP)'}
                    </button>
                  </>
                )}
              </div>
              {changed && <p className="text-sm text-attention">You changed something since the certificates were generated. Click Generate again so the PDFs and HR's link show it.</p>}

              {generated && <HrLinkBox dealId={deal.id} links={links} company={client.name} title={form.title} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- HR's link ----------

function HrLinkBox({ dealId, links, company, title }: { dealId: string; links: CertLink[]; company: string; title: string }) {
  const live = liveLink(links);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const url = live ? `${window.location.origin}/cert/${live.token}` : '';
  const message = `Dear HR${company ? ` of ${company}` : ''},\n\nThank you for training with NEXT Academy. The certificates for ${title || 'the training'} are ready. You can download them here (all in one PDF, or one for each person):\n${url}\n\nThe link works until ${live ? new Date(live.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : ''}.`;
  const make = async () => {
    setBusy(true); setError('');
    try { await callServer('/api/cert-link/create', { dealId }, true); } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };
  const stop = async () => {
    if (!live || !window.confirm('Stop this link? HR will no longer be able to open it.')) return;
    setBusy(true); setError('');
    try { await callServer('/api/cert-link/stop', { token: live.token }, true); } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };
  const copy = async (what: 'link' | 'message') => {
    try { await navigator.clipboard.writeText(what === 'link' ? url : message); setCopied(what); setTimeout(() => setCopied(''), 2000); } catch { /* the link is on screen to copy by hand */ }
  };
  return (
    <section className="rounded-2xl border border-line bg-white p-4">
      <h4 className="flex items-center gap-2 text-base font-bold"><Link2 className="h-4 w-4 text-accent" /> Link for HR</h4>
      <p className="mb-2 text-sm text-ink-soft">HR opens it without logging in and downloads the certificates (all in one PDF, one each, or a ZIP).</p>
      {live ? (
        <>
          <p className="break-all rounded-lg bg-surface px-3 py-2 text-sm">{url}</p>
          <p className="mt-1 text-sm text-ink-soft">Made by {live.byName || 'someone'} · works until {new Date(live.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · opened {live.opens || 0} time{live.opens === 1 ? '' : 's'}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={btnSecondary} onClick={() => copy('link')}>{copied === 'link' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} Copy link</button>
            <button type="button" className={btnSecondary} onClick={() => copy('message')}>{copied === 'message' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} Copy message</button>
            <a className={btnSecondary} href={url} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /> Open</a>
            <button type="button" className={`${btnSecondary} text-danger`} disabled={busy} onClick={stop}><StopCircle className="h-4 w-4" /> Stop</button>
          </div>
        </>
      ) : (
        <button type="button" className={btnPrimary} disabled={busy} onClick={make}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Make the link for HR</button>
      )}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </section>
  );
}

// ---------- Admin work → Certificates ----------

type Row = { deal: any; certs?: DealCertificates; step?: any; status: 'generated' | 'elsewhere' | 'todo' };

export default function CertificatesPage({ viewer, onOpenDeal }: { viewer: Viewer; onOpenDeal: (dealId: string) => void }) {
  const [view, setView] = useState<'list' | 'settings'>('list');
  const [deals, setDeals] = useState<any[]>([]);
  const [certs, setCerts] = useState<Record<string, DealCertificates>>({});
  const [steps, setSteps] = useState<Record<string, any>>({});
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<'todo' | 'done' | 'all'>('todo');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<ListSort>('newest');
  const [panel, setPanel] = useState<any | null>(null);

  useEffect(() => {
    const subs = [
      onSnapshot(query(collection(db, 'pipelines')), s => { setDeals(linkedOnly(s.docs.map(d => ({ ...d.data(), id: d.id })))); setLoaded(true); }, () => setLoaded(true)),
      onSnapshot(query(collection(db, 'deal_certificates')), s => setCerts(Object.fromEntries(s.docs.map(d => [d.id, d.data() as DealCertificates]))), () => {}),
      onSnapshot(query(collection(db, 'deal_checklists')), s => setSteps(Object.fromEntries(s.docs.map(d => [d.id, ((d.data() as any).tasks || []).find((t: any) => t.id === 'certificates')]))), () => {}),
    ];
    return () => subs.forEach(u => u());
  }, []);

  // Won trainings that have started (or already have certificates), not cancelled, one row per company.
  const rows: Row[] = useMemo(() => {
    const today = todayIso();
    return deals
      .filter(d => dealStage(d) === 'won' && !cancelledTraining(d) && !isRunDeal(d) && ((String(d.trainingDate || '') && String(d.trainingDate).slice(0, 10) <= today) || certs[d.id]))
      .map(d => {
        const c = certs[d.id], step = steps[d.id];
        const status: Row['status'] = c?.generatedAt ? 'generated' : step?.done || step?.links?.length ? 'elsewhere' : 'todo';
        return { deal: d, certs: c, step, status };
      });
  }, [deals, certs, steps]);

  const q = search.trim().toLowerCase();
  const shown = sortList(
    rows.filter(r => (filter === 'all' || (filter === 'todo' ? r.status === 'todo' : r.status !== 'todo'))
      && (!q || [r.deal.courseName, r.deal.client, ...(r.certs?.people || []).flatMap(p => [p.name, p.number])].some(x => String(x || '').toLowerCase().includes(q)))),
    sort, r => String(r.deal.courseName || ''), r => r.deal.trainingDate || '',
  );
  const paged = usePaged(shown, [filter, q, sort]);
  const count = (f: typeof filter) => rows.filter(r => f === 'all' || (f === 'todo' ? r.status === 'todo' : r.status !== 'todo')).length;
  const isManager = viewer.role === 'management';

  if (view === 'settings' && isManager) return <CertSettingsPage onBack={() => setView('list')} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-line bg-white p-0.5" role="tablist">
          {(['todo', 'done', 'all'] as const).map(f => (
            <button key={f} type="button" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold ${filter === f ? 'bg-ink text-white' : 'text-ink-soft hover:text-ink'}`}>
              {f === 'todo' ? 'To do' : f === 'done' ? 'Done' : 'All'} ({count(f)})
            </button>
          ))}
        </div>
        <label className="relative min-w-[14rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
          <input className={`${input} pl-9`} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search training, client, name or certificate number" />
        </label>
        <SortSelect value={sort} onChange={setSort} />
        {isManager && <button type="button" className={btnSecondary} onClick={() => setView('settings')}><Settings className="h-4 w-4" /> Settings</button>}
      </div>

      {!loaded ? <p className="flex items-center gap-2 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
        : !shown.length ? <p className="rounded-2xl border border-line bg-white px-4 py-6 text-center text-ink-soft">{filter === 'todo' ? 'No trainings waiting for certificates.' : 'Nothing here.'}</p> : (
          <ul className="space-y-2">
            {paged.pageItems.map(r => {
              const n = r.certs ? included(r.certs.people || []).filter(p => p.number) : [];
              const nums = n.map(p => p.number).sort();
              return (
                <li key={r.deal.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{titleCaps(r.deal.courseName || '') || 'Training'}</p>
                    <p className="truncate text-sm text-ink-soft">{[r.deal.client, longDateRange(r.deal.trainingDate, trainingEndDate(r.deal))].filter(Boolean).join(' · ')}</p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${r.status === 'todo' ? 'bg-attention-soft text-ink' : 'bg-accent-soft text-accent'}`}>
                    {r.status === 'generated' ? `${n.length} generated${nums.length ? ` · ${nums[0].split('/').pop()}${nums.length > 1 ? `–${nums[nums.length - 1].split('/').pop()}` : ''}` : ''}`
                      : r.status === 'elsewhere' ? 'Done elsewhere' : 'Not done'}
                  </span>
                  <button type="button" className={`${btnPrimary} py-1.5`} onClick={() => setPanel(r.deal)}><Award className="h-4 w-4" /> {r.status === 'generated' ? 'Open' : 'Generate'}</button>
                  <button type="button" className={`${btnSecondary} py-1.5`} onClick={() => onOpenDeal(r.deal.id)}>Open deal</button>
                </li>
              );
            })}
          </ul>
        )}
      <ListPager paged={paged} noun="trainings" />
      {panel && <CertificatePanel deal={panel} viewer={viewer} onClose={() => setPanel(null)} />}
    </div>
  );
}

// ---------- Settings (Management) ----------

function CertSettingsPage({ onBack }: { onBack: () => void }) {
  const live = useCertSettings();
  const [s, setS] = useState<CertSettings | null>(null);
  const [savedJson, setSavedJson] = useState('');
  const loadedRef = useRef(false);
  useEffect(() => {
    getDoc(doc(db, 'config', 'certificate_settings')).then(d => {
      const v = readCertSettings(d.data());
      loadedRef.current = true;
      setS(v); setSavedJson(JSON.stringify(v));
    }).catch(() => { setS(live); setSavedJson(JSON.stringify(live)); });
  }, []);
  const dirty = !!s && JSON.stringify(s) !== savedJson;
  const auto = useAutoSave({
    value: s, dirty, enabled: !!s,
    write: async v => { if (v) await setDoc(doc(db, 'config', 'certificate_settings'), { ...v, prefix: cleanPrefix(v.prefix) || 'NA/CERT', updatedAt: Date.now() }); },
    onSaved: setSavedJson,
  });
  const set = (c: Partial<CertSettings>) => setS(x => (x ? { ...x, ...c } : x));
  const sigRefs = useRef<Record<string, HTMLCanvasElement | null>>({});

  // A sample of each signature style, drawn from the signer's name.
  useEffect(() => {
    if (!s) return;
    loadFonts().then(() => {
      for (const st of SIGNATURE_STYLES) {
        const c = sigRefs.current[st.id];
        if (!c) continue;
        const ctx = c.getContext('2d')!;
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.save(); ctx.scale(2, 2);
        drawSignature(ctx, s.signatureName || s.signerName || 'Your name', st.font, 10, 52, '#1B2421', 220);
        ctx.restore();
      }
    });
  }, [s?.signerName, s?.signatureName]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btnSecondary} onClick={async () => { await auto.flush(); onBack(); }}>← Certificates</button>
        <h3 className="flex-1 text-lg font-bold">Certificate settings</h3>
        <span className="text-sm text-ink-soft">{auto.state.status === 'saving' ? 'Saving…' : auto.state.status === 'error' ? <span className="text-danger">Not saved: {auto.state.error}</span> : s && !dirty ? 'Saved' : ''}</span>
      </div>
      {!s ? <p className="flex items-center gap-2 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p> : (
        <>
          <section className="space-y-3 rounded-2xl border border-line bg-white p-4">
            <h4 className="text-base font-bold">Who signs</h4>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block"><span className={small}>Name</span><input className={input} value={s.signerName} onChange={e => set({ signerName: e.target.value })} placeholder="Name printed under the signature" /></label>
              <label className="block"><span className={small}>Title</span><input className={input} value={s.signerTitle} onChange={e => set({ signerTitle: e.target.value })} placeholder="Director" /></label>
              <label className="block sm:col-span-2"><span className={small}>Name in the signature (optional)</span>
                <input className={input} value={s.signatureName} onChange={e => set({ signatureName: e.target.value })} placeholder={s.signerName || 'A shorter name, e.g. first and last name'} />
                <span className="mt-1 block text-sm text-ink-soft">Leave empty to sign with the name above. Use it to print the full name under a shorter signature.</span>
              </label>
            </div>
            <div>
              <span className={small}>Signature (drawn from the name, not a real signature)</span>
              <div className="grid gap-2 sm:grid-cols-3">
                {SIGNATURE_STYLES.map(st => (
                  <button key={st.id} type="button" onClick={() => set({ signatureStyle: st.id })} aria-pressed={s.signatureStyle === st.id}
                    className={`rounded-xl border p-2 text-left ${s.signatureStyle === st.id ? 'border-accent bg-accent-soft' : 'border-line bg-white hover:bg-surface'}`}>
                    <canvas ref={el => { sigRefs.current[st.id] = el; }} width={480} height={150} className="h-[75px] w-full" />
                    <span className="text-sm font-semibold">{st.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="space-y-3 rounded-2xl border border-line bg-white p-4">
            <h4 className="text-base font-bold">Template</h4>
            <p className="text-sm text-ink-soft">New trainings start with this one. It can be changed on each training.</p>
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Template new trainings start with">
              {CERT_TEMPLATES.map(t => (
                <button key={t.id} type="button" role="radio" aria-checked={s.defaultTemplate === t.id} onClick={() => set({ defaultTemplate: t.id })}
                  className={`rounded-xl border p-3 text-left ${s.defaultTemplate === t.id ? 'border-accent bg-accent-soft' : 'border-line bg-white hover:bg-surface'}`}>
                  <span className={`block text-sm font-bold ${s.defaultTemplate === t.id ? 'text-accent' : ''}`}>{t.label}</span>
                  <span className="block text-sm text-ink-soft">{t.hint}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-3 rounded-2xl border border-line bg-white p-4">
            <h4 className="text-base font-bold">Numbers and HR's link</h4>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block"><span className={small}>Number starts with</span>
                <input className={input} value={s.prefix} onChange={e => set({ prefix: e.target.value.toUpperCase() })} />
                <span className="mt-1 block text-sm text-ink-soft">For example {certNumber(cleanPrefix(s.prefix) || 'NA/CERT', Number(todayIso().slice(0, 4)), 1)}. Numbers run on across all trainings and start again at 0001 each January.</span>
              </label>
              <label className="block"><span className={small}>HR's link works for (days)</span>
                <input className={input} type="number" min={1} max={365} value={s.linkDays} onChange={e => set({ linkDays: Math.max(1, Math.min(365, Number(e.target.value) || 1)) })} /></label>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={s.showIc} onChange={e => set({ showIc: e.target.checked })} className="h-4 w-4 accent-[#0E6E62]" />
              Show IC numbers on new certificates (can be changed on each training)
            </label>
          </section>

          <section className="space-y-3 rounded-2xl border border-line bg-white p-4">
            <h4 className="text-base font-bold">Wording</h4>
            <p className="text-sm text-ink-soft">Printed under the name. <strong>{'{date}'}</strong> and <strong>{'{venue}'}</strong> are filled in from the training.</p>
            {CERT_KINDS.map(k => (
              <label key={k} className="block"><span className={small}>Certificate {KIND_HEADING[k].toLowerCase()}</span>
                <textarea className={`${input} min-h-[4.5rem]`} value={s.wording[k]} onChange={e => set({ wording: { ...s.wording, [k]: e.target.value } })} />
                {s.wording[k] !== DEFAULT_WORDING[k] && <button type="button" className="mt-1 text-sm font-semibold text-accent hover:underline" onClick={() => set({ wording: { ...s.wording, [k]: DEFAULT_WORDING[k] } })}>Back to default</button>}
              </label>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
