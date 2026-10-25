-- PRODUCTION COPY of 20261025130000_website_contact_and_driver_forms (generated 2026-10-25).
-- NOT APPROVED. DO NOT RUN. Production (gobsccsryhavpwqpiujz) is paused; follow PRODUCTION-PLAN.md.
-- Identical to the staging file except the guard: replace __PRODUCTION_CLUSTER_ID__ with production's cluster id
-- (captured from the production backup, step P0); the script refuses DODO-Staging and every other database.
-- ================================================================
-- DODO website "Contact us" and driver application forms — server-side save, reference and email tracking
-- Prepared 2026-10-25. NOT APPLIED. DO NOT RUN WITHOUT OWNER APPROVAL.
-- PRODUCTION COPY: refuses DODO-Staging; requires the production cluster id.
-- Independent of 20261025120000_website_booking_requests.sql (either can be applied first).
--
-- What it does
--   * contact_messages and driver_applications are created if missing (same definition as the
--     website's supabase_schema.sql), then get new columns only. Existing rows are not updated:
--     every new column is added without a default, so old rows keep NULL.
--   * website_submit_contact_message() / website_submit_driver_application(): validate, save once
--     per request_id, assign a reference (DODO-MSG-YYMMDD-XXXXXX / DODO-DRV-YYMMDD-XXXXXX).
--     Same details from the same email within 24 hours return the existing row (no new row, no new email).
--   * Limits: contact 3 per email per 15 minutes, 10 per visitor per hour;
--             driver application 3 per email per 24 hours, 5 per visitor per hour.
--     (visitor = keyed hash of the IP address made by the Edge Function; the IP is never stored)
--     Site-wide backstop per hour: 100 contact messages, 50 driver applications.
--   * website_record_*_email(): records whether each email was accepted by Resend.
--   * Only the service role (the Edge Functions) can call them. The public (anon) key can no longer
--     write to either table directly.
--   * Driver applications hold no documents, licence numbers or file links. The state is only where the
--     applicant wants to drive: it is not an approval and does not change any driver account.
-- Rollback: 20261025130000_website_contact_and_driver_forms_ROLLBACK.sql
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
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name IN ('contact_messages', 'driver_applications') AND column_name = 'request_id') THEN
    RAISE EXCEPTION 'PREFLIGHT_ALREADY_APPLIED: request_id already exists on contact_messages or driver_applications.';
  END IF;
END $guard$;

SET LOCAL search_path = public, extensions;
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------- 0. Tables (only if missing; definition from supabase_schema.sql)
CREATE TABLE IF NOT EXISTS public.contact_messages (
  id bigint generated always as identity primary key,
  name text not null,
  email text not null,
  phone text,
  message text not null,
  created_at timestamptz not null default now()
);
CREATE TABLE IF NOT EXISTS public.driver_applications (
  id bigint generated always as identity primary key,
  full_name text not null,
  email text not null,
  phone text not null,
  state text not null,
  service text not null,
  license_length text,
  has_abn boolean not null default false,
  vehicle_details text,
  status text not null default 'new',
  created_at timestamptz not null default now()
);

DO $pre$
DECLARE v_missing text;
BEGIN
  SELECT string_agg(t || '.' || c, ', ') INTO v_missing
  FROM (VALUES ('contact_messages', 'name'), ('contact_messages', 'email'), ('contact_messages', 'phone'),
               ('contact_messages', 'message'), ('contact_messages', 'created_at'),
               ('driver_applications', 'full_name'), ('driver_applications', 'email'), ('driver_applications', 'phone'),
               ('driver_applications', 'state'), ('driver_applications', 'service'), ('driver_applications', 'license_length'),
               ('driver_applications', 'has_abn'), ('driver_applications', 'vehicle_details'), ('driver_applications', 'status'),
               ('driver_applications', 'created_at')) AS need(t, c)
  WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns ic
                    WHERE ic.table_schema = 'public' AND ic.table_name = need.t AND ic.column_name = need.c);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: expected columns missing: %', v_missing;
  END IF;
END $pre$;

CREATE TEMP TABLE _wf_before ON COMMIT DROP AS
SELECT (SELECT count(*) FROM public.contact_messages) AS c_n,
       (SELECT COALESCE(md5(string_agg(to_jsonb(m)::text, '|' ORDER BY m.id)), '') FROM public.contact_messages m) AS c_fp,
       (SELECT count(*) FROM public.driver_applications) AS d_n,
       (SELECT COALESCE(md5(string_agg(to_jsonb(a)::text, '|' ORDER BY a.id)), '') FROM public.driver_applications a) AS d_fp;

-- ---------------------------------------------------------------- 1. Columns (no defaults => old rows untouched)
ALTER TABLE public.contact_messages
  ADD COLUMN request_id uuid,
  ADD COLUMN reference text,
  ADD COLUMN status text,
  ADD COLUMN source text,
  ADD COLUMN payload_hash text,
  ADD COLUMN client_hash text,
  ADD COLUMN team_notified_at timestamptz,
  ADD COLUMN team_notification_id text,
  ADD COLUMN ack_sent_at timestamptz,
  ADD COLUMN ack_id text,
  ADD COLUMN last_email_error text,
  ADD COLUMN email_attempts integer,
  ADD COLUMN updated_at timestamptz;

ALTER TABLE public.driver_applications
  ADD COLUMN home_state text,
  ADD COLUMN request_id uuid,
  ADD COLUMN reference text,
  ADD COLUMN source text,
  ADD COLUMN payload_hash text,
  ADD COLUMN client_hash text,
  ADD COLUMN team_notified_at timestamptz,
  ADD COLUMN team_notification_id text,
  ADD COLUMN ack_sent_at timestamptz,
  ADD COLUMN ack_id text,
  ADD COLUMN last_email_error text,
  ADD COLUMN email_attempts integer,
  ADD COLUMN updated_at timestamptz;

CREATE UNIQUE INDEX uq_contact_messages_request_id ON public.contact_messages (request_id) WHERE request_id IS NOT NULL;
CREATE UNIQUE INDEX uq_contact_messages_reference ON public.contact_messages (reference) WHERE reference IS NOT NULL;
CREATE INDEX idx_contact_messages_email_recent ON public.contact_messages (lower(email), created_at DESC);
CREATE INDEX idx_contact_messages_client_recent ON public.contact_messages (client_hash, created_at DESC) WHERE client_hash IS NOT NULL;
CREATE UNIQUE INDEX uq_driver_applications_request_id ON public.driver_applications (request_id) WHERE request_id IS NOT NULL;
CREATE UNIQUE INDEX uq_driver_applications_reference ON public.driver_applications (reference) WHERE reference IS NOT NULL;
CREATE INDEX idx_driver_applications_email_recent ON public.driver_applications (lower(email), created_at DESC);
CREATE INDEX idx_driver_applications_client_recent ON public.driver_applications (client_hash, created_at DESC) WHERE client_hash IS NOT NULL;

-- ---------------------------------------------------------------- 2. Public key: no direct reads or writes
DROP POLICY IF EXISTS "anon can insert contact_messages" ON public.contact_messages;
DROP POLICY IF EXISTS "anon can insert driver_applications" ON public.driver_applications;
REVOKE ALL ON public.contact_messages FROM anon, authenticated;
REVOKE ALL ON public.driver_applications FROM anon, authenticated;
ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_applications ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------- 3. Shared checks
CREATE FUNCTION public.website_form_email_ok(p text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT length(p) <= 254 AND p ~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$';
$$;
CREATE FUNCTION public.website_form_phone_ok(p text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT length(p) <= 30 AND p ~ '^\+?[0-9 ()-]+$' AND length(regexp_replace(p, '[^0-9]', '', 'g')) BETWEEN 8 AND 15;
$$;
-- Names are repeated in the acknowledgement email, so web links and markup are refused.
CREATE FUNCTION public.website_form_name_ok(p text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT length(p) BETWEEN 2 AND 100 AND p !~* '(https?:|www\.|[<>])';
$$;
CREATE FUNCTION public.website_form_reference(p_prefix text)
RETURNS text LANGUAGE sql VOLATILE SET search_path = public, extensions AS $$
  SELECT 'DODO-' || p_prefix || '-' || to_char(now() AT TIME ZONE 'Australia/Brisbane', 'YYMMDD') || '-'
         || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
$$;

-- ---------------------------------------------------------------- 4. Contact messages
CREATE FUNCTION public.website_contact_summary(p public.contact_messages)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'request_id', p.request_id, 'reference', p.reference,
    'name', p.name, 'email', p.email, 'phone', p.phone, 'message', p.message,
    'created_at', p.created_at,
    'team_notified', p.team_notified_at IS NOT NULL,
    'ack_sent', p.ack_sent_at IS NOT NULL);
$$;

CREATE FUNCTION public.website_submit_contact_message(
  p_request_id uuid,
  p_name text,
  p_email text,
  p_phone text,
  p_message text,
  p_client_hash text DEFAULT NULL
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
  v_message text := btrim(replace(COALESCE(p_message, ''), E'\r\n', E'\n'));
  v_hash text;
  v_row public.contact_messages%ROWTYPE;
  v_recent int;
  v_errors text[] := ARRAY[]::text[];
BEGIN
  IF p_request_id IS NULL THEN v_errors := v_errors || 'request_id'::text; END IF;
  IF NOT public.website_form_name_ok(v_name) THEN v_errors := v_errors || 'name'::text; END IF;
  IF NOT public.website_form_email_ok(v_email) THEN v_errors := v_errors || 'email'::text; END IF;
  IF v_phone <> '' AND NOT public.website_form_phone_ok(v_phone) THEN v_errors := v_errors || 'phone'::text; END IF;
  IF length(v_message) NOT BETWEEN 10 AND 5000 THEN v_errors := v_errors || 'message'::text; END IF;
  IF cardinality(v_errors) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VALIDATION_FAILED', 'fields', to_jsonb(v_errors));
  END IF;

  v_hash := md5(concat_ws('|', v_name, v_email, v_phone, v_message));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('website-contact:' || v_email, 0));

  SELECT * INTO v_row FROM public.contact_messages WHERE request_id = p_request_id;
  IF FOUND THEN
    IF v_row.payload_hash IS DISTINCT FROM v_hash THEN
      RETURN jsonb_build_object('ok', false, 'error', 'REQUEST_ID_CONFLICT');
    END IF;
    RETURN jsonb_build_object('ok', true, 'duplicate', true) || public.website_contact_summary(v_row);
  END IF;

  SELECT * INTO v_row FROM public.contact_messages
  WHERE source = 'website' AND lower(email) = v_email AND payload_hash = v_hash AND created_at > now() - interval '24 hours'
  ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true) || public.website_contact_summary(v_row);
  END IF;

  SELECT count(*) INTO v_recent FROM public.contact_messages
  WHERE source = 'website' AND lower(email) = v_email AND created_at > now() - interval '15 minutes';
  IF v_recent >= 3 THEN RETURN jsonb_build_object('ok', false, 'error', 'TOO_MANY_REQUESTS'); END IF;
  IF p_client_hash IS NOT NULL THEN
    SELECT count(*) INTO v_recent FROM public.contact_messages
    WHERE source = 'website' AND client_hash = p_client_hash AND created_at > now() - interval '1 hour';
    IF v_recent >= 10 THEN RETURN jsonb_build_object('ok', false, 'error', 'TOO_MANY_REQUESTS'); END IF;
  END IF;
  -- Site-wide ceiling (backstop if visitor addresses can be spoofed).
  SELECT count(*) INTO v_recent FROM public.contact_messages WHERE source = 'website' AND created_at > now() - interval '1 hour';
  IF v_recent >= 100 THEN RETURN jsonb_build_object('ok', false, 'error', 'TOO_MANY_REQUESTS'); END IF;

  LOOP
    BEGIN
      INSERT INTO public.contact_messages
        (name, email, phone, message, request_id, reference, status, source, payload_hash, client_hash, email_attempts, updated_at)
      VALUES
        (v_name, v_email, NULLIF(v_phone, ''), v_message, p_request_id, public.website_form_reference('MSG'), 'new', 'website',
         v_hash, left(p_client_hash, 128), 0, now())
      RETURNING * INTO v_row;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF EXISTS (SELECT 1 FROM public.contact_messages WHERE request_id = p_request_id) THEN RAISE; END IF;
    END;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'duplicate', false) || public.website_contact_summary(v_row);
END;
$$;

CREATE FUNCTION public.website_record_contact_email(
  p_request_id uuid, p_kind text, p_ok boolean, p_provider_id text, p_error text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_row public.contact_messages%ROWTYPE;
BEGIN
  IF p_kind NOT IN ('team', 'ack') THEN RAISE EXCEPTION 'INVALID_EMAIL_KIND'; END IF;
  UPDATE public.contact_messages SET
    team_notified_at     = CASE WHEN p_kind = 'team' AND p_ok THEN COALESCE(team_notified_at, now()) ELSE team_notified_at END,
    team_notification_id = CASE WHEN p_kind = 'team' AND p_ok THEN COALESCE(team_notification_id, p_provider_id) ELSE team_notification_id END,
    ack_sent_at          = CASE WHEN p_kind = 'ack'  AND p_ok THEN COALESCE(ack_sent_at, now()) ELSE ack_sent_at END,
    ack_id               = CASE WHEN p_kind = 'ack'  AND p_ok THEN COALESCE(ack_id, p_provider_id) ELSE ack_id END,
    last_email_error     = CASE WHEN p_ok THEN last_email_error ELSE left(p_kind || ': ' || COALESCE(p_error, 'unknown'), 500) END,
    email_attempts       = COALESCE(email_attempts, 0) + 1,
    updated_at           = now()
  WHERE request_id = p_request_id AND source = 'website'
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'MESSAGE_NOT_FOUND'; END IF;
  RETURN public.website_contact_summary(v_row);
END;
$$;

-- ---------------------------------------------------------------- 5. Driver applications
CREATE FUNCTION public.website_driver_application_summary(p public.driver_applications)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'request_id', p.request_id, 'reference', p.reference,
    'full_name', p.full_name, 'email', p.email, 'phone', p.phone, 'state', p.state, 'home_state', p.home_state,
    'license_length', p.license_length, 'has_abn', p.has_abn, 'vehicle_details', p.vehicle_details,
    'created_at', p.created_at,
    'team_notified', p.team_notified_at IS NOT NULL,
    'ack_sent', p.ack_sent_at IS NOT NULL);
$$;

CREATE FUNCTION public.website_submit_driver_application(
  p_request_id uuid,
  p_full_name text,
  p_email text,
  p_phone text,
  p_state text,
  p_license_length text,
  p_has_abn text,
  p_vehicle_details text,
  p_client_hash text DEFAULT NULL,
  p_home_state text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_name text := btrim(regexp_replace(COALESCE(p_full_name, ''), '\s+', ' ', 'g'));
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_phone text := btrim(COALESCE(p_phone, ''));
  v_state text := upper(btrim(COALESCE(p_state, '')));
  v_home text := upper(btrim(COALESCE(p_home_state, '')));
  v_licence text := btrim(regexp_replace(COALESCE(p_license_length, ''), '\s+', ' ', 'g'));
  v_abn text := lower(btrim(COALESCE(p_has_abn, '')));
  v_vehicle text := btrim(replace(COALESCE(p_vehicle_details, ''), E'\r\n', E'\n'));
  v_hash text;
  v_row public.driver_applications%ROWTYPE;
  v_recent int;
  v_errors text[] := ARRAY[]::text[];
BEGIN
  IF p_request_id IS NULL THEN v_errors := v_errors || 'request_id'::text; END IF;
  IF NOT public.website_form_name_ok(v_name) THEN v_errors := v_errors || 'full_name'::text; END IF;
  IF NOT public.website_form_email_ok(v_email) THEN v_errors := v_errors || 'email'::text; END IF;
  IF NOT public.website_form_phone_ok(v_phone) THEN v_errors := v_errors || 'phone'::text; END IF;
  IF v_state NOT IN ('QLD', 'NSW', 'VIC', 'WA', 'SA', 'ACT', 'TAS', 'NT') THEN v_errors := v_errors || 'state'::text; END IF;
  -- Where the applicant lives. Recorded for context only: it is never an approval to operate anywhere.
  IF v_home NOT IN ('QLD', 'NSW', 'VIC', 'WA', 'SA', 'ACT', 'TAS', 'NT') THEN v_errors := v_errors || 'home_state'::text; END IF;
  IF length(v_licence) > 50 OR v_licence ~* '(https?:|www\.)' THEN v_errors := v_errors || 'license_length'::text; END IF;
  IF v_abn NOT IN ('yes', 'no') THEN v_errors := v_errors || 'has_abn'::text; END IF;
  IF length(v_vehicle) > 500 OR v_vehicle ~* '(https?:|www\.|data:)' THEN v_errors := v_errors || 'vehicle_details'::text; END IF;
  IF cardinality(v_errors) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VALIDATION_FAILED', 'fields', to_jsonb(v_errors));
  END IF;

  v_hash := md5(concat_ws('|', v_name, v_email, v_phone, v_state, v_licence, v_abn, v_vehicle, v_home));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('website-driver:' || v_email, 0));

  SELECT * INTO v_row FROM public.driver_applications WHERE request_id = p_request_id;
  IF FOUND THEN
    IF v_row.payload_hash IS DISTINCT FROM v_hash THEN
      RETURN jsonb_build_object('ok', false, 'error', 'REQUEST_ID_CONFLICT');
    END IF;
    RETURN jsonb_build_object('ok', true, 'duplicate', true) || public.website_driver_application_summary(v_row);
  END IF;

  SELECT * INTO v_row FROM public.driver_applications
  WHERE source = 'website' AND lower(email) = v_email AND payload_hash = v_hash AND created_at > now() - interval '24 hours'
  ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true) || public.website_driver_application_summary(v_row);
  END IF;

  SELECT count(*) INTO v_recent FROM public.driver_applications
  WHERE source = 'website' AND lower(email) = v_email AND created_at > now() - interval '24 hours';
  IF v_recent >= 3 THEN RETURN jsonb_build_object('ok', false, 'error', 'TOO_MANY_REQUESTS'); END IF;
  IF p_client_hash IS NOT NULL THEN
    SELECT count(*) INTO v_recent FROM public.driver_applications
    WHERE source = 'website' AND client_hash = p_client_hash AND created_at > now() - interval '1 hour';
    IF v_recent >= 5 THEN RETURN jsonb_build_object('ok', false, 'error', 'TOO_MANY_REQUESTS'); END IF;
  END IF;
  SELECT count(*) INTO v_recent FROM public.driver_applications WHERE source = 'website' AND created_at > now() - interval '1 hour';
  IF v_recent >= 50 THEN RETURN jsonb_build_object('ok', false, 'error', 'TOO_MANY_REQUESTS'); END IF;

  LOOP
    BEGIN
      INSERT INTO public.driver_applications
        (full_name, email, phone, state, home_state, service, license_length, has_abn, vehicle_details, status,
         request_id, reference, source, payload_hash, client_hash, email_attempts, updated_at)
      VALUES
        (v_name, v_email, v_phone, v_state, v_home, 'All DODO services', NULLIF(v_licence, ''), v_abn = 'yes', NULLIF(v_vehicle, ''), 'new',
         p_request_id, public.website_form_reference('DRV'), 'website', v_hash, left(p_client_hash, 128), 0, now())
      RETURNING * INTO v_row;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF EXISTS (SELECT 1 FROM public.driver_applications WHERE request_id = p_request_id) THEN RAISE; END IF;
    END;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'duplicate', false) || public.website_driver_application_summary(v_row);
END;
$$;

CREATE FUNCTION public.website_record_driver_application_email(
  p_request_id uuid, p_kind text, p_ok boolean, p_provider_id text, p_error text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_row public.driver_applications%ROWTYPE;
BEGIN
  IF p_kind NOT IN ('team', 'ack') THEN RAISE EXCEPTION 'INVALID_EMAIL_KIND'; END IF;
  UPDATE public.driver_applications SET
    team_notified_at     = CASE WHEN p_kind = 'team' AND p_ok THEN COALESCE(team_notified_at, now()) ELSE team_notified_at END,
    team_notification_id = CASE WHEN p_kind = 'team' AND p_ok THEN COALESCE(team_notification_id, p_provider_id) ELSE team_notification_id END,
    ack_sent_at          = CASE WHEN p_kind = 'ack'  AND p_ok THEN COALESCE(ack_sent_at, now()) ELSE ack_sent_at END,
    ack_id               = CASE WHEN p_kind = 'ack'  AND p_ok THEN COALESCE(ack_id, p_provider_id) ELSE ack_id END,
    last_email_error     = CASE WHEN p_ok THEN last_email_error ELSE left(p_kind || ': ' || COALESCE(p_error, 'unknown'), 500) END,
    email_attempts       = COALESCE(email_attempts, 0) + 1,
    updated_at           = now()
  WHERE request_id = p_request_id AND source = 'website'
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'APPLICATION_NOT_FOUND'; END IF;
  RETURN public.website_driver_application_summary(v_row);
END;
$$;

-- ---------------------------------------------------------------- 6. Who may call what
REVOKE ALL ON FUNCTION public.website_form_email_ok(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.website_form_phone_ok(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.website_form_name_ok(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.website_form_reference(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.website_contact_summary(public.contact_messages) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.website_submit_contact_message(uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.website_record_contact_email(uuid, text, boolean, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.website_driver_application_summary(public.driver_applications) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.website_submit_driver_application(uuid, text, text, text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.website_record_driver_application_email(uuid, text, boolean, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.website_form_email_ok(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.website_form_phone_ok(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.website_form_name_ok(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.website_form_reference(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.website_contact_summary(public.contact_messages) TO service_role;
GRANT EXECUTE ON FUNCTION public.website_submit_contact_message(uuid, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.website_record_contact_email(uuid, text, boolean, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.website_driver_application_summary(public.driver_applications) TO service_role;
GRANT EXECUTE ON FUNCTION public.website_submit_driver_application(uuid, text, text, text, text, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.website_record_driver_application_email(uuid, text, boolean, text, text) TO service_role;

-- ---------------------------------------------------------------- 7. Self-check
DO $verify$
DECLARE
  v_old record;
  v_new_cols text[] := ARRAY['home_state', 'request_id', 'reference', 'status', 'source', 'payload_hash', 'client_hash', 'team_notified_at',
                             'team_notification_id', 'ack_sent_at', 'ack_id', 'last_email_error', 'email_attempts', 'updated_at'];
  v_c_n bigint; v_c_fp text; v_d_n bigint; v_d_fp text;
BEGIN
  SELECT * INTO v_old FROM _wf_before;
  -- contact_messages.status is new; driver_applications.status already existed and stays in the fingerprint.
  SELECT count(*), COALESCE(md5(string_agg((to_jsonb(m) - v_new_cols)::text, '|' ORDER BY m.id)), '')
    INTO v_c_n, v_c_fp FROM public.contact_messages m;
  SELECT count(*), COALESCE(md5(string_agg((to_jsonb(a) - array_remove(v_new_cols, 'status'))::text, '|' ORDER BY a.id)), '')
    INTO v_d_n, v_d_fp FROM public.driver_applications a;
  IF v_c_n <> v_old.c_n OR v_c_fp <> v_old.c_fp THEN
    RAISE EXCEPTION 'VERIFY_FAILED: existing contact messages changed (% -> % rows).', v_old.c_n, v_c_n;
  END IF;
  IF v_d_n <> v_old.d_n OR v_d_fp <> v_old.d_fp THEN
    RAISE EXCEPTION 'VERIFY_FAILED: existing driver applications changed (% -> % rows).', v_old.d_n, v_d_n;
  END IF;
  IF has_table_privilege('anon', 'public.contact_messages', 'INSERT')
     OR has_table_privilege('anon', 'public.driver_applications', 'INSERT')
     OR has_table_privilege('anon', 'public.driver_applications', 'SELECT')
     OR has_function_privilege('anon', 'public.website_submit_contact_message(uuid,text,text,text,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.website_submit_driver_application(uuid,text,text,text,text,text,text,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'VERIFY_FAILED: the public key can still read or write these tables.';
  END IF;
  RAISE NOTICE 'WEBSITE_FORMS_VERIFY_OK: % contact messages and % driver applications unchanged.', v_c_n, v_d_n;
END $verify$;

$dodo_sql$;
END
$dodo_wrap$;
