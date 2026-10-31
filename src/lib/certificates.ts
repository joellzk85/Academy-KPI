// Certificates (Joel, 2026-10-31): "in admin work i need a certificate generator": from the deal card, names from the
// T3 attendance list, a running number, the client's logo (changeable), training date and venue, the signature, the
// Canva design as Template A, and upload / paste a link when the certificates were made elsewhere. Joel: "just AI
// generate the signature, it doesn't need to be the actual one" (drawn from the signer's name in a handwriting font);
// number format NA/CERT/2026/0001, restarting each January; and a link HR opens to download the PDFs.
//
// deal_certificates/{dealId} (Admin and Management only: IC numbers): the run's details as last generated and the
//   people with their numbers. A person keeps their number when the certificates are made again.
// cert_counters/{year}: { last } the last number given that year (only goes up).
// config/certificate_settings (Management): signer, signature style, number prefix, wording, HR link days.
// cert_links/{token} (server only, serverCertificates.ts): HR's link, opened at /cert/<token>.
// Shared by the browser and the server, so no database code here.

export type CertKind = 'participation' | 'completion' | 'appreciation';
export const CERT_KINDS: CertKind[] = ['participation', 'completion', 'appreciation'];
export const KIND_HEADING: Record<CertKind, string> = { participation: 'Of participation', completion: 'Of completion', appreciation: 'Of appreciation' };

export type SignatureStyle = 'great_vibes' | 'allura' | 'mrs_saint_delafield';
export const SIGNATURE_STYLES: { id: SignatureStyle; label: string; font: string }[] = [
  { id: 'great_vibes', label: 'Flowing', font: 'Great Vibes' },
  { id: 'allura', label: 'Elegant', font: 'Allura' },
  { id: 'mrs_saint_delafield', label: 'Quick hand', font: 'Mrs Saint Delafield' },
];

export interface CertSettings {
  prefix: string;              // NA/CERT → NA/CERT/2026/0001
  signerName: string;
  signerTitle: string;
  signatureStyle: SignatureStyle;
  wording: Record<CertKind, string>;   // {date}, {venue} and {title} are filled in
  showIc: boolean;             // starting tick for new runs
  linkDays: number;            // HR's link works this many days
}

export const DEFAULT_WORDING: Record<CertKind, string> = {
  participation: 'demonstrated exceptional engagement and involvement during the training, which took place on {date} at {venue}, where they exhibited an enthusiastic and dedicated approach, actively participating throughout the training.',
  completion: 'has successfully completed the training held on {date} at {venue}, meeting its learning objectives and taking part in every session.',
  appreciation: 'in appreciation of their valuable contribution and commitment during the training held on {date} at {venue}.',
};

export const DEFAULT_CERT_SETTINGS: CertSettings = {
  prefix: 'NA/CERT', signerName: '', signerTitle: 'Director', signatureStyle: 'great_vibes',
  wording: DEFAULT_WORDING, showIc: true, linkDays: 60,
};

const str = (v: any, max: number) => String(v ?? '').replace(/\u0000/g, '').trim().slice(0, max);

export function readCertSettings(d: any): CertSettings {
  const w = d?.wording || {};
  const style = SIGNATURE_STYLES.some(s => s.id === d?.signatureStyle) ? d.signatureStyle : DEFAULT_CERT_SETTINGS.signatureStyle;
  const days = Math.round(Number(d?.linkDays));
  return {
    prefix: cleanPrefix(d?.prefix ?? DEFAULT_CERT_SETTINGS.prefix) || DEFAULT_CERT_SETTINGS.prefix,
    signerName: str(d?.signerName, 60),
    signerTitle: str(d?.signerTitle ?? DEFAULT_CERT_SETTINGS.signerTitle, 60),
    signatureStyle: style,
    wording: Object.fromEntries(CERT_KINDS.map(k => [k, str(w[k], 600) || DEFAULT_WORDING[k]])) as Record<CertKind, string>,
    showIc: d?.showIc !== false,
    linkDays: days >= 1 && days <= 365 ? days : DEFAULT_CERT_SETTINGS.linkDays,
  };
}

export const cleanPrefix = (v: any) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9/-]/g, '').replace(/\/+$/, '').slice(0, 20);

// NA/CERT/2026/0001 (four digits, more once a year passes 9,999).
export const certNumber = (prefix: string, year: number, n: number) => `${prefix}/${year}/${String(n).padStart(4, '0')}`;

// ---------- the people ----------

export interface CertPerson {
  key: string;        // matches the person between runs (IC, else name)
  name: string;
  ic: string;
  number: string;     // '' until first generated
  issuedAt?: string;  // when the number was given
  left?: boolean;     // left out (absent): no certificate
}

export interface DealCertificates {
  template: 'A';
  kind: CertKind;
  title: string;
  dateText: string;
  venue: string;
  logoUrl: string;    // the client's logo unless changed here; 'none' = no client logo
  showIc: boolean;
  people: CertPerson[];
  generatedAt?: string;
  generatedById?: string;
  generatedByName?: string;
  count?: number;     // certificates in the last run
}

const keyText = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
export const personKey = (p: { name: string; ic: string }) => (keyText(p.ic) ? `ic:${keyText(p.ic)}` : `n:${keyText(p.name)}`);

// The T3 list, merged with the people already saved: a person found again keeps their number and "left out" tick.
// People saved before who are not on the T3 stay: names added by hand as they were, numbered ones left out (their
// number is never given to anyone else).
export function mergePeople(t3: { name: string; ic: string }[], saved: CertPerson[] = []): CertPerson[] {
  const byKey = new Map(saved.map(p => [p.key, p]));
  const byName = new Map(saved.map(p => [`n:${keyText(p.name)}`, p]));
  const seen = new Set<string>();
  const out: CertPerson[] = [];
  for (const t of t3) {
    const name = str(t.name, 120);
    if (!name) continue;
    const ic = str(t.ic, 30);
    const key = personKey({ name, ic });
    if (seen.has(key)) continue;
    seen.add(key);
    const old = byKey.get(key) || byName.get(`n:${keyText(name)}`);
    if (old && seen.has(old.key) && old.key !== key) continue;
    if (old) seen.add(old.key);
    // Already on the list: kept as it is (a spelling fixed here stays fixed).
    out.push(old ? { ...old } : { key, name, ic, number: '' });
  }
  for (const p of saved) if (!seen.has(p.key)) out.push(p);
  return out;
}

export const included = (people: CertPerson[]) => people.filter(p => !p.left && p.name.trim());

// The paragraph with the training's details filled in.
export function fillWording(text: string, v: { date: string; venue: string; title: string }) {
  return text
    .replace(/\{date\}/gi, v.date || '')
    .replace(/\{title\}/gi, v.title || '')
    .replace(/\s*\bat \{venue\}/gi, v.venue ? ` at ${v.venue}` : '')
    .replace(/\{venue\}/gi, v.venue || '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export const safeFileName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80);

// What HR's link page receives (serverCertificates.ts) and what the generator draws from: everything printed, no ids.
export interface CertPrint {
  kind: CertKind;
  title: string;
  dateText: string;
  venue: string;
  paragraph: string;
  signerName: string;
  signerTitle: string;
  signatureStyle: SignatureStyle;
  clientLogo: string;   // a data: URL, or '' for none
  company: string;
  people: { name: string; ic: string; number: string }[];
}

export function printOf(c: DealCertificates, s: CertSettings, clientLogo: string, company: string): CertPrint {
  return {
    kind: c.kind, title: c.title, dateText: c.dateText, venue: c.venue,
    paragraph: fillWording(s.wording[c.kind], { date: c.dateText, venue: c.venue, title: c.title }),
    signerName: s.signerName, signerTitle: s.signerTitle, signatureStyle: s.signatureStyle,
    clientLogo, company,
    people: included(c.people).filter(p => p.number).map(p => ({ name: p.name, ic: c.showIc ? p.ic : '', number: p.number })),
  };
}
