// DODO website "Contact us" messages: validate, save once, email DODO's inbox, acknowledge the sender.
//
// Secrets (Edge Function secrets, never in website JavaScript):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, ALLOWED_ORIGINS, DODO_ENVIRONMENT
//   CONTACT_INBOX_EMAIL   DODO's enquiries inbox, e.g. contact@dodotransport.com.au
//   CONTACT_FROM_EMAIL    verified Resend sender (falls back to WEBSITE_FROM_EMAIL)
//
// The acknowledgement never repeats the message text, so the form can't be used to send
// someone else arbitrary content from DODO's address.
import {
  createFormHandler, type Deps, type Rec, type EmailCtx, esc, htmlTable, textRows, stagingHtml, stagingText,
  brisbaneTime, PHONE_DISPLAY,
} from "../_shared/website-form.ts";

export function createHandler(deps: Deps) {
  return createFormHandler({
    name: "contact",
    fields: ["name", "email", "phone", "message"],
    inboxEnv: "CONTACT_INBOX_EMAIL",
    fromEnv: ["CONTACT_FROM_EMAIL", "WEBSITE_FROM_EMAIL"],
    submitFn: "website_submit_contact_message",
    submitArgs: (i, clientHash) => ({
      p_request_id: i.request_id,
      p_name: i.name,
      p_email: i.email,
      p_phone: i.phone,
      p_message: i.message,
      p_client_hash: clientHash,
    }),
    recordFn: "website_record_contact_email",
    kinds: { team: "team", ack: "ack" },
    flags: { team: "team_notified", ack: "ack_sent" },
    referenceKey: "reference",
    idempotencyPrefix: "website-contact",
    teamEmail: (m, ctx) => ({
      reply_to: String(m.email),
      subject: `${ctx.tag}Website message ${m.reference} from ${m.name}`,
      text: [
        stagingText(ctx.staging),
        "New message from the DODO website contact form.",
        "",
        ...textRows(rows(m)),
        "",
        "Message:",
        String(m.message),
        "",
        `Received: ${brisbaneTime(m.created_at)}`,
        "Reply to this email to answer the sender.",
      ].join("\n"),
      html: `${stagingHtml(ctx.staging)}
<p style="font:14px Arial,sans-serif">New message from the DODO website contact form.</p>
${htmlTable([...rows(m), ["Message", String(m.message)]])}
<p style="font:13px Arial,sans-serif;color:#555">Received: ${esc(brisbaneTime(m.created_at))}. Reply to this email to answer the sender.</p>`,
    }),
    ackTo: (m) => String(m.email),
    ackEmail: (m, ctx) => ({
      subject: `${ctx.tag}We've received your message (${m.reference})`,
      text: [
        stagingText(ctx.staging),
        `Hi ${m.name},`,
        "",
        `Thanks for contacting DODO Transport. We've received your message (reference ${m.reference}).`,
        "Our team will reply to this email address as soon as we can.",
        "",
        `If it's urgent, call us on ${PHONE_DISPLAY}. If you didn't send this message, you can ignore this email.`,
        "DODO Transport",
      ].join("\n"),
      html: `${stagingHtml(ctx.staging)}
<div style="font:14px/1.5 Arial,sans-serif">
<p>Hi ${esc(m.name)},</p>
<p>Thanks for contacting DODO Transport. We've received your message (reference <b>${esc(m.reference)}</b>).
Our team will reply to this email address as soon as we can.</p>
<p>If it's urgent, call us on ${PHONE_DISPLAY}. If you didn't send this message, you can ignore this email.<br>DODO Transport</p>
</div>`,
    }),
  }, deps);
}

function rows(m: Rec): [string, string][] {
  return [
    ["Reference", String(m.reference)],
    ["Name", String(m.name)],
    ["Email", String(m.email)],
    ["Phone", m.phone ? String(m.phone) : "(not given)"],
  ];
}
