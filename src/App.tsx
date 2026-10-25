import React, { useState, useEffect } from 'react';
import { 
  Plus, 
  MessageSquareText, 
  Sparkles, 
  ChevronRight, 
  Clock, 
  Calendar as CalendarIcon, 
  X, 
  Send, 
  Loader2, 
  RefreshCw, 
  Volume2,
  ChevronDown,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  Key,
  LogOut,
  KeyRound,
  UserCircle2,
  ArrowLeft,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Firebase imports
import { db, auth } from './lib/firebase';
import { collection, doc, setDoc, getDoc, updateDoc, deleteDoc, onSnapshot, query, where } from 'firebase/firestore';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';

// Core components & initial datasets
import Logo from './components/Logo';
// The big screens load only when first opened, so the login page appears faster.
const HomeDashboard = React.lazy(() => import('./components/HomeDashboard'));
const RepDetailDashboard = React.lazy(() => import('./components/RepDetailDashboard'));
const ManagementDashboard = React.lazy(() => import('./components/ManagementDashboard'));
const ProjectPL = React.lazy(() => import('./components/ProjectPL'));
const PaymentTracking = React.lazy(() => import('./components/PaymentTracking'));
import { useActivityTracker, usePlace } from './lib/loginActivity';
const TeamManager = React.lazy(() => import('./components/TeamManager'));
const PerformanceHub = React.lazy(() => import('./components/PerformanceHub'));
const MyAppraisalCard = React.lazy(() => import('./components/MyAppraisal'));
const DataTools = React.lazy(() => import('./components/DataTools'));
const FollowUpRulesPage = React.lazy(() => import('./components/FollowUpRulesPage'));
const TeamFollowUpsPage = React.lazy(() => import('./components/TeamFollowUps'));
const LostDeletedPage = React.lazy(() => import('./components/LostDeletedPage'));
const ClientLinksPage = React.lazy(() => import('./components/ClientLinksPage'));
const WorkQueue = React.lazy(() => import('./components/WorkQueue'));
import type { AdminView } from './components/WorkQueue';
const MyHome = React.lazy(() => import('./components/MyHome'));
const PrivateRoom = React.lazy(() => import('./components/PrivateRoom'));
const LoginLog = React.lazy(() => import('./components/LoginLog'));
import { LoadingScreen, SetupScreen, LoginForm, ForcedPasswordChangeScreen, NoAccessScreen, ChangePasswordForm } from './components/LoginScreen';
import { INITIAL_CALENDAR_EVENTS, INITIAL_NOTICES, MOTIVATIONAL_QUOTES } from './initialData';
import { Representative, CalendarEvent, TeamMember, ROLE_LABELS } from './types';
import { hasKpis, metricsFor } from './lib/kpi';
import { KpiSetItem } from './lib/kpiLibrary';
import { useKpiLibrary } from './lib/useKpiLibrary';
import { appointmentEvents, trainingEvents } from './lib/appointments';
import { useOneToOnes } from './lib/useOneToOnes';
import { oneToOneEvents } from './lib/oneToOne';
import { googleEvents, syncCalendar } from './lib/googleCalendar';
import { runBackup } from './lib/backupApi';
import { useFollowUpRules } from './lib/useFollowUpRules';
import { useMonthLocks } from './lib/useMonthLocks';
import { canEditMonth, kpiMonthYm, ymLabel as lockYmLabel } from './lib/monthLock';
import DealChecksPage from './components/DealChecksPage';
import { linkedOnly, setLinkedTeam } from './lib/linked';
import { setSuperManager } from './lib/superManager';
import { MovableScreen, useScreensOff } from './lib/privateScreens';
import { SharedKind } from './lib/sharedInbox';
import GlobalSearch, { SearchHit, setSearchPrefill } from './components/GlobalSearch';

// Firestore does not support arrays nested inside arrays (e.g. string[][]).
// These fields on Representative.kpi are arrays-of-arrays in memory
// (indexed by week number), so we serialize them to a JSON string before
// writing to Firestore, and parse them back when reading.
const NESTED_ARRAY_KPI_FIELDS = ['taggedRepIdsList', 'completedTagsList', 'collaborationCommentsList'] as const;

function sanitizeKpiForFirestore(kpi: any): any {
  if (!kpi) return kpi;
  const clone: any = JSON.parse(JSON.stringify(kpi));
  for (const field of NESTED_ARRAY_KPI_FIELDS) {
    if (Array.isArray(clone[field])) {
      clone[field] = JSON.stringify(clone[field]);
    }
  }
  return clone;
}

function hydrateKpi(kpi: any): any {
  if (!kpi) return kpi;
  for (const field of NESTED_ARRAY_KPI_FIELDS) {
    if (typeof kpi[field] === 'string') {
      try {
        kpi[field] = JSON.parse(kpi[field]);
      } catch {
        kpi[field] = [];
      }
    }
  }
  return kpi;
}

// Rep workspace documents only hold KPI and targets. Names live ONLY in the
// Team list, so they are never copied here.
function toFirestoreRep(rep: Representative): any {
  const clone: any = JSON.parse(JSON.stringify({ kpi: rep.kpi, targets: rep.targets }));
  if (clone.kpi) {
    clone.kpi = sanitizeKpiForFirestore(clone.kpi);
  }
  return clone;
}

const DEFAULT_TARGETS: Representative['targets'] = { salesFigure: 30000, proposals: 2, preview: 1 };
const emptyKpi = (): Representative['kpi'] => ({
  salesFigure: [0, 0, 0, 0, 0],
  proposals: [0, 0, 0, 0, 0],
  preview: [0, 0, 0, 0, 0]
});

// Old login data left in browsers by the previous password system.
const LEGACY_LOCAL_KEYS = ['next_password_mapping', 'next_unlocked', 'next_reps'];

function fromFirestoreRep(data: any): any {
  if (data && data.kpi) {
    data.kpi = hydrateKpi(data.kpi);
  }
  return data;
}

// ============================================================
// Login gate: decides which screen to show before the CRM loads.
// ============================================================
export default function App() {
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [teamLoaded, setTeamLoaded] = useState(false);
  const [setupDone, setSetupDone] = useState<boolean | null>(null);
  // undefined = still checking, null = this login is not linked to anyone
  const [linkedMemberId, setLinkedMemberId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    LEGACY_LOCAL_KEYS.forEach(k => localStorage.removeItem(k));
    const unsubAuth = onAuthStateChanged(auth, user => {
      setAuthUser(user);
      setAuthReady(true);
    });
    const unsubTeam = onSnapshot(
      collection(db, 'team'),
      snap => {
        setTeamMembers(snap.docs.map(d => ({ ...(d.data() as TeamMember), id: d.id })));
        setTeamLoaded(true);
      },
      err => {
        console.error('Team list failed to load:', err);
        setTeamLoaded(true);
      }
    );
    const unsubSetup = onSnapshot(
      doc(db, 'config', 'setup'),
      snap => setSetupDone(snap.exists()),
      err => {
        console.error('Setup check failed:', err);
        setSetupDone(false);
      }
    );
    return () => {
      unsubAuth();
      unsubTeam();
      unsubSetup();
    };
  }, []);

  useEffect(() => {
    if (!authUser) {
      setLinkedMemberId(undefined);
      return;
    }
    setLinkedMemberId(undefined);
    const unsub = onSnapshot(
      doc(db, 'auth_map', authUser.uid),
      snap => {
        const data = snap.data() as any;
        setLinkedMemberId(snap.exists() && data?.active ? data.memberId : null);
      },
      () => setLinkedMemberId(null)
    );
    return () => unsub();
  }, [authUser]);

  if (!authReady || !teamLoaded || setupDone === null) return <LoadingScreen />;
  if (!setupDone) return <SetupScreen />;
  if (!authUser) return <LoginForm members={teamMembers} />;
  if (linkedMemberId === undefined) return <LoadingScreen message="Checking your access…" />;

  const currentMember = teamMembers.find(m => m.id === linkedMemberId && m.active);
  if (!currentMember) return <NoAccessScreen />;
  if (currentMember.mustChangePassword) return <ForcedPasswordChangeScreen member={currentMember} />;

  return <CrmApp key={currentMember.id} currentMember={currentMember} teamMembers={teamMembers} />;
}

// ============================================================
// The CRM itself (only runs after a successful login).
// ============================================================
function CrmApp({ currentMember, teamMembers }: { currentMember: TeamMember; teamMembers: TeamMember[] }) {
  // Old records not linked to a Team member yet are hidden everywhere (lib/linked.ts).
  setLinkedTeam(teamMembers.map(m => m.id));
  const isManagement = currentMember.role === 'management';
  // Owner override (lib/superManager.ts): only the person's own record, which only they can read.
  const [ownerOverride, setOwnerOverride] = useState(false);
  // The private room (components/PrivateRoom.tsx): double-click the clock; only with the owner override.
  const [roomOpen, setRoomOpen] = useState(false);
  const screensOff = useScreensOff();
  useEffect(() => {
    if (!isManagement) { setSuperManager(''); setOwnerOverride(false); return; }
    return onSnapshot(doc(db, 'owner_access', currentMember.id),
      s => { setSuperManager(s.exists() ? currentMember.id : ''); setOwnerOverride(s.exists()); },
      () => { setSuperManager(''); setOwnerOverride(false); });
  }, [currentMember.id, isManagement]);
  const isRep = currentMember.role === 'rep';
  const isStaff = !isRep; // Admin or Management

  // Per-person KPI settings (template + targets) keyed by team member id.
  const [repDocs, setRepDocs] = useState<Record<string, { targets?: Representative['targets']; kpiTemplate?: string; kpiSet?: { items?: KpiSetItem[] }; salesRing?: Representative['salesRing'] }>>({});
  // Typed-in weekly KPI numbers, one document per person per month: "<memberId>_<MMM-YY>".
  const [monthKpiDocs, setMonthKpiDocs] = useState<Record<string, Representative['kpi']>>({});

  // Automatic KPIs (counted from deals) are never typed in, so any old typed
  // numbers for them are ignored. Ones that also take typed extras (plusTyped) keep them.
  const withoutAutoKpis = (person: { id: string; role?: string; kpiTemplate?: string; kpiSet?: any; targets?: any }, kpi: Representative['kpi'] | undefined) => {
    const base: any = JSON.parse(JSON.stringify(kpi || emptyKpi()));
    metricsFor(person).forEach(m => {
      if (m.auto && !m.plusTyped) base[m.key] = [0, 0, 0, 0, 0];
      else if (!Array.isArray(base[m.key])) base[m.key] = [0, 0, 0, 0, 0];
    });
    return base as Representative['kpi'];
  };

  const repIdsRef = React.useRef<string[]>([]);
  repIdsRef.current = teamMembers.map(m => m.id);

  const [toast, setToast] = useState<string | null>(null);
  const showToast = (text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(t => (t === text ? null : t)), 4000);
  };
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  // Follow-up rules (Management → Follow-up rules) drive the follow-up alerts on every screen.
  useFollowUpRules();
  // Month lock (2026-10-22): which locked months Management reopened (lib/monthLock.ts).
  useMonthLocks();
  // KPI library (KPI & appraisal → Settings): every screen's KPIs, colour bands and the company GP bands.
  useKpiLibrary();
  // Login history (Team → Login log): counts this person's active minutes in the CRM.
  useActivityTracker(currentMember.id);
  const [managementView, setManagementView] = useState<'dashboard' | 'team_followups' | 'pl' | 'payments' | 'links' | 'followups' | 'lost' | 'team' | 'appraisal' | 'data' | 'checks'>('dashboard');
  // A screen moved to the private room leaves the Management menu (lib/privateScreens.ts).
  useEffect(() => { if (screensOff.includes(managementView as MovableScreen)) setManagementView('dashboard'); }, [screensOff, managementView]);
  const [teamFollowUpPerson, setTeamFollowUpPerson] = useState('');   // My home's Team follow-ups card: one person, or '__quiet'
  const [adminView, setAdminView] = useState<AdminView>('queue');
  const [adminDealId, setAdminDealId] = useState('');   // a won deal to open in the work queue (My home's After training card)

  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>(() => {
    const saved = localStorage.getItem('next_events');
    return saved ? JSON.parse(saved) : INITIAL_CALENDAR_EVENTS;
  });

  const [notices, setNotices] = useState<string[]>(() => {
    const saved = localStorage.getItem('next_notices');
    return saved ? JSON.parse(saved) : INITIAL_NOTICES;
  });

  // Active Representative Selection (reps can only ever open their own workspace)
  const [fileToOpen, setFileToOpen] = useState<{ kind: SharedKind; id: string } | null>(null);   // My home's "Shared with me"
  const [clientToOpen, setClientToOpen] = useState<{ repId: string; clientId: string } | null>(null);   // My home's "My follow-ups"
  const [dealToOpen, setDealToOpen] = useState<{ repId: string; dealId: string } | null>(null);   // Management → Team follow-ups
  const [tabToOpen, setTabToOpen] = useState<{ repId: string; tab: string } | null>(null);   // Global search: Trainers / Venues
  const [selectedRepId, setSelectedRepId] = useState<string | null>(() => {
    const saved = localStorage.getItem('next_selected_rep_id') || null;
    // Everyone lands on My home after logging in.
    return null;
  });

  // Track if we came from operations or management to handle the Back button correctly
  const [repSelectionSource, setRepSelectionSource] = useState<'operations' | 'admin' | 'management'>(() => {
    const saved = localStorage.getItem('next_rep_selection_source');
    return (saved as 'operations' | 'admin' | 'management') || 'operations';
  });

  // Tab State ('operations' | 'admin' | 'management')
  const [currentTab, setCurrentTab] = useState<'operations' | 'admin' | 'management'>(() => {
    const saved = localStorage.getItem('next_current_tab');
    if (saved === 'admin' && isStaff) return 'admin';
    if (!isManagement) return 'operations';
    return (saved as 'operations' | 'management') || 'operations';
  });

  // Login log: which screen the time is spent on (the tab inside it reports too).
  usePlace(currentTab === 'admin' && isStaff ? 'admin' : currentTab === 'management' ? `mgmt_${managementView}` : !selectedRepId ? 'home' : 'workspace', 1);

  useEffect(() => {
    if (selectedRepId) {
      localStorage.setItem('next_selected_rep_id', selectedRepId);
    } else {
      localStorage.removeItem('next_selected_rep_id');
    }
  }, [selectedRepId]);

  useEffect(() => {
    localStorage.setItem('next_rep_selection_source', repSelectionSource);
  }, [repSelectionSource]);

  useEffect(() => {
    localStorage.setItem('next_current_tab', currentTab);
  }, [currentTab]);

  // Time & Quote Dynamic States
  const [currentTime, setCurrentTime] = useState(new Date());
  const [quoteIndex, setQuoteIndex] = useState(0);

  // Real-time Firestore synchronizer helper states to trigger re-renders
  const [pipelinesSync, setPipelinesSync] = useState<any[]>([]);
  const [tasksSync, setTasksSync] = useState<any[]>([]);
  const [quotationsSync, setQuotationsSync] = useState<any[]>([]);
  const [outlinesSync, setOutlinesSync] = useState<any[]>([]);
  const [monthKpisSync, setMonthKpisSync] = useState<any[]>([]);

  // Selected Month View State (Format: MMM-YY, e.g. 'JUL-26')
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const date = new Date();
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const monthStr = months[date.getMonth()];
    const yearTwoDigits = date.getFullYear().toString().slice(-2);
    const dynamicMonth = `${monthStr}-${yearTwoDigits}`;

    const validMonths = ['JAN-26', 'FEB-26', 'MAR-26', 'APR-26', 'MAY-26', 'JUN-26', 'JUL-26', 'AUG-26', 'SEP-26', 'OCT-26', 'NOV-26', 'DEC-26', 'JAN-27', 'FEB-27', 'MAR-27', 'APR-27', 'MAY-27', 'JUN-27'];
    if (validMonths.includes(dynamicMonth)) {
      return dynamicMonth;
    }
    return 'JUL-26';
  });

  // People with a workspace and KPIs: active reps and admins, plus Management members who were
  // given a KPI set in Team (Joel, 2026-10-17). Names come from Team, KPI settings from their rep
  // document, typed-in numbers from this month's KPI document.
  const ROLE_ORDER: Record<string, number> = { rep: 0, admin: 1, management: 2 };
  const representatives: Representative[] = React.useMemo(() => {
    return teamMembers
      .filter(m => m.active && (m.role === 'rep' || m.role === 'admin' || (m.role === 'management' && hasKpis(repDocs[m.id], m.role))))
      .sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : ROLE_ORDER[a.role] - ROLE_ORDER[b.role]))
      .map(m => {
        const settings = repDocs[m.id] || {};
        const person = { id: m.id, role: m.role, kpiTemplate: settings.kpiTemplate, kpiSet: settings.kpiSet, targets: settings.targets || DEFAULT_TARGETS };
        return {
          id: m.id,
          name: m.name,
          role: m.role,
          kpiTemplate: settings.kpiTemplate,
          kpiSet: settings.kpiSet,
          salesRing: settings.salesRing,
          targets: settings.targets || DEFAULT_TARGETS,
          kpi: withoutAutoKpis(person, monthKpiDocs[`${m.id}_${selectedMonth}`])
        };
      });
  }, [teamMembers, repDocs, monthKpiDocs, selectedMonth]);

  // People with a workspace: everyone above, plus Management members without a KPI set (Joel, 2026-10-20).
  // Those are marked noKpis: no KPI page, and left out of rings, Team performance and the Company target,
  // which keep using `representatives`.
  const workspacePeople: Representative[] = React.useMemo(() => {
    const extra = teamMembers
      .filter(m => m.active && m.role === 'management' && !representatives.some(r => r.id === m.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(m => ({ id: m.id, name: m.name, role: m.role, kpiTemplate: '', noKpis: true, salesRing: repDocs[m.id]?.salesRing, targets: DEFAULT_TARGETS, kpi: emptyKpi() as Representative['kpi'] }));
    return [...representatives, ...extra];
  }, [teamMembers, representatives, repDocs]);

  // Switching month only changes what is shown; nothing is copied or overwritten.
  const handleMonthChange = async (newMonth: string) => {
    setSelectedMonth(newMonth);
    localStorage.setItem('next_selected_month', newMonth);
  };

  // Real-time Firestore synchronizer for rep workspaces (KPI + targets only)
  useEffect(() => {
    if (!db) return;
    const unsubscribe = onSnapshot(collection(db, 'reps'), (snapshot) => {
      const next: Record<string, { targets?: Representative['targets']; kpiTemplate?: string; kpiSet?: { items?: KpiSetItem[] }; salesRing?: Representative['salesRing'] }> = {};
      snapshot.forEach((docSnap) => {
        const data: any = docSnap.data();
        next[docSnap.id] = { targets: data.targets, kpiTemplate: data.kpiTemplate, kpiSet: data.kpiSet, salesRing: data.salesRing };
      });
      setRepDocs(next);
    }, (err) => console.error('Rep workspaces failed to load:', err));
    return () => unsubscribe();
  }, []);

  // Real-time Firestore synchronizer for Calendar Events
  useEffect(() => {
    if (!db) return;
    const unsubscribe = onSnapshot(collection(db, 'events'), async (snapshot) => {
      const firestoreEvents: any[] = [];
      snapshot.forEach((docSnap) => {
        firestoreEvents.push({ ...docSnap.data(), id: docSnap.id });
      });

      if (firestoreEvents.length > 0) {
        setCalendarEvents(firestoreEvents);
        localStorage.setItem('next_events', JSON.stringify(firestoreEvents));
      } else {
        // Firestore genuinely has no events (either none created yet, or all deleted).
        // Reflect that truthfully instead of re-uploading stale localStorage data,
        // which would silently resurrect deleted calendar events.
        setCalendarEvents([]);
        localStorage.setItem('next_events', JSON.stringify([]));
      }
    });
    return () => unsubscribe();
  }, []);

  // The shared Google Calendar (2026-10-17): show its events on the CRM calendar, and keep it up to date
  // with the CRM (events, deal appointments, training dates). The server does the work; if the calendar
  // isn't set up yet, or this isn't the live site, this quietly shows nothing.
  const [googleCalEvents, setGoogleCalEvents] = useState<CalendarEvent[]>([]);
  const refreshGoogleCalendar = async (force = false) => {
    try { await syncCalendar(force); } catch (err) { console.warn('Google Calendar sync:', err); }
    try {
      const day = (n: number) => { const d = new Date(Date.now() + n * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
      setGoogleCalEvents(await googleEvents(day(-62), day(365)));
    } catch {
      setGoogleCalEvents([]);
    }
  };
  // Daily backup to the Google Sheet: the server runs it only once a Malaysian day, the first time
  // Admin or Management opens the CRM (serverBackup.ts). Quiet if it isn't set up.
  useEffect(() => {
    if (!isStaff) return;
    runBackup(false).catch(err => console.warn('Daily backup:', err));
  }, [isStaff]);

  useEffect(() => {
    refreshGoogleCalendar();
    const timer = window.setInterval(() => refreshGoogleCalendar(), 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Real-time Firestore synchronizer for Notices
  useEffect(() => {
    if (!db) return;
    const unsubscribe = onSnapshot(doc(db, 'config', 'notices'), async (docSnap) => {
      const data = docSnap.data();
      if (data && Array.isArray(data.notices)) {
        setNotices(data.notices);
        localStorage.setItem('next_notices', JSON.stringify(data.notices));
      } else if (!docSnap.exists()) {
        try { await setDoc(doc(db, 'config', 'notices'), { notices }); } catch { /* ignore */ }
      }
    }, (err) => console.warn('Notices failed to load:', err));
    // The old login system stored passwords as readable text. Remove it for good.
    if (isManagement) {
      deleteDoc(doc(db, 'config', 'passwords')).catch(() => { /* already gone */ });
    }
    return () => unsubscribe();
  }, []);

  // Real-time Firestore synchronizers for deep linking (PC <-> Phone) on all screens
  useEffect(() => {
    if (!db) return;

    // 1. Pipelines Real-time Sync
    const unsubscribePipes = onSnapshot(collection(db, 'pipelines'), (snapshot) => {
      const pipes: any[] = [];
      snapshot.forEach((docSnap) => {
        const p = { ...docSnap.data(), id: docSnap.id };
        if (linkedOnly([p]).length) pipes.push(p);
      });
      if (pipes.length > 0) {
        pipes.sort((a, b) => b.id.localeCompare(a.id));
        localStorage.setItem('next_pipelines_shared', JSON.stringify(pipes));
        
        // Sync individual rep keys
        const repIds = repIdsRef.current;
        repIds.forEach(id => {
          const ownedPipes = pipes.filter(p => p.ownerId === id || p.creatorId === id || p.taggedRepIds?.includes(id));
          localStorage.setItem(`next_pipelines_${id}`, JSON.stringify(ownedPipes));
        });
        setPipelinesSync(pipes);
      } else {
        // Firestore genuinely has none left (all deleted) - reflect that truthfully
        // instead of leaving stale data in this sync state forever.
        localStorage.setItem('next_pipelines_shared', JSON.stringify([]));
        const repIds = repIdsRef.current;
        repIds.forEach(id => {
          localStorage.setItem(`next_pipelines_${id}`, JSON.stringify([]));
        });
        setPipelinesSync([]);
      }
    });

    // 2. Tasks Real-time Sync
    const unsubscribeTasks = onSnapshot(collection(db, 'tasks'), (snapshot) => {
      const ts: any[] = [];
      snapshot.forEach((docSnap) => {
        ts.push({ ...docSnap.data(), id: docSnap.id });
      });
      if (ts.length > 0) {
        const repIds = repIdsRef.current;
        repIds.forEach(id => {
          const repTasks = ts.filter(t => t.ownerRepId === id);
          localStorage.setItem(`next_tasks_${id}`, JSON.stringify(repTasks));
        });
        setTasksSync(ts);
      } else {
        const repIds = repIdsRef.current;
        repIds.forEach(id => {
          localStorage.setItem(`next_tasks_${id}`, JSON.stringify([]));
        });
        setTasksSync([]);
      }
    });

    // 3. Quotations Real-time Sync
    const unsubscribeQuotes = onSnapshot(collection(db, 'quotations'), (snapshot) => {
      const quotes: any[] = [];
      snapshot.forEach((docSnap) => {
        const q = { ...docSnap.data(), id: docSnap.id };
        if (linkedOnly([q]).length) quotes.push(q);
      });
      if (quotes.length > 0) {
        quotes.sort((a, b) => a.id.localeCompare(b.id));
        localStorage.setItem('next_quotations_lzk.joel@gmail.com', JSON.stringify(quotes));
        setQuotationsSync(quotes);
      } else {
        localStorage.setItem('next_quotations_lzk.joel@gmail.com', JSON.stringify([]));
        setQuotationsSync([]);
      }
    });

    // 4. Course Outlines Real-time Sync
    const unsubscribeOutlines = onSnapshot(collection(db, 'course_outlines'), (snapshot) => {
      const cos: any[] = [];
      snapshot.forEach((docSnap) => {
        const o = { ...docSnap.data(), id: docSnap.id };
        if (linkedOnly([o]).length) cos.push(o);
      });
      if (cos.length > 0) {
        cos.sort((a, b) => a.id.localeCompare(b.id));
        localStorage.setItem('next_course_outlines_lzk.joel@gmail.com', JSON.stringify(cos));
        setOutlinesSync(cos);
      } else {
        localStorage.setItem('next_course_outlines_lzk.joel@gmail.com', JSON.stringify([]));
        setOutlinesSync([]);
      }
    });

    // 5. Month KPIs Real-time Sync (typed-in weekly numbers per person per month)
    const unsubscribeMonthKpis = onSnapshot(collection(db, 'month_kpis'), (snapshot) => {
      const next: Record<string, any> = {};
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        if (data && data.kpi) next[docSnap.id] = hydrateKpi(data.kpi);
      });
      setMonthKpiDocs(next);
    });

    return () => {
      unsubscribePipes();
      unsubscribeTasks();
      unsubscribeQuotes();
      unsubscribeOutlines();
      unsubscribeMonthKpis();
    };
  }, []);

  // Year-to-date figures on Home and Management read this cache.
  useEffect(() => {
    const dict: Record<string, any> = {};
    const people = teamMembers.map(m => ({ id: m.id, role: m.role, kpiTemplate: repDocs[m.id]?.kpiTemplate, kpiSet: repDocs[m.id]?.kpiSet, targets: repDocs[m.id]?.targets }));
    Object.entries(monthKpiDocs).forEach(([key, kpi]) => {
      const person = people.find(p => key.startsWith(p.id + '_'));
      dict[key] = person ? withoutAutoKpis(person, kpi as any) : kpi;
    });
    localStorage.setItem('next_month_kpis_dict', JSON.stringify(dict));
    setMonthKpisSync(Object.values(dict));
  }, [monthKpiDocs, repDocs, teamMembers]);

  // Real-time Date & Time updates
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Quotes rotation timer (every 10 seconds)
  useEffect(() => {
    const quoteTimer = setInterval(() => {
      setQuoteIndex((prev) => (prev + 1) % MOTIVATIONAL_QUOTES.length);
    }, 10000);
    return () => clearInterval(quoteTimer);
  }, []);

  // Handlers for HomeDashboard interactions
  // Only Management can open other people's workspaces; everyone else only their own (Joel, 2026-10-16).
  const canOpenWorkspace = (id: string) => isManagement || id === currentMember.id;

  const handleSelectRep = (rep: Representative) => {
    if (!canOpenWorkspace(rep.id)) {
      showToast('You can open your own workspace only.');
      return;
    }
    setRepSelectionSource('operations');
    setSelectedRepId(rep.id);
    setCurrentTab('operations');
  };

  const handleSwitchTab = (tab: 'operations' | 'admin' | 'management') => {
    if (tab === 'management' && !isManagement) return;
    if (tab === 'admin' && !isStaff) return;
    setCurrentTab(tab);
    setSelectedRepId(null);
  };

  // From the admin work queue: open a person's workspace on their Quotations tab.
  const handleOpenQuotationsFor = (repId: string) => {
    // Admin opens their own Quotations (which lists everyone's); Management can open the owner's.
    const wanted = canOpenWorkspace(repId) ? repId : currentMember.id;
    const target = workspacePeople.find(r => r.id === wanted) || workspacePeople.find(r => r.id === currentMember.id);
    if (!target) {
      showToast("That person's workspace isn't available. Open the quotation from a rep's workspace instead.");
      return;
    }
    localStorage.setItem(`next_active_subtab_${target.id}`, 'quotation');
    setRepSelectionSource('admin');
    setSelectedRepId(target.id);
    setCurrentTab('operations');
  };

  const handleLogout = async () => {
    localStorage.removeItem('next_selected_rep_id');
    localStorage.removeItem('next_current_tab');
    await signOut(auth);
  };

  const handleAddEvent = async (evt: Omit<CalendarEvent, 'id'>) => {
    const newEvent: CalendarEvent = {
      ...evt,
      id: `ev_${Date.now()}`
    };
    setCalendarEvents(prev => [...prev, newEvent]);
    try {
      await setDoc(doc(db, 'events', newEvent.id), newEvent);
      refreshGoogleCalendar(true);
    } catch (err) {
      console.error("Firestore add event failed:", err);
    }
  };

  const handleDeleteEvent = async (id: string) => {
    if (id.startsWith('g_')) {
      showToast('This event is on the Google Calendar. Change or delete it in Google Calendar.');
      return;
    }
    // Appointments come from deals; change or cancel them on the deal.
    if (id.startsWith('appt_')) {
      showToast('This is a deal appointment. Change or cancel it on the deal.');
      return;
    }
    if (id.startsWith('train_')) {
      showToast('This is a won deal\'s training day. Change the date or cancel the training on the deal.');
      return;
    }
    setCalendarEvents(prev => prev.filter(e => e.id !== id));
    try {
      await deleteDoc(doc(db, 'events', id));
      refreshGoogleCalendar(true);
    } catch (err) {
      console.error("Firestore delete event failed:", err);
    }
  };

  const handleAddNotice = async (notice: string) => {
    const updated = [...notices, notice];
    setNotices(updated);
    try {
      await setDoc(doc(db, 'config', 'notices'), { notices: updated });
    } catch (err) {
      console.error("Firestore add notice failed:", err);
    }
  };

  // Dynamic pipeline checker for newsfeed/notices (Requirement: >2 days no proposal sent)
  const getOverduePipelineNotices = (): string[] => {
    const alerts: string[] = [];
    representatives.forEach(rep => {
      // Real deals only, owned by this person (never sample data).
      const pipes = pipelinesSync.filter(p => (p.ownerId || p.creatorId) === rep.id);

      pipes.forEach(p => {
        if (p.status === 'Pending') {
          const isNotSentYet = !p.proposalSentDate || p.proposalSentDate.toLowerCase() === 'not yet';
          if (isNotSentYet) {
            const reqDate = new Date(p.requestDate);
            const today = new Date();
            const diffTime = today.getTime() - reqDate.getTime();
            const diffDays = diffTime / (1000 * 3600 * 24);
            if (diffDays > 2) {
              alerts.push(
                `🚨 URGENT: ${rep.name}'s opportunity for "${p.client}" is OVERDUE! No proposal sent since request date (${p.requestDate}).`
              );
            }
          }
        }
      });
    });
    return alerts;
  };

  const handleDeleteNotice = async (idx: number) => {
    if (idx >= notices.length) return; // Prevent deleting dynamic notices
    const updated = notices.filter((_, i) => i !== idx);
    setNotices(updated);
    try {
      await setDoc(doc(db, 'config', 'notices'), { notices: updated });
    } catch (err) {
      console.error("Firestore delete notice failed:", err);
    }
  };

  // Saves typed-in weekly KPI numbers for one person for the selected month.
  const handleUpdateRepKpi = async (repId: string, updatedKpi: Representative['kpi']) => {
    const key = `${repId}_${selectedMonth}`;
    if (!canEditMonth(kpiMonthYm(selectedMonth), currentMember?.role || 'rep')) {
      showToast(`${lockYmLabel(kpiMonthYm(selectedMonth))} is locked. Only Management can change it.`);
      return;
    }
    setMonthKpiDocs(prev => ({ ...prev, [key]: updatedKpi }));
    try {
      await setDoc(doc(db, 'month_kpis', key), { kpi: sanitizeKpiForFirestore(updatedKpi), repId, month: selectedMonth });
    } catch (err) {
      console.error("Firestore update rep KPI failed:", err);
      showToast('Could not save KPI numbers. You can only edit your own KPIs.');
    }
  };

  const handleUpdateRepTargets = async (repId: string, updatedTargets: Representative['targets']) => {
    setRepDocs(prev => ({ ...prev, [repId]: { ...(prev[repId] || {}), targets: updatedTargets } }));
    try {
      await setDoc(doc(db, 'reps', repId), { targets: updatedTargets }, { merge: true });
    } catch (err) {
      console.error("Firestore update rep targets failed:", err);
      showToast('Could not save targets. Only Management can change targets.');
    }
  };

  const selectedRep = workspacePeople.find(r => r.id === selectedRepId);
  const myOneToOnes = useOneToOnes(currentMember.id);
  // 1-to-1s need no setup (Joel, 2026-10-25): the owner always runs them and is the only one who sees everyone's;
  // nobody can pick someone else (the old "Who runs the 1-to-1s" setting is gone, and an earlier pick is put back here).
  useEffect(() => {
    if (!ownerOverride || !myOneToOnes.configLoaded || myOneToOnes.coachId === currentMember.id) return;
    setDoc(doc(db, 'config', 'one_to_one'), { coachId: currentMember.id, updatedAt: Date.now() }, { merge: true }).catch(() => { /* tried again next load */ });
  }, [ownerOverride, myOneToOnes.configLoaded, myOneToOnes.coachId, currentMember.id]);

  // Team calendar = typed events + appointments booked on deals + won deals' training days (read from the deals, never copied)
  // + this person's own 1-to-1s (2026-10-25; nobody else's).
  const allCalendarEvents = [...calendarEvents, ...googleCalEvents, ...appointmentEvents(pipelinesSync, id => teamMembers.find(m => m.id === id)?.name || ''), ...trainingEvents(pipelinesSync, quotationsSync),
    ...oneToOneEvents(myOneToOnes.sessions, currentMember.id, id => teamMembers.find(m => m.id === id)?.name || '')];

  // The calendar and notices on My home reuse the old home page's parts.
  const homeDashboardProps = {
    reps: representatives,
    events: allCalendarEvents,
    notices: [...notices, ...getOverduePipelineNotices()],
    onSelectRep: handleSelectRep,
    onAddRep: () => {},
    onAddEvent: handleAddEvent,
    onDeleteEvent: handleDeleteEvent,
    canManageCalendar: currentMember.role === 'management',
    onCalendarChanged: () => refreshGoogleCalendar(),
    onAddNotice: handleAddNotice,
    onDeleteNotice: handleDeleteNotice,
    isManagementUnlocked: false,
    onRequestManagementUnlock: () => {},
    selectedMonth,
    onMonthChange: handleMonthChange,
    pipelinesSync,
    tasksSync,
    quotationsSync,
    outlinesSync,
    monthKpisSync,
  };

  const homeNav = {
    // My home's "Shared with me": open the file in my own workspace's editor.
    openFile: (kind: SharedKind, id: string) => {
      if (!canOpenWorkspace(currentMember.id)) return;
      setFileToOpen({ kind, id });
      homeNav.openWorkspace(currentMember.id, kind === 'quotation' ? 'quotation' : 'course_outline');
    },
    // A client's page (the client list is shared, so any workspace shows it): my own, else for Management
    // without a workspace, the first teammate's.
    openClient: (clientId: string) => {
      const repId = canOpenWorkspace(currentMember.id) && workspacePeople.some(r => r.id === currentMember.id)
        ? currentMember.id : isManagement ? workspacePeople[0]?.id : '';
      if (!repId) return;
      setClientToOpen({ repId, clientId });
      homeNav.openWorkspace(repId, 'client');
    },
    // A deal's panel in its owner's workspace (Management), else my own.
    openDeal: (deal: any) => {
      const owner = deal?.ownerId || deal?.creatorId;
      const repId = isManagement && workspacePeople.some(r => r.id === owner) ? owner
        : workspacePeople.some(r => r.id === currentMember.id) ? currentMember.id : isManagement ? workspacePeople[0]?.id : '';
      if (!repId || !deal?.id) return;
      setDealToOpen({ repId, dealId: deal.id });
      homeNav.openWorkspace(repId, 'pipeline');
    },
    openTeamFollowUps: (personId?: string) => {
      if (!isManagement) return;
      setTeamFollowUpPerson(personId || '');
      setManagementView('team_followups');
      handleSwitchTab('management');
    },
    openWorkspace: (repId: string, subTab?: string) => {
      if (!canOpenWorkspace(repId)) return;
      if (subTab) localStorage.setItem(`next_active_subtab_${repId}`, subTab);
      setRepSelectionSource('operations');
      setSelectedRepId(repId);
      setCurrentTab('operations');
    },
    openAdminWork: (view?: AdminView, dealId?: string) => {
      if (!isStaff) return;
      setAdminView(view || 'queue');
      setAdminDealId(dealId || '');
      setCurrentTab('admin');
      setSelectedRepId(null);
    },
    openManagement: (view?: 'dashboard' | 'team_followups' | 'pl' | 'payments' | 'links' | 'followups' | 'lost' | 'team' | 'appraisal' | 'data' | 'checks') => {
      if (!isManagement) return;
      if (view) setManagementView(view);
      handleSwitchTab('management');
    },
  };

  // Global search: open the record found (deals, clients and files directly; trainers, venues and vendors
  // open their list with the name in its search box).
  const openSearchHit = (hit: SearchHit) => {
    if (hit.kind === 'client') homeNav.openClient(hit.id);
    else if (hit.kind === 'deal') homeNav.openDeal(hit.record);
    else if (hit.kind === 'quotation' || hit.kind === 'outline' || hit.kind === 'teambuilding') homeNav.openFile(hit.kind, hit.id);
    else if (hit.kind === 'vendor') { setSearchPrefill('vendors', hit.record?.displayName || hit.title); homeNav.openAdminWork('vendors'); }
    else {
      const tab = hit.kind === 'trainer' ? 'trainerList' : 'venue';
      setSearchPrefill(hit.kind === 'trainer' ? 'trainers' : 'venues', hit.title);
      setTabToOpen({ repId: currentMember.id, tab });
      homeNav.openWorkspace(currentMember.id, tab);
    }
  };

  // Management → KPI & appraisal (Joel, 2026-10-25): KPIs, scorecards, the appraisal round and their settings.
  // Starts in the private room (lib/privateScreens.ts); the owner can untick it to bring it back to Management.
  const appraisalScreen = (
    <PerformanceHub
      currentMember={currentMember}
      teamMembers={teamMembers}
      settingsOf={(id) => {
        const m = teamMembers.find(x => x.id === id);
        const s = repDocs[id] || {};
        return { id, role: m?.role, kpiTemplate: s.kpiTemplate, kpiSet: s.kpiSet, targets: s.targets || DEFAULT_TARGETS };
      }}
      kpiOf={(id, month) => {
        const m = teamMembers.find(x => x.id === id);
        const s = repDocs[id] || {};
        return withoutAutoKpis({ id, role: m?.role, kpiTemplate: s.kpiTemplate, kpiSet: s.kpiSet, targets: s.targets || DEFAULT_TARGETS }, monthKpiDocs[`${id}_${month}`]);
      }}
      deals={pipelinesSync}
    />
  );

  // Formatted date string
  const formattedDate = currentTime.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const formattedTime = currentTime.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-800 flex flex-col font-sans" id="applet-viewport-root">
      
      {/* 1. Global Navigation Header */}
      <header className="bg-white border-b border-slate-200/80 sticky top-0 z-40 shadow-xs" id="main-header">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-18 flex items-center justify-between">
          
          {/* Logo Brand click to navigate back home */}
          <div className="flex items-center gap-6">
            <div className="cursor-pointer transition-opacity hover:opacity-90" onClick={() => handleSwitchTab('operations')}>
              <Logo />
            </div>
            
            {/* Nav Tabs for Console switching */}
            <div className="hidden md:flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200">
              <button
                onClick={() => handleSwitchTab('operations')}
                className={`px-4 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
                  currentTab === 'operations' && !selectedRepId
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                My home
              </button>
{isManagement && (              <button
                onClick={() => handleSwitchTab('management')}
                className={`px-4 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
                  currentTab === 'management'
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Management
              </button>)}
            </div>
          </div>

          {/* Active Session Badges & Real-time Dynamic Date & Time */}
          <div className="flex items-center gap-4 text-right">
            <GlobalSearch
              viewer={{ id: currentMember.id, name: currentMember.name, role: currentMember.role }}
              people={teamMembers.map(m => ({ id: m.id, name: m.name }))}
              deals={pipelinesSync}
              quotations={quotationsSync}
              outlines={outlinesSync}
              onOpen={openSearchHit}
            />
            {/* Logged-in person + menu */}
            <div className="relative">
              <button
                onClick={() => setShowUserMenu(v => !v)}
                className="flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-1.5 text-left hover:bg-surface"
                aria-haspopup="menu"
                aria-expanded={showUserMenu}
              >
                <UserCircle2 className="h-5 w-5 text-accent" />
                <span className="hidden sm:block">
                  <span className="block text-sm font-semibold leading-tight text-ink">{currentMember.name}</span>
                  <span className="block text-xs leading-tight text-ink-soft">{ROLE_LABELS[currentMember.role]}</span>
                </span>
                <ChevronDown className="h-4 w-4 text-ink-soft" />
              </button>
              {showUserMenu && (
                <div role="menu" className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-line bg-white py-1 text-left shadow-lg">
                  <div className="border-b border-line px-4 py-2.5 sm:hidden">
                    <p className="text-sm font-semibold text-ink">{currentMember.name}</p>
                    <p className="text-xs text-ink-soft">{ROLE_LABELS[currentMember.role]}</p>
                  </div>
                  <button role="menuitem" onClick={() => { setShowUserMenu(false); setShowChangePassword(true); }} className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm font-medium text-ink hover:bg-surface">
                    <KeyRound className="h-4 w-4 text-ink-soft" /> Change my password
                  </button>
                  <button role="menuitem" onClick={handleLogout} className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm font-medium text-danger hover:bg-danger-soft">
                    <LogOut className="h-4 w-4" /> Log out
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-0.5">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block font-mono">
                {formattedDate}
              </span>
              <div className="flex items-center justify-end gap-1 text-slate-700 select-none" onDoubleClick={() => { if (ownerOverride) setRoomOpen(true); }}>
                <Clock className="w-3.5 h-3.5 text-blue-500" />
                <span className="text-xs font-extrabold font-mono tracking-tight">
                  {formattedTime}
                </span>
              </div>
            </div>
            
          </div>

        </div>
      </header>

      {/* 2. Main Workspace Layout Area */}
      <main className="flex-1 py-8 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full">
        
        {/* Mobile Tab switcher (visible only on small screens) */}
        {isManagement && <div className="flex md:hidden items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200 mb-6">
          <button
            onClick={() => handleSwitchTab('operations')}
            className={`flex-1 text-center py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
              currentTab === 'operations' && !selectedRepId
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            My home
          </button>
{isManagement && (          <button
            onClick={() => handleSwitchTab('management')}
            className={`flex-1 text-center py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
              currentTab === 'management'
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Management
          </button>)}
        </div>}

        <React.Suspense fallback={<p className="flex items-center gap-2 py-10 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}>
        <AnimatePresence mode="wait">
          {currentTab === 'admin' && isStaff ? (
            /* D. ADMIN WORK QUEUE */
            <motion.div
              key="admin"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.25 }}
            >
              <button type="button" onClick={() => handleSwitchTab('operations')} className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline">
                <ArrowLeft className="h-4 w-4" /> Back to My home
              </button>
              <WorkQueue
                key={`${adminView}:${adminDealId}`}
                viewer={{ id: currentMember.id, name: currentMember.name, role: currentMember.role }}
                people={teamMembers.filter(m => m.active).map(m => ({ id: m.id, name: m.name }))}
                onOpenQuotations={handleOpenQuotationsFor}
                initialView={adminView}
                initialDealId={adminDealId}
                deals={pipelinesSync}
                onOpenManagementPayments={() => homeNav.openManagement('payments')}
              />
            </motion.div>
          ) : currentTab === 'management' ? (
            /* C. MANAGEMENT VIEW */
            <motion.div
              key="management"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.25 }}
            >
              <div className="mb-5 inline-flex max-w-full flex-wrap rounded-xl border border-line bg-white p-1" role="tablist">
                {([['dashboard', 'Dashboard'], ['team_followups', 'Team follow-ups'], ['checks', 'Deal checks'], ['pl', 'Project P&L'], ['payments', 'Payment tracking'], ['links', 'Client links'], ['followups', 'Follow-up rules'], ['lost', 'Lost and deleted'], ['team', 'Team'], ['appraisal', 'KPI & appraisal'], ['data', 'Data tools']] as const).filter(([key]) => !screensOff.includes(key as MovableScreen)).map(([key, label]) => (
                  <button
                    key={key}
                    role="tab"
                    aria-selected={managementView === key}
                    onClick={() => { setManagementView(key); setTeamFollowUpPerson(''); }}
                    className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors ${
                      managementView === key ? 'bg-accent text-white' : 'text-ink-soft hover:text-ink'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {managementView === 'team_followups' ? (
                <TeamFollowUpsPage key={teamFollowUpPerson} initialPerson={teamFollowUpPerson} onOpenClient={homeNav.openClient} onOpenDeal={(d) => homeNav.openDeal(pipelinesSync.find((p: any) => p.id === d.id) || d)} />
              ) : managementView === 'links' ? (
                <ClientLinksPage people={teamMembers.map(m => ({ id: m.id, name: m.name }))} viewer={{ id: currentMember.id, name: currentMember.name }} />
              ) : managementView === 'followups' ? (
                <FollowUpRulesPage viewer={{ id: currentMember.id, name: currentMember.name }} />
              ) : managementView === 'lost' ? (
                <LostDeletedPage viewer={{ id: currentMember.id, name: currentMember.name }} people={teamMembers.map(m => ({ id: m.id, name: m.name }))} />
              ) : managementView === 'team' ? (
                <TeamManager currentMember={currentMember} teamMembers={teamMembers} />
              ) : managementView === 'appraisal' ? (
                appraisalScreen
              ) : managementView === 'data' ? (
                <DataTools teamMembers={teamMembers} viewer={{ id: currentMember.id, name: currentMember.name }} />
              ) : managementView === 'payments' ? (
                <PaymentTracking pipelinesSync={pipelinesSync} people={teamMembers.map(m => ({ id: m.id, name: m.name }))} viewer={{ id: currentMember.id, name: currentMember.name, role: currentMember.role }} onOpenDeal={homeNav.openDeal} />
              ) : managementView === 'checks' ? (
                <DealChecksPage deals={pipelinesSync} people={teamMembers.map(m => ({ id: m.id, name: m.name }))} viewer={{ id: currentMember.id, name: currentMember.name, role: currentMember.role }} onOpenDeal={homeNav.openDeal} />
              ) : managementView === 'pl' ? (
                <ProjectPL pipelinesSync={pipelinesSync} people={teamMembers.map(m => ({ id: m.id, name: m.name }))} viewer={{ id: currentMember.id, name: currentMember.name }} />
              ) : (
              <ManagementDashboard
                reps={representatives}
                ringPeople={workspacePeople}
                onSelectRep={(rep) => {
                  setRepSelectionSource('management');
                  setSelectedRepId(rep.id);
                  setCurrentTab('operations');
                }}
                selectedMonth={selectedMonth}
                onMonthChange={handleMonthChange}
                onOpenTeam={() => setManagementView('team')}
                onOpenDealChecks={() => setManagementView('checks')}
                onOpenDeal={homeNav.openDeal}
                viewer={{ id: currentMember.id, name: currentMember.name, role: currentMember.role }}
                pipelinesSync={pipelinesSync}
                people={teamMembers.map(m => ({ id: m.id, name: m.name }))}
              />
              )}
            </motion.div>
          ) : !selectedRepId ? (
            /* A. HOME VIEW (Overview Dashboard) */
            <motion.div
              key="home"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.25 }}
            >
              {/* My appraisal: only when an appraisal round is open for this person or a result is released. */}
              <div className="mb-5 empty:hidden">
                <React.Suspense fallback={null}>
                  <MyAppraisalCard viewer={{ id: currentMember.id, name: currentMember.name, role: currentMember.role }}
                    people={teamMembers.filter(m => m.active).map(m => ({ id: m.id, name: m.name }))} />
                </React.Suspense>
              </div>
              <MyHome
                viewer={{ id: currentMember.id, name: currentMember.name, role: currentMember.role }}
                people={teamMembers.map(m => ({ id: m.id, name: m.name, role: m.role, active: m.active }))}
                representatives={representatives}
                workspaces={workspacePeople}
                deals={pipelinesSync}
                events={allCalendarEvents}
                calendar={<HomeDashboard {...homeDashboardProps} section="calendar" />}
                notices={<HomeDashboard {...homeDashboardProps} section="notices" />}
                nav={homeNav}
              />
            </motion.div>
          ) : (
            /* B. DETAIL VIEW (Selected Rep View) */
            <motion.div
              key="detail"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.25 }}
            >
              {selectedRep ? (
                <RepDetailDashboard
                  rep={selectedRep}
                  reps={workspacePeople}
                  onBack={() => {
                    if (repSelectionSource === 'management') {
                      setCurrentTab('management');
                    } else if (repSelectionSource === 'admin' && isStaff) {
                      setCurrentTab('admin');
                    } else {
                      setCurrentTab('operations');
                    }
                    setSelectedRepId(null);
                  }}
                  onUpdateRepKpi={handleUpdateRepKpi}
                  selectedMonth={selectedMonth}
                  onMonthChange={handleMonthChange}
                  viewer={{ id: currentMember.id, name: currentMember.name, role: currentMember.role }}
                  onOpenAdminWork={isStaff ? () => homeNav.openAdminWork() : undefined}
                  openFile={selectedRep.id === currentMember.id ? fileToOpen : null}
                  onOpenFileHandled={() => setFileToOpen(null)}
                  openClientId={clientToOpen && clientToOpen.repId === selectedRep.id ? clientToOpen.clientId : null}
                  onOpenClientHandled={() => setClientToOpen(null)}
                  openDealId={dealToOpen && dealToOpen.repId === selectedRep.id ? dealToOpen.dealId : null}
                  onOpenDealHandled={() => setDealToOpen(null)}
                  openSubTab={tabToOpen && tabToOpen.repId === selectedRep.id ? tabToOpen.tab : null}
                  onOpenSubTabHandled={() => setTabToOpen(null)}
                />
              ) : (
                <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
                  <p className="text-slate-500 italic">Representative data not found.</p>
                  <button 
                    onClick={() => setSelectedRepId(null)} 
                    className="text-xs bg-blue-600 text-white px-4 py-2 rounded mt-4"
                  >
                    Return to Dashboard
                  </button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
        </React.Suspense>

      </main>

      {/* 4. Humble static footer */}
      <footer className="bg-white border-t border-slate-200/80 py-4 mt-12 text-center text-[11px] text-slate-400 font-mono">
        <p>NEXT Academy CRM</p>
      </footer>

      {/* 5. Change my password */}
      {showChangePassword && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl border border-line bg-white p-6 shadow-xl">
            <h3 className="mb-4 text-lg font-bold text-ink">Change my password</h3>
            <ChangePasswordForm
              member={currentMember}
              onDone={() => { setShowChangePassword(false); showToast('Your password has been changed.'); }}
              onCancel={() => setShowChangePassword(false)}
            />
          </div>
        </div>
      )}

      {/* 6. Private room (owner only) */}
      {roomOpen && ownerOverride && (
        <React.Suspense fallback={null}>
          <PrivateRoom
            off={screensOff}
            onClose={() => setRoomOpen(false)}
            loginLog={<LoginLog currentMember={currentMember} members={teamMembers.filter(m => m.active)} />}
            screen={key => key === 'data' ? <DataTools teamMembers={teamMembers} viewer={{ id: currentMember.id, name: currentMember.name }} />
              : key === 'lost' ? <LostDeletedPage viewer={{ id: currentMember.id, name: currentMember.name }} people={teamMembers.map(m => ({ id: m.id, name: m.name }))} />
              : appraisalScreen}
          />
        </React.Suspense>
      )}

      {/* 7. Small confirmation messages */}
      {toast && (
        <div role="status" className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-ink px-4 py-3 text-sm font-medium text-white shadow-lg">
          {toast}
        </div>
      )}

    </div>
  );
}
