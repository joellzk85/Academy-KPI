import { getBlob, getDownloadURL, ref } from 'firebase/storage';
import { storage } from './firebase';

// Saves an uploaded file to the person's computer or phone under its own name.
// A straight download needs the Storage bucket's CORS setting (docs/features/backup-and-tidyup.md);
// until that is on, or if the download fails for any other reason, the file opens in a new tab instead.
export type DownloadableFile = { name: string; path?: string; url?: string };

export async function downloadFile(f: DownloadableFile): Promise<void> {
  try {
    const blob = f.url
      ? await fetch(f.url).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.blob(); })
      : await getBlob(ref(storage, f.path!));
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = f.name || 'file';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 60_000);
  } catch {
    const url = f.url || (f.path ? await getDownloadURL(ref(storage, f.path)) : '');
    if (url) window.open(url, '_blank', 'noopener');
  }
}
