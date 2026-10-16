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
- **Clear (only via the Data tools button, after Joel confirms):** appointments, admin_records, payments, client_payments, month_kpis, events, tasks, project_pls, links, old `reps` docs from the previous login system.
- **Open question:** Joel mentioned wanting to keep "a few other" things. Before he clicks Clear, ask which items on the clear list he wants to keep, and update `DataTools.tsx` to skip them.

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
0b. **Phase 3 go-live:** done and tested by Joel on 2026-10-16. Rules published. Still open: Joel fills in the HRDC claim deadline in Admin work → Money once he has checked HRD Corp's current guidelines.
1. Set each person's KPI template and targets in Management → Team.
2. Link old records in Data tools (ask for a screenshot of the matches before he clicks Link).
3. ~~Test a deal from new to won and check it shows in that month's KPIs.~~ Done 2026-10-16: works.
4. Clear old data: only after the open question above is settled.
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
- `config/money_settings`: `hrdcDeductionPct` (default 4), `overdueDays` (default 30), `claimDeadlineDays` (blank until Joel confirms HRD Corp's current rule; days after training).
- P&L per deal (`dealPL` in `src/lib/money.ts`): invoiced and claimed, minus HRDC %, minus any extra HRDC shortfall, minus approved and paid costs, equals profit. It also shows received, still to come in, still to pay out, and waiting for approval (not counted in costs).
- Work queue flags (`moneyFlags`): HRDC claim not submitted after training (with deadline countdown once set), client invoice not sent (amber within 7 days of training, red after), payment overdue, HRDC paid less than expected, requests waiting for approval. A deal is "All done" only when its checklist is done, its queries are answered and its money is settled.
- Screens: "Money" section on won deals (Deals panel and work queue). Admin work → Money lists approvals waiting, approved-to-pay, money still to come in, and the settings.
- `src/components/Money.tsx` and `src/lib/money.ts`.
- The old rep-workspace tabs "Client Payments" and "Raise Payment" are hidden. Their code (including the hardcoded `xin-ying` approval logic) is still in `RepDetailDashboard.tsx` and `ClientPaymentManager.tsx` but can no longer be reached. Delete it in the Phase 4 tidy-up. Old `payments` and `client_payments` data stay until cleared in Data tools.

### Later phases
- **Phase 4A, "My home" page (agreed design, PARKED 2026-10-16; Joel: "let's revisit this next time if needed". Don't build until he says so).**
  - Joel's decision: no fixed screen per role. Each person chooses their own home-page cards and order (a "Customise" button). Nobody, including Management, sets anyone else's page. The choice is saved to the login (needs a small rule: each person writes only their own layout doc).
  - "My home" becomes the first page after login; the team-workspace page stays one click away. Cards link to where you act.
  - Card library (Joel didn't know which he wanted, so this list is the start; easy to change): My KPI vs target (rep, admin); My follow-ups due or overdue (rep, admin); My won deals with admin progress and payment status (rep); Team KPI vs target (mgmt); Pipeline by stage and stuck deals (mgmt); New won deals handover (admin, mgmt); Due now: checklist steps, HRDC queries, after-training paperwork (admin, mgmt); Next 14 days of trainings with readiness (all; reps see only their own); Money jobs: claims to submit, invoices to send, payments to chase, payouts to pay, rejected requests (admin, mgmt); Waiting for my approval (mgmt); Money position and profit this month (mgmt); Programmes waiting on HRDC (admin, mgmt); Notices and calendar (all). Reps can never pick money or approval cards.
  - Starting cards: Rep: KPI, follow-ups, won deals, next 14 days, notices. Admin: new won deals, due now, money jobs, next 14 days, programmes waiting. Management: approvals, money position, team KPI, pipeline and stuck deals, next 14 days.
- **Tidy-up (done 2026-10-16):**
  - Removed every fallback to made-up sample deals ("Petronas Digital", "Maybank HQ", ...). They were in Home, Management, the rep workspace and the "URGENT" notices in `App.tsx`. Deals now come only from the live database (`pipelinesSync`).
  - Replaced hardcoded staff ids: Admin Records editing is now `rep.role === 'admin'` (it was two named ids, so new admins couldn't edit), and the quotation tag list uses the real team.
  - Deleted the retired payment screens (`ClientPaymentManager.tsx`, the "Raise Payment" block, `payments` state and sync in `RepDetailDashboard.tsx`).
  - `npm audit fix` cut the warnings from 13 to 4. The remaining 4 are `@grpc/grpc-js` inside the Firebase SDK, in a part used only on servers, not in the browser. npm's "fix" would downgrade Firebase to v9 and break the app, so don't apply `--force`.
  - Faster loading: the big screens are `React.lazy` in `App.tsx`, and `vite.config.ts` splits firebase, react and vendor code into separate files. The login page now downloads about 1.08 MB instead of 1.75 MB (gzip about 293 KB instead of 430 KB). Firebase (527 KB) is the largest remaining file; the size warning for it is expected.
  - Left on purpose: the hidden demo course-outline template owned by `'xin-ying'` in `CourseOutlineGenerator.tsx` (nobody can see it), and localStorage cache key names containing an email (they only name a browser cache).
- **Still open from the tidy-up:**
  - **Old "P&L" tab in each workspace** (project P&Ls, `project_pls`): the first time it opens it writes demo projects ("Petronas Digital ...") to the database, and it overlaps the real per-deal P&L from Phase 3. Ask Joel whether to retire it (recommended) or keep it.
  - **"Admin work" tab position:** Joel finds it odd in the top bar. Ask him where it should live during the screen redesign.
  - Redesign the remaining old cramped screens in the new style.
- **Phase 4B, dashboards:** see Phase 4A ("My home" page, parked) for the agreed approach. It replaces the earlier "home screen per role" idea.

## 7. How to start each session

1. `git pull`, then read this file.
2. Tell Joel in two or three plain sentences where things stand and what you suggest doing next.
3. Ask before coding, build and test before showing him, and ask before pushing.
4. Keep this file up to date: when a phase or decision changes, update the relevant section in the same commit, and tell Joel you did.
