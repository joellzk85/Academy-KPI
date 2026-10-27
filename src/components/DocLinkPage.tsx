import React, { useEffect, useState } from 'react';
import FitWidth from './FitWidth';
import { clientTitle } from '../lib/programmes';
import { Loader2 } from 'lucide-react';
import { CourseOutline, Quotation } from '../types';
import { DocKind } from '../lib/docLinks';
import { COMPANY } from '../lib/company';
import QuotationDocument from './QuotationDocument';
import CourseOutlineDocument from './CourseOutlineDocument';
import TrainingReportDocument from './TrainingReportDocument';
import logoUrl from '../assets/outline/next-logo.png';
import RequestAccess, { linkVisitId } from './RequestAccess';
import LinkGuard, { todayText } from './LinkGuard';
import { teamBrowser, useLinkTracking } from '../lib/linkTracker';

// What a client sees when they open a quotation or course outline link (/q/<token> or /o/<token>, 2026-10-19),
// or the training report Management sent to HR (/r/<token>, 2026-10-21: only the sections Management chose).
// No login: the page asks serverDocLinks.ts for the sent copy and shows it as a web page.
// Since 2026-10-20 (Joel: "client cannot download or screenshot"; "do not tell customer we are tracking"): no Download
// PDF or Print, the same protection as teambuilding links (LinkGuard: blank print, no copying or right-click, watermark,
// blur when the window loses focus) and the same tracking (lib/linkTracker.ts; never shown to the client). The team's
// own opens (the CRM's Open button, or a browser logged in to the CRM) aren't counted or tracked.

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

export default function DocLinkPage({ token }: { token: string }) {
  const [data, setData] = useState<{ kind: DocKind; doc: any } | null>(null);
  const [error, setError] = useState('');
  const [gone, setGone] = useState<Gone | null>(null);   // expired, out of opens, or stopped (2026-10-19)
  const [team, setTeam] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const t = await teamBrowser();
      if (!live) return;
      setTeam(t);
      post('/api/doc-link/get', { token, team: t, visit: t ? '' : linkVisitId(token) })
        .then(d => { if (live) (d.gone ? setGone(d.gone) : setData({ kind: d.kind, doc: d.doc })); })
        .catch(e => { if (live) setError(e.message); });
    })();
    return () => { live = false; };
  }, [token]);

  const isQuote = data?.kind === 'quotation';
  const isReport = data?.kind === 'report';
  const title = !data ? 'NEXT Academy'
    : isQuote ? `Quotation ${data.doc.refNumber || ''}`.trim()
    : isReport ? `Training report${data.doc.hrHeader?.programme ? ` · ${clientTitle(data.doc.hrHeader.programme)}` : ''}`
    : clientTitle(data.doc.courseTitle) || 'Course outline';
  useEffect(() => { document.title = data ? `${title} · NEXT Academy` : 'NEXT Academy'; }, [data]);
  const company = data?.doc ? String((isQuote ? data.doc.company : isReport ? data.doc.hrHeader?.client : data.doc.preparedForCompany) || '') : '';
  useLinkTracking(token, !!data && !isReport && team === false);

  return (
    <LinkGuard on={!!data} watermark={data ? `${company ? `${company} · ` : ''}${todayText()}` : undefined}>
    <div className="min-h-screen bg-[#f3f5f4] font-sans text-ink">
      <header className="no-print sticky top-0 z-10 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3">
          <img src={logoUrl} alt="NEXT Academy" className="h-8 w-auto" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold">{title}</p>
            {company && <p className="truncate text-sm text-ink-soft">For {company}</p>}
          </div>
        </div>
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
        ) : isReport ? (
          <FitWidth width={820}><TrainingReportDocument r={data.doc} h={data.doc.hrHeader || { programme: '', client: '', dates: '', venue: '', trainer: '', grantNumber: '' }} /></FitWidth>
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
    </LinkGuard>
  );
}
