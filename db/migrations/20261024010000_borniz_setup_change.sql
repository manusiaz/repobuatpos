-- What counts as changing the set-up, in one place (review of 20261024000000): a cashier may not (BN054) and nobody may while
-- a BorNiz invoice is unpaid 14 days (BN088). The register's own bookkeeping on those documents is not set-up: a sale counts
-- a promo's use, a device reports a printer or gateway as ok / failing, an item is marked sold out. Before this, a
-- cashier's sale with a voucher and a register's printer report were refused (BN054), and during a hold every promo sale.
create or replace function private.setup_change(c text, n jsonb, o jsonb) returns boolean language sql immutable as $$
  select case
    when c in ('products','categories','modifierGroups','suppliers','stockItems','recipes','outlets','commissionRules','perms') then true
    when c = 'promos' then o is null or n is null or (n - 'used') is distinct from (o - 'used')
    when c = 'integrations' then o is null or n is null or (n - array['status','lastOk','lastError']) is distinct from (o - array['status','lastOk','lastError'])
    when c = 'outletProducts' then o is null or n is null or (n - 'is86') is distinct from (o - 'is86')
    else false end $$;

do $$ declare f text := pg_get_functiondef('private.staff_rules()'::regprocedure);
  k text := $q$    if c in ('products','categories','modifierGroups','promos','integrations','suppliers','stockItems','recipes','outlets','commissionRules','perms') then
      raise exception 'BN054 Your role can''t change %', c;
    end if;
    if c = 'outletProducts' and (tg_op <> 'UPDATE' or (n - 'is86') is distinct from (o - 'is86')) then
      raise exception 'BN054 Your role can only mark items sold out';
    end if;$q$;
begin
  if position('private.setup_change' in f) > 0 then return; end if;
  if position(k in f) = 0 then raise exception 'staff_rules changed: call private.setup_change there by hand'; end if;
  execute replace(f, k, $q$    if private.setup_change(c, n, o) then
      raise exception 'BN054 Your role can''t change %', c;
    end if;$q$);
end $$;

-- the cheap checks first: most writes are by a person on a business with no hold
create or replace function private.hold_rules() returns trigger language plpgsql security definer set search_path = public, private as $$
declare c text := coalesce(new.coll, old.coll); n jsonb := case when tg_op = 'DELETE' then null else new.data end; o jsonb := case when tg_op = 'INSERT' then null else old.data end;
begin
  -- server routes, the gateway, the worker and guests write with no updated_by; only people are held
  if auth.uid() is null or (tg_op <> 'DELETE' and new.updated_by is null) or not private.setup_change(c, n, o) then return case when tg_op = 'DELETE' then old else new end; end if;
  -- an upsert fires BEFORE INSERT first even when the row exists; the BEFORE UPDATE pass that follows does the checking
  if tg_op = 'INSERT' and exists (select 1 from public.docs where tenant_id = new.tenant_id and coll = new.coll and id = new.id) then return new; end if;
  if exists (select 1 from public.tenants where id = coalesce(new.tenant_id, old.tenant_id) and billing_hold) then
    raise exception 'BN088 A BorNiz invoice is unpaid for 14 days: the set-up is read-only until it is paid. Sales carry on.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

-- unpaid invoices per business, read by the worker every minute
create index if not exists platform_records_invoice_tenant on private.platform_records ((data->>'a')) where kind = 'invoice';
create or replace function public.bn_server_billing_holds(p_secret text) returns jsonb language plpgsql security definer set search_path = public, private as $$
declare out jsonb;
begin
  if not private.server_secret_ok(p_secret) then raise exception 'BN016 Bad server secret'; end if;
  with unpaid as (select data->>'a' tid, min((data->>'at')::bigint) since from private.platform_records
                  where kind = 'invoice' and coalesce(data->>'d', '') not in ('paid', 'void') group by 1),
       due as (select t.id, coalesce(u.since <= (extract(epoch from now() - interval '14 days') * 1000)::bigint, false) hold
               from public.tenants t left join unpaid u on u.tid = t.id::text),
       ch as (update public.tenants t set billing_hold = due.hold from due where t.id = due.id and t.billing_hold is distinct from due.hold returning t.id, t.cell, t.billing_hold)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'cell', cell, 'hold', billing_hold)), '[]') into out from ch;
  insert into private.platform_audit (tenant_id, action, subject)
    select (x->>'id')::uuid, case when (x->>'hold')::boolean then 'billing.hold' else 'billing.released' end, 'invoice unpaid 14 days' from jsonb_array_elements(out) x;
  return out;
end $$;
