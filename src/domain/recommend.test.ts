import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seed } from '../data/seed.ts';
import type { DB, Order, OrderLine } from '../data/schema.ts';
import { pageAt } from '../system/registry.ts';
import { DAY, startOfDay } from '../screens/insight/metrics.ts';
import { RULES, recommend, type Kind } from './recommend.ts';

const AT = new Date(2026, 9, 12, 14, 30).getTime(), T0 = startOfDay(AT), H = 3600e3;
let n = 0;
const line = (productId: string, qty = 1, unitPrice = 10000): OrderLine => ({ id: 'l' + n, productId, name: productId, qty, unitPrice, flashPrice: null, mods: [], note: '', discountPct: 0, station: 'bar', kds: 'done', fired: true });
const order = (outletId: string, at: number, total: number, lines: OrderLine[] = [], customerId: string | null = null): Order => ({ id: 'o' + ++n, no: '#' + n, outletId, sessionId: null, source: 'pos', type: 'dine', status: 'paid', table: null, customerId, lines,
  discountPct: 0, promoIds: [], guests: 1, subtotal: total, discount: 0, service: 0, tax: 0, total, createdAt: at, paidAt: at, cashierId: null, idemKey: 'k' + n });
const empty = (): DB => ({ ...seed(AT), orders: [], payments: [], movements: [], pos: [], roster: [] });
/** `perDay` orders of `total` at `hour` on each of the last `count` completed days. */
const daily = (db: DB, outletId: string, count: number, total: number | ((from: number) => number), hour = 10, perDay = 1, lines: OrderLine[] = []) => {
  for (let k = count; k >= 1; k--) for (let i = 0; i < perDay; i++) { const from = T0 - k * DAY; db.orders.push(order(outletId, from + hour * H, typeof total === 'number' ? total : total(from), lines)); }
};
const of = (db: DB, kind: Kind, outlets = ['sen', 'kem', 'bsd']) => recommend(db, outlets, AT).filter(r => r.kind === kind);

test('reorder: runs out within the supplier lead time (+1 day) unless enough is already on order', () => {
  const db = empty();
  db.pos.push({ id: 'p', no: 'PO-1', supplierId: 'sup2', outletId: 'sen', lines: [{ stockItemId: 'beans', qty: 1, price: 260000, received: 1 }], status: 'received', due: T0 - 7 * DAY, at: T0 - 10 * DAY, createdBy: 'andi' });
  const stock = (level: number) => { db.movements = [{ outletId: 'sen', stockItemId: 'beans', qty: level + 14 * 2, type: 'receipt', by: 'budi', at: T0 - 20 * DAY }];
    db.orders = []; for (let k = 14; k >= 1; k--) { const o = order('sen', T0 - k * DAY + 9 * H, 25_000); db.orders.push(o); db.movements.push({ outletId: 'sen', stockItemId: 'beans', qty: -2, type: 'sale', sourceId: o.id, by: 'rina', at: o.paidAt! }); } };
  stock(5); // 2.5 days left, lead 3 → high
  let r = of(db, 'reorder');
  assert.equal(r.length, 1);
  assert.equal(r[0].severity, 'high');
  assert.equal(r[0].href, '/owner/inventory/purchase-orders');
  assert.match(r[0].why, /5 kg on hand, using 2 kg\/day · lead time 3 days/);
  assert.match(r[0].why, /order about 15 kg/, '2/day × (3 + 7) − 5');
  stock(7.5); // 3.75 days: inside lead + 1 → medium
  assert.equal(of(db, 'reorder')[0].severity, 'medium');
  stock(9); // 4.5 days → fine
  assert.equal(of(db, 'reorder').length, 0);
  stock(5);
  db.pos.push({ id: 'q', no: 'PO-2', supplierId: 'sup2', outletId: 'sen', lines: [{ stockItemId: 'beans', qty: 10, price: 260000, received: 0 }], status: 'sent', due: T0 + 2 * DAY, at: T0, createdBy: 'andi' });
  assert.equal(of(db, 'reorder').length, 0, 'a PO on the way covers it');
});

test('slow hours: under half the average opening hour in every week with data', () => {
  const build = (h20: number) => { const db = empty(); for (let h = 9; h < 21; h++) daily(db, 'bsd', 21, h === 20 ? h20 : 100_000, h); return db; };
  const r = of(build(10_000), 'slow-hours');
  assert.equal(r.length, 1);
  assert.equal(r[0].title, 'Slow hours at BSD: 20:00–21:00');
  assert.equal(r[0].href, '/owner/promo/promo-form');
  assert.match(r[0].why, /each of the last 3 weeks/);
  assert.equal(of(build(60_000), 'slow-hours').length, 0);
  const short = empty(); for (let h = 9; h < 21; h++) daily(short, 'bsd', 7, h === 20 ? 10_000 : 100_000, h);
  assert.equal(of(short, 'slow-hours').length, 0, `needs ${RULES.slowMinWeeks} weeks`);
});

test('margin: top sellers whose cost of goods is over 35% of sales', () => {
  const db = empty();
  daily(db, 'sen', 10, 64_000, 10, 1, [line('p7', 2, 32_000)]); // Croissant Almond, cost 38%
  daily(db, 'sen', 10, 50_000, 11, 1, [line('p1', 2, 25_000)]); // Es Kopi Susu Aren, cost 32%
  const r = of(db, 'margin');
  assert.deepEqual(r.map(x => x.id), ['margin:p7']);
  assert.equal(r[0].title, 'Croissant Almond: 38% cost of goods');
  assert.equal(r[0].href, '/owner/catalog/recipes-and-cogs');
  assert.equal(of(db, 'margin', ['sen'])[0].outletId, 'sen');
  assert.equal(of(db, 'margin', ['kem']).length, 0, 'other outlets’ sales are not in scope');
});

test('dead menu and dead stock: nothing sold / used in 14 days (outlet with 14 days of history)', () => {
  const db = empty();
  daily(db, 'sen', 14, 25_000, 10, 1, [line('p1')]);
  db.movements.push({ outletId: 'sen', stockItemId: 'oat', qty: 4, type: 'receipt', by: 'budi', at: T0 - 20 * DAY }, { outletId: 'sen', stockItemId: 'beans', qty: 4, type: 'receipt', by: 'budi', at: T0 - 20 * DAY });
  const menu = of(db, 'dead-menu');
  assert.equal(menu.length, 1);
  assert.match(menu[0].title, /^12 menu items not sold at Senayan/, '14 live items − the one sold − Pain au Chocolat (86’d)');
  db.outletProducts.find(x => x.outletId === 'sen' && x.productId === 'p2')!.hidden = true;
  assert.match(of(db, 'dead-menu')[0].title, /^11 /, 'hidden items are not on the menu');
  const stock = of(db, 'dead-stock');
  assert.equal(stock.length, 1);
  assert.match(stock[0].why, /^Oat milk 4 L/);
  assert.doesNotMatch(stock[0].why, /Arabica/, 'beans are used by Es Kopi Susu Aren');
  assert.equal(stock[0].title, 'IDR 120,000 of stock unused at Senayan');
  const young = empty(); daily(young, 'sen', 13, 25_000, 10, 1, [line('p1')]);
  assert.equal(of(young, 'dead-menu').length + of(young, 'dead-stock').length, 0, 'too little history to call anything dead');
});

test('outlets: below the forecast made a week ago, and below the other outlets', () => {
  const db = empty();
  daily(db, 'sen', 21, t => (t >= T0 - 7 * DAY ? 50_000 : 100_000));
  daily(db, 'kem', 21, 100_000);
  const f = of(db, 'outlet-forecast');
  assert.deepEqual(f.map(x => x.outletId), ['sen']);
  assert.equal(f[0].title, 'Senayan is 50% below forecast');
  assert.equal(f[0].href, '/owner/outlets/outlet-detail?id=sen');
  daily(db, 'bsd', 21, 30_000);
  const net = of(db, 'outlet-network');
  assert.deepEqual(net.map(x => x.outletId), ['bsd'], 'avg 60k: Senayan 50k is 83%, BSD 30k is 50%');
  assert.equal(of(db, 'outlet-network', ['bsd']).length, 0, 'needs two outlets in scope');
});

test('staffing: forecast orders in the busiest hour per rostered person', () => {
  const roster = (pic: string): DB['roster'] => Array.from({ length: 7 }, (_, day) => ({ outletId: 'sen', day, slots: { pagi: { pic, crew: [] }, siang: { pic: 'maya', crew: [] }, malam: { pic: '', crew: [] } } }));
  const build = (perDay: number, pic = 'maya') => { const db = empty(); db.roster = roster(pic); daily(db, 'sen', 14, 20_000, 12, perDay); return db; };
  const r = of(build(20), 'staffing');
  assert.equal(r.length, 1);
  assert.equal(r[0].severity, 'medium');
  assert.match(r[0].why, /^Forecast 20 orders that hour for 1 person rostered/);
  assert.equal(r[0].href, '/owner/team/shifts-and-schedules');
  assert.equal(of(build(10), 'staffing').length, 0);
  const nobody = of(build(5, ''), 'staffing');
  assert.equal(nobody[0].severity, 'high');
  assert.match(nobody[0].title, /^Nobody rostered at Senayan .* 12:00$/);
});

test('customers at risk: away more than twice their usual gap (and 7+ days)', () => {
  const db = empty();
  for (const k of [30, 28, 26, 24]) db.orders.push(order('sen', T0 - k * DAY + 10 * H, 50_000, [], 'c1'));
  for (const k of [5, 4, 3, 2, 1]) db.orders.push(order('sen', T0 - k * DAY + 10 * H, 50_000, [], 'c2'));
  for (const k of [9, 8]) db.orders.push(order('sen', T0 - k * DAY + 10 * H, 50_000, [], 'c3')); // two visits: no rhythm yet
  const r = of(db, 'customers');
  assert.equal(r.length, 1);
  assert.equal(r[0].title, '1 regular overdue for a visit');
  assert.match(r[0].why, /^Dewi Anggraini usually every 2 days, away 24/);
  assert.equal(of(db, 'customers', ['kem']).length, 0, 'visits at other outlets are out of scope');
});

test('engine: deterministic, sorted by severity, every action opens a real page, scope respected', () => {
  const db = seed(AT);
  const a = recommend(db, ['sen', 'kem', 'bsd'], AT), b = recommend(db, ['sen', 'kem', 'bsd'], AT);
  assert.deepEqual(a, b);
  assert.ok(a.length > 0, 'the demo tenant has something to act on');
  const rank = { high: 0, medium: 1, low: 2 };
  assert.ok(a.every((r, i) => i === 0 || rank[a[i - 1].severity] <= rank[r.severity]));
  assert.equal(new Set(a.map(r => r.id)).size, a.length, 'ids are unique');
  for (const r of a) assert.ok(pageAt(r.href.split('?')[0]), r.href);
  const kem = recommend(db, ['kem'], AT);
  assert.ok(kem.length > 0 && kem.every(r => r.outletId === 'kem'), 'a manager of Kemang sees only Kemang');
  assert.deepEqual(recommend(db, [], AT), []);
});
