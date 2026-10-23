-- Pen-test exploits (20261015000000_borniz_hardening.sql): every one is refused, the honest path still works.
\set ON_ERROR_STOP 1
begin;
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000f1'), ('00000000-0000-0000-0000-0000000000f2'), ('00000000-0000-0000-0000-0000000000f3');
create function pg_temp.expect(sql text, code text) returns void language plpgsql as $$
begin execute sql; raise exception 'expected % but it passed: %', code, sql;
exception when others then if sqlerrm not like code || '%' then raise exception 'expected %, got: %', code, sqlerrm; end if; end $$;
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
grant execute on function pg_temp.expect(text, text), pg_temp.as_user(text) to anon, authenticated;

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
create temp table t as select public.bn_bootstrap('Kopi Aman', 'kopiaman', 'budi') as id;
reset role; update public.tenants set plan = 'pro' where id = (select id from t); set local role authenticated; -- QR and kiosk orders are on Pro (BN087)
grant select on t to anon, authenticated;
select public.bn_write((select id from t), '[
  {"op":"put","coll":"outlets","id":"sen","data":{"id":"sen","name":"Senayan","serviceBps":500,"taxBps":1000,"taxInclusive":false}},
  {"op":"put","coll":"modifierGroups","id":"size","data":{"id":"size","name":"Size","options":[{"id":"l","name":"Large","price":5000}]}},
  {"op":"put","coll":"products","id":"p1","data":{"id":"p1","name":"Kopi","basePrice":25000,"status":"live","modifierGroupIds":["size"]}},
  {"op":"put","coll":"promos","id":"pr1","data":{"id":"pr1","name":"10%","kind":"pct","value":10}},
  {"op":"put","coll":"employees","id":"budi","data":{"id":"budi","name":"Budi","role":"owner"}},
  {"op":"put","coll":"employees","id":"andi","data":{"id":"andi","name":"Andi","role":"manager"}},
  {"op":"put","coll":"employees","id":"maya","data":{"id":"maya","name":"Maya","role":"pic"}},
  {"op":"put","coll":"employees","id":"rina","data":{"id":"rina","name":"Rina","role":"cashier"}},
  {"op":"put","coll":"orders","id":"o-pos","data":{"id":"o-pos","source":"pos","status":"open","outletId":"sen","total":57750}},
  {"op":"put","coll":"payments","id":"pay-cash","data":{"id":"pay-cash","orderId":"o-pos","method":"cash","amount":57750,"status":"settled"}}
]'::jsonb, 'setup', 'budi');
select public.bn_set_pins((select id from t), 'andi', '1111', '135790');
select public.bn_set_pins((select id from t), 'budi', '2222', '246810');
reset role;
insert into public.members (tenant_id, user_id, employee_id, role) select id, '00000000-0000-0000-0000-0000000000f2', 'andi', 'manager' from t;

-- ── guests (anon) ─────────────────────────────────────────────────────────────────────────
set local role anon;
create temp table ord (k text, o jsonb);
reset role;
insert into ord values ('ok', '{"id":"g1","source":"qr","status":"open","outletId":"sen","discountPct":0,"promoIds":[],"discount":0,
  "lines":[{"productId":"p1","name":"Kopi","unitPrice":25000,"qty":2,"mods":[]}],"subtotal":50000,"total":57750}');
grant select on ord to anon;
set local role anon;
select public.bn_guest_write((select id from t), jsonb_build_array(jsonb_build_object('op','put','coll','orders','id','g1','data',(select o from ord))));
select pg_temp.expect(format($$ select public.bn_guest_write(%L, %L) $$, (select id from t), jsonb_build_array(jsonb_build_object('op','put','coll','orders','id','g1','data',(select o || '{"total":1500}' from ord)))), 'BN036');
select pg_temp.expect(format($$ select public.bn_guest_write(%L, %L) $$, (select id from t), jsonb_build_array(jsonb_build_object('op','put','coll','orders','id','g1','data',
  (select jsonb_set(o, '{lines,0,mods}', '[{"name":"Large","price":-20000}]') || '{"subtotal":10000}' from ord)))), 'BN034');
select pg_temp.expect(format($$ select public.bn_guest_write(%L, %L) $$, (select id from t), jsonb_build_array(jsonb_build_object('op','put','coll','orders','id','g1','data',
  (select jsonb_set(o, '{lines,0,qty}', '-1') || '{"subtotal":-25000}' from ord)))), 'BN033');
select pg_temp.expect(format($$ select public.bn_guest_write(%L, %L) $$, (select id from t), jsonb_build_array(jsonb_build_object('op','put','coll','orders','id','g1','data',
  (select o || '{"promoIds":["pr1"],"discount":20000,"total":34650}' from ord)))), 'BN035');
-- an honest 10% voucher: 50000 − 5000 → 45000 + 2250 service + 4725 tax
select public.bn_guest_write((select id from t), jsonb_build_array(jsonb_build_object('op','put','coll','orders','id','g1','data',(select o || '{"promoIds":["pr1"],"discount":5000,"total":51975}' from ord))));
select pg_temp.expect(format($$ select public.bn_guest_write(%L, %L) $$, (select id from t), '[{"op":"put","coll":"payments","id":"gp1","data":{"id":"gp1","orderId":"g1","method":"qris","amount":51975,"tip":-50000,"status":"pending"}}]'), 'BN038');
select public.bn_guest_write((select id from t), '[{"op":"put","coll":"payments","id":"pay-cash","data":{"id":"pay-cash","orderId":"g1","method":"qris","amount":51975,"status":"pending"}}]');
select pg_temp.expect(format($$ select public.bn_guest_write(%L, %L) $$, (select id from t), '[{"op":"put","coll":"orders","id":"o-pos","data":{"id":"o-pos","source":"qr","status":"open","outletId":"sen","discountPct":0,"lines":[],"subtotal":0,"discount":0,"total":0}}]'), 'BN021');
select pg_temp.expect(format($$ select public.bn_guest_write(%L, %L) $$, (select id from t), '[{"op":"put","coll":"customers","id":"c9","data":{"id":"c9","name":"X","phone":"1","deposit":5000000}}]'), 'BN039');
select public.bn_guest_write((select id from t), '[{"op":"put","coll":"ledger","id":"l1","data":{"customerId":"c1","points":50,"reason":"Welcome beans"}},
  {"op":"put","coll":"customers","id":"c1","data":{"id":"c1","name":"Dewi","phone":"0812","email":"","credit":0,"deposit":0,"optIn":true}}]');
select pg_temp.expect(format($$ select public.bn_guest_write(%L, %L) $$, (select id from t), '[{"op":"put","coll":"ledger","id":"l2","data":{"customerId":"c1","points":50,"reason":"Welcome beans"}}]'), 'BN030');
select pg_temp.expect(format($$ select public.bn_guest_write(%L, %L) $$, (select id from t), '[{"op":"put","coll":"notices","id":"n1","data":{"id":"n1","alert":"Approval PIN locked","level":"high","to":["owner"],"text":"Re-enter your PIN","href":"https://evil.example"}}]'), 'BN047');
select public.bn_guest_write((select id from t), '[{"op":"put","coll":"notices","id":"n2","data":{"id":"n2","alert":"Guest call","level":"info","to":["waiter","pic"],"outletId":"sen","text":"T4 · Call waiter","href":"/waiter"}}]');
reset role;
do $$ begin
  assert (select data->>'status' from public.docs where coll = 'payments' and id = 'pay-cash') = 'settled', 'a guest cannot overwrite a staff payment';
  assert (select data->>'source' from public.docs where coll = 'orders' and id = 'o-pos') = 'pos', 'a guest cannot take over a staff order';
end $$;

-- ── staff accounts ───────────────────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2'); -- andi, manager
select pg_temp.expect($$ select public.bn_write((select id from t), '[{"op":"put","coll":"employees","id":"maya","data":{"id":"maya","name":"Maya","role":"owner"}}]', 'x', 'andi') $$, 'BN052');
select pg_temp.expect($$ select public.bn_write((select id from t), '[{"op":"del","coll":"employees","id":"budi"}]', 'x', 'andi') $$, 'BN052');
select public.bn_write((select id from t), '[{"op":"put","coll":"employees","id":"wulan","data":{"id":"wulan","name":"Wulan","role":"cashier"}}]', 'x', 'andi');
select pg_temp.expect($$ select public.bn_set_pins((select id from t), 'budi', null, '000000') $$, 'BN013');
select public.bn_set_pins((select id from t), 'rina', '4321', null);
-- forged approval: a self-approved cashier request re-labelled as owner-approved
select public.bn_write((select id from t), '[{"op":"put","coll":"approvals","id":"a1","data":{"id":"a1","type":"discount","pct":5,"level":"cashier","status":"approved","requestedBy":"rina","decidedBy":"rina","amount":5000}}]', 'x', 'rina');
select pg_temp.expect($$ select public.bn_write((select id from t), '[{"op":"put","coll":"approvals","id":"a1","data":{"id":"a1","type":"discount","pct":5,"level":"owner","status":"approved","requestedBy":"rina","decidedBy":"budi","amount":5000000}}]', 'x', 'rina') $$, 'BN048');
select public.bn_write((select id from t), '[{"op":"put","coll":"approvals","id":"a1","data":{"id":"a1","type":"discount","pct":5,"level":"cashier","status":"approved","requestedBy":"rina","decidedBy":"rina","amount":5000,"payload":{"applied":true}}}]', 'x', 'rina');
-- the approval PIN proof belongs to the account that typed it, and is used once
select public.bn_write((select id from t), '[{"op":"put","coll":"approvals","id":"a2","data":{"id":"a2","type":"refund","level":"manager","status":"waiting","requestedBy":"rina","amount":90000}},
  {"op":"put","coll":"approvals","id":"a3","data":{"id":"a3","type":"refund","level":"manager","status":"waiting","requestedBy":"rina","amount":90000}}]', 'x', 'rina');
select public.bn_check_approval_pin((select id from t), 'andi', '135790');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1'); -- budi's device uses andi's fresh PIN entry
select pg_temp.expect($$ select public.bn_write((select id from t), '[{"op":"put","coll":"approvals","id":"a2","data":{"id":"a2","type":"refund","level":"manager","status":"approved","requestedBy":"rina","decidedBy":"andi","amount":90000}}]', 'x', 'andi') $$, 'BN008');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select public.bn_write((select id from t), '[{"op":"put","coll":"approvals","id":"a2","data":{"id":"a2","type":"refund","level":"manager","status":"approved","requestedBy":"rina","decidedBy":"andi","amount":90000}}]', 'x', 'andi');
select pg_temp.expect($$ select public.bn_write((select id from t), '[{"op":"put","coll":"approvals","id":"a3","data":{"id":"a3","type":"refund","level":"manager","status":"approved","requestedBy":"rina","decidedBy":"andi","amount":90000}}]', 'x', 'andi') $$, 'BN008');
-- QRIS "settled" by a delivery reference on a counter order
select public.bn_write((select id from t), '[{"op":"put","coll":"payments","id":"pq","data":{"id":"pq","orderId":"o-pos","method":"qris","amount":57750,"status":"pending"}}]', 'x', 'rina');
select pg_temp.expect($$ select public.bn_write((select id from t), '[{"op":"put","coll":"payments","id":"pq","data":{"id":"pq","orderId":"o-pos","method":"qris","amount":57750,"status":"settled","ref":"GOFOOD-x"}}]', 'x', 'rina') $$, 'BN004');
select public.bn_write((select id from t), '[{"op":"put","coll":"orders","id":"gf1","data":{"id":"gf1","source":"gofood","status":"open","outletId":"sen","total":40000}},
  {"op":"put","coll":"payments","id":"pgf","data":{"id":"pgf","orderId":"gf1","method":"ewallet","amount":40000,"status":"settled","ref":"GOFOOD"}}]', 'x', 'rina');
select pg_temp.expect($$ select public.bn_reserve((select id from t), 'order', -5) $$, 'BN049');
-- attendance: a serial belongs to the first business that connects it
select public.bn_write((select id from t), '[{"op":"put","coll":"integrations","id":"zk1","data":{"id":"zk1","connector":"attendance-zkteco","outletId":"sen","enabled":true,"config":{"serial":"SN-ONE"}}}]', 'x', 'andi');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f3');
create temp table t2 as select public.bn_bootstrap('Kopi Lain', 'kopilain', 'owner2') as id;
select pg_temp.expect($$ select public.bn_write((select id from t2), '[{"op":"put","coll":"integrations","id":"zk9","data":{"id":"zk9","connector":"attendance-zkteco","outletId":"x","enabled":true,"config":{"serial":"SN-ONE"}}}]', 'x', 'owner2') $$, 'BN064');
-- no direct writes around bn_write (no audit row) and no forged audit rows
select pg_temp.expect($$ update public.docs set data = data || '{"basePrice":1}' where coll = 'products' $$, 'permission denied');
select pg_temp.expect($$ insert into public.audit_log (tenant_id, actor, action) select id, 'budi', 'approval.decided' from t $$, 'permission denied');
reset role;
do $$ begin
  assert public.bn_guest_order((select id from t), 'gf1') is null, 'delivery-app orders are not readable by id';
  assert not private.server_secret_ok('test-secret') or exists (select 1 from private.secrets where name = 'server' and value = 'test-secret'), 'only the server secret';
  assert (select approval_fails from private.staff_secrets where employee_id = 'budi') = 0, 'pins intact';
  assert (select data->>'status' from public.docs where coll = 'approvals' and id = 'a2') = 'approved', 'the honest decision went through';
end $$;
select 'pen-test fixes hold' as result;
rollback;
