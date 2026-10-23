-- Support tickets from a business (Help › Contact BorNiz support) into the super admin console (Support tickets):
--   bn_open_ticket  owner or manager of the business; normal or high (only BorNiz escalates to urgent); at most 10
--                   open at once; kept on the platform with who opened it, audited
--   bn_my_tickets   the business's own tickets and where they stand (owner or manager)
create or replace function public.bn_open_ticket(p_tenant uuid, p_subject text, p_body text, p_priority text default 'normal') returns text
language plpgsql security definer set search_path = public, private as $$
declare id text := 'TK-' || upper(left(replace(gen_random_uuid()::text, '-', ''), 8));
begin
  if coalesce(public.bn_member_role(p_tenant), '') not in ('owner', 'manager') then raise exception 'BN080 Owner or manager only'; end if;
  if length(trim(coalesce(p_subject, ''))) < 3 or length(trim(coalesce(p_body, ''))) < 3 or length(p_subject) > 120 or length(p_body) > 4000 then raise exception 'BN081 Say what happened'; end if;
  if (select count(*) from private.platform_records where kind = 'ticket' and data->>'b' = p_tenant::text and data->>'d' <> 'solved') >= 10 then
    raise exception 'BN082 10 tickets are already open. BorNiz support answers them first.';
  end if;
  insert into private.platform_records (kind, id, data, updated_by) values ('ticket', id, jsonb_build_object('id', id, 'a', trim(p_subject), 'b', p_tenant::text,
    'c', case when p_priority = 'high' then 'high' else 'normal' end, 'd', 'open', 'e', '', 'at', (extract(epoch from now()) * 1000)::bigint, 'm', trim(p_body),
    'by', (select email from auth.users where auth.users.id = auth.uid())), auth.uid());
  insert into private.platform_audit (user_id, tenant_id, action, subject) values (auth.uid(), p_tenant, 'ticket.opened', id || ' · ' || trim(p_subject));
  return id;
end $$;

create or replace function public.bn_my_tickets(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if coalesce(public.bn_member_role(p_tenant), '') not in ('owner', 'manager') then raise exception 'BN080 Owner or manager only'; end if;
  return coalesce((select jsonb_agg(data order by (data->>'at')::bigint desc) from private.platform_records where kind = 'ticket' and data->>'b' = p_tenant::text), '[]');
end $$;
revoke execute on function public.bn_open_ticket(uuid, text, text, text), public.bn_my_tickets(uuid) from public, anon;
grant execute on function public.bn_open_ticket(uuid, text, text, text), public.bn_my_tickets(uuid) to authenticated;
