import { type RefObject, useRef } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { LIST_SORT_LABELS, PAGE_SIZES, type ListSort, type Paged } from '../lib/listPaging';

// Filter and sort drop-downs on list screens.
export const listSelect = 'rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';

// Name A to Z / Z to A, newest / oldest added.
export function SortSelect({ value, onChange, label = 'Sort' }: { value: ListSort; onChange: (v: ListSort) => void; label?: string }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value as ListSort)} className={listSelect} aria-label={label}>
      {(Object.keys(LIST_SORT_LABELS) as ListSort[]).map(k => <option key={k} value={k}>{LIST_SORT_LABELS[k]}</option>)}
    </select>
  );
}

// The bar under every list: "Showing 21–40 of 132", per page 10 / 20 / 30, First · Prev · Page x of y · Next · Last.
// Put it inside the list's box: turning a page scrolls back to the top of that box (or of `top`, when given).
export default function ListPager({ paged, noun = 'records', top }: { paged: Paged<unknown>; noun?: string; top?: RefObject<HTMLElement | null> }) {
  const ref = useRef<HTMLDivElement>(null);
  const { page, pages, total, pageSize, setPage, setPageSize } = paged;
  if (total === 0) return null;

  const go = (p: number) => {
    setPage(p);
    (top?.current || ref.current?.parentElement)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const btn = 'inline-flex h-8 min-w-8 items-center justify-center rounded-lg border border-line bg-white px-2 text-sm text-ink hover:bg-surface disabled:cursor-default disabled:opacity-40 disabled:hover:bg-white';

  return (
    <div ref={ref} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line bg-surface px-4 py-2.5 text-sm text-ink-soft">
      <span>Showing {from}–{to} of {total} {noun}</span>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5">Per page
          <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))} aria-label="Rows per page"
            className="rounded-lg border border-line bg-white px-2 py-1 text-sm text-ink focus:border-accent focus:outline-none">
            {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        {pages > 1 && (
          <span className="flex items-center gap-1">
            <button type="button" className={btn} onClick={() => go(1)} disabled={page === 1} aria-label="First page" title="First page"><ChevronsLeft className="h-4 w-4" /></button>
            <button type="button" className={btn} onClick={() => go(page - 1)} disabled={page === 1} aria-label="Previous page" title="Previous page"><ChevronLeft className="h-4 w-4" /></button>
            <span className="px-1.5 text-ink">Page {page} of {pages}</span>
            <button type="button" className={btn} onClick={() => go(page + 1)} disabled={page === pages} aria-label="Next page" title="Next page"><ChevronRight className="h-4 w-4" /></button>
            <button type="button" className={btn} onClick={() => go(pages)} disabled={page === pages} aria-label="Last page" title="Last page"><ChevronsRight className="h-4 w-4" /></button>
          </span>
        )}
      </div>
    </div>
  );
}
