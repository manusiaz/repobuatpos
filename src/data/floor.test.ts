// Tables & floor plan → every screen that lists tables (src/domain/tables.ts tablesOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshot } from './store.ts';
import { addLine, newOrder, patchOrder, sendToKitchen } from './actions.ts';
import { saveFloor } from './actions/business.ts';
import { tableNames, tablesOf, type FloorTable } from '../domain/tables.ts';

const out = () => snapshot().outlets.find(o => o.id === 'sen')!;
const T = (name: string, area: string, x: number, y: number, seats = 4): FloorTable => ({ name, area, seats, shape: 'square', x, y });

test('a saved plan replaces the numbered tables everywhere and keeps the table count in step', () => {
  const before = tablesOf(out()).length, plan = [...tablesOf(out()), T('VIP 1', 'VIP', 0, 0, 8), T('Bar 1', 'Bar', 0, 0, 2)];
  assert.equal(saveFloor('sen', plan, 'budi'), null);
  assert.deepEqual(tableNames(out()).slice(-2), ['VIP 1', 'Bar 1']);
  assert.equal(out().tables, before + 2);
});

test('a table with an open bill cannot be removed or renamed; a broken plan is refused', () => {
  const id = newOrder('sen', 'rina');
  patchOrder(id, { table: 'VIP 1', type: 'dine' }, 'rina');
  assert.match(saveFloor('sen', tablesOf(out()).filter(t => t.name !== 'VIP 1'), 'budi')!, /VIP 1 has an open bill/);
  assert.match(saveFloor('sen', tablesOf(out()).map(t => t.name === 'VIP 1' ? { ...t, name: 'VIP 9' } : t), 'budi')!, /VIP 1 has an open bill/);
  assert.match(saveFloor('sen', [...tablesOf(out()), T('vip 1', 'VIP', 1, 0)], 'budi')!, /Two tables/);
  assert.ok(tableNames(out()).includes('VIP 1'), 'nothing changed');
  // moving it is fine
  assert.equal(saveFloor('sen', tablesOf(out()).map(t => t.name === 'VIP 1' ? { ...t, x: 3, y: 2 } : t), 'budi'), null);
  assert.equal(tablesOf(out()).find(t => t.name === 'VIP 1')!.x, 3);
});

test('a paid QR order still cooking keeps its table: the plan cannot drop it', () => {
  const id = newOrder('sen', 'guest', 'qr', { table: 'Bar 1', type: 'dine' });
  addLine(id, 'p1', [], 1, '', 'guest'); sendToKitchen(id, 'guest');
  patchOrder(id, { status: 'paid', paidAt: Date.now() }, 'guest');
  assert.match(saveFloor('sen', tablesOf(out()).filter(t => t.name !== 'Bar 1'), 'budi')!, /Bar 1 has an open bill/);
});
