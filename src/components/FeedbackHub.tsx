import React from 'react';
import { MessageSquareCode, Award, Smile, Frown, Sparkles } from 'lucide-react';
import { FeedbackItem } from '../types';

interface FeedbackHubProps {
  feedback: FeedbackItem[];
}

export default function FeedbackHub({ feedback }: FeedbackHubProps) {
  // Compute basic sentiment counts
  const excellentCount = feedback.filter(f => f.sentiment === 'Excellent').length;
  const goodCount = feedback.filter(f => f.sentiment === 'Good').length;
  const neutralCount = feedback.filter(f => f.sentiment === 'Neutral').length;
  const poorCount = feedback.filter(f => f.sentiment === 'Poor').length;
  const totalFeedback = feedback.length || 1;

  // Render a lovely custom SVG gauge chart for NPS
  const npsScore = 74; // Standard Malaysian Bootcamp high score

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in" id="feedback-hub-section">
      
      {/* Sentiment & NPS Gauges */}
      <div className="lg:col-span-1 space-y-6">
        
        {/* NPS Card */}
        <div className="bg-slate-900/40 border border-slate-800/80 p-5 rounded-2xl flex flex-col items-center text-center space-y-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider font-display">
            Net Promoter Score (NPS)
          </h3>
          
          <div className="relative w-36 h-36 flex items-center justify-center">
            {/* SVG Arc Gauge */}
            <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="40" stroke="#1e293b" strokeWidth="8" fill="none" />
              <circle 
                cx="50" 
                cy="50" 
                r="40" 
                stroke="url(#npsGrad)" 
                strokeWidth="8" 
                strokeDasharray={`${(npsScore / 100) * 251.2} 251.2`}
                strokeLinecap="round" 
                fill="none" 
              />
              <defs>
                <linearGradient id="npsGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#22d3ee" />
                  <stop offset="100%" stopColor="#8b5cf6" />
                </linearGradient>
              </defs>
            </svg>
            <div className="absolute text-center space-y-0.5">
              <span className="text-4xl font-bold font-mono text-white">+{npsScore}</span>
              <p className="text-[9px] uppercase tracking-widest text-slate-400 font-semibold font-display">Excellent Node</p>
            </div>
          </div>

          <p className="text-xs text-slate-400 max-w-[200px]">
            Based on student feedback surveys submitted after Week 4 midterms.
          </p>
        </div>

        {/* Sentiment breakdown card */}
        <div className="bg-slate-900/40 border border-slate-800/80 p-5 rounded-2xl space-y-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider font-display">
            Sentiment Breakdown
          </h3>
          
          <div className="space-y-3">
            {[
              { label: 'Excellent', count: excellentCount, pct: Math.round((excellentCount / totalFeedback) * 100), color: 'bg-emerald-500', barCol: 'bg-emerald-500/10' },
              { label: 'Good', count: goodCount, pct: Math.round((goodCount / totalFeedback) * 100), color: 'bg-cyan-500', barCol: 'bg-cyan-500/10' },
              { label: 'Neutral', count: neutralCount, pct: Math.round((neutralCount / totalFeedback) * 100), color: 'bg-amber-500', barCol: 'bg-amber-500/10' },
              { label: 'Poor', count: poorCount, pct: Math.round((poorCount / totalFeedback) * 100), color: 'bg-rose-500', barCol: 'bg-rose-500/10' }
            ].map((sentiment, i) => (
              <div key={i} className="space-y-1.5">
                <div className="flex justify-between items-center text-xs font-semibold font-display text-slate-300">
                  <span className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${sentiment.color}`} />
                    {sentiment.label}
                  </span>
                  <span className="font-mono text-slate-400">{sentiment.count} surveys <span className="text-cyan-400">({sentiment.pct}%)</span></span>
                </div>
                <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-900">
                  <div className={`h-full ${sentiment.color} rounded-full`} style={{ width: `${sentiment.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* Anonymous Feedback Logs */}
      <div className="lg:col-span-2 space-y-4">
        <h3 className="text-sm font-bold text-white font-display uppercase tracking-wider flex items-center gap-2">
          <MessageSquareCode className="w-5 h-5 text-cyan-400" />
          Student Feedback Comments Log
        </h3>
        
        <div className="space-y-3.5 max-h-[500px] overflow-y-auto pr-2">
          {feedback.map((item) => {
            const isExcellent = item.sentiment === 'Excellent' || item.sentiment === 'Good';
            return (
              <div 
                key={item.id}
                className="p-4 bg-slate-900/40 border border-slate-800/80 rounded-2xl space-y-3 relative overflow-hidden"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <span className="text-[9px] uppercase tracking-wider font-mono font-bold px-2 py-0.5 bg-slate-800 text-slate-400 rounded border border-slate-750">
                      {item.cohortName}
                    </span>
                    <p className="text-[10px] text-slate-500 mt-1">{item.date}</p>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-slate-300 bg-slate-950/80 px-2 py-0.5 rounded-lg border border-slate-850">
                      Score: {item.rating}/10
                    </span>
                    <span className={`inline-flex px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase ${
                      item.sentiment === 'Excellent' 
                        ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' 
                        : item.sentiment === 'Good'
                          ? 'bg-cyan-500/10 border border-cyan-500/20 text-cyan-400'
                          : item.sentiment === 'Neutral'
                            ? 'bg-amber-500/10 border border-amber-500/20 text-amber-400'
                            : 'bg-rose-500/10 border border-rose-500/20 text-rose-400'
                    }`}>
                      {item.sentiment}
                    </span>
                  </div>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed italic">
                  "{item.comment}"
                </p>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}
