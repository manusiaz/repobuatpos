-- Owner-only documents: the permission matrix and commission rules. A manager or staff account can only request a change
-- (an approval the owner decides on their own account); server routes (no auth.uid) keep working.
create or replace function private.owner_docs() returns trigger
language plpgsql security definer set search_path = public as $$
declare tid uuid := case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end;
begin
  if coalesce(new.coll, old.coll) in ('perms', 'commissionRules') and auth.uid() is not null and public.bn_member_role(tid) is distinct from 'owner' then
    raise exception 'BN051 Only the owner changes %; send it to the owner for approval', coalesce(new.coll, old.coll);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger docs_owner_only before insert or update or delete on public.docs for each row execute function private.owner_docs();
revoke execute on function private.owner_docs() from public, anon, authenticated;
