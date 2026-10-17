import React, { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, CheckCircle2, Loader2, Plus, Trash2 } from 'lucide-react';
import Logo from './Logo';
import {
  OutlineSubmission, ProfileSubmission, cleanOutline, cleanProfile, outlineProblem, profileProblem,
} from '../lib/trainerLinks';

// The page a trainer opens from a private link (/t/<token>), without logging in (Joel, 2026-10-17).
// It talks only to the CRM server (serverTrainerLinks.ts), never to the database.

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const label = 'mb-1 block text-sm font-semibold text-ink';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-[15px] font-semibold text-white hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-surface';
const iconBtn = 'rounded-md p-1.5 text-ink-soft hover:bg-surface disabled:opacity-30';

async function post(path: string, body: any) {
  let res: Response;
  try {
    res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new Error('No internet connection. Check it and try again.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) throw new Error(data?.error || 'Something went wrong. Please try again in a minute.');
  return data;
}

const emptyModule = () => ({ moduleTitle: '', duration: '', methodology: '', topics: '' });

export default function TrainerLinkPage({ token }: { token: string }) {
  const [info, setInfo] = useState<any>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [problem, setProblem] = useState('');
  const [outline, setOutline] = useState<OutlineSubmission>({
    durationDays: 1, totalHours: 8, level: 'Beginner', audience: '', prerequisites: '', overview: '', outcomes: [], items: [emptyModule()],
  });
  const [outcomesText, setOutcomesText] = useState('');
  const [profile, setProfile] = useState<ProfileSubmission>({
    name: '', contact: '', email: '', bio: '', experienceYears: 0, qualifications: '', pastClients: '', programmeIds: [], suggestedTopics: '', rate: 0,
  });

  useEffect(() => {
    document.title = 'NEXT Academy';
    post('/api/trainer-link/get', { token }).then(d => {
      setInfo(d);
      if (d.kind === 'outline' && d.prefill) {
        const o = cleanOutline(d.prefill);
        setOutline({ ...o, items: o.items.length ? o.items : [emptyModule()] });
        setOutcomesText(o.outcomes.join('\n'));
      }
      if (d.kind === 'profile' && d.prefill) setProfile(cleanProfile(d.prefill, (d.programmes || []).map((p: any) => p.id)));
    }).catch(e => setError(e.message));
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProblem('');
    const data = info.kind === 'outline'
      ? cleanOutline({ ...outline, outcomes: outcomesText.split('\n') })
      : cleanProfile(profile, (info.programmes || []).map((p: any) => p.id));
    const p = info.kind === 'outline' ? outlineProblem(data as OutlineSubmission) : profileProblem(data as ProfileSubmission);
    if (p) return setProblem(p);
    setBusy(true);
    try {
      await post('/api/trainer-link/submit', { token, data });
      setDone(true);
      window.scrollTo(0, 0);
    } catch (err: any) {
      setProblem(err.message);
    } finally {
      setBusy(false);
    }
  };

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-surface font-sans text-ink">
      <header className="border-b border-line bg-white"><div className="mx-auto max-w-3xl px-4 py-3"><Logo /></div></header>
      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
    </div>
  );

  if (error) return shell(<div className="rounded-2xl border border-line bg-white p-6 text-[15px]">{error}</div>);
  if (!info) return shell(<p className="flex items-center gap-2 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>);
  if (done) return shell(
    <div className="rounded-2xl border border-line bg-white p-6">
      <p className="flex items-center gap-2 text-lg font-bold"><CheckCircle2 className="h-6 w-6 text-accent" /> Thank you, we've received it.</p>
      <p className="mt-2 text-[15px] text-ink-soft">The NEXT Academy team will review it. If you need to correct anything, open this link again and submit once more.</p>
      <button type="button" className={`${btnSecondary} mt-4`} onClick={() => setDone(false)}>Make a correction</button>
    </div>
  );

  const setItem = (i: number, c: any) => setOutline(o => ({ ...o, items: o.items.map((m, k) => (k === i ? { ...m, ...c } : m)) }));
  const moveItem = (i: number, d: number) => setOutline(o => {
    const items = [...o.items]; const j = i + d;
    if (j < 0 || j >= items.length) return o;
    [items[i], items[j]] = [items[j], items[i]];
    return { ...o, items };
  });

  return shell(
    <form onSubmit={submit} className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">{info.kind === 'outline' ? 'Course outline' : 'Your trainer profile'}</h1>
        <p className="mt-1 text-[15px] text-ink-soft">
          {info.trainerName ? `Hi ${info.trainerName}, ` : 'Hi, '}
          {info.kind === 'outline'
            ? <>{info.askedBy} from NEXT Academy is asking for your course outline{info.title ? <> for <strong className="text-ink">{info.title}</strong></> : ''}.</>
            : <>{info.askedBy} from NEXT Academy is asking you to fill in your trainer profile.</>}
          {' '}Your answers go to the NEXT Academy team for review.
        </p>
        {info.status === 'submitted' && <p className="mt-2 rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">You've already submitted this. You can correct it and submit again.</p>}
      </div>

      {info.kind === 'outline' ? (
        <>
          <section className="space-y-3 rounded-2xl border border-line bg-white p-5">
            <h2 className="font-bold">Course details</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <div><label className={label} htmlFor="t-days">Days</label><input id="t-days" inputMode="decimal" value={outline.durationDays || ''} onChange={e => setOutline(o => ({ ...o, durationDays: Number(e.target.value.replace(/[^0-9.]/g, '')) || 0 }))} className={input} /></div>
              <div><label className={label} htmlFor="t-hours">Total hours</label><input id="t-hours" inputMode="decimal" value={outline.totalHours || ''} onChange={e => setOutline(o => ({ ...o, totalHours: Number(e.target.value.replace(/[^0-9.]/g, '')) || 0 }))} className={input} /></div>
              <div><label className={label} htmlFor="t-level">Level</label>
                <select id="t-level" value={outline.level} onChange={e => setOutline(o => ({ ...o, level: e.target.value as any }))} className={input}>
                  <option>Beginner</option><option>Intermediate</option><option>Advanced</option>
                </select></div>
            </div>
            <div><label className={label} htmlFor="t-aud">Who it's for</label><input id="t-aud" value={outline.audience} onChange={e => setOutline(o => ({ ...o, audience: e.target.value }))} className={input} placeholder="e.g. New managers and team leaders" /></div>
            <div><label className={label} htmlFor="t-pre">Prerequisites <span className="font-normal text-ink-soft">(optional)</span></label><input id="t-pre" value={outline.prerequisites} onChange={e => setOutline(o => ({ ...o, prerequisites: e.target.value }))} className={input} /></div>
            <div><label className={label} htmlFor="t-ov">Overview</label><textarea id="t-ov" rows={4} value={outline.overview} onChange={e => setOutline(o => ({ ...o, overview: e.target.value }))} className={`${input} resize-y`} /></div>
            <div><label className={label} htmlFor="t-out">Learning outcomes <span className="font-normal text-ink-soft">(one per line)</span></label><textarea id="t-out" rows={4} value={outcomesText} onChange={e => setOutcomesText(e.target.value)} className={`${input} resize-y`} placeholder={'By the end, participants will be able to…'} /></div>
          </section>

          <section className="space-y-3 rounded-2xl border border-line bg-white p-5">
            <h2 className="font-bold">Modules</h2>
            {outline.items.map((m, i) => (
              <div key={i} className="space-y-2 rounded-xl border border-line p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-ink-soft">Module {i + 1}</span>
                  <span className="flex">
                    <button type="button" className={iconBtn} disabled={i === 0} onClick={() => moveItem(i, -1)} aria-label={`Move module ${i + 1} up`}><ArrowUp className="h-4 w-4" /></button>
                    <button type="button" className={iconBtn} disabled={i === outline.items.length - 1} onClick={() => moveItem(i, 1)} aria-label={`Move module ${i + 1} down`}><ArrowDown className="h-4 w-4" /></button>
                    <button type="button" className={iconBtn} disabled={outline.items.length === 1} onClick={() => setOutline(o => ({ ...o, items: o.items.filter((_, k) => k !== i) }))} aria-label={`Remove module ${i + 1}`}><Trash2 className="h-4 w-4" /></button>
                  </span>
                </div>
                <input value={m.moduleTitle} onChange={e => setItem(i, { moduleTitle: e.target.value })} placeholder="Module title" aria-label={`Module ${i + 1} title`} className={input} />
                <div className="grid gap-2 sm:grid-cols-2">
                  <input value={m.duration} onChange={e => setItem(i, { duration: e.target.value })} placeholder="Duration, e.g. 2 hours" aria-label={`Module ${i + 1} duration`} className={input} />
                  <input value={m.methodology} onChange={e => setItem(i, { methodology: e.target.value })} placeholder="Method, e.g. Lecture, role play" aria-label={`Module ${i + 1} method`} className={input} />
                </div>
                <textarea rows={3} value={m.topics} onChange={e => setItem(i, { topics: e.target.value })} placeholder="Topics covered (one per line)" aria-label={`Module ${i + 1} topics`} className={`${input} resize-y`} />
              </div>
            ))}
            <button type="button" className={btnSecondary} onClick={() => setOutline(o => ({ ...o, items: [...o.items, emptyModule()] }))}><Plus className="h-4 w-4" /> Add a module</button>
          </section>
        </>
      ) : (
        <>
          <section className="space-y-3 rounded-2xl border border-line bg-white p-5">
            <h2 className="font-bold">Contact details</h2>
            <div><label className={label} htmlFor="p-name">Full name</label><input id="p-name" value={profile.name} onChange={e => setProfile(p => ({ ...p, name: e.target.value }))} className={input} /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className={label} htmlFor="p-phone">Phone</label><input id="p-phone" type="tel" value={profile.contact} onChange={e => setProfile(p => ({ ...p, contact: e.target.value }))} className={input} placeholder="e.g. 012-345 6789" /></div>
              <div><label className={label} htmlFor="p-email">Email</label><input id="p-email" type="email" value={profile.email} onChange={e => setProfile(p => ({ ...p, email: e.target.value }))} className={input} /></div>
            </div>
          </section>

          <section className="space-y-3 rounded-2xl border border-line bg-white p-5">
            <h2 className="font-bold">What you teach</h2>
            {(info.programmes || []).length > 0 && (
              <div>
                <span className={label}>Programmes from our list you can teach</span>
                <div className="grid gap-1 sm:grid-cols-2">
                  {info.programmes.map((pg: any) => (
                    <label key={pg.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[15px] hover:bg-surface">
                      <input type="checkbox" checked={profile.programmeIds.includes(pg.id)} className="h-4 w-4 accent-[#0E6E62]"
                        onChange={e => setProfile(p => ({ ...p, programmeIds: e.target.checked ? [...p.programmeIds, pg.id] : p.programmeIds.filter(x => x !== pg.id) }))} />
                      {pg.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div><label className={label} htmlFor="p-topics">Other topics you teach <span className="font-normal text-ink-soft">(not in the list above)</span></label><textarea id="p-topics" rows={3} value={profile.suggestedTopics} onChange={e => setProfile(p => ({ ...p, suggestedTopics: e.target.value }))} className={`${input} resize-y`} /></div>
          </section>

          <section className="space-y-3 rounded-2xl border border-line bg-white p-5">
            <h2 className="font-bold">Experience</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className={label} htmlFor="p-years">Years of training experience</label><input id="p-years" inputMode="numeric" value={profile.experienceYears || ''} onChange={e => setProfile(p => ({ ...p, experienceYears: Number(e.target.value.replace(/[^0-9.]/g, '')) || 0 }))} className={input} /></div>
              <div><label className={label} htmlFor="p-rate">Your daily rate (RM)</label><input id="p-rate" inputMode="decimal" value={profile.rate || ''} onChange={e => setProfile(p => ({ ...p, rate: Number(e.target.value.replace(/[^0-9.]/g, '')) || 0 }))} className={input} /></div>
            </div>
            <div><label className={label} htmlFor="p-bio">Short bio</label><textarea id="p-bio" rows={4} value={profile.bio} onChange={e => setProfile(p => ({ ...p, bio: e.target.value }))} className={`${input} resize-y`} /></div>
            <div><label className={label} htmlFor="p-qual">Qualifications and certifications</label><textarea id="p-qual" rows={3} value={profile.qualifications} onChange={e => setProfile(p => ({ ...p, qualifications: e.target.value }))} className={`${input} resize-y`} placeholder="e.g. HRDC TTT certified, degree, professional certificates" /></div>
            <div><label className={label} htmlFor="p-clients">Past clients <span className="font-normal text-ink-soft">(optional)</span></label><textarea id="p-clients" rows={3} value={profile.pastClients} onChange={e => setProfile(p => ({ ...p, pastClients: e.target.value }))} className={`${input} resize-y`} /></div>
          </section>
        </>
      )}

      {problem && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{problem}</p>}
      <div className="flex justify-end pb-10">
        <button type="submit" disabled={busy} className={btnPrimary}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Submit</button>
      </div>
    </form>
  );
}
