# DODO Google Apps Script relays (source only; not part of the published website)

GitHub Pages does not publish this folder (`deploy` is excluded in `_config.yml`). The relays run in Google Apps Script
under DODO's Google account; the inbox address is that account and never appears in this code or on the website.

| Relay | File | Status (27 Oct 2026) |
|---|---|---|
| Driver application relay | `driver-application-relay/Code.gs` | **Live** (version `2026-10-27-mailapp`). Used by www.dodotransport.com.au/file0.html. Staging and live tests passed. |
| Booking and contact relay | `booking-relay/Code.gs` | **Staging verified** (version `booking-2026-10-27-mailapp`). Replaces the FormSubmit step of the live booking relay with Google MailApp; same URL when deployed as a new version of the existing deployment. |

Both send notifications with Google MailApp (no third-party form service), reply `ok` only after the email is accepted,
send one email per accepted request (script lock + 10-minute duplicate check) and contain no email address or secret.
Deploy only as a **new version of the existing deployment** (Deploy > Manage deployments > Edit > New version), so the
URL stays the same; roll back by selecting the previous version there.
