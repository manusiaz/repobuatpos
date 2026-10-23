-- Pricing-table features on the server (src/screens/public/plans.ts FEATURE, spec lg-gate):
--   BN087 a new QR-menu or kiosk order below Pro ("QR self-order & kiosk"), from guests and staff alike. Below Pro the
--         QR menu is for browsing and the kiosk page shows the upgrade wall. A guest's payment on an order that already
--         exists (bn.gateway) is never refused.
create or replace function private.feature_rules() returns trigger language plpgsql security definer set search_path = public, private as $$
declare plan text;
begin
  if new.coll <> 'orders' or tg_op <> 'INSERT' or coalesce(new.data->>'source', '') not in ('qr', 'kiosk') or coalesce(current_setting('bn.gateway', true), '') = 'on' then return new; end if;
  if exists (select 1 from public.docs where tenant_id = new.tenant_id and coll = 'orders' and id = new.id) then return new; end if;
  select public.bn_plan_now(t.plan, t.trial_until) into plan from public.tenants t where t.id = new.tenant_id and t.cell is null;
  if plan in ('free', 'basic') then raise exception 'BN087 Ordering from the QR menu and kiosk is on Pro. Please order with the staff.'; end if;
  return new;
end $$;
revoke execute on function private.feature_rules() from public, anon, authenticated;
drop trigger if exists docs_feature_rules on public.docs;
create trigger docs_feature_rules before insert on public.docs for each row execute function private.feature_rules();
