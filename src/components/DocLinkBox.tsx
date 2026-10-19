import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { Check, Copy, ExternalLink, Eye, Link2, Loader2 } from 'lucide-react';
import { callServer, db, friendlyError } from '../lib/firebase';
import { DocKind, DocLink, docLinkPath, openedText } from '../lib/docLinks';

// The client link of a quotation or course outline (2026-10-19): the link, Copy / Copy message / Open, how often the
// client opened it, and Stop link. Used in the Send window and on the sent quotation or outline.

const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';

export const docLinkUrl = (l: Pick<DocLink, 'kind' | 'token'>) => `${window.location.origin}${docLinkPath(l.kind, l.token)}`;

// All links of one document, newest first (live).
export function useDocLinks(docId: string | undefined): DocLink[] {
  const [links, setLinks] = useState<DocLink[]>([]);
  useEffect(() => {
    if (!docId) { setLinks([]); return; }
    return onSnapshot(query(collection(db, 'doc_links'), where('docId', '==', docId)),
      s => setLinks(s.docs.map(d => ({ ...(d.data() as any), token: d.id } as DocLink)).sort((a, b) => b.createdAt - a.createdAt)),
      () => setLinks([]));
  }, [docId]);
  return links;
}

export const openLinkOf = (links: DocLink[], kind: DocKind) => links.find(l => l.kind === kind && l.status === 'open') || null;

export async function stopDocLink(token: string) {
  await callServer('/api/doc-link/stop', { token }, true);
}

export default function DocLinkBox({ link, message, compact }: {
  link: DocLink;
  message?: string;            // a ready-to-paste message with the link at the end
  compact?: boolean;           // on the Sent banner
}) {
  const url = docLinkUrl(link);
  const [copied, setCopied] = useState<'' | 'link' | 'msg'>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const copy = async (what: 'link' | 'msg') => {
    const text = what === 'link' ? url : `${message}\n\n${url}`;
    try { await navigator.clipboard.writeText(text); } catch {
      // Older browsers: select the text so it can be copied by hand.
      window.prompt('Copy this:', text);
    }
    setCopied(what);
    window.setTimeout(() => setCopied(''), 2000);
  };
  const stop = async () => {
    if (!window.confirm(`Stop this link? The client will no longer be able to open it. Sending again makes a new link.`)) return;
    setBusy(true);
    setError('');
    try { await stopDocLink(link.token); } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      <div className="flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2">
        <Link2 className="h-4 w-4 shrink-0 text-accent" />
        <input readOnly value={url} onFocus={e => e.currentTarget.select()} aria-label="Client link"
          className="min-w-0 flex-1 bg-transparent text-sm text-ink focus:outline-none" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btnSecondary} onClick={() => copy('link')}>{copied === 'link' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied === 'link' ? 'Copied' : 'Copy link'}</button>
        {message && <button type="button" className={btnSecondary} onClick={() => copy('msg')}>{copied === 'msg' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied === 'msg' ? 'Copied' : 'Copy message with link'}</button>}
        <a className={btnSecondary} href={`${url}?team=1`} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" /> Open</a>
        <button type="button" className="text-sm font-semibold text-ink-soft hover:text-danger" disabled={busy} onClick={stop}>{busy ? 'Stopping…' : 'Stop link'}</button>
      </div>
      <p className={`flex items-center gap-1.5 text-sm ${link.views ? 'font-semibold text-accent' : 'text-ink-soft'}`}>
        <Eye className="h-4 w-4" />{link.views ? `Client ${openedText(link).charAt(0).toLowerCase()}${openedText(link).slice(1)}` : 'The client hasn\'t opened it yet'}
      </p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}

// "Make the client link" (Send window): makes it on the server, then the caller locks and logs the send.
export function MakeLinkButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <button type="button" disabled={busy} onClick={onClick}
      className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60">
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}Make the client link
    </button>
  );
}
