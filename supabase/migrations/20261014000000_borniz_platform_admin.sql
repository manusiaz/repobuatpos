-- BorNiz staff (super admin, admin.bornis.id): accounts listed in private.platform_admins. Nobody can add themselves; the
-- first one is added in the SQL editor after that person signs up (see CLAUDE.md). Staff read every business and set plans;
-- they never read a business's documents through this (support access stays the tenant-approved flow).
create table if not exists private.platform_admins (user_id uuid primary key references auth.users on delete cascade, added_at timestamptz not null default now());

create or replace function public.bn_is_platform_admin() returns boolean
language sql stable security definer set search_path = private as $$
  select auth.uid() is not null and exists (select 1 from private.platform_admins where user_id = auth.uid()) $$;

create or replace function public.bn_admin_tenants() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not public.bn_is_platform_admin() then raise exception 'BN070 BorNiz staff only'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'slug', t.slug, 'name', t.name, 'plan', t.plan, 'cell', t.cell,
      'createdAt', (extract(epoch from t.created_at) * 1000)::bigint,
      'owner', (select u.email from public.members m join auth.users u on u.id = m.user_id where m.tenant_id = t.id and m.role = 'owner' order by u.created_at limit 1),
      'city', (select d.data->>'city' from public.docs d where d.tenant_id = t.id and d.coll = 'outlets' order by d.id limit 1),
      'outlets', (select count(*) from public.docs d where d.tenant_id = t.id and d.coll = 'outlets'),
      'orders30', (select count(*) from public.docs d where d.tenant_id = t.id and d.coll = 'orders' and d.t > (extract(epoch from now() - interval '30 days') * 1000)::bigint),
      'lastActive', (select (extract(epoch from max(d.updated_at)) * 1000)::bigint from public.docs d where d.tenant_id = t.id)
    ) order by t.created_at desc), '[]') from public.tenants t);
end $$;

create or replace function public.bn_admin_set_plan(p_tenant uuid, p_plan text) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  if not public.bn_is_platform_admin() then raise exception 'BN070 BorNiz staff only'; end if;
  if p_plan not in ('free','basic','pro','enterprise') then raise exception 'BN071 Unknown plan %', p_plan; end if;
  update public.tenants set plan = p_plan where id = p_tenant;
  if not found then raise exception 'BN072 Business not found'; end if;
  insert into public.audit_log (tenant_id, actor, action, subject, user_id) values (p_tenant, 'admin', 'tenant.plan', p_plan, auth.uid());
end $$;

revoke all on private.platform_admins from public, anon, authenticated;
revoke execute on function public.bn_is_platform_admin(), public.bn_admin_tenants(), public.bn_admin_set_plan(uuid, text) from public, anon;
grant execute on function public.bn_is_platform_admin(), public.bn_admin_tenants(), public.bn_admin_set_plan(uuid, text) to authenticated;
