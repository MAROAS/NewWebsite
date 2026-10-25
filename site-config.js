// DODO website launch switches. PUBLIC settings only: never put a secret key here.
// Turn a form "off" when its backend or email delivery is not ready. The form then shows
// "temporarily unavailable, please call 0415 152 099" instead of failing.
window.DODO_SITE_CONFIG = Object.assign({
  forms: {
    booking: "on",            // Rider pre-booking
    contact: "on",            // Contact us
    driverApplication: "on",  // Driver application
  },
}, window.DODO_SITE_CONFIG || {});
