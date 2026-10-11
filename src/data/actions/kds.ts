'use client';
// Kitchen services the shared layer doesn't cover yet: bump per station to done in one tap, item-level done,
// runner calls to the waiter phone. Same ready rules as bump() in actions.ts.
import { commit, snapshot } from '../store.ts';
import type { DB, Order, OrderLine } from '../schema.ts';
import { addLine, newOrder, requestApproval, sendToKitchen, toggle86 } from '../actions.ts';

const findOrder = (d: DB, id: string) => d.orders.find(o => o.id === id);
/** One alert engine: recipients from the alert catalog (actions.ts notify). */
import { notify as notice } from '../actions.ts';
export { notice };
const label = (o: Order) => `${o.no}${o.table ? ' · ' + o.table : ''}`;

/** After any line change: all fired lines done → ready (+ notice); started → preparing; recalled → back to preparing. */
function settle(d: DB, o: Order) {
  const fired = o.lines.filter(l => l.fired);
  if (fired.length && fired.every(l => l.kds === 'done')) {
    if (['open', 'held', 'sent', 'preparing'].includes(o.status)) o.status = 'ready';
    const online = o.type === 'delivery';
    notice(d, 'Order ready', 'info', online ? ['cashier', 'pic'] : ['waiter', 'cashier'], o.outletId, `${label(o)} ready${online ? ' · bag to the pickup shelf' : ''}`);
  } else if (o.status === 'ready') o.status = 'preparing';
  else if (o.status === 'sent' && fired.some(l => l.kds !== 'new')) o.status = 'preparing';
}
const inStation = (l: OrderLine, station: string) => l.fired && (station === 'all' || l.station === station);

/** One-tap bump: every fired line of the station is done. */
export function bumpStation(orderId: string, station: string, by: string) {
  commit(station === 'all' ? 'ticket.done' : 'ticket.bumped', by, d => {
    const o = findOrder(d, orderId); if (!o) return;
    o.lines.forEach(l => { if (inStation(l, station)) l.kds = 'done'; });
    settle(d, o);
  }, orderId);
}
/** Status lanes: New → Cooking for the station's lines. */
export function startStation(orderId: string, station: string, by: string) {
  commit('ticket.started', by, d => {
    const o = findOrder(d, orderId); if (!o) return;
    o.lines.forEach(l => { if (inStation(l, station) && l.kds === 'new') l.kds = 'cooking'; });
    settle(d, o);
  }, orderId);
}
/** Tap an item row: done ↔ cooking. */
export function toggleLine(orderId: string, lineId: string, by: string) {
  commit('ticket.item_done', by, d => {
    const o = findOrder(d, orderId), l = o?.lines.find(x => x.id === lineId); if (!o || !l || !l.fired) return;
    l.kds = l.kds === 'done' ? 'cooking' : 'done';
    settle(d, o);
  }, orderId);
}
/** Call runner / waiter: lands in the waiter phone's Calls tab and the bell. */
export function callRunner(outletId: string, text: string, by: string) {
  commit('kds.runner_called', by, d => notice(d, 'Runner call', 'warn', ['waiter', 'pic'], outletId, text, '/waiter'), text, outletId);
}

/** Demo only: a QR table order fired straight to the kitchen, like the prototype's "Simulate new order". */
export function demoTicket(d0: DB, outletId: string) {
  const r = Math.random, outlet = d0.outlets.find(o => o.id === outletId);
  const avail = d0.outletProducts.filter(x => x.outletId === outletId && !x.is86 && !x.hidden).map(x => d0.products.find(p => p.id === x.productId)!).filter(p => p?.status === 'live');
  if (!avail.length) return null;
  const table = 'T-' + String(1 + Math.floor(r() * (outlet?.tables ?? 12))).padStart(2, '0');
  const id = newOrder(outletId, 'guest', 'qr', { table, type: 'dine', guests: 1 + Math.floor(r() * 4) });
  avail.sort(() => r() - .5).slice(0, 1 + Math.floor(r() * 3)).forEach((p, i) => {
    const groups = p.modifierGroupIds.map(g => d0.modifierGroups.find(m => m.id === g)!).filter(g => g?.required);
    addLine(id, p.id, groups.map(g => { const o = g.options[Math.floor(r() * g.options.length)]; return { name: o.name, price: o.price }; }), r() < .25 ? 2 : 1, i === 0 && r() < .3 ? 'Allergy: peanuts' : '', 'guest');
  });
  sendToKitchen(id, 'guest');
  return id;
}

/** 'a' in the permission matrix: sold-out waits for a PIC; applied once when approved. */
export function ask86(outletId: string, productId: string, name: string, by: string) {
  return requestApproval({ type: 'adjust', title: `Mark ${name} sold out`, requestedBy: by, outletId, subjectId: productId, note: 'From the kitchen display', payload: { kds86: productId } });
}
export function apply86(approvalId: string) {
  const a0 = snapshot().approvals.find(x => x.id === approvalId);
  if (a0?.status !== 'approved' || (a0.payload as { applied?: boolean } | undefined)?.applied) return;
  let hit: { outletId: string; productId: string; by: string } | null = null;
  commit('item.86_approved', 'system', d => {
    const a = d.approvals.find(x => x.id === approvalId), pl = a?.payload as { kds86?: string; applied?: boolean } | undefined;
    if (!a || a.status !== 'approved' || !pl?.kds86 || pl.applied) return;
    pl.applied = true; hit = { outletId: a.outletId, productId: pl.kds86, by: a.decidedBy ?? a.requestedBy };
  }, approvalId);
  const h = hit as { outletId: string; productId: string; by: string } | null;
  if (h && !snapshot().outletProducts.find(x => x.productId === h.productId && x.outletId === h.outletId)?.is86) toggle86(h.outletId, h.productId, h.by);
}
