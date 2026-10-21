// Private client links for quotations and course outlines (Joel, 2026-10-19: "make each quotation appear as unique
// HTML"). Sending makes a link like https://…/q/<32 hex> (course outlines: /o/<token>) that the client opens in a
// browser without logging in. It always shows the locked (sent) copy, never a draft; while the document is being
// revised the page says so. The server (serverDocLinks.ts) is the only way in and records when the client opens it.
// Shared by the browser and the server, so no database code here.

// Teambuilding proposals (push B, 2026-10-19) use the same list, opened at /p/<token>, with an expiry date set by the
// person who makes the link, the live (latest saved) version, tracking and Accept (serverProposalLinks.ts).
// Training reports for the client's HR (2026-10-21) use it too, opened at /r/<token> (docId = the deal id).
export type DocKind = 'quotation' | 'outline' | 'teambuilding' | 'report';
export const DOC_NOUN: Record<DocKind, string> = { quotation: 'quotation', outline: 'course outline', teambuilding: 'teambuilding proposal', report: 'training report' };

export interface DocLink {
  token: string;            // the document id in doc_links (32 random hex characters)
  kind: DocKind;
  docId: string;
  dealId: string;
  refNumber: string;
  company: string;
  status: 'open' | 'stopped';
  createdAt: number;
  byId: string;
  byName: string;
  stoppedAt?: number;
  stoppedByName?: string;
  views?: number;           // times the client opened it (team opens from the CRM aren't counted)
  firstViewedAt?: number;
  lastViewedAt?: number;
  // Limits on every link (2026-10-19, lib/linkLimits.ts)
  maxOpens?: number;        // the client can open it this many times in total (views); then it's "expired"
  lastVisit?: string;       // the last counted visitor's id (a refresh within 30 minutes isn't counted again)
  reopenRequest?: { name: string; note?: string; at: number; reason: 'expired' | 'limit' } | null;   // the client asked for access again
  reopenedAt?: number;
  reopenedByName?: string;
  // Teambuilding proposals first; since 2026-10-19 every link
  expiresAt?: number;       // end of this day (Malaysia), set by the person who made the link
  extendedAt?: number;
  extendedByName?: string;
  totalSeconds?: number;    // time the client spent on the page, all visits
  accepted?: { name: string; position: string; note?: string; packageName?: string; pax?: number; price?: number | null; at: number };
  ownerId?: string;         // the deal owner when the link was made (alerts)
}

export const isLinkToken = (t: unknown) => typeof t === 'string' && /^[a-f0-9]{32}$/.test(t);

export const docLinkPath = (kind: DocKind, token: string) => `/${kind === 'quotation' ? 'q' : kind === 'teambuilding' ? 'p' : kind === 'report' ? 'r' : 'o'}/${token}`;

// /q/<token>, /o/<token> or /r/<token> → the token, else ''.
export function tokenFromPath(path: string): string {
  return path.match(/^\/[qor]\/([a-f0-9]{32})\/?$/)?.[1] || '';
}

// Only what the printed document shows goes to the client's browser: people's ids, sharing, send logs and other
// CRM details are left out.
const PRIVATE = /(^|[a-z])(Id|Ids)$|^id$|Log$|^shared|^tagged|^tagNote$|^isHidden$|^dealDeleted$|^history$|^notes?$|^creatorId$|^sentBy|^useProgrammeName$|^useDealDate$/;
export function publicDocFields(doc: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(doc || {})) {
    if (k === 'items' && Array.isArray(v)) {
      out.items = v.map((it: any) => {
        const x: Record<string, any> = {};
        for (const [ik, iv] of Object.entries(it || {})) if (ik === 'id' || !PRIVATE.test(ik)) x[ik] = iv;
        return x;
      });
    } else if (k === 'agenda' && Array.isArray(v)) out.agenda = v;
    else if (!PRIVATE.test(k)) out[k] = v;
  }
  return out;
}

// "Opened 3 times, last 21 Oct 10:15" (or "Not opened yet").
export function openedText(l: Pick<DocLink, 'views' | 'lastViewedAt'> | null | undefined): string {
  if (!l?.views) return 'Not opened yet';
  const when = l.lastViewedAt ? new Date(l.lastViewedAt).toLocaleString('en-MY', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';
  return `Opened ${l.views === 1 ? 'once' : `${l.views} times`}${when ? `, last ${when}` : ''}`;
}
