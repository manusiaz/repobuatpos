-- Monthly or yearly (spec Checkout: "Yearly · save 17%", 2 months free; bn-authority: BorNiz billing is automatic). The owner
-- asks for a plan from Checkout (a support ticket: payment is by transfer until BorNiz connects its own gateway); BorNiz
-- staff set the plan and the cycle in the console; the worker bills it (src/data/billing.ts invoiceFor):
--   tenants.billing_cycle   'monthly' (default) or 'yearly'
--   tenants.cycle_from      'YYYY-MM' the first month the cycle bills: yearly starts the month after it is set (this month
--                           was billed monthly); back to monthly starts after the paid year ends, never billing a month twice
alter table public.tenants add column if not exists billing_cycle text not null default 'monthly';
alter table public.tenants add column if not exists cycle_from text;
do $$ begin alter table public.tenants add constraint tenants_billing_cycle_known check (billing_cycle in ('monthly', 'yearly') and (cycle_from is null or cycle_from ~ '^\d{4}-\d{2}$')); exception when duplicate_object then null; end $$;

drop function if exists public.bn_admin_set_plan(uuid, text);
create or replace function public.bn_admin_set_plan(p_tenant uuid, p_plan text, p_cycle text default null) returns void
language plpgsql security definer set search_path = public, private as $$
declare t public.tenants; now_m date := date_trunc('month', now() at time zone 'Asia/Jakarta')::date; a date; k int;
begin
  if not public.bn_is_platform_admin() then raise exception 'BN070 BorNiz staff only'; end if;
  if p_plan not in ('free', 'basic', 'pro', 'enterprise') then raise exception 'BN071 Unknown plan %', p_plan; end if;
  if p_cycle is not null and p_cycle not in ('monthly', 'yearly') then raise exception 'BN071 Unknown billing cycle %', p_cycle; end if;
  select * into t from public.tenants where id = p_tenant for update;
  if t.id is null then raise exception 'BN072 Business not found'; end if;
  update public.tenants set plan = p_plan, trial_until = null where id = p_tenant; -- a plan set by BorNiz is paid: the trial ends
  if p_cycle is not null and p_cycle <> t.billing_cycle then
    if p_cycle = 'yearly' then
      update public.tenants set billing_cycle = 'yearly', cycle_from = to_char(now_m + interval '1 month', 'YYYY-MM') where id = p_tenant;
    else -- the paid year runs to its end
      a := to_date(coalesce(t.cycle_from, to_char(now_m, 'YYYY-MM')) || '-01', 'YYYY-MM-DD');
      k := greatest(0, (extract(year from age(now_m, a)) * 12 + extract(month from age(now_m, a)))::int);
      update public.tenants set billing_cycle = 'monthly', cycle_from = to_char(case when a > now_m then a else a + make_interval(months => (k / 12 + 1) * 12) end, 'YYYY-MM') where id = p_tenant;
    end if;
  end if;
  if t.cell is null then
    insert into public.audit_log (tenant_id, actor, action, subject, user_id) values (p_tenant, 'admin', 'tenant.plan', p_plan || coalesce(' · ' || p_cycle, ''), auth.uid());
  end if;
  perform private.admin_log('tenant.plan', p_plan || coalesce(' · ' || p_cycle, ''), p_tenant);
end $$;
revoke execute on function public.bn_admin_set_plan(uuid, text, text) from public, anon;
grant execute on function public.bn_admin_set_plan(uuid, text, text) to authenticated;

create or replace function public.bn_server_tenants(p_secret text) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not private.server_secret_ok(p_secret) then raise exception 'BN016 Bad server secret'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'slug', slug, 'name', name, 'plan', public.bn_plan_now(plan, trial_until), 'cell', cell,
      'trial', trial_until is not null and trial_until > now(), 'unpaidSince', private.unpaid_since(id), 'hold', billing_hold,
      'cycle', billing_cycle, 'cycleFrom', cycle_from) order by created_at)
    from public.tenants where status <> 'suspended'), '[]'); -- a paused business gets no automation
end $$;

create or replace function public.bn_admin_tenants() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not public.bn_is_platform_admin() then raise exception 'BN070 BorNiz staff only'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'slug', t.slug, 'name', t.name, 'plan', t.plan, 'cell', t.cell, 'status', t.status,
      'trialUntil', (extract(epoch from t.trial_until) * 1000)::bigint, 'cycle', t.billing_cycle, 'cycleFrom', t.cycle_from, 'planNow', public.bn_plan_now(t.plan, t.trial_until),
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
