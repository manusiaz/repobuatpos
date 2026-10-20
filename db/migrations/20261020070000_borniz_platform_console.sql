-- The super admin console keeps its work on the server (owner decision Oct 2026: "ya", build it), and what it sets is read:
--   private.platform_records  invoices, tickets, feature flags, releases, platform settings (plan prices, default theme)
--                             and per-business notes (enterprise price, white-label), written by bn_admin_put
--   private.platform_audit    every console action with the BorNiz staff member who did it (bn_admin_audit)
--   tenants.status            'suspended' pauses a business: no document is written (BN073), the QR menu and kiosk are off,
--                             the worker skips it; reads stay so the owner can still see and export their data
--   tenants.trial_until       a trial of a paid plan: the owner starts it once at sign-up (bn_start_trial), BorNiz can
--                             extend it; when it ends unpaid the business is on Free (bn_plan_now); setting a plan ends it
-- A business on its own database (cell) gets the same row there (bn_server_tenant_sync, called by the API after each change).
alter table public.tenants add column if not exists status text not null default 'active';
alter table public.tenants add column if not exists trial_until timestamptz;
do $$ begin alter table public.tenants add constraint tenants_status_known check (status in ('active', 'suspended')); exception when duplicate_object then null; end $$;

create or replace function public.bn_plan_now(p_plan text, p_trial_until timestamptz) returns text language sql stable as $$
  select case when p_trial_until is not null and p_trial_until < now() then 'free' else p_plan end $$;
grant execute on function public.bn_plan_now(text, timestamptz) to anon, authenticated;

create table if not exists private.platform_records (kind text not null, id text not null, data jsonb not null, updated_at timestamptz not null default now(), updated_by uuid,
  primary key (kind, id));
create table if not exists private.platform_audit (id bigserial primary key, at timestamptz not null default now(), user_id uuid, tenant_id uuid, action text not null, subject text);
revoke all on private.platform_records, private.platform_audit from public, anon, authenticated;

create or replace function private.admin_log(p_action text, p_subject text, p_tenant uuid default null) returns void language sql security definer set search_path = public, private as $$
  insert into private.platform_audit (user_id, tenant_id, action, subject) values (auth.uid(), p_tenant, p_action, p_subject) $$;

create or replace function public.bn_admin_records() returns jsonb language plpgsql stable security definer set search_path = public, private as $$
begin
  if not public.bn_is_platform_admin() then raise exception 'BN070 BorNiz staff only'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'id', id, 'data', data) order by kind, updated_at desc) from private.platform_records), '[]');
end $$;
create or replace function public.bn_admin_put(p_kind text, p_id text, p_data jsonb, p_action text, p_subject text default null) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  if not public.bn_is_platform_admin() then raise exception 'BN070 BorNiz staff only'; end if;
  if p_kind not in ('invoice', 'ticket', 'flag', 'release', 'setting', 'tenant') or coalesce(p_id, '') = '' then raise exception 'BN071 Unknown record %', p_kind; end if;
  if p_data is null then delete from private.platform_records where kind = p_kind and id = p_id;
  else insert into private.platform_records (kind, id, data, updated_by) values (p_kind, p_id, p_data, auth.uid())
    on conflict (kind, id) do update set data = excluded.data, updated_at = now(), updated_by = excluded.updated_by; end if;
  perform private.admin_log(coalesce(p_action, p_kind || '.saved'), coalesce(p_subject, p_id), case when p_kind = 'tenant' and p_id ~ '^[0-9a-f-]{36}$' then p_id::uuid end);
end $$;
create or replace function public.bn_admin_note(p_action text, p_subject text) returns void language plpgsql security definer set search_path = public, private as $$
begin
  if not public.bn_is_platform_admin() then raise exception 'BN070 BorNiz staff only'; end if;
  perform private.admin_log(p_action, p_subject); -- reminders sent, exports: nothing changes, it is still on the record
end $$;
create or replace function public.bn_admin_audit(p_limit int default 500) returns jsonb language plpgsql stable security definer set search_path = public, private as $$
begin
  if not public.bn_is_platform_admin() then raise exception 'BN070 BorNiz staff only'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'at', (extract(epoch from a.at) * 1000)::bigint, 'actor', coalesce(u.email, 'BorNiz'), 'action', a.action, 'subject', a.subject, 'tenantId', a.tenant_id) order by a.id desc)
    from (select * from private.platform_audit order by id desc limit greatest(1, least(p_limit, 5000))) a left join auth.users u on u.id = a.user_id), '[]');
end $$;

-- the business row on its own database follows the registry (plan, status, trial)
create or replace function public.bn_server_tenant_sync(p_secret text, p_tenant uuid, p_row jsonb) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  if not private.server_secret_ok(p_secret) then raise exception 'BN016 Bad server secret'; end if;
  update public.tenants set plan = p_row->>'plan', status = p_row->>'status', trial_until = case when p_row ? 'trial_until' and p_row->>'trial_until' is not null then (p_row->>'trial_until')::timestamptz end
  where id = p_tenant;
  insert into public.audit_log (tenant_id, actor, action, subject) values (p_tenant, 'admin', 'tenant.synced', p_row->>'plan' || ' · ' || (p_row->>'status'));
end $$;
create or replace function public.bn_server_tenant_row(p_secret text, p_tenant uuid) returns jsonb language plpgsql stable security definer set search_path = public, private as $$
begin
  if not private.server_secret_ok(p_secret) then raise exception 'BN016 Bad server secret'; end if;
  return (select jsonb_build_object('plan', plan, 'status', status, 'trial_until', trial_until, 'cell', cell) from public.tenants where id = p_tenant);
end $$;

create or replace function public.bn_admin_set_plan(p_tenant uuid, p_plan text) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  if not public.bn_is_platform_admin() then raise exception 'BN070 BorNiz staff only'; end if;
  if p_plan not in ('free', 'basic', 'pro', 'enterprise') then raise exception 'BN071 Unknown plan %', p_plan; end if;
  update public.tenants set plan = p_plan, trial_until = null where id = p_tenant; -- a plan set by BorNiz is paid: the trial ends
  if not found then raise exception 'BN072 Business not found'; end if;
  if (select cell from public.tenants where id = p_tenant) is null then
    insert into public.audit_log (tenant_id, actor, action, subject, user_id) values (p_tenant, 'admin', 'tenant.plan', p_plan, auth.uid());
  end if;
  perform private.admin_log('tenant.plan', p_plan, p_tenant);
end $$;
create or replace function public.bn_admin_set_status(p_tenant uuid, p_status text, p_reason text) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  if not public.bn_is_platform_admin() then raise exception 'BN070 BorNiz staff only'; end if;
  if p_status not in ('active', 'suspended') then raise exception 'BN071 Unknown status %', p_status; end if;
  update public.tenants set status = p_status where id = p_tenant;
  if not found then raise exception 'BN072 Business not found'; end if;
  if (select cell from public.tenants where id = p_tenant) is null then
    insert into public.audit_log (tenant_id, actor, action, subject, user_id) values (p_tenant, 'admin', 'tenant.' || p_status, p_reason, auth.uid());
  end if;
  perform private.admin_log('tenant.' || p_status, p_reason, p_tenant);
end $$;
create or replace function public.bn_admin_set_trial(p_tenant uuid, p_until bigint) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  if not public.bn_is_platform_admin() then raise exception 'BN070 BorNiz staff only'; end if;
  update public.tenants set trial_until = to_timestamp(p_until / 1000.0) where id = p_tenant and trial_until is not null;
  if not found then raise exception 'BN074 This business has no trial to extend'; end if;
  perform private.admin_log('tenant.trial_extended', to_char(to_timestamp(p_until / 1000.0), 'YYYY-MM-DD'), p_tenant);
end $$;
-- the owner starts a trial of a paid plan once, at sign-up ("no card needed now")
create or replace function public.bn_start_trial(p_tenant uuid, p_plan text, p_days int default 14) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare t public.tenants;
begin
  if public.bn_member_role(p_tenant) is distinct from 'owner' then raise exception 'BN044 Only the owner chooses the plan'; end if;
  if p_plan not in ('basic', 'pro') or p_days not between 1 and 30 then raise exception 'BN071 Unknown plan %', p_plan; end if;
  select * into t from public.tenants where id = p_tenant for update;
  if t.plan <> 'free' or t.trial_until is not null then raise exception 'BN074 The trial is used once, on a business still on Free'; end if;
  update public.tenants set plan = p_plan, trial_until = now() + make_interval(days => p_days) where id = p_tenant returning * into t;
  insert into public.audit_log (tenant_id, actor, action, subject, user_id) values (p_tenant, 'owner', 'tenant.trial', p_plan, auth.uid());
  return jsonb_build_object('plan', t.plan, 'trialUntil', (extract(epoch from t.trial_until) * 1000)::bigint);
end $$;
revoke execute on function public.bn_admin_records(), public.bn_admin_note(text, text), public.bn_admin_put(text, text, jsonb, text, text), public.bn_admin_audit(int), public.bn_admin_set_status(uuid, text, text),
  public.bn_admin_set_trial(uuid, bigint), public.bn_start_trial(uuid, text, int), public.bn_server_tenant_sync(text, uuid, jsonb), public.bn_server_tenant_row(text, uuid), private.admin_log(text, text, uuid) from public, anon;
grant execute on function public.bn_admin_records(), public.bn_admin_note(text, text), public.bn_admin_put(text, text, jsonb, text, text), public.bn_admin_audit(int), public.bn_admin_set_status(uuid, text, text),
  public.bn_admin_set_trial(uuid, bigint), public.bn_start_trial(uuid, text, int), public.bn_server_tenant_sync(text, uuid, jsonb), public.bn_server_tenant_row(text, uuid) to authenticated;
grant execute on function public.bn_server_tenant_sync(text, uuid, jsonb), public.bn_server_tenant_row(text, uuid) to anon;

-- a paused business writes nothing (the gateway may still record money a guest already paid)
create or replace function private.paused_rules() returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if coalesce(current_setting('bn.gateway', true), '') <> 'on' and exists (select 1 from public.tenants where id = coalesce(new.tenant_id, old.tenant_id) and status = 'suspended') then
    raise exception 'BN073 This business is paused by BorNiz. Contact BorNiz support.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke execute on function private.paused_rules() from public, anon, authenticated;
drop trigger if exists docs_paused on public.docs;
create trigger docs_paused before insert or update or delete on public.docs for each row execute function private.paused_rules();

create or replace function public.bn_server_tenants(p_secret text) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not private.server_secret_ok(p_secret) then raise exception 'BN016 Bad server secret'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'slug', slug, 'name', name, 'plan', public.bn_plan_now(plan, trial_until), 'cell', cell) order by created_at)
    from public.tenants where status <> 'suspended'), '[]'); -- a paused business gets no automation
end $$;

create or replace function public.bn_public_snapshot(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t public.tenants; docs jsonb; portions jsonb;
begin
  select * into t from public.tenants where slug = p_slug;
  if t.id is null or t.status = 'suspended' then return null; end if; -- paused by BorNiz: the menu is not available
  select coalesce(jsonb_agg(jsonb_build_object('coll', d.coll, 'id', d.id, 'data', case when d.coll = 'products' then d.data - 'cost' else d.data end)), '[]') into docs
  from public.docs d where d.tenant_id = t.id and (d.coll in ('outlets','categories','modifierGroups','outletProducts','promos')
    or (d.coll = 'products' and d.data->>'status' = 'live') or (d.coll = '_meta' and d.id in ('tenant','theme','staffBrand','order')));
  with lv as (select data->>'outletId' o, data->>'stockItemId' s, sum((data->>'qty')::numeric) q from public.docs where tenant_id = t.id and coll = 'movements' group by 1, 2),
       rc as (select data->>'productId' p, data->>'stockItemId' s, (data->>'qty')::numeric q from public.docs where tenant_id = t.id and coll = 'recipes' and (data->>'qty')::numeric > 0),
       outs as (select id o from public.docs where tenant_id = t.id and coll = 'outlets'),
       x as (select outs.o, rc.p, greatest(0, least(99, min(floor(coalesce(lv.q, 0) / rc.q + 1e-9)))) n from outs cross join rc left join lv on lv.o = outs.o and lv.s = rc.s group by 1, 2)
  select coalesce(jsonb_agg(jsonb_build_object('outletId', o, 'productId', p, 'n', n)), '[]') into portions from x;
  return jsonb_build_object('tenant', jsonb_build_object('id', t.id, 'slug', t.slug, 'name', t.name, 'plan', public.bn_plan_now(t.plan, t.trial_until)), 'docs', docs, 'portions', portions);
end $$;

create or replace function public.bn_admin_tenants() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not public.bn_is_platform_admin() then raise exception 'BN070 BorNiz staff only'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'slug', t.slug, 'name', t.name, 'plan', t.plan, 'cell', t.cell, 'status', t.status,
      'trialUntil', (extract(epoch from t.trial_until) * 1000)::bigint, 'planNow', public.bn_plan_now(t.plan, t.trial_until),
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

