-- One answer to "who is at this device" (review round 6): the PIN session lookup lived in bn_write and bn_acting_role
-- with different rules, so a demoted manager was a cashier to the ticket API but still a manager to writes for up to
-- 24 h. private.staff_session is the one lookup: this account's session for this business, not ended (writes allow an
-- 8 h grace so an offline register can replay its queue; live calls none), the employee still active, and the role
-- their record has now.
create or replace function private.staff_session(p_tenant uuid, p_staff uuid, p_grace interval default interval '0') returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare ss private.staff_sessions; e jsonb;
begin
  select * into ss from private.staff_sessions where token = p_staff and user_id = auth.uid() and tenant_id = p_tenant and expires_at > now() - p_grace;
  e := case when ss.token is not null then private.doc(p_tenant, 'employees', ss.employee_id) end;
  if e is null or e->>'active' = 'false' then return null; end if;
  return jsonb_build_object('employee', ss.employee_id, 'role', coalesce(e->>'role', ss.role), 'name', e->>'name');
end $$;
revoke execute on function private.staff_session(uuid, uuid, interval) from public, anon, authenticated;

create or replace function public.bn_write(p_tenant uuid, p_ops jsonb, p_action text, p_actor text, p_subject text default null, p_outlet text default null,
  p_op text default null, p_staff uuid default null)
returns int language plpgsql security definer set search_path = public, private as $$
declare n int; st jsonb; who text := public.bn_member_role(p_tenant); ops jsonb;
begin
  if who is null then raise exception 'BN011 Not a member of this business'; end if;
  if p_op is not null then
    insert into private.write_ops (tenant_id, op_id) values (p_tenant, p_op) on conflict do nothing;
    if not found then return 0; end if;
    if random() < 0.01 then delete from private.write_ops where tenant_id = p_tenant and at < now() - interval '14 days'; end if;
  end if;
  if p_staff is not null then
    st := private.staff_session(p_tenant, p_staff, interval '8 hours'); -- 8 h grace: an offline register replays its queue when back online
    if st is null then raise exception 'BN082 Your session ended. Sign in with your PIN again.'; end if;
    perform set_config('bn.staff_role', st->>'role', true);
  elsif who = 'device' then
    return public.bn_guest_write(p_tenant, p_ops); -- a shared register with nobody signed in is a kiosk / customer display
  end if;
  -- approvals first, so a decision and what it applies (refund, void) land in one write in the right order
  select coalesce(jsonb_agg(x order by (x->>'coll') <> 'approvals'), '[]') into ops from jsonb_array_elements(p_ops) x;
  n := private.apply_ops(p_tenant, ops, auth.uid());
  insert into public.audit_log (tenant_id, actor, action, subject, outlet_id) values (p_tenant, coalesce(st->>'employee', p_actor), p_action, p_subject, p_outlet);
  return n;
end $$;

create or replace function public.bn_acting_role(p_tenant uuid, p_staff uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare account text := public.bn_member_role(p_tenant); st jsonb;
begin
  if account is null then return null; end if;
  if p_staff is null then return jsonb_build_object('role', account, 'email', (select email from auth.users where id = auth.uid())); end if;
  st := private.staff_session(p_tenant, p_staff);
  return coalesce(st || jsonb_build_object('email', (select email from auth.users where id = auth.uid())), jsonb_build_object('ended', true));
end $$;
