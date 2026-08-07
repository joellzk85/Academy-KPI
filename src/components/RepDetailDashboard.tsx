import React, { useState, useEffect } from 'react';
import { Representative, GoogleLinks } from '../types';
import { getRepMetrics } from '../initialData';
import { ArrowLeft, Save, Link2, Plus, Calendar, DollarSign, Calculator, Percent, Sparkles, Clock, FileText, Trash2, Briefcase, TrendingUp, CheckCircle, XCircle, AlertCircle, Users, MapPin, Building2, GraduationCap, Eye, EyeOff, Tag, RotateCcw, Lock, Shield, History, MessageSquare, Send, CornerDownRight, Check } from 'lucide-react';
import QuotationGenerator from './QuotationGenerator';
import CourseOutlineGenerator from './CourseOutlineGenerator';
import AdminRecordManager from './AdminRecordManager';
import { collection, query, where, onSnapshot, doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';

interface RepDetailDashboardProps {
  rep: Representative;
  reps: Representative[];
  onBack: () => void;
  onUpdateRepKpi: (repId: string, updatedKpi: Representative['kpi']) => void;
  onAskCopilot: (prompt: string) => void;
  selectedMonth: string;
  onMonthChange: (month: string) => void;
}

type SubTab = 'quotation' | 'kpi' | 'client' | 'faci' | 'trainerList' | 'venue' | 'tasks' | 'pl' | 'payment' | 'pipeline' | 'course_outline' | 'admin_record';


export function getInitialPipelinesForRep(repId: string) {
  if (repId === 'chee-cai') {
    return [
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
    return [
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
    return [
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
  return [];
}

export default function RepDetailDashboard({
  rep,
  reps,
  onBack,
  onUpdateRepKpi,
  onAskCopilot,
  selectedMonth,
  onMonthChange
}: RepDetailDashboardProps) {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>(() => {
    const saved = localStorage.getItem(`next_active_subtab_${rep.id}`);
    return (saved as SubTab) || 'kpi';
  });
  const [subTabHistory, setSubTabHistory] = useState<SubTab[]>(() => {
    const saved = localStorage.getItem(`next_active_subtab_${rep.id}`);
    return [(saved as SubTab) || 'kpi'];
  });

  const handleSubTabChange = (newTab: SubTab) => {
    setSubTabHistory(prev => {
      if (prev[prev.length - 1] === newTab) return prev;
      return [...prev, newTab];
    });
    setActiveSubTab(newTab);
    localStorage.setItem(`next_active_subtab_${rep.id}`, newTab);
  };

  const handleBack = () => {
    if (subTabHistory.length > 1) {
      const updatedHistory = [...subTabHistory];
      updatedHistory.pop(); // remove current subtab
      const prevTab = updatedHistory[updatedHistory.length - 1] || 'kpi';
      setSubTabHistory(updatedHistory);
      setActiveSubTab(prevTab);
      localStorage.setItem(`next_active_subtab_${rep.id}`, prevTab);
    } else if (activeSubTab !== 'kpi') {
      setActiveSubTab('kpi');
      setSubTabHistory(['kpi']);
      localStorage.setItem(`next_active_subtab_${rep.id}`, 'kpi');
    } else {
      onBack();
    }
  };
  
  // KPI temporary editing states
  const [isEditingKpi, setIsEditingKpi] = useState(false);
  const [editKpi, setEditKpi] = useState<Representative['kpi']>(JSON.parse(JSON.stringify(rep.kpi)));

  // State hooks for inbound tags and response modal
  const [selectedInboundTag, setSelectedInboundTag] = useState<{
    senderId: string;
    senderName: string;
    weekIdx: number;
    type: 'partner' | 'general';
  } | null>(null);
  const [tagResponseText, setTagResponseText] = useState('');
  const [tagResponseStatus, setTagResponseStatus] = useState<'Done' | 'Pending'>('Done');

  const getCollaborationComments = (kpi: any, week: number): any[] => {
    if (kpi?.collaborationCommentsList && Array.isArray(kpi.collaborationCommentsList) && kpi.collaborationCommentsList[week] !== undefined) {
      return kpi.collaborationCommentsList[week] || [];
    }
    return [];
  };

  // Google Links states loaded from/saved to local storage unique to the Representative & subtab
  const [links, setLinks] = useState<GoogleLinks>({
    quotation: '',
    clientList: '',
    faci: '',
    venue: '',
    trainerList: '',
    pendingTasks: '',
    pAndL: ''
  });

  const [inputUrl, setInputUrl] = useState('');

  useEffect(() => {
    if (!isEditingKpi) {
      setEditKpi(JSON.parse(JSON.stringify(rep.kpi)));
    }
  }, [rep.kpi, isEditingKpi]);

  useEffect(() => {
    // Scroll to the very top of the page on loading
    window.scrollTo(0, 0);

    // Reset editing data when rep ID changes (switching representatives)
    setEditKpi(JSON.parse(JSON.stringify(rep.kpi)));
    setIsEditingKpi(false);

    // Read saved subtab or default to kpi
    const savedSubTab = localStorage.getItem(`next_active_subtab_${rep.id}`);
    const initialSubTab = (savedSubTab as SubTab) || 'kpi';
    setActiveSubTab(initialSubTab);
    setSubTabHistory([initialSubTab]);

    // Links, trainers, venues, and payments are now managed by real-time Firestore synchronization below
  }, [rep.id]);

  // Handle saving the input URL for active subtab
  const handleSaveUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    const updatedLinks = { ...links };
    if (activeSubTab === 'quotation') updatedLinks.quotation = inputUrl;
    else if (activeSubTab === 'client') updatedLinks.clientList = inputUrl;
    else if (activeSubTab === 'faci') updatedLinks.faci = inputUrl;
    else if (activeSubTab === 'trainerList') updatedLinks.trainerList = inputUrl;
    else if (activeSubTab === 'venue') updatedLinks.venue = inputUrl;
    else if (activeSubTab === 'tasks') updatedLinks.pendingTasks = inputUrl;
    else if (activeSubTab === 'pl') updatedLinks.pAndL = inputUrl;

    setLinks(updatedLinks);
    localStorage.setItem(`next_links_${rep.id}`, JSON.stringify(updatedLinks));
    try {
      if (db) {
        await setDoc(doc(db, 'links', rep.id), updatedLinks);
      }
    } catch (err) {
      console.error("Firestore save links failed:", err);
    }
    setInputUrl('');
  };

  // Pre-fill active URL input when tab changes
  useEffect(() => {
    if (activeSubTab === 'quotation') setInputUrl(links.quotation);
    else if (activeSubTab === 'client') setInputUrl(links.clientList);
    else if (activeSubTab === 'faci') setInputUrl(links.faci);
    else if (activeSubTab === 'trainerList') setInputUrl(links.trainerList || '');
    else if (activeSubTab === 'venue') setInputUrl(links.venue);
    else if (activeSubTab === 'tasks') setInputUrl(links.pendingTasks);
    else if (activeSubTab === 'pl') setInputUrl(links.pAndL);
    else setInputUrl('');
  }, [activeSubTab, links]);

  // Modal for `$ KEY IN COMMISSION`
  const [showCommissionModal, setShowCommissionModal] = useState(false);
  const [selectedWeek, setSelectedWeek] = useState(() => {
    const day = new Date().getDate();
    if (day <= 7) return 0;
    if (day <= 14) return 1;
    if (day <= 21) return 2;
    if (day <= 28) return 3;
    return 4;
  }); // 0-indexed: Week 1 is 0
  const [commissionAmount, setCommissionAmount] = useState('');
  const [commissionProposals, setCommissionProposals] = useState('');
  const [commissionPreview, setCommissionPreview] = useState('');

  const handleCommissionSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const updatedKpi = JSON.parse(JSON.stringify(rep.kpi));
    
    // Key in Commission allows logging sales and updating proposals or previews
    const amountVal = parseFloat(commissionAmount) || 0;
    const propsVal = parseInt(commissionProposals) || 0;
    const previewVal = parseInt(commissionPreview) || 0;

    updatedKpi.salesFigure[selectedWeek] += amountVal;
    if (propsVal > 0) updatedKpi.proposals[selectedWeek] += propsVal;
    if (previewVal > 0) updatedKpi.preview[selectedWeek] += previewVal;

    onUpdateRepKpi(rep.id, updatedKpi);
    setEditKpi(updatedKpi);
    setShowCommissionModal(false);
    
    // Reset fields
    setCommissionAmount('');
    setCommissionProposals('');
    setCommissionPreview('');
  };

  // Payment states for Raise Payment Form (Ying) with backwards compatibility and unified shared key
  const [payments, setPayments] = useState<any[]>(() => {
    const sharedSaved = localStorage.getItem('next_payments_shared');
    if (sharedSaved) {
      try {
        return JSON.parse(sharedSaved);
      } catch {
        return [];
      }
    }
    // Backward compatibility: try to load from individual reps and merge
    const repsList = ['xin-ying', 'chee-cai', 'alif', 'atiqa', 'new-guy'];
    let merged: any[] = [];
    repsList.forEach(id => {
      const saved = localStorage.getItem(`next_payments_${id}`);
      if (saved) {
        try {
          const itemsList = JSON.parse(saved);
          const mapped = itemsList.map((p: any) => ({
            ...p,
            repId: p.repId || id,
            repName: p.repName || (id === 'xin-ying' ? 'Xin Ying' : (id === 'atiqa' ? 'Atiqa' : id)),
            status: p.status || 'Approved'
          }));
          merged = [...merged, ...mapped];
        } catch (e) {
          // ignore
        }
      }
    });
    localStorage.setItem('next_payments_shared', JSON.stringify(merged));
    return merged;
  });

  const [payDateRequest, setPayDateRequest] = useState(new Date().toISOString().substring(0, 10));
  const [payTrainingDate, setPayTrainingDate] = useState('');
  const [payTrainingClient, setPayTrainingClient] = useState('');
  const [payVenue, setPayVenue] = useState('');
  const [payItems, setPayItems] = useState<{ id: string; itemQty: string; amount: string }[]>([
    { id: '1', itemQty: '', amount: '' }
  ]);

  // Sync payments list when rep changes
  useEffect(() => {
    const sharedSaved = localStorage.getItem('next_payments_shared');
    if (sharedSaved) {
      try {
        setPayments(JSON.parse(sharedSaved));
      } catch {
        // ignore
      }
    }
  }, [rep]);

  const handleRaisePaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedItems = payItems.map(item => ({
      id: item.id || `item_${Date.now()}_${Math.random()}`,
      itemQty: item.itemQty.trim(),
      amount: parseFloat(item.amount) || 0
    })).filter(item => item.itemQty !== '');

    if (parsedItems.length === 0) {
      alert("Please add at least one item to the payment voucher.");
      return;
    }

    const totalAmount = parsedItems.reduce((sum, item) => sum + item.amount, 0);

    const newPayment = {
      id: `pay_${Date.now()}`,
      dateRequest: payDateRequest,
      trainingDate: payTrainingDate,
      trainingClient: payTrainingClient,
      venue: payVenue,
      itemQty: parsedItems.map(item => item.itemQty).join(', '),
      amount: totalAmount,
      items: parsedItems,
      repId: rep.id,
      repName: rep.name,
      status: rep.id === 'xin-ying' ? 'Approved' : 'Pending Approval'
    };
    const updated = [newPayment, ...payments];
    setPayments(updated);
    localStorage.setItem('next_payments_shared', JSON.stringify(updated));
    try {
      if (db) {
        await setDoc(doc(db, 'payments', newPayment.id), newPayment);
      }
    } catch (err) {
      console.error("Firestore save payment failed:", err);
    }
    
    setPayTrainingDate('');
    setPayTrainingClient('');
    setPayVenue('');
    setPayItems([{ id: '1', itemQty: '', amount: '' }]);
  };

  // Manager Permission Authorization Modal States
  const [showManagerAuthModal, setShowManagerAuthModal] = useState(false);
  const [managerAction, setManagerAction] = useState<(() => void) | null>(null);
  const [managerPassword, setManagerPassword] = useState('');
  const [managerAuthError, setManagerAuthError] = useState(false);

  const requestManagerPermission = (actionToExecute: () => void) => {
    actionToExecute();
  };

  // Weekly progress & accountability check-in getter/setter helper functions (follow-the-week)
  const getLastWeekProgress = (kpi: any, week: number): string => {
    if (kpi?.lastWeekProgressList && Array.isArray(kpi.lastWeekProgressList) && kpi.lastWeekProgressList[week] !== undefined) {
      return kpi.lastWeekProgressList[week] || '';
    }
    if (week === 0 && kpi?.lastWeekProgress) {
      return kpi.lastWeekProgress;
    }
    return '';
  };

  const getHelpNeeded = (kpi: any, week: number): string => {
    if (kpi?.helpNeededList && Array.isArray(kpi.helpNeededList) && kpi.helpNeededList[week] !== undefined) {
      return kpi.helpNeededList[week] || '';
    }
    if (week === 0 && kpi?.helpNeeded) {
      return kpi.helpNeeded;
    }
    return '';
  };

  const getDateline = (kpi: any, week: number): string => {
    if (kpi?.datelineList && Array.isArray(kpi.datelineList) && kpi.datelineList[week] !== undefined) {
      return kpi.datelineList[week] || '';
    }
    if (week === 0 && kpi?.dateline) {
      return kpi.dateline;
    }
    return '';
  };

  const getAccountabilityPartnerId = (kpi: any, week: number): string => {
    if (kpi?.accountabilityPartnerIdList && Array.isArray(kpi.accountabilityPartnerIdList) && kpi.accountabilityPartnerIdList[week] !== undefined) {
      return kpi.accountabilityPartnerIdList[week] || '';
    }
    if (week === 0 && kpi?.accountabilityPartnerId) {
      return kpi.accountabilityPartnerId;
    }
    return '';
  };

  const getTaggedRepIds = (kpi: any, week: number): string[] => {
    if (kpi?.taggedRepIdsList && Array.isArray(kpi.taggedRepIdsList) && kpi.taggedRepIdsList[week] !== undefined) {
      return kpi.taggedRepIdsList[week] || [];
    }
    if (week === 0 && kpi?.taggedRepIds) {
      return kpi.taggedRepIds;
    }
    return [];
  };

  const getTagNote = (kpi: any, week: number): string => {
    if (kpi?.tagNoteList && Array.isArray(kpi.tagNoteList) && kpi.tagNoteList[week] !== undefined) {
      return kpi.tagNoteList[week] || '';
    }
    if (week === 0 && kpi?.tagNote) {
      return kpi.tagNote;
    }
    return '';
  };

  const updateKpiFieldList = (field: string, value: any) => {
    const listName = `${field}List`;
    const currentList = [...(editKpi[listName] || ['', '', '', '', ''])];
    currentList[selectedWeek] = value;
    
    const legacyUpdate = selectedWeek === 0 ? { [field]: value } : {};
    
    setEditKpi({
      ...editKpi,
      [listName]: currentList,
      ...legacyUpdate
    });
  };

  // Pipeline History helper
  const [pipelineHistory, setPipelineHistory] = useState<any[]>(() => {
    const saved = localStorage.getItem('next_pipelines_history');
    return saved ? JSON.parse(saved) : [];
  });

  const logPipelineHistory = (pipeline: any, action: string, details: string) => {
    try {
      const saved = localStorage.getItem('next_pipelines_history');
      const logs = saved ? JSON.parse(saved) : [];
      const newLog = {
        id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        timestamp: new Date().toISOString(),
        pipelineId: pipeline.id,
        client: pipeline.client,
        courseName: pipeline.courseName,
        action,
        details,
        repId: rep.id,
        repName: rep.name
      };
      const updated = [newLog, ...logs];
      localStorage.setItem('next_pipelines_history', JSON.stringify(updated));
      setPipelineHistory(updated);
    } catch (e) {
      console.error(e);
    }
  };

  // Helper to load all shared stacked pipelines (collaborative view across all representatives)
  const getSharedPipelines = (): any[] => {
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
        return parsed;
      } catch {
        return [];
      }
    }
    
    // If already seeded to Firestore or explicitly cleared, do not re-generate defaults
    if (localStorage.getItem('migrated_pipelines_to_firestore') === 'true') {
      return [];
    }

    const combined: any[] = [];
    const repIds = ['xin-ying', 'chee-cai', 'alif', 'atiqa', 'new-guy'];
    repIds.forEach(id => {
      let repPipes: any[] = [];
      const localSaved = localStorage.getItem(`next_pipelines_${id}`);
      if (localSaved) {
        try { repPipes = JSON.parse(localSaved); } catch { repPipes = []; }
      } else {
        repPipes = getInitialPipelinesForRep(id);
      }
      
      const repObj = reps?.find(r => r.id === id);
      const repName = repObj ? repObj.name : (id.charAt(0).toUpperCase() + id.slice(1).replace('-', ' '));

      repPipes.forEach((p: any) => {
        if (p.id === 'pipe_4' && p.proposalValue === 65000) {
          p.proposalValue = 0;
        }
        if (!combined.some(item => item.id === p.id)) {
          combined.push({
            ...p,
            creatorId: p.creatorId || id,
            creatorName: p.creatorName || repName,
            ownerId: p.ownerId || id,
            ownerName: p.ownerName || repName
          });
        }
      });
    });
    
    localStorage.setItem('next_pipelines_shared', JSON.stringify(combined));
    return combined;
  };

  // Stacked, shared pipeline state
  const [pipelines, setPipelines] = useState<any[]>(() => {
    return getSharedPipelines();
  });

  // Real-time Firestore sync for pipelines
  useEffect(() => {
    if (!db) return;

    const q = query(collection(db, 'pipelines'));
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const firestorePipes: any[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const docId = docSnap.id;
        if (docId === 'pipe_4' && data.proposalValue === 65000) {
          data.proposalValue = 0;
          setDoc(doc(db, 'pipelines', 'pipe_4'), { ...data, proposalValue: 0 }).catch(err => console.error(err));
        }
        firestorePipes.push({
          ...data,
          id: docId,
          ownerId: data.ownerId || (docId === 'pipe_1' || docId === 'pipe_2' ? 'chee-cai' : docId === 'pipe_3' ? 'alif' : docId === 'pipe_4' ? 'xin-ying' : ''),
          creatorId: data.creatorId || (docId === 'pipe_1' || docId === 'pipe_2' ? 'chee-cai' : docId === 'pipe_3' ? 'alif' : docId === 'pipe_4' ? 'xin-ying' : '')
        });
      });

      if (firestorePipes.length > 0) {
        // Sort descending by id to show newest first
        firestorePipes.sort((a, b) => b.id.localeCompare(a.id));
        setPipelines(firestorePipes);
        localStorage.setItem('next_pipelines_shared', JSON.stringify(firestorePipes));
        localStorage.setItem('migrated_pipelines_to_firestore', 'true');
        
        // Sync back to individual keys
        const repIds = ['xin-ying', 'chee-cai', 'alif', 'atiqa', 'new-guy'];
        repIds.forEach(id => {
          const ownedPipes = firestorePipes.filter(p => p.ownerId === id || p.creatorId === id || p.taggedRepIds?.includes(id));
          localStorage.setItem(`next_pipelines_${id}`, JSON.stringify(ownedPipes));
        });
      } else {
        const alreadyMigrated = localStorage.getItem('migrated_pipelines_to_firestore') === 'true';
        if (!alreadyMigrated) {
          // No pipelines in Firestore yet, let's migrate local ones!
          const localSaved = localStorage.getItem('next_pipelines_shared');
          let parsed: any[] = [];
          if (localSaved) {
            try {
              parsed = JSON.parse(localSaved);
            } catch {}
          }
          if (!parsed || parsed.length === 0) {
            parsed = getSharedPipelines();
          }
          if (parsed && parsed.length > 0) {
            for (const p of parsed) {
              const docId = p.id || `pipe_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
              await setDoc(doc(db, 'pipelines', docId), {
                ...p,
                id: docId,
                ownerId: p.ownerId || (docId === 'pipe_1' || docId === 'pipe_2' ? 'chee-cai' : docId === 'pipe_3' ? 'alif' : docId === 'pipe_4' ? 'xin-ying' : ''),
                creatorId: p.creatorId || (docId === 'pipe_1' || docId === 'pipe_2' ? 'chee-cai' : docId === 'pipe_3' ? 'alif' : docId === 'pipe_4' ? 'xin-ying' : '')
              });
            }
          }
          localStorage.setItem('migrated_pipelines_to_firestore', 'true');
        } else {
          setPipelines([]);
          localStorage.setItem('next_pipelines_shared', JSON.stringify([]));
          const repIds = ['xin-ying', 'chee-cai', 'alif', 'atiqa', 'new-guy'];
          repIds.forEach(id => {
            localStorage.setItem(`next_pipelines_${id}`, JSON.stringify([]));
          });
        }
      }
    });

    return () => unsubscribe();
  }, []);

  // Real-time Firestore sync for Links
  useEffect(() => {
    if (!db) return;

    const docRef = doc(db, 'links', rep.id);
    const unsubscribe = onSnapshot(docRef, async (docSnap) => {
      if (docSnap.exists()) {
        const firestoreLinks = docSnap.data() as GoogleLinks;
        setLinks(firestoreLinks);
        localStorage.setItem(`next_links_${rep.id}`, JSON.stringify(firestoreLinks));
      } else {
        const storedLinks = localStorage.getItem(`next_links_${rep.id}`);
        let parsedLinks: GoogleLinks = {
          quotation: '',
          clientList: '',
          faci: '',
          venue: '',
          trainerList: '',
          pendingTasks: '',
          pAndL: ''
        };
        if (storedLinks) {
          try {
            parsedLinks = JSON.parse(storedLinks);
          } catch {}
        }
        await setDoc(docRef, parsedLinks);
      }
    });

    return () => unsubscribe();
  }, [rep.id]);

  // Real-time Firestore sync for Payments
  useEffect(() => {
    if (!db) return;

    const q = query(collection(db, 'payments'));
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const firestorePayments: any[] = [];
      snapshot.forEach((docSnap) => {
        firestorePayments.push({ ...docSnap.data(), id: docSnap.id });
      });

      if (firestorePayments.length > 0) {
        firestorePayments.sort((a, b) => b.id.localeCompare(a.id));
        setPayments(firestorePayments);
        localStorage.setItem('next_payments_shared', JSON.stringify(firestorePayments));
      } else {
        const localSaved = localStorage.getItem('next_payments_shared');
        let parsed: any[] = [];
        if (localSaved) {
          try {
            parsed = JSON.parse(localSaved);
          } catch {}
        }
        if (parsed && parsed.length > 0) {
          for (const p of parsed) {
            const docId = p.id || `pay_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
            await setDoc(doc(db, 'payments', docId), {
              ...p,
              id: docId
            });
          }
        }
      }
    });

    return () => unsubscribe();
  }, []);

  // Real-time Firestore sync for Trainers
  useEffect(() => {
    if (!db) return;

    const docRef = doc(db, 'trainers', rep.id);
    const unsubscribe = onSnapshot(docRef, async (docSnap) => {
      if (docSnap.exists()) {
        const firestoreTrainers = docSnap.data().trainers || [];
        setTrainers(firestoreTrainers);
        localStorage.setItem(`next_trainers_${rep.id}`, JSON.stringify(firestoreTrainers));
      } else {
        const savedTrainers = localStorage.getItem(`next_trainers_${rep.id}`);
        let parsedTrainers = [
          { id: 't_1', name: 'Dr. Jason Lee', specialization: 'React & AI Integration', contact: '+6012-3456789', status: 'Available', rate: 2500 },
          { id: 't_2', name: 'Sarah Amanda', specialization: 'Design Thinking & Soft Skills', contact: '+6013-9876543', status: 'Booked', rate: 1800 },
          { id: 't_3', name: 'Aris Rahman', specialization: 'Full-Stack Web Development', contact: '+6017-1112233', status: 'Available', rate: 2000 }
        ];
        if (savedTrainers) {
          try {
            parsedTrainers = JSON.parse(savedTrainers);
          } catch {}
        }
        await setDoc(docRef, { trainers: parsedTrainers });
      }
    });

    return () => unsubscribe();
  }, [rep.id]);

  // Real-time Firestore sync for Venues
  useEffect(() => {
    if (!db) return;

    const docRef = doc(db, 'venues', rep.id);
    const unsubscribe = onSnapshot(docRef, async (docSnap) => {
      if (docSnap.exists()) {
        const firestoreVenues = docSnap.data().venues || [];
        setVenues(firestoreVenues);
        localStorage.setItem(`next_venues_${rep.id}`, JSON.stringify(firestoreVenues));
      } else {
        const savedVenues = localStorage.getItem(`next_venues_${rep.id}`);
        let parsedVenues = [
          { 
            id: 'v_1', 
            name: 'Happi Village, Janda Baik', 
            distance: '45 km from HQ', 
            meetingPackagePrice: 'RM 150/pax/day', 
            roomPackagePrice: 'RM 280/pax', 
            dinnerPackage: 'RM 120/pax (BBQ Buffet)', 
            facilities: 'WiFi, Projector, Sound System, Poolside lounge', 
            contact: 'Ms. Wong (+6019-2223344) / reservation@happivillage.my', 
            quotationDate: '2026-05-15', 
            remarks: 'Great outdoor vibe, cooler weather. Highly recommended for team bonding.', 
            pictures: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=300&q=80',
            status: 'Available'
          },
          { 
            id: 'v_2', 
            name: 'Park Royal Resort', 
            distance: '120 km from HQ', 
            meetingPackagePrice: 'RM 180/pax/day', 
            roomPackagePrice: 'RM 350/pax', 
            dinnerPackage: 'RM 150/pax (International Buffet)', 
            facilities: 'Ballroom, PA System, 5 Breakout rooms, Beach access', 
            contact: 'Mr. Tan (+6016-5556677) / tan.parkroyal@gmail.com', 
            quotationDate: '2026-06-01', 
            remarks: 'Premium beachside resort location. Good for corporate annual dinner.', 
            pictures: 'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?auto=format&fit=crop&w=300&q=80',
            status: 'Booked'
          }
        ];
        if (savedVenues) {
          try {
            parsedVenues = JSON.parse(savedVenues);
          } catch {}
        }
        await setDoc(docRef, { venues: parsedVenues });
      }
    });

    return () => unsubscribe();
  }, [rep.id]);

  // Sync pipelines and reset pipeline forms when representative changes
  useEffect(() => {
    // Keep local form values reset cleanly
    setPipeClient('');
    setPipeCourseName('');
    setPipeRequestDate(new Date().toISOString().substring(0, 10));
    setPipeType('Training');
    setPipeProposalSentDate(new Date().toISOString().substring(0, 10));
    setPipeProposalValue('');
    setPipeFollowUpDate('');
    setPipeStatus('Pending');
    setPipeOwnerId(rep.id);
    setEditingPipeId(null);
    setPipeTaggedRepIds([]);
    setPipeTagNote('');
    setPipeNotes('');
    setPipelineError(null);
    setPipeProposalNotSentYet(false);
    setPipeAppointmentTicked(false);
  }, [rep]);

  // Undo States for Pipeline Management
  const [previousPipelines, setPreviousPipelines] = useState<any[] | null>(null);
  const [pipelineUndoMessage, setPipelineUndoMessage] = useState<string | null>(null);

  const handlePipelineUndo = async () => {
    if (previousPipelines) {
      const currentIds = new Set(pipelines.map(p => p.id));
      const deletedPipes = previousPipelines.filter(p => !currentIds.has(p.id));
      for (const p of deletedPipes) {
        try {
          await setDoc(doc(db, 'pipelines', p.id), p);
        } catch (err) {
          console.error("Firestore restore pipeline failed:", err);
        }
      }
      setPipelines(previousPipelines);
      localStorage.setItem('next_pipelines_shared', JSON.stringify(previousPipelines));
      setPreviousPipelines(null);
      setPipelineUndoMessage(null);
    }
  };

  // Pipeline Form States
  const [pipeClient, setPipeClient] = useState('');
  const [pipeCourseName, setPipeCourseName] = useState('');
  const [pipeRequestDate, setPipeRequestDate] = useState(new Date().toISOString().substring(0, 10));
  const [pipeType, setPipeType] = useState<'Training' | 'Teambuilding'>('Training');
  const [pipeProposalSentDate, setPipeProposalSentDate] = useState(new Date().toISOString().substring(0, 10));
  const [pipeProposalValue, setPipeProposalValue] = useState('');
  const [pipeFollowUpDate, setPipeFollowUpDate] = useState('');
  const [pipeStatus, setPipeStatus] = useState<'Pending' | 'Won' | 'Lost'>('Pending');
  const [pipeOwnerId, setPipeOwnerId] = useState<string>(rep.id);
  const [editingPipeId, setEditingPipeId] = useState<string | null>(null);
  const [pipelineSortBy, setPipelineSortBy] = useState<'latest' | 'oldest' | 'pending' | 'won' | 'lost'>('latest');
  const [pipeTaggedRepIds, setPipeTaggedRepIds] = useState<string[]>([]);
  const [pipeTagNote, setPipeTagNote] = useState<string>('');
  const [pipeNotes, setPipeNotes] = useState<string>('');
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [pipeProposalNotSentYet, setPipeProposalNotSentYet] = useState(false);
  const [pipeAppointmentTicked, setPipeAppointmentTicked] = useState(false);

  // Reset pipelines list when rep changes
  const handleRaisePipelineSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const valAmount = parseFloat(pipeProposalValue) || 0;
    
    // Requirement validation: When Status is won, make sure proposal value is keyed in
    if (pipeStatus === 'Won' && (!pipeProposalValue.trim() || valAmount <= 0)) {
      alert("please update closed amount.");
      setPipelineError("please update closed amount.");
      const cardEl = document.getElementById('pipeline-form-card');
      if (cardEl) {
        cardEl.scrollIntoView({ behavior: 'smooth' });
      }
      return;
    }
    
    setPipelineError(null);

    // Save previous state for Undo
    setPreviousPipelines(JSON.parse(JSON.stringify(pipelines)));
    setPipelineUndoMessage(editingPipeId ? 'Opportunity updated successfully.' : 'New opportunity logged successfully.');

    let updated: any[] = [];
    let oldPipe: any = undefined;
    let newPipe: any = undefined;
    const sentDate = pipeProposalNotSentYet ? 'not yet' : pipeProposalSentDate;

    const ownerObj = reps.find(r => r.id === pipeOwnerId) || rep;

    if (editingPipeId) {
      oldPipe = pipelines.find(p => p.id === editingPipeId);
      updated = pipelines.map(p => {
        if (p.id === editingPipeId) {
          newPipe = {
            ...p,
            client: pipeClient,
            courseName: pipeCourseName,
            requestDate: pipeRequestDate,
            type: pipeType,
            proposalSentDate: sentDate,
            proposalValue: valAmount,
            followUpDate: pipeFollowUpDate || 'TBD',
            status: pipeStatus,
            ownerId: pipeOwnerId,
            ownerName: ownerObj.name,
            taggedRepIds: pipeTaggedRepIds,
            tagNote: pipeTagNote.trim() || undefined,
            notes: pipeNotes.trim() || undefined,
            completedTags: p.completedTags || [],
            appointmentTicked: pipeAppointmentTicked
          };

          // Log history for edit or transfer
          let historyDetails = `Updated details for client ${pipeClient}.`;
          if (oldPipe.ownerId !== pipeOwnerId) {
            historyDetails += ` Transferred ownership from ${oldPipe.ownerName} to ${ownerObj.name}.`;
            logPipelineHistory(newPipe, 'Ownership Transferred', historyDetails);
          } else if (oldPipe.status !== pipeStatus) {
            historyDetails += ` Changed status from ${oldPipe.status} to ${pipeStatus}.`;
            logPipelineHistory(newPipe, 'Status Changed', historyDetails);
          } else {
            logPipelineHistory(newPipe, 'Updated', historyDetails);
          }

          return newPipe;
        }
        return p;
      });
      setEditingPipeId(null);
    } else {
      newPipe = {
        id: `pipe_${Date.now()}`,
        client: pipeClient,
        courseName: pipeCourseName,
        requestDate: pipeRequestDate,
        type: pipeType,
        proposalSentDate: sentDate,
        proposalValue: valAmount,
        followUpDate: pipeFollowUpDate || 'TBD',
        status: pipeStatus,
        creatorId: rep.id,
        creatorName: rep.name,
        ownerId: pipeOwnerId,
        ownerName: ownerObj.name,
        taggedRepIds: pipeTaggedRepIds,
        tagNote: pipeTagNote.trim() || undefined,
        notes: pipeNotes.trim() || undefined,
        completedTags: [],
        appointmentTicked: pipeAppointmentTicked
      };
      updated = [newPipe, ...pipelines];
      
      logPipelineHistory(newPipe, 'Created', `Logged new pipeline opportunity for client ${pipeClient} with value RM ${valAmount}.`);
    }
    
    setPipelines(updated);
    localStorage.setItem('next_pipelines_shared', JSON.stringify(updated));

    try {
      await setDoc(doc(db, 'pipelines', newPipe.id), newPipe);
    } catch (err) {
      console.error("Firestore save pipeline failed:", err);
    }

    // Sync back to individual keys
    const repIds = ['xin-ying', 'chee-cai', 'alif', 'atiqa', 'new-guy'];
    repIds.forEach(id => {
      const ownedPipes = updated.filter(p => p.ownerId === id || p.creatorId === id || p.taggedRepIds?.includes(id));
      localStorage.setItem(`next_pipelines_${id}`, JSON.stringify(ownedPipes));
    });

    // Auto-update representative's KPI figures
    adjustKpiForPipelineChange(oldPipe, newPipe);

    // Reset Form
    setPipeClient('');
    setPipeCourseName('');
    setPipeRequestDate(new Date().toISOString().substring(0, 10));
    setPipeType('Training');
    setPipeProposalSentDate(new Date().toISOString().substring(0, 10));
    setPipeProposalValue('');
    setPipeFollowUpDate('');
    setPipeStatus('Pending');
    setPipeOwnerId(rep.id);
    setPipeTaggedRepIds([]);
    setPipeTagNote('');
    setPipeNotes('');
    setPipeProposalNotSentYet(false);
    setPipeAppointmentTicked(false);
  };

  const handleAddTaskSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskDetail.trim() || !taskDateline) return;

    const targetRepId = taskAssignedToId || rep.id;
    const repNameMap: Record<string, string> = {
      'xin-ying': 'Xin Ying',
      'chee-cai': 'Chee Cai',
      'alif': 'Alif',
      'atiqa': 'Atiqa',
      'new-guy': 'New Guy'
    };
    const targetRepName = repNameMap[targetRepId] || targetRepId;

    const newTask: any = {
      id: `task_${Date.now()}`,
      dateCreated: new Date().toISOString().substring(0, 10),
      detail: taskDetail,
      dateline: taskDateline,
      status: 'Not done',
      assignedBy: rep.name,
      assignedById: rep.id,
      assignedTo: targetRepName,
      assignedToId: targetRepId,
      isHidden: false,
      ownerRepId: rep.id,
      createdAt: Date.now()
    };

    const updated = [newTask, ...tasks];
    setTasks(updated);
    localStorage.setItem(`next_tasks_${rep.id}`, JSON.stringify(updated));

    // Save to Firestore!
    try {
      await setDoc(doc(db, 'tasks', newTask.id), newTask);
    } catch (err) {
      console.error("Error adding task to Firestore:", err);
    }

    // Create duplicate task in the other rep's workspace if assigned to someone else
    if (targetRepId !== rep.id) {
      try {
        const dupId = `task_dup_${Date.now()}`;
        const duplicateTask = {
          ...newTask,
          id: dupId,
          isDuplicate: true,
          ownerRepId: targetRepId,
          createdAt: Date.now()
        };
        await setDoc(doc(db, 'tasks', dupId), duplicateTask);

        const otherSaved = localStorage.getItem(`next_tasks_${targetRepId}`);
        const otherTasks = otherSaved ? JSON.parse(otherSaved) : [];
        otherTasks.unshift(duplicateTask);
        localStorage.setItem(`next_tasks_${targetRepId}`, JSON.stringify(otherTasks));
      } catch (err) {
        console.error("Failed to duplicate task:", err);
      }
    }

    setTaskDetail('');
    setTaskDateline('');
    setTaskAssignedToId('');
  };

  // Trainer List States
  const [trainers, setTrainers] = useState<any[]>(() => {
    const saved = localStorage.getItem(`next_trainers_${rep.id}`);
    if (saved) return JSON.parse(saved);
    return [
      { id: 't_1', name: 'Dr. Jason Lee', specialization: 'React & AI Integration', contact: '+6012-3456789', status: 'Available', rate: 2500 },
      { id: 't_2', name: 'Sarah Amanda', specialization: 'Design Thinking & Soft Skills', contact: '+6013-9876543', status: 'Booked', rate: 1800 },
      { id: 't_3', name: 'Aris Rahman', specialization: 'Full-Stack Web Development', contact: '+6017-1112233', status: 'Available', rate: 2000 }
    ];
  });

  const [trainerName, setTrainerName] = useState('');
  const [trainerSpec, setTrainerSpec] = useState('React & AI Integration');
  const [trainerContact, setTrainerContact] = useState('');
  const [trainerStatus, setTrainerStatus] = useState('Available');
  const [trainerRate, setTrainerRate] = useState('');

  // Venue List States
  const [venues, setVenues] = useState<any[]>(() => {
    const saved = localStorage.getItem(`next_venues_${rep.id}`);
    if (saved) return JSON.parse(saved);
    return [
      { 
        id: 'v_1', 
        name: 'Happi Village, Janda Baik', 
        distance: '45 km from HQ', 
        meetingPackagePrice: 'RM 150/pax/day', 
        roomPackagePrice: 'RM 280/pax', 
        dinnerPackage: 'RM 120/pax (BBQ Buffet)', 
        facilities: 'WiFi, Projector, Sound System, Poolside lounge', 
        contact: 'Ms. Wong (+6019-2223344) / reservation@happivillage.my', 
        quotationDate: '2026-05-15', 
        remarks: 'Great outdoor vibe, cooler weather. Highly recommended for team bonding.', 
        pictures: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=300&q=80',
        status: 'Available'
      },
      { 
        id: 'v_2', 
        name: 'Park Royal Resort', 
        distance: '120 km from HQ', 
        meetingPackagePrice: 'RM 180/pax/day', 
        roomPackagePrice: 'RM 350/pax', 
        dinnerPackage: 'RM 150/pax (International Buffet)', 
        facilities: 'Ballroom, PA System, 5 Breakout rooms, Beach access', 
        contact: 'Mr. Tan (+6016-5556677) / tan.parkroyal@gmail.com', 
        quotationDate: '2026-06-01', 
        remarks: 'Premium beachside resort location. Good for corporate annual dinner.', 
        pictures: 'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?auto=format&fit=crop&w=300&q=80',
        status: 'Booked'
      }
    ];
  });

  const [venueNameInput, setVenueNameInput] = useState('');
  const [venueDistanceInput, setVenueDistanceInput] = useState('');
  const [venueMeetingPackagePrice, setVenueMeetingPackagePrice] = useState('');
  const [venueRoomPackagePrice, setVenueRoomPackagePrice] = useState('');
  const [venueDinnerPackage, setVenueDinnerPackage] = useState('');
  const [venueFacilities, setVenueFacilities] = useState('');
  const [venueContactInput, setVenueContactInput] = useState('');
  const [venueQuotationDate, setVenueQuotationDate] = useState('');
  const [venueRemarks, setVenueRemarks] = useState('');
  const [venuePictures, setVenuePictures] = useState('');
  const [venueStatusInput, setVenueStatusInput] = useState('Available');

  // Pending Tasks States
  const [tasks, setTasks] = useState<any[]>([]);
  const [taskDetail, setTaskDetail] = useState('');
  const [taskDateline, setTaskDateline] = useState('');
  const [taskAssignedToId, setTaskAssignedToId] = useState('');
  const [taskSortBy, setTaskSortBy] = useState<'dateCreated' | 'dateline'>('dateCreated');
  const [taskHideDone, setTaskHideDone] = useState(false);
  const [previousTasks, setPreviousTasks] = useState<any[] | null>(null);
  const [taskUndoMessage, setTaskUndoMessage] = useState<string | null>(null);

  const handleTaskUndo = async () => {
    if (previousTasks) {
      const currentIds = new Set(tasks.map(t => t.id));
      const deletedTasks = previousTasks.filter(t => !currentIds.has(t.id));
      for (const t of deletedTasks) {
        try {
          await setDoc(doc(db, 'tasks', t.id), t);
        } catch (err) {
          console.error("Error restoring task:", err);
        }
      }
      setTasks(previousTasks);
      localStorage.setItem(`next_tasks_${rep.id}`, JSON.stringify(previousTasks));
      setPreviousTasks(null);
      setTaskUndoMessage(null);
    }
  };

  // Real-time Firestore sync with local storage migration fallback
  useEffect(() => {
    if (!db) return;

    const q = query(collection(db, 'tasks'), where('ownerRepId', '==', rep.id));
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const firestoreTasks: any[] = [];
      snapshot.forEach((doc) => {
        firestoreTasks.push({ ...doc.data(), id: doc.id });
      });

      if (firestoreTasks.length > 0) {
        setTasks(firestoreTasks);
        localStorage.setItem(`next_tasks_${rep.id}`, JSON.stringify(firestoreTasks));
      } else {
        const savedTasks = localStorage.getItem(`next_tasks_${rep.id}`);
        if (savedTasks) {
          try {
            const parsed = JSON.parse(savedTasks);
            if (parsed && parsed.length > 0) {
              for (const t of parsed) {
                const docId = t.id || `task_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
                await setDoc(doc(db, 'tasks', docId), {
                  ...t,
                  id: docId,
                  ownerRepId: rep.id,
                  createdAt: t.createdAt || Date.now()
                });
              }
              setTasks(parsed);
            } else {
              setTasks([]);
            }
          } catch (err) {
            console.error("Migration error:", err);
            setTasks([]);
          }
        } else {
          setTasks([]);
        }
      }
    });

    return () => unsubscribe();
  }, [rep.id]);

  const handleAddTrainerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trainerName.trim()) return;
    const newTrainer = {
      id: `t_${Date.now()}`,
      name: trainerName,
      specialization: trainerSpec,
      contact: trainerContact || 'N/A',
      status: trainerStatus,
      rate: parseFloat(trainerRate) || 0
    };
    const updated = [...trainers, newTrainer];
    setTrainers(updated);
    localStorage.setItem(`next_trainers_${rep.id}`, JSON.stringify(updated));
    try {
      if (db) {
        await setDoc(doc(db, 'trainers', rep.id), { trainers: updated });
      }
    } catch (err) {
      console.error("Firestore save trainer failed:", err);
    }

    setTrainerName('');
    setTrainerContact('');
    setTrainerRate('');
    setTrainerStatus('Available');
  };

  const handleAddVenueSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!venueNameInput.trim()) return;
    const newVenue = {
      id: `v_${Date.now()}`,
      name: venueNameInput,
      distance: venueDistanceInput || 'N/A',
      meetingPackagePrice: venueMeetingPackagePrice || 'N/A',
      roomPackagePrice: venueRoomPackagePrice || 'N/A',
      dinnerPackage: venueDinnerPackage || 'N/A',
      facilities: venueFacilities || 'N/A',
      contact: venueContactInput || 'N/A',
      quotationDate: venueQuotationDate || 'N/A',
      remarks: venueRemarks || 'N/A',
      pictures: venuePictures || '',
      status: venueStatusInput
    };
    const updated = [...venues, newVenue];
    setVenues(updated);
    localStorage.setItem(`next_venues_${rep.id}`, JSON.stringify(updated));
    try {
      if (db) {
        await setDoc(doc(db, 'venues', rep.id), { venues: updated });
      }
    } catch (err) {
      console.error("Firestore save venue failed:", err);
    }

    setVenueNameInput('');
    setVenueDistanceInput('');
    setVenueMeetingPackagePrice('');
    setVenueRoomPackagePrice('');
    setVenueDinnerPackage('');
    setVenueFacilities('');
    setVenueContactInput('');
    setVenueQuotationDate('');
    setVenueRemarks('');
    setVenuePictures('');
    setVenueStatusInput('Available');
  };

  // Helper calculation formulas matching screenshot 2
  const sumArray = (arr: number[]) => arr.reduce((a, b) => a + b, 0);

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

  const getWeekFromDate = (dateStr: string): number => {
    try {
      const d = new Date(dateStr);
      const day = d.getDate();
      if (day <= 7) return 0;
      if (day <= 14) return 1;
      if (day <= 21) return 2;
      if (day <= 28) return 3;
      return 4;
    } catch {
      return 0;
    }
  };

  // Dynamic metrics configurations for current rep
  const metricsList = getRepMetrics(rep);

  const getMetricLabel = (key: string): string => {
    const config = metricsList.find(m => m.key === key);
    return config ? config.label : '';
  };

  const adjustKpiForPipelineChange = (
    oldPipe: any | undefined,
    newPipe: any | undefined
  ) => {
    // Pipeline changes are handled completely dynamically now to prevent double-counting.
    // This maintains clean, real-time sync between the collaborative pipelines log and individual KPI panels.
  };

  const getPipelineSalesForWeek = (weekIdx: number): number => {
    return pipelines
      .filter(p => {
        if (p.status !== 'Won') return false;
        
        // Filter by the current representative's ID as the OWNER
        const currentOwnerId = p.ownerId || p.creatorId || rep.id;
        if (currentOwnerId !== rep.id) return false;

        const dateStr = p.proposalSentDate || p.requestDate || '';
        
        // Month filter
        const monthMap: Record<string, string> = {
          'JAN': '01', 'FEB': '02', 'MAR': '03', 'APR': '04', 'MAY': '05', 'JUN': '06',
          'JUL': '07', 'AUG': '08', 'SEP': '09', 'OCT': '10', 'NOV': '11', 'DEC': '12'
        };
        const parts = selectedMonth.split('-');
        if (parts.length === 2) {
          const m = monthMap[parts[0]];
          const y = '20' + parts[1];
          if (m && y) {
            const prefix = `${y}-${m}`;
            if (!dateStr.startsWith(prefix)) return false;
          }
        }
        
        return getWeekFromDate(dateStr) === weekIdx;
      })
      .reduce((sum, p) => sum + (parseFloat(p.proposalValue) || 0), 0);
  };

  const getPipelineProposalsForWeek = (weekIdx: number): number => {
    if (rep.id === 'atiqa') return 0;
    return pipelines
      .filter(p => {
        // Filter by the current representative's ID as the OWNER
        const currentOwnerId = p.ownerId || p.creatorId || rep.id;
        if (currentOwnerId !== rep.id) return false;

        const dateStr = p.proposalSentDate || '';
        if (!dateStr || dateStr.toLowerCase() === 'not yet') return false;
        
        // Month filter
        const monthMap: Record<string, string> = {
          'JAN': '01', 'FEB': '02', 'MAR': '03', 'APR': '04', 'MAY': '05', 'JUN': '06',
          'JUL': '07', 'AUG': '08', 'SEP': '09', 'OCT': '10', 'NOV': '11', 'DEC': '12'
        };
        const parts = selectedMonth.split('-');
        if (parts.length === 2) {
          const m = monthMap[parts[0]];
          const y = '20' + parts[1];
          if (m && y) {
            const prefix = `${y}-${m}`;
            if (!dateStr.startsWith(prefix)) return false;
          }
        }
        
        return getWeekFromDate(dateStr) === weekIdx;
      }).length;
  };

  const getPipelineAppointmentsForWeek = (weekIdx: number): number => {
    if (rep.id === 'atiqa') return 0;
    return pipelines
      .filter(p => {
        // Filter by the current representative's ID as the OWNER
        const currentOwnerId = p.ownerId || p.creatorId || rep.id;
        if (currentOwnerId !== rep.id) return false;

        // Ticked/marked as an appointment
        if (!p.isAppointment && !p.appointmentTicked) return false;

        const dateStr = p.requestDate || '';
        if (!dateStr) return false;
        
        // Month filter
        const monthMap: Record<string, string> = {
          'JAN': '01', 'FEB': '02', 'MAR': '03', 'APR': '04', 'MAY': '05', 'JUN': '06',
          'JUL': '07', 'AUG': '08', 'SEP': '09', 'OCT': '10', 'NOV': '11', 'DEC': '12'
        };
        const parts = selectedMonth.split('-');
        if (parts.length === 2) {
          const m = monthMap[parts[0]];
          const y = '20' + parts[1];
          if (m && y) {
            const prefix = `${y}-${m}`;
            if (!dateStr.startsWith(prefix)) return false;
          }
        }
        
        return getWeekFromDate(dateStr) === weekIdx;
      }).length;
  };

  const getPipelineMetricForWeek = (key: string, weekIdx: number): number => {
    if (rep.id === 'atiqa') return 0;
    const label = getMetricLabel(key);
    if (label === 'Appointment' || label === 'Preview') {
      return getPipelineAppointmentsForWeek(weekIdx);
    }
    if (label === 'Proposal') {
      return getPipelineProposalsForWeek(weekIdx);
    }
    return 0;
  };

  // Get totals
  const totalSalesFromPipeline = rep.id === 'atiqa' ? 0 : [0, 1, 2, 3, 4].reduce((sum, wk) => sum + getPipelineSalesForWeek(wk), 0);
  const totalSales = sumArray(rep.kpi?.salesFigure ?? []) + totalSalesFromPipeline;
  
  const totalProposalsFromPipeline = rep.id === 'atiqa' ? 0 : [0, 1, 2, 3, 4].reduce((sum, wk) => sum + getPipelineMetricForWeek('proposals', wk), 0);
  const totalProposals = sumArray(rep.kpi?.proposals ?? []) + totalProposalsFromPipeline;
  
  const totalPreviewFromPipeline = rep.id === 'atiqa' ? 0 : [0, 1, 2, 3, 4].reduce((sum, wk) => sum + getPipelineMetricForWeek('preview', wk), 0);
  const totalPreview = sumArray(rep.kpi?.preview ?? []) + totalPreviewFromPipeline;

  // Score badge color logic
  const getScoreStyle = (score: number) => {
    if (score < 20) return 'bg-[#FEF2F2] text-[#EF4444] border-[#FEE2E2]';
    if (score < 50) return 'bg-[#FFFBEB] text-[#D97706] border-[#FEF3C7]';
    return 'bg-[#ECFDF5] text-[#10B981] border-[#D1FAE5]';
  };
  
  // Calculate dynamic scores for each metric key
  const getMetricScore = (key: string) => {
    const config = metricsList.find(m => m.key === key);
    if (!config) return 0;
    let totalAchieved = 0;
    if (config.isRM) {
      totalAchieved = totalSales;
    } else if (key === 'proposals') {
      totalAchieved = totalProposals;
    } else if (key === 'preview') {
      totalAchieved = totalPreview;
    } else if (key === 'extraMetric') {
      totalAchieved = (rep.kpi.extraMetric || []).reduce((a, b) => a + b, 0);
    }
    return Math.min(100, Math.round((totalAchieved / config.targetVal) * 100)) || 0;
  };

  const salesScore = getMetricScore('salesFigure');
  const proposalsScore = getMetricScore('proposals');
  const previewScore = getMetricScore('preview');
  const extraMetricScore = getMetricScore('extraMetric');

  // Compute overall performance score using individual weights
  const overallScore = Math.round(metricsList.reduce((sum, m) => {
    const score = getMetricScore(m.key);
    return sum + (score * m.weight);
  }, 0));

  const hasPendingKpiAlerts = reps.filter(r => r.id !== rep.id).some(r => {
    return [0, 1, 2, 3, 4].some(wkIdx => {
      const isPartner = r.kpi?.accountabilityPartnerIdList?.[wkIdx] === rep.id;
      const isPartnerDone = r.kpi?.completedAccountabilityList?.[wkIdx] || false;
      if (isPartner && !isPartnerDone) return true;

      const taggedIds = r.kpi?.taggedRepIdsList?.[wkIdx] || (wkIdx === 0 && r.kpi?.taggedRepIds ? r.kpi.taggedRepIds : []);
      const completedList = r.kpi?.completedTagsList?.[wkIdx] || [];
      const isTagged = taggedIds.includes(rep.id);
      const isTaggedDone = completedList.includes(rep.id);
      if (isTagged && !isTaggedDone) return true;

      return false;
    });
  });

  const hasTaggedQuotations = (() => {
    try {
      const saved = localStorage.getItem('next_quotations_lzk.joel@gmail.com');
      if (saved) {
        const quotes = JSON.parse(saved);
        return Array.isArray(quotes) && quotes.some((q: any) => q.taggedRepId === rep.id && !q.isCompleted);
      }
    } catch (e) {
      console.error(e);
    }
    return false;
  })();

  const hasTaggedCourseOutlines = (() => {
    try {
      const saved = localStorage.getItem('next_course_outlines_lzk.joel@gmail.com');
      if (saved) {
        const outlines = JSON.parse(saved);
        return Array.isArray(outlines) && outlines.some((o: any) => o.taggedRepId === rep.id && !o.isCompleted);
      }
    } catch (e) {
      console.error(e);
    }
    return false;
  })();

  const inboundKpiTags = reps.filter(r => r.id !== rep.id).flatMap(r => {
    const taggedIds = r.kpi?.taggedRepIdsList?.[selectedWeek] || (selectedWeek === 0 && r.kpi?.taggedRepIds ? r.kpi.taggedRepIds : []);
    const completedList = r.kpi?.completedTagsList?.[selectedWeek] || [];
    const isTagged = taggedIds.includes(rep.id);
    const isDone = completedList.includes(rep.id);
    
    if (isTagged) {
      return [{
        senderId: r.id,
        senderName: r.name,
        isDone,
        tagNote: r.kpi?.tagNoteList?.[selectedWeek] || (selectedWeek === 0 && r.kpi?.tagNote ? r.kpi.tagNote : '')
      }];
    }
    return [];
  });

  const inboundPartnerTags = reps.filter(r => r.id !== rep.id).flatMap(r => {
    const isPartner = r.kpi?.accountabilityPartnerIdList?.[selectedWeek] === rep.id;
    const isDone = r.kpi?.completedAccountabilityList?.[selectedWeek] || false;
    
    if (isPartner) {
      return [{
        senderId: r.id,
        senderName: r.name,
        isDone,
        type: 'partner' as const
      }];
    }
    return [];
  });

  const handleSaveKpiEdits = () => {
    onUpdateRepKpi(rep.id, editKpi);
    setIsEditingKpi(false);
  };

  const handleInboundTagResponseSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedInboundTag) return;
    const sender = reps.find(r => r.id === selectedInboundTag.senderId);
    if (!sender) return;

    const wkIdx = selectedInboundTag.weekIdx;
    const updatedKpi = JSON.parse(JSON.stringify(sender.kpi || {}));

    // Initialize comments list if needed
    if (!updatedKpi.collaborationCommentsList) {
      updatedKpi.collaborationCommentsList = [[], [], [], [], []];
    }
    while (updatedKpi.collaborationCommentsList.length <= wkIdx) {
      updatedKpi.collaborationCommentsList.push([]);
    }
    if (!Array.isArray(updatedKpi.collaborationCommentsList[wkIdx])) {
      updatedKpi.collaborationCommentsList[wkIdx] = [];
    }

    // Add comment if text exists
    if (tagResponseText.trim()) {
      updatedKpi.collaborationCommentsList[wkIdx].push({
        id: `comment_${Date.now()}`,
        authorId: rep.id,
        authorName: rep.name,
        text: tagResponseText.trim(),
        status: tagResponseStatus,
        timestamp: new Date().toISOString()
      });
    }

    // Update status
    if (selectedInboundTag.type === 'partner') {
      if (!updatedKpi.completedAccountabilityList) {
        updatedKpi.completedAccountabilityList = [];
      }
      updatedKpi.completedAccountabilityList[wkIdx] = (tagResponseStatus === 'Done');
    } else {
      if (!updatedKpi.completedTagsList) {
        updatedKpi.completedTagsList = [];
      }
      if (!updatedKpi.completedTagsList[wkIdx]) {
        updatedKpi.completedTagsList[wkIdx] = [];
      }
      if (tagResponseStatus === 'Done') {
        if (!updatedKpi.completedTagsList[wkIdx].includes(rep.id)) {
          updatedKpi.completedTagsList[wkIdx].push(rep.id);
        }
      } else {
        updatedKpi.completedTagsList[wkIdx] = (updatedKpi.completedTagsList[wkIdx] || []).filter((id: string) => id !== rep.id);
      }
    }

    onUpdateRepKpi(sender.id, updatedKpi);
    setTagResponseText('');
    setSelectedInboundTag(null);
  };

  const handleCellChange = (metric: keyof Representative['kpi'], weekIdx: number, val: string) => {
    const updated = { ...editKpi };
    let num = parseFloat(val) || 0;
    if (rep.id === 'atiqa' && metric === 'salesFigure') {
      if (num < 0) num = 0;
      if (num > 5) num = 5;
    }
    updated[metric] = [...updated[metric]];
    updated[metric][weekIdx] = num;
    setEditKpi(updated);
  };

  // Helper for active Google link
  const getActiveGoogleLink = () => {
    if (activeSubTab === 'quotation') return links.quotation;
    if (activeSubTab === 'client') return links.clientList;
    if (activeSubTab === 'faci') return links.faci;
    if (activeSubTab === 'trainerList') return links.trainerList || '';
    if (activeSubTab === 'venue') return links.venue;
    if (activeSubTab === 'tasks') return links.pendingTasks;
    if (activeSubTab === 'pl') return links.pAndL;
    return '';
  };

  const activeLink = getActiveGoogleLink();

  // Selected Section Header Title
  const getSectionTitle = () => {
    if (activeSubTab === 'kpi') return rep.name;
    if (activeSubTab === 'quotation') return 'QUOTATION';
    if (activeSubTab === 'client') return 'CLIENT DATA';
    if (activeSubTab === 'faci') return 'FACI';
    if (activeSubTab === 'trainerList') return 'TRAINER LIST';
    if (activeSubTab === 'venue') return 'VENUE';
    if (activeSubTab === 'tasks') return 'PENDING TASKS';
    if (activeSubTab === 'pl') return 'P&L';
    if (activeSubTab === 'payment') return 'RAISE PAYMENT';
    if (activeSubTab === 'pipeline') return 'PIPELINE';
    if (activeSubTab === 'course_outline') return 'COURSE OUTLINE';
    if (activeSubTab === 'admin_record') return 'ADMINISTRATIVE RECORDS';
    return rep.name;
  };

  // Compute all system-wide pending alerts for the current representative
  const activeAlerts = (() => {
    const list: any[] = [];

    // 1. KPI & Accountability Partner Alerts (from all weeks)
    reps.filter(r => r.id !== rep.id).forEach(r => {
      [0, 1, 2, 3, 4].forEach(wkIdx => {
        const isPartner = r.kpi?.accountabilityPartnerIdList?.[wkIdx] === rep.id;
        const isPartnerDone = r.kpi?.completedAccountabilityList?.[wkIdx] || false;
        if (isPartner && !isPartnerDone) {
          list.push({
            id: `kpi_partner_${r.id}_${wkIdx}`,
            type: 'kpi_partner',
            icon: '🤝',
            title: 'Accountability Partner Designation',
            message: `${r.name} appointed you as partner for Week ${wkIdx + 1}.`,
            detail: 'Click to read details and complete accountability check-in.',
            subtab: 'kpi',
            weekIdx: wkIdx,
            senderId: r.id,
            senderName: r.name,
            severity: 'warning'
          });
        }

        const taggedIds = r.kpi?.taggedRepIdsList?.[wkIdx] || (wkIdx === 0 && r.kpi?.taggedRepIds ? r.kpi.taggedRepIds : []);
        const completedList = r.kpi?.completedTagsList?.[wkIdx] || [];
        const isTagged = taggedIds.includes(rep.id);
        const isTaggedDone = completedList.includes(rep.id);
        if (isTagged && !isTaggedDone) {
          list.push({
            id: `kpi_tag_${r.id}_${wkIdx}`,
            type: 'kpi_tag',
            icon: '💬',
            title: 'KPI Collaboration Tag',
            message: `${r.name} tagged you in Week ${wkIdx + 1}: "${r.kpi?.tagNoteList?.[wkIdx] || r.kpi?.tagNote || 'Please review.'}"`,
            detail: 'Click to open thread, read details and write response.',
            subtab: 'kpi',
            weekIdx: wkIdx,
            senderId: r.id,
            senderName: r.name,
            severity: 'info'
          });
        }
      });
    });

    // 2. Quotation Tags
    try {
      const saved = localStorage.getItem('next_quotations_lzk.joel@gmail.com');
      if (saved) {
        const quotes = JSON.parse(saved);
        if (Array.isArray(quotes)) {
          quotes.forEach((q: any) => {
            if (q.taggedRepId === rep.id && !q.isCompleted) {
              list.push({
                id: `quotation_${q.id}`,
                type: 'quotation',
                icon: '📄',
                title: 'Pending Quotation Action',
                message: `Quotation for client "${q.clientName || 'Unnamed'}" (prepared by ${q.preparedBy || 'another rep'}) is tagged to you.`,
                detail: 'Click to switch to Quotation generator, view, and mark handled.',
                subtab: 'quotation',
                severity: 'warning'
              });
            }
          });
        }
      }
    } catch (e) {}

    // 3. Course Outline Tags
    try {
      const saved = localStorage.getItem('next_course_outlines_lzk.joel@gmail.com');
      if (saved) {
        const outlines = JSON.parse(saved);
        if (Array.isArray(outlines)) {
          outlines.forEach((o: any) => {
            if (o.taggedRepId === rep.id && !o.isCompleted) {
              list.push({
                id: `course_outline_${o.id}`,
                type: 'course_outline',
                icon: '📚',
                title: 'Pending Course Outline Action',
                message: `Course outline "${o.title || 'Untitled'}" is tagged to you.`,
                detail: 'Click to switch to Course Outline tab, view details and mark handled.',
                subtab: 'course_outline',
                severity: 'warning'
              });
            }
          });
        }
      }
    } catch (e) {}

    // 4. Overdue Pipeline Deals (Owned by this representative)
    pipelines.forEach((p: any) => {
      if (p.ownerId === rep.id && isOverdue(p)) {
        list.push({
          id: `pipeline_overdue_${p.id}`,
          type: 'pipeline_overdue',
          icon: '🚨',
          title: 'Overdue Pipeline Deal',
          message: `Deal for client "${p.clientName}" is pending for over 2 days with no proposal sent!`,
          detail: 'Click to view Pipeline Management and update deal status.',
          subtab: 'pipeline',
          severity: 'danger'
        });
      }
    });

    // 5. Tagged Pipeline Deals (By another representative)
    pipelines.forEach((p: any) => {
      if (p.taggedRepIds?.includes(rep.id) && !p.completedTags?.includes(rep.id)) {
        list.push({
          id: `pipeline_tagged_${p.id}`,
          type: 'pipeline_tagged',
          icon: '⚠️',
          title: 'Collaboration Tag on Pipeline',
          message: `You are tagged on pipeline deal "${p.clientName}" owned by ${p.ownerName || 'another rep'}.`,
          detail: 'Click to view Pipeline Management and complete tagged checklist.',
          subtab: 'pipeline',
          severity: 'info'
        });
      }
    });

    // 6. Unattended Tasks
    tasks.forEach((t: any) => {
      if (t.status !== 'Done') {
        list.push({
          id: `task_${t.id}`,
          type: 'task',
          icon: '📝',
          title: 'Uncompleted Task',
          message: `Task: "${t.title}" is pending. Priority: ${t.priority || 'Medium'}`,
          detail: 'Click to switch to Pending Tasks and mark it done.',
          subtab: 'tasks',
          severity: 'neutral'
        });
      }
    });

    return list;
  })();

  const handleAlertClick = (alert: any) => {
    if (alert.subtab === 'kpi') {
      setSelectedWeek(alert.weekIdx);
      setActiveSubTab('kpi');
      if (alert.type === 'kpi_partner' || alert.type === 'kpi_tag') {
        setSelectedInboundTag({
          senderId: alert.senderId,
          senderName: alert.senderName,
          weekIdx: alert.weekIdx,
          type: alert.type === 'kpi_partner' ? 'partner' : 'general'
        });
        setTagResponseText('');
        setTagResponseStatus('Done');
      }
    } else {
      setActiveSubTab(alert.subtab);
    }
  };

  return (
    <div className="space-y-6">
      
      {/* SubHeader Section Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border border-slate-200 p-4 rounded-xl shadow-xs">
        <div className="flex items-center gap-3">
          <button 
            onClick={handleBack}
            className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-slate-800 transition-colors border border-slate-200"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          
          {/* Main Selected Title Pill (Matches Screenshot 2 top-left 'Xin Ying' or 'VENUE') */}
          <div className="px-5 py-2.5 bg-white border-2 border-slate-700/80 rounded-lg text-sm font-extrabold text-slate-800 uppercase tracking-widest min-w-[120px] text-center font-mono">
            {getSectionTitle()}
          </div>
          
          <div className="hidden md:flex flex-col">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-mono">
              Reps Operations Console
            </span>
            <span className="text-[11px] font-black text-blue-600 uppercase tracking-wider mt-0.5 font-sans">
              {rep.id === 'xin-ying' ? 'Super Manager' :
               rep.id === 'chee-cai' ? 'Unstoppable Lead Trainer & Sales' :
               rep.id === 'alif' ? 'Rising Sales' :
               rep.id === 'atiqa' ? 'Amazing Admin' : 'Representative'}
            </span>
          </div>
        </div>

        {/* Quick AI Action button */}
        <button 
          onClick={() => onAskCopilot(`Create a comprehensive performance summary and operational roadmap for sales rep ${rep.name} based on their current KPI score of ${overallScore}% and RM ${totalSales} closed sales.`)}
          className="flex items-center justify-center gap-1.5 px-4 py-2 bg-gradient-to-r from-blue-600 to-emerald-600 text-white font-extrabold text-xs rounded-lg hover:shadow-md hover:shadow-blue-500/10 transition-all cursor-pointer"
        >
          <Sparkles className="w-3.5 h-3.5" />
          Ask Co-Pilot About {rep.name}
        </button>
      </div>

      {/* Main Container Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* Left/Bottom Navigation Sidepanel matching screenshots 2 & 3 */}
        <div className="lg:col-span-3 flex flex-col gap-4">
          
          {/* Main Operations Links Menu */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2 shadow-xs">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-mono block pb-1.5 border-b border-slate-50">
              Operations Menu
            </span>
            
            <button 
              onClick={() => handleSubTabChange('kpi')}
              className={`w-full text-left p-3.5 rounded-lg text-xs font-black uppercase tracking-wider border transition-all ${
                hasPendingKpiAlerts
                  ? 'animate-flash-red'
                  : activeSubTab === 'kpi' 
                  ? 'bg-slate-100 border-slate-300 text-slate-800 font-extrabold shadow-2xs' 
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              📊 KPI {hasPendingKpiAlerts ? '⚠️' : ''}
            </button>

            <button 
              onClick={() => handleSubTabChange('pipeline')}
              className={`w-full text-left p-3.5 rounded-lg text-xs font-black uppercase tracking-wider border transition-all cursor-pointer ${
                pipelines.some(isOverdue)
                  ? 'bg-rose-50 border-rose-400 text-rose-700 font-extrabold shadow-xs animate-[pulse_1.5s_infinite] border-2'
                  : pipelines.some(p => p.taggedRepIds?.includes(rep.id) && !p.completedTags?.includes(rep.id))
                  ? 'animate-flash-red'
                  : activeSubTab === 'pipeline' 
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-700 font-extrabold shadow-2xs' 
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              📈 Pipeline Management {pipelines.some(isOverdue) ? '🚨 OVERDUE' : pipelines.some(p => p.taggedRepIds?.includes(rep.id) && !p.completedTags?.includes(rep.id)) ? '⚠️' : ''}
            </button>

            <button 
              onClick={() => handleSubTabChange('quotation')}
              className={`w-full text-left p-3.5 rounded-lg text-xs font-black uppercase tracking-wider border transition-all ${
                hasTaggedQuotations
                  ? 'animate-flash-red'
                  : activeSubTab === 'quotation' 
                  ? 'bg-slate-100 border-slate-300 text-slate-800 font-extrabold shadow-2xs' 
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              📄 Quotation {hasTaggedQuotations && '⚠️'}
            </button>

            <button 
              onClick={() => handleSubTabChange('course_outline')}
              className={`w-full text-left p-3.5 rounded-lg text-xs font-black uppercase tracking-wider border transition-all ${
                hasTaggedCourseOutlines
                  ? 'animate-flash-red'
                  : activeSubTab === 'course_outline' 
                  ? 'bg-slate-100 border-slate-300 text-slate-800 font-extrabold shadow-2xs' 
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              📚 Course Outline {hasTaggedCourseOutlines && '⚠️'}
            </button>
            
            <button 
              onClick={() => handleSubTabChange('client')}
              className={`w-full text-left p-3.5 rounded-lg text-xs font-black uppercase tracking-wider border transition-all ${
                activeSubTab === 'client' 
                  ? 'bg-slate-100 border-slate-300 text-slate-800 font-extrabold shadow-2xs' 
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              👥 Client List
            </button>
            
            <button 
              onClick={() => handleSubTabChange('trainerList')}
              className={`w-full text-left p-3.5 rounded-lg text-xs font-black uppercase tracking-wider border transition-all ${
                activeSubTab === 'trainerList' 
                  ? 'bg-slate-100 border-slate-300 text-slate-800 font-extrabold shadow-2xs' 
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              🎓 Trainer List
            </button>
            
            <button 
              onClick={() => handleSubTabChange('venue')}
              className={`w-full text-left p-3.5 rounded-lg text-xs font-black uppercase tracking-wider border transition-all ${
                activeSubTab === 'venue' 
                  ? 'bg-slate-100 border-slate-300 text-slate-800 font-extrabold shadow-2xs' 
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              📍 Venue List
            </button>

            {(rep.id === 'xin-ying' || rep.id === 'atiqa') && (
              <>
                <button 
                  onClick={() => handleSubTabChange('payment')}
                  className={`w-full text-left p-3.5 rounded-lg text-xs font-black uppercase tracking-wider border transition-all cursor-pointer ${
                    activeSubTab === 'payment' 
                      ? 'bg-orange-50 border-orange-300 text-orange-700 font-extrabold shadow-2xs' 
                      : 'bg-white border-slate-200 text-orange-600 hover:bg-orange-50 hover:border-orange-200 font-extrabold'
                  }`}
                >
                  💸 Raise Payment
                </button>

                <button 
                  onClick={() => handleSubTabChange('admin_record')}
                  className={`w-full text-left p-3.5 rounded-lg text-xs font-black uppercase tracking-wider border transition-all cursor-pointer ${
                    activeSubTab === 'admin_record' 
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-700 font-extrabold shadow-2xs' 
                      : 'bg-white border-slate-200 text-emerald-600 hover:bg-emerald-50 hover:border-emerald-200 font-extrabold'
                  }`}
                >
                  📁 Admin Records
                </button>
              </>
            )}
          </div>

          {/* Bottom Actions Menu Card */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2 shadow-xs">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-mono block pb-1.5 border-b border-slate-50">
              Financial & Agenda
            </span>
            
            <button 
              onClick={() => handleSubTabChange('tasks')}
              className={`w-full text-center p-4 rounded-lg text-xs font-black uppercase tracking-wider border transition-all ${
                tasks.some(t => t.status !== 'Done')
                  ? 'animate-flash-red text-white'
                  : activeSubTab === 'tasks' 
                  ? 'bg-slate-100 border-slate-300 text-slate-800 font-extrabold' 
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              Pending Tasks {tasks.some(t => t.status !== 'Done') && '⚠️'}
            </button>
            
            <button 
              onClick={() => handleSubTabChange('pl')}
              className={`w-full text-center p-4 rounded-lg text-xs font-black uppercase tracking-wider border transition-all ${
                activeSubTab === 'pl' 
                  ? 'bg-slate-100 border-slate-300 text-slate-800 font-extrabold' 
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              P&L
            </button>
          </div>

        </div>

        {/* Right Side: Active Workspace Section */}
        <div className="lg:col-span-9 space-y-5">
          
          {/* Alerts & Collaboration Center */}
          {activeAlerts.length > 0 && (
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-200">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-rose-50 text-rose-600 rounded-lg animate-pulse">
                    <span className="text-sm font-bold">🔔</span>
                  </div>
                  <div>
                    <h4 className="text-xs font-black uppercase tracking-wider text-slate-800">
                      System Collaboration & Alert Hub
                    </h4>
                    <p className="text-[10px] text-slate-400 font-semibold">
                      You have {activeAlerts.length} pending tag{activeAlerts.length > 1 ? 's' : ''} or action item{activeAlerts.length > 1 ? 's' : ''} across all workspaces
                    </p>
                  </div>
                </div>
                <span className="text-[9px] bg-blue-50 text-blue-700 font-extrabold px-2.5 py-1 rounded-full uppercase tracking-wider animate-pulse">
                  Click any card to link & respond
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[220px] overflow-y-auto pr-1">
                {activeAlerts.map(alert => (
                  <div
                    key={alert.id}
                    onClick={() => handleAlertClick(alert)}
                    className="group bg-white hover:bg-slate-50 border border-slate-200 hover:border-blue-300 rounded-xl p-3 flex items-start gap-3 cursor-pointer shadow-3xs transition-all duration-200 hover:shadow-xs"
                  >
                    <span className="text-lg shrink-0">{alert.icon}</span>
                    <div className="space-y-0.5 flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <h5 className="text-[10.5px] font-black uppercase tracking-wider text-slate-800 group-hover:text-blue-600 transition-colors truncate">
                          {alert.title}
                        </h5>
                        {alert.severity === 'danger' && (
                          <span className="text-[8px] bg-rose-50 text-rose-700 border border-rose-200 px-1.5 py-0.5 rounded font-mono font-black uppercase tracking-wider animate-pulse">
                            Critical
                          </span>
                        )}
                        {alert.severity === 'warning' && (
                          <span className="text-[8px] bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded font-mono font-black uppercase tracking-wider">
                            Pending
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-600 font-medium leading-relaxed line-clamp-2">
                        {alert.message}
                      </p>
                      <span className="text-[9px] text-slate-400 font-black uppercase tracking-wider flex items-center gap-1 mt-1 group-hover:text-blue-500 transition-colors">
                        🔗 {alert.detail}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeSubTab === 'quotation' ? (
            <QuotationGenerator key={rep.id} rep={rep} reps={reps} requestManagerPermission={requestManagerPermission} />
          ) : activeSubTab === 'course_outline' ? (
            <CourseOutlineGenerator key={rep.id} rep={rep} reps={reps} requestManagerPermission={requestManagerPermission} />
          ) : activeSubTab === 'admin_record' ? (
            <AdminRecordManager key={rep.id} rep={rep} reps={reps} requestManagerPermission={requestManagerPermission} />
          ) : activeSubTab === 'kpi' ? (
            /* KPI SCREEN (WEEKLY BREAKDOWN TABLE) */
            <div className="space-y-6">
              
              {/* KPI Collaboration Alerts */}
              {reps.filter(r => r.id !== rep.id).flatMap(r => {
                const alerts: any[] = [];
                [0, 1, 2, 3, 4].forEach(wkIdx => {
                  const isPartner = r.kpi?.accountabilityPartnerIdList?.[wkIdx] === rep.id;
                  const isPartnerDone = r.kpi?.completedAccountabilityList?.[wkIdx] || false;
                  if (isPartner && !isPartnerDone) {
                    alerts.push({
                      id: `${r.id}_partner_${wkIdx}`,
                      senderId: r.id,
                      senderName: r.name,
                      weekIdx: wkIdx,
                      type: 'partner'
                    });
                  }

                  const taggedIds = r.kpi?.taggedRepIdsList?.[wkIdx] || (wkIdx === 0 && r.kpi?.taggedRepIds ? r.kpi.taggedRepIds : []);
                  const completedList = r.kpi?.completedTagsList?.[wkIdx] || [];
                  const isTagged = taggedIds.includes(rep.id);
                  const isTaggedDone = completedList.includes(rep.id);
                  if (isTagged && !isTaggedDone) {
                    alerts.push({
                      id: `${r.id}_tagged_${wkIdx}`,
                      senderId: r.id,
                      senderName: r.name,
                      weekIdx: wkIdx,
                      type: 'general',
                      tagNote: r.kpi?.tagNoteList?.[wkIdx] || (wkIdx === 0 && r.kpi?.tagNote ? r.kpi.tagNote : '')
                    });
                  }
                });
                return alerts;
              }).map(alert => (
                <div key={alert.id} className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-900 flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-2xs">
                  <div 
                    className="flex items-start gap-3 cursor-pointer flex-1 group"
                    onClick={() => {
                      setSelectedInboundTag({
                        senderId: alert.senderId,
                        senderName: alert.senderName,
                        weekIdx: alert.weekIdx,
                        type: alert.type
                      });
                      setTagResponseText('');
                      setTagResponseStatus('Done');
                    }}
                  >
                    <span className="text-xl font-mono shrink-0">🤝</span>
                    <div>
                      <h4 className="font-extrabold text-xs uppercase tracking-wider text-amber-950 flex items-center gap-1.5 font-display group-hover:underline decoration-amber-600">
                        {alert.type === 'partner' ? 'Accountability Partner Tag' : 'KPI Collaboration Tag'} from {alert.senderName} (Week {alert.weekIdx + 1})
                      </h4>
                      <p className="text-[11px] text-amber-800 font-semibold mt-0.5 leading-relaxed">
                        {alert.type === 'partner' 
                          ? `${alert.senderName} has designated you as their Core Accountability Partner for Week ${alert.weekIdx + 1}. Click to read details and respond.`
                          : `${alert.senderName} tagged you: "${alert.tagNote || 'Please review my KPI progress for this week.'}" - Click to read and respond.`
                        }
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedInboundTag({
                        senderId: alert.senderId,
                        senderName: alert.senderName,
                        weekIdx: alert.weekIdx,
                        type: alert.type
                      });
                      setTagResponseText('');
                      setTagResponseStatus('Done');
                    }}
                    className="self-end md:self-center bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-black uppercase tracking-wider px-3.5 py-1.5 rounded-lg shadow-sm transition-all cursor-pointer whitespace-nowrap font-sans flex items-center gap-1"
                  >
                    <MessageSquare className="w-3 h-3" />
                    Read & Respond
                  </button>
                </div>
              ))}
              
              {/* Main table card wrapper */}
              <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
                
                {/* Table Header Section */}
                <div className="p-4 bg-[#2563EB] text-white flex items-center justify-between">
                  <h4 className="text-xs font-black uppercase tracking-wider font-display">
                    1 - WEEKLY BREAKDOWN
                  </h4>
                  
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 bg-blue-700 font-bold px-2.5 py-1 rounded border border-blue-500 text-[10px] text-white">
                      <Calendar className="w-3.5 h-3.5 text-blue-200" />
                      <span className="uppercase tracking-wider mr-1">MONTH:</span>
                      <select
                        value={selectedMonth}
                        onChange={(e) => onMonthChange(e.target.value)}
                        className="bg-blue-800 text-white font-mono font-bold border-0 focus:ring-0 focus:outline-none cursor-pointer rounded px-1.5 py-0.5 text-[10px]"
                      >
                        {['JAN-26', 'FEB-26', 'MAR-26', 'APR-26', 'MAY-26', 'JUN-26', 'JUL-26', 'AUG-26', 'SEP-26', 'OCT-26', 'NOV-26', 'DEC-26', 'JAN-27', 'FEB-27', 'MAR-27', 'APR-27', 'MAY-27', 'JUN-27'].map(m => (
                          <option key={m} value={m} className="bg-slate-800 text-white font-mono text-xs">{m}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Main responsive table container */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-wider border-b border-slate-200">
                        <th className="p-4">Metric</th>
                        <th className="p-4 text-center">Wk 1</th>
                        <th className="p-4 text-center">Wk 2</th>
                        <th className="p-4 text-center">Wk 3</th>
                        <th className="p-4 text-center">Wk 4</th>
                        <th className="p-4 text-center">Wk 5</th>
                        <th className="p-4 text-center">Monthly Total</th>
                        <th className="p-4 text-center">Target</th>
                        <th className="p-4 text-center">Score</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-150 text-slate-700 font-sans text-xs">
                      {/* Metric rows */}
                      {getRepMetrics(rep).map((metric) => {
                        const kpiKey = metric.key as keyof Representative['kpi'];
                        const rowVals = isEditingKpi ? (editKpi[kpiKey] || [0,0,0,0,0]) : (rep.kpi[kpiKey] || [0,0,0,0,0]);
                        const isSales = metric.isRM;
                        const extraFromPipeline = isSales 
                          ? totalSalesFromPipeline 
                          : (rep.id === 'atiqa' ? 0 : [0, 1, 2, 3, 4].reduce((sum, wk) => sum + getPipelineMetricForWeek(metric.key, wk), 0));
                        const total = sumArray(rowVals) + extraFromPipeline;
                        
                        const totalTarget = metric.targetVal;
                        const scorePct = Math.min(100, Math.round((total / totalTarget) * 100)) || 0;
                        const scoreStyle = getScoreStyle(scorePct);

                        return (
                          <tr key={metric.key} className="hover:bg-slate-50/50 transition-colors">
                            <td className="p-4 font-black text-slate-800">{metric.label}</td>
                            
                            {/* Wk1 to Wk5 cells */}
                            {[0, 1, 2, 3, 4].map((wk) => {
                              const wkExtra = isSales 
                                ? getPipelineSalesForWeek(wk) 
                                : (rep.id !== 'atiqa' ? getPipelineMetricForWeek(metric.key, wk) : 0);
                              const val = (rowVals[wk] || 0) + wkExtra;
                              return (
                                <td key={wk} className="p-4 text-center">
                                  {isEditingKpi ? (
                                    <input 
                                      type="number" 
                                      value={rowVals[wk] || ''}
                                      onChange={(e) => handleCellChange(kpiKey, wk, e.target.value)}
                                      className="w-16 text-center border border-slate-200 rounded p-1 text-xs text-slate-800 focus:ring-1 focus:ring-blue-500"
                                      min={rep.id === 'atiqa' && kpiKey === 'salesFigure' ? 0 : undefined}
                                      max={rep.id === 'atiqa' && kpiKey === 'salesFigure' ? 5 : undefined}
                                    />
                                  ) : (
                                    <span className={val === 0 ? 'text-slate-300 font-semibold' : 'font-semibold font-mono text-slate-700'}>
                                      {val === 0 ? '-' : metric.isRM ? `RM ${val.toLocaleString()}` : val}
                                    </span>
                                  )}
                                </td>
                              );
                            })}

                            {/* Monthly Total */}
                            <td className="p-4 text-center font-black text-slate-800 font-mono">
                              {metric.isRM ? `RM ${total.toLocaleString()}` : total}
                            </td>

                            {/* Target */}
                            <td className="p-4 text-center text-slate-500 font-semibold font-mono">
                              {metric.isRM ? `RM ${totalTarget.toLocaleString()}` : totalTarget} <span className="text-[9px] uppercase text-slate-400 block font-sans">{metric.targetLabel}</span>
                            </td>

                            {/* Score */}
                            <td className="p-4 text-center">
                              <span className={`px-2.5 py-0.5 rounded-lg text-[10px] font-black font-mono border ${scoreStyle}`}>
                                {scorePct}%
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Edit Controls Toolbar */}
                <div className="p-4 bg-slate-50 border-t border-slate-150 flex justify-between items-center">
                  <div className="text-[11px] text-slate-500 font-semibold italic flex items-center gap-1">
                    <Percent className="w-3.5 h-3.5 text-blue-500" />
                    Interactive Sales KPI Table. Click edit to adjust weekly indicators directly.
                  </div>
                  
                  <div className="flex gap-2">
                    {isEditingKpi ? (
                      <>
                        <button 
                          onClick={() => setIsEditingKpi(false)}
                          className="text-xs bg-white border border-slate-200 text-slate-600 font-bold px-3 py-1.5 rounded transition-colors"
                        >
                          Cancel
                        </button>
                        <button 
                          onClick={handleSaveKpiEdits}
                          className="text-xs bg-blue-600 hover:bg-blue-700 text-white font-black px-4 py-1.5 rounded shadow-sm transition-colors flex items-center gap-1"
                        >
                          <Save className="w-3.5 h-3.5" />
                          Save KPI Roster
                        </button>
                      </>
                    ) : (
                      <button 
                        onClick={() => setIsEditingKpi(true)}
                        className="text-xs bg-white border border-slate-300 text-slate-700 font-black px-4 py-1.5 rounded hover:bg-slate-50 transition-all flex items-center gap-1"
                      >
                        Edit Table Cells
                      </button>
                    )}
                  </div>
                </div>

                {/* Overall Score Progress Bar Footer Card (Exactly as requested!) */}
                <div className="p-5 bg-[#0F172A] text-white flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-display block">
                      OVERALL PERFORMANCE SCORE
                    </span>
                    <h5 className="text-sm font-black uppercase text-slate-100">
                      {rep.id === 'atiqa'
                        ? 'WEEKLY PIPELINE KPI METRICS INDEX (50% Rating · 40% Claims · 10% Venue)'
                        : 'WEEKLY PIPELINE KPI METRICS INDEX (60% Sales · 20% Proposals · 20% Preview)'}
                    </h5>
                  </div>

                  <div className="flex-1 md:max-w-md w-full flex items-center gap-3">
                    <div className="flex-1 h-3 bg-slate-800 rounded-full overflow-hidden border border-slate-700">
                      <div 
                        className="h-full bg-blue-500 rounded-full transition-all duration-700 shadow-lg shadow-blue-500/50"
                        style={{ width: `${overallScore}%` }}
                      />
                    </div>
                    <span className="text-lg font-black font-mono text-blue-400 w-12 text-right">
                      {overallScore}%
                    </span>
                  </div>
                </div>

              </div>

              {/* Weekly Progress & Accountability Check-In Card */}
              <div className="bg-white border border-slate-200 rounded-xl shadow-xs p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-blue-50 rounded-lg text-blue-650">
                      <Users className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-black uppercase tracking-wider font-display text-slate-800">
                        2 - WEEKLY PROGRESS & ACCOUNTABILITY CHECK-IN
                      </h4>
                      <p className="text-[10px] text-slate-400 font-medium">
                        Log progress, seek assistance, set deadlines, and assign a team accountability partner.
                      </p>
                    </div>
                  </div>
                  {isEditingKpi && (
                    <span className="text-[9px] bg-amber-50 text-amber-700 font-bold px-2 py-0.5 rounded border border-amber-200 uppercase tracking-wider">
                      Editing Mode Active
                    </span>
                  )}
                </div>

                {/* Week Selection for Accountability Check-In */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between bg-slate-50 p-2.5 border border-slate-150 rounded-xl gap-2">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 pl-1">
                    Select Active Accountability Week:
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {[0, 1, 2, 3, 4].map((wkIdx) => {
                      const weekHasAlert = reps.filter(r => r.id !== rep.id).some(r => {
                        const isPartner = r.kpi?.accountabilityPartnerIdList?.[wkIdx] === rep.id;
                        const isPartnerDone = r.kpi?.completedAccountabilityList?.[wkIdx] || false;
                        if (isPartner && !isPartnerDone) return true;

                        const taggedIds = r.kpi?.taggedRepIdsList?.[wkIdx] || (wkIdx === 0 && r.kpi?.taggedRepIds ? r.kpi.taggedRepIds : []);
                        const completedList = r.kpi?.completedTagsList?.[wkIdx] || [];
                        const isTagged = taggedIds.includes(rep.id);
                        const isTaggedDone = completedList.includes(rep.id);
                        return isTagged && !isTaggedDone;
                      });

                      return (
                        <button
                          key={wkIdx}
                          type="button"
                          onClick={() => setSelectedWeek(wkIdx)}
                          className={`px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wider rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                            selectedWeek === wkIdx
                              ? 'bg-blue-600 text-white shadow-sm font-black'
                              : weekHasAlert
                              ? 'text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 animate-[pulse_1.5s_infinite]'
                              : 'text-slate-600 bg-white hover:text-slate-900 hover:bg-slate-100 border border-slate-200'
                          }`}
                        >
                          Week {wkIdx + 1}
                          {weekHasAlert && (
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-600 inline-block shrink-0 animate-ping" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {isEditingKpi ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5 col-span-1 md:col-span-2">
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider">
                        Last week activity report
                      </label>
                      <textarea
                        value={getLastWeekProgress(editKpi, selectedWeek)}
                        onChange={(e) => updateKpiFieldList('lastWeekProgress', e.target.value)}
                        placeholder="Detail major progress made during the previous week..."
                        rows={3}
                        className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 bg-white"
                      />
                    </div>

                    <div className="space-y-1.5 col-span-1 md:col-span-2">
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider">
                        Help Needed / Blockers
                      </label>
                      <textarea
                        value={getHelpNeeded(editKpi, selectedWeek)}
                        onChange={(e) => updateKpiFieldList('helpNeeded', e.target.value)}
                        placeholder="Describe any blockers or help needed from other team members..."
                        rows={3}
                        className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 bg-white"
                      />
                    </div>

                    <div className="space-y-1.5 col-span-1 md:col-span-2">
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider">
                        Dateline / Deadline
                      </label>
                      <input
                        type="date"
                        value={getDateline(editKpi, selectedWeek)}
                        onChange={(e) => updateKpiFieldList('dateline', e.target.value)}
                        className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 bg-white font-mono"
                      />
                    </div>

                    {/* Tag representatives (Multi Tag) */}
                    <div className="space-y-1.5 col-span-1 md:col-span-2">
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider">
                        Tag other reps (Link to their dashboard)
                      </label>
                      <div className="grid grid-cols-2 gap-1.5 max-h-28 overflow-y-auto border border-slate-200 rounded-lg p-2.5 bg-slate-50">
                        {reps.filter(m => m.id !== rep.id).map(m => {
                          const currentTags = getTaggedRepIds(editKpi, selectedWeek);
                          const isChecked = currentTags.includes(m.id);
                          return (
                            <label key={m.id} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer hover:bg-white p-1 rounded transition-colors font-medium">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  const updatedTags = isChecked 
                                    ? currentTags.filter(id => id !== m.id)
                                    : [...currentTags, m.id];
                                  updateKpiFieldList('taggedRepIds', updatedTags);
                                }}
                                className="rounded text-blue-600 focus:ring-blue-500 w-3.5 h-3.5 border-slate-300"
                              />
                              <span>{m.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    {/* Tag Note / Comment Box */}
                    <div className="space-y-1.5 col-span-1 md:col-span-2">
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider">
                        Tag Note / Comment Box
                      </label>
                      <textarea
                        value={getTagNote(editKpi, selectedWeek)}
                        onChange={(e) => updateKpiFieldList('tagNote', e.target.value)}
                        placeholder="Add specific comments or request context for the tagged representatives..."
                        rows={2}
                        className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 bg-white"
                      />
                    </div>

                    {/* Accountability Partner */}
                    <div className="space-y-1.5 col-span-1 md:col-span-2">
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider">
                        Core Accountability Partner
                      </label>
                      <select
                        value={getAccountabilityPartnerId(editKpi, selectedWeek)}
                        onChange={(e) => updateKpiFieldList('accountabilityPartnerId', e.target.value)}
                        className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 bg-white"
                      >
                        <option value="">-- Choose Accountability Partner --</option>
                        {reps.filter(m => m.id !== rep.id).map(m => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-slate-50/50 border border-slate-100 rounded-xl p-4 space-y-2 col-span-1 md:col-span-2">
                      <div className="flex items-center gap-1.5 text-[10px] font-black text-slate-400 uppercase tracking-wider">
                        <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                        Last week activity report (Week {selectedWeek + 1})
                      </div>
                      <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">
                        {getLastWeekProgress(rep.kpi, selectedWeek) || `No progress report submitted for Week ${selectedWeek + 1} yet. Click "Edit Table Cells" to update.`}
                      </p>
                    </div>

                    <div className="bg-slate-50/50 border border-slate-100 rounded-xl p-4 space-y-2 col-span-1 md:col-span-2">
                      <div className="flex items-center gap-1.5 text-[10px] font-black text-slate-400 uppercase tracking-wider">
                        <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                        Help Needed (Week {selectedWeek + 1})
                      </div>
                      <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">
                        {getHelpNeeded(rep.kpi, selectedWeek) || `No blockers reported for Week ${selectedWeek + 1} yet. Click "Edit Table Cells" to update.`}
                      </p>
                    </div>

                    <div className="bg-slate-50/50 border border-slate-100 rounded-xl p-4 flex flex-col justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1">
                          <Calendar className="w-3.5 h-3.5 text-blue-500" />
                          Dateline / Target Date
                        </div>
                        <span className="text-xs font-mono font-bold text-slate-800">
                          {getDateline(rep.kpi, selectedWeek) ? new Date(getDateline(rep.kpi, selectedWeek)).toLocaleDateString('en-MY', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : 'No target date set'}
                        </span>
                      </div>
                    </div>

                    <div className="bg-slate-50/50 border border-slate-100 rounded-xl p-4 flex flex-col justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1">
                          <Users className="w-3.5 h-3.5 text-indigo-500" />
                          Accountability Partner
                        </div>
                        {getAccountabilityPartnerId(rep.kpi, selectedWeek) ? (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-[10px]">
                                {reps.find(m => m.id === getAccountabilityPartnerId(rep.kpi, selectedWeek))?.name.substring(0, 2).toUpperCase() || 'AP'}
                              </div>
                              <span className="text-xs font-extrabold text-slate-800">
                                {reps.find(m => m.id === getAccountabilityPartnerId(rep.kpi, selectedWeek))?.name || 'Unknown Partner'}
                              </span>
                            </div>
                            <div className="text-[10px] font-bold">
                              Status: {rep.kpi.completedAccountabilityList?.[selectedWeek] ? (
                                <span className="text-emerald-600 font-extrabold flex items-center gap-0.5 mt-0.5">✓ Marked Done</span>
                              ) : (
                                <span className="text-amber-600 font-bold flex items-center gap-0.5 mt-0.5">⏳ Pending counterpart done</span>
                              )}
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-500 font-medium italic">No accountability partner selected</span>
                        )}
                      </div>
                    </div>

                    {/* Multi-tagged reps & notebox display */}
                    <div className="bg-slate-50/50 border border-slate-100 rounded-xl p-4 col-span-1 md:col-span-2 space-y-3.5">
                      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                        <div className="flex items-center gap-1.5 text-[10px] font-black text-slate-400 uppercase tracking-wider">
                          <Tag className="w-3.5 h-3.5 text-blue-650" />
                          Collaboration Tags & Comments (Week {selectedWeek + 1})
                        </div>
                      </div>
                      
                      {/* Section A: Who tagged you (Inbound Tags) */}
                      <div className="space-y-2">
                        <span className="text-[9px] font-black uppercase text-amber-600 tracking-wider block">
                          📥 Inbound Tags (Tagged You)
                        </span>
                        {inboundKpiTags.length > 0 || inboundPartnerTags.length > 0 ? (
                          <div className="space-y-2.5">
                            {/* General Tags */}
                            {inboundKpiTags.map((tag, idx) => {
                              const senderRep = reps.find(r => r.id === tag.senderId);
                              const comments = senderRep ? getCollaborationComments(senderRep.kpi, selectedWeek) : [];
                              return (
                                <div 
                                  key={`in_general_${idx}`} 
                                  onClick={() => {
                                    setSelectedInboundTag({
                                      senderId: tag.senderId,
                                      senderName: tag.senderName,
                                      weekIdx: selectedWeek,
                                      type: 'general'
                                    });
                                    setTagResponseText('');
                                    setTagResponseStatus(tag.isDone ? 'Done' : 'Pending');
                                  }}
                                  className="bg-white border border-slate-150 hover:border-amber-400 rounded-lg p-2.5 shadow-3xs space-y-2 cursor-pointer transition-all hover:shadow-2xs group"
                                >
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-black text-slate-800 group-hover:text-amber-700 flex items-center gap-1.5">
                                      👤 {tag.senderName} <span className="text-[8px] text-slate-400 font-normal group-hover:underline">(Click to read & respond)</span>
                                    </span>
                                    <span className={`text-[8px] font-black px-1.5 py-0.5 rounded uppercase font-mono ${
                                      tag.isDone ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700 animate-pulse'
                                    }`}>
                                      {tag.isDone ? '✓ Handled' : '⏳ Action Pending'}
                                    </span>
                                  </div>
                                  <p className="text-xs text-slate-600 italic bg-slate-50/50 p-2 rounded border border-slate-100 group-hover:bg-slate-50">
                                    "{tag.tagNote || 'Please review my KPI progress for this week.'}"
                                  </p>

                                  {/* Conversations list inline */}
                                  {comments.length > 0 && (
                                    <div className="space-y-1.5 border-t border-slate-100 pt-2">
                                      <span className="text-[8px] font-black uppercase text-slate-400 tracking-wider block">
                                        💬 Conversation ({comments.length})
                                      </span>
                                      <div className="space-y-1">
                                        {comments.map((comm, cIdx) => (
                                          <div key={cIdx} className="text-[11px] text-slate-700 bg-slate-50/50 p-1.5 rounded border border-slate-100 flex items-start gap-1.5">
                                            <span className="font-bold text-slate-900 shrink-0">{comm.authorName}:</span>
                                            <span className="flex-1 italic">"{comm.text}"</span>
                                            <span className={`text-[8px] font-bold px-1 rounded uppercase shrink-0 font-mono ${
                                              comm.status === 'Done' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                                            }`}>
                                              {comm.status}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}

                            {/* Accountability Partner Tags */}
                            {inboundPartnerTags.map((tag, idx) => {
                              const senderRep = reps.find(r => r.id === tag.senderId);
                              const comments = senderRep ? getCollaborationComments(senderRep.kpi, selectedWeek) : [];
                              return (
                                <div 
                                  key={`in_partner_${idx}`} 
                                  onClick={() => {
                                    setSelectedInboundTag({
                                      senderId: tag.senderId,
                                      senderName: tag.senderName,
                                      weekIdx: selectedWeek,
                                      type: 'partner'
                                    });
                                    setTagResponseText('');
                                    setTagResponseStatus(tag.isDone ? 'Done' : 'Pending');
                                  }}
                                  className="bg-white border border-slate-150 hover:border-purple-400 rounded-lg p-2.5 shadow-3xs space-y-2 cursor-pointer transition-all hover:shadow-2xs group"
                                >
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-black text-slate-800 group-hover:text-purple-700 flex items-center gap-1.5">
                                      🤝 {tag.senderName} <span className="text-[8px] text-slate-400 font-normal group-hover:underline">(Partner Tag - Click to read & respond)</span>
                                    </span>
                                    <span className={`text-[8px] font-black px-1.5 py-0.5 rounded uppercase font-mono ${
                                      tag.isDone ? 'bg-emerald-100 text-emerald-700' : 'bg-purple-100 text-purple-700 animate-pulse'
                                    }`}>
                                      {tag.isDone ? '✓ Handled' : '⏳ Action Pending'}
                                    </span>
                                  </div>
                                  <p className="text-xs text-slate-600 italic bg-slate-50/50 p-2 rounded border border-slate-100 group-hover:bg-slate-50">
                                    "You are designated as {tag.senderName}'s Core Accountability Partner for Week {selectedWeek + 1}."
                                  </p>

                                  {/* Conversations list inline */}
                                  {comments.length > 0 && (
                                    <div className="space-y-1.5 border-t border-slate-100 pt-2">
                                      <span className="text-[8px] font-black uppercase text-slate-400 tracking-wider block">
                                        💬 Conversation ({comments.length})
                                      </span>
                                      <div className="space-y-1">
                                        {comments.map((comm, cIdx) => (
                                          <div key={cIdx} className="text-[11px] text-slate-700 bg-slate-50/50 p-1.5 rounded border border-slate-100 flex items-start gap-1.5">
                                            <span className="font-bold text-slate-900 shrink-0">{comm.authorName}:</span>
                                            <span className="flex-1 italic">"{comm.text}"</span>
                                            <span className={`text-[8px] font-bold px-1 rounded uppercase shrink-0 font-mono ${
                                              comm.status === 'Done' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                                            }`}>
                                              {comm.status}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400 italic block pl-1">No pending inbound tags for this week.</span>
                        )}
                      </div>

                      {/* Section B: Who you tagged (Outbound Tags) */}
                      <div className="space-y-2 pt-1.5 border-t border-slate-100">
                        <span className="text-[9px] font-black uppercase text-blue-600 tracking-wider block mt-1">
                          📤 Outbound Tags (You Tagged)
                        </span>
                        {getTaggedRepIds(rep.kpi, selectedWeek) && getTaggedRepIds(rep.kpi, selectedWeek).length > 0 ? (
                          <div className="space-y-2">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {getTaggedRepIds(rep.kpi, selectedWeek).map(id => {
                                const name = reps.find(r => r.id === id)?.name || id;
                                const completedList = rep.kpi.completedTagsList?.[selectedWeek] || [];
                                const isDone = completedList.includes(id);
                                return (
                                  <span key={id} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[10px] font-bold ${
                                    isDone 
                                      ? 'bg-emerald-50 text-emerald-700 border-emerald-100' 
                                      : 'bg-blue-50 text-blue-700 border-blue-100'
                                  }`}>
                                    @{name} {isDone ? '✓ Done' : '⏳ Pending'}
                                  </span>
                                );
                              })}
                            </div>
                            {getTagNote(rep.kpi, selectedWeek) && (
                              <div className="bg-white border border-slate-100 rounded-lg p-2.5 text-xs text-slate-600 italic">
                                "{getTagNote(rep.kpi, selectedWeek)}"
                              </div>
                            )}

                            {/* Outbound tag comments */}
                            {getCollaborationComments(rep.kpi, selectedWeek).length > 0 && (
                              <div className="mt-2.5 space-y-1.5 border-t border-slate-100 pt-2">
                                <span className="text-[8px] font-extrabold uppercase text-slate-400 tracking-wider block">
                                  💬 Collaboration Responses ({getCollaborationComments(rep.kpi, selectedWeek).length}):
                                </span>
                                <div className="space-y-1">
                                  {getCollaborationComments(rep.kpi, selectedWeek).map((comm, cIdx) => (
                                    <div key={cIdx} className="text-[11px] text-slate-700 bg-white p-1.5 rounded border border-slate-100 shadow-3xs flex items-start gap-1.5">
                                      <span className="font-bold text-slate-900 shrink-0">{comm.authorName}:</span>
                                      <span className="flex-1 italic">"{comm.text}"</span>
                                      <span className={`text-[8px] font-bold px-1.5 rounded uppercase shrink-0 font-mono ${
                                        comm.status === 'Done' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                                      }`}>
                                        {comm.status}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400 italic block pl-1">You haven't tagged anyone in your report this week.</span>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Ratios and performance contribution panels */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {getRepMetrics(rep).map((metric) => {
                  const score = getMetricScore(metric.key);
                  let totalAchieved = 0;
                  if (metric.isRM) {
                    totalAchieved = totalSales;
                  } else if (metric.key === 'proposals') {
                    totalAchieved = totalProposals;
                  } else if (metric.key === 'preview') {
                    totalAchieved = totalPreview;
                  } else if (metric.key === 'extraMetric') {
                    totalAchieved = (rep.kpi.extraMetric || []).reduce((a, b) => a + b, 0);
                  }

                  const targetStr = metric.isRM 
                    ? `RM ${metric.targetVal.toLocaleString()}` 
                    : `${metric.targetVal} ${metric.targetLabel.split('/')[0].trim()}`;

                  return (
                    <div key={metric.key} className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-3">
                      <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                        <span className="text-xs font-black text-slate-800 uppercase tracking-wider font-display">
                          Weekly {metric.label} Flow
                        </span>
                        <span className="text-[10px] bg-blue-50 text-blue-700 font-bold px-2 py-0.5 rounded font-mono">
                          Target: {targetStr}
                        </span>
                      </div>

                      <div className="grid grid-cols-5 text-center gap-1">
                        {[0, 1, 2, 3, 4].map((wk) => {
                          let val = 0;
                          if (metric.isRM) {
                            val = rep.kpi.salesFigure[wk] + (rep.id !== 'atiqa' ? getPipelineSalesForWeek(wk) : 0);
                          } else {
                            const kpiArray = (rep.kpi[metric.key as keyof Representative['kpi']] || []) as number[];
                            val = (kpiArray[wk] || 0) + (rep.id !== 'atiqa' ? getPipelineMetricForWeek(metric.key, wk) : 0);
                          }

                          return (
                            <div key={wk} className="space-y-1">
                              <p className="text-[9px] font-black text-slate-400 uppercase">Wk {wk+1}</p>
                              <p className="text-xs font-black font-mono text-slate-700">
                                {val === 0 ? '-' : metric.isRM ? `RM ${val.toLocaleString()}` : val}
                              </p>
                            </div>
                          );
                        })}
                      </div>

                      <div className="bg-slate-50 p-3 rounded-lg flex items-center justify-between text-xs font-black border border-slate-100 mt-2">
                        <span className="text-slate-500 uppercase tracking-wider">
                          TOTAL MONTHLY {metric.label.toUpperCase()}:
                        </span>
                        <span className="text-blue-600 font-mono text-sm">
                          {metric.isRM ? `RM ${totalAchieved.toLocaleString()}` : totalAchieved} / {metric.isRM ? `RM ${metric.targetVal.toLocaleString()}` : metric.targetVal} ({score}%)
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

            </div>
          ) : activeSubTab === 'payment' ? (
            /* RAISE PAYMENT SCREEN */
            <div className="space-y-6">
              
              {/* Main card wrapper */}
              <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
                
                {/* Table Header Section */}
                <div className="p-4 bg-[#EA580C] text-white flex items-center justify-between">
                  <h4 className="text-xs font-black uppercase tracking-wider font-display flex items-center gap-1.5 text-white">
                    <DollarSign className="w-4 h-4 text-white" />
                    RAISE PAYMENT VOUCHER - {rep.name.toUpperCase()}
                  </h4>
                  
                  <span className="text-[10px] bg-[#C2410C] font-bold px-3 py-1.5 rounded border border-[#9A3412] flex items-center gap-1 font-mono">
                    <Clock className="w-3.5 h-3.5" />
                    STATUS: ACTIVE ENGINE
                  </span>
                </div>

                <div className="p-6">
                  <form onSubmit={handleRaisePaymentSubmit} className="space-y-6">
                    
                    {/* Section 1: Info */}
                    <div>
                      <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 pb-1 border-b border-slate-100">
                        Section 1: Assignment Info
                      </h5>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-[10px] font-black text-slate-500 uppercase mb-1.5">
                            Date Request
                          </label>
                          <input
                            type="date"
                            required
                            value={payDateRequest}
                            onChange={(e) => setPayDateRequest(e.target.value)}
                            className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-[#EA580C] bg-white font-mono"
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] font-black text-slate-500 uppercase mb-1.5">
                            Training Date
                          </label>
                          <input
                            type="date"
                            required
                            value={payTrainingDate}
                            onChange={(e) => setPayTrainingDate(e.target.value)}
                            className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-[#EA580C] bg-white font-mono"
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] font-black text-slate-500 uppercase mb-1.5">
                            Training Client
                          </label>
                          <input
                            type="text"
                            required
                            placeholder="e.g. Shopee Malaysia"
                            value={payTrainingClient}
                            onChange={(e) => setPayTrainingClient(e.target.value)}
                            className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-[#EA580C] bg-white"
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] font-black text-slate-500 uppercase mb-1.5">
                            Venue
                          </label>
                          <input
                            type="text"
                            required
                            placeholder="e.g. Kuala Lumpur Headquarters"
                            value={payVenue}
                            onChange={(e) => setPayVenue(e.target.value)}
                            className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-[#EA580C] bg-white"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Section 2: Multiple Items & Financial Details */}
                    <div>
                      <div className="flex items-center justify-between mb-3 pb-1 border-b border-slate-100">
                        <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                          Section 2: Items & Financial Details
                        </h5>
                        <button
                          type="button"
                          onClick={() => {
                            setPayItems([
                              ...payItems,
                              { id: `item_${Date.now()}_${Math.random()}`, itemQty: '', amount: '' }
                            ]);
                          }}
                          className="text-[10px] bg-orange-50 hover:bg-orange-100 text-[#EA580C] font-black px-3 py-1.5 rounded-lg transition-all flex items-center gap-1 cursor-pointer border border-orange-200"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Add Item Row
                        </button>
                      </div>

                      <div className="space-y-3">
                        {payItems.map((item, index) => (
                          <div key={item.id} className="flex flex-col md:flex-row gap-4 items-end bg-slate-50 p-3.5 rounded-lg border border-slate-100 relative group">
                            <div className="flex-1 min-w-0 w-full">
                              <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">
                                Item Name & Qty (Item #{index + 1})
                              </label>
                              <input
                                type="text"
                                required
                                placeholder="e.g. Lead Trainer Allowance x 2 Days"
                                value={item.itemQty}
                                onChange={(e) => {
                                  const updated = [...payItems];
                                  updated[index].itemQty = e.target.value;
                                  setPayItems(updated);
                                }}
                                className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-[#EA580C] bg-white"
                              />
                            </div>

                            <div className="w-full md:w-48">
                              <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">
                                Amount (RM)
                              </label>
                              <div className="relative">
                                <span className="absolute left-3 top-2.5 text-slate-400 text-xs font-black font-mono">RM</span>
                                <input
                                  type="number"
                                  required
                                  placeholder="e.g. 1500"
                                  value={item.amount}
                                  onChange={(e) => {
                                    const updated = [...payItems];
                                    updated[index].amount = e.target.value;
                                    setPayItems(updated);
                                  }}
                                  className="w-full text-xs border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-slate-800 focus:outline-none focus:border-[#EA580C] bg-white font-mono"
                                />
                              </div>
                            </div>

                            {payItems.length > 1 && (
                              <button
                                type="button"
                                onClick={() => {
                                  setPayItems(payItems.filter(p => p.id !== item.id));
                                }}
                                className="text-rose-500 hover:text-rose-700 hover:bg-rose-50 p-2 rounded-lg transition-colors cursor-pointer border border-transparent hover:border-rose-200 mb-0.5"
                                title="Remove item"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>

                      {/* Display Total Summary inside section */}
                      <div className="mt-3 flex justify-end text-xs font-black text-slate-700 uppercase tracking-wide px-1.5">
                        <span>Total Voucher Amount: <span className="text-sm text-slate-900 font-mono font-black ml-1">RM {payItems.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></span>
                      </div>
                    </div>

                    {/* Submission Action Button */}
                    <div className="pt-3 border-t border-slate-100 flex justify-end">
                      <button
                        type="submit"
                        className="bg-[#EA580C] hover:bg-[#C2410C] text-white font-black text-xs uppercase tracking-wider px-6 py-2.5 rounded-xl transition-all shadow-md flex items-center gap-1.5 cursor-pointer"
                      >
                        <Plus className="w-4 h-4" />
                        Raise Payment Voucher
                      </button>
                    </div>

                  </form>
                </div>

              </div>

              {/* Raised Payment Logs History Panel */}
              <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
                <div className="p-4 bg-slate-800 text-white flex items-center justify-between">
                  <h4 className="text-xs font-black uppercase tracking-wider font-display flex items-center gap-1.5 text-white">
                    <FileText className="w-4 h-4 text-slate-300" />
                    PAST RAISED PAYMENT VOUCHERS ({payments.filter(p => rep.id === 'xin-ying' ? true : p.repId === rep.id).length})
                  </h4>
                  <span className="text-[10px] bg-slate-700 text-slate-300 font-bold px-2.5 py-1 rounded font-mono">
                    Realtime Log
                  </span>
                </div>

                {payments.filter(p => rep.id === 'xin-ying' ? true : p.repId === rep.id).length === 0 ? (
                  <div className="p-8 text-center text-slate-400 text-xs italic bg-slate-50/50">
                    No payment vouchers raised yet for {rep.name}. Fill in the form above to log assignments.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-[9px] font-black text-slate-400 uppercase tracking-widest">
                          <th className="p-4">Date Request</th>
                          <th className="p-4">Training Details</th>
                          <th className="p-4">Client & Venue</th>
                          <th className="p-4">Items Breakdown</th>
                          <th className="p-4 text-right">Total Amount</th>
                          <th className="p-4 text-center">Status</th>
                          <th className="p-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-700 font-sans text-xs">
                        {payments.filter(p => rep.id === 'xin-ying' ? true : p.repId === rep.id).map((p) => (
                          <tr key={p.id} className="hover:bg-slate-50/50 transition-colors">
                            <td className="p-4 font-mono font-bold text-slate-500">{p.dateRequest}</td>
                            <td className="p-4">
                              <span className="font-extrabold text-slate-800 block">Training Course</span>
                              <span className="text-[10px] text-slate-400 block font-mono">Date: {p.trainingDate}</span>
                            </td>
                            <td className="p-4">
                              <span className="font-bold text-slate-700 block">{p.trainingClient}</span>
                              <span className="text-[10px] text-slate-400 block">{p.venue}</span>
                            </td>
                            <td className="p-4">
                              {p.items && p.items.length > 0 ? (
                                <div className="space-y-1">
                                  {p.items.map((item: any, idx: number) => (
                                    <div key={item.id || idx} className="text-slate-600 font-semibold flex flex-col xl:flex-row xl:items-center xl:gap-2">
                                      <span>• {item.itemQty}</span>
                                      <span className="text-[10px] text-slate-400 font-mono font-medium">(RM {(parseFloat(item.amount) || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })})</span>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <span className="font-semibold text-slate-600">{p.itemQty}</span>
                              )}
                            </td>
                            <td className="p-4 text-right font-mono font-black text-slate-800">
                              RM {parseFloat(p.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </td>
                            <td className="p-4 text-center">
                              <div className="flex flex-col items-center gap-1">
                                {p.status === 'Pending Approval' ? (
                                  <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-amber-50 border border-amber-200 text-amber-700">
                                    Pending Approval
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-emerald-50 border border-emerald-200 text-emerald-700">
                                    Approved
                                  </span>
                                )}
                                
                                <span className="text-[9px] text-slate-400 font-medium">
                                  by: {p.repName || p.repId || 'Unknown'}
                                </span>

                                {rep.id === 'xin-ying' && p.status === 'Pending Approval' && (
                                  <button
                                    onClick={async () => {
                                      const updated = payments.map(item => {
                                        if (item.id === p.id) {
                                          return { ...item, status: 'Approved' };
                                        }
                                        return item;
                                      });
                                      setPayments(updated);
                                      localStorage.setItem('next_payments_shared', JSON.stringify(updated));
                                      try {
                                        if (db) {
                                          await setDoc(doc(db, 'payments', p.id), { ...p, status: 'Approved' });
                                        }
                                      } catch (err) {
                                        console.error("Firestore approve payment failed:", err);
                                      }
                                    }}
                                    className="mt-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded transition-all cursor-pointer flex items-center gap-0.5"
                                  >
                                    <Check className="w-3 h-3" /> Approve
                                  </button>
                                )}
                              </div>
                            </td>
                            <td className="p-4 text-right">
                              <button
                                type="button"
                                onClick={async () => {
                                  if (window.confirm("Are you sure you want to delete this payment voucher?")) {
                                    const updated = payments.filter(item => item.id !== p.id);
                                    setPayments(updated);
                                    localStorage.setItem('next_payments_shared', JSON.stringify(updated));
                                    try {
                                      if (db) {
                                        await deleteDoc(doc(db, 'payments', p.id));
                                      }
                                    } catch (err) {
                                      console.error("Firestore delete payment failed:", err);
                                    }
                                  }
                                }}
                                className="text-rose-500 hover:text-rose-700 p-1 rounded hover:bg-rose-50 transition-colors cursor-pointer"
                                title="Delete Voucher Log"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

            </div>
          ) : activeSubTab === 'pipeline' ? (
            /* PIPELINE MANAGEMENT ENGINE */
            <div className="space-y-6">
              {pipelineUndoMessage && (
                <div className="bg-slate-900 text-white rounded-xl p-3 px-4 flex items-center justify-between text-xs shadow-md animate-fade-in border border-slate-800">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                    <span>{pipelineUndoMessage}</span>
                  </div>
                  <button
                    onClick={handlePipelineUndo}
                    className="flex items-center gap-1.5 text-[11px] font-black text-blue-400 hover:text-blue-300 bg-white/10 hover:bg-white/15 px-3 py-1 rounded-lg transition-all uppercase tracking-wider cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Undo
                  </button>
                </div>
              )}
              {pipelines.filter(p => p.taggedRepIds?.includes(rep.id) && !p.completedTags?.includes(rep.id)).map(p => (
                <div key={`alert_pipe_${p.id}`} className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-900 flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-2xs">
                  <div className="flex items-start gap-3">
                    <span className="text-xl font-mono">📢</span>
                    <div>
                      <h4 className="font-extrabold text-xs uppercase tracking-wider text-amber-950 flex items-center gap-1.5 font-display">
                        Tagged in Pipeline Opportunity by {p.creatorName || p.creatorId || 'Team'}
                      </h4>
                      <p className="text-[11px] text-amber-800 font-semibold mt-0.5">
                        You are tagged on: <strong className="text-amber-950 font-black">{p.client}</strong> ({p.courseName || 'Training'}).
                        {p.tagNote && ` Message: "${p.tagNote}"`}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      let updatedPipe: any = null;
                      const updated = pipelines.map(item => {
                        if (item.id === p.id) {
                          const completed = [...(item.completedTags || [])];
                          if (!completed.includes(rep.id)) {
                            completed.push(rep.id);
                          }
                          updatedPipe = { ...item, completedTags: completed };
                          return updatedPipe;
                        }
                        return item;
                      });
                      setPipelines(updated);
                      localStorage.setItem('next_pipelines_shared', JSON.stringify(updated));
                      if (updatedPipe) {
                        try {
                          await setDoc(doc(db, 'pipelines', updatedPipe.id), updatedPipe);
                        } catch (err) {
                          console.error("Firestore tag complete failed:", err);
                        }
                      }
                      
                      // Sync back
                      const repIds = ['xin-ying', 'chee-cai', 'alif', 'atiqa', 'new-guy'];
                      repIds.forEach(id => {
                        const ownedPipes = updated.filter(item => item.ownerId === id || item.creatorId === id || item.taggedRepIds?.includes(id));
                        localStorage.setItem(`next_pipelines_${id}`, JSON.stringify(ownedPipes));
                      });
                    }}
                    className="self-end md:self-center bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-black uppercase tracking-wider px-3.5 py-1.5 rounded-lg shadow-sm transition-all cursor-pointer whitespace-nowrap font-sans"
                  >
                    ✓ Complete Tag Action
                  </button>
                </div>
              ))}

              {/* Pipeline summary metrics */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" id="pipeline-metrics-grid">
                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block font-mono">
                    Total Pipeline Value
                  </span>
                  <span className="text-xl font-mono font-black text-blue-600 block mt-1">
                    RM {pipelines.reduce((sum, item) => sum + item.proposalValue, 0).toLocaleString()}
                  </span>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block font-mono">
                    Won Deals Value
                  </span>
                  <span className="text-xl font-mono font-black text-emerald-600 block mt-1">
                    RM {pipelines.filter(i => i.status === 'Won').reduce((sum, item) => sum + item.proposalValue, 0).toLocaleString()}
                  </span>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block font-mono">
                    Pending Opportunities
                  </span>
                  <span className="text-xl font-mono font-black text-amber-600 block mt-1">
                    {pipelines.filter(i => i.status === 'Pending').length} active
                  </span>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block font-mono">
                    Win Ratio
                  </span>
                  <span className="text-xl font-sans font-black text-slate-800 block mt-1">
                    {pipelines.length > 0
                      ? Math.round((pipelines.filter(i => i.status === 'Won').length / pipelines.length) * 100)
                      : 0}%
                  </span>
                </div>
              </div>

              {/* Main Log/Form wrapper */}
              <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden" id="pipeline-form-card">
                <div className={`p-4 text-white flex items-center justify-between ${editingPipeId ? 'bg-blue-600' : 'bg-emerald-600'}`}>
                  <h4 className="text-xs font-black uppercase tracking-wider font-display flex items-center gap-1.5 text-white">
                    <TrendingUp className="w-4 h-4 text-white" />
                    {editingPipeId ? 'EDIT PIPELINE ENTRY' : `ADD NEW PIPELINE ENTRY - ${rep.name.toUpperCase()}`}
                  </h4>
                  <span className={`text-[10px] font-bold px-3 py-1.5 rounded border flex items-center gap-1 font-mono ${editingPipeId ? 'bg-blue-700 border-blue-800' : 'bg-emerald-700 border-emerald-800'}`}>
                    <Clock className="w-3.5 h-3.5" />
                    STATUS: {editingPipeId ? 'EDIT MODE' : 'ACTIVE ENGINE'}
                  </span>
                </div>

                <div className="p-6">
                  {pipelineError && (
                    <div className="mb-4 bg-rose-50 border border-rose-200 rounded-lg p-3 text-xs text-rose-700 font-bold flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 animate-bounce" />
                      <span>{pipelineError}</span>
                    </div>
                  )}
                  <form onSubmit={handleRaisePipelineSubmit} className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-[10px] font-black text-slate-500 uppercase mb-1.5">
                          Client Name
                        </label>
                        <input
                          type="text"
                          required
                          placeholder="e.g. Shopee Malaysia"
                          value={pipeClient}
                          onChange={(e) => setPipeClient(e.target.value)}
                          className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-emerald-500 bg-white"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-black text-slate-500 uppercase mb-1.5">
                          Course or Teambuilding Name
                        </label>
                        <input
                          type="text"
                          required
                          placeholder="e.g. React Workshop or Corporate Retreat"
                          value={pipeCourseName}
                          onChange={(e) => setPipeCourseName(e.target.value)}
                          className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-emerald-500 bg-white"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-black text-slate-500 uppercase mb-1.5">
                          Request Date
                        </label>
                        <input
                          type="date"
                          required
                          value={pipeRequestDate}
                          onChange={(e) => setPipeRequestDate(e.target.value)}
                          className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-emerald-500 bg-white font-mono"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-black text-slate-500 uppercase mb-1.5">
                          Training or Teambuilding
                        </label>
                        <select
                          value={pipeType}
                          onChange={(e) => setPipeType(e.target.value as any)}
                          className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-emerald-500 bg-white"
                        >
                          <option value="Training">Training</option>
                          <option value="Teambuilding">Teambuilding</option>
                        </select>
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="block text-[10px] font-black text-slate-500 uppercase">
                            Proposal Sent Date
                          </label>
                          <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={pipeProposalNotSentYet}
                              onChange={(e) => setPipeProposalNotSentYet(e.target.checked)}
                              className="rounded border-slate-200 text-emerald-600 focus:ring-emerald-500 w-3 h-3 cursor-pointer"
                            />
                            <span>Not sent yet</span>
                          </label>
                        </div>
                        <input
                          type={pipeProposalNotSentYet ? "text" : "date"}
                          required={!pipeProposalNotSentYet}
                          disabled={pipeProposalNotSentYet}
                          value={pipeProposalNotSentYet ? "Not Sent Yet" : pipeProposalSentDate}
                          onChange={(e) => setPipeProposalSentDate(e.target.value)}
                          className={`w-full text-xs border rounded-lg px-3 py-2 focus:outline-none focus:border-emerald-500 font-mono transition-all ${
                            pipeProposalNotSentYet 
                              ? 'bg-slate-50 border-slate-200 text-slate-400 font-black uppercase text-[10px] tracking-wider' 
                              : 'bg-white border-slate-200 text-slate-800'
                          }`}
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-black text-slate-500 uppercase mb-1.5">
                          Proposal Value (RM)
                        </label>
                        <div className="relative">
                          <span className="absolute left-3 top-2.5 text-slate-400 text-xs font-black font-mono">RM</span>
                          <input
                            type="number"
                            required
                            placeholder="e.g. 15000"
                            value={pipeProposalValue}
                            onChange={(e) => setPipeProposalValue(e.target.value)}
                            className="w-full text-xs border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-slate-800 focus:outline-none focus:border-emerald-500 bg-white font-mono"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] font-black text-slate-500 uppercase mb-1.5">
                          Follow Up Date
                        </label>
                        <input
                          type="date"
                          value={pipeFollowUpDate}
                          onChange={(e) => setPipeFollowUpDate(e.target.value)}
                          className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-emerald-500 bg-white font-mono"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-black text-slate-500 uppercase mb-1.5">
                          Status
                        </label>
                        <select
                          value={pipeStatus}
                          onChange={(e) => setPipeStatus(e.target.value as any)}
                          className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-emerald-500 bg-white"
                        >
                          <option value="Pending">Pending</option>
                          <option value="Won">Won</option>
                          <option value="Lost">Lost</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] font-black text-slate-500 uppercase mb-1.5 flex items-center gap-1">
                          Client Owner <span className="text-[9px] text-emerald-600 font-normal lowercase">(belongs to rep)</span>
                        </label>
                        <select
                          value={pipeOwnerId}
                          onChange={(e) => setPipeOwnerId(e.target.value)}
                          className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-emerald-500 bg-white font-bold"
                        >
                          {reps?.map(r => (
                            <option key={r.id} value={r.id}>
                              {r.name} {r.id === rep.id ? '(You)' : ''}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="flex flex-col justify-end">
                        <span className="block text-[10px] font-black text-slate-500 uppercase mb-1.5">
                          Appointment Tracking
                        </span>
                        <label className="flex items-center gap-2 text-slate-700 cursor-pointer select-none bg-white border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 transition-all h-[38px] w-full">
                          <input
                            type="checkbox"
                            id="pipeAppointmentTickedCheckbox"
                            checked={pipeAppointmentTicked}
                            onChange={(e) => setPipeAppointmentTicked(e.target.checked)}
                            className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer"
                          />
                          <span className="text-xs font-bold text-slate-700 uppercase">Appointment Scheduled</span>
                        </label>
                      </div>

                      <div className="md:col-span-2 border border-slate-100 rounded-lg p-3 bg-slate-50/50 space-y-3">
                        <div className="space-y-1.5">
                          <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider">
                            Tag Team Members for Help (Select Multiple)
                          </label>
                          <div className="flex flex-wrap gap-x-4 gap-y-2">
                            {[
                              { id: 'xin-ying', name: 'Xin Ying' },
                              { id: 'alif', name: 'Alif' },
                              { id: 'chee-cai', name: 'Chee Cai' },
                              { id: 'atiqa', name: 'Atiqa' },
                              { id: 'new-guy', name: 'New Guy' }
                            ].filter(m => m.id !== rep.id).map(m => {
                              const isChecked = pipeTaggedRepIds.includes(m.id);
                              return (
                                <label key={m.id} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer hover:text-emerald-600 transition-colors">
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => {
                                      if (isChecked) {
                                        setPipeTaggedRepIds(pipeTaggedRepIds.filter(id => id !== m.id));
                                      } else {
                                        setPipeTaggedRepIds([...pipeTaggedRepIds, m.id]);
                                      }
                                    }}
                                    className="rounded border-slate-350 text-emerald-650 focus:ring-emerald-500 h-3.5 w-3.5 cursor-pointer"
                                  />
                                  <span>{m.name}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>

                        <div className="space-y-1">
                          <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider">
                            Tag Note / Comment Box
                          </label>
                          <input
                            type="text"
                            placeholder="e.g. Please follow up on this deal with Maybank."
                            value={pipeTagNote}
                            onChange={(e) => setPipeTagNote(e.target.value)}
                            className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-emerald-500 bg-white"
                          />
                        </div>
                      </div>

                      <div className="md:col-span-1">
                        <label className="block text-[10px] font-black text-slate-500 uppercase mb-1.5">
                          Opportunity Notes (General)
                        </label>
                        <textarea
                          placeholder="e.g. Discussed with HR, they prefer physical training instead of virtual. Follow-up is critical."
                          value={pipeNotes}
                          onChange={(e) => setPipeNotes(e.target.value)}
                          rows={4}
                          className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-emerald-500 bg-white resize-none"
                          style={{ minHeight: "115px" }}
                        />
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
                      {editingPipeId && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingPipeId(null);
                            setPipeClient('');
                            setPipeCourseName('');
                            setPipeRequestDate(new Date().toISOString().substring(0, 10));
                            setPipeType('Training');
                            setPipeProposalSentDate(new Date().toISOString().substring(0, 10));
                            setPipeProposalValue('');
                            setPipeFollowUpDate('');
                            setPipeStatus('Pending');
                            setPipeTaggedRepIds([]);
                            setPipeTagNote('');
                            setPipeNotes('');
                            setPipeProposalNotSentYet(false);
                            setPipeAppointmentTicked(false);
                          }}
                          className="bg-slate-100 hover:bg-slate-200 text-slate-600 font-black text-xs uppercase tracking-wider px-5 py-2.5 rounded-xl transition-all border border-slate-200 cursor-pointer"
                        >
                          Cancel Edit
                        </button>
                      )}
                      <button
                        type="submit"
                        className={`text-white font-black text-xs uppercase tracking-wider px-6 py-2.5 rounded-xl transition-all shadow-md flex items-center gap-1.5 cursor-pointer ${editingPipeId ? 'bg-blue-600 hover:bg-blue-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}
                      >
                        {editingPipeId ? (
                          <>
                            <Save className="w-4 h-4" />
                            Save Changes
                          </>
                        ) : (
                          <>
                            <Plus className="w-4 h-4" />
                            Log Pipeline Deal
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                </div>
              </div>

              {/* Pipeline List Board */}
              <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden" id="pipeline-table-card">
                <div className="p-4 bg-slate-800 text-white flex items-center justify-between">
                  <h4 className="text-xs font-black uppercase tracking-wider font-display flex items-center gap-1.5 text-white">
                    <Briefcase className="w-4 h-4 text-slate-300" />
                    PAST PIPELINE OPPORTUNITIES ({pipelines.length})
                  </h4>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-black uppercase text-slate-400 font-mono">Sort by:</span>
                      <select
                        value={pipelineSortBy}
                        onChange={(e) => setPipelineSortBy(e.target.value as any)}
                        className="bg-slate-700 text-white text-[10px] font-black uppercase rounded px-2.5 py-1 focus:outline-none border border-slate-600 font-mono cursor-pointer"
                      >
                        <option value="latest">Latest</option>
                        <option value="oldest">Oldest</option>
                        <option value="pending">Pending</option>
                        <option value="won">Won</option>
                        <option value="lost">Lost</option>
                      </select>
                    </div>
                    <span className="text-[10px] bg-slate-700 text-slate-300 font-bold px-2.5 py-1 rounded font-mono">
                      Realtime Logs
                    </span>
                  </div>
                </div>

                {pipelines.length === 0 ? (
                   <div className="p-8 text-center text-slate-400 text-xs italic bg-slate-50/50">
                    No pipeline opportunities loaded yet. Fill in the form above to add logs.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-[9px] font-black text-slate-400 uppercase tracking-widest">
                          <th className="p-4">request date</th>
                          <th className="p-4">Training or Teambuilding</th>
                          <th className="p-4">Proposal Sent date</th>
                          <th className="p-4 text-right">Proposal Value</th>
                          <th className="p-4">Follow up date</th>
                          <th className="p-4 text-center">Status</th>
                          <th className="p-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-700 font-sans text-xs">
                        {[...pipelines].sort((a, b) => {
                          if (pipelineSortBy === 'latest') {
                            return new Date(b.requestDate || b.proposalSentDate || 0).getTime() - new Date(a.requestDate || a.proposalSentDate || 0).getTime();
                          }
                          if (pipelineSortBy === 'oldest') {
                            return new Date(a.requestDate || a.proposalSentDate || 0).getTime() - new Date(b.requestDate || b.proposalSentDate || 0).getTime();
                          }
                          if (pipelineSortBy === 'pending') {
                            if (a.status === 'Pending' && b.status !== 'Pending') return -1;
                            if (a.status !== 'Pending' && b.status === 'Pending') return 1;
                            return 0;
                          }
                          if (pipelineSortBy === 'won') {
                            if (a.status === 'Won' && b.status !== 'Won') return -1;
                            if (a.status !== 'Won' && b.status === 'Won') return 1;
                            return 0;
                          }
                          if (pipelineSortBy === 'lost') {
                            if (a.status === 'Lost' && b.status !== 'Lost') return -1;
                            if (a.status !== 'Lost' && b.status === 'Lost') return 1;
                            return 0;
                          }
                          return 0;
                        }).map((p) => {
                          const isTaggedPending = p.taggedRepIds?.includes(rep.id) && !p.completedTags?.includes(rep.id);
                          return (
                            <tr key={p.id} className={`transition-all duration-300 ${
                              isTaggedPending
                                ? 'bg-amber-50/70 border-l-4 border-l-amber-500 hover:bg-amber-100/70 animate-[pulse_3s_infinite]'
                                : isOverdue(p) 
                                  ? 'bg-rose-50/70 border-l-4 border-l-rose-500 hover:bg-rose-100/70' 
                                  : p.isDuplicate 
                                    ? 'bg-purple-50/10 hover:bg-slate-50/50' 
                                    : 'hover:bg-slate-50/50'
                            }`}>
                              <td className="p-4 font-mono font-bold text-slate-500">{p.requestDate}</td>
                              <td className="p-4">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-extrabold text-slate-800">{p.client}</span>
                                </div>
                                <span className="text-[10px] text-slate-400 block font-mono mt-0.5">{p.courseName}</span>
                                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                  <span className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase bg-slate-100 text-slate-600 font-mono">
                                    {p.type}
                                  </span>
                                  <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-blue-50 text-blue-700 font-mono">
                                    👤 Creator: {p.creatorName || p.creatorId || 'Team'}
                                  </span>
                                  <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-indigo-50 text-indigo-700 font-mono">
                                    💼 Owner: {p.ownerName || p.ownerId || 'Team'}
                                  </span>
                                  {(p.isAppointment || p.appointmentTicked) && (
                                    <span className="px-1.5 py-0.5 rounded text-[8px] font-black bg-[#FFFBEB] text-[#D97706] border border-[#FEF3C7] font-mono uppercase flex items-center gap-0.5">
                                      📅 Appointment
                                    </span>
                                  )}
                                </div>

                                {p.notes && (
                                  <div className="mt-2.5 bg-blue-50/30 border border-blue-100/50 rounded-lg p-2 max-w-sm">
                                    <div className="text-[9px] font-black uppercase text-blue-500 tracking-wider">
                                      Opportunity Notes
                                    </div>
                                    <p className="text-[10px] text-slate-700 font-medium">
                                      {p.notes}
                                    </p>
                                  </div>
                                )}

                                {/* Collaborative Tag Info directly on row */}
                                {p.taggedRepIds && p.taggedRepIds.length > 0 && (
                                  <div className="mt-2.5 bg-slate-50 border border-slate-150 rounded-lg p-2 max-w-sm space-y-1">
                                    <div className="text-[9px] font-black uppercase text-slate-400 tracking-wider">
                                      Collaboration Tags
                                    </div>
                                    <div className="flex flex-wrap gap-1">
                                      {p.taggedRepIds.map(id => {
                                        const isDone = p.completedTags?.includes(id);
                                        return (
                                          <span key={id} className={`text-[8px] font-bold px-1.5 py-0.5 rounded font-mono ${
                                            isDone ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                                          }`}>
                                            @{reps.find(r => r.id === id)?.name || id} {isDone ? '✓ Done' : '⏳ Pending'}
                                          </span>
                                        );
                                      })}
                                    </div>
                                    {p.tagNote && (
                                      <p className="text-[10px] text-slate-600 italic bg-white border border-slate-100 p-1.5 rounded mt-1">
                                        "{p.tagNote}"
                                      </p>
                                    )}
                                    
                                    {/* Mark Done directly on row if tagged */}
                                    {p.taggedRepIds.includes(rep.id) && !p.completedTags?.includes(rep.id) && (
                                      <button
                                        type="button"
                                        onClick={async () => {
                                          let updatedPipe: any = null;
                                          const updated = pipelines.map(item => {
                                            if (item.id === p.id) {
                                              const completed = [...(item.completedTags || [])];
                                              if (!completed.includes(rep.id)) {
                                                completed.push(rep.id);
                                              }
                                              updatedPipe = { ...item, completedTags: completed };
                                              return updatedPipe;
                                            }
                                            return item;
                                          });
                                          setPipelines(updated);
                                          localStorage.setItem('next_pipelines_shared', JSON.stringify(updated));
                                          if (updatedPipe) {
                                            try {
                                              await setDoc(doc(db, 'pipelines', updatedPipe.id), updatedPipe);
                                            } catch (err) {
                                              console.error("Firestore tag complete failed:", err);
                                            }
                                          }
                                          
                                          // Sync back
                                          const repIds = ['xin-ying', 'chee-cai', 'alif', 'atiqa', 'new-guy'];
                                          repIds.forEach(id => {
                                            const ownedPipes = updated.filter(item => item.ownerId === id || item.creatorId === id || item.taggedRepIds?.includes(id));
                                            localStorage.setItem(`next_pipelines_${id}`, JSON.stringify(ownedPipes));
                                          });
                                        }}
                                        className="mt-1 w-full text-center bg-emerald-600 hover:bg-emerald-700 text-white text-[9px] font-black uppercase py-1 rounded transition-all cursor-pointer"
                                      >
                                        ✓ Complete My Tag Action
                                      </button>
                                    )}
                                  </div>
                                )}
                              </td>
                            <td className="p-4 font-mono font-bold text-slate-500">{p.proposalSentDate}</td>
                            <td className="p-4 text-right font-mono font-black text-slate-800">
                              RM {parseFloat(p.proposalValue).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </td>
                            <td className="p-4 font-mono text-slate-500 font-semibold">{p.followUpDate || 'TBD'}</td>
                            <td className="p-4 text-center">
                              {p.status === 'Won' ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-50 border border-emerald-200 text-emerald-700 font-black text-[9px] uppercase tracking-wider">
                                  <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                                  Won
                                </span>
                              ) : p.status === 'Lost' ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-rose-50 border border-rose-200 text-rose-700 font-black text-[9px] uppercase tracking-wider">
                                  <XCircle className="w-3.5 h-3.5 text-rose-600" />
                                  Lost
                                </span>
                              ) : (
                                <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded font-black text-[9px] uppercase tracking-wider border ${
                                  isOverdue(p)
                                    ? 'bg-rose-100 border-rose-300 text-rose-700 animate-pulse'
                                    : 'bg-amber-50 border-amber-200 text-amber-700'
                                }`}>
                                  <AlertCircle className={`w-3.5 h-3.5 ${isOverdue(p) ? 'text-rose-600' : 'text-amber-500'}`} />
                                  {isOverdue(p) ? 'OVERDUE (2+ Days)' : 'Pending'}
                                </span>
                              )}
                            </td>
                            <td className="p-4 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingPipeId(p.id);
                                    setPipeClient(p.client);
                                    setPipeCourseName(p.courseName);
                                    setPipeRequestDate(p.requestDate);
                                    setPipeType(p.type);
                                    setPipeProposalSentDate(p.proposalSentDate === 'not yet' ? new Date().toISOString().substring(0, 10) : p.proposalSentDate);
                                    setPipeProposalNotSentYet(p.proposalSentDate === 'not yet');
                                    setPipeProposalValue(p.proposalValue.toString());
                                    setPipeFollowUpDate(p.followUpDate === 'TBD' ? '' : p.followUpDate);
                                    setPipeStatus(p.status);
                                    setPipeOwnerId(p.ownerId || p.creatorId || rep.id);
                                    setPipeTaggedRepIds(p.taggedRepIds || []);
                                    setPipeTagNote(p.tagNote || '');
                                    setPipeNotes(p.notes || '');
                                    setPipeAppointmentTicked(p.isAppointment || p.appointmentTicked || false);
                                    
                                    // Scroll to form nicely
                                    const cardEl = document.getElementById('pipeline-form-card');
                                    if (cardEl) {
                                      cardEl.scrollIntoView({ behavior: 'smooth' });
                                    }
                                  }}
                                  className="text-blue-500 hover:text-blue-700 p-1 rounded hover:bg-blue-50 transition-colors cursor-pointer"
                                  title="Edit Opportunity"
                                >
                                  <FileText className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    if (window.confirm("Are you sure you want to delete this opportunity?")) {
                                      setPreviousPipelines(JSON.parse(JSON.stringify(pipelines)));
                                      setPipelineUndoMessage('Opportunity deleted successfully.');
                                      const updated = pipelines.filter(item => item.id !== p.id);
                                      setPipelines(updated);
                                      localStorage.setItem('next_pipelines_shared', JSON.stringify(updated));
                                      try {
                                        await deleteDoc(doc(db, 'pipelines', p.id));
                                      } catch (err) {
                                        console.error("Firestore delete pipeline failed:", err);
                                      }
                                      
                                      // Sync back to individual keys
                                      const repIds = ['xin-ying', 'chee-cai', 'alif', 'atiqa', 'new-guy'];
                                      repIds.forEach(id => {
                                        const ownedPipes = updated.filter(item => item.ownerId === id || item.creatorId === id || item.taggedRepIds?.includes(id));
                                        localStorage.setItem(`next_pipelines_${id}`, JSON.stringify(ownedPipes));
                                      });

                                      adjustKpiForPipelineChange(p, undefined);
                                      logPipelineHistory(p, 'Deleted', `Deleted opportunity log for client ${p.client}.`);
                                    }
                                  }}
                                  className="text-rose-500 hover:text-rose-700 p-1 rounded hover:bg-rose-50 transition-colors cursor-pointer"
                                  title="Delete Opportunity Log"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

            </div>
          ) : activeSubTab === 'trainerList' ? (
            /* INTERACTIVE TRAINER LIST WORKSPACE */
            <div className="space-y-6">
              {/* Google Sheets Integration Card */}
              <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5 font-display">
                      <GraduationCap className="w-4 h-4 text-blue-600" />
                      Trainer List Google Sheets Sync
                    </h4>
                    <p className="text-xs text-slate-500">
                      Tie this trainer database to a live collaborative Google Sheet. Paste the URL below to load dynamic sheets.
                    </p>
                  </div>
                  {links.trainerList ? (
                    <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 font-extrabold px-2.5 py-1 rounded font-mono">
                      Connected Live Google Sheet
                    </span>
                  ) : (
                    <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 font-extrabold px-2.5 py-1 rounded font-mono">
                      Offline Mode (Local Storage Only)
                    </span>
                  )}
                </div>

                <form onSubmit={handleSaveUrl} className="flex gap-2">
                  <div className="relative flex-1">
                    <Link2 className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                    <input 
                      type="url" 
                      value={inputUrl}
                      onChange={(e) => setInputUrl(e.target.value)}
                      placeholder="https://docs.google.com/spreadsheets/d/..." 
                      className="w-full text-xs pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 text-slate-800"
                    />
                  </div>
                  <button 
                    type="submit"
                    className="bg-blue-600 hover:bg-blue-700 text-white font-black text-xs uppercase tracking-wider px-5 rounded-lg transition-colors cursor-pointer"
                  >
                    Tie Sheet
                  </button>
                  {links.trainerList && (
                    <button 
                      type="button"
                      onClick={async () => {
                        const updatedLinks = { ...links, trainerList: '' };
                        setLinks(updatedLinks);
                        localStorage.setItem(`next_links_${rep.id}`, JSON.stringify(updatedLinks));
                        try {
                          if (db) {
                            await setDoc(doc(db, 'links', rep.id), updatedLinks);
                          }
                        } catch (err) {
                          console.error("Firestore save links failed:", err);
                        }
                        setInputUrl('');
                      }}
                      className="bg-slate-100 hover:bg-slate-200 text-slate-600 font-black text-xs uppercase tracking-wider px-3 rounded-lg transition-colors cursor-pointer border border-slate-250"
                      title="Disconnect Sheet"
                    >
                      Reset
                    </button>
                  )}
                </form>
              </div>

              {/* Two Column Grid: Add Form + Directory List */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Add Trainer Form Card */}
                <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
                  <div className="p-4 bg-slate-800 text-white">
                    <h5 className="text-xs font-black uppercase tracking-wider font-display flex items-center gap-1.5 text-white">
                      <Plus className="w-4 h-4 text-blue-400" />
                      Register New Trainer
                    </h5>
                  </div>
                  <form onSubmit={handleAddTrainerSubmit} className="p-5 space-y-4">
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase mb-1.5">
                        Trainer Name
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Dr. Jane Smith"
                        value={trainerName}
                        onChange={(e) => setTrainerName(e.target.value)}
                        className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 bg-white"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase mb-1.5">
                        Specialization
                      </label>
                      <select
                        value={trainerSpec}
                        onChange={(e) => setTrainerSpec(e.target.value)}
                        className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 bg-white"
                      >
                        <option value="React & AI Integration">React & AI Integration</option>
                        <option value="Design Thinking & Soft Skills">Design Thinking & Soft Skills</option>
                        <option value="Full-Stack Web Development">Full-Stack Web Development</option>
                        <option value="Leadership & Corporate">Leadership & Corporate</option>
                        <option value="Sales Mastery">Sales Mastery</option>
                        <option value="Technical QA">Technical QA</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase mb-1.5">
                        Contact Number / Email
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. +6011-1234567"
                        value={trainerContact}
                        onChange={(e) => setTrainerContact(e.target.value)}
                        className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 bg-white font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase mb-1.5">
                        Daily Rate (RM)
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-2 text-slate-400 text-xs font-black font-mono">RM</span>
                        <input
                          type="number"
                          placeholder="e.g. 2000"
                          value={trainerRate}
                          onChange={(e) => setTrainerRate(e.target.value)}
                          className="w-full text-xs border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 bg-white font-mono"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase mb-1.5">
                        Status
                      </label>
                      <select
                        value={trainerStatus}
                        onChange={(e) => setTrainerStatus(e.target.value)}
                        className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 bg-white"
                      >
                        <option value="Available">Available</option>
                        <option value="Booked">Booked</option>
                        <option value="On Leave">On Leave</option>
                      </select>
                    </div>

                    <button
                      type="submit"
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black text-xs uppercase tracking-wider py-2.5 rounded-lg transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer mt-2"
                    >
                      <Plus className="w-4 h-4" />
                      Add to Future Listing
                    </button>
                  </form>
                </div>

                {/* Trainer Directory List */}
                <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
                  <div className="p-4 bg-slate-100 border-b border-slate-200 flex items-center justify-between">
                    <h5 className="text-xs font-black uppercase tracking-wider text-slate-700 font-display flex items-center gap-1.5">
                      <Users className="w-4 h-4 text-slate-500" />
                      Registered Trainers Database ({trainers.length})
                    </h5>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-[9px] font-black text-slate-400 uppercase tracking-widest">
                          <th className="p-4">Trainer Name</th>
                          <th className="p-4">Specialization</th>
                          <th className="p-4">Contact</th>
                          <th className="p-4 text-right">Daily Rate</th>
                          <th className="p-4 text-center">Status</th>
                          <th className="p-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-700 font-sans text-xs">
                        {trainers.map((t) => (
                          <tr key={t.id} className="hover:bg-slate-50/50 transition-colors">
                            <td className="p-4 font-extrabold text-slate-800">{t.name}</td>
                            <td className="p-4 font-mono text-[10px] text-slate-500">{t.specialization}</td>
                            <td className="p-4 font-mono text-slate-600">{t.contact}</td>
                            <td className="p-4 text-right font-mono font-black text-slate-800">
                              RM {parseFloat(t.rate || 0).toLocaleString()}
                            </td>
                            <td className="p-4 text-center">
                              {t.status === 'Available' ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-700 font-black text-[9px] uppercase tracking-wider">
                                  Available
                                </span>
                              ) : t.status === 'Booked' ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-700 font-black text-[9px] uppercase tracking-wider">
                                  Booked
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-50 border border-rose-200 text-rose-700 font-black text-[9px] uppercase tracking-wider">
                                  On Leave
                                </span>
                              )}
                            </td>
                            <td className="p-4 text-right">
                              <button
                                type="button"
                                onClick={async () => {
                                  const updated = trainers.filter(item => item.id !== t.id);
                                  setTrainers(updated);
                                  localStorage.setItem(`next_trainers_${rep.id}`, JSON.stringify(updated));
                                  try {
                                    if (db) {
                                      await setDoc(doc(db, 'trainers', rep.id), { trainers: updated });
                                    }
                                  } catch (err) {
                                    console.error("Firestore save trainer failed:", err);
                                  }
                                }}
                                className="text-rose-500 hover:text-rose-700 p-1 rounded hover:bg-rose-50 transition-colors cursor-pointer"
                                title="Remove Trainer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Embedded Google Sheets Preview if linked */}
              {links.trainerList && (
                <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest font-mono bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded">
                      Embedded Google Sheet Live Preview
                    </span>
                    <a 
                      href={links.trainerList} 
                      target="_blank" 
                      referrerPolicy="no-referrer"
                      rel="noopener noreferrer"
                      className="text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1"
                    >
                      Open Google Link in New Tab →
                    </a>
                  </div>
                  <div className="w-full h-[400px] rounded-lg border border-slate-200 overflow-hidden bg-slate-50 relative">
                    <iframe 
                      src={links.trainerList}
                      className="w-full h-full border-0"
                      title="Trainer Google Sheet Sync"
                      sandbox="allow-scripts allow-same-origin allow-popups"
                    />
                  </div>
                </div>
              )}
            </div>
          ) : activeSubTab === 'venue' ? (
            /* INTERACTIVE VENUE WORKSPACE */
            <div className="space-y-6">
              {/* Google Sheets Integration Card */}
              <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5 font-display">
                      <Building2 className="w-4 h-4 text-blue-600" />
                      Venue Database Google Sheets Sync
                    </h4>
                    <p className="text-xs text-slate-500">
                      Tie this venue database to a live collaborative Google Sheet. Paste the URL below to load dynamic sheets.
                    </p>
                  </div>
                  {links.venue ? (
                    <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 font-extrabold px-2.5 py-1 rounded font-mono">
                      Connected Live Google Sheet
                    </span>
                  ) : (
                    <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 font-extrabold px-2.5 py-1 rounded font-mono">
                      Offline Mode (Local Storage Only)
                    </span>
                  )}
                </div>

                <form onSubmit={handleSaveUrl} className="flex gap-2">
                  <div className="relative flex-1">
                    <Link2 className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                    <input 
                      type="url" 
                      value={inputUrl}
                      onChange={(e) => setInputUrl(e.target.value)}
                      placeholder="https://docs.google.com/spreadsheets/d/..." 
                      className="w-full text-xs pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 text-slate-800"
                    />
                  </div>
                  <button 
                    type="submit"
                    className="bg-blue-600 hover:bg-blue-700 text-white font-black text-xs uppercase tracking-wider px-5 rounded-lg transition-colors cursor-pointer"
                  >
                    Tie Sheet
                  </button>
                  {links.venue && (
                    <button 
                      type="button"
                      onClick={async () => {
                        const updatedLinks = { ...links, venue: '' };
                        setLinks(updatedLinks);
                        localStorage.setItem(`next_links_${rep.id}`, JSON.stringify(updatedLinks));
                        try {
                          if (db) {
                            await setDoc(doc(db, 'links', rep.id), updatedLinks);
                          }
                        } catch (err) {
                          console.error("Firestore save links failed:", err);
                        }
                        setInputUrl('');
                      }}
                      className="bg-slate-100 hover:bg-slate-200 text-slate-600 font-black text-xs uppercase tracking-wider px-3 rounded-lg transition-colors cursor-pointer border border-slate-250"
                      title="Disconnect Sheet"
                    >
                      Reset
                    </button>
                  )}
                </form>
              </div>

              {/* Two Column Grid: Add Form + Directory List */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Add Venue Form Card */}
                <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
                  <div className="p-4 bg-slate-800 text-white">
                    <h5 className="text-xs font-black uppercase tracking-wider font-display flex items-center gap-1.5 text-white">
                      <Plus className="w-4 h-4 text-blue-400" />
                      Register New Venue Details
                    </h5>
                  </div>
                  <form onSubmit={handleAddVenueSubmit} className="p-5 space-y-4 max-h-[700px] overflow-y-auto">
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase mb-1.5">
                        Venue Name (VENUE)
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Happi Village, Janda Baik"
                        value={venueNameInput}
                        onChange={(e) => setVenueNameInput(e.target.value)}
                        className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 bg-white"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase mb-1.5">
                        Distance (DISTANCE)
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. 45 km from HQ or Janda Baik"
                        value={venueDistanceInput}
                        onChange={(e) => setVenueDistanceInput(e.target.value)}
                        className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 bg-white"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-black text-slate-500 uppercase mb-1.5">
                          Meeting Package Price
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. RM 150/pax/day"
                          value={venueMeetingPackagePrice}
                          onChange={(e) => setVenueMeetingPackagePrice(e.target.value)}
                          className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 bg-white font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-black text-slate-500 uppercase mb-1.5">
                          Room Package Price
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. RM 280/pax"
                          value={venueRoomPackagePrice}
                          onChange={(e) => setVenueRoomPackagePrice(e.target.value)}
                          className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 bg-white font-mono"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase mb-1.5">
                        Dinner Package
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. RM 120/pax (BBQ Buffet)"
                        value={venueDinnerPackage}
                        onChange={(e) => setVenueDinnerPackage(e.target.value)}
                        className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 bg-white"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase mb-1.5">
                        Facilities & Benefits
                      </label>
                      <textarea
                        rows={2}
                        placeholder="e.g. WiFi, Projector, Sound System, Poolside Lounge"
                        value={venueFacilities}
                        onChange={(e) => setVenueFacilities(e.target.value)}
                        className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 bg-white resize-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase mb-1.5">
                        Email / Contact Number
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. reservation@happivillage.my"
                        value={venueContactInput}
                        onChange={(e) => setVenueContactInput(e.target.value)}
                        className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 bg-white font-mono"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-black text-slate-500 uppercase mb-1.5">
                          Quotation Date
                        </label>
                        <input
                          type="date"
                          value={venueQuotationDate}
                          onChange={(e) => setVenueQuotationDate(e.target.value)}
                          className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 bg-white font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-black text-slate-500 uppercase mb-1.5">
                          Status
                        </label>
                        <select
                          value={venueStatusInput}
                          onChange={(e) => setVenueStatusInput(e.target.value)}
                          className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 bg-white"
                        >
                          <option value="Available">Available</option>
                          <option value="Booked">Booked</option>
                          <option value="Renovation">Renovation</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase mb-1.5">
                        Pictures (URL)
                      </label>
                      <input
                        type="url"
                        placeholder="e.g. https://images.unsplash.com/... or link"
                        value={venuePictures}
                        onChange={(e) => setVenuePictures(e.target.value)}
                        className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 bg-white font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase mb-1.5">
                        Remarks
                      </label>
                      <textarea
                        rows={2}
                        placeholder="Additional remarks or notes..."
                        value={venueRemarks}
                        onChange={(e) => setVenueRemarks(e.target.value)}
                        className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 bg-white resize-none"
                      />
                    </div>

                    <button
                      type="submit"
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black text-xs uppercase tracking-wider py-2.5 rounded-lg transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer mt-2"
                    >
                      <Plus className="w-4 h-4" />
                      Add Venue Entry
                    </button>
                  </form>
                </div>

                {/* Venue Directory List */}
                <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden flex flex-col">
                  <div className="p-4 bg-slate-100 border-b border-slate-200 flex items-center justify-between">
                    <h5 className="text-xs font-black uppercase tracking-wider text-slate-700 font-display flex items-center gap-1.5">
                      <MapPin className="w-4 h-4 text-slate-500" />
                      Registered Venues Database ({venues.length})
                    </h5>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[1200px]">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-[9px] font-black text-slate-400 uppercase tracking-widest">
                          <th className="p-4 w-[180px]">Venue</th>
                          <th className="p-4 w-[100px]">Distance</th>
                          <th className="p-4 w-[160px]">Meeting Package</th>
                          <th className="p-4 w-[150px]">Room Package</th>
                          <th className="p-4 w-[140px]">Dinner Package</th>
                          <th className="p-4 w-[200px]">Facilities & Benefits</th>
                          <th className="p-4 w-[180px]">Email / Contact</th>
                          <th className="p-4 w-[110px]">Quotation Date</th>
                          <th className="p-4 w-[150px]">Remarks</th>
                          <th className="p-4 w-[100px] text-center">Pictures</th>
                          <th className="p-4 w-[100px] text-center">Status</th>
                          <th className="p-4 w-[60px] text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-700 font-sans text-xs">
                        {venues.map((v) => (
                          <tr key={v.id} className="hover:bg-slate-50/50 transition-colors">
                            <td className="p-4 font-extrabold text-slate-800 align-top">
                              {v.name}
                            </td>
                            <td className="p-4 text-slate-600 font-medium align-top">
                              {v.distance}
                            </td>
                            <td className="p-4 font-mono font-bold text-blue-700 align-top">
                              {v.meetingPackagePrice}
                            </td>
                            <td className="p-4 font-mono text-indigo-700 align-top font-bold">
                              {v.roomPackagePrice}
                            </td>
                            <td className="p-4 text-slate-700 align-top font-medium">
                              {v.dinnerPackage}
                            </td>
                            <td className="p-4 text-slate-600 align-top">
                              <p className="line-clamp-3 text-[11px]" title={v.facilities}>
                                {v.facilities}
                              </p>
                            </td>
                            <td className="p-4 text-slate-600 font-mono text-[11px] align-top break-all">
                              {v.contact}
                            </td>
                            <td className="p-4 font-mono text-slate-500 align-top text-[11px]">
                              {v.quotationDate}
                            </td>
                            <td className="p-4 text-slate-500 align-top text-[11px]">
                              <p className="line-clamp-3" title={v.remarks}>
                                {v.remarks}
                              </p>
                            </td>
                            <td className="p-4 text-center align-top">
                              {v.pictures ? (
                                <a 
                                  href={v.pictures} 
                                  target="_blank" 
                                  rel="noopener noreferrer" 
                                  referrerPolicy="no-referrer"
                                  className="inline-block relative group"
                                >
                                  <img 
                                    src={v.pictures} 
                                    alt="Venue Thumbnail" 
                                    referrerPolicy="no-referrer"
                                    className="w-10 h-10 object-cover rounded-md border border-slate-200 shadow-xs hover:scale-105 transition-transform"
                                    onError={(e) => {
                                      // fallback if image link fails
                                      (e.target as HTMLElement).style.display = 'none';
                                    }}
                                  />
                                  <span className="absolute -bottom-1 -right-1 bg-slate-800 text-white rounded-full text-[8px] px-1 font-bold">
                                    Link
                                  </span>
                                </a>
                              ) : (
                                <span className="text-[10px] text-slate-300 italic font-mono">None</span>
                              )}
                            </td>
                            <td className="p-4 text-center align-top">
                              {v.status === 'Available' ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-700 font-black text-[9px] uppercase tracking-wider">
                                  Available
                                </span>
                              ) : v.status === 'Booked' ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-700 font-black text-[9px] uppercase tracking-wider">
                                  Booked
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-50 border border-rose-200 text-rose-700 font-black text-[9px] uppercase tracking-wider">
                                  Renovation
                                </span>
                              )}
                            </td>
                            <td className="p-4 text-right align-top">
                              <button
                                type="button"
                                onClick={async () => {
                                  const updated = venues.filter(item => item.id !== v.id);
                                  setVenues(updated);
                                  localStorage.setItem(`next_venues_${rep.id}`, JSON.stringify(updated));
                                  try {
                                    if (db) {
                                      await setDoc(doc(db, 'venues', rep.id), { venues: updated });
                                    }
                                  } catch (err) {
                                    console.error("Firestore save venue failed:", err);
                                  }
                                }}
                                className="text-rose-500 hover:text-rose-700 p-1 rounded hover:bg-rose-50 transition-colors cursor-pointer"
                                title="Remove Venue"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Embedded Google Sheets Preview if linked */}
              {links.venue && (
                <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest font-mono bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded">
                      Embedded Google Sheet Live Preview
                    </span>
                    <a 
                      href={links.venue} 
                      target="_blank" 
                      referrerPolicy="no-referrer"
                      rel="noopener noreferrer"
                      className="text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1"
                    >
                      Open Google Link in New Tab →
                    </a>
                  </div>
                  <div className="w-full h-[400px] rounded-lg border border-slate-200 overflow-hidden bg-slate-50 relative">
                    <iframe 
                      src={links.venue}
                      className="w-full h-full border-0"
                      title="Venue Google Sheet Sync"
                      sandbox="allow-scripts allow-same-origin allow-popups"
                    />
                  </div>
                </div>
              )}
            </div>
          ) : activeSubTab === 'tasks' ? (
            /* PENDING TASKS LOG SYSTEM */
            <div className="space-y-6">
              {taskUndoMessage && (
                <div className="bg-slate-900 text-white rounded-xl p-3 px-4 flex items-center justify-between text-xs shadow-md animate-fade-in border border-slate-800">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span>{taskUndoMessage}</span>
                  </div>
                  <button
                    onClick={handleTaskUndo}
                    className="flex items-center gap-1.5 text-[11px] font-black text-emerald-400 hover:text-emerald-300 bg-white/10 hover:bg-white/15 px-3 py-1 rounded-lg transition-all uppercase tracking-wider cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Undo
                  </button>
                </div>
              )}
              
              {/* Specialized Tasks Header */}
              <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs flex items-center justify-center" id="tasks-wireframe-header">
                <div className="border border-slate-800 rounded-xl px-12 py-3 bg-white text-center">
                  <span className="text-xl md:text-2xl font-normal text-slate-500 font-sans tracking-wide">
                    Pending Tasks Dashboard
                  </span>
                </div>
              </div>

              {/* Two Column Workspace: Left (Form), Right (List) */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                
                {/* Left Form: Create Tasks */}
                <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
                  <div className="p-4 bg-blue-600 text-white flex items-center justify-between">
                    <h5 className="text-xs font-black uppercase tracking-wider font-display flex items-center gap-1.5 text-white">
                      <Plus className="w-4 h-4 text-white" />
                      Create Tasks
                    </h5>
                    <span className="text-[9px] bg-blue-700 font-bold px-2 py-0.5 rounded border border-blue-800 uppercase font-mono">
                      Realtime Form
                    </span>
                  </div>

                  <form onSubmit={handleAddTaskSubmit} className="p-5 space-y-4">
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase mb-1.5">
                        Date Task Created
                      </label>
                      <input 
                        type="date" 
                        value={new Date().toISOString().substring(0, 10)} 
                        disabled 
                        className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 bg-slate-50 text-slate-400 font-mono cursor-not-allowed focus:outline-none" 
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase mb-1.5">
                        Task Detail
                      </label>
                      <textarea
                        required
                        rows={3}
                        placeholder="Describe the tasks details, deliverable, or action points..."
                        value={taskDetail}
                        onChange={(e) => setTaskDetail(e.target.value)}
                        className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 bg-white"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase mb-1.5">
                        Dateline (Deadline)
                      </label>
                      <input
                        type="date"
                        required
                        value={taskDateline}
                        onChange={(e) => setTaskDateline(e.target.value)}
                        className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 bg-white font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase mb-1.5">
                        Assign To Team Member
                      </label>
                      <select
                        value={taskAssignedToId}
                        onChange={(e) => setTaskAssignedToId(e.target.value)}
                        className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 bg-white"
                      >
                        <option value="">-- Assign to Myself ({rep.name}) --</option>
                        {[
                          { id: 'xin-ying', name: 'Xin Ying' },
                          { id: 'chee-cai', name: 'Chee Cai' },
                          { id: 'alif', name: 'Alif' },
                          { id: 'atiqa', name: 'Atiqa' },
                          { id: 'new-guy', name: 'New Guy' }
                        ].filter(m => m.id !== rep.id).map(m => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                      </select>
                      <span className="text-[10px] text-slate-400 font-mono block mt-1.5 leading-relaxed">
                        Note: Assigning to another rep creates an identical duplicate on their task list.
                      </span>
                    </div>

                    <button
                      type="submit"
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black text-xs uppercase tracking-wider py-2.5 rounded-lg transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer mt-2"
                    >
                      <Plus className="w-4 h-4" />
                      Create & Assign Task
                    </button>
                  </form>
                </div>

                {/* Right Panel: Task List */}
                <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden flex flex-col">
                  
                  {/* Header & Controls bar */}
                  <div className="p-4 bg-slate-800 text-white flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <h5 className="text-xs font-black uppercase tracking-wider font-display flex items-center gap-1.5 text-white">
                      <Briefcase className="w-4 h-4 text-blue-400" />
                      Assigned Pending Tasks ({tasks.length})
                    </h5>

                    {/* Sorting & Hiding Options Bar */}
                    <div className="flex flex-wrap items-center gap-3">
                      
                      {/* Sort selection */}
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-black uppercase text-slate-400 font-mono">Sort by:</span>
                        <select
                          value={taskSortBy}
                          onChange={(e) => setTaskSortBy(e.target.value as any)}
                          className="bg-slate-700 text-white text-[10px] font-black uppercase rounded px-2.5 py-1 focus:outline-none border border-slate-600 font-mono cursor-pointer"
                        >
                          <option value="dateCreated">Created Date</option>
                          <option value="dateline">Dateline / Due</option>
                        </select>
                      </div>

                      {/* Hide Done Toggle */}
                      <button
                        type="button"
                        onClick={() => setTaskHideDone(!taskHideDone)}
                        className={`text-[10px] font-black uppercase rounded px-2.5 py-1 border transition-colors ${taskHideDone ? 'bg-amber-600 text-white border-amber-500' : 'bg-slate-700 text-slate-300 border-slate-600'}`}
                      >
                        {taskHideDone ? 'Showing Pending Only' : 'Showing All Statuses'}
                      </button>

                    </div>
                  </div>

                  {/* Tasks List */}
                  {tasks.length === 0 ? (
                    <div className="p-12 text-center text-slate-400 text-xs italic bg-slate-50/50">
                      No pending tasks created or assigned yet. Fill in the form on the left to schedule assignments.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 text-[9px] font-black text-slate-400 uppercase tracking-widest">
                            <th className="p-4 w-[110px]">Date Created</th>
                            <th className="p-4">Task Details</th>
                            <th className="p-4 w-[110px]">Dateline / Due</th>
                            <th className="p-4 w-[100px] text-center">Status</th>
                            <th className="p-4 w-[140px]">Assigned By / To</th>
                            <th className="p-4 w-[90px] text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-150 text-slate-700 font-sans text-xs">
                          {[...tasks]
                            .filter(t => !taskHideDone || t.status !== 'Done')
                            .sort((a, b) => {
                              if (taskSortBy === 'dateline') {
                                return new Date(a.dateline || 0).getTime() - new Date(b.dateline || 0).getTime();
                              }
                              const timeDiff = new Date(b.dateCreated || 0).getTime() - new Date(a.dateCreated || 0).getTime();
                              if (timeDiff === 0) {
                                return (b.createdAt || 0) - (a.createdAt || 0);
                              }
                              return timeDiff;
                            })
                            .map((t) => {
                              const isCompleted = t.status === 'Done';
                              return (
                                <tr 
                                  key={t.id} 
                                  className={`hover:bg-slate-50/50 transition-colors ${t.isHidden ? 'opacity-30' : ''} ${t.isDuplicate ? 'bg-blue-50/10' : ''}`}
                                >
                                  <td className="p-4 font-mono font-bold text-slate-400 align-top">
                                    {t.dateCreated}
                                  </td>
                                  <td className="p-4 align-top">
                                    <span className={`block font-extrabold text-slate-800 leading-relaxed ${isCompleted ? 'line-through text-slate-400' : ''}`}>
                                      {t.detail}
                                    </span>
                                    {t.isDuplicate && (
                                      <span className="inline-block mt-1.5 px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider bg-indigo-50 border border-indigo-200 text-indigo-700 font-mono">
                                        Received Copy
                                      </span>
                                    )}
                                  </td>
                                  <td className="p-4 font-mono text-red-600 font-extrabold align-top">
                                    {t.dateline}
                                  </td>
                                  <td className="p-4 text-center align-top">
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        const newStatus = t.status === 'Done' ? 'Not done' : 'Done';
                                        const updated = tasks.map(item => {
                                          if (item.id === t.id) {
                                            return { ...item, status: newStatus };
                                          }
                                          return item;
                                        });
                                        setTasks(updated);
                                        localStorage.setItem(`next_tasks_${rep.id}`, JSON.stringify(updated));
                                        try {
                                          await updateDoc(doc(db, 'tasks', t.id), { status: newStatus });
                                        } catch (err) {
                                          console.error("Error updating task status:", err);
                                        }
                                      }}
                                      className={`px-3 py-1 rounded-full font-black text-[9px] uppercase tracking-widest cursor-pointer transition-all ${isCompleted ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}`}
                                    >
                                      {t.status}
                                    </button>
                                  </td>
                                  <td className="p-4 align-top space-y-1">
                                    <div className="text-[10px]">
                                      <span className="text-slate-400 font-bold font-mono">BY:</span>{' '}
                                      <span className="font-extrabold text-slate-700">{t.assignedBy}</span>
                                    </div>
                                    <div className="text-[10px]">
                                      <span className="text-slate-400 font-bold font-mono">TO:</span>{' '}
                                      <span className="font-extrabold text-blue-600">{t.assignedTo}</span>
                                    </div>
                                  </td>
                                  <td className="p-4 text-right align-top">
                                    <div className="flex items-center justify-end gap-1.5">
                                      {/* Hide/Unhide Option */}
                                      <button
                                        type="button"
                                        onClick={async () => {
                                          const nextHidden = !t.isHidden;
                                          const updated = tasks.map(item => {
                                            if (item.id === t.id) {
                                              return { ...item, isHidden: nextHidden };
                                            }
                                            return item;
                                          });
                                          setTasks(updated);
                                          localStorage.setItem(`next_tasks_${rep.id}`, JSON.stringify(updated));
                                          try {
                                            await updateDoc(doc(db, 'tasks', t.id), { isHidden: nextHidden });
                                          } catch (err) {
                                            console.error("Error updating task visibility:", err);
                                          }
                                        }}
                                        className="text-slate-400 hover:text-slate-600 p-1 rounded hover:bg-slate-100 transition-colors cursor-pointer"
                                        title={t.isHidden ? 'Unhide Task' : 'Hide Task'}
                                      >
                                        {t.isHidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                      </button>

                                      {/* Delete Task Option */}
                                      <button
                                        type="button"
                                        onClick={async () => {
                                          if (window.confirm("Are you sure you want to delete this task?")) {
                                            setPreviousTasks(JSON.parse(JSON.stringify(tasks)));
                                            setTaskUndoMessage("Task deleted successfully.");
                                            const updated = tasks.filter(item => item.id !== t.id);
                                            setTasks(updated);
                                            localStorage.setItem(`next_tasks_${rep.id}`, JSON.stringify(updated));
                                            try {
                                              await deleteDoc(doc(db, 'tasks', t.id));
                                            } catch (err) {
                                              console.error("Error deleting task:", err);
                                            }
                                          }
                                        }}
                                        className="text-rose-500 hover:text-rose-700 p-1 rounded hover:bg-rose-50 transition-colors cursor-pointer"
                                        title="Delete Task"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  )}

                </div>

              </div>

            </div>
          ) : (
            /* DYNAMIC GOOGLE LINK VIEW FOR OTHER PAGES */
            <div className="bg-white border border-slate-200 rounded-xl p-8 shadow-xs text-center space-y-6 min-h-[420px] flex flex-col justify-center items-center">
              
              <div className="space-y-2">
                {/* Displaying "Please put in google link" exactly as shown in screenshot 3 */}
                <h4 className="text-2xl font-semibold text-slate-400 font-sans tracking-tight">
                  Please put in google link
                </h4>
                <p className="text-xs text-slate-400 max-w-md">
                  Update and link your real Google Sheets, Slides, or Docs URL for {getSectionTitle()} to embed or access them here securely.
                </p>
              </div>

              {/* URL Customization input form */}
              <form onSubmit={handleSaveUrl} className="w-full max-w-lg space-y-3 bg-slate-50 p-5 rounded-xl border border-slate-150">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Link2 className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                    <input 
                      type="url" 
                      value={inputUrl}
                      onChange={(e) => setInputUrl(e.target.value)}
                      placeholder="https://docs.google.com/spreadsheets/d/..." 
                      className="w-full text-xs pl-9 pr-3 py-2.5 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 text-slate-800"
                    />
                  </div>
                  <button 
                    type="submit"
                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs px-4 rounded-lg transition-colors"
                  >
                    Save Link
                  </button>
                </div>
                <p className="text-[10px] text-slate-400 text-left font-mono">
                  Supported formats: Standard Google Sheet links, publish-to-web embed codes, or any safe HTTP URL.
                </p>
              </form>

              {/* If active URL is configured, render iframe embedding or direct open link button */}
              {activeLink ? (
                <div className="w-full space-y-3 pt-4 border-t border-slate-100">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest font-mono bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded">
                      Link Synced Successfully
                    </span>
                    <a 
                      href={activeLink} 
                      target="_blank" 
                      referrerPolicy="no-referrer"
                      rel="noopener noreferrer"
                      className="text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1"
                    >
                      Open Google Link in New Tab →
                    </a>
                  </div>
                  
                  {/* Real embedded safe iframe preview */}
                  <div className="w-full h-[320px] rounded-lg border border-slate-200 overflow-hidden bg-slate-50 relative">
                    <iframe 
                      src={activeLink}
                      className="w-full h-full border-0"
                      title={getSectionTitle()}
                      sandbox="allow-scripts allow-same-origin allow-popups"
                    />
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-slate-50/50 rounded-lg text-[11px] text-slate-400 font-mono border border-dashed border-slate-200 max-w-sm">
                  Active sheet is currently offline. Paste a URL above to initialize realtime Google integration.
                </div>
              )}

            </div>
          )}

        </div>

      </div>

      {/* Commission modal Key-In */}
      {showCommissionModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-sm w-full p-6 shadow-xl border border-slate-150 space-y-4">
            <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
              <DollarSign className="w-4 h-4 text-emerald-500" />
              {rep.id === 'atiqa' ? 'Log KPI Activity Values' : '$ Key In Commission & Activity'}
            </h3>
            
            <form onSubmit={handleCommissionSubmit} className="space-y-3 text-left">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Select Active Week</label>
                <select 
                  value={selectedWeek}
                  onChange={(e) => setSelectedWeek(parseInt(e.target.value))}
                  className="w-full text-xs border border-slate-200 rounded px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500"
                >
                  <option value={0}>Week 1</option>
                  <option value={1}>Week 2</option>
                  <option value={2}>Week 3</option>
                  <option value={3}>Week 4</option>
                  <option value={4}>Week 5</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  {rep.id === 'atiqa' ? 'Perf. Rating (1-5)' : 'Sales Closed (RM)'}
                </label>
                <input 
                  type="number" 
                  required
                  placeholder={rep.id === 'atiqa' ? 'Rating e.g. 5' : 'e.g. 15000'} 
                  value={commissionAmount}
                  onChange={(e) => {
                    let val = e.target.value;
                    if (rep.id === 'atiqa') {
                      const num = parseFloat(val);
                      if (num > 5) val = '5';
                      if (num < 0) val = '0';
                    }
                    setCommissionAmount(val);
                  }}
                  className="w-full text-xs border border-slate-200 rounded px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 font-mono"
                  min={rep.id === 'atiqa' ? 0 : undefined}
                  max={rep.id === 'atiqa' ? 5 : undefined}
                />
              </div>

              <div className="border-t border-slate-100 pt-3 mt-3">
                <span className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 font-display">
                  Optional Activity Log Metrics
                </span>
                
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[9px] font-bold text-slate-400 mb-1">
                      {rep.id === 'atiqa' ? 'Add Claim Subm.' : 'Add Proposals'}
                    </label>
                    <input 
                      type="number" 
                      placeholder="e.g. 1" 
                      value={commissionProposals}
                      onChange={(e) => setCommissionProposals(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded px-3.5 py-1.5 text-slate-800 focus:outline-none font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold text-slate-400 mb-1">
                      {rep.id === 'atiqa' ? 'Add Venue Entries' : 'Add Previews'}
                    </label>
                    <input 
                      type="number" 
                      placeholder="e.g. 5" 
                      value={commissionPreview}
                      onChange={(e) => setCommissionPreview(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded px-3.5 py-1.5 text-slate-800 focus:outline-none font-mono"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 mt-3">
                <button 
                  type="button" 
                  onClick={() => setShowCommissionModal(false)}
                  className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold px-4 py-2 rounded transition-colors"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="text-xs bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded transition-colors"
                >
                  {rep.id === 'atiqa' ? 'Log KPI activity' : 'Log Sale closed'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MANAGER AUTHORIZATION MODAL (Requirement 9) */}
      {showManagerAuthModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-[9999] animate-fade-in">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-4 animate-scale-up">
            <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
              <div className="p-2 bg-rose-50 text-rose-600 rounded-lg">
                <Shield className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-800">
                  Manager Permission Required
                </h4>
                <p className="text-[10px] text-slate-400 font-medium">
                  Reps cannot delete sheets data without manager approval.
                </p>
              </div>
            </div>

            <form onSubmit={(e) => {
              e.preventDefault();
              if (managerPassword === 'nextacademy24' || managerPassword === 'next99' || managerPassword === 'admin') {
                setShowManagerAuthModal(false);
                if (managerAction) managerAction();
              } else {
                setManagerAuthError(true);
              }
            }} className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider">
                  Manager Passcode
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-slate-400">
                    <Lock className="w-4 h-4" />
                  </span>
                  <input
                    type="password"
                    autoFocus
                    required
                    placeholder="Enter passcode..."
                    value={managerPassword}
                    onChange={(e) => {
                      setManagerPassword(e.target.value);
                      setManagerAuthError(false);
                    }}
                    className="w-full text-xs border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-slate-800 focus:outline-none focus:border-rose-500 bg-white font-mono"
                  />
                </div>
                {managerAuthError && (
                  <p className="text-[10px] text-rose-600 font-bold flex items-center gap-1">
                    <XCircle className="w-3.5 h-3.5" /> Incorrect passcode. Access denied.
                  </p>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowManagerAuthModal(false)}
                  className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold px-4 py-2 rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="text-xs bg-rose-600 hover:bg-rose-700 text-white font-bold px-4 py-2 rounded-xl transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <CheckCircle className="w-3.5 h-3.5" /> Confirm Deletion
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* INBOUND TAG READ & RESPOND MODAL */}
      {selectedInboundTag && (() => {
        const sender = reps.find(r => r.id === selectedInboundTag.senderId);
        if (!sender) return null;
        const senderKpi = sender.kpi;
        const wkIdx = selectedInboundTag.weekIdx;
        const progress = getLastWeekProgress(senderKpi, wkIdx);
        const help = getHelpNeeded(senderKpi, wkIdx);
        const dateline = getDateline(senderKpi, wkIdx);
        const note = getTagNote(senderKpi, wkIdx);
        const comments = getCollaborationComments(senderKpi, wkIdx);

        return (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-[9999] animate-fade-in">
            <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-4 animate-scale-up max-h-[90vh] overflow-y-auto text-left">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-amber-50 text-amber-600 rounded-lg">
                    <Tag className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-black uppercase tracking-wider text-slate-800">
                      {selectedInboundTag.type === 'partner' ? '🤝 Accountability Partner Details' : '📥 KPI Collaboration Tag'}
                    </h4>
                    <p className="text-[10px] text-slate-400 font-medium">
                      Tagged by <span className="font-bold text-slate-600">{selectedInboundTag.senderName}</span> for Week {wkIdx + 1}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedInboundTag(null)}
                  className="text-slate-400 hover:text-slate-600 font-bold p-1 hover:bg-slate-50 rounded"
                >
                  <XCircle className="w-5 h-5" />
                </button>
              </div>

              {/* Tag Details */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-150 space-y-3">
                <div>
                  <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider block mb-1">
                    📋 Last Week Activity Report
                  </span>
                  <p className="text-xs text-slate-700 font-semibold bg-white p-2 rounded border border-slate-100 whitespace-pre-wrap">
                    {progress || 'No activity details logged.'}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider block mb-1">
                      ⚠️ Help / Blockers Needed
                    </span>
                    <p className="text-xs text-slate-700 bg-white p-2 rounded border border-slate-100 min-h-[40px]">
                      {help || 'None listed.'}
                    </p>
                  </div>
                  <div>
                    <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider block mb-1">
                      📅 Target Dateline
                    </span>
                    <p className="text-xs text-slate-700 bg-white p-2 rounded border border-slate-100 font-mono text-center">
                      {dateline || 'Not specified.'}
                    </p>
                  </div>
                </div>

                {selectedInboundTag.type === 'general' && (
                  <div>
                    <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider block mb-1">
                      💭 Tag Comment
                    </span>
                    <p className="text-xs text-amber-800 bg-amber-50 p-2.5 rounded border border-amber-100 italic">
                      "{note || 'Please review my KPI progress for this week.'}"
                    </p>
                  </div>
                )}
              </div>

              {/* Comments / Conversation History */}
              <div className="space-y-2">
                <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider flex items-center gap-1">
                  <MessageSquare className="w-3.5 h-3.5 text-blue-600" />
                  Conversation Thread ({comments.length})
                </span>
                {comments.length > 0 ? (
                  <div className="space-y-2 max-h-[160px] overflow-y-auto pr-1 bg-slate-50/50 p-2 rounded-lg border border-slate-100">
                    {comments.map((comm, idx) => (
                      <div key={comm.id || idx} className="bg-white p-2.5 rounded-lg border border-slate-100 shadow-3xs space-y-1">
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="font-extrabold text-slate-800 flex items-center gap-1">
                            👤 {comm.authorName} {comm.authorId === rep.id && <span className="text-[8px] bg-slate-100 text-slate-500 px-1 rounded uppercase font-mono">You</span>}
                          </span>
                          <div className="flex items-center gap-1.5 font-mono text-[8px] text-slate-400">
                            <span>{comm.timestamp ? new Date(comm.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                            <span className={`px-1 rounded uppercase font-black ${
                              comm.status === 'Done' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                            }`}>
                              {comm.status}
                            </span>
                          </div>
                        </div>
                        <p className="text-xs text-slate-650 italic">
                          "{comm.text}"
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 italic bg-slate-50 p-3 rounded-lg border border-dashed border-slate-250 text-center">
                    No comments or replies logged yet. Start the conversation below.
                  </p>
                )}
              </div>

              {/* Quick Action & Form Response */}
              <form onSubmit={handleInboundTagResponseSubmit} className="space-y-3.5 border-t border-slate-100 pt-3">
                <div className="flex items-center justify-between bg-slate-50 p-2.5 rounded-xl border border-slate-150">
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider">
                    Update Status Target
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setTagResponseStatus('Pending')}
                      className={`px-3 py-1 text-[10px] font-black uppercase tracking-wider rounded-lg border transition-all cursor-pointer ${
                        tagResponseStatus === 'Pending'
                          ? 'bg-amber-100 border-amber-300 text-amber-800 shadow-3xs'
                          : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      ⏳ Keep Pending
                    </button>
                    <button
                      type="button"
                      onClick={() => setTagResponseStatus('Done')}
                      className={`px-3 py-1 text-[10px] font-black uppercase tracking-wider rounded-lg border transition-all cursor-pointer ${
                        tagResponseStatus === 'Done'
                          ? 'bg-emerald-100 border-emerald-300 text-emerald-800 shadow-3xs'
                          : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      ✓ Mark Handled
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider">
                    Reply message / progress note
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Write a response comment..."
                    value={tagResponseText}
                    onChange={(e) => setTagResponseText(e.target.value)}
                    className="w-full text-xs border border-slate-200 rounded-lg p-2.5 text-slate-800 focus:outline-none focus:border-blue-500 bg-white"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setSelectedInboundTag(null)}
                    className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold px-4 py-2 rounded-xl transition-colors cursor-pointer"
                  >
                    Close
                  </button>
                  <button
                    type="submit"
                    className="text-xs bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-xl transition-colors cursor-pointer flex items-center gap-1"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Submit Response
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

    </div>
  );
}
