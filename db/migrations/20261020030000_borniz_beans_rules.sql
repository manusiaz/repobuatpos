-- Beans on the server (src/domain/loyalty.ts: earn on paid orders only, balance never negative), whatever a device sends:
--   one ledger write per member at a time, so two redeems at once can't both pass the balance check (BN003)
--   a paid order earns once, and so do its referral and feedback rewards (every writer: devices, the worker)
--   staff below the owner add beans only as: the 50 welcome beans of a new member, the earn of a paid order up to the
--   best tier's rate (1.5 per IDR 1,000 of subtotal after discount), the referral / feedback rewards of a paid order (BN061)
--   a waiting request keeps what it asked for until it is decided (its payload can grow, never change) (BN048)
-- Triggers fire in name order: docs_beans_rules takes the member's lock before docs_guard sums the balance.
create or replace function private.beans_rules() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare
  n jsonb := new.data; o jsonb := case when tg_op = 'UPDATE' then old.data end;
  r text := n->>'reason'; kind text; ord jsonb; who text;
  fixed text[] := array['level', 'payload', 'status', 'decidedBy', 'decidedAt', 'decisionNote'];
begin
  if tg_op = 'INSERT' and exists (select 1 from public.docs where tenant_id = new.tenant_id and coll = new.coll and id = new.id) then return new; end if;

  if new.coll = 'ledger' and tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('bn-beans:' || new.tenant_id || ':' || coalesce(n->>'customerId', '')));
    kind := case when r like 'Order %' then 'Order %' when r like 'Referral · %' then 'Referral · %' else r end;
    if (n->>'points')::numeric > 0 and kind in ('Order %', 'Referral · %', 'Referral welcome', 'Feedback') and exists (
         select 1 from public.docs l where l.tenant_id = new.tenant_id and l.coll = 'ledger' and l.data->>'customerId' = n->>'customerId'
           and l.data->>'orderId' = n->>'orderId' and l.data->>'reason' like kind and (l.data->>'points')::numeric > 0) then
      raise exception 'BN061 This order already gave these beans';
    end if;
    if auth.uid() is null or new.updated_by is null or coalesce(current_setting('bn.gateway', true), '') = 'on' or (n->>'points')::numeric <= 0 then return new; end if;
    who := coalesce(nullif(current_setting('bn.staff_role', true), ''), public.bn_member_role(new.tenant_id));
    if who = 'owner' then return new; end if;
    ord := private.doc(new.tenant_id, 'orders', n->>'orderId');
    if not (
         (r = 'Welcome beans' and (n->>'points')::numeric = 50
           and not exists (select 1 from public.docs l where l.tenant_id = new.tenant_id and l.coll = 'ledger' and l.data->>'customerId' = n->>'customerId'))
      or (kind in ('Order %', 'Referral · %', 'Referral welcome', 'Feedback') and ord->>'status' = 'paid'
           and (kind <> 'Order %' or (ord->>'customerId' = n->>'customerId'
             and (n->>'points')::numeric <= floor((coalesce((ord->>'subtotal')::numeric, 0) - coalesce((ord->>'discount')::numeric, 0)) / 1000 * 1.5))))) then
      raise exception 'BN061 Beans are added by the owner or earned on a paid order';
    end if;
  end if;

  if new.coll = 'approvals' and tg_op = 'UPDATE' and o->>'status' = 'waiting'
     and ((select jsonb_object_agg(k, v) from jsonb_each(n) x(k, v) where k <> all (fixed)) is distinct from (select jsonb_object_agg(k, v) from jsonb_each(o) x(k, v) where k <> all (fixed))
       or not coalesce(n->'payload', '{}') @> (coalesce(o->'payload', '{}') - 'signers' - 'sentBy' - 'sentAt' - 'sentNote')) then
    raise exception 'BN048 A waiting request keeps what it asked for';
  end if;
  return new;
end $$;
revoke execute on function private.beans_rules() from public, anon, authenticated;
drop trigger if exists docs_beans_rules on public.docs;
create trigger docs_beans_rules before insert or update on public.docs for each row execute function private.beans_rules();

-- the precondition ("expect") locks the row it checks: two writers finishing the same order can't both see it unfinished
create or replace function private.apply_ops(p_tenant uuid, p_ops jsonb, p_by uuid) returns int
language plpgsql security definer set search_path = public, private as $$
declare op jsonb; n int := 0;
begin
  if jsonb_typeof(p_ops) <> 'array' then raise exception 'BN042 ops must be an array'; end if;
  for op in select * from jsonb_array_elements(p_ops) loop
    if op ? 'expect' and not coalesce((select data @> (op->'expect') from public.docs where tenant_id = p_tenant and coll = op->>'coll' and id = op->>'id' for update), false) then
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
