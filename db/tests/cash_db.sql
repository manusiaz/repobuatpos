-- Drawers and cash moves on the server: a cash out leaves the drawer only when approved, for the approved amount; a
-- cash move is never edited; a counted drawer is final unless its variance is rejected for a recount.
\set ON_ERROR_STOP 1
begin;
set local check_function_bodies = off; -- pg_temp.w reads t, made below
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000d1'), ('00000000-0000-0000-0000-0000000000d2');
create function pg_temp.expect(sql text, code text) returns void language plpgsql as $$
begin execute sql; raise exception 'expected % but it passed: %', code, sql;
exception when others then if sqlerrm not like code || '%' then raise exception 'expected %, got: %', code, sqlerrm; end if; end $$;
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create function pg_temp.w(ops text, staff text) returns int language sql as $$
  select public.bn_write((select id from t), ops::jsonb, 'x', staff, null, null, null, (select v::uuid from v where k = staff)) $$;
grant execute on function pg_temp.expect(text, text), pg_temp.as_user(text), pg_temp.w(text, text) to authenticated;
create temp table v (k text primary key, v text);
grant all on v to authenticated;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
create temp table t as select public.bn_bootstrap('Kopi Kas', 'kopikas', 'budi') as id;
grant select on t to authenticated;
select public.bn_write((select id from t), '[
  {"op":"put","coll":"outlets","id":"sen","data":{"id":"sen","name":"Senayan","serviceBps":0,"taxBps":0}},
  {"op":"put","coll":"employees","id":"budi","data":{"id":"budi","name":"Budi","role":"owner"}},
  {"op":"put","coll":"employees","id":"maya","data":{"id":"maya","name":"Maya","role":"pic","outlets":["sen"]}},
  {"op":"put","coll":"employees","id":"sari","data":{"id":"sari","name":"Sari","role":"pic","outlets":["sen"]}},
  {"op":"put","coll":"employees","id":"rina","data":{"id":"rina","name":"Rina","role":"cashier","outlets":["sen"]}}
]'::jsonb, 'setup', 'budi');
select public.bn_set_pins((select id from t), 'rina', '1234', null);
select public.bn_set_pins((select id from t), 'maya', '5678', '135790');
select public.bn_set_pins((select id from t), 'sari', '4321', '975310');
insert into v select 'code', public.bn_device_code((select id from t));
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2'); -- the shared register
select public.bn_device_join((select v from v where k = 'code'));
insert into v select k, public.bn_staff_login((select id from t), k, p)->>'token' from (values ('rina', '1234'), ('maya', '5678'), ('sari', '4321')) x(k, p);


-- 1. a cash out written as already done, or done with no approval behind it: refused
select pg_temp.expect($$ select pg_temp.w('[{"op":"put","coll":"cashMoves","id":"cm1","data":{"id":"cm1","sessionId":"S-1","outletId":"sen","kind":"out","amount":400000,"reason":"x","by":"rina","at":1,"status":"done"}}]', 'rina') $$, 'BN060');
select pg_temp.w('[{"op":"put","coll":"cashMoves","id":"cm2","data":{"id":"cm2","sessionId":"S-1","outletId":"sen","kind":"out","amount":40000,"reason":"es batu","by":"rina","at":1,"status":"waiting"}},
  {"op":"put","coll":"approvals","id":"c2","data":{"id":"c2","type":"cash_out","level":"pic","status":"waiting","requestedBy":"rina","outletId":"sen","subjectId":"cm2","amount":40000}}]', 'rina');
select pg_temp.expect($$ select pg_temp.w('[{"op":"put","coll":"cashMoves","id":"cm2","data":{"id":"cm2","sessionId":"S-1","outletId":"sen","kind":"out","amount":40000,"reason":"es batu","by":"rina","at":1,"status":"done"}}]', 'rina') $$, 'BN060');
-- 2. Maya signs the 40k; the amount can't become 450k afterwards
select public.bn_check_approval_pin((select id from t), 'maya', '135790');
select pg_temp.w('[{"op":"put","coll":"approvals","id":"c2","data":{"id":"c2","type":"cash_out","level":"pic","status":"approved","requestedBy":"rina","decidedBy":"maya","outletId":"sen","subjectId":"cm2","amount":40000}},
  {"op":"put","coll":"cashMoves","id":"cm2","data":{"id":"cm2","sessionId":"S-1","outletId":"sen","kind":"out","amount":40000,"reason":"es batu","by":"rina","at":1,"status":"done"}}]', 'rina');
select pg_temp.expect($$ select pg_temp.w('[{"op":"put","coll":"cashMoves","id":"cm2","data":{"id":"cm2","sessionId":"S-1","outletId":"sen","kind":"out","amount":450000,"reason":"es batu","by":"rina","at":1,"status":"done"}}]', 'rina') $$, 'BN060');
-- a drop or cash in is recorded at once and never changed
select pg_temp.w('[{"op":"put","coll":"cashMoves","id":"cm3","data":{"id":"cm3","sessionId":"S-1","outletId":"sen","kind":"drop","amount":200000,"reason":"safe","by":"rina","at":2,"status":"done"}}]', 'rina');
select pg_temp.expect($$ select pg_temp.w('[{"op":"put","coll":"cashMoves","id":"cm3","data":{"id":"cm3","sessionId":"S-1","outletId":"sen","kind":"drop","amount":900000,"reason":"safe","by":"rina","at":2,"status":"done"}}]', 'rina') $$, 'BN060');

-- 3. a drawer 300k short needs the manager: the cashier can't close it herself or rewrite the count
select pg_temp.w('[{"op":"put","coll":"sessions","id":"S-1","data":{"id":"S-1","outletId":"sen","cashierId":"rina","openedAt":1,"openingFloat":300000,"closedAt":null,"counted":null,"variance":null,"status":"open","note":""}}]', 'rina');
select pg_temp.w('[{"op":"put","coll":"sessions","id":"S-1","data":{"id":"S-1","outletId":"sen","cashierId":"rina","openedAt":1,"openingFloat":300000,"closedAt":null,"counted":0,"variance":-300000,"status":"needs_approval","note":"hilang"}},
  {"op":"put","coll":"approvals","id":"v1","data":{"id":"v1","type":"variance","level":"manager","status":"waiting","requestedBy":"rina","countedBy":"rina","outletId":"sen","subjectId":"S-1","amount":300000}}]', 'rina');
select pg_temp.expect($$ select pg_temp.w('[{"op":"put","coll":"sessions","id":"S-1","data":{"id":"S-1","outletId":"sen","cashierId":"rina","openedAt":1,"openingFloat":300000,"closedAt":5,"counted":0,"variance":-300000,"status":"closed","note":"hilang"}}]', 'rina') $$, 'BN059');
select pg_temp.expect($$ select pg_temp.w('[{"op":"put","coll":"sessions","id":"S-1","data":{"id":"S-1","outletId":"sen","cashierId":"rina","openedAt":1,"openingFloat":300000,"closedAt":null,"counted":300000,"variance":0,"status":"needs_approval","note":"hilang"}}]', 'rina') $$, 'BN059');
-- the owner signs it with his PIN: closed, and final
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select public.bn_set_pins((select id from t), 'budi', '1111', '246810');
select public.bn_check_approval_pin((select id from t), 'budi', '246810');
select public.bn_write((select id from t), '[{"op":"put","coll":"approvals","id":"v1","data":{"id":"v1","type":"variance","level":"manager","status":"approved","requestedBy":"rina","countedBy":"rina","decidedBy":"budi","outletId":"sen","subjectId":"S-1","amount":300000}},
  {"op":"put","coll":"sessions","id":"S-1","data":{"id":"S-1","outletId":"sen","cashierId":"rina","openedAt":1,"openingFloat":300000,"closedAt":6,"counted":0,"variance":-300000,"status":"closed","note":"hilang"}}]'::jsonb, 'x', 'budi');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select pg_temp.expect($$ select pg_temp.w('[{"op":"put","coll":"sessions","id":"S-1","data":{"id":"S-1","outletId":"sen","cashierId":"rina","openedAt":1,"openingFloat":300000,"closedAt":6,"counted":0,"variance":-300000,"status":"counting","note":"hilang"}}]', 'rina') $$, 'BN059');
reset role;
select 'cash on the server holds' as result;
rollback;
