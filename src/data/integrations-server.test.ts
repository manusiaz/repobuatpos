// Server integrations: signatures, provider request shapes, delivery normalization, journal, connector containers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHmac } from 'node:crypto';
import { CONNECTORS, connector } from '../integrations/registry.ts';
import { simulator, simulatorSignature, gateway } from '../integrations/server/payments/index.ts';
import { metaCloud, resend, msisdn, sender } from '../integrations/server/messaging/index.ts';
import { signOutgoing, verifyOutgoing, hmac, sha } from '../integrations/server/sign.ts';
import { xendit } from '../integrations/server/payments/xendit.ts';
import { midtrans } from '../integrations/server/payments/midtrans.ts';
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
  for (const id of ['doku']) {
    await assert.rejects(gateway(id)!.createCharge({ tenantId: 't', paymentId: 'p', orderNo: '#1', amount: 1, method: 'qris', expiresAt: 1 }, ctx()), (e: Error) => e instanceof NotConnected && /not connected yet/.test(e.message));
    assert.equal((await gateway(id)!.test(ctx())).ok, false);
  }
});

type Call = { url: string; method: string; headers: Record<string, string>; body: any };
/** Stub fetch: records each request, answers from the queue (status, JSON body). */
const stub = (...answers: [number, unknown][]) => {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const [status, body] = answers[Math.min(calls.length - 1, answers.length - 1)];
    return Response.json(body, { status });
  }) as unknown as typeof fetch;
  return { f, calls };
};
const basic = (k: string) => 'Basic ' + Buffer.from(k + ':').toString('base64');
const charge = { tenantId: 't1', paymentId: 'pay123', orderNo: '#12', amount: 45_000, expiresAt: Date.parse('2026-10-12T10:15:00Z') };

test('Xendit: QRIS, VA and e-wallet request shapes; integer rupiah only; provider errors without secrets', async () => {
  const sec = { secretKey: 'xnd_development_abc', callbackToken: 'cbt' };
  let s = stub([200, { id: 'qr_1', qr_string: '00020101021226', status: 'ACTIVE' }]);
  const q = await xendit.createCharge({ ...charge, method: 'qris' }, ctx(sec, { mode: 'sandbox' }, s.f));
  assert.deepEqual(q, { providerRef: 'qr_1', qrString: '00020101021226', expiresAt: charge.expiresAt });
  assert.equal(s.calls[0].url, 'https://api.xendit.co/qr_codes');
  assert.equal(s.calls[0].method, 'POST');
  assert.equal(s.calls[0].headers.authorization, basic('xnd_development_abc'));
  assert.equal(s.calls[0].headers['api-version'], '2022-07-31');
  assert.deepEqual(s.calls[0].body, { reference_id: 'pay123', type: 'DYNAMIC', currency: 'IDR', amount: 45_000, expires_at: '2026-10-12T10:15:00.000Z' });

  s = stub([200, { id: 'va_1', account_number: '107669999123456' }]);
  const v = await xendit.createCharge({ ...charge, method: 'va', customer: { name: 'Dewi A.' } }, ctx(sec, { vaBank: 'BNI' }, s.f));
  assert.deepEqual(v, { providerRef: 'va_1', vaNumber: '107669999123456', expiresAt: charge.expiresAt });
  assert.equal(s.calls[0].url, 'https://api.xendit.co/callback_virtual_accounts');
  assert.deepEqual(s.calls[0].body, { external_id: 'pay123', bank_code: 'BNI', name: 'Dewi A', is_closed: true, is_single_use: true, expected_amount: 45_000, expiration_date: '2026-10-12T10:15:00.000Z' });
  s = stub([200, { id: 'va_2', account_number: '1' }]);
  await xendit.createCharge({ ...charge, method: 'va' }, ctx(sec, {}, s.f));
  assert.equal(s.calls[0].body.bank_code, 'BCA', 'default bank');

  s = stub([200, { id: 'ewc_1', status: 'PENDING', actions: { desktop_web_checkout_url: 'https://web', mobile_deeplink_checkout_url: 'shopeeid://pay' } }]);
  const e = await xendit.createCharge({ ...charge, method: 'ewallet' }, ctx(sec, { ewallet: 'ID_SHOPEEPAY', redirectUrl: 'https://order.bornis.id/kopibiru' }, s.f));
  assert.deepEqual(e, { providerRef: 'ewc_1', deeplink: 'shopeeid://pay', expiresAt: charge.expiresAt });
  assert.equal(s.calls[0].url, 'https://api.xendit.co/ewallets/charges');
  assert.deepEqual(s.calls[0].body, { reference_id: 'pay123', currency: 'IDR', amount: 45_000, checkout_method: 'ONE_TIME_PAYMENT', channel_code: 'ID_SHOPEEPAY', channel_properties: { success_redirect_url: 'https://order.bornis.id/kopibiru' } });
  await assert.rejects(xendit.createCharge({ ...charge, method: 'ewallet' }, ctx(sec, {}, s.f)), /Missing setting: redirectUrl/);
  s = stub([200, { id: 'ewc_2', actions: { desktop_web_checkout_url: 'https://web' } }]);
  await xendit.createCharge({ ...charge, method: 'ewallet', customer: { phone: '0812 3456 7890' } }, ctx(sec, { ewallet: 'ID_OVO' }, s.f));
  assert.deepEqual(s.calls[0].body.channel_properties, { mobile_number: '+6281234567890' });
  await assert.rejects(xendit.createCharge({ ...charge, method: 'ewallet' }, ctx(sec, { ewallet: 'ID_OVO' }, s.f)), /phone/);

  await assert.rejects(xendit.createCharge({ ...charge, amount: 45_000.5, method: 'qris' }, ctx(sec, {}, s.f)), /whole number of rupiah/);
  s = stub([400, { error_code: 'API_VALIDATION_ERROR', message: 'amount must be at least 1500' }]);
  await assert.rejects(xendit.createCharge({ ...charge, method: 'qris' }, ctx(sec, {}, s.f)), (err: Error) => /Xendit 400: amount must be at least 1500/.test(err.message) && !err.message.includes('xnd_'));
});

test('Xendit webhooks: x-callback-token verified; QR, VA and e-wallet statuses mapped', () => {
  const c = ctx({ callbackToken: 'cbt' }), good = hdr({ 'x-callback-token': 'cbt' });
  const qr = (status: string) => JSON.stringify({ event: 'qr.payment', data: { id: 'qrpy_1', qr_id: 'qr_1', reference_id: 'pay123', amount: 45_000, status } });
  assert.deepEqual(xendit.parseWebhook(good, qr('SUCCEEDED'), c), { paymentId: 'pay123', status: 'settled', providerRef: 'qr_1', amount: 45_000 });
  assert.equal(xendit.parseWebhook(good, qr('FAILED'), c)?.status, 'failed');
  assert.equal(xendit.parseWebhook(good, qr('EXPIRED'), c)?.status, 'expired');
  assert.equal(xendit.parseWebhook(hdr({ 'x-callback-token': 'nope' }), qr('SUCCEEDED'), c), null, 'wrong token');
  assert.equal(xendit.parseWebhook(hdr({}), qr('SUCCEEDED'), c), null, 'no token');
  assert.equal(xendit.parseWebhook(good, qr('SUCCEEDED'), ctx()), null, 'no token configured = nothing settles');

  const va = JSON.stringify({ id: 'cb1', payment_id: 'vap_1', callback_virtual_account_id: 'va_1', external_id: 'pay123', bank_code: 'BCA', amount: 45_000 });
  assert.deepEqual(xendit.parseWebhook(good, va, c), { paymentId: 'pay123', status: 'settled', providerRef: 'va_1', amount: 45_000 });
  const vaCreated = JSON.stringify({ id: 'va_1', external_id: 'pay123', status: 'ACTIVE', expected_amount: 45_000 });
  assert.equal(xendit.parseWebhook(good, vaCreated, c)?.status, 'pending', 'VA created/updated changes nothing');

  const ew = (status: string) => JSON.stringify({ event: 'ewallet.capture', data: { id: 'ewc_1', reference_id: 'pay123', status, charge_amount: 45_000, capture_amount: 45_000 } });
  assert.deepEqual(xendit.parseWebhook(good, ew('SUCCEEDED'), c), { paymentId: 'pay123', status: 'settled', providerRef: 'ewc_1', amount: 45_000 });
  assert.equal(xendit.parseWebhook(good, ew('FAILED'), c)?.status, 'failed');
  assert.equal(xendit.parseWebhook(good, ew('VOIDED'), c)?.status, 'failed');
  assert.equal(xendit.parseWebhook(good, ew('PENDING'), c)?.status, 'pending');
});

test('Xendit refund per charge type, and test() against /balance', async () => {
  const sec = { secretKey: 'xnd_production_abc' }, r = { paymentId: 'pay123', amount: 20_000, reason: 'Wrong order' };
  let s = stub([200, { id: 'ewr_1', status: 'SUCCEEDED' }]);
  assert.deepEqual(await xendit.refund({ ...r, providerRef: 'ewc_1' }, ctx(sec, {}, s.f)), { refundRef: 'ewr_1', status: 'refunded' });
  assert.equal(s.calls[0].url, 'https://api.xendit.co/ewallets/charges/ewc_1/refunds');
  assert.deepEqual(s.calls[0].body, { amount: 20_000, reason: 'REQUESTED_BY_CUSTOMER' });

  s = stub([200, { data: [{ id: 'qrpy_9', status: 'SUCCEEDED' }] }], [200, { id: 'qrpyr_1', status: 'PENDING' }]);
  assert.deepEqual(await xendit.refund({ ...r, providerRef: 'qr_1' }, ctx(sec, {}, s.f)), { refundRef: 'qrpyr_1', status: 'pending' });
  assert.equal(s.calls[0].url, 'https://api.xendit.co/qr_codes/qr_1/payments');
  assert.equal(s.calls[1].url, 'https://api.xendit.co/qr_codes/payments/qrpy_9/refunds');
  assert.equal(s.calls[1].body.amount, 20_000);
  assert.equal(s.calls[1].body.reason, 'Wrong order');
  await assert.rejects(xendit.refund({ ...r, providerRef: 'va_1' }, ctx(sec, {}, s.f)), /bank transfer/);
  await assert.rejects(xendit.refund({ ...r, amount: 0.5, providerRef: 'ewc_1' }, ctx(sec, {}, s.f)), /whole number/);

  s = stub([200, { balance: 1_000_000 }]);
  assert.deepEqual(await xendit.test(ctx(sec, { mode: 'live' }, s.f)), { ok: true, message: 'Xendit live key accepted.' });
  assert.equal(s.calls[0].url, 'https://api.xendit.co/balance');
  assert.equal(s.calls[0].headers.authorization, basic('xnd_production_abc'));
  assert.equal((await xendit.test(ctx(sec, { mode: 'sandbox' }, s.f))).ok, false, 'live key in sandbox mode');
  await assert.rejects(xendit.test(ctx(sec, { mode: 'live' }, stub([401, { error_code: 'INVALID_API_KEY', message: 'API key is invalid' }]).f)), /Xendit 401: API key is invalid/);
});

test('Midtrans Core API: sandbox/live base, QRIS, VA (permata), GoPay/ShopeePay; body status_code errors', async () => {
  const sec = { serverKey: 'SB-Mid-server-x' };
  let s = stub([200, { status_code: '201', transaction_id: 'trx1', qr_string: '000201', actions: [{ name: 'generate-qr-code', url: 'https://img' }] }]);
  const q = await midtrans.createCharge({ ...charge, method: 'qris' }, ctx(sec, { mode: 'sandbox' }, s.f));
  assert.deepEqual(q, { providerRef: 'trx1', qrString: '000201', deeplink: undefined, expiresAt: charge.expiresAt });
  assert.equal(s.calls[0].url, 'https://api.sandbox.midtrans.com/v2/charge');
  assert.equal(s.calls[0].headers.authorization, basic('SB-Mid-server-x'));
  assert.equal(s.calls[0].body.payment_type, 'qris');
  assert.deepEqual(s.calls[0].body.qris, { acquirer: 'gopay' });
  assert.deepEqual(s.calls[0].body.transaction_details, { order_id: 'pay123', gross_amount: 45_000 });
  assert.equal(s.calls[0].body.custom_expiry.unit, 'minute');
  s = stub([200, { status_code: '201', transaction_id: 'trx1', actions: [{ name: 'generate-qr-code', url: 'https://img' }] }]);
  assert.equal((await midtrans.createCharge({ ...charge, method: 'qris' }, ctx(sec, { mode: 'live' }, s.f))).deeplink, 'https://img', 'no qr_string: image link');
  assert.equal(s.calls[0].url, 'https://api.midtrans.com/v2/charge');

  s = stub([200, { status_code: '201', transaction_id: 'trx2', va_numbers: [{ bank: 'bca', va_number: '12345678901' }] }]);
  assert.equal((await midtrans.createCharge({ ...charge, method: 'va' }, ctx(sec, {}, s.f))).vaNumber, '12345678901');
  assert.deepEqual(s.calls[0].body.bank_transfer, { bank: 'bca' });
  s = stub([200, { status_code: '201', transaction_id: 'trx3', permata_va_number: '8562000' }]);
  assert.equal((await midtrans.createCharge({ ...charge, method: 'va' }, ctx(sec, { vaBank: 'permata' }, s.f))).vaNumber, '8562000');

  s = stub([200, { status_code: '201', transaction_id: 'trx4', actions: [{ name: 'generate-qr-code', url: 'https://qr' }, { name: 'deeplink-redirect', url: 'gojek://pay' }] }]);
  const g = await midtrans.createCharge({ ...charge, method: 'ewallet' }, ctx(sec, { redirectUrl: 'https://order.bornis.id/kopibiru' }, s.f));
  assert.deepEqual(g, { providerRef: 'trx4', deeplink: 'gojek://pay', expiresAt: charge.expiresAt });
  assert.equal(s.calls[0].body.payment_type, 'gopay');
  assert.deepEqual(s.calls[0].body.gopay, { enable_callback: true, callback_url: 'https://order.bornis.id/kopibiru' });
  s = stub([200, { status_code: '201', transaction_id: 'trx5', actions: [{ name: 'deeplink-redirect', url: 'shopeeid://pay' }] }]);
  await midtrans.createCharge({ ...charge, method: 'ewallet' }, ctx(sec, { ewallet: 'shopeepay' }, s.f));
  assert.equal(s.calls[0].body.payment_type, 'shopeepay');

  await assert.rejects(midtrans.createCharge({ ...charge, amount: 1.5, method: 'qris' }, ctx(sec, {}, s.f)), /whole number of rupiah/);
  s = stub([200, { status_code: '406', status_message: 'The request could not be completed due to a conflict with the current state of the target resource' }]);
  await assert.rejects(midtrans.createCharge({ ...charge, method: 'qris' }, ctx(sec, {}, s.f)), (err: Error) => /^Midtrans 406: The request could not/.test(err.message) && !err.message.includes('Mid-server'));
  s = stub([400, { status_code: '400', validation_messages: ['transaction_details.gross_amount is not equal to the sum of item_details'] }]);
  await assert.rejects(midtrans.createCharge({ ...charge, method: 'qris' }, ctx(sec, {}, s.f)), /Midtrans 400: transaction_details/);
});

test('Midtrans notification: signature_key = SHA-512(order_id + status_code + gross_amount + server key); statuses mapped', () => {
  const key = 'SB-Mid-server-x', c = ctx({ serverKey: key });
  const note = (transaction_status: string, extra: Record<string, string> = {}, k = key) => {
    const b = { order_id: 'pay123', status_code: '200', gross_amount: '45000.00', transaction_id: 'trx1', transaction_status, ...extra };
    return JSON.stringify({ ...b, signature_key: sha(b.order_id + b.status_code + b.gross_amount + k, 'sha512') });
  };
  assert.deepEqual(midtrans.parseWebhook(hdr({}), note('settlement'), c), { paymentId: 'pay123', status: 'settled', providerRef: 'trx1', amount: 45_000 });
  assert.equal(midtrans.parseWebhook(hdr({}), note('capture', { fraud_status: 'accept' }), c)?.status, 'settled');
  assert.equal(midtrans.parseWebhook(hdr({}), note('capture', { fraud_status: 'challenge' }), c)?.status, 'pending');
  for (const t of ['deny', 'cancel', 'failure']) assert.equal(midtrans.parseWebhook(hdr({}), note(t), c)?.status, 'failed', t);
  assert.equal(midtrans.parseWebhook(hdr({}), note('expire'), c)?.status, 'expired');
  assert.equal(midtrans.parseWebhook(hdr({}), note('pending'), c)?.status, 'pending');
  assert.equal(midtrans.parseWebhook(hdr({}), note('settlement', {}, 'other-key'), c), null, 'signed with another key');
  assert.equal(midtrans.parseWebhook(hdr({}), note('settlement').replace('45000.00', '4500.00'), c), null, 'amount tampered');
  assert.equal(midtrans.parseWebhook(hdr({}), note('settlement'), ctx()), null, 'no server key = nothing settles');
});

test('Midtrans refund and test() (unknown order 404 = key accepted, 401 = rejected)', async () => {
  const sec = { serverKey: 'Mid-server-x' };
  let s = stub([200, { status_code: '200', refund_key: 'pay123-rk', refund_amount: 20_000, transaction_status: 'partial_refund' }]);
  assert.deepEqual(await midtrans.refund({ paymentId: 'pay123', providerRef: 'trx1', amount: 20_000, reason: 'Wrong order' }, ctx(sec, { mode: 'live' }, s.f)), { refundRef: 'pay123-rk', status: 'refunded' });
  assert.equal(s.calls[0].url, 'https://api.midtrans.com/v2/pay123/refund');
  assert.equal(s.calls[0].body.amount, 20_000);
  assert.equal(s.calls[0].body.reason, 'Wrong order');
  assert.match(s.calls[0].body.refund_key, /^pay123-r/);
  await assert.rejects(midtrans.refund({ paymentId: 'pay123', providerRef: 'trx1', amount: 20_000, reason: '' }, ctx(sec, {}, stub([200, { status_code: '412', status_message: 'Merchant cannot modify the status of the transaction' }]).f)), /Midtrans 412: Merchant cannot modify/);

  s = stub([404, { status_code: '404', status_message: "Transaction doesn't exist." }]);
  assert.deepEqual(await midtrans.test(ctx(sec, { mode: 'sandbox' }, s.f)), { ok: true, message: 'Midtrans sandbox server key accepted.' });
  assert.match(s.calls[0].url, /^https:\/\/api\.sandbox\.midtrans\.com\/v2\/borniz-test-[a-z0-9]+\/status$/);
  assert.equal(s.calls[0].method, 'GET');
  const bad = await midtrans.test(ctx(sec, { mode: 'live' }, stub([401, { status_code: '401', status_message: 'Unknown Merchant server_key/id' }]).f));
  assert.equal(bad.ok, false);
  assert.match(bad.message, /rejected the server key/);
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
  const o = { externalId: 'GF-889', merchantId: 'M-SEN', tier: 'rush' as const, items: [{ sku: 'p2', name: 'Es Kopi Susu', qty: 2, price: 28_000, modifiers: [{ name: 'Less sugar', price: 0 }] }, { id: 'p5', name: 'Croissant', qty: 1, price: 30_000 }], discount: 5_000, customer: { name: 'Raka', phone: '0812' }, placedAt: 1_760_000_000_000 };
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
  assert.equal(n.readyBy, 1_760_000_000_000 + 14 * 60e3);
  assert.equal(normalizeOrder('gofood', { ...got!, status: 'cancelled' }, 'sen').status, 'voided');
});

test('delivery relay: the SKU reaches the server, platform ids never collide, a broken payload is refused', () => {
  const base = { externalId: 'A-123', merchantId: 'M-SEN', items: [{ id: 'gf-item-889', sku: 'LATTE-ICE', name: 'Latte', qty: 1, price: 30_000 }], placedAt: 1_760_000_000_000 };
  assert.equal(normalizeOrder('grabfood', base, 'sen').lines[0].sku, 'LATTE-ICE', 'bn_platform_order maps lines by SKU');
  assert.notEqual(normalizeOrder('grabfood', { ...base, externalId: 'A-1.23' }, 'sen').id, normalizeOrder('grabfood', base, 'sen').id);
  assert.throws(() => normalizeOrder('gofood', { ...base, items: [{ name: 'Latte', qty: 1, price: undefined as unknown as number }] }, 'sen'), /price/);
  assert.throws(() => normalizeOrder('gofood', { ...base, items: [{ name: 'Latte', qty: 1, price: -5 }] }, 'sen'), /price/);
  assert.equal(normalizeOrder('gofood', { ...base, placedAt: 1_760_000_000 }, 'sen').createdAt, 1_760_000_000_000, 'seconds read as seconds');
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

test('webhook endpoints: IPv6 / mapped literals and names resolving to private addresses are refused', async () => {
  const { resolvesPublic } = await import('../integrations/server/webhooks/deliver.ts');
  for (const u of ['https://[::ffff:127.0.0.1]/', 'https://[::]/', 'https://[::ffff:a9fe:a9fe]/', 'https://[fd00::1]/']) assert.ok(!publicEndpoint(u), u);
  const at = (ip: string) => async () => [{ address: ip, family: ip.includes(':') ? 6 : 4 }];
  assert.equal(await resolvesPublic('https://localtest.me/x', at('127.0.0.1')), false);
  assert.equal(await resolvesPublic('https://meta.example/x', at('169.254.169.254')), false);
  assert.equal(await resolvesPublic('https://hooks.example/x', at('93.184.216.34')), true);
});
