-- Owner-only documents (20261012000000_borniz_owner_docs.sql): a manager account can't write perms or commission rules.
\set ON_ERROR_STOP 1
begin;
insert into auth.users values ('00000000-0000-0000-0000-00000000000b'), ('00000000-0000-0000-0000-00000000000c');
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create function pg_temp.expect(sql text, code text) returns void language plpgsql as $$
begin execute sql; raise exception 'expected % but it passed: %', code, sql;
exception when others then if sqlerrm not like code || '%' then raise exception 'expected %, got: %', code, sqlerrm; end if; end $$;
grant execute on function pg_temp.expect(text, text), pg_temp.as_user(text) to authenticated, anon;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
create temp table t as select public.bn_bootstrap('Kopi Hijau', 'kopihijau', 'budi') as id;
grant select on t to authenticated;
select public.bn_write((select id from t), '[{"op":"put","coll":"commissionRules","id":"r1","data":{"id":"r1","pct":1}}]'::jsonb, 'x', 'budi');
reset role;
insert into public.members (tenant_id, user_id, employee_id, role) select id, '00000000-0000-0000-0000-00000000000c', 'andi', 'manager' from t;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.expect($$ select public.bn_write((select id from t), '[{"op":"put","coll":"commissionRules","id":"r1","data":{"id":"r1","pct":9}}]'::jsonb, 'x', 'andi') $$, 'BN051');
select pg_temp.expect($$ select public.bn_write((select id from t), '[{"op":"put","coll":"perms","id":"all|refund","data":"yyyyyyn"}]'::jsonb, 'x', 'andi') $$, 'BN051');
select public.bn_write((select id from t), '[{"op":"put","coll":"outlets","id":"sen","data":{"id":"sen"}}]'::jsonb, 'x', 'andi');
reset role;
do $$ begin assert (select data->>'pct' from public.docs where coll = 'commissionRules' and id = 'r1') = '1', 'the manager write was refused'; end $$;
select 'owner-only documents hold' as result;
rollback;
