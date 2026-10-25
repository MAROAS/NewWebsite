# DODO website: legal and privacy readiness review (for professional review; nothing published)
Reviewed 25 Oct 2026: `privacy.html` (Version 1, last updated 15 Oct 2026) and `terms.html` (no version or date).
This is a gap list, not legal advice. **No legal page has been changed.** Proposed additions need a lawyer's approval.

| Item | Current page | Finding | Needs |
|---|---|---|---|
| Company and contact details | Both pages: DODO Transport Pty Ltd, ABN 37 690 944 177, contact@dodotransport.com.au, 0415 152 099 | Correct details, but **contact@ cannot receive email today** (see DNS checklist). Privacy requests and complaints sent there bounce, which undermines APP 1 complaint handling. | Fix email first (no wording change needed) |
| Privacy Policy version | Version 1, 15 Oct 2026 | v2 drafts elsewhere are marked "NOT APPROVED – DO NOT PUBLISH"; untouched. | Professional approval of whichever version goes live |
| Terms and Conditions | No version or effective date | Undated terms are hard to enforce and to change. | Add version and date (lawyer) |
| Driver Partner Terms | None as a separate document; Terms say drivers are "independent contractors" | No driver-specific agreement (fees, the 20% commission, payouts, tips and tolls, insurance, compliance documents, state eligibility, deactivation). | Separate Driver Partner Terms (lawyer) |
| Service providers and overseas disclosure | Lists Supabase, Stripe, Twilio, Google Maps; mentions US processing (APP 8) | Missing: **Resend** (sends form emails, US), **Microsoft 365** (DODO inbox), **OpenStreetMap / Nominatim / OpenFreeMap** (map tiles and address lookups receive map positions and the visitor's IP). | Add providers (lawyer) |
| Website form data | Policy covers "website", "apply as a Driver", "contact support" generally | Not described: what the three forms collect (incl. booking map coordinates, driver home and operating state), that copies go by email to DODO's inbox, and the acknowledgement email. | Add a "Website forms" paragraph (lawyer) |
| Booking request retention | General "as long as necessary" | No period for website booking requests, messages and applications. Suggested for decision: 24 months, or shorter if not converted. | Decide period; add to policy |
| Abuse-prevention records | IP address mentioned for app diagnostics only | The forms store a keyed hash of the visitor's IP (not the IP) for rate limiting; email delivery events (type, time, bounce reason with addresses removed) are logged. Suggested retention: 180 days (`website_purge_email_events(180)` exists, not scheduled). | Add to policy; decide retention |
| Account and data deletion | Sections 24–27 cover access, correction and account deletion | Covers app accounts. Website submissions (no account) need a deletion route too: email or phone request to DODO. | Add one sentence (lawyer) |
| Location data | Mentioned (10 matches) | Booking map pins are stored only if the rider uses the map; typing the address stores none. | Mention in the website forms paragraph |
| Multi-state drivers | Not covered | Where an applicant lives is recorded for context and is never an approval to operate; only QLD takes trips. | Optional sentence in Driver Terms |

Proposed wording for the lawyer to review (not published):
> **Website forms.** When you use the pre-booking, contact or driver application forms on our website, we collect the
> details you enter (and, for bookings, the map location of your pickup and destination if you choose them on the map).
> We store them in our database hosted by Supabase, email a copy to DODO's team inbox (Microsoft 365) and send you an
> acknowledgement by email through our email provider Resend, which may process data in the United States. To prevent
> spam and abuse we keep a one-way coded version of your device's IP address with your submission; we do not store the
> address itself. We keep website submissions for [24 months] and email delivery records for [180 days], unless a law
> requires longer. To ask us to access, correct or delete a submission, contact us at contact@dodotransport.com.au or
> 0415 152 099.
