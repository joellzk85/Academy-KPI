import React, { useEffect, useState } from 'react';
import { CheckCircle2, Eye, Loader2, X } from 'lucide-react';
import TrainerBiodataDocument from './TrainerBiodataDocument';
import Logo from './Logo';
import { ProfileSubmission, cleanProfile, profileProblem } from '../lib/trainerLinks';
import { PROFILE_PARTS, emptyExtras, profileGaps } from '../lib/trainerProfile';
import TrainerExtrasFields, { TopicList } from './TrainerExtrasFields';
import OutlineLinkForm from './OutlineLinkForm';

// The page a trainer opens from a private link (/t/<token>), without logging in (Joel, 2026-10-17).
// It talks only to the CRM server (serverTrainerLinks.ts), never to the database.

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const label = 'mb-1 block text-sm font-semibold text-ink';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-[15px] font-semibold text-white hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-surface';

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

export default function TrainerLinkPage({ token }: { token: string }) {
  const [info, setInfo] = useState<any>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [problem, setProblem] = useState('');
  const [profile, setProfile] = useState<ProfileSubmission>({
    ...emptyExtras(), name: '', contact: '', email: '', bio: '', experienceYears: 0, qualifications: '', pastClients: '', programmeIds: [], suggestedTopics: '', rate: 0,
  });

  useEffect(() => {
    document.title = 'NEXT Academy';
    post('/api/trainer-link/get', { token }).then(d => {
      setInfo(d);
      if (d.kind === 'profile' && d.prefill) setProfile(cleanProfile(d.prefill, (d.programmes || []).map((p: any) => p.id), token));
    }).catch(e => setError(e.message));
  }, [token]);

  // Nothing is compulsory (Joel, 2026-10-20). Submitting with gaps first lists them once, with "Submit anyway".
  const [nudge, setNudge] = useState<string[] | null>(null);
  // Preview of their HRDC biodata (Joel: the trainer previews only; Admin and Management download it in the CRM).
  const [preview, setPreview] = useState(false);
  const submit = async (e?: React.FormEvent, anyway = false) => {
    e?.preventDefault();
    setProblem('');
    if (info.kind === 'profile' && !anyway) {
      const gaps = profileGaps({ ...profile, icOnFile: info.icOnFile });
      if (gaps.length) { setNudge(gaps); return; }
    }
    setNudge(null);
    const data = cleanProfile(profile, (info.programmes || []).map((p: any) => p.id), token);
    const p = profileProblem(data);
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

  // The extra details (gender, languages, uploads…). Files go to this link's own folder (storage.rules).
  const extrasProps = {
    value: profile,
    onChange: (p: any) => setProfile(cur => ({ ...cur, ...(typeof p === 'function' ? p(cur) : p) })),
    uploader: { prefix: `trainer_uploads/${token}/`, byName: profile.name.trim() || info.trainerName || 'Trainer' },
    onFile: info.onFile,
    ic: {
      value: profile.icNumber || '',
      onChange: (v: string) => setProfile(p => ({ ...p, icNumber: v })),
      note: info.icOnFile
        ? 'We already have your IC / passport number. Type it again only if it has changed. Only NEXT Academy Admin and Management can see it.'
        : 'Kept private: only NEXT Academy Admin and Management can see it.',
    },
    idPrefix: 'p',
    wrap: (title: string, children: React.ReactNode, hint?: string) => (
      <section className="space-y-3 rounded-2xl border border-line bg-white p-5">
        <div><h2 className="font-bold">{title}</h2>{hint && <p className="text-sm text-ink-soft">{hint}</p>}</div>
        {children}
      </section>
    ),
  };

  const intro = (
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
        {info.kind === 'outline' && <p className="mt-2 text-[15px] text-ink-soft">Fill in the parts below. Click <strong className="text-ink">Preview</strong> any time to see it the way NEXT Academy prints it.</p>}
        {info.kind === 'profile' && (() => {
          const pct = Math.round(((PROFILE_PARTS - profileGaps({ ...profile, icOnFile: info.icOnFile }).length) / PROFILE_PARTS) * 100);
          return (
            <div className="mt-3 rounded-xl border border-line bg-white p-4">
              <p className="flex items-center justify-between text-sm font-semibold"><span>Your profile is {pct}% complete</span><span className="text-ink-soft">{pct === 100 ? 'All done, thank you!' : ''}</span></p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} /></div>
              <p className="mt-2 text-sm text-ink-soft">Nothing is compulsory, but please fill in as much as you can. A complete profile helps us match you with the right trainings and present you well to clients.</p>
            </div>
          );
        })()}
      </div>
  );

  if (info.kind === 'outline') return shell(
    <div className="space-y-5">
      {intro}
      <OutlineLinkForm info={info} token={token} post={post} onDone={sent => { setInfo((i: any) => ({ ...i, prefill: sent, status: 'submitted' })); setDone(true); }} />
    </div>
  );

  return shell(
    <form onSubmit={submit} className="space-y-5">
      {intro}

        <>
          <section className="space-y-3 rounded-2xl border border-line bg-white p-5">
            <h2 className="font-bold">Contact details</h2>
            <div><label className={label} htmlFor="p-name">Full name</label><input id="p-name" value={profile.name} onChange={e => setProfile(p => ({ ...p, name: e.target.value }))} className={input} /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className={label} htmlFor="p-phone">Phone</label><input id="p-phone" type="tel" value={profile.contact} onChange={e => setProfile(p => ({ ...p, contact: e.target.value }))} className={input} placeholder="e.g. 012-345 6789" /></div>
              <div><label className={label} htmlFor="p-email">Email</label><input id="p-email" type="email" value={profile.email} onChange={e => setProfile(p => ({ ...p, email: e.target.value }))} className={input} /></div>
            </div>
          </section>

          <TrainerExtrasFields {...extrasProps} only={['about', 'emergency', 'languages']} />

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
            <div>
              <span className={label}>{(info.programmes || []).length > 0 ? 'Other topics you teach (not in the list above)' : 'Topics you teach'}</span>
              <p className="mb-2 text-sm text-ink-soft">One topic per box. Add as many as you like.</p>
              <TopicList value={profile.suggestedTopics} onChange={t => setProfile(p => ({ ...p, suggestedTopics: t }))} idPrefix="p-topic" />
            </div>
          </section>

          <section className="space-y-3 rounded-2xl border border-line bg-white p-5">
            <h2 className="font-bold">Experience</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className={label} htmlFor="p-years">Years of training experience</label><input id="p-years" inputMode="numeric" value={profile.experienceYears || ''} onChange={e => setProfile(p => ({ ...p, experienceYears: Number(e.target.value.replace(/[^0-9.]/g, '')) || 0 }))} className={input} /></div>
              <div><label className={label} htmlFor="p-rate">Your daily rate (RM)</label><input id="p-rate" inputMode="decimal" value={profile.rate || ''} onChange={e => setProfile(p => ({ ...p, rate: Number(e.target.value.replace(/[^0-9.]/g, '')) || 0 }))} className={input} /></div>
            </div>
            <div><label className={label} htmlFor="p-bio">Short bio</label><textarea id="p-bio" rows={4} value={profile.bio} onChange={e => setProfile(p => ({ ...p, bio: e.target.value }))} className={`${input} resize-y`} /></div>
            {(profile.qualifications || profile.otherCerts) && (
              <p className="rounded-lg bg-surface px-3 py-2 text-sm"><span className="font-semibold">You typed before:</span> {[profile.qualifications, profile.otherCerts].filter(Boolean).join(' · ')}<span className="block text-ink-soft">Please put these in the qualification lists below.</span></p>
            )}
            <div><label className={label} htmlFor="p-clients">Past clients <span className="font-normal text-ink-soft">(optional)</span></label><textarea id="p-clients" rows={3} value={profile.pastClients} onChange={e => setProfile(p => ({ ...p, pastClients: e.target.value }))} className={`${input} resize-y`} /></div>
          </section>

          <TrainerExtrasFields {...extrasProps} only={['biodata', 'online', 'uploads']} />
        </>

      {problem && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{problem}</p>}
      {nudge ? (
        <div role="alert" className="mb-10 space-y-3 rounded-2xl border border-attention/40 bg-attention-soft/40 p-5">
          <p className="font-bold">Almost there. Could you add a few more details?</p>
          <p className="text-[15px]">Still empty: {nudge.join(', ')}.</p>
          <p className="text-sm text-ink-soft">Nothing is compulsory. The more you fill in, the better we can match you with trainings. You can also submit now and add the rest later from this same link.</p>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={btnSecondary} onClick={() => setNudge(null)}>Keep filling in</button>
            <button type="button" className={btnSecondary} onClick={() => setPreview(true)}><Eye className="h-4 w-4" /> Preview</button>
            <button type="button" disabled={busy} className={btnPrimary} onClick={() => submit(undefined, true)}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Submit anyway</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap justify-end gap-2 pb-10">
          {info.kind === 'profile' && <button type="button" className={btnSecondary} onClick={() => setPreview(true)}><Eye className="h-4 w-4" /> Preview</button>}
          <button type="submit" disabled={busy} className={btnPrimary}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Submit</button>
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 z-50 flex flex-col bg-ink/50" role="dialog" aria-modal="true" aria-label="Preview of your HRDC biodata" onClick={() => setPreview(false)}>
          <div className="flex items-center justify-between gap-3 bg-white px-4 py-3 shadow" onClick={e => e.stopPropagation()}>
            <p className="text-[15px] font-semibold">Preview: your HRDC trainer biodata</p>
            <button type="button" className={btnSecondary} onClick={() => setPreview(false)}><X className="h-4 w-4" /> Close</button>
          </div>
          <div className="flex-1 overflow-auto p-4" onClick={e => e.stopPropagation()} onContextMenu={e => e.preventDefault()}>
            <div className="mx-auto max-w-[900px] overflow-x-auto rounded-lg shadow-lg">
              <div className="min-w-[640px]">
                <TrainerBiodataDocument t={{ ...profile, name: profile.name || info.trainerName || '' }} icHidden={!profile.icNumber && !!info.icOnFile} />
              </div>
            </div>
            <p className="mx-auto mt-3 max-w-[900px] text-center text-sm text-white">This is how NEXT Academy will present your biodata to HRD Corp. Close it to make changes, then Submit.</p>
          </div>
        </div>
      )}
    </form>
  );
}
