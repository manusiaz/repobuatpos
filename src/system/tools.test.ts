// Customization Studio tools change the live surfaces: published values (never drafts) reach print, guest screens,
// messaging and sounds; unpublished tools keep the defaults the studio starts from.
process.env.TZ = 'Asia/Jakarta';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seed } from '../data/seed.ts';
import type { DB, Order, OrderLine } from '../data/schema.ts';
import { emailFrom, guestCss, guestLanguages, guestVars, itemName, pixelPlan, quietNow, toolValue } from './tools.ts';
import { kitchenDoc, receiptDoc } from '../devices/receipt.ts';
import { cupDoc } from '../devices/labels.ts';
import { toText } from '../devices/layout.ts';
import { sfxOf } from '../ui/sound.ts';
import { orderReady } from '../data/actions.ts';

const T = Date.UTC(2026, 9, 11, 7, 32); // 14:32 WIB
const pub = (db: DB, tool: string, values: Record<string, unknown>, status: 'published' | 'pending_owner' = 'published') =>
  db.versions.unshift({ id: 'v-' + tool + db.versions.length, kind: 'page', by: 'budi', at: T, status, data: { tool, values }, note: '' });
const L = (id: string, productId: string, name: string, qty: number, station: OrderLine['station'], extra: Partial<OrderLine> = {}): OrderLine =>
  ({ id, productId, name, qty, unitPrice: 25000, flashPrice: null, mods: [], note: '', discountPct: 0, station, kds: 'new', fired: true, firedAt: T, ...extra });
function order(db: DB): Order {
  const o: Order = { id: 'o-t', no: '#2050', outletId: 'sen', sessionId: null, source: 'pos', type: 'dine', status: 'paid', table: 'T-07', customerId: 'c1',
    lines: [L('l1', 'p1', 'Es Kopi Susu Aren', 2, 'bar', { mods: [{ name: 'Less sugar', price: 0 }] }), L('l2', 'p11', 'Nasi Goreng', 1, 'kitchen', { note: 'no shrimp' })],
    discountPct: 0, promoIds: [], guests: 2, subtotal: 75000, discount: 0, service: 0, tax: 0, total: 150150, createdAt: T - 6e5, paidAt: T, cashierId: 'rina', idemKey: 'o-t' };
  db.orders.push(o);
  return o;
}

test('toolValue: defaults until published; only the published version counts, extra keys pass through', () => {
  const db = seed(T);
  assert.equal(toolValue(db, 'coupon').code, 'BIRU15');
  pub(db, 'coupon', { code: 'DRAFT' }, 'pending_owner');
  assert.equal(toolValue(db, 'coupon').code, 'BIRU15', 'waiting for the owner is not live');
  pub(db, 'coupon', { code: 'BALIK', exp: 3 });
  assert.equal(toolValue(db, 'coupon').code, 'BALIK');
  assert.equal(toolValue(db, 'coupon').head, 'Come back this week', 'unset keys keep the default');
  pub(db, 'lang', { 'tr:p1:en': 'Iced palm-sugar latte' });
  assert.equal(toolValue(db, 'lang')['tr:p1:en'], 'Iced palm-sugar latte');
});

test('languages: the published default comes first, switched-on languages follow, item names use the translation', () => {
  const db = seed(T), p = db.products.find(x => x.id === 'p1')!;
  assert.deepEqual(guestLanguages(db, 'en'), { first: 'en', langs: ['en', 'id'] }, 'before publishing: the settings page language');
  pub(db, 'lang', { def: 'id', en: true, ja: true, 'tr:p1:ja': 'アイスアレンラテ' });
  assert.deepEqual(guestLanguages(db, 'en'), { first: 'id', langs: ['id', 'en', 'ja'] });
  assert.equal(itemName(db, p, 'ja'), 'アイスアレンラテ');
  assert.equal(itemName(db, p, 'en'), p.name, 'no translation: the name as written');
});

test('ad pixels: only after the guest agrees, never on payment pages; SEO title per page', () => {
  const db = seed(T);
  assert.deepEqual(pixelPlan(db, 'menu-home', null).tags, []);
  assert.equal(pixelPlan(db, 'menu-home', null).ask, false, 'no pixel configured: nothing to ask');
  pub(db, 'pixels', { meta: '123456', ga: 'G-ABC', t_menu: 'Menu Kopi Biru Senayan', d_menu: 'Kopi susu aren dan pastry.' });
  assert.equal(pixelPlan(db, 'menu-home', null).ask, true);
  assert.deepEqual(pixelPlan(db, 'menu-home', false).tags, [], 'declined');
  assert.deepEqual(pixelPlan(db, 'menu-home', true).tags.map(t => t.id), ['meta', 'ga']);
  assert.ok(pixelPlan(db, 'menu-home', true).tags[0].init.includes('"123456"'));
  for (const slug of ['checkout-and-payment', 'qris-payment']) { assert.deepEqual(pixelPlan(db, slug, true).tags, []); assert.equal(pixelPlan(db, slug, null).ask, false); }
  const m = pixelPlan(db, 'category-full-menu', true);
  assert.equal(m.title, 'Menu Kopi Biru Senayan'); assert.equal(m.desc, 'Kopi susu aren dan pastry.');
});

test('consent and sender: quiet hours wrap midnight; own sender only once published with a valid address', () => {
  const db = seed(T), at = (h: number) => new Date(2026, 9, 11, h, 0).getTime();
  assert.equal(quietNow(db, at(22)), true); assert.equal(quietNow(db, at(7)), true); assert.equal(quietNow(db, at(12)), false);
  pub(db, 'optin', { quiet: false });
  assert.equal(quietNow(db, at(22)), false);
  assert.equal(emailFrom(db), '');
  pub(db, 'emaild', { from: 'Kopi Biru', addr: 'struk@kopibiru.id' });
  assert.equal(emailFrom(db), 'Kopi Biru <struk@kopibiru.id>');
  pub(db, 'emaild', { addr: 'not an email' });
  assert.equal(emailFrom(db), '');
});

test('order ready: WhatsApp to the guest only while the studio keeps that channel on', () => {
  const db = seed(T), o = order(db);
  orderReady(db, o);
  assert.equal(db.messages.filter(m => m.orderId === o.id && m.template === 'order_ready').length, 1);
  const db2 = seed(T), o2 = order(db2);
  pub(db2, 'ready', { c_wa: false });
  orderReady(db2, o2);
  assert.equal(db2.messages.filter(m => m.template === 'order_ready').length, 0);
});

test('kitchen ticket layout follows the published studio: item size, table size, notes, cut', () => {
  const db = seed(T), o = order(db), lines = o.lines.filter(l => l.station === 'kitchen');
  const before = kitchenDoc(db, o, 'kitchen', lines, '80');
  assert.ok(before.ops.some(op => op.t === 'text' && op.s.includes('NO SHRIMP') && op.invert), 'notes highlighted by default');
  assert.equal(before.ops.at(-1)?.t, 'cut');
  pub(db, 'kticket', { fs: 'm', table: false, notes: false, cut: false });
  const after = kitchenDoc(db, o, 'kitchen', lines, '80');
  const item = after.ops.find(op => op.t === 'text' && op.s.startsWith('1 x NASI'));
  assert.equal(item?.t === 'text' && item.size, 'tall');
  assert.ok(after.ops.some(op => op.t === 'text' && op.s === 'T-07' && op.size === 'normal'));
  assert.ok(!after.ops.some(op => op.t === 'text' && op.s.includes('NO SHRIMP') && op.invert));
  assert.notEqual(after.ops.at(-1)?.t, 'cut');
});

test('coupon prints under the receipt only once published and when its rule matches', () => {
  const db = seed(T), o = order(db);
  assert.ok(!toText(receiptDoc(db, o, '80')).join('\n').includes('BIRU15'));
  pub(db, 'coupon', { rule: 'member', exp: 7 });
  const text = toText(receiptDoc(db, o, '80')).join('\n');
  assert.ok(text.includes('Code BIRU15-2050') && text.includes('Valid until 18/10/2026') && text.includes('||| BIRU15-2050 |||'));
  o.customerId = null;
  assert.ok(!toText(receiptDoc(db, o, '80')).join('\n').includes('BIRU15'), 'members only');
});

test('cup stickers: one per cup, fields and footer as published', () => {
  const db = seed(T), o = order(db);
  const doc = cupDoc(db, o, o.lines)!, text = toText(doc).join('\n');
  assert.equal(doc.ops.filter(op => op.t === 'cut').length, 2, 'two drinks, two die-cut labels; the rice dish gets none');
  assert.ok(text.includes('Dewi') && text.includes('Less sugar') && text.includes('Enjoy, Dewi! 2/2'));
  pub(db, 'cup', { name: false, mods: false, foot: 'Table {table}', size: '58' });
  const t2 = toText(cupDoc(db, o, o.lines)!).join('\n');
  assert.ok(!t2.includes('Less sugar') && t2.includes('Table T-07 1/2'));
  assert.equal(cupDoc(db, o, o.lines.filter(l => l.station === 'kitchen')), null);
});

test('guest look and sounds: fonts, icon colour, motion and the kitchen chime switch', () => {
  const db = seed(T);
  assert.equal(guestVars(db, db.theme)['--bn-font'], undefined, 'theme font until fonts are published');
  pub(db, 'fonts', { head: 'body', body: 'space' });
  pub(db, 'icons', { color: 'dark', stroke: 1.5, style: 'duo' });
  pub(db, 'anim', { level: 'none' });
  const v = guestVars(db, db.theme);
  assert.equal(v['--bn-font'], "'Instrument Sans',sans-serif"); assert.equal(v['--font-body'], "'Space Grotesk',sans-serif"); assert.equal(v['--bn-icon'], db.theme.ink);
  const css = guestCss(db);
  assert.ok(css.includes('stroke-width:1.5px') && css.includes('fill-opacity') && css.includes('animation:none'));
  assert.deepEqual(sfxOf(db, 'sfx-order-in', 'kds').hz, [1046, 1568, 1318], 'bell by default');
  pub(db, 'sounds', { kds: false, 'sfx-pay-success': 'coin', vol: 40 });
  assert.deepEqual(sfxOf(db, 'sfx-order-in', 'kds').hz, []);
  assert.deepEqual(sfxOf(db, 'sfx-pay-success'), { hz: [1568, 2093], vol: 40 });
});
