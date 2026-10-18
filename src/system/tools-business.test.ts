// Customization Studio tools reach the live app only through their published values (src/system/tools.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seed } from '../data/seed.ts';
import type { DB } from '../data/schema.ts';
import { twoKey } from '../domain/approval.ts';
import { config, publicUrl } from './hosts.ts';
import {
  abTheme, abVariant, approvalRule, bucket, guestMoney, guestStamp, hookWants, industryHides, legal, moduleLabel, moneyFormat, priceRules,
  receiptFor, roleTheme, shownPrice, studioHook, term, toolValue, variantOf, whiteLabel, widgetsFor,
} from './tools.ts';

let n = 0;
const pub = (db: DB, tool: string, values: Record<string, unknown>, status: 'published' | 'pending_owner' = 'published', at = Date.now()) =>
  db.versions.unshift({ id: 'v' + n++, kind: 'page', by: 'budi', at, status, data: { tool, values }, note: '' });

test('toolValue: only published versions count, newest first, and only while the plan includes the tool', () => {
  const db = seed();
  assert.deepEqual(toolValue(db, 'prices'), {}, 'never published: nothing changes');
  pub(db, 'prices', { step: 500 }, 'pending_owner');
  assert.deepEqual(toolValue(db, 'prices'), {}, 'waiting for the owner is not live');
  pub(db, 'prices', { step: 100 }); pub(db, 'prices', { step: 1000 });
  assert.equal(toolValue(db, 'prices').step, 1000);
  pub(db, 'white', { name: 'Kopi Biru App' });
  assert.equal(whiteLabel(db), null, 'white-label is Enterprise; Kopi Biru is on Pro');
  db.tenant.plan = 'enterprise';
  assert.equal(whiteLabel(db)?.name, 'Kopi Biru App');
});

test('price display rules: tax-inclusive display, rounding direction, strike-through; the bill is untouched', () => {
  const out = { taxInclusive: false, taxBps: 1000, serviceBps: 500 };
  assert.equal(shownPrice(25000, out, { tax: 'incl', step: 1 }), 28875);
  assert.equal(shownPrice(25000, out, { tax: 'incl', step: 500, mode: 'nearest' }), 29000);
  assert.equal(shownPrice(25000, out, { tax: 'incl', step: 1000, mode: 'down' }), 28000);
  assert.equal(shownPrice(28001, out, { step: 1000, mode: 'up' }), 29000);
  assert.equal(shownPrice(28000, out, { step: 1000, mode: 'up' }), 28000, 'already on the step');
  assert.equal(shownPrice(25000, { ...out, taxInclusive: true }, { tax: 'incl' }), 25000, 'outlet prices already include tax');
  const db = seed();
  assert.equal(priceRules(db, 'sen').price(25000), 25000);
  pub(db, 'prices', { tax: 'incl', step: 500, mode: 'nearest', strike: false });
  const r = priceRules(db, 'sen');
  assert.equal(r.price(25000), 29000); assert.equal(r.strike, false); assert.equal(r.inclTax, true);
});

test('number format: guest surfaces use the outlet format over the brand price rules; staff keep Language & currency', () => {
  const db = seed();
  assert.deepEqual(moneyFormat(db, 'selforder', 'sen'), ['idr', undefined, false]);
  pub(db, 'prices', { sym: 'rp', sep: 'dot', short: false });
  pub(db, 'numfmt', { outlet: 'kem', sym: 'idr', sep: 'comma', short: true, date: 'iso', clock: '12', tz: false });
  assert.deepEqual(guestMoney(db, 'sen'), ['rp', 'dot', false], 'Senayan follows the price rules');
  assert.deepEqual(guestMoney(db, 'kem'), ['idr', 'comma', true], 'Kemang has its own format');
  assert.deepEqual(moneyFormat(db, 'owner', 'kem'), ['idr', undefined, false], 'dashboards keep the owner setting');
  const t = new Date(2026, 9, 10, 14, 5).getTime();
  assert.equal(guestStamp(db, 'kem', t), '2026-10-10 2:05 PM');
  assert.equal(guestStamp(db, 'sen', t), null, 'no format for Senayan: the receipt keeps its stamp');
});

test('A/B test: stable bucket per guest, only while the published test runs and a draft theme exists', () => {
  assert.equal(bucket('guest-1'), bucket('guest-1'));
  const db = seed(), now = Date.now();
  pub(db, 'ab', { split: 50, dur: '14', start: now - 3600e3 });
  assert.equal(abVariant(db, 'g1', now), null, 'no draft theme to test');
  db.versions.unshift({ id: 'draft', kind: 'menu', by: 'budi', at: now, status: 'draft', data: { p: '#123456', name: 'Draft' }, note: '' });
  const ids = Array.from({ length: 200 }, (_, i) => 'guest' + i), vs = ids.map(id => abVariant(db, id, now));
  assert.ok(vs.includes('A') && vs.includes('B'), 'both versions served');
  assert.deepEqual(ids.map(id => abVariant(db, id, now)), vs, 'deterministic');
  assert.equal(abTheme(db, db.theme, 'B').p, '#123456'); assert.equal(abTheme(db, db.theme, 'A').p, db.theme.p);
  assert.equal(abVariant(db, 'g1', now + 15 * 864e5), null, 'test over after its duration');
  assert.equal(variantOf({ id: 'x', ab: 'B' }, 0), 'B', 'an order counts for the version its guest saw');
  db.tenant.plan = 'basic';
  assert.equal(abVariant(db, 'g1', now), null, 'A/B is Pro');
});

test('webhooks: the studio endpoint gets only its toggled events; other connections keep their own', () => {
  const db = seed(); db.tenant.plan = 'enterprise';
  assert.equal(studioHook(db), null);
  pub(db, 'hooks', { url: 'https://hooks.kopibiru.id/bornis', 'theme.published': true, 'menu.updated': false, 'price.changed': true, 'order.paid': false, secret: 'whsec_x' });
  const h = studioHook(db)!;
  assert.deepEqual(h.events, ['theme.published', 'price.changed']);
  assert.equal(hookWants(h, h.url, 'order.paid', () => true), false);
  assert.equal(hookWants(h, h.url, 'price.changed', () => false), true);
  assert.equal(hookWants(h, 'https://erp.example.com', 'order.paid', () => true), true, 'another endpoint: its own subscription');
  pub(db, 'hooks', { url: 'http://insecure.example.com', 'order.paid': true });
  assert.equal(studioHook(db), null, 'https only');
});

test('change approvals "owner + one admin": two people, one the owner, never the requester', () => {
  const owner = { id: 'budi', level: 'owner' as const }, mgr = { id: 'andi', level: 'manager' as const }, pic = { id: 'maya', level: 'pic' as const };
  assert.equal(twoKey([], owner, 'maya'), 'cosign');
  assert.equal(twoKey([owner], mgr, 'maya'), 'approve');
  assert.equal(twoKey([], mgr, 'maya'), 'cosign');
  assert.equal(twoKey([mgr], owner, 'maya'), 'approve');
  assert.equal(twoKey([mgr], { id: 'dimas', level: 'manager' }, 'maya'), 'cosign', 'two managers are not enough');
  assert.match(twoKey([owner], owner, 'maya'), /already signed/);
  assert.match(twoKey([], mgr, 'andi'), /own request/);
  assert.match(twoKey([owner], pic, 'andi'), /owner/);
  const db = seed();
  assert.equal(approvalRule(db), 'owner');
  pub(db, 'approve', { rule: 'two', notify: true });
  assert.equal(approvalRule(db), 'two');
});

test('theme per role, widgets, terminology, industry, legal, receipts, custom domain', () => {
  const db = seed();
  assert.equal(roleTheme(db, 'cashier'), null);
  assert.equal(widgetsFor(db, 'owner'), null);
  assert.equal(term(db, 'table'), 'Table'); assert.equal(moduleLabel(db, 'Outlets'), 'Outlets');
  pub(db, 'roleth', { 'accent:cashier': 'blue', 'density:cashier': 'touch', 'dark:kitchen': true });
  assert.deepEqual(roleTheme(db, 'cashier'), { style: { '--role': 'var(--info)', '--role-soft': 'var(--info-soft)', '--role-fg': 'var(--info-fg)', '--hit': '56px' }, dark: false });
  assert.equal(roleTheme(db, 'kitchen')?.dark, true);
  pub(db, 'widgets', { role: 'owner', cols: 2, 'on:owner': ['w_top', 'w_rev'] });
  assert.deepEqual(widgetsFor(db, 'owner'), { on: ['w_top', 'w_rev'], cols: 2 });
  assert.ok(widgetsFor(db, 'manager')!.on.includes('w_staff'), 'untouched role: the studio default');
  pub(db, 'industry', { pick: 'salon' });
  assert.equal(term(db, 'table'), 'Kursi'); assert.ok(industryHides(db, 'kds') && !industryHides(db, 'pos'));
  pub(db, 'terms', { outlet: 'Cabang', table: 'Meja', customer: 'Pelanggan' });
  assert.equal(term(db, 'table'), 'Meja'); assert.equal(moduleLabel(db, 'Outlets'), 'Cabang'); assert.equal(term(db, 'shift'), 'Shift');
  assert.equal(legal(db), null);
  pub(db, 'legal', { co: 'PT Kopi Biru Nusantara', b_refund: 'Refund in 1×24h' });
  assert.equal(legal(db)?.refund, 'Refund in 1×24h');
  pub(db, 'rcpt', { outlet: 'kem', paper: '58', inherit: false, h1: 'Kopi Biru Kemang', h2: '', f1: 'Sampai jumpa!', wifi: 'KB-KEM' });
  assert.equal(receiptFor(db, 'sen'), null, 'made for Kemang only');
  assert.deepEqual(receiptFor(db, 'kem'), { paper: '58', h1: 'Kopi Biru Kemang', h2: '', wifi: 'KB-KEM', f1: 'Sampai jumpa!' });
  const sub = config({ NEXT_PUBLIC_BORNIZ_ROUTING: 'subdomain', NEXT_PUBLIC_BORNIZ_ROOT_DOMAIN: 'bornis.id' });
  assert.equal(publicUrl('/order?t=07&o=sen', sub, 'kopibiru', '', 'order.kopibiru.id'), 'https://order.kopibiru.id/t/07?o=sen');
  assert.equal(publicUrl('/order/customer-links/digital-receipt?o=1', config({}), 'kopibiru', 'http://localhost:3000', 'order.kopibiru.id'), 'https://order.kopibiru.id/order/customer-links/digital-receipt?o=1');
  assert.equal(publicUrl('/owner', sub, 'kopibiru', '', 'order.kopibiru.id'), 'https://kopibiru.bornis.id/owner', 'staff links go to the business subdomain, never the guest domain');
});
