// The head of department's 30-day check-in (/c/<token>, 2026-10-27; serverReportCheckin.ts). No login: a few
// questions on whether their people are using what they learned. Also shown as a preview in the training report
// settings (CheckinForm with `preview`, nothing is sent).

import React, { useEffect, useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { COMPANY } from '../lib/company';
import { CustomQuestion } from '../lib/reportSettings';
import { QuestionInput } from './TrainingReportForm';
import logoUrl from '../assets/outline/next-logo.png';

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';

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

type Header = { programme: string; client: string; dates: string };

export function CheckinForm({ header, questions, preview, onSend }: {
  header: Header; questions: CustomQuestion[]; preview?: boolean; onSend?: (body: { name: string; role: string; answers: Record<string, string> }) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const send = async () => {
    if (preview || !onSend) return;
    const missing = questions.filter(q => q.required && !answers[q.id]?.trim());
    if (name.trim().length < 2) { setError('Please type your name.'); return; }
    if (missing.length) { setError(`Please answer: ${missing.map(q => q.label).join('; ')}`); return; }
    setBusy(true); setError('');
    try { await onSend({ name: name.trim(), role: role.trim(), answers }); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-5 rounded-2xl border border-line bg-white p-5 sm:p-6">
      <div>
        <h1 className="text-xl font-bold">How is your team using the training?</h1>
        <p className="mt-1 text-[15px] text-ink-soft">
          {[header.programme, header.dates].filter(Boolean).join(' · ')}{header.client ? ` · ${header.client}` : ''}
        </p>
        <p className="mt-2 text-[15px]">It takes about 2 minutes. Your answers help us support your team and improve our trainings.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-semibold text-ink" htmlFor="ci-name">Your name</label>
          <input id="ci-name" className={input} value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-semibold text-ink" htmlFor="ci-role">Your position <span className="font-normal text-ink-soft">(optional)</span></label>
          <input id="ci-role" className={input} value={role} onChange={e => setRole(e.target.value)} placeholder="e.g. Head of Operations" />
        </div>
      </div>
      {questions.map(q => <QuestionInput key={q.id} q={q} value={answers[q.id] || ''} onChange={v => setAnswers(a => ({ ...a, [q.id]: v }))} />)}
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <button type="button" className={btnPrimary} disabled={busy || preview} onClick={send}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} {preview ? 'Send (preview only)' : 'Send'}</button>
    </div>
  );
}

export default function CheckinPage({ token }: { token: string }) {
  const [data, setData] = useState<{ header: Header; questions: CustomQuestion[] } | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  useEffect(() => {
    document.title = 'Training check-in · NEXT Academy';
    post('/api/report-checkin/get', { token }).then(d => setData({ header: d.header || { programme: '', client: '', dates: '' }, questions: d.questions || [] })).catch(e => setError(e.message));
  }, [token]);
  const send = async (body: { name: string; role: string; answers: Record<string, string> }) => {
    await post('/api/report-checkin/answer', { token, ...body });
    setDone(true);
  };

  return (
    <div className="min-h-screen bg-[#f3f5f4] font-sans text-ink">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <img src={logoUrl} alt="NEXT Academy" className="h-8 w-auto" />
          <p className="text-[15px] font-semibold">Training check-in</p>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-6">
        {done ? (
          <div className="rounded-2xl border border-line bg-white p-6 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-accent" />
            <h1 className="mt-2 text-xl font-bold">Thank you</h1>
            <p className="mt-1 text-[15px] text-ink-soft">We have your answers. We'll be in touch if you asked for more support.</p>
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-line bg-white p-6 text-center">
            <p className="text-[15px]">{error}</p>
            <p className="mt-3 text-sm text-ink-soft">{COMPANY.email} · {COMPANY.phone}</p>
          </div>
        ) : !data ? (
          <p className="flex items-center justify-center gap-2 py-20 text-ink-soft"><Loader2 className="h-5 w-5 animate-spin" /> Opening…</p>
        ) : (
          <CheckinForm header={data.header} questions={data.questions} onSend={send} />
        )}
      </main>
      <footer className="pb-8 text-center text-sm text-ink-soft">NEXT Academy · {COMPANY.email} · {COMPANY.phone}</footer>
    </div>
  );
}
