// A merchant on its own database, as the API routes it: run after db/tests/move.sh (kopibiru and warung2 moved from
// bn_src to bn_dst as cell "kb"). Calls without a business id find the right database too.
import assert from 'node:assert/strict';

const URL = process.env.BN_TEST_URL || 'postgres://postgres@localhost:5433';
Object.assign(process.env, { DATABASE_URL: URL + '/bn_src', BORNIZ_SERVER_SECRET: 's1', BORNIZ_DB_CELLS: JSON.stringify({ kb: URL + '/bn_dst' }), BORNIZ_CELLS: JSON.stringify({ kb: 's2' }), NEXT_PUBLIC_BORNIZ_ROOT_DOMAIN: 'bornis.id', NEXT_PUBLIC_BORNIZ_ROUTING: 'subdomain' });
const { POST } = await import('../../app/api/bn/[...op]/route.ts');
const { pool, rpc } = await import('../../src/integrations/server/db.ts');
const { newSession } = await import('../../src/integrations/server/session.ts');
const { runTenant } = await import('../../src/integrations/server/worker.ts');
const src = pool(null), dst = pool('kb'), T = (await dst.query("select id from public.tenants where slug = 'kopibiru'")).rows[0].id;
const api = async (path, body, cookie = '', host = 'kopibiru.bornis.id', tenant = '') => (await POST(new Request('https://' + host + '/api/bn/' + path, { method: 'POST', headers: { host, 'content-type': 'application/json', ...(cookie ? { cookie: 'bn_session=' + cookie } : {}), ...(tenant ? { 'x-borniz-tenant': tenant } : {}) }, body: JSON.stringify(body) }), { params: Promise.resolve({ op: path.split('/') }) })).json();

// the guest menu comes from the business's own database, not the frozen copy
await rpc('bn_server_write', { p_tenant: T, p_ops: [{ op: 'put', coll: 'products', id: 'p2', data: { id: 'p2', name: 'Es Kopi Baru', basePrice: 22000, status: 'live' } }], p_action: 'test' });
let r = await api('rpc/bn_public_snapshot', { p_slug: 'kopibiru' });
assert.ok(r.data.docs.some(d => d.id === 'p2'), 'menu after the move: ' + JSON.stringify(r.error));

// the attendance machine finds its business in the shared copy, which refuses (BN050): the scan lands in the cell
r = await rpc('bn_machine_clock', { p_sn: 'SN-MOVE-1', p_rows: [{ pin: '1', time: '2026-10-20 08:00:00', status: '0' }] });
assert.equal(r.saved, 1);
assert.equal((await dst.query("select count(*)::int n from public.docs where coll = 'clock' and tenant_id = $1", [T])).rows[0].n, 1);

// an account made after the move (a new shared register, a new manager) exists on the platform only: copied on first use
const u = (await src.query("insert into auth.users (is_anonymous) values (true) returning id")).rows[0].id;
await api('rpc/bn_is_member', { p_tenant: T }, await newSession(u));
assert.equal((await dst.query('select count(*)::int n from auth.users where id = $1', [u])).rows[0].n, 1, 'account row copied to the cell');

// the owner makes a shared register from app.bornis.id: the code is made in the cell, the tablet joins there
const code = (await api('rpc/bn_device_code', { p_tenant: T }, await newSession('00000000-0000-0000-0000-00000000000a'), 'app.bornis.id')).data;
const tab = await newSession((await src.query("insert into auth.users (is_anonymous) values (true) returning id")).rows[0].id);
r = await api('rpc/bn_device_join', { p_code: code }, tab, 'app.bornis.id', T);
assert.equal(r.error, null, 'device joins the moved business: ' + JSON.stringify(r.error));

// super admin changes the plan: the registry here and the business's own copy there, no BN050
const a = '00000000-0000-0000-0000-00000000000a';
await src.query('insert into private.platform_admins (user_id) values ($1) on conflict do nothing', [a]);
r = await api('rpc/bn_admin_set_plan', { p_tenant: T, p_plan: 'pro' }, await newSession(a), 'admin.bornis.id');
assert.equal(r.error, null, JSON.stringify(r.error));
assert.equal((await src.query('select plan from public.tenants where id = $1', [T])).rows[0].plan, 'pro');
assert.equal((await dst.query('select plan from public.tenants where id = $1', [T])).rows[0].plan, 'pro');

// the automation worker runs the moved business from its own database
const list = await rpc('bn_server_tenants', {});
assert.ok(list.some(t => t.slug === 'kopibiru' && t.cell === 'kb'));
await runTenant(list.find(t => t.slug === 'kopibiru'));

console.log('cells api holds');
await src.end(); await dst.end(); process.exit(0);
