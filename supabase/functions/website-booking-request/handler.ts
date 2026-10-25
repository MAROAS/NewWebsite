// DODO website pre-booking requests: validate, save once, notify DODO, acknowledge the rider.
//
// Secrets (Edge Function secrets, never in website JavaScript):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, ALLOWED_ORIGINS, DODO_ENVIRONMENT
//   BOOKING_INBOX_EMAIL   DODO's booking inbox, e.g. bookings@dodotransport.com.au
//   BOOKING_FROM_EMAIL    verified Resend sender (falls back to WEBSITE_FROM_EMAIL)
//
// The shared flow (save first, then DODO's email, then the rider's) is in ../_shared/website-form.ts.
import {
  createFormHandler, type Deps, type Rec, type EmailCtx, esc, htmlTable, textRows, stagingHtml, stagingText,
  brisbaneTime, PHONE_DISPLAY,
} from "../_shared/website-form.ts";

export type { Deps };

export function createHandler(deps: Deps) {
  return createFormHandler({
    name: "booking",
    fields: ["name", "email", "phone", "service", "pickup_address", "destination", "travel_date", "travel_time",
      "pickup_lat", "pickup_lng", "destination_lat", "destination_lng"],
    inboxEnv: "BOOKING_INBOX_EMAIL",
    fromEnv: ["BOOKING_FROM_EMAIL", "WEBSITE_FROM_EMAIL"],
    submitFn: "website_submit_booking_request",
    submitArgs: (i, clientHash) => ({
      p_request_id: i.request_id,
      p_name: i.name,
      p_email: i.email,
      p_phone: i.phone,
      p_service: i.service,
      p_pickup_address: i.pickup_address,
      p_destination: i.destination,
      p_travel_date: i.travel_date,
      p_travel_time: i.travel_time,
      p_client_hash: clientHash,
      p_pickup_lat: i.pickup_lat,
      p_pickup_lng: i.pickup_lng,
      p_destination_lat: i.destination_lat,
      p_destination_lng: i.destination_lng,
    }),
    recordFn: "website_record_booking_email",
    kinds: { team: "dodo", ack: "rider" },
    flags: { team: "dodo_notified", ack: "rider_acknowledged" },
    referenceKey: "booking_reference",
    idempotencyPrefix: "website-booking",
    teamEmail: (b, ctx) => {
      const when = formatWhen(String(b.travel_date), String(b.travel_time));
      return {
        reply_to: String(b.email),
        subject: `${ctx.tag}New booking request ${b.booking_reference}: ${b.service}, ${when.short}`,
        text: dodoText(b, when.long, ctx),
        html: dodoHtml(b, when.long, ctx),
      };
    },
    ackTo: (b) => String(b.email),
    ackEmail: (b, ctx) => {
      const when = formatWhen(String(b.travel_date), String(b.travel_time));
      return {
        subject: `${ctx.tag}We've received your DODO booking request (${b.booking_reference})`,
        text: riderText(b, when.long, ctx),
        html: riderHtml(b, when.long, ctx),
      };
    },
    // Kept for the website's existing booking messages.
    extraResponse: (b, d) => ({ booking_reference: b.booking_reference, acknowledgement_sent: d.acknowledgement === "sent" }),
  }, deps);
}

// ---------------------------------------------------------------- formatting
export function formatWhen(date: string, time: string) {
  // Bookings are in Queensland time (Australia/Brisbane, UTC+10, no daylight saving).
  const d = new Date(`${date}T${time.slice(0, 5)}:00+10:00`);
  const opts = { timeZone: "Australia/Brisbane" } as const;
  const day = d.toLocaleDateString("en-AU", { ...opts, weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const shortDay = d.toLocaleDateString("en-AU", { ...opts, weekday: "short", day: "numeric", month: "short" });
  const t = d.toLocaleTimeString("en-AU", { ...opts, hour: "numeric", minute: "2-digit", hour12: true });
  return {
    long: `${day}, ${t} AEST (Queensland time, UTC+10)`,
    short: `${shortDay} ${t}`,
  };
}

function rows(b: Rec, when: string): [string, string][] {
  return [
    ["Booking reference", String(b.booking_reference)],
    ["Rider name", String(b.name)],
    ["DODO service", String(b.service)],
    ["Pickup address", String(b.pickup_address)],
    ["Destination", String(b.destination)],
    ["Requested date and time", when],
    ["Rider email", String(b.email)],
    ["Rider phone", String(b.phone)],
  ];
}

// Map pins chosen on the website (optional). Shown to DODO only, never in the rider's email.
const pin = (lat: unknown, lng: unknown) =>
  lat !== null && lat !== undefined && lng !== null && lng !== undefined
    ? `${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)} (https://www.google.com/maps?q=${Number(lat).toFixed(6)},${Number(lng).toFixed(6)})`
    : "not pinned (typed address only)";
function pinRows(b: Rec): [string, string][] {
  return [
    ["Pickup map pin", pin(b.pickup_lat, b.pickup_lng)],
    ["Destination map pin", pin(b.destination_lat, b.destination_lng)],
  ];
}

function dodoText(b: Rec, when: string, ctx: EmailCtx) {
  return [
    stagingText(ctx.staging),
    "New pre-booking request from the DODO website.",
    "",
    ...textRows(rows(b, when)),
    ...textRows(pinRows(b)),
    "",
    `Received: ${brisbaneTime(b.created_at)}`,
    "No driver has been assigned. Reply to this email to contact the rider.",
  ].join("\n");
}

function dodoHtml(b: Rec, when: string, ctx: EmailCtx) {
  return `${stagingHtml(ctx.staging)}
<p style="font:14px Arial,sans-serif">New pre-booking request from the DODO website.</p>
${htmlTable([...rows(b, when), ...pinRows(b)])}
<p style="font:13px Arial,sans-serif;color:#555">Received: ${esc(brisbaneTime(b.created_at))}. No driver has been assigned. Reply to this email to contact the rider.</p>`;
}

function riderRows(b: Rec, when: string): [string, string][] {
  return rows(b, when).filter(([k]) => k !== "Rider email" && k !== "Rider phone" && k !== "Rider name");
}

function riderText(b: Rec, when: string, ctx: EmailCtx) {
  return [
    stagingText(ctx.staging),
    `Hi ${b.name},`,
    "",
    "Thanks for your booking request. DODO Transport has received it.",
    "",
    "This is a request only. A driver has not been assigned yet, and your ride is not confirmed.",
    "Our team will contact you to confirm. If your plans change, just reply to this email.",
    "",
    ...textRows(riderRows(b, when)),
    "",
    `Questions? Call us on ${PHONE_DISPLAY}.`,
    "DODO Transport",
  ].join("\n");
}

function riderHtml(b: Rec, when: string, ctx: EmailCtx) {
  return `${stagingHtml(ctx.staging)}
<div style="font:14px/1.5 Arial,sans-serif">
<p>Hi ${esc(b.name)},</p>
<p>Thanks for your booking request. DODO Transport has received it.</p>
<p><b>This is a request only. A driver has not been assigned yet, and your ride is not confirmed.</b>
Our team will contact you to confirm. If your plans change, just reply to this email.</p>
${htmlTable(riderRows(b, when))}
<p>Questions? Call us on ${PHONE_DISPLAY}.<br>DODO Transport</p>
</div>`;
}
