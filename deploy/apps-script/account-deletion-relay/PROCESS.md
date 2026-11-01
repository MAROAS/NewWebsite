# DODO account deletion: secure manual process (DRAFT, needs owner and legal approval)

Version 1 November 2026. **Not published:** GitHub Pages doesn't serve the `deploy` folder. This is an internal staff runbook.

> **Status: the process can't yet reliably meet the 30-day commitment.** Steps marked **NO TOOL** must be built and
> tested on staging before DODO relies on them. See "Can DODO meet 30 days?" at the end.

## Golden rules
1. **A request is never acted on automatically.** The website relay and the in-app button only record it; staff act by hand.
2. **Never use Supabase → Authentication → Users → "Delete user"** for a DODO account. Never delete rows from `drivers`, `riders` or `rides` either. Deleting cascades automatically, as checked on staging on 1 Nov 2026:

   | If you delete… | Postgres also deletes, without warning |
   |---|---|
   | the **Supabase Auth user** | the `drivers` or `riders` row, and everything below |
   | a **`drivers`** row | `driver_earnings`, `driver_payouts`, `driver_documents`, `driver_vehicles`, `driver_verification_reviews`, `driver_notifications` |
   | a **`riders`** row | `rider_payment_methods`, `rider_saved_places` |

   **Driver earnings and payouts are financial records that must be kept for 7 years.** Deleting a driver's Auth user destroys them. Deleting a user who reported a road hazard fails partway.
3. **De-identify; don't delete,** while any record must be kept. Delete a whole account only after every retention period has ended.
4. **Customer-facing contact uses DODO's business identity only:**
   - the in-app **DODO Support** chat;
   - DODO's phone line **0415 152 099**;
   - email from a **@dodotransport.com.au** address. That mailbox is currently down; see the blockers.
   - **Never** email a customer from a personal Gmail account, including by replying to a relay notification email.
5. **Least access:**
   - Only a DODO director, or an admin a director authorises, may process deletions. They must use an MFA admin account.
   - Production edits are made one account at a time. No bulk scripts.
6. **Never ask for** a password, one-time code, card number or identity document.

## 1. Intake (day 0)
| Channel | Where it arrives | Reference |
|---|---|---|
| In-app (Rider: Account → Delete Account; Driver: Profile → App Settings → Delete Account) | Admin dashboard support inbox, as a message starting `[ACCOUNT DELETION REQUEST]` with the user ID, name, email, phone and time. The user is signed out. | The support chat ID |
| Website form (once the relay is live) | An email in the relay's Google account, plus a row in the private Sheet "DODO account deletion requests" | `DEL-yyyymmdd-XXXXXX` |
| Phone | Staff take the call | `DEL-yyyymmdd-PHONE-n` |

- **Every request gets a row in the private Sheet,** whatever the channel. Add in-app and phone requests by hand.
- **The Sheet is the deletion register.** Don't share it, and don't move it to a shared drive.
- **Day 0 is the day the request arrives,** not the day it's verified.

## 2. Identity verification
- **In-app requests:** already verified. They came from the signed-in account, and the request contains the user ID.
- **Website and phone requests:** the typed details aren't proof.
  1. Find the account in the Admin dashboard by email or phone.
  2. If nothing matches, record "No matching account" and don't tell the requester, which prevents account enumeration.
     - Reply only with the neutral message: *"If this matches a DODO account, we'll contact you through the details on that account."*
  3. Contact the holder **only through the details already held in the account:**
     - the in-app support chat (the user signs in and confirms);
     - a call to the account's phone number;
     - or, once the business mailbox works, an email from @dodotransport.com.au to the account's email.
  4. Ask them to confirm they want the account deleted. Record who verified it, how and when.
  5. No confirmation within 30 days of contact: close it as "Not verified". Nothing is changed.

## 3. Pre-checks (before changing anything)
Look up the account in the Admin dashboard and check:
- **Active or scheduled trips:** `rides` for this rider_id or driver_id in any status other than completed or cancelled.
- **Money owed in either direction:**
  - unpaid or failed fares (`rides.payment_status`);
  - pending refunds (`stripe_refunds`);
  - fare adjustments in progress (`fare_adjustments`);
  - Driver earnings not yet paid out (`driver_earnings.lifetime_earnings` minus `lifetime_paid_out`, and `driver_payouts.status`).
- **Open matters:** support chats, complaints, safety incidents, possible fraud, police or legal requests.
- **Anything open:** tell the holder through DODO Support, resolve it first, and note the reason in the register. A legal hold pauses deletion.

## 4. Block access (as soon as verified)
- **Driver:**
  - Admin dashboard → driver → **Account status → Suspended**, reason `Account deletion request <reference>`.
  - The server function `admin_set_driver_account_status` writes an `admin_audit_logs` row and takes the driver offline.
- **Rider:** **NO TOOL.** There's no rider suspend or ban control.
  - Needed: an MFA-admin server function that bans the Auth user (Supabase Auth admin `ban_duration`) and writes `admin_audit_logs`.

## 5. Delete or de-identify
Column names were taken from staging (read-only, 1 Nov 2026). **Confirm production matches** with the read-only query at the end before the first real deletion.
- **Who and how:** an authorised MFA admin, one account at a time.
- **Tool:** **NO TOOL.** Today this would mean hand edits in the Supabase Table Editor on production. It needs a reviewed, staging-tested admin function that also writes the audit log.

**Supabase Auth (`auth.users`): email, phone, user metadata**
- **Retention:** the login identity holds no records the law requires, but deleting it cascades (rule 2).
- **Action:**
  - **Remove the sign-in identifiers:** replace the email with `deleted+<user id>@invalid` and clear the phone. Clear `raw_user_meta_data`, ban the user and sign them out everywhere.
  - **Delete the Auth user only after the driver's financial records are past 7 years,** or after the cascade is changed.
  - **NO TOOL.**

**Rider (`riders`)**
- **Retention:** no retention need for contact details.
- **Action:**
  - De-identify: `full_name` → `Deleted rider`. Clear `email`, `phone`, `profile_photo_url`, `home_address`, `work_address`, `push_token` and `preferred_payment_method`.
  - **Keep the row,** because trips reference the rider ID.

**Rider (`rider_saved_places`, `rider_payment_methods`)**
- **Retention:** none.
- **Action:**
  - Delete the rows.
  - In Stripe, detach the saved cards from the customer (`riders.stripe_customer_id`) once no payment or refund is pending.
  - Keep the Stripe customer itself, because past payments reference it.

**Driver (`drivers`)**
- **Retention:** Queensland law requires the driver's name, driver authorisation number and the dates they started and stopped driving for **2 years after they stop**.
- **Action:**
  - **Keep:** `full_name` and the row.
  - **Clear:** `email`, `phone`, `profile_photo_url`, `expo_push_token`, `push_token`, `lat`/`lng`/`location` and the location timestamps. Set `is_available` to false.
  - **Legal to confirm:** whether `licence_number` must be kept. The law names the authorisation number, which is stored separately.

**Driver (`driver_authorisations`, `driver_work_periods`)**
- **Retention:** 2 years after the driver stops.
- **Action:** keep, then delete when the period ends.

**Driver (`driver_earnings`, `driver_payouts`)**
- **Retention:** financial records, **7 years** after the transaction.
- **Action:**
  - **Keep, unchanged.**
  - Close the Stripe Connect account (`drivers.stripe_account_id`) only after the final payout has settled.

**Driver (`driver_documents` and files in the private `driver-documents` storage bucket)**
- **Retention:** legal to confirm which documents evidence the required driver record.
- **Action:**
  - Delete files that aren't required. Keep any that are for 2 years after the driver stops, then delete them.
  - **Edit the rows; never delete them,** because deleting is also blocked by the cascade rules.

**Driver (`driver_vehicles`)**
- **Retention:** the plate also appears in trip records.
- **Action:**
  - Delete the vehicle photo files (`photo_*_path`) from storage and clear those paths.
  - Keep make, model and plate while trip records are kept.

**Driver (`driver_locations`, `driver_presence`, `driver_notifications`)**
- **Retention:** none.
- **Action:** delete the rows.

**Driver (`legal_document_acceptances`)**
- **Retention:** evidence that the Terms were accepted.
- **Action:** keep. It doesn't affect anyone else.

**Trips (`rides`, `ride_driver_assignments`, `trip_request_push_log`)**
- **Retention:**
  - booking and trip records: at least **2 years** after the trip;
  - payment fields (`price`, fees, tolls, tips, Stripe IDs): **7 years**.
- **Action:**
  - Keep them as they are during the period. Clear only the temporary masked numbers (`rider_proxy_number`, `driver_proxy_number`).
  - After 2 years, de-identify the names, phone, avatar, addresses, coordinates and route. Keep the amounts until 7 years.
  - **Don't use** the unused `delete-account` server function. It wipes trip addresses immediately, against the 2-year rule.

**Messages (`ride_messages`, `trip_messages`)**
- **Retention:** the Privacy Policy says they're kept for support and safety, and no period has been set.
- **Action:** **owner and legal decision:** set a period, then delete.

**Support (`support_chats`, `support_messages`)**
- **Retention:** the deletion request itself is the evidence. Privacy complaints are kept 2 years.
- **Action:** keep the deletion request thread. Delete other general chats after 12 months, as the policy says for enquiries.

**Website forms (`booking_requests`, `contact_messages`, `driver_applications`)**
- **Retention:**
  - booking requests: 2 years;
  - enquiries: 12 months;
  - driver applications: no period set.
- **Action:** search by the account's email. Delete what is past its period.

**Old backup (`phase1_driver_status_backup_20260925083500`)**
- **Retention:** none. It holds driver names.
- **Action:** ask the owner whether to drop it, as a separate approved change.

**Relay email and the Sheet row**
- **Retention:** the register is the audit trail.
- **Action:**
  - Keep the register row. Delete the relay's notification email once it's recorded.
  - Keep register rows for 2 years after closing, the same as privacy complaints.

## 6. Confirmation to the account holder
- **When:** once step 5 is done for everything that isn't retained.
- **How:** through DODO Support, either the in-app chat while the account is still signed in, a call to the account's phone, or an email from @dodotransport.com.au.
- **Say:**
  - the reference;
  - that the account is closed and can no longer be used;
  - what was deleted or de-identified;
  - which records are kept, why, and until when;
  - who to contact with questions (0415 152 099) and the OAIC.
- **Never confirm** a deletion before it is done.

## 7. Audit logging
- **The private Sheet (deletion register):** one row per request, recording:
  - the received date;
  - the verifier and method;
  - the pre-check result;
  - the date access was blocked;
  - each step done;
  - the date the confirmation was sent;
  - what is retained, and its end dates.
- **`admin_audit_logs` (production):**
  - The driver suspension in step 4 writes this automatically.
  - Steps 4 (rider) and 5 have **NO TOOL** that writes it.
  - **Don't insert audit rows by hand.** The admin functions that will do step 5 must write them, with action names such as `account.deletion.deidentify`, target type and ID, the reference and admin name.
- **Every 6 months:** list retained records whose period has ended and delete them. This isn't automated, as the Privacy Policy says.

## Can DODO meet 30 days? (assessed 1 Nov 2026)
| Step | Tool | Tested | Fits in 30 days? |
|---|---|---|---|
| Intake: in-app | Yes (support inbox) | App unit tests pass. Not tested on a device | Yes |
| Intake: website form | Relay ready, **not deployed** | Simulated only | Once deployed |
| Intake: phone | Yes | n/a | Yes |
| Verification | In-app chat and phone. **The business mailbox doesn't work** | n/a | Yes for in-app; slower for web and phone |
| Pre-checks | Admin dashboard (read) | n/a | Yes |
| Block access: driver | Yes (account status + audit log) | Used in production | Yes |
| Block access: rider | **NO TOOL** | No | **No** |
| De-identify Auth and profile data | **NO TOOL** (hand edits only) | No | **No (not reliably or safely)** |
| Delete storage files | Supabase Storage dashboard | No | Possible, but untested |
| Audit log of step 5 | **NO TOOL** (Sheet only) | No | Partial |
| Confirmation | In-app chat and phone | n/a | Yes |

**Result:** the 30-day commitment already made in both apps **can't yet be met reliably**. To meet it, DODO needs:
1. **An admin "close account" function:**
   - covers the Auth ban and identifier removal and the profile de-identification above;
   - MFA admin only;
   - one account at a time;
   - writes `admin_audit_logs`;
   - never deletes financial, trip or driver-record rows.
   - **Testing:** first on staging with test accounts, then reviewed and approved for production.
2. **A rider suspend control,** or include rider suspension in function 1.
3. **A working @dodotransport.com.au mailbox** for verification and confirmation emails.
4. **Legal decisions on:** licence number and document retention, the trip message period, and the driver application period.

## Read-only check to run on production before the first real deletion (schema only; no rows)
```sql
BEGIN TRANSACTION READ ONLY;
SELECT c.conrelid::regclass AS referencing_table, c.confrelid::regclass AS referenced_table,
       CASE c.confdeltype WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' END AS on_delete
FROM pg_constraint c
WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
  AND (c.confrelid = 'auth.users'::regclass OR c.confrelid::regclass::text IN ('drivers', 'riders', 'rides'))
ORDER BY 2, 3, 1;
ROLLBACK;
```
Expected (staging, 1 Nov 2026):
- `drivers` and `riders` CASCADE from `auth.users`;
- `driver_earnings`, `driver_payouts`, `driver_documents`, `driver_vehicles`, `driver_verification_reviews` and `driver_notifications` CASCADE from `drivers`;
- `rider_payment_methods` and `rider_saved_places` CASCADE from `riders`;
- `road_hazards` NO ACTION.
