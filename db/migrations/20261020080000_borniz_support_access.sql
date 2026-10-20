-- BorNiz support access to a business, time-boxed and approved by its owner (spec: Tenant detail › support access):
--   the console asks (bn_admin_request_access): a waiting owner-level request lands in the business (approvals, type perm,
--   payload.kind support_access) with a notice; the owner grants or denies it with their approval PIN like every request
--   while granted (decidedAt + hours, not ended) BorNiz staff read the business's set-up (outlets, devices, integrations,
--   settings): bn_server_support_docs, BN075 otherwise; every read and the end are in the platform audit
-- The business's own database answers (a cell for a moved one): the API checks the caller is BorNiz staff on the platform,
-- then calls these server functions there.
create or replace function private.support_request(p_tenant uuid, p_id text, p_hours int, p_reason text, p_ticket text) returns void
language plpgsql security definer set search_path = public, private as $$
declare outlet text := (select id from public.docs where tenant_id = p_tenant and coll = 'outlets' order by id limit 1);
  at bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  insert into public.docs (tenant_id, coll, id, data, t, open, updated_by) values (p_tenant, 'approvals', p_id, jsonb_build_object('id', p_id, 'type', 'perm', 'level', 'owner',
    'status', 'waiting', 'title', 'BorNiz support access · ' || p_hours || ' h · ' || p_reason, 'requestedBy', 'admin', 'outletId', outlet, 'at', at, 'note', coalesce(nullif(p_ticket, ''), p_reason),
    'payload', jsonb_build_object('kind', 'support_access', 'tenantId', p_tenant, 'hours', p_hours, 'ticketId', p_ticket)), at, true, null);
  perform private.notice(p_tenant, 'Support access requested', 'warn', array['owner'], 'BorNiz support asks for ' || p_hours || ' h of read access: ' || p_reason || '. Grant or deny it in Approvals with your approval PIN.');
end $$;

create or replace function public.bn_admin_request_access(p_tenant uuid, p_hours int, p_reason text, p_ticket text default null) returns text
language plpgsql security definer set search_path = public, private as $$
declare id text := 'sa' || left(replace(gen_random_uuid()::text, '-', ''), 16);
begin
  if not public.bn_is_platform_admin() then raise exception 'BN070 BorNiz staff only'; end if;
  if p_hours not between 1 and 8 or length(coalesce(p_reason, '')) < 3 then raise exception 'BN071 Say why, for 1 to 8 hours'; end if;
  if not exists (select 1 from public.tenants where public.tenants.id = p_tenant) then raise exception 'BN072 Business not found'; end if;
  insert into private.platform_records (kind, id, data, updated_by) values ('access', id, jsonb_build_object('tenant', p_tenant, 'hours', p_hours, 'reason', p_reason, 'ticket', p_ticket), auth.uid());
  perform private.admin_log('support.requested', p_hours || ' h · ' || p_reason, p_tenant);
  if (select cell from public.tenants where public.tenants.id = p_tenant) is null then perform private.support_request(p_tenant, id, p_hours, p_reason, p_ticket); end if;
  return id; -- a moved business: the API places the request in its database (bn_server_support_request)
end $$;
create or replace function public.bn_server_support_request(p_secret text, p_tenant uuid, p_id text, p_hours int, p_reason text, p_ticket text default null) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  if not private.server_secret_ok(p_secret) then raise exception 'BN016 Bad server secret'; end if;
  perform private.support_request(p_tenant, p_id, p_hours, p_reason, p_ticket);
end $$;

-- the latest request and where it stands: requested · active (until) · denied · expired · ended
create or replace function private.support_state(p_tenant uuid) returns jsonb language sql stable security definer set search_path = public, private as $$
  select coalesce((select jsonb_build_object('id', a.id, 'hours', (a.data->'payload'->>'hours')::int, 'reason', a.data->>'title', 'at', (a.data->>'at')::bigint,
      'until', case when a.data->>'status' = 'approved' then coalesce((a.data->>'decidedAt')::bigint, (a.data->>'at')::bigint) + (a.data->'payload'->>'hours')::int * 3600000 end,
      'state', case when exists (select 1 from public.docs e where e.tenant_id = p_tenant and e.coll = 'support' and e.id = a.id) then 'ended'
        when a.data->>'status' = 'waiting' then 'requested' when a.data->>'status' <> 'approved' then 'denied'
        when coalesce((a.data->>'decidedAt')::bigint, (a.data->>'at')::bigint) + (a.data->'payload'->>'hours')::int * 3600000 > (extract(epoch from now()) * 1000)::bigint then 'active'
        else 'expired' end)
    from public.docs a where a.tenant_id = p_tenant and a.coll = 'approvals' and a.data->>'type' = 'perm' and a.data->'payload'->>'kind' = 'support_access'
    order by (a.data->>'at')::bigint desc limit 1), jsonb_build_object('state', 'none')) $$;
create or replace function public.bn_server_support_state(p_secret text, p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not private.server_secret_ok(p_secret) then raise exception 'BN016 Bad server secret'; end if;
  return private.support_state(p_tenant);
end $$;
-- read-only while granted: the set-up support works on, never money, people's data or secrets (those live in private tables)
create or replace function public.bn_server_support_docs(p_secret text, p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not private.server_secret_ok(p_secret) then raise exception 'BN016 Bad server secret'; end if;
  if private.support_state(p_tenant)->>'state' <> 'active' then raise exception 'BN075 The owner has not granted support access, or it ended'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('coll', coll, 'id', id, 'data', data) order by coll, id) from public.docs
    where tenant_id = p_tenant and (coll in ('outlets', 'devices', 'integrations', 'settings') or (coll = '_meta' and id in ('tenant', 'theme')))), '[]');
end $$;
create or replace function public.bn_server_support_end(p_secret text, p_tenant uuid, p_id text) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  if not private.server_secret_ok(p_secret) then raise exception 'BN016 Bad server secret'; end if;
  insert into public.docs (tenant_id, coll, id, data, t, open, updated_by) values (p_tenant, 'support', p_id, jsonb_build_object('id', p_id, 'ended', true), (extract(epoch from now()) * 1000)::bigint, false, null)
  on conflict do nothing;
  insert into public.audit_log (tenant_id, actor, action, subject) values (p_tenant, 'admin', 'support_access.ended', p_id);
end $$;
revoke execute on function private.support_request(uuid, text, int, text, text), private.support_state(uuid) from public, anon, authenticated;
revoke execute on function public.bn_admin_request_access(uuid, int, text, text) from public, anon;
grant execute on function public.bn_admin_request_access(uuid, int, text, text) to authenticated;
grant execute on function public.bn_server_support_request(text, uuid, text, int, text, text), public.bn_server_support_state(text, uuid), public.bn_server_support_docs(text, uuid),
  public.bn_server_support_end(text, uuid, text) to anon, authenticated;
