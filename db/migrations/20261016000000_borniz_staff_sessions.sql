-- Shared registers and staff sessions. A tablet the whole team uses no longer holds the owner's or manager's sign-in:
--   1. the owner / manager taps "Make this a shared register" once: bn_device_code → the tablet signs in anonymously →
--      bn_device_join turns that account into a 'device' member (no rights of its own);
--   2. each person signs in on it with their PIN: bn_staff_login opens a server session (token, 16 h) for that employee;
--   3. every write carries the token: bn_write knows who really acts and with which role, docs_rules enforces it.
-- A device write without a staff token is treated as a guest (kiosk, customer display). Personal owner / manager accounts
-- keep working as before. The approval level is computed on the server (private.level_required = src/domain/approval.ts).

create table if not exists private.staff_sessions (
  token uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants on delete cascade,
  user_id uuid not null, employee_id text not null, role text not null,
  created_at timestamptz not null default now(), expires_at timestamptz not null
);
create index if not exists staff_sessions_user on private.staff_sessions (user_id);
create table if not exists private.device_codes (
  code text primary key, tenant_id uuid not null references public.tenants on delete cascade,
  created_by uuid, expires_at timestamptz not null
);
create table if not exists private.device_join_fails (user_id uuid primary key, fails int not null default 0, at timestamptz not null default now());

-- ── Approval ladder (same numbers as src/domain/approval.ts LIMITS) ───────────────────────────
create or replace function private.level_required(p_type text, p_amount numeric, p_pct numeric) returns text
language sql immutable as $$
  select case
    when p_type in ('price','publish','payroll','points','supplier','perm','promo','recipe','broadcast','budget','local_item') then 'owner'
    when p_type = 'discount' then case when p_pct <= 10 then 'cashier' when p_pct <= 20 then 'pic' else 'manager' end
    when p_type = 'reject_online' then 'pic'
    when p_type in ('leave','timesheet') then 'manager'
    when p_type in ('po','asset','expense','transfer','staff_advance','gift_card') then case when p_amount <= 500000 then 'manager' else 'owner' end
    when p_amount <= case when p_type in ('variance','waste','adjust','opname') then 50000 else 100000 end then 'pic'
    when p_amount <= 500000 then 'manager'
    else 'owner' end $$;

-- ── Shared registers ────────────────────────────────────────────────────────────────────────
create or replace function public.bn_device_code(p_tenant uuid) returns text
language plpgsql security definer set search_path = public, private, extensions as $$
declare c text;
begin
  if public.bn_member_role(p_tenant) not in ('owner','manager') then raise exception 'BN080 Only the owner or a manager sets up a shared register'; end if;
  delete from private.device_codes where expires_at < now();
  c := lpad(((('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
  insert into private.device_codes (code, tenant_id, created_by, expires_at) values (c, p_tenant, auth.uid(), now() + interval '10 minutes')
  on conflict (code) do update set tenant_id = excluded.tenant_id, created_by = excluded.created_by, expires_at = excluded.expires_at;
  return c;
end $$;

create or replace function public.bn_device_join(p_code text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare dc private.device_codes; t public.tenants;
begin
  if auth.uid() is null then raise exception 'BN012 Sign in first'; end if;
  if coalesce((select fails from private.device_join_fails where user_id = auth.uid()), 0) >= 5 then raise exception 'BN081 Too many wrong codes on this device'; end if;
  delete from private.device_codes where code = p_code and expires_at > now() returning * into dc;
  if dc.code is null then
    insert into private.device_join_fails (user_id, fails) values (auth.uid(), 1) on conflict (user_id) do update set fails = private.device_join_fails.fails + 1, at = now();
    raise exception 'BN081 That code is wrong or expired';
  end if;
  insert into public.members (tenant_id, user_id, employee_id, role)
  values (dc.tenant_id, auth.uid(), 'device-' || left(replace(auth.uid()::text, '-', ''), 8), 'device') on conflict do nothing;
  select * into t from public.tenants where id = dc.tenant_id;
  insert into public.audit_log (tenant_id, actor, action, subject, user_id) values (dc.tenant_id, 'device', 'device.shared_register', null, auth.uid());
  return jsonb_build_object('tenantId', t.id, 'slug', t.slug, 'name', t.name);
end $$;

-- ── Staff sessions ──────────────────────────────────────────────────────────────────────────
create or replace function public.bn_staff_login(p_tenant uuid, p_employee text, p_pin text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare err text; r text; tok uuid;
begin
  err := public.bn_check_login_pin(p_tenant, p_employee, p_pin);
  if err is not null then return jsonb_build_object('error', err); end if;
  r := private.doc(p_tenant, 'employees', p_employee)->>'role';
  if r is null or coalesce((private.doc(p_tenant, 'employees', p_employee)->>'active')::boolean, true) = false then return jsonb_build_object('error', 'This staff member is not active.'); end if;
  delete from private.staff_sessions where user_id = auth.uid() and (employee_id = p_employee or expires_at < now() - interval '8 hours');
  insert into private.staff_sessions (tenant_id, user_id, employee_id, role, expires_at) values (p_tenant, auth.uid(), p_employee, r, now() + interval '16 hours') returning token into tok;
  return jsonb_build_object('token', tok, 'role', r);
end $$;

create or replace function public.bn_staff_logout(p_token uuid) returns void
language sql security definer set search_path = private as $$
  delete from private.staff_sessions where token = p_token and user_id = auth.uid() $$;

-- ── Writes carry the staff session ──────────────────────────────────────────────────────────
drop function if exists public.bn_write(uuid, jsonb, text, text, text, text, text);
create function public.bn_write(p_tenant uuid, p_ops jsonb, p_action text, p_actor text, p_subject text default null, p_outlet text default null,
  p_op text default null, p_staff uuid default null)
returns int language plpgsql security definer set search_path = public, private as $$
declare n int; ss private.staff_sessions; who text := public.bn_member_role(p_tenant); ops jsonb;
begin
  if who is null then raise exception 'BN011 Not a member of this business'; end if;
  if p_op is not null then
    insert into private.write_ops (tenant_id, op_id) values (p_tenant, p_op) on conflict do nothing;
    if not found then return 0; end if;
    if random() < 0.01 then delete from private.write_ops where tenant_id = p_tenant and at < now() - interval '14 days'; end if;
  end if;
  if p_staff is not null then
    -- 8 h grace after expiry: an offline register replays its queue when it is back online
    select * into ss from private.staff_sessions where token = p_staff and user_id = auth.uid() and tenant_id = p_tenant and expires_at > now() - interval '8 hours';
    if ss.token is null then raise exception 'BN082 Your session ended. Sign in with your PIN again.'; end if;
    perform set_config('bn.staff_role', ss.role, true);
  elsif who = 'device' then
    return public.bn_guest_write(p_tenant, p_ops); -- a shared register with nobody signed in is a kiosk / customer display
  end if;
  -- approvals first, so a decision and what it applies (refund, void) land in one write in the right order
  select coalesce(jsonb_agg(x order by (x->>'coll') <> 'approvals'), '[]') into ops from jsonb_array_elements(p_ops) x;
  n := private.apply_ops(p_tenant, ops, auth.uid());
  insert into public.audit_log (tenant_id, actor, action, subject, outlet_id) values (p_tenant, coalesce(ss.employee_id, p_actor), p_action, p_subject, p_outlet);
  return n;
end $$;

-- ── Rules by the real role (staff session) ──────────────────────────────────────────────────
create or replace function private.staff_rules() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare
  o jsonb := case when tg_op = 'INSERT' then null else old.data end;
  n jsonb := case when tg_op = 'DELETE' then null else new.data end;
  c text := coalesce(new.coll, old.coll);
  tid uuid := coalesce(new.tenant_id, old.tenant_id);
  who text;
begin
  -- an upsert fires BEFORE INSERT first even when the row exists; the BEFORE UPDATE pass that follows does the checking
  if tg_op = 'INSERT' and exists (select 1 from public.docs where tenant_id = new.tenant_id and coll = new.coll and id = new.id) then return new; end if;
  -- server routes, gateway / delivery webhooks and guests (bn_guest_write has its own rules) write with no updated_by
  if auth.uid() is null or (tg_op <> 'DELETE' and new.updated_by is null) then return case when tg_op = 'DELETE' then old else new end; end if;
  who := coalesce(nullif(current_setting('bn.staff_role', true), ''), public.bn_member_role(tid));

  -- the approval level comes from the ladder, not from the device; only cashier-level requests approve themselves
  if c = 'approvals' and tg_op = 'INSERT'
     and private.rank(n->>'level') < private.rank(private.level_required(n->>'type', coalesce((n->>'amount')::numeric, 0), coalesce((n->>'pct')::numeric, 0))) then
    raise exception 'BN053 This request needs the %', private.level_required(n->>'type', coalesce((n->>'amount')::numeric, 0), coalesce((n->>'pct')::numeric, 0));
  end if;

  -- money out needs a decided request: a refund names its approved refund request
  if c = 'refunds' and tg_op = 'INSERT' and not exists (select 1 from public.docs a where a.tenant_id = tid and a.coll = 'approvals' and a.id = n->>'approvalId'
      and a.data->>'type' = 'refund' and a.data->>'status' = 'approved' and a.data->>'subjectId' = n->>'orderId') then
    raise exception 'BN055 A refund needs its approved request';
  end if;
  -- a cashier voids a bill with items only through an approved void (or a rejected online order)
  if c = 'orders' and n->>'status' = 'voided' and o is not null and o->>'status' is distinct from 'voided' and private.rank(who) < 1
     and jsonb_array_length(coalesce(n->'lines', '[]')) > 0 and coalesce(n->>'source', '') not in ('gofood','grabfood','shopeefood')
     and not exists (select 1 from public.docs a where a.tenant_id = tid and a.coll = 'approvals' and a.data->>'subjectId' = new.id
       and a.data->>'type' in ('void','reject_online') and a.data->>'status' = 'approved') then
    raise exception 'BN056 Voiding a bill needs an approved void';
  end if;

  if private.rank(who) = 0 and who <> 'device' then -- cashier, kitchen, waiter
    if c in ('products','categories','modifierGroups','promos','integrations','suppliers','stockItems','recipes','outlets','commissionRules','perms') then
      raise exception 'BN054 Your role can''t change %', c;
    end if;
    if c = 'outletProducts' and (tg_op <> 'UPDATE' or (n - 'is86') is distinct from (o - 'is86')) then
      raise exception 'BN054 Your role can only mark items sold out';
    end if;
    if c = 'employees' and (tg_op <> 'UPDATE' or (n->'outlets', n->'wage', n->'active', n->'role') is distinct from (o->'outlets', o->'wage', o->'active', o->'role')) then
      raise exception 'BN054 Your role can''t change staff';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists docs_staff_rules on public.docs;
create trigger docs_staff_rules before insert or update or delete on public.docs for each row execute function private.staff_rules();

-- the role check in docs_rules (employees) also follows the staff session
do $$ declare f text := pg_get_functiondef('private.docs_rules()'::regprocedure);
  k text := $q$who text := public.bn_member_role(tid);$q$;
begin
  if position('bn.staff_role' in f) > 0 then return; end if;
  if position(k in f) = 0 then raise exception 'docs_rules changed: make who follow bn.staff_role by hand'; end if;
  execute replace(f, k, $q$who text := coalesce(nullif(current_setting('bn.staff_role', true), ''), public.bn_member_role(tid));$q$);
end $$;

revoke all on private.staff_sessions, private.device_codes, private.device_join_fails from public, anon, authenticated;
revoke execute on function private.staff_rules(), private.level_required(text, numeric, numeric) from public, anon, authenticated;
revoke execute on function public.bn_write(uuid, jsonb, text, text, text, text, text, uuid), public.bn_device_code(uuid), public.bn_device_join(text),
  public.bn_staff_login(uuid, text, text), public.bn_staff_logout(uuid) from public, anon;
grant execute on function public.bn_write(uuid, jsonb, text, text, text, text, text, uuid), public.bn_device_code(uuid), public.bn_device_join(text),
  public.bn_staff_login(uuid, text, text), public.bn_staff_logout(uuid) to authenticated;
