// Beans with the money: a refund takes back what the order earned only as far as the member still holds it (the server
// refuses a negative balance, BN003, which would block the refund itself), and a redeem always costs beans.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshot } from './store.ts';
import { addLine, decide, newOrder, redeem, requestApproval } from './actions.ts';
import { payCash } from './actions/pos.ts';
import { balance } from '../domain/loyalty.ts';
import { roundCash } from '../domain/money.ts';

const beans = (c: string) => balance(snapshot().ledger, c);

test('a full refund after the beans were spent leaves the balance at zero and still refunds', () => {
  const c = snapshot().customers.find(x => beans(x.id) >= 0)!.id;
  const id = newOrder('sen', 'tono', 'pos', { customerId: c });
  addLine(id, 'p2', [], 3, '', 'tono');
  const o = snapshot().orders.find(x => x.id === id)!;
  payCash(id, roundCash(o.total), o.total, 'tono');
  assert.ok(redeem(c, beans(c), 'Free latte', 'tono') === null, 'spends every bean');
  const r = requestApproval({ type: 'refund', title: 'Refund ' + o.no, amount: o.total, requestedBy: 'tono', outletId: 'sen', subjectId: id, note: 'cold', payload: { toStock: false } });
  assert.equal(decide(r.id, 'andi', 'approved'), null);
  assert.equal(snapshot().orders.find(x => x.id === id)!.status, 'refunded');
  assert.equal(beans(c), 0, 'never negative');
});

test('a redeem with no cost or a negative cost gives no beans', () => {
  const c = snapshot().customers[0].id, before = beans(c);
  assert.ok(redeem(c, -1000, 'x', 'tono'));
  assert.ok(redeem(c, 0, 'x', 'tono'));
  assert.equal(beans(c), before);
});
