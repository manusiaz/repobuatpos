// The register keeps selling offline: the browser's connection drives the device state, sales queue in order, and drain once back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshot } from './store.ts';
import { addLine, newOrder, setDeviceOnline } from './actions.ts';
import { flushQueue } from './actions/pos.ts';
import { netChange } from '../app/offline.ts';

test('connection → device: offline goes off; back online only undoes what the connection did, never the Online switch', () => {
  assert.equal(netChange(false, true, false), 'off');
  assert.equal(netChange(false, false, false), null, 'already off (switch or earlier event)');
  assert.equal(netChange(true, false, true), 'on');
  assert.equal(netChange(true, false, false), null, 'switched off by hand: stays off');
  assert.equal(netChange(true, true, true), null);
});

test('offline sales apply at once, queue in order and drain when back online', () => {
  setDeviceOnline(false);
  const id = newOrder('sen', 'tono', 'pos');
  addLine(id, 'p2', [], 1, '', 'tono');
  const d = snapshot();
  assert.ok(d.orders.some(o => o.id === id && o.lines.length === 1), 'the sale is on the register right away');
  assert.deepEqual(d.device.queue.map(q => q.action), ['order.created', 'order.line_added'], 'oldest first; going offline is not a write to sync');
  setDeviceOnline(true);
  assert.equal(flushQueue('tono'), d.device.queue.length);
  assert.equal(snapshot().device.queue.length, 0);
});
