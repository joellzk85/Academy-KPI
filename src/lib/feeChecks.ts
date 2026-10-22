// Trainer fee checks before approval (Joel, 2026-10-21): "Are you sure? - when approving trainer fee: T3, Training
// photo, Training report. Admin / Management to click approved when admin has checked all requirements."
// He chose: the CRM ticks each check by itself when it finds it, Admin (or Management) can tick it by hand
// ("Checked by me", saved with who and when on trainer_jobs.feeChecks), and Management approves only when all are ticked.
// T3 applies to HRDC deals only. A trainer fee paid before the training (timing "before") has no checks.
// Pure, so it can be tested.
import { isHrdc } from './checklist';
import type { TrainerJob } from './trainerPortal';

export type FeeCheckKey = 'grant' | 't3' | 'photos' | 'report';
export interface FeeCheckMark { byId: string; byName: string; at: string }
export interface FeeCheck { key: FeeCheckKey; label: string; auto: string; manual: FeeCheckMark | null; ok: boolean }

export const FEE_CHECK_LABELS: Record<FeeCheckKey, string> = { grant: 'HRDC grant approved', t3: 'T3', photos: 'Training photos', report: 'Training report' };
// Process audit (2026-10-22): the grant (HRDC deals) and the training report can't be ticked by hand: only the
// checklist's "Grant approved" and a checked training report count.
export const AUTO_ONLY: FeeCheckKey[] = ['grant', 'report'];

// A trainer fee that needs the checks: a cost on the deal's Trainer step, paid after the training.
export function isTrainerFee(o: { category?: string; checklistTaskId?: string; timing?: string; dealId?: string }): boolean {
  return !!o.dealId && !!o.checklistTaskId && o.category === 'Trainer' && o.timing !== 'before';
}

/** What the CRM found for each check (empty text = not found), plus what Admin ticked by hand. */
export function feeChecks(deal: { fundingType?: string } | null | undefined, job: Partial<TrainerJob> | null | undefined,
  report: { status?: string; photos?: unknown[] } | null | undefined, tasks: { id: string; done?: boolean }[] | null | undefined): FeeCheck[] {
  const step = (id: string) => (tasks || []).find(t => t.id === id);
  const claim = job?.claim;
  const manual = (job as any)?.feeChecks || {};
  const found: Partial<Record<FeeCheckKey, string>> = {
    grant: step('grant')?.done ? 'Grant approved is ticked' : '',
    t3: step('t3')?.done ? 'Verify T3 attendance step is ticked' : claim?.t3?.length ? 'the trainer sent the T3' : '',
    photos: step('delivered')?.done ? 'the Training delivered step has its files'
      : claim?.photos?.length ? `the trainer sent ${claim.photos.length} photo${claim.photos.length === 1 ? '' : 's'}`
      : report?.photos?.length ? `${report.photos.length} photo${report.photos.length === 1 ? '' : 's'} in the training report` : '',
    report: report?.status === 'checked' ? 'the training report is checked' : '',
  };
  const keys: FeeCheckKey[] = isHrdc(deal?.fundingType) ? ['grant', 't3', 'photos', 'report'] : ['photos', 'report'];
  return keys.map(key => {
    const m: FeeCheckMark | null = manual[key]?.byName && !AUTO_ONLY.includes(key) ? manual[key] : null;
    const auto = found[key] || '';
    return { key, label: FEE_CHECK_LABELS[key], auto, manual: m, ok: !!auto || !!m };
  });
}

export const allChecked = (list: FeeCheck[]) => list.every(c => c.ok);
