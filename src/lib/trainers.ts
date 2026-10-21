// Trainers: which deals a trainer is on (2026-10-17).

import { Trainer } from '../types';
import { dealStage } from './deals';
import { ChecklistTask, effectiveTrainer, isCoTrainer, leadTrainerTask } from './checklist';

const norm = (s?: string) => (s || '').trim().toLowerCase();

// One training this trainer is on: a deal (not lost) whose confirmed trainer, or else whose quotation, names them.
// Co-trainers (2026-10-22) count too.
export interface Booking { deal: any; confirmed: boolean; date: string }

export function trainerBookings(t: Trainer, deals: any[], checklists: Record<string, any>, quotes: any[], trainers: any[]): Booking[] {
  const out: Booking[] = [];
  deals.forEach(d => {
    if (dealStage(d) === 'lost') return;
    const tasks: ChecklistTask[] = checklists[d.id]?.tasks || [];
    const dealQuotes = quotes.filter(q => q.pipelineId === d.id);
    const steps = [leadTrainerTask(tasks), ...tasks.filter(x => isCoTrainer(x) && x.needed !== false)];
    const i = steps.findIndex(task => {
      const picked = effectiveTrainer(task, dealQuotes, trainers);
      return !!picked && (picked.id === t.id || picked.name.split(',').map(norm).includes(norm(t.name)));
    });
    if (i < 0) return;
    out.push({ deal: d, confirmed: !!steps[i]?.done, date: /^\d{4}-\d{2}-\d{2}/.test(d.trainingDate || '') ? d.trainingDate.slice(0, 10) : '' });
  });
  return out;
}
