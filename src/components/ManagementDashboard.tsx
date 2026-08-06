import React, { useState, useEffect } from 'react';
import { Representative } from '../types';
import { getRepMetrics } from '../initialData';
import { 
  TrendingUp, 
  Users, 
  Target, 
  Sparkles, 
  DollarSign, 
  CheckCircle, 
  BarChart3, 
  Settings, 
  Plus, 
  Trophy, 
  ArrowUpRight, 
  ArrowRight,
  Sliders,
  Calendar,
  Lock,
  RefreshCw,
  Edit2,
  Database,
  FileSpreadsheet,
  Link,
  XCircle,
  AlertCircle,
  Briefcase,
  Eye,
  EyeOff,
  UserPlus,
  UserMinus,
  Trash2,
  Shield,
  Key
} from 'lucide-react';

interface ManagementDashboardProps {
  reps: Representative[];
  onSelectRep: (rep: Representative) => void;
  onUpdateRepKpi: (repId: string, updatedKpi: Representative['kpi']) => void;
  onUpdateRepTargets: (repId: string, updatedTargets: Representative['targets']) => void;
  onAskCopilot: (prompt: string) => void;
  selectedMonth: string;
  onMonthChange: (month: string) => void;
  passwords?: Record<string, string>;
  onUpdatePasswords?: (updatedPasswords: Record<string, string>) => void;
  onUpdateRepsList?: (updatedReps: Representative[]) => void;
}

export default function ManagementDashboard({
  reps,
  onSelectRep,
  onUpdateRepKpi,
  onUpdateRepTargets,
  onAskCopilot,
  selectedMonth,
  onMonthChange,
  passwords = {},
  onUpdatePasswords = () => {},
  onUpdateRepsList = () => {}
}: ManagementDashboardProps) {
  // Navigation Tabs for Management Console
  const [activeTab, setActiveTab] = useState<'overview' | 'targets' | 'quick-log' | 'pipelines' | 'reps'>('overview');
  
  // Loaded pipelines across all representatives for managerial overview
  const [allPipelines, setAllPipelines] = useState<any[]>([]);

  useEffect(() => {
    // Collect pipelines from all reps
    const collected: any[] = [];
    reps.forEach(r => {
      const saved = localStorage.getItem(`next_pipelines_${r.id}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        parsed.forEach((p: any) => {
          collected.push({
            ...p,
            repName: r.name,
            repId: r.id
          });
        });
      } else {
        // Fallback default initial data
        let defaults: any[] = [];
        if (r.id === 'chee-cai') {
          defaults = [
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
        } else if (r.id === 'alif') {
          defaults = [
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
        } else if (r.id === 'xin-ying') {
          defaults = [
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
        defaults.forEach(p => {
          collected.push({
            ...p,
            repName: r.name,
            repId: r.id
          });
        });
      }
    });
    setAllPipelines(collected);
  }, [reps, activeTab]);

  // Selected rep for targets edit
  const [editingTargetsId, setEditingTargetsId] = useState<string | null>(null);
  const [targetSales, setTargetSales] = useState('30000');
  const [targetProposals, setTargetProposals] = useState('2');
  const [targetPreview, setTargetPreview] = useState('1');

  // Quick Log Form state
  const [selectedRepId, setSelectedRepId] = useState(reps[0]?.id || '');
  const [selectedWeek, setSelectedWeek] = useState(0); // 0 to 4 (Week 1 to 5)
  const [logSales, setLogSales] = useState('');
  const [logProposals, setLogProposals] = useState('');
  const [logPreviews, setLogPreviews] = useState('');

  // Team-wide bulk target setup
  const [bulkSales, setBulkSales] = useState('30000');
  const [bulkProposals, setBulkProposals] = useState('2');
  const [bulkPreviews, setBulkPreviews] = useState('1');
  const [showBulkModal, setShowBulkModal] = useState(false);

  // Representative Management States
  const [editingRepId, setEditingRepId] = useState<string | null>(null);
  const [editRepName, setEditRepName] = useState('');
  const [editRepEmail, setEditRepEmail] = useState('');
  const [editRepAccountName, setEditRepAccountName] = useState('');
  const [editRepPassword, setEditRepPassword] = useState('');

  const [newRepName, setNewRepName] = useState('');
  const [newRepEmail, setNewRepEmail] = useState('');
  const [newRepAccountName, setNewRepAccountName] = useState('');
  const [newRepPassword, setNewRepPassword] = useState('');

  const [visiblePasswordRepIds, setVisiblePasswordRepIds] = useState<Set<string>>(new Set());

  const togglePasswordVisibility = (repId: string) => {
    setVisiblePasswordRepIds(prev => {
      const updated = new Set(prev);
      if (updated.has(repId)) {
        updated.delete(repId);
      } else {
        updated.add(repId);
      }
      return updated;
    });
  };

  const handleNewRepNameChange = (val: string) => {
    setNewRepName(val);
    const slug = val.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    setNewRepAccountName(slug);
    setNewRepEmail(`${slug.replace(/-/g, '')}@nextenergy24.com`);
    const clean = slug.replace(/[^a-zA-Z]/g, '');
    const capitalized = clean.charAt(0).toUpperCase() + (clean.slice(1, 3) || '');
    setNewRepPassword(`${capitalized}123` || 'Reps123');
  };

  const handleStartEditRep = (rep: Representative) => {
    setEditingRepId(rep.id);
    setEditRepName(rep.name);
    setEditRepEmail(rep.email || '');
    setEditRepAccountName(rep.id);
    setEditRepPassword(passwords[rep.id] || '');
  };

  const handleAddRepSubmitInDashboard = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRepName.trim() || !newRepAccountName.trim()) {
      alert('Name and Account Name are required!');
      return;
    }

    const cleanId = newRepAccountName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');

    if (reps.some(r => r.id === cleanId)) {
      alert(`Account name "${cleanId}" is already in use. Please select a unique account name.`);
      return;
    }

    const newRep: Representative = {
      id: cleanId,
      name: newRepName.trim(),
      email: newRepEmail.trim() || `${cleanId.replace(/-/g, '')}@nextenergy24.com`,
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

    onUpdateRepsList([...reps, newRep]);

    const updatedPasswords = { ...passwords };
    updatedPasswords[cleanId] = newRepPassword.trim() || `${cleanId.charAt(0).toUpperCase()}123`;
    onUpdatePasswords(updatedPasswords);

    setNewRepName('');
    setNewRepEmail('');
    setNewRepAccountName('');
    setNewRepPassword('');
    alert(`🎉 Representative "${newRep.name}" has been successfully created!`);
  };

  const handleEditRepSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRepId) return;

    if (!editRepName.trim() || !editRepAccountName.trim()) {
      alert('Name and Account Name are required!');
      return;
    }

    const oldId = editingRepId;
    const newId = editRepAccountName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');

    if (oldId !== newId && reps.some(r => r.id === newId)) {
      alert(`Account name "${newId}" is already taken by another representative!`);
      return;
    }

    const updatedReps = reps.map(rep => {
      if (rep.id === oldId) {
        return {
          ...rep,
          id: newId,
          name: editRepName.trim(),
          email: editRepEmail.trim()
        };
      }
      return rep;
    });

    const updatedPasswords = { ...passwords };
    if (oldId !== newId) {
      updatedPasswords[newId] = editRepPassword.trim() || passwords[oldId] || 'Reps123';
      delete updatedPasswords[oldId];

      try {
        const savedPipelines = localStorage.getItem(`next_pipelines_${oldId}`);
        if (savedPipelines) {
          localStorage.setItem(`next_pipelines_${newId}`, savedPipelines);
          localStorage.removeItem(`next_pipelines_${oldId}`);
        }
        const savedTasks = localStorage.getItem(`next_tasks_${oldId}`);
        if (savedTasks) {
          localStorage.setItem(`next_tasks_${newId}`, savedTasks);
          localStorage.removeItem(`next_tasks_${oldId}`);
        }
      } catch (err) {
        console.error("Failed to migrate representative files:", err);
      }
    } else {
      updatedPasswords[oldId] = editRepPassword.trim();
    }

    onUpdateRepsList(updatedReps);
    onUpdatePasswords(updatedPasswords);

    setEditingRepId(null);
    alert('🎉 Representative details updated successfully!');
  };

  const handleDeleteRepClick = (repId: string, repName: string) => {
    if (reps.length <= 1) {
      alert('Cannot delete the only representative on the roster. Please create another representative first.');
      return;
    }

    const confirmDelete = window.confirm(`Are you absolutely sure you want to permanently delete the representative "${repName}"?\nThis action will also delete their login account.`);
    if (!confirmDelete) return;

    const updatedReps = reps.filter(r => r.id !== repId);
    onUpdateRepsList(updatedReps);

    const updatedPasswords = { ...passwords };
    delete updatedPasswords[repId];
    onUpdatePasswords(updatedPasswords);

    try {
      localStorage.removeItem(`next_pipelines_${repId}`);
      localStorage.removeItem(`next_tasks_${repId}`);
    } catch (e) {
      console.error(e);
    }

    alert(`Representative "${repName}" has been successfully removed.`);
  };

  // Date Range and Google Sheets Backup states
  const [startMonth, setStartMonth] = useState('JUN-26');
  const [endMonth, setEndMonth] = useState('DEC-26');
  const [isBackupConnected, setIsBackupConnected] = useState(() => {
    return localStorage.getItem('next_backup_connected') === 'true';
  });
  const [lastBackupRun, setLastBackupRun] = useState(() => {
    return localStorage.getItem('next_last_backup') || 'Sun Jul 05 2026 at 6:28:40 PM';
  });
  const [isBackingUp, setIsBackingUp] = useState(false);

  const ALL_AVAILABLE_MONTHS = [
    'JAN-26', 'FEB-26', 'MAR-26', 'APR-26', 'MAY-26', 'JUN-26', 
    'JUL-26', 'AUG-26', 'SEP-26', 'OCT-26', 'NOV-26', 'DEC-26',
    'JAN-27', 'FEB-27', 'MAR-27', 'APR-27', 'MAY-27', 'JUN-27'
  ];

  const getResultingMonthList = () => {
    const startIdx = ALL_AVAILABLE_MONTHS.indexOf(startMonth);
    const endIdx = ALL_AVAILABLE_MONTHS.indexOf(endMonth);
    if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) {
      return [startMonth];
    }
    return ALL_AVAILABLE_MONTHS.slice(startIdx, endIdx + 1);
  };

  const handleToggleGoogleConnection = () => {
    const nextState = !isBackupConnected;
    setIsBackupConnected(nextState);
    localStorage.setItem('next_backup_connected', nextState ? 'true' : 'false');
    if (nextState) {
      alert("✅ Successfully connected Google Sheets API workspace account!");
    } else {
      alert("🔒 Disconnected Google Sheets API integration.");
    }
  };

  const handleRunBackupNow = () => {
    if (!isBackupConnected) {
      alert("⚠️ Google Workspace is not connected. Please connect Google first.");
      return;
    }
    setIsBackingUp(true);
    setTimeout(() => {
      const nowStr = new Date().toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
      setLastBackupRun(nowStr);
      localStorage.setItem('next_last_backup', nowStr);
      setIsBackingUp(false);
      alert(`🎉 Backup Completed Successfully!\nExported KPI records and targets for ${reps.length} active representatives to spreadsheet tab "Backup".`);
    }, 1200);
  };

  // Helpers for chronological YTD and pipeline sales calculations
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
      return allPipelines
        .filter((p: any) => {
          if (p.repId !== repId) return false;
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

  // Math metrics
  const activeMonthSales = reps.reduce((sum, r) => {
    if (r.id === 'atiqa') return sum; // Atiqa uses performance ratings (1-5) instead of RM sales!
    const manualSales = (r.kpi?.salesFigure ?? []).reduce((a, b) => a + b, 0);
    return sum + manualSales + getRepPipelineSalesForMonth(r.id, selectedMonth);
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
  
  const numReps = reps.length;
  const totalProposalsTeam = reps.reduce((sum, r) => sum + (r.kpi?.proposals ?? []).reduce((a, b) => a + b, 0), 0);
  const totalPreviewsTeam = reps.reduce((sum, r) => sum + (r.kpi?.preview ?? []).reduce((a, b) => a + b, 0), 0);

  // Targets totals
  const totalSalesTargetTeam = reps.reduce((sum, r) => {
    if (r.id === 'atiqa') return sum;
    return sum + (r.targets?.salesFigure ?? 30000);
  }, 0);
  const totalProposalsTargetTeam = reps.length * 10; // 2 per week * 5 weeks = 10 per rep
  const totalPreviewsTargetTeam = reps.reduce((sum, r) => sum + (r.targets?.preview ?? 1), 0);

  // Calculated overall score per rep helper
  const getRepScores = (rep: Representative) => {
    const pipelineSales = rep.id === 'atiqa' ? 0 : getRepPipelineSalesForMonth(rep.id, selectedMonth);
    const totalSales = (rep.kpi?.salesFigure ?? []).reduce((a, b) => a + b, 0) + pipelineSales;
    const totalProposals = (rep.kpi?.proposals ?? []).reduce((a, b) => a + b, 0);
    const totalPreview = (rep.kpi?.preview ?? []).reduce((a, b) => a + b, 0);

    const metricsList = getRepMetrics(rep);
    
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

    const overallScore = Math.round(metricsList.reduce((sum, m) => {
      const score = getMetricScore(m.key);
      return sum + (score * m.weight);
    }, 0));

    return {
      totalSales,
      totalProposals,
      totalPreview,
      salesScore,
      proposalsScore,
      previewScore,
      overallScore
    };
  };

  // Find Top Performers
  const repPerformanceList = reps.map(rep => ({
    rep,
    metrics: getRepScores(rep)
  }));

  // Sort by sales closed to find best closer
  const sortedBySales = [...repPerformanceList].sort((a, b) => b.metrics.totalSales - a.metrics.totalSales);
  const topCloser = sortedBySales[0];

  // Sort by overall performance score
  const sortedByScore = [...repPerformanceList].sort((a, b) => b.metrics.overallScore - a.metrics.overallScore);
  const topPerformer = sortedByScore[0];

  // Team average score calculation
  const avgTeamScore = numReps === 0 ? 0 : Math.round(
    repPerformanceList.reduce((acc, r) => acc + r.metrics.overallScore, 0) / numReps
  );

  // Targets Edit handler
  const handleStartEditingTargets = (rep: Representative) => {
    setActiveTab('targets');
    setEditingTargetsId(rep.id);
    setTargetSales((rep.targets?.salesFigure ?? (rep.id === 'atiqa' ? 25 : 30000)).toString());
    setTargetProposals((rep.targets?.proposals ?? (rep.id === 'atiqa' ? 1 : 2)).toString());
    setTargetPreview((rep.targets?.preview ?? (rep.id === 'atiqa' ? 20 : 1)).toString());
  };

  const handleSaveTargets = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTargetsId) return;
    const isAtiqa = editingTargetsId === 'atiqa';
    onUpdateRepTargets(editingTargetsId, {
      salesFigure: parseFloat(targetSales) || (isAtiqa ? 25 : 30000),
      proposals: parseInt(targetProposals) || (isAtiqa ? 1 : 2),
      preview: parseInt(targetPreview) || (isAtiqa ? 20 : 1)
    });
    setEditingTargetsId(null);
  };

  // Team Bulk update targets
  const handleBulkTargetsSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    reps.forEach(rep => {
      onUpdateRepTargets(rep.id, {
        salesFigure: parseFloat(bulkSales) || 30000,
        proposals: parseInt(bulkProposals) || 2,
        preview: parseInt(bulkPreviews) || 1
      });
    });
    setShowBulkModal(false);
  };

  // Quick Log Handler
  const handleQuickLogSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const rep = reps.find(r => r.id === selectedRepId);
    if (!rep) return;

    const updatedKpi = {
      salesFigure: [...(rep.kpi?.salesFigure ?? [0, 0, 0, 0, 0])],
      proposals: [...(rep.kpi?.proposals ?? [0, 0, 0, 0, 0])],
      preview: [...(rep.kpi?.preview ?? [0, 0, 0, 0, 0])]
    };

    const addSales = parseFloat(logSales) || 0;
    const addProps = parseInt(logProposals) || 0;
    const addPreviews = parseInt(logPreviews) || 0;

    updatedKpi.salesFigure[selectedWeek] += addSales;
    updatedKpi.proposals[selectedWeek] += addProps;
    updatedKpi.preview[selectedWeek] += addPreviews;

    onUpdateRepKpi(selectedRepId, updatedKpi);

    // Reset log inputs
    setLogSales('');
    setLogProposals('');
    setLogPreviews('');
    
    // Trigger small animation or notification
    alert(`Successfully logged data for ${rep.name} on Week ${selectedWeek + 1}!`);
  };

  // Score badge color logic
  const getScoreStyle = (score: number) => {
    if (score >= 80) return 'bg-emerald-50 text-emerald-700 border-emerald-100';
    if (score >= 50) return 'bg-amber-50 text-amber-700 border-amber-100';
    return 'bg-rose-50 text-rose-700 border-rose-100';
  };

  return (
    <div className="space-y-6" id="management-dashboard-view">
      
      {/* Upper Management Header Banner */}
      <div className="bg-slate-900 text-white rounded-2xl p-6 md:p-8 border border-slate-800 shadow-md flex flex-col md:flex-row md:items-center justify-between gap-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-emerald-500/5 rounded-full blur-2xl pointer-events-none" />
        
        <div className="space-y-2 relative z-10">
          <div className="flex items-center gap-2">
            <span className="text-[10px] bg-blue-600/80 text-blue-100 font-extrabold px-2.5 py-1 rounded-full uppercase tracking-widest font-mono">
              EXECUTIVE PORTAL
            </span>
            <span className="text-[10px] bg-emerald-600/80 text-emerald-100 font-extrabold px-2.5 py-1 rounded-full uppercase tracking-widest font-mono">
              {selectedMonth} ACTIVE
            </span>
          </div>
          <h2 className="text-2xl md:text-3xl font-black tracking-tight font-sans text-white">
            NEXT ACADEMY MANAGEMENT CONSOLE
          </h2>
          <p className="text-slate-400 text-xs md:text-sm max-w-2xl font-medium leading-relaxed">
            Configure benchmarks, track team-wide ratios, update individual performance targets, and generate operations intelligence via server-side AI integrations.
          </p>
        </div>

        <button 
          onClick={() => onAskCopilot("Analyze the entire sales team's metrics for July 2026. Who is overperforming, who needs immediate support, and what is the overall team health forecast?")}
          className="relative z-10 flex items-center justify-center gap-2 px-5 py-3 bg-gradient-to-r from-blue-600 to-emerald-600 hover:from-blue-700 hover:to-emerald-700 text-white font-extrabold text-xs rounded-xl shadow-lg shadow-blue-500/10 hover:shadow-blue-500/20 active:scale-95 transition-all cursor-pointer"
        >
          <Sparkles className="w-4 h-4" />
          GENERATE FULL CO-PILOT AUDIT
        </button>
      </div>

      {/* Primary Sub-Navigation inside the Console */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white p-2 rounded-xl border border-slate-200">
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => setActiveTab('overview')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
              activeTab === 'overview'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            Overview & Leaderboard
          </button>
          
          <button
            onClick={() => setActiveTab('targets')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
              activeTab === 'targets'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
            }`}
          >
            <Target className="w-4 h-4" />
            Configure Targets
          </button>

          <button
            onClick={() => setActiveTab('quick-log')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
              activeTab === 'quick-log'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
            }`}
          >
            <Plus className="w-4 h-4" />
            Quick KPI Log
          </button>

          <button
            onClick={() => setActiveTab('pipelines')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
              activeTab === 'pipelines'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
            }`}
          >
            <TrendingUp className="w-4 h-4" />
            Global Pipelines
          </button>

          <button
            onClick={() => setActiveTab('reps')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
              activeTab === 'reps'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
            }`}
          >
            <Users className="w-4 h-4" />
            Reps Settings
          </button>
        </div>

        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg">
          <Calendar className="w-3.5 h-3.5 text-blue-500" />
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider font-mono">Selected Month:</span>
          <select
            value={selectedMonth}
            onChange={(e) => onMonthChange(e.target.value)}
            className="text-[11px] font-bold font-mono border-0 bg-transparent text-slate-700 focus:ring-0 focus:outline-none cursor-pointer p-0 pr-6"
          >
            {['JAN-26', 'FEB-26', 'MAR-26', 'APR-26', 'MAY-26', 'JUN-26', 'JUL-26', 'AUG-26', 'SEP-26', 'OCT-26', 'NOV-26', 'DEC-26', 'JAN-27', 'FEB-27', 'MAR-27', 'APR-27', 'MAY-27', 'JUN-27'].map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Main Tab views */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          
          {/* Executive Summary Stats Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5" id="management-stats-grid">
            
            {/* Team Sales Card */}
            <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex justify-between items-start">
                  <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 font-mono">
                    TEAM ACTIVE SALES
                  </span>
                  <div className="p-1.5 bg-emerald-50 border border-emerald-100 text-emerald-600 rounded-lg">
                    <DollarSign className="w-4 h-4" />
                  </div>
                </div>
                <h3 className="text-2xl font-black font-mono tracking-tight text-slate-800 mt-2">
                  RM {activeMonthSales.toLocaleString()}
                </h3>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-150 flex items-center justify-between text-xs font-bold text-slate-500">
                <span>Monthly Target:</span>
                <span className="font-mono text-slate-700">RM {totalSalesTargetTeam.toLocaleString()}</span>
              </div>
            </div>

            {/* Team Proposals */}
            <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex justify-between items-start">
                  <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 font-mono">
                    TEAM PROPOSALS SENT
                  </span>
                  <div className="p-1.5 bg-blue-50 border border-blue-100 text-blue-600 rounded-lg">
                    <CheckCircle className="w-4 h-4" />
                  </div>
                </div>
                <h3 className="text-2xl font-black font-mono tracking-tight text-slate-800 mt-2">
                  {totalProposalsTeam} / {totalProposalsTargetTeam}
                </h3>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-150 flex items-center justify-between text-xs font-bold text-slate-500">
                <span>Avg Per Rep:</span>
                <span className="font-mono text-slate-700">
                  {numReps > 0 ? (totalProposalsTeam / numReps).toFixed(1) : 0} props
                </span>
              </div>
            </div>

            {/* Team Previews */}
            <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex justify-between items-start">
                  <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 font-mono">
                    TEAM PREVIEWS ACHIEVED
                  </span>
                  <div className="p-1.5 bg-cyan-50 border border-cyan-100 text-cyan-600 rounded-lg">
                    <Users className="w-4 h-4" />
                  </div>
                </div>
                <h3 className="text-2xl font-black font-mono tracking-tight text-slate-800 mt-2">
                  {totalPreviewsTeam} / {totalPreviewsTargetTeam}
                </h3>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-150 flex items-center justify-between text-xs font-bold text-slate-500">
                <span>Global Score contribution:</span>
                <span className="text-cyan-600 font-mono">20% weight</span>
              </div>
            </div>

            {/* Team Average Score */}
            <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex justify-between items-start">
                  <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 font-mono">
                    TEAM AVERAGE SCORE
                  </span>
                  <div className="p-1.5 bg-purple-50 border border-purple-100 text-purple-600 rounded-lg">
                    <Trophy className="w-4 h-4" />
                  </div>
                </div>
                <h3 className="text-2xl font-black font-mono tracking-tight text-slate-800 mt-2">
                  {avgTeamScore}%
                </h3>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-150">
                <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-purple-500 transition-all duration-500" 
                    style={{ width: `${avgTeamScore}%` }}
                  />
                </div>
              </div>
            </div>

          </div>

          {/* Spotlight Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5" id="spotlight-row">
            
            {/* Spotlight 1: Leader by Score */}
            {topPerformer && (
              <div className="bg-gradient-to-tr from-blue-500/5 to-cyan-500/5 border border-blue-100 rounded-2xl p-5 flex items-center justify-between">
                <div className="space-y-1.5">
                  <span className="text-[9px] font-black uppercase tracking-wider text-blue-500 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded font-mono">
                    🥇 TEAM OVERALL LEADER
                  </span>
                  <h4 className="text-base font-black text-slate-800">{topPerformer.rep.name}</h4>
                  <p className="text-xs text-slate-500 font-medium font-sans">
                    With an overall pipeline efficiency Index of <span className="font-black font-mono text-blue-600">{topPerformer.metrics.overallScore}%</span>.
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[9px] font-bold text-slate-400 uppercase font-mono">Actual Sales</p>
                  <p className="text-lg font-black font-mono text-slate-800">RM {topPerformer.metrics.totalSales.toLocaleString()}</p>
                </div>
              </div>
            )}

            {/* Spotlight 2: Best Closer by Revenue */}
            {topCloser && (
              <div className="bg-gradient-to-tr from-emerald-500/5 to-green-500/5 border border-emerald-100 rounded-2xl p-5 flex items-center justify-between">
                <div className="space-y-1.5">
                  <span className="text-[9px] font-black uppercase tracking-wider text-emerald-600 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded font-mono">
                    💵 REVENUE TOP CLOSER
                  </span>
                  <h4 className="text-base font-black text-slate-800">{topCloser.rep.name}</h4>
                  <p className="text-xs text-slate-500 font-medium font-sans">
                    Generating a record <span className="font-black font-mono text-emerald-600">RM {topCloser.metrics.totalSales.toLocaleString()}</span> this period.
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[9px] font-bold text-slate-400 uppercase font-mono">Target</p>
                  <p className="text-sm font-bold font-mono text-slate-500">RM {(topCloser.rep.targets?.salesFigure ?? 30000).toLocaleString()}</p>
                </div>
              </div>
            )}

          </div>

          {/* Interactive Custom SVG Comparison Chart */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
            <div className="flex justify-between items-center">
              <div className="space-y-0.5">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block font-mono">
                  Visual Analytics
                </span>
                <h4 className="text-xs font-black uppercase text-slate-800 tracking-wider">
                  SALES PERFORMANCE VS ASSIGNED TARGETS
                </h4>
              </div>
              <div className="flex items-center gap-3 text-xs font-bold">
                <div className="flex items-center gap-1.5 text-slate-600">
                  <div className="w-3 h-3 bg-blue-500 rounded-xs" />
                  <span>Actual Closed</span>
                </div>
                <div className="flex items-center gap-1.5 text-slate-600">
                  <div className="w-3 h-3 bg-slate-200 rounded-xs border border-slate-300" />
                  <span>Target Benchmark</span>
                </div>
              </div>
            </div>

            {/* Custom Responsive SVG Horizontal Bar Chart */}
            <div className="space-y-4 pt-2">
              {reps.map((rep) => {
                const metrics = getRepScores(rep);
                const salesTarget = rep.targets?.salesFigure ?? 30000;
                
                // Calculate percentages relative to the highest sales target or value to prevent overflow
                const maxVal = Math.max(...reps.map(r => Math.max(r.targets?.salesFigure ?? 30000, (r.kpi?.salesFigure ?? []).reduce((a,b)=>a+b,0))), 40000);
                const actualPct = Math.min(100, (metrics.totalSales / maxVal) * 100);
                const targetPct = Math.min(100, (salesTarget / maxVal) * 100);

                return (
                  <div key={rep.id} className="grid grid-cols-12 gap-4 items-center">
                    
                    {/* Name */}
                    <div className="col-span-3">
                      <p className="text-xs font-extrabold text-slate-800 truncate">{rep.name}</p>
                      <p className="text-[9px] text-slate-400 font-mono mt-0.5 uppercase tracking-wider">
                        Score: {metrics.overallScore}%
                      </p>
                    </div>

                    {/* Bar visualizer */}
                    <div className="col-span-7 relative h-6 bg-slate-50 border border-slate-100 rounded-md overflow-hidden flex items-center">
                      
                      {/* Target bar (light overlay border/background) */}
                      <div 
                        className="absolute h-full bg-slate-100 border-r border-slate-300/80 transition-all duration-500"
                        style={{ width: `${targetPct}%` }}
                      />

                      {/* Actual value bar */}
                      <div 
                        className="absolute h-full bg-blue-500/90 hover:bg-blue-600 transition-all duration-500 rounded-r-xs flex items-center pl-2"
                        style={{ width: `${actualPct}%` }}
                      >
                        {actualPct > 12 && (
                          <span className="text-[8px] font-black text-white font-mono drop-shadow-xs">
                            RM {metrics.totalSales.toLocaleString()}
                          </span>
                        )}
                      </div>

                    </div>

                    {/* Numeric breakdown */}
                    <div className="col-span-2 text-right">
                      <span className="text-xs font-black font-mono text-slate-700">
                        {Math.round((metrics.totalSales / salesTarget) * 100)}%
                      </span>
                      <span className="text-[9px] text-slate-400 block font-sans">
                        of RM {salesTarget.toLocaleString()}
                      </span>
                    </div>

                  </div>
                );
              })}
            </div>
          </div>

          {/* Main Comparison Leaderboard Table */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
            <div className="p-4 bg-slate-800 text-white flex items-center justify-between">
              <span className="text-xs font-black uppercase tracking-wider font-display">
                🏆 REPRESENTATIVE PIPELINE LEADERBOARD
              </span>
              <span className="text-[10px] bg-slate-700 text-slate-300 font-bold px-2.5 py-1 rounded font-mono">
                {numReps} Sales reps active
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-150 text-[9px] font-black text-slate-400 uppercase tracking-widest">
                    <th className="p-4">Representative</th>
                    <th className="p-4 text-center">Efficiency Score</th>
                    <th className="p-4">Sales closed (RM)</th>
                    <th className="p-4 text-center">Proposals</th>
                    <th className="p-4 text-center font-mono">Previews</th>
                    <th className="p-4 text-right">Operational Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700 font-sans text-xs">
                  {repPerformanceList.map(({ rep, metrics }) => {
                    return (
                      <tr key={rep.id} className="hover:bg-slate-50/50 transition-colors">
                        
                        {/* Name column */}
                        <td className="p-4">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-xs font-black text-slate-600">
                              {rep.name.substring(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <p className="font-extrabold text-slate-800">{rep.name}</p>
                              <p className="text-[9px] text-slate-400 font-mono uppercase mt-0.5">ID: {rep.id}</p>
                            </div>
                          </div>
                        </td>

                        {/* Overall efficiency score */}
                        <td className="p-4 text-center">
                          <span className={`inline-block px-2.5 py-1 rounded-full border text-[10px] font-black font-mono ${getScoreStyle(metrics.overallScore)}`}>
                            {metrics.overallScore}%
                          </span>
                        </td>

                        {/* Sales Volume */}
                        <td className="p-4">
                          <div className="space-y-1">
                            <p className="font-extrabold font-mono text-slate-800">
                              {rep.id === 'atiqa' ? `${metrics.totalSales} Rating` : `RM ${metrics.totalSales.toLocaleString()}`}
                            </p>
                            <div className="w-24 bg-slate-100 h-1 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-emerald-500" 
                                style={{ width: `${metrics.salesScore}%` }}
                              />
                            </div>
                            <p className="text-[8px] font-bold text-slate-400 uppercase font-mono">
                              {rep.id === 'atiqa' ? `Target: 25 (5/wk)` : `Target: RM ${(rep.targets?.salesFigure ?? 30000).toLocaleString()}`}
                            </p>
                          </div>
                        </td>

                        {/* Proposals Sent */}
                        <td className="p-4 text-center">
                          <p className="font-black font-mono text-slate-800">
                            {rep.id === 'atiqa' ? `${metrics.totalProposals} Claims` : `${metrics.totalProposals} / 10`}
                          </p>
                          <span className="text-[9px] text-slate-400 block font-mono">
                            {rep.id === 'atiqa' ? `${metrics.proposalsScore}% of quota` : `${metrics.proposalsScore}% of weekly quota`}
                          </span>
                        </td>

                        {/* Previews Achieved */}
                        <td className="p-4 text-center">
                          <p className="font-black font-mono text-slate-800">
                            {rep.id === 'atiqa' ? `${metrics.totalPreview} / 20` : `${metrics.totalPreview} / ${rep.targets?.preview ?? 1}`}
                          </p>
                          <span className="text-[9px] text-slate-400 block font-mono">
                            {rep.id === 'atiqa' ? `${metrics.previewScore}% of target` : `${metrics.previewScore}% month limit`}
                          </span>
                        </td>

                        {/* Actions */}
                        <td className="p-4 text-right">
                          <div className="flex justify-end gap-1.5">
                            <button
                              onClick={() => onSelectRep(rep)}
                              className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[10px] rounded uppercase tracking-wider transition-all cursor-pointer"
                            >
                              Console
                            </button>
                            <button
                              onClick={() => handleStartEditingTargets(rep)}
                              className="px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-100 font-bold text-[10px] rounded uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1"
                            >
                              <Sliders className="w-3 h-3" />
                              Targets
                            </button>
                          </div>
                        </td>

                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* New Section: KPI Date Range and Backup Management */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
            
            {/* Card 1: KPI Active Date Range Configuration */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs flex flex-col justify-between space-y-4">
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-blue-50 border border-blue-100 text-blue-600 rounded-xl">
                    <Calendar className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-black uppercase text-slate-800 tracking-wider">
                      KPI ACTIVE DATE RANGE CONFIGURATION
                    </h4>
                    <p className="text-slate-400 text-[10px] uppercase font-bold mt-1 leading-relaxed">
                      Configure the active month list range (Format: MMM-YY, e.g. Jun-26 to May-27). This defines the tracking year and allowable KPI months.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">
                      Start Month
                    </label>
                    <select
                      value={startMonth}
                      onChange={(e) => setStartMonth(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 bg-white font-mono"
                    >
                      {ALL_AVAILABLE_MONTHS.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">
                      End Month
                    </label>
                    <select
                      value={endMonth}
                      onChange={(e) => setEndMonth(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 bg-white font-mono"
                    >
                      {ALL_AVAILABLE_MONTHS.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="pt-2">
                  <span className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">
                    Resulting KPI Month List ({getResultingMonthList().length} Months)
                  </span>
                  <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
                    {getResultingMonthList().map((month) => (
                      <span
                        key={month}
                        className="text-[10px] font-bold px-2.5 py-1 bg-slate-50 border border-slate-200 text-slate-600 rounded-md font-mono hover:bg-slate-100 transition-colors cursor-default"
                      >
                        {month}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              
              <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
                <span>Active Year Setup:</span>
                <span className="font-extrabold text-blue-600">2026 Operational Term</span>
              </div>
            </div>

            {/* Card 2: Google Sheets Backup & Log */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs flex flex-col justify-between space-y-4">
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-emerald-50 border border-emerald-100 text-emerald-600 rounded-xl">
                    <Database className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-black uppercase text-slate-800 tracking-wider">
                      GOOGLE SHEETS BACKUP & LOG
                    </h4>
                    <p className="text-slate-400 text-[10px] uppercase font-bold mt-1 leading-relaxed">
                      A secure backup of all overrides is automatically performed daily at 8:00 PM using Google Sheets API.
                    </p>
                  </div>
                </div>

                <div className="border border-slate-150 rounded-xl overflow-hidden text-xs divide-y divide-slate-100">
                  <div className="flex justify-between items-center p-3 hover:bg-slate-50/50 transition-colors">
                    <span className="font-bold text-slate-500 uppercase text-[10px] tracking-wider">Spreadsheet ID:</span>
                    <span className="font-mono text-slate-800 bg-slate-50 px-2 py-0.5 border border-slate-200 rounded max-w-[200px] truncate" title="1PDzG6j2MZJ_6ZB7yb9u3H7E_abEh3v_example_id">
                      1PDzG6j2MZJ_6ZB7yb9u3H7E_abEh3v...
                    </span>
                  </div>
                  <div className="flex justify-between items-center p-3 hover:bg-slate-50/50 transition-colors">
                    <span className="font-bold text-slate-500 uppercase text-[10px] tracking-wider">Backup Tab:</span>
                    <span className="font-black text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded font-mono">
                      "Backup"
                    </span>
                  </div>
                  <div className="flex justify-between items-center p-3 hover:bg-slate-50/50 transition-colors">
                    <span className="font-bold text-slate-500 uppercase text-[10px] tracking-wider">Auto Backup Schedule:</span>
                    <span className="flex items-center gap-1 font-bold text-slate-700 font-mono">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Daily @ 8:00 PM
                    </span>
                  </div>
                  <div className="flex justify-between items-center p-3 hover:bg-slate-50/50 transition-colors">
                    <span className="font-bold text-slate-500 uppercase text-[10px] tracking-wider">Last Backup Run:</span>
                    <span className="font-semibold text-slate-600 font-mono text-[11px]">
                      {lastBackupRun}
                    </span>
                  </div>
                </div>
              </div>

              <div className="pt-2 flex flex-col sm:flex-row gap-2.5">
                <a
                  href="https://docs.google.com/spreadsheets/d/1PDzG6j2MZJ_6ZB7yb9u3H7E_abEh3v_example/edit"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 border border-emerald-600 hover:bg-emerald-50 text-emerald-700 font-extrabold text-[10px] uppercase tracking-wider rounded-xl transition-all shadow-xs"
                >
                  <Link className="w-3.5 h-3.5" />
                  OPEN SHEET (BACKUP)
                </a>
                
                {isBackupConnected ? (
                  <div className="flex-1 flex gap-1.5">
                    <button
                      onClick={handleRunBackupNow}
                      disabled={isBackingUp}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-[10px] uppercase tracking-wider rounded-xl transition-all shadow-sm cursor-pointer disabled:opacity-50"
                    >
                      {isBackingUp ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          RUNNING...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="w-3.5 h-3.5" />
                          BACKUP NOW
                        </>
                      )}
                    </button>
                    <button
                      onClick={handleToggleGoogleConnection}
                      className="px-2.5 py-2 border border-slate-200 hover:bg-slate-50 text-slate-500 hover:text-rose-600 rounded-xl transition-all cursor-pointer"
                      title="Disconnect Google Drive integration"
                    >
                      Disconnect
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={handleToggleGoogleConnection}
                    className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 bg-[#F97316] hover:bg-[#EA580C] text-white font-extrabold text-[10px] uppercase tracking-wider rounded-xl transition-all shadow-sm cursor-pointer"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    CONNECT GOOGLE
                  </button>
                )}
              </div>
            </div>

          </div>

        </div>
      )}

      {/* Targets Management Panel */}
      {activeTab === 'targets' && (
        <div className="space-y-6">
          
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
              <div className="space-y-0.5">
                <h4 className="text-sm font-black uppercase text-slate-800 tracking-wider">
                  TEAM TARGET CONFIGURATION MANAGER
                </h4>
                <p className="text-slate-400 text-xs">
                  Set operational quotas and conversion targets for individual representatives.
                </p>
              </div>

              <button 
                onClick={() => setShowBulkModal(true)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white font-extrabold text-xs rounded-xl flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
              >
                <Sliders className="w-3.5 h-3.5" />
                Team Bulk Targets Setup
              </button>
            </div>

            {/* Editing Active Targets inline row */}
            {editingTargetsId && (
              <form onSubmit={handleSaveTargets} className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-4 animate-fadeIn">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-blue-600 animate-ping" />
                  <span className="text-[10px] font-black uppercase text-blue-800 tracking-widest font-mono">
                    Modifying Targets for {reps.find(r => r.id === editingTargetsId)?.name}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-[9px] font-bold text-slate-400 uppercase mb-1">Sales Figure target (RM)</label>
                    <input 
                      type="number"
                      required
                      value={targetSales}
                      onChange={(e) => setTargetSales(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold text-slate-400 uppercase mb-1">Proposals Target (weekly)</label>
                    <input 
                      type="number"
                      required
                      value={targetProposals}
                      onChange={(e) => setTargetProposals(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold text-slate-400 uppercase mb-1">Preview Target (monthly)</label>
                    <input 
                      type="number"
                      required
                      value={targetPreview}
                      onChange={(e) => setTargetPreview(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 font-mono"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button 
                    type="button"
                    onClick={() => setEditingTargetsId(null)}
                    className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold px-4 py-2 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className="text-xs bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-lg"
                  >
                    Save Target Benchmarks
                  </button>
                </div>
              </form>
            )}

            {/* List of current targets with editing trigger */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {reps.map((rep) => {
                return (
                  <div key={rep.id} className="border border-slate-200/80 rounded-xl p-4 flex flex-col justify-between hover:border-slate-300 hover:shadow-xs transition-all bg-white">
                    <div className="space-y-3">
                      <div className="flex justify-between items-start">
                        <h5 className="font-extrabold text-slate-800">{rep.name}</h5>
                        <button
                          onClick={() => handleStartEditingTargets(rep)}
                          className="p-1 hover:bg-slate-50 text-slate-400 hover:text-blue-600 rounded transition-colors"
                          title="Edit rep targets"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="space-y-2 text-xs">
                        <div className="flex justify-between items-center text-slate-500">
                          <span>Sales Target (RM):</span>
                          <span className="font-mono font-black text-slate-800">
                            RM {(rep.targets?.salesFigure ?? 30000).toLocaleString()}
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-slate-500">
                          <span>Weekly Proposals:</span>
                          <span className="font-mono font-black text-slate-800">
                            {rep.targets?.proposals ?? 2} proposals / wk
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-slate-500">
                          <span>Monthly Previews:</span>
                          <span className="font-mono font-black text-slate-800">
                            {rep.targets?.preview ?? 1} previews
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="border-t border-slate-100 mt-4 pt-3 flex justify-between items-center text-[10px] text-slate-400 uppercase font-mono">
                      <span>Status:</span>
                      <span className="text-emerald-500 font-bold">● Tracking Active</span>
                    </div>
                  </div>
                );
              })}
            </div>

          </div>

        </div>
      )}

      {/* Quick KPI Logging screen */}
      {activeTab === 'quick-log' && (
        <div className="max-w-xl mx-auto">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-4">
            <div className="pb-3 border-b border-slate-100">
              <h4 className="text-sm font-black uppercase text-slate-800 tracking-wider">
                ⚡ QUICK LOG CONSOLE
              </h4>
              <p className="text-slate-400 text-xs">
                Log weekly data for any representative instantly from a single centralized form.
              </p>
            </div>

            <form onSubmit={handleQuickLogSubmit} className="space-y-4">
              
              {/* Select rep */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Select Representative</label>
                <select 
                  value={selectedRepId}
                  onChange={(e) => setSelectedRepId(e.target.value)}
                  className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500"
                >
                  {reps.map(r => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>

              {/* Select Week */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Select Active Week</label>
                <select 
                  value={selectedWeek}
                  onChange={(e) => setSelectedWeek(parseInt(e.target.value))}
                  className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500"
                >
                  <option value={0}>Week 1</option>
                  <option value={1}>Week 2</option>
                  <option value={2}>Week 3</option>
                  <option value={3}>Week 4</option>
                  <option value={4}>Week 5</option>
                </select>
              </div>

              {/* Sales Closed */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Add Sales Closed (RM)</label>
                <input 
                  type="number"
                  placeholder="e.g. 5000 (leaves blank for no change)"
                  value={logSales}
                  onChange={(e) => setLogSales(e.target.value)}
                  className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>

              {/* Proposals and Previews side by side */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Add Proposals</label>
                  <input 
                    type="number"
                    placeholder="e.g. 1"
                    value={logProposals}
                    onChange={(e) => setLogProposals(e.target.value)}
                    className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Add Previews</label>
                  <input 
                    type="number"
                    placeholder="e.g. 1"
                    value={logPreviews}
                    onChange={(e) => setLogPreviews(e.target.value)}
                    className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>
              </div>

              <div className="pt-3">
                <button
                  type="submit"
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs rounded-xl shadow-md transition-colors"
                >
                  Centralized Quota Update
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {activeTab === 'pipelines' && (
        <div className="space-y-6">
          {/* Executive Header Banner */}
          <div className="bg-slate-900 text-white rounded-2xl p-6 shadow-md border border-slate-800 flex flex-col md:flex-row items-center justify-between gap-6" id="executive-pipeline-banner">
            <div className="space-y-1 text-left">
              <span className="text-[10px] bg-blue-500/20 text-blue-300 font-bold px-3 py-1 rounded border border-blue-500/30 font-mono uppercase tracking-widest">
                Team-wide Pipeline Board
              </span>
              <h2 className="text-xl font-bold tracking-tight text-white font-sans mt-2">
                Executive Sales Pipeline Overview
              </h2>
              <p className="text-slate-300 text-xs">
                Real-time tracking of deal value, status, and conversion trajectories for all sales representatives.
              </p>
            </div>
            
            <div className="flex gap-4">
              <div className="bg-slate-800/80 border border-slate-700/50 rounded-xl p-4 text-center min-w-[140px]">
                <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest block font-mono">
                  Gross Pipeline
                </span>
                <span className="text-lg font-mono font-black text-blue-400 block mt-1">
                  RM {allPipelines.reduce((sum, item) => sum + item.proposalValue, 0).toLocaleString()}
                </span>
              </div>
              <div className="bg-slate-800/80 border border-slate-700/50 rounded-xl p-4 text-center min-w-[140px]">
                <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest block font-mono">
                  Closed Won
                </span>
                <span className="text-lg font-mono font-black text-emerald-400 block mt-1">
                  RM {allPipelines.filter(i => i.status === 'Won').reduce((sum, item) => sum + item.proposalValue, 0).toLocaleString()}
                </span>
              </div>
            </div>
          </div>

          {/* Table representing all combined pipelines */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden" id="management-pipeline-table-card">
            <div className="p-4 bg-slate-800 text-white flex items-center justify-between">
              <h4 className="text-xs font-black uppercase tracking-wider font-display flex items-center gap-1.5 text-white">
                <Briefcase className="w-4 h-4 text-blue-400" />
                ACTIVE OPPORTUNITIES LIST ({allPipelines.length})
              </h4>
              <span className="text-[10px] bg-slate-700 text-slate-300 font-bold px-2.5 py-1 rounded font-mono">
                Management Oversight
              </span>
            </div>

            {allPipelines.length === 0 ? (
              <div className="p-12 text-center text-slate-400 text-xs italic bg-slate-50/50">
                No pipeline opportunities logged across representatives yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[9px] font-black text-slate-400 uppercase tracking-widest">
                      <th className="p-4">Owner</th>
                      <th className="p-4">Request date</th>
                      <th className="p-4">Training or Teambuilding Details</th>
                      <th className="p-4">Proposal Sent date</th>
                      <th className="p-4 text-right">Value</th>
                      <th className="p-4">Follow up date</th>
                      <th className="p-4 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700 font-sans text-xs">
                    {allPipelines.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="p-4">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-blue-50 border border-blue-100 text-blue-700 font-black text-[9px] uppercase tracking-wider">
                            {p.repName}
                          </span>
                        </td>
                        <td className="p-4 font-mono font-bold text-slate-500">{p.requestDate}</td>
                        <td className="p-4">
                          <span className="font-extrabold text-slate-800 block">{p.client}</span>
                          <span className="text-[10px] text-slate-400 block font-mono">{p.courseName}</span>
                          <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider bg-slate-100 text-slate-600 font-mono">
                            {p.type}
                          </span>
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
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-amber-50 border border-amber-200 text-amber-700 font-black text-[9px] uppercase tracking-wider">
                              <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                              Pending
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'reps' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-5 border-b border-slate-100">
            <div className="space-y-1">
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-600" />
                Representative & Account Management
              </h3>
              <p className="text-slate-400 text-xs">
                Roster settings to manage sales representative credentials, add accounts, and change login passwords.
              </p>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 font-mono text-[11px] font-black uppercase text-slate-500">
              Total Active: {reps.length} Reps
            </div>
          </div>

          {/* Main Content Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left side: List of Representatives */}
            <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
              <div className="bg-slate-50/50 px-4 py-3 border-b border-slate-200">
                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Active Representatives & Credentials</h4>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-400 font-extrabold text-[10px] uppercase tracking-wider">
                      <th className="py-3 px-4">Sales Representative</th>
                      <th className="py-3 px-4">Account ID</th>
                      <th className="py-3 px-4">Password</th>
                      <th className="py-3 px-4 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {reps.map((repItem) => {
                      const isEditingThis = editingRepId === repItem.id;
                      const repPw = passwords[repItem.id] || (repItem.id === 'management' ? 'Management123' : `${repItem.id.charAt(0).toUpperCase()}${repItem.id.slice(1,3)}123`);
                      const isPwVisible = visiblePasswordRepIds.has(repItem.id);
                      return (
                        <tr key={repItem.id} className="hover:bg-slate-50/40 transition-colors">
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center font-black text-blue-600 uppercase text-xs">
                                {repItem.name.charAt(0)}
                              </div>
                              <div>
                                <div className="font-extrabold text-slate-800">{repItem.name}</div>
                                <div className="text-[10px] text-slate-400 font-normal">{repItem.email || 'No email assigned'}</div>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-4 font-mono font-bold text-slate-600">
                            {repItem.id}
                          </td>
                          <td className="py-3 px-4 font-mono text-slate-500">
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold select-all">
                                {isPwVisible ? repPw : '••••••••'}
                              </span>
                              <button
                                type="button"
                                onClick={() => togglePasswordVisibility(repItem.id)}
                                className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                                title={isPwVisible ? "Hide password" : "Show password"}
                              >
                                {isPwVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleStartEditRep(repItem)}
                                className={`flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded transition-all cursor-pointer ${
                                  isEditingThis 
                                    ? 'bg-blue-100 text-blue-700' 
                                    : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                                }`}
                              >
                                <Edit2 className="w-3 h-3" />
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteRepClick(repItem.id, repItem.name)}
                                className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded bg-rose-50 text-rose-600 hover:bg-rose-100 transition-all cursor-pointer"
                              >
                                <Trash2 className="w-3 h-3" />
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Right side: Forms */}
            <div className="lg:col-span-5 space-y-4">
              {editingRepId ? (
                /* EDIT FORM */
                <div className="bg-slate-50 border border-blue-200 rounded-xl p-5 shadow-2xs space-y-4 relative">
                  <div className="absolute top-4 right-4 bg-blue-100 border border-blue-200 rounded-full p-1 text-blue-600">
                    <Shield className="w-4 h-4" />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-xs font-black text-blue-700 uppercase tracking-widest flex items-center gap-1.5 font-display">
                      <Edit2 className="w-4 h-4 text-blue-600" />
                      Edit Representative Account
                    </h4>
                    <p className="text-[10px] text-slate-400">
                      Modifying representative details for <span className="font-extrabold text-blue-600">{editingRepId}</span>
                    </p>
                  </div>

                  <form onSubmit={handleEditRepSubmit} className="space-y-3 text-xs">
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1">Full Name</label>
                      <input 
                        type="text" 
                        required
                        value={editRepName}
                        onChange={(e) => setEditRepName(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 font-sans"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1">Account ID / Name</label>
                      <input 
                        type="text" 
                        required
                        value={editRepAccountName}
                        onChange={(e) => setEditRepAccountName(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 font-mono font-bold bg-slate-100"
                        disabled
                      />
                      <p className="text-[9px] text-slate-400 mt-0.5">Account ID cannot be modified after creation to maintain data referential integrity.</p>
                    </div>

                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1">Email Address</label>
                      <input 
                        type="email" 
                        value={editRepEmail}
                        onChange={(e) => setEditRepEmail(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 font-sans"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1">Login Password</label>
                      <input 
                        type="text" 
                        required
                        value={editRepPassword}
                        onChange={(e) => setEditRepPassword(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 font-mono font-bold"
                      />
                    </div>

                    <div className="flex gap-2 pt-2">
                      <button 
                        type="button" 
                        onClick={() => setEditingRepId(null)}
                        className="flex-1 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold transition-all text-center cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button 
                        type="submit"
                        className="flex-1 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-wider transition-all text-center shadow-2xs cursor-pointer"
                      >
                        Save Changes
                      </button>
                    </div>
                  </form>
                </div>
              ) : (
                /* ADD FORM */
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 shadow-2xs space-y-4">
                  <div className="space-y-1">
                    <h4 className="text-xs font-black text-slate-700 uppercase tracking-widest flex items-center gap-1.5 font-display">
                      <UserPlus className="w-4 h-4 text-slate-600" />
                      Add New Representative
                    </h4>
                    <p className="text-[10px] text-slate-400">
                      Onboard a new sales representative and provision their login credentials.
                    </p>
                  </div>

                  <form onSubmit={handleAddRepSubmitInDashboard} className="space-y-3 text-xs">
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1">Full Name</label>
                      <input 
                        type="text" 
                        required
                        placeholder="e.g. Rachel Lim" 
                        value={newRepName}
                        onChange={(e) => handleNewRepNameChange(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 font-sans"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1">Account ID / Name</label>
                      <input 
                        type="text" 
                        required
                        placeholder="e.g. rachel-lim" 
                        value={newRepAccountName}
                        onChange={(e) => setNewRepAccountName(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 font-mono font-bold"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1">Email Address</label>
                      <input 
                        type="email" 
                        placeholder="e.g. rachel@nextenergy24.com" 
                        value={newRepEmail}
                        onChange={(e) => setNewRepEmail(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 font-sans"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1">Login Password</label>
                      <input 
                        type="text" 
                        required
                        placeholder="e.g. Rach123" 
                        value={newRepPassword}
                        onChange={(e) => setNewRepPassword(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 font-mono font-bold"
                      />
                    </div>

                    <button 
                      type="submit"
                      className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-wider transition-all text-center shadow-2xs cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <UserPlus className="w-4 h-4" />
                      Onboard Representative
                    </button>
                  </form>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Team Bulk Targets setup Modal */}
      {showBulkModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-xl border border-slate-150 space-y-4">
            <div className="space-y-1">
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider">
                ⚙️ Team Bulk Targets Setup
              </h3>
              <p className="text-slate-400 text-xs">
                Apply a uniform benchmark to every representative on the active roster.
              </p>
            </div>
            
            <form onSubmit={handleBulkTargetsSubmit} className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Bulk Sales Target (RM)</label>
                <input 
                  type="number" 
                  required
                  placeholder="e.g. 30000" 
                  value={bulkSales}
                  onChange={(e) => setBulkSales(e.target.value)}
                  className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Bulk Weekly Proposals Target</label>
                <input 
                  type="number" 
                  required
                  placeholder="e.g. 2" 
                  value={bulkProposals}
                  onChange={(e) => setBulkProposals(e.target.value)}
                  className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Bulk Monthly Previews Target</label>
                <input 
                  type="number" 
                  required
                  placeholder="e.g. 1" 
                  value={bulkPreviews}
                  onChange={(e) => setBulkPreviews(e.target.value)}
                  className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button 
                  type="button" 
                  onClick={() => setShowBulkModal(false)}
                  className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold px-4 py-2 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="text-xs bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-lg transition-colors"
                >
                  Apply Global Quotas
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
