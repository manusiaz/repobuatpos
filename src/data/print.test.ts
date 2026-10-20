// Printing as the counter sees it: the LAN bridge prints only for BorNiz pages and only to printer ports, the agent
// never prints a voided or finished bill or an old day again, a reprint is what was sent, and the receipt adds up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import type http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { seed } from './seed.ts';
import type { DB, Integration, Order, OrderLine } from './schema.ts';
import { pendingJobs, prune, ticketLines } from '../devices/routing.ts';
import { receiptDoc } from '../devices/receipt.ts';
import { toText } from '../devices/layout.ts';
import { ROUTING_PAGE } from '../system/settings.ts';

const T = Date.UTC(2026, 9, 11, 7, 32);
const L = (id: string, price: number, extra: Partial<OrderLine> = {}): OrderLine =>
  ({ id, productId: 'p', name: 'Kopi ' + id, qty: 1, unitPrice: price, flashPrice: null, mods: [], note: '', discountPct: 0, station: 'bar', kds: 'new', fired: true, firedAt: T, ...extra });
const bill = (lines: OrderLine[], extra: Partial<Order> = {}): Order => ({ id: 'o-p', no: '#3001', outletId: 'sen', sessionId: null, source: 'pos', type: 'take', status: 'paid', table: null, customerId: null,
  lines, discountPct: 0, promoIds: [], guests: 1, subtotal: 0, discount: 0, service: 0, tax: 0, total: 0, createdAt: T - 60e3, paidAt: T, cashierId: 'rina', idemKey: 'o-p', ...extra });
const printer = (station: string, extra: Record<string, string | number | boolean> = {}): Integration =>
  ({ id: 'pr-' + station, connector: 'printer-usb', kind: 'printer', outletId: 'sen', deviceId: 'd1', name: station, enabled: true, config: { station, paper: '58', ...extra }, secrets: [], status: 'ok', lastOk: null, lastError: null, updatedBy: 'budi', updatedAt: T });
const withBill = (o: Order): DB => { const db = seed(T); db.orders = [o]; db.payments = []; db.integrations.push(printer('bar')); db.settings[ROUTING_PAGE + ':print-ticket'] = true; return db; };

async function bridge(ports?: number[]) {
  const got: Buffer[] = [], p = net.createServer(s => s.on('data', (c: Buffer) => got.push(c)));
  await new Promise<void>(r => p.listen(0, '127.0.0.1', () => r()));
  const { startBridge } = await import(String(new URL('../devices/bridge.mjs', import.meta.url))) as { startBridge: (o: { port: number; ports?: number[] }) => Promise<net.Server> };
  const pport = (p.address() as net.AddressInfo).port, b = await startBridge({ port: 0, ports: ports ?? [pport] });
  const url = `http://127.0.0.1:${(b.address() as net.AddressInfo).port}/print`;
  return { got, pport, url, close: () => { (b as http.Server).closeAllConnections(); b.close(); p.close(); } };
}

test('the bridge refuses a page that is not BorNiz, even a "simple" request with no preflight', async () => {
  const b = await bridge();
  const r = await fetch(b.url, { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'text/plain' }, body: JSON.stringify({ host: '127.0.0.1', port: b.pport, data: Buffer.from([0x1b, 0x70, 0, 25, 250]).toString('base64') }) });
  await new Promise(ok => setTimeout(ok, 50));
  assert.equal(r.status, 403);
  assert.equal(Buffer.concat(b.got).length, 0, 'the drawer did not open');
  b.close();
});

test('the bridge writes only to printer ports, never to other services on the network', async () => {
  const b = await bridge();
  let hit = 0;
  const db = net.createServer(s => s.on('data', () => { hit++; }));
  await new Promise<void>(r => db.listen(0, '127.0.0.1', () => r()));
  const r = await fetch(b.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ host: '127.0.0.1', port: (db.address() as net.AddressInfo).port, data: 'AA==' }) });
  await new Promise(ok => setTimeout(ok, 50));
  assert.equal(r.status, 403);
  assert.equal(hit, 0, 'a non-printer port received nothing');
  db.close(); b.close();
});

test('the bridge starts when its folder has a space in it (C:\\Program Files, "My Documents")', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bn bridge ')), file = path.join(dir, 'bridge.mjs');
  fs.copyFileSync(new URL('../devices/bridge.mjs', import.meta.url), file);
  const p = spawn(process.execPath, [file], { env: { ...process.env, BORNIZ_BRIDGE_PORT: '0' } });
  const out = await new Promise<string>(ok => { let s = ''; p.stdout.on('data', c => { s += c; }); setTimeout(() => ok(s), 1500); });
  p.kill();
  assert.match(out, /BorNiz Bridge on/);
});

test('the agent never prints a voided bill or lines the kitchen already finished', () => {
  assert.equal(pendingJobs(withBill(bill([L('l1', 20000)], { status: 'voided' })), 'd1', {}, T - 1).filter(j => j.kind === 'ticket').length, 0);
  assert.equal(pendingJobs(withBill(bill([L('l1', 20000, { kds: 'done' })], { status: 'sent' })), 'd1', {}, T - 1).filter(j => j.kind === 'ticket').length, 0);
  assert.equal(pendingJobs(withBill(bill([L('l1', 20000)], { status: 'sent' })), 'd1', {}, T - 1).filter(j => j.kind === 'ticket').length, 1, 'a new one still prints');
});

test('forgetting what was printed two days ago never prints those days again', () => {
  const now = T + 5 * 864e5, s = prune({ since: T, done: { 'l:o-old:l1': T }, failed: [] }, now);
  assert.deepEqual(s.done, {});
  assert.ok(s.since >= now - 2 * 864e5, 'the agent no longer looks back past what it remembers');
});

test('a ticket reprint is what was sent to the kitchen, not the held course', () => {
  const o = bill([L('l1', 20000), L('l2', 45000, { fired: false, firedAt: undefined })], { status: 'sent' });
  assert.deepEqual(ticketLines(o).map(l => l.id), ['l1']);
});

test('the receipt adds up: line amounts as charged, cash rounded up shown', () => {
  const o = bill([L('l1', 750, { discountPct: 5 })], { subtotal: 712, total: 712 });
  const db = withBill(o);
  assert.ok(toText(receiptDoc(db, o, '58')).some(l => /712$/.test(l) && l.includes('Kopi l1')), 'line amount = order math (712, not 713)');

  const r = bill([L('l1', 25050)], { subtotal: 25050, total: 25050 }), db2 = withBill(r);
  db2.payments.push({ id: 'c1', orderId: r.id, outletId: 'sen', method: 'cash', amount: 25100, tip: 0, status: 'settled', ref: 'REF-1', at: T, expiresAt: null, sessionId: null });
  const text = toText(receiptDoc(db2, r, '58')).join('\n');
  assert.match(text, /Cash rounding\s+50/);
  assert.match(text, /TOTAL\s+IDR 25,100/);

});

