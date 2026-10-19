import React, { useState, useEffect } from 'react';
import { Representative, GoogleLinks, Client } from '../types';
import { getRepMetrics } from '../initialData';
import { countAuto, autoValueFor, salesIsFromDeals } from '../lib/kpi';
import { ArrowLeft, Save, Link2, Plus, Calendar, DollarSign, Calculator, Percent, Sparkles, Clock, FileText, Trash2, Briefcase, TrendingUp, CheckCircle, XCircle, AlertCircle, Users, MapPin, Building2, GraduationCap, Eye, EyeOff, Tag, RotateCcw, Lock, Shield, History, MessageSquare, Send, CornerDownRight, Check, Printer, Download, RefreshCw, FileSpreadsheet, ChevronDown, ChevronUp, PieChart, Edit3, CheckSquare, Square, FolderCheck, Search, Layers, CheckCheck } from 'lucide-react';
import QuotationsPage from './QuotationsPage';
import CourseOutlinesPage from './CourseOutlinesPage';
import TasksPage from './TasksPage';
import { needsDoingNow } from '../lib/tasks';
import ClientManager from './ClientManager';
import TrainerManager from './TrainerManager';
import VenueManager from './VenueManager';
import KpiPage, { asksFor } from './KpiPage';
import WorkspaceMenu, { MENU_LABELS, MenuItem } from './WorkspaceMenu';
import { SharedKind, useSharedInbox } from '../lib/sharedInbox';
import DealsBoard from './DealsBoard';
import { buildQuotationForDeal } from '../lib/dealDocs';
import { dealNeedsAttention, dealOwnerId, todayIso } from '../lib/deals';
import { collection, query, where, onSnapshot, doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db, friendlyError } from '../lib/firebase';
import { linkedOnly } from '../lib/linked';

interface RepDetailDashboardProps {
  rep: Representative;
  reps: Representative[];
  onBack: () => void;
  onUpdateRepKpi: (repId: string, updatedKpi: Representative['kpi']) => void;
  selectedMonth: string;
  onMonthChange: (month: string) => void;
  viewer?: { id: string; name: string; role: 'rep' | 'admin' | 'management' };
  onOpenAdminWork?: () => void;     // Admin's menu links to Admin work (it replaced the old Admin records screen)
  openFile?: { kind: SharedKind; id: string } | null;   // My home's "Shared with me": open this file in the editor
  onOpenFileHandled?: () => void;
  openClientId?: string | null;     // My home's "My follow-ups": open this client's page
  onOpenClientHandled?: () => void;
  openDealId?: string | null;       // Management → Team follow-ups: open this deal's panel
  onOpenDealHandled?: () => void;
}

type SubTab = 'quotation' | 'kpi' | 'client' | 'faci' | 'trainerList' | 'venue' | 'tasks' | 'pl' | 'payment' | 'pipeline' | 'course_outline' | 'admin_record' | 'appointments' | 'client_payments';


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
  selectedMonth,
  onMonthChange,
  viewer,
  onOpenAdminWork,
  openFile,
  onOpenFileHandled,
  openClientId,
  onOpenClientHandled,
  openDealId,
  onOpenDealHandled
}: RepDetailDashboardProps) {
  // The old payment, P&L, appointment and Admin records screens were retired; anyone left on them,
  // however they got there, lands on Deals.
  const RETIRED_TABS: SubTab[] = ['payment', 'client_payments', 'pl', 'appointments', 'admin_record'];
  const savedSubTab = (): SubTab => {
    const saved = localStorage.getItem(`next_active_subtab_${rep.id}`) as SubTab | null;
    return saved && RETIRED_TABS.includes(saved) ? 'pipeline' : saved || 'kpi';
  };
  const [chosenSubTab, setActiveSubTab] = useState<SubTab>(savedSubTab);
  const activeSubTab: SubTab = RETIRED_TABS.includes(chosenSubTab) ? 'pipeline' : chosenSubTab;
  const [subTabHistory, setSubTabHistory] = useState<SubTab[]>(() => [savedSubTab()]);

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
  // Quick key-in for the KPIs that are typed in (automatic ones come from deals).
  const [commissionValues, setCommissionValues] = useState<Record<string, string>>({});
  const manualMetrics = getRepMetrics(rep).filter(m => !m.auto);

  const handleCommissionSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const updatedKpi = JSON.parse(JSON.stringify(rep.kpi));
    manualMetrics.forEach(m => {
      let val = parseFloat(commissionValues[m.key] || '') || 0;
      if (/rating/i.test(m.label)) val = Math.max(0, Math.min(5, val));
      if (!Array.isArray(updatedKpi[m.key])) updatedKpi[m.key] = [0, 0, 0, 0, 0];
      if (val) updatedKpi[m.key][selectedWeek] = (updatedKpi[m.key][selectedWeek] || 0) + val;
    });
    onUpdateRepKpi(rep.id, updatedKpi);
    setEditKpi(updatedKpi);
    setShowCommissionModal(false);
    setCommissionValues({});
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
    const repIds = reps.map(r => r.id);
    repIds.forEach(id => {
      let repPipes: any[] = [];
      const localSaved = localStorage.getItem(`next_pipelines_${id}`);
      if (localSaved) {
        try { repPipes = JSON.parse(localSaved); } catch { repPipes = []; }
      } else {
        repPipes = []; // no sample data: only real deals from the database
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
      setQuotationsForPipelines(linkedOnly(list));
    });
    const unsubO = onSnapshot(query(collection(db, 'course_outlines')), (snap) => {
      const list: any[] = [];
      snap.forEach(d => list.push({ ...d.data(), id: d.id }));
      setOutlinesForPipelines(linkedOnly(list));
    });
    return () => {
      unsubQ();
      unsubO();
    };
  }, []);

  // Keep the rep inside the deal (Joel, 2026-10-18): "Create quotation" opens the deal's quotation straight in
  // the editor. If the deal already has a draft it opens that one, so clicking twice never makes a duplicate;
  // otherwise a draft linked to the deal is saved and opened. The editor's "Back to deal" (and closing the
  // "Sent" box) comes back to Deals with this deal's panel open.
  const [quoteFromDeal, setQuoteFromDeal] = useState<{ dealId: string; quoteId: string } | null>(null);
  const [dealToOpen, setDealToOpen] = useState<string | null>(null);
  const openQuoteFromDeal = (dealId: string, quoteId: string) => {
    setQuoteFromDeal({ dealId, quoteId });
    setActiveSubTab('quotation');
  };
  const handleCreateQuotationForPipeline = async (p: any) => {
    const drafts = quotationsForPipelines
      .filter(q => q.pipelineId === p.id && q.status !== 'sent')
      .sort((a, b) => String(b.date || b.id).localeCompare(String(a.date || a.id)));
    if (drafts.length) return openQuoteFromDeal(p.id, drafts[0].id);
    const linkedClient = clientDirectory.find(c => c.id === p.clientId);
    const ownerId = p.ownerId || p.creatorId || rep.id;
    const owner = { id: ownerId, name: reps.find(r => r.id === ownerId)?.name || p.ownerName || rep.name };
    const me = viewer ? { id: viewer.id, name: viewer.name } : { id: rep.id, name: rep.name };
    const cleanQuote: any = buildQuotationForDeal(p, me, owner, linkedClient, quotationsForPipelines.length);
    // Same reference numbering as "New quotation": the next free number for today.
    const prefix = cleanQuote.refNumber.slice(0, cleanQuote.refNumber.lastIndexOf('/') + 1);
    const used = quotationsForPipelines.map(q => String(q.refNumber || '')).filter(r => r.startsWith(prefix)).map(r => parseInt(r.slice(prefix.length), 10) || 0);
    cleanQuote.refNumber = `${prefix}${String((used.length ? Math.max(...used) : 0) + 1).padStart(2, '0')}`;
    try {
      await setDoc(doc(db, 'quotations', cleanQuote.id), cleanQuote);
      openQuoteFromDeal(p.id, cleanQuote.id);
    } catch (err) {
      console.error('Create quotation for pipeline failed:', err);
      window.alert(`The quotation couldn't be created: ${friendlyError(err)}`);
    }
  };

  // "Create outline" on a deal: open Course outlines at "Start from" for that deal (nothing is saved until Save).
  const [outlineStartDeal, setOutlineStartDeal] = useState<any | null>(null);
  // "Shared with me" (2026-10-18): a file opened from My home, and which list starts on "Shared with me".
  const [outlineToOpen, setOutlineToOpen] = useState<string | null>(null);
  const [sharedFirst, setSharedFirst] = useState<SubTab | null>(null);
  useEffect(() => {
    if (!openFile) return;
    if (openFile.kind === 'quotation') { setQuoteFromDeal({ dealId: '', quoteId: openFile.id }); handleSubTabChange('quotation'); }
    else { setOutlineToOpen(openFile.id); handleSubTabChange('course_outline'); }
    onOpenFileHandled?.();
  }, [openFile]);
  // Client history (2026-10-18): the client page opens deals, files and To-dos; To-do tags open the client page.
  const [clientToOpen, setClientToOpen] = useState<string | null>(null);
  const [taskToOpen, setTaskToOpen] = useState<string | null>(null);
  useEffect(() => {
    if (!openClientId) return;
    setClientToOpen(openClientId);
    handleSubTabChange('client');
    onOpenClientHandled?.();
  }, [openClientId]);
  useEffect(() => {
    if (!openDealId) return;
    setDealToOpen(openDealId);
    handleSubTabChange('pipeline');
    onOpenDealHandled?.();
  }, [openDealId]);
  // Outlines opened from a deal (2026-10-19) get "Back to deal", like quotations. If the deal already has a
  // draft outline, "Create outline" opens that one instead of making a second.
  const [outlineFromDeal, setOutlineFromDeal] = useState<string | null>(null);
  const handleCreateOutlineForPipeline = (p: any) => {
    setOutlineStartDeal(p);
    setOutlineFromDeal(p.id);
    setActiveSubTab("course_outline");
  };
  const openOutlineFromDeal = (p: any, outlineId: string) => {
    setOutlineToOpen(outlineId);
    setOutlineFromDeal(p.id);
    setActiveSubTab('course_outline');
  };

  // Real-time Firestore sync for pipelines
  useEffect(() => {
    if (!db) return;

    const q = query(collection(db, 'pipelines'));
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const firestorePipes: any[] = [];
      snapshot.forEach((docSnap) => {
        const p = { ...docSnap.data(), id: docSnap.id };
        if (linkedOnly([p]).length) firestorePipes.push(p);
      });

      if (firestorePipes.length > 0) {
        // Sort descending by id to show newest first
        firestorePipes.sort((a, b) => b.id.localeCompare(a.id));
        setPipelines(firestorePipes);
        localStorage.setItem('next_pipelines_shared', JSON.stringify(firestorePipes));
        
        // Sync back to individual keys
        const repIds = reps.map(r => r.id);
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
    const repIds = reps.map(r => r.id);
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
    const targetRepName = reps.find(r => r.id === targetRepId)?.name || targetRepId;

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

    // All tasks: the menu dot looks for ones assigned to this person (see lib/tasks.ts).
    const q = query(collection(db, 'tasks'));
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

  // Automatic KPIs, counted from deals owned by this person.
  // Sales count in the week/month the deal was WON.
  const getPipelineSalesForWeek = (weekIdx: number): number => {
    return salesIsFromDeals(rep) ? countAuto('won', pipelines, rep.id, selectedMonth, weekIdx) : 0;
  };
  const getPipelineProposalsForWeek = (weekIdx: number): number => countAuto('proposals', pipelines, rep.id, selectedMonth, weekIdx);
  const getPipelineAppointmentsForWeek = (weekIdx: number): number => countAuto('appointments', pipelines, rep.id, selectedMonth, weekIdx);
  const getPipelineMetricForWeek = (key: string, weekIdx: number): number => {
    if (key === 'salesFigure') return getPipelineSalesForWeek(weekIdx);
    return autoValueFor(rep, key as any, pipelines, selectedMonth, weekIdx);
  };
  const isRatingMetric = (key: string) => /rating/i.test(metricsList.find(m => m.key === key)?.label || '');

  // Get totals
  const totalSalesFromPipeline = [0, 1, 2, 3, 4].reduce((sum, wk) => sum + getPipelineSalesForWeek(wk), 0);
  const totalSales = sumArray(rep.kpi?.salesFigure ?? []) + totalSalesFromPipeline;
  
  const totalProposalsFromPipeline = [0, 1, 2, 3, 4].reduce((sum, wk) => sum + getPipelineMetricForWeek('proposals', wk), 0);
  const totalProposals = sumArray(rep.kpi?.proposals ?? []) + totalProposalsFromPipeline;
  
  const totalPreviewFromPipeline = [0, 1, 2, 3, 4].reduce((sum, wk) => sum + getPipelineMetricForWeek('preview', wk), 0);
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
    if (isRatingMetric(metric as string)) {
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
  const kpiAsksOpen = asksFor(rep, reps).filter(a => !a.done).length;
  // Same as the Deals screen: only this person's own deals, or a teammate's deal they've been asked to help on.
  const dealsAlert = pipelines.some(p => dealOwnerId(p) === rep.id && dealNeedsAttention(p)) ? 'Deal needs attention'
    : pipelines.some(p => dealOwnerId(p) !== rep.id && p.taggedRepIds?.includes(rep.id) && !p.completedTags?.includes(rep.id)) ? 'Help asked' : undefined;
  // Files shared with this person that they haven't opened (only in their own workspace: the alerts are theirs).
  const inbox = useSharedInbox(viewer && viewer.id !== rep.id ? undefined : rep.id);
  const workspaceMenuItems: MenuItem[] = [
    { key: 'kpi', label: MENU_LABELS.kpi, alert: kpiAsksOpen ? `${kpiAsksOpen} teammate request${kpiAsksOpen === 1 ? '' : 's'}` : undefined },
    { key: 'pipeline', label: MENU_LABELS.pipeline, alert: dealsAlert },
    { key: 'quotation', label: MENU_LABELS.quotation, count: inbox.quotations,
      alert: inbox.quotations ? `${inbox.quotations} shared with you` : hasTaggedQuotations ? 'Tagged quotation' : undefined },
    { key: 'course_outline', label: MENU_LABELS.course_outline, count: inbox.outlines,
      alert: inbox.outlines ? `${inbox.outlines} shared with you` : hasTaggedCourseOutlines ? 'Tagged outline' : undefined },
    { key: 'client', label: MENU_LABELS.client },
    { key: 'trainerList', label: MENU_LABELS.trainerList },
    { key: 'venue', label: MENU_LABELS.venue },
    ...((rep.role === 'admin' || rep.role === 'management') && onOpenAdminWork ? [{ key: 'admin_work' as const, label: MENU_LABELS.admin_work }] : []),
    { key: 'tasks', label: MENU_LABELS.tasks, alert: tasks.some(t => needsDoingNow(t, rep.id, todayIso())) ? 'Task due' : undefined },
  ];

  const getSectionTitle = () => {
    if (activeSubTab === 'kpi') return rep.name;
    if (activeSubTab === 'quotation') return 'QUOTATION';
    if (activeSubTab === 'client') return 'CLIENT DATA';
    if (activeSubTab === 'faci') return 'FACI';
    if (activeSubTab === 'trainerList') return 'TRAINER LIST';
    if (activeSubTab === 'venue') return 'VENUE';
    if (activeSubTab === 'tasks') return 'PENDING TASKS';
    if (activeSubTab === 'pl') return 'P&L';
    if (activeSubTab === 'pipeline') return 'PIPELINE';
    if (activeSubTab === 'course_outline') return 'COURSE OUTLINE';
    if (activeSubTab === 'admin_record') return 'ADMINISTRATIVE RECORDS';
    return rep.name;
  };

  return (
    <div className="space-y-6">
      
      {/* Menu (collapsible) and the active page */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <WorkspaceMenu active={activeSubTab} items={workspaceMenuItems}
          onSelect={(k) => {
            if (k === 'admin_work') return onOpenAdminWork?.();
            // A red count on Quotations / Course outlines: open the list on "Shared with me".
            setSharedFirst((k === 'quotation' && inbox.quotations) || (k === 'course_outline' && inbox.outlines) ? k : null);
            handleSubTabChange(k as SubTab);
          }} prefsId={viewer?.id || rep.id}
          ownerLabel={viewer && viewer.id !== rep.id ? `${rep.name}'s workspace` : undefined} />

        {/* Right Side: Active Workspace Section */}
        <div className="min-w-0 flex-1 space-y-5">
          
          {activeSubTab === 'quotation' ? (
            <QuotationsPage key={`${rep.id}-${sharedFirst === 'quotation'}`} rep={rep} reps={reps} viewer={viewer} onOpenTab={(t) => handleSubTabChange(t as SubTab)} startOnShared={sharedFirst === 'quotation'}
              openFromDeal={quoteFromDeal} onOpenFromDealHandled={() => setQuoteFromDeal(null)}
              onBackToDeal={(dealId) => { setDealToOpen(dealId); setActiveSubTab('pipeline'); }} />
          ) : activeSubTab === 'course_outline' ? (
            <CourseOutlinesPage key={`${rep.id}-${sharedFirst === 'course_outline'}`} rep={rep} reps={reps} viewer={viewer} startDeal={outlineStartDeal} onStartHandled={() => { setOutlineStartDeal(null); setOutlineFromDeal(null); }} onOpenTab={(t) => handleSubTabChange(t as SubTab)}
              openId={outlineToOpen} onOpenHandled={() => { setOutlineToOpen(null); setOutlineFromDeal(null); }} startOnShared={sharedFirst === 'course_outline'}
              fromDealId={outlineFromDeal} onBackToDeal={(dealId) => { setDealToOpen(dealId); setActiveSubTab('pipeline'); }} />
          ) : activeSubTab === 'client' ? (
            <ClientManager key={rep.id} rep={rep} reps={reps} viewer={viewer || { id: rep.id, name: rep.name, role: 'rep' }}
              openClientId={clientToOpen} onOpenClientHandled={() => setClientToOpen(null)}
              onOpenDeal={(id) => { setDealToOpen(id); setActiveSubTab('pipeline'); }}
              onOpenQuotation={(id) => { setQuoteFromDeal({ dealId: '', quoteId: id }); setActiveSubTab('quotation'); }}
              onOpenOutline={(id) => { setOutlineToOpen(id); setActiveSubTab('course_outline'); }}
              onOpenTask={(id) => { setTaskToOpen(id); setActiveSubTab('tasks'); }} />
          ) : activeSubTab === 'trainerList' ? (
            <TrainerManager key={rep.id} rep={rep} reps={reps} viewer={viewer || { id: rep.id, name: rep.name, role: 'rep' }} />
          ) : activeSubTab === 'venue' ? (
            <VenueManager key={rep.id} rep={rep} reps={reps} viewer={viewer || { id: rep.id, name: rep.name, role: 'rep' }} />
          ) : activeSubTab === 'kpi' ? (
            <KpiPage rep={rep} reps={reps} viewer={viewer} selectedMonth={selectedMonth} onMonthChange={onMonthChange} onUpdateRepKpi={onUpdateRepKpi} />
          ) : activeSubTab === 'pipeline' ? (
            <DealsBoard
              owner={rep}
              people={reps}
              viewer={viewer || { id: rep.id, name: rep.name, role: 'rep' }}
              onCreateQuotation={handleCreateQuotationForPipeline}
              onOpenQuotation={(p, quoteId) => openQuoteFromDeal(p.id, quoteId)}
              openDealId={dealToOpen}
              onOpenDealHandled={() => setDealToOpen(null)}
              onCreateOutline={handleCreateOutlineForPipeline}
              onOpenOutline={openOutlineFromDeal}
              onOpenQuotations={() => setActiveSubTab('quotation')}
              onOpenOutlines={() => setActiveSubTab('course_outline')}
            />
          ) : activeSubTab === 'tasks' ? (
            <TasksPage key={rep.id} rep={rep} reps={reps} viewer={viewer} onOpenDeals={() => handleSubTabChange('pipeline')}
              openTaskId={taskToOpen} onOpenTaskHandled={() => setTaskToOpen(null)}
              onOpenClient={(id) => { setClientToOpen(id); setActiveSubTab('client'); }} />
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

      {/* Quick KPI key-in */}
      {showCommissionModal && (
        <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-xl border border-line space-y-4 font-sans text-ink">
            <h3 className="text-lg font-bold">Key in weekly KPIs</h3>
            {manualMetrics.length === 0 ? (
              <>
                <p className="text-[15px] leading-relaxed text-ink-soft">
                  All of {rep.name}'s KPIs are counted automatically from deals, so there's nothing to key in. Move deals through their stages on the Deals screen instead.
                </p>
                <div className="flex justify-end">
                  <button type="button" onClick={() => setShowCommissionModal(false)} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold hover:bg-surface">Close</button>
                </div>
              </>
            ) : (
              <form onSubmit={handleCommissionSubmit} className="space-y-4">
                <div>
                  <label htmlFor="kpi-week" className="mb-1.5 block text-sm font-semibold">Week</label>
                  <select id="kpi-week" value={selectedWeek} onChange={(e) => setSelectedWeek(parseInt(e.target.value))} className="w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] focus:border-accent focus:outline-none">
                    {[0, 1, 2, 3, 4].map(w => <option key={w} value={w}>Week {w + 1}</option>)}
                  </select>
                </div>
                {manualMetrics.map(m => (
                  <div key={m.key}>
                    <label htmlFor={`kpi-${m.key}`} className="mb-1.5 block text-sm font-semibold">
                      {m.label} <span className="font-normal text-ink-soft">(add to this week)</span>
                    </label>
                    <input
                      id={`kpi-${m.key}`}
                      type="number"
                      min={0}
                      max={/rating/i.test(m.label) ? 5 : undefined}
                      value={commissionValues[m.key] || ''}
                      onChange={(e) => setCommissionValues(v => ({ ...v, [m.key]: e.target.value }))}
                      className="w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] focus:border-accent focus:outline-none"
                      placeholder="0"
                    />
                  </div>
                ))}
                <p className="text-sm text-ink-soft">Closing RM, appointments, proposals and previews are counted from deals, so they aren't keyed in here.</p>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setShowCommissionModal(false)} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold hover:bg-surface">Cancel</button>
                  <button type="submit" className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-[#0B5A50]">Save KPIs</button>
                </div>
              </form>
            )}
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
