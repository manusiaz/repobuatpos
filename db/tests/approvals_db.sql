-- The approval chain on the server (CLAUDE.md Rules · Approvals): a decision needs the approver's PIN, the approver's
-- level must reach the request's, and nobody decides their own request, whatever a device sends.
\set ON_ERROR_STOP 1
begin;
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000b1'), ('00000000-0000-0000-0000-0000000000b2');
create function pg_temp.expect(sql text, code text) returns void language plpgsql as $$
begin execute sql; raise exception 'expected % but it passed: %', code, sql;
exception when others then if sqlerrm not like code || '%' then raise exception 'expected %, got: %', code, sqlerrm; end if; end $$;
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
grant execute on function pg_temp.expect(text, text), pg_temp.as_user(text) to authenticated;
create temp table v (k text primary key, v text);
grant all on v to authenticated;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
create temp table t as select public.bn_bootstrap('Kopi Rantai', 'kopirantai', 'budi') as id;
grant select on t to authenticated;
select public.bn_write((select id from t), '[
  {"op":"put","coll":"outlets","id":"sen","data":{"id":"sen","name":"Senayan","serviceBps":0,"taxBps":0}},
  {"op":"put","coll":"employees","id":"budi","data":{"id":"budi","name":"Budi","role":"owner"}},
  {"op":"put","coll":"employees","id":"maya","data":{"id":"maya","name":"Maya","role":"pic","outlets":["sen"]}},
  {"op":"put","coll":"employees","id":"rina","data":{"id":"rina","name":"Rina","role":"cashier","outlets":["sen"]}},
  {"op":"put","coll":"orders","id":"o1","data":{"id":"o1","source":"pos","status":"open","outletId":"sen","lines":[{"id":"l1","productId":"p1","qty":1,"unitPrice":20000}],"total":20000}},
  {"op":"put","coll":"orders","id":"o9","data":{"id":"o9","source":"pos","status":"open","outletId":"sen","lines":[{"id":"l1","productId":"p1","qty":1,"unitPrice":300000}],"total":300000}}
]'::jsonb, 'setup', 'budi');
select public.bn_set_pins((select id from t), 'rina', '1234', null);
select public.bn_set_pins((select id from t), 'maya', '5678', '135790');
insert into v select 'code', public.bn_device_code((select id from t));
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2'); -- the shared register
select public.bn_device_join((select v from v where k = 'code'));
insert into v select 'rina', public.bn_staff_login((select id from t), 'rina', '1234')->>'token';
insert into v select 'maya', public.bn_staff_login((select id from t), 'maya', '5678')->>'token';

-- 1. a request that arrives already decided by someone else, with no PIN typed: refused
select pg_temp.expect($$ select public.bn_write((select id from t), '[{"op":"put","coll":"approvals","id":"x1","data":{"id":"x1","type":"void","level":"pic","status":"approved","requestedBy":"rina","decidedBy":"maya","subjectId":"o1","amount":20000}}]', 'x', 'rina', null, null, null, (select v::uuid from v where k = 'rina')) $$, 'BN005');
-- 2. Maya's PIN is right but the void of IDR 300,000 needs the manager: refused
select public.bn_write((select id from t), '[{"op":"put","coll":"approvals","id":"x2","data":{"id":"x2","type":"void","level":"manager","status":"waiting","requestedBy":"rina","subjectId":"o9","amount":300000}}]', 'x', 'rina', null, null, null, (select v::uuid from v where k = 'rina'));
select public.bn_check_approval_pin((select id from t), 'maya', '135790');
select pg_temp.expect($$ select public.bn_write((select id from t), '[{"op":"put","coll":"approvals","id":"x2","data":{"id":"x2","type":"void","level":"manager","status":"approved","requestedBy":"rina","decidedBy":"maya","subjectId":"o9","amount":300000}}]', 'x', 'maya', null, null, null, (select v::uuid from v where k = 'maya')) $$, 'BN009');
-- 3. Maya asks for a PIC-level void and approves it herself with her own PIN: refused
select public.bn_write((select id from t), '[{"op":"put","coll":"approvals","id":"x3","data":{"id":"x3","type":"void","level":"pic","status":"waiting","requestedBy":"maya","subjectId":"o1","amount":20000}}]', 'x', 'maya', null, null, null, (select v::uuid from v where k = 'maya'));
select public.bn_check_approval_pin((select id from t), 'maya', '135790');
select pg_temp.expect($$ select public.bn_write((select id from t), '[{"op":"put","coll":"approvals","id":"x3","data":{"id":"x3","type":"void","level":"pic","status":"approved","requestedBy":"maya","decidedBy":"maya","subjectId":"o1","amount":20000}}]', 'x', 'maya', null, null, null, (select v::uuid from v where k = 'maya')) $$, 'BN007');
-- the chain itself still works: Rina asks, Maya approves with her PIN
select public.bn_write((select id from t), '[{"op":"put","coll":"approvals","id":"x4","data":{"id":"x4","type":"void","level":"pic","status":"waiting","requestedBy":"rina","subjectId":"o1","amount":20000}}]', 'x', 'rina', null, null, null, (select v::uuid from v where k = 'rina'));
select public.bn_check_approval_pin((select id from t), 'maya', '135790');
select public.bn_write((select id from t), '[{"op":"put","coll":"approvals","id":"x4","data":{"id":"x4","type":"void","level":"pic","status":"approved","requestedBy":"rina","decidedBy":"maya","subjectId":"o1","amount":20000}}]', 'approval.approved', 'maya', null, null, null, (select v::uuid from v where k = 'maya'));
-- the real register: Rina is signed in, Maya walks up and types only her approval PIN; the decision and the void go
-- out under Rina's session in one write, and the server checks Maya's PIN proof and level
select public.bn_write((select id from t), '[{"op":"put","coll":"approvals","id":"x6","data":{"id":"x6","type":"void","level":"pic","status":"waiting","requestedBy":"rina","subjectId":"o1","amount":20000}}]', 'x', 'rina', null, null, null, (select v::uuid from v where k = 'rina'));
select pg_temp.expect($$ select public.bn_write((select id from t), '[{"op":"put","coll":"approvals","id":"x6","data":{"id":"x6","type":"void","level":"pic","status":"approved","requestedBy":"rina","decidedBy":"maya","subjectId":"o1","amount":20000}}]', 'approval.approved', 'maya', null, null, null, (select v::uuid from v where k = 'rina')) $$, 'BN008');
select public.bn_check_approval_pin((select id from t), 'maya', '135790');
select public.bn_write((select id from t), '[{"op":"put","coll":"orders","id":"o1","data":{"id":"o1","source":"pos","status":"voided","outletId":"sen","lines":[{"id":"l1","productId":"p1","qty":1,"unitPrice":20000}],"total":20000}},
  {"op":"put","coll":"approvals","id":"x6","data":{"id":"x6","type":"void","level":"pic","status":"approved","requestedBy":"rina","decidedBy":"maya","subjectId":"o1","amount":20000}}]', 'approval.approved', 'maya', null, null, null, (select v::uuid from v where k = 'rina'));
-- one PIN, one decision: the proof is spent
select public.bn_write((select id from t), '[{"op":"put","coll":"approvals","id":"x7","data":{"id":"x7","type":"void","level":"pic","status":"waiting","requestedBy":"rina","subjectId":"o9","amount":20000}}]', 'x', 'rina', null, null, null, (select v::uuid from v where k = 'rina'));
select pg_temp.expect($$ select public.bn_write((select id from t), '[{"op":"put","coll":"approvals","id":"x7","data":{"id":"x7","type":"void","level":"pic","status":"approved","requestedBy":"rina","decidedBy":"maya","subjectId":"o9","amount":20000}}]', 'x', 'maya', null, null, null, (select v::uuid from v where k = 'rina')) $$, 'BN008');
-- and a cashier-level request still approves itself (her own limit)
select public.bn_write((select id from t), '[{"op":"put","coll":"approvals","id":"x5","data":{"id":"x5","type":"discount","level":"cashier","pct":5,"status":"approved","requestedBy":"rina","decidedBy":"rina","subjectId":"o1"}}]', 'x', 'rina', null, null, null, (select v::uuid from v where k = 'rina'));
reset role;
do $$ begin assert (select data->>'status' from public.docs where coll = 'orders' and id = 'o1') = 'voided', 'the approved void went through'; end $$;
select 'approval chain on the server holds' as result;
rollback;
