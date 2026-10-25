-- ================================================================
-- ROLLBACK of 20261025130000_website_contact_and_driver_forms.sql (DODO-Staging only)
-- NOT APPLIED. DO NOT RUN WITHOUT OWNER APPROVAL.
-- No message or application row is deleted or edited. The new columns are copied to
-- dodo_website_forms_archive before they are dropped. Tables created by the migration are kept.
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
  IF to_regprocedure('public.website_submit_contact_message(uuid,text,text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'NOT_APPLIED: nothing to roll back.';
  END IF;
  IF to_regnamespace('dodo_website_forms_archive') IS NOT NULL THEN
    RAISE EXCEPTION 'ARCHIVE_EXISTS: inspect dodo_website_forms_archive first.';
  END IF;
END $guard$;

CREATE SCHEMA dodo_website_forms_archive;
REVOKE ALL ON SCHEMA dodo_website_forms_archive FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE dodo_website_forms_archive.contact_messages_extra AS
SELECT id, request_id, reference, status, source, payload_hash, client_hash, team_notified_at, team_notification_id,
       ack_sent_at, ack_id, last_email_error, email_attempts, updated_at
FROM public.contact_messages WHERE request_id IS NOT NULL;
CREATE TABLE dodo_website_forms_archive.driver_applications_extra AS
SELECT id, home_state, request_id, reference, source, payload_hash, client_hash, team_notified_at, team_notification_id,
       ack_sent_at, ack_id, last_email_error, email_attempts, updated_at
FROM public.driver_applications WHERE request_id IS NOT NULL;

DROP FUNCTION public.website_record_driver_application_email(uuid, text, boolean, text, text);
DROP FUNCTION public.website_submit_driver_application(uuid, text, text, text, text, text, text, text, text, text);
DROP FUNCTION public.website_driver_application_summary(public.driver_applications);
DROP FUNCTION public.website_record_contact_email(uuid, text, boolean, text, text);
DROP FUNCTION public.website_submit_contact_message(uuid, text, text, text, text, text);
DROP FUNCTION public.website_contact_summary(public.contact_messages);
DROP FUNCTION public.website_form_reference(text);
DROP FUNCTION public.website_form_name_ok(text);
DROP FUNCTION public.website_form_phone_ok(text);
DROP FUNCTION public.website_form_email_ok(text);

DROP INDEX public.uq_contact_messages_request_id, public.uq_contact_messages_reference,
           public.idx_contact_messages_email_recent, public.idx_contact_messages_client_recent,
           public.uq_driver_applications_request_id, public.uq_driver_applications_reference,
           public.idx_driver_applications_email_recent, public.idx_driver_applications_client_recent;

ALTER TABLE public.contact_messages
  DROP COLUMN request_id, DROP COLUMN reference, DROP COLUMN status, DROP COLUMN source, DROP COLUMN payload_hash,
  DROP COLUMN client_hash, DROP COLUMN team_notified_at, DROP COLUMN team_notification_id, DROP COLUMN ack_sent_at,
  DROP COLUMN ack_id, DROP COLUMN last_email_error, DROP COLUMN email_attempts, DROP COLUMN updated_at;
ALTER TABLE public.driver_applications
  DROP COLUMN home_state, DROP COLUMN request_id, DROP COLUMN reference, DROP COLUMN source, DROP COLUMN payload_hash,
  DROP COLUMN client_hash, DROP COLUMN team_notified_at, DROP COLUMN team_notification_id, DROP COLUMN ack_sent_at,
  DROP COLUMN ack_id, DROP COLUMN last_email_error, DROP COLUMN email_attempts, DROP COLUMN updated_at;

-- Previous access (from the website's supabase_schema.sql): the public key could insert.
GRANT INSERT ON public.contact_messages, public.driver_applications TO anon;
CREATE POLICY "anon can insert contact_messages" ON public.contact_messages FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon can insert driver_applications" ON public.driver_applications FOR INSERT TO anon WITH CHECK (true);

$dodo_sql$;
END
$dodo_wrap$;
