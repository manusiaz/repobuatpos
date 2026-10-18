-- A guest who pays at the cashier sends the order to the kitchen from the QR menu or kiosk. sendToKitchen raises the
-- same kitchen alerts as for staff ('New order', 'Allergy order' → /kds), which the hardening rule refused (BN047), so
-- the whole write failed and the order never reached the kitchen. Allowed now only in the batch that fires new lines.
create or replace function public.bn_guest_write(p_tenant uuid, p_ops jsonb) returns int
language plpgsql security definer set search_path = public, private as $$
declare op jsonb; d jsonb; cur jsonb; line jsonb; m jsonb; prod jsonb; price numeric; flash numeric; sub numeric; disc numeric; maxdisc numeric;
  q numeric; total numeric; n int := 0; c text; now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  -- this batch sends something new to the kitchen (pay at the cashier): judged before any write below
  fires boolean := exists (select 1 from jsonb_array_elements(p_ops) x, jsonb_array_elements(coalesce(x->'data'->'lines', '[]')) l
    where x->>'coll' = 'orders' and coalesce((l->>'fired')::boolean, false)
      and not exists (select 1 from jsonb_array_elements(coalesce(private.doc(p_tenant, 'orders', x->>'id')->'lines', '[]')) o
                      where o->>'id' = l->>'id' and coalesce((o->>'fired')::boolean, false)));
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
      if c = 'notices' and (length(coalesce(d->>'text', '')) > 160 or not (
          (d->>'alert' in ('Guest call', 'New QR / kiosk / online order') and d->>'level' in ('info','warn')
            and coalesce(d->'to', '[]') <@ '["waiter","pic","cashier"]'::jsonb
            and coalesce(d->>'href', '/waiter') in ('/waiter', '/pos/selling/online-and-qr-orders-inbox'))
          -- the kitchen alerts sendToKitchen raises, only in the batch that really fires the order
          or (fires and d->>'alert' in ('New order', 'Allergy order') and d->>'level' in ('info','high')
            and coalesce(d->'to', '[]') <@ '["kitchen","waiter","pic"]'::jsonb and coalesce(d->>'href', '') = '/kds'))) then
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

