# dodotransport.com.au: DNS, website hosting and business email checklist
Audited 25 Oct 2026 with read-only public lookups (resolvers 1.1.1.1, 8.8.8.8, 9.9.9.9, 208.67.222.222).
DNS host: GoDaddy (ns25/ns26.domaincontrol.com). NOTHING HAS BEEN CHANGED. Every change below needs owner approval.

## 1. Current records and findings
| Record | Current value | Finding |
|---|---|---|
| A @ | 185.199.108.153, .109.153, .110.153, .111.153 (GitHub Pages) **and 52.6.250.82** | 52.6.250.82 is an Amazon EC2 host (ec2-52-6-250-82.compute-1.amazonaws.com) running Caddy behind Cloudflare that serves a **famous.ai** page: "Upgrade Required. Upgrade now to host your site at this domain". It is a leftover from connecting the domain to famous.ai. |
| HTTPS on https://dodotransport.com.au | GitHub IPs: certificate name mismatch (no certificate for the bare domain). famous.ai IP: famous.ai page | Visitors to the bare domain get a certificate error about 4 times in 5 and the famous.ai upgrade page about 1 time in 5. GitHub Pages cannot issue a certificate for the bare domain while a non-GitHub A record exists. |
| CNAME www | maroas.github.io | Correct. https://www.dodotransport.com.au serves the live site (GitHub Pages, last modified 26 Jan 2026). |
| MX @ | 0 dodotransport-com-au.mail.protection.outlook.com | **Broken.** That host no longer exists (NXDOMAIN on all resolvers; control lookup of Microsoft's own host works). Microsoft's sign-in service reports the domain as "Unknown": not attached to any Microsoft 365 organisation. The tenant NETORG19606353.onmicrosoft.com (GoDaddy-provisioned) still exists. **Result: mail to contact@ (and admin@) cannot be delivered.** |
| TXT @ (SPF) | v=spf1 include:secureserver.net -all | Does not authorise Microsoft 365. Not used by Resend (Resend uses its own return-path subdomain). |
| TXT @ | NETORG19606353.onmicrosoft.com; google-site-verification=… | Leftover verification strings; harmless. |
| TXT _dmarc | v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net; | Fine. Reports go to GoDaddy's DMARC service. |
| TXT resend._domainkey | p=MIGfMA0… (Resend DKIM key, 218 chars) | Present. Whether it matches the key Resend expects is only visible in Resend -> Domains. |
| CNAME send (KEEP) | send.forge.rmta.net (that host publishes MX feedback.forge.rmta.net and SPF ip4:52.3.252.119 ip4:44.222.39.36 ip4:199.249.231.0/24 ~all) | **Not Resend's records** (Resend's are an amazonses MX and `include:amazonses.com` SPF). Owner of rmta.net unknown (possibly the same famous.ai setup). A CNAME blocks adding Resend's records at `send`. |
| selector1/selector2._domainkey | none | Microsoft 365 DKIM not enabled. |
| autodiscover | none | Outlook auto-configuration missing. |
| AAAA @ / CAA | none | Optional. |

## 2. Change A: website bare domain (fixes the certificate errors)
1. In famous.ai, disconnect dodotransport.com.au from any famous.ai project (so it does not re-add records).
2. GoDaddy DNS: delete **A @ 52.6.250.82** only. Keep the four 185.199.x.153 records. Optionally add GitHub's
   AAAA @ records 2606:50c0:8000::153, 2606:50c0:8001::153, 2606:50c0:8002::153, 2606:50c0:8003::153.
3. GitHub -> MAROAS/NewWebsite -> Settings -> Pages: custom domain stays www.dodotransport.com.au; wait until the
   certificate covers the bare domain, then tick "Enforce HTTPS".
Check: `nslookup dodotransport.com.au` shows only GitHub addresses; https://dodotransport.com.au redirects to www.
Effect on email: none (A records are not used for mail). Undo: re-add the A record.

## 3. Change B: restore business email (contact@, admin@) in Microsoft 365
1. GoDaddy -> My Products -> Email & Office: check the Microsoft 365 plan for dodotransport.com.au is **active**
   (renew it if it expired; mailbox data may be lost after the provider's retention period).
2. Microsoft 365 admin centre (admin.microsoft.com, signed in as the tenant's global admin) -> Settings -> Domains:
   dodotransport.com.au must be listed and **Healthy**. If missing, add it and verify it with the TXT value shown
   (MS=ms…). GoDaddy-managed plans usually do this from Email & Office -> "Set up / Fix DNS".
3. Exchange admin centre -> Recipients: contact@dodotransport.com.au (and admin@ if used for admin invitations)
   exists as a mailbox, shared mailbox or alias.
4. DNS records, copying exact values from Microsoft 365 admin -> Settings -> Domains -> dodotransport.com.au -> DNS records:
   - MX @ -> the value Microsoft shows (today's record points to dodotransport-com-au.mail.protection.outlook.com,
     which will resolve again once the domain is back; newer tenants may be given a *.mx.microsoft host instead), priority 0.
   - CNAME autodiscover -> autodiscover.outlook.com
   - TXT @ SPF: keep ONE SPF record: `v=spf1 include:spf.protection.outlook.com include:secureserver.net -all`
     (drop `include:secureserver.net` only if nothing at GoDaddy sends mail for the domain).
   - DKIM: CNAME selector1._domainkey and selector2._domainkey -> the values shown in Microsoft Defender ->
     Email authentication -> DKIM, then switch DKIM signing on there.
   - DMARC: keep as is.
5. Check: MX host resolves; https://login.microsoftonline.com/getuserrealm.srf?login=contact@dodotransport.com.au&json=1
   shows "Managed"; send a test from Gmail to contact@ and confirm it arrives.
Effect on the website and Resend: none. Undo: restore the previous TXT SPF value.

## 4. Change C: Resend sending (website forms and admin invitations)
Senders: website forms `noreply@dodotransport.com.au` (WEBSITE_FROM_EMAIL); admin invitations
`admin@dodotransport.com.au` (ADMIN_INVITATION_FROM_EMAIL). Both need dodotransport.com.au verified in Resend.
1. Resend -> Domains -> dodotransport.com.au: note the status of DKIM, SPF and MX.
2. If SPF/MX are not verified: because `send` is taken by another service, set a **custom return path** in Resend
   (Domains -> the domain -> Advanced / custom return path), for example `outbound`, then add exactly the two records
   Resend shows: MX `outbound` -> Resend's regional feedback host (priority 10) and TXT `outbound` -> Resend's SPF value.
   Copy the values from the dashboard; do not type them from memory.
3. If DKIM is not verified: replace TXT resend._domainkey with the value Resend shows.
4. Leave root MX, root SPF, DMARC, autodiscover and the `send` CNAME unchanged (Microsoft 365 is unaffected).
5. Bounce handling and delivery logs: add the webhook in the staging runbook, step 4. Events land in
   `website_email_events` and `website_email_delivery_status`. Resend's dashboard -> Emails also lists each send.
DMARC: Resend mail passes DMARC through its DKIM signature (d=dodotransport.com.au, relaxed alignment).

## 5. Optional later
- `send` CNAME (send.forge.rmta.net): **keep it.** Resend reports the domain verified and staging emails were delivered
  (25 Oct), so this record may be part of the working sending setup. Before any change, check in Resend -> Domains which
  records it verified.
- DMARC reports: add a rua address you actually read before tightening to p=reject.
- CAA: allow only the certificate authorities in use (GitHub Pages uses Let's Encrypt).
