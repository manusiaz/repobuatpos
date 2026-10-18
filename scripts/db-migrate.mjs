// Installs or updates the BorNiz database on plain PostgreSQL: db/platform.sql, then every file in
// db/migrations not applied yet (name order, each once, each in its own transaction). Safe to run on every deploy.
//   DATABASE_ADMIN_URL  owner / superuser that runs the migrations (defaults to DATABASE_URL)
//   DATABASE_URL        the app's own login role: it gets the anon + authenticated roles and the account tables
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const adminUrl = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
if (!adminUrl) { console.error('Set DATABASE_URL (and DATABASE_ADMIN_URL when the app role is not the owner).'); process.exit(1); }
const appUser = process.env.DATABASE_URL ? decodeURIComponent(new URL(process.env.DATABASE_URL).username) : '';
const db = new pg.Client({ connectionString: adminUrl });
const ident = s => '"' + s.replace(/"/g, '""') + '"';

async function tx(label, sql) {
  await db.query('begin');
  try { await db.query(sql); await db.query('commit'); }
  catch (e) { await db.query('rollback'); console.error(`${label} failed: ${e.message}`); process.exit(1); }
}

await db.connect();
await tx('platform.sql', readFileSync(join(root, 'db/platform.sql'), 'utf8'));
await db.query('create table if not exists public.bn_migrations (name text primary key, applied_at timestamptz not null default now())');
await db.query('revoke all on public.bn_migrations from anon, authenticated');
const done = new Set((await db.query('select name from public.bn_migrations')).rows.map(r => r.name));
const files = readdirSync(join(root, 'db/migrations')).filter(f => f.endsWith('.sql')).sort();
let applied = 0;
for (const f of files) {
  if (done.has(f)) continue;
  await tx(f, readFileSync(join(root, 'db/migrations', f), 'utf8') + `;\ninsert into public.bn_migrations (name) values (${db.escapeLiteral(f)});`);
  console.log('applied', f); applied++;
}
// Production install: the server secret the app holds (BORNIZ_SERVER_SECRET) and a key for integration secrets,
// generated once inside the database and never printed.
if (process.env.BORNIZ_SERVER_SECRET) {
  await db.query("insert into private.secrets (name, value) values ('server', $1) on conflict (name) do update set value = excluded.value", [process.env.BORNIZ_SERVER_SECRET]);
  await db.query("insert into private.secrets (name, value) values ('secrets_key', encode(extensions.gen_random_bytes(32), 'hex')) on conflict (name) do nothing");
} else console.log('BORNIZ_SERVER_SECRET not set: payments, webhooks and attendance machines stay off until it is');
const admin = (await db.query('select current_user u')).rows[0].u;
if (appUser && appUser !== admin) {
  try { await db.query(`grant anon, authenticated to ${ident(appUser)}`); }
  catch (e) { console.error(`Cannot give ${appUser} the anon/authenticated roles (${e.message}). Once, as the postgres superuser: grant anon, authenticated to ${ident(appUser)};`); process.exit(1); }
  await db.query(`grant usage on schema auth to ${ident(appUser)}`);
  await db.query(`grant select, insert, update, delete on auth.users, auth.sessions, auth.mfa_factors, auth.one_time to ${ident(appUser)}`);
}
console.log(applied ? `${applied} migration(s) applied` : 'database is up to date', `(${files.length} in db/migrations)`);
await db.end();
