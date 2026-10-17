import React, { useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db, friendlyError } from '../lib/firebase';
import { trainingTimeOf } from '../lib/trainingTime';

type Viewer = { id: string; name: string };

// Training time on a deal (Joel, 2026-10-17): shows the quotation's time, or one typed for this deal.
// "Change" types a different time (saved on the deal as trainingTime); "Use the quotation's time" clears it.
export default function TrainingTimeBox({ deal, quotes, viewer, editable }: {
  deal: any; quotes: any[]; viewer: Viewer; editable: boolean; key?: string;
}) {
  const time = trainingTimeOf(deal, quotes);
  const fromQuote = trainingTimeOf({ ...deal, trainingTime: '' }, quotes);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(deal.trainingTime || time?.text || ''));
  const [error, setError] = useState('');

  const write = async (trainingTime: string, action: string) => {
    setError('');
    try {
      await updateDoc(doc(db, 'pipelines', deal.id), {
        trainingTime,
        history: [...(deal.history || []), { at: new Date().toISOString(), byId: viewer.id, byName: viewer.name, action }].slice(-40),
      });
      setEditing(false);
    } catch (e) {
      setError(friendlyError(e));
    }
  };
  const save = () => {
    const v = value.trim();
    // Typing the quotation's time back in is the same as using it.
    if (!v || (fromQuote && v === fromQuote.text)) return write('', 'Training time: using the quotation\x27s time');
    return write(v, `Training time set to ${v}`);
  };

  if (editing) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <input value={value} onChange={e => setValue(e.target.value)} placeholder="e.g. 9:00 AM – 5:00 PM" autoFocus
          className="w-48 rounded-lg border border-line px-2 py-1 text-[15px] font-normal" aria-label="Training time" />
        <button type="button" className="text-sm font-semibold text-accent hover:underline" onClick={save}>Save</button>
        <button type="button" className="text-sm font-normal text-ink-soft hover:underline" onClick={() => setEditing(false)}>Cancel</button>
        {error && <span className="text-sm text-danger">{error}</span>}
      </span>
    );
  }
  return (
    <span>
      {time ? time.text : 'Not set'}
      {time?.from === 'quotation' && <span className="font-normal text-ink-soft"> (from quotation)</span>}
      {editable && (
        <>
          <button type="button" className="ml-1 text-sm font-semibold text-accent hover:underline" onClick={() => { setValue(String(deal.trainingTime || time?.text || '')); setEditing(true); }}>{time ? 'Change' : 'Set'}</button>
          {time?.from === 'deal' && fromQuote && (
            <button type="button" className="ml-2 text-sm font-semibold text-accent hover:underline" onClick={() => write('', 'Training time: using the quotation\x27s time')}>Use the quotation's time ({fromQuote.text})</button>
          )}
        </>
      )}
      {error && <span className="ml-2 text-sm text-danger">{error}</span>}
    </span>
  );
}
