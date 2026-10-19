// Several quotations on one deal, and quotations for other items (Joel, 2026-10-19).
// A deal can have any number of quotations (the training, plus bus, T-shirts, venue...). On the deal, the
// owner, Admin or Management tick which ones count in the deal total ("valueQuoteIds" on the deal); ticking
// sets the deal value (Closing RM) to their total. Nothing ticked = the deal value stays as typed.
// A quotation can also be for a client only (no deal): a document only, not counted anywhere.
import { quoteSst } from './quoteSst';

// "Other items only": every line is an item (no programme line). Printed without the training columns.
export function isItemsOnly(q: { items?: { kind?: string }[] } | null | undefined): boolean {
  const items = q?.items || [];
  return items.length > 0 && items.every(i => i.kind === 'item');
}

// What a quotation adds to the deal value: the printed total, except SST added on top by older
// quotations ("Add SST"), which was never part of the deal value.
export function quoteDealAmount(q: any): number {
  const s = quoteSst(q || {});
  return Math.round((s.mode === 'added' ? s.subtotal : s.total) * 100) / 100;
}

export function countedIds(deal: any): string[] {
  return Array.isArray(deal?.valueQuoteIds) ? deal.valueQuoteIds : [];
}

// The ticked quotations that still exist on this deal, and their total.
export function countedQuotes(deal: any, dealQuotes: any[]): any[] {
  const ids = countedIds(deal);
  return dealQuotes.filter(q => ids.includes(q.id));
}

export function countedTotal(deal: any, dealQuotes: any[]): number {
  return Math.round(countedQuotes(deal, dealQuotes).reduce((t, q) => t + quoteDealAmount(q), 0) * 100) / 100;
}
