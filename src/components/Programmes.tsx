import React, { useRef, useState } from 'react';
import { useCloseOnOutside } from '../lib/useCloseOnOutside';
import { doc, setDoc } from 'firebase/firestore';
import { Loader2, Plus, Search } from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import { HRDC_STATUS_SHORT, HrdcStatus, Programme, programmeStatus, programmeTags, programmesFor, withTbMark } from '../lib/programmes';
import { ProgrammeLinkedInfo, linkOutline, outlineTitle } from './ProgrammeLinks';

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const label = 'mb-1.5 block text-sm font-semibold text-ink';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';

export const STATUS_TONE: Record<HrdcStatus, string> = {
  not_registered: 'bg-surface text-ink-soft',
  submitted: 'bg-attention-soft text-attention',
  approved: 'bg-accent-soft text-accent',
};

export function StatusChip({ programme }: { programme: any }) {
  const st = programmeStatus(programme);
  return <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[st]}`}>{HRDC_STATUS_SHORT[st]}</span>;
}

// ---------- Picker used on the deal form, with quick add ----------
// Joel, 2026-10-23: opening it shows the whole list (by category) to choose from; typing narrows it and also finds
// course outlines. An outline linked to a programme picks that programme; an unlinked one can become the programme
// (its title is the programme name, and the outline is linked to it). Once picked, what's linked to it shows below.
export function ProgrammePicker({ programmes: allProgrammes, value, legacyName, viewer, onChange, kind, outlines, showLinks }: {
  programmes: Programme[]; value: string; legacyName?: string; viewer: Viewer; onChange: (p: Programme) => void;
  kind?: 'training' | 'teambuilding';   // teambuilding: only "(TB)" programmes, and a quick-added one gets "(TB)"
  outlines?: any[];                     // course outlines to search too
  showLinks?: boolean;                  // show the picked programme's outlines, files and trainers
}) {
  const programmes = programmesFor(allProgrammes, kind);
  const selected = allProgrammes.find(p => p.id === value);
  const [queryText, setQueryText] = useState(selected ? '' : legacyName || '');
  const [open, setOpen] = useState(!selected && !!legacyName);
  const boxRef = useRef<HTMLDivElement>(null);
  useCloseOnOutside(boxRef, open, () => setOpen(false));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const q = queryText.trim().toLowerCase();
  const matches = (q ? programmes.filter(p => `${p.name} ${p.hrdcCode || ''} ${p.category || ''} ${programmeTags(p).map(t => `#${t}`).join(' ')}`.toLowerCase().includes(q)) : programmes)
    .slice()
    .sort((a, b) => String(a.category || '~').localeCompare(String(b.category || '~')) || String(a.name).localeCompare(String(b.name)));
  const outlineMatches = !q || !outlines ? [] : outlines
    .filter(o => !o.isHidden && !o.dealDeleted && o.id !== 'outline_default')
    .map(o => ({ o, title: outlineTitle(o, allProgrammes) }))
    .filter(x => x.title && `${x.title} ${x.o.refNumber || ''}`.toLowerCase().includes(q))
    // One row per title (the same outline is often reused); a linked one first.
    .sort((a, b) => Number(!!b.o.programmeId) - Number(!!a.o.programmeId))
    .filter((x, i, all) => all.findIndex(y => y.title.toLowerCase() === x.title.toLowerCase()) === i)
    .slice(0, 6);

  const create = async (typed: string): Promise<Programme | null> => {
    const name = kind === 'teambuilding' ? withTbMark(typed) : typed;
    const dup = allProgrammes.find(p => p.name.trim().toLowerCase() === name.toLowerCase());
    if (dup) return dup;
    const id = `prog_${Date.now()}`;
    const data = { id, name, hrdcStatus: 'not_registered' as HrdcStatus, hrdcCode: '', submittedDate: '', approvedDate: '', notes: '', createdAt: Date.now(), createdById: viewer.id, createdByName: viewer.name };
    await setDoc(doc(db, 'programmes', id), data);
    return data;
  };

  const add = async () => {
    const typed = queryText.trim();
    if (!typed) return setErr('Type the programme name first.');
    setBusy(true);
    setErr('');
    try {
      const p = await create(typed);
      if (p) onChange(p);
      setOpen(false);
      setQueryText('');
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const pickOutline = async (o: any, title: string) => {
    const linked = o.programmeId ? allProgrammes.find(p => p.id === o.programmeId) : undefined;
    if (linked) { onChange(linked); setOpen(false); setQueryText(''); return; }
    setBusy(true);
    setErr('');
    try {
      const p = await create(title);
      if (!p) return;
      onChange(p);
      setOpen(false);
      setQueryText('');
      // Link the outline to it. Someone who can't edit that outline still gets the programme.
      await linkOutline(o, p.id, [...allProgrammes, p]).catch(() => {});
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  if (selected && !open) {
    return (
      <div>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-white px-3 py-2">
          <span className="min-w-0">
            <span className="block truncate font-semibold">{selected.name}</span>
            <span className="mt-0.5 flex items-center gap-2 text-sm text-ink-soft"><StatusChip programme={selected} />{selected.hrdcCode && <span>Code {selected.hrdcCode}</span>}</span>
          </span>
          <button type="button" className="text-sm font-semibold text-accent hover:underline" onClick={() => { setOpen(true); setQueryText(''); }}>Change</button>
        </div>
        {showLinks && <ProgrammeLinkedInfo programme={selected} programmes={allProgrammes} />}
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative">
      <Search className="pointer-events-none absolute left-3 top-[19px] h-4 w-4 -translate-y-1/2 text-ink-soft" />
      <input
        value={queryText}
        onChange={e => { setQueryText(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        className={`${input} pl-9`}
        placeholder={outlines ? 'Choose from the list, or search programmes and course outlines' : 'Choose from the list, or search'}
        aria-label="Search the programme list"
      />
      {open && (
        <div className="mt-1 overflow-hidden rounded-lg border border-line bg-white shadow-lg">
          <div className="max-h-80 overflow-y-auto">
            {matches.map((p, i) => (
              <React.Fragment key={p.id}>
                {(i === 0 || (matches[i - 1].category || '') !== (p.category || '')) && (
                  <p className="bg-surface px-3 py-1 text-xs font-semibold text-ink-soft">{p.category || 'No category'}</p>
                )}
                <button type="button" onClick={() => { onChange(p); setOpen(false); }} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-surface">
                  <span className="min-w-0 truncate text-sm font-semibold">{p.name}</span>
                  <StatusChip programme={p} />
                </button>
              </React.Fragment>
            ))}
            {matches.length === 0 && <p className="px-3 py-2 text-sm text-ink-soft">No programme matches "{queryText}".</p>}
            {outlineMatches.length > 0 && (
              <>
                <p className="bg-surface px-3 py-1 text-xs font-semibold text-ink-soft">Course outlines</p>
                {outlineMatches.map(({ o, title }) => {
                  const linked = o.programmeId ? allProgrammes.find(p => p.id === o.programmeId) : undefined;
                  return (
                    <button key={o.id} type="button" disabled={busy} onClick={() => pickOutline(o, title)} className="block w-full px-3 py-2 text-left hover:bg-surface">
                      <span className="block truncate text-sm font-semibold">{title}</span>
                      <span className="block truncate text-sm text-ink-soft">{linked ? `Programme: ${linked.name}` : 'Not linked yet: use this title as the programme'}</span>
                    </button>
                  );
                })}
              </>
            )}
          </div>
          <button type="button" disabled={busy} onClick={add} className="flex w-full items-center gap-2 border-t border-line px-3 py-2.5 text-left text-sm font-semibold text-accent hover:bg-accent-soft">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add {queryText.trim() ? `"${kind === 'teambuilding' ? withTbMark(queryText) : queryText.trim()}"` : 'a new programme'}
          </button>
        </div>
      )}
      {err && <p role="alert" className="mt-1.5 text-sm text-danger">{err}</p>}
    </div>
  );
}
