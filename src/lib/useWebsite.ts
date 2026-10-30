import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from './firebase';
import { PAGES, SETTINGS_DOC, SiteSettings } from './website';

// The website's settings (who may edit, footer links, its own addresses). Read by the CRM header to show the
// Website button, and by the Website screen.
export function useSiteSettings() {
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  useEffect(() => onSnapshot(doc(db, 'config', SETTINGS_DOC), s => setSettings((s.data() as SiteSettings) || {}), () => setSettings({})), []);
  return settings;
}

/** Tells this server's website to show a change straight away (other servers catch up within half a minute). */
export async function refreshSite() {
  try {
    const token = await auth.currentUser?.getIdToken();
    if (token) await fetch('/api/site/refresh', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' });
  } catch { /* the site shows it within half a minute anyway */ }
}

/** How many pages wait for approval (the owner's Website button shows it). */
export function useWaitingPages(enabled: boolean) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!enabled) { setN(0); return; }
    return onSnapshot(collection(db, PAGES), s => setN(s.docs.filter(d => d.data().status === 'waiting' && !d.data().deleted).length), () => setN(0));
  }, [enabled]);
  return n;
}
