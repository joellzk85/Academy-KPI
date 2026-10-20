import React from 'react';
import { History } from 'lucide-react';
import { DraftOffer } from '../lib/useFormDraft';

// "You have an unfinished … from 10:42. Continue / Discard": shown at the top of a form whose earlier
// unsaved copy is kept in this browser (lib/useFormDraft.ts).
export default function DraftBar({ draft, what }: {
  draft: { offer: DraftOffer<unknown> | null; keep: () => void; discard: () => void };
  what: string;    // e.g. "new deal", "change to this client"
}) {
  if (!draft.offer) return null;
  const at = new Date(draft.offer.at);
  const today = at.toDateString() === new Date().toDateString();
  const when = today
    ? at.toLocaleTimeString('en-MY', { hour: 'numeric', minute: '2-digit' })
    : at.toLocaleDateString('en-MY', { day: 'numeric', month: 'short' }) + ', ' + at.toLocaleTimeString('en-MY', { hour: 'numeric', minute: '2-digit' });
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-[15px] text-ink">
      <History className="h-4 w-4 shrink-0 text-accent" />
      <span className="min-w-0 flex-1 basis-56">You have an unfinished {what} from {today ? 'today, ' : ''}{when}, not saved yet.</span>
      <span className="flex gap-2">
        <button type="button" onClick={draft.keep} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90">Continue</button>
        <button type="button" onClick={draft.discard} className="rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-semibold text-ink hover:bg-surface">Discard</button>
      </span>
    </div>
  );
}
