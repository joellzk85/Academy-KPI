import React, { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import { CalendarCheck, ClipboardList, Loader2, Plus, Settings2, Smile, Target, Trash2, X } from 'lucide-react';
import DaysOut, { useExcusedDays } from './DaysOut';
import { ItemAverages, RatingDetail, useAllRatings, useRatingItems, useRatingRounds } from './Rating360';
import { db, friendlyError } from '../lib/firebase';
import { formatDate, formatRM, todayIso } from '../lib/deals';
import { hasKpis, kpiValueText, LIGHT_BADGE, LIGHT_TEXT, monthKpi, RepLike, setItemsFor } from '../lib/kpi';
import { appraisalSetItems, LIGHT_LABELS } from '../lib/kpiLibrary';
import { useKpiSources } from '../lib/useKpiSources';
import { useLoginData } from '../lib/loginActivity';
import { itemStars, summarise } from '../lib/rating360';
import {
  DEFAULT_RELIABILITY, EXCUSE_LABELS, Incident, INCIDENT_LABELS, IncidentKind, readIncident, readReliabilitySettings, reliabilityFor,
  ReliabilitySettings, settingsProblem,
} from '../lib/reliability';
import { useAutoSave } from '../lib/useAutoSave';
import { useFormDraft } from '../lib/useFormDraft';
import DraftBar from './DraftBar';

// Appraisal (Joel, 2026-10-22), Management → Appraisal, Management only. One person and a month (or a range of
// months), in three separate cards with no combined total:
// - Part A KPI: results only, the same score as the KPI page (lib/kpi.ts monthKpi) without the 360 rating KPI
//   (lib/kpiLibrary.ts appraisalSetItems). A range shows each month's score and their average.
// - Part B Attitude: closed 360 rounds of those months: average per item, overall, and every rating with who gave it
//   (lib/rating360.ts).
// - Part C Reliability: from the Login log, with days out of office left out and incidents taken off
//   (lib/reliability.ts). Incidents and the score settings are kept here.
// - Management notes per person per period: appraisal_notes/{memberId}_{from}_{to}, saving themselves.

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };
type Person = { id: string; name: string; role: string };

const input = 'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const label = 'mb-1 block text-sm font-semibold text-ink';
const card = 'rounded-2xl border border-line bg-white p-5';
const primaryBtn = 'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-[15px] font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const secondaryBtn = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-50';

const CODES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
// '2026-10' → 'OCT-26' (the KPI screens' month code)
const kpiCode = (ym: string) => `${CODES[Number(ym.slice(5, 7)) - 1]}-${ym.slice(2, 4)}`;
const monthText = (ym: string) => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const lastDay = (ym: string) => {
  const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0);
  return `${ym}-${String(d.getDate()).padStart(2, '0')}`;
};
function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7));
  while (out.length < 12) {
    const ym = `${y}-${String(m).padStart(2, '0')}`;
    if (ym > to) break;
    out.push(ym);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}
const one = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

export default function Appraisal({ viewer, people, settingsOf, kpiOf, deals }: {
  viewer: Viewer;
  people: Person[];                                        // active team members
  settingsOf: (memberId: string) => RepLike;               // KPI set, template and targets (reps/{id})
  kpiOf: (memberId: string, month: string) => any;         // typed weekly numbers for 'OCT-26'
  deals: any[];
}) {
  const thisMonth = todayIso().slice(0, 7);
  const [who, setWho] = useState(people[0]?.id || '');
  const [from, setFrom] = useState(thisMonth);
  const [to, setTo] = useState(thisMonth);
  const person = people.find(p => p.id === who);
  const months = useMemo(() => monthsBetween(from, to < from ? from : to), [from, to]);
  const period = { from: months[0], to: months[months.length - 1] };
  const periodText = months.length > 1 ? `${monthText(period.from)} to ${monthText(period.to)}` : monthText(period.from);

  return (
    <div className="space-y-5 font-sans text-ink">
      <div>
        <h2 className="text-xl font-bold">Appraisal</h2>
        <p className="mt-0.5 text-[15px] text-ink-soft">Results, attitude and reliability, each on its own. They are not added together.</p>
      </div>
      <section className={`${card} grid gap-3 sm:grid-cols-3`}>
        <div>
          <label htmlFor="ap-who" className={label}>Person</label>
          <select id="ap-who" className={input} value={who} onChange={e => setWho(e.target.value)}>
            {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div><label htmlFor="ap-from" className={label}>From month</label><input id="ap-from" type="month" className={input} value={from} onChange={e => { setFrom(e.target.value || thisMonth); if (to < e.target.value) setTo(e.target.value); }} /></div>
        <div><label htmlFor="ap-to" className={label}>To month (up to 12)</label><input id="ap-to" type="month" className={input} value={to} min={from} onChange={e => setTo(e.target.value || from)} /></div>
      </section>
      {!person ? (
        <p className={`${card} text-center text-ink-soft`}>Choose a person.</p>
      ) : (
        <>
          <p className="text-[15px]"><strong>{person.name}</strong> · {periodText}</p>
          <div className="grid gap-4 lg:grid-cols-3">
            <KpiCard person={person} months={months} people={people} settingsOf={settingsOf} kpiOf={kpiOf} deals={deals} />
            <AttitudeCard memberId={person.id} months={months} people={people} />
            <ReliabilityCard viewer={viewer} person={person} people={people} from={`${period.from}-01`} to={lastDay(period.to)} />
          </div>
          <NotesCard key={`${person.id}_${period.from}_${period.to}`} viewer={viewer} memberId={person.id} from={period.from} to={period.to} />
        </>
      )}
    </div>
  );
}

function CardHead({ icon: Icon, part, title }: { icon: React.ElementType; part: string; title: string }) {
  return (
    <div className="mb-3">
      <p className="text-sm font-semibold text-ink-soft">{part}</p>
      <h3 className="flex items-center gap-2 text-lg font-bold"><Icon className="h-5 w-5 text-accent" /> {title}</h3>
    </div>
  );
}
function Big({ value, unit, note }: { value: string; unit?: string; note?: string }) {
  return (
    <div className="mb-3 rounded-xl bg-surface px-4 py-3">
      <p className="text-3xl font-bold tabular-nums">{value}{unit && <span className="ml-1 text-base font-semibold text-ink-soft">{unit}</span>}</p>
      {note && <p className="text-sm text-ink-soft">{note}</p>}
    </div>
  );
}

// ---------- Part A: KPI ----------
function KpiCard({ person, months, people, settingsOf, kpiOf, deals }: {
  person: Person; months: string[]; people: Person[]; settingsOf: (id: string) => RepLike; kpiOf: (id: string, month: string) => any; deals: any[];
}) {
  const codes = months.map(kpiCode);
  const withKpis = people.map(p => ({ ...settingsOf(p.id), id: p.id, role: p.role })).filter(r => hasKpis(r, r.role));
  const sources = useKpiSources({ months: codes, people: withKpis });
  const base = { ...settingsOf(person.id), id: person.id, role: person.role };
  const items = hasKpis(base, person.role) ? appraisalSetItems(setItemsFor(base)) : [];
  const rep: RepLike = { ...base, kpiSet: { ...(base.kpiSet || {}), items } };
  const results = useMemo(() => items.length ? codes.map(code => ({
    code,
    ...monthKpi({ ...rep, kpi: kpiOf(person.id, code) }, deals, code, { ...sources, people: withKpis.map(p => ({ ...p, kpi: kpiOf(p.id, code) })) }),
  })) : [], [person.id, codes.join(), sources, deals, JSON.stringify(items)]);
  const avg = results.length ? Math.round(results.reduce((t, r) => t + r.score, 0) / results.length) : 0;
  return (
    <section className={card}>
      <CardHead icon={Target} part="Part A" title="KPI (results)" />
      {!items.length ? (
        <p className="text-ink-soft">No KPIs set for {person.name}. Management sets them in Team → KPIs.</p>
      ) : (
        <>
          <Big value={`${avg}%`} note={results.length > 1 ? `Average of ${results.length} months` : 'KPI score'} />
          {results.length > 1 ? (
            <ul className="space-y-1.5">
              {results.map((r, i) => (
                <li key={r.code} className="flex justify-between rounded-lg bg-surface px-3 py-1.5 text-[15px]"><span>{monthText(months[i])}</span><strong className="tabular-nums">{r.score}%</strong></li>
              ))}
            </ul>
          ) : (
            <ul className="space-y-1.5">
              {results[0]?.rows.map(r => (
                <li key={r.m.key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface px-3 py-1.5 text-[15px]">
                  <span>{r.m.label} <span className="text-sm text-ink-soft">({Math.round(r.m.weight * 100)}%)</span></span>
                  {r.hasData ? (
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums">{kpiValueText(r.m, r.total, formatRM)}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${LIGHT_BADGE[r.light]}`}>{r.m.scoring === 'bands' ? LIGHT_LABELS[r.light] : `${r.pct}%`}</span>
                    </span>
                  ) : <span className="text-sm text-ink-soft">Nothing to count</span>}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-sm text-ink-soft">Attitude is not part of this score.</p>
        </>
      )}
    </section>
  );
}

// ---------- Part B: Attitude (360) ----------
function AttitudeCard({ memberId, months, people }: { memberId: string; months: string[]; people: Person[] }) {
  const rounds = useRatingRounds().filter(r => months.includes(r.month));
  const closed = rounds.filter(r => r.status === 'closed');
  const stillOpen = rounds.filter(r => r.status === 'open').length;
  const all = useAllRatings();
  const items = useRatingItems();
  const mine = all.filter(x => x.rateeId === memberId && closed.some(r => r.id === x.roundId));
  const sum = summarise(mine);
  const nameOf = (id: string) => people.find(p => p.id === id)?.name;
  return (
    <section className={card}>
      <CardHead icon={Smile} part="Part B" title="Attitude (360)" />
      {!sum.overall ? (
        <p className="text-ink-soft">No ratings from closed rounds in this period.</p>
      ) : (
        <>
          <Big value={one(sum.overall.avg)} unit="/ 5" note={`Overall, from ${sum.overall.count} rating${sum.overall.count === 1 ? '' : 's'}`} />
          <ItemAverages avgs={sum.items} items={items} />
          <ul className="mt-3 space-y-2">
            {mine.map(x => (
              <li key={x.id} className="rounded-xl bg-surface px-3 py-2">
                <RatingDetail r={{ stars: x.stars, itemStars: itemStars(x), itemComments: x.comments, comment: x.comment }} items={items}
                  who={<strong>{x.raterName || nameOf(x.raterId)}</strong>} />
              </li>
            ))}
          </ul>
        </>
      )}
      {stillOpen > 0 && <p className="mt-3 text-sm text-attention">{stillOpen} round{stillOpen === 1 ? '' : 's'} in this period still open; ratings count once closed.</p>}
    </section>
  );
}

// ---------- Part C: Reliability ----------
function useIncidents(memberId: string): Incident[] {
  const [list, setList] = useState<Incident[]>([]);
  useEffect(() => onSnapshot(query(collection(db, 'reliability_incidents'), where('memberId', '==', memberId)),
    s => setList(s.docs.map(d => readIncident(d.id, d.data()))), () => setList([])), [memberId]);
  return list;
}
function useReliabilitySettings(): ReliabilitySettings {
  const [s, setS] = useState<ReliabilitySettings>(DEFAULT_RELIABILITY);
  useEffect(() => onSnapshot(doc(db, 'config', 'reliability'), d => setS(readReliabilitySettings(d.data())), () => {}), []);
  return s;
}

function ReliabilityCard({ viewer, person, people, from, to }: { viewer: Viewer; person: Person; people: Person[]; from: string; to: string }) {
  const { rules, days, error, countedOf } = useLoginData(from);
  const excusedAll = useExcusedDays(from, person.id);
  const incidents = useIncidents(person.id);
  const settings = useReliabilitySettings();
  const [show, setShow] = useState<'' | 'days' | 'incident' | 'settings'>('');
  const excused = (excusedAll || []).filter(e => e.date <= to);
  const r = reliabilityFor({ from, to, today: todayIso(), rules, minutesOf: d => countedOf(person.id, d), excused, incidents, settings });
  const byReason = Object.entries(r.excused.reduce((m, e) => ({ ...m, [e.reason]: (m[e.reason] || 0) + 1 }), {} as Record<string, number>));
  const removeIncident = async (i: Incident) => { try { await deleteDoc(doc(db, 'reliability_incidents', i.id)); } catch { /* shown by the list staying */ } };
  return (
    <section className={card}>
      <CardHead icon={CalendarCheck} part="Part C" title="Reliability" />
      {error && <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {days === null ? (
        <p className="flex items-center gap-2 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
      ) : (
        <>
          {r.score === null
            ? <Big value="–" note="No working days to count yet" />
            : <Big value={one(r.score)} unit="/ 5" note={`${r.sharePct}% of ${r.counted} counted day${r.counted === 1 ? '' : 's'} green or amber → ${r.base}${r.deduction ? `, minus ${one(r.deduction)} for incidents` : ''}`} />}
          <ul className="grid grid-cols-3 gap-1.5 text-center text-sm">
            {(['green', 'amber', 'red'] as const).map(l => (
              <li key={l} className="rounded-lg bg-surface px-2 py-1.5"><span className={`block text-lg font-bold ${LIGHT_TEXT[l]}`}>{r[l]}</span>{LIGHT_LABELS[l]}</li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-ink-soft">
            {r.workDays} working day{r.workDays === 1 ? '' : 's'} so far, {r.excused.length} out of office{byReason.length ? ` (${byReason.map(([k, n]) => `${EXCUSE_LABELS[k as keyof typeof EXCUSE_LABELS]} ${n}`).join(', ')})` : ''}. A day is judged by its CRM time only; start time is never scored.
          </p>
          <div className="mt-3">
            <p className="text-sm font-semibold">Incidents</p>
            {!r.incidents.length ? <p className="text-sm text-ink-soft">None in this period.</p> : (
              <ul className="mt-1 space-y-1.5">
                {r.incidents.map(i => (
                  <li key={i.id} className="flex items-start gap-2 rounded-lg bg-surface px-3 py-1.5 text-[15px]">
                    <span className="flex-1"><strong>{formatDate(i.date)}</strong> · {INCIDENT_LABELS[i.kind]}{i.note && <span className="block text-sm text-ink-soft">{i.note}</span>}</span>
                    <button type="button" onClick={() => removeIncident(i)} className="rounded-md p-1 text-ink-soft hover:bg-white hover:text-danger" aria-label="Remove incident"><Trash2 className="h-4 w-4" /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={secondaryBtn} onClick={() => setShow(show === 'days' ? '' : 'days')}>Days out of office</button>
        <button type="button" className={secondaryBtn} onClick={() => setShow(show === 'incident' ? '' : 'incident')}><Plus className="h-4 w-4" /> Incident</button>
        <button type="button" className={secondaryBtn} onClick={() => setShow('settings')}><Settings2 className="h-4 w-4" /> Score settings</button>
      </div>
      {show === 'days' && <div className="mt-3"><DaysOut viewer={viewer} people={people} memberId={person.id} fromKey={from} /></div>}
      {show === 'incident' && <IncidentForm viewer={viewer} memberId={person.id} onDone={() => setShow('')} />}
      {show === 'settings' && <SettingsDialog viewer={viewer} settings={settings} onClose={() => setShow('')} />}
    </section>
  );
}

function IncidentForm({ viewer, memberId, onDone }: { viewer: Viewer; memberId: string; onDone: () => void }) {
  const [f, setF] = useState({ date: todayIso(), kind: 'late_commitment' as IncidentKind, note: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const draft = useFormDraft(viewer.id, `incident:${memberId}`, f, setF);
  const save = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) return setError('Choose the date.');
    if (!f.note.trim()) return setError('Add a short note on what happened.');
    setBusy(true);
    try {
      await addDoc(collection(db, 'reliability_incidents'), { memberId, date: f.date, kind: f.kind, note: f.note.trim(), byId: viewer.id, byName: viewer.name, at: new Date().toISOString() });
      draft.clear();
      onDone();
    } catch (e) { setError(friendlyError(e)); setBusy(false); }
  };
  return (
    <div className="mt-3 space-y-3 rounded-xl border border-line p-3.5">
      <DraftBar draft={draft} what="incident" />
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label htmlFor="inc-date" className={label}>Date</label><input id="inc-date" type="date" className={input} value={f.date} onChange={e => setF(x => ({ ...x, date: e.target.value }))} /></div>
        <div>
          <label htmlFor="inc-kind" className={label}>What</label>
          <select id="inc-kind" className={input} value={f.kind} onChange={e => setF(x => ({ ...x, kind: e.target.value as IncidentKind }))}>
            {(Object.keys(INCIDENT_LABELS) as IncidentKind[]).map(k => <option key={k} value={k}>{INCIDENT_LABELS[k]}</option>)}
          </select>
        </div>
      </div>
      <div><label htmlFor="inc-note" className={label}>Note</label><textarea id="inc-note" className={`${input} min-h-[64px]`} value={f.note} onChange={e => { setF(x => ({ ...x, note: e.target.value })); setError(''); }} /></div>
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={secondaryBtn} onClick={onDone}>Cancel</button>
        <button type="button" className={primaryBtn} disabled={busy} onClick={save}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save incident</button>
      </div>
    </div>
  );
}

function SettingsDialog({ viewer, settings, onClose }: { viewer: Viewer; settings: ReliabilitySettings; onClose: () => void }) {
  const [s, setS] = useState<ReliabilitySettings>(settings);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const num = (k: keyof ReliabilitySettings) => (e: React.ChangeEvent<HTMLInputElement>) => { setS(x => ({ ...x, [k]: Number(e.target.value) })); setError(''); };
  const save = async () => {
    const p = settingsProblem(s);
    if (p) return setError(p);
    setBusy(true);
    try {
      await setDoc(doc(db, 'config', 'reliability'), { ...s, updatedAt: new Date().toISOString(), updatedById: viewer.id, updatedByName: viewer.name });
      onClose();
    } catch (e) { setError(friendlyError(e)); setBusy(false); }
  };
  const row = (score: number, k: 's5' | 's4' | 's3' | 's2') => (
    <label className="flex items-center gap-2 text-[15px]">
      <span className="w-16 font-semibold">{score} / 5</span> when at least
      <input type="number" min={0} max={100} className={`${input} w-20`} value={s[k]} onChange={num(k)} /> % of days are green or amber
    </label>
  );
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <h3 className="text-lg font-bold">Reliability score settings</h3>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-ink-soft hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-2">
          {row(5, 's5')}{row(4, 's4')}{row(3, 's3')}{row(2, 's2')}
          <p className="text-sm text-ink-soft">Below that: 1 / 5. Days out of office are not counted.</p>
          <label className="flex items-center gap-2 text-[15px]">
            Take off <input type="number" min={0} max={4} step={0.1} className={`${input} w-20`} value={s.incidentDeduction} onChange={num('incidentDeduction')} /> for each incident
          </label>
        </div>
        {error && <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="mt-5 flex justify-between gap-2">
          <button type="button" className={secondaryBtn} onClick={() => setS(DEFAULT_RELIABILITY)}>Reset to default</button>
          <div className="flex gap-2">
            <button type="button" className={secondaryBtn} onClick={onClose}>Cancel</button>
            <button type="button" className={primaryBtn} disabled={busy} onClick={save}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Management notes ----------
function NotesCard({ viewer, memberId, from, to }: { viewer: Viewer; memberId: string; from: string; to: string; key?: string }) {
  const id = `${memberId}_${from}_${to}`;
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState('');
  const [base, setBase] = useState('');
  const [meta, setMeta] = useState('');
  useEffect(() => onSnapshot(doc(db, 'appraisal_notes', id), d => {
    const v = String(d.data()?.text || '');
    if (!loaded) { setText(v); setBase(v); setLoaded(true); }
    setMeta(d.exists() ? `Last saved by ${d.data()?.byName || 'Management'}` : '');
  }, () => setLoaded(true)), [id, loaded]);
  const { state } = useAutoSave({
    value: text, dirty: loaded && text !== base, enabled: loaded, delay: 1500,
    write: v => setDoc(doc(db, 'appraisal_notes', id), { memberId, from, to, text: v, byId: viewer.id, byName: viewer.name, updatedAt: new Date().toISOString() }),
    onSaved: json => setBase(JSON.parse(json)),
  });
  return (
    <section className={card}>
      <label htmlFor="ap-notes" className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-lg font-bold"><ClipboardList className="h-5 w-5 text-accent" /> Management notes</span>
        <span className={`text-sm ${state.status === 'error' ? 'text-danger' : 'text-ink-soft'}`}>
          {state.status === 'error' ? `Couldn't save (${state.error}), trying again` : state.status === 'saving' ? 'Saving…' : text !== base ? 'Saves in a moment' : meta}
        </span>
      </label>
      <p className="mb-2 text-sm text-ink-soft">Kept for this person and this period. Only Management sees them.</p>
      <textarea id="ap-notes" className={`${input} min-h-[120px]`} value={text} disabled={!loaded} onChange={e => setText(e.target.value)} placeholder="Strengths, what to work on, agreed next steps" />
    </section>
  );
}
