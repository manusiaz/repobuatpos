-- Tempel SEMUA isi file ini di Supabase SQL Editor, lalu Run. Aman dijalankan ulang.

-- ===== supabase/migrations/20261013000000_borniz_attendance.sql =====
-- Fingerprint / face attendance machines: ZKTeco "ADMS" cloud push (/iclock/*) and the Fingerspot.io webhook
-- (/api/attendance/fingerspot). The machine is named by its serial (ZKTeco SN or Fingerspot Cloud ID): exactly one enabled
-- attendance connection may claim it. A connection with a "key" (Fingerspot: in the webhook URL) only accepts that key. Machine user IDs map
-- to employees through the connection's config ("user.<id>": employeeId). Each scan becomes one clock record (append-only,
-- id from serial + user + time so a re-sent batch is a no-op). Empty p_rows = handshake: only marks the machine as seen.
create or replace function public.bn_machine_clock(p_secret text, p_sn text, p_rows jsonb, p_key text default null) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare tid uuid; integ jsonb; n int; r jsonb; emp text; outlet text; at bigint; k text; lastk text; st int; cid text;
  saved int := 0; unknown text[] := '{}'; tz text;
begin
  if not private.server_secret_ok(p_secret) then raise exception 'BN016 Bad server secret'; end if;
  select count(*) into n from public.docs where coll = 'integrations' and data->>'connector' in ('attendance-zkteco', 'attendance-fingerspot')
    and coalesce((data->>'enabled')::boolean, false) and data->'config'->>'serial' = p_sn;
  if n = 0 then raise exception 'BN060 Unknown machine %: add it in Devices › Connect a device', p_sn; end if;
  if n > 1 then raise exception 'BN061 Serial % is claimed by more than one connection', p_sn; end if;
  select tenant_id, data into tid, integ from public.docs where coll = 'integrations' and data->>'connector' in ('attendance-zkteco', 'attendance-fingerspot')
    and coalesce((data->>'enabled')::boolean, false) and data->'config'->>'serial' = p_sn;
  if coalesce(integ->'config'->>'key', '') <> '' and p_key is distinct from integ->'config'->>'key' then raise exception 'BN063 Wrong key for machine %', p_sn; end if;
  outlet := integ->>'outletId';
  if outlet is null then raise exception 'BN062 The machine connection has no outlet'; end if;
  tz := coalesce(nullif(integ->'config'->>'tz', ''), '+07:00');

  for r in select x from jsonb_array_elements(coalesce(p_rows, '[]')) x order by x->>'time' loop
    emp := integ->'config'->>('user.' || (r->>'pin'));
    if emp is null then -- kept in the audit trail so the scan can be entered by hand once the ID is linked
      unknown := array_append(unknown, r->>'pin');
      insert into public.audit_log (tenant_id, actor, action, subject, outlet_id, user_id) values (tid, 'server', 'clock.machine_unlinked', p_sn || ' · user ' || (r->>'pin') || ' · ' || (r->>'time'), outlet, null);
      continue;
    end if;
    at := (extract(epoch from ((r->>'time') || ' ' || tz)::timestamptz) * 1000)::bigint;
    cid := 'zk' || left(md5(p_sn || '|' || (r->>'pin') || '|' || (r->>'time')), 20);
    continue when exists (select 1 from public.docs where tenant_id = tid and coll = 'clock' and id = cid);
    st := coalesce(nullif(r->>'status', '')::int, 0);
    if st in (1, 5) then k := 'out'; elsif st = 2 then k := 'break'; elsif st = 3 then k := 'in';
    else -- machines without check-in/out keys send 0 for every scan: alternate in → out within one shift (16 h)
      select data->>'kind' into lastk from public.docs where tenant_id = tid and coll = 'clock' and data->>'employeeId' = emp
        and data->>'outletId' = outlet and t < at and t > at - 16 * 3600000 order by t desc limit 1;
      k := case when lastk = 'in' then 'out' else 'in' end;
    end if;
    insert into public.docs (tenant_id, coll, id, data, t, open, updated_by) values (tid, 'clock', cid,
      jsonb_build_object('id', cid, 'employeeId', emp, 'outletId', outlet, 'kind', k, 'at', at, 'noPhoto', 'Verified on ' || (integ->>'name')), at, false, null);
    saved := saved + 1;
  end loop;

  update public.docs set data = data || jsonb_build_object('status', 'ok', 'lastOk', (extract(epoch from now()) * 1000)::bigint,
      'lastError', case when cardinality(unknown) > 0 then 'Scans from machine users not linked to staff: ' || array_to_string(array(select distinct u from unnest(unknown) u), ', ')
        || '. Link them in Connect a device; the scans are in the activity log.' else data->>'lastError' end), -- stays until the connection is saved again
    updated_at = now(), updated_by = null
  where tenant_id = tid and coll = 'integrations' and id = integ->>'id';
  if saved > 0 then insert into public.audit_log (tenant_id, actor, action, subject, outlet_id, user_id) values (tid, 'server', 'clock.machine', p_sn || ' · ' || saved, outlet, null); end if;
  return jsonb_build_object('saved', saved, 'unknown', to_jsonb(unknown));
end $$;

revoke execute on function public.bn_machine_clock(text, text, jsonb, text) from public;
grant execute on function public.bn_machine_clock(text, text, jsonb, text) to anon, authenticated;

-- ===== supabase/migrations/20261014000000_borniz_platform_admin.sql =====
-- BorNiz staff (super admin, admin.bornis.id): accounts listed in private.platform_admins. Nobody can add themselves; the
-- first one is added in the SQL editor after that person signs up (see CLAUDE.md). Staff read every business and set plans;
-- they never read a business's documents through this (support access stays the tenant-approved flow).
create table if not exists private.platform_admins (user_id uuid primary key references auth.users on delete cascade, added_at timestamptz not null default now());

create or replace function public.bn_is_platform_admin() returns boolean
language sql stable security definer set search_path = private as $$
  select auth.uid() is not null and exists (select 1 from private.platform_admins where user_id = auth.uid()) $$;

create or replace function public.bn_admin_tenants() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not public.bn_is_platform_admin() then raise exception 'BN070 BorNiz staff only'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'slug', t.slug, 'name', t.name, 'plan', t.plan, 'cell', t.cell,
      'createdAt', (extract(epoch from t.created_at) * 1000)::bigint,
      'owner', (select u.email from public.members m join auth.users u on u.id = m.user_id where m.tenant_id = t.id and m.role = 'owner' order by u.created_at limit 1),
      'city', (select d.data->>'city' from public.docs d where d.tenant_id = t.id and d.coll = 'outlets' order by d.id limit 1),
      'outlets', (select count(*) from public.docs d where d.tenant_id = t.id and d.coll = 'outlets'),
      'orders30', (select count(*) from public.docs d where d.tenant_id = t.id and d.coll = 'orders' and d.t > (extract(epoch from now() - interval '30 days') * 1000)::bigint),
      'lastActive', (select (extract(epoch from max(d.updated_at)) * 1000)::bigint from public.docs d where d.tenant_id = t.id)
    ) order by t.created_at desc), '[]') from public.tenants t);
end $$;

create or replace function public.bn_admin_set_plan(p_tenant uuid, p_plan text) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  if not public.bn_is_platform_admin() then raise exception 'BN070 BorNiz staff only'; end if;
  if p_plan not in ('free','basic','pro','enterprise') then raise exception 'BN071 Unknown plan %', p_plan; end if;
  update public.tenants set plan = p_plan where id = p_tenant;
  if not found then raise exception 'BN072 Business not found'; end if;
  insert into public.audit_log (tenant_id, actor, action, subject, user_id) values (p_tenant, 'admin', 'tenant.plan', p_plan, auth.uid());
end $$;

revoke all on private.platform_admins from public, anon, authenticated;
revoke execute on function public.bn_is_platform_admin(), public.bn_admin_tenants(), public.bn_admin_set_plan(uuid, text) from public, anon;
grant execute on function public.bn_is_platform_admin(), public.bn_admin_tenants(), public.bn_admin_set_plan(uuid, text) to authenticated;

-- ===== supabase/migrations/20261015000000_borniz_hardening.sql =====
-- Pen-test fixes (Oct 2026). The server re-checks what a guest, a device or a staff account may write; the browser only previews.
--   C1  guests: the order total is recomputed from the outlet's tax and service, modifier prices come from the catalog,
--       qty is a whole number, tips are never negative, payments are only created (never overwritten), staff orders are untouchable
--   H1  approvals: decided requests are final (only payload.applied may flip), the approval PIN proof belongs to the account
--       that entered it and is used up by one decision
--   H1/H3 roles and PINs: only the owner adds, removes or re-roles owners and managers; managers manage the rest;
--       a manager cannot set an owner's or manager's PIN; an empty PIN call no longer resets the lockout
--   H4  guests cannot mint beans or stored value
--   M1  an attendance machine serial belongs to the first business that claims it
--   M4  guests only raise the "Guest call" alert to waiter / PIC
--   low order-number blocks are 1–1000; QRIS / VA / e-wallet "settled" by a delivery reference only on that platform's order

alter table private.staff_secrets add column if not exists proof_by uuid;

-- ── Guests ───────────────────────────────────────────────────────────────────────────────
create or replace function private.guest_total(p_tenant uuid, p_outlet text, p_net numeric) returns numeric
language sql stable set search_path = public, private as $$
  with o as (select coalesce((data->>'serviceBps')::numeric, 0) svc, coalesce((data->>'taxBps')::numeric, 0) tax,
                    coalesce((data->>'taxInclusive')::boolean, false) incl
             from public.docs where tenant_id = p_tenant and coll = 'outlets' and id = p_outlet)
  select case when o.incl then p_net + round(p_net * o.svc / 10000)
              else p_net + round(p_net * o.svc / 10000) + round((p_net + round(p_net * o.svc / 10000)) * o.tax / 10000) end
  from o $$;

create or replace function public.bn_guest_write(p_tenant uuid, p_ops jsonb) returns int
language plpgsql security definer set search_path = public, private as $$
declare op jsonb; d jsonb; cur jsonb; line jsonb; m jsonb; prod jsonb; price numeric; flash numeric; sub numeric; disc numeric; maxdisc numeric;
  q numeric; total numeric; n int := 0; c text; now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  for op in select * from jsonb_array_elements(p_ops) loop
    c := op->>'coll'; d := op->'data';
    if op->>'op' <> 'put' then raise exception 'BN019 Guests cannot delete'; end if;
    cur := private.doc(p_tenant, c, op->>'id');
    if c = 'orders' then
      if d->>'source' not in ('qr','kiosk','web') then raise exception 'BN020 Not a guest order'; end if;
      if cur is not null and (cur->>'source' not in ('qr','kiosk','web') or cur->>'status' not in ('open','held','sent','preparing','ready','served','paying')) then raise exception 'BN021 Order is closed'; end if;
      if d->>'status' not in ('open','held','sent','preparing','paying') then raise exception 'BN022 Guests cannot set this status'; end if;
      if coalesce((d->>'discountPct')::numeric, 0) <> 0 then raise exception 'BN026 Guests cannot discount'; end if;
      sub := 0;
      for line in select * from jsonb_array_elements(coalesce(d->'lines', '[]')) loop
        q := (line->>'qty')::numeric;
        if q is null or q < 1 or q > 99 or q <> trunc(q) then raise exception 'BN033 Quantity must be 1 to 99'; end if;
        if coalesce((line->>'discountPct')::numeric, 0) <> 0 then raise exception 'BN026 Guests cannot discount'; end if;
        select p.data, coalesce((op2.data->>'localPrice')::numeric, (p.data->>'basePrice')::numeric) into prod, price
          from public.docs p left join public.docs op2 on op2.tenant_id = p.tenant_id and op2.coll = 'outletProducts' and op2.id = (p.id || '|' || (d->>'outletId'))
          where p.tenant_id = p_tenant and p.coll = 'products' and p.id = line->>'productId' and p.data->>'status' = 'live';
        if price is null or (line->>'unitPrice')::numeric <> price then raise exception 'BN023 Price changed for %', line->>'name'; end if;
        flash := nullif(line->>'flashPrice', '')::numeric;
        if flash is not null and not exists (select 1 from public.docs pr where pr.tenant_id = p_tenant and pr.coll = 'promos' and pr.data->>'kind' = 'flash'
            and (pr.data->>'value')::numeric = flash and pr.data->'productIds' ? (line->>'productId')) then raise exception 'BN024 Flash price not active'; end if;
        for m in select * from jsonb_array_elements(coalesce(line->'mods', '[]')) loop
          if not exists (select 1 from public.docs g, jsonb_array_elements(g.data->'options') o
              where g.tenant_id = p_tenant and g.coll = 'modifierGroups' and coalesce(prod->'modifierGroupIds', '[]') ? g.id
                and o->>'name' = m->>'name' and (o->>'price')::numeric = (m->>'price')::numeric) then
            raise exception 'BN034 Option % is not on the menu', m->>'name';
          end if;
        end loop;
        sub := sub + (coalesce(flash, price) + coalesce((select sum((x->>'price')::numeric) from jsonb_array_elements(line->'mods') x), 0)) * q;
      end loop;
      if abs(sub - (d->>'subtotal')::numeric) > 1 then raise exception 'BN025 Total does not match the menu'; end if;
      -- promo discount: at most what the listed, still usable promos can give on this subtotal (the app picks the best / stacks)
      disc := coalesce((d->>'discount')::numeric, 0);
      select coalesce(sum(case when sub < coalesce((pr.data->>'minSpend')::numeric, 0) then 0
                               when pr.data->>'kind' = 'pct' then round(sub * (pr.data->>'value')::numeric / 100)
                               when pr.data->>'kind' = 'amount' then least((pr.data->>'value')::numeric, sub) else 0 end), 0) into maxdisc
        from public.docs pr where pr.tenant_id = p_tenant and pr.coll = 'promos' and coalesce(d->'promoIds', '[]') ? pr.id
          and (pr.data->>'endsAt' is null or (pr.data->>'endsAt')::bigint > now_ms)
          and (pr.data->>'quota' is null or coalesce((pr.data->>'used')::numeric, 0) < (pr.data->>'quota')::numeric);
      if disc < 0 or disc > least(maxdisc, sub) then raise exception 'BN035 Discount is not from an active promo'; end if;
      total := private.guest_total(p_tenant, d->>'outletId', sub - disc);
      if total is null or abs(total - (d->>'total')::numeric) > 2 then raise exception 'BN036 Total does not match tax and service'; end if;
    elsif c = 'payments' then
      if cur is not null then n := n + 1; continue; end if; -- a re-sent payment never overwrites the stored one (gateway fields, status)
      if d->>'status' <> 'pending' or d->>'method' not in ('qris','va','ewallet') then raise exception 'BN027 Guests only start gateway payments'; end if;
      if (d->>'amount')::numeric <> (private.doc(p_tenant, 'orders', d->>'orderId')->>'total')::numeric then raise exception 'BN028 Amount does not match the order'; end if;
      if coalesce((d->>'tip')::numeric, 0) < 0 or coalesce((d->>'tip')::numeric, 0) <> trunc(coalesce((d->>'tip')::numeric, 0)) then raise exception 'BN038 Tip must be a whole positive amount'; end if;
      if private.doc(p_tenant, 'orders', d->>'orderId')->>'source' not in ('qr','kiosk','web') then raise exception 'BN020 Not a guest order'; end if;
    elsif c in ('reviews','reservations','notices','customers','ledger') then
      if cur is not null then raise exception 'BN029 Guests only add % once', c; end if;
      if c = 'ledger' and ((d->>'points')::numeric <> 50 or d->>'reason' <> 'Welcome beans'
          or (private.doc(p_tenant, 'customers', d->>'customerId') is null
              and not exists (select 1 from jsonb_array_elements(p_ops) x where x->>'coll' = 'customers' and x->>'id' = d->>'customerId'))
          or exists (select 1 from public.docs l where l.tenant_id = p_tenant and l.coll = 'ledger' and l.data->>'customerId' = d->>'customerId')) then
        raise exception 'BN030 Welcome beans are given once, to a new member';
      end if;
      if c = 'customers' and (coalesce((d->>'credit')::numeric, 0) <> 0 or coalesce((d->>'deposit')::numeric, 0) <> 0
          or exists (select 1 from jsonb_object_keys(d) k where k not in ('id','name','phone','email','joinedAt','optIn','birthday','credit','deposit'))) then
        raise exception 'BN039 Guests only sign up with name and contact';
      end if;
      if c = 'notices' and (d->>'alert' not in ('Guest call', 'New QR / kiosk / online order') or d->>'level' not in ('info','warn')
          or not (coalesce(d->'to', '[]') <@ '["waiter","pic","cashier"]'::jsonb) or length(coalesce(d->>'text', '')) > 160
          or coalesce(d->>'href', '/waiter') not in ('/waiter', '/pos/selling/online-and-qr-orders-inbox')) then
        raise exception 'BN047 Guests only call the waiter or announce their order';
      end if;
    else
      raise exception 'BN031 Guests cannot write %', c;
    end if;
    insert into public.docs (tenant_id, coll, id, data, t, open, updated_by) values (p_tenant, c, op->>'id', d, nullif(op->>'t', '')::bigint, coalesce((op->>'open')::boolean, false), null)
    on conflict (tenant_id, coll, id) do update set data = excluded.data, t = excluded.t, open = excluded.open, updated_at = now(), updated_by = null;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ── Approvals, roles, platform settlements (one more guard after docs_guard) ──────────────
create or replace function private.docs_rules() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare
  o jsonb := case when tg_op = 'INSERT' then null else old.data end;
  n jsonb := case when tg_op = 'DELETE' then null else new.data end;
  c text := coalesce(new.coll, old.coll);
  tid uuid := coalesce(new.tenant_id, old.tenant_id);
  who text := public.bn_member_role(tid);
  hi int; src text; s private.staff_secrets;
begin
  -- an upsert fires BEFORE INSERT first even when the row exists; the BEFORE UPDATE pass that follows does the checking
  if tg_op = 'INSERT' and exists (select 1 from public.docs where tenant_id = new.tenant_id and coll = new.coll and id = new.id) then return new; end if;
  if c = 'approvals' and tg_op = 'UPDATE' then
    if o->>'status' not in ('waiting','recount') and (n - 'payload') is distinct from (o - 'payload') then
      raise exception 'BN048 A decided request is final';
    end if;
    if o->>'status' not in ('waiting','recount') and (coalesce(n->'payload', '{}') - 'applied') is distinct from (coalesce(o->'payload', '{}') - 'applied') then
      raise exception 'BN048 A decided request is final';
    end if;
    if o->>'status' = 'waiting' and n->>'status' in ('approved','rejected','recount') and auth.uid() is not null then
      select * into s from private.staff_secrets where tenant_id = tid and employee_id = n->>'decidedBy';
      if s.proof_by is distinct from auth.uid() then raise exception 'BN008 Approval PIN required'; end if;
      update private.staff_secrets set proof_until = null, proof_by = null where tenant_id = tid and employee_id = n->>'decidedBy'; -- one PIN, one decision
    end if;
  end if;

  if c = 'employees' and auth.uid() is not null and (tg_op <> 'UPDATE' or o->>'role' is distinct from n->>'role') then
    hi := greatest(private.rank(o->>'role'), private.rank(n->>'role'), case when (coalesce(o->>'role', n->>'role')) = 'owner' then 3 else 0 end);
    if hi >= 2 and who is distinct from 'owner' then raise exception 'BN052 Only the owner adds, removes or re-roles owners and managers'; end if;
    if who not in ('owner','manager') then raise exception 'BN052 Only the owner or a manager changes staff'; end if;
  end if;

  if c = 'payments' and n->>'status' = 'settled' and n->>'method' in ('qris','va','ewallet') and (o is null or o->>'status' is distinct from 'settled')
     and coalesce(current_setting('bn.gateway', true), '') <> 'on' then
    src := private.doc(tid, 'orders', n->>'orderId')->>'source';
    if src is null or src not in ('gofood','grabfood','shopeefood') or upper(src) <> split_part(coalesce(n->>'ref', ''), '-', 1) then
      raise exception 'BN004 % payments are settled only by the payment gateway', upper(n->>'method');
    end if;
  end if;

  if c = 'integrations' and n->>'connector' in ('attendance-zkteco','attendance-fingerspot') and coalesce(n->'config'->>'serial', '') <> ''
     and (o is null or o->'config'->>'serial' is distinct from n->'config'->>'serial')
     and exists (select 1 from public.docs x where x.coll = 'integrations' and x.data->>'connector' in ('attendance-zkteco','attendance-fingerspot')
                 and x.data->'config'->>'serial' = n->'config'->>'serial' and not (x.tenant_id = tid and x.id = new.id)) then
    raise exception 'BN064 This machine is already connected. Disconnect it there first, or ask BorNiz support.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists docs_rules on public.docs;
create trigger docs_rules before insert or update or delete on public.docs for each row execute function private.docs_rules();

-- ── PINs ─────────────────────────────────────────────────────────────────────────────────
create or replace function public.bn_set_pins(p_tenant uuid, p_employee text, p_pin text default null, p_approval_pin text default null) returns void
language plpgsql security definer set search_path = public, private, extensions as $$
declare who text := public.bn_member_role(p_tenant);
begin
  if who not in ('owner','manager') then raise exception 'BN013 Only the owner or a manager sets PINs'; end if;
  if p_pin is null and p_approval_pin is null then return; end if;
  if who <> 'owner' and (private.rank(private.doc(p_tenant, 'employees', p_employee)->>'role') >= 2
      or exists (select 1 from public.members where tenant_id = p_tenant and employee_id = p_employee and role in ('owner','manager'))) then
    raise exception 'BN013 Only the owner sets an owner''s or manager''s PIN';
  end if;
  if p_pin is not null and p_pin !~ '^\d{4}$' then raise exception 'BN014 Login PIN is 4 digits'; end if;
  if p_approval_pin is not null and p_approval_pin !~ '^\d{6}$' then raise exception 'BN015 Approval PIN is 6 digits'; end if;
  insert into private.staff_secrets (tenant_id, employee_id, pin_hash, approval_pin_hash)
  values (p_tenant, p_employee, case when p_pin is null then null else crypt(p_pin, gen_salt('bf')) end, case when p_approval_pin is null then null else crypt(p_approval_pin, gen_salt('bf')) end)
  on conflict (tenant_id, employee_id) do update set
    pin_hash = coalesce(excluded.pin_hash, private.staff_secrets.pin_hash),
    approval_pin_hash = coalesce(excluded.approval_pin_hash, private.staff_secrets.approval_pin_hash),
    login_fails = case when p_pin is null then private.staff_secrets.login_fails else 0 end,
    login_locked_until = case when p_pin is null then private.staff_secrets.login_locked_until end,
    approval_fails = case when p_approval_pin is null then private.staff_secrets.approval_fails else 0 end,
    approval_locked_until = case when p_approval_pin is null then private.staff_secrets.approval_locked_until end,
    proof_until = case when p_approval_pin is null then private.staff_secrets.proof_until end,
    proof_by = case when p_approval_pin is null then private.staff_secrets.proof_by end;
end $$;

-- the PIN proof is opened for the account (device) that typed the PIN, not for every device of the business
do $$ declare f text := pg_get_functiondef('public.bn_check_approval_pin(uuid,text,text)'::regprocedure);
  k text := $q$set approval_fails = 0, proof_until = now() + interval '2 minutes'$q$;
begin
  if position('proof_by' in f) > 0 then return; end if;
  if position(k in f) = 0 then raise exception 'bn_check_approval_pin changed: add proof_by = auth.uid() by hand'; end if;
  execute replace(f, k, k || ', proof_by = auth.uid()');
end $$;

create or replace function public.bn_reserve(p_tenant uuid, p_name text, p_count int default 100) returns bigint
language plpgsql security definer set search_path = public, private as $$
declare first bigint;
begin
  if not public.bn_is_member(p_tenant) then raise exception 'BN011 Not a member of this business'; end if;
  if p_count is null or p_count < 1 or p_count > 1000 then raise exception 'BN049 Reserve 1 to 1000 numbers'; end if;
  insert into private.sequences (tenant_id, name, next) values (p_tenant, p_name, 2001 + p_count)
  on conflict (tenant_id, name) do update set next = private.sequences.next + p_count
  returning next - p_count into first;
  return first;
end $$;

revoke execute on function private.docs_rules(), private.guest_total(uuid, text, numeric) from public, anon, authenticated;

-- ── M2: every write goes through bn_write / the server RPCs, so it is guarded and audited once ───────────────
-- (direct INSERT / UPDATE / DELETE on docs skipped the audit row; a direct audit insert could forge actor, user or time)
drop policy if exists docs_insert on public.docs;
drop policy if exists docs_update on public.docs;
drop policy if exists docs_delete on public.docs;
drop policy if exists audit_insert on public.audit_log;
revoke insert, update, delete on public.docs from authenticated;
revoke insert, update, delete on public.audit_log from authenticated;

-- ── low: only the current server secret; delivery-app orders (predictable ids, customer name and phone) are not public ──
create or replace function private.server_secret_ok(p_secret text) returns boolean
language sql stable security definer set search_path = private as $$
  select p_secret is not null and p_secret <> '' and exists (select 1 from private.secrets where name = 'server' and value = p_secret) $$;

create or replace function public.bn_guest_order(p_tenant uuid, p_order_id text) returns jsonb
language sql stable security definer set search_path = public, private as $$
  select case when coalesce(private.doc(p_tenant, 'orders', p_order_id)->>'source', '') in ('gofood','grabfood','shopeefood') then null
    else jsonb_build_object('order', private.doc(p_tenant, 'orders', p_order_id),
      'payments', coalesce((select jsonb_agg(data) from public.docs where tenant_id = p_tenant and coll = 'payments' and data->>'orderId' = p_order_id), '[]')) end $$;

-- ===== supabase/migrations/20261016000000_borniz_staff_sessions.sql =====
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
