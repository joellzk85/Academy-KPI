import { useEffect, useRef, useState } from 'react';

// Unfinished forms are kept in this browser (Joel, 2026-10-20: "save as draft for everything, if accidentally left
// page, or for edit later"). Used by the smaller forms (new or edited deal, client, trainer, venue, programme, To-do,
// money, follow-up note, touch point, HRDC query, appointment log, activity). They aren't saved to the database half
// done, because a half-filled deal would count in the Deals list and KPIs and a half-filled payment would wait for
// approval. Opening the same form again offers "Continue" or "Discard". The copy lives only in this browser, for this
// person, and is dropped after 30 days, once the form is saved (`clear`) or when Discard is clicked.
// `key` is null while the form is closed; it names the form and the record, e.g. `deal:new` or `client:<id>`.
const PREFIX = 'next_draft:';
const MAX_AGE_DAYS = 30;

export type DraftOffer<T> = { value: T; at: string };

function read<T>(k: string): DraftOffer<T> | null {
  try {
    const raw = localStorage.getItem(PREFIX + k);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || !d.at || Date.now() - new Date(d.at).getTime() > MAX_AGE_DAYS * 864e5) { localStorage.removeItem(PREFIX + k); return null; }
    return d;
  } catch { return null; }
}
function write(k: string, value: unknown) {
  try { localStorage.setItem(PREFIX + k, JSON.stringify({ value, at: new Date().toISOString() })); } catch { /* full or blocked: nothing kept */ }
}
function remove(k: string) {
  try { localStorage.removeItem(PREFIX + k); } catch { /* blocked */ }
}

// For a form whose saving happens outside it (the form is gone once it's saved).
export function forgetDraft(personId: string, key: string) { remove(`${personId}:${key}`); }

// Old copies from people who used this browser before (and ones past 30 days) are tidied once per page load.
let tidied = false;
function tidy() {
  if (tidied) return;
  tidied = true;
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) read(k.slice(PREFIX.length));
    }
  } catch { /* blocked */ }
}

export function useFormDraft<T>(personId: string, key: string | null, value: T, restore: (v: T) => void) {
  const k = key ? `${personId}:${key}` : null;
  const json = JSON.stringify(value);
  // What the form looked like when it opened: only changes from that are kept.
  const base = useRef<{ k: string | null; json: string }>({ k: null, json: '' });
  if (base.current.k !== k) base.current = { k, json };
  const [offer, setOffer] = useState<DraftOffer<T> | null>(null);

  useEffect(() => {
    tidy();
    setOffer(null);
    if (!k) return;
    const d = read<T>(k);
    if (d && JSON.stringify(d.value) !== base.current.json) setOffer(d);
  }, [k]);

  useEffect(() => {
    if (!k || offer) return;            // while Continue/Discard is showing, the earlier copy is kept as it is
    if (json === base.current.json) remove(k);
    else write(k, value);
  }, [k, json, offer]);

  return {
    offer,
    keep: () => { if (offer) restore(offer.value); setOffer(null); },
    discard: () => { if (k) remove(k); setOffer(null); },
    // After the form was saved: forget the copy.
    clear: () => { if (k) remove(k); base.current = { k, json }; setOffer(null); },
  };
}
