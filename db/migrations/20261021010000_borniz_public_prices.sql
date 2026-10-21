-- The plan prices BorNiz staff set in the console (Plans & pricing) are the ones the landing pricing and sign-up show.
create or replace function public.bn_public_prices() returns jsonb language sql stable security definer set search_path = public, private as $$
  select coalesce(jsonb_object_agg(substr(id, length('/admin/plans-and-pricing:price-') + 1), data->'value'), '{}') from private.platform_records
  where kind = 'setting' and id in ('/admin/plans-and-pricing:price-basic', '/admin/plans-and-pricing:price-pro')
    and jsonb_typeof(data->'value') = 'number' and (data->>'value')::numeric > 0 $$;
revoke execute on function public.bn_public_prices() from public;
grant execute on function public.bn_public_prices() to anon, authenticated;
