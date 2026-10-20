// Import from the "Next Academy Blueprint" spreadsheet (Joel, 2026-10-20).
// Management → Data tools → Import from Blueprint. The server only reads the Excel file into plain rows
// (serverBlueprint.ts); everything here is pure, so the browser and a test script share it.
//
// - "List of Training" → the Programme list: name, category, HRDC (Etris) code, number of days, and the trainers
//   who teach it (ticked on trainers already in the Trainers list; nobody new is created). Course outlines,
//   the client column and fees are left out (Joel: "dont do anything at all to the course outline").
// - "Venue List" → the venue list, with the region (the state headings in the sheet) and the quotation date.
// - "Sales 2026" → Management → Payment tracking (payment_records): one line per HRDC claim or invoice.
// - The client list is ignored (Joel).
// Joel chose "spreadsheet wins": details already in the CRM are updated from the sheet; anything the sheet
// leaves blank, and photos, stay as they are. Payment lines already imported are never changed by a re-import
// (once imported, the CRM is where they're kept up to date).

export type Cell = string | number | null;
export interface BlueprintRows { training: Cell[][]; venues: Cell[][]; sales: Cell[][] }

// ---------- Small helpers ----------
const str = (c: Cell | undefined) => (c === null || c === undefined ? '' : String(c));
/** Trimmed text with tidy lines; a cell that is only "-" or "." counts as blank. */
export function clean(c: Cell | undefined): string {
  const lines = str(c).replace(/\r/g, '').split('\n').map(l => l.replace(/\s+/g, ' ').trim());
  while (lines.length && !lines[0]) lines.shift();
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  const out = lines.join('\n').replace(/\n{3,}/g, '\n\n');
  return /^[-.–]+$/.test(out) ? '' : out;
}
const num = (c: Cell | undefined): number | null => {
  if (typeof c === 'number' && Number.isFinite(c)) return Math.round(c * 100) / 100;
  const s = str(c).replace(/[, ]|RM/gi, '');
  return /^-?\d+(\.\d+)?$/.test(s) ? Math.round(Number(s) * 100) / 100 : null;
};
const isIso = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** The same name typed slightly differently counts as one ("&" = "and", British / American spelling, accents, punctuation). */
export function nameKey(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/behaviour/g, 'behavior').replace(/isation/g, 'ization').replace(/colour/g, 'color')
    .replace(/[^a-z0-9]+/g, '');
}
const tokens = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

/** Every word of the shorter name is in the longer one ("The Kabin" and "The Kabin, Jeram"). */
function wordsInside(a: string, b: string, minWords: number): boolean {
  const ta = tokens(a), tb = tokens(b);
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (short.length < minWords) return false;
  const set = new Set(long);
  return short.every(t => set.has(t));
}

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', sept: '09', oct: '10', nov: '11', dec: '12',
};
/** "2026-01-12", "12/01/2026", "4-5 Jul 2026", "5&6 May 2026", "18 -19 July 2026" → the first day as YYYY-MM-DD. */
export function parseDay(text: string): string {
  const t = text.trim().replace(/'+$/, '');
  if (isIso(t.slice(0, 10))) return t.slice(0, 10);
  let m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(t);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = /^(\d{1,2})\D{0,6}?(?:\d{1,2})?\s*([A-Za-z]{3,9})\.?\s+(\d{4})/.exec(t);
  const mm = m ? MONTHS[m[2].slice(0, 4).toLowerCase()] || MONTHS[m[2].slice(0, 3).toLowerCase()] : '';
  return m && mm ? `${m[3]}-${mm}-${m[1].padStart(2, '0')}` : '';
}

// ---------- 1. List of Training → programmes ----------
export interface BpProgramme {
  name: string;
  category: string;
  hrdcCode: string;          // '' when the sheet says NOT REGISTER YET (or nothing)
  registered: boolean;
  days: number | null;
  trainers: string[];        // names as typed
}

export function parseTraining(rows: Cell[][], warnings: string[] = []): BpProgramme[] {
  const h = rows.findIndex(r => r.some(c => /course title/i.test(str(c))));
  if (h < 0) { warnings.push('The "List of Training" sheet has no "Course Title" column, so no programmes were read.'); return []; }
  const head = rows[h].map(c => str(c).toLowerCase());
  const col = (re: RegExp) => head.findIndex(x => re.test(x));
  const cTitle = col(/course title/), cCat = col(/category/), cCode = col(/code|etris/), cTrainer = col(/trainer/), cDays = col(/number of days|days/);
  const out: BpProgramme[] = [];
  const byKey = new Map<string, BpProgramme>();
  let category = '';
  for (const r of rows.slice(h + 1)) {
    const cat = clean(r[cCat]).replace(/\s+/g, ' ');
    if (cat && !/^course outline/i.test(cat)) category = cat;
    const name = clean(r[cTitle]).replace(/\s*\n\s*/g, ' ');
    if (!name || /^course outline/i.test(name)) continue;
    const codeText = clean(r[cCode]).replace(/\s/g, '');
    const hrdcCode = /^\d{6,}$/.test(codeText) ? codeText : '';
    if (hrdcCode && hrdcCode.length !== 11) warnings.push(`The HRDC code ${hrdcCode} for "${name}" looks unusual (most codes have 11 digits). It was imported as it is; check it in Programmes.`);
    const d = num(r[cDays]);
    const p: BpProgramme = {
      name, category, hrdcCode, registered: !!hrdcCode,
      days: d && d > 0 && d <= 60 ? Math.round(d * 2) / 2 : null,
      trainers: clean(r[cTrainer]).split(/[/,\n]+/).map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean),
    };
    const key = nameKey(name);
    const seen = byKey.get(key);
    if (seen) {
      warnings.push(`"${name}" is listed twice in the training list; the two rows were merged.`);
      if (!seen.hrdcCode && p.hrdcCode) { seen.hrdcCode = p.hrdcCode; seen.registered = true; }
      if (!seen.days && p.days) seen.days = p.days;
      p.trainers.forEach(t => { if (!seen.trainers.some(x => nameKey(x) === nameKey(t))) seen.trainers.push(t); });
      continue;
    }
    byKey.set(key, p);
    out.push(p);
  }
  return out;
}

// ---------- 2. Venue List → venues ----------
export interface BpVenue {
  name: string;
  region: string;
  distance: string;
  meetingPackagePrice: string;
  roomPackagePrice: string;
  dinnerPackage: string;     // the sheet's "Meal package"
  facilities: string;
  contact: string;
  quotationDate: string;     // YYYY-MM-DD, or '' (an unreadable date goes into the remarks)
  remarks: string;
}

// The sheet's state headings, as shown in the CRM. Sunway Lagoon is its own heading in the sheet but is in Selangor.
const REGION_NAMES: Record<string, string> = {
  selangor: 'Selangor', kualalumpur: 'Kuala Lumpur', putrajaya: 'Putrajaya', melaka: 'Melaka', penang: 'Penang',
  terengganu: 'Terengganu', pahang: 'Pahang', pdnegerisembilan: 'Port Dickson / Negeri Sembilan', negerisembilan: 'Negeri Sembilan',
  perak: 'Perak', kedah: 'Kedah', johor: 'Johor', sunwaylagoon: 'Selangor', sabah: 'Sabah', sarawak: 'Sarawak', kelantan: 'Kelantan', perlis: 'Perlis',
};
const regionName = (s: string) => REGION_NAMES[nameKey(s)] || s.toLowerCase().replace(/\b[a-z]/g, x => x.toUpperCase());

export function parseVenues(rows: Cell[][], warnings: string[] = []): BpVenue[] {
  const h = rows.findIndex(r => r.some(c => /^venue$/i.test(clean(c))));
  if (h < 0) { warnings.push('The "Venue List" sheet has no "VENUE" column, so no venues were read.'); return []; }
  const head = rows[h].map(c => clean(c).toLowerCase().replace(/\s+/g, ' '));
  const col = (re: RegExp) => head.findIndex(x => re.test(x));
  const c = {
    name: col(/^venue$/), distance: col(/distance/), meeting: col(/meeting/), room: col(/room/), meal: col(/meal|dinner/),
    facilities: col(/facilit/), contact: col(/email|contact/), date: col(/quotation date|date/), remarks: col(/remark/),
  };
  const out: BpVenue[] = [];
  let region = '';
  for (const r of rows.slice(h + 1)) {
    const name = clean(r[c.name]).replace(/\s*\n\s*/g, ' ');
    if (!name) continue;
    const rest = [c.distance, c.meeting, c.room, c.meal, c.facilities, c.contact].map(i => clean(r[i]));
    if (rest.every(x => !x) && name === name.toUpperCase()) { region = regionName(name); continue; }
    let meeting = clean(r[c.meeting]), room = clean(r[c.room]), meal = clean(r[c.meal]);
    // One all-in package typed in all three columns is kept once, as the meeting package.
    if (room && room === meeting) room = '';
    if (meal && (meal === meeting || meal === clean(r[c.room]))) meal = '';
    const dateText = clean(r[c.date]);
    const quotationDate = parseDay(dateText);
    let remarks = clean(r[c.remarks]);
    if (dateText && !quotationDate) remarks = [remarks, `Quotation date: ${dateText.replace(/^-/, '')}`].filter(Boolean).join('\n');
    const v: BpVenue = {
      name, region, distance: clean(r[c.distance]).replace(/\s*\n\s*/g, ' '), meetingPackagePrice: meeting, roomPackagePrice: room, dinnerPackage: meal,
      facilities: clean(r[c.facilities]).replace(/^- /gm, '• ').replace(/^-(?=\S)/gm, '• '), contact: clean(r[c.contact]), quotationDate, remarks,
    };
    const same = out.find(x => nameKey(x.name) === nameKey(v.name) || wordsInside(x.name, v.name, 3));
    if (same) {
      warnings.push(`"${v.name}" is listed twice in the venue list (also as "${same.name}"); the two rows were merged.`);
      (Object.keys(v) as (keyof BpVenue)[]).forEach(k => { if (!same[k] && v[k]) (same as any)[k] = v[k]; });
      continue;
    }
    out.push(v);
  }
  return out;
}

// ---------- 3. Sales 2026 → payment lines ----------
export interface PaymentLine {
  id: string;
  source: 'blueprint' | 'manual';
  month: string;             // YYYY-MM: the month block it was in (or of its date)
  groupNo: string;           // lines of the same training share a group (several employers on one training)
  date: string;              // YYYY-MM-DD (first training day) or ''
  dateText: string;          // as typed ("4-5 Jul 2026")
  programme: string;
  salesPerson: string;
  claimId: string;
  grantId: string;
  client: string;
  employer: string;
  employerAddress: string;
  venue: string;
  approved: number;          // approved amount (claimed / invoiced)
  afterDeduct: number | null; // after HRDC's 4%
  afterTax: number | null;   // after all tax
  paidDate: string;          // YYYY-MM-DD or ''
  paidNote: string;          // e.g. "Paid before training"
  paidAmount: number | null; // what actually came in, if typed in the CRM
  // The training's costs (the same on every line of a group; counted once per group)
  trainingFee: number | null;
  trainer: string;
  trainerCost: number | null;
  commission: number | null;
  management: number | null;
  otherFee: number | null;
  otherFeeLabel: string;     // "Admin fee" or "Agent fee", as the sheet's column says
  venueCost: number | null;
  transport: number | null;
  facilitators: number | null;
  grossProfit: number | null;
  margin: number | null;     // %
  remarks: string;
}

const yyyymm = (iso: string) => (isIso(iso) ? iso.slice(0, 7) : '');

export function parseSales(rows: Cell[][], warnings: string[] = []): PaymentLine[] {
  const out: PaymentLine[] = [];
  let i = 0;
  while (i < rows.length) {
    const r = rows[i];
    if (!(clean(r[0]) === 'No.' && /^date$/i.test(clean(r[1])))) { i++; continue; }
    const head = r.map(x => clean(x).toLowerCase());
    const venueCol = /venue/.test(head[7] || '');
    const otherFeeLabel = /agent/.test(head[18] || '') ? 'Agent fee' : 'Admin fee';
    const block: PaymentLine[] = [];
    let no = '', date = '', dateText = '', idx = 0;
    for (i = i + 1; i < rows.length; i++) {
      const x = rows[i];
      if (clean(x[0]) === 'No.' && /^date$/i.test(clean(x[1]))) break;
      if (/^total/i.test(clean(x[1]))) { i++; break; }
      const programme = clean(x[2]).replace(/\s*\n\s*/g, ' ');
      const approved = num(x[9]);
      if (!programme && approved === null) continue;
      const thisNo = clean(x[0]);
      if (thisNo && thisNo !== no) { no = thisNo; idx = 0; date = ''; dateText = ''; }
      const dt = clean(x[1]);
      if (dt) { dateText = dt; date = parseDay(dt); }
      const paidRaw = clean(x[12]);
      const paidDate = parseDay(paidRaw);
      const emp = clean(x[8]).split('\n');
      const na = (s: string) => (/^n\/?a$/i.test(s) ? '' : s);
      block.push({
        id: '', source: 'blueprint', month: '', groupNo: no || String(block.length + 1), date, dateText,
        programme, salesPerson: clean(x[3]), claimId: na(clean(x[4])), grantId: na(clean(x[5])),
        client: clean(x[6]).replace(/\s*\n\s*/g, ' '), employer: na(emp[0] || ''), employerAddress: emp.slice(1).join('\n'),
        venue: venueCol ? clean(x[7]) : '',
        approved: approved || 0, afterDeduct: num(x[10]), afterTax: num(x[11]),
        paidDate, paidNote: paidRaw && !paidDate ? paidRaw : '', paidAmount: null,
        trainingFee: num(x[13]), trainer: clean(x[14]), trainerCost: num(x[15]), commission: num(x[16]), management: num(x[17]),
        otherFee: num(x[18]), otherFeeLabel, venueCost: num(x[19]), transport: num(x[20]), facilitators: num(x[21]),
        grossProfit: num(x[22]), margin: num(x[23]), remarks: clean(x[24]),
      });
      (block[block.length - 1] as any)._idx = idx++;
    }
    // One training can run over two "No." numbers (a 2-day training typed as two days, Selangor Dredging in January):
    // the next number joins it when it has the same programme and costs and the lines so far don't yet add up to the
    // training fee. Costs and profit then count once, as in the sheet's own totals.
    const net = (l: PaymentLine) => l.afterTax ?? l.afterDeduct ?? l.approved ?? 0;
    const sig = (l: PaymentLine) => [nameKey(l.programme), l.trainingFee, l.trainerCost, l.venueCost, l.grossProfit].join('|');
    const order = [...new Set(block.map(l => l.groupNo))];
    let cur = '', sum = 0;
    order.forEach(g => {
      const ls = block.filter(l => l.groupNo === g);
      const first = ls[0];
      const head = cur ? block.find(l => (l as any)._group === cur) : null;
      if (head && sig(head) === sig(first) && head.trainingFee !== null && sum < head.trainingFee - 1) {
        ls.forEach(l => { (l as any)._group = cur; });
      } else {
        cur = g; sum = 0;
        ls.forEach(l => { (l as any)._group = g; });
      }
      sum += ls.reduce((t, l) => t + net(l), 0);
    });
    // A line typed twice (same claim, employer, amounts and payment) that makes the training's lines add up to more
    // than its fee is a copy: left out, with a warning (Valmont, August 2026).
    const copyKey = (l: PaymentLine) => [l.claimId, l.employer, l.approved, l.afterTax, l.paidDate, l.paidNote].join('|');
    const same = (a: PaymentLine, b: PaymentLine) => copyKey(a) === copyKey(b);
    [...new Set(block.map(l => (l as any)._group))].forEach(g => {
      const ls = block.filter(l => (l as any)._group === g);
      const fee = ls[0].trainingFee;
      let total = ls.reduce((t, l) => t + net(l), 0);
      for (let k = ls.length - 1; k > 0 && fee !== null && total > fee + 1; k--) {
        if (!ls.slice(0, k).some(x => same(x, ls[k]))) continue;
        block.splice(block.indexOf(ls[k]), 1);
        total -= net(ls[k]);
        warnings.push(`A line for ${ls[k].employer || ls[k].client} (${ls[k].programme}, RM ${ls[k].approved.toLocaleString('en-MY', { minimumFractionDigits: 2 })}) is in the Sales sheet twice; the copy was left out.`);
      }
    });
    // The block's month: the most common month of its dates.
    const counts: Record<string, number> = {};
    block.forEach(l => { const m = yyyymm(l.date); if (m) counts[m] = (counts[m] || 0) + 1; });
    const month = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    if (block.length && !month) warnings.push(`${block.length} payment line${block.length === 1 ? '' : 's'} in the Sales sheet have no readable date, so they were left out.`);
    block.forEach(l => {
      if (!month) return;
      const idx2 = (l as any)._idx;
      const group = (l as any)._group;
      delete (l as any)._idx;
      delete (l as any)._group;
      l.month = month;
      l.id = `bp_${month.replace('-', '')}_${l.groupNo.replace(/[^0-9A-Za-z]/g, '') || 'x'}_${idx2 + 1}`;
      l.groupNo = `${month}#${group}`;
      out.push(l);
    });
  }
  // Two lines can't share an id (a typo in the "No." column): the later one gets a suffix.
  const seen = new Set<string>();
  out.forEach(l => { let id = l.id, n = 2; while (seen.has(id)) id = `${l.id}_${n++}`; l.id = id; seen.add(id); });
  return out;
}

// ---------- Matching with what's in the CRM ----------
/** The trainer in the CRM this name means, when exactly one fits ("Chee Cai" = "Lee Chee Cai"). */
export function matchTrainer(name: string, trainers: { id: string; name: string }[]): { id: string; name: string } | null {
  const exact = trainers.filter(t => nameKey(t.name || '') === nameKey(name));
  if (exact.length === 1) return exact[0];
  const near = trainers.filter(t => wordsInside(t.name || '', name, 1));
  return near.length === 1 ? near[0] : null;
}

export function matchVenue(name: string, venues: { id: string; name: string }[]): { id: string; name: string } | null {
  const exact = venues.find(v => nameKey(v.name || '') === nameKey(name));
  if (exact) return exact;
  const near = venues.filter(v => wordsInside(v.name || '', name, 2));
  return near.length === 1 ? near[0] : null;
}

// ---------- The import plan (what the preview shows and Import writes) ----------
export interface Change { field: string; from: string; to: string }
export interface ImportPlan {
  programmes: { add: BpProgramme[]; update: { id: string; name: string; changes: Change[]; data: Record<string, any> }[]; same: number; kept: string[] };
  trainers: { tick: { id: string; name: string; add: string[]; programmeNames: string[] }[]; unmatched: string[] };
  venues: { add: BpVenue[]; update: { id: string; name: string; changes: Change[]; data: Record<string, any> }[]; same: number };
  payments: { add: PaymentLine[]; existing: number };
  warnings: string[];
}

const PROGRAMME_FIELDS: [keyof BpProgramme, string][] = [['category', 'Category'], ['days', 'Number of days'], ['hrdcCode', 'HRDC code']];
const VENUE_FIELDS: [keyof BpVenue, string][] = [
  ['region', 'Region'], ['distance', 'Distance'], ['meetingPackagePrice', 'Meeting package'], ['roomPackagePrice', 'Room package'],
  ['dinnerPackage', 'Meal package'], ['facilities', 'Facilities'], ['contact', 'Contact'], ['quotationDate', 'Quotation date'], ['remarks', 'Remarks'],
];

export function planImport(rows: BlueprintRows, current: { programmes: any[]; venues: any[]; trainers: any[]; paymentIds: string[] }): ImportPlan {
  const warnings: string[] = [];
  const bpProgs = parseTraining(rows.training, warnings);
  const bpVenues = parseVenues(rows.venues, warnings);
  const lines = parseSales(rows.sales, warnings);

  // Programmes: the sheet wins; the CRM keeps its own name, and a status the sheet doesn't know about.
  const plan: ImportPlan = {
    programmes: { add: [], update: [], same: 0, kept: [] }, trainers: { tick: [], unmatched: [] },
    venues: { add: [], update: [], same: 0 }, payments: { add: [], existing: 0 }, warnings,
  };
  const progIdOf = new Map<BpProgramme, string>();
  bpProgs.forEach(p => {
    const cur = current.programmes.find(x => nameKey(x.name || '') === nameKey(p.name));
    if (!cur) { plan.programmes.add.push(p); return; }
    progIdOf.set(p, cur.id);
    const data: Record<string, any> = {};
    const changes: Change[] = [];
    PROGRAMME_FIELDS.forEach(([k, label]) => {
      const to = p[k];
      if (to === null || to === '' || to === undefined) return;
      const from = cur[k] ?? '';
      if (String(from) !== String(to)) { data[k] = to; changes.push({ field: label, from: String(from || '—'), to: String(to) }); }
    });
    if (p.registered && cur.hrdcStatus !== 'approved') {
      data.hrdcStatus = 'approved';
      changes.push({ field: 'HRDC status', from: cur.hrdcStatus === 'submitted' ? 'Waiting on HRDC' : 'Not registered', to: 'HRDC approved' });
    }
    if (!p.registered && cur.hrdcStatus === 'approved') plan.programmes.kept.push(`${cur.name}: the sheet says not registered, the CRM says HRDC approved${cur.hrdcCode ? ` (code ${cur.hrdcCode})` : ''}. Kept as approved.`);
    if (changes.length) plan.programmes.update.push({ id: cur.id, name: cur.name, changes, data });
    else plan.programmes.same++;
  });

  // Trainers: tick the programme on the trainers already in the list.
  const ticks = new Map<string, { id: string; name: string; add: Set<string>; programmeNames: string[] }>();
  const unmatched = new Set<string>();
  bpProgs.forEach((p, i) => {
    p.trainers.forEach(n => {
      const t = matchTrainer(n, current.trainers);
      if (!t) { unmatched.add(n); return; }
      const progRef = progIdOf.get(p) || `new:${i}`;
      const has = (current.trainers.find(x => x.id === t.id)?.programmeIds || []).includes(progRef);
      if (has) return;
      const e = ticks.get(t.id) || { id: t.id, name: t.name, add: new Set<string>(), programmeNames: [] };
      if (!e.add.has(progRef)) { e.add.add(progRef); e.programmeNames.push(p.name); }
      ticks.set(t.id, e);
    });
  });
  plan.trainers.tick = [...ticks.values()].map(t => ({ id: t.id, name: t.name, add: [...t.add], programmeNames: t.programmeNames }));
  plan.trainers.unmatched = [...unmatched].sort((a, b) => a.localeCompare(b));
  (plan as any)._bpProgs = bpProgs;

  // Venues: the sheet wins for every detail it has; the name, photos and status in the CRM stay.
  bpVenues.forEach(v => {
    const cur = matchVenue(v.name, current.venues) as any;
    if (!cur) { plan.venues.add.push(v); return; }
    const data: Record<string, any> = {};
    const changes: Change[] = [];
    VENUE_FIELDS.forEach(([k, label]) => {
      const to = v[k];
      if (!to) return;
      const from = String(cur[k] ?? '');
      if (from.trim() !== to) { data[k] = to; changes.push({ field: label, from: from || '—', to }); }
    });
    if (changes.length) plan.venues.update.push({ id: cur.id, name: cur.name, changes, data });
    else plan.venues.same++;
  });

  const have = new Set(current.paymentIds);
  lines.forEach(l => (have.has(l.id) ? plan.payments.existing++ : plan.payments.add.push(l)));
  return plan;
}

/** The programme ids a trainer tick refers to, once new programmes have their ids ("new:3" → "prog_…"). */
export function resolveProgrammeRef(ref: string, plan: ImportPlan, newIds: Map<BpProgramme, string>): string {
  if (!ref.startsWith('new:')) return ref;
  const p = ((plan as any)._bpProgs as BpProgramme[])[Number(ref.slice(4))];
  return (p && newIds.get(p)) || '';
}
