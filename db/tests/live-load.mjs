// Live updates under load (run by run.sh): 40 screens of one business, each its own account, one commit of 100 documents.
// Every screen gets every change, and an ordinary request is not held up meanwhile (it was 1.4 s before batching).
import { performance } from 'node:perf_hooks';
const URL = process.env.BN_TEST_URL || 'postgres://postgres@localhost:5433';
process.env.DATABASE_URL = URL + '/bn_test';
const { pool, call } = await import('../../src/integrations/server/db.ts');
const { subscribe } = await import('../../src/integrations/server/live.ts');
const N = 40, M = 100;
const p = pool(null);
const uid = (await p.query("insert into auth.users (email) values ('load' || floor(random()*1e9) || '@x.id') returning id")).rows[0].id;
const tid = await call('bn_bootstrap', { p_name: 'Load', p_slug: 'load-' + Math.floor(Math.random() * 1e6), p_employee_id: 'owner' }, uid);
let got = 0; const offs = [];
for (let i = 0; i < N; i++) { // every screen its own account: a shared register / KDS / display member
  const d = (await p.query("insert into auth.users (is_anonymous) values (true) returning id")).rows[0].id;
  await p.query("insert into public.members (tenant_id, user_id, employee_id, role) values ($1, $2, 'dev' || $3, 'device')", [tid, d, i]);
  offs.push(subscribe({ tenant: tid, uid: d, cell: null, send: e => { if (e === 'doc') got++; } }));
}
await new Promise(r => setTimeout(r, 800)); // LISTEN up
const ops = Array.from({ length: M }, (_, i) => ({ op: 'put', coll: 'products', id: 'p' + i, data: { id: 'p' + i, name: 'P' + i, basePrice: 1000, status: 'live' } }));
const t0 = performance.now();
await call('bn_write', { p_tenant: tid, p_ops: ops, p_action: 'load', p_actor: 'owner', p_op: 'op-' + Math.random() }, uid);
// an ordinary API call right after the commit (what a cashier's sign-in or write waits on)
let lat = 0;
while (got < N * M && performance.now() - t0 < 60000) { const t1 = performance.now(); await call('bn_is_member', { p_tenant: tid }, uid); lat = Math.max(lat, performance.now() - t1); await new Promise(r => setTimeout(r, 30)); }
if (got !== N * M) throw new Error(`delivered ${got} of ${N * M}`);
if (lat > 500) throw new Error(`a request waited ${Math.round(lat)} ms while live updates went out`);
console.log('live updates under load hold');
offs.forEach(f => f()); process.exit(0);
