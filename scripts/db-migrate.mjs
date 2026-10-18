// Installs or updates the BorNiz database on plain PostgreSQL: supabase/platform.sql, then every file in
// supabase/migrations not applied yet (name order, each once, each in its own transaction). Safe to run on every deploy.
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
await tx('platform.sql', readFileSync(join(root, 'supabase/platform.sql'), 'utf8'));
await db.query('create table if not exists public.bn_migrations (name text primary key, applied_at timestamptz not null default now())');
await db.query('revoke all on public.bn_migrations from anon, authenticated');
const done = new Set((await db.query('select name from public.bn_migrations')).rows.map(r => r.name));
const files = readdirSync(join(root, 'supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
let applied = 0;
for (const f of files) {
  if (done.has(f)) continue;
  await tx(f, readFileSync(join(root, 'supabase/migrations', f), 'utf8') + `;\ninsert into public.bn_migrations (name) values (${db.escapeLiteral(f)});`);
  console.log('applied', f); applied++;
}
const admin = (await db.query('select current_user u')).rows[0].u;
if (appUser && appUser !== admin) {
  await db.query(`grant anon, authenticated to ${ident(appUser)}`);
  await db.query(`grant usage on schema auth to ${ident(appUser)}`);
  await db.query(`grant select, insert, update, delete on auth.users, auth.sessions, auth.mfa_factors to ${ident(appUser)}`);
}
console.log(applied ? `${applied} migration(s) applied` : 'database is up to date', `(${files.length} in supabase/migrations)`);
await db.end();
