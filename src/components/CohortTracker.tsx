import React, { useState } from 'react';
import { Search, AlertCircle, Filter, FileText, Sparkles, User, ArrowRight, ArrowUpDown, ChevronRight, Check } from 'lucide-react';
import { Cohort, Student } from '../types';
import StudentModal from './StudentModal';
import { motion, AnimatePresence } from 'motion/react';

interface CohortTrackerProps {
  cohorts: Cohort[];
  students: Student[];
}

export default function CohortTracker({ cohorts, students }: CohortTrackerProps) {
  const [selectedCohortId, setSelectedCohortId] = useState(cohorts[0]?.id || '');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRisk, setSelectedRisk] = useState<'All' | 'Low' | 'Medium' | 'High'>('All');
  const [activeStudent, setActiveStudent] = useState<Student | null>(null);
  
  // Cohort report generation state
  const [cohortReportLoading, setCohortReportLoading] = useState(false);
  const [cohortReport, setCohortReport] = useState<string | null>(null);

  // Active Cohort details
  const activeCohort = cohorts.find(c => c.id === selectedCohortId);
  const cohortStudents = students.filter(s => s.cohortId === selectedCohortId);

  // Filters
  const filteredStudents = cohortStudents.filter(student => {
    const matchesSearch = student.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          student.email.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRisk = selectedRisk === 'All' || student.riskScore === selectedRisk;
    return matchesSearch && matchesRisk;
  });

  const highRiskCount = cohortStudents.filter(s => s.riskScore === 'High').length;
  const mediumRiskCount = cohortStudents.filter(s => s.riskScore === 'Medium').length;

  const handleGenerateCohortReport = async () => {
    if (!activeCohort) return;
    setCohortReportLoading(true);
    setCohortReport(null);

    try {
      const summaryPayload = {
        cohort: activeCohort,
        studentsSummary: cohortStudents.map(s => ({
          name: s.name,
          attendance: s.attendanceRate,
          assignments: `${s.assignmentsCompleted}/${s.assignmentsTotal}`,
          grade: s.currentGrade,
          risk: s.riskScore
        }))
      };

      const prompt = `Conduct a comprehensive administrative cohort performance report for "${activeCohort.name}". Its current week is ${activeCohort.weekCurrent} of ${activeCohort.weekTotal}. Average grade is ${activeCohort.averageGrade}%, and cohort attendance average is ${activeCohort.attendanceAverage}%. Here is the roster of student metrics: ${JSON.stringify(summaryPayload.studentsSummary)}. Write an expert coordinator summary outlining overall cohort pace, listing key struggling students requiring priority support, and suggesting curriculum adjustments or mentorship strategies for the upcoming week. Use clear headings.`;

      const response = await fetch('/api/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', text: prompt }],
          datasetContext: summaryPayload
        })
      });

      const data = await response.json();
      if (response.ok) {
        setCohortReport(data.response);
      } else {
        setCohortReport(`Failed: ${data.details || "Could not generate report."}`);
      }
    } catch (err: any) {
      console.error(err);
      setCohortReport(`Connection Error: ${err.message || "Failed to reach server."}`);
    } finally {
      setCohortReportLoading(false);
    }
  };

  return (
    <div className="space-y-6" id="cohort-tracker-section">
      
      {/* Tab Selectors for Cohorts */}
      <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-4" id="cohort-tab-container">
        {cohorts.map((cohort) => {
          const isActive = cohort.id === selectedCohortId;
          return (
            <button
              key={cohort.id}
              onClick={() => {
                setSelectedCohortId(cohort.id);
                setSearchQuery('');
                setSelectedRisk('All');
                setCohortReport(null);
              }}
              className={`px-4 py-2.5 rounded-xl text-xs font-semibold font-display transition-all duration-200 cursor-pointer ${
                isActive 
                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 shadow-md shadow-cyan-950/20' 
                  : 'text-slate-400 hover:text-white hover:bg-slate-900/60 border border-transparent'
              }`}
            >
              {cohort.name}
              {cohort.status === 'upcoming' && (
                <span className="ml-1.5 px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded text-[9px] uppercase font-mono">
                  Prep
                </span>
              )}
            </button>
          );
        })}
      </div>

      {activeCohort && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Cohort Stats Summary Card */}
          <div className="lg:col-span-1 bg-slate-900/40 border border-slate-800/80 p-5 rounded-2xl flex flex-col justify-between space-y-4 h-fit">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold text-cyan-400 uppercase tracking-wider bg-cyan-500/5 px-2.5 py-1 rounded-lg border border-cyan-500/10">
                  {activeCohort.courseType}
                </span>
                {activeCohort.status === 'active' && (
                  <span className="text-xs text-slate-400 font-semibold flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    Week {activeCohort.weekCurrent} / {activeCohort.weekTotal}
                  </span>
                )}
              </div>

              <h3 className="text-lg font-bold text-white mt-4 font-display">
                {activeCohort.name}
              </h3>
              
              {/* Core Mentors */}
              <div className="mt-4 pt-4 border-t border-slate-800/60 space-y-2">
                <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider font-display">Lead Cohort Mentors</p>
                <div className="flex flex-wrap gap-2">
                  {activeCohort.mentors.map((m, idx) => (
                    <span key={idx} className="text-xs bg-slate-800 text-slate-300 px-2.5 py-1 rounded-lg border border-slate-700/40">
                      {m}
                    </span>
                  ))}
                </div>
              </div>

              {/* Progress Slider Bar */}
              {activeCohort.status === 'active' && (
                <div className="mt-4 space-y-2">
                  <div className="flex justify-between text-xs text-slate-400 font-semibold">
                    <span>Course Timeline</span>
                    <span>{Math.round((activeCohort.weekCurrent / activeCohort.weekTotal) * 100)}% Complete</span>
                  </div>
                  <div className="w-full bg-slate-850 h-2 rounded-full overflow-hidden">
                    <div 
                      className="bg-gradient-to-r from-cyan-500 to-indigo-500 h-full rounded-full transition-all duration-500"
                      style={{ width: `${(activeCohort.weekCurrent / activeCohort.weekTotal) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Warnings/Advisory Summary */}
              {activeCohort.status === 'active' && (
                <div className="mt-4 p-4 bg-slate-950/40 rounded-xl border border-slate-800/60 space-y-2.5">
                  <div className="flex items-center gap-2 text-xs font-bold text-white font-display">
                    <AlertCircle className="w-4 h-4 text-rose-400" />
                    <span>Risk Indicators</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="bg-slate-900/50 p-2.5 rounded-lg text-center border border-slate-800/40">
                      <p className="text-slate-400 text-[10px] uppercase font-semibold">High Risk</p>
                      <p className={`text-lg font-bold mt-1 font-mono ${highRiskCount > 0 ? 'text-rose-400' : 'text-slate-300'}`}>{highRiskCount}</p>
                    </div>
                    <div className="bg-slate-900/50 p-2.5 rounded-lg text-center border border-slate-800/40">
                      <p className="text-slate-400 text-[10px] uppercase font-semibold">Medium Risk</p>
                      <p className={`text-lg font-bold mt-1 font-mono ${mediumRiskCount > 0 ? 'text-amber-400' : 'text-slate-300'}`}>{mediumRiskCount}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* AI Summary Report Trigger */}
            {activeCohort.status === 'active' && (
              <div className="pt-4 border-t border-slate-800/60">
                <button
                  onClick={handleGenerateCohortReport}
                  disabled={cohortReportLoading}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-750 text-slate-200 rounded-xl text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer border border-slate-700/30"
                  id="generate-cohort-report-btn"
                >
                  <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                  {cohortReportLoading ? "Synthesizing Report..." : "AI Cohort Health Report"}
                </button>
              </div>
            )}
          </div>

          {/* Student Roster Table Card */}
          <div className="lg:col-span-2 space-y-4">
            
            {/* Search and Filters bar */}
            <div className="flex flex-col sm:flex-row gap-3 items-center justify-between bg-slate-900/30 p-4 border border-slate-800/80 rounded-2xl">
              <div className="relative w-full sm:max-w-xs">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 transform -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search students..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-slate-950 border border-slate-850 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 transition-colors"
                />
              </div>

              {/* Risk category filters */}
              <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
                <Filter className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                {(['All', 'Low', 'Medium', 'High'] as const).map((risk) => {
                  const isSel = selectedRisk === risk;
                  return (
                    <button
                      key={risk}
                      onClick={() => setSelectedRisk(risk)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors ${
                        isSel 
                          ? 'bg-slate-800 text-white border border-slate-700' 
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
                      }`}
                    >
                      {risk} {risk !== 'All' && 'Risk'}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Roster Listing Grid/Table */}
            <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl overflow-hidden" id="student-roster-card">
              {filteredStudents.length === 0 ? (
                <div className="py-12 text-center text-slate-500 text-xs">
                  No students match the active search/filter criteria.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-950/40 text-[10px] font-bold font-display uppercase text-slate-400 tracking-wider">
                        <th className="py-3 px-4">Student</th>
                        <th className="py-3 px-4 text-center">Attendance</th>
                        <th className="py-3 px-4 text-center">Assignments</th>
                        <th className="py-3 px-4 text-center">Grade</th>
                        <th className="py-3 px-4 text-center">Risk Index</th>
                        <th className="py-3 px-4"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {filteredStudents.map((student) => {
                        return (
                          <tr
                            key={student.id}
                            onClick={() => setActiveStudent(student)}
                            className="hover:bg-slate-800/35 cursor-pointer transition-colors duration-150 group"
                          >
                            <td className="py-3.5 px-4 flex items-center gap-3">
                              <div className="w-8 h-8 rounded-xl bg-slate-800 border border-slate-700/50 flex items-center justify-center font-display text-xs font-bold text-cyan-400">
                                {student.name.split(' ').map(n => n[0]).join('').substring(0, 2)}
                              </div>
                              <div>
                                <p className="text-xs font-bold text-white group-hover:text-cyan-400 transition-colors">{student.name}</p>
                                <p className="text-[10px] text-slate-400 mt-0.5">{student.email}</p>
                              </div>
                            </td>

                            <td className="py-3.5 px-4 text-center font-mono text-xs font-semibold">
                              <span className={student.attendanceRate < 85 ? 'text-rose-400' : 'text-slate-300'}>
                                {student.attendanceRate}%
                              </span>
                            </td>

                            <td className="py-3.5 px-4 text-center font-mono text-xs text-slate-400">
                              {student.assignmentsCompleted} / {student.assignmentsTotal}
                            </td>

                            <td className="py-3.5 px-4 text-center">
                              <span className="px-2 py-1 bg-violet-500/10 border border-violet-500/20 text-violet-400 rounded-lg text-xs font-mono font-bold">
                                {student.currentGrade}%
                              </span>
                            </td>

                            <td className="py-3.5 px-4 text-center">
                              <span className={`inline-flex px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase ${
                                student.riskScore === 'High' 
                                  ? 'bg-rose-500/10 border border-rose-500/20 text-rose-400' 
                                  : student.riskScore === 'Medium' 
                                    ? 'bg-amber-500/10 border border-amber-500/20 text-amber-400' 
                                    : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                              }`}>
                                {student.riskScore}
                              </span>
                            </td>

                            <td className="py-3.5 px-4 text-right">
                              <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-white transition-colors" />
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
      )}

      {/* Cohort Report Output Modal/Panel */}
      <AnimatePresence>
        {cohortReport && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="p-5 rounded-2xl border border-slate-800 bg-slate-900/80 backdrop-blur-md relative"
            id="cohort-health-report-output"
          >
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3 mb-4">
              <span className="text-xs font-bold font-display uppercase tracking-wider text-cyan-400 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-cyan-400 animate-pulse" />
                NExt Academic Cohort Health Assessment: {activeCohort?.name}
              </span>
              <button
                onClick={() => setCohortReport(null)}
                className="text-xs text-slate-400 hover:text-white py-1 px-2.5 rounded-lg bg-slate-950 border border-slate-850 cursor-pointer"
              >
                Close Report
              </button>
            </div>
            <div className="text-sm text-slate-300 leading-relaxed font-sans whitespace-pre-line max-h-[350px] overflow-y-auto pr-2 prose prose-invert max-w-none">
              {cohortReport}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Student Detail Modal */}
      <StudentModal
        student={activeStudent}
        cohortName={activeCohort?.name || ''}
        onClose={() => setActiveStudent(null)}
      />

    </div>
  );
}
