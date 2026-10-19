import React, { useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';

// On a client link that expired or ran out of opens (2026-10-19): "Request access again". The request goes to the
// deal's history and the rep's My follow-ups; the team decides whether to reopen it (it never reopens by itself).

// This visitor's id for the link: the same one for 30 minutes, so a refresh isn't counted as another open.
export function linkVisitId(token: string): string {
  const fresh = () => Array.from(crypto.getRandomValues(new Uint8Array(12))).map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
  try {
    const key = `nx_lv_${token}`;
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    const id = saved && typeof saved.id === 'string' && Date.now() - Number(saved.at) < 30 * 60_000 ? saved.id : fresh();
    localStorage.setItem(key, JSON.stringify({ id, at: Date.now() }));
    return id;
  } catch {
    return fresh();
  }
}

export default function RequestAccess({ token, requested, contactName, color = '#0E6E62' }: {
  token: string; requested?: boolean; contactName?: string; color?: string;
}) {
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const who = contactName || 'NEXT Academy';

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (name.trim().length < 2) { setError('Please type your name.'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/doc-link/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, name, note }) });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Something went wrong. Please try again in a moment.');
      setDone(true);
    } catch (err: any) {
      setError(err?.message || 'Something went wrong. Please try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <p role="status" className="mt-5 flex items-start gap-2 rounded-xl px-4 py-3 text-left text-[15px]" style={{ background: '#e7f4ef', color }}>
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />Thank you. We've let {who} know, and they'll get back to you.
      </p>
    );
  }
  return (
    <form onSubmit={send} className="mt-6 space-y-3 text-left">
      <p className="text-[15px] font-semibold text-[#1e2d29]">Request access again</p>
      {requested && <p className="text-sm text-[#5b6b66]">A request was already sent. You can send another one if you need to.</p>}
      <div>
        <label htmlFor="ra-name" className="mb-1 block text-sm font-semibold text-[#1e2d29]">Your name</label>
        <input id="ra-name" value={name} onChange={e => setName(e.target.value)} autoComplete="name"
          className="w-full rounded-lg border border-[#d5dedb] bg-white px-3 py-2 text-[15px] focus:outline-none focus:ring-2" style={{ outlineColor: color }} />
      </div>
      <div>
        <label htmlFor="ra-note" className="mb-1 block text-sm font-semibold text-[#1e2d29]">Note <span className="font-normal text-[#5b6b66]">(optional)</span></label>
        <textarea id="ra-note" value={note} onChange={e => setNote(e.target.value)} maxLength={500}
          className="min-h-[80px] w-full rounded-lg border border-[#d5dedb] bg-white px-3 py-2 text-[15px] focus:outline-none focus:ring-2" />
      </div>
      {error && <p role="alert" className="text-sm text-[#b42318]">{error}</p>}
      <button type="submit" disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-[15px] font-semibold text-white disabled:opacity-60" style={{ background: color }}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}Send request
      </button>
    </form>
  );
}
