# NEXT Academy CRM: handover for Claude Code

Read this whole file at the start of every session. It is the single source of truth for how to work on this project and what has been agreed.

## 1. Who you are working with, and how

The owner (Joel, Management) has **zero programming knowledge**. Act as an expert CRM manager, an expert in Malaysia's HRDC (HRD Corp) training industry, and an expert in operations and finance.

Working rules, agreed and non-negotiable:

1. **Always check the latest code first.** Run `git pull` and `git status` before planning or changing anything.
2. **Always ask before producing fix code.** Explain the plan in plain language and wait for a clear "yes" before writing code.
3. **Always ask before pushing.** After building and testing, summarise what changed in plain language and ask permission before `git push`. Pushing to `main` deploys to the live CRM automatically.
4. **Change only the files that need changing.** Never rewrite the whole app for a fix.
5. **Never tell Joel to find or edit a line of code.** You make the changes.
6. **Explain everything in plain language.** No jargon without a one-line explanation. Give click-by-click steps for anything Joel must do in Firebase, Google Cloud or GitHub.
7. **Never change code just to make a build pass** without explaining why.
8. Ask questions when something is unclear, one or two at a time.

## 2. The business and the product

NEXT Academy is a Malaysian training provider. Many trainings are claimable through HRDC (HRD Corp); some are paid directly by clients; some are HRDC with a client top-up. The CRM covers sales (leads to won deals), operations (grant, logistics, training delivery, post-training documents) and money (invoicing, claims, payments, P&L).

### Agreed flow: one deal, one journey

Everything hangs off a single deal record that moves through stages. Nothing is created as an orphan.

| # | Stage | Owner | Gate (cannot move on until…) |
|---|---|---|---|
| 1 | Lead | Sales | client picked from client list |
| 2 | Appointment | Sales | |
| 3 | Proposal sent | Sales | deal value entered |
| 4 | Won / Lost | Sales | Won: client, value, funding type. Lost: reason |
| 5 | Grant + logistics | Admin | HRDC deals: grant applied, then approved (grant number) before training day |
| 6 | Training day | Admin | attendance, photos |
| 7 | Post-training | Admin | JD14, certificates, training report |
| 8 | Invoice + claim | Admin | invoice sent; HRDC claim submitted; payment received; P&L closed |

Funding types: `hrdc` (HRDC claimable), `direct` (Direct pay), `hrdc_topup` (HRDC + top-up). The CRM shows only the steps that apply. For HRDC deals, track claim amount vs amount HRDC actually paid; any shortfall becomes a top-up invoice to the client. Warn admin as the HRDC claim deadline approaches. Make the deadline window a setting, and ask Joel to confirm the current period against HRD Corp's latest guidelines; do not hardcode an assumption.

### Roles

| | Rep | Admin | Management (2 people) |
|---|---|---|---|
| Own deals and KPIs | Edit | Edit any | View all |
| Operations stages | View progress | Do | View stuck items |
| Payments (Phase 3) | View status | Raise | Raise and **approve** |
| Team (add/remove/roles/passwords) | | | Yes |

- Admin can do everything a rep can, plus operations for every deal.
- **Payment approval:** payments raised by Admin can be approved by either manager. Payments raised by Manager A can only be approved by Manager B, and vice versa. Nobody can ever approve their own request, and the Approve button must not even show for it. Every approval is logged (who, when).
- Money in: keyed in by Admin, no approval needed. Money out (trainer fee, venue, hotel, bus, facilitator, staff claims): raised by Admin or Management, pending until approved, and only approved items can be marked paid. Approved items feed that deal's P&L.

### Single source of truth (agreed principle)

Every piece of information is typed once, in one home; everything else points to it. People live only in the Team list. Clients, trainers and venues live only in their directories. A deal holds programme, dates, value and funding type; quotations, outlines, checklists and payments read from the deal. KPIs are never typed when they can be counted from deals. No names or IDs are hardcoded in code.

## 3. Technical setup

- **Code:** React 19 + Vite + Tailwind v4 front end in `src/`; Express server in `server.ts` with login routes in `serverAuth.ts` (renamed from `.tsx` in Phase 2A).
- **Database:** Firebase Firestore, project `gen-lang-client-0779528352`, default database.
- **Hosting:** Firebase App Hosting, backend `nextacademy2`. It **builds and deploys automatically from GitHub `main`**. Live site: https://nextacademy2--gen-lang-client-0779528352.asia-southeast1.hosted.app
- **GitHub is the master copy:** https://github.com/joellzk85/Academy-KPI. Google AI Studio is no longer used and must never be used to edit again (it can't pull, and saving from it would overwrite newer work).
- **Build check:** `npm install` then `npm run build`. Type errors about the `key` prop appear because `@types/react` isn't installed; Vite ignores them and they are pre-existing.
- **Database rules:** `firestore.rules` in the repo must be **published manually** in the Firebase console (Firestore Database, Rules, paste, Publish) after the matching code is live. Walk Joel through it, and remind him whenever rules change. Rules changes must be published after the new build is live, never before.
- **Commits:** author `joellzk85 <lzk.joel@gmail.com>` is set for this repo. Joel pushes via PowerShell from `C:\Users\Joel\Documents\CRM` if your push needs his GitHub sign-in.

### Login design (no emails, by Joel's explicit choice)

- People pick their name and type a password. **No emails anywhere**, and the Firebase Email/Password sign-in method stays **off**.
- The server checks passwords (scrypt hash and salt in the `secrets` collection, which no browser can read) and returns a Firebase custom token; the browser then calls `signInWithCustomToken`. The login user ID equals the team member ID.
- `team/{memberId}`: name, role, active, mustChangePassword. Public read (login list); written only by the server.
- `auth_map/{memberId}`: role and active; used by the database rules; written only by the server.
- `config/setup` marks first-time setup done.
- Management uses the Team tab to add, remove, change roles and set passwords, with a tick box for "ask them to choose their own password at next login". Setting a password or removing someone revokes their sessions.
- Google Cloud permission granted: the App Hosting service account has Service Account Token Creator; the IAM Service Account Credentials API is enabled; Firebase Authentication is started with no providers.

### Design style for new screens

Calm and readable, replacing the old cramped ALL-CAPS look. Use the Plus Jakarta Sans font, sentence-case labels, and 14 to 15px body text. Use the colour tokens in `src/index.css`: `ink`, `ink-soft`, `accent` (teal `#0E6E62`), `accent-soft`, `surface`, `line`, `attention`, `danger`. See `DealsBoard.tsx`, `TeamManager.tsx` and `LoginScreen.tsx` as the reference style. Redesign old screens as they are rebuilt, not separately.

## 4. Where things live

- `src/lib/deals.ts`: deal stages, funding types, date and value helpers. Deals are stored in the `pipelines` collection. Fields added in 2A: `stage`, `appointmentDate`, `wonDate`, `lostDate`, `lostReason`, `fundingType`, `clientId`, `history[]`. Old `status` (Pending/Won/Lost) is kept in step for the older screens.
- `src/lib/kpi.ts`: KPI templates and counting. **Closing RM counts in the month a deal is won**, and only for the deal owner (not tagged helpers).
- `src/components/DealsBoard.tsx`: the Deals screen (in each workspace's "Deals" tab).
- `src/components/TeamManager.tsx`: Team tab, including the KPI set and targets per person.
- `src/components/DataTools.tsx`: Management → Data tools (link old records, clear old data).
- `src/App.tsx`: login gate and the main app; `representatives` are built from Team plus `reps/{id}` (KPI template and targets) plus `month_kpis/{id}_{MMM-YY}` (typed weekly numbers).
- `src/components/RepDetailDashboard.tsx`: the rep workspace, about 6,700 lines of older code. Edit surgically.
- `src/lib/checklist.ts`: admin checklist rules (default tasks, which tasks apply, gates before ticking, red flags).
- `src/components/DealChecklist.tsx`: the checklist on a won deal (used in the Deals panel and the work queue).
- `src/components/WorkQueue.tsx`: the "Admin work" top tab (Admin and Management): work queue and the master "Checklist tasks" list.
- `src/lib/dealDocs.ts`: builds a draft quotation from a deal (shared by the rep workspace and the work queue).
- Collections added in 2B: `deal_checklists/{dealId}` (one per won deal: `tasks[]`, `history[]`), and `config/checklist_tasks` (master task list and `flagDays`).
- `src/lib/programmes.ts`: programme HRDC status, HRDC query helpers, and `grantBlockReason` (an HRDC deal's grant can't be ticked until its programme is HRDC approved).
- `src/components/Programmes.tsx`: the programme picker on the deal form (with quick add) and Admin work → Programmes.
- `src/components/HrdcQueries.tsx`: HRDC queries on a deal (Deals panel and work queue).
- Collections added in 2C: `programmes/{id}` (name, `hrdcStatus` not_registered/submitted/approved, `hrdcCode`, dates, notes) and `hrdc_queries/{id}` (`dealId`, `phase` before/during/after, question, received date, `replyBy`, handler, `answeredDate`, answer). Deals gained `programmeId`; `courseName` is kept in step with the programme name (including after a rename) for older screens.

### KPI templates (follow the current KPIs; agreed)

| Template | KPIs (weight) | Counted |
|---|---|---|
| `sales_standard` | Closing RM 60%, Appointment 20%, Proposal 20% | all from deals |
| `sales_public` | Closing RM 60%, Appointment 20%, Public Programme pax 20% | last one typed weekly |
| `sales_trainer` | Closing RM 50%, Preview 17%, Proposal 17%, Trainer Opportunity Day 16% | last one typed weekly; Preview counts appointments, as before |
| `admin_ops` | Perf. rating 50%, Claim submission 40%, Venue database 10% | all typed weekly |

The defaults are `sales_standard` for reps and `admin_ops` for admins until Management picks a template. Later, Claim submission can switch to automatic from Phase 2B/3 claim tracking; flag it to Joel when you get there.

### Data policy (agreed)

- **Keep:** clients, venues (`venues_directory`), trainers (`trainers_directory`), quotations, deals (`pipelines`), course outlines.
- **Clear (only via the Data tools button, Joel clicks it himself):** appointments, admin_records, payments, client_payments, events, tasks, project_pls, links, and old `reps` docs from the previous login system.
- **Decided 2026-10-16:** Joel keeps only **KPI history (`month_kpis`)** from the old clear list, so it was removed from `DataTools.tsx`. Everything else on the list is cleared, including calendar events, tasks and saved links, even though those screens still exist; they just start empty.

## 5. Status

### Done
- **Phase 1:** repair of damaged files, roles, Team tab, removal of template screens.
- **Login update:** server-checked passwords, no emails.
- **Phase 2A** (commit `5c241f7`): Deals screen with stages and gates, client picker with quick add, funding type, quotations and outlines created from deals, KPI templates, deal-based KPIs counted by won date, per-person-per-month KPI storage, Data tools, and deal-ownership database rules (published).

- **Phase 2B** (pushed 2026-10-16, see section 6): admin checklist on won deals (including after-training steps JD14, certificates, training report, output assessment), Admin work queue with red flags, editable master task list, Admin can see and edit all quotations, new rules. Live, rules published, tested OK by Joel. Reps see checklists read-only (Joel confirmed, see section 6).

- **Phase 3** (pushed 2026-10-16, see section 6b): money in and out per deal, cross-approval, P&L per deal, money flags, Admin work → Money. Live, rules published, tested OK by Joel ("all okay").
- **Phase 2C** (pushed 2026-10-16, see section 6a): programme list with HRDC registration, HRDC queries, grant gate. Live, rules published, tested OK by Joel ("ok can").

### Joel's open to-dos (check with him)
0. **Phase 2B go-live:** done and tested by Joel on 2026-10-16. Rules published.
0a. **Phase 2C go-live:** done and tested by Joel on 2026-10-16. Rules published.
0b. **Phase 3 go-live:** done and tested by Joel on 2026-10-16. Rules published. Claim deadline decided: HRD Corp allows 6 months, so the default is 180 days, with the reminder turning red after 14 days (`claimReminderDays`). Both can be changed in Admin work → Money.
1. KPI templates and targets: Joel will adjust these himself in the Management portal later.
2. Link old records: Joel will do it later in Management → Data tools (Claude can't log in). Ask for a screenshot of the suggested matches before he clicks Link records, and check every match.
3. ~~Test a deal from new to won and check it shows in that month's KPIs.~~ Done 2026-10-16: works.
4. Clear old data: Joel clicks it himself after linking (step 2), because clearing can't be undone. KPI history is kept.
5. As a precaution, both Management people change their passwords once, because the database ran on old open rules until Phase 2A's rules were published.

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
- Steps with their own fields and gates: Apply grant (applied date, grant number, approved date; HRDC deals only; needs the grant number before it can be ticked), Quotation (needs a quotation linked to the deal), Check venue + payment (venue from the venue list, plus "Venue paid"), Confirm trainer (trainer from the trainer list). Every other step is a simple tick with a note. Each tick records who and when.
- Admin can reorder, add or remove steps on a single deal ("Arrange, add or remove steps"), and pull in steps added to the master list later.
- Admin work → Checklist tasks: the master list (rename, reorder, add, "Stop using", HRDC-only or all deals) plus the red-flag window (default 7 days). Changes affect deals won from then on.
- Admin work → Work queue: won deals with checklists, soonest training first, with filters for In progress, Needs attention and All done. A red flag shows when training is within the window and the grant isn't approved or the trainer isn't confirmed, or when the training date has passed with steps open. Older won deals without a checklist are listed separately with a "Start checklist" button.
- **Reps see the checklist read-only** (Joel confirmed 2026-10-16, after briefly considering hiding it): progress bar, each step done or not, and its details (who and when, notes, venue and paid status, trainer, grant number). They have no tick or edit buttons. The deal list shows "admin X of Y".
- In their own workspace, Admin sees an "Everyone's / Mine" switch on Quotations.
- Rules: `deal_checklists` can be read by every team member and changed only by Admin and Management; the deal owner can only create it (when marking the deal won). `config/checklist_tasks` can be changed only by Admin or Management. `quotations` moved out of the open catch-all into owner-based rules; old templates with no owner stay editable by all.

- After-training steps (added at Joel's request, 2026-10-16): JD14 (HRDC deals only), Certificates, Training report, Output assessment. These are simple ticks with notes, marked "After training". Any simple task can be set to Before or After training in Checklist tasks. Before training day only the before-training steps can raise flags. Once the date passes, open before-training steps are red, and open after-training steps show as an amber reminder.
- New built-in tasks added in code are added automatically to a master list that was already saved (`readSettings` merges missing built-in ids). Ones Joel stopped using stay retired.

Not in 2B: training day (attendance, photos) and POs. Joel can add them as tasks himself, or they can become proper stages in Phase 3.

## 6a. Phase 2C, HRDC work (built 2026-10-16)

Joel's input: HRDC can raise **queries** before the training is approved, during the training, and after it's completed, and the team must attend to them. Some new programmes must be **pre-registered in the HRDC portal** and approved before they can be used for a client. Joel said "let's move on" without answering two detail questions, so these defaults were agreed (with his yes):
- Programmes live in one list (Admin work → Programmes). Anyone can quick-add a programme from the deal form, but only as "Not registered". Only Admin and Management change its HRDC status, code and dates. Deals must pick a programme from the list. Older deals keep their typed name until edited.
- HRDC query reply-by dates are typed from HRDC's email for each query, with no hardcoded deadline. "Handled by" can be any active team member and defaults to the person logging it. Admin and Management add, answer, reopen or delete queries. Reps see them read-only.
- Gate: an HRDC or HRDC + top-up deal whose programme isn't HRDC approved (or isn't picked from the list) can't tick "Apply grant". The deal panel shows why.
- Work queue: an open query is a red flag, an overdue query goes to the top, and a deal with open queries isn't "All done". A programme that isn't approved is an amber flag while the grant step is open. Programmes → "Waiting on HRDC" lists submitted programmes.
- Still to confirm with Joel: whether HRDC gives a programme code on approval (the field is optional), and who usually handles queries.
- A useful next step: add "Verify T3 attendance" as an after-training, HRDC-only checklist task (Joel can add it himself in Checklist tasks).

## 6b. Phase 3, money (built 2026-10-16)

Joel's answers (2026-10-16):
- HRDC deals: after training, HR signs the JD14, T3 attendance is verified, we invoice (claim) HRDC, and HRDC pays and notifies us by email.
- **HRDC always keeps 4%** and pays the rest. This is expected, not a shortfall to invoice the client for.
- Not fully HRDC (direct or top-up): invoice the client directly **before** training; the client pays **after** training.
- Money out: Admin or Management can request payment. The cross-approval rule is confirmed. Some **deposits are paid before training** (venue, bus, materials).

What was built:
- `money_in/{id}`: HRDC claim or client invoice on a deal (number, date, amount; then paid date and amount). Admin and Management record it. Everyone can read it, because reps see payment status only (`RepMoneyStatus`).
- `money_out/{id}`: payment request (category, payee, amount, timing "Deposit before training" or "After training"). Statuses: pending → approved or rejected → paid. Admin and Management only.
  - The rules enforce that only a manager who did not raise the request can approve or reject it, so an Admin request can be decided by either manager and a manager's request only by the other. Only approved items can be marked paid. The UI hides Approve on your own request.
- `config/money_settings`: `hrdcDeductionPct` (default 4), `overdueDays` (default 30), `claimDeadlineDays` (default 180: HRD Corp allows 6 months; blank = no countdown), `claimReminderDays` (default 14: red reminder if the claim isn't submitted by then).
- P&L per deal (`dealPL` in `src/lib/money.ts`): invoiced and claimed, minus HRDC %, minus any extra HRDC shortfall, minus approved and paid costs, equals profit. It also shows received, still to come in, still to pay out, and waiting for approval (not counted in costs).
- Work queue flags (`moneyFlags`): HRDC claim not submitted after training (with deadline countdown once set), client invoice not sent (amber within 7 days of training, red after), payment overdue, HRDC paid less than expected, requests waiting for approval. A deal is "All done" only when its checklist is done, its queries are answered and its money is settled.
- Screens: "Money" section on won deals (Deals panel and work queue). Admin work → Money lists approvals waiting, approved-to-pay, money still to come in, and the settings.
- `src/components/Money.tsx` and `src/lib/money.ts`.
- The old rep-workspace tabs "Client Payments" and "Raise Payment" are hidden. Their code (including the hardcoded `xin-ying` approval logic) is still in `RepDetailDashboard.tsx` and `ClientPaymentManager.tsx` but can no longer be reached. Delete it in the Phase 4 tidy-up. Old `payments` and `client_payments` data stay until cleared in Data tools.

### Later phases
- **Phase 4A, "My home" page (built 2026-10-16; Joel decided to build it instead of waiting).**
  - **Team workspaces page removed.** Everyone lands on **My home** after login (`selectedRepId` starts null). The top-bar "Team workspaces" button is now "My home".
  - Layout in Joel's order: shortcuts bar (My workspace; Admin work and "Open a teammate's workspace" for Admin and Management; Management for Management), then **1. Calendar**, **2. Performance rings**, **3. My cards**.
  - Calendar and Notices reuse the old `HomeDashboard` parts through a `section` prop ('calendar' or 'notices'), so Google Calendar sync and event tagging still work. Its rep cards, KPI tiles and month selector are no longer shown anywhere.
  - **Rings** (Joel's design): one ring pair each. The big outer ring is year-to-date sales won (RM) against the yearly target; the small inner ring is this month against the monthly target. Year = Jan to Dec. Yearly target = monthly Closing RM target x 12. Counted by won date, like the KPIs. Admin and Management see **Company** (all won deals against the sum of sellers' targets). Anyone with a Closing RM target sees **Me**. Management also sees small rings for each person. **Reps see only "Me"** (default: Joel was asked whether reps should see Company and didn't answer; the switch is `showCompany` in `MyHome.tsx`).
  - **My cards**: each person picks and orders their own (Customise), saved in `user_prefs/{memberId}.homeCards` (rule: only that person can read or write it). Library and roles are in `CARDS` in `src/components/MyHome.tsx`. Defaults: rep = follow-ups, my KPI, next 14 days, my won deals, notices. Admin = new won deals, due now, money jobs, next 14 days, notices. Management = approvals, money position, pipeline and stuck deals, next 14 days, notices. There's no separate "Team KPI" card because the per-person rings cover it.
  - **Joel's adjustments after first look (2026-10-16):**
    - Calendar is now **small** (`CompactCalendar` in `MyHome.tsx`): a month grid with a dot on days with events. Pointing at (or tapping) a date shows that day's events underneath. "Add event / full calendar" opens the old full calendar (Google sync, attendees) inside the card.
    - Performance is **one row** next to the calendar: small ring pairs side by side (Company, Me, then each person for Management), scrolling sideways if there are many. Hovering a ring shows the full RM figures.
    - **Newsfeed (Notices) removed** from everyone's default cards. The card still exists in Customise if someone wants it back.
  - **Only Management can open other people's workspaces** (Joel, 2026-10-16). Admin and reps only open their own (`canOpenWorkspace` in `App.tsx`). The "Open a teammate's workspace" picker is for Management only. Admin's deal links go to the work queue, and Admin's quotation links open their own Quotations (which lists everyone's). Admin can set a won deal's **training date in the work queue panel** (`TrainingDate` in `WorkQueue.tsx`).
  - Performance layout (redone after Joel found it odd): large ring(s) for Company and/or Me with the figures beside them, in a card the same height as the calendar; Management also gets a row of small per-person rings.
  - Joel asked: everyone has their own My home (yes). Content depends on role, and each person's Customise choice affects only their own page.
  - Admin work can be opened on a chosen tab (`initialView`) from the cards.
  - **Rules:** `user_prefs` was added to `firestore.rules`. Published by Joel on 2026-10-17.
- **Workspace and KPI page redesign (2026-10-16, Joel: "the UI is bad")**:
  - Workspace header is now name + role + page; the **Co-Pilot (AI chat) was removed everywhere** (header button, floating bubble, Management button). Its unused state and handler, and the `/api/copilot` server route, are still in `App.tsx`/`server.ts`; delete them in a later tidy-up.
  - Left menu is `src/components/WorkspaceMenu.tsx`: calm style, Lucide icons, red dots for alerts, **collapsible** to an icon strip ("Hide menu", remembered in localStorage `next_menu_collapsed`), and a sideways-scrolling row on phones. The **Appointments** item was removed (a duplicate of the deal's "Appointment held" stage); saved 'appointments' tabs redirect to Deals. `AppointmentManager.tsx` is no longer used.
  - KPI page is `src/components/KpiPage.tsx` (replaced about 750 lines in `RepDetailDashboard.tsx`). It has three parts: **This month** (score bar and one progress bar per KPI), **By week** (plain W1-W5 table; "Key in weekly numbers" appears only for typed KPIs, with Save/Cancel), and **Weekly check-in** (week tabs; what I got done, where I need help, target date, accountability partner, ask teammates; Edit/Save per week). It uses the same `month_kpis` fields as before, so old entries still show.
  - Removed: "Edit Table Cells", "Save KPI Roster", the hint text, the three weekly "flow" cards, ALL-CAPS headings.
  - Teammate requests ("Teammates asking for your help") show on the KPI page with **Done**. Done is saved in the helper's own month doc as `helpDoneList` entries `"<askerId>:<weekIndex>"`, because people can only write their own KPI records (the old design wrote to the asker's doc, which the rules block for reps). The asker sees "(done)". Old `completedTagsList`/`completedAccountabilityList` marks still count. The workspace's old "System Collaboration & Alert Hub" box was **removed** (Joel, 2026-10-17): it repeated the red dots on the workspace menu, in the old style.
- **Editing appointments and deleting deals (Joel, 2026-10-16):** only the **person who created the deal** (`creatorId`, falling back to the owner for old deals) **or Management** (`canManageDeal` in `lib/deals.ts`). They can change a booked appointment, edit a logged one (older ticked ones too), and **Delete deal** (bottom of the deal panel). A deal can't be deleted if it's won, has a **sent** quotation, money records or HRDC queries; use Mark lost instead. **Draft** quotations on the deal are deleted with it, after a confirm that names them (Joel, 2026-10-17); a rep can't if a draft belongs to someone else, because the rules only let reps delete their own quotations.
  - **Red dot on the Deals menu (fixed 2026-10-17):** it used an old check across the whole company's deals. It now uses `dealNeedsAttention` in `lib/deals.ts`, the same check as the red rows on the Deals list, for the person's own deals only, plus "Help asked" when a teammate tagged them. The rules enforce: delete only by the creator or Management, never a won deal (rules published by Joel on 2026-10-17).
- **Deal panel and checklist (Joel, 2026-10-17):**
  - "Client agreed" is now shown as **"Client approved"** everywhere. The stored stage value is still `agreed` (and `agreedDate`).
  - The journey line shows **the date each step was done** under it (`stageDate` in `lib/deals.ts`). Older deals without a saved date show nothing.
  - The deal details show **Venue**: the checklist's venue, else the quotation's, marked "(from quotation)" (`dealVenue` in `lib/checklist.ts`).
  - **Check venue + payment** and **Confirm trainer** start with the quotation's venue and trainer(s) (`effectiveVenue`, `effectiveTrainer`). They use the quotation marked sent, else the newest draft, and list every trainer on its programme lines.
  - Admin can pick from the list or type (`ChosenBox` in `DealChecklist.tsx`, saved as `venueId`/`venueName` and `trainerId`/`trainerName`), or "Use the quotation's venue" to go back.
  - Ticking Done saves whatever came from the quotation onto the checklist, so later quotation changes don't alter it. `PickOrType` is now its own file, shared with quotations.
  - **Side panels are half the screen** on computers (`md:w-1/2 md:min-w-[40rem]`) and full width on phones (Joel, 2026-10-17). This covers the Deals panel and edit form, the Work queue deal panel, the Clients panel and form, and the Programmes panel.
- **Deal journey (Joel, 2026-10-16): a proposal is not a quotation.** The **proposal** is the pitch. The **quotation** is sent only after the client agrees. **Won = the client signed the quotation.**
  - Stages: `lead` (New) → `proposal` (Proposal sent; KPI "Proposal" counts these) → `agreed` (Client agreed; `agreedDate`) → `quoted` (Quotation sent; `quotationSentDate`) → `won` (`wonDate`; Closing RM counts here) / `lost`. `appointment` is still a stage value but means "new, has met", and is shown as New on the journey line (`JOURNEY`, `journeyStage` in `lib/deals.ts`).
  - The appointment can happen at any point before Won (before or after the proposal); the appointment box works at every open stage.
  - Main button by stage: New → "Proposal sent"; Proposal sent → "Client agreed"; Client agreed → "Create quotation" (plus "Quotation sent" if one exists); Quotation sent → "Mark won (client signed)". "Mark lost" is available at every open stage. Won can only be marked from Quotation sent.
  - Quotations: "Create quotation" only appears from Client agreed (`canQuote`). The New quotation picker lists only agreed/quoted/won deals; the "client only" option was removed. Marking a quotation **sent** moves its deal from Client agreed to Quotation sent automatically.
  - Deals tiles and Management's pipeline card use New, Proposal sent, Client agreed, Quotation sent. Quotations unsigned for 7+ days with no follow-up count as stuck.
- **Appointments on deals (2026-10-16, Joel):** an appointment is **optional**; reps may go straight from Lead to "Proposal sent". **At most one appointment per deal**, stored on the deal as `appointment` (`src/lib/appointments.ts`, UI `src/components/DealAppointmentBox.tsx` in the deal panel). The old one-click "Appointment held" button is gone.
  - **Book** (date, time, face-to-face/online/call): shows on the **team calendar**. App builds calendar entries from deals (`appointmentEvents`), ids `appt_<dealId>`, which can't be deleted from the calendar.
  - **Log** (one form): meeting date (not in the future), met with, type; **what the client wants is saved straight onto the deal** (programmeId/courseName, trainingDate, `participants`, proposalValue, fundingType); outcome, next step and follow-up date are **required**. Logging sets `appointmentDate` (KPI counts it then, once per deal), moves Lead to Appointment, and writes history.
  - Accountability: booked and not logged a day after the date = red on the deal row, in My home "My follow-ups" and in Management's "stuck deals". Logged more than 3 days late shows "logged N days late". New My home card **"Team appointments this week"** (Admin and Management; default for Management).
  - Quotations read participants from the deal when it's set (single source).
- **Quotations redesign (2026-10-16)**: `src/components/QuotationsPage.tsx` replaced `QuotationGenerator.tsx` (deleted).
  - **List**: full width, with search, "Mine / Shared with me" (and "Everyone's" for Admin and Management in their own workspace), "Show hidden", and a ⋯ menu per row (Open, Duplicate, Hide, Delete).
  - **Editor**: one column. The top line holds the reference, date, prepared-by and owner (auto-filled; small "Edit"). Sections: 1 Client (pick from the client list to fill company, attention and address; optional linked deal), 2 Training details (venue from the venue list, time, participants, "prepared by (as printed)" = `trainingProvider`), 3 Programmes (lines pick from the **Programmes list**, which fills the HRDC code; trainer from the trainer list; fee/day x days; SST), 4 Remarks and terms (collapsed; standard terms are `DEFAULT_TERMS`), 5 Share with teammates. A fixed bottom bar shows the total, Save, Preview and Download PDF. Leaving with unsaved changes asks first.
  - **Preview**: full width, using `src/components/QuotationDocument.tsx`, the old printable A4 layout unchanged. PDF = `window.print()`, then "Save as PDF".
  - **Sharing (Joel)**: tagging no longer makes a copy. `quotation.sharedWithIds` lists teammates who can open and **edit the same quotation**; the rules allow updates by anyone in `sharedWithIds`. Old tagged copies (`taggedRepId`) still show under "Shared with me".
  - Removed: the "Select quote" drop-down (duplicate of the list), top Create/Delete, the 4 layout modes, Clear Metadata, Reset to Defaults, the 6 made-up programme presets, the duplicate "Quotation prepared by" field, per-term × buttons, undo banner, pagination. **Google Sheets sync removed for now; Joel wants to revisit it near the end.**
  - **Rules:** the quotations rule now includes `sharedWithIds`. Published by Joel on 2026-10-17.
  - **One source of truth (Joel, 2026-10-16):** quotations no longer copy details. They link and read live through `src/lib/quoteResolve.ts` (`resolveQuotation`):
    - company, attention, address from the **client list** (the linked deal's client); owner from the **deal**;
    - each line's programme name and HRDC code from the **programme list** (`items[].programmeId`), trainer from the **trainer list** (`items[].trainerId`), training date from the **deal** (`items[].useDealDate`), venue from the **venue list** (`venueId`).
    - Only quotation-specific things are typed: fee per day (first line starts at the deal value), days, time, participants, extra lines, remarks/terms, SST.
    - **New quotation** first asks "Which deal is this for?" (or "client only"). `buildQuotationForDeal` (Deals and work queue) now links instead of copying.
    - **Mark as sent** writes the resolved text into the quotation and sets `status: 'sent'` (locked, read-only, banner). **Revise** sets it back to draft so it reads live again. The list shows Draft or Sent.
    - Older quotations without links keep and print their typed text until someone links a deal or client.
  - **Pick or type (Joel, 2026-10-17):**
    - **Attention to** fills from the client's contact person; "Change" types a different PIC for this quotation only (`attnOverride`). The client list isn't changed.
    - **Venue, programme and trainer** are one box each (`PickOrType` in `QuotationsPage.tsx`): pick from the list (stays linked, read live, "From list") or type anything else (kept as typed, "Typed"). A typed programme gets a typeable HRDC code.
    - **Other items** (bus, T-shirts…): "Add other item" adds a line with `kind: 'item'`, holding only a description, price each (`feePerDay`) and quantity (`days`).
    - The printed quotation gained a **"Days / Qty"** column, and "Rate / Day" is now "Rate" (Joel agreed). The total rows still say "course fees".
    - Missing source details (e.g. a client with no address) show as a "Fix these at the source" list, with links to the right tab.
- **Tidy-up (done and pushed 2026-10-16):**
  - Removed every fallback to made-up sample deals ("Petronas Digital", "Maybank HQ", ...). They were in Home, Management, the rep workspace and the "URGENT" notices in `App.tsx`. Deals now come only from the live database (`pipelinesSync`).
  - Replaced hardcoded staff ids: Admin Records editing is now `rep.role === 'admin'` (it was two named ids, so new admins couldn't edit), and the quotation tag list uses the real team.
  - Deleted the retired payment screens (`ClientPaymentManager.tsx`, the "Raise Payment" block, `payments` state and sync in `RepDetailDashboard.tsx`).
  - `npm audit fix` cut the warnings from 13 to 4. The remaining 4 are `@grpc/grpc-js` inside the Firebase SDK, in a part used only on servers, not in the browser. npm's "fix" would downgrade Firebase to v9 and break the app, so don't apply `--force`.
  - Faster loading: the big screens are `React.lazy` in `App.tsx`, and `vite.config.ts` splits firebase, react and vendor code into separate files. The login page now downloads about 1.08 MB instead of 1.75 MB (gzip about 293 KB instead of 430 KB). Firebase (527 KB) is the largest remaining file; the size warning for it is expected.
  - Left on purpose: the hidden demo course-outline template owned by `'xin-ying'` in `CourseOutlineGenerator.tsx` (nobody can see it), and localStorage cache key names containing an email (they only name a browser cache).
- **Clients redesign (2026-10-17, Joel: "the UI is bad, confusing"; keep the same customer details):** `src/components/ClientManager.tsx` rewritten in the new style.
  - Title with count, one search box (company, person, phone, email), **Add client**, then a plain A–Z list (company; contact · phone; HRDC tag; number of deals).
  - Clicking a client opens a side panel: contact with Call / WhatsApp / Email buttons, address, notes, and live history read from the deals (new stages, values), quotations (Draft/Sent) and `money_in` (invoiced vs received). Deals and quotations are matched by `clientId`, or by company name for older unlinked records.
  - Add/edit form: the same fields as before (company name, industry, HRDC registered, address; contact name, job title, phone, email; notes). Only the company name is required. A duplicate company name is refused, with an "Open it" link.
  - **Only Management can delete a client** (Joel), and only when no deal or quotation uses it. `clients` now has its own rule in `firestore.rules` (any member reads, adds, edits; delete Management only) and was taken out of the catch-all list. **Rules need publishing.**
  - Removed: the four stat boxes, the dark control panel, sort drop-down, undo banner and the old "View 360" pop-up (it read old appointments, admin records and payments).
- **Course outlines redesign (2026-10-17, Joel: "similar to quotation"):** `src/components/CourseOutlinesPage.tsx` replaced `CourseOutlineGenerator.tsx` (deleted). It works the same way as quotations.
  - **List**: search, Mine / Shared with me (plus Everyone's for Admin and Management), Show hidden, and a ⋯ menu (Open, Duplicate, Hide, Delete). Each row shows title, ref, Draft/Sent, client, "N days · M modules", date and owner.
  - **New outline**: 1) "Which deal is this for?": any open or won deal, since outlines often go with the proposal, or "general outline, not for a client". 2) "Start from": blank, or a copy of an earlier outline, with the same programme listed first. So a programme's modules are typed once and reused.
  - "Create outline" on a deal opens step 2 for that deal (`outlineStartDeal` in `RepDetailDashboard.tsx`). Nothing is saved until Save.
  - **Editor** (one column): 1 Deal and client (read live; a general outline has a typed "Prepared for"), 2 Course details, 3 Overview and learning outcomes (one per line), 4 Modules (title, duration, method, topics; add, remove, reorder), 5 Share with teammates.
    - The course title follows the deal's programme name (`useProgrammeName`) unless "Type a different title" is clicked.
    - The bottom bar has Save, Preview, Download PDF and Mark as sent (locks; Revise unlocks).
  - Live details come from `src/lib/outlineResolve.ts` (`resolveOutline`): company from the client list, title from the deal's programme, owner from the deal. New references are `CO/YYYYMMDD/NN`.
  - **Printout**: `src/components/CourseOutlineDocument.tsx`, the old layout unchanged (minus the editor hint text).
  - Removed: the 4 layout modes, split view, the made-up "Web Technologies" sample modules, pagination, undo banner and the old tagging that made copies (replaced by `sharedWithIds`).
  - **Rules:** `course_outlines` now has its own rule like quotations (own, shared, tagged, or Admin and Management; old outlines with no owner stay open) and left the catch-all list. **Rules need publishing.**
- **Still open from the tidy-up:**
  - **Old "P&L" tab retired** (Joel, 2026-10-16): its button, screen and demo-data writer were removed, and a saved 'pl' tab redirects to Deals. Its state and handlers (`projectPLs`, `getDefaultProjectPLs`, tabulation helpers) are still in `RepDetailDashboard.tsx` but can no longer be reached. Delete them during the screen redesign. Old `project_pls` data stays until cleared in Data tools.
  - **"Admin work" moved (Joel, 2026-10-16):** it is no longer in the top bar. It is a shortcut on My home, shown only to Admin and Management, with a "Back to My home" link.
  - Redesign the remaining old cramped screens in the new style.
- **Phase 4B:** ideas for more My home cards can come from how the team uses it.

## 7. How to start each session

1. `git pull`, then read this file.
2. Tell Joel in two or three plain sentences where things stand and what you suggest doing next.
3. Ask before coding, build and test before showing him, and ask before pushing.
4. Keep this file up to date: when a phase or decision changes, update the relevant section in the same commit, and tell Joel you did.
