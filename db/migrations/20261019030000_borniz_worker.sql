-- The automation worker (scripts/worker.ts, run every minute by deploy/borniz-worker.timer) reads a business the way a
-- signed-in device does, with the server secret, so alerts, escalations, gateway settlement and queued messages run
-- with no device open. It writes back through bn_server_write; devices get the result live (bn_live).
create or replace function public.bn_server_tenants(p_secret text) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not private.server_secret_ok(p_secret) then raise exception 'BN016 Bad server secret'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'slug', slug, 'name', name, 'plan', plan) order by created_at)
    from public.tenants where cell is null), '[]'); -- a business moved to its own database is run there
end $$;

/** One page (1000) of a business's documents inside the history window, as read/docs gives a device. */
create or replace function public.bn_server_docs(p_secret text, p_tenant uuid, p_since bigint, p_from int) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not private.server_secret_ok(p_secret) then raise exception 'BN016 Bad server secret'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('coll', coll, 'id', id, 'data', data)) from (
    select coll, id, data from public.docs where tenant_id = p_tenant and (t is null or t >= p_since or open)
    order by coll, id limit 1000 offset p_from) x), '[]');
end $$;

/** Stock and beans before the window (bn_opening, for the worker). */
create or replace function public.bn_server_opening(p_secret text, p_tenant uuid, p_before bigint) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not private.server_secret_ok(p_secret) then raise exception 'BN016 Bad server secret'; end if;
  return jsonb_build_object(
    'stock', coalesce((select jsonb_agg(jsonb_build_object('outletId', o, 'stockItemId', s, 'qty', q)) from (
      select data->>'outletId' o, data->>'stockItemId' s, sum((data->>'qty')::numeric) q from public.docs
      where tenant_id = p_tenant and coll = 'movements' and t < p_before group by 1, 2) x), '[]'),
    'beans', coalesce((select jsonb_agg(jsonb_build_object('customerId', c, 'points', p)) from (
      select data->>'customerId' c, sum((data->>'points')::numeric) p from public.docs
      where tenant_id = p_tenant and coll = 'ledger' and t < p_before group by 1) y), '[]'));
end $$;

revoke execute on function public.bn_server_tenants(text), public.bn_server_docs(text, uuid, bigint, int), public.bn_server_opening(text, uuid, bigint) from public;
grant execute on function public.bn_server_tenants(text), public.bn_server_docs(text, uuid, bigint, int), public.bn_server_opening(text, uuid, bigint) to anon, authenticated;
