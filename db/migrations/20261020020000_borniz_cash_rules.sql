-- Drawer money on the server, whatever a device sends (spec/CLAUDE.md approval chain, src/data/actions.ts cashMove /
-- closeSession / applyDecision):
--   BN060 a cash out starts as a request and leaves the drawer only when approved, for the approved amount; a cash move
--         (in, out, drop) is never edited afterwards: corrections are new records
--   BN059 a counted drawer is final: its count, variance and float don't change; it closes from "needs approval" only
--         when its variance is approved, and goes back to counting only when it is rejected (recount)
-- Writes in one bn_write apply approvals first, so a decision and what it applies land together.
create or replace function private.cash_rules() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare
  n jsonb := new.data; o jsonb := case when tg_op = 'UPDATE' then old.data end;
  decided text; -- the decision on this document's request, if any
begin
  if tg_op = 'INSERT' and exists (select 1 from public.docs where tenant_id = new.tenant_id and coll = new.coll and id = new.id) then return new; end if;
  if auth.uid() is null or new.updated_by is null or coalesce(current_setting('bn.gateway', true), '') = 'on' then return new; end if;

  if new.coll = 'cashMoves' then
    if tg_op = 'INSERT' then
      if n->>'kind' = 'out' and n->>'status' <> 'waiting' then raise exception 'BN060 A cash out starts as a request'; end if;
      return new;
    end if;
    if (n->>'sessionId', n->>'outletId', n->>'kind', (n->>'amount')::numeric) is distinct from (o->>'sessionId', o->>'outletId', o->>'kind', (o->>'amount')::numeric)
       or (o->>'status' <> 'waiting' and n->>'status' is distinct from o->>'status') then
      raise exception 'BN060 A cash move is not changed; record a new one';
    end if;
    if o->>'status' = 'waiting' and n->>'status' <> 'waiting' then
      select d.data->>'status' into decided from public.docs d where d.tenant_id = new.tenant_id and d.coll = 'approvals' and d.data->>'type' = 'cash_out'
        and d.data->>'subjectId' = new.id and (d.data->>'amount')::numeric = (n->>'amount')::numeric and d.data->>'status' in ('approved', 'rejected') limit 1;
      if decided is distinct from (case n->>'status' when 'done' then 'approved' when 'rejected' then 'rejected' end) then
        raise exception 'BN060 A cash out leaves the drawer only when approved';
      end if;
    end if;
  end if;

  if new.coll = 'sessions' and tg_op = 'UPDATE' and o->>'status' in ('needs_approval', 'closed') then
    if (n->'counted', n->'variance', n->'openingFloat', n->>'cashierId', n->>'outletId') is distinct from (o->'counted', o->'variance', o->'openingFloat', o->>'cashierId', o->>'outletId') then
      raise exception 'BN059 A counted drawer is final';
    end if;
    if n->>'status' is distinct from o->>'status' then
      select string_agg(d.data->>'status', ',') into decided from public.docs d where d.tenant_id = new.tenant_id and d.coll = 'approvals'
        and d.data->>'type' = 'variance' and d.data->>'subjectId' = new.id;
      if not ((n->>'status' = 'closed' and o->>'status' = 'needs_approval' and decided like '%approved%')
              or (n->>'status' = 'counting' and decided like '%rejected%')) then
        raise exception 'BN059 A counted drawer changes only by its variance decision';
      end if;
    end if;
  end if;
  return new;
end $$;
revoke execute on function private.cash_rules() from public, anon, authenticated;
drop trigger if exists docs_cash_rules on public.docs;
create trigger docs_cash_rules before insert or update on public.docs for each row execute function private.cash_rules();
