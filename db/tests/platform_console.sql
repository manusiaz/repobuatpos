-- The super admin console on the server (20261020070000_borniz_platform_console.sql): its records and audit are kept, a paused
-- business writes nothing and shows no menu, a trial starts once and ends on Free.
\set ON_ERROR_STOP 1
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f7', 'owner@kopikonsol.id'), ('00000000-0000-0000-0000-0000000000f8', 'staff@bornis.id');
delete from private.secrets where name = 'server'; insert into private.secrets values ('server', 'console-secret');
create function pg_temp.expect(sql text, code text) returns void language plpgsql as $$
begin execute sql; raise exception 'expected % but it passed: %', code, sql;
exception when others then if sqlerrm not like code || '%' then raise exception 'expected %, got: %', code, sqlerrm; end if; end $$;
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
grant execute on function pg_temp.expect(text, text), pg_temp.as_user(text) to authenticated, anon;
insert into private.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000000f8');
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f7');
create temp table t as select public.bn_bootstrap('Kopi Konsol', 'kopikonsol', 'budi') as id;
grant select on t to authenticated, anon;
select public.bn_write((select id from t), '[{"op":"put","coll":"outlets","id":"sen","data":{"id":"sen","name":"Senayan"}}]'::jsonb, 'setup', 'budi');

-- 1. only BorNiz staff touch the console's records
select pg_temp.expect($$ select public.bn_admin_records() $$, 'BN070');
select pg_temp.expect($$ select public.bn_admin_put('ticket', 'TK-1', '{"a":"x"}', 'ticket.opened') $$, 'BN070');
select pg_temp.expect($$ select public.bn_admin_set_status((select id from t), 'suspended', 'x') $$, 'BN070');

-- 2. the owner starts the Pro trial once
do $$ declare r jsonb := public.bn_start_trial((select id from t), 'pro'); begin
  assert r->>'plan' = 'pro' and (r->>'trialUntil')::bigint > (extract(epoch from now() + interval '13 days') * 1000)::bigint, 'trial started: ' || r::text;
end $$;
select pg_temp.expect($$ select public.bn_start_trial((select id from t), 'pro') $$, 'BN074');

-- 3. staff keep their work: a ticket, a platform price, notes on the business; each is in the platform audit with their name
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f8');
select public.bn_admin_put('ticket', 'TK-1', '{"id":"TK-1","a":"Printer not printing","b":"x","c":"high","d":"open","e":"","at":1}', 'ticket.opened', 'TK-1');
select public.bn_admin_put('setting', '/admin/plans-and-pricing:price-pro', '{"value":399000}', 'plan.price_changed', 'pro 399000');
do $$ declare r jsonb := public.bn_admin_records(); a jsonb := public.bn_admin_audit(); begin
  assert jsonb_array_length(r) = 2, 'two records kept: ' || r::text;
  assert a->0->>'actor' = 'staff@bornis.id' and a->0->>'action' = 'plan.price_changed', 'audited with the staff member: ' || a::text;
end $$;

-- 4. the trial is extended, and when it ends unpaid the business is on Free; a plan set by BorNiz ends the trial
select public.bn_admin_set_trial((select id from t), (extract(epoch from now() - interval '1 day') * 1000)::bigint);
reset role;
do $$ begin
  assert public.bn_plan_now((select plan from public.tenants where id = (select id from t)), (select trial_until from public.tenants where id = (select id from t))) = 'free', 'an ended trial is Free';
  assert public.bn_public_snapshot('kopikonsol')->'tenant'->>'plan' = 'free', 'the guest screens see Free';
end $$;
set local role authenticated;
select public.bn_admin_set_plan((select id from t), 'basic');
reset role;
do $$ begin assert (select trial_until from public.tenants where id = (select id from t)) is null and (select plan from public.tenants where id = (select id from t)) = 'basic', 'paid plan, no trial'; end $$;

-- 5. a paused business writes nothing, shows no menu and gets no automation; reactivated it works again
set local role authenticated;
select public.bn_admin_set_status((select id from t), 'suspended', 'unpaid 60 days');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f7');
select pg_temp.expect($$ select public.bn_write((select id from t), '[{"op":"put","coll":"outlets","id":"sen","data":{"id":"sen","name":"Senayan 2"}}]'::jsonb, 'x', 'budi') $$, 'BN073');
reset role;
do $$ begin
  assert public.bn_public_snapshot('kopikonsol') is null, 'no QR menu while paused';
  assert not exists (select 1 from jsonb_array_elements(public.bn_server_tenants('console-secret')) x where x->>'slug' = 'kopikonsol'), 'the worker skips it';
end $$;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f8');
select public.bn_admin_set_status((select id from t), 'active', 'paid');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f7');
select public.bn_write((select id from t), '[{"op":"put","coll":"outlets","id":"sen","data":{"id":"sen","name":"Senayan 2"}}]'::jsonb, 'x', 'budi');
reset role;
do $$ begin assert (select count(*) from private.platform_audit where action in ('tenant.suspended', 'tenant.active', 'tenant.plan', 'tenant.trial_extended')) = 4, 'every console action audited'; end $$;
select 'platform console holds' as result;
rollback;
