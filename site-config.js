// DODO website launch switches. PUBLIC settings only: never put a secret key here.
// All three forms stay CLOSED until production is restored and the production form tests pass
// (docs/PRODUCTION-PLAN.md). Closed forms show "temporarily unavailable, please call 0415 152 099".
// To open a form, BOTH are needed: its switch set to "on", and productionFormsVerified: true.
// Anything else (missing value, typo, "on" without verification) keeps the form closed.
window.DODO_SITE_CONFIG = Object.assign({
  forms: {
    booking: "off",            // Rider pre-booking
    contact: "off",            // Contact us
    driverApplication: "off",  // Driver application
  },
  productionFormsVerified: false,  // set to true only after the production form tests PASS
}, window.DODO_SITE_CONFIG || {});
