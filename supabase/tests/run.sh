#!/bin/sh
# Fresh scratch database → platform stub → every migration in order → behaviour tests.
set -e
cd "$(dirname "$0")/../.."
URL=${BN_TEST_URL:-postgres://postgres@localhost:5433}
psql "$URL/postgres" -qX -v ON_ERROR_STOP=1 -c 'drop database if exists bn_test' -c 'create database bn_test'
set -- -f supabase/tests/stub.sql
for f in supabase/migrations/*.sql; do set -- "$@" -f "$f"; done
out=$(psql "$URL/bn_test" -qXAt -v ON_ERROR_STOP=1 "$@" -f supabase/tests/core.sql -f supabase/tests/server.sql -f supabase/tests/cells.sql -f supabase/tests/owner_docs.sql -f supabase/tests/attendance.sql -f supabase/tests/platform_admin.sql -f supabase/tests/hardening.sql -f supabase/tests/staff_sessions.sql -f supabase/tests/tenant_hosts.sql)
echo "$out" | grep -E 'hold'
sh supabase/tests/move.sh | grep -E hold
