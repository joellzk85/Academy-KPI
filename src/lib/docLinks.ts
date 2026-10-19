// Private client links for quotations and course outlines (Joel, 2026-10-19: "make each quotation appear as unique
// HTML"). Sending makes a link like https://…/q/<32 hex> (course outlines: /o/<token>) that the client opens in a
// browser without logging in. It always shows the locked (sent) copy, never a draft; while the document is being
// revised the page says so. The server (serverDocLinks.ts) is the only way in and records when the client opens it.
// Shared by the browser and the server, so no database code here.

export type DocKind = 'quotation' | 'outline';

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
}

export const isLinkToken = (t: unknown) => typeof t === 'string' && /^[a-f0-9]{32}$/.test(t);

export const docLinkPath = (kind: DocKind, token: string) => `/${kind === 'quotation' ? 'q' : 'o'}/${token}`;

// /q/<token> or /o/<token> → the token, else ''.
export function tokenFromPath(path: string): string {
  return path.match(/^\/[qo]\/([a-f0-9]{32})\/?$/)?.[1] || '';
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
