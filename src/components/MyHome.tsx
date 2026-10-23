import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import {
  AlertTriangle, Briefcase, CalendarDays, ChevronLeft, ChevronRight, ClipboardCheck, GripVertical, LayoutGrid, Loader2, Plus, RotateCcw, ShieldCheck, Users, X,
  BarChart3, TrendingUp, FileText, BookOpen, Building2, GraduationCap, MapPin, ListTodo, ListChecks, Wallet, Layers, ListOrdered, DatabaseBackup, LineChart, PieChart, UserCog, Wrench, PartyPopper,
} from 'lucide-react';
import GridLayout, { WidthProvider } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { db, friendlyError } from '../lib/firebase';
import { CalendarEvent, Representative } from '../types';
import {
  OPEN_STAGES, STAGE_LABELS, DealStage, journeyStage, dealOwnerId, dealStage, dealValue, dealWonDate, formatDate, formatRM, todayIso,
} from '../lib/deals';
import { closingMetric, countAuto, monthKpi, kpiHex, kpiValueText, KpiSources, LIGHT_BADGE, rowBarClass } from '../lib/kpi';
import { LIGHT_LABELS } from '../lib/kpiLibrary';
import { useKpiSources } from '../lib/useKpiSources';
import { periodFor } from '../lib/salesTarget';
import { useSalesTarget } from '../lib/useSalesTarget';
import SalesProjection from './SalesProjection';
import { checklistFlags, daysUntil, grantNotAppliedFlag, isCoTrainer, progress, Flag } from '../lib/checklist';
import { HrdcQuery, isQueryOpen, isQueryOverdue, programmeStatus } from '../lib/programmes';
import { MoneyIn, MoneyOut, canDecide, dateTimeMY, isCompanyPayment, isPaid, isPayable, moneyFlags, prePaymentFlags, recentlyApproved } from '../lib/money';
import { TrainerJob, claimFlag, jobId } from '../lib/trainerPortal';
import { KIND_TEXT, canDecideChange, changeFlagText, changeSummary, pendingChange } from '../lib/trainingChange';
import { projectRow } from '../lib/projectPL';
import { useChecklistSettings } from './DealChecklist';
import { useMoneySettings } from './Money';
import { useReceipts } from './PaymentReceipts';
import { useClaimBacks } from './ClaimBacks';
import { ClaimBack } from '../lib/onBehalf';
import { Receipt, postTraining, postTrainingFlags } from '../lib/postTraining';
import { MODE_LABELS, apptLateDays, apptOf, apptOverdue, apptTime } from '../lib/appointments';
import { alertText, followUpAlert } from '../lib/followUps';
import { activeHold, holdDue, holdText } from '../lib/dealHold';
import FollowUpAlerts from './FollowUpAlerts';
import { TeamFollowUpsSummary } from './TeamFollowUps';
import { SharedItem, SharedKind, useSharedInbox } from '../lib/sharedInbox';
import { clientDeals, clientQuotes, clientTimeline, touchFollowUpOpen } from '../lib/touchPoints';
import { useTouchPoints } from '../lib/useClientHistory';
import { linkedOnly, withoutDeleted } from '../lib/linked';
import { DOC_NOUN, DocLink, openedText } from '../lib/docLinks';
import ProposalActivity from './ProposalActivity';
import { useProposalSettings } from '../lib/useProposalSettings';
import { seesLink } from '../lib/proposalTracking';

type Role = 'rep' | 'admin' | 'management';
type Viewer = { id: string; name: string; role: Role };

// ---------- Card library ----------
// Each person picks their own cards (saved in user_prefs/{their id}). Roles limit what can be picked.
type CardId =
  | 'follow_up_alerts' | 'team_follow_ups'
  | 'follow_ups' | 'my_kpi' | 'my_won' | 'next14' | 'new_won' | 'due_now' | 'money_jobs'
  | 'approvals' | 'money_position' | 'pipeline' | 'programmes_waiting' | 'notices' | 'team_appointments' | 'shared_with_me' | 'proposal_activity'
  | 'post_training' | 'sales_projection';

const CARDS: { id: CardId; title: string; roles: Role[] }[] = [
  { id: 'follow_ups', title: 'My follow-ups', roles: ['rep', 'admin', 'management'] },
  { id: 'my_kpi', title: 'My KPI this month', roles: ['rep', 'admin'] },
  { id: 'my_won', title: 'My won deals', roles: ['rep', 'admin'] },
  { id: 'sales_projection', title: 'Sales projection', roles: ['rep', 'admin', 'management'] },   // Hot / Warm / Cold x expected month (2026-10-21)
  { id: 'next14', title: 'Trainings in the next 14 days', roles: ['rep', 'admin', 'management'] },
  { id: 'new_won', title: 'New won deals', roles: ['admin', 'management'] },
  { id: 'post_training', title: 'After training', roles: ['admin', 'management'] },   // trainings that ended, until the case is closed (2026-10-20)
  { id: 'due_now', title: 'Due now', roles: ['admin', 'management'] },
  { id: 'money_jobs', title: 'Money jobs', roles: ['admin', 'management'] },
  { id: 'approvals', title: 'Waiting for my approval', roles: ['management'] },
  { id: 'money_position', title: 'Money position', roles: ['management'] },
  { id: 'pipeline', title: 'Pipeline and stuck deals', roles: ['management'] },
  { id: 'follow_up_alerts', title: 'Follow-up alerts', roles: ['management'] },
  { id: 'team_follow_ups', title: 'Team follow-ups', roles: ['management'] },
  { id: 'team_appointments', title: 'Team appointments this week', roles: ['admin', 'management'] },
  { id: 'shared_with_me', title: 'Shared with me', roles: ['rep', 'admin', 'management'] },   // needs a workspace (where the files open)
  { id: 'proposal_activity', title: 'Client link activity', roles: ['rep', 'admin', 'management'] },   // client links (push B; every kind since 2026-10-20)
  { id: 'programmes_waiting', title: 'Programmes waiting on HRDC', roles: ['admin', 'management'] },
  { id: 'notices', title: 'Notices', roles: ['rep', 'admin', 'management'] },
];

// Notices are off by default (Joel removed the newsfeed); anyone can switch the card back on.
const DEFAULT_CARDS: Record<Role, CardId[]> = {
  rep: ['follow_ups', 'proposal_activity', 'my_kpi', 'sales_projection', 'next14', 'my_won'],
  admin: ['shared_with_me', 'post_training', 'proposal_activity', 'new_won', 'due_now', 'money_jobs', 'next14'],
  management: ['team_follow_ups', 'approvals', 'post_training', 'proposal_activity', 'follow_up_alerts', 'money_position', 'pipeline', 'sales_projection', 'team_appointments', 'next14'],
};

// ---------- Shortcut library (Joel, 2026-10-17) ----------
// Each person picks and orders their own shortcut buttons (user_prefs/{id}.homeShortcuts). What is offered
// follows their role: own-workspace pages for anyone with a workspace (reps, admins, Management with a KPI set),
// Admin work pages for Admin and Management, Management pages for Management. A saved shortcut the person
// is no longer allowed is never shown, and every screen still checks the role itself when opened.
type ShortcutId =
  | 'workspace' | 'ws_kpi' | 'ws_deals' | 'ws_quotes' | 'ws_outlines' | 'ws_teambuilding' | 'ws_clients' | 'ws_trainers' | 'ws_venues' | 'ws_todo'
  | 'calendar' | 'admin_work' | 'aw_queue' | 'aw_money' | 'aw_programmes' | 'aw_tasks' | 'aw_backup'
  | 'management' | 'mg_dashboard' | 'mg_pl' | 'mg_team' | 'mg_data';
type Need = 'workspace' | 'all' | 'staff' | 'management';
const SHORTCUTS: { id: ShortcutId; label: string; icon: React.ComponentType<{ className?: string }>; need: Need; tab?: string; view?: string }[] = [
  { id: 'workspace', label: 'My workspace', icon: Briefcase, need: 'workspace' },
  { id: 'ws_kpi', label: 'My KPI', icon: BarChart3, need: 'workspace', tab: 'kpi' },
  { id: 'ws_deals', label: 'My deals', icon: TrendingUp, need: 'workspace', tab: 'pipeline' },
  { id: 'ws_quotes', label: 'Quotations', icon: FileText, need: 'workspace', tab: 'quotation' },
  { id: 'ws_outlines', label: 'Course outlines', icon: BookOpen, need: 'workspace', tab: 'course_outline' },
  { id: 'ws_teambuilding', label: 'Teambuilding proposal', icon: PartyPopper, need: 'workspace', tab: 'teambuilding' },
  { id: 'ws_clients', label: 'Clients', icon: Building2, need: 'workspace', tab: 'client' },
  { id: 'ws_trainers', label: 'Trainers', icon: GraduationCap, need: 'workspace', tab: 'trainerList' },
  { id: 'ws_venues', label: 'Venues', icon: MapPin, need: 'workspace', tab: 'venue' },
  { id: 'ws_todo', label: 'To-do', icon: ListTodo, need: 'workspace', tab: 'tasks' },
  { id: 'admin_work', label: 'Admin work', icon: ClipboardCheck, need: 'staff' },
  { id: 'aw_queue', label: 'Work queue', icon: ListChecks, need: 'staff', view: 'queue' },
  { id: 'aw_money', label: 'Money', icon: Wallet, need: 'staff', view: 'money' },
  { id: 'aw_programmes', label: 'Programmes', icon: Layers, need: 'staff', view: 'programmes' },
  { id: 'aw_tasks', label: 'Checklist tasks', icon: ListOrdered, need: 'staff', view: 'tasks' },
  { id: 'aw_backup', label: 'Backup', icon: DatabaseBackup, need: 'staff', view: 'backup' },
  { id: 'mg_dashboard', label: 'Team performance', icon: LineChart, need: 'management', view: 'dashboard' },
  { id: 'mg_pl', label: 'Project P&L', icon: PieChart, need: 'management', view: 'pl' },
  { id: 'mg_team', label: 'Team', icon: UserCog, need: 'management', view: 'team' },
  { id: 'mg_data', label: 'Data tools', icon: Wrench, need: 'management', view: 'data' },
];
// "Management" and "Full calendar" were removed as duplicates (Joel, 2026-10-17): the top bar has a Management
// tab, and the calendar card has "Add event / full calendar". Saved ones are simply no longer shown.
const DEFAULT_SHORTCUTS: ShortcutId[] = ['workspace', 'admin_work'];

const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';
const iconBtn = 'rounded-md p-1.5 text-ink-soft hover:bg-surface hover:text-ink disabled:opacity-30';

export interface MyHomeNav {
  openWorkspace: (repId: string, subTab?: string) => void;
  openAdminWork: (view?: 'queue' | 'money' | 'payments' | 'programmes' | 'tasks' | 'backup', dealId?: string) => void;
  openManagement: (view?: 'dashboard' | 'pl' | 'followups' | 'lost' | 'team' | 'data') => void;
  openFile?: (kind: SharedKind, id: string) => void;   // a shared quotation or outline, straight in the editor
  openClient?: (clientId: string) => void;             // a client's page (client touch point follow-ups)
  openTeamFollowUps?: (personId?: string) => void;     // Management → Team follow-ups (one person, or '__quiet')
  openDeal?: (deal: any) => void;                      // the deal's own panel in its owner's workspace
}

export default function MyHome({ viewer, people, representatives, workspaces, deals, events, calendar, notices, nav }: {
  viewer: Viewer;
  people: { id: string; name: string; role: Role; active: boolean }[];   // the Team list
  representatives: Representative[];   // people with KPIs (reps, admins, Management with a KPI set)
  workspaces?: Representative[];       // people with a workspace: the above plus Management without KPIs
  deals: any[];
  events: CalendarEvent[];
  calendar: React.ReactNode;   // the full calendar (adding events, Google sync)
  notices: React.ReactNode;
  nav: MyHomeNav;
}) {
  const staff = viewer.role !== 'rep';
  const today = todayIso();
  const checklistSettings = useChecklistSettings();
  const moneySettings = useMoneySettings();
  const [showFullCalendar, setShowFullCalendar] = useState(false);
  const [checklists, setChecklists] = useState<Record<string, any>>({});
  const [queries, setQueries] = useState<HrdcQuery[]>([]);
  const [moneyIn, setMoneyIn] = useState<MoneyIn[]>([]);
  const [venues, setVenues] = useState<any[]>([]);
  const [moneyOut, setMoneyOut] = useState<MoneyOut[]>([]);
  const [programmes, setProgrammes] = useState<any[]>([]);
  const receipts = useReceipts(staff);   // payment receipts, for the After training card
  const claims = useClaimBacks(staff);   // paid on behalf of the client, to claim back (2026-10-22)
  const [clients, setClients] = useState<any[]>([]);
  const [quotes, setQuotes] = useState<any[]>([]);
  const [plDocs, setPlDocs] = useState<Record<string, any>>({});
  const [trainerJobs, setTrainerJobs] = useState<TrainerJob[]>([]);
  const [reportsToCheck, setReportsToCheck] = useState<string[]>([]);   // deal ids whose training report the trainer sent, not checked yet
  const touchPoints = useTouchPoints();
  const [savedCards, setSavedCards] = useState<CardId[] | null>(null);
  const [savedShortcuts, setSavedShortcuts] = useState<ShortcutId[] | null>(null);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [customising, setCustomising] = useState(false);
  const [prefsError, setPrefsError] = useState('');
  const [savedLayout, setSavedLayout] = useState<Cell[] | null>(null);
  const wide = useWide();
  const [teammate, setTeammate] = useState('');
  const [docLinks, setDocLinks] = useState<DocLink[]>([]);   // client links, to say when a client opened one
  const trackingSettings = useProposalSettings();   // client opens: only Management and the people Management ticked (own deals)

  useEffect(() => {
    const subs = [
      onSnapshot(query(collection(db, 'deal_checklists')), s => setChecklists(Object.fromEntries(s.docs.map(d => [d.id, d.data()])))),
      onSnapshot(query(collection(db, 'hrdc_queries')), s => setQueries(withoutDeleted(s.docs.map(d => ({ ...(d.data() as HrdcQuery), id: d.id }))))),
      onSnapshot(query(collection(db, 'money_in')), s => setMoneyIn(withoutDeleted(s.docs.map(d => ({ ...(d.data() as MoneyIn), id: d.id }))))),
      onSnapshot(query(collection(db, 'venues_directory')), s => setVenues(s.docs.map(d => ({ ...d.data(), id: d.id })))),
      onSnapshot(query(collection(db, 'clients')), s => setClients(s.docs.map(d => ({ ...d.data(), id: d.id })))),
      onSnapshot(query(collection(db, 'doc_links')), s => setDocLinks(s.docs.map(d => ({ ...(d.data() as any), token: d.id }))), () => {}),
      onSnapshot(query(collection(db, 'quotations')), s => setQuotes(linkedOnly(s.docs.map(d => ({ ...d.data(), id: d.id })))), () => {}),
      onSnapshot(doc(db, 'user_prefs', viewer.id), s => {
        const c = s.data()?.homeCards, l = s.data()?.homeLayout, sc = s.data()?.homeShortcuts;
        // Admin people who arranged their own cards before "Shared with me" existed get it once, at the top
        // (Joel, 2026-10-18). After that it's theirs to keep or remove.
        if (viewer.role === 'admin' && Array.isArray(c) && !c.includes('shared_with_me') && !s.data()?.sharedCardAdded) {
          const cells = (Array.isArray(l) ? l : []).map((x: Cell) => ({ ...x, y: (Number(x.y) || 0) + DEFAULT_H }));
          setDoc(doc(db, 'user_prefs', viewer.id), {
            homeCards: ['shared_with_me', ...c], homeLayout: [{ i: 'shared_with_me', x: 0, y: 0, w: COLS / 2, h: DEFAULT_H }, ...cells], sharedCardAdded: true,
          }, { merge: true }).catch(() => { /* tried again next time */ });
        }
        // Management people who arranged their own cards before "Follow-up alerts" existed get it once, at the top
        // (Joel, 2026-10-18). After that it's theirs to keep or remove.
        if (viewer.role === 'management' && Array.isArray(c) && !c.includes('follow_up_alerts') && !s.data()?.followUpCardAdded) {
          const cells = (Array.isArray(l) ? l : []).map((x: Cell) => ({ ...x, y: (Number(x.y) || 0) + DEFAULT_H }));
          setDoc(doc(db, 'user_prefs', viewer.id), {
            homeCards: ['follow_up_alerts', ...c], homeLayout: [{ i: 'follow_up_alerts', x: 0, y: 0, w: COLS / 2, h: DEFAULT_H }, ...cells], followUpCardAdded: true,
          }, { merge: true }).catch(() => { /* tried again next time */ });
        }
        // Management people who arranged their own cards before "Team follow-ups" existed get it once, at the top
        // (Joel, 2026-10-18). After that it's theirs to keep or remove.
        // Waits until the Follow-up alerts card above has been added, so the two writes never overwrite each other.
        if (viewer.role === 'management' && Array.isArray(c) && !c.includes('team_follow_ups') && !s.data()?.teamFollowUpsCardAdded
          && (c.includes('follow_up_alerts') || s.data()?.followUpCardAdded)) {
          const cells = (Array.isArray(l) ? l : []).map((x: Cell) => ({ ...x, y: (Number(x.y) || 0) + DEFAULT_H }));
          setDoc(doc(db, 'user_prefs', viewer.id), {
            homeCards: ['team_follow_ups', ...c], homeLayout: [{ i: 'team_follow_ups', x: 0, y: 0, w: COLS / 2, h: DEFAULT_H }, ...cells], teamFollowUpsCardAdded: true,
          }, { merge: true }).catch(() => { /* tried again next time */ });
        }
        // Everyone who arranged their own cards before "Proposal activity" existed gets it once, at the top (push B,
        // 2026-10-19). It waits for the one-time cards above, so two writes never overwrite each other.
        const othersDone = viewer.role === 'admin' ? (c || []).includes('shared_with_me') || !!s.data()?.sharedCardAdded
          : viewer.role === 'management' ? ((c || []).includes('team_follow_ups') || !!s.data()?.teamFollowUpsCardAdded) && ((c || []).includes('follow_up_alerts') || !!s.data()?.followUpCardAdded)
          : true;
        if (Array.isArray(c) && !c.includes('proposal_activity') && !s.data()?.proposalCardAdded && othersDone) {
          const cells = (Array.isArray(l) ? l : []).map((x: Cell) => ({ ...x, y: (Number(x.y) || 0) + DEFAULT_H }));
          setDoc(doc(db, 'user_prefs', viewer.id), {
            homeCards: ['proposal_activity', ...c], homeLayout: [{ i: 'proposal_activity', x: 0, y: 0, w: COLS / 2, h: DEFAULT_H }, ...cells], proposalCardAdded: true,
          }, { merge: true }).catch(() => { /* tried again next time */ });
        }
        // Admin and Management who arranged their own cards before "After training" existed get it once, at the top
        // (2026-10-20: the notice to start post-training). It waits for the Client link activity card above.
        if (staff && Array.isArray(c) && !c.includes('post_training') && !s.data()?.postTrainingCardAdded && othersDone
          && (c.includes('proposal_activity') || !!s.data()?.proposalCardAdded)) {
          const cells = (Array.isArray(l) ? l : []).map((x: Cell) => ({ ...x, y: (Number(x.y) || 0) + DEFAULT_H }));
          setDoc(doc(db, 'user_prefs', viewer.id), {
            homeCards: ['post_training', ...c], homeLayout: [{ i: 'post_training', x: 0, y: 0, w: COLS / 2, h: DEFAULT_H }, ...cells], postTrainingCardAdded: true,
          }, { merge: true }).catch(() => { /* tried again next time */ });
        }
        setSavedCards(Array.isArray(c) ? c : null);
        setSavedShortcuts(Array.isArray(sc) ? sc : null);
        setSavedLayout(Array.isArray(l) ? l : null);
        setPrefsLoaded(true);
      }, () => setPrefsLoaded(true)),
    ];
    // Payouts and programme admin are for Admin and Management only.
    if (staff) {
      subs.push(onSnapshot(query(collection(db, 'money_out')), s => setMoneyOut(withoutDeleted(s.docs.map(d => ({ ...(d.data() as MoneyOut), id: d.id }))))));
      subs.push(onSnapshot(query(collection(db, 'programmes')), s => setProgrammes(s.docs.map(d => ({ ...d.data(), id: d.id })))));
      // Trainer fee requests from the portal, as a notification (2026-10-21).
      subs.push(onSnapshot(query(collection(db, 'trainer_jobs')), s => setTrainerJobs(s.docs.map(d => ({ ...(d.data() as TrainerJob), id: d.id }))), () => setTrainerJobs([])));
      // Training reports sent by the trainer and waiting to be checked (full deal test, 2026-10-23).
      subs.push(onSnapshot(query(collection(db, 'training_reports'), where('status', '==', 'submitted')), s => setReportsToCheck(s.docs.map(d => d.id)), () => setReportsToCheck([])));
    }
    // SST typed in Project P&L, for the Money position card's profit (Management only).
    if (viewer.role === 'management') {
      subs.push(onSnapshot(query(collection(db, 'project_pl')), s => setPlDocs(Object.fromEntries(s.docs.map(d => [d.id, d.data()]))), () => setPlDocs({})));
    }
    return () => subs.forEach(u => u());
  }, [viewer.id, staff]);

  const hasWorkspace = (id: string) => (workspaces || representatives).some(r => r.id === id);
  const hasKpis = (id: string) => representatives.some(r => r.id === id);
  // Management with a KPI set (e.g. Ying) can also have the personal KPI cards.
  const allowed = CARDS.filter(c => (c.roles.includes(viewer.role)
    || (viewer.role === 'management' && hasKpis(viewer.id) && (c.id === 'my_kpi' || c.id === 'my_won')))
    && (c.id !== 'shared_with_me' || (hasWorkspace(viewer.id) && !!nav.openFile)));
  const shared = useSharedInbox(hasWorkspace(viewer.id) ? viewer.id : undefined).items;

  // Shortcuts: only the ones this person's role allows, whatever was saved.
  const mayUse = (need: Need) => need === 'all' || (need === 'workspace' ? hasWorkspace(viewer.id) : need === 'staff' ? staff : viewer.role === 'management');
  // My KPI only for people with KPIs (Management without a KPI set has a workspace but no KPI page).
  const allowedShortcuts = SHORTCUTS.filter(s => mayUse(s.need) && (s.id !== 'ws_kpi' || hasKpis(viewer.id)));
  const shortcuts: ShortcutId[] = (savedShortcuts || DEFAULT_SHORTCUTS).filter(id => allowedShortcuts.some(s => s.id === id));
  const saveShortcuts = async (next: ShortcutId[]) => {
    setSavedShortcuts(next);
    setPrefsError('');
    try {
      await setDoc(doc(db, 'user_prefs', viewer.id), { homeShortcuts: next, updatedAt: Date.now() }, { merge: true });
    } catch (err) {
      setPrefsError(friendlyError(err));
    }
  };
  const moveShortcut = (id: ShortcutId, by: number) => {
    const i = shortcuts.indexOf(id), j = i + by;
    if (i < 0 || j < 0 || j >= shortcuts.length) return;
    const next = [...shortcuts];
    [next[i], next[j]] = [next[j], next[i]];
    saveShortcuts(next);
  };
  const goShortcut = (s: typeof SHORTCUTS[number]) => {
    if (!mayUse(s.need)) return;
    if (s.need === 'workspace') return nav.openWorkspace(viewer.id, s.tab);
    if (s.need === 'staff') return nav.openAdminWork(s.view as any);
    if (s.need === 'management') return nav.openManagement(s.view as any);
  };
  const cards: CardId[] = (savedCards || DEFAULT_CARDS[viewer.role]).filter(id => allowed.some(c => c.id === id));

  // Card choice and layout are saved together on the person's own prefs (only they can read or write them).
  const layout = layoutFor(cards, savedLayout);
  const savePrefs = async (nextCards: CardId[], nextLayout: Cell[]) => {
    const cells = nextLayout.filter(c => nextCards.includes(c.i as CardId)).map(({ i, x, y, w, h }) => ({ i, x, y, w, h }));
    setSavedCards(nextCards);
    setSavedLayout(cells);
    setPrefsError('');
    try {
      await setDoc(doc(db, 'user_prefs', viewer.id), { homeCards: nextCards, homeLayout: cells, updatedAt: Date.now() }, { merge: true });
    } catch (err) {
      setPrefsError(friendlyError(err));
    }
  };
  // After a drag or resize: keep the new positions, and the card order (for phones) top to bottom, left to right.
  const onLayoutDone = (next: Cell[]) => savePrefs([...next].sort((a, b) => a.y - b.y || a.x - b.x).map(c => c.i as CardId), next);
  const addCard = (id: CardId) => savePrefs([...cards, id], layoutFor([...cards, id], layout));
  const removeCard = (id: CardId) => savePrefs(cards.filter(c => c !== id), layout.filter(c => c.i !== id));
  const resetLayout = () => savePrefs(DEFAULT_CARDS[viewer.role].filter(id => allowed.some(c => c.id === id)), layoutFor(DEFAULT_CARDS[viewer.role], null));

  const nameOf = (id: string) => people.find(p => p.id === id)?.name || 'Former team member';
  const clientName = (p: any) => clients.find(c => c.id === p.clientId)?.companyName || p.client || 'No client';
  // Management can open anyone's workspace; everyone else only their own (Admin goes to the work queue).
  // Every card opens the deal's own panel, not just the list (full deal test, 2026-10-23: a won deal isn't in
  // "Open deals", so the list alone looked empty).
  const openDeal = (p: any) => {
    const owner = dealOwnerId(p);
    if (owner === viewer.id || viewer.role === 'management') {
      if (nav.openDeal) return nav.openDeal(p);
      return nav.openWorkspace(hasWorkspace(owner) ? owner : viewer.id, 'pipeline');
    }
    if (viewer.role === 'admin') return nav.openAdminWork('queue', dealStage(p) === 'won' ? p.id : undefined);
  };

  const wonDeals = useMemo(() => deals.filter(p => dealStage(p) === 'won'), [deals]);
  const mine = (p: any) => dealOwnerId(p) === viewer.id;

  // Client touch points with "Follow-up by" me that nobody has followed up yet (Joel, 2026-10-18): due within
  // 7 days or overdue. One line per client (its soonest).
  const clientFollowUps = useMemo(() => {
    const out: { clientId: string; title: string; date: string; d: number }[] = [];
    clients.forEach(cl => {
      const tps = touchPoints.filter(t => t.clientId === cl.id);
      const minePending = tps.filter(t => t.followUpById === viewer.id && ymd(t.nextDate));
      if (!minePending.length) return;
      const entries = clientTimeline({
        deals: clientDeals(cl, deals), quotes: clientQuotes(cl, quotes, deals), outlines: [], files: [], touchPoints: tps, tasks: [], nameOf,
      });
      const open = minePending.filter(t => touchFollowUpOpen(t, entries)).sort((a, b) => ymd(a.nextDate).localeCompare(ymd(b.nextDate)))[0];
      if (!open) return;
      const d = daysUntil(ymd(open.nextDate), today) ?? 99;
      if (d <= 7) out.push({ clientId: cl.id, title: cl.companyName || 'Client', date: ymd(open.nextDate), d });
    });
    return out.sort((a, b) => a.d - b.d);
  }, [clients, touchPoints, deals, quotes, viewer.id, today, people]);

  // KPI sources for the My KPIs card (same counting as the KPI page).
  const kpiSources = useKpiSources({
    months: [`${MONTH_ABBR[Number(today.slice(5, 7)) - 1]}-${today.slice(2, 4)}`],
    people: representatives.filter(r => r.id === viewer.id),
  });

  const ctx: CardCtx = {
    kpiSources,
    viewer, today, deals, wonDeals, checklists, queries, moneyIn, moneyOut, receipts, claims, programmes, representatives, venues,
    checklistSettings, moneySettings, nameOf, clientName, openDeal, nav, mine, notices, shared, clientFollowUps,
    docLinks,
    openedLinks: docLinks.filter(l => seesLink(viewer, trackingSettings, l)),
    quotes, plDocs, trainerJobs, reportsToCheck,
  };

  return (
    <div className="space-y-6 font-sans text-ink">
      {/* Shortcuts: each person's own choice, limited to what their role can open */}
      <div className="flex flex-wrap items-center gap-2">
        {shortcuts.map((id, i) => {
          const s = SHORTCUTS.find(x => x.id === id)!;
          const Icon = s.icon;
          return customising ? (
            <span key={id} className="inline-flex items-center gap-0.5 rounded-lg border border-accent/40 bg-white py-1 pl-1 pr-1 text-sm font-semibold">
              <button type="button" className={iconBtn} disabled={i === 0} onClick={() => moveShortcut(id, -1)} aria-label={`Move ${s.label} left`}><ChevronLeft className="h-4 w-4" /></button>
              <Icon className="h-4 w-4 text-accent" /><span className="px-1">{s.label}</span>
              <button type="button" className={iconBtn} disabled={i === shortcuts.length - 1} onClick={() => moveShortcut(id, 1)} aria-label={`Move ${s.label} right`}><ChevronRight className="h-4 w-4" /></button>
              <button type="button" className={iconBtn} onClick={() => saveShortcuts(shortcuts.filter(x => x !== id))} aria-label={`Remove ${s.label}`}><X className="h-4 w-4" /></button>
            </span>
          ) : (
            <button key={id} type="button" className={btnSecondary} onClick={() => goShortcut(s)}><Icon className="h-4 w-4 text-accent" /> {s.label}</button>
          );
        })}
        {shortcuts.length === 0 && !customising && <span className="text-sm text-ink-soft">No shortcuts. Click Customise to add some.</span>}
        {viewer.role === 'management' && (
          <label className="flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-semibold">
            <Users className="h-4 w-4 text-accent" />
            <span className="sr-only">Open a teammate's workspace</span>
            <select value={teammate} onChange={e => { const id = e.target.value; setTeammate(''); if (id) nav.openWorkspace(id); }} className="bg-transparent font-semibold focus:outline-none">
              <option value="">Open a teammate's workspace…</option>
              {(workspaces || representatives).filter(r => r.id !== viewer.id).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
        )}
      </div>

      {/* 1. Calendar (small) and 2. Performance (one row) */}
      <div className="grid items-stretch gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <CompactCalendar events={events} today={today} showFull={showFullCalendar} onToggleFull={() => setShowFullCalendar(v => !v)} />
        <Performance viewer={viewer} representatives={representatives} deals={deals} today={today} nameOf={nameOf} clientName={clientName} />
      </div>

      {/* The full calendar opens full width under the calendar and Performance row (Joel, 2026-10-17) */}
      {showFullCalendar && <div>{calendar}</div>}

      {/* 3. My cards */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-xl font-bold">My cards</h2>
          <button type="button" className={btnSecondary} onClick={() => setCustomising(c => !c)}>
            <LayoutGrid className="h-4 w-4" /> {customising ? 'Done' : 'Customise'}
          </button>
        </div>
        {prefsError && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{prefsError}</p>}
        {customising && <EditBar hidden={allowed.filter(c => !cards.includes(c.id))} wide={wide} onAdd={addCard} onReset={() => { resetLayout(); saveShortcuts(DEFAULT_SHORTCUTS); }}
          hiddenShortcuts={allowedShortcuts.filter(s => !shortcuts.includes(s.id))} onAddShortcut={id => saveShortcuts([...shortcuts, id])} />}
        {!prefsLoaded ? (
          <p className="flex items-center gap-2 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading your cards…</p>
        ) : cards.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line p-6 text-center text-ink-soft">No cards chosen. Click Customise to add some.</p>
        ) : wide ? (
          // Computers: drag a card by its title and pull its right or bottom edge to resize (only while customising).
          <Grid
            className={customising ? 'home-grid editing' : 'home-grid'}
            layout={layout}
            cols={COLS}
            rowHeight={ROW_H}
            margin={[16, 16]}
            containerPadding={[0, 0]}
            isDraggable={customising}
            isResizable={customising}
            draggableHandle=".card-drag"
            resizeHandles={['e', 's', 'se']}
            compactType="vertical"
            onDragStop={l => onLayoutDone(l as Cell[])}
            onResizeStop={l => onLayoutDone(l as Cell[])}
          >
            {cards.map(id => <div key={id}><Card id={id} ctx={ctx} editing={customising} onRemove={() => removeCard(id)} /></div>)}
          </Grid>
        ) : (
          // Phones and narrow windows: cards stack in the chosen order (grid-cols-1 so a long line truncates instead of widening the page).
          <div className="grid grid-cols-1 gap-4">
            {cards.map(id => <Card key={id} id={id} ctx={ctx} editing={customising} onRemove={() => removeCard(id)} stacked />)}
          </div>
        )}
      </section>
    </div>
  );
}

// ---------- Customise (drag and resize, Joel 2026-10-17) ----------
// Cards sit on a 12-column grid. While customising, a card moves by its title bar and resizes by its
// right edge, bottom edge or corner (react-grid-layout). Each person's layout is saved in user_prefs.homeLayout.
type Cell = { i: string; x: number; y: number; w: number; h: number; minW?: number; minH?: number };
const COLS = 12;
const ROW_H = 40;
const DEFAULT_H = 7;
const Grid = WidthProvider(GridLayout);

// Saved positions where there are some; new cards go underneath, two to a row (Notices full width).
function layoutFor(cards: CardId[], saved: Cell[] | null): Cell[] {
  const out: Cell[] = [];
  cards.forEach(id => {
    const s = saved?.find(c => c.i === id);
    if (!s) return;
    const w = Math.min(COLS, Math.max(3, Number(s.w) || 6));
    out.push({ i: id, x: Math.min(COLS - w, Math.max(0, Number(s.x) || 0)), y: Math.max(0, Number(s.y) || 0), w, h: Math.max(4, Number(s.h) || DEFAULT_H) });
  });
  let y = out.reduce((m, c) => Math.max(m, c.y + c.h), 0);
  let x = 0;
  cards.forEach(id => {
    if (out.some(c => c.i === id)) return;
    const w = id === 'notices' ? COLS : COLS / 2;
    if (x + w > COLS) { x = 0; y += DEFAULT_H; }
    out.push({ i: id, x, y, w, h: DEFAULT_H });
    x += w;
    if (x >= COLS) { x = 0; y += DEFAULT_H; }
  });
  return out.map(c => ({ ...c, minW: 3, minH: 4 }));
}

// Dragging and resizing only on wide screens; narrower ones stack the cards.
function useWide(): boolean {
  const q = '(min-width: 1024px)';
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

function EditBar({ hidden, wide, onAdd, onReset, hiddenShortcuts, onAddShortcut }: {
  hidden: typeof CARDS; wide: boolean; onAdd: (id: CardId) => void; onReset: () => void;
  hiddenShortcuts: typeof SHORTCUTS; onAddShortcut: (id: ShortcutId) => void;
}) {
  return (
    <div className="space-y-3 rounded-2xl border border-accent/30 bg-accent-soft/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">Shortcuts at the top:</span>
        <span className="text-sm text-ink-soft">use the arrows to reorder, × to remove.</span>
        {hiddenShortcuts.length > 0 && <span className="text-sm font-semibold">Add a shortcut:</span>}
        {hiddenShortcuts.map(s => (
          <button key={s.id} type="button" onClick={() => onAddShortcut(s.id)} className="inline-flex items-center gap-1 rounded-full border border-line bg-white px-3 py-1 text-sm font-medium hover:bg-surface">
            <Plus className="h-3.5 w-3.5" />{s.label}
          </button>
        ))}
      </div>
      <p className="text-sm text-ink">
        {wide
          ? <>Drag a card by its <strong>title</strong> to move it. Pull its <strong>right or bottom edge</strong> (or the corner) to resize it. <strong>×</strong> removes it.</>
          : <>On a small screen cards stack in order. Use a computer to move and resize them. <strong>×</strong> removes a card.</>}
        {' '}Saved to your login; nobody else's page changes.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {hidden.length > 0 && <span className="text-sm font-semibold">Add a card:</span>}
        {hidden.map(c => (
          <button key={c.id} type="button" onClick={() => onAdd(c.id)} className="inline-flex items-center gap-1 rounded-full border border-line bg-white px-3 py-1 text-sm font-medium hover:bg-surface">
            <Plus className="h-3.5 w-3.5" />{c.title}
          </button>
        ))}
        <button type="button" onClick={() => { if (window.confirm('Go back to the standard cards, layout and shortcuts for your role?')) onReset(); }} className="ml-auto inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline">
          <RotateCcw className="h-3.5 w-3.5" /> Reset cards and shortcuts
        </button>
      </div>
    </div>
  );
}

// ---------- Performance rings ----------
// Outer (big) ring: sales won in the target period so far vs the period's target. The period and the
// company target are set by Management (lib/salesTarget.ts); not set = January to December, and the
// company target is the sum of each person's (monthly target x months).
// Inner (small) ring: sales won this month vs the monthly target.
function salesTarget(rep: Representative): number | null {
  return closingMetric(rep)?.targetVal ?? null;
}

function wonBetween(deals: any[], from: string, to: string, ownerId?: string): number {
  let t = 0;
  for (const p of deals) {
    if (ownerId && dealOwnerId(p) !== ownerId) continue;
    const d = dealWonDate(p);
    if (d && d >= from && d <= to) t += dealValue(p);
  }
  return t;
}

const MONTH_ABBR = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function Performance({ viewer, representatives, deals, today, nameOf, clientName }: {
  viewer: Viewer; representatives: Representative[]; deals: any[]; today: string; nameOf: (id: string) => string; clientName: (p: any) => string;
}) {
  const target = useSalesTarget();
  const period = periodFor(target, today);
  const monthStart = today.slice(0, 7) + '-01';
  const [showDeals, setShowDeals] = useState<string | null>(null);   // 'company' or a person's id
  const monthLabel = new Date(today + 'T00:00:00').toLocaleDateString('en-GB', { month: 'long' });
  const monthKey = `${MONTH_ABBR[Number(today.slice(5, 7)) - 1]}-${today.slice(2, 4)}`;

  const sellers = representatives.filter(r => salesTarget(r) !== null);
  const ringFor = (rep: Representative) => {
    const monthly = salesTarget(rep) || 0;
    return {
      yearValue: wonBetween(deals, period.start, period.upTo, rep.id), yearTarget: monthly * period.months,
      monthValue: countAuto('won', deals, rep.id, monthKey), monthTarget: monthly,
    };
  };
  const sumMonthly = sellers.reduce((t, r) => t + (salesTarget(r) || 0), 0);
  const company = {
    yearValue: wonBetween(deals, period.start, period.upTo), yearTarget: target ? target.total : sumMonthly * period.months,
    monthValue: wonBetween(deals, monthStart, today), monthTarget: target ? target.monthly : sumMonthly,
  };
  const me = representatives.find(r => r.id === viewer.id);
  const meRing = me && salesTarget(me) !== null ? ringFor(me) : null;
  // Reps see only their own ring; Admin and Management also see the company.
  const showCompany = viewer.role !== 'rep';

  // Main rings (Company and/or Me) are large with their figures beside them; Management also
  // gets a row of small rings, one per person, underneath.
  const main: { key: string; label: string; ring: Ring }[] = [];
  if (showCompany) main.push({ key: 'company', label: 'Company', ring: company });
  if (meRing) main.push({ key: viewer.id, label: 'Me', ring: meRing });
  const team = viewer.role === 'management' ? sellers.filter(r => r.id !== viewer.id).map(r => ({ key: r.id, label: r.name, ring: ringFor(r) })) : [];
  const tip = (label: string, ring: Ring) => `${label}\n${period.label}: ${formatRM(ring.yearValue)} of ${formatRM(ring.yearTarget)} (${pct(ring.yearValue, ring.yearTarget)}%)\n${monthLabel}: ${formatRM(ring.monthValue)} of ${formatRM(ring.monthTarget)} (${pct(ring.monthValue, ring.monthTarget)}%)`;

  return (
    <section className="flex h-full flex-col rounded-2xl border border-line bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-bold">Performance</h2>
        <span className="flex items-center gap-3 text-xs text-ink-soft">
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-[#0E6E62]" />Outer ring: {period.set ? period.label : `year ${today.slice(0, 4)}`}</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-[#5DB3A6]" />Inner ring: {monthLabel}</span>
        </span>
      </div>
      {main.length === 0 && team.length === 0 ? (
        <p className="mt-2 text-ink-soft">No sales target is set for you yet.</p>
      ) : (
        // Layout (Joel, 2026-10-17): the main rings (Company and/or Me) on the left with their figures beside
        // them, each person's rings at medium size on the right, wrapping onto more rows. Stacks on phones.
        <div className={`grid flex-1 items-stretch gap-4 pt-3 ${main.length > 0 && team.length > 0 ? 'lg:grid-cols-2' : ''}`}>
          {main.length > 0 && (
            <div className={`grid gap-3 ${main.length > 1 && team.length === 0 ? 'sm:grid-cols-2' : ''}`}>
              {main.map(({ key, label, ring }) => (
                <div key={key} className="flex items-center justify-center gap-5 rounded-xl bg-surface p-4" title={tip(label, ring)}>
                  <Rings ring={ring} size={main.length > 1 && team.length > 0 ? 120 : 148} monthLabel={monthLabel} />
                  <div className="min-w-0 space-y-2">
                    <p className="text-lg font-bold">{label}</p>
                    <div>
                      <p className="flex items-center gap-1.5 text-xs text-ink-soft"><span className="h-2 w-2 rounded-sm bg-[#0E6E62]" />{period.label}</p>
                      <p className="text-[15px]"><strong className="tabular-nums">{formatRM(ring.yearValue)}</strong> <span className="text-ink-soft">of {formatRM(ring.yearTarget)} · {pct(ring.yearValue, ring.yearTarget)}%</span></p>
                    </div>
                    <div>
                      <p className="flex items-center gap-1.5 text-xs text-ink-soft"><span className="h-2 w-2 rounded-sm bg-[#5DB3A6]" />{monthLabel}</p>
                      <p className="text-[15px]"><strong className="tabular-nums">{formatRM(ring.monthValue)}</strong> <span className="text-ink-soft">of {formatRM(ring.monthTarget)} · {pct(ring.monthValue, ring.monthTarget)}%</span></p>
                    </div>
                    <button type="button" onClick={() => setShowDeals(s => (s === key ? null : key))} className="text-sm font-semibold text-accent hover:underline">
                      {showDeals === key ? 'Hide the deals' : 'See the deals'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {team.length > 0 && (
            <div className="flex flex-col justify-center">
              <p className="mb-2 text-xs font-semibold text-ink-soft">Each person</p>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-3">
                {team.map(({ key, label, ring }) => (
                  <div key={key} className="flex flex-col items-center text-center" title={tip(label, ring)}>
                    <button type="button" onClick={() => setShowDeals(s => (s === key ? null : key))} aria-label={`See ${label}'s won deals`} className="rounded-full">
                      <Rings ring={ring} size={96} monthLabel={monthLabel} />
                    </button>
                    <span className="mt-1 w-full truncate text-sm font-semibold">{label}</span>
                    <span className="text-xs text-ink-soft">{monthLabel.slice(0, 3)} {pct(ring.monthValue, ring.monthTarget)}% · Year {pct(ring.yearValue, ring.yearTarget)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {showDeals && (
        <WonList
          title={showDeals === 'company' ? 'Company' : showDeals === viewer.id ? 'Me' : nameOf(showDeals)}
          deals={deals.filter(p => { const d = dealWonDate(p); return d && d >= period.start && d <= period.upTo && (showDeals === 'company' || dealOwnerId(p) === showDeals); })}
          periodLabel={period.label} monthStart={monthStart} sellerIds={new Set(sellers.map(r => r.id))}
          nameOf={nameOf} clientName={clientName} onClose={() => setShowDeals(null)}
        />
      )}
    </section>
  );
}

// The won deals behind a ring, so every figure can be traced (Joel, 2026-10-17).
function WonList({ title, deals, periodLabel, monthStart, sellerIds, nameOf, clientName, onClose }: {
  title: string; deals: any[]; periodLabel: string; monthStart: string; sellerIds: Set<string>;
  nameOf: (id: string) => string; clientName: (p: any) => string; onClose: () => void;
}) {
  const list = [...deals].sort((a, b) => dealWonDate(b).localeCompare(dealWonDate(a)));
  const total = list.reduce((t, p) => t + dealValue(p), 0);
  const month = list.filter(p => dealWonDate(p) >= monthStart).reduce((t, p) => t + dealValue(p), 0);
  return (
    <div className="mt-4 rounded-xl border border-line p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold">{title}: deals won, {periodLabel} so far</p>
        <button type="button" onClick={onClose} className="text-sm font-semibold text-accent hover:underline">Close</button>
      </div>
      {list.length === 0 ? <p className="mt-2 text-sm text-ink-soft">No deals won in this period yet.</p> : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[30rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-ink-soft">
                <th className="py-1.5 pr-3 font-semibold">Won on</th>
                <th className="py-1.5 pr-3 font-semibold">Client and programme</th>
                <th className="py-1.5 pr-3 font-semibold">Owner</th>
                <th className="py-1.5 text-right font-semibold">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.map(p => {
                const owner = dealOwnerId(p);
                return (
                  <tr key={p.id}>
                    <td className="whitespace-nowrap py-1.5 pr-3">{formatDate(dealWonDate(p))}{dealWonDate(p) >= monthStart && <span className="ml-1 rounded bg-accent-soft px-1 text-xs text-accent">this month</span>}</td>
                    <td className="py-1.5 pr-3">{clientName(p)} <span className="text-ink-soft">· {p.courseName || 'No programme'}</span></td>
                    <td className="py-1.5 pr-3">{nameOf(owner) || 'Unknown'}{!sellerIds.has(owner) && <span className="block text-xs text-ink-soft">no sales target, so not in anyone's ring</span>}</td>
                    <td className="whitespace-nowrap py-1.5 text-right tabular-nums">{formatRM(dealValue(p))}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-line font-semibold">
                <td className="py-1.5 pr-3" colSpan={3}>Total ({list.length} deal{list.length === 1 ? '' : 's'}) · this month {formatRM(month)}</td>
                <td className="whitespace-nowrap py-1.5 text-right tabular-nums">{formatRM(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

type Ring = { yearValue: number; yearTarget: number; monthValue: number; monthTarget: number };
const pct = (v: number, t: number) => (t > 0 ? Math.round((v / t) * 100) : 0);

function Rings({ ring, size, monthLabel = '' }: { ring: Ring; size: number; monthLabel?: string }) {
  const c = size / 2;
  const outerR = size * 0.41, outerW = size * 0.093, innerR = size * 0.27, innerW = size * 0.067;
  const arc = (r: number, frac: number) => {
    const len = 2 * Math.PI * r;
    return `${Math.max(0, Math.min(1, frac)) * len} ${len}`;
  };
  const yp = pct(ring.yearValue, ring.yearTarget);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Year ${yp}% of target, this month ${pct(ring.monthValue, ring.monthTarget)}% of target`}>
      <circle cx={c} cy={c} r={outerR} fill="none" stroke="#E2E5DE" strokeWidth={outerW} />
      {ring.yearValue > 0 && <circle cx={c} cy={c} r={outerR} fill="none" stroke={kpiHex(yp)} strokeWidth={outerW} strokeLinecap="round" strokeDasharray={arc(outerR, ring.yearTarget ? ring.yearValue / ring.yearTarget : 0)} transform={`rotate(-90 ${c} ${c})`} />}
      <circle cx={c} cy={c} r={innerR} fill="none" stroke="#E2E5DE" strokeWidth={innerW} />
      {ring.monthValue > 0 && <circle cx={c} cy={c} r={innerR} fill="none" stroke={kpiHex(pct(ring.monthValue, ring.monthTarget))} strokeWidth={innerW} strokeLinecap="round" strokeDasharray={arc(innerR, ring.monthTarget ? ring.monthValue / ring.monthTarget : 0)} transform={`rotate(-90 ${c} ${c})`} />}
      {/* Year % big in the middle; the month % small under it (Joel, 2026-10-17) */}
      <text x={c} y={c + size * (monthLabel ? 0.01 : 0.05)} textAnchor="middle" fill="#1C2B45" style={{ fontSize: size * 0.14, fontWeight: 700 }}>{yp}%</text>
      {monthLabel && (
        <text x={c} y={c + size * 0.13} textAnchor="middle" fill="#3E8F83" style={{ fontSize: Math.max(8, size * 0.07), fontWeight: 600 }}>{monthLabel.slice(0, 3)} {pct(ring.monthValue, ring.monthTarget)}%</text>
      )}
    </svg>
  );
}

// ---------- Small calendar ----------
// A small month grid. Days with events get a dot; pointing at (or tapping) a day shows its events.
// "Add event / full calendar" opens the full calendar with Google sync.
const DOW = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function CompactCalendar({ events, today, showFull, onToggleFull }: { events: CalendarEvent[]; today: string; showFull: boolean; onToggleFull: () => void }) {
  const [cursor, setCursor] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 }));
  const [hover, setHover] = useState<string | null>(null);
  const first = new Date(cursor.y, cursor.m, 1);
  const lead = (first.getDay() + 6) % 7;   // weeks start on Monday
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const iso = (d: number) => `${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const byDay = useMemo(() => {
    const m: Record<string, CalendarEvent[]> = {};
    events.forEach(e => { if (e.date) (m[e.date.slice(0, 10)] ||= []).push(e); });
    return m;
  }, [events]);
  const shift = (n: number) => setCursor(c => { const d = new Date(c.y, c.m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const hoverEvents = hover ? byDay[hover] || [] : [];

  return (
    <section className="rounded-2xl border border-line bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-bold"><CalendarDays className="h-4 w-4 text-accent" />{first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</h2>
        <span className="flex">
          <button type="button" className={iconBtn} onClick={() => shift(-1)} aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" className={iconBtn} onClick={() => shift(1)} aria-label="Next month"><ChevronRight className="h-4 w-4" /></button>
        </span>
      </div>
      <div className="mt-2 grid grid-cols-7 gap-0.5 text-center text-xs" onMouseLeave={() => setHover(null)}>
        {DOW.map(d => <span key={d} className="py-1 font-semibold text-ink-soft">{d}</span>)}
        {cells.map((d, i) => {
          if (d === null) return <span key={`b${i}`} />;
          const day = iso(d);
          const count = byDay[day]?.length || 0;
          const isToday = day === today;
          return (
            <button key={day} type="button" onMouseEnter={() => setHover(day)} onFocus={() => setHover(day)} onClick={() => setHover(h => (h === day ? null : day))}
              className={`relative flex h-8 items-center justify-center rounded-md text-sm ${isToday ? 'bg-accent font-bold text-white' : hover === day ? 'bg-surface' : 'hover:bg-surface'}`}
              aria-label={`${formatDate(day)}${count ? `, ${count} event${count === 1 ? '' : 's'}` : ''}`}>
              {d}
              {count > 0 && <span className={`absolute bottom-1 h-1 w-1 rounded-full ${isToday ? 'bg-white' : 'bg-accent'}`} />}
            </button>
          );
        })}
      </div>
      <div className="mt-2 min-h-[44px] rounded-lg bg-surface px-3 py-2 text-sm" aria-live="polite">
        {hover ? (
          <>
            <p className="font-semibold">{formatDate(hover)}</p>
            {hoverEvents.length === 0 ? <p className="text-ink-soft">No events</p> : hoverEvents.map(e => <p key={e.id} className="truncate text-ink-soft">{e.time ? `${e.time} · ` : ''}{e.title}{e.source === 'google' && <span className="ml-1 rounded bg-sky-50 px-1 text-[10px] font-semibold text-sky-700">Google</span>}</p>)}
          </>
        ) : <p className="text-ink-soft">Point at a date to see its events.</p>}
      </div>
      <button type="button" className="mt-2 text-sm font-semibold text-accent hover:underline" onClick={onToggleFull}>
        {showFull ? 'Hide full calendar' : 'Add event / full calendar'}
      </button>
    </section>
  );
}

// ---------- Cards ----------
type CardCtx = {
  kpiSources: KpiSources;
  viewer: Viewer; today: string; deals: any[]; wonDeals: any[]; checklists: Record<string, any>; queries: HrdcQuery[];
  moneyIn: MoneyIn[]; moneyOut: MoneyOut[]; receipts: Receipt[]; claims: ClaimBack[]; programmes: any[]; representatives: Representative[]; venues: any[];
  checklistSettings: any; moneySettings: any; nameOf: (id: string) => string; clientName: (p: any) => string;
  openDeal: (p: any) => void; nav: MyHomeNav; mine: (p: any) => boolean; notices: React.ReactNode;
  shared: SharedItem[];
  clientFollowUps: { clientId: string; title: string; date: string; d: number }[];
  docLinks: DocLink[];
  openedLinks: DocLink[];   // the links this person may see opens of
  quotes: any[]; plDocs: Record<string, any>;   // for the one P&L (SST from the quotation, or typed in Project P&L)
  trainerJobs: TrainerJob[];
  reportsToCheck: string[];
};

// Trainers who asked for their fee in the portal and aren't approved yet (Admin and Management's notification,
// 2026-10-21). taskId: the deal's Trainer step, so the fee lines waiting on it aren't listed twice.
// Co-trainers (2026-10-22) ask for their fee the same way, on their own step.
function feeRequestItems(c: CardCtx, deal: (p: any) => string): (Item & { dealId: string; taskId: string })[] {
  const out: (Item & { dealId: string; taskId: string })[] = [];
  c.wonDeals.forEach(p => {
    (c.checklists[p.id]?.tasks || []).filter((t: any) => t.kind === 'trainer' && t.trainerId).forEach((task: any) => {
      const flag = claimFlag(c.trainerJobs.find(j => j.id === jobId(p.id, task.trainerId)), c.moneyOut.filter(o => o.dealId === p.id && o.checklistTaskId === task.id), task.trainerName || 'The trainer');
      if (flag) out.push({
        key: `${p.id}_${task.id}_fee`, dealId: p.id, taskId: task.id, title: `${isCoTrainer(task) ? 'Co-trainer' : 'Trainer'} fee · ${deal(p)}`, level: 'attention',
        sub: flag, onClick: () => c.openDeal(p),
      });
    });
  });
  return out;
}

// Sales projection card: a person's own; Management picks the whole team or one person.
function ProjectionCard({ ctx, editing }: { ctx: CardCtx; editing: boolean }) {
  const target = useSalesTarget();
  const sellers = ctx.representatives.filter(r => salesTarget(r) !== null);
  const monthlyTargetFor = (who: string) => {
    if (who !== 'all') { const r = ctx.representatives.find(x => x.id === who); return r ? salesTarget(r) || 0 : 0; }
    return target ? target.monthly : sellers.reduce((t, r) => t + (salesTarget(r) || 0), 0);
  };
  return (
    <SalesProjection deals={ctx.deals} people={sellers.map(r => ({ id: r.id, name: r.name }))} viewer={ctx.viewer} today={ctx.today}
      monthlyTargetFor={monthlyTargetFor} onOpenDeal={editing ? undefined : ctx.openDeal} clientName={ctx.clientName} compact storeKey={`home:${ctx.viewer.id}`} />
  );
}

type Item = { key: string; title: string; sub?: string; level?: 'danger' | 'attention'; onClick?: () => void };

function Card({ id, ctx, editing, onRemove, stacked }: { id: CardId; ctx: CardCtx; editing: boolean; onRemove: () => void; stacked?: boolean; key?: string }) {
  const title = CARDS.find(c => c.id === id)?.title || '';
  // On the grid a card fills its cell and scrolls inside; stacked (phones) it is as tall as its content.
  const shell = `flex flex-col rounded-2xl border bg-white ${stacked ? '' : 'h-full'} ${editing ? 'border-dashed border-accent/60 shadow-sm' : 'border-line'}`;
  const titleBar = (badge?: React.ReactNode) => (
    <div className={`card-drag flex items-center justify-between gap-2 px-4 pt-3 ${editing && !stacked ? 'cursor-move select-none' : ''}`}>
      <h3 className="flex min-w-0 items-center gap-1.5 font-bold">
        {editing && !stacked && <GripVertical className="h-4 w-4 shrink-0 text-ink-soft" aria-hidden />}
        <span className="truncate">{title}</span>
      </h3>
      <span className="flex items-center gap-1">
        {badge}
        {editing && (
          <button type="button" onMouseDown={e => e.stopPropagation()} onClick={onRemove} className="rounded-md p-1 text-ink-soft hover:bg-danger-soft hover:text-danger" aria-label={`Remove ${title}`}>
            <X className="h-4 w-4" />
          </button>
        )}
      </span>
    </div>
  );
  if (id === 'follow_up_alerts') {
    return (
      <div className={shell}>
        {titleBar()}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 pt-2">
          <FollowUpAlerts deals={ctx.deals} nameOf={ctx.nameOf} clientName={ctx.clientName} onOpen={editing ? undefined : ctx.openDeal} compact />
        </div>
      </div>
    );
  }
  if (id === 'proposal_activity') {
    return (
      <div className={shell}>
        {titleBar()}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 pt-2">
          <ProposalActivity viewer={ctx.viewer} deals={ctx.deals} people={ctx.representatives.map(r => ({ id: r.id, name: r.name }))} nameOf={ctx.nameOf}
            clientName={ctx.clientName} onOpen={editing ? undefined : ctx.openDeal} />
        </div>
      </div>
    );
  }
  if (id === 'sales_projection') {
    return (
      <div className={shell}>
        {titleBar()}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 pt-2">
          <ProjectionCard ctx={ctx} editing={editing} />
        </div>
      </div>
    );
  }
  if (id === 'team_follow_ups') {
    return (
      <div className={shell}>
        {titleBar()}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 pt-2">
          <TeamFollowUpsSummary onOpenFull={editing ? undefined : ctx.nav.openTeamFollowUps} />
        </div>
      </div>
    );
  }
  if (id === 'notices') {
    return (
      <div className={shell}>
        {titleBar()}
        <div className="min-h-0 flex-1 overflow-y-auto p-3">{ctx.notices}</div>
      </div>
    );
  }
  const { items, empty, footer } = cardContent(id, ctx);
  const shown = stacked ? items.slice(0, 8) : items.slice(0, 40);
  return (
    <div className={shell}>
      {titleBar(items.length > 0 && <span className="rounded-md bg-surface px-2 py-0.5 text-xs font-semibold text-ink-soft">{items.length}</span>)}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 pt-2">
        {items.length === 0 ? <p className="text-[15px] text-ink-soft">{empty}</p> : (
          <ul className="divide-y divide-line">
            {shown.map(it => (
              <li key={it.key}>
                <button type="button" disabled={!it.onClick || editing} onClick={it.onClick} className="flex w-full items-start gap-2 py-2 text-left enabled:hover:bg-surface">
                  {it.level && <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${it.level === 'danger' ? 'text-danger' : 'text-attention'}`} />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{it.title}</span>
                    {it.sub && <span className={`block text-sm ${it.level === 'danger' ? 'text-danger' : it.level === 'attention' ? 'text-attention' : 'text-ink-soft'}`}>{it.sub}</span>}
                  </span>
                  {it.onClick && <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-ink-soft" />}
                </button>
              </li>
            ))}
          </ul>
        )}
        {items.length > shown.length && <p className="pt-2 text-sm text-ink-soft">and {items.length - shown.length} more</p>}
        {footer}
      </div>
    </div>
  );
}

const ymd = (v: any) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '');

function cardContent(id: CardId, c: CardCtx): { items: Item[]; empty: string; footer?: React.ReactNode } {
  const deal = (p: any) => `${c.clientName(p)} · ${p.courseName || 'No programme'}`;
  const staff = c.viewer.role !== 'rep';

  switch (id) {
    case 'follow_ups': {
      const appts: Item[] = c.deals
        .filter(p => c.mine(p) && apptOf(p)?.status === 'booked')
        .map(p => ({ p, a: apptOf(p)!, d: daysUntil(apptOf(p)!.date, c.today) ?? 99 }))
        .filter(x => x.d <= 7)
        .sort((a, b) => a.d - b.d)
        .map(({ p, a, d }) => ({
          key: `appt_${p.id}`, title: `Appointment: ${c.clientName(p)}`, onClick: () => c.openDeal(p),
          sub: apptOverdue(p, c.today) ? `Held ${formatDate(a.date)}? Log what happened` : d === 0 ? `Today${a.time ? `, ${apptTime(a.time)}` : ''} · ${MODE_LABELS[a.mode]}` : `${formatDate(a.date)}${a.time ? `, ${apptTime(a.time)}` : ''} · ${MODE_LABELS[a.mode]}`,
          level: apptOverdue(p, c.today) ? 'danger' as const : d <= 0 ? 'attention' as const : undefined,
        }));
      // My deals, and deals where I'm the one following up (Follow-up by, 2026-10-18).
      const soon = c.deals
        .filter(p => (c.mine(p) || p.followUpById === c.viewer.id) && OPEN_STAGES.includes(dealStage(p)) && ymd(p.followUpDate))
        .map(p => ({ p, d: daysUntil(ymd(p.followUpDate), c.today) ?? 99 }))
        .filter(x => x.d <= 7)
        .sort((a, b) => a.d - b.d);
      // Follow-up rules (Joel, 2026-10-18): "1st follow-up due" … "Decision needed" on my deals come first.
      const alerts: Item[] = c.deals
        .filter(p => c.mine(p) && OPEN_STAGES.includes(dealStage(p)))
        .map(p => ({ p, a: followUpAlert(p, c.today) }))
        .filter(x => x.a)
        .sort((x, y) => Number(y.a!.decision) - Number(x.a!.decision) || y.a!.daysInStage - x.a!.daysInStage)
        .map(({ p, a }) => ({ key: `fa_${p.id}`, title: c.clientName(p), onClick: () => c.openDeal(p), level: 'danger' as const, sub: alertText(a!) }));
      const alerted = new Set(alerts.map(x => x.key.slice(3)));
      const clientItems: Item[] = c.clientFollowUps.map(x => ({
        key: `cf_${x.clientId}`, title: x.title, onClick: c.nav.openClient ? () => c.nav.openClient!(x.clientId) : undefined,
        sub: x.d < 0 ? `Client follow-up overdue by ${-x.d} day${x.d === -1 ? '' : 's'}` : x.d === 0 ? 'Client follow-up today' : `Client follow-up ${formatDate(x.date)}`,
        level: x.d < 0 ? 'danger' as const : x.d === 0 ? 'attention' as const : undefined,
      }));
      // A client opened a link in the last 7 days and nobody has logged a follow-up since (2026-10-19): a good moment to
      // call. Only for Management and the people Management ticked (2026-10-20).
      const weekAgo = Date.now() - 7 * 864e5;
      const opened: Item[] = c.openedLinks
        .filter(l => l.status === 'open' && l.views && (l.lastViewedAt || 0) > weekAgo)
        .map(l => ({ l, p: c.deals.find(d => d.id === l.dealId) }))
        .filter(({ l, p }) => p && c.mine(p) && OPEN_STAGES.includes(dealStage(p))
          && !(p.followUps || []).some((n: any) => Date.parse(n.at || '') > (l.lastViewedAt || 0)))
        .sort((a, b) => (b.l.lastViewedAt || 0) - (a.l.lastViewedAt || 0))
        .map(({ l, p }) => ({
          key: `open_${l.token}`, title: c.clientName(p), onClick: () => c.openDeal(p), level: 'attention' as const,
          sub: `Opened your ${DOC_NOUN[l.kind] || 'document'} ${l.refNumber || ''}: ${openedText(l).replace(/^Opened /, '')}. A good time to follow up.`,
        }));
      // A client asked to open an expired link again (2026-10-19): only the team can reopen it.
      const docNoun = (k: DocLink['kind']) => DOC_NOUN[k] || 'document';
      const reopen: Item[] = c.docLinks
        .filter(l => l.status === 'open' && l.reopenRequest)
        .map(l => ({ l, p: c.deals.find(d => d.id === l.dealId) }))
        .filter(({ l, p }) => (p ? c.mine(p) : l.ownerId === c.viewer.id || l.byId === c.viewer.id))
        .sort((a, b) => (b.l.reopenRequest?.at || 0) - (a.l.reopenRequest?.at || 0))
        .map(({ l, p }) => ({
          key: `reopen_${l.token}`, title: p ? c.clientName(p) : l.company || 'Client', onClick: p ? () => c.openDeal(p) : undefined, level: 'danger' as const,
          sub: `${l.reopenRequest!.name} asked to open your ${docNoun(l.kind)} ${l.refNumber || ''} again${l.reopenRequest!.note ? `: "${l.reopenRequest!.note}"` : ''}. Reopen it from the ${docNoun(l.kind)}.`,
        }));
      return {
        items: [...alerts, ...reopen, ...opened, ...appts, ...clientItems, ...soon.filter(({ p }) => !alerted.has(p.id)).map(({ p, d }) => ({
          key: p.id, title: c.clientName(p), onClick: () => c.openDeal(p),
          // On hold (2026-10-19): the potential date is the follow-up date.
          sub: activeHold(p) ? (d <= 0 ? 'On hold date reached: resume, hold longer or mark lost' : holdText(p, c.today))
            : d < 0 ? `Overdue by ${-d} day${d === -1 ? '' : 's'} (${STAGE_LABELS[dealStage(p)]})` : d === 0 ? 'Follow up today' : `Follow up ${formatDate(ymd(p.followUpDate))}`,
          level: activeHold(p) && d <= 0 ? 'danger' : d < 0 ? 'danger' : d === 0 ? 'attention' : undefined,
        } as Item))],
        empty: 'No follow-ups or appointments in the next 7 days.',
      };
    }
    case 'my_kpi': {
      const me = c.representatives.find(r => r.id === c.viewer.id);
      if (!me) return { items: [], empty: 'You have no KPI set.' };
      const monthKey = `${MONTH_ABBR[Number(c.today.slice(5, 7)) - 1]}-${c.today.slice(2, 4)}`;
      // Same counting as the KPI page (lib/kpi.ts monthKpi).
      const rows = monthKpi(me, c.deals, monthKey, { ...c.kpiSources, people: c.representatives }).rows;
      return {
        items: [], empty: '',
        footer: (
          <ul className="space-y-3">
            {rows.map(row => (
              <li key={row.m.key}>
                <div className="flex justify-between gap-2 text-sm"><span className="font-semibold">{row.m.label}</span>
                  <span className="tabular-nums text-ink-soft">
                    {!row.hasData ? 'No data this month' : row.m.scoring === 'bands'
                      ? <>{kpiValueText(row.m, row.total, formatRM)} <span className={`ml-1 rounded-full px-1.5 py-0.5 text-xs font-bold ${LIGHT_BADGE[row.light]}`}>{LIGHT_LABELS[row.light]}</span></>
                      : `${kpiValueText(row.m, row.total, formatRM)} of ${kpiValueText(row.m, row.m.targetVal, formatRM)} (${row.pct}%)`}
                  </span></div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-line"><div className={`h-full rounded-full ${rowBarClass(row)}`} style={{ width: `${row.hasData ? Math.max(row.pct, 3) : 0}%` }} /></div>
              </li>
            ))}
            <li><button type="button" className="text-sm font-semibold text-accent hover:underline" onClick={() => c.nav.openWorkspace(c.viewer.id, 'kpi')}>Open my KPI page</button></li>
          </ul>
        ),
      };
    }
    case 'my_won': {
      const list = c.wonDeals
        .filter(p => c.mine(p) && (!ymd(p.trainingDate) || (daysUntil(ymd(p.trainingDate), c.today) ?? 0) >= -60))
        .sort((a, b) => (ymd(a.trainingDate) || '9999').localeCompare(ymd(b.trainingDate) || '9999'));
      return {
        items: list.map(p => {
          const cl = c.checklists[p.id];
          const pr = cl ? progress(cl.tasks, p.fundingType) : null;
          const ins = c.moneyIn.filter(m => m.dealId === p.id);
          const pay = ins.length === 0 ? 'not invoiced yet' : ins.every(isPaid) ? 'paid' : 'invoiced, waiting for payment';
          return { key: p.id, title: deal(p), onClick: () => c.openDeal(p), sub: `${ymd(p.trainingDate) ? `Training ${formatDate(ymd(p.trainingDate))}` : 'No training date'} · admin ${pr ? `${pr.done} of ${pr.total}` : 'not started'} · ${pay}` };
        }),
        empty: 'No recent won deals.',
      };
    }
    case 'next14': {
      const list = c.wonDeals
        .filter(p => (staff || c.mine(p)) && ymd(p.trainingDate))
        .map(p => ({ p, d: daysUntil(ymd(p.trainingDate), c.today) ?? -1 }))
        .filter(x => x.d >= 0 && x.d <= 14)
        .sort((a, b) => a.d - b.d);
      return {
        items: list.map(({ p, d }) => {
          const cl = c.checklists[p.id];
          const pr = cl ? progress(cl.tasks, p.fundingType) : null;
          const flags = cl ? checklistFlags(p, cl.tasks, c.checklistSettings, c.today, dealWonDate(p)).filter(f => f.level === 'danger') : [];
          return {
            key: p.id, title: deal(p), level: flags.length ? 'danger' as const : undefined,
            sub: `${d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : `In ${d} days`} (${formatDate(ymd(p.trainingDate))}) · ${pr ? `${pr.done} of ${pr.total} ready` : 'checklist not started'}${flags.length ? ` · ${flags[0].text}` : ''}`,
            onClick: staff ? () => c.nav.openAdminWork('queue') : () => c.openDeal(p),
          };
        }),
        empty: 'No trainings in the next 14 days.',
      };
    }
    case 'new_won': {
      const list = c.wonDeals
        .filter(p => { const w = dealWonDate(p); return w && (daysUntil(w, c.today) ?? -99) >= -7; })
        .sort((a, b) => dealWonDate(b).localeCompare(dealWonDate(a)));
      return {
        items: list.map(p => ({ key: p.id, title: deal(p), onClick: () => c.nav.openAdminWork('queue'), sub: `Won ${formatDate(dealWonDate(p))} by ${c.nameOf(dealOwnerId(p))} · ${formatRM(dealValue(p))}${c.checklists[p.id] ? '' : ' · checklist not started'}` })),
        empty: 'No deals won in the last 7 days.',
      };
    }
    case 'post_training': {
      // The notice to start post-training, the day after a training ends, and what's left until the case is closed.
      const items: (Item & { since: number })[] = [];
      c.wonDeals.forEach(p => {
        const cl = c.checklists[p.id];
        const ins = c.moneyIn.filter(m => m.dealId === p.id);
        const outs = c.moneyOut.filter(o => o.dealId === p.id);
        const rc = c.receipts.filter(r => r.dealId === p.id);
        const st = postTraining(p, cl?.tasks, ins, outs, rc, c.claims, c.today, c.moneySettings);
        if (!st.ended || st.closed) return;
        const flags = postTrainingFlags(p, cl?.tasks, ins, outs, rc, c.claims, c.moneySettings, c.today);
        const level = flags.some(f => f.level === 'danger') ? 'danger' as const : 'attention' as const;
        const since = st.daysSince || 0;
        items.push({
          key: p.id, title: deal(p), level, since, onClick: () => c.nav.openAdminWork('queue', p.id),
          sub: st.started ? `Ended ${since} day${since === 1 ? '' : 's'} ago · step ${Math.min(st.step, st.steps)} of ${st.steps}: ${st.next}${flags[0] && flags[0].level === 'danger' ? ` · ${flags[0].text}` : ''}`
            : flags[0]?.text || 'Training ended: start post-training',
        });
      });
      items.sort((a, b) => (a.level === b.level ? b.since - a.since : a.level === 'danger' ? -1 : 1));
      return { items, empty: 'No trainings waiting on post-training. Each one appears here the day after it ends.' };
    }
    case 'due_now': {
      const items: Item[] = [];
      // Change date / Cancel training (2026-10-21): waiting for Management, or still to update after approval.
      c.deals.filter(p => !p.deleted && changeFlagText(p)).forEach(p => items.push({
        key: `${p.id}_tc`, title: deal(p), level: pendingChange(p) ? 'attention' : 'danger', sub: changeFlagText(p), onClick: () => c.nav.openAdminWork('queue', p.id),
      }));
      c.wonDeals.forEach(p => {
        const cl = c.checklists[p.id];
        c.queries.filter(q => q.dealId === p.id && isQueryOpen(q)).forEach(q => items.push({
          key: q.id, title: deal(p), level: isQueryOverdue(q, c.today) ? 'danger' : 'attention', onClick: () => c.nav.openAdminWork('queue'),
          sub: `HRDC query ${isQueryOverdue(q, c.today) ? 'overdue' : 'open'}, reply by ${formatDate(q.replyBy)}`,
        }));
        if (!cl) {
          // No checklist yet: the grant can't have been applied.
          const g = grantNotAppliedFlag(p, undefined, c.checklistSettings, c.today, dealWonDate(p));
          if (g) items.push({ key: `${p.id}_g`, title: deal(p), level: g.level, sub: `${g.text} (checklist not started)`, onClick: () => c.nav.openAdminWork('queue') });
          return;
        }
        checklistFlags(p, cl.tasks, c.checklistSettings, c.today, dealWonDate(p)).forEach((f: Flag, i: number) => items.push({
          key: `${p.id}_${i}`, title: deal(p), level: f.level, sub: f.text, onClick: () => c.nav.openAdminWork('queue'),
        }));
      });
      items.sort((a, b) => (a.level === b.level ? 0 : a.level === 'danger' ? -1 : 1));
      return { items, empty: 'Nothing urgent. Every checklist and HRDC query is on track.' };
    }
    case 'money_jobs': {
      // Trainers asking for their fee in the portal (2026-10-21): Admin checks T3, photos and report first.
      const items: Item[] = [...feeRequestItems(c, deal)];
      // Training reports the trainer sent: Admin or Management checks them (this also unlocks the trainer fee).
      c.wonDeals.filter(p => c.reportsToCheck.includes(p.id)).forEach(p => items.push({
        key: `${p.id}_report`, title: `Training report to check · ${deal(p)}`, level: 'attention',
        sub: 'The trainer sent it. Check it, then click "Checked, ready for HR"', onClick: () => c.nav.openAdminWork('queue', p.id),
      }));
      // Before training only: invoicing a direct-pay client. From the day after the training it's in the After training card.
      c.wonDeals.forEach(p => {
        moneyFlags(p, c.moneyIn.filter(m => m.dealId === p.id), [], c.moneySettings, c.today).forEach((f, i) => items.push({
          key: `${p.id}_m${i}`, title: deal(p), level: f.level, sub: f.text, onClick: () => c.nav.openAdminWork('queue', p.id),
        }));
      });
      // Pre-training payments still unpaid as the training gets close (2026-10-21).
      c.wonDeals.forEach(p => prePaymentFlags(p, c.moneyOut, c.checklistSettings.flagDays, c.today).forEach((f, i) => items.push({
        key: `${p.id}_pp${i}`, title: deal(p), level: f.level, sub: f.text, onClick: () => c.nav.openAdminWork('queue', p.id),
      })));
      // Approved and payable, not on a payment summary yet: one line (accounts are sent a summary, 2026-10-21).
      const ready = c.moneyOut.filter(o => o.status === 'approved' && !o.summaryToken && isPayable(o, c.deals.find(d => d.id === o.dealId), c.today));
      if (ready.length) items.push({ key: 'ready_for_summary', title: `${ready.length} approved payment${ready.length === 1 ? '' : 's'} to send to accounts`, sub: `${formatRM(ready.reduce((t, o) => t + (Number(o.amount) || 0), 0))} · make a payment summary in Admin work → Money`, onClick: () => c.nav.openAdminWork('money') });
      c.moneyOut.filter(o => o.status === 'rejected' && !o.trainingCancelled && o.requestedById === c.viewer.id).forEach(o => items.push({ key: o.id, title: `Rejected: ${o.payee} ${formatRM(o.amount)}`, sub: o.rejectReason || 'See the reason and send a new request', level: 'attention', onClick: () => c.nav.openAdminWork('money') }));
      // The person who raised a request hears back when it's approved, for 3 days (Joel, 2026-10-23).
      recentlyApproved(c.moneyOut, c.viewer.id).forEach(o => items.push({ key: `${o.id}_ok`, title: `Approved: ${o.payee} ${formatRM(o.amount)}`, sub: `by ${o.decidedByName}, ${dateTimeMY(o.decidedAt)}`, onClick: () => c.nav.openAdminWork('money') }));
      items.sort((a, b) => (a.level === b.level ? 0 : a.level === 'danger' ? -1 : b.level === 'danger' ? 1 : a.level ? -1 : 1));
      return { items, empty: 'No money jobs waiting.' };
    }
    case 'approvals': {
      // Trainers asking for their fee (2026-10-21) replace their fee lines here: approved on the deal, after the checks.
      const fees = feeRequestItems(c, deal);
      const list = c.moneyOut.filter(o => canDecide(o, c.viewer) && !fees.some(f => f.dealId === o.dealId && f.taskId === o.checklistTaskId));
      // Training date changes and cancellations (2026-10-21) come first: nothing moves until they're decided.
      const changes = c.deals.filter(p => canDecideChange(pendingChange(p), c.viewer));
      return {
        items: [
          ...changes.map(p => {
            const tc = pendingChange(p)!;
            return { key: `${p.id}_tc`, title: `${KIND_TEXT[tc.kind]} · ${deal(p)}`, level: (tc.kind === 'cancel' ? 'danger' : 'attention') as Item['level'], sub: `${changeSummary(tc)} · asked by ${tc.byName}`, onClick: () => c.openDeal(p) };
          }),
          ...fees,
          ...list.map(o => {
            const p = c.deals.find(d => d.id === o.dealId);
            return { key: o.id, title: `${o.category} · ${o.payee} · ${formatRM(o.amount)}`, sub: `${isCompanyPayment(o) ? 'Company payment' : p ? deal(p) : 'Deal'} · raised by ${o.requestedByName}, ${dateTimeMY(o.resubmittedAt || o.requestedAt)}`, onClick: () => c.nav.openAdminWork('money') };
          }),
        ],
        empty: 'Nothing waiting for your approval.',
      };
    }
    case 'money_position': {
      let toComeIn = 0, overdue = 0, toPay = 0, waiting = 0, profitMonth = 0;
      const month = c.today.slice(0, 7);
      c.wonDeals.forEach(p => {
        const ins = c.moneyIn.filter(m => m.dealId === p.id);
        // The one P&L (projectRow, as in Project P&L and the deal): profit after SST, HRDC's %, commission and costs.
        const row = projectRow(p, ins, c.moneyOut, c.moneySettings, c.today, { quotes: c.quotes, plDocs: c.plDocs });
        if (!row.estimate) toComeIn += row.toComeIn;   // invoices and claims sent, not yet paid
        toPay += row.toPayOut; waiting += row.pendingApproval;
        if (ymd(p.trainingDate).startsWith(month)) profitMonth += row.profit;
        ins.filter(m => !isPaid(m) && ymd(m.invoiceDate) && -(daysUntil(ymd(m.invoiceDate), c.today) ?? 0) > c.moneySettings.overdueDays).forEach(() => { overdue++; });
      });
      // Company payments (not tied to a training) still need paying or approving.
      c.moneyOut.filter(isCompanyPayment).forEach(o => {
        if (o.status === 'approved') toPay += Number(o.amount) || 0;
        if (o.status === 'pending') waiting += Number(o.amount) || 0;
      });
      const tile = (label: string, value: string, tone?: string) => (
        <div className="rounded-xl bg-surface px-3 py-2.5"><p className="text-xs font-semibold text-ink-soft">{label}</p><p className={`text-lg font-bold tabular-nums ${tone || ''}`}>{value}</p></div>
      );
      return {
        items: [], empty: '',
        footer: (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {tile('Invoiced, not paid yet', formatRM(toComeIn))}
              {tile('Overdue invoices or claims', String(overdue), overdue ? 'text-danger' : '')}
              {tile('Approved, to pay', formatRM(toPay))}
              {tile('Waiting for approval', formatRM(waiting))}
            </div>
            <p className="text-sm text-ink-soft">Profit on trainings this month: <strong className={profitMonth < 0 ? 'text-danger' : 'text-ink'}>{formatRM(profitMonth)}</strong></p>
            <button type="button" className="text-sm font-semibold text-accent hover:underline" onClick={() => c.nav.openAdminWork('money')}>Open Money</button>
          </div>
        ),
      };
    }
    case 'pipeline': {
      const open = c.deals.filter(p => OPEN_STAGES.includes(dealStage(p)));
      const stuck = open.filter(p => {
        if (apptOverdue(p, c.today)) return true;
        if (activeHold(p)) return holdDue(p, c.today);
        if (followUpAlert(p, c.today)) return true;
        const fu = ymd(p.followUpDate);
        if (fu && fu < c.today) return true;
        const sent = ymd(p.proposalSentDate);
        if (dealStage(p) === 'quoted' && !fu && ymd(p.quotationSentDate) && (daysUntil(ymd(p.quotationSentDate), c.today) ?? 0) <= -7) return true;
        return dealStage(p) === 'proposal' && !fu && sent && (daysUntil(sent, c.today) ?? 0) <= -7;
      });
      // Won HRDC deals whose grant hasn't been applied (Joel, 2026-10-18).
      const grantStuck: Item[] = [];
      c.wonDeals.forEach(p => {
        const g = grantNotAppliedFlag(p, c.checklists[p.id]?.tasks, c.checklistSettings, c.today, dealWonDate(p));
        if (g) grantStuck.push({ key: `${p.id}_g`, title: c.clientName(p), level: g.level, onClick: () => c.openDeal(p), sub: `${c.nameOf(dealOwnerId(p))} · Won · ${g.text}` });
      });
      grantStuck.sort((a, b) => (a.level === b.level ? 0 : a.level === 'danger' ? -1 : 1));
      return {
        items: [...grantStuck, ...stuck.map(p => ({ key: p.id, title: c.clientName(p), level: 'attention' as const, onClick: () => c.openDeal(p), sub: `${c.nameOf(dealOwnerId(p))} · ${STAGE_LABELS[dealStage(p)]} · ${apptOverdue(p, c.today) ? `appointment on ${formatDate(apptOf(p)!.date)} not logged` : activeHold(p) ? holdText(p, c.today) : followUpAlert(p, c.today) ? alertText(followUpAlert(p, c.today)!) : ymd(p.followUpDate) ? `follow-up was due ${formatDate(ymd(p.followUpDate))}` : 'no follow-up set for 7+ days'}` }))],
        empty: 'No stuck deals.',
        footer: (
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-line pt-3 sm:grid-cols-4">
            {(['lead', 'proposal', 'agreed', 'quoted'] as DealStage[]).map(st => {
              const list = open.filter(p => journeyStage(dealStage(p)) === st);
              return <div key={st} className="rounded-xl bg-surface px-3 py-2"><p className="text-xs font-semibold text-ink-soft">{STAGE_LABELS[st]}</p><p className="font-bold">{list.length}</p><p className="text-xs text-ink-soft">{formatRM(list.reduce((t, p) => t + dealValue(p), 0))}</p></div>;
            })}
            {(() => {
              const held = open.filter(p => activeHold(p));
              return held.length > 0 && <p className="col-span-full text-sm text-attention">On hold: {held.length} deal{held.length === 1 ? '' : 's'}, {formatRM(held.reduce((t, p) => t + dealValue(p), 0))} (included above)</p>;
            })()}
          </div>
        ),
      };
    }
    case 'team_appointments': {
      const t = new Date(c.today + 'T00:00:00');
      const mon = new Date(t); mon.setDate(t.getDate() - ((t.getDay() + 6) % 7));
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
      const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const from = iso(mon), to = iso(sun);
      const list = c.deals
        .map(p => ({ p, a: apptOf(p) }))
        .filter(x => x.a && !x.a.legacy && x.a.date >= from && x.a.date <= to)
        .sort((x, y) => x.a!.date.localeCompare(y.a!.date));
      return {
        items: list.map(({ p, a }) => {
          const late = apptLateDays(a!);
          const held = a!.status === 'held';
          return {
            key: p.id, title: `${c.clientName(p)} · ${c.nameOf(dealOwnerId(p))}`, onClick: () => c.openDeal(p),
            level: apptOverdue(p, c.today) ? 'danger' as const : held && late > 3 ? 'attention' as const : undefined,
            sub: held
              ? `Held ${formatDate(a!.date)}${a!.outcome ? ` · ${a!.outcome}` : ''}${a!.nextStep ? ` · Next: ${a!.nextStep}` : ''}${late > 3 ? ` · logged ${late} days late` : ''}`
              : apptOverdue(p, c.today) ? `Booked ${formatDate(a!.date)}, not logged` : `Booked ${formatDate(a!.date)}${a!.time ? `, ${apptTime(a!.time)}` : ''} · ${MODE_LABELS[a!.mode]}`,
          };
        }),
        empty: 'No appointments this week.',
      };
    }
    case 'programmes_waiting': {
      const list = c.programmes.filter(p => programmeStatus(p) === 'submitted').sort((a, b) => String(a.submittedDate || '').localeCompare(String(b.submittedDate || '')));
      return {
        items: list.map(p => {
          const waited = ymd(p.submittedDate) ? -(daysUntil(ymd(p.submittedDate), c.today) ?? 0) : null;
          return { key: p.id, title: p.name, onClick: () => c.nav.openAdminWork('programmes'), sub: waited === null ? 'Submitted to HRDC' : `Waiting ${waited} day${waited === 1 ? '' : 's'} (since ${formatDate(ymd(p.submittedDate))})`, level: waited !== null && waited > 30 ? 'attention' as const : undefined };
        }),
        empty: 'No programmes waiting on HRDC.',
      };
    }
    case 'shared_with_me':
      // Quotations and course outlines someone shared with me that I haven't opened yet (lib/sharedInbox.ts).
      return {
        items: c.shared.map(f => ({
          key: `${f.kind}_${f.id}`, onClick: () => c.nav.openFile?.(f.kind, f.id), level: 'attention' as const,
          title: `${f.kind === 'quotation' ? 'Quotation' : f.kind === 'teambuilding' ? 'Teambuilding proposal' : 'Course outline'} ${f.ref} · ${f.client || 'No client yet'}`,
          sub: `${f.title ? `${f.title} · ` : ''}Shared by ${f.byName || 'a teammate'}, ${formatDate(f.at.slice(0, 10))} ${new Date(f.at).toLocaleTimeString('en-MY', { hour: 'numeric', minute: '2-digit' })}`,
        })),
        empty: 'Nothing new shared with you.',
      };
    default:
      return { items: [], empty: '' };
  }
}

