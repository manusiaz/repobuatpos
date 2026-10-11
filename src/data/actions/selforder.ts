'use client';
// Guest services for the QR menu, kiosk and customer links. Writes only through commit(); order and payment
// writes reuse the shared service layer (newOrder, addLine, startPayment …) in ../actions.ts.
import { commit, snapshot, uid } from '../store.ts';
import type { DB } from '../schema.ts';
import { addCustomer, notify } from '../actions.ts';
import { awardReferral } from './business.ts';

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
    const table = Array.from({ length: out.tables }, (_, i) => 'T-' + String(i + 1).padStart(2, '0')).find(t => !busy.has(t)) ?? 'T-01';
    d.reservations.push({ id, outletId: r.outletId, name: r.name, phone: r.phone, at: r.at, guests: r.guests, table, status: 'booked', deposit: 0 });
    notice(d, 'New reservation', r.guests > 20 ? 'warn' : 'info', ['manager', 'pic'], r.outletId, `${r.name} · ${r.guests} guests · ${new Date(r.at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${r.note ? ' · ' + r.note : ''}`);
  }, r.name, r.outletId);
  return id;
}
export function setOptIn(customerId: string, optIn: boolean) {
  commit(optIn ? 'customer.opted_in' : 'customer.opted_out', 'guest', d => { const c = d.customers.find(x => x.id === customerId); if (c) c.optIn = optIn; }, customerId);
}
/** Saves a voucher to the member's card (records.voucher_claims: a = promo, b = customer). */
export function claimVoucher(customerId: string, promoId: string) {
  commit('voucher.claimed', 'guest', d => {
    const l = d.records.voucher_claims ?? (d.records.voucher_claims = []);
    if (!l.some(x => x.a === promoId && x.b === customerId)) l.unshift({ id: uid('vc'), a: promoId, b: customerId, c: '', d: '', e: '', at: now() });
  }, promoId);
}
