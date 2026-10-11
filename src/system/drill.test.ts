import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DRILL, drillTo } from './drill.ts';
import { pageAt } from './registry.ts';

test('every tile target is a real page', () => {
  for (const [, paths] of DRILL) for (const p of paths) assert.ok(pageAt(p), p);
});
test('tiles open the list in the role\'s own app, and stay plain on the list they count', () => {
  assert.equal(drillTo('Orders', 'pic', '/pic/my-shift/pic-home-my-shift-now'), '/pic/my-shift/shift-sales-and-orders');
  assert.equal(drillTo('Orders', 'cashier', '/pos/shift/close-shift'), '/pos/after-sale/shift-transaction-history');
  assert.equal(drillTo('Revenue', 'owner', '/owner/monitor/overview-analytics'), '/owner/sales/sales-transactions');
  assert.equal(drillTo('Revenue', 'owner', '/owner/sales/sales-transactions'), null);
  assert.equal(drillTo('Refunds', 'manager', '/manager/operations/approvals'), '/manager/sales/refund-and-void-history');
  assert.equal(drillTo('Quiet hours', 'owner', '/owner'), null);
});
test('back office goes to the live monitor, the kitchen to its tickets, the platform to its billing', () => {
  assert.equal(drillTo('Open orders', 'manager', '/manager/operations/approvals'), '/manager/sales/outlet-transactions');
  assert.equal(drillTo('Open orders', 'kitchen', '/kds/kitchen-performance'), '/kds/order-tickets');
  assert.equal(drillTo('Failed payments', 'admin', '/admin/platform-overview'), '/admin/tenant-invoices-and-payments');
});
