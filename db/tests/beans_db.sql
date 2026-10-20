-- Beans on the server (src/domain/loyalty.ts: earn on paid orders only): staff add beans only as the welcome gift, the
-- earn of a paid order (once, at most its tier's rate) or the rewards of a paid order; adjustments are the owner's; a
-- waiting request can't be rewritten before it is decided.
\set ON_ERROR_STOP 1
begin;
set local check_function_bodies = off; -- pg_temp.w reads t, made below
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000e1'), ('00000000-0000-0000-0000-0000000000e2');
create function pg_temp.expect(sql text, code text) returns void language plpgsql as $$
begin execute sql; raise exception 'expected % but it passed: %', code, sql;
exception when others then if sqlerrm not like code || '%' then raise exception 'expected %, got: %', code, sqlerrm; end if; end $$;
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create function pg_temp.w(ops text, staff text) returns int language sql as $$
  select public.bn_write((select id from t), ops::jsonb, 'x', staff, null, null, null, (select v::uuid from v where k = staff)) $$;
grant execute on function pg_temp.expect(text, text), pg_temp.as_user(text), pg_temp.w(text, text) to authenticated;
create temp table v (k text primary key, v text);
grant all on v to authenticated;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
create temp table t as select public.bn_bootstrap('Kopi Beans', 'kopibeans', 'budi') as id;
grant select on t to authenticated;
select public.bn_write((select id from t), '[
  {"op":"put","coll":"outlets","id":"sen","data":{"id":"sen","name":"Senayan","serviceBps":0,"taxBps":0}},
  {"op":"put","coll":"employees","id":"budi","data":{"id":"budi","name":"Budi","role":"owner"}},
  {"op":"put","coll":"employees","id":"maya","data":{"id":"maya","name":"Maya","role":"pic","outlets":["sen"]}},
  {"op":"put","coll":"employees","id":"sari","data":{"id":"sari","name":"Sari","role":"pic","outlets":["sen"]}},
  {"op":"put","coll":"employees","id":"rina","data":{"id":"rina","name":"Rina","role":"cashier","outlets":["sen"]}},
  {"op":"put","coll":"customers","id":"c1","data":{"id":"c1","name":"Dewi","phone":"0811","joinedAt":1,"credit":0,"deposit":0}},
  {"op":"put","coll":"ledger","id":"l0","data":{"customerId":"c1","points":50,"reason":"Welcome beans","at":1}},
  {"op":"put","coll":"orders","id":"o1","data":{"id":"o1","no":"#1","source":"pos","status":"paid","outletId":"sen","customerId":"c1","lines":[],"subtotal":20000,"discount":0,"total":20000}},
  {"op":"put","coll":"orders","id":"o2","data":{"id":"o2","no":"#2","source":"pos","status":"open","outletId":"sen","customerId":"c1","lines":[],"subtotal":90000,"discount":0,"total":90000}}
]'::jsonb, 'setup', 'budi');
select public.bn_set_pins((select id from t), 'rina', '1234', null);
select public.bn_set_pins((select id from t), 'maya', '5678', '135790');
select public.bn_set_pins((select id from t), 'sari', '4321', '975310');
insert into v select 'code', public.bn_device_code((select id from t));
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2'); -- the shared register
select public.bn_device_join((select v from v where k = 'code'));
insert into v select k, public.bn_staff_login((select id from t), k, p)->>'token' from (values ('rina', '1234'), ('maya', '5678'), ('sari', '4321')) x(k, p);



-- 1. beans out of nothing: an "adjustment" by a cashier, an earn on an unpaid bill, an earn above the tier rate
select pg_temp.expect($$ select pg_temp.w('[{"op":"put","coll":"ledger","id":"l1","data":{"customerId":"c1","points":100000,"reason":"Adjustment · x","at":2}}]', 'rina') $$, 'BN061');
select pg_temp.expect($$ select pg_temp.w('[{"op":"put","coll":"ledger","id":"l2","data":{"customerId":"c1","points":90,"reason":"Order #2","orderId":"o2","at":2}}]', 'rina') $$, 'BN061');
select pg_temp.expect($$ select pg_temp.w('[{"op":"put","coll":"ledger","id":"l3","data":{"customerId":"c1","points":500,"reason":"Order #1","orderId":"o1","at":2}}]', 'rina') $$, 'BN061');
select pg_temp.expect($$ select pg_temp.w('[{"op":"put","coll":"ledger","id":"l4","data":{"customerId":"c1","points":50,"reason":"Welcome beans","at":2}}]', 'rina') $$, 'BN061');
select pg_temp.expect($$ select pg_temp.w('[{"op":"put","coll":"ledger","id":"l5","data":{"customerId":"c1","points":1000,"reason":"Redeem · x","at":2}}]', 'rina') $$, 'BN061');
-- 2. the paid bill earns once
select pg_temp.w('[{"op":"put","coll":"ledger","id":"l6","data":{"customerId":"c1","points":20,"reason":"Order #1","orderId":"o1","at":3}}]', 'rina');
select pg_temp.expect($$ select pg_temp.w('[{"op":"put","coll":"ledger","id":"l7","data":{"customerId":"c1","points":20,"reason":"Order #1","orderId":"o1","at":4}}]', 'rina') $$, 'BN061');
-- 3. a waiting +50 request can't become +50,000 before the owner signs it
select pg_temp.w('[{"op":"put","coll":"approvals","id":"p1","data":{"id":"p1","type":"points","level":"owner","status":"waiting","title":"+50 beans · Dewi","requestedBy":"maya","outletId":"sen","subjectId":"c1","payload":{"customerId":"c1","points":50}}}]', 'maya');
select pg_temp.expect($$ select pg_temp.w('[{"op":"put","coll":"approvals","id":"p1","data":{"id":"p1","type":"points","level":"owner","status":"waiting","title":"+50 beans · Dewi","requestedBy":"maya","outletId":"sen","subjectId":"c1","payload":{"customerId":"c1","points":50000}}}]', 'maya') $$, 'BN048');
-- the owner adjusts directly
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1'); select set_config('bn.staff_role', '', true); -- each write is its own transaction in the app
select public.bn_write((select id from t), '[{"op":"put","coll":"ledger","id":"l8","data":{"customerId":"c1","points":30,"reason":"Adjustment · ulang tahun","at":5}}]'::jsonb, 'x', 'budi');
reset role;
do $$ begin assert (select sum((data->>'points')::numeric) from public.docs where coll = 'ledger') = 100, 'welcome 50 + order 20 + owner 30'; end $$;
select 'beans on the server hold' as result;
rollback;
