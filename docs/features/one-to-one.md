# 1-to-1 sessions (2026-10-25)

Joel: everyone has a 90-minute 1-to-1 with the person who runs them, about work or personal life, from once a week to once a month. A tab on everyone's menu (own workspace only), and a KPI.

## Agreed with Joel

- **One person runs them** (Joel). Picked in 1-to-1 → Settings → "Who runs the 1-to-1s", which only the owner override login sees; no names in code. That person sees everyone's sessions with an overview. **Nobody else, the other manager included, sees any session.**
- **Who types what:** Before the meeting (staff, about 10 minutes): mood, focus item, what they won, learned, blockers, help needed, 1-year and 5-year goals (goals copy forward from last time). During (the coach): last session's actions (Done / In progress / Dropped), next steps as an action list, what we talked about; the coach can also edit the staff member's answers. After (staff): feedback for the coach or company, rating, "I agree this is a fair record" (with an optional comment).
- **Questions are editable:** Settings has Before / During / After lists. Add, edit, reorder, remove; answer types: short, long, rating 1 to 5, yes/no, action list (During only); "copy the last answer into the next session". Changes save themselves. A session keeps the questions it was asked with once it is marked held; answers to removed questions are never lost.
- **Session rating by both:** the staff member rates (1 to 5 + comment) after the meeting; the coach rates too. The staff member sees the coach's rating only after giving their own (enforced in the database).
- **Private notes:** the coach's notes on a session, in their own collection; only the coach can ever read them.
- **Actions to To-do:** each action has an owner (staff member or coach) and a due date; "→ To-do" makes a To-do task (`source: '121'`, `oneToOneId`, shown "From 1-to-1"). In To-do, 1-to-1 tasks are hidden from Management's "Everyone's" view unless you are one of the two people. (The database still lets members read tasks, as for every task; only the action's text is in it.)
- **Booking:** either side picks date, time (90 minutes) and place → "Waiting to accept". The other presses **Accept**, **Suggest another time** (goes back to the first person) or **Decline**. A new time on a booked session asks again. Either can cancel. Nobody accepts their own request (database rule).
- **Calendar:** booked and held sessions show on both people's CRM calendar ("1-to-1: <name>", waiting ones marked) and on the shared Google calendar as "1-to-1: <staff name>" only (the team sees that calendar), 90 minutes, synced within 5 minutes.
- **Session number** rolls per person: booked, held and waiting sessions in date order; declined and cancelled don't count.
- **KPI:** "1-to-1 sessions held" in the KPI library (Other group, default target 1 a month): sessions marked **Meeting done** that month, for the staff member and the coach. Dates come from the server (`/api/one-to-one/held`), never the content; Management gets everyone's count, others only their own.
- **KPIs this month** show on the session (counted, never typed). Red count on the menu = sessions waiting for you (accept, before-meeting questions, rate, "I agree").

## Where things live

- `src/lib/oneToOne.ts` (types, default questions, session numbers, waiting-on, calendar events, KPI dates), `src/lib/useOneToOnes.ts`, `src/components/OneToOnePage.tsx` (overview, list, booking, session, ratings, settings).
- Collections: `config/one_to_one` (`coachId`, `questions`), `one_to_ones/{id}`, `one_to_one_private/{id}` (coach notes), `one_to_one_ratings/{id}` (coach's rating).
- Menu: `one_to_one` in `WorkspaceMenu.tsx`, shown in `RepDetailDashboard.tsx` for your own workspace only. CRM calendar: `App.tsx`. Google: `calendarSync.ts` (`oto:<id>`), `serverCalendar.ts`. KPI: `kpiLibrary.ts`, `kpi.ts` (`one_to_ones`), `useKpiSources.ts`, `serverKpi.ts`. To-do: `tasks.ts`, `TasksPage.tsx`.
- Rules (`firestore.rules`): sessions read only by the two people; staff change only the booking, Before / After answers, their rating and "I agree" (rating and agree only once held); only the coach marks held; date, time or place changes always go back to "Waiting to accept"; no deletes. 49 rule tests passed on the Firestore emulator (2026-10-25).

## Changes the same day (Joel, 2026-10-25, second round)

- **No setup:** when nobody is picked yet, the owner override login becomes the person running 1-to-1s automatically on their next load (`App.tsx`); still changeable in Settings. The tab is always on everyone's menu; staff see only their own sessions and their past list (to reread notes); the coach sees everyone's.
- **Simple booking:** Book 1-to-1 (staff, and the coach with a person picker) → date and time → **calendar check** of both people (other 1-to-1s, deal appointments they own, CRM events they're tagged in; server `/api/one-to-one/availability`, plain labels only: "Busy: Client appointment, 11:00 AM–12:00 PM", or "Free on both calendars"; booking anyway asks first) → place → the Before questions in the same form → Send. The other person still **accepts** (kept on purpose).
- **Session details:** date, day, time, session #, place and **asked for by** (`initiatedById`, set when booked, never changes; database rule).
- **Both fill in everything:** Before, During (including actions and → To-do) and After are open to both; only the coach has private notes and marks Meeting done; ratings stay one each.
- **My view / Staff view** switch on each session for the coach: Staff view shows exactly the staff member's screen, read only (no private notes, coach's rating hidden until they rated).
- **KPI "1-to-1s asked for":** held sessions the staff member booked themselves (older sessions: whoever asked for the time). Overview shows "Held · asked for".
- **Profile** (`staff_profiles/{memberId}`; staff "My profile", coach "<name>'s profile" on the person page): joined (time with the company counted), birthday (age counted), hometown, family, religion and holidays, food, personal goals, career dream, motivation, strengths, stress signs, how they like to be rewarded / recognised / given feedback, hobbies, books they like, books encouraged, important dates. Both fill it in; the coach's own notes about them (`staff_profile_notes`) are coach only. Reminders: birthdays, work anniversaries and important dates in the next 7 days on the coach's overview ("Coming up this week"); the profile shows 30 days ahead. Nobody else, Management included, can read profiles (rule).
- Rule tests: 62 passed on the Firestore emulator.
