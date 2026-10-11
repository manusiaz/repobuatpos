-- Hybrid tenancy (supabase/migrations/20261011020000_borniz_cells.sql): registry lookup, a moved business is frozen here,
-- owners can't change plan or cell.
\set ON_ERROR_STOP 1
begin;
insert into auth.users values ('00000000-0000-0000-0000-00000000000a');
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create function pg_temp.expect(sql text, code text) returns void language plpgsql as $$
begin execute sql; raise exception 'expected % but it passed: %', code, sql;
exception when others then if sqlerrm not like code || '%' then raise exception 'expected %, got: %', code, sqlerrm; end if; end $$;
grant execute on function pg_temp.expect(text, text), pg_temp.as_user(text) to authenticated, anon;

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
create temp table t as select public.bn_bootstrap('Kopi Biru', 'kopibiru', 'budi') as id;
grant select on t to anon, authenticated;
do $$ begin assert (public.bn_tenant_cell('kopibiru')->>'cell') is null, 'a new business lives in the shared database'; end $$;
update public.tenants set name = 'Kopi Biru Indonesia' where id = (select id from t);
select pg_temp.expect($$ update public.tenants set plan = 'enterprise' where id = (select id from t) $$, 'permission denied');
select pg_temp.expect($$ update public.tenants set cell = 'kb' where id = (select id from t) $$, 'permission denied');
select public.bn_write((select id from t), '[{"op":"put","coll":"outlets","id":"sen","data":{"id":"sen","name":"Senayan"}}]'::jsonb, 'setup', 'budi');

-- the platform moves the business to its own database
reset role;
insert into public.cells (id, url, publishable_key, region) values ('kb', 'https://kb.supabase.co', 'sb_publishable_kb', 'ap-southeast-1');
update public.tenants set cell = 'kb' where slug = 'kopibiru';
set local role anon;
do $$ begin assert public.bn_tenant_cell('kopibiru')->>'url' = 'https://kb.supabase.co', 'guests find the new database by slug'; end $$;
set local role authenticated;
do $$ begin assert public.bn_tenant_cell(null, (select id from t))->>'key' = 'sb_publishable_kb', 'staff find it by tenant id'; end $$;
select pg_temp.expect($$ select public.bn_write((select id from t), '[{"op":"put","coll":"outlets","id":"kem","data":{"id":"kem"}}]'::jsonb, 'x', 'budi') $$, 'BN050');
do $$ begin assert (select count(*) from public.docs where coll = 'outlets') = 1, 'old rows stay here read-only as a backup'; end $$;
reset role;
select 'tenancy rules hold' as result;
rollback;
