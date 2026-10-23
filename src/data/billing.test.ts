// BorNiz billing: plan × outlets + PPN 11% at the prices BorNiz set, once a month in WIB; Free, trials and Enterprise are not billed here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { billMonth, invoiceFor } from './billing.ts';

const NOV1 = Date.UTC(2026, 9, 31, 17, 30); // 1 Nov 00:30 WIB
test('this month\'s invoice for a paid plan', () => {
  const i = invoiceFor({ id: 't1', plan: 'pro' }, 3, {}, NOV1)!;
  assert.deepEqual([i.id, i.b, i.c, i.d, i.n], ['inv-t1-2026-11', '2026-11', String(3 * 349_000 + Math.round(3 * 349_000 * 0.11)), 'unpaid', 'Pro × 3 outlets']);
  assert.equal(invoiceFor({ id: 't1', plan: 'basic' }, 0, { basic: 199_000 }, NOV1)!.c, String(199_000 + 21_890), 'the console price, at least one outlet');
});
test('never billed: Free, a running trial, Enterprise (per contract)', () => {
  for (const t of [{ id: 'a', plan: 'free' }, { id: 'b', plan: 'pro', trial: true }, { id: 'c', plan: 'enterprise' }]) assert.equal(invoiceFor(t, 2, {}, NOV1), null);
  assert.equal(billMonth(NOV1 - 3600e3), '2026-10', '31 Oct 23:30 WIB is still October');
});
