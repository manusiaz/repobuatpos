// Hardware layer without hardware: ESC/POS bytes are checked byte for byte (golden), routing and EDC as pure logic,
// the LAN bridge end to end against a local TCP socket standing in for a printer on port 9100.
process.env.TZ = 'Asia/Jakarta';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { seed } from './seed.ts';
import type { DB, Integration, Order, OrderLine } from './schema.ts';
import { ascii, CMD, code128, poleBytes, qr } from '../devices/escpos.ts';
import { toEscPos, toText, wrap } from '../devices/layout.ts';
import { kitchenDoc, receiptDoc } from '../devices/receipt.ts';
import { keysOf, pendingJobs, stationPrinter } from '../devices/routing.ts';
import { ROUTING_PAGE } from '../system/settings.ts';
import { checkEntry, edcDriver, edcRef, EdcPending, manualDriver } from '../devices/edc.ts';
import { parseWeight } from '../devices/scale.ts';
import { createWedge, findByCode } from '../devices/scanner.ts';
import { bridgeSend } from '../devices/transports.ts';


const T = Date.UTC(2026, 9, 11, 7, 32); // 14:32 WIB
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex').slice(0, 16);
const L = (id: string, name: string, qty: number, price: number, station: OrderLine['station'], extra: Partial<OrderLine> = {}): OrderLine =>
  ({ id, productId: 'p', name, qty, unitPrice: price, flashPrice: null, mods: [], note: '', discountPct: 0, station, kds: 'new', fired: true, firedAt: T, ...extra });

function fixture(): { db: DB; o: Order } {
  const db = seed(T);
  const o: Order = { id: 'o-test', no: '#2050', outletId: 'sen', sessionId: null, source: 'pos', type: 'dine', status: 'paid', table: 'T-07', customerId: 'c1',
    lines: [L('l1', 'Es Kopi Susu Aren', 2, 25000, 'bar', { mods: [{ name: 'Large', price: 5000 }, { name: 'Less sugar', price: 0 }] }),
      L('l2', 'Nasi Goreng Spesial', 1, 38000, 'kitchen', { note: 'alergi udang, no shrimp' }), L('l3', 'Croissant Almond', 1, 32000, 'pastry', { fired: false, firedAt: undefined })],
    discountPct: 0, promoIds: [], guests: 2, subtotal: 130000, discount: 0, service: 6500, tax: 13650, total: 150150, createdAt: T - 10 * 60e3, paidAt: T, cashierId: 'rina', idemKey: 'o-test' };
  db.orders.push(o);
  db.payments.push({ id: 'pay1', orderId: o.id, outletId: 'sen', method: 'cash', amount: 150100, tip: 0, status: 'settled', ref: 'REF-AAAAAA', at: T, expiresAt: null, sessionId: null },
    { id: 'pay2', orderId: o.id, outletId: 'sen', method: 'cash', amount: 50, tip: 0, status: 'settled', ref: 'ROUNDING', at: T, expiresAt: null, sessionId: null });
  return { db, o };
}
const P = (id: string, connector: string, station: string, deviceId: string | null, extra: Record<string, string | number | boolean> = {}): Integration =>
  ({ id, connector, kind: 'printer', outletId: 'sen', deviceId, name: id, enabled: true, config: { station, paper: '80', ...extra }, secrets: [], status: 'ok', lastOk: null, lastError: null, updatedBy: 'budi', updatedAt: T });

test('ESC/POS primitives are the documented bytes', () => {
  assert.deepEqual(CMD.init, [0x1b, 0x40, 0x1b, 0x74, 0x00]);
  assert.deepEqual(CMD.kick(), [0x1b, 0x70, 0x00, 25, 250], 'ESC p 0 25 250');
  assert.deepEqual(CMD.cut, [0x1d, 0x56, 0x42, 0x00]);
  assert.deepEqual(CMD.size(2, 2), [0x1d, 0x21, 0x11]);
  assert.deepEqual(qr('AB', 6), [0x1d, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0, 0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x43, 6, 0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31,
    0x1d, 0x28, 0x6b, 5, 0, 0x31, 0x50, 0x30, 0x41, 0x42, 0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30]);
  assert.deepEqual(code128('KB-1'), [0x1d, 0x68, 80, 0x1d, 0x77, 2, 0x1d, 0x48, 2, 0x1d, 0x6b, 0x49, 6, 0x7b, 0x42, 0x4b, 0x42, 0x2d, 0x31]);
  assert.equal(ascii('Crème brûlée · 2× “Kopi” – Rp'), 'Creme brulee - 2x "Kopi" - Rp');
  assert.deepEqual(wrap('Es Kopi Susu Aren Gula Merah Spesial', 16), ['Es Kopi Susu', 'Aren Gula Merah', 'Spesial']);
});

const RECEIPT_58 = [
  '           Kopi Biru', '            Senayan', '        Jakarta Selatan', '--------------------------------',
  'No #2050        11/10/2026 14:32', 'Cashier Rina          T-07 2 pax', 'Member Dewi Anggraini', '--------------------------------',
  '2 Es Kopi Susu Aren       60,000', '  + Large', '  + Less sugar', '  @ 30,000', '1 Nasi Goreng Spesial     38,000', '  * alergi udang, no shrimp',
];
test('customer receipt, 58 and 80 mm: golden bytes, every line fits the roll, totals from the order', () => {
  const { db, o } = fixture();
  const docs = { '58': receiptDoc(db, o, '58', { change: 49900 }), '80': receiptDoc(db, o, '80', { change: 49900 }) };
  for (const [paper, doc] of Object.entries(docs)) {
    const lines = toText(doc), w = paper === '58' ? 32 : 48;
    assert.ok(lines.every(l => l.length <= w || l.startsWith('[QR]')), `${paper} mm: no line wider than ${w}`);
    const text = lines.join('\n');
    for (const s of ['Subtotal', '130,000', 'Service 5%', '6,500', 'PB1 10%', '13,650', 'Cash rounding', '-50', 'IDR 150,100', 'Change', '49,900', '+ Large', 'Terima kasih sudah mampir!', 'WiFi KOPIBIRU-GUEST'])
      assert.ok(text.includes(s), `${paper} mm shows ${s}`);
    assert.match(text, /\[QR\] https?:\/\/[^\s/]+\/order\/customer-links\/feedback-and-rating\?o=o-test/, 'QR follows the published receipt design (rating), a full address even off a page');
  }
  assert.deepEqual(toText(docs['58']).slice(0, RECEIPT_58.length), RECEIPT_58);
  const b58 = toEscPos(docs['58']), b80 = toEscPos(docs['80']);
  assert.deepEqual([...b58.slice(0, 5)], CMD.init);
  assert.deepEqual([...b80.slice(-4)], CMD.cut);
  assert.equal(sha(b58), GOLDEN.r58, 'receipt 58 mm bytes');
  assert.equal(sha(b80), GOLDEN.r80, 'receipt 80 mm bytes');
  assert.ok(Buffer.from(b80).includes(Buffer.from('TOTAL'.padEnd(48 - 11) + 'IDR 150,100')), 'tall TOTAL line, 48 cols');
});

test('kitchen ticket per station: only that station’s fired lines, big table and number, allergy highlighted', () => {
  const { db, o } = fixture();
  const kitchen = o.lines.filter(l => l.station === 'kitchen' && l.fired);
  const d80 = kitchenDoc(db, o, 'kitchen', kitchen, '80'), d58 = kitchenDoc(db, o, 'kitchen', kitchen, '58');
  const text = toText(d80).join('\n');
  assert.ok(text.includes('NASI GORENG') && !text.includes('KOPI') && !text.includes('CROISSANT'));
  assert.ok(toText(d58).every(l => l.length <= 32));
  assert.ok(text.includes('!! ALLERGY: ALERGI UDANG, NO SHRIMP !!'));
  const b = Buffer.from(toEscPos(d58));
  const allergy = b.indexOf(Buffer.from('!! ALLERGY'));
  assert.deepEqual([...b.subarray(allergy - 6, allergy)], [0x1b, 0x45, 1, 0x1d, 0x42, 1], 'allergy line is bold + reversed (white on black)');
  assert.ok(b.includes(Buffer.from([0x1d, 0x21, 0x11, ...Buffer.from('T-07')])), 'table in double size');
  assert.equal(sha(toEscPos(d58)), GOLDEN.k58, 'kitchen 58 mm bytes');
  assert.equal(sha(toEscPos(d80)), GOLDEN.k80, 'kitchen 80 mm bytes');
});

test('routing: each fired line goes once to its station printer on the device that drives it', () => {
  const { db, o } = fixture();
  db.orders = [o];
  db.integrations.push(P('bar', 'printer-usb', 'bar', 'd1'), P('front', 'printer-browser', 'receipt', 'd1', { autoPrint: true }), P('kit', 'printer-lan', 'kitchen', null));
  assert.equal(stationPrinter(db, 'sen', 'pastry'), undefined, 'no pastry printer: KDS only');
  assert.equal(pendingJobs(db, 'd1', {}, T - 1).filter(j => j.kind === 'ticket').length, 0, 'KDS online and no paper backup: the KDS is the ticket');
  db.settings[ROUTING_PAGE + ':print-ticket'] = true; // owner wants paper as a backup
  const jobs = pendingJobs(db, 'd1', {}, T - 1);
  assert.deepEqual(jobs.map(j => [j.kind, j.integrationId, j.station ?? '', (j.lineIds ?? []).join()]),
    [['ticket', 'bar', 'bar', 'l1'], ['ticket', 'kit', 'kitchen', 'l2'], ['receipt', 'front', '', '']], 'kitchen printer set up in the back office is driven by the outlet’s first register');
  assert.deepEqual(pendingJobs(db, 'd5', {}, T - 1), [], 'Kemang register prints nothing for Senayan');
  const done = Object.fromEntries(jobs.flatMap(j => keysOf(j, o)).map(k => [k, T]));
  assert.deepEqual(pendingJobs(db, 'd1', done, T - 1), [], 'printed once');
  assert.deepEqual(pendingJobs(db, 'd1', {}, T + 1), [], 'nothing from before the agent started');
  db.integrations.push(P('all', 'printer-usb', 'all', 'd1'));
  db.integrations = db.integrations.filter(i => i.id !== 'kit');
  assert.equal(pendingJobs(db, 'd1', {}, T - 1).find(j => j.station === 'kitchen')?.integrationId, 'all', 'one printer for everything');
});

test('EDC: manual entry from the slip is the ready driver; bank ECR is a container that falls back to manual', async () => {
  const d = manualDriver('BCA');
  assert.equal(checkEntry({ approvalCode: '12A' }), 'Approval code is the 6 letters or digits after "APPR CODE" on the EDC slip.');
  assert.match(checkEntry({ approvalCode: '123456', last4: '12' }) ?? '', /last 4/);
  await assert.rejects(d.charge({ amount: 50000, ref: 'x', entry: { approvalCode: '1' } }));
  const r = await d.charge({ amount: 50000, ref: 'x', entry: { approvalCode: 'a1b2c3', last4: '4321', trace: '123' } });
  assert.deepEqual(r, { status: 'approved', approvalCode: 'A1B2C3', trace: '000123', cardMasked: '****4321' });
  assert.equal(edcRef('BCA', r), 'EDC BCA · Appr A1B2C3 · Trace 000123 · ****4321');
  const ecr = edcDriver({ connector: 'edc-mandiri', config: {} } as unknown as Integration);
  assert.equal(ecr.mode, 'pending');
  await assert.rejects(ecr.charge({ amount: 1, ref: 'x' }), (e: Error) => e instanceof EdcPending && /Mandiri ECR/.test(e.message));
  const sim = edcDriver({ connector: 'edc-simulator', config: {} } as unknown as Integration);
  assert.equal((await sim.charge({ amount: 1000, ref: 'o1', outcome: 'declined' })).status, 'declined');
  assert.match((await sim.charge({ amount: 1000, ref: 'o1' })).approvalCode, /^[0-9A-Z]{6}$/);
});

test('scale frames, keyboard-wedge bursts and SKU lookup', () => {
  assert.deepEqual(parseWeight('ST,GS,+  0.250kg'), { kg: 0.25, stable: true, net: false });
  assert.deepEqual(parseWeight('US,NT,+  1.205kg'), { kg: 1.205, stable: false, net: true });
  assert.deepEqual(parseWeight('  0.250 kg'), { kg: 0.25, stable: true, net: false });
  assert.deepEqual(parseWeight('   750 g'), { kg: 0.75, stable: true, net: false });
  assert.equal(parseWeight('ST,GS,OL'), null);
  const feed = createWedge();
  let got: string | null = null;
  [...'KB-003'].forEach((k, i) => { got = feed(k, 1000 + i * 8) ?? got; });
  assert.equal(feed('Enter', 1050), 'KB-003');
  [...'1234'].forEach((k, i) => feed(k, 5000 + i * 150));
  assert.equal(feed('Enter', 5700), null, 'a person typing is not a scan');
  assert.equal(findByCode(seed(T), 'kb003')?.name, 'Cappuccino');
  assert.deepEqual([...poleBytes('Total', 'IDR 25,000').slice(0, 3)], [0x1b, 0x40, 0x0c]);
});

test('LAN bridge delivers the exact bytes to a printer socket (port 9100 stand-in)', async () => {
  const got: Buffer[] = [];
  const printer = net.createServer(s => s.on('data', (c: Buffer) => got.push(c)));
  await new Promise<void>(r => printer.listen(0, '127.0.0.1', () => r()));
  const { startBridge } = await import(String(new URL('../devices/bridge.mjs', import.meta.url))) as { startBridge: (o: { port: number; ports?: number[] }) => Promise<net.Server> };
  const bridge = await startBridge({ port: 0, ports: [(printer.address() as net.AddressInfo).port] });
  const bytes = toEscPos(receiptDoc(fixture().db, fixture().o, '58'));
  await bridgeSend(`http://127.0.0.1:${(bridge.address() as net.AddressInfo).port}`, '127.0.0.1', (printer.address() as net.AddressInfo).port, bytes);
  await new Promise(r => setTimeout(r, 50));
  assert.equal(Buffer.concat(got).compare(Buffer.from(bytes)), 0);
  bridge.close(); printer.close();
});

const GOLDEN = { r58: 'd20fbe316ef5a4d2', r80: '6cfa4e376ed8b819', k58: '075f26e0f86b8131', k80: '7b54a5045cbb0095' };
