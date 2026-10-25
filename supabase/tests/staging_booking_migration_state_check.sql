-- READ-ONLY. DODO-Staging: shows exactly what 20261025120000_website_booking_requests.sql left behind after the
-- SQL Editor stopped at its final self-check. Changes nothing. One result table: check | result | detail.
WITH
cid AS (SELECT (SELECT system_identifier FROM pg_control_system())::text AS id),
want_cols(c) AS (VALUES ('request_id'),('booking_reference'),('requested_pickup_at'),('requested_timezone'),('source'),('payload_hash'),
  ('dodo_notified_at'),('dodo_notification_id'),('rider_ack_sent_at'),('rider_ack_id'),('last_email_error'),('email_attempts'),('updated_at'),
  ('client_hash'),('pickup_lat'),('pickup_lng'),('destination_lat'),('destination_lng')),
have_cols AS (SELECT column_name AS c FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'booking_requests'),
missing_cols AS (SELECT string_agg(c, ', ') AS m, count(*) AS n FROM want_cols WHERE c NOT IN (SELECT c FROM have_cols)),
fns AS (SELECT p.proname, p.prosecdef, array_to_string(p.proconfig, ',') AS cfg FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('website_submit_booking_request','website_booking_summary','website_record_booking_email')),
idx AS (SELECT count(*) AS n FROM pg_indexes WHERE schemaname = 'public' AND indexname IN
        ('uq_booking_requests_request_id','uq_booking_requests_reference','idx_booking_requests_email_recent','idx_booking_requests_client_recent'))
SELECT * FROM (VALUES
 (1, 'Target is DODO-Staging', CASE WHEN (SELECT id FROM cid) = '7678069749886157684' THEN 'PASS' ELSE 'FAIL' END, (SELECT id FROM cid)),
 (2, 'All 18 new booking columns exist', CASE WHEN (SELECT n FROM missing_cols) = 0 THEN 'PASS' ELSE 'FAIL' END, COALESCE('missing: ' || (SELECT m FROM missing_cols), 'none missing')),
 (3, 'offer_amount is now optional', CASE WHEN (SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='booking_requests' AND column_name='offer_amount') = 'YES' THEN 'PASS' ELSE 'FAIL' END, ''),
 (4, 'All 4 new indexes exist', CASE WHEN (SELECT n FROM idx) = 4 THEN 'PASS' ELSE 'FAIL' END, (SELECT n FROM idx)::text || ' of 4'),
 (5, 'All 3 functions exist', CASE WHEN (SELECT count(*) FROM fns) = 3 THEN 'PASS' ELSE 'FAIL' END, (SELECT string_agg(proname, ', ') FROM fns)),
 (6, 'Privileged functions pin search_path with pg_temp', CASE WHEN NOT EXISTS (SELECT 1 FROM fns WHERE prosecdef AND cfg NOT LIKE '%pg_temp%') AND (SELECT count(*) FROM fns WHERE prosecdef) = 2 THEN 'PASS' ELSE 'FAIL' END, ''),
 (7, 'Public and signed-in keys cannot read or write the table', CASE WHEN NOT has_table_privilege('anon','public.booking_requests','INSERT') AND NOT has_table_privilege('anon','public.booking_requests','SELECT')
      AND NOT has_table_privilege('authenticated','public.booking_requests','INSERT') AND NOT has_table_privilege('authenticated','public.booking_requests','SELECT') THEN 'PASS' ELSE 'FAIL' END, ''),
 (8, 'Only the server can call the save function', CASE WHEN to_regprocedure('public.website_submit_booking_request(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text)') IS NOT NULL
      AND NOT has_function_privilege('anon','public.website_submit_booking_request(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text)','EXECUTE')
      AND NOT has_function_privilege('authenticated','public.website_submit_booking_request(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text)','EXECUTE')
      AND has_function_privilege('service_role','public.website_submit_booking_request(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text)','EXECUTE') THEN 'PASS' ELSE 'FAIL' END, ''),
 (9, 'Old public insert policy removed; RLS on', CASE WHEN NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='booking_requests' AND policyname='anon can insert booking_requests')
      AND (SELECT relrowsecurity FROM pg_class WHERE oid='public.booking_requests'::regclass) THEN 'PASS' ELSE 'FAIL' END,
      (SELECT COALESCE(string_agg(policyname, ', '), 'no policies') FROM pg_policies WHERE schemaname='public' AND tablename='booking_requests')),
 (10, 'Existing bookings untouched: every new column is empty on all existing rows', CASE WHEN (SELECT count(*) FROM public.booking_requests WHERE request_id IS NOT NULL OR booking_reference IS NOT NULL
      OR source IS NOT NULL OR payload_hash IS NOT NULL OR email_attempts IS NOT NULL OR updated_at IS NOT NULL OR client_hash IS NOT NULL OR pickup_lat IS NOT NULL) = 0 THEN 'PASS' ELSE 'CHECK' END,
      (SELECT count(*) FROM public.booking_requests)::text || ' existing rows')
) AS t(n, "check", result, detail)
ORDER BY n;
