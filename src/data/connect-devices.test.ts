import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawerReady, machineUsers, SCREEN, setupFor, userConfig, VIAS } from '../devices/connect.ts';
import { parseAttlog } from '../devices/zk.ts';
import { CONNECTORS } from '../integrations/connectors/devices.ts';
import { seed } from './seed.ts';
import { perm } from '../system/perms.ts';

const ids = new Set(CONNECTORS.map(c => c.id));

test('every pick maps to a real, ready connector with its required settings', () => {
  for (const [gear, vias] of Object.entries(VIAS)) for (const via of vias) {
    if (SCREEN[gear as never]) { assert.throws(() => setupFor(gear as never, via)); continue; }
    const s = setupFor(gear as never, via, { host: '192.168.1.87', serial: 'ckjf2039' });
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

test('label printer keeps its own station; the attendance machine needs its serial and unique numeric user IDs', () => {
  assert.equal(setupFor('label', 'usb').config.station, 'label');
  assert.throws(() => setupFor('attendance', 'none'), /serial number/);
  const a = setupFor('attendance', 'none', { serial: ' ckjf2039 ', users: { rina: '3', tono: '', budi: '12' } });
  assert.deepEqual(a.config, { serial: 'CKJF2039', tz: '+07:00', 'user.3': 'rina', 'user.12': 'budi' });
  assert.deepEqual(machineUsers(a.config), { rina: '3', budi: '12' });
  const f = setupFor('attendance', 'none', { brand: 'fingerspot', serial: 'c2611851572e0c2d', key: 'k1', users: { rina: '622' } });
  assert.equal(f.connector, 'attendance-fingerspot'); assert.deepEqual(f.config, { serial: 'C2611851572E0C2D', tz: '+07:00', key: 'k1', 'user.622': 'rina' });
  assert.throws(() => setupFor('attendance', 'none', { brand: 'fingerspot', serial: 'C2611851572E0C2D' }), /key/);
  assert.throws(() => userConfig({ a: '5', b: '5' }), /used twice/);
  assert.throws(() => userConfig({ a: 'x1' }), /must be a number/);
});

test('ATTLOG lines from the machine parse; junk lines are skipped', () => {
  assert.deepEqual(parseAttlog('3\t2026-10-13 07:58:02\t0\t1\t0\t0\r\n12\t2026-10-13 17:01:40\t1\t15\n\nOPLOG 4\tx\n'),
    [{ pin: '3', time: '2026-10-13 07:58:02', status: '0', verify: '1' }, { pin: '12', time: '2026-10-13 17:01:40', status: '1', verify: '15' }]);
});
