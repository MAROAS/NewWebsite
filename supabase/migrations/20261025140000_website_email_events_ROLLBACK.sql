-- ================================================================
-- ROLLBACK of 20261025140000_website_email_events.sql (DODO-Staging only)
-- NOT APPLIED. DO NOT RUN WITHOUT OWNER APPROVAL.
-- The event rows are copied to dodo_website_email_events_archive before the objects are dropped.
-- Run this BEFORE rolling back 20261025120000 or 20261025130000 (the view depends on their columns).
-- ================================================================
-- ONE STATEMENT: the whole change runs inside the DO block below, so it applies completely or not at all,
-- whichever way the SQL Editor sends it. Paste and run the whole file.
DO $dodo_wrap$
BEGIN
EXECUTE $dodo_sql$

DO $guard$
DECLARE v_id text := (SELECT system_identifier FROM pg_control_system())::text;
BEGIN
  IF v_id <> '7678069749886157684' THEN
    RAISE EXCEPTION 'STAGING_ONLY: refusing database %.', v_id;
  END IF;
  IF to_regclass('public.website_email_events') IS NULL THEN
    RAISE EXCEPTION 'NOT_APPLIED: nothing to roll back.';
  END IF;
  IF to_regnamespace('dodo_website_email_events_archive') IS NOT NULL THEN
    RAISE EXCEPTION 'ARCHIVE_EXISTS: inspect dodo_website_email_events_archive first.';
  END IF;
END $guard$;

CREATE SCHEMA dodo_website_email_events_archive;
REVOKE ALL ON SCHEMA dodo_website_email_events_archive FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE dodo_website_email_events_archive.website_email_events AS SELECT * FROM public.website_email_events;

DROP VIEW public.website_email_delivery_status;
DROP FUNCTION public.website_purge_email_events(integer);
DROP FUNCTION public.website_record_email_event(text, text, text, text, text, text);
DROP TABLE public.website_email_events;

$dodo_sql$;
END
$dodo_wrap$;
