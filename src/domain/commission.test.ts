import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commission, rulesFor, type CommissionRule, type SaleRow } from './commission.ts';
import { clockShot, missingPhoto } from './shift.ts';

const rule = (p: Partial<CommissionRule>): CommissionRule => ({ id: 'r', name: '', employeeId: null, role: 'cashier', salesBps: 0, perItem: 0, productIds: [], categoryIds: [], ...p });
const rina = { id: 'rina', role: 'cashier' };
const sale = (net: number, lines: [string, string, number][] = []): SaleRow => ({ net, lines: lines.map(([productId, categoryId, qty]) => ({ productId, categoryId, qty })) });

test('commission: percent of net sales', () => {
  const k = commission([rule({ salesBps: 100 })], rina, [sale(1_000_000), sale(500_000)]);
  assert.equal(k.net, 1_500_000);
  assert.equal(k.fromSales, 15_000);
  assert.equal(k.total, 15_000);
});

test('commission: fixed amount per item of chosen categories or products', () => {
  const rules = [rule({ id: 'pastry', perItem: 2000, categoryIds: ['pastry'] }), rule({ id: 'aren', perItem: 1000, productIds: ['p1'] })];
  const k = commission(rules, rina, [sale(200_000, [['p7', 'pastry', 3], ['p1', 'coffee', 2], ['p2', 'coffee', 5]])]);
  assert.equal(k.items, 5);
  assert.equal(k.fromItems, 3 * 2000 + 2 * 1000);
  assert.equal(k.fromSales, 0);
  assert.equal(k.total, 8000);
});

test('commission: refunds come off net sales and returned items', () => {
  const rules = [rule({ salesBps: 100 }), rule({ id: 'b', perItem: 2000, categoryIds: ['pastry'] })];
  const k = commission(rules, rina, [sale(300_000, [['p7', 'pastry', 4]])], [sale(100_000, [['p7', 'pastry', 1]])]);
  assert.equal(k.net, 200_000);
  assert.equal(k.items, 3);
  assert.equal(k.total, 2000 + 6000);
  // a refund larger than the sales never makes commission negative
  assert.equal(commission(rules, rina, [sale(50_000)], [sale(80_000, [['p7', 'pastry', 2]])]).total, 0);
});

test('commission: each part rounds down to whole rupiah', () => {
  const k = commission([rule({ salesBps: 150 })], rina, [sale(99_999)]); // 1.5% of 99,999 = 1,499.985
  assert.equal(k.fromSales, 1499);
  assert.ok(Number.isInteger(k.total));
  assert.equal(commission([rule({ salesBps: 50 }), rule({ id: 'x', salesBps: 50 })], rina, [sale(199)]).total, 0); // 0.995 + 0.995 → 0 + 0
});

test('commission: no rules, or none for this person, pays nothing', () => {
  assert.equal(commission([], rina, [sale(1_000_000)]).total, 0);
  const k = commission([rule({ role: 'pic', salesBps: 100 })], rina, [sale(1_000_000)]);
  assert.equal(k.total, 0);
  assert.deepEqual(k.rules, []);
  assert.equal(commission([rule({ salesBps: 100, perItem: 2000 })], rina, [sale(0, [['p7', 'pastry', 3]])]).total, 0); // per item with nothing chosen
});

test('commission: a person with their own rule gets only that, not the role rule', () => {
  const rules = [rule({ id: 'role', salesBps: 100 }), rule({ id: 'own', employeeId: 'rina', role: null, salesBps: 200 })];
  assert.deepEqual(rulesFor(rules, rina).map(r => r.id), ['own']);
  assert.deepEqual(rulesFor(rules, { id: 'tono', role: 'cashier' }).map(r => r.id), ['role']);
  assert.equal(commission(rules, rina, [sale(100_000)]).total, 2000);
});

test('clock photo rule: required blocks a clock without photo; optional marks it for review', () => {
  assert.deepEqual(clockShot(true, 'in', 'data:image/jpeg;base64,x'), { photo: 'data:image/jpeg;base64,x' });
  assert.equal(clockShot(true, 'in', null), null);
  assert.equal(clockShot(true, 'out', undefined), null);
  assert.deepEqual(clockShot(false, 'in', null, 'Camera blocked'), { noPhoto: 'Camera blocked' });
  assert.deepEqual(clockShot(true, 'break', null), {});
  assert.equal(missingPhoto({ kind: 'in' }), true);
  assert.equal(missingPhoto({ kind: 'in', photo: 'data:x' }), false);
  assert.equal(missingPhoto({ kind: 'break' }), false);
});
