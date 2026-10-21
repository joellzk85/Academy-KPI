# Trainer portal (built 2026-10-21)

Joel's list: trainer login with email, password and forgot password; don't replace the trainer invite links (not every trainer gets the portal); in the portal: biodata, training history, profile, rating (filled by Admin), topics, upcoming trainings, bank details, TIN, address; Request training fee (photos, T3, training report later) that alerts Admin and Management; the PO is sent there once the training is confirmed.

Joel's decisions (2026-10-21):
- **Login:** Firebase's own email + password sign-in, **for trainers only**. "Forgot password" and the first "choose your password" email are Firebase's reset emails (from a Firebase noreply address). Staff login is unchanged (name + password, no emails).
- **Approval:** only a **bank account change** waits for Admin or Management. Profile, biodata, topics, address and TIN save straight away.
- **Fee:** follows the Admin work flow. The trainer never types an amount. The fee is the trainer cost line Admin raised on the deal's Trainer step (with the PO), approved and paid as usual. If there's no line yet, the request waits with a red flag telling Admin to add one; nothing is raised automatically.
- **Rating:** everyone sees it, including the trainer (stars and comments).

## How it works
- **Where:** `/trainer` on the live site (`src/main.tsx` → `TrainerPortal.tsx`). The portal uses its own Firebase connection (named app `trainer-portal`), so a team member logged in to the CRM in the same browser stays logged in.
- **Logins:** a Firebase Auth user with id `tr_<trainerId>`, made by the server. It has no `auth_map` record, so the database rules give it nothing; the portal only talks to `serverTrainerPortal.ts` (`/api/portal/*`), which checks the login and returns only that trainer's own things. Uploads go straight to Storage `trainer_portal/{trainerId}/…` (`storage.rules`: only that trainer, while `trainer_accounts/{trainerId}.active`).
- **Giving access:** Trainers → open a trainer → **Trainer portal** box (Admin and Management): type the email → **Give portal access** → the server makes or updates the login and `trainer_accounts/{trainerId}` → the browser asks Firebase to email the "choose your password" link → Copy message / WhatsApp with the portal address. Also **Send password email again**, **Change login email**, **Turn off access** (disables the login and logs them out). The list shows a small "Portal" tag. Profile links and outline links are unchanged and still work for every trainer.
- **The portal:** Home (to-do list: accept a PO, request a fee, add bank details / TIN; next training; average rating; profile %), **My trainings** (upcoming and history: programme, client, dates, venue, Confirmed / Being arranged, PO download and **Accept the PO**, fee lines with status, the fee request, rating), **My profile** (the same form as the profile link, `TrainerProfileFields.tsx`, with Preview HRDC biodata; saves straight to `trainers_directory`, IC to `trainer_private`), **Payment details** (bank, TIN, address). "Change my password" sends the reset email.
- **Which trainings:** won deals (not deleted, owner on the Team list) whose checklist **Trainer step** has this trainer picked (`trainerId`). A trainer only on the quotation doesn't see it until Admin picks them on the checklist.
- **PO:** the file(s) uploaded on the Trainer step. The server streams them (`/api/portal/po`). **Accept the PO** sets `trainer_jobs.poAcceptedAt` and adds a deal History line.
- **Request training fee:** from the training's start date. Photos (made smaller to JPG) and the T3 (PDF, JPG or PNG) → `/api/portal/claim` → `trainer_jobs.claim` (`submitted`), the deal's trainer fee lines get `trainerClaimAt`, deal History line. Training report: "coming soon" placeholder. The trainer can change and resend until every fee line is paid.
- **Alerts:** a red flag on the deal in Admin work's work queue (`claimFlag`: "X asked for their fee: check the photos and T3, then approve", or "…there's no trainer fee line yet: add it on the Trainer step"), gone once every fee line is approved or paid; and **Trainers asking for their fee** at the top of Admin work → Money.
- **Deal's Trainer step** (`TrainerJobBox`): PO accepted date, the fee request with photo thumbnails and T3 links, **Ask the trainer to fix something** (note shown in the portal; status `returned`), and the **rating** (1 to 5 stars + comments; Admin and Management set it, everyone sees it). Trainers panel shows the average and each training's rating.
- **Bank changes:** `trainer_bank_requests/{trainerId}` → **Bank accounts from trainers, to check** on Trainers and Admin work → Money → Accept (writes the trainer's vendor record, creating one if needed) or Reject (reason shown in the portal). Typing back the account already on record cancels a pending change.
- **TIN:** new `tin` field on the vendor record (also in Admin work → Vendors' form). Saved from the portal straight away (a vendor record is created for the trainer if none).

## Records
- `trainer_accounts/{trainerId}`: email, active, created/updated, lastSeenAt, history. Members read; only the server writes.
- `trainer_jobs/{dealId}_{trainerId}`: rating, poAcceptedAt, claim. Members read; Admin and Management write (the server too).
- `trainer_bank_requests/{trainerId}`: Admin and Management read, accept, reject; only the server creates.
- Code: `src/lib/trainerPortal.ts` (records, cleaning, flag), `src/lib/portalEmail.ts`, `serverTrainerPortal.ts`, `src/components/TrainerPortal.tsx`, `TrainerPortalAdmin.tsx`, `TrainerProfileFields.tsx`.

## Joel's one-time setup
1. Firebase console → Authentication → Sign-in method → **Email/Password → Enable** (only the first switch, not "Email link"). Staff login doesn't use it and isn't affected.
2. Optional: Authentication → Settings → Authorized domains → add the live site's domain, so the reset email brings trainers back to the portal. Without it, the email still works.
3. Optional: Authentication → Templates → Password reset: change the sender name to "NEXT Academy".
4. Publish `firestore.rules` and `storage.rules` after the build is live.

## Tested
Script (27 checks: login ids, claim files only from the trainer's own folder for that training, claim needs photo and T3, the red flag in each case, bank cleaning and "same account", TIN, email, average rating, portal profile files, profile links unchanged). Temporary local page with pretend server answers: home and to-do list, accept and download the PO, empty fee request refused, a sent-back request fixed and resent (right files sent), bank change → "waiting to check", short account number refused, TIN tidied, profile save, phone width, login page and the "not switched on yet" message from real Firebase. Needs the live site: giving access and the email, logging in, uploads, the CRM boxes (Trainer step, Money, Trainers) and the rules.
