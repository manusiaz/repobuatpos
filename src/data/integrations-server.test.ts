// Server integrations: signatures, provider request shapes, delivery normalization, journal, connector containers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHmac } from 'node:crypto';
import { CONNECTORS, connector } from '../integrations/registry.ts';
import { simulator, simulatorSignature, gateway } from '../integrations/server/payments/index.ts';
import { metaCloud, resend, msisdn, sender } from '../integrations/server/messaging/index.ts';
import { signOutgoing, verifyOutgoing, hmac } from '../integrations/server/sign.ts';
import { deliver, publicEndpoint } from '../integrations/server/webhooks/deliver.ts';
import { subscribed } from '../integrations/server/webhooks/events.ts';
import { normalizeOrder, parsePlatform } from '../integrations/server/delivery/index.ts';
import { journalCsv, journalRows } from '../integrations/server/accounting/journal.ts';
import { testConnection } from '../integrations/server/test.ts';
import { NotConnected } from '../integrations/server/types.ts';
import { snapshot } from './store.ts';
import { DAY, startOfDay } from '../screens/insight/metrics.ts';

const hdr = (h: Record<string, string>) => ({ get: (k: string) => h[k.toLowerCase()] ?? null });
const ctx = (secrets: Record<string, string> = {}, config: Record<string, unknown> = {}, f?: typeof fetch) => ({ secrets, config, fetch: f });

test('simulator gateway: charge shapes per method, webhook verifies only with the right signature', async () => {
  const base = { tenantId: 't1', paymentId: 'payabc123', orderNo: '#12', amount: 45_000, expiresAt: 1 };
  const q = await simulator.createCharge({ ...base, method: 'qris' }, ctx());
  assert.equal(q.providerRef, 'SIM-payabc123');
  assert.match(q.qrString!, /payabc123\|#12\|45000$/);
  assert.ok((await simulator.createCharge({ ...base, method: 'va' }, ctx())).vaNumber);
  assert.ok((await simulator.createCharge({ ...base, method: 'ewallet' }, ctx())).deeplink);

  const raw = JSON.stringify({ paymentId: 'payabc123', status: 'settled', amount: 45_000 });
  const ok = simulator.parseWebhook(hdr(simulatorSignature('s3cret', raw)), raw, ctx({ webhookSecret: 's3cret' }));
  assert.deepEqual(ok, { paymentId: 'payabc123', status: 'settled', providerRef: 'SIM-payabc123', amount: 45_000 });
  assert.equal(simulator.parseWebhook(hdr(simulatorSignature('wrong', raw)), raw, ctx({ webhookSecret: 's3cret' })), null, 'bad signature');
  assert.equal(simulator.parseWebhook(hdr(simulatorSignature('s3cret', raw)), raw.replace('45000', '1'), ctx({ webhookSecret: 's3cret' })), null, 'tampered body');
  assert.equal(simulator.parseWebhook(hdr(simulatorSignature('', raw)), raw, ctx()), null, 'no secret configured = nothing settles');
  const bad = JSON.stringify({ paymentId: 'p', status: 'paid' });
  assert.equal(simulator.parseWebhook(hdr(simulatorSignature('s', bad)), bad, ctx({ webhookSecret: 's' })), null, 'unknown status');
});

test('gateways without a driver fail clearly instead of pretending', async () => {
  for (const id of ['xendit', 'midtrans', 'doku']) {
    await assert.rejects(gateway(id)!.createCharge({ tenantId: 't', paymentId: 'p', orderNo: '#1', amount: 1, method: 'qris', expiresAt: 1 }, ctx()), (e: Error) => e instanceof NotConnected && /not connected yet/.test(e.message));
    assert.equal((await gateway(id)!.test(ctx())).ok, false);
  }
});

test('outgoing webhook HMAC: X-BorNiz-Signature = t=<unix>,v1=HMAC-SHA256("<t>.<body>")', async () => {
  const body = '{"id":"e1","event":"order.paid"}', t = 1_760_000_000;
  const sig = signOutgoing('whsec', body, t);
  assert.equal(sig, `t=${t},v1=${createHmac('sha256', 'whsec').update(`${t}.${body}`).digest('hex')}`);
  assert.ok(verifyOutgoing('whsec', body, sig, t + 10));
  assert.ok(!verifyOutgoing('whsec', body + ' ', sig, t + 10), 'body changed');
  assert.ok(!verifyOutgoing('other', body, sig, t + 10), 'wrong secret');
  assert.ok(!verifyOutgoing('whsec', body, sig, t + 3600), 'replayed an hour later');

  let seen: { url: string; init: RequestInit } | null = null;
  const f = (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response(null, { status: 204 }); }) as unknown as typeof fetch;
  const r = await deliver('https://example.com/hook', 'whsec', 'ten1', { id: 'order.paid:o1', event: 'order.paid', at: 5, data: { total: 1 } }, f);
  assert.deepEqual(r, { ok: true, status: 204 });
  const h = seen!.init.headers as Record<string, string>;
  assert.equal(h['x-borniz-event'], 'order.paid');
  assert.ok(verifyOutgoing('whsec', String(seen!.init.body), h['x-borniz-signature']));
  assert.deepEqual(JSON.parse(String(seen!.init.body)), { id: 'order.paid:o1', event: 'order.paid', tenantId: 'ten1', at: 5, data: { total: 1 } });
  for (const u of ['http://example.com', 'https://localhost/x', 'https://10.0.0.4/x', 'https://169.254.169.254/latest', 'https://192.168.1.1', 'https://[::1]/']) assert.ok(!publicEndpoint(u), u);
  assert.equal((await deliver('https://127.0.0.1/x', 's', 't', { id: 'x', event: 'ping', at: 0, data: {} }, f)).ok, false);
  assert.ok(subscribed({}, 'item.86'), 'nothing toggled = every event');
  assert.ok(subscribed({ 'ev:order.paid': true }, 'order.paid') && !subscribed({ 'ev:order.paid': true }, 'item.86'));
});

test('WhatsApp Cloud API: template request shape, status webhook signature', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return Response.json({ messaging_product: 'whatsapp', contacts: [{ input: '6281234567890', wa_id: '6281234567890' }], messages: [{ id: 'wamid.ABC' }] }); }) as unknown as typeof fetch;
  const r = await metaCloud.send({ to: '0812 3456 7890', template: 'e_receipt', lang: 'id', params: ['Dewi', 'Senayan'], idempotencyKey: 'ms1' }, ctx({ accessToken: 'tok' }, { phoneNumberId: '1055', version: 'v21.0' }, f));
  assert.equal(r.providerId, 'wamid.ABC');
  assert.equal(calls[0].url, 'https://graph.facebook.com/v21.0/1055/messages');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal((calls[0].init.headers as Record<string, string>).authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    messaging_product: 'whatsapp', recipient_type: 'individual', to: '6281234567890', type: 'template',
    template: { name: 'e_receipt', language: { code: 'id' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'Dewi' }, { type: 'text', text: 'Senayan' }] }] },
  });
  await assert.rejects(metaCloud.send({ to: '1', template: 't', lang: 'id', params: [], idempotencyKey: 'x' }, ctx({}, { phoneNumberId: '1' }, f)), /accessToken/);
  const err = (async () => Response.json({ error: { message: 'Template name does not exist in the translation' } }, { status: 404 })) as unknown as typeof fetch;
  await assert.rejects(metaCloud.send({ to: '1', template: 't', lang: 'id', params: [], idempotencyKey: 'x' }, ctx({ accessToken: 't' }, { phoneNumberId: '1' }, err)), /WhatsApp 404: Template name/);

  const raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'w', changes: [{ field: 'messages', value: { statuses: [{ id: 'wamid.ABC', status: 'delivered' }, { id: 'wamid.ABC', status: 'read' }] } }] }] });
  const good = hdr({ 'x-hub-signature-256': 'sha256=' + hmac('appsec', raw) });
  assert.deepEqual(metaCloud.parseStatus(good, raw, ctx({ appSecret: 'appsec' })), [{ providerId: 'wamid.ABC', status: 'delivered' }, { providerId: 'wamid.ABC', status: 'read' }]);
  assert.equal(metaCloud.parseStatus(good, raw, ctx({ appSecret: 'other' })), null);
  assert.equal(msisdn('+62 812-3456-7890'), '6281234567890');
  assert.equal(msisdn('81234567890'), '6281234567890');
});

test('Resend: email request shape with idempotency key', async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const f = (async (url: string, init: RequestInit) => { seen = { url, init }; return Response.json({ id: 'em_1' }); }) as unknown as typeof fetch;
  const r = await resend.send({ to: 'dewi@example.com', subject: 'E-receipt · Kopi Biru', text: 'Total IDR 45.000', idempotencyKey: 'ms9' }, ctx({ apiKey: 're_x' }, { from: 'Kopi Biru <struk@kopibiru.id>' }, f));
  assert.equal(r.providerId, 'em_1');
  assert.equal(seen!.url, 'https://api.resend.com/emails');
  const h = seen!.init.headers as Record<string, string>;
  assert.equal(h.authorization, 'Bearer re_x');
  assert.equal(h['idempotency-key'], 'ms9');
  assert.deepEqual(JSON.parse(String(seen!.init.body)), { from: 'Kopi Biru <struk@kopibiru.id>', to: ['dewi@example.com'], subject: 'E-receipt · Kopi Biru', text: 'Total IDR 45.000' });
});

test('delivery relay: signed order → internal delivery order; wrong signature or native payload refused', () => {
  const o = { externalId: 'GF-889', merchantId: 'M-SEN', tier: 'rush' as const, items: [{ sku: 'p2', name: 'Es Kopi Susu', qty: 2, price: 28_000, modifiers: [{ name: 'Less sugar', price: 0 }] }, { id: 'p5', name: 'Croissant', qty: 1, price: 30_000 }], discount: 5_000, customer: { name: 'Raka', phone: '0812' }, placedAt: 1_000 };
  const raw = JSON.stringify(o);
  const got = parsePlatform('gofood', hdr({ 'x-borniz-signature': signOutgoing('wh', raw) }), raw, { webhookSecret: 'wh' });
  assert.deepEqual(got, o);
  assert.equal(parsePlatform('gofood', hdr({ 'x-borniz-signature': signOutgoing('nope', raw) }), raw, { webhookSecret: 'wh' }), null);
  assert.throws(() => parsePlatform('grabfood', hdr({}), raw, { webhookSecret: 'wh' }), NotConnected);
  const n = normalizeOrder('gofood', got!, 'sen');
  assert.equal(n.id, 'gofood-GF-889');
  assert.equal(n.idemKey, n.id);
  assert.equal(n.source, 'gofood');
  assert.equal(n.type, 'delivery');
  assert.equal(n.status, 'open');
  assert.equal(n.subtotal, 86_000);
  assert.equal(n.total, 81_000);
  assert.deepEqual(n.lines.map(l => [l.productId, l.qty, l.fired, l.kds]), [['p2', 2, false, 'new'], ['p5', 1, false, 'new']]);
  assert.equal(n.readyBy, 1_000 + 14 * 60e3);
  assert.equal(normalizeOrder('gofood', { ...got!, status: 'cancelled' }, 'sen').status, 'voided');
});

test('journal CSV: every day and outlet balances, built from the dashboard sales math', () => {
  const db = snapshot(), to = startOfDay(Date.now()) + DAY, r = { from: to - 7 * DAY, to };
  const rows = journalRows(db, 'all', r, { acc_sales: '4-SALES' });
  assert.ok(rows.length > 0);
  const days = new Map<string, number>();
  for (const x of rows) days.set(x.date + x.outlet, (days.get(x.date + x.outlet) ?? 0) + x.debit - x.credit);
  for (const [k, v] of days) assert.equal(v, 0, `${k} balances`);
  assert.ok(rows.some(x => x.account === '4-SALES' && x.credit > 0), 'custom account code used');
  assert.ok(rows.every(x => Number.isInteger(x.debit) && Number.isInteger(x.credit)), 'integer rupiah');
  const csv = journalCsv(rows);
  assert.match(csv, /^Date,Outlet,Account,Description,Debit,Credit\n/);
  assert.equal(csv.trim().split('\n').length, rows.length + 1);
});

test('every connector is a complete container: ids the screens use, fields, docs, webhook routes', async () => {
  const ids = new Set(CONNECTORS.map(c => c.id));
  assert.equal(ids.size, CONNECTORS.length, 'unique ids');
  for (const id of ['simulator', 'xendit', 'midtrans', 'doku', 'wa-simulator', 'meta-cloud', 'qontak', 'wati', 'fonnte', 'email-simulator', 'resend', 'smtp', 'gofood', 'grabfood', 'shopeefood', 'webhook-out', 'journal-csv', 'jurnal', 'accurate'])
    assert.ok(ids.has(id), id);
  for (const c of CONNECTORS) {
    if (!c.ready) {
      if (c.runtime !== "browser") assert.ok(c.fields.length > 0, `${c.id} has fields`); // browser devices pair with a tap
      if (c.runtime === 'server') assert.match(c.docs ?? '', /^https:\/\//, `${c.id} has a docs URL`); // bank ECR specs come with the bank partnership, not a public URL
    }
    for (const f of c.fields) assert.ok(f.key && f.label, `${c.id}.${f.key}`);
    if (c.webhook) {
      const m = /^\/api\/([a-z]+)\/webhook\/([a-z0-9-]+)$/.exec(c.webhook);
      assert.ok(m, `${c.id} webhook path`);
      assert.ok(fs.existsSync(new URL(`../../app/api/${m![1]}/webhook/`, import.meta.url)), `${c.id} webhook route exists`);
      assert.equal(m![2], c.id);
    }
    if (c.runtime === 'server' && ['payment', 'whatsapp', 'email', 'sms'].includes(c.kind)) assert.ok(gateway(c.id) ?? sender(c.id), `${c.id} has a driver entry`);
  }
  assert.equal(connector('gofood')?.scope, 'outlet');
  const t = await testConnection('meta-cloud', 't', ctx({}, {}));
  assert.deepEqual(t, { ok: false, message: 'Phone number ID is missing.' });
});
