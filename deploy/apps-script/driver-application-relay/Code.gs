/**
 * DODO driver application relay (Google Apps Script web app). Version 27 Oct 2026 (MailApp).
 * PREPARED, NOT DEPLOYED. Replaces the FormSubmit step of the 27 Oct relay with Google's own MailApp,
 * so applications go straight from this script to the inbox of the Google account it runs as.
 *
 * - Driver applications only, from the "Become a driver" page on https://www.dodotransport.com.au.
 *   It is a separate project from the booking relay, so the booking and contact forms are not affected.
 * - The inbox is the Google account this script runs as ("Execute as: Me"). The address is never typed
 *   here, never sent to the browser and never shown in a reply.
 * - No third-party form service: nothing leaves Google. The email is plain text (nothing in it can run).
 * - It accepts no licence numbers or documents: 8 or more digits in a row in a text field are refused.
 * - Applications for states other than Queensland are marked "registration only": DODO takes trips in Queensland only.
 * - Exactly one email per accepted application: a script lock makes the repeat check, the email and the
 *   record of it happen one at a time, so two identical taps arriving together still produce one email.
 * - Nothing is saved by this script. CacheService keeps, for a few hours, only one-way fingerprints used to stop
 *   repeats: the same application within 10 minutes, and more than 3 applications from one email address or phone
 *   number within 6 hours.
 * - Google limits: MailApp can email 100 recipients a day from a personal Google account and 1,500 a day from
 *   Google Workspace. Each application uses 1. If the day's limit is reached, the page asks the applicant to call.
 *
 * Deploy (only with the owner's approval): open the existing "DODO driver application relay" project, replace all of
 * Code.gs with this file, Save, then Deploy > Manage deployments > Edit > Version: New version > Deploy.
 * Google asks for permission again ("Send email as you"). The web app URL stays the same.
 */

function inbox_() { return Session.getEffectiveUser().getEmail(); }

var VERSION = '2026-10-27-mailapp';
var STATES = ['QLD', 'NSW', 'VIC', 'WA', 'SA', 'ACT', 'TAS', 'NT'];
var FIELDS = ['full_name', 'email', 'phone', 'state', 'home_state', 'license_length', 'has_abn', 'vehicle_details'];
var REQUIRED = FIELDS; // all 8 are required
var LIMITS = { full_name: 100, email: 254, phone: 30, license_length: 50, vehicle_details: 500 };
var AU_PHONE = /^\s*(\+?61|0)\s*[2-478](\s*\d){8}\s*$/;
var LINK = /(https?:\/\/|www\.)/i;
var ID_NUMBER = /(?:\d[\s-]?){8,}/; // licence, card or other ID numbers
var MAX_PER_PERSON = 3;          // applications per email address or phone number
var PERSON_WINDOW_S = 6 * 3600;  // 6 hours (the CacheService maximum)
var REPEAT_WINDOW_S = 600;       // identical application: 10 minutes

function doPost(e) {
  var p = (e && e.parameter) || {};
  if (p.form !== 'driver') return json_({ ok: false, error: 'This service accepts driver applications only.' });
  if (String(p.company_website || '').trim()) return json_({ ok: true }); // spam trap: nothing is sent

  var v = {};
  FIELDS.forEach(function (f) { v[f] = String(p[f] || '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim(); });
  v.state = v.state.toUpperCase();
  v.home_state = v.home_state.toUpperCase();
  v.email = v.email.toLowerCase();

  var missing = REQUIRED.filter(function (f) { return !v[f]; });
  if (missing.length) return json_({ ok: false, error: 'Please fill in: ' + missing.join(', ') + '.' });
  for (var f in LIMITS) if (v[f].length > LIMITS[f]) return json_({ ok: false, error: 'The ' + f.replace('_', ' ') + ' field is too long.' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) return json_({ ok: false, error: 'Please enter a valid email address.' });
  if (!AU_PHONE.test(v.phone)) return json_({ ok: false, error: 'Please enter an Australian phone number, for example 0412 345 678.' });
  if (STATES.indexOf(v.state) === -1) return json_({ ok: false, error: 'Please choose the state you will drive in.' });
  if (STATES.indexOf(v.home_state) === -1) return json_({ ok: false, error: 'Please choose the state you live in.' });
  if (v.has_abn !== 'yes' && v.has_abn !== 'no') return json_({ ok: false, error: 'Please answer whether you have an ABN.' });
  if (LINK.test(v.full_name) || LINK.test(v.license_length) || LINK.test(v.vehicle_details)) {
    return json_({ ok: false, error: 'Please remove website links from your application.' });
  }
  if (ID_NUMBER.test(v.full_name) || ID_NUMBER.test(v.license_length) || ID_NUMBER.test(v.vehicle_details)) {
    return json_({ ok: false, error: "Please don't include licence, card or other ID numbers. If DODO takes your application further, you'll provide documents securely in the DODO Driver app." });
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return json_({ ok: false, error: 'We are busy right now. Please try again in a minute.' });
  try {
    var cache = CacheService.getScriptCache();
    var repeatKey = 'same:' + hash_(FIELDS.map(function (k) { return v[k].toLowerCase(); }).join('|'));
    if (cache.get(repeatKey)) return json_({ ok: true, duplicate: true });
    var phoneDigits = v.phone.replace(/\D/g, '').replace(/^61/, '0');
    var personKeys = ['email:' + hash_(v.email), 'phone:' + hash_(phoneDigits)];
    var counts = personKeys.map(function (k) { return Number(cache.get(k) || 0); });
    if (Math.max(counts[0], counts[1]) >= MAX_PER_PERSON) {
      return json_({ ok: false, error: 'We have already received several applications from you in the last few hours.' });
    }
    if (MailApp.getRemainingDailyQuota() < 1) {
      return json_({ ok: false, error: 'Online applications are temporarily unavailable.' });
    }

    var stateLine = v.state + (v.state === 'QLD' ? ' (trips available once approved)' : ' (registration only: DODO does not take trips there yet)');
    var body = [
      'DODO driver application (www.dodotransport.com.au)',
      '',
      'Received: ' + Utilities.formatDate(new Date(), 'Australia/Brisbane', 'yyyy-MM-dd HH:mm') + ' (Queensland time)',
      'Full name: ' + v.full_name,
      'Email: ' + v.email,
      'Phone: ' + v.phone,
      'State they will drive in: ' + stateLine,
      'State they live in: ' + v.home_state,
      'Licence held for: ' + v.license_length,
      'Has an ABN: ' + (v.has_abn === 'yes' ? 'Yes' : 'No'),
      'Vehicle details: ' + v.vehicle_details,
      '',
      'This is an application only, not an approval. It does not authorise the applicant to accept trips.',
      'No licence numbers or documents were collected through the website.',
      'Reply to this email to contact the applicant.'
    ].join('\n');
    try {
      MailApp.sendEmail({
        to: inbox_(),
        subject: 'DODO driver application: ' + v.full_name.slice(0, 50) + ' (' + v.state + ')',
        body: body,
        replyTo: v.email,
        name: 'DODO driver applications'
      });
    } catch (err) {
      return json_({ ok: false, error: 'Your application could not be sent. Please try again later.' });
    }
    cache.put(repeatKey, '1', REPEAT_WINDOW_S);
    personKeys.forEach(function (k, i) { cache.put(k, String(counts[i] + 1), PERSON_WINDOW_S); });
    return json_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

function doGet() { return json_({ ok: true, service: 'DODO driver application relay', version: VERSION }); }

function hash_(s) { return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s)); }

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
