-- BorNiz billing on the platform (20261023000000_borniz_billing.sql): one invoice per business and month.
\set ON_ERROR_STOP 1
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b1', 'owner@kopitagih.id'), ('00000000-0000-0000-0000-0000000000b2', 'kasir@kopitagih.id');
delete from private.secrets where name = 'server'; insert into private.secrets values ('server', 'billing-secret');
create function pg_temp.expect(sql text, code text) returns void language plpgsql as $$
begin execute sql; raise exception 'expected % but it passed: %', code, sql;
exception when others then if sqlerrm not like code || '%' then raise exception 'expected %, got: %', code, sqlerrm; end if; end $$;
grant execute on function pg_temp.expect(text, text) to authenticated, anon;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
create temp table t as select public.bn_bootstrap('Kopi Tagih', 'kopitagih', 'budi') as id;
grant select on t to authenticated, anon;
select public.bn_start_trial((select id from t), 'pro');
reset role;
do $$ begin assert (select x->>'trial' from jsonb_array_elements(public.bn_server_tenants('billing-secret')) x where x->>'slug' = 'kopitagih') = 'true', 'the worker sees the trial'; end $$;

-- the worker issues it once; the same month again adds nothing; an invoice for another business is refused
create temp table inv as select jsonb_build_object('id', 'inv-' || (select id from t) || '-2026-11', 'a', (select id from t)::text, 'b', '2026-11', 'c', '1162170', 'd', 'unpaid', 'e', '', 'at', 1, 'n', 'Pro × 3 outlets') as d;
do $$ begin
  assert public.bn_server_invoice('billing-secret', (select id from t), (select d->>'id' from inv), (select d from inv)), 'issued';
  assert not public.bn_server_invoice('billing-secret', (select id from t), (select d->>'id' from inv), (select d from inv)), 'not twice';
  assert (select count(*) from private.platform_audit where action = 'invoice.issued' and tenant_id = (select id from t)) = 1, 'audited once';
end $$;
select pg_temp.expect($$ select public.bn_server_invoice('billing-secret', gen_random_uuid(), (select d->>'id' from inv), (select d from inv)) $$, 'BN079');
select pg_temp.expect($$ select public.bn_server_invoice('wrong', (select id from t), 'x', '{}') $$, 'BN016');

-- the API reads a business's own invoices after its database said the caller is the owner (cells-api.mjs)
do $$ begin assert public.bn_server_records_of('billing-secret', (select id from t), 'invoice')->0->>'n' = 'Pro × 3 outlets', 'the business''s invoice'; end $$;
select pg_temp.expect($$ select public.bn_server_records_of('billing-secret', (select id from t), 'secret') $$, 'BN083');
-- an invoice unpaid 14 days holds the set-up (20261024000000_borniz_billing_hold.sql); sales carry on; paying releases it
do $$ declare ch jsonb := public.bn_server_billing_holds('billing-secret'); begin
  assert ch @> jsonb_build_array(jsonb_build_object('id', (select id from t)::text, 'hold', true)), 'held: ' || ch;
  assert not public.bn_server_billing_holds('billing-secret') @> jsonb_build_array(jsonb_build_object('id', (select id from t)::text)), 'a change is reported once';
  assert (select x->>'hold' from jsonb_array_elements(public.bn_server_tenants('billing-secret')) x where x->>'slug' = 'kopitagih') = 'true', 'the worker sees the hold';
  assert public.bn_server_tenant_row('billing-secret', (select id from t))->>'billing_hold' = 'true', 'a moved business gets it';
end $$;
set local role authenticated;
do $$ begin assert public.bn_unpaid_since((select id from t)) = 1, 'the owner''s devices see since when'; end $$;
select pg_temp.expect($$ select public.bn_write((select id from t), '[{"op":"put","coll":"products","id":"p1","data":{"id":"p1","name":"Kopi","basePrice":20000}}]', 'product.saved', 'budi') $$, 'BN088');
select pg_temp.expect($$ select public.bn_write((select id from t), '[{"op":"put","coll":"promos","id":"pr1","data":{"id":"pr1","kind":"pct","value":10}}]', 'promo.saved', 'budi') $$, 'BN088');
select public.bn_write((select id from t), '[{"op":"put","coll":"orders","id":"o1","data":{"id":"o1","no":"#1","source":"pos","status":"open","outletId":"sen","lines":[],"subtotal":0,"discount":0,"total":0}},{"op":"put","coll":"customers","id":"c1","data":{"id":"c1","name":"Dewi","phone":"0812"}}]', 'order.created', 'budi'); -- the register sells
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', true);
do $$ begin assert public.bn_unpaid_since((select id from t)) is null, 'not a member: nothing'; end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
reset role;
update private.platform_records set data = data || '{"d":"paid"}' where kind = 'invoice' and data->>'a' = (select id from t)::text;
do $$ begin assert public.bn_server_billing_holds('billing-secret') @> jsonb_build_array(jsonb_build_object('id', (select id from t)::text, 'hold', false)), 'paid: released'; end $$;
set local role authenticated;
select public.bn_write((select id from t), '[{"op":"put","coll":"products","id":"p1","data":{"id":"p1","name":"Kopi","basePrice":20000}}]', 'product.saved', 'budi');
reset role;
select 'billing holds' as result;
rollback;
