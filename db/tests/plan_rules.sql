-- The plan on the server (20261021000000_borniz_plan_rules.sql): adding beyond the plan is refused, what a business has keeps working.
\set ON_ERROR_STOP 1
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e1', 'owner@kopiplan.id');
create function pg_temp.expect(sql text, code text) returns void language plpgsql as $$
begin execute sql; raise exception 'expected % but it passed: %', code, sql;
exception when others then if sqlerrm not like code || '%' then raise exception 'expected %, got: %', code, sqlerrm; end if; end $$;
create function pg_temp.w(ops text) returns void language sql as $$ select public.bn_write((select id from public.tenants where slug = 'kopiplan'), ops::jsonb, 'x', 'budi') $$;
grant execute on function pg_temp.expect(text, text), pg_temp.w(text) to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', true);
select public.bn_bootstrap('Kopi Plan', 'kopiplan', 'budi');
select pg_temp.w('[{"op":"put","coll":"outlets","id":"sen","data":{"id":"sen","name":"Senayan"}},{"op":"put","coll":"devices","id":"r1","data":{"id":"r1","outletId":"sen","kind":"pos","name":"Register 1"}}]');

-- 1. Free: one outlet, one register, no kitchen display, kiosk or customer display; printers are any plan
select pg_temp.expect($$ select pg_temp.w('[{"op":"put","coll":"outlets","id":"kmg","data":{"id":"kmg","name":"Kemang"}}]') $$, 'BN076 Free: up to 1 outlet');
select pg_temp.expect($$ select pg_temp.w('[{"op":"put","coll":"devices","id":"r2","data":{"id":"r2","outletId":"sen","kind":"pos"}}]') $$, 'BN076 Free: up to 1 register per outlet');
select pg_temp.expect($$ select pg_temp.w('[{"op":"put","coll":"devices","id":"k1","data":{"id":"k1","outletId":"sen","kind":"kds"}}]') $$, 'BN076 Free: no kitchen display');
select pg_temp.expect($$ select pg_temp.w('[{"op":"put","coll":"devices","id":"c1","data":{"id":"c1","outletId":"sen","kind":"display"}}]') $$, 'BN076 Free: no customer display');
select pg_temp.expect($$ select pg_temp.w('[{"op":"put","coll":"devices","id":"r1","data":{"id":"r1","outletId":"sen","kind":"kds"}}]') $$, 'BN076 Free: no kitchen display'); -- not by turning a register into one
select pg_temp.w('[{"op":"put","coll":"devices","id":"p1","data":{"id":"p1","outletId":"sen","kind":"printer"}},{"op":"put","coll":"outlets","id":"sen","data":{"id":"sen","name":"Senayan Baru"}},{"op":"put","coll":"devices","id":"r1","data":{"id":"r1","outletId":"sen","kind":"pos","name":"Kasir depan"}}]');

-- 2. a Pro trial: three outlets, kitchen display, registers per outlet
select public.bn_start_trial((select id from public.tenants where slug = 'kopiplan'), 'pro');
select pg_temp.w('[{"op":"put","coll":"outlets","id":"kmg","data":{"id":"kmg"}},{"op":"put","coll":"outlets","id":"bsd","data":{"id":"bsd"}},{"op":"put","coll":"devices","id":"k1","data":{"id":"k1","outletId":"sen","kind":"kds"}},{"op":"put","coll":"devices","id":"r2","data":{"id":"r2","outletId":"kmg","kind":"pos"}}]');
select pg_temp.expect($$ select pg_temp.w('[{"op":"put","coll":"outlets","id":"pik","data":{"id":"pik"}}]') $$, 'BN076 Pro: up to 3 outlets');

-- 3. the trial ends unpaid: Free again; the three outlets and the kitchen display keep working, nothing new is added
reset role;
update public.tenants set trial_until = now() - interval '1 day' where slug = 'kopiplan';
set local role authenticated;
select pg_temp.w('[{"op":"put","coll":"outlets","id":"kmg","data":{"id":"kmg","name":"Kemang"}},{"op":"put","coll":"devices","id":"k1","data":{"id":"k1","outletId":"sen","kind":"kds","name":"Bar"}}]');
select pg_temp.expect($$ select pg_temp.w('[{"op":"put","coll":"devices","id":"r3","data":{"id":"r3","outletId":"bsd","kind":"pos"}}]') $$, 'BN076 Free: up to 1 register');
select pg_temp.expect($$ select pg_temp.w('[{"op":"put","coll":"devices","id":"r2","data":{"id":"r2","outletId":"sen","kind":"pos"}}]') $$, 'BN076 Free: up to 1 register'); -- moving one onto a full outlet

-- 4. Enterprise: no limit
reset role;
update public.tenants set plan = 'enterprise', trial_until = null where slug = 'kopiplan';
set local role authenticated;
select pg_temp.w('[{"op":"put","coll":"outlets","id":"pik","data":{"id":"pik"}},{"op":"put","coll":"devices","id":"r3","data":{"id":"r3","outletId":"sen","kind":"pos"}}]');
select 'plan rules hold' as result;
rollback;
