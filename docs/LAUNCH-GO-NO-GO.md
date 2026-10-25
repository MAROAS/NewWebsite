# DODO Queensland launch: GO / NO-GO (25 Oct 2026)
Sources: this session's checks, `DODO_RC1_LAUNCH_READINESS_GO_NO_GO.md` (21 Oct) and the production security plan (20 Oct).

| Area | Verdict | Why / what clears it |
|---|---|---|
| Production Supabase connectivity | **NO-GO** | `gobsccsryhavpwqpiujz` is paused (does not resolve). Clear: restore it from a verified backup with the security fixes (open trip chats, open driver rows, non-MFA admin) applied in the same window. |
| Rider and Driver apps | **NO-GO** | RC1 passes on staging. Missing for production: production EAS build profiles (prod Supabase and Stripe keys), Android push (no FCM key), driver push while the app is closed, rider push function not deployed; Fix B phone test pending. |
| Six services bookable | **NO-GO (production)** | All six PASS physically on staging. Production lacks Step 45 and the launch eligibility flag. Clear: apply the RC1 production lineage incl. Step 45. Availability depends on approved QLD drivers/vehicles. |
| Production payments | **NO-GO** | Staging is Stripe test mode only. Live Stripe keys, live webhook and driver payout process (Connect or manual weekly payouts) not confirmed. No live charges until approved. |
| Driver eligibility, QLD compliance | **GO on staging / NO-GO production** | Eligibility gate, document review, expiry sweep and MFA admin pass on staging; not on production yet. Until migration 46 is applied, admins approve Queensland drivers only. |
| Website publication | **GO with forms closed** (the default) / NO-GO with forms open | Forms are closed by default and cannot open against production until `productionFormsVerified: true` is set after production form tests pass (gate tested 6/6). Old PHP mailers removed in the branch. Still needed before merge: legal approval; delete the famous.ai A record for HTTPS on the bare domain. |
| Website booking and email | **GO on staging / NO-GO production** | Staging: all forms, emails and inbox delivery PASS (25 Oct). Production still needs the restored backend, the website migrations (production copies ready, 5/5 local PASS), the 4 functions and production secrets, and a working contact@ inbox. |
| Privacy Policy and Terms | **NO-GO** | Need professional approval (Terms undated, no Driver Partner Terms, missing providers and website-form retention). |
