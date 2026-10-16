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
  UserCircle2
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
const TeamManager = React.lazy(() => import('./components/TeamManager'));
const DataTools = React.lazy(() => import('./components/DataTools'));
const WorkQueue = React.lazy(() => import('./components/WorkQueue'));
import { LoadingScreen, SetupScreen, LoginForm, ForcedPasswordChangeScreen, NoAccessScreen, ChangePasswordForm } from './components/LoginScreen';
import { INITIAL_CALENDAR_EVENTS, INITIAL_NOTICES, MOTIVATIONAL_QUOTES } from './initialData';
import { Representative, CalendarEvent, ChatMessage, TeamMember, ROLE_LABELS } from './types';
import { metricsFor } from './lib/kpi';

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
  const isManagement = currentMember.role === 'management';
  const isRep = currentMember.role === 'rep';
  const isStaff = !isRep; // Admin or Management

  // Per-person KPI settings (template + targets) keyed by team member id.
  const [repDocs, setRepDocs] = useState<Record<string, { targets?: Representative['targets']; kpiTemplate?: string }>>({});
  // Typed-in weekly KPI numbers, one document per person per month: "<memberId>_<MMM-YY>".
  const [monthKpiDocs, setMonthKpiDocs] = useState<Record<string, Representative['kpi']>>({});

  // Automatic KPIs (counted from deals) are never typed in, so any old typed
  // numbers for them are ignored.
  const withoutAutoKpis = (person: { id: string; role?: string; kpiTemplate?: string; targets?: any }, kpi: Representative['kpi'] | undefined) => {
    const base: any = JSON.parse(JSON.stringify(kpi || emptyKpi()));
    metricsFor(person).forEach(m => {
      if (m.auto) base[m.key] = [0, 0, 0, 0, 0];
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
  const [managementView, setManagementView] = useState<'dashboard' | 'team' | 'data'>('dashboard');

  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>(() => {
    const saved = localStorage.getItem('next_events');
    return saved ? JSON.parse(saved) : INITIAL_CALENDAR_EVENTS;
  });

  const [notices, setNotices] = useState<string[]>(() => {
    const saved = localStorage.getItem('next_notices');
    return saved ? JSON.parse(saved) : INITIAL_NOTICES;
  });

  // Active Representative Selection (reps can only ever open their own workspace)
  const [selectedRepId, setSelectedRepId] = useState<string | null>(() => {
    const saved = localStorage.getItem('next_selected_rep_id') || null;
    if (isRep) return currentMember.id;
    return saved;
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

  // Co-Pilot Chat integration
  const [isCopilotOpen, setIsCopilotOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'model',
      text: "👋 Hello! I'm the NEXT Academy Sales & Operations Advisor. I can analyze representative conversion ratios, summarize pipeline logs, generate outreach scripts, or draft announcement schedules based on live metrics. How can I help you today?",
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isChatSending, setIsChatSending] = useState(false);

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

  // People with a sales workspace: active reps and admins. Names come from Team,
  // KPI settings from their rep document, typed-in numbers from this month's KPI document.
  const representatives: Representative[] = React.useMemo(() => {
    return teamMembers
      .filter(m => m.active && (m.role === 'rep' || m.role === 'admin'))
      .sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === 'rep' ? -1 : 1))
      .map(m => {
        const settings = repDocs[m.id] || {};
        const person = { id: m.id, role: m.role, kpiTemplate: settings.kpiTemplate, targets: settings.targets || DEFAULT_TARGETS };
        return {
          id: m.id,
          name: m.name,
          role: m.role,
          kpiTemplate: settings.kpiTemplate,
          targets: settings.targets || DEFAULT_TARGETS,
          kpi: withoutAutoKpis(person, monthKpiDocs[`${m.id}_${selectedMonth}`])
        };
      });
  }, [teamMembers, repDocs, monthKpiDocs, selectedMonth]);

  // Switching month only changes what is shown; nothing is copied or overwritten.
  const handleMonthChange = async (newMonth: string) => {
    setSelectedMonth(newMonth);
    localStorage.setItem('next_selected_month', newMonth);
  };

  // Real-time Firestore synchronizer for rep workspaces (KPI + targets only)
  useEffect(() => {
    if (!db) return;
    const unsubscribe = onSnapshot(collection(db, 'reps'), (snapshot) => {
      const next: Record<string, { targets?: Representative['targets']; kpiTemplate?: string }> = {};
      snapshot.forEach((docSnap) => {
        const data: any = docSnap.data();
        next[docSnap.id] = { targets: data.targets, kpiTemplate: data.kpiTemplate };
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
        pipes.push({ ...docSnap.data(), id: docSnap.id });
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
        quotes.push({ ...docSnap.data(), id: docSnap.id });
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
        cos.push({ ...docSnap.data(), id: docSnap.id });
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
    const people = teamMembers.map(m => ({ id: m.id, role: m.role, kpiTemplate: repDocs[m.id]?.kpiTemplate, targets: repDocs[m.id]?.targets }));
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
  const handleSelectRep = (rep: Representative) => {
    if (isRep && rep.id !== currentMember.id) {
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
    const target = representatives.find(r => r.id === repId) || representatives.find(r => r.id === currentMember.id);
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
    } catch (err) {
      console.error("Firestore add event failed:", err);
    }
  };

  const handleDeleteEvent = async (id: string) => {
    setCalendarEvents(prev => prev.filter(e => e.id !== id));
    try {
      await deleteDoc(doc(db, 'events', id));
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

  // API Client Call to backend Gemini Co-Pilot
  const handleSendChatMessage = async (customPrompt?: string) => {
    const promptToSend = customPrompt || chatInput;
    if (!promptToSend.trim() || isChatSending) return;

    const userMsg: ChatMessage = {
      id: `msg_${Date.now()}`,
      role: 'user',
      text: promptToSend,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setChatMessages(prev => [...prev, userMsg]);
    if (!customPrompt) setChatInput('');
    setIsChatSending(true);
    setIsCopilotOpen(true);

    try {
      const response = await fetch('/api/copilot', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messages: [...chatMessages, userMsg].map(m => ({ role: m.role, text: m.text })),
          datasetContext: {
            representatives,
            notices,
            eventsCount: calendarEvents.length
          }
        })
      });

      const data = await response.json();
      if (response.ok && data.response) {
        const assistantMsg: ChatMessage = {
          id: `msg_${Date.now() + 1}`,
          role: 'model',
          text: data.response,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        setChatMessages(prev => [...prev, assistantMsg]);
      } else {
        throw new Error(data.error || 'Failed to fetch model response');
      }
    } catch (err: any) {
      console.error(err);
      const errorMsg: ChatMessage = {
        id: `msg_err_${Date.now()}`,
        role: 'model',
        text: `⚠️ I ran into a connection glitch while processing that request: ${err.message || 'Unknown server error'}. Please check that your API keys are correctly defined or try again in a moment.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setChatMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsChatSending(false);
    }
  };

  // Predefined prompts for rapid query analysis
  const PRESET_PROMPTS = [
    { label: "Analyze Conversion", query: "Can you analyze the Call-to-Appointment and Appointment-to-Closing ratios for all representatives, and identify our top performing pipeline strategy?" },
    { label: "Weekly Update Email", query: "Draft a high-energy weekly recap email for the Next Academy Sales Team to summarize our performance, congratulate top closures, and remind them of the upcoming team building at Happi Village." }
  ];

  const selectedRep = representatives.find(r => r.id === selectedRepId);

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
                Team workspaces
              </button>
              {isStaff && (
                <button
                  onClick={() => handleSwitchTab('admin')}
                  className={`px-4 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
                    currentTab === 'admin'
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Admin work
                </button>
              )}
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
              <div className="flex items-center justify-end gap-1 text-slate-700">
                <Clock className="w-3.5 h-3.5 text-blue-500" />
                <span className="text-xs font-extrabold font-mono tracking-tight">
                  {formattedTime}
                </span>
              </div>
            </div>
            
            {/* Quick help button to trigger the Co-Pilot panel */}
            <button 
              onClick={() => setIsCopilotOpen(true)}
              className="w-9 h-9 rounded-full bg-slate-50 hover:bg-slate-100 flex items-center justify-center border border-slate-200 transition-all text-slate-500 hover:text-slate-800"
              title="Open Sales Assistant Co-Pilot"
            >
              <MessageSquareText className="w-4 h-4" />
            </button>
          </div>

        </div>
      </header>

      {/* 2. Main Workspace Layout Area */}
      <main className="flex-1 py-8 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full">
        
        {/* Mobile Tab switcher (visible only on small screens) */}
        {isStaff && <div className="flex md:hidden items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200 mb-6">
          <button
            onClick={() => handleSwitchTab('operations')}
            className={`flex-1 text-center py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
              currentTab === 'operations' && !selectedRepId
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Operations
          </button>
          <button
            onClick={() => handleSwitchTab('admin')}
            className={`flex-1 text-center py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
              currentTab === 'admin'
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Admin work
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
              <WorkQueue
                viewer={{ id: currentMember.id, name: currentMember.name, role: currentMember.role }}
                people={teamMembers.filter(m => m.active).map(m => ({ id: m.id, name: m.name }))}
                onOpenQuotations={handleOpenQuotationsFor}
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
              <div className="mb-5 inline-flex rounded-xl border border-line bg-white p-1" role="tablist">
                {([['dashboard', 'Dashboard'], ['team', 'Team'], ['data', 'Data tools']] as const).map(([key, label]) => (
                  <button
                    key={key}
                    role="tab"
                    aria-selected={managementView === key}
                    onClick={() => setManagementView(key)}
                    className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors ${
                      managementView === key ? 'bg-accent text-white' : 'text-ink-soft hover:text-ink'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {managementView === 'team' ? (
                <TeamManager currentMember={currentMember} teamMembers={teamMembers} />
              ) : managementView === 'data' ? (
                <DataTools teamMembers={teamMembers} />
              ) : (
              <ManagementDashboard
                reps={representatives}
                onSelectRep={(rep) => {
                  setRepSelectionSource('management');
                  setSelectedRepId(rep.id);
                  setCurrentTab('operations');
                }}
                onUpdateRepKpi={handleUpdateRepKpi}
                onUpdateRepTargets={handleUpdateRepTargets}
                onAskCopilot={(prompt) => handleSendChatMessage(prompt)}
                selectedMonth={selectedMonth}
                onMonthChange={handleMonthChange}
                onOpenTeam={() => setManagementView('team')}
                pipelinesSync={pipelinesSync}
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
              <HomeDashboard
                reps={representatives}
                events={calendarEvents}
                notices={[...notices, ...getOverduePipelineNotices()]}
                onSelectRep={handleSelectRep}
                onAddRep={() => {}}
                onAddEvent={handleAddEvent}
                onDeleteEvent={handleDeleteEvent}
                onAddNotice={handleAddNotice}
                onDeleteNotice={handleDeleteNotice}
                isManagementUnlocked={false}
                onRequestManagementUnlock={() => {
                  if (isManagement) {
                    setCurrentTab('management');
                    setManagementView('team');
                    setSelectedRepId(null);
                  } else {
                    showToast('Only Management can add people. Ask them to add new team members in Management → Team.');
                  }
                }}
                selectedMonth={selectedMonth}
                onMonthChange={handleMonthChange}
                pipelinesSync={pipelinesSync}
                tasksSync={tasksSync}
                quotationsSync={quotationsSync}
                outlinesSync={outlinesSync}
                monthKpisSync={monthKpisSync}
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
                  reps={representatives}
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
                  onAskCopilot={(prompt) => handleSendChatMessage(prompt)}
                  selectedMonth={selectedMonth}
                  onMonthChange={handleMonthChange}
                  viewer={{ id: currentMember.id, name: currentMember.name, role: currentMember.role }}
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

      {/* 3. Floating Smart AI Co-Pilot Chat Drawer (Styled in warm slate and vibrant gradients) */}
      <div className="fixed bottom-6 right-6 z-50">
        
        {/* Chat Drawer Expandable panel */}
        <AnimatePresence>
          {isCopilotOpen && (
            <motion.div
              initial={{ opacity: 0, y: 40, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 40, scale: 0.95 }}
              transition={{ duration: 0.22 }}
              className="absolute bottom-16 right-0 w-85 sm:w-96 bg-white border border-slate-200 rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-[520px]"
              id="ai-copilot-container"
            >
              {/* Co-Pilot Header */}
              <div className="bg-[#1E293B] text-white p-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-500 to-emerald-500 flex items-center justify-center">
                    <Sparkles className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <h4 className="text-xs font-black uppercase tracking-wider font-display text-white">
                      Operations Co-Pilot
                    </h4>
                    <p className="text-[9px] uppercase tracking-wider text-emerald-400 font-bold font-mono">
                      Powered by Gemini 3.5 Flash
                    </p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsCopilotOpen(false)}
                  className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Chat Messages Body */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-slate-50/50 min-h-[250px] max-h-[300px]">
                {chatMessages.map((msg) => {
                  const isModel = msg.role === 'model';
                  return (
                    <div 
                      key={msg.id} 
                      className={`flex ${isModel ? 'justify-start' : 'justify-end'}`}
                    >
                      <div className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-xs ${
                        isModel 
                          ? 'bg-white text-slate-800 border border-slate-200/80 shadow-xs leading-normal' 
                          : 'bg-[#2563EB] text-white font-medium shadow-xs'
                      }`}>
                        {/* Process simple markdown like bolding or newlines */}
                        <p className="whitespace-pre-line leading-relaxed">
                          {msg.text}
                        </p>
                        <span className={`text-[8px] mt-1 block text-right font-mono ${
                          isModel ? 'text-slate-400' : 'text-blue-200'
                        }`}>
                          {msg.timestamp}
                        </span>
                      </div>
                    </div>
                  );
                })}
                {isChatSending && (
                  <div className="flex justify-start">
                    <div className="bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-xs text-slate-500 flex items-center gap-2 shadow-xs">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
                      <span>Co-Pilot is researching...</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Quick Preset queries */}
              <div className="px-4 py-2 bg-slate-50 border-t border-b border-slate-150 flex gap-1.5 overflow-x-auto scrollbar-none">
                {PRESET_PROMPTS.map((preset, pIdx) => (
                  <button
                    key={pIdx}
                    onClick={() => handleSendChatMessage(preset.query)}
                    className="flex-shrink-0 text-[10px] bg-white border border-slate-200 text-slate-600 font-bold px-2.5 py-1 rounded-md hover:bg-slate-50 hover:border-slate-300 transition-all cursor-pointer"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              {/* Chat input form */}
              <form 
                onSubmit={(e) => { e.preventDefault(); handleSendChatMessage(); }}
                className="p-3 bg-white flex gap-2 items-center"
              >
                <input 
                  type="text" 
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Ask advisor (e.g. Compare conversions...)"
                  className="flex-1 text-xs border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-500 text-slate-800"
                />
                <button 
                  type="submit"
                  disabled={!chatInput.trim() || isChatSending}
                  className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white p-2.5 rounded-lg transition-colors flex-shrink-0 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </form>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Floating Bubble launcher button */}
        <button
          onClick={() => setIsCopilotOpen(!isCopilotOpen)}
          className="w-12 h-12 rounded-full bg-gradient-to-tr from-[#1E3A8A] to-[#10B981] text-white flex items-center justify-center shadow-xl hover:shadow-2xl hover:scale-105 active:scale-95 transition-all cursor-pointer relative"
          id="ai-copilot-trigger-btn"
        >
          {isCopilotOpen ? (
            <X className="w-5 h-5 text-white" />
          ) : (
            <>
              <Sparkles className="w-5 h-5 text-white animate-pulse" />
              <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-rose-500 border-2 border-[#f8fafc] rounded-full" />
            </>
          )}
        </button>

      </div>

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

      {/* 6. Small confirmation messages */}
      {toast && (
        <div role="status" className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-ink px-4 py-3 text-sm font-medium text-white shadow-lg">
          {toast}
        </div>
      )}

    </div>
  );
}
