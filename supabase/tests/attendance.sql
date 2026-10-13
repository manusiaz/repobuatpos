-- Attendance machines (20261013000000_borniz_attendance.sql): the serial names the business, user IDs map to staff, re-sends are no-ops.
\set ON_ERROR_STOP 1
begin;
insert into auth.users values ('00000000-0000-0000-0000-00000000000d');
delete from private.secrets where name = 'server'; insert into private.secrets values ('server', 'server-secret-attendance');
create function pg_temp.expect(sql text, code text) returns void language plpgsql as $$
begin execute sql; raise exception 'expected % but it passed: %', code, sql;
exception when others then if sqlerrm not like code || '%' then raise exception 'expected %, got: %', code, sqlerrm; end if; end $$;
grant execute on function pg_temp.expect(text, text) to anon;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true);
create temp table t as select public.bn_bootstrap('Kopi Absen', 'kopiabsen', 'budi') as id;
grant select on t to anon;
select public.bn_write((select id from t), '[{"op":"put","coll":"integrations","id":"zk1","data":{"id":"zk1","connector":"attendance-zkteco","kind":"attendance","outletId":"sen","name":"Attendance machine","enabled":true,
  "config":{"serial":"CKJF2039","tz":"+07:00","user.3":"rina","user.12":"tono"}}}]'::jsonb, 'x', 'budi');
reset role;
set local role anon;
select pg_temp.expect($$ select public.bn_machine_clock('wrong', 'CKJF2039', '[]') $$, 'BN016');
select pg_temp.expect($$ select public.bn_machine_clock('server-secret-attendance', 'NOPE123', '[]') $$, 'BN060');
reset role;
do $$ declare s text := 'server-secret-attendance'; r jsonb; begin
  set local role anon;
  r := public.bn_machine_clock(s, 'CKJF2039', '[{"pin":"3","time":"2026-10-13 07:58:02","status":"0"},{"pin":"3","time":"2026-10-13 17:01:40","status":"0"},
    {"pin":"12","time":"2026-10-13 08:10:00","status":"0"},{"pin":"12","time":"2026-10-13 12:00:00","status":"2"},{"pin":"99","time":"2026-10-13 09:00:00","status":"0"}]');
  assert (r->>'saved')::int = 4 and r->'unknown' = '["99"]', 'saved 4, user 99 unknown: ' || r;
  r := public.bn_machine_clock(s, 'CKJF2039', '[{"pin":"3","time":"2026-10-13 07:58:02","status":"0"}]');
  assert (r->>'saved')::int = 0, 're-sent scan is a no-op';
  reset role;
  assert (select string_agg(data->>'kind', ',' order by t) from public.docs where coll = 'clock' and data->>'employeeId' = 'rina') = 'in,out', 'status 0 alternates in → out';
  assert (select string_agg(data->>'kind', ',' order by t) from public.docs where coll = 'clock' and data->>'employeeId' = 'tono') = 'in,break', 'status 2 is a break';
  assert (select (data->>'at')::bigint from public.docs where coll = 'clock' and data->>'employeeId' = 'rina' order by t limit 1)
    = (extract(epoch from timestamptz '2026-10-13 07:58:02+07') * 1000)::bigint, 'machine time is read in the outlet time zone';
  assert (select data->>'lastError' from public.docs where coll = 'integrations' and id = 'zk1') like '%99%', 'unlinked users show on the connection';
  assert (select count(*) from public.audit_log where action = 'clock.machine_unlinked') = 1, 'the unlinked scan is kept in the audit trail';
end $$;
select 'attendance machines hold' as result;
rollback;
