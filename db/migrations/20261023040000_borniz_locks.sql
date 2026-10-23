-- plan_rules (20261021000000) counted without a lock, so two adds at once both saw room for one: it now counts under one
-- lock per business (outlets and devices alike, so a write touching both cannot deadlock). The 10-open-tickets cap too.
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
  -- one add at a time per business (one lock for outlets and devices alike, so a write touching both can't deadlock)
  perform pg_advisory_xact_lock(hashtext('plan:' || new.tenant_id));
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

create or replace function public.bn_server_open_ticket(p_secret text, p_tenant uuid, p_user uuid, p_subject text, p_body text, p_priority text default 'normal') returns text
language plpgsql security definer set search_path = public, private as $$
declare id text := 'TK-' || upper(left(replace(gen_random_uuid()::text, '-', ''), 8));
begin
  if not private.server_secret_ok(p_secret) then raise exception 'BN016 Bad server secret'; end if;
  if not exists (select 1 from public.tenants where public.tenants.id = p_tenant) then raise exception 'BN072 Business not found'; end if;
  if length(trim(coalesce(p_subject, ''))) < 3 or length(trim(coalesce(p_body, ''))) < 3 or length(p_subject) > 120 or length(p_body) > 4000 then raise exception 'BN081 Say what happened'; end if;
  perform pg_advisory_xact_lock(hashtext('tickets:' || p_tenant)); -- two people sending at once can't both pass the cap
  if (select count(*) from private.platform_records where kind = 'ticket' and data->>'b' = p_tenant::text and data->>'d' <> 'solved') >= 10 then
    raise exception 'BN082 10 tickets are already open. BorNiz support answers them first.';
  end if;
  insert into private.platform_records (kind, id, data, updated_by) values ('ticket', id, jsonb_build_object('id', id, 'a', trim(p_subject), 'b', p_tenant::text,
    'c', case when p_priority = 'high' then 'high' else 'normal' end, 'd', 'open', 'e', '', 'at', (extract(epoch from now()) * 1000)::bigint, 'm', trim(p_body),
    'by', (select email from auth.users where auth.users.id = p_user)), p_user);
  insert into private.platform_audit (user_id, tenant_id, action, subject) values (p_user, p_tenant, 'ticket.opened', id || ' · ' || trim(p_subject));
  return id;
end $$;
