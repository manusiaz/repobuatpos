// Two tablets add a register at the same moment on Free (room for one): only one gets it (plan_rules takes a lock per
// business and kind before it counts, 20261023020000_borniz_plan_lock.sql).
import assert from 'node:assert/strict';
import pg from 'pg';

const URL = process.env.BN_TEST_URL || 'postgres://postgres@localhost:5433';
const DB = process.env.BN_RACE_DB || 'bn_test';
const a = new pg.Client({ connectionString: URL + '/' + DB }), b = new pg.Client({ connectionString: URL + '/' + DB });
await a.connect(); await b.connect();
const run = Date.now().toString(36), owner = (await a.query('insert into auth.users (email) values ($1) returning id', [`planrace-${run}@kopi.id`])).rows[0].id;
const begin = async c => { await c.query('begin'); await c.query("select set_config('request.jwt.claim.sub', $1, true)", [owner]); await c.query('set local role authenticated'); };
await begin(a);
const T = (await a.query("select public.bn_bootstrap('Kopi Plan Race', $1, 'budi') r", ['kopi-race-' + run])).rows[0].r;
const write = (c, ops) => c.query("select public.bn_write($1, $2, 'test', 'budi') r", [T, JSON.stringify(ops)]);
await write(a, [{ op: 'put', coll: 'outlets', id: 'main', data: { id: 'main', name: 'Main' } }]);
await a.query('commit');

const reg = id => [{ op: 'put', coll: 'devices', id, data: { id, outletId: 'main', kind: 'pos', name: id } }];
await begin(a); await begin(b);
await write(a, reg('r1'));
const second = write(b, reg('r2')).then(() => null, e => e.message);
await new Promise(ok => setTimeout(ok, 300));
await a.query('commit');
const err = await second;
await b.query(err ? 'rollback' : 'commit');
assert.match(err ?? 'both passed', /BN076/);
assert.equal(Number((await a.query("select count(*) n from public.docs where tenant_id = $1 and coll = 'devices'", [T])).rows[0].n), 1, 'one register on Free');
await a.end(); await b.end();
console.log('plan race holds');
