import React from 'react';
import { Clock, User, CheckCircle2, PlayCircle, Calendar, Plus } from 'lucide-react';
import { ScheduleItem } from '../types';

interface ScheduleHubProps {
  schedule: ScheduleItem[];
}

export default function ScheduleHub({ schedule }: ScheduleHubProps) {
  // Helpers for category colors
  const getTypeStyles = (type: ScheduleItem['type']) => {
    switch (type) {
      case 'Lecture':
        return { bg: 'bg-violet-500/10', border: 'border-violet-500/20', text: 'text-violet-400' };
      case 'Lab Session':
        return { bg: 'bg-cyan-500/10', border: 'border-cyan-500/20', text: 'text-cyan-400' };
      case 'Review Session':
        return { bg: 'bg-amber-500/10', border: 'border-amber-500/20', text: 'text-amber-400' };
      case 'Guest Speaker':
        return { bg: 'bg-rose-500/10', border: 'border-rose-500/20', text: 'text-rose-400' };
      case 'Career Workshop':
        return { bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', text: 'text-emerald-400' };
      default:
        return { bg: 'bg-slate-500/10', border: 'border-slate-500/20', text: 'text-slate-400' };
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in" id="schedule-hub-section">
      
      {/* Today's Agenda List */}
      <div className="lg:col-span-2 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white font-display uppercase tracking-wider">
            Operational Schedule Agenda
          </h3>
          <span className="text-xs text-slate-400 font-semibold flex items-center gap-1.5 font-display">
            <Calendar className="w-3.5 h-3.5 text-cyan-400" />
            Today: {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
          </span>
        </div>

        <div className="space-y-3.5">
          {schedule.map((item) => {
            const styles = getTypeStyles(item.type);
            return (
              <div 
                key={item.id}
                className={`p-4 bg-slate-900/40 border border-slate-800/80 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors hover:border-slate-800 relative overflow-hidden`}
              >
                {/* Lateral Accent indicator for live events */}
                {item.status === 'live' && (
                  <div className="absolute left-0 top-0 w-1 h-full bg-cyan-400 animate-pulse" />
                )}

                <div className="flex items-start gap-4">
                  <div className={`p-2.5 rounded-xl flex-shrink-0 ${styles.bg} ${styles.text}`}>
                    <Clock className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${styles.bg} ${styles.text} border ${styles.border}`}>
                        {item.type}
                      </span>
                      <span className="text-xs text-slate-400 font-semibold font-display">
                        {item.cohortName}
                      </span>
                    </div>
                    <h4 className="text-sm font-bold text-white mt-1.5 leading-snug">
                      {item.title}
                    </h4>
                    <p className="text-xs text-slate-400 mt-1 font-mono flex items-center gap-1">
                      <User className="w-3.5 h-3.5 text-slate-500" />
                      Mentor: {item.instructor}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between md:flex-col md:items-end gap-2 border-t md:border-t-0 border-slate-800/60 pt-3 md:pt-0">
                  <p className="text-xs font-semibold font-mono text-slate-300">
                    {item.time}
                  </p>
                  
                  {item.status === 'completed' ? (
                    <span className="flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-500/5 border border-emerald-500/10 px-2 py-0.5 rounded-lg font-bold font-display">
                      <CheckCircle2 className="w-3 h-3" />
                      Completed
                    </span>
                  ) : item.status === 'live' ? (
                    <span className="flex items-center gap-1 text-[10px] text-cyan-400 bg-cyan-400/5 border border-cyan-400/20 px-2 py-0.5 rounded-lg font-bold font-display animate-pulse">
                      <PlayCircle className="w-3 h-3 text-cyan-400" />
                      LIVE NOW
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-400 bg-slate-800 border border-slate-700/40 px-2 py-0.5 rounded-lg font-bold font-display">
                      Scheduled
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Calendar Planner Card */}
      <div className="lg:col-span-1 space-y-4">
        <div className="bg-slate-900/40 border border-slate-800/80 p-5 rounded-2xl space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white font-display uppercase tracking-wider">
              Weekly Resource Allocator
            </h3>
            <button className="p-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 transition-colors">
              <Plus className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-slate-400">Classrooms and mentor schedule availability bookings.</p>
          
          <div className="space-y-2.5">
            {[
              { room: 'Classroom Alpha (Main Node)', cap: '25 Seater', booked: 'Full-Stack Web Dev (Co-18)', color: 'border-violet-500/20' },
              { room: 'Classroom Beta (Adwords Room)', cap: '15 Seater', booked: 'Digital Marketing (Co-09)', color: 'border-cyan-500/20' },
              { room: 'Swift Lab (iOS Pod)', cap: '12 Seater', booked: 'iOS Mobile Developer (Co-04)', color: 'border-amber-500/20' },
              { room: 'Virtual Hub (Discord Sandbox)', cap: 'Unlimited', booked: 'All Hands Mentor Sync', color: 'border-emerald-500/20' }
            ].map((room, idx) => (
              <div key={idx} className={`p-3.5 bg-slate-950/40 border ${room.color} rounded-xl space-y-1`}>
                <div className="flex justify-between items-center text-xs font-bold text-white">
                  <span>{room.room}</span>
                  <span className="text-[10px] font-mono text-slate-400">{room.cap}</span>
                </div>
                <p className="text-[10px] font-mono text-cyan-400">{room.booked}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

    </div>
  );
}
