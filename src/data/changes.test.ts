// A guest suddenly moves table or drops an item after it went to the kitchen: POS › Move table / Void item → KDS, waiter, guest phone, kitchen printer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshot } from './store.ts';
import { addLine, decide, moveTable, newOrder, requestApproval, sendToKitchen, verifyPin, voidItem } from './actions.ts';
import { kitchenDoc } from '../devices/receipt.ts';
import { toText } from '../devices/layout.ts';

const order = (id: string) => snapshot().orders.find(o => o.id === id)!;
const notice = (alert: string, no: string) => snapshot().notices.find(n => n.alert === alert && n.text.startsWith(no));
const fired = () => { const id = newOrder('sen', 'tono', 'pos', { table: 'T-03', type: 'dine' }); addLine(id, 'p1', [], 1, '', 'tono'); addLine(id, 'p2', [], 2, '', 'tono'); sendToKitchen(id, 'tono'); return id; };

test('moving a bill with food in the kitchen: new table everywhere, the old one remembered, kitchen and waiter told, audited', () => {
  const id = fired(), no = order(id).no;
  moveTable(id, 'T-09', 'tono');
  assert.equal(order(id).table, 'T-09');
  assert.equal(order(id).movedFrom, 'T-03', 'the guest phone and the KDS ticket follow from here');
  const n = notice('Table moved', no)!;
  assert.ok(n && n.text.includes('T-03 → T-09') && n.to.includes('kitchen') && n.to.includes('waiter'));
  assert.ok(snapshot().audit.some(a => a.action === 'order.table_moved'));
  const empty = newOrder('sen', 'tono', 'pos', { table: 'T-04', type: 'dine' });
  moveTable(empty, 'T-06', 'tono');
  assert.equal(notice('Table moved', order(empty).no), undefined, 'nothing cooking: nobody to tell');
});

test('voiding a fired item tells the kitchen to stop, directly or after the approval PIN; unfired or served items do not', () => {
  const id = fired(), o = order(id), [a, b] = o.lines;
  voidItem(id, a.id, 'budi');
  assert.ok(!order(id).lines.some(l => l.id === a.id));
  assert.match(notice('Item voided', o.no)!.text, /stop 1× /);
  const req = requestApproval({ type: 'void', title: 'Void', amount: 1, requestedBy: 'tono', outletId: 'sen', subjectId: id, note: 'guest changed mind', payload: { lineId: b.id } });
  assert.equal(verifyPin('budi', '246810'), null);
  assert.equal(decide(req.id, 'budi', 'approved'), null);
  assert.equal(order(id).lines.length, 0);
  assert.equal(snapshot().notices.filter(n => n.alert === 'Item voided' && n.text.startsWith(o.no)).length, 2);
  const cold = newOrder('sen', 'tono'); addLine(cold, 'p1', [], 1, '', 'tono');
  voidItem(cold, null, 'tono', 'left');
  assert.equal(order(cold).status, 'voided');
  assert.equal(notice('Item voided', order(cold).no), undefined, 'never sent: the kitchen never knew');
});

test('a change slip prints its banner under the station', () => {
  const id = fired(), o = order(id);
  const text = toText(kitchenDoc(snapshot(), o, 'bar', o.lines, '80', { reprint: true, banner: 'Void - do not make' })).join('\n');
  assert.ok(text.includes('VOID - DO NOT MAKE') && text.indexOf('VOID') < text.indexOf(o.no));
});
