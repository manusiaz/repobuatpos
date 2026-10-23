// Automations run from their published settings (Studios › Messaging & automation), not from fixed code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seed } from '../seed.ts';
import { automationMessages } from './automations.ts';
import type { DB } from '../schema.ts';

const H = 36e5, D = 864e5, T0 = Date.UTC(2026, 9, 20, 5);
function shop(plan: DB['tenant']['plan'], publish: Record<string, Record<string, unknown>> = {}) {
  const db = seed() as DB;
  db.tenant.plan = plan;
  db.customers = [{ id: 'c1', name: 'Dewi', phone: '0812', email: 'dewi@x.id', joinedAt: 0, optIn: true, credit: 0, deposit: 0 },
    { id: 'c2', name: 'Raka', phone: '0813', email: '', joinedAt: 0, optIn: false, credit: 0, deposit: 0 }];
  db.orders = [{ ...db.orders[0], id: 'o1', customerId: 'c1', status: 'paid', paidAt: T0 }, { ...db.orders[0], id: 'o2', customerId: 'c2', status: 'paid', paidAt: T0 }];
  db.messages = [{ id: 'r1', channel: 'wa', template: 'e_receipt', to: '0812', status: 'sent', at: T0, customerId: 'c1', orderId: 'o1' }];
  db.reviews = []; db.ledger = [];
  db.versions = Object.entries(publish).map(([tool, values]) => ({ id: 'v' + tool, kind: 'page', status: 'published', data: { tool, values } })) as DB['versions'];
  return db;
}
const send = (db: DB, at: number) => automationMessages(db, at, k => k).map(m => `${m.template}>${m.customerId}@${m.channel}`);

test('thank-you: the default runs an hour after payment, to opted-in guests, the receipt does not count against the daily cap', () => {
  assert.deepEqual(send(shop('free'), T0 + H + 60e3), ['thanks_visit>c1@wa']);
  assert.deepEqual(send(shop('free'), T0 + 30 * 60e3), []);
});
test('Pro: the published wait, channel and switch are what runs; below Pro the changes wait for the upgrade', () => {
  const later = { a_thanks: { on: true, delay: 3, cond: 'all', ch: 'email', tpl: 'thanks_visit', cap: true } };
  assert.deepEqual(send(shop('pro', later), T0 + H + 60e3), []);
  assert.deepEqual(send(shop('pro', later), T0 + 3 * H + 60e3), ['thanks_visit>c1@email']);
  assert.deepEqual(send(shop('basic', later), T0 + H + 60e3), ['thanks_visit>c1@wa']);
  assert.deepEqual(send(shop('pro', { a_thanks: { on: false } }), T0 + H + 60e3), []);
});
test('win-back and birthday send once, on their day, when switched on', () => {
  const db = shop('pro', { a_winback: { on: true, days: 30, cond: 'all', ch: 'wa', tpl: 'winback_30d', cap: true } });
  db.customers[0].birthday = '1990-10-27';
  assert.deepEqual(send(db, T0 + 30 * D + H), ['winback_30d>c1@wa']);
  assert.deepEqual(send(db, T0 + 32 * D), []);
  assert.deepEqual(send(db, T0 + 60e3).filter(s => s.startsWith('birthday')), ['birthday>c1@wa'], '7 days before the birthday (default)');
});
test('a birthday early in January is sent in late December', () => {
  const db = shop('pro'); db.customers[0].birthday = '1990-01-03';
  assert.deepEqual(send(db, Date.UTC(2026, 11, 27, 5)).filter(s => s.startsWith('birthday')), ['birthday>c1@wa']);
});
