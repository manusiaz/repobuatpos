-- Hybrid tenancy: this project is the platform (bornis.id, app., admin.: sign-up, sign-in, the merchant registry) and the
-- shared database every merchant starts in. A merchant can later move to its own database ("cell") with
-- scripts/tenant-move.sh; the registry then points its app., pos., kds., display. and order. traffic there.
--   tenants.cell null       = the merchant's data lives in this database
--   tenants.cell = 'x'      = moved to cell x: this database keeps its old rows read-only (backup) and refuses new writes
create table public.cells (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  url text not null,
  publishable_key text not null,
  region text,
  note text,
  created_at timestamptz not null default now()
);
alter table public.cells enable row level security;
revoke all on public.cells from anon, authenticated;

alter table public.tenants add column cell text references public.cells;

/** Where a merchant's data lives, by slug (guests on order.<root>/<slug>) or by id (staff after sign-in). Public: url and publishable key only. */
create or replace function public.bn_tenant_cell(p_slug text default null, p_tenant uuid default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('tenant', t.id, 'slug', t.slug, 'cell', t.cell, 'url', c.url, 'key', c.publishable_key)
  from public.tenants t left join public.cells c on c.id = t.cell
  where (p_slug is not null and t.slug = p_slug) or (p_tenant is not null and t.id = p_tenant) limit 1 $$;

-- A moved merchant is frozen here: one source of truth, never two databases taking writes for the same business.
create or replace function private.tenant_here() returns trigger
language plpgsql security definer set search_path = public as $$
declare tid uuid := case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end;
begin
  if (select cell from public.tenants where id = tid) is not null then
    raise exception 'BN050 This business moved to its own database (%); reconnect', (select cell from public.tenants where id = tid);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger docs_tenant_here before insert or update or delete on public.docs for each row execute function private.tenant_here();
create trigger members_tenant_here before insert or update or delete on public.members for each row execute function private.tenant_here();
create trigger audit_tenant_here before insert on public.audit_log for each row execute function private.tenant_here();
create trigger payments_tenant_here before insert on public.payment_events for each row execute function private.tenant_here();

revoke execute on function private.tenant_here() from public, anon, authenticated;
grant execute on function public.bn_tenant_cell(text, uuid) to anon, authenticated;

-- Owners rename their business; plan (billing) and cell (where the data lives) are set by the platform only.
revoke update on public.tenants from authenticated;
grant update (name) on public.tenants to authenticated;
