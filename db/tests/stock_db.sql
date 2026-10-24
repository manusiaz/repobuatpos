-- Stock on the server (spec/CLAUDE.md Stock opname rules): stock changes only as the movement of an approved request
-- (waste, adjustment, opname) or a received PO, once, for the approved quantity; a submitted count is locked.
\set ON_ERROR_STOP 1
begin;
set local check_function_bodies = off; -- pg_temp.w reads t, made below
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000c1'), ('00000000-0000-0000-0000-0000000000c2');
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
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
create temp table t as select public.bn_bootstrap('Kopi Stok', 'kopistok', 'budi') as id;
grant select on t to authenticated;
select public.bn_write((select id from t), '[
  {"op":"put","coll":"outlets","id":"sen","data":{"id":"sen","name":"Senayan","serviceBps":0,"taxBps":0}},
  {"op":"put","coll":"employees","id":"budi","data":{"id":"budi","name":"Budi","role":"owner"}},
  {"op":"put","coll":"employees","id":"maya","data":{"id":"maya","name":"Maya","role":"pic","outlets":["sen"]}},
  {"op":"put","coll":"employees","id":"sari","data":{"id":"sari","name":"Sari","role":"pic","outlets":["sen"]}},
  {"op":"put","coll":"employees","id":"rina","data":{"id":"rina","name":"Rina","role":"cashier","outlets":["sen"]}},
  {"op":"put","coll":"pos","id":"po1","data":{"id":"po1","outletId":"sen","status":"sent","lines":[{"stockItemId":"beans","qty":5,"received":0}]}}
]'::jsonb, 'setup', 'budi');
select public.bn_set_pins((select id from t), 'rina', '1234', null);
select public.bn_set_pins((select id from t), 'maya', '5678', '135790');
select public.bn_set_pins((select id from t), 'sari', '4321', '975310');
insert into v select 'code', public.bn_device_code((select id from t));
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2'); -- the shared register
select public.bn_device_join((select v from v where k = 'code'));
insert into v select k, public.bn_staff_login((select id from t), k, p)->>'token' from (values ('rina', '1234'), ('maya', '5678'), ('sari', '4321')) x(k, p);

-- 1. stock written straight in, no request behind it: refused
select pg_temp.expect($$ select pg_temp.w('[{"op":"put","coll":"movements","id":"m1","data":{"outletId":"sen","stockItemId":"beans","qty":50,"type":"adjust","sourceId":"nothing","by":"rina","at":1}}]', 'rina') $$, 'BN057');
select pg_temp.expect($$ select pg_temp.w('[{"op":"put","coll":"movements","id":"m2","data":{"outletId":"sen","stockItemId":"beans","qty":3,"type":"opname_adjustment","sourceId":"op1","by":"maya","at":1}}]', 'maya') $$, 'BN057');
select pg_temp.expect($$ select pg_temp.w('[{"op":"put","coll":"movements","id":"m3","data":{"outletId":"sen","stockItemId":"beans","qty":9,"type":"receipt","sourceId":"po-none","by":"maya","at":1}}]', 'maya') $$, 'BN057');

-- 2. waste: Rina asks, Maya signs with her PIN; the movement is the approved quantity, once
select pg_temp.w('[{"op":"put","coll":"approvals","id":"w1","data":{"id":"w1","type":"waste","level":"pic","status":"waiting","requestedBy":"rina","outletId":"sen","amount":20000,"payload":{"stockItemId":"beans","qty":-2}}}]', 'rina');
select public.bn_check_approval_pin((select id from t), 'maya', '135790');
select pg_temp.expect($$ select pg_temp.w('[{"op":"put","coll":"approvals","id":"w1","data":{"id":"w1","type":"waste","level":"pic","status":"approved","requestedBy":"rina","decidedBy":"maya","outletId":"sen","amount":20000,"payload":{"stockItemId":"beans","qty":-2}}},
  {"op":"put","coll":"movements","id":"m4","data":{"outletId":"sen","stockItemId":"beans","qty":-200,"type":"waste","sourceId":"w1","by":"maya","at":1}}]', 'rina') $$, 'BN057');
select public.bn_check_approval_pin((select id from t), 'maya', '135790');
select pg_temp.w('[{"op":"put","coll":"approvals","id":"w1","data":{"id":"w1","type":"waste","level":"pic","status":"approved","requestedBy":"rina","decidedBy":"maya","outletId":"sen","amount":20000,"payload":{"stockItemId":"beans","qty":-2}}},
  {"op":"put","coll":"movements","id":"m4","data":{"outletId":"sen","stockItemId":"beans","qty":-2,"type":"waste","sourceId":"w1","by":"maya","at":1}}]', 'rina');
select pg_temp.expect($$ select pg_temp.w('[{"op":"put","coll":"movements","id":"m4#2","data":{"outletId":"sen","stockItemId":"beans","qty":-2,"type":"waste","sourceId":"w1","by":"maya","at":2}}]', 'rina') $$, 'BN057');

-- 3. opname: Maya counts blind and submits; the locked count can't change; Sari signs and the difference posts once
select pg_temp.w('[{"op":"put","coll":"opnames","id":"op1","data":{"id":"op1","outletId":"sen","area":"Bar","countedBy":"maya","status":"counting","lines":[{"stockItemId":"beans","systemQty":-2,"counted":null,"unitCost":1000},{"stockItemId":"milk","systemQty":0,"counted":null,"unitCost":500}]}}]', 'maya');
select pg_temp.w('[{"op":"put","coll":"opnames","id":"op1","data":{"id":"op1","outletId":"sen","area":"Bar","countedBy":"maya","status":"counting","lines":[{"stockItemId":"beans","systemQty":-2,"counted":12,"unitCost":1000},{"stockItemId":"milk","systemQty":0,"counted":null,"unitCost":500}]}}]', 'maya');
select pg_temp.w('[{"op":"put","coll":"opnames","id":"op1","data":{"id":"op1","outletId":"sen","area":"Bar","countedBy":"maya","status":"locked","lines":[{"stockItemId":"beans","systemQty":-2,"counted":12,"unitCost":1000,"locked":true}]}},
  {"op":"put","coll":"approvals","id":"a1","data":{"id":"a1","type":"opname","level":"pic","status":"waiting","requestedBy":"maya","countedBy":"maya","outletId":"sen","subjectId":"op1","amount":14000}}]', 'maya');
select pg_temp.expect($$ select pg_temp.w('[{"op":"put","coll":"opnames","id":"op1","data":{"id":"op1","outletId":"sen","area":"Bar","countedBy":"maya","status":"locked","lines":[{"stockItemId":"beans","systemQty":-2,"counted":400,"unitCost":1000,"locked":true}]}}]', 'maya') $$, 'BN058');
-- a photo after the lock is fine (differences only show then)
select pg_temp.w('[{"op":"put","coll":"opnames","id":"op1","data":{"id":"op1","outletId":"sen","area":"Bar","countedBy":"maya","status":"locked","lines":[{"stockItemId":"beans","systemQty":-2,"counted":12,"unitCost":1000,"locked":true,"photo":"data:image/jpeg;base64,AA"}]}}]', 'maya');
select public.bn_check_approval_pin((select id from t), 'sari', '975310');
select pg_temp.w('[{"op":"put","coll":"approvals","id":"a1","data":{"id":"a1","type":"opname","level":"pic","status":"approved","requestedBy":"maya","countedBy":"maya","decidedBy":"sari","outletId":"sen","subjectId":"op1","amount":14000}},
  {"op":"put","coll":"opnames","id":"op1","data":{"id":"op1","outletId":"sen","area":"Bar","countedBy":"maya","approvedBy":"sari","status":"posted","lines":[{"stockItemId":"beans","systemQty":-2,"counted":12,"unitCost":1000,"locked":true,"photo":"data:image/jpeg;base64,AA"}]}},
  {"op":"put","coll":"movements","id":"m5","data":{"outletId":"sen","stockItemId":"beans","qty":14,"type":"opname_adjustment","sourceId":"op1","by":"sari","at":3}}]', 'maya');
select pg_temp.expect($$ select pg_temp.w('[{"op":"put","coll":"movements","id":"m6","data":{"outletId":"sen","stockItemId":"milk","qty":-4,"type":"opname_adjustment","sourceId":"op1","by":"sari","at":3}}]', 'maya') $$, 'BN057');
select pg_temp.expect($$ select pg_temp.w('[{"op":"put","coll":"movements","id":"m7","data":{"outletId":"sen","stockItemId":"beans","qty":14,"type":"opname_adjustment","sourceId":"op1","by":"sari","at":4}}]', 'maya') $$, 'BN057');

-- a recount only when the approver asks for it: Maya can't reopen her own locked count
select pg_temp.w('[{"op":"put","coll":"opnames","id":"op2","data":{"id":"op2","outletId":"sen","area":"Gudang","countedBy":"maya","status":"locked","lines":[{"stockItemId":"milk","systemQty":4,"counted":1,"unitCost":500,"locked":true}]}},
  {"op":"put","coll":"approvals","id":"a2","data":{"id":"a2","type":"opname","level":"pic","status":"waiting","requestedBy":"maya","countedBy":"maya","outletId":"sen","subjectId":"op2","amount":1500}}]', 'maya');
select pg_temp.expect($$ select pg_temp.w('[{"op":"put","coll":"opnames","id":"op2","data":{"id":"op2","outletId":"sen","area":"Gudang","countedBy":"maya","status":"recount","lines":[{"stockItemId":"milk","systemQty":4,"counted":1,"unitCost":500,"locked":true}]}}]', 'maya') $$, 'BN058');
select public.bn_check_approval_pin((select id from t), 'sari', '975310');
select pg_temp.w('[{"op":"put","coll":"approvals","id":"a2","data":{"id":"a2","type":"opname","level":"pic","status":"recount","requestedBy":"maya","countedBy":"maya","decidedBy":"sari","outletId":"sen","subjectId":"op2","amount":1500}},
  {"op":"put","coll":"opnames","id":"op2","data":{"id":"op2","outletId":"sen","area":"Gudang","countedBy":"maya","status":"recount","lines":[{"stockItemId":"milk","systemQty":4,"counted":1,"unitCost":500,"locked":true}]}}]', 'maya');
select pg_temp.w('[{"op":"put","coll":"opnames","id":"op2","data":{"id":"op2","outletId":"sen","area":"Gudang","countedBy":"maya","status":"recount","lines":[{"stockItemId":"milk","systemQty":4,"counted":4,"recountOf":"1","unitCost":500,"locked":true}]}}]', 'maya');
select pg_temp.w('[{"op":"put","coll":"opnames","id":"op2","data":{"id":"op2","outletId":"sen","area":"Gudang","countedBy":"maya","status":"locked","lines":[{"stockItemId":"milk","systemQty":4,"counted":4,"recountOf":"1","unitCost":500,"locked":true}]}},
  {"op":"put","coll":"approvals","id":"a2","data":{"id":"a2","type":"opname","level":"pic","status":"waiting","requestedBy":"maya","countedBy":"maya","outletId":"sen","subjectId":"op2","amount":0}}]', 'maya');
-- sent back after a recount, the request keeps the level its variance needs (no cashier signs a big difference)
select public.bn_check_approval_pin((select id from t), 'sari', '975310');
select pg_temp.w('[{"op":"put","coll":"approvals","id":"a2","data":{"id":"a2","type":"opname","level":"pic","status":"recount","requestedBy":"maya","countedBy":"maya","decidedBy":"sari","outletId":"sen","subjectId":"op2","amount":2000}}]', 'maya');
select pg_temp.w('[{"op":"put","coll":"approvals","id":"a2","data":{"id":"a2","type":"opname","level":"cashier","status":"waiting","requestedBy":"maya","countedBy":"maya","outletId":"sen","subjectId":"op2","amount":900000}}]', 'maya');
reset role;
do $$ begin assert (select data->>'level' || ' ' || (data->>'amount') from public.docs where coll = 'approvals' and id = 'a2') = 'pic 2000', 'a resend asking a cashier with a made-up variance gets the server''s variance and the level it needs'; end $$;
set local role authenticated;

-- 4. goods come in against an approved PO only
select pg_temp.w('[{"op":"put","coll":"movements","id":"m8","data":{"outletId":"sen","stockItemId":"beans","qty":5,"type":"receipt","sourceId":"po1","by":"maya","at":5}},
  {"op":"put","coll":"pos","id":"po1","data":{"id":"po1","outletId":"sen","status":"received","lines":[{"stockItemId":"beans","qty":5,"received":5}]}}]', 'maya');
-- 5. the system qty is the server's, the moment the item is counted (20261024060000): a sale after the count started is not
--    counted twice, and a device can't make a shortage disappear by sending its own system qty
select pg_temp.w('[{"op":"put","coll":"opnames","id":"op3","data":{"id":"op3","outletId":"sen","area":"Bar","countedBy":"maya","status":"counting","lines":[{"stockItemId":"beans","systemQty":999,"counted":null,"unitCost":1000}]}}]', 'maya');
select pg_temp.w('[{"op":"put","coll":"movements","id":"s1","data":{"outletId":"sen","stockItemId":"beans","qty":-3,"type":"sale","sourceId":"o9","by":"rina","at":6}}]', 'maya');
select pg_temp.w('[{"op":"put","coll":"opnames","id":"op3","data":{"id":"op3","outletId":"sen","area":"Bar","countedBy":"maya","status":"counting","lines":[{"stockItemId":"beans","systemQty":10,"counted":10,"unitCost":1000}]}}]', 'maya');
select pg_temp.w('[{"op":"put","coll":"opnames","id":"op3","data":{"id":"op3","outletId":"sen","area":"Bar","countedBy":"maya","status":"counting","lines":[{"stockItemId":"beans","systemQty":10,"counted":10,"unitCost":1000,"photo":"x"}]}}]', 'maya');
-- the request's variance and level are the server's: the device claims none, beans are 4 short at the item's own cost
select pg_temp.w('[{"op":"put","coll":"stockItems","id":"beans","data":{"id":"beans","name":"Beans","unit":"kg","unitCost":1000}}]', 'maya');
select pg_temp.w('[{"op":"put","coll":"opnames","id":"op3","data":{"id":"op3","outletId":"sen","area":"Bar","countedBy":"maya","status":"locked","lines":[{"stockItemId":"beans","systemQty":10,"counted":10,"unitCost":0,"photo":"x","locked":true}]}},
  {"op":"put","coll":"approvals","id":"a3","data":{"id":"a3","type":"opname","level":"cashier","status":"waiting","requestedBy":"maya","countedBy":"maya","outletId":"sen","subjectId":"op3","amount":0}}]', 'maya');
-- a count created already locked, and a count made offline before a sale, still get the server's figure
select pg_temp.w('[{"op":"put","coll":"opnames","id":"op4","data":{"id":"op4","outletId":"sen","area":"Gudang","countedBy":"maya","status":"locked","at":1,"lines":[{"stockItemId":"beans","systemQty":10,"counted":10,"unitCost":1000,"locked":true}]}}]', 'maya');
select pg_temp.w('[{"op":"put","coll":"opnames","id":"op5","data":{"id":"op5","outletId":"sen","area":"Gudang","countedBy":"maya","status":"counting","at":5,"lines":[{"stockItemId":"beans","systemQty":0,"counted":17,"countedAt":5,"unitCost":1000}]}}]', 'maya');
reset role;
do $$ begin
  assert (select data->>'amount' || ' ' || (data->>'level') from public.docs where coll = 'approvals' and id = 'a3') = '4000 pic', 'variance and level from the server: ' || (select data::text from public.docs where coll = 'approvals' and id = 'a3');
  assert (select (data->'lines'->0->>'systemQty')::numeric from public.docs where coll = 'opnames' and id = 'op4') = 14, 'created locked: still the server''s level';
  assert (select (data->'lines'->0->>'systemQty')::numeric from public.docs where coll = 'opnames' and id = 'op5') = 17, 'counted offline before the sale at 6: the level then';
  assert (select (data->'lines'->0->>'systemQty')::numeric from public.docs where coll = 'opnames' and id = 'op3') = 14, 'system qty = the level when counted (17 - 3), not the device''s: '
    || (select data->'lines'->0->>'systemQty' from public.docs where coll = 'opnames' and id = 'op3');
  assert (select sum((data->>'qty')::numeric) from public.docs where coll = 'movements') = 14, 'waste -2, opname +14 (counted 12 on a level of -2), receipt +5, sale -3';
end $$;
select 'stock on the server holds' as result;
rollback;
