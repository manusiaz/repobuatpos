-- Stock changes only as the movement of something approved (spec/CLAUDE.md Stock opname rules), whatever a device sends:
--   waste / adjust      → its approved request, for the approved item and quantity, once
--   opname_adjustment   → the approved opname, its counted line (counted − system), once per item
--   receipt             → an approved, still open purchase order
-- and a submitted count is locked: its lines change only in a recount the approver asked for. A request sent back after a
-- recount keeps the level its amount needs (staff_rules checks new requests only).
-- Writes in one bn_write apply approvals first, so a decision and the movements it posts land together.
create or replace function private.stock_rules() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare
  n jsonb := new.data; o jsonb := case when tg_op = 'UPDATE' then old.data end;
  a jsonb; src jsonb; l jsonb;
  strip text := 'select coalesce(jsonb_agg(x - ''photo''), ''[]'') from jsonb_array_elements(coalesce($1, ''[]'')) x';
  nl jsonb; ol jsonb;
begin
  if tg_op = 'INSERT' and exists (select 1 from public.docs where tenant_id = new.tenant_id and coll = new.coll and id = new.id) then return new; end if;
  -- server routes, the worker and starter-data import write with no updated_by / as the gateway
  if auth.uid() is null or new.updated_by is null or coalesce(current_setting('bn.gateway', true), '') = 'on' then return new; end if;

  if new.coll = 'approvals' and tg_op = 'UPDATE' and private.rank(n->>'level') < private.rank(private.level_required(n->>'type', coalesce((n->>'amount')::numeric, 0), coalesce((n->>'pct')::numeric, 0))) then
    raise exception 'BN053 This request needs the %', private.level_required(n->>'type', coalesce((n->>'amount')::numeric, 0), coalesce((n->>'pct')::numeric, 0));
  end if;

  if new.coll = 'movements' and tg_op = 'INSERT' and n->>'type' in ('waste', 'adjust', 'opname_adjustment', 'receipt') then
    if n->>'type' = 'receipt' then
      src := private.doc(new.tenant_id, 'pos', n->>'sourceId');
      if src is null or src->>'status' not in ('sent', 'partial') or src->>'outletId' is distinct from n->>'outletId'
         or not exists (select 1 from jsonb_array_elements(coalesce(src->'lines', '[]')) x where x->>'stockItemId' = n->>'stockItemId') then
        raise exception 'BN057 Goods come in against an approved purchase order';
      end if;
      return new;
    end if;
    if exists (select 1 from public.docs m where m.tenant_id = new.tenant_id and m.coll = 'movements' and m.data->>'type' = n->>'type'
               and m.data->>'sourceId' = n->>'sourceId' and m.data->>'stockItemId' = n->>'stockItemId') then
      raise exception 'BN057 This approval already moved the stock';
    end if;
    if n->>'type' = 'opname_adjustment' then
      src := private.doc(new.tenant_id, 'opnames', n->>'sourceId');
      select x into l from jsonb_array_elements(coalesce(src->'lines', '[]')) x where x->>'stockItemId' = n->>'stockItemId' limit 1;
      if src is null or src->>'outletId' is distinct from n->>'outletId' or l is null
         or not exists (select 1 from public.docs d where d.tenant_id = new.tenant_id and d.coll = 'approvals' and d.data->>'type' = 'opname'
                        and d.data->>'subjectId' = n->>'sourceId' and d.data->>'status' = 'approved')
         or abs((l->>'counted')::numeric - (l->>'systemQty')::numeric - (n->>'qty')::numeric) >= 0.001 then
        raise exception 'BN057 Stock moves only as the approved count';
      end if;
    else
      a := private.doc(new.tenant_id, 'approvals', n->>'sourceId');
      if a is null or a->>'type' <> n->>'type' or a->>'status' <> 'approved' or a->>'outletId' is distinct from n->>'outletId'
         or a->'payload'->>'stockItemId' is distinct from n->>'stockItemId' or abs((a->'payload'->>'qty')::numeric - (n->>'qty')::numeric) >= 0.001 then
        raise exception 'BN057 Stock moves only as its approved request';
      end if;
    end if;
  end if;

  if new.coll = 'opnames' and tg_op = 'UPDATE' and o->>'status' not in ('counting', 'recount') then
    execute strip into nl using n->'lines';
    execute strip into ol using o->'lines';
    if nl is distinct from ol or n->>'status' = 'counting' or (o->>'status' in ('posted', 'rejected') and n->>'status' is distinct from o->>'status')
       or (n->>'status' = 'recount' and not exists (select 1 from public.docs d where d.tenant_id = new.tenant_id and d.coll = 'approvals'
           and d.data->>'type' = 'opname' and d.data->>'subjectId' = new.id and d.data->>'status' = 'recount')) then
      raise exception 'BN058 A submitted count is locked; the approver asks for a recount';
    end if;
  end if;
  return new;
end $$;
revoke execute on function private.stock_rules() from public, anon, authenticated;
drop trigger if exists docs_stock_rules on public.docs;
create trigger docs_stock_rules before insert or update on public.docs for each row execute function private.stock_rules();
