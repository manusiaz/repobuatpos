-- The plan on the server (src/screens/public/plans.ts PLANS + FEATURE_PLAN, the "Plan limit reached" alert):
--   BN076 a new outlet, register (per outlet), kitchen display, kiosk or customer display beyond what the plan BorNiz set
--         includes (bn_plan_now: an ended trial is Free). What a business already has keeps working after a downgrade;
--         only adding more is refused, so the alert asks them to upgrade.
create or replace function private.plan_room(p_plan text, p_what text) returns numeric language sql immutable as $$
  select case p_what
    when 'outlets' then case p_plan when 'free' then 1 when 'basic' then 1 when 'pro' then 3 end
    when 'pos' then case p_plan when 'free' then 1 when 'basic' then 3 when 'pro' then 10 end
    when 'display' then case p_plan when 'free' then 0 end
    when 'kds' then case p_plan when 'free' then 0 when 'basic' then 0 end
    when 'kiosk' then case p_plan when 'free' then 0 when 'basic' then 0 end
  end $$; -- null = no limit

create or replace function private.plan_rules() returns trigger language plpgsql security definer set search_path = public, private as $$
declare plan text; what text; room numeric; have int; -- a moved business (cell set): docs_tenant_here refuses with BN050
begin
  if new.coll not in ('outlets', 'devices') or coalesce(current_setting('bn.gateway', true), '') = 'on' or new.updated_by is null then return new; end if;
  if tg_op = 'INSERT' and exists (select 1 from public.docs where tenant_id = new.tenant_id and coll = new.coll and id = new.id) then return new; end if;
  what := case when new.coll = 'outlets' then 'outlets' else new.data->>'kind' end;
  -- an existing device counts again only when it becomes another kind or moves outlet
  if tg_op = 'UPDATE' and (new.coll = 'outlets' or (new.data->>'kind' is not distinct from old.data->>'kind' and new.data->>'outletId' is not distinct from old.data->>'outletId')) then return new; end if;
  select public.bn_plan_now(t.plan, t.trial_until) into plan from public.tenants t where t.id = new.tenant_id and t.cell is null;
  room := private.plan_room(plan, what);
  if room is null then return new; end if;
  select count(*) into have from public.docs d where d.tenant_id = new.tenant_id and d.coll = new.coll and d.id <> new.id
    and (new.coll = 'outlets' or (d.data->>'kind' = what and (what <> 'pos' or d.data->>'outletId' = new.data->>'outletId')));
  -- registers also in all: outlets kept from a trial don't each bring their own (Free stays 1 register)
  if what = 'pos' and have < room and (select count(*) from public.docs d where d.tenant_id = new.tenant_id and d.coll = 'devices' and d.id <> new.id
      and d.data->>'kind' = 'pos') >= room * private.plan_room(plan, 'outlets') then have := room; end if;
  if have >= room then
    raise exception 'BN076 %: %. Upgrade to add more.', initcap(plan), case what when 'outlets' then 'up to ' || room || ' outlet' || case when room > 1 then 's' else '' end
      when 'pos' then 'up to ' || room || ' register' || case when room > 1 then 's' else '' end || ' per outlet'
      when 'kds' then 'no kitchen display' when 'kiosk' then 'no kiosk' else 'no customer display' end;
  end if;
  return new;
end $$;
revoke execute on function private.plan_rules(), private.plan_room(text, text) from public, anon, authenticated;
drop trigger if exists docs_plan_rules on public.docs;
create trigger docs_plan_rules before insert or update on public.docs for each row execute function private.plan_rules();
