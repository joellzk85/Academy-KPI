import React, { useRef, useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db, friendlyError } from '../lib/firebase';
import { Programme, categoryList, programmeTags, programmesFor, titleKey } from '../lib/programmes';
import { CategoryPicker, TagInput, TitleKind, allTagsOf, createTitle } from './TitleList';

// The title's category and #tags, inside the outline (or proposal) editor (Joel, 2026-10-24: "a #tag tab in course
// outline"). They belong to the title, so every outline with the same title shares them. Saved straight away; a
// title that's only typed so far gets its record on the first change.

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };
const label = 'mb-1 block text-sm font-semibold text-ink';

export default function TitleTagsBox({ kind, programmeId, title, programmes, viewer }: {
  kind: TitleKind; programmeId?: string; title: string; programmes: Programme[]; viewer: Viewer;
}) {
  const [error, setError] = useState('');
  const [newCat, setNewCat] = useState('');   // a new category being typed, saved on leaving the box
  const made = useRef<string>('');            // the record just made here, before the list shows it (no doubles)
  const list = programmesFor(programmes, kind);
  const p = (programmeId && programmes.find(x => x.id === programmeId)) || list.find(x => titleKey(x.name) === titleKey(title));
  const pid = p?.id || made.current;
  if (!p && !title.trim()) return null;

  const write = async (c: { category?: string; tags?: string[] }) => {
    setError('');
    try {
      const stamp = { updatedAt: Date.now(), updatedById: viewer.id, updatedByName: viewer.name };
      if (pid) await updateDoc(doc(db, 'programmes', pid), { ...c, ...stamp });
      else made.current = (await createTitle(kind, title, viewer, { ...c, ...stamp } as any)).id;
    } catch (e) {
      setError(friendlyError(e));
    }
  };

  const category = newCat || String(p?.category || '');
  return (
    <div className="grid gap-3 rounded-xl border border-line bg-surface/50 p-3 sm:grid-cols-[minmax(0,14rem)_1fr]">
      <div onBlur={() => { if (newCat.trim()) { write({ category: newCat.trim() }); setNewCat(''); } }}>
        <label className={label} htmlFor="tt-box-cat">Category</label>
        <CategoryPicker id="tt-box-cat" value={category} categories={categoryList(list)}
          onChange={v => (categoryList(list).includes(v) || !v ? (setNewCat(''), write({ category: v })) : setNewCat(v))} />
      </div>
      <div>
        <label className={label} htmlFor="tt-box-tags">#Tags <span className="font-normal text-ink-soft">(shared by every outline with this title)</span></label>
        <TagInput id="tt-box-tags" tags={programmeTags(p)} allTags={allTagsOf(programmes)} onChange={t => write({ tags: t })} />
      </div>
      {error && <p role="alert" className="text-sm text-danger sm:col-span-2">{error}</p>}
    </div>
  );
}
