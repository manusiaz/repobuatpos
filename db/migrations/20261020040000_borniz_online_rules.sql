-- Delivery-app (ojol) orders on the server, whatever a device sends:
--   BN062 only the platform webhook (bn_platform_order) or an owner / manager trying the simulator makes a GoFood /
--         GrabFood / ShopeeFood order, and no order changes its source: a bill can't borrow the platform's exceptions
--         (paid by the platform with no gateway, BN004; rejected without a void approval, BN056). One hand-over payment.
--   BN056 voiding a bill with items needs an approved void, judged on the bill as it was (emptying its items in the same
--         write doesn't count); a platform order is voided without one only while it is new (rejected / missed)
--   bn_platform_order: a cancel from the platform stops the order wherever it is until it was handed over; a retry at
--         the same moment returns the same order; an order first seen cancelled is stored closed with no "accept" chime
create or replace function private.online_rules() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare
  n jsonb := new.data; o jsonb := case when tg_op = 'UPDATE' then old.data end;
  plat text[] := array['gofood', 'grabfood', 'shopeefood']; who text; ord jsonb;
begin
  if tg_op = 'INSERT' and exists (select 1 from public.docs where tenant_id = new.tenant_id and coll = new.coll and id = new.id) then return new; end if;
  if auth.uid() is null or new.updated_by is null or coalesce(current_setting('bn.gateway', true), '') = 'on' then return new; end if;
  who := coalesce(nullif(current_setting('bn.staff_role', true), ''), public.bn_member_role(new.tenant_id));

  if new.coll = 'orders' then
    if o is not null and n->>'source' is distinct from o->>'source' then raise exception 'BN062 An order keeps its source'; end if;
    if o is null and n->>'source' = any (plat) and private.rank(who) < 2 then raise exception 'BN062 Delivery-app orders come from the platform'; end if;
    if o is not null and n->>'status' = 'voided' and o->>'status' is distinct from 'voided' and private.rank(who) < 1
       and jsonb_array_length(coalesce(o->'lines', '[]')) > 0 and not (o->>'source' = any (plat) and o->>'status' = 'open')
       and not exists (select 1 from public.docs a where a.tenant_id = new.tenant_id and a.coll = 'approvals' and a.data->>'subjectId' = new.id
         and a.data->>'type' in ('void', 'reject_online') and a.data->>'status' = 'approved') then
      raise exception 'BN056 Voiding a bill needs an approved void';
    end if;
  end if;

  if new.coll = 'payments' and n->>'status' = 'settled' and n->>'method' in ('qris', 'va', 'ewallet') and (o is null or o->>'status' is distinct from 'settled') then
    ord := private.doc(new.tenant_id, 'orders', n->>'orderId');
    if ord->>'source' = any (plat) and exists (select 1 from public.docs p where p.tenant_id = new.tenant_id and p.coll = 'payments'
         and p.data->>'orderId' = n->>'orderId' and p.data->>'status' = 'settled' and p.id <> new.id) then
      raise exception 'BN062 This delivery order was already handed over';
    end if;
  end if;
  return new;
end $$;
revoke execute on function private.online_rules() from public, anon, authenticated;
drop trigger if exists docs_online_rules on public.docs;
create trigger docs_online_rules before insert or update on public.docs for each row execute function private.online_rules();

create or replace function public.bn_platform_order(p_secret text, p_tenant uuid, p_order jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare oid text := p_order->>'id'; cur jsonb; no text; lines jsonb; first bigint;
begin
  if not private.server_secret_ok(p_secret) then raise exception 'BN016 Bad server secret'; end if;
  if oid is null or oid = '' then raise exception 'BN042 Order id missing'; end if;
  cur := private.doc(p_tenant, 'orders', oid);
  if cur is not null then
    -- a cancel from the platform stops the order wherever it is, until it was handed over (the platform settles that)
    if p_order->>'status' = 'voided' and cur->>'status' not in ('voided', 'paid', 'refunded', 'part_refunded') and not exists (
         select 1 from public.docs p where p.tenant_id = p_tenant and p.coll = 'payments' and p.data->>'orderId' = oid and p.data->>'status' = 'settled') then
      update public.docs set data = data || jsonb_build_object('status', 'voided') || case when p_order ? 'note' then jsonb_build_object('note', p_order->'note') else '{}' end,
        open = false, updated_at = now(), updated_by = null where tenant_id = p_tenant and coll = 'orders' and id = oid returning data into cur;
      insert into public.audit_log (tenant_id, actor, action, subject, user_id) values (p_tenant, 'server', 'online.cancelled', oid, null);
    end if;
    return jsonb_build_object('id', oid, 'no', cur->>'no', 'status', cur->>'status');
  end if;
  perform pg_advisory_xact_lock(hashtext('bn-platform:' || p_tenant || ':' || oid)); -- a platform retry at the same moment
  cur := private.doc(p_tenant, 'orders', oid);
  if cur is not null then return jsonb_build_object('id', oid, 'no', cur->>'no', 'status', cur->>'status'); end if;
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
  values (p_tenant, 'orders', oid, cur, coalesce(nullif(p_order->>'createdAt', '')::bigint, (extract(epoch from now()) * 1000)::bigint), cur->>'status' = 'open', null);
  if cur->>'status' = 'open' then perform private.notice(p_tenant, 'New online order', 'warn', array['cashier','pic'], coalesce(p_order->>'source', 'Delivery') || ' order ' || no || ' waiting to be accepted'); end if;
  insert into public.audit_log (tenant_id, actor, action, subject, outlet_id, user_id) values (p_tenant, 'server', 'online.received', oid, p_order->>'outletId', null);
  return jsonb_build_object('id', oid, 'no', no, 'status', cur->>'status');
end $$;

