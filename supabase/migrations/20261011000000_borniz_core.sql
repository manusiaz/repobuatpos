-- BorNiz core schema: the ERD in spec/bn-diagrams.js (DATA MODEL) as Postgres for Supabase.
-- The browser store (src/data) is the local adapter; this is the authority: tenant isolation (RLS), approval PIN
-- verified server-side, the approval ladder, append-only audit / ledger / movements, totals computed here.
create extension if not exists pgcrypto;
create schema if not exists bn;

-- ── Identity ──────────────────────────────────────────────────────────────────────────────
-- Tenant comes from the JWT (app_metadata.tenant_id); the outlet from the device pairing.
create or replace function bn.tenant_id() returns uuid language sql stable as $$
  select nullif(coalesce(auth.jwt() -> 'app_metadata' ->> 'tenant_id', auth.jwt() ->> 'tenant_id'), '')::uuid $$;

create table bn.tenants (id uuid primary key default gen_random_uuid(), name text not null, plan text not null default 'free' check (plan in ('free','basic','pro','enterprise')), created_at timestamptz not null default now());
create table bn.brands (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references bn.tenants, name text not null);
create table bn.outlets (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references bn.tenants, brand_id uuid references bn.brands, name text not null, city text,
  timezone text not null default 'Asia/Jakarta', service_bps int not null default 0, tax_bps int not null default 1000, tax_inclusive bool not null default false, opens time, closes time);
create table bn.staff (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references bn.tenants, auth_user uuid unique, name text not null, phone text, email text,
  pin_hash text, approval_pin_hash text, twofa bool not null default false, active bool not null default true);
create table bn.role_assignments (staff_id uuid not null references bn.staff, outlet_id uuid not null references bn.outlets, tenant_id uuid not null references bn.tenants,
  role text not null check (role in ('owner','manager','pic','cashier','kitchen','waiter')), primary key (staff_id, outlet_id, role));
create table bn.devices (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references bn.tenants, outlet_id uuid not null references bn.outlets,
  kind text not null check (kind in ('pos','kds','display','kiosk','pic','printer','edc','waiter')), name text, last_seen timestamptz, pair_code text, pair_expires timestamptz);
create table bn.franchise_locks (tenant_id uuid primary key references bn.tenants, menu_prices bool not null default false, outlet_only_items bool not null default true, brand bool not null default true);
create table bn.permission_overrides (tenant_id uuid not null references bn.tenants, outlet_id uuid references bn.outlets, action text not null, code char(7) not null check (code ~ '^[yoan]{7}$'),
  unique (tenant_id, outlet_id, action));

create or replace function bn.me() returns bn.staff language sql stable security definer set search_path = bn as $$
  select s from bn.staff s where s.auth_user = auth.uid() and s.tenant_id = bn.tenant_id() $$;
create or replace function bn.role_at(p_outlet uuid) returns text language sql stable security definer set search_path = bn as $$
  select r.role from bn.role_assignments r where r.staff_id = (bn.me()).id and (r.outlet_id = p_outlet or r.role = 'owner')
  order by array_position(array['owner','manager','pic','cashier','kitchen','waiter'], r.role) limit 1 $$;
/** Owner sees every outlet; everyone else only outlets they are assigned to. */
create or replace function bn.can_outlet(p_outlet uuid) returns bool language sql stable as $$ select bn.role_at(p_outlet) is not null $$;

-- ── Catalog & menu scope ──────────────────────────────────────────────────────────────────
create table bn.categories (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references bn.tenants, name text not null, station text not null default 'bar');
create table bn.products (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references bn.tenants, category_id uuid references bn.categories, name text not null, sku text,
  scope text not null check (scope in ('global','local')), owner_outlet_id uuid references bn.outlets, base_price int not null check (base_price >= 0), cost int not null default 0,
  status text not null default 'live' check (status in ('draft','pending_owner','live','archived')), promote_requested bool not null default false,
  check ((scope = 'global') = (owner_outlet_id is null)));
create table bn.outlet_products (product_id uuid not null references bn.products, outlet_id uuid not null references bn.outlets, tenant_id uuid not null references bn.tenants,
  local_price int, is_86 bool not null default false, hidden bool not null default false, primary key (product_id, outlet_id));
create table bn.modifier_groups (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references bn.tenants, name text not null, required bool not null default false, max_pick int not null default 1);
create table bn.modifiers (id uuid primary key default gen_random_uuid(), group_id uuid not null references bn.modifier_groups, tenant_id uuid not null references bn.tenants, name text not null, price int not null default 0);
create table bn.stock_items (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references bn.tenants, name text not null, unit text not null, unit_cost int not null default 0, par numeric not null default 0);
create table bn.recipe_lines (product_id uuid not null references bn.products, stock_item_id uuid not null references bn.stock_items, tenant_id uuid not null references bn.tenants, qty numeric not null, primary key (product_id, stock_item_id));
create table bn.price_changes (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references bn.tenants, product_id uuid not null references bn.products, outlet_id uuid references bn.outlets,
  old_price int not null, new_price int not null, requested_by uuid references bn.staff, approved_by uuid references bn.staff, at timestamptz not null default now());

/** Local price must stay within ±10% of base and is blocked by the franchise lock "Menu prices". */
create or replace function bn.check_local_price() returns trigger language plpgsql as $$
declare base int; locked bool;
begin
  if new.local_price is null then return new; end if;
  select p.base_price into base from bn.products p where p.id = new.product_id;
  select coalesce(f.menu_prices, false) into locked from bn.franchise_locks f where f.tenant_id = new.tenant_id;
  if coalesce(locked, false) then raise exception 'Franchise lock "Menu prices" blocks local prices'; end if;
  if abs(new.local_price - base) > base * 0.10 then raise exception 'Local price must stay within ±10%% of %', base; end if;
  return new;
end $$;
create trigger outlet_price_band before insert or update of local_price on bn.outlet_products for each row execute function bn.check_local_price();

-- ── Sales ─────────────────────────────────────────────────────────────────────────────────
create table bn.business_days (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references bn.tenants, outlet_id uuid not null references bn.outlets, day date not null, unique (outlet_id, day));
create table bn.shifts (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references bn.tenants, business_day_id uuid not null references bn.business_days, slot text not null check (slot in ('pagi','siang','malam')));
create table bn.shift_assignments (shift_id uuid not null references bn.shifts, staff_id uuid not null references bn.staff, tenant_id uuid not null references bn.tenants, role text not null, is_pic bool not null default false, station text, primary key (shift_id, staff_id));
create unique index one_pic_per_shift on bn.shift_assignments (shift_id) where is_pic;
create table bn.clock_events (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references bn.tenants, staff_id uuid not null references bn.staff, outlet_id uuid not null references bn.outlets, kind text not null check (kind in ('in','out','break')), at timestamptz not null default now());
create table bn.drawer_sessions (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references bn.tenants, outlet_id uuid not null references bn.outlets, shift_id uuid references bn.shifts, cashier_id uuid not null references bn.staff,
  opened_at timestamptz not null default now(), opening_float int not null, closed_at timestamptz, counted int, variance int, status text not null default 'open' check (status in ('open','counting','needs_approval','closed')), note text);
create table bn.cash_moves (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references bn.tenants, session_id uuid not null references bn.drawer_sessions, kind text not null check (kind in ('in','out','drop')), amount int not null check (amount > 0), reason text not null, by_staff uuid references bn.staff, status text not null default 'waiting', at timestamptz not null default now());
create table bn.customers (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references bn.tenants, name text not null, phone text, email text, opt_in bool not null default false, credit int not null default 0, deposit int not null default 0, joined_at timestamptz not null default now(), unique (tenant_id, phone));
create table bn.orders (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references bn.tenants, outlet_id uuid not null references bn.outlets, session_id uuid references bn.drawer_sessions,
  no text not null, source text not null check (source in ('pos','qr','kiosk','waiter','web','gofood','grabfood','shopeefood')), type text not null default 'dine' check (type in ('dine','take','delivery')),
  status text not null default 'open' check (status in ('open','held','sent','preparing','ready','served','paying','paid','voided','part_refunded','refunded')),
  table_label text, customer_id uuid references bn.customers, discount_pct int not null default 0 check (discount_pct between 0 and 100), guests int not null default 1,
  subtotal int not null default 0, discount int not null default 0, service int not null default 0, tax int not null default 0, total int not null default 0,
  tier text check (tier in ('rush','standard','saver')), ready_by timestamptz, idem_key text not null, cashier_id uuid references bn.staff,
  created_at timestamptz not null default now(), paid_at timestamptz, unique (tenant_id, idem_key));
create table bn.order_lines (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references bn.tenants, order_id uuid not null references bn.orders on delete cascade, product_id uuid not null references bn.products,
  name text not null, qty int not null check (qty > 0), unit_price int not null, flash_price int, modifiers_total int not null default 0, discount_pct int not null default 0, note text,
  station text not null default 'bar', kds text not null default 'new' check (kds in ('new','cooking','done')), fired bool not null default false);
create table bn.payments (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references bn.tenants, order_id uuid not null references bn.orders, session_id uuid references bn.drawer_sessions,
  method text not null check (method in ('cash','qris','card','ewallet','va','deposit','kasbon')), amount int not null check (amount > 0), tip int not null default 0,
  status text not null check (status in ('created','pending','settled','expired','failed','refund_requested','refunded')), gateway_ref text, expires_at timestamptz, at timestamptz not null default now(), unique (tenant_id, gateway_ref));
create table bn.refunds (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references bn.tenants, payment_id uuid not null references bn.payments, amount int not null check (amount > 0), reason text not null, approval_id uuid, to_stock bool not null default false, at timestamptz not null default now());

/** lg-total, server authority: line price → modifiers → flash price → line discount → order discount → service → tax. */
create or replace function bn.recalc_order(p_order uuid) returns bn.orders language plpgsql security definer set search_path = bn as $$
declare o bn.orders; out bn.outlets; sub int; disc int; net int; svc int; tx int; tot int;
begin
  select * into o from bn.orders where id = p_order for update;
  if o.status in ('paid','voided','part_refunded','refunded') then raise exception 'Order % is final; changes are refunds', o.no; end if;
  select * into out from bn.outlets where id = o.outlet_id;
  select coalesce(sum(((coalesce(flash_price, unit_price) + modifiers_total) * qty) - round(((coalesce(flash_price, unit_price) + modifiers_total) * qty) * discount_pct / 100.0)), 0)::int into sub from bn.order_lines where order_id = p_order;
  disc := round(sub * o.discount_pct / 100.0); net := sub - disc;
  svc := round(net * out.service_bps / 10000.0);
  if out.tax_inclusive then tot := net + svc; tx := round(tot - tot / (1 + out.tax_bps / 10000.0));
  else tx := round((net + svc) * out.tax_bps / 10000.0); tot := net + svc + tx; end if;
  update bn.orders set subtotal = sub, discount = disc, service = svc, tax = tx, total = tot where id = p_order returning * into o;
  return o;
end $$;
/** Paid is final: no edit of money fields after payment (refunds are new rows). Delivery-app orders are never edited. */
create or replace function bn.guard_order() returns trigger language plpgsql as $$
begin
  if old.status in ('paid','part_refunded','refunded','voided') and (new.total, new.subtotal, new.discount) is distinct from (old.total, old.subtotal, old.discount) then
    raise exception 'Paid orders are never edited'; end if;
  if old.source in ('gofood','grabfood','shopeefood') and (new.total is distinct from old.total) then raise exception 'Delivery-app orders are read only'; end if;
  return new;
end $$;
create trigger order_final before update on bn.orders for each row execute function bn.guard_order();

-- ── Stock, opname, purchasing ─────────────────────────────────────────────────────────────
create table bn.stock_movements (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references bn.tenants, outlet_id uuid not null references bn.outlets, stock_item_id uuid not null references bn.stock_items,
  qty numeric not null, type text not null check (type in ('sale','receipt','transfer_in','transfer_out','waste','adjust','opname_adjustment','refund_return','production')), source_id uuid, by_staff uuid references bn.staff, at timestamptz not null default now());
/** Stock level is a view over movements; nobody types a stock number. */
create view bn.stock_levels with (security_invoker = true) as select tenant_id, outlet_id, stock_item_id, sum(qty) as on_hand from bn.stock_movements group by 1, 2, 3;
create table bn.opnames (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references bn.tenants, outlet_id uuid not null references bn.outlets, area text not null,
  counted_by uuid not null references bn.staff, approved_by uuid references bn.staff, status text not null default 'counting' check (status in ('counting','submitted','locked','recount','approved','rejected','posted')),
  require_photo_all bool not null default false, variance_value int, at timestamptz not null default now(), check (approved_by is distinct from counted_by));
create table bn.opname_lines (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references bn.tenants, opname_id uuid not null references bn.opnames, stock_item_id uuid not null references bn.stock_items,
  system_qty numeric not null, counted numeric not null, unit_cost int not null, locked bool not null default false, recount_of uuid references bn.opname_lines);
create table bn.opname_photos (line_id uuid not null references bn.opname_lines, tenant_id uuid not null references bn.tenants, url text not null, taken_at timestamptz not null default now());
create or replace function bn.guard_opname_line() returns trigger language plpgsql as $$
begin if old.locked then raise exception 'Counted lines are locked after submit; add a recount line'; end if; return new; end $$;
create trigger opname_locked before update or delete on bn.opname_lines for each row execute function bn.guard_opname_line();
create table bn.suppliers (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references bn.tenants, name text not null, phone text, terms text);
create table bn.purchase_orders (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references bn.tenants, no text not null, supplier_id uuid not null references bn.suppliers, outlet_id uuid not null references bn.outlets,
  status text not null default 'draft' check (status in ('draft','waiting','sent','partial','received','cancelled')), due date, created_by uuid references bn.staff, at timestamptz not null default now());
create table bn.po_lines (po_id uuid not null references bn.purchase_orders, stock_item_id uuid not null references bn.stock_items, tenant_id uuid not null references bn.tenants, qty numeric not null, price int not null, received numeric not null default 0, primary key (po_id, stock_item_id));

-- ── Approvals: one engine, level computed at creation, PIN verified here ───────────────────
create table bn.approval_requests (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references bn.tenants, outlet_id uuid not null references bn.outlets,
  type text not null check (type in ('discount','void','refund','variance','cash_out','waste','adjust','opname','price','publish','payroll','local_item','po','asset','expense','transfer','points','supplier','staff_advance','manual_payment','gift_card','budget','broadcast','promo','recipe','perm','leave','timesheet','reject_online')),
  title text not null, amount int not null default 0, pct int not null default 0, level_required text not null, status text not null default 'waiting' check (status in ('waiting','approved','rejected','recount')),
  requested_by uuid not null references bn.staff, counted_by uuid references bn.staff, subject_id uuid, payload jsonb not null default '{}', note text, at timestamptz not null default now(), offline_at timestamptz);
create table bn.approval_decisions (request_id uuid not null references bn.approval_requests, tenant_id uuid not null references bn.tenants, by_staff uuid not null references bn.staff, decision text not null, note text, at timestamptz not null default now());
create table bn.pin_attempts (staff_id uuid primary key references bn.staff, fails int not null default 0, locked_until timestamptz);

/** Mirrors src/domain/approval.ts levelRequired. Cashier → PIC (≤20% / ≤100k / variance ≤50k) → manager (≤500k) → owner. */
create or replace function bn.level_required(p_type text, p_amount int, p_pct int) returns text language sql immutable as $$
  select case
    when p_type in ('price','publish','payroll','points','supplier','perm','promo','recipe','broadcast','budget','local_item') then 'owner'
    when p_type = 'discount' then case when p_pct <= 10 then 'cashier' when p_pct <= 20 then 'pic' else 'manager' end
    when p_type in ('leave','timesheet') then 'manager'
    when p_type = 'reject_online' then 'pic'
    when p_type in ('po','asset','expense','transfer','staff_advance','gift_card') then case when p_amount <= 500000 then 'manager' else 'owner' end
    when p_amount <= case when p_type in ('variance','waste','adjust','opname') then 50000 else 100000 end then 'pic'
    when p_amount <= 500000 then 'manager' else 'owner' end $$;

create or replace function bn.request_approval(p_outlet uuid, p_type text, p_title text, p_amount int default 0, p_pct int default 0, p_subject uuid default null, p_payload jsonb default '{}', p_counted_by uuid default null)
returns bn.approval_requests language plpgsql security definer set search_path = bn as $$
declare r bn.approval_requests; me bn.staff := bn.me();
begin
  if not bn.can_outlet(p_outlet) then raise exception 'No access to this outlet'; end if;
  insert into bn.approval_requests (tenant_id, outlet_id, type, title, amount, pct, level_required, requested_by, subject_id, payload, counted_by)
  values (me.tenant_id, p_outlet, p_type, p_title, p_amount, p_pct, bn.level_required(p_type, p_amount, p_pct), me.id, p_subject, p_payload, p_counted_by) returning * into r;
  perform pg_notify('bn_' || p_outlet::text, json_build_object('event', 'approval.requested', 'id', r.id, 'level', r.level_required)::text);
  return r;
end $$;

/** Every approve / reject needs the approver's own 6-digit approval PIN (not the password). 5 wrong tries lock 15 min.
    Nobody decides their own request; the counter can't sign their own opname; rank must reach the required level. */
create or replace function bn.decide(p_request uuid, p_pin text, p_decision text, p_note text default null) returns bn.approval_requests language plpgsql security definer set search_path = bn, public as $$
declare r bn.approval_requests; me bn.staff := bn.me(); a bn.pin_attempts; my_role text; rank int; need int;
begin
  if p_decision not in ('approved','rejected','recount') then raise exception 'Unknown decision'; end if;
  select * into a from bn.pin_attempts where staff_id = me.id;
  if a.locked_until > now() then raise exception 'Approval PIN locked until %', a.locked_until; end if;
  if me.approval_pin_hash is null or crypt(p_pin, me.approval_pin_hash) <> me.approval_pin_hash then
    insert into bn.pin_attempts (staff_id, fails) values (me.id, 1) on conflict (staff_id) do update set fails = bn.pin_attempts.fails + 1,
      locked_until = case when bn.pin_attempts.fails + 1 >= 5 then now() + interval '15 minutes' end;
    if coalesce(a.fails, 0) + 1 >= 5 then
      update bn.pin_attempts set fails = 0 where staff_id = me.id;
      perform pg_notify('bn_alerts', json_build_object('alert', 'Approval PIN locked', 'staff', me.id, 'to', array['manager','owner'])::text);
    end if;
    return null; -- wrong PIN: caller shows "Wrong PIN" with tries left (a raise would roll back the counter)
  end if;
  delete from bn.pin_attempts where staff_id = me.id;
  select * into r from bn.approval_requests where id = p_request and tenant_id = me.tenant_id for update;
  if r.status <> 'waiting' then raise exception 'Already decided'; end if;
  if me.id = r.requested_by or me.id = r.counted_by then raise exception 'Nobody approves their own request'; end if;
  my_role := bn.role_at(r.outlet_id);
  rank := array_position(array['cashier','pic','manager','owner'], my_role); need := array_position(array['cashier','pic','manager','owner'], r.level_required);
  if rank is null or rank < need then raise exception 'Needs %; escalate instead', r.level_required; end if;
  update bn.approval_requests set status = p_decision where id = r.id returning * into r;
  insert into bn.approval_decisions (request_id, tenant_id, by_staff, decision, note) values (r.id, r.tenant_id, me.id, p_decision, p_note);
  if p_decision = 'approved' and r.type = 'opname' then
    update bn.opnames set status = 'posted', approved_by = me.id where id = r.subject_id;
    insert into bn.stock_movements (tenant_id, outlet_id, stock_item_id, qty, type, source_id, by_staff)
      select l.tenant_id, o.outlet_id, l.stock_item_id, l.counted - l.system_qty, 'opname_adjustment', o.id, me.id
      from bn.opname_lines l join bn.opnames o on o.id = l.opname_id where o.id = r.subject_id and l.counted <> l.system_qty
        and not exists (select 1 from bn.opname_lines x where x.recount_of = l.id);
  end if;
  insert into bn.audit_log (tenant_id, actor, action, subject, after) values (r.tenant_id, me.id, 'approval.' || p_decision, r.title, to_jsonb(r));
  perform pg_notify('bn_' || r.outlet_id::text, json_build_object('event', 'approval.decided', 'id', r.id, 'decision', p_decision)::text);
  return r;
end $$;

-- ── Loyalty, promos, guests, messaging ────────────────────────────────────────────────────
create table bn.loyalty_ledger (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references bn.tenants, customer_id uuid not null references bn.customers, points int not null, reason text not null, order_id uuid references bn.orders, at timestamptz not null default now());
create view bn.loyalty_balances with (security_invoker = true) as select tenant_id, customer_id, sum(points) as beans from bn.loyalty_ledger group by 1, 2;
create or replace function bn.guard_balance() returns trigger language plpgsql as $$
begin if (select coalesce(sum(points), 0) from bn.loyalty_ledger where customer_id = new.customer_id) + new.points < 0 then raise exception 'Not enough beans'; end if; return new; end $$;
create trigger no_negative_beans before insert on bn.loyalty_ledger for each row execute function bn.guard_balance();
create table bn.promos (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references bn.tenants, name text not null, kind text not null check (kind in ('pct','amount','flash')), value int not null, code text, min_spend int, stackable bool not null default false, quota int, used int not null default 0, ends_at timestamptz);
create table bn.reservations (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references bn.tenants, outlet_id uuid not null references bn.outlets, name text not null, phone text, at timestamptz not null, guests int not null, table_label text, status text not null default 'booked', deposit int not null default 0);
create table bn.reviews (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references bn.tenants, outlet_id uuid not null references bn.outlets, customer_id uuid references bn.customers, order_id uuid references bn.orders, stars int not null check (stars between 1 and 5), body text, reply text, at timestamptz not null default now());
create table bn.messages (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references bn.tenants, customer_id uuid references bn.customers, channel text not null, template text not null, recipient text not null, status text not null default 'queued', at timestamptz not null default now());
create table bn.versions (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references bn.tenants, kind text not null, by_staff uuid references bn.staff, status text not null, data jsonb not null, note text, at timestamptz not null default now());
create table bn.settings (tenant_id uuid not null references bn.tenants, key text not null, value jsonb not null, primary key (tenant_id, key));

-- ── Audit: append-only, never updated or deleted ──────────────────────────────────────────
create table bn.audit_log (id bigint generated always as identity primary key, tenant_id uuid not null references bn.tenants, actor uuid, action text not null, subject text, before jsonb, after jsonb, at timestamptz not null default now());
create or replace function bn.append_only() returns trigger language plpgsql as $$ begin raise exception '% is append-only', tg_table_name; end $$;
create trigger audit_append_only before update or delete on bn.audit_log for each row execute function bn.append_only();
create trigger ledger_append_only before update or delete on bn.loyalty_ledger for each row execute function bn.append_only();
create trigger movements_append_only before update or delete on bn.stock_movements for each row execute function bn.append_only();
create trigger decisions_append_only before update or delete on bn.approval_decisions for each row execute function bn.append_only();

-- ── Row-level security: every table is tenant-scoped; outlet tables also check the assignment ─
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'bn' and tablename not in ('tenants','pin_attempts') loop
    execute format('alter table bn.%I enable row level security', t);
    execute format('create policy tenant_isolation on bn.%I using (tenant_id = bn.tenant_id()) with check (tenant_id = bn.tenant_id())', t);
  end loop;
  for t in select c.table_name from information_schema.columns c where c.table_schema = 'bn' and c.column_name = 'outlet_id' and c.table_name in (select tablename from pg_tables where schemaname = 'bn') loop
    execute format('create policy outlet_scope on bn.%I as restrictive using (outlet_id is null or bn.can_outlet(outlet_id))', t);
  end loop;
end $$;
alter table bn.tenants enable row level security;
create policy own_tenant on bn.tenants using (id = bn.tenant_id());
alter table bn.pin_attempts enable row level security; -- only security-definer functions touch it
