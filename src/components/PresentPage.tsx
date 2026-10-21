import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { collection, doc, onSnapshot, query, setDoc } from 'firebase/firestore';
import { Check, ChevronLeft, ChevronRight, FileDown, Loader2, Maximize2, NotebookPen, Play, Plus, Presentation, Users, X } from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import { Representative } from '../types';
import { linkedOnly, withoutDeleted } from '../lib/linked';
import { formatDate, todayIso } from '../lib/deals';
import { MoneyIn, MoneyOut } from '../lib/money';
import { projectRows } from '../lib/projectPL';
import { useTeamList, useTouchPoints } from '../lib/useClientHistory';
import { Task } from '../lib/tasks';
import {
  chosenCompanySlides, chosenPersonSlides, COMPANY_SLIDES, CompanySlide, PERIOD_KEYS, PERIOD_LABELS, PeriodKey, periodOf,
  PERSON_SLIDES, PersonSlide, PresentData, PresentPrefs,
} from '../lib/present';
import { useMoneySettings } from './Money';
import { companySlides, personSlides, Slide } from './PresentSlides';
import { ChartPalette } from './PresentCharts';
import {
  cleanSettings, DEFAULT_PRESENT_SETTINGS, isHex, longDate, PRESENT_FONTS, PresentSettings, presentPalette, presentStyle,
  useGoogleFont, usePresentSettings,
} from '../lib/presentTheme';
import { useAutoSave } from '../lib/useAutoSave';
import { addDays as addLoginDays, dayKey, useLoginData, weekStart } from '../lib/loginActivity';
import { useFormDraft } from '../lib/useFormDraft';
import DraftBar from './DraftBar';

// The Present tab (Joel, 2026-10-21). Pick the slides and the period, then "Present now" opens a full-screen slideshow
// (arrow keys, Esc to close). Anyone presenting can add action points, each with a deadline and a responsible person;
// they are saved as To-dos (source 'meeting'). Management can also present the company and run the team meeting:
// the company slides, then each person's own chosen slides in turn. "Save as PDF" prints every slide, one per page.
// Choices are saved per person in present_prefs/{memberId}.
// Team meeting (Joel, 2026-10-21): Management and Admin run it and set it up for everyone (present_settings/main:
// title, question for the week, company colours and font). Order: title slide with the day's date, the question
// for the week, the company slides, each manager with KPIs, then everyone else. Admin's company slides leave out
// Profit. Management and Admin type notes on any slide, saved per meeting day in meeting_notes/{date}.

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };
type Mode = 'me' | 'company';
type ShowSlide = Slide & { who?: string; whoId?: string; bare?: boolean };
type Note = { text: string; title: string; who: string; by: string; at: number };
type MeetingNotes = { id: string; date: string; notes: Record<string, Note> };

const noteKey = (s: ShowSlide) => `${s.whoId || 'company'}__${s.key}`.replace(/[^A-Za-z0-9_-]/g, '_');

function useMeetingNotes(): MeetingNotes[] {
  const [all, setAll] = useState<MeetingNotes[]>([]);
  useEffect(() => onSnapshot(collection(db, 'meeting_notes'),
    s => setAll(s.docs.map(d => ({ id: d.id, date: d.id, notes: {}, ...(d.data() as any) })).sort((a, b) => b.date.localeCompare(a.date))),
    () => setAll([])), []);
  return all;
}

const btnPrimary = 'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-[15px] font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';
const input = 'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';

function usePresentData(withMoney: boolean) {
  const [deals, setDeals] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [programmes, setProgrammes] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [ins, setIns] = useState<MoneyIn[]>([]);
  const [venues, setVenues] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const touchPoints = useTouchPoints();
  useEffect(() => {
    const list = (s: any) => s.docs.map((d: any) => ({ ...d.data(), id: d.id }));
    const subs = [
      onSnapshot(query(collection(db, 'pipelines')), s => { setDeals(linkedOnly(list(s))); setLoaded(true); }, () => setLoaded(true)),
      onSnapshot(query(collection(db, 'clients')), s => setClients(list(s)), () => setClients([])),
      onSnapshot(query(collection(db, 'programmes')), s => setProgrammes(list(s)), () => setProgrammes([])),
      onSnapshot(query(collection(db, 'tasks')), s => setTasks(list(s)), () => setTasks([])),
      onSnapshot(query(collection(db, 'money_in')), s => setIns(withoutDeleted(list(s))), () => setIns([])),
      onSnapshot(query(collection(db, 'venues_directory')), s => setVenues(list(s)), () => setVenues([])),
    ];
    return () => subs.forEach(u => u());
  }, []);

  // Management only (money out is staff-only; profit is Management's): costs, quotations (SST) and typed SST.
  const [outs, setOuts] = useState<MoneyOut[]>([]);
  const [quotes, setQuotes] = useState<any[]>([]);
  const [plDocs, setPlDocs] = useState<Record<string, any>>({});
  useEffect(() => {
    if (!withMoney) return;
    const subs = [
      onSnapshot(query(collection(db, 'money_out')), s => setOuts(withoutDeleted(s.docs.map(d => ({ ...(d.data() as MoneyOut), id: d.id })))), () => setOuts([])),
      onSnapshot(query(collection(db, 'quotations')), s => setQuotes(linkedOnly(s.docs.map(d => ({ ...d.data(), id: d.id })))), () => setQuotes([])),
      onSnapshot(query(collection(db, 'project_pl')), s => setPlDocs(Object.fromEntries(s.docs.map(d => [d.id, d.data()]))), () => setPlDocs({})),
    ];
    return () => subs.forEach(u => u());
  }, [withMoney]);

  const data: PresentData = useMemo(() => ({ deals, clients, programmes, touchPoints, tasks, ins, venues }), [deals, clients, programmes, touchPoints, tasks, ins, venues]);
  return { data, loaded, outs, quotes, plDocs };
}

function usePresentPrefs(): Record<string, PresentPrefs> {
  const [all, setAll] = useState<Record<string, PresentPrefs>>({});
  useEffect(() => onSnapshot(collection(db, 'present_prefs'), s => setAll(Object.fromEntries(s.docs.map(d => [d.id, d.data() as PresentPrefs]))), () => setAll({})), []);
  return all;
}

export default function PresentPage({ viewer, person, reps, month, companyOnly }: {
  viewer: Viewer;
  person?: Representative;              // whose week (not given for Management without KPIs)
  reps: Representative[];               // people with KPIs, for the team slides and the meeting
  month: string;                        // the KPI month shown (e.g. 'OCT-26')
  companyOnly?: boolean;
}) {
  const team = useTeamList();
  const people = useMemo(() => team.map(p => ({ id: p.id, name: p.name })), [team]);
  const activePeople = useMemo(() => team.filter(p => p.active).map(p => ({ id: p.id, name: p.name })), [team]);
  const isManager = viewer.role === 'management';
  const isStaff = isManager || viewer.role === 'admin';
  const canCompany = isStaff && (companyOnly || person?.id === viewer.id);
  const look = usePresentSettings();
  useGoogleFont(look.font);
  const meetings = useMeetingNotes();
  const [mode, setMode] = useState<Mode>(companyOnly || !person ? 'company' : 'me');
  const { data, loaded, outs, quotes, plDocs } = usePresentData(isManager);
  const settings = useMoneySettings();
  const prefsAll = usePresentPrefs();
  const today = todayIso();

  // The person's own saved choice; Management looking at someone else can try other slides without saving them.
  const ownerId = mode === 'company' ? viewer.id : person?.id || viewer.id;
  const canSave = ownerId === viewer.id;
  const saved = prefsAll[ownerId];
  const [local, setLocal] = useState<PresentPrefs>({});
  const prefs: PresentPrefs = { ...saved, ...local };
  const save = (changes: PresentPrefs) => {
    setLocal(l => ({ ...l, ...changes }));
    if (canSave) setDoc(doc(db, 'present_prefs', viewer.id), { ...changes, updatedAt: Date.now() }, { merge: true }).catch(() => { /* kept on screen */ });
  };

  const personKeys = chosenPersonSlides(prefs, person?.role);
  // Profit and Login log are Management's.
  const companyKeys = chosenCompanySlides(prefs).filter(k => isManager || !COMPANY_SLIDES.find(s => s.key === k)?.manager);
  const loginFrom = useMemo(() => dayKey(addLoginDays(weekStart(new Date()), -21)), []);
  const loginData = useLoginData(loginFrom, isManager && companyKeys.includes('logins'));
  const periodKey: PeriodKey = (mode === 'company' ? prefs.companyPeriod : prefs.period) || 'week';
  const period = periodOf(periodKey, today);

  const plRows = useMemo(() => (isManager ? projectRows(data.deals, data.ins, outs, settings, today, { quotes, plDocs }) : []), [isManager, data.deals, data.ins, outs, settings, today, quotes, plDocs]);

  const buildPerson = (rep: Representative, animate: boolean): ShowSlide[] => {
    const p = prefsAll[rep.id] || (rep.id === ownerId ? prefs : undefined);
    const pk = rep.id === ownerId && mode === 'me' ? personKeys : chosenPersonSlides(p, rep.role);
    const per = periodOf((rep.id === ownerId && mode === 'me' ? periodKey : p?.period) || 'week', today);
    return personSlides({ rep, reps: people, keys: pk, data, period: per, month, today, animate }).map(s => ({ ...s, who: rep.name, whoId: rep.id }));
  };
  const buildCompany = (animate: boolean): ShowSlide[] =>
    companySlides({ keys: companyKeys, data, period, today, month, animate, reps, people, settings, plRows, logins: { ...loginData, people: team.filter(p => p.active) } }).map(s => ({ ...s, who: 'NEXT Academy' }));

  const [show, setShow] = useState<null | 'one' | 'meeting'>(null);
  const [printing, setPrinting] = useState<null | 'one' | 'meeting'>(null);
  const slidesFor = (kind: 'one' | 'meeting', animate: boolean): ShowSlide[] => {
    if (kind === 'one') return mode === 'company' ? buildCompany(animate) : person ? buildPerson(person, animate) : [];
    const out: ShowSlide[] = [{ key: 'title', title: look.title, subtitle: longDate(today), bare: true, body: <TitleSlide look={look} date={today} /> }];
    if (look.question.trim()) out.push({ key: 'question', title: 'Question for the week', bare: true, body: <QuestionSlide question={look.question} /> });
    out.push(...buildCompany(animate));
    // Management first, then everyone else in the usual order.
    [...reps.filter(r => r.role === 'management'), ...reps.filter(r => r.role !== 'management')].forEach(r => {
      out.push({ key: `cover_${r.id}`, title: r.name, who: r.name, whoId: r.id, body: <Cover name={r.name} /> });
      out.push(...buildPerson(r, animate));
    });
    return out;
  };

  const toggle = <K extends string>(list: K[], k: K, all: { key: K }[]): K[] => {
    const next = list.includes(k) ? list.filter(x => x !== k) : [...list, k];
    return all.map(s => s.key).filter(x => next.includes(x));   // keep the catalogue order
  };
  const catalogue = mode === 'company' ? COMPANY_SLIDES.filter(s => isManager || !s.manager) : PERSON_SLIDES.filter(s => !s.admin || person?.role !== 'rep');
  const chosen: string[] = mode === 'company' ? companyKeys : personKeys;

  return (
    <div className="space-y-5 font-sans text-ink">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Present</h2>
          <p className="mt-0.5 text-[15px] text-ink-soft">
            {mode === 'company' ? 'Company performance for the team meeting.' : `${person && person.id !== viewer.id ? `${person.name}'s` : 'Your'} week for the team meeting. Pick what to show, then present.`}
          </p>
        </div>
        {canCompany && person && (
          <div className="inline-flex rounded-lg border border-line bg-white p-0.5" role="tablist" aria-label="What to present">
            {([['me', 'My week'], ['company', 'Company']] as const).map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => { setMode(k); setLocal({}); }}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold ${mode === k ? 'bg-ink text-white' : 'text-ink-soft hover:text-ink'}`}>{l}</button>
            ))}
          </div>
        )}
      </div>

      <section className="rounded-2xl border border-line bg-white p-5">
        <h3 className="font-bold">Period</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {PERIOD_KEYS.map(k => (
            <button key={k} type="button" aria-pressed={periodKey === k} onClick={() => save(mode === 'company' ? { companyPeriod: k } : { period: k })}
              className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold ${periodKey === k ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-soft hover:bg-surface'}`}>
              {PERIOD_LABELS[k]}
            </button>
          ))}
        </div>
        <p className="mt-2 text-sm text-ink-soft">{period.label}{period.prev ? `, compared with ${period.prevLabel}` : ''}. The KPI scorecard and team KPI scores use {month ? 'the KPI month chosen on the KPI page' : 'this month'}.</p>
      </section>

      <section className="rounded-2xl border border-line bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold">Slides <span className="font-normal text-ink-soft">({chosen.length} chosen)</span></h3>
          {!canSave && <span className="text-sm text-ink-soft">Changes here are for this showing only; {person?.name} keeps their own choice.</span>}
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {catalogue.map(s => {
            const on = chosen.includes(s.key);
            return (
              <button key={s.key} type="button" aria-pressed={on}
                onClick={() => save(mode === 'company' ? { companySlides: toggle(companyKeys, s.key as CompanySlide, COMPANY_SLIDES) } : { slides: toggle(personKeys, s.key as PersonSlide, PERSON_SLIDES) })}
                className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-colors ${on ? 'border-accent bg-accent-soft/60' : 'border-line hover:bg-surface'}`}>
                <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${on ? 'border-accent bg-accent text-white' : 'border-line bg-white'}`}>{on && <Check className="h-3.5 w-3.5" />}</span>
                <span><span className="block font-semibold">{s.label}</span><span className="block text-sm text-ink-soft">{s.hint}</span></span>
              </button>
            );
          })}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btnPrimary} disabled={!loaded || !chosen.length} onClick={() => setShow('one')}>
          {loaded ? <Play className="h-4 w-4" /> : <Loader2 className="h-4 w-4 animate-spin" />} Present now
        </button>
        {mode === 'company' && (
          <button type="button" className={btnSecondary} disabled={!loaded} onClick={() => setShow('meeting')} title="Title, question for the week, company slides, Management, then everyone else">
            <Users className="h-4 w-4" /> Run team meeting
          </button>
        )}
        <button type="button" className={btnSecondary} disabled={!loaded || !chosen.length} onClick={() => setPrinting('one')}><FileDown className="h-4 w-4" /> Save as PDF</button>
        {mode === 'company' && <button type="button" className={btnSecondary} disabled={!loaded} onClick={() => setPrinting('meeting')}><FileDown className="h-4 w-4" /> Team meeting PDF</button>}
      </div>

      {mode === 'company' && isStaff && <MeetingSetup viewer={viewer} look={look} />}
      {meetings.some(m => Object.values(m.notes || {}).some(n => n?.text?.trim())) && <PastNotes meetings={meetings} />}

      {show && <SlideShow slides={slidesFor(show, true)} subtitleWho={show === 'meeting'} viewer={viewer} people={activePeople} defaultOwner={mode === 'me' ? person?.id : undefined}
        look={look} canNote={isStaff} notes={meetings.find(m => m.date === today)?.notes || {}} onClose={() => setShow(null)} />}
      {printing && <PrintAll slides={slidesFor(printing, false)} look={look} notes={meetings.find(m => m.date === today)?.notes || {}} onDone={() => setPrinting(null)} />}
    </div>
  );
}

function Cover({ name }: { name: string }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
      <span className="flex h-24 w-24 items-center justify-center rounded-full bg-accent text-4xl font-extrabold text-white">{name.slice(0, 1).toUpperCase()}</span>
      <p className="text-3xl font-extrabold">{name}</p>
      <p className="text-ink-soft">Over to you</p>
    </div>
  );
}

// Slide 1: the title on the main colour, with the meeting's date filled in.
function TitleSlide({ look, date, small }: { look: PresentSettings; date: string; small?: boolean }) {
  const id = `ts-${small ? 's' : 'l'}`;
  return (
    <div className="relative flex aspect-video w-full items-center overflow-hidden rounded-2xl" style={{ background: look.primary, fontFamily: `"${look.font}", sans-serif` }}>
      <svg viewBox="0 0 1600 900" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden="true">
        <defs>
          <linearGradient id={`${id}-shade`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#000" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity="0.12" />
          </linearGradient>
          <linearGradient id={`${id}-light`} x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.02" />
            <stop offset="1" stopColor="#fff" stopOpacity="0.12" />
          </linearGradient>
        </defs>
        <polygon points="1040,0 1140,0 1410,455 1180,900 1080,900 1310,455" fill={`url(#${id}-shade)`} />
        <polygon points="1140,0 1600,0 1600,900 1180,900 1410,455" fill={`url(#${id}-light)`} />
      </svg>
      <div className="relative pl-[12%] text-white">
        <p className={`max-w-[60%] font-bold leading-[0.95] ${small ? 'text-3xl' : 'text-5xl sm:text-7xl lg:text-8xl'}`}>{look.title}</p>
        <p className={`mt-4 ${small ? 'text-xs' : 'text-lg sm:text-2xl'}`}>{longDate(date)}</p>
      </div>
    </div>
  );
}

// Slide 2: the question for the week.
function QuestionSlide({ question }: { question: string }) {
  return (
    <div className="flex min-h-[50vh] flex-col justify-center gap-6 px-2 sm:px-10">
      <p className="text-lg font-bold text-accent sm:text-xl">Question for the week</p>
      <p className="whitespace-pre-line text-3xl font-bold leading-tight sm:text-5xl">{question}</p>
    </div>
  );
}

// Management and Admin: the title, the question for the week and the look, for everyone.
function MeetingSetup({ viewer, look }: { viewer: Viewer; look: PresentSettings }) {
  const pick = (s: PresentSettings) => ({ title: s.title, question: s.question, primary: s.primary, text: s.text, background: s.background, font: s.font });
  const [form, setForm] = useState(() => pick(look));
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const draft = useFormDraft(viewer.id, open ? 'meeting-setup' : null, form, setForm);
  useGoogleFont(form.font);
  useEffect(() => { if (!open) setForm(pick(look)); }, [open, look]);   // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof typeof form, v: string) => { setForm(f => ({ ...f, [k]: v })); setMsg(''); };
  const preview = cleanSettings(form);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return setMsg('Type the title.');
    if (![form.primary, form.text, form.background].every(isHex)) return setMsg('Colours must look like #5BC09F.');
    setBusy(true);
    try {
      await setDoc(doc(db, 'present_settings', 'main'), { ...form, title: form.title.trim(), question: form.question.trim(), updatedBy: viewer.name, updatedAt: Date.now() });
      draft.clear();
      setMsg('Saved for everyone.');
      setOpen(false);
    } catch (err) {
      setMsg(friendlyError(err));
    } finally { setBusy(false); }
  };

  const colour = (k: 'primary' | 'text' | 'background', label: string) => (
    <div>
      <label htmlFor={`ms-${k}`} className="mb-1 block text-sm font-semibold">{label}</label>
      <div className="flex gap-2">
        <input type="color" aria-label={`${label} picker`} value={isHex(form[k]) ? form[k] : '#000000'} onChange={e => set(k, e.target.value.toUpperCase())} className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-line bg-white p-1" />
        <input id={`ms-${k}`} value={form[k]} onChange={e => set(k, e.target.value.trim())} className={input} maxLength={7} />
      </div>
    </div>
  );

  return (
    <section className="rounded-2xl border border-line bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-bold">Team meeting set-up</h3>
          <p className="mt-0.5 text-sm text-ink-soft">
            Title, question for the week and company look, the same for everyone.
            {look.updatedBy ? ` Last changed by ${look.updatedBy}${look.updatedAt ? `, ${formatDate(new Date(look.updatedAt).toISOString().slice(0, 10))}` : ''}.` : ''}
          </p>
        </div>
        {!open && <button type="button" className={btnSecondary} onClick={() => { setOpen(true); setMsg(''); }}>Edit</button>}
      </div>

      {!open ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,18rem)_1fr]">
          <TitleSlide look={look} date={todayIso()} small />
          <div className="text-[15px]">
            <p className="text-sm font-semibold text-ink-soft">Question for the week</p>
            <p className="mt-1 whitespace-pre-line">{look.question || <span className="text-ink-soft">None set. The meeting skips this slide.</span>}</p>
            <p className="mt-3 text-sm text-ink-soft">Font {look.font} Â· colours {look.primary}, {look.text}, {look.background}</p>
            {msg && <p className="mt-2 text-sm font-semibold text-accent">{msg}</p>}
          </div>
        </div>
      ) : (
        <form onSubmit={save} className="mt-4 space-y-4">
          <DraftBar draft={draft} what="change to the team meeting set-up" />
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
            <div className="space-y-4">
              <div>
                <label htmlFor="ms-title" className="mb-1 block text-sm font-semibold">Title (slide 1, the date is added automatically)</label>
                <input id="ms-title" value={form.title} onChange={e => set('title', e.target.value)} className={input} maxLength={60} />
              </div>
              <div>
                <label htmlFor="ms-q" className="mb-1 block text-sm font-semibold">Question for the week (slide 2; leave empty to skip it)</label>
                <textarea id="ms-q" value={form.question} onChange={e => set('question', e.target.value)} className={`${input} min-h-[80px]`} maxLength={400} placeholder="e.g. Which client are we closest to signing, and what will get it over the line?" />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {colour('primary', 'Main colour')}
                {colour('text', 'Text colour')}
                {colour('background', 'Background')}
              </div>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <div>
                  <label htmlFor="ms-font" className="mb-1 block text-sm font-semibold">Font</label>
                  <select id="ms-font" value={form.font} onChange={e => set('font', e.target.value)} className={input}>
                    {PRESENT_FONTS.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
                <button type="button" className={btnSecondary} onClick={() => setForm(f => ({ ...f, ...pick({ ...DEFAULT_PRESENT_SETTINGS, title: f.title, question: f.question }) }))}>Use company colours</button>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-semibold text-ink-soft">Preview</p>
              <TitleSlide look={preview} date={todayIso()} small />
              <div className="rounded-xl border border-line p-3" style={presentStyle(preview)}>
                <p className="font-bold">Slide heading</p>
                <p className="text-sm text-ink-soft">Normal text on a slide</p>
                <div className="mt-2 flex gap-1.5">{presentPalette(preview).slice(0, 4).map(c => <span key={c} className="h-4 flex-1 rounded" style={{ background: c }} />)}</div>
              </div>
            </div>
          </div>
          {msg && <p className="text-sm font-semibold text-danger">{msg}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className={btnSecondary} onClick={() => { draft.discard(); setOpen(false); }}>Cancel</button>
            <button type="submit" className={btnPrimary} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save for everyone</button>
          </div>
        </form>
      )}
    </section>
  );
}

// Notes typed during earlier meetings, newest first.
function PastNotes({ meetings }: { meetings: MeetingNotes[] }) {
  const withNotes = meetings
    .map(m => ({ ...m, list: Object.values(m.notes || {}).filter(n => n?.text?.trim()).sort((a, b) => (a.at || 0) - (b.at || 0)) }))
    .filter(m => m.list.length)
    .slice(0, 8);
  return (
    <section className="rounded-2xl border border-line bg-white p-5">
      <h3 className="font-bold">Meeting notes</h3>
      <div className="mt-3 divide-y divide-line">
        {withNotes.map((m, k) => (
          <details key={m.id} open={k === 0} className="py-2">
            <summary className="cursor-pointer font-semibold">{longDate(m.date)} <span className="font-normal text-ink-soft">({m.list.length} note{m.list.length === 1 ? '' : 's'})</span></summary>
            <ul className="mt-2 space-y-2">
              {m.list.map((n, i) => (
                <li key={i} className="rounded-xl bg-surface px-3 py-2 text-[15px]">
                  <p className="text-sm font-semibold text-ink-soft">{[n.who, n.title].filter(Boolean).join(' Â· ')}</p>
                  <p className="whitespace-pre-line">{n.text}</p>
                  <p className="mt-0.5 text-xs text-ink-soft">by {n.by}</p>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </section>
  );
}

// The note on one slide of today's meeting; saves itself a moment after typing stops.
function NoteBox({ slide, viewer, saved, date }: { slide: ShowSlide; viewer: Viewer; saved: string; date: string }) {
  const [text, setText] = useState(saved);
  const [base, setBase] = useState(saved);
  const k = noteKey(slide);
  const { state } = useAutoSave({
    value: text, dirty: text !== base, enabled: true, delay: 1200,
    write: v => setDoc(doc(db, 'meeting_notes', date), {
      date, updatedAt: Date.now(),
      notes: { [k]: { text: v, title: slide.title, who: slide.who || '', by: viewer.name, at: Date.now() } },
    }, { merge: true }),
    onSaved: json => setBase(JSON.parse(json)),
  });
  return (
    <div className="border-t border-line bg-surface px-4 py-3 sm:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-1">
        <label htmlFor="slide-note" className="flex items-center justify-between text-sm font-semibold">
          <span>Notes on this slide</span>
          <span className={`font-normal ${state.status === 'error' ? 'text-danger' : 'text-ink-soft'}`}>
            {state.status === 'error' ? `Couldn't save (${state.error}), trying again` : state.status === 'saving' ? 'Savingâ€¦' : text !== base ? 'Saves in a moment' : base ? 'Saved' : ''}
          </span>
        </label>
        <textarea id="slide-note" value={text} onChange={e => setText(e.target.value)} className={`${input} min-h-[64px]`} placeholder="What was said, decided or agreed" />
      </div>
    </div>
  );
}

// ---------- Full-screen slideshow ----------
function SlideShow({ slides, subtitleWho, viewer, people, defaultOwner, look, canNote, notes, onClose }: {
  slides: ShowSlide[]; subtitleWho: boolean; viewer: Viewer; people: { id: string; name: string }[]; defaultOwner?: string;
  look: PresentSettings; canNote: boolean; notes: Record<string, Note>; onClose: () => void;
}) {
  const [i, setI] = useState(0);
  const [adding, setAdding] = useState(false);
  const [noting, setNoting] = useState(false);
  const palette = useMemo(() => presentPalette(look), [look]);
  const [raised, setRaised] = useState<{ detail: string; who: string; due: string }[]>([]);
  const n = slides.length;
  const s = slides[Math.min(i, n - 1)];
  const go = (by: number) => setI(x => Math.max(0, Math.min(n - 1, x + by)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (adding) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;   // typing a note
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); go(1); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(-1); }
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); };
  }, []);
  const fullScreen = () => { (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => { /* not allowed */ }); };

  if (!s) return null;
  return createPortal(
    <ChartPalette.Provider value={palette}>
    <div className="fixed inset-0 z-[200] flex flex-col font-sans text-ink" style={presentStyle(look)} role="dialog" aria-modal="true" aria-label="Presentation">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3 sm:px-8">
        <Presentation className="h-5 w-5 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-extrabold sm:text-2xl">{s.title}</p>
          <p className="truncate text-sm text-ink-soft">{[subtitleWho || s.whoId ? s.who : '', s.subtitle].filter(Boolean).join(' Â· ')}</p>
        </div>
        {canNote && (
          <button type="button" className={btnSecondary} aria-pressed={noting} onClick={() => setNoting(x => !x)}>
            <NotebookPen className="h-4 w-4" /> <span className="hidden sm:inline">{noting ? 'Hide notes' : 'Notes'}</span>
          </button>
        )}
        <button type="button" className={btnSecondary} onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> <span className="hidden sm:inline">Action point</span></button>
        <button type="button" className={`${btnSecondary} hidden sm:inline-flex`} onClick={fullScreen} aria-label="Full screen"><Maximize2 className="h-4 w-4" /></button>
        <button type="button" className={btnSecondary} onClick={onClose} aria-label="Close presentation"><X className="h-4 w-4" /></button>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8 sm:py-8">
        <div key={s.key + i} className="mx-auto max-w-6xl animate-[present-in_350ms_ease-out]">{s.body}</div>
      </main>

      {canNote && noting && <NoteBox key={noteKey(s)} slide={s} viewer={viewer} saved={notes[noteKey(s)]?.text || ''} date={todayIso()} />}

      <footer className="flex items-center gap-3 border-t border-line px-4 py-3 sm:px-8">
        <button type="button" className={btnSecondary} onClick={() => go(-1)} disabled={i === 0} aria-label="Previous slide"><ChevronLeft className="h-5 w-5" /></button>
        <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5 overflow-hidden">
          {n <= 30 ? slides.map((x, k) => (
            <button key={k} type="button" onClick={() => setI(k)} aria-label={`Slide ${k + 1}: ${x.title}`}
              className={`h-2 rounded-full transition-all ${k === i ? 'w-6 bg-accent' : 'w-2 bg-line hover:bg-ink-soft/40'}`} />
          )) : <span className="text-sm text-ink-soft">{s.who}</span>}
        </div>
        <span className="text-sm tabular-nums text-ink-soft">{i + 1} / {n}</span>
        <button type="button" className={btnSecondary} onClick={() => go(1)} disabled={i === n - 1} aria-label="Next slide"><ChevronRight className="h-5 w-5" /></button>
      </footer>

      {raised.length > 0 && !adding && (
        <div className="pointer-events-none absolute bottom-20 right-4 max-w-xs rounded-xl bg-ink px-4 py-3 text-sm text-white shadow-lg">
          <p className="font-semibold">{raised.length} action point{raised.length === 1 ? '' : 's'} added to To-do</p>
          <p className="truncate text-white/80">Last: {raised[raised.length - 1].detail} ({raised[raised.length - 1].who}, {formatDate(raised[raised.length - 1].due)})</p>
        </div>
      )}

      {adding && (
        <ActionPointForm viewer={viewer} people={people} defaultOwner={s.whoId || defaultOwner} context={s.title}
          onClose={() => setAdding(false)} onSaved={r => { setRaised(x => [...x, r]); setAdding(false); }} />
      )}
    </div>
    </ChartPalette.Provider>,
    document.body,
  );
}

// An action point = a To-do with a deadline and the responsible person, marked as from the meeting.
function ActionPointForm({ viewer, people, defaultOwner, context, onClose, onSaved }: {
  viewer: Viewer; people: { id: string; name: string }[]; defaultOwner?: string; context: string;
  onClose: () => void; onSaved: (r: { detail: string; who: string; due: string }) => void;
}) {
  const [detail, setDetail] = useState('');
  const [who, setWho] = useState(defaultOwner && people.some(p => p.id === defaultOwner) ? defaultOwner : '');
  const [due, setDue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const nameOf = (id: string) => people.find(p => p.id === id)?.name || '';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail.trim()) return setError('Write what needs doing.');
    if (!who) return setError('Pick the responsible person.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return setError('Pick the deadline.');
    const today = todayIso();
    const id = `task_${Date.now()}`;
    const t: Task & { source: 'meeting'; meetingDate: string; meetingSlide: string } = {
      id, detail: detail.trim(), dateline: due, status: 'Not done',
      assignedById: viewer.id, assignedBy: viewer.name, assignedToId: who, assignedTo: nameOf(who), assignedToIds: [who],
      dateCreated: today, createdAt: Date.now(), ownerRepId: who,
      source: 'meeting', meetingDate: today, meetingSlide: context,
    };
    setBusy(true);
    try {
      await setDoc(doc(db, 'tasks', id), t);
      onSaved({ detail: t.detail, who: nameOf(who), due });
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  };

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-ink/40 p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()} className="w-full max-w-md space-y-4 rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold">Add action point</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-ink-soft hover:bg-surface"><X className="h-5 w-5" /></button>
        </div>
        <div>
          <label htmlFor="ap-d" className="mb-1 block text-sm font-semibold">What needs doing</label>
          <textarea id="ap-d" autoFocus value={detail} onChange={e => setDetail(e.target.value)} className={`${input} min-h-[80px]`} placeholder="e.g. Call Valmont about the March training dates" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="ap-w" className="mb-1 block text-sm font-semibold">Responsible person</label>
            <select id="ap-w" value={who} onChange={e => setWho(e.target.value)} className={input}>
              <option value="">Pickâ€¦</option>
              {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="ap-due" className="mb-1 block text-sm font-semibold">Deadline</label>
            <input id="ap-due" type="date" min={todayIso()} value={due} onChange={e => setDue(e.target.value)} className={input} />
          </div>
        </div>
        {error && <p className="text-sm font-semibold text-danger">{error}</p>}
        <p className="text-sm text-ink-soft">It goes on their To-do list with this deadline, marked "Action point".</p>
        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onClose}>Cancel</button>
          <button type="submit" className={btnPrimary} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Add to To-do</button>
        </div>
      </form>
    </div>
  );
}

// ---------- Save as PDF: every slide on its own landscape page ----------
function PrintAll({ slides, look, notes, onDone }: { slides: ShowSlide[]; look: PresentSettings; notes: Record<string, Note>; onDone: () => void }) {
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = '@page { size: A4 landscape; margin: 10mm; }';
    document.head.appendChild(style);
    const after = () => onDone();
    window.addEventListener('afterprint', after);
    const t = window.setTimeout(() => window.print(), 700);   // let the charts draw first
    return () => { window.clearTimeout(t); window.removeEventListener('afterprint', after); style.remove(); };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  return createPortal(
    <ChartPalette.Provider value={presentPalette(look)}>
    <div className="print-paper present-print" style={{ ...presentStyle(look), position: 'absolute', left: -20000, top: 0, width: 1040 }} aria-hidden="true">
      {slides.map((s, k) => (
        <section key={k} className="present-print-slide font-sans text-ink">
          {!s.bare && (
            <div className="mb-4 border-b border-line pb-2">
              <p className="text-2xl font-extrabold">{s.title}</p>
              <p className="text-sm text-ink-soft">{[s.who, s.subtitle].filter(Boolean).join(' Â· ')}</p>
            </div>
          )}
          {s.body}
          {notes[noteKey(s)]?.text?.trim() && (
            <div className="mt-4 rounded-xl border border-line px-4 py-3 text-[15px]">
              <p className="text-sm font-semibold text-ink-soft">Notes</p>
              <p className="whitespace-pre-line">{notes[noteKey(s)].text}</p>
            </div>
          )}
        </section>
      ))}
    </div>
    </ChartPalette.Provider>,
    document.body,
  );
}
