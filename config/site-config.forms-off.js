// LAUNCH OPTION B (forms off): copy over site/site-config.js to publish with all three forms showing "temporarily unavailable, please call".
// DODO website launch switches. PUBLIC settings only: never put a secret key here.
// Turn a form "off" when its backend or email delivery is not ready. The form then shows
// "temporarily unavailable, please call 0415 152 099" instead of failing.
window.DODO_SITE_CONFIG = Object.assign({
  forms: {
    booking: "off",            // Rider pre-booking
    contact: "off",            // Contact us
    driverApplication: "off",  // Driver application
  },
}, window.DODO_SITE_CONFIG || {});
