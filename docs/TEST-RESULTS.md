# DODO website: test results (25 Oct 2026)
All results below come from this machine: a local PostgreSQL (PGlite) copy of the staging schema with the
migrations applied, the real Edge Function code under Node with Resend faked, and the real website pages in Chrome.
**Nothing was sent to Supabase, Resend or any inbox.** Staging tests need approval and deployment (runbook section 6).

## Summary
| Suite | Result |
|---|---|
| Website forms + security + webhook (`local-tests/forms-e2e.js`) | **PASS 121/121** (incl. launch switch off for all three forms) |
| Pre-booking (`local-tests/booking-e2e.js`) | **PASS 51/51** |
| Full site incl. live OpenFreeMap map (`local-tests/run.js`), working folder | **PASS 61/61** |
| Full site, website copy extracted from the final zip | **PASS 61/61** |
| Production copies of the 3 website migrations: guards (placeholder, other db, staging refused), apply and rollback on a production-like mock | **PASS 5/5** |
| Multi-state driver migration 46 (rehearsal T01–T25, lifecycle L1–L16) | **PASS 43/43**; deliberate faults M1–M4 all caught |
| Staging (DODO-Staging, 25 Oct): API tests (success, duplicates, invalid input, spam field, VIC driver, other origins) | **PASS 14/14** |
| Staging: browser, all three forms, desktop and phone | **PASS 6/6** |
| Staging: forged X-Forwarded-For does not bypass the per-visitor limit | **PASS** (200, then 429 x5) |
| Staging: database records (read-only query, cluster 7678069749886157684): 11 saved, team + acknowledgement sent once each, no errors | **PASS 11/11** |
| Staging: Resend accepted every email (verified domain dodotransport.com.au) | **PASS 22/22** |
| Email delivery to a real inbox (<staging test inbox>) | **PASS**: owner confirmed all 22 received; driver confirmation checked in person (sender, reference, content, staging warning, support number) |
| Staging: email-failure / recovery (amber message) | Not run on staging (needs a temporary sender swap); PASS locally |
| Staging: Resend webhook (delivered/bounced events) | Not set up; optional, post-launch |
| Launch gate (25 Oct): published site-config.js keeps all three forms closed; "on" without productionFormsVerified and misspelt switches stay closed; phone number shown | **PASS 6/6** (full site suite now 67/67; forms 121/121; booking 51/51) |
| Rider / Driver / Admin app test suites | Not run: no app code was changed; the website tables are used by no app (checked on all three release branches) |

## Coverage by requirement
| Requirement | Tests | Result |
|---|---|---|
| Six ride services | site: each of the six submits and shows the reference; names match backend `service_tier` and the Rider release | PASS |
| Three forms save to the database | D07, FD07, FD13, B*02–03, B*10–12, B*17, B21 | PASS (local) |
| Notification email to the right inbox, every field | H02, CH02, DH02, CO01 | PASS (faked Resend) |
| Rider / applicant acknowledgement, no false confirmation | H03, CH03, DH03, DH18, B03 | PASS (faked Resend) |
| Unique references | D07, FD07, FD13 (DODO-, DODO-MSG-, DODO-DRV-) | PASS |
| Duplicate prevention (repeat, parallel, second tab, retry) | D08, H07, H19, CH08, DH08, FD08–09, FD14, B02, B08 | PASS |
| Invalid submissions | D10–11, FD10, FD15, CH13, DH13, CO03, B12, B*06, B*14 | PASS |
| Email delivery failure (saved, never shown as success) and recovery | H08–H10, CH09–11, DH09–11, B09–10, B*04–05, B*13 | PASS |
| Network interruption / timeout | B07–B08, B11, B*07, H11, CH12, DH12 | PASS |
| Spam and abuse | H13, CH14, DH14, CH15/DH15 (no files), FD11–12, FD16, FD21, RL01–02 | PASS |
| Public endpoint security | H14–16, CH16–17, DH16–17, D04, D14, FD03, FD17, FD22, WH05, WH08, SEC1–3, B14, B19–20, P01–P03 | PASS |
| Mobile and desktop | B*01, B*09, B*16 (no sideways scroll, spam field hidden), site footer checks at 1366 and 390 px | PASS |
| Maps: OpenFreeMap loads (live tiles 200), attribution, use my location, tap to set, pins record coordinates, zoom, drag, denied permission | site [desktop]/[mobile]/[map] checks | PASS |
| Google Maps optional; rejected key falls back to OpenFreeMap | site [google] | PASS |
| Privacy and Terms links | site Link checks | PASS |
| Delivery log and bounces (Resend webhook) | WH01–WH10 | PASS |
| Migrations: staging only, existing rows unchanged, re-run refused, rollback | D01–06, D15, FD01–06, FD19, WH10 | PASS |
