-- Who is acting, checked as strictly as a write and then some: the account must still be a member of the business, the
-- PIN session must not have ended (no offline grace: tickets and invoices are live calls), and the employee must still be
-- active, with their role from the employee record now (a demotion counts at once). The answer also names them, so a
-- ticket sent from a shared register says who sent it. {ended: true} = sign in with the PIN again.
drop function if exists public.bn_acting_role(uuid, uuid);
create function public.bn_acting_role(p_tenant uuid, p_staff uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare account text := public.bn_member_role(p_tenant); ss private.staff_sessions; e jsonb;
begin
  if account is null then return null; end if;
  if p_staff is null then return jsonb_build_object('role', account); end if;
  select * into ss from private.staff_sessions where token = p_staff and user_id = auth.uid() and tenant_id = p_tenant and expires_at > now();
  e := case when ss.token is not null then private.doc(p_tenant, 'employees', ss.employee_id) end;
  if e is null or e->>'active' = 'false' then return jsonb_build_object('ended', true); end if;
  return jsonb_build_object('role', coalesce(e->>'role', ss.role), 'name', e->>'name');
end $$;
revoke execute on function public.bn_acting_role(uuid, uuid) from public, anon;
grant execute on function public.bn_acting_role(uuid, uuid) to authenticated;

-- the ticket names its sender: the staff member at the device, else the account's email
drop function if exists public.bn_server_open_ticket(text, uuid, uuid, text, text, text);
create function public.bn_server_open_ticket(p_secret text, p_tenant uuid, p_user uuid, p_subject text, p_body text, p_priority text default 'normal', p_by text default null) returns text
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
    'by', coalesce(nullif(trim(p_by), ''), (select email from auth.users where auth.users.id = p_user))), p_user);
  insert into private.platform_audit (user_id, tenant_id, action, subject) values (p_user, p_tenant, 'ticket.opened', id || ' · ' || trim(p_subject) || coalesce(' · ' || nullif(trim(p_by), ''), ''));
  return id;
end $$;
revoke execute on function public.bn_server_open_ticket(text, uuid, uuid, text, text, text, text) from public;
grant execute on function public.bn_server_open_ticket(text, uuid, uuid, text, text, text, text) to anon, authenticated;
