-- BorNiz on Supabase. One document table per tenant keeps every app (POS, KDS, PIC, back office, guest screens)
-- on the same data in realtime; the rules that protect money and authority live HERE, not in the browser:
--   * staff PINs are hashed server-side and never stored in documents
--   * an approval only changes state if the approver passed their approval PIN on the server in the last 2 minutes,
--     is not the requester / counter, and their role reaches the required level (Cashier → PIC → Manager → Owner)
--   * QRIS / VA / e-wallet payments become "settled" only through the payment gateway webhook
--   * audit log, stock movements, loyalty ledger and approval decisions are append-only; beans never go negative
--   * order numbers come from a server sequence (no duplicates across registers)
--   * guests (QR menu, receipts) never sign in: they use narrow RPCs that re-check prices against the catalog
create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;

-- ── Tenancy ─────────────────────────────────────────────────────────────────────────────
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  name text not null,
  plan text not null default 'free' check (plan in ('free','basic','pro','enterprise')),
  created_at timestamptz not null default now()
);
create table public.members (
  tenant_id uuid not null references public.tenants on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  employee_id text not null,
  role text not null check (role in ('owner','manager','device','admin')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index members_user on public.members (user_id);

create or replace function public.bn_is_member(p_tenant uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where tenant_id = p_tenant and user_id = auth.uid()) $$;
create or replace function public.bn_member_role(p_tenant uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from public.members where tenant_id = p_tenant and user_id = auth.uid() $$;

-- ── Documents: every collection of the app store (orders, products, approvals …) ──────────
create table public.docs (
  tenant_id uuid not null references public.tenants on delete cascade,
  coll text not null,
  id text not null,
  data jsonb not null,
  t bigint,                 -- business time in ms (orders, payments, movements …) for loading windows
  open boolean not null default false, -- still needed on devices regardless of age (open orders, waiting approvals)
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (tenant_id, coll, id)
);
create index docs_window on public.docs (tenant_id, coll, t);
create index docs_open on public.docs (tenant_id, coll) where open;

create table public.audit_log (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants on delete cascade,
  actor text not null, action text not null, subject text, outlet_id text,
  user_id uuid default auth.uid(),
  at timestamptz not null default now()
);
create index audit_tenant_at on public.audit_log (tenant_id, at desc);

create table private.staff_secrets (
  tenant_id uuid not null references public.tenants on delete cascade,
  employee_id text not null,
  pin_hash text, approval_pin_hash text,
  login_fails int not null default 0, login_locked_until timestamptz,
  approval_fails int not null default 0, approval_locked_until timestamptz,
  proof_until timestamptz,  -- approval PIN passed; decisions allowed until then
  primary key (tenant_id, employee_id)
);
create table private.sequences (tenant_id uuid not null references public.tenants on delete cascade, name text not null, next bigint not null default 1, primary key (tenant_id, name));
create table private.secrets (name text primary key, value text not null);
create table public.payment_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants on delete cascade,
  provider text not null, payment_id text not null, status text not null, payload jsonb, at timestamptz not null default now()
);

-- ── Helpers ─────────────────────────────────────────────────────────────────────────────
create or replace function private.rank(p_role text) returns int language sql immutable as $$
  select case p_role when 'owner' then 3 when 'manager' then 2 when 'pic' then 1 else 0 end $$;
create or replace function private.doc(p_tenant uuid, p_coll text, p_id text) returns jsonb language sql stable as $$
  select data from public.docs where tenant_id = p_tenant and coll = p_coll and id = p_id $$;
create or replace function private.notice(p_tenant uuid, p_alert text, p_level text, p_to text[], p_text text) returns void language sql as $$
  insert into public.docs (tenant_id, coll, id, data, t, open)
  values (p_tenant, 'notices', 'n' || replace(gen_random_uuid()::text, '-', ''), jsonb_build_object('id', 'n' || replace(gen_random_uuid()::text, '-', ''), 'alert', p_alert, 'level', p_level, 'to', to_jsonb(p_to),
    'outletId', null, 'text', p_text, 'href', null, 'at', (extract(epoch from now()) * 1000)::bigint, 'read', false), (extract(epoch from now()) * 1000)::bigint, false) $$;

-- ── Guards: the rules no client can bypass ───────────────────────────────────────────────
create or replace function private.docs_guard() returns trigger language plpgsql security definer set search_path = public, private as $$
declare
  o jsonb := case when tg_op = 'INSERT' then null else old.data end;
  n jsonb := case when tg_op = 'DELETE' then null else new.data end;
  c text := coalesce(new.coll, old.coll);
  tid uuid := coalesce(new.tenant_id, old.tenant_id);
  approver jsonb; secret private.staff_secrets; bal numeric;
begin
  if tg_op = 'DELETE' then
    if c in ('orders','payments','refunds','movements','ledger','approvals','clock','sessions','cashMoves','opnames') then
      raise exception 'BN001 % are never deleted; corrections are new records', c;
    end if;
    return old;
  end if;

  if c = 'employees' then new.data := n - 'pin' - 'approvalPin'; end if; -- PINs live hashed in private.staff_secrets
  -- an upsert fires BEFORE INSERT first; if the row exists, the BEFORE UPDATE pass that follows does the checking
  if tg_op = 'INSERT' and exists (select 1 from public.docs where tenant_id = new.tenant_id and coll = new.coll and id = new.id) then return new; end if;

  if c in ('movements','ledger') and tg_op = 'UPDATE' and o is distinct from n then
    raise exception 'BN002 % is append-only', c;
  end if;
  if c = 'ledger' and tg_op = 'INSERT' and (n->>'points')::numeric < 0 then
    select coalesce(sum((data->>'points')::numeric), 0) into bal from public.docs where tenant_id = tid and coll = 'ledger' and data->>'customerId' = n->>'customerId';
    if bal + (n->>'points')::numeric < 0 then raise exception 'BN003 Not enough beans'; end if;
  end if;

  if c = 'payments' and n->>'status' = 'settled' and n->>'method' in ('qris','va','ewallet')
     and (o is null or o->>'status' is distinct from 'settled')
     and coalesce(current_setting('bn.gateway', true), '') <> 'on'
     and coalesce(n->>'ref', '') !~ '^(GOFOOD|GRABFOOD|SHOPEEFOOD)' then
    raise exception 'BN004 % payments are settled only by the payment gateway', upper(n->>'method');
  end if;

  if c = 'approvals' then
    if tg_op = 'INSERT' and n->>'status' <> 'waiting' and not (n->>'level' = 'cashier' and n->>'decidedBy' = n->>'requestedBy') then
      raise exception 'BN005 A new request starts as waiting';
    end if;
    if tg_op = 'UPDATE' and o->>'status' is distinct from n->>'status' then
      if o->>'status' = 'recount' and n->>'status' = 'waiting' then return new; end if;
      if o->>'status' <> 'waiting' then raise exception 'BN006 This request was already decided'; end if;
      if n->>'decidedBy' is null or n->>'decidedBy' in (coalesce(n->>'requestedBy', ''), coalesce(n->>'countedBy', '')) then
        raise exception 'BN007 Nobody approves their own request';
      end if;
      approver := private.doc(tid, 'employees', n->>'decidedBy');
      select * into secret from private.staff_secrets where tenant_id = tid and employee_id = n->>'decidedBy';
      if secret.proof_until is null or secret.proof_until < now() then raise exception 'BN008 Approval PIN required'; end if;
      if private.rank(approver->>'role') < private.rank(n->>'level') then raise exception 'BN009 Needs %', n->>'level'; end if;
    end if;
    if tg_op = 'UPDATE' and private.rank(n->>'level') < private.rank(o->>'level') then raise exception 'BN010 Escalation only goes up'; end if;
  end if;
  return new;
end $$;
create trigger docs_guard before insert or update or delete on public.docs for each row execute function private.docs_guard();

create or replace function private.append_only() returns trigger language plpgsql as $$ begin raise exception 'BN002 % is append-only', tg_table_name; end $$;
create trigger audit_append_only before update or delete on public.audit_log for each row execute function private.append_only();
create trigger events_append_only before update or delete on public.payment_events for each row execute function private.append_only();

-- ── Row-level security ────────────────────────────────────────────────────────────────────
alter table public.tenants enable row level security;
alter table public.members enable row level security;
alter table public.docs enable row level security;
alter table public.audit_log enable row level security;
alter table public.payment_events enable row level security;
create policy tenants_read on public.tenants for select to authenticated using (public.bn_is_member(id));
create policy tenants_owner_update on public.tenants for update to authenticated using (public.bn_member_role(id) = 'owner');
create policy members_read on public.members for select to authenticated using (public.bn_is_member(tenant_id));
create policy docs_read on public.docs for select to authenticated using (public.bn_is_member(tenant_id));
create policy docs_insert on public.docs for insert to authenticated with check (public.bn_is_member(tenant_id));
create policy docs_update on public.docs for update to authenticated using (public.bn_is_member(tenant_id)) with check (public.bn_is_member(tenant_id));
create policy docs_delete on public.docs for delete to authenticated using (public.bn_is_member(tenant_id));
create policy audit_read on public.audit_log for select to authenticated using (public.bn_is_member(tenant_id));
create policy audit_insert on public.audit_log for insert to authenticated with check (public.bn_is_member(tenant_id));
create policy events_read on public.payment_events for select to authenticated using (public.bn_is_member(tenant_id));

-- ── Writes: one commit = one transaction (documents + audit) ──────────────────────────────
-- ops: [{ "op": "put" | "del", "coll", "id", "data", "t", "open" }]
create or replace function public.bn_write(p_tenant uuid, p_ops jsonb, p_action text, p_actor text, p_subject text default null, p_outlet text default null)
returns int language plpgsql security invoker set search_path = public as $$
declare op jsonb; n int := 0;
begin
  if not public.bn_is_member(p_tenant) then raise exception 'BN011 Not a member of this business'; end if;
  for op in select * from jsonb_array_elements(p_ops) loop
    if op->>'op' = 'del' then
      delete from public.docs where tenant_id = p_tenant and coll = op->>'coll' and id = op->>'id';
    else
      insert into public.docs (tenant_id, coll, id, data, t, open, updated_at, updated_by)
      values (p_tenant, op->>'coll', op->>'id', op->'data', nullif(op->>'t', '')::bigint, coalesce((op->>'open')::boolean, false), now(), auth.uid())
      on conflict (tenant_id, coll, id) do update set data = excluded.data, t = excluded.t, open = excluded.open, updated_at = now(), updated_by = auth.uid()
      where public.docs.data is distinct from excluded.data or public.docs.open is distinct from excluded.open;
    end if;
    n := n + 1;
  end loop;
  insert into public.audit_log (tenant_id, actor, action, subject, outlet_id) values (p_tenant, p_actor, p_action, p_subject, p_outlet);
  return n;
end $$;

-- ── Sign-up, PINs, sequences ──────────────────────────────────────────────────────────────
create or replace function public.bn_bootstrap(p_name text, p_slug text, p_employee_id text) returns uuid
language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  if auth.uid() is null then raise exception 'BN012 Sign in first'; end if;
  insert into public.tenants (name, slug) values (p_name, p_slug) returning id into tid;
  insert into public.members (tenant_id, user_id, employee_id, role) values (tid, auth.uid(), p_employee_id, 'owner');
  return tid;
end $$;

create or replace function public.bn_set_pins(p_tenant uuid, p_employee text, p_pin text default null, p_approval_pin text default null) returns void
language plpgsql security definer set search_path = public, private, extensions as $$
begin
  if public.bn_member_role(p_tenant) not in ('owner','manager') then raise exception 'BN013 Only the owner or a manager sets PINs'; end if;
  if p_pin is not null and p_pin !~ '^\d{4}$' then raise exception 'BN014 Login PIN is 4 digits'; end if;
  if p_approval_pin is not null and p_approval_pin !~ '^\d{6}$' then raise exception 'BN015 Approval PIN is 6 digits'; end if;
  insert into private.staff_secrets (tenant_id, employee_id, pin_hash, approval_pin_hash)
  values (p_tenant, p_employee, case when p_pin is null then null else crypt(p_pin, gen_salt('bf')) end, case when p_approval_pin is null then null else crypt(p_approval_pin, gen_salt('bf')) end)
  on conflict (tenant_id, employee_id) do update set
    pin_hash = coalesce(excluded.pin_hash, private.staff_secrets.pin_hash),
    approval_pin_hash = coalesce(excluded.approval_pin_hash, private.staff_secrets.approval_pin_hash),
    login_fails = 0, login_locked_until = null, approval_fails = 0, approval_locked_until = null;
end $$;

create or replace function public.bn_check_login_pin(p_tenant uuid, p_employee text, p_pin text) returns text
language plpgsql security definer set search_path = public, private, extensions as $$
declare s private.staff_secrets;
begin
  if not public.bn_is_member(p_tenant) then return 'This device is not signed in to this business'; end if;
  select * into s from private.staff_secrets where tenant_id = p_tenant and employee_id = p_employee;
  if s.pin_hash is null then return 'No PIN set yet. Ask your manager.'; end if;
  if s.login_locked_until > now() then return 'Locked for a few minutes after 5 wrong tries.'; end if;
  if crypt(p_pin, s.pin_hash) = s.pin_hash then
    update private.staff_secrets set login_fails = 0 where tenant_id = p_tenant and employee_id = p_employee; return null;
  end if;
  update private.staff_secrets set login_fails = login_fails + 1, login_locked_until = case when login_fails + 1 >= 5 then now() + interval '5 minutes' end
    where tenant_id = p_tenant and employee_id = p_employee;
  return 'Wrong PIN.';
end $$;

create or replace function public.bn_check_approval_pin(p_tenant uuid, p_employee text, p_pin text) returns text
language plpgsql security definer set search_path = public, private, extensions as $$
declare s private.staff_secrets; left_tries int;
begin
  if not public.bn_is_member(p_tenant) then return 'This device is not signed in to this business'; end if;
  select * into s from private.staff_secrets where tenant_id = p_tenant and employee_id = p_employee;
  if s.approval_pin_hash is null then return 'No approval PIN set yet. The owner sets it in Employees.'; end if;
  if s.approval_locked_until > now() then return 'Approval PIN locked for 15 min after 5 wrong tries. The owner can reset it.'; end if;
  if crypt(p_pin, s.approval_pin_hash) = s.approval_pin_hash then
    update private.staff_secrets set approval_fails = 0, proof_until = now() + interval '2 minutes' where tenant_id = p_tenant and employee_id = p_employee;
    return null;
  end if;
  left_tries := 4 - s.approval_fails;
  if left_tries <= 0 then
    update private.staff_secrets set approval_fails = 0, approval_locked_until = now() + interval '15 minutes' where tenant_id = p_tenant and employee_id = p_employee;
    perform private.notice(p_tenant, 'Approval PIN locked', 'high', array['manager','owner'], coalesce(private.doc(p_tenant, 'employees', p_employee)->>'name', p_employee) || ': approval PIN locked after 5 wrong tries');
    return 'Approval PIN locked for 15 min. Manager and owner were alerted.';
  end if;
  update private.staff_secrets set approval_fails = approval_fails + 1 where tenant_id = p_tenant and employee_id = p_employee;
  return 'Wrong PIN. ' || left_tries || ' tries left.';
end $$;

/** Reserve a block of numbers (order numbers per register) so registers never collide, even offline. */
create or replace function public.bn_reserve(p_tenant uuid, p_name text, p_count int default 100) returns bigint
language plpgsql security definer set search_path = public, private as $$
declare first bigint;
begin
  if not public.bn_is_member(p_tenant) then raise exception 'BN011 Not a member of this business'; end if;
  insert into private.sequences (tenant_id, name, next) values (p_tenant, p_name, 2001 + p_count)
  on conflict (tenant_id, name) do update set next = private.sequences.next + p_count
  returning next - p_count into first;
  return first;
end $$;

/** Stock and beans from documents older than the device's loading window, as opening balances. */
create or replace function public.bn_opening(p_tenant uuid, p_before bigint) returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'stock', coalesce((select jsonb_agg(jsonb_build_object('outletId', o, 'stockItemId', s, 'qty', q)) from (
      select data->>'outletId' o, data->>'stockItemId' s, sum((data->>'qty')::numeric) q from public.docs
      where tenant_id = p_tenant and coll = 'movements' and t < p_before group by 1, 2) x), '[]'),
    'beans', coalesce((select jsonb_agg(jsonb_build_object('customerId', c, 'points', p)) from (
      select data->>'customerId' c, sum((data->>'points')::numeric) p from public.docs
      where tenant_id = p_tenant and coll = 'ledger' and t < p_before group by 1) y), '[]')) $$;

-- ── Payment gateway webhook (called by /api/payments/webhook/<provider> with the shared secret) ─
create or replace function public.bn_gateway_update(p_secret text, p_tenant uuid, p_payment_id text, p_status text, p_provider text, p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare d jsonb;
begin
  if p_secret is null or p_secret <> (select value from private.secrets where name = 'payment_webhook') then raise exception 'BN016 Bad webhook secret'; end if;
  if p_status not in ('settled','failed','expired') then raise exception 'BN017 Unknown status'; end if;
  insert into public.payment_events (tenant_id, provider, payment_id, status, payload) values (p_tenant, p_provider, p_payment_id, p_status, p_payload);
  select data into d from public.docs where tenant_id = p_tenant and coll = 'payments' and id = p_payment_id for update;
  if d is null then raise exception 'BN018 Payment not found'; end if;
  if d->>'status' <> 'pending' then return d; end if; -- idempotent: gateways retry
  perform set_config('bn.gateway', 'on', true);
  update public.docs set data = jsonb_set(data, '{status}', to_jsonb(p_status)), updated_at = now(), updated_by = null
    where tenant_id = p_tenant and coll = 'payments' and id = p_payment_id returning data into d;
  return d;
end $$;
create or replace function public.bn_payment_order(p_secret text, p_tenant uuid, p_payment_id text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  if p_secret is null or p_secret <> (select value from private.secrets where name = 'payment_webhook') then raise exception 'BN016 Bad webhook secret'; end if;
  return jsonb_build_object('payment', private.doc(p_tenant, 'payments', p_payment_id),
    'order', private.doc(p_tenant, 'orders', private.doc(p_tenant, 'payments', p_payment_id)->>'orderId'));
end $$;

-- ── Guests: QR menu, kiosk links, digital receipts (no sign-in) ────────────────────────────
create or replace function public.bn_public_snapshot(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('tenant', jsonb_build_object('id', t.id, 'slug', t.slug, 'name', t.name, 'plan', t.plan),
    'docs', coalesce((select jsonb_agg(jsonb_build_object('coll', coll, 'id', id, 'data', data)) from public.docs d
      where d.tenant_id = t.id and (d.coll in ('outlets','categories','modifierGroups','products','outletProducts','promos','recipes')
        or (d.coll = '_meta' and d.id in ('tenant','theme','staffBrand','settings')))), '[]'))
  from public.tenants t where t.slug = p_slug $$;

create or replace function public.bn_guest_order(p_tenant uuid, p_order_id text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('order', private.doc(p_tenant, 'orders', p_order_id),
    'payments', coalesce((select jsonb_agg(data) from public.docs where tenant_id = p_tenant and coll = 'payments' and data->>'orderId' = p_order_id), '[]')) $$;

/** Guest writes: only their own unpaid QR / kiosk / web order, a pending payment for its exact total,
    a review, a reservation, a member sign-up or a waiter call. Every line price is re-checked against the catalog. */
create or replace function public.bn_guest_write(p_tenant uuid, p_ops jsonb) returns int
language plpgsql security definer set search_path = public, private as $$
declare op jsonb; d jsonb; cur jsonb; line jsonb; price numeric; flash numeric; sub numeric; n int := 0; c text;
begin
  for op in select * from jsonb_array_elements(p_ops) loop
    c := op->>'coll'; d := op->'data';
    if op->>'op' <> 'put' then raise exception 'BN019 Guests cannot delete'; end if;
    cur := private.doc(p_tenant, c, op->>'id');
    if c = 'orders' then
      if d->>'source' not in ('qr','kiosk','web') then raise exception 'BN020 Not a guest order'; end if;
      if cur is not null and cur->>'status' not in ('open','held','sent','preparing','ready','served','paying') then raise exception 'BN021 Order is closed'; end if;
      if d->>'status' not in ('open','held','sent','preparing','paying') then raise exception 'BN022 Guests cannot set this status'; end if;
      sub := 0;
      for line in select * from jsonb_array_elements(d->'lines') loop
        select coalesce((op2.data->>'localPrice')::numeric, (p.data->>'basePrice')::numeric) into price
          from public.docs p left join public.docs op2 on op2.tenant_id = p.tenant_id and op2.coll = 'outletProducts' and op2.id = (p.id || '|' || (d->>'outletId'))
          where p.tenant_id = p_tenant and p.coll = 'products' and p.id = line->>'productId' and p.data->>'status' = 'live';
        if price is null or (line->>'unitPrice')::numeric <> price then raise exception 'BN023 Price changed for %', line->>'name'; end if;
        flash := nullif(line->>'flashPrice', '')::numeric;
        if flash is not null and not exists (select 1 from public.docs pr where pr.tenant_id = p_tenant and pr.coll = 'promos' and pr.data->>'kind' = 'flash'
            and (pr.data->>'value')::numeric = flash and pr.data->'productIds' ? (line->>'productId')) then raise exception 'BN024 Flash price not active'; end if;
        sub := sub + (coalesce(flash, price) + coalesce((select sum((m->>'price')::numeric) from jsonb_array_elements(line->'mods') m), 0)) * (line->>'qty')::numeric;
      end loop;
      if abs(sub - (d->>'subtotal')::numeric) > 1 then raise exception 'BN025 Total does not match the menu'; end if;
      if (d->>'discountPct')::numeric <> 0 then raise exception 'BN026 Guests cannot discount'; end if;
    elsif c = 'payments' then
      if d->>'status' <> 'pending' or d->>'method' not in ('qris','va','ewallet') then raise exception 'BN027 Guests only start gateway payments'; end if;
      if (d->>'amount')::numeric <> (private.doc(p_tenant, 'orders', d->>'orderId')->>'total')::numeric then raise exception 'BN028 Amount does not match the order'; end if;
    elsif c in ('reviews','reservations','notices','customers','ledger') then
      if cur is not null then raise exception 'BN029 Guests only add % once', c; end if;
      if c = 'ledger' and ((d->>'points')::numeric <> 50 or d->>'reason' <> 'Welcome beans') then raise exception 'BN030 Guests only get welcome beans'; end if;
    else
      raise exception 'BN031 Guests cannot write %', c;
    end if;
    insert into public.docs (tenant_id, coll, id, data, t, open, updated_by) values (p_tenant, c, op->>'id', d, nullif(op->>'t', '')::bigint, coalesce((op->>'open')::boolean, false), null)
    on conflict (tenant_id, coll, id) do update set data = excluded.data, t = excluded.t, open = excluded.open, updated_at = now(), updated_by = null;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ── Grants ──────────────────────────────────────────────────────────────────────────────
revoke all on schema private from public, anon, authenticated;
-- guests never touch tables directly; only the narrow guest RPCs below
revoke all on public.tenants, public.members, public.docs, public.audit_log, public.payment_events from anon;
revoke execute on all functions in schema public from public, anon;
grant execute on function public.bn_is_member(uuid), public.bn_member_role(uuid), public.bn_write(uuid, jsonb, text, text, text, text), public.bn_bootstrap(text, text, text),
  public.bn_set_pins(uuid, text, text, text), public.bn_check_login_pin(uuid, text, text), public.bn_check_approval_pin(uuid, text, text),
  public.bn_reserve(uuid, text, int), public.bn_opening(uuid, bigint) to authenticated;
grant execute on function public.bn_public_snapshot(text), public.bn_guest_order(uuid, text), public.bn_guest_write(uuid, jsonb),
  public.bn_gateway_update(text, uuid, text, text, text, jsonb), public.bn_payment_order(text, uuid, text) to anon, authenticated;

-- realtime for signed-in devices (RLS decides who receives what)
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then alter publication supabase_realtime add table public.docs; end if;
end $$;
