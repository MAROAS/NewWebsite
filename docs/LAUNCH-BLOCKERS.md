# DODO website: remaining blockers and approval steps (25 Oct 2026)

## Blockers
| # | Blocker | Owner action | Detail |
|---|---|---|---|
| 1 | contact@dodotransport.com.au cannot receive email (domain no longer attached to Microsoft 365; MX host does not exist) | Repair in GoDaddy / Microsoft 365 | DNS-AND-EMAIL-CHECKLIST.md, change B |
| 2 | ~~Resend domain~~ **DONE**: dodotransport.com.au verified; staging emails delivered | None | |
| 3 | Bare domain HTTPS fails (famous.ai A record 52.6.250.82) | Approve deleting that one A record; disconnect famous.ai | Checklist, change A |
| 4 | Production Supabase `gobsccsryhavpwqpiujz` paused; security fixes, RC1 lineage incl. Step 45 and the website migrations not applied there | Approve each production step | PRODUCTION-PLAN.md |
| 5 | ~~Staging deployment~~ **DONE 25 Oct**: migrations, 4 functions, secrets; all staging tests and inbox delivery PASS | None | TEST-RESULTS.md |
| 6 | Website source of truth: the GitHub Pages repo MAROAS/NewWebsite `main` is the January site; branch `website/redesign-launch` is an Oct 12 marketing redesign with an uncommitted `index.html` | Choose which site to publish | README.md, "Publication" |
| 7 | Legal: Terms undated; no Driver Partner Terms; Privacy Policy lacks Resend, Microsoft 365, OpenStreetMap, website-form retention and abuse records; v2 drafts unapproved | Lawyer review | LEGAL-REVIEW.md |
| 8 | States other than QLD: requirements not verified (NSW "PTLC" conflict) | Regulatory confirmation before any state opens | STATE-REQUIREMENTS-SOURCES.md |
| 9 | Driver and Admin apps: screens for multi-state status and admin state review not built (migration 46 staging-only) | Separate app work | Earlier multi-state plan |

## Approval steps, in order
1. Staging: install the Supabase CLI and log in (owner), confirm project identity (runbook P4).
2. Staging: apply migrations 20261025120000, 20261025130000, 20261025140000 (runbook stage 1).
3. Staging: deploy the four functions with `--no-verify-jwt`; set the secrets (<staging test inbox> inboxes); add the Resend webhook (stages 2–4).
4. Staging: run the test kit (stage 6); confirm emails in <staging test inbox> and <owner inbox>.
5. DNS change A (bare domain), change B (Microsoft 365), change C (Resend), each separately.
6. Production: the plan in PRODUCTION-PLAN.md, step by step.
7. Publication: commit the site to a new branch of MAROAS/NewWebsite, review, then merge (README).
