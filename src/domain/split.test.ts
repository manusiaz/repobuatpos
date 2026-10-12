import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocate, comboPrices, splitEqual } from './split.ts';

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

test('split bill: equal shares sum exactly to the total, odd rupiah on the first phones', () => {
  assert.deepEqual(splitEqual(100_001, 3), [33_334, 33_334, 33_333]);
  assert.deepEqual(splitEqual(90_000, 4), [22_500, 22_500, 22_500, 22_500]);
  for (const [t, n] of [[81_917, 6], [1, 4], [0, 3], [2_345_679, 12]] as const) {
    const s = splitEqual(t, n);
    assert.equal(s.length, n); assert.equal(sum(s), t, `${t} / ${n}`);
    assert.ok(Math.max(...s) - Math.min(...s) <= 1, 'never more than a rupiah apart');
  }
});

test('split bill by item: line shares of the bill (with tax and service) add up to the bill', () => {
  const lines = [32_000, 28_000, 45_500], total = 116_215; // after service 5% and PB1 10%
  const s = allocate(total, lines);
  assert.equal(sum(s), total);
  assert.ok(s.every(Number.isInteger));
  assert.equal(sum(s.slice(0, 2)) + s[2], total, 'two phones paying different lines together cover the bill');
});

test('combo pricing: the items share the combo price by menu price, exactly', () => {
  const p = comboPrices(49_000, [32_000, 28_000, 15_000]);
  assert.equal(sum(p), 49_000);
  assert.deepEqual(p, [20_907, 18_293, 9_800]);
  assert.equal(sum(comboPrices(50_000, [0, 0])), 50_000, 'free items still carry the price');
  assert.deepEqual(comboPrices(10, [1, 1, 1]), [4, 3, 3]);
});
