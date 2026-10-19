// SST on a quotation (Joel, 2026-10-19): a "Price includes SST" tick. Ticked = the fees already include SST
// (the total stays as typed; the printout shows how much of it is SST). Not ticked = SST is not included.
// Older quotations saved with "Add SST" (applySST) still add SST on top, so they print as before.
export type SstMode = 'included' | 'added' | 'none';

export interface QuoteSst {
  mode: SstMode;
  rate: number;      // % (normally 8); 0 when mode is 'none'
  subtotal: number;  // sum of the lines, as typed
  sst: number;       // the SST part: inside the subtotal when 'included', on top when 'added'
  total: number;     // what the client pays
}

export function sstMode(q: { sstIncluded?: boolean; applySST?: boolean } | null | undefined): SstMode {
  if (q?.sstIncluded) return 'included';
  if (q?.applySST) return 'added';
  return 'none';
}

export function quoteSst(q: { items?: { totalFee?: any }[]; sstIncluded?: boolean; applySST?: boolean; sstRate?: number }): QuoteSst {
  const subtotal = (q.items || []).reduce((t, i) => t + (Number(i.totalFee) || 0), 0);
  const mode = sstMode(q);
  if (mode === 'none') return { mode, rate: 0, subtotal, sst: 0, total: subtotal };
  const rate = Number(q.sstRate) || 8;
  if (mode === 'included') return { mode, rate, subtotal, sst: (subtotal * rate) / (100 + rate), total: subtotal };
  const sst = (subtotal * rate) / 100;
  return { mode, rate, subtotal, sst, total: subtotal + sst };
}
