#!/bin/sh
# Hybrid tenancy end to end: two scratch databases, a business with data and an integration secret moves from
# the shared one to its own, then the shared one refuses its writes and the new one takes them.
set -e
cd "$(dirname "$0")/../.."
URL=${BN_TEST_URL:-postgres://postgres@localhost:5433}
for d in bn_src bn_dst; do
  psql "$URL/postgres" -qX -v ON_ERROR_STOP=1 -c "set client_min_messages = warning" -c "drop database if exists $d" -c "create database $d"
  set -- -f db/platform.sql; for f in db/migrations/*.sql; do set -- "$@" -f "$f"; done
  psql "$URL/$d" -qX -v ON_ERROR_STOP=1 "$@" >/dev/null
done
psql "$URL/bn_src" -qX -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into auth.users values ('00000000-0000-0000-0000-00000000000a');
insert into private.secrets values ('server', 's1'), ('secrets_key', 'k1');
set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
create temp table t as select public.bn_bootstrap('Kopi Biru', 'kopibiru', 'budi') as id;
select public.bn_write((select id from t), '[{"op":"put","coll":"outlets","id":"sen","data":{"id":"sen","name":"Senayan"}},{"op":"put","coll":"products","id":"p1","data":{"id":"p1","name":"Kopi","basePrice":25000,"status":"live"}}]'::jsonb, 'setup', 'budi');
select public.bn_set_pins((select id from t), 'budi', '1234', '246810');
select public.bn_set_secret((select id from t), 'midtrans', '{"serverKey":"SB-secret"}');
select public.bn_write((select id from t), '[{"op":"put","coll":"integrations","id":"zk1","data":{"id":"zk1","connector":"attendance-zkteco","kind":"attendance","outletId":"sen","name":"Attendance machine","enabled":true,"config":{"serial":"SN-MOVE-1","user.1":"budi"}}}]'::jsonb, 'setup', 'budi');
select public.bn_bootstrap('Warung Dua', 'warung2', 'budi'); -- the same person owns a second business
SQL
psql "$URL/bn_dst" -qX -c "insert into private.secrets values ('server', 's2'), ('secrets_key', 'k2')" >/dev/null
SRC="$URL/bn_src" DST="$URL/bn_dst" sh scripts/tenant-move.sh kopibiru kb >/dev/null
# the second business of the same owner moves into the same database: their account is already there
SRC="$URL/bn_src" DST="$URL/bn_dst" sh scripts/tenant-move.sh warung2 kb >/dev/null || { echo "second move of the same owner failed"; exit 1; }
q() { psql "$URL/$1" -qXAt -v ON_ERROR_STOP=1 -c "$2"; }
[ "$(q bn_dst "select count(*) from public.docs where tenant_id = (select id from public.tenants where slug = 'kopibiru')")" = 3 ] || { echo "docs not moved"; exit 1; }
[ "$(q bn_dst "select bn_get_secrets('s2', (select id from public.tenants where slug = 'kopibiru'), 'midtrans')->>'serverKey'")" = SB-secret ] || { echo "secret not re-encrypted"; exit 1; }
[ "$(q bn_src "select bn_tenant_cell('kopibiru')->>'cell'")" = kb ] || { echo "registry not switched"; exit 1; }
[ -z "$(q bn_dst "select string_agg(cell, '') from public.tenants")" ] || { echo "new home must own its data"; exit 1; }
w="set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false); select public.bn_write((select id from public.tenants where slug = 'kopibiru'), '[{\"op\":\"put\",\"coll\":\"outlets\",\"id\":\"kem\",\"data\":{\"id\":\"kem\"}}]'::jsonb, 'x', 'budi')"
q bn_dst "$w" >/dev/null || { echo "new home refuses writes"; exit 1; }
if q bn_src "$w" >/dev/null 2>&1; then echo "old home still takes writes"; exit 1; fi
[ "$(q bn_dst "select bool_and(pin_hash = extensions.crypt('1234', pin_hash))::text from private.staff_secrets where pin_hash is not null")" = true ] || { echo "PINs not moved"; exit 1; }
echo "tenant move holds"
