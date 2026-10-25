-- PRODUCTION COPY of 20261025140000_website_email_events (generated 2026-10-25).
-- NOT APPROVED. DO NOT RUN. Production (gobsccsryhavpwqpiujz) is paused; follow PRODUCTION-PLAN.md.
-- Identical to the staging file except the guard: replace __PRODUCTION_CLUSTER_ID__ with production's cluster id
-- (captured from the production backup, step P0); the script refuses DODO-Staging and every other database.
-- ================================================================
-- DODO website email delivery log (Resend webhook events: delivered, bounced, complained, delayed, ...)
-- Prepared 2026-10-25. NOT APPLIED. DO NOT RUN WITHOUT OWNER APPROVAL.
-- PRODUCTION COPY: refuses DODO-Staging; requires the production cluster id.
-- Requires 20261025120000_website_booking_requests.sql and 20261025130000_website_contact_and_driver_forms.sql.
--
-- What it does
--   * website_email_events: one row per signed Resend webhook event (deduplicated by its svix id).
--     Stores the event type, Resend's email id, time and bounce details with email addresses removed.
--     No recipient addresses, message bodies or other personal details are stored here.
--   * website_record_email_event(): the only way in; callable by the service role (Edge Function) only.
--   * website_email_delivery_status: for every website submission email, the latest provider event.
--   * Nothing existing is changed. The public and signed-in app keys cannot read or write any of it.
-- Retention: events older than 180 days can be removed with website_purge_email_events(180) (not scheduled).
-- Rollback: 20261025140000_website_email_events_ROLLBACK.sql
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
  IF to_regclass('public.website_email_events') IS NOT NULL THEN
    RAISE EXCEPTION 'PREFLIGHT_ALREADY_APPLIED: public.website_email_events already exists.';
  END IF;
  IF to_regprocedure('public.website_submit_booking_request(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text)') IS NULL
     OR to_regprocedure('public.website_submit_contact_message(uuid,text,text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: apply 20261025120000 and 20261025130000 first.';
  END IF;
END $guard$;

SET LOCAL search_path = public, extensions;
SET LOCAL lock_timeout = '5s';

CREATE TABLE public.website_email_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  svix_id text NOT NULL UNIQUE,
  event_type text NOT NULL CHECK (event_type ~ '^email\.[a-z_]{2,40}$'),
  email_id text CHECK (email_id IS NULL OR length(email_id) <= 100),
  occurred_at timestamptz,
  bounce_type text CHECK (bounce_type IS NULL OR length(bounce_type) <= 100),
  detail text CHECK (detail IS NULL OR length(detail) <= 500),
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_website_email_events_email ON public.website_email_events (email_id, occurred_at DESC);
ALTER TABLE public.website_email_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.website_email_events FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.website_record_email_event(
  p_svix_id text, p_type text, p_email_id text, p_occurred_at text, p_bounce_type text, p_detail text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_at timestamptz; v_id bigint;
BEGIN
  IF p_svix_id IS NULL OR length(p_svix_id) NOT BETWEEN 5 AND 100 OR COALESCE(p_type, '') !~ '^email\.[a-z_]{2,40}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VALIDATION_FAILED');
  END IF;
  BEGIN
    v_at := p_occurred_at::timestamptz;
  EXCEPTION WHEN OTHERS THEN v_at := NULL;
  END;
  INSERT INTO public.website_email_events (svix_id, event_type, email_id, occurred_at, bounce_type, detail)
  VALUES (p_svix_id, p_type, left(p_email_id, 100), v_at, left(p_bounce_type, 100),
          left(regexp_replace(COALESCE(p_detail, ''), '[^\s@<>"'':;,]+@[^\s@<>"'':;,]+', '[email]', 'g'), 500))
  ON CONFLICT (svix_id) DO NOTHING
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'duplicate', v_id IS NULL);
END;
$$;

CREATE FUNCTION public.website_purge_email_events(p_days integer)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH d AS (DELETE FROM public.website_email_events
             WHERE received_at < now() - make_interval(days => GREATEST(p_days, 30)) RETURNING 1)
  SELECT count(*)::integer FROM d;
$$;

-- Latest provider event for every email the website forms sent (DODO copy and acknowledgement).
CREATE VIEW public.website_email_delivery_status WITH (security_invoker = true) AS
WITH sent AS (
  SELECT 'booking'::text AS form, booking_reference AS reference, 'dodo'::text AS kind, dodo_notification_id AS email_id, dodo_notified_at AS accepted_at
    FROM public.booking_requests WHERE source = 'website' AND dodo_notification_id IS NOT NULL
  UNION ALL SELECT 'booking', booking_reference, 'acknowledgement', rider_ack_id, rider_ack_sent_at
    FROM public.booking_requests WHERE source = 'website' AND rider_ack_id IS NOT NULL
  UNION ALL SELECT 'contact', reference, 'dodo', team_notification_id, team_notified_at
    FROM public.contact_messages WHERE source = 'website' AND team_notification_id IS NOT NULL
  UNION ALL SELECT 'contact', reference, 'acknowledgement', ack_id, ack_sent_at
    FROM public.contact_messages WHERE source = 'website' AND ack_id IS NOT NULL
  UNION ALL SELECT 'driver_application', reference, 'dodo', team_notification_id, team_notified_at
    FROM public.driver_applications WHERE source = 'website' AND team_notification_id IS NOT NULL
  UNION ALL SELECT 'driver_application', reference, 'acknowledgement', ack_id, ack_sent_at
    FROM public.driver_applications WHERE source = 'website' AND ack_id IS NOT NULL
)
SELECT s.form, s.reference, s.kind, s.email_id, s.accepted_at,
       e.event_type AS latest_event, e.occurred_at AS latest_event_at, e.bounce_type, e.detail
FROM sent s
LEFT JOIN LATERAL (
  SELECT event_type, occurred_at, bounce_type, detail FROM public.website_email_events ev
  WHERE ev.email_id = s.email_id ORDER BY ev.occurred_at DESC NULLS LAST, ev.id DESC LIMIT 1
) e ON true;

REVOKE ALL ON public.website_email_delivery_status FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.website_record_email_event(text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.website_purge_email_events(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.website_record_email_event(text, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.website_purge_email_events(integer) TO service_role;
GRANT SELECT ON public.website_email_delivery_status TO service_role;

DO $verify$
BEGIN
  IF has_table_privilege('anon', 'public.website_email_events', 'SELECT')
     OR has_table_privilege('authenticated', 'public.website_email_events', 'SELECT')
     OR has_table_privilege('anon', 'public.website_email_delivery_status', 'SELECT')
     OR has_function_privilege('anon', 'public.website_record_email_event(text,text,text,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'VERIFY_FAILED: the public key can reach the email delivery log.';
  END IF;
  RAISE NOTICE 'WEBSITE_EMAIL_EVENTS_VERIFY_OK';
END $verify$;

$dodo_sql$;
END
$dodo_wrap$;
