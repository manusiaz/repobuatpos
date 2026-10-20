-- Super admin console: what a merchant writes never breaks or arms it. The asked-for custom domain is listed only when it is
-- a host name (the console turns it into a root shell command, deploy/add-domain.sh), and a malformed "at" in one
-- business's documents no longer fails the whole listing.
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
      'lastActive', (select (extract(epoch from max(d.updated_at)) * 1000)::bigint from public.docs d where d.tenant_id = t.id),
      'domain', (select lower(d.data->'data'->'values'->>'menu') from public.docs d where d.tenant_id = t.id and d.coll = 'versions'
        and d.data->>'kind' = 'page' and d.data->>'status' = 'published' and d.data->'data'->>'tool' = 'domain'
        -- only a host name reaches the console (its row becomes a root shell command), newest by a number that is a number
        and lower(d.data->'data'->'values'->>'menu') ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
        order by case when d.data->>'at' ~ '^\d{1,15}$' then (d.data->>'at')::bigint else 0 end desc limit 1)
    ) order by t.created_at desc), '[]') from public.tenants t);
end $$;
