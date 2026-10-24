-- Review of 20261024030000:
--   a yearly cycle never bills a month already paid: to yearly while a paid year still runs starts when it ends; from Free or
--     a trial (nothing billed this month) it starts this month; otherwise next month (this month was billed monthly)
--   while a paid year runs (yearly, or monthly waiting for it to end) the plan changes only at its renewal (BN089): no
--     proration, so an upgrade is not free for months and a downgrade is not a refund
--   yearly always has its first month
--   bn_end_trial: the owner stops their own running trial and is on Free at once (the trial stays used)
do $$ begin alter table public.tenants add constraint tenants_yearly_has_start check (billing_cycle = 'monthly' or cycle_from is not null); exception when duplicate_object then null; end $$;

create or replace function public.bn_admin_set_plan(p_tenant uuid, p_plan text, p_cycle text default null) returns void
language plpgsql security definer set search_path = public, private as $$
declare t public.tenants; now_m date := date_trunc('month', now() at time zone 'Asia/Jakarta')::date; a date; k int; paid_until date; billed_now boolean;
begin
  if not public.bn_is_platform_admin() then raise exception 'BN070 BorNiz staff only'; end if;
  if p_plan not in ('free', 'basic', 'pro', 'enterprise') then raise exception 'BN071 Unknown plan %', p_plan; end if;
  if p_cycle is not null and p_cycle not in ('monthly', 'yearly') then raise exception 'BN071 Unknown billing cycle %', p_cycle; end if;
  select * into t from public.tenants where id = p_tenant for update;
  if t.id is null then raise exception 'BN072 Business not found'; end if;
  -- the first month after the paid year, if one runs now (null: none)
  a := case when t.cycle_from is not null then to_date(t.cycle_from || '-01', 'YYYY-MM-DD') end;
  paid_until := case
    when t.billing_cycle = 'yearly' and a <= now_m then a + make_interval(months => ((extract(year from age(now_m, a)) * 12 + extract(month from age(now_m, a)))::int / 12 + 1) * 12)
    when t.billing_cycle = 'monthly' and a > now_m then a end;
  if paid_until is not null and p_plan <> t.plan then
    raise exception 'BN089 The paid year runs until %: change the plan at its renewal', to_char(paid_until - interval '1 month', 'YYYY-MM');
  end if;
  update public.tenants set plan = p_plan, trial_until = null where id = p_tenant; -- a plan set by BorNiz is paid: the trial ends
  if p_cycle is not null and p_cycle <> t.billing_cycle then
    if p_cycle = 'yearly' then
      billed_now := exists (select 1 from private.platform_records where kind = 'invoice' and id = 'inv-' || p_tenant || '-' || to_char(now_m, 'YYYY-MM'));
      update public.tenants set billing_cycle = 'yearly', cycle_from = to_char(coalesce(paid_until, case when billed_now then now_m + interval '1 month' else now_m end), 'YYYY-MM') where id = p_tenant;
    else -- the paid year runs to its end; a year not started yet never starts
      update public.tenants set billing_cycle = 'monthly', cycle_from = case when a > now_m then to_char(now_m + interval '1 month', 'YYYY-MM') else to_char(paid_until, 'YYYY-MM') end where id = p_tenant;
    end if;
  end if;
  if t.cell is null then
    insert into public.audit_log (tenant_id, actor, action, subject, user_id) values (p_tenant, 'admin', 'tenant.plan', p_plan || coalesce(' · ' || p_cycle, ''), auth.uid());
  end if;
  perform private.admin_log('tenant.plan', p_plan || coalesce(' · ' || p_cycle, ''), p_tenant);
end $$;

create or replace function public.bn_end_trial(p_tenant uuid) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  if public.bn_member_role(p_tenant) is distinct from 'owner' then raise exception 'BN044 Only the owner chooses the plan'; end if;
  update public.tenants set plan = 'free', trial_until = now() where id = p_tenant and trial_until > now();
  if not found then raise exception 'BN074 No trial is running'; end if;
  insert into public.audit_log (tenant_id, actor, action, subject, user_id) values (p_tenant, 'owner', 'tenant.trial_ended', 'free', auth.uid());
end $$;
revoke execute on function public.bn_end_trial(uuid) from public, anon;
grant execute on function public.bn_end_trial(uuid) to authenticated;
