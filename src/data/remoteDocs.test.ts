// Pure parts of the server adapter: doc ids, DB → document diff, document → DB merge, guest filter, error messages, finalizer need.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seed } from './seed.ts';
import type { DB } from './schema.ts';
import { allOps, applyDocs, diff, emptyDB, fromDocs, guestOps, hintOf, humanError, keysOf, MASK_PIN, opsToDocs, pinChanges, stable, SYNTHETIC, type Hint } from './remoteDocs.ts';
import { finalizeNeed } from './remoteFinalize.ts';
import { settleIfDone } from './actions.ts';

const S = seed(1_760_000_000_000);
const clone = (d: DB) => structuredClone(d);
/** Same rows per collection (stable JSON, any order; timed lists come back sorted by time), PINs masked, device-only fields out. */
const same = (d: DB) => Object.fromEntries(Object.entries({ ...d, employees: d.employees.map(e => ({ ...e, pin: e.pin ? MASK_PIN : '', approvalPin: e.approvalPin ? '••••••' : '' })), audit: [], counters: {}, device: null, v: 0 })
  .map(([k, v]) => [k, Array.isArray(v) ? v.map(x => stable(x)).sort() : stable(v)]));

test('doc ids: own id, composite keys, content keys for append-only rows, nothing for device-only rows', () => {
  assert.deepEqual(keysOf('orders', [{ id: 'o1' }, { id: 'o2' }]), ['o1', 'o2']);
  assert.equal(keysOf('outletProducts', [S.outletProducts[0]])[0], 'p1|sen');
  assert.equal(keysOf('roster', [S.roster[0]])[0], 'sen|0');
  const m = { outletId: 'sen', stockItemId: 'milk', qty: -0.15, type: 'sale', sourceId: 'o1', by: 'tono', at: 1 };
  const [a, b, c] = keysOf('movements', [m, { ...m }, { ...m, qty: -0.3 }]);
  assert.match(a, /^m[0-9a-z]+$/); assert.equal(b, a + '#1'); assert.notEqual(c, a);
  assert.equal(keysOf('movements', [{ at: 1, by: 'tono', sourceId: 'o1', type: 'sale', qty: -0.15, stockItemId: 'milk', outletId: 'sen' }])[0], a, 'key order does not matter');
  assert.deepEqual(keysOf('ledger', [{ customerId: 'c1', points: 9, reason: 'Opening balance', orderId: SYNTHETIC + 'opening', at: 0 }]), ['']);
});

test('diff: one commit becomes the document ops it changed, nothing else', () => {
  assert.deepEqual(diff(S, clone(S)), []);
  const n = clone(S);
  n.orders.push({ ...n.orders[0], id: 'o-new', status: 'open', createdAt: 5 });
  n.movements.push({ outletId: 'sen', stockItemId: 'milk', qty: -0.15, type: 'sale', sourceId: 'o-new', by: 'tono', at: 9 });
  n.notices.unshift({ id: 'nx', alert: 'New order', level: 'info', to: ['kitchen'], outletId: 'sen', text: 'x', href: null, at: 9, read: false });
  n.settings['/owner/x:y'] = true;
  n.records.assets = [{ id: 'r1', a: 'Grinder', b: '', c: '', d: '', e: '', at: 3 }];
  n.employees[0].approvalPin = '135790'; n.employees[0].name = 'Budi H';
  n.tenant.plan = 'enterprise';
  n.products.push({ ...n.products[0], id: 'p99' });
  const ops = diff(S, n), at = (c: string, id?: string) => ops.find(o => o.coll === c && (!id || o.id === id));
  assert.equal(at('orders', 'o-new')?.open, true); assert.equal(at('orders', 'o-new')?.t, 5); assert.equal(at('orders', 'o-new')?.fresh, true);
  assert.equal((at('movements')?.data as { qty: number }).qty, -0.15);
  assert.equal(at('notices', 'nx')?.op, 'put');
  assert.deepEqual(at('settings', '/owner/x:y')?.data, { k: '/owner/x:y', v: true });
  assert.equal(at('records', 'assets|r1')?.op, 'put');
  assert.equal(at('_meta', 'tenant')?.op, 'put');
  assert.deepEqual((at('_meta', 'order')?.data as Hint).products.slice(-1), ['p99']);
  const e = at('employees', 'budi')!.data as Record<string, unknown>;
  assert.equal('pin' in e || 'approvalPin' in e, false, 'PINs never go into documents'); assert.equal(e.hasApprovalPin, true);
  assert.deepEqual(pinChanges(S, n), [{ id: 'budi', pin: null, approvalPin: '135790' }]);
  assert.equal(ops.length, 9, ops.map(o => o.coll + '/' + o.id).join(' '));
  const m = clone(n); delete m.settings['/owner/x:y']; m.records.assets = [];
  assert.deepEqual(diff(n, m).map(o => o.op + ' ' + o.coll + '/' + o.id), ['del settings//owner/x:y', 'del records/assets|r1']);
});

test('round trip: every document of a dataset rebuilds the same DB (order, PIN masks, opening rows stay local)', () => {
  const docs = opsToDocs(allOps(S)), hint: Hint = {};
  const back = fromDocs(emptyDB(S), docs, hint);
  const a = same(back), b = same(S);
  for (const k of Object.keys(b)) assert.ok(JSON.stringify(a[k]) === JSON.stringify(b[k]), k);
  assert.ok(back.orders.every((o, i) => !i || back.orders[i - 1].createdAt <= o.createdAt) && back.approvals.every((x, i) => !i || back.approvals[i - 1].at >= x.at));
  assert.deepEqual(back.outlets.map(o => o.id), ['sen', 'kem', 'bsd'], 'catalog order kept by _meta/order');
  assert.deepEqual(hint, hintOf(S));
  assert.deepEqual(diff(back, structuredClone(back)), []);
  assert.equal(pinChanges(emptyDB(S), S).length, S.employees.length);
  assert.deepEqual(pinChanges(back, structuredClone(back)), [], 'masked PINs are never re-sent');
});

test('merge: remote changes replace in place, add in time order, delete; untouched collections keep their identity', () => {
  const d = fromDocs(emptyDB(S), opsToDocs(allOps(S)), {});
  const first = d.orders[0], o = d.orders[5];
  const m = applyDocs(d, [
    { coll: 'orders', id: o.id, data: { ...o, status: 'voided' } },
    { coll: 'orders', id: 'late', data: { ...o, id: 'late', createdAt: first.createdAt + 1 } },
    { coll: 'notices', id: 'n9', data: { ...d.notices[0], id: 'n9', at: Date.now() + 9e9 } },
    { coll: 'approvals', id: 'ap1', data: null },
    { coll: 'settings', id: 'k', data: { k: 'k', v: 3 } },
  ], {});
  assert.equal(m.orders[5].id === o.id ? m.orders[5].status : m.orders.find(x => x.id === o.id)?.status, 'voided');
  assert.equal(m.orders[1].id, 'late', 'an offline device’s older order lands in time order');
  assert.equal(m.notices[0].id, 'n9');
  assert.equal(m.approvals.some(a => a.id === 'ap1'), false);
  assert.equal(m.settings.k, 3);
  assert.equal(m.products, d.products);
  assert.equal(applyDocs(d, [], {}), d);
  const twice = applyDocs(d, [{ coll: 'promos', id: 'x', data: { id: 'x' } }, { coll: 'promos', id: 'x', data: { id: 'x', v: 2 } }], {});
  assert.equal(twice.promos.filter(p => p.id === 'x').length, 1);
});

test('guests only send their own order, a pending gateway payment and first-time rows', () => {
  const n = clone(S);
  n.orders.push({ ...n.orders[0], id: 'g1', source: 'qr', status: 'open' });
  n.payments.push({ ...n.payments[0], id: 'gp', orderId: 'g1', method: 'qris', status: 'pending' });
  n.reviews.unshift({ ...n.reviews[0], id: 'rv9' });
  n.customers[0].optIn = !n.customers[0].optIn;
  n.records.voucher_claims = [{ id: 'vc', a: 'payday', b: 'c1', c: '', d: '', e: '', at: 1 }];
  n.orders[0].rating = 5; // a closed order: not for guests
  assert.deepEqual(guestOps(diff(S, n)).map(o => o.coll + '/' + o.id), ['orders/g1', 'payments/gp', 'reviews/rv9']);
});

test('server guard codes read as one sentence', () => {
  assert.equal(humanError('BN004 QRIS payments are settled only by the payment gateway').code, 'BN004');
  assert.match(humanError('BN040 Changed on another device (orders o1)').text, /another device/);
  assert.equal(humanError('BN009 Needs owner').text, 'Needs owner.');
  assert.match(humanError('TypeError: Failed to fetch').text, /No connection/);
});

test('finalizer: a gateway-settled payment asks for the order effects once', () => {
  const d = clone(S), o = { ...d.orders[0], id: 'q1', status: 'paying' as const, paidAt: null, customerId: null, source: 'qr' as const, lines: d.orders[0].lines.map(l => ({ ...l, fired: false, kds: 'new' as const })) };
  d.orders.push(o);
  d.payments.push({ ...d.payments[0], id: 'qp', orderId: 'q1', method: 'qris', amount: o.total, status: 'pending' });
  assert.equal(finalizeNeed(d, 'q1'), null);
  d.payments.at(-1)!.status = 'settled';
  assert.equal(finalizeNeed(d, 'q1'), 'settle');
  const moves = d.movements.length;
  settleIfDone(d, d.orders.at(-1)!, 'gateway');
  assert.equal(d.orders.at(-1)!.status, 'paid'); assert.ok(d.movements.length > moves); assert.ok(d.orders.at(-1)!.lines.every(l => l.fired));
  assert.equal(finalizeNeed(d, 'q1'), null);
  d.orders.push({ ...o, id: 'q2', status: 'paying' }); d.payments.push({ ...d.payments[0], id: 'qp2', orderId: 'q2', method: 'qris', status: 'expired' });
  assert.equal(finalizeNeed(d, 'q2'), 'fail');
});
