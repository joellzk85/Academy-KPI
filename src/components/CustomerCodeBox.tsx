import React, { useEffect, useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db, friendlyError } from '../lib/firebase';
import { CODE_PROBLEM, cleanCode, clientCode, codeOk, codeTakenBy, refWithCode, suggestCode } from '../lib/docRefs';

// Shown in the quotation, course outline and teambuilding editors when the client has no customer code yet
// (2026-10-19). Saving puts the code on the client (its one home); the editor then adds it to the number by itself.
export default function CustomerCodeBox({ client, clients, refNumber, onSaved }: {
  client: any | null; clients: any[]; refNumber: string; onSaved?: (msg: string) => void;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (client) setCode(suggestCode(client.companyName, clients, client.id)); }, [client?.id]);
  if (!client || clientCode(client)) return null;

  const save = async () => {
    setError('');
    const c = cleanCode(code);
    if (!codeOk(c)) return setError(CODE_PROBLEM);
    const taken = codeTakenBy(c, clients, client.id);
    if (taken) return setError(`${c} is already used by ${taken.companyName}. Choose another.`);
    setBusy(true);
    try {
      await updateDoc(doc(db, 'clients', client.id), { code: c });
      onSaved?.(`Customer code ${c} saved for ${client.companyName}`);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const example = refWithCode(refNumber, cleanCode(code) || 'HKL');
  return (
    <div className="rounded-2xl border border-attention/30 bg-attention-soft p-4">
      <p className="text-[15px] font-semibold text-ink">{client.companyName} has no customer code yet</p>
      <p className="mt-0.5 text-sm text-ink-soft">The code starts the reference number{example !== refNumber ? `, e.g. ${example}` : ''}. It's saved in the client list.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="cust-code">Customer code</label>
        <input id="cust-code" value={code} onChange={e => setCode(cleanCode(e.target.value).slice(0, 6))} placeholder="e.g. HKL"
          className="w-32 rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15" />
        <button type="button" onClick={save} disabled={busy || !code}
          className="inline-flex items-center justify-center rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-[#0B5A50] disabled:opacity-60">
          {busy ? 'Saving…' : 'Save code'}
        </button>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
