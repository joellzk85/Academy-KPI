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

## Batch 2 (2026-10-30): calendar, programmes and trainers from the CRM

Joel: the calendar shows **price and seats left**; **Admin and Management** tick titles and trainers onto the website (live straight away, no approval). `src/lib/websiteData.ts` (`buildSiteData`) decides what leaves the CRM; the server (`serverWebsite.ts`) works it out every 30 seconds and the editor's preview gets the same through `/api/site/data`.

- **Calendar:** every upcoming public programme run that isn't cancelled (Malaysia date), with dates, title (linked to its programme page when shown), venue and area, days, **RM price per pax**, **HRD Corp claimable** (title HRDC approved) and **seats left** counted exactly as Public programmes counts them ("Full" with a waiting-list link). Block settings: which type, how many (more go to `/training-calendar`).
- **Register** opens WhatsApp (Settings → WhatsApp number; email when none) with the message written ("I'd like to register for … on …") until the form in Batch 3.
- **Titles:** Course outlines / Teambuilding proposal → By title → Title details → **Website** box (Admin, Management): Show on the website, Name on the website (else the CRM's capitals in normal case, acronyms like HR, KPI, DISC kept), the course outline the page uses (only its overview, objectives, who it's for, modules, methods and length; never the client, refs or prices), short description. Page `/programmes/<name>` with the title's upcoming dates and its ticked trainers. Renaming the website name changes the address.
- **Trainers:** Trainers → a trainer → **Website** box (Admin, Management): "<name> agreed to be shown" must be ticked before Show on the website (PDPA); one line under the name. Page `/trainers/<name>`: photo, name, line, bio, years, qualifications (and academic), certifications, languages, titles they teach. Never phone, email, IC, rate, address or past clients (checked: none of them reach the page).
- **Automatic pages:** `/training-calendar`, `/programmes`, `/trainers` exist without editing; an edited page with the same address wins (then put the matching block on it). All go in the sitemap.
- Rules: `trainers_directory.website` is changed only by Admin and Management (titles already were). 44 website rule checks pass, plus the 122 older ones.
- Tested (test copy): run with 20 seats and two companies (9 pax) shows "11 seats left", RM 1,500.00, HRD Corp claimable, Register → WhatsApp text; programme page with outline content and no client name; a deleted outline is left out; a trainer not agreed stays hidden (404); both Website boxes save and the pages change at once.

## Batch 3 (2026-10-30): forms into the CRM

Joel: **reps take turns**; a registration **holds seats only once a rep makes the deal**. Defaults kept for later (Joel: "keep those optional for later"): everyone active with the Rep role is in the turn (by name), 24 hours before Management sees it as not touched, the form questions below.

- **Forms** (`src/website/blocks.tsx` `FormGuts`): the Contact us block and the bottom of every programme and trainer page have **Talk to us** (name, company, mobile, email optional, programme from the ticked titles or "not sure", message); each calendar date's Register goes to `/register/<run>` (the date's details and the form: name, company, mobile, email, how many people, HRD Corp claimable yes / no / not sure, anything to know). A full date offers the waiting list. A PDPA consent tick is required. Plain forms (no JavaScript needed); after sending, `/thank-you` (or `/form-problem` with a link back).
- **Robots, no puzzle** (`serverWebsiteForms.ts`): a hidden box people never see (filled = dropped quietly), a signed time stamp in every form (sent within 3 seconds or after 2 days = refused; key in `server_secrets/site_forms`), at most 6 forms an hour from one visitor.
- **Reps take turns:** `nextInTurn` gives each one to the next active rep after the one in `config/site_rotation` (server only), in a transaction. No reps = nobody yet (Admin and Management see it).
- **My home → Website enquiries** (`WebsiteEnquiries.tsx`): shows only when something waits. A rep sees their own new ones; Admin and Management see all new ones, the ones waiting over 24 hours first in red, and can **Give to** someone else (kept in `reassigned`). Open one: details, call / WhatsApp / email links, then
  - **Make it a deal:** pick the matching client (similar names offered) or add a new one (company, contact, mobile, email from the form; Found by the person making it); funding and pax. A New deal owned by the rep it was given to, `source: 'website'`, `websiteEnquiryId`, the form in the enquiry note. A registration joins its public programme run at list price (seats and the run's rules checked as in Add a company): its seats are held from then.
  - **Only a question** or **Not real**: with a note (required).
- Rules: `site_enquiries` made only by the server; read by the rep it was given to, Admin and Management; reps change only the status and note (as themselves), only Admin and Management give it to someone else; nobody deletes (owner override aside). `config/site_rotation` server only; **fixed: members could delete `config/site_settings` and `site_menu`** (now not). 58 website rule checks pass, plus the 122 older ones.
- Tested (test copy): a registration (3 pax) and two enquiries went Alif, Zara, Alif in turn; robot box, a made-up and a too-fast stamp and a missing consent were refused; Alif saw only his own, made the registration a deal (new client, RM 4,500, HRDC, on the run, "website"): the site went from 11 to 8 seats left; Not real needed a reason; the box went away when empty; Joel saw all and gave Zara's to Alif.

## Batch 4 (2026-10-30): visitors, and from visit to money

Joel: **Management only**. `src/lib/websiteStats.ts`, `serverWebsite.ts` (`/api/site/hit`), `src/components/WebsiteVisitors.tsx`.

- **Counting, no cookies, no Google Analytics:** a tiny script on every public page tells the server a page opened (`hitScript`): the page, and on the first page of a visit where it came from (a campaign tag wins, else the site clicked from: Google, Facebook, Instagram, LinkedIn, WhatsApp, X, YouTube, email, other search, another site's name, or "Typed in or bookmark") and phone or computer. The server only adds to one record a day: `site_stats/{YYYY-MM-DD}` (visits to the test address in `site_stats_test`): views, visits, people (roughly: same connection and browser on a day = one; worked out on the server and not kept), pages, sources, campaigns, devices, forms sent. Robots, made-up addresses (like /wp-admin) and more than 60 a minute from one connection aren't counted. The visit remembers where it came from for that browser tab only (`sessionStorage`).
- **Enquiries remember where they came from:** the script puts it in the form; the server saves `came: { source, campaign, landing }` on the enquiry; Make it a deal copies `websiteCame` and `websiteCampaign` to the deal; the enquiry panel shows "Came from".
- **Website → Visitors** (Management only, in the database too): last 7 / 30 / 90 days, The website or Test address; tiles (visits, people, pages opened, forms sent, deals made from the website, won RM from the website); visits per day (bars, hover for the number, "Show as a table"); where visits came from, pages opened, campaigns, phone or computer; **From visit to money** table: visits, enquiries, deals, won and won RM by where they came from (enquiries and deals are always the real ones).
- **Make a tracked link:** page (homepage, calendar, programmes, trainers, edited pages, each programme), where you'll post it (Facebook, Instagram, LinkedIn, WhatsApp, Email, somewhere else), campaign name → a link with `utm_source`, `utm_medium`, `utm_campaign`, Copy. Uses the website's own address once set in Settings, else the test address.
- Rules: `site_stats` and `site_stats_test` read by Management only, written by the server only. 63 website rule checks pass, plus the 122 older ones.
- Tested (test copy): a visit from a Facebook tracked link (campaign dec-promo) → programme page → Register: counted as Facebook / dec-promo, 3 pages, the form counted and the enquiry saved "came from Facebook, dec-promo"; two visits from Google on a phone; a robot and /wp-admin not counted. Visitors as Joel: tiles, the day's bar, the lists, and From visit to money "Facebook: 2 visits, 1 enquiry, 1 deal, 1 won, RM 4,500.00"; Admin has no Visitors tab.

## The designed website (2026-10-30)

Joel: "design my website using my current website as reference; put in the copywriting; capture the photos; AI-generate the rest". `src/lib/websiteStarter.ts`, photos in `public/site-assets/starter/`.

- **Website → Pages → Load the designed pages** (owner): copies 13 photos into Media (folders Homepage, Programmes, Training days, Other; described for Google; ids `starter-…`, kept if already there) and 3 client video testimonials (YouTube, from the old site: J&J HLA Garment, Bell Impiana Hotel KLCC, Han Trinitium); makes Home, About us (`/about-us`), Training programmes ESG (`/training-courses-esg`), Professional skills (`/training-courses`), Contact us (`/contact-us`) and Privacy notice (`/privacynotice`), keeping the old WordPress addresses. A page that already exists gets the design in its **draft** only (live stays until Publish). The menu is set only when empty. Nothing goes live until the owner publishes.
- **Copy:** the old site's messages (tagline "Behind every great employee is a trainer who didn't use 100 slides", vision, mission, HEART values, Personalised / Purpose-driven / Holistic, the 8 categories and their courses) rewritten shorter; no client quotes were invented (the videos speak for clients). Company details still come only from `lib/company.ts`.
- **Photos:** 4 real ones from the old site (trainer on stage, team at work, workshop circle, office front); 9 made with AI in Canva (hero, 4 ESG and 4 professional categories), tagged `ai` in Media. The old site's stock photo was not reused.
- **Footer:** a Privacy notice link (`/privacynotice`). The notice is a PDPA draft for Joel to check (PDPA wants it in Bahasa Malaysia too).
- Tested (test copy): loader made 5 pages and put the design in the existing Home's draft; published, every page drew on computer and phone (no sideways scroll), videos, calendar, trainers, contact form and the footer link; the editor opens the designed pages.

## Facebook look (2026-10-30)

Joel: "study my photos (Facebook), come up with a nicer layout and design". The site now follows the look of Next Academy's Facebook posts. Mock-up: https://claude.ai/artifact/XQcDB6wDP65V5jBPzz6KDY

- **Style** (`SITE_CSS`): black header with the white logo and a mint Talk to us button; highlighted words are white on a mint block; black bands have the grid and mint eyebrows; the footer is black.
- **Torn paper:** every ready-made section and Empty section has **Top edge: Straight / Torn paper** (the band rips into the one above). Photos (Hero, Photo block) have a new look **Torn paper, mint tint** (black-and-white photo, mint wash, ripped top).
- **Hero:** an optional **review card** on the photo (name, who they are, what they said, where from).
- **Points:** **Look: Numbered / Mint squares** (the Facebook checklist: heading left, mint squares with a bold line and a smaller one).
- **New blocks:** **Photo tiles** (programme tracks: photo, torn black panel, tags, link), **Reviews on photos** (up to 4 black-and-white photos with up to 3 white review cards), **HR insights** (the Facebook posts as square cards: headline with words highlighted in mint, separated by `|`; topic, small note, optional tinted photo; opens the Facebook post or a page; optional button).
- **Designed pages:** Home rebuilt as the mock-up (hero with Rakumaran's review, calendar, Why Next Academy as mint squares, two track tiles, reviews wall with Suzanna Yip's and Rakumaran Pannirselvam's Google reviews as already shown on Facebook, client videos, HR insights linking to the Facebook page, trainers, Talk to us on black). Other pages: dark heroes with tinted photos, torn edges, HEART values as mint squares, Talk to us on black. To use it: Website → Pages → **Load the designed pages** again (drafts only), check, then Publish.
- HR insights link to Facebook for now; the website has no article pages of its own yet.
- Nothing to publish (no rules change).

## Ready for the domain switch (2026-10-30)

- **What was found:** nextacademy.my is managed at MSC Hosting (name servers `ns137/ns138.mschosting.cloud`); WordPress runs on their server (103.6.198.76). **Email is Microsoft 365** (MX `nextacademy-my.mail.protection.outlook.com`, backup MX `mail.nextacademy.my` on the same MSC server): **never change the MX or mail lines** when switching; only the website's lines for `nextacademy.my` and `www`.
- **Old addresses forwarded** (`serverWebsite.ts` `OLD_ADDRESSES`, only on the website's own addresses; a published page with the old address wins): our-trainers → /trainers; mission-vision, testimonial → /about-us; sales-marketing → /training-courses; shop, cart, checkout, my-account → /training-calendar; internship-opportunity → /career. Addresses ending in "/" still go to the same address without it.
- **nextacademy.my → www.nextacademy.my** (301) when both are in Website → Settings: the address Google already knows.
- **Careers page** (Joel: "on the new site"): `/career` in the designed pages (the old /career and /internship-opportunity pages were empty): HEART values as mint squares, Join the team and Internships tiles, How to apply (email the CV to the company email from `lib/company.ts`; no openings listed). Not in the menu unless added in Website → Menu.
- Tested: 15 checks of the forwards and the www rule pass; the Careers page drawn on computer.
- Steps for Joel: publish the pages; Website → Settings → both addresses; Firebase App Hosting → nextacademy2 → Settings → Domains → Add custom domain (both); send a screenshot of MSC Hosting's Zone Editor before changing anything; change only the lines Firebase gives; keep WordPress hosting a month.

## StoryBrand homepage (2026-10-31)

Joel: "use the StoryBrand framework to design the website flow". The client is the hero, Next Academy the guide. Heroes are both HR / L&D and business owners: a shared homepage with two doorways. Decisions: no years in business; companies trained, Google rating and review count typed by Joel in Settings (not pulled from Google Maps); no paperwork talk (grant, JD14, T3, claims) since "it goes without saying"; at most 6 videos, all slots left empty for Joel to pick; English first; vision "to create a world where people are inspired to go to work every day" used as the success.

- **Home** (`websiteStarter.ts` `home()`): hero ("Training your team will actually use.", Book a free consult, Google rating line) → problem (mint squares) → video slot 1 → two doorway tiles → guide (100 slides tagline, empathy, vision, Numbers) → reviews on photos → client logos → the 3-step plan → programme tracks → calendar → Without / With ("Imagine a team that's inspired to come to work every day.") → video slot 6 → Book a free consult form. HR insights and Trainers left off the homepage (still at `/trainers` and on Facebook).
- **For HR and L&D** (`/for-hr`) and **For business owners** (`/for-business-owners`): hero, problem, plan, two video slots each, Without / With, form. Not in the menu (the doorway tiles link to them).
- **New blocks:** **Without / With** (`Compare`), **Client videos (up to 3)** (`VideoRow`; empty slots and an all-empty band are hidden on the website), **Numbers** (`ProofBlock`: companies trained and Google rating from Settings, plus any typed numbers). Hero: **Google rating under the buttons** (Show / Hide).
- **Hidden while empty on the website** (shown as a dashed box in the editor): any Video block or video slot with nothing picked, Client logos with no logos, Numbers with nothing filled.
- **Settings → Numbers on the website:** Google rating, number of Google reviews, companies trained (`config/site_settings` `googleRating`, `googleReviews`, `companiesTrained`). Nothing to publish (owner-only doc already).
- The 3 old YouTube testimonials are still copied into Media by the loader but no page uses them until picked.
- To use: Website → Pages → **Load the designed pages** (drafts only; the new pages are made), fill Settings → Numbers, pick the videos, upload client logos, then Publish each page.
- Tested: build; the three pages drawn on the server code with Settings empty (no rating, numbers, video or logo boxes) and filled (rating line and numbers show); computer and phone (no sideways scroll).

## Still to do

- **Domain switch:** list the WordPress addresses (`/training-calendar/`, `/training-courses/`, `/training-courses-esg/`, `/our-trainers/`, `/contact-us/`, `/privacynotice`) and make pages or forwards for each; add the domain in Firebase App Hosting; copy the WordPress content (text, logos, testimonials, privacy notice); keep WordPress hosting a month.
- "OK for website" tick on training-day photos.
