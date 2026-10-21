# NEXT Academy CRM: handover for Claude Code

Read this file at the start of every session. It holds the working rules and the decisions that apply everywhere. Detailed history of each feature (what was built, why, how it was tested) is in `docs/features/` (index in section 5). Read a feature file only when working on that area.

## 1. Who you are working with, and how

The owner (Joel, Management) has **zero programming knowledge**. Act as an expert CRM manager, an expert in Malaysia's HRDC (HRD Corp) training industry, and an expert in operations and finance.

Working rules, agreed and non-negotiable:

1. **Always check the latest code first.** Run `git pull` and `git status` before planning or changing anything.
2. **Always ask before producing fix code.** Explain the plan in plain language and wait for a clear "yes" before writing code.
3. **Always ask before pushing.** After building and testing, summarise what changed and ask permission before `git push`. Pushing to `main` deploys to the live CRM automatically.
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
- **Amounts** use `formatRM` (two decimals, sen shown).
- **Company details** (address, phone, email, quotation signatory) live only in `src/lib/company.ts`.
- **No hardcoded names or IDs.** People come from Team; clients, trainers, venues, programmes from their lists.
- **Client pages** (`/q/`, `/o/`, `/p/`, `/t/`, `/pay/`) talk only to their own server routes and receive only printed fields.
- `src/components/RepDetailDashboard.tsx` is large older code: edit surgically.

## 4. Key facts (details in the feature files)

- **Deal stages** (`src/lib/deals.ts`, collection `pipelines`): `lead` (New; `appointment` = New, has met) → `proposal` (Proposal sent) → `agreed` (shown "Client approved") → `quoted` (Quotation sent) → `won` / `lost`. A proposal is the pitch (course outline or teambuilding proposal); the quotation follows client approval; Won = client signed. On hold keeps the stage.
- **Won deals: date changes and cancellations** are asked by the owner, Admin or Management and need a manager's approval (never your own); a cancellation makes the deal lost ("Training cancelled") and removes its Closing RM. See `deals.md`.
- **KPIs** (`src/lib/kpi.ts`): Closing RM counts in the month a deal is won, for the deal owner only; Proposal on `proposalSentDate`; Appointment when logged. Templates `sales_standard`, `sales_public`, `sales_trainer`, `admin_ops` (claims and venues automatic plus typed). Management has no KPIs unless a set is chosen, but always has a workspace. Full table in `docs/features/home-kpi-dashboards.md`.
- **Who sees what:** only Management opens other people's workspaces. Client link tracking: Management, plus people Management ticks, on their own deals. Payment tracking: Management full; Admin without costs or profit.
- **Money:** HRDC always keeps 4% (`hrdcDeductionPct`). Claim deadline default 180 days, red reminder after 14. Payment requests: cross-approval, never your own, only approved can be paid. Training costs are raised from the deal's before-training checklist (no separate form); vendors with bank details live in Admin work → Vendors (Admin and Management only). Sales commission (`commissionPct`, default 3%) of the price before SST and HRDC's % is taken off each training's profit, for the deal owner. Management can delete anything (deals are kept and restorable).
- **Data policy:** keep clients, venues, trainers, quotations, deals, course outlines, KPI history (`month_kpis`), tasks. Clear (only Joel, via Data tools, after linking old records): appointments, admin_records, payments, client_payments, events, project_pls, links, old `reps` docs.

## 5. Feature files (`docs/features/`)

| File | Covers |
|---|---|
| `file-map.md` | Where every file and collection lives |
| `go-live-checklist.md` | Full test steps for each open to-do |
| `deals.md` | Deal journey, appointments, smoother sales flow, No proposal needed, Repeat / Duplicate deal, follow-ups, lost and deleted, on hold, training days, employer name |
| `quotations-outlines.md` | Quotations, sending (PDF, email, WhatsApp, client links, link limits), proposal files, Fill in, Shared with me, course outlines, several quotations per deal, customer codes, drafts |
| `teambuilding-client-links.md` | Teambuilding proposals (A1), proposal links (B), client link tracking and protection |
| `admin-checklist.md` | Phase 2B checklist, flags, checklist files, pre-training flow with costs, vendors and the payment summary (2026-10-21) |
| `hrdc-programmes-trainers.md` | Phase 2C programmes, HRDC queries, trainer links, trainer profile and HRDC biodata |
| `trainer-portal.md` | Trainer portal (/trainer): email login for trainers given access, profile, bank, TIN, trainings, PO, fee request, rating |
| `money.md` | Phase 3 money, company payments, Link for accounts, Project P&L, manager deletes, Blueprint import, Payment tracking, After training to Case closed |
| `home-kpi-dashboards.md` | KPI templates, My home, rings, cards, workspace menu, KPI page, Team performance |
| `clients-directories-calendar.md` | Client history, Clients, Trainers, Venues, To-do, Google Calendar |
| `backup-and-tidyup.md` | Data backup, tidy-up done and still open |

## 6. Status and Joel's open to-dos

Done and live: Phases 1, 2A, 2B, 2C, 3 and 4A, plus everything in the feature files up to 2026-10-20 (After training to Case closed, commit `033b886`).

Open (full steps in `docs/features/go-live-checklist.md`; check with Joel which are done):
- **Setup:** switch on Firebase Storage (needed for proposal files, checklist files, photos, trainer uploads, receipts); Microsoft 365 setup for Outlook sending (email sending is hidden for now); Google Sheets API + backup sheet; check for a Google Workspace Shared Drive.
- **Rules to publish** (if not yet): `firestore.rules` and `storage.rules` as of the latest push (2026-10-21: `firestore.rules` adds `cost_estimates` for the Costing estimator, and Change date / Cancel training on won deals).
- **Data:** link old records in Data tools (ask for a screenshot of the matches first), then clear old data (Joel clicks; KPI history kept); both managers change passwords once; adjust KPI templates and targets; Blueprint import (check HRDC code 1000168564, the duplicate Valmont August line, and the 16 unknown trainer names).
- **To confirm with Joel:** team-building terms if they differ from course-outline terms; whether HRDC gives a programme code on approval; who usually handles HRDC queries.
- **Trainer portal (2026-10-21):** switch on Firebase Email/Password sign-in; publish both rules; go-live checklist item 32.
- **Go-live tests:** items 6 to 31 and 34 of the go-live checklist (29: pre-training checklist, vendors, payment summary; 30: Include in P&L tick; 31: one P&L; 34: Change date / Cancel training; publish `firestore.rules` for all).
- **Tidy-up:** delete unreachable old code in `RepDetailDashboard.tsx` (tasks, `handleCellChange`; old P&L done 2026-10-21); redesign remaining old screens in the new style.
- **Not built yet:** external trainer link for teambuilding proposals (A2); Google Drive copy of files; stacked quotation lines on phones; Phase 4B My home cards.

## 7. How to start each session

1. `git pull`, then read this file.
2. Tell Joel in two or three plain sentences where things stand and what you suggest doing next.
3. Ask before coding, build (and test when needed, rule 9) before showing him, and ask before pushing.
4. When a decision changes, update this file or the matching feature file in the same commit, and tell Joel in one line.
