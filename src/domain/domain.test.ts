import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idr, idrShort } from './money.ts';
import { orderTotals, canMove, methodAvailable, editableInBorniz } from './order.ts';
import { levelRequired, canDecide } from './approval.ts';
import { earn, balance, tierOf, canRedeem, reversal, type LedgerRow } from './loyalty.ts';
import { deductForSale, opnameApprover, missingPhotos, postOpname, level } from './stock.ts';
import { localPriceAllowed, newItem, canDelete } from './menu.ts';
import { resolve, flashPrice, type Promo } from './promo.ts';
import { closeCheck } from './shift.ts';

test('money format', () => {
  assert.equal(idr(81900), 'IDR 81,900');
  assert.equal(idrShort(2_400_000), 'IDR 2,4 jt');
  assert.equal(idrShort(23_000), 'IDR 23 rb');
});

test('order total follows lg-total order', () => {
  const t = orderTotals([{ unitPrice: 25000, qty: 2, modifiers: [5000] }, { unitPrice: 30000, flashPrice: 20000, qty: 1, discountPct: 10 }],
    { serviceBps: 500, taxBps: 1000, taxInclusive: false }, { pct: 10 });
  assert.deepEqual(t.lines, [60000, 18000]);
  assert.equal(t.subtotal, 78000);
  assert.equal(t.orderDiscount, 7800);
  assert.equal(t.service, 3510);
  assert.equal(t.tax, 7371);
  assert.equal(t.total, 78000 - 7800 + 3510 + 7371);
  const cash = orderTotals([{ unitPrice: 12345, qty: 1 }], { serviceBps: 0, taxBps: 0, taxInclusive: false }, {}, true);
  assert.equal(cash.due, 12300);
  assert.equal(cash.rounding, -45);
});

test('order and payment state', () => {
  assert.ok(canMove('open', 'paying'));
  assert.ok(!canMove('paid', 'open'), 'paid is final');
  assert.ok(!methodAvailable('qris', false) && methodAvailable('cash', false));
  assert.ok(!editableInBorniz('gofood'));
});

test('approval ladder', () => {
  assert.equal(levelRequired('discount', 0, 10), 'cashier');
  assert.equal(levelRequired('discount', 0, 20), 'pic');
  assert.equal(levelRequired('discount', 0, 25), 'manager');
  assert.equal(levelRequired('refund', 100_000), 'pic');
  assert.equal(levelRequired('refund', 620_000), 'owner');
  assert.equal(levelRequired('variance', 60_000), 'manager');
  assert.equal(levelRequired('price', 1), 'owner');
  assert.ok(!canDecide({ level: 'pic', requestedBy: 'maya' }, { id: 'maya', level: 'manager' }), 'no self approval');
  assert.ok(!canDecide({ level: 'pic', requestedBy: 'x', countedBy: 'maya' }, { id: 'maya', level: 'pic' }), 'counter cannot sign');
  assert.ok(!canDecide({ level: 'owner', requestedBy: 'x' }, { id: 'andi', level: 'manager' }));
});

test('loyalty ledger', () => {
  const rows: LedgerRow[] = [{ customerId: 'c', points: earn(109_000), reason: 'Order', at: Date.now() }];
  assert.equal(balance(rows, 'c'), 109);
  assert.equal(tierOf(rows, 'c').id, 'silver');
  assert.ok(!canRedeem(rows, 'c', 200));
  rows.push(reversal(rows[0]));
  assert.equal(balance(rows, 'c'), 0);
});

test('stock and opname', () => {
  const moves = deductForSale([{ productId: 'p', stockItemId: 'milk', qty: 0.2 }], [{ productId: 'p', qty: 3 }], 'sen', 'o1', 'tono');
  assert.equal(Math.round(level(moves, 'sen', 'milk') * 10) / 10, -0.6);
  const lines = [{ stockItemId: 'milk', systemQty: 12, counted: 8, unitCost: 22000 }];
  assert.equal(opnameApprover(lines), 'manager');
  assert.equal(missingPhotos(lines).length, 1);
  assert.equal(postOpname(lines, 'sen', 'op1', 'andi')[0].qty, -4);
});

test('menu scope', () => {
  assert.ok(localPriceAllowed(25000, 27500, { menuPrices: false }));
  assert.ok(!localPriceAllowed(25000, 28000, { menuPrices: false }));
  assert.ok(!localPriceAllowed(25000, 25000, { menuPrices: true }));
  assert.deepEqual(newItem('manager', { outletOnlyItems: true }), { scope: 'local', status: 'pending_owner' });
  assert.ok(!canDelete({ scope: 'global' }, { role: 'manager', outletId: 'sen' }));
});

test('promo resolution', () => {
  const ps: Promo[] = [{ id: 'a', name: '20%', kind: 'pct', value: 20 }, { id: 'b', name: '15k', kind: 'amount', value: 15000 }, { id: 'f', name: 'flash', kind: 'flash', value: 18000, productIds: ['p'] }];
  assert.equal(resolve(ps, 100_000).discount, 20000);
  assert.equal(resolve(ps, 50_000).discount, 15000);
  assert.equal(flashPrice(ps, 'p'), 18000);
  assert.equal(resolve([{ id: 'q', name: 'q', kind: 'pct', value: 50, quota: 1, used: 1 }], 100_000).discount, 0);
});

test('shift close', () => {
  const s = { openingFloat: 500_000, cashSales: 1_200_000, cashIn: 0, cashOut: 50_000, cashRefunds: 0 };
  assert.equal(closeCheck(s, 1_650_000).level, null);
  assert.equal(closeCheck(s, 1_620_000).level, 'pic');
  assert.equal(closeCheck(s, 1_500_000).level, 'manager');
});
