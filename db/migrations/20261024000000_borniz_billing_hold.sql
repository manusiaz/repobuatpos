-- Unpaid BorNiz invoices (spec lg-gate + bn-alerts "Invoice due / unpaid": banner and reminder from day 7, "Day 14 back office
-- read-only; POS keeps selling"):
--   tenants.billing_hold   set by the worker (bn_server_billing_holds) while an invoice is unpaid 14 days or more, cleared once
--                          it is paid or voided; copied to a moved business's own database with the plan and status
--   BN088                  on hold, nobody changes the set-up a cashier can't change either (menu, prices, promos, outlets,
--                          stock set-up, integrations, permissions); orders, payments, drawers, clock-ins carry on
--   bn_unpaid_since        when the oldest unpaid invoice was issued, for the banner and the alert (a timestamp, no amount)
alter table public.tenants add column if not exists billing_hold boolean not null default false;

create or replace function private.unpaid_since(p_tenant uuid) returns bigint language sql stable security definer set search_path = public, private as $$
  select min((data->>'at')::bigint) from private.platform_records
  where kind = 'invoice' and data->>'a' = p_tenant::text and coalesce(data->>'d', '') not in ('paid', 'void') $$;
revoke execute on function private.unpaid_since(uuid) from public, anon, authenticated;

create or replace function public.bn_unpaid_since(p_tenant uuid) returns bigint language sql stable security definer set search_path = public, private as $$
  select case when public.bn_member_role(p_tenant) is not null then private.unpaid_since(p_tenant) end $$;
revoke execute on function public.bn_unpaid_since(uuid) from public, anon;
grant execute on function public.bn_unpaid_since(uuid) to authenticated;

-- every pass of the worker: the businesses whose hold changed (with their cell, to copy it there)
create or replace function public.bn_server_billing_holds(p_secret text) returns jsonb language plpgsql security definer set search_path = public, private as $$
declare out jsonb;
begin
  if not private.server_secret_ok(p_secret) then raise exception 'BN016 Bad server secret'; end if;
  with due as (select t.id, coalesce(private.unpaid_since(t.id) <= (extract(epoch from now() - interval '14 days') * 1000)::bigint, false) hold from public.tenants t),
       ch as (update public.tenants t set billing_hold = due.hold from due where t.id = due.id and t.billing_hold is distinct from due.hold returning t.id, t.cell, t.billing_hold)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'cell', cell, 'hold', billing_hold)), '[]') into out from ch;
  insert into private.platform_audit (tenant_id, action, subject)
    select (x->>'id')::uuid, case when (x->>'hold')::boolean then 'billing.hold' else 'billing.released' end, 'invoice unpaid 14 days' from jsonb_array_elements(out) x;
  return out;
end $$;
revoke execute on function public.bn_server_billing_holds(text) from public;
grant execute on function public.bn_server_billing_holds(text) to anon, authenticated;

-- the registry row a moved business follows now carries the hold too
create or replace function public.bn_server_tenant_sync(p_secret text, p_tenant uuid, p_row jsonb) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  if not private.server_secret_ok(p_secret) then raise exception 'BN016 Bad server secret'; end if;
  update public.tenants set plan = p_row->>'plan', status = p_row->>'status', trial_until = case when p_row ? 'trial_until' and p_row->>'trial_until' is not null then (p_row->>'trial_until')::timestamptz end,
    billing_hold = coalesce((p_row->>'billing_hold')::boolean, billing_hold)
  where id = p_tenant;
  insert into public.audit_log (tenant_id, actor, action, subject) values (p_tenant, 'admin', 'tenant.synced', p_row->>'plan' || ' · ' || (p_row->>'status'));
end $$;
create or replace function public.bn_server_tenant_row(p_secret text, p_tenant uuid) returns jsonb language plpgsql stable security definer set search_path = public, private as $$
begin
  if not private.server_secret_ok(p_secret) then raise exception 'BN016 Bad server secret'; end if;
  return (select jsonb_build_object('plan', plan, 'status', status, 'trial_until', trial_until, 'cell', cell, 'billing_hold', billing_hold) from public.tenants where id = p_tenant);
end $$;

create or replace function public.bn_server_tenants(p_secret text) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not private.server_secret_ok(p_secret) then raise exception 'BN016 Bad server secret'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'slug', slug, 'name', name, 'plan', public.bn_plan_now(plan, trial_until), 'cell', cell,
      'trial', trial_until is not null and trial_until > now(), 'unpaidSince', private.unpaid_since(id), 'hold', billing_hold) order by created_at)
    from public.tenants where status <> 'suspended'), '[]'); -- a paused business gets no automation
end $$;

create or replace function private.hold_rules() returns trigger language plpgsql security definer set search_path = public, private as $$
declare c text := coalesce(new.coll, old.coll); n jsonb := case when tg_op = 'DELETE' then null else new.data end; o jsonb := case when tg_op = 'INSERT' then null else old.data end;
begin
  -- an upsert fires BEFORE INSERT first even when the row exists; the BEFORE UPDATE pass that follows does the checking
  if tg_op = 'INSERT' and exists (select 1 from public.docs where tenant_id = new.tenant_id and coll = new.coll and id = new.id) then return new; end if;
  -- server routes, the gateway, the worker and guests write with no updated_by; only people are held
  if auth.uid() is null or (tg_op <> 'DELETE' and new.updated_by is null) then return case when tg_op = 'DELETE' then old else new end; end if;
  if not exists (select 1 from public.tenants where id = coalesce(new.tenant_id, old.tenant_id) and billing_hold) then return case when tg_op = 'DELETE' then old else new end; end if;
  if c in ('products','categories','modifierGroups','promos','integrations','suppliers','stockItems','recipes','outlets','commissionRules','perms')
     or (c = 'outletProducts' and (tg_op <> 'UPDATE' or (n - 'is86') is distinct from (o - 'is86'))) then -- sold out stays possible
    raise exception 'BN088 A BorNiz invoice is unpaid for 14 days: the set-up is read-only until it is paid. Sales carry on.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke execute on function private.hold_rules() from public, anon, authenticated;
drop trigger if exists docs_hold_rules on public.docs;
create trigger docs_hold_rules before insert or update or delete on public.docs for each row execute function private.hold_rules();
