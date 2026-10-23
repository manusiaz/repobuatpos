-- Support tickets on the platform (20261023030000): never urgent from a business, 10 open at most, who opened it, audited.
-- Who may open or read them is checked by the API in the business's own database (cells-api.mjs).
\set ON_ERROR_STOP 1
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d1', 'owner@kopitiket.id'), ('00000000-0000-0000-0000-0000000000d4', 'other@contoh.id');
delete from private.secrets where name = 'server'; insert into private.secrets values ('server', 'ticket-secret');
create function pg_temp.expect(sql text, code text) returns void language plpgsql as $$
begin execute sql; raise exception 'expected % but it passed: %', code, sql;
exception when others then if sqlerrm not like code || '%' then raise exception 'expected %, got: %', code, sqlerrm; end if; end $$;
grant execute on function pg_temp.expect(text, text) to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', true);
create temp table t as select public.bn_bootstrap('Kopi Tiket', 'kopitiket', 'budi') as id;
reset role;
create function pg_temp.open(subject text, body text, prio text) returns text language sql as $$
  select public.bn_server_open_ticket('ticket-secret', (select id from t), '00000000-0000-0000-0000-0000000000d1', subject, body, prio) $$;

select pg_temp.open('Printer not printing', 'Kitchen printer at Senayan stopped at 10:00', 'urgent');
select pg_temp.open('QRIS pending', 'Two payments stay pending', 'high');
select pg_temp.expect($$ select pg_temp.open('x', '', 'normal') $$, 'BN085');
select pg_temp.expect($$ select public.bn_server_open_ticket('wrong', (select id from t), null, 'Hello', 'Hello there') $$, 'BN016');
do $$ declare r jsonb := public.bn_server_records_of('ticket-secret', (select id from t), 'ticket'); begin
  assert jsonb_array_length(r) = 2, 'both tickets: ' || r::text;
  assert (select array_agg(x->>'c' order by x->>'c') from jsonb_array_elements(r) x) = array['high', 'normal'], 'urgent became normal';
  assert (select bool_and(x->>'by' = 'owner@kopitiket.id') from jsonb_array_elements(r) x), 'who opened it';
end $$;
select pg_temp.open('Ticket ' || g, 'Details ' || g, 'normal') from generate_series(1, 8) g;
select pg_temp.expect($$ select pg_temp.open('One more', 'Details', 'normal') $$, 'BN086');
do $$ begin assert (select count(*) from private.platform_audit where action = 'ticket.opened' and tenant_id = (select id from t)) = 10, 'every ticket audited'; end $$;

-- who is acting (bn_acting_role, asked by the API in the business's database): the account; or the staff member signed in
-- by PIN on this device, active, with the role their record has now; an ended session or a removed employee = sign in again
insert into public.docs (tenant_id, coll, id, data) values ((select id from t), 'employees', 'rina', '{"id":"rina","name":"Rina","role":"cashier","active":true}'),
  ((select id from t), 'employees', 'andi', '{"id":"andi","name":"Andi","role":"cashier","active":true}'), ((select id from t), 'employees', 'tono', '{"id":"tono","name":"Tono","role":"cashier","active":false}');
insert into private.staff_sessions (token, tenant_id, user_id, employee_id, role, expires_at) values
  ('00000000-0000-0000-0000-0000000000e9', (select id from t), '00000000-0000-0000-0000-0000000000d1', 'rina', 'cashier', now() + interval '1 hour'),
  ('00000000-0000-0000-0000-0000000000ea', (select id from t), '00000000-0000-0000-0000-0000000000d1', 'andi', 'manager', now() + interval '1 hour'),
  ('00000000-0000-0000-0000-0000000000eb', (select id from t), '00000000-0000-0000-0000-0000000000d1', 'rina', 'cashier', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-0000000000ec', (select id from t), '00000000-0000-0000-0000-0000000000d1', 'tono', 'cashier', now() + interval '1 hour');
set local role authenticated;
do $$ begin
  assert public.bn_acting_role((select id from t))->>'role' = 'owner', 'the account';
  assert (select r->>'role' = 'cashier' and r->>'name' = 'Rina' and r->>'email' = 'owner@kopitiket.id' from public.bn_acting_role((select id from t), '00000000-0000-0000-0000-0000000000e9') r), 'a cashier on the owner''s browser is a cashier';
  assert public.bn_acting_role((select id from t), '00000000-0000-0000-0000-0000000000ea')->>'role' = 'cashier', 'a demotion counts at once';
  assert public.bn_acting_role((select id from t), '00000000-0000-0000-0000-0000000000eb') = '{"ended": true}', 'an ended session (no grace for live calls)';
  assert public.bn_acting_role((select id from t), '00000000-0000-0000-0000-0000000000ec') = '{"ended": true}', 'an employee no longer active';
  assert public.bn_acting_role((select id from t), gen_random_uuid()) = '{"ended": true}', 'an unknown session';
end $$;
-- writes ask the same question: Andi, demoted to cashier while signed in as a manager, writes as a cashier now
select pg_temp.expect($$ select public.bn_write((select id from t), '[{"op":"put","coll":"outlets","id":"x","data":{"id":"x","name":"X"}}]'::jsonb, 'x', 'andi', null, null, null, '00000000-0000-0000-0000-0000000000ea') $$, 'BN054');
select pg_temp.expect($$ select public.bn_write((select id from t), '[{"op":"put","coll":"outlets","id":"x","data":{"id":"x","name":"X"}}]'::jsonb, 'x', 'tono', null, null, null, '00000000-0000-0000-0000-0000000000ec') $$, 'BN082');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d4', true);
do $$ begin assert public.bn_acting_role((select id from t)) is null, 'not a member'; end $$;
reset role;
select 'tickets hold' as result;
rollback;
