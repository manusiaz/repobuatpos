-- Merchants on their own database ("cells"), as the API routes them (src/integrations/server/db.ts call/rpc):
-- * the automation worker lists every business; reads and writes for a moved one go to its cell by p_tenant
-- * super admin's plan change: here it updates the registry only (the frozen copy refuses an audit row, BN050),
--   and the API applies it in the cell with bn_server_set_plan, where the business's own audit trail lives
create or replace function public.bn_server_tenants(p_secret text) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not private.server_secret_ok(p_secret) then raise exception 'BN016 Bad server secret'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'slug', slug, 'name', name, 'plan', plan, 'cell', cell) order by created_at) from public.tenants), '[]');
end $$;

create or replace function public.bn_admin_set_plan(p_tenant uuid, p_plan text) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  if not public.bn_is_platform_admin() then raise exception 'BN070 BorNiz staff only'; end if;
  if p_plan not in ('free', 'basic', 'pro', 'enterprise') then raise exception 'BN071 Unknown plan %', p_plan; end if;
  update public.tenants set plan = p_plan where id = p_tenant;
  if not found then raise exception 'BN072 Business not found'; end if;
  if (select cell from public.tenants where id = p_tenant) is null then
    insert into public.audit_log (tenant_id, actor, action, subject, user_id) values (p_tenant, 'admin', 'tenant.plan', p_plan, auth.uid());
  end if;
end $$;

create or replace function public.bn_server_set_plan(p_secret text, p_tenant uuid, p_plan text) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  if not private.server_secret_ok(p_secret) then raise exception 'BN016 Bad server secret'; end if;
  if p_plan not in ('free', 'basic', 'pro', 'enterprise') then raise exception 'BN071 Unknown plan %', p_plan; end if;
  update public.tenants set plan = p_plan where id = p_tenant;
  insert into public.audit_log (tenant_id, actor, action, subject) values (p_tenant, 'admin', 'tenant.plan', p_plan);
end $$;

revoke execute on function public.bn_server_set_plan(text, uuid, text) from public;
grant execute on function public.bn_server_set_plan(text, uuid, text) to anon, authenticated;
