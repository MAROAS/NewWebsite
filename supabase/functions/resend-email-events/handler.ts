// Resend webhook receiver: records email delivery events (delivered, bounced, complained, delayed, ...)
// for the DODO website forms, so DODO can see whether an email actually reached the inbox.
//
// Secrets (Edge Function secrets, never in website JavaScript):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   provided by Supabase
//   RESEND_WEBHOOK_SECRET                     "whsec_..." signing secret of this webhook in the Resend dashboard
//
// Security: Resend cannot send a Supabase JWT, so this function is deployed with --no-verify-jwt.
// Every request must carry a valid Svix signature (HMAC-SHA256 over id.timestamp.body with the webhook
// secret) made within the last 5 minutes; anything else is refused before the database is touched.
// Only the event type, Resend's email id, time and bounce details (email addresses removed) are stored.

export type Deps = {
  env: (key: string) => string | undefined;
  fetch: typeof fetch;
  now?: () => number;
  log?: (message: string, extra?: Record<string, unknown>) => void;
};

const MAX_BODY_BYTES = 100_000;
const TOLERANCE_SECONDS = 300;

export function createHandler(deps: Deps) {
  const log = deps.log ?? ((m: string, e?: Record<string, unknown>) => console.log(JSON.stringify({ fn: "resend-email-events", m, ...e })));
  const now = deps.now ?? (() => Date.now());
  const reply = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

  return async function handle(req: Request): Promise<Response> {
    if (req.method !== "POST") return reply(405, { ok: false, error: "METHOD_NOT_ALLOWED" });
    const secret = deps.env("RESEND_WEBHOOK_SECRET");
    const url = deps.env("SUPABASE_URL");
    const serviceKey = deps.env("SUPABASE_SERVICE_ROLE_KEY");
    if (!secret || !url || !serviceKey) {
      log("config_missing");
      return reply(503, { ok: false, error: "SERVICE_UNAVAILABLE" }); // Resend retries later
    }

    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return reply(413, { ok: false, error: "TOO_LARGE" });
    const id = req.headers.get("svix-id") ?? "";
    const ts = req.headers.get("svix-timestamp") ?? "";
    const sigs = req.headers.get("svix-signature") ?? "";
    if (!(await verifySignature(secret, id, ts, raw, sigs, now()))) {
      log("signature_rejected");
      return reply(401, { ok: false, error: "INVALID_SIGNATURE" });
    }

    let evt: { type?: unknown; created_at?: unknown; data?: Record<string, unknown> };
    try {
      evt = JSON.parse(raw);
    } catch {
      return reply(400, { ok: false, error: "INVALID_BODY" });
    }
    const type = typeof evt.type === "string" ? evt.type : "";
    if (!/^email\.[a-z_]{2,40}$/.test(type)) return reply(200, { ok: true, ignored: true }); // not an email event
    const data = (evt.data ?? {}) as Record<string, unknown>;
    const bounce = (data.bounce ?? {}) as Record<string, unknown>;
    const failed = (data.failed ?? {}) as Record<string, unknown>;
    const detail = [bounce.subType, bounce.message, failed.reason].filter((x) => typeof x === "string" && x).join(" | ");

    try {
      const res = await deps.fetch(`${url}/rest/v1/rpc/website_record_email_event`, {
        method: "POST",
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          p_svix_id: id,
          p_type: type,
          p_email_id: typeof data.email_id === "string" ? data.email_id : null,
          p_occurred_at: typeof evt.created_at === "string" ? evt.created_at : null,
          p_bounce_type: typeof bounce.type === "string" ? bounce.type : null,
          p_detail: detail || null,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`rpc HTTP ${res.status}`);
      const out = await res.json();
      log("recorded", { type, duplicate: out?.duplicate === true });
      return reply(200, { ok: true, duplicate: out?.duplicate === true });
    } catch (err) {
      log("save_failed", { error: String(err) });
      return reply(500, { ok: false, error: "SAVE_FAILED" }); // non-2xx: Resend retries
    }
  };
}

// Svix signature: base64(HMAC-SHA256(key = base64-decoded secret after "whsec_", msg = `${id}.${timestamp}.${body}`)).
// The header may hold several space-separated "v1,<signature>" entries (during secret rotation).
export async function verifySignature(secret: string, id: string, ts: string, body: string, header: string, nowMs: number) {
  if (!id || !/^\d{1,12}$/.test(ts) || !header) return false;
  if (Math.abs(nowMs / 1000 - Number(ts)) > TOLERANCE_SECONDS) return false;
  let keyBytes: Uint8Array;
  try {
    keyBytes = Uint8Array.from(atob(secret.startsWith("whsec_") ? secret.slice(6) : secret), (c) => c.charCodeAt(0));
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${body}`)));
  const expected = btoa(String.fromCharCode(...mac));
  return header.split(" ").some((part) => {
    const [ver, sig] = part.split(",");
    return ver === "v1" && typeof sig === "string" && timingSafeEqual(sig, expected);
  });
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
