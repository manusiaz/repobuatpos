'use client';
// Waiter phone services: fire a new round from the table, ask the cashier for the bill.
import { commit } from '../store.ts';
import { sendToKitchen } from '../actions.ts';
import { notice } from './kds.ts';

/** A second round on a table whose food was already out puts the bill back to preparing. */
export function fireRound(orderId: string, by: string) {
  sendToKitchen(orderId, by);
  commit('order.round_fired', by, d => { const o = d.orders.find(x => x.id === orderId); if (o && (o.status === 'ready' || o.status === 'served')) o.status = 'preparing'; }, orderId);
}
export function requestBill(orderId: string, by: string) {
  commit('order.bill_requested', by, d => {
    const o = d.orders.find(x => x.id === orderId); if (!o) return;
    notice(d, 'Bill requested', 'warn', ['cashier', 'pic'], o.outletId, `${o.table ?? o.no} asks for the bill · ${o.no}`, '/pos/selling/open-bills-saved-orders');
  }, orderId);
}
