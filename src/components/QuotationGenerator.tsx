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
  Key
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Firebase imports
import { db } from '../lib/firebase';
import { collection, doc, setDoc, getDoc, updateDoc, deleteDoc, onSnapshot, query, where } from 'firebase/firestore';

// Core components & initial datasets
import Logo from './components/Logo';
import HomeDashboard from './components/HomeDashboard';
import RepDetailDashboard, { getInitialPipelinesForRep } from './components/RepDetailDashboard';
import ManagementDashboard from './components/ManagementDashboard';
import { INITIAL_REPRESENTATIVES, INITIAL_CALENDAR_EVENTS, INITIAL_NOTICES, MOTIVATIONAL_QUOTES } from './initialData';
import { Representative, CalendarEvent, ChatMessage } from './types';

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

function toFirestoreRep(rep: Representative): any {
  // Deep clone so we never mutate React state in place
  const clone: any = JSON.parse(JSON.stringify(rep));
  if (clone.kpi) {
    clone.kpi = sanitizeKpiForFirestore(clone.kpi);
  }
  return clone;
}

function fromFirestoreRep(data: any): any {
  if (data && data.kpi) {
    data.kpi = hydrateKpi(data.kpi);
  }
  return data;
}

export default function App() {
  // Passwords mapping state (tied to localStorage for persistence)
  const [passwords, setPasswords] = useState<Record<string, string>>(() => {
    const saved = localStorage.getItem('next_password_mapping');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error(e);
      }
    }
    const initial = {
      'management': 'Management123',
      'xin-ying': 'XY123',
      'alif': 'Lif123',
      'atiqa': 'Atq123',
      'chee-cai': 'CC123',
      'new-guy': 'NG123'
    };
    localStorage.setItem('next_password_mapping', JSON.stringify(initial));
    return initial;
  });

  const getRequiredPassword = (idOrKey: string): string => {
    if (passwords[idOrKey]) {
      return passwords[idOrKey];
    }
    const clean = idOrKey.replace(/[^a-zA-Z]/g, '');
    const capitalized = clean.charAt(0).toUpperCase() + (clean.slice(1, 3) || '');
    return `${capitalized}123` || 'Reps123';
  };

  // Roster and Events State
  const [representatives, setRepresentatives] = useState<Representative[]>(() => {
    const saved = localStorage.getItem('next_reps');
    let repsList = INITIAL_REPRESENTATIVES;
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].kpi && 'salesFigure' in parsed[0].kpi) {
          repsList = parsed;
        }
      } catch (e) {
        console.error("Failed to parse saved representatives, resetting to initial:", e);
      }
    }
    
    // Ensure the latest target settings are updated for Chee Cai, Alif, and Ying
    return repsList.map(rep => {
      if (rep.id === 'chee-cai') {
        return {
          ...rep,
          targets: {
            salesFigure: 30000,
            preview: 25,     // Appointment
            proposals: 120    // Proposal
          }
        };
      }
      if (rep.id === 'alif') {
        return {
          ...rep,
          targets: {
            salesFigure: 60000,
            proposals: 12,    // Appointment
            preview: 6        // Public Program
          }
        };
      }
      if (rep.id === 'xin-ying') {
        return {
          ...rep,
          kpi: {
            ...rep.kpi,
            extraMetric: rep.kpi.extraMetric || [0, 0, 0, 0, 0]
          },
          targets: {
            salesFigure: 30000,
            preview: 1,       // Preview
            proposals: 8,       // Proposal
            extraMetric: 1    // Trainer Opportunity Day
          }
        };
      }
      return rep;
    });
  });

  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>(() => {
    const saved = localStorage.getItem('next_events');
    return saved ? JSON.parse(saved) : INITIAL_CALENDAR_EVENTS;
  });

  const [notices, setNotices] = useState<string[]>(() => {
    const saved = localStorage.getItem('next_notices');
    return saved ? JSON.parse(saved) : INITIAL_NOTICES;
  });

  // Active Representative Selection
  const [selectedRepId, setSelectedRepId] = useState<string | null>(() => {
    return localStorage.getItem('next_selected_rep_id') || null;
  });

  // Track if we came from operations or management to handle the Back button correctly
  const [repSelectionSource, setRepSelectionSource] = useState<'operations' | 'management'>(() => {
    const saved = localStorage.getItem('next_rep_selection_source');
    return (saved as 'operations' | 'management') || 'operations';
  });

  // Tab State ('operations' | 'management')
  const [currentTab, setCurrentTab] = useState<'operations' | 'management'>(() => {
    const saved = localStorage.getItem('next_current_tab');
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

  // Password Authentication States
  const [unlockedSections, setUnlockedSections] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('next_unlocked');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [pendingUnlock, setPendingUnlock] = useState<{ type: 'management' | 'rep'; id?: string; name: string } | null>(null);
  const [unlockPasswordInput, setUnlockPasswordInput] = useState('');
  const [unlockError, setUnlockError] = useState('');
  const [showUnlockPassword, setShowUnlockPassword] = useState(false);

  useEffect(() => {
    localStorage.setItem('next_unlocked', JSON.stringify(unlockedSections));
  }, [unlockedSections]);

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

  // Handle selected month changing
  const handleMonthChange = async (newMonth: string) => {
    // 1. Save current representative KPIs for the old month
    const storedKpis = localStorage.getItem('next_month_kpis_dict');
    const dict = storedKpis ? JSON.parse(storedKpis) : {};
    
    for (const rep of representatives) {
      const key = `${rep.id}_${selectedMonth}`;
      dict[key] = rep.kpi;
      try {
        await setDoc(doc(db, 'month_kpis', key), { kpi: sanitizeKpiForFirestore(rep.kpi), repId: rep.id, month: selectedMonth });
      } catch (err) {
        console.error("Firestore save month KPI failed:", err);
      }
    }
    localStorage.setItem('next_month_kpis_dict', JSON.stringify(dict));

    // 2. Load KPIs for the new month or set default empty KPI
    const updatedReps = await Promise.all(representatives.map(async (rep) => {
      const key = `${rep.id}_${newMonth}`;
      let monthKpi = dict[key];

      try {
        const docSnap = await getDoc(doc(db, 'month_kpis', key));
        if (docSnap.exists()) {
          monthKpi = hydrateKpi(docSnap.data().kpi);
        }
      } catch (err) {
        console.error("Firestore getDoc month KPI failed:", err);
      }

      if (!monthKpi) {
        monthKpi = {
          salesFigure: [0, 0, 0, 0, 0],
          proposals: [0, 0, 0, 0, 0],
          preview: [0, 0, 0, 0, 0]
        };
      }
      if (rep.id === 'xin-ying' && !monthKpi.extraMetric) {
        monthKpi = {
          ...monthKpi,
          extraMetric: [0, 0, 0, 0, 0]
        };
      }
      return { ...rep, kpi: monthKpi };
    }));

    // 3. Save states
    setRepresentatives(updatedReps);
    setSelectedMonth(newMonth);
    localStorage.setItem('next_selected_month', newMonth);
    localStorage.setItem('next_reps', JSON.stringify(updatedReps));

    // Push updated representatives with targets / details to Firestore
    for (const r of updatedReps) {
      try {
        await setDoc(doc(db, 'reps', r.id), toFirestoreRep(r));
      } catch (err) {
        console.error("Firestore rep update failed on month change:", err);
      }
    }
  };

  // Real-time Firestore synchronizer for Reps
  useEffect(() => {
    if (!db) return;
    const unsubscribe = onSnapshot(collection(db, 'reps'), async (snapshot) => {
      const firestoreReps: any[] = [];
      snapshot.forEach((docSnap) => {
        firestoreReps.push(fromFirestoreRep({ ...docSnap.data(), id: docSnap.id }));
      });

      if (firestoreReps.length > 0) {
        // If some representatives from the default list are missing in Firestore, seed them automatically
        const missingReps = INITIAL_REPRESENTATIVES.filter(initRep => !firestoreReps.some(fr => fr.id === initRep.id));
        if (missingReps.length > 0) {
          for (const r of missingReps) {
            try {
              await setDoc(doc(db, 'reps', r.id), toFirestoreRep(r));
            } catch (err) {
              console.error("Firestore seeding of missing rep failed:", err);
            }
          }
          return;
        }

        const orderMap = { 'xin-ying': 0, 'chee-cai': 1, 'alif': 2, 'atiqa': 3, 'new-guy': 4 };
        firestoreReps.sort((a, b) => {
          const idxA = orderMap[a.id as keyof typeof orderMap] !== undefined ? orderMap[a.id as keyof typeof orderMap] : 99;
          const idxB = orderMap[b.id as keyof typeof orderMap] !== undefined ? orderMap[b.id as keyof typeof orderMap] : 99;
          return idxA - idxB;
        });

        // Resolve local month state sync
        const storedKpis = localStorage.getItem('next_month_kpis_dict');
        const dict = storedKpis ? JSON.parse(storedKpis) : {};
        const mergedReps = firestoreReps.map(rep => {
          const key = `${rep.id}_${selectedMonth}`;
          // Always prefer the live Firestore KPI if available to ensure correct sync between phone and PC
          let monthKpi = rep.kpi || dict[key];
          if (rep.id === 'xin-ying' && (!monthKpi || !monthKpi.extraMetric)) {
            monthKpi = {
              ...(monthKpi || {}),
              salesFigure: monthKpi?.salesFigure || [0, 0, 0, 0, 0],
              proposals: monthKpi?.proposals || [0, 0, 0, 0, 0],
              preview: monthKpi?.preview || [0, 0, 0, 0, 0],
              extraMetric: [0, 0, 0, 0, 0]
            };
          }
          if (monthKpi) {
            dict[key] = monthKpi;
          }
          return { ...rep, kpi: monthKpi };
        });

        localStorage.setItem('next_month_kpis_dict', JSON.stringify(dict));
        setRepresentatives(mergedReps);
        localStorage.setItem('next_reps', JSON.stringify(mergedReps));
      } else {
        // No reps in Firestore yet, seed them from local storage / initial data
        const saved = localStorage.getItem('next_reps');
        let repsList = representatives;
        if (saved) {
          try { repsList = JSON.parse(saved); } catch {}
        }
        if (repsList && repsList.length > 0) {
          for (const r of repsList) {
            await setDoc(doc(db, 'reps', r.id), toFirestoreRep(r));
          }
        }
      }
    });
    return () => unsubscribe();
  }, [selectedMonth]);

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

  // Real-time Firestore synchronizer for Notices & Passwords Configuration
  useEffect(() => {
    if (!db) return;

    // Migrate defaults if needed
    const migrateConfig = async () => {
      try {
        const noticeSnap = await getDoc(doc(db, 'config', 'notices'));
        if (!noticeSnap.exists()) {
          await setDoc(doc(db, 'config', 'notices'), { notices });
        }
        const passSnap = await getDoc(doc(db, 'config', 'passwords'));
        if (!passSnap.exists()) {
          await setDoc(doc(db, 'config', 'passwords'), { passwords });
        }
      } catch (err) {
        const errorMsg = String(err);
        const isOffline = errorMsg.toLowerCase().includes('offline') || errorMsg.toLowerCase().includes('unavailable');
        if (isOffline) {
          console.warn("Config migration status: client is offline, using local storage cache fallbacks.");
        } else {
          console.warn("Config migration notice:", err);
        }
      }
    };
    migrateConfig();

    const unsubscribe = onSnapshot(collection(db, 'config'), (snapshot) => {
      snapshot.forEach((docSnap) => {
        if (docSnap.id === 'notices') {
          const data = docSnap.data();
          if (data && Array.isArray(data.notices)) {
            setNotices(data.notices);
            localStorage.setItem('next_notices', JSON.stringify(data.notices));
          }
        }
        if (docSnap.id === 'passwords') {
          const data = docSnap.data();
          if (data && data.passwords) {
            setPasswords(data.passwords);
            localStorage.setItem('next_password_mapping', JSON.stringify(data.passwords));
          }
        }
      });
    });

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
        const repIds = ['xin-ying', 'chee-cai', 'alif', 'atiqa', 'new-guy'];
        repIds.forEach(id => {
          const ownedPipes = pipes.filter(p => p.ownerId === id || p.creatorId === id || p.taggedRepIds?.includes(id));
          localStorage.setItem(`next_pipelines_${id}`, JSON.stringify(ownedPipes));
        });
        setPipelinesSync(pipes);
      } else {
        // Firestore genuinely has none left (all deleted) - reflect that truthfully
        // instead of leaving stale data in this sync state forever.
        localStorage.setItem('next_pipelines_shared', JSON.stringify([]));
        const repIds = ['xin-ying', 'chee-cai', 'alif', 'atiqa', 'new-guy'];
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
        const repIds = ['xin-ying', 'chee-cai', 'alif', 'atiqa', 'new-guy'];
        repIds.forEach(id => {
          const repTasks = ts.filter(t => t.ownerRepId === id);
          localStorage.setItem(`next_tasks_${id}`, JSON.stringify(repTasks));
        });
        setTasksSync(ts);
      } else {
        const repIds = ['xin-ying', 'chee-cai', 'alif', 'atiqa', 'new-guy'];
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

    // 5. Month KPIs Real-time Sync
    const unsubscribeMonthKpis = onSnapshot(collection(db, 'month_kpis'), (snapshot) => {
      const storedKpis = localStorage.getItem('next_month_kpis_dict');
      const dict = storedKpis ? JSON.parse(storedKpis) : {};
      let changed = false;
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        if (data && data.kpi) {
          const key = docSnap.id;
          dict[key] = hydrateKpi(data.kpi);
          changed = true;
        }
      });
      if (changed) {
        localStorage.setItem('next_month_kpis_dict', JSON.stringify(dict));
        setMonthKpisSync(Object.values(dict));
      }
    });

    return () => {
      unsubscribePipes();
      unsubscribeTasks();
      unsubscribeQuotes();
      unsubscribeOutlines();
      unsubscribeMonthKpis();
    };
  }, []);

  // Sync back local representative & KPI state changes to local storage for caching
  useEffect(() => {
    const storedKpis = localStorage.getItem('next_month_kpis_dict');
    const dict = storedKpis ? JSON.parse(storedKpis) : {};
    representatives.forEach(rep => {
      dict[`${rep.id}_${selectedMonth}`] = rep.kpi;
    });
    localStorage.setItem('next_month_kpis_dict', JSON.stringify(dict));
  }, [representatives, selectedMonth]);

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
    // If management is unlocked, we bypass individual rep passwords (administrative override)
    if (unlockedSections.includes('management') || unlockedSections.includes(rep.id)) {
      setRepSelectionSource('operations');
      setSelectedRepId(rep.id);
      setCurrentTab('operations');
    } else {
      setUnlockError('');
      setUnlockPasswordInput('');
      setShowUnlockPassword(false);
      setPendingUnlock({ type: 'rep', id: rep.id, name: rep.name });
    }
  };

  const handleSwitchTab = (tab: 'operations' | 'management') => {
    if (tab === 'management') {
      if (unlockedSections.includes('management')) {
        setCurrentTab('management');
        setSelectedRepId(null);
      } else {
        setUnlockError('');
        setUnlockPasswordInput('');
        setShowUnlockPassword(false);
        setPendingUnlock({ type: 'management', name: 'Management Console' });
      }
    } else {
      setCurrentTab('operations');
      setSelectedRepId(null);
    }
  };

  const handleVerifyPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingUnlock) return;

    const targetKey = pendingUnlock.type === 'management' ? 'management' : (pendingUnlock.id || '');
    const correctPassword = getRequiredPassword(targetKey);

    if (unlockPasswordInput === correctPassword) {
      setUnlockedSections(prev => [...prev, targetKey]);
      setUnlockPasswordInput('');
      setUnlockError('');
      setShowUnlockPassword(false);

      if (pendingUnlock.type === 'management') {
        setCurrentTab('management');
        setSelectedRepId(null);
      } else {
        setRepSelectionSource('operations');
        setSelectedRepId(pendingUnlock.id || null);
        setCurrentTab('operations');
      }
      setPendingUnlock(null);
    } else {
      setUnlockError('Incorrect password. Please try again.');
    }
  };

  const handleLockSection = (key: string) => {
    setUnlockedSections(prev => prev.filter(k => k !== key));
    if (key === 'management') {
      setCurrentTab('operations');
    } else if (selectedRepId === key) {
      setSelectedRepId(null);
    }
  };

  const handleAddRep = async (name: string) => {
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const newRep: Representative = {
      id,
      name,
      kpi: {
        salesFigure: [0, 0, 0, 0, 0],
        proposals: [0, 0, 0, 0, 0],
        preview: [0, 0, 0, 0, 0]
      },
      targets: {
        salesFigure: 30000,
        proposals: 2,
        preview: 1
      }
    };
    setRepresentatives(prev => [...prev, newRep]);
    try {
      await setDoc(doc(db, 'reps', id), toFirestoreRep(newRep));
    } catch (err) {
      console.error("Firestore add rep failed:", err);
    }
  };

  const handleUpdatePasswords = async (updatedPasswords: Record<string, string>) => {
    setPasswords(updatedPasswords);
    localStorage.setItem('next_password_mapping', JSON.stringify(updatedPasswords));
    try {
      await setDoc(doc(db, 'config', 'passwords'), { passwords: updatedPasswords });
    } catch (err) {
      console.error("Firestore passwords update failed:", err);
    }
  };

  const handleUpdateRepsList = async (updatedReps: Representative[]) => {
    const updatedIds = new Set(updatedReps.map(r => r.id));
    const removedReps = representatives.filter(r => !updatedIds.has(r.id));

    setRepresentatives(updatedReps);
    localStorage.setItem('next_reps', JSON.stringify(updatedReps));

    for (const r of updatedReps) {
      try {
        await setDoc(doc(db, 'reps', r.id), toFirestoreRep(r));
      } catch (err) {
        console.error("Firestore update reps list failed:", err);
      }
    }

    // Actually delete any rep that was removed from the roster — without this,
    // their Firestore document stays behind and the real-time listener keeps
    // pulling them right back into the list.
    for (const r of removedReps) {
      try {
        await deleteDoc(doc(db, 'reps', r.id));
      } catch (err) {
        console.error("Firestore delete rep failed:", err);
      }
    }
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
      if (rep.id === 'atiqa') return;

      const saved = localStorage.getItem(`next_pipelines_${rep.id}`);
      let pipes: any[] = [];
      if (saved) {
        try {
          pipes = JSON.parse(saved);
        } catch {
          // ignore
        }
      } else {
        try {
          pipes = getInitialPipelinesForRep(rep.id);
        } catch {
          // ignore
        }
      }

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

  // Handlers for DetailDashboard metrics modification
  const handleUpdateRepKpi = async (repId: string, updatedKpi: Representative['kpi']) => {
    const targetRep = representatives.find(rep => rep.id === repId);
    if (targetRep) {
      const updatedRep = { ...targetRep, kpi: updatedKpi };
      setRepresentatives(prev => prev.map(rep => rep.id === repId ? updatedRep : rep));
      try {
        await setDoc(doc(db, 'reps', repId), toFirestoreRep(updatedRep));
        
        // Also update month_kpis collection to maintain historical month integrity across all devices
        const key = `${repId}_${selectedMonth}`;
        await setDoc(doc(db, 'month_kpis', key), { kpi: sanitizeKpiForFirestore(updatedKpi), repId, month: selectedMonth });
      } catch (err) {
        console.error("Firestore update rep KPI failed:", err);
      }
    }
  };

  const handleUpdateRepTargets = async (repId: string, updatedTargets: Representative['targets']) => {
    const targetRep = representatives.find(rep => rep.id === repId);
    if (targetRep) {
      const updatedRep = { ...targetRep, targets: updatedTargets };
      setRepresentatives(prev => prev.map(rep => rep.id === repId ? updatedRep : rep));
      try {
        await setDoc(doc(db, 'reps', repId), toFirestoreRep(updatedRep));
      } catch (err) {
        console.error("Firestore update rep targets failed:", err);
      }
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
    { label: "Improve Atiqa performance", query: "Write a professional coaching outreach message for Atiqa, offering tips to scale her appointments to closed units from 8% to our 15% ideal standard." },
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
                Operations Room
              </button>
              <button
                onClick={() => handleSwitchTab('management')}
                className={`px-4 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
                  currentTab === 'management'
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Management Console
              </button>
            </div>
          </div>

          {/* Active Session Badges & Real-time Dynamic Date & Time */}
          <div className="flex items-center gap-4 text-right">
            {/* Active Session Badges */}
            {unlockedSections.length > 0 && (
              <div className="hidden md:flex items-center gap-2">
                {unlockedSections.includes('management') && (
                  <div className="flex items-center gap-1.5 bg-rose-50 border border-rose-100 px-3 py-1.5 rounded-lg text-xs font-bold text-rose-700 shadow-xs">
                    <Lock className="w-3 h-3 text-rose-500" />
                    <span>Admin Active</span>
                    <button 
                      onClick={() => handleLockSection('management')}
                      className="ml-1 text-rose-400 hover:text-rose-700 transition-colors uppercase text-[9px] font-black underline cursor-pointer"
                      title="Lock Management Console"
                    >
                      Lock
                    </button>
                  </div>
                )}
                {unlockedSections.filter(k => k !== 'management').map(repKey => {
                  const rep = representatives.find(r => r.id === repKey);
                  if (!rep) return null;
                  return (
                    <div key={repKey} className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-100 px-3 py-1.5 rounded-lg text-xs font-bold text-emerald-700 shadow-xs">
                      <Unlock className="w-3 h-3 text-emerald-500 animate-pulse" />
                      <span className="truncate max-w-[80px]">{rep.name} Active</span>
                      <button 
                        onClick={() => handleLockSection(repKey)}
                        className="ml-1 text-emerald-400 hover:text-emerald-700 transition-colors uppercase text-[9px] font-black underline cursor-pointer"
                        title={`Lock ${rep.name} Console`}
                      >
                        Lock
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

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
        <div className="flex md:hidden items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200 mb-6">
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
            onClick={() => handleSwitchTab('management')}
            className={`flex-1 text-center py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
              currentTab === 'management'
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Management
          </button>
        </div>

        <AnimatePresence mode="wait">
          {currentTab === 'management' ? (
            /* C. MANAGEMENT VIEW */
            <motion.div
              key="management"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.25 }}
            >
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
                passwords={passwords}
                onUpdatePasswords={handleUpdatePasswords}
                onUpdateRepsList={handleUpdateRepsList}
              />
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
                onAddRep={handleAddRep}
                onAddEvent={handleAddEvent}
                onDeleteEvent={handleDeleteEvent}
                onAddNotice={handleAddNotice}
                onDeleteNotice={handleDeleteNotice}
                isManagementUnlocked={unlockedSections.includes('management')}
                onRequestManagementUnlock={() => {
                  setUnlockError('');
                  setUnlockPasswordInput('');
                  setShowUnlockPassword(false);
                  setPendingUnlock({ type: 'management', name: 'Management Console' });
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
                    } else {
                      setCurrentTab('operations');
                    }
                    setSelectedRepId(null);
                  }}
                  onUpdateRepKpi={handleUpdateRepKpi}
                  onAskCopilot={(prompt) => handleSendChatMessage(prompt)}
                  selectedMonth={selectedMonth}
                  onMonthChange={handleMonthChange}
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
        <p>NEXT ACADEMY OPERATIONS SUITE • POWERED BY GEMINI 3.5 FLASH • SECURE PREVIEW RUNTIME</p>
      </footer>

      {/* 5. Password Authentication Gate Modal */}
      <AnimatePresence>
        {pendingUnlock && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-md"
            id="password-auth-overlay"
          >
            <motion.div
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              transition={{ type: 'spring', duration: 0.4 }}
              className="bg-white border border-slate-200 shadow-2xl rounded-2xl max-w-md w-full p-6 sm:p-8 flex flex-col space-y-5 text-center overflow-hidden relative"
              id="password-card"
            >
              {/* Top styled lock circle */}
              <div className="mx-auto w-12 h-12 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 animate-bounce">
                <Lock className="w-5 h-5" />
              </div>

              {/* Title & Info */}
              <div className="space-y-1.5">
                <h3 className="text-lg font-black text-slate-800 uppercase tracking-wide font-display">
                  Unlock Access
                </h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Enter password to unlock the <span className="font-extrabold text-blue-600">{pendingUnlock.name}</span>.
                </p>
              </div>

              {/* Input Form */}
              <form onSubmit={handleVerifyPassword} className="space-y-4">
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-400">
                    <Key className="w-4 h-4" />
                  </span>
                  <input
                    type={showUnlockPassword ? "text" : "password"}
                    value={unlockPasswordInput}
                    onChange={(e) => {
                      setUnlockPasswordInput(e.target.value);
                      if (unlockError) setUnlockError('');
                    }}
                    placeholder="Enter lock password..."
                    autoFocus
                    required
                    className="w-full pl-10 pr-10 py-3 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 text-slate-800 font-medium tracking-wide shadow-xs"
                    id="password-input-field"
                  />
                  <button
                    type="button"
                    onClick={() => setShowUnlockPassword(!showUnlockPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    {showUnlockPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>

                {unlockError && (
                  <motion.p
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-xs font-semibold text-rose-500 text-left"
                  >
                    ⚠️ {unlockError}
                  </motion.p>
                )}

                {/* Submit and Cancel Buttons */}
                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPendingUnlock(null);
                      setUnlockPasswordInput('');
                      setUnlockError('');
                      setShowUnlockPassword(false);
                    }}
                    className="flex-1 py-3 px-4 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-black uppercase tracking-wider transition-all cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-md shadow-blue-500/15 cursor-pointer"
                  >
                    Unlock
                  </button>
                </div>
              </form>



            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}

