-- A guest paying at the cashier fires the order: the kitchen alert rides along; a lone or replayed alert is refused.
\set ON_ERROR_STOP 1
begin;
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000a1');
create function pg_temp.expect(sql text, code text) returns void language plpgsql as $$
begin execute sql; raise exception 'expected % but it passed: %', code, sql;
exception when others then if sqlerrm not like code || '%' then raise exception 'expected %, got: %', code, sqlerrm; end if; end $$;
grant execute on function pg_temp.expect(text, text) to anon;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
create temp table t as select public.bn_bootstrap('Warung Fire', 'warung-fire', 'sri') as id;
reset role; update public.tenants set plan = 'pro' where id = (select id from t); set local role authenticated; -- QR and kiosk orders are on Pro (BN087)
grant select on t to anon;
select public.bn_write((select id from t), '[
  {"op":"put","coll":"outlets","id":"o1","data":{"id":"o1","name":"Pusat","serviceBps":0,"taxBps":0,"taxInclusive":false}},
  {"op":"put","coll":"products","id":"p1","data":{"id":"p1","name":"Teh","basePrice":10000,"status":"live"}},
  {"op":"put","coll":"employees","id":"sri","data":{"id":"sri","name":"Sri","role":"owner"}}
]'::jsonb, 'setup', 'sri');
set local role anon;
-- the cart
select public.bn_guest_write((select id from t), '[{"op":"put","coll":"orders","id":"q1","data":{"id":"q1","source":"qr","status":"open","outletId":"o1","discountPct":0,"promoIds":[],"discount":0,"lines":[{"id":"l1","productId":"p1","name":"Teh","unitPrice":10000,"qty":1,"mods":[],"fired":false}],"subtotal":10000,"total":10000}}]'::jsonb);
-- a lone kitchen alert is not the guest's to send
select pg_temp.expect(format($$ select public.bn_guest_write(%L, '[{"op":"put","coll":"notices","id":"n0","data":{"id":"n0","alert":"New order","level":"info","to":["kitchen"],"text":"fake","href":"/kds"}}]') $$, (select id from t)), 'BN047');
-- pay at the cashier: the order goes to the kitchen with its alert, in one batch
select public.bn_guest_write((select id from t), '[{"op":"put","coll":"orders","id":"q1","data":{"id":"q1","source":"qr","status":"sent","outletId":"o1","discountPct":0,"promoIds":[],"discount":0,"lines":[{"id":"l1","productId":"p1","name":"Teh","unitPrice":10000,"qty":1,"mods":[],"fired":true,"kds":"new"}],"subtotal":10000,"total":10000}},
  {"op":"put","coll":"notices","id":"n1","data":{"id":"n1","alert":"New order","level":"info","to":["kitchen"],"text":"QR-1 · T-03 · 1 items","href":"/kds"}}]'::jsonb);
-- replaying the same fired order with another alert fires nothing new: refused
select pg_temp.expect(format($$ select public.bn_guest_write(%L, '[{"op":"put","coll":"orders","id":"q1","data":{"id":"q1","source":"qr","status":"sent","outletId":"o1","discountPct":0,"promoIds":[],"discount":0,"lines":[{"id":"l1","productId":"p1","name":"Teh","unitPrice":10000,"qty":1,"mods":[],"fired":true,"kds":"new"}],"subtotal":10000,"total":10000}},{"op":"put","coll":"notices","id":"n2","data":{"id":"n2","alert":"New order","level":"info","to":["kitchen"],"text":"spam","href":"/kds"}}]') $$, (select id from t)), 'BN047');
reset role;
do $$ begin
  assert (select count(*) from public.docs where coll = 'notices' and data->>'alert' = 'New order' and tenant_id = (select id from t)) = 1, 'exactly the one real kitchen alert';
  assert (select data->>'status' from public.docs where coll = 'orders' and id = 'q1' and tenant_id = (select id from t)) = 'sent', 'the order reached the kitchen';
end $$;
rollback;
select 'guest fire holds';
