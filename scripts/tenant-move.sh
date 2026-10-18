#!/bin/sh
# Hybrid tenancy: move one merchant from the shared database to its own database ("cell").
#   SRC=<shared db url> DST=<new db url> scripts/tenant-move.sh <slug> <cell-id> <cell api url> <cell publishable key>
# DST is a new PostgreSQL database installed with npm run db:migrate (platform.sql + db/migrations) and its own private.secrets
# ('server', 'secrets_key'). Integration secrets are re-encrypted with the new key. Afterwards the shared database
# keeps the old rows read-only as a backup and refuses writes for this merchant (BN050); bn_tenant_cell sends its
# app., pos., kds., display. and order. traffic to the new database. Login accounts move with it (same passwords).
set -eu
slug=${1:?slug} cell=${2:?cell id} api=${3:?api url} key=${4:?publishable key}
: "${SRC:?SRC database url}" "${DST:?DST database url}"
echo "$slug" | grep -Eq '^[a-z0-9][a-z0-9-]{1,40}$' || { echo "bad slug" >&2; exit 1; }
echo "$cell" | grep -Eq '^[a-z0-9][a-z0-9-]{1,40}$' || { echo "bad cell id" >&2; exit 1; }
src() { psql "$SRC" -qXAt -v ON_ERROR_STOP=1 "$@"; }
dst() { psql "$DST" -qXAt -v ON_ERROR_STOP=1 "$@"; }

T=$(src -c "select id from public.tenants where slug = '$slug' and cell is null")
[ -n "$T" ] || { echo "$slug is not in the shared database (unknown or already moved)" >&2; exit 1; }
[ "$(dst -c "select count(*) from public.tenants where id = '$T'")" = 0 ] || { echo "$slug already exists in the target" >&2; exit 1; }
[ -n "$(dst -c "select 1 from private.secrets where name = 'secrets_key'")" ] || { echo "target has no private.secrets secrets_key" >&2; exit 1; }

# copy <table> <columns> <where>: rows go straight from one database to the other; target triggers are off for the copy
copy() { src -c "\\copy (select $2 from $1 where $3) to stdout" | dst -c "set session_replication_role = replica" -c "\\copy $1 ($2) from stdin"; }
cols() { src -c "select string_agg(quote_ident(column_name), ',' order by ordinal_position) from information_schema.columns where table_schema = '${1%.*}' and table_name = '${1#*.}' and is_generated = 'NEVER' and identity_generation is distinct from 'ALWAYS'"; }
users="id in (select user_id from public.members where tenant_id = '$T')"
mine="tenant_id = '$T'"

# freeze first so no sale lands in the old database mid-copy (devices get BN050 and retry); undo on any failure
src -c "insert into public.cells (id, url, publishable_key) values ('$cell', '$api', '$key') on conflict (id) do update set url = excluded.url, publishable_key = excluded.publishable_key" \
    -c "update public.tenants set cell = '$cell' where id = '$T'"
trap 'src -c "update public.tenants set cell = null where id = '"'"'$T'"'"'" >/dev/null; echo "move failed; $slug stays in the shared database" >&2' EXIT

copy auth.users "$(cols auth.users)" "$users"
[ -n "$(src -c "select to_regclass('auth.identities')")" ] && copy auth.identities "$(cols auth.identities)" "user_id in (select user_id from public.members where tenant_id = '$T')"
copy public.tenants "$(cols public.tenants)" "id = '$T'"
dst -c "update public.tenants set cell = null where id = '$T'"   # its data lives there now
for t in public.members public.docs public.audit_log public.payment_events private.staff_secrets private.sequences private.outbox; do
  copy "$t" "$(cols "$t")" "$mine"
done
# integration secrets: decrypt with the shared key, encrypt with the target's key, never written to disk
src -c "\\copy (select integration_id, extensions.pgp_sym_decrypt(enc, (select value from private.secrets where name = 'secrets_key')), updated_at, updated_by from private.integration_secrets where $mine) to stdout" |
  dst -c "create temp table s (integration_id text, plain text, updated_at timestamptz, updated_by uuid)" -c "\\copy s from stdin" \
      -c "insert into private.integration_secrets select '$T', integration_id, extensions.pgp_sym_encrypt(plain, (select value from private.secrets where name = 'secrets_key')), updated_at, updated_by from s"

# every table must match before the switch
for t in public.members public.docs public.audit_log public.payment_events private.staff_secrets private.sequences private.integration_secrets private.outbox; do
  a=$(src -c "select count(*) from $t where $mine") b=$(dst -c "select count(*) from $t where $mine")
  [ "$a" = "$b" ] || { echo "count mismatch in $t: $a here, $b there; nothing switched" >&2; exit 1; }
done

trap - EXIT
echo "$slug moved to $cell"
