'use client';
// Register-only services (POS surface). Built on the shared service layer: order math always goes through patchOrder
// (recalc), payments through startPayment / gatewayWebhook, approvals through requestApproval / decide.
import { commit, snapshot, uid } from '../store.ts';
import { CLOSED, gatewayWebhook, newOrder, patchOrder, startPayment } from '../actions.ts';
import type { Approval, Device, OrderLine } from '../schema.ts';

const now = () => Date.now();
const order = (id: string) => snapshot().orders.find(o => o.id === id);

/** Payload the register attaches to approvals it applies itself (line-level changes, manual confirmation). */
export type PosPayload =
  | { pos: 'line_discount'; orderId: string; lineId: string; pct: number; applied?: boolean }
  | { pos: 'line_price'; orderId: string; lineId: string; price: number; applied?: boolean }
  | { pos: 'manual_payment'; paymentId: string; applied?: boolean };

/** Open item / weighed item: a line with no catalog product, so no recipe deduction. */
export function addOpenLine(orderId: string, name: string, unitPrice: number, by: string, opts: { qty?: number; note?: string; station?: OrderLine['station'] } = {}) {
  const o = order(orderId); if (!o) return;
  const line: OrderLine = { id: uid('l'), productId: 'open', name, qty: opts.qty ?? 1, unitPrice, flashPrice: null, mods: [], note: opts.note ?? '', discountPct: 0, station: opts.station ?? 'bar', kds: 'new', fired: false };
  patchOrder(orderId, { lines: [...o.lines, line] }, by);
}
export function patchLine(orderId: string, lineId: string, patch: Partial<OrderLine>, by: string) {
  const o = order(orderId); if (!o) return;
  patchOrder(orderId, { lines: o.lines.map(l => l.id === lineId ? { ...l, ...patch } : l) }, by);
}
/** Redeem a free item: one unit of the line becomes a separate 100%-discounted line. */
export function freeOneUnit(orderId: string, lineId: string, note: string, by: string) {
  const o = order(orderId); const l = o?.lines.find(x => x.id === lineId); if (!o || !l) return;
  const free: OrderLine = { ...l, id: uid('l'), qty: 1, discountPct: 100, note: [l.note, note].filter(Boolean).join(' · ') };
  const rest = l.qty > 1 ? [{ ...l, qty: l.qty - 1 }] : [];
  patchOrder(orderId, { lines: o.lines.flatMap(x => x.id === lineId ? [...rest, free] : [x]) }, by);
}

/** Split selected lines to a new bill on the same table. Returns the new order id. */
export function splitToNewBill(orderId: string, lineIds: string[], by: string) {
  const o = order(orderId)!;
  const moved = o.lines.filter(l => lineIds.includes(l.id));
  const id = newOrder(o.outletId, by, 'pos', { type: o.type, table: o.table, guests: 1, sessionId: o.sessionId, customerId: null });
  patchOrder(id, { lines: moved.map(l => (l.fired ? { ...l, movedFrom: l.movedFrom ?? orderId } : l)), status: moved.some(l => l.fired) ? 'sent' : 'open' }, by); // printed on the old bill
  patchOrder(orderId, { lines: o.lines.filter(l => !lineIds.includes(l.id)) }, by);
  return id;
}
/** Merge another open bill into this one. The emptied bill is closed with a note (value 0, nothing voided). */
export function mergeBills(targetId: string, sourceId: string, by: string) {
  const t = order(targetId)!, s = order(sourceId)!;
  patchOrder(targetId, { lines: [...t.lines, ...s.lines.map(l => (l.fired ? { ...l, movedFrom: l.movedFrom ?? sourceId } : l))], guests: t.guests + s.guests, status: t.status === 'open' && s.lines.some(l => l.fired) ? 'sent' : t.status }, by);
  patchOrder(sourceId, { lines: [], status: 'voided', note: `Merged into ${t.no}` }, by);
}

/** Cash with rounding (lg-total: rounding is its own line, applied last). A round-down is booked off-drawer so the order
 *  settles at its total while the drawer only expects the cash that was actually taken. */
export function payCash(orderId: string, due: number, remaining: number, by: string, tip = 0) {
  const o = order(orderId)!;
  if (CLOSED.includes(o.status)) throw new Error(`${o.no} is already closed (${o.status}). Nothing was charged.`);
  const down = remaining - due;
  if (down > 0) commit('payment.rounding', by, d => {
    d.payments.push({ id: uid('pay'), orderId, outletId: o.outletId, method: 'cash', amount: down, tip: 0, status: 'settled', ref: 'ROUNDING', at: now(), expiresAt: null, sessionId: null });
  }, orderId, o.outletId);
  return startPayment(orderId, 'cash', due, by, tip);
}

/** Applies an approved register request once (only the requesting register runs this). */
export function applyPosApproval(a: Approval, by: string) {
  const pl = a.payload as PosPayload | undefined;
  if (!pl?.pos || pl.applied || a.status !== 'approved') return;
  commit('approval.applied', by, d => { const r = d.approvals.find(x => x.id === a.id); if (r) r.payload = { ...r.payload, applied: true }; }, a.title, a.outletId);
  if (pl.pos === 'line_discount') patchLine(pl.orderId, pl.lineId, { discountPct: pl.pct }, by);
  if (pl.pos === 'line_price') patchLine(pl.orderId, pl.lineId, { unitPrice: pl.price, flashPrice: null }, by);
  if (pl.pos === 'manual_payment') gatewayWebhook(pl.paymentId, 'settled');
}

/** Device actions that only need an audit trail (prints, test pulses, no-sale drawer opens). */
export function logDevice(action: string, subject: string, by: string, outletId?: string) { commit(action, by, () => {}, subject, outletId); }

export function sendReceipt(orderId: string, channel: 'wa' | 'email', to: string, by: string, template = 'e_receipt') {
  const o = order(orderId);
  commit('receipt.sent', by, d => { d.messages.unshift({ id: uid('ms'), channel, template, to, status: 'queued', at: now(), customerId: o?.customerId ?? null }); }, o?.no ?? orderId, o?.outletId);
}

export function setReservation(id: string, status: 'booked' | 'seated' | 'cancelled' | 'no_show', by: string) {
  commit('reservation.' + status, by, d => { const r = d.reservations.find(x => x.id === id); if (r) r.status = status; }, id);
}
export function addWalkIn(outletId: string, name: string, phone: string, guests: number, by: string) {
  commit('reservation.walk_in', by, d => { d.reservations.push({ id: uid('rs'), outletId, name, phone, at: now(), guests, table: '', status: 'booked', deposit: 0 }); }, name, outletId);
}

export function setDeviceStatus(deviceId: string, status: Device['status'], by: string) {
  commit('device.' + status, by, d => { const x = d.devices.find(y => y.id === deviceId); if (x) { x.status = status; if (status === 'online') x.lastSeen = now(); } }, deviceId);
}
export function addDevice(outletId: string, kind: Device['kind'], name: string, by: string) {
  const id = uid('d');
  commit('device.added', by, d => { d.devices.push({ id, outletId, kind, name, lastSeen: now(), pairCode: null, status: 'online' }); }, name, outletId);
  return id;
}

/** lg-sync: while offline, register writes also land in the device queue; going online drains it. */
export function enqueue(action: string) {
  if (snapshot().device.online) return;
  commit('sync.queued', 'device', d => { d.device.queue.push({ id: uid('q'), action, at: now() }); });
}
export function flushQueue(by: string) {
  const n = snapshot().device.queue.length;
  if (n) commit('sync.flushed', by, d => { d.device.queue = []; }, n + ' queued actions');
  return n;
}
