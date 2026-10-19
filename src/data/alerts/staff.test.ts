import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seed } from '../seed.ts';
import type { DB, Notice } from '../schema.ts';
import { STAFF_WA, STAFF_WA_KEY, staffWhatsApp } from './staff.ts';

const at = Date.now(), id = (n: string, e: string) => n + '|' + e;
function shop(on = true): DB {
  const d = seed();
  d.settings[STAFF_WA_KEY] = on;
  d.integrations = [...d.integrations.filter(i => i.kind !== 'whatsapp'), { id: 'wa1', connector: 'waba', kind: 'whatsapp', outletId: null, deviceId: null, name: 'WhatsApp', enabled: true, config: {}, secrets: [], status: 'ok', lastOk: null, lastError: null, updatedBy: 'budi', updatedAt: 0 }];
  return d;
}
const refund = (d: DB, outletId: string | null, ago = 60e3): Notice => {
  const n: Notice = { id: 'n1', alert: 'Refund over IDR 500k', level: 'high', to: ['owner', 'manager'], outletId, text: 'Refund IDR 750,000 · #3822', href: null, at: at - ago, read: false };
  d.notices.unshift(n); return n;
};

test('the alerts the catalog sends to staff on WhatsApp, to the roles it names', () => {
  assert.deepEqual(STAFF_WA.get('Refund over IDR 500k'), ['owner', 'manager']);
  assert.deepEqual(STAFF_WA.get('Opname waiting to sign'), ['owner'], '"push (owner: WA)": the owner only');
  assert.deepEqual(STAFF_WA.get('Late / no-show'), ['manager']);
  assert.equal(STAFF_WA.has('Order ready'), false, 'that WhatsApp is the guest’s');
  assert.equal(STAFF_WA.has('Low stock'), false, 'a daily digest is not one message per alert');
});

test('a refund over 500k reaches the owner and the outlet’s manager on WhatsApp, once', () => {
  const d = shop(); refund(d, 'sen');
  const m = staffWhatsApp(d, at, id);
  const who = m.map(x => d.employees.find(e => e.phone === x.to)!);
  assert.ok(who.length >= 2 && who.every(e => e.role === 'owner' || (e.role === 'manager' && e.outlets.includes('sen'))), who.map(e => e.id).join());
  assert.ok(m.every(x => x.template === 'staff_alert' && x.vars?.alert === 'Refund over IDR 500k' && x.vars?.text.includes('750,000') && x.vars?.outlet === 'Senayan'));
  d.messages.unshift(...m);
  assert.deepEqual(staffWhatsApp(d, at, id), [], 'already queued for those people');
});

test('nothing goes out unless the owner turned it on, a WhatsApp number is connected, the alert is on and new', () => {
  let d = shop(false); refund(d, 'sen'); assert.deepEqual(staffWhatsApp(d, at, id), []);
  d = shop(); d.integrations = d.integrations.filter(i => i.kind !== 'whatsapp'); refund(d, 'sen'); assert.deepEqual(staffWhatsApp(d, at, id), []);
  d = shop(); d.settings['/owner/settings/settings-notifications:al-Refund over IDR 500k'] = false; refund(d, 'sen'); assert.deepEqual(staffWhatsApp(d, at, id), []);
  d = shop(); refund(d, 'sen', 2 * 3600e3); assert.deepEqual(staffWhatsApp(d, at, id), [], 'turning it on never sends old alerts');
  d = shop(); for (const e of d.employees) e.phone = ''; refund(d, 'sen'); assert.deepEqual(staffWhatsApp(d, at, id), [], 'no phone, no message');
});
