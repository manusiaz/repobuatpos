// Gateway money on a real database. The automation worker, no device open (src/integrations/server/worker.ts): one pass
// settles every gateway order, even several sharing a document (the same promo), and sends the queued messages without
// losing the rest of its write. The gateway refund (app/api/payments/refund): once per approval, even when saving fails after.
import assert from 'node:assert/strict';

const URL = process.env.BN_TEST_URL || 'postgres://postgres@localhost:5433';
Object.assign(process.env, { DATABASE_URL: URL + '/bn_test', BORNIZ_SERVER_SECRET: 'worker-test-secret' });
const { pool } = await import('../../src/integrations/server/db.ts');
const { runTenant } = await import('../../src/integrations/server/worker.ts');
const { newSession } = await import('../../src/integrations/server/session.ts');
const { POST: refund } = await import('../../app/api/payments/refund/route.ts');
const db = pool();
await db.query("insert into private.secrets (name, value) values ('server', 'worker-test-secret') on conflict (name) do update set value = excluded.value");
const u = (await db.query("insert into auth.users (email) values ('worker@kopiw.id') returning id")).rows[0].id;
const c = await db.connect();
await c.query("select set_config('request.jwt.claim.sub', $1, false)", [u]);
await c.query('set role authenticated');
const T = (await c.query("select public.bn_bootstrap('Kopi Worker', 'kopi-worker', 'budi') id")).rows[0].id;
await c.query('reset role'); c.release();

const at = Date.now() - 60e3, order = id => ({ id, no: id.toUpperCase(), source: 'qr', type: 'dine', status: 'paying', outletId: 'main', sessionId: null, table: null, customerId: 'c1', lines: [{ id: 'l1', productId: 'p1', name: 'Kopi', qty: 1, unitPrice: 10000, mods: [], status: 'new' }], discountPct: 0, promoIds: ['pr1'], guests: 1,
  subtotal: 10000, discount: 0, service: 0, tax: 0, total: 10000, createdAt: at, paidAt: null, cashierId: null, idemKey: id });
const pay = (id, orderId) => ({ id, orderId, outletId: 'main', method: 'qris', amount: 10000, tip: 0, status: 'settled', ref: 'GW-' + id, at, expiresAt: null, sessionId: null });
const ops = [
  { op: 'put', coll: 'outlets', id: 'main', data: { id: 'main', name: 'Pusat', serviceBps: 0, taxBps: 0 } },
  { op: 'put', coll: 'employees', id: 'budi', data: { id: 'budi', name: 'Budi', role: 'owner', outlets: ['main'] } },
  { op: 'put', coll: 'integrations', id: 'wa1', data: { id: 'wa1', kind: 'whatsapp', connector: 'wa-simulator', enabled: true, outletId: null, config: {}, secrets: [] } },
  { op: 'put', coll: 'customers', id: 'c1', data: { id: 'c1', name: 'Tamu', phone: '+628111', joinedAt: at, visits: 0, spend: 0, deposit: 0, credit: 0 } },
  { op: 'put', coll: 'promos', id: 'pr1', data: { id: 'pr1', name: 'Pagi', kind: 'pct', value: 0, used: 0 } },
  { op: 'put', coll: 'orders', id: 'o1', data: order('o1') }, { op: 'put', coll: 'orders', id: 'o2', data: order('o2') },
  { op: 'put', coll: 'payments', id: 'pay1', data: pay('pay1', 'o1') }, { op: 'put', coll: 'payments', id: 'pay2', data: pay('pay2', 'o2') },
  { op: 'put', coll: 'messages', id: 'm1', data: { id: 'm1', channel: 'wa', template: 'e_receipt', to: '+628111', status: 'queued', at, customerId: 'c1' } },
];
const g = await db.connect(); // as the gateway settled them (bn_gateway_update)
await g.query('begin'); await g.query("select set_config('bn.gateway', 'on', true)");
await g.query("select public.bn_server_write('worker-test-secret', $1, $2, 'test')", [T, JSON.stringify(ops)]);
await g.query('commit'); g.release();

await runTenant({ id: T, slug: 'kopi-worker', name: 'Kopi Worker', plan: 'free' });
const doc = async (coll, id) => (await db.query('select data from public.docs where tenant_id = $1 and coll = $2 and id = $3', [T, coll, id])).rows[0]?.data;
assert.equal((await doc('orders', 'o1')).status, 'paid');
assert.equal((await doc('orders', 'o2')).status, 'paid', 'the second order on the same promo settles in the same pass');
assert.equal((await doc('promos', 'pr1')).used, 2);
assert.equal((await doc('messages', 'm1')).status, 'sent');
assert.ok((await db.query("select 1 from public.audit_log where tenant_id = $1 and action = 'automation'", [T])).rowCount, 'the automation write landed next to the sent message');


// refund: the gateway paid back, then saving it failed; the manager tries again → the gateway is not asked twice
const cookie = await newSession(u);
const ask = async () => { const res = await refund(new Request('https://kopi-worker.bornis.id/api/payments/refund', { method: 'POST', headers: { 'content-type': 'application/json', 'x-borniz-tenant': T, cookie: 'bn_session=' + cookie },
  body: JSON.stringify({ paymentId: 'pay1', approvalId: 'r1', amount: 10000, reason: 'salah pesan' }) })); return { status: res.status, ...(await res.json()) }; };
const r = await db.connect(); // the refund approved earlier by the manager's PIN (proven in approvals_db.sql)
await r.query('begin'); await r.query('set local session_replication_role = replica');
await r.query("select public.bn_server_write('worker-test-secret', $1, $2, 'test')", [T, JSON.stringify([
  { op: 'put', coll: 'integrations', id: 'pg1', data: { id: 'pg1', kind: 'payment', connector: 'simulator', enabled: true, outletId: null, config: {}, secrets: [] } },
  { op: 'put', coll: 'approvals', id: 'r1', data: { id: 'r1', type: 'refund', status: 'approved', level: 'manager', requestedBy: 'rina', decidedBy: 'budi', outletId: 'main', subjectId: 'o1', amount: 10000 } }])]);
await r.query('commit'); r.release();
await db.query("update public.docs set data = data || '{\"provider\":\"simulator\"}' where tenant_id = $1 and coll = 'payments' and id = 'pay1'", [T]);
await db.query("create function pg_temp.down() returns trigger language plpgsql as $$ begin if new.data ? 'gatewayRefunded' then raise exception 'database went away'; end if; return new; end $$");
await db.query('create trigger down before update on public.docs for each row execute function pg_temp.down()').catch(async () => {
  await db.query("create function public.bn_test_down() returns trigger language plpgsql as $$ begin if new.data ? 'gatewayRefunded' then raise exception 'database went away'; end if; return new; end $$");
  await db.query('create trigger down before update on public.docs for each row execute function public.bn_test_down()'); });
const first = await ask(); assert.ok(first.status >= 400 && /went away/.test(first.message), 'saving failed after the gateway refunded: ' + JSON.stringify(first));
await db.query('drop trigger down on public.docs');
const again = await ask();
assert.equal(again.duplicate, true, 'the retry gets the first refund, the gateway is not asked again: ' + JSON.stringify(again));
assert.equal(again.ok, true);
await db.query("update private.outbox set status = 'sending' where tenant_id = $1 and key = 'refund:r1'", [T]);
assert.equal((await ask()).status, 409, 'a refund still being sent is not reported as done');

console.log('gateway holds');
await db.end(); process.exit(0);
