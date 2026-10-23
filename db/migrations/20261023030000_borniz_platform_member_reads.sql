-- Tickets and invoices live on the platform, but a moved business keeps its members in its own database (a manager
-- invited after the move exists only there). So the API checks the caller's role in the business's database
-- (bn_member_role, routed by p_tenant) and then calls these server functions on the platform; the earlier
-- bn_open_ticket / bn_my_tickets / bn_my_invoices checked the platform's member rows and are dropped.
drop function if exists public.bn_open_ticket(uuid, text, text, text);
drop function if exists public.bn_my_tickets(uuid);
drop function if exists public.bn_my_invoices(uuid);

create or replace function public.bn_server_open_ticket(p_secret text, p_tenant uuid, p_user uuid, p_subject text, p_body text, p_priority text default 'normal') returns text
language plpgsql security definer set search_path = public, private as $$
declare id text := 'TK-' || upper(left(replace(gen_random_uuid()::text, '-', ''), 8));
begin
  if not private.server_secret_ok(p_secret) then raise exception 'BN016 Bad server secret'; end if;
  if not exists (select 1 from public.tenants where public.tenants.id = p_tenant) then raise exception 'BN072 Business not found'; end if;
  if length(trim(coalesce(p_subject, ''))) < 3 or length(trim(coalesce(p_body, ''))) < 3 or length(p_subject) > 120 or length(p_body) > 4000 then raise exception 'BN081 Say what happened'; end if;
  if (select count(*) from private.platform_records where kind = 'ticket' and data->>'b' = p_tenant::text and data->>'d' <> 'solved') >= 10 then
    raise exception 'BN082 10 tickets are already open. BorNiz support answers them first.';
  end if;
  insert into private.platform_records (kind, id, data, updated_by) values ('ticket', id, jsonb_build_object('id', id, 'a', trim(p_subject), 'b', p_tenant::text,
    'c', case when p_priority = 'high' then 'high' else 'normal' end, 'd', 'open', 'e', '', 'at', (extract(epoch from now()) * 1000)::bigint, 'm', trim(p_body),
    'by', (select email from auth.users where auth.users.id = p_user)), p_user);
  insert into private.platform_audit (user_id, tenant_id, action, subject) values (p_user, p_tenant, 'ticket.opened', id || ' · ' || trim(p_subject));
  return id;
end $$;

create or replace function public.bn_server_records_of(p_secret text, p_tenant uuid, p_kind text) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not private.server_secret_ok(p_secret) then raise exception 'BN016 Bad server secret'; end if;
  if p_kind not in ('ticket', 'invoice') then raise exception 'BN083 Not a business record'; end if;
  return coalesce((select jsonb_agg(data order by (data->>'at')::bigint desc) from private.platform_records
    where kind = p_kind and data->>(case p_kind when 'ticket' then 'b' else 'a' end) = p_tenant::text), '[]'); -- the business column of each kind
end $$;
revoke execute on function public.bn_server_open_ticket(text, uuid, uuid, text, text, text), public.bn_server_records_of(text, uuid, text) from public;
grant execute on function public.bn_server_open_ticket(text, uuid, uuid, text, text, text), public.bn_server_records_of(text, uuid, text) to anon, authenticated;
