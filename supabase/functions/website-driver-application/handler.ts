// DODO website driver applications: validate, save once, email DODO recruitment, acknowledge the applicant.
//
// Secrets (Edge Function secrets, never in website JavaScript):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, ALLOWED_ORIGINS, DODO_ENVIRONMENT
//   DRIVER_RECRUITMENT_INBOX_EMAIL   DODO's recruitment inbox (owner to confirm the address)
//   DRIVER_FROM_EMAIL                verified Resend sender (falls back to WEBSITE_FROM_EMAIL)
//
// Documents: this endpoint accepts no files (10 KB limit) and its emails carry no documents,
// licence numbers or links to them. Licences, accreditation and vehicle documents are uploaded in
// the DODO Driver app to the private "driver-documents" storage bucket, where only the driver and
// MFA-verified admins can open them.
//
// Applying is not approval. The state chosen is where the applicant wants to drive; only
// Queensland takes trips today, and every state still needs DODO's separate approval.
import {
  createFormHandler, type Deps, type Rec, type EmailCtx, esc, htmlTable, textRows, stagingHtml, stagingText,
  brisbaneTime, PHONE_DISPLAY,
} from "../_shared/website-form.ts";

export const STATES: Record<string, string> = {
  QLD: "Queensland", NSW: "New South Wales", VIC: "Victoria", WA: "Western Australia",
  SA: "South Australia", ACT: "Australian Capital Territory", TAS: "Tasmania", NT: "Northern Territory",
};

const stateLine = (code: string) =>
  code === "QLD"
    ? "Queensland (QLD): DODO takes trips here. The applicant still needs DODO's approval before driving."
    : `${STATES[code] ?? code} (${code}): registration only. DODO does not take trips in this state yet, so the applicant cannot accept trips.`;

export function createHandler(deps: Deps) {
  return createFormHandler({
    name: "driver_application",
    fields: ["full_name", "email", "phone", "state", "home_state", "license_length", "has_abn", "vehicle_details"],
    inboxEnv: "DRIVER_RECRUITMENT_INBOX_EMAIL",
    fromEnv: ["DRIVER_FROM_EMAIL", "WEBSITE_FROM_EMAIL"],
    submitFn: "website_submit_driver_application",
    submitArgs: (i, clientHash) => ({
      p_request_id: i.request_id,
      p_full_name: i.full_name,
      p_email: i.email,
      p_phone: i.phone,
      p_state: i.state,
      p_license_length: i.license_length,
      p_has_abn: i.has_abn,
      p_vehicle_details: i.vehicle_details,
      p_client_hash: clientHash,
      p_home_state: i.home_state,
    }),
    recordFn: "website_record_driver_application_email",
    kinds: { team: "team", ack: "ack" },
    flags: { team: "team_notified", ack: "ack_sent" },
    referenceKey: "reference",
    idempotencyPrefix: "website-driver",
    teamEmail: (a, ctx) => ({
      reply_to: String(a.email),
      subject: `${ctx.tag}Driver application ${a.reference}: ${a.full_name} (${a.state})`,
      text: [
        stagingText(ctx.staging),
        "New driver application from the DODO website.",
        "",
        ...textRows(rows(a)),
        "",
        `Received: ${brisbaneTime(a.created_at)}`,
        "No documents are attached, by design. The applicant uploads licences, accreditation and vehicle",
        "documents in the DODO Driver app; review them in the DODO admin dashboard.",
        "This application is not an approval for any state.",
      ].join("\n"),
      html: `${stagingHtml(ctx.staging)}
<p style="font:14px Arial,sans-serif">New driver application from the DODO website.</p>
${htmlTable(rows(a))}
<p style="font:13px Arial,sans-serif;color:#555">Received: ${esc(brisbaneTime(a.created_at))}.<br>
No documents are attached, by design. The applicant uploads licences, accreditation and vehicle documents in the DODO Driver app; review them in the DODO admin dashboard.<br>
This application is not an approval for any state.</p>`,
    }),
    ackTo: (a) => String(a.email),
    ackEmail: (a, ctx) => {
      const code = String(a.state);
      const where = code === "QLD"
        ? "DODO takes trips in Queensland. Before you can drive, we need to check your documents and approve your account."
        : `DODO doesn't take trips in ${STATES[code] ?? code} yet. You can register now, but you won't be able to accept trips there until DODO is approved to operate in ${STATES[code] ?? code} and has approved you for it.`;
      return {
        subject: `${ctx.tag}We've received your DODO driver application (${a.reference})`,
        text: [
          stagingText(ctx.staging),
          `Hi ${a.full_name},`,
          "",
          `Thanks for applying to drive with DODO Transport. We've received your application (reference ${a.reference}).`,
          "",
          "This isn't an approval yet. " + where,
          "",
          "Next step: we'll contact you about uploading your documents securely in the DODO Driver app.",
          "Please don't email copies of your licence, accreditation or other documents to us.",
          "",
          `Questions? Reply to this email or call us on ${PHONE_DISPLAY}.`,
          "DODO Transport",
        ].join("\n"),
        html: `${stagingHtml(ctx.staging)}
<div style="font:14px/1.5 Arial,sans-serif">
<p>Hi ${esc(a.full_name)},</p>
<p>Thanks for applying to drive with DODO Transport. We've received your application (reference <b>${esc(a.reference)}</b>).</p>
<p><b>This isn't an approval yet.</b> ${esc(where)}</p>
<p>Next step: we'll contact you about uploading your documents securely in the DODO Driver app.
Please don't email copies of your licence, accreditation or other documents to us.</p>
<p>Questions? Reply to this email or call us on ${PHONE_DISPLAY}.<br>DODO Transport</p>
</div>`,
      };
    },
  }, deps);
}

function rows(a: Rec): [string, string][] {
  return [
    ["Reference", String(a.reference)],
    ["Full name", String(a.full_name)],
    ["Email", String(a.email)],
    ["Phone", String(a.phone)],
    ["State they want to drive in", stateLine(String(a.state))],
    ["State they live in", `${STATES[String(a.home_state)] ?? a.home_state} (${a.home_state}). For information only: where an applicant lives is not an approval to drive there.`],
    ["Licence held for", a.license_length ? String(a.license_length) : "(not given)"],
    ["Has an ABN", a.has_abn === true ? "Yes" : "No"],
    ["Vehicle details", a.vehicle_details ? String(a.vehicle_details) : "(not given)"],
  ];
}
