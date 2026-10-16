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

- **Code:** React 19 + Vite + Tailwind v4 front end in `src/`; Express server in `server.ts` with login routes in `serverAuth.tsx` (it should be `.ts`; it works as is, so leave it unless asked).
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

### Joel's open to-dos (check with him)
1. Set each person's KPI template and targets in Management → Team.
2. Link old records in Data tools (ask for a screenshot of the matches before he clicks Link).
3. Test a deal from new to won and check it shows in that month's KPIs.
4. Clear old data: only after the open question above is settled.
5. As a precaution, both Management people change their passwords once, because the database ran on old open rules until Phase 2A's rules were published.

## 6. Next: Phase 2B, the handover to admin

**Start by asking Joel** to describe, in his own words, the steps his admin goes through from the moment a client confirms to the moment the job is closed. Design 2B around his answer, propose the plan, and wait for his yes before coding.

Planned scope (adjust to his answer):
- Marking a deal **Won** auto-creates its admin checklist from the deal, with no retyping of client, programme, trainer or dates. Use the existing `admin_records` collection, rebuilt in the new style, or a new structure if cleaner; explain the choice.
- Operations stages with gates:
  - Grant + logistics: HRDC grant applied, then approved with grant number, before training day; trainer, venue, POs.
  - Training day: attendance, photos.
  - Post-training: JD14, certificates, training report.
  - Show only the steps that apply to the deal's funding type.
- **Admin work queue:** won deals sorted by training date, with red flags (for example, training next week with no grant approval).
- Reps see a read-only progress bar on their won deals.
- Update `firestore.rules` if needed, and remind Joel to publish.

### Later phases
- **Phase 3, money:** merge `payments` and `client_payments` into Money In (keyed by Admin) and Money Out (with the cross-approval rule above). Add funding type handling, HRDC claim tracking (claimed vs paid, top-up invoice for the shortfall, deadline warning), and real P&L per deal. Remove the remaining hardcoded `xin-ying` approval logic in `RepDetailDashboard.tsx`.
- **Phase 4, dashboards:** a home screen per role. Reps get their deals and KPI vs target. Admin gets the work queue. Management gets pipeline value by stage, team KPI, stuck deals, money owed and profit per training. Add alerts. Tidy-ups: the 13 npm security warnings, the large JS bundle (about 1.7 MB), the remaining localStorage fallbacks and old hardcoded IDs in Home and Management, and redesign of the remaining old screens.

## 7. How to start each session

1. `git pull`, then read this file.
2. Tell Joel in two or three plain sentences where things stand and what you suggest doing next.
3. Ask before coding, build and test before showing him, and ask before pushing.
4. Keep this file up to date: when a phase or decision changes, update the relevant section in the same commit, and tell Joel you did.
