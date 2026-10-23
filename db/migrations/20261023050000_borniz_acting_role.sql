-- Who is acting on this device, in the business's own database: the staff member signed in by PIN on it (the same
-- session every write carries as p_staff, bn_staff_login), else the account's own role. The API asks this before the
-- account things it keeps on the platform (support tickets, BorNiz invoices), so a cashier on the owner's browser is a
-- cashier and an owner who signs in by PIN on a shared register is the owner. A session that is not this account's or
-- has ended answers nothing (refused), never the account's role.
create or replace function public.bn_acting_role(p_tenant uuid, p_staff uuid default null) returns text
language sql stable security definer set search_path = public, private as $$
  select case when p_staff is null then public.bn_member_role(p_tenant)
    else (select ss.role from private.staff_sessions ss where ss.token = p_staff and ss.user_id = auth.uid() and ss.tenant_id = p_tenant
      and ss.expires_at > now() - interval '8 hours') end $$;
revoke execute on function public.bn_acting_role(uuid, uuid) from public, anon;
grant execute on function public.bn_acting_role(uuid, uuid) to authenticated;

-- ticket errors get their own codes: BN080–BN082 already mean shared-register set-up, register code and PIN session
create or replace function public.bn_server_open_ticket(p_secret text, p_tenant uuid, p_user uuid, p_subject text, p_body text, p_priority text default 'normal') returns text
language plpgsql security definer set search_path = public, private as $$
declare id text := 'TK-' || upper(left(replace(gen_random_uuid()::text, '-', ''), 8));
begin
  if not private.server_secret_ok(p_secret) then raise exception 'BN016 Bad server secret'; end if;
  if not exists (select 1 from public.tenants where public.tenants.id = p_tenant) then raise exception 'BN072 Business not found'; end if;
  if length(trim(coalesce(p_subject, ''))) < 3 or length(trim(coalesce(p_body, ''))) < 3 or length(p_subject) > 120 or length(p_body) > 4000 then raise exception 'BN085 Say what happened'; end if;
  perform pg_advisory_xact_lock(hashtext('tickets:' || p_tenant)); -- two people sending at once can't both pass the cap
  if (select count(*) from private.platform_records where kind = 'ticket' and data->>'b' = p_tenant::text and data->>'d' <> 'solved') >= 10 then
    raise exception 'BN086 10 tickets are already open. BorNiz support answers them first.';
  end if;
  insert into private.platform_records (kind, id, data, updated_by) values ('ticket', id, jsonb_build_object('id', id, 'a', trim(p_subject), 'b', p_tenant::text,
    'c', case when p_priority = 'high' then 'high' else 'normal' end, 'd', 'open', 'e', '', 'at', (extract(epoch from now()) * 1000)::bigint, 'm', trim(p_body),
    'by', (select email from auth.users where auth.users.id = p_user)), p_user);
  insert into private.platform_audit (user_id, tenant_id, action, subject) values (p_user, p_tenant, 'ticket.opened', id || ' · ' || trim(p_subject));
  return id;
end $$;
