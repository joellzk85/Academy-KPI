import React from 'react';
import { Users, GraduationCap, Clock, Award, TrendingUp } from 'lucide-react';
import { motion } from 'motion/react';

interface MetricCardsProps {
  studentsCount: number;
  averageGrade: number;
  attendanceAverage: number;
  placementRate: number;
}

export default function MetricCards({
  studentsCount,
  averageGrade,
  attendanceAverage,
  placementRate,
}: MetricCardsProps) {
  const cards = [
    {
      id: 'metric-students',
      title: 'Active Students',
      value: studentsCount,
      sub: '+4 this month',
      icon: Users,
      color: 'text-cyan-400',
      bgColor: 'bg-cyan-500/10',
      borderColor: 'border-cyan-500/20',
      trend: '+15.3%'
    },
    {
      id: 'metric-grade',
      title: 'Average Grade',
      value: `${averageGrade.toFixed(1)}%`,
      sub: 'Passing threshold: 70%',
      icon: Award,
      color: 'text-violet-400',
      bgColor: 'bg-violet-500/10',
      borderColor: 'border-violet-500/20',
      trend: '+2.1% wk/wk'
    },
    {
      id: 'metric-attendance',
      title: 'Avg Attendance',
      value: `${attendanceAverage.toFixed(1)}%`,
      sub: 'Target rate: >90%',
      icon: Clock,
      color: 'text-amber-400',
      bgColor: 'bg-amber-500/10',
      borderColor: 'border-amber-500/20',
      trend: 'Steady'
    },
    {
      id: 'metric-placement',
      title: 'Job Placement',
      value: `${placementRate}%`,
      sub: 'Within 90 days',
      icon: GraduationCap,
      color: 'text-emerald-400',
      bgColor: 'bg-emerald-500/10',
      borderColor: 'border-emerald-500/20',
      trend: '+4.8% yr/yr'
    }
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4" id="executive-metric-cards">
      {cards.map((card, idx) => {
        const Icon = card.icon;
        return (
          <motion.div
            key={card.id}
            id={card.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: idx * 0.1 }}
            className={`p-5 rounded-2xl bg-slate-900/60 border ${card.borderColor} backdrop-blur-md relative overflow-hidden group hover:border-slate-700 transition-colors duration-300`}
          >
            {/* Subtle glow effect on hover */}
            <div className={`absolute -right-4 -bottom-4 w-24 h-24 rounded-full blur-2xl opacity-10 group-hover:opacity-20 transition-opacity duration-300 ${card.bgColor}`} />
            
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-400 tracking-wider uppercase font-display">
                  {card.title}
                </p>
                <h3 className="text-3xl font-bold mt-2 font-mono text-white tracking-tight">
                  {card.value}
                </h3>
              </div>
              <div className={`p-3 rounded-xl ${card.bgColor} ${card.color}`}>
                <Icon className="w-6 h-6" />
              </div>
            </div>

            <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-800/60 text-xs">
              <span className="text-slate-400">{card.sub}</span>
              <span className={`font-mono flex items-center gap-1 font-semibold ${card.trend === 'Steady' ? 'text-slate-400' : 'text-emerald-400'}`}>
                {card.trend !== 'Steady' && <TrendingUp className="w-3.5 h-3.5" />}
                {card.trend}
              </span>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
