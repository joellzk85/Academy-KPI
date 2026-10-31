import React, { useEffect, useState } from 'react';
import { Download, FileArchive, Loader2, Search } from 'lucide-react';
import logoUrl from '../assets/outline/next-logo.png';
import { COMPANY } from '../lib/company';
import { CertPrint, KIND_HEADING } from '../lib/certificates';
import { certFileName, makeCertificatesPdf, makeCertificatesZip, personFileName, previewImage, saveBlob } from '../lib/certificatePdf';
import { teamBrowser } from '../lib/linkTracker';

// HR's certificate page (/cert/<token>, 2026-10-31; Joel: "a HTML link that can be sent to HR to download PDF").
// No login: serverCertificates.ts sends only what is printed, and this page draws the PDFs (lib/certificatePdf.ts),
// all in one, one each in a ZIP, or one person's. Unlike quotation links, downloading is the point here.

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

const btnPrimary = 'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';

export default function CertificateLinkPage({ token }: { token: string }) {
  const [print, setPrint] = useState<CertPrint | null>(null);
  const [gone, setGone] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState('');
  const [pct, setPct] = useState<number | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let live = true;
    (async () => {
      const team = await teamBrowser();
      post('/api/cert-link/get', { token, team })
        .then(d => { if (!live) return; if (d.gone) setGone(d.gone.message); else setPrint(d.print); })
        .catch(e => live && setError(e.message));
    })();
    return () => { live = false; };
  }, [token]);

  useEffect(() => {
    document.title = print ? `Certificates · ${print.title} · NEXT Academy` : 'Certificates · NEXT Academy';
    if (print?.people[0]) previewImage(print, print.people[0]).then(setPreview).catch(() => {});
  }, [print]);

  const run = async (key: string, job: () => Promise<void>) => {
    setBusy(key); setError(''); setPct(0);
    try { await job(); } catch (e: any) { setError(String(e?.message || e)); } finally { setBusy(''); setPct(null); }
  };
  const all = () => run('pdf', async () => { saveBlob(await makeCertificatesPdf(print!, print!.people, setPct), certFileName(print!)); });
  const zip = () => run('zip', async () => { saveBlob(await makeCertificatesZip(print!, setPct), certFileName(print!).replace(/\.pdf$/, '.zip')); });
  const one = (p: CertPrint['people'][number]) => run(p.number, async () => { saveBlob(await makeCertificatesPdf(print!, [p]), personFileName(p)); });

  const q = search.trim().toLowerCase();
  const people = (print?.people || []).filter(p => !q || p.name.toLowerCase().includes(q) || p.number.toLowerCase().includes(q));

  return (
    <div className="min-h-screen bg-[#f3f5f4] font-sans text-ink">
      <header className="sticky top-0 z-10 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-3">
          <img src={logoUrl} alt="NEXT Academy" className="h-8 w-auto" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold">Certificates{print ? ` · ${print.title}` : ''}</p>
            {print?.company && <p className="truncate text-sm text-ink-soft">For {print.company}</p>}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-4 px-4 py-6">
        {gone || (error && !print) ? (
          <div className="mx-auto max-w-md rounded-2xl border border-line bg-white p-6 text-center">
            <img src={logoUrl} alt="NEXT Academy" className="mx-auto mb-4 h-12 w-auto" />
            <h1 className="text-xl font-bold">{gone || error}</h1>
            <p className="mt-2 text-[15px] text-ink-soft">Please contact NEXT Academy for a new link.</p>
            <p className="mt-3 text-sm text-ink-soft">{COMPANY.phone} · {COMPANY.email}</p>
          </div>
        ) : !print ? (
          <p className="flex items-center justify-center gap-2 py-20 text-ink-soft"><Loader2 className="h-5 w-5 animate-spin" /> Opening…</p>
        ) : (
          <>
            <section className="rounded-2xl border border-line bg-white p-5">
              <h1 className="text-xl font-bold">Certificate {KIND_HEADING[print.kind].toLowerCase()}</h1>
              <p className="mt-1 text-[15px] text-ink-soft">{[print.title, print.dateText, print.venue].filter(Boolean).join(' · ')}</p>
              <p className="mt-1 text-[15px] text-ink-soft">{print.people.length} certificate{print.people.length === 1 ? '' : 's'}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" className={btnPrimary} disabled={!!busy || !print.people.length} onClick={all}>
                  {busy === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {busy === 'pdf' && pct !== null ? `Making the PDF ${pct}%` : 'Download all (one PDF)'}
                </button>
                <button type="button" className={btnSecondary} disabled={!!busy || !print.people.length} onClick={zip}>
                  {busy === 'zip' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileArchive className="h-4 w-4" />}
                  {busy === 'zip' && pct !== null ? `Making the files ${pct}%` : 'One PDF per person (ZIP)'}
                </button>
              </div>
              {error && <p className="mt-2 text-sm text-danger">{error}</p>}
            </section>

            {preview && <img src={preview} alt="Certificate preview" className="w-full rounded-2xl border border-line shadow-sm" />}

            <section className="rounded-2xl border border-line bg-white p-5">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h2 className="flex-1 text-base font-bold">Participants</h2>
                <label className="relative w-full sm:w-64">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
                  <input className="w-full rounded-lg border border-line bg-white py-2 pl-9 pr-3 text-[15px] focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15"
                    value={search} onChange={e => setSearch(e.target.value)} placeholder="Find a name" />
                </label>
              </div>
              <ul className="divide-y divide-line">
                {people.map(p => (
                  <li key={p.number} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{p.name}</p>
                      <p className="text-sm text-ink-soft">{p.number}</p>
                    </div>
                    <button type="button" className={`${btnSecondary} py-1.5`} disabled={!!busy} onClick={() => one(p)}>
                      {busy === p.number ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} PDF
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </main>

      <footer className="pb-8 text-center text-sm text-ink-soft">
        NEXT Academy · {COMPANY.addressLines.join(', ')} · {COMPANY.email} · {COMPANY.phone}
      </footer>
    </div>
  );
}
