/* DODO Transport — shared front-end logic: secure form submission + map */

/* ------------------------------------------------------------------ Website forms
 * Pre-booking, Contact us and Driver application each post to their own Supabase Edge Function:
 *   website-booking-request, website-contact-message, website-driver-application
 * The function validates and saves the form, emails DODO's inbox for that form, and emails the
 * person an acknowledgement. Only the public (anon) key is used here; the Resend key and the
 * database service key stay on the server. No PHP is needed, so this works on GitHub Pages.
 *
 * What the page shows:
 *   saved + DODO's inbox emailed   -> success, with the reference and whether the copy was emailed
 *   saved, DODO's email failed     -> warning: saved (reference shown) but not yet delivered; retry
 *   not saved                      -> error, never a success message
 * Each set of details gets one request id, kept for this browser tab until it succeeds, so repeat
 * clicks and retries after a timeout never create a second record or send a second email.
 */
const SITE_CONFIG = window.DODO_SITE_CONFIG || {};
const SUPABASE_URL = SITE_CONFIG.supabaseUrl || "https://gobsccsryhavpwqpiujz.supabase.co";
const SUPABASE_ANON_KEY = SITE_CONFIG.supabaseAnonKey || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdvYnNjY3NyeWhhdnB3cXBpdWp6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM1MzA0OTksImV4cCI6MjA5OTEwNjQ5OX0.1p-TFhjBQVk7nuYVJO2LGvYzJlqW7GS31y6NSOxPSKg";
const functionUrl = (name, override) => override || `${SUPABASE_URL}/functions/v1/${name}`;
const FORM_TIMEOUT_MS = 25000;
// Public key only. A publishable key (sb_publishable_...) goes in "apikey"; a legacy anon key is a JWT and
// also goes in "Authorization", as Supabase expects. Never put a secret or service-role key in this file.
const PUBLIC_KEY_HEADERS = Object.assign({ "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
  /^eyJ/.test(SUPABASE_ANON_KEY) ? { Authorization: `Bearer ${SUPABASE_ANON_KEY}` } : {});
const DODO_PHONE = "0415 152 099";

function newRequestId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
  const b = new Uint8Array(16);
  window.crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function setFormFeedback(el, kind, html) {
  if (!el) return;
  el.classList.remove("is-success", "is-error", "is-pending", "is-warning");
  if (kind) el.classList.add(`is-${kind}`);
  el.setAttribute("role", kind === "error" || kind === "warning" ? "alert" : "status");
  el.innerHTML = html;
}

// One line per step, so "saved" and "emailed" are never confused.
function deliveryList(items) {
  return `<ul class="delivery-status">${items
    .map(([ok, text]) => `<li class="${ok ? "is-done" : "is-missing"}"><span class="mark" aria-hidden="true">${ok ? "✓" : "!"}</span><span>${text}</span></li>`)
    .join("")}</ul>`;
}

/**
 * opts: endpoint, fields (names sent), storeKey, feedbackId, labels {field: "your name"},
 *       noun ("booking request"), buttonName, sendingText, success(body, values) -> html
 */
// Launch switch (site-config.js): a form set to "off" is shown as temporarily unavailable, with the phone number.
function showFormUnavailable(formEl, feedbackId, message) {
  formEl.classList.add("is-unavailable");
  formEl.querySelectorAll("input, select, textarea, button").forEach((el) => { el.disabled = true; });
  const button = formEl.querySelector('button[type="submit"]');
  if (button) button.hidden = true;
  formEl.addEventListener("submit", (e) => e.preventDefault());
  const fb = document.getElementById(feedbackId);
  setFormFeedback(fb, "warning", `<strong>${message}</strong> Please call us on <a href="tel:0415152099">${DODO_PHONE}</a>.`);
  if (fb) fb.setAttribute("role", "status");
}

// A form opens only when its switch is exactly "on" (a missing or misspelt switch keeps it closed).
// Against the production backend it also needs productionFormsVerified: true, which is set only after
// the production form tests pass. Until then visitors see the phone number, never a failing form.
const PRODUCTION_SUPABASE_URL = "https://gobsccsryhavpwqpiujz.supabase.co";
function formEnabled(switchName) {
  if ((SITE_CONFIG.forms || {})[switchName] !== "on") return false;
  return SUPABASE_URL.replace(/\/+$/, "") !== PRODUCTION_SUPABASE_URL || SITE_CONFIG.productionFormsVerified === true;
}

function wireSecureForm(formEl, opts) {
  if (!formEl) return;
  if (!formEnabled(opts.switchName)) {
    showFormUnavailable(formEl, opts.feedbackId, opts.unavailableText);
    return;
  }
  const feedback = document.getElementById(opts.feedbackId);
  const button = formEl.querySelector('button[type="submit"]');
  const buttonLabel = button ? button.textContent : "";
  const store = {
    read() { try { return JSON.parse(sessionStorage.getItem(opts.storeKey) || "null"); } catch (e) { return null; } },
    write(v) {
      try { if (v) sessionStorage.setItem(opts.storeKey, JSON.stringify(v)); else sessionStorage.removeItem(opts.storeKey); }
      catch (e) { /* storage unavailable: the in-memory id still covers repeat clicks */ }
    },
  };
  let inFlight = false;
  let current = store.read(); // { fingerprint, requestId }

  const values = () => {
    const data = new FormData(formEl);
    const v = {};
    for (const f of opts.fields) v[f] = String(data.get(f) || "").trim();
    v.company_website = String(data.get("company_website") || "");
    return v;
  };
  const fingerprint = (v) => opts.fields.map((f) => v[f]).join("␟");
  const again = `press <strong>${escapeHtml(opts.buttonName)}</strong> again`;

  const setBusy = (busy) => {
    inFlight = busy;
    if (!button) return;
    button.disabled = busy;
    button.setAttribute("aria-busy", busy ? "true" : "false");
    button.textContent = busy ? "Sending…" : buttonLabel;
  };

  formEl.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (inFlight) return; // repeat click while a request is running
    if (typeof formEl.reportValidity === "function" && !formEl.reportValidity()) return;

    const v = values();
    const fp = fingerprint(v);
    if (!current || current.fingerprint !== fp) {
      current = { fingerprint: fp, requestId: newRequestId() };
      store.write(current);
    }

    setBusy(true);
    setFormFeedback(feedback, "pending", escapeHtml(opts.sendingText));

    let res = null;
    let body = null;
    let timedOut = false;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => { timedOut = true; controller.abort(); }, FORM_TIMEOUT_MS) : null;
    try {
      res = await fetch(opts.endpoint, {
        method: "POST",
        headers: PUBLIC_KEY_HEADERS,
        body: JSON.stringify({ request_id: current.requestId, ...v }),
        signal: controller ? controller.signal : undefined,
      });
      body = await res.json().catch(() => null);
    } catch (err) {
      console.error(`${opts.noun} failed:`, err);
    } finally {
      if (timer) clearTimeout(timer);
    }

    const ref = body && typeof body.reference === "string" ? escapeHtml(body.reference) : "";
    if (res && res.ok && body && body.ok === true && body.saved === true && ref) {
      setFormFeedback(feedback, "success", opts.success(body, v, ref));
      formEl.reset();
      formEl.querySelectorAll("[data-clear-on-reset]").forEach((el) => { el.value = ""; });
      current = null;
      store.write(null);
      setBusy(false);
      return;
    }

    const code = body && body.error;
    let kind = "error";
    let msg;
    if (body && body.saved === true && code === "NOTIFICATION_FAILED" && ref) {
      // Stored, but DODO's inbox has not been told yet. Not a success.
      kind = "warning";
      msg = `<strong>Saved, but not yet delivered.</strong>` +
        deliveryList([[true, `Saved with reference <strong>${ref}</strong>`], [false, "We couldn't email our team yet"]]) +
        `Please ${again} in a minute to finish sending it; it won't be sent twice. Or call us on ${DODO_PHONE} and quote your reference.`;
    } else if (timedOut || (!res && !body)) {
      msg = timedOut
        ? `We couldn't confirm that your ${opts.noun} reached us. Please ${again}; it won't be sent twice. Or call us on ${DODO_PHONE}.`
        : `We couldn't reach DODO. Check your internet connection and ${again}, or call us on ${DODO_PHONE}.`;
    } else if (code === "VALIDATION_FAILED" && Array.isArray(body.fields)) {
      const named = body.fields.map((f) => opts.labels[f]).filter(Boolean);
      msg = named.length
        ? `Please check ${named.join(", ")} and try again.`
        : `Please check your details and try again, or call us on ${DODO_PHONE}.`;
    } else if (code === "REQUEST_ID_CONFLICT") {
      current = null;
      store.write(null);
      msg = `Your details changed while we were sending them. Please ${again}.`;
    } else if (code === "TOO_MANY_REQUESTS") {
      msg = `We've had several requests from you in a short time, so this one wasn't sent. Please try again later, or call us on ${DODO_PHONE}.`;
    } else {
      msg = `Sorry, your ${opts.noun} wasn't sent. Please try again, or call us on ${DODO_PHONE}.`;
    }
    setFormFeedback(feedback, kind, msg);
    setBusy(false);
  });
}

const COMMON_LABELS = {
  name: "your name",
  full_name: "your full name",
  email: "your email address",
  phone: "your phone number",
  form: "the form",
};

function wireBookingForm(formEl, { feedbackId }) {
  wireSecureForm(formEl, {
    endpoint: functionUrl("website-booking-request", SITE_CONFIG.bookingEndpoint),
    fields: ["name", "service", "pickup_address", "destination", "travel_date", "travel_time", "email", "phone",
      "pickup_lat", "pickup_lng", "destination_lat", "destination_lng"],
    storeKey: "dodo_booking_request",
    switchName: "booking",
    unavailableText: "Online pre-booking is temporarily unavailable.",
    feedbackId,
    noun: "booking request",
    buttonName: "Request booking",
    sendingText: "Sending your booking request…",
    labels: {
      ...COMMON_LABELS,
      service: "the ride type",
      pickup_address: "the pickup address",
      destination: "the destination",
      travel_date: "the date",
      travel_time: "the time",
      requested_time: "a date and time from now up to 90 days ahead (Queensland time)",
      pickup_location: "the pickup pin (tap the map again, or type the address)",
      destination_location: "the destination pin (tap the map again, or type the address)",
    },
    success: (b, v, ref) => {
      const acked = b.delivery && b.delivery.acknowledgement === "sent";
      return `<strong>Booking request received.</strong> Your reference is <strong>${ref}</strong>.` +
        deliveryList([
          [true, "Saved"],
          [true, "Sent to the DODO team"],
          [acked, acked ? `We've emailed a copy to ${escapeHtml(v.email)}` : "We couldn't email you a copy, so please keep this reference"],
        ]) +
        `This is a request only: a driver hasn't been assigned yet. We'll contact you to confirm your ride.`;
    },
  });
}

function wireContactForm(formEl, { feedbackId }) {
  wireSecureForm(formEl, {
    endpoint: functionUrl("website-contact-message", SITE_CONFIG.contactEndpoint),
    fields: ["name", "email", "phone", "message"],
    storeKey: "dodo_contact_message",
    switchName: "contact",
    unavailableText: "The contact form is temporarily unavailable.",
    feedbackId,
    noun: "message",
    buttonName: "Send message",
    sendingText: "Sending your message…",
    labels: { ...COMMON_LABELS, phone: "your phone number (or leave it blank)", message: "your message (at least 10 characters)" },
    success: (b, v, ref) => {
      const acked = b.delivery && b.delivery.acknowledgement === "sent";
      return `<strong>Message received.</strong> Your reference is <strong>${ref}</strong>.` +
        deliveryList([
          [true, "Saved"],
          [true, "Sent to the DODO team"],
          [acked, acked ? `We've emailed a confirmation to ${escapeHtml(v.email)}` : "We couldn't email you a confirmation, so please keep this reference"],
        ]) +
        `Our team will reply to ${escapeHtml(v.email)}.`;
    },
  });
}

function wireDriverApplicationForm(formEl, { feedbackId }) {
  wireSecureForm(formEl, {
    endpoint: functionUrl("website-driver-application", SITE_CONFIG.driverApplicationEndpoint),
    fields: ["full_name", "email", "phone", "state", "home_state", "license_length", "has_abn", "vehicle_details"],
    storeKey: "dodo_driver_application",
    switchName: "driverApplication",
    unavailableText: "Online driver applications are temporarily unavailable.",
    feedbackId,
    noun: "application",
    buttonName: "Submit application",
    sendingText: "Sending your application…",
    labels: {
      ...COMMON_LABELS,
      state: "the state you will drive in",
      home_state: "the state you live in",
      license_length: "how long you've held your licence (no web links)",
      has_abn: "whether you have an ABN",
      vehicle_details: "the vehicle details (up to 500 characters, no web links)",
    },
    success: (b, v, ref) => {
      const acked = b.delivery && b.delivery.acknowledgement === "sent";
      return `<strong>Application received.</strong> Your reference is <strong>${ref}</strong>.` +
        deliveryList([
          [true, "Saved"],
          [true, "Sent to DODO's driver team"],
          [acked, acked ? `We've emailed a confirmation to ${escapeHtml(v.email)}` : "We couldn't email you a confirmation, so please keep this reference"],
        ]) +
        `This isn't an approval yet. We'll contact you about uploading your documents securely in the DODO Driver app. Please don't email documents to us.`;
    },
  });
}

/* Fades/slides .reveal elements in as they scroll into view. */
function initReveal() {
  const els = document.querySelectorAll(".reveal");
  if (!els.length) return;
  if (typeof IntersectionObserver === "undefined") {
    els.forEach((el) => el.classList.add("is-visible"));
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
  );
  els.forEach((el) => observer.observe(el));
}

/* ---------- Map + location picker ----------
 * Google Maps when a referrer-restricted browser key is set in maps-config.js,
 * otherwise MapLibre GL with OpenFreeMap tiles (free, no key, commercial use allowed).
 * Tapping the map, dragging a pin or "Use my location" fills the Pickup or
 * Destination field of the pre-booking form.
 */
const BRISBANE = { lat: -27.4705, lng: 153.026 };
const MAPLIBRE_VERSION = "4.7.1";
const OPENFREEMAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const PIN_COLORS = { pickup: "#ff6a00", destination: "#0f172a" };

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(s);
  });
}

function loadStyle(href) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = href;
  document.head.appendChild(l);
}

/* Nominatim policy: user-triggered only, at most 1 request per second, results cached,
   attribution shown (credited under the map). */
let lastNominatimCall = 0;
const nominatimCache = new Map();
async function nominatimReverse(lat, lng) {
  const cacheKey = `${lat.toFixed(5)},${lng.toFixed(5)}`; // ~1 m
  if (nominatimCache.has(cacheKey)) return nominatimCache.get(cacheKey);
  const address = await nominatimFetch(lat, lng);
  if (address) nominatimCache.set(cacheKey, address);
  return address;
}
async function nominatimFetch(lat, lng) {
  const wait = lastNominatimCall + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatimCall = Date.now();
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&lat=${lat}&lon=${lng}`;
  const res = await fetch(url, { headers: { "Accept-Language": "en-AU" } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const data = await res.json();
  return data.display_name || null;
}

async function createOpenFreeMap(el, onPick) {
  loadStyle(`https://cdn.jsdelivr.net/npm/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css`);
  if (typeof maplibregl === "undefined") {
    await loadScript(`https://cdn.jsdelivr.net/npm/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.js`);
  }
  const map = new maplibregl.Map({
    container: el,
    style: OPENFREEMAP_STYLE,
    center: [BRISBANE.lng, BRISBANE.lat],
    zoom: 10,
    cooperativeGestures: true, // two-finger pan on phones so the page still scrolls
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  await new Promise((resolve, reject) => {
    map.once("load", resolve);
    map.once("error", (e) => reject(e.error || new Error("Map style failed to load")));
  });
  map.on("click", (e) => onPick(e.lngLat.lat, e.lngLat.lng));

  const markers = {};
  return {
    name: "OpenFreeMap",
    setView(lat, lng, zoom) {
      map.flyTo({ center: [lng, lat], zoom, essential: true });
    },
    setMarker(kind, lat, lng) {
      if (!markers[kind]) {
        markers[kind] = new maplibregl.Marker({ color: PIN_COLORS[kind], draggable: true }).setLngLat([lng, lat]).addTo(map);
        markers[kind].on("dragend", () => {
          const p = markers[kind].getLngLat();
          onPick(p.lat, p.lng, kind);
        });
      } else {
        markers[kind].setLngLat([lng, lat]);
      }
    },
    reverseGeocode: nominatimReverse,
  };
}

async function createGoogleMap(el, onPick, { googleBrowserKey, googleMapId }) {
  await new Promise((resolve, reject) => {
    window.__dodoGoogleMapsReady = resolve;
    const src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(googleBrowserKey)}`
      + "&v=weekly&loading=async&callback=__dodoGoogleMapsReady";
    loadScript(src).catch(reject);
  });
  const { Map } = await google.maps.importLibrary("maps");
  const { Geocoder } = await google.maps.importLibrary("geocoding");
  const useAdvanced = !!googleMapId;
  const markerLib = await google.maps.importLibrary("marker");

  const map = new Map(el, {
    center: BRISBANE,
    zoom: 10,
    mapId: googleMapId || undefined,
    gestureHandling: "cooperative",
    streetViewControl: false,
    mapTypeControl: false,
    fullscreenControl: false,
  });
  map.addListener("click", (e) => onPick(e.latLng.lat(), e.latLng.lng()));
  const geocoder = new Geocoder();

  const markers = {};
  return {
    name: "Google Maps",
    setView(lat, lng, zoom) {
      map.panTo({ lat, lng });
      map.setZoom(zoom);
    },
    setMarker(kind, lat, lng) {
      const position = { lat, lng };
      if (markers[kind]) {
        markers[kind].position = position;
        if (markers[kind].setPosition) markers[kind].setPosition(position);
        return;
      }
      if (useAdvanced) {
        const pin = new markerLib.PinElement({ background: PIN_COLORS[kind], borderColor: "#ffffff", glyphColor: "#ffffff" });
        markers[kind] = new markerLib.AdvancedMarkerElement({ map, position, content: pin.element, gmpDraggable: true });
        markers[kind].addListener("dragend", () => {
          const p = markers[kind].position;
          onPick(typeof p.lat === "function" ? p.lat() : p.lat, typeof p.lng === "function" ? p.lng() : p.lng, kind);
        });
      } else {
        markers[kind] = new google.maps.Marker({
          map, position, draggable: true,
          icon: { path: google.maps.SymbolPath.CIRCLE, scale: 9, fillColor: PIN_COLORS[kind], fillOpacity: 1, strokeColor: "#ffffff", strokeWeight: 3 },
        });
        markers[kind].addListener("dragend", (e) => onPick(e.latLng.lat(), e.latLng.lng(), kind));
      }
    },
    async reverseGeocode(lat, lng) {
      const { results } = await geocoder.geocode({ location: { lat, lng } });
      return results && results[0] ? results[0].formatted_address : null;
    },
  };
}

/**
 * opts: { mapId, statusId, locateBtnId, targetName, fields: { pickup, destination } }
 * targetName is the name of the radio group that chooses which field a map tap fills.
 */
function initLocationMap(opts) {
  const el = document.getElementById(opts.mapId);
  if (!el) return;
  const status = document.getElementById(opts.statusId);
  const locateBtn = document.getElementById(opts.locateBtnId);
  const radios = Array.from(document.querySelectorAll(`input[name="${opts.targetName}"]`));
  const config = window.DODO_MAPS_CONFIG || {};
  let provider = null;
  let pickSeq = 0;

  const setStatus = (msg, isError) => {
    if (!status) return;
    status.textContent = msg;
    status.classList.toggle("is-error", !!isError);
  };
  const currentTarget = () => (radios.find((r) => r.checked) || { value: "pickup" }).value;
  const selectTarget = (kind) => radios.forEach((r) => (r.checked = r.value === kind));
  const label = (kind) => (kind === "pickup" ? "Pickup" : "Destination");
  const coordInputs = (kind) => ((opts.coords && opts.coords[kind]) || []).map((id) => document.getElementById(id));
  function setCoords(kind, lat, lng) {
    const [latEl, lngEl] = coordInputs(kind);
    if (latEl && lngEl) { latEl.value = lat === null ? "" : lat.toFixed(6); lngEl.value = lng === null ? "" : lng.toFixed(6); }
  }
  // A rider who types over a pinned address no longer matches the pin, so the pin's coordinates are dropped.
  ["pickup", "destination"].forEach((kind) => {
    const input = document.getElementById(opts.fields[kind]);
    if (input) input.addEventListener("input", (e) => { if (e.isTrusted) setCoords(kind, null, null); });
  });

  async function pick(lat, lng, kind) {
    if (!provider) return;
    kind = kind || currentTarget();
    const input = document.getElementById(opts.fields[kind]);
    const seq = ++pickSeq;
    provider.setMarker(kind, lat, lng);
    setStatus(`Finding the ${label(kind).toLowerCase()} address...`, false);
    let address = null;
    try {
      address = await provider.reverseGeocode(lat, lng);
    } catch (err) {
      console.warn("Reverse geocoding failed:", err);
    }
    if (seq !== pickSeq) return; // a newer pick has replaced this one
    if (input) {
      input.value = address || `Pinned location ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    setCoords(kind, lat, lng);
    setStatus(
      address
        ? `${label(kind)} set. Drag the pin to adjust.`
        : `${label(kind)} pinned. We couldn't look up the street address, so please check the field above.`,
      !address
    );
    if (kind === "pickup" && input && document.getElementById(opts.fields.destination)?.value === "") {
      selectTarget("destination");
    }
  }

  function locate() {
    if (!provider) return;
    if (!navigator.geolocation) {
      setStatus("Location services are not available in this browser.", true);
      return;
    }
    setStatus("Finding your location...", false);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        provider.setView(latitude, longitude, 15);
        pick(latitude, longitude, "pickup");
      },
      () => setStatus("Couldn't get your location. Tap the map to set your pickup instead.", true),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  async function start(useGoogle) {
    el.replaceChildren();
    setStatus("Loading map...", false);
    try {
      provider = useGoogle ? await createGoogleMap(el, pick, config) : await createOpenFreeMap(el, pick);
      el.dataset.provider = provider.name;
      setStatus("Tap the map to set your pickup, or use your location.", false);
    } catch (err) {
      console.error("Map failed to load:", err);
      provider = null;
      if (useGoogle) return start(false);
      el.classList.add("map-failed");
      setStatus("The map couldn't load. You can still type your pickup and destination above.", true);
    }
  }

  // Google calls this if the key is rejected (wrong domain, API off, billing).
  window.gm_authFailure = () => {
    console.warn("Google Maps rejected the browser key; switching to OpenFreeMap.");
    start(false);
  };

  if (locateBtn) locateBtn.addEventListener("click", locate);
  start(!!config.googleBrowserKey);
}

/* Site chrome: sticky header shadow, mobile menu, footer year, state tabs, legal contents. */
function initSite() {
  const header = document.querySelector(".site-header");
  if (header) {
    const onScroll = () => header.classList.toggle("scrolled", window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    const toggle = header.querySelector(".nav-toggle");
    if (toggle) {
      toggle.addEventListener("click", () => {
        const open = header.classList.toggle("nav-open");
        toggle.setAttribute("aria-expanded", String(open));
      });
      header.querySelectorAll(".nav-links a").forEach((a) =>
        a.addEventListener("click", () => {
          header.classList.remove("nav-open");
          toggle.setAttribute("aria-expanded", "false");
        })
      );
    }
  }

  document.querySelectorAll("[data-year]").forEach((el) => (el.textContent = new Date().getFullYear()));

  document.querySelectorAll("[role=tablist]").forEach((list) => {
    const tabs = Array.from(list.querySelectorAll("[role=tab]"));
    tabs.forEach((tab) =>
      tab.addEventListener("click", () => {
        tabs.forEach((t) => {
          const selected = t === tab;
          t.setAttribute("aria-selected", String(selected));
          const panel = document.getElementById(t.getAttribute("aria-controls"));
          if (panel) panel.hidden = !selected;
        });
      })
    );
  });

  const tocLinks = document.querySelectorAll(".toc a");
  if (tocLinks.length && typeof IntersectionObserver !== "undefined") {
    const byId = new Map(Array.from(tocLinks).map((a) => [a.getAttribute("href").slice(1), a]));
    const spy = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          tocLinks.forEach((a) => a.classList.remove("active"));
          const link = byId.get(entry.target.id);
          if (link) link.classList.add("active");
        });
      },
      { rootMargin: "-90px 0px -70% 0px" }
    );
    byId.forEach((_, id) => {
      const el = document.getElementById(id);
      if (el) spy.observe(el);
    });
  }

  initReveal();
}
