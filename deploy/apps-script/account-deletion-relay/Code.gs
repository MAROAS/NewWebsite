/**
 * DODO account deletion request relay (Google Apps Script web app). Version 1 Nov 2026.
 * PREPARED, NOT DEPLOYED.
 *
 * Receives account deletion REQUESTS from https://www.dodotransport.com.au/delete-account and:
 *   1. records each accepted request as one row in a private Google Sheet ("DODO account deletion requests")
 *      owned by the Google account this script runs as, and
 *   2. emails a plain-text notification to that account's own inbox with Google MailApp.
 *
 * What it never does:
 * - It never deletes, changes or even looks up an account. It has no database access and no keys.
 *   A submitted form is only a request; DODO staff verify the requester and act by hand (see PROCESS.md).
 * - It never says whether an account exists. The reply is the same for any email address (no account enumeration).
 * - It never sends an email to the address typed in the form (that would let anyone send mail to strangers, and
 *   would reveal the inbox address). DODO staff contact the requester after checking the account's own records.
 * - It never shows the inbox address. The address is never typed here and never sent to the browser.
 * - It accepts no passwords, codes, card or ID numbers: 6 or more digits in a row in the details are refused.
 *
 * Spam and abuse protection: hidden spam-trap field; field length limits; website links refused; a script lock so
 * two identical taps produce one record; the same email address is accepted at most 2 times in 6 hours (further
 * repeats get the same "received" reply but are not recorded or emailed again); at most 30 requests an hour in total.
 *
 * Google limits: MailApp can email 100 recipients a day from a personal Google account (1,500 from Google Workspace).
 * Each request uses 1. If this runs in the same Google account as the other DODO relays, they share the limit.
 *
 * Deploy (only with the owner's approval), signed in to the Google account that should receive the requests:
 *   1. https://script.google.com > New project. Name it "DODO account deletion relay". Paste this file. Save.
 *   2. Choose the function setupDeletionLog and click Run. Allow the permissions (Sheets, Drive file, Send email).
 *      It creates the private sheet in this account's Google Drive and remembers its ID. Do not share the sheet.
 *   3. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone. Deploy.
 *   4. Open the Web app URL: it must show {"ok":true,"service":"DODO account deletion relay",...}.
 *   5. Put the URL in site-config.js as accountDeletionRelay.url with enabled: true (only after the staging test).
 * Updates: Deploy > Manage deployments > Edit > Version: New version > Deploy (the URL stays the same).
 */

var VERSION = '2026-11-01-deletion';
var SHEET_NAME = 'Requests';
var PROP_SHEET_ID = 'DELETION_LOG_SHEET_ID';
var ACCOUNT_TYPES = { driver: 'DODO Driver', rider: 'DODO Rider', both: 'DODO Driver and DODO Rider' };
var LIMITS = { email: 254, phone: 30, details: 1000 };
var AU_PHONE = /^\s*(\+?61|0)\s*[2-478](\s*\d){8}\s*$/;
var LINK = /(https?:\/\/|www\.)/i;
var SECRET_NUMBER = /(?:\d[\s-]?){6,}/;      // card numbers, one-time codes, licence or other ID numbers
var MAX_PER_EMAIL = 2;                         // recorded requests per email address
var EMAIL_WINDOW_S = 6 * 3600;                 // 6 hours (the CacheService maximum)
var MAX_PER_HOUR = 30;                         // recorded requests per hour, all addresses together
var RECEIVED = { ok: true };                   // the one reply for every accepted (or quietly ignored) request
var HEADERS = ['Received (Queensland time)', 'Reference', 'Account type', 'Email given', 'Phone given', 'Details given',
  'Status', 'Identity verified by / how', 'Verified on', 'Outcome (deleted / de-identified / kept and why)',
  'Confirmation sent on', 'Staff notes'];

function doPost(e) {
  var p = (e && e.parameter) || {};
  if (p.form !== 'account_deletion') return json_({ ok: false, error: 'This service accepts account deletion requests only.' });
  if (String(p.company_website || '').trim()) return json_(RECEIVED); // spam trap: nothing is recorded or sent

  var v = {};
  ['account_type', 'email', 'phone', 'details', 'confirm'].forEach(function (f) {
    v[f] = String(p[f] || '').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ').trim();
  });
  v.account_type = v.account_type.toLowerCase();
  v.email = v.email.toLowerCase();

  if (!ACCOUNT_TYPES.hasOwnProperty(v.account_type)) return json_({ ok: false, error: 'Please choose your account type.' });
  if (!v.email) return json_({ ok: false, error: 'Please enter the email address registered to your DODO account.' });
  for (var f in LIMITS) if (v[f].length > LIMITS[f]) return json_({ ok: false, error: 'The ' + f + ' field is too long.' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) return json_({ ok: false, error: 'Please enter a valid email address.' });
  if (v.phone && !AU_PHONE.test(v.phone)) return json_({ ok: false, error: 'Please enter an Australian phone number, for example 0412 345 678, or leave it blank.' });
  if (v.confirm !== 'yes') return json_({ ok: false, error: 'Please tick the box to confirm you are asking DODO to delete your account.' });
  if (LINK.test(v.details)) return json_({ ok: false, error: 'Please remove website links from the additional information.' });
  if (SECRET_NUMBER.test(v.details)) {
    return json_({ ok: false, error: "Please remove long numbers from the additional information. Never send passwords, codes, card numbers or ID numbers." });
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return json_({ ok: false, error: 'We are busy right now. Please try again in a minute.' });
  try {
    var cache = CacheService.getScriptCache();
    var emailKey = 'email:' + hash_(v.email);
    var emailCount = Number(cache.get(emailKey) || 0);
    // Same reply as a new request, so the reply never reveals anything about an address. Not recorded again.
    if (emailCount >= MAX_PER_EMAIL) return json_(RECEIVED);
    var hourKey = 'hour:' + Utilities.formatDate(new Date(), 'Etc/UTC', 'yyyyMMddHH');
    var hourCount = Number(cache.get(hourKey) || 0);
    if (hourCount >= MAX_PER_HOUR || MailApp.getRemainingDailyQuota() < 1) {
      return json_({ ok: false, error: 'Online requests are temporarily unavailable.' });
    }

    var ref = 'DEL-' + Utilities.formatDate(new Date(), 'Australia/Brisbane', 'yyyyMMdd') + '-' +
      Utilities.getUuid().replace(/-/g, '').slice(0, 6).toUpperCase();
    var received = Utilities.formatDate(new Date(), 'Australia/Brisbane', 'yyyy-MM-dd HH:mm');

    var logged = false;
    try {
      var sheet = logSheet_();
      // Leading quote: a value starting with = + - @ is stored as text, never run as a formula.
      sheet.appendRow([received, ref, ACCOUNT_TYPES[v.account_type], safeCell_(v.email), safeCell_(v.phone),
        safeCell_(v.details), 'Received: identity not yet verified', '', '', '', '', '']);
      logged = true;
    } catch (err) { /* reported in the email below */ }

    var body = [
      'DODO account deletion REQUEST (www.dodotransport.com.au/delete-account)',
      '',
      'Reference: ' + ref,
      'Received: ' + received + ' (Queensland time)',
      'Account type: ' + ACCOUNT_TYPES[v.account_type],
      'Email given: ' + v.email,
      'Phone given: ' + (v.phone || '(none)'),
      'Additional information: ' + (v.details || '(none)'),
      '',
      logged ? 'Recorded in the private sheet "DODO account deletion requests".'
             : 'WARNING: this request could NOT be recorded in the private sheet. Add it by hand.',
      '',
      'NOTHING HAS BEEN DELETED. Do not delete anything until the identity check is done.',
      'The details above were typed by the requester and are NOT verified. Before acting, follow PROCESS.md:',
      '1. Find the account by the email given. Do not tell the requester whether an account exists.',
      '2. Verify the account holder using the contact details held in the DODO account (not only the details above).',
      '   Contact them only as DODO Support (in-app support chat, 0415 152 099, or an @dodotransport.com.au mailbox).',
      '   Never reply to the requester from this inbox.',
      '3. Check for active trips, unpaid amounts, pending payouts, disputes and safety matters.',
      '4. Delete or de-identify what is no longer needed; keep only the records the law requires (Privacy Policy s21-23).',
      '5. Tell the account holder when the request has been processed, and update the sheet.'
    ].join('\n');
    try {
      MailApp.sendEmail({
        to: Session.getEffectiveUser().getEmail(),
        subject: 'DODO account deletion request ' + ref + ' (' + ACCOUNT_TYPES[v.account_type] + ')',
        body: body,
        name: 'DODO account deletion requests'
      });
    } catch (err) {
      if (!logged) return json_({ ok: false, error: 'Your request could not be sent. Please try again later.' });
    }
    cache.put(emailKey, String(emailCount + 1), EMAIL_WINDOW_S);
    cache.put(hourKey, String(hourCount + 1), 3600);
    return json_({ ok: true, reference: ref });
  } finally {
    lock.releaseLock();
  }
}

function doGet() { return json_({ ok: true, service: 'DODO account deletion relay', version: VERSION }); }

/** Run once from the editor. Creates the private log sheet (or reuses it) and stores its ID. */
function setupDeletionLog() {
  var sheet = logSheet_();
  Logger.log('Deletion request log ready: ' + sheet.getParent().getName() + '. Keep it private: do not share it.');
}

function logSheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(PROP_SHEET_ID);
  var ss = null;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create('DODO account deletion requests');
    props.setProperty(PROP_SHEET_ID, ss.getId());
  }
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.getSheets()[0];
    sheet.setName(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function safeCell_(s) { return /^[=+\-@]/.test(s) ? "'" + s : s; }

function hash_(s) { return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s)); }

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
