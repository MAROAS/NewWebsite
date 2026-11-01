/* DODO account deletion request form (delete-account.html).
 * The form is shown only when site-config.js sets accountDeletionRelay.enabled to true with a Google Apps Script
 * web app address. Otherwise the page shows the phone number instead. Sending the form only REQUESTS deletion:
 * the success message confirms receipt, never deletion. The reply is the same for any email address. */
(function () {
  "use strict";
  var PHONE = "0415 152 099";
  var TIMEOUT_MS = 20000;
  var RELAY_PATTERN = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;
  var AU_PHONE = /^\s*(\+?61|0)\s*[2-478](\s*\d){8}\s*$/;
  var EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  var LINK = /(https?:\/\/|www\.)/i;
  var SECRET_NUMBER = /(?:\d[\s-]?){6,}/; // card numbers, sign-in codes, ID numbers

  function relayUrl() {
    var cfg = ((window.DODO_SITE_CONFIG || {}).accountDeletionRelay) || {};
    var url = typeof cfg.url === "string" ? cfg.url.trim() : "";
    return cfg.enabled === true && RELAY_PATTERN.test(url) ? url : "";
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function feedback(el, kind, html) {
    if (!el) return;
    el.classList.remove("is-success", "is-error", "is-pending", "is-warning");
    if (kind) el.classList.add("is-" + kind);
    el.setAttribute("role", kind === "error" ? "alert" : "status");
    el.innerHTML = html;
  }

  // Returns the first problem as { el, msg }, or null. Same rules as the relay.
  function validate(form) {
    var type = form.querySelector('input[name="account_type"]:checked');
    var email = form.elements.namedItem("email");
    var phone = form.elements.namedItem("phone");
    var details = form.elements.namedItem("details");
    var confirm = form.elements.namedItem("confirm");
    if (!type) return { el: form.querySelector('input[name="account_type"]'), msg: "Please choose your account type: DODO Driver, DODO Rider or both." };
    if (!email.value.trim()) return { el: email, msg: "Please enter the email address registered to your DODO account." };
    if (email.value.trim().length > 254 || !EMAIL.test(email.value.trim())) return { el: email, msg: "Please enter a valid email address." };
    if (phone.value.trim() && !AU_PHONE.test(phone.value)) return { el: phone, msg: "Please enter an Australian phone number, for example 0412 345 678, or leave it blank." };
    if (details.value.length > 1000) return { el: details, msg: "The additional information is too long (1,000 characters at most)." };
    if (LINK.test(details.value)) return { el: details, msg: "Please remove website links from the additional information." };
    if (SECRET_NUMBER.test(details.value)) return { el: details, msg: "Please remove long numbers from the additional information. Never send passwords, codes, card numbers or ID numbers." };
    if (!confirm.checked) return { el: confirm, msg: "Please tick the box to confirm you are asking DODO to delete your account." };
    return null;
  }

  function init() {
    var form = document.querySelector("[data-deletion-form]");
    var fallback = document.querySelector("[data-deletion-fallback]");
    var relay = relayUrl();
    if (!form) return;
    if (!relay) { form.hidden = true; if (fallback) fallback.hidden = false; return; }
    form.hidden = false;
    document.querySelectorAll("[data-deletion-online]").forEach(function (el) { el.hidden = false; });
    if (fallback) fallback.hidden = true;

    var fb = document.getElementById("deletionFeedback");
    var button = form.querySelector('button[type="submit"]');
    var label = button ? button.textContent : "";
    var inFlight = false;
    function busy(on) {
      inFlight = on;
      if (!button) return;
      button.disabled = on;
      button.setAttribute("aria-busy", on ? "true" : "false");
      button.textContent = on ? "Sending…" : label;
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (inFlight) return; // repeat tap while sending
      var problem = validate(form);
      if (problem) {
        feedback(fb, "error", esc(problem.msg));
        if (problem.el && problem.el.focus) problem.el.focus();
        return;
      }
      var data = new FormData(form);
      var body = new URLSearchParams({ form: "account_deletion" });
      ["account_type", "email", "phone", "details"].forEach(function (f) { body.set(f, String(data.get(f) || "").trim()); });
      body.set("confirm", form.elements.namedItem("confirm").checked ? "yes" : "");
      body.set("company_website", String(data.get("company_website") || ""));

      busy(true);
      feedback(fb, "pending", "Sending your request…");
      var timedOut = false;
      var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      var timer = controller ? setTimeout(function () { timedOut = true; controller.abort(); }, TIMEOUT_MS) : null;
      // Plain form post with no custom headers: a simple request that Google Apps Script accepts.
      fetch(relay, { method: "POST", body: body, signal: controller ? controller.signal : undefined })
        .then(function (res) { return res.json().catch(function () { return null; }); })
        .catch(function () { return null; })
        .then(function (reply) {
          if (timer) clearTimeout(timer);
          if (reply && reply.ok === true) {
            var ref = typeof reply.reference === "string" && /^DEL-[0-9]{8}-[A-Z0-9]{6}$/.test(reply.reference)
              ? " Your reference is <strong>" + esc(reply.reference) + "</strong>." : "";
            feedback(fb, "success",
              "<strong>Thank you. DODO has received your account deletion request.</strong>" + ref +
              " <strong>Your account has not been deleted yet.</strong> If the details match a DODO account, DODO Support will contact you" +
              " using the details held in that account to verify that the request came from you, before anything is deleted." +
              " We'll confirm when your request has been processed. Questions? Call " + PHONE + ".");
            form.reset();
            busy(false);
            return;
          }
          var msg = reply && typeof reply.error === "string"
            ? esc(reply.error) + " Or call DODO on " + PHONE + "."
            : timedOut
              ? "We couldn't confirm that your request reached us. Please try again in a minute, or call DODO on " + PHONE + "."
              : "We couldn't reach DODO. Check your internet connection and try again, or call DODO on " + PHONE + ".";
          feedback(fb, "error", msg + " Your account has not been changed.");
          busy(false);
        });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
