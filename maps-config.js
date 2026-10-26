/* DODO Transport — public map settings for the website.
 *
 * Everything in this file is downloaded by every visitor, so it must only ever
 * hold a BROWSER key. Never put a server key, a Supabase service-role key or an
 * unrestricted Google key here.
 *
 * googleBrowserKey
 *   Leave empty to use the free OpenFreeMap map (no key needed).
 *   To use Google Maps instead, create a dedicated website key in Google Cloud
 *   (do not reuse the Rider app's Android/iOS keys) and restrict it to:
 *     - Application restriction: Websites (HTTP referrers)
 *         https://dodotransport.com.au/*
 *         https://www.dodotransport.com.au/*
 *     - API restriction: Maps JavaScript API, Geocoding API
 *   If the key is rejected (wrong domain, API not enabled, billing off), the
 *   site falls back to OpenFreeMap automatically.
 *
 * googleMapId (optional)
 *   A Google Cloud Map ID. When set, Google's current Advanced Markers are used;
 *   when empty, the classic marker is used.
 */
window.DODO_MAPS_CONFIG = {
  googleBrowserKey: "",
  googleMapId: "",
};
