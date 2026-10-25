-- PRODUCTION COPY of 20261025120000_website_booking_requests_ROLLBACK (generated 2026-10-25).
-- NOT APPROVED. DO NOT RUN. Production (gobsccsryhavpwqpiujz) is paused; follow PRODUCTION-PLAN.md.
-- Identical to the staging file except the guard: replace __PRODUCTION_CLUSTER_ID__ with production's cluster id
-- (captured from the production backup, step P0); the script refuses DODO-Staging and every other database.
-- ================================================================
-- ROLLBACK of 20261025120000_website_booking_requests.sql (DODO-Staging only)
-- NOT APPLIED. DO NOT RUN WITHOUT OWNER APPROVAL.
-- No booking row is deleted or edited. The new columns are copied to
-- dodo_website_booking_archive.booking_requests_extra before they are dropped.
-- offer_amount gets NOT NULL back only if no row has an empty value (data is never changed to force it).
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
  IF to_regprocedure('public.website_submit_booking_request(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'NOT_APPLIED: nothing to roll back.';
  END IF;
  IF to_regnamespace('dodo_website_booking_archive') IS NOT NULL THEN
    RAISE EXCEPTION 'ARCHIVE_EXISTS: inspect dodo_website_booking_archive first.';
  END IF;
END $guard$;

CREATE SCHEMA dodo_website_booking_archive;
REVOKE ALL ON SCHEMA dodo_website_booking_archive FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE dodo_website_booking_archive.booking_requests_extra AS
SELECT id, request_id, booking_reference, requested_pickup_at, requested_timezone, source, payload_hash,
       dodo_notified_at, dodo_notification_id, rider_ack_sent_at, rider_ack_id, last_email_error, email_attempts, updated_at, client_hash,
       pickup_lat, pickup_lng, destination_lat, destination_lng
FROM public.booking_requests WHERE request_id IS NOT NULL;

DROP FUNCTION public.website_record_booking_email(uuid, text, boolean, text, text);
DROP FUNCTION public.website_submit_booking_request(uuid, text, text, text, text, text, text, text, text, text, text, text, text, text);
DROP FUNCTION public.website_booking_summary(public.booking_requests);
DROP INDEX public.uq_booking_requests_request_id;
DROP INDEX public.uq_booking_requests_reference;
DROP INDEX public.idx_booking_requests_email_recent;
DROP INDEX public.idx_booking_requests_client_recent;
ALTER TABLE public.booking_requests
  DROP COLUMN request_id, DROP COLUMN booking_reference, DROP COLUMN requested_pickup_at,
  DROP COLUMN requested_timezone, DROP COLUMN source, DROP COLUMN payload_hash,
  DROP COLUMN dodo_notified_at, DROP COLUMN dodo_notification_id, DROP COLUMN rider_ack_sent_at,
  DROP COLUMN rider_ack_id, DROP COLUMN last_email_error, DROP COLUMN email_attempts, DROP COLUMN updated_at, DROP COLUMN client_hash,
  DROP COLUMN pickup_lat, DROP COLUMN pickup_lng, DROP COLUMN destination_lat, DROP COLUMN destination_lng;

DO $offer$
BEGIN
  IF EXISTS (SELECT 1 FROM public.booking_requests WHERE offer_amount IS NULL) THEN
    RAISE NOTICE 'offer_amount left optional: some bookings have no offer amount (values not changed).';
  ELSE
    ALTER TABLE public.booking_requests ALTER COLUMN offer_amount SET NOT NULL;
  END IF;
END $offer$;

-- Previous access (from the website's supabase_schema.sql): the public key could insert.
GRANT INSERT ON public.booking_requests TO anon;
CREATE POLICY "anon can insert booking_requests" ON public.booking_requests FOR INSERT TO anon WITH CHECK (true);

$dodo_sql$;
END
$dodo_wrap$;
