import React, { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { DownloadableFile, downloadFile } from '../lib/download';

// The small download icon next to an uploaded file or photo. `onPhoto` puts it over a thumbnail's corner.
export default function DownloadButton({ file, onPhoto, className = '' }: { file: DownloadableFile; onPhoto?: boolean; className?: string }) {
  const [busy, setBusy] = useState(false);
  const go = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try { await downloadFile(file); } catch { /* nothing to save; the file is no longer there */ } finally { setBusy(false); }
  };
  const look = onPhoto
    ? 'absolute right-1 bottom-1 rounded-md bg-white/90 p-1 text-ink shadow-sm hover:bg-white'
    : 'shrink-0 rounded-md p-1.5 text-ink-soft hover:bg-surface hover:text-accent';
  return (
    <button type="button" onClick={go} disabled={busy} className={`${look} ${className}`} title={`Download ${file.name}`} aria-label={`Download ${file.name}`}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
    </button>
  );
}
