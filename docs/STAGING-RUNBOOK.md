# DODO website: DODO-Staging deployment runbook
Status: PREPARED, NOT RUN. Every numbered stage needs the owner's separate approval.
Target: DODO-Staging, project ref `ziqwynsljjxlxuhjaeja` only. Nothing here touches production
`gobsccsryhavpwqpiujz`, DNS, the GitHub Pages site, Stripe, or any git repository.

## 0. Preconditions
| # | Item | Status 25 Oct 2026 |
|---|---|---|
| P1 | Staging inboxes. DODO notification copies of all three forms: **<staging test inbox>**. Acknowledgements during tests: **<staging test inbox>** (sent as <staging inbox>+tag). Never production, never shown on the website. | Decided by owner |
| P2 | dodotransport.com.au shows **Verified** in Resend -> Domains (sender `noreply@dodotransport.com.au`). | Unknown: owner to check (see DNS checklist) |
| P3 | Supabase CLI installed and logged in by the owner: `npm install -g supabase`, then `supabase login`. | Not installed on this machine |
| P4 | Project identity: `supabase projects list` shows `ziqwynsljjxlxuhjaeja` named DODO-Staging. In the SQL editor, `select (select system_identifier from pg_control_system())::text;` returns `7678069749886157684`. | To run before stage 1 |

## 1. Database (Supabase dashboard -> DODO-Staging -> SQL Editor). Order matters for file 3.
Check each file's SHA-256 against `SHA256SUMS.txt` first.
| Order | File | Expected output |
|---|---|---|
| 1 | `supabase/migrations/20261025120000_website_booking_requests.sql` | `WEBSITE_BOOKING_VERIFY_OK: <n> existing booking rows unchanged.` |
| 2 | `supabase/migrations/20261025130000_website_contact_and_driver_forms.sql` | `WEBSITE_FORMS_VERIFY_OK: <n> contact messages and <m> driver applications unchanged.` |
| 3 | `supabase/migrations/20261025140000_website_email_events.sql` (needs 1 and 2) | `WEBSITE_EMAIL_EVENTS_VERIFY_OK` |
Any other database: `STAGING_ONLY`, nothing changed. Run twice: `PREFLIGHT_ALREADY_APPLIED`, nothing changed.
Read-only check: `select proname from pg_proc where proname like 'website_%' order by 1;` (15 functions).

## 2. Edge Functions (owner's terminal, from the folder that contains `supabase/`)
```
supabase functions deploy website-booking-request    --project-ref ziqwynsljjxlxuhjaeja --no-verify-jwt
supabase functions deploy website-contact-message    --project-ref ziqwynsljjxlxuhjaeja --no-verify-jwt
supabase functions deploy website-driver-application --project-ref ziqwynsljjxlxuhjaeja --no-verify-jwt
supabase functions deploy resend-email-events        --project-ref ziqwynsljjxlxuhjaeja --no-verify-jwt
supabase functions list --project-ref ziqwynsljjxlxuhjaeja       # expect the four ACTIVE
```
`--no-verify-jwt`, per function:
- Three form functions: needed for publishable keys (`sb_publishable_...` are not JWTs, so the platform check
  would reject every visitor); not needed with the legacy anon key, which Supabase is retiring. Safe: the anon
  key is public, so the check adds nothing. Protection is in the function: allowed origins, hidden spam field,
  10 KB limit, field validation in the database, per-email, per-visitor and site-wide hourly limits, duplicate
  checks, service key used only on the server, replies contain only a reference and delivery status.
- `resend-email-events`: needed (Resend cannot send a Supabase JWT). Safe: every request must carry a valid
  Svix signature made with RESEND_WEBHOOK_SECRET within 5 minutes; anything else gets 401 before the database.

## 3. Secrets (type values yourself in your own terminal; never paste them into chat or website files)
```
supabase secrets set --project-ref ziqwynsljjxlxuhjaeja RESEND_API_KEY=<Resend key with "Sending access" only>
supabase secrets set --project-ref ziqwynsljjxlxuhjaeja WEBSITE_FROM_EMAIL="DODO Transport <noreply@dodotransport.com.au>" BOOKING_INBOX_EMAIL=<staging test inbox> CONTACT_INBOX_EMAIL=<staging test inbox> DRIVER_RECRUITMENT_INBOX_EMAIL=<staging test inbox> ALLOWED_ORIGINS=http://localhost:8080 DODO_ENVIRONMENT=staging
supabase secrets list --project-ref ziqwynsljjxlxuhjaeja         # names and digests only
```
SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are supplied to functions by Supabase.

## 4. Resend webhook (delivery log and bounces)
Resend -> Webhooks -> Add endpoint: `https://ziqwynsljjxlxuhjaeja.supabase.co/functions/v1/resend-email-events`,
events: email.sent, email.delivered, email.delivery_delayed, email.bounced, email.complained (and email.failed if listed).
Copy its signing secret (`whsec_...`), then:
```
supabase secrets set --project-ref ziqwynsljjxlxuhjaeja RESEND_WEBHOOK_SECRET=<whsec_... from Resend>
```
Note: Resend webhooks are per account. When production is set up later, give it its own endpoint and secret.

## 5. The DODO-Staging public key (never a secret key)
Dashboard -> DODO-Staging -> Project Settings -> API Keys -> copy the **Publishable key** (`sb_publishable_...`),
or Legacy API keys -> **anon public**. Never the Secret key (`sb_secret_...`) or **service_role** key.
PowerShell: `$env:STAGING_PUBLIC_KEY = Get-Clipboard` (prints nothing). The test kit refuses secret keys.

## 6. Tests (owner's machine, folder `staging-tests`). Run in this order.
```
$env:TEST_EMAIL = "<staging test inbox>"     # confirmations arrive as <staging inbox>+tag
node staging-forms-test.js browser "<website folder>"
node staging-forms-test.js api
supabase secrets set --project-ref ziqwynsljjxlxuhjaeja WEBSITE_FROM_EMAIL="DODO Test <test@unverified.invalid>"
node staging-forms-test.js mailfail
supabase secrets set --project-ref ziqwynsljjxlxuhjaeja WEBSITE_FROM_EMAIL="DODO Transport <noreply@dodotransport.com.au>"
node staging-forms-test.js recover
node staging-forms-test.js spoof        # last: uses up this machine's driver quota for an hour
```
| Test | Expected result |
|---|---|
| browser: contact, driver, booking x desktop, phone | 6 x PASS: green message with reference (DODO-MSG- / DODO-DRV- / DODO-), no sideways scroll, no script errors |
| api S-*-1 (3 forms) | HTTP 200, saved, delivery team=sent, acknowledgement=sent |
| api S-*-2 | repeat, parallel and new-tab resubmits return the same reference (duplicate) |
| api S-*-3 | invalid input: HTTP 400, saved=false |
| api S-*-4 | spam field filled: HTTP 400 |
| api S-driver-5 (VIC) | HTTP 200; acknowledgement says DODO doesn't take trips in Victoria yet |
| api S-cors | other website: HTTP 403 |
| mailfail (3 forms) | HTTP 502, saved=true, ok=false, NOTIFICATION_FAILED (page shows amber "Saved, but not yet delivered") |
| recover (3 forms) | HTTP 200 with the SAME reference; both emails sent once; a further retry is a duplicate |
| spoof | 6th forged-address driver application refused (429). If accepted, report it: the site-wide limit still caps volume |
| <staging test inbox> | exactly one "[STAGING TEST]" email per reference: "New booking request DODO-…", "Website message DODO-MSG-…", "Driver application DODO-DRV-…"; Reply-To is the sender; booking emails show map pins or "not pinned" |
| <staging test inbox> (+tag) | exactly one acknowledgement per reference (none for mailfail until recover). Check Spam too |
| SQL printed by the kit | every reference: accepted_at set; with the webhook set up, latest_event = email.delivered |
Email delivery is reported PASS only when the message is actually in the inbox and the status row shows email.delivered.

## 7. Rollback (staging), in this order
1. SQL editor: `20261025140000_website_email_events_ROLLBACK.sql` (archives events, drops the log objects).
2. SQL editor: `20261025130000_..._ROLLBACK.sql` and/or `20261025120000_..._ROLLBACK.sql` (no rows deleted;
   new-column data archived; restores the previous access, including the old insecure public insert policy).
3. `supabase functions delete <name> --project-ref ziqwynsljjxlxuhjaeja` for each of the four functions.
4. `supabase secrets unset --project-ref ziqwynsljjxlxuhjaeja WEBSITE_FROM_EMAIL BOOKING_INBOX_EMAIL CONTACT_INBOX_EMAIL DRIVER_RECRUITMENT_INBOX_EMAIL ALLOWED_ORIGINS DODO_ENVIRONMENT RESEND_WEBHOOK_SECRET`
   (keep RESEND_API_KEY if the admin `send-admin-invitation` function uses it on staging). Delete the Resend webhook endpoint.
5. Test rows are named "ZZ STAGING TEST"; kept unless the owner approves deleting them on staging.

## 8. Production email configuration (separate; for later, with its own approval)
Production `gobsccsryhavpwqpiujz` is paused. Only after it is restored and contact@dodotransport.com.au receives mail:
production copies of the three migrations need production guards (see PRODUCTION-PLAN.md), then:
```
supabase secrets set --project-ref gobsccsryhavpwqpiujz WEBSITE_FROM_EMAIL="DODO Transport <noreply@dodotransport.com.au>" BOOKING_INBOX_EMAIL=contact@dodotransport.com.au CONTACT_INBOX_EMAIL=contact@dodotransport.com.au DRIVER_RECRUITMENT_INBOX_EMAIL=contact@dodotransport.com.au ALLOWED_ORIGINS=https://www.dodotransport.com.au,https://dodotransport.com.au DODO_ENVIRONMENT=production
```
Before go-live: `supabase secrets list --project-ref gobsccsryhavpwqpiujz` shows no staging values, and no gmail.com
address appears in production secrets or website files.
