import React, { useState } from 'react';
import { X, Mail, AlertTriangle, Check, Sparkles, Copy, FileText, Calendar, BookOpen } from 'lucide-react';
import { Student } from '../types';
import { motion, AnimatePresence } from 'motion/react';

interface StudentModalProps {
  student: Student | null;
  onClose: () => void;
  cohortName: string;
}

export default function StudentModal({ student, onClose, cohortName }: StudentModalProps) {
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResponse, setAiResponse] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [reportType, setReportType] = useState<'email' | 'summary' | null>(null);

  if (!student) return null;

  const handleGenerateAI = async (type: 'email' | 'summary') => {
    setAiLoading(true);
    setReportType(type);
    setAiResponse(null);
    setCopied(false);

    try {
      const promptText = type === 'email' 
        ? `Draft a warm, encouraging, and supportive academic outreach email template for our student ${student.name}. They are in the ${cohortName} cohort. Their current attendance rate is ${student.attendanceRate}%, assignments completion is ${student.assignmentsCompleted}/${student.assignmentsTotal}, and current overall grade is ${student.currentGrade}%. Here are our mentor notes about them: "${student.notes}". Keep it supportive and invite them to schedule a 1-on-1 mentorship sync.`
        : `Generate an intensive academic performance report and personalized study recommendation plan for student ${student.name} in our ${cohortName} cohort. Their current attendance rate is ${student.attendanceRate}%, assignments completion is ${student.assignmentsCompleted}/${student.assignmentsTotal}, and current overall grade is ${student.currentGrade}%. Here are the weekly grade progress logs: ${JSON.stringify(student.weeklyGrades)} and mentor notes: "${student.notes}". Break the advice into: 1. Core strengths, 2. Areas of focus, and 3. A structured 2-week learning roadmap.`;

      const response = await fetch('/api/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', text: promptText }],
          datasetContext: { selectedStudent: student, cohort: cohortName }
        })
      });

      const data = await response.json();
      if (response.ok) {
        setAiResponse(data.response);
      } else {
        setAiResponse(`Error: ${data.details || "Failed to generate plan."}`);
      }
    } catch (err: any) {
      console.error(err);
      setAiResponse(`Connection error: ${err.message || "Failed to contact co-pilot server."}`);
    } finally {
      setAiLoading(false);
    }
  };

  const handleCopy = () => {
    if (!aiResponse) return;
    navigator.clipboard.writeText(aiResponse);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // SVG Chart Calculations
  const maxGrade = 100;
  const padding = 40;
  const chartHeight = 120;
  const chartWidth = 360;
  const points = student.weeklyGrades.map((grade, index) => {
    const x = padding + (index * (chartWidth - padding * 2)) / (student.weeklyGrades.length - 1 || 1);
    const y = chartHeight - padding - (grade * (chartHeight - padding * 2)) / maxGrade;
    return { x, y, grade, week: index + 1 };
  });

  const dPath = points.length > 0 
    ? `M ${points[0].x} ${points[0].y} ` + points.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ')
    : '';

  const areaPath = points.length > 0
    ? `${dPath} L ${points[points.length - 1].x} ${chartHeight - padding} L ${points[0].x} ${chartHeight - padding} Z`
    : '';

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" id="student-modal-container">
        {/* Modal Panel */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          transition={{ duration: 0.3 }}
          className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col"
          id="student-detail-modal"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-slate-800 bg-slate-950/60">
            <div className="flex items-center gap-3">
              <div className={`p-2.5 rounded-xl ${student.riskScore === 'High' ? 'bg-rose-500/10 text-rose-400' : student.riskScore === 'Medium' ? 'bg-amber-500/10 text-amber-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                {student.riskScore !== 'Low' ? <AlertTriangle className="w-6 h-6" /> : <BookOpen className="w-6 h-6" />}
              </div>
              <div>
                <h2 className="text-xl font-bold font-display text-white">{student.name}</h2>
                <p className="text-xs text-slate-400 mt-0.5">{cohortName} • {student.email}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800/80 transition-colors"
              id="close-student-modal-btn"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Modal Body */}
          <div className="overflow-y-auto p-6 space-y-6 flex-1">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              
              {/* Numeric Gauges Column */}
              <div className="space-y-4">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 font-display">Performance Indexes</h4>
                
                {/* Attendance Gauge */}
                <div className="p-4 bg-slate-950/40 border border-slate-800/60 rounded-xl flex items-center justify-between">
                  <div>
                    <p className="text-xs text-slate-400">Attendance Rate</p>
                    <p className="text-2xl font-bold font-mono text-white mt-1">{student.attendanceRate}%</p>
                  </div>
                  {/* Mini Circular Progress */}
                  <div className="relative w-12 h-12">
                    <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                      <path className="text-slate-800" strokeWidth="3" stroke="currentColor" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                      <path className={student.attendanceRate < 85 ? "text-rose-400" : "text-cyan-400"} strokeWidth="3" strokeDasharray={`${student.attendanceRate}, 100`} strokeLinecap="round" stroke="currentColor" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                    </svg>
                  </div>
                </div>

                {/* Grade Gauge */}
                <div className="p-4 bg-slate-950/40 border border-slate-800/60 rounded-xl flex items-center justify-between">
                  <div>
                    <p className="text-xs text-slate-400">Current Grade</p>
                    <p className="text-2xl font-bold font-mono text-white mt-1">{student.currentGrade}%</p>
                  </div>
                  <div className="relative w-12 h-12">
                    <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                      <path className="text-slate-800" strokeWidth="3" stroke="currentColor" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                      <path className="text-violet-400" strokeWidth="3" strokeDasharray={`${student.currentGrade}, 100`} strokeLinecap="round" stroke="currentColor" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                    </svg>
                  </div>
                </div>

                {/* Assignment Gauge */}
                <div className="p-4 bg-slate-950/40 border border-slate-800/60 rounded-xl flex items-center justify-between">
                  <div>
                    <p className="text-xs text-slate-400">Assignments Done</p>
                    <p className="text-2xl font-bold font-mono text-white mt-1">{student.assignmentsCompleted} / {student.assignmentsTotal}</p>
                  </div>
                  <div className="relative w-12 h-12">
                    <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                      <path className="text-slate-800" strokeWidth="3" stroke="currentColor" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                      <path className="text-emerald-400" strokeWidth="3" strokeDasharray={`${(student.assignmentsCompleted / student.assignmentsTotal) * 100}, 100`} strokeLinecap="round" stroke="currentColor" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                    </svg>
                  </div>
                </div>

              </div>

              {/* Progress Line Chart Column */}
              <div className="md:col-span-2 space-y-4">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 font-display">Weekly Progress Curve</h4>
                
                <div className="p-4 bg-slate-950/40 border border-slate-800/60 rounded-xl relative">
                  {points.length === 0 ? (
                    <div className="h-[120px] flex items-center justify-center text-slate-500 text-sm">No grades recorded yet.</div>
                  ) : (
                    <div className="w-full">
                      <svg className="w-full h-[120px]" viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none">
                        {/* Area Gradient */}
                        <defs>
                          <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.3" />
                            <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
                          </linearGradient>
                        </defs>
                        
                        {/* Horizontal Gridlines */}
                        <line x1={padding} y1={padding} x2={chartWidth - padding} y2={padding} stroke="#1e293b" strokeDasharray="3,3" />
                        <line x1={padding} y1={(chartHeight) / 2} x2={chartWidth - padding} y2={(chartHeight) / 2} stroke="#1e293b" strokeDasharray="3,3" />
                        <line x1={padding} y1={chartHeight - padding} x2={chartWidth - padding} y2={chartHeight - padding} stroke="#1e293b" strokeDasharray="3,3" />
                        
                        {/* Paths */}
                        <path d={areaPath} fill="url(#chartGrad)" />
                        <path d={dPath} fill="none" stroke="#a78bfa" strokeWidth="2" />
                        
                        {/* Coordinate Dots */}
                        {points.map((p, i) => (
                          <g key={i}>
                            <circle cx={p.x} cy={p.y} r="4" fill="#8b5cf6" className="cursor-pointer hover:r-6 transition-all" />
                            <text x={p.x} y={p.y - 10} fill="#f3f4f6" fontSize="9" textAnchor="middle" fontFamily="monospace">
                              {p.grade}%
                            </text>
                            <text x={p.x} y={chartHeight - 12} fill="#94a3b8" fontSize="8" textAnchor="middle">
                              W{p.week}
                            </text>
                          </g>
                        ))}
                      </svg>
                    </div>
                  )}
                </div>

                <div className="bg-slate-900/60 p-4 border border-slate-800/40 rounded-xl">
                  <p className="text-xs font-semibold text-slate-400 uppercase font-display mb-1.5">Coordinator & Mentor Notes</p>
                  <p className="text-sm text-slate-300 leading-relaxed italic">
                    "{student.notes}"
                  </p>
                </div>
              </div>

            </div>

            {/* AI Academic Advisor Console */}
            <div className="border-t border-slate-800/80 pt-6 space-y-4" id="ai-academic-advisor-console">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h4 className="text-sm font-bold text-white font-display flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-cyan-400" />
                    NEXT Academic Co-Pilot (Gemini AI)
                  </h4>
                  <p className="text-xs text-slate-400 mt-1">Use the Gemini model to synthesize student data and construct custom coordinator drafts.</p>
                </div>
                
                <div className="flex flex-wrap gap-2.5">
                  <button
                    disabled={aiLoading}
                    onClick={() => handleGenerateAI('email')}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-50 text-xs font-semibold transition-colors cursor-pointer"
                    id="generate-outreach-email-btn"
                  >
                    <Mail className="w-3.5 h-3.5" />
                    Draft Outreach Email
                  </button>
                  <button
                    disabled={aiLoading}
                    onClick={() => handleGenerateAI('summary')}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white disabled:opacity-50 text-xs font-semibold transition-all shadow-md cursor-pointer"
                    id="generate-study-roadmap-btn"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    Create Study Roadmap
                  </button>
                </div>
              </div>

              {/* AI Content Area */}
              {(aiLoading || aiResponse) && (
                <div className="p-5 rounded-xl border border-slate-800 bg-slate-950/70 space-y-4">
                  {aiLoading ? (
                    <div className="flex flex-col items-center justify-center py-6 space-y-2">
                      <div className="w-6 h-6 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                      <p className="text-xs text-slate-400">Consulting Academic Co-Pilot (Gemini-3.5-flash)...</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider font-display flex items-center gap-1">
                          <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                          Generated {reportType === 'email' ? 'Outreach Draft' : 'Study Roadmap'}
                        </span>
                        <button
                          onClick={handleCopy}
                          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors py-1 px-2.5 rounded-lg bg-slate-900 border border-slate-800/60 cursor-pointer"
                        >
                          {copied ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                              <span className="text-emerald-400 font-semibold">Copied!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span>Copy Text</span>
                            </>
                          )}
                        </button>
                      </div>
                      <div className="text-sm text-slate-300 leading-relaxed whitespace-pre-line font-sans prose prose-invert max-w-none max-h-[300px] overflow-y-auto pr-2">
                        {aiResponse}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
