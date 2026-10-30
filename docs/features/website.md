# Public website (nextacademy.my), edited in the CRM

Joel, 2026-10-30. The WordPress site at nextacademy.my is replaced by a website edited inside the CRM ("like WordPress: drag and drop, drag to resize"). Built in batches; Batch 1 is done.

## Decisions (Joel)

- Keep the domain; WordPress goes. Switch the domain over only when Joel is happy with the test site; old WordPress addresses are forwarded so Google keeps finding them.
- No online payment for now. Enquiry and registration forms create CRM leads / bookings (Batch 3).
- The calendar comes from Public programmes, trainers from the Trainers list, programmes from titles (Batch 2). Single source of truth: nothing is typed twice.
- Brand (Joel's brand deck): **Archivo Regular and Bold only**; Next Blue `#2B6AA2`, mint teal `#5BC0A0` (the PDF printed `#70F74B`, a lime; Joel said either is fine, the swatch's mint was used), black, clay grey `#C1C1C1`, white. One highlighted word per headline, torn-paper photo edge, subtle grid texture. Editors can only pick these.
- **Who edits:** Admin and Management always; anyone else the owner ticks in Website → Settings.
- **The owner is the main creator:** makes, renames and deletes pages, drags blocks around, sets the menu and settings, publishes. Everyone else changes the words, photos and settings of the blocks already on a page; their changes **wait for the owner's OK** ("Waiting for approval"; never say on screen who approves).
- **Media:** photos, short clips (up to 60 MB) and YouTube links. **Long videos go on YouTube** (unlisted is fine), added as a link (Joel).
- Training-day photos may only go on the website once someone ticks "OK for website" (participants agreed; PDPA). Not built yet.

## How it works (Batch 1)

- **Website button** in the CRM header (and in the person menu on phones) for Admin, Management and ticked people. Opens a full-screen screen with **Pages**, **Media**, **Menu**, **Settings** (owner only). The owner's button shows how many pages wait for approval.
- **Pages:** list with status (Live / Live · changes not published / Not live yet / Waiting for approval). Owner: **Start with the homepage** (the mock-up, `starterHome()`), **New page** (name and address), Rename, published **History** (put back a version as the draft), take off the website (kept, Put back).
- **Editor** (`WebsiteEditor.tsx`, the Puck editor kit `@puckeditor/core` 0.23, MIT): blocks list on the left, the page in the middle with Phone / Tablet / Computer views, settings on the right; click text on the page to type over it. The draft saves itself (`useAutoSave`); visitors see only the published page. Owner: **Publish** / **Approve and publish** / **Send back** (with a note). Others: **Ask to publish**. Anyone: **Undo all changes** (back to what's live).
- **Blocks** (`src/website/blocks.tsx`, the same code draws the editor and the public site). Ready-made sections: Hero banner, Empty section (drop blocks in), Numbered points, Training calendar, Programmes, Trainers (these three show marked samples until Batch 2), Client quote and video, Client logos, Values band, Contact us (company details from `lib/company.ts`, WhatsApp from Settings). Blocks: Heading, Text, Photo, Video, Button, Columns (two or three; **drag the line between two columns** to resize, 20–80% in 5% steps), Space.
- **Media** (`WebsiteMedia.tsx`): folders, search by name or #tag, Photos / Videos / Not used yet, upload / drop / paste (Ctrl+V). Photos are shrunk to 1600 px. Each item: name, "Describe the photo" (Google and blind visitors), focus point (click the photo; phones crop around it), folder, tags, Used on. **Replace everywhere** (owner) swaps the file on every page at once. Delete only when no page uses it (uploader or owner).
- **Menu:** words, goes to a page or an address (`#contact`, a web address), one can be a Button; pages not yet live stay out of the menu.
- **Settings** (owner): who else may edit, line under the logo, WhatsApp, Facebook, Instagram, LinkedIn, and **the website's own addresses** (empty until the switch).

## The public site (`serverWebsite.ts`)

- **Test address:** `<CRM address>/site` and `/site/<page>`, marked "noindex" (Google ignores it). Links inside get `/site` in front.
- **Real address:** a visitor arriving on one of the addresses in Settings sees `/` (homepage) and `/<page>`; `robots.txt` and `sitemap.xml` are made from the live pages; an address ending in "/" (WordPress style) is forwarded to the same address without it. The CRM's own address is never affected.
- Pages are drawn on the server as plain HTML (Google reads them), with the title and description from the page settings. Rich text is cleaned (only plain formatting, safe links). Published changes show straight away on the server that published (others within 30 seconds).
- Logos for the site: `public/site-assets/logo-light.png` and `logo-dark.png` (cut from the brand PDF).

## Database

- `site_pages/{id}`: title, slug ('' = homepage), draft, draftBy / draftByName / draftAt, status (`draft` / `waiting` / `live`), note, published, publishedAt, publishedByName, deleted. History in `site_pages/{id}/versions`.
- `site_media/{id}`: name, kind (`image` / `video` / `youtube`), url, storagePath, youtubeId, folder, alt, tags, focusX / focusY, size, width, height, createdBy. Files in Storage `site_media/`.
- `config/site_menu` (items) and `config/site_settings` (editors, tagline, socials, whatsapp, domains): owner only.
- Rules (`firestore.rules`, `storage.rules`): editors may change only the draft (as themselves, `draft` or `waiting`) or throw changes away (back to exactly the published copy); only the owner publishes, makes or deletes pages, keeps history, sets menu and settings, and replaces media files. Tested with 37 rule checks (website.mjs in the rules kit); the earlier 190 checks still pass.

## Tested (2026-10-30, test copy of the CRM)

Owner: start the homepage, upload a photo (2400 px shrunk to 1600), pick it for the hero, drag in a Columns block, drag its line 50/50 → 70/30, publish; /site shows the page in Archivo on computer and phone (no sideways scroll). Admin: no Settings, New page or blocks list; change the hero's small line, Ask to publish: live page unchanged. Owner: Website button shows 1, "Check and approve" with "Aina changed this page…", Approve and publish: live at once, 2 versions kept. Menu with a page, the homepage and a "Talk to us" button. With nextacademy.my in Settings: `/`, `/training-calendar`, `/training-calendar/` → 301, unknown page → 404, robots.txt, sitemap.xml, canonical link; the CRM's own address still shows the CRM.

## Still to do

- **Batch 2:** calendar from Public programmes runs (dates, seats left, register), programme pages from titles ("Show on website" tick, public description), trainers from the Trainers list.
- **Batch 3:** enquiry and registration forms that create a lead / booking and assign a rep.
- **Batch 4:** visitor tracking (pages, where from, website leads → won RM).
- **Domain switch:** list the WordPress addresses (`/training-calendar/`, `/training-courses/`, `/training-courses-esg/`, `/our-trainers/`, `/contact-us/`, `/privacynotice`) and make pages or forwards for each; add the domain in Firebase App Hosting; copy the WordPress content (text, logos, testimonials, privacy notice); keep WordPress hosting a month.
- "OK for website" tick on training-day photos.
