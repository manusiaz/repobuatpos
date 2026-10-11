// One day at Kopi Biru (Senayan, Kemang, BSD), driven through the same services the screens call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshot } from './store.ts';
import { addLine, bumpDone, decide, gatewayWebhook, newOrder, patchOrder, patchOutlet, publish, rateOrder, sellable, sendToKitchen, setSetting, startPayment, stockEntry, verifyPin, watchKitchen } from './actions.ts';
import { addOutlet, saveBusiness } from './actions/business.ts';
import { menuDesign } from './actions/studio.ts';
import { receiptDoc } from '../devices/receipt.ts';
import { toText } from '../devices/layout.ts';
import { PAYMENT_PAGE, payOn, referral, roundStep } from '../system/settings.ts';
import { payCash } from './actions/pos.ts';
import { findOrJoin } from './actions/selforder.ts';
import { level } from '../domain/stock.ts';
import { balance } from '../domain/loyalty.ts';

const order = (id: string) => snapshot().orders.find(o => o.id === id)!;
const notices = (alert: string, text = '') => snapshot().notices.filter(n => n.alert === alert && n.text.includes(text));
const messages = (orderId: string, template: string) => snapshot().messages.filter(m => m.orderId === orderId && m.template === template);

test('QR guest at Senayan pays by QRIS and closes the tab: kitchen, staff, stock, beans and WhatsApp all follow', () => {
  const id = newOrder('sen', 'guest', 'qr', { table: 'T-07' });
  addLine(id, 'p2', [], 2, '', 'guest');
  const guest = findOrJoin('Dewi', '0812 9999 1111');
  patchOrder(id, { customerId: guest.id }, 'guest');
  const pay = startPayment(id, 'qris', order(id).total, 'guest');
  assert.equal(order(id).status, 'paying');
  assert.ok(order(id).lines.every(l => !l.fired), 'nothing cooks before the money lands');

  gatewayWebhook(pay, 'settled'); // server-side: no guest tab involved
  const o = order(id), no = o.no;
  assert.equal(o.status, 'paid');
  assert.ok(o.lines.every(l => l.fired && l.kds === 'new'), 'ticket is on the KDS');
  assert.equal(notices('New order', no).length, 1, 'kitchen alerted');
  assert.equal(notices('New QR / kiosk / online order', no).length, 1, 'cashier + PIC alerted');
  assert.equal(messages(id, 'e_receipt').length, 1, 'WhatsApp receipt queued');
  assert.equal(messages(id, 'e_receipt')[0].to, '0812 9999 1111');
  const moves = snapshot().movements.filter(m => m.sourceId === id).length;
  assert.ok(moves > 0, 'recipe stock deducted');
  assert.ok(balance(snapshot().ledger, guest.id) > 50, 'beans earned on top of the welcome beans');

  gatewayWebhook(pay, 'settled'); // gateway retries the webhook
  assert.equal(snapshot().movements.filter(m => m.sourceId === id).length, moves, 'retry is idempotent');

  bumpDone(id, 'dimas');
  bumpDone(id, 'dimas');
  assert.equal(messages(id, 'order_ready').length, 1, '"Order ready" WhatsApp sent once');
  assert.ok(notices('Order ready', no).length >= 1, 'floor team alerted');
});

test('Kemang runs out of palm sugar: the last portion sells, the menu shows sold out, the next guest cannot pay, staff are alerted, Senayan is unaffected', () => {
  const portion = snapshot().recipes.find(r => r.productId === 'p1' && r.stockItemId === 'aren')!.qty;
  const waste = Math.round((level(snapshot().movements, 'kem', 'aren') - portion) * 1000) / 1000;
  const req = stockEntry('waste', 'kem', 'aren', waste, 'bottle dropped', 'sari');
  if (req.level !== 'cashier') { assert.equal(verifyPin('budi', '246810'), null); assert.equal(decide(req.id, 'budi', 'approved'), null); }
  assert.ok(sellable(snapshot(), 'kem')('p1'), 'exactly one portion left is still sellable');

  const late = newOrder('kem', 'guest', 'qr', { table: 'T-03' });
  addLine(late, 'p1', [], 1, '', 'guest'); // second guest has it in the cart too

  const first = newOrder('kem', 'guest', 'qr', { table: 'T-01' });
  addLine(first, 'p1', [], 1, '', 'guest');
  gatewayWebhook(startPayment(first, 'qris', order(first).total, 'guest'), 'settled');

  assert.equal(notices('Out of stock', 'Es Kopi Susu Aren').length, 1, 'PIC, manager and kitchen alerted');
  assert.equal(sellable(snapshot(), 'kem')('p1'), false, 'sold out on the QR menu and kiosk');
  assert.ok(sellable(snapshot(), 'kem')('p2'), 'products without palm sugar keep selling');
  assert.ok(sellable(snapshot(), 'sen')('p1'), 'other branches keep their own stock');
  assert.throws(() => startPayment(late, 'qris', order(late).total, 'guest'), /just sold out/);
  assert.throws(() => sendToKitchen(late, 'guest'), /just sold out/);
});

test('Cash sale on the Senayan register lands in the open drawer session, moves stock, and a big order reaches PIC + manager', () => {
  const id = newOrder('sen', 'tono', 'pos');
  addLine(id, 'p7', [], 80, '', 'tono');
  const total = order(id).total;
  payCash(id, total, total, 'tono');
  assert.equal(order(id).status, 'paid');
  const p = snapshot().payments.find(x => x.orderId === id && x.method === 'cash')!;
  assert.equal(p.sessionId, 'S-1042');
  assert.ok(snapshot().movements.some(m => m.sourceId === id));
  assert.equal(notices('Big order', order(id).no).length, 1);
});

test('QRIS that expires alerts the cashier and never un-sends a pay-later ticket', () => {
  const id = newOrder('sen', 'guest', 'qr', { table: 'T-09' });
  addLine(id, 'p5', [], 1, '', 'guest');
  sendToKitchen(id, 'guest');
  gatewayWebhook(startPayment(id, 'qris', order(id).total, 'guest'), 'expired');
  assert.equal(order(id).status, 'sent');
  assert.equal(notices('Payment failed / declined', order(id).no).length, 1);
});

test('Allergy note and a ticket past 12 minutes reach the kitchen once', () => {
  const id = newOrder('bsd', 'guest', 'qr', { table: 'T-02' });
  addLine(id, 'p3', [], 1, 'alergi kacang', 'guest');
  sendToKitchen(id, 'guest');
  const no = order(id).no;
  assert.equal(notices('Allergy order', no).length, 1);
  watchKitchen(Date.now() + 13 * 60e3);
  watchKitchen(Date.now() + 14 * 60e3);
  assert.equal(notices('Order late', no + ' ').length, 1);
});

test('One system: the owner\'s Payment methods page drives every surface that takes money', () => {
  setSetting(PAYMENT_PAGE + ':qris', false, 'budi');
  const id = newOrder('sen', 'guest', 'qr', { table: 'T-11' });
  addLine(id, 'p5', [], 1, '', 'guest');
  assert.equal(payOn(snapshot(), 'qris'), false, 'QR menu, kiosk and POS hide QRIS');
  assert.throws(() => startPayment(id, 'qris', order(id).total, 'guest'), /switched off/);
  setSetting(PAYMENT_PAGE + ':qris', true, 'budi');
  assert.equal(roundStep(snapshot()), 100, 'cash rounding on by default, IDR 100');
  setSetting(PAYMENT_PAGE + ':roundStep', 500, 'budi');
  assert.equal(roundStep(snapshot()), 500, 'every register rounds to the owner\'s step');
  setSetting(PAYMENT_PAGE + ':rounding', false, 'budi');
  assert.equal(roundStep(snapshot()), 0);
});

test('One system: business profile and outlet details print on the receipt; a new outlet sells the whole menu; invite links give beans once', () => {
  saveBusiness('Kopi Biru', { legalName: 'PT Biru Sejahtera', npwp: '01.234.567.8-901.000', address: 'Jakarta', phone: '', email: '', brands: [] }, 'budi');
  patchOutlet('sen', { address: 'Jl. Asia Afrika 8, Senayan', npwpd: 'P2-123456' }, 'budi');
  const paid = snapshot().orders.find(o => o.outletId === 'sen' && o.paidAt)!;
  const lines = toText(receiptDoc(snapshot(), paid, '80'));
  assert.ok(lines.some(l => l.includes('PT Biru Sejahtera')) && lines.some(l => l.includes('Jl. Asia Afrika 8')) && lines.some(l => l.includes('NPWPD P2-123456')));

  const id = addOutlet({ name: 'Bintaro', city: 'Tangerang Selatan', serviceBps: 500, taxBps: 1000, taxInclusive: false, opens: '08:00', closes: '22:00', tables: 8, online: true }, 'budi');
  const globals = snapshot().products.filter(p => p.scope === 'global').length;
  assert.equal(snapshot().outletProducts.filter(x => x.outletId === id).length, globals, 'new outlet carries the global menu');

  const friend = findOrJoin('Rani', '0813 1234 0000', true, 'c1');
  const beans = (cid: string) => balance(snapshot().ledger, cid);
  assert.ok(friend.created && beans(friend.id) >= 50 + referral(snapshot()).friend, 'friend gets welcome + referral beans');
  const again = findOrJoin('Rani', '0813 1234 0000', true, 'c1');
  assert.equal(again.created, false);
  assert.equal(snapshot().ledger.filter(l => l.reason.startsWith('Referral')).length, 2, 'beans given once, to both');
});

test('One system: what the owner publishes in Menu Studio changes the live QR menu (QRIS timer, feedback beans)', () => {
  publish('menu', { x: { ...menuDesign(snapshot()).x, 'qris-payment-page-on-customer-phone': { timer: 2, steps: true, save: false }, 'feedback-and-rating-page': { reward: '30 beans for your feedback' } } }, 'budi', 'Shorter QRIS, more beans');
  const guest = findOrJoin('Bayu', '0812 7777 2222');
  const id = newOrder('sen', 'guest', 'qr', { table: 'T-12', customerId: guest.id });
  addLine(id, 'p5', [], 1, '', 'guest');
  const pay = startPayment(id, 'qris', order(id).total, 'guest');
  const p = snapshot().payments.find(x => x.id === pay)!;
  assert.ok(Math.abs(p.expiresAt! - p.at - 2 * 60e3) < 1000, 'QRIS code lives 2 minutes, as published');
  gatewayWebhook(pay, 'settled');
  const before = balance(snapshot().ledger, guest.id);
  rateOrder(id, 5, 'Mantap'); rateOrder(id, 5, 'again');
  assert.equal(balance(snapshot().ledger, guest.id) - before, 30, 'feedback beans as promised, once');
});
