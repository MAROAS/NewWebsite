-- PRODUCTION COPY of 20261025120000_website_booking_requests (generated 2026-10-25).
-- NOT APPROVED. DO NOT RUN. Production (gobsccsryhavpwqpiujz) is paused; follow PRODUCTION-PLAN.md.
-- Identical to the staging file except the guard: replace __PRODUCTION_CLUSTER_ID__ with production's cluster id
-- (captured from the production backup, step P0); the script refuses DODO-Staging and every other database.
-- ================================================================
-- DODO website pre-booking requests — server-side save, reference and email tracking
-- Prepared 2026-10-25. NOT APPLIED. DO NOT RUN WITHOUT OWNER APPROVAL.
-- PRODUCTION COPY: refuses DODO-Staging; requires the production cluster id.
--
-- What it does
--   * booking_requests gets new columns only. Existing (historical) rows are not updated:
--     every new column is added without a default, so old rows keep NULL.
--   * website_submit_booking_request(): validates a request, saves it once per request_id
--     (repeat clicks / retries return the same booking), assigns a booking reference.
--     The same details sent again from the same email within 24 hours (e.g. a second tab) also
--     return the existing booking. Limits: 5 requests per email per 15 minutes, 10 per visitor
--     per hour (visitor = keyed hash of the IP address made by the Edge Function; no IP stored).
--     Web links are refused in the name and address fields (they are repeated in the rider's email).
--     Site-wide backstop: at most 200 website bookings per hour.
--     Optional map pins (pickup/destination latitude and longitude) are stored when the rider used the map.
--   * website_record_booking_email(): records whether each email was accepted by Resend.
--   * Both functions can be called by the service role only (the Edge Function). The public
--     (anon) key can no longer write to booking_requests directly.
--   * offer_amount becomes optional (the website has no fare-offer step). Values already stored
--     are untouched.
-- Rollback: 20261025120000_website_booking_requests_ROLLBACK.sql
-- ================================================================
-- ONE STATEMENT: the whole change runs inside the DO block below, so it applies completely or not at all,
-- whichever way the SQL Editor sends it. Paste and run the whole file.
DO $dodo_wrap$
BEGIN
EXECUTE $dodo_sql$

DO $guard$
DECLARE v_id text := (SELECT system_identifier FROM pg_control_system())::text;
BEGIN
  IF '__PRODUCTION_CLUSTER_ID__' !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'CLUSTER_ID_NOT_SET: replace __PRODUCTION_CLUSTER_ID__ with the production cluster id.';
  END IF;
  IF v_id = '7678069749886157684' THEN
    RAISE EXCEPTION 'REFUSED_ON_STAGING: this is the production copy.';
  END IF;
  IF v_id <> '__PRODUCTION_CLUSTER_ID__' THEN
    RAISE EXCEPTION 'WRONG_DATABASE: %', v_id;
  END IF;
  IF to_regclass('public.booking_requests') IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: public.booking_requests does not exist.';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'booking_requests' AND column_name = 'request_id') THEN
    RAISE EXCEPTION 'PREFLIGHT_ALREADY_APPLIED: booking_requests.request_id already exists.';
  END IF;
END $guard$;

SET LOCAL search_path = public, extensions;
SET LOCAL lock_timeout = '5s';

-- Row count and a fingerprint of every existing row, compared at the end.
CREATE TEMP TABLE _bk_before ON COMMIT DROP AS
SELECT count(*) AS n, COALESCE(md5(string_agg(to_jsonb(b)::text, '|' ORDER BY b.id)), '') AS fp
FROM public.booking_requests b;

-- ---------------------------------------------------------------- 1. Columns (no defaults => old rows untouched)
ALTER TABLE public.booking_requests
  ADD COLUMN request_id uuid,
  ADD COLUMN booking_reference text,
  ADD COLUMN requested_pickup_at timestamptz,
  ADD COLUMN requested_timezone text,
  ADD COLUMN source text,
  ADD COLUMN payload_hash text,
  ADD COLUMN dodo_notified_at timestamptz,
  ADD COLUMN dodo_notification_id text,
  ADD COLUMN rider_ack_sent_at timestamptz,
  ADD COLUMN rider_ack_id text,
  ADD COLUMN last_email_error text,
  ADD COLUMN email_attempts integer,
  ADD COLUMN updated_at timestamptz,
  ADD COLUMN client_hash text,
  ADD COLUMN pickup_lat numeric(9,6),
  ADD COLUMN pickup_lng numeric(9,6),
  ADD COLUMN destination_lat numeric(9,6),
  ADD COLUMN destination_lng numeric(9,6);

CREATE UNIQUE INDEX uq_booking_requests_request_id ON public.booking_requests (request_id) WHERE request_id IS NOT NULL;
CREATE UNIQUE INDEX uq_booking_requests_reference ON public.booking_requests (booking_reference) WHERE booking_reference IS NOT NULL;
CREATE INDEX idx_booking_requests_email_recent ON public.booking_requests (lower(email), created_at DESC);
CREATE INDEX idx_booking_requests_client_recent ON public.booking_requests (client_hash, created_at DESC) WHERE client_hash IS NOT NULL;

-- offer_amount: optional from now on (no stored value changes).
ALTER TABLE public.booking_requests ALTER COLUMN offer_amount DROP NOT NULL;

-- ---------------------------------------------------------------- 2. Public key: no direct writes
DROP POLICY IF EXISTS "anon can insert booking_requests" ON public.booking_requests;
REVOKE ALL ON public.booking_requests FROM anon, authenticated;
ALTER TABLE public.booking_requests ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------- 3. Save a website booking request
-- Returns jsonb: { ok, duplicate, booking_reference, request_id, ..., email flags } or { ok:false, error }.
-- Same request_id + same details => the existing booking (no new row). Same request_id + different
-- details => REQUEST_ID_CONFLICT. All times are Australia/Brisbane (no daylight saving).
CREATE FUNCTION public.website_submit_booking_request(
  p_request_id uuid,
  p_name text,
  p_email text,
  p_phone text,
  p_service text,
  p_pickup_address text,
  p_destination text,
  p_travel_date text,
  p_travel_time text,
  p_client_hash text DEFAULT NULL,
  p_pickup_lat text DEFAULT NULL,
  p_pickup_lng text DEFAULT NULL,
  p_destination_lat text DEFAULT NULL,
  p_destination_lng text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_name text := btrim(regexp_replace(COALESCE(p_name, ''), '\s+', ' ', 'g'));
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_phone text := btrim(COALESCE(p_phone, ''));
  v_phone_digits text := regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g');
  v_service text := btrim(COALESCE(p_service, ''));
  v_pickup text := btrim(regexp_replace(COALESCE(p_pickup_address, ''), '\s+', ' ', 'g'));
  v_dest text := btrim(regexp_replace(COALESCE(p_destination, ''), '\s+', ' ', 'g'));
  v_date date;
  v_time time;
  v_at timestamptz;
  v_hash text;
  v_row public.booking_requests%ROWTYPE;
  v_recent int;
  v_errors text[] := ARRAY[]::text[];
  v_plat numeric; v_plng numeric; v_dlat numeric; v_dlng numeric;
BEGIN
  IF p_request_id IS NULL THEN v_errors := v_errors || 'request_id'::text; END IF;
  -- Optional map pins: both values or neither, numeric, within Australia's bounding box.
  BEGIN
    IF NULLIF(btrim(COALESCE(p_pickup_lat, '')), '') IS NOT NULL OR NULLIF(btrim(COALESCE(p_pickup_lng, '')), '') IS NOT NULL THEN
      v_plat := btrim(p_pickup_lat)::numeric; v_plng := btrim(p_pickup_lng)::numeric;
      IF v_plat IS NULL OR v_plng IS NULL OR v_plat NOT BETWEEN -44 AND -9 OR v_plng NOT BETWEEN 112 AND 154 THEN RAISE invalid_text_representation; END IF;
    END IF;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN v_errors := v_errors || 'pickup_location'::text; v_plat := NULL; v_plng := NULL;
  END;
  BEGIN
    IF NULLIF(btrim(COALESCE(p_destination_lat, '')), '') IS NOT NULL OR NULLIF(btrim(COALESCE(p_destination_lng, '')), '') IS NOT NULL THEN
      v_dlat := btrim(p_destination_lat)::numeric; v_dlng := btrim(p_destination_lng)::numeric;
      IF v_dlat IS NULL OR v_dlng IS NULL OR v_dlat NOT BETWEEN -44 AND -9 OR v_dlng NOT BETWEEN 112 AND 154 THEN RAISE invalid_text_representation; END IF;
    END IF;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN v_errors := v_errors || 'destination_location'::text; v_dlat := NULL; v_dlng := NULL;
  END;
  IF length(v_name) NOT BETWEEN 2 AND 100 OR v_name ~* '(https?:|www\.|[<>])' THEN v_errors := v_errors || 'name'::text; END IF;
  IF length(v_email) > 254 OR v_email !~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' THEN v_errors := v_errors || 'email'::text; END IF;
  IF length(v_phone) > 30 OR v_phone !~ '^\+?[0-9 ()-]+$' OR length(v_phone_digits) NOT BETWEEN 8 AND 15 THEN
    v_errors := v_errors || 'phone'::text;
  END IF;
  IF v_service NOT IN ('DODO Priority', 'DODO X', 'DODO Economy', 'DODO Comfort', 'DODO BUSINESS', 'DODO Premium') THEN
    v_errors := v_errors || 'service'::text;
  END IF;
  IF length(v_pickup) NOT BETWEEN 3 AND 300 OR v_pickup ~* '(https?:|www\.)' THEN v_errors := v_errors || 'pickup_address'::text; END IF;
  IF length(v_dest) NOT BETWEEN 3 AND 300 OR v_dest ~* '(https?:|www\.)' THEN v_errors := v_errors || 'destination'::text; END IF;
  BEGIN
    IF COALESCE(p_travel_date, '') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE invalid_datetime_format; END IF;
    v_date := p_travel_date::date;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN v_errors := v_errors || 'travel_date'::text; END;
  BEGIN
    IF COALESCE(p_travel_time, '') !~ '^\d{2}:\d{2}(:\d{2})?$' THEN RAISE invalid_datetime_format; END IF;
    v_time := p_travel_time::time;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN v_errors := v_errors || 'travel_time'::text; END;

  IF v_date IS NOT NULL AND v_time IS NOT NULL THEN
    v_at := (v_date + v_time) AT TIME ZONE 'Australia/Brisbane';
    IF v_at < now() - interval '5 minutes' OR v_at > now() + interval '90 days' THEN
      v_errors := v_errors || 'requested_time'::text;
    END IF;
  END IF;

  IF cardinality(v_errors) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VALIDATION_FAILED', 'fields', to_jsonb(v_errors));
  END IF;

  v_plat := round(v_plat, 6); v_plng := round(v_plng, 6); v_dlat := round(v_dlat, 6); v_dlng := round(v_dlng, 6);
  v_hash := md5(concat_ws('|', v_name, v_email, v_phone, v_service, v_pickup, v_dest, v_date::text, v_time::text,
                          COALESCE(v_plat::text, '-'), COALESCE(v_plng::text, '-'), COALESCE(v_dlat::text, '-'), COALESCE(v_dlng::text, '-')));

  -- Serialise concurrent submissions of the same request, then of the same email address.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('website-booking:' || v_email, 0));

  SELECT * INTO v_row FROM public.booking_requests WHERE request_id = p_request_id;
  IF FOUND THEN
    IF v_row.payload_hash IS DISTINCT FROM v_hash THEN
      RETURN jsonb_build_object('ok', false, 'error', 'REQUEST_ID_CONFLICT');
    END IF;
  ELSE
    -- Same details already sent from this email in the last 24 hours (another tab, a reload): same booking.
    SELECT * INTO v_row FROM public.booking_requests
    WHERE source = 'website' AND lower(email) = v_email AND payload_hash = v_hash AND created_at > now() - interval '24 hours'
    ORDER BY created_at DESC LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('ok', true, 'duplicate', true) || public.website_booking_summary(v_row);
    END IF;

    SELECT count(*) INTO v_recent FROM public.booking_requests
    WHERE lower(email) = v_email AND created_at > now() - interval '15 minutes' AND source = 'website';
    IF v_recent >= 5 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'TOO_MANY_REQUESTS');
    END IF;
    IF p_client_hash IS NOT NULL THEN
      SELECT count(*) INTO v_recent FROM public.booking_requests
      WHERE client_hash = p_client_hash AND created_at > now() - interval '1 hour' AND source = 'website';
      IF v_recent >= 10 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'TOO_MANY_REQUESTS');
      END IF;
    END IF;
    -- Site-wide ceiling (backstop if visitor addresses can be spoofed): 200 website bookings per hour.
    SELECT count(*) INTO v_recent FROM public.booking_requests
    WHERE source = 'website' AND created_at > now() - interval '1 hour';
    IF v_recent >= 200 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'TOO_MANY_REQUESTS');
    END IF;

    LOOP
      BEGIN
        INSERT INTO public.booking_requests
          (name, email, phone, service, pickup_address, destination, travel_date, travel_time, offer_amount, status,
           request_id, booking_reference, requested_pickup_at, requested_timezone, source, payload_hash,
           email_attempts, updated_at, client_hash, pickup_lat, pickup_lng, destination_lat, destination_lng)
        VALUES
          (v_name, v_email, v_phone, v_service, v_pickup, v_dest, v_date, v_time, NULL, 'new',
           p_request_id,
           'DODO-' || to_char(now() AT TIME ZONE 'Australia/Brisbane', 'YYMMDD') || '-'
             || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
           v_at, 'Australia/Brisbane', 'website', v_hash, 0, now(), left(p_client_hash, 128), v_plat, v_plng, v_dlat, v_dlng)
        RETURNING * INTO v_row;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        -- Reference collision (rare): try another. A request_id collision cannot happen under the lock.
        IF EXISTS (SELECT 1 FROM public.booking_requests WHERE request_id = p_request_id) THEN RAISE; END IF;
      END;
    END LOOP;
    RETURN jsonb_build_object('ok', true, 'duplicate', false) || public.website_booking_summary(v_row);
  END IF;

  RETURN jsonb_build_object('ok', true, 'duplicate', true) || public.website_booking_summary(v_row);
END;
$$;

-- ---------------------------------------------------------------- 4. What the Edge Function needs to send emails
CREATE FUNCTION public.website_booking_summary(p public.booking_requests)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'request_id', p.request_id,
    'booking_reference', p.booking_reference,
    'name', p.name, 'email', p.email, 'phone', p.phone, 'service', p.service,
    'pickup_address', p.pickup_address, 'destination', p.destination,
    'travel_date', p.travel_date, 'travel_time', to_char(p.travel_time, 'HH24:MI'),
    'requested_pickup_at', p.requested_pickup_at, 'requested_timezone', p.requested_timezone,
    'created_at', p.created_at,
    'dodo_notified', p.dodo_notified_at IS NOT NULL,
    'rider_acknowledged', p.rider_ack_sent_at IS NOT NULL,
    'pickup_lat', p.pickup_lat, 'pickup_lng', p.pickup_lng,
    'destination_lat', p.destination_lat, 'destination_lng', p.destination_lng);
$$;

-- ---------------------------------------------------------------- 5. Record an email result
CREATE FUNCTION public.website_record_booking_email(
  p_request_id uuid,
  p_kind text,
  p_ok boolean,
  p_provider_id text,
  p_error text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_row public.booking_requests%ROWTYPE;
BEGIN
  IF p_kind NOT IN ('dodo', 'rider') THEN
    RAISE EXCEPTION 'INVALID_EMAIL_KIND';
  END IF;
  UPDATE public.booking_requests SET
    dodo_notified_at     = CASE WHEN p_kind = 'dodo'  AND p_ok THEN COALESCE(dodo_notified_at, now()) ELSE dodo_notified_at END,
    dodo_notification_id = CASE WHEN p_kind = 'dodo'  AND p_ok THEN COALESCE(dodo_notification_id, p_provider_id) ELSE dodo_notification_id END,
    rider_ack_sent_at    = CASE WHEN p_kind = 'rider' AND p_ok THEN COALESCE(rider_ack_sent_at, now()) ELSE rider_ack_sent_at END,
    rider_ack_id         = CASE WHEN p_kind = 'rider' AND p_ok THEN COALESCE(rider_ack_id, p_provider_id) ELSE rider_ack_id END,
    last_email_error     = CASE WHEN p_ok THEN last_email_error ELSE left(p_kind || ': ' || COALESCE(p_error, 'unknown'), 500) END,
    email_attempts       = COALESCE(email_attempts, 0) + 1,
    updated_at           = now()
  WHERE request_id = p_request_id AND source = 'website'
  RETURNING * INTO v_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;
  RETURN public.website_booking_summary(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.website_submit_booking_request(uuid, text, text, text, text, text, text, text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.website_record_booking_email(uuid, text, boolean, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.website_booking_summary(public.booking_requests) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.website_submit_booking_request(uuid, text, text, text, text, text, text, text, text, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.website_record_booking_email(uuid, text, boolean, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.website_booking_summary(public.booking_requests) TO service_role;

-- ---------------------------------------------------------------- 6. Self-check: historical rows unchanged
DO $verify$
DECLARE v_n bigint; v_fp text; v_old record;
BEGIN
  SELECT * INTO v_old FROM _bk_before;
  -- Fingerprint the old rows using only the columns that existed before.
  SELECT count(*), COALESCE(md5(string_agg(
           (to_jsonb(b) - ARRAY['request_id', 'booking_reference', 'requested_pickup_at', 'requested_timezone', 'source',
                                'payload_hash', 'dodo_notified_at', 'dodo_notification_id', 'rider_ack_sent_at',
                                'rider_ack_id', 'last_email_error', 'email_attempts', 'updated_at', 'client_hash',
                                'pickup_lat', 'pickup_lng', 'destination_lat', 'destination_lng'])::text,
           '|' ORDER BY b.id)), '')
  INTO v_n, v_fp FROM public.booking_requests b;
  IF v_n <> v_old.n OR v_fp <> v_old.fp THEN
    RAISE EXCEPTION 'VERIFY_FAILED: existing booking rows changed (% -> % rows).', v_old.n, v_n;
  END IF;
  IF has_table_privilege('anon', 'public.booking_requests', 'INSERT')
     OR has_function_privilege('anon', 'public.website_submit_booking_request(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'VERIFY_FAILED: the public key can still write bookings.';
  END IF;
  RAISE NOTICE 'WEBSITE_BOOKING_VERIFY_OK: % existing booking rows unchanged.', v_n;
END $verify$;

$dodo_sql$;
END
$dodo_wrap$;
