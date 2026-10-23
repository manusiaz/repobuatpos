-- Support tickets from a business (20261023010000_borniz_tickets.sql): owner / manager only, never urgent, 10 open at most, own tickets only.
\set ON_ERROR_STOP 1
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d1', 'owner@kopitiket.id'), ('00000000-0000-0000-0000-0000000000d2', 'manager@kopitiket.id'),
  ('00000000-0000-0000-0000-0000000000d3', 'kasir@kopitiket.id'), ('00000000-0000-0000-0000-0000000000d4', 'owner@lain.id');
create function pg_temp.expect(sql text, code text) returns void language plpgsql as $$
begin execute sql; raise exception 'expected % but it passed: %', code, sql;
exception when others then if sqlerrm not like code || '%' then raise exception 'expected %, got: %', code, sqlerrm; end if; end $$;
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
grant execute on function pg_temp.expect(text, text), pg_temp.as_user(text) to authenticated;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
create temp table t as select public.bn_bootstrap('Kopi Tiket', 'kopitiket', 'budi') as id;
grant select on t to authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d4');
select public.bn_bootstrap('Kopi Lain', 'kopilain', 'budi');
reset role;
insert into public.members (tenant_id, user_id, employee_id, role) select id, '00000000-0000-0000-0000-0000000000d2', 'andi', 'manager' from t;
set local role authenticated;

-- owner and manager open tickets; a merchant cannot mark one urgent; an empty one is refused
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select public.bn_open_ticket((select id from t), 'Printer not printing', 'Kitchen printer at Senayan stopped at 10:00', 'urgent');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select public.bn_open_ticket((select id from t), 'QRIS pending', 'Two payments stay pending', 'high');
select pg_temp.expect($$ select public.bn_open_ticket((select id from t), 'x', '', 'normal') $$, 'BN081');
do $$ declare r jsonb := public.bn_my_tickets((select id from t)); begin
  assert jsonb_array_length(r) = 2, 'both tickets: ' || r::text;
  assert (select array_agg(x->>'c' order by x->>'c') from jsonb_array_elements(r) x) = array['high', 'normal'], 'urgent became normal';
  assert (select x->>'by' from jsonb_array_elements(r) x where x->>'c' = 'high') = 'manager@kopitiket.id', 'who opened it';
end $$;

-- nobody else: a cashier with no account role, the owner of another business
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d3');
select pg_temp.expect($$ select public.bn_open_ticket((select id from t), 'Hello', 'Hello there', 'normal') $$, 'BN080');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d4');
select pg_temp.expect($$ select public.bn_my_tickets((select id from t)) $$, 'BN080');

-- 10 open at most
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select public.bn_open_ticket((select id from t), 'Ticket ' || g, 'Details ' || g, 'normal') from generate_series(1, 8) g;
select pg_temp.expect($$ select public.bn_open_ticket((select id from t), 'One more', 'Details', 'normal') $$, 'BN082');
reset role;
do $$ begin assert (select count(*) from private.platform_audit where action = 'ticket.opened' and tenant_id = (select id from t)) = 10, 'every ticket audited'; end $$;
select 'tickets hold' as result;
rollback;
