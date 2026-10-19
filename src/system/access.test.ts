import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOME, startFor } from './access.ts';

test('after sign-in each role lands on the page it was sent from when it may open it, else on its own start', () => {
  assert.equal(startFor('kitchen', '/kds'), '/kds', 'the KDS tablet asked the kitchen and stays on the KDS');
  assert.equal(startFor('waiter', '/waiter'), '/waiter');
  assert.equal(startFor('kitchen', '/owner/sales/refunds-and-voids'), HOME.kitchen, 'a page the role may not open sends it home, not to a dead end');
  assert.equal(startFor('cashier', null), '/pos/selling/register-order');
  assert.equal(startFor('owner', '/owner/sales/refunds-and-voids?o=sen'), '/owner/sales/refunds-and-voids?o=sen', 'a notification link survives the sign-in');
  assert.equal(startFor('owner', '//evil.example/owner'), HOME.owner, 'never another site');
  assert.equal(startFor('pic', '/no-such-page'), HOME.pic);
});
