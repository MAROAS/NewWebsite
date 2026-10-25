// DODO-Staging test of the three website forms. RUN ONLY AFTER OWNER APPROVAL AND STAGING DEPLOYMENT.
// Calls DODO-Staging only (the address is fixed below) with a PUBLIC key only: the legacy "anon" key of
// DODO-Staging, or a "sb_publishable_..." key. Secret / service-role keys are refused and never sent.
// It never touches production and never changes a website file (browser mode injects the staging
// address into pages served from this machine only).
//
//   PowerShell (the key is read from the clipboard, so it never appears on screen or in chat):
//     $env:STAGING_PUBLIC_KEY = Get-Clipboard
//     $env:TEST_EMAIL = "<an inbox you can check; default delivered@resend.dev>"
//   Expected DODO inbox for all three forms (proposed): contact@dodotransport.com.au
//   node staging-forms-test.js api        -> success, emails, duplicates, invalid input (all three forms)
//   node staging-forms-test.js browser "<Website DODO folder>"
//                                         -> all three forms in Chrome, desktop and phone size
//                                            (staging ALLOWED_ORIGINS must include http://localhost:8080)
//   node staging-forms-test.js mailfail   -> run while the *_FROM_EMAIL secrets point to an unverified sender
//   node staging-forms-test.js recover    -> after restoring the verified sender: retries the mailfail
//                                            submissions; each must complete once, same reference, no duplicate
//   node staging-forms-test.js spoof      -> RUN LAST: 6 driver applications with forged X-Forwarded-For;
//                                            the 6th must be refused. Uses up this machine's driver quota for an hour.
//
// Emails go to TEST_EMAIL with a "+tag" per test (plus addressing), so the per-email limits are not hit.
// Then confirm in the DODO-Staging SQL editor (read-only) with the queries printed at the end.
const STAGING_REF = "ziqwynsljjxlxuhjaeja";
const BASE = `https://${STAGING_REF}.supabase.co/functions/v1`;
const KEY = (process.env.STAGING_PUBLIC_KEY || process.env.STAGING_ANON_KEY || "").trim();
const TEST_EMAIL = process.env.TEST_EMAIL || "delivered@resend.dev";
const ORIGIN = "http://localhost:8080";

const claims = (() => { try { return JSON.parse(Buffer.from(KEY.split(".")[1], "base64url")); } catch { return {}; } })();
const isPublishable = /^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(KEY);
const isStagingAnon = claims.ref === STAGING_REF && claims.role === "anon";
if (/^sb_secret_/.test(KEY) || claims.role === "service_role" || (!isPublishable && !isStagingAnon)) {
  // Never echo the key itself.
  console.error(`REFUSED: set STAGING_PUBLIC_KEY to the DODO-Staging publishable key (sb_publishable_...) or its legacy anon key (ref ${STAGING_REF}). Secret and service-role keys are never accepted.`);
  process.exit(2);
}
const run = Date.now().toString(36);
const tagged = (tag) => { const [u, d] = TEST_EMAIL.split("@"); return `${u}+${tag}${run}@${d}`; };
const day = new Date(Date.now() + 7 * 864e5 + 10 * 3600e3).toISOString().slice(0, 10);
const P = {
  booking: (email) => ({ name: "ZZ STAGING TEST Rider", email, phone: "0400 000 000", service: "DODO Comfort",
    pickup_address: "ZZ TEST 1 Test St, Brisbane City QLD", destination: "ZZ TEST Brisbane Airport", travel_date: day, travel_time: "09:30" }),
  contact: (email) => ({ name: "ZZ STAGING TEST Contact", email, phone: "", message: "ZZ STAGING TEST message. Please ignore." }),
  driver: (email, state = "QLD") => ({ full_name: "ZZ STAGING TEST Applicant", email, phone: "0400 000 001", state, home_state: state,
    license_length: "5 years", has_abn: "no", vehicle_details: "ZZ TEST vehicle" }),
};
const FN = { booking: "website-booking-request", contact: "website-contact-message", driver: "website-driver-application" };
const post = async (form, body, extraHeaders = {}) => {
  const r = await fetch(`${BASE}/${FN[form]}`, { method: "POST",
    headers: { "Content-Type": "application/json", apikey: KEY, ...(isStagingAnon ? { Authorization: `Bearer ${KEY}` } : {}), Origin: ORIGIN, ...extraHeaders },
    body: JSON.stringify({ request_id: crypto.randomUUID(), company_website: "", ...body }) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const out = (id, name, ok, d) => console.log(`${ok ? "PASS" : "FAIL"} ${id} ${name}  ${JSON.stringify(d).slice(0, 300)}`);
const refs = [];

async function api() {
  for (const form of ["booking", "contact", "driver"]) {
    const id = crypto.randomUUID();
    const body = { request_id: id, ...P[form](tagged(form.slice(0, 1))) };
    const a = await post(form, body);
    refs.push(a.body?.reference);
    out(`S-${form}-1`, `${form}: saved, DODO inbox emailed, acknowledgement emailed`,
      a.status === 200 && a.body?.saved && a.body?.delivery?.team === "sent" && a.body?.delivery?.acknowledgement === "sent", a);
    const b = await Promise.all([post(form, body), post(form, body), post(form, { ...body, request_id: crypto.randomUUID() })]);
    out(`S-${form}-2`, `${form}: repeat, parallel and second-tab submissions return the same record`,
      b.every((x) => x.status === 200 && x.body?.duplicate && x.body?.reference === a.body?.reference), b.map((x) => x.body?.reference));
    const bad = form === "contact" ? { message: "hi", email: "nope" } : form === "driver" ? { state: "ZZ" } : { phone: "1" };
    const c = await post(form, { ...P[form](tagged(form.slice(0, 1) + "x")), ...bad });
    out(`S-${form}-3`, `${form}: invalid input rejected, nothing saved`, c.status === 400 && c.body?.saved === false, c);
    const h = await post(form, { ...P[form](tagged(form.slice(0, 1) + "h")), company_website: "spam" });
    out(`S-${form}-4`, `${form}: spam field rejected`, h.status === 400, h);
  }
  const vic = await post("driver", P.driver(tagged("vic"), "VIC"));
  refs.push(vic.body?.reference);
  out("S-driver-5", "driver (VIC): saved; check the acknowledgement says no trips in Victoria yet", vic.status === 200, vic);
  const evil = await fetch(`${BASE}/${FN.contact}`, { method: "POST", headers: { "Content-Type": "application/json", apikey: KEY, Origin: "https://evil.example" }, body: "{}" });
  out("S-cors", "other websites refused", evil.status === 403, evil.status);
}

const STATE_FILE = require("path").join(__dirname, "staging-mailfail-state.json");
async function spoof() {
  // Spoofed visitor address: 6 driver applications, each claiming a different X-Forwarded-For.
  // Expected: the 6th is refused (429) because the platform's real client address is used.
  // If all 6 are accepted, the per-visitor limit trusts a header visitors can set (the site-wide limit still applies).
  const spoof = [];
  for (let i = 0; i < 6; i++) spoof.push(await post("driver", P.driver(tagged(`sp${i}`)), { "X-Forwarded-For": `198.51.100.${10 + i}` }));
  spoof.forEach((r) => refs.push(r.body?.reference));
  out("S-ratelimit-spoof", "per-visitor limit not bypassed by a forged X-Forwarded-For (6th refused)", spoof[5].status === 429, spoof.map((r) => r.status));
}

async function mailfail() {
  const saved = [];
  for (const form of ["booking", "contact", "driver"]) {
    const body = { request_id: crypto.randomUUID(), ...P[form](tagged(form.slice(0, 1) + "f")) };
    const r = await post(form, body);
    saved.push({ form, body, reference: r.body?.reference });
    refs.push(r.body?.reference);
    out(`S-${form}-mailfail`, `${form}: email failure -> saved:true, ok:false, NOTIFICATION_FAILED (not reported as success)`,
      r.status === 502 && r.body?.saved === true && r.body?.ok === false && r.body?.error === "NOTIFICATION_FAILED", r);
  }
  require("fs").writeFileSync(STATE_FILE, JSON.stringify(saved, null, 2)); // contains test emails only, no keys
  console.log(`Saved the failed submissions to ${STATE_FILE}. Restore the verified sender, then run: node staging-forms-test.js recover`);
}

async function recover() {
  const saved = JSON.parse(require("fs").readFileSync(STATE_FILE, "utf8"));
  for (const { form, body, reference } of saved) {
    const r = await post(form, body);
    refs.push(r.body?.reference);
    out(`S-${form}-recover`, `${form}: retry after the email failure completes: same reference, DODO inbox and acknowledgement sent`,
      r.status === 200 && r.body?.reference === reference && r.body?.delivery?.team === "sent" && r.body?.delivery?.acknowledgement === "sent", r);
    const again = await post(form, body);
    out(`S-${form}-recover-dup`, `${form}: a further retry is a duplicate (no third email)`, again.status === 200 && again.body?.duplicate === true && again.body?.reference === reference, again.body);
  }
}

async function browser(siteDir) {
  const http = require("http"), fs = require("fs"), path = require("path");
  const puppeteer = require("puppeteer-core");
  const SITE = path.resolve(siteDir);
  const inject = `<script>window.DODO_SITE_CONFIG={supabaseUrl:"https://${STAGING_REF}.supabase.co",supabaseAnonKey:${JSON.stringify(KEY)},forms:{booking:"on",contact:"on",driverApplication:"on"}};</script>`;
  const server = http.createServer((req, res) => {
    const f = path.join(SITE, decodeURIComponent(req.url.split("?")[0]));
    if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    if (f.endsWith(".html")) {
      res.writeHead(200, { "Content-Type": "text/html" });
      return res.end(fs.readFileSync(f, "utf8").replace('<script src="app.js"></script>', `${inject}<script src="app.js"></script>`));
    }
    const types = { ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg" };
    res.writeHead(200, { "Content-Type": types[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((ok) => server.listen(8080, ok));
  const b = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new" });
  const VP = { desktop: { width: 1366, height: 900 }, phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } };
  const forms = [
    { form: "contact", url: "DODO.html#contact", sel: "#contactForm", fb: "contact-feedback", re: /DODO-MSG-\d{6}-[0-9A-F]{6}/,
      fill: async (p, e) => { await p.type("#c_name", "ZZ STAGING TEST Contact"); await p.type("#c_email", e); await p.type("#c_message", "ZZ STAGING TEST message from the browser."); } },
    { form: "driver", url: "file0.html#apply", sel: "#driverForm", fb: "driver-feedback", re: /DODO-DRV-\d{6}-[0-9A-F]{6}/,
      fill: async (p, e) => { await p.type("#d_name", "ZZ STAGING TEST Applicant"); await p.type("#d_email", e); await p.type("#d_phone", "0400 000 002"); await p.select("#d_state", "QLD"); await p.select("#d_home_state", "QLD"); } },
    { form: "booking", url: "DODO.html#booking", sel: "#bookingForm", fb: "booking-feedback", re: /DODO-\d{6}-[0-9A-F]{6}/,
      fill: async (p, e) => { await p.type("#b_name", "ZZ STAGING TEST Rider"); await p.select("#b_service", "DODO Comfort");
        await p.type("#b_address", "ZZ TEST 1 Test St, Brisbane City QLD"); await p.type("#b_destination", "ZZ TEST Airport");
        await p.$eval("#b_date", (x, d) => (x.value = d), day); await p.$eval("#b_time", (x) => (x.value = "10:30"));
        await p.type("#b_email", e); await p.type("#b_phone", "0400 000 003"); } },
  ];
  for (const vp of Object.keys(VP)) {
    for (const f of forms) {
      const ctx = await b.createBrowserContext();
      const page = await ctx.newPage();
      await page.setViewport(VP[vp]);
      const errs = [];
      page.on("pageerror", (e) => errs.push(e.message));
      await page.goto(`http://localhost:8080/${f.url}`, { waitUntil: "domcontentloaded" });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      await f.fill(page, tagged(`${f.form.slice(0, 1)}${vp.slice(0, 1)}b`));
      const btn = await page.$(`${f.sel} button[type=submit]`);
      await btn.evaluate((x) => x.scrollIntoView({ block: "center", behavior: "instant" }));
      await new Promise((ok) => setTimeout(ok, 700));
      if (vp === "phone") await btn.tap(); else await btn.click();
      await page.waitForFunction((id) => /is-(success|error|warning)/.test(document.getElementById(id).className), { timeout: 40000 }, f.fb).catch(() => {});
      const fb = await page.$eval(`#${f.fb}`, (e) => ({ cls: e.className, text: e.innerText }));
      const ref = f.re.exec(fb.text)?.[0];
      refs.push(ref);
      await page.screenshot({ path: `staging-${f.form}-${vp}.png`, fullPage: false });
      out(`S-browser-${f.form}-${vp}`, `${vp}: ${f.form} form submits to staging and shows success with a reference; no sideways scroll; no script errors`,
        /is-success/.test(fb.cls) && ref && overflow <= 0 && errs.length === 0, { ref, overflow, errs, text: fb.text.slice(0, 120) });
      await ctx.close();
    }
  }
  await b.close();
  server.close();
}

(async () => {
  const mode = process.argv[2] || "api";
  if (mode === "api") await api();
  else if (mode === "mailfail") await mailfail();
  else if (mode === "recover") await recover();
  else if (mode === "spoof") await spoof();
  else if (mode === "browser") await browser(process.argv[3] || ".");
  else { console.error("mode must be api, browser, mailfail, recover or spoof"); process.exit(2); }
  const list = refs.filter(Boolean).map((r) => `'${r}'`).join(",") || "''";
  console.log(`\nReferences: ${refs.filter(Boolean).join(", ")}`);
  console.log(`Check <staging test inbox> (DODO copies) and ${TEST_EMAIL} (acknowledgements): exactly ONE email per reference, subject starting "[STAGING TEST]". Email delivery is PASS only when the message is actually in the inbox (check Spam too) and the delivery-status row shows email.delivered.`);
  console.log(`Read-only checks in the DODO-Staging SQL editor:
  -- accepted by Resend (sent) and, once the Resend webhook is set up, what actually happened (delivered / bounced):
  select form, reference, kind, accepted_at, latest_event, latest_event_at, bounce_type, detail from website_email_delivery_status where reference in (${list}) order by reference, kind;
  select booking_reference, dodo_notified_at, rider_ack_sent_at, last_email_error, email_attempts from booking_requests where booking_reference in (${list});
  select reference, team_notified_at, ack_sent_at, last_email_error, email_attempts from contact_messages where reference in (${list});
  select reference, state, team_notified_at, ack_sent_at, last_email_error, email_attempts from driver_applications where reference in (${list});`);
})();
