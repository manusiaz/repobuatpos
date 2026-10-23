-- BorNiz billing on the platform (20261023000000_borniz_billing.sql): one invoice per business and month, only the owner reads them.
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

-- the owner reads them; anyone else is refused
set local role authenticated;
do $$ begin assert public.bn_my_invoices((select id from t))->0->>'n' = 'Pro × 3 outlets', 'owner sees the invoice'; end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', true);
select pg_temp.expect($$ select public.bn_my_invoices((select id from t)) $$, 'BN078');
reset role;
select 'billing holds' as result;
rollback;
