-- Live updates on plain PostgreSQL: every change to a business's documents and every new audit row is announced on
-- NOTIFY bn_live with ids only. The API reads the row again as each listening user, so RLS still decides who sees it.
create or replace function private.bn_live() returns trigger language plpgsql as $$
declare r record;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  if tg_table_name = 'docs' then
    perform pg_notify('bn_live', json_build_object('t', r.tenant_id, 'k', 'doc', 'c', r.coll, 'i', r.id, 'd', tg_op = 'DELETE')::text);
  else
    perform pg_notify('bn_live', json_build_object('t', r.tenant_id, 'k', 'audit', 'i', r.id)::text);
  end if;
  return null;
end $$;
drop trigger if exists docs_live on public.docs;
create trigger docs_live after insert or update or delete on public.docs for each row execute function private.bn_live();
drop trigger if exists audit_live on public.audit_log;
create trigger audit_live after insert on public.audit_log for each row execute function private.bn_live();
