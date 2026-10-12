import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seed } from '../data/seed.ts';
import type { DB, Order, OrderLine } from '../data/schema.ts';
import { DAY, startOfDay } from '../screens/insight/metrics.ts';
import { FORECAST, leadTime, salesForecast, stockRunway } from './forecast.ts';

const AT = new Date(2026, 9, 12, 14, 30).getTime(), T0 = startOfDay(AT);
let n = 0;
const line = (productId: string, qty = 1, unitPrice = 10000): OrderLine => ({ id: 'l' + n, productId, name: productId, qty, unitPrice, flashPrice: null, mods: [], note: '', discountPct: 0, station: 'bar', kds: 'done', fired: true });
const order = (outletId: string, at: number, total: number, lines: OrderLine[] = []): Order => ({ id: 'o' + ++n, no: '#' + n, outletId, sessionId: null, source: 'pos', type: 'dine', status: 'paid', table: null, customerId: null, lines,
  discountPct: 0, promoIds: [], guests: 1, subtotal: total, discount: 0, service: 0, tax: 0, total, createdAt: at, paidAt: at, cashierId: null, idemKey: 'k' + n });
const empty = (): DB => ({ ...seed(AT), orders: [], payments: [], movements: [], pos: [] });
/** One paid order per completed day for `days` days before today; amount by day. */
const days = (db: DB, outletId: string, count: number, amount: (from: number) => number) => {
  for (let k = count; k >= 1; k--) { const from = T0 - k * DAY; db.orders.push(order(outletId, from + 10 * 3600e3, amount(from))); }
};

test('forecast: weekday-seasonal mean, flat history has no band', () => {
  const db = empty();
  days(db, 'sen', 28, t => (new Date(t).getDay() === 1 ? 100_000 : 50_000));
  const f = salesForecast(db, 'sen', 14, AT);
  assert.equal(f.days.length, 14);
  assert.equal(f.days[0].from, T0, 'starts today');
  assert.equal(f.trend, 1);
  for (const d of f.days) {
    assert.equal(d.value, new Date(d.from).getDay() === 1 ? 100_000 : 50_000);
    assert.equal(d.low, d.value); assert.equal(d.high, d.value);
  }
  assert.equal(f.total, f.days.reduce((a, d) => a + d.value, 0));
  assert.ok(f.days.every(d => Number.isInteger(d.value) && Number.isInteger(d.low) && Number.isInteger(d.high)), 'integer rupiah');
});

test('forecast: trend (last 14 days vs the 14 before) scales the mean and is clamped', () => {
  const db = empty();
  days(db, 'sen', 28, t => (t >= T0 - 14 * DAY ? 110_000 : 100_000));
  const f = salesForecast(db, 'sen', 7, AT);
  assert.equal(f.trend, 1.1);
  // weekday mean (100k, 100k, 110k, 110k) = 105k × 1.1; sample sd = 5773.5
  assert.equal(f.days[0].value, Math.round(105_000 * 1.1));
  assert.equal(f.days[0].low, Math.round((105_000 - Math.sqrt(4 * 5000 ** 2 / 3)) * 1.1));
  assert.equal(f.days[0].high, Math.round((105_000 + Math.sqrt(4 * 5000 ** 2 / 3)) * 1.1));
  const up = empty(); days(up, 'sen', 28, t => (t >= T0 - 14 * DAY ? 300_000 : 100_000));
  assert.equal(salesForecast(up, 'sen', 7, AT).trend, FORECAST.trendHigh);
  const down = empty(); days(down, 'sen', 28, t => (t >= T0 - 14 * DAY ? 10_000 : 100_000));
  assert.equal(salesForecast(down, 'sen', 7, AT).trend, FORECAST.trendLow);
});

test('forecast: band is ± the weekday standard deviation, never below zero', () => {
  const db = empty();
  days(db, 'sen', 14, t => (t >= T0 - 7 * DAY ? 120_000 : 80_000));
  const f = salesForecast(db, 'sen', 7, AT);
  assert.equal(f.trend, 1, 'trend needs 7 days on each side of the 14-day split');
  assert.equal(f.days[0].value, 100_000);
  assert.equal(f.days[0].low, Math.round(100_000 - Math.SQRT2 * 20_000));
  assert.equal(f.days[0].high, Math.round(100_000 + Math.SQRT2 * 20_000));
  const wild = empty(); days(wild, 'sen', 14, t => (t >= T0 - 7 * DAY ? 200_000 : 0));
  assert.ok(salesForecast(wild, 'sen', 7, AT).days.every(d => d.low === 0));
});

test('forecast: days before history are no data, not zero; no history forecasts zero', () => {
  const db = empty();
  days(db, 'kem', 7, () => 70_000);
  const f = salesForecast(db, 'kem', 7, AT);
  assert.equal(f.samples, 7);
  assert.ok(f.days.every(d => d.value === 70_000), 'not diluted by the empty weeks before the outlet opened');
  const none = salesForecast(db, 'bsd', 7, AT);
  assert.equal(none.total, 0); assert.equal(none.samples, 0);
  // a weekday never seen borrows the mean of every day
  const short = empty(); days(short, 'sen', 3, () => 30_000);
  assert.ok(salesForecast(short, 'sen', 7, AT).days.every(d => d.value === 30_000));
});

test('stock runway: level ÷ average daily use from movements, plus recipe use of orders without movements', () => {
  const db = empty();
  db.movements.push({ outletId: 'sen', stockItemId: 'beans', qty: 10, type: 'receipt', by: 'budi', at: T0 - 20 * DAY });
  for (let k = 14; k >= 1; k--) {
    const o = order('sen', T0 - k * DAY + 9 * 3600e3, 25_000, [line('p2')]); db.orders.push(o);
    db.movements.push({ outletId: 'sen', stockItemId: 'beans', qty: -0.25, type: 'sale', sourceId: o.id, by: 'rina', at: o.paidAt! });
  }
  // imported history: sold, no stock movement → recipe (Americano 0.018 kg beans) × 50
  db.orders.push(order('sen', T0 - 2 * DAY, 1_100_000, [line('p2', 50, 22_000)]));
  db.movements.push({ outletId: 'sen', stockItemId: 'beans', qty: -0.5, type: 'waste', by: 'maya', at: T0 - DAY });
  const r = stockRunway(db, 'sen', AT).find(x => x.stockItemId === 'beans')!;
  const used = 14 * 0.25 + 50 * 0.018 + 0.5;
  assert.equal(r.historyDays, 14);
  assert.ok(Math.abs(r.perDay - used / 14) < 1e-9);
  assert.ok(Math.abs(r.level - (10 - 14 * 0.25 - 0.5)) < 1e-9);
  assert.ok(Math.abs(r.daysLeft! - r.level / r.perDay) < 1e-9);
  assert.equal(stockRunway(db, 'sen', AT).find(x => x.stockItemId === 'oat')!.daysLeft, null, 'nothing used: no days-left');
  // movements of today and other outlets don't count
  db.movements.push({ outletId: 'kem', stockItemId: 'beans', qty: -5, type: 'sale', by: 'x', at: T0 - DAY }, { outletId: 'sen', stockItemId: 'beans', qty: -1, type: 'sale', by: 'x', at: T0 + 3600e3 });
  assert.ok(Math.abs(stockRunway(db, 'sen', AT).find(x => x.stockItemId === 'beans')!.perDay - used / 14) < 1e-9);
});

test('lead time: supplier POs that carried the item, else all POs, else the default', () => {
  const db = empty();
  assert.deepEqual(leadTime(db, 'milk', 'sen'), { days: FORECAST.leadDays, from: 'default', supplierId: null });
  db.pos.push({ id: 'a', no: 'PO-1', supplierId: 'sup1', outletId: 'sen', lines: [{ stockItemId: 'milk', qty: 10, price: 22000, received: 0 }], status: 'sent', due: T0 + 4 * DAY, at: T0, createdBy: 'andi' },
    { id: 'b', no: 'PO-2', supplierId: 'sup2', outletId: 'sen', lines: [{ stockItemId: 'beans', qty: 1, price: 260000, received: 1 }], status: 'received', due: T0 - 5 * DAY, at: T0 - 6 * DAY, createdBy: 'andi' });
  assert.deepEqual(leadTime(db, 'milk', 'kem'), { days: 4, from: 'supplier', supplierId: 'sup1' });
  assert.deepEqual(leadTime(db, 'rice', 'sen'), { days: 3, from: 'all-pos', supplierId: null }, 'ceil of the 2.5-day average');
  const r = stockRunway(db, 'sen', AT).find(x => x.stockItemId === 'milk')!;
  assert.equal(r.onOrder, 10, 'open PO lines not yet received');
});
