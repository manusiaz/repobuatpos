-- Opname "system qty" (spec/CLAUDE.md Stock opname rules), review of 20261020010000:
--   it was the level when the count started, so a sale or delivery between the start and counting that item was counted
--   twice when posted (counted − system); now it is the level the moment the item is counted (and again on a recount)
--   it came from the device and could be changed while counting, so a shortage could be hidden before approval; now the
--   server sets it, and a line whose count did not change keeps the one it had
create or replace function private.opname_system() returns trigger language plpgsql security definer set search_path = public, private as $$
declare ol jsonb := case when tg_op = 'UPDATE' then old.data->'lines' end; st text := case when tg_op = 'UPDATE' then old.data->>'status' else new.data->>'status' end;
begin
  if new.coll <> 'opnames' or coalesce(st, '') not in ('counting', 'recount') then return new; end if;
  -- an upsert fires BEFORE INSERT first even when the row exists; the BEFORE UPDATE pass that follows does the work
  if tg_op = 'INSERT' and exists (select 1 from public.docs where tenant_id = new.tenant_id and coll = new.coll and id = new.id) then return new; end if;
  new.data := jsonb_set(new.data, '{lines}', coalesce((select jsonb_agg(case
      when o.l is not null and (n.l->'counted') is not distinct from (o.l->'counted') then n.l || jsonb_build_object('systemQty', o.l->'systemQty')
      else n.l || jsonb_build_object('systemQty', round(coalesce((select sum((m.data->>'qty')::numeric) from public.docs m where m.tenant_id = new.tenant_id and m.coll = 'movements'
        and m.data->>'outletId' = new.data->>'outletId' and m.data->>'stockItemId' = n.l->>'stockItemId'), 0), 3)) end order by n.i)
    from jsonb_array_elements(coalesce(new.data->'lines', '[]')) with ordinality n(l, i)
    left join lateral (select x l from jsonb_array_elements(coalesce(ol, '[]')) x where x->>'stockItemId' = n.l->>'stockItemId' limit 1) o on true), '[]'));
  return new;
end $$;
revoke execute on function private.opname_system() from public, anon, authenticated;
drop trigger if exists docs_opname_system on public.docs;
create trigger docs_opname_system before insert or update on public.docs for each row execute function private.opname_system();
