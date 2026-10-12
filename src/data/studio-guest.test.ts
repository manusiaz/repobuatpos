// Menu Studio pages that run on the guest screens: what the owner publishes changes what guests get and pay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshot } from './store.ts';
import { addCombo, gatewayWebhook, newOrder, addLine, patchOrder, publish, setQty, startPayment } from './actions.ts';
import { menuDesign } from './actions/studio.ts';
import { billSplit, buyGiftCard, cancelGiftCard, dueOf, findOrJoin, payShare, referralWelcome, shareAmounts } from './actions/selforder.ts';
import { categoryLook, comboOf, giftCardOf, referralCode } from '../system/studio.ts';
import { balance } from '../domain/loyalty.ts';
import { splitEqual } from '../domain/split.ts';

const order = (id: string) => snapshot().orders.find(o => o.id === id)!;
const studio = (x: Record<string, unknown>) => publish('menu', { x: { ...menuDesign(snapshot()).x, ...x } }, 'budi', 'test');

test('Style per category: each category keeps its own published look; unstyled ones stay plain lists', () => {
  studio({ 'style-per-category': { cat: 'pastry', 'layout.pastry': 'big', 'bg.pastry': 'brand', 'layout.coffee': 'text' } });
  assert.deepEqual(categoryLook(snapshot(), 'pastry'), { layout: 'big', bg: 'brand', banner: '' });
  assert.equal(categoryLook(snapshot(), 'coffee').layout, 'text');
  assert.deepEqual(categoryLook(snapshot(), 'rice'), { layout: 'list', bg: 'page', banner: '' });
});

test('Combo builder: picked items are priced to the published combo price, options on top, removed as one', () => {
  studio({ 'combo-bundle-builder-steps': { name: 'Pagi combo', price: 45000, s1: 'Drink', c1: 'coffee', s2: 'Pastry', c2: 'pastry', s3: '', c3: 'other' } });
  const c = comboOf(snapshot());
  assert.deepEqual(c.steps.map(s => s.cat), ['coffee', 'pastry'], 'a step without a title is skipped');
  const id = newOrder('sen', 'guest', 'qr', { table: 'T-03' });
  addLine(id, 'p12', [], 1, '', 'guest');
  addCombo(id, c, [{ productId: 'p3', mods: [{ name: 'Oat milk', price: 5000 }] }, { productId: 'p7', mods: [] }]);
  const combo = order(id).lines.filter(l => l.combo);
  assert.equal(combo.length, 2);
  assert.equal(combo.reduce((a, l) => a + l.unitPrice * l.qty, 0), 45000, 'items add up to the combo price, to the rupiah');
  assert.ok(combo.every(l => l.note === 'Pagi combo' && l.flashPrice == null));
  assert.equal(order(id).subtotal, 8000 + 45000 + 5000, 'water + combo + oat milk');
  setQty(id, combo[0].id, 2, 'guest');
  assert.equal(order(id).lines.filter(l => l.combo).length, 2, 'a combo line cannot be multiplied on its own');
  setQty(id, combo[1].id, 0, 'guest');
  assert.deepEqual(order(id).lines.map(l => l.productId), ['p12'], 'fewer removes the whole combo');
});

test('Split bill: three phones pay equal shares by QRIS; the bill is paid when the shares cover it', () => {
  const id = newOrder('sen', 'guest', 'qr', { table: 'T-09' });
  addLine(id, 'p1', [], 2, '', 'guest'); addLine(id, 'p8', [], 1, '', 'guest');
  const total = order(id).total, parts = shareAmounts(order(id), 'equal', 3);
  assert.deepEqual(parts, splitEqual(total, 3));
  const pays = parts.map((amt, i) => payShare(id, 'equal', 3, 'part:' + i, amt));
  assert.throws(() => payShare(id, 'equal', 3, 'part:0', parts[0]), /already paying/);
  assert.throws(() => payShare(id, 'equal', 2, 'part:9', 1), /another way/);
  gatewayWebhook(pays[0], 'settled'); gatewayWebhook(pays[1], 'settled');
  assert.equal(order(id).paidAt, null, 'two of three shares: still open');
  assert.equal(dueOf(id), parts[2]);
  gatewayWebhook(pays[2], 'settled');
  assert.equal(order(id).status, 'paid');
  assert.equal(billSplit(snapshot(), id).shares.filter(s => s.paid).reduce((a, s) => a + s.amount, 0), total, 'shares sum to the bill exactly');
  assert.ok(order(id).lines.every(l => l.fired), 'pay-first QR lines reach the kitchen once the bill is covered');
});

test('Split bill by item: each phone pays its lines; a line cannot be paid twice', () => {
  const id = newOrder('kem', 'guest', 'qr', { table: 'T-02' });
  addLine(id, 'p2', [], 1, '', 'guest'); addLine(id, 'p5', [], 1, '', 'guest'); addLine(id, 'p8', [], 1, '', 'guest');
  const [a, b, c] = order(id).lines, s = shareAmounts(order(id), 'items', 0);
  const p1 = payShare(id, 'items', 0, a.id, s[0]);
  assert.throws(() => payShare(id, 'items', 0, [a.id, b.id].join(','), s[0] + s[1]), /already paying/);
  const p2 = payShare(id, 'items', 0, [b.id, c.id].join(','), s[1] + s[2]);
  gatewayWebhook(p1, 'settled'); gatewayWebhook(p2, 'settled');
  assert.equal(order(id).status, 'paid');
});

test('Referral: the friend joins with the member code, gets the published welcome, and both are rewarded once on the first paid order', () => {
  studio({ 'referral-page': { give: '10% off first order', get: '75 beans', prefix: 'kopi', share: 'both' } });
  const dewi = snapshot().customers.find(c => c.id === 'c1')!;
  assert.equal(referralCode(snapshot(), dewi), 'KOPI-C1');
  const before = balance(snapshot().ledger, 'c1');
  const friend = findOrJoin('Tari', '0812 5555 0909', true, 'kopi-c1');
  assert.equal(balance(snapshot().ledger, 'c1'), before, 'nothing until the friend pays');
  const id = newOrder('sen', 'guest', 'qr', { table: 'T-04', customerId: friend.id });
  addLine(id, 'p2', [], 2, '', 'guest');
  const full = order(id).subtotal;
  assert.equal(referralWelcome(id), 10);
  assert.equal(order(id).discount, Math.round(full / 10), '10% off, as the referral page promises');
  gatewayWebhook(startPayment(id, 'qris', dueOf(id), 'guest'), 'settled');
  assert.equal(balance(snapshot().ledger, 'c1') - before, 75, 'the member gets the published reward');
  const id2 = newOrder('sen', 'guest', 'qr', { table: 'T-04', customerId: friend.id });
  addLine(id2, 'p2', [], 1, '', 'guest');
  assert.equal(referralWelcome(id2), 0, 'welcome only on the first order');
  gatewayWebhook(startPayment(id2, 'qris', dueOf(id2), 'guest'), 'settled');
  assert.equal(balance(snapshot().ledger, 'c1') - before, 75, 'rewarded once');
  assert.equal(findOrJoin('Dewi again', '0812 3456 7890', true, 'KOPI-C1').created, false, 'an existing member is never a referral');
});

test('Gift card: guests buy a published amount; the balance lands on the friend once the QRIS settles, once', () => {
  studio({ 'gift-card-designer': { amounts: '150000, 300000', title: 'Ngopi yuk' } });
  assert.deepEqual(giftCardOf(snapshot()).amounts, [150000, 300000]);
  assert.throws(() => buyGiftCard('sen', 100000, { name: 'Bimo', phone: '0813 4444 2020' }, ''), /amounts/);
  const { orderId, paymentId } = buyGiftCard('sen', 150000, { name: 'Bimo', phone: '0813 4444 2020' }, 'Selamat ulang tahun');
  const o = order(orderId);
  assert.equal(o.total, 150000); assert.equal(o.tax, 0); assert.equal(o.lines.length, 0);
  const bimo = () => snapshot().customers.find(c => c.phone === '0813 4444 2020')!;
  assert.equal(bimo().deposit, 0, 'nothing before payment');
  gatewayWebhook(paymentId, 'settled'); gatewayWebhook(paymentId, 'settled');
  assert.equal(bimo().deposit, 150000, 'issued once');
  assert.equal(snapshot().messages.filter(m => m.template === 'gift_card' && m.customerId === bimo().id).length, 1);
  const x = buyGiftCard('sen', 300000, { name: 'Bimo', phone: '0813 4444 2020' }, '');
  cancelGiftCard(x.orderId);
  assert.equal(order(x.orderId).status, 'voided');
  assert.equal(bimo().deposit, 150000);
  patchOrder(orderId, {}, 'guest'); // a paid gift order keeps its total (no lines to reprice)
  assert.equal(order(orderId).total, 150000);
});
