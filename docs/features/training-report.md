# Training report (built 2026-10-21)

Joel's list (2026-10-21): attendance with who was absent and the number absent; the trainer rates the training (5 stars);
did we achieve the agreed objectives (stars + comment); what was missing; time management; trainer observations;
outstanding participants (several); participants needing special attention (several); recommended follow-up training;
trainings of more than one day; went well / do better / start / stop / more; participants' rating from the Output
assessment (else Admin or Management type it). Claude's extras, accepted: late arrivals and early leavers, issues on the
day, sales leads spotted.

Joel's decisions:
- **Internal notes** (trainer's own rating, what was missing, time management, the review, issues, leads) are for NEXT
  Academy only, unless **Management ticks** a section to put it on HR's copy.
- **Output assessment file** (Excel, CSV, Word or PDF): reading it by itself is **not built yet** (no sample file). For
  now Admin or Management type the average, the number who answered and a summary. Revisit with a sample file
  (`t3Names.ts` already reads all four formats).

## How it works
- **Trainer portal:** each training gets a "Training report" box from its first day (a To-do from the day after it
  ends). The full-screen form saves itself as a draft as they type; **Send to NEXT Academy** needs: registered number,
  at least one objective with stars on all, observations, their own rating and time management. They can change it
  until it's checked; if sent back, the note shows and they **Fix and send again**.
- **Starts from the deal:** training days (back to back from the training date, like the T3), the course outline's
  learning outcomes as objectives (the sent outline first), and the T3 name list as suggestions for names.
- **CRM:** the after-training **Training report** step shows a box (status, Check / Open / Write the report, PDF for
  HR). The side panel lets Admin or Management fix or write the whole report (trainers without portal access), add
  photos from the trainer's fee request, type the participants' rating, **Send back to the trainer**, **Checked, ready
  for HR** (ticks the step; Reopen unticks it), Preview PDF / **PDF for HR**. Reps can view it.
- **Admin work:** amber flag "X sent the training report: check it, then mark it ready for HR" while it's submitted.
- **HR's PDF** (`TrainingReportDocument.tsx`): deal summary (programme, client, dates, venue, trainer, HRDC grant no.),
  attendance table by day with rate, objectives with stars and average, participants' rating, observations,
  outstanding, special attention, follow-up training, ticked internal notes, photos, prepared / reviewed by.

## Records and files
- `training_reports/{dealId}` (see the top of `src/lib/trainingReport.ts`). Members read; Admin and Management write;
  only Management changes `showToHr`; the trainer writes only through `/api/portal/report/get` and `/save`
  (`serverTrainerPortal.ts`, which keeps only the trainer's part and never sends them the team's part).
- Photos: `trainer_portal/{trainerId}/claims/{dealId}/report_…` (existing storage rule).
- Code: `src/lib/trainingReport.ts`, `src/components/TrainingReportForm.tsx` (shared form),
  `TrainingReportAdmin.tsx` (box, panel, `useTrainingReports`), `TrainingReportDocument.tsx` (PDF); `ReportEditor` in
  `TrainerPortal.tsx`. Backup includes "Training reports".

## Not built yet
- Reading the Output assessment file by itself; a client link for HR (PDF only for now).
