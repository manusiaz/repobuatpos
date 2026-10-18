-- Behaviour tests for the BorNiz PostgreSQL backend. Run on a scratch Postgres after db/platform.sql + the migrations:
--   npm run test:db (db/tests/run.sh: platform.sql + every migration + core.sql + server.sql on a fresh database)
-- Every block raises if a rule does not hold. Runs inside a transaction and rolls back.
\set ON_ERROR_STOP 1
begin;
insert into auth.users values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b');
insert into private.secrets values ('server', 'test-secret');
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create function pg_temp.expect(sql text, code text) returns void language plpgsql as $$
begin execute sql; raise exception 'expected % but it passed: %', code, sql;
exception when others then if sqlerrm not like code || '%' then raise exception 'expected %, got: %', code, sqlerrm; end if; end $$;
grant execute on function pg_temp.expect(text, text), pg_temp.as_user(text) to authenticated, anon;

-- Owner A signs up and creates the business
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
create temp table t as select public.bn_bootstrap('Kopi Biru', 'kopibiru', 'budi') as id;
grant select on t to anon, authenticated;
select public.bn_write((select id from t), '[
  {"op":"put","coll":"employees","id":"budi","data":{"id":"budi","name":"Budi","role":"owner","pin":"1234","approvalPin":"246810"}},
  {"op":"put","coll":"employees","id":"andi","data":{"id":"andi","name":"Andi","role":"manager"}},
  {"op":"put","coll":"employees","id":"maya","data":{"id":"maya","name":"Maya","role":"pic"}},
  {"op":"put","coll":"employees","id":"tono","data":{"id":"tono","name":"Tono","role":"cashier"}},
  {"op":"put","coll":"outlets","id":"sen","data":{"id":"sen","name":"Senayan","serviceBps":500,"taxBps":1000}},
  {"op":"put","coll":"modifierGroups","id":"size","data":{"id":"size","name":"Size","options":[{"id":"l","name":"Large","price":5000}]}},
  {"op":"put","coll":"products","id":"p1","data":{"id":"p1","name":"Es Kopi Susu Aren","basePrice":25000,"status":"live","modifierGroupIds":["size"]}},
  {"op":"put","coll":"outletProducts","id":"p1|sen","data":{"productId":"p1","outletId":"sen","localPrice":null}}
]'::jsonb, 'setup', 'budi');
do $$ begin assert (select data ? 'pin' or data ? 'approvalPin' from public.docs where coll = 'employees' and id = 'budi') = false, 'PINs must never be stored in documents'; end $$;
select public.bn_set_pins((select id from t), e, '1234', '246810') from unnest(array['budi','andi','maya','tono']) e;

-- Login PIN
do $$ begin assert public.bn_check_login_pin((select id from t), 'tono', '1234') is null; assert public.bn_check_login_pin((select id from t), 'tono', '9999') = 'Wrong PIN.'; end $$;

-- Approval ladder on the server
select public.bn_write((select id from t), '[{"op":"put","coll":"approvals","id":"ap1","data":{"id":"ap1","type":"refund","title":"Refund #2033","amount":620000,"level":"owner","status":"waiting","requestedBy":"tono"}}]', 'approval.requested', 'tono');
select pg_temp.expect($$ select public.bn_write((select id from t), '[{"op":"put","coll":"approvals","id":"ap1","data":{"id":"ap1","level":"owner","status":"approved","requestedBy":"tono","decidedBy":"andi"}}]', 'x', 'andi') $$, 'BN008');
do $$ begin assert public.bn_check_approval_pin((select id from t), 'andi', '246810') is null; end $$;
select pg_temp.expect($$ select public.bn_write((select id from t), '[{"op":"put","coll":"approvals","id":"ap1","data":{"id":"ap1","level":"owner","status":"approved","requestedBy":"tono","decidedBy":"andi"}}]', 'x', 'andi') $$, 'BN009');
select pg_temp.expect($$ select public.bn_write((select id from t), '[{"op":"put","coll":"approvals","id":"ap1","data":{"id":"ap1","level":"owner","status":"approved","requestedBy":"tono","decidedBy":"tono"}}]', 'x', 'tono') $$, 'BN007');
do $$ begin assert public.bn_check_approval_pin((select id from t), 'budi', '000000') like 'Wrong PIN. 4 tries left.'; end $$;
select pg_temp.expect($$ select public.bn_write((select id from t), '[{"op":"put","coll":"approvals","id":"ap1","data":{"id":"ap1","level":"owner","status":"approved","requestedBy":"tono","decidedBy":"budi"}}]', 'x', 'budi') $$, 'BN008');
do $$ begin assert public.bn_check_approval_pin((select id from t), 'budi', '246810') is null; end $$;
select public.bn_write((select id from t), '[{"op":"put","coll":"approvals","id":"ap1","data":{"id":"ap1","level":"owner","status":"approved","requestedBy":"tono","decidedBy":"budi"}}]', 'approval.approved', 'budi');
select pg_temp.expect($$ select public.bn_write((select id from t), '[{"op":"put","coll":"approvals","id":"ap1","data":{"id":"ap1","level":"owner","status":"rejected","requestedBy":"tono","decidedBy":"budi"}}]', 'x', 'budi') $$, 'BN006');
select pg_temp.expect($$ select public.bn_write((select id from t), '[{"op":"put","coll":"approvals","id":"ap2","data":{"id":"ap2","level":"pic","status":"approved","requestedBy":"tono","decidedBy":"maya"}}]', 'x', 'tono') $$, 'BN005');
-- 5 wrong approval PINs lock it and alert manager + owner
do $$ declare i int; begin for i in 1..5 loop perform public.bn_check_approval_pin((select id from t), 'maya', '111111'); end loop;
  assert public.bn_check_approval_pin((select id from t), 'maya', '246810') like 'Approval PIN locked%';
  assert exists (select 1 from public.docs where coll = 'notices' and data->>'alert' = 'Approval PIN locked'); end $$;

-- Money: gateway payments settle only by webhook; records are never deleted; append-only ledgers
select pg_temp.expect($$ select public.bn_write((select id from t), '[{"op":"put","coll":"payments","id":"pay1","data":{"id":"pay1","orderId":"o1","method":"qris","amount":69300,"status":"settled"}}]', 'x', 'tono') $$, 'BN004');
select public.bn_write((select id from t), '[{"op":"put","coll":"payments","id":"pay1","data":{"id":"pay1","orderId":"o1","method":"qris","amount":69300,"status":"pending"}},{"op":"put","coll":"payments","id":"pay2","data":{"id":"pay2","orderId":"o1","method":"cash","amount":1000,"status":"settled"}}]', 'payment.created', 'tono');
select pg_temp.expect($$ select public.bn_write((select id from t), '[{"op":"del","coll":"payments","id":"pay2"}]', 'x', 'tono') $$, 'BN001');
select public.bn_write((select id from t), '[{"op":"put","coll":"movements","id":"sale:o1:milk","data":{"qty":-0.3}},{"op":"put","coll":"ledger","id":"c1:welcome","data":{"customerId":"c1","points":50}}]', 'order.paid', 'tono');
select pg_temp.expect($$ select public.bn_write((select id from t), '[{"op":"put","coll":"movements","id":"sale:o1:milk","data":{"qty":-9}}]', 'x', 'tono') $$, 'BN002');
select pg_temp.expect($$ select public.bn_write((select id from t), '[{"op":"put","coll":"ledger","id":"c1:redeem","data":{"customerId":"c1","points":-80}}]', 'x', 'tono') $$, 'BN003');
select pg_temp.expect($$ update public.audit_log set action = 'x' $$, 'permission denied'); -- app users never write the audit log directly

-- Gateway webhook (shared secret), idempotent
reset role; set local role anon;
select pg_temp.expect($$ select public.bn_gateway_update('wrong', (select id from t), 'pay1', 'settled', 'simulator') $$, 'BN016');
do $$ begin assert (public.bn_gateway_update('test-secret', (select id from t), 'pay1', 'settled', 'simulator'))->>'status' = 'settled';
  assert (public.bn_gateway_update('test-secret', (select id from t), 'pay1', 'failed', 'simulator'))->>'status' = 'settled', 'retries must not change a settled payment'; end $$;

-- Guests: catalog by slug, orders re-priced on the server
do $$ begin assert jsonb_array_length(public.bn_public_snapshot('kopibiru')->'docs') = 4; end $$; -- outlet, modifier group, product, tenant meta
select pg_temp.expect($$ select public.bn_guest_write((select id from t), '[{"op":"put","coll":"orders","id":"g1","data":{"id":"g1","source":"qr","status":"open","outletId":"sen","discountPct":0,"subtotal":1000,"total":1000,"lines":[{"productId":"p1","name":"Es Kopi","qty":1,"unitPrice":1000,"mods":[]}]}}]') $$, 'BN023');
select public.bn_guest_write((select id from t), '[{"op":"put","coll":"orders","id":"g1","data":{"id":"g1","source":"qr","status":"open","outletId":"sen","discountPct":0,"subtotal":30000,"total":34650,"lines":[{"productId":"p1","name":"Es Kopi","qty":1,"unitPrice":25000,"mods":[{"name":"Large","price":5000}]}]}}]');
select pg_temp.expect($$ select public.bn_guest_write((select id from t), '[{"op":"put","coll":"payments","id":"gp","data":{"id":"gp","orderId":"g1","method":"qris","amount":100,"status":"pending"}}]') $$, 'BN028');
select pg_temp.expect($$ select public.bn_guest_write((select id from t), '[{"op":"put","coll":"products","id":"p1","data":{"basePrice":1}}]') $$, 'BN031');
select pg_temp.expect($$ select * from public.docs $$, 'permission denied');

-- Another business sees nothing of Kopi Biru
reset role; set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ begin assert (select count(*) from public.docs) = 0, 'tenant isolation'; end $$;
select pg_temp.expect($$ select public.bn_write((select id from t), '[{"op":"put","coll":"products","id":"x","data":{}}]', 'x', 'x') $$, 'BN011');
select pg_temp.expect($$ select public.bn_check_approval_pin((select id from t), 'budi', '246810') is null and false $$, 'expected');

-- Order numbers: blocks never overlap
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ declare a bigint; b bigint; begin a := public.bn_reserve((select id from t), 'order:sen', 100); b := public.bn_reserve((select id from t), 'order:sen', 100); assert b = a + 100; end $$;
reset role;
select pg_temp.expect($$ update public.audit_log set action = 'x' $$, 'BN002'); -- even the database owner can't edit history
select 'all backend rules hold' as result;
rollback;
