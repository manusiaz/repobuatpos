-- BorNiz support access (20261020080000_borniz_support_access.sql): asked from the console, granted by the owner with their
-- approval PIN, read-only while it lasts, ended on demand; nobody else gets in.
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
create temp table t as select public.bn_bootstrap('Kopi Bantu', 'kopibantu', 'budi') as id;
grant select on t to authenticated, anon;
select public.bn_write((select id from t), '[{"op":"put","coll":"outlets","id":"sen","data":{"id":"sen","name":"Senayan"}},
  {"op":"put","coll":"employees","id":"budi","data":{"id":"budi","name":"Budi","role":"owner","outlets":["sen"]}}]'::jsonb, 'setup', 'budi');
select public.bn_set_pins((select id from t), 'budi', '1111', '246810');


create temp table req (id text); grant all on req to authenticated, anon;
-- 1. an owner can't ask for staff access to someone else's business, and nothing is readable before the owner grants it
select pg_temp.expect($$ select public.bn_admin_request_access((select id from t), 2, 'printer routing') $$, 'BN070');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f8');
insert into req select public.bn_admin_request_access((select id from t), 2, 'printer routing', 'TK-9');
reset role;
do $$ begin
  assert (select data->>'status' = 'waiting' and data->>'level' = 'owner' from public.docs where coll = 'approvals' and id = (select id from req)), 'the owner has the request';
  assert exists (select 1 from public.docs where coll = 'notices' and data->>'alert' = 'Support access requested'), 'and a notice';
  assert public.bn_server_support_state('console-secret', (select id from t))->>'state' = 'requested';
end $$;
select pg_temp.expect($$ select public.bn_server_support_docs('console-secret', (select id from t)) $$, 'BN075');
-- 2. the owner grants it with the approval PIN: read-only set-up for two hours
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f7');
select public.bn_check_approval_pin((select id from t), 'budi', '246810');
select public.bn_write((select id from t), jsonb_build_array(jsonb_build_object('op', 'put', 'coll', 'approvals', 'id', (select id from req), 'data',
  (select data from public.docs where coll = 'approvals' and id = (select id from req)) || '{"status":"approved","decidedBy":"budi","decidedAt":1}'::jsonb
  || jsonb_build_object('decidedAt', (extract(epoch from now()) * 1000)::bigint))), 'approval.approved', 'budi');
reset role;
do $$ declare r jsonb := public.bn_server_support_docs('console-secret', (select id from t)); begin
  assert public.bn_server_support_state('console-secret', (select id from t))->>'state' = 'active', 'granted';
  assert exists (select 1 from jsonb_array_elements(r) x where x->>'coll' = 'outlets') and not exists (select 1 from jsonb_array_elements(r) x where x->>'coll' in ('employees', 'orders', 'customers')), 'set-up only: ' || r::text;
end $$;
-- 3. ended early: nothing readable again
select public.bn_server_support_end('console-secret', (select id from t), (select id from req));
select pg_temp.expect($$ select public.bn_server_support_docs('console-secret', (select id from t)) $$, 'BN075');
select 'support access holds' as result;
rollback;
