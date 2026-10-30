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
- Reading the Output assessment file by itself.

## Later the same day (2026-10-21): changes after sending, pax, HR's sections and link
Joel's list: the trainer can edit after submitting, with the date, time and what changed recorded; number of pax from
the deal; objectives from the course outline but editable by the trainer (already so); Management sees and edits the
report, chooses what HR sees, and sends it by PDF or link. Joel's decisions: pax comes from the **deal's Participants**;
a **checked report the trainer changes goes back to "submitted"** for Admin to check again.
- **Changes after sending:** once sent, the trainer's typing is kept in `trainerDraft` (the team keeps seeing what was
  sent; the CRM panel says the trainer is changing it). **Send changes** compares with what was sent
  (`reportChanges`, plain words like "Day 2 absent: added Ali", "Objective …: 4 → 5 stars", "Observations changed"),
  saves it as a revision `{ at, byName, changes }` in `revisions` (last 30), and sets status "submitted". A checked
  report also unticks its Training report step. The list shows in the portal and in the CRM panel (date and time,
  Malaysia); the box says "Changed N times after sending"; the Admin work flag says "changed … after sending".
  Edits by Admin / Management on the deal are not listed as revisions (History keeps the status steps).
- **Pax:** `registered` follows the deal's Participants (`dealPax`, `withPax`) in the portal, the CRM, the PDF and the
  link; it can be typed only when the deal has none.
- **HR's copy:** `showToHr` now covers every section (`PUBLIC_PARTS` on unless unticked, `INTERNAL_PARTS` off unless
  ticked; `onHrCopy`). Only Management ticks (rule unchanged); on a checked report a tick is saved at once.
- **Send to HR:** on a checked report, "Send to HR" has PDF for HR (Admin or Management) and **Make the link for HR**
  (Management only). The link is a `doc_links` entry of kind `report` (docId = the deal id), opened at `/r/<token>`
  with the same limits, Reopen, Stop and protection as quotation links (no visit tracking or heatmap). The server
  sends only `hrCopy(...)` (ticked sections, no trainer id, history, revisions or notes) with `hrHeader`, the deal
  details the CRM saves on the report. While the report is reopened, the link says it's being updated.
- Code: `src/lib/trainingReport.ts` (revisions, pax, HR's copy), `serverTrainerPortal.ts` (report get / save),
  `serverDocLinks.ts` (kind `report`), `DocLinkPage.tsx`, `TrainingReportAdmin.tsx`, `TrainingReportForm.tsx`
  (`RevisionList`), `TrainingReportDocument.tsx`, `TrainerPortal.tsx`. No rule change.

## Training reports list on Trainers (2026-10-21)
Joel: training reports get their own place under Trainers, listing them all. **Trainers → Training reports** tab
(Admin and Management only; `TrainingReportsList.tsx`): every report, plus won trainings that have started with no
report yet ("Not written yet"). Filters All / Needs checking / With the trainer / Checked, and a search by programme,
client or trainer; waiting-to-check first, then latest training first. A row opens the same panel as the deal's step
(`ReportPanel`); Checked / Reopen also tick or untick the deal's "Training report" step (`setReportStep`). No rule change.

## Settings, HR and HOD copies, 30-day check-in (2026-10-27)
Joel: "Training report setting page. Preview. Set questions. Only viewable by managers", and the report must help
both HR and the head of department (HOD). Built from Claude's suggestions, all accepted ("Build it").
- **Settings** (Trainers → Training reports → **Settings**, Management only; `TrainingReportSettings.tsx`,
  `lib/reportSettings.ts`, `config/training_report`, saves by itself). Each section: on / off, title and hint, required,
  on HR's copy, on the HOD's copy (defaults; Management still ticks per report). **Attendance and Objectives are always
  on and required** (HRDC). Your own questions (short, long, stars, yes / no, pick one; required; NEXT Academy only; HR /
  HOD). The HOD check-in questions. **Back to default** clears everything. **Preview** tab: trainer's form, HR's copy,
  HOD's copy, check-in page, with a made-up example. Same questions for every training type (Claude's default).
- **New sections:** Summary (required by default), Training hours and certificates, Topics covered (from the outline's
  modules), Before and after test scores (class averages and improvement counted), Notes on each participant, Action
  plan, How the HOD can help. Answers to own questions are saved with the question's wording (`answers[]`).
- **Two copies:** `copyOf(r, settings, 'hr' | 'hod')` (replaces `hrCopy`); the panel's "On each copy" box has HR and HOD
  ticks (`showToHr`, `showToHod`, Management only); **PDF for HR** and **PDF for HOD**. The HOD copy leaves out the HRDC
  approval code and, by default, hours. HR's link (/r/) shows HR's copy.
- **30-day check-in:** on a checked report, Management → **Make the check-in link** (/c/<token>, 60 days,
  `serverReportCheckin.ts`, `CheckinPage.tsx`); Copy message with the link; the HOD answers once (name, position,
  the questions); answers show on the report panel and in the deal's History (a "yes" to more training is flagged as
  a lead). `report_checkins` and the report's `checkin` / `checkinAnswer` are written only by the server.
- **Rules:** `firestore.rules`: `config/training_report` Management only; `showToHod` Management only; the new trainer
  keys locked for internal trainers' reports; `checkin` / `checkinAnswer` refused from the CRM. Tested with a logic
  script (copies, gaps, cleaning, changes, older reports) and a local page (settings, preview, phone width).

## Training report files (2026-10-30)

Joel asked for an upload slot on the after-training Training report step (Admin work → After training, and the deal's checklist).
- "Training report files" box under the training report box: several files at once, drop, click to choose, or paste a screenshot (Ctrl+V while the mouse is over the box). Stored as checklist files on the step (`checklist_files`, taskId `training_report`).
- Uploading ticks the step done, whether or not the trainer wrote the report; files can be added after the trainer filled it in too.
- Reopening the written report (on the deal or in Trainers → Training reports, `setReportStep`) leaves the step ticked while files are there; deleting the last file leaves it ticked while the written report is checked.
- The files stay in the CRM: they are not part of HR's or the HOD's PDF or link.
- Every checklist upload box now takes a pasted screenshot (Ctrl+V), reusing `usePaste` from `PaymentReceipts.tsx`.
- Nothing to publish.
