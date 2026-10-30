// "Show on the website" for a title and for a trainer (Batch 2, Joel 2026-10-30; docs/features/website.md).
// Admin and Management tick them; the tick goes live on the website within half a minute. A trainer is shown only
// once they agreed (it's their personal data). What the website shows comes from lib/websiteData.ts.
import React, { useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { ExternalLink, Globe, Loader2 } from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import { slugify } from '../lib/website';
import { TitleWebsite, TrainerWebsite, niceTitle } from '../lib/websiteData';
import { refreshSite } from '../lib/useWebsite';
import { useFormDraft } from '../lib/useFormDraft';
import DraftBar from './DraftBar';

type Viewer = { id: string; name: string };
const input = 'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const label = 'mb-1.5 block text-sm font-semibold text-ink';

function SaveRow({ busy, saved, error, onSave, link }: { busy: boolean; saved: boolean; error: string; onSave: () => void; link?: string }) {
  return (
    <>
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onSave} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-[#0B5A50] disabled:opacity-60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save website settings
        </button>
        {saved && <span className="text-sm text-accent">Saved.</span>}
        {link && <a href={link} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline"><ExternalLink className="h-4 w-4" /> See it on the test site</a>}
      </div>
    </>
  );
}

/** In a title's details (Course outlines / Teambuilding proposal → By title). */
export function TitleWebsiteBox({ programme, outlines, viewer }: {
  programme: { id: string; name: string; website?: TitleWebsite };
  outlines: { id: string; label: string }[];   // this title's course outlines
  viewer: Viewer;
}) {
  const start = { show: !!programme.website?.show, name: programme.website?.name || '', summary: programme.website?.summary || '', outlineId: programme.website?.outlineId || '' };
  const [f, setF] = useState(start);
  const draft = useFormDraft(viewer.id, `title-website:${programme.id}`, f, setF);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const shownName = f.name.trim() || niceTitle(programme.name);

  const save = async () => {
    if (f.show && !f.outlineId && !f.summary.trim()) return setError('Pick the course outline the page uses, or write a short description.');
    setBusy(true); setError(''); setSaved(false);
    try {
      await updateDoc(doc(db, 'programmes', programme.id), { website: { show: f.show, name: f.name.trim(), summary: f.summary.trim(), outlineId: f.outlineId }, updatedAt: Date.now(), updatedById: viewer.id, updatedByName: viewer.name });
      draft.discard(); setSaved(true); refreshSite();
    } catch (e) { setError(friendlyError(e)); }
    setBusy(false);
  };

  return (
    <section className="space-y-3 rounded-xl border border-line p-4">
      <h4 className="flex items-center gap-2 font-semibold"><Globe className="h-4 w-4 text-accent" /> Website</h4>
      <DraftBar draft={draft} what="change to the website settings" />
      <label className="flex items-center gap-2 text-[15px]">
        <input type="checkbox" checked={f.show} onChange={e => { setF(v => ({ ...v, show: e.target.checked })); setSaved(false); }} className="h-4 w-4 accent-[#0E6E62]" />
        Show on the website
      </label>
      {f.show && (
        <>
          <div>
            <label htmlFor={`tw-name-${programme.id}`} className={label}>Name on the website <span className="font-normal text-ink-soft">(optional)</span></label>
            <input id={`tw-name-${programme.id}`} value={f.name} onChange={e => setF(v => ({ ...v, name: e.target.value }))} placeholder={niceTitle(programme.name)} className={input} />
            <p className="mt-1 text-sm text-ink-soft">Page address: /programmes/{slugify(shownName)}</p>
          </div>
          <div>
            <label htmlFor={`tw-outline-${programme.id}`} className={label}>Course outline the page uses</label>
            <select id={`tw-outline-${programme.id}`} value={f.outlineId} onChange={e => setF(v => ({ ...v, outlineId: e.target.value }))} className={input}>
              <option value="">None (just the description)</option>
              {outlines.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <p className="mt-1 text-sm text-ink-soft">Only its overview, objectives, who it's for, modules, methods and length are shown. Never the client's name, prices or anything else on it.</p>
          </div>
          <div>
            <label htmlFor={`tw-sum-${programme.id}`} className={label}>Short description <span className="font-normal text-ink-soft">(optional; the outline's overview is used when empty)</span></label>
            <textarea id={`tw-sum-${programme.id}`} value={f.summary} onChange={e => setF(v => ({ ...v, summary: e.target.value }))} className={`${input} min-h-[70px]`} maxLength={400} />
          </div>
        </>
      )}
      <SaveRow busy={busy} saved={saved} error={error} onSave={save} link={programme.website?.show ? `/site/programmes/${slugify(programme.website?.name || niceTitle(programme.name))}` : undefined} />
    </section>
  );
}

/** In a trainer's panel (Trainers). */
export function TrainerWebsiteBox({ trainer, viewer }: { trainer: { id: string; name: string; website?: TrainerWebsite }; viewer: Viewer }) {
  const start = { show: !!trainer.website?.show, agreed: !!trainer.website?.agreed, headline: trainer.website?.headline || '' };
  const [f, setF] = useState(start);
  const draft = useFormDraft(viewer.id, `trainer-website:${trainer.id}`, f, setF);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setBusy(true); setError(''); setSaved(false);
    try {
      await updateDoc(doc(db, 'trainers_directory', trainer.id), { website: { show: f.show && f.agreed, agreed: f.agreed, headline: f.headline.trim(), byName: viewer.name, at: Date.now() } });
      draft.discard(); setSaved(true); refreshSite();
    } catch (e) { setError(friendlyError(e)); }
    setBusy(false);
  };

  return (
    <section className="mt-4 space-y-3 rounded-xl border border-line p-4">
      <h4 className="flex items-center gap-2 text-sm font-semibold text-ink-soft"><Globe className="h-4 w-4 text-accent" /> Website</h4>
      <DraftBar draft={draft} what="change to the website settings" />
      <label className="flex items-start gap-2 text-[15px]">
        <input type="checkbox" checked={f.agreed} onChange={e => { setF(v => ({ ...v, agreed: e.target.checked, show: e.target.checked && v.show })); setSaved(false); }} className="mt-1 h-4 w-4 accent-[#0E6E62]" />
        <span>{trainer.name} agreed to be shown on the website</span>
      </label>
      <label className={`flex items-center gap-2 text-[15px] ${f.agreed ? '' : 'opacity-50'}`}>
        <input type="checkbox" disabled={!f.agreed} checked={f.show} onChange={e => { setF(v => ({ ...v, show: e.target.checked })); setSaved(false); }} className="h-4 w-4 accent-[#0E6E62]" />
        Show on the website
      </label>
      {f.show && (
        <div>
          <label htmlFor={`trw-h-${trainer.id}`} className={label}>One line under their name</label>
          <input id={`trw-h-${trainer.id}`} value={f.headline} onChange={e => setF(v => ({ ...v, headline: e.target.value }))} placeholder="e.g. Accredited HRDC Trainer · Corporate Coach" className={input} maxLength={120} />
        </div>
      )}
      <p className="text-sm text-ink-soft">Shown: photo, name, this line, bio, years of experience, qualifications, certifications, languages and the titles they teach. Never their phone, email, IC, rate, address or past clients.</p>
      <SaveRow busy={busy} saved={saved} error={error} onSave={save} link={trainer.website?.show ? `/site/trainers/${slugify(trainer.name)}` : undefined} />
    </section>
  );
}
