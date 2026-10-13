-- Shared registers and staff sessions (20261016000000_borniz_staff_sessions.sql).
\set ON_ERROR_STOP 1
begin;
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000a2'), ('00000000-0000-0000-0000-0000000000a3');
create function pg_temp.expect(sql text, code text) returns void language plpgsql as $$
begin execute sql; raise exception 'expected % but it passed: %', code, sql;
exception when others then if sqlerrm not like code || '%' then raise exception 'expected %, got: %', code, sqlerrm; end if; end $$;
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
grant execute on function pg_temp.expect(text, text), pg_temp.as_user(text) to authenticated;
create temp table v (k text primary key, v text);
grant all on v to authenticated;

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1'); -- budi, owner account
create temp table t as select public.bn_bootstrap('Kopi Bersama', 'kopibersama', 'budi') as id;
grant select on t to authenticated;
select public.bn_write((select id from t), '[
  {"op":"put","coll":"outlets","id":"sen","data":{"id":"sen","name":"Senayan","serviceBps":0,"taxBps":0}},
  {"op":"put","coll":"products","id":"p1","data":{"id":"p1","name":"Kopi","basePrice":20000,"status":"live"}},
  {"op":"put","coll":"outletProducts","id":"p1|sen","data":{"productId":"p1","outletId":"sen","localPrice":null,"is86":false}},
  {"op":"put","coll":"employees","id":"budi","data":{"id":"budi","name":"Budi","role":"owner"}},
  {"op":"put","coll":"employees","id":"maya","data":{"id":"maya","name":"Maya","role":"pic"}},
  {"op":"put","coll":"employees","id":"rina","data":{"id":"rina","name":"Rina","role":"cashier","outlets":["sen"],"wage":5000000}},
  {"op":"put","coll":"orders","id":"o1","data":{"id":"o1","source":"pos","status":"open","outletId":"sen","lines":[{"id":"l1","productId":"p1","qty":1,"unitPrice":20000}],"total":20000}}
]'::jsonb, 'setup', 'budi');
select public.bn_set_pins((select id from t), 'rina', '1234', null);
select public.bn_set_pins((select id from t), 'maya', '5678', '135790');
insert into v select 'code', public.bn_device_code((select id from t));

-- the tablet (anonymous account) becomes a shared register
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select pg_temp.expect($$ select public.bn_device_join('000000') $$, 'BN081');
do $$ begin assert (public.bn_device_join((select v from v where k = 'code')))->>'slug' = 'kopibersama'; end $$;
do $$ begin assert public.bn_member_role((select id from t)) = 'device'; end $$;
select pg_temp.expect($$ select public.bn_device_join((select v from v where k = 'code')) $$, 'BN081'); -- a code works once
-- nobody signed in on it: guest rules only
select pg_temp.expect($$ select public.bn_write((select id from t), '[{"op":"put","coll":"products","id":"p1","data":{"id":"p1","name":"Kopi","basePrice":1,"status":"live"}}]', 'x', 'budi') $$, 'BN031');
select pg_temp.expect($$ select public.bn_device_code((select id from t)) $$, 'BN080');
-- Rina signs in with her PIN
do $$ declare r jsonb := public.bn_staff_login((select id from t), 'rina', '0000'); begin assert r ? 'error' and not r ? 'token'; end $$;
insert into v select 'rina', public.bn_staff_login((select id from t), 'rina', '1234')->>'token';
select pg_temp.expect($$ select public.bn_write((select id from t), '[{"op":"put","coll":"products","id":"p1","data":{"id":"p1","name":"Kopi","basePrice":1,"status":"live"}}]', 'x', 'budi', null, null, null, (select v::uuid from v where k = 'rina')) $$, 'BN054');
select pg_temp.expect($$ select public.bn_write((select id from t), '[{"op":"put","coll":"employees","id":"rina","data":{"id":"rina","name":"Rina","role":"cashier","outlets":["sen"],"wage":9000000}}]', 'x', 'rina', null, null, null, (select v::uuid from v where k = 'rina')) $$, 'BN054');
select pg_temp.expect($$ select public.bn_write((select id from t), '[{"op":"put","coll":"orders","id":"o1","data":{"id":"o1","source":"pos","status":"voided","outletId":"sen","lines":[{"id":"l1","productId":"p1","qty":1,"unitPrice":20000}],"total":20000}}]', 'x', 'rina', null, null, null, (select v::uuid from v where k = 'rina')) $$, 'BN056');
select pg_temp.expect($$ select public.bn_write((select id from t), '[{"op":"put","coll":"approvals","id":"ap1","data":{"id":"ap1","type":"void","level":"cashier","status":"approved","requestedBy":"rina","decidedBy":"rina","subjectId":"o1","amount":5000000}}]', 'x', 'rina', null, null, null, (select v::uuid from v where k = 'rina')) $$, 'BN053');
select pg_temp.expect($$ select public.bn_write((select id from t), '[{"op":"put","coll":"refunds","id":"rf1","data":{"id":"rf1","orderId":"o1","paymentId":"x","amount":20000,"approvalId":null}}]', 'x', 'rina', null, null, null, (select v::uuid from v where k = 'rina')) $$, 'BN055');
-- what a cashier does every day still works: sell, mark sold out, a 5% discount on her own level
select public.bn_write((select id from t), '[{"op":"put","coll":"outletProducts","id":"p1|sen","data":{"productId":"p1","outletId":"sen","localPrice":null,"is86":true}},
  {"op":"put","coll":"orders","id":"o2","data":{"id":"o2","source":"pos","status":"open","outletId":"sen","lines":[],"total":0}},
  {"op":"put","coll":"approvals","id":"ap2","data":{"id":"ap2","type":"discount","level":"cashier","pct":5,"status":"approved","requestedBy":"rina","decidedBy":"rina","subjectId":"o2"}}]', 'order.sold', 'someone-else', null, null, null, (select v::uuid from v where k = 'rina'));
-- the void request goes to Maya (PIC), who approves it with her approval PIN on the same register, then the void applies
select public.bn_write((select id from t), '[{"op":"put","coll":"approvals","id":"ap3","data":{"id":"ap3","type":"void","level":"pic","status":"waiting","requestedBy":"rina","subjectId":"o1","amount":20000}}]', 'x', 'rina', null, null, null, (select v::uuid from v where k = 'rina'));
select public.bn_check_approval_pin((select id from t), 'maya', '135790');
select public.bn_write((select id from t), '[{"op":"put","coll":"orders","id":"o1","data":{"id":"o1","source":"pos","status":"voided","outletId":"sen","lines":[{"id":"l1","productId":"p1","qty":1,"unitPrice":20000}],"total":20000}},
  {"op":"put","coll":"approvals","id":"ap3","data":{"id":"ap3","type":"void","level":"pic","status":"approved","requestedBy":"rina","decidedBy":"maya","subjectId":"o1","amount":20000}}]', 'approval.decided', 'maya', null, null, null, (select v::uuid from v where k = 'rina'));
-- a token belongs to the device that signed in
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect($$ select public.bn_write((select id from t), '[{"op":"put","coll":"orders","id":"o3","data":{"id":"o3","source":"pos","status":"open","outletId":"sen","lines":[],"total":0}}]', 'x', 'rina', null, null, null, (select v::uuid from v where k = 'rina')) $$, 'BN082');
reset role;
do $$ begin
  assert (select data->>'status' from public.docs where coll = 'orders' and id = 'o1') = 'voided', 'the approved void went through';
  assert (select actor from public.audit_log where action = 'order.sold') = 'rina', 'the audit names the person signed in, not what the device claims';
  assert (select count(*) from private.staff_sessions) = 1;
end $$;
select 'staff sessions hold' as result;
rollback;
