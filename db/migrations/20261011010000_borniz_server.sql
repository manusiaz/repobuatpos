-- BorNiz server RPCs on top of the core document store:
--   * bn_write is idempotent per op id (offline retry queue) and supports preconditions ("expect": the stored doc must contain these fields)
--   * one server secret (private.secrets 'server'; legacy 'payment_webhook' still accepted) for webhooks and server routes
--   * integration secrets live in a private table: owner/manager can set them, only the server can read them
--   * bn_server_write lets server routes (delivery-app webhooks …) write documents through the same guard
--   * bn_import uploads a starter dataset (demo history included) into a brand-new business, once
--   * the guest snapshot hides recipes and costs and gives "portions left" per outlet instead
--   * server-integration RPCs: gateway charge details, delivery-app orders, an outbox for WhatsApp / webhooks (sent once, status forward only)
create table private.write_ops (
  tenant_id uuid not null references public.tenants on delete cascade,
  op_id text not null,
  at timestamptz not null default now(),
  primary key (tenant_id, op_id)
);
-- values encrypted with pgp_sym_encrypt; key = private.secrets 'secrets_key'
create table private.integration_secrets (
  tenant_id uuid not null references public.tenants on delete cascade,
  integration_id text not null,
  enc bytea not null,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (tenant_id, integration_id)
);
create table private.outbox (
  tenant_id uuid not null references public.tenants on delete cascade,
  key text not null,
  provider text,
  provider_id text,
  status text not null default 'sending',
  error text,
  at timestamptz not null default now(),
  primary key (tenant_id, key)
);
create index outbox_provider on private.outbox (tenant_id, provider, provider_id);
create index payment_events_tenant on public.payment_events (tenant_id);
alter function private.rank(text) set search_path = pg_catalog;
alter function private.doc(uuid, text, text) set search_path = public;
alter function private.append_only() set search_path = pg_catalog;
-- server-raised alerts: the document id and data.id are the same id (devices key notices by data.id)
create or replace function private.notice(p_tenant uuid, p_alert text, p_level text, p_to text[], p_text text) returns void
language sql set search_path = public as $$
  with n as (select 'n' || replace(gen_random_uuid()::text, '-', '') id, (extract(epoch from now()) * 1000)::bigint at)
  insert into public.docs (tenant_id, coll, id, data, t, open)
  select p_tenant, 'notices', n.id, jsonb_build_object('id', n.id, 'alert', p_alert, 'level', p_level, 'to', to_jsonb(p_to), 'outletId', null, 'text', p_text, 'href', null, 'at', n.at, 'read', false), n.at, false from n $$;

create or replace function private.server_secret_ok(p_secret text) returns boolean
language sql stable security definer set search_path = private as $$
  select p_secret is not null and p_secret <> '' and exists (select 1 from private.secrets where name in ('server', 'payment_webhook') and value = p_secret) $$;

/** Applies document ops through the guard trigger. "expect" = optimistic precondition on the stored document. */
create or replace function private.apply_ops(p_tenant uuid, p_ops jsonb, p_by uuid) returns int
language plpgsql security definer set search_path = public, private as $$
declare op jsonb; n int := 0;
begin
  if jsonb_typeof(p_ops) <> 'array' then raise exception 'BN042 ops must be an array'; end if;
  for op in select * from jsonb_array_elements(p_ops) loop
    if op ? 'expect' and not coalesce((select data @> (op->'expect') from public.docs where tenant_id = p_tenant and coll = op->>'coll' and id = op->>'id'), false) then
      raise exception 'BN040 Changed on another device (% %)', op->>'coll', op->>'id';
    end if;
    if op->>'op' = 'del' then
      delete from public.docs where tenant_id = p_tenant and coll = op->>'coll' and id = op->>'id';
    elsif op->>'op' = 'put' then
      insert into public.docs (tenant_id, coll, id, data, t, open, updated_at, updated_by)
      values (p_tenant, op->>'coll', op->>'id', op->'data', nullif(op->>'t', '')::bigint, coalesce((op->>'open')::boolean, false), now(), p_by)
      on conflict (tenant_id, coll, id) do update set data = excluded.data, t = excluded.t, open = excluded.open, updated_at = now(), updated_by = p_by
      where public.docs.data is distinct from excluded.data or public.docs.open is distinct from excluded.open;
    else
      raise exception 'BN042 Unknown op %', op->>'op';
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- One commit = one transaction. p_op makes retries from the offline queue safe (applied once, later calls return 0).
drop function public.bn_write(uuid, jsonb, text, text, text, text);
create function public.bn_write(p_tenant uuid, p_ops jsonb, p_action text, p_actor text, p_subject text default null, p_outlet text default null, p_op text default null)
returns int language plpgsql security definer set search_path = public, private as $$
declare n int;
begin
  if not public.bn_is_member(p_tenant) then raise exception 'BN011 Not a member of this business'; end if;
  if p_op is not null then
    insert into private.write_ops (tenant_id, op_id) values (p_tenant, p_op) on conflict do nothing;
    if not found then return 0; end if;
    if random() < 0.01 then delete from private.write_ops where tenant_id = p_tenant and at < now() - interval '14 days'; end if;
  end if;
  n := private.apply_ops(p_tenant, p_ops, auth.uid());
  insert into public.audit_log (tenant_id, actor, action, subject, outlet_id) values (p_tenant, p_actor, p_action, p_subject, p_outlet);
  return n;
end $$;

/** Server routes (delivery-app webhooks, integrations) write documents with the server secret, through the same guard. */
create or replace function public.bn_server_write(p_secret text, p_tenant uuid, p_ops jsonb, p_action text) returns int
language plpgsql security definer set search_path = public, private as $$
declare n int;
begin
  if not private.server_secret_ok(p_secret) then raise exception 'BN016 Bad server secret'; end if;
  if not exists (select 1 from public.tenants where id = p_tenant) then raise exception 'BN043 Unknown business'; end if;
  n := private.apply_ops(p_tenant, p_ops, null);
  insert into public.audit_log (tenant_id, actor, action, subject, user_id) values (p_tenant, 'server', p_action, null, null);
  return n;
end $$;

/** Starter dataset for a new business (demo history has gateway-settled payments): owner only, within an hour of sign-up, before any real activity. */
create or replace function public.bn_import(p_tenant uuid, p_ops jsonb) returns int
language plpgsql security definer set search_path = public, private as $$
declare n int;
begin
  if public.bn_member_role(p_tenant) is distinct from 'owner' then raise exception 'BN044 Only the owner imports a starter dataset'; end if;
  if (select created_at from public.tenants where id = p_tenant) < now() - interval '1 hour'
     or exists (select 1 from public.audit_log where tenant_id = p_tenant and action <> 'import') then
    raise exception 'BN045 Starter data can only be loaded into a new, unused business';
  end if;
  perform set_config('bn.gateway', 'on', true);
  n := private.apply_ops(p_tenant, p_ops, auth.uid());
  perform set_config('bn.gateway', '', true);
  insert into public.audit_log (tenant_id, actor, action, subject) values (p_tenant, 'owner', 'import', n::text);
  return n;
end $$;

-- ── Integration secrets: write-only for owner/manager, readable only with the server secret ─────
create or replace function private.secrets_key() returns text language sql stable security definer set search_path = private as $$
  select value from private.secrets where name = 'secrets_key' $$;
create or replace function public.bn_set_secret(p_tenant uuid, p_integration text, p_values jsonb) returns void
language plpgsql security definer set search_path = public, private, extensions as $$
declare k text := private.secrets_key(); cur jsonb;
begin
  if public.bn_member_role(p_tenant) is null or public.bn_member_role(p_tenant) not in ('owner','manager') then raise exception 'BN041 Only the owner or a manager sets integration secrets'; end if;
  if p_integration is null or p_integration !~ '^[A-Za-z0-9_.:-]{1,80}$' then raise exception 'BN042 Bad integration id'; end if;
  if jsonb_typeof(p_values) is distinct from 'object' or exists (select 1 from jsonb_each(p_values) e where jsonb_typeof(e.value) not in ('string','null')) then
    raise exception 'BN042 Secret values are strings';
  end if;
  if k is null then raise exception 'BN046 Secret store not configured (private.secrets secrets_key)'; end if;
  select pgp_sym_decrypt(enc, k)::jsonb into cur from private.integration_secrets where tenant_id = p_tenant and integration_id = p_integration;
  cur := coalesce(cur, '{}') || coalesce((select jsonb_object_agg(key, value) from jsonb_each(p_values) where jsonb_typeof(value) = 'string' and value #>> '{}' <> ''), '{}');
  insert into private.integration_secrets (tenant_id, integration_id, enc, updated_by) values (p_tenant, p_integration, pgp_sym_encrypt(cur::text, k), auth.uid())
  on conflict (tenant_id, integration_id) do update set enc = excluded.enc, updated_at = now(), updated_by = auth.uid();
  insert into public.audit_log (tenant_id, actor, action, subject) values (p_tenant, coalesce((select employee_id from public.members where tenant_id = p_tenant and user_id = auth.uid()), 'owner'), 'integration.secret_set', p_integration);
end $$;
create or replace function public.bn_get_secrets(p_secret text, p_tenant uuid, p_integration text) returns jsonb
language plpgsql stable security definer set search_path = public, private, extensions as $$
begin
  if not private.server_secret_ok(p_secret) then raise exception 'BN016 Bad server secret'; end if;
  return coalesce((select pgp_sym_decrypt(enc, private.secrets_key())::jsonb from private.integration_secrets where tenant_id = p_tenant and integration_id = p_integration), '{}');
end $$;
create or replace function public.bn_integrations(p_secret text, p_tenant uuid, p_kind text) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not private.server_secret_ok(p_secret) then raise exception 'BN016 Bad server secret'; end if;
  return coalesce((select jsonb_agg(data order by id) from public.docs where tenant_id = p_tenant and coll = 'integrations' and data->>'kind' = p_kind), '[]');
end $$;

-- ── Outbox: every WhatsApp message / outgoing webhook is sent once; delivery status only moves forward ──
create or replace function private.message_forward(p_tenant uuid, p_message text, p_status text) returns void
language plpgsql security definer set search_path = public, private as $$
declare cur text := private.doc(p_tenant, 'messages', p_message)->>'status';
  rk int := array_position(array['queued','sent','delivered','read'], cur); nk int := array_position(array['queued','sent','delivered','read'], p_status);
begin
  if cur is null then return; end if;
  if (p_status = 'failed' and cur in ('queued','sent')) or (nk is not null and rk is not null and nk > rk) then
    update public.docs set data = jsonb_set(data, '{status}', to_jsonb(p_status)), open = p_status = 'queued', updated_at = now(), updated_by = null
      where tenant_id = p_tenant and coll = 'messages' and id = p_message;
  end if;
end $$;
create or replace function public.bn_outbox_claim(p_secret text, p_tenant uuid, p_key text, p_provider text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare r private.outbox;
begin
  if not private.server_secret_ok(p_secret) then raise exception 'BN016 Bad server secret'; end if;
  insert into private.outbox as o (tenant_id, key, provider, status) values (p_tenant, p_key, p_provider, 'sending')
  on conflict (tenant_id, key) do update set status = 'sending', provider = excluded.provider, error = null, at = now() where o.status = 'failed'
  returning * into r;
  if r.key is not null then return jsonb_build_object('claimed', true); end if;
  select * into r from private.outbox where tenant_id = p_tenant and key = p_key;
  return jsonb_build_object('claimed', false, 'status', r.status, 'provider_id', r.provider_id);
end $$;
create or replace function public.bn_outbox_done(p_secret text, p_tenant uuid, p_key text, p_provider_id text, p_status text, p_error text default null) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  if not private.server_secret_ok(p_secret) then raise exception 'BN016 Bad server secret'; end if;
  update private.outbox set provider_id = coalesce(p_provider_id, provider_id), status = p_status, error = p_error, at = now() where tenant_id = p_tenant and key = p_key;
  if p_key like 'msg:%' and p_status in ('sent','failed') then perform private.message_forward(p_tenant, substr(p_key, 5), p_status); end if;
end $$;
create or replace function public.bn_outbox_status(p_secret text, p_tenant uuid, p_provider text, p_provider_id text, p_status text) returns void
language plpgsql security definer set search_path = public, private as $$
declare k text;
begin
  if not private.server_secret_ok(p_secret) then raise exception 'BN016 Bad server secret'; end if;
  select key into k from private.outbox where tenant_id = p_tenant and provider = p_provider and provider_id = p_provider_id limit 1;
  if k is null then return; end if;
  if p_status in ('sent','delivered','read','failed') then update private.outbox set status = p_status, at = now() where tenant_id = p_tenant and key = k; end if;
  if k like 'msg:%' then perform private.message_forward(p_tenant, substr(k, 5), p_status); end if;
end $$;

-- ── Gateway charge details (QR string, VA number, deeplink) on the pending payment, once ───────
create or replace function public.bn_gateway_charge(p_secret text, p_tenant uuid, p_payment_id text, p_provider text, p_ref text, p_qr text, p_va text, p_deeplink text, p_expires_at bigint) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare d jsonb;
begin
  if not private.server_secret_ok(p_secret) then raise exception 'BN016 Bad server secret'; end if;
  select data into d from public.docs where tenant_id = p_tenant and coll = 'payments' and id = p_payment_id for update;
  if d is null then raise exception 'BN018 Payment not found'; end if;
  if d->>'status' <> 'pending' or d->>'provider' is not null then return d; end if;
  update public.docs set data = data || jsonb_strip_nulls(jsonb_build_object('provider', p_provider, 'ref', p_ref, 'qr', p_qr, 'va', p_va, 'deeplink', p_deeplink, 'expiresAt', p_expires_at)),
    updated_at = now(), updated_by = null
    where tenant_id = p_tenant and coll = 'payments' and id = p_payment_id returning data into d;
  return d;
end $$;

-- ── Delivery-app orders (GoFood, GrabFood, ShopeeFood webhooks): idempotent on the platform order id ─
create or replace function public.bn_platform_order(p_secret text, p_tenant uuid, p_order jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare oid text := p_order->>'id'; cur jsonb; no text; lines jsonb; first bigint;
begin
  if not private.server_secret_ok(p_secret) then raise exception 'BN016 Bad server secret'; end if;
  if oid is null or oid = '' then raise exception 'BN042 Order id missing'; end if;
  cur := private.doc(p_tenant, 'orders', oid);
  if cur is not null then
    if p_order->>'status' = 'voided' and cur->>'status' = 'open' then
      update public.docs set data = data || jsonb_build_object('status', 'voided') || case when p_order ? 'note' then jsonb_build_object('note', p_order->'note') else '{}' end,
        open = false, updated_at = now(), updated_by = null where tenant_id = p_tenant and coll = 'orders' and id = oid returning data into cur;
      insert into public.audit_log (tenant_id, actor, action, subject, user_id) values (p_tenant, 'server', 'online.cancelled', oid, null);
    end if;
    return jsonb_build_object('id', oid, 'no', cur->>'no', 'status', cur->>'status');
  end if;
  insert into private.sequences (tenant_id, name, next) values (p_tenant, 'order', 2002)
  on conflict (tenant_id, name) do update set next = private.sequences.next + 1 returning next - 1 into first;
  no := '#' || first;
  select coalesce(jsonb_agg(l || jsonb_strip_nulls(jsonb_build_object('productId', p.id, 'station', coalesce(c.data->>'station', l->>'station', 'kitchen')))), '[]') into lines
  from jsonb_array_elements(coalesce(p_order->'lines', '[]')) l
  left join lateral (select x.id, x.data from public.docs x where x.tenant_id = p_tenant and x.coll = 'products'
    and (x.id = l->>'productId' or x.data->>'sku' = coalesce(l->>'sku', l->>'productId')) order by (x.id = l->>'productId') desc limit 1) p on true
  left join public.docs c on c.tenant_id = p_tenant and c.coll = 'categories' and c.id = p.data->>'categoryId';
  cur := p_order || jsonb_build_object('no', no, 'lines', lines, 'status', coalesce(p_order->>'status', 'open'));
  insert into public.docs (tenant_id, coll, id, data, t, open, updated_by)
  values (p_tenant, 'orders', oid, cur, coalesce(nullif(p_order->>'createdAt', '')::bigint, (extract(epoch from now()) * 1000)::bigint), true, null);
  perform private.notice(p_tenant, 'New online order', 'warn', array['cashier','pic'], coalesce(p_order->>'source', 'Delivery') || ' order ' || no || ' waiting to be accepted');
  insert into public.audit_log (tenant_id, actor, action, subject, outlet_id, user_id) values (p_tenant, 'server', 'online.received', oid, p_order->>'outletId', null);
  return jsonb_build_object('id', oid, 'no', no, 'status', cur->>'status');
end $$;

-- ── Gateway RPCs accept the one server secret ───────────────────────────────────────────────
create or replace function public.bn_gateway_update(p_secret text, p_tenant uuid, p_payment_id text, p_status text, p_provider text, p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare d jsonb;
begin
  if not private.server_secret_ok(p_secret) then raise exception 'BN016 Bad webhook secret'; end if;
  if p_status not in ('settled','failed','expired') then raise exception 'BN017 Unknown status'; end if;
  insert into public.payment_events (tenant_id, provider, payment_id, status, payload) values (p_tenant, p_provider, p_payment_id, p_status, p_payload);
  select data into d from public.docs where tenant_id = p_tenant and coll = 'payments' and id = p_payment_id for update;
  if d is null then raise exception 'BN018 Payment not found'; end if;
  if d->>'status' <> 'pending' then return d; end if;
  perform set_config('bn.gateway', 'on', true);
  update public.docs set data = jsonb_set(data, '{status}', to_jsonb(p_status)), open = false, updated_at = now(), updated_by = null
    where tenant_id = p_tenant and coll = 'payments' and id = p_payment_id returning data into d;
  perform set_config('bn.gateway', '', true);
  return d;
end $$;
create or replace function public.bn_payment_order(p_secret text, p_tenant uuid, p_payment_id text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  if not private.server_secret_ok(p_secret) then raise exception 'BN016 Bad webhook secret'; end if;
  return jsonb_build_object('payment', private.doc(p_tenant, 'payments', p_payment_id),
    'order', private.doc(p_tenant, 'orders', private.doc(p_tenant, 'payments', p_payment_id)->>'orderId'));
end $$;

-- ── Guest snapshot: live catalog + portions left (no recipes, costs or stock levels) ─────────
create or replace function public.bn_public_snapshot(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t public.tenants; docs jsonb; portions jsonb;
begin
  select * into t from public.tenants where slug = p_slug;
  if t.id is null then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('coll', d.coll, 'id', d.id, 'data', case when d.coll = 'products' then d.data - 'cost' else d.data end)), '[]') into docs
  from public.docs d where d.tenant_id = t.id and (d.coll in ('outlets','categories','modifierGroups','outletProducts','promos')
    or (d.coll = 'products' and d.data->>'status' = 'live') or (d.coll = '_meta' and d.id in ('tenant','theme','staffBrand','order')));
  with lv as (select data->>'outletId' o, data->>'stockItemId' s, sum((data->>'qty')::numeric) q from public.docs where tenant_id = t.id and coll = 'movements' group by 1, 2),
       rc as (select data->>'productId' p, data->>'stockItemId' s, (data->>'qty')::numeric q from public.docs where tenant_id = t.id and coll = 'recipes' and (data->>'qty')::numeric > 0),
       outs as (select id o from public.docs where tenant_id = t.id and coll = 'outlets'),
       x as (select outs.o, rc.p, greatest(0, least(99, min(floor(coalesce(lv.q, 0) / rc.q + 1e-9)))) n from outs cross join rc left join lv on lv.o = outs.o and lv.s = rc.s group by 1, 2)
  select coalesce(jsonb_agg(jsonb_build_object('outletId', o, 'productId', p, 'n', n)), '[]') into portions from x;
  return jsonb_build_object('tenant', jsonb_build_object('id', t.id, 'slug', t.slug, 'name', t.name, 'plan', t.plan), 'docs', docs, 'portions', portions);
end $$;

-- ── Grants ─────────────────────────────────────────────────────────────────────────────────
revoke execute on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function public.bn_write(uuid, jsonb, text, text, text, text, text), public.bn_import(uuid, jsonb), public.bn_set_secret(uuid, text, jsonb),
  public.bn_is_member(uuid), public.bn_member_role(uuid), public.bn_bootstrap(text, text, text), public.bn_set_pins(uuid, text, text, text), public.bn_check_login_pin(uuid, text, text),
  public.bn_check_approval_pin(uuid, text, text), public.bn_reserve(uuid, text, int), public.bn_opening(uuid, bigint) to authenticated;
grant execute on function public.bn_public_snapshot(text), public.bn_guest_order(uuid, text), public.bn_guest_write(uuid, jsonb),
  public.bn_gateway_update(text, uuid, text, text, text, jsonb), public.bn_payment_order(text, uuid, text), public.bn_server_write(text, uuid, jsonb, text),
  public.bn_get_secrets(text, uuid, text), public.bn_integrations(text, uuid, text), public.bn_outbox_claim(text, uuid, text, text), public.bn_outbox_done(text, uuid, text, text, text, text),
  public.bn_outbox_status(text, uuid, text, text, text), public.bn_gateway_charge(text, uuid, text, text, text, text, text, text, bigint), public.bn_platform_order(text, uuid, jsonb) to anon, authenticated;

-- signed-in devices also follow the audit trail live (KDS bump times, activity); RLS decides who receives what
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'audit_log') then
    alter publication supabase_realtime add table public.audit_log;
  end if;
end $$;
