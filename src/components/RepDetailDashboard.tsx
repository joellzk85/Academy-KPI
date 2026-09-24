import React, { useState, useEffect } from 'react';
import { Representative, GoogleLinks, Client } from '../types';
import { getRepMetrics } from '../initialData';
import { ArrowLeft, Save, Link2, Plus, Calendar, DollarSign, Calculator, Percent, Sparkles, Clock, FileText, Trash2, Briefcase, TrendingUp, CheckCircle, XCircle, AlertCircle, Users, MapPin, Building2, GraduationCap, Eye, EyeOff, Tag, RotateCcw, Lock, Shield, History, MessageSquare, Send, CornerDownRight, Check, Printer, Download, RefreshCw, FileSpreadsheet, ChevronDown, ChevronUp, PieChart, Edit3, CheckSquare, Square, FolderCheck, Search, Layers, CheckCheck } from 'lucide-react';
import QuotationGenerator from './QuotationGenerator';
import CourseOutlineGenerator from './CourseOutlineGenerator';
import AdminRecordManager from './AdminRecordManager';
import ClientManager from './ClientManager';
import TrainerManager from './TrainerManager';
import VenueManager from './VenueManager';
import AppointmentManager from './AppointmentManager';
import ClientPaymentManager from './ClientPaymentManager';
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

type SubTab = 'quotation' | 'kpi' | 'client' | 'faci' | 'trainerList' | 'venue' | 'tasks' | 'pl' | 'payment' | 'pipeline' | 'course_outline' | 'admin_record' | 'appointments' | 'client_payments';


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
        proposalValue: 65000,
        followUpDate: '2026-07-08',
        status: 'Won',
        client: 'Maybank HQ',
        courseName: 'Full-Stack Engineering Boot Camp'
      }
    ];
  }
  return [];
}

// Tombstone list of pipeline IDs the user has deleted, so other views
// (e.g. HomeDashboard's own shared-pipeline loader) can filter them out
// even if they're reading from a stale local cache instead of live Firestore.
const DELETED_PIPELINE_IDS_KEY = 'next_deleted_pipeline_ids';

export function getDeletedPipelineIds(): string[] {
  try {
    const saved = localStorage.getItem(DELETED_PIPELINE_IDS_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

function markPipelineDeleted(id: string) {
  try {
    const current = getDeletedPipelineIds();
    if (!current.includes(id)) {
      localStorage.setItem(DELETED_PIPELINE_IDS_KEY, JSON.stringify([...current, id]));
    }
  } catch {
    // ignore
  }
}

// Formats a YYYY-MM-DD training date as e.g. "20 Apr 2026". Returns '' if empty.
// Falls back to the raw text if it isn't a clean ISO date, so older records never break.
function formatTrainingDate(dateStr?: string): string {
  if (!dateStr) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  return dateStr;
}

export interface PLLineItem {
  id: string;
  category: 'revenue' | 'cogs' | 'commission';
  label: string;
  amount: number;
  ratePct?: number;
  notes?: string;
}

export interface ProjectPL {
  id: string;
  projectTitle: string;
  clientName: string;
  clientCompany?: string;
  clientContact?: string;
  projectCode?: string;
  projectDate?: string;
  intakePeriod?: string;
  paxCount?: number;
  venueLocation?: string;
  linkType: 'pipeline' | 'quotation' | 'manual';
  linkedPipelineId?: string;
  linkedQuotationId?: string;
  linkedQuotationNumber?: string;
  items: PLLineItem[];
  enableHrdcLevy?: boolean;
  enableSst?: boolean;
  taxRate: number;
  updatedAt: string;
  notes?: string;
}

export function getProjectDateValue(proj?: Partial<ProjectPL> | null): string {
  if (!proj) return '';
  return proj.projectDate || proj.intakePeriod || '';
}

export function formatProjectDateDisplay(dateStr?: string): string {
  if (!dateStr) return 'N/A';
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    try {
      const [y, m, d] = dateStr.split('-').map(Number);
      const dt = new Date(y, m - 1, d);
      return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch {
      return dateStr;
    }
  }
  return dateStr;
}

export function normalizeDateForInput(dateStr?: string): string {
  if (!dateStr) return new Date().toISOString().split('T')[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const lower = dateStr.toLowerCase();
  if (lower.includes('july') || lower.includes('07')) return '2026-07-15';
  if (lower.includes('august') || lower.includes('08')) return '2026-08-20';
  if (lower.includes('september') || lower.includes('09')) return '2026-09-15';
  if (lower.includes('october') || lower.includes('10')) return '2026-10-15';
  if (lower.includes('november') || lower.includes('11')) return '2026-11-15';
  if (lower.includes('december') || lower.includes('12')) return '2026-12-15';
  return '2026-07-15';
}

export const DEFAULT_PL_REFERENCE_URL = 'https://docs.google.com/spreadsheets/d/1Jj0LPs_9vkoGvvk_0i35f1igvFP9cKI0cymimYHZkXI/edit?usp=sharing';

export const EXACT_USER_PRESET_ITEMS: string[] = [
  'Activities Equipment and Materials',
  'Banner',
  'Commission',
  'Commission for agent',
  'Door gifts',
  'E-certificate of Participation',
  'Facilitators',
  'Medals for winning team',
  'Miscellaneous',
  'Participants transport',
  'Photography',
  'T-shirts',
  'Trainer',
  'Transport budget',
  'Venue cost',
  'Videography & Drone'
];

export const PL_PRESET_ITEMS_BY_CATEGORY: Record<'revenue' | 'cogs' | 'commission', string[]> = {
  revenue: [
    'Advisory & Consulting Services',
    'Corporate B2B Custom Training',
    'Course & Bootcamp Tuition Fees',
    'Course Outline & Syllabus Licensing',
    'Sales'
  ],
  cogs: [
    'Activities Equipment and Materials',
    'Banner',
    'Commission',
    'Commission for agent',
    'Door gifts',
    'E-certificate of Participation',
    'Facilitators',
    'Medals for winning team',
    'Miscellaneous',
    'Participants transport',
    'Photography',
    'T-shirts',
    'Trainer',
    'Transport budget',
    'Venue cost',
    'Videography & Drone'
  ],
  commission: [
    'Agent Commission',
    'Commission',
    'Commission for agent',
    'Introducer Fee',
    'Partner Commission',
    'Referral Fee',
    'Sales Rep Commission'
  ]
};

export const DEFAULT_PL_ITEMS: PLLineItem[] = [
  // Revenue / Sales
  { id: 'rev_1', category: 'revenue', label: 'Sales', amount: 85000, notes: 'Total project sales revenue' },
  
  // Cost of Training (COGS / Direct Costs)
  { id: 'cogs_1', category: 'cogs', label: 'Trainer', amount: 15000, notes: 'Lead trainer honorarium' },
  { id: 'cogs_2', category: 'cogs', label: 'Facilitators', amount: 4000, notes: 'Co-trainers & assistants' },
  { id: 'cogs_3', category: 'cogs', label: 'Activities Equipment and Materials', amount: 2500, notes: 'Training materials & activity kits' },
  { id: 'cogs_4', category: 'cogs', label: 'E-certificate of Participation', amount: 500, notes: 'Digital certification issue' },
  { id: 'cogs_5', category: 'cogs', label: 'Photography', amount: 1200, notes: 'Event photographer' },
  { id: 'cogs_6', category: 'cogs', label: 'Videography & Drone', amount: 2500, notes: 'Video recording & drone coverage' },
  { id: 'cogs_7', category: 'cogs', label: 'Medals for winning team', amount: 800, notes: 'Team competition awards' },
  { id: 'cogs_8', category: 'cogs', label: 'Door gifts', amount: 1500, notes: 'Participant welcome gifts' },
  { id: 'cogs_9', category: 'cogs', label: 'T-shirts', amount: 2000, notes: 'Custom event t-shirts' },
  { id: 'cogs_10', category: 'cogs', label: 'Banner', amount: 350, notes: 'Event backdrop & banners' },
  { id: 'cogs_11', category: 'cogs', label: 'Transport budget', amount: 1200, notes: 'Logistics & travel allowance' },
  { id: 'cogs_12', category: 'cogs', label: 'Participants transport', amount: 3200, notes: 'Participant bus transport' },
  { id: 'cogs_14', category: 'cogs', label: 'Venue cost', amount: 12000, notes: 'Resort/hotel venue & catering' },
  { id: 'cogs_15', category: 'cogs', label: 'Miscellaneous', amount: 1000, notes: 'Contingency & admin extras' },

  // Commissions
  { id: 'comm_1', category: 'commission', label: 'Agent Commission', ratePct: 5.3, amount: 4500, notes: '5.3% of sales revenue' }
];

export function getDefaultProjectPLs(rep: Representative, pipelinesList: any[] = []): ProjectPL[] {
  const repPipelines = pipelinesList.filter(p => p.ownerId === rep.id);
  const d1 = repPipelines[0];
  const d2 = repPipelines[1];

  return [
    {
      id: `pl_prj_${rep.id}_1`,
      projectTitle: d1 ? d1.courseName : 'Enterprise AI & Full-Stack Development Bootcamp',
      clientName: d1 ? d1.client : 'Petronas Digital Sdn Bhd',
      clientCompany: d1 ? d1.client : 'Petronas Group HR & Learning',
      clientContact: 'Encik Ahmad Razak (Head of Learning)',
      projectCode: `PRJ-${rep.id.toUpperCase()}-2026-01`,
      projectDate: '2026-07-15',
      intakePeriod: '2026-07-15',
      paxCount: 30,
      venueLocation: 'Happi Village, Janda Baik',
      linkType: d1 ? 'pipeline' : 'manual',
      linkedPipelineId: d1 ? d1.id : undefined,
      linkedQuotationNumber: `QT-2026-${rep.id.toUpperCase()}-001`,
      items: [
        { id: 'rev_1', category: 'revenue', label: 'Sales', amount: d1 ? (d1.proposalValue || 85000) : 85000, notes: 'Total project sales revenue' },
        { id: 'cogs_1', category: 'cogs', label: 'Trainer', amount: 15000, notes: 'Lead trainer honorarium' },
        { id: 'cogs_2', category: 'cogs', label: 'Facilitators', amount: 4000, notes: 'Co-trainers & assistants' },
        { id: 'cogs_3', category: 'cogs', label: 'Activities Equipment and Materials', amount: 2500, notes: 'Training materials & activity kits' },
        { id: 'cogs_4', category: 'cogs', label: 'E-certificate of Participation', amount: 500, notes: 'Digital certification issue' },
        { id: 'cogs_5', category: 'cogs', label: 'Photography', amount: 1200, notes: 'Event photographer' },
        { id: 'cogs_6', category: 'cogs', label: 'Videography & Drone', amount: 2500, notes: 'Video recording & drone coverage' },
        { id: 'cogs_7', category: 'cogs', label: 'Medals for winning team', amount: 800, notes: 'Team competition awards' },
        { id: 'cogs_8', category: 'cogs', label: 'Door gifts', amount: 1500, notes: 'Participant welcome gifts' },
        { id: 'cogs_9', category: 'cogs', label: 'T-shirts', amount: 2000, notes: 'Custom event t-shirts' },
        { id: 'cogs_10', category: 'cogs', label: 'Banner', amount: 350, notes: 'Event backdrop & banners' },
        { id: 'cogs_11', category: 'cogs', label: 'Transport budget', amount: 1200, notes: 'Logistics & travel allowance' },
        { id: 'cogs_12', category: 'cogs', label: 'Participants transport', amount: 3200, notes: 'Participant bus transport' },
        { id: 'cogs_14', category: 'cogs', label: 'Venue cost', amount: 12000, notes: 'Resort/hotel venue & catering' },
        { id: 'cogs_15', category: 'cogs', label: 'Miscellaneous', amount: 1000, notes: 'Contingency & admin extras' },
        { id: 'comm_1', category: 'commission', label: 'Agent Commission', ratePct: 5.3, amount: 4500, notes: 'Agent introduction commission' }
      ],
      taxRate: 15,
      updatedAt: new Date().toISOString().split('T')[0],
      notes: 'High-value corporate workshop deal.'
    },
    {
      id: `pl_prj_${rep.id}_2`,
      projectTitle: d2 ? d2.courseName : 'Executive Design Thinking & Innovation Retreat',
      clientName: d2 ? d2.client : 'Maybank Corporate Learning',
      clientCompany: d2 ? d2.client : 'Maybank Berhad',
      clientContact: 'Ms. Sarah Chen (Talent Development)',
      projectCode: `PRJ-${rep.id.toUpperCase()}-2026-02`,
      projectDate: '2026-08-20',
      intakePeriod: '2026-08-20',
      paxCount: 20,
      venueLocation: 'Park Royal Resort, Penang',
      linkType: 'quotation',
      linkedQuotationNumber: `QT-2026-${rep.id.toUpperCase()}-088`,
      items: [
        { id: 'rev_1', category: 'revenue', label: 'Sales', amount: 52000, notes: 'Quotation #QT-2026-088' },
        { id: 'cogs_1', category: 'cogs', label: 'Trainer', amount: 12000, notes: 'Design Thinking Facilitator Fee' },
        { id: 'cogs_2', category: 'cogs', label: 'Facilitators', amount: 3000, notes: 'Assistant trainers' },
        { id: 'cogs_3', category: 'cogs', label: 'Activities Equipment and Materials', amount: 2000, notes: 'Workshop toolkits' },
        { id: 'cogs_4', category: 'cogs', label: 'E-certificate of Participation', amount: 400, notes: 'E-certificates' },
        { id: 'cogs_5', category: 'cogs', label: 'Photography', amount: 1000, notes: 'Photography' },
        { id: 'cogs_6', category: 'cogs', label: 'Videography & Drone', amount: 2000, notes: 'Videography' },
        { id: 'cogs_7', category: 'cogs', label: 'Medals for winning team', amount: 500, notes: 'Medals' },
        { id: 'cogs_8', category: 'cogs', label: 'Door gifts', amount: 1000, notes: 'Door gifts' },
        { id: 'cogs_9', category: 'cogs', label: 'T-shirts', amount: 1500, notes: 'T-shirts' },
        { id: 'cogs_10', category: 'cogs', label: 'Banner', amount: 300, notes: 'Banners' },
        { id: 'cogs_11', category: 'cogs', label: 'Transport budget', amount: 1000, notes: 'Transport' },
        { id: 'cogs_12', category: 'cogs', label: 'Participants transport', amount: 2800, notes: 'Buses' },
        { id: 'cogs_14', category: 'cogs', label: 'Venue cost', amount: 10000, notes: 'Resort venue cost' },
        { id: 'cogs_15', category: 'cogs', label: 'Miscellaneous', amount: 800, notes: 'Miscellaneous' },
        { id: 'comm_1', category: 'commission', label: 'Agent Commission', ratePct: 5.8, amount: 3000, notes: 'Commission for agent' }
      ],
      taxRate: 15,
      updatedAt: new Date().toISOString().split('T')[0],
      notes: 'Executive leadership retreat.'
    }
  ];
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

  // Project-Based P&L Financial Statement States & Handlers
  const [projectPLs, setProjectPLs] = useState<ProjectPL[]>(() => {
    const saved = localStorage.getItem(`next_project_pls_${rep.id}`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch {}
    }
    // Migration from old single P&L format
    const legacySaved = localStorage.getItem(`next_pl_${rep.id}`);
    if (legacySaved) {
      try {
        const parsedLegacy = JSON.parse(legacySaved);
        if (Array.isArray(parsedLegacy) && parsedLegacy.length > 0) {
          const defaults = getDefaultProjectPLs(rep);
          defaults[0].items = parsedLegacy;
          return defaults;
        }
      } catch {}
    }
    return getDefaultProjectPLs(rep);
  });

  const [activeProjectId, setActiveProjectId] = useState<string>(() => {
    return projectPLs[0]?.id || '';
  });

  const [showProjectModal, setShowProjectModal] = useState<boolean>(false);
  const [editingProject, setEditingProject] = useState<Partial<ProjectPL> | null>(null);
  const [plNotice, setPlNotice] = useState<string>('');
  const [plViewMode, setPlViewMode] = useState<'overview' | 'detail'>('detail');
  const [isSavingPL, setIsSavingPL] = useState<boolean>(false);

  const [newPLCategory, setNewPLCategory] = useState<'revenue' | 'cogs' | 'commission'>('cogs');
  const [newPLLabel, setNewPLLabel] = useState<string>('');
  const [newPLAmount, setNewPLAmount] = useState<string>('');
  const [newPLRatePct, setNewPLRatePct] = useState<string>('');
  const [newPLNotes, setNewPLNotes] = useState<string>('');

  // Date & Project Tabulation Filter States (Tabulate Total Sales and GP based on selected date or project)
  const [tabulateFilterMode, setTabulateFilterMode] = useState<'all' | 'by_project' | 'single_date' | 'date_range' | 'month' | 'quarter'>('all');
  const [tabulateSingleDate, setTabulateSingleDate] = useState<string>('2026-07-15');
  const [tabulateStartDate, setTabulateStartDate] = useState<string>('2026-07-01');
  const [tabulateEndDate, setTabulateEndDate] = useState<string>('2026-12-31');
  const [tabulateMonth, setTabulateMonth] = useState<string>('2026-07');
  const [tabulateQuarter, setTabulateQuarter] = useState<string>('Q3-2026');
  const [tabulateSelectedProjectIds, setTabulateSelectedProjectIds] = useState<string[]>([]);
  const [tabulateProjectSearch, setTabulateProjectSearch] = useState<string>('');
  const [isTabulatorOpen, setIsTabulatorOpen] = useState<boolean>(true);

  // Active Project Reference
  const activeProject: ProjectPL = projectPLs.find(p => p.id === activeProjectId) || projectPLs[0] || getDefaultProjectPLs(rep)[0];

  const saveProjectPLsState = async (updatedPLs: ProjectPL[]) => {
    setProjectPLs(updatedPLs);
    localStorage.setItem(`next_project_pls_${rep.id}`, JSON.stringify(updatedPLs));
    if (db) {
      try {
        await setDoc(doc(db, 'project_pls', rep.id), { projects: updatedPLs });
      } catch (err) {
        console.error("Firestore Project PL save error:", err);
      }
    }
  };

  const handleExplicitSavePL = async () => {
    setIsSavingPL(true);
    await saveProjectPLsState(projectPLs);
    setPlNotice(`P&L Statement saved successfully! ("${activeProject?.projectTitle || 'Project'}")`);
    setTimeout(() => {
      setIsSavingPL(false);
    }, 1200);
    setTimeout(() => {
      setPlNotice('');
    }, 4000);
  };

  const handleOpenCreateProjectModal = () => {
    const todayStr = new Date().toISOString().split('T')[0];
    const defaultProj: Partial<ProjectPL> = {
      id: `pl_prj_${rep.id}_${Date.now()}`,
      projectTitle: 'New Client Workshop & Project',
      clientName: 'New Corporate Client',
      clientCompany: '',
      clientContact: '',
      projectCode: `PRJ-${rep.id.toUpperCase()}-${Date.now().toString().slice(-4)}`,
      projectDate: todayStr,
      intakePeriod: todayStr,
      paxCount: 25,
      venueLocation: 'Happi Village, Janda Baik',
      linkType: 'manual',
      items: DEFAULT_PL_ITEMS,
      enableHrdcLevy: false,
      enableSst: false,
      taxRate: 15,
      updatedAt: todayStr,
      notes: ''
    };
    setEditingProject(defaultProj);
    setShowProjectModal(true);
  };

  const handleOpenEditProjectModal = (proj: ProjectPL) => {
    setEditingProject({ ...proj });
    setShowProjectModal(true);
  };

  const handleSaveProjectDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProject || !editingProject.projectTitle) return;

    let updatedList: ProjectPL[];
    const existingIdx = projectPLs.findIndex(p => p.id === editingProject.id);
    const chosenDate = editingProject.projectDate || editingProject.intakePeriod || new Date().toISOString().split('T')[0];

    const fullProj: ProjectPL = {
      id: editingProject.id || `pl_prj_${rep.id}_${Date.now()}`,
      projectTitle: editingProject.projectTitle || 'Untitled Project',
      clientName: editingProject.clientName || 'Unspecified Client',
      clientCompany: editingProject.clientCompany || '',
      clientContact: editingProject.clientContact || '',
      projectCode: editingProject.projectCode || `PRJ-${Date.now().toString().slice(-4)}`,
      projectDate: chosenDate,
      intakePeriod: chosenDate,
      paxCount: editingProject.paxCount || 20,
      venueLocation: editingProject.venueLocation || 'HQ',
      linkType: editingProject.linkType || 'manual',
      linkedPipelineId: editingProject.linkedPipelineId,
      linkedQuotationNumber: editingProject.linkedQuotationNumber,
      items: editingProject.items && editingProject.items.length > 0 ? editingProject.items : DEFAULT_PL_ITEMS,
      enableHrdcLevy: Boolean(editingProject.enableHrdcLevy),
      enableSst: Boolean(editingProject.enableSst),
      taxRate: typeof editingProject.taxRate === 'number' ? editingProject.taxRate : 15,
      updatedAt: new Date().toISOString().split('T')[0],
      notes: editingProject.notes || ''
    };

    if (existingIdx >= 0) {
      updatedList = [...projectPLs];
      updatedList[existingIdx] = fullProj;
    } else {
      updatedList = [...projectPLs, fullProj];
    }

    await saveProjectPLsState(updatedList);
    setActiveProjectId(fullProj.id);
    setShowProjectModal(false);
    setEditingProject(null);
    setPlNotice(`Saved Project P&L: "${fullProj.projectTitle}"`);
    setTimeout(() => setPlNotice(''), 3000);
  };

  const handleDeleteProject = async (id: string) => {
    if (projectPLs.length <= 1) {
      alert("At least one Project P&L statement must be retained.");
      return;
    }
    if (window.confirm("Are you sure you want to delete this Project P&L statement?")) {
      const updated = projectPLs.filter(p => p.id !== id);
      await saveProjectPLsState(updated);
      setActiveProjectId(updated[0].id);
      setPlNotice("Project P&L removed.");
      setTimeout(() => setPlNotice(''), 3000);
    }
  };

  const handleSyncRevenueFromPipeline = async () => {
    if (!activeProject) return;

    // If this project is linked to a Quotation, re-pull its current total (in case
    // the quotation was edited since it was first linked) instead of a pipeline deal.
    if (activeProject.linkType === 'quotation' && activeProject.linkedQuotationId) {
      const quote = quotationsForPipelines.find(q => q.id === activeProject.linkedQuotationId);
      if (!quote) {
        setPlNotice("Linked quotation not found.");
        setTimeout(() => setPlNotice(''), 3000);
        return;
      }
      const itemsTotal = (quote.items || []).reduce((sum: number, it: any) => sum + (it.totalFee || 0), 0);
      const sst = quote.applySST ? (itemsTotal * (quote.sstRate || 8) / 100) : 0;
      const quoteTotal = itemsTotal + sst;

      const updatedItems = activeProject.items.map(item => {
        if (item.category === 'revenue') {
          return {
            ...item,
            amount: quoteTotal || item.amount,
            notes: `Synced from Quotation: ${quote.refNumber}`
          };
        }
        return item;
      });

      const updatedProject: ProjectPL = {
        ...activeProject,
        clientName: quote.company || activeProject.clientName,
        items: updatedItems,
        updatedAt: new Date().toISOString().split('T')[0]
      };

      const updatedPLs = projectPLs.map(p => p.id === activeProject.id ? updatedProject : p);
      await saveProjectPLsState(updatedPLs);
      setPlNotice(`Synced RM ${quoteTotal.toLocaleString()} from Quotation "${quote.refNumber}"!`);
      setTimeout(() => setPlNotice(''), 3000);
      return;
    }

    let targetDeal: any = null;
    if (activeProject.linkedPipelineId) {
      targetDeal = pipelines.find(p => p.id === activeProject.linkedPipelineId);
    } else {
      targetDeal = pipelines.find(p => p.status === 'Won') || pipelines[0];
    }

    if (!targetDeal) {
      setPlNotice("No pipeline deal found to sync.");
      setTimeout(() => setPlNotice(''), 3000);
      return;
    }

    const updatedItems = activeProject.items.map(item => {
      if (item.category === 'revenue') {
        return {
          ...item,
          amount: targetDeal.proposalValue || item.amount,
          notes: `Synced from Pipeline Deal: ${targetDeal.courseName} (${targetDeal.client})`
        };
      }
      return item;
    });

    const updatedProject: ProjectPL = {
      ...activeProject,
      clientName: targetDeal.client || activeProject.clientName,
      projectTitle: targetDeal.courseName || activeProject.projectTitle,
      linkType: 'pipeline',
      linkedPipelineId: targetDeal.id,
      items: updatedItems,
      updatedAt: new Date().toISOString().split('T')[0]
    };

    const updatedPLs = projectPLs.map(p => p.id === activeProject.id ? updatedProject : p);
    await saveProjectPLsState(updatedPLs);
    setPlNotice(`Synced RM ${(targetDeal.proposalValue || 0).toLocaleString()} from "${targetDeal.courseName}"!`);
    setTimeout(() => setPlNotice(''), 3000);
  };

  const handleAddPLLineItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPLLabel.trim() || !activeProject) return;

    const currentRevenue = (activeProject.items || [])
      .filter(i => i.category === 'revenue')
      .reduce((sum, item) => sum + (item.amount || 0), 0);

    const rateVal = parseFloat(newPLRatePct);
    const amtVal = parseFloat(newPLAmount) || 0;
    
    let finalAmount = amtVal;
    let finalRatePct: number | undefined = undefined;

    if (newPLCategory === 'commission') {
      if (!isNaN(rateVal) && rateVal > 0) {
        finalRatePct = rateVal;
        finalAmount = currentRevenue > 0 ? Math.round((currentRevenue * (rateVal / 100)) * 100) / 100 : amtVal;
      } else if (currentRevenue > 0 && amtVal > 0) {
        finalRatePct = Math.round(((amtVal / currentRevenue) * 100) * 10) / 10;
      }
    }

    const newItem: PLLineItem = {
      id: `pl_${Date.now()}`,
      category: newPLCategory,
      label: newPLLabel.trim(),
      amount: finalAmount,
      ratePct: finalRatePct,
      notes: newPLNotes.trim()
    };
    const updatedItems = [...activeProject.items, newItem];
    const updatedPLs = projectPLs.map(p => p.id === activeProject.id ? { ...p, items: updatedItems } : p);
    await saveProjectPLsState(updatedPLs);
    setNewPLLabel('');
    setNewPLAmount('');
    setNewPLRatePct('');
    setNewPLNotes('');
    setPlNotice(`Added line item "${newItem.label}".`);
    setTimeout(() => setPlNotice(''), 3000);
  };

  const handleUpdatePLItem = async (id: string, field: keyof PLLineItem, value: any) => {
    if (!activeProject) return;
    const currentRevenue = (activeProject.items || [])
      .filter(i => i.category === 'revenue')
      .reduce((sum, item) => sum + (item.amount || 0), 0);

    const updatedItems = activeProject.items.map(item => {
      if (item.id === id) {
        if (field === 'ratePct') {
          const rate = parseFloat(value) || 0;
          const newAmount = currentRevenue > 0 ? Math.round((currentRevenue * (rate / 100)) * 100) / 100 : item.amount;
          return { ...item, ratePct: rate, amount: newAmount };
        } else if (field === 'amount') {
          const amt = parseFloat(value) || 0;
          const newRate = (currentRevenue > 0 && item.category === 'commission') ? Math.round(((amt / currentRevenue) * 100) * 10) / 10 : item.ratePct;
          return { ...item, amount: amt, ratePct: newRate };
        } else {
          return { ...item, [field]: value };
        }
      }
      return item;
    });
    const updatedPLs = projectPLs.map(p => p.id === activeProject.id ? { ...p, items: updatedItems } : p);
    await saveProjectPLsState(updatedPLs);
  };

  const handleDeletePLItem = async (id: string) => {
    if (!activeProject) return;
    const updatedItems = activeProject.items.filter(item => item.id !== id);
    const updatedPLs = projectPLs.map(p => p.id === activeProject.id ? { ...p, items: updatedItems } : p);
    await saveProjectPLsState(updatedPLs);
    setPlNotice("P&L line item removed.");
    setTimeout(() => setPlNotice(''), 3000);
  };

  const handleUpdateTaxRate = async (rate: number) => {
    if (!activeProject) return;
    const updatedPLs = projectPLs.map(p => p.id === activeProject.id ? { ...p, taxRate: rate } : p);
    await saveProjectPLsState(updatedPLs);
  };

  const handleToggleHrdcLevy = async (enabled: boolean) => {
    if (!activeProject) return;
    const updatedPLs = projectPLs.map(p => p.id === activeProject.id ? { ...p, enableHrdcLevy: enabled } : p);
    await saveProjectPLsState(updatedPLs);
  };

  const handleToggleSst = async (enabled: boolean) => {
    if (!activeProject) return;
    const updatedPLs = projectPLs.map(p => p.id === activeProject.id ? { ...p, enableSst: enabled } : p);
    await saveProjectPLsState(updatedPLs);
  };

  const handleUpdateProjectDate = async (dateStr: string) => {
    if (!activeProject) return;
    const updatedPLs = projectPLs.map(p => p.id === activeProject.id ? { ...p, projectDate: dateStr, intakePeriod: dateStr } : p);
    await saveProjectPLsState(updatedPLs);
  };

  const handleUpdateIntakePeriod = async (period: string) => {
    if (!activeProject) return;
    const updatedPLs = projectPLs.map(p => p.id === activeProject.id ? { ...p, projectDate: period, intakePeriod: period } : p);
    await saveProjectPLsState(updatedPLs);
  };

  // Real-time Firestore sync for Project P&L Statements
  useEffect(() => {
    if (!db) return;

    const docRef = doc(db, 'project_pls', rep.id);
    const unsubscribe = onSnapshot(docRef, async (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.projects && Array.isArray(data.projects) && data.projects.length > 0) {
          setProjectPLs(data.projects);
          localStorage.setItem(`next_project_pls_${rep.id}`, JSON.stringify(data.projects));
        }
      } else {
        const initial = getDefaultProjectPLs(rep, pipelines);
        await setDoc(docRef, { projects: initial });
      }
    });

    return () => unsubscribe();
  }, [rep.id]);

  // Derived Financial Computations for Active Project P&L
  const revenueItems = (activeProject?.items || []).filter(i => i.category === 'revenue');
  const cogsItems = (activeProject?.items || []).filter(i => i.category === 'cogs');
  const commissionItems = (activeProject?.items || []).filter(i => i.category === 'commission');

  const totalRevenue = revenueItems.reduce((sum, item) => sum + (item.amount || 0), 0);
  const totalCOGS = cogsItems.reduce((sum, item) => sum + (item.amount || 0), 0);

  const resolvedCommissionItems = commissionItems.map(item => {
    if (typeof item.ratePct === 'number' && item.ratePct > 0) {
      const computed = totalRevenue > 0 ? (totalRevenue * (item.ratePct / 100)) : item.amount;
      return { ...item, amount: Math.round(computed * 100) / 100 };
    }
    return item;
  });

  const totalCommissions = resolvedCommissionItems.reduce((sum, item) => sum + (item.amount || 0), 0);

  const grossProfit = totalRevenue - totalCOGS - totalCommissions;
  const grossMarginPct = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

  // Optional Tax Deductions & Statutory Levies (4% HRDC Levy, 8% SST)
  const enableHrdcLevy = activeProject?.enableHrdcLevy ?? false;
  const enableSst = activeProject?.enableSst ?? false;
  const hrdcAmount = enableHrdcLevy ? totalRevenue * 0.04 : 0;
  const sstAmount = enableSst ? totalRevenue * 0.08 : 0;
  const totalLeviesAndDeductions = hrdcAmount + sstAmount;

  const grossProfitAfterDeductions = grossProfit - totalLeviesAndDeductions;
  const grossMarginAfterDeductionsPct = totalRevenue > 0 ? (grossProfitAfterDeductions / totalRevenue) * 100 : 0;

  // Date & Project Tabulation Filter Engine (Calculates Total Sales & Total GP for Selected Projects/Dates)
  const isProjectInTabulatedDate = (proj: ProjectPL): boolean => {
    const rawDate = proj.projectDate || proj.intakePeriod || '';
    if (tabulateFilterMode === 'all') return true;

    if (tabulateFilterMode === 'by_project') {
      if (tabulateSelectedProjectIds.length === 0) return true;
      return tabulateSelectedProjectIds.includes(proj.id);
    }

    if (tabulateFilterMode === 'single_date') {
      if (!tabulateSingleDate) return true;
      if (rawDate === tabulateSingleDate) return true;
      if (rawDate.startsWith(tabulateSingleDate)) return true;
      return false;
    }

    if (tabulateFilterMode === 'month') {
      if (!tabulateMonth) return true;
      if (rawDate.startsWith(tabulateMonth)) return true;
      const [y, m] = tabulateMonth.split('-');
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      const mIdx = parseInt(m, 10) - 1;
      const mName = monthNames[mIdx];
      if (mName && rawDate.toLowerCase().includes(mName.toLowerCase()) && rawDate.includes(y)) return true;
      return false;
    }

    if (tabulateFilterMode === 'quarter') {
      const [q, y] = tabulateQuarter.split('-');
      let months: string[] = [];
      if (q === 'Q1') months = ['01', '02', '03'];
      else if (q === 'Q2') months = ['04', '05', '06'];
      else if (q === 'Q3') months = ['07', '08', '09'];
      else if (q === 'Q4') months = ['10', '11', '12'];

      const matchesMonth = months.some(m => rawDate.startsWith(`${y}-${m}`));
      if (matchesMonth) return true;
      if (rawDate.toLowerCase().includes(q.toLowerCase()) && rawDate.includes(y)) return true;
      return false;
    }

    if (tabulateFilterMode === 'date_range') {
      const norm = rawDate.length === 10 ? rawDate : normalizeDateForInput(rawDate);
      if (tabulateStartDate && norm < tabulateStartDate) return false;
      if (tabulateEndDate && norm > tabulateEndDate) return false;
      return true;
    }

    return true;
  };

  const toggleProjectInTabulation = (projId: string) => {
    if (tabulateFilterMode !== 'by_project') {
      setTabulateFilterMode('by_project');
      setTabulateSelectedProjectIds([projId]);
      return;
    }
    setTabulateSelectedProjectIds(prev => {
      if (prev.includes(projId)) {
        const next = prev.filter(id => id !== projId);
        return next;
      } else {
        return [...prev, projId];
      }
    });
  };

  const selectAllProjectsForTabulation = () => {
    setTabulateFilterMode('by_project');
    setTabulateSelectedProjectIds(projectPLs.map(p => p.id));
  };

  const clearAllProjectsForTabulation = () => {
    setTabulateFilterMode('by_project');
    setTabulateSelectedProjectIds([]);
  };

  const selectOnlyProjectForTabulation = (projId: string) => {
    setTabulateFilterMode('by_project');
    setTabulateSelectedProjectIds([projId]);
  };

  const tabulatedProjects = projectPLs.filter(isProjectInTabulatedDate);

  const tabulatedSummary = React.useMemo(() => {
    let totalSales = 0;
    let totalCOGS = 0;
    let totalCommissions = 0;

    tabulatedProjects.forEach(p => {
      const rev = p.items.filter(i => i.category === 'revenue').reduce((s, i) => s + (i.amount || 0), 0);
      const cogs = p.items.filter(i => i.category === 'cogs').reduce((s, i) => s + (i.amount || 0), 0);
      const comm = p.items.filter(i => i.category === 'commission').reduce((s, i) => {
        if (typeof i.ratePct === 'number' && i.ratePct > 0) {
          return s + (rev * (i.ratePct / 100));
        }
        return s + (i.amount || 0);
      }, 0);

      totalSales += rev;
      totalCOGS += cogs;
      totalCommissions += comm;
    });

    const totalGP = totalSales - totalCOGS - totalCommissions;
    const gpMargin = totalSales > 0 ? (totalGP / totalSales) * 100 : 0;

    return {
      count: tabulatedProjects.length,
      totalSales,
      totalCOGS,
      totalCommissions,
      totalGP,
      gpMargin
    };
  }, [tabulatedProjects]);

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
        return JSON.parse(saved);
      } catch {
        return [];
      }
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

  // Read-only live sync of the shared Client Database, used to power the
  // "search existing client or type a new one" picker on the Pipeline form.
  const [clientDirectory, setClientDirectory] = useState<Client[]>([]);
  useEffect(() => {
    if (!db) return;
    const q = query(collection(db, 'clients'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: Client[] = [];
      snapshot.forEach((docSnap) => {
        list.push({ ...(docSnap.data() as Client), id: docSnap.id });
      });
      setClientDirectory(list);
    });
    return () => unsubscribe();
  }, []);

  // Read-only live sync of Quotations and Course Outlines, so a Won pipeline deal
  // can show whether a quotation/outline already exists for it, and its ref number,
  // instead of the rep having to hunt for it or retype it from scratch.
  const [quotationsForPipelines, setQuotationsForPipelines] = useState<any[]>([]);
  const [outlinesForPipelines, setOutlinesForPipelines] = useState<any[]>([]);
  useEffect(() => {
    if (!db) return;
    const unsubQ = onSnapshot(query(collection(db, 'quotations')), (snap) => {
      const list: any[] = [];
      snap.forEach(d => list.push({ ...d.data(), id: d.id }));
      setQuotationsForPipelines(list);
    });
    const unsubO = onSnapshot(query(collection(db, 'course_outlines')), (snap) => {
      const list: any[] = [];
      snap.forEach(d => list.push({ ...d.data(), id: d.id }));
      setOutlinesForPipelines(list);
    });
    return () => {
      unsubQ();
      unsubO();
    };
  }, []);

  // Creates a bare-bones draft Quotation directly linked to this Won pipeline deal,
  // then switches to the Quotation tab so the rep can flesh it out.
  // The course line's training date is pre-filled from the pipeline's Training Date
  // (falls back to the older `potentialDate` field, then blank, so old records never break).
  const handleCreateQuotationForPipeline = async (p: any) => {
    const newId = `q_${Date.now()}`;
    const linkedClient = clientDirectory.find(c => c.id === p.clientId);
    const cleanQuote = {
      id: newId,
      refNumber: `1G/NA/${new Date().getFullYear()}${(new Date().getMonth()+1).toString().padStart(2,'0')}${new Date().getDate().toString().padStart(2,'0')}/${(quotationsForPipelines.length + 1).toString().padStart(2, '0')}`,
      date: new Date().toISOString().substring(0, 10),
      attn: linkedClient?.contactName && linkedClient.contactName !== 'N/A' ? linkedClient.contactName : '',
      company: p.client || '',
      address: linkedClient?.address || '',
      venue: '',
      time: '',
      participants: '',
      trainingProvider: '',
      items: p.courseName ? [{
        id: `item_${Date.now()}`,
        no: 1,
        program: p.courseName,
        code: '',
        date: formatTrainingDate(p.trainingDate || p.potentialDate),
        trainer: '',
        feePerDay: p.proposalValue || 0,
        days: 1,
        totalFee: p.proposalValue || 0,
      }] : [],
      remarks: [],
      terms: [],
      preparedBy: rep.name,
      creatorId: rep.id,
      ownerId: rep.id,
      ownerName: rep.name,
      clientId: p.clientId || '',
      pipelineId: p.id,
    };
    try {
      await setDoc(doc(db, 'quotations', newId), cleanQuote);
      setActiveSubTab('quotation');
    } catch (err) {
      console.error('Create quotation for pipeline failed:', err);
    }
  };

  // Creates a bare-bones draft Course Outline directly linked to this Won pipeline deal,
  // then switches to the Course Outline tab so the rep can flesh it out.
  const handleCreateOutlineForPipeline = async (p: any) => {
    const newId = `outline_${Date.now()}`;
    const newObj = {
      id: newId,
      refNumber: `CO-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
      date: new Date().toISOString().substring(0, 10),
      courseTitle: p.courseName || 'New Professional Course Outline',
      durationDays: 1,
      totalHours: 7,
      category: 'Software Engineering',
      level: 'Intermediate',
      audience: 'Working professionals seeking technical skills.',
      prerequisites: 'Basic knowledge of the course topic.',
      overview: 'Provide a brief summary detailing the key learning journeys, industry relevances, and targeted skill upgrades here.',
      outcomes: ['List learning outcome #1 here'],
      items: [{
        id: `module_1_${Date.now()}`,
        no: 1,
        moduleTitle: 'Module 1: Foundations',
        topics: '• Key Concept 1\n• Hands-on Project Part A',
        duration: '3 Hours',
        methodology: 'Hands-on training'
      }],
      preparedBy: rep.name,
      creatorId: rep.id,
      ownerId: rep.id,
      ownerName: rep.name,
      preparedForCompany: p.client || '',
      clientId: p.clientId || '',
      pipelineId: p.id
    };
    try {
      await setDoc(doc(db, 'course_outlines', newId), newObj);
      setActiveSubTab('course_outline');
    } catch (err) {
      console.error('Create course outline for pipeline failed:', err);
    }
  };

  // Real-time Firestore sync for pipelines
  useEffect(() => {
    if (!db) return;

    const q = query(collection(db, 'pipelines'));
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const firestorePipes: any[] = [];
      snapshot.forEach((docSnap) => {
        firestorePipes.push({ ...docSnap.data(), id: docSnap.id });
      });

      if (firestorePipes.length > 0) {
        // Sort descending by id to show newest first
        firestorePipes.sort((a, b) => b.id.localeCompare(a.id));
        setPipelines(firestorePipes);
        localStorage.setItem('next_pipelines_shared', JSON.stringify(firestorePipes));
        
        // Sync back to individual keys
        const repIds = ['xin-ying', 'chee-cai', 'alif', 'atiqa', 'new-guy'];
        repIds.forEach(id => {
          const ownedPipes = firestorePipes.filter(p => p.ownerId === id || p.creatorId === id || p.taggedRepIds?.includes(id));
          localStorage.setItem(`next_pipelines_${id}`, JSON.stringify(ownedPipes));
        });
      } else {
        // Firestore genuinely has no pipelines (either none created yet, or all deleted).
        // Reflect that truthfully instead of re-uploading stale localStorage data,
        // which would silently resurrect deleted items on every refresh.
        setPipelines([]);
        localStorage.setItem('next_pipelines_shared', JSON.stringify([]));
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
        if (!firestoreLinks.pAndL) {
          firestoreLinks.pAndL = DEFAULT_PL_REFERENCE_URL;
        }
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
          pAndL: DEFAULT_PL_REFERENCE_URL
        };
        if (storedLinks) {
          try {
            parsedLinks = JSON.parse(storedLinks);
            if (!parsedLinks.pAndL) parsedLinks.pAndL = DEFAULT_PL_REFERENCE_URL;
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
        // Firestore genuinely has no payments (either none created yet, or all deleted).
        // Reflect that truthfully instead of re-uploading stale localStorage data,
        // which would silently resurrect deleted payment vouchers.
        setPayments([]);
        localStorage.setItem('next_payments_shared', JSON.stringify([]));
      }
    });

    return () => unsubscribe();
  }, []);



  // Sync pipelines and reset pipeline forms when representative changes
  useEffect(() => {
    // Keep local form values reset cleanly
    setPipeClient('');
    setPipeCourseName('');
    setPipeRequestDate(new Date().toISOString().substring(0, 10));
    setPipeTrainingDate('');
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
  const [pipeClientId, setPipeClientId] = useState<string>('');
  const [pipeCourseName, setPipeCourseName] = useState('');
  const [pipeRequestDate, setPipeRequestDate] = useState(new Date().toISOString().substring(0, 10));
  const [pipeTrainingDate, setPipeTrainingDate] = useState('');
  const [pipeType, setPipeType] = useState<'Training' | 'Teambuilding'>('Training');
  const [pipeProposalSentDate, setPipeProposalSentDate] = useState(new Date().toISOString().substring(0, 10));
  const [pipeProposalValue, setPipeProposalValue] = useState('');
  const [pipeFollowUpDate, setPipeFollowUpDate] = useState('');
  const [pipeStatus, setPipeStatus] = useState<'Pending' | 'Won' | 'Lost'>('Pending');
  const [pipeOwnerId, setPipeOwnerId] = useState<string>(rep.id);
  const [editingPipeId, setEditingPipeId] = useState<string | null>(null);
  const [pipelineSortBy, setPipelineSortBy] = useState<'latest' | 'oldest' | 'pending' | 'won' | 'lost'>('latest');
  const [pipelineSearchQuery, setPipelineSearchQuery] = useState('');
  const [pipelinePageSize, setPipelinePageSize] = useState<10 | 20 | 30>(10);
  const [pipelineCurrentPage, setPipelineCurrentPage] = useState(1);
  const [pipeTaggedRepIds, setPipeTaggedRepIds] = useState<string[]>([]);
  const [pipeTagNote, setPipeTagNote] = useState<string>('');
  const [pipeNotes, setPipeNotes] = useState<string>('');
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [pipeProposalNotSentYet, setPipeProposalNotSentYet] = useState(false);
  const [pipeAppointmentTicked, setPipeAppointmentTicked] = useState(false);

  // Does the currently typed client name match an existing Client Database record?
  const matchedPipeClient = clientDirectory.find(
    c => c.companyName.trim().toLowerCase() === pipeClient.trim().toLowerCase()
  );

  // Quietly keep pipeClientId in sync whenever the typed name matches an existing client,
  // and clear it when the rep types something that no longer matches (e.g. a new one-off name).
  useEffect(() => {
    if (matchedPipeClient) {
      setPipeClientId(matchedPipeClient.id);
    } else {
      setPipeClientId('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipeClient, clientDirectory]);

  // Lets a rep save a freshly-typed, not-yet-in-the-database client name directly
  // into the shared Client Database without leaving the Pipeline form.
  const handleQuickAddClientFromPipeline = async () => {
    if (!pipeClient.trim()) return;
    const newClient: Client = {
      id: `client_${Date.now()}`,
      companyName: pipeClient.trim(),
      contactName: 'N/A',
      createdAt: Date.now(),
      createdBy: rep.id,
      createdByName: rep.name,
    };
    try {
      if (db) {
        await setDoc(doc(db, 'clients', newClient.id), newClient);
      }
      setPipeClientId(newClient.id);
    } catch (err) {
      console.error('Quick-add client failed:', err);
    }
  };

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
            clientId: pipeClientId || '',
            courseName: pipeCourseName,
            requestDate: pipeRequestDate,
            trainingDate: pipeTrainingDate || '',
            type: pipeType,
            proposalSentDate: sentDate,
            proposalValue: valAmount,
            followUpDate: pipeFollowUpDate || 'TBD',
            status: pipeStatus,
            ownerId: pipeOwnerId,
            ownerName: ownerObj.name,
            taggedRepIds: pipeTaggedRepIds,
            tagNote: pipeTagNote.trim(),
            notes: pipeNotes.trim(),
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
        clientId: pipeClientId || '',
        courseName: pipeCourseName,
        requestDate: pipeRequestDate,
        trainingDate: pipeTrainingDate || '',
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
        tagNote: pipeTagNote.trim(),
        notes: pipeNotes.trim(),
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

    // Two-way tie between the Pipeline "Appointment Scheduled" checkbox and the
    // Appointments log: only fire on the false->true transition (not on every
    // edit while already ticked), using a deterministic doc id so re-saving is
    // idempotent and doesn't create duplicates.
    const wasTickedBefore = editingPipeId ? (oldPipe?.appointmentTicked || false) : false;
    if (pipeAppointmentTicked && !wasTickedBefore) {
      const linkedAppt = {
        id: `appt_pipe_${newPipe.id}`,
        clientName: newPipe.client,
        clientId: newPipe.clientId || '',
        pipelineId: newPipe.id,
        repId: newPipe.ownerId,
        repName: newPipe.ownerName,
        date: new Date().toISOString().substring(0, 10),
        time: '',
        type: 'Follow-up',
        status: 'Completed',
        notes: 'Auto-logged from Pipeline "Appointment Scheduled" checkbox.',
        createdAt: Date.now(),
        createdBy: rep.id,
        createdByName: rep.name,
      };
      try {
        await setDoc(doc(db, 'appointments', linkedAppt.id), linkedAppt);
      } catch (err) {
        console.error('Auto-create linked appointment failed:', err);
      }
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
    setPipeTrainingDate('');
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

  // Pending Tasks States
  const [tasks, setTasks] = useState<any[]>([]);
  const [taskDetail, setTaskDetail] = useState('');
  const [taskDateline, setTaskDateline] = useState('');
  const [taskAssignedToId, setTaskAssignedToId] = useState('');
  const [taskSortBy, setTaskSortBy] = useState<'dateCreated' | 'dateline'>('dateCreated');
  const [taskHideDone, setTaskHideDone] = useState(false);
  const [previousTasks, setPreviousTasks] = useState<any[] | null>(null);
  const [taskUndoMessage, setTaskUndoMessage] = useState<string | null>(null);
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(new Set());

  const toggleTaskExpanded = (taskId: string) => {
    setExpandedTaskIds(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId); else next.add(taskId);
      return next;
    });
  };

  // Parses freeform task notes that follow a "Label: value - Label: value" pattern
  // (common for quotation/booking requests) into a clean summary + structured fields.
  // Falls back gracefully to plain text when the note doesn't match that shape.
  const parseTaskDetail = (detail: string): { summary: string; fields: { label: string; value: string }[] } => {
    if (!detail) return { summary: '', fields: [] };

    const segments = detail.split(/\s*-\s+(?=[A-Za-z][A-Za-z\s./]{2,30}:)/g).map(s => s.trim()).filter(Boolean);

    if (segments.length < 2) {
      return { summary: detail, fields: [] };
    }

    const fields: { label: string; value: string }[] = [];
    let summary = segments[0];

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const match = seg.match(/^([A-Za-z][A-Za-z\s./]{2,30}):\s*(.+)$/s);
      if (match) {
        fields.push({ label: match[1].trim(), value: match[2].trim() });
      } else if (i === 0) {
        summary = seg;
      }
    }

    if (fields.length < 2) {
      return { summary: detail, fields: [] };
    }

    return { summary, fields };
  };

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
        // Firestore genuinely has no tasks for this rep (either none created yet,
        // or all deleted). Reflect that truthfully instead of re-uploading stale
        // localStorage data, which would silently resurrect deleted tasks.
        setTasks([]);
        localStorage.setItem(`next_tasks_${rep.id}`, JSON.stringify([]));
      }
    });

    return () => unsubscribe();
  }, [rep.id]);

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

            <button 
              onClick={() => handleSubTabChange('appointments')}
              className={`w-full text-left p-3.5 rounded-lg text-xs font-black uppercase tracking-wider border transition-all ${
                activeSubTab === 'appointments' 
                  ? 'bg-slate-100 border-slate-300 text-slate-800 font-extrabold shadow-2xs' 
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              📅 Appointments
            </button>

            <button 
              onClick={() => handleSubTabChange('client_payments')}
              className={`w-full text-left p-3.5 rounded-lg text-xs font-black uppercase tracking-wider border transition-all ${
                activeSubTab === 'client_payments' 
                  ? 'bg-green-50 border-green-300 text-green-700 font-extrabold shadow-2xs' 
                  : 'bg-white border-slate-200 text-green-700 hover:bg-green-50 hover:border-green-200'
              }`}
            >
              💰 Client Payments
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
          ) : activeSubTab === 'client' ? (
            <ClientManager key={rep.id} rep={rep} reps={reps} requestManagerPermission={requestManagerPermission} />
          ) : activeSubTab === 'trainerList' ? (
            <TrainerManager key={rep.id} rep={rep} reps={reps} requestManagerPermission={requestManagerPermission} />
          ) : activeSubTab === 'venue' ? (
            <VenueManager key={rep.id} rep={rep} reps={reps} requestManagerPermission={requestManagerPermission} />
          ) : activeSubTab === 'appointments' ? (
            <AppointmentManager key={rep.id} rep={rep} reps={reps} requestManagerPermission={requestManagerPermission} />
          ) : activeSubTab === 'client_payments' ? (
            <ClientPaymentManager key={rep.id} rep={rep} reps={reps} requestManagerPermission={requestManagerPermission} />
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
                    <button 
                      type="button"
                      onClick={() => setShowCommissionModal(true)}
                      className="text-xs bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-750 font-black px-3.5 py-1.5 rounded transition-all flex items-center gap-1 shadow-2xs cursor-pointer"
                      title="Key in weekly commission, closed sales & pipeline metrics"
                    >
                      <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
                      {rep.id === 'atiqa' ? 'Log KPI Values' : '$ Key In Commission / Sales'}
                    </button>

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
