// Reference numbers and customer codes (Joel, 2026-10-19).
//   Quotation:               HKL/NA/Q/20261023/01 (before 2026-10-23: HKL/NA/20260904/01)
//   Course outline proposal: HKL/NA/PRO/20261019/01
//   Teambuilding proposal:   HKL/NA/TB/20261019/01
// HKL = the client's customer code (clients/{id}.code), NA = NEXT Academy, then the date and the number made that day.
// The number counts across the whole company per day, separately for each kind of document.
// No client, or a client without a code yet: the number starts at NA/ and the code is added once it's known
// (only on drafts numbered this way, refAuto: true; older numbers and typed ones are never changed).

export type RefKind = 'quotation' | 'outline' | 'teambuilding';

// Quotations gained Q/ on 2026-10-23 (one style for all three, Joel); older quotation numbers keep theirs.
const INFIX: Record<RefKind, string> = { quotation: 'Q/', outline: 'PRO/', teambuilding: 'TB/' };
// Numbers from before 2026-10-19 count too, so a day's count carries on from them.
const OLD_PREFIX: Record<RefKind, RegExp> = { quotation: /^(?:[A-Z0-9]+\/)?NA\/(\d{8})\/(\d+)$/, outline: /^CO\/(\d{8})\/(\d+)$/, teambuilding: /^TB\/(\d{8})\/(\d+)$/ };

export const CODE_PROBLEM = 'A customer code is 2 to 6 capital letters or numbers, e.g. HKL (NA is kept for NEXT Academy).';
export const cleanCode = (s?: string) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const codeOk = (s?: string) => /^[A-Z0-9]{2,6}$/.test(String(s || '')) && s !== 'NA';
export const clientCode = (c: any): string => (c && codeOk(c.code) ? c.code : '');

// Another client already using this code (case doesn't matter).
export const codeTakenBy = (code: string, clients: any[], exceptId?: string) =>
  clients.find(c => c.id !== exceptId && cleanCode(c.code) === cleanCode(code)) || null;

// A suggestion from the company name's initials: "Hilton Kuala Lumpur" and "Hilton KL" give HKL. Words such as
// Sdn Bhd are skipped; a short all-capitals word (KL, MBB) is kept whole; one word gives its first 3 letters.
const SKIP = new Set(['SDN', 'BHD', 'BERHAD', 'M', 'THE', 'AND', 'OF', 'PLC', 'LTD', 'LIMITED', 'INC', 'CO', 'PTE', 'GROUP']);
export function suggestCode(name: string, clients: any[] = [], exceptId?: string): string {
  const words = String(name || '').replace(/\(.*?\)/g, ' ').split(/[^A-Za-z0-9]+/).filter(w => w && !SKIP.has(w.toUpperCase()));
  let base = '';
  if (words.length === 1) base = words[0].slice(0, 3).toUpperCase();
  else base = words.map(w => (/^[A-Z0-9]{2,3}$/.test(w) ? w : w[0].toUpperCase())).join('').slice(0, 6);
  base = cleanCode(base);
  if (base.length < 2) base = cleanCode(words.join('')).slice(0, 3);
  if (base.length < 2) return '';
  if (codeOk(base) && !codeTakenBy(base, clients, exceptId)) return base;
  const stem = base.slice(0, 5);
  for (let n = 2; n <= 9; n++) if (!codeTakenBy(`${stem}${n}`, clients, exceptId)) return `${stem}${n}`;
  return '';
}

// The next number for the day, counted across every document of that kind (any client, old numbers included).
export function nextDocRef(kind: RefKind, all: { refNumber?: string }[], dateIso: string, code = ''): string {
  const day = dateIso.replace(/-/g, '');
  const now = new RegExp(`^(?:[A-Z0-9]+\\/)?NA\\/${INFIX[kind].replace('/', '\\/')}(\\d{8})\\/(\\d+)$`);
  const used = all.map(d => String(d.refNumber || '')).map(r => r.match(now) || r.match(OLD_PREFIX[kind]))
    .filter((m): m is RegExpMatchArray => !!m && m[1] === day).map(m => parseInt(m[2], 10) || 0);
  const nn = String((used.length ? Math.max(...used) : 0) + 1).padStart(2, '0');
  return `${codeOk(code) ? `${code}/` : ''}NA/${INFIX[kind]}${day}/${nn}`;
}

// A draft numbered by the CRM, with its client's code put in (or swapped when the client changed). Anything else as it is.
export function refWithCode(ref: string, code: string): string {
  const m = String(ref || '').match(/^(?:[A-Z0-9]{2,6}\/)?(NA\/.+)$/);
  if (!m) return ref;
  return codeOk(code) ? `${code}/${m[1]}` : m[1];
}
