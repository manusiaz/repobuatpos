-- Server RPCs (db/migrations/20261011010000_borniz_server.sql): idempotent writes, preconditions, secrets, server writes, starter import, guest snapshot.
\set ON_ERROR_STOP 1
begin;
insert into auth.users values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b'), ('00000000-0000-0000-0000-00000000000c');
insert into private.secrets values ('server', 'server-secret-for-tests'), ('secrets_key', 'key-for-tests');
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create function pg_temp.expect(sql text, code text) returns void language plpgsql as $$
begin execute sql; raise exception 'expected % but it passed: %', code, sql;
exception when others then if sqlerrm not like code || '%' then raise exception 'expected %, got: %', code, sqlerrm; end if; end $$;
grant execute on function pg_temp.expect(text, text), pg_temp.as_user(text) to authenticated, anon;

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
create temp table t as select public.bn_bootstrap('Kopi Biru', 'kopibiru', 'budi') as id;
grant select on t to anon, authenticated;

-- Starter dataset: gateway-settled history is allowed only in the import of a new business
select public.bn_import((select id from t), '[
  {"op":"put","coll":"employees","id":"budi","data":{"id":"budi","name":"Budi","role":"owner","hasPin":true}},
  {"op":"put","coll":"employees","id":"tono","data":{"id":"tono","name":"Tono","role":"cashier"}},
  {"op":"put","coll":"outlets","id":"sen","data":{"id":"sen","name":"Senayan"}},
  {"op":"put","coll":"products","id":"p1","data":{"id":"p1","name":"Es Kopi Susu Aren","basePrice":25000,"status":"live","cost":8000}},
  {"op":"put","coll":"products","id":"p2","data":{"id":"p2","name":"Draft","basePrice":1,"status":"pending_owner"}},
  {"op":"put","coll":"recipes","id":"p1|milk","data":{"productId":"p1","stockItemId":"milk","qty":0.15}},
  {"op":"put","coll":"movements","id":"m-open","data":{"outletId":"sen","stockItemId":"milk","qty":0.5},"t":1},
  {"op":"put","coll":"payments","id":"hp1","data":{"id":"hp1","orderId":"h1","method":"qris","amount":25000,"status":"settled"},"t":1},
  {"op":"put","coll":"_meta","id":"order","data":{"products":["p1","p2"]}}
]');
select public.bn_write((select id from t), '[]', 'setup.done', 'budi');
select pg_temp.expect($$ select public.bn_import((select id from t), '[{"op":"put","coll":"payments","id":"x","data":{"method":"qris","status":"settled"}}]') $$, 'BN045');
select pg_temp.expect($$ select public.bn_write((select id from t), '[{"op":"put","coll":"payments","id":"x","data":{"method":"qris","status":"settled"}}]', 'x', 'budi') $$, 'BN004');

-- Idempotent op ids: a retried commit applies once and writes one audit row
do $$ begin
  assert public.bn_write((select id from t), '[{"op":"put","coll":"customers","id":"c1","data":{"id":"c1","name":"Dewi"}}]', 'customer.created', 'budi', 'Dewi', null, 'op-1') = 1;
  assert public.bn_write((select id from t), '[{"op":"put","coll":"customers","id":"c1","data":{"id":"c1","name":"Changed"}}]', 'customer.created', 'budi', 'Dewi', null, 'op-1') = 0;
  assert (select data->>'name' from public.docs where coll = 'customers' and id = 'c1') = 'Dewi';
  assert (select count(*) from public.audit_log where action = 'customer.created') = 1;
end $$;

-- Preconditions: the settlement finalizer runs once even when several devices race
select public.bn_write((select id from t), '[{"op":"put","coll":"orders","id":"o1","data":{"id":"o1","status":"paying"},"open":true}]', 'order.created', 'tono');
select public.bn_write((select id from t), '[{"op":"put","coll":"orders","id":"o1","data":{"id":"o1","status":"paid"},"expect":{"status":"paying"}}]', 'payment.settled', 'gateway');
select pg_temp.expect($$ select public.bn_write((select id from t), '[{"op":"put","coll":"orders","id":"o1","data":{"id":"o1","status":"paid","again":true},"expect":{"status":"paying"}}]', 'payment.settled', 'gateway') $$, 'BN040');
select pg_temp.expect($$ select public.bn_write((select id from t), '[{"op":"put","coll":"orders","id":"nope","data":{},"expect":{"status":"paying"}}]', 'x', 'x') $$, 'BN040');
select pg_temp.expect($$ select public.bn_write((select id from t), '[{"op":"zap","coll":"orders","id":"o1"}]', 'x', 'x') $$, 'BN042');
-- the guard still runs inside bn_write
select pg_temp.expect($$ select public.bn_write((select id from t), '[{"op":"del","coll":"orders","id":"o1"}]', 'x', 'tono') $$, 'BN001');

-- Integration secrets: owner/manager write, nobody reads them back except the server
select public.bn_set_secret((select id from t), 'int1', '{"serverKey":"sk-1","clientKey":"ck-1"}');
select public.bn_set_secret((select id from t), 'int1', '{"clientKey":"","merchantId":"m-9"}'); -- empty keeps the stored value
reset role;
do $$ begin assert (select enc::text not like '%sk-1%' from private.integration_secrets), 'secrets are encrypted at rest'; end $$;
set local role authenticated;
select pg_temp.expect($$ select public.bn_set_secret((select id from t), 'int1', '{"k":1}') $$, 'BN042');
select pg_temp.expect($$ select * from private.integration_secrets $$, 'permission denied');
select pg_temp.expect($$ select public.bn_get_secrets('wrong', (select id from t), 'int1') $$, 'BN016');
reset role; insert into public.members select id, '00000000-0000-0000-0000-00000000000c', 'tono', 'device' from t; set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.expect($$ select public.bn_set_secret((select id from t), 'int1', '{"serverKey":"x"}') $$, 'BN041');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect($$ select public.bn_set_secret((select id from t), 'int1', '{"serverKey":"x"}') $$, 'BN041');
select pg_temp.expect($$ select public.bn_import((select id from t), '[]') $$, 'BN044');

-- Server routes: secrets and document writes with the server secret, through the guard
reset role; set local role anon;
do $$ begin assert public.bn_get_secrets('server-secret-for-tests', (select id from t), 'int1') = '{"serverKey":"sk-1","clientKey":"ck-1","merchantId":"m-9"}'::jsonb;
  assert public.bn_get_secrets('server-secret-for-tests', (select id from t), 'none') = '{}'::jsonb; end $$;
select pg_temp.expect($$ select public.bn_set_secret((select id from t), 'int1', '{"serverKey":"x"}') $$, 'permission denied');
select pg_temp.expect($$ select public.bn_write((select id from t), '[]', 'x', 'x') $$, 'permission denied');
select pg_temp.expect($$ select public.bn_server_write('wrong', (select id from t), '[]', 'x') $$, 'BN016');
select pg_temp.expect($$ select public.bn_server_write('', (select id from t), '[]', 'x') $$, 'BN016');
do $$ begin assert public.bn_server_write('server-secret-for-tests', (select id from t), '[{"op":"put","coll":"orders","id":"gf1","data":{"id":"gf1","source":"gofood","status":"open"}},{"op":"put","coll":"payments","id":"gfp1","data":{"id":"gfp1","orderId":"gf1","method":"ewallet","status":"settled","ref":"GOFOOD-1"}}]', 'online.received') = 2; end $$;
select pg_temp.expect($$ select public.bn_server_write('server-secret-for-tests', (select id from t), '[{"op":"put","coll":"payments","id":"q9","data":{"method":"qris","status":"settled"}}]', 'x') $$, 'BN004');
select pg_temp.expect($$ select public.bn_server_write('server-secret-for-tests', (select id from t), '[{"op":"del","coll":"orders","id":"gf1"}]', 'x') $$, 'BN001');
-- the gateway takes the same 'server' secret
reset role; set local role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.bn_write((select id from t), '[{"op":"put","coll":"payments","id":"pq","data":{"id":"pq","orderId":"o1","method":"qris","amount":1,"status":"pending"},"open":true}]', 'payment.created', 'tono');
reset role; set local role anon;
do $$ begin assert (public.bn_gateway_update('server-secret-for-tests', (select id from t), 'pq', 'settled', 'simulator'))->>'status' = 'settled'; end $$;
do $$ begin assert (public.bn_payment_order('server-secret-for-tests', (select id from t), 'pq'))->'order'->>'id' = 'o1'; end $$;

-- Server-integration RPCs (anon role + server secret, like the API routes)
select public.bn_server_write('server-secret-for-tests', (select id from t), '[
  {"op":"put","coll":"integrations","id":"int1","data":{"id":"int1","kind":"payment","connector":"midtrans"}},
  {"op":"put","coll":"integrations","id":"int2","data":{"id":"int2","kind":"printer"}},
  {"op":"put","coll":"messages","id":"ms1","data":{"id":"ms1","channel":"wa","status":"queued"}},
  {"op":"put","coll":"categories","id":"coffee","data":{"id":"coffee","station":"bar"}},
  {"op":"put","coll":"products","id":"p3","data":{"id":"p3","sku":"KB-003","categoryId":"coffee","status":"live","basePrice":28000}},
  {"op":"put","coll":"payments","id":"pq2","data":{"id":"pq2","orderId":"o1","method":"qris","amount":1,"status":"pending"}},
  {"op":"put","coll":"refunds","id":"rf1","data":{"id":"rf1","orderId":"o1","amount":1,"sessionId":"S-1","lineIds":["l1"]}}
]', 'setup');
select pg_temp.expect($$ select public.bn_integrations('wrong', (select id from t), 'payment') $$, 'BN016');
select public.bn_outbox_claim('server-secret-for-tests', (select id from t), 'wh:anon-grant', 'webhook'), public.bn_outbox_status('server-secret-for-tests', (select id from t), 'x', 'x', 'read');
reset role;
do $$ declare r jsonb; begin
  assert jsonb_array_length(public.bn_integrations('server-secret-for-tests', (select id from t), 'payment')) = 1;
  -- gateway charge details land once, status untouched
  r := public.bn_gateway_charge('server-secret-for-tests', (select id from t), 'pq2', 'midtrans', 'MT-1', 'qr-string', null, 'gojek://pay', 1900000000000);
  assert r->>'provider' = 'midtrans' and r->>'qr' = 'qr-string' and r->>'status' = 'pending' and not r ? 'va' and (r->>'expiresAt')::bigint = 1900000000000, r::text;
  assert public.bn_gateway_charge('server-secret-for-tests', (select id from t), 'pq2', 'xendit', 'X', 'other', null, null, null)->>'provider' = 'midtrans';
  -- outbox: claimed once; failed sends can be claimed again; message status only moves forward
  assert public.bn_outbox_claim('server-secret-for-tests', (select id from t), 'msg:ms1', 'waba')->>'claimed' = 'true';
  assert public.bn_outbox_claim('server-secret-for-tests', (select id from t), 'msg:ms1', 'waba') = '{"claimed": false, "status": "sending", "provider_id": null}'::jsonb;
  perform public.bn_outbox_done('server-secret-for-tests', (select id from t), 'msg:ms1', 'wamid.1', 'failed', 'timeout');
  assert (select data->>'status' from public.docs where coll = 'messages' and id = 'ms1') = 'failed';
  assert public.bn_outbox_claim('server-secret-for-tests', (select id from t), 'msg:ms1', 'waba')->>'claimed' = 'true';
  perform public.bn_outbox_done('server-secret-for-tests', (select id from t), 'msg:ms1', 'wamid.2', 'sent');
  assert (select data->>'status' from public.docs where coll = 'messages' and id = 'ms1') = 'failed', 'failed never goes back to sent';
  update public.docs set data = jsonb_set(data, '{status}', '"sent"') where coll = 'messages' and id = 'ms1';
  perform public.bn_outbox_status('server-secret-for-tests', (select id from t), 'waba', 'wamid.2', 'read');
  perform public.bn_outbox_status('server-secret-for-tests', (select id from t), 'waba', 'wamid.2', 'delivered');
  perform public.bn_outbox_status('server-secret-for-tests', (select id from t), 'waba', 'wamid.2', 'failed');
  assert (select data->>'status' from public.docs where coll = 'messages' and id = 'ms1') = 'read', 'status only moves forward';
  assert public.bn_outbox_claim('server-secret-for-tests', (select id from t), 'wh:e1:int1', 'webhook')->>'claimed' = 'true';
  -- delivery-app orders: numbered from the order sequence, lines mapped by id or SKU, idempotent, void only while open
  r := public.bn_platform_order('server-secret-for-tests', (select id from t), '{"id":"gf-9","source":"gofood","outletId":"sen","type":"delivery","createdAt":1700000000000,"lines":[{"id":"l1","sku":"KB-003","name":"Cappuccino","qty":1,"unitPrice":28000},{"id":"l2","productId":"zzz","name":"Unknown","qty":1}]}');
  assert r->>'status' = 'open' and r->>'no' like '#%', r::text;
  assert (select data->'lines'->0->>'productId' = 'p3' and data->'lines'->0->>'station' = 'bar' and data->'lines'->1->>'station' = 'kitchen' from public.docs where coll = 'orders' and id = 'gf-9');
  assert exists (select 1 from public.docs where coll = 'notices' and data->>'alert' = 'New online order' and data->>'id' = id), 'notice doc id = data.id';
  assert public.bn_platform_order('server-secret-for-tests', (select id from t), '{"id":"gf-9","source":"gofood","lines":[]}')->>'no' = r->>'no';
  assert public.bn_platform_order('server-secret-for-tests', (select id from t), '{"id":"gf-9","status":"voided","note":"Cancelled by driver"}')->>'status' = 'voided';
  assert (select data->>'note' from public.docs where coll = 'orders' and id = 'gf-9') = 'Cancelled by driver';
  assert (public.bn_platform_order('server-secret-for-tests', (select id from t), '{"id":"gf-10","lines":[]}')->>'no') <> r->>'no';
  assert (select data->'lineIds' = '["l1"]' from public.docs where coll = 'refunds' and id = 'rf1');
end $$;
reset role; set local role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect($$ select public.bn_write((select id from t), '[{"op":"put","coll":"orders","id":"gf-9","data":{"id":"gf-9","source":"gofood","status":"open"}},{"op":"del","coll":"refunds","id":"rf1"}]', 'x', 'x') $$, 'BN001');
reset role; set local role anon;

-- Guest snapshot: live products without cost, no recipes, portions left per outlet
do $$ declare s jsonb := public.bn_public_snapshot('kopibiru'); begin
  assert not exists (select 1 from jsonb_array_elements(s->'docs') d where d->>'coll' in ('recipes','employees','movements','payments') or d->'data' ? 'cost'), 'snapshot leaks private data';
  assert not exists (select 1 from jsonb_array_elements(s->'docs') d where d->>'id' = 'p2'), 'unpublished products stay private';
  assert exists (select 1 from jsonb_array_elements(s->'docs') d where d->>'coll' = '_meta' and d->>'id' = 'order');
  assert s->'portions' = '[{"n": 3, "outletId": "sen", "productId": "p1"}]'::jsonb, s->>'portions';
  assert public.bn_public_snapshot('nobody') is null;
end $$;
reset role;
select 'server rpcs hold' as result;
rollback;
