import React from 'react';
import { Briefcase, Building2, Calendar, Award, TrendingUp, Users } from 'lucide-react';
import { JobFunnelStep, PartnerCompany } from '../types';
import { motion } from 'motion/react';

interface CareerHubProps {
  funnel: JobFunnelStep[];
  partners: PartnerCompany[];
}

export default function CareerHub({ funnel, partners }: CareerHubProps) {
  // Career metrics
  const careerStats = [
    { label: 'Overall Placement Rate', value: '89.2%', desc: 'Within 180 days of graduation', icon: Award, color: 'text-emerald-400', bgColor: 'bg-emerald-500/10' },
    { label: 'Avg Time to Placement', value: '42 Days', desc: 'Cohort average timeline', icon: Calendar, color: 'text-cyan-400', bgColor: 'bg-cyan-500/10' },
    { label: 'Avg Starting Salary', value: 'RM 4,500', desc: 'Industry junior engineer average', icon: TrendingUp, color: 'text-amber-400', bgColor: 'bg-amber-500/10' },
    { label: 'Hiring Partners', value: '45+ Active', desc: 'In Southeast Asia tech node', icon: Building2, color: 'text-violet-400', bgColor: 'bg-violet-500/10' }
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in" id="career-hub-section">
      
      {/* Stats and Funnel Panel */}
      <div className="lg:col-span-2 space-y-6">
        
        {/* Metric Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {careerStats.map((stat, idx) => {
            const Icon = stat.icon;
            return (
              <div 
                key={idx}
                className="p-5 bg-slate-900/40 border border-slate-800/80 rounded-2xl flex items-center justify-between"
              >
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider font-display">{stat.label}</p>
                  <p className="text-2xl font-bold font-mono text-white">{stat.value}</p>
                  <p className="text-[10px] text-slate-400">{stat.desc}</p>
                </div>
                <div className={`p-3 rounded-xl ${stat.bgColor} ${stat.color}`}>
                  <Icon className="w-5 h-5" />
                </div>
              </div>
            );
          })}
        </div>

        {/* Custom SVG Career/Hiring Conversion Funnel */}
        <div className="bg-slate-900/40 border border-slate-800/80 p-5 rounded-2xl space-y-4">
          <h3 className="text-sm font-bold text-white font-display uppercase tracking-wider">
            Graduation Outcome Pipeline Funnel
          </h3>
          <p className="text-xs text-slate-400">Conversion percentages indexed against total cumulative cohort graduates (N=184).</p>
          
          <div className="space-y-3.5 pt-2">
            {funnel.map((step, idx) => {
              // Custom gradient coordinates based on index for aesthetic variation
              return (
                <div key={idx} className="space-y-1.5">
                  <div className="flex justify-between text-xs font-semibold font-display text-slate-300">
                    <span className="flex items-center gap-1.5">
                      <span className="w-4 h-4 bg-slate-800 rounded-md border border-slate-750 font-mono text-[9px] flex items-center justify-center text-slate-400">{idx+1}</span>
                      {step.stage}
                    </span>
                    <span className="font-mono text-slate-400">{step.count} Graduates <span className="text-cyan-400">({step.percentage}%)</span></span>
                  </div>
                  
                  {/* Process/Funnel SVG Horizontal bar */}
                  <div className="relative w-full h-7 bg-slate-950/60 rounded-lg overflow-hidden border border-slate-850/60">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${step.percentage}%` }}
                      transition={{ duration: 0.8, delay: idx * 0.1 }}
                      className="absolute left-0 top-0 h-full rounded-l-lg bg-gradient-to-r from-cyan-500/20 to-indigo-500/20 border-r border-indigo-400/40 flex items-center pl-3.5"
                    >
                      <span className="text-[10px] text-indigo-300 font-bold font-mono">
                        Stage {idx+1}
                      </span>
                    </motion.div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      </div>

      {/* Hiring Partners Column */}
      <div className="lg:col-span-1 space-y-4">
        <div className="bg-slate-900/40 border border-slate-800/80 p-5 rounded-2xl space-y-4">
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-cyan-400" />
            <h3 className="text-sm font-bold text-white font-display uppercase tracking-wider">
              Top Hiring Partner Network
            </h3>
          </div>
          <p className="text-xs text-slate-400">Corporate partners actively employing NEXT Academy bootcamps alumni in Southeast Asia.</p>

          <div className="divide-y divide-slate-800/60">
            {partners.map((p, idx) => {
              return (
                <div key={idx} className="py-3 flex items-center justify-between group first:pt-0 last:pb-0">
                  <div className="flex items-center gap-3">
                    {/* Visual Mock Logo Initial */}
                    <div 
                      className="w-9 h-9 rounded-xl flex items-center justify-center font-display text-xs font-bold text-white"
                      style={{ backgroundColor: `${p.logoColor}15`, border: `1px solid ${p.logoColor}30`, color: p.logoColor }}
                    >
                      {p.name[0]}
                    </div>
                    <div>
                      <p className="text-xs font-bold text-white group-hover:text-cyan-400 transition-colors">{p.name}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">{p.industry}</p>
                    </div>
                  </div>
                  
                  <div className="text-right">
                    <p className="text-xs font-bold font-mono text-white">{p.hiresCount} Hires</p>
                    <p className="text-[9px] text-slate-400 uppercase tracking-widest mt-0.5 font-semibold">Alumni Placed</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

    </div>
  );
}
