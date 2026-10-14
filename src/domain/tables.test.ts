import { test } from 'node:test';
import assert from 'node:assert/strict';
import { areasOf, checkFloor, freeCell, holdsTable, nextName, tableParam, tablesOf, type FloorTable } from './tables.ts';

const T = (name: string, x: number, y: number, area = 'Indoor', seats = 4): FloorTable => ({ name, area, seats, shape: 'square', x, y });

test('without a plan the outlet keeps its numbered tables; with one, the plan wins', () => {
  assert.deepEqual(tablesOf({ tables: 3 }).map(t => t.name), ['T-01', 'T-02', 'T-03']);
  assert.deepEqual(tablesOf({ tables: 0 }), []);
  assert.deepEqual(tablesOf({ tables: 12, floor: [T('VIP 1', 0, 0, 'VIP')] }).map(t => t.name), ['VIP 1']);
  assert.equal(checkFloor(tablesOf({ tables: 16 })), null, 'the generated plan is valid');
});

test('the plan refuses duplicate names, stacked tables, bad seats and tables off the floor', () => {
  assert.equal(checkFloor([T('A1', 0, 0), T('B1', 1, 0, 'Outdoor'), T('B2', 0, 0, 'Outdoor')]), null, 'same cell in another area is fine');
  assert.match(checkFloor([T('A1', 0, 0), T('a1', 1, 0)])!, /Two tables/);
  assert.match(checkFloor([T('A1', 0, 0), T('A2', 0, 0)])!, /sits on another/);
  assert.match(checkFloor([T('A1', 0, 0, 'Indoor', 0)])!, /seats/);
  assert.match(checkFloor([T('A1', 8, 0)])!, /outside/);
  assert.match(checkFloor([T(' ', 0, 0)])!, /name/);
});

test('new tables land on a free cell with the next free name; areas keep their order', () => {
  const ts = [T('T-01', 0, 0), T('T-02', 1, 0), T('T-03', 0, 0, 'Outdoor')];
  assert.deepEqual(freeCell(ts, 'Indoor'), { x: 2, y: 0 });
  assert.deepEqual(freeCell(ts, 'Bar'), { x: 0, y: 0 });
  assert.equal(nextName(ts), 'T-04');
  assert.deepEqual(areasOf(ts), ['Indoor', 'Outdoor']);
});

test('QR table links: numbers become T-NN, names pass through', () => {
  assert.equal(tableParam('07'), 'T-07');
  assert.equal(tableParam('t-7'), 'T-07');
  assert.equal(tableParam('VIP%201'), 'VIP 1');
  assert.equal(tableParam('Bar 3'), 'Bar 3');
});

test('a table is taken while the bill is open or food is still in the kitchen, even when paid first', () => {
  const o = (status: string, kds = 'new', table: string | null = 'T-03') => ({ table, status, lines: [{ fired: true, kds }] });
  assert.ok(holdsTable(o('open')) && holdsTable(o('held')) && holdsTable(o('paying')));
  assert.ok(holdsTable(o('paid')), 'QR paid by QRIS, still cooking');
  assert.ok(!holdsTable(o('paid', 'done')), 'paid and out of the kitchen: free');
  assert.ok(!holdsTable(o('voided')) && !holdsTable(o('refunded')) && !holdsTable(o('open', 'new', null)));
});
