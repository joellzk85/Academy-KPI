import React from 'react';
import { ProfileSubmission } from '../lib/trainerLinks';
import TrainerExtrasFields, { TopicList } from './TrainerExtrasFields';

// The trainer's own profile form: contact, about, what they teach, experience, HRDC biodata, online, uploads.
// Shared by the profile link page (TrainerLinkPage.tsx) and the trainer portal (TrainerPortal.tsx, 2026-10-21).

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const label = 'mb-1 block text-sm font-semibold text-ink';

export default function TrainerProfileFields({ profile, setProfile, programmes, extrasProps }: {
  profile: ProfileSubmission;
  setProfile: React.Dispatch<React.SetStateAction<ProfileSubmission>>;
  programmes: { id: string; name: string }[];
  extrasProps: React.ComponentProps<typeof TrainerExtrasFields>;
}) {
  return (
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
        {programmes.length > 0 && (
          <div>
            <span className={label}>Programmes from our list you can teach</span>
            <div className="grid gap-1 sm:grid-cols-2">
              {programmes.map(pg => (
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
          <span className={label}>{programmes.length > 0 ? 'Other topics you teach (not in the list above)' : 'Topics you teach'}</span>
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
  );
}
