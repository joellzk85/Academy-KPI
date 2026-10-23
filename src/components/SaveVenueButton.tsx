import React, { useState } from 'react';
import { Loader2, MapPin } from 'lucide-react';
import { friendlyError } from '../lib/firebase';
import { saveTypedVenue } from '../lib/venues';

// "Save as a new venue": shown under a venue that was typed, not picked from the Venues list (2026-10-23).
export default function SaveVenueButton({ name, venues, by, onSaved }: {
  name: string; venues: { id: string; name?: string }[]; by: { id: string; name: string };
  onSaved: (id: string, name: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!name.trim()) return null;
  const save = async () => {
    setBusy(true); setError('');
    try { onSaved(await saveTypedVenue(name, venues, by), name.trim()); }
    catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  };
  return (
    <div className="mt-1">
      <button type="button" disabled={busy} onClick={save} className="inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline disabled:opacity-60">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MapPin className="h-3.5 w-3.5" />} Save "{name.trim()}" as a new venue
      </button>
      <span className="ml-1 text-sm text-ink-soft">(adds it to Venues, so it can be picked next time)</span>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}
