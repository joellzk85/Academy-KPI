# Process audit and fixes (2026-10-22)

The audit checked the agreed rules in CLAUDE.md against the code and `firestore.rules`. Several of them were enforced only on screen, so they could be bypassed with a direct database write. Joel asked for every finding to be fixed except one: the HRDC grant number, which only matters to the client, so "Grant approved" stays a tick.

## Money

- **Vendor bank details** (`lib/vendors.ts`, `VendorsPage.tsx`, `TrainerPortalAdmin.tsx`, rules on `vendors`):
  - Setting or changing bank details stamps `bankSetById` and adds a line to `bankLog`; the rules don't let anyone remove a line from the log.
  - The new details then wait for a manager who didn't set them to press **Bank details checked** (`bankCheckedById`).
  - Until a manager checks them, the payment summary shows no bank details for that vendor and says "being checked: don't pay yet" (`paymentSummary.ts` `bankUnchecked`, PDF and `/pay/` page). The server refuses **Payment made** for that vendor.
  - Vendors saved before this change count as checked.
- **Mark paid, and undo:**
  - Mark paid is saved as the person clicking (`paidById` is checked). Only the server can write "Accounts (via link)".
  - **Undo paid** is Management only, stamped `lastUndo` (who, when, what it was), with a History line. This covers money out, money in, reimbursement invoices, and Payment tracking lines.
- **Money in and claim backs:** one rule set, `ledgerUpdateOk`:
  - Admin adds them and records payments as themselves.
  - Only Management changes a paid record or undoes a payment.
  - Admin can't change a record whose training month is locked.
  - Nothing is erased. Records are marked deleted (`deleted`, `deletedById`, `deletedReason`, three or more characters), and only Management deletes a paid one.
  - Management restores deleted records in **Management → Lost and deleted → Deleted money records**.
  - Hiding a record "with its deal" (`dealDeleted`) is allowed only when the deal itself is deleted in the same save (`getAfter`).
- **Money out:**
  - Approved and paid requests are never erased; Management marks them deleted with a reason and can restore them.
  - Requests waiting for approval, or rejected, can still be removed by the requester or Management.
  - Approvals carry `decidedTs` (the database's own time).
- **Include in P&L:**
  - New costs start **ticked** (Joel, 2026-10-22).
  - Leaving one out needs a short reason (`notInPLReason`), checked by the rules.
  - Once a cost is approved, only Management changes the P&L or "Pay on behalf" ticks.
- **Money settings:**
  - Only Management changes them.
  - A new HRDC % or commission % applies from today. The old rates are kept in `rates` (`until` date), and `settingsAt` uses the rate of the claim date (HRDC %) or the training date (commission), so past P&Ls never change.
- **Admin sees costs and profit** (Joel, 2026-10-22). Payment tracking now shows profit to Admin too.

## Deals and KPIs (rules on `pipelines`)

- **Stage check:** the stage must be a known one, and the old `status` must agree with it. A deal can no longer count as won through `status: 'Won'` alone.
- **Won deals:**
  - Only Management creates a deal that is already won, or undoes a win.
  - A cancellation still goes through the approved Cancel request.
  - Winning needs the client, a value and the funding type.
  - Each win adds exactly 1 to `winCount`, and the first `wonOriginal` is kept on a second win.
  - The won date must be today in Malaysia, with 1 hour's slack (it was ±36 hours).
  - A won deal's owner changes only by Management. On screen the owner picker is greyed for others, and Undo win shows for Management only.
  - An approved value change must also set the participants that were asked for.
- **Deal History is add-only:** no line can be removed or changed, and a new line is signed by whoever saves it. The 40-line trim was removed everywhere, server included. A test with a 300-line history stays within Firestore's limits.
- **Change requests** (date, value, cancel) must be in your own name, so a manager can't file one as the other manager and then approve it.
- **Month lock** now also covers the proposal date, and the dates on new deals.
- **Deletes:** only Management erases a deal; everyone else marks it deleted, as before.

## HRDC operations

- **New step "Training delivered (photos and signed attendance)"** (`delivered`, after training, needs an uploaded file). It is added to won deals whose training hasn't ended.
- **HRDC claim:** it can be recorded only once Grant approved and Training delivered are ticked (`hrdcClaimBlock`). Management can record it anyway, with a reason that goes into the History.
- **Trainer fee checks** (`lib/feeChecks.ts`):
  - On HRDC deals there is a new check, **HRDC grant approved**.
  - The grant and Training report checks can't be ticked by hand: only Grant approved on the checklist and a checked report count. Training delivered counts as photos.
- **Training report step:** it has no Done button. It is ticked only when the report is checked, ready for HR.
- **Required steps:** Grant, JD14, T3, Training delivered and Training report can't be removed from a deal, or stopped in the master list, except by Management (with a reason, in the History).
- **HRDC shortfall:** the case can't close until a **top-up invoice** goes to the client or Management **writes it off** with a reason:
  - The top-up invoice is a client invoice with `topUpFor` = the claim's id, raised from After training step 3.
  - A write-off is saved as `shortfallWriteOff` on the claim.
  - The red flag stays until one of the two is done.
- **One "Case closed":** `postTraining` also needs every before-training step done, the same check as the work queue. It now takes the money settings.
- **A rep starting a checklist** (when winning) can't save any step as already ticked (rules `noneDone`, first 40 steps).
- **Trainer portal:** once the checked report has an open HR link, or the trainer's fee is paid, the trainer can't change it until the team sends it back (`serverTrainerPortal.ts`).

## Privacy (PDPA)

- **T3 name lists** (participants' IC numbers) move from `deal_checklists.t3` to `deal_t3/{dealId}`, which only Admin and Management can read. Older lists move when Admin or Management opens Admin work (`moveT3Lists`), or on the next save.
- **Checklist files** (attendance, T3, JD14): only Admin and Management can read the records and the files. Reps see each step's progress only.
- **Trainers:** gender, address, emergency contact, race, nationality and rate move to `trainer_private` (Admin and Management). The rules refuse a rep write that touches them. See `hrdc-programmes-trainers.md`.

## Super Manager (Joel, 2026-10-22)

Joel: "Joel is Super Manager and can do any changes, no need anyone to approve; can bypass, approve anything, delete anything forever. Nobody supersedes. Only the system double confirms the decision and mentions the potential risk."

- **Who:** one person, `superManager: true` on `team` and `auth_map`, set only by the server:
  - Team → **Make me Super Manager**, offered while nobody holds it (`/api/team/super/claim`).
  - **Hand it over** to another manager (`/api/team/super/handover`).
  - No names in code: `lib/superManager.ts` reads who it is from the Team list.
- **Nobody supersedes:** the server refuses anyone else changing the Super Manager's role or password, removing them, or reactivating them (`guardSuper` in `serverAuth.ts`). The Team screen greys those buttons.
- **Rules:** `isSuper()` (Management plus `auth_map.superManager`) may read and write anything, except `secrets`, `server_secrets`, `team` and `auth_map` (login records stay server-only). In `storage.rules` they may read and delete any file. An Admin with the flag gets nothing extra.
- **On screen, always with a second confirmation that names the risk (`superConfirm`):**
  - approve their own payment request (also in Approve all), training change or bank details;
  - approve a trainer fee with checks missing (**Approve anyway**);
  - **Delete forever** when deleting money, and on Lost and deleted for deleted deals and deleted money records.
- History lines are still written ("Deleted forever …").

## Rules and tests

- Publish **`firestore.rules`** and **`storage.rules`** after the build is live. Until then: T3 lists can't be saved, the T3 lists and the trainers' personal details don't move, and the new approvals carry a field the old rules refuse (`decidedTs`), so approving fails.
- Tested with Firebase's own test database (a temporary Java in the scratch folder): 116 rule checks covering every item above, the Super Manager, and the existing approvals (Fix and send again, cross-approval).
- Not tested in the browser.
