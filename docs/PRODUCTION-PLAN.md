# DODO production Supabase: restoration and migration plan (DRAFT, nothing executed)
Prepared 25 Oct 2026. Every step needs the owner's separate approval. No production SQL has been run.

## 1. Which project is production (repository audit, read-only)
| Evidence | Result |
|---|---|
| Local app configs (`New-app/*/.env`, `.env.local`) | Only two projects appear anywhere: `gobsccsryhavpwqpiujz` (in the main `.env` files of DODO, DODO-AdminDashboard, DriverDODO and older worktrees) and `ziqwynsljjxlxuhjaeja` (every `.env.local` and the release worktrees). No third project. |
| `DODO_RC1_LAUNCH_READINESS_GO_NO_GO.md` (21 Oct) and `DODO_PRODUCTION_SECURITY_REMEDIATION_PLAN.md` (20 Oct) | "Production (`gobsccsryhavpwqpiujz`) is paused." Public launch: NO-GO. |
| Website `app.js` | Points to `gobsccsryhavpwqpiujz` (production) by default. |
| Public DNS today | `gobsccsryhavpwqpiujz.supabase.co` does not resolve (consistent with a paused project). Staging resolves. |
Conclusion: the intended production project is `gobsccsryhavpwqpiujz`, currently paused. It is **not** assumed deleted.
DODO-Staging is not a substitute. No replacement project should be created. Owner to confirm in the Supabase
dashboard (Project -> General) that the project is "Paused" and that backups are listed.

## 2. Order of work (each line = separate approval)
1. **Confirm status** in the dashboard; download the latest backup (paused projects keep backups).
2. **Security first** (existing plan `DODO_PRODUCTION_SECURITY_REMEDIATION_PLAN.md`, steps 1–3): restore the backup
   locally, inspect production's own policies (open trip chats, open driver rows, non-MFA admin), generate the fix
   from production's rules, rehearse forward + rollback on the restored copy. Capture production's cluster id
   (P0) for the `__PRODUCTION_CLUSTER_ID__` guards.
3. **Unpause** only with every app build confirmed to point elsewhere, apply the security fix in the same window,
   re-run the anonymous exposure checks (expect 0).
4. **RC1 production lineage** (`supabase/production_lineage` in the admin release branch: 00 snapshot ... 45, 99 rollback),
   in manifest order, each with backup and approval. Includes:
   - **Step 45 – six services** (`45_20261023130000_launch_inclusive_six_services.sql`): activates DODO Priority, X,
     Economy, Comfort, BUSINESS and Premium (staging physical tests PASS 20 Oct). Not applied to production.
     Pricing, the 20% driver commission, tips and tolls are not changed by the website work.
5. **Website forms on production**: make production copies of the three website migrations with the production
   guard (refuse staging id 7678069749886157684; require P0 id) instead of the staging guard, rehearse on the
   restored copy, apply; deploy the four functions; set the production secrets (staging runbook section 8, inbox
   contact@dodotransport.com.au); add a production Resend webhook with its own secret.
6. **Website publication**: only after 5 passes and the domain/email fixes are done (see DNS checklist).

## 3. What stays blocked until then
- The public website's forms cannot save or email anything (production paused).
- Driver multi-state migration (46) has only been prepared for staging.
- No live Stripe charges, production bookings or production test submissions are made at any point without approval.
