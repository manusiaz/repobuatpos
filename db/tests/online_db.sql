-- Delivery-app (ojol) orders on the server: only the platform webhook (or the owner / manager trying the simulator)
-- makes one, a bill never becomes one, so their exceptions (paid by the platform, rejected without a void approval)
-- can't be borrowed; a cancel from the platform stops the order wherever it is; one payment per hand-over.
\set ON_ERROR_STOP 1
begin;
insert into private.secrets (name, value) values ('server', 'ojol-secret') on conflict (name) do update set value = excluded.value;
set local check_function_bodies = off; -- pg_temp.w reads t, made below
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000f1'), ('00000000-0000-0000-0000-0000000000f2');
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
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
create temp table t as select public.bn_bootstrap('Kopi Ojol', 'kopiojol', 'budi') as id;
grant select on t to authenticated;
select public.bn_write((select id from t), '[
  {"op":"put","coll":"outlets","id":"sen","data":{"id":"sen","name":"Senayan","serviceBps":0,"taxBps":0}},
  {"op":"put","coll":"employees","id":"budi","data":{"id":"budi","name":"Budi","role":"owner"}},
  {"op":"put","coll":"employees","id":"maya","data":{"id":"maya","name":"Maya","role":"pic","outlets":["sen"]}},
  {"op":"put","coll":"employees","id":"sari","data":{"id":"sari","name":"Sari","role":"pic","outlets":["sen"]}},
  {"op":"put","coll":"employees","id":"rina","data":{"id":"rina","name":"Rina","role":"cashier","outlets":["sen"]}},
  {"op":"put","coll":"products","id":"p1","data":{"id":"p1","name":"Es Kopi Susu","sku":"LATTE-ICE","basePrice":30000,"status":"live"}},
  {"op":"put","coll":"orders","id":"o1","data":{"id":"o1","no":"#1","source":"pos","type":"dine","status":"open","outletId":"sen","lines":[{"id":"l1","productId":"p1","qty":1,"unitPrice":30000}],"subtotal":30000,"discount":0,"total":30000}}
]'::jsonb, 'setup', 'budi');
select public.bn_set_pins((select id from t), 'rina', '1234', null);
select public.bn_set_pins((select id from t), 'maya', '5678', '135790');
select public.bn_set_pins((select id from t), 'sari', '4321', '975310');
insert into v select 'code', public.bn_device_code((select id from t));
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2'); -- the shared register
select public.bn_device_join((select v from v where k = 'code'));
insert into v select k, public.bn_staff_login((select id from t), k, p)->>'token' from (values ('rina', '1234'), ('maya', '5678'), ('sari', '4321')) x(k, p);



-- 1. a dine-in bill relabelled as GoFood: paid "by the platform" with no money, or voided with no approval
select pg_temp.expect($$ select pg_temp.w('[{"op":"put","coll":"orders","id":"o1","data":{"id":"o1","no":"#1","source":"gofood","type":"dine","status":"open","outletId":"sen","lines":[{"id":"l1","productId":"p1","qty":1,"unitPrice":30000}],"subtotal":30000,"discount":0,"total":30000}},
  {"op":"put","coll":"payments","id":"pay1","data":{"id":"pay1","orderId":"o1","outletId":"sen","method":"qris","amount":30000,"tip":0,"status":"settled","ref":"GOFOOD","at":1}}]', 'rina') $$, 'BN062');
select pg_temp.expect($$ select pg_temp.w('[{"op":"put","coll":"orders","id":"o1","data":{"id":"o1","no":"#1","source":"gofood","type":"dine","status":"voided","outletId":"sen","lines":[{"id":"l1","productId":"p1","qty":1,"unitPrice":30000}],"subtotal":30000,"discount":0,"total":30000}}]', 'rina') $$, 'BN062');
-- 2. or voided with its items emptied in the same write
select pg_temp.expect($$ select pg_temp.w('[{"op":"put","coll":"orders","id":"o1","data":{"id":"o1","no":"#1","source":"pos","type":"dine","status":"voided","outletId":"sen","lines":[],"subtotal":0,"discount":0,"total":0}}]', 'rina') $$, 'BN056');
-- 3. a cashier can't make platform orders (fake revenue the platform never paid)
select pg_temp.expect($$ select pg_temp.w('[{"op":"put","coll":"orders","id":"gofood-x","data":{"id":"gofood-x","no":"#9","source":"gofood","type":"delivery","status":"open","outletId":"sen","lines":[{"id":"l1","productId":"p1","qty":1,"unitPrice":30000}],"subtotal":30000,"discount":0,"total":30000}}]', 'rina') $$, 'BN062');

-- 4. the platform sends an order (its item by SKU): Rina accepts it, hands it over once
reset role;
select public.bn_platform_order('ojol-secret', (select id from t), '{"id":"gofood-A1","source":"gofood","type":"delivery","status":"open","outletId":"sen","lines":[{"id":"l1","productId":"gf-889","sku":"LATTE-ICE","name":"Latte","qty":1,"unitPrice":30000}],"subtotal":30000,"discount":0,"total":30000,"createdAt":1}'::jsonb);
do $$ begin assert (select data->'lines'->0->>'productId' from public.docs where coll = 'orders' and id = 'gofood-A1') = 'p1', 'mapped by SKU'; end $$;
set local role authenticated;
select pg_temp.w('[{"op":"put","coll":"orders","id":"gofood-A1","data":{"id":"gofood-A1","no":"#2002","source":"gofood","type":"delivery","status":"ready","outletId":"sen","lines":[{"id":"l1","productId":"p1","qty":1,"unitPrice":30000,"fired":true}],"subtotal":30000,"discount":0,"total":30000}}]', 'rina');
select pg_temp.w('[{"op":"put","coll":"payments","id":"pay2","data":{"id":"pay2","orderId":"gofood-A1","outletId":"sen","method":"ewallet","amount":30000,"tip":0,"status":"settled","ref":"GOFOOD","at":2}}]', 'rina');
select pg_temp.expect($$ select pg_temp.w('[{"op":"put","coll":"payments","id":"pay3","data":{"id":"pay3","orderId":"gofood-A1","outletId":"sen","method":"ewallet","amount":30000,"tip":0,"status":"settled","ref":"GOFOOD","at":3}}]', 'rina') $$, 'BN062');
-- 5. a picked-up platform order is not voided by a cashier (the exception is for rejecting a new one)
select pg_temp.expect($$ select pg_temp.w('[{"op":"put","coll":"orders","id":"gofood-A1","data":{"id":"gofood-A1","no":"#2002","source":"gofood","type":"delivery","status":"voided","outletId":"sen","lines":[{"id":"l1","productId":"p1","qty":1,"unitPrice":30000,"fired":true}],"subtotal":30000,"discount":0,"total":30000}}]', 'rina') $$, 'BN056');
-- 6. a new one is rejected without a void approval
reset role;
select public.bn_platform_order('ojol-secret', (select id from t), '{"id":"gofood-A2","source":"gofood","type":"delivery","status":"open","outletId":"sen","lines":[{"id":"l1","productId":"p1","qty":1,"unitPrice":30000}],"subtotal":30000,"discount":0,"total":30000,"createdAt":1}'::jsonb);
select public.bn_platform_order('ojol-secret', (select id from t), '{"id":"gofood-A3","source":"gofood","type":"delivery","status":"open","outletId":"sen","lines":[{"id":"l1","productId":"p1","qty":1,"unitPrice":30000}],"subtotal":30000,"discount":0,"total":30000,"createdAt":1}'::jsonb);
set local role authenticated;
select pg_temp.w('[{"op":"put","coll":"orders","id":"gofood-A2","data":{"id":"gofood-A2","no":"#2003","source":"gofood","type":"delivery","status":"voided","outletId":"sen","lines":[{"id":"l1","productId":"p1","qty":1,"unitPrice":30000}],"subtotal":30000,"discount":0,"total":30000,"note":"Rejected: busy"}}]', 'rina');
-- 7. the guest cancels on GoFood after Rina accepted: the kitchen stops
select pg_temp.w('[{"op":"put","coll":"orders","id":"gofood-A3","data":{"id":"gofood-A3","no":"#2004","source":"gofood","type":"delivery","status":"sent","outletId":"sen","lines":[{"id":"l1","productId":"p1","qty":1,"unitPrice":30000,"fired":true}],"subtotal":30000,"discount":0,"total":30000}}]', 'rina');
reset role;
select public.bn_platform_order('ojol-secret', (select id from t), '{"id":"gofood-A3","source":"gofood","status":"voided","note":"Cancelled by platform"}'::jsonb);
do $$ begin assert (select data->>'status' from public.docs where coll = 'orders' and id = 'gofood-A3') = 'voided', 'cancel after accept stops the order'; end $$;
-- a paid one stays paid (the platform settles that itself)
select public.bn_platform_order('ojol-secret', (select id from t), '{"id":"gofood-A1","source":"gofood","status":"voided"}'::jsonb);
do $$ begin assert (select data->>'status' from public.docs where coll = 'orders' and id = 'gofood-A1') = 'ready', 'a handed-over order is not reopened'; end $$;
select 'online orders on the server hold' as result;
rollback;
