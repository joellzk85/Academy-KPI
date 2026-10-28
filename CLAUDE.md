# NEXT Academy CRM: handover for Claude Code

Read this file at the start of every session. It holds the working rules and the decisions that apply everywhere. Detailed history of each feature (what was built, why, how it was tested) is in `docs/features/` (index in section 5). Read a feature file only when working on that area.

## 1. Who you are working with, and how

The owner (Joel, Management) has **zero programming knowledge**. Act as an expert CRM manager, an expert in Malaysia's HRDC (HRD Corp) training industry, and an expert in operations and finance.

Working rules, agreed and non-negotiable:

1. **Always check the latest code first.** Run `git pull` and `git status` before planning or changing anything.
2. **Always ask before producing fix code.** Explain the plan in plain language and wait for a clear "yes" before writing code.
3. **Always ask before pushing.** After building and testing, summarise what changed and ask permission before `git push`. Push straight to `main`, not a side branch (Joel, 2026-10-22); pushing to `main` deploys to the live CRM automatically.
4. **Change only the files that need changing.** Never rewrite the whole app for a fix.
5. **Never tell Joel to find or edit a line of code.** You make the changes.
6. **Explain everything in plain language.** No jargon without a one-line explanation. Give click-by-click steps for anything new Joel must do in Firebase, Google Cloud or GitHub.
7. **Never change code just to make a build pass** without explaining why.
8. Ask questions when something is unclear, one or two at a time.

Saving tokens (Joel, 2026-10-21):

9. **Small changes: just build them.** For labels, wording, layout tweaks and small fixes, run `npm run build` and stop; no temporary test pages. Keep full testing for money, permissions, database rules and big features.
10. **Summaries to Joel: 5 lines at most.** Plans, reports and push requests included.
11. **Rules publishing: just name the file.** Say "publish `firestore.rules`" (or `storage.rules`). Joel knows how; don't repeat the click-by-click steps. Still remind him that rules go live only after the new build is live, never before.
12. **Keep this file short.** New feature history goes into the matching `docs/features/` file, not here. Add here only rules or decisions that apply across the app, and a one-line to-do in section 6.

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
| 5 | Grant + logistics | Admin | HRDC deals: grant approved with the Employer code and Approval code (both required) before training day; trainer fee agreed by a manager before the PO |
| 6 | Training day | Admin | Training delivered: photos and signed attendance uploaded (HRDC claim needs it) |
| 7 | Post-training | Admin | JD14, T3, training report checked (certificates optional, Joel's choice) |
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
- **Owner override (2026-10-22, keep confidential):** a Management login with a record in `owner_access/{memberId}` (made only in the Firebase console) can approve their own requests, bypass checks and delete forever, and nobody else can change, reset or remove them. Never name the person or show it anywhere in the CRM, its docs or messages. `lib/superManager.ts`, `isSuper()` in the rules, `guardSuper` in `serverAuth.ts`.
- **Accounts (2026-10-28):** own staff with the Team role Accounts see only the Accounts portal (`/accounts`): no `auth_map`, so the rules give them nothing; the server serves everything. Keep them out of every CRM list (`isCrmMember`). See `money.md`.
- Money in: keyed in by Admin, no approval needed. Money out (trainer fee, venue, hotel, bus, facilitator, staff claims): raised by Admin or Management, pending until approved, and only approved items can be marked paid. Approved items feed that deal's P&L.

### Single source of truth (agreed principle)

Every piece of information is typed once, in one home; everything else points to it. People live only in the Team list. Clients, trainers and venues live only in their directories. A deal holds programme, dates, value and funding type; quotations, outlines, checklists and payments read from the deal. KPIs are never typed when they can be counted from deals. No names or IDs are hardcoded in code.

## 3. Technical setup

- **Code:** React 19 + Vite + Tailwind v4 front end in `src/`; Express server in `server.ts` with login routes in `serverAuth.ts`.
- **Database:** Firebase Firestore, project `gen-lang-client-0779528352`, default database. **Storage:** Firebase Storage bucket `gen-lang-client-0779528352.firebasestorage.app`.
- **Hosting:** Firebase App Hosting, backend `nextacademy2`. It **builds and deploys automatically from GitHub `main`**. Live site: https://nextacademy2--gen-lang-client-0779528352.asia-southeast1.hosted.app
- **GitHub is the master copy:** https://github.com/joellzk85/Academy-KPI. Google AI Studio must never be used to edit again (it would overwrite newer work).
- **Build check:** `npm install` then `npm run build`. `npx tsc --noEmit` shows only 2 warnings, in the unused old `handleCellChange` in `RepDetailDashboard.tsx` (delete in a tidy-up). Vite ignores type errors. Don't run `npm audit fix --force` (it would downgrade Firebase / exceljs).
- **Database rules:** `firestore.rules` and `storage.rules` must be **published manually** by Joel after the matching code is live (see rule 11).
- **Server identity:** the App Hosting service account `firebase-app-hosting-compute@gen-lang-client-0779528352.iam.gserviceaccount.com` is used for Google Calendar, the Google Sheet backup and Storage reads.
- **Commits:** author `joellzk85 <lzk.joel@gmail.com>`. Joel pushes via PowerShell from `C:\Users\Joel\Documents\CRM` if your push needs his GitHub sign-in.
- **Testing:** the real rules can't run in Google's emulator (no Java on this PC). Bigger features are tested with scripts and a temporary local page on a pretend in-memory database; server routes, uploads and links from a phone need the live site.

### Login design (no emails, by Joel's explicit choice)

- People pick their name and type a password. **No emails anywhere** for staff login. (Since 2026-10-21 the Firebase Email/Password sign-in method is **on for the trainer portal only**: trainers given access log in by email at `/trainer`; their logins have no `auth_map` record, so the database rules give them nothing. See `docs/features/trainer-portal.md`.) (Since 2026-10-18 each person can have a **work email** in Team, used only as the "From" address when sending quotations by Outlook; it plays no part in login.)
- The server checks passwords (scrypt hash and salt in the `secrets` collection, which no browser can read) and returns a Firebase custom token; the browser then calls `signInWithCustomToken`. The login user ID equals the team member ID.
- `team/{memberId}`: name, role, active, mustChangePassword. Public read (login list); written only by the server.
- `auth_map/{memberId}`: role and active; used by the database rules; written only by the server.
- `config/setup` marks first-time setup done.
- Management uses the Team tab to add, remove, change roles and set passwords, with a tick box for "ask them to choose their own password at next login". Setting a password or removing someone revokes their sessions.
- Google Cloud permission granted: the App Hosting service account has Service Account Token Creator; the IAM Service Account Credentials API is enabled; Firebase Authentication is started with no providers.

### Design style for new screens

Calm and readable, replacing the old cramped ALL-CAPS look. Use the Plus Jakarta Sans font, sentence-case labels, and 14 to 15px body text. Use the colour tokens in `src/index.css`: `ink`, `ink-soft`, `accent` (teal `#0E6E62`), `accent-soft`, `surface`, `line`, `attention`, `danger`. See `DealsBoard.tsx`, `TeamManager.tsx` and `LoginScreen.tsx` as the reference style. Redesign old screens as they are rebuilt, not separately.

### Code rules that apply everywhere

- **Hidden records:** any screen that reads `pipelines`, `quotations`, `course_outlines` (or a deal's money, queries, teambuilding proposals) must filter with `linkedOnly` / `withoutDeleted` from `src/lib/linked.ts`. Records whose owner isn't on the Team list, and deleted deals with their documents, are hidden everywhere (Data tools and the backup still read everything).
- **Drafts:** any new editor uses `useAutoSave`; any new form uses `useFormDraft` + `DraftBar`.
- **Drop-down lists** close on an outside click with `useCloseOnOutside`.
- **Long lists** use `usePaged` + `<ListPager />` (10 / 20 / 30 per page, 20 to start, remembered per browser; back to page 1 when a filter changes) and `sortList` / `<SortSelect />` for A to Z, Z to A, newest, oldest (`lib/listPaging.ts`, `ListPager.tsx`).
- **Side panels** put `<PanelResizer />` before the panel and use the width `md:w-[var(--panel-w,max(50vw,40rem))] md:min-w-[24rem] md:max-w-[95vw]` (drag to resize, remembered per person on that browser).
- **Amounts** use `formatRM` (two decimals, sen shown).
- **Company details** (address, phone, email, quotation signatory) live only in `src/lib/company.ts`.
- **No hardcoded names or IDs.** People come from Team; clients, trainers, venues, programmes from their lists.
- **Client pages** (`/q/`, `/o/`, `/p/`, `/t/`, `/pay/`) talk only to their own server routes and receive only printed fields.
- `src/components/RepDetailDashboard.tsx` is large older code: edit surgically.

## 4. Key facts (details in the feature files)

- **Discovery (2026-10-28):** stage `discovery` comes before New: we met the client and proposed something, but they haven't asked for anything. Not a deal (never open, never lost, no `requestDate`); its meeting (phone, online or face-to-face) is a must, logged or booked when it is made; it counts as a discovery (and in KPIs) only once the meeting is logged, and counts as an appointment; it becomes a deal (only after the meeting is logged) by "Convert to deal" or is closed "No interest". Reps move a New deal back only within Management's hours (`config/discovery_settings`). See `deals.md`.
- **Deal stages** (`src/lib/deals.ts`, collection `pipelines`): `lead` (New; `appointment` = New, has met) → `proposal` (Proposal sent) → `agreed` (shown "Client approved") → `quoted` (Quotation sent) → `won` / `lost`. A proposal is the pitch (course outline or teambuilding proposal); the quotation follows client approval; Won = client signed. On hold keeps the stage.
- **Won deals: date changes and cancellations** are asked by the owner, Admin or Management and need a manager's approval (never your own); a cancellation makes the deal lost ("Training cancelled") and removes its Closing RM. See `deals.md`.
- **KPIs** (`src/lib/kpi.ts`): Closing RM counts in the month a deal is won, for the deal owner only; Proposal on `proposalSentDate`; Appointment when logged. Since 2026-10-22 Management picks each person's KPIs from the **KPI library** (KPI & appraisal → Settings, `lib/kpiLibrary.ts`, `config/kpi_library`): any KPI, own target or colour bands (green / amber / red / grey, points per colour editable), weights adding up to 100%; the old templates are ready-made sets. The company GP bands are one setting, also used by Project P&L and the Costing estimator; GP % comes from the server (`serverKpi.ts`) because reps and Admin can't read costs. Management has no KPIs unless a set is chosen, but always has a workspace. Every KPI bar and ring is a traffic light: 0–35% red, 36–75% amber, 76%+ green (`kpiLight`). Full table in `docs/features/home-kpi-dashboards.md`.
- **Performance scorecard (2026-10-25):** the appraisal is Performance (KPI + reliability), Competency (skills, quarterly manager review) and Behavioural (HEART values: 360 teammates 50% + manager 50%), adding up to **one overall score** weighted by level (Executive 60/20/20, Manager 50/30/20, Senior management 50/25/25; editable). This replaces the 2026-10-22 "no combined total". Never your own review. Since 2026-10-25 all in **KPI & appraisal** (private room by default, tickable); Commence appraisal opens self reviews and the 360 (everyone rates everyone, or Management picks who rates whom, changeable while open; 2026-10-26); self ratings never count; no one sees ratings until Management releases them, and released comments show who wrote them (never say so on screen). `lib/scorecard.ts`; see `home-kpi-dashboards.md`.
- **KPI integrity (2026-10-22):** won date is today (only Management picks another); a won deal's value, pax, programme and funding type are locked, value and pax change only through an approved "Change value / pax"; Management → Deal checks shows original vs adjusted Closing RM and red flags; months lock at 00:00 MYT on the 3rd of the next month (Management can reopen). See `deals.md`.
- **Enforced in the database, not just on screen (process audit, 2026-10-22):** only Management undoes a win, changes a won deal's owner, undoes a payment, changes money settings or erases money; deal History is add-only; new or changed vendor bank details reach accounts only after another manager checks them; Include in P&L starts ticked (unticking needs a reason); HRDC claim needs Grant approved and Training delivered; an HRDC shortfall needs a top-up invoice or a Management write-off before Case closed; IC numbers and trainers' personal details are Admin and Management only. See `process-audit.md`.
- **Private room (2026-10-24):** opened by double-clicking the clock, only with the owner override; never hint at it on screen. Login log, Backup and Restore are owner only (server `ownerFrom`, rules via `isSuper()`); `config/screens` moves chosen Management screens there. See `backup-and-tidyup.md`.
- **Commission split and referral fees (2026-10-24):** a co-closer either shares the owner's commission by an agreed % or gets their own % of the price on top; commission only (`lib/coClose.ts`); a referrer's fee (% of deal value or fixed RM) is a pending payment request raised by the server when the deal is won (`lib/referrers.ts`). Clients have Found by, changed only by Management (`lib/foundBy.ts`). See `deals.md`, `money.md`.
- **Who sees what:** only Management opens other people's workspaces. Client link tracking: Management, plus people Management ticks, on their own deals. Payment tracking: Management and Admin (costs and profit included, Joel 2026-10-22).
- **Money:** HRDC always keeps 4% (`hrdcDeductionPct`). Claim deadline default 180 days, red reminder after 14. Payment requests: cross-approval, never your own, only approved can be paid. Training costs are raised from the deal's before-training checklist (no separate form); accounts get approved payments only on a payment summary (PDF or link, one summary per payment), post-training ones from the day after the training; vendors with bank details live in Admin work → Vendors (Admin and Management only). Sales commission (`commissionPct`, default 3%) of the price after SST and HRDC's 4% (2026-10-27, all trainings) is taken off each training's profit, for the deal owner. Management can delete anything (deals and money records are kept and restorable).
- **Data policy:** keep clients, venues, trainers, quotations, deals, course outlines, KPI history (`month_kpis`), tasks. Clear (only Joel, via Data tools, after linking old records): appointments, admin_records, payments, client_payments, events, project_pls, links, old `reps` docs.

## 5. Feature files (`docs/features/`)

| File | Covers |
|---|---|
| `file-map.md` | Where every file and collection lives |
| `go-live-checklist.md` | Full test steps for each open to-do |
| `deals.md` | Deal journey, appointments, smoother sales flow, No proposal needed, Repeat / Duplicate deal, follow-ups, lost and deleted, on hold, training days, employer name |
| `quotations-outlines.md` | Quotations, sending (PDF, email, WhatsApp, client links, link limits), proposal files, Fill in, Shared with me, course outlines, several quotations per deal, customer codes, drafts |
| `teambuilding-client-links.md` | Teambuilding proposals (A1), proposal links (B), client link tracking and protection |
| `admin-checklist.md` | Phase 2B checklist, flags, checklist files, pre-training flow with costs, vendors and the payment summary (2026-10-21), co-trainer and facilitator days (2026-10-22) |
| `hrdc-programmes-trainers.md` | Phase 2C programmes (titles are the programmes, categories, #tags), HRDC queries, trainer links, trainer profile and HRDC biodata |
| `trainer-portal.md` | Trainer portal (/trainer): email login for trainers given access, profile, bank, TIN, trainings, PO, fee request, rating |
| `training-report.md` | Training report: trainer writes it in the portal (or Admin on the deal), can change it after sending (change list), pax from the deal, checked, Management picks HR's sections, PDF or link for HR |
| `money.md` | Phase 3 money, company payments, Link for accounts, Project P&L, manager deletes, Blueprint import, Payment tracking, After training to Case closed, paid on behalf of client |
| `home-kpi-dashboards.md` | KPI templates, My home, rings, cards, workspace menu, KPI page, Team performance, weekly presentation (Present tab, action points), Login log, Appraisal |
| `clients-directories-calendar.md` | Client history, Clients, Trainers, Venues, To-do, Google Calendar |
| `backup-and-tidyup.md` | Data backup, tidy-up done and still open |
| `process-audit.md` | Process audit fixes (2026-10-22): money controls, deal rules, HRDC gates, PDPA |
| `one-to-one.md` | 1-to-1 sessions: booking and accepting, before / during / after questions (editable), actions to To-do, ratings, private notes, calendar, KPI |
| `full-deal-test.md` | Full deal test of 22 Oct 2026: every problem found, Joel's fix / leave decisions, the four fix batches and what is done |
| `public-programmes.md` | Public programmes: one run on fixed dates, one deal per company (own rep, pax, funding), seats, list price and discounts, date change, cancel or move |

## 6. Status and Joel's open to-dos

Done and live: Phases 1, 2A, 2B, 2C, 3 and 4A, plus everything in the feature files up to 2026-10-20 (After training to Case closed, commit `033b886`).

Open (full steps in `docs/features/go-live-checklist.md`; check with Joel which are done):
- **Setup:** switch on Firebase Storage (needed for proposal files, checklist files, photos, trainer uploads, receipts); Microsoft 365 setup for Outlook sending (email sending is hidden for now); Google Sheets API + backup sheet; check for a Google Workspace Shared Drive.
- **Rules to publish** (if not yet): `firestore.rules` and `storage.rules` as of the latest push (2026-10-21: `firestore.rules` adds `cost_estimates` for the Costing estimator, and Change date / Cancel training on won deals; Fix and send again on rejected payment requests).
- **Data:** link old records in Data tools (ask for a screenshot of the matches first), then clear old data (Joel clicks; KPI history kept); both managers change passwords once; adjust KPI templates and targets; Blueprint import (check HRDC code 1000168564, the duplicate Valmont August line, and the 16 unknown trainer names).
- **To confirm with Joel:** team-building terms if they differ from course-outline terms; whether HRDC gives a programme code on approval; who usually handles HRDC queries.
- **Trainer portal (2026-10-21):** switch on Firebase Email/Password sign-in; publish both rules; go-live checklist item 32.
- **Weekly presentation (2026-10-21):** publish `firestore.rules` (`present_prefs`, `present_settings`, `meeting_notes`); go-live checklist items 36 and 37.
- **Training report (2026-10-21):** publish `firestore.rules` (`training_reports`); go-live checklist items 38 and 39. Later: read the Output assessment file by itself (needs a sample file from Joel).
- **Trainer fee checks (2026-10-21):** nothing to publish; go-live checklist item 40.
- **Trainer outlines and teambuilding proposals (2026-10-21):** publish `firestore.rules` (`trainer_docs`); go-live checklist item 41.
- **Search, client logo, KPI colours, potential, projection (2026-10-21):** publish `storage.rules` (logos) and `firestore.rules` (`forecast_settings`); go-live checklist item 42.
- **Login log (2026-10-22):** publish `firestore.rules` (`login_days`, `login_rules`); go-live checklist item 43.
- **Login log work done and screens (2026-10-22):** publish `firestore.rules` (`login_days` actions and places); go-live checklist item 50.
- **KPI library (2026-10-22):** publish `firestore.rules` (`kpi_library`); go-live checklist item 44.
- **Trainer KPIs and activity approval (2026-10-22):** publish `firestore.rules` (`tb_activities`); go-live checklist item 45.
- **360 rating (2026-10-22):** publish `firestore.rules` (`rating_rounds`, `ratings_360`); go-live checklist item 47.
- **Deal checks and month lock (2026-10-22):** publish `firestore.rules` (won date, won-deal locks, `integrityChecks`, `month_kpis` lock, `config/month_locks`); go-live checklist items 48 and 49.
- **Co-trainer and facilitator days (2026-10-22):** nothing to publish; go-live checklist item 46.
- **Paid on behalf of client (2026-10-22):** "Pay on behalf of client" tick on checklist cost lines, never in the P&L, claimed back on a reimbursement invoice in After training step 5; publish `firestore.rules` (`claim_backs`); go-live checklist item 52.
- **Appraisal (2026-10-22):** KPI, 360 attitude items and reliability as three separate parts (Management → Appraisal); publish `firestore.rules`; go-live checklist item 51.
- **Process audit fixes (2026-10-22):** money controls, deal and KPI rules, HRDC gates, PDPA (`process-audit.md`); publish **both** rules files straight after it is live (until then approvals and T3 saves fail); go-live checklist item 53.
- **Go-live tests:** items 6 to 31, 34 and 35 of the go-live checklist (29: pre-training checklist, vendors, payment summary; 30: Include in P&L tick; 31: one P&L; 34: Change date / Cancel training; publish `firestore.rules` for all).
- **Tidy-up:** delete unreachable old code in `RepDetailDashboard.tsx` (tasks, `handleCellChange`; old P&L done 2026-10-21); redesign remaining old screens in the new style.
- **Full deal test fixes (Joel, 2026-10-23):** decisions and the four batches are in `docs/features/full-deal-test.md`; all four batches done 2026-10-23. Publish `firestore.rules` (Batch 3 discount requests, Batch 4 Agree fee); (the "(TB)" step is no longer needed: see 2026-10-24 below). HRDC Employer code and Approval code on Grant approved (go-live checklist item 54), required since Batch 4. (The older rule tests' 3 failures were an out-of-date test, fixed 2026-10-23; rules unchanged.)
- **Programmes linked to outlines and trainers; venue address (2026-10-23):** publish `storage.rules` (`programme_files`); go-live checklist item 55.
- **Logins, places, devices, sensitive actions (2026-10-24):** in Login log, never mentioned to staff (Joel); publish `firestore.rules`; go-live checklist item 56.
- **Private room, Backup and Restore (2026-10-24):** double-click the clock (owner only); Login log, Backup, Restore (saved daily copies + last 7 days, undo) and ticked screens live there; publish `firestore.rules`; go-live checklist item 57.
- **Task shortcut inside a deal (2026-10-24):** "+ Task" on every deal and checklist step, tag anyone; Raise payment fills in from the step; nothing to publish; go-live checklist item 58.
- **Co-closed deals, client Found by, Referred by and referral fees (2026-10-24):** commission only is shared (KPIs stay with the owner); referral fee request raised when won; publish `firestore.rules`; go-live checklist item 59.
- **Sales contributor ring (2026-10-24):** Team → KPIs tick gives Admin / Management who sell a sales ring without a sales KPI; nothing to publish. See `home-kpi-dashboards.md`.
- **Titles are the programmes (2026-10-24):** no Programmes tab; Course outlines and Teambuilding proposal → By title holds HRDC status, category (standard list + new) and #tags; anyone sets category and tags, only Admin / Management rename or change HRDC; publish `firestore.rules`; go-live checklist item 60. See `hrdc-programmes-trainers.md`.
- **Claim and invoice copies (2026-10-24):** HRDC claim, client invoice and reimbursement invoice take a file or pasted screenshot (Ctrl+V); required on new records before Case closed, never counted as the receipt; nothing to publish; go-live checklist item 61. See `money.md`.
- **Pages, sort and filters on every list (2026-10-24):** nothing to publish; go-live checklist item 62.
- **Teambuilding course outlines and speed build (2026-10-24):** outline type (Teambuilding / Soft / Technical), day-by-day agenda, Speed build proposal ↔ Speed course outline, "(TB)" never printed, teambuilding deals lead with the proposal; nothing to publish; go-live checklist item 63. See `teambuilding-client-links.md`.
- **Soft skill · Team building · Technical skill (2026-10-24):** three type buttons on every title / outline list and programme picker; a title's type is set by Admin in Title details, else follows its outlines; nothing to publish; go-live checklist item 64. See `hrdc-programmes-trainers.md`.
- **Title type picked, capitals, Classroom training (2026-10-24):** a title's type (Soft skill / Team building / Technical skill) is picked, never typed as "(TB)" (older "(TB)" titles still count); new deal shows all three types and picking a title sets the deal Type (Team building, or "Classroom training", stored as `Training`); titles are capitals only (`titleCaps`), with a "Change to capitals" button in By title for older ones; nothing to publish; go-live checklist item 65. See `hrdc-programmes-trainers.md`.
- **Internal trainers in the CRM (2026-10-25):** Team → Trainer links a staff member to their trainer record; My trainings in their workspace (photos, T3, their own training report; no PO or fee); only they write the report; Trainer KPIs tick in KPIs; publish **both** rules files; go-live checklist item 66. See `trainer-portal.md`.
- **Performance scorecard and HEART values (2026-10-25):** one overall appraisal score; quarterly reviews; Use HEART values in 360 items; publish `firestore.rules`; go-live checklist item 67.
- **KPI & appraisal tab, appraisal round, self review (2026-10-25):** one tab (KPIs moved out of Team), hidden in the private room by default with a tick in Screens to bring it back to Management; Commence appraisal with a deadline; self reviews (never counted) and comments on every section; nothing seen until released; publish `firestore.rules`; go-live checklist item 68. See `home-kpi-dashboards.md`.
- **1-to-1 sessions (2026-10-25):** a 1-to-1 tab for everyone; only the person running them (picked in its Settings by the owner) sees everyone's, nobody else; publish `firestore.rules`; go-live checklist item 69. Same day: no setup (the owner runs them), simple booking with a calendar check, asked for by (KPI), both fill in, My view / Staff view, staff profile (coach-only notes); go-live checklist item 70. See `one-to-one.md`.
- **1-to-1 topics, questions per person, profile history, past sessions (2026-10-25):** only the coach sets questions (templates, per person, per session); topics picked when booking; profile history; Past 1-to-1s with search; publish `firestore.rules`; go-live checklist item 71. See `one-to-one.md`.
- **Trainer portal links and View portal as them (2026-10-26):** portal link on each trainer with access; owner views a portal as the trainer, view only; nothing to publish. See `trainer-portal.md`.
- **Meeting photos (2026-10-26):** Take photo / From gallery on face-to-face appointments and Visit follow-ups, screenshots (upload, paste, drop) on online ones, also in the Log appointment form; everyone sees the photo, only the owner sees its time and place; Meeting photos KPI (%) and 20% of Accountability and Trustworthiness in the appraisal (Joel to confirm the %); Show in presentation; publish **both** rules files; go-live checklist item 72. See `home-kpi-dashboards.md`.
- **Trainers write the CRM record (2026-10-26):** trainer portal, My trainings and trainer links (outline and the new teambuilding link) write straight into the CRM's course outline / proposal, locked once sent to a client; no more trainer copies; publish **both** rules files; go-live checklist item 73. See `trainer-portal.md`.
- **Same outline form everywhere (2026-10-26):** trainer portal, My trainings and the outline link show the CRM editor's own outline parts (`OutlineSections.tsx`) with the type; nothing to publish. See `trainer-portal.md`.
- **Payments out board (2026-10-26):** Admin work → Money → Payments out: four lanes (Waiting approval → Ready for accounts → With accounts → Paid, receipt needed), Approve on the card, one-click Send to accounts (copies the message), receipt dropped on the card; Company payments, Owed by clients, Settings are sub-tabs; nothing to publish; go-live checklist item 74. See `money.md`.
- **By title row menu and Categories (2026-10-26):** ⋯ Duplicate / Delete on each outline / proposal row in By title; Categories button to add and delete categories (titles moved first); nothing to publish. See `hrdc-programmes-trainers.md`.
- **Several files, vendor invoices, pay in parts (2026-10-26):** every upload takes several files (T3 name lists too); vendor invoices on each cost (checked against it); a cost can be paid in parts (50/50 or own split, due dates, one approval, each part to accounts on its due date, balance default in Money settings); nothing to publish; go-live checklist item 75. See `money.md`.
- **Delete outlines and proposals needs Management (2026-10-27):** reps and Admin Ask to delete, Management approves (never their own) in Lost and deleted or My home, kept and restorable, Delete forever owner only; publish `firestore.rules`; go-live checklist item 76. See `quotations-outlines.md`.
- **Download button (2026-10-27):** ⬇ next to every uploaded file and photo (`DownloadButton.tsx`, `lib/download.ts`); saves straight away only after the one-time Storage CORS setting (`storage-cors.json`), else opens in a new tab; nothing to publish; go-live checklist item 77.
- **Several employers claiming for one training (2026-10-27):** still one deal (one costing, P&L, Closing RM); Grant approved lists the employers (clients, each with Employer code, Approval code, approved amount, all needed to tick); one HRDC claim per employer; deal value never changed, a reminder when the approved total differs; nothing to publish; go-live checklist item 78. See `money.md`.
- **Training report settings, HR and HOD copies, 30-day check-in (2026-10-27):** Settings in Trainers → Training reports (Management only, preview, own questions, Back to default); new sections (summary, hours, topics, test scores, notes per person, action plan, HOD tips); PDF for HR and for HOD; check-in link /c/ for the HOD; publish `firestore.rules`; go-live checklist item 79. See `training-report.md`.
- **Discovery (2026-10-28):** Discovery button and box before New, meeting counts as an appointment, Convert to deal, No interest, "This was only a discovery" within Management's hours, four new KPIs (Discovery meetings, First touch points, Discovery to deal, Deal closing ratio); publish `firestore.rules`; go-live checklist item 80. See `deals.md`.
- **Accounts portal (2026-10-28):** Team role Accounts; accounts mark approved payments raised in the portal and Management clicks Payment done once released (board lane 4 or the portal), or Admin / Management upload the payment receipt on the card; every payment shows its documents and PO to download (one by one or a ZIP) (layout of Joel's payment request sheet, e-Invoice receiver details, history, search, PDF / Excel, questions, bank slips); Management → Accounts portal for the link and settings; nothing to publish; go-live checklist item 81. See `money.md`.
- **Public programmes, batch 1 (2026-10-28):** Deals → Public programmes: a run on fixed dates (title, venue, trainer, list price per pax, seats, minimum); each company is its own deal (own rep, pax, funding type), value = list price × pax, a lower price only through Request discount; changing, moving or cancelling a run moves open deals at once and asks a manager for won ones; publish `firestore.rules` (also fixes managers' Change date / Change value approvals on won deals, which the rules refused: too many steps); go-live checklist item 82. Batch 2 part A (operations once per run: the run's own checklist, costs and one trainer job; each company keeps grant, attendance, JD14, T3, invoice, claim; Training delivered ticked from the run) done 2026-10-28, nothing to publish, item 83. Part B (2026-10-28, Joel: split by pax): each company carries its pax share of the run's costs in every P&L and GP KPI, one P&L per run in the run's panel, company HR / HOD PDF copies of the run's report with only its staff; nothing to publish; item 84. See `public-programmes.md`.
- **Costing estimator for public programmes (2026-10-28):** New public programme estimate in the Costing estimator, or Cost this programme on a run (Admin / Management); each company its own pax, fee and HRDC tick, options A to D as mixes, costs per run / per pax / %, break-even pax and a target fee; nothing to publish; go-live checklist item 85. See `public-programmes.md`.
- **Not built yet:** Google Drive copy of files; stacked quotation lines on phones; Phase 4B My home cards.

## 7. How to start each session

1. `git pull`, then read this file.
2. Tell Joel in two or three plain sentences where things stand and what you suggest doing next.
3. Ask before coding, build (and test when needed, rule 9) before showing him, and ask before pushing.
4. When a decision changes, update this file or the matching feature file in the same commit, and tell Joel in one line.
