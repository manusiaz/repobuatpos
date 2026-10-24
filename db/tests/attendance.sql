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
select public.bn_write((select id from t), '[{"op":"put","coll":"employees","id":"rina","data":{"id":"rina","name":"Rina","role":"cashier","outlets":["sen"]}},
  {"op":"put","coll":"employees","id":"tono","data":{"id":"tono","name":"Tono","role":"cashier","outlets":["sen"]}}]'::jsonb, 'x', 'budi');
select public.bn_write((select id from t), '[{"op":"put","coll":"integrations","id":"zk1","data":{"id":"zk1","connector":"attendance-zkteco","kind":"attendance","outletId":"sen","name":"Attendance machine","enabled":true,
  "config":{"serial":"CKJF2039","tz":"+07:00","user.3":"rina","user.12":"tono"}}}]'::jsonb, 'x', 'budi');
select public.bn_write((select id from t), '[{"op":"put","coll":"integrations","id":"fs1","data":{"id":"fs1","connector":"attendance-fingerspot","kind":"attendance","outletId":"sen","name":"Fingerspot machine","enabled":true,
  "config":{"serial":"C2611851572E0C2D","key":"k-secret","user.622":"rina"}}}]'::jsonb, 'x', 'budi');
reset role;
create temp table day as select to_char((now() at time zone 'Asia/Jakarta') - interval '1 day', 'YYYY-MM-DD') d1, to_char((now() at time zone 'Asia/Jakarta') - interval '2 days', 'YYYY-MM-DD') d2, to_char((now() at time zone 'Asia/Jakarta') - interval '1 hour', 'YYYY-MM-DD HH24:MI:SS') now1;
grant select on day to anon;
create function pg_temp.at(s text) returns text language sql as $$ select replace(replace(replace(s, 'D1', (select d1 from day)), 'D2', (select d2 from day)), 'NOW1', (select now1 from day)) $$;
grant execute on function pg_temp.at(text) to anon;
set local role anon;
select pg_temp.expect($$ select public.bn_machine_clock('server-secret-attendance', 'C2611851572E0C2D', '[{"pin":"622","time":"2026-10-14 08:00:00","status":"0"}]') $$, 'BN063');
select pg_temp.expect($$ select public.bn_machine_clock('server-secret-attendance', 'C2611851572E0C2D', '[{"pin":"622","time":"2026-10-14 08:00:00","status":"0"}]', 'wrong') $$, 'BN063');
do $$ begin assert (public.bn_machine_clock('server-secret-attendance', 'C2611851572E0C2D', pg_temp.at('[{"pin":"622","time":"D1 08:00","status":"0"}]')::jsonb, 'k-secret')->>'saved')::int = 1, 'Fingerspot scan with the right key is saved'; end $$;
select pg_temp.expect($$ select public.bn_machine_clock('wrong', 'CKJF2039', '[]') $$, 'BN016');
select pg_temp.expect($$ select public.bn_machine_clock('server-secret-attendance', 'NOPE123', '[]') $$, 'BN060');
reset role;
do $$ declare s text := 'server-secret-attendance'; r jsonb; begin
  set local role anon;
  r := public.bn_machine_clock(s, 'CKJF2039', pg_temp.at('[{"pin":"3","time":"D2 07:58:02","status":"0"},{"pin":"3","time":"D2 17:01:40","status":"0"},
    {"pin":"12","time":"D2 08:10:00","status":"0"},{"pin":"12","time":"D2 12:00:00","status":"2"},{"pin":"99","time":"D2 09:00:00","status":"0"}]')::jsonb);
  assert (r->>'saved')::int = 4 and r->'unknown' = '["99"]', 'saved 4, user 99 unknown: ' || r;
  r := public.bn_machine_clock(s, 'CKJF2039', pg_temp.at('[{"pin":"3","time":"D2 07:58:02","status":"0"}]')::jsonb);
  assert (r->>'saved')::int = 0, 're-sent scan is a no-op';
  reset role;
  assert (select string_agg(data->>'kind', ',' order by t) from public.docs where coll = 'clock' and data->>'employeeId' = 'rina') = 'in,out,in', 'status 0 alternates in → out; a new day starts with in';
  assert (select string_agg(data->>'kind', ',' order by t) from public.docs where coll = 'clock' and data->>'employeeId' = 'tono') = 'in,break', 'status 2 is a break';
  assert (select (data->>'at')::bigint from public.docs where coll = 'clock' and data->>'employeeId' = 'rina' order by t limit 1)
    = (extract(epoch from ((select d2 from day) || ' 07:58:02+07')::timestamptz) * 1000)::bigint, 'machine time is read in the outlet time zone';
  assert (select data->>'lastError' from public.docs where coll = 'integrations' and id = 'zk1') like '%99%', 'unlinked users show on the connection';
  assert (select count(*) from public.audit_log where action = 'clock.machine_unlinked') = 1, 'the unlinked scan is kept in the audit trail';
end $$;

-- the slot holds the day the machine is plugged in: a bad row, a wrong machine clock, a Fingerspot label or a resigned
-- employee never blocks the other scans (the machine would resend the batch forever), and a serial can be pinned to the
-- outlet's network address
do $$ declare s text := 'server-secret-attendance'; r jsonb; begin
  set local role authenticated; perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true);
  perform public.bn_write((select id from t), '[{"op":"put","coll":"employees","id":"lia","data":{"id":"lia","name":"Lia","role":"cashier","active":false,"outlets":["sen"]}},
    {"op":"put","coll":"integrations","id":"zk1","data":{"id":"zk1","connector":"attendance-zkteco","kind":"attendance","outletId":"sen","name":"Attendance machine","enabled":true,
     "config":{"serial":"CKJF2039","tz":"+07:00","user.3":"rina","user.12":"tono","user.7":"lia"}}}]'::jsonb, 'x', 'budi');
  reset role; set local role anon;
  r := public.bn_machine_clock(s, 'CKJF2039', pg_temp.at('[{"pin":"12","time":"2026-02-30 08:00:00","status":"0"},{"pin":"12","time":"D1 18:00:00","status":"I"},
    {"pin":"12","time":"2019-01-01 08:00:00","status":"0"},{"pin":"12","time":"2099-01-01 08:00:00","status":"0"},{"pin":"7","time":"D1 09:00:00","status":"0"},{"pin":"3","time":"NOW1","status":"1"}]')::jsonb);
  assert (r->>'saved')::int = 2 and (r->>'skipped')::int = 4, 'the good rows are saved, the rest skipped, no error: ' || r::text;
  r := public.bn_machine_clock(s, 'C2611851572E0C2D', pg_temp.at('[{"pin":"622","time":"D1 17:30","status":"Scan Keluar"}]')::jsonb, 'k-secret');
  assert (r->>'saved')::int = 1, 'a Fingerspot label is read: ' || r::text;
  reset role;
  assert (select data->>'kind' from public.docs where coll = 'clock' and data->>'employeeId' = 'rina' and data->>'noPhoto' like '%Fingerspot%' order by t desc limit 1) = 'out', 'Scan Keluar is a clock-out';
  -- Fingerspot sends ZKTeco's English labels too: Break Out starts a break, Break In / Kembali ends it, only Check Out leaves
  set local role anon;
  r := public.bn_machine_clock(s, 'C2611851572E0C2D', pg_temp.at('[{"pin":"622","time":"D2 08:00","status":"Check In"},{"pin":"622","time":"D2 12:00","status":"Break Out"},
    {"pin":"622","time":"D2 13:00","status":"Break In"},{"pin":"622","time":"D2 15:00","status":"Scan Istirahat"},{"pin":"622","time":"D2 15:20","status":"Kembali Istirahat"},
    {"pin":"622","time":"D2 17:00","status":"Check Out"}]')::jsonb, 'k-secret');
  reset role;
  assert (select string_agg(data->>'kind', ',' order by t) from public.docs where coll = 'clock' and data->>'employeeId' = 'rina'
    and t between (extract(epoch from ((select d2 from day) || ' 08:00+07:00')::timestamptz) * 1000)::bigint and (extract(epoch from ((select d2 from day) || ' 17:00+07:00')::timestamptz) * 1000)::bigint) = 'in,break,in,break,in,out', 'labels read in the right order: ' || (select string_agg(data->>'kind' || '@' || (data->>'at'), ',' order by t) from public.docs where coll = 'clock' and data->>'employeeId' = 'rina');
  assert not exists (select 1 from public.docs where coll = 'clock' and data->>'employeeId' = 'lia'), 'a resigned employee is not clocked in';
  assert (select data->>'lastError' from public.docs where coll = 'integrations' and id = 'zk1') like '%date and time%', 'a wrong machine clock shows on the connection';
  -- the owner pins the machine to the outlet's internet address: a scan from anywhere else is refused
  set local role authenticated;
  perform public.bn_write((select id from t), '[{"op":"put","coll":"integrations","id":"zk1","data":{"id":"zk1","connector":"attendance-zkteco","kind":"attendance","outletId":"sen","name":"Attendance machine","enabled":true,
     "config":{"serial":"CKJF2039","tz":"+07:00","user.3":"rina","ip":"203.0.113.5"}}}]'::jsonb, 'x', 'budi');
  reset role; set local role anon;
  begin perform public.bn_machine_clock(s, 'CKJF2039', '[]', null, '198.51.100.9'); raise exception 'a spoofed address passed'; exception when others then if sqlerrm not like 'BN065%' then raise; end if; end;
  assert (public.bn_machine_clock(s, 'CKJF2039', '[]', null, '203.0.113.5')->>'saved')::int = 0, 'the outlet address is accepted';
  assert public.bn_machine_clock(s, 'CKJF2039', '[]', null, '203.0.113.5')->>'tz' = '+07:00', 'the machine is told its time zone';
  reset role;
end $$;
select 'attendance machines hold' as result;
rollback;
