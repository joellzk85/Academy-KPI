import { useEffect, useRef, useState } from 'react';
import { friendlyError } from './firebase';

// Drafts save themselves (Joel, 2026-10-20: "save as draft for everything, if accidentally left page, or for edit later").
// Used by the quotation, course outline and teambuilding proposal editors. About 2 seconds after the last change the
// draft is written to the database; leaving the editor (Back, the menu, another tab) saves first; closing or reloading
// the browser tab while something is unsaved asks "Leave site?" and starts the save.
// `write` must not change the editor's own state: typing carries on while it runs.
export type AutoSaveState = { status: 'idle' | 'saving' | 'saved' | 'error'; at?: string; error?: string };

export function useAutoSave<T>({ value, dirty, enabled, write, onSaved, delay = 2000 }: {
  value: T;
  dirty: boolean;                       // differs from what's in the database
  enabled: boolean;                     // false for sent (locked) documents and untouched new ones
  write: (v: T) => Promise<void>;
  onSaved: (json: string) => void;      // JSON.stringify of the value that was written (the editor's "saved" copy)
  delay?: number;
}) {
  const [state, setState] = useState<AutoSaveState>({ status: 'idle' });
  const latest = useRef({ value, dirty, enabled, write, onSaved });
  latest.current = { value, dirty, enabled, write, onSaved };
  const timer = useRef<number | undefined>(undefined);
  const running = useRef<Promise<boolean> | null>(null);
  const mounted = useRef(true);
  const json = JSON.stringify(value);

  // Saves now if there's anything to save. Resolves true when nothing is left unsaved.
  const flush = async (): Promise<boolean> => {
    window.clearTimeout(timer.current);
    if (running.current) await running.current;
    const { value: v, dirty: d, enabled: on, write: w, onSaved: done } = latest.current;
    if (!on || !d) return true;
    const out = JSON.stringify(v);
    if (mounted.current) setState(s => ({ ...s, status: 'saving' }));
    const p = w(v).then(() => {
      if (mounted.current) {
        done(out);
        setState({ status: 'saved', at: new Date().toISOString() });
      }
      return true;
    }, e => {
      if (mounted.current) setState({ status: 'error', error: friendlyError(e) });
      return false;
    });
    running.current = p;
    const ok = await p;
    running.current = null;
    return ok;
  };

  // A couple of seconds after the last change.
  useEffect(() => {
    if (!enabled || !dirty) return;
    timer.current = window.setTimeout(() => { flush(); }, delay);
    return () => window.clearTimeout(timer.current);
  }, [json, enabled, dirty]);

  // A failed save (e.g. no internet) tries again every 15 seconds.
  useEffect(() => {
    if (state.status !== 'error') return;
    const t = window.setTimeout(() => { flush(); }, 15000);
    return () => window.clearTimeout(t);
  }, [state]);

  // Closing or reloading the tab: ask first and start saving; a phone switching apps: just save.
  useEffect(() => {
    const pending = () => !!running.current || (latest.current.enabled && latest.current.dirty);
    const onUnload = (e: BeforeUnloadEvent) => {
      if (!pending()) return;
      flush();
      e.preventDefault();
      e.returnValue = '';
    };
    const onHide = () => { if (document.visibilityState === 'hidden' && pending()) flush(); };
    window.addEventListener('beforeunload', onUnload);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, []);

  // Leaving the editor inside the CRM (menu, another screen): save what's there.
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; flush(); };
  }, []);

  return { state, flush };
}

// The line in the editor's bottom bar.
// `touched` is false for a new document nobody has changed yet (nothing is saved until they do).
export function autoSaveText(s: AutoSaveState, dirty: boolean, locked: boolean, touched = true): { text: string; tone: 'soft' | 'attention' | 'danger' } {
  if (locked) return { text: 'Sent and locked', tone: 'soft' };
  if (!touched) return { text: 'Saves as a draft once you change something', tone: 'soft' };
  if (s.status === 'error' && dirty) return { text: `Couldn't save the draft (${s.error}). Trying again every 15 seconds, or click Save.`, tone: 'danger' };
  if (s.status === 'saving') return { text: 'Saving draft…', tone: 'soft' };
  if (dirty) return { text: 'Draft saves in a moment', tone: 'attention' };
  if (s.status === 'saved' && s.at) {
    const t = new Date(s.at).toLocaleTimeString('en-MY', { hour: 'numeric', minute: '2-digit' });
    return { text: `Draft saved ${t}`, tone: 'soft' };
  }
  return { text: 'All changes saved', tone: 'soft' };
}

// Leaving: save first; only if that fails, ask.
export async function leaveAfterSave(flush: () => Promise<boolean>, go: () => void) {
  if (await flush()) { go(); return; }
  if (window.confirm("The draft couldn't be saved. Leave anyway? Your latest changes will be lost.")) go();
}
