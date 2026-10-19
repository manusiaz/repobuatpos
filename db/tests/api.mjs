// The own-PostgreSQL backend end to end: the /api/bn route handlers against the freshly installed test database.
// Run by run.sh: DATABASE_URL=… node --experimental-strip-types db/tests/api.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

process.env.NEXT_PUBLIC_BORNIZ_ROOT_DOMAIN = 'bornis.id';
const { POST, GET } = await import('../../app/api/bn/[...op]/route.ts');
const { totp } = await import('../../src/integrations/server/session.ts');
const { pool } = await import('../../src/integrations/server/db.ts');

const jar = { a: '', b: '' };
async function api(who, path, body = {}, host = 'app.bornis.id') {
  const req = new Request('https://app.bornis.id/api/bn/' + path, { method: 'POST', headers: { host, 'x-forwarded-proto': 'https', 'content-type': 'application/json', ...(jar[who] ? { cookie: 'bn_session=' + jar[who] } : {}) }, body: JSON.stringify(body) });
  const res = await POST(req, { params: Promise.resolve({ op: path.split('/') }) });
  const c = res.headers.get('set-cookie');
  if (c) jar[who] = /bn_session=([^;]*)/.exec(c)[1];
  return { status: res.status, cookie: c, ...(await res.json()) };
}

// accounts and sessions
let r = await api('a', 'auth/signup', { email: 'Owner@KopiA.id', password: 'rahasia123', data: { name: 'Budi', phone: '0812' } });
assert.equal(r.error, null); assert.equal(r.data.user.email, 'owner@kopia.id'); assert.equal(r.data.user.user_metadata.name, 'Budi');
assert.match(r.cookie, /HttpOnly/); assert.match(r.cookie, /Domain=\.bornis\.id/); assert.match(r.cookie, /Secure/);
assert.equal((await api('x', 'auth/signup', { email: 'owner@kopia.id', password: 'rahasia123' })).error.message, 'User already registered');
assert.equal((await api('x', 'auth/signin', { email: 'owner@kopia.id', password: 'salah' })).error.message, 'Invalid login credentials');
assert.equal((await api('a', 'auth/user')).data.user.email, 'owner@kopia.id');
const stored = await pool().query("select encrypted_password p from auth.users where email = 'owner@kopia.id'");
assert.match(stored.rows[0].p, /^scrypt\$/); assert.ok(!stored.rows[0].p.includes('rahasia123'), 'password never stored');

// a business, through the same database functions the app calls
r = await api('a', 'rpc/bn_bootstrap', { p_name: 'Kopi A', p_slug: 'kopi-a', p_employee_id: 'owner' });
assert.equal(r.error, null); const A = r.data;
assert.equal((await api('a', 'rpc/bn_bootstrap', { p_name: 'Kopi X', p_slug: 'pos', p_employee_id: 'owner' })).error.code, '23514', 'platform name refused');
r = await api('a', 'read/members'); assert.deepEqual(r.data.map(m => [m.slug, m.role]), [['kopi-a', 'owner']]);
r = await api('a', 'rpc/bn_import', { p_tenant: A, p_ops: [{ op: 'put', coll: 'outlets', id: 'main', data: { id: 'main', name: 'Pusat' } }] });
assert.equal(r.error, null, JSON.stringify(r.error));
r = await api('a', 'read/docs', { tenant: A, since: 0, from: 0 });
assert.ok(r.data.some(d => d.coll === 'outlets' && d.data.name === 'Pusat'));
assert.ok((await api('a', 'read/audit', { tenant: A })).data.some(x => x.action === 'import'));
assert.equal(typeof (await api('a', 'rpc/bn_reserve', { p_tenant: A, p_name: 'order', p_count: 5 })).data, 'number', 'bigint comes back as a number');

// another account sees nothing of business A
await api('b', 'auth/signup', { email: 'b@kopib.id', password: 'rahasia123' });
assert.deepEqual((await api('b', 'read/docs', { tenant: A, since: 0 })).data, [], 'RLS: not a member');
assert.match((await api('b', 'rpc/bn_import', { p_tenant: A, p_ops: [] })).error.message, /BN|member|denied/i);
assert.equal((await api('x', 'read/members')).status, 401);
assert.equal((await api('x', 'rpc/bn_nope', {})).status, 404);
assert.equal((await api('a', 'rpc/bn_bootstrap', { p_name: 'x', p_slug: 'x', p_employee_id: 'o', p_evil: 1 })).status, 400, 'unknown argument refused');

// second factor: once on, sign-in needs the code
const f = (await api('a', 'auth/mfa/enroll')).data;
assert.match(f.totp.uri, /^otpauth:\/\/totp\/BorNiz:/);
assert.equal((await api('a', 'auth/mfa/verify', { factorId: f.id, code: '000000' === totp(f.totp.secret) ? '111111' : '000000' })).status, 400);
assert.equal((await api('a', 'auth/mfa/verify', { factorId: f.id, code: totp(f.totp.secret) })).error, null);
assert.equal((await api('x', 'auth/signin', { email: 'owner@kopia.id', password: 'rahasia123' })).error.code, 'mfa_required');
r = await api('a', 'auth/signin', { email: 'owner@kopia.id', password: 'rahasia123', code: totp(f.totp.secret) });
const sha = t => require('node:crypto').createHash('sha256').update(t).digest('hex');
await pool().query("update auth.sessions set created_at = now() - interval '1 hour' where token_hash = $1", [sha(jar.a)]);
assert.equal((await api('a', 'auth/update', { password: 'dicuri123' })).status, 401, 'an old cookie cannot change the password');
assert.equal((await api('a', 'auth/mfa/unenroll', { factorId: f.id })).status, 400, 'an old cookie cannot turn 2FA off');
assert.deepEqual((await api('a', 'auth/mfa/list')).data.totp.map(x => x.status), ['verified']);
assert.equal(r.error, null);
assert.deepEqual((await api('a', 'auth/mfa/list')).data.totp.map(x => x.status), ['verified']);

// shared register: an anonymous device account
r = await api('d', 'auth/anonymous'); assert.equal(r.data.user.is_anonymous, true);

// password reset: one-time link back to this deployment only
const log = console.log; let mail = ''; console.log = m => { mail = String(m); };
await api('x', 'auth/reset', { email: 'b@kopib.id', redirectTo: 'https://evil.example/steal' });
console.log = log;
const link = /(https:\/\/\S+)/.exec(mail)[1];
assert.ok(link.startsWith('https://app.bornis.id/account/reset-password#bn_reset='), link);
const token = link.split('#bn_reset=')[1];
assert.equal((await api('x', 'auth/reset', { email: 'b@kopib.id', redirectTo: 'https://evil.example/x' }, 'evil.example')).status, 400, 'a forged Host never builds a reset link');
assert.equal((await api('b', 'auth/user')).data.user.email, 'b@kopib.id');
assert.equal((await api('c', 'auth/recover', { token })).error, null);
assert.equal((await api('c', 'auth/update', { password: 'baru12345' })).error, null);
assert.equal((await api('x', 'auth/recover', { token })).status, 400, 'a reset link works once');
assert.equal((await api('b', 'auth/user')).data.user, null, 'a reset ends every other session');
assert.equal((await api('b', 'auth/signin', { email: 'b@kopib.id', password: 'baru12345' })).error, null);
await api('a', 'auth/signout'); assert.equal((await api('a', 'auth/user')).data.user, null, 'signed out');
await api('a', 'auth/signin', { email: 'owner@kopia.id', password: 'rahasia123', code: totp(f.totp.secret) });

// live: a change to business A reaches its member's stream, not another account's
const live = async who => { const ac = new AbortController(); const res = await GET(new Request('https://app.bornis.id/api/bn/live?tenant=' + A, { headers: { cookie: 'bn_session=' + jar[who] }, signal: ac.signal }), { params: Promise.resolve({ op: ['live'] }) }); return { res, ac }; };
assert.equal((await live('b')).res.status, 403);
const { res, ac } = await live('a'); assert.equal(res.status, 200);
const reader = res.body.getReader(), dec = new TextDecoder(); let seen = '';
const until = async (re, ms = 5000) => { const end = Date.now() + ms; while (!re.test(seen) && Date.now() < end) { const t = await Promise.race([reader.read(), new Promise(ok => setTimeout(() => ok({ value: null }), 200))]); if (t.value) seen += dec.decode(t.value); } return re.test(seen); };
assert.ok(await until(/event: ready/));
await new Promise(ok => setTimeout(ok, 300)); // LISTEN is up
r = await api('a', 'rpc/bn_write', { p_tenant: A, p_ops: [{ op: 'put', coll: 'outlets', id: 'main', data: { id: 'main', name: 'Cabang 2' } }], p_action: 'outlet.updated', p_actor: 'owner', p_subject: 'main', p_outlet: 'main', p_op: 'op-live-1' });
assert.equal(r.error, null, JSON.stringify(r.error));
assert.ok(await until(/event: doc\ndata: .*"Cabang 2"/), 'live document change: ' + seen.slice(0, 300));
ac.abort();

console.log('own backend api holds');
await pool().end(); process.exit(0);
