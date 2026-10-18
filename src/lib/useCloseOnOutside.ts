import { RefObject, useEffect } from 'react';

// Closes a drop-down list when the person clicks or tabs anywhere outside it, or presses Esc.
// Used by the client and programme pickers on the deal form.
export function useCloseOnOutside(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('keydown', esc);
    };
  }, [ref, open, close]);
}
