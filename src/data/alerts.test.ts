// Alert catalog: every alert has a rule or a service that raises it; one rule per group fires once, dedupes, obeys its toggle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import alertsCatalog from '../system/alerts.json' with { type: 'json' };
import { pageAt } from '../system/registry.ts';
import { seed } from './seed.ts';
import { snapshot } from './store.ts';
import type { DB } from './schema.ts';
import { CATALOG, RULES, SERVICE, applyAlerts, planAlerts, settingKey, sweepAlerts } from './alerts/index.ts';

const AT = new Date(2026, 9, 11, 15, 12).getTime(), MIN = 60e3, HOUR = 3600e3, DAY = 864e5;
const groups = alertsCatalog.groups as [string, string, [string][]][];
const names = [...new Set(groups.flatMap(g => g[2].map(a => a[0])))];

test('every catalog alert has exactly one rule or one service reference', () => {
  const ruled = RULES.map(r => r.alert);
  assert.equal(new Set(ruled).size, ruled.length, 'one rule per alert');
  for (const n of [...ruled, ...Object.keys(SERVICE)]) assert.ok(CATALOG.has(n), `${n} is a catalog alert`);
  const missing = names.filter(n => !ruled.includes(n) && !SERVICE[n]), both = names.filter(n => ruled.includes(n) && SERVICE[n]);
  assert.deepEqual(missing, [], 'alerts with neither a rule nor a service');
  assert.deepEqual(both, [], 'alerts with both');
  assert.equal(ruled.length + Object.keys(SERVICE).length, names.length);
});
test('service references point at real functions, rule links at real pages', () => {
  for (const [alert, ref] of Object.entries(SERVICE)) {
    const [file, fn] = ref.split(':');
    assert.match(fs.readFileSync(new URL('../../' + file, import.meta.url), 'utf8'), new RegExp(`function ${fn}\\b`), `${alert} → ${ref}`);
  }
  for (const r of RULES) assert.ok(pageAt(r.href), `${r.alert} → ${r.href}`);
});
test('every rule runs on the demo tenant at any hour without throwing, fast', () => {
  for (const h of [3, 10.5, 15.2, 22.6]) {
    const at = new Date(2026, 9, 11).getTime() + h * HOUR, db = seed(at), t = performance.now();
    planAlerts(db, at);
    assert.ok(performance.now() - t < 1500, 'sweep stays cheap');
  }
});

type Case = [alert: string, mutate: (d: DB) => void, at?: number];
const rec = (d: DB, k: string, r: Partial<DB['records'][string][0]>) => (d.records[k] ??= []).push({ id: k + (d.records[k].length + 1), a: '', b: '', c: '', d: '', e: '', at: AT, ...r });
const CASES: Case[] = [
  ['PO overdue', () => {}],
  ['Target reached', d => { d.settings['/owner/outlets/targets-and-kpis:daily-target-sen'] = 1000; }],
  ['Payroll ready', () => {}, new Date(2026, 10, 2, 10).getTime()],
  ['Drawer too full', d => { d.payments.push({ id: 'pz', orderId: 'h1001', outletId: 'sen', method: 'cash', amount: 3_000_000, tip: 0, status: 'settled', ref: 'x', at: AT, expiresAt: null, sessionId: 'S-1042' }); }],
  ['Delivery order waiting', d => { d.orders.push({ ...d.orders[0], id: 'og', no: '#9001', source: 'gofood', status: 'open', createdAt: AT - 150e3, paidAt: null }); }],
  ['Bad review', () => {}],
  ['Voucher quota almost used', d => { d.promos[0].used = 460; }],
  ['Printer problem', () => {}],
  ['Permissions changed', d => { d.audit.unshift({ id: 'au1', actor: 'budi', action: 'perms.changed', subject: 'refund.approve', at: AT - MIN }); }],
  ['Reservation in 30 min', d => { d.reservations[0].at = AT + 20 * MIN; }],
  ['Past ready-by', d => { d.orders.push({ ...d.orders[0], id: 'or', no: '#9002', source: 'grabfood', status: 'preparing', readyBy: AT - 10 * MIN, tier: 'standard', paidAt: null }); }],
  ['PB1 / PPN due', () => {}],
  ['Shift starts soon', () => {}, new Date(2026, 9, 11, 13, 30).getTime()],
  ['Kiosk offline / frozen', d => { Object.assign(d.devices.find(x => x.kind === 'kiosk')!, { status: 'offline', lastSeen: AT - 5 * MIN }); }],
  ['Price differs from HQ', d => { d.outletProducts.find(x => x.outletId === 'kem' && x.productId === 'p2')!.localPrice = 30000; }],
  ['Equipment service due', d => rec(d, 'maintenance', { a: 'La Marzocco', b: 'Senayan', c: 'Scheduled', d: '2026-10-10' })],
  ['Exchange over policy', d => { const o = d.orders.find(x => x.paidAt! < AT - 15 * DAY && x.outletId === 'sen') ?? d.orders[0]; o.paidAt = AT - 20 * DAY; d.refunds.push({ id: 'rf1', orderId: o.id, paymentId: '', amount: 10000, reason: 'size', approvalId: null, at: AT - MIN, toStock: false }); }],
  ['Export ready', d => { d.audit.unshift({ id: 'au2', actor: 'budi', action: 'audit.exported', subject: 'audit log', at: AT - MIN }); }],
  ['Register went offline', d => { d.device.online = false; d.audit.unshift({ id: 'au3', actor: 'device', action: 'device.offline', subject: '', at: AT - 2 * MIN }); }],
  ['WA template rejected', d => rec(d, 'msg_template', { id: 'tpl_x', a: 'Promo', e: 'rejected' })],
  ['Complaint keywords', d => rec(d, 'inbox', { a: '0812 1111 2222', b: 'Senayan', c: 'Kopinya basi', d: 'new', at: AT - MIN })],
  ['Fridge / freezer temperature', d => { rec(d, 'temperature', { a: 'Chiller 1', b: 'sen', c: 'fridge', d: '9', at: AT - 12 * MIN }); rec(d, 'temperature', { a: 'Chiller 1', b: 'sen', c: 'fridge', d: '8', at: AT - MIN }); }],
  ['Missing clock-out', d => { d.clock.push({ id: 'ck1', employeeId: 'rina', outletId: 'sen', kind: 'in', at: AT - 30 * HOUR }); }],
  ['Goods received short', () => {}],
  ['Big event booking', d => { d.reservations[0].guests = 30; d.reservations[0].at = AT + 2 * DAY; }],
  ['Deposit not paid', d => rec(d, 'booking', { a: 'Dewi 0812 3456 7890', b: 'Senayan', c: 'Deposit pending', d: String(AT + HOUR), e: 'Maya' })],
  ['Kasbon due', () => {}],
  ['Incident reported', d => { d.audit.unshift({ id: 'au4', actor: 'maya', action: 'incident.logged', subject: 'injury', at: AT - MIN, outletId: 'sen' }); }],
  ['Refund done', d => { const o = d.orders.find(x => x.customerId)!; d.refunds.push({ id: 'rf2', orderId: o.id, paymentId: '', amount: 25000, reason: 'cold', approvalId: null, at: AT - MIN, toStock: false }); }],
];
const only = (alert: string) => RULES.filter(r => r.alert === alert);

for (const [alert, mutate, at = AT] of CASES) test(`${CATALOG.get(alert)?.group.toLowerCase()}: “${alert}” fires once, dedupes, obeys its toggle`, () => {
  const db = seed(at); mutate(db);
  const plan = planAlerts(db, at, only(alert));
  assert.ok(plan.length >= 1, 'fires');
  for (const p of plan) {
    assert.ok(p.id.startsWith('al_'));
    if (p.notice) { assert.deepEqual(p.notice.to, CATALOG.get(alert)!.to); assert.ok(pageAt(p.notice.href!), p.notice.href!); assert.ok(p.notice.text.length > 3); }
  }
  assert.equal(new Set(plan.map(p => p.id)).size, plan.length);
  assert.equal(planAlerts(structuredClone(db), at, only(alert)).map(p => p.id).join(), plan.map(p => p.id).join(), 'ids are deterministic across devices');
  assert.equal(applyAlerts(db, plan, at), plan.length);
  assert.equal(applyAlerts(db, plan, at), 0, 'a second device applying the same plan adds nothing');
  assert.equal(planAlerts(db, at, only(alert)).length, 0, 'second sweep dedupes');
  assert.equal(planAlerts(db, at + 60e3, only(alert)).length, 0, 'next minute too');
  const off = seed(at); mutate(off); off.settings[settingKey(alert)] = false;
  assert.equal(planAlerts(off, at, only(alert)).length, 0, 'toggle off in Settings · notifications');
});

test('guest messages go to the guest phone, never as staff notices, and skip what the service already queued', () => {
  const db = seed(AT); db.reservations[0].at = AT + 2 * HOUR;
  const [p] = planAlerts(db, AT, only('Reservation reminder'));
  assert.equal(p.notice, null);
  assert.deepEqual({ ch: p.message?.channel, tpl: p.message?.template, to: p.message?.to, c: p.message?.customerId }, { ch: 'wa', tpl: 'reservation_reminder', to: '0813 5656 7878', c: 'c7' });
  const o = { ...db.orders[0], id: 'oq', no: 'QR-1', source: 'qr' as const, status: 'ready' as const, customerId: 'c1', createdAt: AT - 10 * MIN };
  db.orders.push(o);
  assert.equal(planAlerts(db, AT, only('Order ready / on the way')).length, 1);
  db.messages.unshift({ id: 'ms9', channel: 'wa', template: 'order_ready', to: '0812 3456 7890', status: 'queued', at: AT, customerId: 'c1', orderId: 'oq' });
  assert.equal(planAlerts(db, AT, only('Order ready / on the way')).length, 0, 'waGuest already queued it');
});

test('sweepAlerts writes every new alert in one commit and nothing on the next sweep', () => {
  const before = snapshot().audit.length, at = Date.now();
  const n = sweepAlerts(at);
  assert.ok(n > 0);
  const d = snapshot();
  assert.equal(d.audit.length, before + 1);
  assert.equal(d.audit[0].action, 'alerts.swept');
  assert.ok(d.notices.some(x => x.id.startsWith('al_')));
  assert.equal(sweepAlerts(at), 0, "same state never fires twice");
  assert.equal(snapshot().audit.length, before + 1, 'no empty commits');
});
