// Trainers: which deals a trainer is on (2026-10-17).

import { Trainer } from '../types';
import { dealStage } from './deals';
import { ChecklistTask, effectiveTrainer } from './checklist';

const norm = (s?: string) => (s || '').trim().toLowerCase();

// One training this trainer is on: a deal (not lost) whose confirmed trainer, or else whose quotation, names them.
export interface Booking { deal: any; confirmed: boolean; date: string }

export function trainerBookings(t: Trainer, deals: any[], checklists: Record<string, any>, quotes: any[], trainers: any[]): Booking[] {
  const out: Booking[] = [];
  deals.forEach(d => {
    if (dealStage(d) === 'lost') return;
    const task = (checklists[d.id]?.tasks || []).find((x: ChecklistTask) => x.kind === 'trainer');
    const picked = effectiveTrainer(task, quotes.filter(q => q.pipelineId === d.id), trainers);
    if (!picked) return;
    const names = picked.name.split(',').map(norm);
    if (picked.id !== t.id && !names.includes(norm(t.name))) return;
    out.push({ deal: d, confirmed: !!task?.done, date: /^\d{4}-\d{2}-\d{2}/.test(d.trainingDate || '') ? d.trainingDate.slice(0, 10) : '' });
  });
  return out;
}
