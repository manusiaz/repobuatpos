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
