# My home, workspace, KPIs and Team performance

Moved from CLAUDE.md on 2026-10-21. Detailed history of what was built and agreed. Read only when working on this area.

### KPI library and editable weights (Joel, 2026-10-22; Part A of 3)

Joel asked for every KPI to be selectable and editable for reps, Admin and Management, with editable weights and colour bands. The plan has three parts. **A** is the KPI library (built here). **B** is trainer KPIs: an Internal trainer pick in Team, output assessment, report speed, and new activities approved by Management. **C** is the 360 rating: a comment is required, open or closed view, and Management always sees who rated, with the option to let others see.

**KPI library: what Management does**
- **Where:** Team → **KPI library** (`KpiLibraryPanel.tsx`).
- **Stored in:** `config/kpi_library`, Management only. It holds the changes to built-in KPIs (`overrides`), the KPIs Management made (`custom`), the points per colour and the company GP bands.
- **Built-in KPIs:** `BUILT_IN_KPIS` in `lib/kpiLibrary.ts`. They include Joel's list and the suggestions he asked to keep:
  - Sales: Closing RM, number of closings, proposals, appointments, follow-up on new customers, gross profit, win rate, new clients won, quotation speed, days to get paid, overdue follow-ups, pipeline cover, public programme, trainer opportunity day.
  - Admin: performance rating, claims, claim submission speed, venues, HRDC grant on time, post-training documents, invoice speed, HRDC shortfall.
  - Management: company gross profit, team average.
- **Editing a KPI:** rename it, change the default target or bands, set its setting (e.g. "days before training"), or hide it.
- **New KPIs** ("create as we go"): typed in weekly (added up, or the average week; a number, RM, %, days or a 1-5 rating), or counted by any existing automatic counter.
- **Deleting:** a KPI Management made can't be deleted while it's in someone's set.

**Scoring**
- **Target KPIs:** score their % of target, with the usual 0-35 / 36-75 / 76+ light.
- **Colour band KPIs:** earn points by colour: green 100, amber 60, red 30, grey 0, all editable.
- **Which way is better:** bands can be "higher is better" or "lower is better" (days).
- **Red with no grey:** red can be "everything past amber", so there is no grey.
- **Nothing to count** (e.g. no claims this month): the KPI is left out of the score and shows "Nothing to count this month". The other weights then count for more.

**Joel's bands, as built**
- **GP:** 50%+ green, 40-49.9 amber, 30-39.9 red, below 30 grey.
- **Claim submission speed:** 7 days or less green, 8-14 amber, 15+ red. It counts days from the last training day to the HRDC claim recorded, averaged over the month's claims, for the person who recorded them.
- **Follow-up on new customers:** 10+ a week green, 5-9 amber, 1-4 red, 0 grey.
  - It counts the **different** customers followed up each week (Joel), counting only clients with no won deal before that follow-up.
  - The month figure is the average week over the weeks started so far. Days 29-31 count into week 4.

**Company GP bands: one setting**
- Used by the Gross profit and Company gross profit KPIs, the margin colours in Project P&L, and GP in the Costing estimator. The estimator's old 20% rule is gone. A loss is always red.
- **GP for a person:** the overall margin of their own trainings held that month (by training date). It uses the same P&L as Project P&L.
- **Why the server works it out:** reps and Admin can't read costs, so `serverKpi.ts` (`POST /api/kpi/gp`) returns only percentages.
- **Who sees what:** your own GP %. The company figure goes to Management, or to whoever has the Company gross profit KPI.

**Each person's KPI set**
- **Where:** Team → KPIs (`KpiSetEditor.tsx`). Saved as `reps/{id}.kpiSet.items`: `kpiId`, `weight` %, `slot`, and optionally `target`, `bands`, `param`, `label`.
- **Building a set:**
  - Start from a ready-made set (the four old templates, `KPI_PRESETS`), add or remove KPIs, or reorder them.
  - Set targets, or give the person their own bands. Gross profit always uses the company bands.
  - Give a KPI a different name for this person.
- **Weights must add up to 100%** before saving. "Spread evenly" helps.
- **Management** can still pick No KPIs.
- **Typed history is kept:** each item's `slot` is where its typed weekly numbers live in `month_kpis`. The old KPIs keep their old keys (`salesFigure`, `proposals`, `preview`, `extraMetric`), so typed history carries on. New ones use the KPI id.
- **People not yet given a set** keep their old template, read as the matching ready-made set. Nothing changes for them until Management saves a set.
- **Closing RM target:** rings, the company target and the sales projection use the person's Closing RM KPI (`closingMetric`).

**Where it shows:** the KPI page, My home's My KPI card, Team performance and the presentation scorecard all use `monthKpi` (`lib/kpi.ts`). Band KPIs show the figure and a colour badge; target KPIs show "x of y".

**Testing**
- A script checked every band, the old templates, Management without KPIs, the weekly distinct follow-up count, the GP light, KPIs with no data left out, the weighted score, library changes and a custom averaged rating.
- A temporary local page on a pretend database checked:
  - Team: editing Ali's set (presets, add KPIs, weights refused at 110%, his own bands, saved shape kept his old targets).
  - The KPI page: scores checked by hand.
  - Team performance.
  - The KPI library: GP bands changed, a custom rating KPI made, saved changes only.
  - Phone width.
- Still needs the live site: the GP server route and the rules.

### 360 rating (Joel, 2026-10-22; Part C of 3)

**What it is:** teammates rate each other 1-5 and must always say why (at least 20 characters).

**Where:** the top bar shows **Rate teammates (N)** when someone has people left to rate. The user menu has **360 rating** for everyone. Both open one side panel (`Rating360.tsx`) with three tabs:
- **To rate:** the people the open rounds give you. Each rating has stars and a reason. You can change it while the round is open; drafts are kept.
- **About me:** your ratings from closed rounds. It shows the average and every comment. Names show only for open-view rounds, and the order is shuffled.
- **Rounds (Management):**
  - **Open a round:** a name, the KPI month it counts in, and an optional "rate by" date.
  - **Who rates whom:** everyone ticked rates everyone else, or Management picks who rates each person.
  - **Closed or open view:** closed shows people their ratings without names; open shows names. Management always sees who rated whom.
  - **Following a round:** see who is still to rate and every rating with names. Close it, or reopen it.

**Data:** `rating_rounds` and `ratings_360` (`lib/rating360.ts`).
- **Who reads ratings:** only the rater and Management, by rule. People get ratings about themselves from the server (`POST /api/ratings/about-me` in `serverKpi.ts`), and only once the round is **closed**, so the timing can't give names away.
- **What the rules check:** only assigned pairs, never yourself, stars 1-5, a reason of 20+ characters, the round open, and the document id `<round>_<rater>_<ratee>`.

**360 rating KPI** (library, group Other):
- **What it counts:** the average stars received in closed rounds of that month, from `POST /api/ratings/scores`. Management gets everyone's; anyone else gets only their own.
- **Default bands:** 4.5+ green, 4.0-4.49 amber, 3.0-3.99 red, below 3 grey.

**Testing**
- A temporary local page checked:
  - Joel opened an "everyone rates everyone" round, closed view.
  - Missing stars and a too-short reason were refused; a rating was saved with the right shape.
  - The to-rate counts were right; Amy saw To rate and About me but not Rounds.
  - About me showed comments without names.
  - Results showed names and who is still to rate; Close round worked.
  - A "Management picks" round saved exactly the pairs chosen, open view.
  - Phone width.
- A script checked the KPI score.
- Needs the live site: the two server routes and the rules.

### Trainer KPIs and activity approval (Joel, 2026-10-22; Part B of 3)

**Internal trainer**
- **Where (changed 2026-10-25):** Team → **Trainer** links the person to their record in Trainers (`trainers_directory.memberId`, see `trainer-portal.md`, Internal trainers). Team → KPIs has a **Trainer KPIs** tick (only for linked people) that switches the trainer KPIs on; it saves the linked record as `reps/{id}.kpiSet.trainerId`. Unticked, the Trainer group isn't offered and its KPIs come off the set. (Before: an Internal trainer drop-down in KPIs.)
- **Who gets trainer KPIs:** only internal trainers Management ticks. Joel: some internal trainers focus on other KPIs for now.
- **Save check:** a set with trainer KPIs can't be saved for someone not linked. Changing the link in Team moves ticked trainer KPIs to the new record.
- **Which trainings count:** trainings that ended this month where the person's trainer record is the training report's trainer, or the trainer ticked on the deal's checklist.

**New KPIs in the library (Trainer group)**
- **Output assessment rating:** the average participants' rating on the training reports (`participant.avg`, typed by Admin). 4.5+ green, 4.0-4.49 amber, below red.
- **Trainer feedback speed:** average days from the last training day to the report sent (`submittedAt`, Malaysia date). A report not sent yet counts the days so far. 2 days or less green, 3-5 amber, 6-7 red, later grey.
- **Design new activity:** new teambuilding activities this person added that Management approved this month, counted by approval date. 3+ green, 2 amber, 1 red, 0 grey.

**Approving activities**
- **Saved as:** `tb_activities.approval` = `{ status: pending | approved | rejected, at, byId, byName, note }`.
- **New activities start pending.** That covers both Add activity and "save to library" from a proposal.
- **Who decides:** any Management person except the one who added it clicks **Approve**, or **Not approved** with a short reason.
- **Resending:** when the creator saves changes to a not-approved activity, it goes back to waiting.
- **Older activities** (no `approval`) stay as they are and aren't counted.
- **Library screen:** shows "Waiting for approval" and "Not approved" badges, plus a "Waiting for approval (N)" filter.

**Rules:** `firestore.rules` `tb_activities` enforces all of this: only Management, never the creator, sets approved or not approved; the creator can only send it back to waiting. Anyone else's edit keeps the approval.

**Testing**
- A script checked: only the person's own trainings counted, report days including a report not sent yet, only approved activities counted, and no trainer record meaning no data.
- A temporary local page checked:
  - Joel can't approve his own activity.
  - Not approved needs a reason; Amy saw the reason, changed the activity and it went back to waiting.
  - Joel approved it.
  - Amy's new activity started pending.
  - The Team editor refused trainer KPIs without a trainer record, then saved with one.
- The rules can't run here (no Java).

### KPI templates (follow the current KPIs; agreed)

| Template | KPIs (weight) | Counted |
|---|---|---|
| `sales_standard` | Closing RM 60%, Appointment 20%, Proposal 20% | all from deals |
| `sales_public` | Closing RM 60%, Appointment 20%, Public Programme pax 20% | last one typed weekly |
| `sales_trainer` | Closing RM 50%, Preview 17%, Proposal 17%, Trainer Opportunity Day 16% | last one typed weekly; Preview counts appointments, as before |
| `admin_ops` | Perf. rating 50%, Claim submission 40%, Venue database 10% | rating typed weekly; claims and venues automatic plus typed (see below) |

The defaults are `sales_standard` for reps and `admin_ops` for admins until Management picks a template.

**Management with KPIs (Joel, 2026-10-17, for Ying):** Management members have **no KPIs** unless a KPI set is chosen for them in Team → KPIs (the dialog has a "No KPIs" choice for Management, saved as `kpiTemplate: ''`). With a KPI set they're included in `representatives` (`App.tsx`), so they get a workspace with a KPI page, a "Me" ring, a row in Team performance and a share of the Company target. They keep all Management powers, and their workspace menu also has the Admin work link.

**Every Management member has a workspace (Joel, 2026-10-20: "Joel should have own workplace as well"):** Management without a KPI set still gets their own workspace (Deals, Quotations, Course outlines, Teambuilding proposal, Clients, Trainers, Venues, Admin work, To-do), opened from My workspace on My home. `workspacePeople` in `App.tsx` = `representatives` plus those managers, marked `noKpis: true`. For them: no KPI menu item or page (the workspace starts on Deals), no "My KPI" shortcut or card, and they stay out of the rings, Team performance and the Company target, which still use `representatives`. Deals they own still count for the Company ring, as before. Workspace opening (My home, teammate picker, deal and client links, the rep workspace's `reps`) uses `workspacePeople`; the KPI page's teammate lists leave out `noKpis` people. No rules change.

**Admin's claims and venues are automatic (Joel, 2026-10-17), with typed extras added on top:**
- **Claim submission** counts the HRDC claims (`money_in`, source hrdc) the person **recorded** (`createdById`), by submission date (`invoiceDate`). Client invoices don't count. Older claims without `createdById` aren't counted.
- **Venue database** counts the venues the person **added** (`venues_directory.createdBy`), by the Malaysian date of `createdAt`.
- Both have `plusTyped` in `KPI_TEMPLATES`: "Key in weekly numbers" still works for them, and typed numbers are **added** to the automatic count (the KPI page shows "N automatic + M typed"). Performance rating stays typed only.
- Counting is in `countAuto`/`monthKpi` (`lib/kpi.ts`, sources from `useKpiSources`), shared by the KPI page, Team performance and My home's "My KPI" card. `withoutAutoKpis` in `App.tsx` keeps typed numbers for `plusTyped` KPIs.


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
  - **Performance layout, again (Joel, 2026-10-17: keep the 2 rings, fix size and position):** the main rings (Company and/or Me, 148px) sit on the left, filling their block with the figures beside them. Each person gets medium rings (96px) on the right in a wrapping grid. It stacks on phones. Inside each ring the year % is big, with the month % small underneath. Empty (0%) arcs are no longer drawn as stray dots.
  - Joel asked: everyone has their own My home (yes). Content depends on role, and each person's Customise choice affects only their own page.
  - Admin work can be opened on a chosen tab (`initialView`) from the cards.
  - **Customisable shortcuts (Joel, 2026-10-17: "follow the limit of their portal capabilities only"):** in **Customise**, each person adds, removes (×) and reorders (arrows) the shortcut buttons at the top, saved in `user_prefs/{id}.homeShortcuts`. The library is `SHORTCUTS` in `MyHome.tsx`, each with a `need`:
    - `workspace`: My workspace, My KPI, My deals, Quotations, Course outlines, Clients, Trainers, Venues, To-do. Their own workspace only; anyone with a workspace (reps, admins, Management with a KPI set).
    - `staff`: Admin work, Work queue, Money, Programmes, Checklist tasks, Backup.
    - `management`: Team performance, Project P&L, Team, Data tools.
    - **Duplicates removed (Joel, 2026-10-17):** the "Management" shortcut (the top bar has a Management tab) and "Full calendar" (the calendar card has "Add event / full calendar"). Saved ones are no longer shown.
    - Saved shortcuts the person's role no longer allows are never shown, and `goShortcut` checks again. The screens keep their own role checks (`openAdminWork`/`openManagement` in `App.tsx` refuse the wrong role). Defaults are My workspace and Admin work (as allowed). "Reset cards and shortcuts" restores them. `openManagement(view)` and `openAdminWork('backup')` open a chosen tab.
    - Management with a KPI set can also add the "My KPI this month" and "My won deals" cards.
  - **Company sales target and period (Joel, 2026-10-17):** Management → Dashboard → **Company sales target** (`CompanyTarget` in `ManagementDashboard.tsx`; logic `src/lib/salesTarget.ts`, live via `useSalesTarget`). Management types the **total for the period**, a **monthly target** (both typed, they needn't match) and the **first and last month** (e.g. Jul 2026 to Jun 2027). Saved in `config/sales_target`; the rule is Management only. **Rules need publishing.**
    - Company ring: the outer ring is sales won from the period's start to today against the total; the inner ring is this month against the monthly target. **Each person's ring follows the same period** (their monthly Closing RM target × the months in it). The tiles on Team performance say "<period> so far".
    - Not set = the old rule: January to December, and the company target is the sum of each person's targets.
  - **Tracing the figures (Joel couldn't trace RM 4,500):** "See the deals" under the Company and Me rings, and a click on any person's small ring, lists the won deals behind it (won date, client, programme, owner, value, "this month", total). Deals owned by someone with no sales target (e.g. Management without KPIs) count for the Company but show "no sales target, so not in anyone's ring". Team performance now shows the real owner name for those (`people` prop) instead of "Former team member".
  - **Drag-and-drop cards (Joel, 2026-10-17):** the My cards area uses **react-grid-layout 1.5.4** (pinned; 1.5.0–1.5.3 shipped stray files), with a 12-column grid and 40px rows. **Customise** turns on dragging (by the card's title bar, `.card-drag`) and resizing (right edge, bottom edge, corner), with × to remove, "Add a card" chips and "Reset layout". Outside Customise nothing moves.
    - Each person's layout is saved with their cards in `user_prefs/{id}.homeLayout` (`[{i,x,y,w,h}]`); `homeCards` is kept in top-to-bottom order for phones. New cards go underneath, two per row (`layoutFor`).
    - Under 1024px wide the cards just stack. Cards fill their cell and scroll inside. Handle and drop-shadow styles are in `src/index.css` (`.home-grid`).
    - Tested with a temporary local page: dragging, resizing, reflow and phone stacking work.
  - **Rules:** `user_prefs` was added to `firestore.rules`. Published by Joel on 2026-10-17.
- **Workspace and KPI page redesign (2026-10-16, Joel: "the UI is bad")**:
  - **Workspace header bar removed (Joel, 2026-10-18: "useless").** When viewing someone else's workspace, the left menu shows "<name>'s workspace" at the top (`ownerLabel` in `WorkspaceMenu.tsx`); your own shows nothing extra. Before that, the header was name + role + page; the **Co-Pilot (AI chat) was removed everywhere** (header button, floating bubble, Management button). Its leftover state, handler and `/api/copilot` server route were deleted on 2026-10-17, along with the `@google/genai` package and the Gemini key in `.env.example`.
  - Left menu is `src/components/WorkspaceMenu.tsx`: calm style, Lucide icons, red dots for alerts, **collapsible** to an icon strip ("Hide menu", remembered in localStorage `next_menu_collapsed`), and a sideways-scrolling row on phones. **"Arrange menu"** (Joel, 2026-10-17) gives each item up/down arrows and "Reset order". The order is saved per viewer in `user_prefs/{viewerId}.menuOrder` (a manager opening someone's workspace sees their own order) and is used on phones too. Only the order changes; which items appear still follows the role. The **Appointments** item was removed (a duplicate of the deal's "Appointment held" stage); saved 'appointments' tabs redirect to Deals. `AppointmentManager.tsx` is no longer used.
  - KPI page is `src/components/KpiPage.tsx` (replaced about 750 lines in `RepDetailDashboard.tsx`). It has three parts: **This month** (score bar and one progress bar per KPI), **By week** (plain W1-W5 table; "Key in weekly numbers" appears only for typed KPIs, with Save/Cancel), and **Weekly check-in** (week tabs; what I got done, where I need help, target date, accountability partner, ask teammates; Edit/Save per week). It uses the same `month_kpis` fields as before, so old entries still show.
  - Removed: "Edit Table Cells", "Save KPI Roster", the hint text, the three weekly "flow" cards, ALL-CAPS headings.
  - Teammate requests ("Teammates asking for your help") show on the KPI page with **Done**. Done is saved in the helper's own month doc as `helpDoneList` entries `"<askerId>:<weekIndex>"`, because people can only write their own KPI records (the old design wrote to the asker's doc, which the rules block for reps). The asker sees "(done)". Old `completedTagsList`/`completedAccountabilityList` marks still count. The workspace's old "System Collaboration & Alert Hub" box was **removed** (Joel, 2026-10-17): it repeated the red dots on the workspace menu, in the old style.

- **Management dashboard rebuilt as "Team performance" (Joel, 2026-10-17: tidy up):** `src/components/ManagementDashboard.tsx`, in Management → Dashboard.
  - **Why:** the old page added hand-typed weekly numbers on top of deal counts (so it could double count and disagree with the KPI page), used hardcoded targets (RM 30,000, 10 proposals per rep), and had Targets and Quick log tabs that duplicated Team and the KPI page. Its Pipelines tab used old Pending/Won/Lost, it had a hardcoded Jun–Dec 2026 month list, and it used the dark ALL-CAPS style.
  - **Now:** a month picker (`monthChoices`: the last 12 months to 3 ahead, also used by the KPI page), then tiles for the month and the year so far: sales won vs the team target (the sum of sellers' Closing RM targets), deals won, appointments held, proposals sent. All are counted from deals.
    - The team table shows each person's KPI score and each KPI as actual / target, typed KPIs included, sorted by score, with Open workspace. It uses `monthKpi` in `lib/kpi.ts`, which the KPI page now uses too, so the numbers always match.
    - The pipeline snapshot shows open deals and RM per stage plus Need attention (`dealNeedsAttention`), won this month, and lost this month with reasons. **Clicking a deal in the Won or Lost list, or in the Follow-up alerts card, opens that deal's panel** in its owner's workspace (`homeNav.openDeal`; Joel, 2026-10-20).
  - **Removed:** Targets and Quick log tabs (KPI sets and targets live in Team; typed KPIs are keyed in on the KPI page), the old Pipelines tab, the KPI date range, and the old **Google Sheets backup** button (an Apps Script). Replaced by the new **Data backup** (see below).
  - Tested with a temporary local page with sample data: the numbers are correct and there is no sideways scroll on phones.


- **Weekly presentation (Joel, 2026-10-21):** "everyone gets a weekly presentation tab in KPI".
  - **Where:** the KPI page has two tabs, **Numbers and check-in** and **Present** (`KpiPage.tsx`). Management without KPIs (Joel) gets a **Present** item on his workspace menu (`presentOnMenu` in `RepDetailDashboard.tsx`, menu key `present`). Management with KPIs (Ying) switches **My week / Company** on her Present tab. Management opening someone else's KPI page can present that person; slide changes there aren't saved (the person keeps their own choice).
  - **Files:** `src/lib/present.ts` (periods, slide lists, all counting), `src/components/PresentSlides.tsx` (the slides), `src/components/PresentCharts.tsx` (number cards with up/down, score ring, funnel, bars, donut, day heatmap, people × weeks heatmap), `src/components/PresentPage.tsx` (picker, slideshow, action points, Save as PDF). Charts use **Recharts 2.15.4** (axes must be direct children of the chart, not inside a fragment, or they don't draw).
  - **Periods:** Last 7 days, This month (to date), Year to date, Last 12 months, All time; each compared with the period before ("2 in the 7 days before"). The KPI scorecard and team KPI scores use the KPI month chosen on the KPI page.
  - **Person slides:** KPI scorecard, My numbers, Weekly check-in (the latest week filled in up to this week), Deals won, My pipeline (funnel), Coming up (next 7 days; trainings next 14), Client touch points (touch points plus deal follow-up notes), Activity heatmap (last 12 weeks), Deals lost, Operations (Admin and Management only: HRDC claims recorded, venues added, trainings delivered and coming up), My action points. Defaults: sales `scorecard, numbers, checkin, won, pipeline, next, actions`; Admin `scorecard, checkin, admin, heatmap, next, actions`.
  - **Company slides (Management only):** Headline numbers, Sales and cash trend, Team leaderboard, Pipeline funnel (conversion of deals started in the period, and open pipeline), Best clients and industries, Funding mix, Top programmes, Money not collected (by age 0–30 / 31–60 / 61–90 / 90+ days, clients vs HRDC, after HRDC's %), Profit (Project P&L `projectRows`, by training date), Client contact heatmap (people × last 8 weeks, plus clients not contacted in 60 days), Why we lost deals, Trainings, Open action points.
  - **Present now** opens a full-screen slideshow (arrows / Page Up / Page Down / Space, Esc closes, full-screen button). **Run team meeting** plays the company slides, then each person with KPIs in turn (a cover slide with their name, then their own chosen slides and period). **Save as PDF** prints every slide on its own landscape page.
  - **Action points:** "+ Action point" on any slide: what, **responsible person** and **deadline** (both required). Saved as a To-do (`tasks`, `source: 'meeting'`, `meetingDate`, `meetingSlide`), so it shows on that person's To-do list with an "Action point" label, and on the action point slides until done. No new rule: the existing tasks rule already lets anyone create a task they assign.
  - **Saved choices:** `present_prefs/{memberId}` (`slides`, `period`, `companySlides`, `companyPeriod`). New rule: the team reads, only the person writes their own. **Publish `firestore.rules`**; until then choices aren't saved and the meeting uses everyone's defaults.
  - Tested with a temporary local page and pretend data: every slide draws at each period, the slideshow keys and the action point form's checks work, and the slideshow fits a phone.

- **Team meeting set-up, look and notes (Joel, 2026-10-21):** "Management + Admin to edit first few pages; CI given, can change for all users; page 1 title Weekly review with the date, page 2 question for the week, page 3 Management, page 4 onwards reps; Admin can add notes and action points."
  - **Set-up** (`present_settings/main`, `src/lib/presentTheme.ts`): title (default "Weekly review"), question for the week, main colour, text colour, background and font. Defaults are the company identity Joel gave: #5BC09F, #58585A, #FFFFFF, Archivo (bold for headings). Edited by Management and Admin on Present → Company → **Team meeting set-up** (form draft kept in the browser); the same for everyone. The look applies to every slideshow and PDF (the CRM's colour tokens are redefined inside them; charts get the colours through `ChartPalette` in `PresentCharts.tsx`), not to the rest of the CRM. Fonts load from Google Fonts when chosen.
  - **Meeting order:** title slide (main colour with the arrow design, the day's date filled in), question for the week (skipped when empty), company slides, each manager with KPIs, then everyone else.
  - **Admin runs the meeting too:** Admin gets the My week / Company switch; Admin's company slides leave out Profit.
  - **Notes:** Management and Admin click **Notes** in the slideshow and type a note per slide; it saves itself (`useAutoSave`) to `meeting_notes/{date}` (`notes.{person}__{slide}`). Notes show under **Meeting notes** on the Present page (last 8 meetings) and under their slide in the PDF. Action points work as before for everyone.
  - **Rules:** `present_settings` and `meeting_notes`: the team reads, Management and Admin write. **Publish `firestore.rules`.** Checked: build, and the title slide drawn in Archivo on a temporary page.

## Traffic-light KPI colours, sales projection (2026-10-21)

- **Traffic light everywhere:** every KPI bar and ring is red from 0 to 35%, amber from 36 to 75%, green from 76% (`kpiLight` / `kpiBarClass` / `kpiHex` in `lib/kpi.ts`): My home rings (year and month each by their own %) and My KPI card, the KPI page, Team performance, Present scorecard ring, bars and leaderboard badge. Trainer profile completeness (Trainers → Overview) is not a KPI and keeps its own colours.
- **Sales projection** (`lib/forecast.ts`, `components/SalesProjection.tsx`): 1 to 6 months ahead (choice remembered per browser). Each month = won (in the month won, as Closing RM) + open deals expected that month x their chance (Hot / Warm / Cold, see `deals.md`). No expected month → the training date's month; a month gone → this month, marked overdue. Unrated deals and deals with no month are listed as "Not counted". Bars show won and projected with the monthly target as a dashed line (a person's Closing RM target; team = company monthly target, or the sum).
  - **Where:** My home card **Sales projection** (rep, Admin: own deals; Management: Whole team or one person; default card for reps and Management), Management → Team performance section, and the Present slide **Sales projection** (person: own; Company: whole team; a choice like the other slides).
  - **Chances:** default Hot 75%, Warm 50%, Cold 20%; Management changes them with **Change the chances** (`config/forecast_settings`, Management only: **publish `firestore.rules`**).
  - Checked: build, and 8 logic checks (window, overdue roll-in, training-date fallback, unrated, per person, colour bands).

## Login log (2026-10-22)

- **What:** Management → Team → **Login log**: for each active person, the minutes spent in the CRM on each of the last 5 working days (today shown separately, not judged yet), last seen, and a green / amber / red light. Click a person for 8 weeks of history (each past week's light, minutes per day, week total; point at a day for first and last time used and how many times the CRM was opened).
- **How time is counted** (`lib/loginActivity.ts`, `useActivityTracker` in `App.tsx`): one minute is added each minute the CRM is open and on screen, with a click, typing or scrolling in the last 5 minutes (`idleMinutes` in Rules; was 10 with any mouse movement until the change below). Several tabs open count once. Days use the person's computer date. Stored in `login_days/<memberId>_<YYYY-MM-DD>` (`minutes`, `logins`, `firstAt`, `lastAt`). The rules let each person add only their own minute (one at a time, at most every 50 seconds) and only Management reads them.
- **Light rules** (Joel, 2026-10-22; `config/login_rules`, Management only, **Rules** button): working days Mon–Fri; green = all 5 working days with 1 hour or more each; amber = 3 working days with 30 minutes or more each; red = less. The light on the main table is for the last 5 working days before today; weekly history judges each Monday–Sunday week.
- Checked: build, and logic checks (working-day window skipping weekends, green / amber / red edges).
- **History, heatmap, graph (2026-10-22, later):** History picks the last 4, 8, 12 or 26 weeks. Views: **Table** (as above), **Heatmap** (`LoginCharts.tsx`: people by working day for 4 weeks, by week for longer; a day is coloured by its minutes, a week by its light; dashed = still in progress) and **Graph** (hours per working day, or average hours per working day each week; whole team averaged per person or one person; green and amber lines; per day only up to 12 weeks). The choices are remembered per browser.
- **Present slide "Login log"** (Company, Management only like Profit, not on by default): each person's light and average for the last working days, plus the 4-week heatmap. Nothing new to publish.
- **Work done and where the time goes (Joel, 2026-10-22, against "CRM open but no work"):**
  - **Actions:** each day counts the work saved (`actions`): any save to the database (deals, appointments, follow-ups, quotations, checklist ticks, payments, settings…). Every `firebase/firestore` import in `src/` goes through `lib/firestoreTracked.ts` (pointed there by the `count-crm-saves` plugin in `vite.config.ts`), which reports each successful add / set / update / delete / batch / transaction; saves to `login_days` don't count. A save counts only within 60 seconds of a click or key (not the CRM's background saves), and the same record saved again within 5 minutes counts once (autosave). Sent every 15 seconds, at most 20 at a time.
  - **Online, no work:** a day with 2 hours or more but fewer than 3 actions is flagged red ("No work") in the table and history, and counts as no time for the green / amber / red light (table, weekly history, Present slide). Days from before actions were counted are never flagged.
  - **Stricter clock:** time stops after 5 minutes (was 10) with no click, typing or scrolling; plain mouse movement no longer counts ("mouse jigglers").
  - All three numbers are in **Rules** (`idleMinutes`, `noWorkMinutes`, `noWorkActions` in `config/login_rules`).
  - **Where the time goes:** each active minute also adds 1 to the screen on show (`places.<screen>`, `place` = last screen). Screens report themselves with `usePlace` (App's area = depth 1: My home, Management tab, Admin work, Workspace; the tab inside = depth 2: Admin work tabs in `WorkQueue.tsx`, workspace tabs in `RepDetailDashboard.tsx`); names in `PLACE_LABELS`. The table shows **Most time on** (last working days and today); a person's history opens with **Where the time went** (bars over the weeks shown).
  - Rules: each person adds only their own; a minute adds 1 to exactly one screen; actions go up by 1 to 20, at most every 10 seconds; older CRM versions still save. Checked in Google's emulator (26 rule checks) and the save counter against the emulator. Publish `firestore.rules`.
- **Logins, places, devices and sensitive actions (Joel, 2026-10-24; never mentioned to staff, Joel's choice):**
  - **Logins** view (Login log tab): each password login, each time the CRM is opened with a saved login, and each wrong password, with the IP address, the place from it (town and internet provider via ipinfo.io, cached a week per address; optional `IPINFO_TOKEN` server setting), device, system and browser, active minutes and first / last time. Filters: person, kind, warnings.
  - **Warnings:** New device (a device id this person hasn't used before; their first ever isn't flagged), New place (a town not seen before), After hours (outside working hours or on a day off, Malaysia time; **Working hours** in Rules, default 7:00 am to 10:00 pm, `workStart` / `workEnd` in `config/login_rules`), Two places at once (active in the last 3 minutes on another device from another internet address; may be their own phone on data), Many wrong passwords (3+ in 10 minutes). The Table view shows each person's warnings from the last 7 days under their name, and **Online now** in Last seen.
  - **Actions** view: downloads (Excel backup, files ZIP, Back up now, client links CSV, trainer biodata PDF), deletes (forever, or marked `deleted: true`; reported by `lib/firestoreTracked.ts`), own password changes, passwords set by Management, people added, removed, given access again or given a new role. Each with IP and town. The browser can report only downloads and deletes (at most 60 a minute); password and team entries come only from the server's own routes.
  - **Code:** `serverActivity.ts` (routes `/api/activity/open`, `/beat`, `/action`; `recordLogin`, `recordFailedLogin`, `logActivity` called from `serverAuth.ts` and `serverBackup.ts`), `lib/loginSessions.ts` (shared labels and checks), `LoginSessions.tsx` (the two views). Collections, written only by the server: `login_sessions`, `activity_log`, `login_live` (Management reads), `login_devices` (server only). Each tab of the CRM is one session; the login screen passes its session id on (`sessionStorage`) so a login and the CRM opening are one record. The device id is the same browser id client links use (`next_dev`).
  - Checked: build, and 24 checks of the server logic on a pretend database (login and open as one record, minutes once per 50 s and only your own, new device / place, two places at once but not two tabs, wrong passwords and the 3rd flagged, failed logins don't teach a new device, the browser can't fake password or team entries, 60 a minute limit, after-hours edges). Publish `firestore.rules`.

## Sales contributor ring (2026-10-24)

- **Why (Joel):** some Admin and Management people sell but need no sales KPI; they still need a ring showing their contribution, and it ties into the company sales number.
- **Where:** Management → Team → KPIs for the person: tick **Sales contributor** and type a **monthly sales target RM** (required when ticked). Works with "No KPIs" too. Not offered when their set already has Closing RM (that ring comes from Closing RM). Saved as `reps/{id}.salesRing = { monthly }` (null when off).
- **What it does:** the same inner (this month) and outer (target period) ring as reps, on their My home ("Me") and on Management's per-person rings; "See the deals" lists their won deals. Their target adds to the company target when no company target is typed in (Team performance, sales projection, My home, Present). Their KPI score never changes.
- **Code:** `ringTarget` in `lib/kpi.ts` (Closing RM target, else the contributor target; Management without KPIs never falls back to the default set), used by `MyHome.tsx`, `ManagementDashboard.tsx` (`ringPeople`) and `PresentSlides.tsx`. No rules change (Management already writes `reps`).
- Checked: build, and the target rule for rep, Admin, Management without KPIs, with and without the tick.

## Appraisal: KPI, attitude and reliability as three parts (2026-10-22)

- **Why:** KPIs are results only. Attitude (360) and reliability sit beside them and are never blended into the KPI score; there is no combined grand total.
- **Part A, KPI:** the 360 rating KPI is hidden in the library (not offered for new sets) and left out of a saved set on the appraisal (`appraisalSetItems` in `lib/kpiLibrary.ts`); the other KPIs' weights count for more, as with any KPI with nothing to count. Its library entry stays so old months still show it.
- **Part B, Attitude (360):** Management keeps the items in 360 rating → Rounds → **Items to rate** (`config/rating_items`; add, rename, turn off, reorder; never deleted). Starts with Teamwork, Leadership, Communication. Each rater scores every item that is on, 1-5; a reason (20+ characters) only for a 1 or 2; an optional general comment. Saved as `items: {itemId: stars}` and `comments` in `ratings_360`. Older single-star ratings stay readable and count in the overall. Result: average per item, and overall = the average of each rating's own average (`summarise` in `lib/rating360.ts`). Privacy unchanged: people see theirs only after the round closes; Management always sees who rated whom.
- **Part C, Reliability** (`lib/reliability.ts`): from the Login log, no new tracking. Flexi time, so start time is never scored; each past working day takes the Login log day light (green / amber / red; no time = red). **Days out of office** (Client visit, Training / event, Leave, MC, Public holiday, Other with a note) are left out: Admin work → **Days out** and the appraisal (`reliability_excused`, Admin and Management). **Incidents** (Late for a fixed commitment, Unreachable without notice, Missed deadline; date and note) are Management only (`reliability_incidents`). Score 1-5: % of counted days green or amber → 5 at 95%+, 4 at 85%+, 3 at 70%+, 2 at 50%+, else 1; minus 0.5 per incident, never below 1. All in **Score settings** (`config/reliability`). Staff screens say only "days out of office".
- **Appraisal page:** Management → **Appraisal** (`components/Appraisal.tsx`): a person and a month or range (up to 12 months); three separate cards; a range shows each month's KPI score and their average. **Management notes** save themselves per person per period (`appraisal_notes/{memberId}_{from}_{to}`).
- Checked: build, and logic checks (working days, excused days, incidents, item averages with old ratings, comment rule, 360 KPI left out).

## Performance scorecard: one overall score (Joel, 2026-10-25)

- **Decision:** Joel replaced the 2026-10-22 "no combined total". The appraisal is now three categories, **Performance**, **Competency** and **Behavioural**, each with sub-categories, adding up to one overall score weighted by the person's level. Behavioural uses NEXT Academy's core values, **HEART**: Humility, Expertise, Accountability, Remarkable, Trustworthiness.
- **Logic:** `lib/scorecard.ts`. Screens: `components/Appraisal.tsx` (the scorecard), `components/Scorecard.tsx` (settings panel and quarterly review panel).
- **Performance** (what did you achieve, and how?): the KPI score (results) mixed with reliability (process; 1-5 becomes %). Reliability is 10% of Performance by default. A range averages only the months that have started.
- **Competency** (can you do the job well?): skills scored 1-5 by a manager in the **quarterly review**. Groups: Role skills, Growth, and Leadership (Manager and Senior management only). A skill can be ticked "Not applicable" for a person; the next quarter starts with the same ticks. Starting skills: Selling and negotiation, Presentation and communication, Programme and product knowledge, HRDC portal and claims, Excel and reporting, Facilitation and training delivery, Event and project coordination; Courses and certifications, Ideas and improvements; Coaching and developing people, Team engagement and retention, Planning and decisions. Each has a "1 star" and "5 stars" description.
- **Behavioural** (how do you show up?): the HEART values. Teammates' 360 ratings in closed rounds count 50% and the manager's rating in the quarterly review counts 50% (a setting). If one side is missing, the other counts in full. The HEART values are the 360 items (`config/rating_items`); 360 rating → Rounds → Items to rate has **Use HEART values** (other items are turned off, never deleted) and a 1 star / 5 stars description per item, shown to raters.
- **Stars to %:** stars ÷ 5 (3 = 60%, 4 = 80%, 5 = 100%), so every part uses the usual traffic light.
- **Levels and weights:** Executive 60 / 20 / 20, Manager 50 / 30 / 20, Senior management 50 / 25 / 25 (Performance / Competency / Behavioural). Management edits them in Appraisal → **Scorecard settings**, along with each person's level (default: Management = Manager, everyone else = Executive), the teammates' share, the reliability share and the skills. Stored in `config/scorecard`, Management only.
- **Missing parts:** a part with nothing to score in the period is left out, and the others' weights count for more; the page says so.
- **Quarterly reviews:** `scorecard_reviews/{memberId}_{YYYY-Qn}`: skills, not-applicable list, HEART values, reasons (20+ characters, needed for a 1 or 2), comment, who and when. Management only, **never your own** (the rules check it); the Review button doesn't show on your own appraisal. The period picker has Quarter and Half year quick picks; a period averages the reviews of the quarters it touches.
- **Not built (later, if wanted):** self-rating before the manager's review; staff seeing their own scorecard.
- Checked: build; 53 logic checks (defaults, weights must total 100, levels, quarters, review rules, N/A and leadership skipped for Executives, each part's maths, overall with missing parts, HEART switch keeps old items, old ratings still count); a temporary local page on a pretend database (overall score worked out by hand for Executive and Manager, review save and low-score reason, own review blocked, settings save and the weights check, HEART switch, phone width).
