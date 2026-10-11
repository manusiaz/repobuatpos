// Money audit: an order's money followed into payments, refunds, drawers, loyalty, stock and every report.
// Driven through the same services the screens call (Pay.tsx, After.tsx, Shift.tsx, pic/cash.tsx, manager.tsx, Report.tsx).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshot } from './store.ts';
import { addLine, applyVoucher, closeSession, cashMove, decide, gatewayWebhook, newOrder, openSession, patchOrder, requestApproval, sessionCash, startPayment } from './actions.ts';
import { patchLine, payCash } from './actions/pos.ts';
import { picCountDrawer } from './actions/pic.ts';
import { expectedCash } from '../domain/shift.ts';
import { roundCash } from '../domain/money.ts';
import { balance } from '../domain/loyalty.ts';
import { byMethod, profitAndLoss, soldOrders, summary, startOfDay } from '../screens/insight/metrics.ts';
import { isPaid } from '../screens/ops/shift.ts';

const order = (id: string) => snapshot().orders.find(o => o.id === id)!;
const expected = (sid: string) => expectedCash(sessionCash(snapshot(), sid));
const refunded = (id: string) => snapshot().refunds.filter(r => r.orderId === id).reduce((a, r) => a + r.amount, 0);
const sale = (outlet: string, by: string, items: [string, number][], patch = {}) => {
  const id = newOrder(outlet, by, 'pos', patch);
  for (const [p, q] of items) addLine(id, p, [], q, '', by);
  return id;
};
/** After.tsx Refund → flow.run → requestApproval; the approver signs with their PIN → decide. */
const refund = (id: string, amount: number, by: string, approver: string, payload: Record<string, unknown> = {}) => {
  const r = requestApproval({ type: 'refund', title: 'Refund ' + order(id).no, amount, requestedBy: by, outletId: order(id).outletId, subjectId: id, note: 'Cold / quality', payload: { toStock: false, ...payload } });
  assert.equal(decide(r.id, approver, 'approved'), null);
  return r;
};
const today = () => ({ from: startOfDay(Date.now()), to: Date.now() + 1 });
const TONO = 'S-1042';

test('Cash refund after a rounded-down cash sale comes out of the drawer that took the cash', () => {
  const before = expected(TONO);
  const id = sale('sen', 'tono', [['p2', 1]]);
  const total = order(id).total, due = roundCash(total);
  assert.ok(due < total, 'scenario needs a round-down');
  payCash(id, due, total, 'tono');
  assert.equal(order(id).status, 'paid');
  assert.equal(expected(TONO) - before, due, 'drawer expects only the cash taken');
  refund(id, total, 'tono', 'maya');
  assert.equal(order(id).status, 'refunded');
  assert.equal(expected(TONO), before, 'the cash handed back leaves the drawer');
});

test('Split bill cash + QRIS, full refund: the drawer only gives back the cash part', () => {
  const before = expected(TONO);
  const id = sale('sen', 'tono', [['p7', 1]]);
  const total = order(id).total;
  startPayment(id, 'cash', 20000, 'tono');
  gatewayWebhook(startPayment(id, 'qris', total - 20000, 'tono'), 'settled');
  assert.equal(order(id).status, 'paid');
  assert.equal(expected(TONO) - before, 20000);
  refund(id, total, 'tono', 'maya');
  assert.equal(expected(TONO), before, 'cash refund = cash paid, QRIS goes back through the gateway');
  const byPay = snapshot().refunds.filter(r => r.orderId === id).map(r => [snapshot().payments.find(p => p.id === r.paymentId)!.method, r.amount]);
  assert.deepEqual(byPay.sort(), [['cash', 20000], ['qris', total - 20000]].sort());
});

test('Refunds go back to the deposit and off the kasbon they were paid with', () => {
  const dep = sale('sen', 'tono', [['p3', 1]], { customerId: 'c3' });
  const before = snapshot().customers.find(c => c.id === 'c3')!.deposit;
  startPayment(dep, 'deposit', order(dep).total, 'tono');
  assert.equal(snapshot().customers.find(c => c.id === 'c3')!.deposit, before - order(dep).total);
  refund(dep, order(dep).total, 'tono', 'maya');
  assert.equal(snapshot().customers.find(c => c.id === 'c3')!.deposit, before, 'deposit restored');

  const kb = sale('sen', 'tono', [['p3', 1]], { customerId: 'c7' });
  const owed = snapshot().customers.find(c => c.id === 'c7')!.credit;
  startPayment(kb, 'kasbon', order(kb).total, 'tono');
  refund(kb, order(kb).total, 'tono', 'maya');
  assert.equal(snapshot().customers.find(c => c.id === 'c7')!.credit, owed, 'guest no longer owes a refunded bill');
});

test('Two refund requests for the same bill can never pay back more than was paid', () => {
  const id = sale('sen', 'tono', [['p7', 2]]);
  const total = order(id).total;
  startPayment(id, 'card', total, 'tono');
  const a = requestApproval({ type: 'refund', title: 'r1', amount: total, requestedBy: 'tono', outletId: 'sen', subjectId: id, note: 'x' });
  const b = requestApproval({ type: 'refund', title: 'r2', amount: total, requestedBy: 'tono', outletId: 'sen', subjectId: id, note: 'x' });
  assert.equal(decide(a.id, 'maya', 'approved'), null);
  assert.equal(decide(b.id, 'sari', 'approved'), null);
  assert.equal(refunded(id), total);
  assert.equal(order(id).status, 'refunded');
});

test('Partial refunds reverse beans in proportion, and never more than were earned', () => {
  const id = sale('sen', 'tono', [['p7', 4]], { customerId: 'c1' });
  const start = balance(snapshot().ledger, 'c1');
  startPayment(id, 'card', order(id).total, 'tono');
  const earned = balance(snapshot().ledger, 'c1') - start;
  assert.ok(earned > 0);
  const half = Math.round(order(id).total / 2);
  refund(id, half, 'tono', 'maya');
  const afterHalf = balance(snapshot().ledger, 'c1') - start;
  assert.ok(afterHalf > 0 && afterHalf < earned, `half a refund keeps about half the beans (${afterHalf} of ${earned})`);
  refund(id, order(id).total - half, 'tono', 'maya');
  assert.equal(balance(snapshot().ledger, 'c1'), start, 'fully refunded: every bean earned on it is reversed, once');
});

test('Refund by item returns only those items to stock; exchange too', () => {
  const id = sale('sen', 'tono', [['p2', 1], ['p7', 1]]);
  startPayment(id, 'card', order(id).total, 'tono');
  const croissant = order(id).lines.find(l => l.productId === 'p7')!;
  refund(id, 30000, 'tono', 'maya', { toStock: true, lineIds: [croissant.id] });
  const back = snapshot().movements.filter(m => m.sourceId === id && m.type === 'refund_return').map(m => m.stockItemId).sort();
  assert.deepEqual(back, ['butter', 'croissant'], 'the Americano (beans, cup) stays sold');
});

test('A QRIS that lands after the bill was paid in cash, or voided, does not sell it twice', () => {
  const id = sale('sen', 'tono', [['p5', 1]], { customerId: 'c2' });
  const qr = startPayment(id, 'qris', order(id).total, 'tono');
  payCash(id, roundCash(order(id).total), order(id).total, 'tono');
  const o = order(id), moves = snapshot().movements.length, beans = balance(snapshot().ledger, 'c2');
  gatewayWebhook(qr, 'settled');
  assert.equal(order(id).status, 'paid');
  assert.equal(order(id).paidAt, o.paidAt);
  assert.equal(snapshot().movements.length, moves, 'stock deducted once');
  assert.equal(balance(snapshot().ledger, 'c2'), beans, 'beans earned once');
  assert.ok(snapshot().notices.some(n => n.text.includes(o.no) && /refund/i.test(n.text)), 'staff told to refund the double payment');
  assert.throws(() => startPayment(id, 'cash', 1000, 'tono'), /closed/);

  const v = sale('sen', 'tono', [['p5', 1]]);
  const vq = startPayment(v, 'qris', order(v).total, 'tono');
  const r = requestApproval({ type: 'void', title: 'void', amount: order(v).total, requestedBy: 'tono', outletId: 'sen', subjectId: v, note: 'guest left' });
  assert.equal(decide(r.id, 'maya', 'approved'), null);
  gatewayWebhook(vq, 'settled');
  assert.equal(order(v).status, 'voided', 'a voided bill is not resurrected by a late webhook');
  assert.equal(snapshot().movements.filter(m => m.sourceId === v).length, 0);
});

test('Cash tips sit in the drawer: expected cash includes them, so a correct count balances', () => {
  const sid = openSession('kem', 'wulan', 300000);
  const id = sale('kem', 'wulan', [['p3', 1]]);
  const total = order(id).total, due = roundCash(total);
  payCash(id, due, total, 'wulan', 5000);
  assert.equal(expected(sid), 300000 + due + 5000);
  const chk = closeSession(sid, 300000 + due + 5000, '', 'wulan');
  assert.equal(chk.variance, 0);
  assert.equal(snapshot().sessions.find(s => s.id === sid)!.status, 'closed');
});

test('Two drawers at Senayan: cash lands in the drawer of whoever takes it; a closed drawer never changes after its count', () => {
  const rina = openSession('sen', 'rina', 300000);
  const tono0 = expected(TONO), rina0 = expected(rina);
  const qr = newOrder('sen', 'guest', 'qr', { table: 'T-04' }); // pay at the cashier
  addLine(qr, 'p2', [], 1, '', 'guest');
  const total = order(qr).total;
  payCash(qr, roundCash(total), total, 'tono');
  assert.equal(expected(TONO) - tono0, roundCash(total), 'Tono took the cash');
  assert.equal(expected(rina), rina0, 'Rina\'s drawer is untouched');

  const id = sale('sen', 'rina', [['p2', 1]]);
  startPayment(id, 'cash', order(id).total, 'rina');
  const counted = expected(rina);
  assert.equal(closeSession(rina, counted, '', 'rina').variance, 0);
  const t1 = expected(TONO);
  refund(id, order(id).total, 'tono', 'maya'); // next day style: refunded from the drawer that is open
  assert.equal(expected(rina), counted, 'closed drawer keeps its count');
  assert.equal(t1 - expected(TONO), order(id).total, 'cash left Tono\'s drawer');
});

test('Promo voucher is worked out on the real subtotal (modifiers and item discounts), min spend too', () => {
  const a = sale('sen', 'tono', [['p7', 4]]); // 128,000
  patchLine(a, order(a).lines[0].id, { discountPct: 50 }, 'tono'); // 64,000 < min spend 100,000
  assert.equal(applyVoucher(a, 'GAJIAN', 'tono'), null);
  assert.equal(order(a).subtotal, 64000);
  assert.equal(order(a).discount, 0, 'Payday 20% needs IDR 100,000 of real spend');

  const b = newOrder('sen', 'tono', 'pos');
  addLine(b, 'p3', [{ name: 'Oat milk', price: 5000 }], 4, '', 'tono'); // (28,000 + 5,000) × 4 = 132,000
  applyVoucher(b, 'GAJIAN', 'tono');
  assert.equal(order(b).subtotal, 132000);
  assert.equal(order(b).discount, 26400, '20% of what the guest is charged');
});

test('Every sales screen counts the same orders: manager and PIC "paid" = metrics sold (incl. refunded)', () => {
  for (const s of ['open', 'held', 'sent', 'preparing', 'ready', 'served', 'paying', 'paid', 'voided', 'part_refunded', 'refunded'] as const)
    assert.equal(isPaid(s), ['paid', 'part_refunded', 'refunded'].includes(s), s);
  const d = snapshot(), r = today();
  const managerSales = d.orders.filter(o => o.outletId === 'sen' && isPaid(o.status) && o.paidAt != null && o.paidAt >= r.from && o.paidAt < r.to).reduce((a, o) => a + o.total, 0);
  assert.equal(managerSales, summary(d, 'sen', r).revenue);
});

test('Cash by payment method = cash in the drawers (rounding is not cash)', () => {
  const cash = () => byMethod(snapshot(), 'sen', today()).find(x => x.method === 'cash')?.amount ?? 0;
  const c0 = cash(), d0 = expected(TONO);
  const id = sale('sen', 'tono', [['p2', 3]]);
  const total = order(id).total, due = roundCash(total);
  assert.notEqual(due, total);
  payCash(id, due, total, 'tono');
  assert.equal(cash() - c0, due);
  assert.equal(expected(TONO) - d0, due);
});

test('P&L: discounts counted once, PB1 is not income', () => {
  const s = summary(snapshot(), 'all', today());
  const rows = Object.fromEntries(profitAndLoss(s, 0, 0));
  assert.equal(rows['Sales (excl. PB1, before discounts)'], s.revenue - s.tax + s.discounts);
  assert.equal(rows['Discounts'], -s.discounts);
  assert.equal(rows['Net profit'], s.revenue - s.tax - s.refunds - s.cogs, 'discounts once, PB1 belongs to the tax office');
  assert.ok(soldOrders(snapshot(), 'all', today()).length > 0);
});

test('Deposit and kasbon need a member with the balance', () => {
  const id = sale('sen', 'tono', [['p2', 1]]);
  assert.throws(() => startPayment(id, 'deposit', order(id).total, 'tono'), /customer/i);
  assert.throws(() => startPayment(id, 'kasbon', order(id).total, 'tono'), /customer/i);
  patchOrder(id, { customerId: 'c1' }, 'tono'); // c1 has no deposit
  assert.throws(() => startPayment(id, 'deposit', order(id).total, 'tono'), /balance/i);
  assert.equal(order(id).status, 'open');
});

test('Drawer close, variance ladder and cash out work the way the owner expects', () => {
  const sid = openSession('bsd', 'lia', 500000);
  const out = cashMove(sid, 'out', 150000, 'Supplier COD', 'lia');
  const ap = snapshot().approvals.find(a => a.subjectId === out)!;
  assert.equal(ap.level, 'manager');
  assert.equal(expected(sid), 500000, 'waiting cash out is not taken yet');
  assert.equal(decide(ap.id, 'andi', 'rejected'), null);
  assert.equal(expected(sid), 500000);
  cashMove(sid, 'drop', 200000, 'Safe drop', 'lia');
  assert.equal(expected(sid), 300000);
  const chk = picCountDrawer(sid, 240000, 'short', 'lia');
  assert.equal(chk.variance, -60000);
  const v = snapshot().approvals.find(a => a.type === 'variance' && a.subjectId === sid)!;
  assert.equal(v.level, 'manager');
  assert.match(decide(v.id, 'lia', 'approved') ?? '', /own/);
  assert.equal(decide(v.id, 'budi', 'approved'), null);
  assert.equal(snapshot().sessions.find(s => s.id === sid)!.status, 'closed');
});

test('Money is integer rupiah in every stored row', () => {
  const d = snapshot(), bad: string[] = [];
  const chk = (where: string, n: unknown) => { if (typeof n === 'number' && !Number.isInteger(n)) bad.push(`${where}=${n}`); };
  d.orders.forEach(o => (['subtotal', 'discount', 'service', 'tax', 'total'] as const).forEach(k => chk(o.no + '.' + k, o[k])));
  d.payments.forEach(p => { chk(p.id + '.amount', p.amount); chk(p.id + '.tip', p.tip); });
  d.refunds.forEach(r => chk(r.id, r.amount));
  d.approvals.forEach(a => chk(a.title, a.amount));
  d.cashMoves.forEach(c => chk(c.id, c.amount));
  d.sessions.forEach(s => { chk(s.id + '.variance', s.variance); chk(s.id + '.counted', s.counted); });
  d.customers.forEach(c => { chk(c.id + '.credit', c.credit); chk(c.id + '.deposit', c.deposit); });
  d.ledger.forEach(l => chk(l.customerId + ' beans', l.points));
  assert.deepEqual(bad, []);
});
