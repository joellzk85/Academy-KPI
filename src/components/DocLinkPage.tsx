import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Download, Loader2, Printer } from 'lucide-react';
import { CourseOutline, Quotation } from '../types';
import { DocKind } from '../lib/docLinks';
import { COMPANY } from '../lib/company';
import { pdfErrorText } from '../lib/oldTab';
import QuotationDocument from './QuotationDocument';
import CourseOutlineDocument from './CourseOutlineDocument';
import logoUrl from '../assets/outline/next-logo.png';
import RequestAccess, { linkVisitId } from './RequestAccess';

// What a client sees when they open a quotation or course outline link (/q/<token> or /o/<token>, 2026-10-19).
// No login: the page asks serverDocLinks.ts for the sent copy and shows it as a web page, with Download PDF and Print.

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

type Gone = { code: string; message: string; canRequest?: boolean; requested?: boolean; contact?: { name: string; phone: string; email: string } };

const btn = 'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-60';

export default function DocLinkPage({ token }: { token: string }) {
  const [data, setData] = useState<{ kind: DocKind; doc: any } | null>(null);
  const [error, setError] = useState('');
  const [gone, setGone] = useState<Gone | null>(null);   // expired, out of opens, or stopped (2026-10-19)
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState('');

  useEffect(() => {
    // The CRM's own "Open" button adds ?team=1 so the team's look isn't counted as the client opening it.
    const team = new URLSearchParams(window.location.search).get('team') === '1';
    post('/api/doc-link/get', { token, team, visit: team ? '' : linkVisitId(token) })
      .then(d => (d.gone ? setGone(d.gone) : setData({ kind: d.kind, doc: d.doc })))
      .catch(e => setError(e.message));
  }, [token]);

  const isQuote = data?.kind === 'quotation';
  const title = !data ? 'NEXT Academy'
    : isQuote ? `Quotation ${data.doc.refNumber || ''}`.trim()
    : String(data.doc.courseTitle || 'Course outline');
  useEffect(() => { document.title = data ? `${title} · NEXT Academy` : 'NEXT Academy'; }, [data]);

  const downloadPdf = async () => {
    if (!data) return;
    setPdfBusy(true);
    setPdfError('');
    try {
      const m = await import('../lib/quotePdf');
      if (isQuote) m.downloadBlob(await m.makeQuotationPdf(data.doc as Quotation), m.pdfFileName(data.doc as Quotation));
      else m.downloadBlob(await m.makeOutlinePdf(data.doc as CourseOutline), m.outlinePdfFileName(data.doc as CourseOutline));
    } catch (e) {
      setPdfError(pdfErrorText(e).replace(' Save your work, then reload', ' Reload'));
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f3f5f4] font-sans text-ink">
      <header className="no-print sticky top-0 z-10 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3">
          <img src={logoUrl} alt="NEXT Academy" className="h-8 w-auto" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold">{title}</p>
            {data?.doc && (isQuote ? data.doc.company : data.doc.preparedForCompany) && (
              <p className="truncate text-sm text-ink-soft">For {isQuote ? data.doc.company : data.doc.preparedForCompany}</p>
            )}
          </div>
          {data && (
            <span className="flex w-full gap-2 sm:w-auto [&>button]:flex-1 sm:[&>button]:flex-none">
              <button type="button" className={`${btn} border border-line bg-white text-ink hover:bg-surface`} onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</button>
              <button type="button" className={`${btn} bg-accent text-white hover:bg-[#0B5A50]`} disabled={pdfBusy} onClick={downloadPdf}>
                {pdfBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download PDF
              </button>
            </span>
          )}
        </div>
        {pdfError && <p role="alert" className="mx-auto max-w-5xl px-4 pb-3 text-sm text-danger">{pdfError}</p>}
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        {gone ? (
          <div className="mx-auto max-w-md rounded-2xl border border-line bg-white p-6 text-center">
            <img src={logoUrl} alt="NEXT Academy" className="mx-auto mb-4 h-12 w-auto" />
            <h1 className="text-xl font-bold">{gone.code === 'link-stopped' ? 'This link is no longer active' : 'This link has expired'}</h1>
            <p className="mt-2 text-[15px] text-ink-soft">
              {gone.code === 'link-stopped'
                ? `Please contact ${gone.contact?.name || 'NEXT Academy'} for the latest version.`
                : 'For your security, links to our documents work for a limited time and number of opens.'}
            </p>
            {gone.contact && <p className="mt-3 text-sm text-ink-soft">{gone.contact.name ? `${gone.contact.name}, NEXT Academy · ` : ''}{gone.contact.phone} · {gone.contact.email}</p>}
            {gone.canRequest && <RequestAccess token={token} requested={gone.requested} contactName={gone.contact?.name} />}
          </div>
        ) : error ? (
          <div className="mx-auto max-w-lg rounded-2xl border border-line bg-white p-6 text-center">
            <img src={logoUrl} alt="NEXT Academy" className="mx-auto mb-4 h-12 w-auto" />
            <p className="text-[15px]">{error}</p>
            <p className="mt-3 text-sm text-ink-soft">{COMPANY.email} · {COMPANY.phone}</p>
          </div>
        ) : !data ? (
          <p className="flex items-center justify-center gap-2 py-20 text-ink-soft"><Loader2 className="h-5 w-5 animate-spin" /> Opening…</p>
        ) : isQuote ? (
          <FitWidth width={900}><QuotationDocument q={data.doc as Quotation} /></FitWidth>
        ) : (
          <CourseOutlineDocument o={data.doc as CourseOutline} />
        )}
      </main>

      <footer className="no-print pb-8 text-center text-sm text-ink-soft">
        NEXT Academy · {COMPANY.addressLines.join(', ')} · {COMPANY.email} · {COMPANY.phone}
      </footer>
    </div>
  );
}

// Shrinks a fixed-width document to fit a phone screen (print uses the real size).
function FitWidth({ width, children }: { width: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => setZoom(Math.min(1, el.clientWidth / width));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  return (
    <div ref={ref} className="w-full">
      <div className="fit-width print:!w-auto" style={zoom < 1 ? { width, zoom } : undefined}>{children}</div>
      <style>{'@media print { .fit-width { zoom: 1 !important; width: auto !important; } }'}</style>
    </div>
  );
}
