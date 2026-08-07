import React, { useState, useEffect } from 'react';
import { Representative, CalendarEvent } from '../types';
import { getRepMetrics } from '../initialData';
import { Plus, Calendar, ChevronLeft, ChevronRight, Edit3, Trash2, Megaphone, HelpCircle, Check, Users, RefreshCw } from 'lucide-react';
import { initAuth, googleSignIn, googleSignOut, syncEventToGoogleCalendar } from '../lib/googleCalendar';
import { getDeletedPipelineIds } from './RepDetailDashboard';

interface HomeDashboardProps {
  reps: Representative[];
  events: CalendarEvent[];
  notices: string[];
  onSelectRep: (rep: Representative) => void;
  onAddRep: (name: string) => void;
  onAddEvent: (event: Omit<CalendarEvent, 'id'>) => void;
  onDeleteEvent: (id: string) => void;
  onAddNotice: (notice: string) => void;
  onDeleteNotice: (idx: number) => void;
  isManagementUnlocked: boolean;
  onRequestManagementUnlock: () => void;
  selectedMonth: string;
  onMonthChange: (month: string) => void;
  pipelinesSync?: any[];
  tasksSync?: any[];
  quotationsSync?: any[];
  outlinesSync?: any[];
  monthKpisSync?: any[];
}

const getSharedPipelines = (repsList: any[], pipelinesSync?: any[]): any[] => {
  const deleted = getDeletedPipelineIds();
  if (pipelinesSync) {
    return pipelinesSync
      .filter((p: any) => !deleted.includes(p.id))
      .map((p: any) => p.id === 'pipe_4' && p.proposalValue === 65000 ? { ...p, proposalValue: 0 } : p);
  }
  const saved = localStorage.getItem('next_pipelines_shared');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      let modified = false;
      parsed.forEach((p: any) => {
        if (p.id === 'pipe_4' && p.proposalValue === 65000) {
          p.proposalValue = 0;
          modified = true;
        }
      });
      if (modified) {
        localStorage.setItem('next_pipelines_shared', JSON.stringify(parsed));
      }
      return parsed.filter((p: any) => !deleted.includes(p.id));
    } catch {
      return [];
    }
  }

  if (localStorage.getItem('migrated_pipelines_to_firestore') === 'true') {
    return [];
  }

  const combined: any[] = [];
  const repIds = ['xin-ying', 'chee-cai', 'alif', 'atiqa', 'new-guy'];
  if (repsList && repsList.length > 0) {
    repsList.forEach(r => {
      if (!repIds.includes(r.id)) {
        repIds.push(r.id);
      }
    });
  }

  repIds.forEach(repId => {
    let repPipes: any[] = [];
    const localSaved = localStorage.getItem(`next_pipelines_${repId}`);
    if (localSaved) {
      try {
        repPipes = JSON.parse(localSaved);
      } catch {
        repPipes = [];
      }
    } else {
      if (repId === 'chee-cai') {
        repPipes = [
          {
            id: 'pipe_1',
            requestDate: '2026-07-01',
            type: 'Training',
            proposalSentDate: '2026-07-03',
            proposalValue: 45000,
            followUpDate: '2026-07-10',
            status: 'Won',
            client: 'Petronas Digital',
            courseName: 'React & TypeScript Enterprise Workshop'
          },
          {
            id: 'pipe_2',
            requestDate: '2026-07-05',
            type: 'Teambuilding',
            proposalSentDate: '2026-07-07',
            proposalValue: 18500,
            followUpDate: '2026-07-12',
            status: 'Pending',
            client: 'CIMB Bank',
            courseName: 'Strategic Leadership Offsite'
          }
        ];
      } else if (repId === 'alif') {
        repPipes = [
          {
            id: 'pipe_3',
            requestDate: '2026-07-02',
            type: 'Training',
            proposalSentDate: '2026-07-04',
            proposalValue: 22000,
            followUpDate: '2026-07-09',
            status: 'Pending',
            client: 'Grab Malaysia',
            courseName: 'Modern Frontend Scaling'
          }
        ];
      } else if (repId === 'xin-ying') {
        repPipes = [
          {
            id: 'pipe_4',
            requestDate: '2026-06-28',
            type: 'Training',
            proposalSentDate: '2026-06-30',
            proposalValue: 0,
            followUpDate: '2026-07-08',
            status: 'Won',
            client: 'Maybank HQ',
            courseName: 'Full-Stack Engineering Boot Camp'
          }
        ];
      }
    }

    const repObj = repsList.find(r => r.id === repId);
    const repName = repObj ? repObj.name : (repId.charAt(0).toUpperCase() + repId.slice(1).replace('-', ' '));

    repPipes.forEach(p => {
      combined.push({
        ...p,
        creatorId: p.creatorId || repId,
        creatorName: p.creatorName || repName,
        ownerId: p.ownerId || repId,
        ownerName: p.ownerName || repName,
      });
    });
  });

  localStorage.setItem('next_pipelines_shared', JSON.stringify(combined));
  return combined;
};

const getRepAlertStatus = (
  repId: string,
  repsList: any[],
  pipelinesSync?: any[],
  tasksSync?: any[],
  quotationsSync?: any[],
  outlinesSync?: any[]
) => {
  const actualRepsList = repsList || [];
  let hasUnattendedTasks = false;
  try {
    let repTasks: any[] = [];
    if (tasksSync && tasksSync.length > 0) {
      repTasks = tasksSync.filter((t: any) => t.ownerRepId === repId);
    } else {
      const savedTasks = localStorage.getItem(`next_tasks_${repId}`);
      if (savedTasks) {
        repTasks = JSON.parse(savedTasks);
      }
    }
    hasUnattendedTasks = repTasks.some((t: any) => t.status !== 'Done');
  } catch (e) {
    console.error(e);
  }

  let hasTaggedPipelines = false;
  let hasOverduePipelines = false;
  try {
    const sharedPipes = getSharedPipelines(actualRepsList, pipelinesSync);
    hasTaggedPipelines = sharedPipes.some((p: any) => p.taggedRepIds?.includes(repId) && !p.completedTags?.includes(repId));
    
    // isOverdue helper function
    const isOverdue = (p: any) => {
      if (p.status !== 'Pending') return false;
      if (p.proposalSentDate && p.proposalSentDate !== 'not yet') return false;
      try {
        const reqDate = new Date(p.requestDate);
        const today = new Date();
        const diffTime = today.getTime() - reqDate.getTime();
        const diffDays = diffTime / (1000 * 60 * 60 * 24);
        return diffDays > 2;
      } catch {
        return false;
      }
    };
    hasOverduePipelines = sharedPipes.some((p: any) => p.ownerId === repId && isOverdue(p));
  } catch (e) {
    console.error(e);
  }

  let isTaggedInWeeklyReports = false;
  let isAccountabilityPartnerAlert = false;
  try {
    actualRepsList.forEach(otherRep => {
      if (otherRep.id !== repId && otherRep.kpi) {
        // Check legacy/week 0 tag
        const isLegacyTagged = otherRep.kpi.taggedRepIds && Array.isArray(otherRep.kpi.taggedRepIds) && otherRep.kpi.taggedRepIds.includes(repId);
        const isLegacyCompleted = otherRep.kpi.completedTags && Array.isArray(otherRep.kpi.completedTags) && otherRep.kpi.completedTags.includes(repId);
        if (isLegacyTagged && !isLegacyCompleted) {
          isTaggedInWeeklyReports = true;
        }
        // Check list-based tags for all weeks
        if (otherRep.kpi.taggedRepIdsList && Array.isArray(otherRep.kpi.taggedRepIdsList)) {
          otherRep.kpi.taggedRepIdsList.forEach((weekTags: any, weekIdx: number) => {
            if (Array.isArray(weekTags) && weekTags.includes(repId)) {
              const weekCompletedList = otherRep.kpi.completedTagsList && Array.isArray(otherRep.kpi.completedTagsList) ? otherRep.kpi.completedTagsList[weekIdx] : [];
              const isCompleted = Array.isArray(weekCompletedList) && weekCompletedList.includes(repId);
              if (!isCompleted) {
                isTaggedInWeeklyReports = true;
              }
            }
          });
        }
        // Check accountability partner for all weeks
        if (otherRep.kpi.accountabilityPartnerIdList && Array.isArray(otherRep.kpi.accountabilityPartnerIdList)) {
          otherRep.kpi.accountabilityPartnerIdList.forEach((partnerId: any, weekIdx: number) => {
            if (partnerId === repId) {
              const isDone = otherRep.kpi.completedAccountabilityList && Array.isArray(otherRep.kpi.completedAccountabilityList) ? otherRep.kpi.completedAccountabilityList[weekIdx] : false;
              if (!isDone) {
                isAccountabilityPartnerAlert = true;
              }
            }
          });
        }
      }
    });
  } catch (e) {
    console.error(e);
  }

  let hasTaggedQuotations = false;
  try {
    let quotes: any[] = [];
    if (quotationsSync && quotationsSync.length > 0) {
      quotes = quotationsSync;
    } else {
      const savedQuotes = localStorage.getItem('next_quotations_lzk.joel@gmail.com');
      if (savedQuotes) {
        quotes = JSON.parse(savedQuotes);
      }
    }
    hasTaggedQuotations = Array.isArray(quotes) && quotes.some((q: any) => q.taggedRepId === repId && !q.isCompleted);
  } catch (e) {
    console.error(e);
  }

  let hasTaggedCourseOutlines = false;
  try {
    let outlines: any[] = [];
    if (outlinesSync && outlinesSync.length > 0) {
      outlines = outlinesSync;
    } else {
      const savedOutlines = localStorage.getItem('next_course_outlines_lzk.joel@gmail.com');
      if (savedOutlines) {
        outlines = JSON.parse(savedOutlines);
      }
    }
    hasTaggedCourseOutlines = Array.isArray(outlines) && outlines.some((o: any) => o.taggedRepId === repId && !o.isCompleted);
  } catch (e) {
    console.error(e);
  }

  const hasTags = hasTaggedPipelines || isTaggedInWeeklyReports || isAccountabilityPartnerAlert || hasTaggedQuotations || hasTaggedCourseOutlines || hasOverduePipelines;

  return {
    hasUnattendedTasks,
    hasTaggedPipelines,
    isTaggedInWeeklyReports,
    isAccountabilityPartnerAlert,
    hasTaggedQuotations,
    hasTaggedCourseOutlines,
    hasOverduePipelines,
    hasTags,
    shouldFlash: hasUnattendedTasks || hasTags
  };
};

export default function HomeDashboard({
  reps,
  events,
  notices,
  onSelectRep,
  onAddRep,
  onAddEvent,
  onDeleteEvent,
  onAddNotice,
  onDeleteNotice,
  isManagementUnlocked,
  onRequestManagementUnlock,
  selectedMonth,
  onMonthChange,
  pipelinesSync,
  tasksSync,
  quotationsSync,
  outlinesSync,
  monthKpisSync
}: HomeDashboardProps) {
  // Calendar state
  const [currentYear, setCurrentYear] = useState(2026);
  const [currentMonth, setCurrentMonth] = useState(6); // 6 is July (0-indexed: January is 0, July is 6)
  const [selectedDayStr, setSelectedDayStr] = useState<string>('2026-07-06');
  const [showAddEventModal, setShowAddEventModal] = useState(false);
  const [newEventTitle, setNewEventTitle] = useState('');
  const [newEventTime, setNewEventTime] = useState('10:00 AM');
  const [newEventColor, setNewEventColor] = useState('bg-blue-500');

  // Representative management
  const [showAddRepModal, setShowAddRepModal] = useState(false);
  const [newRepName, setNewRepName] = useState('');

  // Notice management
  const [newNoticeText, setNewNoticeText] = useState('');
  const [showNoticeInput, setShowNoticeInput] = useState(false);

  // Google Calendar Integration State
  const [googleUser, setGoogleUser] = useState<any>(null);
  const [googleToken, setGoogleToken] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatusMsg, setSyncStatusMsg] = useState<string | null>(null);
  const [selectedRepIdsForEvent, setSelectedRepIdsForEvent] = useState<string[]>([]);
  const [syncToGoogleCheckbox, setSyncToGoogleCheckbox] = useState(true);

  // Setup Firebase Auth Listener for Google Workspace API Sync
  useEffect(() => {
    const unsubscribe = initAuth(
      (user, token) => {
        if (user.email === 'lzk.joel@gmail.com') {
          googleSignOut();
          setGoogleUser(null);
          setGoogleToken(null);
          setSyncStatusMsg("lzk.joel@gmail.com calendar is disconnected. Only nextacademy24@gmail.com calendar is supported.");
          setTimeout(() => setSyncStatusMsg(null), 6000);
        } else {
          setGoogleUser(user);
          setGoogleToken(token);
        }
      },
      () => {
        setGoogleUser(null);
        setGoogleToken(null);
      }
    );
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, []);

  // Month navigation helpers
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(prev => prev - 1);
    } else {
      setCurrentMonth(prev => prev - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(prev => prev + 1);
    } else {
      setCurrentMonth(prev => prev + 1);
    }
  };

  // Generate July 2026 Calendar days
  // In July 2026: Wednesday is 1st.
  // Let's create a hardcoded or calculated grid of 35 days (Mon to Sun) starting from Mon Jun 29.
  // Jun 29, Jun 30, Jul 1, Jul 2, Jul 3, Jul 4, Jul 5
  // Jul 6 ... Jul 12
  // Jul 13 ... Jul 19
  // Jul 20 ... Jul 26
  // Jul 27 ... Aug 2
  const calendarGrid = [
    // Week 1
    { dayNum: 29, dateStr: '2026-06-29', isCurrentMonth: false },
    { dayNum: 30, dateStr: '2026-06-30', isCurrentMonth: false },
    { dayNum: 1, dateStr: '2026-07-01', isCurrentMonth: true },
    { dayNum: 2, dateStr: '2026-07-02', isCurrentMonth: true },
    { dayNum: 3, dateStr: '2026-07-03', isCurrentMonth: true },
    { dayNum: 4, dateStr: '2026-07-04', isCurrentMonth: true },
    { dayNum: 5, dateStr: '2026-07-05', isCurrentMonth: true },
    // Week 2
    { dayNum: 6, dateStr: '2026-07-06', isCurrentMonth: true },
    { dayNum: 7, dateStr: '2026-07-07', isCurrentMonth: true },
    { dayNum: 8, dateStr: '2026-07-08', isCurrentMonth: true },
    { dayNum: 9, dateStr: '2026-07-09', isCurrentMonth: true },
    { dayNum: 10, dateStr: '2026-07-10', isCurrentMonth: true },
    { dayNum: 11, dateStr: '2026-07-11', isCurrentMonth: true },
    { dayNum: 12, dateStr: '2026-07-12', isCurrentMonth: true },
    // Week 3
    { dayNum: 13, dateStr: '2026-07-13', isCurrentMonth: true },
    { dayNum: 14, dateStr: '2026-07-14', isCurrentMonth: true },
    { dayNum: 15, dateStr: '2026-07-15', isCurrentMonth: true },
    { dayNum: 16, dateStr: '2026-07-16', isCurrentMonth: true },
    { dayNum: 17, dateStr: '2026-07-17', isCurrentMonth: true },
    { dayNum: 18, dateStr: '2026-07-18', isCurrentMonth: true },
    { dayNum: 19, dateStr: '2026-07-19', isCurrentMonth: true },
    // Week 4
    { dayNum: 20, dateStr: '2026-07-20', isCurrentMonth: true },
    { dayNum: 21, dateStr: '2026-07-21', isCurrentMonth: true },
    { dayNum: 22, dateStr: '2026-07-22', isCurrentMonth: true },
    { dayNum: 23, dateStr: '2026-07-23', isCurrentMonth: true },
    { dayNum: 24, dateStr: '2026-07-24', isCurrentMonth: true },
    { dayNum: 25, dateStr: '2026-07-25', isCurrentMonth: true },
    { dayNum: 26, dateStr: '2026-07-26', isCurrentMonth: true },
    // Week 5
    { dayNum: 27, dateStr: '2026-07-27', isCurrentMonth: true },
    { dayNum: 28, dateStr: '2026-07-28', isCurrentMonth: true },
    { dayNum: 29, dateStr: '2026-07-29', isCurrentMonth: true },
    { dayNum: 30, dateStr: '2026-07-30', isCurrentMonth: true },
    { dayNum: 31, dateStr: '2026-07-31', isCurrentMonth: true },
    { dayNum: 1, dateStr: '2026-08-01', isCurrentMonth: false },
    { dayNum: 2, dateStr: '2026-08-02', isCurrentMonth: false }
  ];

  // Selected day events
  const selectedDayEvents = events.filter(e => e.date === selectedDayStr);

  const handleAddEventSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEventTitle.trim()) return;

    // Fetch attendee emails
    const attendeeEmails = selectedRepIdsForEvent.map(repId => {
      const foundRep = reps.find(r => r.id === repId);
      return foundRep?.email || `${repId}@nextenergy24.com`;
    });

    let googleSyncSucceeded = false;
    let syncErrorMsg = null;

    if (syncToGoogleCheckbox && googleToken) {
      setIsSyncing(true);
      setSyncStatusMsg("Syncing event with Google Calendar...");
      try {
        await syncEventToGoogleCalendar(
          newEventTitle,
          selectedDayStr,
          newEventTime,
          attendeeEmails
        );
        googleSyncSucceeded = true;
      } catch (err: any) {
        console.error("Google Calendar Sync failed:", err);
        syncErrorMsg = err.message || String(err);
      } finally {
        setIsSyncing(false);
      }
    }

    onAddEvent({
      time: newEventTime,
      title: newEventTitle,
      date: selectedDayStr,
      color: newEventColor,
      attendees: selectedRepIdsForEvent,
      syncWithGoogle: googleSyncSucceeded,
      gmailCalendarSync: googleUser?.email || 'nextacademy24@gmail.com'
    });

    if (googleSyncSucceeded) {
      setSyncStatusMsg("Successfully added event and synced with Google Calendar!");
      setTimeout(() => setSyncStatusMsg(null), 4000);
    } else if (syncErrorMsg) {
      setSyncStatusMsg(`Event added locally, but Google Calendar sync failed: ${syncErrorMsg}`);
      setTimeout(() => setSyncStatusMsg(null), 6000);
    } else {
      setSyncStatusMsg("Event added locally!");
      setTimeout(() => setSyncStatusMsg(null), 3000);
    }

    setNewEventTitle('');
    setSelectedRepIdsForEvent([]);
    setShowAddEventModal(false);
  };

  const handleGoogleLogin = async () => {
    try {
      setSyncStatusMsg("Opening Google Sign-In...");
      const res = await googleSignIn();
      if (res) {
        if (res.user.email === 'lzk.joel@gmail.com') {
          await googleSignOut();
          setGoogleUser(null);
          setGoogleToken(null);
          setSyncStatusMsg("lzk.joel@gmail.com calendar is disconnected. Only nextacademy24@gmail.com calendar is supported.");
          setTimeout(() => setSyncStatusMsg(null), 6000);
        } else {
          setGoogleUser(res.user);
          setGoogleToken(res.accessToken);
          setSyncStatusMsg("Connected to Google Calendar successfully!");
          setTimeout(() => setSyncStatusMsg(null), 3000);
        }
      }
    } catch (err: any) {
      console.error("Login failed:", err);
      setSyncStatusMsg(`Failed to connect Google Calendar: ${err.message || String(err)}`);
      setTimeout(() => setSyncStatusMsg(null), 5000);
    }
  };

  const handleGoogleLogout = async () => {
    await googleSignOut();
    setGoogleUser(null);
    setGoogleToken(null);
    setSyncStatusMsg("Google Calendar disconnected.");
    setTimeout(() => setSyncStatusMsg(null), 3000);
  };

  const handleResyncCalendar = async () => {
    if (!googleToken) {
      setSyncStatusMsg("Cannot resync: Google Calendar is not connected.");
      setTimeout(() => setSyncStatusMsg(null), 3000);
      return;
    }

    setIsSyncing(true);
    setSyncStatusMsg("Checking Google Calendar connection & syncing events...");
    try {
      const unsyncedEvents = events.filter(ev => !ev.syncWithGoogle);
      
      if (unsyncedEvents.length > 0) {
        setSyncStatusMsg(`Found ${unsyncedEvents.length} unsynced local event(s). Syncing...`);
        let count = 0;
        for (const ev of unsyncedEvents) {
          const attendeeEmails = (ev.attendees || []).map(repId => {
            const foundRep = reps.find(r => r.id === repId);
            return foundRep?.email || `${repId}@nextenergy24.com`;
          });
          try {
            await syncEventToGoogleCalendar(ev.title, ev.date, ev.time, attendeeEmails);
            ev.syncWithGoogle = true;
            count++;
          } catch (err) {
            console.warn(`Failed to sync event "${ev.title}":`, err);
          }
        }
        if (count > 0) {
          setSyncStatusMsg(`Successfully synced ${count} event(s) with Google Calendar!`);
        } else {
          setSyncStatusMsg("Verification complete. No events were synced due to connection limits.");
        }
      } else {
        await new Promise(resolve => setTimeout(resolve, 800));
        setSyncStatusMsg("Google Calendar is fully in-sync! No unsynced local events found.");
      }
      setTimeout(() => setSyncStatusMsg(null), 4000);
    } catch (err: any) {
      console.error("Resync failed:", err);
      setSyncStatusMsg(`Resync failed: ${err.message || String(err)}`);
      setTimeout(() => setSyncStatusMsg(null), 5000);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleAddRepSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRepName.trim()) return;
    onAddRep(newRepName);
    setNewRepName('');
    setShowAddRepModal(false);
  };

  const handleAddNoticeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNoticeText.trim()) return;
    onAddNotice(newNoticeText);
    setNewNoticeText('');
    setShowNoticeInput(false);
  };

  // Helper to get YTD months chronologically for the selected month's year
  const getYTDMonths = (selMonth: string): string[] => {
    const allMonths = [
      'JAN-26', 'FEB-26', 'MAR-26', 'APR-26', 'MAY-26', 'JUN-26', 
      'JUL-26', 'AUG-26', 'SEP-26', 'OCT-26', 'NOV-26', 'DEC-26',
      'JAN-27', 'FEB-27', 'MAR-27', 'APR-27', 'MAY-27', 'JUN-27'
    ];
    const selIndex = allMonths.indexOf(selMonth);
    if (selIndex === -1) return [selMonth];
    const parts = selMonth.split('-');
    const yearSuffix = parts[1]; // e.g. '26'
    return allMonths.slice(0, selIndex + 1).filter(m => m.endsWith(`-${yearSuffix}`));
  };

  const getRepPipelineSalesForMonth = (repId: string, targetMonth: string): number => {
    try {
      let pipes: any[] = [];
      const deleted = getDeletedPipelineIds();
      if (pipelinesSync !== undefined) {
        pipes = pipelinesSync.filter((p: any) => (p.ownerId === repId || p.creatorId === repId || p.taggedRepIds?.includes(repId)) && !deleted.includes(p.id));
      } else {
        const saved = localStorage.getItem(`next_pipelines_${repId}`);
        if (saved) {
          try {
            pipes = JSON.parse(saved).filter((p: any) => !deleted.includes(p.id));
          } catch {}
        }
      }
      return pipes
        .filter((p: any) => {
          if (p.status !== 'Won') return false;
          const dateStr = p.proposalSentDate || p.requestDate || '';
          
          // Month filter
          const monthMap: Record<string, string> = {
            'JAN': '01', 'FEB': '02', 'MAR': '03', 'APR': '04', 'MAY': '05', 'JUN': '06',
            'JUL': '07', 'AUG': '08', 'SEP': '09', 'OCT': '10', 'NOV': '11', 'DEC': '12'
          };
          const parts = targetMonth.split('-');
          if (parts.length === 2) {
            const m = monthMap[parts[0]];
            const y = '20' + parts[1];
            if (m && y) {
              const prefix = `${y}-${m}`;
              if (!dateStr.startsWith(prefix)) return false;
            }
          }
          return true;
        })
        .reduce((sum: number, p: any) => sum + (parseFloat(p.proposalValue) || 0), 0);
    } catch {
      return 0;
    }
  };

  const getRepPipelineSales = (repId: string): number => {
    return getRepPipelineSalesForMonth(repId, selectedMonth);
  };

  // Math metrics
  const activeMonthSales = reps.reduce((sum, r) => {
    if (r.id === 'atiqa') return sum; // Atiqa uses performance ratings (1-5) instead of RM sales!
    const manualSales = (r.kpi?.salesFigure ?? []).reduce((a, b) => a + b, 0);
    return sum + manualSales + getRepPipelineSales(r.id);
  }, 0);

  const totalSalesToDateYTD = (() => {
    const storedKpis = localStorage.getItem('next_month_kpis_dict');
    const kpisDict = storedKpis ? JSON.parse(storedKpis) : {};
    const ytdMonthsList = getYTDMonths(selectedMonth);

    return reps.reduce((sum, r) => {
      if (r.id === 'atiqa') return sum;
      let repYTDSum = 0;
      ytdMonthsList.forEach(m => {
        let monthKpi = kpisDict[`${r.id}_${m}`];
        if (!monthKpi && m === selectedMonth) {
          monthKpi = r.kpi;
        }
        const manualSales = monthKpi?.salesFigure ? monthKpi.salesFigure.reduce((a: number, b: number) => a + b, 0) : 0;
        const pipeSales = getRepPipelineSalesForMonth(r.id, m);
        repYTDSum += manualSales + pipeSales;
      });
      return sum + repYTDSum;
    }, 0);
  })();

  const filteredYTDSales = totalSalesToDateYTD;
  
  const numReps = reps.length;
  const totalProposalsTeam = reps.reduce((sum, r) => sum + (r.kpi?.proposals ?? []).reduce((a, b) => a + b, 0), 0);
  const totalPreviewsTeam = reps.reduce((sum, r) => sum + (r.kpi?.preview ?? []).reduce((a, b) => a + b, 0), 0);

  const avgTeamScore = numReps === 0 ? 0 : Math.round(reps.reduce((acc, r) => {
    const pipelineSales = r.id === 'atiqa' ? 0 : getRepPipelineSales(r.id);
    const salesTotal = (r.kpi?.salesFigure ?? []).reduce((a, b) => a + b, 0) + pipelineSales;
    const proposalsTotal = (r.kpi?.proposals ?? []).reduce((a, b) => a + b, 0);
    const previewTotal = (r.kpi?.preview ?? []).reduce((a, b) => a + b, 0);

    const metricsList = getRepMetrics(r);
    const overall = metricsList.reduce((sum, metric) => {
      let totalAchieved = 0;
      if (metric.isRM) {
        totalAchieved = salesTotal;
      } else if (metric.key === 'proposals') {
        totalAchieved = proposalsTotal;
      } else if (metric.key === 'preview') {
        totalAchieved = previewTotal;
      } else if (metric.key === 'extraMetric') {
        totalAchieved = (r.kpi?.extraMetric || []).reduce((a, b) => a + b, 0);
      }
      const score = Math.min(100, Math.round((totalAchieved / metric.targetVal) * 100)) || 0;
      return sum + (score * metric.weight);
    }, 0);

    return acc + overall;
  }, 0) / numReps);

  // Month and YTD sales targets / progress calculations
  const monthSalesTarget = reps.reduce((sum, r) => {
    if (r.id === 'atiqa') return sum;
    return sum + (r.targets?.salesFigure ?? 30000);
  }, 0);
  const monthSalesProgressPct = monthSalesTarget > 0 ? Math.min(100, Math.round((activeMonthSales / monthSalesTarget) * 100)) : 0;
  const ytdSalesTarget = 1000000; // RM target up to Dec 2026 is RM 1,000,000
  const ytdSalesProgressPct = ytdSalesTarget > 0 ? Math.min(100, Math.round((totalSalesToDateYTD / ytdSalesTarget) * 100)) : 0;

  // Radial Gauge circumferences
  const rLarge = 42;
  const cLarge = 2 * Math.PI * rLarge;

  return (
    <div className="space-y-6" id="home-dashboard">
      
      {/* Top Row: Quick Month view selector */}
      <div className="bg-white border border-slate-200 p-4 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xs" id="home-month-selector">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-blue-50 border border-blue-100 text-blue-600 rounded-lg">
            <Calendar className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider">
              OPERATIONAL MONTH VIEW
            </h3>
            <p className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">
              Select active month to update operational reports, team rosters, and KPI scorecards.
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider font-mono">
            Active Month:
          </label>
          <select
            value={selectedMonth}
            onChange={(e) => onMonthChange(e.target.value)}
            className="text-xs font-bold font-mono border border-slate-200 bg-white rounded-lg px-3.5 py-2 text-slate-800 focus:outline-none focus:border-blue-500 cursor-pointer shadow-xs min-w-[140px]"
          >
            {['JAN-26', 'FEB-26', 'MAR-26', 'APR-26', 'MAY-26', 'JUN-26', 'JUL-26', 'AUG-26', 'SEP-26', 'OCT-26', 'NOV-26', 'DEC-26', 'JAN-27', 'FEB-27', 'MAR-27', 'APR-27', 'MAY-27', 'JUN-27'].map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
      </div>
      
      {/* 4 Cards Row & Calendar */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        
        {/* Left Side: 4 KPI Cards Grid */}
        <div className="lg:col-span-7 grid grid-cols-1 md:grid-cols-2 gap-4">
          
          {/* Card 1: Total Sales YTD (Dark Blue Theme) */}
          <div 
            className="p-6 rounded-xl relative overflow-hidden bg-gradient-to-br from-[#0c244c] to-[#081a38] text-white border border-blue-950 flex flex-col justify-between shadow-sm min-h-[165px]"
            id="kpi-card-total-sales"
          >
            {/* Giant grey/blue $ sign behind numbers */}
            <div className="absolute right-4 bottom-2 text-white/5 font-black text-9xl pointer-events-none select-none font-mono">
              $
            </div>
            
            <div className="space-y-1">
              <span className="text-[11px] font-bold tracking-wider text-slate-300 uppercase block font-display">
                TOTAL SALES TO DATE (YTD)
              </span>
              <h3 className="text-3xl font-black font-mono tracking-tight text-white mt-1">
                RM {totalSalesToDateYTD.toLocaleString()}
              </h3>
            </div>
            
            <div className="flex justify-between items-end mt-4">
              <span className="text-xs text-slate-300 font-semibold uppercase tracking-wider font-display">
                ALL REPRESENTATIVES
              </span>
              <span className="text-[10px] bg-blue-800/60 text-blue-200 font-bold px-2 py-0.5 rounded border border-blue-700/50">
                YTD Actual
              </span>
            </div>
          </div>

          {/* Card 2: Filtered YTD Sales */}
          <div 
            className="p-6 rounded-xl bg-white border border-slate-200/80 text-slate-800 flex flex-col justify-between shadow-xs min-h-[165px]"
            id="kpi-card-filtered-sales"
          >
            <div className="space-y-1">
              <span className="text-[11px] font-bold tracking-wider text-slate-400 uppercase block font-display">
                FILTERED YTD SALES
              </span>
              <h3 className="text-3xl font-black font-mono tracking-tight text-slate-800 mt-1">
                RM {filteredYTDSales.toLocaleString()}
              </h3>
            </div>
            
            <div className="flex justify-between items-end mt-4">
              <span className="text-xs text-slate-500 font-bold uppercase tracking-wider font-display">
                {numReps} REPS FILTERED
              </span>
              <span className="text-[10px] bg-slate-100 text-slate-600 font-extrabold px-2 py-0.5 rounded border border-slate-200">
                {avgTeamScore}% Avg Score
              </span>
            </div>
          </div>

          {/* Card 3: Active Month Sales */}
          <div 
            className="p-6 rounded-xl bg-white border border-slate-200/80 text-slate-800 flex flex-col justify-between shadow-xs min-h-[165px]"
            id="kpi-card-active-sales"
          >
            <div className="space-y-1">
              <span className="text-[11px] font-bold tracking-wider text-[#10B981] uppercase block font-display">
                ACTIVE MONTH SALES ({selectedMonth})
              </span>
              <h3 className="text-3xl font-black font-mono tracking-tight text-[#10B981] mt-1">
                RM {activeMonthSales.toLocaleString()}
              </h3>
            </div>
            
            <div className="flex justify-between items-end mt-4">
              <span className="text-xs text-slate-500 font-bold uppercase tracking-wider font-display">
                {totalProposalsTeam} PROPOSALS & {totalPreviewsTeam} PREVIEWS
              </span>
              <span className="text-[10px] bg-emerald-50 text-emerald-700 font-extrabold px-2.5 py-0.5 rounded border border-emerald-100">
                {avgTeamScore}% Team Score
              </span>
            </div>
          </div>

          {/* Card 4: Circle Gauges */}
          <div 
            className="p-6 rounded-xl bg-white border border-slate-200/80 text-slate-800 flex items-center justify-around shadow-xs min-h-[165px]"
            id="kpi-card-gauges"
          >
            {/* Gauge 1: Month Target */}
            <div className="flex flex-col items-center space-y-2">
              <div className="relative w-28 h-28 flex items-center justify-center">
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 112 112">
                  <circle cx="56" cy="56" r={rLarge} stroke="#f1f5f9" strokeWidth="6" fill="none" />
                  <circle 
                    cx="56" 
                    cy="56" 
                    r={rLarge} 
                    stroke="#3b82f6" 
                    strokeWidth="7" 
                    fill="none" 
                    strokeDasharray={cLarge}
                    strokeDashoffset={cLarge - (monthSalesProgressPct / 100) * cLarge}
                    strokeLinecap="round"
                    className="transition-all duration-500"
                  />
                </svg>
                <div className="absolute flex flex-col items-center justify-center">
                  <span className="text-base font-black text-slate-800 font-mono leading-none">{monthSalesProgressPct}%</span>
                  <span className="text-[8px] font-bold text-slate-400 mt-0.5">RM {Math.round(activeMonthSales / 1000)}k</span>
                </div>
              </div>
              <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 font-display text-center">
                MONTH SALES TARGET
              </span>
              <span className="text-[9px] bg-blue-50 text-blue-700 font-extrabold px-2 py-0.5 rounded">
                Target: RM {Math.round(monthSalesTarget / 1000)}k
              </span>
            </div>

            {/* Divider */}
            <div className="h-28 w-[1px] bg-slate-100" />

            {/* Gauge 2: YTD Target */}
            <div className="flex flex-col items-center space-y-2">
              <div className="relative w-28 h-28 flex items-center justify-center">
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 112 112">
                  <circle cx="56" cy="56" r={rLarge} stroke="#f1f5f9" strokeWidth="6" fill="none" />
                  <circle 
                    cx="56" 
                    cy="56" 
                    r={rLarge} 
                    stroke="#10b981" 
                    strokeWidth="7" 
                    fill="none" 
                    strokeDasharray={cLarge}
                    strokeDashoffset={cLarge - (ytdSalesProgressPct / 100) * cLarge}
                    strokeLinecap="round"
                    className="transition-all duration-500"
                  />
                </svg>
                <div className="absolute flex flex-col items-center justify-center">
                  <span className="text-base font-black text-slate-800 font-mono leading-none">{ytdSalesProgressPct}%</span>
                  <span className="text-[8px] font-bold text-slate-400 mt-0.5">RM {(totalSalesToDateYTD / 1000000).toFixed(2)}M</span>
                </div>
              </div>
              <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 font-display text-center">
                YTD DEC-26 TARGET
              </span>
              <span className="text-[9px] bg-emerald-50 text-emerald-700 font-extrabold px-2 py-0.5 rounded">
                Target: RM 1.0M
              </span>
            </div>

          </div>

        </div>

        {/* Right Side: July 2026 Calendar Widget (Perfect copy of the screenshot layout!) */}
        <div className="lg:col-span-5 bg-white border border-slate-200/80 rounded-xl p-5 shadow-xs flex flex-col justify-between">
          
          {/* Calendar Header */}
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-1">
              <span className="text-xs font-bold text-slate-500">Today</span>
              <button onClick={handlePrevMonth} className="p-1 hover:bg-slate-100 rounded text-slate-400">
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button onClick={handleNextMonth} className="p-1 hover:bg-slate-100 rounded text-slate-400">
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
              <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider ml-1 font-display">
                {monthNames[currentMonth]} {currentYear}
              </h4>
            </div>

            {/* Menu controls of calendar */}
            <div className="flex items-center gap-1.5">
              <button className="p-1 hover:bg-slate-100 rounded text-slate-400">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </button>
              <button className="p-1 hover:bg-slate-100 rounded text-slate-400">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                </svg>
              </button>
              <span className="text-[10px] font-bold text-slate-500 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded">
                Month
              </span>
            </div>
          </div>

          {/* Google Calendar Connection Status Bar */}
          <div className="bg-slate-50 border border-slate-100/80 rounded-lg p-2.5 my-2 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${googleToken ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
              <div className="text-left">
                <span className="font-bold text-slate-700 block text-[11px]">Google Calendar Integration</span>
                <span className="text-[9px] text-slate-400 font-medium block">
                  {googleToken ? `Synced to: nextacademy24@gmail.com (${googleUser?.email})` : 'Target calendar: nextacademy24@gmail.com'}
                </span>
              </div>
            </div>
            {googleToken ? (
              <div className="flex items-center gap-1.5">
                <button 
                  onClick={handleResyncCalendar}
                  disabled={isSyncing}
                  className="text-[9px] font-black text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-150 px-2 py-1 rounded transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                  title="Resync events with Google Calendar"
                >
                  <RefreshCw className={`w-2.5 h-2.5 ${isSyncing ? 'animate-spin' : ''}`} />
                  Resync
                </button>
                <button 
                  onClick={handleGoogleLogout} 
                  className="text-[9px] font-bold text-rose-500 hover:text-rose-600 bg-rose-50 hover:bg-rose-150 border border-rose-100 px-2 py-1 rounded transition-colors cursor-pointer"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <button 
                onClick={handleGoogleLogin} 
                className="text-[9px] font-bold text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-100 px-2.5 py-1 rounded transition-colors cursor-pointer flex items-center gap-1"
              >
                <RefreshCw className="w-2.5 h-2.5" />
                Connect Account
              </button>
            )}
          </div>

          {syncStatusMsg && (
            <div className="bg-amber-50 text-amber-800 border border-amber-200 rounded p-2 text-[10px] font-medium text-center mb-2">
              {syncStatusMsg}
            </div>
          )}

          {/* Days Grid Headers */}
          <div className="grid grid-cols-7 text-center py-2 text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-50">
            <span>Mon</span>
            <span>Tue</span>
            <span>Wed</span>
            <span>Thu</span>
            <span>Fri</span>
            <span>Sat</span>
            <span>Sun</span>
          </div>

          {/* Calendar Grid Cells */}
          <div className="grid grid-cols-7 gap-[1px] bg-slate-100 border border-slate-100 mt-1 rounded overflow-hidden">
            {calendarGrid.map((cell, idx) => {
              const dayEvents = events.filter(e => e.date === cell.dateStr);
              const isSelected = selectedDayStr === cell.dateStr;
              
              return (
                <div 
                  key={idx}
                  onClick={() => setSelectedDayStr(cell.dateStr)}
                  className={`min-h-[48px] p-1 bg-white cursor-pointer transition-colors relative flex flex-col justify-between ${
                    isSelected ? 'ring-2 ring-blue-500/80 z-10' : 'hover:bg-slate-50/50'
                  }`}
                >
                  {/* Day Number */}
                  <span className={`text-[10px] font-black leading-none ${
                    cell.isCurrentMonth ? 'text-slate-700' : 'text-slate-300'
                  }`}>
                    {cell.dayNum}
                  </span>

                  {/* Bullet points or tags for events */}
                  <div className="flex flex-col gap-0.5 mt-1 overflow-hidden max-h-[30px]">
                    {dayEvents.slice(0, 3).map((ev, evIdx) => (
                      <div 
                        key={evIdx}
                        title={`${ev.time} - ${ev.title}`}
                        className={`text-[7px] leading-tight px-1 py-0.2 rounded-xs truncate text-white ${ev.color || 'bg-blue-500'}`}
                      >
                        {ev.title}
                      </div>
                    ))}
                    {dayEvents.length > 3 && (
                      <span className="text-[7px] text-slate-400 font-bold pl-1 font-mono">
                        +{dayEvents.length - 3} more
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Selected Date Events Panel */}
          <div className="mt-4 p-3 bg-slate-50 rounded-lg border border-slate-150 space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-[10px] font-black text-slate-700 uppercase tracking-wider font-display flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-blue-500" />
                Events for {new Date(selectedDayStr).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
              </span>
              <button 
                onClick={() => setShowAddEventModal(true)}
                className="text-[9px] bg-blue-600 hover:bg-blue-700 text-white font-black px-2 py-1 rounded flex items-center gap-0.5 transition-colors"
              >
                <Plus className="w-2.5 h-2.5" />
                Add Event
              </button>
            </div>

            <div className="space-y-1.5 max-h-[110px] overflow-y-auto">
              {selectedDayEvents.length === 0 ? (
                <p className="text-[11px] text-slate-400 italic py-1">No operational events scheduled for this day.</p>
              ) : (
                selectedDayEvents.map((ev) => (
                  <div key={ev.id} className="p-2 bg-white rounded border border-slate-200/60 flex items-center justify-between gap-2 group">
                    <div className="flex items-center gap-2">
                      <div className={`w-1.5 h-10 rounded-full ${ev.color || 'bg-blue-500'}`} />
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-xs font-bold text-slate-800">{ev.title}</p>
                          {ev.syncWithGoogle && (
                            <span className="text-[8px] bg-blue-50 text-blue-600 font-extrabold px-1 rounded border border-blue-100 flex items-center gap-0.5" title="Synced to Google Calendar">
                              <Check className="w-2 h-2" /> Google
                            </span>
                          )}
                        </div>
                        <p className="text-[9px] text-slate-400 font-mono mt-0.5">{ev.time}</p>
                        
                        {/* Attendee Representatives */}
                        {ev.attendees && ev.attendees.length > 0 && (
                          <div className="flex items-center gap-1 mt-1 flex-wrap">
                            <span className="text-[8px] font-bold text-slate-400 mr-0.5">Invited:</span>
                            {ev.attendees.map(repId => {
                              const repName = reps.find(r => r.id === repId)?.name || repId;
                              return (
                                <span key={repId} className="text-[8px] font-bold bg-slate-100 text-slate-600 px-1 py-0.5 rounded border border-slate-200">
                                  {repName}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                    <button 
                      onClick={() => onDeleteEvent(ev.id)}
                      className="p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>

      </div>

      {/* Newsfeed / Notice Box */}
      <div 
        className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-xs flex items-center gap-4 relative overflow-hidden"
        id="notice-ticker-panel"
      >
        <div className="bg-[#FEF3C7] text-[#D97706] p-2.5 rounded-lg flex-shrink-0 border border-[#FDE68A]">
          <Megaphone className="w-4 h-4" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display block">
              Newsfeed / Notice
            </span>
            <button 
              onClick={() => setShowNoticeInput(!showNoticeInput)}
              className="text-[10px] font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1 transition-colors"
            >
              <Edit3 className="w-3 h-3" />
              Manage Notices
            </button>
          </div>
          
          {showNoticeInput ? (
            <form onSubmit={handleAddNoticeSubmit} className="mt-2 flex gap-2">
              <input 
                type="text" 
                value={newNoticeText}
                onChange={(e) => setNewNoticeText(e.target.value)}
                placeholder="Type a new notice or update notice logs..."
                className="flex-1 text-xs border border-slate-200 rounded px-3 py-1.5 focus:outline-none focus:border-blue-500 text-slate-800"
              />
              <button 
                type="submit"
                className="text-xs bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1 rounded transition-colors"
              >
                Post
              </button>
            </form>
          ) : (
            <div className="mt-1 flex flex-col gap-1">
              {notices.length === 0 ? (
                <p className="text-xs text-slate-500 italic">No notices posted. Use 'Manage Notices' to add updates.</p>
              ) : (
                notices.slice(-2).map((notice, noticeIdx) => (
                  <div key={noticeIdx} className="text-xs text-slate-700 leading-normal flex justify-between items-center group">
                    <span className="truncate">📢 {notice}</span>
                    <button 
                      onClick={() => onDeleteNotice(notices.indexOf(notice))}
                      className="text-slate-300 hover:text-red-500 text-[9px] opacity-0 group-hover:opacity-100 transition-opacity pl-2"
                    >
                      Delete
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Representative Selection Section (Direct Match to Bottom buttons) */}
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider font-display">
            Next Academy Team Representatives
          </h3>
          <button 
            onClick={() => {
              if (isManagementUnlocked) {
                setShowAddRepModal(true);
              } else {
                onRequestManagementUnlock();
              }
            }}
            className="text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg border border-blue-100 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Representative
          </button>
        </div>

        {/* Big styled representative clickable buttons as requested in Page 1 bottom */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4" id="representatives-list">
          {reps.map((rep) => {
            const alertStatus = getRepAlertStatus(rep.id, reps, pipelinesSync, tasksSync, quotationsSync, outlinesSync);
            const shouldFlash = alertStatus.shouldFlash;
            return (
              <button
                key={rep.id}
                onClick={() => onSelectRep(rep)}
                className={`p-5 rounded-xl text-center shadow-xs transition-all group cursor-pointer ${
                  shouldFlash
                    ? 'animate-flash-red text-white border-2'
                    : 'bg-white border border-slate-200 text-slate-700 hover:border-blue-400 hover:shadow-md hover:shadow-blue-500/5'
                }`}
                id={`rep-btn-${rep.id}`}
              >
                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-display font-black text-sm mx-auto transition-colors ${
                  shouldFlash
                    ? 'bg-white/20 border border-white/30 text-white'
                    : 'bg-slate-50 border border-slate-100 text-slate-500 group-hover:bg-blue-50 group-hover:text-blue-600 group-hover:border-blue-100'
                }`}>
                  {rep.name.substring(0, 2).toUpperCase()}
                </div>
                <h4 className={`text-sm font-black mt-3 truncate ${
                  shouldFlash ? 'text-white' : 'text-slate-800 group-hover:text-blue-600 transition-colors'
                }`}>
                  {rep.name}
                </h4>
                <p className={`text-[10px] font-extrabold mt-1 uppercase tracking-wider font-sans leading-tight ${
                  shouldFlash ? 'text-white/90' : 'text-blue-600'
                }`}>
                  {rep.id === 'xin-ying' ? 'Super Manager' :
                   rep.id === 'chee-cai' ? 'Unstoppable Lead Trainer & Sales' :
                   rep.id === 'alif' ? 'Rising Sales' :
                   rep.id === 'atiqa' ? 'Amazing Admin' : 'Representative'}
                </p>
                <p className={`text-[9px] mt-1 uppercase tracking-wider font-mono ${
                  shouldFlash ? 'text-white/80 font-black' : 'text-slate-400'
                }`}>
                  {shouldFlash ? '⚠️ ACTION REQUIRED' : 'View Console'}
                </p>
                {shouldFlash && (
                  <div className="mt-2 text-[8px] font-black uppercase tracking-widest bg-white/20 border border-white/20 px-1.5 py-0.5 rounded text-center">
                    {alertStatus.hasUnattendedTasks ? 'Pending Tasks' : ''}
                    {alertStatus.hasUnattendedTasks && alertStatus.hasTags ? ' & ' : ''}
                    {alertStatus.hasTaggedPipelines ? 'Tagged Pipeline' : alertStatus.isTaggedInWeeklyReports ? 'Tagged In Check-In' : ''}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Add Event Modal */}
      {showAddEventModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-sm w-full p-6 shadow-xl border border-slate-150 space-y-4">
            <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider">
              Add Operational Event
            </h3>
            <form onSubmit={handleAddEventSubmit} className="space-y-3">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Event Title</label>
                <input 
                  type="text" 
                  required
                  placeholder="e.g. Director lunch strategy" 
                  value={newEventTitle}
                  onChange={(e) => setNewEventTitle(e.target.value)}
                  className="w-full text-xs border border-slate-200 rounded px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Time Slot</label>
                  <input 
                    type="text" 
                    required
                    placeholder="e.g. 11:00 AM" 
                    value={newEventTime}
                    onChange={(e) => setNewEventTime(e.target.value)}
                    className="w-full text-xs border border-slate-200 rounded px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Event Color</label>
                  <select 
                    value={newEventColor}
                    onChange={(e) => setNewEventColor(e.target.value)}
                    className="w-full text-xs border border-slate-200 rounded px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500"
                  >
                    <option value="bg-blue-500">Blue (Meeting)</option>
                    <option value="bg-emerald-500">Green (Growth)</option>
                    <option value="bg-amber-500">Amber (Lunch)</option>
                    <option value="bg-cyan-500">Cyan (Interview)</option>
                    <option value="bg-purple-500">Purple (Academic)</option>
                    <option value="bg-rose-500">Rose (Urgent)</option>
                  </select>
                </div>
              </div>

              {/* Invite/Tag Other Representatives */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Invite Representatives (Link to their Calendars)
                </label>
                <div className="grid grid-cols-2 gap-1.5 max-h-24 overflow-y-auto border border-slate-200 rounded p-2">
                  {reps.map(rep => (
                    <label key={rep.id} className="flex items-center gap-1.5 text-[11px] text-slate-700 cursor-pointer hover:bg-slate-50 p-1 rounded">
                      <input 
                        type="checkbox"
                        checked={selectedRepIdsForEvent.includes(rep.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedRepIdsForEvent(prev => [...prev, rep.id]);
                          } else {
                            setSelectedRepIdsForEvent(prev => prev.filter(id => id !== rep.id));
                          }
                        }}
                        className="rounded text-blue-600 focus:ring-blue-500 w-3.5 h-3.5 border-slate-300"
                      />
                      <span className="truncate">{rep.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Sync with Google Calendar Sync Check */}
              <div className="pt-1">
                <label className="flex items-start gap-2 cursor-pointer bg-slate-50 p-2 rounded border border-slate-100">
                  <input 
                    type="checkbox"
                    checked={syncToGoogleCheckbox}
                    onChange={(e) => setSyncToGoogleCheckbox(e.target.checked)}
                    className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4 border-slate-300 cursor-pointer mt-0.5"
                  />
                  <div className="text-left">
                    <span className="text-[11px] font-bold text-slate-700 block leading-tight">Sync with nextacademy24@gmail.com</span>
                    <span className="text-[9px] text-slate-400 block mt-0.5">
                      {googleToken ? 'Authenticated. Google Calendar will receive this event.' : 'Requires connection. Click "Connect Account" above first.'}
                    </span>
                  </div>
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button 
                  type="button" 
                  onClick={() => setShowAddEventModal(false)}
                  className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold px-4 py-2 rounded transition-colors"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="text-xs bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded transition-colors"
                >
                  Add Event
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Representative Modal */}
      {showAddRepModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-sm w-full p-6 shadow-xl border border-slate-150 space-y-4">
            <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider">
              Add Representative Roster
            </h3>
            <form onSubmit={handleAddRepSubmit} className="space-y-3">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Representative Name</label>
                <input 
                  type="text" 
                  required
                  placeholder="e.g. Jonathan Lim" 
                  value={newRepName}
                  onChange={(e) => setNewRepName(e.target.value)}
                  className="w-full text-xs border border-slate-200 rounded px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button 
                  type="button" 
                  onClick={() => setShowAddRepModal(false)}
                  className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold px-4 py-2 rounded transition-colors"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="text-xs bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded transition-colors"
                >
                  Create Representative
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
