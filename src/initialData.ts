import { Representative, CalendarEvent } from './types';

export const INITIAL_REPRESENTATIVES: Representative[] = [
  {
    id: 'xin-ying',
    name: 'Ng Xin Ying',
    email: 'xinying@nextenergy24.com',
    kpi: {
      salesFigure: [0, 0, 0, 0, 0],
      proposals: [0, 0, 0, 0, 0],
      preview: [0, 0, 0, 0, 0],
      extraMetric: [0, 0, 0, 0, 0]
    },
    targets: {
      salesFigure: 30000,
      proposals: 8,
      preview: 1,
      extraMetric: 1
    }
  },
  {
    id: 'chee-cai',
    name: 'Chee Cai',
    email: 'cheecai@nextenergy24.com',
    kpi: {
      salesFigure: [0, 0, 0, 0, 0],
      proposals: [0, 0, 0, 0, 0],
      preview: [0, 0, 0, 0, 0]
    },
    targets: {
      salesFigure: 30000,
      proposals: 120,
      preview: 25
    }
  },
  {
    id: 'alif',
    name: 'Alif',
    email: 'alif@nextenergy24.com',
    kpi: {
      salesFigure: [0, 0, 0, 0, 0],
      proposals: [0, 0, 0, 0, 0],
      preview: [0, 0, 0, 0, 0]
    },
    targets: {
      salesFigure: 60000,
      proposals: 12,
      preview: 6
    }
  },
  {
    id: 'atiqa',
    name: 'Atiqa',
    email: 'atiqa@nextenergy24.com',
    kpi: {
      salesFigure: [0, 0, 0, 0, 0],
      proposals: [0, 0, 0, 0, 0],
      preview: [0, 0, 0, 0, 0]
    },
    targets: {
      salesFigure: 25,
      proposals: 1,
      preview: 20
    }
  },
  {
    id: 'new-guy',
    name: 'New Guy',
    email: 'newguy@nextenergy24.com',
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
  }
];

export const INITIAL_CALENDAR_EVENTS: CalendarEvent[] = [
  // July 1
  { id: 'ev1', time: '08:00 AM', title: 'Empower HR Leads Sync', date: '2026-07-01', color: 'bg-indigo-500' },
  // July 6
  { id: 'ev2', time: '09:00 AM', title: 'Weekly Morning Standard Call', date: '2026-07-06', color: 'bg-emerald-500' },
  { id: 'ev3', time: '11:00 AM', title: 'Director lunch strategy', date: '2026-07-06', color: 'bg-amber-500' },
  { id: 'ev4', time: '02:30 PM', title: 'Weekly Meeting & Feedback Review', date: '2026-07-06', color: 'bg-blue-500' },
  // July 7
  { id: 'ev5', time: '10:00 AM', title: 'Interview F2F - Sabah Candidates', date: '2026-07-07', color: 'bg-cyan-500' },
  { id: 'ev6', time: '11:00 AM', title: 'Lunch with Academics Team', date: '2026-07-07', color: 'bg-purple-500' },
  { id: 'ev7', time: '01:00 PM', title: 'Interview F2F - KL Applicants', date: '2026-07-07', color: 'bg-cyan-500' },
  // July 8
  { id: 'ev8', time: '11:00 AM', title: 'Lunch with Alvin (Shopee Recruiter)', date: '2026-07-08', color: 'bg-purple-500' },
  { id: 'ev9', time: '03:00 PM', title: 'Imagineers Ambition Program Kickoff', date: '2026-07-08', color: 'bg-violet-500' },
  { id: 'ev10', time: '04:00 PM', title: 'CS Training Course Module 2', date: '2026-07-08', color: 'bg-pink-500' },
  // July 9
  { id: 'ev11', time: '08:30 AM', title: '1 to 1 Joel Outreach Meeting', date: '2026-07-09', color: 'bg-rose-500' },
  { id: 'ev12', time: '10:00 AM', title: 'Sales Team Induction & Alignment', date: '2026-07-09', color: 'bg-indigo-500' },
  { id: 'ev13', time: '10:00 PM', title: 'Post mortem of Batch 17 Placements', date: '2026-07-09', color: 'bg-slate-500' },
  // July 10
  { id: 'ev14', time: '10:00 AM', title: 'Fundamental of SEO Lecture', date: '2026-07-10', color: 'bg-orange-500' },
  { id: 'ev15', time: '10:00 AM', title: 'Sales Team Induction Day 2', date: '2026-07-10', color: 'bg-indigo-500' },
  { id: 'ev16', time: '04:30 PM', title: 'M3 Review Session - Kayla', date: '2026-07-10', color: 'bg-red-500' },
  // July 11-12
  { id: 'ev17', time: '09:00 AM', title: 'Shin Esu - Team Building at Happi Village', date: '2026-07-11', color: 'bg-emerald-500' },
  { id: 'ev18', time: '12:00 PM', title: 'Shin Esu - Day 2 Happi Village BBQ', date: '2026-07-12', color: 'bg-emerald-500' },
  // July 16
  { id: 'ev19', time: '09:00 AM', title: 'Padini Team Building at Happi Village', date: '2026-07-16', color: 'bg-emerald-500' },
  // July 17
  { id: 'ev20', time: '04:00 PM', title: 'Reminder: Townhall prep notes', date: '2026-07-17', color: 'bg-yellow-500' },
  { id: 'ev21', time: '04:00 PM', title: 'Townhall Q2 Results Celebration', date: '2026-07-17', color: 'bg-indigo-500' },
  { id: 'ev22', time: '05:00 PM', title: 'Update Key Activities and CRM', date: '2026-07-17', color: 'bg-gray-500' },
  // July 23
  { id: 'ev23', time: '08:30 AM', title: 'China Mobile Team Building at Park Royal, Melaka', date: '2026-07-18', color: 'bg-teal-500' },
  { id: 'ev24', time: '12:00 PM', title: 'Lunch with dad - Birthday!', date: '2026-07-19', color: 'bg-pink-500' },
  // July 23-25
  { id: 'ev25', time: 'All Day', title: 'Vietnam Trip - Business alignment tour', date: '2026-07-23', color: 'bg-green-500' },
  { id: 'ev26', time: 'All Day', title: 'Vietnam Trip - Networking night', date: '2026-07-24', color: 'bg-green-500' },
  // July 29
  { id: 'ev27', time: '07:00 AM', title: 'Padini CFM Breakfast Roundtable', date: '2026-07-29', color: 'bg-blue-500' },
  { id: 'ev28', time: '07:00 AM', title: 'Padini CFM Keynote Presentation', date: '2026-07-30', color: 'bg-blue-500' },
  { id: 'ev29', time: '07:00 AM', title: 'Padini CFM Wrap-up & feedback', date: '2026-07-31', color: 'bg-blue-500' },
  { id: 'ev30', time: 'All Day', title: 'Lang Tengah snorkeling getaway', date: '2026-07-31', color: 'bg-cyan-500' }
];

export const INITIAL_NOTICES: string[] = [
  "🚀 Welcome to NEXT Academy Operations Dashboard! Switch between Representatives below to track KPIs.",
  "📣 Notice: All sales reps must complete inputting their WK 2 Commission before July 10th.",
  "🌟 Top Performer of the week: Alif has closed 2 units totaling RM 60,000! Great work!",
  "📅 The Next Academy team building retreat is set for July 11th - 12th at Happi Village."
];

export const MOTIVATIONAL_QUOTES: string[] = [
  "Success is not final, failure is not fatal: it is the courage to continue that counts.",
  "Opportunities don't happen. You create them.",
  "Don't watch the clock; do what it does. Keep going.",
  "Action is the foundational key to all success.",
  "The only way to do great work is to love what you do.",
  "You miss 100% of the shots you don't take.",
  "The secret of getting ahead is getting started."
];

import { metricsFor } from './lib/kpi';

export interface RepMetricConfig {
  key: string;
  label: string;
  targetLabel: string;
  targetVal: number;
  isRM: boolean;
  weight: number;
  auto?: string | null;
}

// Each person's KPIs now come from the KPI template Management picks for
// them in the Team tab (see src/lib/kpi.ts). No names are written in code.
export function getRepMetrics(rep: Representative): RepMetricConfig[] {
  return metricsFor(rep as any);
}
