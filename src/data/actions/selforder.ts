'use client';
// Guest services for the QR menu, kiosk and customer links. Writes only through commit(); order and payment
// writes reuse the shared service layer (newOrder, addLine, startPayment …) in ../actions.ts.
import { commit, snapshot, uid } from '../store.ts';
import type { DB, Order } from '../schema.ts';
import { addCustomer, newOrder, notify, patchOrder, startPayment } from '../actions.ts';
import { awardReferral } from './business.ts';
import { giftCardOf, referralOffer } from '../../system/studio.ts';
import { allocate, splitEqual } from '../../domain/split.ts';
import { lineTotal } from '../../domain/order.ts';
import { tablesOf } from '../../domain/tables.ts';

const now = () => Date.now();
const notice = notify; // one alert engine (actions.ts)

export const digits = (s: string) => s.replace(/\D/g, '').replace(/^62/, '0');
export const findCustomer = (d: DB, phone: string) => { const p = digits(phone); return p.length >= 9 ? d.customers.find(c => digits(c.phone) === p) : undefined; };
/** Existing member by phone, or a new one (welcome beans come from addCustomer). */
export function findOrJoin(name: string, phone: string, optIn = true, ref?: string | null): { id: string; created: boolean } {
  const c = findCustomer(snapshot(), phone);
  if (c) return { id: c.id, created: false };
  const id = addCustomer(name.trim() || 'Guest', phone.trim(), 'guest', optIn);
  if (ref) awardReferral(id, ref); // joined from a member's invite link (Referral program)
  return { id, created: true };
}

/** Alert "New QR / kiosk / online order" → cashier and PIC (the KDS reads the fired lines itself). */
export function orderPlaced(orderId: string, payLater: boolean) {
  commit('guest.order_placed', 'guest', d => {
    const o = d.orders.find(x => x.id === orderId); if (!o) return;
    notice(d, 'New QR / kiosk / online order', payLater ? 'warn' : 'info', ['cashier', 'pic'], o.outletId,
      `${o.no}${o.table ? ' · ' + o.table : ''} · ${o.source === 'kiosk' ? 'kiosk' : 'QR menu'}${payLater ? ' · pay at cashier' : ' · paid'}`, '/pos/selling/online-and-qr-orders-inbox');
  }, orderId);
}
/** Alert "Guest call" (call waiter, bill, water …) → waiter, then PIC. */
export function guestCall(outletId: string, table: string, request: string) {
  commit('guest.call', 'guest', d => notice(d, 'Guest call', request === 'Ask for the bill' ? 'warn' : 'info', ['waiter', 'pic'], outletId, `${table} · ${request}`, '/waiter'), table, outletId);
}
export function bookTable(r: { outletId: string; name: string; phone: string; at: number; guests: number; note: string }) {
  const id = uid('rs');
  commit('reservation.created', 'guest', d => {
    const out = d.outlets.find(o => o.id === r.outletId)!;
    const busy = new Set(d.reservations.filter(x => x.outletId === r.outletId && x.status === 'booked' && Math.abs(x.at - r.at) < 2 * 3600e3).map(x => x.table));
    // the smallest free table that seats the party, else any free table
    const ts = tablesOf(out), free = ts.filter(t => !busy.has(t.name));
    const table = (free.filter(t => t.seats >= r.guests).sort((a, b) => a.seats - b.seats)[0] ?? free[0] ?? ts[0])?.name ?? 'T-01';
    d.reservations.push({ id, outletId: r.outletId, name: r.name, phone: r.phone, at: r.at, guests: r.guests, table, status: 'booked', deposit: 0 });
    notice(d, 'New reservation', r.guests > 20 ? 'warn' : 'info', ['manager', 'pic'], r.outletId, `${r.name} · ${r.guests} guests · ${new Date(r.at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${r.note ? ' · ' + r.note : ''}`);
  }, r.name, r.outletId);
  return id;
}
export function setOptIn(customerId: string, optIn: boolean) {
  commit(optIn ? 'customer.opted_in' : 'customer.opted_out', 'guest', d => { const c = d.customers.find(x => x.id === customerId); if (c) c.optIn = optIn; }, customerId);
}
// ── Gift cards (Menu Studio › gift card designer) ─────────────────────────────────────────
/** A guest buys a gift card for a friend: a QR order for the amount (no PB1, no kitchen), paid by QRIS. When the gateway
 *  settles it, settleIfDone puts the balance on the friend's member account. */
export function buyGiftCard(outletId: string, amount: number, to: { name: string; phone: string }, message: string) {
  const gc = giftCardOf(snapshot());
  if (!gc.amounts.includes(amount)) throw new Error('Pick one of the gift card amounts.');
  if (digits(to.phone).length < 9) throw new Error('Enter your friend’s WhatsApp number.');
  const friend = findOrJoin(to.name, to.phone, true);
  const orderId = newOrder(outletId, 'guest', 'qr', { type: 'take', subtotal: amount, total: amount, note: `Gift card · ${gc.title}` });
  commit('giftcard.ordered', 'guest', d => { (d.records.gift_cards ??= []).unshift({ id: uid('gc'), a: orderId, b: friend.id, c: String(amount), d: message.trim(), e: 'pending', at: now() }); }, orderId, outletId);
  try { return { orderId, paymentId: startPayment(orderId, 'qris', amount, 'guest') }; } catch (e) { cancelGiftCard(orderId); throw e; }
}
export function cancelGiftCard(orderId: string) {
  commit('giftcard.cancelled', 'guest', d => {
    const o = d.orders.find(x => x.id === orderId); if (!o || o.paidAt) return;
    d.payments.filter(p => p.orderId === orderId && p.status === 'pending').forEach(p => { p.status = 'failed'; });
    o.status = 'voided'; (d.records.gift_cards ?? []).filter(r => r.a === orderId).forEach(r => { r.e = 'cancelled'; });
  }, orderId);
}

// ── Split the bill from phones (Menu Studio › split bill) ──────────────────────────────
// records.bill_split: a order · b equal|items · c people.  records.bill_share: a order · b payment · c part ("part:0" or line ids) · d amount
export type SplitMode = 'equal' | 'items';
const LIVE = ['pending', 'settled'];
/** The table's split and every share still counting (pending or paid), with its payment state. */
export function billSplit(d: DB, orderId: string) {
  const plan = (d.records.bill_split ?? []).find(r => r.a === orderId);
  const shares = (d.records.bill_share ?? []).filter(r => r.a === orderId).flatMap(r => { const p = d.payments.find(x => x.id === r.b);
    return p && LIVE.includes(p.status) ? [{ key: r.c, amount: Number(r.d), paymentId: p.id, paid: p.status === 'settled', tip: p.tip }] : []; });
  return { mode: (plan?.b ?? null) as SplitMode | null, n: Number(plan?.c ?? 0), shares };
}
/** Share amounts: equal parts, or each line's part of the bill (tax, service and discounts included). Sum = bill total. */
export function shareAmounts(o: Order, mode: SplitMode, n: number): number[] {
  return mode === 'equal' ? splitEqual(o.total, n) : allocate(o.total, o.lines.map(l => lineTotal({ unitPrice: l.unitPrice, flashPrice: l.flashPrice, modifiers: l.mods.map(m => m.price), qty: l.qty, discountPct: l.discountPct })));
}
/** One phone pays its share by QRIS. The plan is fixed once a share is paying; the bill is paid when the shares cover it. */
export function payShare(orderId: string, mode: SplitMode, n: number, key: string, amount: number, tip = 0) {
  const cur = billSplit(snapshot(), orderId);
  if (cur.shares.length && (cur.mode !== mode || cur.n !== n)) throw new Error('Your table already split this bill another way. Refresh to see it.');
  if (cur.shares.some(s => s.key === key || (mode === 'items' && s.key.split(',').some(l => key.split(',').includes(l))))) throw new Error('Someone at the table is already paying that part.');
  const pay = startPayment(orderId, 'qris', amount, 'guest', tip);
  commit('bill.share', 'guest', d => {
    const plan = (d.records.bill_split ??= []).find(r => r.a === orderId);
    if (plan) { plan.b = mode; plan.c = String(n); } else d.records.bill_split.unshift({ id: uid('bs'), a: orderId, b: mode, c: String(n), d: '', e: '', at: now() });
    (d.records.bill_share ??= []).unshift({ id: uid('sh'), a: orderId, b: pay, c: key, d: String(amount), e: '', at: now() });
  }, orderId);
  return pay;
}

// ── Referral (Menu Studio › referral page) ───────────────────────────────────────────────
/** "10% off first order" for a friend who joined from an invite: applied to their open bill until their first order is paid. */
export function referralWelcome(orderId: string) {
  const d0 = snapshot(), o = d0.orders.find(x => x.id === orderId), pct = referralOffer(d0).friendPct;
  if (!o || !pct || o.discountPct || !(d0.records.referrals ?? []).some(r => r.a === o.customerId && r.e === 'joined')) return 0;
  patchOrder(orderId, { discountPct: pct }, 'guest');
  return pct;
}
/** What is left to pay on a bill right now (after a discount just applied). */
export const dueOf = (orderId: string) => { const d = snapshot(), o = d.orders.find(x => x.id === orderId); return o ? o.total - d.payments.filter(p => p.orderId === o.id && p.status === 'settled').reduce((a, p) => a + p.amount, 0) : 0; };

/** Saves a voucher to the member's card (records.voucher_claims: a = promo, b = customer). */
export function claimVoucher(customerId: string, promoId: string) {
  commit('voucher.claimed', 'guest', d => {
    const l = d.records.voucher_claims ?? (d.records.voucher_claims = []);
    if (!l.some(x => x.a === promoId && x.b === customerId)) l.unshift({ id: uid('vc'), a: promoId, b: customerId, c: '', d: '', e: '', at: now() });
  }, promoId);
}
