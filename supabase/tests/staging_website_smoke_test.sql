-- ================================================================
-- DODO-Staging smoke test for the three website migrations (run AFTER applying them).
-- Safe: everything runs in one transaction that is ALWAYS rolled back. No row is kept.
-- The result is shown as an error message on purpose (that is what forces the rollback):
--   SMOKE_TEST_PASS: n/n checks ...   or   SMOKE_TEST_FAIL: <failed checks>
-- DODO-Staging only (cluster 7678069749886157684).
-- ================================================================
BEGIN;

DO $smoke$
DECLARE
  v_id text := (SELECT system_identifier FROM pg_control_system())::text;
  v_pass int := 0;
  v_fail text[] := ARRAY[]::text[];
  v_tag text := 'zz' || substr(md5(clock_timestamp()::text), 1, 8);
  v_day text := to_char((now() AT TIME ZONE 'Australia/Brisbane')::date + 3, 'YYYY-MM-DD');
  v_req uuid := gen_random_uuid();
  r jsonb; r2 jsonb; n bigint;
BEGIN
  IF v_id <> '7678069749886157684' THEN
    RAISE EXCEPTION 'STAGING_ONLY: refusing database %.', v_id;
  END IF;

  -- 1. Objects exist
  SELECT count(*) INTO n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'website\_%';
  IF n = 15 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail || format('C01 expected 15 website_ functions, found %s', n); END IF;
  IF to_regclass('public.website_email_events') IS NOT NULL AND to_regclass('public.website_email_delivery_status') IS NOT NULL
     THEN v_pass := v_pass + 1; ELSE v_fail := v_fail || 'C02 delivery log table/view missing'::text; END IF;
  SELECT count(*) INTO n FROM information_schema.columns WHERE table_schema = 'public'
    AND ((table_name = 'booking_requests' AND column_name IN ('request_id','booking_reference','client_hash','pickup_lat','destination_lng'))
      OR (table_name = 'contact_messages' AND column_name IN ('request_id','reference','team_notified_at'))
      OR (table_name = 'driver_applications' AND column_name IN ('request_id','reference','home_state')));
  IF n = 11 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail || format('C03 expected 11 new columns, found %s', n); END IF;

  -- 2. Access: public and signed-in keys locked out; RLS on
  IF NOT has_table_privilege('anon', 'public.booking_requests', 'INSERT') AND NOT has_table_privilege('anon', 'public.booking_requests', 'SELECT')
     AND NOT has_table_privilege('anon', 'public.contact_messages', 'INSERT') AND NOT has_table_privilege('anon', 'public.driver_applications', 'SELECT')
     AND NOT has_table_privilege('authenticated', 'public.driver_applications', 'SELECT') AND NOT has_table_privilege('anon', 'public.website_email_events', 'SELECT')
     AND NOT has_table_privilege('anon', 'public.website_email_delivery_status', 'SELECT')
     THEN v_pass := v_pass + 1; ELSE v_fail := v_fail || 'C04 public/signed-in key still has table access'::text; END IF;
  IF NOT has_function_privilege('anon', 'public.website_submit_booking_request(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text)', 'EXECUTE')
     AND NOT has_function_privilege('anon', 'public.website_submit_contact_message(uuid,text,text,text,text,text)', 'EXECUTE')
     AND NOT has_function_privilege('authenticated', 'public.website_submit_driver_application(uuid,text,text,text,text,text,text,text,text,text)', 'EXECUTE')
     AND NOT has_function_privilege('anon', 'public.website_record_email_event(text,text,text,text,text,text)', 'EXECUTE')
     AND has_function_privilege('service_role', 'public.website_submit_booking_request(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text)', 'EXECUTE')
     THEN v_pass := v_pass + 1; ELSE v_fail := v_fail || 'C05 function permissions wrong'::text; END IF;
  SELECT count(*) INTO n FROM pg_class WHERE oid IN ('public.booking_requests'::regclass, 'public.contact_messages'::regclass,
    'public.driver_applications'::regclass, 'public.website_email_events'::regclass) AND relrowsecurity;
  IF n = 4 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail || format('C06 RLS on %s of 4 tables', n); END IF;

  -- 3. Behaviour, as the Edge Functions call it (service role); all rolled back at the end
  EXECUTE 'SET LOCAL ROLE service_role';
  r := public.website_submit_booking_request(v_req, 'ZZ STAGING SMOKE ' || v_tag, v_tag || '@example.com', '0400 000 000', 'DODO Comfort',
       'ZZ 1 Smoke St, Brisbane City QLD', 'ZZ Smoke Airport', v_day, '10:30', 'smoke-' || v_tag, '-27.470500', '153.026000', '', '');
  IF r->>'ok' = 'true' AND r->>'booking_reference' ~ '^DODO-\d{6}-[0-9A-F]{6}$' AND (r->>'pickup_lat')::numeric = -27.4705
     THEN v_pass := v_pass + 1; ELSE v_fail := v_fail || ('C07 booking save: ' || r::text); END IF;
  r2 := public.website_submit_booking_request(v_req, 'ZZ STAGING SMOKE ' || v_tag, v_tag || '@example.com', '0400 000 000', 'DODO Comfort',
       'ZZ 1 Smoke St, Brisbane City QLD', 'ZZ Smoke Airport', v_day, '10:30', 'smoke-' || v_tag, '-27.470500', '153.026000', '', '');
  IF r2->>'duplicate' = 'true' AND r2->>'booking_reference' = r->>'booking_reference'
     THEN v_pass := v_pass + 1; ELSE v_fail := v_fail || ('C08 booking duplicate: ' || r2::text); END IF;
  r2 := public.website_submit_booking_request(gen_random_uuid(), 'S', 'bad', '1', 'DODO XL', '', 'x', '2020-01-01', '25:00');
  IF r2->>'error' = 'VALIDATION_FAILED' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail || ('C09 booking validation: ' || r2::text); END IF;
  r2 := public.website_record_booking_email(v_req, 'dodo', true, 'smoke_email_' || v_tag, NULL);
  IF r2->>'dodo_notified' = 'true' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail || ('C10 booking email record: ' || r2::text); END IF;

  r := public.website_submit_contact_message(gen_random_uuid(), 'ZZ Smoke Contact', 'c' || v_tag || '@example.com', '', 'ZZ staging smoke test message', 'smoke-' || v_tag);
  IF r->>'ok' = 'true' AND r->>'reference' ~ '^DODO-MSG-\d{6}-[0-9A-F]{6}$' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail || ('C11 contact save: ' || r::text); END IF;
  r := public.website_submit_driver_application(gen_random_uuid(), 'ZZ Smoke Driver', 'd' || v_tag || '@example.com', '0400 000 001', 'NSW', '3 years', 'no', 'ZZ car', 'smoke-' || v_tag, 'QLD');
  IF r->>'ok' = 'true' AND r->>'reference' ~ '^DODO-DRV-\d{6}-[0-9A-F]{6}$' AND r->>'state' = 'NSW' AND r->>'home_state' = 'QLD'
     THEN v_pass := v_pass + 1; ELSE v_fail := v_fail || ('C12 driver application save: ' || r::text); END IF;

  r := public.website_record_email_event('msg_smoke_' || v_tag, 'email.delivered', 'smoke_email_' || v_tag, now()::text, NULL, NULL);
  r2 := public.website_record_email_event('msg_smoke_' || v_tag, 'email.delivered', 'smoke_email_' || v_tag, now()::text, NULL, NULL);
  SELECT count(*) INTO n FROM public.website_email_delivery_status WHERE email_id = 'smoke_email_' || v_tag AND latest_event = 'email.delivered';
  IF r->>'duplicate' = 'false' AND r2->>'duplicate' = 'true' AND n = 1 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail || format('C13 delivery log: %s %s %s', r, r2, n); END IF;
  EXECUTE 'RESET ROLE';

  -- 4. Existing rider, driver and payment data untouched (these migrations never reference them)
  SELECT count(*) INTO n FROM pg_depend d JOIN pg_proc p ON p.oid = d.objid
    WHERE p.proname LIKE 'website\_%' AND d.refobjid IN (SELECT oid FROM pg_class WHERE relnamespace = 'public'::regnamespace
      AND relname IN ('rides', 'drivers', 'driver_documents', 'driver_vehicles', 'payments'));
  IF n = 0 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail || 'C14 a website function depends on a rider/driver/payment table'::text; END IF;

  IF cardinality(v_fail) = 0 THEN
    RAISE EXCEPTION 'SMOKE_TEST_PASS: %/% checks passed. Rolled back: nothing was saved.', v_pass, v_pass;
  ELSE
    RAISE EXCEPTION 'SMOKE_TEST_FAIL: % passed, % failed: %. Rolled back: nothing was saved.', v_pass, cardinality(v_fail), array_to_string(v_fail, ' | ');
  END IF;
END $smoke$;

ROLLBACK;
