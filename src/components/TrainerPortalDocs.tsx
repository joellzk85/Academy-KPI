import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, BookOpen, CheckCircle2, ChevronDown, Eye, Laptop, Library, Loader2, Pencil, Plus, Search, Send, Smartphone, Trash2, X,
} from 'lucide-react';
import OutlineLinkForm from './OutlineLinkForm';
import TeambuildingSite from './TeambuildingSite';
import PhoneFrame from './PhoneFrame';
import PhotoPicker, { PhotoUpload, shrink } from './PhotoPicker';
import { ActivityForm, Agenda, Points, UpDown, move } from './TeambuildingParts';
import { OutlineSubmission } from '../lib/trainerLinks';
import { TbProposalActivity, TbTrainer, activityFromLibrary, blankActivity, newTbId, resolveTb } from '../lib/teambuilding';
import { TrainerDoc, TrainerDocContent, TrainerDocKind, TrainerTb, cleanTrainerTb, docProblem, docTitle, trainerPreviewTb } from '../lib/trainerDocs';
import { autoSaveText, leaveAfterSave, useAutoSave } from '../lib/useAutoSave';

// The trainer's own course outlines and teambuilding proposals in the portal (Joel, 2026-10-21; lib/trainerDocs.ts).
// They write and change them any time; what they type saves as a draft, and "Send to NEXT Academy" (later
// "Send changes") makes it what the team sees. Preview only: no download or print.

type Api = (path: string, body?: any) => Promise<any>;
type Upload = (path: string, data: Blob, type: string, onProgress: (p: number) => void) => Promise<string>;
type Row = Pick<TrainerDoc, 'id' | 'kind' | 'draft' | 'version' | 'sentAt' | 'updatedAt'> & { unsent: boolean; used: number; title?: string; summary?: string };

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const label = 'mb-1 block text-sm font-semibold text-ink';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-[15px] font-semibold text-white hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-surface disabled:opacity-60';
const card = 'rounded-2xl border border-line bg-white p-5';
const alertBox = 'rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger';
const NO_PRINT = '@media print { html { display: none !important; } }';

const WORDS: Record<TrainerDocKind, { one: string; many: string; intro: string; place: string }> = {
  outline: {
    one: 'course outline', many: 'Course outlines', place: 'Course outlines',
    intro: 'Write the course outlines for the programmes you teach. Click Preview to see one the way NEXT Academy prints it.',
  },
  teambuilding: {
    one: 'teambuilding proposal', many: 'Teambuilding proposals', place: 'Teambuilding proposals',
    intro: 'Design teambuilding programmes: objectives, agenda, activities and takeaways. NEXT Academy adds the packages, prices and venues for each client.',
  },
};
const dayText = (ms?: number) => (ms ? new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export default function DocsTab({ kind, info, api, upload }: { kind: TrainerDocKind; info: any; api: Api; upload: Upload }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<Row | null>(null);
  const [making, setMaking] = useState(false);
  const [programmeId, setProgrammeId] = useState('');
  const [busy, setBusy] = useState(false);
  const w = WORDS[kind];
  const load = () => api('/api/portal/docs/list').then(d => setRows(d.docs.filter((x: Row) => x.kind === kind))).catch(e => setError(e.message));
  useEffect(() => { load(); }, [kind]);

  const make = async () => {
    setBusy(true); setError('');
    try { const d = await api('/api/portal/docs/new', { kind, programmeId }); setMaking(false); setProgrammeId(''); setOpen(d.doc); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const remove = async (r: Row) => {
    if (!window.confirm(`Remove "${r.title || `this ${w.one}`}" from your list?${r.used ? ' NEXT Academy keeps the copies they already made.' : ''}`)) return;
    try { await api('/api/portal/docs/delete', { id: r.id }); load(); } catch (e: any) { setError(e.message); }
  };

  if (open) return <DocEditor key={open.id} start={open} info={info} api={api} upload={upload} onClose={() => { setOpen(null); load(); }} />;

  // Only the programmes they teach, unless they haven't ticked any yet.
  const mine = info.programmes.filter((p: any) => (info.profile.programmeIds || []).includes(p.id));
  const progs = mine.length ? mine : info.programmes;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">My {w.many.toLowerCase()}</h1>
          <p className="max-w-2xl text-[15px] text-ink-soft">{w.intro}</p>
        </div>
        <button type="button" className={btnPrimary} onClick={() => (kind === 'outline' ? setMaking(true) : make())} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} New {w.one}
        </button>
      </div>
      {making && (
        <section className={`${card} space-y-3`}>
          <div>
            <label className={label} htmlFor="d-prog">Which programme is it for?</label>
            <select id="d-prog" value={programmeId} onChange={e => setProgrammeId(e.target.value)} className={input}>
              <option value="">Not in the list (type the title in the outline)</option>
              {progs.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className={btnSecondary} onClick={() => setMaking(false)}>Cancel</button>
            <button type="button" className={btnPrimary} onClick={make} disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Start writing</button>
          </div>
        </section>
      )}
      {error && <p role="alert" className={alertBox}>{error}</p>}
      {!rows ? <p className="flex items-center gap-2 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
        : !rows.length ? <p className={`${card} text-[15px] text-ink-soft`}>No {w.many.toLowerCase()} yet. Click <strong className="text-ink">New {w.one}</strong> to start one.</p>
          : (
            <ul className="space-y-3">
              {rows.map(r => (
                <li key={r.id} className={`${card} flex flex-wrap items-center gap-3 p-4`}>
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen(r)}>
                    <span className="block truncate font-bold">{r.title || `Untitled ${w.one}`}</span>
                    <span className="block text-sm text-ink-soft">{[r.summary, `changed ${dayText(r.updatedAt)}`].filter(Boolean).join(' · ')}</span>
                    <span className="mt-1.5 flex flex-wrap gap-1.5 text-xs font-semibold">
                      {r.sentAt
                        ? <span className="rounded bg-accent-soft px-1.5 py-0.5 text-accent">Sent to NEXT Academy {dayText(r.sentAt)}</span>
                        : <span className="rounded bg-surface px-1.5 py-0.5 text-ink-soft">Draft, not sent yet</span>}
                      {r.sentAt > 0 && r.unsent && <span className="rounded bg-attention-soft px-1.5 py-0.5 text-attention">Changes not sent yet</span>}
                      {r.used > 0 && <span className="rounded bg-surface px-1.5 py-0.5 text-ink">Used by NEXT Academy {r.used === 1 ? 'once' : `${r.used} times`}</span>}
                    </span>
                  </button>
                  <span className="flex gap-2">
                    <button type="button" className={btnSecondary} onClick={() => setOpen(r)}><Pencil className="h-4 w-4" /> Open</button>
                    <button type="button" className={`${btnSecondary} text-danger`} onClick={() => remove(r)} aria-label={`Remove ${r.title || w.one}`}><Trash2 className="h-4 w-4" /></button>
                  </span>
                </li>
              ))}
            </ul>
          )}
    </div>
  );
}

// ---------- One document, full screen ----------
function DocEditor({ start, info, api, upload, onClose }: { start: Row; info: any; api: Api; upload: Upload; onClose: () => void }) {
  const kind = start.kind;
  const [draft, setDraft] = useState<TrainerDocContent>(start.draft);
  const [savedJson, setSavedJson] = useState(JSON.stringify(start.draft));
  const [sentAt, setSentAt] = useState(start.sentAt || 0);
  const [unsent, setUnsent] = useState(start.unsent);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState(false);
  const json = JSON.stringify(draft);
  const dirty = json !== savedJson;
  const { state, flush } = useAutoSave({
    value: draft, dirty, enabled: true,
    write: async v => { const d = await api('/api/portal/docs/save', { id: start.id, draft: v }); setUnsent(d.doc.unsent); }, onSaved: setSavedJson,
  });
  const close = () => leaveAfterSave(flush, onClose);
  const line = note ? { text: note, tone: 'soft' as const } : autoSaveText(state, dirty, false);
  const w = WORDS[kind];

  const send = async () => {
    setError(''); setNote('');
    const p = docProblem(kind, kind === 'teambuilding' ? { ...draft, tb: cleanTrainerTb(draft.tb, info.trainerId) } : draft);
    if (p) { setPreview(false); setError(p); return; }
    setSending(true);
    try {
      const d = await api('/api/portal/docs/save', { id: start.id, draft, send: true });
      setSavedJson(json); setUnsent(false); setSentAt(d.doc.sentAt);
      setNote(d.nothing ? 'Nothing has changed since you sent it.' : `Sent. NEXT Academy can see it in their ${w.place}.`);
    } catch (e: any) { setError(e.message); } finally { setSending(false); }
  };
  const sendBtn = (
    <button type="button" className={btnPrimary} disabled={sending} onClick={send}>
      {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {sentAt ? 'Send changes' : 'Send to NEXT Academy'}
    </button>
  );
  const title = docTitle(kind, draft, info.programmes);
  const progs = info.programmes;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-surface" role="dialog" aria-modal="true" aria-label={w.one}>
      <style dangerouslySetInnerHTML={{ __html: NO_PRINT }} />
      <header className="sticky top-0 z-10 border-b border-line bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate font-bold">{title || `New ${w.one}`}</p>
            <p className={`truncate text-sm ${line.tone === 'danger' ? 'text-danger' : line.tone === 'attention' ? 'text-attention' : 'text-ink-soft'}`}>{line.text}</p>
          </div>
          <button type="button" className={btnSecondary} onClick={close}><X className="h-4 w-4" /> Close</button>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-5 pb-28">
        <p className="rounded-lg bg-accent-soft px-3 py-2.5 text-sm text-ink">
          {sentAt
            ? <>You sent this to NEXT Academy on {dayText(sentAt)}. You can keep changing it: your changes save as you type, and NEXT Academy sees them once you click <strong>Send changes</strong>.{unsent && ' You have changes that are not sent yet.'}</>
            : <>Your work saves as you type. When it's ready, click <strong>Send to NEXT Academy</strong>. You can change it again after sending.</>}
        </p>
        <section className={card}>
          <label className={label} htmlFor="e-prog">Programme</label>
          <select id="e-prog" value={draft.programmeId} onChange={e => setDraft(d => ({ ...d, programmeId: e.target.value }))} className={input}>
            <option value="">Not in the list</option>
            {progs.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </section>
        {kind === 'outline' ? (
          <OutlineLinkForm info={{ prefill: draft.outline, title: progs.find((p: any) => p.id === draft.programmeId)?.name || '', trainerName: info.profile.name }}
            onData={(o: OutlineSubmission) => setDraft(d => (JSON.stringify(d.outline) === JSON.stringify(o) ? d : { ...d, outline: o }))}
            actions={sendBtn} />
        ) : (
          <TbForm tb={draft.tb!} onChange={tb => setDraft(d => ({ ...d, tb }))} info={info} api={api} upload={upload} />
        )}
        {error && <p role="alert" className={alertBox}>{error}</p>}
        {note && <p className="flex items-center gap-2 rounded-lg bg-accent-soft px-3 py-2.5 text-sm text-accent"><CheckCircle2 className="h-4 w-4 shrink-0" /> {note}</p>}
      </main>
      {kind === 'teambuilding' && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-end gap-2 px-4 py-3">
            <button type="button" className={btnSecondary} onClick={() => setPreview(true)}><Eye className="h-4 w-4" /> Preview</button>
            {sendBtn}
          </div>
        </div>
      )}
      {preview && draft.tb && <TbPreview tb={draft.tb} info={info} onClose={() => setPreview(false)} />}
    </div>
  );
}

// ---------- A teambuilding proposal: the content parts only ----------
function Part({ title, hint, action, children }: { title: string; hint?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className={`${card} space-y-3`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h2 className="font-bold">{title}</h2>{hint && <p className="text-sm text-ink-soft">{hint}</p>}</div>
        {action}
      </div>
      {children}
    </section>
  );
}

function TbForm({ tb, onChange, info, api, upload }: { tb: TrainerTb; onChange: (tb: TrainerTb) => void; info: any; api: Api; upload: Upload }) {
  const set = (c: Partial<TrainerTb>) => onChange({ ...tb, ...c });
  const [picking, setPicking] = useState(false);
  const me = { id: info.trainerId, name: info.profile.name || 'Trainer' };
  // Photos go to the trainer's own folder; "photo_<time>.jpg" so the team's PDF can read them later.
  const photoUp: PhotoUpload = async (file, onProgress) => {
    const blob = await shrink(file);
    return upload(`trainer_portal/${info.trainerId}/photo_${Date.now()}.jpg`, blob, 'image/jpeg', onProgress);
  };
  return (
    <div className="space-y-4">
      <Part title="Cover" hint="The first thing the client sees: a big photo with the title over it.">
        <div><label className={label} htmlFor="tb-title">Title</label><input id="tb-title" value={tb.title} onChange={e => set({ title: e.target.value })} className={input} placeholder="e.g. Leading Beyond Expectations" /></div>
        <div><label className={label} htmlFor="tb-sub">Line under the title</label><textarea id="tb-sub" value={tb.subtitle} onChange={e => set({ subtitle: e.target.value })} rows={2} className={`${input} resize-y`} /></div>
        <div className="max-w-xs"><label className={label} htmlFor="tb-stay">Length</label><input id="tb-stay" value={tb.stay} onChange={e => set({ stay: e.target.value })} className={input} placeholder="2 Days 1 Night" /></div>
        <PhotoPicker photos={tb.coverPhoto ? [tb.coverPhoto] : []} onChange={ph => set({ coverPhoto: ph[0] || '' })} folder="covers" me={me} single label="Cover photo" upload={photoUp} />
      </Part>
      <Part title="Teambuilding objectives" hint="What the event sets out to achieve">
        <Points list={tb.objectives} onChange={objectives => set({ objectives })} prefix="ob" titlePh="e.g. Growth mindset and resilient leadership" textPh="Why it matters for the team" />
      </Part>
      <Part title="Trainers" hint="You, and anyone who runs it with you">
        <TrainersPart list={tb.trainers} onChange={trainers => set({ trainers })} info={info} upload={photoUp} />
      </Part>
      <Part title="Agenda" hint="Day by day, time by time">
        <Agenda days={tb.agenda} onChange={agenda => set({ agenda })} />
      </Part>
      <Part title="Featured activities" hint="From NEXT Academy's Activity library, or your own"
        action={<button type="button" className={btnSecondary} onClick={() => setPicking(true)}><Library className="h-4 w-4" /> Add from the library</button>}>
        <ActivitiesPart list={tb.activities} onChange={activities => set({ activities })} me={me} upload={photoUp} />
      </Part>
      <Part title="Key takeaways and next steps" hint="What the team leaves with">
        <Points list={tb.takeaways} onChange={takeaways => set({ takeaways })} prefix="tk" titlePh="e.g. Enhanced collaboration" textPh="One or two lines" />
      </Part>
      <p className="text-sm text-ink-soft">NEXT Academy adds the packages and prices, venues, HRDC note and terms for each client.</p>
      {picking && <LibraryPicker api={api} used={tb.activities} onPick={a => { set({ activities: [...tb.activities, activityFromLibrary(a)] }); setPicking(false); }} onCancel={() => setPicking(false)} />}
    </div>
  );
}

function TrainersPart({ list, onChange, info, upload }: { list: TbTrainer[]; onChange: (l: TbTrainer[]) => void; info: any; upload: PhotoUpload }) {
  const setAt = (i: number, c: Partial<TbTrainer>) => onChange(list.map((x, k) => (k === i ? { ...x, ...c } : x)));
  const me = { id: info.trainerId, name: info.profile.name || 'Trainer' };
  const hasMe = list.some(t => t.trainerId === info.trainerId);
  return (
    <div className="space-y-3">
      {list.map((t, i) => {
        const self = t.trainerId === info.trainerId;
        return (
          <div key={t.id} className="space-y-3 rounded-xl border border-line p-3">
            <div className="flex flex-wrap items-end gap-2">
              {self
                ? <p className="min-w-[12rem] flex-1 pb-2 font-semibold">{info.profile.name || 'You'} <span className="font-normal text-ink-soft">(you: name and photo from your profile)</span></p>
                : <div className="min-w-[12rem] flex-1"><label className={label}>Name</label><input value={t.name || ''} onChange={e => setAt(i, { name: e.target.value })} className={input} /></div>}
              <div className="min-w-[12rem] flex-1"><label className={label}>Title under the name</label><input value={t.role || ''} onChange={e => setAt(i, { role: e.target.value })} className={input} placeholder="Accredited HRDC Trainer" /></div>
              <span className="flex"><UpDown i={i} n={list.length} onMove={by => onChange(move(list, i, by))} />
                <button type="button" className="rounded-md p-1.5 text-ink-soft hover:bg-surface hover:text-danger" onClick={() => onChange(list.filter((_, k) => k !== i))} aria-label="Remove trainer"><Trash2 className="h-4 w-4" /></button></span>
            </div>
            {!self && <PhotoPicker photos={t.photo ? [t.photo] : []} onChange={ph => setAt(i, { photo: ph[0] || '' })} folder="trainers" me={me} single label="Photo" upload={upload} />}
            <div>
              <label className={label}>Bio</label>
              <textarea value={t.bio || ''} onChange={e => setAt(i, { bio: e.target.value })} rows={4} className={`${input} resize-y`}
                placeholder={self ? (info.profile.bio ? 'Leave empty to use the bio on your profile, or write one for this programme.' : 'A short bio for this programme.') : 'A short bio. Lines starting with "- " show as bullet points.'} />
            </div>
          </div>
        );
      })}
      <div className="flex flex-wrap gap-2">
        {!hasMe && <button type="button" className={btnSecondary} onClick={() => onChange([{ id: newTbId('tr'), trainerId: info.trainerId, role: 'Accredited HRDC Trainer' }, ...list])}><Plus className="h-4 w-4" /> Add myself</button>}
        <button type="button" className={btnSecondary} onClick={() => onChange([...list, { id: newTbId('tr'), name: '', role: 'Facilitator' }])}><Plus className="h-4 w-4" /> Add another trainer</button>
      </div>
    </div>
  );
}

function ActivitiesPart({ list, onChange, me, upload }: { list: TbProposalActivity[]; onChange: (l: TbProposalActivity[]) => void; me: { id: string; name: string }; upload: PhotoUpload }) {
  const [open, setOpen] = useState<string | null>(null);
  const setAt = (id: string, c: Partial<TbProposalActivity>) => onChange(list.map(x => (x.id === id ? { ...x, ...c } : x)));
  return (
    <div className="space-y-3">
      {list.length === 0 && <p className="text-[15px] text-ink-soft">No activities yet. Add them from the library, or type your own.</p>}
      {list.map((a, i) => (
        <div key={a.id} className="rounded-xl border border-line">
          <div className="flex items-center gap-3 p-3">
            <span className="h-12 w-16 shrink-0 overflow-hidden rounded-lg bg-surface">{a.photos?.[0] && <img src={a.photos[0]} alt="" className="h-full w-full object-cover" />}</span>
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen(o => (o === a.id ? null : a.id))}>
              <span className="block truncate font-semibold">{a.name || 'New activity'}</span>
              <span className="block truncate text-sm text-ink-soft">{[a.duration, a.location, a.libraryId ? 'from the library' : 'your own'].filter(Boolean).join(' · ')}</span>
            </button>
            <UpDown i={i} n={list.length} onMove={by => onChange(move(list, i, by))} />
            <button type="button" className="rounded-md p-1.5 text-ink-soft hover:bg-surface hover:text-ink" onClick={() => setOpen(o => (o === a.id ? null : a.id))} aria-label={open === a.id ? 'Close' : 'Edit'}>{open === a.id ? <ChevronDown className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}</button>
            <button type="button" className="rounded-md p-1.5 text-ink-soft hover:bg-surface hover:text-danger" onClick={() => onChange(list.filter(x => x.id !== a.id))} aria-label="Remove activity"><Trash2 className="h-4 w-4" /></button>
          </div>
          {open === a.id && (
            <div className="border-t border-line p-3">
              {a.libraryId && <p className="mb-3 text-sm text-ink-soft">Your changes are for this proposal only; the library keeps its own version.</p>}
              <ActivityForm a={a} onChange={c => setAt(a.id, c)} me={me} upload={upload} />
            </div>
          )}
        </div>
      ))}
      <button type="button" className={btnSecondary} onClick={() => { const a = { ...blankActivity(), id: newTbId('pa') }; onChange([...list, a]); setOpen(a.id); }}><Plus className="h-4 w-4" /> Type a new activity</button>
    </div>
  );
}

function LibraryPicker({ api, used, onPick, onCancel }: { api: Api; used: TbProposalActivity[]; onPick: (a: any) => void; onCancel: () => void }) {
  const [list, setList] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => { api('/api/portal/docs/library').then(d => setList(d.activities)).catch(e => setError(e.message)); }, []);
  const t = search.trim().toLowerCase();
  const shown = (list || []).filter(a => !t || `${a.name} ${a.summary} ${a.location}`.toLowerCase().includes(t));
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-ink/40 p-4 pt-16" role="dialog" aria-modal="true" aria-label="Activity library" onClick={onCancel}>
      <div className="w-full max-w-3xl rounded-2xl bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <h3 className="text-lg font-bold">Add from the Activity library</h3>
          <button type="button" onClick={onCancel} className="rounded-md p-1 text-ink-soft hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
          <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search activities" className={`${input} pl-9`} aria-label="Search activities" />
        </div>
        {error && <p role="alert" className={`${alertBox} mt-3`}>{error}</p>}
        {!list && !error && <p className="mt-3 flex items-center gap-2 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
        <ul className="mt-3 grid max-h-[60vh] gap-3 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
          {list && shown.length === 0 && <li className="p-4 text-ink-soft">No activities found.</li>}
          {shown.map(a => (
            <li key={a.id}>
              <button type="button" onClick={() => onPick(a)} className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-line text-left hover:shadow-md">
                <span className="block aspect-[16/9] w-full bg-surface">{a.photos?.[0] && <img src={a.photos[0]} alt="" className="h-full w-full object-cover" />}</span>
                <span className="p-3">
                  <span className="block font-semibold">{a.name}{used.some(u => u.libraryId === a.id) && <span className="ml-2 rounded bg-accent-soft px-1.5 text-xs font-semibold text-accent">Already added</span>}</span>
                  <span className="block text-sm text-ink-soft">{[a.duration, a.location, a.groupSize].filter(Boolean).join(' · ')}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// What the client would see (their parts only). No download, no print.
function TbPreview({ tb, info, onClose }: { tb: TrainerTb; info: any; onClose: () => void }) {
  const [phone, setPhone] = useState(false);
  const r = useMemo(() => resolveTb(trainerPreviewTb(cleanTrainerTb(tb, info.trainerId)), {
    clients: [], deals: [], venues: [], people: [],
    trainers: [{ id: info.trainerId, name: info.profile.name, photoUrl: info.profile.photoUrl, bio: info.profile.bio }],
  }), [tb, info]);
  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-[#e9efed]" role="dialog" aria-modal="true" aria-label="Preview" onContextMenu={e => e.preventDefault()}>
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-white px-4 py-2.5">
        <button type="button" className={btnSecondary} onClick={onClose}><ArrowLeft className="h-4 w-4" /> Back to edit</button>
        <div className="inline-flex rounded-lg border border-line bg-white p-0.5">
          <button type="button" onClick={() => setPhone(false)} className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-semibold ${!phone ? 'bg-ink text-white' : 'text-ink-soft'}`}><Laptop className="h-4 w-4" /> Computer</button>
          <button type="button" onClick={() => setPhone(true)} className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-semibold ${phone ? 'bg-ink text-white' : 'text-ink-soft'}`}><Smartphone className="h-4 w-4" /> Phone</button>
        </div>
        <span className="hidden text-sm text-ink-soft md:inline"><BookOpen className="mr-1 inline h-4 w-4" />How your part will look. NEXT Academy adds packages, prices and venues for each client.</span>
      </div>
      <div className="flex-1 overflow-hidden p-0 sm:p-4">
        {phone ? (
          <div className="mx-auto h-full w-[410px] max-w-full overflow-hidden rounded-[2rem] border-[10px] border-ink bg-white shadow-xl">
            <PhoneFrame><TeambuildingSite r={r} /></PhoneFrame>
          </div>
        ) : (
          <div className="mx-auto h-full max-w-[1400px] overflow-y-auto bg-white shadow-xl sm:rounded-xl"><TeambuildingSite r={r} /></div>
        )}
      </div>
    </div>
  );
}
