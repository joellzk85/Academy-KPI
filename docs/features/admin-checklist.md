# Phase 2B: admin checklist

Moved from CLAUDE.md on 2026-10-21. Detailed history of what was built and agreed. Read only when working on this area.

## 6. Phase 2B, the handover to admin (built 2026-10-16; check its status in section 5)

Joel's answer (2026-10-16), the admin's steps after a client confirms:
1. Apply grant
2. Quotation
3. Follow up attendance list
4. Check venue + payment
5. Prepare materials
6. Confirm trainer

He wants room to **add more tasks later** and to **rearrange their order**, so nothing is hardcoded.

Agreed decisions:
- Both Admin and sales can create quotations. Admin (and Management) can see and edit everyone's, including sales people's. Reps change only their own or ones they're tagged on.
- Admin **and** Management can edit the master task list.

What was built:
- Marking a deal **Won** creates its checklist in `deal_checklists` from the master list. The old `admin_records` collection was not reused: it's on the clear list and has the old shape. A separate collection lets the rules allow only Admin and Management to tick steps while reps can only read.
- Steps with their own fields and gates: Apply grant (applied date, grant number, approved date; HRDC deals only; needs the grant number before it can be ticked), Quotation (retired 2026-10-18, see below), Check venue + payment (venue from the venue list, plus "Venue paid"), Confirm trainer (trainer from the trainer list). Every other step is a simple tick with a note. Each tick records who and when.
- Admin can reorder, add or remove steps on a single deal ("Arrange, add or remove steps"), and pull in steps added to the master list later.
- Admin work → Checklist tasks: the master list (rename, reorder, add, "Stop using", HRDC-only or all deals) plus the red-flag window (default 7 days). Changes affect deals won from then on.
- Admin work → Work queue: won deals with checklists, soonest training first, with filters for In progress, Needs attention and All done. A red flag shows when training is within the window and the grant isn't approved or the trainer isn't confirmed, or when the training date has passed with steps open. Older won deals without a checklist are listed separately with a "Start checklist" button.
- **Reps see the checklist read-only** (Joel confirmed 2026-10-16, after briefly considering hiding it): progress bar, each step done or not, and its details (who and when, notes, venue and paid status, trainer, grant number). They have no tick or edit buttons. The deal list shows "admin X of Y".
- In their own workspace, Admin sees an "Everyone's / Mine" switch on Quotations.
- Rules: `deal_checklists` can be read by every team member and changed only by Admin and Management; the deal owner can only create it (when marking the deal won). `config/checklist_tasks` can be changed only by Admin or Management. `quotations` moved out of the open catch-all into owner-based rules; old templates with no owner stay editable by all.

- After-training steps (added at Joel's request, 2026-10-16): JD14 (HRDC deals only), Certificates, Training report, Output assessment. These are simple ticks with notes, marked "After training". Any simple task can be set to Before or After training in Checklist tasks. Before training day only the before-training steps can raise flags. Once the date passes, open before-training steps are red, and open after-training steps show as an amber reminder.
- New built-in tasks added in code are added automatically to a master list that was already saved (`readSettings` merges missing built-in ids). Ones Joel stopped using stay retired.

- **"Quotation" step retired (Joel, 2026-10-18):** a deal can only be won after its quotation is sent, so the step was always already satisfied. `RETIRED_BUILTINS` in `lib/checklist.ts` keeps it retired even in a saved master list (`readSettings` forces it), so new won deals never get it and "Add steps from the master list" never offers it. Checklist tasks shows it crossed out with "No longer needed" (no Bring back). On older checklists an **open** Quotation step is ignored by `applicableTasks` (not shown, not counted in "admin X of Y", doesn't block "All done"); a ticked one stays for the record. Nothing in the database was changed.
- **"Won N days ago, grant not applied" flag (Joel, 2026-10-18):** `grantNotAppliedFlag` in `lib/checklist.ts`, included in `checklistFlags` (which now takes the won date). HRDC and HRDC + top-up deals only. Raised when the deal was won `grantDays` (default 3) or more days ago and "Apply grant" has no applied date and isn't ticked; a won deal with no checklist counts as not applied. Amber at first; red at double `grantDays`, or when training is within `flagDays`. Stops once the training date has passed (the "training date has passed" flag covers it), and replaces "grant not approved" when both apply. `grantDays` is set in Admin work → Checklist tasks (saved in `config/checklist_tasks`, no rules change). Shown in the Work queue row (and the "Needs attention" filter even while amber), on unstarted won deals, in My home "Due now" and in Management's "Pipeline and stuck deals" card.

- **Files on checklist steps (built 2026-10-19; Joel: "for HRDC JD14 / T3 / Output assessment, instead of just writing codes in, should have an upload / drop here option"):**
  - A step with **"Has a file upload"** (tick box per task in Admin work → Checklist tasks, also on "Add task"; simple ticks only) shows a drop box on the deal's checklist: "Drop the <step> file here, or click to choose". PDF, Word, Excel, JPG or PNG, up to 100 MB (raised from 20 MB on 2026-10-19), several at once; then a file list (who, when, size, "Latest", click to open) with "Add another file". Logic `src/lib/checklistFiles.ts`, UI `src/components/ChecklistFiles.tsx` (`StepFiles`), used in `DealChecklist.tsx` (so the Deals panel and the work queue).
  - **Uploading ticks the step done** (Joel chose this); such a step has no Done button and can't be ticked without a file (`taskGate` takes the file count). Deleting its **last** file reopens it. Both write a checklist History line. Note box unchanged.
  - Built in with the upload on: **JD14**, the new **Verify T3 attendance** (HRDC only, after training, placed after JD14; Joel said yes) and **Output assessment**. `hasFiles` in `lib/checklist.ts` decides for older saved lists and checklists that have no `files` setting yet. `readSettings` now places newly added built-in steps after the built-in step before them, not at the end. Older won deals get T3 via "Add new steps from the master list".
  - Admin and Management upload; reps see the files read-only and can open them. Delete: the uploader (Admin) or Management.
  - **Storage:** Firebase Storage `checklist_files/{dealId}/{fileId}_{name}` (`customMetadata.uploadedBy`), record in **`checklist_files/{fileId}`** (`dealId, taskId, taskLabel, name, size, type, path, at, byId, byName`). Backup has a "Checklist files" tab; Admin work → Backup → **Download all proposals and checklist files (ZIP)** puts them in a sub-folder per step inside each deal's folder.
  - **Rules need publishing:** `firestore.rules` (`checklist_files`) and `storage.rules` (`checklist_files/...`). Needs Firebase Storage switched on (to-do 7).
  - Tested with a temporary local page (drop box, file list, delete rights, wrong file type refused, rep view, phone) and a script (T3 placement in a saved list, older steps getting the upload, the tick gate, switching it off stays off). Real uploads need the live site after Storage is on.

Not in 2B: training day (attendance, photos) and POs. Joel can add them as tasks himself, or they can become proper stages in Phase 3.


