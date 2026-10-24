import { useEffect, useMemo, useState } from 'react';

// Shared paging and sorting for every list (Joel, 2026-10-24): 10, 20 or 30 per page (20 to start),
// remembered per person on this browser, First / Prev / Next / Last, back to page 1 when a filter changes.

export const PAGE_SIZES = [10, 20, 30] as const;
const SIZE_KEY = 'next_list_page_size';

function savedSize(): number {
  try {
    const n = Number(localStorage.getItem(SIZE_KEY));
    return (PAGE_SIZES as readonly number[]).includes(n) ? n : 20;
  } catch { return 20; }
}

export interface Paged<T> {
  pageItems: T[];
  page: number;          // 1-based
  pages: number;
  total: number;
  pageSize: number;
  setPage: (p: number) => void;
  setPageSize: (n: number) => void;
}

// `resetOn` lists the search, filter and sort values: when any changes, the list goes back to page 1.
export function usePaged<T>(items: T[], resetOn: unknown[] = []): Paged<T> {
  const [pageSize, setSize] = useState(savedSize);
  const [page, setPageRaw] = useState(1);
  const resetKey = JSON.stringify(resetOn);
  useEffect(() => { setPageRaw(1); }, [resetKey]);

  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pages);   // a deleted record can shrink the last page
  const pageItems = useMemo(() => items.slice((current - 1) * pageSize, current * pageSize), [items, current, pageSize]);

  const setPageSize = (n: number) => {
    setSize(n);
    setPageRaw(1);
    try { localStorage.setItem(SIZE_KEY, String(n)); } catch { /* blocked: this visit only */ }
  };
  return { pageItems, page: current, pages, total, pageSize, setPage: setPageRaw, setPageSize };
}

// ---------- Sorting ----------

export type ListSort = 'az' | 'za' | 'newest' | 'oldest';
export const LIST_SORT_LABELS: Record<ListSort, string> = {
  az: 'Name A to Z',
  za: 'Name Z to A',
  newest: 'Newest added first',
  oldest: 'Oldest added first',
};

// Records keep "created" as a number, an ISO date, or a Firestore time. 0 = unknown.
export function timeOf(v: any): number {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return Date.parse(v) || 0;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  return 0;
}

const byText = (a: string, b: string) => (a || '').localeCompare(b || '', 'en', { sensitivity: 'base', numeric: true });

// Sorts a copy. Records with no date created go to the end under both date sorts.
export function sortList<T>(items: T[], sort: ListSort, nameOf: (x: T) => string, createdOf: (x: T) => any): T[] {
  return [...items].sort((a, b) => {
    if (sort === 'za') return byText(nameOf(b), nameOf(a));
    if (sort === 'newest' || sort === 'oldest') {
      const ta = timeOf(createdOf(a)), tb = timeOf(createdOf(b));
      if (!ta !== !tb) return ta ? -1 : 1;
      if (ta !== tb) return sort === 'newest' ? tb - ta : ta - tb;
      return byText(nameOf(a), nameOf(b));
    }
    return byText(nameOf(a), nameOf(b));
  });
}
