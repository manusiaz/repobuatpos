// The outbox runner in demo mode: queued → sent → delivered on the simulator; retries, backoff and failure on a broken sender.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commit, snapshot } from './store.ts';
import { setMessageStatus, tick, webhookEvents, withLock, type Outgoing, type Transport } from './actions/dispatch.ts';
import { saveIntegration } from './actions/integrations.ts';
import { addLine, newOrder, startPayment } from './actions.ts';
import type { Message } from './schema.ts';

const queue = (id: string, at = Date.now(), channel: Message['channel'] = 'wa') =>
  commit('message.queued', 'test', d => { d.messages.unshift({ id, channel, template: 'e_receipt', to: '0812 1111 2222', status: 'queued', at, customerId: null }); });
const status = (id: string) => snapshot().messages.find(m => m.id === id)!.status;

test('demo mode: a queued message moves queued → sent → delivered, a future one waits', async () => {
  const now = Date.now();
  queue('mt1', now); queue('mt2', now + 3600e3); queue('mt3', now, 'push');
  await withLock(() => tick({ now }));
  assert.equal(status('mt1'), 'sent');
  assert.equal(status('mt2'), 'queued', 'scheduled for later');
  assert.equal(status('mt3'), 'queued', 'push is not an outbox channel');
  await tick({ now: now + 500 });
  assert.equal(status('mt1'), 'sent', 'delivery receipt not yet');
  await tick({ now: now + 2000 });
  assert.equal(status('mt1'), 'delivered');
  setMessageStatus('mt1', 'sent');
  assert.equal(status('mt1'), 'delivered', 'status never moves back');
});

test('a failing sender retries with backoff, then marks the message failed; a permanent error fails at once', async () => {
  const sent: Outgoing[] = [];
  const broken: Transport = { message: async x => { sent.push(x); return { ok: false, message: 'HTTP 503' }; } };
  const now = Date.now();
  queue('mt4', now);
  await tick({ now, transport: broken });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].messageId, 'mt4', 'message id is the idempotency key');
  assert.equal(sent[0].tenantId, snapshot().tenant.id);
  await tick({ now: now + 1000, transport: broken });
  assert.equal(sent.length, 1, 'backing off');
  let t = now;
  for (let i = 0; i < 10 && status('mt4') === 'queued'; i++) { t += 11 * 60e3; await tick({ now: t, transport: broken }); }
  assert.equal(status('mt4'), 'failed');
  assert.equal(sent.length, 6);

  queue('mt5', now);
  await tick({ now, transport: { message: async () => ({ ok: false, permanent: true, message: 'HTTP 501' }) } });
  assert.equal(status('mt5'), 'failed');
});

test('outgoing webhook events are derived from data with stable ids and delivered once per connection', async () => {
  const o = newOrder('sen', 'rina');
  addLine(o, 'p2', [], 1, '', 'rina');
  startPayment(o, 'cash', snapshot().orders.find(x => x.id === o)!.total, 'rina');
  const now = Date.now() + 10;
  const id = saveIntegration({ connector: 'webhook-out', outletId: null, deviceId: null, name: 'ERP', enabled: true, config: { url: 'https://example.com/h', 'ev:order.paid': true } }, ['secret'], 'budi');
  commit('test.backdate', 'test', d => { d.integrations.find(i => i.id === id)!.updatedAt = now - 3600e3; });
  const evs = webhookEvents(snapshot(), now - 3600e3);
  assert.ok(evs.every((e, i) => i === 0 || evs[i - 1].at <= e.at), 'oldest first');
  assert.equal(new Set(evs.map(e => e.id)).size, evs.length, 'unique ids');
  const paid = evs.filter(e => e.event === 'order.paid');
  assert.ok(paid.some(e => e.id === 'order.paid:' + o), 'the order just paid');
  const got: string[] = [];
  const transport: Transport = { message: async () => ({ ok: true }), webhook: async (iid, e) => { assert.equal(iid, id); got.push(e.id); return { ok: true }; } };
  await tick({ now, transport });
  assert.deepEqual(got, paid.map(e => e.id), 'only the subscribed event');
  await tick({ now: now + 5000, transport });
  assert.equal(got.length, paid.length, 'not delivered twice');
});
