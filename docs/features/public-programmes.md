# Public programmes

Read only when working on this area.

## What Joel asked (2026-10-28)

"We also will be hosting public programs: HRDC claimable, pay directly, mix payment. 1 public program is attended by multiple different companies." Decisions:

- One **Public programme** record per run, plus one **normal deal per company** that joins, owned by the rep who sold it. Each rep keeps their own Closing RM, KPIs and commission.
- Each company sends its own number of people, and has its own funding type (HRDC claimable, Direct pay, HRDC + top-up).
- Runs are on **fixed dates announced in advance**.
- Same list price per pax for everyone, but sometimes a bulk or special price: that is a discount a manager approves (the existing **Request discount** on the quotation).
- Trainer profile, course outline and venue are the same records as for in-house trainings (picked from Trainers, By title, Venues). Nothing new is typed.
- Built in two batches. **Batch 1 (sales, done 2026-10-28):** the run, the list, joining, seats, price check, date change, cancel and move. **Batch 2 (operations and money, not built):** logistics, costs, trainer PO, photos and one attendance list once on the run; each company's own grant, invoice, HRDC claim and top-up on its deal; one P&L per run; HR copies of the report with only their own staff.

## Batch 1: how it works

- **Where:** Deals → **Public programmes** (button next to Costing estimator). Everyone sees the runs; Admin and Management set them up (**New public programme**), **Change** them, and **Cancel or move companies**. Tabs: Upcoming (soonest first), Past, Cancelled; search by title, venue or trainer; pages.
- **A run:** title (from By title; it sets Classroom training or Team building), optional course outline of that title, training date and length, venue, trainer, list price per pax, seat limit (blank = none), minimum pax to run (blank = none), notes, History (add-only).
- **Seats line:** confirmed (won) pax in dark, sold so far (every company not lost or deleted) in light, a mark at the minimum. States: Taking sign-ups, Confirmed to run (won pax reach the minimum), Below minimum (training within 14 days and not enough won pax), Training on now, Training done, Cancelled.
- **Joining:** on a run, **Add a company** opens New deal with the run picked; or New deal → **Kind of training: Public programme** → pick the run (date · title · price · seats left). The run fills in the title, type and dates (locked on the deal). The deal value follows list price × pax while it still equals that (or is blank). Saving refuses: no pax, more pax than seats left ("Ask Admin or Management to raise the seat limit"), or a value below list price × pax without an approved discount ("create the quotation at that price and click Request discount"); Management may set any price. The rest of the deal journey is unchanged (proposal, quotation, Won).
- **On the deal:** a "Public programme" chip on the Deals row; Details shows the run's dates, companies and pax. A won deal can't change run in Edit (locked with the value).
- **Changing a run's date:** a short "why" is needed when companies have joined. Open deals move to the new date at once (History line); won deals get a **Change date** request in the person's name, approved by a manager as usual (never their own). Refused while any won company already has a change waiting ("Approve or withdraw it on the deal first").
- **Cancel or move companies:** reason (Not enough participants, Trainer not available, Other, Venue not available) and a few words. **Move companies to another run** (same title listed first; warns for a different title; refuses if the seats there aren't enough): open deals move now; won deals get a Change date request carrying the new run (`trainingChange.newRunId`), and approving it moves the deal onto that run. **Cancel, no new date:** open deals become lost ("Training cancelled", the words as the note); won deals get a **Cancel the training** request a manager approves. The run is marked Cancelled (with where its companies went).
- **Not changed by a run:** each company's funding type, value, pax and owner. Changing the list price later doesn't change companies already in.

## Files and data

- `src/lib/publicProgrammes.ts` (pure: seats, state, joinable runs, list value, join / run / cancel checks, how each deal follows a move), `src/components/PublicProgrammes.tsx` (list, run panel, editor, cancel / move box), `DealsBoard.tsx` (button, form choice, row chip, Details line), `TrainingChange.tsx` (approving a date change with `newRunId` sets `publicProgrammeId`).
- Collection `public_programmes/{id}`: programmeId, title, type, trainingDate, trainingDays, venueId / venueName, trainerId / trainerName, outlineId, pricePerPax, seatLimit, minPax, notes, status (`open` / `cancelled`), cancelReason, cancelNote, movedToId, createdAt / ById / ByName, history. Deals gain `publicProgrammeId`.
- **Rules:** `public_programmes` read by members; created (in your own name) and changed by Admin and Management, History only grows; erased by Management only. Deals: no rule change (Admin and Management already write any deal; won deals still need the approved requests).
- In the backup as "Public programmes"; deletes named "Public programme" in the Login log.

## Tested (2026-10-28)

- 22 rule checks in the Firebase emulator (reading, setting up, changing, history, deleting a run; a rep joining in their own name only; Admin moving or losing open deals; won deals refused without an approved request; the approval moving date and run together; never your own).
- Test CRM: Admin set up a 2-day run (RM 1,500/pax, 10 seats, minimum 6); Rep Raju joined Valmont (4 pax, value filled to RM 6,000; RM 5,000 refused; 11 pax refused); the run's date change moved Siti's open deal and sent Valmont (won) for approval; moving with a request waiting was refused; after approval, Move to the January run moved Padini now and Valmont once Manager Ben approved (deal on the new run, new date); Cancel, no new date lost Padini and sent Valmont's cancellation for approval.
- **Found on the way and fixed (Joel: "fix it first", 2026-10-28):** a manager's approval of **Change date** or **Change value / pax** on a won deal went over Firestore's 1,000-step limit per save and was refused (cancellations passed). `firestore.rules` now checks that one save with a short rule first (`approvalOk` on `pipelines`): the waiting request unchanged except its decision, signed by a manager who didn't ask, exactly the date (and run) or value and pax asked, only the fields the approval writes, History only grows. Everything else still goes through the full deal checks. A rep's normal win was itself right at the limit, so three checks in `integrityOk` / `wonDateOk` now test the cheap condition before "is a manager" (same meaning, fewer steps). Tested: all 8 rule test files, 312 checks, pass (the two owner-override checks brought up to date with `owner_access`); the three approvals pass, 12 misuse attempts are refused (other date, other run, other value, extra fields such as the owner, rewritten request, signed as someone else, wiped History, Admin, the rep, own request, already approved).
