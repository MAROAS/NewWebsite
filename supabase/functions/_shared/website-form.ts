// Shared server logic for the DODO website forms (pre-booking, Contact Us, driver application).
//
// Each form is its own Supabase Edge Function that calls createFormHandler() with a FormSpec.
// Secrets stay on the server (Edge Function secrets), never in website JavaScript:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   provided by Supabase
//   RESEND_API_KEY                            Resend API key (sending access only)
//   <form>_INBOX_EMAIL / <form>_FROM_EMAIL    per form, see each handler.ts
//   ALLOWED_ORIGINS                           comma-separated website origins
//   DODO_ENVIRONMENT                          "staging" or "production" (staging emails are labelled)
//
// Order of work, and what the website is told:
//   1. validate and SAVE (database function, once per request_id; same details again = duplicate)
//      -> not saved: { ok:false, saved:false, error }
//   2. email DODO's inbox (Resend, idempotency key, result recorded in the row)
//      -> failed: HTTP 502 { ok:false, saved:true, error:"NOTIFICATION_FAILED", reference,
//                            delivery:{ team:"failed", acknowledgement:"not_sent" } }
//   3. email the person an acknowledgement
//      -> HTTP 200 { ok:true, saved:true, reference, delivery:{ team:"sent", acknowledgement:"sent"|"failed" } }
// Retrying with the same request_id finishes whatever is missing and never sends an email twice.

export type Deps = {
  env: (key: string) => string | undefined;
  fetch: typeof fetch;
  log?: (message: string, extra?: Record<string, unknown>) => void;
};

export type Rec = Record<string, unknown> & { request_id: string; created_at: string };
export type Email = { subject: string; text: string; html: string; reply_to?: string };
export type EmailCtx = { staging: boolean; tag: string; inbox: string };

export type FormSpec = {
  name: string;                                  // used in logs
  fields: string[];                              // string fields the website sends ("" allowed)
  inboxEnv: string;                              // env var holding DODO's inbox for this form
  fromEnv: string[];                             // env vars for the sender, first one set wins
  submitFn: string;                              // database function that validates and saves
  submitArgs: (input: Record<string, string>, clientHash: string | null) => Record<string, unknown>;
  recordFn: string;                              // database function that records an email result
  kinds: { team: string; ack: string };          // p_kind values the record function expects
  flags: { team: string; ack: string };          // summary keys: "already emailed?"
  referenceKey: string;                          // summary key holding the reference
  idempotencyPrefix: string;                     // Resend idempotency key prefix
  teamEmail: (rec: Rec, ctx: EmailCtx) => Email;
  ackEmail: (rec: Rec, ctx: EmailCtx) => Email;
  ackTo: (rec: Rec) => string;
  extraResponse?: (rec: Rec, delivery: Delivery) => Record<string, unknown>;
};

export type Delivery = { team: "sent" | "failed"; acknowledgement: "sent" | "failed" | "not_sent" };

const MAX_BODY_BYTES = 10_000; // no files: documents are never accepted by these endpoints
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUS_FOR: Record<string, number> = {
  VALIDATION_FAILED: 400,
  REQUEST_ID_CONFLICT: 409,
  TOO_MANY_REQUESTS: 429,
};

export function createFormHandler(spec: FormSpec, deps: Deps) {
  const log = deps.log ?? ((m: string, e?: Record<string, unknown>) => console.log(JSON.stringify({ form: spec.name, m, ...e })));

  return async function handle(req: Request): Promise<Response> {
    const origin = req.headers.get("origin");
    const allowed = (deps.env("ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const originOk = origin !== null && allowed.includes(origin);
    const cors: Record<string, string> = originOk
      ? {
          "Access-Control-Allow-Origin": origin as string,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
          "Access-Control-Max-Age": "600",
          Vary: "Origin",
        }
      : { Vary: "Origin" };
    const reply = (status: number, body: Record<string, unknown>) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
      });

    if (req.method === "OPTIONS") return new Response(null, { status: originOk ? 204 : 403, headers: cors });
    if (req.method !== "POST") return reply(405, { ok: false, saved: false, error: "METHOD_NOT_ALLOWED" });
    if (!originOk) return reply(403, { ok: false, saved: false, error: "ORIGIN_NOT_ALLOWED" });

    const from = spec.fromEnv.map((k) => deps.env(k)).find((v) => v);
    const cfg = {
      url: deps.env("SUPABASE_URL"),
      serviceKey: deps.env("SUPABASE_SERVICE_ROLE_KEY"),
      resendKey: deps.env("RESEND_API_KEY"),
      inbox: deps.env(spec.inboxEnv),
      from,
    };
    const staging = (deps.env("DODO_ENVIRONMENT") ?? "staging") !== "production";
    if (!cfg.url || !cfg.serviceKey || !cfg.resendKey || !cfg.inbox || !cfg.from) {
      // Refuse before saving, so nothing is stored that nobody would be told about.
      log("config_missing", { missing: Object.entries(cfg).filter(([, v]) => !v).map(([k]) => k) });
      return reply(503, { ok: false, saved: false, error: "SERVICE_UNAVAILABLE", retryable: true });
    }

    // ---- input
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return reply(413, { ok: false, saved: false, error: "TOO_LARGE" });
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw);
    } catch {
      return reply(400, { ok: false, saved: false, error: "VALIDATION_FAILED", fields: ["body"] });
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return reply(400, { ok: false, saved: false, error: "VALIDATION_FAILED", fields: ["body"] });
    }
    // Hidden field that people never see or fill in; automated form fillers usually do.
    if (typeof body.company_website === "string" && body.company_website.trim() !== "") {
      log("honeypot");
      return reply(400, { ok: false, saved: false, error: "VALIDATION_FAILED", fields: ["form"] });
    }
    const input: Record<string, string> = {};
    for (const f of ["request_id", ...spec.fields]) {
      const v = body[f] ?? "";
      if (typeof v !== "string") return reply(400, { ok: false, saved: false, error: "VALIDATION_FAILED", fields: [f] });
      input[f] = v;
    }
    if (!UUID_RE.test(input.request_id)) {
      return reply(400, { ok: false, saved: false, error: "VALIDATION_FAILED", fields: ["request_id"] });
    }
    const clientHash = await hashClient(req, cfg.serviceKey);

    // ---- save (the database validates again and is the source of truth)
    const rpc = async (fn: string, args: Record<string, unknown>) => {
      const res = await deps.fetch(`${cfg.url}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: {
          apikey: cfg.serviceKey as string,
          Authorization: `Bearer ${cfg.serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(10_000),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`rpc ${fn} HTTP ${res.status}: ${text.slice(0, 200)}`);
      return JSON.parse(text);
    };

    let saved: Record<string, unknown>;
    try {
      saved = await rpc(spec.submitFn, spec.submitArgs(input, clientHash));
    } catch (err) {
      log("save_failed", { error: String(err) });
      return reply(500, { ok: false, saved: false, error: "SAVE_FAILED", retryable: true });
    }
    if (saved.ok !== true) {
      const code = String(saved.error ?? "SAVE_FAILED");
      const status = STATUS_FOR[code] ?? 500;
      return reply(status, {
        ok: false, saved: false, error: code, fields: saved.fields ?? undefined,
        retryable: status >= 500 || status === 429,
      });
    }

    let rec = saved as unknown as Rec;
    const reference = String(rec[spec.referenceKey]);
    log("saved", { reference, duplicate: saved.duplicate === true });

    // ---- emails: each sent at most once (Resend idempotency key + recorded in the row)
    const send = async (kind: "team" | "ack", to: string, email: Email) => {
      let ok = false;
      let providerId: string | null = null;
      let error: string | null = null;
      try {
        const res = await deps.fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${cfg.resendKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `${spec.idempotencyPrefix}/${rec.request_id}/${spec.kinds[kind]}`,
          },
          body: JSON.stringify({ from: cfg.from, to: [to], ...email }),
          signal: AbortSignal.timeout(10_000),
        });
        const text = await res.text();
        if (res.ok) {
          ok = true;
          try { providerId = JSON.parse(text).id ?? null; } catch { providerId = null; }
        } else {
          error = `Resend HTTP ${res.status}: ${text.slice(0, 200)}`;
        }
      } catch (err) {
        error = `Resend request failed: ${String(err)}`;
      }
      try {
        rec = await rpc(spec.recordFn, {
          p_request_id: rec.request_id, p_kind: spec.kinds[kind], p_ok: ok, p_provider_id: providerId, p_error: error,
        });
      } catch (err) {
        log("record_email_failed", { reference, kind, error: String(err) });
        if (ok) rec = { ...rec, [spec.flags[kind]]: true };
      }
      if (!ok) log("email_failed", { reference, kind, error: redact(error) });
      return ok;
    };

    const ctx: EmailCtx = { staging, tag: staging ? "[STAGING TEST] " : "", inbox: cfg.inbox };

    if (rec[spec.flags.team] !== true) {
      const team = spec.teamEmail(rec, ctx);
      if (!(await send("team", cfg.inbox, team))) {
        const delivery: Delivery = { team: "failed", acknowledgement: rec[spec.flags.ack] === true ? "sent" : "not_sent" };
        return reply(502, {
          ok: false, saved: true, error: "NOTIFICATION_FAILED", retryable: true, reference, delivery,
          ...(spec.extraResponse ? spec.extraResponse(rec, delivery) : {}),
        });
      }
    }
    if (rec[spec.flags.ack] !== true) {
      await send("ack", spec.ackTo(rec), { reply_to: cfg.inbox, ...spec.ackEmail(rec, ctx) });
    }

    const delivery: Delivery = { team: "sent", acknowledgement: rec[spec.flags.ack] === true ? "sent" : "failed" };
    return reply(200, {
      ok: true, saved: true, duplicate: saved.duplicate === true, reference, delivery,
      ...(spec.extraResponse ? spec.extraResponse(rec, delivery) : {}),
    });
  };
}

// A keyed hash of the visitor's IP address, used only for rate limiting. The address itself is
// never stored. Cloudflare's header is preferred because visitors cannot set it themselves.
async function hashClient(req: Request, secret: string): Promise<string | null> {
  const ip = req.headers.get("cf-connecting-ip")
    || (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim()
    || req.headers.get("x-real-ip")
    || "";
  if (!ip) return null;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`dodo-website-rate|${ip}`));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Logs never carry email addresses (a provider error message can quote the recipient).
const redact = (s: string | null) => (s ?? "").replace(/[^\s@<>"':;,]+@[^\s@<>"':;,]+/g, "[email]");

// ---------------------------------------------------------------- email helpers
export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

export const htmlTable = (r: [string, string][]) =>
  `<table cellpadding="6" style="border-collapse:collapse;font:14px/1.4 Arial,sans-serif">${r
    .map(([k, v]) => `<tr><td style="color:#555;vertical-align:top"><b>${esc(k)}</b></td><td style="white-space:pre-wrap">${esc(v)}</td></tr>`)
    .join("")}</table>`;

export const textRows = (r: [string, string][]) => r.map(([k, v]) => `${k}: ${v}`);

export const STAGING_NOTE = "THIS IS A DODO-STAGING TEST. It is not a real request.";
export const stagingHtml = (staging: boolean) => (staging ? `<p style="color:#b91c1c"><b>${STAGING_NOTE}</b></p>` : "");
export const stagingText = (staging: boolean) => (staging ? STAGING_NOTE + "\n" : "");

export const brisbaneTime = (iso: string) =>
  `${new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Brisbane" })} (Queensland time)`;

export const PHONE_DISPLAY = "0415 152 099";
