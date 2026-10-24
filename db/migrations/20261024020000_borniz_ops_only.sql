-- Review of 20261024010000 (set-up vs the register's own bookkeeping):
--   staff_rules is written out in full here (no longer patched by text), calling private.setup_change
--   a promo's use only grows (no reset of a voucher quota by a cashier or during a hold)
--   private.ops_only: a sale queued offline sends its stale copy of the promo / item / printer; for a writer who may not
--     change the set-up (a cashier, anyone during a hold) only the use count, sold out or the device report is taken and
--     the rest stays as the server has it, so the sale is never refused for a set-up change made elsewhere meanwhile
--   _meta/tenant keeps the merchant's own fields only (plan, status, trial, unpaid, hold are the platform's; guests read it)
create or replace function private.setup_change(c text, n jsonb, o jsonb) returns boolean language sql immutable as $$
  select case
    when c in ('products','categories','modifierGroups','suppliers','stockItems','recipes','outlets','commissionRules','perms') then true
    when c = 'promos' then o is null or n is null or (n - 'used') is distinct from (o - 'used') or coalesce((n->>'used')::numeric, 0) < coalesce((o->>'used')::numeric, 0)
    when c = 'integrations' then o is null or n is null or (n - array['status','lastOk','lastError']) is distinct from (o - array['status','lastOk','lastError'])
    when c = 'outletProducts' then o is null or n is null or (n - 'is86') is distinct from (o - 'is86')
    else false end $$;

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
    if private.setup_change(c, n, o) then -- the same set-up a billing hold freezes (BN088)
      raise exception 'BN054 Your role can''t change %', c;
    end if;
    if c = 'employees' and (tg_op <> 'UPDATE' or (n->'outlets', n->'wage', n->'active', n->'role') is distinct from (o->'outlets', o->'wage', o->'active', o->'role')) then
      raise exception 'BN054 Your role can''t change staff';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

-- docs_a_…: fires before every other rule on docs (triggers run in name order)
create or replace function private.ops_only() returns trigger language plpgsql security definer set search_path = public, private as $$
declare who text; keep text[] := case new.coll when 'promos' then array['used'] when 'outletProducts' then array['is86'] when 'integrations' then array['status','lastOk','lastError'] end;
begin
  if tg_op <> 'UPDATE' or keep is null or auth.uid() is null or new.updated_by is null then return new; end if;
  -- nothing of its own changed: an edit, judged as one by the rules that follow
  if (select bool_and(new.data->k is not distinct from old.data->k) from unnest(keep) k) then return new; end if;
  who := coalesce(nullif(current_setting('bn.staff_role', true), ''), public.bn_member_role(new.tenant_id));
  if (private.rank(who) = 0 and who <> 'device') or exists (select 1 from public.tenants where id = new.tenant_id and billing_hold) then
    new.data := old.data || (select jsonb_object_agg(k, new.data->k) from unnest(keep) k where new.data ? k);
  end if;
  return new;
end $$;
revoke execute on function private.ops_only() from public, anon, authenticated;
drop trigger if exists docs_a_ops_only on public.docs;
create trigger docs_a_ops_only before update on public.docs for each row execute function private.ops_only();

update public.docs set data = data - array['plan', 'status', 'trialUntil', 'unpaidSince', 'hold'] where coll = '_meta' and id = 'tenant' and data ?| array['plan', 'status', 'trialUntil', 'unpaidSince', 'hold'];
