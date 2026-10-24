// Operations audit: stock, menu scope, kitchen, loyalty, approvals and branch isolation at Kopi Biru, driven through the
// same services the screens call. Each test is what an owner of three outlets expects to be true.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshot } from './store.ts';
import {
  addCustomer, addLine, archiveProduct, bump, bumpDone, createPO, decide, escalateDue, gatewayWebhook, newOrder, patchOrder, pickedUp, priceAt,
  receivePO, recall, requestApproval, saveProduct, sellable, sendToKitchen, served, setLocks, simulatePlatformOrder, startOpname, startPayment,
  stockEntry, toggle86, updateOpnameLine, acceptOnline,
} from './actions.ts';
import { payCash } from './actions/pos.ts';
import { roundCash } from '../domain/money.ts';
import { submitCount, opnamePhoto, recountLine, resendCount } from './actions/pic.ts';
import { bumpStation } from './actions/kds.ts';
import { startFlash } from './actions/studio.ts';
import { level } from '../domain/stock.ts';
import { balance } from '../domain/loyalty.ts';

const db = () => snapshot();
const order = (id: string) => db().orders.find(o => o.id === id)!;
const approval = (id: string) => db().approvals.find(a => a.id === id)!;
const lvl = (outletId: string, item: string) => Math.round(level(db().movements, outletId, item) * 1000) / 1000;
const movesOf = (sourceId: string) => db().movements.filter(m => m.sourceId === sourceId);

// ── Approvals ──────────────────────────────────────────────────────────────────────────
test('An approval decided twice (double tap, two devices) is applied once', () => {
  const before = lvl('kem', 'milk');
  const r = stockEntry('waste', 'kem', 'milk', 1, 'spilled', 'sari'); // 22k → PIC level
  assert.equal(r.level, 'pic');
  assert.equal(decide(r.id, 'andi', 'approved'), null);
  assert.ok(decide(r.id, 'andi', 'approved'), 'second approve is refused');
  assert.ok(decide(r.id, 'budi', 'rejected'), 'a decided request cannot be flipped');
  assert.equal(lvl('kem', 'milk'), Math.round((before - 1) * 1000) / 1000, 'waste posted exactly once');
  assert.equal(approval(r.id).status, 'approved');
});

test('Branch isolation: a BSD PIC cannot approve Senayan, a Senayan/Kemang manager cannot approve BSD, the owner can approve anywhere', () => {
  const sen = requestApproval({ type: 'void', title: 'Void Americano · wrong order', amount: 22000, requestedBy: 'rina', outletId: 'sen' });
  assert.equal(sen.level, 'pic');
  assert.ok(decide(sen.id, 'lia', 'approved'), 'Lia (BSD only) is refused at Senayan');
  assert.equal(approval(sen.id).status, 'waiting');
  assert.equal(decide(sen.id, 'maya', 'approved'), null, 'Maya (Senayan PIC) decides');

  const bsd = requestApproval({ type: 'discount', title: 'Discount 25% · BSD birthday', pct: 25, requestedBy: 'lia', outletId: 'bsd' });
  assert.equal(bsd.level, 'manager');
  assert.ok(decide(bsd.id, 'andi', 'approved'), 'Andi manages Senayan and Kemang, not BSD');
  assert.equal(decide(bsd.id, 'budi', 'approved'), null, 'owner sees and signs every outlet');
});

test('Nobody approves their own request; the counter never signs their own count', () => {
  const r = stockEntry('waste', 'sen', 'milk', 1, 'expired', 'maya');
  assert.match(decide(r.id, 'maya', 'approved') ?? '', /own request/);
  assert.equal(decide(r.id, 'sari', 'approved'), null);
});

test('Escalation: an unanswered PIC request goes to the manager after 5 minutes, then to the owner', () => {
  const r = requestApproval({ type: 'void', title: 'Void Teh Tarik · Kemang', amount: 18000, requestedBy: 'wulan', outletId: 'kem' });
  escalateDue(Date.now() + 4 * 60e3);
  assert.equal(approval(r.id).level, 'pic');
  escalateDue(Date.now() + 6 * 60e3);
  assert.equal(approval(r.id).level, 'manager');
  escalateDue(Date.now() + 40 * 60e3);
  assert.equal(approval(r.id).level, 'owner');
  assert.ok(decide(r.id, 'sari', 'approved'), 'a PIC can no longer decide it');
});

// ── Permission matrix vs services ──────────────────────────────────────────────────────
test('Permission matrix: a cashier cannot mark an item sold out through the service (matrix says "a"); the PIC can', () => {
  toggle86('sen', 'p4', 'rina');
  assert.equal(db().outletProducts.find(x => x.productId === 'p4' && x.outletId === 'sen')!.is86, false, 'cashier alone is refused');
  toggle86('sen', 'p4', 'maya');
  assert.equal(db().outletProducts.find(x => x.productId === 'p4' && x.outletId === 'sen')!.is86, true, 'PIC (or the approver on the register) marks it');
  toggle86('sen', 'p4', 'dimas'); // kitchen: 'y'
  assert.equal(db().outletProducts.find(x => x.productId === 'p4' && x.outletId === 'sen')!.is86, false);
  toggle86('kem', 'p4', 'dimas'); // Dimas works at Senayan only
  assert.equal(db().outletProducts.find(x => x.productId === 'p4' && x.outletId === 'kem')!.is86, false, 'no 86 at another branch');
});

test('Permission matrix: a cashier cannot start a stock count (opname is PIC and up)', () => {
  const n = db().opnames.length;
  startOpname('sen', 'Bar', 'rina');
  assert.equal(db().opnames.length, n);
});

// ── Stock ──────────────────────────────────────────────────────────────────────────────
test('A late QRIS settlement on a bill already paid in cash does not deduct stock or earn beans twice', () => {
  const id = newOrder('sen', 'tono', 'pos', { customerId: 'c4' });
  addLine(id, 'p2', [], 2, '', 'tono');
  const qris = startPayment(id, 'qris', order(id).total, 'tono'); // guest scans, then decides to pay cash
  const total = order(id).total;
  payCash(id, total, total, 'tono');
  assert.equal(order(id).status, 'paid');
  const moves = movesOf(id).length, beans = balance(db().ledger, 'c4');
  gatewayWebhook(qris, 'settled'); // the scan lands a minute later
  assert.equal(movesOf(id).length, moves, 'no second recipe deduction');
  assert.equal(balance(db().ledger, 'c4'), beans, 'no second earn');
});

test('A delivery order deducts its recipe stock once when the driver picks it up', () => {
  const id = simulatePlatformOrder('kem', 'gofood');
  acceptOnline(id, 'wulan');
  bumpDone(id, 'hadi');
  assert.equal(order(id).status, 'ready');
  pickedUp(id, 'wulan');
  assert.equal(order(id).status, 'paid');
  const withRecipe = order(id).lines.filter(l => db().recipes.some(r => r.productId === l.productId));
  if (withRecipe.length) assert.ok(movesOf(id).some(m => m.type === 'sale'), 'recipe stock deducted for the delivery sale');
  const n = movesOf(id).length;
  pickedUp(id, 'wulan');
  assert.equal(movesOf(id).length, n, 'second tap changes nothing');
});

test('Delivery platforms never receive a sold-out, hidden or other-branch item', () => {
  for (const p of db().products) if (!['p2', 'p12'].includes(p.id) && db().outletProducts.some(x => x.productId === p.id && x.outletId === 'bsd')) toggle86('bsd', p.id, 'budi');
  for (let i = 0; i < 25; i++) {
    const o = order(simulatePlatformOrder('bsd', 'grabfood'));
    assert.ok(o.lines.length > 0, 'the order has items');
    assert.ok(o.lines.every(l => ['p2', 'p12'].includes(l.productId)), `only what BSD can sell (${o.lines.map(l => l.productId)})`);
  }
  for (const p of db().products) if (db().outletProducts.find(x => x.productId === p.id && x.outletId === 'bsd')?.is86) toggle86('bsd', p.id, 'budi');
});

test('Refund by item: only the returned items go back to stock, once; beans are reversed once across two partial refunds', () => {
  const id = newOrder('sen', 'tono', 'pos', { customerId: 'c5' });
  addLine(id, 'p2', [], 1, '', 'tono');
  addLine(id, 'p7', [], 1, '', 'tono');
  const total = order(id).total;
  payCash(id, total, total, 'tono');
  const earned = db().ledger.filter(l => l.orderId === id).reduce((a, l) => a + l.points, 0);
  assert.ok(earned > 0);
  const [americano, croissant] = order(id).lines;
  const beans0 = lvl('sen', 'beans'), crois0 = lvl('sen', 'croissant');

  const r1 = requestApproval({ type: 'refund', title: 'Refund croissant', amount: 30000, requestedBy: 'tono', outletId: 'sen', subjectId: id, note: 'Cold', payload: { toStock: true, lineIds: [croissant.id] } });
  assert.equal(decide(r1.id, 'maya', 'approved'), null);
  assert.equal(lvl('sen', 'croissant'), crois0 + 1, 'croissant back on the shelf');
  assert.equal(lvl('sen', 'beans'), beans0, 'the americano was not returned');

  const r2 = requestApproval({ type: 'refund', title: 'Refund americano', amount: 20000, requestedBy: 'tono', outletId: 'sen', subjectId: id, note: 'Wrong', payload: { toStock: true, lineIds: [americano.id] } });
  assert.equal(decide(r2.id, 'maya', 'approved'), null);
  assert.equal(lvl('sen', 'croissant'), crois0 + 1, 'croissant not returned a second time');
  assert.equal(lvl('sen', 'beans'), Math.round((beans0 + 0.018) * 1000) / 1000, 'americano beans back');
  const kept = db().ledger.filter(l => l.orderId === id).reduce((a, l) => a + l.points, 0);
  assert.equal(kept, earned - Math.round(earned * Math.min(1, 50000 / total)), 'beans reversed in proportion to what was refunded, once');
  assert.ok(kept >= 0, 'never below zero');
});

test('Purchase orders: approved → partial (short delivery) → received; a rejected PO is cancelled and cannot be received', () => {
  const id = createPO('sup1', 'kem', [{ stockItemId: 'milk', qty: 10, price: 22000 }], 'andi'); // 220k → manager level, Andi can't sign his own
  const ap = db().approvals.find(a => a.subjectId === id)!;
  const milk0 = lvl('kem', 'milk');
  receivePO(id, { milk: 10 }, 'wulan');
  assert.equal(lvl('kem', 'milk'), milk0, 'an unapproved PO cannot be received');
  assert.ok(decide(ap.id, 'andi', 'approved'));
  assert.equal(decide(ap.id, 'budi', 'approved'), null);
  assert.equal(db().pos.find(p => p.id === id)!.status, 'sent');
  receivePO(id, { milk: 6 }, 'wulan');
  assert.equal(db().pos.find(p => p.id === id)!.status, 'partial');
  receivePO(id, { milk: 4 }, 'wulan');
  assert.equal(db().pos.find(p => p.id === id)!.status, 'received');
  receivePO(id, { milk: 4 }, 'wulan');
  assert.equal(lvl('kem', 'milk'), Math.round((milk0 + 10) * 1000) / 1000, 'a closed PO takes no more stock');

  const bad = createPO('sup2', 'sen', [{ stockItemId: 'beans', qty: 1, price: 260000 }], 'maya');
  const bap = db().approvals.find(a => a.subjectId === bad)!;
  assert.equal(decide(bap.id, 'andi', 'rejected', 'Wrong supplier'), null);
  assert.equal(db().pos.find(p => p.id === bad)!.status, 'cancelled');
  const b0 = lvl('sen', 'beans');
  receivePO(bad, { beans: 1 }, 'maya');
  assert.equal(lvl('sen', 'beans'), b0);
});

test('Opname: blind count, locked after submit, photo proof, counter cannot sign, recount keeps history, stock moves only when approved', () => {
  const id = startOpname('kem', 'Bar', 'sari')!;
  const line = db().opnames.find(o => o.id === id)!.lines.find(l => l.stockItemId === 'cups')!;
  updateOpnameLine(id, 'cups', { counted: line.systemQty - 10 }, 'sari'); // 10 cups missing = 9,000
  submitCount(id, 'sari');
  updateOpnameLine(id, 'cups', { counted: line.systemQty }, 'sari');
  assert.equal(db().opnames.find(o => o.id === id)!.lines[0].counted, line.systemQty - 10, 'locked: nobody edits the count');
  const ap = db().approvals.find(a => a.subjectId === id && a.status === 'waiting')!;
  assert.equal(ap.level, 'pic');
  const cups0 = lvl('kem', 'cups');
  assert.match(decide(ap.id, 'andi', 'approved') ?? '', /Photo/);
  assert.equal(decide(ap.id, 'andi', 'recount', 'count the open sleeve'), null);
  recountLine(id, 'cups', line.systemQty - 4, 'sari');
  opnamePhoto(id, 'cups', 'data:image/jpeg;base64,xx', 'sari');
  const ap2 = resendCount(id, 'sari')!;
  assert.equal(lvl('kem', 'cups'), cups0, 'nothing moved before approval');
  assert.match(decide(ap2.id, 'sari', 'approved') ?? '', /own/, 'the counter cannot sign');
  assert.equal(decide(ap2.id, 'andi', 'approved'), null);
  assert.equal(lvl('kem', 'cups'), cups0 - 4, 'opname adjustment posted for the recount');
  assert.equal(db().opnames.find(o => o.id === id)!.lines[0].recountOf, String(line.systemQty - 10), 'first count kept');
});

// ── Menu scope ─────────────────────────────────────────────────────────────────────────
test('Franchise lock "Menu prices": every outlet sells at the base price', () => {
  assert.equal(priceAt(db(), db().products.find(p => p.id === 'p1')!, 'bsd'), 26000, 'BSD local price while unlocked');
  setLocks({ menuPrices: true }, 'budi');
  const id = newOrder('bsd', 'lia', 'pos');
  addLine(id, 'p1', [], 1, '', 'lia');
  assert.equal(order(id).lines[0].unitPrice, 25000);
  setLocks({ menuPrices: false }, 'budi');
});

test('A manager cannot change a base price or publish an item through the product form; it goes to the owner', () => {
  const p2 = db().products.find(p => p.id === 'p2')!;
  assert.ok(saveProduct({ ...p2, basePrice: 30000 }, 'andi'), 'a global item is the owner’s');
  assert.equal(db().products.find(p => p.id === 'p2')!.basePrice, 22000, 'Americano still 22k everywhere');
  const p15 = db().products.find(p => p.id === 'p15')!; // Andi's own Senayan item
  assert.equal(saveProduct({ ...p15, desc: 'Kopi tubruk gula aren', basePrice: 24000, status: 'live' }, 'andi'), null);
  assert.equal(db().products.find(p => p.id === 'p15')!.basePrice, 20000, 'price unchanged until the owner signs');
  assert.equal(db().products.find(p => p.id === 'p15')!.status, 'pending_owner', 'still waits for the owner');
  assert.equal(db().products.find(p => p.id === 'p15')!.desc, 'Kopi tubruk gula aren', 'the description is the manager’s to edit');
  const ask = db().approvals.find(a => a.type === 'price' && a.subjectId === 'p15' && a.status === 'waiting');
  assert.ok(ask, 'price change waits for the owner');
  assert.equal(ask!.level, 'owner');

  saveProduct({ ...p2, id: 'p-andi', name: 'Es Teh Kemang', basePrice: 12000, scope: 'global', status: 'live', ownerOutletId: null }, 'andi');
  const mine = db().products.find(p => p.id === 'p-andi')!;
  assert.equal(mine.scope, 'local');
  assert.equal(mine.status, 'pending_owner');
  assert.ok(['sen', 'kem'].includes(mine.ownerOutletId!));
  assert.ok(db().approvals.some(a => a.type === 'local_item' && a.subjectId === 'p-andi' && a.status === 'waiting'));
  assert.equal(db().outletProducts.filter(x => x.productId === 'p-andi').length, 1, 'only at the manager’s outlet');
});

test('Owner deletes an item (or an outlet hides it) while it sits in a guest cart: the guest cannot pay for it', () => {
  const id = newOrder('kem', 'guest', 'qr', { table: 'T-04' });
  addLine(id, 'p6', [], 1, '', 'guest');
  assert.equal(archiveProduct('p6', 'budi'), null);
  assert.equal(sellable(db(), 'kem')('p6'), false);
  assert.throws(() => startPayment(id, 'qris', order(id).total, 'guest'), /sold out/);
});

test('Flash sale quota: once the units are sold the item is back at its normal price', () => {
  startFlash('sec-test', 'Flash', ['p5'], 50, 60, 2, 'budi');
  const a = newOrder('sen', 'tono', 'pos');
  addLine(a, 'p5', [], 2, '', 'tono');
  assert.equal(order(a).lines[0].flashPrice, 9000);
  payCash(a, order(a).total, order(a).total, 'tono');
  const b = newOrder('sen', 'tono', 'pos');
  addLine(b, 'p5', [], 1, '', 'tono');
  assert.equal(order(b).lines[0].flashPrice, null, 'quota of 2 used up');
});

// ── Loyalty ────────────────────────────────────────────────────────────────────────────
test('Same phone at another outlet finds the existing member: no duplicate, no second welcome beans', () => {
  const n = db().customers.length, b = balance(db().ledger, 'c1');
  const id = addCustomer('Dewi', '+62 812-3456-7890', 'wulan');
  assert.equal(id, 'c1');
  assert.equal(db().customers.length, n);
  assert.equal(balance(db().ledger, 'c1'), b);
});

test('Beans: earned on the paid amount at the member’s tier, nothing on an unpaid bill', () => {
  const id = newOrder('kem', 'wulan', 'pos', { customerId: 'c3' }); // Platinum ×1.5
  addLine(id, 'p11', [], 2, '', 'wulan');
  sendToKitchen(id, 'wulan');
  assert.equal(db().ledger.filter(l => l.orderId === id).length, 0);
  payCash(id, order(id).total, order(id).total, 'wulan');
  assert.equal(db().ledger.find(l => l.orderId === id)!.points, Math.floor(84 * 1.5));
});

// ── Kitchen ────────────────────────────────────────────────────────────────────────────
test('Kitchen: stations bump separately, ready only when every station is done, recall reopens, waiter serves, guest gets one WhatsApp', () => {
  const c = addCustomer('Tamu Baru', '0812 5555 0001', 'joko');
  const id = newOrder('sen', 'joko', 'waiter', { table: 'T-11', customerId: c });
  addLine(id, 'p2', [], 1, '', 'joko');
  addLine(id, 'p10', [{ name: 'Mild', price: 0 }], 1, '', 'joko');
  sendToKitchen(id, 'joko');
  assert.deepEqual(order(id).lines.map(l => l.station), ['bar', 'kitchen']);
  bumpStation(id, 'bar', 'dimas');
  assert.equal(order(id).status, 'preparing');
  bumpStation(id, 'kitchen', 'dimas');
  assert.equal(order(id).status, 'ready');
  recall(id, 'dimas');
  assert.equal(order(id).status, 'preparing');
  bump(id, 'all', 'dimas');
  bump(id, 'all', 'dimas');
  assert.equal(order(id).status, 'ready');
  served(id, 'joko');
  assert.equal(order(id).status, 'served');
  assert.equal(db().messages.filter(m => m.orderId === id && m.template === 'order_ready').length, 1);
});

test('A second round on a served table fires only the new lines', () => {
  const id = newOrder('sen', 'joko', 'waiter', { table: 'T-12' });
  addLine(id, 'p3', [], 1, '', 'joko');
  sendToKitchen(id, 'joko');
  const firstAt = order(id).lines[0].firedAt;
  addLine(id, 'p3', [], 1, '', 'joko');
  assert.equal(order(id).lines.length, 2, 'a fired line is never merged with a new one');
  patchOrder(id, {}, 'joko');
  sendToKitchen(id, 'joko');
  assert.equal(order(id).lines[0].firedAt, firstAt);
  assert.ok(order(id).lines.every(l => l.fired));
});

test('Opname: a sale between starting the count and counting the item is not counted twice', () => {
  const r = snapshot().recipes.find(x => x.qty > 0)!, out = 'sen', id = startOpname(out, 'Bar', 'sari')!;
  const order = newOrder(out, 'tono', 'pos', {});
  addLine(order, r.productId, [], 2, '', 'tono');
  const o = snapshot().orders.find(x => x.id === order)!;
  payCash(order, roundCash(o.total), o.total, 'tono');
  const shelf = lvl(out, r.stockItemId); // what is really on the shelf after the sale
  updateOpnameLine(id, r.stockItemId, { counted: shelf }, 'sari');
  const ap = submitCount(id, 'sari')!;
  assert.equal(db().approvals.find(a => a.id === ap.id)!.amount, 0, 'counted what the system holds: no variance');
  assert.equal(decide(ap.id, 'andi', 'approved'), null);
  assert.equal(lvl(out, r.stockItemId), shelf, 'the level is what was counted');
});
