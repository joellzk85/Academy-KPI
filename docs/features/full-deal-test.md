# Full deal test, 22 Oct 2026: findings

**How it was tested:** the real CRM screens and the real server, on a pretend database (nothing touched the live CRM). Five people, each in their own browser tab: Alif (rep), Aina (Admin), Joel (Management), Dr Lim (trainer, in the trainer portal), and the client / accounts opening links with no login.

**Route walked:** new client → training deal → course outline → client link opened → client approved → quotation → client link opened → Won → admin checklist → trainer invited to the portal → bank details and TIN → trainer fee raised → PO accepted in the portal → date change asked and approved → trainer wrote the report and asked for the fee → report checked → HRDC claim recorded → fee approved → payment summary → accounts link → "Payment made" → receipts → HRDC payment received → "Case closed". Then a second deal: teambuilding proposal → client link → client accepted a package → quotation.

**What worked well:** every link opened properly for the client and for accounts. The deal moved stage by itself on every send. Client link tracking showed up on Joel's My home. The date change gave a good to-do list, and the trainer got a new PO by itself. The trainer portal flow (invite, login, bank check, PO, report, fee request) hangs together. The fee checks tick themselves from what the trainer sent. The P&L on the deal added up (RM 18,000 − 4% HRDC − 3% commission − RM 4,000 trainer = RM 12,740).

---

## A. Roadblocks: people get stuck or click and nothing seems to happen

1. **The "missing details" box opens out of sight.** On a course outline (and a teambuilding proposal), clicking **Send proposal** with no deal value just greys the button. The box asking for the value opens at the very bottom of a long page. A rep will think the button is broken. *Fix: scroll to the box and highlight it, or show it as a pop-up.*
2. **The approval card leads to an empty list.** Joel clicks "Date change · Valmont" on My home and lands on Alif's Deals with **"No deals here yet"**. Won deals aren't in "Open deals", so he has to guess to click the "Won" tile, then the deal. *Fix: open the deal itself.*
3. **A teambuilding proposal can't be sent without a "programme".** It asks for a programme from the Programme list, which only holds training programmes. The rep has to invent one ("Team building day"), which then sits in Admin work → Programmes as "Not registered with HRDC". *Fix: don't ask for a programme on teambuilding deals, or have a "Teambuilding" category.*
4. **"Case closed" says the opposite of the rest of the screen.** After the HRDC payment came in, the deal said **"Case closed. Every step is done"**, while the same row said "5 of 12 done", "Training date has passed with 7 steps open before training", the 4 date-change to-dos were still open, and the **Case closed tile showed 0**. *Fix: decide what "closed" means, then make the tile, the row and the panel agree.*
5. **A trainer fee waits in Joel's "Waiting for my approval" for weeks.** Admin raises the fee when booking the trainer, but **Yes, approve** stays locked until the T3, photos and report are in (after training). It's correct, but it clutters Joel's list from booking day. Aina's My home also tells her to "check … then approve", though Admin can't approve. *Fix: show it to Management only once the checks are complete; reword Admin's line.*

## B. More than one source of truth: typed in one place, not carried to the next

6. **Participants (pax) are typed 4 times and never reach the deal.** "25 pax" typed on the quotation is not saved to the deal. So the won deal recorded **0 participants** (the Deal checks "original" value is 0). The trainer's report started blank ("Participants registered") and the trainer typed 25 again. The teambuilding proposal has its own "Group size", and the 30 pax the client accepted online is not carried over either. *Fix: one "Participants" field on the deal. The quotation, proposal and report read it, and the client's accepted number updates it.*
7. **The teambuilding package the client accepts doesn't change the deal value.** The client accepted "Leader", **RM 16,000**, online. The deal stayed at **RM 25,000**, and the quotation then drafted at RM 25,000. KPIs and the projection count RM 25,000. The deal panel just says "The client approved the proposal" without saying which package or price. *Fix: on acceptance, update the value (or ask the rep to confirm) and show the package on the deal.*
8. **Programme length is ignored.** The programme says 2 days, but a new deal defaults to "1 day". *Fix: take the days from the programme.*
9. **"Still to come in" means two different things.** On Joel's My home it shows RM 0 (only invoices recorded so far). On the deal it shows RM 17,280 (an estimate). Same words, different numbers. *Fix: rename one (e.g. "Invoiced, not paid yet" vs "Expected").*
10. **Venue typed on the quotation is free text.** It shows on the checklist as "Hotel Armada (from quotation)", not linked to the Venues list, so it can't link to a venue vendor or its costs without re-picking. *Fix: pick from the venue list on the quotation, as on the checklist.*

## C. Duplicates and redundant steps

11. **The trainer uploads training photos twice:** once in the training report, again in the fee request.
12. **Trainer portal:** "Fee claims" only shows status and says "To request a fee, open My trainings". One training card has **two identical "Change what I sent" buttons** (fee and report); I clicked the wrong one.
13. **Trainers page has three add buttons:** "Invite a new trainer", "Invite to trainer portal", "Add trainer". A newcomer won't know which to use.
14. **A teambuilding deal still offers "Create course outline"** as its first button.
15. **New client added inside "New deal":** the contact person just typed is not filled into "Attention to" (it is for an existing client).

## D. Useless, stale or confusing information

16. **Grant number is never asked any more** (Joel's choice on 21 Oct: Grant approved is a single tick), but the training report header and search still look for one, and CLAUDE.md section 2 still says "approved (grant number)". **Question for Joel:** HRDC claims and JD14 usually quote the grant ID. Bring the field back (optional), or remove it everywhere?
17. **"Training report: not found in the CRM"** in the fee checks, when the trainer had sent it but Admin hadn't checked it yet. Should say "Sent, waiting for Admin to check".
18. **Reference numbers change mid-deal.** The outline went out as **NA/PRO/20261022/01** (no customer code yet); the quotation, after the code was saved, is **VE/NA/20261022/01**. The client sees two styles. *Fix: ask for the customer code before the first send.*
19. **Trainer portal:** "Welcome, Dr!" / "Hi Dr" (it takes the first word of "Dr Lim Wei Ming"); the training still shows **"Being arranged"** after it has finished; "Rate the trainer" shows on the checklist before the training happens.
20. **Small wording:** "Revoke link" (teambuilding) vs "Stop link" (quotation, outline); the browser tab title is still **"My Google AI Studio App"**; the teambuilding template repeats itself to the client ("Door gifts · Door gifts", "Videography and drone · Videography and drone (depends on location)").

## E. Business and HRDC points to decide

21. **After-training order for HRDC deals:** step 1 is "record the HRDC claim", step 2 is JD14 / Verify T3. In practice the HRDC claim can only go in after JD14 and the verified T3 are done. Consider swapping for HRDC deals.
22. **"Include in P&L" starts unticked** (Joel's choice). If Admin forgets the tick on a trainer fee or venue, profit and the GP % KPI are overstated. Consider ticking it by default for trainer, venue, facilitator and bus.
23. **The PO goes to the trainer before any manager approves the fee.** The trainer sees "RM 4,000, waiting for approval" and can accept the PO, so the company is committed before approval. Fine if intended; otherwise send the PO once approved.

---

## Joel's decisions (23 Oct 2026)

- **Fix:** 1, 2, 3, 4, 5, 6, 9, 12, 18 (standardise), 20.
- **Fix, his way:** 7 (accepting online only tells the rep; the rep confirms the amount; add a "Request discount" button on the quotation that alerts Admin and Management and shows the GP %), 8 (days follow what the rep puts in the deal / quotation), 10 (free text is fine, then offer to save it as a new venue), 11 (upload photos once, they appear in both places), 13 (keep all three, explain them: Add trainer = typed by hand; Invite trainer = one-off trainer; Invite to trainer portal = trainers we use often), 17 (alert Admin or Management to check the report), 19 (no rating before the training), 21 (order the after-training steps the way HRDC works, as an editable checklist, not hard-coded), 22 (alert managers when a cost is left out of the P&L or the GP % looks abnormal), 23 (a manager agrees the trainer fee before the PO goes out).
- **Leave as is:** 14, 15.
- **Fix later:** 16 (grant number: optional, reminds Admin; never a must-have). Also in CLAUDE.md section 6.

## Fix plan, agreed 23 Oct 2026

- **Batch 1 (wording and screens):** 1 jump to and highlight the missing-details box; 2 approval card opens the deal; 12 "Change my fee request" / "Change my report"; 13 an (i) circle on each of the three trainer buttons that explains it on hover; 17 "Sent, waiting for Admin or Management to check" plus an alert to check it; 19 no rating before the training ends, no "Hi Dr", no "Being arranged" after the training; 20 "Stop link" everywhere, tab title "NEXT Academy CRM", no repeated item names in the teambuilding template.
- **Batch 2 (one home for each piece of information):** 6 participants live on the deal (changing them from the quotation leads back to the deal); 8 training days from the deal; 9 "Invoiced, not paid yet" vs "Expected"; 10 "Save as a new venue?"; 11 photos uploaded once show in both places.
- **Batch 3 (sales):** 3 teambuilding deals still need a programme, but teambuilding programmes are marked "(TB)" at the end of the name; 7 the online accept alerts the rep to confirm the amount, plus "Request discount" on the quotation (alerts Admin and Management, shows the GP %); 18 customer code before the first send, one reference style.
- **Batch 4 (money and checklist):** 5 + 23 a manager agrees the trainer fee before the PO, and a manager approves the payment again after the training; 21 HRDC order for the after-training steps, and the Grant approved step collects the **Employer code** and **Approval code** (Admin / Management, in Admin work; replaces item 16); 22 the manager **and the deal owner** get an alert when a cost is left out of the P&L or the GP % looks abnormal; 4 **every loop must be closed before Case closed**, and the deal shows which steps are still open.

**Not covered by this test:** the real database rules (no emulator), real file uploads to Firebase Storage, Outlook email, Google Calendar, phone layout, Ying as second approver and "never approve your own", HRDC shortfall / top-up invoice, Lost / On hold.

## Done

- **Batch 1 (2026-10-23):** the missing-details box (`GapsBox` in `DealGates.tsx`) scrolls into view, is highlighted and gets the cursor; My home cards open the deal's own panel (`nav.openDeal`; Admin goes to the won deal in the work queue); trainer portal greets by first name without titles (`greetName` in `lib/trainerPortal.ts`), shows "Training done" after the training, and the buttons are "Change my fee request" / "Change my report"; rating a trainer only once the training has started; (i) tips on the three Trainers buttons; fee checks say "sent by the trainer, waiting for Admin or Management to check it", and My home → Money jobs lists "Training report to check"; "Stop link" for every link kind; tab title "NEXT Academy CRM"; the teambuilding package list on phones no longer repeats the item name. No rules change. Build only (Joel's rule 9), plus the approval card checked in the test CRM.
- **Batch 2 (2026-10-23):** participants live on the deal: a **Participants** box on New deal / Edit details, a "Participants" line in Details, and **Won now asks for it** (`participants` in `dealGaps`, `GapsBox` / `MarkWonBox`); the quotation shows the deal's number with "Change on the deal" / "Add on the deal" (opens the deal's panel); the teambuilding Group size and the trainer's report already start from it. Training days: the quotation's main programme line (`isMainDealLine` in `quoteResolve.ts`) reads the deal's days, kept in step on the saved line; other lines keep their own. Labels: "Invoiced, not paid yet" (My home, Money) and "Expected (nothing invoiced yet)" (the deal's estimate). Venues: a typed venue on the quotation or the checklist's Venue step offers **Save as a new venue** (`saveTypedVenue` in `lib/venues.ts`, `SaveVenueButton.tsx`), reusing a venue of the same name. Photos once: a fee request sent without photos takes the report's, and a report with none starts with the fee request's (`serverTrainerPortal.ts`); the trainer's photos plus T3 **tick "Training delivered"** by themselves (`tickDelivered`, with a note and a History line; never unticks). No rules change. Tested in the test CRM: Edit details pax, quotation pax and days, Change on the deal, Save as a new venue, Won refused without pax then saved (Deal checks' original pax 20), fee request ticking Training delivered, report starting with the photo and 20 pax.
