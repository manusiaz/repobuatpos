'use client';
// Service layer. Mirrors the service events in spec/bn-diagrams.js (Orders, Payments, Inventory, Shifts, Approvals,
// Loyalty, Catalog, Themes). A service writes only through commit(); effects of one event run in the same commit.
import { channelPrice, feedbackBeans, referralOffer, studioValue } from '../system/studio.ts';
import { commit, snapshot, uid } from './store.ts';
import type { Approval, DB, Order, Product, Rec, Role } from './schema.ts';
import { lineTotal, orderTotals, QRIS_TTL_MS, type Method, type Source } from '../domain/order.ts';
import { canDecide, levelRequired, twoKey, TWO_KEY, type Level, type RequestType, type Signer, PIN_TRIES, PIN_LOCK_MS } from '../domain/approval.ts';
import { approvalRule, approvalWa } from '../system/tools.ts';
import { balance, earn, reversal, tierOf, canRedeem } from '../domain/loyalty.ts';
import { deductForSale, level as stockLevel, levels, portionsLeft, missingPhotos, opnameApprover, postOpname, type OpnameLine } from '../domain/stock.ts';
import { flashPrice, resolve } from '../domain/promo.ts';
import { closeCheck, type ClockShot } from '../domain/shift.ts';
import { comboPrices } from '../domain/split.ts';
import { idr, roundCash } from '../domain/money.ts';
import { approvalAlert, decidedAlert } from './alerts/names.ts';
import { thisDevice } from '../devices/routing.ts';
import { escalationOn, payOn, photoRequired, type PayId } from '../system/settings.ts';
import alertsCatalog from '../system/alerts.json' with { type: 'json' };
import { perm } from '../system/perms.ts';
import { toolValue } from '../system/tools.ts';
import { has } from '../screens/public/plans.ts';

const now = () => Date.now();
const emp = (d: DB, id: string) => d.employees.find(e => e.id === id);
const outletOf = (d: DB, id: string) => d.outlets.find(o => o.id === id)!;
/** Franchise lock "Menu prices" on: every outlet sells at the base price (local prices are kept, not used). */
export const priceAt = (d: DB, p: Product, outletId: string) => (d.tenant.locks.menuPrices ? null : d.outletProducts.find(x => x.productId === p.id && x.outletId === outletId)?.localPrice) ?? p.basePrice;
/** The saved permission matrix decides what a person may do directly ('y', or 'o' at their own outlets); 'a' needs an approver. */
const mayDo = (d: DB, by: string, action: string, outletId: string) => {
  const e = emp(d, by); if (!e) return false;
  const c = perm(d, e.role, action, outletId);
  return e.role === 'owner' || c === 'y' && e.outlets.includes(outletId) || c === 'o' && e.outlets.includes(outletId);
};

// Alert engine: recipients come from the alert catalog (spec/bn-alerts.js) when the alert is listed there.
const ALERT_TO: Record<string, Role[]> = Object.fromEntries((alertsCatalog.groups as [string, string, [string, string, Record<string, number>][]][])
  .flatMap(g => g[2].map(a => [a[0].toLowerCase(), Object.keys(a[2]).filter(r => r !== 'guest') as Role[]])));
export function notify(d: DB, alert: string, level: 'info' | 'warn' | 'high', fallback: Role[], outletId: string | null, text: string, href: string | null = null) {
  const to = ALERT_TO[alert.toLowerCase()] ?? fallback;
  d.notices.unshift({ id: uid('n'), alert, level, to, outletId, text, href, at: now(), read: false });
  if (d.notices.length > 200) d.notices.length = 200;
}

function recalc(d: DB, o: Order) {
  if (!o.lines.length && d.records.gift_cards?.some(r => r.a === o.id)) return; // a gift card order is its amount: no lines, no PB1
  const out = outletOf(d, o.outletId);
  const lines = o.lines.map(l => ({ unitPrice: l.unitPrice, flashPrice: l.flashPrice, modifiers: l.mods.map(m => m.price), qty: l.qty, discountPct: l.discountPct }));
  // promo value and min spend are worked out on what the guest is charged: modifiers in, item discounts out
  const promo = resolve(d.promos.filter(p => o.promoIds.includes(p.id)), lines.map(lineTotal).reduce((a, b) => a + b, 0));
  const t = orderTotals(lines, out, { pct: o.discountPct, amount: promo.discount });
  Object.assign(o, { subtotal: t.subtotal, discount: t.orderDiscount, service: t.service, tax: t.tax, total: t.total });
}
const findOrder = (d: DB, id: string) => d.orders.find(o => o.id === id)!;

// ── Orders ──────────────────────────────────────────────────────────────────────────────
export function newOrder(outletId: string, by: string, source: Source = 'pos', patch: Partial<Order> = {}) {
  const id = uid('o');
  commit('order.created', by, d => {
    const no = d.counters.order++;
    d.orders.push({ id, no: (source === 'kiosk' ? 'K-' : source === 'qr' ? 'QR-' : '#') + no, outletId, sessionId: d.sessions.find(s => s.outletId === outletId && s.status === 'open')?.id ?? null,
      source, type: 'dine', status: 'open', table: null, customerId: null, lines: [], discountPct: 0, promoIds: [], guests: 1,
      subtotal: 0, discount: 0, service: 0, tax: 0, total: 0, createdAt: now(), paidAt: null, cashierId: source === 'pos' ? by : null, idemKey: id, ...patch });
  }, id, outletId);
  return id;
}
export function addLine(orderId: string, productId: string, mods: { name: string; price: number }[] = [], qty = 1, note = '', by = 'guest') {
  commit('order.line_added', by, d => {
    const o = findOrder(d, orderId), p = d.products.find(x => x.id === productId)!;
    if (d.outletProducts.find(x => x.productId === p.id && x.outletId === o.outletId)?.is86) return;
    const key = JSON.stringify([productId, mods, note]);
    const same = o.lines.find(l => !l.fired && !l.combo && JSON.stringify([l.productId, l.mods, l.note]) === key);
    if (same) same.qty += qty;
    else o.lines.push({ id: uid('l'), productId, name: p.name, qty, unitPrice: priceAt(d, p, o.outletId), flashPrice: flashPrice(d.promos, p.id), mods, note,
      discountPct: 0, station: d.categories.find(c => c.id === p.categoryId)?.station ?? 'bar', kds: 'new', fired: false });
    recalc(d, o);
  }, orderId);
}
/** Combo (Menu Studio › combo builder): one line per picked item, priced so the items add up to the combo price exactly;
 *  options are charged on top. The kitchen sees each item at its own station with the combo name as the note. */
export function addCombo(orderId: string, combo: { name: string; price: number }, picks: { productId: string; mods: { name: string; price: number }[] }[], by = 'guest') {
  commit('order.combo_added', by, d => {
    const o = findOrder(d, orderId), ok = sellable(d, o.outletId), ps = picks.map(x => d.products.find(p => p.id === x.productId));
    if (!picks.length || ps.some((p, i) => !p || !ok(picks[i].productId))) throw new Error('Something in this combo just sold out. Pick another item.');
    const units = comboPrices(combo.price, ps.map(p => priceAt(d, p!, o.outletId))), id = uid('cb');
    ps.forEach((p, i) => o.lines.push({ id: uid('l'), productId: p!.id, name: p!.name, qty: 1, unitPrice: units[i], flashPrice: null, mods: picks[i].mods, note: combo.name,
      discountPct: 0, station: d.categories.find(c => c.id === p!.categoryId)?.station ?? 'bar', kds: 'new', fired: false, combo: id }));
    recalc(d, o);
  }, orderId);
}
export function setQty(orderId: string, lineId: string, qty: number, by: string) {
  commit('order.line_qty', by, d => { const o = findOrder(d, orderId); const l = o.lines.find(x => x.id === lineId); if (!l || l.fired) return;
    // a combo is one item: fewer removes the whole combo, more is a new combo from the builder
    if (l.combo) { if (qty < l.qty) o.lines = o.lines.filter(x => x.combo !== l.combo || x.fired); }
    else { l.qty = qty; o.lines = o.lines.filter(x => x.qty > 0); }
    recalc(d, o); }, orderId);
}
export function patchOrder(orderId: string, patch: Partial<Order>, by: string) {
  commit('order.updated', by, d => { const o = findOrder(d, orderId); Object.assign(o, patch); recalc(d, o); }, orderId);
}
/** Staff moves a bill to another table: tickets still in the kitchen get a 'Table moved' alert, the guest's phone follows it. */
export function moveTable(orderId: string, to: string, by: string) {
  commit('order.table_moved', by, d => { const o = findOrder(d, orderId), from = o.table; if (from === to) return;
    Object.assign(o, { table: to, type: 'dine', movedFrom: from });
    if (o.lines.some(l => l.fired && l.kds !== 'done')) notify(d, 'Table moved', 'info', ['kitchen', 'waiter'], o.outletId, `${o.no} · ${from ?? 'no table'} → ${to}`);
    recalc(d, o); }, orderId);
}
/** Void a line (or the whole bill when lineId is null). Food already in the kitchen and not served raises 'Item voided' so nobody cooks it. */
function voidIn(d: DB, o: Order, lineId: string | null, why: string) {
  const stop = o.lines.filter(l => (!lineId || l.id === lineId) && l.fired && l.kds !== 'done');
  if (lineId && stop.length) o.stopped = [...(o.stopped ?? []), ...stop.map(l => ({ ...l, stoppedAt: now() }))]; // the printer agent sends the VOID slip
  if (lineId) o.lines = o.lines.filter(l => l.id !== lineId); else Object.assign(o, { status: 'voided', ...(why ? { note: 'Voided: ' + why } : {}) });
  if (stop.length) notify(d, 'Item voided', 'high', ['kitchen', 'waiter'], o.outletId, `${o.no} · ${o.table ?? (o.type === 'dine' ? 'dine-in' : o.type === 'take' ? 'takeaway' : 'delivery')} · stop ${stop.map(l => `${l.qty}× ${l.name}`).join(', ')}`);
  recalc(d, o);
}
export function voidItem(orderId: string, lineId: string | null, by: string, why = '') {
  commit(lineId ? 'order.item_voided' : 'order.voided', by, d => voidIn(d, findOrder(d, orderId), lineId, why), orderId);
}
export function clearOrder(orderId: string, by: string) {
  commit('order.cleared', by, d => { const o = findOrder(d, orderId); o.lines = o.lines.filter(l => l.fired); o.customerId = null; o.discountPct = 0; o.promoIds = []; recalc(d, o); }, orderId);
}
export function applyVoucher(orderId: string, code: string, by: string): string | null {
  const p = snapshot().promos.find(x => x.code?.toUpperCase() === code.trim().toUpperCase());
  if (!p) return 'Voucher not found';
  if (p.quota != null && (p.used ?? 0) >= p.quota) return 'Voucher quota used up';
  if (p.endsAt && now() > p.endsAt) return 'Voucher expired';
  patchOrder(orderId, { promoIds: [p.id] }, by);
  return null;
}
/** Course firing: send unfired lines to their stations. */
const GUEST_SOURCES: Source[] = ['qr', 'kiosk', 'web'];
const GUEST_ACTORS = ['guest', 'kiosk'];
/** Sellable to guests now: not 86'd and the recipe can still make one portion from this outlet's stock. */
export function sellable(d: DB, outletId: string) {
  const lv = levels(d.movements, outletId);
  return (productId: string) => { const op = d.outletProducts.find(x => x.productId === productId && x.outletId === outletId);
    return !!op && !op.is86 && !op.hidden && d.products.find(p => p.id === productId)?.status === 'live' && portionsLeft(d.recipes, lv, productId) >= 1; };
}
/** A guest can't pay for or send what the kitchen can't make (it sold out while it sat in the cart). */
function guardGuest(d: DB, o: Order, by: string) {
  if (!GUEST_ACTORS.includes(by)) return;
  const ok = sellable(d, o.outletId), gone = o.lines.filter(l => !l.fired && !ok(l.productId));
  if (gone.length) throw new Error(`${gone.map(l => l.name).join(', ')} just sold out. Remove ${gone.length > 1 ? 'them' : 'it'} to continue.`);
}
/** Fire unsent lines: kitchen gets "New order" (and "Allergy order" when a note says so). */
function fire(d: DB, o: Order) {
  const fresh = o.lines.filter(l => !l.fired); if (!fresh.length) return;
  fresh.forEach(l => { l.fired = true; l.kds = 'new'; l.firedAt = now(); });
  const tag = `${o.no}${o.table ? ' · ' + o.table : ''}`;
  notify(d, 'New order', 'info', ['kitchen'], o.outletId, `${tag} · ${fresh.reduce((a, l) => a + l.qty, 0)} items`, '/kds');
  const allergy = fresh.filter(l => /alerg|allerg/i.test(l.note + ' ' + l.mods.map(m => m.name).join(' ')));
  if (allergy.length) notify(d, 'Allergy order', 'high', ['kitchen', 'waiter', 'pic'], o.outletId, `${tag} · ${allergy.map(l => `${l.name}: ${l.note || l.mods.map(m => m.name).join(', ')}`).join(' · ')}`, '/kds');
}
export function sendToKitchen(orderId: string, by: string) {
  commit('order.sent', by, d => {
    const o = findOrder(d, orderId);
    guardGuest(d, o, by);
    fire(d, o);
    if (o.status === 'open' || o.status === 'held') o.status = 'sent';
  }, orderId);
}
export function holdOrder(orderId: string, by: string) { commit('order.held', by, d => { findOrder(d, orderId).status = 'held'; }, orderId); }
export function reopen(orderId: string, by: string) { commit('order.reopened', by, d => { const o = findOrder(d, orderId); if (o.status === 'held') o.status = 'open'; }, orderId); }

// ── Payments ────────────────────────────────────────────────────────────────────────────
export function startPayment(orderId: string, method: Method, amount: number, by: string, tip = 0) {
  const id = uid('pay');
  const online = snapshot().device.online;
  if (!online && (method === 'qris' || method === 'va' || method === 'ewallet')) throw new Error('Offline: QRIS, VA and e-wallet need internet. Use cash or card.');
  if (!payOn(snapshot(), method as PayId)) throw new Error(`${method.toUpperCase()} is switched off in Payment methods.`);
  commit('payment.created', by, d => {
    const o = findOrder(d, orderId);
    if (CLOSED.includes(o.status)) throw new Error(`${o.no} is already closed (${o.status}). Nothing was charged.`);
    guardGuest(d, o, by);
    if (method === 'deposit' || method === 'kasbon') {
      const c = d.customers.find(x => x.id === o.customerId);
      if (!c) throw new Error('Attach the customer first: deposit and kasbon belong to a member account.');
      if (method === 'deposit' && c.deposit < amount) throw new Error(`Deposit balance too low (${idr(c.deposit)}).`);
    }
    o.status = 'paying';
    // the money goes into the drawer of whoever takes it (another register, a handed-over bill, a QR bill paid at the counter)
    const drawer = d.sessions.find(s => s.outletId === o.outletId && s.cashierId === by && s.status === 'open')?.id ?? o.sessionId;
    const instant = method === 'cash' || method === 'card' || method === 'deposit' || method === 'kasbon';
    d.payments.push({ id, orderId, outletId: o.outletId, method, amount, tip, status: instant ? 'settled' : 'pending', ref: (method === 'qris' ? 'QRIS-' : 'REF-') + id.slice(-6).toUpperCase(),
      at: now(), expiresAt: method === 'qris' ? now() + (Number(studioValue(d, 'qris-payment-page-on-customer-phone').timer) * 60e3 || QRIS_TTL_MS) : null, sessionId: drawer, takenOn: thisDevice(d) });
    if (method === 'deposit' && o.customerId) { const c = d.customers.find(x => x.id === o.customerId)!; c.deposit -= amount; }
    if (method === 'kasbon' && o.customerId) { const c = d.customers.find(x => x.id === o.customerId)!; c.credit += amount; }
    if (instant) settleIfDone(d, o, by);
  }, orderId);
  if (method === 'qris' || method === 'va' || method === 'ewallet') void import('./remote.ts')
    .then(async r => { if (r.REMOTE) await (await import('./actions/dispatch.ts')).chargePayment(id); })
    .catch(e => import('../ui/kit.tsx').then(k => k.toast((e as Error).message)));
  return id;
}
/** Simulates the gateway webhook (the only thing allowed to settle QRIS / VA / e-wallet). */
export function gatewayWebhook(paymentId: string, status: 'settled' | 'failed' | 'expired') {
  commit('payment.' + status, 'gateway', d => {
    const p = d.payments.find(x => x.id === paymentId);
    if (!p || p.status !== 'pending') return; // idempotent on gateway_ref
    p.status = status;
    const o = findOrder(d, p.orderId);
    if (status === 'settled') settleIfDone(d, o, 'gateway');
    else { o.status = backFromPaying(o); notify(d, 'Payment failed / declined', 'warn', ['cashier'], o.outletId, `${o.no}${o.table ? ' · ' + o.table : ''} · ${p.method.toUpperCase()} ${status} · ${idr(p.amount)}`); }
  }, paymentId);
}
/** Paid, refunded or voided bills take no more payments. */
export const CLOSED: Order['status'][] = ['paid', 'part_refunded', 'refunded', 'voided'];
/** A failed or cancelled payment never un-sends a ticket: fired orders go back to their kitchen state. */
export const backFromPaying = (o: Order): Order['status'] => !o.lines.some(l => l.fired) ? 'open' : o.lines.every(l => l.kds === 'done') ? 'ready' : 'sent';
export function settleIfDone(d: DB, o: Order, by: string) {
  // a payment that lands on a bill already paid or voided (QRIS paid after cash, late webhook) is money to give back, not a second sale
  if (CLOSED.includes(o.status) || o.paidAt) { notify(d, 'Payment failed / declined', 'warn', ['cashier', 'pic'], o.outletId, `${o.no} is already ${o.status} but another payment settled · refund it to the guest`); return; }
  const paid = d.payments.filter(p => p.orderId === o.id && p.status === 'settled').reduce((a, p) => a + p.amount, 0);
  // cash rounding (lg-total) is a separate line applied last: a cash bill is settled at the rounded amount
  const cash = d.payments.some(p => p.orderId === o.id && p.method === 'cash' && p.status === 'settled');
  if (paid < (cash ? Math.min(o.total, roundCash(o.total)) : o.total)) return;
  o.status = 'paid'; o.paidAt = now();
  // Gift card bought on the guest page (Menu Studio › gift card designer): the balance lands on the recipient's member
  // account (pay with deposit / gift card at the POS) and they get a WhatsApp. records.gift_cards: a order · b recipient · c amount · d message · e state
  for (const r of d.records.gift_cards ?? []) {
    const c = r.a === o.id && r.e === 'pending' ? d.customers.find(x => x.id === r.b) : undefined;
    if (!c) continue;
    c.deposit += Number(r.c); r.e = 'issued';
    d.messages.unshift({ id: uid('ms'), channel: 'wa', template: 'gift_card', to: c.phone, status: 'queued', at: now(), customerId: c.id, orderId: o.id });
  }
  // Pay-first guest orders (QR menu, kiosk, web) go to the kitchen at settlement, wherever the gateway lands, not on the guest's open tab.
  if (o.total > 2_000_000) notify(d, 'Big order', 'info', ['pic', 'manager'], o.outletId, `${o.no} · ${idr(o.total)}`);
  if (GUEST_SOURCES.includes(o.source) && o.lines.some(l => !l.fired)) {
    fire(d, o);
    notify(d, 'New QR / kiosk / online order', 'info', ['cashier', 'pic'], o.outletId, `${o.no}${o.table ? ' · ' + o.table : ''} · ${o.source === 'kiosk' ? 'kiosk' : 'QR menu'} · paid`, '/pos/selling/online-and-qr-orders-inbox');
    waGuest(d, o, 'e_receipt');
  }
  if (o.promoIds.length) o.promoIds.forEach(id => { const p = d.promos.find(x => x.id === id); if (p) p.used = (p.used ?? 0) + 1; });
  // flash quota counts units sold at the flash price
  o.lines.forEach(l => { if (l.flashPrice == null) return; const f = d.promos.find(p => p.kind === 'flash' && p.value === l.flashPrice && p.productIds?.includes(l.productId)); if (f) f.used = (f.used ?? 0) + l.qty; });
  // order.paid → Inventory (recipe deduction), Loyalty (earn), Notifications (thank-you automation)
  // Stock moves at payment; a product that can no longer make one portion is "Out of stock" (sold out on QR + kiosk), else "Low stock" under par.
  const used = has(d.tenant.plan, 'inventory') ? deductForSale(d.recipes, o.lines, o.outletId, o.id, by) : [], before = levels(d.movements, o.outletId);
  d.movements.push(...used);
  const after = levels(d.movements, o.outletId), at = outletOf(d, o.outletId).name;
  const gone = d.products.filter(p => p.status === 'live' && portionsLeft(d.recipes, before, p.id) >= 1 && portionsLeft(d.recipes, after, p.id) < 1);
  for (const itemId of new Set(used.map(m => m.stockItemId))) {
    const item = d.stockItems.find(s => s.id === itemId)!, lvl = after.get(itemId) ?? 0, was = before.get(itemId) ?? 0;
    const hit = gone.filter(p => d.recipes.some(r => r.productId === p.id && r.stockItemId === itemId && lvl / r.qty + 1e-9 < 1)).map(p => p.name);
    if (hit.length) notify(d, 'Out of stock', 'high', ['pic', 'manager', 'kitchen'], o.outletId, `${item.name} ran out at ${at} (${Math.max(0, lvl).toFixed(2)} ${item.unit}) · ${hit.join(', ')} sold out on the QR menu and kiosk until stock is received or recounted`, '/owner/inventory/low-stock-alerts-and-reorder-rules');
    else if (lvl < item.par && was >= item.par) notify(d, 'Low stock', 'warn', ['pic', 'manager'], o.outletId, `${item.name} below par at ${at} (${lvl.toFixed(1)} ${item.unit})`, '/owner/inventory/low-stock-alerts-and-reorder-rules');
  }
  if (o.customerId && has(d.tenant.plan, 'loyalty')) {
    const tier = tierOf(d.ledger, o.customerId);
    const pts = earn(o.subtotal - o.discount, tier);
    if (pts > 0) d.ledger.push({ customerId: o.customerId, points: pts, reason: 'Order ' + o.no, orderId: o.id, at: now() });
    // Invite a friend: the friend's first paid order rewards both, once (records.referrals: a friend · b member who invited · e joined|rewarded)
    const ref = (d.records.referrals ?? []).find(r => r.a === o.customerId && r.e === 'joined');
    if (ref) {
      const r = referralOffer(d), friend = d.customers.find(x => x.id === ref.a);
      if (r.friend > 0) d.ledger.push({ customerId: ref.a, points: r.friend, reason: 'Referral welcome', orderId: o.id, at: now() });
      if (r.referrer > 0) d.ledger.push({ customerId: ref.b, points: r.referrer, reason: 'Referral · ' + (friend?.name ?? 'friend'), orderId: o.id, at: now() });
      ref.e = 'rewarded'; ref.c = o.id;
    }
  }
}
export function cancelPayment(paymentId: string, by: string) {
  commit('payment.cancelled', by, d => { const p = d.payments.find(x => x.id === paymentId); if (p && p.status === 'pending') { p.status = 'failed'; const o = findOrder(d, p.orderId); o.status = backFromPaying(o); } }, paymentId);
}

// ── Approvals (one engine, lg-approval) ──────────────────────────────────────────────────
const pinFails: Record<string, { n: number; until: number }> = {};
export function verifyPin(employeeId: string, pin: string): string | null {
  const f = pinFails[employeeId] ?? { n: 0, until: 0 };
  if (f.until > now()) return `Locked for ${Math.ceil((f.until - now()) / 60e3)} min after ${PIN_TRIES} wrong tries. Owner can reset.`;
  const e = snapshot().employees.find(x => x.id === employeeId);
  if (e && e.approvalPin === pin) { delete pinFails[employeeId]; return null; }
  f.n++; if (f.n >= PIN_TRIES) { f.until = now() + PIN_LOCK_MS; f.n = 0; commit('pin.locked', 'system', d => notify(d, 'Too many wrong PINs', 'high', ['manager', 'owner'], null, `${e?.name ?? employeeId}: approval PIN locked after ${PIN_TRIES} wrong tries`)); }
  pinFails[employeeId] = f;
  return `Wrong PIN. ${PIN_TRIES - f.n} tries left.`;
}
export function requestApproval(a: { type: RequestType; title: string; amount?: number; pct?: number; requestedBy: string; outletId: string; subjectId?: string | null; note?: string; countedBy?: string; payload?: Record<string, unknown> }) {
  const lvl = levelRequired(a.type, a.amount ?? 0, a.pct ?? 0);
  const id = uid('ap');
  commit('approval.requested', a.requestedBy, d => {
    const row: Approval = { id, type: a.type, title: a.title, subjectId: a.subjectId ?? null, amount: a.amount ?? 0, pct: a.pct ?? 0, level: lvl, status: 'waiting', requestedBy: a.requestedBy, countedBy: a.countedBy, outletId: a.outletId, note: a.note ?? '', at: now(), payload: a.payload };
    if (lvl === 'cashier') { row.status = 'approved'; row.decidedBy = a.requestedBy; row.decidedAt = now(); applyDecision(d, row); }
    d.approvals.unshift(row);
    if (lvl !== 'cashier') notify(d, approvalAlert(a.type, a.amount ?? 0, a.payload), lvl === 'owner' ? 'high' : 'warn', [lvl === 'pic' ? 'pic' : lvl], a.outletId, `${a.title} · ${lvl.toUpperCase()} to decide`, lvl === 'owner' ? '/owner/monitor/notifications-and-activity-center' : lvl === 'manager' ? '/manager/operations/approvals' : '/pic/approvals/approval-queue');
    // Studios › Change approvals: "Notify the owner on WhatsApp" for studio changes waiting for the owner
    if (lvl === 'owner' && TWO_KEY.includes(a.type) && approvalWa(d)) d.employees.filter(e => e.role === 'owner' && e.active && e.phone).forEach(e => d.messages.unshift({ id: uid('ms'), channel: 'wa', template: 'approval_request', to: e.phone, status: 'queued', at: now(), customerId: null }));
  }, a.title, a.outletId);
  return { id, level: lvl };
}
/** `extra` merges into the request payload, e.g. { promote: false } for the owner's "Keep local" on a local menu item. */
export function decide(approvalId: string, by: string, decision: 'approved' | 'rejected' | 'recount', note = '', extra?: Record<string, unknown>): string | null {
  const d0 = snapshot(), a = d0.approvals.find(x => x.id === approvalId), e = emp(d0, by);
  if (!a || !e) return 'Not found';
  if (a.status !== 'waiting') return `Already ${a.status} by ${emp(d0, a.decidedBy ?? '')?.name ?? 'someone else'}.`;
  if (e.role !== 'owner' && !e.outlets.includes(a.outletId)) return 'This request belongs to another outlet.';
  const lvl: Level = e.role === 'owner' ? 'owner' : e.role === 'manager' ? 'manager' : e.role === 'pic' ? 'pic' : 'cashier';
  if (a.type === 'opname' && decision === 'approved') { const op = d0.opnames.find(x => x.id === a.subjectId); if (op && missingPhotos(op.lines.filter(l => typeof l.counted === 'number'), op.requirePhotoAll).length) return 'Photo proof missing on a line with a difference. Ask for it before signing.'; }
  // Studios › Change approvals "Owner + one admin": two people sign, one the owner (src/domain/approval.ts twoKey).
  const two = decision === 'approved' && TWO_KEY.includes(a.type) && approvalRule(d0) === 'two' ? twoKey(((a.payload?.signers ?? []) as Signer[]), { id: by, level: lvl }, a.requestedBy) : null;
  if (two && two !== 'approve' && two !== 'cosign') return two;
  if (two === 'cosign') {
    commit('approval.cosigned', by, d => {
      const r = d.approvals.find(x => x.id === approvalId)!;
      r.payload = { ...(r.payload ?? {}), signers: [...((r.payload?.signers ?? []) as Signer[]), { id: by, level: lvl }] };
      notify(d, decidedAlert(r.type), 'info', ['owner', 'manager'], r.outletId, `${r.title} · signed by ${emp(d, by)?.name}, needs a second sign-off`);
    }, a.title, a.outletId);
    return null;
  }
  if (!two && !canDecide({ level: a.level, requestedBy: a.requestedBy, countedBy: a.countedBy }, { id: by, level: lvl }))
    return by === a.requestedBy || by === a.countedBy ? 'You can’t decide your own request.' : `Needs ${a.level}. Escalate instead.`;
  commit('approval.' + decision, by, d => {
    const r = d.approvals.find(x => x.id === approvalId)!;
    Object.assign(r, { status: decision, decidedBy: by, decidedAt: now(), decisionNote: note });
    if (extra) r.payload = { ...(r.payload ?? {}), ...extra };
    if (decision === 'approved') applyDecision(d, r);
    if (decision === 'recount' && r.type === 'opname') { const op = d.opnames.find(o => o.id === r.subjectId); if (op) op.status = 'recount'; }
    if (decision === 'rejected') rejectEffects(d, r);
    notify(d, decidedAlert(r.type), 'info', ['cashier', 'pic', 'manager'], r.outletId, `${r.title} · ${decision} by ${emp(d, by)?.name}`);
  }, a.title, a.outletId);
  return null;
}
export function escalate(approvalId: string, by: string) {
  commit('approval.escalated', by, d => { const r = d.approvals.find(x => x.id === approvalId)!; r.level = r.level === 'pic' ? 'manager' : 'owner'; notify(d, 'Approval not answered', 'warn', [r.level], r.outletId, r.title + ' escalated to ' + r.level); }, approvalId);
}
function rejectEffects(d: DB, r: Approval) {
  if (r.type === 'local_item' && r.subjectId) { const p = d.products.find(x => x.id === r.subjectId); if (p) p.status = 'archived'; }
  if (r.type === 'opname' && r.subjectId) { const op = d.opnames.find(x => x.id === r.subjectId); if (op) op.status = 'rejected'; }
  if (r.type === 'po' && r.subjectId) { const po = d.pos.find(x => x.id === r.subjectId); if (po && po.status === 'waiting') po.status = 'cancelled'; }
  if (r.type === 'variance' && r.subjectId) { const s = d.sessions.find(x => x.id === r.subjectId); if (s) s.status = 'counting'; }
  if (r.type === 'cash_out') { const c = d.cashMoves.find(x => x.id === r.subjectId); if (c) c.status = 'rejected'; } // kept as asked, no cash moved
}
function applyDecision(d: DB, r: Approval) {
  const pl = (r.payload ?? {}) as Record<string, any>;
  if (pl.settingKey) d.settings[pl.settingKey] = pl.settingValue;
  if (pl.outletPatch) Object.assign(d.outlets.find(o => o.id === pl.outletPatch.id) ?? {}, pl.outletPatch.patch);
  switch (r.type) {
    case 'discount': { const o = d.orders.find(x => x.id === r.subjectId); if (o) { o.discountPct = r.pct; recalc(d, o); } break; }
    case 'void': { const o = d.orders.find(x => x.id === r.subjectId); if (o) voidIn(d, o, (pl.lineId as string) ?? null, r.note); break; }
    case 'refund': {
      const o = d.orders.find(x => x.id === r.subjectId); if (!o) break;
      // Paid back over the payments it was paid with, never more than each one took (real money first, cash rounding last).
      const pays = d.payments.filter(p => p.orderId === o.id && p.status === 'settled').sort((a, b) => Number(a.ref === 'ROUNDING') - Number(b.ref === 'ROUNDING'));
      const back = (pid: string) => d.refunds.filter(x => x.paymentId === pid).reduce((a, x) => a + x.amount, 0);
      const drawer = d.sessions.find(s => s.outletId === o.outletId && s.cashierId === r.requestedBy && s.status === 'open')?.id ?? null;
      const cust = d.customers.find(c => c.id === o.customerId);
      let left = r.amount, paidBack = 0;
      for (const p of pays) {
        const amt = Math.min(left, p.amount - back(p.id)); if (amt <= 0) continue;
        left -= amt; paidBack += amt;
        d.refunds.push({ id: uid('rf'), orderId: o.id, paymentId: p.id, amount: amt, reason: r.note, approvalId: r.id, at: now(), toStock: !!pl.toStock, sessionId: p.method === 'cash' ? drawer ?? p.sessionId : p.sessionId });
        if (p.method === 'deposit' && cust) cust.deposit += amt;
        if (p.method === 'kasbon' && cust) cust.credit -= amt;
      }
      if (!paidBack) break; // already refunded in full (a second request for the same bill)
      const refunded = d.refunds.filter(x => x.orderId === o.id).reduce((a, x) => a + x.amount, 0);
      o.status = refunded >= o.total ? 'refunded' : 'part_refunded';
      // beans: reverse the share refunded so far, minus what earlier refunds already reversed
      for (const cid of new Set(d.ledger.filter(l => l.orderId === o.id && l.points > 0).map(l => l.customerId))) {
        const mine = d.ledger.filter(l => l.orderId === o.id && l.customerId === cid);
        const earned = mine.filter(l => l.points > 0).reduce((a, l) => a + l.points, 0), reversed = -mine.filter(l => l.points < 0).reduce((a, l) => a + l.points, 0);
        const due = Math.min(Math.round(earned * Math.min(1, refunded / (o.total || 1))) - reversed, balance(d.ledger, cid)); // beans already spent stay spent
        if (due > 0) d.ledger.push({ ...reversal({ customerId: cid, points: due, reason: '', orderId: o.id, at: now() }) });
      }
      // stock comes back for the refunded items only; an amount-only partial refund returns nothing
      // and never a line an earlier refund already put back
      const lineIds = pl.lineIds as string[] | undefined;
      const done = new Set(d.refunds.filter(x => x.orderId === o.id && x.toStock && x.approvalId !== r.id).flatMap(x => x.lineIds ?? o.lines.map(l => l.id)));
      const lines = (lineIds?.length ? o.lines.filter(l => lineIds.includes(l.id)) : paidBack >= o.total ? o.lines : []).filter(l => !done.has(l.id));
      if (pl.toStock && lines.length && has(d.tenant.plan, 'inventory')) {
        const mine = d.refunds.find(x => x.approvalId === r.id); if (mine) mine.lineIds = lines.map(l => l.id);
        d.movements.push(...deductForSale(d.recipes, lines, o.outletId, o.id, r.decidedBy ?? '').map(m => ({ ...m, qty: -m.qty, type: 'refund_return' as const })));
      }
      break;
    }
    case 'local_item': { const p = d.products.find(x => x.id === r.subjectId); if (p) { p.status = 'live'; if (pl.promote ?? p.promoteRequested) { p.scope = 'global'; p.ownerOutletId = null; d.outlets.forEach(o => { if (!d.outletProducts.some(x => x.productId === p.id && x.outletId === o.id)) d.outletProducts.push({ productId: p.id, outletId: o.id, localPrice: null, is86: false, hidden: false }); }); } } break; }
    case 'price': { const p = d.products.find(x => x.id === r.subjectId); if (p && pl.price) { if (pl.outletId) { const op = d.outletProducts.find(x => x.productId === p.id && x.outletId === pl.outletId); if (op) op.localPrice = pl.price; } else p.basePrice = pl.price; } break; }
    case 'opname': { const op = d.opnames.find(x => x.id === r.subjectId); if (op) { op.status = 'posted'; op.approvedBy = r.decidedBy ?? null; d.movements.push(...postOpname(op.lines, op.outletId, op.id, r.decidedBy ?? '')); } break; }
    case 'variance': { const s = d.sessions.find(x => x.id === r.subjectId); if (s) { s.status = 'closed'; s.closedAt = now(); } break; }
    case 'cash_out': { const c = d.cashMoves.find(x => x.id === r.subjectId); if (c) c.status = 'done'; break; }
    case 'po': { const po = d.pos.find(x => x.id === r.subjectId); if (po) po.status = 'sent'; break; }
    case 'publish': { const v = d.versions.find(x => x.id === r.subjectId); if (v) { v.status = 'published'; if (v.kind === 'menu') Object.assign(d.theme, v.data); if (v.kind === 'brand') Object.assign(d.staffBrand, v.data); } break; }
    case 'waste': case 'adjust': { if (pl.stockItemId) d.movements.push({ outletId: r.outletId, stockItemId: pl.stockItemId, qty: pl.qty, type: r.type === 'waste' ? 'waste' : 'adjust', sourceId: r.id, by: r.decidedBy ?? '', at: now() }); break; }
    case 'supplier': { const s = pl.supplier; if (s) { const i = d.suppliers.findIndex(x => x.id === s.id); if (i >= 0) d.suppliers[i] = s; else d.suppliers.push(s); } break; }
    case 'promo': { const p = pl.promo; if (p) { const i = d.promos.findIndex(x => x.id === p.id); if (i >= 0) d.promos[i] = p; else d.promos.push(p); } break; }
    case 'payroll': { if (Array.isArray(pl.commissionRules)) d.commissionRules = pl.commissionRules; break; }
    case 'perm': { if (pl.employee) { const e = pl.employee; const i = d.employees.findIndex(x => x.id === e.id); if (i >= 0) d.employees[i] = e; else d.employees.push(e); } if (pl.key) d.perms[pl.key] = pl.code; break; }
    case 'asset': case 'expense': case 'transfer': case 'leave': case 'timesheet': case 'budget': { if (pl.rec && pl.object) { const l = d.records[pl.object] ?? (d.records[pl.object] = []); const i = l.findIndex(x => x.id === pl.rec.id); const row = { ...pl.rec, c: 'Approved' }; if (i >= 0) l[i] = row; else l.unshift(row); } break; }
    case 'points': { if (pl.customerId && pl.points < 0 && d.ledger.filter(l => l.customerId === pl.customerId).reduce((a, l) => a + l.points, 0) + pl.points < 0) break; if (pl.customerId) d.ledger.push({ customerId: pl.customerId, points: pl.points, reason: 'Adjustment · ' + r.note, at: now() }); break; }
  }
}

// ── Kitchen ─────────────────────────────────────────────────────────────────────────────
/** Transactional WhatsApp to the guest who left a number on this order (receipt, ready). Once per order + template. */
export function waGuest(d: DB, o: Order, template: 'e_receipt' | 'order_ready') {
  const c = o.customerId ? d.customers.find(x => x.id === o.customerId) : undefined;
  if (!c?.phone || d.messages.some(m => m.orderId === o.id && m.template === template)) return;
  d.messages.unshift({ id: uid('ms'), channel: 'wa', template, to: c.phone, status: 'queued', at: now(), customerId: c.id, orderId: o.id });
}
/** Order ready → floor team + the guest's phone. */
export function orderReady(d: DB, o: Order, roles: Role[] = ['waiter', 'cashier'], suffix = '') {
  o.readyAt = Date.now();
  notify(d, 'Order ready', 'info', roles, o.outletId, `${o.no}${o.table ? ' · ' + o.table : ''} ready${suffix}`);
  if (toolValue(d, 'ready').c_wa) waGuest(d, o, 'order_ready'); // Studios › Order ready › WhatsApp
}
export function bump(orderId: string, station: string | 'all', by: string) {
  commit('ticket.bumped', by, d => {
    const o = findOrder(d, orderId);
    o.lines.forEach(l => { if (l.fired && (station === 'all' || l.station === station)) l.kds = l.kds === 'new' ? 'cooking' : 'done'; });
    if (o.lines.every(l => l.kds === 'done')) {
      if (['sent', 'preparing'].includes(o.status) || (o.status === 'paid' && !o.paidAt)) o.status = 'ready';
      orderReady(d, o);
    } else if (o.status === 'sent') o.status = 'preparing';
  }, orderId);
}
export function bumpDone(orderId: string, by: string) {
  commit('ticket.done', by, d => { const o = findOrder(d, orderId); o.lines.forEach(l => { if (l.fired) l.kds = 'done'; }); if (['sent', 'preparing'].includes(o.status)) o.status = 'ready'; orderReady(d, o); }, orderId);
}
export function recall(orderId: string, by: string) {
  commit('ticket.recalled', by, d => { const o = findOrder(d, orderId); o.lines.forEach(l => { if (l.fired) l.kds = 'cooking'; }); if (o.status === 'ready') o.status = 'preparing'; }, orderId);
}
export function served(orderId: string, by: string) { commit('order.served', by, d => { const o = findOrder(d, orderId); if (o.status === 'ready') o.status = 'served'; }, orderId); }
/** lg-86: per outlet, one shared list for KDS, PIC, POS, QR menu, kiosk, waiter and delivery apps. */
export function toggle86(outletId: string, productId: string, by: string) {
  if (!mayDo(snapshot(), by, 'Mark item sold out', outletId)) return; // 'a' in the matrix: the register asks an approver, the KDS uses ask86
  commit('item.86', by, d => {
    const x = d.outletProducts.find(p => p.productId === productId && p.outletId === outletId); if (!x) return; x.is86 = !x.is86;
    notify(d, x.is86 ? 'Item sold out (86)' : 'Back in stock', 'info', ['cashier', 'kitchen', 'waiter', 'pic'], outletId, `${d.products.find(p => p.id === productId)?.name} ${x.is86 ? 'sold out' : 'available again'} · synced to QR menu, kiosk and delivery apps`);
  }, productId, outletId);
}

// ── Shifts & cash ───────────────────────────────────────────────────────────────────────
/** Opening a drawer clocks the cashier in (with the selfie taken at the gate) unless they already are. */
export function openSession(outletId: string, cashierId: string, float: number, shot: ClockShot = {}) {
  const id = uid('S-'); // unique across registers and devices
  commit('drawer.opened', cashierId, d => {
    d.sessions.forEach(s => { if (s.outletId === outletId && s.cashierId === cashierId && s.status === 'open') s.status = 'counting'; });
    d.sessions.unshift({ id, outletId, cashierId, openedAt: now(), openingFloat: float, closedAt: null, counted: null, variance: null, status: 'open', note: '' });
    const last = d.clock.filter(c => c.employeeId === cashierId && c.outletId === outletId).at(-1);
    if (last?.kind !== 'in' && (shot.photo || !photoRequired(d))) d.clock.push({ id: uid('ck'), employeeId: cashierId, outletId, kind: 'in', at: now(), ...withShot(shot) });
  }, id, outletId);
  return id;
}
export function sessionCash(d: DB, sessionId: string) {
  const s = d.sessions.find(x => x.id === sessionId)!;
  const cash = d.payments.filter(p => p.sessionId === sessionId && p.method === 'cash' && p.status === 'settled');
  const cashSales = cash.reduce((a, p) => a + p.amount, 0), cashTips = cash.reduce((a, p) => a + p.tip, 0);
  const mv = d.cashMoves.filter(c => c.sessionId === sessionId && c.status === 'done');
  const cashIn = mv.filter(c => c.kind === 'in').reduce((a, c) => a + c.amount, 0), cashOut = mv.filter(c => c.kind !== 'in').reduce((a, c) => a + c.amount, 0);
  // cash handed back from this drawer (the refund's drawer, else the drawer that took it); rounding rows move no money
  const cashRefunds = d.refunds.filter(r => { const p = d.payments.find(x => x.id === r.paymentId); return p?.method === 'cash' && p.ref !== 'ROUNDING' && (r.sessionId ?? p.sessionId) === sessionId; }).reduce((a, r) => a + r.amount, 0);
  return { openingFloat: s.openingFloat, cashSales, cashTips, cashIn, cashOut, cashRefunds };
}
export function cashMove(sessionId: string, kind: 'in' | 'out' | 'drop', amount: number, reason: string, by: string) {
  const d0 = snapshot(), s = d0.sessions.find(x => x.id === sessionId)!;
  const id = uid('cm');
  const needs = kind === 'out'; // cashiers approve nothing; cash out starts at the PIC
  commit('cash.' + kind, by, d => { d.cashMoves.unshift({ id, sessionId, outletId: s.outletId, kind, amount, reason, by, at: now(), status: kind === 'out' ? 'waiting' : 'done' }); }, reason, s.outletId);
  if (needs) requestApproval({ type: 'cash_out', title: `Cash out ${idr(amount)} · ${reason}`, amount, requestedBy: by, outletId: s.outletId, subjectId: id });
  return id;
}
export function closeSession(sessionId: string, counted: number, note: string, by: string, shot: ClockShot = {}) {
  const d0 = snapshot(), s = d0.sessions.find(x => x.id === sessionId)!;
  const chk = closeCheck(sessionCash(d0, sessionId), counted, note);
  const countable = (x: { status: string }) => x.status === 'open' || x.status === 'counting'; // counted once: a replay or second close changes nothing
  if (chk.needsNote || !countable(s)) return chk; // a variance always has its reason
  const up = chk.level && chk.level !== 'pic';
  commit('drawer.counted', by, d => {
    const x = d.sessions.find(y => y.id === sessionId)!;
    if (!countable(x)) return;
    Object.assign(x, { counted, variance: chk.variance, note, status: up ? 'needs_approval' : 'closed', closedAt: up ? null : now() });
    if (by === x.cashierId && (shot.photo || !photoRequired(d))) d.clock.push({ id: uid('ck'), employeeId: by, outletId: x.outletId, kind: 'out', at: now(), ...withShot(shot) }); // a PIC counting someone else's drawer stays clocked in
  }, sessionId, s.outletId);
  // neither who ran the drawer nor who counted it signs the variance
  if (chk.level) requestApproval({ type: 'variance', title: `Drawer variance ${idr(chk.variance)} · ${sessionId}`, amount: Math.abs(chk.variance), requestedBy: s.cashierId, countedBy: by, outletId: s.outletId, subjectId: sessionId, note });
  return chk;
}
const withShot = (s: ClockShot): ClockShot => (s.photo ? { photo: s.photo } : { noPhoto: s.noPhoto ?? 'No photo' });
/** Clock in / out carries the selfie (or why there is none); with the photo rule on, no photo is refused. */
export function clock(employeeId: string, outletId: string, kind: 'in' | 'out' | 'break', shot: ClockShot = {}): string | null {
  if (kind !== 'break' && !shot.photo && photoRequired(snapshot())) return 'A photo is needed to clock ' + kind;
  commit('clock.' + kind, employeeId, d => { d.clock.push({ id: uid('ck'), employeeId, outletId, kind, at: now(), ...(kind === 'break' ? {} : withShot(shot)) }); }, employeeId, outletId);
  return null;
}
export function setRosterSlot(outletId: string, day: number, slot: 'pagi' | 'siang' | 'malam', patch: { pic?: string; crew?: string[] }, by: string) {
  commit('roster.updated', by, d => { const r = d.roster.find(x => x.outletId === outletId && x.day === day)!; Object.assign(r.slots[slot], patch); }, `${outletId} day ${day} ${slot}`, outletId);
}

// ── Inventory ───────────────────────────────────────────────────────────────────────────
export function startOpname(outletId: string, area: string, by: string) {
  const id = uid('op'); const d0 = snapshot();
  if (!mayDo(d0, by, 'Count stock (opname)', outletId)) return null;
  commit('opname.started', by, d => {
    d.opnames.unshift({ id, outletId, area, countedBy: by, approvedBy: null, status: 'counting', at: now(), requirePhotoAll: false,
      lines: d0.stockItems.map(s => ({ stockItemId: s.id, systemQty: Math.round(stockLevel(d0.movements, outletId, s.id) * 100) / 100, counted: NaN, unitCost: s.unitCost })) });
  }, area, outletId);
  return id;
}
export function updateOpnameLine(opnameId: string, stockItemId: string, patch: Partial<OpnameLine>, by: string) {
  commit('opname.counted', by, d => { const op = d.opnames.find(x => x.id === opnameId)!; if (op.status !== 'counting' && op.status !== 'recount') return; const l = op.lines.find(x => x.stockItemId === stockItemId)!; if (l.locked) return; Object.assign(l, patch); }, stockItemId);
}
export function submitOpname(opnameId: string, by: string) {
  const op = snapshot().opnames.find(x => x.id === opnameId)!;
  const counted = (l: OpnameLine) => typeof l.counted === 'number' && Number.isFinite(l.counted); // NaN becomes null across tabs (JSON)
  const lines = op.lines.filter(counted);
  commit('opname.submitted', by, d => { const o = d.opnames.find(x => x.id === opnameId)!; o.lines = o.lines.filter(counted).map(l => ({ ...l, locked: true })); o.status = 'locked'; }, opnameId, op.outletId);
  const value = lines.reduce((a, l) => a + Math.abs((l.counted - l.systemQty) * l.unitCost), 0);
  return requestApproval({ type: 'opname', title: `Opname ${op.area} · variance ${idr(Math.round(value))}`, amount: Math.round(value), requestedBy: by, countedBy: by, outletId: op.outletId, subjectId: opnameId, note: `${lines.length} lines counted · approver ${opnameApprover(lines)}` });
}
export function receivePO(poId: string, received: Record<string, number>, by: string) {
  commit('po.received', by, d => {
    const po = d.pos.find(x => x.id === poId)!;
    if (po.status !== 'sent' && po.status !== 'partial') return; // only an approved, open PO takes goods
    po.lines.forEach(l => { const q = received[l.stockItemId] ?? 0; if (q > 0) { l.received += q; d.movements.push({ outletId: po.outletId, stockItemId: l.stockItemId, qty: q, type: 'receipt', sourceId: po.id, by, at: now() }); } });
    po.status = po.lines.every(l => l.received >= l.qty) ? 'received' : 'partial';
  }, poId);
}
export function createPO(supplierId: string, outletId: string, lines: { stockItemId: string; qty: number; price: number }[], by: string) {
  const d0 = snapshot(); const no = 'PO-0' + d0.counters.po; const id = uid('po');
  const total = lines.reduce((a, l) => a + l.qty * l.price, 0);
  commit('po.created', by, d => { d.counters.po++; d.pos.unshift({ id, no, supplierId, outletId, lines: lines.map(l => ({ ...l, received: 0 })), status: 'waiting', due: now() + 3 * 864e5, createdBy: by, at: now() }); }, no, outletId);
  const role = emp(d0, by)?.role;
  if (role === 'owner') commit('po.sent', by, d => { d.pos.find(x => x.id === id)!.status = 'sent'; }, no);
  else requestApproval({ type: 'po', title: `${no} · ${d0.suppliers.find(s => s.id === supplierId)?.name}`, amount: total, requestedBy: by, outletId, subjectId: id });
  return id;
}
export function stockEntry(kind: 'waste' | 'adjust', outletId: string, stockItemId: string, qty: number, reason: string, by: string) {
  const it = snapshot().stockItems.find(s => s.id === stockItemId)!;
  return requestApproval({ type: kind, title: `${kind === 'waste' ? 'Waste' : 'Adjustment'} · ${it.name} ${qty} ${it.unit} · ${reason}`, amount: Math.abs(Math.round(qty * it.unitCost)), requestedBy: by, outletId, payload: { stockItemId, qty: kind === 'waste' ? -Math.abs(qty) : qty }, note: reason });
}

// ── Catalog ─────────────────────────────────────────────────────────────────────────────
export function saveProduct(p: Product, by: string) {
  const d0 = snapshot(), e = emp(d0, by), role = e?.role, was = d0.products.find(x => x.id === p.id);
  if (role !== 'owner') {
    // Menu scope: only the owner sets base prices and puts items live. A manager edits their own local items; new ones are local and wait for the owner.
    if (was && !(was.scope === 'local' && e?.outlets.includes(was.ownerOutletId ?? ''))) return 'Global items are changed by the owner. Hide it here or mark it sold out.';
    if (was) { const price = p.basePrice; p = { ...p, basePrice: was.basePrice, scope: was.scope, ownerOutletId: was.ownerOutletId, status: was.status === 'archived' ? was.status : p.status === 'archived' ? 'archived' : was.status }; if (price !== was.basePrice) requestPrice(p.id, price, by); }
    else { if (!d0.tenant.locks.outletOnlyItems) return 'Outlet-only items are turned off by the owner'; p = { ...p, scope: 'local', status: 'pending_owner', ownerOutletId: e?.outlets.includes(p.ownerOutletId ?? '') ? p.ownerOutletId : e?.outlets[0] ?? null }; }
  }
  commit('product.saved', by, d => {
    const i = d.products.findIndex(x => x.id === p.id);
    if (i >= 0) d.products[i] = p; else {
      d.products.push(p);
      d.outlets.forEach(o => { if (p.scope === 'global' || p.ownerOutletId === o.id) d.outletProducts.push({ productId: p.id, outletId: o.id, localPrice: null, is86: false, hidden: false }); });
    }
  }, p.name);
  if (role !== 'owner' && !was && p.status === 'pending_owner') requestApproval({ type: 'local_item', title: `New local item · ${p.name} · ${idr(p.basePrice)}`, amount: p.basePrice, requestedBy: by, outletId: p.ownerOutletId ?? 'sen', subjectId: p.id, payload: { promote: p.promoteRequested } });
  return null;
}
export function requestPrice(productId: string, price: number, by: string, outletId?: string) {
  const d0 = snapshot(), p = d0.products.find(x => x.id === productId)!;
  if (emp(d0, by)?.role === 'owner') { commit('price.changed', by, d => { const x = d.products.find(y => y.id === productId)!; if (outletId) { const op = d.outletProducts.find(y => y.productId === productId && y.outletId === outletId); if (op) op.localPrice = price; } else x.basePrice = price; }, p.name); return null; }
  return requestApproval({ type: 'price', title: `Price ${p.name} ${idr(p.basePrice)} → ${idr(price)}`, amount: price, requestedBy: by, outletId: outletId ?? 'sen', subjectId: productId, payload: { price, outletId } });
}

// ── Customers & loyalty ─────────────────────────────────────────────────────────────────
const phoneKey = (s: string) => s.replace(/\D/g, '').replace(/^62/, '0');
/** One member per phone across every outlet: an existing number returns that member (no second welcome beans). */
export function addCustomer(name: string, phone: string, by: string, optIn = true) {
  const k = phoneKey(phone), found = k.length >= 9 ? snapshot().customers.find(c => phoneKey(c.phone) === k) : undefined;
  if (found) return found.id;
  const id = uid('c');
  commit('customer.created', by, d => { d.customers.push({ id, name, phone, email: '', joinedAt: now(), optIn, credit: 0, deposit: 0 }); if (has(d.tenant.plan, 'loyalty')) d.ledger.push({ customerId: id, points: 50, reason: 'Welcome beans', at: now() }); }, name);
  return id;
}
export function redeem(customerId: string, cost: number, reward: string, by: string): string | null {
  if (!Number.isInteger(cost) || cost <= 0) return 'A reward costs a whole number of beans';
  if (!has(snapshot().tenant.plan, 'loyalty')) return 'Beans are on the Basic plan';
  if (!canRedeem(snapshot().ledger, customerId, cost)) return 'Not enough beans';
  commit('points.redeemed', by, d => { d.ledger.push({ customerId, points: -cost, reason: 'Redeem · ' + reward, at: now() }); }, reward);
  return null;
}
export function replyReview(id: string, reply: string, by: string) { commit('review.replied', by, d => { d.reviews.find(r => r.id === id)!.reply = reply; }, id); }
export function rateOrder(orderId: string, stars: number, text = '') {
  commit('review.created', 'guest', d => {
    const o = findOrder(d, orderId); o.rating = stars;
    d.reviews.unshift({ id: uid('rv'), outletId: o.outletId, customerId: o.customerId, name: d.customers.find(c => c.id === o.customerId)?.name.split(' ')[0] ?? 'Guest', stars, text, at: now(), reply: null, orderId });
    // the beans the feedback page promises (Menu Studio), once per order, to the member who ordered
    const beans = feedbackBeans(d);
    if (beans > 0 && o.customerId && has(d.tenant.plan, 'loyalty') && !d.ledger.some(l => l.orderId === o.id && l.reason === 'Feedback')) d.ledger.push({ customerId: o.customerId, points: beans, reason: 'Feedback', orderId: o.id, at: now() });
  }, orderId);
}

// ── Online & delivery (incoming only) ───────────────────────────────────────────────────
/** Ready-by is calculated from tier + channel prep + kitchen load, never typed (Online Orders). */
export const readyBy = (tier: 'rush' | 'standard' | 'saver', source: Source, openTickets: number, at = now()) =>
  at + ((tier === 'rush' ? 10 : tier === 'standard' ? 18 : 30) + (source === 'web' ? 2 : 4) + Math.min(20, openTickets)) * 60e3;
export function simulatePlatformOrder(outletId: string, source: Source = 'gofood') {
  const d0 = snapshot(), r = Math.random;
  const ok = sellable(d0, outletId); // the platform menu is synced: no 86'd, hidden or other-branch items
  const ps = d0.products.filter(p => ok(p.id)).sort(() => r() - .5).slice(0, 1 + Math.floor(r() * 3));
  const tier = (['rush', 'standard', 'saver'] as const)[Math.floor(r() * 3)];
  const load = d0.orders.filter(o => o.outletId === outletId && ['sent', 'preparing'].includes(o.status)).length;
  const id = newOrder(outletId, source, source, { type: 'delivery', status: 'open', tier, readyBy: readyBy(tier, source, load) });
  ps.forEach(p => addLine(id, p.id, [], 1, '', source));
  // the platform charged its own menu price (base + channel markup from Menu Studio); the bill shows what the platform sold
  commit('online.priced', source, d => { const o = findOrder(d, id); o.lines.forEach(l => { l.unitPrice = channelPrice(d, l.unitPrice, source); }); recalc(d, o); }, id);
  commit('online.received', source, d => notify(d, 'New online order', 'warn', ['cashier', 'pic'], outletId, `${source} order ${findOrder(d, id).no} waiting to be accepted`, '/pos/selling/ride-hailing-orders-inbox'));
  return id;
}
/** The first customer receipt of a bill was printed (on any device): every later print says COPY. */
export function markReceiptPrinted(orderId: string, by: string) {
  if (snapshot().orders.find(o => o.id === orderId)?.printedAt) return;
  commit('receipt.printed', by, d => { const o = findOrder(d, orderId); o.printedAt ??= now(); }, orderId);
}
export function acceptOnline(orderId: string, by: string) { sendToKitchen(orderId, by); commit('online.accepted', by, d => { const o = findOrder(d, orderId); o.cashierId = by; }, orderId); }
export function rejectOnline(orderId: string, reason: string, by: string) { commit('online.rejected', by, d => { const o = findOrder(d, orderId); o.status = 'voided'; o.note = 'Rejected: ' + reason; }, orderId); }
export function pickedUp(orderId: string, by: string) {
  commit('online.picked_up', by, d => {
    const o = findOrder(d, orderId); if (o.paidAt) return;
    d.payments.push({ id: uid('pay'), orderId, outletId: o.outletId, method: 'ewallet', amount: o.total, tip: 0, status: 'settled', ref: o.source.toUpperCase(), at: now(), expiresAt: null, sessionId: o.sessionId });
    settleIfDone(d, o, by); // paid → recipe stock deducted like every other sale
  }, orderId);
}

// ── Studios & settings ──────────────────────────────────────────────────────────────────
/** Owner publishes; manager "Send to owner" creates a publish approval (lg-menu). */
export function publish(kind: 'menu' | 'brand' | 'page', data: unknown, by: string, note = '') {
  const id = uid('v'); const role = emp(snapshot(), by)?.role;
  commit('publish.' + (role === 'owner' ? 'done' : 'requested'), by, d => {
    d.versions.unshift({ id, kind, by, at: now(), status: role === 'owner' ? 'published' : 'pending_owner', data, note });
    if (role === 'owner') { if (kind === 'menu') Object.assign(d.theme, data); if (kind === 'brand') Object.assign(d.staffBrand, data); }
  }, kind);
  if (role !== 'owner') requestApproval({ type: 'publish', title: `Publish ${kind} · ${note || 'theme update'}`, requestedBy: by, outletId: 'sen', subjectId: id });
  return role === 'owner';
}
export function setPerm(action: string, code: string, by: string) { commit('perms.changed', by, d => { d.perms[action] = code; }, action); }
export function setDeviceOnline(online: boolean) { commit(online ? 'device.online' : 'device.offline', 'device', d => { d.device.online = online; }); }
export function setDeviceOutlet(outletId: string) { commit('device.outlet', 'device', d => { d.device.outletId = outletId; }); }
export function markRead(id: string | 'all', by: string) { commit('notice.read', by, d => { d.notices.forEach(n => { if (id === 'all' || n.id === id) n.read = true; }); }); }
export function setLocks(patch: Partial<DB['tenant']['locks']>, by: string) { commit('locks.changed', by, d => { Object.assign(d.tenant.locks, patch); }); }

// Generic records for back-office objects without their own table yet.
export function saveRecord(object: string, row: Rec, by: string) { commit(object + '.saved', by, d => { const l = d.records[object] ?? (d.records[object] = []); const i = l.findIndex(x => x.id === row.id); if (i >= 0) l[i] = row; else l.unshift(row); }, row.a); }
export function deleteRecord(object: string, id: string, by: string) { commit(object + '.deleted', by, d => { d.records[object] = (d.records[object] ?? []).filter(x => x.id !== id); }, id); }
export function seedRecords(object: string, rows: Rec[]) { if (!snapshot().records[object]) commit(object + '.seeded', 'system', d => { d.records[object] = rows; }); }
export function setSetting(key: string, value: boolean | string | number, by: string) { commit('setting.changed', by, d => { d.settings[key] = value; }, key); }

// ── Back-office records with their own tables ───────────────────────────────────────────
export function saveSupplier(s: DB['suppliers'][0], by: string) {
  const role = emp(snapshot(), by)?.role;
  if (role !== 'owner') return requestApproval({ type: 'supplier', title: `Supplier · ${s.name}`, requestedBy: by, outletId: 'sen', payload: { supplier: s } });
  commit('supplier.saved', by, d => { const i = d.suppliers.findIndex(x => x.id === s.id); if (i >= 0) d.suppliers[i] = s; else d.suppliers.push(s); }, s.name);
  return null;
}
export function saveEmployee(e: DB['employees'][0], by: string) {
  const role = emp(snapshot(), by)?.role;
  if (e.role === 'manager' && role !== 'owner') return requestApproval({ type: 'perm', title: `Make ${e.name} a manager`, requestedBy: by, outletId: e.outlets[0] ?? 'sen', payload: { employee: e } });
  commit('employee.saved', by, d => { const i = d.employees.findIndex(x => x.id === e.id); if (i >= 0) d.employees[i] = e; else d.employees.push(e); }, e.name, e.outlets[0]);
  return null;
}
export function saveReservation(r: DB['reservations'][0], by: string) { commit('reservation.saved', by, d => { const i = d.reservations.findIndex(x => x.id === r.id); if (i >= 0) d.reservations[i] = r; else d.reservations.push(r); }, r.name, r.outletId); }
export function savePromo(p: DB['promos'][0], by: string) {
  if (emp(snapshot(), by)?.role !== 'owner') return requestApproval({ type: 'promo', title: `Promo · ${p.name}`, requestedBy: by, outletId: 'sen', payload: { promo: p } });
  commit('promo.saved', by, d => { const i = d.promos.findIndex(x => x.id === p.id); if (i >= 0) d.promos[i] = p; else d.promos.push(p); }, p.name);
  return null;
}
export function patchOutlet(id: string, patch: Partial<DB['outlets'][0]>, by: string) { commit('outlet.updated', by, d => { Object.assign(d.outlets.find(o => o.id === id)!, patch); }, id, id); }
export function setStation(categoryId: string, station: DB['categories'][0]['station'], by: string) { commit('routing.changed', by, d => { d.categories.find(c => c.id === categoryId)!.station = station; }, categoryId); }
export function resendMessage(id: string, by: string) { commit('message.resent', by, d => { const m = d.messages.find(x => x.id === id); if (m) { m.status = 'sent'; m.at = now(); } }, id); }
export function archiveProduct(productId: string, by: string) {
  const d0 = snapshot(), p = d0.products.find(x => x.id === productId)!, e = emp(d0, by);
  if (e?.role !== 'owner' && !(p.scope === 'local' && e?.role === 'manager' && e.outlets.includes(p.ownerOutletId ?? ''))) return 'Outlets can’t delete a global item. Hide it at your outlet or mark it sold out.';
  commit('product.archived', by, d => { d.products.find(x => x.id === productId)!.status = 'archived'; }, p.name);
  return null;
}
export function hideAtOutlet(productId: string, outletId: string, hidden: boolean, by: string) { commit('product.hidden', by, d => { const x = d.outletProducts.find(y => y.productId === productId && y.outletId === outletId); if (x) x.hidden = hidden; }, productId, outletId); }
export function saveModifierGroup(g: DB['modifierGroups'][0], by: string) { commit('modifier.saved', by, d => { const i = d.modifierGroups.findIndex(x => x.id === g.id); if (i >= 0) d.modifierGroups[i] = g; else d.modifierGroups.push(g); }, g.name); }
/** Escalation ladder for unanswered requests: PIC 5 min → manager 30 min → owner (lg-approval, Alerts). Idempotent. */
/** Kitchen tickets past 12 minutes → "Order late" once per ticket (KDS turns amber at 8). */
export function watchKitchen(at = now()) {
  const d0 = snapshot(), late = d0.orders.filter(o => o.lines.some(l => l.fired && l.kds !== 'done' && l.firedAt && at - l.firedAt > 12 * 60e3)
    && !d0.notices.some(n => n.alert === 'Order late' && n.text.startsWith(o.no + ' ')));
  if (late.length) commit('kitchen.late', 'system', d => late.forEach(o => notify(d, 'Order late', 'warn', ['kitchen', 'pic'], o.outletId, `${o.no} · ${o.table ?? o.source} · over 12 min`, '/kds')));
}
export function escalateDue(at = now()) {
  if (!escalationOn(snapshot())) return; // owner switched 'Escalate when unanswered' off
  const due = snapshot().approvals.filter(a => a.status === 'waiting' && ((a.level === 'pic' && at - a.at > 5 * 60e3) || (a.level === 'manager' && at - a.at > 35 * 60e3)));
  if (!due.length) return;
  commit('approval.escalated', 'system', d => due.forEach(x => { const r = d.approvals.find(y => y.id === x.id)!; r.level = r.level === 'pic' ? 'manager' : 'owner'; notify(d, 'Approval not answered', 'warn', [r.level], r.outletId, `${r.title} unanswered · now with the ${r.level}`); }));
}
