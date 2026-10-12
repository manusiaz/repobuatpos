// Published Customization Studio tools change what the services do: approvals, receipts, outgoing webhooks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commit, snapshot } from './store.ts';
import { addLine, decide, newOrder, publish, requestApproval, startPayment } from './actions.ts';
import { tick } from './actions/dispatch.ts';
import { receiptDoc } from '../devices/receipt.ts';
import { toText } from '../devices/layout.ts';

const tool = (id: string, values: Record<string, unknown>) => publish('page', { tool: id, values }, 'budi', id);
const ap = (id: string) => snapshot().approvals.find(a => a.id === id)!;

test('change approvals "owner + one admin": a price change needs the owner and a second person; owner can still reject', () => {
  tool('approve', { rule: 'two', notify: true });
  const before = snapshot().messages.length;
  const { id } = requestApproval({ type: 'price', title: 'Price · Kopi Susu Aren → 27,000', requestedBy: 'maya', outletId: 'sen', subjectId: 'p2', payload: { price: 27000 } });
  assert.ok(snapshot().messages.slice(0, snapshot().messages.length - before).some(m => m.template === 'approval_request' && m.channel === 'wa'), 'owner gets a WhatsApp');
  assert.equal(decide(id, 'budi', 'approved'), null);
  assert.equal(ap(id).status, 'waiting', 'owner signed first: still needs a second person');
  assert.match(decide(id, 'budi', 'approved') ?? '', /already signed/);
  assert.match(decide(id, 'maya', 'approved') ?? '', /own request/);
  assert.equal(decide(id, 'andi', 'approved'), null);
  assert.equal(ap(id).status, 'approved');
  assert.equal(snapshot().products.find(p => p.id === 'p2')!.basePrice, 27000);

  const r = requestApproval({ type: 'publish', title: 'Publish page · test', requestedBy: 'maya', outletId: 'sen' });
  assert.equal(decide(r.id, 'andi', 'approved'), null);
  assert.equal(ap(r.id).status, 'waiting', 'a manager alone never completes an owner-level change');
  assert.equal(decide(r.id, 'budi', 'rejected'), null);
  assert.equal(ap(r.id).status, 'rejected');
  tool('approve', { rule: 'owner', notify: false });
});

test('receipt template per outlet, legal footer and number format reach the printed receipt', () => {
  const o = newOrder('kem', 'wulan');
  addLine(o, 'p2', [], 1, '', 'wulan');
  startPayment(o, 'cash', snapshot().orders.find(x => x.id === o)!.total, 'wulan');
  const order = () => snapshot().orders.find(x => x.id === o)!;
  let text = toText(receiptDoc(snapshot(), order(), '80')).join('\n');
  assert.ok(text.includes('Powered by BorNiz'));
  tool('rcpt', { outlet: 'kem', paper: '58', inherit: false, h1: 'KOPI BIRU KEMANG', h2: 'Jl. Kemang Raya 12', f1: 'Sampai jumpa lagi!', wifi: 'KB-KEMANG' });
  tool('legal', { co: 'PT Kopi Biru Nusantara', b_terms: 'T', b_privacy: 'P', b_refund: 'Refund within 1x24h' });
  tool('numfmt', { outlet: 'kem', sym: 'rp', sep: 'dot', short: false, date: 'iso', clock: '24', tz: true });
  const doc = receiptDoc(snapshot(), order(), '80');
  text = toText(doc).join('\n');
  assert.equal(doc.paper, '58', 'paper from the outlet template');
  for (const s of ['KOPI BIRU KEMANG', 'Jl. Kemang Raya 12', 'Sampai jumpa lagi!', 'WiFi KB-KEMANG', 'PT Kopi Biru Nusantara', 'Refund within 1x24h', 'WIB']) assert.ok(text.includes(s), s);
  assert.match(text, /Rp\d{1,3}(\.\d{3})+/, 'Rp with dot thousands');
});

test('studio webhooks: published endpoint receives only its events, once, and the delivery is logged', async () => {
  commit('test.plan', 'test', d => { d.tenant.plan = 'enterprise'; });
  tool('hooks', { url: 'https://hooks.kopibiru.id/bornis', 'theme.published': true, 'menu.updated': false, 'price.changed': false, 'order.paid': false, secret: 'whsec_1' });
  const got: string[] = [];
  const transport = { message: async () => ({ ok: true }), hook: async (h: { url: string }, e: { event: string }) => { assert.equal(h.url, 'https://hooks.kopibiru.id/bornis'); got.push(e.event); return { ok: true }; } };
  await tick({ now: Date.now() + 10, transport });
  assert.ok(got.length > 0 && got.every(e => e === 'theme.published'), got.join(','));
  const n = got.length;
  await tick({ now: Date.now() + 20, transport });
  assert.equal(got.length, n, 'not delivered twice');
  assert.ok((snapshot().records.webhook_delivery ?? []).some(r => r.a === 'theme.published' && r.b === 'https://hooks.kopibiru.id/bornis'));
  commit('test.plan', 'test', d => { d.tenant.plan = 'pro'; });
});
