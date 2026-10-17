import React, { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, query, setDoc, updateDoc } from 'firebase/firestore';
import { Check, Copy, MessageCircle, X } from 'lucide-react';
import { db } from '../lib/firebase';
import { formatDate } from '../lib/deals';
import { LINK_DAYS, TrainerLink, isExpired, linkPath, newToken, whatsappShare } from '../lib/trainerLinks';

// CRM side of trainer links (Joel, 2026-10-17): make a link, share it, cancel it, and mark it
// accepted or discarded after review. The trainer's public page is TrainerLinkPage.tsx.

type Viewer = { id: string; name: string };

export function useTrainerLinks(): TrainerLink[] {
  const [links, setLinks] = useState<TrainerLink[]>([]);
  useEffect(() => onSnapshot(query(collection(db, 'trainer_links')),
    s => setLinks(s.docs.map(d => ({ ...(d.data() as TrainerLink), id: d.id }))), () => setLinks([])), []);
  return links;
}

export async function createTrainerLink(fields: Partial<TrainerLink>, viewer: Viewer): Promise<TrainerLink> {
  const token = newToken();
  const now = Date.now();
  const link = {
    ...fields, token, status: 'open', createdAt: now, expiresAt: now + LINK_DAYS * 86400000,
    requestedById: viewer.id, requestedByName: viewer.name,
  } as TrainerLink;
  await setDoc(doc(db, 'trainer_links', token), JSON.parse(JSON.stringify(link)));
  return { ...link, id: token };
}

export const closeTrainerLink = (link: TrainerLink, status: 'accepted' | 'cancelled', viewer: Viewer) =>
  updateDoc(doc(db, 'trainer_links', link.id), { status, decidedById: viewer.id, decidedByName: viewer.name, decidedAt: Date.now() });

export const linkUrl = (link: TrainerLink) => `${window.location.origin}${linkPath(link.token)}`;

// The link with Copy, WhatsApp and Cancel.
export function LinkShareBox({ link, message, phone, onCancel }: {
  link: TrainerLink; message: string; phone?: string; onCancel?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const url = linkUrl(link);
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { /* the link is shown, select it by hand */ }
  };
  const expired = isExpired(link);
  return (
    <div className="space-y-2 rounded-xl border border-line bg-surface p-3 text-sm">
      <input readOnly value={url} onFocus={e => e.target.select()} aria-label="Trainer link" className="w-full rounded-md border border-line bg-white px-2 py-1.5 text-sm" />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={copy} className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2.5 py-1.5 font-semibold hover:bg-surface">
          {copied ? <Check className="h-4 w-4 text-accent" /> : <Copy className="h-4 w-4" />} {copied ? 'Copied' : 'Copy link'}
        </button>
        <a href={whatsappShare(url, message, phone)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2.5 py-1.5 font-semibold hover:bg-surface">
          <MessageCircle className="h-4 w-4" /> WhatsApp
        </a>
        <span className={expired ? 'text-danger' : 'text-ink-soft'}>{expired ? 'Expired' : 'Works until'} {formatDate(new Date(link.expiresAt).toISOString().slice(0, 10))}</span>
        {onCancel && (
          <button type="button" onClick={onCancel} className="ml-auto inline-flex items-center gap-1 font-semibold text-danger hover:underline"><X className="h-4 w-4" /> Cancel link</button>
        )}
      </div>
    </div>
  );
}
