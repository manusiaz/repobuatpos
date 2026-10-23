-- BorNiz billing (spec bn-authority: "BorNiz billing (plan × outlets)", automatic, nobody creates or edits it by hand):
--   the worker issues one invoice per business on a paid plan per month (src/data/billing.ts invoiceFor); the same id
--   twice adds nothing; a trial is not billed; the owner reads them through the API (20261023030000); BorNiz staff mark them paid in
--   the console (bn_admin_put, audited). Invoices live on the platform, also for a business on its own database.
create or replace function public.bn_server_tenants(p_secret text) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not private.server_secret_ok(p_secret) then raise exception 'BN016 Bad server secret'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'slug', slug, 'name', name, 'plan', public.bn_plan_now(plan, trial_until), 'cell', cell,
      'trial', trial_until is not null and trial_until > now()) order by created_at)
    from public.tenants where status <> 'suspended'), '[]'); -- a paused business gets no automation
end $$;

create or replace function public.bn_server_invoice(p_secret text, p_tenant uuid, p_id text, p_data jsonb) returns boolean
language plpgsql security definer set search_path = public, private as $$
begin
  if not private.server_secret_ok(p_secret) then raise exception 'BN016 Bad server secret'; end if;
  if p_id is distinct from p_data->>'id' or p_data->>'a' is distinct from p_tenant::text then raise exception 'BN079 Invoice does not match its business'; end if;
  insert into private.platform_records (kind, id, data) values ('invoice', p_id, p_data) on conflict do nothing;
  if not found then return false; end if;
  insert into private.platform_audit (tenant_id, action, subject) values (p_tenant, 'invoice.issued', p_id || ' · ' || (p_data->>'c'));
  return true;
end $$;

revoke execute on function public.bn_server_invoice(text, uuid, text, jsonb) from public;
grant execute on function public.bn_server_invoice(text, uuid, text, jsonb) to anon, authenticated;
