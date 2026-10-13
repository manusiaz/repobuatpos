import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawerReady, setupFor, VIAS } from '../devices/connect.ts';
import { CONNECTORS } from '../integrations/connectors/devices.ts';
import { seed } from './seed.ts';
import { perm } from '../system/perms.ts';

const ids = new Set(CONNECTORS.map(c => c.id));

test('every pick maps to a real, ready connector with its required settings', () => {
  for (const [gear, vias] of Object.entries(VIAS)) for (const via of vias) {
    const s = setupFor(gear as never, via, { host: '192.168.1.87' });
    const c = CONNECTORS.find(x => x.id === s.connector);
    assert.ok(ids.has(s.connector) && c?.ready, `${gear}/${via} → ${s.connector}`);
    for (const f of c!.fields ?? []) if (f.required) assert.ok(s.config[f.key] !== undefined && s.config[f.key] !== '', `${s.connector} needs ${f.key}`);
  }
});

test('printer defaults: receipt auto-prints at 80 mm, kitchen keeps its station, LAN needs an IP', () => {
  assert.deepEqual(setupFor('receipt', 'usb').config, { station: 'receipt', paper: '80', autoPrint: true, copies: 1 });
  assert.equal(setupFor('receipt', 'usb').pair, 'usb');
  const k = setupFor('kitchen', 'lan', { station: 'bar', host: ' 10.0.0.9 ', paper: '58' });
  assert.equal(k.connector, 'printer-lan'); assert.equal(k.config.station, 'bar'); assert.equal(k.config.host, '10.0.0.9'); assert.equal(k.config.autoPrint, false); assert.equal(k.pair, null);
  assert.throws(() => setupFor('kitchen', 'lan'), /IP address/);
});

test('a cash drawer needs a printer that can kick it first', () => {
  assert.equal(drawerReady([]), false);
  assert.equal(drawerReady(['printer-browser']), false);
  assert.equal(drawerReady(['printer-usb']), true);
});

test('owner, manager and PIC connect devices; cashier, kitchen and waiter do not', () => {
  const db = seed();
  const may = (r: string) => perm(db, r as never, 'Connect devices & printers', 'sen');
  assert.deepEqual(['owner', 'manager', 'pic', 'cashier', 'kitchen', 'waiter'].map(may), ['y', 'y', 'y', 'n', 'n', 'n']);
});
