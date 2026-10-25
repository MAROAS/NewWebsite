// OPTIONAL website configuration. Copy to the site as site-config.js and load it BEFORE app.js:
//   <script src="site-config.js"></script>
// Only PUBLIC values belong here. Never a secret key (sb_secret_...) or service_role key, never a Resend key.
// Without this file the site uses the production project built into app.js.
window.DODO_SITE_CONFIG = {
  supabaseUrl: "https://<project-ref>.supabase.co",
  supabaseAnonKey: "<publishable key sb_publishable_... or legacy anon public key>",
  // Optional overrides (default: <supabaseUrl>/functions/v1/<name>):
  // bookingEndpoint: "",
  // contactEndpoint: "",
  // driverApplicationEndpoint: "",
};
