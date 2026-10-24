import React, { useEffect, useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import Logo from './Logo';
import { ReferrerSubmission, cleanReferrerSubmission, referrerSubmissionProblem } from '../lib/referrers';

// The page a referrer opens from their link (/ref/<token>), without logging in (Joel, 2026-10-24): their bank details
// for the referral fee. It talks only to the CRM server (serverReferrers.ts), never to the database.

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const label = 'mb-1 block text-sm font-semibold text-ink';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-[15px] font-semibold text-white hover:bg-[#0B5A50] disabled:opacity-60';

async function post(path: string, body: any) {
  let res: Response;
  try {
    res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new Error('No internet connection. Check it and try again.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) throw new Error(data?.error || 'Something went wrong. Please try again in a minute.');
  return data;
}

const FIELDS: [keyof ReferrerSubmission, string, string][] = [
  ['name', 'Full name', 'As on your IC'], ['phone', 'Phone number', 'e.g. 012-345 6789'], ['email', 'Email (optional)', ''],
  ['bankName', 'Bank', 'e.g. Maybank'], ['accountName', 'Name on the bank account', ''], ['accountNo', 'Account number', ''],
];

export default function ReferrerLinkPage({ token }: { token: string }) {
  const [info, setInfo] = useState<any>(null);
  const [f, setF] = useState<ReferrerSubmission>({ name: '', phone: '', email: '', bankName: '', accountName: '', accountNo: '' });
  const [error, setError] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    document.title = 'Referral fee · NEXT Academy';
    post('/api/referral/link-get', { token })
      .then(d => { setInfo(d); setF(x => ({ ...x, ...d.prefill })); })
      .catch(e => setError(e.message));
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const s = cleanReferrerSubmission(f);
    const p = referrerSubmissionProblem(s);
    if (p) return setProblem(p);
    setBusy(true); setProblem('');
    try { await post('/api/referral/link-submit', { token, data: s }); setDone(true); }
    catch (err: any) { setProblem(err.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-surface font-sans text-ink">
      <header className="border-b border-line bg-white"><div className="mx-auto max-w-xl px-4 py-3"><Logo /></div></header>
      <main className="mx-auto max-w-xl px-4 py-6">
        {error ? (
          <p className="rounded-xl bg-white p-6 text-[15px]">{error}</p>
        ) : !info ? (
          <p className="flex items-center gap-2 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
        ) : done ? (
          <div className="rounded-2xl bg-white p-6 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-accent" />
            <p className="mt-2 text-lg font-bold">Thank you</p>
            <p className="mt-1 text-[15px] text-ink-soft">NEXT Academy has your details. You can open this link again to correct them until they're accepted.</p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4 rounded-2xl bg-white p-6">
            <div>
              <h1 className="text-xl font-bold">Your referral fee</h1>
              <p className="mt-1 text-[15px] text-ink-soft">
                Thank you for referring a client to NEXT Academy. {info.askedBy} asked you to fill in your bank details so we can pay your referral fee.
                {info.sent ? ' We already have your details; send them again only to correct them (type the account number again).' : ''}
              </p>
            </div>
            {FIELDS.map(([k, l, ph]) => (
              <div key={k}>
                <label className={label} htmlFor={`rf-${k}`}>{l}</label>
                <input id={`rf-${k}`} value={f[k]} placeholder={ph} onChange={e => setF(x => ({ ...x, [k]: e.target.value }))} className={input}
                  inputMode={k === 'phone' ? 'tel' : k === 'accountNo' ? 'numeric' : k === 'email' ? 'email' : undefined} autoComplete="off" />
              </div>
            ))}
            <p className="text-sm text-ink-soft">Your details are used only to pay your referral fee and are seen only by NEXT Academy's admin and management.</p>
            {problem && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{problem}</p>}
            <button type="submit" disabled={busy} className={btnPrimary}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Send my details</button>
          </form>
        )}
      </main>
    </div>
  );
}
