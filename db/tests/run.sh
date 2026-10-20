#!/bin/sh
# Fresh scratch database → db/platform.sql (the real platform, no Supabase) → every migration in order → behaviour tests.
set -e
cd "$(dirname "$0")/../.."
URL=${BN_TEST_URL:-postgres://postgres@localhost:5433}
psql "$URL/postgres" -qX -v ON_ERROR_STOP=1 -c 'drop database if exists bn_test' -c 'create database bn_test'
# the same installer as production (deploy/update.sh): twice, the second run must change nothing
DATABASE_URL="$URL/bn_test" node scripts/db-migrate.mjs >/dev/null
DATABASE_URL="$URL/bn_test" node scripts/db-migrate.mjs | grep -q 'database is up to date' && echo 'installer holds'
# the API (app/api/bn) as production runs it: a login role that is not a superuser
APP=$(echo "$URL" | sed 's#//[^@/]*@#//bn_test_app:bn_test_app@#')
psql "$URL/postgres" -qX -c "do \$\$ begin create role bn_test_app login password 'bn_test_app'; exception when duplicate_object then null; end \$\$" >/dev/null
DATABASE_ADMIN_URL="$URL/bn_test" DATABASE_URL="$APP/bn_test" BORNIZ_SERVER_SECRET=api-test-secret node scripts/db-migrate.mjs >/dev/null
DATABASE_URL="$APP/bn_test" node --experimental-strip-types db/tests/api.mjs 2>/dev/null | grep hold
psql "$URL/bn_test" -qX -c "delete from private.secrets" >/dev/null # the SQL suites set their own
out=$(psql "$URL/bn_test" -qXAt -v ON_ERROR_STOP=1 -f db/tests/core.sql -f db/tests/server.sql -f db/tests/cells.sql -f db/tests/owner_docs.sql -f db/tests/attendance.sql -f db/tests/platform_admin.sql -f db/tests/hardening.sql -f db/tests/staff_sessions.sql -f db/tests/tenant_hosts.sql -f db/tests/guest_fire.sql -f db/tests/approvals_db.sql -f db/tests/stock_db.sql -f db/tests/cash_db.sql -f db/tests/beans_db.sql)
echo "$out" | grep -E 'hold'
node --experimental-strip-types db/tests/gateway.mjs 2>/dev/null | grep hold
node --experimental-strip-types db/tests/staff-actions.mjs 2>/dev/null | grep hold
node db/tests/beans-race.mjs 2>/dev/null | grep hold
sh db/tests/move.sh | grep -E hold
node --experimental-strip-types db/tests/cells-api.mjs 2>/dev/null | grep hold
DATABASE_URL="$URL/bn_test" node --experimental-strip-types db/tests/live-load.mjs 2>/dev/null | grep hold
