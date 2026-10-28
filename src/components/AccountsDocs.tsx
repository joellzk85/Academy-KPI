import React, { useState } from 'react';
import { Download, FileText, Loader2 } from 'lucide-react';
import { auth } from '../lib/firebase';
import { MAX_BULK_BYTES, PortalRow, docFolder } from '../lib/accountsPortal';
import { sizeText } from '../lib/checklistFiles';
import { downloadBlob } from '../lib/quotePdf';
import type { PoInput } from '../lib/trainerPortal';

// Documents on each payment in the Accounts portal (Joel, 2026-10-28: "documents attached by admin for each payment
// should also appear in the portal for accounts to download. can individual download and also bulk download"; "all that
// require payment and payment approval should receive the uploaded document and PO"). Files come through the server
// (/api/accounts/file): accounts logins can't read Storage. A trainer fee's PO made by the CRM is drawn here as a PDF.
// Bulk: one ZIP with a folder per payment ("PR-20261022-1 Ahmad Zaki").

/** One file of a payment, from the server. */
export async function fetchDoc(id: string, docId: string): Promise<Blob> {
  const user = auth.currentUser;
  if (!user) throw new Error('You are logged out. Log in again.');
  let res: Response;
  try {
    res = await fetch('/api/accounts/file', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` }, body: JSON.stringify({ id, docId }) });
  } catch {
    throw new Error('No connection to the CRM server. Check your internet and try again.');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error || 'The file could not be downloaded. Try again in a minute.');
  }
  return res.blob();
}

/** The PO made by the CRM, as a PDF (the same one the trainer sees in the trainer portal). */
export async function poPdf(po: PoInput): Promise<Blob> {
  const [{ default: TrainerPoDocument }, { makeDocumentPdf }] = await Promise.all([import('./TrainerPoDocument'), import('../lib/quotePdf')]);
  return makeDocumentPdf(React.createElement(TrainerPoDocument, { po }), `PO ${po.number}`);
}
const poName = (po: PoInput) => `${po.number || 'PO'}.pdf`.replace(/[\\/:*?"<>|]+/g, ' ');

export const docCount = (r: PortalRow) => r.docs.length + (r.po ? 1 : 0);
export const docBytes = (rows: PortalRow[]) => rows.reduce((t, r) => t + r.docs.reduce((s, d) => s + d.size, 0), 0);

/** Every document of these payments in one ZIP, a folder per payment. Refused over 100 MB. */
export async function docsZip(rows: PortalRow[], onProgress: (text: string) => void): Promise<Blob> {
  const withDocs = rows.filter(r => docCount(r));
  if (!withDocs.length) throw new Error('These payments have no documents yet.');
  if (docBytes(withDocs) > MAX_BULK_BYTES) throw new Error(`That's more than ${sizeText(MAX_BULK_BYTES)} of files. Pick a month or category, or tick fewer payments, and download in smaller batches.`);
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const total = withDocs.reduce((t, r) => t + docCount(r), 0);
  let done = 0;
  const used = new Set<string>();
  const unique = (folder: string, name: string) => {
    let n = name, i = 2;
    while (used.has(`${folder}/${n}`)) n = name.replace(/(\.[^.]*)?$/, m => ` (${i++})${m}`);
    used.add(`${folder}/${n}`);
    return n;
  };
  for (const r of withDocs) {
    const folder = docFolder(r);
    for (const d of r.docs) {
      onProgress(`${++done} of ${total}`);
      zip.file(`${folder}/${unique(folder, d.name)}`, await fetchDoc(r.id, d.id));
    }
    if (r.po) { onProgress(`${++done} of ${total}`); zip.file(`${folder}/${unique(folder, poName(r.po))}`, await poPdf(r.po)); }
  }
  onProgress('Making the ZIP…');
  return zip.generateAsync({ type: 'blob' });
}

/** The documents of one payment: each with ⬇, the PO, and Download all (a ZIP) when there are several. */
export function DocList({ r, onError }: { r: PortalRow; onError: (text: string) => void }) {
  const [busy, setBusy] = useState('');
  const run = async (key: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    try { await fn(); } catch (e: any) { onError(e?.message || 'The download failed. Try again.'); } finally { setBusy(''); }
  };
  if (!docCount(r)) return <p className="text-xs text-ink-soft">No documents attached</p>;
  const btn = 'inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-left text-xs font-semibold text-accent hover:bg-accent-soft disabled:opacity-60';
  return (
    <div className="space-y-0.5">
      <p className="text-xs font-semibold text-ink-soft">Documents ({docCount(r)})</p>
      <ul className="space-y-0.5">
        {r.po && (
          <li><button type="button" className={btn} disabled={!!busy} title="The PO made by the CRM" onClick={() => run('po', async () => downloadBlob(await poPdf(r.po!), poName(r.po!)))}>
            {busy === 'po' ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> : <Download className="h-3 w-3 shrink-0" />}
            <span className="break-all">PO {r.po.number}</span><span className="font-normal text-ink-soft">· Trainer PO</span>
          </button></li>
        )}
        {r.docs.map(d => (
          <li key={d.id}><button type="button" className={btn} disabled={!!busy} title={`${d.label} · ${sizeText(d.size)}`} onClick={() => run(d.id, async () => downloadBlob(await fetchDoc(r.id, d.id), d.name))}>
            {busy === d.id ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> : <Download className="h-3 w-3 shrink-0" />}
            <span className="break-all">{d.name}</span><span className="font-normal text-ink-soft">· {d.label}</span>
          </button></li>
        ))}
      </ul>
      {docCount(r) > 1 && (
        <button type="button" className={btn} disabled={!!busy} onClick={() => run('all', async () => downloadBlob(await docsZip([r], () => {}), `${docFolder(r)}.zip`))}>
          {busy === 'all' ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />} Download all ({docCount(r)})
        </button>
      )}
    </div>
  );
}
