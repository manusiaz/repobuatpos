// Two writers at the same moment (two registers, a register and the worker): the member's balance can't go negative and a
// paid order is finished once, beans and all (migration beans_rules: per-member lock, the precondition locks its row).
import assert from 'node:assert/strict';
import pg from 'pg';

const URL = process.env.BN_TEST_URL || 'postgres://postgres@localhost:5433';
const DB = process.env.BN_RACE_DB || 'bn_test';
const a = new pg.Client({ connectionString: URL + '/' + DB }), b = new pg.Client({ connectionString: URL + '/' + DB });
await a.connect(); await b.connect();
const owner = (await a.query("insert into auth.users (email) values ('race@kopi.id') returning id")).rows[0].id;
const begin = async c => { await c.query('begin'); await c.query("select set_config('request.jwt.claim.sub', $1, true)", [owner]); await c.query('set local role authenticated'); };
await begin(a);
const T = (await a.query("select public.bn_bootstrap('Kopi Race', 'kopi-race', 'budi') r")).rows[0].r;
const write = (c, ops) => c.query("select public.bn_write($1, $2, 'test', 'budi') r", [T, JSON.stringify(ops)]);
await write(a, [
  { op: 'put', coll: 'customers', id: 'c1', data: { id: 'c1', name: 'Dewi', phone: '0811', joinedAt: 1, credit: 0, deposit: 0 } },
  { op: 'put', coll: 'ledger', id: 'l0', data: { customerId: 'c1', points: 200, reason: 'Adjustment · start', at: 1 } },
  { op: 'put', coll: 'orders', id: 'o1', data: { id: 'o1', no: '#1', source: 'qr', status: 'paying', outletId: 'main', customerId: 'c1', lines: [], subtotal: 50000, discount: 0, total: 50000 } }]);
await a.query('commit');

/** A and B send their write together; A commits a moment later. B's answer once A is done. */
async function race(opsA, opsB) {
  await begin(a); await begin(b);
  await write(a, opsA);
  const second = write(b, opsB).then(() => null, e => e.message);
  await new Promise(ok => setTimeout(ok, 300));
  await a.query('commit');
  const err = await second;
  await b.query(err ? 'rollback' : 'commit');
  return err;
}
const sum = async () => Number((await a.query("select coalesce(sum((data->>'points')::numeric), 0) s from public.docs where tenant_id = $1 and coll = 'ledger'", [T])).rows[0].s);

// two registers redeem 150 of Dewi's 200 at once
const redeem = id => [{ op: 'put', coll: 'ledger', id, data: { customerId: 'c1', points: -150, reason: 'Redeem · latte', at: 2 } }];
assert.match(await race(redeem('r1'), redeem('r2')) ?? 'both passed', /BN003/);
assert.equal(await sum(), 50, 'one redeem, never negative');

// the register and the worker both finish the QRIS-paid order
const finish = at => [{ op: 'put', coll: 'orders', id: 'o1', expect: { status: 'paying' }, data: { id: 'o1', no: '#1', source: 'qr', status: 'paid', outletId: 'main', customerId: 'c1', lines: [], subtotal: 50000, discount: 0, total: 50000 } },
  { op: 'put', coll: 'ledger', id: 'e' + at, data: { customerId: 'c1', points: 50, reason: 'Order #1', orderId: 'o1', at } }];
assert.match(await race(finish(3), finish(4)) ?? 'both passed', /BN040/);
assert.equal(await sum(), 100, 'the order earned once');

console.log('beans race holds');
await a.end(); await b.end();
