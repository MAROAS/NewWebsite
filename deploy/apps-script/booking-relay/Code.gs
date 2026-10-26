/**
 * DODO booking relay (Google Apps Script web app). Version 27 Oct 2026 (MailApp). PREPARED, NOT DEPLOYED.
 * Receives booking and contact requests from https://booking.dodotransport.com.au and emails them to DODO's inbox
 * (the Google account this script runs as) with Google's own MailApp. It replaces only the FormSubmit step of the
 * tested live relay: forms, fields, validation, subjects, duplicate check and replies to the page are unchanged.
 * The inbox address stays inside this Google account: it is never in the website or in any reply.
 *
 * Success is reported ONLY after MailApp has accepted the email. If the email can't be sent, the page shows an
 * error with DODO's phone number and the request is not marked as sent, so the customer can try again or call.
 *
 * Deploy (only with the owner's approval). Keep the same URL:
 *   1. Open the existing "DODO booking relay" project (same Google account). Replace all of Code.gs with this file. Save.
 *   2. Pick the function doGet in the toolbar and click Run. Review permissions > choose the account > Advanced >
 *      Go to DODO booking relay > tick every box, including "Send email as you" > Allow.
 *   3. Deploy > Manage deployments > Edit (pencil) > Version: New version > Deploy. Do NOT create a new deployment.
 * Rollback: Deploy > Manage deployments > Edit > Version: pick the previous version > Deploy.
 */

// The inbox is the Google account this script runs as ("Execute as: Me"). Nothing is typed or published.
function inbox_() { return Session.getEffectiveUser().getEmail(); }

var VERSION = 'booking-2026-10-27-mailapp';
var FORMS = {
  booking: { subject: 'DODO booking request (booking.dodotransport.com.au)',
             fields: ['name', 'email', 'phone', 'message', 'serviceType', 'address', 'destination', 'travelDate', 'travelTime'] },
  contact: { subject: 'DODO contact message (booking.dodotransport.com.au)',
             fields: ['name', 'email', 'phone', 'message'] }
};
var AU_PHONE = /^\s*(\+?61|0)\s*[2-478](\s*\d){8}\s*$/;

function doPost(e) {
  var p = (e && e.parameter) || {};
  var form = FORMS[p.form] ? p.form : null;
  if (!form) return json_({ ok: false, error: 'Unknown form.' });
  if (p._honey) return json_({ ok: true });                       // spam trap filled: pretend success, send nothing

  // Validation (same rules as the page)
  var missing = FORMS[form].fields.filter(function (f) { return !String(p[f] || '').trim(); });
  if (missing.length) return json_({ ok: false, error: 'Please fill in: ' + missing.join(', ') + '.' });
  if (!AU_PHONE.test(p.phone || '')) return json_({ ok: false, error: 'Please enter an Australian phone number, for example 0412 345 678.' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email || '')) return json_({ ok: false, error: 'Please enter a valid email address.' });
  if (form === 'booking') {
    var today = Utilities.formatDate(new Date(), 'Australia/Brisbane', 'yyyy-MM-dd');
    if (String(p.travelDate) < today) return json_({ ok: false, error: 'The travel date cannot be in the past.' });
  }

  // Duplicate protection: the same request within 10 minutes is accepted once
  var key = form + ':' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
    FORMS[form].fields.map(function (f) { return String(p[f] || '').trim().toLowerCase(); }).join('|')));
  var cache = CacheService.getScriptCache();
  if (cache.get(key)) return json_({ ok: true, duplicate: true });

  // One at a time, so two identical taps arriving together still produce one email
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return json_({ ok: false, error: 'We are busy right now. Please try again in a minute.' });
  try {
    if (cache.get(key)) return json_({ ok: true, duplicate: true });
    if (MailApp.getRemainingDailyQuota() < 1) {
      return json_({ ok: false, error: 'Online requests are temporarily unavailable.' });
    }
    // Same subject and fields as before; plain text, one "field: value" line each (values up to 1000 characters)
    var lines = FORMS[form].fields.map(function (f) { return f + ': ' + String(p[f] || '').slice(0, 1000); });
    var body = lines.concat(['', 'Received: ' + Utilities.formatDate(new Date(), 'Australia/Brisbane', 'yyyy-MM-dd HH:mm') +
      ' (Queensland time) from booking.dodotransport.com.au', 'Reply to this email to contact the customer.']).join('\n');
    try {
      MailApp.sendEmail({
        to: inbox_(),
        subject: FORMS[form].subject,
        body: body,
        replyTo: String(p.email).trim(),
        name: 'DODO booking requests'
      });
    } catch (err) {
      return json_({ ok: false, error: 'Your request could not be sent. Please try again later.' });
    }
    cache.put(key, '1', 600);
    return json_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

function doGet() { return json_({ ok: true, service: 'DODO booking relay', version: VERSION }); }

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
