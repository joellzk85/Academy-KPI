// Client history (Joel, 2026-10-18): every touch point with a client, gathered from what's already recorded,
// plus touch points added straight on the client page ("Add touch point") and client-tagged To-dos.
//
// - Touch points added on the client live in client_touch_points/{id} (one record each, so only the person who
//   added one, or Management, can change or delete it). A To-do ticked done with "What happened?" adds one too.
// - The timeline is built each time from the deals, quotations, course outlines, proposal files, To-dos and
//   those touch points. Nothing is copied.
// - "Last touch point" (and the colour dot) counts real contact only: follow-up notes, logged appointments,
//   proposals sent (including a sent course outline), quotations sent, deals won, the date a new deal's client
//   asked, and touch points. Drafts (quotations and outlines), booked appointments, To-dos and lost deals show on
//   the timeline but don't count.
// - The colour limits (30 and 90 days) are config/client_contact_colours, set by Management on the
//   Follow-up rules page.
//
// Pure logic (no database code).
import { OPEN_STAGES, dealOwnerId, dealStage, formatDate } from './deals';
import { FollowUpHow, HOW_LABELS, followUpNotes, daysBetween } from './followUps';
import { apptOf } from './appointments';

export type TouchHow = FollowUpHow;
export const TOUCH_HOW_LABELS = HOW_LABELS;

export interface ClientTouchPoint {
  id: string;
  clientId: string;
  date: string;              // YYYY-MM-DD, when it happened
  how: TouchHow;
  contactId?: string;        // one of the client's contact persons
  contactName?: string;
  text: string;              // what happened
  nextDate?: string;         // next follow-up date (optional)
  followUpById?: string;     // who follows up (required with a next date)
  followUpByName?: string;
  at: string;                // when it was saved
  byId: string;
  byName: string;
  source?: 'manual' | 'todo';
  taskId?: string;           // the To-do it came from
}

export const newTouchPointId = () => `tp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const ymd = (v: any): string => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '');
const norm = (s?: string) => (s || '').trim().toLowerCase();

// ---------- Which records belong to a client ----------
// Deals linked by clientId, or older deals typed with the same company name (as the client panel always did).
export function clientDeals(client: any, deals: any[]): any[] {
  return deals.filter(p => p.clientId === client.id || (!p.clientId && norm(p.client) && norm(p.client) === norm(client.companyName)));
}
export function clientQuotes(client: any, quotes: any[], deals: any[]): any[] {
  const ids = new Set(clientDeals(client, deals).map(p => p.id));
  return quotes.filter(q => q.clientId === client.id || (q.pipelineId && ids.has(q.pipelineId))
    || (!q.clientId && !q.pipelineId && norm(q.company) && norm(q.company) === norm(client.companyName)));
}
export function clientOutlines(client: any, outlines: any[], deals: any[]): any[] {
  const ids = new Set(clientDeals(client, deals).map(p => p.id));
  return outlines.filter(o => (o.pipelineId && ids.has(o.pipelineId)) || (!o.pipelineId && o.clientId === client.id));
}

// ---------- Colour ----------
export type ContactLimits = { green: number; amber: number };
export const DEFAULT_CONTACT_LIMITS: ContactLimits = { green: 30, amber: 90 };
export function readContactLimits(data: any): ContactLimits {
  const g = Math.round(Number(data?.green)), a = Math.round(Number(data?.amber));
  const green = Number.isFinite(g) && g >= 1 && g <= 365 ? g : DEFAULT_CONTACT_LIMITS.green;
  const amber = Number.isFinite(a) && a > green && a <= 730 ? a : Math.max(DEFAULT_CONTACT_LIMITS.amber, green + 1);
  return { green, amber };
}

export type ContactColour = 'green' | 'amber' | 'red' | 'never';
export const COLOUR_LABELS: Record<ContactColour, string> = { green: 'Green', amber: 'Amber', red: 'Red', never: 'Never' };

export function contactColour(lastDate: string, today: string, limits: ContactLimits): ContactColour {
  if (!ymd(lastDate)) return 'never';
  const d = daysBetween(ymd(lastDate), today);
  if (d <= limits.green) return 'green';
  if (d <= limits.amber) return 'amber';
  return 'red';
}

// "Today", "Yesterday", "12 days ago", "4 months ago", "Never".
export function agoText(lastDate: string, today: string): string {
  if (!ymd(lastDate)) return 'Never';
  const d = daysBetween(ymd(lastDate), today);
  if (d <= 0) return 'Today';
  if (d === 1) return 'Yesterday';
  if (d < 60) return `${d} days ago`;
  if (d < 730) return `${Math.floor(d / 30.4)} months ago`;
  return `${Math.floor(d / 365)} years ago`;
}

// ---------- Timeline ----------
export type EntryKind =
  | 'touch' | 'followup' | 'appt_booked' | 'appt_held' | 'proposal' | 'quote_draft' | 'quote_sent'
  | 'deal_created' | 'deal_won' | 'deal_lost' | 'outline' | 'todo' | 'proposal_open';
export type TimelineFilter = 'all' | 'touch' | 'docs' | 'deals' | 'todos';
export const FILTER_LABELS: Record<TimelineFilter, string> = {
  all: 'All', touch: 'Touch points and follow-ups', docs: 'Proposals and quotations', deals: 'Deals', todos: 'To-dos',
};
const KIND_FILTER: Record<EntryKind, TimelineFilter> = {
  touch: 'touch', followup: 'touch', appt_booked: 'touch', appt_held: 'touch',
  proposal: 'docs', quote_draft: 'docs', quote_sent: 'docs', outline: 'docs', proposal_open: 'docs',
  deal_created: 'deals', deal_won: 'deals', deal_lost: 'deals', todo: 'todos',
};
export const entryInFilter = (e: TimelineEntry, f: TimelineFilter) => f === 'all' || KIND_FILTER[e.kind] === f;

export interface TimelineEntry {
  key: string;
  kind: EntryKind;
  date: string;              // YYYY-MM-DD
  at?: string;               // when it was saved (for order within a day)
  title: string;             // what happened, short
  text?: string;             // more detail
  byId?: string;
  byName?: string;
  how?: string;              // Call, WhatsApp, Email, Visit…
  nextDate?: string;
  followUpById?: string;
  followUpByName?: string;
  dealId?: string;
  quoteId?: string;
  outlineId?: string;
  fileIds?: string[];        // proposal files
  touchPointId?: string;
  taskId?: string;
  counts: boolean;           // counts toward "last touch point"
  open?: boolean;            // its next follow-up is still waiting (the deal's latest note; a touch point not followed up yet)
  done?: boolean;            // To-dos
}

export interface TimelineSources {
  deals: any[];              // the client's deals (clientDeals)
  quotes: any[];             // the client's quotations (clientQuotes)
  outlines: any[];           // the client's course outlines (clientOutlines)
  files: { id: string; dealId: string; at: string; byName: string }[];
  touchPoints: ClientTouchPoint[];   // this client's
  tasks: any[];              // To-dos tagged with this client
  nameOf: (id: string) => string;
  links?: any[];             // teambuilding proposal links (doc_links), only for people allowed to see tracking
}

// Who did a deal step: from the deal's History line, else the deal owner.
function historyBy(p: any, starts: string): { byId?: string; byName?: string; at?: string } {
  const h = (Array.isArray(p.history) ? p.history : []).filter((x: any) => typeof x?.action === 'string' && x.action.startsWith(starts)).pop();
  return h ? { byId: h.byId, byName: h.byName, at: h.at } : {};
}

const APPT_HOW: Record<string, string> = { face: 'Visit', online: 'Online meeting', call: 'Call' };

export function followUpByOf(p: any): string {
  return p?.followUpById || dealOwnerId(p);
}

export function clientTimeline(s: TimelineSources): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  const owner = (p: any) => ({ byId: dealOwnerId(p), byName: s.nameOf(dealOwnerId(p)) });

  s.deals.forEach(p => {
    const asked = ymd(p.requestDate);
    if (asked) {
      const h = historyBy(p, 'Deal created');
      out.push({
        key: `created_${p.id}`, kind: 'deal_created', date: asked, at: h.at, title: 'Deal created: client asked',
        byId: h.byId || p.creatorId || dealOwnerId(p), byName: h.byName || p.creatorName || s.nameOf(dealOwnerId(p)),
        dealId: p.id, counts: true,
      });
    }
    const notes = followUpNotes(p);
    const dealOpen = OPEN_STAGES.includes(dealStage(p)) && !p.deleted;
    notes.forEach(n => {
      const fb = n.followUpById || dealOwnerId(p);
      out.push({
        key: `fu_${p.id}_${n.id}`, kind: 'followup', date: ymd(n.date), at: n.at,
        title: n.decision === 'keep_open' ? 'Follow-up: kept the deal open' : 'Follow-up',
        text: [n.text, n.reason ? `Why keep open: ${n.reason}` : ''].filter(Boolean).join('\n'),
        byId: n.byId, byName: n.byName, how: HOW_LABELS[n.how] || 'Other',
        nextDate: ymd(n.nextDate), followUpById: fb, followUpByName: n.followUpByName || s.nameOf(fb),
        dealId: p.id, counts: true, open: dealOpen && n.id === notes[0].id,
      });
    });
    const a = apptOf(p);
    if (a && a.status === 'booked') {
      out.push({
        key: `apptb_${p.id}`, kind: 'appt_booked', date: ymd(a.bookedAt) || ymd(a.date), at: a.bookedAt,
        title: `Appointment booked for ${formatDate(a.date)}`, byId: a.bookedById, byName: a.bookedByName || owner(p).byName,
        how: APPT_HOW[a.mode], dealId: p.id, counts: false,
      });
    } else if (a && a.status === 'held') {
      out.push({
        key: `appth_${p.id}`, kind: 'appt_held', date: ymd(a.date), at: a.loggedAt,
        title: a.legacy ? 'Appointment held' : `Appointment held${a.metWith ? ` with ${a.metWith}` : ''}`,
        text: [a.outcome, a.nextStep ? `Next step: ${a.nextStep}` : ''].filter(Boolean).join('\n'),
        byId: a.loggedById || owner(p).byId, byName: a.loggedByName || owner(p).byName,
        how: APPT_HOW[a.mode], dealId: p.id, counts: true,
      });
    }
    const prop = ymd(p.proposalSentDate);
    if (prop) {
      const h = historyBy(p, 'Proposal sent');
      out.push({
        key: `prop_${p.id}`, kind: 'proposal', date: prop, at: h.at, title: 'Proposal sent',
        byId: h.byId || owner(p).byId, byName: h.byName || owner(p).byName, dealId: p.id,
        fileIds: s.files.filter(f => f.dealId === p.id).sort((x, y) => y.at.localeCompare(x.at)).map(f => f.id), counts: true,
      });
    }
    // "Quotation sent another way" with no sent quotation on record: the deal's own date.
    const qs = ymd(p.quotationSentDate);
    if (qs && !s.quotes.some(q => q.pipelineId === p.id && q.status === 'sent')) {
      const h = historyBy(p, 'Quotation sent');
      out.push({ key: `qsd_${p.id}`, kind: 'quote_sent', date: qs, at: h.at, title: 'Quotation sent', byId: h.byId || owner(p).byId, byName: h.byName || owner(p).byName, dealId: p.id, counts: true });
    }
    if (dealStage(p) === 'won') {
      const h = historyBy(p, 'Won');
      const won = ymd(p.wonDate);
      if (won) out.push({ key: `won_${p.id}`, kind: 'deal_won', date: won, at: h.at, title: 'Deal won: client signed', byId: h.byId || owner(p).byId, byName: h.byName || owner(p).byName, dealId: p.id, counts: true });
    }
    if (dealStage(p) === 'lost') {
      const d = ymd(p.lostDate) || ymd(p.lostAt);
      if (d) out.push({
        key: `lost_${p.id}`, kind: 'deal_lost', date: d, at: p.lostAt, title: `Deal lost${p.lostReason ? `: ${p.lostReason}` : ''}`,
        text: p.lostNote || '', byId: p.lostById, byName: p.lostByName || '', dealId: p.id, counts: false,
      });
    }
  });

  s.quotes.forEach(q => {
    const ref = q.refNumber || 'No reference';
    if (q.status === 'sent') {
      const log = Array.isArray(q.sendLog) ? q.sendLog : [];
      const last = log[log.length - 1];
      const how = last?.channel === 'email' ? 'Email' : last?.channel === 'whatsapp' ? 'WhatsApp' : last?.channel === 'link' ? 'Client link' : '';
      out.push({
        key: `qs_${q.id}`, kind: 'quote_sent', date: ymd(q.sentAt) || ymd(q.date), at: q.sentAt, title: `Quotation ${ref} sent`,
        text: log.length > 1 ? `Sent ${log.length} times` : '', byId: q.sentById, byName: q.sentByName || '', how,
        dealId: q.pipelineId || undefined, quoteId: q.id, counts: true,
      });
    } else {
      const d = ymd(q.date) || (q.createdAt ? new Date(q.createdAt).toISOString().slice(0, 10) : '');
      if (d) out.push({
        key: `qd_${q.id}`, kind: 'quote_draft', date: d, title: `Quotation ${ref} (draft)`,
        byId: q.creatorId || q.ownerId, byName: s.nameOf(q.creatorId || q.ownerId) || q.preparedBy || '',
        dealId: q.pipelineId || undefined, quoteId: q.id, counts: false,
      });
    }
  });

  s.outlines.forEach(o => {
    const d = ymd(o.sentAt) || ymd(o.date);
    if (!d) return;
    out.push({
      key: `co_${o.id}`, kind: 'outline', date: d, at: o.sentAt || undefined,
      title: `Course outline${o.refNumber ? ` ${o.refNumber}` : ''}${o.status === 'sent' ? ' sent' : ' (draft)'}`,
      text: o.courseTitle || '', byId: o.creatorId || o.ownerId, byName: s.nameOf(o.creatorId || o.ownerId) || o.preparedBy || '',
      // A sent outline is a proposal sent (Joel, 2026-10-19), so it counts as contact; a draft doesn't.
      dealId: o.pipelineId || undefined, outlineId: o.id, counts: o.status === 'sent',
    });
  });

  // The client opened a client link (teambuilding push B; every kind since 2026-10-20): shown dashed, it doesn't count as
  // contact (Joel). The caller passes only links the viewer may see tracking for.
  const dealIds = new Set(s.deals.map(d => d.id));
  (s.links || []).filter(l => l.views && dealIds.has(l.dealId)).forEach(l => {
    const at = new Date(l.lastViewedAt || l.firstViewedAt || 0);
    if (!+at) return;
    out.push({
      key: `po_${l.token}`, kind: 'proposal_open', date: new Date(+at + 8 * 3600_000).toISOString().slice(0, 10), at: at.toISOString(),
      title: `Client opened the ${l.kind === 'quotation' ? 'quotation' : l.kind === 'outline' ? 'course outline' : 'teambuilding proposal'}${l.refNumber ? ` ${l.refNumber}` : ''}`,
      text: `${l.views === 1 ? 'Once' : `${l.views} times`}${l.accepted ? `; accepted online by ${l.accepted.name} (${l.accepted.position})` : ''}`,
      dealId: l.dealId || undefined, counts: false,
    });
  });

  s.touchPoints.forEach(t => {
    if (!ymd(t.date)) return;
    out.push({
      key: `tp_${t.id}`, kind: 'touch', date: ymd(t.date), at: t.at,
      title: `${t.source === 'todo' ? 'To-do done' : 'Touch point'}${t.contactName ? ` with ${t.contactName}` : ''}`,
      text: t.text, byId: t.byId, byName: t.byName, how: TOUCH_HOW_LABELS[t.how] || 'Other',
      nextDate: ymd(t.nextDate), followUpById: t.followUpById, followUpByName: t.followUpByName,
      touchPointId: t.id, taskId: t.taskId, counts: true,
    });
  });

  s.tasks.forEach(t => {
    const d = ymd(t.dateCreated) || (t.createdAt ? new Date(t.createdAt).toISOString().slice(0, 10) : '');
    if (!d) return;
    const people = taskAssignees(t).map(id => s.nameOf(id)).join(', ');
    out.push({
      key: `todo_${t.id}`, kind: 'todo', date: d, title: `To-do${t.status === 'Done' ? ' (done)' : ''}: ${t.detail || ''}`,
      text: people ? `For ${people}${ymd(t.dateline) ? `, due ${formatDate(ymd(t.dateline))}` : ''}` : '',
      byId: t.assignedById, byName: s.nameOf(t.assignedById) || t.assignedBy || '',
      dealId: t.pipelineId || undefined, taskId: t.id, counts: false, done: t.status === 'Done',
    });
  });

  s.touchPoints.forEach(t => {
    const e = out.find(x => x.touchPointId === t.id);
    if (e) e.open = touchFollowUpOpen(t, out);
  });
  return out.sort(byNewest);
}

export function byNewest(a: { date: string; at?: string }, b: { date: string; at?: string }): number {
  return b.date.localeCompare(a.date) || String(b.at || '').localeCompare(String(a.at || ''));
}

// The latest real contact (not in the future).
export function lastTouch(entries: TimelineEntry[], today: string): TimelineEntry | null {
  return entries.filter(e => e.counts && e.date <= today).sort(byNewest)[0] || null;
}

// ---------- Follow-ups ----------
export interface NextFollowUp {
  date: string;
  byId: string;
  byName: string;
  dealId?: string;
  touchPointId?: string;
}

// A touch point's follow-up is open until something newer is recorded with the client.
export function touchFollowUpOpen(t: ClientTouchPoint, entries: TimelineEntry[]): boolean {
  if (!ymd(t.nextDate)) return false;
  return !entries.some(e => e.counts && e.touchPointId !== t.id
    && (e.date > ymd(t.date) || (e.date === ymd(t.date) && !!e.at && String(e.at) > String(t.at))));
}

// Every open follow-up for a client: the open deals' next follow-up dates, and touch points not yet followed up.
export function clientFollowUps(deals: any[], touchPoints: ClientTouchPoint[], entries: TimelineEntry[], nameOf: (id: string) => string): NextFollowUp[] {
  const out: NextFollowUp[] = [];
  deals.forEach(p => {
    const d = ymd(p.followUpDate);
    if (!d || !OPEN_STAGES.includes(dealStage(p)) || p.deleted) return;
    const by = followUpByOf(p);
    out.push({ date: d, byId: by, byName: nameOf(by), dealId: p.id });
  });
  touchPoints.forEach(t => {
    if (!touchFollowUpOpen(t, entries)) return;
    out.push({ date: ymd(t.nextDate), byId: t.followUpById || t.byId, byName: t.followUpByName || nameOf(t.followUpById || t.byId), touchPointId: t.id });
  });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// ---------- To-dos tagged with clients ----------
export function taskAssignees(t: any): string[] {
  const list: string[] = Array.isArray(t?.assignedToIds) && t.assignedToIds.length ? t.assignedToIds : [t?.assignedToId || t?.ownerRepId || ''];
  return [...new Set(list.filter(Boolean))];
}
export function taskClientIds(t: any): string[] {
  return Array.isArray(t?.clientIds) ? t.clientIds.filter(Boolean) : [];
}

// ---------- One summary per client (client list, deal panel dot) ----------
export interface ClientSummary {
  entries: TimelineEntry[];
  last: TimelineEntry | null;
  colour: ContactColour;
  next: NextFollowUp | null;
  followUps: NextFollowUp[];
  people: Set<string>;       // owners of its deals, and everyone named on its follow-ups and touch points ("My clients")
}

export function summariseClient(client: any, all: {
  deals: any[]; quotes: any[]; outlines: any[]; files: TimelineSources['files']; touchPoints: ClientTouchPoint[]; tasks: any[]; links?: any[];
}, nameOf: (id: string) => string, today: string, limits: ContactLimits): ClientSummary {
  const deals = clientDeals(client, all.deals);
  const touchPoints = all.touchPoints.filter(t => t.clientId === client.id);
  const entries = clientTimeline({
    deals, quotes: clientQuotes(client, all.quotes, all.deals), outlines: clientOutlines(client, all.outlines, all.deals),
    files: all.files, touchPoints, tasks: all.tasks.filter(t => taskClientIds(t).includes(client.id)), nameOf, links: all.links,
  });
  const last = lastTouch(entries, today);
  const followUps = clientFollowUps(deals, touchPoints, entries, nameOf);
  const people = new Set<string>();
  deals.forEach(p => {
    if (dealOwnerId(p)) people.add(dealOwnerId(p));
    if (p.followUpById) people.add(p.followUpById);
    followUpNotes(p).forEach(n => { if (n.byId) people.add(n.byId); if (n.followUpById) people.add(n.followUpById); });
  });
  touchPoints.forEach(t => { people.add(t.byId); if (t.followUpById) people.add(t.followUpById); });
  return { entries, last, colour: contactColour(last?.date || '', today, limits), next: followUps[0] || null, followUps, people };
}

// ---------- Team follow-ups (Management, 2026-10-18) ----------
// Every open follow-up across the team (client follow-ups and open deals' follow-up dates), and the clients that
// have gone quiet (red or never contacted) with nobody following up. My home shows a summary; Management → Team
// follow-ups shows the whole list.
export type DueBucket = 'overdue' | 'today' | 'week' | 'later';
export const DUE_LABELS: Record<DueBucket, string> = { overdue: 'Overdue', today: 'Today', week: 'Next 7 days', later: 'Later' };
export function dueBucket(date: string, today: string): DueBucket {
  const d = daysBetween(today, date);
  return d < 0 ? 'overdue' : d === 0 ? 'today' : d <= 7 ? 'week' : 'later';
}

export interface TeamFollowUp extends NextFollowUp {
  key: string;
  clientId: string;          // '' for an old deal whose client isn't in the client list
  clientName: string;
  colour: ContactColour;
  lastTouch: TimelineEntry | null;
  dealLabel: string;         // the deal's programme, for deal follow-ups
  note: string;              // the latest note (deal) or what happened (touch point)
}
export interface QuietClient { client: any; summary: ClientSummary }

export function teamFollowUps(clients: any[], all: Parameters<typeof summariseClient>[1], nameOf: (id: string) => string, today: string, limits: ContactLimits): {
  items: TeamFollowUp[]; quiet: QuietClient[];
} {
  const items: TeamFollowUp[] = [];
  const quiet: QuietClient[] = [];
  const covered = new Set<string>();
  const label = (p: any) => (p ? p.courseName || (p.enquiryNote ? `Asked for: ${p.enquiryNote}` : 'Deal') : '');
  clients.forEach(c => {
    const s = summariseClient(c, all, nameOf, today, limits);
    clientDeals(c, all.deals).forEach(p => covered.add(p.id));
    s.followUps.forEach(f => {
      const deal = f.dealId ? all.deals.find(p => p.id === f.dealId) : null;
      const tp = f.touchPointId ? all.touchPoints.find(t => t.id === f.touchPointId) : null;
      items.push({
        ...f, key: f.dealId ? `d_${f.dealId}` : `t_${f.touchPointId}`, clientId: c.id, clientName: c.companyName || 'Client',
        colour: s.colour, lastTouch: s.last, dealLabel: label(deal),
        note: deal ? (followUpNotes(deal)[0]?.text || '') : (tp?.text || ''),
      });
    });
    if ((s.colour === 'red' || s.colour === 'never') && s.followUps.length === 0) quiet.push({ client: c, summary: s });
  });
  // Old deals whose client isn't in the client list still have follow-ups.
  all.deals.forEach(p => {
    const d = ymd(p.followUpDate);
    if (covered.has(p.id) || !d || !OPEN_STAGES.includes(dealStage(p)) || p.deleted) return;
    const by = followUpByOf(p);
    items.push({
      date: d, byId: by, byName: nameOf(by), dealId: p.id, key: `d_${p.id}`, clientId: '', clientName: p.client || 'No client',
      colour: 'never', lastTouch: null, dealLabel: label(p), note: followUpNotes(p)[0]?.text || '',
    });
  });
  items.sort((a, b) => a.date.localeCompare(b.date) || a.clientName.localeCompare(b.clientName));
  quiet.sort((a, b) => (a.summary.last?.date || '0000').localeCompare(b.summary.last?.date || '0000') || String(a.client.companyName).localeCompare(String(b.client.companyName)));
  return { items, quiet };
}
