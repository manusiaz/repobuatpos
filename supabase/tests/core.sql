-- Behaviour tests for the core migration. Run against a scratch database with auth.uid()/auth.jwt() stubs reading
-- test.uid / test.jwt (see the stub at the top). Every block raises if the rule does not hold.
\set ON_ERROR_STOP 1
begin;
insert into bn.tenants (id, name, plan) values ('00000000-0000-0000-0000-00000000000a', 'Kopi Biru', 'pro'), ('00000000-0000-0000-0000-00000000000b', 'Other', 'free');
insert into bn.outlets (id, tenant_id, name, service_bps, tax_bps) values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'Senayan', 500, 1000), ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000b', 'Other outlet', 0, 1000);
insert into bn.staff (id, tenant_id, auth_user, name, approval_pin_hash) values
 ('00000000-0000-0000-0000-000000000b0d', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000f1', 'Budi', crypt('246810', gen_salt('bf'))),
 ('00000000-0000-0000-0000-000000000a0d', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000f2', 'Andi', crypt('246810', gen_salt('bf'))),
 ('00000000-0000-0000-0000-000000000c0d', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000f3', 'Tono', crypt('246810', gen_salt('bf')));
insert into bn.role_assignments values ('00000000-0000-0000-0000-000000000b0d', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'owner'),
 ('00000000-0000-0000-0000-000000000a0d', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'manager'),
 ('00000000-0000-0000-0000-000000000c0d', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'cashier');
create function pg_temp.as_(uid text) returns void language sql as $$ select set_config('test.uid', uid, true), set_config('test.jwt', '{"app_metadata":{"tenant_id":"00000000-0000-0000-0000-00000000000a"}}', true) $$;

-- ladder mirrors src/domain/approval.ts
do $$ begin
  assert bn.level_required('discount', 0, 10) = 'cashier'; assert bn.level_required('discount', 0, 20) = 'pic'; assert bn.level_required('discount', 0, 25) = 'manager';
  assert bn.level_required('refund', 100000, 0) = 'pic'; assert bn.level_required('refund', 620000, 0) = 'owner'; assert bn.level_required('variance', 60000, 0) = 'manager'; assert bn.level_required('price', 1, 0) = 'owner';
end $$;

-- refund 620k: manager can't, wrong PIN counts, requester can't, owner with PIN can
select pg_temp.as_('00000000-0000-0000-0000-0000000000f3');
create temp table req as select (bn.request_approval('00000000-0000-0000-0000-0000000000a1', 'refund', 'Refund #2033', 620000)).id;
do $$ begin perform bn.decide((select id from req), '246810', 'approved'); raise exception 'requester decided own request'; exception when others then assert sqlerrm like 'Nobody approves%', sqlerrm; end $$;
select pg_temp.as_('00000000-0000-0000-0000-0000000000f2');
do $$ begin perform bn.decide((select id from req), '246810', 'approved'); raise exception 'manager decided owner-level'; exception when others then assert sqlerrm like 'Needs owner%', sqlerrm; end $$;
select pg_temp.as_('00000000-0000-0000-0000-0000000000f1');
do $$ begin assert bn.decide((select id from req), '000000', 'approved') is null, 'wrong pin must not decide'; end $$;
do $$ begin assert (select fails from bn.pin_attempts) = 1; end $$;
do $$ begin assert (bn.decide((select id from req), '246810', 'approved')).status = 'approved'; end $$;
do $$ begin assert (select count(*) from bn.audit_log) = 1; end $$;
do $$ begin update bn.audit_log set action = 'x'; raise exception 'audit was editable'; exception when others then assert sqlerrm like '%append-only%', sqlerrm; end $$;

-- 5 wrong PINs lock
do $$ declare i int; begin for i in 1..5 loop perform bn.decide((select id from req), '111111', 'approved'); end loop; assert (select locked_until > now() from bn.pin_attempts); end $$;

-- menu scope: local price ±10% and franchise lock
insert into bn.products (id, tenant_id, name, scope, base_price) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000a', 'Es Kopi Susu Aren', 'global', 25000);
insert into bn.outlet_products (product_id, outlet_id, tenant_id, local_price) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 27500);
do $$ begin update bn.outlet_products set local_price = 28000; raise exception 'price band not enforced'; exception when others then assert sqlerrm like 'Local price must stay%', sqlerrm; end $$;

-- order totals on the server, paid is final
insert into bn.orders (id, tenant_id, outlet_id, no, source, idem_key) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', '#1', 'pos', 'k1');
insert into bn.order_lines (tenant_id, order_id, product_id, name, qty, unit_price, modifiers_total) values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'Es Kopi Susu Aren', 2, 25000, 5000);
do $$ begin assert (bn.recalc_order('00000000-0000-0000-0000-0000000000d1')).total = 60000 + 3000 + 6300, 'lg-total'; end $$;
update bn.orders set status = 'paid';
do $$ begin update bn.orders set total = 1; raise exception 'paid order edited'; exception when others then assert sqlerrm like 'Paid orders%', sqlerrm; end $$;

-- RLS: another tenant sees nothing
do $$ begin
  create role bn_test_user noinherit; exception when duplicate_object then null; end $$;
grant usage on schema bn, auth to bn_test_user; grant select on all tables in schema bn to bn_test_user; grant execute on all functions in schema bn, auth to bn_test_user;
set local role bn_test_user;
do $$ begin assert (select count(*) from bn.outlets) = 1, 'tenant A sees only its outlet'; end $$;
select set_config('test.jwt', '{"app_metadata":{"tenant_id":"00000000-0000-0000-0000-00000000000b"}}', true);
do $$ begin assert (select count(*) from bn.orders) = 0, 'tenant B must not see tenant A orders'; end $$;
reset role;
select 'all core rules hold' as result;
rollback;
